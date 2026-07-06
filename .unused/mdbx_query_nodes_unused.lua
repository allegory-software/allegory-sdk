--[[

	archived nodes from lua/mdbx_query_nodes.lua. reference only: not
	required anywhere, not wired into Db. depends on private locals of
	that file (resolve, check_index, find_fk, check_driver_member,
	pk_is_u32, key_cmp, u32_keyset, MDBX_val, C) that are not reproduced
	here, so this code will not run as-is; restoring it means moving it
	back into mdbx_query_nodes.lua.

]]

--[[
pk_join_hash: removed from mdbx_query_nodes.lua on 2026-07-05. Benchmarked
(tests/mdbx_query_bench.lua / .unused/mdbx_join_hash_bench.lua,
bench_join_sweep) against pk_join_seek across driver-size fractions of
N_AUTHORS, u64 and u32 keys alike: pk_join_hash never won. The O(n+m) vs
O(n log m) complexity difference doesn't show up in practice -- per-row
hash/string-alloc cost (or even the u32 sort+binsearch fast path) doesn't
overcome pk_join_seek's simplicity at realistic sizes. Kept for reference.
]]

--[[
pk_join_hash: hash join -- materialise driver PKs into a set, then
scan FK index once. driver: any PK-stream node; fk: FK index name.
Output: PK tuple stream in FK index order (parent PK asc, child PK
asc); O(n+m).
opts.left = true: left join; emit parent with absent child. Unmatched
parents are appended after the matched rows, unordered (see
mdbx_query_validators.md).
opts.member: name for the new child member (default: child_schema.name).
The driver's one member may be named after an alias (e.g. a self-join);
its own name is kept as the parent member, not forced to parent_schema.name.
Usage: db:pk_join_hash(driver, fk_ix_name [, opts])
]]
Db.pk_join_hash = object(Db.query_node, {
	kind   = 'pk_join_hash',
	item   = 'pk_tuple',
	unique = false,
	source = 'probe',
	work   = 'materialise driver + FK index scan',
})
function Db.pk_join_hash:__call(db, driver, fk_name, opts)
	check_pk_node(driver, 'pk_join_hash', 1)
	opts = opts or {}
	local fk_schema = resolve(db, fk_name)
	check_index(fk_schema, 'pk_join_hash', fk_name)
	local child_schema = fk_schema.val_schema
	local _, parent_schema = find_fk(
		db, child_schema, fk_schema, 'pk_join_hash', fk_name)
	local parent_member = check_driver_member(driver, 'pk_join_hash')
	local child_member = opts.member or child_schema.name
	local left_join = opts.left
	local node = object(self, {
		members = {parent_member, child_member},
		order   = {{col = parent_member..'.pk', dir = 'asc'},
		           {col = child_member..'.pk',  dir = 'asc'}},
	})
	node.inputs = {driver}
	node.merge_cmp = key_cmp
	node.merge_sig = parent_schema.key_sig
	local driver_set
	-- Avoid per-row string allocation + Lua hash lookup for 4-byte u32 keys:
	-- measured ~2x in pk_hash_filter and ~2.8x-3.6x materialise+probe.
	local u32_driver_set = pk_is_u32(parent_schema) and pk_is_u32(fk_schema)
	local fk_cur, parent_cur, child_cur, is_open
	local mk_rec = MDBX_val()
	local pk_rec = MDBX_val()
	local parent_val_rec = MDBX_val()
	local child_val_rec = MDBX_val()
	local has_pair, has_child, parent_base_seeked, child_base_seeked
	local in_match, op, sweeping, sweep_key, sweep_done
	local matched -- opts.left, u32 path: per-driver-element matched flags
	local function get_parent_val()
		if not parent_base_seeked then
			if not parent_cur then parent_cur = db:cursor(parent_schema.name) end
			parent_cur:move_raw_into(C.MDBX_SET_KEY, mk_rec, parent_val_rec)
			parent_base_seeked = true
		end
		return parent_val_rec.data, parent_val_rec.size
	end
	local function get_child_val()
		if not child_base_seeked then
			if not child_cur then child_cur = db:cursor(child_schema.name) end
			child_cur:move_raw_into(C.MDBX_SET_KEY, pk_rec, child_val_rec)
			child_base_seeked = true
		end
		return child_val_rec.data, child_val_rec.size
	end
	function node:close()
		if is_open then
			if fk_cur then fk_cur:close(); fk_cur = nil end
			if parent_cur then parent_cur:close(); parent_cur = nil end
			if child_cur then child_cur:close(); child_cur = nil end
			is_open = false
		end
	end
	function node:merge_key() return mk_rec.data, mk_rec.size end
	function node:pk(name)
		if not has_pair then return end
		if name == nil or name == parent_member
		then return true, mk_rec.data, mk_rec.size
		elseif name == child_member then
			if not has_child then return end -- left-join: parent present, child absent
			return true, pk_rec.data, pk_rec.size
		end
	end
	function node:compile_col(member, col)
		if member == parent_member then
			return db:compile_col(parent_schema, col, nil, mk_rec, get_parent_val)
		elseif member == child_member then
			local inner = db:compile_col(child_schema, col, nil, pk_rec, get_child_val)
			return function() return has_child and inner() or nil end
		end
	end
	--[[
	opts.left: once the FK index is exhausted, sweep for driver elements
	that never matched a child and emit them with child absent. No sort
	needed: the spec allows this tail unordered, unlike the matched rows
	above (see mdbx_query_validators.md).
	]]
	local function sweep()
		if u32_driver_set then
			while true do
				local q, q_sz, idx = driver_set:next()
				if not q then return end
				if matched[idx] == 0 then
					mk_rec.data = q; mk_rec.size = q_sz
					break
				end
			end
		else
			if sweep_done then return end
			local key
			repeat
				key = next(driver_set, sweep_key)
				sweep_key = key
			until not key or not driver_set[key]
			if not key then sweep_done = true; return end
			mk_rec.data = key; mk_rec.size = #key
		end
		parent_base_seeked = false
		has_pair = true; has_child = false
		return true
	end
	function node:next_group()
		has_pair = false; has_child = false
		if sweeping then return sweep() end
		if not fk_cur then fk_cur = db:cursor(fk_schema.name) end
		while true do
			if in_match then
				if fk_cur:move_raw_into(C.MDBX_NEXT_DUP, mk_rec, pk_rec) then
					parent_base_seeked = false; child_base_seeked = false
					has_pair = true; has_child = true; return true
				end
				in_match = false
			end
			if not fk_cur:move_raw_into(op, mk_rec, pk_rec) then
				if left_join then sweeping = true; return sweep() end
				return
			end
			op = C.MDBX_NEXT_NODUP
			local found
			if u32_driver_set then
				local idx = driver_set:index_of(mk_rec.data)
				found = idx >= 0
				if found and matched then matched[idx] = 1 end
			else
				local key = str(mk_rec.data, mk_rec.size)
				found = driver_set[key] ~= nil
				if found then driver_set[key] = true end
			end
			if found then
				in_match = true
				parent_base_seeked = false; child_base_seeked = false
				has_pair = true; has_child = true; return true
			end
		end
	end
	function node:open(params)
		assert(not is_open, 'node already open')
		driver:open(params)
		if u32_driver_set then
			driver_set = u32_keyset()
			local n = 0
			while driver:next_item() do
				local _, p = driver:pk()
				driver_set:add(p)
				n = n + 1
			end
			driver_set:sort()
			if left_join then matched = u8a(n) end
		else
			driver_set = {}
			while driver:next_item() do
				local _, p, p_sz = driver:pk()
				driver_set[str(p, p_sz)] = false
			end
		end
		driver:close()
		is_open = true
		has_pair = false; has_child = false
		parent_base_seeked = false; child_base_seeked = false
		in_match = false; op = C.MDBX_FIRST
		sweeping = false; sweep_key = nil; sweep_done = false
	end
	return node
end
