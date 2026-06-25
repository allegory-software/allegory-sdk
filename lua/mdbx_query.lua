--[[

	mdbx_query: query engine over mdbx_schema tables and indexes.
	Written by Cosmin Apreutesei. Public Domain.

API
	db:<node>(args...) -> node    build a plan node (see mdbx_query.md).
	node:open()                   prepare the node for execution (single use).
	node:explain() -> t           node metadata, no row reads.

NODE INTERFACE

	Iteration is two-level: merge-key groups and PKs within a group.

	For a base-table node, each row is its own group (one PK per group).
	For an index node (DUPSORT), each distinct index key is a group; the
	duplicate list under that key is the PK list within the group.

		node:merge_key() -> k, k_sz   current merge key (index key or base PK).
		node.merge_cmp()              schema-aware comparator for merge_key bytes.
		node.merge_sig                key-encoding signature; must match across
		                              inputs to a merge node.

		node:next_group() -> true|nil  advance to first PK of the next group.
		node:next_pk()    -> true|nil  advance to next PK within the current group.
		                               noop (always nil) on base-table nodes and
		                               on pk_seek, where each PK is its own group.
		node:reset_group()             rewind to the first PK of the current group.

	The next_group / next_pk split exists for merge_join: convergence uses
	next_group (and skip_to) to align inputs on a common merge_key, then
	next_pk / reset_group enumerate all combinations of PKs within that group
	(advance the rightmost input; when it exhausts, reset it and advance the
	next one left, like counting with carries).

		node:skip_to(k, k_sz) -> true|nil  seek to first group with merge_key >= k.
		                                   base class fallback calls next_group once
		                                   (correct, O(n)); proper implementations
		                                   use MDBX_SET_RANGE (O(log n)).

	skip_to is what makes merge convergence efficient: instead of stepping
	forward one group at a time, a lagging input jumps directly to the target.

		node:get_pk([name]) -> true, k, k_sz | nil

	Returns the current PK bytes (or nil when not positioned). The optional name
	filters by member: in a PK tuple stream from merge_join, multiple nodes
	contribute PKs under different member names; get_pk(name) lets the caller
	address a specific one.

		node:get_cols(member, cols) -> true, v... | nil

	Decodes and returns column values for the named member. cols is a list of
	column names; values are returned positionally in the same order. Returns nil
	when not positioned or member does not match. Base-table nodes decode from
	their primary cursor; index nodes open a lazy secondary cursor on the base
	table (sought on each call). Merge nodes delegate to the matching input.

]]

if not ... then require'mdbx_query_test'; return end

require'mdbx_schema'

local C  = C
local Db = mdbx_db
local key_gt = Db.key_gt
local key_ge = Db.key_ge
local key_lt = Db.key_lt
local key_le = Db.key_le
local key_eq = Db.key_eq

--schema resolution ----------------------------------------------------------

local function resolve(db, name)
	local schema = db:table_schema(name)
	assertf(schema, 'unknown table or index: %s', tostring(name))
	return schema
end

local function check_base_table(schema, op, name)
	assertf(not schema.is_index, '%s: base table expected, got index: %s', op, name)
end

local function check_index(schema, op, name)
	assertf(schema.is_index, '%s: index expected, got base table: %s', op, name)
end

local function check_node(x, op, n)
	assertf(x and x.members, '%s: arg %d: query node expected', op, n)
end
local function check_pk_node(x, op, n)
	assertf(x and x.members and x.item ~= 'value', '%s: arg %d: pk node expected', op, n)
end
local function check_value_node(x, op, n)
	assertf(x and x.item == 'value', '%s: arg %d: value node expected', op, n)
end
local function check_flat_pk(x, op, role)
	assertf(#x.members == 1, '%s: %s must be a flat pk stream', op, role)
end
local function check_fn(f, op, n)
	assertf(type(f) == 'function', '%s: arg %d: function expected', op, n)
end
local function check_merge_compat(inputs, n, op)
	assertf(inputs[1].merge_cmp, '%s: input 1 has no merge_cmp', op)
	for i = 2, n do
		assertf(inputs[i].merge_sig == inputs[1].merge_sig,
			'%s: input %d merge key incompatible with input 1', op, i)
	end
end
local function check_driver_member(driver, schema, op)
	assertf(#driver.members == 1 and driver.members[1] == schema.name,
		'%s: driver member must be %s', op, schema.name)
end

--NODE BASE CLASS ------------------------------------------------------------

--a node kind is `Db.<kind> = object(Db.query_node)` with a `:__call(db, ...)`
--constructor that stores `open` plus explain metadata in the instance.
--Shared behavior lives here; instances inherit kind-level constants (kind, item,
--unique, source, work) and store per-node data. open() installs next_group/get_pk.
Db.query_node = object()

function Db.query_node:open()
	error(self.kind..': open not implemented yet')
end
Db.query_node.next_group  = noop
Db.query_node.next_pk     = noop
Db.query_node.reset_group = noop
Db.query_node.close       = noop
function Db.query_node:skip_to(target, target_sz)
	return self:next_group()
end

function Db.query_node:explain()
	return {
		kind    = self.kind,
		item    = self.item,
		members = self.members and {unpack(self.members)} or nil,
		order   = self.order and imap(self.order,
			function(o) return o.col..' '..o.dir end) or nil,
		unique  = self.unique,
		source  = self.source,
		work    = self.work,
	}
end

--ACCESS NODES ---------------------------------------------------------------

local function key_cmp(a, a_sz, b, b_sz)
	return key_eq(a, a_sz, b, b_sz) and 0 or key_gt(a, a_sz, b, b_sz) and 1 or -1
end

-- pk_get: single base-table PK lookup; returns zero or one PK item.
-- Usage: db:pk_get(table_name, pk_val...)  -- pk_val count must equal PK column count.
Db.pk_get = object(Db.query_node, {
	kind   = 'pk_get',
	item   = 'pk',
	unique = true,
	source = 'pk_bytes',
	work   = 'base-table key lookup',
})
function Db.pk_get:__call(db, tab, ...)
	local schema = resolve(db, tab)
	check_base_table(schema, 'pk_get', tab)
	local npk = select('#', ...)
	assertf(npk == #schema.key_fields,
		'pk_get: %s needs %d pk value(s), got %d',
		schema.name, #schema.key_fields, npk)
	local sz = mdbx_encode_key(db, schema, 'get', nil,
		mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, schema.key_cols, nil, ...)
	local pk_key = u8a(sz); copy(pk_key, mdbx_key_rec_buffer, sz)
	local node = object(self, {
		members = {schema.name},
		order   = {{col = schema.name..'.pk', dir = 'asc'}},
	})
	function node:open()
		local dbi = assert(db:try_dbi(schema.name))
		local cur = db:cursor_raw(dbi)
		cur.schema = schema
		local cur_alive = true
		function node:close() if cur_alive then cur:close(); cur_alive = false end end
		local done = false
		local has_pk
		function node:get_pk(name)
			if has_pk and (name == nil or name == schema.name) then
				return true, pk_key, sz
			end
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			if member ~= nil and member ~= schema.name then return end
			return cur:try_current(cols)
		end
		function node:next_group()
			if done then has_pk = nil; return end
			done = true
			has_pk = cur:move_raw(C.MDBX_SET_KEY, pk_key, sz)
			if not has_pk then return end
			return true
		end
	end
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	return node
end

-- pk_seek: exact index key lookup; returns all PKs stored under that key in PK order.
-- Usage: db:pk_seek(ix_name, key_val...)  -- key_val count must equal the index key column count.
Db.pk_seek = object(Db.query_node, {
	kind   = 'pk_seek',
	item   = 'pk',
	unique = true,
	source = 'index cursor',
	work   = 'index key seek',
})
function Db.pk_seek:__call(db, ix_name, ...)
	local schema = resolve(db, ix_name)
	check_index(schema, 'pk_seek', ix_name)
	local nk = select('#', ...)
	assertf(nk == #schema.key_fields,
		'pk_seek: %s needs %d key value(s), got %d',
		schema.name, #schema.key_fields, nk)
	local sz = mdbx_encode_key(db, schema, 'seek', nil,
		mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, schema.key_cols, nil, ...)
	local ix_key = u8a(sz); copy(ix_key, mdbx_key_rec_buffer, sz)
	local val_schema = schema.val_schema
	local node = object(self, {
		members = {val_schema.name},
		order   = {{col = val_schema.name..'.pk', dir = 'asc'}},
	})
	function node:open()
		local dbi = assert(db:try_dbi(schema.name))
		local cur = db:cursor_raw(dbi)
		self.cursor = cur
		local base_dbi = assert(db:try_dbi(val_schema.name))
		local base_cur
		local cur_alive = true
		function node:close()
			if cur_alive then
				cur:close()
				if base_cur then base_cur:close() end
				cur_alive = false
			end
		end
		local has_pk, pk, pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == val_schema.name) then
				return true, pk, pk_sz
			end
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			if member ~= nil and member ~= val_schema.name then return end
			if not base_cur then base_cur = db:cursor_raw(base_dbi); base_cur.schema = val_schema end
			if not base_cur:move_raw(C.MDBX_SET_KEY, pk, pk_sz) then return end
			return base_cur:try_current(cols)
		end
		function node:merge_key() return pk, pk_sz end
		local fixedsize = schema.dup_fixedsize
		if fixedsize then
			--DUPFIXED: bulk pk iteration via MDBX_GET_MULTIPLE / MDBX_NEXT_MULTIPLE.
			--merge_key = pk value; each dup is a separate group; next_pk = noop.
			local ok, v, v_sz, v_o
			local first = true
			function node:next_group()
				if first then
					first = false
					ok, v, v_sz = cur:find_multiple_raw(ix_key, sz)
					if not ok then has_pk = nil; return end
					v_o = 0
				else
					if v_o >= v_sz then
						ok, v, v_sz = cur:next_multiple_raw()
						if not ok then has_pk = nil; return end
						v_o = 0
					end
				end
				pk = v + v_o; pk_sz = fixedsize; has_pk = true
				v_o = v_o + fixedsize
				return true
			end
		else
			--non-DUPFIXED: one dup at a time.
			--merge_key = pk value; each dup is a separate group; next_pk = noop.
			local first = true
			function node:next_group()
				local ok2, v, v_sz
				if first then
					first = false
					if not cur:move_raw(C.MDBX_SET_KEY, ix_key, sz) then has_pk = nil; return end
					ok2, v, v_sz = cur:move_raw_v(C.MDBX_GET_CURRENT)
				else
					ok2, v, v_sz = cur:move_raw_v(C.MDBX_NEXT_DUP)
				end
				if not ok2 then has_pk = nil; return end
				has_pk, pk, pk_sz = true, v, v_sz
				return true
			end
			function node:skip_to(target, target_sz)
				local ok2, v, v_sz = cur:find_dup_ge_raw(ix_key, sz, target, target_sz)
				if not ok2 then has_pk = nil; return end
				has_pk, pk, pk_sz = true, v, v_sz
				op = C.MDBX_NEXT_DUP
				return true
			end
		end
	end
	node.merge_cmp = key_cmp
	node.merge_sig = val_schema.key_sig
	return node
end

-- pk_range: key range scan on an index or base table, returning PKs in key order.
-- For an index (DUPSORT): merge_key = index key bytes; pk = dup (child PK) bytes.
-- For a base table:       merge_key = pk = base table key bytes.
-- Bounds: op ('>'|'>='|'<'|'<=') followed by one value per key column; null sentinel ok.
-- opts: desc (scan backward).
-- Usage: db:pk_range(name [, op, val... [, op, val...] [, opts]])
Db.pk_range = object(Db.query_node, {
	kind   = 'pk_range',
	item   = 'pk',
	unique = true,
	source = 'cursor',
	work   = 'key range scan',
})
function Db.pk_range:__call(db, name, ...)
	local schema = resolve(db, name)
	local is_index = schema.is_index
	local nkey = #schema.key_fields
	local n = select('#', ...)
	local nv, opts = n, {}
	if n >= 1 and type((select(n, ...))) == 'table' then
		opts = (select(n, ...)); nv = n - 1
	end
	assertf(nv == 0 or nv == nkey+1 or nv == 2*(nkey+1),
		'pk_range: %s: invalid args', schema.name)
	local lo_key, lo_sz, hi_key, hi_sz, lo_open, hi_open
	if nv > 0 then
		local op = (select(1, ...))
		local sz = mdbx_encode_key(db, schema, 'range', nil,
			mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, schema.key_cols, nil, select(2, ...))
		local k = u8a(sz); copy(k, mdbx_key_rec_buffer, sz)
		if op=='>=' or op=='>' then lo_key, lo_sz, lo_open = k, sz, op=='>'
		else hi_key, hi_sz, hi_open = k, sz, op=='<' end
	end
	if nv > nkey+1 then
		local op = (select(nkey+2, ...))
		local sz = mdbx_encode_key(db, schema, 'range', nil,
			mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, schema.key_cols, nil, select(nkey+3, ...))
		local k = u8a(sz); copy(k, mdbx_key_rec_buffer, sz)
		if op=='>=' or op=='>' then lo_key, lo_sz, lo_open = k, sz, op=='>'
		else hi_key, hi_sz, hi_open = k, sz, op=='<' end
	end
	local desc = opts.desc
	if lo_key and hi_key then
		assertf(not key_gt(lo_key, lo_sz, hi_key, hi_sz),
			'pk_range: %s: lo bound exceeds hi bound', schema.name)
	end
	local member_schema = is_index and schema.val_schema or schema
	local dir = desc and 'desc' or 'asc'
	local order = {}
	for _, f in ipairs(schema.key_fields) do
		order[#order+1] = {col = member_schema.name..'.'..f.col, dir = dir}
	end
	if is_index then
		order[#order+1] = {col = member_schema.name..'.pk', dir = dir}
	end
	local node = object(self, {
		members = {member_schema.name},
		order   = order,
	})
	function node:open()
		local dbi = assert(db:try_dbi(schema.name))
		local cur = db:cursor_raw(dbi)
		self.cursor = cur
		if not is_index then cur.schema = schema end
		local base_dbi = is_index and assert(db:try_dbi(member_schema.name))
		local base_cur
		local cur_alive = true
		function node:close()
			if cur_alive then
				cur:close()
				if base_cur then base_cur:close() end
				cur_alive = false
			end
		end
		local has_pk
		local cur_mk, cur_mk_sz  --current merge_key (always the MDBX key)
		local cur_pk, cur_pk_sz  --current pk: dup for index, key for base table
		function node:get_pk(name)
			if has_pk and (name == nil or name == member_schema.name) then
				return true, cur_pk, cur_pk_sz
			end
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			if member ~= nil and member ~= member_schema.name then return end
			if is_index then
				if not base_cur then base_cur = db:cursor_raw(base_dbi); base_cur.schema = member_schema end
				if not base_cur:move_raw(C.MDBX_SET_KEY, cur_pk, cur_pk_sz) then return end
				return base_cur:try_current(cols)
			else
				return cur:try_current(cols)
			end
		end
		function node:merge_key() return cur_mk, cur_mk_sz end
		local cmp_hi = hi_open and key_ge or key_gt
		local cmp_lo = lo_open and key_le or key_lt
		local function set_current(k, k_sz, v, v_sz)
			cur_mk, cur_mk_sz = k, k_sz
			if is_index then
				cur_pk, cur_pk_sz = v, v_sz
			else
				cur_pk, cur_pk_sz = k, k_sz
			end
			has_pk = true
		end
		local ok, k, k_sz, v, v_sz
		if not desc then
			if lo_key then
				ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_SET_RANGE, lo_key, lo_sz)
				if not ok then return end
				if lo_open and key_eq(k, k_sz, lo_key, lo_sz) then
					ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_NEXT_NODUP)
					if not ok then return end
				end
			else
				ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_FIRST)
				if not ok then return end
			end
			if hi_key and cmp_hi(k, k_sz, hi_key, hi_sz) then return end
		else
			if hi_key then
				ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_TO_KEY_LESSER_OR_EQUAL, hi_key, hi_sz)
				if not ok then return end
				local skip = hi_open and key_eq(k, k_sz, hi_key, hi_sz)
				if skip then
					ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_PREV_NODUP)
					if not ok then return end
				elseif is_index then
					ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_LAST_DUP)
					if not ok then return end
				end
			else
				ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_LAST)
				if not ok then return end
			end
			if lo_key and cmp_lo(k, k_sz, lo_key, lo_sz) then return end
		end
		set_current(k, k_sz, v, v_sz)
		local first    = true
		local adv_group = desc and (is_index and C.MDBX_PREV_NODUP or C.MDBX_PREV)
		                       or  (is_index and C.MDBX_NEXT_NODUP or C.MDBX_NEXT)
		local adv_pk   = desc and C.MDBX_PREV_DUP or C.MDBX_NEXT_DUP
		local bnd_key  = desc and lo_key  or hi_key
		local bnd_sz   = desc and lo_sz   or hi_sz
		local cmp_bnd  = desc and cmp_lo  or cmp_hi
		function node:next_group()
			if first then first = false; return true end
			local ok2, k2, k2_sz, v2, v2_sz = cur:move_raw_kv(adv_group)
			if not ok2 then has_pk = nil; return end
			if bnd_key and cmp_bnd(k2, k2_sz, bnd_key, bnd_sz) then
				has_pk = nil; return
			end
			set_current(k2, k2_sz, v2, v2_sz)
			return true
		end
		if is_index then
			function node:next_pk()
				local ok2, k2, k2_sz, v2, v2_sz = cur:move_raw_kv(adv_pk)
				if not ok2 then has_pk = nil; return end
				set_current(k2, k2_sz, v2, v2_sz)
				return true
			end
		end
		if not desc then
			function node:skip_to(target, target_sz)
				local ok2, k2, k2_sz, v2, v2_sz = cur:move_raw_kv(C.MDBX_SET_RANGE, target, target_sz)
				if not ok2 then has_pk = nil; return end
				if hi_key and cmp_hi(k2, k2_sz, hi_key, hi_sz) then has_pk = nil; return end
				set_current(k2, k2_sz, v2, v2_sz)
				first = false
				return true
			end
			if is_index then
				function node:reset_group()
					local ok2, k2, k2_sz, v2, v2_sz = cur:move_raw_kv(C.MDBX_SET_KEY, cur_mk, cur_mk_sz)
					if not ok2 then return end
					set_current(k2, k2_sz, v2, v2_sz)
					return true
				end
			end
		end
	end
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	return node
end

-- pk_prefix: composite index scan by leading equality prefix.
-- Scans all index entries whose first nk key columns equal the given values,
-- returning PKs in index-key order (full key asc, PK asc within each key).
-- Usage: db:pk_prefix(ix_name, val...)  -- val count must be 1..n-1 for an n-column index.
Db.pk_prefix = object(Db.query_node, {
	kind   = 'pk_prefix',
	item   = 'pk',
	unique = true,
	source = 'index cursor',
	work   = 'index key prefix scan',
})

function Db.pk_prefix:__call(db, ix_name, ...)
	local schema = resolve(db, ix_name)
	check_index(schema, 'pk_prefix', ix_name)
	local nk = select('#', ...)
	local nkey = #schema.key_fields
	assertf(nk >= 1 and nk < nkey,
		'pk_prefix: %s needs 1..%d prefix column(s), got %d',
		schema.name, nkey - 1, nk)
	local sz = mdbx_encode_key_prefix(db, schema, 'prefix',
		mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, nk, ...)
	local ix_key = u8a(sz); copy(ix_key, mdbx_key_rec_buffer, sz)
	local val_schema = schema.val_schema
	local order = {}
	for _, f in ipairs(schema.key_fields) do
		order[#order+1] = {col = val_schema.name..'.'..f.col, dir = 'asc'}
	end
	order[#order+1] = {col = val_schema.name..'.pk', dir = 'asc'}
	local node = object(self, {
		members = {val_schema.name},
		order   = order,
	})
	function node:open()
		local dbi = assert(db:try_dbi(schema.name))
		local cur = db:cursor_raw(dbi)
		local base_dbi = assert(db:try_dbi(val_schema.name))
		local base_cur
		local cur_alive = true
		function node:close()
			if cur_alive then
				cur:close()
				if base_cur then base_cur:close() end
				cur_alive = false
			end
		end
		local has_pk
		local cur_mk, cur_mk_sz
		local cur_pk, cur_pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == val_schema.name) then
				return true, cur_pk, cur_pk_sz
			end
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			if member ~= nil and member ~= val_schema.name then return end
			if not base_cur then base_cur = db:cursor_raw(base_dbi); base_cur.schema = val_schema end
			if not base_cur:move_raw(C.MDBX_SET_KEY, cur_pk, cur_pk_sz) then return end
			return base_cur:try_current(cols)
		end
		function node:merge_key() return cur_mk, cur_mk_sz end
		local ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_SET_RANGE, ix_key, sz)
		if not ok or k_sz < sz or memcmp(k, ix_key, sz) ~= 0 then return end
		cur_mk, cur_mk_sz = k, k_sz
		cur_pk, cur_pk_sz = v, v_sz
		has_pk = true
		local first = true
		function node:next_group()
			if first then first = false; return true end
			local ok3, k3, k3_sz, v3, v3_sz = cur:move_raw_kv(C.MDBX_NEXT_NODUP)
			if not ok3 or k3_sz < sz or memcmp(k3, ix_key, sz) ~= 0 then
				has_pk = nil; return
			end
			cur_mk, cur_mk_sz = k3, k3_sz
			cur_pk, cur_pk_sz = v3, v3_sz
			has_pk = true
			return true
		end
		function node:next_pk()
			local ok2, v2, v2_sz = cur:move_raw_v(C.MDBX_NEXT_DUP)
			if not ok2 then has_pk = nil; return end
			cur_pk, cur_pk_sz = v2, v2_sz
			return true
		end
		function node:skip_to(target, target_sz)
			local ok2, k2, k2_sz, v2, v2_sz = cur:move_raw_kv(C.MDBX_SET_RANGE, target, target_sz)
			if not ok2 or k2_sz < sz or memcmp(k2, ix_key, sz) ~= 0 then
				has_pk = nil; return
			end
			cur_mk, cur_mk_sz = k2, k2_sz
			cur_pk, cur_pk_sz = v2, v2_sz
			has_pk = true
			first = false
			return true
		end
		function node:reset_group()
			local ok2, k2, k2_sz, v2, v2_sz = cur:move_raw_kv(C.MDBX_SET_KEY, cur_mk, cur_mk_sz)
			if not ok2 then return end
			cur_mk, cur_mk_sz = k2, k2_sz
			cur_pk, cur_pk_sz = v2, v2_sz
			has_pk = true
			return true
		end
	end
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	return node
end

-- fk_parent_scan: scan distinct child FK index keys and return matching parent PKs.
-- Each distinct FK key (NEXT_NODUP) whose components are all non-null is a parent PK.
-- Returns parent PKs in ascending PK order (FK index key order = parent PK order).
-- Usage: db:fk_parent_scan(child_fk_index_name)
Db.fk_parent_scan = object(Db.query_node, {
	kind   = 'fk_parent_scan',
	item   = 'pk',
	unique = true,
	source = 'index cursor',
	work   = 'FK index distinct key scan',
})
function Db.fk_parent_scan:__call(db, ix_name)
	local schema = resolve(db, ix_name)
	check_index(schema, 'fk_parent_scan', ix_name)
	local val_schema = schema.val_schema
	--find the FK that uses this index
	local fk
	for _, f in pairs(val_schema.fks or {}) do
		if f.index == schema then fk = f; break end
	end
	assertf(fk, 'fk_parent_scan: %s is not a FK index', ix_name)
	local parent_schema = resolve(db, fk.ref_table)
	assertf(#fk.ref_cols == #parent_schema.key_fields,
		'fk_parent_scan: %s does not reference the full parent PK', ix_name)
	--all key cols must be not_null; null FK support is not yet implemented
	for _, f in ipairs(schema.key_fields) do
		assertf(f.not_null, 'fk_parent_scan: nullable FK col not supported: %s', f.col)
	end
	local node = object(self, {
		members = {parent_schema.name},
		order   = {{col = parent_schema.name..'.pk', dir = 'asc'}},
	})
	function node:open()
		local dbi = assert(db:try_dbi(schema.name))
		local cur = db:cursor_raw(dbi)
		self.cursor = cur
		local cur_alive = true
		function node:close() if cur_alive then cur:close(); cur_alive = false end end
		local op = C.MDBX_FIRST
		local has_pk, pk, pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == parent_schema.name) then
				return true, pk, pk_sz
			end
		end
		function node:merge_key() return pk, pk_sz end
		function node:skip_to(target, target_sz)
			has_pk, pk, pk_sz = cur:move_raw_kv(C.MDBX_SET_RANGE, target, target_sz)
			op = C.MDBX_NEXT_NODUP
			if not has_pk then return end
			return true
		end
		function node:next_group()
			has_pk, pk, pk_sz = cur:move_raw_kv(op)
			op = C.MDBX_NEXT_NODUP
			if not has_pk then return end
			return true
		end
	end
	node.merge_cmp = key_cmp
	node.merge_sig = parent_schema.key_sig
	return node
end

--MERGE NODES ----------------------------------------------------------------

-- Marks a node as optional (left outer) in db:merge_join.
-- Usage: db:merge_join(required_node, db.left(optional_node), ...)
Db.left = function(node) return {left = node} end

-- merge_join: n-ary parallel merge join on merge_key bytes.
-- inputs: access nodes exposing merge_key(), pk(), get_pk(), next_group(), next_pk(), reset_group(), skip_to().
-- Wrap optional inputs with db.left(node) for left outer join semantics.
-- Usage: db:merge_join(node [, db.left(node)] ...)
Db.merge_join = object(Db.query_node, {
	kind   = 'merge_join',
	item   = 'pk_tuple',
	unique = false,
	source = 'merge',
	work   = 'parallel merge join',
})
function Db.merge_join:__call(db, ...)
	local n = select('#', ...)
	assertf(n >= 2, 'merge_join: need at least 2 inputs, got %d', n)
	local inputs = {}
	local optional = {}
	local any_optional = false
	for i = 1, n do
		local inp = select(i, ...)
		if type(inp) == 'table' and inp.left then
			inp = inp.left; optional[i] = true; any_optional = true
		end
		check_pk_node(inp, 'merge_join', i)
		inputs[i] = inp
	end
	assertf(not optional[1], 'merge_join: first input must not be db.left')
	check_merge_compat(inputs, n, 'merge_join')
	local merge_cmp = inputs[1].merge_cmp
	local members = {}
	local order = {}
	for i = 1, n do
		for _, m in ipairs(inputs[i].members) do members[#members+1] = m end
		if inputs[i].order then
			for _, x in ipairs(inputs[i].order) do order[#order+1] = x end
		end
	end
	local node = object(self, {members = members, order = #order > 0 and order or nil})
	node.merge_cmp = inputs[1].merge_cmp
	node.merge_sig = inputs[1].merge_sig
	function node:open()
		for i = 1, n do inputs[i]:open() end
		function node:close() for i = 1, n do inputs[i]:close() end end
		function node:next_group() return node:next() end
		local mk    = {}
		local mk_sz = {}
		for i = 1, n do
			if inputs[i]:next_group() then mk[i], mk_sz[i] = inputs[i]:merge_key() end
		end
		local matched = any_optional and {} or nil
		local yielded = false
		function node:merge_key() return mk[1], mk_sz[1] end
		function node:skip_to(target, target_sz)
			for i = 1, n do
				if mk[i] ~= nil and merge_cmp(mk[i], mk_sz[i], target, target_sz) < 0 then
					if inputs[i]:skip_to(target, target_sz) then mk[i], mk_sz[i] = inputs[i]:merge_key()
					else mk[i] = nil end
				end
			end
			yielded = false
			return node:next()
		end
		function node:get_pk(name)
			if not yielded then return end
			for i = 1, n do
				if not matched or not optional[i] or matched[i] then
					local ok, p, sz = inputs[i]:get_pk(name)
					if ok then return true, p, sz end
				end
			end
		end
		function node:get_cols(member, cols)
			if not yielded then return end
			for i = 1, n do
				if not matched or not optional[i] or matched[i] then
					for _, m in ipairs(inputs[i].members) do
						if m == member then return inputs[i]:get_cols(member, cols) end
					end
				end
			end
		end
		function node:next()
			if yielded then
				local any_matched = not matched
				if matched then
					for i = 2, n do if matched[i] then any_matched = true; break end end
				end
				if any_matched then
					-- odometer over participating inputs (rightmost first)
					local advanced = false
					local reset_from = n + 1
					for i = n, 1, -1 do
						if not matched or not optional[i] or matched[i] then
							if inputs[i]:next_pk() then
								advanced = true; reset_from = i + 1; break
							end
						end
					end
					if advanced then
						for i = reset_from, n do
							if not matched or not optional[i] or matched[i] then
								inputs[i]:reset_group()
								mk[i], mk_sz[i] = inputs[i]:merge_key()
							end
						end
						return true
					end
					-- group done: advance all to next group
					for i = 1, n do
						if inputs[i]:next_group() then mk[i], mk_sz[i] = inputs[i]:merge_key()
						else mk[i] = nil end
					end
					if matched then for i = 1, n do matched[i] = false end end
				else
					-- left-outer no-match: advance input 1 only
					if inputs[1]:next_pk() then return true end
					if inputs[1]:next_group() then mk[1], mk_sz[1] = inputs[1]:merge_key()
					else mk[1] = nil end
				end
			end
			yielded = false
			while true do
				if mk[1] == nil then return end
				if not any_optional then
					-- inner join: each_and convergence over all inputs
					local max_i = 1
					for i = 2, n do
						if mk[i] == nil then return end
						if merge_cmp(mk[i], mk_sz[i], mk[max_i], mk_sz[max_i]) > 0 then max_i = i end
					end
					local all_eq = true
					for i = 1, n do
						if merge_cmp(mk[i], mk_sz[i], mk[max_i], mk_sz[max_i]) ~= 0 then
							all_eq = false
							if inputs[i]:skip_to(mk[max_i], mk_sz[max_i]) then
								mk[i], mk_sz[i] = inputs[i]:merge_key()
							else
								mk[i] = nil; return
							end
						end
					end
					if all_eq then yielded = true; return true end
				else
					-- left outer: align optional inputs to input 1
					for i = 2, n do
						matched[i] = false
						if mk[i] ~= nil then
							local c = merge_cmp(mk[i], mk_sz[i], mk[1], mk_sz[1])
							if c < 0 then
								if inputs[i]:skip_to(mk[1], mk_sz[1]) then
									mk[i], mk_sz[i] = inputs[i]:merge_key()
									matched[i] = merge_cmp(mk[i], mk_sz[i], mk[1], mk_sz[1]) == 0
								else
									mk[i] = nil
								end
							elseif c == 0 then
								matched[i] = true
							end
						end
					end
					yielded = true; return true
				end
			end
		end
	end
	return node
end

-- merge_union: n-ary sorted-merge union on merge_key bytes.
-- mode='union' (default): dedup, get_pk from the yielding input only.
-- mode='full': dedup, get_pk from all inputs at the yielded key (full outer join).
-- mode='union_all': no dedup, advance only the yielding input each step.
-- Inputs must be unique (one pk per next_group call); non-unique inputs are not supported.
-- Usage: db:merge_union(['union'|'full'|'union_all',] node, node, ...)
Db.merge_union = object(Db.query_node, {
	kind   = 'merge_union',
	item   = 'pk',
	unique = true,
	source = 'merge',
	work   = 'parallel merge union',
})
function Db.merge_union:__call(db, mode, ...)
	if not isstr(mode) then return db:merge_union('union', mode, ...) end
	assertf(mode=='union' or mode=='full' or mode=='union_all',
		'merge_union: invalid mode %q', mode)
	local n = select('#', ...)
	assertf(n >= 2, 'merge_union: need at least 2 inputs, got %d', n)
	local inputs = {}
	for i = 1, n do
		local inp = (select(i, ...))
		check_pk_node(inp, 'merge_union', i)
		inputs[i] = inp
	end
	check_merge_compat(inputs, n, 'merge_union')
	local merge_cmp = inputs[1].merge_cmp
	local members = {}
	local seen = {}
	for i = 1, n do
		for _, m in ipairs(inputs[i].members) do
			if not seen[m] then seen[m] = true; members[#members+1] = m end
		end
	end
	local node = object(self, {members = members, order = inputs[1].order})
	node.merge_cmp = merge_cmp
	node.merge_sig = inputs[1].merge_sig
	function node:open()
		for i = 1, n do inputs[i]:open() end
		function node:close() for i = 1, n do inputs[i]:close() end end
		function node:next_group() return node:next() end
		local mk    = {}
		local mk_sz = {}
		for i = 1, n do
			if inputs[i]:next_group() then mk[i], mk_sz[i] = inputs[i]:merge_key() end
		end
		local to_adv = mode ~= 'union_all' and {} or nil
		local yielded = false
		local cur_i
		function node:merge_key() return inputs[cur_i]:merge_key() end
		function node:skip_to(target, target_sz)
			for i = 1, n do
				if mk[i] ~= nil and merge_cmp(mk[i], mk_sz[i], target, target_sz) < 0 then
					if inputs[i]:skip_to(target, target_sz) then mk[i], mk_sz[i] = inputs[i]:merge_key()
					else mk[i] = nil end
				end
			end
			yielded = false
			return node:next()
		end
		function node:get_pk(name)
			if not yielded then return end
			if mode == 'full' then
				for i = 1, n do
					if to_adv[i] then
						local ok, p, sz = inputs[i]:get_pk(name)
						if ok then return true, p, sz end
					end
				end
			else
				return inputs[cur_i]:get_pk(name)
			end
		end
		function node:get_cols(member, cols)
			if not yielded then return end
			if mode == 'full' then
				for i = 1, n do
					if to_adv[i] then
						for _, m in ipairs(inputs[i].members) do
							if m == member then return inputs[i]:get_cols(member, cols) end
						end
					end
				end
			else
				return inputs[cur_i]:get_cols(member, cols)
			end
		end
		function node:next()
			if yielded then
				if mode == 'union_all' then
					if inputs[cur_i]:next_group() then mk[cur_i], mk_sz[cur_i] = inputs[cur_i]:merge_key()
					else mk[cur_i] = nil end
				else
					for i = 1, n do
						if to_adv[i] then
							to_adv[i] = false
							if inputs[i]:next_group() then mk[i], mk_sz[i] = inputs[i]:merge_key()
							else mk[i] = nil end
						end
					end
				end
			end
			yielded = false
			local min_i
			for i = 1, n do
				if mk[i] ~= nil then
					if not min_i or merge_cmp(mk[i], mk_sz[i], mk[min_i], mk_sz[min_i]) < 0 then
						min_i = i
					end
				end
			end
			if not min_i then return end
			cur_i = min_i
			if mode ~= 'union_all' then
				for i = 1, n do
					if mk[i] ~= nil and merge_cmp(mk[i], mk_sz[i], mk[min_i], mk_sz[min_i]) == 0 then
						to_adv[i] = true
					end
				end
			end
			yielded = true
			return true
		end
	end
	return node
end

-- merge_except: set difference — yields merge_keys in input 1 that are absent from input 2.
-- Inputs must be unique (one pk per next_group call).
-- Usage: db:merge_except(a, b)
Db.merge_except = object(Db.query_node, {
	kind   = 'merge_except',
	item   = 'pk',
	unique = true,
	source = 'merge',
	work   = 'parallel merge except',
})
function Db.merge_except:__call(db, a, b)
	check_pk_node(a, 'merge_except', 1)
	check_pk_node(b, 'merge_except', 2)
	check_merge_compat({a, b}, 2, 'merge_except')
	local merge_cmp = a.merge_cmp
	local node = object(self, {members = a.members, order = a.order})
	node.merge_cmp = merge_cmp
	node.merge_sig = a.merge_sig
	function node:open()
		a:open(); b:open()
		function node:close() a:close(); b:close() end
		function node:next_group() return node:next() end
		local mk1, mk1_sz, mk2, mk2_sz
		if a:next_group() then mk1, mk1_sz = a:merge_key() end
		if b:next_group() then mk2, mk2_sz = b:merge_key() end
		local yielded = false
		function node:merge_key() return a:merge_key() end
		function node:skip_to(target, target_sz)
			if mk1 ~= nil and merge_cmp(mk1, mk1_sz, target, target_sz) < 0 then
				if a:skip_to(target, target_sz) then mk1, mk1_sz = a:merge_key() else mk1 = nil end
			end
			if mk2 ~= nil and merge_cmp(mk2, mk2_sz, target, target_sz) < 0 then
				if b:skip_to(target, target_sz) then mk2, mk2_sz = b:merge_key() else mk2 = nil end
			end
			yielded = false
			return node:next()
		end
		function node:get_pk(name)
			if not yielded then return end
			return a:get_pk(name)
		end
		function node:get_cols(member, cols)
			if not yielded then return end
			return a:get_cols(member, cols)
		end
		function node:next()
			if yielded then
				if a:next_group() then mk1, mk1_sz = a:merge_key() else mk1 = nil end
			end
			yielded = false
			while true do
				if mk1 == nil then return end
				if mk2 == nil then yielded = true; return true end
				local c = merge_cmp(mk1, mk1_sz, mk2, mk2_sz)
				if c < 0 then
					yielded = true; return true
				elseif c == 0 then
					if a:next_group() then mk1, mk1_sz = a:merge_key() else mk1 = nil end
					if b:next_group() then mk2, mk2_sz = b:merge_key() else mk2 = nil end
				else
					if b:skip_to(mk1, mk1_sz) then mk2, mk2_sz = b:merge_key() else mk2 = nil end
				end
			end
		end
	end
	return node
end

--PROBE NODES ----------------------------------------------------------------

local function find_fk(db, child_schema, fk_schema, caller, fk_name)
	for _, f in pairs(child_schema.fks or {}) do
		if f.index == fk_schema then return f, resolve(db, f.ref_table) end
	end
	assertf(false, '%s: %s is not a FK index', caller, fk_name)
end

-- pk_join_seek: nested join -- one MDBX_SET_KEY seek on the FK index per driver PK.
-- driver: any PK-stream node producing parent PKs; fk: FK index name.
-- Output: PK tuple stream in driver order; one seek per row, O(n log m).
-- Usage: db:pk_join_seek(driver, fk_ix_name)
Db.pk_join_seek = object(Db.query_node, {
	kind   = 'pk_join_seek',
	item   = 'pk_tuple',
	unique = false,
	source = 'probe',
	work   = 'FK index seek per driver row',
})
function Db.pk_join_seek:__call(db, driver, fk_name)
	check_pk_node(driver, 'pk_join_seek', 1)
	local fk_schema = resolve(db, fk_name)
	check_index(fk_schema, 'pk_join_seek', fk_name)
	local child_schema = fk_schema.val_schema
	local _, parent_schema = find_fk(db, child_schema, fk_schema, 'pk_join_seek', fk_name)
	check_driver_member(driver, parent_schema, 'pk_join_seek')
	local node = object(self, {
		members = {parent_schema.name, child_schema.name},
		order   = driver.order,
	})
	node.merge_cmp = driver.merge_cmp
	node.merge_sig = driver.merge_sig
	function node:open()
		driver:open()
		local fk_dbi    = assert(db:try_dbi(fk_schema.name))
		local fk_cur    = db:cursor_raw(fk_dbi)
		local child_dbi = assert(db:try_dbi(child_schema.name))
		local child_cur
		local cur_alive = true
		function node:close()
			if cur_alive then
				driver:close(); fk_cur:close()
				if child_cur then child_cur:close() end
				cur_alive = false
			end
		end
		local parent_pk, parent_pk_sz
		local child_pk, child_pk_sz
		local has_pair = false
		local in_match = false
		function node:merge_key() return parent_pk, parent_pk_sz end
		function node:get_pk(name)
			if not has_pair then return end
			if name == nil or name == parent_schema.name then return true, parent_pk, parent_pk_sz
			elseif name == child_schema.name then return true, child_pk, child_pk_sz end
		end
		function node:get_cols(member, cols)
			if not has_pair then return end
			if member == parent_schema.name then return driver:get_cols(member, cols) end
			if member == child_schema.name then
				if not child_cur then child_cur = db:cursor_raw(child_dbi); child_cur.schema = child_schema end
				if not child_cur:move_raw(C.MDBX_SET_KEY, child_pk, child_pk_sz) then return end
				return child_cur:try_current(cols)
			end
		end
		function node:next_group() return node:next() end
		local driver_started = false
		local function driver_next()
			if not driver_started then driver_started = true; return driver:next_group() end
			return driver:next_pk() or driver:next_group()
		end
		function node:next()
			has_pair = false
			while true do
				if in_match then
					local ok, v, v_sz = fk_cur:move_raw_v(C.MDBX_NEXT_DUP)
					if ok then child_pk, child_pk_sz = v, v_sz; has_pair = true; return true end
					in_match = false
				end
				if not driver_next() then return end
				local _, p, p_sz = driver:get_pk()
				parent_pk, parent_pk_sz = p, p_sz
				if fk_cur:move_raw(C.MDBX_SET_KEY, parent_pk, parent_pk_sz) then
					local ok3, v3, v3_sz = fk_cur:move_raw_v(C.MDBX_GET_CURRENT)
					if ok3 then
						child_pk, child_pk_sz = v3, v3_sz
						in_match = true
						has_pair = true; return true
					end
				end
			end
		end
	end
	return node
end

-- pk_join_hash: hash join -- materialise driver PKs into a set, scan FK index once.
-- driver: any PK-stream node producing parent PKs; fk: FK index name.
-- Output: PK tuple stream in FK index order (parent PK asc, child PK asc); O(n+m).
-- Usage: db:pk_join_hash(driver, fk_ix_name)
Db.pk_join_hash = object(Db.query_node, {
	kind   = 'pk_join_hash',
	item   = 'pk_tuple',
	unique = false,
	source = 'probe',
	work   = 'materialise driver + FK index scan',
})
function Db.pk_join_hash:__call(db, driver, fk_name)
	check_pk_node(driver, 'pk_join_hash', 1)
	local fk_schema = resolve(db, fk_name)
	check_index(fk_schema, 'pk_join_hash', fk_name)
	local child_schema = fk_schema.val_schema
	local _, parent_schema = find_fk(db, child_schema, fk_schema, 'pk_join_hash', fk_name)
	check_driver_member(driver, parent_schema, 'pk_join_hash')
	local node = object(self, {
		members = {parent_schema.name, child_schema.name},
		order   = {{col = parent_schema.name..'.pk', dir = 'asc'},
		           {col = child_schema.name..'.pk',  dir = 'asc'}},
	})
	node.merge_cmp = key_cmp
	node.merge_sig = parent_schema.key_sig
	function node:open()
		driver:open()
		local driver_set = {}
		while driver:next_group() do
			repeat
				local _, p, p_sz = driver:get_pk()
				driver_set[str(p, p_sz)] = true
			until not driver:next_pk()
		end
		driver:close()
		local fk_dbi     = assert(db:try_dbi(fk_schema.name))
		local fk_cur     = db:cursor_raw(fk_dbi)
		local parent_dbi = assert(db:try_dbi(parent_schema.name))
		local parent_cur
		local child_dbi  = assert(db:try_dbi(child_schema.name))
		local child_cur
		local cur_alive = true
		function node:close()
			if cur_alive then
				fk_cur:close()
				if parent_cur then parent_cur:close() end
				if child_cur  then child_cur:close()  end
				cur_alive = false
			end
		end
		local parent_pk, parent_pk_sz
		local child_pk, child_pk_sz
		local has_pair = false
		function node:merge_key() return parent_pk, parent_pk_sz end
		function node:get_pk(name)
			if not has_pair then return end
			if name == nil or name == parent_schema.name then return true, parent_pk, parent_pk_sz
			elseif name == child_schema.name then return true, child_pk, child_pk_sz end
		end
		function node:get_cols(member, cols)
			if not has_pair then return end
			if member == parent_schema.name then
				if not parent_cur then parent_cur = db:cursor_raw(parent_dbi); parent_cur.schema = parent_schema end
				if not parent_cur:move_raw(C.MDBX_SET_KEY, parent_pk, parent_pk_sz) then return end
				return parent_cur:try_current(cols)
			elseif member == child_schema.name then
				if not child_cur then child_cur = db:cursor_raw(child_dbi); child_cur.schema = child_schema end
				if not child_cur:move_raw(C.MDBX_SET_KEY, child_pk, child_pk_sz) then return end
				return child_cur:try_current(cols)
			end
		end
		local in_match = false
		local op = C.MDBX_FIRST
		function node:next_group() return node:next() end
		function node:next()
			has_pair = false
			while true do
				if in_match then
					local ok, k, k_sz, v, v_sz = fk_cur:move_raw_kv(C.MDBX_NEXT_DUP)
					if ok then
						parent_pk, parent_pk_sz = k, k_sz
						child_pk, child_pk_sz = v, v_sz
						has_pair = true; return true
					end
					in_match = false
				end
				local ok, k, k_sz, v, v_sz = fk_cur:move_raw_kv(op)
				op = C.MDBX_NEXT_NODUP
				if not ok then return end
				if driver_set[str(k, k_sz)] then
					parent_pk, parent_pk_sz = k, k_sz
					child_pk, child_pk_sz = v, v_sz
					in_match = true
					has_pair = true; return true
				end
			end
		end
	end
	return node
end

--TRANSFORM NODES ---------------------------------------------------------------

-- pk_hash_filter: materialise set node PKs into a hash, then filter driver by membership.
-- mode='in': keep driver items whose PK is in the set.
-- mode='not_in': keep driver items whose PK is not in the set.
-- Both inputs must be flat pk streams. Driver and set may differ in order and key space.
-- Usage: db:pk_hash_filter(driver, set_node, mode)
Db.pk_hash_filter = object(Db.query_node, {
	kind   = 'pk_hash_filter',
	item   = 'pk',
	unique = false,
	source = 'probe',
	work   = 'materialise set + driver scan',
})
function Db.pk_hash_filter:__call(db, driver, set_node, mode)
	check_pk_node(driver, 'pk_hash_filter', 1)
	check_pk_node(set_node, 'pk_hash_filter', 2)
	assertf(mode == 'in' or mode == 'not_in', 'pk_hash_filter: mode must be "in" or "not_in"')
	check_flat_pk(driver, 'pk_hash_filter', 'driver')
	check_flat_pk(set_node, 'pk_hash_filter', 'set')
	local member_name = driver.members[1]
	local node = object(self, {
		members = {member_name},
		order   = driver.order,
		unique  = driver.unique,
	})
	node.merge_cmp = driver.merge_cmp
	node.merge_sig = driver.merge_sig
	function node:open()
		set_node:open()
		local pk_set = {}
		while set_node:next_group() do
			repeat
				local _, p, p_sz = set_node:get_pk()
				pk_set[str(p, p_sz)] = true
			until not set_node:next_pk()
		end
		set_node:close()
		driver:open()
		function node:close() driver:close() end
		local has_pk = false
		local cur_pk, cur_pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == member_name) then
				return true, cur_pk, cur_pk_sz
			end
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			return driver:get_cols(member, cols)
		end
		function node:merge_key() return driver:merge_key() end
		local want_in = mode == 'in'
		function node:next_group() return node:next() end
		local driver_started = false
		local function driver_next()
			if not driver_started then driver_started = true; return driver:next_group() end
			return driver:next_pk() or driver:next_group()
		end
		function node:next()
			has_pk = false
			while true do
				if not driver_next() then return end
				local _, p, p_sz = driver:get_pk()
				if (pk_set[str(p, p_sz)] ~= nil) == want_in then
					cur_pk, cur_pk_sz = p, p_sz
					has_pk = true
					return true
				end
			end
		end
	end
	return node
end

-- pk_parent_lookup: reverse FK join -- for each child PK, read FK column and probe parent.
-- driver: any PK-stream node producing child PKs; fk: FK index name.
-- Reads FK column values from driver via get_cols; seeks parent base table by those values.
-- Output: PK tuple stream in child (driver) order.
-- opts.left = true: left join; emit child with absent parent when parent not found.
-- Usage: db:pk_parent_lookup(driver, fk_ix_name [, opts])
Db.pk_parent_lookup = object(Db.query_node, {
	kind   = 'pk_parent_lookup',
	item   = 'pk_tuple',
	unique = false,
	source = 'probe',
	work   = 'FK column read + parent base-table seek',
})
function Db.pk_parent_lookup:__call(db, driver, fk_name, opts)
	check_pk_node(driver, 'pk_parent_lookup', 1)
	opts = opts or {}
	local fk_schema = resolve(db, fk_name)
	check_index(fk_schema, 'pk_parent_lookup', fk_name)
	local child_schema = fk_schema.val_schema
	local fk, parent_schema = find_fk(db, child_schema, fk_schema, 'pk_parent_lookup', fk_name)
	check_driver_member(driver, child_schema, 'pk_parent_lookup')
	local fk_cols = cat(imap(fk_schema.key_fields, 'col'), ',')
	local n_pk = #child_schema.key_fields
	local left_join = opts.left
	local node = object(self, {
		members = {child_schema.name, parent_schema.name},
		order   = driver.order,
	})
	node.merge_cmp = driver.merge_cmp
	node.merge_sig = driver.merge_sig
	function node:open()
		driver:open()
		local parent_dbi = assert(db:try_dbi(parent_schema.name))
		local parent_cur = db:cursor_raw(parent_dbi)
		parent_cur.schema = parent_schema
		local cur_alive = true
		function node:close()
			if cur_alive then driver:close(); parent_cur:close(); cur_alive = false end
		end
		local child_pk, child_pk_sz
		local parent_pk, parent_pk_sz
		local has_child  = false
		local has_parent = false
		local fk_row = {}
		function node:merge_key() return child_pk, child_pk_sz end
		function node:get_pk(name)
			if not has_child then return end
			if name == nil or name == child_schema.name then return true, child_pk, child_pk_sz end
			if name == parent_schema.name and has_parent then return true, parent_pk, parent_pk_sz end
		end
		function node:get_cols(member, cols)
			if not has_child then return end
			if member == child_schema.name then return driver:get_cols(member, cols) end
			if member == parent_schema.name and has_parent then
				if not parent_cur:move_raw(C.MDBX_SET_KEY, parent_pk, parent_pk_sz) then return end
				return parent_cur:try_current(cols)
			end
		end
		function node:next_group() return node:next() end
		local driver_started = false
		local function driver_next()
			if not driver_started then driver_started = true; return driver:next_group() end
			return driver:next_pk() or driver:next_group()
		end
		function node:next()
			has_child = false; has_parent = false
			while true do
				if not driver_next() then return end
				local _, cp, cp_sz = driver:get_pk()
				child_pk, child_pk_sz = cp, cp_sz
				local fv = {driver:get_cols(child_schema.name, fk_cols)}
				if fv[1] then
					for i, ref_col in ipairs(fk.ref_cols) do fk_row[ref_col] = fv[n_pk + 1 + i] end
					local pp_sz = mdbx_encode_key(db, parent_schema, 'pk_parent_lookup',
						nil, mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE,
						parent_schema.key_cols, '{}', fk_row)
					if parent_cur:move_raw(C.MDBX_SET_KEY, mdbx_key_rec_buffer, pp_sz) then
						local ppk = u8a(pp_sz); copy(ppk, mdbx_key_rec_buffer, pp_sz)
						parent_pk, parent_pk_sz = ppk, pp_sz
						has_child = true; has_parent = true; return true
					end
				end
				if left_join then has_child = true; return true end
			end
		end
	end
	return node
end

-- pk_filter: keep items from a pk stream where fn(node) returns true.
-- fn receives the positioned pk_filter node; call node:get_cols(member, cols) to read values.
-- Usage: db:pk_filter(input, fn)
Db.pk_filter = object(Db.query_node, {
	kind   = 'pk_filter',
	source = 'pass-through',
	work   = 'predicate filter over pk stream',
})
function Db.pk_filter:__call(db, input, fn)
	check_pk_node(input, 'pk_filter', 1)
	check_fn(fn, 'pk_filter', 2)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
		item    = input.item,
	})
	node.merge_cmp = input.merge_cmp
	node.merge_sig = input.merge_sig
	function node:open()
		input:open()
		function node:close() input:close() end
		local has_pk = false
		function node:get_pk(name)
			if not has_pk then return end
			return input:get_pk(name)
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			return input:get_cols(member, cols)
		end
		function node:merge_key() return input:merge_key() end
		function node:next_group() return node:next() end
		local input_started = false
		local function input_next()
			if not input_started then input_started = true; return input:next_group() end
			return input:next_pk() or input:next_group()
		end
		function node:next()
			while true do
				has_pk = false
				if not input_next() then return end
				has_pk = true
				if fn(node) then return true end
			end
		end
	end
	return node
end

local function make_existence_join(self, db, outer, inner_fn, want_inner)
	check_pk_node(outer, self.kind, 1)
	check_fn(inner_fn, self.kind, 2)
	local node = object(self, {
		members = outer.members,
		order   = outer.order,
		unique  = outer.unique,
		item    = outer.item,
	})
	node.merge_cmp = outer.merge_cmp
	node.merge_sig = outer.merge_sig
	function node:open()
		outer:open()
		function node:close() outer:close() end
		local has_pk = false
		function node:get_pk(name)
			if not has_pk then return end
			return outer:get_pk(name)
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			return outer:get_cols(member, cols)
		end
		function node:merge_key() return outer:merge_key() end
		function node:next_group() return node:next() end
		local outer_started = false
		local function outer_next()
			if not outer_started then outer_started = true; return outer:next_group() end
			return outer:next_pk() or outer:next_group()
		end
		function node:next()
			has_pk = false
			while true do
				if not outer_next() then return end
				has_pk = true
				local inner = inner_fn(node)
				inner:open()
				local has_inner = inner:next_group() ~= nil
				inner:close()
				if has_inner == want_inner then return true end
				has_pk = false
			end
		end
	end
	return node
end

-- semi_join: keep outer items for which inner_fn(node) returns at least one item.
-- anti_join: keep outer items for which inner_fn(node) returns zero items.
-- inner_fn receives the positioned node and must return a fresh PK node per call.
Db.semi_join = object(Db.query_node, {kind='semi_join', source='pass-through', work='keep outer where inner_fn yields >= 1 item'})
Db.anti_join = object(Db.query_node, {kind='anti_join', source='pass-through', work='keep outer where inner_fn yields 0 items'})
function Db.semi_join:__call(db, outer, inner_fn) return make_existence_join(self, db, outer, inner_fn, true)  end
function Db.anti_join:__call(db, outer, inner_fn) return make_existence_join(self, db, outer, inner_fn, false) end

-- nested_join: for each outer item, call inner_fn(node) to get a correlated inner PK node,
-- then yield one output per inner item with merged outer+inner members.
-- inner members must not overlap outer members; inner is opened/closed per outer item.
-- node.members is extended with inner members on the first iteration.
-- Usage: db:nested_join(outer, inner_fn)
Db.nested_join = object(Db.query_node, {
	kind   = 'nested_join',
	item   = 'pk_tuple',
	unique = false,
	source = 'pass-through',
	work   = 'correlated inner per outer item; one output per inner item',
})
function Db.nested_join:__call(db, outer, inner_fn)
	check_pk_node(outer, 'nested_join', 1)
	check_fn(inner_fn, 'nested_join', 2)
	local members = {}
	for _, m in ipairs(outer.members) do members[#members+1] = m end
	local node = object(self, {
		members = members,
		order   = outer.order,
		unique  = false,
		item    = 'pk_tuple',
	})
	node.merge_cmp = outer.merge_cmp
	node.merge_sig = outer.merge_sig
	function node:open()
		outer:open()
		local has_pk = false
		local cur_inner = nil
		local inner_members_set = false
		function node:close()
			outer:close()
			if cur_inner then cur_inner:close(); cur_inner = nil end
		end
		function node:get_pk(name)
			if not has_pk then return end
			local ok, p, sz = outer:get_pk(name)
			if ok then return true, p, sz end
			if cur_inner then return cur_inner:get_pk(name) end
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			for _, m in ipairs(outer.members) do
				if m == member then return outer:get_cols(member, cols) end
			end
			if cur_inner then return cur_inner:get_cols(member, cols) end
		end
		function node:merge_key() return outer:merge_key() end
		function node:next_group() return node:next() end
		local outer_started = false
		local function outer_next()
			if not outer_started then outer_started = true; return outer:next_group() end
			return outer:next_pk() or outer:next_group()
		end
		function node:next()
			has_pk = false
			while true do
				if cur_inner ~= nil then
					if cur_inner:next_pk() or cur_inner:next_group() then
						has_pk = true; return true
					end
					cur_inner:close(); cur_inner = nil
				end
				if not outer_next() then return end
				has_pk = true
				local inner = inner_fn(node)
				if not inner_members_set then
					for _, m in ipairs(inner.members) do members[#members+1] = m end
					inner_members_set = true
				end
				inner:open()
				if inner:next_group() then cur_inner = inner; return true end
				inner:close()
				has_pk = false
			end
		end
	end
	return node
end

-- limit: yield at most n items from input after skipping offset items (default 0).
-- Usage: db:limit(input, n [, offset])
Db.limit = object(Db.query_node, {
	kind   = 'limit',
	source = 'pass-through',
	work   = 'at most n items after skipping offset',
})
function Db.limit:__call(db, input, n, offset)
	check_node(input, 'limit', 1)
	assertf(type(n) == 'number' and n >= 0, 'limit: arg 2: non-negative number expected')
	offset = offset or 0
	assertf(type(offset) == 'number' and offset >= 0, 'limit: arg 3: non-negative number expected')
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
		item    = input.item,
	})
	node.merge_cmp = input.merge_cmp
	node.merge_sig = input.merge_sig
	function node:open()
		input:open()
		function node:close() input:close() end
		local count   = 0
		local skipped = 0
		if input.item == 'value' then
			function node:next_row()
				if count >= n then return end
				while true do
					local rec = input:next_row()
					if not rec then return end
					if skipped < offset then skipped = skipped + 1
					else count = count + 1; return rec end
				end
			end
		else
			local has_pk = false
			function node:get_pk(name)
				if not has_pk then return end
				return input:get_pk(name)
			end
			function node:get_cols(member, cols)
				if not has_pk then return end
				return input:get_cols(member, cols)
			end
			function node:merge_key() return input:merge_key() end
			function node:next_group() return node:next() end
			local input_started = false
			local function input_next()
				if not input_started then input_started = true; return input:next_group() end
				return input:next_pk() or input:next_group()
			end
			function node:next()
				has_pk = false
				if count >= n then return end
				while true do
					if not input_next() then return end
					if skipped < offset then skipped = skipped + 1
					else count = count + 1; has_pk = true; return true end
				end
			end
		end
	end
	return node
end

-- pk_group: group consecutive input items by key_fn; yield first item per group via next_group(),
-- remaining items in the group via next_pk(). Requires input to already be in group order.
-- opts.which = 'first' (default). stream_aggregate iterates via next_group/next_pk.
-- key_fn(node) -> {part, ...}; parts must not be nil.
-- Usage: db:pk_group(input, key_fn [, opts])
Db.pk_group = object(Db.query_node, {
	kind   = 'pk_group',
	item   = 'pk',
	unique = false,
	source = 'pass-through',
	work   = 'group by key_fn; first item per group via next_group; rest via next_pk',
})
function Db.pk_group:__call(db, input, key_fn, opts)
	check_pk_node(input, 'pk_group', 1)
	check_fn(key_fn, 'pk_group', 2)
	opts = opts or {}
	local which = opts.which or 'first'
	assertf(which == 'first', 'pk_group: opts.which="last" not yet implemented')
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
		item    = input.item,
	})
	node.merge_cmp = input.merge_cmp
	node.merge_sig = input.merge_sig
	function node:open()
		input:open()
		function node:close() input:close() end
		local done    = false
		local started = false
		local has_current = false
		local cur_key = nil
		local peeked  = false  -- input is at first item of next group (detected by next_pk)
		local function adv()
			if done then return false end
			local ok
			if not started then started = true; ok = input:next_group()
			else ok = input:next_pk() or input:next_group() end
			if not ok then done = true; return false end
			return true
		end
		local function keys_eq(a, b)
			if #a ~= #b then return false end
			for i = 1, #a do if a[i] ~= b[i] then return false end end
			return true
		end
		function node:get_pk(name)
			if not has_current then return end
			return input:get_pk(name)
		end
		function node:get_cols(member, cols)
			if not has_current then return end
			return input:get_cols(member, cols)
		end
		function node:merge_key() return input:merge_key() end
		function node:next_group()
			has_current = false
			if done then return end
			if not peeked then
				if not adv() then return end
				-- skip remaining items of the previous group (when caller skipped next_pk calls)
				if cur_key ~= nil then
					-- call key_fn(input) directly: has_current is false so node:get_cols is gated
					while keys_eq(key_fn(input), cur_key) do
						if not adv() then return end
					end
				end
			end
			peeked = false
			cur_key = key_fn(input)  -- input is positioned; has_current not yet true
			has_current = true
			return true
		end
		function node:next_pk()
			if not has_current then return end
			if not adv() then has_current = false; return end
			local k = key_fn(node)  -- has_current still true; node:get_cols works
			if keys_eq(k, cur_key) then return true end
			peeked = true; has_current = false; return nil
		end
	end
	return node
end

-- pk_project: extract one named member's PK from a pk tuple stream into a flat pk stream.
-- Tuples where the named member is absent (left join nulls) are skipped.
-- Usage: db:pk_project(tuple_node, member_name)
Db.pk_project = object(Db.query_node, {
	kind   = 'pk_project',
	item   = 'pk',
	unique = false,
	source = 'pass-through',
	work   = 'project one member from pk tuple',
})
function Db.pk_project:__call(db, input, member_name)
	check_pk_node(input, 'pk_project', 1)
	assertf(isstr(member_name), 'pk_project: arg 2: member name string expected')
	local found = false
	for _, m in ipairs(input.members) do
		if m == member_name then found = true; break end
	end
	assertf(found, 'pk_project: member %q not found in input', member_name)
	local schema = resolve(db, member_name)
	local order = {}
	if input.order then
		for _, o in ipairs(input.order) do
			if o.col:match('^([^.]+)%.') == member_name then
				order[#order+1] = o
			end
		end
	end
	local node = object(self, {
		members = {member_name},
		order   = #order > 0 and order or nil,
	})
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	function node:open()
		input:open()
		function node:close() input:close() end
		local has_pk = false
		local cur_pk, cur_pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == member_name) then
				return true, cur_pk, cur_pk_sz
			end
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			if member ~= nil and member ~= member_name then return end
			return input:get_cols(member_name, cols)
		end
		function node:merge_key() return cur_pk, cur_pk_sz end
		function node:next_group() return node:next() end
		local input_started = false
		local function input_next()
			if not input_started then input_started = true; return input:next_group() end
			return input:next_pk() or input:next_group()
		end
		function node:next()
			has_pk = false
			while true do
				if not input_next() then return end
				local ok, p, p_sz = input:get_pk(member_name)
				if ok then
					cur_pk, cur_pk_sz = p, p_sz
					has_pk = true
					return true
				end
			end
		end
	end
	return node
end

-- pk_sort: collect all PKs from input into a sorted unique array; output in PK order.
-- Required to convert ix-order input to pk-order before a merge node.
-- Usage: db:pk_sort(input)
Db.pk_sort = object(Db.query_node, {
	kind   = 'pk_sort',
	item   = 'pk',
	unique = true,
	source = 'pass-through',
	work   = 'materialise + sort pk stream',
})
function Db.pk_sort:__call(db, input)
	check_pk_node(input, 'pk_sort', 1)
	check_flat_pk(input, 'pk_sort', 'input')
	local member_name = input.members[1]
	local schema = resolve(db, member_name)
	local node = object(self, {
		members = {member_name},
		order   = {{col = member_name..'.pk', dir = 'asc'}},
	})
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	function node:open()
		input:open()
		local pks = {}
		while input:next_group() do
			repeat
				local _, p, p_sz = input:get_pk()
				local s = str(p, p_sz)
				if not pks[s] then pks[s] = {p = u8a(p_sz), sz = p_sz}; pks[#pks+1] = pks[s] end
			until not input:next_pk()
		end
		input:close()
		table.sort(pks, function(a, b)
				return key_gt(b.p, b.sz, a.p, a.sz)
		end)
		local base_dbi = assert(db:try_dbi(member_name))
		local base_cur
		local i = 0
		local cur_pk, cur_pk_sz
		local has_pk = false
		function node:close()
			if base_cur then base_cur:close(); base_cur = nil end
		end
		function node:get_pk(name)
			if has_pk and (name == nil or name == member_name) then
				return true, cur_pk, cur_pk_sz
			end
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			if member ~= nil and member ~= member_name then return end
			if not base_cur then base_cur = db:cursor_raw(base_dbi); base_cur.schema = schema end
			if not base_cur:move_raw(C.MDBX_SET_KEY, cur_pk, cur_pk_sz) then return end
			return base_cur:try_current(cols)
		end
		function node:merge_key() return cur_pk, cur_pk_sz end
		function node:next_group()
			i = i + 1
			local entry = pks[i]
			if not entry then has_pk = false; return end
			cur_pk, cur_pk_sz = entry.p, entry.sz
			has_pk = true
			return true
		end
	end
	return node
end

-- pk_and_probe: filter a driver pk stream by testing each PK against one or more index keys
-- via MDBX_GET_BOTH_RANGE; all probes must pass (ANDed). O(1) memory, one seek per probe
-- per driver row. Probe key is encoded once; a dedicated cursor is kept open per probe.
-- probe: {ix=index_name, key=val} or {ix=index_name, key={val, val, ...}} for multi-col keys.
-- Usage: db:pk_and_probe(driver, probe, ...)
Db.pk_and_probe = object(Db.query_node, {
	kind   = 'pk_and_probe',
	item   = 'pk',
	unique = false,
	source = 'probe',
	work   = 'driver scan + GET_BOTH per probe',
})
function Db.pk_and_probe:__call(db, driver, ...)
	check_pk_node(driver, 'pk_and_probe', 1)
	check_flat_pk(driver, 'pk_and_probe', 'driver')
	local nprobes = select('#', ...)
	assertf(nprobes >= 1, 'pk_and_probe: at least one probe required')
	local probes = {}
	for i = 1, nprobes do
		local p = (select(i, ...))
		assertf(type(p) == 'table' and p.ix and p.key ~= nil,
			'pk_and_probe: probe %d: {ix=, key=} expected', i)
		local ix_schema = resolve(db, p.ix)
		check_index(ix_schema, 'pk_and_probe', p.ix)
		local key_vals = type(p.key) == 'table' and p.key or {p.key}
		local sz = mdbx_encode_key(db, ix_schema, 'pk_and_probe', nil,
			mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, ix_schema.key_cols, nil, unpack(key_vals))
		local key_buf = u8a(sz); copy(key_buf, mdbx_key_rec_buffer, sz)
		probes[i] = {schema = ix_schema, key = key_buf, key_sz = sz}
	end
	local member_name = driver.members[1]
	local node = object(self, {
		members = {member_name},
		order   = driver.order,
		unique  = driver.unique,
	})
	node.merge_cmp = driver.merge_cmp
	node.merge_sig = driver.merge_sig
	function node:open()
		driver:open()
		local probe_curs = {}
		local cur_alive = true
		function node:close()
			if cur_alive then
				driver:close()
				for _, c in ipairs(probe_curs) do c:close() end
				cur_alive = false
			end
		end
		for i, p in ipairs(probes) do
			local dbi = assert(db:try_dbi(p.schema.name))
			probe_curs[i] = db:cursor_raw(dbi)
		end
		local has_pk = false
		local cur_pk, cur_pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == member_name) then
				return true, cur_pk, cur_pk_sz
			end
		end
		function node:get_cols(member, cols)
			if not has_pk then return end
			return driver:get_cols(member, cols)
		end
		function node:merge_key() return driver:merge_key() end
		function node:next_group() return node:next() end
		local driver_started = false
		local function driver_next()
			if not driver_started then driver_started = true; return driver:next_group() end
			return driver:next_pk() or driver:next_group()
		end
		function node:next()
			has_pk = false
			while true do
				if not driver_next() then return end
				local _, p, p_sz = driver:get_pk()
				local pass = true
				for i, probe in ipairs(probes) do
					local ok, v, v_sz = probe_curs[i]:find_dup_ge_raw(
						probe.key, probe.key_sz, p, p_sz)
					if not ok or v_sz ~= p_sz or memcmp(v, p, p_sz) ~= 0 then
						pass = false; break
					end
				end
				if pass then
					cur_pk, cur_pk_sz = p, p_sz
					has_pk = true
					return true
				end
			end
		end
	end
	return node
end

--VALUE NODES ----------------------------------------------------------------

local function parse_col_spec(s)
	--'member.col' or 'member.col alias'; returns {name=, member=, col=}
	s = s:match('^%s*(.-)%s*$')
	local spec, alias = s:match('^(%S+)%s+(%S+)$')
	if not spec then spec = s end
	local member, col = spec:match('^([^.]+)%.(.+)$')
	assertf(member and col, 'select: output spec must be "member.col [alias]": %q', spec)
	return {name = alias or spec, member = member, col = col}
end

local function parse_outputs(outputs)
	local parsed = {}
	if isstr(outputs) then
		for s in outputs:gmatch('[^,]+') do
			parsed[#parsed+1] = parse_col_spec(s)
		end
	else
		assertf(type(outputs) == 'table', 'select: arg 2: string or list expected')
		for i, o in ipairs(outputs) do
			if isstr(o) then
				parsed[#parsed+1] = parse_col_spec(o)
			else
				assertf(type(o) == 'table' and isstr(o.name) and type(o.fn) == 'function',
					'select: output %d: string or {name=, fn=} expected', i)
				parsed[#parsed+1] = o
			end
		end
	end
	assertf(#parsed >= 1, 'select: at least one output required')
	return parsed
end

-- value_filter: keep value records where fn(record) is true.
-- fn receives the value record (a Lua table). Input must be a value node.
-- Usage: db:value_filter(input, fn)
Db.value_filter = object(Db.query_node, {
	kind   = 'value_filter',
	item   = 'value',
	unique = false,
	source = 'pass-through',
	work   = 'keep value records where fn(record) is true',
})
function Db.value_filter:__call(db, input, fn)
	check_value_node(input, 'value_filter', 1)
	check_fn(fn, 'value_filter', 2)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
	})
	function node:open()
		input:open()
		function node:close() input:close() end
		function node:next_row()
			while true do
				local rec = input:next_row()
				if not rec then return end
				if fn(rec) then return rec end
			end
		end
	end
	return node
end

-- select: decode a PK stream into value records; one record per input item.
-- outputs: 'member.col [alias], ...' string, or list of such strings and/or {name=, fn=} tables.
-- fn(input_node) -> value; called with the input node positioned at the current item.
-- Usage: db:select(input, outputs)
Db.select = object(Db.query_node, {
	kind   = 'select',
	item   = 'value',
	unique = false,
	source = 'pass-through',
	work   = 'decode pk stream to value records',
})
function Db.select:__call(db, input, outputs)
	check_pk_node(input, 'select', 1)
	local parsed = parse_outputs(outputs)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
	})
	function node:open()
		input:open()
		function node:close() input:close() end
		local input_started = false
		local function input_next()
			if not input_started then input_started = true; return input:next_group() end
			return input:next_pk() or input:next_group()
		end
		function node:next_row()
			if not input_next() then return end
			local rec = {}
			for _, o in ipairs(parsed) do
				if o.fn then
					rec[o.name] = o.fn(input)
				else
					local ok, v = input:get_cols(o.member, o.col)
					if ok then rec[o.name] = v end
				end
			end
			return rec
		end
	end
	return node
end

local function keys_eq(a, b)
	if #a ~= #b then return false end
	for i = 1, #a do if a[i] ~= b[i] then return false end end
	return true
end

-- stream_distinct: dedup adjacent value records by key_fn; requires input in group order.
-- key_fn(rec) -> {part, ...}; use null for DB null, never nil.
-- Usage: db:stream_distinct(input, key_fn)
Db.stream_distinct = object(Db.query_node, {
	kind   = 'stream_distinct',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'dedup adjacent value records by key_fn; requires group order',
})
function Db.stream_distinct:__call(db, input, key_fn)
	check_value_node(input, 'stream_distinct', 1)
	check_fn(key_fn, 'stream_distinct', 2)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = true,
	})
	function node:open()
		input:open()
		function node:close() input:close() end
		local prev_key
		function node:next_row()
			while true do
				local rec = input:next_row()
				if not rec then return end
				local k = key_fn(rec)
				if not prev_key or not keys_eq(k, prev_key) then
					prev_key = k
					return rec
				end
			end
		end
	end
	return node
end

-- hash_distinct: dedup value records in any order by key_fn; O(n) memory.
-- key_fn(rec) -> {part, ...}; use null for DB null, never nil.
-- Usage: db:hash_distinct(input, key_fn)
Db.hash_distinct = object(Db.query_node, {
	kind   = 'hash_distinct',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'dedup any-order value records by key_fn; O(n) memory',
})
function Db.hash_distinct:__call(db, input, key_fn)
	check_value_node(input, 'hash_distinct', 1)
	check_fn(key_fn, 'hash_distinct', 2)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = true,
	})
	function node:open()
		input:open()
		function node:close() input:close() end
		local tuple = tuples()
		local seen = {}
		function node:next_row()
			while true do
				local rec = input:next_row()
				if not rec then return end
				local t = tuple(unpack(key_fn(rec)))
				if not seen[t] then
					seen[t] = true
					return rec
				end
			end
		end
	end
	return node
end

-- value_sort: materialise and sort value records.
-- spec: 'field [asc|desc], ...' string, or a comparator fn(a, b) -> bool.
-- null sorts before non-null in asc, after in desc.
-- Usage: db:value_sort(input, spec)
Db.value_sort = object(Db.query_node, {
	kind   = 'value_sort',
	item   = 'value',
	unique = false,
	source = 'pass-through',
	work   = 'materialise and sort value records',
})
function Db.value_sort:__call(db, input, spec)
	check_value_node(input, 'value_sort', 1)
	local cmp
	if type(spec) == 'function' then
		cmp = spec
	else
		assertf(isstr(spec), 'value_sort: arg 2: string or comparator function expected')
		local parts = {}
		for s in spec:gmatch('[^,]+') do
			s = s:match('^%s*(.-)%s*$')
			local field, dir = s:match('^(%S+)%s+(%S+)$')
			if not field then field = s end
			dir = dir or 'asc'
			assertf(dir == 'asc' or dir == 'desc', 'value_sort: invalid direction %q in %q', dir, spec)
			parts[#parts+1] = {field = field, desc = dir == 'desc'}
		end
		assertf(#parts >= 1, 'value_sort: empty spec')
		cmp = function(a, b)
			for _, p in ipairs(parts) do
				local av, bv = a[p.field], b[p.field]
				if av ~= bv then
					local a_null, b_null = av == null, bv == null
					if a_null ~= b_null then
						return p.desc and b_null or a_null
					end
					return p.desc and av > bv or av < bv
				end
			end
			return false
		end
	end
	local node = object(self, {
		members = input.members,
		unique  = input.unique,
	})
	function node:open()
		input:open()
		local recs = {}
		local rec = input:next_row()
		while rec do recs[#recs+1] = rec; rec = input:next_row() end
		input:close()
		table.sort(recs, cmp)
		local i = 0
		function node:close() end
		function node:next_row()
			i = i + 1
			return recs[i]
		end
	end
	return node
end

-- stream_aggregate: one value record per group from a PK stream; requires group order.
-- key_fn(node) -> {part,...}: group key at PK level; nil = grand total (one output record).
-- agg: list of {name=, op=, [member=, col=, sep=, part=]}.
-- ops: count, sum, avg, min, max, concat (skip null/absent), key (from key_fn part index).
-- Usage: db:stream_aggregate(input, key_fn, agg)
Db.stream_aggregate = object(Db.query_node, {
	kind   = 'stream_aggregate',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'aggregate PK stream into one value record per group',
})
function Db.stream_aggregate:__call(db, input, key_fn, agg)
	check_pk_node(input, 'stream_aggregate', 1)
	assertf(key_fn == nil or type(key_fn) == 'function',
		'stream_aggregate: arg 2: function or nil expected')
	assertf(type(agg) == 'table' and #agg >= 1,
		'stream_aggregate: arg 3: non-empty agg list expected')
	local node = object(self, {members = input.members, unique = true})
	function node:open()
		input:open()
		function node:close() input:close() end
		local done = false
		local function init_acc()
			local acc = {}
			for _, a in ipairs(agg) do
				if     a.op == 'count'  then acc[a.name] = 0
				elseif a.op == 'avg'    then acc[a.name] = {sum = 0, n = 0}
				elseif a.op == 'concat' then acc[a.name] = {}
				else                         acc[a.name] = nil
				end
			end
			return acc
		end
		local function accumulate(acc, key)
			for _, a in ipairs(agg) do
				if a.op == 'count' then
					acc[a.name] = acc[a.name] + 1
				elseif a.op == 'key' then
					acc[a.name] = key and key[a.part]
				else
					local ok, v = input:get_cols(a.member, a.col)
					if ok and v ~= nil and v ~= null then
						if a.op == 'sum' then
							acc[a.name] = (acc[a.name] or 0) + v
						elseif a.op == 'avg' then
							acc[a.name].sum = acc[a.name].sum + v
							acc[a.name].n   = acc[a.name].n   + 1
						elseif a.op == 'min' then
							if acc[a.name] == nil or v < acc[a.name] then acc[a.name] = v end
						elseif a.op == 'max' then
							if acc[a.name] == nil or v > acc[a.name] then acc[a.name] = v end
						elseif a.op == 'concat' then
							acc[a.name][#acc[a.name]+1] = tostring(v)
						end
					end
				end
			end
		end
		local function finalize(acc)
			local rec = {}
			for _, a in ipairs(agg) do
				if a.op == 'avg' then
					local s = acc[a.name]
					rec[a.name] = s.n > 0 and s.sum / s.n or nil
				elseif a.op == 'concat' then
					local t = acc[a.name]
					rec[a.name] = #t > 0 and table.concat(t, a.sep or ',') or nil
				else
					rec[a.name] = acc[a.name]
				end
			end
			return rec
		end
		if not key_fn then
			function node:next_row()
				if done then return end; done = true
				local acc = init_acc()
				while input:next_group() do
					repeat accumulate(acc, nil) until not input:next_pk()
				end
				return finalize(acc)
			end
		else
			function node:next_row()
				if done then return end
				if not input:next_group() then done = true; return end
				local key = key_fn(input)
				local acc = init_acc()
				accumulate(acc, key)
				while input:next_pk() do accumulate(acc, key) end
				return finalize(acc)
			end
		end
	end
	return node
end

-- hash_aggregate: group and aggregate value records in any order; O(n groups) memory.
-- key_fn(rec) -> {part,...}: group key at value level; nil = grand total.
-- agg: list of {name=, op=, [input=, sep=, part=]}; input= is the record field name.
-- ops: count, sum, avg, min, max, concat (skip null/absent), key (from key_fn part index).
-- Usage: db:hash_aggregate(input, key_fn, agg)
Db.hash_aggregate = object(Db.query_node, {
	kind   = 'hash_aggregate',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'group and aggregate value records; any order; O(n groups) memory',
})
function Db.hash_aggregate:__call(db, input, key_fn, agg)
	check_value_node(input, 'hash_aggregate', 1)
	assertf(key_fn == nil or type(key_fn) == 'function',
		'hash_aggregate: arg 2: function or nil expected')
	assertf(type(agg) == 'table' and #agg >= 1,
		'hash_aggregate: arg 3: non-empty agg list expected')
	local node = object(self, {members = input.members, unique = true})
	function node:open()
		input:open()
		local function init_acc()
			local acc = {}
			for _, a in ipairs(agg) do
				if     a.op == 'count'  then acc[a.name] = 0
				elseif a.op == 'avg'    then acc[a.name] = {sum = 0, n = 0}
				elseif a.op == 'concat' then acc[a.name] = {}
				else                         acc[a.name] = nil
				end
			end
			return acc
		end
		local function accumulate(acc, rec, key)
			for _, a in ipairs(agg) do
				if a.op == 'count' then
					acc[a.name] = acc[a.name] + 1
				elseif a.op == 'key' then
					acc[a.name] = key and key[a.part]
				else
					local v = a.input and rec[a.input]
					if v ~= nil and v ~= null then
						if a.op == 'sum' then
							acc[a.name] = (acc[a.name] or 0) + v
						elseif a.op == 'avg' then
							acc[a.name].sum = acc[a.name].sum + v
							acc[a.name].n   = acc[a.name].n   + 1
						elseif a.op == 'min' then
							if acc[a.name] == nil or v < acc[a.name] then acc[a.name] = v end
						elseif a.op == 'max' then
							if acc[a.name] == nil or v > acc[a.name] then acc[a.name] = v end
						elseif a.op == 'concat' then
							acc[a.name][#acc[a.name]+1] = tostring(v)
						end
					end
				end
			end
		end
		local function finalize(acc)
			local rec = {}
			for _, a in ipairs(agg) do
				if a.op == 'avg' then
					local s = acc[a.name]
					rec[a.name] = s.n > 0 and s.sum / s.n or nil
				elseif a.op == 'concat' then
					local t = acc[a.name]
					rec[a.name] = #t > 0 and table.concat(t, a.sep or ',') or nil
				else
					rec[a.name] = acc[a.name]
				end
			end
			return rec
		end
		local group_list = {}
		local group_map  = {}
		local tuple_space = key_fn and tuples() or nil
		local rec = input:next_row()
		while rec do
			local key, t
			if key_fn then
				key = key_fn(rec)
				t = tuple_space(unpack(key))
			else
				t = true
			end
			local acc = group_map[t]
			if not acc then
				acc = init_acc()
				group_map[t] = acc
				group_list[#group_list+1] = {acc, key}
			end
			accumulate(acc, rec, key)
			rec = input:next_row()
		end
		input:close()
		local output = {}
		for _, g in ipairs(group_list) do output[#output+1] = finalize(g[1]) end
		local i = 0
		function node:close() end
		function node:next_row() i = i + 1; return output[i] end
	end
	return node
end

-- union_all: combine value streams in argument order; keep all duplicates.
-- All inputs must have the same fields. Usage: db:union_all(input, ...)
Db.union_all = object(Db.query_node, {
	kind   = 'union_all',
	item   = 'value',
	unique = false,
	source = 'pass-through',
	work   = 'concatenate value streams in argument order',
})
function Db.union_all:__call(db, ...)
	local n = select('#', ...)
	assertf(n >= 2, 'union_all: need at least 2 inputs, got %d', n)
	local inputs = {}
	for i = 1, n do
		local inp = (select(i, ...))
		check_value_node(inp, 'union_all', i)
		inputs[i] = inp
	end
	local node = object(self, {members = inputs[1].members})
	function node:open()
		for i = 1, n do inputs[i]:open() end
		function node:close() for i = 1, n do inputs[i]:close() end end
		local i = 1
		function node:next_row()
			while i <= n do
				local rec = inputs[i]:next_row()
				if rec then return rec end
				i = i + 1
			end
		end
	end
	return node
end

-- union_distinct: combine value streams; yield each unique record once (first-seen).
-- All inputs must have the same fields. Usage: db:union_distinct(input, ...)
Db.union_distinct = object(Db.query_node, {
	kind   = 'union_distinct',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'concatenate value streams; dedup first-seen',
})
function Db.union_distinct:__call(db, ...)
	local n = select('#', ...)
	assertf(n >= 2, 'union_distinct: need at least 2 inputs, got %d', n)
	local inputs = {}
	for i = 1, n do
		local inp = (select(i, ...))
		check_value_node(inp, 'union_distinct', i)
		inputs[i] = inp
	end
	local node = object(self, {members = inputs[1].members, unique = true})
	function node:open()
		for i = 1, n do inputs[i]:open() end
		function node:close() for i = 1, n do inputs[i]:close() end end
		local seen = {}
		local tuple_space
		local fields
		local i = 1
		function node:next_row()
			while i <= n do
				local rec = inputs[i]:next_row()
				if rec then
					if not fields then
						fields = {}
						for k in pairs(rec) do fields[#fields+1] = k end
						table.sort(fields)
						tuple_space = tuples()
					end
					local vals = {}
					for j, f in ipairs(fields) do vals[j] = rec[f] end
					local t = tuple_space(unpack(vals))
					if not seen[t] then seen[t] = true; return rec end
				else
					i = i + 1
				end
			end
		end
	end
	return node
end
