--[[

	mdbx_query: query builder over mdbx_schema.
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
	:fk_[left_]join(table)        join to table via FK
	:where_has(table, [filter])   q.exists(table) via FK
	:where_hasnt(table, [filter]) q.not_exists(table) via FK
	:cross_join(...)              unconditional join; takes no on_expr
	:semi_join(...)               :where(q.exists(table|rel,alias, on_expr))
	:anti_join(...)               :where(q.not_exists(table|rel,alias, on_expr))
SET
	db:union(rel1,...) -> rel     union-all; use :distinct() to deduplicate
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

TODO: SET OPERATIONS
	:intersect(source)            set intersection over output cols
	:except(source)               set difference over output cols
	:lateral(source [, alias] [, opts])    dependent join; opts.left=left join
TODO: DML
	:update(assignments [, opts]) -> dml   assignments: {col_name -> expr}
	:delete([opts]) -> dml
	dml:returning(out_cols) -> dml          output rows for changed target rows
	dml:run([params]) -> n                  execute; return affected row count
	dml:rows([params]) -> iterator -> row   execute; requires returning()

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

--if not ... then require'mdbx_query_test'; return end

require'mdbx_schema'
require'mdbx_query_nodes2'

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
	return object(Rel, {db = self, union_rels = {...}})
end

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
		end
	end
	return {op, rel, on_expr, alias = alias}
end
function q.exists    (...) return exists_expr('exists'    , ...) end
function q.not_exists(...) return exists_expr('not_exists', ...) end

function Rel:semi_join(...) return self:where(q.exists(...)) end
function Rel:anti_join(...) return self:where(q.not_exists(...)) end

function Rel:fk_join      (tbl) return join(self, 'inner', tbl, {fk = true}) end
function Rel:fk_left_join (tbl) return join(self, 'left' , tbl, {fk = true}) end

function Rel:where_has   (tbl, filter)
	return self:where(exists_expr('exists', tbl,
		{fk = true, filter = filter}))
end
function Rel:where_hasnt (tbl, filter)
	return self:where(exists_expr('not_exists', tbl,
		{fk = true, filter = filter}))
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
- decide sort/dedup shortcuts; -> sort_needed, distinct_streaming
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

--collect foreign keys between two table sources in either direction.
local function fk_matches(source_a, source_b, found_fks)
	local function scan(child, parent)
		for _, fk in pairs(child.schema.fks or empty) do
			if fk.ref_table == parent.table then
				add(found_fks, {fk = fk, child = child, parent = parent})
			end
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

--find the one foreign key connecting a new table to existing sources.
local function resolve_fk(marker, new_source, sources, what)
	local found_fks = {}
	for _, source in ipairs(sources) do
		if source ~= new_source and source.table then
			fk_matches(new_source, source, found_fks)
		end
	end
	assertf(#found_fks > 0, '%s: no FK for %s', what, new_source.name)
	assertf(#found_fks == 1, '%s: ambiguous FK for %s', what, new_source.name)
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
		bind_expr(expr[2], scope)
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

--compile a relation used as an aliased rows source.
local function resolve_rel_source(rel, name, what)
	compile(rel)
	--only select()/group_by() give a relation named cols to use as a rows source.
	local cols = assert(rel.out_cols, what..' requires select() or group_by()')
	return {
		rel = rel,
		name = name,
		cols = cols,
	}
end

--resolve sources and merge unaliased relation joins into this relation.
local function resolve_sources(rel)
	local sources = {}
	rel.sources = sources
	assert(rel.joins and rel.joins[1], 'from() missing')
	for i, join in ipairs(rel.joins) do
		if isstr(join.right) then
			join.right = resolve_table_source(rel.db, join.right, join.alias)
			add_source(sources, join.right)
		elseif join.alias then
			--the join alias becomes this source's name; the inner rel has no
			--name of its own, only names for its own out_cols.
			join.right = resolve_rel_source(join.right, join.alias,
				i == 1 and 'from(rel)' or 'join(rel)')
			add_source(sources, join.right)
		else
			assert(i > 1, 'from(rel) requires alias')
			local join_rel = join.right
			--a join group (unaliased relation join) may only have sources,
			--joins, and where() -- nothing else merges into the parent.
			assert(not (
					join_rel.union_rels
				or join_rel.havings
				or join_rel.select_cols
				or join_rel.group_cols
				or join_rel.distinct_cols
				or join_rel.order_cols
				or join_rel._limit
			), 'join rel contains unsupported query parts')
			--get join group's sources before moving its where() clauses.
			local join_sources = resolve_sources(join_rel)
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
- decide whether order_by() needs an explicit sort.
- no order_by() means no sort.
- group_by() and distinct() sort explicitly for now.
- plain ungrouped rows can reuse driving-source scan order.
]]
local function sort_actually_needed(rel)
	if not rel.order_cols then return false end
	if rel.group_cols or rel.distinct_cols then return true end
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

--group_by() with no aggregate outputs is "distinct group keys" -- same
--access-plan requirement as distinct(): both can request an index
--whose key groups their cols together (any order, any direction), the
--same way order_by() requests one for row sequence above, but looser.
--mutually exclusive with source_order_terms (base_order_terms()
--returns nil whenever rel.distinct_cols or rel.group_cols is set).
local function group_has_no_aggregates(rel)
	if not rel.group_cols then return false end
	for _, expr in ipairs(rel.group_cols) do
		if AGGREGATE_OPS[expr[1]] then return false end
	end
	return true
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
  base (driving) source's whole primary key. nested-loop execution
  (pk_join_seek/nested_join) processes one base row's entire join
  fan-out before moving to the next, so every row sharing one base
  row's identity comes out together regardless of what order any
  joined source's own scan runs in.
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
- decide whether distinct() can stream (stream_distinct) instead of
  hashing (hash_distinct) -- same terms_group_consecutive() check
  that group_actually_streamable() uses, over distinct()'s own dedup key
  cols instead of group_by()'s.
- distinct() after group_by() always hashes: the aggregated output's
  order isn't rel.natural_order (that describes the pre-aggregation
  access chain, not what pk_group/stream_aggregate or hash_aggregate
  happen to emit), and nothing tracks the aggregated order separately
  yet.
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
	if rel.union_rels then
		for _, input in ipairs(rel.union_rels) do
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
  (pk_scan only implements exact/range/prefix/eq_prefix/full), and
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
	local eq, lo, hi, prefix = {}, {}, {}, {}
	for _, cond in ipairs(conditions) do
		if not cond.consumed then
			local expr = cond.expr
			if cond.kind == 'equality' then
				local col, val = source_operand(source, expr[2], expr[3])
				if col and not eq[col] then eq[col] = {cond = cond, expr = val} end
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
							eq[col] = {cond = cond, expr = null}
						end
					elseif field.not_null then
						--a not_null field cannot reject an existing row here.
						cond.consumed = true
					elseif not lo[col] then
						--TODO: range bucketing keeps the first lower-bound fact.
						--is_not_null() can occupy the bucket before a
						--stricter later range fact.
						lo[col] = {cond = cond, op = '>', expr = null}
					end
				end
			end
		end
	end
	return eq, lo, hi, prefix
end

--is this col marked ai_ci? true or false either way, whether we're
--looking at the base table or an index -- every index just copies the
--flag straight from the table.
local function ai_ci_col(schema, col)
	local f = schema.fields[col]
	return f and f.mdbx_collation == 'utf8_ai_ci'
end

--how many cols at the start of the key we can search on with "=".
--for an ai_ci col that's only true if this schema is the index that
--stores the folded text -- the table itself, and any other index,
--only have the real, unfolded text.
local function eq_depth(schema, eq)
	local pk = schema.pk
	local depth = 0
	for i, col in ipairs(pk) do
		if eq[col] and (schema.is_index or not ai_ci_col(schema, col)) then
			depth = i
		else
			break
		end
	end
	return depth
end

--[[
- compare one candidate key to this source's fact buckets.
- depth is how many cols at the start are fixed by an equality fact.
- try_key() then looks for an in_(), prefix, or range fact on the col
  right after depth.
- returns the resulting plan kind, classifying how strongly this key
  narrows the scan (see 'plan kind' in mdbx_query_impl.md).
- no row counts or index sizes are used.
- the plan does not depend on table contents.
- we never use an ai_ci col for a prefix search (starts()), because
  folding text can shift where a prefix starts or ends.
]]
local function try_key(schema, eq, lo, hi, prefix)
	local pk = schema.pk
	local depth = eq_depth(schema, eq)
	if depth == #pk then
		return {kind = 'exact', depth = depth}
	end
	local nc = pk[depth + 1]
	local nc_seekable = nc and (schema.is_index or not ai_ci_col(schema, nc))
	if nc and prefix[nc] and not ai_ci_col(schema, nc) then
		return {kind = 'prefix', depth = depth, bound_col = nc}
	end
	if nc_seekable and (lo[nc] or hi[nc]) then
		return {kind = 'range', depth = depth, bound_col = nc}
	end
	if depth > 0 then
		return {kind = 'eq_prefix', depth = depth}
	end
	return nil
end

--[[
- rank candidates by how many key cols narrow the scan.
- plan_coverage() counts a range or prefix plan's bound col too.
- key-byte checks reject rows before any base-table read.
- choose_access() breaks a coverage tie by kind, ranked via kind_rank.
- row counts and index sizes are not ranking inputs.
]]
--{kind->tie-break rank}
local kind_rank = {exact = 2, range = 1, prefix = 1, eq_prefix = 0}
local function plan_coverage(plan)
	if plan.kind == 'range' or plan.kind == 'prefix' then
		return plan.depth + 1
	end
	return plan.depth
end

--[[
- what order the rows come out in if we scan this key.
- if an ai_ci col is fixed to one value at the start (an "=" match),
  we still count it as fixed: every row that we keep really does have the
  same real text, because we double-check it later, so the cols after
  it still sort correctly.
- if an ai_ci col comes later, varying, we can only trust its order
  when this schema is the index that stores the folded text. the table
  itself, or a plain index, stores the real text, which sorts
  differently -- so we stop here instead of claiming an order that we can't
  back up.
- a col stored as "desc" scans in descending order, not ascending (the
  key bytes are inverted for this at write time, so a normal forward
  scan just comes out reversed).
- reverse flips every trailing col's dir at once: that's exactly what
  walking the cursor backward (MDBX_PREV/MDBX_LAST) does to the whole
  key order, so a single flag covers it.
]]
local function key_order(source, schema, depth, reverse)
	local order = {} --{{key=,fixed=true|dir=}...}
	local pk = schema.pk
	for i = 1, depth do
		add(order, {key = source.name..'.'..pk[i], fixed = true})
	end
	for i = depth + 1, #pk do
		local col = pk[i]
		if ai_ci_col(schema, col) and not schema.is_index then break end
		local dir = pk.desc and pk.desc[i] and 'desc' or 'asc'
		if reverse then dir = dir == 'desc' and 'asc' or 'desc' end
		add(order, {key = source.name..'.'..col, dir = dir})
	end
	return order
end

--try_order_key() checks whether scanning this key (forward or
--reversed) already produces order_by()'s order.
--the scan also narrows when leading cols are fixed by equality.
--non-leading filters stay residual checks.
local function try_order_key(source, schema, eq, order_terms)
	if not order_terms then return end
	local depth = eq_depth(schema, eq)
	local kind = depth == #schema.pk and 'exact'
		or (depth > 0 and 'eq_prefix' or 'full')
	if order_satisfied(order_terms, key_order(source, schema, depth)) then
		return {kind = kind, depth = depth, dir = 'asc'}
	end
	--an "exact" plan has no trailing key cols left to walk in either
	--direction, so only "eq_prefix"/"full" can be satisfied by scanning
	--the same key order backward (MDBX_PREV/MDBX_LAST) instead of sorting.
	if kind ~= 'exact'
		and order_satisfied(order_terms, key_order(source, schema, depth, true))
	then
		return {kind = kind, depth = depth, dir = 'desc'}
	end
end

--like try_order_key, but for distinct() / group_by() with no aggregate
--outputs: a SET match (order_satisfied_set), not a sequence match, and
--no backward-scan variant.
local function try_group_key(source, schema, eq, group_terms)
	if not group_terms then return end
	local depth = eq_depth(schema, eq)
	local kind = depth == #schema.pk and 'exact'
		or (depth > 0 and 'eq_prefix' or 'full')
	if order_satisfied_set(group_terms, key_order(source, schema, depth)) then
		return {kind = kind, depth = depth, dir = 'asc'}
	end
end

--[[
does eq's first n leading key cols of cand_schema all bind, via
equality, to the very same already-scheduled source's own pk, in
matching pk order? pk_join_seek reads that source's whole encoded pk
as raw bytes (driver:pk(from_member)), so anything looser -- a
literal, a different source, an out-of-order or partial match -- can't
drive it and must fall back to a getter-driven seek instead.
]]
local function fk_driving_source(eq, cand_schema, n)
	local from_source
	for i = 1, n do
		local fact = eq[cand_schema.pk[i]]
		if not fact then return nil end
		local val = fact.expr
		if type(val) ~= 'table' or val[1] ~= 'col' or not val.source then
			return nil
		end
		if not from_source then from_source = val.source
		elseif val.source ~= from_source then return nil end
		if val[3] ~= from_source.schema.pk[i] then return nil end
	end
	return from_source
end

--[[
classify a joined step's winning candidate into the exact physical
operation compile_step() will run:
- 'fk_seek': cand is one of source's own FK indexes (mdbx_find_fk), and
  every one of the FK's own columns is driven by an equality against
  the referenced source's own pk, in order -- pk_join_seek's raw-byte
  reuse needs exactly that shape.
- 'index_seek': cand is source's own pk or another index, driven by a
  getter reading the driver node built so far -- covers a
  child-to-parent pk lookup and any other indexed equi/range join.
- 'cross': no candidate covered any condition (kind == 'full') -- a
  full nested-loop scan of source per driver row, on_expr entirely
  residual.
]]
local function classify_join_op(source, best_cand, best_plan, eq)
	if best_plan.kind == 'full' then return 'cross' end
	if best_cand.schema.is_index then
		local fk = mdbx_find_fk(best_cand.schema.val_schema, best_cand.schema)
		if fk then
			local from_source = fk_driving_source(eq, best_cand.schema, #fk.cols)
			if from_source then return 'fk_seek', fk, from_source end
		end
	end
	return 'index_seek'
end

--[[
- choose the key that drives this source's scan.
- candidates are the source's pk and its indexes.
- consumed conditions are marked on the chosen plan.
- unconsumed conditions become residual row checks.
- conditions (access_conditions()): the join's own on_expr conditions
  plus any where() condition that reads only this source, all equally
  key-eligible.
- join (the Join object, or false/nil for a base source) additionally
  picks plan.op, the exact physical operation compile_step() will run
  for a joined step -- see classify_join_op() below. A base source has
  no join and is always lowered by the same pk_scan path, so it gets
  no op.
]]
local function choose_access(source, conditions, join, order_terms,
	prefer_order, group_terms)
	--rel sources have no pk or index metadata here.
	--they scan the already-compiled inner rel.
	--virtual tables have no pk or index metadata either: no physical
	--storage means no seek, so every condition on them stays residual.
	--neither has a physical scan node yet (compile_step()'s pk_scan
	--needs a real schema) -- reject here rather than let compile_step
	--crash deep inside pk_scan on a false schema.
	if not source.table or source.schema.virtual then
		assertf(false, 'choose_access: %s: a relation/virtual source is not'
			..' implemented yet', source.name)
	end
	local eq, lo, hi, prefix = bucket_facts(source, conditions)
	local candidates = {} --{{schema=}...}
	add(candidates, {schema = source.schema})
	for _, ix in ipairs(source.schema.indexes or empty) do
		add(candidates, {schema = ix})
	end
	local best_cand, best_plan, best_cov
	local order_cand, order_plan
	local group_cand, group_plan
	for _, cand in ipairs(candidates) do
		local plan = try_key(cand.schema, eq, lo, hi, prefix)
		if plan then
			local cov = plan_coverage(plan)
			if not best_plan or cov > best_cov
				or (cov == best_cov
					and kind_rank[plan.kind] > kind_rank[best_plan.kind]) then
				best_cand, best_plan, best_cov = cand, plan, cov
			end
		end
		if not order_plan then
			local plan = try_order_key(source, cand.schema, eq, order_terms)
			if plan then order_cand, order_plan = cand, plan end
		end
		if not group_plan then
			local plan = try_group_key(source, cand.schema, eq, group_terms)
			if plan then group_cand, group_plan = cand, plan end
		end
	end
	--order_plan never covers more key cols than best_plan already does
	--(try_key only ever matches equal-or-more of them than try_order_key),
	--so taking it whenever coverage ties is free: no rows scanned that
	--best_plan wouldn't have scanned anyway, and no explicit sort needed.
	--with limit(), an ordered scan can also give up coverage that a
	--range/prefix filter would have had, stopping early instead.
	--exact seeks over every key col stay on the selective path either way.
	if order_plan and (not best_plan
		or (best_plan.kind ~= 'exact' and plan_coverage(order_plan) >= best_cov)
		or (prefer_order and best_plan.kind ~= 'exact')) then
		best_cand, best_plan = order_cand, order_plan
	--order_terms and group_terms never both apply; no prefer_order
	--counterpart for group_terms since every terminal that groups or
	--dedups materializes every row anyway.
	elseif group_plan and (not best_plan
		or (best_plan.kind ~= 'exact'
			and plan_coverage(group_plan) >= best_cov)) then
		best_cand, best_plan = group_cand, group_plan
	end
	if not best_plan then
		best_cand, best_plan =
			{schema = source.schema}, {kind = 'full', depth = 0}
	end
	best_plan.schema = best_cand.schema
	best_plan.member = source.name --pk_scan's own name override; see its doc
	best_plan.dir = best_plan.dir or 'asc' --order_plan may already carry 'desc'
	local consume_depth = best_plan.depth
	local fk
	if join then
		local op, from_source
		op, fk, from_source = classify_join_op(source, best_cand, best_plan, eq)
		best_plan.op = op
		if op == 'fk_seek' then
			best_plan.from_source = from_source
			--already found here, for #fk.cols below -- carried on the plan
			--so compile_joined_step can pass it into pk_join_seek instead
			--of pk_join_seek re-deriving it with its own find_fk call.
			best_plan.fk = fk
			consume_depth = #fk.cols
			--cap kind/depth down to exactly what gets marked consumed
			--below -- pk_join_seek ignores kind/seek/lo/hi/prefix
			--entirely, reading from_source's whole encoded pk as raw
			--bytes instead, so nothing past the FK's own columns is
			--ever actually checked by the seek itself, even when the
			--chosen index is wider or a further range/prefix bound_col
			--would otherwise apply. This also keeps the plan internally
			--consistent (seek's own length matches plan.depth) if a
			--left join later downgrades this step to index_seek, below.
			--TODO(pk_join_seek): seek a wide FK index deeper than
			--#fk.cols so a trailing equality also narrows the scan
			--instead of staying a residual check.
			best_plan.depth = consume_depth
			best_plan.kind = (consume_depth == #best_cand.schema.pk)
				and 'exact' or 'eq_prefix'
		end
	end
	local seek = {} --{expr...}: one value-operand expr per matched leading col
	for i = 1, consume_depth do
		local fact = eq[best_cand.schema.pk[i]]
		seek[i] = fact.expr
		fact.cond.consumed = true
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
	elseif best_plan.kind == 'prefix' then
		local fact = prefix[best_plan.bound_col]
		best_plan.prefix = fact.expr
		fact.cond.consumed = true
	end
	local residual = {} --{condition...}
	for _, cond in ipairs(conditions) do
		if not cond.consumed then
			add(residual, cond)
		end
	end
	best_plan.residual = residual
	--pk_join_seek's left-join null-extension depends only on whether the
	--raw FK seek found a row -- it has no way to also require the
	--residual to pass before deciding a driver row matched, so a raw
	--match that fails the residual would wrongly count as "matched" and
	--the null-extended row would never be emitted. Falling back to
	--index_seek's getter-driven pk_scan lets compile_joined_step apply
	--the residual to the seek's own rows before nested_join decides,
	--which handles this correctly (see compile_joined_step()). The plan
	--is already internally consistent for this (kind/depth capped
	--above), so no re-derivation is needed here.
	if best_plan.op == 'fk_seek' and type(join) == 'table' and join.op == 'left'
		and #residual > 0
	then
		best_plan.op = 'index_seek'
		best_plan.from_source = nil
		best_plan.fk = nil
	end
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
			local conditions = access_conditions(base_source, picked,
				where_conditions)
			if picked.op ~= 'left' then
				--an inner join(rel, on_expr) group has no null-extension
				--semantics, so its base_source chains onto the driver the
				--same way any plain joined source does (fk_seek/index_seek/
				--cross via classify_join_op), not through the left-group's
				--separate correlated/nested_join path below.
				add(access, {source = base_source, join = picked,
					plan = choose_access(base_source, conditions, picked)})
				scheduled[base_source.name] = true
				build_access(group.joins, scheduled, access, sources,
					where_conditions)
			else
				local base_step = {source = base_source, join = false,
					plan = choose_access(base_source, conditions)}
				local nested_scheduled = {[base_source.name] = true}
				local nested = {base_step} --{step...}
				build_access(group.joins, nested_scheduled, nested, sources,
					where_conditions)
				add(access, {source = false, join = picked, nested = nested})
			end
		else
			local conditions = access_conditions(picked.right, picked,
				where_conditions)
			add(access, {source = picked.right, join = picked,
				plan = choose_access(picked.right, conditions, picked)})
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

	local sources, union_out_cols
	if rel.union_rels then
		--can't call db:from()/join() on a union rel.
		assert(not rel.joins, 'union does not allow joins')
		for _, input in ipairs(rel.union_rels) do
			compile(input, parent_scope)
			assert(input.out_cols,
				'union input requires select() or group_by()')
			if union_out_cols then
				assert(same_out_cols(union_out_cols, input.out_cols),
					'union inputs must return the same cols')
			else
				union_out_cols = input.out_cols
			end
		end
		sources = {}
		rel.sources = sources
	else
		sources = resolve_sources(rel)
	end

	--RESOLVE OUTPUT COLUMNS --------------------------------------------------

	rel.group_cols = resolve_out_cols(rel.group_cols)
	rel.select_cols = resolve_out_cols(rel.select_cols)
	rel.out_cols = rel.select_cols or rel.group_cols or union_out_cols
	rel.distinct_cols = resolve_distinct(rel.distinct_cols, rel.out_cols)

	--BUILD SCOPES ------------------------------------------------------------

	rel.scope = { --kept in rel because it's used by correlated subqueries.
		db = rel.db,
		sources = sources,
		cols = union_out_cols,
		parent = parent_scope,
	}
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

	for _, expr in ipairs(rel.group_cols or empty) do
		bind_expr(expr, rel.scope, nil, nil, true)
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

	--TODO: compile() skips this whole block for a union rel, so
	--distinct() on a union (which the doc block above implies works) has
	--no dedup strategy yet. probably always hash, since a union has no
	--single natural_order to stream against.
	if not rel.union_rels then
		local base_source = rel.joins[1].right
		local access = {} --{{source=,join=|false,plan=|nested=}...}
		rel.access = access
		local base_conditions =
			access_conditions(base_source, false, rel.where_conditions)
		add(access, {source = base_source, join = false,
			plan = choose_access(base_source, base_conditions, false,
				source_order_terms, prefer_order, source_group_terms)})
		build_access(rel.joins, {[base_source.name] = true}, access, sources,
			rel.where_conditions)
		rel.natural_order = natural_order(access[1])
		--TODO: the execution stage still needs an opener for each access
		--step (old file's prepare_scans: compile_scan/compile_relation_
		--scan/compile_virtual_scan) -- blocked on the execution stage,
		--which isn't ported yet.
	end

	--SORT AND DEDUP ----------------------------------------------------------

	--[[
	- whether an explicit sort is needed, or a group/distinct can stream
	  instead of hash, is fully decided by what's already been set above
	  (order_cols, natural_order, group_cols, distinct_cols) -- decide it
	  once here, instead of recomputing it on every execution.
	]]
	rel.sort_needed = sort_actually_needed(rel)
	rel.distinct_streaming = distinct_actually_streamable(rel)
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
			else
				local outputs = {}
				local used = {} --{name->true}: every name already claimed by a key
				for i, kc in ipairs(key_cols) do
					outputs[i] = {name = kc.name, member = kc.member, col = kc.col}
					used[kc.name] = true
				end
				--several aggregates can read the same source column (sum(x) and
				--avg(x) both reading x): project it once, not once per aggregate.
				local input_by_col = {} --{"member.col"->name}
				local next_agg = 1
				for _, a in ipairs(full_agg) do
					if a.op ~= 'key' and a.member then
						local col_key = a.member..'.'..a.col
						local name = input_by_col[col_key]
						if not name then
							--a user-chosen key name (e.g. an out_col literally
							--named '_agg1') can collide with the next generated
							--name -- keep counting until one isn't already used,
							--instead of overwriting that key's own output slot.
							repeat
								name = '_agg'..next_agg
								next_agg = next_agg + 1
							until not used[name]
							used[name] = true
							input_by_col[col_key] = name
							add(outputs, {name = name, member = a.member, col = a.col})
						end
						a.input = name
					end
				end
				local fields = {}
				for i, kc in ipairs(key_cols) do fields[i] = kc.name end
				rel.group_hash_outputs = outputs
				rel.group_hash_fields = fields
			end
		end
	end
	if rel.distinct_cols then
		local fields = {}
		for i, c in ipairs(dedup_key_cols(rel)) do fields[i] = c.name end
		rel.distinct_fields = fields
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

--EXECUTOR -------------------------------------------------------------------

--[[
- turn one compile()-time value expr (from a plan's seek/lo/hi/prefix)
  into a zero-arg getter, matching what pk_scan() reads its bound
  values through.
- a literal passes through as a constant getter.
- q.param() reads from a shared, reusable params table: the caller
  overwrites that same table's contents before each node:reset(), and
  every getter built against it stays wired to the new values.
- q.col() reaches here three ways: an exists()/in_() occurrence's own
  scan (compile_exists_checker()), correlating against the stable node
  its attachment site checks; a sub-relation's own base step, same
  function, correlating the same way; and an 'index_seek'/'cross'
  joined step (compile_joined_step()), correlating against the driver
  node built so far. A top-level base step's own conditions never bind
  a seek/lo/hi/prefix expr to another source's column
  (attribute_conditions() makes any such condition late instead).
  outer_node is that stable node -- nil at the top level, where a
  q.col() here would be a real bug, not a legitimate read. It's a
  plain reference, never reassigned after the caller builds it: unlike
  params (one shared table, its contents overwritten before every
  reset()), each of these three callers already has its own fixed node
  to close over, no reset()-time indirection needed.
]]
local function compile_getter(expr, params, outer_node)
	if type(expr) == 'table' and expr[1] == 'param' then
		local name = expr[2]
		return function() return params[name] end
	end
	if type(expr) == 'table' and expr[1] == 'col' then
		assert(outer_node, 'compile_getter: a q.col() bound value is only'
			..' valid inside a sub-relation probe or a joined index_seek')
		local member, col = expr.source.name, expr[3]
		return function() return outer_node:col(member, col) end
	end
	return function() return expr end
end

--[[
one bound-value expr -> a table_scanner param descriptor. a q.col() read
of an already-registered member (registry[source.name], set by
compile_step()/compile_joined_step() as each step's table_scanner is
built) becomes a raw {scan=,col=} scan-param, reading that member's
current row directly -- no decode/re-encode. This is what lets an
fk_seek-classified join (choose_access()'s classify_join_op()) lower the
exact same way as index_seek/cross: the FK's referenced column is always
a q.col() on the already-scheduled parent, which is always a registered
member by the time this runs, so pk_join_seek's raw-byte-reuse
specialization has nothing left to add over the general case. Anything
else (a q.param()/literal, or a q.col() whose source isn't a registered
table_scanner -- a sub-relation probe's outer correlation, still read
through compile_getter's decoded outer_node:col()) falls back to a
{get=} closure.
]]
local function compile_scan_param(expr, params, outer_node, registry)
	if registry and type(expr) == 'table' and expr[1] == 'col' and expr.source
		and registry[expr.source.name]
	then
		return {scan = registry[expr.source.name], col = expr[3]}
	end
	return {get = compile_getter(expr, params, outer_node)}
end

--turn one choose_access() plan (schema/depth/dir/kind plus seek/lo/hi/
--prefix exprs) into a table_scanner path: one {col,'=',descriptor} term
--per leading equality-pinned column (plan.schema.pk[i]), then one bound
--term (range/prefix) or one dir-only term, whichever the plan calls for
--past that prefix -- table_scanner only needs one term carrying `dir` to
--fix the whole scan's direction, not one per trailing column. outer_node
--(nil at the top level) passes straight through to compile_getter, for a
--sub-relation probe's correlated base step. registry (nil outside
--compile_step()'s own access-chain build) is compile_scan_param()'s
--member -> table_scanner lookup for a joined step's correlated seek.
local function compile_scan_path(plan, params, outer_node, registry)
	local pk = plan.schema.pk
	local path = {}
	for i = 1, plan.depth do
		path[i] = {pk[i], '=',
			compile_scan_param(plan.seek[i], params, outer_node, registry)}
	end
	if plan.kind == 'range' then
		local term = {plan.bound_col}
		if plan.lo and plan.hi then
			term[2] = 'range'
			term[3] = plan.lo.op
			term[4] = compile_scan_param(plan.lo.expr, params, outer_node, registry)
			term[5] = plan.hi.op
			term[6] = compile_scan_param(plan.hi.expr, params, outer_node, registry)
		elseif plan.lo then
			term[2] = plan.lo.op
			term[3] = compile_scan_param(plan.lo.expr, params, outer_node, registry)
		else
			term[2] = plan.hi.op
			term[3] = compile_scan_param(plan.hi.expr, params, outer_node, registry)
		end
		term.dir = plan.dir
		path[#path + 1] = term
	elseif plan.kind == 'prefix' then
		path[#path + 1] = {plan.bound_col, 'starts',
			compile_scan_param(plan.prefix, params, outer_node, registry),
			dir = plan.dir}
	elseif plan.dir and plan.depth < #pk then
		path[#path + 1] = {pk[plan.depth + 1], dir = plan.dir}
	end
	return path
end

--[[
wraps one table_scanner as a generic executor node over `member`'s column
namespace -- the reset/next_group/next_pk/pk/col_decoder/close contract
that pk_join_seek/nested_join and select()/pk_filter()/pk_group()/
stream_aggregate()/value_sort() (mdbx_query_nodes2.lua) call on an
upstream node; col/next_item/explain fall back to Db.query_node's own
defaults (see mdbx_query_nodes2.lua).

table_scanner's advance_key()/advance_pk() are already exactly pk_scan's
next_group()/next_pk(): both walk to the next distinct key vs. the next
duplicate within the current key, and both correctly perform the initial
seek on whichever is called first after reset(). found() is pk_scan's
has_pk. The base table's pk bytes live in key_rec for a base-table scan,
val_rec (the dup value) for an index scan.
]]
local function scan_node(scanner, member)
	local node = object(Db.query_node, {item = 'pk', members = {member}})
	function node:reset()
		scanner.reset()
	end
	function node:next_group()
		return scanner.advance_key()
	end
	function node:next_pk()
		return scanner.advance_pk()
	end
	function node:pk(name)
		if scanner.found() and (name == nil or name == member) then
			local rec = scanner.is_index and scanner.val_rec or scanner.key_rec
			return true, rec.data, rec.size
		end
	end
	function node:col_decoder(want_member, col)
		assertf(want_member == member, 'scan_node: unknown member: %s',
			tostring(want_member))
		return scanner:col_decoder(col)
	end
	function node:close()
		scanner.close()
	end
	return node
end

--[[
augments a scan_node whose source is accessed via a secondary index with
a second, correlated exact scanner on the base table, for a residual/
output/correlation that needs a base value column the index doesn't
cover (table_scanner's own col_decoder rejects that case: a secondary
index's dup value only carries the base pk, not other columns). The base
scanner is seeked by the base pk, read raw off the index scanner's own
dup value via scan-params -- an ordinary correlated exact scan, not a
table_scanner feature.

The base seek is lazy: next_group()/next_pk() only mark it stale (and
pass the raw scanner's own return value straight through, untouched --
next_item()'s "found?" signal is never reinterpreted here); col_decoder()
for an uncovered column seeks it on first read since the last
invalidation. A residual/output that never reads an uncovered column on
a rejected row never seeks the base scanner at all -- apply_residual()'s
existing per-condition loop already stops at the first failing
condition, so an index-covered condition ahead of an uncovered one in
the same residual gets this for free, no residual reordering needed.
]]
local function with_base_scanner(db, node, index_scanner, base_schema)
	local path = {}
	for i, col in ipairs(base_schema.pk) do
		path[i] = {col, '=', {scan = index_scanner, col = col}}
	end
	local base_scanner = db:table_scanner(base_schema.name, path)
	local index_next_group, index_next_pk, index_col_decoder, index_close =
		node.next_group, node.next_pk, node.col_decoder, node.close
	local stale
	function node:next_group()
		stale = true
		return index_next_group(self)
	end
	function node:next_pk()
		stale = true
		return index_next_pk(self)
	end
	function node:col_decoder(want_member, col)
		local f = base_schema.fields[col]
		if not (f and not f.key_index) then
			return index_col_decoder(self, want_member, col)
		end
		local decode = base_scanner:col_decoder(col)
		return function()
			if stale then
				base_scanner.reset()
				base_scanner.advance()
				stale = false
			end
			return decode()
		end
	end
	function node:close()
		base_scanner.close()
		index_close(self)
	end
	return node
end

--EVALUATE RESIDUAL CONDITIONS -----------------------------------------------

--where()/having() treat only false, nil, and null as rejection.
local function expr_passes(v)
	return v ~= nil and v ~= false and v ~= null
end
local function null_value(v)
	return v == nil or v == null
end
--is x a column read (q.col()) that points at an ai_ci field? if so
--both sides must be folded before comparing, not just compared as raw
--text.
local function ai_ci_operand(x)
	return type(x) == 'table' and x[1] == 'col' and x.source
		and ai_ci_col(x.source.schema, x[3])
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
- q.param() reads params.
- q.col() bound to a source (residual: where()/on_expr conditions)
  reads through node:col() -- the member can differ from the step
  that owns the residual.
- q.col() bound to an out_col instead (having(): compile()'s BIND
  COLUMNS stage always binds having() by out_col name, never to a raw
  source col) has no source to read through -- node is the aggregated
  value row itself here, so this reads the field directly by name.
]]
local function eval_value(x, params, node)
	if type(x) ~= 'table' then return x end
	if x[1] == 'param' then return params[x[2]] end
	if x[1] == 'col' then
		if x.source then return node:col(x.source.name, x[3]) end
		return node[x.col.name]
	end
	error('unsupported residual operand: '..tostring(x[1]))
end
--does candidate (ai_ci-folded when fold is set) equal v? null never
--matches, in_()/not_in() alike.
local function candidate_matches(candidate, v, fold)
	if null_value(candidate) then return false end
	if fold then candidate = mdbx_fold_ai_ci(candidate) end
	return v == candidate
end
--[[
evaluate a where()/on_expr row check against the current row. q.col()
reads decoded columns through node:col(), the same node that pk_filter
hands its own fn. probes: {expr -> checker}, filled in lazily by
compile_residual_checkers()/compile_exists_checker() the first time
each attachment site processes its own condition list -- exists()/
not_exists() and in_()/not_in() both look their checker up by the
exists()/in_() expr node itself (not by source: the same source can
appear in more than one occurrence).
]]
local function eval_expr(expr, params, node, probes)
	if type(expr) ~= 'table' then return expr end
	local op, a, b = unpack(expr, 1, 3)
	if op == 'param' or op == 'col' then
		return eval_value(expr, params, node)
	end
	if op == 'and' then
		for i = 2, #expr do
			if not expr_passes(eval_expr(expr[i], params, node, probes)) then
				return false
			end
		end
		return true
	elseif op == 'or' then
		for i = 2, #expr do
			if expr_passes(eval_expr(expr[i], params, node, probes)) then
				return true
			end
		end
		return false
	elseif op == 'is_null' then
		return null_value(eval_expr(a, params, node, probes))
	elseif op == 'is_not_null' then
		return not null_value(eval_expr(a, params, node, probes))
	elseif op == 'starts' then
		local v = eval_expr(a, params, node, probes)
		local prefix = eval_expr(b, params, node, probes)
		if null_value(v) or null_value(prefix) then return false end
		if type(v) ~= 'string' then return false end
		if ai_ci_operand(a) then
			v, prefix = mdbx_fold_ai_ci(v), mdbx_fold_ai_ci(prefix)
		end
		return v:sub(1, #prefix) == prefix
	elseif op == 'in' or op == 'not_in' then
		local v = eval_expr(a, params, node, probes)
		if null_value(v) then return false end
		local fold = ai_ci_operand(a)
		if fold then v = mdbx_fold_ai_ci(v) end
		local found = false
		if inherits(b, Rel) then
			local probe = assertf(probes[expr], 'eval_expr: no in_() probe'
				..' compiled for source: %s', tostring(b.name))
			if probe.values_set then
				--v is already fold()'d above, matching how values_set's own
				--keys were folded when built (compile_exists_checker()) --
				--a direct hash lookup, no per-candidate loop needed.
				found = probe.values_set[v] ~= nil
			else
				for candidate in probe.values() do
					if candidate_matches(candidate, v, fold) then
						found = true
						break
					end
				end
			end
		else
			local param_list = type(b) == 'table' and b[1] == 'param'
			local values = param_list and eval_expr(b, params, node, probes)
				or b
			for _, item in ipairs(values) do
				local candidate = param_list and item
					or eval_expr(item, params, node, probes)
				if candidate_matches(candidate, v, fold) then
					found = true
					break
				end
			end
		end
		if op == 'in' then return found end
		return not found
	elseif op == 'exists' or op == 'not_exists' then
		local probe = assertf(probes[expr], 'eval_expr: no exists probe'
			..' compiled for source: %s', tostring(a.name))
		local found = probe.constant
		if found == nil then found = probe.check_exists() end
		if op == 'exists' then return found end
		return not found
	end
	local va = eval_expr(a, params, node, probes)
	local vb = eval_expr(b, params, node, probes)
	if null_value(va) or null_value(vb) then return false end
	if ai_ci_operand(a) or ai_ci_operand(b) then
		va, vb = mdbx_fold_ai_ci(va), mdbx_fold_ai_ci(vb)
	end
	if op == '=' then return va == vb
	elseif op == '~=' then return va ~= vb
	elseif op == '<' then return value_cmp(va, vb) < 0
	elseif op == '<=' then return value_cmp(va, vb) <= 0
	elseif op == '>' then return value_cmp(va, vb) > 0
	elseif op == '>=' then return value_cmp(va, vb) >= 0
	else error('unsupported condition op: '..tostring(op)) end
end
--evaluate a where()/on_expr row check against the current row.
local function eval_residual(expr, params, node, probes)
	return expr_passes(eval_expr(expr, params, node, probes))
end

--TODO(predicate factories): eval_expr/eval_value (past their exists()/
--in_() cases, now compiled once per attachment site below) still
--re-walk cond.expr's raw AST on every row, and apply_residual/
--apply_having still build a fresh pk_filter/value_filter closure on
--every terminal call for the same rel -- same waste class as
--compile_plan()'s getters, not yet fixed the way the output/group/
--distinct/sort descriptors were (see compile()'s COMPILE OUTPUT
--PIPELINE). Unlike those, this can't just move into compile() as a
--plain data descriptor: the closure reads params, so a rel-level
--precompiled version needs to take params as an argument (a real
--factory) instead of closing over it -- the same shift
--compile_getter()/compile_plan() would need too.

local apply_residual --fw. decl.
local compile_exists_checker --fw. decl.

--[[
compile_exists_checker() every exists()/not_exists()/in_()/not_in()
occurrence in expr, bound to node -- the stable row this attachment
site (one apply_residual()/apply_having() call) checks against. Runs
once per attachment site, before the per-row predicate closure is
built, so eval_expr's own exists()/in_() cases only ever look up an
already-compiled checker in probes, never build one.
]]
local function compile_residual_checkers(db, expr, params, node, probes)
	walk_exists_nodes(expr, function(e)
		compile_exists_checker(db, e, params, node, probes)
	end)
end

--wrap node in a pk_filter checking every unconsumed condition in
--residual (choose_access()'s leftover where()/on_expr conditions for
--this step); a no-op when residual is empty.
function apply_residual(db, node, residual, params, probes)
	if #residual == 0 then return node end
	for _, cond in ipairs(residual) do
		compile_residual_checkers(db, cond.expr, params, node, probes)
	end
	return db:pk_filter(node, function(n)
		for _, cond in ipairs(residual) do
			if not eval_residual(cond.expr, params, n, probes) then
				return false
			end
		end
		return true
	end)
end

--wrap node (a group_by() aggregate's value stream) in a value_filter
--checking every having_conditions entry; a no-op when there are none.
--eval_residual reads having()'s out_col-bound cols straight off the
--aggregated row (see eval_value), so the row itself stands in for the
--node argument here -- there's no pk/getter-backed node at this stage.
--having()'s own exists()/in_() correlation (against the aggregated
--row's out_cols) isn't implemented -- compile_exists_checker() expects
--a pk/getter-backed node, not a value row -- so nothing here compiles
--checkers; if having() ever nests exists()/in_(), eval_expr's own
--assertf catches the missing probe.
local function apply_having(db, node, having_conditions, params, probes)
	if #having_conditions == 0 then return node end
	return db:value_filter(node, function(row)
		for _, cond in ipairs(having_conditions) do
			if not eval_residual(cond.expr, params, row, probes) then
				return false
			end
		end
		return true
	end)
end

--COMPILE EXISTS CHECKERS -----------------------------------------------------

local compile_step --fw. decl.

--probes[expr] is either {check_exists=,close=} / {values=,close=}
--(correlated: a live, reusable check bound to node) or {constant=} /
--{values_set=} (uncorrelated: already answered, nothing left to close).
local function close_probes(probes)
	for _, probe in pairs(probes) do
		if probe.close then probe.close() end
	end
end

--[[
plan a table-source exists()/not_exists()'s own scan -- same
choose_access() a real join/base step uses (no join classification:
exists() only ever runs one seek at a time, so pk_join_seek's
per-driver-row dup-walk never applies here -- a plain, possibly
index-driven pk_scan is the whole story). Runs once, during compile()
(see CLASSIFY EXISTS TARGETS), and is stored on the exists() expr so
compiling its checker only binds getters/builds a node, never re-plans,
on every terminal call.
Second return: whether the correlation reads anything outside source
at all -- if not, the check never depends on the outer row and can be
answered once instead of once per row.
]]
function resolve_exists_plan(source, on_expr)
	local all_conditions = (on_expr == nil or on_expr == true)
		and empty or split_conditions({on_expr}, true)
	local own_sources = {[source.name] = source}
	local plan = choose_access(source, all_conditions)
	for _, cond in ipairs(plan.residual) do
		assert(not references_outside(cond.expr, own_sources),
			'exists(): a correlation not fully covered by one index seek'
				..' is not implemented yet')
	end
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
compile one exists()/not_exists()/in_()/not_in() occurrence (expr) into
probes[expr], bound to node -- the stable row this attachment site
checks against. Called by compile_residual_checkers(), once per
attachment site, before the per-row predicate closure runs.
The probes[expr] guard below is not about a caller reusing one
occurrence in two places -- each occurrence's own table is only ever
reached from where it's written in the AST. It exists because this
same occurrence can be walked twice from here: once directly, by the
outer compile_residual_checkers()'s own walk_exists_nodes() over
on_expr, and once more when the branch below reaches expr.plan.residual
(a leftover subset of that same on_expr) and calls apply_residual() on
it, which walks it again through compile_residual_checkers(). The
guard makes the second walk a no-op.
- expr.correlated (classify_exists_targets(), compile()-time): false
  means the occurrence never reads the outer row at all, so it's
  answered once, right here, and probes[expr] holds the plain
  {constant=} / {values_set=} result instead of a live checker.
- table source (exists()/not_exists() only): one persistent pk_scan,
  built from expr.plan (resolve_exists_plan(), compile()-time) with a
  getter fixed on node -- reset() and check once per outer row, same
  as pk_scan's own open-once-per-run, reseek-per-row design.
- sub-relation source: delegates the whole node chain to compile_step()
  (rel is already fully compiled -- compile() recursed into it at bind
  time through bind_expr's 'exists'/'in' cases), with node passed
  through the same way, so the sub-relation's own base step reads the
  correlation through it instead of params. check_exists() answers
  exists()/not_exists(); values() answers in_()/not_in() by yielding
  the sub-relation's one out_col, decoded off the node, for every row
  of a fresh scan.
Still asserted rather than silently wrong (sub-relation source):
- a union sub-relation -- compile_step() has no access plan to build
  from (compile() skips BUILD ACCESS for a union rel).
- group_by()/having() inside a sub-relation -- aggregating is
  compile_group()'s job, run separately from compile_step() by
  compile_terminal()/Rel:exists(); nothing here calls it yet.
]]
function compile_exists_checker(db, expr, params, node, probes)
	if probes[expr] then return end
	local op = expr[1]
	--exists()/not_exists(): expr[2] is the source, expr[3] is on_expr.
	--in()/not_in(): expr[3] is the source (a sub-relation, the only
	--shape compile_residual_checkers() calls this for); expr[2] is the
	--tested value expr, unrelated to this occurrence's own source.
	local right = (op == 'in' or op == 'not_in') and expr[3] or expr[2]
	local outer_node = expr.correlated and node or nil
	if inherits(right, Rel) then
		assert(not right.union_rels,
			'exists()/in_(): a union sub-relation is not implemented yet')
		assert(not right.group_cols,
			'exists()/in_(): group_by()/having() inside a sub-relation is'
				..' not implemented yet')
		local out_col = right.out_cols and right.out_cols[1]
		if out_col then
			assert(#right.out_cols == 1 and out_col[1] == 'col'
				and out_col.source,
				'in_()/not_in(): sub-relation output must be one plain column')
		end
		local sub_node, sub_probes = compile_step(db, right, params, outer_node)
		if expr.correlated then
			probes[expr] = {
				check_exists = function()
					sub_node:reset()
					return sub_node:next_item() ~= nil
				end,
				values = function()
					sub_node:reset()
					return function()
						if sub_node:next_item() then
							return eval_value(out_col, params, sub_node)
						end
					end
				end,
				close = function()
					sub_node:close()
					close_probes(sub_probes)
				end,
			}
		else
			sub_node:reset()
			if out_col then
				--ai_ci_operand(expr[2]) is a static property of the tested
				--value's own expr, the same for every row -- fold each
				--candidate once, here, instead of per-row at lookup (see
				--eval_expr()'s 'in'/'not_in' case). A null candidate never
				--matches (candidate_matches()'s own rule), so it's simply
				--never added -- a real hash set, not a linear-scanned list.
				local fold = ai_ci_operand(expr[2])
				local set = {}
				while sub_node:next_item() do
					local v = eval_value(out_col, params, sub_node)
					if not null_value(v) then
						set[fold and mdbx_fold_ai_ci(v) or v] = true
					end
				end
				probes[expr] = {values_set = set}
			else
				probes[expr] = {constant = sub_node:next_item() ~= nil}
			end
			sub_node:close()
			close_probes(sub_probes)
		end
	else
		local plan = expr.plan
		local scanner = db:table_scanner(plan.schema.name,
			compile_scan_path(plan, params, outer_node))
		local inner = scan_node(scanner, plan.member)
		if plan.schema.is_index then
			inner = with_base_scanner(db, inner, scanner, plan.schema.val_schema)
		end
		inner = apply_residual(db, inner, plan.residual, params, probes)
		if expr.correlated then
			probes[expr] = {
				check_exists = function()
					inner:reset()
					return inner:next_item() ~= nil
				end,
				close = function() inner:close() end,
			}
		else
			inner:reset()
			probes[expr] = {constant = inner:next_item() ~= nil}
			inner:close()
		end
	end
end

--[[
compile_joined_step(db, node, step, params, probes, registry) -> node

chains one joined step onto node, the driver built so far, via
db:nested_join(node, inner, opts) -- nested_join only needs the generic
node contract from both sides, so every join shape choose_access()'s
classify_join_op() can produce (fk_seek/index_seek/cross) lowers the same
way: inner is a table_scanner built from plan via compile_scan_path(),
correlated against node through compile_scan_param()'s registry lookup
wherever plan's seek/lo/hi/prefix reads an already-registered member --
this is what gives an fk_seek-classified join the same raw-byte reuse
pk_join_seek existed only to provide (see compile_scan_param()), so
pk_join_seek is not needed at all here. registry[step.source.name] is
set so a later step can correlate against this one the same way.

residual applies to inner BEFORE nested_join decides whether this driver
row matched: a left join must null-extend when every raw seek match also
fails the residual, not just when the seek itself found nothing.
Applying residual to the combined row afterward would instead silently
drop the outer row.
]]
local function compile_joined_step(db, node, step, params, probes, registry)
	local plan = step.plan
	local opts = step.join.op == 'left' and {left = true} or nil
	local scanner = db:table_scanner(plan.schema.name,
		compile_scan_path(plan, params, node, registry))
	registry[step.source.name] = scanner
	local inner = scan_node(scanner, step.source.name)
	if plan.schema.is_index then
		inner = with_base_scanner(db, inner, scanner, plan.schema.val_schema)
	end
	inner = apply_residual(db, inner, plan.residual, params, probes)
	return db:nested_join(node, inner, opts)
end

--[[
compile_nested(db, step, params, probes, outer_registry, outer_node) -> inner

builds a left-joined group's own chain (step.nested: the group's base
step, plus any further joins inside the group) into a single node, for
compile_step to wrap in nested_join{left=true} (no from_member: see
below). plan.seek[1] on the group's base is a correlated read of an
outer column (source_operand()/bucket_facts() set it during compile()'s
BIND COLUMNS stage) -- compile_scan_path()/compile_scan_param() already
turn that into a raw {scan=,col=} param against outer_registry, the same
way any joined step's seek does, so the group's base needs no different
treatment than compile_joined_step() gives an ordinary step. This is why
nested_join's from_member/reset_prefix mechanism (built for pk_scan's
getter-seek, which couldn't otherwise read a live outer row per reset())
isn't needed here at all: nested_join's plain inner:reset() already
re-evaluates the scan-param against outer_registry's live scanner on
every outer row.
]]
local function compile_nested(db, step, params, probes, outer_registry,
	outer_node
)
	local base = step.nested[1]
	local plan = base.plan
	assert(plan.schema and plan.schema.is_index,
		'compile_step: nested group base has no index to seek by')
	assert(type(plan.seek[1]) == 'table' and plan.seek[1][1] == 'col'
		and plan.seek[1].source,
		'compile_step: nested group base must correlate on an outer column')
	local scanner = db:table_scanner(plan.schema.name,
		compile_scan_path(plan, params, outer_node, outer_registry))
	local inner = scan_node(scanner, plan.member)
	if plan.schema.is_index then
		inner = with_base_scanner(db, inner, scanner, plan.schema.val_schema)
	end
	inner = apply_residual(db, inner, plan.residual, params, probes)
	--the group's own inner correlations (nested[2..] against nested[1] or
	--each other) are never referenced from outside the group, so they
	--get their own fresh registry, seeded with the base's own scanner.
	local registry = {[plan.member] = scanner}
	for i = 2, #step.nested do
		inner = compile_joined_step(db, inner, step.nested[i], params, probes,
			registry)
	end
	return inner
end

--[[
compile_step(db, rel, params, [outer_node]) -> node, probes

builds the executor node for rel's access plan. rel must already be
compiled (rel:prepare()). params is a shared, reusable table:
overwrite its contents before each node:reset() to run with different
bound values; every getter that the base step's node reads through stays
wired to that same table. outer_node (nil at the top level) threads
through to the base step's compile_plan() the same way, for a
sub-relation compiled as an exists()/in_() checker (compile_exists_checker()).
probes starts empty here and is filled in lazily, by apply_residual()/
apply_having(), the first time each attachment site compiles its own
exists()/in_() occurrences (compile_residual_checkers()) -- callers
close it after their run, the same "build fresh per call" contract
compile_step's own node chain follows, just alongside it instead of
inside it.

Each step past the base chains onto whatever's been built so far:
- a single, un-joined base step -> pk_scan, bound values read through
  params via compile_getter.
- a joined step -> compile_joined_step(), which lowers plan.op
  (choose_access()'s classify_join_op()) directly: 'fk_seek' via
  pk_join_seek, 'index_seek'/'cross' via a getter-driven pk_scan
  wrapped in nested_join. No physical shape is re-derived here.
- a left-joined group (step.nested) -> compile_nested() builds the
  group's own chain, wrapped in nested_join(node_so_far, inner,
  {left = true, from_member = ...}).
Every step's plan.residual (choose_access()'s leftover where()/on_expr
conditions that the seek didn't consume) gets applied via apply_residual()
right after that step's node is built. Once every step is chained on,
rel.late_conditions (attribute_conditions()'s cross-source and
left-joined-member conditions -- see attribute_conditions() and
collect_left_joined_sources()) gets applied the same way, once, over
the whole finished row.

--TODO: a group nested inside another group, and a group base that
doesn't correlate on a plain outer column, aren't wired up yet.
group_by/having/distinct/order_by/limit aren't applied at runtime yet
either.
]]
--[[local]] function compile_step(db, rel, params, outer_node)
	assert(rel.access and #rel.access >= 1, 'compile_step: rel.access missing')
	local probes = {}
	local base = rel.access[1]
	assert(not base.join,
		'compile_step: access[1] must be the un-joined base step')
	local base_plan = base.plan
	local registry = {}
	local base_scanner = db:table_scanner(base_plan.schema.name,
		compile_scan_path(base_plan, params, outer_node, registry))
	registry[base_plan.member] = base_scanner
	local node = scan_node(base_scanner, base_plan.member)
	if base_plan.schema.is_index then
		node = with_base_scanner(db, node, base_scanner,
			base_plan.schema.val_schema)
	end
	node = apply_residual(db, node, base_plan.residual, params, probes)
	for i = 2, #rel.access do
		local step = rel.access[i]
		if step.nested then
			local inner = compile_nested(db, step, params, probes, registry,
				node)
			node = db:nested_join(node, inner, {left = true})
		else
			assert(step.join, 'compile_step: expected a joined step')
			node = compile_joined_step(db, node, step, params, probes, registry)
		end
	end
	node = apply_residual(db, node, rel.late_conditions, params, probes)
	return node, probes
end

mdbx_compile_step = compile_step

--MATERIALIZE ROWS -----------------------------------------------------------

--[[
compile_terminal(db, rel, params) -> node

builds on compile_step()'s access/join chain with the rest of the
pipeline that a terminal needs: select() projection (rel.out_cols), then
distinct/sort/limit as rel's compile()-time flags call for. Order
matches SQL: project, then distinct, then sort, then limit -- the same
order that compile()'s order_by binding already assumes (order_mode is
'out_col' whenever distinct_cols is set, so every order_by() term is
guaranteed to name a projected field, never a pre-distinct one).
rel.distinct_streaming is always false for now (see compile()), so
distinct always goes through hash_distinct, never stream_distinct.
group_by() execution (pk_group/stream_aggregate/hash_aggregate,
having()) is not wired up yet.
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
function split_group_cols(rel)
	local key_cols, agg_list = {}, {}
	for _, expr in ipairs(rel.group_cols) do
		if AGGREGATE_OPS[expr[1]] then
			local value_expr = expr[2]
			assert(value_expr == nil
				or (value_expr[1] == 'col' and value_expr.source),
				'group_by(): only plain column aggregate arguments are'
					..' implemented yet')
			add(agg_list, {name = expr.name, op = expr[1],
				member = value_expr and value_expr.source.name,
				col = value_expr and value_expr[3]})
		else
			assert(expr[1] == 'col' and expr.source,
				'group_by(): only plain column group keys are'
					..' implemented yet')
			add(key_cols, {name = expr.name, member = expr.source.name,
				col = expr[3]})
		end
	end
	local full_agg = {}
	for i, kc in ipairs(key_cols) do
		add(full_agg, {name = kc.name, op = 'key', part = i})
	end
	for _, a in ipairs(agg_list) do add(full_agg, a) end
	return key_cols, full_agg
end

--[[
build the group_by()/aggregate stage of the pipeline: a grand total
(no key cols -- stream_aggregate's cols=nil path, one record, no order
or grouping needed), streamed (rel.group_streaming: pk_group +
stream_aggregate, reading straight off the pk stream, no select()
needed), or hashed (hash_aggregate over a select()'ed value stream --
the fallback whenever grouped order isn't already free). having() is
applied last, over whichever aggregate node was built.
]]
local function compile_group(db, node, rel, params, probes)
	local full_agg = rel.group_full_agg
	if #rel.group_key_cols == 0 then
		node = db:stream_aggregate(node, nil, full_agg)
	elseif rel.group_streaming then
		local cols = rel.group_stream_cols
		node = db:stream_aggregate(db:pk_group(node, cols), cols, full_agg)
	else
		node = db:hash_aggregate(db:select(node, rel.group_hash_outputs),
			rel.group_hash_fields, full_agg)
	end
	return apply_having(db, node, rel.having_conditions, params, probes)
end

local function compile_terminal(db, rel, params)
	assert(rel.out_cols, 'rows()/first()/one()/must_one() require'
		..' select() or group_by()')
	assert(not (rel.group_cols and rel.select_cols),
		'select() after group_by() is not implemented yet')
	local node, probes = compile_step(db, rel, params)
	if rel.group_cols then
		node = compile_group(db, node, rel, params, probes)
	else
		node = db:select(node, rel.output_descriptor)
	end
	if rel.distinct_cols then
		if rel.distinct_streaming then
			node = db:stream_distinct(node, rel.distinct_fields)
		else
			node = db:hash_distinct(node, rel.distinct_fields)
		end
	end
	if rel.sort_needed then
		node = db:value_sort(node, rel.sort_spec)
	end
	if rel._limit ~= nil then
		local n = compile_getter(rel._limit, params)()
		local offset = rel._offset and compile_getter(rel._offset, params)()
		node = db:limit(node, n, offset)
	end
	return node, probes
end

local function bind_params(params)
	return params or empty
end

local function parse_row_args(shape, params) --shape [, params]
	if type(shape) == 'table' then
		--a table first arg is params, so shape and params can't both be tables.
		assert(params == nil, 'row shape must be the first argument')
		return nil, shape
	end
	assert(shape == nil or shape == '[]' or shape == '{}',
		"row shape must be '[]' or '{}'")
	return shape, params
end

--row: {name -> value} (a select() node's :row()). fields: rel.out_cols,
--read in select() order -- '{}' passes the row straight through since
--it's already name-keyed; '[]'/unpacked need it read out positionally.
local function shape_row(fields, row, shape)
	if shape == '{}' then return row end
	local t = {}
	for i, out_col in ipairs(fields) do t[i] = row[out_col.name] end
	if shape == '[]' then return t end
	return unpack(t, 1, #fields)
end

--[[
collect up to cap rows (nil = every row) from rel's terminal node
chain, built fresh for this call (own node tree, own params binding --
matches the old file's per-terminal-call compile). cap stops the pull
loop early once enough rows are collected -- correct for the plain
(no distinct()/explicit sort) case, since next_item() then reads one
row straight off the cursor chain per call. hash_distinct/value_sort
still read every row regardless of cap: both materialise their whole
input during reset(), before next_item() can be called even once.
]]
local function collect_rows(db, rel, params, cap)
	if not rel.compiled then compile(rel) end
	params = bind_params(params)
	local node, probes = compile_terminal(db, rel, params)
	node:reset()
	local rows = {}
	while (not cap or #rows < cap) and node:next_item() do
		add(rows, node:row())
	end
	node:close()
	close_probes(probes)
	return rows
end

function Rel:rows(shape, params)
	shape, params = parse_row_args(shape, params)
	local rows = collect_rows(self.db, self, params, nil)
	local i = 0
	return function()
		i = i + 1
		local row = rows[i]
		if row then return shape_row(self.out_cols, row, shape) end
	end
end

function Rel:first(shape, params)
	shape, params = parse_row_args(shape, params)
	local row = collect_rows(self.db, self, params, 1)[1]
	if row then return shape_row(self.out_cols, row, shape) end
end

function Rel:one(shape, params)
	shape, params = parse_row_args(shape, params)
	local rows = collect_rows(self.db, self, params, 2)
	assert(#rows <= 1, 'one() matched more than one row')
	local row = rows[1]
	if row then return shape_row(self.out_cols, row, shape) end
end

function Rel:must_one(shape, params)
	shape, params = parse_row_args(shape, params)
	local rows = collect_rows(self.db, self, params, 2)
	assert(#rows == 1,
		'must_one() matched '..#rows..' rows, expected exactly one')
	return shape_row(self.out_cols, rows[1], shape)
end

--[[
count()/exists() don't need select()/group_by() at all -- unlike
rows()/first()/one()/must_one(), they can answer from compile_step()'s
raw filtered/joined stream directly, no projection needed. group_by()
still applies: a group's having() can depend on fully accumulated
aggregates, so a group only "exists"/counts once it's finished
(compile_group already applies having()). distinct() changes count()'s
answer (fewer rows) but never exists()'s: a row surviving distinct()
never disappears to zero, so exists() skips it entirely and just
checks the raw stream for any match.
neither respects order_by()/limit(): order never changes a count or
an existence check, and limit()+count()/exists() together isn't a
combination that this API composes (unlike a real SQL subquery LIMIT).
]]
local function count_items(node)
	node:reset()
	local n = 0
	while node:next_item() do n = n + 1 end
	node:close()
	return n
end

local function compile_group_or_distinct(db, rel, params)
	local node, probes = compile_step(db, rel, params)
	if rel.group_cols then
		return compile_group(db, node, rel, params, probes), probes
	end
	if rel.distinct_cols then
		assert(rel.out_cols, 'distinct() requires select() or group_by()')
		node = db:select(node, rel.output_descriptor)
		if rel.distinct_streaming then
			return db:stream_distinct(node, rel.distinct_fields), probes
		end
		return db:hash_distinct(node, rel.distinct_fields), probes
	end
	return node, probes
end

function Rel:count(params)
	if not self.compiled then compile(self) end
	params = bind_params(params)
	local node, probes = compile_group_or_distinct(self.db, self, params)
	local n = count_items(node)
	close_probes(probes)
	return n
end

function Rel:exists(params)
	if not self.compiled then compile(self) end
	params = bind_params(params)
	local node, probes = compile_step(self.db, self, params)
	if self.group_cols then
		node = compile_group(self.db, node, self, params, probes)
	end
	node:reset()
	local found = node:next_item() ~= nil
	node:close()
	close_probes(probes)
	return found
end
