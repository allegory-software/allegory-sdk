--[[

	mdbx_query: composable query pipeline for mdbx_schema.
	Written by Cosmin Apreutsei. Public Domain.

Composable query pipeline over indexes. Two levels:
	- PK STREAM -- yields raw PKs (sorted); operates on index B-trees directly.
	- ROW STREAM -- yields live cursor bundles {[table_name]=cur, ...}.
fetch() bridges the two levels. Compose freely within a level; crossing
levels always requires an explicit fetch().

This API extends the API in mdbx_schema.lua so start there.

PK STREAM
	db:pk_seek   (ix_name, key_vals...)    -> pk_node   exact index key; one key's dup list
	db:pk_get    (table_name, pk_vals...)  -> pk_node   direct base-table lookup; 0 or 1 PKs
	db:pk_range  (ix_name, lo, hi, [opts]) -> pk_node   index key range; nil = unbounded; lo/hi may be {f1,...} for composite; opts={lo_ex,hi_ex}
	a:pk_and     (b)                       -> pk_node   sorted merge intersection (AND)
	a:pk_or      (b)                       -> pk_node   sorted merge union, deduped (OR)
	a:pk_except  (b)                       -> pk_node   difference: PKs in a absent from b (NOT IN)
	pk_node:fetch()                        -> row_node  bridge to row stream; opens base-table cursor
	pk_node:iter()                         -> iter()->pk_str
	pk_node:any()                          -> bool

ROW STREAM
	db:seq_scan          (table_name)      -> row_node  full table walk; no index required
	db:merge_join        (name|cur, ...)   -> row_node  composable each_join; db.left() marks optional sides
	row_node:filter      (pred)            -> row_node  skip rows where pred(bundle) is false
	row_node:limit       (n)               -> row_node  stop after n rows
	row_node:distinct    ()                -> row_node  skip consecutive dup PKs; sorted input required
	row_node:except      (b, key_fn)       -> row_node  sorted merge set difference; sorted input required
	row_node:union       (row_node)        -> row_node  drain a then b; no dedup
	row_node:semi_join   (inner_fn)        -> row_node  keep outer rows where inner non-empty (EXISTS)
	row_node:anti_join   (inner_fn)        -> row_node  keep outer rows where inner empty (NOT EXISTS)
	row_node:nested_join (inner_fn)        -> row_node  for each outer row yield all inner rows
	row_node:aggregate   (key_fn, fns)     -> row_node  streaming group-by; input must be sorted by key
	row_node:iter()                        -> iter()->bundle
	row_node:any()                         -> bool

inner_fn: function(outer_bundle) -> node    called once per outer row; returns a fresh node
key_fn:   function(bundle) -> key           group key extractor for aggregate; equal consecutive keys form a group
fns:      {name = function(bundle, acc) -> new_acc}    acc starts as nil
aggregate output: {_key=group_key, name=acc, ...}      plain table, not a live bundle

Both pk_seek and pk_range require ix_name = 'table/col1[,col2,...]' (index name format).
All pk_* nodes must operate on the same table; fetch() then resolves PKs to base-table rows.

]]

--PK-LEVEL QUERY NODES -------------------------------------------------------

--[[
A pk_node yields a sorted sequence of raw base-table PK bytes.
Fields: table_name, key_gt, key_eq, _pk, _pk_sz (current PK), _done, _db.

_pk/_pk_sz are raw mdbx-managed pointers. They are valid only while the
underlying index cursor is positioned there -- i.e. from the moment a node
sets them until the next _advance() or _seek_ge() on that node. Callers must
use them before advancing. fetch() exploits this by calling find_raw BEFORE
pk_node:_advance() on each iteration.

Internal ops: _advance(), _seek_ge(v, v_sz) -- both update _pk/_pk_sz/_done.
External ops: :pk_and(b), :pk_or(b), :pk_except(b), :fetch(), :iter(), :close().

Why _seek_ge is required (not just sequential _advance):
  pk_and's merge algorithm seeks the lagging cursor to the leader's PK in one
  jump. Without it, pk_and degrades from O(k1+k2) to O(k1*k2) for sparse
  intersection results. PkSeek implements _seek_ge via find_dup_ge_raw();
  composite nodes delegate to their children. The base PkNode:_seek_ge is a
  sequential fallback for subclasses that cannot seek directly.

All pk_nodes yield PKs in strictly sorted ascending order (seek walks dup
values in key order; intersection, union, difference all preserve this).

fetch() is a bridge to row bundles: {[table_name]=cur}. The same bundle
table is reused each iteration; callers must consume before calling next.
fetch() always opens a separate base-table cursor (NEVER shares an index
cursor from PkSeek) because the index DBI and base-table DBI are separate
B-trees; index cursors decode only indexed cols + PK, not the full row.
]]

if not ... then require'mdbx_query_test'; return end
require'mdbx_schema'

local Db = mdbx_db
local encode_key = mdbx_encode_key
local key_rec_buffer = mdbx_key_rec_buffer
local MDBX_MAX_KEY_SIZE = MDBX_MAX_KEY_SIZE

local PkNode = {}
local PkSeek, PkGetNode, PkAnd, PkOr, PkExcept, FetchNode, SeqScanNode, FilterNode,
	AntiJoinNode, LimitNode, SemiJoinNode, UnionNode, NestedJoinNode, IxRangeNode,
	AggregateNode, DistinctNode, MergeJoinNode, ExceptNode --fw. decl.

function PkNode:_advance() end

function PkNode:_seek_ge(v, v_sz)
	while not self._done and self.key_gt(v, v_sz, self._pk, self._pk_sz) do
		self:_advance()
	end
end

function PkNode:close() end

function PkNode:any()
	return not self._done
end

function PkNode:iter()
	return function()
		if self._done then return end
		local s = str(self._pk, self._pk_sz)
		self:_advance()
		return s
	end
end

function PkNode:pk_and(b)
	assertf(inherits(b, PkNode), 'pk_and: b must be a pk_node (call :fetch() before row-level ops)')
	assertf(self.table_name == b.table_name,
		'pk_and: table mismatch: %s vs %s', self.table_name, b.table_name)
	local node = object(PkAnd, {
		table_name = self.table_name,
		key_gt = self.key_gt, key_eq = self.key_eq,
		_db = self._db, _a = self, _b = b,
		_pk = nil, _pk_sz = nil, _done = false,
	})
	node:_converge()
	return node
end

function PkNode:pk_or(b)
	assertf(inherits(b, PkNode), 'pk_or: b must be a pk_node (call :fetch() before row-level ops)')
	assertf(self.table_name == b.table_name,
		'pk_or: table mismatch: %s vs %s', self.table_name, b.table_name)
	local node = object(PkOr, {
		table_name = self.table_name,
		key_gt = self.key_gt, key_eq = self.key_eq,
		_db = self._db, _a = self, _b = b,
		_pk = nil, _pk_sz = nil, _which = nil, _done = false,
	})
	node:_set_min()
	return node
end

function PkNode:pk_except(b)
	assertf(inherits(b, PkNode), 'pk_except: b must be a pk_node (call :fetch() before row-level ops)')
	assertf(self.table_name == b.table_name,
		'pk_except: table mismatch: %s vs %s', self.table_name, b.table_name)
	local node = object(PkExcept, {
		table_name = self.table_name,
		key_gt = self.key_gt, key_eq = self.key_eq,
		_db = self._db, _a = self, _b = b,
		_pk = nil, _pk_sz = nil, _done = false,
	})
	node:_find_next()
	return node
end

function PkNode:fetch()
	assertf(self.table_name, 'fetch: pk_node has no table_name')
	return object(FetchNode, {_pk_node = self})
end

-- PkSeek: positions on one index key and walks its dup values (PKs) ----------
-- Seeks the DUPSORT index cursor to an exact key; MDBX_NEXT_DUP walks its
-- dup list in sorted order. _seek_ge uses MDBX_GET_BOTH_RANGE to jump to
-- the first dup >= target in O(log n), keeping pk_and at O(k1+k2) total.
--
-- Example: db:pk_seek('t/status', 'active')
--   -> PK stream of all rows where status = 'active'

PkSeek = object(PkNode)

function Db:pk_seek(ix_name, ...)
	local dbi, ix_schema = self:dbi_schema(ix_name)
	assertf(ix_schema.is_index, 'pk_seek: not an index: %s', ix_name)
	local vs = ix_schema.val_schema
	local node = object(PkSeek, {
		table_name = ix_schema.val_table,
		key_gt = vs.key_gt, key_eq = vs.key_eq,
		_db = self,
		_ix_key = nil, _cur = nil,
		_pk = nil, _pk_sz = nil, _done = true,
	})
	local xk, xk_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local xk_sz = encode_key(self, ix_schema, 'pk_seek', nil,
		xk, xk_buf_sz, ix_schema.key_cols, nil, ...)
	local cur = self:cursor_raw(dbi)
	cur.schema = ix_schema
	local ok, v, v_sz = cur:find_raw(xk, xk_sz)
	if ok then
		node._ix_key = str(xk, xk_sz)
		node._cur = cur
		node._pk = v; node._pk_sz = v_sz
		node._done = false
	else
		cur:close()
	end
	return node
end

function PkSeek:_advance()
	local ok, _, _, v, v_sz = self._cur:move_raw(C.MDBX_NEXT_DUP)
	if ok then
		self._pk = v; self._pk_sz = v_sz
	else
		self._cur:close(); self._cur = nil; self._done = true
	end
end

function PkSeek:_seek_ge(v, v_sz)
	-- MDBX_GET_BOTH_RANGE: within the fixed ix_key, seek to first dup >= v.
	-- This is the O(log n) skip that keeps pk_and at O(k1+k2) total.
	local ok, rv, rv_sz = self._cur:find_dup_ge_raw(self._ix_key, #self._ix_key, v, v_sz)
	if ok then
		self._pk = rv; self._pk_sz = rv_sz
	else
		self._cur:close(); self._cur = nil; self._done = true
	end
end

function PkSeek:close()
	if self._cur then self._cur:close(); self._cur = nil end
end

-- PkGetNode: 0-or-1 PK stream from a direct base-table key lookup -----------
-- Checks whether a row with the given PK exists; yields that PK once if so.
-- Unlike PkSeek (DUPSORT secondary index), this hits the base table directly
-- at the same cost as db:find. :fetch() after pk_get re-seeks by the same PK;
-- fusion with fetch is a future optimization.
--
-- Example: db:pk_get('t', 42):pk_and(db:pk_seek('t/status', 'active'))
--   -> PK 42 only if it exists AND has status='active'

PkGetNode = object(PkNode)

function Db:pk_get(table_name, ...)
	local dbi, schema = self:dbi_schema(table_name)
	assertf(not schema.is_index, 'pk_get: %s is an index, use pk_seek', table_name)
	local node = object(PkGetNode, {
		table_name = table_name,
		key_gt = schema.key_gt, key_eq = schema.key_eq,
		_db = self,
		_pk_buf = nil, _pk = nil, _pk_sz = 0, _done = true,
	})
	local k, k_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local k_sz = encode_key(self, schema, 'pk_get', nil,
		k, k_buf_sz, schema.key_cols, nil, ...)
	local ok = self:find_raw(dbi, k, k_sz)
	if ok then
		local buf = new('uint8_t[?]', k_sz)
		copy(buf, k, k_sz)
		node._pk_buf = buf
		node._pk    = buf
		node._pk_sz = k_sz
		node._done  = false
	end
	return node
end

function PkGetNode:_advance()
	self._done = true
end

-- IxRangeNode: walks a contiguous slice of index keys -------------------------
-- Like PkSeek but spans multiple keys: yields all PKs where the indexed value
-- falls in [lo, hi] (both inclusive; either bound nil for open-ended).
-- _advance uses MDBX_NEXT_DUP within a key; on dup exhaustion MDBX_NEXT_NODUP
-- crosses to the next key and stops if it exceeds hi. _cur_key is a Lua string
-- allocated only on key transitions (not per dup). _seek_ge inherits PkNode's
-- linear fallback.
--
-- lo/hi accept either a scalar (single-column index) or a plain table
-- {f1, f2, ...} (composite index). Tables are forwarded with '[]' format to
-- encode_key so each position maps to the corresponding key column.
-- opts={lo_ex=true} makes lo exclusive (> lo); opts={hi_ex=true} makes hi
-- exclusive (< hi). Both default to inclusive. lo_ex: after find_ge_raw(lo),
-- if the cursor lands exactly on lo, MDBX_NEXT_NODUP skips past it.
--
-- Example: db:pk_range('t/score', 80, 100)
--   -> PK stream of all rows where score in [80, 100]
--
-- Example: db:pk_range('t/uid-time', {1, 0}, {1, 999})
--   -> PK stream of rows where uid=1 and time in [0, 999]

IxRangeNode = object(PkNode)

function Db:pk_range(ix_name, lo, hi, opts)
	local dbi, ix_schema = self:dbi_schema(ix_name)
	assertf(ix_schema.is_index, 'pk_range: not an index: %s', ix_name)
	local vs = ix_schema.val_schema
	local lo_ex = opts and opts.lo_ex
	local hi_ex = opts and opts.hi_ex
	local node = object(IxRangeNode, {
		table_name = ix_schema.val_table,
		key_gt = vs.key_gt, key_eq = vs.key_eq,
		_db = self,
		_cur = nil,
		_hi = nil,     --encoded hi key as Lua string, or nil for unbounded
		_hi_ex = hi_ex,
		_ix_key_gt = ix_schema.key_gt,
		_cur_key = nil,
		_pk = nil, _pk_sz = nil, _done = true,
	})
	if hi ~= nil then
		local xk, xk_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
		local xk_sz = encode_key(self, ix_schema, 'pk_range', nil,
			xk, xk_buf_sz, ix_schema.key_cols, istab(hi) and '[]' or nil, hi)
		node._hi = str(xk, xk_sz)
	end
	local cur = self:cursor_raw(dbi)
	cur.schema = ix_schema
	local ok, k, k_sz, v, v_sz
	if lo ~= nil then
		local xk, xk_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
		local xk_sz = encode_key(self, ix_schema, 'pk_range', nil,
			xk, xk_buf_sz, ix_schema.key_cols, istab(lo) and '[]' or nil, lo)
		ok, k, k_sz, v, v_sz = cur:find_ge_raw(xk, xk_sz)
		if lo_ex and ok and not ix_schema.key_gt(k, k_sz, xk, xk_sz) then
			ok, k, k_sz, v, v_sz = cur:move_raw(C.MDBX_NEXT_NODUP)
		end
	else
		ok, k, k_sz, v, v_sz = cur:first_raw()
	end
	local past_hi = node._hi and (
		hi_ex and not ix_schema.key_gt(node._hi, #node._hi, k, k_sz)
		or  ix_schema.key_gt(k, k_sz, node._hi, #node._hi)
	)
	if not ok or past_hi then
		cur:close(); return node
	end
	node._cur = cur
	node._cur_key = str(k, k_sz)
	node._pk = v; node._pk_sz = v_sz
	node._done = false
	return node
end

function IxRangeNode:_advance()
	local ok, _, _, v, v_sz = self._cur:move_raw(C.MDBX_NEXT_DUP)
	if ok then self._pk = v; self._pk_sz = v_sz; return end
	local ok2, k, k_sz, nv, nv_sz = self._cur:move_raw(C.MDBX_NEXT_NODUP)
	if not ok2 or (self._hi and (
		self._hi_ex and not self._ix_key_gt(self._hi, #self._hi, k, k_sz)
		or  self._ix_key_gt(k, k_sz, self._hi, #self._hi)
	)) then
		self._cur:close(); self._cur = nil; self._done = true; return
	end
	self._cur_key = str(k, k_sz)
	self._pk = nv; self._pk_sz = nv_sz
end

function IxRangeNode:close()
	if self._cur then self._cur:close(); self._cur = nil end
end

-- PkAnd: sorted merge intersection of two PK streams -------------------------
-- Walks both streams in parallel; when they diverge the lagging side is
-- seeked forward with _seek_ge (O(log n) per seek). Total cost O(k1+k2),
-- not O(k1*k2) as a naive nested loop would be.
--
-- Example: db:pk_seek('t/col1','a'):pk_and(db:pk_seek('t/col2','x'))
--   -> PKs where col1='a' AND col2='x'

PkAnd = object(PkNode)

function PkAnd:_converge()
	local a, b = self._a, self._b
	while not a._done and not b._done do
		if self.key_eq(a._pk, a._pk_sz, b._pk, b._pk_sz) then
			self._pk = a._pk; self._pk_sz = a._pk_sz; return
		elseif self.key_gt(a._pk, a._pk_sz, b._pk, b._pk_sz) then
			b:_seek_ge(a._pk, a._pk_sz)
		else
			a:_seek_ge(b._pk, b._pk_sz)
		end
	end
	--TODO: close the still-live child; when one side exhausts first the other's
	--cursor stays open until the db closes (reproduces even on zero-result queries
	--if one pk_seek finds nothing but the other was already opened).
	self._done = true
end

function PkAnd:_advance()
	self._a:_advance(); self._b:_advance(); self:_converge()
end

function PkAnd:_seek_ge(v, v_sz)
	self._a:_seek_ge(v, v_sz); self._b:_seek_ge(v, v_sz); self:_converge()
end

function PkAnd:close() self._a:close(); self._b:close() end

-- PkOr: sorted merge union of two PK streams with dedup ----------------------
-- _which tracks which child(ren) are at the current minimum: 1=a only,
-- 2=b only, 3=both equal. _advance steps whichever child(ren) were at min,
-- then recomputes. Equal PKs from both sides emit exactly once.
--
-- Example: db:pk_seek('t/tag','vip'):pk_or(db:pk_seek('t/tag','premium'))
--   -> PKs where tag='vip' OR tag='premium', each PK emitted once

PkOr = object(PkNode)

function PkOr:_set_min()
	local a, b = self._a, self._b
	if a._done and b._done then self._done = true; return end
	if a._done then
		self._pk = b._pk; self._pk_sz = b._pk_sz; self._which = 2
	elseif b._done then
		self._pk = a._pk; self._pk_sz = a._pk_sz; self._which = 1
	elseif self.key_eq(a._pk, a._pk_sz, b._pk, b._pk_sz) then
		self._pk = a._pk; self._pk_sz = a._pk_sz; self._which = 3
	elseif self.key_gt(a._pk, a._pk_sz, b._pk, b._pk_sz) then
		self._pk = b._pk; self._pk_sz = b._pk_sz; self._which = 2
	else
		self._pk = a._pk; self._pk_sz = a._pk_sz; self._which = 1
	end
end

function PkOr:_advance()
	local w = self._which
	if w == 1 or w == 3 then self._a:_advance() end
	if w == 2 or w == 3 then self._b:_advance() end
	self:_set_min()
end

function PkOr:_seek_ge(v, v_sz)
	local a, b = self._a, self._b
	if not a._done and self.key_gt(v, v_sz, a._pk, a._pk_sz) then a:_seek_ge(v, v_sz) end
	if not b._done and self.key_gt(v, v_sz, b._pk, b._pk_sz) then b:_seek_ge(v, v_sz) end
	self:_set_min()
end

function PkOr:close() self._a:close(); self._b:close() end

-- PkExcept: difference (NOT IN) of two PK streams ----------------------------
-- For each position in _a, seeks _b to _a._pk; yields _a._pk if _b is
-- exhausted or _b._pk > _a._pk (meaning _a._pk is absent from _b).
--
-- Example: db:pk_seek('t/col1','a'):pk_except(db:pk_seek('t/col2','x'))
--   -> PKs where col1='a' AND the row is not also indexed under col2='x'

PkExcept = object(PkNode)

function PkExcept:_find_next()
	local a, b = self._a, self._b
	while not a._done do
		if not b._done then b:_seek_ge(a._pk, a._pk_sz) end
		if b._done or self.key_gt(b._pk, b._pk_sz, a._pk, a._pk_sz) then
			self._pk = a._pk; self._pk_sz = a._pk_sz; return
		end
		a:_advance()
	end
	self._done = true
end

function PkExcept:_advance() self._a:_advance(); self:_find_next() end

function PkExcept:_seek_ge(v, v_sz) self._a:_seek_ge(v, v_sz); self:_find_next() end

function PkExcept:close() self._a:close(); self._b:close() end

--ROW-LEVEL QUERY NODES -------------------------------------------------------

-- Row nodes produce bundles: {[table_name]=cur, ...}. The same bundle table
-- is reused each iteration; callers must consume before calling next.

local RowNode = object()

function RowNode:filter(pred)
	assertf(type(pred) == 'function', 'filter: pred must be a function, got %s', type(pred))
	return object(FilterNode, {_inner = self, _pred = pred})
end

function RowNode:any()
	return self:iter()() ~= nil
end

function RowNode:limit(n)
	assertf(type(n) == 'number' and n >= 0 and n % 1 == 0,
		'limit: n must be a non-negative integer, got %s', n)
	return object(LimitNode, {_inner = self, _n = n})
end

function RowNode:semi_join(inner_fn)
	assertf(type(inner_fn) == 'function', 'semi_join: inner_fn must be a function, got %s', type(inner_fn))
	return object(SemiJoinNode, {_outer = self, _inner_fn = inner_fn})
end

function RowNode:union(b)
	assertf(inherits(b, RowNode), 'union: b must be a row_node (pk_node needs :fetch() first)')
	return object(UnionNode, {_a = self, _b = b})
end

function RowNode:nested_join(inner_fn)
	assertf(type(inner_fn) == 'function', 'nested_join: inner_fn must be a function, got %s', type(inner_fn))
	return object(NestedJoinNode, {_outer = self, _inner_fn = inner_fn})
end

function RowNode:anti_join(inner_fn)
	assertf(type(inner_fn) == 'function', 'anti_join: inner_fn must be a function, got %s', type(inner_fn))
	return object(AntiJoinNode, {_outer = self, _inner_fn = inner_fn})
end

function RowNode:aggregate(key_fn, fns)
	assertf(type(key_fn) == 'function', 'aggregate: key_fn must be a function, got %s', type(key_fn))
	assertf(type(fns) == 'table', 'aggregate: fns must be a table, got %s', type(fns))
	return object(AggregateNode, {_inner = self, _key_fn = key_fn, _fns = fns})
end

function RowNode:distinct()
	return object(DistinctNode, {_inner = self})
end

function RowNode:except(b, key_fn)
	assertf(inherits(b, RowNode), 'except: b must be a row_node')
	assertf(type(key_fn) == 'function', 'except: key_fn must be a function, got %s', type(key_fn))
	return object(ExceptNode, {_a = self, _b = b, _key_fn = key_fn})
end

-- FetchNode: bridge from PK stream to row bundles ----------------------------
-- Opens one base-table cursor; each iteration seeks it to the current PK via
-- find_raw BEFORE calling _advance (raw pointer is valid only until advance).
-- Reuses one bundle table {[table_name]=cur}; cursor repositioned in place.
--
-- Example: db:pk_seek('t/status','active'):fetch()
--   -> bundle stream {t=cur} with cur positioned at each active row

FetchNode = object(RowNode)

function FetchNode:iter()
	local pk_node = self._pk_node
	if pk_node._done then return noop end
	local table_name = pk_node.table_name
	local cur = pk_node._db:cursor(table_name)
	local bundle = {[table_name] = cur}
	local closed = false
	return function()
		if closed then return end
		if pk_node._done then cur:close(); closed = true; return end
		local ok = cur:find_raw(pk_node._pk, pk_node._pk_sz)
		assert(ok, 'fetch: pk not in base table')
		pk_node:_advance()
		return bundle
	end
end

-- SeqScanNode: full table walk as a composable row_node ----------------------
-- Full scan without any index: opens one base-table cursor and walks every row
-- with MDBX_NEXT. Same bundle reuse as FetchNode: one {[table_name]=cur}
-- table returned every iteration, cursor repositioned in place.
--
-- Example: db:seq_scan('t')
--   :filter(function(b) return b.t:current('{}').status == 'active' end)
--   -> all rows of 't', filtered without an index

SeqScanNode = object(RowNode)

function Db:seq_scan(table_name)
	return object(SeqScanNode, {_db = self, _table_name = table_name})
end

function SeqScanNode:iter()
	local db         = self._db
	local table_name = self._table_name
	local cur        = db:cursor(table_name)
	local bundle     = {[table_name] = cur}
	local started    = false
	local done       = false
	return function()
		if done then return end
		local ok
		if not started then
			ok = cur:first_raw()
			started = true
		else
			ok = cur:move_raw(C.MDBX_NEXT)
		end
		if not ok then cur:close(); done = true; return end
		return bundle
	end
end

-- FilterNode: skips bundles where pred returns false -------------------------
-- repeat-until avoids a separate nil check in the common (passing) case.
-- any() inlines the pred loop instead of creating a closure via RowNode:any().
--
-- Example: pk_seek('t/status','active'):fetch()
--   :filter(function(b) return b.t:current('{}').age > 18 end)
--   -> active rows where age > 18

FilterNode = object(RowNode)

function FilterNode:iter()
	local inner = self._inner:iter()
	local pred = self._pred
	return function()
		while true do
			local bundle = inner()
			if bundle == nil then return end
			if pred(bundle) then return bundle end
		end
	end
end

function FilterNode:any()
	local inner = self._inner:iter()
	local pred = self._pred
	while true do
		local bundle = inner()
		if bundle == nil then return false end
		if pred(bundle) then return true end
	end
end

-- AntiJoinNode: yields outer rows where inner produces no results (NOT EXISTS)
-- inner_fn(outer_bundle) returns a fresh node per outer row. :any() tests
-- existence without iterating: pk_nodes return `not _done` (zero closures);
-- row_nodes fall back to iter()(). Abandoned non-empty inner nodes may leave
-- cursors open; those are owned by the txn (normal per resource policy).
--
-- Example: orders:fetch():anti_join(function(ob)
--     return db:pk_seek('items/order_id', ob.orders:current('{}').id) end)
--   -> orders with no items

AntiJoinNode = object(RowNode)

function AntiJoinNode:iter()
	local outer = self._outer:iter()
	local inner_fn = self._inner_fn
	return function()
		while true do
			local bundle = outer()
			if bundle == nil then return end
			if not inner_fn(bundle):any() then return bundle end
		end
	end
end

-- LimitNode: stops the inner stream after n rows -----------------------------
-- n is a closure upvalue decremented per row; no state reset across iter() calls.
--
-- Example: db:pk_seek('t/status','active'):fetch():limit(10)
--   -> first 10 active rows in index order

LimitNode = object(RowNode)

function LimitNode:iter()
	local inner = self._inner:iter()
	local n = self._n
	return function()
		if n == 0 then return end
		local bundle = inner()
		if bundle == nil then return end
		n = n - 1
		return bundle
	end
end

-- SemiJoinNode: yields outer rows where inner produces at least one result ----
-- EXISTS check; mirror of anti_join with condition flipped.
--
-- Example: orders:fetch():semi_join(function(ob)
--     return db:pk_seek('items/order_id', ob.orders:current('{}').id) end)
--   -> orders that have at least one item

SemiJoinNode = object(RowNode)

function SemiJoinNode:iter()
	local outer = self._outer:iter()
	local inner_fn = self._inner_fn
	return function()
		while true do
			local bundle = outer()
			if bundle == nil then return end
			if inner_fn(bundle):any() then return bundle end
		end
	end
end

-- UnionNode: drains _a to exhaustion then drains _b; no dedup ----------------
-- on_b flag switches between the two iterators after _a returns nil.
-- Compose multiple unions by chaining: a:union(b):union(c).
--
-- Example: pk_seek('t/status','active'):fetch():union(pk_seek('t/status','pending'):fetch())
--   -> active rows followed by pending rows

UnionNode = object(RowNode)

function UnionNode:iter()
	local a = self._a:iter()
	local b = self._b:iter()
	local on_b = false
	return function()
		if not on_b then
			local v = a()
			if v ~= nil then return v end
			on_b = true
		end
		return b()
	end
end

-- NestedJoinNode: for each outer row yields every row from inner_fn -----------
-- inner_fn(outer_bundle) creates a fresh inner node per outer row. Flattened
-- by a state machine (ob + inner as upvalues); no coroutine.
-- Bundle reuse: outer entries auto-update (FetchNode repositions cursor in
-- place); inner entries re-copied only when inner_fn creates a new node (once
-- per outer row, not per inner row), identified by ib reference change.
--
-- Example: orders:fetch():nested_join(function(ob)
--     return db:pk_seek('items/order_id', ob.orders:current('{}').id):fetch() end)
--   -> {orders=cur, items=cur} bundle for every (order, item) pair

NestedJoinNode = object(RowNode)

function NestedJoinNode:iter()
	local outer    = self._outer:iter()
	local inner_fn = self._inner_fn
	local ob       = nil  --current outer bundle; FetchNode reuses same table+cursor, auto-updates
	local inner    = nil  --current inner iterator, nil means advance outer
	local merged   = nil  --allocated once on first output row, reused thereafter
	local last_ib  = nil  --last inner bundle ref; changes once per outer row when inner_fn creates a new node
	return function()
		while true do
			if inner == nil then
				ob = outer()
				if ob == nil then return end
				inner = inner_fn(ob):iter()
			end
			local ib = inner()
			if ib ~= nil then
				if merged == nil then
					merged = {}
					for k, v in pairs(ob) do merged[k] = v end
					for k, v in pairs(ib) do merged[k] = v end
					last_ib = ib
				elseif ib ~= last_ib then
					--new outer row: inner_fn created a new node with new cursors; update inner entries
					for k, v in pairs(ib) do merged[k] = v end
					last_ib = ib
				end
				return merged
			end
			inner = nil
		end
	end
end

-- AggregateNode: streaming (sorted-input) aggregation -------------------------
-- Groups consecutive rows by key_fn result; emits one plain table per group:
-- {_key=group_key, name=acc, ...}. Requires input sorted by group key
-- (guaranteed when key_fn maps to the walk-order index column). Lookahead:
-- the first row of the next group is consumed before the current group closes,
-- so it is held in `pending` across calls. names/steps arrays built once at
-- iter() to avoid pairs() in the per-row inner loop.
-- fns: {name = function(bundle, acc) -> new_acc}, acc starts as nil.
-- Output is a plain table, not a live cursor bundle; update-safety does not apply.
--
-- Example: pk_range('t/category', nil, nil):fetch()
--   :aggregate(function(b) return b.t:current('{}').category end,
--     {count = function(_, n) return (n or 0) + 1 end,
--      total = function(b, n) return (n or 0) + b.t:current('{}').amount end})
--   -> {_key='books', count=3, total=45}, {_key='music', count=7, total=120}, ...

AggregateNode = object(RowNode)

function AggregateNode:iter()
	local inner  = self._inner:iter()
	local key_fn = self._key_fn
	local fns    = self._fns
	local names, steps, n_agg = {}, {}, 0
	for name, step in pairs(fns) do
		n_agg = n_agg + 1
		names[n_agg] = name; steps[n_agg] = step
	end
	local pending = inner()
	return function()
		if pending == nil then return end
		local group_key = key_fn(pending)
		local state = {_key = group_key}
		for i = 1, n_agg do state[names[i]] = steps[i](pending, nil) end
		while true do
			local b = inner()
			if b == nil then pending = nil; break end
			if key_fn(b) ~= group_key then pending = b; break end
			for i = 1, n_agg do state[names[i]] = steps[i](b, state[names[i]]) end
		end
		return state
	end
end

-- DistinctNode: skips consecutive bundles with the same PK -------------------
-- Reads the raw key from the first cursor in the bundle via current_raw();
-- skips if equal to last seen. Designed for single-table bundles from fetch()
-- or seq_scan(); requires sorted input (guaranteed from all pk_* paths).
--
-- Example: pk_seek('t/tag','a'):fetch():union(pk_seek('t/tag','b'):fetch()):distinct()
--   -> each row emitted once when both index paths overlap on the same PK

DistinctNode = object(RowNode)

function DistinctNode:iter()
	local inner   = self._inner:iter()
	local last_pk = nil
	return function()
		while true do
			local bundle = inner()
			if bundle == nil then return end
			local _, cur = next(bundle)
			local _, k, k_sz = cur:current_raw()
			local pk = str(k, k_sz)
			if pk ~= last_pk then
				last_pk = pk
				return bundle
			end
		end
	end
end

-- MergeJoinNode: composable wrapper around each_join --------------------------
-- Calls db:each_join with the stored args; each yielded cursor tuple becomes a
-- bundle {[table_name]=cur, ...}. Optional (db.left) sides map to nil in the
-- bundle when unmatched. Re-iterable when all args are table-name strings.
--
-- Example: db:merge_join('orders', db.left('items')):filter(function(b) return b.items ~= nil end)
--   -> orders that have a matching item (effectively an inner join via filter)

MergeJoinNode = object(RowNode)

function Db:merge_join(...)
	local n = select('#', ...)
	assertf(n >= 2, 'merge_join: at least 2 args required, got %d', n)
	return object(MergeJoinNode, {_db = self, _args = {...}, _n = n})
end

function MergeJoinNode:iter()
	local db   = self._db
	local args = self._args
	local n    = self._n
	local names = {}
	for i = 1, n do
		local a = args[i]
		if istab(a) then a = a.left end  --unwrap db.left()
		names[i] = isstr(a) and a or a.schema.name
	end
	local join_iter = db:each_join(unpack(args, 1, n))
	local bundle    = {}
	return function()
		local row = {join_iter()}
		if row[1] == nil then return end
		for i = 1, n do bundle[names[i]] = row[i] end
		return bundle
	end
end

-- ExceptNode: sorted merge set difference at the row level --------------------
-- Yields rows from _a whose key_fn value does not appear in _b. Walks both
-- streams in lockstep, advancing the lagging side. O(|a| + |b|).
-- Requires both inputs sorted on key_fn -- usually free when key_fn maps to
-- the walk-order index column. key_fn is applied to bundles from both sides,
-- so it must work for both (typically the same table on each side).
--
-- Unlike pk_except (which matches on raw PK bytes), this matches on a decoded
-- key_fn value, enabling set difference across different index paths or tables.
--
-- Example: active:except(suspended, function(b) return b.users:current('{}').id end)
--   -> active users whose id does not appear in the suspended set

ExceptNode = object(RowNode)

function ExceptNode:iter()
	local a        = self._a:iter()
	local b        = self._b:iter()
	local key_fn   = self._key_fn
	local ba       = a()
	local bb       = b()
	local kb       = bb and key_fn(bb)
	local consumed = false  --true after yield; advance a at start of next call
	return function()
		if consumed then ba = a(); consumed = false end
		while ba ~= nil do
			local ka = key_fn(ba)
			while kb ~= nil and kb < ka do
				bb = b(); kb = bb and key_fn(bb)
			end
			if kb == nil or kb ~= ka then
				consumed = true; return ba
			end
			repeat ba = a() until ba == nil or key_fn(ba) ~= ka
		end
	end
end
