--[[

	indexed scans over one mdbx_schema table.
	Written by Cosmin Apreutesei. Public Domain.

API
	db:scan(table, path) -> scan
	scan.reset(params...)
	scan.advance([by_key]) -> true | nil
	scan.col_decoder(col) -> get() -> value
	scan.explain() -> table
	scan.close()
	scan:each(params...) -> iter() -> true
	scan:in_('col', values) -> scan
	scan:not_in('col', values) -> scan
	scan:filter(accept) -> scan
	scan:join(spec) -> scan
	scan:left_join(spec) -> scan
	scan:fk_join(child_table, fk_cols) -> scan
	scan:fk_left_join(child_table, fk_cols) -> scan
	scan.col_decoder(table, col) -> get() -> value

RULES
	- in_() | not_in() | filter() | join() | left_join() -> same scan
	- fk_join() | fk_left_join() -> same scan
	- in_(col, values) -> distinct values in list order; order = {}
	- in_.reset(params...) -> params omit the selected equality arg
	- not_in(col, values) -> scan order preserved
	- not_in(...null...) -> DB null excluded
	- not_in(...).advance(true) -> only returned row tested
	- join spec = 'table[@alias].col[,col...]=table.col[,col...]'
	- join cols -> exact table PK or index
	- table_name right of '=' -> table already in scan
	- child_table owns fk_cols
	- fk_cols = 'col1,col2'
	- missing left-join row -> nil from each joined table getter

PATH
	path = 'eq_col, range_col [:) asc, order_col asc'
	- bare leading field -> one equality arg
	- '[:)' -> lower arg, upper arg; nil -> no bound
	- '[' | ']' -> inclusive bound
	- '^' -> one string-prefix arg
	- direction -> key selection + cursor direction; no sorting
	- '' -> table PK, forward

]]

if not ... then require'mdbx_scan_test'; return end

require'mdbx_schema'

local C = C
local Db = mdbx_db
local encode_key_prefix = mdbx_encode_key_prefix
local min, memcmp = min, memcmp

--TABLE API ------------------------------------------------------------------

-- returns cursor operations that share key_rec and pk_rec.
local function table_api(db, key_schema)
	local table_schema = key_schema.val_schema or key_schema
	local is_index = key_schema.is_index or false
	local key_rec = MDBX_val()
	local pk_rec = is_index and MDBX_val() or key_rec
	local val_rec = MDBX_val()
	local cur, base_cur, base_seeked

	-- updates key_rec and pk_rec after each cursor move.
	local function move(op)
		if cur and cur:closed() then cur = nil end
		if not cur then cur = db:cursor(key_schema.name) end
		local val = is_index and pk_rec or val_rec
		local ok = cur:move_raw_into(op, key_rec, val)
		if ok then base_seeked = false end
		return ok
	end

	-- seeks the base row only when the index cannot supply the value.
	local function base_value()
		if not is_index then return val_rec.data, val_rec.size end
		if not base_seeked then
			if base_cur and base_cur:closed() then base_cur = nil end
			if not base_cur then
				base_cur = db:cursor(table_schema.name)
			end
			local ok = base_cur:move_raw_into(C.MDBX_SET_KEY, pk_rec,
				val_rec)
			assert(ok, 'scan: missing PK')
			base_seeked = true
		end
		return val_rec.data, val_rec.size
	end

	local function col_decoder(col)
		assertf(table_schema.fields[col], 'scan: bad field: %s', col)
		return db:col_decoder(key_schema, col,
			is_index and key_rec or nil, pk_rec, base_value)
	end

	local function key_encoder(cols, output_schema)
		return db:key_encoder(key_schema, cols, output_schema,
			is_index and key_rec or nil, pk_rec, base_value)
	end

	-- closes both cursors and clears the saved base-row position.
	local function close()
		if cur then cur:close(); cur = nil end
		if base_cur then base_cur:close(); base_cur = nil end
		base_seeked = false
	end
	return move, key_rec, pk_rec, col_decoder, key_encoder, close
end

--JOINS ---------------------------------------------------------------------

-- adds key_schema's table to outer_scan.
local function add_join_table(db, outer_scan, key_schema, get_key, table_name,
	kind, fk_name)
	local table_schema = key_schema.val_schema or key_schema
	local left = kind == 'left_join' or kind == 'fk_left_join'
	local op = fk_name and 'fk_join' or 'join'
	local find_outer_table = outer_scan._find_table
	assertf(not find_outer_table(table_name),
		'%s: table name already used: %s', op, table_name)

	--JOIN KEY ----------------------------------------------------------------

	local move, key_rec, _, table_col_decoder,
		table_key_encoder, close_key = table_api(db, key_schema)
	local row_found

	-- left join decoders return nil and key encoders return nothing when
	-- no row was found.
	local function col_decoder(col)
		local get = table_col_decoder(col)
		if not left then return get end
		return function() return row_found and get() or nil end
	end

	local function key_encoder(cols, output_schema)
		local get = table_key_encoder(cols, output_schema)
		if not left then return get end
		return function()
			if row_found then return get() end
		end
	end

	local function find_table(name)
		if name == table_name then
			return table_schema, col_decoder, key_encoder
		end
		return find_outer_table(name)
	end

	local function join_col_decoder(name, col)
		local _, col_decoder = find_table(name)
		assertf(col_decoder, '%s: no table: %s', op, name)
		return col_decoder(col)
	end

	--ITERATION ---------------------------------------------------------------

	local outer_reset = outer_scan.reset
	local outer_advance = outer_scan.advance

	local function reset_join(...)
		outer_reset(...)
		row_found = false
	end

	-- returns all matching index rows before advancing outer_scan.
	local function advance_join(by_key)
		-- advance_join() cannot select one key from multiple cursors.
		assertf(not by_key, '%s: no key iteration', op)
		if key_schema.is_index and row_found
			and move(C.MDBX_NEXT_DUP)
		then
			return true
		end
		row_found = false
		while outer_advance() do
			local ok, p, p_sz = get_key()
			if ok then
				key_rec.data = p
				key_rec.size = p_sz
				if move(C.MDBX_SET_KEY) then
					row_found = true
					return true
				end
			end
			if left then return true end
		end
	end

	local outer_close = outer_scan.close

	local function close_join()
		outer_close()
		close_key()
		row_found = false
	end

	local outer_explain = outer_scan.explain

	local function explain_join() -- -> {kind, outer, table, key [, fk]}
		local t = {
			kind = kind,
			outer = outer_explain(),
			table = table_schema.name,
			key = key_schema.name,
		}
		if fk_name then t.fk = fk_name end
		return t
	end

	outer_scan.reset = reset_join
	outer_scan.advance = advance_join
	outer_scan._find_table = find_table
	outer_scan.col_decoder = join_col_decoder
	outer_scan.explain = explain_join
	outer_scan.close = close_join
	outer_scan.not_in = nil
	return outer_scan
end

-- parses the spec and requires an exact physical key.
local function add_join(db, outer_scan, spec, kind)

	--SPEC --------------------------------------------------------------------

	local table_spec, table_cols_spec, outer_table_name,
		outer_cols_spec = spec:match(
		'^%s*(.-)%s*%.%s*(.-)%s*=%s*(.-)%s*%.%s*(.-)%s*$')
	assert(table_spec and table_cols_spec ~= ''
		and outer_table_name ~= '' and outer_cols_spec ~= '',
		'join: spec')
	local schema_name, table_name =
		table_spec:match'^(.-)%s*@%s*(.*)$'
	if not schema_name then
		schema_name = table_spec
		table_name = schema_name
	end
	assert(schema_name ~= '' and table_name ~= '', 'join: table')
	local table_schema = assertf(db:table_schema(schema_name),
		'join: no schema: %s', schema_name)
	assert(not table_schema.is_index, 'join: base table')

	local find_outer_table = outer_scan._find_table
	local outer_schema, _, outer_key_encoder =
		find_outer_table(outer_table_name)
	assertf(outer_schema, 'join: no table: %s', outer_table_name)
	local table_cols, outer_cols = {}, {}
	for part in split(table_cols_spec, ',', 1, true) do
		local table_col = part:match'^%s*(.-)%s*$'
		assertf(table_schema.fields[table_col],
			'join: bad field: %s.%s', schema_name, table_col)
		table_cols[#table_cols + 1] = table_col
	end
	for part in split(outer_cols_spec, ',', 1, true) do
		local outer_col = part:match'^%s*(.-)%s*$'
		assertf(outer_schema.fields[outer_col],
			'join: bad field: %s.%s', outer_table_name, outer_col)
		outer_cols[#outer_cols + 1] = outer_col
	end
	assert(#table_cols == #outer_cols, 'join: cols')

	--KEY ---------------------------------------------------------------------

	local key_schema
	for i = 0, #(table_schema.indexes or empty) do
		local table_key_schema = i == 0 and table_schema
			or table_schema.indexes[i]
		if #table_key_schema.key_fields == #table_cols then
			key_schema = table_key_schema
			for j, col in ipairs(table_cols) do
				if table_key_schema.key_fields[j].col ~= col then
					key_schema = nil
					break
				end
			end
			if key_schema then break end
		end
	end
	assertf(key_schema, 'join: no key: %s(%s)',
		schema_name, cat(table_cols, ', '))

	-- both columns must allow the same values and equality rules.
	for i, outer_col in ipairs(outer_cols) do
		local outer_field = outer_schema.fields[outer_col]
		local key_field = key_schema.key_fields[i]
		assertf(outer_field.mdbx_type == key_field.mdbx_type
			and outer_field.maxlen == key_field.maxlen
			and outer_field.padded == key_field.padded
			and outer_field.nozero == key_field.nozero
			and outer_field.mdbx_collation == key_field.mdbx_collation,
			'join: incompatible: %s.%s = %s.%s',
			schema_name, table_cols[i], outer_table_name, outer_col)
	end

	local get_key = outer_key_encoder(outer_cols, key_schema)
	return add_join_table(db, outer_scan, key_schema, get_key, table_name, kind)
end

-- uses one FK to add its absent child or parent table.
local function add_fk_join(db, outer_scan, child_table_name, fk_cols, kind)
	local child_schema = assertf(db:table_schema(child_table_name),
		'fk_join: no schema: %s', child_table_name)
	assert(not child_schema.is_index, 'fk_join: base table')
	local fk = child_schema.fks and child_schema.fks[fk_cols]
	assertf(fk, 'fk_join: no FK: %s(%s)', child_table_name, fk_cols)
	local parent_schema = assert(db:table_schema(fk.ref_table))
	local find_outer_table = outer_scan._find_table
	local outer_child_schema, _, outer_child_key_encoder =
		find_outer_table(child_schema.name)
	local outer_parent_schema, _, outer_parent_key_encoder =
		find_outer_table(parent_schema.name)
	-- fk_join adds exactly one of the FK's two tables.
	assert(not outer_child_schema ~= not outer_parent_schema,
		'fk_join: one FK table')
	local get_key, table_name, key_schema
	if outer_child_schema then
		get_key = outer_child_key_encoder(fk.cols, parent_schema)
		table_name = parent_schema.name
		key_schema = parent_schema
	else
		get_key = outer_parent_key_encoder(parent_schema.key_cols, fk.index)
		table_name = child_schema.name
		key_schema = fk.index
	end
	return add_join_table(db, outer_scan, key_schema, get_key, table_name, kind,
		fk.name)
end

--PUBLIC API -----------------------------------------------------------------

function Db:scan(table_name, path)
	local db = self
	local scan = {}
	local base_schema = assertf(db:table_schema(table_name),
		'scan: no schema: %s', table_name)
	assert(not base_schema.is_index, 'scan: not base table')

	--PATH --------------------------------------------------------------------

	-- path -> equality + bound + order terms.
	local eq_param_indexes, eq_n = {}, 0
	local lower_mark, upper_mark, starts
	local path_terms = {}
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
		local open, close = suffix:match'^([%[(]):([%])])$'
		local starts_bound = suffix == '^'
		assert(suffix == '' or starts_bound or open, 'scan: path')
		assertf(base_schema.fields[col], 'scan: bad field: %s', col)
		path_terms[#path_terms + 1] = {col = col, dir = dir}
		local i = #path_terms
		if suffix == '' and not dir then
			-- invariant: equality fields precede bounds and order fields.
			assert(i == eq_n + 1 and not lower_mark and not starts,
				'scan: eq first')
			eq_n = eq_n + 1
			eq_param_indexes[col] = eq_n
		elseif open or starts_bound then
			-- invariant: one bound follows the equality fields.
			assert(i == eq_n + 1 and not lower_mark and not starts,
				'scan: bound first')
			if starts_bound then
				local f = base_schema.fields[col]
				-- starts field -> variable + unpadded.
				assertf(f.maxlen and not f.padded,
					'scan: starts field: %s', col)
			end
			lower_mark, upper_mark, starts = open, close, starts_bound
		end
	end
	local nparams = eq_n + (lower_mark and 2 or starts and 1 or 0)

	--KEY SELECTION -----------------------------------------------------------

	-- matches the requested path against one physical key.
	local function key_fields_for_path(schema)
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
		for i, term in ipairs(path_terms) do
			local f = fields[i]
			if not f or f.col ~= term.col then return end
			if term.dir then
				local is_backwards = not not f.descending ~= (term.dir == 'desc')
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

	-- table + indexes -> first key that covers path.
	for i = 0, #(base_schema.indexes or empty) do
		local schema = i == 0 and base_schema or base_schema.indexes[i]
		key_fields, reverse = key_fields_for_path(schema)
		if key_fields then key_schema = schema; break end
	end

	if not key_schema then
		local needed = {}
		for i, term in ipairs(path_terms) do
			needed[i] = term.col..(term.dir and ' '..term.dir or '')
		end
		assertf(false, 'scan: no key: %s', cat(needed, ', '))
	end
	local key_depth = min(eq_n, #key_schema.key_fields)
	local pk_depth = 0
	if key_schema.is_index and key_depth == #key_schema.key_fields then
		for _, f in ipairs(base_schema.key_fields) do
			if not eq_param_indexes[f.col] then break end
			pk_depth = pk_depth + 1
		end
	end
	local has_bound = lower_mark or starts
	local varying_field = has_bound and key_fields[eq_n + 1] or nil
	local is_index = key_schema.is_index or false
	local pk_suffix = is_index and (pk_depth > 0
		or (has_bound and eq_n >= #key_schema.key_fields)) or false

	--BOUND ORDER -------------------------------------------------------------

	local start_op, start_param, stop_op, stop_param
	if lower_mark then
		local f = varying_field
		local lower_param, upper_param = eq_n + 1, eq_n + 2
		-- logical bounds -> encoded start + stop order.
		if f.descending then
			start_op = upper_mark == ')' and 'gt' or 'ge'
			stop_op  = lower_mark == '(' and 'lt' or 'le'
			start_param = upper_param
			stop_param  = lower_param
		else
			start_op = lower_mark == '(' and 'gt' or 'ge'
			stop_op  = upper_mark == ')' and 'lt' or 'le'
			start_param = lower_param
			stop_param  = upper_param
		end
	end

	local scan_move, key_rec, pk_rec, col_decoder, key_encoder,
		close_scan = table_api(db, key_schema)

	local function find_table(table_name)
		if table_name == base_schema.name then
			return base_schema, col_decoder, key_encoder
		end
	end
	scan.col_decoder = col_decoder
	scan._find_table = find_table

	--BOUNDS ------------------------------------------------------------------

	local function key_cmp(a, a_sz, b, b_sz) -- -> -1 | 0 | 1
		local c = memcmp(a, b, min(a_sz, b_sz))
		if c ~= 0 then return c end
		if a_sz < b_sz then return -1 end
		if a_sz > b_sz then return 1 end
		return 0
	end

	-- increments a byte prefix to make an exclusive upper bound.
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
	local pk_fixed_sz = pk_suffix and key_schema.dup_fixedsize or nil

	local start_key = u8a(MDBX_MAX_KEY_SIZE)
	local stop_key = u8a(MDBX_MAX_KEY_SIZE)
	local bound_values = {}
	local start_sz, stop_sz, empty_scan, started
	local index_key = pk_suffix and u8a(MDBX_MAX_KEY_SIZE) or nil
	local index_key_sz

	local function encode_values(out, n, partial) -- -> sz
		return encode_key_prefix(db, bound_schema, 'scan', out,
			MDBX_MAX_KEY_SIZE, n, partial or false,
			unpack(bound_values, 1, n))
	end

	-- encodes scan params into the start and stop keys.
	local function base_reset(...)
		assert(select('#', ...) == nparams, 'scan: params')
		if pk_suffix then
			for i = 1, key_depth do
				bound_values[i] = select(i, ...)
			end
			index_key_sz = encode_key_prefix(db, key_schema, 'scan',
				index_key, MDBX_MAX_KEY_SIZE, key_depth, false,
				unpack(bound_values, 1, key_depth))
			for i = 1, bound_depth do
				local col = bound_schema.key_fields[i].col
				bound_values[i] = select(eq_param_indexes[col], ...)
			end
		else
			for i = 1, bound_depth do
				bound_values[i] = select(i, ...)
			end
		end
		start_sz = nil
		stop_sz = nil
		empty_scan = false
		if starts then
			local value = select(eq_n + 1, ...)
			-- starts(nil | null) -> invalid.
			assert(value ~= nil and value ~= null, 'scan: starts')
			bound_values[bound_depth + 1] = value
			start_sz = encode_values(start_key, bound_depth + 1, true)
			copy(stop_key, start_key, start_sz)
			stop_sz = increment_prefix(stop_key, start_sz)
		else
			local start_is_prefix
			local value = start_op and select(start_param, ...)
			if start_op and value ~= nil then
				bound_values[bound_depth + 1] = value
				start_sz = encode_values(start_key, bound_depth + 1)
				if start_op == 'gt' then
					start_sz = increment_prefix(start_key, start_sz)
					if not start_sz then empty_scan = true end
				end
			elseif bound_depth > 0 then
				start_sz = encode_values(start_key, bound_depth)
				start_is_prefix = true
			end

			value = stop_op and select(stop_param, ...)
			if stop_op and value ~= nil then
				bound_values[bound_depth + 1] = value
				stop_sz = encode_values(stop_key, bound_depth + 1)
				if stop_op == 'le' then
					stop_sz = increment_prefix(stop_key, stop_sz)
				end
			elseif bound_depth > 0 then
				if start_is_prefix then
					copy(stop_key, start_key, start_sz)
					stop_sz = start_sz
				else
					stop_sz = encode_values(stop_key, bound_depth)
				end
				stop_sz = increment_prefix(stop_key, stop_sz)
			end
		end
		-- DUPFIXED PK bound -> full fixed-size value.
		if pk_fixed_sz then
			if start_sz and start_sz < pk_fixed_sz then
				fill(start_key + start_sz, pk_fixed_sz - start_sz)
				start_sz = pk_fixed_sz
			end
			if stop_sz and stop_sz < pk_fixed_sz then
				fill(stop_key + stop_sz, pk_fixed_sz - stop_sz)
				stop_sz = pk_fixed_sz
			end
		end
		if start_sz and stop_sz
			and key_cmp(start_key, start_sz, stop_key, stop_sz) >= 0
		then
			empty_scan = true
		end
		started = false
	end
	scan.reset = base_reset

	--ITERATION ---------------------------------------------------------------

	local dup_op = reverse and C.MDBX_PREV_DUP or C.MDBX_NEXT_DUP
	local nodup_op = reverse and C.MDBX_PREV_NODUP or C.MDBX_NEXT_NODUP

	local function first_key_record() -- -> true | false
		if empty_scan then return false end
		if not reverse then
			if start_sz then
				key_rec.data = start_key
				key_rec.size = start_sz
				return scan_move(C.MDBX_SET_RANGE)
			end
			return scan_move(C.MDBX_FIRST)
		end
		if not stop_sz then return scan_move(C.MDBX_LAST) end
		key_rec.data = stop_key
		key_rec.size = stop_sz
		if scan_move(C.MDBX_SET_RANGE) then
			return scan_move(C.MDBX_PREV)
		end
		return scan_move(C.MDBX_LAST)
	end

	-- positions an exact index key at the first PK inside the bounds.
	local function first_pk_record()
		if empty_scan then return false end
		key_rec.data = index_key
		key_rec.size = index_key_sz
		if not reverse then
			if start_sz then
				pk_rec.data = start_key
				pk_rec.size = start_sz
				return scan_move(C.MDBX_GET_BOTH_RANGE)
			end
			return scan_move(C.MDBX_SET_KEY)
		end
		if stop_sz then
			pk_rec.data = stop_key
			pk_rec.size = stop_sz
			return scan_move(
				C.MDBX_TO_EXACT_KEY_VALUE_LESSER_THAN)
		end
		if not scan_move(C.MDBX_SET_KEY) then return false end
		return scan_move(C.MDBX_LAST_DUP)
	end

	-- scan flags -> fixed cursor ops for base_advance().
	local first_record = pk_suffix and first_pk_record or first_key_record
	local next_record_op = is_index and dup_op or nodup_op
	local next_nodup_op = is_index and not pk_suffix and nodup_op or nil
	local next_key_op = not pk_suffix and nodup_op or nil

	-- accepts a cursor result only while it remains inside the bounds.
	local function accept_current_record(ok)
		if not ok then return end
		if reverse then
			if start_sz and key_cmp(bound_rec.data, bound_rec.size,
				start_key, start_sz) < 0
			then return end
		elseif stop_sz and key_cmp(bound_rec.data, bound_rec.size,
			stop_key, stop_sz) >= 0
		then
			return
		end
		return true
	end

	-- by_key selects the first row of the next physical key.
	local function base_advance(by_key)
		local ok
		if not started then
			started = true
			ok = first_record()
		elseif by_key then
			if next_key_op then ok = scan_move(next_key_op) end
		else
			ok = scan_move(next_record_op)
			if not ok and next_nodup_op then
				ok = scan_move(next_nodup_op)
			end
		end
		return accept_current_record(ok)
	end
	scan.advance = base_advance

	--METADATA AND LIFETIME ---------------------------------------------------

	local function base_explain() -- -> {table, key, order, reverse}
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
	scan.explain = base_explain

	-- closes both cursors and clears the scan position.
	local function base_close()
		close_scan()
		started = false
	end
	scan.close = base_close

	--FILTERS -----------------------------------------------------------------

	-- replaces advance() so that it skips rejected rows.
	local function filter(self, accept)
		local advance = self.advance
		self.advance = function(by_key)
			while advance(by_key) do
				if accept() then return true end
			end
		end
		self.in_ = nil
		return self
	end
	scan.filter = filter

	--VALUE SETS --------------------------------------------------------------

	-- runs one scan for each distinct value, in list order.
	local function in_(self, col, values)
		local param_i = assertf(eq_param_indexes[col],
			'scan: in field: %s', col)
		-- save the methods that in_() replaces.
		local advance, reset, explain, close =
			self.advance, self.reset, self.explain, self.close
		local value_i
		local seen = {}
		local params = {}

		-- params omit the equality arg that in_ supplies.
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
			value_i = 0
		end

		local function advance_in(by_key)
			while value_i <= #values do
				if value_i > 0 and advance(by_key) then return true end
				local value
				repeat
					value_i = value_i + 1
					if value_i > #values then return end
					value = values[value_i]
				until not seen[value]
				seen[value] = true
				params[param_i] = value
				reset(unpack(params, 1, nparams))
			end
		end

		-- separate scans do not preserve one physical order.
		local function explain_in()
			local e = explain()
			e.order = {}
			e.reverse = nil
			return e
		end

		local function close_in()
			close()
			clear(params)
			value_i = 0
		end

		self.reset = reset_in
		self.advance = advance_in
		self.explain = explain_in
		self.close = close_in
		self.in_ = nil
		return self
	end
	scan.in_ = in_

	-- filters decoded values through one exclusion hash.
	local function not_in(self, col, values)
		local get = self.col_decoder(col)
		local excluded = {}
		for _, value in ipairs(values) do excluded[value] = true end

		return filter(self, function()
			local value = get()
			value = value == nil and null or value
			return not excluded[value]
		end)
	end
	scan.not_in = not_in

	local function each(self, ...)
		self.reset(...)
		return self.advance
	end
	scan.each = each

	local function join(self, spec)
		return add_join(db, self, spec, 'join')
	end
	scan.join = join

	local function left_join(self, spec)
		return add_join(db, self, spec, 'left_join')
	end
	scan.left_join = left_join

	local function fk_join(self, child_table_name, fk_cols)
		return add_fk_join(db, self, child_table_name, fk_cols, 'fk_join')
	end
	scan.fk_join = fk_join

	local function fk_left_join(self, child_table_name, fk_cols)
		return add_fk_join(db, self, child_table_name, fk_cols,
			'fk_left_join')
	end
	scan.fk_left_join = fk_left_join

	return scan
end
