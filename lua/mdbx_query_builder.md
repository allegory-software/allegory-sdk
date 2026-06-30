
# MDBX QUERY BUILDER

A composable expression that lowers to a tree of the nodes above. Same query +
same schema always produces the same nodes; join order is preserved as written.
Plan changes only when you change the query or the indexes, never from data.
Lower with `:_lower()` and call `node:explain()` to get a plan tree for
snapshotting or diffing in tests. Hand-built node trees are fully supported;
the builder just writes them for you.

	db:from('table' | 'table alias')
	  start query; member name = alias or table name

	:join('table' [, opts])  inner join along an FK from an existing member
	:inner_join(...), :left_join(...)     explicit inner / left
	opts: from=member, on=fk, index=ix, left=bool, as=alias

	:nested_join(fn)  correlated join; fn(outer_node) -> query;
	  one output item per inner item

FK direction for `:join` determines the node: parent->child -> `pk_join_*` or
`merge_join`; child->parent -> `pk_parent_lookup`. For parent-to-child, strategy
chosen from driver order: already in parent-PK order ->
`merge_join(driver, pk_range(fk))`; keep driver order -> `pk_join_seek`;
unordered -> `pk_join_hash` or `merge_join(pk_sort(driver), pk_range(fk))`.

`:nested_join` lowers to `nested_join(driver, fn)`. Use for correlated multi-row
joins that are not FK traversals handled by `:join`. Member names returned by
the inner query must not overlap existing members. `pk_project` is used
internally by the builder to flatten a PK tuple stream to a single member when
feeding a subsequent join or merge; it is not directly exposed.

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
	:where(col [,op], val)              op: ==, ~=, <, <=, >, >=
	:is_null(col) / :is_not_null(col)   null-first key range
	:starts(col, prefix)  prefix match; folds to pk_range on indexed col
	:in_(col, values|query)             pk_hash_filter 'in'  (in is a Lua keyword)
	:not_in(col, values|query)          pk_hash_filter 'not_in'
	:where_exists(query|fn)  semi_join (correlated) or run-once (uncorrelated)
	:where_not_exists(query|fn)         anti_join
	:where_has(table [,fn])  FK existence;
	  no fn -> fk_parent_scan; with fn -> semi_join
	:where_hasnt(table [,fn])  FK non-existence;
	  no fn -> merge_except + fk_parent_scan; with fn -> anti_join
	:or_where(col [,op], val)  OR (AND binds tighter);
	  folds to merge_union on indexed col
	:filter(fn)                         arbitrary Lua predicate; always residual

On indexed columns of the access table: `:eq` folds to `pk_seek`/`pk_prefix`,
ranges to `pk_range`, full PK equality to `pk_get`. Multiple indexed predicates
use one index (equality preferred, or pinned); the rest are residual
`pk_filter`.

Correlate an existence test explicitly -- never by column-name matching:

	-- marker: outer'member.col' refers to the enclosing query's current row
	db:from'users u':where_exists(
		db:from'sessions':eq('user_id', outer'u.id'):gt('started_at', t))

	-- closure: o is the enclosing query; use for clean scope across nesting
	db:from'users u':where_exists(function(o)
		return db:from'sessions':eq('user_id', o'u.id'):gt('started_at', t) end)

ORDER / LIMIT / DISTINCT:

	:order_by(col, ...)  'col' or 'col desc'; uses existing index order
	  when possible, else value_sort
	:limit(n) / :offset(n)  pushed into driving scan when it already
	  yields the needed order
	:distinct(cols)         stream_distinct (input grouped) or hash_distinct

When `:order_by` + `:limit` is present and driver order must be preserved,
equality filters on secondary indexed columns lower to `pk_and_probe` rather
than `pk_hash_filter`. `pk_and_probe` tests each driver row via GET_BOTH
(O(1) memory) and lets `:limit` stop the scan early; `pk_hash_filter` would
materialise the full filter set before any rows are returned.

GROUP / AGGREGATE:

	:group_by(cols)  with :agg{...} -> pk_group / stream_aggregate / hash_aggregate
	:agg{...}                    without :group_by -> grand total
	:having(col [,op], val|fn)   value_filter after aggregate

When the `:group_by` columns exactly match all key columns of an index
(in order), no filter has narrowed the scan, and `:agg{}` is empty, the builder
lowers to `pk_group_first(ix) + stream_aggregate` instead of
`pk_group(pk_range(ix)) + stream_aggregate`. This visits O(n groups) rows
rather than O(n rows).

PROJECTION:

	:select{outputs}  -> value stream; 'member.col', 'member.col alias',
	  or {name=,fn=}
	:agg{...}          -> value stream

SET OPERATIONS:

	union{q,...}       union_distinct over value queries with the same fields
	union_all{q,...}   union_all

CONTROL:

	:use_index(member, ix)    force index
	:no_index(member [,ix])   forbid index (all if ix omitted)
	:use_counts()  let lowering use MDBX entry counts to break ties
	  (default off; keeps plan as pure function of query+schema when off)

TERMINALS:

	:rows()    iterate value records
	:first()   first value record or nil
	:count()   row count (exact via ix_count or table stat when possible,
	  else count aggregate)
	:exists()  true if any row matches
