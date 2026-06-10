--[[

	mdbx_schema: structured data and multi-key indexing for mdbx.
	Written by Cosmin Apreutsei. Public Domain.

	Data types:
	- ints: 8, 16, 32, 64 bit, signed/unsigned
	- floats: 32 and 64 bit
	- arrays: fixed-size and variable-size

	Keys:
	- composite keys with per-field ascending/descending order
	- utf-8 ai_ci collation

	Limitations:
	- only varsize columns with `nozero` (no embedded \0) can be used in indexes.
	- only columns with `not_null` can be used in primary key and unique indexes.
	- primary keys are immutable.
	- utf8_ai_ci can only be used for index keys.
	- fks: only to pk columns, no "restrict", no "onupdate" (pk is immutable).
	- schema layouting errors are non-recoverable.

API, extends mdbx.lua MANAGED API

	db:put        (table_name|dbi, [cols], keysvals...)
	db:insert     (table_name|dbi, [cols], keysvals...) -> generated_id
	db:update     (table_name|dbi, [cols], keysvals...)
	db:upsert     (table_name|dbi, [cols], keysvals...)
	db:is_null    (table_name|dbi, col, keys...) -> is_null, [reason]
	db:exists     (table_name|dbi, keys...) -> record_exists, table_exists
	db:[must_]get (table_name|dbi, [val_cols], keys...) -> vals...
	db:try_get    (table_name|dbi, [val_cols], keys...) -> true, vals... | false
	db:del        (table_name|dbi, keys...)
	db:put_records(table_name|dbi, [cols, ]{keysvals1,...})

	cur:{first|last|next|prev|current}([cols]) -> keysvals...
	cur:[must_]get ([val_cols], keys...) -> vals...
	cur:try_get    ([val_cols], keys...) -> true, vals... | false
	cur:update     ([val_cols], vals...)

	db:try_each    (tbl_name|dbi, [cols]) -> cur, keysvals...

		cols format   |  vals...              | keysvals...
		--------------+-----------------------+------------
		nil           |   col1_val,...        |  keycol1_val,..., col1_val,...
		'col1 ...'    |   col1_val,...        |  keycol1_val,..., col1_val,...
		'[col1 ...]'  |  {col1_val,...}       | {keycol1_val,..., col1_val,...}
		'{col1 ...}'  |  {col1=col1_val,...}  | {keycol1=keycol1_val,col1=col1_val}

]]

if not ... then require'mdbx_schema_test'; return end

require'mdbx'
require'utf8proc'
require'json' -- for null
require'schema'
local C = ffi.load'mdbx_schema' --see src/c/mdbx_schema/mdbx_schema.c

local
	typeof, num, shl, shr, band, bor, xor, bnot, bswap, u8p, copy, cast, memcmp =
	typeof, num, shl, shr, band, bor, xor, bnot, bswap, u8p, copy, cast, memcmp

assert(ffi.abi'le')

local mdbx = mdbx
local Db = mdbx_db
local Cur = mdbx_cursor

cdef[[
typedef int8_t   i8;
typedef int16_t  i16;
typedef int32_t  i32;
typedef int64_t  i64;
typedef uint8_t  bool8;
typedef uint8_t  u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef uint64_t u64;
typedef float    f32;
typedef double   f64;

typedef enum schema_col_type {
	schema_col_type_i8,
	schema_col_type_i16,
	schema_col_type_i32,
	schema_col_type_i64,
	schema_col_type_u8,
	schema_col_type_u16,
	schema_col_type_u32,
	schema_col_type_u64,
	schema_col_type_u32_le,
	schema_col_type_u64_le,
	schema_col_type_f32,
	schema_col_type_f64,
} schema_col_type;

typedef struct schema_col {
	int   len; // for varsize cols it means max len.
	bool8 fixed_size; // fixed size array (padded) or varsize.
	bool8 descending; // for key cols
	bool8 nullable; // for key cols
	u8    type; // schema_col_type
	u8    elem_size_shift; // computed
	bool8 fixed_offset; // computed: decides what the .offset field means
	int   offset; // computed: a static offset or the offset where the dyn. offset is.
} schema_col;

typedef struct schema_table {
	schema_col* key_cols;
	schema_col* val_cols;
	u16  n_key_cols;
	u16  n_val_cols;
	u8   dyn_offset_size; // 1,2,4
} schema_table;

int schema_val_is_null(schema_table* tbl, int col_i,
	const void* rec, int rec_size
);

int schema_get_key(schema_table* tbl, int col_i,
	const void* rec, int rec_size,
	u8* out, int out_size,
	const u8** pout,
	const u8** pp
);

int schema_get_val(schema_table* tbl, int col_i,
	const void* rec, int rec_size,
	const u8** pout
);

void schema_key_add(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, int val_len,
	u8** pp
);

void schema_val_add_start(schema_table* tbl,
	void* rec, int rec_buf_size,
	u8** pp
);

void schema_val_add(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, int val_len,
	u8** pp
);
]]

local col_ct = {
	utf8 = 'u8',
}

local schema_col_types = {
	i8     = C.schema_col_type_i8,
	i16    = C.schema_col_type_i16,
	i32    = C.schema_col_type_i32,
	i64    = C.schema_col_type_i64,
	u8     = C.schema_col_type_u8,
	u16    = C.schema_col_type_u16,
	u32    = C.schema_col_type_u32,
	u64    = C.schema_col_type_u64,
	f32    = C.schema_col_type_f32,
	f64    = C.schema_col_type_f64,
	utf8   = C.schema_col_type_u8,
}

local function encoded_maxlen(schema, f)
	local maxlen = f.maxlen
	if schema.is_index and maxlen
		and f.mdbx_type == 'utf8' and f.mdbx_collation == 'utf8_ai_ci'
	then
		return maxlen * 3
	end
	return maxlen
end

--fw. decl.
local cols_list
local encode_key
local encode_val
local decode_key
local decode_val
local decode_ix_col --decode one index col (key or val field) into a positional slot.

--schema processing ----------------------------------------------------------

--create an optimal physical column layout based on a table schema.
function Db:layout_table_schema(schema)

	if schema.layouted then return end
	schema.layouted = true

	local table_name = assert(schema.name)

	--index fields by name, typecheck, check for inconsistencies.
	for i,f in ipairs(schema.fields) do
		assertf(isstr(f.col) and #f.col > 0 and not f.col:find'[^a-z0-9_]',
			'invalid field name: %s.%s', table_name, f.col)
		assertf(not schema.fields[f.col],
			'duplicate field name: %s.%s', table_name, f.col)
		schema.fields[f.col] = f
		f.col_pos = i
		local elem_ct = col_ct[f.mdbx_type] or f.mdbx_type
		local ok, elem_ct = lua_pcall(ctype, elem_ct)
		assertf(ok, 'unknown type: %s for field: %s.%s', f.mdbx_type, table_name, f.col)
		f.elem_size = sizeof(elem_ct)
		assertf(f.elem_size < 2^8) --must fit 8 bit (see sort below)
	end

	--split fields into key_fields and val_fields.
	local key_fields = {}
	local val_fields = {}

	--parse pk and set f.descending.
	assertf(schema.pk, 'pk missing for table: %s', table_name)
	for i,col in ipairs(schema.pk) do
		local f = assertf(schema.fields[col],
			'pk col unknown: `%s` for table: %s', col, table_name)
		if not schema.is_index or not schema.dup_keys then
			assertf(f.not_null, 'key col must be not_null: %s.%s', table_name, col)
		end
		if f.maxlen and not f.padded then
			assertf(f.nozero, 'varsize key col must be nozero: %s.%s', table_name, col)
		end
		add(key_fields, f)
		f.key_index = #key_fields
		if schema.pk.desc then
			f.descending = schema.pk.desc[i]
		end
		if f.auto_increment then
			local f0 = schema.autoinc_field
			if f0 then
				assertf(false,
				'auto_increment on a second key field: %s (already on: %s)',
				f.col, f0.col)
			end
			schema.autoinc_field = f
		end
	end
	assertf(#key_fields > 0, 'table has no pk: %s', table_name)

	--build val fields array with all fields that are not in pk.
	for i,f in ipairs(schema.fields) do
		if not f.key_index then --not a key field
			add(val_fields, f)
		end
	end

	assert(#key_fields < 2^16)
	assert(#val_fields < 2^16)

	--move varsize fields at the end to minimize the size of the dyn offset table.
	--order fields by descending elem_size to maintain alignment.
	--order by field index to get stable sorting.
	sort(val_fields, function(f1, f2)
		--elem_size fits in 8 bit; field index fits in 16 bit; 8+16 = 24 bits,
		--so any bit from bit 25+ can be used for extra conditions.
		local i1 = (f1.maxlen and not f1.padded and 2^26 or 0) + (2^8-1 - f1.elem_size) * 2^16 + f1.col_pos
		local i2 = (f2.maxlen and not f2.padded and 2^26 or 0) + (2^8-1 - f2.elem_size) * 2^16 + f2.col_pos
		return i1 < i2
	end)
	for i,f in ipairs(val_fields) do
		f.val_index = i
	end

	schema.key_fields = key_fields
	schema.val_fields = val_fields

	--store u32 and u64 simple keys in little-endian and use fast comparator.
	if #key_fields == 1 then
		local f = key_fields[1]
		if f.not_null and not f.descending
			and (f.mdbx_type == 'u32' or f.mdbx_type == 'u64')
		then
			schema.int_key = f.mdbx_type
		end
	end

	--compute key and val column layout.
	for _,fields in ipairs{key_fields, val_fields} do

		local is_val = fields == val_fields
		local is_key = fields == key_fields

		--find the number of fixsize fields.
		local fixsize_n = #fields
		for i,f in ipairs(fields) do
			if f.maxlen and not f.padded then --first varsize field
				fixsize_n = i-1
				break
			end
		end

		--compute max row size, just the data (which is what it is for keys).
		local max_rec_size = 0
		for _,f in ipairs(fields) do
			local maxlen = encoded_maxlen(schema, f)
			maxlen = maxlen and maxlen + (f.padded and 0 or 1) or 1
			max_rec_size = max_rec_size + maxlen * f.elem_size
			if is_key and not f.not_null then
				max_rec_size = max_rec_size + 1
			end
		end

		if is_key then
			local db_max_key_size = self:max_key_size()
			assertf(max_rec_size <= db_max_key_size,
				'pk too big: %d bytes (max is %d bytes)',
					max_rec_size, db_max_key_size)
		end

		--compute dynamic offset table (d.o.t.) length for val records.
		--all val fields after the first varsize field are at a dyn offset.
		--key fields can't have an offset table instead we use \0 separator.
		local dot_len = is_val and max(0, #fields - fixsize_n - 1) or 0

		--compute the number of bytes needed to hold all the null bits.
		local nulls_size = is_val and ceil(#fields / 8) or 0

		--also compute d.o.t. size and update max_rec_size to include nulls and d.o.t.
		local dyn_offset_size = 0
		if is_val then
			max_rec_size = max_rec_size + nulls_size
			if max_rec_size + dot_len < 2^8 then
				dyn_offset_size = 1
			elseif max_rec_size + dot_len * 2 < 2^16 then
				dyn_offset_size = 2
			elseif max_rec_size + dot_len * 4 < 2^31 then
				dyn_offset_size = 4
			else
				assertf(false, 'value record too big for table %s: %.0f bytes',
					table_name, max_rec_size)
			end
			schema.dyn_offset_size = dyn_offset_size
			max_rec_size = max_rec_size + dot_len * dyn_offset_size
		end

		assertf(max_rec_size < 2^31,
			'record too big for table %s: %.0f bytes (max is 2GB-1)',
			max_rec_size, table_name)

		fields.max_rec_size = max_rec_size

		local cur_offset = nulls_size + dot_len * dyn_offset_size
		for kv_index,f in ipairs(fields) do
			--compute and set fixed offsets and dyn. offset offsets.
			f.fixed_offset = kv_index <= fixsize_n+1 or nil
			if f.fixed_offset then
				f.offset = cur_offset
			end
			if kv_index <= fixsize_n then --advance current offset while size is known.
				local maxlen = encoded_maxlen(schema, f) or 1
				if is_key and not f.not_null then
					cur_offset = cur_offset + 1
				end
				cur_offset = cur_offset + f.elem_size * maxlen
			end
			if is_val and not f.fixed_offset then
				local dot_index = kv_index - fixsize_n - 2 --field's index in d.o.t.
				assertf(dot_index >= 0 and dot_index < dot_len)
				f.offset = nulls_size + dot_index * dyn_offset_size
			end
		end

	end

	--create and layout index table schemas.
	if schema.ixs then
		schema.ix_schemas = {} --{schema1,...}
		for ix_name, ix in sortedpairs(schema.ixs) do
			local ix_schema = self:index_schema(schema, ix)
			self:layout_table_schema(ix_schema)
			add(schema.ix_schemas, ix_schema)
		end
	end
end

local S = function() end

--fold a utf8 string to its ai_ci collation key: NFD-decompose + casefold +
--stripmark, reencoded to utf8. lossy. returns (ptr, byte_len) into a reused
--buffer that holds int32 codepoints during decompose, then the utf8 bytes.
local ai_ci_buf = buffer(i32a)
local ai_ci_opt = bor(UTF8_DECOMPOSE, UTF8_CASEFOLD, UTF8_STRIPMARK)
local function encode_ai_ci(s, len)
	local out, cap = ai_ci_buf(len + 1) --floor guess; the global buffer only grows
	local n = num(utf8_decompose(s, len, out, cap, ai_ci_opt))
	if n < 0 then return nil, n end
	if n >= cap then --too small for the codepoints + utf8proc_reencode's nul terminator
		out, cap = ai_ci_buf(n + 1)
		n = utf8_decompose(s, len, out, cap, ai_ci_opt)
	end
	local sz = num(utf8_reencode(out, n, ai_ci_opt)) --in place: int32 cps -> utf8 bytes
	assertf(sz >= 0, 'utf8_ai_ci: reencode failed (%d)', sz)
	return out, sz
end

--create encoders and decoders for a layouted schema.
function Db:compile_table_schema(schema)

	if schema.compiled then return end
	schema.compiled = true

	self:layout_table_schema(schema)

	local key_fields = schema.key_fields
	local val_fields = schema.val_fields

	--default col lists for get, put, etc.
	schema.    cols = imap(schema.    fields, 'col')
	schema.key_cols = imap(schema.key_fields, 'col')
	schema.val_cols = imap(schema.val_fields, 'col')
	for i,col in ipairs(schema.    cols) do schema.    cols[col] = i end
	for i,col in ipairs(schema.key_cols) do schema.key_cols[col] = i end
	for i,col in ipairs(schema.val_cols) do schema.val_cols[col] = i end

	schema.    cols[S] = cat(schema.    cols, ',')
	schema.key_cols[S] = cat(schema.key_cols, ',')
	schema.val_cols[S] = cat(schema.val_cols, ',')

	--generate direct key record decoders and encoders for u32/u64 keys
	--stored in little endian.
	if schema.int_key then
		local f = key_fields[1]
		local elem_size = f.elem_size
		local elemp_ct = elem_size == 4 and u32p or u64p
		function schema.encode_int_key(rec, rec_buf_sz, val)
			assert(rec_buf_sz >= elem_size)
			cast(elemp_ct, rec)[0] = val
			return elem_size
		end
		function schema.decode_int_key(rec, rec_sz)
			assert(rec_sz == elem_size)
			return cast(elemp_ct, rec)[0]
		end
	end

	--allocate the C schema.
	local st = new'schema_table'
	local sc_key_cols = new('schema_col[?]', #key_fields)
	local sc_val_cols = new('schema_col[?]', #val_fields)
	st.key_cols = sc_key_cols
	st.val_cols = sc_val_cols
	st.n_key_cols = #key_fields
	st.n_val_cols = #val_fields
	st.dyn_offset_size = schema.dyn_offset_size
	--anchor these so they don't get collected
	key_fields._sc = sc_key_cols
	val_fields._sc = sc_val_cols
	schema._st = st

	local int_schema_col_type = schema.int_key and (
			schema.int_key == 'u32' and C.schema_col_type_u32_le or
			schema.int_key == 'u64' and C.schema_col_type_u64_le
		)

	--setup C schema and create field getters and setters.
	for _,fields in ipairs{key_fields, val_fields} do

		local is_key = fields == key_fields

		for kv_index,f in ipairs(fields) do

			--setup C schema.
			local sc = fields._sc[kv_index-1]
			sc.type = is_key and int_schema_col_type or schema_col_types[f.mdbx_type]
			sc.len = encoded_maxlen(schema, f) or 1
			sc.fixed_size = f.maxlen and not f.padded and 0 or 1
			sc.descending = f.descending and 1 or 0
			sc.nullable = f.not_null and 0 or 1
			sc.elem_size_shift = log2(f.elem_size)
			sc.fixed_offset = f.fixed_offset and 1 or 0
			sc.offset = f.offset or 0

			--create field getters and setters.
			local elem_ct = col_ct[f.mdbx_type] or f.mdbx_type
			local elemp_ct = ctype(elem_ct..'*')
			local elem_size = f.elem_size
			if f.maxlen then --array
				local maxlen = f.maxlen
				local nozero = f.nozero
				if schema.is_index and is_key
					and f.mdbx_collation == 'utf8_ai_ci'
				then
					local physical_maxlen = encoded_maxlen(schema, f)
					function f.encode(db, event, buf, val)
						assertf(typeof(val) == 'string')
						local len = #val
						if len > maxlen then
							db:check_col(event, schema.name, f.col, false, 'too_long')
						end
						local p, len = encode_ai_ci(val, len)
						if not p then
							db:check_col(event, schema.name, f.col, false,
								fmt('utf8_ai_ci: invalid utf8 (%d)', len))
						end
						assert(len <= physical_maxlen)
						if nozero and val:find('\0', 1, true) then
							db:check_col(event, schema.name, f.col, false, 'zero')
						end
						copy(buf, p, len)
						return len
					end
					function f.decode(p, len)
						return str(p, len)
					end
				elseif f.mdbx_type == 'utf8' then --raw utf8 strings
					function f.encode(db, event, buf, val)
						assertf(typeof(val) == 'string')
						local len = #val
						if len > maxlen then
							db:check_col(event, schema.name, f.col, false, 'too_long')
						end
						if nozero and val:find('\0', 1, true) then
							db:check_col(event, schema.name, f.col, false, 'zero')
						end
						copy(buf, val, len)
						return len
					end
					function f.decode(p, len)
						return str(p, len)
					end
				else --array
					function f.encode(db, event, buf, val)
						assertf(typeof(val) == 'table')
						local len = #val
						if len > maxlen then
							db:check_col(event, schema.name, f.col, false, 'too_long')
						end
						local buf = cast(elemp_ct, buf)
						for i = 1, len do
							local v = val[i]
							if nozero and v == 0 then
								db:check_col(event, schema.name, f.col, false, 'zero')
							end
							buf[i-1] = v
						end
						return len
					end
					function f.decode(p, len)
						local p = cast(elemp_ct, p)
						local t = {}
						for i = 1, len do
							t[i] = p[i-1]
						end
						return t
					end
				end
			else --scalar
				function f.encode(db, event, buf, val)
					cast(elemp_ct, buf)[0] = val
					return 1
				end
				function f.decode(p)
					return cast(elemp_ct, p)[0]
				end
			end

		end --for f in fields

	end --for fields in key_fields, val_fields

	if schema.is_index then
		self:compile_index_schema(schema)
	end

end

function Db:save_table_schema(schema)
	assert(schema.layouted)
	--NOTE: only saving enough information to read the data back in absence of
	--a paper schema, and to validate a paper schema against the used layout.
	local t = {
		format = 1, --layout format (the only one we have, implemented here)
		dyn_offset_size = schema.dyn_offset_size,
		int_key = schema.int_key,
		key_fields = {max_rec_size = schema.key_fields.max_rec_size},
		val_fields = {max_rec_size = schema.val_fields.max_rec_size},
		dup_keys = schema.dup_keys,
		is_index = schema.is_index,
		val_table = schema.is_index and schema.val_schema.name,
	}
	for i=1,2 do
		local is_key = i == 1
		local is_val = i == 2
		local F = is_key and 'key_fields' or 'val_fields'
		for i,f in ipairs(schema[F]) do
			t[F][i] = {
				col = f.col,
				col_pos = f.col_pos, --in original schema fields array
				mdbx_type = f.mdbx_type,
				maxlen = f.maxlen,
				padded = f.padded,
				nozero = f.nozero,
				not_null = f.not_null,
				mdbx_default = f.mdbx_default,
				auto_increment = f.auto_increment,
				--computed attributes
				elem_size = f.elem_size, --for validating custom types in the future.
				descending = f.descending,
				mdbx_collation = f.mdbx_collation,
				fixed_offset = f.fixed_offset, --what offset means.
				offset = f.offset, --null for varsize keys
			}
		end
	end
	if schema.ixs then
		t.ixs = {}
		--we don't need to save the index defs for schema loading but we need
		--them for schema diff'ing.
		for ix_name, ix in pairs(schema.ixs) do
			t.ixs[ix_name] = extend({
				is_unique = ix.is_unique,
				desc = ix.desc and imap(ix.desc),
			}, ix)
		end
	end
	if schema.fks then
		t.fks = {}
		for fk_name, fk in pairs(schema.fks) do
			t.fks[fk_name] = {
				name = fk.name,
				cols = imap(fk.cols),
				ref_table = fk.ref_table,
				ref_cols = imap(fk.ref_cols),
				ondelete = fk.ondelete,
				ix = fk.ix,
			}
		end
	end
	if schema.ref_fks then --reverse refs (parent side): {key -> {table, fk}}.
		t.ref_fks = {}
		for k, ref in pairs(schema.ref_fks) do
			t.ref_fks[k] = {table = ref.table, fk = ref.fk}
		end
	end
	local k = schema.name
	local v = pp(t, false)
	if not self:table_exists'$schema' then
		self:create_table_raw'$schema'
	end
	assert(self:try_put_raw('$schema', k, #k, v, #v))
end

function Db:load_table_schema(table_name)
	if table_name == '$schema' then return end
	if not self:table_exists'$schema' then return end
	local k = table_name
	local ok, v, v_len = self:get_raw('$schema', k, #k)
	if not ok then return end
	local schema = eval(str(v, v_len))
	--reconstruct schema from stored table schema.
	assertf(schema.format == 1,
		'unknown schema format for table %s: %s', table_name, schema.format)
	schema.name = table_name
	schema.fields = {}
	for i,f in ipairs(schema.key_fields) do
		schema.fields[f.col_pos] = f
		schema.fields[f.col] = f
		f.key_index = i
		if f.auto_increment then schema.autoinc_field = f end
	end
	for i,f in ipairs(schema.val_fields) do
		schema.fields[f.col_pos] = f
		schema.fields[f.col] = f
		f.val_index = i
	end
	schema.pk = imap(schema.key_fields, 'col')
	schema.pk.desc = imap(schema.key_fields, 'descending')
	schema.layouted = true --layouted but not compiled
	if schema.ixs or schema.fks then
		schema.ix_schemas = {} --live ix list from both
	end
	if schema.ixs then
		for ix_name in sortedpairs(schema.ixs) do
			local ix_schema = assertf(self:load_table_schema(ix_name),
					'schema missing for table: %s ', ix_name)
			ix_schema.val_schema = schema
			add(schema.ix_schemas, ix_schema)
		end
	end
	if schema.fks then --child table: re-attach fk-enforcement indexes to ix_schemas.
		for _, fk in pairs(schema.fks) do
			fk.table = table_name
			--an fk-owned index isn't in `ixs`; attach it to ix_schemas (the live,
			--maintained list) unless a user index or another fk already added it.
			if fk.ix and not (schema.ixs and schema.ixs[fk.ix]) then
				local present
				for _, ix_schema in ipairs(schema.ix_schemas) do
					if ix_schema.name == fk.ix then present = true; break end
				end
				if not present then
					local ix_schema = assertf(self:load_table_schema(fk.ix),
						'schema missing for fk index: %s', fk.ix)
					ix_schema.val_schema = schema
					binsearch_insert(schema.ix_schemas, ix_schema, function(t, i, s)
						return t[i].name < s.name
					end)
				end
			end
		end
	end
	return schema
end

function Db:drop_table_schema(table_name)
	assert(self:try_del_raw('$schema', table_name, #table_name))
end

local function cmp_keys(pt, st, keys, errs, ...)
	for _,k in ipairs(keys) do
		local pv = pt[k]
		local sv = st[k]
		if pv ~= sv then
			add(errs, fmt('%s.%s mismatch: expected: %s, got: %s', fmt(...), k, pv, sv))
		end
	end
end
local function cmp_map_str_keys(pt, st, errs, ...)
	for k,v in pairs(pt) do
		if isstr(k) and st[k] == nil then
			add(errs, fmt('%s.%s is missing', fmt(...), k))
		end
	end
	for k,v in pairs(st) do
		if isstr(k) and pt[k] == nil then
			add(errs, fmt('%s.%s is unknown', fmt(...), k))
		end
	end
end
function Db:try_validate_table_schema(stored_schema, paper_schema)

	local errs = {}
	local table_name = paper_schema.name or stored_schema.name

	--compare table attributes
	cmp_keys(paper_schema, stored_schema, {
		'dyn_offset_size', 'int_key', 'dup_keys', 'is_index', 'val_table',
	}, errs, '%s', table_name)

	--compare field lists
	local pfields =  paper_schema.fields
	local sfields = stored_schema.fields
	cmp_map_str_keys(pfields, sfields, errs, '%s.%s', table_name, 'fields')
	for k, pf in pairs(pfields) do
		local sf = isstr(k) and sfields[k]
		if sf then
			cmp_keys(pf, sf, {
				'key_index', 'val_index',
				'col', 'col_pos', 'mdbx_type', 'maxlen', 'padded', 'nozero', 'not_null',
				'elem_size', 'descending', 'mdbx_collation',
				'fixed_offset', 'offset',
			}, errs, '%s.%s.%s', table_name, 'fields', k)
		end
	end

	--compare index lists.
	--only comparing index names since they describe the index fully.
	if #errs == 0 then
		local pixs = paper_schema.ixs
		local sixs = stored_schema.ixs
		if pixs or sixs then
			cmp_map_str_keys(
				pixs or empty,
				sixs or empty,
				errs, '%s.%s', table_name, 'ixs')
		end
	end

	if #errs > 0 then
		return false, fmt('schema mismatch for table: %s:\n\t%s',
			table_name, cat(errs, '\n\t'))
	end

	return true
end
function Db:validate_table_schema(stored_schema, paper_schema)
	local table_name = paper_schema.name or stored_schema.name
	local ok, err = self:try_validate_table_schema(stored_schema, paper_schema)
	self:check_schema('t_open', table_name, nil, ok, err)
end

local function table_flags(schema)
	if not schema then return 0 end
	return bor(
		schema.int_key and mdbx.MDBX_INTEGERKEY or 0,
		schema.dup_keys and mdbx.MDBX_DUPSORT or 0
	)
end
local typeof, assert = typeof, assert
function Db:try_dbi(tab)
	if typeof(tab) == 'number' then return tab end --tab=dbi
	local dbi = self.dbis[tab]
	if dbi then return dbi end
	local name = self:table_name(tab)
	local schema = self.live_schema[name]
	if not schema then
		local paper_schema = self.schema.tables[name]
		local stored_schema = self:load_table_schema(name)
		if paper_schema and stored_schema then --schemas must match exactly
			self:validate_table_schema(stored_schema, paper_schema)
		elseif paper_schema then --raw table
			self:check_schema('t_open', name, nil, false,
				'trying to open a raw table with a schema')
		elseif stored_schema then --lost paper schema
			paper_schema = stored_schema
		end
		schema = paper_schema
		if schema then
			schema.name = name
			self:compile_table_schema(schema)
		end
	end
	local dbi, err = self:try_dbi_raw(tab, table_flags(schema))
	if not dbi then return nil, err end
	if schema then
		--open indexes now just to check for errors.
		for _,ix_schema in ipairs(schema.ix_schemas or empty) do
			self:dbi(ix_schema.name)
		end
	end
	self.live_schema[name] = schema or true
	return dbi
end
function Db:dbi(tab)
	local dbi, err = self:try_dbi(tab)
	return self:check_schema('t_open', self:table_name(tab), nil, dbi, err)
end
function Db:dbi_schema(tab)
	local dbi = self:dbi(tab)
	return dbi, self.live_schema[self:table_name(tab)]
end

function Db:without_schema(fn)
	if self._in_without_schema then
		fn()
		return
	end
	local real_live_schema = self.live_schema
	local real_schema = self.schema
	self.live_schema = {}
	self.schema = {tables = {}}
	self._in_without_schema = true
	local ok, err = pcall(fn)
	self._in_without_schema = false
	for k in pairs(self.live_schema) do --invalidate changed before restoring.
		real_live_schema[k] = nil
	end
	self.schema = real_schema
	self.live_schema = real_live_schema
	assert(ok, err)
end

function Db:create_table(name, schema)
	assert(schema)
	assert(not schema.ixs)
	assert(not schema.fks)
	assert(not self.schema.tables[name])
	self:compile_table_schema(schema)
	local dbi = self:create_table_raw(name, table_flags(schema))
	self:save_table_schema(schema)
	local schema = self:load_table_schema(name)
	self:compile_table_schema(schema)
	self.live_schema[name] = schema
	return dbi
end

function Db:drop_table(tab)
	local name = self:table_name(tab)
	assert(not self.schema.tables[name])
	self:drop_table_raw(name)
	local schema = self.live_schema[name]
	if not schema then return end
	--as a child: drop the reverse refs our fks hold on their parents.
	if schema.fks then
		for _, fk in pairs(schema.fks) do
			local _, ref_schema = self:dbi_schema(fk.ref_table)
			if ref_schema and ref_schema.ref_fks then
				ref_schema.ref_fks[name..'/'..fk.name] = nil
				self:save_table_schema(ref_schema)
			end
		end
	end
	--as a parent: untangle children referencing us (drop their fks, keep them).
	if schema.ref_fks then
		for _, ref in pairs(schema.ref_fks) do
			local _, child_schema = self:dbi_schema(ref.table)
			local cfk = child_schema and child_schema.fks and child_schema.fks[ref.fk]
			if cfk then self:detach_fk(child_schema, cfk) end
		end
	end
	for _,ix_schema in ipairs(schema.ix_schemas or empty) do
		self:drop_table(ix_schema.name)
	end
	self:drop_table_schema(name)
	self.live_schema[name] = nil
	return true
end

--rename an index table to new_ix: rename the dbi, move its $schema row, and fix
--its back-references (name, val_table) and the val_schema.ixs map. val_table is
--taken from val_schema.name, so this works both when the table itself was renamed
--(name already updated) and when only the index names change (column rename).
local function rename_index(self, val_schema, ix_schema, new_ix)
	local old_ix = ix_schema.name
	self:rename_table_raw(old_ix, new_ix)
	self:drop_table_schema(old_ix)
	ix_schema.name = new_ix
	ix_schema.val_table = val_schema.name
	self:save_table_schema(ix_schema)
	if val_schema.ixs and val_schema.ixs[old_ix] ~= nil then --user index: rekey ixs.
		val_schema.ixs[new_ix] = val_schema.ixs[old_ix]
		val_schema.ixs[old_ix] = nil
	end --fk-owned indexes aren't in `ixs`; only their ix_schema.name (set above).
end
function Db:rename_table(tab, new_name)
	local old_name = self:table_name(tab)
	assert(not self.schema.tables[old_name])
	assert(not self.schema.tables[new_name])
	self:rename_table_raw(old_name, new_name)
	local schema = self.live_schema[old_name]
	if not schema then return end
	schema.name = new_name --set first: rename_index derives val_table from it
	--index table names embed the table name (tbl/u-or-i/cols), so rename each.
	for _, ix_schema in ipairs(schema.ix_schemas or empty) do
		rename_index(self, schema, ix_schema,
			new_name .. ix_schema.name:sub(#old_name + 1))
	end
	--fk references embed table names; fix them after the index rename above.
	if schema.fks then --as a child: its fk.table/fk.ix and each parent's reverse ref.
		for _, fk in pairs(schema.fks) do
			fk.table = new_name
			fk.ix = new_name .. fk.ix:sub(#old_name + 1) --index moved with us
			local self_ref = fk.ref_table == old_name
			if self_ref then fk.ref_table = new_name end
			local ref_schema = self_ref and schema
				or select(2, self:dbi_schema(fk.ref_table))
			if ref_schema and ref_schema.ref_fks then
				ref_schema.ref_fks[old_name..'/'..fk.name] = nil
				ref_schema.ref_fks[new_name..'/'..fk.name] =
					{table = new_name, fk = fk.name}
				if not self_ref then self:save_table_schema(ref_schema) end
			end
		end
	end
	if schema.ref_fks then --as a parent: each referencing child points back to us.
		for _, ref in pairs(schema.ref_fks) do
			if ref.table ~= new_name then --self-refs handled in the fks loop
				local _, child_schema = self:dbi_schema(ref.table)
				local cfk = child_schema and child_schema.fks
					and child_schema.fks[ref.fk]
				if cfk then
					cfk.ref_table = new_name
					self:save_table_schema(child_schema)
				end
			end
		end
	end
	self:drop_table_schema(old_name)
	self:save_table_schema(schema)
end

--indexes --------------------------------------------------------------------

local ix1_key_rec_buffer = buffer()
local ix2_key_rec_buffer = buffer()
local ix_val_rec_buffer = buffer()
local ix_pk_col_buf = buffer()

local function ix_cols(cols)
	local t = {}
	for i,col in ipairs(cols) do
		t[i] = cols.desc and cols.desc[i] and col..':desc' or col
	end
	return t
end
local function format_ix_name(tbl_name, cols, unique)
	return _('%s/%s/%s', tbl_name, unique and 'u' or 'i', cat(ix_cols(cols), '-'))
end

function Db:index_schema(val_schema, cols)
	local ix_name = format_ix_name(val_schema.name, cols, cols.is_unique)
	local ix_fields = {}
	for _,col in ipairs(cols) do
		local f = assertf(val_schema.fields[col],
			'index: %s unknown field %s.%s', ix_name, val_schema.name, col)
		if cols.is_unique then
			assertf(f.not_null, 'unique index %s col must be not_null: %s.%s',
				ix_name, val_schema.name, col)
		end
		local f = {
			col = f.col,
			mdbx_type = f.mdbx_type,
			maxlen = f.maxlen,
			padded = f.padded,
			nozero = f.nozero,
			not_null = f.not_null,
			mdbx_collation = f.mdbx_collation,
		}
		add(ix_fields, f)
	end
	local ix_schema = {
		name = ix_name,
		fields = ix_fields,
		pk = cols,
		dup_keys = not cols.is_unique or nil,
		is_index = true,
		val_table = val_schema.name,
		val_schema = val_schema,
	}
	return ix_schema
end

function Db:compile_index_schema(ix_schema)

	assert(ix_schema.is_index)

	local val_table = assert(ix_schema.val_table)
	local val_schema = assert(ix_schema.val_schema)

	local cols = cols_list(cat(ix_schema.pk, ' '))
	local dt = {}

	--default val_cols for index tables are the val_cols of the val_table.
	ix_schema.val_cols = val_schema.val_cols

	--an index col may be a pk col of the val_table (e.g. composite-pk fk). for the
	--common val-only case, decode_val handles everything. for the mixed case, decode
	--each col individually into the right positional slot (dt[i] for cols[i]):
	--val cols via schema_get_val, pk cols via schema_get_key with pp=nil (random
	--access mode -- skips the sequential-scan optimisation, but avoids a separate
	--buffer and stays with the cheap integer-keyed dt arrays throughout).
	local has_pk_col = false
	for _, col in ipairs(cols) do
		if val_schema.fields[col].key_index then has_pk_col = true; break end
	end
	local function decode_ix_into(k, k_sz, v, v_sz, out_dt)
		if not has_pk_col then
			decode_val(val_schema, v, v_sz, out_dt, cols, '[]')
			return
		end
		local kb, kb_sz = ix_pk_col_buf(val_schema.key_fields.max_rec_size)
		for i, col in ipairs(cols) do
			out_dt[i] = decode_ix_col(val_schema, val_schema.fields[col],
				k, k_sz, v, v_sz, kb, kb_sz)
		end
	end
	local dt0 = {}

	--create index methods

	function ix_schema.try_create(ix_schema, self, event)
		local ix_dbi = self:create_table(ix_schema.name, ix_schema)
		local xk, xk_buf_sz = ix1_key_rec_buffer(ix_schema.key_fields.max_rec_size)
		local xv, xv_buf_sz = ix_val_rec_buffer(val_schema.key_fields.max_rec_size)
		for cur, k, k_sz, v, v_sz in self:each_raw(val_table) do
			decode_ix_into(k, k_sz, v, v_sz, dt)
			local xk_sz = encode_key(self, ix_schema, event, nil,
				xk, xk_buf_sz, cols, '[]', dt)
			assert(k_sz <= xv_buf_sz, k_sz)
			copy(xv, k, k_sz)
			local ok
			if ix_schema.dup_keys then --non-unique: allow duplicate index keys.
				ok = self:try_put_raw(ix_dbi, xk, xk_sz, xv, k_sz)
			else --unique: a duplicate index key is a violation.
				ok = self:try_insert_raw(ix_dbi, xk, xk_sz, xv, k_sz)
			end
			if not ok then
				return false, 'duplicate_key'
			end
		end
		return true
	end

	function ix_schema.update(ix_schema, self, k, k_sz, v, v_sz, v0, v0_sz)

		local ix_dbi = self:dbi(ix_schema.name) --live name: survives rename
		local dup = ix_schema.dup_keys

		--[[ cases to cover:
		      record       index
         ----------------------
				A -> X       X -> A  existing record and associated index key
			----------------------
			~  A -> X       X -> A  record updated but index key didn't change (do nothing)
			~  A -> Y    -  X -> A  record updated: remove old index
			             +  Y -> A  and add new index
			+  B -> X    x  X -> B  record inserted: unique key violation
			+  B -> Y    +  Y -> B  record inserted: add index
		]]

		--derive index key from v (key cols come from k, val cols from v)
		local xk, xk_buf_sz = ix1_key_rec_buffer(ix_schema.key_fields.max_rec_size)
		decode_ix_into(k, k_sz, v, v_sz, dt)
		local xk_sz = encode_key(self, ix_schema, 'i_update', nil, xk, xk_buf_sz, cols, '[]', dt)
		clear(dt)

		if v0 then --record updated: remove the old index record

			--derive old index key from v0 (pk k is unchanged; only the val record differs).
			local xk0, xk0_buf_sz = ix2_key_rec_buffer(ix_schema.key_fields.max_rec_size)
			decode_ix_into(k, k_sz, v0, v0_sz, dt0)
			local xk0_sz = encode_key(self, ix_schema, 'i_update', nil, xk0, xk0_buf_sz, cols, '[]', dt0)
			clear(dt0)

			--abort if index key didn't change
			if xk_sz == xk0_sz and memcmp(xk, xk0, xk_sz) == 0 then
				return true
			end

			if dup then --remove the exact (old key, pk) pair from the dupsort index.
				assert(self:try_del_raw(ix_dbi, xk0, xk0_sz, k, k_sz))
			else --remove the unique key.
				assert(self:try_del_raw(ix_dbi, xk0, xk0_sz))
			end
		end

		if dup then --add the (key, pk) pair (duplicates allowed).
			return self:try_put_raw(ix_dbi, xk, xk_sz, k, k_sz)
		else --add the unique key; an existing key is a unique violation.
			return self:try_insert_raw(ix_dbi, xk, xk_sz, k, k_sz)
		end
	end

	function ix_schema.del(ix_schema, self, k, k_sz, v0, v0_sz)
		local ix_dbi = self:dbi(ix_schema.name)
		local xk0, xk0_buf_sz = ix2_key_rec_buffer(ix_schema.key_fields.max_rec_size)
		decode_ix_into(k, k_sz, v0, v0_sz, dt0)
		local xk0_sz = encode_key(self, ix_schema, 'i_del', nil, xk0, xk0_buf_sz, cols, '[]', dt0)
		clear(dt0)
		if ix_schema.dup_keys then --remove the exact (key, pk) pair.
			assert(self:try_del_raw(ix_dbi, xk0, xk0_sz, k, k_sz))
		else --remove the unique key.
			assert(self:try_del_raw(ix_dbi, xk0, xk0_sz))
		end
	end

end

--create the index table, populate it from existing rows, and attach it to the
--live ix_schemas list. shared by add_index (user index, also registered in
--`ixs`) and add_fk (fk-enforcement index, not in `ixs`).
local function build_index(self, event, val_schema, ix_schema)
	self:compile_table_schema(ix_schema)
	local op = {type = 'schema', event = event, table = val_schema.name}
	local ok, err = ix_schema:try_create(self, op)
	self:check_schema(event, val_schema.name, nil, ok, err)
	binsearch_insert(attr(val_schema, 'ix_schemas'), ix_schema, function(t, i, s)
		return t[i].name < s.name
	end)
	self:save_table_schema(val_schema)
end

function Db:add_index(val_table, ix)
	local val_dbi, val_schema = self:dbi_schema(val_table)
	self:check_schema('i_add', self:table_name(val_table), nil,
		val_dbi, 'not_found')
	local ix_name = format_ix_name(val_schema.name, ix, ix.is_unique)
	self:check_schema('i_add', val_schema.name, nil, #ix > 0,
		'index has no columns: %s', ix_name)
	local seen = {}
	local max_rec_size = 0
	for _, col in ipairs(ix) do
		local f = val_schema.fields[col]
		self:check_schema('i_add', val_schema.name, col, f,
			'index: %s unknown field %s.%s', ix_name, val_schema.name, col)
		self:check_schema('i_add', val_schema.name, col, not seen[col],
			'duplicate index field: %s.%s', val_schema.name, col)
		seen[col] = true
		if ix.is_unique then
			self:check_schema('i_add', val_schema.name, col, f.not_null,
				'unique index %s col must be not_null: %s.%s',
				ix_name, val_schema.name, col)
		end
		if f.maxlen and not f.padded then
			self:check_schema('i_add', val_schema.name, col, f.nozero,
				'varsize key col must be nozero: %s.%s', val_schema.name, col)
		end
		local maxlen = f.maxlen
		if maxlen and f.mdbx_type == 'utf8'
			and f.mdbx_collation == 'utf8_ai_ci'
		then
			maxlen = maxlen * 3
		end
		maxlen = maxlen and maxlen + (f.padded and 0 or 1) or 1
		max_rec_size = max_rec_size + maxlen * f.elem_size
			+ (not ix.is_unique and not f.not_null and 1 or 0)
	end
	local db_max_key_size = self:max_key_size()
	self:check_schema('i_add', val_schema.name, nil,
		max_rec_size <= db_max_key_size,
		'pk too big: %d bytes (max is %d bytes)',
		max_rec_size, db_max_key_size)
	local ix_schema = self:index_schema(val_schema, ix)
	self:check_schema('i_add', val_schema.name, nil,
		not (val_schema.ixs and val_schema.ixs[ix_schema.name]),
		'index exists: %s', ix_schema.name)
	attr(val_schema, 'ixs')[ix_schema.name] = ix
	build_index(self, 'i_add', val_schema, ix_schema)
	return true, nil, ix_schema.name
end

--drop an index table and detach it from the live ix_schemas list, but only when
--nothing references it anymore: an index lives as long as it's in `ixs` (user-
--declared) or some fk uses it (fk.ix == name).
local function release_index_if_unreferenced(self, schema, ix_name)
	if schema.ixs and schema.ixs[ix_name] then return end
	if schema.fks then
		for _, fk in pairs(schema.fks) do
			if fk.ix == ix_name then return end
		end
	end
	local ix_i
	for i, ix_schema in ipairs(schema.ix_schemas or empty) do
		if ix_schema.name == ix_name then
			ix_i = i
			break
		end
	end
	assert(self:drop_table(ix_name))
	if ix_i then
		remove(schema.ix_schemas, ix_i)
		if #schema.ix_schemas == 0 then schema.ix_schemas = nil end
	end
end

function Db:drop_index(ix_name)
	local val_table = assert(ix_name:match'^[^/]+')
	local val_dbi, val_schema = self:dbi_schema(val_table)
	self:check_schema('i_drop', val_table, nil, val_dbi, 'not_found')
	self:check_schema('i_drop', val_table, nil,
		val_schema.ixs and val_schema.ixs[ix_name],
		'index not found: %s', ix_name)
	val_schema.ixs[ix_name] = nil
	--keep the index table + ix_schemas entry if a fk still uses it (now fk-owned).
	release_index_if_unreferenced(self, val_schema, ix_name)
	self:save_table_schema(val_schema)
	return true
end

--rename a column. encoding is positional (col_pos + offsets), so no row or index
--data is rewritten; this only updates names: the field, the pk, the dependent
--index/fk-index tables (whose names embed the column), the fks that use the
--column, and the (descriptive) ref_cols of children when a pk column is renamed.
local function rename_in_list(list, old, new) --returns true if `old` was present
	for i = 1, #list do
		if list[i] == old then list[i] = new; return true end
	end
end
function Db:rename_column(tab, old_col, new_col)
	local dbi, schema = self:dbi_schema(tab)
	local table_name = self:table_name(tab)
	self:check_schema('c_rename', table_name, old_col, dbi, 'not_found')
	local f = schema.fields[old_col]
	self:check_schema('c_rename', schema.name, old_col, f, 'not_found')
	self:check_schema('c_rename', schema.name, new_col,
		isstr(new_col) and #new_col > 0 and not new_col:find'[^a-z0-9_]',
		'invalid field name: %s.%s', schema.name, new_col)
	self:check_schema('c_rename', schema.name, new_col,
		not schema.fields[new_col], 'column exists: %s.%s', schema.name, new_col)
	local in_pk = schema.pk and rename_in_list(schema.pk, old_col, new_col)
	f.col = new_col
	schema.fields[new_col] = f
	schema.fields[old_col] = nil
	--indexes containing the column: their names embed it, so rename the tables.
	local renamed_ix = {} --old index name -> new index name (for fk.ix fixup)
	for _, ix in ipairs(schema.ix_schemas or empty) do
		if rename_in_list(ix.pk, old_col, new_col) then
			local xf = ix.fields[old_col] --the index's own field copy
			if xf then
				xf.col = new_col
				ix.fields[new_col] = xf
				ix.fields[old_col] = nil
			end
			local old_ix = ix.name
			local new_ix = format_ix_name(schema.name, ix.pk, not ix.dup_keys)
			local ix_def = schema.ixs and schema.ixs[old_ix]
			if ix_def and ix_def ~= ix.pk then
				assert(rename_in_list(ix_def, old_col, new_col))
			end
			rename_index(self, schema, ix, new_ix)
			renamed_ix[old_ix] = new_ix
		end
	end
	--fks using the column (child side): update cols and the fk index name.
	if schema.fks then
		for _, fk in pairs(schema.fks) do
			rename_in_list(fk.cols, old_col, new_col)
			fk.ix = renamed_ix[fk.ix] or fk.ix
		end
	end
	--this table is a parent and a pk column changed: fix children's ref_cols.
	if in_pk and schema.ref_fks then
		for _, ref in pairs(schema.ref_fks) do
			local _, child = self:dbi_schema(ref.table)
			local cfk = child and child.fks and child.fks[ref.fk]
			if cfk and cfk.ref_cols and rename_in_list(cfk.ref_cols, old_col, new_col) then
				self:save_table_schema(child)
			end
		end
	end
	--rebuild name-derived state (col lists, C schema): the table first, then every
	--index, since each index's val_cols references the table's (now rebuilt) list.
	schema.compiled = nil
	self:compile_table_schema(schema)
	for _, ix in ipairs(schema.ix_schemas or empty) do
		ix.compiled = nil
		self:compile_table_schema(ix)
	end
	self:save_table_schema(schema)
	return true
end

--foreign keys ---------------------------------------------------------------

--register a foreign key (child.cols -> ref_table.pk) on the child table.
--fk shape is schema.lua's: {name, table, cols, ref_table, ref_cols, ondelete}.
local add_fk_key_buffer = buffer()
--check that existing rows satisfy the fk: every child row whose fk cols are all
--non-null must reference an existing parent row (MATCH SIMPLE: a row with any
--null fk col is skipped). mirrors how add_index validates existing data.
local function check_existing_fk(self, event, schema, fk)
	local ref_dbi, ref_schema = self:dbi_schema(fk.ref_table)
	local n = #fk.cols
	for cur, rec in self:each(fk.table, '{}') do
		local skip = false
		local vals = {}
		for i = 1, n do
			local v = rec[fk.cols[i]]
			if v == nil or v == null then skip = true; break end
			vals[i] = v
		end
		if not skip then
			local pk, pk_buf_sz = add_fk_key_buffer(ref_schema.key_fields.max_rec_size)
			local pk_sz = encode_key(self, ref_schema, event, nil, pk, pk_buf_sz,
				ref_schema.key_cols, nil, unpack(vals, 1, n))
			if not self:get_raw(ref_dbi, pk, pk_sz) then
				cur:close()
				return false, fmt('fk %s: existing row references missing %s',
					fk.name, fk.ref_table)
			end
		end
	end
	return true
end
function Db:add_fk(fk)
	local event = {type = 'schema', event = 'fk_add', table = fk.table}
	local dbi, schema = self:dbi_schema(fk.table)
	self:check_schema('fk_add', fk.table, nil, dbi,
		'fk %s: table missing: %s', fk.name, fk.table)
	self:check_schema('fk_add', fk.table, nil,
		not (schema.fks and schema.fks[fk.name]),
		'fk already exists: %s', fk.name)
	self:check_schema('fk_add', fk.table, nil, fk.cols and #fk.cols > 0,
		'fk %s: no columns', fk.name)
	local ref_dbi, ref_schema = self:dbi_schema(fk.ref_table)
	self:check_schema('fk_add', fk.table, nil, ref_dbi,
		'fk %s: ref table missing: %s', fk.name, fk.ref_table)
	self:check_schema('fk_add', fk.table, nil,
		fk.ref_cols and #fk.cols == #fk.ref_cols and #fk.ref_cols == #ref_schema.pk,
		'fk %s: column count mismatch', fk.name)
	self:check_schema('fk_add', fk.table, nil,
		fk.ondelete == nil or fk.ondelete == 'cascade' or fk.ondelete == 'set null',
		'fk %s: invalid ondelete: %s', fk.name, fk.ondelete)
	local seen = {}
	for i, col in ipairs(fk.cols) do
		local f = schema.fields[col]
		self:check_schema('fk_add', fk.table, col, f,
			'fk %s: unknown column: %s.%s', fk.name, fk.table, col)
		self:check_schema('fk_add', fk.table, col, not seen[col],
			'fk %s: duplicate column: %s.%s', fk.name, fk.table, col)
		seen[col] = true
		local ref_col = fk.ref_cols[i]
		self:check_schema('fk_add', fk.table, col, ref_col == ref_schema.pk[i],
			'fk %s: ref column must be pk column %s.%s', fk.name, fk.ref_table, ref_schema.pk[i])
		local ref_f = ref_schema.fields[ref_col]
		for _, k in ipairs{'mdbx_type', 'maxlen', 'padded', 'nozero', 'mdbx_collation'} do
			self:check_schema('fk_add', fk.table, col, f[k] == ref_f[k],
				'fk %s: incompatible fields %s.%s and %s.%s: %s mismatch',
				fk.name, fk.table, col, fk.ref_table, ref_col, k)
		end
		if fk.ondelete == 'set null' then
			self:check_schema('fk_add', fk.table, col, not f.not_null,
				'fk %s: set null column must be nullable: %s.%s', fk.name, fk.table, col)
		end
	end
	--reject if existing data already violates the fk (before any change).
	local ok, err = check_existing_fk(self, event, schema, fk)
	self:check_schema('fk_add', fk.table, nil, ok, err)
	--ensure an index on fk.cols for parent-side delete enforcement: reuse a
	--compatible existing index (user- or fk-owned), else create an fk-owned one
	--that lives in ix_schemas but not in `ixs` (the user-declared list).
	local uq = format_ix_name(fk.table, fk.cols, true)
	local nu = format_ix_name(fk.table, fk.cols, false)
	for _, ix_schema in ipairs(schema.ix_schemas or empty) do
		if ix_schema.name == uq or ix_schema.name == nu then fk.ix = ix_schema.name; break end
	end
	if not fk.ix then
		local ix_schema = self:index_schema(schema, fk.cols)
		build_index(self, 'fk_add', schema, ix_schema)
		fk.ix = ix_schema.name
	end
	attr(schema, 'fks')[fk.name] = fk
	self:save_table_schema(schema)
	--register the reverse ref on the parent for delete-time enforcement.
	attr(ref_schema, 'ref_fks')[fk.table..'/'..fk.name] = {table = fk.table, fk = fk.name}
	self:save_table_schema(ref_schema)
	return true
end

function Db:drop_fk(fk)
	local dbi, schema = self:dbi_schema(fk.table)
	self:check_schema('fk_drop', fk.table, nil, dbi, 'not_found')
	local stored = schema.fks and schema.fks[fk.name]
	self:check_schema('fk_drop', fk.table, nil, stored,
		'fk not found: %s', fk.name)
	self:detach_fk(schema, stored)
	--remove the reverse ref from the parent.
	local _, ref_schema = self:dbi_schema(stored.ref_table)
	if ref_schema and ref_schema.ref_fks then
		ref_schema.ref_fks[stored.table..'/'..stored.name] = nil
		self:save_table_schema(ref_schema)
	end
	return true
end

--remove a fk from its (child) table and release its enforcement index. used by
--drop_fk and by drop_table when untangling a dropped parent's children.
function Db:detach_fk(schema, fk)
	schema.fks[fk.name] = nil
	if not next(schema.fks) then schema.fks = nil end
	release_index_if_unreferenced(self, schema, fk.ix)
	self:save_table_schema(schema)
end

--encoding and decoding ------------------------------------------------------

local function key_field(schema, col)
	local f = schema.fields[col]
	local ki = f.key_index
	if f and ki then return f end
	assertf(f, 'unknown field: %s.%s', schema.name, col)
	assertf(ki, 'not a key field: %s.%s', schema.name, col)
end

local function val_field(schema, col)
	local f = schema.fields[col]
	local vi = f and f.val_index
	if f and vi then return f, vi end
	assertf(f, 'unknown field: %s.%s', schema.name, col)
	assertf(vi, 'not a value field: %s.%s', schema.name, col)
end

local key_rec_buffer = buffer()
local val_rec_buffer = buffer()

local m_cols_list = memoize(function(cols)
	if cols:starts'[' then
		assert(cols:ends']')
		cols = cols:sub(2, -2)
	elseif cols:starts'{' then
		assert(cols:ends'}')
		cols = cols:sub(2, -2)
	end
	local t = collect(words(cols))
	assert(#t > 0)
	for i,col in ipairs(t) do t[col] = i end
	t[S] = cat(t, ',')
	return t
end)
function cols_list(cols)
	if not cols then return nil, nil end
	if cols == '[]' then return nil, '[]' end
	if cols == '{}' then return nil, '{}' end
	local as = cols:starts'[' and '[]' or cols:starts '{' and '{}' or nil
	return m_cols_list(cols), as
end

local function select_col(cols, as, col, ...)
	if as == '{}' then
		local t = ...
		return t[col]
	else
		local i = cols[col]
		if not i then return end
		if as == '[]' then
			local t = ...
			return t[i]
		else
			return (select(i, ...))
		end
	end
end

local function resolve_null_val(schema, f)
	local default = f.mdbx_default
	if isfunc(default) then
		default = default(schema, f)
	end
	return default
end

do
local pp = new'u8*[1]'
function encode_key(self, schema, event, autoinc_f, rec, rec_buf_sz, cols, as, ...)
	if #schema.key_fields == 0 then return 0 end
	local encode_int_key = schema.encode_int_key
	local autoinc_v
	pp[0] = rec
	for ki,f in ipairs(schema.key_fields) do
		local val = select_col(cols, as, f.col, ...)
		if val == nil or val == null then
			val = resolve_null_val(schema, f)
		end
		if val == nil and f == autoinc_f then
			val = self:seq(schema.name, 1)
			autoinc_v = val
		end
		if val == nil then
			if schema.is_index and schema.dup_keys and not f.not_null then
				C.schema_key_add(schema._st, ki-1, rec, rec_buf_sz, -1, pp)
			else
				self:check_col(event, schema.name, f.col, false, 'null_key')
			end
		elseif encode_int_key then
			return encode_int_key(rec, rec_buf_sz, val), autoinc_v
		else
			local len = f.encode(self, event, pp[0], val)
			C.schema_key_add(schema._st, ki-1, rec, rec_buf_sz, len, pp)
		end
	end
	return pp[0] - rec, autoinc_v
end
end

do
local pp = new'u8*[1]'
function encode_val(self, schema, event, rec, rec_buf_sz, cols, as, ...)
	if #schema.val_fields == 0 then return 0 end
	C.schema_val_add_start(schema._st, rec, rec_buf_sz, pp)
	for vi,f in ipairs(schema.val_fields) do
		local val = select_col(cols, as, f.col, ...)
		if val == nil or val == null then
			val = resolve_null_val(schema, f)
		end
		if val == nil and f.not_null then
			self:check_col(event, schema.name, f.col, false, 'not_null')
		end
		local len = val ~= nil and f.encode(self, event, pp[0], val) or -1
		C.schema_val_add(schema._st, vi-1, rec, rec_buf_sz, len, pp)
	end
	return pp[0] - rec
end
end

do
local pout = new'const u8*[1]'
local pp = new'const u8*[1]'

function decode_key(schema, rec, rec_sz, t, as, i0)
	i0 = i0 or 1
	local key_fields = schema.key_fields
	local decode_int_key = schema.decode_int_key
	if decode_int_key then
		local v = decode_int_key(rec, rec_sz)
		local k = as == '{}' and key_fields[1].col or 1
		t[k] = v
		return i0 + 1
	else
		local out, out_sz = key_rec_buffer(key_fields.max_rec_size)
		pp[0] = rec
		local n = #key_fields
		for i=1,n do
			local f = key_fields[i]
			local len = C.schema_get_key(schema._st, i-1,
				rec, rec_sz,
				out, out_sz,
				pout, pp)
			local k = as == '{}' and f.col or i0 + i - 1
			if len ~= -1 then
				t[k] = f.decode(pout[0], len)
			else
				t[k] = nil
			end
		end
		return i0 + n
	end
end

function decode_val(schema, rec, rec_sz, t, cols, as, i0)
	i0 = i0 or 1
	local n = cols and #cols or #schema.val_fields
	for i=1,n do
		local col = cols[i]
		local f, vi = val_field(schema, col)
		local len = C.schema_get_val(schema._st, vi-1, rec, rec_sz, pout)
		local k = as == '{}' and col or i0 + i - 1
		if len ~= -1 then
			t[k] = f.decode(pout[0], len)
		else
			t[k] = nil
		end
	end
	return i0 + n
end

--decode one index col from the appropriate record into a decoded value. f must be
--a field of val_schema; key fields are read from k/k_sz, val fields from v/v_sz.
--kb/kb_sz is a scratch buffer for key col decode (for descending key inversion).
function decode_ix_col(val_schema, f, k, k_sz, v, v_sz, kb, kb_sz)
	local len
	if f.key_index then
		len = C.schema_get_key(val_schema._st, f.key_index-1,
			k, k_sz, kb, kb_sz, pout, nil) --nil=random access (not sequential scan)
	else
		len = C.schema_get_val(val_schema._st, f.val_index-1, v, v_sz, pout)
	end
	if len ~= -1 then
		return f.decode(pout[0], len)
	else
		return nil
	end
end
end

local function get_raw_by_pk(self, dbi, schema, ...)
	local k, k_buf_sz = key_rec_buffer(schema.key_fields.max_rec_size)
	local k_sz = encode_key(self, schema, 'get', nil, k, k_buf_sz, schema.key_cols, nil, ...)
	return self:get_raw(dbi, k, k_sz)
end

local function decode_kv(self, schema, k, k_sz, v, v_sz, val_cols)
	local i0 = 1
	local t = {}
	local val_cols, as = cols_list(val_cols)
	val_cols = val_cols or schema.val_cols
	if schema.is_index then
		local val_table = assert(schema.val_table)
		local t_dbi     = assert(self.dbis[val_table])
		local t_schema  = assert(schema.val_schema)
		local k, k_sz = v, v_sz
		local ok
		ok, v, v_sz = self:get_raw(t_dbi, k, k_sz)
		assert(ok, v)
		i0 = decode_key(t_schema, k, k_sz, t, as, i0)
		schema = t_schema
	else
		if k then --if k is given it is decoded before v.
			i0 = decode_key(schema, k, k_sz, t, as, i0)
		end
	end
	i0 = decode_val(schema, v, v_sz, t, val_cols, as, i0)
	if as then
		return true, t, i0-1
	else
		return true, unpack(t, 1, i0-1)
	end
end

--CRUD -----------------------------------------------------------------------

function Db:check_row(event, tab, ret, ...)
	if ret then return ret, ... end
	local e = error_for('row', self, event, ...)
	e.table = tab
	self:abort()
	error(e)
end

function Db:check_col(event, tab, col, ret, ...)
	if istab(event) then
		return self:check_schema(event.event, event.table, col, ret, ...)
	end
	if ret then return ret end
	local e = error_for('field', self, event, ...)
	e.table = tab
	e.col = col
	self:abort()
	error(e)
end

function Db:is_null(tab, col, ...) --returns is_null, [reason]
	local dbi, schema = self:dbi_schema(tab)
	if not dbi then return true, schema end
	local f, vi = val_field(schema, col)
	local ok, v, v_sz = get_raw_by_pk(self, dbi, schema, ...)
	if not ok then return true, v end
	return C.schema_val_is_null(schema._st, vi-1, v, v_sz) ~= 0
end

function Db:exists(tab, ...) --returns record_exists, table_exists
	local dbi, schema = self:dbi_schema(tab)
	if not dbi then return false, false end
	local ok = get_raw_by_pk(self, dbi, schema, ...)
	if not ok then return false, true end
	return true, true
end

function Db:try_get(tab, val_cols, ...)
	local dbi, schema = self:dbi_schema(tab)
	if not dbi then return false, schema end
	local ok, v, v_sz = get_raw_by_pk(self, dbi, schema, ...)
	if not ok then return false, v end
	return decode_kv(self, schema, nil, nil, v, v_sz, val_cols)
end

local function skip_ok(ok, ...)
	if not ok then return end
	return ...
end
local function must_ok(ok, ...)
	assert(ok, ...)
	return ...
end

function Db:get(...)
	return skip_ok(self:try_get(...))
end

function Db:must_get(...)
	return must_ok(self:try_get(...))
end

--check that every fk's referenced row exists for the selected values. on a full
--write (insert/put) an unset col takes its default. a nil/null fk col means "no
--reference" so the fk is skipped ("MATCH SIMPLE": any null col skips checking).
local fk_key_buffer = buffer()
local function check_fks(self, event, schema, cols, as, full, ...)
	for fk_name, fk in pairs(schema.fks) do
		local vals = {}
		local skip = false
		local n = #fk.cols
		for i = 1, n do
			local col = fk.cols[i]
			local val = select_col(cols, as, col, ...)
			if val == nil and full then --full write: an unset col takes its default
				val = resolve_null_val(schema, schema.fields[col])
			end
			if val == nil or val == null then skip = true; break end
			vals[i] = val
		end
		if not skip then
			local ref_dbi, ref_schema = self:dbi_schema(fk.ref_table)
			assertf(ref_dbi, 'fk %s: ref table missing: %s', fk_name, fk.ref_table)
			local pk, pk_buf_sz = fk_key_buffer(ref_schema.key_fields.max_rec_size)
			local pk_sz = encode_key(self, ref_schema, 'get', nil, pk, pk_buf_sz,
				ref_schema.key_cols, nil, unpack(vals, 1, n))
			if not self:get_raw(ref_dbi, pk, pk_sz) then
				self:check_row(event, schema.name, false,
					fmt('fk %s: no parent row in %s', fk_name, fk.ref_table))
			end
		end
	end
end
local del_fk_key_buffer = buffer()
--probe a child's fk index for the first row referencing the deleted parent pk
--(`...`); returns get_raw's (ok, v, v_sz) where v is the child's encoded pk. the
--key is re-encoded on every call because a recursive cascade reuses the buffer.
local function first_referencing_child(self, child_schema, fk, ...)
	local ix_dbi, ix_schema = self:dbi_schema(fk.ix)
	local xk, xk_buf_sz = del_fk_key_buffer(ix_schema.key_fields.max_rec_size)
	local xk_sz = encode_key(self, ix_schema, 'get', nil, xk, xk_buf_sz,
		ix_schema.key_cols, nil, ...)
	return self:get_raw(ix_dbi, xk, xk_sz)
end
--apply the referential actions of fks that reference this (parent) table after
--its row was deleted. `...` are the parent pk values (fk.cols order == ref pk
--order). two passes so a sibling cascade that clears a reference is honored
--before we check it: pass 1 cascades/nulls (each drains by re-probing -- a delete
--/null removes the child's entry at this key, a cascade also recurses), pass 2
--does the NO ACTION (default) checks -- reject if anything still references us.
local function enforce_del_fks(self, schema, ...)
	for _, ref in pairs(schema.ref_fks) do
		local _, child_schema = self:dbi_schema(ref.table)
		local fk = child_schema.fks[ref.fk]
		if fk.ondelete == 'cascade' then
			local n = #child_schema.key_fields
			while true do
				local ok, v, v_sz = first_referencing_child(self, child_schema, fk, ...)
				if not ok then break end
				local pk = {}
				decode_key(child_schema, v, v_sz, pk, nil)
				self:del(ref.table, unpack(pk, 1, n))
			end
		elseif fk.ondelete == 'set null' then
			while true do
				local ok, v, v_sz = first_referencing_child(self, child_schema, fk, ...)
				if not ok then break end
				local rec = {}
				decode_key(child_schema, v, v_sz, rec, '{}')
				for _, col in ipairs(fk.cols) do rec[col] = null end
				self:update(ref.table, '{}', rec)
			end
		end
	end
	for _, ref in pairs(schema.ref_fks) do --no action (default): reject if referenced
		local _, child_schema = self:dbi_schema(ref.table)
		local fk = child_schema.fks[ref.fk]
		if fk.ondelete ~= 'cascade' and fk.ondelete ~= 'set null' then
			if first_referencing_child(self, child_schema, fk, ...) then
				self:check_row('del', schema.name, false,
					fmt('fk %s: referenced by %s', fk.name, ref.table))
			end
		end
	end
end
local put_v0_buffer = buffer()
local function put(self, flags, op, tab, cols, ...)
	local dbi, schema = self:dbi_schema(tab, 'w')
	local cols, as = cols_list(cols)
	cols = cols or schema.cols
	local k, k_buf_sz = key_rec_buffer(schema.key_fields.max_rec_size)
	local v, v_buf_sz = val_rec_buffer(schema.val_fields.max_rec_size)
	local autoinc_f = op == 'insert' and schema.autoinc_field
	local k_sz, autoinc_v = encode_key(self, schema, op, autoinc_f, k, k_buf_sz, cols, as, ...)
	if op == 'update' or op == 'upsert' or schema.ix_schemas or schema.fks then
		local cur = self:cursor(dbi, 'w')
		--insert skips the get: v0=nil by definition, NOOVERWRITE detects exists
		local found, v0, v0_sz
		if op ~= 'insert' then
			found, v0, v0_sz = cur:get_raw(k, k_sz)
		end
		local v_sz
		if found then
			--next mdbx put command will invalidate v0 so we need to save it.
			local v0_unstable = v0
			v0 = put_v0_buffer(v0_sz) --keep v0_sz: buffer() returns capacity, not size
			copy(v0, v0_unstable, v0_sz)
			if op == 'update' or op == 'upsert' then --decode v0 and override it.
				local val_cols = schema.val_cols
				local t = {}
				decode_val(schema, v0, v0_sz, t, val_cols, '{}')
				for i=1,#cols do
					local col = cols[i]
					if val_cols[col] then --only value cols can be updated
						local v = select_col(cols, as, col, ...)
						if v ~= nil then --nil means skip, null means null.
							t[col] = v
						end
					end
				end
				v_sz = encode_val(self, schema, op, v, v_buf_sz, val_cols, '{}', t)
				if schema.fks then
					for _, f in ipairs(schema.key_fields) do
						t[f.col] = select_col(cols, as, f.col, ...)
					end
					check_fks(self, op, schema, schema.cols, '{}', false, t)
				end
			else --update all cols so no need to decode v0
				v_sz = encode_val(self, schema, op, v, v_buf_sz, cols, as, ...)
				if schema.fks then
					check_fks(self, op, schema, cols, as, true, ...)
				end
			end
			assert(cur:try_put_raw(k, k_sz, v, v_sz, mdbx.MDBX_CURRENT))
		elseif op == 'update' then --update but existing row not found
			self:check_row(op, schema.name, false, v0)
		else --put, insert, or upsert new record
			v0, v0_sz = nil --no previous value (v0 currently holds the get_raw err)
			v_sz = encode_val(self, schema, op, v, v_buf_sz, cols, as, ...)
			if schema.fks then
				--new row: full write (missing value means take default value).
				check_fks(self, op, schema, cols, as, true, ...)
			end
			local ret, err = cur:try_put_raw(k, k_sz, v, v_sz, flags)
			self:check_row(op, schema.name, ret, err)
		end
		cur:close()
		if schema.ix_schemas then
			for _, ix_schema in ipairs(schema.ix_schemas) do
				local ok, err = ix_schema:update(self, k, k_sz, v, v_sz, v0, v0_sz)
				self:check_row(op, schema.name, ok, err)
			end
		end
	else --put or insert with no indexes to update or fks to check.
		local v_sz = encode_val(self, schema, op, v, v_buf_sz, cols, as, ...)
		local ret, err = self:try_put_raw(dbi, k, k_sz, v, v_sz, flags)
		self:check_row(op, schema.name, ret, err)
	end
	log('note', 'db', op, '%s %s', schema.name, cols[S])
	return autoinc_v
end
function Db:put(tab, ...)
	put(self, nil, 'put', tab, ...)
	return true
end
function Db:insert(tab, ...)
	return put(self, mdbx.MDBX_NOOVERWRITE, 'insert', tab, ...)
end
function Db:update(tab, ...)
	put(self, mdbx.MDBX_CURRENT, 'update', tab, ...)
	return true
end
function Db:upsert(tab, ...)
	put(self, nil, 'upsert', tab, ...)
	return true
end

local del_v0_buffer = buffer()
local function del_row(self, dbi, schema, ...)
	local k, k_buf_sz = key_rec_buffer(schema.key_fields.max_rec_size)
	local k_sz = encode_key(self, schema, 'del', nil, k, k_buf_sz, schema.key_cols, nil, ...)
	if not schema.ix_schemas then
		local ok, err = self:try_del_raw(dbi, k, k_sz)
		self:check_row('del', schema.name, ok, err)
		return
	end
	--indexed: read the row value first to recompute its index keys, then delete
	--the row and remove its index entries.
	local ok, v0, v0_sz = self:get_raw(dbi, k, k_sz)
	self:check_row('del', schema.name, ok, v0)
	local v0u = v0; v0 = del_v0_buffer(v0_sz); copy(v0, v0u, v0_sz)
	assert(self:try_del_raw(dbi, k, k_sz))
	for _,ix_schema in ipairs(schema.ix_schemas) do
		ix_schema:del(self, k, k_sz, v0, v0_sz)
	end
end
function Db:del(tab, ...)
	local dbi, schema = self:dbi_schema(tab, 'w')
	self:check_row('del', self:table_name(tab), dbi, schema)
	del_row(self, dbi, schema, ...)
	if schema.ref_fks then
		enforce_del_fks(self, schema, ...)
	end
end

function Db:put_records(tab, cols, records)
	if istab(cols) then
		cols, records = '[]', cols
	end
	local dbi, schema = self:dbi_schema(tab, 'w')
	assert(not schema.ix_schemas)
	assert(not schema.fks)
	assert(not schema.ref_fks)
	local cols, as = cols_list(cols)
	cols = cols or schema.cols
	local k, k_buf_sz = key_rec_buffer(schema.key_fields.max_rec_size)
	local v, v_buf_sz = val_rec_buffer(schema.val_fields.max_rec_size)
	for _,vals in ipairs(records) do
		local k_sz = encode_key(self, schema, 'put_rec', nil, k, k_buf_sz, cols, as, vals)
		local v_sz = encode_val(self, schema, 'put_rec', v, v_buf_sz, cols, as, vals)
		local ok, err = self:try_put_raw(dbi, k, k_sz, v, v_sz)
		self:check_row('put_rec', schema.name, ok, err)
	end
	return true
end

--cursors --------------------------------------------------------------------

local function check_cur(self, op, ok, ...)
	if ok then return ... end
	self.db:check_row(op, self.schema.name, nil, false, (...))
end

local db_try_cursor = Db.try_cursor
function Db:try_cursor(tab, mode)
	local cur, err = db_try_cursor(self, tab, mode)
	if not cur then return nil, err end
	cur.schema = self.live_schema[assert(self.dbis[cur:dbi()])]
	return cur
end

for _,OP in ipairs{'first', 'last', 'next', 'prev', 'current'} do
	local op_raw = Cur[OP..'_raw']
	local function try_op(self, val_cols)
		local schema = assert(self.schema)
		local ok, k, k_sz, v, v_sz = op_raw(self)
		if not ok then return false end
		return decode_kv(self.db, schema, k, k_sz, v, v_sz, val_cols)
	end
	local function do_op(self, val_cols)
		return skip_ok(try_op(self, val_cols))
	end
	local function must_op(self, val_cols)
		return check_cur(self, OP, try_op(self, val_cols))
	end
	Cur['try_'..OP] = try_op
	Cur[OP] = do_op
	Cur['must_'..OP] = must_op
end

local db_cursor_close = Cur.close
function Cur:close()
	db_cursor_close(self)
	self.schema = nil
end

function Cur:try_get(val_cols, ...)
	local schema = assert(self.schema)
	local k, k_buf_sz = key_rec_buffer(schema.key_fields.max_rec_size)
	local k_sz = encode_key(self.db, schema, 'c_get', nil,
		k, k_buf_sz, schema.key_cols, nil, ...)
	local ok, v, v_sz = self:get_raw(k, k_sz)
	if not ok then return false end
	return decode_kv(self.db, schema, nil, nil, v, v_sz, val_cols)
end
function Cur:get(...)
	return skip_ok(self:try_get(...))
end
function Cur:must_get(...)
	return check_cur(self, 'c_get', self:try_get(...))
end

local cur_k_buffer  = buffer() --stable copy of a cursor's key across writes
local cur_v0_buffer = buffer() --stable copy of a cursor's old value across writes
function Cur:update(val_cols, ...)
	local schema = assert(self.schema)
	local cols, as = cols_list(val_cols)
	cols = cols or schema.val_cols
	local v, v_buf_sz = val_rec_buffer(schema.val_fields.max_rec_size)
	local ok, k, k_sz, v0, v0_sz = self:current_raw()
	if not ok then
		self.db:check_row('c_update', schema.name, false, 'not_found')
	end
	local kk = cur_k_buffer(k_sz); copy(kk, k, k_sz)
	--decode the current value, override the given cols, then re-encode.
	local val_cols = schema.val_cols
	local t = {}
	decode_val(schema, v0, v0_sz, t, val_cols, '{}')
	for i=1,#cols do
		local col = cols[i]
		if val_cols[col] then --only value cols can be updated
			local val = select_col(cols, as, col, ...)
			if val ~= nil then t[col] = val end --nil = skip, null = null
		end
	end
	local db = self.db
	local v_sz = encode_val(db, schema, 'c_update', v, v_buf_sz, val_cols, '{}', t)
	if schema.fks then
		--fk.cols may include pk cols; decode key into t (k is still valid pre-write).
		decode_key(schema, k, k_sz, t, '{}')
		check_fks(db, 'c_update', schema, schema.cols, '{}', false, t)
	end
	if not schema.ix_schemas then
		assert(self:try_put_raw(kk, k_sz, v, v_sz, mdbx.MDBX_CURRENT))
	else
		--copy v0 first: mdbx invalidates get-pointers on the next write.
		local v0c = cur_v0_buffer(v0_sz); copy(v0c, v0, v0_sz)
		assert(self:try_put_raw(kk, k_sz, v, v_sz, mdbx.MDBX_CURRENT))
		for _, ix_schema in ipairs(schema.ix_schemas) do
			local ok, err = ix_schema:update(db, kk, k_sz, v, v_sz, v0c, v0_sz)
			db:check_row('c_update', schema.name, ok, err)
		end
	end
	return true
end

local function cur_each_pass(cur, ok, ...)
	if not ok then return end
	return cur, ...
end
local function cur_each_try_next(self, k0)
	if k0 == 'start' then
		return cur_each_pass(self, self:try_first(self.val_cols))
	end
	return cur_each_pass(self, self:try_next(self.val_cols))
end
local function cur_each_try_prev(self, k0)
	if k0 == 'start' then
		return cur_each_pass(self, self:try_last(self.val_cols))
	end
	return cur_each_pass(self, self:try_prev(self.val_cols))
end
function Db:try_each(tbl_name, val_cols, mode, t)
	local cur = self:try_cursor(tbl_name, mode)
	if not cur then return noop end
	cur.val_cols = val_cols
	return cur_each_try_next, cur, 'start'
end
function Db:each(tbl_name, val_cols, mode, t)
	local cur = self:cursor(tbl_name, mode)
	cur.val_cols = val_cols
	return cur_each_try_next, cur, 'start'
end
function Db:try_each_reverse(tbl_name, val_cols, mode, t)
	local cur = self:try_cursor(tbl_name, mode)
	if not cur then return noop end
	cur.val_cols = val_cols
	return cur_each_try_prev, cur, 'start'
end
function Db:each_reverse(tbl_name, val_cols, mode, t)
	local cur = self:cursor(tbl_name, mode)
	cur.val_cols = val_cols
	return cur_each_try_prev, cur, 'start'
end

--schema sync'ing ------------------------------------------------------------

local MS = {engine = 'mdbx'}

function mdbx_schema()
	return schema.new(update({}, MS))
end

MS.relevant_field_attrs = {
	col=1,
	col_pos=1,
	mdbx_type=1,
	maxlen=1,
	padded=1,
	nozero=1,
}

function MS:format_ix_name(tbl_name, cols, unique)
	return format_ix_name(tbl_name, cols, unique)
end

function Db:layout_schema()
	for table_name, table_schema in sortedpairs(self.schema.tables) do
		self:layout_table_schema(table_schema)
	end
end

function Db:extract_schema()
	local schema = mdbx_schema()
	for table_name in self:each_table() do
		if not table_name:starts'$' and not table_name:has'/' then
			schema.tables[table_name] =
				self:load_table_schema(table_name) or {raw = true}
		end
	end
	return schema
end

function Db:schema_diff()
	local ss = self:extract_schema()
	self:layout_schema()
	return self.schema:diff(ss)
end

function Db:sync_schema(src, opt)
	src = src or self.schema
	opt = opt or empty
	local src_sc =
		schema.isschema(src) and src
		or inherits(src, mdbx_db) and src:extract_schema()
		or assertf(false, 'schema or mdbx_db expected, got %s', type(src))
	local function P(...)
		pr(fmt(...))
	end
	local function sync()
		local stored_sc = self:extract_schema()
		local diff = schema.diff(stored_sc, src_sc)
		diff:pp()
		if diff.tables then
			if diff.tables.add then
				for tbl_name, tbl in sortedpairs(diff.tables.add) do
					P('create table: %s', tbl_name)
					self:create_table(tbl_name)
					if tbl.rows then
						for _,row in ipairs(tbl.rows) do
							self:insert(tbl_name, '[]', row)
						end
					end
					if tbl.indexes then
						for ix_name, ix in pairs(tbl.indexes) do
							P('add index: %s', ix_name)
							self:add_index(tbl_name, ix)
						end
					end
					if tbl.fks then
						for fk_name, fk in pairs(tbl.fks) do
							P('add fk: %s', fk_name)
							self:add_fk(fk)
						end
					end
				end
			end
			if diff.tables.update then
				for tbl_name, tbl in sortedpairs(diff.tables.update) do
					if tbl.ixs then
						if tbl.ixs.del then
							for ix_name, ix in pairs(tbl.ixs.remove) do
								--
							end
						end
						if tbl.ixs.add then
							for ix_name, ix in pairs(tbl.ixs.add) do
								P('add index: %s', ix_name)
								self:add_index(tbl_name, ix)
							end
						end
					end
				end
			end
		end
	end
	self:without_schema(function()
		self:atomic(opt.dry and 'r' or 'w', sync)
	end)
end
