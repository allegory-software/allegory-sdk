# mdbx_query

Query engine over `mdbx_schema` tables and indexes. The caller builds the plan
explicitly from **nodes**, each implementing a specific algorithm. Nodes are
composed into a tree; calling `next()` on the root drives the whole tree.

Example schema used in examples:

	users    (id PK, status, score)
	sessions (id PK, user_id -> users.id, started_at)
	events   (id PK, session_id -> sessions.id, kind)

Indexes: users/status, users/score, sessions/user_id, sessions/started_at,
events/session_id, events/kind.


## STORAGE MODEL

Base table:  B-tree keyed by row PK; value = encoded row.
Index:       MDBX DUPSORT B-tree; key = encoded indexed column value;
             duplicates = PKs of matching rows, sorted as raw bytes.

	users/status: 'active' -> [2, 5, 9],  'banned' -> [1, 3]

Indexed operations:

	exact key, key range, distinct keys, GET_BOTH(key, pk) pair test,
	duplicate count, first/last key.

Iteration order:

	pk-order   table PK order (schema-defined sort).
	ix-order   index-key order; within each key, PK order.

ix-order ~= pk-order when iterating across keys:

	users/status full scan: 2, 5, 9, 1, 3  -- pk 1 appears after 2

Merge nodes require pk-order inputs; ix-order inputs need `pk_sort` first.

Reverse iteration reverses the entire scan:

	(a ASC, b DESC) -> only achievable as (a DESC, b ASC)


## NODES

**access nodes**: no inputs; read base tables or indexes; produce a PK stream.
**merge nodes**: two or more pk-order inputs on the same key space; O(n+m) merge.
**probe nodes**: driver + FK index; output adds a member from a different key space.
**transform nodes**: one primary input; filter, sort, project, or correlate; stay
  in the same key space.
**value nodes**: decode a PK stream into value records; operate on value records.

Access, merge, probe, and transform nodes work on raw PK bytes.
`get_col(member, col) -> val | nil` reads decoded column values on demand.
base-table cursors open lazily per member and only when the requested columns
are not present in the index. Value nodes produce Lua value records.


## ACCESS NODES

No inputs. Read base tables and indexes; produce a PK stream.

	pk_get(base, pk...)                 pk-order  exact PK lookup
	pk_seek(ix, key...)                 pk-order  exact index key
	pk_prefix(ix, prefix...)            ix-order  leading-column prefix scan
	pk_range(base|ix [, op, val... [, op, val...] [, opts]])    pk|ix-ord key range scan
	fk_parent_scan(fk_ix)               pk-order  FK index distinct keys as parent PKs
	pk_group_first(ix [, prefix...])    ix-order  first PK per distinct index key

**pk_get** vs **pk_range**: `pk_get` uses MDBX_SET_KEY and returns nil cleanly
for a missing PK. `pk_range` with lo=hi uses MDBX_SET_RANGE, which lands at the
next key on a miss and requires a follow-up equality check.

**pk_seek** vs **pk_range**: same distinction for index keys. Use `pk_seek` for
an exact key match, `pk_range` for a span.

**pk_prefix** vs **pk_range**: `pk_prefix` fixes k leading columns where k < n;
`pk_range` requires all n columns for each bound.

	pk_prefix('sessions/user_id,started_at', uid)  -- all sessions for uid, any started_at

**fk_parent_scan** vs **pk_range** on the same FK index: `pk_range` iterates
child PKs (dup values). `fk_parent_scan` iterates distinct index keys, treating
them as parent PKs; child PKs are never visited.

	fk_parent_scan('sessions/user_id')  -- user PKs {1, 2, 4}
	pk_range('sessions/user_id')        -- session PKs {11, 12, 13, 14, 15}

**pk_group_first** uses MDBX_NEXT_NODUP to step across distinct index keys and
returns the first dup (PK) at each key. This gives one representative row per
group in O(n groups) rather than O(n rows).

	pk_group_first('users/status')  -- one user PK per distinct status value
	-- vs pk_group(pk_range('users/status'), ...) which visits every user

`fk_parent_scan` on a FK index is semantically equivalent to `pk_group_first`
only when the index keys are themselves parent PKs. Both nodes are kept because
the intent differs: `fk_parent_scan` answers "which parents have children";
`pk_group_first` answers "one row per group".

**pk_range** bound syntax:

	pk_range('t/a', '>=', 10, '<=', 20)
	pk_range('t/a,b', '>=', 1, 10, '<=', 1, 20)
	pk_range('t/a', '<=', 10)
	pk_range('t/a')
	pk_range('t/a', {desc=true})

**pk_prefix** must cover at least one and fewer than all key columns.

	pk_prefix('t/a,b', 'foo')


### NULL KEYS

`nil` = omitted argument or unbounded range side. `null` = DB null value.

	pk_seek('t/a', null)                                -- a IS NULL
	pk_seek('t/a,b', null, 3)                           -- a IS NULL AND b = 3
	pk_range('t/a', '>=', null, '<=', 10)               -- null <= a <= 10
	pk_range('t/a', '>', null)                          -- a IS NOT NULL
	pk_range('t/a,b', '>=', null, 0, '<=', null, 9)    -- a IS NULL, 0 <= b <= 9

`mdbx_schema` sorts null before non-null.


## MERGE NODES

Two or more pk-order inputs on the same key space. Advance in lockstep by
comparing raw PK bytes; O(n+m). All inputs must share the same `merge_sig`.

	merge_union(['union'|'full'|'union_all',] node, node...)   flat PK stream; dedup or all
	merge_except(a, b)                                         flat PK stream; a minus b
	merge_join(node [, db.left(node)]...)                      PK tuple stream; inner or left join

**merge_union** vs **merge_join**: `merge_union` deduplicates into a flat PK
stream (one member). `merge_join` produces a PK tuple stream with one member per
input (cross-product per key group).

	merge_union(pk_seek('users/status','active'), pk_seek('users/status','banned'))
	-- all non-guest users in PK order

**merge_except** vs **pk_hash_filter 'not_in'**: both subtract a set from a
stream. `merge_except` requires sorted inputs and uses no extra memory.
`pk_hash_filter` materialises the set but accepts unsorted inputs.

	merge_except(pk_range('users'), pk_seek('users/status','active'))

**merge_join** vs **probe nodes**: `merge_join` requires the driver to already be
in parent-PK order and scans both inputs together O(n+m). Probe nodes accept any
driver order at the cost of one index seek per row.

	merge_join(pk_seek('users/status','active'), pk_range('sessions/user_id'))
	-- driver must already be in user-PK order

**merge_union** mode (leading string, default `'union'`):

	'union'      dedup; PK taken from the first input at each merge key
	'full'       dedup; PK taken from all inputs at each merge key
	'union_all'  no dedup; advance only the input that yielded

`merge_union` and `merge_except` require unique inputs (one PK per key group).
`merge_join` handles non-unique inputs (cross-product per group).


## PROBE NODES

Driver + FK index. Output adds a member from a different key space. Driver can be
in any order.

	pk_join_seek(driver, fk)       driver order    one FK seek per driver PK; O(n log m)
	pk_join_hash(driver, fk)       FK index order  materialise driver set; scan FK index; O(n+m)
	pk_parent_lookup(child, fk)    child order     child PK -> parent PK via FK column

**pk_join_seek** vs **merge_join**: use `pk_join_seek` when the driver is small,
unsorted, or driver order must be preserved.

	pk_join_seek(pk_seek('users/status','active'), 'sessions/user_id')
	-- active users and their sessions in status-index order

**pk_join_hash** vs **pk_join_seek**: `pk_join_seek` preserves driver order, one
seek per row. `pk_join_hash` materialises all driver PKs into a hash set then
scans the FK index once in FK-index order. Use when the driver is large and
unordered and FK-index order is acceptable.

**pk_parent_lookup** vs **pk_join_***: the only node that goes child->parent.
Reads the FK column from the child's source via `get_cols` and probes the parent
base table by PK. Child order preserved.

	pk_parent_lookup(
		pk_range('sessions/started_at,user_id', {desc=true}),
		'sessions/user_id')
	-- most-recent sessions with their users; user_id is in the index: no base-table read

`opts.left = true`: left join; rows with null FK or missing parent are emitted
once with the parent member absent. `pk_join_hash` appends unmatched rows after
matched rows, unordered; the other two preserve their stated order.

**Chained joins** (users -> sessions -> events): `merge_join(pk_range('users'),
pk_range('sessions/user_id'))` produces sessions in FK-index order (user_id asc,
session PK asc), not session-PK order. Joining events onto that output requires
`pk_join_seek` or `pk_join_hash` for the second step.


## TRANSFORM NODES

One primary input. Transform a PK stream without crossing key spaces. Preserve
or filter items; produce a PK stream (or value stream for `pk_group` +
`stream_aggregate`).

`fn` callbacks receive the node itself; use `node:col(member, col)` to
read column values. Correlated inner queries in `semi_join`, `anti_join`, and
`nested_join` are called once per item and receive the outer node.

	pk_sort(node)                      pk-order    dedup + sort; O(n) memory
	pk_hash_filter(driver, set, mode)  driver-ord  filter by PK set membership; 'in'|'not_in'
	pk_and_probe(driver, probes...)    driver-ord  filter by index presence via GET_BOTH; ANDed
	pk_project(tuple, member)          pk-order    extract one member from a PK tuple stream
	pk_filter(input, fn)               input-ord   keep items where fn(node) is true
	pk_group(input, key_fn [, opts])   input-ord   one item per group; requires group order
	semi_join(outer, inner_fn)         outer-ord   keep outer where inner_fn(node) returns >= 1 item
	anti_join(outer, inner_fn)         outer-ord   keep outer where inner_fn(node) returns 0 items
	nested_join(outer, inner_fn)       outer-ord   one item per inner item; merges outer+inner members
	limit(input, n [, offset])         input-ord   at most n items after skipping offset

**pk_sort** is the only node that converts ix-order to pk-order. Required before
any merge node fed by an index range.

	merge_join(pk_sort(pk_range('users/score')), pk_range('sessions/user_id'))

**pk_hash_filter** vs **merge nodes**: merge nodes require sorted inputs with
matching `merge_sig`. `pk_hash_filter` accepts any two PK streams regardless of
order or key space.

	pk_hash_filter(
		pk_range('users/score', '>=', 80, '<=', 100),
		pk_seek('users/status', 'active'),
		'in')

**pk_and_probe** vs **pk_hash_filter**: `pk_hash_filter` materialises the set
(O(n) memory). `pk_and_probe` tests each driver PK against an index via GET_BOTH
-- O(1) memory, one seek per probe per driver row. Use to preserve driver order
without materialisation.

	pk_and_probe(
		pk_range('users/score', {desc=true}),
		{ix='users/status', key='active'})

**pk_project** vs **probe nodes**: probe nodes add a member; `pk_project`
removes all but one, returning a flat PK stream.

**pk_filter** vs **pk_and_probe**: `pk_and_probe` tests index key presence
without reading column values (no base-table open). `pk_filter` runs an
arbitrary predicate that may call `get_cols`.

**pk_group** holds the node positioned at the first (or last) row of each group.
`stream_aggregate` then reads all rows in the group via `get_cols`. `opts.which`
= `'first'` (default) or `'last'`.

**semi_join** and **anti_join**: `inner_fn` receives the positioned outer node
and must return a new PK node. A new node instance is built per outer item.

**nested_join**: `inner_fn` must return a PK node whose member names do not
overlap with the outer node's members.


## VALUE NODES

Decode a PK stream into value records, or transform value records.

**select** is the decode step: reads columns via `get_cols` and returns one Lua
value record per item.

	select(input, outputs)              input-ord   PK stream -> value records

`outputs`: `'member.col [alias], ...'` string, or a list of such strings and/or
`{name=, fn=}` tables. Name defaults to `'member.col'` when alias is omitted.
`fn` receives the positioned input node. `select` preserves input order and
duplicates.

**Filters and limit**:

	pk_filter(input, fn)         input-ord   (also at PK level; see TRANSFORM)
	value_filter(input, fn)      input-ord   keep value records where fn(record) is true
	limit(input, n [, offset])   input-ord   (also at PK level; see TRANSFORM)

Both filters and `limit` preserve input order and duplicates.

**Key function** used by distinct, sort, and aggregate nodes:

	key_fn(item) -> {part, ...}

At PK level, `item` is the positioned node; call `get_cols` to read values.
At value level, `item` is a value record. Returns a non-empty array. Use `null`
for a DB null part; `nil` is invalid.

**Distinct**:

	stream_distinct(input, key_fn)   input-ord   dedup adjacent items; requires group order
	hash_distinct(input, key_fn)     any-ord     dedup any-order items; O(n) memory

**Sort**:

	value_sort(input, spec)   sorted   sort value records

`spec`: `'field [asc|desc], ...'` string, or a comparator `fn(a, b) -> bool`.

**Aggregate**:

	stream_aggregate(input, key_fn, agg)   input-ord  PK stream -> value records; one per group; requires group order
	hash_aggregate(input, key_fn, agg)     any-ord    value records -> value records; any order; O(n groups) memory

Omit `key_fn` for a grand-total aggregate; `stream_aggregate` then needs no
particular input order.

`agg` for `stream_aggregate` (reads via `get_cols`):

	{name='n',     op='count'}
	{name='total', op='sum',    member='users', col='score'}
	{name='names', op='concat', member='users', col='name', sep=','}
	{name='k',     op='key',    part=1}

`agg` for `hash_aggregate` (reads value record fields by name):

	{name='total', op='sum',    input='score'}
	{name='names', op='concat', input='name', sep=','}

Aggregate ops: `count`, `sum`, `avg`, `min`, `max`, `concat`, `key`.
`sum`/`avg`/`min`/`max`/`concat` skip null and absent inputs.
`count` without a column counts every row.
Output fields = `agg` names in order.

**Union**:

	union_all(inputs...)        arg-ord     combine value streams; keep duplicates
	union_distinct(inputs...)   first-seen  combine value streams; dedup

All inputs must have the same fields in the same order.


## DUPLICATE BEHAVIOR

	access nodes, merge_union, merge_except,
	  pk_sort                                     unique by table PK
	pk_hash_filter, pk_and_probe, pk_filter,
	  pk_group, semi_join, anti_join, limit,
	  select, value_filter, value_sort,
	  union_all                                   inherit from input
	stream_distinct, hash_distinct,
	  stream_aggregate, hash_aggregate,
	  union_distinct                              unique by key
	merge_join, pk_join_seek, pk_join_hash,
	  pk_parent_lookup, nested_join               parent PK may repeat
	pk_project                                    inherits projected member

PK tuple streams track uniqueness per member. Full rules in `mdbx_query_validators.md`.

	pk_project(tuple_stream, name) -> flat PK stream   one named member

	-- unique user PKs from a join where each user repeats once per session
	pk_sort(
		pk_project(
			merge_join(pk_range('users'), pk_range('sessions/user_id')),
			'users'))


## NON-GOALS

Window functions, query caching, prepared statements.


## QUERY BUILDER

A composable expression that lowers to a tree of the nodes above. Same query +
same schema always produces the same nodes; join order is preserved as written.
Plan changes only when you change the query or the indexes, never from data.
Lower with `:_lower()` and call `node:explain()` to get a plan tree for snapshotting or diffing in tests.
Hand-built node trees are fully supported; the builder just writes them for you.

	db:from('table' | 'table alias')     start query; member name = alias or table name

	:join('table' [, opts])              inner join along an FK from an existing member
	:inner_join(...), :left_join(...)     explicit inner / left
	opts: from=member, on=fk, index=ix, left=bool, as=alias

	:nested_join(fn)                     correlated join; fn(outer_node) -> query; one output item per inner item

FK direction for `:join` determines the node: parent->child -> `pk_join_*` or
`merge_join`; child->parent -> `pk_parent_lookup`. For parent-to-child, strategy
chosen from driver order: already in parent-PK order ->
`merge_join(driver, pk_range(fk))`; keep driver order -> `pk_join_seek`;
unordered -> `pk_join_hash` or `merge_join(pk_sort(driver), pk_range(fk))`.

`:nested_join` lowers to `nested_join(driver, fn)`. Use for correlated multi-row
joins that are not FK traversals handled by `:join`. Member names returned by the
inner query must not overlap existing members. `pk_project` is used internally by
the builder to flatten a PK tuple stream to a single member when feeding a
subsequent join or merge; it is not directly exposed.

	db:from'users u'
		:join('sessions s', {from='u'})
		:left_join('events e', {from='s'})

Example lowering:

	db:from'users':eq('status','active'):join'sessions':order_by'users.id'
		:select{'users.id','sessions.started_at'}

lowers to:

	db:select(
		db:merge_join(
			db:pk_seek('users/status', 'active'),   -- pk-order = users.id order
			db:pk_range('sessions/user_id')),
		'users.id id, sessions.started_at started_at')

FILTERS (chained = ANDed):

	:eq/:ne/:lt/:le/:gt/:ge(col, val)   comparison
	:between(col, lo, hi)               range
	:where(col [,op], val)              op: =, <>, <, <=, >, >=
	:is_null(col) / :is_not_null(col)   null-first key range
	:like(col, pattern)                 SQL LIKE; literal prefix on indexed col folds to pk_range
	:in_(col, values|query)             pk_hash_filter 'in'  (in is a Lua keyword)
	:not_in(col, values|query)          pk_hash_filter 'not_in'
	:where_exists(query|fn)             semi_join (correlated) or run-once (uncorrelated)
	:where_not_exists(query|fn)         anti_join
	:where_has(table [,fn])             FK existence; no fn -> fk_parent_scan; with fn -> semi_join
	:where_hasnt(table [,fn])           FK non-existence; no fn -> merge_except + fk_parent_scan; with fn -> anti_join
	:or_where(col [,op], val)           OR (AND binds tighter); folds to merge_union on indexed col
	:filter(fn)                         arbitrary Lua predicate; always residual

On indexed columns of the access table: `:eq` folds to `pk_seek`/`pk_prefix`,
ranges to `pk_range`, full PK equality to `pk_get`. Multiple indexed predicates
use one index (equality preferred, or pinned); the rest are residual `pk_filter`.

Correlate an existence test explicitly -- never by column-name matching:

	-- marker: outer'member.col' refers to the enclosing query's current row
	db:from'users u':where_exists(
		db:from'sessions':eq('user_id', outer'u.id'):gt('started_at', t))

	-- closure: o is the enclosing query; use for clean scope across nesting
	db:from'users u':where_exists(function(o)
		return db:from'sessions':eq('user_id', o'u.id'):gt('started_at', t) end)

ORDER / LIMIT / DISTINCT:

	:order_by(col, ...)    'col' or 'col desc'; uses existing index order when possible, else value_sort
	:limit(n) / :offset(n) pushed into driving scan when it already yields the needed order
	:distinct(cols)         stream_distinct (input grouped) or hash_distinct

When `:order_by` + `:limit` is present and driver order must be preserved,
equality filters on secondary indexed columns lower to `pk_and_probe` rather than
`pk_hash_filter`. `pk_and_probe` tests each driver row via GET_BOTH (O(1) memory)
and lets `:limit` stop the scan early; `pk_hash_filter` would materialise the
full filter set before any rows are returned.

GROUP / AGGREGATE:

	:group_by(cols)              with :agg{...} -> pk_group / stream_aggregate / hash_aggregate
	:agg{...}                    without :group_by -> grand total
	:having(col [,op], val|fn)   value_filter after aggregate

When `:group_by(col)` is the leading column of an index and no earlier filter has
already narrowed the scan, the builder lowers to `pk_group_first(ix) +
stream_aggregate` instead of `pk_group(pk_range(ix)) + stream_aggregate`. This
visits O(n groups) rows rather than O(n rows).

PROJECTION:

	:select{outputs}   -> value stream; 'member.col', 'member.col alias', or {name=,fn=}
	:agg{...}          -> value stream

SET OPERATIONS:

	union{q,...}       union_distinct over value queries with the same fields
	union_all{q,...}   union_all

CONTROL:

	:use_index(member, ix)    force index
	:no_index(member [,ix])   forbid index (all if ix omitted)
	:use_counts()             let lowering use MDBX entry counts to break ties (default off;
								keeps plan as pure function of query+schema when off)

TERMINALS:

	:rows()    iterate value records
	:first()   first value record or nil
	:count()   row count (exact via ix_count or table stat when possible, else count aggregate)
	:exists()  true if any row matches
