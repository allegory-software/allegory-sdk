--[[

	query engine over mdbx_schema tables and indexes -- new implementation.
	Public Domain.

	WIP: only pk_scan exists so far. Modeled on mdbx_query_nodes.lua's
	design (pull-style nodes; db:<node>(args) builds one, node:reset()
	starts a run, node:next_group()/next_pk() walk it) but is a separate,
	self-contained file -- it does not require mdbx_query_nodes.lua and
	is not loaded together with it. See mdbx_query_nodes.md and
	mdbx_query_nodes_spec.md for the fuller node vocabulary that this design
	is drawn from; treat mdbx_query_nodes.lua itself as inspiration only,
	not a shared dependency.

API

	db:<node>(args...) -> node    build a plan node.
	node:reset()                 (re)start a run in place; safe to call
	                             again without close() first.
	node:close()                 end a run for good; idempotent.
	node:explain() -> t          node metadata, no row reads.

]]

if not ... then require'mdbx_query_nodes2_test'; return end

require'mdbx_schema'

local C  = C
local Db = mdbx_db
local encode_key_prefix = mdbx_encode_key_prefix

--NODE BASE CLASS ------------------------------------------------------------

--[[
a node kind is `Db.<kind> = object(Db.query_node)` with a `:__call(db, ...)`
constructor that stores explain metadata in the instance. Shared behavior
lives here; instances inherit kind-level constants (kind, item, unique,
source, work) and per-node data.
]]
Db.query_node = object()

function Db.query_node:reset()
	error(self.kind..': open not implemented yet')
end
Db.query_node.next_group  = noop
Db.query_node.next_pk     = noop
Db.query_node.reset_group = noop
Db.query_node.close       = noop
function Db.query_node:skip_to(target, target_sz)
	return self:next_group()
end
function Db.query_node:col(member, col)
	local cache = self._col_cache
	if not cache then cache = {}; self._col_cache = cache end
	local mc = cache[member or false]
	if not mc then mc = {}; cache[member or false] = mc end
	local f = mc[col]
	if not f then
		f = self:compile_col(member, col)
		mc[col] = f
	end
	return f()
end
function Db.query_node:next_item()
	return self:next_pk() or self:next_group()
end

function Db.query_node:explain()
	local t = {
		kind    = self.kind,
		item    = self.item,
		members = self.members and extend({}, self.members) or nil,
		order   = self.order and imap(self.order,
			function(o) return o.member..'.'..o.col..' '..o.dir end) or nil,
		unique  = self.unique,
		source  = self.source,
		work    = self.work,
	}
	if self.inputs then
		t.inputs = imap(self.inputs, function(n) return n:explain() end)
	end
	return t
end

--ACCESS NODES ---------------------------------------------------------------

local memcmp, min = memcmp, min
local function key_cmp(k1, n1, k2, n2)
	local c = memcmp(k1, k2, min(n1, n2))
	if c ~= 0 then return c end
	if n1 < n2 then return -1 end
	if n1 > n2 then return  1 end
	return 0
end
local function key_ge(k1, n1, k2, n2) return key_cmp(k1, n1, k2, n2) >= 0 end
--true once k no longer starts with prefix p (used as a stop bound).
local function key_past_prefix(k, k_sz, p, p_sz)
	return k_sz < p_sz or memcmp(k, p, p_sz) ~= 0
end
--the smallest encoded byte string that's strictly greater than every
--string starting with buf[0..sz): increment the last byte that isn't
--already 0xff, drop everything after it. returns the new length, or nil
--if every byte is 0xff (no finite upper bound exists at this length).
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
pk_scan: unified access node for one table/index access plan -- exact
key, range, prefix, equality-prefix-then-everything, or full scan.
Matches choose_access()'s plan shape from mdbx_query2.lua: one node
replaces mdbx_query_nodes.lua's pk_get/pk_seek/pk_range/pk_prefix,
which differ only in which MDBX cursor op the scan needs, all captured
by plan.kind.

Bound values are zero-arg getters, not param names: this node has no
opinion on where a value comes from (a literal, a query param, a
correlated outer column) -- it just calls the getter whenever it needs
a fresh value. reset()'s params/row_ctx args are accepted only for
protocol uniformity with other nodes; getters already close over
whatever they need, so reset() doesn't read either one.

plan fields (see mdbx_query2.lua's choose_access()):
	kind:   'exact'|'range'|'prefix'|'eq_prefix'|'full'
	schema: table or index schema
	depth:  leading equality-pinned key col count
	dir:    'asc'|'desc' (desc only ever occurs for eq_prefix/full --
	        see try_order_key() in mdbx_query2.lua)
	seek:   {getter, ...}, depth getters, one per pinned leading col
	lo, hi: {op=,get=} (range only; op one of gt/ge/lt/le)
	prefix: getter (prefix only; nil/null rejected -- starts() has no
	        meaning against a null value)

Usage: db:pk_scan(plan)

fk_parent_scan/pk_group_first (mdbx_query_nodes.lua) stay separate
nodes if/when ported: they reinterpret the index key's bytes as a
different table's PK, a real semantic difference from a scan-strategy
choice.

--TODO: plan.kind == 'in' (repeated seeks with a dedup set) -- not
--implemented; the assert below rejects it (see
--pk_scan_resolve_errors in the test file).
--TODO: plan.next_nodup (skip whole dup groups) -- not read anywhere.
--TODO: DUPFIXED bulk-dup-fetch optimization (mdbx_query_nodes.lua's
--pk_seek/pk_range use it, ~2.9x faster) -- this node always walks one
--dup at a time.
--TODO: skip_to(target, target_sz) -- inherits the base class's noop
--default (just calls next_group(), ignoring target), which silently
--gives wrong results for merge_join/merge_union/merge_except's
--lockstep advance, not just slower ones. mdbx_query_nodes.lua's
--pk_range/pk_seek implement a real seek here.
--TODO: reset_group() -- needed for merge_join to rewind to the first
--pk of the current merge-key group; not implemented (noop default).
]]
Db.pk_scan = object(Db.query_node, {
	kind   = 'pk_scan',
	item   = 'pk',
	unique = true,
	source = 'cursor',
	work   = 'key scan',
})
function Db.pk_scan:__call(db, plan)
	local schema = plan.schema
	local is_index = schema.is_index
	local member_schema = is_index and schema.val_schema or schema
	--plan.member: the query-facing name (an alias) this scan's one
	--member is known by everywhere else -- member_schema.name is always
	--the underlying physical table, wrong whenever the source is
	--aliased (self-join, or a plain aliased FROM/JOIN).
	local member_name = plan.member or member_schema.name
	local depth = plan.depth
	local desc = plan.dir == 'desc'
	local seek_getters = plan.seek
	local lo, hi, prefix_getter = plan.lo, plan.hi, plan.prefix
	assert(plan.kind == 'exact' or plan.kind == 'range'
		or plan.kind == 'prefix' or plan.kind == 'eq_prefix'
		or plan.kind == 'full')
	assert(not desc or plan.kind == 'full' or plan.kind == 'eq_prefix')
	local order = {}
	for i = depth + 1, #schema.key_fields do
		local f = schema.key_fields[i]
		order[#order+1] = {member = member_name, col = f.col,
			dir = desc and 'desc' or 'asc'}
	end
	if is_index then
		order[#order+1] = {member = member_name, col = 'pk',
			dir = desc and 'desc' or 'asc'}
	end
	local node = object(self, {
		members = {member_name},
		order   = order,
	})
	local cur, base_cur, is_open, first
	local has_pk, base_seeked
	local mk_rec = MDBX_val()
	local pk_rec = is_index and MDBX_val() or mk_rec
	local base_val_rec = MDBX_val()
	local adv_val = is_index and pk_rec or nil
	local adv_group = desc and (is_index and C.MDBX_PREV_NODUP or C.MDBX_PREV)
	                       or  (is_index and C.MDBX_NEXT_NODUP or C.MDBX_NEXT)
	local adv_pk = desc and C.MDBX_PREV_DUP or C.MDBX_NEXT_DUP
	local get_base_val
	if is_index then
		get_base_val = function()
			if not base_seeked then
				if not base_cur then base_cur = db:cursor(member_schema.name) end
				base_cur:move_raw_into(C.MDBX_SET_KEY, pk_rec, base_val_rec)
				base_seeked = true
			end
			return base_val_rec.data, base_val_rec.size
		end
	else
		get_base_val = function()
			if not base_seeked then
				local ok, k, k_sz, v, v_sz = cur:current_raw()
				base_val_rec.data = v; base_val_rec.size = v_sz
				base_seeked = true
			end
			return base_val_rec.data, base_val_rec.size
		end
	end
	function node:pk(name)
		if has_pk and (name == nil or name == member_name) then
			return true, pk_rec.data, pk_rec.size
		end
	end
	function node:compile_col(member, col)
		return db:compile_col(is_index and schema or member_schema, col,
			is_index and mk_rec or nil, is_index and pk_rec or mk_rec,
			get_base_val)
	end
	function node:merge_key() return mk_rec.data, mk_rec.size end
	--depth_buf/depth_sz: the leading equality-pinned cols, encoded once
	--per reset(). the walk stops once the cursor's key no longer starts
	--with these bytes -- works the same way for every kind ('exact'
	--means depth covers the whole key, so this alone yields at most one
	--match, with no separate code path needed).
	--seek_buf/seek_sz: the actual cursor seek position -- depth_buf plus
	--one more bound col for range/prefix, or just depth_buf otherwise.
	--depth_buf/seek_buf/hi_buf are allocated once here and overwritten via
	--copy() on every reset(), instead of a fresh u8a() per reset() -- reset()
	--runs once per outer row when this node sits on nested_join's inner
	--side, so a per-reset allocation is a real, avoidable cost there.
	local depth_buf, seek_buf, hi_buf =
		u8a(MDBX_MAX_KEY_SIZE), u8a(MDBX_MAX_KEY_SIZE), u8a(MDBX_MAX_KEY_SIZE)
	local depth_sz, seek_sz, hi_sz, lo_open
	local vals = {}
	function node:next_group()
		if not cur then cur = db:cursor(schema.name) end
		if first then
			first = false
			if plan.kind == 'full' then
				if not cur:move_raw_into(desc and C.MDBX_LAST or C.MDBX_FIRST,
					mk_rec, adv_val)
				then has_pk = nil; return end
			elseif desc then
				--eq_prefix desc only (plan.dir doc above): bump the pinned
				--prefix to its own exclusive upper bound and land on the
				--last key at or under it, then walk backward. an all-0xff
				--prefix has no upper bound -- it already IS the last key.
				local end_sz = increment_prefix(seek_buf, seek_sz)
				if end_sz then
					mk_rec.data, mk_rec.size = seek_buf, end_sz
					if not cur:move_raw_into(C.MDBX_TO_KEY_LESSER_OR_EQUAL,
						mk_rec, adv_val)
					then has_pk = nil; return end
				else
					if not cur:move_raw_into(C.MDBX_LAST, mk_rec, adv_val)
					then has_pk = nil; return end
				end
			else
				mk_rec.data, mk_rec.size = seek_buf, seek_sz
				if not cur:move_raw_into(C.MDBX_SET_RANGE, mk_rec, adv_val)
				then has_pk = nil; return end
			end
		else
			if not cur:move_raw_into(adv_group, mk_rec, adv_val)
			then has_pk = nil; return end
		end
		while true do
			--hi_buf/seek_buf each carry the same depth_sz leading bytes as
			--depth_buf plus one more column, so once either is active its
			--own check already implies this one; only run it standalone
			--when neither covers it.
			if depth_sz and not hi_sz and plan.kind ~= 'prefix'
				and key_past_prefix(mk_rec.data, mk_rec.size, depth_buf, depth_sz)
			then has_pk = nil; return end
			if hi_sz and key_ge(mk_rec.data, mk_rec.size, hi_buf, hi_sz) then
				has_pk = nil; return
			end
			if plan.kind == 'prefix' and key_past_prefix(mk_rec.data,
				mk_rec.size, seek_buf, seek_sz)
			then has_pk = nil; return end
			--a strict (op=='gt') lo only rejects the row exactly at the
			--seek boundary; the seek itself already guarantees >= lo.
			local skip = lo_open and not key_past_prefix(mk_rec.data,
				mk_rec.size, seek_buf, seek_sz)
			if not skip then
				has_pk = true; base_seeked = false
				return true
			end
			if not cur:move_raw_into(adv_group, mk_rec, adv_val)
			then has_pk = nil; return end
		end
	end
	if is_index then
		function node:next_pk()
			if not has_pk then return end
			if not cur:move_raw_into(adv_pk, mk_rec, pk_rec)
			then has_pk = nil; return end
			base_seeked = false
			return true
		end
	else
		node.next_item = node.next_group
	end
	function node:close()
		if is_open then
			if cur then cur:close(); cur = nil end
			if base_cur then base_cur:close(); base_cur = nil end
			is_open = false
		end
	end
	function node:reset()
		for i = 1, depth do vals[i] = seek_getters[i]() end
		if depth > 0 then
			depth_sz = encode_key_prefix(db, schema, 'pk_scan',
				mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, depth, false,
				unpack(vals, 1, depth))
			copy(depth_buf, mdbx_key_rec_buffer, depth_sz)
		end
		local n = depth
		local is_prefix = false
		if plan.kind == 'range' and lo then
			vals[depth + 1] = lo.get()
			n = depth + 1
		elseif plan.kind == 'prefix' then
			local pv = prefix_getter()
			assertf(pv ~= nil and pv ~= null,
				'pk_scan: %s: prefix value is null', schema.name)
			vals[depth + 1] = pv
			n = depth + 1
			is_prefix = true
		end
		if n > 0 then
			seek_sz = encode_key_prefix(db, schema, 'pk_scan',
				mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, n, is_prefix,
				unpack(vals, 1, n))
			copy(seek_buf, mdbx_key_rec_buffer, seek_sz)
		end
		lo_open = plan.kind == 'range' and lo and lo.op == 'gt'
		if plan.kind == 'range' and hi then
			vals[depth + 1] = hi.get()
			hi_sz = encode_key_prefix(db, schema, 'pk_scan',
				mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, depth + 1, false,
				unpack(vals, 1, depth + 1))
			if hi.op == 'le' then
				hi_sz = increment_prefix(mdbx_key_rec_buffer, hi_sz)
			end
			if hi_sz then copy(hi_buf, mdbx_key_rec_buffer, hi_sz) end
		else
			hi_sz = nil
		end
		is_open = true
		has_pk = nil; base_seeked = false; first = true
	end
	--[[
	re-seek to a new prefix on the same open cursor, from already-
	encoded raw bytes. Used by pk_join_seek's wide-FK case: each driver
	row supplies the parent's own PK bytes directly (or a
	key_reencode()'d version, for a nullable FK column).
	Only valid for 'eq_prefix'/'exact' kinds: the given bytes serve as
	both the seek position and the stop boundary, matching how those
	kinds already work when depth == n (no separate lo/hi/prefix bound).
	]]
	function node:reset_prefix(buf, buf_sz)
		depth_buf, depth_sz = buf, buf_sz
		seek_buf, seek_sz = buf, buf_sz
		is_open = true
		has_pk = nil; base_seeked = false; first = true
	end
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	return node
end

--PROBE NODES ----------------------------------------------------------------

local key_reencode = mdbx_key_reencode
MDBX_WIDEFK = false --bench override, see pk_join_seek

local function check_pk_node(x, op, n)
	assert(x and x.members and x.item ~= 'value')
end

local function check_node(x, op, n)
	assert(x and x.members)
end

local function check_value_node(x, op, n)
	assert(x and x.item == 'value')
end

--used by pk_join_seek, which accepts a multi-member driver (chained joins).
local function driver_has_member(driver, name)
	for _, m in ipairs(driver.members) do if m == name then return true end end
end

--an index qualifies if a FK's columns are a leading prefix of it;
--longest match wins if more than one FK qualifies.
local function find_fk(child_schema, fk_schema)
	local best, best_n
	for _, f in pairs(child_schema.fks or {}) do
		local n = #f.cols
		if n <= #fk_schema.pk and (not best or n > best_n) then
			local ok = true
			for i = 1, n do
				if fk_schema.pk[i] ~= f.cols[i] then ok = false; break end
			end
			if ok then best, best_n = f, n end
		end
	end
	return best
end
--exposed for mdbx_query2.lua's choose_access(): planning needs the same
--FK match find_fk() already validates, to classify a joined step as
--fk_seek before pk_join_seek would otherwise re-derive it.
mdbx_find_fk = find_fk

--[[
pk_join_seek: nested join -- one MDBX_SET_KEY seek on the fk index per
driver PK. driver: any PK-stream node; fk_schema: the FK index schema.
Output: PK tuple stream in driver order; one seek per row, O(n log m).
fk_schema may be wider than the FK's own columns; then the seek
becomes a prefix scan instead of an exact match (see fk_child below).
opts.left = true: left join; emit parent with absent child.
opts.member: name for the new child member (default: child_schema.name).
opts.from_member: name of the existing parent member in driver
(default: parent table's name); needed when the parent was joined
under an alias, e.g. a self-join.
opts.fk: the FK entry (find_fk()'s own return shape), when the caller
already matched it and knows fk_schema is a real FK index -- e.g.
mdbx_query2.lua's compile_joined_step(), passing choose_access()'s
classify_join_op() match through instead of find_fk() re-deriving it.
Usage: db:pk_join_seek(driver, fk_schema [, opts])
]]
Db.pk_join_seek = object(Db.query_node, {
	kind   = 'pk_join_seek',
	item   = 'pk_tuple',
	unique = false,
	source = 'probe',
	work   = 'FK index seek per driver row',
})
function Db.pk_join_seek:__call(db, driver, fk_schema, opts)
	check_pk_node(driver, 'pk_join_seek', 1)
	opts = opts or {}
	local child_schema = fk_schema.val_schema
	local fk = opts.fk or find_fk(child_schema, fk_schema)
	assert(fk, 'pk_join_seek: not a FK index')
	local parent_schema = db:table_schema(fk.ref_table)
	local from_member = opts.from_member or parent_schema.name
	local child_member = opts.member or child_schema.name
	-- driver may carry multiple members (chained joins); child is the new one.
	assert(driver_has_member(driver, from_member),
		'pk_join_seek: driver must have member '..from_member)
	local left_join = opts.left
	local members = extend({}, driver.members)
	members[#members+1] = child_member
	local node = object(self, {
		members = members,
		order   = driver.order,
	})
	--wide index: children of one parent are a key range, not dupsort
	--duplicates of one key. fk_child (pk_scan eq_prefix, reset_prefix
	--per row) walks that range instead of the narrow case's exact
	--SET_KEY/NEXT_DUP.
	--MDBX_WIDEFK: global bench override, forces this branch.
	local wide = MDBX_WIDEFK or #fk_schema.pk > #fk.cols
	--seek/reset_prefix below reuse driver's parent-pk bytes as-is, which
	--only works if the FK index key is byte-identical to the parent pk
	--(fails for a nullable FK col: extra marker byte). not_null is the
	--only attribute that can differ (add_fk enforces the rest).
	local reencode = false
	for _, col in ipairs(fk.cols) do
		if not child_schema.fields[col].not_null then reencode = true; break end
	end
	local reenc_buf = reencode and u8a(MDBX_MAX_KEY_SIZE) or nil
	local fk_child = wide and db:pk_scan{kind = 'eq_prefix',
		schema = fk_schema, depth = #fk.cols, dir = 'asc', seek = {}} or nil
	node.inputs = wide and {driver, fk_child} or {driver}
	node.merge_cmp = driver.merge_cmp
	node.merge_sig = driver.merge_sig
	local fk_cur, child_cur, is_open
	local parent_pk, parent_pk_sz
	local child_pk_rec = MDBX_val()
	local child_val_rec = MDBX_val()
	local parent_pk_rec = MDBX_val()
	local has_pair, has_child, in_match, child_base_seeked
	local function get_child_val()
		if not child_base_seeked then
			if not child_cur then child_cur = db:cursor(child_schema.name) end
			child_cur:move_raw_into(C.MDBX_SET_KEY, child_pk_rec, child_val_rec)
			child_base_seeked = true
		end
		return child_val_rec.data, child_val_rec.size
	end
	function node:close()
		if is_open then
			driver:close()
			if fk_child then fk_child:close() end
			if fk_cur then fk_cur:close(); fk_cur = nil end
			if child_cur then child_cur:close(); child_cur = nil end
			is_open = false
		end
	end
	function node:merge_key() return parent_pk, parent_pk_sz end
	function node:pk(name)
		if not has_pair then return end
		-- child is the only member owned here; all others delegate upstream.
		if name == child_member then
			--left join: parent present, child absent.
			if not has_child then return end
			if wide then return fk_child:pk(child_schema.name) end
			return true, child_pk_rec.data, child_pk_rec.size
		end
		return driver:pk(name)
	end
	function node:compile_col(member, col)
		if member == child_member then
			local inner = wide and fk_child:compile_col(child_schema.name, col)
				or db:compile_col(child_schema, col, nil, child_pk_rec,
					get_child_val)
			return function() return has_child and inner() or nil end
		end
		return driver:compile_col(member, col)
	end
	--[[
	Per driver item: one MDBX_SET_KEY on the FK index to land on the
	first child PK for the parent PK key, then MDBX_NEXT_DUP to walk
	remaining children before advancing the driver. One index seek per
	driver item; O(n log m) where n = driver items, m = FK index size.
	Wide case: next_pk for dups of one key, next_group for the next
	key still in the prefix.
	]]
	function node:next_group()
		has_pair = false; has_child = false
		if wide then
			while true do
				if in_match then
					if fk_child:next_pk() then
						has_pair = true; has_child = true; return true
					end
					if fk_child:next_group() then
						has_pair = true; has_child = true; return true
					end
					in_match = false
				end
				if not driver:next_item() then return end
				local _, p, p_sz = driver:pk(from_member)
				parent_pk, parent_pk_sz = p, p_sz
				if reencode then
					local sz = key_reencode(parent_schema, fk_schema, p, p_sz,
						reenc_buf, MDBX_MAX_KEY_SIZE)
					fk_child:reset_prefix(reenc_buf, sz)
				else
					fk_child:reset_prefix(p, p_sz)
				end
				if fk_child:next_group() then
					in_match = true
					has_pair = true; has_child = true; return true
				end
				if left_join then has_pair = true; return true end
			end
		end
		if not fk_cur then fk_cur = db:cursor(fk_schema.name) end
		while true do
			if in_match then
				if fk_cur:move_raw_into(C.MDBX_NEXT_DUP, nil, child_pk_rec) then
					child_base_seeked = false
					has_pair = true; has_child = true; return true
				end
				in_match = false
			end
			if not driver:next_item() then return end
			local _, p, p_sz = driver:pk(from_member)
			parent_pk, parent_pk_sz = p, p_sz
			if reencode then
				local sz = key_reencode(parent_schema, fk_schema, p, p_sz,
					reenc_buf, MDBX_MAX_KEY_SIZE)
				parent_pk_rec.data = reenc_buf; parent_pk_rec.size = sz
			else
				parent_pk_rec.data = p; parent_pk_rec.size = p_sz
			end
			if fk_cur:move_raw_into(C.MDBX_SET_KEY, parent_pk_rec, child_pk_rec)
			then
				in_match = true
				child_base_seeked = false
				has_pair = true; has_child = true; return true
			end
			if left_join then has_pair = true; return true end
		end
	end
	function node:reset()
		driver:reset()
		is_open = true
		has_pair = false; has_child = false; in_match = false
		child_base_seeked = false
		parent_pk = nil; parent_pk_sz = nil
	end
	--forwards straight to driver's own reset_prefix -- pk_join_seek's own
	--seeking (this node's FK edge) is untouched, only the driver's position
	--changes. lets a correlated caller (nested_join) re-seek this whole
	--chain from raw bytes, without driver ever decoding/re-encoding a value.
	function node:reset_prefix(buf, buf_sz)
		driver:reset_prefix(buf, buf_sz)
		is_open = true
		has_pair = false; has_child = false; in_match = false
		child_base_seeked = false
		parent_pk = nil; parent_pk_sz = nil
	end
	node.next_item = node.next_group  --one tuple per driver step; next_pk noop
	return node
end

--[[
nested_join: for each outer item, run inner from scratch and yield one
output per inner item, merging outer+inner members. inner is built
once. inner:reset()/reset_prefix() runs once per outer item.
opts.left = true: left join; when inner yields nothing for an outer
item, emit the outer item once with every inner member absent.
opts.from_member: name of the outer member whose raw pk bytes drive
inner via inner:reset_prefix(), instead of inner:reset(). Requires
inner to implement reset_prefix (any pk_scan/pk_join_seek chain does).
Without it, inner:reset() runs instead, and any correlated value that inner
needs must read outer's current row through its own getter.
Usage: db:nested_join(outer, inner [, opts])
]]
Db.nested_join = object(Db.query_node, {
	kind   = 'nested_join',
	item   = 'pk_tuple',
	unique = false,
	source = 'pass-through',
	work   = 'correlated inner per outer item',
})
function Db.nested_join:__call(db, outer, inner, opts)
	check_pk_node(outer, 'nested_join', 1)
	check_pk_node(inner, 'nested_join', 2)
	local left_join = opts and opts.left
	local from_member = opts and opts.from_member
	local members = extend({}, outer.members)
	for _, m in ipairs(inner.members) do
		assert(not driver_has_member(outer, m),
			'nested_join: inner member '..m..' already in outer')
		members[#members+1] = m
	end
	local node = object(self, {
		members = members,
		order   = outer.order,
	})
	node.inputs = {outer, inner}
	node.merge_cmp = outer.merge_cmp
	node.merge_sig = outer.merge_sig
	local has_pk, has_inner, inner_open
	function node:close()
		outer:close()
		if inner_open then inner:close(); inner_open = false end
	end
	function node:pk(name)
		if not has_pk then return end
		local ok, p, sz = outer:pk(name)
		if ok then return true, p, sz end
		if has_inner then return inner:pk(name) end
	end
	function node:compile_col(member, col)
		if driver_has_member(outer, member) then
			return outer:compile_col(member, col)
		end
		local inner_fn = inner:compile_col(member, col)
		return function() return has_inner and inner_fn() or nil end
	end
	function node:merge_key() return outer:merge_key() end
	function node:next_group()
		has_pk = false
		while true do
			if has_inner then
				if inner:next_pk() or inner:next_group() then
					has_pk = true; return true
				end
				has_inner = false
			end
			if not outer:next_item() then return end
			has_pk = true
			if from_member then
				local _, p, sz = outer:pk(from_member)
				inner:reset_prefix(p, sz)
			else
				inner:reset()
			end
			inner_open = true
			if inner:next_group() then has_inner = true; return true end
			if left_join then return true end
			has_pk = false
		end
	end
	function node:reset()
		outer:reset()
		has_pk = false; has_inner = false
	end
	node.next_item = node.next_group  --one output item per step; next_pk noop
	return node
end

--FILTER NODES ---------------------------------------------------------------

--[[
pk_filter: keep pk/pk_tuple stream items where fn(node) is true, drop
the rest. fn reads columns off node itself (delegates to input via
compile_col), so it can read any member that the input stream carries.
Usage: db:pk_filter(input, fn)
]]
Db.pk_filter = object(Db.query_node, {
	kind   = 'pk_filter',
	source = 'pass-through',
	work   = 'predicate filter over pk stream',
})
function Db.pk_filter:__call(db, input, fn)
	check_pk_node(input, 'pk_filter', 1)
	assert(type(fn) == 'function', 'pk_filter: fn must be a function')
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
		item    = input.item,
	})
	node.inputs = {input}
	node.merge_cmp = input.merge_cmp
	node.merge_sig = input.merge_sig
	local has_pk
	function node:compile_col(m, c) return input:compile_col(m, c) end
	function node:close() input:close() end
	function node:pk(name)
		if not has_pk then return end
		return input:pk(name)
	end
	function node:merge_key() return input:merge_key() end
	function node:next_group()
		while true do
			has_pk = false
			if not input:next_item() then return end
			has_pk = true
			if fn(node) then return true end
		end
	end
	function node:reset()
		input:reset()
		has_pk = false
	end
	node.next_item = node.next_group  --one input item per step; next_pk noop
	return node
end

--TERMINAL NODES -------------------------------------------------------------

--[[
select: decode a pk stream into value records, one record per input
item. outputs: list of {name=, member=, col=} or {name=, fn=} entries.
fn(input_node) -> value; called with input positioned at current item.
Usage: db:select(input, outputs)
]]
Db.select = object(Db.query_node, {
	kind   = 'select',
	item   = 'value',
	unique = false,
	source = 'pass-through',
	work   = 'decode pk stream to value records',
})
function Db.select:__call(db, input, outputs)
	check_pk_node(input, 'select', 1)
	assert(type(outputs) == 'table' and #outputs >= 1)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
	})
	node.inputs = {input}
	local col_map = {} --{member..':'..col -> name}; fn outputs have none.
	for _, o in ipairs(outputs) do
		if o.member and o.col then col_map[o.member..':'..o.col] = o.name end
	end
	local getters, names = {}, {}
	for i, o in ipairs(outputs) do
		getters[i] = o.fn and function() return o.fn(input) end
			or input:compile_col(o.member, o.col)
		names[i] = o.name
	end
	local ngetters = #getters
	function node:row() return node._row end
	function node:compile_col(member, col)
		local name = col_map[member..':'..col]
		if name then return function() return node._row[name] end end
		--let later value nodes sort/filter by columns not selected here.
		return input:compile_col(member, col)
	end
	function node:close() input:close() end
	function node:next_group()
		if not input:next_item() then return end
		local rec = {}
		for i = 1, ngetters do rec[names[i]] = getters[i]() end
		node._row = rec
		return true
	end
	function node:reset() input:reset() end
	return node
end

--[[
value_filter: keep value records where fn(record) is true.
Usage: db:value_filter(input, fn)
]]
Db.value_filter = object(Db.query_node, {
	kind   = 'value_filter',
	item   = 'value',
	unique = false,
	source = 'pass-through',
	work   = 'keep value records where fn(record) is true',
})
function Db.value_filter:__call(db, input, fn)
	check_value_node(input, 'value_filter', 1)
	assert(type(fn) == 'function')
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
	})
	node.inputs = {input}
	function node:row() return input:row() end
	function node:compile_col(m, c) return input:compile_col(m, c) end
	function node:close() input:close() end
	function node:next_group()
		while true do
			if not input:next_group() then return end
			if fn(input:row()) then return true end
		end
	end
	function node:reset() input:reset() end
	return node
end

--[[
stream_distinct: dedup adjacent value records by fields; input must
already be in group order. fields: list of record field names.
Usage: db:stream_distinct(input, fields)
]]
Db.stream_distinct = object(Db.query_node, {
	kind   = 'stream_distinct',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'dedup adjacent value records by fields; requires group order',
})
function Db.stream_distinct:__call(db, input, fields)
	check_value_node(input, 'stream_distinct', 1)
	assert(type(fields) == 'table' and #fields >= 1)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = true,
	})
	node.inputs = {input}
	local nfields = #fields
	local prev, has_prev
	function node:row() return input:row() end
	function node:compile_col(m, c) return input:compile_col(m, c) end
	function node:close() input:close() end
	function node:next_group()
		while true do
			if not input:next_group() then return end
			local rec = input:row()
			local same = has_prev
			for i = 1, nfields do
				local v = rec[fields[i]]; if v == nil then v = null end
				if prev[i] ~= v then same = false end
				prev[i] = v
			end
			if not same then has_prev = true; return true end
		end
	end
	function node:reset()
		input:reset()
		prev = {}; has_prev = false
	end
	return node
end

--[[
hash_distinct: dedup value records in any order by fields; O(n) memory.
fields: list of record field names.
Usage: db:hash_distinct(input, fields)
]]
Db.hash_distinct = object(Db.query_node, {
	kind   = 'hash_distinct',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'dedup any-order value records by fields; O(n) memory',
})
function Db.hash_distinct:__call(db, input, fields)
	check_value_node(input, 'hash_distinct', 1)
	assert(type(fields) == 'table' and #fields >= 1)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = true,
	})
	node.inputs = {input}
	local nfields = #fields
	local vals = {}
	local tuple_space, seen
	function node:row() return input:row() end
	function node:compile_col(m, c) return input:compile_col(m, c) end
	function node:close() input:close() end
	function node:next_group()
		while true do
			if not input:next_group() then return end
			local rec = input:row()
			--single-col keys hash the value directly; multi-col needs
			--tuples() to intern the whole combination as one table key.
			local t
			if nfields == 1 then
				local v = rec[fields[1]]
				t = v ~= nil and v or null
			else
				for i = 1, nfields do
					local v = rec[fields[i]]
					vals[i] = v ~= nil and v or null
				end
				t = tuple_space(unpack(vals, 1, nfields))
			end
			if not seen[t] then seen[t] = true; return true end
		end
	end
	function node:reset()
		input:reset()
		tuple_space = tuples(); seen = {}
	end
	return node
end

--[[
value_sort: materialise and sort by field values; accepts pk or value
input. For value input: collects rows, sorts, serves via next_group()/
:row(). For pk input (single-member only): collects pks + decoded sort
values, sorts by those values, serves as a pk node with compile_col via
a fresh base cursor.
spec: list of {member=, col=, desc=} / {field=, desc=} entries, or a
comparator fn(a, b) (value input only).
null sorts before non-null in asc, after in desc.
Usage: db:value_sort(input, spec)
]]
Db.value_sort = object(Db.query_node, {
	kind   = 'value_sort',
	item   = 'value',
	unique = false,
	source = 'pass-through',
	work   = 'materialise and sort by field values',
})
function Db.value_sort:__call(db, input, spec)
	check_node(input, 'value_sort', 1)
	local is_pk = input.item ~= 'value'
	if type(spec) == 'function' then
		assert(not is_pk)
	else
		assert(type(spec) == 'table' and #spec >= 1)
	end
	assert(not is_pk or #input.members == 1)

	local parts, sort_order
	if type(spec) ~= 'function' then
		parts = {}
		local default_member = is_pk and input.members[1] or nil
		for _, s in ipairs(spec) do
			local sort_member = s.member or default_member
			local sort_col = s.col or s.field
			parts[#parts+1] = {
				field = s.field or sort_col,
				member = sort_member,
				col = sort_col,
				desc = not not s.desc,
			}
		end
		sort_order = {}
		for i, p in ipairs(parts) do
			sort_order[i] = {member = p.member, col = p.col,
				dir = p.desc and 'desc' or 'asc'}
		end
	end

	--null-aware comparator over a parallel vals array {a_vals, b_vals}
	local function make_cmp(get_vals)
		return function(a, b)
			local av_list, bv_list = get_vals(a), get_vals(b)
			for i, p in ipairs(parts) do
				local av, bv = av_list[i], bv_list[i]
				if av ~= bv then
					local a_null = av == null or av == nil
					local b_null = bv == null or bv == nil
					if a_null ~= b_null then
						return p.desc and b_null or not p.desc and a_null
					end
					return p.desc and av > bv or not p.desc and av < bv
				end
			end
			return false
		end
	end

	if is_pk then
		--pk path: output is still a pk node; compile_col serves via a
		--fresh cursor, since materializing discards the input's own.
		local member_name = input.members[1]
		local schema = db:table_schema(member_name)
		local node = object(self, {
			members = {member_name},
			order   = sort_order,
			unique  = input.unique,
			item    = input.item,
		})
		node.inputs = {input}
		local entries
		local base_cur, is_open
		local cur_pk_rec = MDBX_val()
		local base_val_rec = MDBX_val()
		local base_seeked, has_pk, idx
		local cmp = make_cmp(function(e) return e.vals end)
		local function get_base_val()
			if not base_seeked then
				if not base_cur then base_cur = db:cursor(member_name) end
				base_cur:move_raw_into(C.MDBX_SET_KEY, cur_pk_rec, base_val_rec)
				base_seeked = true
			end
			return base_val_rec.data, base_val_rec.size
		end
		function node:close()
			if is_open then
				if base_cur then base_cur:close(); base_cur = nil end
				is_open = false
			end
		end
		function node:pk(name)
			if not has_pk then return end
			if name == nil or name == member_name then
				return true, cur_pk_rec.data, cur_pk_rec.size
			end
		end
		function node:compile_col(member, col)
			return db:compile_col(schema, col, nil, cur_pk_rec, get_base_val)
		end
		function node:next_group()
			idx = idx + 1
			local e = entries[idx]
			if not e then has_pk = false; return end
			cur_pk_rec.data = e.p; cur_pk_rec.size = e.sz
			has_pk = true; base_seeked = false
			return true
		end
		function node:reset()
			assert(not is_open, 'node already open')
			input:reset()
			local decoders = {}
			for _, p in ipairs(parts) do
				decoders[#decoders+1] = input:compile_col(p.member, p.col)
			end
			entries = {}
			while input:next_item() do
				local _, p, p_sz = input:pk()
				local pk = u8a(p_sz); copy(pk, p, p_sz)
				local vals = {}
				for i, dec in ipairs(decoders) do vals[i] = dec() end
				entries[#entries+1] = {p = pk, sz = p_sz, vals = vals}
			end
			input:close()
			sort(entries, cmp)
			is_open = true
			idx = 0; has_pk = false; base_seeked = false
		end
		return node
	else
		--value path: collect rows, sort, serve via next_group()/:row().
		local node = object(self, {
			members = input.members,
			order   = sort_order,
			unique  = input.unique,
		})
		node.inputs = {input}
		function node:row() return node._row end
		local cmp = type(spec) == 'function' and spec
			or make_cmp(function(e) return e.vals end)
		local recs, idx
		function node:close() end
		function node:next_group()
			idx = idx + 1
			if not recs[idx] then return end
			node._row = type(spec) == 'function' and recs[idx] or recs[idx].row
			return true
		end
		function node:reset()
			input:reset()
			recs = {}
			if type(spec) == 'function' then
				while input:next_group() do recs[#recs+1] = input:row() end
			else
				local getters = {}
				for i, p in ipairs(parts) do
					if p.member then
						getters[i] = assert(input:compile_col(p.member, p.col))
					else
						getters[i] = function() return input:row()[p.field] end
					end
				end
				while input:next_group() do
					local vals = {}
					for i, get in ipairs(getters) do vals[i] = get() end
					recs[#recs+1] = {row = input:row(), vals = vals}
				end
			end
			input:close()
			sort(recs, cmp)
			idx = 0
		end
		return node
	end
end

--[[
limit: yield at most n items, skipping offset items first (default 0).
Usage: db:limit(input, n [, offset])
]]
Db.limit = object(Db.query_node, {
	kind   = 'limit',
	source = 'pass-through',
	work   = 'at most n items after skipping offset',
})
function Db.limit:__call(db, input, n, offset)
	check_node(input, 'limit', 1)
	assert(type(n) == 'number' and n >= 0)
	offset = offset or 0
	assert(type(offset) == 'number' and offset >= 0)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
		item    = input.item,
	})
	node.inputs = {input}
	node.merge_cmp = input.merge_cmp
	node.merge_sig = input.merge_sig
	local has_item, count, skipped
	function node:compile_col(m, c) return input:compile_col(m, c) end
	function node:close() input:close() end
	function node:row() return input:row() end
	function node:pk(name)
		if not has_item then return end
		return input:pk(name)
	end
	function node:merge_key() return input:merge_key() end
	function node:next_group()
		has_item = false
		if count >= n then return end
		while true do
			if not input:next_item() then return end
			if skipped < offset then skipped = skipped + 1
			else
				count = count + 1
				has_item = true
				return true
			end
		end
	end
	function node:reset()
		input:reset()
		has_item = false; count = 0; skipped = 0
	end
	node.next_item = node.next_group  --one input item per step; next_pk noop
	return node
end

--AGGREGATE NODES ------------------------------------------------------------

--[[
pk_group: group consecutive input items by cols; yields the first item
of each group via next_group(), the rest via next_pk(). Requires input
already in group order (same-key items adjacent).
cols: list of {member=, col=}; getters compiled once at reset(),
compared part-wise against a reused array instead of allocating a key
table per row.
Usage: db:pk_group(input, cols)
]]
Db.pk_group = object(Db.query_node, {
	kind   = 'pk_group',
	item   = 'pk',
	unique = false,
	source = 'pass-through',
	work   = 'group by cols; first item per group via next_group, rest'
		..' via next_pk',
})
function Db.pk_group:__call(db, input, cols)
	check_pk_node(input, 'pk_group', 1)
	assert(type(cols) == 'table' and #cols >= 1)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
		item    = input.item,
	})
	node.inputs = {input}
	node.merge_cmp = input.merge_cmp
	node.merge_sig = input.merge_sig
	local ncols = #cols
	local getters, prev
	local done, has_current, has_prev, peeked
	function node:compile_col(m, c) return input:compile_col(m, c) end
	local function same_key()
		for i = 1, ncols do
			local v = getters[i](); if v == nil then v = null end
			if prev[i] ~= v then return false end
		end
		return true
	end
	local function set_key()
		for i = 1, ncols do
			local v = getters[i](); if v == nil then v = null end
			prev[i] = v
		end
	end
	local function adv()
		if done then return false end
		if not input:next_item() then done = true; return false end
		return true
	end
	function node:close() input:close() end
	function node:pk(name)
		if not has_current then return end
		return input:pk(name)
	end
	function node:merge_key() return input:merge_key() end
	function node:next_group()
		has_current = false
		if done then return end
		if not peeked then
			if not adv() then return end
			if has_prev then
				while same_key() do
					if not adv() then return end
				end
			end
		end
		peeked = false
		set_key(); has_prev = true
		has_current = true
		return true
	end
	function node:next_pk()
		if not has_current then return end
		if not adv() then has_current = false; return end
		if same_key() then return true end
		peeked = true; has_current = false; return nil
	end
	function node:reset()
		input:reset()
		getters = {}
		for i, c in ipairs(cols) do
			getters[i] = input:compile_col(c.member, c.col)
		end
		prev = {}
		done = false; has_current = false; has_prev = false; peeked = false
	end
	return node
end

--agg accumulator state: count starts at 0, avg tracks sum+n for a
--final division, everything else starts absent (nil) and is set by
--the first accumulated row (agg_step's min/max/sum first-value case).
local function agg_init(agg)
	local acc = {}
	for _, a in ipairs(agg) do
		if a.op == 'count' then acc[a.name] = 0
		elseif a.op == 'avg' then acc[a.name] = {sum = 0, n = 0}
		else acc[a.name] = nil
		end
	end
	return acc
end

local function agg_finalize(agg, acc)
	local rec = {}
	for _, a in ipairs(agg) do
		if a.op == 'avg' then
			local s = acc[a.name]
			rec[a.name] = s.n > 0 and s.sum / s.n or nil
		else
			rec[a.name] = acc[a.name]
		end
	end
	return rec
end

--[[
fold one row's value v into acc for aggregate a. key/a.part serve the
synthetic 'key' op, which copies a group-by key column straight into
the output instead of aggregating a per-row value.
count(expr) counts non-null v like every other op; count() (no expr)
has no v to check, so the caller passes true in its place -- always
non-null, so it always counts. Callers decide which case applies (they
know whether this aggregate has a real expr), not this function.
]]
local function agg_step(acc, a, key, v)
	local name = a.name
	if a.op == 'key' then
		acc[name] = key and key[a.part]
	elseif v ~= nil and v ~= null then
		if a.op == 'count' then
			acc[name] = acc[name] + 1
		elseif a.op == 'sum' then
			acc[name] = (acc[name] or 0) + v
		elseif a.op == 'avg' then
			acc[name].sum = acc[name].sum + v
			acc[name].n   = acc[name].n   + 1
		elseif a.op == 'min' then
			if acc[name] == nil or v < acc[name] then acc[name] = v end
		elseif a.op == 'max' then
			if acc[name] == nil or v > acc[name] then acc[name] = v end
		end
	end
end

--[[
stream_aggregate: one value record per group from a pk stream; needs
group order (same as pk_group). cols: list of {member=, col=}, group
key at pk level; nil = grand total (one record for the whole input).
agg: list of {name=, op=, [member=, col=]}.
ops: sum, avg, min, max (skip null), key (from cols part index),
count -- with member/col, counts rows where that col is non-null;
without, counts every row.
Usage: db:stream_aggregate(input, cols, agg)
]]
Db.stream_aggregate = object(Db.query_node, {
	kind   = 'stream_aggregate',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'aggregate pk stream into one value record per group',
})
function Db.stream_aggregate:__call(db, input, cols, agg)
	check_pk_node(input, 'stream_aggregate', 1)
	assert(cols == nil or type(cols) == 'table')
	assert(type(agg) == 'table' and #agg >= 1)
	local node = object(self, {members = input.members, unique = true})
	node.inputs = {input}
	local col_map = {} --{member..':'..col -> name}
	for _, a in ipairs(agg) do
		if a.member and a.col then col_map[a.member..':'..a.col] = a.name end
	end
	function node:row() return node._row end
	function node:compile_col(member, col)
		local name = col_map[member..':'..col]
		if name then return function() return node._row[name] end end
	end
	local done, getters
	local function accumulate(acc, key)
		for _, a in ipairs(agg) do
			local v
			if a.op == 'count' then
				if a.member then v = input:col(a.member, a.col)
				else v = true end
			elseif a.op ~= 'key' then
				v = input:col(a.member, a.col)
			end
			agg_step(acc, a, key, v)
		end
	end
	function node:close() input:close() end
	if not cols then
		function node:next_group()
			if done then return end; done = true
			local acc = agg_init(agg)
			while input:next_item() do accumulate(acc, nil) end
			node._row = agg_finalize(agg, acc)
			return true
		end
	else
		function node:next_group()
			if done then return end
			if not input:next_group() then done = true; return end
			local key = {}
			for i = 1, #getters do
				local v = getters[i](); key[i] = v ~= nil and v or null
			end
			local acc = agg_init(agg)
			accumulate(acc, key)
			while input:next_pk() do accumulate(acc, key) end
			node._row = agg_finalize(agg, acc)
			return true
		end
	end
	function node:reset()
		input:reset()
		if cols then
			getters = {}
			for i, c in ipairs(cols) do
				getters[i] = input:compile_col(c.member, c.col)
			end
		end
		done = false
	end
	return node
end

--[[
hash_aggregate: group and aggregate value records in any order; O(n
groups) memory. fields: list of record field names, group key at value
level; nil = grand total.
agg: list of {name=, op=, [input=, member=, col=]}; input= is the
field name read for accumulation; member=/col= let a later node
address this output by its original source column, same as
stream_aggregate.
ops: sum, avg, min, max (skip null), key (fields part index),
count -- with input, counts rows where that field is non-null;
without, counts every row.
Usage: db:hash_aggregate(input, fields, agg)
]]
Db.hash_aggregate = object(Db.query_node, {
	kind   = 'hash_aggregate',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'group and aggregate value records; any order; O(n groups)'
		..' memory',
})
function Db.hash_aggregate:__call(db, input, fields, agg)
	check_value_node(input, 'hash_aggregate', 1)
	assert(fields == nil or type(fields) == 'table')
	assert(type(agg) == 'table' and #agg >= 1)
	local node = object(self, {members = input.members, unique = true})
	node.inputs = {input}
	local col_map = {}
	for _, a in ipairs(agg) do
		if a.member and a.col then col_map[a.member..':'..a.col] = a.name end
	end
	function node:compile_col(member, col)
		local name = col_map[member..':'..col]
		if name then return function() return node._row[name] end end
	end
	local output, idx
	local function accumulate(acc, rec, key)
		for _, a in ipairs(agg) do
			local v
			if a.op == 'count' then
				if a.input then v = rec[a.input]
				else v = true end
			elseif a.op ~= 'key' then
				v = a.input and rec[a.input]
			end
			agg_step(acc, a, key, v)
		end
	end
	function node:row() return node._row end
	function node:close() end
	function node:next_group()
		idx = idx + 1
		if not output[idx] then return end
		node._row = output[idx]
		return true
	end
	function node:reset()
		input:reset()
		local group_list = {}
		local group_map  = {}
		local nfields = fields and #fields or 0
		local tuple_space = fields and tuples() or nil
		--key/vals reused across rows: agg_step's 'key' op reads key[part]
		--synchronously during accumulate(), so overwriting them next row
		--is safe; vals only feeds tuple_space(unpack(...)), which reads
		--the unpacked scalars immediately, not the table itself.
		local key = fields and {} or nil
		local vals = fields and {} or nil
		while input:next_group() do
			local rec = input:row()
			local t
			if fields then
				for i = 1, nfields do
					local v = rec[fields[i]]; if v == nil then v = null end
					key[i] = v; vals[i] = v
				end
				t = tuple_space(unpack(vals, 1, nfields))
			else
				t = true
			end
			local acc = group_map[t]
			if not acc then
				acc = agg_init(agg)
				group_map[t] = acc
				group_list[#group_list+1] = acc
			end
			accumulate(acc, rec, fields and key or nil)
		end
		input:close()
		output = {}
		for _, g in ipairs(group_list) do
			output[#output+1] = agg_finalize(agg, g)
		end
		idx = 0
	end
	return node
end
