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
	q.col('REL.COL|NAME')         column reference; REL: rel/table alias/name
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


IMPLEMENTATION CONCEPTS

- rel (relation): query object.
- source: wrapper over table or rel with name + cols.
- scope: namespace for sources and cols. group_by and exists create scopes.
- join group: rel without terminals used to join with.

]]

--if not ... then require'mdbx_query_test'; return end

require'mdbx_schema'

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

--TABLE SOURCES + FK ---------------------------------------------------------

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
		elseif mode == 'out_col' then
			bind_out_col(expr, out_cols)
		elseif mode == 'out_col_or_source' and not rel_name
			and out_cols and out_cols[col] then
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
			--in_()'s relation must return exactly one col: one value per row to compare against.
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
	assertf(not sources[source.name],
		'duplicate source: %s', source.name)
	add(sources, source)
	sources[source.name] = source
end

--virtual tables have no physical storage: their schema comes from paper schema,
--not through db:table_schema(), which only knows about real tables.
--[[local]] function resolve_table_source(db, tbl, alias)
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
local function resolve_rel_source(inner, name, what)
	compile(inner)
	--only select()/group_by() give a relation named cols to use as a rows source.
	local out_cols = assert(inner.out_cols,
		what..' requires select() or group_by()')
	return {
		rel = inner,
		name = name,
		cols = out_cols,
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
			--get join group's sources recursively before moving where() clauses.
			local join_sources = resolve_sources(join_rel)
			--move join group's where() clauses out into rel.
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

--COMPILE DRIVER -------------------------------------------------------------

--[[local]] function compile(rel, parent_scope)
	assert(not rel.compiled)
	rel.compiled = true
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
	rel.group_cols = resolve_out_cols(rel.group_cols)
	rel.select_cols = resolve_out_cols(rel.select_cols)
	rel.out_cols = rel.select_cols or rel.group_cols or union_out_cols
	rel.distinct_cols = resolve_distinct(rel.distinct_cols, rel.out_cols)
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
	assert(not rel.havings or rel.group_cols,
		'having() requires group_by()')
	for _, expr in ipairs(rel.havings or empty) do
		bind_expr(expr, group_scope, rel.group_cols, 'out_col')
	end
	local order_mode = (rel.group_cols or rel.distinct_cols)
		and 'out_col' or 'out_col_or_source'
	local order_scope = rel.group_cols and group_scope or rel.scope
	for _, expr in ipairs(rel.order_cols or empty) do
		bind_expr(expr, order_scope, rel.out_cols, order_mode)
	end
	local function bind_joins(joins)
		for _, join in ipairs(joins) do
			if type(join.on_expr) == 'table' and join.on_expr.fk then
				join.on_expr = resolve_fk(join.on_expr, join.right,
					sources, 'fk_join')
			end
			bind_expr(join.on_expr, rel.scope)
			if inherits(join.right, Rel) then
				bind_joins(join.right.joins or empty)
			end
		end
	end
	bind_joins(rel.joins or empty)
	for _, expr in ipairs(rel.wheres or empty) do
		bind_expr(expr, rel.scope)
	end
end
