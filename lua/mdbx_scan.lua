--[[

	table scanner and scan composition over mdbx_schema.
	Written by Cosmin Apreutesei. Public Domain.

TABLE SCANNER
	db:table_scanner  (table, path, [alias]) -> scan
	scan.reset        (args)
	scan.advance      ([by_key]) -> true | nil
	scan.advance_pk   () -> true | nil
	scan.advance_key  () -> true | nil
	scan.found        () -> true | nil
	scan.close        ()
	scan.key_rec, scan.val_rec, scan.is_index, scan.steps_by_key
SCAN COMPOSITION (any scan: table_scanner, join, or child_scan result)
	scan:each          (args) -> iter() -> true | nil
	scan:try_first     (args) -> scan | nil
	scan:exists        (args) -> true | false
	scan:left_rows     (args) -> iter() -> scan | nil       null-extends
	scan:select        (outputs) -> scan                    adds output terminals
	scan.out_cols -> {'NAME',...}  scan.get(t) writes every key
	scan:filter        (accept) -> scan
	scan:not_in        (col, values) -> scan
	scan:union         (scan2) -> scan              concatenates scan2 rows
	scan:limit         (n|{arg='KEY'}, [offset|{arg='KEY'}]) -> scan
OUTPUT TERMINALS (after select() or aggregate())
	scan:rows       ([shape], [args]) -> iter() -> vals... | row
	scan:rows_array ([shape], [args]) -> {row1,...}
	scan:first      ([shape], [args]) -> vals... | row | nil
	scan:one        ([shape], [args]) -> vals... | row | nil
	scan:must_one   ([shape], [args]) -> vals... | row
JOINS
	db:join_scans      (outer, inner) -> join       inner join
	db:left_join_scans (outer, inner) -> join       left join
	join.reset         (args)
	join.advance       () -> true | nil
	join.found         () -> true | nil             was inner reached?
	join.close         ()
	db:child_scan      (parent, child) -> child     gates child on parent.found()
	child.reset        (args)                       skipped when parent not found
	child.advance      ([by_key]) -> true | nil
	child.found        () -> true | nil             was parent+child reached?

]]

if not ... then require'mdbx_scan_test'; return end

require'mdbx_schema'
local C = ffi.load'mdbx_schema' --see src/c/mdbx_schema/mdbx_schema.c

local
	assertf, assert, copy, null =
	assertf, assert, copy, null

local Db = mdbx_db

--scratch space for building one key and reading one field; written and read
--within a single call, never handed to another file.
local pp = new'u8*[1]'
local pout = new'const u8*[1]'
local key_decode_buffer = u8a(MDBX_MAX_KEY_SIZE)

local key_reencode = mdbx_key_reencode
local collate_value = mdbx_collate_value

--TABLE SCANNER --------------------------------------------------------------

--[[
A table scanner can seek into base tables on a leading sequence of (pk cols)
and into index tables on a leading sequence of (ix cols, pk cols).

The path is a sequence of terms:

	{{'COL','='|'is',P}, ...,
		{'COL','range'[,'>|>=',P][,'<|<=',P][,dir='asc|desc']}
		| {'COL','starts',P[,dir='asc|desc']}
		| {'COL','is_not_null'[,dir='asc|desc']},
		{'COL',dir='asc|desc'},...}
	P: {value=V} | {arg='KEY'} | {get=fn()} | {scan=S, col='COL'}

So 0..N '='|'is' terms + 0..1 range/prefix/is_not_null term + 0..N dir term.

P is a param object telling how the value is supplied: by reading param.value
or param.get(), via reset{[param.arg]}, or from the current row of another scan.

'=' / ranges / 'starts' reject null, 'is' allows it. {scan=} needs '='.

Why so complicated:
 - index tables and base tables need different treatment.
 - eq cols can span an index key rec and/or val rec arbitrarily.
 - the optional range col can land on the index key rec or val rec.
 - rediscovers that fk keys can be used raw by analyzing params and even that
   has 2 modes: direct raw and key re-encode (needed by fks on nullable cols).
 - writing params individually into the key rec also has 4 modes:
   encode Lua value, copy raw key col, copy raw val col, re-encode key/val col.
 - descending means reversing the ranges and all mdbx ops which has edge cases.
 - edge case: bounds are converted to half-open byte intervals, but incrementing
   a byte prefix can have no successor which needs an extra bool state.
 - edge case: partial bounds over DUPFIXED PKs require padding.
 - edge case: an upper-only range on a nullable column requires creating a
   synthetic lower boundbecause null values come before non-null values; the
	same lower bound is used for is_not_null.
 - edge case: index columns with ai_ci do not contain the original text.
 - a base-table value from an index scan needs a secondary base-table lookup
   if the column is not in the index (we call this "uncovered").
 - a scan param is valid only while its source scan has a current row.
]]

--string prefix -> exclusive upper bound; nil when no larger prefix exists.
local function increment_prefix(prefix, sz)
	local i = sz - 1
	while i >= 0 and prefix[i] == 255 do i = i - 1 end
	if i < 0 then return end
	prefix[i] = prefix[i] + 1
	return i + 1
end

--copy and pad input data if not already for comparing with DUPFIXED keys.
local function pad_data(data, sz, out, out_sz)
	if not sz or sz >= out_sz then return data, sz end
	C.schema_key_pad(data, sz, out, out_sz)
	return out, out_sz
end

--for a table param, resolve the field and the rec (param.key_rec or
--param.val_rec) that holds its bytes, plus the param's schemas. does not
--judge type compatibility with output_field; the two callers treat a
--mismatch differently.
local function scan_param_rec(db, param, output_field)
	local scan = param.scan
	local param_schema = db:table_schema(scan.table)
	assertf(param_schema, 'no schema: %s', scan.table)
	local base_schema = param_schema.val_schema or param_schema
	local field = param_schema.fields[param.col]
	local rec
	if field and field.key_index
		and (field.mdbx_collation ~= 'utf8_ai_ci'
			or output_field.mdbx_collation == 'utf8_ai_ci')
	then --field is in the index's key_rec and it's usable raw.
		rec = scan.key_rec
	else
		field = base_schema.fields[param.col]
		assertf(field, 'no field: %s.%s', scan.table, param.col)
		if field.key_index then --field is pk
			rec = param_schema.is_index and scan.val_rec or scan.key_rec
		else --value column: only a base-table param carries it in val_rec;
			--an index param's val_rec holds the pk, needing a base lookup.
			if param_schema.is_index then
				scan:need_base()
				rec = scan.base_val_rec
			else
				rec = scan.val_rec
			end
		end
	end
	return field, rec, param_schema, base_schema
end

--if params[1..key_n] are all table-type eq params pointing at the same rec,
--in that rec's own field order, the key can be built without a field-by-field
--Lua loop: 'direct' when the layout is also byte-identical (key_sig match,
--all not_null) -> use the rec as-is; else 'reencode' -> key_reencode()
--bridges a layout difference (e.g. a nullable column) in one C call instead
--of key_n Lua closures.
local function direct_read_rec(db, schema, params)
	local first_rec, first_key_schema
	local all_not_null = true
	for i = 1, #schema.key_fields do
		local param = params[i]
		local output_field = schema.key_fields[i]
		if not param.scan then return end
		local field, rec, param_schema, base_schema =
			scan_param_rec(db, param, output_field)
		--the verbatim/reencode paths reuse raw bytes, so a value column or a
		--layout mismatch both rule them out.
		if field.key_index ~= i
			or field.mdbx_type ~= output_field.mdbx_type
			or field.maxlen ~= output_field.maxlen
			or field.padded ~= output_field.padded
			or field.nozero ~= output_field.nozero
			or field.mdbx_collation ~= output_field.mdbx_collation
		then
			return
		end
		if i == 1 then
			first_rec = rec
			first_key_schema = rec == param.scan.key_rec
				and param_schema or base_schema
		elseif rec ~= first_rec then
			return
		end
		all_not_null = all_not_null and field.not_null
	end
	if all_not_null and first_key_schema.key_sig == schema.key_sig then
		return 'direct', first_rec
	end
	return 'reencode', first_rec, first_key_schema
end

--key_add_param() -> closure(out) that writes one field at pp[0] and advances
--pp; returns false when op rejects null or when a scan source is absent.
local function key_add_param(db, param, output_schema, slot, scan, op)
	local output_field = output_schema.key_fields[slot]
	local out_st = output_schema._st
	local cap = output_schema.key_fields.max_rec_size
	local i = slot - 1
	if not param.scan then
		local get, arg, value = param.get, param.arg, param.value
		return function(out)
			local v = value
			if get then
				v = get()
			elseif arg then
				local args = scan.args
				if args == nil then
					assertf(false, 'missing arg: %s', arg)
				end
				v = args[arg]
				if v == nil then
					assertf(false, 'missing arg: %s', arg)
				end
			end
			local len
			if v == nil or v == null then
				if op ~= 'is' or output_field.not_null then return false end
				len = -1
			else
				len = output_field.encode(db, 'scan', pp[0], v)
			end
			C.schema_key_add(out_st, i, out, cap, len, pp)
			return true
		end
	else
		local field, rec, param_schema, base_schema =
			scan_param_rec(db, param, output_field)
		local found = param.scan.found
		local is_key_read = field.key_index ~= nil
		local st = rec == param.scan.key_rec
			and param_schema._st or base_schema._st
		local field_i = field.key_index and field.key_index - 1 or field.val_index - 1
		local write

		--raw bytes only work when the source encoding matches output_field's.
		--otherwise decode the source value and encode it through output_field;
		--like the raw path, an absent (DB null) source aborts the key.
		if field.mdbx_type ~= output_field.mdbx_type
			or field.maxlen ~= output_field.maxlen
			or field.padded ~= output_field.padded
			or field.nozero ~= output_field.nozero
			or field.mdbx_collation ~= output_field.mdbx_collation
		then
			local decode = field.decode
			assertf(decode, 'incompatible: %s.%s -> %s.%s',
				param.scan.table, param.col,
				output_schema.name, output_field.col)
			write = function(out)
				if not found() then return false end
				local len = is_key_read
					and C.schema_get_key_rec(st, field_i, rec,
						key_decode_buffer, MDBX_MAX_KEY_SIZE, pout, nil)
					or C.schema_get_val_rec(st, field_i, rec, pout)
				if len < 0 then return false end
				local elen = output_field.encode(db, 'scan', pp[0],
					decode(pout[0], len))
				C.schema_key_add(out_st, i, out, cap, elen, pp)
				return true
			end
		elseif is_key_read then
			write = function(out)
				if not found() then return false end
				return C.schema_key_add_key_rec(out_st, i, out, cap, pp,
					st, field_i, rec) ~= 0
			end
		else
			write = function(out)
				if not found() then return false end
				return C.schema_key_add_val_rec(out_st, i, out, cap, pp,
					st, field_i, rec) ~= 0
			end
		end
		return write
	end
end

--key_write() -> closure(out) -> data, sz; nil when a param cannot form
--the key.
local function key_write(db, output_schema, params, path, scan, i0, n)
	local key_add = {}
	for i = 1, n do
		local param_i = i0 + i - 1
		key_add[i] = key_add_param(db, params[param_i], output_schema, i,
			scan, path[param_i][2])
	end
	return function(out)
		pp[0] = out
		for k = 1, n do
			if not key_add[k](out) then return end
		end
		return out, C.schema_key_size(out, pp)
	end
end

--bound_write() -> closure(out, prefix_sz) -> data, sz; nil when the param
--cannot form the bound. When partial is true, bound_write() trims a starts
--value's terminator.
local function bound_write(db, param, output_schema, slot, scan, op, partial)
	if not param then return end
	local key_add = key_add_param(db, param, output_schema, slot, scan, op)
	local trim = partial and output_schema.key_fields[slot].elem_size
	return function(out, prefix_sz)
		C.schema_key_add_start(out, prefix_sz, pp)
		if not key_add(out) then return end
		local sz = C.schema_key_size(out, pp)
		if trim then sz = sz - trim end
		return out, sz
	end
end

local function write_null_bound(output_schema, slot, out, prefix_sz)
	C.schema_key_add_start(out, prefix_sz, pp)
	C.schema_key_add(output_schema._st, slot - 1, out,
		output_schema.key_fields.max_rec_size, -1, pp)
	return out, C.schema_key_size(out, pp)
end

local Scan = {}

local MDBX_val_size = sizeof'MDBX_val'

--physical scan order for schema once depth leading path_fields are
--fixed by equality; reverse flips ascending fields to descending and
--vice versa. pure function of plan data, usable without a live scan.
local function scan_order(schema, depth, reverse)
	local order = {}
	for i = depth + 1, #schema.path_fields do
		local field = schema.path_fields[i]
		local descending = not not field.descending
		local dir = descending ~= reverse and 'desc' or 'asc'
		order[#order + 1] = field.col..' '..dir
	end
	return order
end
mdbx_scan_order = scan_order

function Db:table_scanner(tbl, path, alias)
	local db = self
	local schema = assert(db:table_schema(tbl))
	local scan = object(Scan)
	local base_schema = schema.val_schema or schema
	scan.table = schema.name
	scan.members = {alias or base_schema.name}

	--path parsing, validation, analysis --------------------------------------

	local eq_n = 0 --how many equality columns
	local eq_params = {}
	local reverse
	local range_field
	local is_not_null
	local prefix_param
	local lo_op, lo_param
	local hi_op, hi_param
	for i, term in ipairs(path) do
		local col, op = term[1], term[2]
		local f = schema.path_fields[i]
		assertf(f and f.col == col, 'invalid col: %s', col)
		if op then
			assertf(i == eq_n + 1 and not range_field,
				'invalid path term: %s', col)
			if op == '=' or op == 'is' then --{col, '='|'is', param}
				local param = term[3]
				assert(param)
				assert(op == '=' or not param.scan)
				eq_n = eq_n + 1
				eq_params[eq_n] = param
			elseif op == 'starts' then --{col, 'starts', param}
				range_field = f
				prefix_param = term[3]
				assert(prefix_param)
				assert(not prefix_param.scan)
			elseif op == 'is_not_null' then --{col, 'is_not_null'}
				range_field = f
				is_not_null = true
			else --range or inequality
				range_field = f
				if op == 'range' then --{col, 'range', lo_op, param, hi_op, param}
					lo_op, lo_param = term[3], term[4]
					hi_op, hi_param = term[5], term[6]
					assert(not lo_op or lo_op == '>' or lo_op == '>=')
					assert(not hi_op or hi_op == '<' or hi_op == '<=')
				elseif op == '>' or op == '>=' then --{col, '>'|'>=', param}
					lo_op, lo_param = op, term[3]
				elseif op == '<' or op == '<=' then --{col, '<'|'<=', param}
					hi_op, hi_param = op, term[3]
				else
					assertf(false, 'invalid op: %s', op)
				end
				assert(not lo_op == not lo_param)
				assert(not hi_op == not hi_param)
				assert(not lo_param or not lo_param.scan)
				assert(not hi_param or not hi_param.scan)
			end
		end
		local dir = term.dir
		if dir then
			assertf(dir == 'asc' or dir == 'desc', 'invalid path dir: %s', dir)
			--equality field direction does not affect returned order.
			if op ~= '=' and op ~= 'is' then
				local backwards = not f.descending ~= (dir == 'asc')
				if reverse == nil then
					reverse = backwards
				else
					assertf(reverse == backwards, 'mixed direction: %s', col)
				end
			end
		end
	end

	local is_index = schema.is_index
	local key_n = #schema.key_fields
	local exact_key = eq_n >= key_n
	scan.is_index = is_index
	scan.steps_by_key = not exact_key --an exact key has no next key to step to
	reverse = reverse or false
	scan.reverse = reverse

	--seeked (key, val), published for use as raw input in other scans.
	local key_rec = MDBX_val()
	local val_rec = MDBX_val()
	scan.key_rec = key_rec
	scan.val_rec = val_rec

	--base-table seeked (key, val) for uncovered columns, seeked by advance(),
	--but you must call scan:need_base() to enable it.
	local base_key_rec, base_val_rec

	local range_in_val = exact_key and is_index
	local range_rec = range_in_val and val_rec or key_rec

	--eq columns start in key_rec but can extend into val_rec on an index.
	--range_eq_n is how many eq columns are in range_rec.
	local range_eq_n =
		exact_key and not is_index and 0
		or (exact_key and is_index) and eq_n - key_n
		or eq_n
	local lo_null, hi_null
	--when the path rejects null without a non-null lower bound, start after
	--DB null.
	if range_field and not range_field.not_null
		and (is_not_null or hi_param and not lo_param)
	then
		lo_op = '>'
		lo_null = true
	end
	local has_bound = range_eq_n > 0 or lo_param or hi_param or prefix_param
		or lo_null

	--param reading / encoder compilation --------------------------------------

	local exact_write
	if exact_key then
		local direct_mode, direct_rec, direct_key_schema =
			direct_read_rec(db, schema, eq_params)
		if direct_mode == 'direct' then
			local found = eq_params[1].scan.found
			exact_write = function()
				if not found() then return false end
				copy(key_rec, direct_rec, MDBX_val_size)
				return true
			end
		elseif direct_mode == 'reencode' then
			local found = eq_params[1].scan.found
			local out = u8a(schema.key_fields.max_rec_size)
			exact_write = function()
				if not found() then return false end
				return C.schema_key_reencode_rec(direct_key_schema._st,
					schema._st, direct_rec, key_rec, out,
					schema.key_fields.max_rec_size) == 1
			end
		else
			local out = u8a(schema.key_fields.max_rec_size)
			local write = key_write(db, schema, eq_params, path, scan, 1, key_n)
			exact_write = function()
				local data, sz = write(out)
				if not data then return false end
				key_rec.data, key_rec.size = data, sz
				return true
			end
		end
	end

	--reset -------------------------------------------------------------------

	--state between reset() and advance().
	local limit_rec = MDBX_val()
	local must_seek, has_limit, empty_scan, started, found

	if has_bound then

		if prefix_param then --prefix scans require a varsize string field.
			assertf(range_field.maxlen and not range_field.padded,
				'starts on field: %s', range_field.col)
		end

		if (hi_op or lo_op) and range_field.descending then
			--reverse range bounds for desc range col because bounds are in byte-order.
			lo_op, hi_op =
				hi_op and (hi_op == '<' and '>' or '>='),
				lo_op and (lo_op == '>' and '<' or '<=')
			lo_param, hi_param = hi_param, lo_param
			lo_null, hi_null = hi_null, lo_null
		end

		local range_schema = range_in_val and schema.val_schema or schema
		--range_eq_i is where range eq columns start among the path's eq columns.
		local range_eq_i = range_in_val and key_n + 1 or 1
		local pk_fixed_sz = range_in_val and schema.dup_fixedsize

		--range key's eq prefix (shared by starts/lo/hi), when non-empty.
		local eq_write = range_eq_n > 0
			and key_write(db, range_schema, eq_params, path, scan,
				range_eq_i, range_eq_n)

		--range bound fields, each appended after the eq prefix at the same slot.
		local lo_write = bound_write(db, lo_param, range_schema, range_eq_n+1,
			scan, lo_op)
		local hi_write = bound_write(db, hi_param, range_schema, range_eq_n+1,
			scan, hi_op)
		local starts_write =
			bound_write(db, prefix_param, range_schema, range_eq_n+1, scan,
				'starts', true)

		local range_cap = range_schema.key_fields.max_rec_size
		local seek_key = (eq_write or starts_write or lo_write or lo_null)
			and u8a(range_cap)
		local limit_key = (eq_write or starts_write or hi_write or hi_null)
			and u8a(range_cap)

		--eq prefix (+ range bound) -> seek key, then the limit to stop at;
		--swapped for a reverse scan so advance() has one fixed role per side.
		local function compute_bounds()
			local psz = 0
			if eq_write then
				local data, sz = eq_write(seek_key)
				if not data then empty_scan = true; return end
				psz = sz
			end

			local lo_data, lo_sz, hi_data, hi_sz
			if starts_write then
				local data, sz = starts_write(seek_key, psz)
				if not data then empty_scan = true; return end
				lo_data, lo_sz = data, sz
				copy(limit_key, data, sz)
				hi_data, hi_sz = limit_key, increment_prefix(limit_key, sz)
			else
				if psz > 0 then copy(limit_key, seek_key, psz) end
				if lo_write or lo_null then
					local data, sz
					if lo_write then
						data, sz = lo_write(seek_key, psz)
					else
						data, sz = write_null_bound(range_schema,
							range_eq_n + 1, seek_key, psz)
					end
					if not data then empty_scan = true; return end
					lo_data, lo_sz = data, sz
					if lo_op == '>' then
						lo_sz = increment_prefix(data, sz)
						if not lo_sz then empty_scan = true; return end
					end
				elseif psz > 0 then
					lo_data, lo_sz = seek_key, psz
				end
				if hi_write or hi_null then
					local data, sz
					if hi_write then
						data, sz = hi_write(limit_key, psz)
					else
						data, sz = write_null_bound(range_schema,
							range_eq_n + 1, limit_key, psz)
					end
					if not data then empty_scan = true; return end
					hi_data, hi_sz = data, sz
					if hi_op == '<=' then
						hi_sz = increment_prefix(data, sz)
					end
				elseif psz > 0 then
					hi_data, hi_sz = limit_key, increment_prefix(limit_key, psz)
				end
			end

			if pk_fixed_sz then
				lo_data, lo_sz = pad_data(lo_data, lo_sz, seek_key, pk_fixed_sz)
				hi_data, hi_sz = pad_data(hi_data, hi_sz, limit_key, pk_fixed_sz)
			end
			if reverse then
				return hi_data, hi_sz, lo_data, lo_sz
			else
				return lo_data, lo_sz, hi_data, hi_sz
			end
		end

		function scan.reset(args)
			scan.args = args
			empty_scan = false
			local seek_data, seek_sz, limit_data, limit_sz
			if exact_write and not exact_write() then
				empty_scan = true
			else
				seek_data, seek_sz, limit_data, limit_sz = compute_bounds()
			end
			if seek_sz then
				range_rec.data = seek_data
				range_rec.size = seek_sz
				must_seek = true
			else
				must_seek = false
			end
			if limit_sz then
				limit_rec.data = limit_data
				limit_rec.size = limit_sz
				has_limit = true
			else
				has_limit = false
			end
			started = false
			found = nil
		end
	else
		--no range_eq/lo/hi/prefix past the exact key (or no key at all):
		--must_seek and has_limit stay permanently false.
		function scan.reset(args)
			scan.args = args
			empty_scan = false
			if exact_write and not exact_write() then
				empty_scan = true
			end
			started = false
			found = nil
		end
	end

	--advance -----------------------------------------------------------------

	--direction-aware steps.
	local step_op  = reverse and C.MDBX_PREV       or C.MDBX_NEXT
	local dup_op   = reverse and C.MDBX_PREV_DUP   or C.MDBX_NEXT_DUP
	local nodup_op = reverse and C.MDBX_PREV_NODUP or C.MDBX_NEXT_NODUP

	--start-of-scan positioning and stepping ops for advance().
	local seek_op, first_op, last_dup_op, next_op, next_pk_op, next_key_op
	if exact_key and is_index then --index key is fixed; scan walks dup vals.
		seek_op = reverse and C.MDBX_TO_EXACT_KEY_VALUE_LESSER_THAN
			or C.MDBX_GET_BOTH_RANGE
		first_op = C.MDBX_SET_KEY
		--a reverse dup scan lands on the key, then walks to its last dup.
		last_dup_op = reverse and C.MDBX_LAST_DUP or nil
		next_op = dup_op
		next_pk_op = dup_op
		--index key is fixed, range is in the dup vals, so no next key to step to.
		next_key_op = false
	elseif exact_key then --single base-table row, no stepping.
		seek_op = reverse and C.MDBX_TO_KEY_LESSER_THAN or C.MDBX_SET_RANGE
		first_op = C.MDBX_SET_KEY
		next_op = false
		next_pk_op = false
		next_key_op = false
	else --range/prefix/full scan: walk the whole key, dup groups included.
		seek_op = reverse and C.MDBX_TO_KEY_LESSER_THAN or C.MDBX_SET_RANGE
		first_op = reverse and C.MDBX_LAST or C.MDBX_FIRST
		next_op = step_op
		next_pk_op = is_index and dup_op
		next_key_op = is_index and nodup_op or next_op
	end

	local cur
	local base_cur --base-table lookup state

	local function advance(op)
		assert(started ~= nil, 'advance: reset not called')
		found = nil
		if not started then
			started = true
			if empty_scan then return end
			if not cur then cur = db:cursor(schema.name) end
			local start_op = must_seek and seek_op or first_op
			if not cur:move_raw_into(start_op, key_rec, val_rec) then return end
			if last_dup_op and not must_seek then
				if not cur:move_raw_into(last_dup_op, key_rec, val_rec) then return end
			end
		elseif op then
			if not cur:move_raw_into(op, key_rec, val_rec) then return end
		else --next_*op is nil, no advance or limit check.
			return
		end
		if has_limit
			and (C.schema_key_cmp_rec(range_rec, limit_rec) < 0) == reverse
		then return end
		if base_key_rec then
			if not base_cur then base_cur = db:cursor(base_schema.name) end
			copy(base_key_rec, val_rec, MDBX_val_size)
			assert(base_cur:move_raw_into(C.MDBX_SET_KEY,
				base_key_rec, base_val_rec), 'broken index')
		end
		found = true
		return true
	end
	function scan.advance(by_key)
		local op; if by_key then op = next_key_op else op = next_op end
		return advance(op)
	end
	function scan.advance_pk()
		return advance(next_pk_op)
	end
	function scan.advance_key()
		return advance(next_key_op)
	end
	function scan.found()
		return found
	end
	function scan:need_base()
		if base_key_rec then return end
		assert(not started)
		base_key_rec = MDBX_val()
		base_val_rec = MDBX_val()
		scan.base_val_rec = base_val_rec
	end

	function scan.close()
		started = nil
		if cur then cur:close(); cur = nil end
		if base_cur then base_cur:close(); base_cur = nil end
	end

	--col decoder -------------------------------------------------------------

	--folded requests the column's ai_ci form instead of its display form.
	function scan:col_decoder(member, col, folded)
		assertf(member == (alias or base_schema.name),
			'col_decoder: unknown member: %s', tostring(member))
		local field = schema.fields[col]
		local indexed_ai_ci = schema.is_index and field and field.key_index
			and field.mdbx_collation == 'utf8_ai_ci'
		local get
		if field and field.key_index and (not indexed_ai_ci or folded) then
			local st, ki, decode = schema._st, field.key_index-1, field.decode
			get = function()
				local len = C.schema_get_key_rec(st, ki, key_rec,
					key_decode_buffer, MDBX_MAX_KEY_SIZE, pout, nil)
				return len ~= -1 and decode(pout[0], len) or nil
			end
		else
			--col_decoder() reads original ai_ci text from the base table.
			field = base_schema.fields[col]
			assertf(field, 'no field: %s.%s', schema.name, col)
			local st = base_schema._st
			local decode = field.decode
			if field.key_index then
				local rec = is_index and val_rec or key_rec
				local ki = field.key_index-1
				get = function()
					local len = C.schema_get_key_rec(st, ki, rec,
						key_decode_buffer, MDBX_MAX_KEY_SIZE, pout, nil)
					return len ~= -1 and decode(pout[0], len) or nil
				end
			else --col not in index: base-table lookup
				local vi = field.val_index-1
				local rec = val_rec
				if is_index then
					scan:need_base()
					rec = base_val_rec
				end
				get = function()
					local len = C.schema_get_val_rec(st, vi, rec, pout)
					return len ~= -1 and decode(pout[0], len) or nil
				end
			end
		end
		if folded and not indexed_ai_ci
			and field.mdbx_collation == 'utf8_ai_ci'
		then
			local raw = get
			get = function() return collate_value(raw(), true) end
		end
		return get
	end

	--explain -----------------------------------------------------------------

	function scan.explain() -- -> {table, key, order, reverse}
		local scan_reverse = not not reverse
		return {
			table = schema.val_schema and schema.val_schema.name or schema.name,
			key = schema.name,
			order = scan_order(schema, eq_n, scan_reverse),
			reverse = scan_reverse,
		}
	end

	return scan
end

function Scan:each(args)
	self.reset(args)
	return self.advance --since it returns true|nil
end

function Scan:try_first(args)
	self.reset(args)
	if self.advance() then return self end
end

function Scan:exists(args)
	self.reset(args)
	return self.advance() or false
end

--yields one row per reset() even when nothing is found (null-extended),
--then continues while found() holds.
function Scan:left_rows(args)
	self.reset(args)
	local first = true
	return function()
		if first then
			first = false
			self.advance()
			return self
		elseif self.found() and self.advance() then
			return self
		end
	end
end

function Scan:filter(accept)
	local advance = self.advance
	--advance until accept() approves the current row.
	self.advance = function(by_key)
		while advance(by_key) do
			if accept() then return true end
		end
	end
	self.steps_by_key = nil --a retry would jump past a same-key candidate
	return self
end

function Scan:not_in(col, values)
	local get = self:col_decoder(self.members[1], col)
	local excluded = {}
	for _, value in ipairs(values) do excluded[value] = true end
	self:filter(function()
		--map DB null to the public null sentinel.
		local value = get()
		value = value == nil and null or value
		return not excluded[value]
	end)
	return self
end

function Scan:union(scan2)
	local scan1 = self
	local scan = object(Scan)
	local current_scan = scan1
	local output = scan1.get ~= nil
	local found
	assert(output == (scan2.get ~= nil))
	function scan.reset(args)
		scan.args = args
		scan1.reset(args)
		scan2.reset(args)
		current_scan = scan1
		found = nil
	end
	function scan.advance(by_key)
		found = current_scan.advance(by_key)
		if not found and current_scan == scan1 then
			current_scan = scan2
			found = current_scan.advance(by_key)
		end
		return found
	end
	function scan.found()
		return found
	end
	if output then
		local names1, names2 = scan1.out_cols, scan2.out_cols
		assert(#names1 == #names2)
		for i, name in ipairs(names1) do assert(name == names2[i]) end
		local get1, get2 = scan1.get, scan2.get
		scan.out_cols = names1
		scan.rows = scan1.rows
		scan.rows_array = scan1.rows_array
		scan.first = scan1.first
		scan.one = scan1.one
		scan.must_one = scan1.must_one
		local function return_scan(_, ...)
			return scan, ...
		end
		function scan.get(out_row)
			local get = current_scan == scan1 and get1 or get2
			if out_row then
				get(out_row)
				return scan, out_row
			end
			return return_scan(get())
		end
	else
		scan.members = scan1.members
		scan.steps_by_key = scan1.steps_by_key and scan2.steps_by_key
		function scan.advance_pk()
			found = current_scan.advance_pk()
			return found
		end
		function scan.advance_key()
			return scan.advance(true)
		end
		function scan:col_decoder(member, col, folded)
			local get1 = scan1:col_decoder(member, col, folded)
			local get2 = scan2:col_decoder(member, col, folded)
			return function()
				if current_scan == scan1 then
					return get1()
				else
					return get2()
				end
			end
		end
	end
	function scan.close()
		scan2.close()
		scan1.close()
	end
	return scan
end

--unlike Scan:union(), advances both inputs together and yields once when
--they're at the same MDBX entry, so overlapping inputs -- e.g. the same row
--reachable through two different seeks -- come out once, not twice. both
--inputs must scan the same table in the same direction.
--compose pairwise for more than two: scan1:merge_union(scan2):merge_union(scan3)...
function Scan:merge_union(scan2)
	local scan1 = self
	assert(scan1.table and scan1.table == scan2.table)
	assert(scan1.reverse == scan2.reverse)
	assert(scan1.is_index == scan2.is_index)
	local reverse = scan1.reverse
	local scan = object(Scan)
	scan.members = scan1.members
	scan.steps_by_key = scan1.steps_by_key and scan2.steps_by_key
	local has1, has2, adv1, adv2, current_scan, found

	--publish the winning MDBX position for a further chained merge_union().
	scan.table = scan1.table
	scan.reverse = reverse
	scan.is_index = scan1.is_index

	function scan.reset(args)
		scan.args = args
		scan1.reset(args)
		scan2.reset(args)
		has1, has2, found = false, false, false
		adv1, adv2 = true, true
	end
	function scan.advance(by_key)
		if adv1 then has1 = scan1.advance(by_key) end
		if adv2 then has2 = scan2.advance(by_key) end
		if not has1 and not has2 then found = false; return end
		local cmp
		if has1 and has2 then
			cmp = C.schema_key_cmp_rec(scan1.key_rec, scan2.key_rec)
			if cmp == 0 and scan.is_index then
				cmp = C.schema_key_cmp_rec(scan1.val_rec, scan2.val_rec)
			end
			if reverse then cmp = -cmp end
		end
		if has1 and (not has2 or cmp <= 0) then
			current_scan = scan1
			adv1, adv2 = true, has2 and cmp == 0
		else
			current_scan = scan2
			adv1, adv2 = false, true
		end
		scan.key_rec = current_scan.key_rec
		scan.val_rec = current_scan.val_rec
		found = true
		return true
	end
	function scan.advance_pk()
		return current_scan.advance_pk()
	end
	function scan.advance_key()
		return scan.advance(true)
	end
	function scan.found()
		return found
	end
	function scan:col_decoder(member, col, folded)
		local get1 = scan1:col_decoder(member, col, folded)
		local get2 = scan2:col_decoder(member, col, folded)
		return function()
			if current_scan == scan1 then return get1() else return get2() end
		end
	end
	function scan.close()
		scan2.close()
		scan1.close()
	end
	return scan
end

--NESTED JOIN ----------------------------------------------------------------

--join.advance() advances inner under the current outer row, then moves to
--the next outer row once inner is exhausted.
local function join_scans(outer, inner, left, accept)
	local join = object(Scan)
	join.members = extend({}, outer.members, inner.members)
	local outer_found, inner_found = outer.found, inner.found
	local advance_inner = inner.advance
	if accept then
		local advance = advance_inner
		--advance_inner() skips rows that do not match the join condition.
		advance_inner = function()
			while advance() do
				if accept(join) then return true end
			end
		end
	end
	local in_inner, args
	function join.advance()
		if in_inner then
			if advance_inner() then return true end
			in_inner = nil
		end
		while outer.advance() do
			inner.reset(args)
			if advance_inner() then
				in_inner = true
				return true
			end
			if left then return true end
		end
	end
	function join.reset(reset_args)
		args = reset_args
		join.args = reset_args
		outer.reset(reset_args)
		in_inner = nil
	end
	join.found = left and outer_found or function()
		return outer_found() and inner_found()
	end
	function join:col_decoder(member, col, folded)
		if indexof(member, outer.members) then
			return outer:col_decoder(member, col, folded)
		end
		local get = inner:col_decoder(member, col, folded)
		return function()
			if inner_found() then return get() end
		end
	end
	function join.close()
		inner.close()
		outer.close()
	end
	return join
end

function Db:join_scans(outer, inner, accept)
	return join_scans(outer, inner, nil, accept)
end
function Db:left_join_scans(outer, inner, accept)
	return join_scans(outer, inner, true, accept)
end

--CHILD SCAN ---------------------------------------------------------------

--when parent has no row, reset(), advance(), col_decoder() must be no-ops
--to avoid reading the current row from the parent through the scan params.
function Db:child_scan(parent, child)
	local reset, advance, found = child.reset, child.advance, child.found
	function child.reset(args)
		if parent.found() then reset(args) end
	end
	function child.advance(by_key)
		return parent.found() and advance(by_key)
	end
	function child.found()
		return parent.found() and found()
	end
	local decode = child.col_decoder
	function child:col_decoder(member, col, folded)
		local get = decode(child, member, col, folded)
		return function()
			if child.found() then return get() end
		end
	end
	return child
end

--SELECT ---------------------------------------------------------------------

local function comma_list(s)
	if istab(s) then
		local i = 0
		return function() i = i + 1; return s[i] end
	end
	return s:gmatch'[^,]+'
end

local function materialized_get(scan, row, out_row)
	local out_cols = scan.out_cols
	if out_row then
		for _, name in ipairs(out_cols) do
			out_row[name] = row[name]
		end
		return scan, out_row
	end
	local n = #out_cols
	local values = {}
	for i = 1, n do values[i] = row[out_cols[i]] end
	return scan, unpack(values, 1, n)
end

local function output_row(scan, row, shape)
	if shape == nil then return unpack(row, 1, #scan.out_cols) end
	return row
end

local function parse_row_args(shape, args)
	if type(shape) == 'table' then
		assert(args == nil, 'row shape must be the first argument')
		return nil, shape
	end
	assert(shape == nil or shape == '[]' or shape == '{}',
		"row shape must be '[]' or '{}'")
	return shape, args
end

--yields one row (a table) per call, closing the scan on exhaustion.
local function raw_rows(scan, shape, args)
	local out_cols = scan.out_cols
	local n = #out_cols
	local scratch = shape ~= '{}' and {}
	scan.reset(args)
	local done = false
	return function()
		if done then return end
		if not scan.advance() then done = true; scan.close(); return end
		if shape == '{}' then
			local _, row = scan.get{}
			return row
		end
		scan.get(scratch)
		local row = {}
		for i = 1, n do row[i] = scratch[out_cols[i]] end
		return row
	end
end

--stores up to cap rows and closes the scan.
local function collect_output_rows(scan, shape, args, cap)
	local next_row = raw_rows(scan, shape, args)
	local rows = {}
	while not cap or #rows < cap do
		local row = next_row()
		if not row then break end
		rows[#rows + 1] = row
	end
	scan.close()
	return rows
end

local function output_rows(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	local next_row = raw_rows(scan, shape, args)
	return function()
		local row = next_row()
		if row then return scan, output_row(scan, row, shape) end
	end, scan
end

local function output_rows_array(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	return collect_output_rows(scan, shape, args)
end

local function output_first(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	local rows = collect_output_rows(scan, shape, args, 1)
	if rows[1] then return output_row(scan, rows[1], shape) end
end

local function output_one(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	local rows = collect_output_rows(scan, shape, args, 2)
	assert(#rows <= 1, 'one() matched more than one row')
	if rows[1] then return output_row(scan, rows[1], shape) end
end

local function output_must_one(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	local rows = collect_output_rows(scan, shape, args, 2)
	assert(#rows > 0, 'must_one() matched no rows, expected exactly one')
	assert(#rows == 1, 'must_one() matched more than one row, expected exactly one')
	return output_row(scan, rows[1], shape)
end

local function install_get(scan, names, read_value)
	local n = #names
	local values = {}
	local function get(out_row)
		if out_row then
			for i = 1, n do out_row[names[i]] = read_value(i) end
			return scan, out_row
		else
			for i = 1, n do values[i] = read_value(i) end
			return scan, unpack(values, 1, n)
		end
	end
	scan.out_cols = names
	scan.get = get
	scan.rows = output_rows
	scan.rows_array = output_rows_array
	scan.first = output_first
	scan.one = output_one
	scan.must_one = output_must_one
end

function Scan:select(outputs)
	local scan = self
	assert(not scan.get)

	local decoders, names = {}, {}
	for output in comma_list(outputs) do
		local member, col, name
		if isstr(output) then
			local col_spec
			col_spec, name = output:match'^%s*(%S+)%s*(%S*)%s*$'
			assert(col_spec, 'select: output')
			member, col = col_spec:match'^(.-)%.(.*)$'
			col = col or col_spec
			name = name ~= '' and name or col
		else
			member, col, name = output.member, output.col, output.name
		end
		if not member then
			assertf(#self.members == 1, 'select: ambiguous column: %s', col)
			member = self.members[1]
		end
		decoders[#decoders + 1] = self:col_decoder(member, col)
		names[#names + 1] = name
	end
	assert(#decoders > 0, 'select: outputs')

	install_get(scan, names, function(i) return decoders[i]() end)
	return scan
end

--unlike filter(), which skips a rejected row and keeps looking, advance()
--must stop outright once limit rows are yielded -- looking further would run
--the underlying scan to exhaustion for a match that will never come.
function Scan:limit(limit, offset)
	local scan = self
	local advance, reset = scan.advance, scan.reset
	local limit_arg = type(limit) == 'table' and limit.arg
	local offset_arg = type(offset) == 'table' and offset.arg
	local skipped, count
	scan.reset = function(args)
		if limit_arg then
			assertf(args and args[limit_arg] ~= nil, 'missing arg: %s', limit_arg)
			limit = args[limit_arg]
		end
		if offset_arg then
			assertf(args and args[offset_arg] ~= nil, 'missing arg: %s', offset_arg)
			offset = args[offset_arg]
		else
			offset = offset or 0
		end
		skipped, count = 0, 0
		reset(args)
	end
	self.advance = function(by_key)
		if count >= limit then return end
		while skipped < offset do
			if not advance(by_key) then return end
			skipped = skipped + 1
		end
		if not advance(by_key) then return end
		count = count + 1
		return true
	end
	return scan
end

--[[
sorts a value-record scan (the output of select()/aggregate()) by spec
-- a list of {member=,col=} or {field=} entries (each optionally desc=),
or a plain comparator fn(row_a, row_b). Materializes every row on first
advance() (there's no way to know the right order without seeing them
all), sorts once, then serves rows one at a time. null sorts before
non-null ascending, after descending.

Only the value-record path from the old node system's value_sort is
ported here: query2's compile_terminal always runs select()/aggregate()
before value_sort, so its raw-pk-stream branch (buffer pk bytes, re-seek
a fresh cursor per row to replay) is dead code from that call site and
isn't needed.

scan.get() publishes the row table itself. scan.get(out_row) assigns every
name in scan.out_cols, including nil.
]]
function Scan:sort(spec)
	local scan = self
	local get = scan.get
	assert(get, 'sort: select()/aggregate() required first')

	--a {member=,col=} term reads through col_decoder(..., true), the
	--comparison (collated) form of the same source the row was itself
	--decoded from -- correct even when col differs from that field's
	--select()-assigned output name (an alias, or a column order_by()
	--reads without select()ing it). a {field=} term has no source to
	--read through, so it reads the materialized (display-form) row by
	--its output name instead.
	local getters, ncols
	if type(spec) ~= 'function' then
		ncols = #spec
		getters = {}
		for i, p in ipairs(spec) do
			getters[i] = p.member and self:col_decoder(p.member, p.col, true)
		end
	end

	--sorts a permutation of row positions instead of the rows
	--themselves: rows is the actual output (needed regardless of
	--sorting), order is the only thing sort() rearranges, so there's no
	--per-row wrapper table pairing a row with anything. key values for
	--every row live in one flat array (stride ncols) instead of one
	--small table per row.
	local rows, keys, order, idx
	local advance = scan.advance
	scan.advance = function()
		if not order then
			rows, keys = {}, {}
			while advance() do
				local _, row = get{}
				local i = #rows + 1
				rows[i] = row
				if getters then
					local base = (i - 1) * ncols
					for k = 1, ncols do
						local getter = getters[k]
						if getter then
							keys[base + k] = getter()
						else
							keys[base + k] = row[spec[k].col or spec[k].field]
						end
					end
				end
			end
			order = {}
			for i = 1, #rows do order[i] = i end
			if not getters then
				sort(order, function(i, j) return spec(rows[i], rows[j]) end)
			else
				sort(order, function(i, j)
					local ai, bi = (i - 1) * ncols, (j - 1) * ncols
					for k = 1, ncols do
						local av, bv = keys[ai + k], keys[bi + k]
						if av ~= bv then
							local p = spec[k]
							local a_null = av == null or av == nil
							local b_null = bv == null or bv == nil
							if a_null ~= b_null then
								return p.desc and b_null or not p.desc and a_null
							end
							return p.desc and av > bv or not p.desc and av < bv
						end
					end
					return false
				end)
			end
			idx = 0
		end
		idx = idx + 1
		return order[idx] ~= nil
	end
	function scan.get(out_row)
		return materialized_get(scan, rows[order[idx]], out_row)
	end
	local reset = scan.reset
	scan.reset = function(args)
		reset(args)
		rows, keys, order, idx = nil, nil, nil, nil
	end
	return scan
end

--GROUP BY -------------------------------------------------------------------

--[[
groups consecutive rows by decoded values in cols ({member=,col=}...);
requires the scan already in that order. advance() and advance_pk() get
new meanings the same way every other Scan mutator redefines advance():
advance() lands on the first row of the next group (skipping the rest of
the current one); advance_pk() walks the current group's remaining rows,
one at a time, returning nil once the key changes without consuming that
next row into itself -- the following advance() picks it up as the new
group's first row.
]]
function Scan:group_by(cols)
	local advance = self.advance
	local by_key = self.steps_by_key
	local ncols = #cols
	local getters = {}
	for i, c in ipairs(cols) do
		getters[i] = self:col_decoder(c.member, c.col, true)
	end
	local prev, done, has_current, has_prev, peeked
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
	local function adv(bk)
		if done then return false end
		if not advance(bk) then done = true; return false end
		return true
	end
	self.advance = function()
		has_current = false
		if done then return end
		if not peeked then
			if not adv() then return end
			if has_prev then
				while same_key() do
					if not adv(by_key) then return end
				end
			end
		end
		peeked = false
		set_key(); has_prev = true
		has_current = true
		return true
	end
	function self.advance_pk()
		if not has_current then return end
		if not adv() then has_current = false; return end
		if same_key() then return true end
		peeked = true; has_current = false; return nil
	end
	local reset = self.reset
	self.reset = function(args)
		reset(args)
		prev = {}
		done = false; has_current = false; has_prev = false; peeked = false
	end
	return self
end

--folds a value into acc for one agg entry a: count/sum/avg/min/max skip
--null v; key copies key[a.part] straight through instead of aggregating
--a per-row value (a.part indexes the group_by() cols this aggregate()
--call was given, not this function's own state).
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
scan:aggregate(agg) -> scan
scan:aggregate(agg, cols[, hash]) -> scan

	agg = {{name=NAME, op=OP[, member=MEMBER, col=COL][, part=N]}, ...}
	OP = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'key'
	cols = {{member=MEMBER, col=COL}, ...}

aggregate() reads member.col for sum, avg, min, max, and count. aggregate()
counts every row when member is absent. aggregate() copies cols[part] when
op is 'key'.

aggregate(agg) emits one grand-total record. aggregate(agg, cols) expects
group_by(cols) on the same scan and emits consecutive groups with O(1)
memory. aggregate(agg, cols, true) accepts any input order, uses O(n groups)
memory, and emits groups in first-occurrence order.

aggregate() emits one record per advance(). scan.row contains that record so
the caller can read every field without copying it through get().
]]
function Scan:aggregate(agg, cols, hash)
	local scan = self

	local getters, names = {}, {}
	for i, a in ipairs(agg) do
		names[i] = a.name
		if a.op ~= 'key' and a.member then
			getters[a.name] = self:col_decoder(a.member, a.col)
		end
	end
	--bucket_getters (comparison form) only exists for the hashed path,
	--which needs to bucket by a collated key while still emitting the
	--display (unfolded) value through key/op='key' -- streamed grouping
	--already gets its own comparison from group_by()'s same_key().
	local key_getters, bucket_getters, nkeys
	if cols then
		key_getters = {}
		if hash then bucket_getters = {} end
		for i, c in ipairs(cols) do
			key_getters[i] = self:col_decoder(c.member, c.col)
			if hash then bucket_getters[i] = self:col_decoder(c.member, c.col, true) end
		end
		nkeys = #key_getters
	end
	local function accumulate(acc, key)
		for _, a in ipairs(agg) do
			local v
			if a.op == 'count' then
				if a.member then v = getters[a.name]() else v = true end
			elseif a.op ~= 'key' then
				v = getters[a.name]()
			end
			agg_step(acc, a, key, v)
		end
	end
	--key is scratch, reused across calls: agg_step()/the bucket-key
	--lookup both read it immediately and never retain it past that.
	local key = {}
	local function read_key()
		for i = 1, nkeys do
			local v = key_getters[i](); key[i] = v ~= nil and v or null
		end
		return key
	end
	local bucket = bucket_getters and {}
	local function bucket_key()
		for i = 1, nkeys do
			local v = bucket_getters[i](); bucket[i] = v ~= nil and v or null
		end
		return bucket
	end

	local done, output, group_i
	local advance = scan.advance
	if not cols then
		scan.advance = function()
			if done then return end
			done = true
			local acc = agg_init(agg)
			while advance() do accumulate(acc, nil) end
			scan.row = agg_finalize(agg, acc)
			return true
		end
	elseif hash then
		scan.advance = function()
			if not output then
				local tuple_space = nkeys > 1 and tuples() or nil
				local buckets, order = {}, {}
				while advance() do
					local key = read_key()
					local bkey = bucket_key()
					local t = nkeys == 1 and bkey[1]
						or tuple_space(unpack(bkey, 1, nkeys))
					local acc = buckets[t]
					if not acc then
						acc = agg_init(agg)
						buckets[t] = acc
						order[#order + 1] = acc
					end
					accumulate(acc, key)
				end
				output = {}
				for i, acc in ipairs(order) do output[i] = agg_finalize(agg, acc) end
				group_i = 0
			end
			group_i = group_i + 1
			scan.row = output[group_i]
			return scan.row ~= nil
		end
	else
		scan.advance = function()
			if not advance() then return end
			local key = read_key()
			local acc = agg_init(agg)
			accumulate(acc, key)
			while scan.advance_pk() do accumulate(acc, key) end
			scan.row = agg_finalize(agg, acc)
			return true
		end
	end
	local reset = scan.reset
	scan.reset = function(args)
		reset(args)
		done, output, group_i = false, nil, nil
	end

	--terminal: raw per-row columns no longer exist once folded, only the
	--agg's own named outputs are reachable.
	local col_map = {}
	for _, a in ipairs(agg) do
		if a.member then col_map[a.member..':'..a.col] = a.name end
	end
	function scan:col_decoder(member, col)
		local name = col_map[member..':'..col]
		if name then return function() return scan.row[name] end end
	end

	install_get(scan, names, function(i) return scan.row[names[i]] end)
	return scan
end

--DISTINCT -------------------------------------------------------------------

--[[
distinct(cols) calls group_by(cols) and keeps the first row of every
consecutive key. distinct(cols, true) accepts any input order, keeps the first
row of every key, and emits those rows in input order. distinct() keeps every
selected or aggregated field.
]]
function Scan:distinct(cols, hash)
	if not hash then
		return self:group_by(cols)
	end
	local scan = self
	assert(scan.get, 'distinct: select()/aggregate() required first')

	--key is comparison-only here (the kept row comes from get() below,
	--not from key), so the collated form covers it with no extra getter.
	local key_getters = {}
	for i, c in ipairs(cols) do
		key_getters[i] = self:col_decoder(c.member, c.col, true)
	end
	local nkeys = #key_getters
	--key is scratch, reused across calls: agg_step()/the bucket-key
	--lookup both read it immediately and never retain it past that.
	local key = {}
	local function read_key()
		for i = 1, nkeys do
			local v = key_getters[i](); key[i] = v ~= nil and v or null
		end
		return key
	end

	local row, output, row_i
	local advance, get = scan.advance, scan.get
	scan.advance = function()
		if not output then
			local tuple_space = nkeys > 1 and tuples() or nil
			local seen = {}
			output = {}
			while advance() do
				local key = read_key()
				local t = nkeys == 1 and key[1]
					or tuple_space(unpack(key, 1, nkeys))
				if not seen[t] then
					seen[t] = true
					local _, kept_row = get{}
					output[#output + 1] = kept_row
				end
			end
			row_i = 0
		end
		row_i = row_i + 1
		row = output[row_i]
		return row ~= nil
	end
	function scan.get(out_row)
		return materialized_get(scan, row, out_row)
	end
	local reset = scan.reset
	scan.reset = function(args)
		reset(args)
		output, row_i = nil, nil
	end
	return scan
end

--VALUES SCAN ----------------------------------------------------------------

function Db:values_scan(values)
	local scan = {}
	local value_i

	function scan.reset(args)
		scan.args = args
		value_i = 0
	end
	function scan.advance()
		value_i = value_i + 1
		return value_i <= #values or nil
	end
	function scan.get()
		return values[value_i]
	end

	local function advance_row()
		if scan.advance() then return scan end
	end
	function scan.rows(self, args)
		self.reset(args)
		return advance_row
	end
	function scan.close() end

	return scan
end
