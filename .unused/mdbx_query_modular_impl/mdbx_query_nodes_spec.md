# Validation facts and metadata.

The normative reference for `mdbx_query_nodes.md` -- per-node metadata and
validation rules.

Terminology:

- `order key`: one component of physical stream order, e.g. `users.pk asc`
  or `users.score asc`.
- `order`: a list of order keys. Example: `score asc, pk asc`.
- `tuple member name`: name used to identify one carried PK in a PK tuple item.
- `PK member`: one primary-key value in an item, tied to a tuple member name.
- `value shape`: ordered output-name list for a value stream.
- `key array`: ordered list of values returned by `key_fn`.

## Not Yet Implemented

`pk_join_merge` and `pk_join_sort_merge` are documented here but are not
implemented; deferred until a concrete case needs them.

## Order Metadata

`pk-order` and `ix-order` are useful names, but node metadata should record the
actual physical order: which keys, in which directions.

Nodes check order by prefix: actual order satisfies a required order when
the required order is a leading prefix of the actual order, after dropping
constant keys.

| Stream                         | Raw order                      | Effective order      |
|--------------------------------|--------------------------------|----------------------|
| `pk_get(users,7)`              | `users.pk asc`                 | `users.pk asc`       |
| `pk_seek(users/status,active)` | `status const, pk asc`         | `pk asc`             |
| `range users/status,{a},{z}`   | `status asc, pk asc`           | `status asc, pk asc` |
| `range sessions/user,time`     | `user const, time asc, pk asc` | `time asc, pk asc`   |
| `desc sessions/started_at`     | `started_at desc, pk desc`     | same                 |
| `mixed index a asc,b desc`     | `a asc, b desc, pk asc`        | same                 |
| `merge join users,sessions`    | `users.pk asc, sess.pk asc`    | same                 |

Order checks (facts not already itemized per-node in Validators below):

| Node/op                      | Required order                       |
|------------------------------|--------------------------------------|
| `merge_union`,`merge_except` | Single PK member ascending.          |
| merge join                   | Both sides ordered by the join keys. |
| `ORDER BY ... LIMIT`         | Requested order is an order prefix.  |
| `pk_join_sort_merge`         | Any driver order accepted.           |

Notes:

- A point equality makes that key constant, so it is removed from effective
  order. That is why `pk_seek(users/status, active)` is effectively PK-ordered.
- `(status asc, pk asc)` satisfies `ORDER BY status`. `ORDER BY pk` needs
  `pk asc`.
- A composite index can satisfy ordering by a suffix only when all earlier keys
  are constants.
- A backward scan reverses the whole order. Mixed direction like `a asc, b desc`
  needs mixed-direction index encoding.
- Validators check prefix compatibility directly.

## Value Item Metadata

Value-stream metadata records the value shape.

| Fact                     | Rule                                     |
|--------------------------|------------------------------------------|
| compatible value streams | Same output names in the same order.     |
| value item equality      | Compare values by output name and order. |
| DB null output value     | Use the `null` sentinel.                 |
| Lua `nil` output value   | Means the output name is absent.         |

## Key Function Rules

`key_fn` rules:

| Case               | Rule                                      |
|--------------------|-------------------------------------------|
| key array          | Non-empty.                                |
| same node          | Same key-part count for every item.       |
| DB null            | Use `null` as the key part.               |
| missing part       | `nil` is invalid.                         |
| `hash_distinct`    | Compare key parts.                        |
| `stream_distinct`  | Compare key parts; input ordered by key.  |
| `hash_aggregate`   | Group by key parts.                       |
| `pk_group`         | Group by key parts; input ordered by key. |
| `stream_aggregate` | Group by key parts; input ordered by key. |
| `value_sort`       | Sort by key parts.                        |

`pk_group`, `stream_aggregate`, and `hash_aggregate` accept no `key_fn`,
meaning a single group over all input; the rules above then apply only when
`key_fn` is given.

## Duplicate Metadata

Stream metadata records whether duplicates are possible.

| Stream or node               | Duplicate fact                            |
|------------------------------|-------------------------------------------|
| PK leaf scan                 | Unique by table PK.                       |
| `merge_union`,`merge_except` | Unique by table PK.                       |
| `pk_sort`                    | Unique by table PK.                       |
| `pk_and_probe`               | Inherits driver uniqueness.               |
| `pk_hash_filter`             | Inherits driver uniqueness.               |
| `pk_project`                 | Inherits projected member fact.           |
| parent-to-child join         | Tuple stream; PK members may repeat.      |
| `semi_join`                  | Inherits outer duplicate fact.            |
| `anti_join`                  | Inherits outer duplicate fact.            |
| `nested_join`                | Outer duplicates multiply by inner items. |
| `pk_filter`                  | Inherits input duplicate fact.            |
| `value_filter`               | Inherits input duplicate fact.            |
| `limit`                      | Inherits input duplicate fact.            |
| `select`                     | Inherits input duplicate fact.            |
| `value_sort`                 | Inherits input duplicate fact.            |
| `stream_distinct`            | Unique by the distinct key.               |
| `hash_distinct`              | Unique by the distinct key.               |
| value `value_concat`         | Duplicates kept.                          |
| value `union_distinct`       | Unique by full value item.                |
| `pk_group`                   | One cursor bundle per group key.          |
| `stream_aggregate`           | One value item per group key.             |
| `hash_aggregate`             | One value item per group key.             |

Notes:

- `merge_union` and `merge_except` require unique PK streams.
- Joins can repeat parent PKs. A user with three sessions yields three tuples.
- A simple parent-to-child chain can still be unique on the child PK member.
- Sibling to-many joins can repeat multiple PK members through cross product.
- PK tuple streams record uniqueness per PK member.
- Validators check the projected member when `pk_project` feeds a PK set op.
- Use `value_concat` for append semantics. Reserve `union_distinct` for dedupe.

## Cursor Join Metadata

These facts are derived from node inputs.

| Node          | Order                         | Output names              |
|---------------|-------------------------------|---------------------------|
| `semi_join`   | outer order                   | outer names               |
| `anti_join`   | outer order                   | outer names               |
| `nested_join` | outer order, then inner order | outer names + inner names |

## Filter Metadata

These facts are derived from node inputs.

| Node           | Order       | Output names |
|----------------|-------------|--------------|
| `pk_filter`    | input order | input names  |
| `value_filter` | input order | input names  |

## Cursor And Value Order Metadata

These facts are derived from node inputs.

| Node                              | Order            | Output names |
|-----------------------------------|------------------|--------------|
| `value_sort(input, key_fn, opts)` | sort key order   | input names  |
| `select(input, outputs)`          | input order      | output names |
| `stream_distinct(input, key_fn)`  | input order      | input names  |
| `hash_distinct(input, key_fn)`    | first-seen order | input names  |
| `value_concat(inputs...)`         | argument order   | input names  |
| `union_distinct(inputs...)`       | first-seen order | input names  |
| `pk_group(input, key_fn)`         | group key order  | input names  |
| `stream_aggregate(input, key_fn)` | group key order  | agg output   |
| `hash_aggregate(input, key_fn)`   | unspecified      | agg output   |

## Derived Facts By PK Node

These are derived from node inputs and schema resolution.

| Node                                | PK members   | Order           |
|-------------------------------------|--------------|-----------------|
| `pk_get(table, pk...)`              | table        | `pk asc`        |
| `pk_range(table)`                   | table        | `pk asc`        |
| `pk_seek(ix, key...)`               | table        | `pk asc`        |
| `pk_prefix(ix, prefix...)`          | table        | `ix, pk`        |
| `pk_range(ix, opts, op, params...)` | table        | `ix, pk`        |
| `fk_parent_scan(ix)`                | parent       | `parent.pk asc` |
| `merge_union(a, b)`                 | same         | `pk asc`        |
| `merge_except(a, b)`                | left         | `pk asc`        |
| `pk_sort(node)`                     | same         | `pk asc`        |
| `pk_project(tuple, member)`         | member       | member order    |
| `pk_and_probe(driver, probes...)`   | driver       | driver order    |
| `pk_hash_filter(driver, set, m)`    | driver       | driver order    |
| `pk_parent_lookup(child, fk)`       | child+parent | child order     |
| `pk_join_merge(driver, fk)`         | tuple        | FK index order  |
| `pk_join_seek(driver, fk)`          | tuple        | driver order    |
| `pk_join_sort_merge(driver, fk)`    | tuple        | FK index order  |

| Node                                | Unique | Source            |
|-------------------------------------|--------|-------------------|
| `pk_get(table, pk...)`              | yes    | PK bytes          |
| `pk_range(table)`                   | yes    | PK bytes          |
| `pk_seek(ix, key...)`               | yes    | index cursor      |
| `pk_prefix(ix, prefix...)`          | yes    | index cursor      |
| `pk_range(ix, opts, op, params...)` | yes    | index cursor      |
| `fk_parent_scan(ix)`                | yes    | PK bytes          |
| `merge_union(a, b)`                 | yes    | PK bytes          |
| `merge_except(a, b)`                | yes    | PK bytes          |
| `pk_sort(node)`                     | yes    | PK bytes          |
| `pk_project(tuple, member)`         | member | member source     |
| `pk_and_probe(driver, probes...)`   | driver | driver source     |
| `pk_hash_filter(driver, set, m)`    | driver | driver source     |
| `pk_parent_lookup(child, fk)`       | varies | child source      |
| `pk_join_merge(driver, fk)`         | varies | driver + child ix |
| `pk_join_seek(driver, fk)`          | varies | driver + child ix |
| `pk_join_sort_merge(driver, fk)`    | varies | child ix          |

Notes:

- `table` means one PK member for the base table addressed by the node.
- `parent` means one PK member for the referenced parent table.
- `same` means the single input PK member is preserved.
- `left` means the left input PK member is preserved.
- `child+parent` means child and parent PK members.
- `tuple` means multiple PK members.
- `member` means the projected PK member.
- `member order` means the order facts for the projected PK member.
- `member source` means the source cursor facts for the projected PK member.
- `ix, pk` means index-key order, with PK order inside each duplicate run.
- `FK index order` means parent PK order, with child PK order inside each
  parent.
- `Source` says what a cursor bundle can read before opening the base table.
- `PK bytes` means only the PK is preserved; non-PK reads open the base table.
- `index cursor` lets `fetch` use cursor schema to decode covered columns.
- `driver source` means the driver's source cursor facts are preserved.
- `child source` means the child source cursor facts are preserved.
- `child ix` means the child FK index cursor is preserved for child columns in
  that index.
- `merge_union`, `merge_except`, `pk_sort`, and `pk_join_sort_merge` drop driver
  source cursors.
- A left join (`opts.left`) emits unmatched driver rows in the node's stated
  order.

## Validators

Non-obvious, node-specific facts only -- generic type/shape checks (e.g. a
callback must be a function, a name must resolve in schema) are omitted; see
Key Function Rules above for the shared `key_fn` rules.

| Node/op                      | Validation                                           |
|------------------------------|------------------------------------------------------|
| `pk_get`                     | Values encode a complete table PK.                   |
| `pk_seek`                    | Values encode a complete index key.                  |
| `pk_prefix`                  | Prefix length is 1..key-column-count - 1.            |
| `pk_prefix`                  | Prefix values encode against leading key cols.       |
| `pk_range`                   | Bounds are op plus scalar param names.               |
| `pk_range`                   | Bound width is fixed prefix plus range column.       |
| `pk_range`                   | Empty bounds are rejected.                           |
| `pk_range`                   | Param values encode against the index key.           |
| `pk_range`                   | `>` is an open lower bound.                          |
| `pk_range`                   | `<` is an open upper bound.                          |
| `pk_range`                   | Encoded `lo > hi` is rejected.                       |
| `pk_range`                   | Equal open bounds are rejected.                      |
| `pk_range`                   | `opts.desc` is represented in `order`.               |
| `fk_parent_scan`             | Index resolves as an FK index.                       |
| `fk_parent_scan`             | FK references the full parent PK.                    |
| `fk_parent_scan`             | Nullable FK-key behavior is fixed.                   |
| `merge_union`,`merge_except` | Inputs have one PK member each.                      |
| `merge_union`,`merge_except` | Input PK members refer to the same table.            |
| `merge_union`,`merge_except` | Inputs are PK ordered from start to end.             |
| `merge_union`,`merge_except` | Inputs are unique on that PK.                        |
| `merge_union`                | Equal PKs are emitted once.                          |
| `merge_except`               | Output keeps left-side PK order.                     |
| `pk_sort`                    | Input has one PK member.                             |
| `pk_project`                 | Input is a PK tuple stream.                          |
| `pk_project`                 | Requested tuple member name exists in tuple.         |
| `pk_and_probe`               | Driver has the tested member.                        |
| `pk_and_probe`               | Every probe is a point predicate on driver.          |
| `pk_and_probe`               | Range probes are rejected.                           |
| `pk_hash_filter`             | Driver has the tested member.                        |
| `pk_hash_filter`             | Set source has one PK member for same table.         |
| `pk_hash_filter`             | Mode is `in` or `not_in`.                            |
| `value_concat`               | Input streams have the same value shape.             |
| `union_distinct`             | Input streams have the same value shape.             |
| `pk_parent_lookup`           | Driver has the child member.                         |
| `pk_parent_lookup`           | FK resolves from the child table.                    |
| `pk_parent_lookup`           | Child source cursor can decode all FK columns.       |
| `pk_parent_lookup`           | Parent tuple member name is unused.                  |
| `pk_parent_lookup`           | `opts.left` keeps null-FK/missing-parent rows.       |
| parent-to-child join         | Driver has the parent PK member.                     |
| parent-to-child join         | Child tuple member name is unused.                   |
| parent-to-child join         | FK resolves to a child-side index.                   |
| parent-to-child join         | `opts.left` keeps drivers with no child.             |
| `pk_join_merge`              | Driver is ordered by parent PK ascending.            |
| `pk_join_seek`               | Any driver order accepted.                           |
| `pk_join_sort_merge`         | Sort key is the driver parent PK.                    |
| chained parent-child joins   | SQL join-order semantics apply.                      |
| cursor joins                 | Inner function returns a node per outer bundle.      |
| cursor joins                 | Inner node instance is opened once.                  |
| cursor joins                 | Outer bundle remains current while inner runs.       |
| `semi_join`                  | Output keeps outer order and duplicates.             |
| `anti_join`                  | Output keeps outer order and duplicates.             |
| `nested_join`                | Inner node returns cursor bundles.                   |
| `nested_join`                | Inner names do not duplicate outer names.            |
| `pk_filter`                  | Bundle remains current while predicate runs.         |
| `pk_filter`                  | Output keeps input order and duplicates.             |
| `value_filter`               | Output keeps input order and duplicates.             |
| `limit`                      | `n` is an integer >= 0.                              |
| `limit`                      | `offset` is an integer >= 0 (default 0).             |
| `limit`                      | Output keeps input type, order, and duplicates.      |
| `select`                     | Output names are unique.                             |
| `select`                     | Output list defines the value shape.                 |
| `select`                     | Column outputs resolve to cursor and column.         |
| `stream_distinct`            | Input is a cursor or value stream.                   |
| `hash_distinct`              | Input is a cursor or value stream.                   |
| `stream_distinct`            | Output keeps input item type.                        |
| `hash_distinct`              | Output keeps input item type.                        |
| `stream_distinct`            | Input is ordered by distinct key.                    |
| `value_sort`                 | Key parts can be sorted.                             |
| `value_sort`                 | Output is sorted by key parts.                       |
| `pk_group`                   | Input is ordered by group key.                       |
| `pk_group`                   | `opts.which` is `first` or `last`.                   |
| `stream_aggregate`           | Input is ordered by group key.                       |
| `stream_aggregate`           | `agg` is a list of aggregate output specs.           |
| `hash_aggregate`             | `agg` is a list of aggregate output specs.           |
| `stream_aggregate`           | Ops: `count`/`sum`/`avg`/`min`/`max`/`concat`/`key`. |
| `hash_aggregate`             | Ops: `count`/`sum`/`avg`/`min`/`max`/`concat`/`key`. |
| `stream_aggregate`           | Column source is cursor + column or `fn`.            |
| `hash_aggregate`             | Column source is a value-item field (`input`).       |
| `explain`                    | Reports item type and tuple member names.            |
| `explain`                    | Reports order and duplicate behavior.                |
| `explain`                    | Reports source-cursor behavior.                      |
| `explain`                    | Reports work, not row-count estimates.               |

Notes:

- `merge_union`, `merge_except`, and `pk_join_merge` are the merge nodes (they
  walk sorted inputs in lockstep).
- `same table` means the same schema table object.
- Schema resolution provides table/index/FK objects, encoders, comparators,
  child and parent tables, nullable FK columns, and index duplicate layout.
- Extra trailing FK-index columns are handled by using the FK prefix.

## Composite Index Rules

| Concern                   | Rule                                      |
|---------------------------|-------------------------------------------|
| full equality             | `pk_seek` requires all index key columns. |
| equality prefix           | Use `pk_prefix`.                          |
| range suffix              | Use `pk_range` with `n_fixed_params`.     |
| range bound               | One scalar param per fixed/range column.  |
| open-ended whole bound    | Omit the low/high bound.                  |
| DB null in bound          | Use the DB `null` sentinel.               |
| open lower bound          | Use the `>` op.                           |
| open upper bound          | Use the `<` op.                           |
| `IS NOT NULL`             | Use `col > null` with null-first keys.    |
| composite `IS NOT NULL`   | Tested col is first key col not fixed.    |
| FK prefix in wider index  | `fk_parent_scan` uses the FK prefix.      |
| mixed directions          | Order comes from schema key encoding.     |
| `ORDER BY a` from `(a,b)` | Valid when `a` is an order prefix.        |
| `ORDER BY b` from `(a,b)` | Valid only when `a` is constant.          |

Notes:

- Fixed leading range columns are declared with `opts.n_fixed_params`; use the
  DB null sentinel for DB NULL in any param value.
- An array-valued column is still one scalar param value.
- Order validation uses effective order after dropping constant leading keys.

# Cursor positioning invariant

Any cursor or value backing a returned cursor bundle must still describe the
yielded item until the next `node:next()` call. If a covered read exposes an
index cursor, `fetch` cannot advance it before returning the bundle.

# Tuple Member Names

A PK tuple has one tuple member name for each carried PK. A table that appears
once uses its table name. Self-joins, joining the same table twice, and multiple
FK uses require caller-supplied names.
