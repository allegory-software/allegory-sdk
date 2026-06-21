# mdbx_query Architecture

`mdbx_query` executes query plans over `mdbx_schema` tables and indexes. The
caller builds the plan explicitly.

The main design goal is to keep costs visible. A node should make it clear when
it scans an index, opens base-table rows, sorts, builds a hash table, keeps input
order, or performs one lookup per input item.

The second goal is to do as much work as possible before loading base-table rows.
Filters and joins should use primary keys and indexes while that is still enough;
full row decoding should happen only for rows that survive.

Example schema (`PK` means primary key; arrows show foreign keys, or FKs):

    users   (id PK, status, score)
    sessions(id PK, user_id -> users.id, started_at)
    events  (id PK, session_id -> sessions.id, kind)

Indexes used in examples: users/status, users/score, sessions/user_id,
sessions/started_at, events/session_id, events/kind.


## Items And Nodes

A node is opened with `:open() -> next_fn`. Calling `next_fn()` returns the next
item, or `nil` when the node is exhausted. A node instance is single-use:
`:open()` may be called once. A plan runs inside a read transaction the caller
has open.

Primitive node names describe their physical execution. The query builder (below)
lowers to these nodes, and a plan can be built from them directly; either way the
plan is validated before it runs, and an invalid plan raises.

A stream is the sequence of items returned by one opened node. The stream name
comes from the item type:

- **PK stream** -- returns PK items; one raw primary-key value for one table.
- **PK tuple stream** -- returns PK tuple items; PKs for more than one table.
- **cursor stream** -- returns cursor bundles; cursors positioned on rows.
- **value stream** -- returns value items; decoded output values.

A value item has a **value shape**: the ordered list of output names. The item is
keyed by those names. Two value streams are compatible when they have the same
output names in the same order.

Two value items with the same shape are equal when every output value for that
shape is equal. Database null is the `null` sentinel; Lua `nil` means the output
is absent.

A PK stream belongs to one table. A PK tuple stream carries PKs for more than one
table. Later nodes identify a tuple member by name. The default name is the table
name. If the same table appears twice, the caller supplies different names.

Some PK nodes also keep a **source cursor**. This is the cursor that produced the
current PK. A source cursor lets `fetch` read columns already present in an index
entry. A node that keeps only PK bytes can be fetched; its cursor bundle opens
the base table for non-PK columns.


## Storage Model

A base table is a B-tree keyed by the row's primary key. The stored value is the
encoded row.

An index is a separate MDBX DUPSORT B-tree. The index key is the encoded
indexed value. The duplicate values under that key are the primary keys of rows
with that indexed value. MDBX keeps those duplicate PKs sorted as raw bytes.

Example:

    users/status index:
      'active' -> [2, 5, 9]
      'banned' -> [1, 3]

This enables indexed reads for:

- exact index key: position on one key and scan that key's sorted PK list.
- index range: position on a low key and scan until a high key.
- distinct index keys: scan keys while skipping each key's PK list.
- exact pair test: `GET_BOTH(key, pk)` tests one `(key, pk)` pair.
- duplicate count: count PKs under one exact key.
- endpoint: read the first or last index key.

A read is **covered** by an index when the requested column values are available
from the index key or PK. A covered read uses the index cursor only.


## Access Nodes

Access nodes create the first PK or value streams in a plan.

| Node                         | Reads              | Returns        | Order          |
|------------------------------|--------------------|----------------|----------------|
| `pk_get(table, pk...)`       | base-table key     | one PK item    | PK asc         |
| `pk_scan(table)`             | base-table keys    | PK items       | PK asc         |
| `pk_seek(ix, key...)`        | one index key      | PK items       | PK asc         |
| `pk_prefix(ix, prefix...)`   | index key prefix   | PK items       | index key, PK  |
| `pk_range(ix, lo, hi, opts)` | index key range    | PK items       | index key, PK  |
| `fk_parent_scan(ix)`         | FK index keys      | parent PKs     | parent PK asc  |
| `ix_distinct_keys(ix, len)`  | index keys         | index values   | index value    |

`pk_get(table, pk...)` reads one table PK. It returns zero or one PK item.

`pk_scan(table)` scans the base-table B-tree keys and returns all PKs. This is
the PK source for plans where every table row is a candidate.

`pk_seek(ix, key...)` positions on one complete index key. It returns the PKs
stored under that key. Because MDBX keeps duplicates sorted, the output is in
PK order.

`pk_prefix(ix, prefix...)` scans a composite index by a leading equality prefix.
For index `(a,b)`, `pk_prefix('t/a,b', 1)` means `a = 1` for all `b`.

`pk_range(ix, lo, hi, opts)` scans an index range. `nil` marks an unbounded low
or high bound. Every bounded side is an array with one value per index key
column. `opts.lo_open` excludes `lo`; `opts.hi_open` excludes `hi`. `opts.desc`
scans backward. Range output is in index-key order. Both bounds `nil` scans the
whole index.

For index `(a)`, use one-element bounds: `pk_range('t/a', {10}, {20})`. For
index `(a,b)`, `pk_range('t/a,b', {1, 10}, {1, 20})` scans from key `(1,10)`
through key `(1,20)` in encoded key order.

If an indexed column value is itself an array, that value is one element inside
the bound array.

`fk_parent_scan(child_fk_index)` scans distinct child FK index keys and returns
the referenced parent PKs. It skips FK keys with null components. This is for
existence queries such as "users with at least one session".

`ix_distinct_keys(ix, prefix_len)` returns index values. This is the node for
`SELECT DISTINCT col` queries. Use `fk_parent_scan` for distinct parent
PKs from an FK index.


## Null Keys

Index-backed access nodes pass the database null sentinel to the schema encoder.
Lua `nil` marks an omitted argument or an unbounded range side.

Examples:

```lua
pk_seek('t/a', null)              -- a IS NULL
pk_seek('t/a,b', null, 3)         -- a IS NULL AND b = 3
pk_range('t/a', nil, {10})        -- unbounded low
pk_range('t/a', {null}, {10})     -- low bound is DB NULL
pk_range('t/a', {null}, nil, {lo_open = true}) -- a IS NOT NULL
pk_range('t/a,b', {null, 0}, {null, 9})
```

The schema encoder validates whether null is legal for each key column.
`mdbx_schema` sorts null before non-null in index keys. Range comparisons use the
encoded order.

Because null sorts first, `a IS NOT NULL` is the key range `a > null`. This can
use index order when `a` is the first key column not already fixed by equality.
In a composite index `(a,b)`, that covers `a IS NOT NULL` and `a = 1 AND b IS
NOT NULL`. For `b IS NOT NULL` without fixed `a`, use an index with `b` in that
position or scan and filter.

For FK parent scans, a null FK component means the referenced parent is absent,
so the key is skipped.


## Order

Every PK stream has an order description. The full form is a list of ordered
keys, including direction:

    users.pk asc
    users.status asc, users.pk asc
    sessions.user_id asc, sessions.started_at desc, sessions.pk asc

PK streams come sorted:

- **pk-order**: ascending by raw table PK.
- **ix-order**: index-key order, with PK order inside each duplicate key.

`pk_seek(users/status, 'active')` is pk-order because all output PKs come from one
index key, and MDBX stores that duplicate PK list in PK order.

`pk_range('users/status', {'a'}, {'z'})` is ix-order because it returns all PKs for
`status = 'a'`, then all PKs for `status = 'b'`, and so on. Each duplicate list is
PK-sorted. The whole output can still place a smaller PK after a larger PK.

Example:

    users/status:
      active -> [2, 5, 9]
      banned -> [1, 3]

The full index scan returns `2, 5, 9, 1, 3`. `pk-order` requires `1` before `2`.

Merge nodes require this distinction. A merge intersection assumes both inputs
move forward in the same order. If one input can produce a smaller PK after a
larger one, the merge can miss matches.

Direction is separate from the key list. `opts.desc` scans the same B-tree
backward. Mixed direction inside a composite key, such as `a ASC, b DESC`
is done through key encoding.


## Single-table Combine Nodes

These nodes combine PK streams for the same table.

For hash and probe nodes, the **driver** is the input scanned from beginning to
end. Driver order means the output has the same order as that input. A **probe**
is one exact index lookup performed for one driver PK.

| Node                                | Needs           | Returns      | Order        |
|-------------------------------------|-----------------|--------------|--------------|
| `pk_and(a, b)`                      | same table, PK  | intersection | pk-order     |
| `pk_or(a, b)`                       | same table, PK  | union        | pk-order     |
| `pk_except(a, b)`                   | same table, PK  | difference   | pk-order     |
| `pk_sort(node)`                     | same table      | deduped PKs  | pk-order     |
| `pk_hash_filter(driver, set, mode)` | same table      | driver PKs   | driver order |
| `pk_and_probe(driver, probes...)`   | driver + probes | driver PKs   | driver order |

`pk_and`, `pk_or`, and `pk_except` are merge nodes. They require both inputs to be
pk-order from beginning to end and unique by table PK.

`pk_sort(node)` collects a PK stream, sorts by PK, removes duplicates, and returns
a pk-order stream. Use it to convert ix-order or probe output back to the pk-order
required by merge nodes.

`pk_hash_filter(driver, set_source, mode)` builds an in-memory set of raw PK bytes
from `set_source`, then scans `driver`. With `mode = 'in'`, it emits driver PKs
that are present in the set. With `mode = 'not_in'`, it emits driver PKs that are
absent from the set. It reads only PK streams.

`pk_hash_filter` keeps the driver's order. If the driver is pk-order, the
result can be passed to merge nodes. If the driver is ix-order, the result is
still ix-order and needs `pk_sort` before the next merge node.

Example:

```lua
pk_hash_filter(
	pk_range('users/score', {80}, {100}),
	pk_seek('users/status', 'active'),
	'in')
```

This scans score order, keeps users whose PK is in the active-status set, and
returns them in score order.

`pk_and_probe(driver, probes...)` scans the driver and performs one exact index
pair test per probe for each driver PK. The exact pair test is `GET_BOTH(key, pk)`.
This keeps the driver's order and supports `ORDER BY ... LIMIT`.

Example:

```lua
limit(
	pk_and_probe(
		pk_range('users/score', nil, nil, {desc = true}),
		{ix = 'users/status', key = 'active'}),
	20)
```

This returns the top-scoring active users by scanning score order and stopping
after 20 matches.


## Duplicate Behavior

Duplicate behavior says whether a stream can return the same PK or value item
more than once. Access nodes, `pk_and`, `pk_or`, `pk_except`, and `pk_sort` are
unique by table PK; `pk_hash_filter`, `pk_and_probe`, filters, `limit`, `select`,
and `value_sort` inherit their input; distinct and aggregate nodes emit one item
per key; parent-to-child joins may repeat a parent PK. The per-node table is in
`mdbx_query_validators.md`.

PK tuple streams track duplicate behavior per tuple member. In `users ->
sessions`, a user with three sessions yields three tuple items. The users PK
repeats; the sessions PK can still be unique.

Nodes that accept PK tuple streams, such as `fetch` and parent-to-child joins,
can consume them directly. The merge nodes (`pk_and`, `pk_or`, `pk_except`)
consume PK streams. Use `pk_project(tuple_stream, name)` to extract one named tuple
member as a PK stream.

Example:

```lua
pk_sort(
	pk_project(
		pk_join_merge(pk_scan('users'), 'sessions/user_id'),
		'users'))
```

This returns unique user PKs from a tuple stream where each user may appear once
per session.


## Join Nodes

A parent-to-child FK join starts with parent PKs and uses a child FK index to find
matching child PKs.

Parent-to-child joins have separate physical nodes:

| Node                              | Work                       | Requires     |
|-----------------------------------|----------------------------|--------------|
| `pk_join_merge(driver, fk)`       | merge driver with FK index | parent order |
| `pk_join_seek(driver, fk)`        | seek FK per driver PK      | any order    |
| `pk_join_hash(driver, fk)`        | hash driver, scan FK index | memory       |
| `pk_join_sort_merge(driver, fk)`  | sort driver, then merge    | sort memory  |

`pk_join_merge(driver, fk)` walks the driver PKs and child FK index together.
It requires the driver to be ordered by the parent PK used by the FK.

```lua
pk_join_merge(
	pk_scan('users'),
	'sessions/user_id')
```

`pk_join_seek(driver, fk)` scans the driver and seeks the child FK index once per
driver PK. It keeps driver order.

`pk_join_hash(driver, fk)` materializes the driver in a hash table keyed by parent
PK, then scans the child FK index. It uses memory instead of driver order.

`pk_join_sort_merge(driver, fk)` materializes the driver, sorts it by parent PK,
then merges with the child FK index.

Each parent-to-child join returns a PK tuple stream carrying the input PK members
plus the matching child PK.

Each join is inner by default. With `opts.left = true` it is a left join: a driver
row with no match is emitted once, with the matched member absent (its columns
read as Lua `nil`). `pk_join_merge`, `pk_join_seek`, `pk_join_sort_merge`, and
`pk_parent_lookup` place each unmatched driver row in their stated order;
`pk_join_hash` emits unmatched driver rows, in no particular order, after the
matched ones.

A chained join chooses a physical node at each step. In
`users -> sessions -> events`, the first join returns sessions grouped by user.
Merge with `events/session_id` needs session PK order. The next join uses
`pk_join_sort_merge`, `pk_join_hash`, or `pk_join_seek`.

Child-to-parent lookup is a separate node:

```text
pk_parent_lookup(child_node, fk_name, opts)
```

It scans child PKs, reads the FK value from the child's source cursor, probes the
parent table by PK, and returns a PK tuple containing child and parent PKs. It
keeps child order. With `opts.left`, a child whose FK is null or whose parent row
is missing is kept with the parent member absent.

Example:

```lua
pk_parent_lookup(
	limit(
		pk_range('sessions/started_at,user_id', nil, nil, {desc = true}),
		20),
	'sessions/user_id')
```

When the session index contains both `started_at` and `user_id`, the child source
cursor supplies the FK value for the parent lookup. If the child source cursor
does not contain the FK columns, fetch the child row before looking up the parent.

The joins above match a parent PK against a child FK index. The same four
strategies join any two tables on indexed columns `t1.a = t2.b` when the probed
table has an index on the join column(s); the driver supplies the join value (its
PK, its index key via the source cursor, or a fetch); and the two sides share an
encoded key signature -- same column types, widths, sign, direction, and
collation -- so equal values produce equal key bytes. The signature match is what
lets a value from one side seek the index on the other. An FK join is the case
where the join value is the parent PK and the child FK index is built with that
signature, so the match is guaranteed.


## Cursor And Value Nodes

`fetch` turns PK items or PK tuple items into cursor bundles. The bundle keeps the
PK member names as cursor names. PK nodes are enough for filtering, joining,
counting, and sorting by PK. Cursor bundles add row access: following nodes can
read non-PK columns through positioned cursors.

Each cursor bundle keeps the PK and any source cursor supplied by the PK node.
When a following node asks for a column that a source cursor can decode, the
bundle reads it through that cursor -- a covered read. For other columns, the
bundle opens the base table by PK.

Each PK node records whether it preserves source cursors. `pk_sort`, `pk_and`,
`pk_or`, and `pk_except` keep PK bytes and drop source cursors. `pk_hash_filter`
and `pk_and_probe` keep the driver source.

Cursor positioning: a returned cursor bundle stays valid only until the next
`next_fn()` call; the invariant is in `mdbx_query_validators.md`.

Cursor joins consume cursor streams. They run an inner function once per outer
cursor bundle. The inner function receives the outer bundle and returns a node.
The outer bundle stays positioned while the inner node is open.

| Node                                | Inner result   | Returns             |
|-------------------------------------|----------------|---------------------|
| `semi_join(outer, inner)`           | any item       | outer bundle        |
| `anti_join(outer, inner)`           | any item       | outer bundle        |
| `nested_join(outer, inner)`         | cursor bundle  | combined bundle     |

`semi_join` returns the outer cursor bundle when the inner node returns at least
one item. It stops the inner node after the first item.

`anti_join` returns the outer cursor bundle when the inner node returns no items.
It stops the inner node after the first item if one exists.

`nested_join` returns one cursor bundle for each inner cursor bundle. The returned
bundle contains the outer cursors and the inner cursors. Outer order is preserved;
inner order is preserved inside each outer item.

Filter nodes keep input items whose predicate returns true.

| Node                            | Input         | Predicate sees | Returns       |
|---------------------------------|---------------|----------------|---------------|
| `cursor_filter(input, fn)`      | cursor stream | cursor bundle  | cursor bundle |
| `value_filter(input, fn)`       | value stream  | value item     | value item    |

`cursor_filter` preserves input order and duplicate behavior. Its predicate reads
from the current cursor bundle. The bundle stays positioned while the predicate
runs.

`value_filter` preserves input order and duplicate behavior. Its predicate reads
from a decoded value item.

Filter predicates are Lua functions. They keep an item only when they return
true.

`limit(input, n, offset)` returns at most `n` items from the input stream, after
skipping the first `offset` items (`offset` defaults to 0). It preserves input
item type, order, and duplicate behavior.

`select(input, outputs)` consumes cursor bundles and returns value items.

```lua
outputs = {
	{name = 'id', cursor = 'users', column = 'id'},
	{name = 'x', fn = compute_x},
}
```

| Output spec         | Value source                      |
|---------------------|-----------------------------------|
| `cursor` + `column` | read through the cursor bundle    |
| `fn`                | called with the cursor bundle     |

The bundle chooses a covered read or base-table lookup. Value items are keyed by
output name. `select` preserves order and duplicates.

`key_fn(item)` returns a non-empty key array: one part for a single key, more for
a composite key. Use the `null` sentinel for a DB null part; a `nil` part is
invalid; every item from one node returns the same part count. Per-node use of
the parts and the full rules are in `mdbx_query_validators.md`.

`stream_distinct` and `hash_distinct` keep the first item for each key.

| Node                             | Input                  | Order       |
|----------------------------------|------------------------|-------------|
| `stream_distinct(input, key_fn)` | cursor or value stream | input order |
| `hash_distinct(input, key_fn)`   | cursor or value stream | input order |

`stream_distinct` requires equal keys to be adjacent in the input stream.
`hash_distinct` accepts any input order and stores seen keys in memory.

`value_sort(input, key_fn, opts)` consumes a value stream, sorts value items by
key parts, and returns value items. `opts` gives per-part direction (`asc` /
`desc`, default ascending). Duplicate behavior is unchanged.

`group_cursor`, `stream_aggregate`, and `hash_aggregate` group input items by
`key_fn`.

| Node                                   | Input         | Requires    | Returns       |
|----------------------------------------|---------------|-------------|---------------|
| `group_cursor(input, key_fn, opts)`    | cursor stream | group order | cursor bundle |
| `stream_aggregate(input, key_fn, agg)` | cursor stream | group order | value item    |
| `hash_aggregate(input, key_fn, agg)`   | value stream  | memory      | value item    |

`group_cursor` returns one cursor bundle per group. `opts.which` is `first` or
`last` and chooses which row in the group is returned.

`stream_aggregate` returns one value item per group. Equal group keys must be
adjacent in the input stream.

`hash_aggregate` accepts any input order and stores aggregate state in memory.

For `group_cursor`, `stream_aggregate`, and `hash_aggregate`, `key_fn` returns
the group key. Omitting `key_fn` makes one group over all input -- a grand total;
`stream_aggregate` then needs no input order, and `group_cursor` returns the
first or last row overall.

`agg` is an output list, like `select`'s `outputs`, but each entry aggregates
over the group:

```lua
agg = {
	{name = 'n',     op = 'count'},                             -- count(*)
	{name = 'total', op = 'sum',    cursor = 'users', column = 'score'},
	{name = 'hi',    op = 'max',    cursor = 'users', column = 'score'},
	{name = 'names', op = 'concat', cursor = 'users', column = 'name', sep = ','},
	{name = 'k',     op = 'key',    part = 1},                   -- a group-key part
}
```

| op       | Value                                                       |
|----------|-------------------------------------------------------------|
| `count`  | row count; with a column, the non-null count                |
| `sum`    | sum of the column                                           |
| `avg`    | average of the column                                       |
| `min`    | least column value                                          |
| `max`    | greatest column value                                       |
| `concat` | column values joined by `sep` (default `,`), in group order |
| `key`    | group-key part `part`                                       |

`sum`, `avg`, `min`, `max`, and `concat` skip null and absent inputs; `count`
without a column counts every row. `stream_aggregate` reads each input column
through the cursor bundle (`cursor` + `column`, or `fn`); `hash_aggregate` reads
a value-item field (`input = output_name`). The output value shape is the `agg`
names in order.

Union nodes consume value streams.

| Node                         | Input         | Returns     |
|------------------------------|---------------|-------------|
| `union_all(inputs...)`       | value streams | value items |
| `union_distinct(inputs...)`  | value streams | value items |

`union_all` reads each input in argument order and keeps duplicates.

`union_distinct` reads each input in argument order and emits the first item for
each distinct value item. It uses value-item equality and stores seen values in
memory.

`pk_or` is the PK-stream deduped union.


## Per-item Node Opening

Nodes that run another node per input item build a new node instance for each
item. Each node instance gets one `:open()` call.


## Non-goals

Window functions; full outer join; query caching; prepared statements.


## Metadata Helpers

Metadata helpers return scalar values for the caller.

Single-operation helpers use one MDBX stat call, one cursor seek, or one
duplicate count. They do not need maintained query statistics.

| Helper                 | Operation source          | Scope             |
|------------------------|---------------------------|-------------------|
| `pk_exists(table, pk)` | base-table key lookup     | complete PK       |
| `ix_exists(ix, key)`   | index key lookup          | complete key      |
| `ix_count(ix, key)`    | MDBX duplicate count      | complete key      |
| `ix_min(ix, prefix)`   | seek first matching key   | leading prefix    |
| `ix_max(ix, prefix)`   | seek last matching key    | leading prefix    |
| `explain(node)`        | node and schema metadata  | no DB read        |

`ix_count(ix, key)` works only for a complete index key. It uses the MDBX
duplicate count for the cursor positioned on that key.

`ix_min(ix, prefix)` and `ix_max(ix, prefix)` read endpoints. With an empty
prefix, they read the first or last key in the whole index. With a prefix, they
seek to an endpoint and verify that the returned key still has the prefix.

`explain(node)` returns schema and node data: item type, tuple member names,
order, duplicate behavior, source-cursor behavior, and whether the node scans,
seeks, sorts, hashes, or opens base rows.


## Query Builder

A query is a chained, composable expression that lowers to a tree of the
primitive nodes above. Each method returns a new query, so a partial query is a
value you can hold, reuse, and extend, or pass to another as a subquery. Nothing
reads data until a terminal lowers the chain to a node and runs it: `:select` /
`:agg` produce a value stream (iterate with `:rows` or `:first`), while `:count` /
`:exists` return a scalar.

Lowering is a deterministic, pure function of the query and the schema: the same
query over the same indexes always produces the same nodes, and joins keep the
order you wrote (they are never reordered). A plan changes only when you edit the
query or add, drop, or pin an index -- never from data changing underneath you --
so `explain(query)` can be snapshotted and diffed in a test. Hand-built node trees
stay first-class; the builder just writes them for you.

```lua
from'users'
	:eq('status', 'active')
	:join'sessions'
	:order_by'users.id'
	:select{'users.id', 'sessions.started_at'}
```

It lowers to:

```lua
select(
	fetch(
		pk_join_merge(
			pk_seek('users/status', 'active'),  -- driver, in users.id order
			'sessions/user_id')),               -- merge: driver is in join-key order
	{
		{name = 'id',         cursor = 'users',    column = 'id'},
		{name = 'started_at', cursor = 'sessions', column = 'started_at'},
	})
```

`pk_join_merge` is chosen because `pk_seek` returns one index key's PKs in
users.id order, the join key; filter users by a score range instead and the
driver arrives in index order, so the choice becomes `pk_join_seek` or
`pk_join_sort_merge` -- from order alone, not row counts.

Sources and joins:

- `from('table')` or `from('table alias')` roots the query; the member is the
  alias or the table name, and `member.column` references a column downstream.
- `:join('table' [, opts])`, `:inner_join(...)`, and `:left_join(...)` add a table
  reached by an FK from a member already in the query (`:join` is inner); the
  table string may carry an alias (`'sessions s'`). The schema's FK direction
  picks the node: parent-to-child -> a `pk_join_*` node, child-to-parent ->
  `pk_parent_lookup`. For parent-to-child the strategy follows the driver's order
  (an `explain` fact, not a row count): driver already in join-key order ->
  `pk_join_merge`; keep driver order -> `pk_join_seek`; unordered ->
  `pk_join_sort_merge` if a later step needs the order, else `pk_join_hash`.
- join `opts`: `from` names the member to attach to (defaults to the previous
  one), so one table can fan out to several; `on` selects the FK when more than
  one connects the tables; `index` pins the child index; `left = true` is the left
  join (the unmatched member reads as Lua `nil`); `as` also sets the alias.

```lua
from'users u'
	:join('sessions s', {from = 'u'})
	:left_join('events e', {from = 's'})
	:select{'u.id uid', 's.started_at', 'e.kind'}
```

Filters (chained filters are ANDed):

- `:eq` / `:ne` / `:lt` / `:le` / `:gt` / `:ge` `(col, val)` and
  `:between(col, lo, hi)` are the comparisons; `:where(col [, op], val)` is the
  general form (`op` is `=`, `<>`, `<`, `<=`, `>`, `>=`). On an indexed column of
  the access table, `:eq` folds to `pk_seek` / `pk_prefix`, ranges and `:between`
  to `pk_range`, and equality on the full PK to `pk_get`; anything else is a
  residual `cursor_filter` (before `fetch` when covered) or `value_filter`.
- `:is_null(col)` / `:is_not_null(col)` use the null-first key range.
- `:like(col, pattern)` matches SQL `LIKE`; a literal prefix on an indexed column
  (`'foo%'`) folds to a `pk_range`, otherwise it is residual.
- `:in_(col, values | query)` / `:not_in(col, values | query)` test membership in
  a value list or an uncorrelated subquery (the set is built once) -> a
  `pk_hash_filter` `in` / `not_in` (`in` is a Lua keyword, hence `in_`).
- `:where_exists(query)` / `:where_not_exists(query)` test for a matching row. The
  subquery runs once unless it references the outer row -- explicitly, never by
  magic -- with a marker `outer'member.col'` or a closure parameter (see below).
  A correlated subquery lowers to `semi_join` / `anti_join`, run per outer row and
  stopped at the first match.
- `:where_has(table [, fn])` / `:where_hasnt(table [, fn])` are the named form of
  the common case: correlated existence along the FK between the current member
  and `table`, with `fn` filtering the child query. They lower to `semi_join` /
  `anti_join`; `:where_has` with no `fn` can use `fk_parent_scan`.
- `:or_where(col [, op], val)` ORs an alternative, with AND binding tighter (SQL
  precedence); it folds to `pk_or` when the OR is over one indexed column, else
  residual. Use `union` to OR across access paths.
- `:filter(fn)` is an arbitrary Lua predicate -- always residual.
- several indexed predicates on one table use one index (equality preferred over
  range, or the pinned one) with the rest residual; compose `pk_and` / `pk_or`
  nodes directly for a multi-index plan.
- an FK existence test (parents that have a child) can lower to `fk_parent_scan`.

Correlate an existence test explicitly -- a marker for one level, a closure for
clean scope through nesting:

```lua
-- marker: outer'member.col' refers to the enclosing query
from'users u':where_exists(
	from'sessions':eq('user_id', outer'u.id'):gt('started_at', t))

-- closure: o is the enclosing query, so nested EXISTS can each name their level
from'users u':where_exists(function(o)
	return from'sessions':eq('user_id', o'u.id'):gt('started_at', t) end)
```

Matching `u.id` against the FK column still uses the child FK index, so the
correlated form costs the same as an FK existence check -- just written out.

Order, limit, distinct:

- `:order_by(col, ...)` takes `'col'` or `'col desc'` per key; uses index order
  when the access path or a merge join already yields it, else adds `value_sort`.
- `:limit(n)` and `:offset(n)` (or `:limit(n, offset)`) cap the result; a limit is
  pushed into the driving scan when that scan already yields the requested order.
- `:distinct(cols)` lowers to `stream_distinct` (input already grouped) or
  `hash_distinct`.

Grouping and aggregation:

- `:group_by(cols)` with `:agg{...}` lowers to `group_cursor`, `stream_aggregate`,
  or `hash_aggregate` (see `agg`, above); `:agg{...}` with no `:group_by` is a
  grand total. `:having(col [, op], val)` or `:having(fn)` filters grouped rows
  with a `value_filter` after the aggregate.

```lua
from'users'
	:group_by'status'
	:agg{
		{name = 'n',   op = 'count'},
		{name = 'avg', op = 'avg', col = 'score'},
	}
```

Projection:

- `:select{outputs}` returns a value stream; an output is `'member.column'`, or
  `'member.column alias'` (also `... as alias`) to rename, or `{name=, fn=}` for a
  computed value (`fn` gets the cursor bundle). PK and cursor streams flow through
  filters and joins unchanged; `:select` lowers to a `fetch` of just the needed
  columns, as late as possible, plus `select`.
- `:agg{...}` returns the aggregate value stream (see Grouping).

Set operations:

- `union{q, ...}` / `union_all{q, ...}` combine value queries of the same shape
  -> `union_distinct` / `union_all`. Intersection and difference are PK
  operations: compose `pk_and` / `pk_except`, or filter with `:in_` / `:not_in`.

```lua
union{
	from'users':eq('status', 'active'):select{'users.id', 'users.score'},
	from'users':ge('score', 90)      :select{'users.id', 'users.score'},
}
```

Control:

- `:use_index(member, ix)` forces an index; `:no_index(member [, ix])` forbids one
  or all.
- `:use_counts()` lets lowering break the seek-versus-scan and drive-side ties
  with MDBX's free counts (table and index entry counts, exact-key counts); no
  histograms or maintained statistics. Off by default, so a plan stays a pure
  function of query and schema unless you ask.

Terminals:

- `:rows()` iterates the value items; `:first()` returns the first item or `nil`;
  `:count()` returns a row count (`ix_count` or a table entry count when exact,
  else a `count` aggregate); `:exists()` returns whether any row matches.
- `explain(query)` lowers the chain and reports the nodes without reading data.
