--[[

	mdbx_query: query builder over mdbx_schema.
	Written by AI / Cosmin Apreutesei. Public Domain.

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
	:cross_join(...)              :join(..., on_expr = true)
	:semi_join(...)               :where(q.exists(table|rel,alias, on_expr))
	:anti_join(...)               :where(q.not_exists(table|rel,alias, on_expr))
SET
	:union(rel) -> rel            union-all (no dedup; use distinct() for that)
GROUP
	:group(outputs)               {{q.col() | agg_expr, name}, ...}
	:having(expr)                 post-group filter; requires :group()
DISTINCT
	:distinct([cols])             dedup by returned fields, or cols if given
ORDER
	:order_by(order)              'MEMBER.COL [desc], ...' | {{q.col(), [dir]}, ...}
LIMIT
	:limit(n, [offset])
EXPRESSIONS
	q = mdbx_query
	q.col('MEMBER.COL|NAME')      field ref; MEMBER: table-alias/rel-alias/table-name
	q.param(name)                 bound value at execution
	q.outer('MEMBER.COL')         field ref but must be in parent scope
	q.eq/ne/lt/le/gt/ge(a, b)     ==  ~=  <  <=  >  >=
	q.and_(expr1, expr2, ...)
	q.or_(expr1, expr2, ...)
	q.is_[not_]null(expr)
	q.starts(expr, prefix)
	q.between(expr, lo, hi)       q.and_(q.ge(expr,lo), q.le(expr,hi))
	q.[not_]exists(..., on_expr)
	q.[not_]in_(expr, vals|rel)
AGGREGATES (group() outputs only)
	q.count([val_expr])           val_expr: literal | q.param() | q.col()
	q.min|max|sum|avg(val_expr)
SELECT
	:select(outputs)              {'MEMBER.COL [NAME]' | {q.col(), name}, ...}
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
	:use_index(member, index_name)        force an index for one member
	:no_index(member [, index_name])      forbid one index, or all, for one member
	:prepare([terminal_kind])             compile now; raises compile errors at load time

TODO: SET OPERATIONS
	:intersect(source)            set intersection over returned fields
	:except(source)               set difference over returned fields
	:lateral(source [, alias] [, opts])    dependent join; opts.left keeps unmatched
TODO: DML
	:update(assignments [, opts]) -> dml   assignments: {col_name -> expr}
	:delete([opts]) -> dml
	dml:returning(outputs) -> dml           output rows for changed target rows
	dml:run([params]) -> n                  execute; return affected row count
	dml:rows([params]) -> iterator -> row   execute; requires returning()

ROW FORMATS (the `shape` arg of terminals):

	rows()    ->  iter()  ->  val1, ..., valN
	rows'[]'  ->  iter()  ->  {val1, ..., valN}
	rows'{}'  ->  iter()  ->  {name1=val1, ..., nameN=valN}

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

SEMANTICS

mutation, lifecycle
	- rel:where(a) -> rel -- same rel, mutated, not a copy
	- rel used as a source, or compiled -> single-use; reusing it, or
		compiling it for a different terminal, raises
	- call order doesn't matter -- always runs:
		source -> where -> group -> having -> select -> distinct -> order_by -> limit
	- :select/:group/:distinct/:order_by/:limit -- set-once, 2nd call raises
	- :where/:having/:use_index/:no_index -- accumulate across calls
	- :prepare() -- terminal_kind defaults to 'rows'

relation sources
	- db:from(rel, alias), :join(rel, alias, on) -- need rel:select()/
		:group() already set; only rel's returned fields are visible,
		under alias
	- wrap a rel this way to keep querying past select/group/distinct/limit
	- :join(rel, on_expr) with no alias -- a "join group": members and
		where() merge directly into this query, nothing hidden
	- left_join() on a group null-extends the whole group at once, not
		table by table

fk_join() family
	- fk_join/fk_left_join/where_has/where_hasnt -- raise unless exactly
		one FK path exists to some other member
	- ambiguous or missing FK -> use join()/left_join() with an explicit on_expr
	- where_has(t, filter) -- filter ANDs into the exists() itself, not
		the outer where()

union()
	- rel:union(r):where(...) -- raises; only rows/first/one/must_one/
		rows_array/count/exists work on a union (wrap it in from() to
		keep building)
	- both sides need select()/group() already set, same fields, same order

group(), having()
	- :group{{col, 'k'}, {q.sum(x), 's'}} -- non-agg outputs are the key,
		agg outputs are the aggregates
	- :group{{q.param('x'), 'k'}} -- raises: a literal/param key would be
		the same for every row
	- :group{{q.sum(x), 's'}} over no rows -> one row, count() = 0, other
		aggregates nil
	- :having(expr) -- reads group() outputs only, never table fields

distinct(), order_by()
	- :distinct'a' -- dedups by a, but still returns every selected/
		grouped field
	- :order_by'a desc' -- nulls first on asc, last on desc
	- :order_by() -- table fields not in the returned row only work with
		no group()/distinct(); with either, returned fields only

field scope
	- member = alias, or table name when there's no alias
	- q.col('x') in where()/group()/on_expr -> source field; in having()/
		order_by() (grouped or distinct) -> output field
	- q.outer('m.c') -- same resolution as q.col('m.c'), plus: raises
		unless it resolves outside the current relation
	- q.outer() -- legal only inside a join group or an exists()/in_()
		subquery, and only from where(), not having()

expressions
	- no +, .., case, coalesce, or cast -- only what's in the cheat sheet above
	- :limit(p'N', p'OFF') is fine -- any data value can be a param;
		names/aliases/directions/opts can't
	- q.param('x') missing from params -> raises; explicit nil -> ok;
		extra keys in params -> ignored
	- q.in_(x, {}), or all-nil candidates -> false; relation form needs
		exactly one returned field

comparisons, aggregates
	- q.eq(col, nil) -> false, never an error; not the same as is_null(col)
	- q.eq(int_col, 'x') -- mismatched kinds raise at compile
	- avg() is always a float, even over an integer column

nulls
	- returned rows use plain nil for null; no separate null value
	- no SQL "unknown" state: any comparison touching null/nil is just false
	- q.not_in(x, vals) -> false (not true) when x is nil
	- left_join(t):where(q.eq(t.c, v)) -- drops unmatched rows too (t.c
		reads nil there) -> acts like inner join; use q.is_null(t.c) instead
	- distinct(), group() keys, union() -- treat nil == nil; comparisons don't

select()
	- reads table fields with no group(), group() outputs with one; never both

terminals
	- rows/first/one/must_one/rows_array need select()/group(); count/exists don't
	- rows(params) with no shape -- the one arg given is params, not shape
	- first() takes the first row silently; one() -- nil for zero rows but
		raises for more than one; must_one() -- raises for zero or more than one

explain()
	- reports, per member: scan used (pk/index + seek facts), row checks,
		group/distinct/sort/limit steps, whether sort/limit reached a cursor

]]

if not ... then require'mdbx_query_test'; return end

require'mdbx_schema'

local C  = C
local Db = mdbx_db

--PARSING --------------------------------------------------------------------

local function parse_name(s)
	return assertf(s:match'^[_A-Za-z][_A-Za-z0-9]*$', 'invalid name: %s', s)
end

local function parse_token_alias(s, what) --'TABLE|[MEMBER.]COL [ALIAS]'
	local token, alias = s:match'^(%S+)%s*(%S*)$'
	assertf(token, 'invalid %s spec: %s', what, s)
	return token, alias ~= '' and parse_name(alias) or nil
end

local function parse_table_spec(s) --'TABLE [ALIAS]'
	local table_name, alias = parse_token_alias(s, 'table')
	return {kind = 'table', table = parse_name(table_name), alias = alias}
end

local function parse_field_ref(s, allow_no_member) --'[MEMBER.]COL'
	local member, col = s:match'^([^.]+)%.([^.]+)$'
	if member then
		return parse_name(member), parse_name(col)
	else
		assertf(allow_no_member, 'invalid field reference: %s', s)
		return false, parse_name(s)
	end
end

local function parse_col_spec(s) --'MEMBER.COL [ALIAS]'
	local field, name = parse_token_alias(s, 'column')
	local member, col = parse_field_ref(field)
	return {'col', member, col}, name or col
end

--col: a q.col() expr, or the plain string q.col() takes.
local function order_by_term(col, dir)
	dir = dir or 'asc'
	assertf(dir == 'asc' or dir == 'desc', 'order_by: invalid direction: %s', dir)
	if isstr(col) then
		local member, c = parse_field_ref(col, true)
		col = {'col', member, c}
	end
	return {col, dir}
end

--spec: '[MEMBER.]COL [asc|desc], ...' | {{col1[, dir1]}, ...}
local function parse_order_by(spec)
	local terms = {} --{term...}
	if isstr(spec) then
		for s in spec:gmatch('[^,]+') do
			local field, dir = parse_token_alias(s:trim(), 'order_by')
			add(terms, order_by_term(field, dir))
		end
	else
		for _, t in ipairs(spec) do
			add(terms, order_by_term(t[1], t[2]))
		end
	end
	return terms
end

local function parse_outputs(outputs, parse_col_spec) --{'MEMBER.COL [ALIAS]'|{expr, name}, ...}
	local parsed = {} --{output...}
	for i, output in ipairs(outputs) do
		if isstr(output) then
			assertf(parse_col_spec, 'invalid output column spec: %s', output)
			local expr, name = parse_col_spec(output)
			parsed[i] = {expr, name}
		else
			local _, name = unpack(output, 1, 2)
			parse_name(name)
			parsed[i] = output
		end
	end
	return parsed
end
--spec: 'COL, ...'
local function parse_distinct_cols(spec)
	local cols = {} --{name...}
	for s in spec:gmatch('[^,]+') do
		add(cols, parse_name(s:trim()))
	end
	return cols
end
local function parse_select_outputs(outputs) --{'MEMBER.COL [ALIAS]'|{col, name}, ...}
	return parse_outputs(outputs, parse_col_spec)
end
local function parse_group_outputs(outputs) --{{col, name}|{agg_expr, name}, ...}
	return parse_outputs(outputs)
end

local function alias_on(a2, a3) --'alias',on_expr | on_expr | nil
	if isstr(a2) then
		return a2, a3 --'alias', on_expr
	else
		return nil, a2 --on_expr
	end
end

--RELATION VALUES ------------------------------------------------------------

--relation values are mutable; methods append to self in place.
local Rel = {}

local function is_relation(v)
	return inherits(v, Rel)
end

--relations are single-use.
--compile() binds field refs in place.
--reuse would rebind expr trees to whichever query compiles last.
local function mark_used(rel)
	assert(not rel.used, 'relation already used')
	rel.used = true
end

local function parse_source(source, alias) --'TABLE [ALIAS]' | rel
	if isstr(source) then
		--table aliases are part of the table spec; alias arguments are for relations.
		assert(not alias, 'table alias must be inline')
		return parse_table_spec(source)
	else
		alias = alias and parse_name(alias) or nil
		mark_used(source)
		return source, alias
	end
end

local function list_part(PART, make)
	Rel[PART] = empty --class default; each instance creates its own list on first append.
	make = make or function(v) return v end
	return function(self, ...)
		local list = rawget(self, PART)
		if not list then
			list = {} --{entry...}
			self[PART] = list
		end
		list[#list + 1] = make(...)
		return self
	end
end
local function once_part(PART, method, make)
	make = make or function(v) return v end
	return function(self, ...)
		--only one value can be stored for this query part.
		assert(self[PART] == nil, method..'() already set')
		self[PART] = make(...)
		return self
	end
end
Rel.where    = list_part'wheres'
Rel.having   = list_part'havings'
Rel.select   = once_part('select_outputs', 'select', parse_select_outputs)
Rel.group    = once_part('group_outputs', 'group', parse_group_outputs)
Rel.order_by = once_part('order_by_terms', 'order_by', parse_order_by)
--distinct_rows: true (dedup by all returned fields) or {name...} (cols given).
Rel.distinct = once_part('distinct_rows', 'distinct', function(cols)
	return cols and parse_distinct_cols(cols) or true
end)
--index_name matches schema.indexes[i].name (mdbx_schema's format_ix_name:
--'table/col1,col2[:desc]'), not a bare identifier, so it isn't parse_name()'d;
--choose_access() already rejects an unknown name with a clear error.
Rel.use_index = list_part('use_indexes', function(member, index_name)
	return {member = parse_name(member), index_name = index_name}
end)
Rel.no_index = list_part('no_indexes', function(member, index_name)
	return {member = parse_name(member), index_name = index_name}
end)
Rel.limit = once_part('limit_rows', 'limit', function(n, offset)
	return {n = n, offset = offset}
end)
local function join_part(kind)
	return list_part('joins', function(right, a2, a3)
		local alias, on = alias_on(a2, a3)
		local source
		source, alias = parse_source(right, alias)
		return {kind = kind, right = source, alias = alias, on = on}
	end)
end
Rel.join      = join_part'join'
Rel.left_join = join_part'left_join'

function Rel:cross_join(right)
	return self:join(right, true)
end

--source is a table spec string or a relation.
--alias only applies when source is a relation.
function Db:from(source, alias)
	source, alias = parse_source(source, alias)
	local rel = {db = self, source = source, alias = alias}
	return object(Rel, rel)
end

--EXPRESSION VALUES ----------------------------------------------------------

--expression values are arrays tagged by a kind string in slot 1.
--shape: {kind, ...operands}.
--plain Lua values stay unwrapped as literals.
local q = {} --{name->fn}
mdbx_query = q

function q.col(s)
	local member, col = parse_field_ref(s, true)
	return {'col', member, col}
end

function q.outer(s)
	local member, col = parse_field_ref(s)
	return {'outer', member, col}
end

function q.param (name) return {'param', parse_name(name)} end

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

--aggregate markers, legal only in group() outputs (checked at compile).
function q.count (val_expr) return {'count', val_expr} end
function q.min   (val_expr) return {'min'  , val_expr} end
function q.max   (val_expr) return {'max'  , val_expr} end
function q.sum   (val_expr) return {'sum'  , val_expr} end
function q.avg   (val_expr) return {'avg'  , val_expr} end

function q.starts(expr, prefix)
	return {'starts', expr, prefix}
end

--table source aliases stay in expr.alias because on can be nil.
--aliased relation sources are wrapped as {'exists', source}.
local function exists_expr(op, right, a2, a3)
	local alias, on = alias_on(a2, a3)
	--an aliased relation exposes returned fields through a normal source.
	--put on_expr on that source so the regular where path evaluates it.
	if is_relation(right) and alias then
		local source = right.db:from(right, alias)
		if on ~= nil and on ~= true then source:where(on) end
		return {op, source}
	end
	local source
	source, alias = parse_source(right, alias)
	return {op, source, on, alias = alias}
end

function q.exists(right, a2, a3)
	return exists_expr('exists', right, a2, a3)
end

function q.not_exists(right, a2, a3)
	return exists_expr('not_exists', right, a2, a3)
end

function q.in_(expr, values)
	if is_relation(values) then mark_used(values) end
	return {'in', expr, values}
end
function q.not_in(expr, values)
	if is_relation(values) then mark_used(values) end
	return {'not_in', expr, values}
end

function Rel:semi_join(right, a2, a3)
	return self:where(q.exists(right, a2, a3))
end

function Rel:anti_join(right, a2, a3)
	return self:where(q.not_exists(right, a2, a3))
end

--SCHEMA-BASED JOINS ----------------------------------------------------------

--marks an on_expr to be derived from the schema's FK at compile time.
local function fk_auto(filter) return {fk_auto = true, filter = filter} end

--every FK between two table members, checked both directions.
local function fk_matches(member_a, member_b, matches)
	local function scan(child, parent)
		for _, fk in pairs(child.schema.fks or empty) do
			if fk.ref_table == parent.table then
				add(matches, {fk = fk, child = child, parent = parent})
			end
		end
	end
	scan(member_a, member_b)
	scan(member_b, member_a)
end

--q.eq() on_expr for one FK match; AND'd together for a composite key.
local function fk_on_expr(m)
	local conds = {} --{expr...}
	for i, col in ipairs(m.fk.cols) do
		conds[i] = q.eq(
			q.col(m.child.member..'.'..col),
			q.col(m.parent.member..'.'..m.fk.ref_cols[i]))
	end
	return #conds == 1 and conds[1] or q.and_(unpack(conds))
end

--resolve a fk_auto marker against new_member: exactly one FK must connect
--it to some other member in candidates; ambiguous or absent FK paths raise.
local function resolve_fk_auto(marker, new_member, candidates, what)
	local matches = {} --{{fk=,child=,parent=}...}
	for _, member in ipairs(candidates) do
		if member ~= new_member and member.kind == 'table' then
			fk_matches(new_member, member, matches)
		end
	end
	assertf(#matches > 0, '%s: no FK between %s and any other member', what, new_member.member)
	assertf(#matches == 1, '%s: ambiguous FK for %s (%d candidates)', what, new_member.member, #matches)
	local on = fk_on_expr(matches[1])
	if marker.filter then return q.and_(on, marker.filter) end
	return on
end

local function assert_table_spec(what, table_spec)
	assertf(isstr(table_spec), '%s: table spec must be a string, got %s',
		what, type(table_spec))
end

function Rel:fk_join(table_spec)
	assert_table_spec('fk_join', table_spec)
	return self:join(table_spec, fk_auto())
end

function Rel:fk_left_join(table_spec)
	assert_table_spec('fk_left_join', table_spec)
	return self:left_join(table_spec, fk_auto())
end

function Rel:where_has(table_spec, filter)
	assert_table_spec('where_has', table_spec)
	return self:where(q.exists(table_spec, fk_auto(filter)))
end

function Rel:where_hasnt(table_spec, filter)
	assert_table_spec('where_hasnt', table_spec)
	return self:where(q.not_exists(table_spec, fk_auto(filter)))
end

--SET OPERATIONS ---------------------------------------------------------------

--[[
union() flattens a chain (a:union(b):union(c)) into one n-ary union_inputs
list instead of nesting union-of-unions: each input is read independently
either way, so nesting buys nothing and only adds a layer.
]]
function Rel:union(right)
	assert(is_relation(right), 'union: relation expected')
	if self.union_inputs then
		mark_used(right)
		add(self.union_inputs, right)
		return self
	end
	mark_used(self)
	mark_used(right)
	local rel = {db = self.db, union_inputs = {self, right}}
	return object(Rel, rel)
end

--COMPILE ENTRY --------------------------------------------------------------

local compile --fw. decl.
local compile_scan --fw. decl.
local compile_relation_scan --fw. decl.
local compile_virtual_scan --fw. decl.
local order_satisfied --fw. decl.
local order_satisfied_set --fw. decl.
local output_source_col --fw. decl.
local returned_source_terms --fw. decl.
--residual checks use these functions to run exists()/in_() subqueries.
local build_rows --fw. decl.
local union_rows --fw. decl.
local eval_exists_source --fw. decl.
local eval_relation_exists --fw. decl.
--stage 8 cursor choice: shared by compile() and exists()'s standalone scan.
local split_conditions --fw. decl.
local referenced_members --fw. decl.
local key_order --fw. decl.
local choose_access --fw. decl.

--{member=,col=} for a plain q.col() bound to a source field; nil for a
--computed value, which an index can't drive.
local function col_term(expr)
	if type(expr) == 'table' and expr[1] == 'col' and expr.source then
		return {member = expr.source.member, col = expr[3]}
	end
	return nil
end

--table sources use mdbx_schema fields.
--relation sources expose their returned fields.
--virtual tables have no physical storage: their schema comes straight
--from the paper schema, never through db:table_schema()'s live/stored
--schema reconciliation, which only knows about real tables.
local function resolve_source(source, db)
	if source.kind == 'table' then
		source.member = source.alias or source.table
		local virtual_schema = db.schema and db.schema.tables[source.table]
		if virtual_schema and virtual_schema.virtual then
			source.schema = virtual_schema
		else
			source.schema = assertf(db:table_schema(source.table),
				'table has no schema: %s', source.table)
		end
		source.fields = source.schema.fields
	else
		source.member = source.alias
		local fields = {} --{name->field}
		for i, name in ipairs(source.returned_fields) do
			fields[name] = {name = name, index = i}
		end
		source.fields = fields
	end
end

--a fragment does not get its own scope.
--its members merge into the relation that joined it.
--its where() exprs merge into the join condition.
local function resolve_sources(rel)

	--[[
	- prepare relation values passed where a table can appear.
	- from(rel, alias): rel returns rows read as alias.field.
	- join(rel, alias, on): rel returns rows read through the join alias.
	- join(rel, on): rel members and where() clauses merge into this query.
	]]
	if is_relation(rel.source) then
		local source = rel.source
		--without alias, returned fields would have no source name.
		assert(rel.alias, 'relation source requires alias')
		compile(source, 'rows')
		rel.source = {
			kind = 'relation',
			relation = source,
			alias = rel.alias,
			returned_fields = source.returned_fields,
		}
	end
	for _, join in ipairs(rel.joins) do
		if is_relation(join.right) then
			if join.alias then
				local source = join.right
				compile(source, 'rows')
				join.right = {
					kind = 'relation',
					relation = source,
					alias = join.alias,
					returned_fields = source.returned_fields,
				}
			else
				--without alias, returned fields would have no source name.
				assert(not (join.right.select_outputs or join.right.group_outputs),
					'relation source requires alias')
			end
		end
	end
	--[[
	- build the member lookup used by q.col('member.col').
	- table: member is alias or table name; fields come from mdbx_schema.
	- from(rel, alias) and join(rel, alias, on): member is alias.
	- join(rel, on): rel members are added and rel:where() exprs move to join.on.
	]]
	local members = {} --{source...; member->source}
	rel.members = members
	local function add_source(source)
		resolve_source(source, rel.db)
		assertf(not members[source.member], 'duplicate source member: %s', source.member)
		add(members, source)
		members[source.member] = source
	end
	add_source(rel.source)
	for _, join in ipairs(rel.joins) do
		if is_relation(join.right) then
			local fragment = join.right
			resolve_sources(fragment)
			--unaliased relation fragments may merge only members and where() expressions.
			assert(not (fragment.havings[1] or fragment.select_outputs
				or fragment.group_outputs or fragment.distinct_rows
				or fragment.order_by_terms or fragment.limit_rows
				or fragment.use_indexes[1] or fragment.no_indexes[1]),
				'relation fragment may contain only source steps and where()')
			for _, where in ipairs(fragment.wheres) do
				if join.on == nil or join.on == true then
					join.on = where
				else
					join.on = q.and_(join.on, where)
				end
			end
			for _, member in ipairs(fragment.members) do
				assertf(not members[member.member],
					'duplicate source member: %s', member.member)
				add(members, member)
				members[member.member] = member
			end
		else
			add_source(join.right)
		end
	end
	return members
end

--union inputs must use the same field names in the same order because
--materialized rows use those positions directly.
local function same_fields(a, b)
	if #a ~= #b then return false end
	for i, name in ipairs(a) do
		if name ~= b[i] then return false end
	end
	return true
end

--distinct()'s dedup key: cols if given, else every returned field (also
--covers group() with no aggregate outputs, where distinct_rows is nil).
local function dedup_key_fields(rel)
	return type(rel.distinct_rows) == 'table' and rel.distinct_rows or rel.returned_fields
end

local union_terminals = {rows = true, first = true, one = true,
	must_one = true, count = true, exists = true} --{terminal_kind->true}

--[[
union relations combine two or more already-compiled relations' rows; none
of the normal source/join/access-plan pipeline (resolve_sources, bind_expr,
build_access) applies, so this is its own compile path, entered from
compile()'s first line instead of falling through resolve_sources().
]]
local function compile_union(rel, terminal_kind, parent_scope)
	assertf(union_terminals[terminal_kind],
		'union: %s() is not supported on a union relation', terminal_kind)
	assert(not (rel.wheres[1] or rel.havings[1] or rel.select_outputs
		or rel.group_outputs or rel.distinct_rows or rel.order_by_terms
		or rel.limit_rows or rel.joins[1] or rel.use_indexes[1] or rel.no_indexes[1]),
		'union: no further builder methods may be called on a union relation')
	--[[
	each input compiles for whichever terminal kind it will actually be
	run with later, since compile() commits a relation to one kind for good.
	exists(): duplicates don't matter, so each input's own exists() can
	short-circuit instead of materializing every row.
	count(): union never dedups, so it's a sum of each input's own
	count(), which itself never decodes select() columns.
	every other terminal needs full materialized rows to concatenate.
	]]
	local input_kind = 'rows'
	if terminal_kind == 'exists' then input_kind = 'exists'
	elseif terminal_kind == 'count' then input_kind = 'count'
	end
	local returned_fields
	local params = {} --{name...; name->true}
	for _, input in ipairs(rel.union_inputs) do
		compile(input, input_kind, parent_scope)
		assertf(input.returned_fields, 'union: input has no select() or group()')
		if not returned_fields then
			returned_fields = input.returned_fields
		else
			--array rows need the same field at each position.
			assertf(same_fields(returned_fields, input.returned_fields),
				'union: inputs must return the same fields in the same order')
		end
		for _, name in ipairs(input.params) do
			if not params[name] then add(params, name); params[name] = true end
		end
	end
	rel.returned_fields = returned_fields
	rel.output_fields = rel.union_inputs[1].output_fields
	rel.params = params
	rel.compiled = true
	rel.terminal_kind = terminal_kind
	return rel
end

MDBX_NO_NEXT_NODUP = false --bench override, see compile()'s next_nodup eligibility check

--[[local]] function compile(rel, terminal_kind, parent_scope, top_level)

	if rel.compiled then
		--a compiled relation is already bound to one terminal kind.
		assertf(rel.terminal_kind == terminal_kind,
			'query already compiled for %s()', rel.terminal_kind)
		return rel
	end
	if rel.union_inputs then
		if top_level then mark_used(rel) end
		return compile_union(rel, terminal_kind, parent_scope)
	end
	--embedded sources mark themselves used at construction.
	--top-level compile catches direct compile after prior embedding.
	if top_level then mark_used(rel) end
	local members = resolve_sources(rel)

	--compute output-name maps before binding expressions.
	--group_fields/select_fields reject duplicate output names.
	--returned_fields is the ordered list seen by an outer query.
	local function output_fields(outputs, part)
		local fields = {} --{name->field}
		if outputs then
			for i, output in ipairs(outputs) do
				local _, name = unpack(output, 1, 2)
				assertf(not fields[name], 'duplicate %s() output field: %s', part, name)
				fields[name] = {name = name, index = i}
			end
		end
		return fields
	end
	local group_fields = output_fields(rel.group_outputs, 'group')
	local select_fields = output_fields(rel.select_outputs, 'select')
	rel.group_fields = group_fields
	rel.select_fields = select_fields

	local outputs = rel.select_outputs or rel.group_outputs
	--select() outputs take precedence over group() outputs when both exist.
	local returned_output_fields = rel.select_outputs and select_fields or
		(rel.group_outputs and group_fields or false)
	if outputs then
		local returned_fields = {} --{name...}
		for i, output in ipairs(outputs) do
			local _, name = unpack(output, 1, 2)
			returned_fields[i] = name
		end
		rel.returned_fields = returned_fields
		rel.output_fields = returned_output_fields
	end

	--child relations search this scope after checking their own members.
	local scope = {members = members, parent = parent_scope or false} --{members=members,parent=scope|false}
	rel.scope = scope
	local params = {} --{name...; name->true}
	rel.params = params
	local function add_param(name)
		if not params[name] then
			add(params, name)
			params[name] = true
		end
	end
	local function add_params_from(other_rel)
		for _, name in ipairs(other_rel.params) do
			add_param(name)
		end
	end
	local function bind_field_ref(expr, source, field)
		--bound field ref: {'col', member|false, col; source = source|nil, field = field}
		expr.source = source
		expr.field = field
	end
	local function find_member(search_scope, member)
		local depth = 0
		while search_scope do
			local source = search_scope.members[member]
			if source then
				return source, depth
			end
			search_scope = search_scope.parent
			depth = depth + 1
		end
	end
	local function find_col(search_scope, col)
		local depth = 0
		while search_scope do
			local source, field
			for _, candidate in ipairs(search_scope.members) do
				local candidate_field = candidate.fields[col]
				if candidate_field then
					assertf(not source, 'ambiguous field: %s', col)
					source, field = candidate, candidate_field
				end
			end
			if source then
				return source, field, depth
			end
			search_scope = search_scope.parent
			depth = depth + 1
		end
	end
	local function bind_source_col(expr, member, col, search_scope, require_parent)
		local source, field, depth
		if member then
			source, depth = find_member(search_scope, member)
			assertf(source, 'unknown source member: %s', member)
			field = source.fields[col]
			assertf(field, 'unknown field: %s.%s', member, col)
		else
			source, field, depth = find_col(search_scope, col)
			assertf(source, 'unknown field: %s', col)
		end
		--outer() validates that normal scope lookup reached a parent scope.
		assert(not require_parent or depth > 0, 'outer field resolved in current scope')
		bind_field_ref(expr, source, field)
	end
	local function bind_output_col(expr, member, col, fields)
		--outputs are unqualified row fields.
		assert(not member, 'output field must be unqualified')
		local field = fields[col]
		assertf(field, 'unknown output field: %s', col)
		bind_field_ref(expr, nil, field)
	end

	local bind_expr
	local aggregate_ops = {count = true, min = true, max = true, sum = true, avg = true} --{op->true}
	local function is_agg_output(expr)
		return type(expr) == 'table' and aggregate_ops[expr[1]]
	end
	--[[
	- bind each expression in place.
	- source positions bind q.col() to table/relation fields.
	- output positions bind q.col() to group/select outputs.
	- inner relations compile with this relation's scope as parent scope.
	]]
	function bind_expr(expr, search_scope, fields, mode, aggregates)
		--plain Lua values are literals, not exprs; nothing to bind.
		if type(expr) ~= 'table' then
			return
		end

		local op, a, b = unpack(expr, 1, 3)
		if op == 'col' then
			local member, col = a, b
			if mode == 'output' then
				bind_output_col(expr, member, col, fields)
			--order_by() unqualified name: prefer a returned field over a source field.
			elseif mode == 'output_source' and not member and fields and fields[col] then
				bind_output_col(expr, member, col, fields)
			else
				bind_source_col(expr, member, col, search_scope)
			end
		elseif op == 'outer' then
			local member, col = a, b
			--outer() must resolve in a parent scope; later stages treat it as q.col().
			assert(search_scope and search_scope.parent, 'outer field requires parent scope')
			bind_source_col(expr, member, col, search_scope, true)
			expr[1] = 'col'
		elseif op == 'param' then
			add_param(a)
		elseif aggregate_ops[op] then
			assert(aggregates, 'aggregate expressions are only allowed in group()')
			--aggregate args always read source fields, never outputs.
			bind_expr(a, search_scope, false, 'source', false)
		elseif op == 'exists' or op == 'not_exists' then
			local right, on = a, b
			if is_relation(right) then
				compile(right, 'exists', search_scope)
				add_params_from(right)
				bind_expr(on, search_scope, fields, mode, aggregates)
			else
				--right is a bare table spec, not a relation.
				--no compile is needed.
				--one extra member lets on_expr resolve right-side fields.
				resolve_source(right, rel.db)
				right.db = rel.db
				if type(on) == 'table' and on.fk_auto then
					on = resolve_fk_auto(on, right, search_scope.members, 'where_has')
					expr[3] = on
				end
				local right_members = {right} --{source...; member->source}
				right_members[right.member] = right
				local right_scope = {members = right_members, parent = search_scope} --{members=members,parent=scope|false}
				bind_expr(on, right_scope, false, 'source', false)
			end
		elseif op == 'in' or op == 'not_in' then
			local value, values_or_rel = a, b
			bind_expr(value, search_scope, fields, mode, aggregates)
			if is_relation(values_or_rel) then
				local values_rel = values_or_rel
				compile(values_rel, 'rows', search_scope)
				add_params_from(values_rel)
				local name = op == 'in' and 'in_' or 'not_in'
				assert(#values_rel.returned_fields == 1,
					name..'() relation requires one returned field')
			elseif type(values_or_rel) == 'table' and values_or_rel[1] == 'param' then
				--a list param supplies the candidate set at execution.
				bind_expr(values_or_rel, search_scope, fields, mode, aggregates)
			else
				for _, item in ipairs(values_or_rel) do
					bind_expr(item, search_scope, fields, mode, aggregates)
				end
			end
		else
			--expr[1] is the op tag, not an operand; bind everything after it.
			local first = true
			for _, operand in ipairs(expr) do
				if first then
					first = false
				else
					bind_expr(operand, search_scope, fields, mode, aggregates)
				end
			end
		end
	end

	--bind each query part with the fields that part is allowed to read.
	for _, source in ipairs(members) do
		if source.kind == 'relation' then
			add_params_from(source.relation)
		end
	end
	if rel.group_outputs then
		for _, output in ipairs(rel.group_outputs) do
			local expr = output[1]
			bind_expr(expr, scope, false, 'source', true)
			--a literal/param key is constant, collapsing every row into one group.
			assertf((type(expr) == 'table' and expr[1] == 'col') or is_agg_output(expr),
				'group(): %s must be a column or an aggregate', output[2])
		end
	end
	if rel.select_outputs then
		local select_mode = rel.group_outputs and 'output' or 'source'
		local select_fields = rel.group_outputs and group_fields or false
		for _, output in ipairs(rel.select_outputs) do
			local expr = output[1]
			bind_expr(expr, scope, select_fields, select_mode, false)
		end
	end
	if rel.havings[1] then
		assert(rel.group_outputs, 'having() requires group()')
	end
	for _, expr in ipairs(rel.havings) do
		bind_expr(expr, scope, group_fields, 'output', false)
	end
	--a fragment never gets its own compile() call.
	--its members share this relation's flat scope.
	--its internal join on_expr values are bound here recursively.
	local function bind_joins(joins)
		for _, join in ipairs(joins) do
			if type(join.on) == 'table' and join.on.fk_auto then
				join.on = resolve_fk_auto(join.on, join.right, members, 'fk_join')
			end
			bind_expr(join.on, scope, false, 'source', false)
			if is_relation(join.right) then
				bind_joins(join.right.joins)
			end
		end
	end
	bind_joins(rel.joins)
	for _, expr in ipairs(rel.wheres) do
		bind_expr(expr, scope, false, 'source', false)
	end

	rel.where_conditions = split_conditions(rel.wheres, true)
	rel.having_conditions = split_conditions(rel.havings, false)
	--fragments can contain nested fragments.
	--internal joins need on_conditions recursively.
	local function split_join_conditions(joins)
		for _, join in ipairs(joins) do
			--unconditional joins have nothing to split.
			--no always-true residual entry is needed.
			join.on_conditions = (join.on == nil or join.on == true)
				and empty or split_conditions({join.on}, true)
			if is_relation(join.right) then
				split_join_conditions(join.right.joins)
			end
		end
	end
	split_join_conditions(rel.joins)

	if rel.order_by_terms then
		local order_fields = returned_output_fields or false
		local order_mode = (rel.group_outputs or rel.distinct_rows) and 'output' or 'output_source'
		if order_mode == 'output' then
			assert(order_fields, 'order_by() with group() or distinct() requires returned fields')
		end
		for _, term in ipairs(rel.order_by_terms) do
			local expr = term[1]
			bind_expr(expr, scope, order_fields, order_mode, false)
		end
	end

	if type(rel.distinct_rows) == 'table' then
		assertf(returned_output_fields, 'distinct(): requires select() or group()')
		for _, name in ipairs(rel.distinct_rows) do
			assertf(returned_output_fields[name], 'distinct(): unknown returned field: %s', name)
		end
	end

	--record index hints by member and reject contradictory hints.
	local use_index_by_member = {} --{member->index_name}
	local no_index_by_member = {} --{member->true|{index_name->true}}
	rel.use_index_by_member = use_index_by_member
	rel.no_index_by_member = no_index_by_member
	local function check_hint_member(member)
		assertf(members[member], 'unknown source member: %s', member)
	end
	for _, hint in ipairs(rel.use_indexes) do
		local member, index_name = hint.member, hint.index_name
		check_hint_member(member)
		local forced = use_index_by_member[member]
		assertf(not forced or forced == index_name,
			'conflicting use_index() for source member: %s', member)
		use_index_by_member[member] = index_name
	end
	for _, hint in ipairs(rel.no_indexes) do
		local member, index_name = hint.member, hint.index_name
		check_hint_member(member)
		if index_name == nil then
			--all indexes cannot be forbidden after one index was forced.
			assertf(not use_index_by_member[member],
				'all indexes forbidden for source member with forced index: %s', member)
			no_index_by_member[member] = true
		else
			local no_indexes = no_index_by_member[member]
			--a member-wide no_index() already forbids this index.
			assert(no_indexes ~= true, 'index already forbidden')
			--one index cannot be both forced and forbidden.
			assertf(use_index_by_member[member] ~= index_name,
				'index is both forced and forbidden: %s.%s', member, index_name)
			no_indexes = no_indexes or {} --{index_name->true}
			no_indexes[index_name] = true
			no_index_by_member[member] = no_indexes
		end
	end

	--STAGE 8: cursor choice --------------------------------------------------

	--[[
	- a left_join()'d member's own "found" must depend only on its on_expr,
	  never on a later where() -- a where() condition on such a member has
	  to run once against the finished row (late), not as a per-candidate
	  residual during that member's scan, or an unmatched row that should
	  null-extend would instead get silently dropped or wrongly kept.
	- a left-joined fragment null-extends as one atomic unit, so every
	  member inside it counts as left-joined too, regardless of the join
	  kind used between members *inside* the fragment.
	- limitation: this means such a where() condition can never drive an
	  index seek, even when one exists on that column -- only the member's
	  own on_expr can still choose an index for it. a fix that kept index
	  use would need a separate existence-proving scan from the
	  candidate-narrowing one, which this engine doesn't have.
	]]
	local left_joined_members = {} --{member_name->true}
	local function collect_left_joined_members(joins)
		for _, join in ipairs(joins) do
			if is_relation(join.right) then
				if join.kind == 'left_join' then
					for _, member in ipairs(join.right.members) do
						left_joined_members[member.member] = true
					end
				else
					collect_left_joined_members(join.right.joins)
				end
			elseif join.kind == 'left_join' then
				left_joined_members[join.right.member] = true
			end
		end
	end
	collect_left_joined_members(rel.joins)

	local function attribute_conditions(conditions)
		for _, cond in ipairs(conditions) do
			local found = {} --{member->true}
			referenced_members(cond.expr, found, members)
			local n, only = 0, nil
			for member in pairs(found) do
				n = n + 1
				only = member
			end
			cond.member = (n == 1 and not left_joined_members[only]) and only or false
		end
	end
	attribute_conditions(rel.where_conditions)
	--conditions that cannot narrow one member run after all members are scanned.
	local late_conditions = {} --{condition...}
	for _, cond in ipairs(rel.where_conditions) do
		if cond.member == false then add(late_conditions, cond) end
	end
	rel.late_conditions = late_conditions

	--only the base source can provide final row order.
	--joined members run under each driver row.
	--joined-member cursor order is local to that driver row.
	local function base_order_terms()
		if not rel.order_by_terms or rel.group_outputs or rel.distinct_rows then return end
		local terms = {} --{{member=,col=,dir=}...}
		for _, term in ipairs(rel.order_by_terms) do
			local expr, dir = term[1], term[2]
			if expr.source then
				add(terms, {member = expr.source.member, col = expr[3], dir = dir})
			else
				local src = output_source_col(rel, expr.field.name)
				if not src then return end
				add(terms, {member = src.member, col = src.col, dir = dir})
			end
		end
		return terms
	end
	local source_order_terms = base_order_terms()
	local prefer_order = source_order_terms and rel.limit_rows ~= nil

	--group() with no aggregate outputs is "distinct group keys" -- same
	--access-plan requirement as distinct(): both can request an index
	--whose key groups their columns together (any order, any direction),
	--the same way order_by() requests one for row sequence above, but
	--looser.
	--mutually exclusive with source_order_terms (base_order_terms()
	--returns nil whenever rel.distinct_rows or rel.group_outputs is set).
	local function group_has_no_aggregates()
		if not rel.group_outputs then return false end
		for _, output in ipairs(rel.group_outputs) do
			local expr = output[1]
			if is_agg_output(expr) then return false end
		end
		return true
	end
	local function dedup_only()
		return (rel.distinct_rows and not rel.group_outputs) or group_has_no_aggregates()
	end
	--index selection for group order: an index whose key groups these
	--columns together lets run_grouped stream instead of hash, whether
	--or not group() also has aggregate outputs.
	--group()'s own key (non-aggregate) outputs are used directly --
	--bound in 'source' mode regardless of any select() layered on top.
	--distinct() without group() has no separate key notion: its dedup
	--fields (cols if given, else every returned column) are its only key.
	local function group_key_terms()
		if rel.group_outputs then
			local terms = {} --{{member=,col=}...}
			for _, output in ipairs(rel.group_outputs) do
				local expr = output[1]
				if is_agg_output(expr) then
					--aggregate output: not a grouping key
				else
					local ct = col_term(expr)
					if not ct then return nil end --computed key expr: index can't help
					add(terms, ct)
				end
			end
			return terms[1] and terms or nil
		end
		if rel.distinct_rows then
			return returned_source_terms(rel, dedup_key_fields(rel))
		end
	end
	local source_group_terms = group_key_terms()

	--access conditions include join on_expr conditions.
	--they also include where() conditions that read only this member.
	--join_deps() schedules on_expr inputs before this member scans.
	local function access_conditions(member, join)
		local list = {} --{condition...}
		if join then
			for _, cond in ipairs(join.on_conditions) do add(list, cond) end
		end
		for _, cond in ipairs(rel.where_conditions) do
			if cond.member == member.member then add(list, cond) end
		end
		return list
	end

	--a join can run after every outside member its on_expr reads is scheduled.
	--the join's own right member does not count as a dependency.
	--a fragment's internal members do not count as outside dependencies.
	local function join_deps(join)
		local found = {} --{member->true}
		referenced_members(join.on, found, members)
		if is_relation(join.right) then
			for _, member in ipairs(join.right.members) do
				found[member.member] = nil
			end
		else
			found[join.right.member] = nil
		end
		return found
	end

	--[[
	- order joins by dependency readiness.
	- ties keep declaration order.
	- ordering uses on_expr column references only.
	- table contents do not affect join order.
	- inner-joined fragments flatten into this sequence.
	- left-joined fragments run as nested atomic groups.
	- a left-joined fragment either matches as a group or null-extends as a group.
	]]
	local function build_access(joins, scheduled, access)
		local pending = {} --{join...}
		for _, join in ipairs(joins) do
			add(pending, join)
		end
		while pending[1] do
			local picked, picked_i
			for i, join in ipairs(pending) do
				local deps = join_deps(join)
				local ready = true
				for member in pairs(deps) do
					if not scheduled[member] then ready = false; break end
				end
				if ready then picked, picked_i = join, i; break end
			end
			assertf(picked, 'source step cycle: on_expr reads form a cycle'
				..' across join()/left_join() steps')
			remove(pending, picked_i)
			if is_relation(picked.right) then
				local fragment = picked.right
				local base_step = {member = fragment.source, join = false,
					plan = choose_access(fragment.source,
						access_conditions(fragment.source, picked), members,
						use_index_by_member[fragment.source.member],
						no_index_by_member[fragment.source.member])}
				if picked.kind == 'join' then
					add(access, base_step)
					scheduled[fragment.source.member] = true
					build_access(fragment.joins, scheduled, access)
				else
					local nested_scheduled = {[fragment.source.member] = true}
					local nested = {base_step} --{step...}
					build_access(fragment.joins, nested_scheduled, nested)
					add(access, {member = false, join = picked, nested = nested})
				end
			else
				add(access, {member = picked.right, join = picked,
					plan = choose_access(picked.right, access_conditions(picked.right, picked),
						members, use_index_by_member[picked.right.member],
						no_index_by_member[picked.right.member])})
				scheduled[picked.right.member] = true
			end
		end
	end

	--[[
	- natural_order is the driving member order guaranteed by its access plan.
	- leading equality-pinned columns are fixed across the scan.
	- remaining key columns follow cursor order.
	- a backward-scanned plan (plan.dir == 'desc') reverses that cursor order.
	- joined members do not contribute global order.
	- group(), distinct(), and order_by() check this one fact.
	]]
	local function natural_order(step)
		local plan = step.plan
		if not plan.schema then return empty end --relation source does not guarantee key order
		if plan.kind == 'in' then return empty end --separate seeks do not form one key order
		return key_order(step.member, plan.schema, plan.depth, plan.dir == 'desc')
	end

	local access = {} --{{member=,join=|false,plan=|nested=}...}
	rel.access = access
	add(access, {member = rel.source, join = false,
		plan = choose_access(rel.source, access_conditions(rel.source, false), members,
			use_index_by_member[rel.source.member], no_index_by_member[rel.source.member],
			source_order_terms, prefer_order, source_group_terms)})
	build_access(rel.joins, {[rel.source.member] = true}, access)
	rel.natural_order = natural_order(access[1])

	--[[
	- distinct(), and group() with no aggregate outputs, can skip a whole
	  duplicate group at the cursor via MDBX_NEXT_NODUP instead of
	  decoding every duplicate row -- only when the group is the literal
	  DUPSORT boundary: the returned columns must cover the WHOLE
	  remaining index key, not just a prefix.
	- a residual check or a second access step could pick a different
	  row out of the same group, so skipping unseen duplicates would be
	  wrong unless neither exists.
	- 'exact'/'in' plans have no varying key columns left to group over.
	- MDBX_NEXT_NODUP is forward-only; excludes dir == 'desc'.
	]]
	if dedup_only() and #access == 1 and not MDBX_NO_NEXT_NODUP then
		local plan = access[1].plan
		local kind_ok = plan.kind == 'full' or plan.kind == 'range'
			or plan.kind == 'prefix' or plan.kind == 'eq_prefix'
		if kind_ok and plan.schema and plan.schema.is_index and plan.dir ~= 'desc'
			and #plan.residual == 0 and #late_conditions == 0
		then
			local terms = returned_source_terms(rel, dedup_key_fields(rel))
			if terms then
				local ok, n_wanted = order_satisfied_set(terms, rel.natural_order)
				if ok and plan.depth + n_wanted == #plan.schema.pk then
					plan.next_nodup = true
				end
			end
		end
	end

	--build each step opener once at compile time.
	--recurse into nested left-join fragment steps.
	--relation sources open the already-compiled inner relation instead of a cursor.
	--virtual tables open through their schema's open/next_row/get_col/close.
	local function prepare_scans(access_list)
		for _, step in ipairs(access_list) do
			if step.nested then
				prepare_scans(step.nested)
			elseif step.plan.schema then
				step.open = compile_scan(rel.db, step.plan)
			elseif step.member.kind == 'relation' then
				step.open = compile_relation_scan(step.member.relation)
			elseif step.member.schema.virtual then
				step.open = compile_virtual_scan(step.member.schema)
			end
		end
	end
	prepare_scans(access)

	--[[
	- collect every table-spec exists()/not_exists() source this relation's
	  own residual/late/having checks can reach, so run_filtered can open
	  them all once per execution instead of eval_exists_source opening one
	  fresh per row.
	- a relation-form exists()/in_() is not collected here: it compiles and
	  runs through its own run_filtered call, which walks its own tree.
	- recurses into on_expr, since one exists() can nest inside another.
	]]
	local function collect_exists_sources(expr, entries, seen)
		if type(expr) ~= 'table' then return end
		local op = expr[1]
		if op == 'exists' or op == 'not_exists' then
			local source, on = expr[2], expr[3]
			if not is_relation(source) and not seen[source] then
				seen[source] = true
				add(entries, {source = source, on = on})
			end
			if on then collect_exists_sources(on, entries, seen) end
		else
			for i = 2, #expr do
				collect_exists_sources(expr[i], entries, seen)
			end
		end
	end
	local function collect_step_exists(step, entries, seen)
		if step.nested then
			for _, s in ipairs(step.nested) do collect_step_exists(s, entries, seen) end
		else
			for _, cond in ipairs(step.plan.residual) do
				collect_exists_sources(cond.expr, entries, seen)
			end
		end
	end
	local exists_sources, exists_seen = {}, {}
	for _, step in ipairs(access) do collect_step_exists(step, exists_sources, exists_seen) end
	for _, cond in ipairs(late_conditions) do
		collect_exists_sources(cond.expr, exists_sources, exists_seen)
	end
	for _, cond in ipairs(rel.having_conditions) do
		collect_exists_sources(cond.expr, exists_sources, exists_seen)
	end
	rel.exists_sources = exists_sources

	local needs_output =
		terminal_kind == 'rows' or
		terminal_kind == 'first' or
		terminal_kind == 'one' or
		terminal_kind == 'must_one'
	if needs_output then
		assert(outputs, terminal_kind..'() requires select() or group()')
	end

	rel.terminal_kind = terminal_kind
	rel.needs_output = needs_output
	rel.compiled = true
	return rel
end

--STAGE 8: cursor choice ------------------------------------------------
--shared by compile() (real relation members) and eval_exists_source()
--(exists()/not_exists()'s standalone table-spec scan): both plan one
--member's scan from a member, its access conditions, and the relation
--scope (members) those conditions may reference.

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
- this only fires when every arm compares the exact same column. two
  different columns, or a column on both sides of one arm, can't
  collapse into one membership check, so we leave those alone.
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
- both forms flatten into independent conditions.
- searchable facts can drive an index seek.
- unclassified conditions run as row checks.
]]
function split_conditions(exprs, classify)
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
				kind = classify and type(expr) == 'table' and fact_kind[expr[1]] or nil,
				expr = expr,
			}
		end
	end
	for _, expr in ipairs(exprs) do
		add_condition(expr)
	end
	return conditions
end

--[[
- collect this relation's members read by an expression.
- q.col() nodes count when they bind to this relation.
- exists()/in_() correlations count through on_expr and inner where().
- the result decides whether one member can own a condition.
- cross-member conditions run after all members are scanned.
]]
--walk relation filters so correlated exists()/in_() can be owned by the
--outer member they read.
local function referenced_relation_members(rel, found, members)
	if rel.union_inputs then
		for _, input in ipairs(rel.union_inputs) do
			referenced_relation_members(input, found, members)
		end
	else
		for _, cond in ipairs(rel.where_conditions) do
			referenced_members(cond.expr, found, members)
		end
	end
end

function referenced_members(expr, found, members) --found: {member->true}
	if type(expr) ~= 'table' then return end
	local op = expr[1]
	if op == 'col' then
		if expr.source and members[expr.source.member] == expr.source then
			found[expr.source.member] = true
		end
	elseif op == 'exists' or op == 'not_exists' then
		local source, on = expr[2], expr[3]
		if on then referenced_members(on, found, members) end
		if is_relation(source) then
			referenced_relation_members(source, found, members)
		end
	elseif op == 'in' or op == 'not_in' then
		referenced_members(expr[2], found, members)
		local values_or_rel = expr[3]
		if is_relation(values_or_rel) then
			referenced_relation_members(values_or_rel, found, members)
		else
			for _, item in ipairs(values_or_rel) do
				referenced_members(item, found, members)
			end
		end
	else
		for i = 2, #expr do
			referenced_members(expr[i], found, members)
		end
	end
end

--[[
- find the one operand that is this member's q.col().
- return the column name and the other operand.
- flipped=true means the column was on the right.
- flipped range ops read in reverse.
]]
local function member_operand(member, left, right)
	local l_col = type(left) == 'table' and left[1] == 'col' and left.source == member
	local r_col = type(right) == 'table' and right[1] == 'col' and right.source == member
	if l_col and not r_col then return left[3], right, false end
	if r_col and not l_col then return right[3], left, true end
	return nil
end
local flip_range_op = {lt = 'gt', le = 'ge', gt = 'lt', ge = 'le'} --{op->flipped op}
--in_() lists up to IN_UNION_MAX can use repeated exact seeks.
--longer lists stay as residual row checks.
--the cutoff bounds the number of cursor seeks.
local IN_UNION_MAX = 16

--[[
- pull facts that read only this member out of access conditions.
- supported facts: equality, range, prefix, membership, null.
- facts are bucketed by column.
- each column gets one fact per kind.
- duplicate facts stay residual checks.
- first-wins affects scan choice, not correctness.
]]
local function bucket_facts(member, conditions, members)
	local eq, lo, hi, prefix, in_by = {}, {}, {}, {}, {} --{col->{cond=,expr=[,op=]}}
	for _, cond in ipairs(conditions) do
		if not cond.consumed then
			local expr = cond.expr
			if cond.kind == 'equality' then
				local col, val = member_operand(member, expr[2], expr[3])
				if col and not eq[col] then eq[col] = {cond = cond, expr = val} end
			elseif cond.kind == 'range' then
				local col, val, flipped = member_operand(member, expr[2], expr[3])
				if col then
					local rop = flipped and flip_range_op[expr[1]] or expr[1]
					local bucket = (rop == 'gt' or rop == 'ge') and lo or hi
					if not bucket[col] then bucket[col] = {cond = cond, op = rop, expr = val} end
				end
			elseif cond.kind == 'prefix' then
				local left = expr[2]
				if type(left) == 'table' and left[1] == 'col' and left.source == member then
					if not prefix[left[3]] then prefix[left[3]] = {cond = cond, expr = expr[3]} end
				end
			elseif cond.kind == 'membership' then
				local left, values = expr[2], expr[3]
				if expr[1] == 'in' and type(values) == 'table' and not is_relation(values)
					and not (type(values) == 'table' and values[1] == 'param')
					and #values <= IN_UNION_MAX
					and type(left) == 'table' and left[1] == 'col' and left.source == member
				then
					--seek values must be known before this member is scanned.
					local self_ref = false
					for _, item in ipairs(values) do
						local found = {} --{member->true}
						referenced_members(item, found, members)
						if found[member.member] then self_ref = true; break end
					end
					if not self_ref and not in_by[left[3]] then
						in_by[left[3]] = {cond = cond, exprs = values}
					end
				end
			elseif cond.kind == 'null' then
				local left = expr[2]
				if type(left) == 'table' and left[1] == 'col' and left.source == member then
					local col = left[3]
					local field = member.schema.fields[col]
					if expr[1] == 'is_null' then
						if not field.not_null and not eq[col] then
							eq[col] = {cond = cond, expr = null}
						end
					elseif field.not_null then
						--a not_null field cannot reject an existing row here.
						cond.consumed = true
					elseif not lo[col] then
						--todo: range bucketing keeps the first lower-bound fact.
						--is_not_null() can occupy the bucket before a stricter later range fact.
						lo[col] = {cond = cond, op = 'gt', expr = null}
					end
				end
			end
		end
	end
	return eq, lo, hi, prefix, in_by
end

--is this column marked ai_ci? true or false either way, whether we're
--looking at the base table or an index -- every index just copies the
--flag straight from the table.
local function ai_ci_col(schema, col)
	local f = schema.fields[col]
	return f and f.mdbx_collation == 'utf8_ai_ci'
end

--how many columns at the start of the key we can search on with "=".
--for an ai_ci column that's only true if this schema is the index that
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
- compare one candidate key to this member's fact buckets.
- depth is the leading run of equality-matched columns.
- the next key column can use in_(), prefix, or range facts.
- the result classifies scan strength.
- no row counts or index sizes are used.
- the plan does not depend on table contents.
- we never use an ai_ci column for a prefix search (starts()), because
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
- rank candidates by how many key columns narrow the scan.
- range and prefix count their bound column.
- key-byte checks reject rows before any base-table read.
- kind breaks ties at equal coverage.
- row counts and index sizes are not ranking inputs.
]]
local kind_rank = {exact = 2, ['in'] = 2, range = 1, prefix = 1, eq_prefix = 0} --{kind->tie-break rank}
local function plan_coverage(plan)
	if plan.kind == 'in' then return 1 end
	if plan.kind == 'range' or plan.kind == 'prefix' then
		return plan.depth + 1
	end
	return plan.depth
end

--[[
- what order the rows come out in if we scan this key.
- if an ai_ci column is pinned to one value at the start (an "=" match),
  we still count it as fixed: every row we keep really does have the
  same real text, because we double-check it later, so the columns
  after it still sort correctly.
- if an ai_ci column comes later, unpinned, we can only trust its order
  when this schema is the index that stores the folded text. the table
  itself, or a plain index, stores the real text, which sorts
  differently -- so we stop here instead of claiming an order we can't
  back up.
- a column stored as "desc" scans in descending order, not ascending
  (the key bytes are inverted for this at write time, so a normal
  forward scan just comes out reversed).
- reverse flips every trailing column's dir at once: that's exactly
  what walking the cursor backward (MDBX_PREV/MDBX_LAST) does to the
  whole key order, so a single flag covers it.
]]
function key_order(member, schema, depth, reverse)
	local order = {} --{{member=,col=,fixed=true|dir=}...}
	local pk = schema.pk
	for i = 1, depth do
		add(order, {member = member.member, col = pk[i], fixed = true})
	end
	for i = depth + 1, #pk do
		local col = pk[i]
		if ai_ci_col(schema, col) and not schema.is_index then break end
		local dir = pk.desc and pk.desc[i] and 'desc' or 'asc'
		if reverse then dir = dir == 'desc' and 'asc' or 'desc' end
		add(order, {member = member.member, col = col, dir = dir})
	end
	return order
end

--an order plan scans a key to produce order_by() order.
--leading equalities also narrow that ordered walk.
--non-leading filters stay residual checks.
local function try_order_key(member, schema, eq, order_terms)
	if not order_terms then return end
	local depth = eq_depth(schema, eq)
	local kind = depth == #schema.pk and 'exact'
		or (depth > 0 and 'eq_prefix' or 'full')
	if order_satisfied(order_terms, key_order(member, schema, depth)) then
		return {kind = kind, depth = depth, dir = 'asc'}
	end
	--an "exact" plan has no trailing key columns left to walk in either
	--direction, so only "eq_prefix"/"full" can be satisfied by scanning
	--the same key order backward (MDBX_PREV/MDBX_LAST) instead of sorting.
	if kind ~= 'exact'
		and order_satisfied(order_terms, key_order(member, schema, depth, true))
	then
		return {kind = kind, depth = depth, dir = 'desc'}
	end
end

--like try_order_key, but for distinct() / group() with no aggregate
--outputs: a SET match (order_satisfied_set), not a sequence match, and
--no backward-scan variant.
local function try_group_key(member, schema, eq, group_terms)
	if not group_terms then return end
	local depth = eq_depth(schema, eq)
	local kind = depth == #schema.pk and 'exact'
		or (depth > 0 and 'eq_prefix' or 'full')
	if order_satisfied_set(group_terms, key_order(member, schema, depth)) then
		return {kind = kind, depth = depth, dir = 'asc'}
	end
end

--[[
- choose the key that drives this member's scan.
- candidates are the member pk and allowed indexes.
- forced/forbidden come from use_index()/no_index() and are nil for a
  member with no such hints (e.g. exists()/not_exists()'s inner table,
  which is never a named member of the outer relation).
- consumed conditions are marked on the chosen plan.
- unconsumed conditions become residual row checks.
]]
function choose_access(member, conditions, members, forced, forbidden, order_terms, prefer_order,
	group_terms)
	--relation sources have no pk or index metadata here.
	--they scan the already-compiled inner relation.
	--virtual tables have no pk or index metadata either: no physical
	--storage means no seek, so every condition on them stays residual.
	if member.kind ~= 'table' or member.schema.virtual then
		return {kind = 'full', depth = 0, dir = 'asc', is_pk = false,
			schema = false, seek = empty, residual = conditions}
	end
	local eq, lo, hi, prefix, in_by = bucket_facts(member, conditions, members)
	local candidates = {} --{{schema=,is_pk=}...}
	if not forced then
		add(candidates, {schema = member.schema, is_pk = true})
	end
	for _, ix in ipairs(member.schema.indexes or empty) do
		if forced then
			if ix.name == forced then add(candidates, {schema = ix}) end
		elseif forbidden ~= true and not (forbidden and forbidden[ix.name]) then
			add(candidates, {schema = ix})
		end
	end
	assertf(not forced or candidates[1],
		'use_index: unknown index for member %s: %s', member.member, forced)
	local best_cand, best_plan, best_cov
	local order_cand, order_plan
	local group_cand, group_plan
	for _, cand in ipairs(candidates) do
		local plan = try_key(cand.schema, eq, lo, hi, prefix, in_by)
		if plan then
			local cov = plan_coverage(plan)
			if not best_plan or cov > best_cov
				or (cov == best_cov and kind_rank[plan.kind] > kind_rank[best_plan.kind]) then
				best_cand, best_plan, best_cov = cand, plan, cov
			end
		end
		if not order_plan then
			local plan = try_order_key(member, cand.schema, eq, order_terms)
			if plan then order_cand, order_plan = cand, plan end
		end
		if not group_plan then
			local plan = try_group_key(member, cand.schema, eq, group_terms)
			if plan then group_cand, group_plan = cand, plan end
		end
	end
	--order_plan never covers more key columns than best_plan already does
	--(try_key only ever matches equal-or-more of them than try_order_key),
	--so taking it whenever coverage ties is free: no rows scanned that
	--best_plan wouldn't have scanned anyway, and no explicit sort needed.
	--with limit(), an ordered scan can also give up coverage that a
	--range/prefix filter would have had, stopping early instead.
	--exact seeks over every key column stay on the selective path either way.
	if order_plan and (not best_plan
		or (best_plan.kind ~= 'exact' and plan_coverage(order_plan) >= best_cov)
		or (prefer_order and best_plan.kind ~= 'exact')) then
		best_cand, best_plan = order_cand, order_plan
	--order_terms and group_terms never both apply (base_order_terms()
	--returns nil when distinct_rows is set); no prefer_order counterpart
	--here since build_rows always materializes every row anyway.
	elseif group_plan and (not best_plan
		or (best_plan.kind ~= 'exact' and plan_coverage(group_plan) >= best_cov)) then
		best_cand, best_plan = group_cand, group_plan
	end
	if not best_plan then
		best_cand, best_plan = {schema = member.schema, is_pk = true}, {kind = 'full', depth = 0}
	end
	best_plan.schema = best_cand.schema
	best_plan.is_pk = best_cand.is_pk
	best_plan.dir = best_plan.dir or 'asc' --order_plan may already carry 'desc'
	local seek = {} --{expr...}: one value-operand expr per matched leading column
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
		if lo_fact then best_plan.lo = {op = lo_fact.op, expr = lo_fact.expr}; lo_fact.cond.consumed = true end
		if hi_fact then best_plan.hi = {op = hi_fact.op, expr = hi_fact.expr}; hi_fact.cond.consumed = true end
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
	return best_plan
end

--STAGE 9: executor -----------------------------------------------------

--[[
- row_ctx shape: {member_name -> decode_col fn}.
- each scanned step adds its decoder to row_ctx.
- seek, bound, and residual exprs read earlier members through row_ctx.
- join conditions use this to supply seek values.
]]

--[[
- compile a seek or bound value expression.
- literals return themselves.
- q.param() reads params at execution.
- q.col() reads an earlier member from row_ctx.
]]
local function compile_value(expr)
	if type(expr) ~= 'table' then
		return function() return expr end
	end
	if expr[1] == 'param' then
		local name = expr[2]
		return function(params) return params[name] end
	end
	assertf(expr[1] == 'col', 'unsupported seek value expr: %s', expr[1])
	local member, col = expr.source.member, expr[3]
	return function(params, row_ctx) return row_ctx[member](col) end
end

--[[
- compare same-kind values in key order.
- numbers compare numerically.
- utf8 compares by byte order.
- bool compares false before true.
]]
local function key_cmp(a, b)
	if a == b then return 0 end
	return a < b and -1 or 1
end

--[[
- compare encoded composite keys.
- memcmp covers the shared length.
- shorter strict byte-prefix sorts first.
- this matches variable-length key encoding order.
]]
local function raw_key_cmp(k1, n1, k2, n2)
	local c = memcmp(k1, k2, min(n1, n2))
	if c ~= 0 then return c end
	if n1 < n2 then return -1 end
	if n1 > n2 then return 1 end
	return 0
end

--[[
- compute the smallest encoded key strictly after a byte prefix.
- increment the last byte that is not 0xff.
- drop bytes after the incremented byte.
- return nil when every byte is 0xff.
- nil means there is no finite upper bound at this length.
- starts() prefix bounds use the same operation.
]]
local function increment_prefix(buf, sz)
	local i = sz - 1
	while i >= 0 and buf[i] == 255 do
		i = i - 1
	end
	if i < 0 then return nil end
	buf[i] = buf[i] + 1
	return i + 1
end

--[[
- compile one access-plan scan.
- called once per step at compile time.
- returns an opener for one query execution.
- opener returns run(params, row_ctx, row_fn) and close().
- run walks cursor rows and calls row_fn(decode_col).
- a true row_fn result stops the scan; run returns true in turn.
- close releases cursors.
- cursors, buffers, and records are reused within one execution.
- depth, hi, lo, and prefix checks compare encoded key bytes.
- encoded key order matches value order.
- byte checks avoid decoding rejected rows.
- strict hi uses encode(depth cols, hi) as the upper bound.
- inclusive hi bumps that bound with increment_prefix().
- trailing row key columns cannot pass the bumped inclusive bound.
]]
MDBX_NODUPFIXED = false --bench override, see compile_scan's walk_dups

--[[local]] function compile_scan(db, plan)
	local schema = plan.schema
	local seek_fns = {} --{fn...}
	for i, expr in ipairs(plan.seek) do seek_fns[i] = compile_value(expr) end
	local in_fns = plan.in_values and {} --{fn...}
	if in_fns then
		for i, expr in ipairs(plan.in_values) do in_fns[i] = compile_value(expr) end
	end
	local lo_fn = plan.lo and compile_value(plan.lo.expr)
	local hi_fn = plan.hi and compile_value(plan.hi.expr)
	local prefix_fn = plan.prefix and compile_value(plan.prefix)
	local depth = plan.depth
	--plan.dir == 'desc' only ever comes from try_order_key's 'full'/'eq_prefix'
	--kinds (order_satisfied() matched the key order reversed): walk MDBX_PREV
	--from MDBX_LAST instead of MDBX_NEXT from MDBX_FIRST, straight into
	--order_by()'s wanted order instead of an explicit sort.
	local first_op = plan.dir == 'desc' and C.MDBX_LAST or C.MDBX_FIRST
	local next_op = plan.dir == 'desc' and C.MDBX_PREV or C.MDBX_NEXT
	--set by compile()'s stage 8 only for an eligible ungrouped distinct():
	--jump straight past the rest of the current duplicate group instead
	--of decoding and discarding each dup row one MDBX_NEXT at a time.
	if plan.next_nodup then next_op = C.MDBX_NEXT_NODUP end
	return function()
		local cur = db:cursor(schema.name)
		local base_cur --lazily opened only if a non-key column is read
		local buf = u8a(MDBX_MAX_KEY_SIZE)
		local depth_buf = depth > 0 and u8a(MDBX_MAX_KEY_SIZE) or nil
		--hi is only a stop bound; lo and prefix also position the cursor.
		local hi_buf = hi_fn and u8a(MDBX_MAX_KEY_SIZE)
		local ix_rec, pk_rec, val_rec = MDBX_val(), MDBX_val(), MDBX_val()
		local base_val_rec = MDBX_val()
		--DUPFIXED bulk scans need a separate record for the whole
		--multi-value page: pk_rec holds one row's slice at a time and
		--can't double as the page's own stable base pointer.
		local bulk_rec = MDBX_val()
		--MDBX_NODUPFIXED forces the one-dup-at-a-time path; bench-only toggle.
		local dup_fixedsize = schema.is_index and not MDBX_NODUPFIXED and schema.dup_fixedsize
		--[[
		- key_rec/out_rec pick which pre-allocated record plays which
		  mdbx cursor role, decided once (schema.is_index never changes).
		- an index's cursor key is the index key (ix_rec) and its value
		  is the pk (pk_rec); a base table's cursor key IS the pk
		  (pk_rec) and its value is the row itself (val_rec).
		- every seek/walk below writes straight into these via
		  move_raw_into, never move_raw_kv/move_raw_v's shared-global-
		  and-return-values path -- no per-row loose pointer values get
		  materialized just to copy them into ix_rec/pk_rec right after.
		]]
		local key_rec = schema.is_index and ix_rec or pk_rec
		local out_rec = schema.is_index and pk_rec or val_rec
		local function get_base_val()
			if schema.is_index then
				if not base_cur then base_cur = db:cursor(schema.val_table) end
				local found = base_cur:move_raw_into(C.MDBX_SET_KEY, pk_rec, base_val_rec)
				assert(found, 'base row missing for an existing key')
				return base_val_rec.data, base_val_rec.size
			end
			return val_rec.data, val_rec.size
		end
		local decoders = {} --{col->fn}
		--decoders compile once per column.
		--decode_col is scoped to this one step's schema.
		--col alone is unique inside that step.
		local function decode_col(col)
			local f = decoders[col]
			if not f then
				f = db:compile_col(schema, col, schema.is_index and ix_rec or nil,
					pk_rec, get_base_val)
				decoders[col] = f
			end
			return f()
		end
		--[[
		- walk every dup value under one exact index key.
		- a non-unique index with fixed-size dup values (dup_fixedsize)
		  bulk-fetches a whole page of dups per mdbx call
		  (MDBX_SEEK_AND_GET_MULTIPLE/MDBX_NEXT_MULTIPLE) instead of one
		  MDBX_NEXT-equivalent call per row -- into bulk_rec, since
		  pk_rec must keep pointing at one row's slice at a time.
		- MDBX_NEXT_MULTIPLE only ever returns more of the SAME already
		  -seeked key, so this never walks past the match onto a
		  different key -- no per-row boundary check is needed.
		- ix_rec is set once to the seek buffer: every dup shares that
		  key, so there's no need for mdbx to hand back the key per row.
		- base-table scans and non-fixedsize indexes fall back to one
		  row at a time, boundary-checked against seek_sz.
		]]
		local walk_dups
		if dup_fixedsize then
			function walk_dups(seek_buf, seek_sz, row_fn)
				ix_rec.data, ix_rec.size = seek_buf, seek_sz
				local ok = cur:move_raw_into(C.MDBX_SEEK_AND_GET_MULTIPLE, ix_rec, bulk_rec)
				local v_o = 0
				while ok do
					if v_o >= bulk_rec.size then
						ok = cur:move_raw_into(C.MDBX_NEXT_MULTIPLE, ix_rec, bulk_rec)
						v_o = 0
					else
						--assignment + pointer arith causes 5.5x slowdown with jit off,
						--giving only 2x total speed up for the entire DUPFIXED branch.
						pk_rec.data, pk_rec.size = bulk_rec.data + v_o, dup_fixedsize
						v_o = v_o + dup_fixedsize
						if row_fn(decode_col) then return true end
					end
				end
			end
		else
			function walk_dups(seek_buf, seek_sz, row_fn)
				key_rec.data, key_rec.size = seek_buf, seek_sz
				local ok = cur:move_raw_into(C.MDBX_SET_RANGE, key_rec, out_rec)
				while ok do
					if key_rec.size < seek_sz or memcmp(key_rec.data, seek_buf, seek_sz) ~= 0 then
						break
					end
					if row_fn(decode_col) then return true end
					ok = cur:move_raw_into(C.MDBX_NEXT, key_rec, out_rec)
				end
			end
		end
		--[[
		- vals holds the leading equality values for this execution.
		- slot depth+1 is temporary.
		- lo, prefix, and hi checks reuse slot depth+1.
		- other reads are bounded to 1..depth.
		]]
		local vals = {}
		local function run(params, row_ctx, row_fn)
			--in_() lists up to IN_UNION_MAX run as repeated exact seeks.
			--runtime candidate keys are deduped before seeking.
			--duplicate candidates do not emit matching rows more than once.
			if in_fns then
				local seen = {} --{encoded_key->true}
				for _, fn in ipairs(in_fns) do
					local v = fn(params, row_ctx)
					if v ~= nil and v ~= null then
						vals[1] = v
						local seek_sz = mdbx_encode_key_prefix(db, schema, 'get', buf,
							MDBX_MAX_KEY_SIZE, 1, false, v)
						local key = ffi.string(buf, seek_sz)
						if not seen[key] then
							seen[key] = true
							if walk_dups(buf, seek_sz, row_fn) then return true end
						end
					end
				end
				return
			end
			--null comparison operands match no rows.
			--a null equality seek cannot be satisfied.
			--the seek is skipped instead of seeking the null key.
			local null_seek = false
			for i, fn in ipairs(seek_fns) do
				local v = fn(params, row_ctx)
				if v == nil then null_seek = true end
				vals[i] = v
			end
			if null_seek then return end
			local ok
			local seek_sz --buf length for the current seek.
			--range lo and prefix encode depth+1 columns.
			--that same encoding is the later stop bound.
			if plan.kind == 'full' then
				ok = cur:move_raw_into(first_op, key_rec, out_rec)
			elseif plan.kind == 'exact' then
				--depth == #pk here (try_key's only 'exact' case): the whole
				--key is pinned, so walk_dups's own seek_sz boundary check
				--already does what the general loop's depth_sz check below
				--would (same encode call, same bytes) -- no need to fall
				--through to it.
				seek_sz = mdbx_encode_key_prefix(db, schema, 'get', buf,
					MDBX_MAX_KEY_SIZE, depth, false, unpack(vals, 1, depth))
				return walk_dups(buf, seek_sz, row_fn)
			else --range, prefix, eq_prefix
				local bound_val = lo_fn and lo_fn(params, row_ctx)
					or (prefix_fn and prefix_fn(params, row_ctx))
				--null lo/prefix facts match no rows.
				--absent lo/prefix bounds leave the depth prefix open.
				--eq_prefix scans everything under the depth-column prefix.
				if (lo_fn or prefix_fn) and bound_val == nil then return end
				local n = depth
				if bound_val ~= nil then
					vals[depth + 1] = bound_val
					n = depth + 1
				end
				seek_sz = mdbx_encode_key_prefix(db, schema, 'c_seek', buf,
					MDBX_MAX_KEY_SIZE, n, plan.kind == 'prefix', unpack(vals, 1, n))
				key_rec.data, key_rec.size = buf, seek_sz
				if plan.dir == 'desc' then
					--eq_prefix desc (the only kind reaching here with dir ==
					--'desc': bound_val is always nil, so n == depth): bump
					--the depth-column prefix to its own upper bound and land
					--on the last key at or under it, then walk backward.
					--an all-0xff prefix has no upper bound -- it already IS
					--the table's last key, so land on MDBX_LAST directly.
					local end_sz = increment_prefix(buf, seek_sz)
					if end_sz then
						key_rec.size = end_sz
						ok = cur:move_raw_into(C.MDBX_TO_KEY_LESSER_OR_EQUAL, key_rec, out_rec)
					else
						ok = cur:move_raw_into(C.MDBX_LAST, key_rec, out_rec)
					end
				else
					ok = cur:move_raw_into(C.MDBX_SET_RANGE, key_rec, out_rec)
				end
			end
			--[[
			- depth_buf encodes only the leading equality columns.
			- it detects when the cursor leaves the current prefix.
			- later key columns cannot change earlier encoded bytes.
			- the same check works for every plan kind.
			]]
			local depth_sz
			if depth > 0 then
				depth_sz = mdbx_encode_key_prefix(db, schema, 'get', depth_buf,
					MDBX_MAX_KEY_SIZE, depth, false, unpack(vals, 1, depth))
			end
			--[[
			- q.col() hi values read earlier scheduled members.
			- hi values are fixed for this invocation.
			- hi is evaluated, null-checked, and encoded once.
			- inclusive hi is bumped to a strict upper bound.
			- overflow means no finite upper bound exists.
			]]
			local hi_sz
			if plan.kind == 'range' and hi_fn then
				local hv = hi_fn(params, row_ctx)
				if hv == nil then return end
				vals[depth + 1] = hv
				hi_sz = mdbx_encode_key_prefix(db, schema, 'get', hi_buf,
					MDBX_MAX_KEY_SIZE, depth + 1, false, unpack(vals, 1, depth + 1))
				if plan.hi.op == 'le' then
					hi_sz = increment_prefix(hi_buf, hi_sz)
				end
			end
			while ok do
				--stop when leading equality columns no longer match.
				--compare only depth_sz bytes.
				--trailing key bytes do not affect this check.
				if depth_sz and (key_rec.size < depth_sz
					or memcmp(key_rec.data, depth_buf, depth_sz) ~= 0)
				then
					break
				end
				--cursor keys are sorted.
				--reaching or passing hi_sz means the scan is done.
				--hi_sz is a strict boundary for both hi operators.
				if hi_sz and raw_key_cmp(key_rec.data, key_rec.size, hi_buf, hi_sz) >= 0 then
					break
				end
				--prefix reuses the seek buffer.
				--the row key must keep the encoded prefix.
				--no length tie-break is needed.
				if plan.kind == 'prefix' then
					if key_rec.size < seek_sz or memcmp(key_rec.data, buf, seek_sz) ~= 0 then
						break
					end
				end
				--[[
				- a lo bound only rejects rows exactly at the boundary.
				- the seek already guarantees returned rows are >= lo.
				- strict lo rejects exact equality.
				- the seek buffer already holds the depth+lo encoding.
				]]
				local passes_lo = true
				if plan.kind == 'range' and lo_fn then
					passes_lo = not (key_rec.size >= seek_sz
						and memcmp(key_rec.data, buf, seek_sz) == 0
						and plan.lo.op == 'gt')
				end
				if passes_lo then
					if row_fn(decode_col) then return true end
				end
				ok = cur:move_raw_into(next_op, key_rec, out_rec)
			end
		end
		local function close()
			if base_cur then base_cur:close() end
			cur:close()
		end
		return run, close
	end
end

--[[
- compile one relation-kind source/join step.
- called once per step at compile time.
- returns an opener for one query execution.
- opener returns run(params, row_ctx, row_fn) and close().
- run materializes the inner relation's rows fresh per call, so a joined
  relation re-evaluates per outer driving row (same as a correlated subquery).
- row_ctx seeds the inner relation for correlated where()/on() reads.
- there is no cursor to hold open: rows are already fully decoded.
]]
--[[local]] function compile_relation_scan(nested_rel)
	local output_fields = nested_rel.output_fields
	return function()
		local function run(params, row_ctx, row_fn)
			local rows = nested_rel.union_inputs
				and union_rows(nested_rel, params, row_ctx)
				or build_rows(nested_rel, params, row_ctx)
			for _, row in ipairs(rows) do
				local function decode_col(col) return row[output_fields[col].index] end
				if row_fn(decode_col) then return true end
			end
		end
		local function close() end
		return run, close
	end
end

--[[
- compile one virtual-table source/join step.
- called once per step at compile time.
- returns an opener for one query execution.
- opener returns run(params, row_ctx, row_fn) and close().
- schema.open()/next_row()/get_col()/close() are application-supplied on
  the table's schema object; this adapts that row-at-a-time protocol to
  the same run/close shape compile_scan/compile_relation_scan return.
- no seek capability: run() rescans from schema.open() every call, same
  as a joined relation re-evaluating fresh per outer driving row.
- the outer close() is a no-op: each run() call closes its own scan, so
  there is nothing left open across calls for close_access() to release.
]]
--[[local]] function compile_virtual_scan(schema)
	assert(schema.get_col)
	return function()
		local function run(params, row_ctx, row_fn)
			call(schema.open, params)
			local stop = false
			while schema.next_row() do
				if row_fn(schema.get_col) then
					stop = true
					break
				end
			end
			call(schema.close)
			return stop
		end
		local function close() end
		return run, close
	end
end

--[[
- read a value operand for a residual check.
- literals return themselves.
- q.param() reads params.
- q.col() reads any already-scanned member through row_ctx.
- the member can differ from the step that owns the residual.
]]
local function eval_value(x, params, row_ctx)
	if type(x) ~= 'table' then return x end
	if x[1] == 'param' then return params[x[2]] end
	if x[1] == 'col' then return row_ctx[x.source.member](x[3]) end
	error('unsupported residual operand: '..tostring(x[1]))
end
local function null_value(v)
	return v == nil or v == null
end
--is x a column read (q.col()) that points at an ai_ci field? if so we
--have to fold both sides before comparing, not just compare the raw text.
local function ai_ci_operand(x)
	return type(x) == 'table' and x[1] == 'col' and x.field
		and x.field.mdbx_collation == 'utf8_ai_ci'
end
--where()/having() treat only false, nil, and null as rejection.
local function expr_passes(v)
	return v ~= nil and v ~= false and v ~= null
end

--[[
- evaluate scalar expressions for residual and having() checks.
- group_row set means having(): col/param read the finished group row.
- group_row nil means residual: col/param read through row_ctx.
]]
local function eval_expr(expr, params, row_ctx, group_row)
	if type(expr) ~= 'table' then return expr end
	local op, a, b = unpack(expr, 1, 3)
	if op == 'param' or op == 'col' then
		if group_row then
			if op == 'param' then return params[a] end
			assertf(op == 'col', 'unsupported having operand: %s', op)
			return group_row[expr.field.index]
		end
		return eval_value(expr, params, row_ctx)
	end
	if op == 'and' then
		for i = 2, #expr do
			if not expr_passes(eval_expr(expr[i], params, row_ctx, group_row)) then
				return false
			end
		end
		return true
	elseif op == 'or' then
		for i = 2, #expr do
			if expr_passes(eval_expr(expr[i], params, row_ctx, group_row)) then
				return true
			end
		end
		return false
	elseif op == 'is_null' then
		return null_value(eval_expr(a, params, row_ctx, group_row))
	elseif op == 'is_not_null' then
		return not null_value(eval_expr(a, params, row_ctx, group_row))
	elseif op == 'starts' then
		local v = eval_expr(a, params, row_ctx, group_row)
		local prefix = eval_expr(b, params, row_ctx, group_row)
		if null_value(v) or null_value(prefix) then return false end
		if type(v) ~= 'string' then return false end
		--for an ai_ci column, fold both sides first (same folding an ai_ci
		--index does) so "CA" matches "cafe" too.
		if ai_ci_operand(a) then v, prefix = mdbx_fold_ai_ci(v), mdbx_fold_ai_ci(prefix) end
		return v:sub(1, #prefix) == prefix
	elseif op == 'in' or op == 'not_in' then
		--membership checks scan the candidate set and ignore null candidates.
		local v = eval_expr(a, params, row_ctx, group_row)
		if null_value(v) then return false end
		local fold = ai_ci_operand(a)
		if fold then v = mdbx_fold_ai_ci(v) end
		local found = false
		if is_relation(b) then
			local name = b.returned_fields[1]
			local index = b.output_fields[name].index
			local rows = b.union_inputs
				and union_rows(b, params, row_ctx)
				or build_rows(b, params, row_ctx)
			for _, row in ipairs(rows) do
				local candidate = row[index]
				if not null_value(candidate) then
					if fold then candidate = mdbx_fold_ai_ci(candidate) end
					if v == candidate then found = true; break end
				end
			end
		else
			local param_list = type(b) == 'table' and b[1] == 'param'
			local values
			if param_list then values = eval_expr(b, params, row_ctx, group_row)
			else values = b end
			for _, item in ipairs(values) do
				local candidate = param_list and item or eval_expr(item, params, row_ctx, group_row)
				if not null_value(candidate) then
					if fold then candidate = mdbx_fold_ai_ci(candidate) end
					if v == candidate then found = true; break end
				end
			end
		end
		if op == 'in' then return found end
		return not found
	elseif op == 'exists' or op == 'not_exists' then
		--existence checks run the right side with the current row as context.
		local found
		if is_relation(a) then
			found = eval_relation_exists(a, params, row_ctx)
		else
			found = eval_exists_source(a, params, row_ctx)
		end
		if op == 'exists' then return found end
		return not found
	end
	--comparisons involving null are false (see the file's own "nulls" doc).
	local va, vb = eval_expr(a, params, row_ctx, group_row), eval_expr(b, params, row_ctx, group_row)
	if null_value(va) or null_value(vb) then return false end
	if ai_ci_operand(a) or ai_ci_operand(b) then
		va, vb = mdbx_fold_ai_ci(va), mdbx_fold_ai_ci(vb)
	end
	if op == 'eq' then return va == vb
	elseif op == 'ne' then return va ~= vb
	elseif op == 'lt' then return key_cmp(va, vb) < 0
	elseif op == 'le' then return key_cmp(va, vb) <= 0
	elseif op == 'gt' then return key_cmp(va, vb) > 0
	elseif op == 'ge' then return key_cmp(va, vb) >= 0
	else error('unsupported condition op: '..tostring(op)) end
end
--evaluate a where()/on_expr row check against the current row context.
local function eval_residual(expr, params, row_ctx)
	return expr_passes(eval_expr(expr, params, row_ctx, nil))
end
--evaluate having() against a finished group row.
local function eval_having(expr, params, group_row)
	return expr_passes(eval_expr(expr, params, nil, group_row))
end

--decode a missing right-side member.
--every column reads as nil.
--used for left joins and empty nested groups.
local function nil_decode() return nil end

--[[
- test whether natural scan order satisfies ordered terms.
- terms are ordered by order_by() priority.
- fixed natural columns are skipped.
- varying natural columns must match in sequence.
- dir must match when a term declares it.
]]
function order_satisfied(terms, natural)
	local fixed = {} --{'member.col'->true}
	local varying = {} --{{member=,col=,dir=}...}
	for _, n in ipairs(natural) do
		if n.fixed then fixed[n.member..'.'..n.col] = true
		else add(varying, n) end
	end
	local vi = 1
	for _, term in ipairs(terms) do
		if not fixed[term.member..'.'..term.col] then
			local v = varying[vi]
			if not v or v.member ~= term.member or v.col ~= term.col
				or (term.dir and term.dir ~= v.dir) then
				return false
			end
			vi = vi + 1
		end
	end
	return true
end

--[[
- test whether natural scan order groups a set of columns together.
- term order does not matter.
- fixed natural columns are skipped.
- remaining terms must cover the exact varying prefix as a set.
- skipping a varying prefix column would split equal groups apart.
- second return is how many varying columns the terms covered: callers
  that need the terms to cover the WHOLE varying tail (not just a
  prefix of it) compare this against #varying themselves.
]]
--[[local]] function order_satisfied_set(terms, natural)
	local fixed = {} --{'member.col'->true}
	local varying = {} --{{member=,col=}...}
	for _, n in ipairs(natural) do
		if n.fixed then fixed[n.member..'.'..n.col] = true
		else add(varying, n) end
	end
	local wanted = {} --{'member.col'->true}
	local n_wanted = 0
	for _, term in ipairs(terms) do
		local key = term.member..'.'..term.col
		if not fixed[key] then
			wanted[key] = true
			n_wanted = n_wanted + 1
		end
	end
	if n_wanted > #varying then return false end
	for i = 1, n_wanted do
		if not wanted[varying[i].member..'.'..varying[i].col] then return false end
	end
	return true, n_wanted
end

--[[
- true when rows with the same key values are guaranteed to come out
  next to each other, so distinct()/group() can dedup by comparing
  each row to the one before it instead of hashing.
- one way that holds: the index the base scan picked already groups
  these columns together (order_satisfied_set checks that).
- another way, with no index needed: the columns cover the base
  table's whole primary key. nested-loop execution visits each base
  row once, so all of its fan-out rows come out together, no matter
  what order the scan runs in.
]]
local function terms_group_consecutive(rel, terms)
	if order_satisfied_set(terms, rel.natural_order) then return true end
	if rel.source.kind ~= 'table' then return false end
	local needed = {} --{col->true}
	for _, field in ipairs(rel.source.schema.key_fields) do needed[field.col] = true end
	for _, term in ipairs(terms) do
		if term.member ~= rel.source.member then return false end
		needed[term.col] = nil
	end
	return not next(needed)
end

--[[
- resolve a returned output name to {member=, col=}.
- succeeds only for plain q.col() outputs bound to source fields.
- distinct() and order_by() use this to reuse natural scan order.
- returns nil for aggregates and computed outputs.
]]
function output_source_col(self, name)
	local outputs = self.select_outputs or self.group_outputs
	for _, output in ipairs(outputs) do
		if output[2] == name then
			return col_term(output[1])
		end
	end
end

--[[
- resolve every name in fields (self.returned_fields by default) to a
  {member=, col=} term.
- nil if any field is not a plain source-column passthrough (an aggregate
  or computed output).
- distinct()'s streaming dedup and the NEXT_NODUP compile-time check
  (shared by distinct() and group() with no aggregate outputs) share
  this: all three need the dedup columns to be readable straight off the
  scan key, not computed.
]]
function returned_source_terms(self, fields)
	local terms = {} --{{member=,col=}...}
	for _, name in ipairs(fields or self.returned_fields) do
		local src = output_source_col(self, name)
		if not src then return nil end
		add(terms, src)
	end
	return terms
end

--collect every member name covered by one access step.
--recurse into nested groups.
--used to null-extend every member in a left-joined fragment at once.
local function step_members(step, list)
	list = list or {} --{member_name...}
	if step.nested then
		for _, s in ipairs(step.nested) do step_members(s, list) end
	else
		add(list, step.member.member)
	end
	return list
end

--[[
- build one processor per access step for one execution.
- processors close over shared params and row_ctx.
- the returned function walks all access steps.
- next_step() runs once per complete row combination.
- normal joins call next_step() once per matching row.
- unmatched left joins call next_step() once with a nil decoder.
- nested groups call next_step() once per inner combination.
- empty nested groups null-extend every inner member once.
- closures are built once per execution, not once per driver row.
- row_ctx is mutated in place during one query execution.
- a true result from next_step(), or from a step's run(), stops the
  whole walk; every wrapper forwards it up to its own caller.
]]
local function build_processors(steps, params, row_ctx, next_step)
	local rest = next_step
	for i = #steps, 1, -1 do
		local step = steps[i]
		local this_rest = rest
		if step.nested then
			local found
			local members = step_members(step)
			local nested_start = build_processors(step.nested, params, row_ctx, function()
				found = true
				return this_rest()
			end)
			rest = function()
				found = false
				if nested_start() then return true end
				if not found then
					for _, member in ipairs(members) do
						row_ctx[member] = nil_decode
					end
					return this_rest()
				end
			end
		else
			local found
			local member = step.member.member
			local residual = step.plan.residual
			local function on_match(decode_col)
				row_ctx[member] = decode_col
				for _, cond in ipairs(residual) do
					if not eval_residual(cond.expr, params, row_ctx) then return end
				end
				found = true
				return this_rest()
			end
			local is_left = step.join and step.join.kind == 'left_join'
			rest = function()
				found = false
				if step.run(params, row_ctx, on_match) then return true end
				if not found and is_left then
					row_ctx[member] = nil_decode
					return this_rest()
				end
			end
		end
	end
	return rest
end

--[[
- open every step cursor for one execution.
- open scratch buffers before scanning rows.
- recurse into nested left-join fragment steps.
- return opened steps for close_access().
- relation sources open their compiled inner relation, not a cursor.
]]
local function open_access(access, opened)
	opened = opened or {} --{step...}
	for _, step in ipairs(access) do
		if step.nested then
			open_access(step.nested, opened)
		elseif step.open then
			step.run, step.close = step.open()
			add(opened, step)
		end
	end
	return opened
end

local function close_access(opened)
	for _, step in ipairs(opened) do
		step.close()
	end
end

--[[
- run one query execution.
- open every step once.
- build the step chain once.
- reuse cursors and buffers for every row.
- close opened steps once the walk finishes normally or stops early.
- on error, cursors stay owned by the enclosing transaction: its own
  abort unbinds them, so no cleanup is needed here (see Db:atomic()).
]]
local function run_query(access, params, emit, seed_row_ctx)
	local opened = open_access(access)
	--correlated subqueries inherit outer member decoders through row_ctx.
	local row_ctx = seed_row_ctx and setmetatable({}, {__index = seed_row_ctx}) or {}
	local process = build_processors(access, params, row_ctx, function() return emit(row_ctx) end)
	process()
	close_access(opened)
end

--[[
- open one exists()/not_exists() table-spec source for this execution.
- on_expr is planned like a join's on_expr: split into facts once, then
  choose_access seeks whatever index those facts support -- cached on the
  source permanently, since the plan never depends on which execution
  this is, only on the query's shape.
- the scan itself (source.exists_run) is opened fresh here and closed by
  the caller at the end of this same execution, instead of being reopened
  by eval_exists_source on every row: run_filtered calls this once per
  rel.exists_sources entry, matching how a real access step's cursor is
  opened once per execution and only reseeked per row.
- use_index()/no_index() do not apply here: this table is never a named
  member of the outer relation, so forced/forbidden are always nil.
- returns close(), for the caller to tear down at the end of this run.
]]
local function open_exists_source(entry)
	local source, on = entry.source, entry.on
	if not source.exists_plan then
		local conditions = (on == nil or on == true) and empty or split_conditions({on}, true)
		local members = {[source.member] = source}
		source.exists_plan = choose_access(source, conditions, members, nil, nil)
	end
	local opener = source.schema.virtual
		and compile_virtual_scan(source.schema)
		or compile_scan(source.db, source.exists_plan)
	local run, close = opener()
	source.exists_run = run
	return close
end

--evaluate table-form exists(): source.exists_run is already open for this
--execution (run_filtered opened it before any row was scanned), so this
--only seeks and reads -- whatever the chosen index does not prove stays
--a residual row check.
function eval_exists_source(source, params, row_ctx)
	local found = false
	local child_ctx = row_ctx and setmetatable({}, {__index = row_ctx}) or {}
	local residual = source.exists_plan.residual
	source.exists_run(params, child_ctx, function(decode_col)
		child_ctx[source.member] = decode_col
		for _, cond in ipairs(residual) do
			if not eval_residual(cond.expr, params, child_ctx) then return end
		end
		found = true
		return true
	end)
	return found
end

--run relation-level where() checks.
--cross-member checks run here after all members are scanned.
--checks that read no source members also run here.
local function run_filtered(rel, params, emit, seed_row_ctx)
	local late_conditions = rel.late_conditions
	run_query(rel.access, params, function(row_ctx)
		for _, cond in ipairs(late_conditions) do
			if not eval_residual(cond.expr, params, row_ctx) then return end
		end
		return emit(row_ctx)
	end, seed_row_ctx)
end

--[[
- call fn(...) with this relation's exists()/not_exists() table-spec
  sources opened for fn's whole duration, closed once fn returns or
  raises -- instead of eval_exists_source opening one fresh per row.
- must wrap the outermost call that evaluates this relation for one
  terminal, not run_filtered/run_grouped themselves: a grouped call's
  having() checks run in finish_group_row, after run_filtered's own scan
  already returned, so the bracket has to span both or having()'s exists()
  finds its cursor already closed.
- callers that delegate to build_rows (which wraps itself) must not wrap
  again -- one bracket per relation per execution, never nested, since a
  nested open would overwrite source.exists_run out from under the outer
  bracket's later use (its own close would then leave the outer context
  holding a closed cursor).
]]
local function with_exists_sources(rel, fn, ...)
	local exists_closes = {} --{close_fn...}
	for _, entry in ipairs(rel.exists_sources) do
		add(exists_closes, open_exists_source(entry))
	end
	local ok, err = pcall(fn, ...)
	for _, close in ipairs(exists_closes) do close() end
	if not ok then error(err, 0) end
end

function Rel:prepare(terminal_kind)
	compile(self, terminal_kind or 'rows', nil, true)
	return self
end

local aggregate_ops = {count = true, min = true, max = true, sum = true, avg = true} --{op->true}

--[[
- fold one row into an aggregate accumulator.
- accumulator shape: {n=count, v=running value}.
- min(), max(), and sum() keep a running value.
- avg() keeps sum in v and count in n.
- count(expr) counts non-null values.
- count() counts every row.
]]
local function accumulate(a, expr, params, row_ctx)
	local op, arg = expr[1], expr[2]
	local v = arg and eval_value(arg, params, row_ctx)
	if op == 'count' then
		if not arg or v ~= nil then a.n = a.n + 1 end
	elseif v ~= nil then
		if op == 'min' then if a.v == nil or key_cmp(v, a.v) < 0 then a.v = v end
		elseif op == 'max' then if a.v == nil or key_cmp(v, a.v) > 0 then a.v = v end
		elseif op == 'sum' then a.v = (a.v or 0) + v
		elseif op == 'avg' then a.v = (a.v or 0) + v; a.n = a.n + 1
		end
	end
end
--the final output value of a finished accumulator.
local function finish_aggregate(a, op)
	if op == 'count' then return a.n end
	if op == 'avg' then return a.n > 0 and (a.v / a.n) or nil end
	return a.v
end

--[[
- finish one group.
- write aggregate output values.
- apply having().
- emit the group row or select() projection.
- shared by hash and streaming group implementations.
]]
local function finish_group_row(self, params, group_outputs, agg_ids, g, rows)
	for _, i in ipairs(agg_ids) do
		g.row[i] = finish_aggregate(g.acc[i], group_outputs[i][1][1])
	end
	local passes = true
	for _, cond in ipairs(self.having_conditions) do
		if not eval_having(cond.expr, params, g.row) then passes = false; break end
	end
	if passes then
		if self.select_outputs then
			local row = {} --{value...}
			for i, output in ipairs(self.select_outputs) do
				local expr = output[1]
				assert(expr[1] == 'col', 'only plain column select() outputs are implemented so far')
				row[i] = g.row[expr.field.index]
			end
			add(rows, row)
		else
			add(rows, g.row)
		end
	end
end

local function new_group(group_outputs, agg_ids, g)
	g = g or {}
	local acc = {} --{output_index->{n=0,v=nil}}
	for _, i in ipairs(agg_ids) do acc[i] = {n = 0, v = nil} end
	g.row = {} --{value...}, filled in once finished
	g.acc = acc
	return g
end

--[[
- implement hash-based group()+having().
- materialize one row per distinct group key.
- one key uses the value itself; many keys use an interned value tuple.
- aggregate input rows as they arrive.
- finish groups after all input rows are drained.
- works for any input order.
]]
local function run_grouped_hash(self, params, rows, group_outputs, key_ids, agg_ids, seed_row_ctx)
	local one_key_groups = #key_ids == 1 and {} --{value->group}
	local tuple_space = #key_ids > 1 and tuples(#key_ids)
	local vals = tuple_space and {} --{value...}
	local group_keys = {} --{group...}: first-seen order
	local all_group
	local saw_input = false
	run_filtered(self, params, function(row_ctx)
		saw_input = true
		local g
		if one_key_groups then
			local i = key_ids[1]
			local v = eval_value(group_outputs[i][1], params, row_ctx)
			local key = v ~= nil and v or null
			g = one_key_groups[key]
			if not g then
				g = new_group(group_outputs, agg_ids)
				g.row[i] = v
				one_key_groups[key] = g
				add(group_keys, g)
			end
		elseif tuple_space then
			for j, i in ipairs(key_ids) do
				vals[j] = eval_value(group_outputs[i][1], params, row_ctx)
			end
			g = tuple_space(unpack(vals, 1, #key_ids))
			if not g.row then
				new_group(group_outputs, agg_ids, g)
				for j, i in ipairs(key_ids) do g.row[i] = vals[j] end
				add(group_keys, g)
			end
		else
			g = all_group
			if not g then
				g = new_group(group_outputs, agg_ids)
				all_group = g
				add(group_keys, g)
			end
		end
		for _, i in ipairs(agg_ids) do
			accumulate(g.acc[i], group_outputs[i][1], params, row_ctx)
		end
	end, seed_row_ctx)
	--[[
	- all-aggregate outputs have no key columns.
	- they always produce one group.
	- empty input gives count() = 0.
	- empty input gives other aggregates nil.
	]]
	if not saw_input and #key_ids == 0 then
		all_group = new_group(group_outputs, agg_ids)
		add(group_keys, all_group)
	end
	for _, g in ipairs(group_keys) do
		finish_group_row(self, params, group_outputs, agg_ids, g, rows)
	end
end

--[[
- implement streaming group()+having().
- caller proves scan order keeps equal group keys adjacent.
- consecutive rows with the same key fold into the current group.
- no hash table or string group keys are needed.
- a group finishes when the key changes.
]]
local function run_grouped_streaming(self, params, rows, group_outputs, key_ids, agg_ids,
	seed_row_ctx)
	local cur_key, cur_g
	local function keys_equal(a, b)
		for i = 1, #a do
			if a[i] ~= b[i] then return false end
		end
		return true
	end
	run_filtered(self, params, function(row_ctx)
		local key = {} --{val...}
		for i, id in ipairs(key_ids) do
			key[i] = eval_value(group_outputs[id][1], params, row_ctx)
		end
		if not cur_g or not keys_equal(key, cur_key) then
			if cur_g then finish_group_row(self, params, group_outputs, agg_ids, cur_g, rows) end
			cur_key, cur_g = key, new_group(group_outputs, agg_ids)
			for _, i in ipairs(key_ids) do
				cur_g.row[i] = eval_value(group_outputs[i][1], params, row_ctx)
			end
		end
		for _, i in ipairs(agg_ids) do
			accumulate(cur_g.acc[i], group_outputs[i][1], params, row_ctx)
		end
	end, seed_row_ctx)
	if cur_g then
		finish_group_row(self, params, group_outputs, agg_ids, cur_g, rows)
	elseif #key_ids == 0 then
		--all-aggregate outputs have no key columns.
		--empty input produces one group.
		--count() is 0 and other aggregates are nil.
		finish_group_row(self, params, group_outputs, agg_ids,
			new_group(group_outputs, agg_ids), rows)
	end
end

local function run_grouped(self, params, rows, seed_row_ctx)
	local group_outputs = self.group_outputs
	local key_ids, agg_ids = {}, {} --{output_index...}
	for i, output in ipairs(group_outputs) do
		local expr = output[1]
		add(type(expr) == 'table' and aggregate_ops[expr[1]] and agg_ids or key_ids, i)
	end
	--[[
	- streaming needs key columns to be plain q.col() expressions.
	- those q.col() expressions must be bound to source fields.
	- computed key expressions require hashing.
	- matching rows must come out consecutively (terms_group_consecutive
	  checks that).
	- join fan-out stays nested inside each driver row.
	]]
	local key_terms, streaming = {}, true --{{member=,col=}...}
	for _, i in ipairs(key_ids) do
		local ct = col_term(group_outputs[i][1])
		if ct then
			add(key_terms, ct)
		else
			streaming = false
			break
		end
	end
	streaming = streaming and terms_group_consecutive(self, key_terms)
	if streaming then
		run_grouped_streaming(self, params, rows, group_outputs, key_ids, agg_ids,
			seed_row_ctx)
	else
		run_grouped_hash(self, params, rows, group_outputs, key_ids, agg_ids,
			seed_row_ctx)
	end
end

--evaluate relation-form exists(); grouped relations must finish groups first.
function eval_relation_exists(rel, params, row_ctx)
	if rel.union_inputs then
		for _, input in ipairs(rel.union_inputs) do
			if eval_relation_exists(input, params, row_ctx) then return true end
		end
		return false
	end
	if rel.group_outputs then
		local rows = {} --{row...}
		run_grouped(rel, params, rows, row_ctx)
		return rows[1] ~= nil
	end
	local found = false
	run_filtered(rel, params, function()
		found = true
		return true
	end, row_ctx)
	return found
end

--[[
- read one order_by() key value.
- terms bound to output fields read the built output row.
- terms bound to source fields read row_ctx before it goes out of scope.
- terms bound to source fields may not be present in the output row.
- for an ai_ci field, fold the value first (same folding an ai_ci index
  does), so we sort "Cafe" next to "cafe" instead of by raw text.
]]
local function order_key(term, row, row_ctx)
	local expr = term[1]
	local v = expr.source and row_ctx[expr.source.member](expr[3]) or row[expr.field.index]
	if v ~= nil and expr.field.mdbx_collation == 'utf8_ai_ci' then
		v = mdbx_fold_ai_ci(v)
	end
	return v
end

--compare order_by() keys with null handling.
--ascending sorts null first.
--descending reverses that order.
local function order_cmp(av, bv, dir)
	local c
	if av == nil and bv == nil then c = 0
	elseif av == nil then c = -1
	elseif bv == nil then c = 1
	else c = key_cmp(av, bv) end
	return dir == 'desc' and -c or c
end

local function eval_limit_value(x, params)
	if type(x) ~= 'table' then return x end
	assert(x[1] == 'param', 'unsupported limit()/offset() value')
	return params[x[2]]
end

--[[
- resolve one order_by() term to {member=, col=, dir=}.
- terms bound to source fields resolve directly.
- terms bound to output fields resolve through select()/group() output names.
- terms bound to output fields are order-checkable only for plain passthrough outputs.
- aggregate or computed outputs return nil.
]]
local function order_term(self, term)
	local expr, dir = term[1], term[2]
	if expr.source then
		return {member = expr.source.member, col = expr[3], dir = dir}
	end
	local src = output_source_col(self, expr.field.name)
	return src and {member = src.member, col = src.col, dir = dir}
end

--[[
- decide whether order_by() needs an explicit sort.
- no order_by() means no sort.
- group() and distinct() sort explicitly for now.
- plain ungrouped rows can reuse driving-member scan order.
- build_rows() uses this to skip sorting.
- rows_array() uses this to push limit()/offset().
]]
local function sort_actually_needed(self)
	if not self.order_by_terms then return false end
	if self.group_outputs or self.distinct_rows then return true end
	local terms = {} --{{member=,col=,dir=}...}
	for _, term in ipairs(self.order_by_terms) do
		local t = order_term(self, term)
		if not t then return true end
		add(terms, t)
	end
	return not order_satisfied(terms, self.natural_order)
end

--project select_outputs (plain columns only) into a sparse array row.
local function project_row(outputs, row_ctx)
	local row = {} --{value...}
	for i, output in ipairs(outputs) do
		local expr = output[1]
		assert(expr[1] == 'col', 'only plain column select() outputs are implemented so far')
		row[i] = row_ctx[expr.source.member](expr[3])
	end
	return row
end

--[[
	dedup rows by field values, keyed through a tuple space for proper value
	identity (glue.lua tuples()) instead of stringifying and concatenating
	values into a hash key.
	- for a 1-col key the value itself is the seen-table key.
	- null substitutes for a missing single-field value so it can be used as
	a table key (Lua rejects a nil key); the multi-field tuple space handles
	nil positions on its own.
]]
local function hash_dedup_rows(rows, fields, output_fields)
	local deduped = {} --{row...}
	local seen = {} --{key->true}
	local nfields = #fields
	local indexes = {} --{field_index...}
	for i, name in ipairs(fields) do indexes[i] = output_fields[name].index end
	if nfields == 1 then
		local index = indexes[1]
		for _, row in ipairs(rows) do
			local v = row[index]
			local key = v ~= nil and v or null
			if not seen[key] then seen[key] = true; add(deduped, row) end
		end
	else
		local tuple_space = tuples()
		local vals = {} --{val...}
		for _, row in ipairs(rows) do
			for i = 1, nfields do vals[i] = row[indexes[i]] end
			local key = tuple_space(unpack(vals, 1, nfields))
			if not seen[key] then seen[key] = true; add(deduped, row) end
		end
	end
	return deduped
end

--materialize returned rows after filtering, grouping, distinct, sort, and limit.
function build_rows(self, params, seed_row_ctx)
	local rows = {} --{row...}
	local sort_keys = {} --{row->{val...}}: only filled when an explicit sort is needed
	local sort_needed = sort_actually_needed(self)

	if self.group_outputs then
		with_exists_sources(self, run_grouped, self, params, rows, seed_row_ctx)
		if sort_needed then
			for _, row in ipairs(rows) do
				local key = {} --{val...}
				for i, term in ipairs(self.order_by_terms) do
					key[i] = order_key(term, row, nil)
				end
				sort_keys[row] = key
			end
		end
	else
		local outputs = self.select_outputs
		with_exists_sources(self, run_filtered, self, params, function(row_ctx)
			local row = project_row(outputs, row_ctx)
			if sort_needed then
				local key = {} --{val...}
				for i, term in ipairs(self.order_by_terms) do
					key[i] = order_key(term, row, row_ctx)
				end
				sort_keys[row] = key
			end
			add(rows, row)
		end, seed_row_ctx)
	end

	if self.distinct_rows then
		local fields = dedup_key_fields(self)
		--[[
		- streaming distinct removes adjacent duplicates.
		- it applies only to plain ungrouped rows.
		- every dedup field must be a source-column passthrough.
		- rows with the same dedup value must come out consecutively
		  (terms_group_consecutive checks that).
		]]
		local streaming = false
		if not self.group_outputs then
			local terms = returned_source_terms(self, fields)
			streaming = terms ~= nil and terms_group_consecutive(self, terms)
		end
		if streaming then
			local deduped = {} --{row...}
			local indexes = {} --{field_index...}
			for i, name in ipairs(fields) do indexes[i] = self.output_fields[name].index end
			local prev
			for _, row in ipairs(rows) do
				local dup = prev ~= nil
				if dup then
					for i = 1, #indexes do
						local index = indexes[i]
						if row[index] ~= prev[index] then dup = false; break end
					end
				end
				if not dup then add(deduped, row) end
				prev = row
			end
			rows = deduped
		else
			rows = hash_dedup_rows(rows, fields, self.output_fields)
		end
	end
	if sort_needed then
		table.sort(rows, function(a, b)
			local ak, bk = sort_keys[a], sort_keys[b]
			for i, term in ipairs(self.order_by_terms) do
				local c = order_cmp(ak[i], bk[i], term[2])
				if c ~= 0 then return c < 0 end
			end
			return false
		end)
	end
	if self.limit_rows then
		local n = eval_limit_value(self.limit_rows.n, params)
		local offset = self.limit_rows.offset and eval_limit_value(self.limit_rows.offset, params) or 0
		local limited = {} --{row...}
		for i = offset + 1, math.min(offset + n, #rows) do
			add(limited, rows[i])
		end
		rows = limited
	end
	return rows
end

--[[
materialize a union relation's rows: each input read in full and
concatenated. union is a bag union, never deduped -- wrap it with
from(union, alias):distinct() for set-union semantics.
used by rows()/first()/one()/must_one()/rows_array() and relation materialization sites
such as from(rel, alias) and relation-form in_()/not_in(); count() sums each
input's own count() instead (see compile_union) and exists() never
materializes rows.
seed_row_ctx carries any outer row decoders into each union input.
not lowered to a single pass over a merged pk stream (mdbx_query_builder.lua's
rejected "pk-level union pushdown" bench note found ~2x there but judged not
worth the added surface) -- no evidence yet that this engine needs it either.
]]
function union_rows(self, params, seed_row_ctx)
	local rows = {} --{row...}
	for _, input in ipairs(self.union_inputs) do
		for _, row in ipairs(build_rows(input, params, seed_row_ctx)) do
			add(rows, row)
		end
	end
	return rows
end

--[[
- collect result rows for rows(), first(), one(), must_one(), and rows_array().
- stop the scan once enough rows are produced.
- early stop is allowed only before stages that need every row.
- group(), distinct(), and explicit sort require all rows first.
- limit is the caller terminal cap.
- self.limit_rows adds query limit and offset.
- pushable limit composes into one raw-scan cap.
- leading offset rows are trimmed before returning.
]]
local function rows_array(self, params, limit, seed_row_ctx)
	if self.union_inputs then
		return union_rows(self, params, seed_row_ctx)
	end
	if self.group_outputs or self.distinct_rows or sort_actually_needed(self) then
		return build_rows(self, params, seed_row_ctx)
	end
	local offset, cap = 0, limit
	if self.limit_rows then
		local n = eval_limit_value(self.limit_rows.n, params)
		offset = self.limit_rows.offset and eval_limit_value(self.limit_rows.offset, params) or 0
		cap = offset + (limit and math.min(n, limit) or n)
	end
	local outputs = self.select_outputs
	local rows = {} --{row...}
	with_exists_sources(self, run_filtered, self, params, function(row_ctx)
		local row = project_row(outputs, row_ctx)
		add(rows, row)
		if cap and #rows >= cap then return true end
	end, seed_row_ctx)
	if offset > 0 then
		local trimmed = {} --{row...}
		for i = offset + 1, #rows do add(trimmed, rows[i]) end
		rows = trimmed
	end
	return rows
end

--every terminal binds params after compiling. a name collected by
--add_param() during compile but absent here is a missing param, not a
--null one (null is the explicit `null` sentinel, never plain Lua nil).
local function bind_params(rel, params)
	params = params or empty
	for _, name in ipairs(rel.params) do
		assertf(params[name] ~= nil, 'missing param: %s', name)
	end
	return params
end

local function parse_row_args(shape, params) --shape [, params]
	if type(shape) == 'table' then
		--a table first argument is params, so shape and params cannot both be tables.
		assert(params == nil, 'row shape must be the first argument')
		return nil, shape
	end
	--only these two explicit shapes select a row representation; omitted means unpacked.
	assert(shape == nil or shape == '[]' or shape == '{}',
		"row shape must be '[]' or '{}'")
	return shape, params
end

local function named_row(fields, row)
	local named = {} --{name->value}
	for i, name in ipairs(fields) do named[name] = row[i] end
	return named
end

local function shape_row(fields, row, shape)
	if shape == '[]' then return row end
	if shape == '{}' then return named_row(fields, row) end
	return unpack(row, 1, #fields)
end

function Rel:rows(shape, params)
	shape, params = parse_row_args(shape, params)
	compile(self, 'rows', nil, true)
	local rows = rows_array(self, bind_params(self, params), nil)
	local i = 0
	return function()
		i = i + 1
		local row = rows[i]
		if row then return shape_row(self.returned_fields, row, shape) end
	end
end

--[[
- first(), one(), and must_one() ask rows_array() for a small cap.
- first() needs one row.
- one() and must_one() need two rows to detect "more than one".
- rows_array() decides whether the cap can stop the raw scan.
]]

function Rel:first(shape, params)
	shape, params = parse_row_args(shape, params)
	compile(self, 'first', nil, true)
	local row = rows_array(self, bind_params(self, params), 1)[1]
	if row then return shape_row(self.returned_fields, row, shape) end
end

function Rel:one(shape, params)
	shape, params = parse_row_args(shape, params)
	compile(self, 'one', nil, true)
	local rows = rows_array(self, bind_params(self, params), 2)
	assert(#rows <= 1, 'one() matched more than one row')
	local row = rows[1]
	if row then return shape_row(self.returned_fields, row, shape) end
end

function Rel:must_one(shape, params)
	shape, params = parse_row_args(shape, params)
	compile(self, 'must_one', nil, true)
	local rows = rows_array(self, bind_params(self, params), 2)
	assert(#rows == 1, 'must_one() matched '..#rows..' rows, expected exactly one')
	return shape_row(self.returned_fields, rows[1], shape)
end

function Rel:rows_array(shape, params)
	shape, params = parse_row_args(shape, params)
	compile(self, 'rows', nil, true)
	local rows = rows_array(self, bind_params(self, params), nil)
	if shape ~= '{}' then return rows end
	local named = {} --{{name->value}...}
	for i, row in ipairs(rows) do named[i] = named_row(self.returned_fields, row) end
	return named
end

function Rel:count(params)
	compile(self, 'count', nil, true)
	params = bind_params(self, params)
	if self.union_inputs then
		local n = 0
		for _, input in ipairs(self.union_inputs) do
			n = n + input:count(params)
		end
		return n
	end
	if self.group_outputs then
		local rows = {} --{row...}
		with_exists_sources(self, run_grouped, self, params, rows)
		return #rows
	end
	if self.distinct_rows then
		return #build_rows(self, params)
	end
	--count() needs every row.
	--no early stop is possible.
	--the answer changes with each matching row.
	local n = 0
	with_exists_sources(self, run_filtered, self, params, function() n = n + 1 end)
	return n
end

function Rel:exists(params)
	compile(self, 'exists', nil, true)
	params = bind_params(self, params)
	if self.union_inputs then
		for _, input in ipairs(self.union_inputs) do
			if input:exists(params) then return true end
		end
		return false
	end
	if self.group_outputs then
		--a group exists only after it is finished.
		--having() can depend on fully accumulated aggregates.
		--grouped exists() needs the full group pass.
		local rows = {} --{row...}
		with_exists_sources(self, run_grouped, self, params, rows)
		return rows[1] ~= nil
	end
	local found = false
	with_exists_sources(self, run_filtered, self, params, function()
		found = true
		return true
	end)
	return found
end

--describe one access step for explain().
--normal steps report one member.
--nested left-join fragment groups report inner steps under .nested.
local function describe_step(step)
	if step.nested then
		local inner = {} --{step_desc...}
		for _, s in ipairs(step.nested) do add(inner, describe_step(s)) end
		return {join = 'left_join', nested = inner}
	end
	local plan = step.plan
	return {
		member = step.member.member,
		join = step.join and step.join.kind or false,
		scan = plan.schema and plan.schema.name or 'relation',
		kind = plan.kind,
		row_checks = #plan.residual,
	}
end

function Rel:explain()
	compile(self, 'explain', nil, true)
	local steps = {} --{step_desc...}
	for _, step in ipairs(self.access) do add(steps, describe_step(step)) end
	local sort = self.order_by_terms ~= nil
	local sort_pushed = sort and not sort_actually_needed(self)
	--limit()/offset() pushes into the scan under rows_array() conditions.
	--no group() or distinct() can require materialization.
	--no explicit sort can be needed.
	local limit = self.limit_rows ~= nil
	local limit_pushed = limit
		and not (self.group_outputs or self.distinct_rows or sort_actually_needed(self))
	return {
		steps = steps,
		group = self.group_outputs ~= nil,
		distinct = self.distinct_rows or false,
		sort = sort,
		sort_pushed = sort_pushed,
		limit = limit,
		limit_pushed = limit_pushed,
	}
end
