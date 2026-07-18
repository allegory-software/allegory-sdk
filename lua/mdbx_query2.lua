--[[

	mdbx_query: query builder over mdbx_schema.
	Written by Cosmin Apreutesei. Public Domain.

START
	db:from'TABLE [ALIAS]'-> rel  new query from table
	db:from(rel, alias) -> rel    new query from the rows of another query
FILTER
	:where(expr)                  where(e1):where(e2) == where(q.and_(e1, e2))
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
	q.eq/ne/lt/le/gt/ge(a, b)     ==  ~=  <  <=  >  >=
	q.and_(expr1, expr2, ...)
	q.or_(expr1, expr2, ...)
	q.is_[not_]null(expr)
	q.starts(expr, prefix)
	q.between(expr, lo, hi)       q.and_(q.ge(expr,lo), q.le(expr,hi))
	q.[not_]exists(..., on_expr)
	q.[not_]in_(expr, vals|rel)
AGGREGATES (group_by() out_cols only)
	q.count([val_expr])           val_expr: literal | q.param() | q.col()
	q.min|max|sum|avg(val_expr)
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
		db:from('post p')
			:where(q.eq(c'p.status', p'STATUS'))
			:where(q.ge(c'p.score', p'MIN_SCORE'))
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

local C  = C
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

function q.eq(a, b) return {'eq', a, b} end
function q.ne(a, b) return {'ne', a, b} end
function q.lt(a, b) return {'lt', a, b} end
function q.le(a, b) return {'le', a, b} end
function q.gt(a, b) return {'gt', a, b} end
function q.ge(a, b) return {'ge', a, b} end

function q.and_(...) return {'and', ...} end
function q.or_ (...) return {'or', ... } end

function q.between(expr, lo, hi)
	return q.and_(q.ge(expr, lo), q.le(expr, hi))
end

function q.is_null     (expr) return {'is_null'    , expr} end
function q.is_not_null (expr) return {'is_not_null', expr} end

function q.count (expr) return {'count', expr, aggregate = true} end
function q.min   (expr) return {'min'  , expr, aggregate = true} end
function q.max   (expr) return {'max'  , expr, aggregate = true} end
function q.sum   (expr) return {'sum'  , expr, aggregate = true} end
function q.avg   (expr) return {'avg'  , expr, aggregate = true} end

function q.starts(expr, prefix)
	return {'starts', expr, prefix}
end

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

function q.in_   (expr, values) return {'in'    , expr, values} end
function q.not_in(expr, values) return {'not_in', expr, values} end

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
- decide sort/dedup shortcuts; -> sort_needed, next_nodup, distinct_streaming
- collect exists()/in_() targets; residual/late/having -> exists_sources
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
	expr.col = bcol
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
		child_col.col = found_fk.child.cols[col]
		parent_col.source = found_fk.parent
		parent_col.col = found_fk.parent.cols[found_fk.fk.ref_cols[i]]
		exprs[i] = q.eq(child_col, parent_col)
	end
	return #exprs == 1 and exprs[1] or q.and_(unpack(exprs))
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
	if marker.filter then return q.and_(expr, marker.filter) end
	return expr
end

--EXPRESSION BINDING ---------------------------------------------------------

local compile

--bind every col nested in an expression.
local function bind_expr(expr, scope, out_cols, mode, allow_aggregate)
	if type(expr) ~= 'table' then return end
	local op = expr[1]
	if expr.aggregate then
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
		--a source lookup by name (source.cols[col]) only gets one entry,
		--not this whole array, so the position has to live on the entry.
		expr.index = i
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
							join.on_expr = q.and_(join.on_expr, join_where)
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
		if expr.aggregate then return false end
	end
	return true
end
local function dedup_only(rel)
	return (rel.distinct_cols and not rel.group_cols)
		or group_has_no_aggregates(rel)
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
			if not expr.aggregate then
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

--CHOOSE HOW TO READ ONE TABLE -----------------------------------------------

local fact_kind = { --{op->fact kind}
	eq = 'equality',
	lt = 'range', le = 'range', gt = 'range', ge = 'range',
	starts = 'prefix',
	['in'] = 'membership', not_in = 'membership',
	exists = 'existence', not_exists = 'existence',
	is_null = 'null', is_not_null = 'null',
}
--[[
- q.or_(q.eq(col, v1), q.eq(col, v2), ...) means the same thing as
  q.in_(col, {v1, v2, ...}), so we turn it into that shape here.
- once it's an 'in', it can drive an index seek exactly like a real
  in_() would -- nothing else below needs to know it started as an or.
- this only fires when every arm compares the exact same col. two
  different cols, or a col on both sides of one arm, can't collapse
  into one membership check, so we leave those alone.
]]
local function or_as_in(expr)
	if type(expr) ~= 'table' or expr[1] ~= 'or' then return nil end
	local col, values = nil, {}
	for i = 2, #expr do
		local arm = expr[i]
		if type(arm) ~= 'table' or arm[1] ~= 'eq' then return nil end
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
- where()/having() calls combine as q.and_().
- a top-level q.and_() inside one call has the same effect.
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

--walk a rel's own filters so correlated exists()/in_() can be owned by
--the outer source they read.
local function referenced_rel_sources(rel, found, sources)
	if rel.union_rels then
		for _, input in ipairs(rel.union_rels) do
			referenced_rel_sources(input, found, sources)
		end
	else
		for _, cond in ipairs(rel.where_conditions) do
			referenced_sources(cond.expr, found, sources)
		end
	end
end

--[[
- collect this rel's sources read by an expression.
- q.col() nodes count when they bind to this rel.
- exists()/in_() correlations count through on_expr and inner where().
- attribute_conditions() uses how many sources this returns to decide
  whether one source can own a condition.
- a cross-source condition becomes a late condition, checked only
  after every source has been scanned.
]]
--found: {name->true}
--[[local]] function referenced_sources(expr, found, sources)
	if type(expr) ~= 'table' then return end
	local op = expr[1]
	if op == 'col' then
		if expr.source and sources[expr.source.name] == expr.source then
			found[expr.source.name] = true
		end
	elseif op == 'exists' or op == 'not_exists' then
		local right, on_expr = expr[2], expr[3]
		if on_expr then referenced_sources(on_expr, found, sources) end
		if inherits(right, Rel) then
			referenced_rel_sources(right, found, sources)
		end
	elseif op == 'in' or op == 'not_in' then
		referenced_sources(expr[2], found, sources)
		local values_or_rel = expr[3]
		if inherits(values_or_rel, Rel) then
			referenced_rel_sources(values_or_rel, found, sources)
		else
			for _, item in ipairs(values_or_rel) do
				referenced_sources(item, found, sources)
			end
		end
	else
		for i = 2, #expr do
			referenced_sources(expr[i], found, sources)
		end
	end
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
  choose_access() can use for an index seek, even when one exists on
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
--source it reads, when that source isn't left-joined. a condition
--that reads more than one source, or none, or a left-joined source,
--can't be checked before every source has been scanned.
local function attribute_conditions(conditions, sources, left_joined_sources)
	for _, cond in ipairs(conditions) do
		local found = {} --{name->true}
		referenced_sources(cond.expr, found, sources)
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
local flip_range_op = {lt = 'gt', le = 'ge', gt = 'lt', ge = 'le'}
--in_() lists up to IN_UNION_MAX can use repeated exact seeks.
--longer lists stay as residual row checks.
--the cutoff bounds the number of cursor seeks.
local IN_UNION_MAX = 16

--[[
- pull facts out of access conditions that read only this source.
- supported facts: equality, range, prefix, membership, null.
- facts are bucketed by col.
- each col gets one fact per kind.
- a later condition for a (col,kind) slot that's already filled is
  left unconsumed, so it stays a residual check.
- keeping the first fact per (col,kind) picks an arbitrary but valid
  seek; it never changes query correctness.
]]
local function bucket_facts(source, conditions, sources)
	--{col->{cond=,expr=[,op=]}}
	local eq, lo, hi, prefix, in_by = {}, {}, {}, {}, {}
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
					local bucket = (rop == 'gt' or rop == 'ge') and lo or hi
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
			elseif cond.kind == 'membership' then
				local left, values = expr[2], expr[3]
				if expr[1] == 'in' and type(values) == 'table'
					and not inherits(values, Rel)
					and not (type(values) == 'table' and values[1] == 'param')
					and #values <= IN_UNION_MAX
					and type(left) == 'table' and left[1] == 'col'
					and left.source == source
				then
					--seek values must be known before this source is scanned.
					local self_ref = false
					for _, item in ipairs(values) do
						local found = {} --{name->true}
						referenced_sources(item, found, sources)
						if found[source.name] then self_ref = true; break end
					end
					if not self_ref and not in_by[left[3]] then
						in_by[left[3]] = {cond = cond, exprs = values}
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
						lo[col] = {cond = cond, op = 'gt', expr = null}
					end
				end
			end
		end
	end
	return eq, lo, hi, prefix, in_by
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
local function try_key(schema, eq, lo, hi, prefix, in_by)
	local pk = schema.pk
	local depth = eq_depth(schema, eq)
	if depth == #pk then
		return {kind = 'exact', depth = depth}
	end
	local nc = pk[depth + 1]
	local nc_seekable = nc and (schema.is_index or not ai_ci_col(schema, nc))
	if #pk == 1 and depth == 0 and nc_seekable and in_by[nc] then
		return {kind = 'in', depth = 0, bound_col = nc}
	end
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
local kind_rank =
	{exact = 2, ['in'] = 2, range = 1, prefix = 1, eq_prefix = 0}
local function plan_coverage(plan)
	if plan.kind == 'in' then return 1 end
	if plan.kind == 'range' or plan.kind == 'prefix' then
		return plan.depth + 1
	end
	return plan.depth
end

--[[
- what order the rows come out in if we scan this key.
- if an ai_ci col is fixed to one value at the start (an "=" match),
  we still count it as fixed: every row we keep really does have the
  same real text, because we double-check it later, so the cols after
  it still sort correctly.
- if an ai_ci col comes later, varying, we can only trust its order
  when this schema is the index that stores the folded text. the table
  itself, or a plain index, stores the real text, which sorts
  differently -- so we stop here instead of claiming an order we can't
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
- choose the key that drives this source's scan.
- candidates are the source's pk and its indexes.
- consumed conditions are marked on the chosen plan.
- unconsumed conditions become residual row checks.
- key_conditions vs all_conditions: for a joined source, only the
  join's own on_expr can drive the key (see access_conditions()) --
  all_conditions is the wider set used for the residual list, so a
  where() condition on this source that isn't part of the join still
  ends up checked, just never as (or extending) the seek itself.
]]
local function choose_access(source, key_conditions, all_conditions,
	sources, order_terms, prefer_order, group_terms)
	--rel sources have no pk or index metadata here.
	--they scan the already-compiled inner rel.
	--virtual tables have no pk or index metadata either: no physical
	--storage means no seek, so every condition on them stays residual.
	if not source.table or source.schema.virtual then
		return {kind = 'full', depth = 0, dir = 'asc', is_pk = false,
			schema = false, seek = empty, residual = all_conditions}
	end
	local eq, lo, hi, prefix, in_by =
		bucket_facts(source, key_conditions, sources)
	local candidates = {} --{{schema=,is_pk=}...}
	add(candidates, {schema = source.schema, is_pk = true})
	for _, ix in ipairs(source.schema.indexes or empty) do
		add(candidates, {schema = ix})
	end
	local best_cand, best_plan, best_cov
	local order_cand, order_plan
	local group_cand, group_plan
	for _, cand in ipairs(candidates) do
		local plan = try_key(cand.schema, eq, lo, hi, prefix, in_by)
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
			{schema = source.schema, is_pk = true}, {kind = 'full', depth = 0}
	end
	best_plan.schema = best_cand.schema
	best_plan.is_pk = best_cand.is_pk
	best_plan.dir = best_plan.dir or 'asc' --order_plan may already carry 'desc'
	local seek = {} --{expr...}: one value-operand expr per matched leading col
	for i = 1, best_plan.depth do
		local fact = eq[best_cand.schema.pk[i]]
		seek[i] = fact.expr
		fact.cond.consumed = true
	end
	best_plan.seek = seek
	if best_plan.kind == 'in' then
		local fact = in_by[best_plan.bound_col]
		best_plan.in_values = fact.exprs
		fact.cond.consumed = true
	elseif best_plan.kind == 'range' then
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
	for _, cond in ipairs(all_conditions) do
		if not cond.consumed then
			add(residual, cond)
		end
	end
	best_plan.residual = residual
	return best_plan
end

--[[
- returns key_conditions, all_conditions.
- all_conditions include join on_expr conditions plus where()
  conditions that read only this source; join_deps() schedules
  on_expr inputs before this source scans.
- key_conditions is what choose_access() may use to drive the seek.
  for a joined source, that's the join's own on_expr conditions only
  -- a where() condition on this source never overrides or extends
  the join key, it just rides along in all_conditions as a residual
  check once the key is chosen. for the base (un-joined) source,
  there's no join to single out, so every where() condition here is
  key-eligible and both lists are the same one.
]]
local function access_conditions(source, join, where_conditions)
	local all_list = {} --{condition...}
	if join then
		for _, cond in ipairs(join.on_conditions) do add(all_list, cond) end
	end
	for _, cond in ipairs(where_conditions) do
		if cond.source_name == source.name then add(all_list, cond) end
	end
	if not join then return all_list, all_list end
	local key_list = {} --{condition...}
	for _, cond in ipairs(join.on_conditions) do add(key_list, cond) end
	return key_list, all_list
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
	--separate seeks: no one key order.
	if plan.kind == 'in' then return empty end
	return key_order(step.source, plan.schema, plan.depth,
		plan.dir == 'desc')
end

--SCHEDULE JOINS -------------------------------------------------------------

--a join can run after every outside source its on_expr reads is
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
  source that isn't scheduled yet. among ties, keep the order joins
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
			local key_conditions, all_conditions =
				access_conditions(base_source, picked, where_conditions)
			local base_step = {source = base_source, join = false,
				plan = choose_access(base_source, key_conditions,
					all_conditions, sources)}
			if picked.op ~= 'left' then
				add(access, base_step)
				scheduled[base_source.name] = true
				build_access(group.joins, scheduled, access, sources,
					where_conditions)
			else
				local nested_scheduled = {[base_source.name] = true}
				local nested = {base_step} --{step...}
				build_access(group.joins, nested_scheduled, nested, sources,
					where_conditions)
				add(access, {source = false, join = picked, nested = nested})
			end
		else
			local key_conditions, all_conditions =
				access_conditions(picked.right, picked, where_conditions)
			add(access, {source = picked.right, join = picked,
				plan = choose_access(picked.right, key_conditions,
					all_conditions, sources)})
			scheduled[picked.right.name] = true
		end
	end
end

--COLLECT EXISTS TARGETS -----------------------------------------------------

--[[
- collect every exists()/not_exists()/in_()/not_in() source this
  rel's own residual/late/having checks can reach -- a plain table or
  a whole subquery -- so execution can open them all once per run
  instead of opening one fresh per row.
- recurses into on_expr and in_()'s value expr: one of these can nest
  another exists()/in_() inside it.
]]
local function collect_exists_sources(expr, entries, seen)
	if type(expr) ~= 'table' then return end
	local op = expr[1]
	if op == 'exists' or op == 'not_exists' then
		local right, on_expr = expr[2], expr[3]
		if not seen[right] then
			seen[right] = true
			add(entries, {source = right, on_expr = on_expr})
		end
		if on_expr then collect_exists_sources(on_expr, entries, seen) end
	elseif (op == 'in' or op == 'not_in') and inherits(expr[3], Rel) then
		local values_rel = expr[3]
		if not seen[values_rel] then
			seen[values_rel] = true
			add(entries, {source = values_rel})
		end
		collect_exists_sources(expr[2], entries, seen)
	else
		for i = 2, #expr do
			collect_exists_sources(expr[i], entries, seen)
		end
	end
end
local function collect_step_exists(step, entries, seen)
	if step.nested then
		for _, s in ipairs(step.nested) do
			collect_step_exists(s, entries, seen)
		end
	else
		for _, cond in ipairs(step.plan.residual) do
			collect_exists_sources(cond.expr, entries, seen)
		end
	end
end

--COMPILE DRIVER -------------------------------------------------------------

MDBX_NO_NEXT_NODUP = false --bench override, see compile()'s next_nodup check

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
		local base_key_conditions, base_all_conditions =
			access_conditions(base_source, false, rel.where_conditions)
		add(access, {source = base_source, join = false,
			plan = choose_access(base_source, base_key_conditions,
				base_all_conditions, sources, source_order_terms, prefer_order,
				source_group_terms)})
		build_access(rel.joins, {[base_source.name] = true}, access, sources,
			rel.where_conditions)
		rel.natural_order = natural_order(access[1])
		--TODO: the execution stage still needs an opener for each access
		--step (old file's prepare_scans: compile_scan/compile_relation_
		--scan/compile_virtual_scan) -- blocked on the execution stage,
		--which isn't ported yet.

		--[[
		- distinct(), and group_by() with no aggregate outputs, can skip a
		  whole duplicate group at the cursor via MDBX_NEXT_NODUP instead
		  of decoding every duplicate row -- only when the group is the
		  literal DUPSORT boundary: the returned cols must cover the WHOLE
		  remaining index key, not just a prefix.
		- a residual check or a second access step could pick a different
		  row out of the same group, so skipping unseen duplicates would
		  be wrong unless neither exists.
		- 'exact'/'in' plans leave no varying key cols to group over.
		- MDBX_NEXT_NODUP is forward-only; excludes dir == 'desc'.
		]]
		if dedup_only(rel) and #access == 1 and not MDBX_NO_NEXT_NODUP then
			local plan = access[1].plan
			local kind_ok = plan.kind == 'full' or plan.kind == 'range'
				or plan.kind == 'prefix' or plan.kind == 'eq_prefix'
			if kind_ok and plan.schema and plan.schema.is_index
				and plan.dir ~= 'desc' and #plan.residual == 0
				and #late_conditions == 0
			then
				local terms = returned_source_terms(rel, dedup_key_cols(rel))
				if terms then
					local ok, n_wanted =
						order_satisfied_set(terms, rel.natural_order)
					if ok and plan.depth + n_wanted == #plan.schema.pk then
						plan.next_nodup = true
					end
				end
			end
		end
	end

	--SORT AND DEDUP ----------------------------------------------------------

	--[[
	- whether an explicit sort is needed is fully decided by what's
	  already been set above (order_cols, natural_order, group_cols,
	  distinct_cols) -- decide it once here, instead of recomputing it on
	  every execution.
	- distinct_streaming (skip adjacent duplicates at the cursor instead
	  of hashing) needs terms_group_consecutive() from the execution
	  stage, not yet ported; always hashing is correct, just not the
	  fastest path yet.
	]]
	rel.sort_needed = sort_actually_needed(rel)
	--TODO: always false; needs terms_group_consecutive() from the
	--execution stage to actually stream instead of hash.
	rel.distinct_streaming = false

	--COLLECT EXISTS TARGETS --------------------------------------------------

	local exists_sources, exists_seen = {}, {}
	for _, step in ipairs(rel.access or empty) do
		collect_step_exists(step, exists_sources, exists_seen)
	end
	for _, cond in ipairs(late_conditions) do
		collect_exists_sources(cond.expr, exists_sources, exists_seen)
	end
	for _, cond in ipairs(rel.having_conditions) do
		collect_exists_sources(cond.expr, exists_sources, exists_seen)
	end
	rel.exists_sources = exists_sources

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
]]
--TODO: a q.col() expr (a correlated read of another, already-scheduled
--source) isn't handled -- not reachable for a single, un-joined access
--step; needed once joins are wired up.
local function compile_getter(expr, params)
	if type(expr) == 'table' and expr[1] == 'param' then
		local name = expr[2]
		return function() return params[name] end
	end
	return function() return expr end
end

--turn one choose_access() plan (schema/depth/dir plus exprs) into the
--shape pk_scan() expects (same schema/depth/dir, but every bound expr
--replaced by a getter).
local function compile_plan(plan, params)
	local seek = {}
	for i, expr in ipairs(plan.seek) do
		seek[i] = compile_getter(expr, params)
	end
	local node_plan = {
		kind = plan.kind, schema = plan.schema, depth = plan.depth,
		dir = plan.dir, seek = seek,
	}
	if plan.lo then
		node_plan.lo = {op = plan.lo.op,
			get = compile_getter(plan.lo.expr, params)}
	end
	if plan.hi then
		node_plan.hi = {op = plan.hi.op,
			get = compile_getter(plan.hi.expr, params)}
	end
	if plan.prefix then
		node_plan.prefix = compile_getter(plan.prefix, params)
	end
	return node_plan
end

--[[
compile_step(db, rel, params) -> node

builds the executor node for rel's access plan. rel must already be
compiled (rel:prepare()). params is a shared, reusable table:
overwrite its contents before each node:reset() to run with different
bound values; every getter the base step's node reads through stays
wired to that same table.

Two shapes are handled so far:
- a single, un-joined base step -> pk_scan, bound values read through
  params via compile_getter.
- that plus exactly one joined step whose chosen plan uses an index
  (step.plan.schema.is_index) -> pk_join_seek(outer_node, plan.schema
  [, {left = true}] when step.join.op == 'left'). Whether that index
  is actually the join's own FK relationship isn't checked here --
  pk_join_seek's own find_fk() already does that check, so there's no
  reason to duplicate it. pk_join_seek never reads plan.kind/seek/lo/hi
  at all (it reads the outer row's raw PK bytes directly instead of
  decoding+re-encoding a value), so none of that gets compiled for
  this step.

--TODO: anything past one join, a joined step whose plan isn't an
index at all (no relevant index exists -- a different, not-yet-built
execution strategy), or a nested join group isn't wired up yet.
group_by/having/distinct/order_by/limit aren't applied at runtime
yet either.
]]
local function compile_step(db, rel, params)
	assert(rel.access and #rel.access >= 1, 'compile_step: rel.access missing')
	local base = rel.access[1]
	assert(not base.join,
		'compile_step: access[1] must be the un-joined base step')
	local node = db:pk_scan(compile_plan(base.plan, params))
	if #rel.access == 1 then return node end
	assert(#rel.access == 2, 'compile_step: only one join is wired up so far')
	local step = rel.access[2]
	assert(step.join and not step.nested,
		'compile_step: only a plain (non-nested) join is wired up so far')
	assert(step.plan.schema and step.plan.schema.is_index,
		'compile_step: joined step has no index to seek by')
	local opts = step.join.op == 'left' and {left = true} or nil
	return db:pk_join_seek(node, step.plan.schema, opts)
end

mdbx_compile_step = compile_step
