--[[

	mdbx_query: query builder over mdbx_schema.

	- builds up a query value in place;
	- each method mutates and returns the same relation;
	- nothing is run until a terminal method is called;
	- execution uses mdbx_schema metadata and MDBX cursors.

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
			:order_by{{c'p.score', 'desc'}, {c'p.id', 'asc'}}
			:limit(50)

	for row in posts:rows{STATUS = 'published', MIN_SCORE = 10} do
		print(row.id, row.title)
	end

CONCEPTS

	fixed query parts

		- method call order does not define when a part runs;
		- each method fills one fixed query part;
		- query parts run in SQL order when compiled.

	field use

		- a member is the base table or a source step's right side;
		- a member's name is its alias, or its table name when not aliased;
		- qualified fields are addressed with q.col('member.col');
		- unqualified fields are addressed with q.col('name');
		- each query part has its own allowed fields.

	field scopes

		- each relation has one source scope: base source plus source steps;
		- nested relation expressions add a child source scope;
		- q.col('member.col') finds member in the current source scope, then
		  parent source scopes;
		- q.col('name') is resolved by the query part:
			- source-field positions search source scopes;
			- output-field positions search group/select output fields.
		- q.outer('member.col') validates that q.col('member.col') resolves
		  outside the current source scope;
		- SQL frontends can lower identifiers to q.col(); no extra outer-field
		  syntax is needed.

	immediate sugar

		- shorthand that rewrites when called;
		- it needs no schema lookup and nothing from the rest of the query.

	relation lifecycle

		- a relation is single-use: once embedded as a source, or compiled,
		  it cannot be reused anywhere else;
		- compile augments a relation in place for one terminal kind;
		- compile is idempotent for that terminal kind; compiling the same
		  relation again for a different terminal kind raises.

	filter conditions

		- multiple where() calls, and a top-level q.and_() inside one call,
		  both flatten into one list of independent conditions;
		- a condition classifies as a searchable fact when its shape lets an
		  index prove it: equality, range, prefix, membership, existence, or
		  null check;
		- an unclassified condition, or one an index only partially proves,
		  runs as a row check.

MUST-HAVE

names

	- table aliases must be unique in one query;
	- all names use [_A-Za-z][_A-Za-z0-9]*;
	- output names from select() or group() must be unique;
	- duplicate names raise;
	- aliases are inline strings, never options:
		- TABLE [ALIAS] where a table is introduced;
		- COL [ALIAS] for selected columns;
	- no later rename step exists;
	- alias each table where it is introduced.

SQL order

	- methods may be called in any order; call order carries no meaning;
	- source steps are an unordered set;
	- source methods are join() and left_join(); sugar adds the rest;
	- join(right, on) equals adding right as a source plus where(on);
	- left_join() on_expr and nested relation refs may read other members'
	  fields through source scopes; these reads must be acyclic across
	  left_join() and lateral() steps; compile raises on a cycle;
	- the engine may run source steps in any order that returns the same
	  rows;
	- query parts run in this order:
		- base table and source steps;
		- where();
		- group();
		- having();
		- select();
		- distinct();
		- order_by();
		- limit().
	- multiple where() calls are combined with q.and_();
	- multiple having() calls are combined with q.and_();
	- multiple use_index() and no_index() calls accumulate;
	- select(), group(), distinct(), order_by(), and limit() may be set once;
	- setting one of them twice raises.

validation

	- relation methods store query parts without checking names or fields;
	- compile checks table aliases, output name collisions, field references,
	  and hint conflicts;
	- terminals compile lazily.

compile state

	- compile augments the relation in place for one terminal kind;
	- compile is idempotent for the same terminal kind;
	- compile raises if the same relation is compiled for another terminal
	  kind;
	- params never affect compile;
	- rel:prepare([terminal_kind]) -> rel compiles now (default 'rows') and
	  returns the same relation; use it to raise compile errors at load
	  time.

field use

	- join() and left_join() on_expr may read any member's fields;
	- where() may read table fields from the base table and source steps;
	- group() key expressions may read table fields from the base table and all
	  source steps;
	- having() requires group() and may read group output fields;
	- select() reads table fields when there is no group();
	- select() reads group output fields when there is a group();
	- distinct() uses fields returned by select() or group();
	- order_by() may read returned fields;
	- order_by() may read table fields when there is no group() and no
	  distinct();
	- table fields used only by order_by() are not returned;
	- with group() or distinct(), order_by() may only read returned fields.

compile choices

	- compiled code may use local rewrites that keep the same result;
	- allowed rewrites:
		- use where() conditions to choose an index;
		- use join on_expr conditions to choose an index;
		- split q.and_() conditions by table alias;
		- use starts(), exists(), not_exists(), in_(), and not_in() for indexed
		  lookups;
		- skip sort or push limit only when the cursor already returns rows in
		  the requested order;
	- if an index choice does not fully prove a condition, keep that condition
	  as a row check;
	- compiled code decodes only the fields the query reads and returns;
	- ai_ci index caveats:
		- an ai_ci index seek returns fold-equal candidates, a superset of
		  the exact matches; the condition is always kept as a row check;
		- ai_ci indexes never satisfy order_by();
		- starts() facts do not use ai_ci indexes: a prefix of a value does
		  not always fold to a prefix of the folded value;
	- use_index() and no_index() affect only cursor choice;
	- use_index() and no_index() must not change returned rows.

core relation API

	db:from(source [, alias]) -> rel
		- source is a table spec string or a relation;
		- table spec string is 'TABLE [ALIAS]';
		- table fields are addressed under the member name;
		- relation source requires alias;
		- relation source must return fields with select() or group();
		- relation source fields are its returned fields under alias;
		- relation source internals do not leak out;
		- relation source is how to keep querying after select(), group(),
		  distinct(), or limit().

	rel:where(expr) -> rel
		- keeps rows where expr passes;
		- false, nil, and null reject the row; any other value passes;
		- multiple where() calls are combined with q.and_().

	rel:select(outputs) -> rel
		- defines returned fields;
		- outputs is an ordered list of:
			- 'member.col [name]';
			- {expr, name};
		- output names are unqualified row fields;
		- without group(), expressions may read table fields;
		- with group(), expressions may read group output fields.

	rel:distinct() -> rel
		- removes duplicate returned rows;
		- to remove duplicates by fewer fields, select those fields first.

	rel:join(right [, alias], on_expr) -> rel
		- inner join;
		- right is a table spec string or relation;
		- alias argument applies only when right is a relation;
		- on_expr decides whether one left row and one right row match;
		- on_expr may read any member's fields;
		- table spec right fields are addressed under the member name;
		- a relation right with alias:
			- it runs as its own unit;
			- it must return fields with select() or group();
			- its returned fields are addressed under alias;
			- its internals do not leak out;
		- a relation right without alias and without select()/group():
			- it may contain only source steps and where();
			- this query can address its members by name;
			- its aliases must not collide with existing aliases;
			- its where() conditions are combined with on_expr;
			- other query parts raise at compile;
			- this is a fragment: a join-tree grouping, not a subquery;
			- with left_join(), a fragment attaches a multi-table cluster as
			  one atomic optional unit; separate joins would make each table
			  independently optional instead;
			- unlike an aliased sub-relation, a fragment needs no select()
			  and keeps every member's fields directly addressable.

	rel:left_join(right [, alias], on_expr) -> rel
		- left join;
		- on_expr decides whether one left row and one right row match;
		- keeps left rows with no right match;
		- missing right-side fields read as nil;
		- right follows the same rules as join().

	rel:group(outputs) -> rel
		- groups rows and computes aggregates;
		- outputs is an ordered list of:
			- {key_expr, name};
			- {aggregate_expr, name};
		- non-aggregate outputs are grouping keys;
		- all-aggregate outputs make one group of all rows: one output row;
		  with no input rows, count() is 0 and other aggregates are null;
		- group output names are unqualified;
		- if there is no select(), group outputs are returned;
		- if select() exists, select() reads group outputs.

	rel:having(expr) -> rel
		- requires group();
		- filters grouped rows;
		- expr uses group output fields.

	rel:order_by(spec) -> rel
		- sets row order;
		- spec is an ordered list of {expr [, dir]};
		- dir is 'asc' or 'desc';
		- expr must use fields allowed by field use rules.

	rel:limit(n [, offset]) -> rel
		- keeps at most n rows;
		- skips offset rows first;
		- n and offset are integers or params.

	rel:use_index(member, index_name) -> rel
		- physical hint;
		- forces one index for one table alias;
		- compile raises if one alias has two different forced indexes.

	rel:no_index(member [, index_name]) -> rel
		- physical hint;
		- forbids one index, or all indexes for one table alias;
		- compile raises if one index is both forced and forbidden;
		- compile raises if all indexes are forbidden for an alias that has a
		  forced index.

expression API

	q.col('name') -> expr
	q.col('member.col') -> expr
	q.param(name) -> expr
	q.outer('member.col') -> expr

	q.eq(a, b), q.ne(a, b)
	q.lt(a, b), q.le(a, b), q.gt(a, b), q.ge(a, b)

	q.and_(expr, ...)
	q.or_(expr, ...)

	q.is_null(expr)
	q.is_not_null(expr)
	q.starts(expr, prefix)

	q.exists(right [, alias], on_expr)
	q.not_exists(right [, alias], on_expr)
	q.in_(expr, values_or_relation)
	q.not_in(expr, values_or_relation)

aggregate expression API

	q.count([expr])
	q.min(expr)
	q.max(expr)
	q.sum(expr)
	q.avg(expr)

expression rules

	- plain Lua values used as expressions are literals;
	- all scalar positions accept:
		- literals;
		- q.param();
		- q.col();
		- scalar expressions;
	- scalar expressions are limited to equality, range, prefix, membership,
	  existence, and null tests;
	- no arithmetic, string, case, coalesce, or cast expressions exist in the
	  query API;
	- every data value position accepts a param; names, aliases, directions,
	  and opts never do (compile uses them);
	- the in_()/not_in() value list is the only position where a param
	  binds a list instead of a scalar;
	- filter positions (where(), having(), on_expr) accept any expression;
	  false, nil, and null fail, any other value passes;
	- select() and group() outputs are scalar positions;
	- a missing param raises; a param may be explicitly null;
	- extra params are ignored;
	- q.col() accepts 'name' or 'member.col';
	- qualified q.col() resolves a member in the nearest source scope;
	- unqualified q.col() resolves by query part and may bind to a source
	  field or an output field;
	- aggregates are legal only in group() outputs;
	- q.outer() is legal only inside a child source scope;
	- q.outer() validates that q.col() would resolve outside the current
	  source scope.

filter expressions

	q.starts(expr, prefix) -> expr
		- string prefix test;
		- compiled code may use it as an index prefix/range fact.

	q.exists(right [, alias], on_expr) -> expr
		- true when right has at least one matching row;
		- on_expr is optional; without it, the condition is true;
		- right follows the same rules as join() right;
		- alias argument applies only when right is a relation;
		- right may contain q.outer() only when used in where().

	q.not_exists(right [, alias], on_expr) -> expr
		- true when right has no matching row;
		- on_expr is optional; without it, the condition is true;
		- right follows the same rules as join() right;
		- alias argument applies only when right is a relation;
		- right may contain q.outer() only when used in where().

	q.in_(expr, values_or_relation) -> expr
		- value list entries are expressions;
		- values may also be one param bound to a Lua list of values at
		  execution;
		- null and nil candidates are removed;
		- empty remaining value list is false;
		- relation form requires exactly one returned field;
		- relation may contain q.outer() only when used in where().

	q.not_in(expr, values_or_relation) -> expr
		- value list entries are expressions;
		- values may also be one param bound to a Lua list of values at
		  execution;
		- null and nil candidates are removed;
		- relation form requires exactly one returned field;
		- relation may contain q.outer() only when used in where().

	filter expression rules

		- exists(), not_exists(), in_(), and not_in() may be used in where()
		  and having();
		- exists()/not_exists() on_expr may read the right relation's fields
		  and the fields readable at the call site;
		- they may appear inside q.and_() and q.or_();
		- in having(), inner relations may not use q.outer();
		- inside q.or_(), they may run as row checks;
		- inner relation lookups may still use indexes;
		- outer index choice is not promised for every q.or_() arm.

IMMEDIATE SUGAR

	- rewrites when called;
	- needs no schema lookup and nothing from the rest of the query;
	- compile sees only the rewritten form.

	rel:cross_join(right) -> rel
		- rewrites to rel:join(right, true).

	rel:semijoin(right, on_expr) -> rel
		- rewrites to rel:where(q.exists(right, on_expr)).

	rel:antijoin(right, on_expr) -> rel
		- rewrites to rel:where(q.not_exists(right, on_expr)).

	q.between(expr, lo, hi) -> expr
		- rewrites to q.and_(q.ge(expr, lo), q.le(expr, hi)).

schema-based relation methods

	rel:fk_join(table_spec_or_rel) -> rel
		- inner join using the FK equality condition from mdbx_schema;
		- compile raises unless exactly one FK path exists;
		- if ambiguous, use join(right, on_expr).

	rel:fk_left_join(table_spec_or_rel) -> rel
		- left join using the FK equality condition from mdbx_schema;
		- compile raises unless exactly one FK path exists;
		- if ambiguous, use left_join(right, on_expr).

	rel:where_has(table_spec_or_rel [, filter]) -> rel
		- rewrites to where(q.exists(right, on)) where on is the FK equality
		  condition from mdbx_schema;
		- filter is an extra condition over both sides, combined with on;
		- compile raises unless exactly one FK path exists;
		- if ambiguous, use semijoin(right, on_expr).

	rel:where_hasnt(table_spec_or_rel [, filter]) -> rel
		- rewrites to where(q.not_exists(right, on)) where on is the FK
		  equality condition from mdbx_schema;
		- filter is an extra condition over both sides, combined with on;
		- compile raises unless exactly one FK path exists;
		- if ambiguous, use antijoin(right, on_expr).

	table_spec_or_rel

		- string form uses TABLE [ALIAS];
		- relation form follows join(rel, on): only source steps and where().

types

	- comparisons and order_by() follow each column type's key-encoding
	  order: numbers numeric, utf8 byte order, bool false < true, arrays
	  element by element;
	- order_by() sorts null first on 'asc'; 'desc' is the exact reverse,
	  null last;
	- comparisons need both sides of the same kind (number, utf8, bool);
	  mixed kinds raise at compile;
	- param values are checked against the compared column type at
	  execution;
	- count() counts rows;
	- count(expr) counts non-null values;
	- min(), max(), sum(), and avg() ignore null values and are null when
	  no values remain;
	- avg() is a float.

duplicates

	- queries are bags by default;
	- distinct() removes duplicate rows using all returned fields;
	- distinct(), group() keys, and set operations pair rows by equal field
	  values; null equals null for them, unlike in comparisons;
	- filters never multiply rows, so semijoin() and antijoin() keep each
	  left-row occurrence at most once.

nulls

	- database null is the json null sentinel;
	- returned row fields are nil for null values; the null sentinel never
	  appears in returned rows;
	- a null comparison operand matches no rows: an index seek must not use
	  it as a seek key (that would find rows where the column is null);
	- outer joins expose missing right-side fields as nil;
	- null and nil are treated as not-a-value during expression evaluation;
	- comparisons involving null or nil are false;
	- is_null(expr) is true for null or nil;
	- is_not_null(expr) is true for any other value;
	- there is no SQL UNKNOWN state;
	- q.in_(x, values_or_relation) is true only when x has a value and equals
	  at least one candidate value;
	- q.not_in(x, values_or_relation) is true only when x has a value and
	  equals no candidate value;
	- null and nil candidates on the right side of in_()/not_in() are ignored;
	- equality filters on right-side fields after a left join reject unmatched
	  left rows unless the filter passes for nil (e.g. is_null()).

terminals

	rel:rows([params]) -> iterator -> row
	rel:first([params]) -> row | nil
	rel:one([params]) -> row | nil
	rel:must_one([params]) -> row
	rel:count([params]) -> n
	rel:exists([params]) -> true | false
	rel:explain() -> table

	- terminals compile lazily;
	- rows(), first(), one(), and must_one() require select() or group();
	- count() and exists() do not require select();
	- one() returns nil for no row;
	- one() raises if more than one row matches;
	- must_one() raises unless exactly one row matches;
	- explain() names each member's scan (pk or index, seek facts), row
	  checks, the group, distinct, sort, and limit steps, and whether sort
	  or limit was pushed to a cursor.

OPTIONAL

	rel:lateral(right [, alias] [, opts]) -> rel
		- dependent join;
		- right is a relation that reads outer fields through source scopes;
		- q.outer() only validates that a ref resolved outside right;
		- right runs once per left row with fields resolved in parent scopes
		  bound to that row's values;
		- right follows the same rules as join() right;
		- multiplies each left row by right's rows;
		- opts.left keeps left rows with no right rows; missing right fields
		  read as nil;
		- preserves left duplicates.

	rel:union(right [, opts]) -> rel
		- set union;
		- opts.all=true gives bag union.

	rel:intersect(right) -> rel
		- set intersection over equal returned fields.

	rel:except(right) -> rel
		- set difference over equal returned fields.

	optional duplicate rules

		- union() removes duplicates unless opts.all=true;
		- intersect() and except() match whole rows by equal field values;
		- both sides must return the same field names; fields match by name.

DEFERRED DML

	rel:update(assignments [, opts]) -> dml
		- update the target table rows selected by rel;
		- assignments is a map of target table column name -> expr;
		- assignment expressions may read target fields, params, and literals
		  only;
		- opts.member chooses the target member; the default target is the
		  base table;
		- each target primary key is updated at most once.

	rel:delete([opts]) -> dml
		- delete the target table rows selected by rel;
		- opts.member chooses the target member; the default target is the
		  base table;
		- each target primary key is deleted at most once.

	dml:returning(outputs) -> dml
		- output rows for changed target rows;
		- outputs has the same shape as select() outputs;
		- update returning sees values as stored (after computed columns and
		  triggers);
		- delete returning sees target values before deletion.

	dml:run([params]) -> n
		- execute the mutation;
		- return affected row count.

	dml:rows([params]) -> iterator -> row
		- execute the mutation;
		- yield returning rows;
		- requires returning().

	DML rules

		- update() and delete() may use base table, source steps, where(),
		  use_index(), and no_index();
		- source steps choose target rows only;
		- assignments may not set primary key columns; compile raises
		  (primary keys are immutable);
		- update() and delete() run through mdbx_schema row ops: triggers
		  fire, fks are enforced (cascades included), computed columns
		  recompute, indexes are updated;
		- update() and delete() do not allow group(), having(), select(),
		  distinct(), order_by(), limit(), lateral(), or set operations;
		- every selected row must contain a target row; a left join must not
		  leave the target side missing.

IMPLEMENTATION PLAN

	stage 1: relation and expression values

		- implement mutable relation values;
		- relation methods store query parts without checking fields;
		- implement set-once storage for select(), group(), distinct(),
		  order_by(), and limit();
		- implement accumulating storage for where(), having(), use_index(),
		  and no_index();
		- implement source step storage for join() and left_join();
		- implement expression constructors:
			- q.col();
			- q.param();
			- q.outer();
			- comparisons;
			- q.and_();
			- q.or_();
			- null checks;
			- q.starts();
			- q.exists();
			- q.not_exists();
			- q.in_();
			- q.not_in();
			- aggregate markers.

	stage 2: immediate sugar and string parsing

		- implement cross_join() as join(right, true);
		- implement semijoin() as where(q.exists(right, on_expr));
		- implement antijoin() as where(q.not_exists(right, on_expr));
		- implement q.between() as q.and_(q.ge(expr, lo), q.le(expr, hi));
		- parse TABLE [ALIAS];
		- parse COL [ALIAS];
		- keep parsing separate from schema lookup.

	stage 3: compile entry

		- terminal methods call compile lazily;
		- compile receives relation plus terminal kind;
		- terminal kind decides required output:
			- rows(), first(), one(), must_one() need returned rows;
			- count() and exists() do not require select() or group();
			- DML needs target rows and optional returning rows;
		- augment the relation with checked compile state, not an executor
		  yet.

	stage 4: nested relation sources

		- compile base and aliased join-right relation sources recursively;
		- require select() or group() on base relation sources;
		- expose only returned fields under the outer alias;
		- hide relation source internals;
		- reject missing relation source alias;
		- exists()/in_() inner relations are not base sources: in_() needs
		  exactly one returned field, exists() needs none.

	stage 5: source resolution

		- resolve base table and source steps;
		- load table metadata from mdbx_schema;
		- assign table aliases;
		- check alias collisions;
		- attach fields to each source member.

	stage 6: validation and field binding

		- check output name collisions;
		- bind q.col() to source fields or returned fields by query part;
		- check having() requires group();
		- check grouped select() reads only group outputs;
		- check grouped or distinct order_by() reads only returned fields;
		- check ungrouped non-distinct order_by() may read table fields that
		  are not returned;
		- check use_index() and no_index() conflicts;
		- collect params used by expressions.

	stage 7: filter preparation

		- combine where() expressions with q.and_();
		- combine having() expressions with q.and_();
		- split top-level q.and_() into separate conditions;
		- keep q.or_() conditions whole unless a safe local rewrite exists;
		- classify searchable facts:
			- equality;
			- range;
			- prefix;
			- membership;
			- existence;
			- null check;
		- keep every unproven condition as a row check.

	stage 8: cursor choice and executor shape

		- choose one scan method per table source, deciding and building it
		  together, not as a separate planning pass;
		- obey use_index() and no_index();
		- prefer indexes that satisfy equality, range, prefix, order, or join
		  lookup needs;
		- if an index proves only part of a condition, keep the rest as a row
		  check;
		- record whether cursor order satisfies order_by(), and whether sort
		  and limit can be avoided or pushed down;
		- build source iteration in chosen order;
		- run joins and left joins;
		- run row checks;
		- build groups when group() exists;
		- run having() checks;
		- compute returned fields;
		- apply distinct();
		- sort when cursor order is not enough;
		- apply limit() and offset.

	stage 9: terminal executors

		- rows() returns an iterator;
		- first() stops after one row;
		- one() checks for a second row;
		- must_one() requires exactly one row;
		- count() builds returned rows only when distinct() needs them;
		- exists() stops after the first matching row;
		- update() and delete() change each target primary key at most once;
		- returning rows are produced only when returning() exists.

OUT-OF-SCOPE

	- relation upsert;
	- use db:upsert() from mdbx_schema for row-oriented upsert;
	- insert-from-query; use db:insert() or db:put_records() from
	  mdbx_schema;
	- keyset pagination;
	- relationship path sugar;
	- right/full outer joins;
	- window functions;
	- recursive queries;
	- SQL three-valued logic.

]]

require'mdbx_schema'

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
local function parse_select_outputs(outputs) --{'MEMBER.COL [ALIAS]'|{expr, name}, ...}
	return parse_outputs(outputs, parse_col_spec)
end
local function parse_group_outputs(outputs) --{{expr, name}, ...}
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

--relation values are mutable: every Rel method appends to self in place.
local Rel = {}

local function is_relation(v)
	return inherits(v, Rel)
end

--relations are single-use: compile() binds field refs in place on a
--relation's own expr trees, so reusing one anywhere would rebind them
--to whichever query compiles last.
local function mark_used(rel)
	assert(not rel.used, 'relation already used')
	rel.used = true
end

local function parse_source(source, alias) --'TABLE [ALIAS]' | rel
	if isstr(source) then
		--table aliases are written in TABLE [ALIAS]; alias args are for relations.
		assert(not alias, 'table alias must be inline')
		return parse_table_spec(source)
	else
		alias = alias and parse_name(alias) or nil
		mark_used(source)
		return source, alias
	end
end

local function list_part(PART, make)
	Rel[PART] = empty --class default; instance list created on first append.
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
Rel.order_by = once_part('order_by_terms', 'order_by')
Rel.distinct = once_part('distinct_rows', 'distinct', function() return true end)
Rel.use_index = list_part('use_indexes', function(member, index_name)
	return {member = parse_name(member), index_name = parse_name(index_name)}
end)
Rel.no_index = list_part('no_indexes', function(member, index_name)
	return {member = parse_name(member),
		index_name = index_name and parse_name(index_name) or nil}
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

--source is a table spec string or a relation; alias only applies when
--source is a relation.
function Db:from(source, alias)
	source, alias = parse_source(source, alias)
	local rel = {db = self, source = source, alias = alias}
	return object(Rel, rel)
end

--EXPRESSION VALUES ----------------------------------------------------------

--expression values are plain arrays tagged by a kind string in slot 1:
--{kind, ...operands}; plain Lua values passed as expressions stay
--unwrapped (they are literals).
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
function q.count (expr) return {'count', expr} end
function q.min   (expr) return {'min'  , expr} end
function q.max   (expr) return {'max'  , expr} end
function q.sum   (expr) return {'sum'  , expr} end
function q.avg   (expr) return {'avg'  , expr} end

function q.starts(expr, prefix)
	return {'starts', expr, prefix}
end

--alias is a named field because `on` can be nil.
--{'exists', right, on} or, with alias, {'exists', right, on, alias = a}
function q.exists(right, a2, a3)
	local alias, on = alias_on(a2, a3)
	local source
	source, alias = parse_source(right, alias)
	return {'exists', source, on, alias = alias}
end

function q.not_exists(right, a2, a3)
	local alias, on = alias_on(a2, a3)
	local source
	source, alias = parse_source(right, alias)
	return {'not_exists', source, on, alias = alias}
end

function q.in_(expr, values)
	if is_relation(values) then mark_used(values) end
	return {'in', expr, values}
end
function q.not_in(expr, values)
	if is_relation(values) then mark_used(values) end
	return {'not_in', expr, values}
end

function Rel:semijoin(right, on_expr)
	return self:where(q.exists(right, on_expr))
end

function Rel:antijoin(right, on_expr)
	return self:where(q.not_exists(right, on_expr))
end

--COMPILE ENTRY --------------------------------------------------------------

local compile --fw. decl.
local compile_scan --fw. decl.

--table fields come from mdbx_schema; relation fields are its own returned_fields.
local function resolve_source(source, db)
	if source.kind == 'table' then
		source.member = source.alias or source.table
		source.schema = assertf(db:table_schema(source.table),
			'table has no schema: %s', source.table)
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

--a fragment never gets its own scope: its members and where() exprs merge
--straight into whichever relation joined it in.
local function resolve_sources(rel)

	--prepare relation values passed where a table can appear:
	--Db:from(rel, alias): rel must return rows; this query reads alias.field;
	--join(rel, alias, on): same, using the join alias;
	--join(rel, on): rel's tables and where() clauses are used in this query.
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
	--build the member lookup used by q.col('member.col'):
	--table: member = alias or table name, fields come from mdbx_schema;
	--Db:from(rel, alias) and join(rel, alias, on): member = alias;
	--join(rel, on): add rel's members and add rel:where() exprs to join.on.
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
			--join(rel, on) can only add rel's members and rel:where() expressions.
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

--[[local]] function compile(rel, terminal_kind, parent_scope, top_level)

	if rel.compiled then
		--compiled relations are already mutated for one terminal shape.
		assertf(rel.terminal_kind == terminal_kind,
			'query already compiled for %s()', rel.terminal_kind)
		return rel
	end
	--embedded sources already did this at construction; catches a relation
	--directly compiled after already being used elsewhere.
	if top_level then mark_used(rel) end
	local members = resolve_sources(rel)

	--compute output-name maps before binding expressions:
	--group_fields/select_fields reject duplicate output names;
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

	--build the source scope that child relations search after their own scope.
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
	--bind each expression in place:
	--source positions bind q.col() to table/relation fields;
	--output positions bind q.col() to group/select outputs;
	--inner relations compile with this relation's scope as their parent.
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
			--outer() validates normal scoped lookup; later stages see q.col().
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
				--right is a bare table spec, not a relation: no compile needed,
				--just one extra member for on_expr to resolve against.
				resolve_source(right, rel.db)
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
	--a fragment never gets its own compile() call (its members share this
	--relation's flat scope), so its own internal joins' on_expr has to be
	--bound here too, recursively, in case a fragment contains another one.
	local function bind_joins(joins)
		for _, join in ipairs(joins) do
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

	local fact_kind = { --{op->fact kind}
		eq = 'equality',
		lt = 'range', le = 'range', gt = 'range', ge = 'range',
		starts = 'prefix',
		['in'] = 'membership', not_in = 'membership',
		exists = 'existence', not_exists = 'existence',
		is_null = 'null', is_not_null = 'null',
	}
	--multiple where()/having() calls are an implicit q.and_(); a top-level
	--q.and_() inside one call means the same thing, so both flatten into one
	--list of independent conditions. classify each condition by its own
	--operator into a searchable fact (only these shapes can drive an index
	--seek); anything else stays unclassified and always runs as a row check.
	local function split_conditions(exprs, classify)
		local conditions = {} --{condition...; condition={kind=nil|fact, expr=expr}}
		local function add_condition(expr)
			if type(expr) == 'table' and expr[1] == 'and' then
				for i = 2, #expr do
					add_condition(expr[i])
				end
			else
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
	rel.where_conditions = split_conditions(rel.wheres, true)
	rel.having_conditions = split_conditions(rel.havings, false)
	--a fragment's own internal joins need on_conditions too, recursively,
	--since a fragment can contain another fragment.
	local function split_join_conditions(joins)
		for _, join in ipairs(joins) do
			--an unconditional join has nothing to split; avoid a stray
			--always-true residual entry.
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

	--record index hints by member and reject contradictory hints.
	local use_index_by_member = {} --{member->index_name}
	local no_index_by_member = {} --{member->true|{index_name->true}}
	rel.use_index_by_member = use_index_by_member
	rel.no_index_by_member = no_index_by_member
	for _, hint in ipairs(rel.use_indexes) do
		local member, index_name = hint.member, hint.index_name
		assertf(members[member], 'unknown source member: %s', member)
		local forced = use_index_by_member[member]
		assertf(not forced or forced == index_name,
			'conflicting use_index() for source member: %s', member)
		use_index_by_member[member] = index_name
	end
	for _, hint in ipairs(rel.no_indexes) do
		local member, index_name = hint.member, hint.index_name
		assertf(members[member], 'unknown source member: %s', member)
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

	--collect which of this relation's own members a bound expr's q.col()
	--nodes touch, including through exists()/in_() correlation (via on_expr
	--or the inner relation's own where()); used to attribute a where()
	--condition to the one member it can narrow, or mark it cross-member.
	local function referenced_members(expr, found) --found: {member->true}
		if type(expr) ~= 'table' then return end
		local op = expr[1]
		if op == 'col' then
			if expr.source and members[expr.source.member] == expr.source then
				found[expr.source.member] = true
			end
		elseif op == 'exists' or op == 'not_exists' then
			local source, on = expr[2], expr[3]
			if on then referenced_members(on, found) end
			if is_relation(source) then
				for _, cond in ipairs(source.where_conditions) do
					referenced_members(cond.expr, found)
				end
			end
		elseif op == 'in' or op == 'not_in' then
			referenced_members(expr[2], found)
			local values_or_rel = expr[3]
			if is_relation(values_or_rel) then
				for _, cond in ipairs(values_or_rel.where_conditions) do
					referenced_members(cond.expr, found)
				end
			else
				for _, item in ipairs(values_or_rel) do
					referenced_members(item, found)
				end
			end
		else
			for i = 2, #expr do
				referenced_members(expr[i], found)
			end
		end
	end
	local function attribute_conditions(conditions)
		for _, cond in ipairs(conditions) do
			local found = {} --{member->true}
			referenced_members(cond.expr, found)
			local n, only = 0, nil
			for member in pairs(found) do
				n = n + 1
				only = member
			end
			cond.member = n == 1 and only or false
		end
	end
	attribute_conditions(rel.where_conditions)

	--pull a member's column out of a comparison's two operands, whichever
	--side is a q.col() bound to that member; flipped=true means the column
	--was on the right, so a range op's direction must be read in reverse.
	local function member_operand(member, left, right)
		local l_col = type(left) == 'table' and left[1] == 'col' and left.source == member
		local r_col = type(right) == 'table' and right[1] == 'col' and right.source == member
		if l_col and not r_col then return left[3], right, false end
		if r_col and not l_col then return right[3], left, true end
		return nil
	end
	local flip_range_op = {lt = 'gt', le = 'ge', gt = 'lt', ge = 'le'} --{op->flipped op}

	--pull equality/range/prefix facts local to `member` out of `conditions`
	--(already known to be relevant to this member -- see access_conditions),
	--bucketed by column; one fact per (column, kind), first-wins if
	--duplicated (an extra fact on an already-bucketed column just stays a
	--residual check, correctness is unaffected either way).
	local function bucket_facts(member, conditions)
		local eq, lo, hi, prefix = {}, {}, {}, {} --{col->{cond=,expr=[,op=]}}
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
				end
			end
		end
		return eq, lo, hi, prefix
	end

	--walk one candidate key's columns against this member's fact buckets:
	--count leading equality-matched columns (depth), then check whether the
	--next column has a range/prefix fact. classifies the match's strength;
	--the caller scores candidates by this classification, not by row counts
	--or index size, so the plan never depends on what's in the tables.
	local function try_key(pk, eq, lo, hi, prefix)
		local depth = 0
		for i, col in ipairs(pk) do
			if eq[col] then depth = i else break end
		end
		if depth == #pk then
			return {kind = 'exact', depth = depth}
		end
		local nc = pk[depth + 1]
		if nc and prefix[nc] then
			return {kind = 'prefix', depth = depth, bound_col = nc}
		end
		if nc and (lo[nc] or hi[nc]) then
			return {kind = 'range', depth = depth, bound_col = nc}
		end
		if depth > 0 then
			return {kind = 'eq_prefix', depth = depth}
		end
		return nil
	end

	--rank by how many columns actually narrow the scan (a range/prefix bound
	--counts its bound column too, since it's checked straight from the key
	--bytes -- no base-table read needed for rows it rejects, unlike a
	--residual check on a narrower index that doesn't carry that column);
	--kind only breaks ties at equal coverage. never ranked by row counts or
	--index size, so the plan never depends on what's in the tables.
	local kind_rank = {exact = 2, range = 1, prefix = 1, eq_prefix = 0} --{kind->tie-break rank}
	local function plan_coverage(plan)
		if plan.kind == 'range' or plan.kind == 'prefix' then
			return plan.depth + 1
		end
		return plan.depth
	end

	--choose which key (the member's own pk, or one of its indexes) drives
	--this member's scan, honoring use_index()/no_index(), and mark which
	--where() conditions it consumes; anything left is this member's residual.
	local function choose_access(member, conditions)
		--a relation-kind member (nested/aliased sub-query) has no physical
		--pk or indexes to seek on -- it's always a full scan over whatever
		--rows the already-compiled inner relation produces.
		if member.kind ~= 'table' then
			return {kind = 'full', depth = 0, dir = 'asc', is_pk = false,
				schema = false, seek = empty, residual = conditions}
		end
		local eq, lo, hi, prefix = bucket_facts(member, conditions)
		local forced = use_index_by_member[member.member]
		local forbidden = no_index_by_member[member.member]
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
		for _, cand in ipairs(candidates) do
			local plan = try_key(cand.schema.pk, eq, lo, hi, prefix)
			if plan then
				local cov = plan_coverage(plan)
				if not best_plan or cov > best_cov
					or (cov == best_cov and kind_rank[plan.kind] > kind_rank[best_plan.kind]) then
					best_cand, best_plan, best_cov = cand, plan, cov
				end
			end
		end
		--TODO: when no fact-based plan beats a full scan, prefer a key whose
		--order already satisfies order_by()/group() (still 'full' kind, but
		--scanned via that key instead of the member's bare pk); needs the
		--order-tracking done for the order_by stage first.
		if not best_plan then
			best_cand, best_plan = {schema = member.schema, is_pk = true}, {kind = 'full', depth = 0}
		end
		best_plan.schema = best_cand.schema
		best_plan.is_pk = best_cand.is_pk
		best_plan.dir = 'asc'
		local seek = {} --{expr...}: one value-operand expr per matched leading column
		for i = 1, best_plan.depth do
			local fact = eq[best_cand.schema.pk[i]]
			seek[i] = fact.expr
			fact.cond.consumed = true
		end
		best_plan.seek = seek
		if best_plan.kind == 'range' then
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

	--this member's on_expr conditions (if it's a join) plus its own local
	--where() conditions -- an on_expr condition is always safe to use as a
	--seek fact, since the dependency order below guarantees anything it
	--reads besides this member is already scheduled.
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

	--join J can only run once every member its on_expr reads (besides its
	--own) has already been scheduled; a fragment's on_expr may read any of
	--its own (recursively flattened) members too -- none of those count as
	--an external dependency, only members outside the fragment do.
	local function join_deps(join)
		local found = {} --{member->true}
		referenced_members(join.on, found)
		if is_relation(join.right) then
			for _, member in ipairs(join.right.members) do
				found[member.member] = nil
			end
		else
			found[join.right.member] = nil
		end
		return found
	end

	--dependency-order one level of joins (the relation's own, or a
	--fragment's own internal joins) and choose access for each; ties (no
	--dependency relationship either way) keep declaration order. purely
	--structural -- decided by which columns each on_expr reads, never by
	--anything data-dependent.
	--
	--a fragment reached here is either flattened or nested, matching SQL's
	--own join-tree parenthesization: inner-join composition doesn't care
	--about grouping, so an inner-joined fragment's own members and joins
	--become more steps in this same flat sequence. a left-joined fragment's
	--whole cluster must match, or the outer row null-extends, together as
	--one unit -- so its own joins build a separate, nested sequence instead,
	--run as a single atomic step here.
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
						access_conditions(fragment.source, picked))}
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
					plan = choose_access(picked.right, access_conditions(picked.right, picked))})
				scheduled[picked.right.member] = true
			end
		end
	end

	--the column order the driving member's own access plan guarantees, if
	--any: the depth leading (equality-pinned) columns are fixed -- constant
	--across the whole scan, so they trivially satisfy any requested order
	--on them -- followed by the remaining key columns in the direction the
	--cursor actually walks (always ascending for now; no backward scans
	--yet). a joined member's columns never contribute here: for a to-many
	--join, each driver row's matches come out consecutively while the
	--driver's own scan order is preserved across driver rows, so only the
	--driving member's order can ever be relied on without an explicit sort
	--or hash -- group()/distinct()/order_by() below all check against this
	--one fact instead of each re-deriving it.
	local function natural_order(step)
		local plan = step.plan
		if not plan.schema then return empty end --relation-kind member: no guarantee
		local order = {} --{{member=,col=,fixed=true|dir=}...}
		local pk = plan.schema.pk
		for i = 1, plan.depth do
			add(order, {member = step.member.member, col = pk[i], fixed = true})
		end
		for i = plan.depth + 1, #pk do
			add(order, {member = step.member.member, col = pk[i], dir = 'asc'})
		end
		return order
	end

	local access = {} --{{member=,join=|false,plan=|nested=}...}
	rel.access = access
	add(access, {member = rel.source, join = false,
		plan = choose_access(rel.source, access_conditions(rel.source, false))})
	build_access(rel.joins, {[rel.source.member] = true}, access)
	rel.natural_order = natural_order(access[1])

	--builds each step's opener once, at compile time; recurses into a
	--left-join fragment's own nested steps too. a relation-kind member's
	--plan has no schema (it's not a physical cursor scan) and has no
	--executor of any kind yet.
	local function prepare_scans(access_list)
		for _, step in ipairs(access_list) do
			if step.nested then
				prepare_scans(step.nested)
			elseif step.plan.schema then
				step.open = compile_scan(rel.db, step.plan)
			end
		end
	end
	prepare_scans(access)

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

--STAGE 9: executor -----------------------------------------------------

--row_ctx: {member_name -> decode_col fn} for every step already scanned,
--in the order the recursive step-runner below reaches them; a step's
--seek/bound/residual exprs may read an earlier member's current value
--through it (that's how a join condition supplies its seek value).

--evaluate a bound seek/bound value-expr at scan time: a literal, a
--q.param(), or a q.col() reading an earlier member's current row.
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

--compare two same-kind values the way key order does (see the file's own
--"types" doc: numbers numeric, utf8 byte order, bool false<true).
local function key_cmp(a, b)
	if a == b then return 0 end
	return a < b and -1 or 1
end

--raw composite-key comparison: memcmp over the shared length, then break
--ties on length (a strict byte-prefix of the other key sorts first) --
--matches how the key encoding orders variable-length columns.
local function raw_key_cmp(k1, n1, k2, n2)
	local c = memcmp(k1, k2, min(n1, n2))
	if c ~= 0 then return c end
	if n1 < n2 then return -1 end
	if n1 > n2 then return 1 end
	return 0
end

--the smallest encoded byte string that's strictly greater than every
--string starting with buf[0..sz): increment the last byte that isn't
--already 0xff, drop everything after it (the dropped 0xff's already
--make it the largest possible continuation, so bumping the byte before
--them is enough). returns the new length, or nil if every byte is 0xff
--(no finite upper bound exists at this length). same trick already used
--for a starts() prefix's own upper bound.
local function increment_prefix(buf, sz)
	local i = sz - 1
	while i >= 0 and buf[i] == 255 do
		i = i - 1
	end
	if i < 0 then return nil end
	buf[i] = buf[i] + 1
	return i + 1
end

--compiles one access-plan step's scan; called once per step, at compile
--time. returns an opener: calling it opens the step's cursor(s) and
--scratch buffers for one query execution and returns (run, close), where
--run(params, row_ctx, row_fn) walks the cursor for one seek, calling
--row_fn(decode_col) per matching row, and close() releases the
--cursor(s). run and close reuse the same cursor/buffers/records across
--every call to run within one execution.
--
--the depth-match/hi/lo/prefix stop checks compare raw encoded bytes
--instead of decoding: the key encoding is designed so byte order matches
--value order (mdbx_schema.c's own encoding comments rely on this too),
--so these boundary checks only need relative order against an already-
--(or freshly-) encoded bound, never an actual decoded value.
--
--the hi check compares the row's key against a fixed strict upper
--bound: for a strict ('<') hi, the bound is the bare encode(depth cols,
--hi) -- any row sharing that prefix is longer, hence compares greater,
--and gets excluded regardless of what trails it. for an inclusive
--('<=') hi, the bound is that same prefix bumped up by one
--(increment_prefix): the smallest key strictly greater than any row
--starting with encode(depth cols, hi), which a row's own trailing
--columns can never reach past.
--[[local]] function compile_scan(db, plan)
	local schema = plan.schema
	local seek_fns = {} --{fn...}
	for i, expr in ipairs(plan.seek) do seek_fns[i] = compile_value(expr) end
	local lo_fn = plan.lo and compile_value(plan.lo.expr)
	local hi_fn = plan.hi and compile_value(plan.hi.expr)
	local prefix_fn = plan.prefix and compile_value(plan.prefix)
	local depth = plan.depth
	return function()
		local cur = db:cursor(schema.name)
		local base_cur --lazily opened only if a non-key column is read
		local buf = u8a(MDBX_MAX_KEY_SIZE)
		local depth_buf = depth > 0 and u8a(MDBX_MAX_KEY_SIZE) or nil
		--hi has no seek-side buffer to reuse (only lo/prefix position the
		--cursor).
		local hi_buf = hi_fn and u8a(MDBX_MAX_KEY_SIZE)
		local ix_rec, pk_rec = MDBX_val(), MDBX_val()
		local cur_v_data, cur_v_sz --current row's base-table value bytes
		local function get_base_val()
			if schema.is_index then
				if not base_cur then base_cur = db:cursor(schema.val_table) end
				local found, bv_data, bv_sz = base_cur:find_raw(pk_rec.data, pk_rec.size)
				assert(found, 'base row missing for an existing key')
				return bv_data, bv_sz
			end
			return cur_v_data, cur_v_sz
		end
		local decoders = {} --{col->fn}: compiled once per column, reused
			--for the rest of this execution -- decode_col is scoped to this
			--one step's schema, so col alone is a unique key (no member
			--dimension needed: which step's decode_col you're holding
			--already picks the member).
		local function decode_col(col)
			local f = decoders[col]
			if not f then
				f = db:compile_col(schema, col, schema.is_index and ix_rec or nil,
					pk_rec, get_base_val)
				decoders[col] = f
			end
			return f()
		end
		--the depth leading equality values, reused for every seek this
		--execution does; slot depth+1 is a transient extra, overwritten
		--with whichever single bound value (the seek's own lo/prefix, or
		--a row's hi check) needs encoding at that moment -- every read of
		--vals elsewhere is bounded to 1..depth, so it never sees slot
		--depth+1's leftover value.
		local vals = {}
		local function run(params, row_ctx, row_fn)
			--a null comparison operand matches no rows (see the file's own
			--"nulls" doc): an equality fact whose value evaluated to null
			--can't be satisfied by any row, so the whole seek is skipped
			--rather than run with a null seek key.
			local null_seek = false
			for i, fn in ipairs(seek_fns) do
				local v = fn(params, row_ctx)
				if v == nil then null_seek = true end
				vals[i] = v
			end
			if null_seek then return end
			local ok, k_data, k_sz, v_data, v_sz
			local seek_sz --buf's length; when it covers depth+1 columns
				--(range w/ lo, or prefix), it doubles as the lo/prefix stop
				--bound below, since it's the exact same encoding.
			if plan.kind == 'full' then
				ok, k_data, k_sz, v_data, v_sz = cur:first_raw()
			elseif plan.kind == 'exact' then
				seek_sz = mdbx_encode_key_prefix(db, schema, 'get', buf,
					MDBX_MAX_KEY_SIZE, depth, false, unpack(vals, 1, depth))
				ok, k_data, k_sz, v_data, v_sz = cur:find_ge_raw(buf, seek_sz)
			else --range, prefix, eq_prefix
				local bound_val = lo_fn and lo_fn(params, row_ctx)
					or (prefix_fn and prefix_fn(params, row_ctx))
				--same null rule as above: a lo/prefix fact with a null
				--value matches no rows -- unlike a genuinely absent bound
				--(neither lo_fn nor prefix_fn set, an eq_prefix plan),
				--which scans everything under the depth-column prefix.
				if (lo_fn or prefix_fn) and bound_val == nil then return end
				local n = depth
				if bound_val ~= nil then
					vals[depth + 1] = bound_val
					n = depth + 1
				end
				seek_sz = mdbx_encode_key_prefix(db, schema, 'c_seek', buf,
					MDBX_MAX_KEY_SIZE, n, plan.kind == 'prefix', unpack(vals, 1, n))
				ok, k_data, k_sz, v_data, v_sz = cur:find_ge_raw(buf, seek_sz)
			end
			--depth-only prefix, used below to detect leaving the current
			--dup-key group; a plain encode(depth cols) always yields the
			--same bytes as the leading depth_sz bytes of any longer buffer
			--built from the same vals (later columns can't change earlier
			--ones' encoding), so this is correct for every plan kind.
			local depth_sz
			if depth > 0 then
				depth_sz = mdbx_encode_key_prefix(db, schema, 'get', depth_buf,
					MDBX_MAX_KEY_SIZE, depth, false, unpack(vals, 1, depth))
			end
			--hi's value, when it comes from a q.col(), always reads an
			--earlier (already-scheduled) member -- try_key/member_operand
			--never let it read this step's own member -- so it's fixed
			--for this whole invocation, not per row: evaluated, null-
			--checked, and encoded once here instead of inside the row loop
			--below. for an inclusive ('<=') hi, the encoded bound is bumped
			--up to a strict upper bound (see increment_prefix); on overflow
			--(every byte already 0xff) there's no finite bound, so the hi
			--check below never fires for this invocation -- correct, since
			--that means no real value could exceed it either.
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
				ix_rec.data, ix_rec.size = k_data, k_sz
				if schema.is_index then
					pk_rec.data, pk_rec.size = v_data, v_sz --non-unique index: value = pk bytes
				else
					pk_rec.data, pk_rec.size = k_data, k_sz --base table: key = pk bytes
					cur_v_data, cur_v_sz = v_data, v_sz
				end
				--stop once the leading equality columns no longer match.
				--bounded to exactly depth_sz bytes, so any bytes the row's
				--key has beyond that never affect the outcome.
				if depth_sz and (k_sz < depth_sz or memcmp(k_data, depth_buf, depth_sz) ~= 0) then
					break
				end
				--sorted order: once a hi bound is exceeded, we're done. hi_sz
				--already encodes the right strict boundary for either op
				--(see above), so reaching or passing it always means stop.
				if hi_sz and raw_key_cmp(k_data, k_sz, hi_buf, hi_sz) >= 0 then
					break
				end
				--prefix reuses the seek buffer: same encoding, and (like the
				--depth check) a pure "still starts with" test needs no
				--length tie-break.
				if plan.kind == 'prefix' then
					if k_sz < seek_sz or memcmp(k_data, buf, seek_sz) ~= 0 then break end
				end
				--a lo bound only rejects rows right at the boundary: the
				--seek already guarantees every returned row is >= lo (in
				--full composite-key order), so the only remaining
				--possibility besides "greater" is exact equality -- which
				--is exactly what this bounded-length comparison checks,
				--again reusing the seek buffer (same depth+lo encoding).
				local passes_lo = true
				if plan.kind == 'range' and lo_fn then
					passes_lo = not (k_sz >= seek_sz and memcmp(k_data, buf, seek_sz) == 0
						and plan.lo.op == 'gt')
				end
				if passes_lo then
					row_fn(decode_col)
				end
				ok, k_data, k_sz, v_data, v_sz = cur:next_raw()
			end
		end
		local function close()
			if base_cur then base_cur:close() end
			cur:close()
		end
		return run, close
	end
end

--read a value operand for a residual check: a literal, a q.param(), or a
--q.col() reading any already-scanned member's current row through row_ctx
--(the member doesn't have to be the step this residual is attached to --
--e.g. a fragment's own where() referencing the outer driving member).
local function eval_value(x, params, row_ctx)
	if type(x) ~= 'table' then return x end
	if x[1] == 'param' then return params[x[2]] end
	if x[1] == 'col' then return row_ctx[x.source.member](x[3]) end
	error('unsupported residual operand: '..tostring(x[1]))
end
--shared comparison dispatch for residual and having() checks; val(x)
--resolves one operand to a value -- the two checks differ only in how
--they do that (row_ctx for residuals, a computed group row for having()).
local function eval_condition(expr, val)
	local op, a, b = unpack(expr, 1, 3)
	if op == 'is_null' then return val(a) == nil end
	if op == 'is_not_null' then return val(a) ~= nil end
	--comparisons involving null are false (see the file's own "nulls" doc).
	local va, vb = val(a), val(b)
	if va == nil or vb == nil then return false end
	if op == 'eq' then return va == vb
	elseif op == 'ne' then return va ~= vb
	elseif op == 'lt' then return key_cmp(va, vb) < 0
	elseif op == 'le' then return key_cmp(va, vb) <= 0
	elseif op == 'gt' then return key_cmp(va, vb) > 0
	elseif op == 'ge' then return key_cmp(va, vb) >= 0
	else error('unsupported condition op: '..tostring(op)) end
end
local function eval_residual(expr, params, row_ctx)
	return eval_condition(expr, function(x) return eval_value(x, params, row_ctx) end)
end
local function eval_having(expr, group_row)
	return eval_condition(expr, function(x)
		if type(x) ~= 'table' then return x end
		assertf(x[1] == 'col', 'unsupported having operand: %s', x[1])
		return group_row[x.field.name]
	end)
end

--a decoder for a left-joined (or empty nested group) member with no
--matching row: every column reads as nil, per "missing right-side fields
--read as nil".
local function nil_decode() return nil end

--true if `terms` ({member=,col=[,dir=]}, in priority order) is satisfied
--by `natural` (rel.natural_order): sequence matters here, since order_by()
--priority does -- a fixed natural column is skipped wherever it appears
--(it never varies, so it can't disrupt anything), but a varying column
--must match the next unconsumed natural column exactly, in order.
local function order_satisfied(terms, natural)
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

--true if `terms` (a SET of {member=,col=}, declared order doesn't matter)
--is satisfied by `natural`: group()/distinct() only need matching rows
--brought together, not sorted by priority, so unlike order_satisfied()
--above, the terms may cover the same natural prefix in any order among
--themselves -- but it must be that exact prefix (as a set), since skipping
--one natural column in the middle would scatter matching rows apart
--instead of keeping them adjacent.
local function order_satisfied_set(terms, natural)
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
	return true
end

--the {member=,col=} a returned output name resolves to, when its own
--expr is a plain source-bound q.col() -- used to check whether
--distinct()/order_by() can piggyback on the driving member's natural scan
--order instead of hashing/sorting. nil if the output isn't a simple
--passthrough (an aggregate, or any other computed expr).
local function output_source_col(self, name)
	local outputs = self.select_outputs or self.group_outputs
	for _, output in ipairs(outputs) do
		if output[2] == name then
			local expr = output[1]
			if type(expr) == 'table' and expr[1] == 'col' and expr.source then
				return {member = expr.source.member, col = expr[3]}
			end
			return nil
		end
	end
end

--every member name one access step covers, recursing into nested groups;
--used to null-extend a whole left-joined fragment group at once when it
--produces no combination at all.
local function step_members(step, list)
	list = list or {} --{member_name...}
	if step.nested then
		for _, s in ipairs(step.nested) do step_members(s, list) end
	else
		add(list, step.member.member)
	end
	return list
end

--builds one processor per access step, closed over the shared params/
--row_ctx for one execution; calling the returned function walks the
--whole sequence, calling next_step() once per complete combination. a
--normal join step calls next_step() once per matching row, or once with
--a nil-extended member if it's a left_join with no matches. a nested
--group step calls next_step() once per complete inner combination, or
--once with every inner member nil-extended if the whole group produced
--nothing -- the atomicity a left-joined fragment exists for.
--
--built once per execution (see run_query), not once per driver row: the
--found/row-match closures below close over stable upvalues (row_ctx is
--mutated in place, never replaced, for the whole execution; found is
--reset by plain assignment before each call, not by rebuilding the
--closure), so one set of closures serves every row the sequence visits.
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
				this_rest()
			end)
			rest = function()
				found = false
				nested_start()
				if not found then
					for _, member in ipairs(members) do
						row_ctx[member] = nil_decode
					end
					this_rest()
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
				this_rest()
			end
			local is_left = step.join and step.join.kind == 'left_join'
			rest = function()
				found = false
				step.run(params, row_ctx, on_match)
				if not found and is_left then
					row_ctx[member] = nil_decode
					this_rest()
				end
			end
		end
	end
	return rest
end

--unique sentinel thrown to unwind the step chain early once
--collect_rows/exists() have seen enough; run_query treats it as a
--normal exit.
local stop_scan = {}

--opens every step's cursor and scratch buffers for one query execution,
--eagerly, before any row is scanned; recurses into a left-join
--fragment's own nested steps. returns the opened steps, for close_access
--to release. a relation-kind member has no opener (see prepare_scans).
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

--runs one query execution: opens every step once, builds the step chain
--once, walks it reusing those same cursors/buffers for every row, closes
--everything afterward regardless of outcome.
local function run_query(access, params, emit)
	local opened = open_access(access)
	local row_ctx = {}
	local process = build_processors(access, params, row_ctx, function() emit(row_ctx) end)
	local ok, err = pcall(process)
	close_access(opened)
	if not ok and err ~= stop_scan then error(err, 0) end
end

function Rel:prepare(terminal_kind)
	compile(self, terminal_kind or 'rows', nil, true)
	return self
end

local aggregate_ops = {count = true, min = true, max = true, sum = true, avg = true} --{op->true}

--fold one row into aggregate accumulator a: {n=count, v=running value}.
--min/max/sum keep a running v; avg keeps both (sum in v, count in n);
--count(expr) only advances n for non-null values, count() for every row.
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

--hash-based group()+having(): materializes one row per distinct group key
--(string-encoded tuple of the non-aggregate group_outputs), accumulating
--aggregates as input rows arrive; groups are finished and having()-checked
--only once the whole input is drained -- correct regardless of input
--order. an order-matching streaming alternative (collapse consecutive
--same-key rows without a hash) is a follow-up, not implemented here.
--finish one group's aggregate outputs, apply having(), and emit its
--output row (through select() if present) -- shared by the hash and
--streaming group implementations below, which only differ in how they
--find/bucket groups, not in how a finished group becomes an output row.
local function finish_group_row(self, group_outputs, agg_ids, g, rows)
	for _, i in ipairs(agg_ids) do
		g.row[group_outputs[i][2]] = finish_aggregate(g.acc[i], group_outputs[i][1][1])
	end
	local passes = true
	for _, cond in ipairs(self.having_conditions) do
		if not eval_having(cond.expr, g.row) then passes = false; break end
	end
	if passes then
		if self.select_outputs then
			local row = {} --{name->value}
			for _, output in ipairs(self.select_outputs) do
				local expr, name = unpack(output, 1, 2)
				assert(expr[1] == 'col', 'only plain column select() outputs are implemented so far')
				row[name] = g.row[expr.field.name]
			end
			add(rows, row)
		else
			add(rows, g.row)
		end
	end
end

local function new_group(group_outputs, agg_ids)
	local acc = {} --{output_index->{n=0,v=nil}}
	for _, i in ipairs(agg_ids) do acc[i] = {n = 0, v = nil} end
	return {row = {}, acc = acc} --row: {name->value}, filled in once finished
end

--hash-based group()+having(): materializes one row per distinct group key
--(string-encoded tuple of the non-aggregate group_outputs), accumulating
--aggregates as input rows arrive; groups are finished and having()-checked
--only once the whole input is drained -- correct regardless of input
--order.
local function run_grouped_hash(self, params, rows, group_outputs, key_ids, agg_ids)
	local groups = {} --{key_str->{row=,acc={i->{n=,v=}}}}
	local group_keys = {} --{key_str...}: first-seen order
	local saw_input = false
	run_query(self.access, params, function(row_ctx)
		saw_input = true
		local key_parts = {} --{string...}
		for _, i in ipairs(key_ids) do
			key_parts[#key_parts + 1] = tostring(eval_value(group_outputs[i][1], params, row_ctx))
		end
		local key = concat(key_parts, '\1')
		local g = groups[key]
		if not g then
			g = new_group(group_outputs, agg_ids)
			for _, i in ipairs(key_ids) do
				g.row[group_outputs[i][2]] = eval_value(group_outputs[i][1], params, row_ctx)
			end
			groups[key] = g
			add(group_keys, key)
		end
		for _, i in ipairs(agg_ids) do
			accumulate(g.acc[i], group_outputs[i][1], params, row_ctx)
		end
	end)
	--all-aggregate outputs (no key columns) always make one group, even
	--with no input rows: count() is 0, other aggregates are null.
	if not saw_input and #key_ids == 0 then
		groups[''] = new_group(group_outputs, agg_ids)
		add(group_keys, '')
	end
	for _, key in ipairs(group_keys) do
		finish_group_row(self, group_outputs, agg_ids, groups[key], rows)
	end
end

--streaming group()+having(): the driving member's own scan order already
--brings every row of a group together (checked by the caller), so groups
--collapse from consecutive rows directly -- no hash, no string keys, and
--a group finishes (and gets having()-checked) as soon as its key changes,
--rather than only once the whole input is drained.
local function run_grouped_streaming(self, params, rows, group_outputs, key_ids, agg_ids)
	local cur_key, cur_g
	local function keys_equal(a, b)
		for i = 1, #a do
			if a[i] ~= b[i] then return false end
		end
		return true
	end
	run_query(self.access, params, function(row_ctx)
		local key = {} --{val...}
		for i, id in ipairs(key_ids) do
			key[i] = eval_value(group_outputs[id][1], params, row_ctx)
		end
		if not cur_g or not keys_equal(key, cur_key) then
			if cur_g then finish_group_row(self, group_outputs, agg_ids, cur_g, rows) end
			cur_key, cur_g = key, new_group(group_outputs, agg_ids)
			for _, i in ipairs(key_ids) do
				cur_g.row[group_outputs[i][2]] = eval_value(group_outputs[i][1], params, row_ctx)
			end
		end
		for _, i in ipairs(agg_ids) do
			accumulate(cur_g.acc[i], group_outputs[i][1], params, row_ctx)
		end
	end)
	if cur_g then
		finish_group_row(self, group_outputs, agg_ids, cur_g, rows)
	elseif #key_ids == 0 then
		--all-aggregate outputs (no key columns) always make one group,
		--even with no input rows: count() is 0, other aggregates are null.
		finish_group_row(self, group_outputs, agg_ids, new_group(group_outputs, agg_ids), rows)
	end
end

local function run_grouped(self, params, rows)
	local group_outputs = self.group_outputs
	local key_ids, agg_ids = {}, {} --{output_index...}
	for i, output in ipairs(group_outputs) do
		local expr = output[1]
		add(type(expr) == 'table' and aggregate_ops[expr[1]] and agg_ids or key_ids, i)
	end
	--streaming is safe only when every key column is a plain source-bound
	--q.col() (not a computed expr) and the set of them is an exact prefix
	--of the driving member's own natural scan order (joins don't disturb
	--this: a to-many join's fan-out stays nested within its own driver row
	--either way, see natural_order's own comment).
	local key_terms, streaming = {}, true --{{member=,col=}...}
	for _, i in ipairs(key_ids) do
		local expr = group_outputs[i][1]
		if type(expr) == 'table' and expr[1] == 'col' and expr.source then
			add(key_terms, {member = expr.source.member, col = expr[3]})
		else
			streaming = false
			break
		end
	end
	streaming = streaming and order_satisfied_set(key_terms, self.natural_order)
	if streaming then
		run_grouped_streaming(self, params, rows, group_outputs, key_ids, agg_ids)
	else
		run_grouped_hash(self, params, rows, group_outputs, key_ids, agg_ids)
	end
end

--an order_by() term reads either a returned output (by name, from the
--already-built row) or, when ungrouped and non-distinct, a table field
--that may not be part of the output at all -- captured from row_ctx while
--it's still live, since the row itself won't have it.
local function order_key(term, row, row_ctx)
	local expr = term[1]
	if expr.source then return row_ctx[expr.source.member](expr[3]) end
	return row[expr.field.name]
end

--null-aware compare matching "order_by() sorts null first on 'asc'; 'desc'
--is the exact reverse, null last".
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

--build the final row list for a compiled relation (select()/group()
--outputs, distinct(), order_by(), limit() all applied); shared by
--rows()/first()/one()/must_one(), which only differ in how many of the
--result they need and what they do with it. count()/exists() don't call
--this -- they don't require select()/group() at all, so they run their
--own leaner path below.
--resolve one order_by() term down to the {member=,col=,dir=} its value
--actually comes from -- either source-bound directly, or output-bound
--(reads a select() output by name), in which case it's only checkable
--against natural order if that output is itself a plain passthrough.
--nil if it isn't (an aggregate or any other computed expr).
local function order_term(self, term)
	local expr, dir = term[1], term[2]
	if expr.source then
		return {member = expr.source.member, col = expr[3], dir = dir}
	end
	local src = output_source_col(self, expr.field.name)
	return src and {member = src.member, col = src.col, dir = dir}
end

--order_by()'s scan-order shortcut only applies to the simplest case
--(no group(), no distinct() -- matches the driving member's order
--surviving unchanged, see natural_order's own comment); group()/
--distinct() always sort explicitly for now. shared by build_rows (to
--skip the sort pass) and collect_rows (to know whether limit()/offset()
--can be pushed into the scan instead of materializing every row).
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

local function build_rows(self, params)
	for _, cond in ipairs(self.where_conditions) do
		assert(cond.member ~= false, 'cross-member filters are not implemented yet')
	end
	local rows = {} --{row...}
	local sort_keys = {} --{row->{val...}}: only filled when a real sort is needed
	local sort_needed = sort_actually_needed(self)

	if self.group_outputs then
		run_grouped(self, params, rows)
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
		run_query(self.access, params, function(row_ctx)
			local row = {} --{name->value}
			for _, output in ipairs(outputs) do
				local expr, name = unpack(output, 1, 2)
				assert(expr[1] == 'col', 'only plain column outputs are implemented so far')
				row[name] = row_ctx[expr.source.member](expr[3])
			end
			if sort_needed then
				local key = {} --{val...}
				for i, term in ipairs(self.order_by_terms) do
					key[i] = order_key(term, row, row_ctx)
				end
				sort_keys[row] = key
			end
			add(rows, row)
		end)
	end

	if self.distinct_rows then
		--streaming (adjacent dedup) is safe only for the plain, ungrouped
		--case, when every returned field is a plain passthrough of a
		--source column and that set is an exact prefix of the driving
		--member's natural order (see order_satisfied_set's own comment).
		local streaming = not self.group_outputs
		local terms = {} --{{member=,col=}...}
		if streaming then
			for _, name in ipairs(self.returned_fields) do
				local src = output_source_col(self, name)
				if not src then streaming = false; break end
				add(terms, src)
			end
			streaming = streaming and order_satisfied_set(terms, self.natural_order)
		end
		local deduped = {} --{row...}
		if streaming then
			local prev
			for _, row in ipairs(rows) do
				local dup = prev ~= nil
				if dup then
					for _, name in ipairs(self.returned_fields) do
						if row[name] ~= prev[name] then dup = false; break end
					end
				end
				if not dup then add(deduped, row) end
				prev = row
			end
		else
			local seen = {} --{key_str->true}
			for _, row in ipairs(rows) do
				local parts = {} --{string...}
				for _, name in ipairs(self.returned_fields) do
					parts[#parts + 1] = tostring(row[name])
				end
				local key = concat(parts, '\1')
				if not seen[key] then
					seen[key] = true
					add(deduped, row)
				end
			end
		end
		rows = deduped
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

--collect result rows, stopping the scan itself once enough rows have
--been produced -- but only when nothing downstream needs the full result
--first: group()/distinct()/a real sort all require seeing every row
--(groups aren't final till input is drained, dedup/sort need every row
--up front), so those fall back to the full build_rows() pass. `limit` is
--the caller's own early-stop need (1 for first(), 2 for one()/
--must_one(), nil for rows()); self.limit_rows (n, offset), when present
--and pushable, composes with it into one raw-scan cap: rows are only
--wanted from the offset+1..offset+n window, and only the first `limit`
--of those, so the scan can stop after offset + min(n, limit) rows and
--the leading `offset` of those get trimmed off before returning.
local function collect_rows(self, params, limit)
	if self.group_outputs or self.distinct_rows or sort_actually_needed(self) then
		return build_rows(self, params)
	end
	for _, cond in ipairs(self.where_conditions) do
		assert(cond.member ~= false, 'cross-member filters are not implemented yet')
	end
	local offset, cap = 0, limit
	if self.limit_rows then
		local n = eval_limit_value(self.limit_rows.n, params)
		offset = self.limit_rows.offset and eval_limit_value(self.limit_rows.offset, params) or 0
		cap = offset + (limit and math.min(n, limit) or n)
	end
	local outputs = self.select_outputs
	local rows = {} --{row...}
	run_query(self.access, params, function(row_ctx)
		local row = {} --{name->value}
		for _, output in ipairs(outputs) do
			local expr, name = unpack(output, 1, 2)
			assert(expr[1] == 'col', 'only plain column outputs are implemented so far')
			row[name] = row_ctx[expr.source.member](expr[3])
		end
		add(rows, row)
		if cap and #rows >= cap then error(stop_scan) end
	end)
	if offset > 0 then
		local trimmed = {} --{row...}
		for i = offset + 1, #rows do add(trimmed, rows[i]) end
		rows = trimmed
	end
	return rows
end

function Rel:rows(params)
	compile(self, 'rows', nil, true)
	local rows = collect_rows(self, params or empty, nil)
	local i = 0
	return function()
		i = i + 1
		return rows[i]
	end
end

--first()/one()/must_one() stop the scan as soon as they've seen enough
--(1 row, or 2 -- enough to prove "more than one") whenever collect_rows
--can do so safely; see its own comment for when it can't.

function Rel:first(params)
	compile(self, 'first', nil, true)
	return collect_rows(self, params or empty, 1)[1]
end

function Rel:one(params)
	compile(self, 'one', nil, true)
	local rows = collect_rows(self, params or empty, 2)
	assert(#rows <= 1, 'one() matched more than one row')
	return rows[1]
end

function Rel:must_one(params)
	compile(self, 'must_one', nil, true)
	local rows = collect_rows(self, params or empty, 2)
	assert(#rows == 1, 'must_one() matched '..#rows..' rows, expected exactly one')
	return rows[1]
end

function Rel:count(params)
	compile(self, 'count', nil, true)
	params = params or empty
	for _, cond in ipairs(self.where_conditions) do
		assert(cond.member ~= false, 'cross-member filters are not implemented yet')
	end
	if self.group_outputs then
		local rows = {} --{row...}
		run_grouped(self, params, rows)
		return #rows
	end
	if self.distinct_rows then
		return #build_rows(self, params)
	end
	--count() always needs every row -- no early stop is possible, the
	--answer changes with each one.
	local n = 0
	run_query(self.access, params, function() n = n + 1 end)
	return n
end

function Rel:exists(params)
	compile(self, 'exists', nil, true)
	params = params or empty
	if self.group_outputs then
		--a group can't be checked for existence until it's finished --
		--having() may depend on a fully accumulated aggregate -- so this
		--still needs the full hash pass; no early stop here.
		local rows = {} --{row...}
		run_grouped(self, params, rows)
		return rows[1] ~= nil
	end
	for _, cond in ipairs(self.where_conditions) do
		assert(cond.member ~= false, 'cross-member filters are not implemented yet')
	end
	local found = false
	run_query(self.access, params, function()
		found = true
		error(stop_scan)
	end)
	return found
end

--one descriptive record per access step; a nested (left-fragment) group
--reports its own inner steps under .nested instead of a single member.
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
	--limit()/offset() pushes into the scan under the same condition
	--collect_rows checks: no group()/distinct() to materialize for, and
	--no real sort needed.
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

--SELF-TEST ------------------------------------------------------------------

if not ... then
	require'pp'
	local c = q.col
	local p = q.param
	local schemas = {} --{table_name->schema}
	local table_fields = { --{table_name->{col...}}
		post = {'id', 'status', 'score', 'title', 'deleted_at'},
		comment = {'id', 'post_id'},
		tag = {'id', 'post_id'},
		ban = {'post_id'},
	}
	local table_pks = { --{table_name->{col...}}
		post = {'id'}, comment = {'id'}, tag = {'id'}, ban = {'post_id'},
	}
	for table_name, field_names in pairs(table_fields) do
		local fields = {} --{col->field}
		for _, name in ipairs(field_names) do
			fields[name] = {name = name}
		end
		schemas[table_name] = {fields = fields, pk = table_pks[table_name]}
	end
	function Db:table_schema(table_name)
		return schemas[table_name]
	end

	local r = Db:from('post p')
		:join('comment c', q.eq(c'c.post_id', c'p.id'))
		:left_join('tag pt', q.eq(c'pt.post_id', c'p.id'))
		:where(q.and_(
			q.eq(c'p.status', p'STATUS'),
			q.ne(c'p.status', 'banned'),
			q.lt(c'p.score', 1000),
			q.le(c'p.score', 999),
			q.gt(c'p.score', 0),
			q.ge(c'p.score', p'MIN_SCORE'),
			q.is_not_null(c'p.title'),
			q.starts(c'p.title', 'A'),
			q.in_(c'p.status', {'draft', 'live'}),
			q.not_in(c'p.status', {'deleted'}),
			q.or_(q.is_null(c'p.deleted_at'), q.eq(c'p.deleted_at', p'ASOF')),
			q.exists('comment c2', q.eq(c'c2.post_id', q.outer'p.id')),
			q.not_exists('tag t2b', q.eq(c't2b.post_id', c'p.id'))
		))
		:group{
			{c'p.status', 'status'},
			{q.count(), 'n'},
			{q.count(c'p.id'), 'n_ids'},
			{q.min(c'p.score'), 'min_score'},
			{q.max(c'p.score'), 'max_score'},
			{q.sum(c'p.score'), 'total_score'},
			{q.avg(c'p.score'), 'avg_score'},
		}
		:having(q.gt(c'n', 0))
		:select{
			{c'status', 'status'},
			{c'n', 'n'},
		}
		:distinct()
		:order_by{{c'n', 'desc'}}
		:limit(50, 10)
		:use_index('p', 'ix_status')
		:no_index('p', 'ix_old')

	assert(r.source.kind == 'table' and r.source.table == 'post' and r.source.alias == 'p',
		'table specs must parse on relation sources')
	local comment_join = r.joins[1]
	local tag_join = r.joins[2]
	assert(comment_join.right.kind == 'table' and comment_join.right.table == 'comment'
		and comment_join.right.alias == 'c', 'table specs must parse on joins')
	assert(tag_join.right.table == 'tag' and tag_join.right.alias == 'pt'
		and tag_join.alias == nil, 'table join aliases must be inline')

	local ok, err = pcall(function()
		Db:from('post p', 'p2')
	end)
	assert(not ok and err:find('table alias must be inline', 1, true),
		'base table source aliases must be inline')
	ok, err = pcall(function()
		Db:from('post p'):join('comment c', 'c2', true)
	end)
	assert(not ok and err:find('table alias must be inline', 1, true),
		'join table source aliases must be inline')
	ok, err = pcall(function()
		q.exists('comment c', 'c2', true)
	end)
	assert(not ok and err:find('table alias must be inline', 1, true),
		'exists() table source aliases must be inline')
	ok, err = pcall(function()
		q.not_exists('comment c', 'c2', true)
	end)
	assert(not ok and err:find('table alias must be inline', 1, true),
		'not_exists() table source aliases must be inline')

	local r3 = Db:from('post p')
		:select{'p.id id', 'p.title'}
	local select_outputs = r3.select_outputs
	local id_output = select_outputs[1]
	local title_output = select_outputs[2]
	local id_expr, id_name = unpack(id_output, 1, 2)
	local id_op, id_member, id_col = unpack(id_expr, 1, 3)
	local title_expr, title_name = unpack(title_output, 1, 2)
	local title_op, _, title_col = unpack(title_expr, 1, 3)
	assert(id_op == 'col' and id_member == 'p' and id_col == 'id' and id_name == 'id',
		'select strings must parse explicit aliases')
	assert(title_op == 'col' and title_col == 'title' and title_name == 'title',
		'select strings must default names to columns')

	local sugar = Db:from('post p')
		:cross_join('tag t')
		:semijoin('comment c', q.eq(c'c.post_id', c'p.id'))
		:antijoin('ban b', q.eq(c'b.post_id', c'p.id'))
		:where(q.between(c'p.score', 10, 20))
	local sugar_join = sugar.joins[1]
	local exists_where = sugar.wheres[1]
	local not_exists_where = sugar.wheres[2]
	local between_where = sugar.wheres[3]
	local exists_op, exists_right = unpack(exists_where, 1, 2)
	local not_exists_op, not_exists_right = unpack(not_exists_where, 1, 2)
	local between_op, ge_expr, le_expr = unpack(between_where, 1, 3)
	local ge_op = ge_expr[1]
	local le_op = le_expr[1]
	assert(sugar_join.kind == 'join' and sugar_join.on == true,
		'cross_join() must rewrite to join(right, true)')
	assert(exists_op == 'exists' and exists_right.table == 'comment',
		'semijoin() must rewrite to where(exists(...))')
	assert(not_exists_op == 'not_exists' and not_exists_right.table == 'ban',
		'antijoin() must rewrite to where(not_exists(...))')
	assert(between_op == 'and' and ge_op == 'ge' and le_op == 'le',
		'between() must rewrite to ge/le')

	local nested = Db:from('comment c')
		:select{'c.id id', 'c.post_id post_id'}
	local from_nested = Db:from(nested, 'comments')
		:select{'comments.id id'}
	from_nested:prepare()
	assert(from_nested.source.kind == 'relation' and from_nested.source.alias == 'comments'
		and from_nested.source.relation == nested, 'base relation sources must compile as nested sources')
	local nested_id_field = nested.returned_fields[1]
	local nested_post_id_field = nested.returned_fields[2]
	assert(nested.terminal_kind == 'rows' and nested_id_field == 'id'
		and nested_post_id_field == 'post_id', 'nested relation sources must expose returned fields')

	local nested_join = Db:from('tag t')
		:select{'t.id id'}
	local joined_nested = Db:from('post p')
		:join(nested_join, 'tags', true)
		:select{'p.id id'}
	joined_nested:prepare()
	local joined_nested_join = joined_nested.joins[1]
	local joined_nested_id_field = joined_nested_join.right.returned_fields[1]
	assert(joined_nested_join.right.kind == 'relation'
		and joined_nested_join.right.alias == 'tags'
		and joined_nested_id_field == 'id',
		'aliased join relation sources must compile as nested sources')

	local fragment = Db:from('comment c')
		:where(q.eq(c'c.post_id', c'p.id'))
	local joined_fragment = Db:from('post p')
		:join(fragment, true)
		:select{'p.id id'}
	joined_fragment:prepare()
	local joined_fragment_join = joined_fragment.joins[1]
	assert(joined_fragment_join.right == fragment,
		'unaliased join fragments must stay unwrapped')
	local joined_fragment_on = joined_fragment_join.on
	joined_fragment:prepare()
	assert(joined_fragment_join.on == joined_fragment_on,
		'prepare() must be idempotent')

	ok, err = pcall(function()
		Db:from(Db:from('post p'):select{'p.id id'}):prepare'count'
	end)
	assert(not ok and err:find('relation source requires alias', 1, true),
		'base relation sources must require aliases')

	ok, err = pcall(function()
		Db:from('post p')
			:join(Db:from('comment c'):select{'c.id id'}, true)
			:select{'p.id id'}
			:prepare()
	end)
	assert(not ok and err:find('relation source requires alias', 1, true),
		'selecting join relation sources must require aliases')

	ok, err = pcall(function()
		Db:from('post p')
			:join(Db:from('comment c'):order_by{{c'c.id', 'asc'}}, true)
			:select{'p.id id'}
			:prepare()
	end)
	assert(not ok and err:find('relation fragment may contain only source steps and where()', 1, true),
		'relation fragments must reject non-mergeable query parts')

	local exists_table = Db:from('post p')
		:where(q.exists('comment c2', q.eq(c'c2.post_id', c'p.id')))
		:select{'p.id id'}
	exists_table:prepare()
	local exists_expr = exists_table.wheres[1]
	local _, exists_right = unpack(exists_expr, 1, 2)
	assert(exists_right.member == 'c2' and exists_right.schema == schemas.comment
		and exists_right.fields == schemas.comment.fields,
		'exists() table sources must resolve source fields')

	local exists_inner = Db:from('comment c')
		:where(q.eq(c'c.post_id', q.outer'p.id'))
	Db:from('post p')
		:where(q.exists(exists_inner))
		:select{'p.id id'}
		:prepare()
	assert(exists_inner.terminal_kind == 'exists' and exists_inner.needs_output == false,
		'exists() relation subqueries must not require returned rows')
	local _, _, exists_outer = unpack(exists_inner.wheres[1], 1, 3)
	assert(exists_outer[1] == 'col' and exists_outer.source and exists_outer.field,
		'outer() must validate, then bind as a scoped col()')

	local in_inner = Db:from('comment c')
		:select{'c.post_id post_id'}
	Db:from('post p')
		:where(q.in_(c'p.id', in_inner))
		:select{'p.id id'}
		:prepare()
	local in_field = in_inner.returned_fields[1]
	assert(in_inner.terminal_kind == 'rows' and in_field == 'post_id',
		'in_() relation subqueries must expose one returned field')

	ok, err = pcall(function()
		Db:from('post p')
			:where(q.in_(c'p.id', Db:from('comment c'):select{'c.id id', 'c.post_id post_id'}))
			:select{'p.id id'}
			:prepare()
	end)
	assert(not ok and err:find('in_() relation requires one returned field', 1, true),
		'in_() relation subqueries must reject multiple returned fields')

	local bound = Db:from('post p')
		:where(q.eq(c'status', p'STATUS'))
		:select{'p.id id'}
		:order_by{{c'title', 'asc'}}
	bound:prepare()
	local _, bound_left = unpack(bound.wheres[1], 1, 2)
	local _, bound_member, bound_col = unpack(bound_left, 1, 3)
	assert(bound_member == false and bound_col == 'status'
		and bound_left.source and bound.params.STATUS,
		'unqualified source fields and params must bind')

	local grouped = Db:from('post p')
		:group{{c'p.status', 'status'}, {q.count(), 'n'}}
		:having(q.gt(c'n', 0))
		:select{{c'status', 'status'}, {c'n', 'n'}}
		:order_by{{c'n', 'desc'}}
	grouped:prepare()
	local _, having_col = unpack(grouped.havings[1], 1, 2)
	assert(not having_col.source, 'having() fields must bind to group outputs')

	local correlated = Db:from('comment c')
		:where(q.eq(c'c.post_id', c'p.id'))
	Db:from('post p')
		:where(q.exists(correlated))
		:select{'p.id id'}
		:prepare()
	local _, _, outer_col = unpack(correlated.wheres[1], 1, 3)
	assert(outer_col.source.member == 'p' and not correlated.members.p,
		'nested q.col() must bind through parent scopes')

	ok, err = pcall(function()
		Db:from('post p')
			:where(q.exists(
				Db:from('comment p')
					:where(q.eq(c'p.post_id', q.outer'p.id'))))
			:select{'p.id id'}
			:prepare()
	end)
	assert(not ok and err:find('outer field resolved in current scope', 1, true),
		'outer() must not bypass normal scope resolution')

	ok, err = pcall(function()
		Db:from('post p')
			:select{'p.id x', 'p.title x'}
			:prepare()
	end)
	assert(not ok and err:find('duplicate select() output field: x', 1, true),
		'select() output names must be unique')

	ok, err = pcall(function()
		Db:from('post p')
			:where(c'p.missing')
			:prepare'count'
	end)
	assert(not ok and err:find('unknown field: p.missing', 1, true),
		'source fields must exist')

	ok, err = pcall(function()
		Db:from('post p')
			:having(q.gt(c'n', 0))
			:prepare'count'
	end)
	assert(not ok and err:find('having() requires group()', 1, true),
		'having() must require group()')

	ok, err = pcall(function()
		Db:from('post p')
			:group{{c'p.status', 'status'}}
			:select{{c'p.id', 'id'}}
			:prepare()
	end)
	assert(not ok and err:find('output field must be unqualified', 1, true),
		'grouped select() must read group outputs')

	ok, err = pcall(function()
		Db:from('post p')
			:group{{c'p.status', 'status'}}
			:order_by{{c'p.id', 'asc'}}
			:prepare()
	end)
	assert(not ok and err:find('output field must be unqualified', 1, true),
		'grouped order_by() must read returned fields')

	ok, err = pcall(function()
		Db:from('post p')
			:use_index('p', 'ix_status')
			:no_index('p', 'ix_status')
			:prepare'count'
	end)
	assert(not ok and err:find('index is both forced and forbidden', 1, true),
		'use_index() and no_index() must not conflict')

	local dump = {} --{key->value}
	for k, v in pairs(r) do
		if k ~= '__index' and k ~= '__call' and k ~= 'db' then dump[k] = v end
	end
	print(pp(dump))
end
