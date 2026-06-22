--[[

	mdbx_query: query engine over mdbx_schema tables and indexes.
	Written by Cosmin Apreutesei. Public Domain.

	See mdbx_query.md (architecture + API) and mdbx_query_validators.md
	(per-node metadata and validation rules). Build stages in mdbx_query_todo.md.

	Each node kind is a class derived from mdbx_db.query_node and exposed as a
	db method. Calling the class builds a node instance bound to the db:

		db:<node>(args...) -> node     build a plan node (see mdbx_query.md).
		node:open()                   prepare the node for one execution.
		node:next() -> true | nil     advance the current item.
		node:get_pk([name]) -> true, k, k_sz | nil
		node:explain() -> t           node metadata, no row reads.

	A node is single-use (one :open()). Nodes are built and run inside a read
	transaction the caller has open, since building resolves schema and running
	uses cursors.

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

--node base class ------------------------------------------------------------

--a node kind is `Db.<kind> = object(Db.query_node)` with a `:__call(db, ...)`
--constructor that stores `open` plus explain metadata in the instance.
--Shared behavior lives here; instances inherit kind-level constants (kind, item,
--unique, source, work) and store per-node data. open() installs next/get_pk.
Db.query_node = object()

function Db.query_node:open()
	error(self.kind..': open not implemented yet')
end
Db.query_node.next = noop

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

--access nodes ---------------------------------------------------------------

-- pk_scan: full base-table key scan, returning all PKs in ascending PK order.
-- Usage: db:pk_scan(table_name)
Db.pk_scan = object(Db.query_node, {
	kind   = 'pk_scan',
	item   = 'pk',
	unique = true,
	source = 'pk_bytes',
	work   = 'scan base-table keys',
})
function Db.pk_scan:__call(db, tab)
	local schema = resolve(db, tab)
	check_base_table(schema, 'pk_scan', tab)
	local node = object(self, {
		members = {schema.name},
		order   = {{col = schema.name..'.pk', dir = 'asc'}},
	})
	function node:open()
		local dbi = assert(db:try_dbi(schema.name))
		local cur = db:cursor_raw(dbi)
		local op  = C.MDBX_FIRST
		local has_pk, pk, pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == schema.name) then
				return true, pk, pk_sz
			end
		end
		function node:next()
			has_pk, pk, pk_sz = cur:move_raw_kv(op)
			op = C.MDBX_NEXT
			if not has_pk then cur:close(); return end
			return true
		end
	end
	return node
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
		local dbi  = assert(db:try_dbi(schema.name))
		local done = false
		local has_pk, pk, pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == schema.name) then
				return true, pk, pk_sz
			end
		end
		function node:next()
			if done then has_pk = nil; return end
			done = true
			has_pk = db:find_raw(dbi, pk_key, sz)
			if not has_pk then return end
			pk, pk_sz = pk_key, sz
			return true
		end
	end
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
		local has_pk, pk, pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == val_schema.name) then
				return true, pk, pk_sz
			end
		end
		local fixedsize = schema.dup_fixedsize
		if fixedsize then
			--DUPFIXED: bulk pk iteration via MDBX_GET_MULTIPLE / MDBX_NEXT_MULTIPLE.
			local ok, v, v_sz = cur:find_multiple_raw(ix_key, sz)
			if not ok then cur:close(); return end
			local v_o = 0
			function node:next()
				if v_o >= v_sz then
					ok, v, v_sz = cur:next_multiple_raw()
					if not ok then has_pk = nil; cur:close(); return end
					v_o = 0
				end
				pk = v + v_o
				pk_sz = fixedsize
				has_pk = true
				v_o = v_o + fixedsize
				return true
			end
		else
			--non-DUPFIXED: one dup at a time.
			if not cur:move_raw(C.MDBX_SET_KEY, ix_key, sz) then
				cur:close(); return
			end
			local op = C.MDBX_GET_CURRENT
			function node:next()
				local ok2, v, v_sz = cur:move_raw_v(op)
				op = C.MDBX_NEXT_DUP
				if not ok2 then has_pk = nil; cur:close(); return end
				has_pk, pk, pk_sz = true, v, v_sz
				return true
			end
		end
	end
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
		local has_pk, pk, pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == val_schema.name) then
				return true, pk, pk_sz
			end
		end
		local ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_SET_RANGE, ix_key, sz)
		if not ok or k_sz < sz or memcmp(k, ix_key, sz) ~= 0 then
			cur:close(); return
		end
		local first = true
		local fv, fv_sz = v, v_sz --pointer valid until first cursor op
		function node:next()
			if first then
				first = false
				has_pk, pk, pk_sz = true, fv, fv_sz
				return true
			end
			--try next dup in current key
			local ok2, v2, v2_sz = cur:move_raw_v(C.MDBX_NEXT_DUP)
			if ok2 then
				has_pk, pk, pk_sz = true, v2, v2_sz
				return true
			end
			--dups exhausted; advance to next key and re-check prefix
			local ok3, k3, k3_sz, v3, v3_sz = cur:move_raw_kv(C.MDBX_NEXT_NODUP)
			if not ok3 or k3_sz < sz or memcmp(k3, ix_key, sz) ~= 0 then
				has_pk = nil; cur:close(); return
			end
			has_pk, pk, pk_sz = true, v3, v3_sz
			return true
		end
	end
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
		local op = C.MDBX_FIRST
		local has_pk, pk, pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == parent_schema.name) then
				return true, pk, pk_sz
			end
		end
		function node:next()
			has_pk, pk, pk_sz = cur:move_raw_kv(op)
			op = C.MDBX_NEXT_NODUP
			if not has_pk then cur:close(); return end
			return true
		end
	end
	return node
end

-- pk_and: merge-intersect two unique PK streams for the same table.
-- Usage: db:pk_and(a, b)
Db.pk_and = object(Db.query_node, {
	kind   = 'pk_and',
	item   = 'pk',
	unique = true,
	source = 'pk_bytes',
	work   = 'merge PK intersection',
})
function Db.pk_and:__call(db, a, b)
	assertf(a.members and #a.members == 1, 'pk_and: left input is not a single PK stream')
	assertf(b.members and #b.members == 1, 'pk_and: right input is not a single PK stream')
	local member = a.members[1]
	assertf(b.members[1] == member, 'pk_and: input PK members differ')
	assertf(a.unique and b.unique, 'pk_and: inputs must be unique')
	assertf(a.order and a.order[1] and a.order[1].col == member..'.pk'
		and a.order[1].dir == 'asc', 'pk_and: left input is not PK-ordered')
	assertf(b.order and b.order[1] and b.order[1].col == member..'.pk'
		and b.order[1].dir == 'asc', 'pk_and: right input is not PK-ordered')
	local schema = resolve(db, member)
	local node = object(self, {
		members = {member},
		order   = {{col = member..'.pk', dir = 'asc'}},
	})
	function node:open()
		a:open()
		b:open()
		local a_ok, a_pk, a_pk_sz
		local b_ok, b_pk, b_pk_sz
		local has_pk, pk, pk_sz
		local emitted
		function node:get_pk(name)
			if has_pk and (name == nil or name == member) then
				return true, pk, pk_sz
			end
		end
		local function next_input(input, side)
			if not input:next() then return end
			local ok, p, sz = input:get_pk(member)
			assertf(ok, 'pk_and: %s input item has no %s PK', side, member)
			return true, p, sz
		end
		a_ok, a_pk, a_pk_sz = next_input(a, 'left')
		b_ok, b_pk, b_pk_sz = next_input(b, 'right')
		function node:next()
			if emitted then
				emitted = nil
				a_ok, a_pk, a_pk_sz = next_input(a, 'left')
				b_ok, b_pk, b_pk_sz = next_input(b, 'right')
			end
			while a_ok and b_ok do
				if schema.key_eq(a_pk, a_pk_sz, b_pk, b_pk_sz) then
					has_pk, pk, pk_sz = true, a_pk, a_pk_sz
					emitted = true
					return true
				elseif schema.key_lt(a_pk, a_pk_sz, b_pk, b_pk_sz) then
					a_ok, a_pk, a_pk_sz = next_input(a, 'left')
				else
					b_ok, b_pk, b_pk_sz = next_input(b, 'right')
				end
			end
			has_pk = nil
		end
	end
	return node
end

-- join nodes -----------------------------------------------------------------

-- pk_join_merge: join driver rows to a child FK index; requires parent PK asc order.
-- fk_name: child FK index (e.g. 'sessions/user_id').
-- opts.left: emit unmatched driver rows with the child member absent.
-- Returns a PK tuple stream; next() -> true|nil, get_pk([name]) -> true, k, k_sz | nil.
-- Usage: db:pk_join_merge(driver, fk_name [, opts])
Db.pk_join_merge = object(Db.query_node, {
	kind   = 'pk_join_merge',
	item   = 'pk_tuple',
	unique = false,
	source = 'driver + child ix',
	work   = 'join driver with FK index',
})
function Db.pk_join_merge:__call(db, driver, fk_name, opts)
	local schema = resolve(db, fk_name)
	check_index(schema, 'pk_join_merge', fk_name)
	local child_schema = schema.val_schema
	local fk
	for _, f in pairs(child_schema.fks or {}) do
		if f.index == schema then fk = f; break end
	end
	assertf(fk, 'pk_join_merge: %s is not a FK index', fk_name)
	local parent_schema = resolve(db, fk.ref_table)
	local parent_name = parent_schema.name
	local child_name  = child_schema.name
	assertf(driver.members, 'pk_join_merge: driver has no member metadata')
	local has_parent = false
	for _, m in ipairs(driver.members) do
		if m == parent_name then has_parent = true; break end
	end
	assertf(has_parent, 'pk_join_merge: driver does not carry %s PK member', parent_name)
	assertf(driver.order and driver.order[1]
		and driver.order[1].col == parent_name..'.pk'
		and driver.order[1].dir == 'asc',
		'pk_join_merge: driver is not ordered by %s.pk asc', parent_name)
	opts = opts or {}
	local left = opts.left
	local members = {unpack(driver.members)}
	members[#members+1] = child_name
	local node = object(self, {
		members = members,
		order   = {
			{col = parent_name..'.pk', dir = 'asc'},
			{col = child_name..'.pk',  dir = 'asc'},
		},
	})
	function node:open()
		driver:open()
		local dbi = assert(db:try_dbi(schema.name))
		local cur = db:cursor_raw(dbi)
		local cur_parent_pk, cur_parent_pk_sz
		local cur_child_pk, cur_child_pk_sz
		local dup_op  --nil: not iterating dups; MDBX_NEXT_DUP: iterating
		function node:get_pk(name)
			if name == nil or name == child_name then
				return cur_child_pk and true, cur_child_pk, cur_child_pk_sz
			end
			if name == parent_name then
				return cur_parent_pk and true, cur_parent_pk, cur_parent_pk_sz
			end
			return driver:get_pk(name)
		end
		local function advance_driver()
			if not driver:next() then return end
			local ok, k, k_sz = driver:get_pk(parent_name)
			assertf(ok, 'pk_join_merge: driver current item has no %s PK', parent_name)
			return true, k, k_sz
		end
		function node:next()
			while true do
				if dup_op then
					local ok, v, v_sz = cur:move_raw_v(dup_op)
					if ok then
						cur_child_pk, cur_child_pk_sz = v, v_sz
						return true
					end
					dup_op = nil
				end
				local ok, k, k_sz = advance_driver()
				if not ok then
					cur_parent_pk, cur_parent_pk_sz = nil, nil
					cur_child_pk, cur_child_pk_sz = nil, nil
					cur:close()
					return
				end
				cur_parent_pk, cur_parent_pk_sz = k, k_sz
				local ok2, v, v_sz = cur:move_raw_v(C.MDBX_SET_KEY, k, k_sz)
				if ok2 then
					cur_child_pk, cur_child_pk_sz = v, v_sz
					dup_op = C.MDBX_NEXT_DUP
					return true
				elseif left then
					cur_child_pk, cur_child_pk_sz = nil, nil
					return true
				end
			end
		end
	end
	return node
end

-- pk_range: index key range scan, returning PKs in index-key order.
-- lo/hi are nil (unbounded) or {val...} arrays (one value per key column; null sentinel ok).
-- opts: lo_open (exclude lo), hi_open (exclude hi), desc (scan backward).
-- Usage: db:pk_range(ix_name, lo, hi [, opts])
Db.pk_range = object(Db.query_node, {
	kind   = 'pk_range',
	item   = 'pk',
	unique = true,
	source = 'index cursor',
	work   = 'index key range scan',
})
function Db.pk_range:__call(db, ix_name, lo, hi, opts)
	local schema = resolve(db, ix_name)
	check_index(schema, 'pk_range', ix_name)
	local nkey = #schema.key_fields
	opts = opts or {}
	local desc    = opts.desc
	local lo_open = opts.lo_open
	local hi_open = opts.hi_open
	local lo_key, lo_sz, hi_key, hi_sz
	if lo ~= nil then
		assertf(type(lo) == 'table' and #lo == nkey,
			'pk_range: %s: lo must be an array of %d value(s)', schema.name, nkey)
		lo_sz = mdbx_encode_key(db, schema, 'range', nil,
			mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, schema.key_cols, nil, unpack(lo))
		lo_key = u8a(lo_sz); copy(lo_key, mdbx_key_rec_buffer, lo_sz)
	end
	if hi ~= nil then
		assertf(type(hi) == 'table' and #hi == nkey,
			'pk_range: %s: hi must be an array of %d value(s)', schema.name, nkey)
		hi_sz = mdbx_encode_key(db, schema, 'range', nil,
			mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE, schema.key_cols, nil, unpack(hi))
		hi_key = u8a(hi_sz); copy(hi_key, mdbx_key_rec_buffer, hi_sz)
	end
	if lo_key and hi_key then
		assertf(not schema.key_gt(lo_key, lo_sz, hi_key, hi_sz),
			'pk_range: %s: lo bound exceeds hi bound', schema.name)
	end
	local val_schema = schema.val_schema
	local dir = desc and 'desc' or 'asc'
	local order = {}
	for _, f in ipairs(schema.key_fields) do
		order[#order+1] = {col = val_schema.name..'.'..f.col, dir = dir}
	end
	order[#order+1] = {col = val_schema.name..'.pk', dir = dir}
	local node = object(self, {
		members = {val_schema.name},
		order   = order,
	})
	function node:open()
		local dbi = assert(db:try_dbi(schema.name))
		local cur = db:cursor_raw(dbi)
		self.cursor = cur
		local has_pk, pk, pk_sz
		function node:get_pk(name)
			if has_pk and (name == nil or name == val_schema.name) then
				return true, pk, pk_sz
			end
		end
		local cmp_hi = hi_open and schema.key_ge or schema.key_gt
		local cmp_lo = lo_open and schema.key_le or schema.key_lt
		local ok, k, k_sz, v, v_sz
		if not desc then
			if lo_key then
				ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_SET_RANGE, lo_key, lo_sz)
				if not ok then cur:close(); return end
				if lo_open and schema.key_eq(k, k_sz, lo_key, lo_sz) then
					ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_NEXT_NODUP)
					if not ok then cur:close(); return end
				end
			else
				ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_FIRST)
				if not ok then cur:close(); return end
			end
			if hi_key and cmp_hi(k, k_sz, hi_key, hi_sz) then cur:close(); return end
			local first = true
			local fv, fv_sz = v, v_sz
			function node:next()
				if first then
					first = false
					has_pk, pk, pk_sz = true, fv, fv_sz
					return true
				end
				local ok2, k2, k2_sz, v2, v2_sz = cur:move_raw_kv(C.MDBX_NEXT)
				if not ok2 then has_pk = nil; cur:close(); return end
				if hi_key and cmp_hi(k2, k2_sz, hi_key, hi_sz) then
					has_pk = nil; cur:close(); return
				end
				has_pk, pk, pk_sz = true, v2, v2_sz
				return true
			end
		else
			if hi_key then
				ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_TO_KEY_LESSER_OR_EQUAL, hi_key, hi_sz)
				if not ok then cur:close(); return end
				local skip = hi_open and schema.key_eq(k, k_sz, hi_key, hi_sz)
				ok, k, k_sz, v, v_sz = cur:move_raw_kv(skip and C.MDBX_PREV_NODUP or C.MDBX_LAST_DUP)
				if not ok then cur:close(); return end
			else
				ok, k, k_sz, v, v_sz = cur:move_raw_kv(C.MDBX_LAST)
				if not ok then cur:close(); return end
			end
			if lo_key and cmp_lo(k, k_sz, lo_key, lo_sz) then cur:close(); return end
			local first = true
			local fv, fv_sz = v, v_sz
			function node:next()
				if first then
					first = false
					has_pk, pk, pk_sz = true, fv, fv_sz
					return true
				end
				local ok2, k2, k2_sz, v2, v2_sz = cur:move_raw_kv(C.MDBX_PREV)
				if not ok2 then has_pk = nil; cur:close(); return end
				if lo_key and cmp_lo(k2, k2_sz, lo_key, lo_sz) then
					has_pk = nil; cur:close(); return
				end
				has_pk, pk, pk_sz = true, v2, v2_sz
				return true
			end
		end
	end
	return node
end
