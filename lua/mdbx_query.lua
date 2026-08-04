--[[

	MDBX query compiler over mdbx_scan.
	Written by Cosmin Apreutesei. Public Domain.

START
	db:from'TABLE [ALIAS]'-> rel  new query from table
	db:from(rel, alias) -> rel    new query from the rows of another query
FILTER
	:where(expr)                  where(e1):where(e2) == where({'and', e1, e2})
JOIN
	:[left_]join(table, on_expr)  join to table; table is: 'TABLE [ALIAS]'
	:[left_]join(rel, on_expr)    join to rel as join group (no terminals on rel)
	:[left_]join(rel, alias, on_expr)   join to rel as rows source (materialized)
	:fk_[left_]join(table, fk_cols)   join to table via FK
	fk_cols names the FK on the child table that owns it: 'COL[,COL...]'.
	the caller uses '=' between cols from different sources in on_expr
	:where_has(table, fk_cols, [filter])   q.exists(table) via FK
	:where_hasnt(table, fk_cols, [filter]) q.not_exists(table) via FK
	:cross_join(...)              unconditional join; takes no on_expr
	:[left_]lateral(rel, alias, [on_expr])   dependent join: rel sees the
	sources to its left and re-runs per outer row; its own limit() then
	applies per outer row. correlate with q.outer() inside rel.
	:semi_join(...)               :where(q.exists(table|rel,alias, on_expr))
	:anti_join(...)               :where(q.not_exists(table|rel,alias, on_expr))
SET (inputs must return the same out cols, with the same collations)
	db:union(rel1,...) -> rel     union-all; use :distinct() to deduplicate
	:intersect(rel) -> rel        rows in both, deduplicated
	:except(rel) -> rel           rows in the left with no match, deduplicated
GROUP
	:group_by(out_cols)           {{q.col() | agg_expr, name}, ...}
	:having(expr)                 post-group filter; requires :group_by()
DISTINCT
	:distinct([cols])             dedup by output cols, or cols if given
ORDER
	:order_by(order)              'REL.COL [desc],...' | {{q.col(), [dir]},...}
LIMIT
	:limit(n, [offset])
EXPRESSIONS
	q = mdbx_query
	q.col('REL.COL|NAME')         column reference; REL: rel or table alias/name
	q.param(name)                 bound value at execution
	q.outer('REL.COL|NAME')       col that must resolve in a parent scope
	{op, a, b}                    op: '=' '~=' '<' '<=' '>' '>='
	{'and', expr1, expr2, ...}
	{'or', expr1, expr2, ...}
	{'is_[not_]null', expr}
	{'starts', expr, prefix}
	q.between(expr, lo, hi)       {'and', {'>=',expr,lo}, {'<=',expr,hi}}
	q.[not_]exists(..., on_expr)
	{'[not_]in', expr, vals|rel}
AGGREGATES (group_by() out_cols only)
	{'count'[, val_expr]}         val_expr: literal | q.param() | q.col()
	{'min'|'max'|'sum'|'avg', val_expr}
SELECT
	:select(out_cols)             {'REL.COL [NAME]' | {q.col(), name}, ...}
TERMINALS (materialization)
	:rows       ([shape], [params]) -> iter() -> vals...
	:first      ([shape], [params]) -> vals... | nil
	:one        ([shape], [params]) -> vals... | nil
	:must_one   ([shape], [params]) -> vals...
	:rows_array ([shape], [params]) -> {row1,...}
	:count      ([params]) -> n
	:exists     ([params]) -> true | false
PROFILING
	:explain() -> expl            explain plan
CONTROL
	:prepare([terminal_kind])             compile now

ROW FORMATS (the `shape` arg of terminals):

	rows()    ->  iter()  ->  val1,...
	rows'[]'  ->  iter()  ->  {val1,...}
	rows'{}'  ->  iter()  ->  {name->val}

EXAMPLE

	require'mdbx_query'

	local q = mdbx_query
	local c = q.col
	local p = q.param

	local posts =
		db:from'post p'
			:where{'=', c'p.status', p'STATUS'}
			:where{'>=', c'p.score', p'MIN_SCORE'}
			:select{
				'p.id id',
				'p.title title',
			}
			:order_by'p.score, p.id'
			:limit(50)

	for row in posts:rows('{}', {STATUS = 'published', MIN_SCORE = 10}) do
		print(row.id, row.title)
	end


IMPLEMENTATION

	See `mdbx_query_impl.md`.

]]

if not ... then require'mdbx_query_test'; return end

require'mdbx_scan'

local Db = mdbx_db

--PARSING --------------------------------------------------------------------

local function comma_list(s)
	if istab(s) then
		local i = 0
		return function() i = i + 1; return s[i] end
	end
	return s:gmatch'[^,]+'
end

local function parse_opt(s, default_opt) -- 'S [OPT]'
	local s0, opt = s:match'^(%S+)%s+(%S+)$'
	opt = opt or default_opt
	if not s0 then return s, opt end
	return s0, opt
end

local function parse_col(s) -- '[REL.]COL'
	local rel, col = s:match'^([^.]+)%.([^.]+)$'
	if not rel then return nil, s end
	return rel, col
end

local function parse_out_col(s) --'REL.COL [NAME]'
	local col, name = parse_opt(s)
	local rel, col = parse_col(col)
	return {'col', rel, col, name = name}
end
local function parse_out_cols(cols) --{'REL.COL [NAME],...'|{expr, name},...}
	local t = {} --{col1,...}
	for s in comma_list(cols) do
		add(t, isstr(s) and parse_out_col(s:trim()) or s)
	end
	return t
end

local function parse_distinct_cols(s) -- 'COL, ...'
	local t = {} --{col1,...}
	for s in s:gmatch'[^,]+' do
		add(t, s:trim())
	end
	return t
end

-- 'REL.COL [asc|desc],...' | {{q.col(), 'asc|desc'},...}
local function parse_order_by(cols)
	if not cols then return end
	local t = {}
	for s in comma_list(cols) do
		local expr
		if isstr(s) then
			local col, dir = parse_opt(s:trim(), 'asc')
			local rel, col = parse_col(col)
			expr = {'col', rel, col, dir = dir}
		else
			expr = s[1]
			expr.dir = s[2] or 'asc'
		end
		assertf(expr.dir == 'asc' or expr.dir == 'desc',
			'invalid order_by() direction: %s', expr.dir)
		add(t, expr)
	end
	return t
end

--RELATIONS ------------------------------------------------------------------

local Rel = {} --rel methods mutate rel and return it.

function Db:from(rel, alias) --'TABLE [ALIAS]'|rel, [alias]
	if isstr(rel) then
		rel, alias = parse_opt(rel, alias)
	end
	return object(Rel, {db = self, joins = {{right = rel, alias = alias}}})
end

function Db:union(...) --rel1, ...
	return object(Rel, {db = self, set_op = 'union', set_rels = {...}})
end

local function set_op_rel(self, op, rel)
	assert(inherits(rel, Rel))
	return object(Rel, {db = self.db, set_op = op, set_rels = {self, rel}})
end
function Rel:intersect (rel) return set_op_rel(self, 'intersect', rel) end
function Rel:except    (rel) return set_op_rel(self, 'except'   , rel) end

function Rel:where(expr)
	add(attr(self, 'wheres'), expr)
	return self
end
function Rel:having(expr)
	add(attr(self, 'havings'), expr)
	return self
end
function Rel:select(cols)
	self.select_cols = parse_out_cols(cols)
	return self
end
function Rel:group_by(cols)
	self.group_cols = parse_out_cols(cols)
	return self
end
function Rel:order_by(cols)
	self.order_cols = parse_order_by(cols)
	return self
end
function Rel:distinct(cols)
	self.distinct_cols = cols and parse_distinct_cols(cols) or true
	return self
end
function Rel:limit(n, offset)
	self._limit = n
	self._offset = offset
	return self
end
local function join(self, op, rel, alias, on_expr)
	if not isstr(alias) then --no alias, shift args
		on_expr, alias = alias, nil
	end
	if isstr(rel) then -- 'TABLE [ALIAS]'[, alias], on_expr
		rel, alias = parse_opt(rel, alias)
	else -- rel[, alias], on_expr
		assert(inherits(rel, Rel))
	end
	assert((op == 'cross') == (on_expr == nil))
	local t = {op = op, right = rel, alias = alias, on_expr = on_expr}
	add(attr(self, 'joins'), t)
	return self
end
function Rel:join       (...) return join(self, 'inner', ...) end
function Rel:left_join  (...) return join(self, 'left' , ...) end
function Rel:cross_join (...) return join(self, 'cross', ...) end
--a lateral join's rel sees the sources to its left and re-runs per outer
--row, so it needs no on_expr: the correlation lives in the rel itself.
local function lateral(self, op, rel, alias, on_expr)
	assert(inherits(rel, Rel), 'lateral: a rel is required')
	assert(isstr(alias), 'lateral: an alias is required')
	add(attr(self, 'joins'), {op = op, right = rel, alias = alias,
		on_expr = on_expr, lateral = true})
	return self
end
function Rel:lateral      (...) return lateral(self, 'inner', ...) end
function Rel:left_lateral (...) return lateral(self, 'left' , ...) end

--EXPRESSIONS ----------------------------------------------------------------

--expr: {op, ...}

local q = {}
mdbx_query = q

function q.col(s)
	local rel, col = parse_col(s)
	return {'col', rel, col}
end
function q.outer(s)
	local rel, col = parse_col(s)
	return {'col', rel, col, outer = true}
end

function q.param (name) return {'param', name} end

function q.between(expr, lo, hi)
	return {'and', {'>=', expr, lo}, {'<=', expr, hi}}
end

--{op->true}: 'count'/'min'/'max'/'sum'/'avg', the only ops group_by()
--allows as an aggregate output.
local AGGREGATE_OPS = {count = true, min = true, max = true, sum = true,
	avg = true}

local function exists_expr(op, rel, alias, on_expr)
	if not isstr(alias) then --no alias, shift args
		on_expr, alias = alias, nil
	end
	if isstr(rel) then -- 'TABLE [ALIAS]'[, alias], [on_expr]
		rel, alias = parse_opt(rel, alias)
	else -- rel[, alias], [on_expr]
		assert(inherits(rel, Rel))
		if alias then
			rel = rel.db:from(rel, alias)
			if on_expr then rel:where(on_expr) end
			alias, on_expr = nil
		else
			--without an alias there is no name for on_expr to reach the
			--sub-relation's out cols by.
			assertf(not on_expr, '%s(): put the condition in the'
				..' sub-relation\'s own where(), or pass an alias', op)
		end
	end
	return {op, rel, on_expr, alias = alias}
end
function q.exists    (...) return exists_expr('exists'    , ...) end
function q.not_exists(...) return exists_expr('not_exists', ...) end

function Rel:semi_join(...) return self:where(q.exists(...)) end
function Rel:anti_join(...) return self:where(q.not_exists(...)) end

function Rel:fk_join      (tbl, fk_cols)
	return join(self, 'inner', tbl, {fk = fk_cols or true})
end
function Rel:fk_left_join (tbl, fk_cols)
	return join(self, 'left' , tbl, {fk = fk_cols or true})
end

function Rel:where_has   (tbl, fk_cols, filter)
	return self:where(exists_expr('exists', tbl,
		{fk = fk_cols or true, filter = filter}))
end
function Rel:where_hasnt (tbl, fk_cols, filter)
	return self:where(exists_expr('not_exists', tbl,
		{fk = fk_cols or true, filter = filter}))
end

--COMPILATION ----------------------------------------------------------------

--[[
what compile() does, in order:
BINDING
- resolve input; union inputs -> shared out cols, else joins -> rel.sources
- merge join group; its sources -> rel.sources, wheres -> on_expr | where
- resolve output cols; group_by/select -> group_cols/select_cols, out_cols
- resolve distinct; col names -> expr list | true | nil
- build scopes; sources/union out cols (+group_cols) -> rel.scope, group_scope
- bind group output cols; exprs -> source+col (aggregates allowed here)
- bind select output cols; grouped -> out_col refs, else source refs
- bind having; exprs -> group out_col refs
- bind order_by; cols -> out_col refs | source refs
- bind joins; fk marker -> on_expr, bind cols, recurse join groups
- bind wheres; exprs -> source+col on cols
ANALYZING
- split conditions; wheres/havings/on_exprs -> fact|residual conditions
- attribute conditions; where conditions -> owning source | late
- build access plan; joins -> per-source scan plan, natural_order
- decide sort/group/dedup shortcuts; -> sort_needed, group_streaming,
  distinct_streaming
- compile output pipeline; out/group/distinct/sort cols -> descriptors
- classify exists()/in_() targets; residual/late/having -> expr.plan/.correlated
]]

local resolve_table_source --fw.decl.

--SCOPE LOOKUP ---------------------------------------------------------------

--find a named source in this scope or a parent scope.
local function find_source(scope, rel_name)
	local depth = 0
	while scope do
		local source = scope.sources[rel_name]
		if source then return source, depth end
		scope = scope.parent
		depth = depth + 1
	end
end

--find the source of an unqualified col, or nil if it's an output col.
local function find_col(scope, col)
	local depth = 0
	while scope do
		local out_col = scope.cols and scope.cols[col]
		if out_col then return nil, out_col, depth end
		local found, bcol
		for _, source in ipairs(scope.sources) do
			local source_col = source.cols[col]
			if source_col then --col found in two sources
				assertf(not found, 'ambiguous col: %s', col)
				found, bcol = source, source_col
			end
		end
		if found then return found, bcol, depth end
		scope = scope.parent
		depth = depth + 1
	end
end

--COLUMN BINDING -------------------------------------------------------------

--bind a col expression to its source col.
local function bind_col(expr, scope)
	local _, rel_name, col = unpack(expr, 1, 3)
	local source, bcol, depth
	if rel_name then
		source, depth = find_source(scope, rel_name)
		assertf(source, 'unknown source: %s', rel_name)
		bcol = assertf(source.cols[col], 'unknown col: %s.%s', rel_name, col)
	else
		source, bcol, depth = find_col(scope, col)
		assertf(bcol, 'unknown col: %s', col)
	end
	assert(not expr.outer or depth > 0,
		'outer col resolved in current scope')
	expr.source = source
end

--bind a col to an output col by name, not to a source col.
local function bind_out_col(expr, out_cols)
	local _, rel_name, col = unpack(expr, 1, 3)
	--output cols have names but no REL prefix.
	assert(not rel_name, 'output col must be unqualified')
	local out_col = out_cols and out_cols[col]
	assertf(out_col, 'unknown output col: %s', col)
	expr.source = nil
	expr.col = out_col
end

--FK EXPR BINDING ------------------------------------------------------------

--collect the foreign keys named fk_cols between two table sources, in
--either direction. fks are keyed by their own col list, so naming it
--distinguishes two FKs that connect the same pair of tables.
local function fk_matches(source_a, source_b, fk_cols, found_fks)
	local function scan(child, parent)
		local fk = child.schema.fks and child.schema.fks[fk_cols]
		if fk and fk.ref_table == parent.table then
			add(found_fks, {fk = fk, child = child, parent = parent})
		end
	end
	scan(source_a, source_b)
	scan(source_b, source_a)
end

--build the equality condition for one foreign key.
local function fk_expr(found_fk)
	local exprs = {}
	for i, col in ipairs(found_fk.fk.cols) do
		local child_col = q.col(found_fk.child.name..'.'..col)
		local parent_col = q.col(found_fk.parent.name..'.'
			..found_fk.fk.ref_cols[i])
		--source names can repeat across exists() scopes.
		child_col.source = found_fk.child
		parent_col.source = found_fk.parent
		exprs[i] = {'=', child_col, parent_col}
	end
	return #exprs == 1 and exprs[1] or {'and', unpack(exprs)}
end

--find the one foreign key named marker.fk connecting a new table to
--existing sources.
local function resolve_fk(marker, new_source, sources, what)
	local fk_cols = marker.fk
	--naming the FK is what keeps a second FK added to the schema later
	--from changing what an existing query means.
	assertf(fk_cols ~= true, '%s: fk cols required for %s', what,
		new_source.name)
	local found_fks = {}
	for _, source in ipairs(sources) do
		if source ~= new_source and source.table then
			fk_matches(new_source, source, fk_cols, found_fks)
		end
	end
	assertf(#found_fks > 0, '%s: no FK %s for %s', what, fk_cols,
		new_source.name)
	assertf(#found_fks == 1, '%s: ambiguous FK %s for %s', what, fk_cols,
		new_source.name)
	local expr = fk_expr(found_fks[1])
	if marker.filter then return {'and', expr, marker.filter} end
	return expr
end

--EXPRESSION BINDING ---------------------------------------------------------

local compile
local split_group_cols   --fw. decl.
local resolve_exists_plan --fw. decl.

--bind every col nested in an expression.
local function bind_expr(expr, scope, out_cols, mode, allow_aggregate)
	if type(expr) ~= 'table' then return end
	local op = expr[1]
	if AGGREGATE_OPS[op] then
		--aggregate exprs (count/sum/...) are only allowed in group_by().
		assert(allow_aggregate,
			'aggregate expressions are only allowed in group_by()')
		bind_expr(expr[2], scope, out_cols, mode)
		return
	elseif op == 'col' then
		--skip if already bound: fk_expr() already set source/col.
		--a name lookup here would be wrong anyway as it could hit a different
		--source using the same alias in another exists() scope.
		if expr.source then return end
		local _, rel_name, col = unpack(expr, 1, 3)
		if expr.outer then
			bind_col(expr, scope)
		elseif mode == 'out_col' then --group_by, having
			bind_out_col(expr, out_cols)
		elseif mode == 'out_col_or_source' --order_by without group_by
			and not rel_name
			and out_cols and out_cols[col]
		then
			bind_out_col(expr, out_cols)
		else
			bind_col(expr, scope)
		end
		return
	elseif op == 'param' then
		return
	elseif op == 'exists' or op == 'not_exists' then
		local right, on_expr = expr[2], expr[3]
		if isstr(right) then
			local source = resolve_table_source(scope.db, right, expr.alias)
			if type(on_expr) == 'table' and on_expr.fk then
				on_expr = resolve_fk(on_expr, source, scope.sources,
					'where_has')
				expr[3] = on_expr
			end
			local sources = {source}
			sources[source.name] = source
			expr[2] = source
			expr.alias = nil
			local exists_scope = {
				db = scope.db,
				sources = sources,
				parent = scope,
			}
			bind_expr(on_expr, exists_scope)
		else
			compile(right, scope)
			bind_expr(on_expr, right.scope)
		end
		return
	elseif op == 'in' or op == 'not_in' then
		bind_expr(expr[2], scope, out_cols, mode)
		local values = expr[3]
		if inherits(values, Rel) then
			compile(values, scope)
			--in_()'s relation must return exactly one col: one value per row
			--to compare against.
			assert(values.out_cols and #values.out_cols == 1,
				op..'() relation requires one output col')
		elseif values[1] ~= 'param' then
			for _, value in ipairs(values) do
				bind_expr(value, scope, out_cols, mode)
			end
		end
		return
	end
	for i = 2, #expr do
		bind_expr(expr[i], scope, out_cols, mode)
	end
end

--bind every join's on_expr; recurse into nested join groups.
local function bind_joins(joins, scope, sources)
	for _, join in ipairs(joins) do
		if type(join.on_expr) == 'table' and join.on_expr.fk then
			join.on_expr = resolve_fk(join.on_expr, join.right,
				sources, 'fk_join')
		end
		bind_expr(join.on_expr, scope)
		if inherits(join.right, Rel) then
			bind_joins(join.right.joins or empty, scope, sources)
		end
	end
end

--OUTPUT COLS ----------------------------------------------------------------

--build one table for output col order and name lookup.
local function resolve_out_cols(cols)
	if not cols then return end
	local out_cols = {}
	for i, out_col in ipairs(cols) do
		local expr, name
		if type(out_col[1]) == 'table' then
			expr, name = out_col[1], out_col[2]
		else
			expr = out_col
			name = expr.name or expr[1] == 'col' and expr[3]
		end
		assert(name, 'computed output col requires a name')
		--reject a non-string name: out_cols[i] (position) and out_cols[name]
		--(lookup) share this same table, so a numeric name would collide.
		assert(type(name) == 'string', 'output col name must be a string')
		assertf(not out_cols[name], 'duplicate output col: %s', name)
		expr.name = name
		out_cols[i] = expr
		out_cols[name] = expr
	end
	return out_cols
end

--resolve distinct col names to output expressions.
local function resolve_distinct(distinct, out_cols)
	if distinct == nil or distinct == true then return distinct end
	--distinct() names must match select()/group_by() output col names.
	assert(out_cols, 'distinct cols require select() or group_by()')
	local cols = {}
	for i, name in ipairs(distinct) do
		cols[i] = assertf(out_cols[name],
			'unknown distinct output col: %s', name)
	end
	return cols
end

--check that two output col lists use the same names in the same order.
local function same_out_cols(out_cols_a, out_cols_b)
	if #out_cols_a ~= #out_cols_b then return false end
	for i, expr in ipairs(out_cols_a) do
		if expr.name ~= out_cols_b[i].name then return false end
	end
	return true
end

--SOURCE LIST ----------------------------------------------------------------

--add one source to the ordered list and the name lookup.
local function add_source(sources, source)
	--reject a repeated source name: a later lookup by name can't tell the
	--two sources apart.
	assertf(not sources[source.name], 'duplicate source: %s', source.name)
	add(sources, source)
	sources[source.name] = source
end

--[[local]] function resolve_table_source(db, tbl, alias)
	--virtual tables have no physical storage: their schema comes from paper
	--schema, not through db:table_schema(), which only knows about real tables.
	local schema = db.schema and db.schema.tables[tbl]
	if not (schema and schema.virtual) then
		schema = assert(db:table_schema(tbl))
	end
	return {
		table = tbl,
		schema = schema,
		name = alias or tbl,
		cols = schema.fields,
	}
end

--compile a relation used as an aliased rows source. a lateral source is
--compiled in the enclosing scope, so its cols can bind to the sources
--resolved before it -- the ones to its left.
local function resolve_rel_source(rel, name, what, scope)
	compile(rel, scope)
	--only select()/group_by() give a relation named cols to use as a rows source.
	local cols = assert(rel.out_cols, what..' requires select() or group_by()')
	return {
		rel = rel,
		name = name,
		cols = cols,
		lateral = scope ~= nil,
	}
end

--resolve sources and merge unaliased relation joins into this relation.
local function resolve_sources(rel, scope)
	local sources = scope and scope.sources or {}
	rel.sources = sources
	assert(rel.joins and rel.joins[1], 'from() missing')
	for i, join in ipairs(rel.joins) do
		if isstr(join.right) then
			join.right = resolve_table_source(rel.db, join.right, join.alias)
			add_source(sources, join.right)
		elseif join.alias then
			--the join alias becomes this source's name; the inner rel has no
			--name of its own, only names for its own out_cols.
			assert(not (join.lateral and i == 1), 'from(rel) cannot be lateral')
			join.right = resolve_rel_source(join.right, join.alias,
				i == 1 and 'from(rel)' or 'join(rel)',
				join.lateral and scope or nil)
			add_source(sources, join.right)
		else
			assert(i > 1, 'from(rel) requires alias')
			local join_rel = join.right
			--a join group (unaliased relation join) may only have sources,
			--joins, and where() -- nothing else merges into the parent.
			assert(not (
					join_rel.set_op
				or join_rel.havings
				or join_rel.select_cols
				or join_rel.group_cols
				or join_rel.distinct_cols
				or join_rel.order_cols
				or join_rel._limit
			), 'join rel contains unsupported query parts')
			--get join group's sources before moving its where() clauses.
			local join_sources = resolve_sources(join_rel)
			for _, join_source in ipairs(join_rel.joins) do
				assert(not join_source.lateral,
					'lateral inside a join group is not implemented yet')
			end
			--flatten join group: move its where() clauses out into rel.
			if join_rel.wheres then
				if join.op == 'left' then
					--AND left join where() conditions to the join condition.
					for _, join_where in ipairs(join_rel.wheres) do
						if join.on_expr == nil or join.on_expr == true then
							join.on_expr = join_where
						else
							join.on_expr = {'and', join.on_expr, join_where}
						end
					end
				else
					--AND cross/inner join where()s to rel's own where() list.
					local wheres = attr(rel, 'wheres')
					for _, join_where in ipairs(join_rel.wheres) do
						add(wheres, join_where)
					end
				end
				join_rel.wheres = nil
			end
			--add join group's sources to rel so that q.col() can bind into
			--group's sources.
			for _, join_source in ipairs(join_sources) do
				add_source(sources, join_source)
			end
		end
	end
	return sources
end

--SORT AND DEDUP HELPERS -----------------------------------------------------

--helpers used in deciding whether a sort step can be skipped because rows
--come already sorted.

--[[
- turns a parsed col() expr into the same {key=} shape that key_order() builds
  from the schema, so that order/group/distinct planning can compare
  "what the query asked for" against "what the scan naturally produces" with
  a plain key comparison.
- nil if expr isn't a plain column (aggregate or computed): no physical key
  can satisfy that, so there's nothing to compare.
- note: the same col expr can be asked for two different terms in one compile
  e.g. group_by('a.x k'):order_by('k desc') needs the bare column for the
  grouping key and column+dir for the order, both read off the same out_col
  object.
]]
local function col_term(expr)
	if type(expr) == 'table' and expr[1] == 'col' and expr.source then
		return {key = expr.source.name..'.'..expr[3]}
	end
	return nil
end

--[[
- test whether natural scan order satisfies ordered terms.
- terms are ordered by order_by() priority.
- fixed natural cols are skipped: every row shares one value there, so
  comparing a term against it can never fail.
- varying natural cols must match in sequence, dir included -- an
  order_by() term always carries a dir (parse_order_by defaults it to
  'asc'), so the dir check is never optional.
]]
local function order_satisfied(terms, natural_order)
	local fixed = {} --{key->true}
	local varying = {} --{{key=,dir=}...}
	for _, n in ipairs(natural_order) do
		if n.fixed then fixed[n.key] = true
		else add(varying, n) end
	end
	local vi = 1
	for _, term in ipairs(terms) do
		if not fixed[term.key] then
			local v = varying[vi]
			if not v or v.key ~= term.key or v.dir ~= term.dir then
				return false
			end
			vi = vi + 1
		end
	end
	return true
end

--[[
- test whether scanning in natural key order already keeps rows with
  equal terms adjacent, so a streaming grouper could use this set of
  cols without a separate sort.
- term order does not matter, only the set of cols.
- fixed natural cols are skipped: every row shares one value there, so
  grouping by it never separates one row from another.
- remaining terms must cover the exact varying prefix as a set.
- skipping a varying prefix col would split equal groups apart.
- second return is how many varying cols the terms covered: callers
  that need the terms to cover the WHOLE varying tail (not just a
  prefix of it) compare this against #varying themselves.
]]
local function order_satisfied_set(terms, natural_order)
	local fixed = {} --{key->true}
	local varying = {} --{{key=}...}
	for _, n in ipairs(natural_order) do
		if n.fixed then fixed[n.key] = true
		else add(varying, n) end
	end
	local wanted = {} --{key->true}
	local n_wanted = 0
	for _, term in ipairs(terms) do
		if not fixed[term.key] then
			wanted[term.key] = true
			n_wanted = n_wanted + 1
		end
	end
	if n_wanted > #varying then return false end
	for i = 1, n_wanted do
		if not wanted[varying[i].key] then
			return false
		end
	end
	return true, n_wanted
end

--[[
- resolve every out_col in cols (rel.out_cols by default) to a {key=}
  term.
- nil if any out_col is not a plain source-col passthrough (an
  aggregate or computed output).
- distinct()'s streaming dedup and the NEXT_NODUP compile-time check
  (shared by distinct() and group_by() with no aggregate outputs) share
  this: all three need the dedup cols to be readable straight off the
  scan key, not computed.
]]
local function returned_source_terms(rel, cols)
	local terms = {} --{{key=}...}
	for _, out_col in ipairs(cols or rel.out_cols) do
		local term = col_term(out_col)
		if not term then return nil end
		add(terms, term)
	end
	return terms
end

--[[
- resolve one order_by() term to {key=, dir=}.
- when bind_col() bound this order_by() entry straight to a source
  col, read col_term() off the entry itself.
- when bind_out_col() bound it to an out_col by name instead (a
  select()/group_by() output alias), read col_term() off that
  out_col's own expr.
- either way, only a plain col passthrough is order-checkable; an
  aggregate or computed expr returns nil.
]]
local function order_term(term)
	local t = col_term(term.source and term or term.col)
	if t then t.dir = term.dir end
	return t
end

--[[
sort_actually_needed() returns false without order_by(). aggregate() and
distinct() emit results in input encounter order, so sort_actually_needed()
can reuse rel.natural_order after either call.
When group_by() has no key cols, sort_actually_needed() returns false because
aggregate() emits at most one row.
]]
local function sort_actually_needed(rel)
	if not rel.order_cols then return false end
	if rel.group_cols then
		local has_key
		for _, expr in ipairs(rel.group_cols) do
			if not AGGREGATE_OPS[expr[1]] then has_key = true; break end
		end
		if not has_key then return false end
	end
	if not rel.natural_order then return true end
	local terms = {} --{{key=,dir=}...}
	for _, term in ipairs(rel.order_cols) do
		local t = order_term(term)
		if not t then return true end
		add(terms, t)
	end
	return not order_satisfied(terms, rel.natural_order)
end

--distinct()'s dedup key: cols if given, else every returned col (also
--covers group_by() with no aggregate outputs, where distinct_cols is nil).
local function dedup_key_cols(rel)
	return type(rel.distinct_cols) == 'table' and rel.distinct_cols
		or rel.out_cols
end

--only the base source's cursor order can set final row order: a
--joined source's scan re-runs under each driver row, so its own
--cursor order only holds within that one driver row, not across the
--whole result.
local function base_order_terms(rel)
	if not rel.order_cols or rel.group_cols or rel.distinct_cols then
		return
	end
	local terms = {} --{{key=,dir=}...}
	for _, term in ipairs(rel.order_cols) do
		local t = order_term(term)
		if not t then return end
		add(terms, t)
	end
	return terms
end

--index selection for group order: an index whose key groups these
--cols together lets a later streaming grouper run instead of a hash,
--whether or not group_by() also has aggregate outputs.
--group_by()'s own key (non-aggregate) outputs are used directly --
--bound in source mode regardless of any select() layered on top.
--distinct() without group_by() has no separate key notion: its dedup
--cols (cols if given, else every out col) are its only key.
local function group_key_terms(rel)
	if rel.group_cols then
		local terms = {} --{{key=}...}
		for _, expr in ipairs(rel.group_cols) do
			if not AGGREGATE_OPS[expr[1]] then
				local t = col_term(expr)
				if not t then return nil end --computed key: index can't help
				add(terms, t)
			end
		end
		return terms[1] and terms or nil
	end
	if rel.distinct_cols then
		return returned_source_terms(rel, dedup_key_cols(rel))
	end
end

--[[
- true when rows sharing the same values for these terms are
  guaranteed to come out of the whole access chain next to each other,
  so a streaming grouper/dedup (pk_group+stream_aggregate,
  stream_distinct) can compare each row to the one before it instead
  of hashing every group in memory.
- first way this holds: the chosen access plan's own natural_order
  already keeps these terms' cols adjacent -- a proper prefix of the
  varying natural order is enough for grouping (nothing needs to vary
  after it).
- second way, needing no natural order at all: the terms cover the
  base (driving) source's whole primary key. join() emits one
  base row's entire fan-out before moving to the next, so every row
  sharing one base row's identity comes out together regardless of
  the order of any joined source's scan.
- ported from mdbx_query.lua's terms_group_consecutive(), which this
  file's own TODOs already named as the missing piece.
]]
local function terms_group_consecutive(rel, terms)
	if order_satisfied_set(terms, rel.natural_order) then return true end
	local base_source = rel.access[1].source
	if not base_source.table or base_source.schema.virtual then
		return false
	end
	local needed = {} --{key->true}
	for _, col in ipairs(base_source.schema.pk) do
		needed[base_source.name..'.'..col] = true
	end
	for _, term in ipairs(terms) do
		if not needed[term.key] then return false end
		needed[term.key] = nil
	end
	return not next(needed)
end

--[[
- decide whether group_by()'s aggregates can stream (pk_group +
  stream_aggregate) instead of hashing (hash_aggregate).
- group_key_terms() returns nil both when group_by() wasn't called and
  when it has no non-aggregate (key) cols at all (a grand total) --
  neither case can stream, since there's no key to keep adjacent.
- benchmarked in the prior implementation (mdbx_query_builder.lua's
  "CONFIRMED BY BENCH" notes): streaming wins by ~147x when order is
  free; hashing wins by ~3x when it isn't, since sorting just to
  unlock streaming costs more than it saves.
]]
local function group_actually_streamable(rel)
	if not rel.group_cols then return false end
	local terms = group_key_terms(rel)
	if not terms then return false end
	return terms_group_consecutive(rel, terms)
end

--[[
distinct_actually_streamable() uses terms_group_consecutive() for
distinct()'s key when group_by() is absent. distinct_actually_streamable()
uses the hash path after group_by().
]]
local function distinct_actually_streamable(rel)
	if not rel.distinct_cols or rel.group_cols then return false end
	local terms = group_key_terms(rel)
	if not terms then return false end
	return terms_group_consecutive(rel, terms)
end

--CHOOSE HOW TO READ ONE TABLE -----------------------------------------------

local fact_kind = { --{op->fact kind}
	['='] = 'equality',
	['~='] = 'not_equal',
	['<'] = 'range', ['<='] = 'range', ['>'] = 'range', ['>='] = 'range',
	starts = 'prefix',
	['in'] = 'membership', not_in = 'membership',
	exists = 'existence', not_exists = 'existence',
	is_null = 'null', is_not_null = 'null',
}
--[[
- {'or', {'=', col, v1}, {'=', col, v2}, ...} means the same thing as
  {'in', col, {v1, v2, ...}}, so we turn it into that shape here.
- once it's an 'in', it can drive an index seek exactly like a real
  one would -- nothing else below needs to know it started as an or.
- this only fires when every arm compares the exact same col. two
  different cols, or a col on both sides of one arm, can't collapse
  into one membership check, so we leave those alone.
]]
local function or_as_in(expr)
	if type(expr) ~= 'table' or expr[1] ~= 'or' then return nil end
	local col, values = nil, {}
	for i = 2, #expr do
		local arm = expr[i]
		if type(arm) ~= 'table' or arm[1] ~= '=' then return nil end
		local l, r = arm[2], arm[3]
		if type(r) == 'table' and r[1] == 'col' then l, r = r, l end
		if type(l) ~= 'table' or l[1] ~= 'col' then return nil end
		if type(r) == 'table' and r[1] == 'col' then return nil end
		if col and (l.source ~= col.source or l[3] ~= col[3]) then return nil end
		col = l
		values[i - 1] = r
	end
	return {'in', col, values}
end

--[[
- where()/having() calls combine as if 'and'ed together.
- a top-level {'and', ...} inside one call has the same effect.
- split_conditions() flattens both forms into one independent-
  condition list.
- choose_access() can turn a fact-classified condition into an index
  seek; an unclassified condition stays a residual row check.
]]
local function split_conditions(exprs, classify)
	local conditions = {} --{condition...; condition={kind=nil|fact, expr=expr}}
	local function add_condition(expr)
		if type(expr) == 'table' and expr[1] == 'and' then
			for i = 2, #expr do
				add_condition(expr[i])
			end
		else
			if classify then
				expr = or_as_in(expr) or expr
			end
			conditions[#conditions + 1] = {
				kind = classify and type(expr) == 'table'
					and fact_kind[expr[1]] or nil,
				expr = expr,
			}
		end
	end
	for _, expr in ipairs(exprs) do
		add_condition(expr)
	end
	return conditions
end

--a join group can contain nested join groups.
--internal joins need on_conditions recursively.
local function split_join_conditions(joins)
	for _, join in ipairs(joins) do
		--an unconditional join has nothing to split.
		--no always-true residual entry is needed.
		join.on_conditions = (join.on_expr == nil or join.on_expr == true)
			and empty or split_conditions({join.on_expr}, true)
		if inherits(join.right, Rel) then
			split_join_conditions(join.right.joins)
		end
	end
end

local referenced_sources --fw. decl.

--walk a rel's own filters (where()s and joins' on_expr) so a
--correlated exists()/in_() can be owned by the outer source that it
--reads (through_exists=true), or so a sub-relation's own correlation
--to a given source set can be detected (through_exists=false, see
--references_outside() below).
local function referenced_rel_sources(rel, found, sources, through_exists)
	if rel.set_op then
		for _, input in ipairs(rel.set_rels) do
			referenced_rel_sources(input, found, sources, through_exists)
		end
		return
	end
	for _, cond in ipairs(rel.where_conditions) do
		referenced_sources(cond.expr, found, sources, through_exists)
	end
	for _, join in ipairs(rel.joins or empty) do
		referenced_sources(join.on_expr, found, sources, through_exists)
	end
end

--[[
- collect the sources an expression reads into found (name -> source).
- q.col() nodes count when sources is nil (record every source) or
  when they bind to one of sources (record only those).
- through_exists controls what an exists()/not_exists()/in_()/not_in()
  boundary does:
  - true (attribute_conditions()'s use): recurse into its on_expr and
    inner where()/joins too -- a whole condition that reads an outer
    col only via a nested exists()/in_() still "reads" that source,
    for scheduling purposes.
  - false (references_outside()'s use): stop there -- a nested
    exists()/in_() is evaluated as its own independent, self-contained
    boolean; its own correlation is resolved separately, so it never
    makes the enclosing occurrence itself correlated.
- attribute_conditions() uses how many sources this returns (through_exists
  = true, sources = the owning rel's own) to decide whether one source
  can own a condition; a cross-source condition becomes a late
  condition, checked only after every source has been scanned.
]]
--found: {name -> source}
--[[local]] function referenced_sources(expr, found, sources, through_exists)
	if type(expr) ~= 'table' then return end
	local op = expr[1]
	if op == 'col' then
		if expr.source and (not sources or sources[expr.source.name] == expr.source) then
			found[expr.source.name] = expr.source
		end
	elseif op == 'exists' or op == 'not_exists' then
		if through_exists then
			local right, on_expr = expr[2], expr[3]
			if on_expr then
				referenced_sources(on_expr, found, sources, through_exists)
			end
			if inherits(right, Rel) then
				referenced_rel_sources(right, found, sources, through_exists)
			end
		end
	elseif op == 'in' or op == 'not_in' then
		referenced_sources(expr[2], found, sources, through_exists)
		local values_or_rel = expr[3]
		if inherits(values_or_rel, Rel) then
			if through_exists then
				referenced_rel_sources(values_or_rel, found, sources,
					through_exists)
			end
		elseif values_or_rel[1] ~= 'param' then
			for _, item in ipairs(values_or_rel) do
				referenced_sources(item, found, sources, through_exists)
			end
		end
	else
		for i = 2, #expr do
			referenced_sources(expr[i], found, sources, through_exists)
		end
	end
end

local function check_join_operators(joins)
	local function check_expr(expr)
		if type(expr) ~= 'table' then return end
		local op = expr[1]
		if op == '~=' or op == '<' or op == '<=' or op == '>' or op == '>='
			or op == 'starts'
		then
			local found = {}
			referenced_sources(expr, found, nil, false)
			local source_n = 0
			for _ in pairs(found) do source_n = source_n + 1 end
			--scan() accepts {scan=} only with '='.
			assertf(source_n < 2,
				"join: '%s' cannot compare cols from different sources", op)
		elseif op == 'exists' or op == 'not_exists' then
			return
		elseif op == 'in' or op == 'not_in' then
			check_expr(expr[2])
			return
		end
		for i = 2, #expr do check_expr(expr[i]) end
	end
	for _, join in ipairs(joins) do
		check_expr(join.on_expr)
		if inherits(join.right, Rel) then
			check_join_operators(join.right.joins or empty)
		end
	end
end

--[[
true if expr (references_outside()) or rel's own where()/join
conditions (rel_references_outside()) read a col whose source isn't in
own_sources -- an outer-scope correlation, from own_sources' point of
view. Used two ways: exists()/not_exists()'s own on_expr (own_sources
is just {[source.name] = source}, so anything else is outer), and
detecting whether a whole exists()/in_() occurrence is correlated at
all (own_sources is the table/sub-relation's full source set).
]]
local function found_outside(found, own_sources)
	for name, source in pairs(found) do
		if own_sources[name] ~= source then return true end
	end
	return false
end
local function references_outside(expr, own_sources)
	local found = {}
	referenced_sources(expr, found, nil, false)
	return found_outside(found, own_sources)
end
local function rel_references_outside(rel, own_sources)
	local found = {}
	referenced_rel_sources(rel, found, nil, false)
	return found_outside(found, own_sources)
end

--[[
- whether a left_join()'d source matched must depend only on its
  on_expr, never on a later where() -- a where() condition on such a
  source becomes a late condition, checked once against the finished
  row, not evaluated per-candidate during that source's scan, or an
  unmatched row that should null-extend would instead get silently
  dropped or wrongly kept.
- a left-joined join group null-extends all at once, so every source
  inside it counts as left-joined too, regardless of which join op
  connects sources *inside* the group.
- limitation: such a where() condition can never become a fact
  that choose_access() can use for an index seek, even when one exists on
  that col -- only a condition on the source's own on_expr still can.
  a fix that kept index use would need two separate scans, one to
  prove existence and one to narrow candidates, which this engine
  doesn't have.
]]
local function collect_left_joined_sources(joins, left_joined_sources)
	for _, join in ipairs(joins) do
		if inherits(join.right, Rel) then
			if join.op == 'left' then
				for _, source in ipairs(join.right.sources) do
					left_joined_sources[source.name] = true
				end
			else
				collect_left_joined_sources(join.right.joins, left_joined_sources)
			end
		elseif join.op == 'left' then
			left_joined_sources[join.right.name] = true
		end
	end
end

--decide which single source, if any, owns a condition: the one
--source that it reads, when that source isn't left-joined. a condition
--that reads more than one source, or none, or a left-joined source,
--can't be checked before every source has been scanned.
local function attribute_conditions(conditions, sources, left_joined_sources)
	for _, cond in ipairs(conditions) do
		local found = {} --{name->source}
		referenced_sources(cond.expr, found, sources, true)
		local n, only = 0, nil
		for name in pairs(found) do
			n = n + 1
			only = name
		end
		cond.source_name = (n == 1 and not left_joined_sources[only])
			and only or false
	end
end

--[[
- find the one operand that is this source's q.col().
- return the col name and the other operand.
- flipped=true means the col was on the right.
- bucket_facts() then flips the op's direction via flip_range_op.
]]
local function source_operand(source, left, right)
	local l_col = type(left) == 'table' and left[1] == 'col'
		and left.source == source
	local r_col = type(right) == 'table' and right[1] == 'col'
		and right.source == source
	if l_col and not r_col then return left[3], right, false end
	if r_col and not l_col then return right[3], left, true end
	return nil
end
--{op->flipped op}
local flip_range_op = {['<'] = '>', ['<='] = '>=', ['>'] = '<', ['>='] = '<='}

--[[
- pull facts out of access conditions that read only this source.
- supported facts: equality, range, prefix, null. membership (in_())
  is deliberately not one of them: no executor seeks a plan.kind='in'
  (scan only implements exact/range/prefix/eq_prefix/full), and
  the residual evaluator already checks list membership correctly, so
  a membership condition is left alone here and always stays residual.
- facts are bucketed by col.
- each col gets one fact per kind.
- a later condition for a (col,kind) slot that's already filled is
  left unconsumed, so it stays a residual check.
- keeping the first fact per (col,kind) picks an arbitrary but valid
  seek; it never changes query correctness.
]]
local function bucket_facts(source, conditions)
	--{col->{cond=,expr=[,op=]}}
	local eq, lo, hi, prefix, not_null = {}, {}, {}, {}, {}
	local not_equal, in_ = {}, {}
	for _, cond in ipairs(conditions) do
		if not cond.consumed then
			local expr = cond.expr
			if cond.kind == 'membership' then
				--a sub-relation's values need scanning to be known, so they
				--cannot drive a seek. a q.param() list can: Db:scan()'s
				--in_list term reads its length from the args on every reset.
				local left = expr[2]
				if expr[1] == 'in' and type(left) == 'table'
					and left[1] == 'col' and left.source == source
					and type(expr[3]) == 'table'
					and not inherits(expr[3], Rel)
				then
					local col = left[3]
					if not in_[col] then
						in_[col] = {cond = cond, expr = expr[3],
							list_param = expr[3][1] == 'param'}
					end
				end
			elseif cond.kind == 'equality' then
				local col, val = source_operand(source, expr[2], expr[3])
				if col and not eq[col] then
					eq[col] = {cond = cond, op = '=', expr = val}
				end
			elseif cond.kind == 'not_equal' then
				local col, val = source_operand(source, expr[2], expr[3])
				if col and not not_equal[col] then
					not_equal[col] = {cond = cond, expr = val}
				end
			elseif cond.kind == 'range' then
				local col, val, flipped = source_operand(source, expr[2], expr[3])
				if col then
					local rop = flipped and flip_range_op[expr[1]] or expr[1]
					local bucket = (rop == '>' or rop == '>=') and lo or hi
					if not bucket[col] then
						bucket[col] = {cond = cond, op = rop, expr = val}
					end
				end
			elseif cond.kind == 'prefix' then
				local left = expr[2]
				if type(left) == 'table' and left[1] == 'col'
					and left.source == source
				then
					if not prefix[left[3]] then
						prefix[left[3]] = {cond = cond, expr = expr[3]}
					end
				end
			elseif cond.kind == 'null' then
				local left = expr[2]
				if type(left) == 'table' and left[1] == 'col'
					and left.source == source
				then
					local col = left[3]
					local field = source.schema.fields[col]
					if expr[1] == 'is_null' then
						if not field.not_null and not eq[col] then
							eq[col] = {cond = cond, op = 'is', expr = null}
						end
					elseif field.not_null then
						--a not_null field cannot reject an existing row here.
						cond.consumed = true
					elseif not not_null[col] then
						not_null[col] = {cond = cond}
					end
				end
			end
		end
	end
	return eq, lo, hi, prefix, not_null, not_equal, in_
end

--path_seekable() rejects ai_ci fields stored as original base-key text.
local function path_seekable(schema, i)
	local field = schema.path_fields[i]
	return field.mdbx_collation ~= 'utf8_ai_ci'
		or schema.is_index and i <= #schema.key_fields
end

--eq_depth() counts leading path fields that '=' or 'is' can constrain.
local function eq_depth(schema, eq)
	local depth = 0
	for i, field in ipairs(schema.path_fields) do
		if eq[field.col] and path_seekable(schema, i) then
			depth = i
		else
			break
		end
	end
	return depth
end

--equality_kind() keeps exact for a complete encoded index key even when
--path_fields continues through its duplicate PK.
local function equality_kind(schema, depth)
	if depth == #schema.path_fields
		or schema.is_index and depth == #schema.key_fields
	then
		return 'exact'
	end
	return depth > 0 and 'eq_prefix' or 'full'
end

--path_coverage() counts each constrained col once when path_fields
--repeats it.
local function path_coverage(schema, depth, bound_col)
	local cols = {}
	local n = 0
	for i = 1, depth do
		local col = schema.path_fields[i].col
		if not cols[col] then cols[col] = true; n = n + 1 end
	end
	if bound_col and not cols[bound_col] then n = n + 1 end
	return n
end

--[[
try_key() fixes leading path fields with equality facts and then uses one
prefix, range, or is_not_null fact on the next field.
try_key() uses an ai_ci field for starts() only where path_seekable()
allows it: inside an index key, where encode_key_prefix() folds the bound
through the field's own encoder and the stored bytes are folded too.
]]
local function try_key(schema, eq, lo, hi, prefix, not_null, not_equal, in_)
	local fields = schema.path_fields
	local depth = eq_depth(schema, eq)
	local plan
	if depth == #fields then
		plan = {kind = 'exact', depth = depth}
	else
		local next_field = fields[depth + 1]
		local col = next_field.col
		if prefix[col] and path_seekable(schema, depth + 1) then
			plan = {kind = 'prefix', depth = depth, bound_col = col}
		elseif path_seekable(schema, depth + 1) and in_[col] then
			plan = {kind = 'in', depth = depth, bound_col = col}
		elseif path_seekable(schema, depth + 1)
			and (lo[col] or hi[col])
		then
			plan = {kind = 'range', depth = depth, bound_col = col}
		elseif path_seekable(schema, depth + 1) and not_equal[col] then
			plan = {kind = 'not_equal', depth = depth, bound_col = col}
		elseif path_seekable(schema, depth + 1) and not_null[col] then
			plan = {kind = 'range', depth = depth, bound_col = col}
		elseif depth > 0 then
			plan = {kind = equality_kind(schema, depth), depth = depth}
		end
	end
	if plan then
		plan.coverage = path_coverage(schema, depth, plan.bound_col)
	end
	return plan
end

--[[
- choose_access() ranks candidates by how many distinct path cols narrow
  the scan.
- scan() rejects rows by key bytes before any base-table read.
- choose_access() breaks a coverage tie by kind, ranked via kind_rank.
- choose_access() does not use row counts or index sizes.
]]
--{kind->tie-break rank}
local kind_rank = {
	exact = 2,
	range = 1,
	not_equal = 1,
	prefix = 1,
	['in'] = 1,
	eq_prefix = 0,
	full = -1,
}

--[[
- key_order() marks equality fields as fixed and returns the remaining
  path_fields in cursor order.
- key_order() stops before an ai_ci duplicate-PK field.
- key_order() removes repeated ordinary cols from the duplicate PK suffix.
- key_order() applies each field's stored direction and reverses every
  varying field when reverse is true.
]]
local function key_order(source, schema, depth, reverse)
	local order = {} --{{key=,fixed=true|dir=}...}
	local fields = schema.path_fields
	local cols = {}
	for i = 1, depth do
		local col = fields[i].col
		if not cols[col] then
			cols[col] = true
			add(order, {key = source.name..'.'..col, fixed = true})
		end
	end
	for i = depth + 1, #fields do
		if not path_seekable(schema, i) then break end
		local field = fields[i]
		local col = field.col
		if not cols[col] then
			cols[col] = true
			local dir = field.descending and 'desc' or 'asc'
			if reverse then dir = dir == 'desc' and 'asc' or 'desc' end
			add(order, {key = source.name..'.'..col, dir = dir})
		end
	end
	return order
end

--try_order_key() returns a forward or reverse plan when key_order()
--satisfies order_terms. try_order_key() uses equality facts for depth and
--coverage.
local function try_order_key(source, schema, eq, order_terms)
	if not order_terms then return end
	local depth = eq_depth(schema, eq)
	local kind = equality_kind(schema, depth)
	local coverage = path_coverage(schema, depth)
	if order_satisfied(order_terms, key_order(source, schema, depth)) then
		return {kind = kind, depth = depth, dir = 'asc', coverage = coverage}
	end
	--try_order_key() reverses only when path_fields has a varying field.
	if depth < #schema.path_fields
		and order_satisfied(order_terms, key_order(source, schema, depth, true))
	then
		return {kind = kind, depth = depth, dir = 'desc', coverage = coverage}
	end
end

--try_group_key() returns a forward plan when key_order() keeps group_terms
--consecutive. try_group_key() applies to group_by() with or without
--aggregates and to distinct().
local function try_group_key(source, schema, eq, group_terms)
	if not group_terms then return end
	local depth = eq_depth(schema, eq)
	local kind = equality_kind(schema, depth)
	if order_satisfied_set(group_terms, key_order(source, schema, depth)) then
		return {kind = kind, depth = depth, dir = 'asc',
			coverage = path_coverage(schema, depth)}
	end
end

--plan_is_one() is true when reset() can return at most one physical row.
local function plan_is_one(schema, plan)
	return plan.depth == #schema.path_fields
		or schema.is_unique and plan.depth >= #schema.key_fields
end

--[[
choose_access() examines the table PK and every index. choose_access() keeps
separate best paths for filtering, for order_by(), and for
group_by()/distinct().
choose_access() ranks each list by constrained cols and then by kind_rank.
choose_access() marks conditions used by the selected path and leaves the
other conditions as residual row checks.
]]
local function choose_access(source, conditions, order_terms, prefer_order,
	group_terms)
	--a rel source has no pk or index metadata: it reads the rows of its
	--already-compiled inner rel, so nothing here can seek it and every
	--condition on it stays residual.
	if source.rel then
		local residual = {} --{condition...}
		for _, cond in ipairs(conditions) do add(residual, cond) end
		return {kind = 'rel', member = source.name, depth = 0,
			rel = source.rel, lateral = source.lateral, residual = residual}
	end
	--virtual tables have no pk or index metadata either, and no scan node
	--yet (compile_step()'s scan needs a real schema) -- reject here rather
	--than let compile_step crash deep inside scan() on a false schema.
	if not source.table or source.schema.virtual then
		assertf(false, 'choose_access: %s: a virtual source is not'
			..' implemented yet', source.name)
	end
	local eq, lo, hi, prefix, not_null, not_equal, in_ =
		bucket_facts(source, conditions)
	local candidates = {} --{{schema=}...}
	add(candidates, {schema = source.schema})
	for _, ix in ipairs(source.schema.indexes or empty) do
		add(candidates, {schema = ix})
	end
	local best_cand, best_plan, best_cov
	local order_cand, order_plan
	local group_cand, group_plan
	for _, cand in ipairs(candidates) do
		local plan = try_key(cand.schema, eq, lo, hi, prefix, not_null,
			not_equal, in_)
		if plan then
			local cov = plan.coverage
			if not best_plan or cov > best_cov
				or (cov == best_cov
					and kind_rank[plan.kind] > kind_rank[best_plan.kind]) then
				best_cand, best_plan, best_cov = cand, plan, cov
			end
		end
		plan = try_order_key(source, cand.schema, eq, order_terms)
		if plan and (not order_plan
			or plan.coverage > order_plan.coverage
			or (plan.coverage == order_plan.coverage
				and kind_rank[plan.kind] > kind_rank[order_plan.kind]))
		then
			order_cand, order_plan = cand, plan
		end
		plan = try_group_key(source, cand.schema, eq, group_terms)
		if plan and (not group_plan
			or plan.coverage > group_plan.coverage
			or (plan.coverage == group_plan.coverage
				and kind_rank[plan.kind] > kind_rank[group_plan.kind]))
		then
			group_cand, group_plan = cand, plan
		end
	end
	--choose_access() takes order_plan without extra rows when its coverage
	--matches best_plan. With limit(), it may give up coverage to stop early.
	--choose_access() keeps best_plan when it returns at most one row.
	local best_is_one = best_plan and plan_is_one(best_cand.schema, best_plan)
	if order_plan and (not best_plan
		or (not best_is_one and order_plan.coverage >= best_cov)
		or (prefer_order and not best_is_one)) then
		best_cand, best_plan = order_cand, order_plan
	--choose_access() receives either order_terms or group_terms. Grouping and
	--dedup read every row, so group_terms has no prefer_order counterpart.
	elseif group_plan and (not best_plan
		or (not best_is_one and group_plan.coverage >= best_cov)) then
		best_cand, best_plan = group_cand, group_plan
	end
	if not best_plan then
		best_cand, best_plan =
			{schema = source.schema}, {kind = 'full', depth = 0}
	end
	best_plan.schema = best_cand.schema
	best_plan.member = source.name --scan()'s alias arg; see its doc
	best_plan.dir = best_plan.dir or 'asc' --order_plan may already carry 'desc'
	local path_fields = best_cand.schema.path_fields
	local seek = {} --{{cond=,op=,expr=}...}
	for i = 1, best_plan.depth do
		local col = path_fields[i].col
		local fact = eq[col]
		seek[i] = fact
		fact.cond.consumed = true
		local not_null_fact = not_null[col]
		if fact.op == '=' and not_null_fact then
			not_null_fact.cond.consumed = true
		end
	end
	best_plan.seek = seek
	if best_plan.kind == 'range' then
		local lo_fact, hi_fact = lo[best_plan.bound_col], hi[best_plan.bound_col]
		if lo_fact then
			best_plan.lo = {op = lo_fact.op, expr = lo_fact.expr}
			lo_fact.cond.consumed = true
		end
		if hi_fact then
			best_plan.hi = {op = hi_fact.op, expr = hi_fact.expr}
			hi_fact.cond.consumed = true
		end
		local not_null_fact = not_null[best_plan.bound_col]
		if not_null_fact then
			if not lo_fact and not hi_fact then best_plan.is_not_null = true end
			not_null_fact.cond.consumed = true
		end
	elseif best_plan.kind == 'prefix' then
		local fact = prefix[best_plan.bound_col]
		best_plan.prefix = fact.expr
		fact.cond.consumed = true
		local not_null_fact = not_null[best_plan.bound_col]
		if not_null_fact then not_null_fact.cond.consumed = true end
	elseif best_plan.kind == 'not_equal' then
		local fact = not_equal[best_plan.bound_col]
		best_plan.not_equal = fact.expr
		fact.cond.consumed = true
		local not_null_fact = not_null[best_plan.bound_col]
		if not_null_fact then not_null_fact.cond.consumed = true end
	elseif best_plan.kind == 'in' then
		local fact = in_[best_plan.bound_col]
		best_plan.in_values = fact.expr
		best_plan.in_list_param = fact.list_param
		fact.cond.consumed = true
	end
	local residual = {} --{condition...}
	for _, cond in ipairs(conditions) do
		if not cond.consumed then
			add(residual, cond)
		end
	end
	best_plan.residual = residual
	return best_plan
end

--[[
- returns the conditions that may drive source's own access: the
  join's own on_expr conditions plus any where() condition that reads
  only this source; join_deps() schedules on_expr inputs before this
  source scans.
- a where() on a left-joined source is never in here: attribute_conditions()
  already gives it source_name = false (checked once every source has
  scanned, via rel.late_conditions), since whether such a source
  matched must depend only on its own on_expr. a where() on an
  inner-joined source has no such restriction -- if it rejected the
  row, an inner join drops the row anyway, so it's as key-eligible as
  the join's own on_expr.
]]
local function access_conditions(source, join, where_conditions)
	local list = {} --{condition...}
	if join then
		for _, cond in ipairs(join.on_conditions) do add(list, cond) end
	end
	for _, cond in ipairs(where_conditions) do
		if cond.source_name == source.name then add(list, cond) end
	end
	return list
end

--[[
- natural_order is the driving source order guaranteed by its access
  plan.
- leading cols fixed by equality don't vary across the scan.
- remaining key cols follow cursor order.
- a backward-scanned plan (plan.dir == 'desc') reverses that cursor
  order.
- joined sources do not contribute global order.
- group_by(), distinct(), and order_by() check this one fact.
]]
local function natural_order(step)
	local plan = step.plan
	--rel source: no guaranteed key order.
	if not plan.schema then return empty end
	if plan.kind == 'not_equal' then return empty end
	return key_order(step.source, plan.schema, plan.depth,
		plan.dir == 'desc')
end

--SCHEDULE JOINS -------------------------------------------------------------

--a join can run after every outside source that its on_expr reads is
--scheduled. the join's own right source does not count as a
--dependency. a join group's internal sources do not count as
--outside dependencies.
local function join_deps(join, sources)
	local found = {} --{name->true}
	referenced_sources(join.on_expr, found, sources)
	if inherits(join.right, Rel) then
		for _, source in ipairs(join.right.sources) do
			found[source.name] = nil
		end
	else
		found[join.right.name] = nil
	end
	return found
end

--[[
- pick the next join to schedule: only one whose on_expr reads no
  source that isn't scheduled yet. among ties, keep the order that joins
  were declared in.
- this only looks at on_expr's col references, never at what's
  actually stored in any table.
- for an inner or cross join, recurse into the join group's own
  joins, scheduling them into this same list.
- schedule a left join's join group as one nested unit instead: it
  and everything joined onto it inside that group either all match
  together, or all null-extend together, never split apart.
- joins[1] is always the from() target of whichever joins list this
  runs on, already scheduled by the caller, so scanning starts at
  joins[2].
]]
local function build_access(joins, scheduled, access, sources,
	where_conditions)
	local pending = {} --{join...}
	for i = 2, #joins do
		add(pending, joins[i])
	end
	while pending[1] do
		local picked, picked_i
		for i, join in ipairs(pending) do
			local deps = join_deps(join, sources)
			local ready = true
			for name in pairs(deps) do
				if not scheduled[name] then ready = false; break end
			end
			if ready then picked, picked_i = join, i; break end
		end
		assertf(picked, 'source step cycle: on_expr reads form a cycle'
			..' across join()/left_join() steps')
		remove(pending, picked_i)
		if inherits(picked.right, Rel) then
			local group = picked.right
			local base_source = group.joins[1].right
			if picked.op ~= 'left' then
				local conditions = access_conditions(base_source, picked,
					where_conditions)
				--build_access() adds an inner group's base like a plain joined
				--source instead of using compile_nested().
				add(access, {source = base_source, join = picked,
					plan = choose_access(base_source, conditions)})
				scheduled[base_source.name] = true
				build_access(group.joins, scheduled, access, sources,
					where_conditions)
			else
				local group_left_joined_sources = {}
				collect_left_joined_sources(group.joins,
					group_left_joined_sources)
				--attribute_conditions() keeps source-local conditions on their
				--internal scan; left_join() checks the rest on the group.
				attribute_conditions(picked.on_conditions, group.sources,
					group_left_joined_sources)
				local match_conditions = {} --{condition...}
				for _, cond in ipairs(picked.on_conditions) do
					if cond.source_name
						and cond.source_name ~= base_source.name
					then
						local found = {}
						referenced_sources(cond.expr, found, sources, true)
						if found_outside(found, group.sources) then
							cond.source_name = false
						end
					end
					if not cond.source_name then add(match_conditions, cond) end
				end
				local group_conditions = extend({}, where_conditions,
					picked.on_conditions)
				local conditions = access_conditions(base_source, nil,
					group_conditions)
				local base_plan = choose_access(base_source, conditions)
				local base_residual = {} --{condition...}
				--left_join() checks base residuals that read an outer source.
				for _, cond in ipairs(base_plan.residual) do
					local found = {}
					referenced_sources(cond.expr, found, sources, true)
					if found_outside(found, group.sources) then
						add(match_conditions, cond)
					else
						add(base_residual, cond)
					end
				end
				base_plan.residual = base_residual
				local base_step = {source = base_source, join = false,
					plan = base_plan}
				local nested_scheduled = {[base_source.name] = true}
				local nested = {base_step} --{step...}
				build_access(group.joins, nested_scheduled, nested, sources,
					group_conditions)
				add(access, {source = false, join = picked, nested = nested,
					match_conditions = match_conditions})
			end
		else
			local conditions = access_conditions(picked.right, picked,
				where_conditions)
			add(access, {source = picked.right, join = picked,
				plan = choose_access(picked.right, conditions)})
			scheduled[picked.right.name] = true
		end
	end
end

--CLASSIFY EXISTS TARGETS -----------------------------------------------------

--[[
walk expr looking for exists()/not_exists()/in_()/not_in() occurrences,
calling visit(expr) at each one found -- an in_()/not_in() occurrence
only when its value is a sub-relation (a literal/param list has no
occurrence to visit, see eval_expr()). Shared by classify_exists_targets()
(compile()-time: plans/classifies each occurrence) and
compile_residual_checkers() (once per attachment site: builds each
occurrence's live checker) -- same traversal either way: recurses into
on_expr and in_()'s own tested value expr, since one of these can nest
another exists()/in_() inside it, but never into a sub-relation's own
structure, which is a separate correlation boundary resolved on its own.
]]
local function walk_exists_nodes(expr, visit)
	if type(expr) ~= 'table' then return end
	local op = expr[1]
	if op == 'exists' or op == 'not_exists' then
		visit(expr)
		if expr[3] then walk_exists_nodes(expr[3], visit) end
	elseif op == 'in' or op == 'not_in' then
		if inherits(expr[3], Rel) then visit(expr) end
		walk_exists_nodes(expr[2], visit)
	else
		for i = 2, #expr do
			walk_exists_nodes(expr[i], visit)
		end
	end
end

--[[
classify every exists()/not_exists()/in_()/not_in() occurrence that
this rel's own residual/late/having checks can reach -- a plain table
or a whole sub-relation -- once, here, instead of on every terminal
call.
- a table-source occurrence gets its own seek plan (resolve_exists_plan()),
  stored as expr.plan; a sub-relation occurrence has none of its own
  (compile(right, scope), already run at bind time, planned its own
  access chain the normal way).
- either way, expr.correlated records whether the occurrence reads
  anything outside its own source(s) at all -- if not, its result
  never depends on the outer row, so it can be checked once instead of
  once per row.
]]
local function classify_exists_targets(expr)
	walk_exists_nodes(expr, function(e)
		if e[1] == 'exists' or e[1] == 'not_exists' then
			local right = e[2]
			if inherits(right, Rel) then
				e.correlated = rel_references_outside(right, right.sources)
			else
				e.plan, e.correlated = resolve_exists_plan(right, e[3])
			end
		else --in()/not_in(), always a sub-relation (see walk_exists_nodes())
			local values = e[3]
			e.correlated = rel_references_outside(values, values.sources)
		end
	end)
end
local function classify_step_exists(step)
	if step.nested then
		for _, s in ipairs(step.nested) do
			classify_step_exists(s)
		end
		for _, cond in ipairs(step.match_conditions) do
			classify_exists_targets(cond.expr)
		end
	else
		for _, cond in ipairs(step.plan.residual) do
			classify_exists_targets(cond.expr)
		end
	end
end

--COMPILE DRIVER -------------------------------------------------------------

--[[local]] function compile(rel, parent_scope)
	assert(not rel.compiled)
	rel.compiled = true

	--RESOLVE SOURCES ---------------------------------------------------------

	--the scope exists before its sources are resolved so that a lateral
	--join's rel compiles against the sources already added to it.
	local scope = { --kept in rel because it's used by correlated subqueries.
		db = rel.db,
		sources = {},
		parent = parent_scope,
	}
	rel.scope = scope

	local sources, union_out_cols
	if rel.set_op then
		--can't call db:from()/join() on a set-op rel.
		assertf(not rel.joins, '%s does not allow joins', rel.set_op)
		for _, input in ipairs(rel.set_rels) do
			compile(input, parent_scope)
			assertf(input.out_cols,
				'%s input requires select() or group_by()', rel.set_op)
			if union_out_cols then
				assertf(same_out_cols(union_out_cols, input.out_cols),
					'%s inputs must return the same cols', rel.set_op)
			else
				union_out_cols = input.out_cols
			end
		end
		sources = scope.sources
		rel.sources = sources
	else
		sources = resolve_sources(rel, scope)
	end

	--RESOLVE OUTPUT COLUMNS --------------------------------------------------

	rel.group_cols = resolve_out_cols(rel.group_cols)
	rel.select_cols = resolve_out_cols(rel.select_cols)
	rel.out_cols = rel.select_cols or rel.group_cols or union_out_cols
	rel.distinct_cols = resolve_distinct(rel.distinct_cols, rel.out_cols)

	--BUILD SCOPES ------------------------------------------------------------

	scope.cols = union_out_cols
	local group_scope
	if rel.group_cols then
		--new scope: binding after group_by() can only reach the grouped
		--cols, not the ungrouped table columns.
		group_scope = {
			db = rel.db,
			sources = {},
			cols = rel.group_cols,
			parent = parent_scope,
		}
	end

	--BIND COLUMNS ------------------------------------------------------------

	--a union has no sources: its group cols name its inputs' out cols.
	local group_bind_mode = union_out_cols and 'out_col' or nil
	for _, expr in ipairs(rel.group_cols or empty) do
		bind_expr(expr, rel.scope, union_out_cols, group_bind_mode, true)
	end
	for _, expr in ipairs(rel.select_cols or empty) do
		if rel.group_cols then
			bind_expr(expr, group_scope, rel.group_cols, 'out_col')
		else
			bind_expr(expr, rel.scope)
		end
	end
	assert(not rel.havings or rel.group_cols, 'having() requires group_by()')
	for _, expr in ipairs(rel.havings or empty) do
		bind_expr(expr, group_scope, rel.group_cols, 'out_col')
	end

	local order_mode = (rel.group_cols or rel.distinct_cols)
		and 'out_col' or 'out_col_or_source'
	local order_scope = rel.group_cols and group_scope or rel.scope
	for _, expr in ipairs(rel.order_cols or empty) do
		bind_expr(expr, order_scope, rel.out_cols, order_mode)
	end

	bind_joins(rel.joins or empty, rel.scope, sources)
	check_join_operators(rel.joins or empty)
	for _, expr in ipairs(rel.wheres or empty) do
		bind_expr(expr, rel.scope)
	end

	--SPLIT CONDITIONS --------------------------------------------------------

	rel.where_conditions = split_conditions(rel.wheres or empty, true)
	rel.having_conditions = split_conditions(rel.havings or empty, false)
	split_join_conditions(rel.joins or empty)

	--ATTRIBUTE CONDITIONS ----------------------------------------------------

	local left_joined_sources = {} --{name->true}
	collect_left_joined_sources(rel.joins or empty, left_joined_sources)
	attribute_conditions(rel.where_conditions, sources, left_joined_sources)
	--when attribute_conditions can't attribute a condition to one source,
	--check it only after every source has been scanned, not before.
	local late_conditions = {} --{condition...}
	for _, cond in ipairs(rel.where_conditions) do
		if cond.source_name == false then add(late_conditions, cond) end
	end
	rel.late_conditions = late_conditions

	--BUILD ACCESS ------------------------------------------------------------

	local source_order_terms = base_order_terms(rel)
	local prefer_order = source_order_terms and rel._limit ~= nil
	local source_group_terms = group_key_terms(rel)

	if not rel.set_op then
		local base_source = rel.joins[1].right
		local access = {} --{{source=,join=|false,plan=|nested=}...}
		rel.access = access
		local base_conditions =
			access_conditions(base_source, false, rel.where_conditions)
		add(access, {source = base_source, join = false,
			plan = choose_access(base_source, base_conditions,
				source_order_terms, prefer_order, source_group_terms)})
		build_access(rel.joins, {[base_source.name] = true}, access, sources,
			rel.where_conditions)
		rel.natural_order = natural_order(access[1])
	end

	--SORT AND DEDUP ----------------------------------------------------------

	--[[
	- whether an explicit sort is needed, or a group/distinct can stream
	  instead of hash, is fully decided by what's already been set above
	  (order_cols, natural_order, group_cols, distinct_cols) -- decide it
	  once here, instead of recomputing it on every execution.
	]]
	rel.sort_needed = sort_actually_needed(rel)
	if rel.set_op then
		rel.distinct_streaming = false
	else
		rel.distinct_streaming = distinct_actually_streamable(rel)
	end
	rel.group_streaming = group_actually_streamable(rel)

	--COMPILE OUTPUT PIPELINE -------------------------------------------------

	--[[
	the output/group/distinct/sort descriptors below are fully decided
	by rel's own bound out_cols/group_cols/distinct_cols/order_cols,
	never by params -- built once here instead of on every terminal
	call (compile_terminal()/compile_group() used to rebuild all of
	this on every rows()/first()/exists() call against the same rel).
	]]
	if rel.out_cols and not rel.group_cols then
		local outputs = {}
		for i, out_col in ipairs(rel.out_cols) do
			assert(out_col[1] == 'col' and out_col.source,
				'select(): only plain column outputs are implemented yet')
			outputs[i] = {name = out_col.name, member = out_col.source.name,
				col = out_col[3]}
		end
		rel.output_descriptor = outputs
	end
	if rel.group_cols then
		rel.group_key_cols, rel.group_full_agg = split_group_cols(rel)
		local key_cols, full_agg = rel.group_key_cols, rel.group_full_agg
		if #key_cols > 0 then
			if rel.group_streaming then
				local cols = {}
				for i, kc in ipairs(key_cols) do
					cols[i] = {member = kc.member, col = kc.col}
				end
				rel.group_stream_cols = cols
			end
		end
	end
	if rel.distinct_cols then
		local cols = {}
		for i, c in ipairs(dedup_key_cols(rel)) do
			cols[i] = {name = c.name, member = c.source and c.source.name,
				col = c.source and c[3]}
		end
		rel.distinct_key_cols = cols
	end
	if rel.sort_needed then
		local spec = {}
		for i, term in ipairs(rel.order_cols) do
			spec[i] = term.source
				and {member = term.source.name, col = term[3],
					desc = term.dir == 'desc'}
				or {field = term.col.name, desc = term.dir == 'desc'}
		end
		rel.sort_spec = spec
	end

	--CLASSIFY EXISTS TARGETS --------------------------------------------------

	for _, step in ipairs(rel.access or empty) do
		classify_step_exists(step)
	end
	for _, cond in ipairs(late_conditions) do
		classify_exists_targets(cond.expr)
	end
	for _, cond in ipairs(rel.having_conditions) do
		classify_exists_targets(cond.expr)
	end

	--TODO: once terminals exist, compile() needs a terminal_kind param
	--and an assert here that rows()/first()/one()/must_one() require
	--select() or group_by() (rel.out_cols) -- old file's needs_output
	--check.
end

function Rel:prepare()
	compile(self)
	return self
end

--each step's {table,key,order,reverse} matches scan's own
--scan.explain() exactly: both read plan.schema/plan.depth/plan.dir
--through the same mdbx_scan_order(), no scanner ever built here.
local explain_rel --fw. decl.

local function explain_steps(access, into)
	for _, step in ipairs(access) do
		if step.nested then
			explain_steps(step.nested, into)
		elseif step.plan.kind == 'rel' then
			local steps = {}
			explain_rel(step.plan.rel, steps)
			add(into, {source = step.source.name, rel = steps})
		else
			local plan = step.plan
			local schema = plan.schema
			local reverse = plan.dir == 'desc'
			add(into, {
				source = step.source.name,
				table = schema.val_schema and schema.val_schema.name or schema.name,
				key = schema.name,
				order = mdbx_scan_order(schema, plan.depth, reverse),
				reverse = reverse,
			})
		end
	end
end

--a set-op rel has no access plan of its own, so it contributes one step
--holding its inputs' steps, one list per input in input order. except()
--and intersect() are not symmetric, so which input is which matters.
function explain_rel(rel, into)
	if rel.set_op then
		local inputs = {}
		for i, input in ipairs(rel.set_rels) do
			inputs[i] = {}
			explain_rel(input, inputs[i])
		end
		add(into, {set_op = rel.set_op, inputs = inputs})
	else
		explain_steps(rel.access, into)
	end
end

function Rel:explain()
	if not self.compiled then compile(self) end
	local steps = {}
	explain_rel(self, steps)
	return steps
end

--EXECUTOR -------------------------------------------------------------------

local compile_terminal --fw. decl.

--[[
compile_scan_param() maps one bound-value expr to a scan param.
compile_scan_param() maps q.param() to {arg=} and maps a literal to
{value=}. When registry contains a q.col() source backed by a plain
scan, compile_scan_param() returns {scan=,col=}; Db:scan()
can reuse the source's encoded bytes when the layouts match. A not_equal()/
in_() source is a union of scans, not one physical record, so it has no
raw bytes to reuse -- compile_scan_param() reads it through col_decoder()
same as when registry does not contain the source at all.
pass want_value for a param the scan must read as a Lua value: an in_()
list item, which Db:scan() sorts and dedupes before seeking anything.
]]
local function compile_scan_param(expr, outer_node, registry, want_value)
	local op = type(expr) == 'table' and expr[1]
	if op == 'param' then
		return {arg = expr[2]}
	elseif op == 'col' then
		assert(expr.source)
		local scan = registry and registry[expr.source.name]
		if scan and scan.table and not want_value then
			return {scan = scan, col = expr[3]}
		end
		if scan then
			return {get = scan:col_decoder(expr.source.name, expr[3])}
		end
		assert(outer_node, 'compile_scan_param: a q.col() bound value is only'
			..' valid inside a sub-relation or a joined scan')
		return {get = outer_node:col_decoder(expr.source.name, expr[3])}
	end
	return {value = expr}
end

--[[
compile_scan_path() turns one choose_access() plan into a scan
path: one {col,'='|'is',param} term per leading key col
(plan.schema.path_fields[i]), then one range/prefix/is_not_null or dir-only
term. Db:scan() needs one `dir` term to set the whole scan's
direction. compile_scan_path() passes outer_node to compile_scan_param().
the caller passes nil at the top level and passes the outer node for a
sub-relation. compile_scan_param() uses registry to find each joined
member's scanner.
]]
local function compile_scan_path(plan, outer_node, registry)
	local fields = plan.schema.path_fields
	local path = {}
	for i = 1, plan.depth do
		local fact = plan.seek[i]
		path[i] = {fields[i].col, fact.op,
			compile_scan_param(fact.expr, outer_node, registry)}
	end
	--plan.dir is which way the cursor runs; a path term's dir is which way
	--its own col's values go, and for a desc-stored col those are opposite.
	local bound_field = fields[plan.depth + 1]
	local dir = plan.dir
	if dir and bound_field and bound_field.descending then
		dir = dir == 'asc' and 'desc' or 'asc'
	end
	if plan.kind == 'range' then
		local term = {plan.bound_col}
		if plan.is_not_null then
			term[2] = 'is_not_null'
		elseif plan.lo and plan.hi then
			term[2] = 'range'
			term[3] = plan.lo.op
			term[4] = compile_scan_param(plan.lo.expr, outer_node, registry)
			term[5] = plan.hi.op
			term[6] = compile_scan_param(plan.hi.expr, outer_node, registry)
		elseif plan.lo then
			term[2] = plan.lo.op
			term[3] = compile_scan_param(plan.lo.expr, outer_node, registry)
		else
			term[2] = plan.hi.op
			term[3] = compile_scan_param(plan.hi.expr, outer_node, registry)
		end
		term.dir = dir
		path[#path + 1] = term
	elseif plan.kind == 'not_equal' then
		path[#path + 1] = {plan.bound_col, '~=',
			compile_scan_param(plan.not_equal, outer_node, registry),
			dir = dir}
	elseif plan.kind == 'in' then
		if plan.in_list_param then
			--one arg holds every value: an in_list term, whose length
			--Db:scan() reads on every reset.
			path[#path + 1] = {plan.bound_col, 'in_list',
				compile_scan_param(plan.in_values, outer_node, registry),
				dir = dir}
		else
			local params = {}
			for i, value in ipairs(plan.in_values) do
				params[i] = compile_scan_param(value, outer_node, registry, true)
			end
			path[#path + 1] = {plan.bound_col, 'in', params, dir = dir}
		end
	elseif plan.kind == 'prefix' then
		path[#path + 1] = {plan.bound_col, 'starts',
			compile_scan_param(plan.prefix, outer_node, registry),
			dir = dir}
	elseif plan.dir and plan.depth < #fields then
		path[#path + 1] = {fields[plan.depth + 1].col, dir = dir}
	end
	return path
end

--Db:scan() walks a ~= term as two disjoint sub-ranges and an in_() term
--as one per value, all on one cursor, so both are a single scan here.
--Db:scan() also sorts an in_() list into the bound col's own cursor
--order and drops nulls and repeats, comparing by the col's collated
--form, so it seeks once for two spellings that collate alike or two
--params that resolve to the same value.
local function compile_table_scan(db, plan, outer_node, registry, buffered)
	if plan.kind == 'rel' then
		--a lateral rel reads the outer row, so it re-runs per outer row
		--instead of keeping the one result its non-lateral form would.
		local child = compile_terminal(db, plan.rel,
			plan.lateral and outer_node or nil)
		local scan
		if buffered and not plan.lateral then
			scan = child:materialized_scan(plan.member)
		else
			scan = child:streamed_scan(plan.member)
		end
		return scan, scan
	end
	local scan = db:scan(plan.schema.name,
		compile_scan_path(plan, outer_node, registry), plan.member)
	return scan, scan
end

--EVALUATE RESIDUAL CONDITIONS -----------------------------------------------

--where()/having() treat only false, nil, and null as rejection.
local function expr_passes(v)
	return v ~= nil and v ~= false and v ~= null
end
local function null_value(v)
	return v == nil or v == null
end
local function operand_ai_ci(cache, x)
	local d = cache[x]
	if d == nil then return false end
	return d.ai_ci == true
end
--compare same-kind decoded values in key order: numbers numerically,
--utf8 by byte order.
local function value_cmp(a, b)
	if a == b then return 0 end
	return a < b and -1 or 1
end
--[[
- read a value operand for a residual or having() check.
- literals return themselves.
- q.param() reads scan.args.
- q.col() reads cache[x].get(), which compile_col_decoders() built from
  node:col_decoder() ahead of the first next(). the reader returns
  the comparison form, so an indexed ai_ci col comes straight from the
  index key.
]]
local function eval_value(x, scan, cache)
	if type(x) ~= 'table' then return x end
	if x[1] == 'param' then
		local name = x[2]
		local args = scan.args
		assertf(args and args[name] ~= nil, 'missing arg: %s', name)
		return args[name]
	end
	if x[1] == 'col' then
		return cache[x].get()
	end
	error('unsupported residual operand: '..tostring(x[1]))
end
--does candidate match v? null never matches, in_()/not_in() alike -- v
--is already collated (see eval_expr()'s in/not_in case), and a null
--candidate collates to itself, which v (never null) can't equal.
local function candidate_matches(candidate, v, fold)
	return v == mdbx_collate_value(candidate, fold)
end
local function cmp_value(cache, x, v, fold)
	if not fold or v == nil or v == null then return v end
	if type(x) == 'table' and x[1] == 'col' then
		if operand_ai_ci(cache, x) then return v end
		return mdbx_collate_value(v, true)
	end
	local memo = cache[x]
	if memo and memo[1] == v then return memo[2] end
	local fv = mdbx_collate_value(v, true)
	cache[x] = {v, fv}
	return fv
end
--[[
evaluate a where()/on_expr row check against the current row. q.col()
reads decoded columns through node:col_decoder(), cached -- node is
the same object apply_residual()/apply_having() call node:filter()
on. compile_residual_checkers()/compile_exists_checker() fill checks:
{exists()/in_() expr -> checker} the first time each attachment site
processes its own condition list -- exists()/
not_exists() and in_()/not_in() both look their checker up by the
exists()/in_() expr node itself (not by source: the same source can
appear in more than one occurrence).
]]
local function eval_expr(expr, scan, checks, cache)
	if type(expr) ~= 'table' then return expr end
	local op, a, b = expr[1], expr[2], expr[3]
	if op == 'param' or op == 'col' then
		return eval_value(expr, scan, cache)
	end
	if op == 'and' then
		for i = 2, #expr do
			if not expr_passes(eval_expr(expr[i], scan, checks, cache)) then
				return false
			end
		end
		return true
	elseif op == 'or' then
		for i = 2, #expr do
			if expr_passes(eval_expr(expr[i], scan, checks, cache)) then
				return true
			end
		end
		return false
	elseif op == 'is_null' then
		return null_value(eval_expr(a, scan, checks, cache))
	elseif op == 'is_not_null' then
		return not null_value(eval_expr(a, scan, checks, cache))
	elseif op == 'starts' then
		local v = eval_expr(a, scan, checks, cache)
		local prefix = eval_expr(b, scan, checks, cache)
		if null_value(v) or null_value(prefix) then return false end
		if type(v) ~= 'string' then return false end
		local fold = operand_ai_ci(cache, a)
		v = cmp_value(cache, a, v, fold)
		prefix = cmp_value(cache, b, prefix, fold)
		return v:sub(1, #prefix) == prefix
	elseif op == 'in' or op == 'not_in' then
		local check
		local ai_ci = operand_ai_ci(cache, a)
		if inherits(b, Rel) then
			check = assertf(checks[expr],
				'eval_expr: in_() check not compiled for source: %s',
				tostring(b.name))
			ai_ci = ai_ci or check.ai_ci
		end
		local v = eval_expr(a, scan, checks, cache)
		if null_value(v) then return false end
		v = cmp_value(cache, a, v, ai_ci)
		local found = false
		if check then
			if check.values_set then
				--reset_check() stores the same comparison values that
				--cmp_value() produces above, so lookup needs no value loop.
				found = check.values_set[v] ~= nil
			else
				for _, candidate in check.values() do
					if v == candidate then
						found = true
						break
					end
				end
			end
		elseif cache[expr] then
			--compile_col_decoders() stores each literal in the same
			--comparison form that cmp_value() produces above.
			found = cache[expr][v] ~= nil
		else
			local param_list = type(b) == 'table' and b[1] == 'param'
			local values = param_list and eval_expr(b, scan, checks, cache)
				or b
			for _, item in ipairs(values) do
				local candidate = param_list and item
					or eval_expr(item, scan, checks, cache)
				if candidate_matches(candidate, v, ai_ci) then
					found = true
					break
				end
			end
		end
		if op == 'in' then return found end
		return not found
	elseif op == 'exists' or op == 'not_exists' then
		local check = assertf(checks[expr],
			'eval_expr: exists() check not compiled for source: %s',
			tostring(a.name))
		local found = check.constant
		if found == nil then found = check.check_exists() end
		if op == 'exists' then return found end
		return not found
	end
	local va = eval_expr(a, scan, checks, cache)
	local vb = eval_expr(b, scan, checks, cache)
	if null_value(va) or null_value(vb) then return false end
	local fold = operand_ai_ci(cache, a) or operand_ai_ci(cache, b)
	va = cmp_value(cache, a, va, fold)
	vb = cmp_value(cache, b, vb, fold)
	if op == '=' then return va == vb
	elseif op == '~=' then return va ~= vb
	elseif op == '<' then return value_cmp(va, vb) < 0
	elseif op == '<=' then return value_cmp(va, vb) <= 0
	elseif op == '>' then return value_cmp(va, vb) > 0
	elseif op == '>=' then return value_cmp(va, vb) >= 0
	else error('unsupported condition op: '..tostring(op)) end
end
--evaluate a where()/on_expr row check against the current row.
local function eval_residual(expr, scan, checks, cache)
	return expr_passes(eval_expr(expr, scan, checks, cache))
end

--TODO(predicate compilation): eval_expr/eval_value (past their exists()/
--in_() cases, now compiled once per attachment site below) still
--re-walk cond.expr's raw AST and re-dispatch on op for every row.

local apply_residual --fw. decl.
local compile_exists_checker --fw. decl.

--[[
compile_exists_checker() compiles every exists()/not_exists()/in_()/not_in()
occurrence in expr and binds correlated reads to node. apply_residual()
calls it once per condition list before building the per-row predicate,
so eval_expr() only looks up an already-compiled checker in checks.
]]
local function compile_residual_checkers(db, expr, node, checks, registry,
		outer_cache)
	walk_exists_nodes(expr, function(e)
		compile_exists_checker(db, e, node, checks, registry, outer_cache)
	end)
end

--[[
builds and caches node:col_decoder() for every q.col() operand in expr,
the same way compile_residual_checkers() above pre-builds exists()/in_()
checkers -- once per attachment site, before the per-row predicate
closure runs, into the same cache eval_value() reads. Without this,
eval_value()'s own cache[x] check builds the decoder lazily, on
whichever row happens to evaluate this operand first; a scan
whose col_decoder() needs a base-table lookup only decides to fetch it
on next(), which already ran for that row by the time eval_value()
gets to it -- see mdbx_scan.lua's scan()/need_base().
]]
local function decoder_node_for(name, node, registry, outer_node)
	local scan = registry and registry[name]
	if scan then return scan end
	if node.member_scans and node.member_scans[name] then return node end
	return outer_node or node
end

local function compile_col_decoders(expr, node, cache, registry, outer_node)
	if type(expr) ~= 'table' then return end
	local op = expr[1]
	if op == 'col' then
		if not cache[expr] then
			local get, ai_ci
			if expr.source then
				local decoder_node = decoder_node_for(expr.source.name, node,
					registry, outer_node)
				get, ai_ci = decoder_node:col_decoder(expr.source.name, expr[3], true)
			else
				get, ai_ci = node:col_decoder(expr.col.name, true)
			end
			cache[expr] = {get = get, ai_ci = ai_ci}
		end
	elseif op == 'exists' or op == 'not_exists' then
		--expr[3] is the correlated sub-relation's own filter, checked
		--against its own node by compile_exists_checker() -- not node's.
	elseif op == 'in' or op == 'not_in' then
		--a sub-relation in expr[3] is never node's to read; a value list
		--in expr[3] can hold q.col() items, which are.
		compile_col_decoders(expr[2], node, cache, registry, outer_node)
		--a plain literal list (not a q.param() list, whose values aren't
		--known until reset(args)) gets a hash set here instead of the
		--per-row linear scan eval_expr() would otherwise do.
		local values = expr[3]
		if type(values) == 'table' and not inherits(values, Rel)
			and values[1] ~= 'param'
		then
			local all_literal = true
			for i = 1, #values do
				if type(values[i]) == 'table' then all_literal = false; break end
			end
			if all_literal then
				local fold = operand_ai_ci(cache, expr[2])
				local set = {}
				for i = 1, #values do
					local v = values[i]
					--in()/not_in() never match null; skip it instead of
					--collating it.
					if v ~= nil and v ~= null then
						set[mdbx_collate_value(v, fold)] = true
					end
				end
				cache[expr] = set
			else
				for i = 1, #values do
					compile_col_decoders(values[i], node, cache, registry,
						outer_node)
				end
			end
		end
	else
		for i = 2, #expr do
			compile_col_decoders(expr[i], node, cache, registry, outer_node)
		end
	end
end

--wrap node in a filter checking every unconsumed condition in
--residual (choose_access()'s leftover where()/on_expr conditions for
--this step); a no-op when residual is empty.
--[[
row_check(conditions) -> nil | accept, bind
	accept() -> t|f                        per-row predicate
	bind(db, node, checks, [registry], [outer_node])

nil when there is nothing to check. accept() is built before bind() so a
join can be handed its predicate before the join node it reads from
exists; bind() then compiles that node's readers and exists()/in_()
checkers into the cache accept() reads.
]]
local function row_check(conditions)
	if #conditions == 0 then return end
	local bound, cache, checks
	local function accept()
		for _, cond in ipairs(conditions) do
			if not eval_residual(cond.expr, bound, checks, cache) then
				return false
			end
		end
		return true
	end
	local function bind(db, node, node_checks, registry, outer_node)
		bound, cache, checks = node, {}, node_checks
		for _, cond in ipairs(conditions) do
			compile_col_decoders(cond.expr, node, cache, registry, outer_node)
			compile_residual_checkers(db, cond.expr, node, node_checks, registry,
				cache)
		end
	end
	return accept, bind
end

function apply_residual(db, node, residual, checks, registry, outer_node)
	local accept, bind = row_check(residual)
	if not accept then return node end
	bind(db, node, checks, registry, outer_node)
	return node:filter(accept)
end

--[[
wrap node (a group_by() aggregate's value stream) in a filter checking
every having_conditions entry; a no-op when there are none.
compile()'s BIND COLUMNS stage binds having() by out_col name, so
compile_col_decoders() builds each operand's reader from aggregate()'s
own output col_decoder().
having()'s own exists()/in_() correlation (against the aggregated
row's out_cols) isn't implemented -- compile_exists_checker() expects
a pk/getter-backed node, not a value row -- so nothing here compiles
checkers; if having() ever nests exists()/in_(), eval_expr's own
assertf catches the missing check.
]]
local function apply_having(node, having_conditions)
	if #having_conditions == 0 then return node end
	local cache = {}
	for _, cond in ipairs(having_conditions) do
		compile_col_decoders(cond.expr, node, cache)
	end
	return node:filter(function()
		for _, cond in ipairs(having_conditions) do
			if not eval_residual(cond.expr, node, empty, cache) then
				return false
			end
		end
		return true
	end)
end

--COMPILE EXISTS CHECKERS -----------------------------------------------------

local compile_step --fw. decl.
local compile_union --fw. decl.
local compile_subquery_exists

local function set_check(checks, expr, check)
	checks[expr] = check
	local last = checks.last_scan
	if last then last.next_scan = check else checks.first_scan = check end
	checks.last_scan = check
	if check.uncorrelated then
		last = checks.last_reset
		if last then last.next_reset = check else checks.first_reset = check end
		checks.last_reset = check
	end
end

local function close_checks(checks)
	local check = checks.first_scan
	while check do
		check.scan.close()
		check = check.next_scan
	end
end

local function reset_check(check, args)
	local scan = check.scan
	scan.reset(args)
	if check.value_get then
		local set = {}
		while scan.next() do
			local v = check.value_get()
			if not null_value(v) then
				set[v] = true
			end
		end
		check.values_set = set
	else
		check.constant = scan.next() ~= nil
	end
	scan.close()
end

local function reset_checks(checks, args)
	local check = checks.first_reset
	while check do
		reset_check(check, args)
		check = check.next_reset
	end
end

--[[
resolve_exists_plan() calls the same choose_access() that a base or joined
source uses. compile() stores the result on the exists() expr so
compile_exists_checker() does not plan again for each terminal call.
resolve_exists_plan() also returns whether on_expr reads outside source.
When it returns false, compile_exists_checker() answers once instead of
once per row.
]]
function resolve_exists_plan(source, on_expr)
	local all_conditions = (on_expr == nil or on_expr == true)
		and empty or split_conditions({on_expr}, true)
	local plan = choose_access(source, all_conditions)
	local own_sources = {[source.name] = source}
	local correlated = false
	for _, cond in ipairs(all_conditions) do
		if references_outside(cond.expr, own_sources) then
			correlated = true
			break
		end
	end
	return plan, correlated
end

--[[
compile_exists_checker() compiles one exists()/not_exists()/in_()/not_in()
occurrence (expr) into checks[expr] and binds correlated reads to node.
compile_residual_checkers() calls it before the per-row predicate runs.
If checks[expr] already exists, compile_exists_checker() returns.
walk_exists_nodes() can reach the same occurrence twice: once directly
from compile_residual_checkers() and once through apply_residual() on
expr.plan.residual. If checks[expr] is set, compile_exists_checker() makes
the second call a no-op.
When expr.correlated is false, reset_check() computes {constant=} or
{values_set=} once per outer reset and closes the check scan.
For a table source, compile_table_scan() builds the persistent check scan
from expr.plan. For a relation source, compile_terminal() builds the full
value pipeline for in_()/not_in(), while compile_subquery_exists() builds
only stages that can change whether rows remain for exists()/not_exists().
check_exists() resets the relation per correlated outer row. values() resets
it and yields its single named output value per correlated outer row.
]]
function compile_exists_checker(db, expr, node, checks, registry, outer_cache)
	if checks[expr] then return end
	local op = expr[1]
	--exists()/not_exists(): expr[2] is the source, expr[3] is on_expr.
	--in()/not_in(): expr[3] is the source (a sub-relation, the only
	--shape compile_residual_checkers() calls this for); expr[2] is the
	--tested value expr, unrelated to this occurrence's own source.
	local membership = op == 'in' or op == 'not_in'
	local right = membership and expr[3] or expr[2]
	local outer_node = expr.correlated and node or nil
	if inherits(right, Rel) then
		local out_col, value_get, value_ai_ci, ai_ci
		local sub_node
		if membership then
			assert(right.out_cols and #right.out_cols == 1,
				'in_()/not_in(): sub-relation must return one column')
			out_col = right.out_cols[1]
			sub_node = compile_terminal(db, right, outer_node)
			--col_decoder() runs before the first advance() so scan() can
			--fetch a base-only output column.
			value_get, value_ai_ci =
				sub_node:col_decoder(out_col.name, true)
			ai_ci = operand_ai_ci(outer_cache, expr[2]) or value_ai_ci
			if ai_ci and not value_ai_ci then
				local get = value_get
				value_get = function()
					return mdbx_collate_value(get(), true)
				end
			end
		else
			sub_node = compile_subquery_exists(db, right, outer_node)
		end
		if expr.correlated then
			local check = {
				scan = sub_node,
				ai_ci = ai_ci,
			}
			if membership then
				check.values = function()
					sub_node.reset(node.args)
					return function()
						if sub_node.next() then
							return sub_node, value_get()
						end
					end
				end
			else
				check.check_exists = function()
					sub_node.reset(node.args)
					return sub_node.next() ~= nil
				end
			end
			set_check(checks, expr, check)
		else
			set_check(checks, expr, {
				scan = sub_node,
				uncorrelated = true,
				value_get = value_get,
				ai_ci = ai_ci,
			})
		end
	else
		local plan = expr.plan
		local inner_registry
		if expr.correlated then
			inner_registry = registry and update({}, registry) or {}
			for member in pairs(node.member_scans) do
				inner_registry[member] = node
			end
		end
		local inner = compile_table_scan(db, plan, outer_node)
		if inner_registry then
			for member in pairs(inner.member_scans) do
				inner_registry[member] = inner
			end
		end
		inner = apply_residual(db, inner, plan.residual, checks,
			inner_registry)
		if expr.correlated then
			set_check(checks, expr, {
				scan = inner,
				check_exists = function()
					inner.reset(node.args)
					return inner.next() ~= nil
				end,
			})
		else
			set_check(checks, expr,
				{scan = inner, uncorrelated = true})
		end
	end
end

--[[
chains one joined step onto node, the driver built so far, via
node:join(inner)/node:left_join(inner). join() and left_join() use only
the Scan methods from both sides.
compile_joined_step() builds inner from plan through compile_scan_path()
and correlates its seek params against node through compile_scan_param()'s
registry lookup.
compile_joined_step() adds the scanner to registry so a later step can
read its current row.

apply_residual() wraps inner before join()/left_join() decides whether the
current outer row matched. left_join() null-extends when
every seek row fails the residual.
]]
local function compile_joined_step(db, node, step, checks, registry, outer_node)
	local plan = step.plan
	local scanner, param_scanner =
		compile_table_scan(db, plan, node, registry, true)
	registry[step.source.name] = param_scanner
	local accept, bind = row_check(plan.residual)
	local join
	if step.join.op == 'left' then
		join = node:left_join(scanner, accept)
	else
		join = node:join(scanner, accept)
	end
	if bind then bind(db, join, checks, nil, outer_node) end
	return join
end

--[[
builds a left-joined group's own chain (step.nested: the group's base
step, plus any further joins inside the group) into a single node, for
compile_step to wrap in left_join() (no from_member: see below).
compile_nested() requires plan.seek[1].expr to read an outer column
(source_operand()/bucket_facts() set it during compile()'s BIND
COLUMNS stage) -- compile_scan_path()/compile_scan_param() already turn
that into a raw {scan=,col=} param against outer_registry, the same way
any joined step's seek does, so the group's base needs no different
treatment than compile_joined_step() gives an ordinary step. This is
why the old node system's nested_join from_member/reset_prefix
mechanism (built for pk_scan's getter-seek, which couldn't otherwise
read a live outer row per reset()) isn't needed here at all:
left_join()'s plain inner.reset() already re-evaluates the
scan-param against outer_registry's live scanner on every outer row.
]]
local function compile_nested(db, step, checks, outer_registry, outer_node)
	local base = step.nested[1]
	local plan = base.plan
	assert(plan.schema and plan.schema.is_index,
		'compile_step: nested group base has no index to seek by')
	local seek_expr = plan.seek[1].expr
	assert(type(seek_expr) == 'table' and seek_expr[1] == 'col'
		and seek_expr.source,
		'compile_step: nested group base must correlate on an outer column')
	local scanner, param_scanner =
		compile_table_scan(db, plan, outer_node, outer_registry)
	local inner = apply_residual(db, scanner, plan.residual, checks, nil,
		outer_node)
	--the group's own inner correlations (nested[2..] against nested[1] or
	--each other) are never referenced from outside the group, so they
	--get their own fresh registry, seeded with the base's own scanner.
	local registry = {[plan.member] = param_scanner}
	for i = 2, #step.nested do
		inner = compile_joined_step(db, inner, step.nested[i], checks,
			registry, outer_node)
	end
	return inner
end

--[[
builds the executor node for rel's access plan. rel must already be
compiled (rel:prepare()). bound values (q.param()/q.col()) aren't
compiled in: node.reset(args) supplies them fresh on every call, so the
same node runs again with different args by calling reset(args) again.
outer_node (nil at the top level) threads through to the base step's
scan() the same way, for a sub-relation compiled as an
exists()/in_() checker (compile_exists_checker()).
compile_step() starts checks empty. apply_residual() fills it when an
attachment site compiles its exists()/in_() occurrences.

Each step past the base chains onto whatever's been built so far:
- a single, un-joined base step -> a scan, bound values read
  through compile_scan_param()'s {arg=}/{scan=,col=}/{get=}/{value=}.
- a joined step -> compile_joined_step() builds a correlated scan
  and wraps it in join()/left_join().
- a left-joined group (step.nested) -> compile_nested() builds the
  group's own chain, wrapped in node_so_far:left_join(inner).
Every step's plan.residual (choose_access()'s leftover where()/on_expr
conditions that the seek didn't consume) gets applied via apply_residual()
right after that step's node is built. Once every step is chained on,
rel.late_conditions (attribute_conditions()'s cross-source and
left-joined-member conditions -- see attribute_conditions() and
collect_left_joined_sources()) gets applied the same way, once, over
the whole finished row.

--TODO: a group nested inside another group, and a group base that
doesn't correlate on a plain outer column, aren't wired up yet.
]]
--[[local]] function compile_step(db, rel, outer_node)
	assert(rel.access and #rel.access >= 1, 'compile_step: rel.access missing')
	local checks = {}
	local base = rel.access[1]
	assert(not base.join,
		'compile_step: access[1] must be the un-joined base step')
	local base_plan = base.plan
	local registry = {}
	local base_scanner, param_scanner =
		compile_table_scan(db, base_plan, outer_node, registry)
	registry[base_plan.member] = param_scanner
	local node = apply_residual(db, base_scanner, base_plan.residual, checks,
		nil, outer_node)
	for i = 2, #rel.access do
		local step = rel.access[i]
		if step.nested then
			local inner = compile_nested(db, step, checks, registry, node)
			local accept, bind = row_check(step.match_conditions)
			local join = node:left_join(inner, accept)
			if bind then bind(db, join, checks, nil, outer_node) end
			node = join
		else
			assert(step.join, 'compile_step: expected a joined step')
			node = compile_joined_step(db, node, step, checks, registry, outer_node)
		end
	end
	node = apply_residual(db, node, rel.late_conditions, checks, nil, outer_node)
	if checks.first_reset then
		local reset = node.reset
		function node.reset(args)
			reset(args)
			reset_checks(checks, args)
		end
	end
	if checks.first_scan then
		local close = node.close
		function node.close()
			close_checks(checks)
			close()
		end
	end
	return node
end

mdbx_compile_step = compile_step

--MATERIALIZE ROWS -----------------------------------------------------------

--[[
builds on compile_step()'s access/join chain with the rest of the
pipeline that a terminal needs: select() projection (rel.out_cols) or
compile_group()'s aggregate pipeline, then distinct/sort/limit as rel's
compile()-time flags call for. Order matches SQL: project, then
distinct, then sort, then limit -- the same order that compile()'s
order_by binding already assumes (order_mode is 'out_col' whenever
distinct_cols is set, so every order_by() term is guaranteed to name a
projected field, never a pre-distinct one).
]]
--[[
split rel.group_cols into plain group keys (op not in AGGREGATE_OPS)
and aggregate outputs (q.count/min/max/sum/avg -- the only ops
bind_expr allows through with allow_aggregate), building a
stream_aggregate/hash_aggregate 'agg' list: one synthetic {op = 'key'}
entry per key col (so the key ends up in the output row) plus the
real aggregate entries, all carrying rel.group_cols' own out_col
names.
]]
local function group_col_read(expr)
	if expr.source then return expr.source.name, expr[3] end
	return nil, expr.col.name
end

function split_group_cols(rel)
	local key_cols, agg_list = {}, {}
	for _, expr in ipairs(rel.group_cols) do
		if AGGREGATE_OPS[expr[1]] then
			local value_expr = expr[2]
			assert(value_expr == nil
				or (value_expr[1] == 'col'
					and (value_expr.source or value_expr.col)),
				'group_by(): only plain column aggregate arguments are'
					..' implemented yet')
			local member, col
			if value_expr then member, col = group_col_read(value_expr) end
			add(agg_list, {name = expr.name, op = expr[1],
				member = member, col = col})
		else
			assert(expr[1] == 'col' and (expr.source or expr.col),
				'group_by(): only plain column group keys are'
					..' implemented yet')
			local member, col = group_col_read(expr)
			add(key_cols, {name = expr.name, member = member, col = col})
		end
	end
	local full_agg = {}
	for i, kc in ipairs(key_cols) do
		add(full_agg, {name = kc.name, op = 'key', part = i,
			member = kc.member, col = kc.col})
	end
	for _, a in ipairs(agg_list) do add(full_agg, a) end
	return key_cols, full_agg
end

--[[
build the group_by()/aggregate stage of the pipeline: a grand total
(no key cols -- aggregate()'s cols=nil path, one record, no order or
grouping needed), streamed (rel.group_streaming: group_by()+aggregate(),
reading straight off the pk stream), or hashed (aggregate(...,hash=true),
reading straight off the pk stream too -- the fallback whenever grouped
order isn't already free; only the grouping itself is unordered, not the
column reads). having() is applied last, over whichever aggregate node
was built.
]]
local function compile_group(node, rel)
	local full_agg = rel.group_full_agg
	if #rel.group_key_cols == 0 then
		node = node:aggregate(full_agg)
	elseif rel.group_streaming then
		local cols = rel.group_stream_cols
		node = node:group_by(cols):aggregate(full_agg, cols)
	else
		node = node:aggregate(full_agg, rel.group_key_cols, true)
	end
	return apply_having(node, rel.having_conditions)
end

--compile_set_op() builds each input for one terminal and combines them
--per rel.set_op.
function compile_union(db, rel, compile_input)
	local op = rel.set_op
	local node = compile_input(db, rel.set_rels[1])
	for i = 2, #rel.set_rels do
		local input = compile_input(db, rel.set_rels[i])
		if op == 'union' then
			node = node:union(input)
		elseif op == 'intersect' then
			node = node:intersect(input)
		else
			node = node:except(input)
		end
	end
	return node
end

local function apply_limit(node, rel)
	if rel._limit ~= nil then
		local n = rel._limit
		if type(n) == 'table' and n[1] == 'param' then
			n = {arg = n[2]}
		end
		local offset = rel._offset
		if type(offset) == 'table' and offset[1] == 'param' then
			offset = {arg = offset[2]}
		end
		node = node:limit(n, offset)
	end
	return node
end

function compile_terminal(db, rel, outer_node)
	assert(rel.out_cols, 'rows()/rows_array()/first()/one()/must_one() require'
		..' select() or group_by()')
	assert(not (rel.group_cols and rel.select_cols),
		'select() after group_by() is not implemented yet')
	local node
	if rel.set_op then
		node = compile_union(db, rel, function(db, input)
			return compile_terminal(db, input, outer_node)
		end)
		if rel.group_cols then node = compile_group(node, rel) end
	elseif rel.group_cols then
		node = compile_group(compile_step(db, rel, outer_node), rel)
	else
		node = compile_step(db, rel, outer_node):select(rel.output_descriptor)
	end
	if rel.distinct_cols then
		node = node:distinct(rel.distinct_key_cols, not rel.distinct_streaming)
	end
	if rel.sort_needed then
		node = node:sort(rel.sort_spec)
	end
	return apply_limit(node, rel)
end

--nesting a second call inside an unfinished iteration of the first
--corrupts it -- prepare() a second rel instead.
local function get_or_build_node(rel, field, builder)
	if not rel.compiled then compile(rel) end
	local node = rel[field]
	if not node then
		node = builder(rel.db, rel)
		rel[field] = node
	end
	return node
end

local function make_output_scan(rel)
	return get_or_build_node(rel, '_rows_node', compile_terminal)
end

function Rel:rows(shape, params)
	local scan = make_output_scan(self)
	return scan:rows(shape, params)
end

function Rel:rows_array(shape, params)
	local scan = make_output_scan(self)
	return scan:rows_array(shape, params)
end

function Rel:first(shape, params)
	local scan = make_output_scan(self)
	return scan:first(shape, params)
end

function Rel:one(shape, params)
	local scan = make_output_scan(self)
	return scan:one(shape, params)
end

function Rel:must_one(shape, params)
	local scan = make_output_scan(self)
	return scan:must_one(shape, params)
end

--[[
Rel:count() and Rel:exists() read compile_step() directly when no later
stage can change their answers. compile_group() still applies because
having() can remove every finished group. distinct() changes Rel:count(),
so compile_group_or_distinct() builds the output values that it needs.
distinct() cannot remove the last row, so Rel:exists() skips it.
Rel:count() and Rel:exists() ignore their own order_by()/limit();
compile_subquery_exists() applies the limit of a relation operand.
]]
local function count_items(node, args)
	node.reset(args)
	local n = 0
	while node.next() do n = n + 1 end
	node.close()
	return n
end

--set-op inputs are built through compile_terminal() here too: an input's
--own limit() decides what it returns, so skipping it would make count()
--and exists() disagree with rows().
local function compile_group_or_distinct(db, rel)
	if rel.set_op then
		local node = compile_union(db, rel, compile_terminal)
		if rel.group_cols then
			node = compile_group(node, rel)
		end
		if rel.distinct_cols then
			node = node:distinct(rel.distinct_key_cols, true)
		end
		return node
	end
	local node = compile_step(db, rel)
	if rel.group_cols then node = compile_group(node, rel) end
	if rel.distinct_cols then
		assert(rel.out_cols, 'distinct() requires select() or group_by()')
		if not rel.group_cols then node = node:select(rel.output_descriptor) end
		node = node:distinct(rel.distinct_key_cols,
			not rel.distinct_streaming)
	end
	return node
end

function Rel:count(params)
	local node = get_or_build_node(self, '_count_node', compile_group_or_distinct)
	return count_items(node, params)
end

local function compile_exists_node(db, rel, outer_node)
	local node
	if rel.set_op then
		node = compile_union(db, rel, function(db, input)
			return compile_terminal(db, input, outer_node)
		end)
		if rel.group_cols then node = compile_group(node, rel) end
	else
		node = compile_step(db, rel, outer_node)
		if rel.group_cols then node = compile_group(node, rel) end
	end
	return node
end

function compile_subquery_exists(db, rel, outer_node)
	local node = compile_exists_node(db, rel, outer_node)
	if rel.distinct_cols and rel._offset ~= nil then
		if not rel.group_cols and not rel.set_op then
			node = node:select(rel.output_descriptor)
		end
		node = node:distinct(rel.distinct_key_cols,
			not rel.distinct_streaming)
	end
	return apply_limit(node, rel)
end

function Rel:exists(params)
	local node = get_or_build_node(self, '_exists_node', compile_exists_node)
	local found = node:exists(params)
	node.close()
	return found
end
