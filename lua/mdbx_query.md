# mdbx_query

Query engine over `mdbx_schema` tables and indexes. The caller builds the plan
explicitly out of **nodes** that implement a specific algorithm that produces
an iterator of **items**. Filters and joins work at the PK level: only rows
that remain after filtering are decoded.

Example schema used in examples (PK = primary key, -> = foreign key):

	users    (id PK, status, score)
	sessions (id PK, user_id -> users.id, started_at)
	events   (id PK, session_id -> sessions.id, kind)

Indexes: users/status, users/score, sessions/user_id, sessions/started_at,
events/session_id, events/kind.


## STORAGE MODEL

Base table:  B-tree keyed by row PK; value = encoded row.
Index:       MDBX DUPSORT B-tree; key = encoded indexed value; duplicates = PKs
             of rows with that value, sorted as raw bytes.

	users/status: 'active' -> [2, 5, 9],  'banned' -> [1, 3]

Indexed operations:

	exact key, key range, distinct keys, `GET_BOTH(key, pk)` pair test,
	duplicate count, first/last key.

Iteration order:

	pk-order   raw table PK order, which gives schema-defined PK order.
	ix-order   index-key order, PK-sorted within each duplicate key.

ix-order ~= pk-order:

	- iterate on one index key => pk-order: all PKs come from one dup list.
	- iterate an index range => ix-order: smaller PKs can appear after larger ones.

		users/status: active -> [2,5,9],  banned -> [1,3]
		users/status full scan: 2, 5, 9, 1, 3  -- not pk-order; 1 appears after 2

	Why this matters: merge nodes require inputs in pk-order, so ix-order
	inputs need to be sorted first.

Iterating in reverse can only reverse the order of the whole scan, so:

	(a ASC, b DESC) -> (a DESC, b ASC)


## NODES

**access nodes**: no inputs; read the db directly; produce a PK stream.
**merge nodes**: two or more sorted inputs on a shared key space; O(n+m) sorted merge.
**probe nodes**: driver + index; cross to a different key space; any driver order.
**pipeline nodes**: single input; filter, sort, or project a PK stream.

All four layers operate on raw PK bytes. Above them: `fetch` opens cursors,
`select` decodes values.


## ACCESS NODES

No inputs. Read base tables and indexes; produce a PK stream.

	pk_get(base, pk...)                             pk-order    exact base-table PK lookup
	pk_seek(ix, key...)                             pk-order    exact index key; all PKs at that key
	pk_prefix(ix, prefix...)                        ix-order    leading-column prefix scan
	pk_range(base|ix [, op, val... [, op, val...] [, opts]])  pk|ix-ord  key range scan
	fk_parent_scan(fk_ix)                           pk-order    FK index distinct keys as parent PKs

**pk_get** vs **pk_range**: targets one known PK with MDBX_SET_KEY; returns nil
cleanly for a missing row. `pk_range` with lo=hi works but uses MDBX_SET_RANGE and
adds range-check overhead.

**pk_seek** vs **pk_range**: `pk_range` with lo=hi would work (a single key group
is always PK-ordered) but uses MDBX_SET_RANGE, which lands at the next key when
the target is absent and requires a follow-up equality check to detect a miss.
`pk_seek` uses MDBX_SET_KEY and fails cleanly. Use `pk_seek` for an exact value,
`pk_range` for a span.

**pk_prefix** vs **pk_range**: `pk_prefix` fixes k < n leading columns of a
composite index; `pk_range` requires all n columns for each bound. For a 2-column
index, `pk_range` needs explicit lo/hi for both columns; `pk_prefix` stops after
the first and uses MDBX prefix matching for the rest.

	pk_prefix('sessions/user_id,started_at', uid)  -- all sessions for uid, any started_at
	-- pk_range can't express this without knowing the min/max of started_at

**fk_parent_scan** vs **pk_range** on the same FK index: `pk_range` iterates child
PKs (dups). `fk_parent_scan` iterates distinct index keys as parent PKs -- dups are
never visited. Use to ask "which parents have at least one child?" without
iterating children.

	fk_parent_scan('sessions/user_id')  -- user PKs {1,2,4}
	pk_range('sessions/user_id')        -- session PKs {11,12,13,14,15}

**pk_range** bounds use comparison operators followed by one value per key column.
`opts`: `desc` (reverse scan).

	pk_range('t/a', '>=', 10, '<=', 20)        -- 10 <= a <= 20
	pk_range('t/a,b', '>=', 1, 10, '<=', 1, 20)  -- a = 1, 10 <= b <= 20
	pk_range('t/a', '<=', 10)                  -- a <= 10
	pk_range('t/a')                            -- whole index
	pk_range('t/a', {desc=true})               -- whole index, reversed

**pk_prefix** `prefix...` must cover at least one but strictly fewer than all key
columns (full key -> `pk_seek`).

	pk_prefix('t/a,b', 'foo')    -- a = 'foo' for all b


### NULL KEYS

`nil` = omitted argument or unbounded range side. `null` = DB null value.

	pk_seek('t/a', null)                                -- a IS NULL
	pk_seek('t/a,b', null, 3)                           -- a IS NULL AND b = 3
	pk_range('t/a', '>=', null, '<=', 10)               -- null <= a <= 10
	pk_range('t/a', '>', null)                          -- a IS NOT NULL (a > null)
	pk_range('t/a,b', '>=', null, 0, '<=', null, 9)    -- a IS NULL, 0 <= b <= 9

`mdbx_schema` sorts null before non-null. `a IS NOT NULL` = the range `a > null`,
usable with index order when `a` is the first key column not already fixed by
equality. `b IS NOT NULL` without fixed `a`: use an index with `b` in that
position, or scan and filter.


## MERGE NODES

Two or more inputs with the same `merge_sig`. Converge by sorted merge O(n+m);
inputs must be in merge_key order. Inherit `merge_cmp`/`merge_sig` from input 1
and compose as inputs to further merge nodes.

	merge_union(['union'|'full'|'union_all',] node, node...)   union; flat PK stream
	merge_except(a, b)                     difference (a minus b); flat PK stream
	merge_join(node [, db.left(node)]...)  intersection / left-join; PK tuple stream

**merge_union** vs **merge_join**: both combine multiple PK streams; `merge_union`
deduplicates into a single flat PK stream (one member). `merge_join` produces a PK
tuple stream (multiple members, cross-product per key group).

	merge_union(pk_seek('users/status','active'), pk_seek('users/status','banned'))
	-- all non-guest users in PK order; one flat stream

**merge_except** vs **pk_hash_filter 'not_in'**: both subtract a set from a stream.
`merge_except` requires sorted inputs and uses no memory; `pk_hash_filter`
materialises the set but accepts any input order.

	merge_except(pk_range('users'), pk_seek('users/status','active'))  -- non-active users

**merge_join** vs **probe nodes**: `merge_join` requires driver already in
parent-PK order and scans both inputs in lockstep O(n+m). Probe nodes accept any
driver order at the cost of one index seek per row. `merge_join` is the
parent-to-child join when the driver is already sorted; pass `pk_range(fk_ix)` as
the second input.

	merge_join(pk_seek('users/status','active'), pk_range('sessions/user_id'))
	-- active users x their sessions; driver must be in user-PK order

**merge_union** mode (optional leading string, default `'union'`):

	'union'      dedup; PK from the first input at each merge_key
	'full'       dedup; PK from all inputs at each merge_key
	'union_all'  no dedup; advance only the yielding input each step

`merge_union` and `merge_except` require unique inputs (one PK per `next_group`).
`merge_join` works with non-unique inputs (cross-product per `next_group`).


## PROBE NODES

Driver + index. Output crosses key spaces: driver is in one PK space, output adds
another. Driver can be any order. `fk` is a FK index name (e.g.
`'sessions/user_id'`); any index with key encoding compatible with the driver's
PKs works.

	pk_join_seek(driver, fk)       driver order    one FK seek per driver PK; O(n log m)
	pk_join_hash(driver, fk)       FK index order  materialise driver into hash; scan FK index; O(n+m)
	pk_parent_lookup(child, fk)    child order     reverse direction: child PK -> parent PK

**pk_join_seek** vs **merge_join**: `merge_join` requires sorted driver and advances
both inputs together; `pk_join_seek` does one MDBX_SET_KEY seek per driver row.
Use `pk_join_seek` when the driver is small, unsorted, or driver order must be
preserved in the output.

	pk_join_seek(pk_seek('users/status','active'), 'sessions/user_id')
	-- active users and their sessions in status-index order, not user-PK order

**pk_join_hash** vs **pk_join_seek**: `pk_join_seek` preserves driver order, one
seek per row. `pk_join_hash` materialises all driver PKs into a hash set then
scans the FK index once, producing FK-index order. Use when the driver is large,
unordered, and FK-order output is acceptable. Equivalent to
`merge_join(pk_sort(driver), pk_range(fk))` but avoids the O(n log n) sort cost.

**pk_parent_lookup** vs **pk_join_***: only node that goes child->parent. Reads
the FK column from the child's source cursor (covered read -- no base-table open)
and probes the parent table by PK. Child order preserved.

	pk_parent_lookup(
		pk_range('sessions/started_at,user_id', {desc=true}),
		'sessions/user_id')
	-- last sessions with their users in started_at order;
	-- user_id is in the index key: no base-table open needed

`opts.left = true`: left join; rows with null FK or missing parent emitted once
with parent member absent. `pk_join_hash` appends unmatched rows after matched
rows, unordered; others preserve stated order.

Works for any column equi-join `t1.a = t2.b` when the probed table has an index
on `b` and both sides encode the value identically (same types, widths, sign,
direction, collation). FK is the common case where schema guarantees this.

**Chained joins** (`users -> sessions -> events`): `merge_join(pk_range('users'),
pk_range('sessions/user_id'))` outputs sessions in FK index order (user_id asc,
session PK asc) -- not session-PK order. Joining events onto sessions therefore
needs `pk_join_seek` or `pk_join_hash` for the second step.


## PIPELINE NODES

Single input. Filter, sort, or project within the PK layer.

	pk_sort(node)                      pk-order    dedup + sort; materialises O(n) memory
	pk_hash_filter(driver, set, mode)  driver      filter by set membership; mode 'in'|'not_in'
	pk_and_probe(driver, probes...)    driver      filter by index presence; ANDed GET_BOTH per probe
	pk_project(tuple_stream, member)   pk-order    extract one member from a PK tuple stream

**pk_sort** — the only node that converts ix-order to pk-order. Required before
any merge node fed by an index range. `node.cursor = nil` after sort.

	merge_join(pk_sort(pk_range('users/score')), pk_range('sessions/user_id'))
	-- pk_sort is required: pk_range on an index is ix-order

**pk_hash_filter** vs **merge nodes**: merge nodes require sorted inputs with
compatible `merge_sig`. `pk_hash_filter` accepts any two PK streams regardless of
order or key-space. The set is materialised into memory; the driver is streamed.

	pk_hash_filter(
		pk_range('users/score', '>=', 80, '<=', 100),   -- driver: ix-order fine
		pk_seek('users/status', 'active'),   -- set: materialised
		'in')

**pk_and_probe** vs **pk_hash_filter**: `pk_hash_filter` materialises the set
(O(n) memory). `pk_and_probe` tests each driver PK directly against an index via
GET_BOTH -- O(1) memory, one seek per probe per driver row. Use to preserve driver
order for ORDER BY + LIMIT without materialisation.

	pk_and_probe(
		pk_range('users/score', {desc=true}),  -- score order preserved
		{ix='users/status', key='active'})                -- no set materialised

**pk_project** vs **pk_join_***: probe nodes add a member to a stream; `pk_project`
removes all but one, returning a flat PK stream for feeding back into merge or
pipeline nodes.

Source cursors: `pk_hash_filter` and `pk_and_probe` inherit `node.cursor` from
the driver. `pk_sort` has `node.cursor = nil`.




## DUPLICATE BEHAVIOR

	access nodes, merge nodes, pk_sort   unique by table PK
	pk_hash_filter, pk_and_probe, filters, limit,
		select, value_sort                              inherit from input
	distinct nodes, aggregate nodes                   unique by key
	parent-to-child joins                             parent PK may repeat

PK tuple streams track uniqueness per member. Full rules in `mdbx_query_validators.md`.

	pk_project(tuple_stream, name) -> PK stream    extract one named member from a PK tuple

	-- unique user PKs from a join where each user repeats once per session
	db:pk_sort(
		db:pk_project(
			db:merge_join(db:pk_range('users'), db:pk_range('sessions/user_id')),
			'users'))



## CURSOR AND VALUE NODES

	fetch(node) -> cursor stream

Turns PK or PK tuple stream into cursor bundles keyed by member name. Uses source
cursor for covered columns; opens base table by PK for others.

`pk_sort`, merge nodes, `pk_join_sort_merge` have `node.cursor = nil`;
`fetch` then always opens the base table for non-PK columns.

A cursor bundle stays valid until the next `next()` call.

**Cursor joins** -- `outer` is a cursor stream; `inner` is a Lua function called
once per outer bundle, returning a node. Outer bundle stays positioned while inner
node is open.

	semi_join(outer, inner)    -> cursor stream   keep outer when inner() node returns >= 1 item
	anti_join(outer, inner)    -> cursor stream   keep outer when inner() node returns 0 items
	nested_join(outer, inner)  -> cursor stream   one bundle per inner bundle; outer+inner cursors merged

`nested_join`: inner node must return cursor bundles; inner member names must not
duplicate outer member names.

**Filters**:

	cursor_filter(input, fn) -> cursor stream   keep bundles where fn(bundle) is true
	value_filter(input, fn)  -> value stream    keep items where fn(item) is true

Both preserve input order and duplicate behavior.

	limit(input, n, [offset]) -> same type   at most n items after skipping offset; preserves everything

**Select**:

	select(input, outputs) -> value stream   cursor stream -> value stream

`outputs`: list of `{name=, cursor=, column=}` or `{name=, fn=}`.
`fn` receives the cursor bundle. `select` preserves input order and duplicates.

**Key function** used by distinct, sort, and aggregate nodes:

	key_fn(item) -> {part, ...}

`item` is a cursor bundle (cursor streams) or a value item (value streams).
Returns a non-empty array. Use `null` for a DB null part; `nil` is invalid.
All items from one node must return the same part count.

**Distinct**:

	stream_distinct(input, key_fn) -> same type   requires equal keys adjacent; input order
	hash_distinct(input, key_fn)   -> same type   any order; stores seen keys in memory

**Sort**:

	value_sort(input, key_fn, opts) -> value stream

`opts`: per-part direction list, e.g. `{'asc', 'desc'}`; default ascending.

**Aggregate**:

	group_cursor(input, key_fn, opts)      cursor stream -> cursor stream   one bundle per group; requires group order
	stream_aggregate(input, key_fn, agg)   cursor stream -> value stream    one value per group; requires group order
	hash_aggregate(input, key_fn, agg)     value stream  -> value stream    any input order; materialises

`opts.which = 'first' | 'last'`: which row from the group `group_cursor` returns.
Omitting `key_fn`: one grand-total group; `stream_aggregate` then needs no order.

`agg` for `stream_aggregate` (reads cursor bundle columns):

	{name='n',     op='count'}
	{name='total', op='sum',    cursor='users', column='score'}
	{name='names', op='concat', cursor='users', column='name', sep=','}
	{name='k',     op='key',    part=1}          -- part N of key_fn result

`agg` for `hash_aggregate` (reads value item fields by name):

	{name='total', op='sum',    input='score'}
	{name='names', op='concat', input='name', sep=','}

Aggregate ops: `count`, `sum`, `avg`, `min`, `max`, `concat`, `key`.
`sum`/`avg`/`min`/`max`/`concat` skip null and absent inputs.
`count` without a column counts every row.
Output fields = `agg` names in order.

**Union**:

	union_all(inputs...)      value streams -> value stream   keeps duplicates; argument order
	union_distinct(inputs...)  value streams -> value stream  first-seen per distinct item

All inputs must have the same fields in the same order.


## PER-ITEM NODE OPENING

Nodes that open a child node per outer item (`semi_join`, `anti_join`,
`nested_join`) build a new node instance per item; each gets one `open()` call.


## NON-GOALS

Window functions, query caching, prepared statements.


## METADATA HELPERS

One MDBX stat call, cursor seek, or duplicate count each; no maintained statistics.

	pk_exists(table, pk)    -> bool    base-table key lookup; complete PK
	ix_exists(ix, key)      -> bool    index key lookup; complete key
	ix_count(ix, key)       -> n       MDBX duplicate count; complete key only; no prefix/range
	ix_min(ix, prefix)      -> key     first key matching prefix; nil prefix = first key overall
	ix_max(ix, prefix)      -> key     last key matching prefix; nil prefix = last key overall
	explain(node)           -> t       item type, members, order, uniqueness, source cursor, work; no DB read

------------------------------------------------------------------------------

A read is **covered** by an index when all requested column values are in the
index key or PK -- no base-table open needed.


------------------------------------------------------------------------------

## QUERY BUILDER

A composable expression that lowers to a tree of the nodes above. Same query +
same schema always produces the same nodes; join order is preserved as written.
Plan changes only when you change the query or the indexes, never from data.
`explain(query)` can be snapshotted and diffed in tests.
Hand-built node trees are fully supported; the builder just writes them for you.

	db:from('table' | 'table alias')     start query; member name = alias or table name

	:join('table' [, opts])              inner join along an FK from an existing member
	:inner_join(...), :left_join(...)     explicit inner / left
	opts: from=member, on=fk, index=ix, left=bool, as=alias

FK direction determines the node: parent->child -> `pk_join_*` or `merge_join`;
child->parent -> `pk_parent_lookup`. For parent-to-child, strategy is chosen from
driver order: already in parent-PK order -> `merge_join(driver, pk_range(fk))`;
keep driver order -> `pk_join_seek`; unordered -> `pk_join_hash` or
`merge_join(pk_sort(driver), pk_range(fk))` (for left joins, hash appends
unmatched rows after matched; sort_merge keeps FK index order).

	db:from'users u'
		:join('sessions s', {from='u'})
		:left_join('events e', {from='s'})

Example lowering:

	db:from'users':eq('status','active'):join'sessions':order_by'users.id'
		:select{'users.id','sessions.started_at'}

lowers to:

	db:select(
		db:fetch(
			db:merge_join(
				db:pk_seek('users/status', 'active'),   -- pk-order = users.id order
				db:pk_range('sessions/user_id'))),
		{{name='id', cursor='users', column='id'},
		 {name='started_at', cursor='sessions', column='started_at'}})

FILTERS (chained = ANDed):

	:eq/:ne/:lt/:le/:gt/:ge(col, val)   comparison
	:between(col, lo, hi)               range
	:where(col [,op], val)              op: =, <>, <, <=, >, >=
	:is_null(col) / :is_not_null(col)   null-first key range
	:like(col, pattern)                 SQL LIKE; literal prefix on indexed col folds to pk_range
	:in_(col, values|query)             pk_hash_filter 'in'  (in is a Lua keyword, hence in_)
	:not_in(col, values|query)          pk_hash_filter 'not_in'
	:where_exists(query|fn)             semi_join (correlated) or run-once (uncorrelated)
	:where_not_exists(query|fn)         anti_join
	:where_has(table [,fn])             correlated FK existence; no fn -> may use fk_parent_scan
	:where_hasnt(table [,fn])           correlated FK non-existence
	:or_where(col [,op], val)           OR (AND binds tighter); folds to merge_union on indexed col
	:filter(fn)                         arbitrary Lua predicate; always residual

On indexed columns of the access table: `:eq` folds to `pk_seek`/`pk_prefix`,
ranges to `pk_range`, full PK equality to `pk_get`. Multiple indexed predicates
use one index (equality preferred, or pinned); the rest are residual
`cursor_filter` (before `fetch` when covered) or `value_filter`.

Correlate an existence test explicitly -- never by column-name matching:

	-- marker: outer'member.col' refers to the enclosing query's current row
	db:from'users u':where_exists(
		db:from'sessions':eq('user_id', outer'u.id'):gt('started_at', t))

	-- closure: o is the enclosing query; use for clean scope across nesting
	db:from'users u':where_exists(function(o)
		return db:from'sessions':eq('user_id', o'u.id'):gt('started_at', t) end)

Both forms use the child FK index; cost equals a plain FK existence check.

ORDER / LIMIT / DISTINCT:

	:order_by(col, ...)    'col' or 'col desc'; uses existing index order when available, else value_sort
	:limit(n) / :offset(n) pushed into driving scan when it already yields the needed order
	:distinct(cols)         stream_distinct (input grouped) or hash_distinct

GROUP / AGGREGATE:

	:group_by(cols)              with :agg{...} -> group_cursor / stream_aggregate / hash_aggregate
	:agg{...}                    without :group_by -> grand total
	:having(col [,op], val|fn)   value_filter after aggregate

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

	:rows()    iterate value items
	:first()   first value item or nil
	:count()   row count (exact via ix_count or table stat when possible, else count aggregate)
	:exists()  true if any row matches

	explain(query)   lower and report nodes; no DB reads
