--[[

	db.left(name|cur)    -> optional arg marker for db:each_join
	db:each_join         (name|cur, ..., db.left(name|cur), ...) -> iter() -> cur1, cur2|nil, ...
	db:each_and          (ix_name, key_vals..., ix_name, key_vals...) -> iter() -> cur
	db:each_or           (ix_name, key_vals..., ix_name, key_vals...) -> iter() -> cur
	db:each_prefix       (name|dbi, [val_cols], pk_val1, ...) -> iter() -> cur, keysvals...
	db:each_dup          (ix_name|ix_dbi, [val_cols], keys...) -> iter() -> cur, keysvals...
	cur:[try_]find_prefix ([val_cols], pk_val1, ...) -> keysvals...
	cur:each_prefix      ([val_cols], pk_val1, ...) -> iter() -> cur, keysvals...
	cur:each_dup         ([val_cols], keys...) -> iter() -> cur, keysvals...

	replaced by db:table_scanner: a prefix scan is a '^'/starts path term,
	an exact-key dup scan is an all-'=' path on the index.

]]

--DML / MERGE JOIN -----------------------------------------------------------

function Db.left(x) return {left = x} end

--[[
Merge join across N tables or indexes on their key space. O(n+m+...).

Required args (table name, index name, or pre-positioned cursor): all must be
present at every yielded key (inner join semantics). Stops when any required
cursor exhausts.

Optional args (wrapped with db.left(...)): matched against the current key
and yielded as nil when absent (left join semantics). An exhausted optional
does not stop iteration.

First arg must be required (not db.left). String args open cursors from their
first key; cursor args use their current position (caller must seek first).
DUPSORT index cursors advance with MDBX_NEXT_NODUP so composing
each_dup_current inside the loop is safe.
]]
function Db:each_join(...)
	local n = select('#', ...)
	assertf(n >= 2, 'each_join: at least 2 args required, got %d', n)
	local cursors = {}
	local owned = {}
	local required = {}
	local all_required = true
	for i = 1, n do
		local a = select(i, ...)
		required[i] = true
		if istab(a) then
			a = assert(a.left)
			all_required = false
			required[i] = false
		end
		if isstr(a) then
			cursors[i] = self:cursor(a)
			owned[i] = true
		elseif is_mdbx_cursor(a) then
			cursors[i] = a
		else
			assertf(false, 'each_join: arg %d: table name or cursor expected, got %s', i, typeof(a))
		end
	end
	assertf(required[1], 'each_join: first arg must not be db.left (needs a driving cursor)')
	local schema = cursors[1].schema
	for i = 2, n do
		assertf(schema.key_sig == cursors[i].schema.key_sig,
			'each_join: incompatible key schemas:\n  %s\n  %s', schema.key_sig, cursors[i].schema.key_sig)
	end
	local function close_owned()
		for i = 1, n do
			if owned[i] then cursors[i]:close(); owned[i] = false end
		end
	end
	local keys = {}
	local k_szs = {}
	local exhausted = {}
	for i = 1, n do
		local ok, k, k_sz
		if owned[i] then
			ok, k, k_sz = cursors[i]:first_raw()
		else
			ok, k, k_sz = cursors[i]:current_raw()
		end
		if not ok then
			if required[i] then close_owned(); return noop end
			if owned[i] then cursors[i]:close(); owned[i] = false end
			exhausted[i] = true
		else
			keys[i] = k; k_szs[i] = k_sz
		end
	end
	local key_gt = schema.key_gt
	local key_eq = schema.key_eq
	local matched = {}
	for i = 1, n do matched[i] = required[i] end  --required always matched; optionals updated in loop
	local ret = {}
	local yielded = false
	return function()
		if yielded then
			--advance required cursors and optional cursors that matched last yield
			for i = 1, n do
				if required[i] or matched[i] then
					local ok, k, k_sz = cursors[i]:move_raw(C.MDBX_NEXT_NODUP)
					if not ok then
						if required[i] then close_owned(); return end
						if owned[i] then cursors[i]:close(); owned[i] = false end
						exhausted[i] = true
					else
						keys[i] = k; k_szs[i] = k_sz
					end
				end
				--optional unmatched: leave in place, already ahead of current key
			end
		end
		yielded = true
		--convergence: find max required key, seek lagging required cursors to it.
		--converges because every round advances at least one required cursor forward.
		while true do
			local max_i = 1  --cursors[1] is always required (asserted in setup)
			for i = 2, n do
				if required[i] and key_gt(keys[i], k_szs[i], keys[max_i], k_szs[max_i]) then
					max_i = i
				end
			end
			local all_eq = true
			for i = 1, n do
				if required[i] and not key_eq(keys[i], k_szs[i], keys[max_i], k_szs[max_i]) then
					all_eq = false
					local ok, k, k_sz = cursors[i]:find_ge_raw(keys[max_i], k_szs[max_i])
					if not ok then close_owned(); return end
					keys[i] = k; k_szs[i] = k_sz
				end
			end
			if all_eq then
				if all_required then return unpack(cursors, 1, n) end
				--align optional cursors to current required key
				for i = 1, n do
					if not required[i] and not exhausted[i] then
						if key_gt(keys[max_i], k_szs[max_i], keys[i], k_szs[i]) then
							local ok, k, k_sz = cursors[i]:find_ge_raw(keys[max_i], k_szs[max_i])
							if not ok then
								if owned[i] then cursors[i]:close(); owned[i] = false end
								exhausted[i] = true
								matched[i] = false
							else
								keys[i] = k; k_szs[i] = k_sz
								matched[i] = key_eq(keys[max_i], k_szs[max_i], keys[i], k_szs[i])
							end
						else
							matched[i] = key_eq(keys[max_i], k_szs[max_i], keys[i], k_szs[i])
						end
					elseif not required[i] then
						matched[i] = false
					end
				end
				for i = 1, n do
					ret[i] = (required[i] or matched[i]) and cursors[i] or nil
				end
				return unpack(ret, 1, n)
			end
		end
	end
end

--Setup shared by each_and and each_or: parse (ix_name, key_vals...)
--groups, position each cursor at its key, return everything needed by the
--iterator. Cursors for keys with no entries are immediately closed and marked
--exhausted (callers decide what that means: intersect = empty, union = skip).
--find_raw (MDBX_SET_KEY) positions at the key and returns its first dup as v;
--no separate MDBX_FIRST_DUP step needed.
local function dup_index_setup(self, caller, ...)
	local n = 0
	local cursors = {}
	local ix_keys = {} --encoded key strings, stable pointers for find_dup_ge_raw
	local vals = {}
	local val_szs = {}
	local exhausted = {}
	local n_active = 0
	local first_val_table
	local i = 1
	local n_args = select('#', ...)
	while i <= n_args do
		local ix_name = select(i, ...)
		assertf(isstr(ix_name) and ix_name:has'/',
			'%s: index name expected at arg %d', caller, i)
		i = i + 1
		n = n + 1
		local dbi, ix_schema = self:dbi_schema(ix_name)
		assertf(ix_schema.is_index, '%s: not an index: %s', caller, ix_name)
		local val_table = ix_schema.val_table
		if n == 1 then first_val_table = val_table
		else assertf(val_table == first_val_table,
			'%s: index %s is on %s, expected %s', caller, ix_name, val_table, first_val_table)
		end
		local n_key_cols = #ix_schema.key_fields
		local xk, xk_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
		local xk_sz = encode_key(self, ix_schema, caller, nil,
			xk, xk_buf_sz, ix_schema.key_cols, nil, select(i, ...))
		i = i + n_key_cols
		local cur = self:cursor_raw(dbi)
		cur.schema = ix_schema
		local ok, v, v_sz = cur:find_raw(xk, xk_sz)
		if ok then
			cursors[n] = cur
			ix_keys[n] = str(xk, xk_sz)
			vals[n] = v; val_szs[n] = v_sz
			n_active = n_active + 1
		else
			cur:close() --no entries for this key; already closed
			exhausted[n] = true
		end
	end
	assertf(n >= 2, '%s: at least 2 indexes required, got %d', caller, n)
	--find key comparators from any active cursor (all share the same val_schema).
	local key_gt, key_eq
	for i = 1, n do
		if cursors[i] then
			local vs = cursors[i].schema.val_schema
			key_gt, key_eq = vs.key_gt, vs.key_eq
			break
		end
	end
	local function close_all()
		for i = 1, n do if cursors[i] then cursors[i]:close() end end
	end
	return n, cursors, ix_keys, vals, val_szs, key_gt, key_eq, close_all, n_active, exhausted
end

--[[
Index intersection (AND): yields base-table records matching ALL N conditions.
Each base-table PK is yielded only when it appears in every dup list.
O(k1+k2+...) where ki = dup count at the given key. All indexes must be on the
same base table.

Args: (index_name1, k1,..., index_name2, k1,..., ...)

Yields one cursor per matching PK; call cur:current(val_cols) to decode.
]]
function Db:each_and(...)
	local n, cursors, ix_keys, vals, val_szs, key_gt, key_eq, close_all, n_active =
		dup_index_setup(self, 'each_and', ...)
	if n_active < n then close_all(); return noop end --empty key = empty intersection
	local yielded = false
	return function()
		if yielded then
			for i = 1, n do
				local ok, _, _, v, v_sz = cursors[i]:move_raw(C.MDBX_NEXT_DUP)
				if not ok then close_all(); return end
				vals[i] = v; val_szs[i] = v_sz
			end
		end
		yielded = true
		--seek all lagging cursors to the max PK; loop because a seek may overshoot.
		while true do
			local max_i = 1
			for i = 2, n do
				if key_gt(vals[i], val_szs[i], vals[max_i], val_szs[max_i]) then max_i = i end
			end
			local all_eq = true
			for i = 1, n do
				if not key_eq(vals[i], val_szs[i], vals[max_i], val_szs[max_i]) then
					all_eq = false
					local ok, v, v_sz = cursors[i]:find_dup_ge_raw(
						ix_keys[i], #ix_keys[i], vals[max_i], val_szs[max_i])
					if not ok then close_all(); return end
					vals[i] = v; val_szs[i] = v_sz
				end
			end
			if all_eq then return cursors[1] end
		end
	end
end

--[[
Index union (OR): yields base-table records matching ANY of N conditions.
Each base-table PK is yielded at most once (deduplicated via sorted merge).
O(k1+k2+...). All indexes must be on the same base table.

Args: same alternating format as each_and.

Yields one cursor per unique PK; call cur:current(val_cols) to decode.
]]
function Db:each_or(...)
	local n, cursors, ix_keys, vals, val_szs, key_gt, key_eq, close_all, n_active, exhausted =
		dup_index_setup(self, 'each_or', ...)
	if n_active == 0 then return noop end --all keys empty
	local to_advance = {} --cursors at the last yielded PK; advanced at next call
	return function()
		--advance cursors that were at the last yielded PK
		for i = 1, n do
			if to_advance[i] then
				to_advance[i] = false
				local ok, _, _, v, v_sz = cursors[i]:move_raw(C.MDBX_NEXT_DUP)
				if ok then vals[i] = v; val_szs[i] = v_sz
				else exhausted[i] = true; n_active = n_active - 1 end
			end
		end
		if n_active == 0 then close_all(); return end
		--find the minimum PK among active cursors
		local min_i
		for i = 1, n do
			if not exhausted[i] then
				if not min_i or key_gt(vals[min_i], val_szs[min_i], vals[i], val_szs[i]) then
					min_i = i
				end
			end
		end
		--mark all cursors at min for advancing next call (deduplication)
		for i = 1, n do
			if not exhausted[i] and key_eq(vals[i], val_szs[i], vals[min_i], val_szs[min_i]) then
				to_advance[i] = true
			end
		end
		return cursors[min_i]
	end
end

--PREFIX / DUP SCANS -----------------------------------------------------------

function Cur:try_find_prefix(val_cols, ...)
	local schema = assert(self.schema)
	local n = select('#', ...)
	assert(n >= 1 and n <= #schema.key_fields)
	local k, k_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local k_sz = encode_key_prefix(self.db, schema, 'c_seek',
		k, k_buf_sz, n, false, ...)
	local ok, k2, k2_sz, v, v_sz = self:find_ge_raw(k, k_sz)
	if not ok or k2_sz < k_sz or memcmp(k2, k, k_sz) ~= 0 then
		return false, 'not_found'
	end
	return true, decode_kv(self.db, schema, k2, k2_sz, v, v_sz, val_cols)
end
function Cur:find_prefix(...)
	return skip_ok(self:try_find_prefix(...))
end
local function prefix_next(self, ctrl)
	local ok, k, k_sz, v, v_sz
	if ctrl == nil then
		ok, k, k_sz, v, v_sz = self:current_raw()
	else
		ok, k, k_sz, v, v_sz = self:next_raw()
	end
	local psz = self.prefix_sz
	if not ok or k_sz < psz or memcmp(k, self.prefix_str, psz) ~= 0 then
		self.prefix_str = nil; self.prefix_sz = nil
		if self.prefix_close then self.prefix_close = nil; self:close() end
		return
	end
	return self, decode_kv(self.db, self.schema, k, k_sz, v, v_sz, self.val_cols)
end
local function prefix_seek(self, schema, val_cols, n, ...)
	local k, k_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local k_sz = encode_key_prefix(self.db, schema, 'c_seek',
		k, k_buf_sz, n, false, ...)
	if not self:find_ge_raw(k, k_sz) then return false end
	self.prefix_str = str(k, k_sz)
	self.prefix_sz = k_sz
	self.val_cols = val_cols
	return true
end
function Cur:each_prefix(val_cols, ...)
	local schema = assert(self.schema)
	local n = select('#', ...)
	assert(n >= 1 and n <= #schema.key_fields)
	if not prefix_seek(self, schema, val_cols, n, ...) then return noop end
	return prefix_next, self
end
function Db:each_prefix(tbl_name, val_cols, ...)
	local cur = self:cursor(tbl_name)
	local schema = assert(cur.schema)
	local n = select('#', ...)
	assert(n >= 1 and n <= #schema.key_fields)
	if not prefix_seek(cur, schema, val_cols, n, ...) then
		cur:close(); return noop
	end
	cur.prefix_close = true
	return prefix_next, cur
end

--uses each_dup_from(), still defined in mdbx_schema.lua for each_current_dup.
local function each_dup(db, cur, ix_schema, val_cols, close_cur, ...)
	assert(ix_schema.is_index)
	local xk, xk_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local xk_sz = encode_key(db, ix_schema, 'each_dup', nil,
		xk, xk_buf_sz, ix_schema.key_cols, nil, ...)
	return each_dup_from(db, cur, ix_schema, val_cols, close_cur, xk, xk_sz)
end
function Cur:each_dup(val_cols, ...)
	return each_dup(self.db, self, assert(self.schema), val_cols, false, ...)
end
function Db:each_dup(ix_name, val_cols, ...)
	local dbi, ix_schema = self:dbi_schema(ix_name)
	return each_dup(self, self:cursor_raw(dbi), ix_schema, val_cols, true, ...)
end
