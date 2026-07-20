--[[

	indexed scans over one mdbx_schema table.
	Written by Cosmin Apreutesei. Public Domain.

API
	db:scan(table, path) -> scan
	scan.reset(params...)
	scan.next() -> true | nil
	scan.next_key() -> true | nil
	scan.compile_col(col) -> get() -> value
	scan.explain() -> table
	scan.close()
	scan.in_('col', values) -> iter
	scan.not_in('col', values) -> iter

	`in_()` removes duplicate values and concatenates scans in list order. It
	reports no order. Its reset() omits the selected equality argument.
	`not_in()` preserves scan order. Its next_key() tests only the row that
	scan.next_key() returns. `null` in the list excludes a DB null value.

	path = 'eq_col, range_col [,) asc, order_col asc'

	The scanner assigns equality arguments to bare leading fields and lower and
	upper arguments to `[,)`; `[` or `]` includes that bound. Pass nil for an
	absent range bound. `^` takes one string-prefix argument. The scanner uses
	directions to select a key and cursor direction; it does not sort. An empty
	path scans the table PK forward.

]]

if not ... then require'mdbx_scan_test'; return end

require'mdbx_schema'

local C = C
local Db = mdbx_db
local encode_key_prefix = mdbx_encode_key_prefix
local min, memcmp = min, memcmp

--DECLARATION ----------------------------------------------------------------

-- construct a one-table scan iterator.
function Db:scan(table_name, path)
	local db = self
	local scan = {}

	--PATH --------------------------------------------------------------------
	local base_schema = assertf(db:table_schema(table_name),
		'scan: no schema: %s', table_name)
	assert(not base_schema.is_index,
		'scan: base table')

	-- parse the access path that one key must cover.
	local eq, eq_n = {}, 0
	local bound
	local nparams = 0
	local terms = {}
	-- protect the range comma before splitting path terms.
	path = path:gsub('([%[(])%s*,%s*([%])])', '%1;%2')
	for part in path:gmatch'[^,]+' do
		local col, suffix = part:match'^%s*([%a_][%w_]*)%s*(.-)%s*$'
		assertf(col, 'scan: path: %s', part)
		local dir
		if suffix == 'asc' or suffix == 'desc' then
			dir, suffix = suffix, ''
		else
			local body, word = suffix:match'^(.-)%s+(%a+)$'
			if word then
				assertf(word == 'asc' or word == 'desc',
					'scan: bad dir: %s', word)
				suffix, dir = body, word
			end
		end
		local open, close = suffix:match'^([%[(]);([%])])$'
		local starts = suffix == '^'
		assert(suffix == '' or starts or open, 'scan: path')
		local term = {col = col, dir = dir}
		assertf(base_schema.fields[col], 'scan: bad field: %s', col)
		terms[#terms + 1] = term
		local i = #terms
		if open then
			-- assign lower and upper argument positions in path order.
			nparams = nparams + 1
			term[open == '[' and 'ge' or 'gt'] = nparams
			nparams = nparams + 1
			term[close == ']' and 'le' or 'lt'] = nparams
		elseif starts then
			nparams = nparams + 1
			term.starts = nparams
		end
		if suffix == '' and not dir then
			-- assign one equality argument to each bare leading field.
			assert(i == eq_n + 1 and not bound, 'scan: eq first')
			nparams = nparams + 1
			eq[col] = nparams
			eq_n = eq_n + 1
		elseif open or starts then
			-- one bound must follow the equality prefix directly.
			assert(i == eq_n + 1 and not bound,
				'scan: bound first')
			if starts then
				local f = base_schema.fields[col]
				-- partial encoding requires an unpadded variable field.
				assertf(f.maxlen and not f.padded,
					'scan: starts field: %s', col)
			end
			bound = term
		end
	end
	path = terms

	--KEY SELECTION -----------------------------------------------------------

	-- return fields and direction when this key matches the complete path.
	local function select_key(schema)
		local fields = {}
		for _, f in ipairs(schema.key_fields) do
			fields[#fields + 1] = f
		end
		if schema.is_index then
			for _, f in ipairs(base_schema.key_fields) do
				if not schema.fields[f.col] then
					fields[#fields + 1] = f
				end
			end
		end
		local backwards
		for i, term in ipairs(path) do
			local f = fields[i]
			if not f or f.col ~= term.col then return end
			if term.dir then
				local is_backwards = not not f.descending
					~= (term.dir == 'desc')
				if backwards == nil then
					backwards = is_backwards
				elseif backwards ~= is_backwards then
					return
				end
			end
		end
		return fields, backwards or false
	end

	local key_schema, key_fields, reverse

	-- scan table and indexes in declaration order.
	for i = 0, #(base_schema.indexes or empty) do
		local schema = i == 0 and base_schema or base_schema.indexes[i]
		key_fields, reverse = select_key(schema)
		if key_fields then key_schema = schema; break end
	end

	if not key_schema then
		local needed = {}
		for i, term in ipairs(path) do
			needed[i] = term.col..(term.dir and ' '..term.dir or '')
		end
		assertf(false, 'scan: no key: %s', cat(needed, ', '))
	end
	local key_depth = min(eq_n, #key_schema.key_fields)
	local pk_depth = 0
	if key_schema.is_index and key_depth == #key_schema.key_fields then
		for _, f in ipairs(base_schema.key_fields) do
			if not eq[f.col] then break end
			pk_depth = pk_depth + 1
		end
	end
	local varying_field = bound and key_fields[eq_n + 1] or nil
	local varying_part = bound and
		(eq_n < #key_schema.key_fields and 'key' or 'pk') or nil
	local is_index = key_schema.is_index or false
	local pk_suffix = is_index
		and (pk_depth > 0 or varying_part == 'pk') or false

	--BOUND ORDER -------------------------------------------------------------

	local starts_param = bound and bound.starts
	local starts = starts_param ~= nil
	local range = bound and not starts
	local start_op, start_param, stop_op, stop_param
	if range then
		local f = varying_field
		-- convert logical bounds to the byte order of this key field.
		if f.descending then
			start_op = bound.lt and 'gt' or bound.le and 'ge' or nil
			start_param = bound.lt or bound.le
			stop_op = bound.gt and 'lt' or bound.ge and 'le' or nil
			stop_param = bound.gt or bound.ge
		else
			start_op = bound.gt and 'gt' or bound.ge and 'ge' or nil
			start_param = bound.gt or bound.ge
			stop_op = bound.lt and 'lt' or bound.le and 'le' or nil
			stop_param = bound.lt or bound.le
		end
	end

	--CURSORS -----------------------------------------------------------------

	local key_rec = MDBX_val()
	local pk_rec = is_index and MDBX_val() or key_rec
	local val_rec = MDBX_val()
	local cur, base_cur, base_seeked

	-- open the cursor as needed and update its current key and PK records.
	local function scan_move(op)
		if cur and cur:closed() then cur = nil end
		if not cur then cur = db:cursor(key_schema.name) end
		local val = is_index and pk_rec or val_rec
		return cur:move_raw_into(op, key_rec, val)
	end

	-- return the base record for a compiled value-field reader.
	local function base_value()
		if not is_index then return val_rec.data, val_rec.size end
		if not base_seeked then
			if base_cur and base_cur:closed() then base_cur = nil end
			if not base_cur then
				base_cur = db:cursor(base_schema.name)
			end
			local ok = base_cur:move_raw_into(C.MDBX_SET_KEY, pk_rec,
				val_rec)
			assert(ok, 'scan: missing PK')
			base_seeked = true
		end
		return val_rec.data, val_rec.size
	end

	-- compile one reader against the iterator's current records.
	local function compile_col(col)
		assertf(base_schema.fields[col],
			'scan: bad field: %s', col)
		return db:compile_col(key_schema, col,
			is_index and key_rec or nil, pk_rec, base_value)
	end

	scan.compile_col = compile_col

	--BOUNDS ------------------------------------------------------------------

	-- compare two encoded key prefixes in MDBX byte order.
	local function key_cmp(a, an, b, bn)
		local c = memcmp(a, b, min(an, bn))
		if c ~= 0 then return c end
		if an < bn then return -1 end
		if an > bn then return 1 end
		return 0
	end

	-- compute the exclusive end of each string that starts with prefix.
	local function increment_prefix(prefix, n)
		local i = n - 1
		while i >= 0 and prefix[i] == 255 do i = i - 1 end
		if i < 0 then return nil end
		prefix[i] = prefix[i] + 1
		return i + 1
	end

	local bound_schema = pk_suffix and base_schema or key_schema
	local bound_depth = pk_suffix and pk_depth or key_depth
	local bound_rec = pk_suffix and pk_rec or key_rec
	local pk_fixedsize = pk_suffix and key_schema.dup_fixedsize or nil

	local start = u8a(MDBX_MAX_KEY_SIZE)
	local stop = u8a(MDBX_MAX_KEY_SIZE)
	local bound_values = {}
	local start_n, stop_n, empty_scan, started
	local index_key = pk_suffix and u8a(MDBX_MAX_KEY_SIZE) or nil
	local index_key_n

	-- encode the first n bound fields into one persistent buffer.
	local function encode_values(out, n, partial)
		return encode_key_prefix(db, bound_schema, 'scan', out,
			MDBX_MAX_KEY_SIZE, n, partial or false,
			unpack(bound_values, 1, n))
	end

	-- bind parameters and compute the inclusive start and exclusive stop.
	local function reset(...)
		assert(select('#', ...) == nparams, 'scan: params')
		if pk_suffix then
			for i = 1, key_depth do
				bound_values[i] = select(i, ...)
			end
			index_key_n = encode_key_prefix(db, key_schema, 'scan',
				index_key, MDBX_MAX_KEY_SIZE, key_depth, false,
				unpack(bound_values, 1, key_depth))
			for i = 1, bound_depth do
				local col = bound_schema.key_fields[i].col
				bound_values[i] = select(eq[col], ...)
			end
		else
			for i = 1, bound_depth do
				bound_values[i] = select(i, ...)
			end
		end
		start_n = nil
		stop_n = nil
		empty_scan = false
		if starts then
			local value = select(starts_param, ...)
			-- starts has no meaning for DB NULL.
			assert(value ~= nil and value ~= null, 'scan: starts')
			bound_values[bound_depth + 1] = value
			start_n = encode_values(start, bound_depth + 1, true)
			copy(stop, start, start_n)
			stop_n = increment_prefix(stop, start_n)
		else
			local start_is_prefix
			local value = start_op and select(start_param, ...)
			if start_op and value ~= nil then
				bound_values[bound_depth + 1] = value
				start_n = encode_values(start, bound_depth + 1)
				if start_op == 'gt' then
					start_n = increment_prefix(start, start_n)
					if not start_n then empty_scan = true end
				end
			elseif bound_depth > 0 then
				start_n = encode_values(start, bound_depth)
				start_is_prefix = true
			end

			value = stop_op and select(stop_param, ...)
			if stop_op and value ~= nil then
				bound_values[bound_depth + 1] = value
				stop_n = encode_values(stop, bound_depth + 1)
				if stop_op == 'le' then
					stop_n = increment_prefix(stop, stop_n)
				end
			elseif bound_depth > 0 then
				if start_is_prefix then
					copy(stop, start, start_n)
					stop_n = start_n
				else
					stop_n = encode_values(stop, bound_depth)
				end
				stop_n = increment_prefix(stop, stop_n)
			end
		end
		-- pad each PK bound because MDBX requires full DUPFIXED values.
		if pk_fixedsize then
			if start_n and start_n < pk_fixedsize then
				fill(start + start_n, pk_fixedsize - start_n)
				start_n = pk_fixedsize
			end
			if stop_n and stop_n < pk_fixedsize then
				fill(stop + stop_n, pk_fixedsize - stop_n)
				stop_n = pk_fixedsize
			end
		end
		if start_n and stop_n
			and key_cmp(start, start_n, stop, stop_n) >= 0
		then
			empty_scan = true
		end
		started = false
		base_seeked = false
	end

	scan.reset = reset

	--ITERATION ---------------------------------------------------------------
	local dup_op = reverse and C.MDBX_PREV_DUP or C.MDBX_NEXT_DUP
	local nodup_op = reverse and C.MDBX_PREV_NODUP or C.MDBX_NEXT_NODUP

	-- position at the first key record in the requested cursor direction.
	local function first_key_record()
		if empty_scan then return false end
		if not reverse then
			if start_n then
				key_rec.data = start
				key_rec.size = start_n
				return scan_move(C.MDBX_SET_RANGE)
			end
			return scan_move(C.MDBX_FIRST)
		end
		if not stop_n then return scan_move(C.MDBX_LAST) end
		key_rec.data = stop
		key_rec.size = stop_n
		if scan_move(C.MDBX_SET_RANGE) then
			return scan_move(C.MDBX_PREV)
		end
		return scan_move(C.MDBX_LAST)
	end

	-- position at the first matching PK under one exact index key.
	local function first_pk_record()
		if empty_scan then return false end
		key_rec.data = index_key
		key_rec.size = index_key_n
		if not reverse then
			if start_n then
				pk_rec.data = start
				pk_rec.size = start_n
				return scan_move(C.MDBX_GET_BOTH_RANGE)
			end
			return scan_move(C.MDBX_SET_KEY)
		end
		if stop_n then
			pk_rec.data = stop
			pk_rec.size = stop_n
			return scan_move(
				C.MDBX_TO_EXACT_KEY_VALUE_LESSER_THAN)
		end
		if not scan_move(C.MDBX_SET_KEY) then return false end
		return scan_move(C.MDBX_LAST_DUP)
	end

	-- select cursor operations once so every scan uses one iterator path.
	local first_record = pk_suffix and first_pk_record or first_key_record
	local next_record_op = is_index and dup_op or nodup_op
	local next_nodup_op = is_index and not pk_suffix and nodup_op or nil
	local next_key_op = not pk_suffix and nodup_op or nil

	-- accept the current cursor record when it is inside the remaining bound.
	local function accept_current_record(ok)
		if not ok then return end
		if reverse then
			if start_n and key_cmp(bound_rec.data, bound_rec.size,
				start, start_n) < 0
			then return end
		elseif stop_n and key_cmp(bound_rec.data, bound_rec.size,
			stop, stop_n) >= 0
		then
			return
		end
		base_seeked = false
		return true
	end

	-- advance to the next base-table record in the scan.
	local function next_record()
		local ok
		if not started then
			started = true
			ok = first_record()
		else
			ok = scan_move(next_record_op)
			if not ok and next_nodup_op then
				ok = scan_move(next_nodup_op)
			end
		end
		return accept_current_record(ok)
	end

	-- advance to the first row in the next distinct physical key.
	local function next_key()
		local ok
		if not started then
			started = true
			ok = first_record()
		elseif next_key_op then
			ok = scan_move(next_key_op)
		end
		return accept_current_record(ok)
	end

	scan.next = next_record
	scan.next_key = next_key

	--METADATA AND LIFETIME ---------------------------------------------------

	-- describe the selected key and iteration order.
	local function explain()
		local actual_order = {}
		for i = eq_n + 1, #key_fields do
			local f = key_fields[i]
			local descending = not not f.descending
			local dir = descending ~= reverse and 'desc' or 'asc'
			actual_order[#actual_order + 1] = f.col..' '..dir
		end
		return {
			table = base_schema.name,
			key = key_schema.name,
			order = actual_order,
			reverse = reverse,
		}
	end

	scan.explain = explain

	-- release both cursors owned by this scan.
	local function close()
		if cur then cur:close(); cur = nil end
		if base_cur then base_cur:close(); base_cur = nil end
		started = false
		base_seeked = false
	end

	scan.close = close

	--VALUE SET WRAPPERS ------------------------------------------------------

	-- repeat this scan for distinct values of one equality field.
	local function in_values(col, values)
		local param_i = assertf(eq[col], 'scan: in field: %s', col)
		local value_i, branch_open
		local seen = {}
		local params = {}

		-- insert each list value at the selected equality argument.
		local function reset_in(...)
			assert(select('#', ...) == nparams - 1, 'scan: params')
			local j = 1
			for i = 1, nparams do
				if i ~= param_i then
					params[i] = select(j, ...)
					j = j + 1
				end
			end
			clear(seen)
			value_i, branch_open = 0, false
		end

		-- drain one scan before resetting it for the next value.
		local function advance_in(advance)
			while true do
				if branch_open and advance() then return true end
				branch_open = false
				local value
					repeat
						value_i = value_i + 1
						if value_i > #values then return end
						value = values[value_i]
				until not seen[value]
				seen[value] = true
				params[param_i] = value
				reset(unpack(params, 1, nparams))
				branch_open = true
			end
		end

		-- advance through every row from each distinct parameter value.
		local function next_in() return advance_in(next_record) end

		-- advance through distinct keys from each parameter value.
		local function next_key_in() return advance_in(next_key) end

		-- report no order because advance_in concatenates separate scans.
		local function explain_in()
			local e = explain()
			e.order = {}
			e.reverse = nil
			return e
		end

		-- release the cursors and bound arguments.
		local function close_in()
			close()
			clear(params)
			branch_open = false
		end

		return {
			reset = reset_in, next = next_in, next_key = next_key_in,
			compile_col = compile_col, explain = explain_in, close = close_in,
		}
	end

	scan.in_ = in_values

	-- skip rows whose compiled column value occurs in one list.
	local function not_in_values(col, values)
		local get = compile_col(col)
		local excluded = {}
		for _, value in ipairs(values) do excluded[value] = true end

		-- advance until the decoded column value is outside the hash.
		local function advance_not_in(advance)
			while advance() do
				local value = get()
				value = value == nil and null or value
				if not excluded[value] then return true end
			end
		end

		-- apply the hash to every row.
		local function next_not_in() return advance_not_in(next_record) end

		-- apply the hash to each representative row from next_key().
		local function next_key_not_in() return advance_not_in(next_key) end

		return {
			reset = reset, next = next_not_in,
			next_key = next_key_not_in, compile_col = compile_col,
			explain = explain, close = close,
		}
	end

	scan.not_in = not_in_values
	return scan
end
