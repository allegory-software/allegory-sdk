SEMANTICS
------------------------------------------------------------------------------


REL FACTS

	- builds up a query value in place;
	- each method mutates and returns the same relation;
	- nothing is run until a terminal method is called;
	- execution uses mdbx_schema metadata and MDBX cursors.

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
		- positions that read source fields search source scopes;
		- positions that read output fields search group/select output
			fields.
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
	- distinct() dedups by fields returned by select() or group(), or by
	  cols if given; cols must be a subset of the returned fields;
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


CORE API ---------------------------------------------------------------------

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
			- {col, name};
		- col is a q.col() expr;
		- output names are unqualified row fields;
		- without group(), col reads a table field;
		- with group(), col reads a group output field.

	rel:distinct([cols]) -> rel
		- removes duplicate returned rows;
		- cols: '[COL], ...' -- dedup by these returned fields instead of all
		  of them; still returns every returned field per row.

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
			- {col, name};
			- {agg_expr, name};
		- col is a q.col() expr; a literal or q.param() key would be the same
		  for every row, collapsing all rows into one group, so it is rejected;
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
		- spec is '[member.]col [desc], ...' or {{col1, dir1}, {col2, dir2}, ...};
		- dir defaults to 'asc' in the string form; the table form always
		  gives dir explicitly;
		- col is a plain field reference: a member.col string, or an already-
		  built q.col() expr;
		- col must use fields allowed by field use rules.

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

	q.count([val_expr])
	q.min(val_expr)
	q.max(val_expr)
	q.sum(val_expr)
	q.avg(val_expr)

	val_expr is a literal, q.param(), or q.col().

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
		- inner relation lookups may use indexes;
		- outer index choice is not promised for every q.or_() arm.

IMMEDIATE SUGAR

	- rewrites when called;
	- needs no schema lookup and nothing from the rest of the query;
	- compile sees only the rewritten form.

	rel:cross_join(right) -> rel
		- rewrites to rel:join(right, true).

	rel:semi_join('TABLE [ALIAS]', on_expr) -> rel
	rel:semi_join(rel, 'ALIAS', on_expr) -> rel
		- rewrites to rel:where(q.exists(...)).

	rel:anti_join('TABLE [ALIAS]', on_expr) -> rel
	rel:anti_join(rel, 'ALIAS', on_expr) -> rel
		- rewrites to rel:where(q.not_exists(...)).

	q.between(expr, lo, hi) -> expr
		- rewrites to q.and_(q.ge(expr, lo), q.le(expr, hi)).

schema-based relation methods

	rel:fk_join(table_spec) -> rel
		- inner join using the FK equality condition from mdbx_schema;
		- table_spec is a 'TABLE [ALIAS]' string;
		- compile raises unless exactly one FK path exists to some other
		  member of the relation;
		- if ambiguous, use join(right, on_expr).

	rel:fk_left_join(table_spec) -> rel
		- left join using the FK equality condition from mdbx_schema;
		- same rules as fk_join;
		- if ambiguous, use left_join(right, on_expr).

	rel:where_has(table_spec [, filter]) -> rel
		- rewrites to where(q.exists(table_spec, on)) where on is the FK
		  equality condition from mdbx_schema;
		- filter is an extra condition over both sides, combined with on;
		- same FK rules as fk_join;
		- if ambiguous, use semi_join(right, on_expr).

	rel:where_hasnt(table_spec [, filter]) -> rel
		- rewrites to where(q.not_exists(table_spec, on)) where on is the FK
		  equality condition from mdbx_schema;
		- filter is an extra condition over both sides, combined with on;
		- same FK rules as fk_join;
		- if ambiguous, use anti_join(right, on_expr).

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
	- filters never multiply rows, so semi_join() and anti_join() keep each
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

	rel:rows([shape, params]) -> iter() -> values...
	rel:first([shape, params]) -> values... | nil
	rel:one([shape, params]) -> values... | nil
	rel:must_one([shape, params]) -> values...
	rel:rows_array([shape, params]) -> {row1,...}
	rel:count([params]) -> n
	rel:exists([params]) -> true | false
	rel:explain() -> table

	- terminals compile lazily;
	- rows(), first(), one(), must_one(), and rows_array() require select() or group();
	- when shape is omitted, the first argument is params;
	- rows_array() and rows_array'[]' return the internal array rows;
	  rows_array'{}' returns name-keyed table rows;
	- count() and exists() do not require select();
	- one() returns nil for no row;
	- one() raises if more than one row matches;
	- must_one() raises unless exactly one row matches;
	- explain() names each member's scan (pk or index, seek facts), row
	  checks, the group, distinct, sort, and limit steps, and whether sort
	  or limit was pushed to a cursor.

set operations

	rel:union(right) -> rel
		- bag union of this relation and right; never dedups (chain
		  distinct() through a from(union, alias) wrapper for that);
		- chainable: a:union(b):union(c) is one n-ary union, not nested;
		- both sides must already have select() or group() set;
		- both sides must return the same fields in the same order;
		- supports only rows(), first(), one(), must_one(), rows_array(), count(), and
		  exists(); no further builder method may be called on the union
		  relation itself.

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

	rel:intersect(right) -> rel
		- set intersection over equal returned fields.

	rel:except(right) -> rel
		- set difference over equal returned fields.

	optional duplicate rules

		- intersect() and except() match whole rows by equal field values;
		- both sides must return the same field names; fields match by name.

DML

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
------------------------------------------------------------------------------

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
	- keep q.or_() conditions whole unless a local rewrite preserves the
		same row checks;
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
------------------------------------------------------------------------------
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


BENCHMARKS / WORTH IT & IMPLEMENTED
------------------------------------------------------------------------------
- 3x hash_aggregate over value_sort+pk_group for group_by with no natural order
- 16x in_union vs hash-set pk_filter past 5000 values -> capped at IN_UNION_MAX=16
- 86x prefer_order vs filter+sort+limit worst case
	-> exact match wins over order_want regardless of limit()
- 2.1x DUPFIXED bulk multi-get vs one-dup-at-a-time (count()/filtered; 1.4x if every row decodes)
- 2x-186x raw, ~180x-240x through :rows(): distinct() NEXT_NODUP group-skip vs decode-all
	-> must cover the whole remaining index key, no joins, no residual.
- TODO: 2-6 probes breakeven: correlated exists()/not_exists()
  hash-set-once vs rescan-per-probe fallback (no index on the correlation column)


BENCHMARKS / NOT WORTH IT & WON'T IMPLEMENT
------------------------------------------------------------------------------
- left_join merge_join over pk_join_seek
- n-ary merge_join over chained pk_join_seek
- pk-level union pushdown (2x)
- pk_and_probe over pk_filter
- use_counts tie-break, 50 vs 2,000,000-entry index
- pk_join_seek wide (pk_prefix range-scan) over narrow (MDBX_NEXT_DUP) fk path (1.3x)
- pk_parent_lookup over merge_join (child->parent, reversed roles) (1.7x-2.5x)
- where_has()/where_hasnt() merge_except + sort over pk_hash_filter
- general encode+increment_prefix+SET_RANGE group-skip over decode-all
