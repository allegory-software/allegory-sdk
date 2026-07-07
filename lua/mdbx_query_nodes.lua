--[[

	query engine over mdbx_schema tables and indexes.
	Written by AI driven by Cosmin Apreutesei. Public Domain.

API

	db:<node>(args...) -> node    build a plan node (see mdbx_query_nodes.md).
	node:open([params])           start a run; may be called again after close().
	node:close()                  end a run; re-open allowed; idempotent.
	node:explain() -> t           node metadata, no row reads.

PARAMS

	Uppercase identifiers in node signatures are param name placeholders.
	The caller chooses the actual name string; at open(params) time each node
	reads its values from the params table by name:

		params[NAME] = v              -- key column value for access nodes
		params[NAME] = n              -- plain number for limit / offset

	The same params table is passed down the whole node tree, so names must
	be unique across all nodes in one query.

		local node = db:pk_seek('users/status', 'STATUS')
		node:open({STATUS = 'active'})

		local node = db:pk_range('users/score', '>=', 'LO', '<=', 'HI')
		node:open({LO = 70, HI = 95})

NODE INTERFACE

	All nodes share one iteration protocol via next_group()/next_item().
	Value nodes (item = 'value') extend it with :row() and compile_col.

	Iteration is two-level: merge-key groups and PKs within a group.

	For a base-table node, each row is its own group (one PK per group).
	For an index node (DUPSORT), each distinct index key is a group; the
	duplicate list under that key is the PK list within the group.
	For a value node, each record is its own group; next_pk is always noop.

		node:merge_key() -> k, k_sz   current merge key (index key or base PK).
		node.merge_cmp()              schema-aware comparator for merge_key bytes.
		node.merge_sig                key-encoding signature; must match across
		                              inputs to a merge node.

		node:next_group() -> true|nil  advance to next group (or next value record).
		node:next_pk()    -> true|nil  advance to next PK within the current group.
		                               noop on base-table nodes, pk_seek, and all
		                               value nodes (each record is its own group).
		node:reset_group()             rewind to the first PK of the current group.
		node:next_item()  -> true|nil  next_pk() or next_group(), whichever applies;
		                               the usual way to drive iteration.

	The next_group / next_pk split exists for merge_join: convergence uses
	next_group (and skip_to) to align inputs on a common merge_key, then
	next_pk / reset_group enumerate all combinations of PKs within that group
	(advance the rightmost input; when it exhausts, reset it and advance the
	next one left, like counting with carries).

		node:skip_to(k, k_sz) -> true|nil

	seek to first group with merge_key >= k. base class fallback calls next_group
	once (correct, O(n)); proper implementations use MDBX_SET_RANGE (O(log n)).

	skip_to is what makes merge convergence efficient: instead of stepping
	forward one group at a time, a lagging input jumps directly to the target.

		node:pk([member]) -> true, k, k_sz | nil

	Returns the current PK bytes (or nil when not positioned). The optional
	member filters by member: in a left join, you'll get nil if the joined member
	didn't match on current row. Value nodes return nil (no PK bytes).

		node:compile_col(member, col) -> fn | nil

	Returns a zero-arg closure that decodes and returns column col for the named
	member, or nil when the column is absent. The closure is valid across runs
	as long as the node is open and positioned.

		node:col(member, col) -> v | nil

	Returns the current value of column col for the named member, or nil when
	absent. Valid after next_group() returns true.

		node:row() -> row   (value nodes only)

	Returns the current decoded Lua row (a table). Valid after next_group()
	returns true.

]]

if not ... then require'mdbx_query_nodes_test'; return end

require'mdbx_schema'

local C  = C
local Db = mdbx_db
local encode_key = mdbx_encode_key
local encode_key_prefix = mdbx_encode_key_prefix
local key_reencode = mdbx_key_reencode
local sort_u32_be = mdbx_schema_sort_u32_be
local find_u32_be = mdbx_schema_find_u32_be

--utils ----------------------------------------------------------------------

local function resolve(db, name)
	local schema = db:table_schema(name)
	assertf(schema, 'unknown table or index: %s', tostring(name))
	return schema
end

local function check_base_table(schema, op, name)
	assertf(not schema.is_index,
		'%s: base table expected, got index: %s', op, name)
end

local function check_index(schema, op, name)
	assertf(schema.is_index, '%s: index expected, got base table: %s', op, name)
end

local function check_node(x, op, n)
	assertf(x and x.members, '%s: arg %d: query node expected', op, n)
end

local function check_pk_node(x, op, n)
	assertf(x and x.members and x.item ~= 'value',
		'%s: arg %d: pk node expected', op, n)
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

local function pk_is_u32(schema)
	local f = schema.key_fields[1]
	return #schema.key_fields == 1 and f.mdbx_type == 'u32' and not f.maxlen
		and schema.key_fields.max_rec_size == 4
end

--Used by pk_join_seek and pk_parent_lookup which accept multi-member drivers.
local function driver_has_member(driver, name)
	for _, m in ipairs(driver.members) do if m == name then return true end end
end

--dynamic array of u32-big-endian numbers with radix sort in C ---------------

local function key_eq(k1, n1, k2, n2)
	return n1 == n2 and memcmp(k1, k2, n1) == 0
end

local function u32_keyset()
	local data = string_buffer(256)
	local n = 0
	local p, sz, i, prev
	local set = {}
	function set:add(key)
		data:putcdata(key, 4)
		n = n + 1
	end
	function set:sort()
		p, sz = data:ref()
		if n > 1 then
			local tmp_data = string_buffer(sz)
			local tmp = tmp_data:reserve(sz)
			tmp_data:commit(sz)
			sort_u32_be(p, tmp, n)
		end
		i = 0
		prev = nil
		return self
	end
	function set:next()
		while true do
			local off = i * 4
			if off >= sz then return end
			local idx = i
			i = i + 1
			local q = p + off --boxed ):
			if not (prev and key_eq(q, 4, prev, 4)) then
				prev = q
				return q, 4, idx
			end
		end
	end
	function set:index_of(key) -- binsearch; -1 = not found
		return find_u32_be(p, n, key)
	end
	return set
end

--NODE BASE CLASS ------------------------------------------------------------

--[[
a node kind is `Db.<kind> = object(Db.query_node)` with a `:__call(db, ...)`
constructor that stores `open` plus explain metadata in the instance.
Shared behavior lives here; instances inherit kind-level constants
(kind, item, unique, source, work) and per-node data.
open() installs next_group/get_pk.
]]
Db.query_node = object()

function Db.query_node:open(params)
	error(self.kind..': open not implemented yet')
end
Db.query_node.next_group  = noop
Db.query_node.next_pk     = noop
Db.query_node.reset_group = noop
Db.query_node.close       = noop
function Db.query_node:skip_to(target, target_sz)
	return self:next_group()
end
function Db.query_node:col(member, col) --TODO: 2-level table allocation per col
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
local function key_le(k1, n1, k2, n2) return key_cmp(k1, n1, k2, n2) <= 0 end
local function key_lt(k1, n1, k2, n2) return key_cmp(k1, n1, k2, n2)  < 0 end
local function key_gt(k1, n1, k2, n2) return key_cmp(k1, n1, k2, n2)  > 0 end
--true once k no longer starts with prefix p (used as a stop bound).
local function key_past_prefix(k, k_sz, p, p_sz)
	return k_sz < p_sz or memcmp(k, p, p_sz) ~= 0
end

-- pk_get: single base-table PK lookup; returns zero or one PK item.
-- Usage: db:pk_get(table_name, pk...)  -- pk count = PK column count.
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
	local key_names = {...}
	assertf(#key_names == #schema.key_fields,
		'pk_get: %s needs %d param name(s), got %d',
		schema.name, #schema.key_fields, #key_names)
	local node = object(self, {
		members = {schema.name},
		order   = {{member = schema.name, col = 'pk', dir = 'asc'}},
	})
	local cur, is_open
	local sz
	local pk_key --per-instance copy of the encoded key; see open()
	local pk_rec = MDBX_val()
	local val_rec = MDBX_val()
	local done, has_pk
	local key_vals = {}
	function node:merge_key() return pk_rec.data, pk_rec.size end
	function node:pk(name)
		if has_pk and (name == nil or name == schema.name) then
			return true, pk_rec.data, pk_rec.size
		end
	end
	function node:compile_col(member, col)
		return db:compile_col(schema, col, nil, pk_rec,
			function() return val_rec.data, val_rec.size end)
	end
	function node:next_group()
		if done then has_pk = nil; return end
		done = true
		if not cur then cur = db:cursor(schema.name) end
		pk_rec.data = pk_key; pk_rec.size = sz
		has_pk = cur:move_raw_into(C.MDBX_SET_KEY, pk_rec, val_rec)
		if not has_pk then return end
		return true
	end
	function node:close()
		if is_open then
			if cur then cur:close(); cur = nil end
			is_open = false
		end
	end
	function node:open(params)
		assert(not is_open, 'node already open')
		for i, kn in ipairs(key_names) do key_vals[i] = params[kn] end
		sz = encode_key(db, schema, 'get', nil,
			mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE,
			schema.key_cols, nil, unpack(key_vals, 1, #key_names))
		pk_key = u8a(sz); copy(pk_key, mdbx_key_rec_buffer, sz)
		is_open = true
		done = false
		has_pk = nil
	end
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	node.next_item = node.next_group  --one pk per group; next_pk noop
	return node
end

--pk_seek: exact index key lookup; all PKs on the key in PK order.
--Usage: db:pk_seek(ix_name, keys...)
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
	local key_names = {...}
	local val_schema = schema.val_schema
	local ix_key, sz
	local node = object(self, {
		members = {val_schema.name},
		order   = {{member = val_schema.name, col = 'pk', dir = 'asc'}},
	})
	local cur, base_cur, is_open
	local has_pk
	local fixedsize = schema.dup_fixedsize
	local ix_rec = MDBX_val()
	local pk_rec = MDBX_val()
	local base_val_rec = MDBX_val()
	local base_seeked, first
	local v, v_sz, v_o  -- DUPFIXED multi-page state
	local key_vals = {}
	local function get_base_val()
		if not base_seeked then
			if not base_cur then base_cur = db:cursor(val_schema.name) end
			base_cur:move_raw_into(C.MDBX_SET_KEY, pk_rec, base_val_rec)
			base_seeked = true
		end
		return base_val_rec.data, base_val_rec.size
	end
	function node:merge_key() return pk_rec.data, pk_rec.size end
	function node:pk(name)
		if has_pk and (name == nil or name == val_schema.name) then
			return true, pk_rec.data, pk_rec.size
		end
	end
	function node:compile_col(member, col)
		return db:compile_col(schema, col, ix_rec, pk_rec, get_base_val)
	end
	if fixedsize then
		--DUPFIXED: bulk pk iteration via MDBX_GET_MULTIPLE / MDBX_NEXT_MULTIPLE.
		--merge_key = pk value; each dup is a separate group; next_pk = noop.
		pk_rec.size = fixedsize
		function node:next_group()
			if not cur then cur = db:cursor(schema.name) end
			if first then
				first = false
				local ok; ok, v, v_sz = cur:move_raw_v(
					C.MDBX_SEEK_AND_GET_MULTIPLE, ix_key, sz)
				if not ok then has_pk = nil; return end
				v_o = 0
			else
				if v_o >= v_sz then
					local ok; ok, v, v_sz = cur:next_multiple_raw()
					if not ok then has_pk = nil; return end
					v_o = 0
				end
			end
			pk_rec.data = v + v_o
			base_seeked = false; has_pk = true
			v_o = v_o + fixedsize
			return true
		end
	else
		--non-DUPFIXED: one dup at a time.
		--merge_key = pk value; each dup is a separate group; next_pk = noop.
		function node:next_group()
			if not cur then cur = db:cursor(schema.name) end
			if first then
				first = false
				if not cur:move_raw_into(C.MDBX_SET_KEY, ix_rec, pk_rec)
				then has_pk = nil; return end
			else
				if not cur:move_raw_into(C.MDBX_NEXT_DUP, nil, pk_rec)
				then has_pk = nil; return end
			end
			has_pk = true; base_seeked = false
			return true
		end
		function node:skip_to(target, target_sz)
			pk_rec.data = target; pk_rec.size = target_sz
			if not cur:move_raw_into(C.MDBX_GET_BOTH_RANGE, ix_rec, pk_rec)
			then has_pk = nil; return end
			has_pk = true; base_seeked = false
			return true
		end
	end
	function node:close()
		if is_open then
			if cur then cur:close(); cur = nil end
			if base_cur then base_cur:close(); base_cur = nil end
			is_open = false
		end
	end
	function node:open(params)
		assert(not is_open, 'node already open')
		for i, kn in ipairs(key_names) do key_vals[i] = params[kn] end
		sz = encode_key(db, schema, 'seek', nil,
			mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE,
			schema.key_cols, nil, unpack(key_vals, 1, #key_names))
		ix_key = u8a(sz); copy(ix_key, mdbx_key_rec_buffer, sz)
		ix_rec.data = ix_key; ix_rec.size = sz
		is_open = true
		has_pk = nil; base_seeked = false; first = true
		if fixedsize then v_o = 0 end
	end
	node.merge_cmp = key_cmp
	node.merge_sig = val_schema.key_sig
	node.next_item = node.next_group  --each dup is its own group; next_pk noop
	return node
end

--[[
pk_range: key range scan on an index or base table, returning PKs
in key order.
For an index (DUPSORT): merge_key = index key bytes;
pk = dup (child PK) bytes.
For a base table:       merge_key = pk = base table key bytes.
Bounds: op ('>'|'>='|'<'|'<=') followed by fixed leading param names
and one range param name; null sentinel ok.
opts: desc (scan backward), n_fixed_params (fixed leading key columns),
prefix (true for complete key-column prefix, 'partial' to stop before
the last varsize key-column terminator).
Usage: db:pk_range(name [, opts] [, op, val...] ...)
]]
Db.pk_range = object(Db.query_node, {
	kind   = 'pk_range',
	item   = 'pk',
	unique = true,
	source = 'cursor',
	work   = 'key range scan',
})
function Db.pk_range:__call(db, name, opt, ...)
	if not istab(opt) then
		return db:pk_range(name, empty, opt, ...)
	end
	local schema = resolve(db, name)
	local is_index = schema.is_index
	local nkey = #schema.key_fields
	local nfixed = opt.n_fixed_params or 0
	local prefix = opt.prefix
	local prefix_partial = prefix == 'partial'
	assertf(prefix == nil or prefix == true or prefix_partial,
		'pk_range: %s: invalid prefix option', schema.name)
	assertf(nfixed >= 0 and nfixed <= nkey,
		'pk_range: %s: n_fixed_params out of range: %d',
		schema.name, nfixed)
	local names = {}
	local lo_op, lo_i, lo_n, hi_op, hi_i, hi_n
	local order_fixed
	local nprefix
	if prefix then
		nprefix = nfixed + (prefix_partial and 1 or 0)
		assertf(nprefix > 0 and nprefix <= nkey,
			'pk_range: %s: invalid prefix args', schema.name)
		if prefix_partial then
			local f = schema.key_fields[nprefix]
			assertf(f.maxlen and not f.padded,
				'pk_range: %s: partial prefix on fixed-size key column',
				schema.name)
		end
		for i = 1, nprefix do names[i] = select(i, ...) end
		order_fixed = nfixed
	else
		local nnames = nfixed + 1
		for ai = 1, nfixed + 3, nfixed + 2 do
			local op = select(ai, ...)
			if op == nil then break end
			if ai > 1
				and not (op == '>' or op == '>=' or op == '<' or op == '<=')
			then break end
			assertf(op == '>' or op == '>=' or op == '<' or op == '<=',
				'pk_range: %s: expected op at arg %d', schema.name, ai)
			local ni = #names + 1
			for i = 1, nnames do
				names[#names+1] = select(ai + i, ...)
			end
			if op == '>=' or op == '>' then lo_op, lo_i, lo_n = op, ni, nnames
			else hi_op, hi_i, hi_n = op, ni, nnames end
		end
		order_fixed = nfixed
	end
	local lo_open_arg = lo_op == '>'
	local hi_open_arg = hi_op == '<'
	local desc = opt.desc
	local lo_key, lo_sz, hi_key, hi_sz, bnd_key, bnd_sz
	local lo_open, hi_open
	local cmp_hi, cmp_lo, cmp_bnd
	local member_schema = is_index and schema.val_schema or schema
	local dir = desc and 'desc' or 'asc'
	local order = {}
	for i = order_fixed + 1, #schema.key_fields do
		local f = schema.key_fields[i]
		order[#order+1] = {member = member_schema.name, col = f.col, dir = dir}
	end
	if is_index then
		order[#order+1] = {member = member_schema.name, col = 'pk', dir = dir}
	end
	local node = object(self, {
		members = {member_schema.name},
		order   = order,
	})
	local cur, base_cur, is_open
	local has_pk
	local mk_rec = MDBX_val()
	local pk_rec = is_index and MDBX_val() or mk_rec
	local base_val_rec = MDBX_val()
	local base_seeked, first
	local adv_val = is_index and pk_rec or nil
	local adv_group = desc and (is_index and C.MDBX_PREV_NODUP or C.MDBX_PREV)
	                       or  (is_index and C.MDBX_NEXT_NODUP or C.MDBX_NEXT)
	local adv_pk   = desc and C.MDBX_PREV_DUP or C.MDBX_NEXT_DUP
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
			is_index and mk_rec or nil, is_index and pk_rec or mk_rec, get_base_val)
	end
	function node:merge_key() return mk_rec.data, mk_rec.size end
	function node:next_group()
		if not cur then cur = db:cursor(schema.name) end
		if first then
			first = false
			local sk, sk_sz, sk_open
			if desc then sk, sk_sz, sk_open = hi_key, hi_sz, hi_open
			else         sk, sk_sz, sk_open = lo_key, lo_sz, lo_open end
			if sk then
				mk_rec.data = sk; mk_rec.size = sk_sz
				if not cur:move_raw_into(
					desc and C.MDBX_TO_KEY_LESSER_OR_EQUAL or C.MDBX_SET_RANGE,
					mk_rec, adv_val)
				then return end
				if sk_open and key_eq(mk_rec.data, mk_rec.size, sk, sk_sz) then
					if not cur:move_raw_into(
						desc and C.MDBX_PREV_NODUP or C.MDBX_NEXT_NODUP,
						mk_rec, adv_val)
					then return end
				elseif desc and is_index then
					if not cur:move_raw_into(C.MDBX_LAST_DUP, mk_rec, pk_rec)
					then return end
				end
			else
				if not cur:move_raw_into(
					desc and C.MDBX_LAST or C.MDBX_FIRST,
					mk_rec, adv_val)
				then return end
			end
			if bnd_key and cmp_bnd(mk_rec.data, mk_rec.size, bnd_key, bnd_sz)
			then return end
			has_pk = true
			return true
		end
		if not cur:move_raw_into(adv_group, mk_rec, adv_val)
		then has_pk = nil; return end
		if bnd_key and cmp_bnd(mk_rec.data, mk_rec.size, bnd_key, bnd_sz) then
			has_pk = nil; return
		end
		has_pk = true; base_seeked = false
		return true
	end
	if is_index then
		function node:next_pk()
			if not has_pk then return end
			if not cur:move_raw_into(adv_pk, mk_rec, pk_rec)
			then has_pk = nil; return end
			base_seeked = false
			return true
		end
	end
	if not desc then
		function node:skip_to(target, target_sz)
			mk_rec.data = target; mk_rec.size = target_sz
			if not cur:move_raw_into(C.MDBX_SET_RANGE, mk_rec, adv_val)
			then has_pk = nil; return end
			if hi_key and cmp_hi(mk_rec.data, mk_rec.size, hi_key, hi_sz)
			then has_pk = nil; return end
			has_pk = true; base_seeked = false
			first = false
			return true
		end
		if is_index then
			function node:reset_group()
				if not cur:move_raw_into(C.MDBX_SET_KEY, mk_rec, pk_rec) then return end
				has_pk = true; base_seeked = false
				return true
			end
		end
		if prefix then
			--re-seek to a new prefix on the same open cursor; used by pk_join_seek
			--for per-row seeks. needs a different cmp that stops once the key no
			--longer starts with buf, as opposed to stopping at the boundary value.
			function node:reset_prefix(buf, buf_sz)
				lo_key = buf; lo_sz = buf_sz; lo_open = false
				bnd_key = buf; bnd_sz = buf_sz; cmp_bnd = key_past_prefix
				is_open = true
				has_pk = nil; base_seeked = false; first = true
			end
		end
	end
	function node:close()
		if is_open then
			if cur then cur:close(); cur = nil end
			if base_cur then base_cur:close(); base_cur = nil end
			is_open = false
		end
	end
	local vals = {}
	function node:open(params)
		assert(not is_open, 'node already open')
		lo_open = lo_open_arg
		hi_open = hi_open_arg
		if prefix then
			for i = 1, nprefix do vals[i] = params[names[i]] end
			if prefix_partial then
				assertf(vals[nprefix] ~= nil and vals[nprefix] ~= null,
					'pk_range: %s: partial prefix is null', schema.name)
			end
			local prefix_sz = encode_key_prefix(db, schema, 'range',
				mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE,
				nprefix, prefix_partial, unpack(vals, 1, nprefix))
			lo_key = u8a(prefix_sz); copy(lo_key, mdbx_key_rec_buffer, prefix_sz)
			lo_sz = prefix_sz; lo_open = false
			--compute the strict upper bound for this encoded byte prefix.
			--if all bytes are 0xff, there is no finite upper bound.
			local i = prefix_sz - 1
			while i >= 0 and lo_key[i] == 255 do i = i - 1 end
			if i >= 0 then
				hi_sz = i + 1
				hi_key = u8a(hi_sz); copy(hi_key, lo_key, hi_sz)
				hi_key[i] = hi_key[i] + 1
				hi_open = true
			else
				hi_key = nil; hi_sz = nil
			end
		else
			if lo_i then
				for i = 1, lo_n do vals[i] = params[names[lo_i + i - 1]] end
				lo_sz = encode_key(db, schema, 'range', nil,
					mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE,
					schema.key_cols, nil, unpack(vals, 1, lo_n))
				lo_key = u8a(lo_sz); copy(lo_key, mdbx_key_rec_buffer, lo_sz)
			else lo_key = nil; lo_sz = nil end
			if hi_i then
				for i = 1, hi_n do vals[i] = params[names[hi_i + i - 1]] end
				hi_sz = encode_key(db, schema, 'range', nil,
					mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE,
					schema.key_cols, nil, unpack(vals, 1, hi_n))
				hi_key = u8a(hi_sz); copy(hi_key, mdbx_key_rec_buffer, hi_sz)
			else
				hi_key = nil
				hi_sz = nil
			end
		end
		cmp_hi = hi_open and key_ge or key_gt
		cmp_lo = lo_open and key_le or key_lt
		cmp_bnd = desc and cmp_lo or cmp_hi
		bnd_key = desc and lo_key or hi_key
		bnd_sz  = desc and lo_sz  or hi_sz
		is_open = true
		has_pk = nil; base_seeked = false; first = true
	end
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	--base table has no next_pk override (one pk per group); index does.
	if not is_index then node.next_item = node.next_group end
	return node
end

function Db:pk_prefix(ix_name, ...)
	return self:pk_range(ix_name,
		{prefix = true, n_fixed_params = select('#', ...)}, ...)
end

--[[
fk_parent_scan: scan distinct child FK index keys and return
matching parent PKs. Each distinct FK key (NEXT_NODUP) whose
components are all non-null is a parent PK. Returns parent PKs in
ascending PK order (FK index key order = parent PK order).
Usage: db:fk_parent_scan(child_fk_index_name)
]]
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
	local nullable_fk = false
	for _, f in ipairs(schema.key_fields) do
		if not f.not_null then nullable_fk = true end
	end
	local node = object(self, {
		members = {parent_schema.name},
		order   = {{member = parent_schema.name, col = 'pk', dir = 'asc'}},
	})
	local cur, is_open
	local op
	local has_pk
	local pk_rec = MDBX_val()
	--not_null FK cols byte-match the parent PK already: pk_rec is used as-is.
	--nullable FK cols don't (extra marker byte), so re-encode via
	--schema_key_reencode, and skip entries that decode null (a null
	--FK references no parent). reenc_buf is per-node: a merge partner may
	--hold this node's current key alive while comparing against another.
	local reenc_buf = nullable_fk and u8a(MDBX_MAX_KEY_SIZE) or nil
	local function skip_nulls()
		while has_pk do
			if not nullable_fk then return true end
			local sz = key_reencode(schema, parent_schema,
				pk_rec.data, pk_rec.size, reenc_buf, MDBX_MAX_KEY_SIZE)
			if sz >= 0 then
				pk_rec.data = reenc_buf; pk_rec.size = sz
				return true
			end
			has_pk = cur:move_raw_into(C.MDBX_NEXT_NODUP, pk_rec, nil)
		end
	end
	function node:pk(name)
		if has_pk and (name == nil or name == parent_schema.name) then
			return true, pk_rec.data, pk_rec.size
		end
	end
	function node:merge_key() return pk_rec.data, pk_rec.size end
	function node:skip_to(target, target_sz)
		if nullable_fk then
			--target is a parent PK; re-encode into a FK index seek prefix
			--(same function, schema args swapped: parent is now the source).
			local sz = key_reencode(parent_schema, schema,
				target, target_sz, reenc_buf, MDBX_MAX_KEY_SIZE)
			pk_rec.data = reenc_buf; pk_rec.size = sz
		else
			pk_rec.data = target; pk_rec.size = target_sz
		end
		has_pk = cur:move_raw_into(C.MDBX_SET_RANGE, pk_rec, nil)
		op = C.MDBX_NEXT_NODUP
		return skip_nulls()
	end
	function node:next_group()
		if not cur then cur = db:cursor(schema.name) end
		has_pk = cur:move_raw_into(op, pk_rec, nil)
		op = C.MDBX_NEXT_NODUP
		return skip_nulls()
	end
	function node:close()
		if is_open then
			if cur then cur:close(); cur = nil end
			is_open = false
		end
	end
	function node:open(params)
		assert(not is_open, 'node already open')
		is_open = true
		op = C.MDBX_FIRST; has_pk = nil
	end
	node.merge_cmp = key_cmp
	node.merge_sig = parent_schema.key_sig
	node.next_item = node.next_group  --one parent pk per group; next_pk noop
	return node
end

--[[
pk_group_first: distinct index key scan; yields one PK per group
via NEXT_NODUP. next_pk() is noop: only the first PK of each
distinct index key is exposed. With prefix values, scans only keys
whose first nk columns equal the given values.
Usage: db:pk_group_first(ix_name [, val...])
]]
Db.pk_group_first = object(Db.query_node, {
	kind   = 'pk_group_first',
	item   = 'pk',
	unique = true,
	source = 'index cursor',
	work   = 'index distinct key scan; first PK per group',
})
function Db.pk_group_first:__call(db, ix_name, ...)
	local schema = resolve(db, ix_name)
	check_index(schema, 'pk_group_first', ix_name)
	local key_names = {...}
	local nkey = #schema.key_fields
	local val_schema = schema.val_schema
	local order = {}
	for _, f in ipairs(schema.key_fields) do
		order[#order+1] = {member = val_schema.name, col = f.col, dir = 'asc'}
	end
	local ix_key, sz
	local node = object(self, {
		members = {val_schema.name},
		order   = order,
	})
	local cur, base_cur, is_open
	local has_pk
	local mk_rec = MDBX_val()
	local pk_rec = MDBX_val()
	local base_val_rec = MDBX_val()
	local base_seeked
	local nk = #key_names
	local key_vals = {}
	local function get_base_val()
		if not base_seeked then
			if not base_cur then base_cur = db:cursor(val_schema.name) end
			base_cur:move_raw_into(C.MDBX_SET_KEY, pk_rec, base_val_rec)
			base_seeked = true
		end
		return base_val_rec.data, base_val_rec.size
	end
	function node:pk(name)
		if has_pk and (name == nil or name == val_schema.name) then
			return true, pk_rec.data, pk_rec.size
		end
	end
	function node:compile_col(member, col)
		return db:compile_col(schema, col, mk_rec, pk_rec, get_base_val)
	end
	function node:merge_key() return mk_rec.data, mk_rec.size end
	if nk > 0 then
		local first
		function node:next_group()
			if not cur then cur = db:cursor(schema.name) end
			if first then
				first = false
				mk_rec.data = ix_key; mk_rec.size = sz
				if not cur:move_raw_into(C.MDBX_SET_RANGE, mk_rec, pk_rec) then return end
				if mk_rec.size < sz
				or memcmp(mk_rec.data, ix_key, sz) ~= 0 then return end
				has_pk = true
				return true
			end
			if not cur:move_raw_into(C.MDBX_NEXT_NODUP, mk_rec, pk_rec)
			then has_pk = nil; return end
			if mk_rec.size < sz
			or memcmp(mk_rec.data, ix_key, sz) ~= 0 then
				has_pk = nil; return
			end
			has_pk = true; base_seeked = false
			return true
		end
		function node:close()
			if is_open then
				if cur then cur:close(); cur = nil end
				if base_cur then base_cur:close(); base_cur = nil end
				is_open = false
			end
		end
		function node:open(params)
			assert(not is_open, 'node already open')
			assertf(nk >= 1 and nk < nkey,
				'pk_group_first: %s needs 1..%d prefix column(s), got %d',
				schema.name, nkey - 1, nk)
			for i, kn in ipairs(key_names) do key_vals[i] = params[kn] end
			sz = encode_key_prefix(db, schema, 'prefix',
				mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE,
				nk, false, unpack(key_vals, 1, nk))
			ix_key = u8a(sz); copy(ix_key, mdbx_key_rec_buffer, sz)
			is_open = true
			has_pk = nil; base_seeked = false; first = true
		end
	else
		local op
		function node:next_group()
			if not cur then cur = db:cursor(schema.name) end
			if not cur:move_raw_into(op, mk_rec, pk_rec) then has_pk = nil; return end
			op = C.MDBX_NEXT_NODUP
			has_pk = true; base_seeked = false
			return true
		end
		function node:close()
			if is_open then
				if cur then cur:close(); cur = nil end
				if base_cur then base_cur:close(); base_cur = nil end
				is_open = false
			end
		end
		function node:open(params)
			assert(not is_open, 'node already open')
			is_open = true
			has_pk = nil; base_seeked = false; op = C.MDBX_FIRST
		end
	end
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	node.next_item = node.next_group  --first pk per distinct key; next_pk noop
	return node
end

--MERGE NODES ----------------------------------------------------------------

-- Marks a node as optional (left outer) in db:merge_join.
-- Usage: db:merge_join(required_node, db.left(optional_node), ...)
Db.left = function(node) return {left = node} end

--[[
merge_join: n-ary parallel merge join on merge_key bytes.
inputs: access nodes exposing merge_key(), pk(), get_pk(),
next_group(), next_pk(), reset_group(), skip_to().
Wrap optional inputs with db.left(node) for left outer join.
Usage: db:merge_join(node [, db.left(node)] ...)
]]
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
		extend(members, inputs[i].members)
		extend(order, inputs[i].order)
	end
	local node = object(self, {
		members = members,
		order   = #order > 0 and order or nil,
	})
	node.inputs = inputs
	node.merge_cmp = inputs[1].merge_cmp
	node.merge_sig = inputs[1].merge_sig
	local mk    = {}
	local mk_sz = {}
	local matched = any_optional and {} or nil
	local yielded
	function node:close() for i = 1, n do inputs[i]:close() end end
	function node:merge_key() return mk[1], mk_sz[1] end
	local function advance()
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
					if inputs[i]:next_group()
					then mk[i], mk_sz[i] = inputs[i]:merge_key()
					else mk[i] = nil end
				end
				if matched then for i = 1, n do matched[i] = false end end
			else
				-- left-outer no-match: advance input 1 only
				if inputs[1]:next_pk() then return true end
				if inputs[1]:next_group()
				then mk[1], mk_sz[1] = inputs[1]:merge_key()
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
					if merge_cmp(mk[i], mk_sz[i], mk[max_i], mk_sz[max_i]) > 0
					then max_i = i end
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
	node.next_group = advance
	function node:skip_to(target, target_sz)
		for i = 1, n do
			if mk[i] ~= nil and merge_cmp(mk[i], mk_sz[i], target, target_sz) < 0 then
				if inputs[i]:skip_to(target, target_sz)
				then mk[i], mk_sz[i] = inputs[i]:merge_key()
				else mk[i] = nil end
			end
		end
		yielded = false
		return advance()
	end
	function node:pk(name)
		if not yielded then return end
		for i = 1, n do
			if not matched or not optional[i] or matched[i] then
				local ok, p, sz = inputs[i]:pk(name)
				if ok then return true, p, sz end
			end
		end
	end
	function node:compile_col(member, col)
		for i = 1, n do
			for _, m in ipairs(inputs[i].members) do
				if m == member then
					local inner = inputs[i]:compile_col(member, col)
					if matched and optional[i] then
						return function() return matched[i] and inner() or nil end
					end
					return inner
				end
			end
		end
	end
	function node:open(params)
		for i = 1, n do inputs[i]:open(params) end
		yielded = false
		for i = 1, n do mk[i] = nil; mk_sz[i] = nil end
		if matched then for i = 1, n do matched[i] = false end end
		for i = 1, n do
			if inputs[i]:next_group() then mk[i], mk_sz[i] = inputs[i]:merge_key() end
		end
	end
	node.next_item = node.next_group  --one tuple per convergence; next_pk noop
	return node
end

--[[
merge_union: n-ary sorted-merge union on merge_key bytes.
mode='union' (default): dedup, get_pk from the yielding input only.
mode='full': dedup, get_pk from all inputs at the yielded key
(full outer join).
mode='union_all': no dedup, advance only the yielding input each step.
Inputs must be unique (one pk per next_group call).
Usage: db:merge_union(['union'|'full'|'union_all',] node, node, ...)
]]
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
	node.inputs = inputs
	node.merge_cmp = merge_cmp
	node.merge_sig = inputs[1].merge_sig
	local mk    = {}
	local mk_sz = {}
	local to_adv = mode ~= 'union_all' and {} or nil
	local yielded, cur_i
	function node:close() for i = 1, n do inputs[i]:close() end end
	function node:merge_key() return inputs[cur_i]:merge_key() end
	--[[
	Linear scan over all n inputs per step to find the minimum merge key:
	O(n) per output item, O(n*m) total over m output items. A binary
	heap would give O(m log n), but the constant factor overhead is only
	worthwhile for large n (typically n=2..4 here).
	]]
	local function advance()
		if yielded then
			if mode == 'union_all' then
				if inputs[cur_i]:next_group()
				then mk[cur_i], mk_sz[cur_i] = inputs[cur_i]:merge_key()
				else mk[cur_i] = nil end
			else
				for i = 1, n do
					if to_adv[i] then
						to_adv[i] = false
						if inputs[i]:next_group()
						then mk[i], mk_sz[i] = inputs[i]:merge_key()
						else mk[i] = nil end
					end
				end
			end
		end
		yielded = false
		local min_i
		for i = 1, n do
			if mk[i] ~= nil then
				if not min_i
				or merge_cmp(mk[i], mk_sz[i], mk[min_i], mk_sz[min_i]) < 0 then
					min_i = i
				end
			end
		end
		if not min_i then return end
		cur_i = min_i
		if mode ~= 'union_all' then
			for i = 1, n do
				if mk[i] ~= nil
				and merge_cmp(mk[i], mk_sz[i], mk[min_i], mk_sz[min_i]) == 0 then
					to_adv[i] = true
				end
			end
		end
		yielded = true
		return true
	end
	node.next_group = advance
	function node:skip_to(target, target_sz)
		for i = 1, n do
			if mk[i] ~= nil and merge_cmp(mk[i], mk_sz[i], target, target_sz) < 0 then
				if inputs[i]:skip_to(target, target_sz)
				then mk[i], mk_sz[i] = inputs[i]:merge_key()
				else mk[i] = nil end
			end
		end
		yielded = false
		return advance()
	end
	function node:pk(name)
		if not yielded then return end
		if mode == 'full' then
			for i = 1, n do
				if to_adv[i] then
					local ok, p, sz = inputs[i]:pk(name)
					if ok then return true, p, sz end
				end
			end
		else
			return inputs[cur_i]:pk(name)
		end
	end
	function node:compile_col(member, col)
		if mode == 'full' then
			for i = 1, n do
				for _, m in ipairs(inputs[i].members) do
					if m == member then
						local inner = inputs[i]:compile_col(member, col)
						return function() return to_adv[i] and inner() or nil end
					end
				end
			end
		else
			local closures = {}
			for i = 1, n do closures[i] = inputs[i]:compile_col(member, col) end
			return function() return closures[cur_i]() end
		end
	end
	function node:open(params)
		for i = 1, n do inputs[i]:open(params) end
		yielded = false; cur_i = nil
		for i = 1, n do mk[i] = nil; mk_sz[i] = nil end
		if to_adv then for i = 1, n do to_adv[i] = false end end
		for i = 1, n do
			if inputs[i]:next_group() then mk[i], mk_sz[i] = inputs[i]:merge_key() end
		end
	end
	node.next_item = node.next_group  --one pk per merge step; next_pk noop
	return node
end

-- merge_except: set difference; yields merge_keys in input 1 not in input 2.
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
	node.inputs = {a, b}
	node.merge_cmp = merge_cmp
	node.merge_sig = a.merge_sig
	local mk1, mk1_sz, mk2, mk2_sz
	local yielded
	function node:close() a:close(); b:close() end
	function node:merge_key() return a:merge_key() end
	local function advance()
		if yielded then
			if a:next_group()
			then mk1, mk1_sz = a:merge_key() else mk1 = nil end
		end
		yielded = false
		while true do
			if mk1 == nil then return end
			if mk2 == nil then yielded = true; return true end
			local c = merge_cmp(mk1, mk1_sz, mk2, mk2_sz)
			if c < 0 then
				yielded = true; return true
			elseif c == 0 then
				if a:next_group()
				then mk1, mk1_sz = a:merge_key() else mk1 = nil end
				if b:next_group()
				then mk2, mk2_sz = b:merge_key() else mk2 = nil end
			else
				if b:skip_to(mk1, mk1_sz)
				then mk2, mk2_sz = b:merge_key() else mk2 = nil end
			end
		end
	end
	node.next_group = advance
	function node:skip_to(target, target_sz)
		if mk1 ~= nil and merge_cmp(mk1, mk1_sz, target, target_sz) < 0 then
			if a:skip_to(target, target_sz)
			then mk1, mk1_sz = a:merge_key() else mk1 = nil end
		end
		if mk2 ~= nil and merge_cmp(mk2, mk2_sz, target, target_sz) < 0 then
			if b:skip_to(target, target_sz)
			then mk2, mk2_sz = b:merge_key() else mk2 = nil end
		end
		yielded = false
		return advance()
	end
	function node:pk(name)
		if not yielded then return end
		return a:pk(name)
	end
	node.compile_col = a.compile_col
	function node:open(params)
		a:open(params); b:open(params)
		yielded = false; mk1 = nil; mk2 = nil
		if a:next_group() then mk1, mk1_sz = a:merge_key() end
		if b:next_group() then mk2, mk2_sz = b:merge_key() end
	end
	node.next_item = node.next_group  --one pk per step; next_pk noop
	return node
end

--PROBE NODES ----------------------------------------------------------------

--an index qualifies if a FK's columns are a leading prefix of it;
--longest match wins if more than one FK qualifies.
local function find_fk(db, child_schema, fk_schema, caller, fk_name)
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
	if best then return best, resolve(db, best.ref_table) end
	assertf(false, '%s: %s is not a FK index', caller, fk_name)
end

--[[
pk_join_seek: nested join -- one MDBX_SET_KEY seek on the FK index
per driver PK. driver: any PK-stream node; fk: FK index name.
Output: PK tuple stream in driver order; one seek per row, O(n log m).
fk may be wider than the FK's own columns; then the seek becomes a
prefix scan instead of an exact match (see fk_child below).
opts.left = true: left join; emit parent with absent child.
opts.member: name for the new child member (default: child_schema.name).
opts.from_member: name of the existing parent member in driver
(default: parent_schema.name); needed when the parent was joined
under an alias, e.g. a self-join.
Usage: db:pk_join_seek(driver, fk_ix_name [, opts])
]]
Db.pk_join_seek = object(Db.query_node, {
	kind   = 'pk_join_seek',
	item   = 'pk_tuple',
	unique = false,
	source = 'probe',
	work   = 'FK index seek per driver row',
})
function Db.pk_join_seek:__call(db, driver, fk_name, opts)
	check_pk_node(driver, 'pk_join_seek', 1)
	opts = opts or {}
	local fk_schema = resolve(db, fk_name)
	check_index(fk_schema, 'pk_join_seek', fk_name)
	local child_schema = fk_schema.val_schema
	local fk, parent_schema = find_fk(
		db, child_schema, fk_schema, 'pk_join_seek', fk_name)
	local from_member = opts.from_member or parent_schema.name
	local child_member = opts.member or child_schema.name
	-- driver may carry multiple members (chained joins); child is the new one.
	assertf(driver_has_member(driver, from_member),
		'pk_join_seek: driver must have member %s', from_member)
	local left_join = opts.left
	local members = extend({}, driver.members)
	members[#members+1] = child_member
	local node = object(self, {
		members = members,
		order   = driver.order,
	})
	--wide index: children of one parent are a key range, not dupsort
	--duplicates of one key. fk_child (pk_prefix, reset per row) walks
	--that range instead of the narrow case's exact SET_KEY/NEXT_DUP.
	local wide = #fk_schema.pk > #fk.cols
	--seek/reset_prefix below reuse driver's parent-pk bytes as-is, which
	--only works if the FK index key is byte-identical to the parent pk
	--(fails for a nullable FK col: extra marker byte). not_null is the
	--only attribute that can differ (add_fk enforces the rest), same
	--check as fk_parent_scan's nullable_fk.
	local reencode = false
	for _, col in ipairs(fk.cols) do
		if not child_schema.fields[col].not_null then reencode = true; break end
	end
	local reenc_buf = reencode and u8a(MDBX_MAX_KEY_SIZE) or nil
	local fk_child = wide and db:pk_prefix(fk_name, unpack(fk.cols)) or nil
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
			if not has_child then return end -- left-join: parent present, child absent
			if wide then return fk_child:pk(child_schema.name) end
			return true, child_pk_rec.data, child_pk_rec.size
		end
		return driver:pk(name)
	end
	function node:compile_col(member, col)
		if member == child_member then
			local inner = wide and fk_child:compile_col(child_schema.name, col)
				or db:compile_col(child_schema, col, nil, child_pk_rec, get_child_val)
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
					if fk_child:next_pk() then has_pair = true; has_child = true; return true end
					if fk_child:next_group() then has_pair = true; has_child = true; return true end
					in_match = false
				end
				if not driver:next_item() then return end
				local _, p, p_sz = driver:pk(from_member)
				parent_pk, parent_pk_sz = p, p_sz
				if reencode then
					local sz = key_reencode(
						parent_schema, fk_schema, p, p_sz, reenc_buf, MDBX_MAX_KEY_SIZE)
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
				local sz = key_reencode(
					parent_schema, fk_schema, p, p_sz, reenc_buf, MDBX_MAX_KEY_SIZE)
				parent_pk_rec.data = reenc_buf; parent_pk_rec.size = sz
			else
				parent_pk_rec.data = p; parent_pk_rec.size = p_sz
			end
			if fk_cur:move_raw_into(C.MDBX_SET_KEY, parent_pk_rec, child_pk_rec) then
				in_match = true
				child_base_seeked = false
				has_pair = true; has_child = true; return true
			end
			if left_join then has_pair = true; return true end
		end
	end
	function node:open(params)
		assert(not is_open, 'node already open')
		driver:open(params)
		is_open = true
		has_pair = false; has_child = false; in_match = false; child_base_seeked = false
		parent_pk = nil; parent_pk_sz = nil
	end
	node.next_item = node.next_group  --one tuple per driver step; next_pk noop
	return node
end

--TRANSFORM NODES -----------------------------------------------------------

--[[
pk_hash_filter: materialise set node PKs into a hash, then filter
driver by membership. mode='in': keep driver items whose PK is in
the set. mode='not_in': keep driver items whose PK is not in the
set. set_node must be a flat pk stream; driver may carry other
tuple members (chained joins) alongside the one tested against the
set, named by set_node's own member. Driver and set may differ in
order and key space.
Usage: db:pk_hash_filter(driver, set_node, mode)
]]
Db.pk_hash_filter = object(Db.query_node, {
	kind   = 'pk_hash_filter',
	unique = false,
	source = 'probe',
	work   = 'materialise set + driver scan',
})
function Db.pk_hash_filter:__call(db, driver, set_node, mode)
	check_pk_node(driver, 'pk_hash_filter', 1)
	check_pk_node(set_node, 'pk_hash_filter', 2)
	assertf(mode == 'in' or mode == 'not_in',
		'pk_hash_filter: mode must be "in" or "not_in"')
	check_flat_pk(set_node, 'pk_hash_filter', 'set')
	local member_name = set_node.members[1]
	assertf(driver_has_member(driver, member_name),
		'pk_hash_filter: driver must have member %s', member_name)
	local node = object(self, {
		members = driver.members,
		order   = driver.order,
		unique  = driver.unique,
		item    = driver.item,
	})
	node.inputs = {driver, set_node}
	node.merge_cmp = driver.merge_cmp
	node.merge_sig = driver.merge_sig
	local pk_set
	-- Avoid per-row string allocation + Lua hash lookup for 4-byte u32 keys:
	-- measured ~2x in pk_hash_filter and ~2.8x-3.6x materialise+probe.
	local use_u32_set = pk_is_u32(resolve(db, member_name))
		and pk_is_u32(resolve(db, set_node.members[1]))
	local has_pk, cur_pk, cur_pk_sz
	local want_in = mode == 'in'
	function node:compile_col(m, c) return driver:compile_col(m, c) end
	function node:close() driver:close() end
	function node:pk(name)
		if not has_pk then return end
		if name == member_name then return true, cur_pk, cur_pk_sz end
		return driver:pk(name)
	end
	function node:merge_key() return driver:merge_key() end
	function node:next_group()
		has_pk = false
		while true do
			if not driver:next_item() then return end
			local _, p, p_sz = driver:pk(member_name)
			local found
			if use_u32_set then
				found = pk_set:index_of(p) ~= -1
			else
				found = pk_set[str(p, p_sz)] ~= nil
			end
			if found == want_in then
				cur_pk, cur_pk_sz = p, p_sz
				has_pk = true
				return true
			end
		end
	end
	function node:open(params)
		set_node:open(params)
		if use_u32_set then
			pk_set = u32_keyset()
			while set_node:next_item() do
				local _, p = set_node:pk()
				pk_set:add(p)
			end
			pk_set:sort()
		else
			pk_set = {}
			while set_node:next_item() do
				local _, p, p_sz = set_node:pk()
				pk_set[str(p, p_sz)] = true
			end
		end
		set_node:close()
		driver:open(params)
		has_pk = false; cur_pk = nil; cur_pk_sz = nil
	end
	node.next_item = node.next_group  --one driver item per step; next_pk noop
	return node
end

--[[
pk_parent_lookup: reverse FK join -- for each child PK, reads FK
column values via compile_col and seeks the parent base table.
driver: any PK-stream node producing child PKs; fk: FK index name.
Output: PK tuple stream in child (driver) order.
opts.left = true: left join; emit child with absent parent.
opts.member: name for the new parent member (default: parent_schema.name).
opts.from_member: name of the existing child member in driver
(default: child_schema.name); needed when the child was joined
under an alias, e.g. a self-join.
Usage: db:pk_parent_lookup(driver, fk_ix_name [, opts])
]]
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
	local fk, parent_schema = find_fk(
		db, child_schema, fk_schema, 'pk_parent_lookup', fk_name)
	local from_member = opts.from_member or child_schema.name
	local parent_member = opts.member or parent_schema.name
	-- driver may carry multiple members (chained joins); parent is the new one.
	assertf(driver_has_member(driver, from_member),
		'pk_parent_lookup: driver must have member %s', from_member)
	local left_join = opts.left
	local members = extend({}, driver.members)
	members[#members+1] = parent_member
	local node = object(self, {
		members = members,
		order   = driver.order,
	})
	node.inputs = {driver}
	node.merge_cmp = driver.merge_cmp
	node.merge_sig = driver.merge_sig
	local parent_cur, is_open
	local child_pk, child_pk_sz
	local parent_pk, parent_pk_sz
	local parent_key_rec = MDBX_val()
	local parent_val_rec = MDBX_val()
	local has_child, has_parent, parent_base_seeked
	local fk_row = {}
	local fk_fns = {}
	local function get_parent_val()
		if not parent_base_seeked then
			parent_cur:move_raw_into(C.MDBX_SET_KEY, parent_key_rec, parent_val_rec)
			parent_base_seeked = true
		end
		return parent_val_rec.data, parent_val_rec.size
	end
	function node:close()
		if is_open then
			driver:close()
			if parent_cur then parent_cur:close(); parent_cur = nil end
			is_open = false
		end
	end
	function node:merge_key() return child_pk, child_pk_sz end
	function node:pk(name)
		if not has_child then return end
		-- parent is the only member owned here; all others delegate upstream.
		if name == parent_member then
			if has_parent then return true, parent_pk, parent_pk_sz end
			return -- left-join: child present but parent absent
		end
		return driver:pk(name)
	end
	function node:compile_col(member, col)
		if member == parent_member then
			local inner = db:compile_col(
				parent_schema, col, nil, parent_key_rec, get_parent_val)
			return function() return has_parent and inner() or nil end
		end
		return driver:compile_col(member, col)
	end
	--[[
	Per child row: decode FK column values, encode parent PK, then
	do a base-table MDBX_SET_KEY seek. The decode-encode round-trip is
	unavoidable: FK columns live in the child record/index; the parent
	key must be reassembled from them. After the seek MDBX_SET_KEY
	overwrites parent_key_rec.data to point into DB memory, so no copy
	is needed to retain the key.
	]]
	function node:next_group()
		has_child = false; has_parent = false
		if not parent_cur then parent_cur = db:cursor(parent_schema.name) end
		while true do
			if not driver:next_item() then return end
			local _, cp, cp_sz = driver:pk(from_member)
			child_pk, child_pk_sz = cp, cp_sz
			local has_null = false
			for i, ref_col in ipairs(fk.ref_cols) do
				local v = fk_fns[i]()
				if v == nil then has_null = true end
				fk_row[ref_col] = v
			end
			--a null FK component means no parent to look up; encode_key would
			--crash trying to encode it (a null PK field is a real bug for its
			--other callers, insert/update), so skip straight to the same
			--fallback used for a real FK with no matching parent row.
			if not has_null then
				local pp_sz = encode_key(db, parent_schema, 'pk_parent_lookup', nil,
					mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE,
					parent_schema.key_cols, '{}', fk_row)
				parent_key_rec.data = mdbx_key_rec_buffer; parent_key_rec.size = pp_sz
				if parent_cur:move_raw_into(C.MDBX_SET_KEY, parent_key_rec, nil) then
					parent_pk, parent_pk_sz = parent_key_rec.data, parent_key_rec.size
					parent_base_seeked = false
					has_child = true; has_parent = true; return true
				end
			end
			if left_join then has_child = true; return true end
		end
	end
	function node:open(params)
		assert(not is_open, 'node already open')
		driver:open(params)
		is_open = true
		for i, kf in ipairs(fk_schema.key_fields) do
			fk_fns[i] = driver:compile_col(from_member, kf.col)
		end
		has_child = false; has_parent = false; parent_base_seeked = false
		child_pk = nil; child_pk_sz = nil; parent_pk = nil; parent_pk_sz = nil
	end
	node.next_item = node.next_group  --one tuple per child row; next_pk noop
	return node
end

-- pk_filter: keep items from a pk stream where fn(node, params) is true.
-- fn receives the positioned pk_filter node and the open() params table.
-- Usage: db:pk_filter(input, fn)
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
	local has_pk, cur_params
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
			if fn(node, cur_params) then return true end
		end
	end
	function node:open(params)
		cur_params = params
		input:open(params)
		has_pk = false
	end
	node.next_item = node.next_group  --one input item per step; next_pk noop
	return node
end

-- outer_fn: passed to factory per outer row; reads outer column values.
-- outer('sname.col', ...) -> {v1, ...}; supports composite keys.
local function make_outer_fn(outer)
	return function(...)
		local result = {}
		for i = 1, select('#', ...) do
			local ref = select(i, ...)
			local sn, c = ref:match('^([^%.]+)%.(.+)$')
			assertf(sn and c, 'outer: expected "sname.col", got %q', ref)
			result[#result+1] = outer:col(sn, c)
		end
		return result
	end
end

local function make_existence_join(self, db, outer, fn, want_inner)
	check_pk_node(outer, self.kind, 1)
	assert(type(fn) == 'function', self.kind..': fn must be a function')
	local node = object(self, {
		members = outer.members,
		order   = outer.order,
		unique  = outer.unique,
		item    = outer.item,
	})
	node.inputs = {outer}
	node.merge_cmp = outer.merge_cmp
	node.merge_sig = outer.merge_sig
	local has_pk, cur_params
	local outer_fn = make_outer_fn(outer)
	function node:compile_col(m, c) return outer:compile_col(m, c) end
	function node:close() outer:close() end
	function node:pk(name)
		if not has_pk then return end
		return outer:pk(name)
	end
	function node:merge_key() return outer:merge_key() end
	function node:next_group()
		has_pk = false
		while true do
			if not outer:next_item() then return end
			has_pk = true
			local inner, iparams = fn(outer_fn, cur_params)
			inner:open(iparams)
			local has_inner = inner:next_group() ~= nil
			inner:close()
			if has_inner == want_inner then return true end
			has_pk = false
		end
	end
	function node:open(params)
		cur_params = params
		outer:open(params)
		has_pk = false
	end
	node.next_item = node.next_group  --one outer item per step; next_pk noop
	return node
end

--[[
semi_join: keep outer items where fn(outer_fn, params) yields >= 1 item.
anti_join: keep outer items where fn(outer_fn, params) yields 0 items.
fn: factory(outer_fn, params) -> (inner_node, iparams); per outer row.
outer_fn('sname.col', ...) -> {v1,...}: reads current outer cols.
]]
Db.semi_join = object(Db.query_node, {
	kind   = 'semi_join',
	source = 'pass-through',
	work   = 'keep outer where factory yields >= 1 item',
})
Db.anti_join = object(Db.query_node, {
	kind   = 'anti_join',
	source = 'pass-through',
	work   = 'keep outer where factory yields 0 items',
})
function Db.semi_join:__call(db, outer, fn)
	return make_existence_join(self, db, outer, fn, true)
end
function Db.anti_join:__call(db, outer, fn)
	return make_existence_join(self, db, outer, fn, false)
end

--[[
nested_join: for each outer item, call fn(outer_fn, params) to get
(inner_node, iparams), then yield one output per inner item with
merged outer+inner members. Inner members must not overlap outer;
inner is opened/closed per outer item. node.members is extended
with inner members on the first iteration.
fn: factory(outer_fn, params) -> (inner_node, iparams).
outer_fn('sname.col', ...) -> {v1,...}: reads current outer cols.
opts.left = true: left join; when fn yields zero inner items, emit
the outer item once with the inner member absent (pk/compile_col
return nil for it), instead of dropping the outer item.
Usage: db:nested_join(outer, fn [, opts])
]]
Db.nested_join = object(Db.query_node, {
	kind   = 'nested_join',
	item   = 'pk_tuple',
	unique = false,
	source = 'pass-through',
	work   = 'correlated inner per outer item; one output per inner item',
})
function Db.nested_join:__call(db, outer, fn, opts)
	check_pk_node(outer, 'nested_join', 1)
	assert(type(fn) == 'function', 'nested_join: fn must be a function')
	local left = opts and opts.left
	local members = extend({}, outer.members)
	local node = object(self, {
		members = members,
		order   = outer.order,
		unique  = false,
		item    = 'pk_tuple',
	})
	node.inputs = {outer}
	node.merge_cmp = outer.merge_cmp
	node.merge_sig = outer.merge_sig
	local has_pk, cur_inner, cur_params
	local outer_fn = make_outer_fn(outer)
	local inner_members_set = false
	function node:close()
		outer:close()
		if cur_inner then cur_inner:close(); cur_inner = nil end
	end
	function node:pk(name)
		if not has_pk then return end
		local ok, p, sz = outer:pk(name)
		if ok then return true, p, sz end
		if cur_inner then return cur_inner:pk(name) end
	end
	function node:compile_col(member, col)
		for _, m in ipairs(outer.members) do
			if m == member then
				return outer:compile_col(member, col)
			end
		end
		local last_inner, cached_fn
		return function()
			if not cur_inner then return nil end
			if cur_inner ~= last_inner then
				cached_fn = cur_inner:compile_col(member, col)
				last_inner = cur_inner
			end
			return cached_fn()
		end
	end
	function node:merge_key() return outer:merge_key() end
	function node:next_group()
		has_pk = false
		while true do
			if cur_inner ~= nil then
				if cur_inner:next_pk() or cur_inner:next_group() then
					has_pk = true; return true
				end
				cur_inner:close(); cur_inner = nil
			end
			if not outer:next_item() then return end
			has_pk = true
			local inner, iparams = fn(outer_fn, cur_params)
			--[[
			inner.members can only be known after fn() is called
			(fn may return different node types per outer row), so
			we extend members on the first inner open rather than at
			construction time.
			]]
			if not inner_members_set then
				extend(members, inner.members)
				inner_members_set = true
			end
			inner:open(iparams)
			if inner:next_group() then cur_inner = inner; return true end
			inner:close()
			if left then return true end -- left join: outer emitted, inner member absent
			has_pk = false
		end
	end
	function node:open(params)
		cur_params = params
		outer:open(params)
		has_pk = false; cur_inner = nil
	end
	node.next_item = node.next_group  --one output item per step; next_pk noop
	return node
end

-- limit: yield at most n items, skipping offset items first (default 0).
-- Usage: db:limit(input, n [, offset])
Db.limit = object(Db.query_node, {
	kind   = 'limit',
	source = 'pass-through',
	work   = 'at most n items after skipping offset',
})
function Db.limit:__call(db, input, n, offset)
	check_node(input, 'limit', 1)
	assertf(type(n) == 'number' and n >= 0,
		'limit: n: non-negative number expected')
	offset = offset or 0
	assertf(type(offset) == 'number' and offset >= 0,
		'limit: offset: non-negative number expected')
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
	function node:open(params)
		input:open(params)
		has_item = false; count = 0; skipped = 0
	end
	node.next_item = node.next_group  --one input item per step; next_pk noop
	return node
end

--[[
pk_group: group consecutive input items by cols; yield first item per
group via next_group(), remaining via next_pk(). Requires input to
already be in group order. opts.which = 'first' (default).
stream_aggregate iterates via next_group/next_pk.
cols: list of {member=, col=}; getters compiled once at open(), compared
part-wise against a reused array instead of allocating a key table per row.
Usage: db:pk_group(input, cols [, opts])
]]
Db.pk_group = object(Db.query_node, {
	kind   = 'pk_group',
	item   = 'pk',
	unique = false,
	source = 'pass-through',
	work   = 'group by cols; first item per group via next_group; rest via next_pk',
})
function Db.pk_group:__call(db, input, cols, opts)
	check_pk_node(input, 'pk_group', 1)
	assertf(type(cols) == 'table' and #cols >= 1,
		'pk_group: cols: non-empty list expected')
	opts = opts or {}
	local which = opts.which or 'first'
	assertf(which == 'first', 'pk_group: opts.which="last" not yet implemented')
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
	-- true when the getters' current values still match prev (the group key).
	local function same_key()
		for i = 1, ncols do
			local v = getters[i](); if v == nil then v = null end
			if prev[i] ~= v then return false end
		end
		return true
	end
	-- overwrite prev with the getters' current values (new group key).
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
			-- skip remaining items in the previous group (caller may skip next_pk).
			if has_prev then
				while same_key() do
					if not adv() then return end
				end
			end
		end
		peeked = false
		set_key(); has_prev = true  -- input is positioned; has_current not yet true
		has_current = true
		return true
	end
	function node:next_pk()
		if not has_current then return end
		if not adv() then has_current = false; return end
		if same_key() then return true end
		peeked = true; has_current = false; return nil
	end
	function node:open(params)
		input:open(params)
		getters = {}
		for i, c in ipairs(cols) do getters[i] = input:compile_col(c.member, c.col) end
		prev = {}
		done = false; has_current = false; has_prev = false; peeked = false
	end
	return node
end

-- pk_project: extract one member's PK from a pk tuple into a flat pk stream.
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
			if o.member == member_name then
				order[#order+1] = o
			end
		end
	end
	local node = object(self, {
		members = {member_name},
		order   = #order > 0 and order or nil,
	})
	node.inputs = {input}
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	local has_pk, cur_pk, cur_pk_sz
	function node:compile_col(m, c) return input:compile_col(m, c) end
	function node:close() input:close() end
	function node:pk(name)
		if has_pk and (name == nil or name == member_name) then
			return true, cur_pk, cur_pk_sz
		end
	end
	function node:merge_key() return cur_pk, cur_pk_sz end
	function node:next_group()
		has_pk = false
		while true do
			if not input:next_item() then return end
			local ok, p, p_sz = input:pk(member_name)
			if ok then
				cur_pk, cur_pk_sz = p, p_sz
				has_pk = true
				return true
			end
		end
	end
	function node:open(params)
		input:open(params)
		has_pk = false; cur_pk = nil; cur_pk_sz = nil
	end
	node.next_item = node.next_group  --one projected pk per step; next_pk noop
	return node
end

-- pk_sort: collect all input PKs, sort and deduplicate; output in PK order.
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
		order   = {{member = member_name, col = 'pk', dir = 'asc'}},
	})
	node.inputs = {input}
	node.merge_cmp = key_cmp
	node.merge_sig = schema.key_sig
	--sorting in C for u32 keys (the most common) gives 25x-40x measured speed-up!
	local sort_u32_pk = pk_is_u32(schema)
	--[[
	Collect all PKs into a single flat byte buffer with a parallel
	offset array (one int per PK; size of PK i = offs[i+1]-offs[i],
	last = buf_used-offs[n]). Sort a separate index array over the
	offsets; dedup consecutive equal entries during iteration. For
	single-column u32 PKs, sort the flat PK buffer directly.
	]]
	local keys, buf, pk_buf, offs  -- flat pk buffer; starting offset of each pk
	local order      -- sorted indices into offs (1..n)
	local n, buf_used
	local base_cur, is_open
	local idx, prev_off, prev_sz
	local cur_pk_rec = MDBX_val()
	local base_val_rec = MDBX_val()
	local has_pk, base_seeked
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
		if has_pk and (name == nil or name == member_name) then
			return true, cur_pk_rec.data, cur_pk_rec.size
		end
	end
	function node:compile_col(member, col)
		return db:compile_col(schema, col, nil, cur_pk_rec, get_base_val)
	end
	function node:merge_key() return cur_pk_rec.data, cur_pk_rec.size end
	function node:next_group()
		while true do
			idx = idx + 1
			if sort_u32_pk then
				local p, p_sz = keys:next()
				if not p then has_pk = false; return end
				cur_pk_rec.data = p; cur_pk_rec.size = p_sz
				has_pk = true; base_seeked = false
				return true
			else
				local oi = order[idx]
				if not oi then has_pk = false; return end
				local off = offs[oi]
				local sz  = (oi < n and offs[oi + 1] or buf_used) - off
				if not (prev_off and key_eq(buf + off, sz, buf + prev_off, prev_sz)) then
					cur_pk_rec.data = buf + off; cur_pk_rec.size = sz
					prev_off = off; prev_sz = sz
					has_pk = true; base_seeked = false
					return true
				end
			end
		end
	end
	function node:open(params)
		assert(not is_open, 'node already open')
		input:open(params)
		if sort_u32_pk then
			keys = u32_keyset()
			pk_buf = nil; offs = nil
		else
			pk_buf = string_buffer(256)
			offs = {}
		end
		n = 0; buf_used = 0
		while input:next_item() do
			local _, p, p_sz = input:pk()
			n = n + 1
			if sort_u32_pk then
				keys:add(p)
			else
				offs[n] = buf_used
				pk_buf:putcdata(p, p_sz)
				buf_used = buf_used + p_sz
			end
		end
		input:close()
		if sort_u32_pk then
			keys:sort()
			order = nil
		else
			buf, buf_used = pk_buf:ref()
			order = {}
			for j = 1, n do order[j] = j end
			sort(order, function(a, b)
				local sa = (a < n and offs[a + 1] or buf_used) - offs[a]
				local sb = (b < n and offs[b + 1] or buf_used) - offs[b]
				return key_lt(buf + offs[a], sa, buf + offs[b], sb)
			end)
		end
		is_open = true
		idx = 0; has_pk = false; base_seeked = false
		prev_off = nil; prev_sz = nil
	end
	node.next_item = node.next_group  --one sorted pk per step; next_pk noop
	return node
end

--[[
pk_and_probe: filter a driver pk stream by testing each PK against
one or more index keys via MDBX_GET_BOTH_RANGE; all probes must
pass (ANDed). O(1) memory, one seek per probe per driver row. Probe
key is encoded once; a dedicated cursor is kept open per probe. All
probes test the same driver member (the table they index); driver
may carry other tuple members (chained joins) alongside it.
probe: {ix=index_name, keys={P1, P2, ...}} -- one param name per key col.
Usage: db:pk_and_probe(driver, probe, ...)
]]
Db.pk_and_probe = object(Db.query_node, {
	kind   = 'pk_and_probe',
	unique = false,
	source = 'probe',
	work   = 'driver scan + GET_BOTH per probe',
})
function Db.pk_and_probe:__call(db, driver, ...)
	check_pk_node(driver, 'pk_and_probe', 1)
	local nprobes = select('#', ...)
	assertf(nprobes >= 1, 'pk_and_probe: at least one probe required')
	local probes = {}
	for i = 1, nprobes do
		local p = (select(i, ...))
		assertf(type(p) == 'table' and p.ix and type(p.keys) == 'table',
			'pk_and_probe: probe %d: {ix=, keys={...}} expected', i)
		local ix_schema = resolve(db, p.ix)
		check_index(ix_schema, 'pk_and_probe', p.ix)
		probes[i] = {schema = ix_schema, keys = p.keys}
	end
	local member_name = probes[1].schema.val_schema.name
	assertf(driver_has_member(driver, member_name),
		'pk_and_probe: driver must have member %s', member_name)
	local node = object(self, {
		members = driver.members,
		order   = driver.order,
		unique  = driver.unique,
		item    = driver.item,
	})
	node.inputs = {driver}
	node.merge_cmp = driver.merge_cmp
	node.merge_sig = driver.merge_sig
	local probe_curs = {}
	local is_open
	local has_pk, cur_pk, cur_pk_sz
	function node:compile_col(m, c) return driver:compile_col(m, c) end
	function node:close()
		if is_open then
			driver:close()
			for i, c in ipairs(probe_curs) do c:close(); probe_curs[i] = nil end
			is_open = false
		end
	end
	function node:pk(name)
		if not has_pk then return end
		if name == member_name then return true, cur_pk, cur_pk_sz end
		return driver:pk(name)
	end
	function node:merge_key() return driver:merge_key() end
	--[[
	O(n * p * log m) total: n driver PKs, p probes, each probe test is
	one MDBX_GET_BOTH_RANGE (find_dup_ge_raw) which is O(log m) in the
	dup list for a DUPSORT index of m entries. This is optimal for
	in-memory intersection without materialising the probe sets.
	]]
	function node:next_group()
		has_pk = false
		if not probe_curs[1] then
			for i, p in ipairs(probes) do
				probe_curs[i] = db:cursor(p.schema.name)
			end
		end
		while true do
			if not driver:next_item() then return end
			local _, p, p_sz = driver:pk(member_name)
			local pass = true
			for i, probe in ipairs(probes) do
				local ok, v, v_sz = probe_curs[i]:find_dup_ge_raw(
					probe.key_buf, probe.key_sz, p, p_sz)
				if not ok or not key_eq(v, v_sz, p, p_sz) then
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
	function node:open(params)
		assert(not is_open, 'node already open')
		for i, probe in ipairs(probes) do
			local key_vals = {}
			for _, kn in ipairs(probe.keys) do
				key_vals[#key_vals+1] = params[kn]
			end
			local sz = encode_key(db, probe.schema, 'pk_and_probe', nil,
				mdbx_key_rec_buffer, MDBX_MAX_KEY_SIZE,
				probe.schema.key_cols, nil, unpack(key_vals))
			local buf = u8a(sz); copy(buf, mdbx_key_rec_buffer, sz)
			probe.key_buf = buf; probe.key_sz = sz
		end
		driver:open(params)
		is_open = true
		has_pk = false; cur_pk = nil; cur_pk_sz = nil
	end
	node.next_item = node.next_group  --one driver item per step; next_pk noop
	return node
end

--VALUE NODES ----------------------------------------------------------------

-- col_map: {member..':'..col -> alias} for compile_col on value nodes.
-- fn-based and synthetic (count, key) outputs have no member/col; omitted.
local function build_col_map(fields)
	local m = {}
	for _, f in ipairs(fields) do
		if f.member and f.col then m[f.member..':'..f.col] = f.name end
	end
	return m
end

local function parse_col_spec(s)
	--'member.col' or 'member.col alias'; returns {name=, member=, col=}
	s = s:match('^%s*(.-)%s*$')
	local spec, alias = s:match('^(%S+)%s+(%S+)$')
	if not spec then spec = s end
	local member, col = spec:match('^([^.]+)%.(.+)$')
	assertf(member and col,
		'select: output spec must be "member.col [alias]": %q', spec)
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
				assertf(type(o) == 'table' and isstr(o.name) and (type(o.fn) == 'function'
					or (isstr(o.member) and isstr(o.col))),
					'select: output %d: string, {name=, fn=}, or {name=, member=, col=} expected', i)
				parsed[#parsed+1] = o
			end
		end
	end
	assertf(#parsed >= 1, 'select: at least one output required')
	return parsed
end

-- value_filter: keep value records where fn(record, params) is true.
-- fn receives the value record and the params table. Input must be a value node.
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
	assert(type(fn) == 'function', 'value_filter: fn must be a function')
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
	})
	node.inputs = {input}
	local cur_params
	function node:row() return input:row() end
	function node:compile_col(m, c) return input:compile_col(m, c) end
	function node:close() input:close() end
	function node:next_group()
		while true do
			if not input:next_group() then return end
			if fn(input:row(), cur_params) then return true end
		end
	end
	function node:open(params) cur_params = params; input:open(params) end
	return node
end

--[[
select: decode a PK stream into value records; one record per input item.
outputs: 'member.col [alias], ...' or list with strings, {name=, fn=} tables.
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
	local parsed = parse_outputs(outputs)
	local node = object(self, {
		members = input.members,
		order   = input.order,
		unique  = input.unique,
	})
	node.inputs = {input}
	local col_map = build_col_map(parsed)
	local getters = {}
	local names = {}
	function node:row() return node._row end
	function node:compile_col(member, col)
		local name = col_map[member..':'..col]
		if name then return function() return node._row[name] end end
		-- Let later value nodes sort/filter by columns not selected by this node.
		return input:compile_col(member, col)
	end
	for i, o in ipairs(parsed) do
		local user_get = o.fn
		if user_get then
			getters[i] = function() return user_get(input) end
		else
			getters[i] = input:compile_col(o.member, o.col)
		end
		names[i] = o.name
	end
	local ngetters = #getters
	function node:close() input:close() end
	function node:next_group()
		if not input:next_item() then return end
		local rec = {}
		for i = 1, ngetters do rec[names[i]] = getters[i]() end
		node._row = rec
		return true
	end
	function node:open(params) input:open(params) end
	return node
end

--[[
stream_distinct: dedup adjacent value records by fields; input in group
order! fields: list of record field names. Compares field values directly
against a reused array instead of allocating a key table per row.
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
	assertf(type(fields) == 'table' and #fields >= 1,
		'stream_distinct: fields: non-empty list expected')
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
	function node:open(params)
		input:open(params)
		prev = {}; has_prev = false
	end
	return node
end

--[[
hash_distinct: dedup value records in any order by fields; O(n) memory.
fields: list of record field names. Values are read into a reused array
for hashing instead of allocating a key table per row.
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
	assertf(type(fields) == 'table' and #fields >= 1,
		'hash_distinct: fields: non-empty list expected')
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
			-- for 1-col keys use the value directly; tuples() for multi-col.
			-- int64key: a decoded int64/uint64 value doesn't hash correctly
			-- as a raw table/tuple key (see glue.lua int64key).
			local t
			if nfields == 1 then
				local v = rec[fields[1]]
				t = int64key(v ~= nil and v or null)
			else
				for i = 1, nfields do
					local v = rec[fields[i]]
					vals[i] = int64key(v ~= nil and v or null)
				end
				t = tuple_space(unpack(vals, 1, nfields))
			end
			if not seen[t] then seen[t] = true; return true end
		end
	end
	function node:open(params)
		input:open(params)
		tuple_space = tuples(); seen = {}
	end
	return node
end

--[[
value_sort: materialise and sort by field values; accepts PK or
value input. For value input: collects rows, sorts, serves via
next_group()/:row(). For PK input (single-member only): collects
pks + decoded sort values, sorts by those values, serves as a PK
node with compile_col via a fresh base cursor.
spec: 'field [asc|desc], ...' where field is a bare value-row key or
'member.col' resolved through compile_col; a list of pre-parsed
{member=, col=, desc=} / {field=, desc=} entries (same shape, no string
round-trip); or a comparator fn(a, b) (value input only).
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
		assertf(not is_pk,
			'value_sort: comparator function not supported for pk input')
	end
	assertf(not is_pk or isstr(spec) or istab(spec),
		'value_sort: arg 2: string or cols list expected for pk input')
	assertf(not is_pk or #input.members == 1,
		'value_sort: pk input must be single-member')

	-- parse spec into parts; for pk input extract member+col for compile_col
	local parts, sort_order
	if type(spec) ~= 'function' then
		assertf(isstr(spec) or istab(spec),
			'value_sort: arg 2: string, cols list, or comparator function expected')
		parts = {}
		local default_member = is_pk and input.members[1] or nil
		if isstr(spec) then
			for s in spec:gmatch('[^,]+') do
				s = s:match('^%s*(.-)%s*$')
				local field, dir = s:match('^(%S+)%s+(%S+)$')
				if not field then field = s end
				dir = dir or 'asc'
				assertf(dir == 'asc' or dir == 'desc',
					'value_sort: invalid direction %q in %q', dir, spec)
				local member, col = field:match('^([^.]+)%.(.+)$')
				local sort_member = member or default_member
				parts[#parts+1] = {
					field = field,
					member = sort_member,
					col = col or field,
					desc = dir=='desc',
				}
			end
			assertf(#parts >= 1, 'value_sort: empty spec')
		else
			assertf(#spec >= 1, 'value_sort: empty spec')
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
		end
		sort_order = {}
		for i, p in ipairs(parts) do
			sort_order[i] = {member = p.member, col = p.col, dir = p.desc and 'desc' or 'asc'}
		end
	end

	-- null-aware comparator over a parallel vals array {a_vals, b_vals}
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
		-- PK path: output is still a PK node; compile_col serves via fresh cursor.
		local member_name = input.members[1]
		local schema = resolve(db, member_name)
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
		function node:open(params)
			assert(not is_open, 'node already open')
			input:open(params)
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
		-- value path: collect rows, sort, serve via next_group()/:row().
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
		function node:open(params)
			input:open(params)
			recs = {}
			if type(spec) == 'function' then
				while input:next_group() do recs[#recs+1] = input:row() end
			else
				local getters = {}
				for i, p in ipairs(parts) do
					if p.member then
						getters[i] = assertf(input:compile_col(p.member, p.col),
							'value_sort: field not available: %s', p.field)
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

local function agg_init(agg)
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

local function agg_finalize(agg, acc)
	local rec = {}
	for _, a in ipairs(agg) do
		if a.op == 'avg' then
			local s = acc[a.name]
			rec[a.name] = s.n > 0 and s.sum / s.n or nil
		elseif a.op == 'concat' then
			local t = acc[a.name]
			rec[a.name] = #t > 0 and concat(t, a.sep or ',') or nil
		else
			rec[a.name] = acc[a.name]
		end
	end
	return rec
end

local function agg_step(acc, a, key, v)
	local name = a.name
	if a.op == 'count' then
		acc[name] = acc[name] + 1
	elseif a.op == 'key' then
		acc[name] = key and key[a.part]
	elseif v ~= nil and v ~= null then
		if a.op == 'sum' then
			acc[name] = (acc[name] or 0) + v
		elseif a.op == 'avg' then
			acc[name].sum = acc[name].sum + v
			acc[name].n   = acc[name].n   + 1
		elseif a.op == 'min' then
			if acc[name] == nil or v < acc[name] then acc[name] = v end
		elseif a.op == 'max' then
			if acc[name] == nil or v > acc[name] then acc[name] = v end
		elseif a.op == 'concat' then
			acc[name][#acc[name]+1] = tostring(v)
		end
	end
end

--[[
stream_aggregate: one value record per group from a PK stream; needs order.
cols: list of {member=, col=}, group key at PK level; nil = grand total.
Getters compiled once at open(); the key table is built once per group
(not per row -- grouping itself, via next_pk, needs no key comparison here).
agg: list of {name=, op=, [member=, col=, sep=, part=]}.
ops: count, sum, avg, min, max,
	concat (skip null/absent),
	key (from cols part index).
Usage: db:stream_aggregate(input, cols, agg)
]]
Db.stream_aggregate = object(Db.query_node, {
	kind   = 'stream_aggregate',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'aggregate PK stream into one value record per group',
})
function Db.stream_aggregate:__call(db, input, cols, agg)
	check_pk_node(input, 'stream_aggregate', 1)
	assertf(cols == nil or type(cols) == 'table',
		'stream_aggregate: arg 2: cols list or nil expected')
	assertf(type(agg) == 'table' and #agg >= 1,
		'stream_aggregate: arg 3: non-empty agg list expected')
	local fields = {}
	for _, a in ipairs(agg) do
		fields[#fields+1] = {name = a.name, member = a.member, col = a.col}
	end
	local node = object(self, {members = input.members, unique = true})
	node.inputs = {input}
	local col_map = build_col_map(fields)
	function node:row() return node._row end
	function node:compile_col(member, col)
		local name = col_map[member..':'..col]
		if name then return function() return node._row[name] end end
	end
	local done, getters
	local function accumulate(acc, key)
		for _, a in ipairs(agg) do
			local v
			if a.op ~= 'count' and a.op ~= 'key' then
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
	function node:open(params)
		input:open(params)
		if cols then
			getters = {}
			for i, c in ipairs(cols) do getters[i] = input:compile_col(c.member, c.col) end
		end
		done = false
	end
	return node
end

--[[
hash_aggregate: group and aggregate value records in any order; O(n groups).
fields: list of record field names, group key at value level; nil = grand
total. Values are read into reused arrays per row instead of allocating a
key table via a function call.
agg: list of {name=, op=, [input=, member=, col=, sep=, part=]}; input= is
the field name read for accumulation; member=/col= are optional and only
used by compile_col, so a later node (order_by, having) can still address
this output by its original source column, same as stream_aggregate.
ops: count, sum, avg, min, max, concat (skip null), key (fields part index).
Usage: db:hash_aggregate(input, fields, agg)
]]
Db.hash_aggregate = object(Db.query_node, {
	kind   = 'hash_aggregate',
	item   = 'value',
	unique = true,
	source = 'pass-through',
	work   = 'group and aggregate value records; any order; O(n groups) memory',
})
function Db.hash_aggregate:__call(db, input, fields, agg)
	check_value_node(input, 'hash_aggregate', 1)
	assertf(fields == nil or type(fields) == 'table',
		'hash_aggregate: arg 2: fields list or nil expected')
	assertf(type(agg) == 'table' and #agg >= 1,
		'hash_aggregate: arg 3: non-empty agg list expected')
	local outfields = {}
	for _, a in ipairs(agg) do
		outfields[#outfields+1] = {name = a.name, member = a.member, col = a.col}
	end
	local node = object(self, {members = input.members, unique = true})
	node.inputs = {input}
	local col_map = build_col_map(outfields)
	function node:compile_col(member, col)
		local name = col_map[member..':'..col]
		if name then return function() return node._row[name] end end
	end
	local output, idx
	local function accumulate(acc, rec, key)
		for _, a in ipairs(agg) do
			local v
			if a.op ~= 'count' and a.op ~= 'key' then
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
	function node:open(params)
		input:open(params)
		local group_list = {}
		local group_map  = {}
		local nfields = fields and #fields or 0
		local tuple_space = fields and tuples() or nil
		-- key/vals reused across rows: agg_step's 'key' op reads key[part]
		-- synchronously during accumulate(), so overwriting them next row
		-- is safe; vals only feeds tuple_space(unpack(...)), which reads
		-- the unpacked scalars immediately, not the table itself.
		local key = fields and {} or nil
		local vals = fields and {} or nil
		while input:next_group() do
			local rec = input:row()
			local t
			if fields then
				for i = 1, nfields do
					local v = rec[fields[i]]; if v == nil then v = null end
					-- int64key: a decoded int64/uint64 value doesn't hash
					-- correctly as a raw tuple key (see glue.lua int64key).
					key[i] = v; vals[i] = int64key(v)
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

-- value_concat: concatenate value streams in argument order.
-- better name is union_all but that name is used for combinng query objects!
-- All inputs must have the same fields. Usage: db:value_concat(input, ...)
Db.value_concat = object(Db.query_node, {
	kind   = 'value_concat',
	item   = 'value',
	unique = false,
	source = 'pass-through',
	work   = 'concatenate value streams in argument order',
})
function Db.value_concat:__call(db, ...)
	local n = select('#', ...)
	assertf(n >= 2, 'value_concat: need at least 2 inputs, got %d', n)
	local inputs = {}
	for j = 1, n do
		local inp = (select(j, ...))
		check_value_node(inp, 'value_concat', j)
		inputs[j] = inp
	end
	local node = object(self, {members = inputs[1].members})
	node.inputs = inputs
	local cur_i, i
	function node:row() return inputs[cur_i]:row() end
	function node:compile_col(member, col)
		local cls = {}
		for j = 1, n do cls[j] = inputs[j]:compile_col(member, col) end
		return function() return cls[cur_i] and cls[cur_i]() end
	end
	function node:close() for j = 1, n do inputs[j]:close() end end
	function node:next_group()
		while i <= n do
			if inputs[i]:next_group() then
				cur_i = i
				return true
			end
			i = i + 1
		end
	end
	function node:open(params)
		for j = 1, n do inputs[j]:open(params) end
		cur_i = 1; i = 1
	end
	return node
end

--union_distinct: combine value streams; yield unique records (first-seen).
--All inputs must have the same fields. Usage: db:union_distinct(input, ...)
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
	for j = 1, n do
		local inp = (select(j, ...))
		check_value_node(inp, 'union_distinct', j)
		inputs[j] = inp
	end
	local node = object(self, {members = inputs[1].members, unique = true})
	node.inputs = inputs
	local cur_i, seen, tuple_space, key_list, i
	function node:row() return inputs[cur_i]:row() end
	function node:compile_col(member, col)
		local cls = {}
		for j = 1, n do cls[j] = inputs[j]:compile_col(member, col) end
		return function() return cls[cur_i] and cls[cur_i]() end
	end
	function node:close() for j = 1, n do inputs[j]:close() end end
	-- key list from first row; sorted for deterministic tuple encoding.
	function node:next_group()
		while i <= n do
			if inputs[i]:next_group() then
				cur_i = i
				local rec = inputs[i]:row()
				if not key_list then
					key_list = keys(rec, true)
				end
				-- int64key: a decoded int64/uint64 value doesn't hash correctly
				-- as a raw tuple key (see glue.lua int64key).
				local vals = {}
				for _, k in ipairs(key_list) do vals[#vals+1] = int64key(rec[k]) end
				local t = tuple_space(unpack(vals))
				if not seen[t] then seen[t] = true; return true end
			else
				i = i + 1
			end
		end
	end
	function node:open(params)
		for j = 1, n do inputs[j]:open(params) end
		cur_i = 1; seen = {}; tuple_space = tuples(); key_list = nil; i = 1
	end
	return node
end
