--[[

	query engine over mdbx_schema tables and indexes -- new implementation.
	Public Domain.

	WIP: only pk_scan exists so far. Modeled on mdbx_query_nodes.lua's
	design (pull-style nodes; db:<node>(args) builds one, node:reset()
	starts a run, node:next_group()/next_pk() walk it) but is a separate,
	self-contained file -- it does not require mdbx_query_nodes.lua and
	is not loaded together with it. See mdbx_query_nodes.md and
	mdbx_query_nodes_spec.md for the fuller node vocabulary this design
	is drawn from; treat mdbx_query_nodes.lua itself as inspiration only,
	not a shared dependency.

API

	db:<node>(args...) -> node    build a plan node.
	node:reset([params])        start a run; may be called again after close().
	node:close()                 end a run; re-open allowed; idempotent.
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

function Db.query_node:reset(params, row_ctx)
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
--implemented; passing it today silently behaves like eq_prefix and
--ignores in_values entirely, instead of erroring.
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
		order[#order+1] = {member = member_schema.name, col = f.col,
			dir = desc and 'desc' or 'asc'}
	end
	if is_index then
		order[#order+1] = {member = member_schema.name, col = 'pk',
			dir = desc and 'desc' or 'asc'}
	end
	local node = object(self, {
		members = {member_schema.name},
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
		if has_pk and (name == nil or name == member_schema.name) then
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
	local depth_buf, depth_sz, seek_buf, seek_sz, hi_buf, hi_sz, lo_open
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
			if depth_sz and key_past_prefix(mk_rec.data, mk_rec.size,
				depth_buf, depth_sz)
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
	function node:reset(params, row_ctx)
		assert(not is_open, 'node already open')
		for i = 1, depth do vals[i] = seek_getters[i]() end
		if depth > 0 then
			depth_sz = encode_key_prefix(db, schema, 'pk_scan',
				mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, depth, false,
				unpack(vals, 1, depth))
			depth_buf = u8a(depth_sz)
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
			seek_buf = u8a(seek_sz); copy(seek_buf, mdbx_key_rec_buffer, seek_sz)
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
			hi_buf = hi_sz and u8a(hi_sz)
			if hi_buf then copy(hi_buf, mdbx_key_rec_buffer, hi_sz) end
		else
			hi_buf, hi_sz = nil, nil
		end
		is_open = true
		has_pk = nil; base_seeked = false; first = true
	end
	--[[
	re-seek to a new prefix on the same open cursor, given already-
	encoded raw bytes -- no getter call, no encode_key_prefix. Used by
	pk_join_seek's wide-FK case: each driver row supplies the parent's
	own PK bytes directly (or a key_reencode()'d version, for a
	nullable FK column), reusing this node's cursor across every
	driver row instead of a fresh reset()+close() cycle each time.
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
	local fk = find_fk(child_schema, fk_schema)
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
	function node:reset(params, row_ctx)
		assert(not is_open, 'node already open')
		driver:reset(params, row_ctx)
		is_open = true
		has_pair = false; has_child = false; in_match = false
		child_base_seeked = false
		parent_pk = nil; parent_pk_sz = nil
	end
	node.next_item = node.next_group  --one tuple per driver step; next_pk noop
	return node
end
