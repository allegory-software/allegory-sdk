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

local function make_cmp(s)
	local gt, eq = s.key_gt, s.key_eq
	return function(a, a_sz, b, b_sz)
		return eq(a, a_sz, b, b_sz) and 0 or gt(a, a_sz, b, b_sz) and 1 or -1
	end
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
	node.merge_cmp = make_cmp(schema)
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
	node.merge_cmp = make_cmp(val_schema)
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
		assertf(not schema.key_gt(lo_key, lo_sz, hi_key, hi_sz),
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
		local cmp_hi = hi_open and schema.key_ge or schema.key_gt
		local cmp_lo = lo_open and schema.key_le or schema.key_lt
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
				if lo_open and schema.key_eq(k, k_sz, lo_key, lo_sz) then
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
				local skip = hi_open and schema.key_eq(k, k_sz, hi_key, hi_sz)
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
	node.merge_cmp = make_cmp(schema)
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
	node.merge_cmp = make_cmp(schema)
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
	node.merge_cmp = make_cmp(parent_schema)
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
		assertf(inp and inp.members, 'merge_join: arg %d: query node expected', i)
		inputs[i] = inp
	end
	assertf(not optional[1], 'merge_join: first input must not be db.left')
	local merge_cmp = inputs[1].merge_cmp
	assertf(merge_cmp, 'merge_join: input 1 has no merge_cmp')
	for i = 2, n do
		assertf(inputs[i].merge_sig == inputs[1].merge_sig,
			'merge_join: input %d merge key incompatible with input 1', i)
	end
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
		assertf(inp and inp.members, 'merge_union: arg %d: query node expected', i)
		inputs[i] = inp
	end
	local merge_cmp = inputs[1].merge_cmp
	assertf(merge_cmp, 'merge_union: input 1 has no merge_cmp')
	for i = 2, n do
		assertf(inputs[i].merge_sig == inputs[1].merge_sig,
			'merge_union: input %d merge key incompatible with input 1', i)
	end
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
	assertf(a and a.members, 'merge_except: arg 1: query node expected')
	assertf(b and b.members, 'merge_except: arg 2: query node expected')
	local merge_cmp = a.merge_cmp
	assertf(merge_cmp, 'merge_except: arg 1 has no merge_cmp')
	assertf(b.merge_sig == a.merge_sig, 'merge_except: inputs have incompatible merge keys')
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
