--go@ plink -t root@m1 sdk/bin/debian12/luajit sdk/tests/mdbx_schema_test.lua
--go@ plink -t root@m1 sdk/bin/debian12/luajit sp2/sp.lua -v install forealz
--[[

	mdbx_schema: structured data and multi-key indexing for mdbx.
	Written by Cosmin Apreutsei. Public Domain.

	Data types:
		- ints: 8, 16, 32, 64 bit, signed/unsigned
		- floats: 32 and 64 bit
		- arrays: fixed-size and variable-size
		- nullable values

	Keys:
		- composite keys with per-field ascending/descending order
		- utf-8 ai_ci collation

	Limitations:
		- keys are not nullable
		- varsize keys are 0-terminated so they are not 8-bit clean!
		- indexed columns are not nullable and varsize ones are not 8-bit clean!
		- schema layouting errors are non-recoverable.

API, extends mdbx.lua MANAGED API

	db:put             (table_name|dbi, [cols], keysvals...)
	db:[try_]insert    (table_name|dbi, [cols], keysvals...) -> true | false,'exists'
	db:[try_]update    (table_name|dbi, [cols], keysvals...) -> true | false,'not_found'
	db:upsert          (table_name|dbi, [cols], keysvals...)
	db:[try_]put_records(table_name|dbi, [cols, ]{keysvals1,...})
	db:is_null         (table_name|dbi, col, keys...) -> is_null, [reason]
	db:exists          (table_name|dbi, keys...) -> record_exists, table_exists
	db:[must_]get      (table_name|dbi, [val_cols], keys...) -> vals...
	db:try_get         (table_name|dbi, [val_cols], keys...) -> true, vals... | false
	db:[try_]del       (table_name|dbi, keys...) -> true | false,err

	cur:{first|last|next|prev|current}([cols]) -> keysvals...
	cur:[must_]get ([val_cols], keys...) -> vals...
	cur:try_get    ([val_cols], keys...) -> true, vals... | false
	cur:update     ([val_cols], vals...)

	db:try_each    (tbl_name|dbi, [cols]) -> cur, keysvals...

		cols format   |  vals...              | keyvals...
		--------------+-----------------------+------------
		nil           |   col1_val,...        |  keycol1_val,..., col1_val,...
		'col1 ...'    |   col1_val,...        |  keycol1_val,..., col1_val,...
		'[col1 ...]'  |  {col1_val,...}       | {keycol1_val,..., col1_val,...}
		'{col1 ...}'  |  {col1=col1_val,...}  | {keycol1=keycol1_val,col1=col1_val}


TODO:
	- fixed-size padded array key fields
	- range lookup cursor
	- mdbx_env_chk()
	- table migration:
		- copy all records to tmp table, delete old table, rename tmp table.
			- copy existing fields by name, use aka mapping to find old field.
				- copy using raw pointers into decoded values and encoded values.

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
	assertf(n >= 0, 'utf8_ai_ci: invalid utf8 (%d)', n)
	if n >= cap then --too small for the codepoints + utf8proc_reencode's nul terminator
		out, cap = ai_ci_buf(n + 1)
		n = utf8_decompose(s, len, out, cap, ai_ci_opt)
	end
	local sz = num(utf8_reencode(out, n, ai_ci_opt)) --in place: int32 cps -> utf8 bytes
	assertf(sz >= 0, 'utf8_ai_ci: reencode failed (%d)', sz)
	return out, sz
end

local function has_unique_ix(schema)
	for _,ix in ipairs(schema.ix_schemas or empty) do
		if not ix.dup_keys then return true end
	end
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
	else
		schema.has_unique_ix = has_unique_ix(schema)
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
	if schema.ixs then
		schema.ix_schemas = {}
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
				schema.ix_schemas = schema.ix_schemas or {}
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

function Db:reload_table_schema(name)
	local schema = assertf(self:load_table_schema(name),
		'no stored schema for table: %s', name)
	if not schema.is_index then
		self:compile_table_schema(schema)
		for _, ix_schema in ipairs(schema.ix_schemas or empty) do
			self:compile_table_schema(ix_schema)
			self.meta[ix_schema.name] = ix_schema
		end
	end
	return schema
end

function Db:dbi_schema(tab, mode)
	local name = self:table_name(tab)
	local dbi, schema
	if mode == 'ddl' then
		dbi, schema = self:localize_dbi(tab, 'w')
		if dbi and not schema then
			schema = self:reload_table_schema(name)
			self.meta[name] = schema
		end
	else
		dbi, schema = self:dbi(tab, mode)
	end
	if dbi then assertf(schema, 'no schema for table: %s', name) end
	return dbi, schema
end

function Db:try_drop_table_schema(table_name)
	return self:try_del_raw('$schema', table_name, #table_name)
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
function Db:validate_schema(stored_schema, paper_schema)

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

local try_open_table_raw = Db.try_open_table
function Db:try_open_table(tab, mode, paper_schema, flags)

	local table_name = tab
	paper_schema = paper_schema or self.meta[table_name]
		or self.schema and self.schema.tables[table_name]

	local stored_schema = self:load_table_schema(table_name)
	if stored_schema and not paper_schema then
		if mode == 'c' then
			--old table with stored schema, but now we're creating one without.
			self:try_drop_table_schema(table_name)
			stored_schema = nil
		else
			--old table for which paper schema was lost, use stored schema.
			paper_schema = stored_schema
		end
	end

	if paper_schema then
		paper_schema.name = table_name
		self:compile_table_schema(paper_schema)
	end

	if stored_schema and paper_schema and paper_schema ~= stored_schema then
		--table has both stored schema and paper schema, schemas must match.
		local ok, err = self:validate_schema(stored_schema, paper_schema)
		if not ok then return nil, err end
	end

	local schema = paper_schema

	local sub_tx = schema and schema.ix_schemas and (mode or 'r') ~= 'r'
	if sub_tx then self:begin'w' end

	flags = bor(flags or 0,
		schema and schema.int_key and mdbx.MDBX_INTEGERKEY or 0,
		schema and schema.dup_keys and mdbx.MDBX_DUPSORT or 0)
	local dbi, created = try_open_table_raw(self, table_name, mode, nil, flags)
	if not dbi then
		if sub_tx then self:abort() end
		return nil, created
	end

	if schema then
		self.meta[table_name] = schema
		if created and not stored_schema then
			self:save_table_schema(schema)
		end
		for _,ix_schema in ipairs(schema.ix_schemas or empty) do
			local dbi, err, errs = self:try_open_table(ix_schema.name, mode, ix_schema)
			if not dbi then
				if sub_tx then self:abort() end
				return nil, err, errs
			end
		end
	end

	if sub_tx then self:commit() end

	return dbi, created, schema
end

local try_drop_table = Db.try_drop_table
function Db:try_drop_table(tab)
	local dbi, schema, name = self:dbi(tab)
	if not dbi then return nil, schema end
	assert(name)
	assert(try_drop_table(self, dbi))
	self:try_drop_table_schema(name)
	if schema and schema.ix_schemas then
		for _,ix_schema in ipairs(schema.ix_schemas) do
			self:try_drop_table(ix_schema.name)
		end
	end
	return true
end

local try_rename_table = Db.try_rename_table
function Db:try_rename_table(tab, new_table_name)
	local dbi, schema = self:dbi(tab)
	if not dbi then return nil, schema end
	local ok, err = try_rename_table(self, dbi, new_table_name)
	if not ok then return nil, err end
	if schema then
		local k1 = schema.name
		local k2 = new_table_name
		assert(self:try_move_key_raw('$schema', k1, #k1, k2, #k2))
	end
	return true
end

--indexes --------------------------------------------------------------------

local ix1_key_rec_buffer = buffer()
local ix2_key_rec_buffer = buffer()
local ix_val_rec_buffer = buffer()

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
	local ix_name = ix_schema.name

	local val_table = assert(ix_schema.val_table)
	local val_schema = assert(ix_schema.val_schema)

	local cols = cols_list(cat(ix_schema.pk, ' '))
	local dt = {}

	--default val_cols for index tables are the val_cols of the val_table.
	ix_schema.val_cols = val_schema.val_cols

	--create index methods

	function ix_schema.try_create(ix_schema, self)
		local ix_dbi = self:create_table(ix_schema.name, ix_schema)
		local xk, xk_buf_sz = ix1_key_rec_buffer(ix_schema.key_fields.max_rec_size)
		local xv, xv_buf_sz = ix_val_rec_buffer(val_schema.key_fields.max_rec_size)
		for cur, k, k_sz, v, v_sz in self:each_raw(val_table) do
			local vn = decode_val(val_schema, v, v_sz, dt, cols, '[]')
			local xk_sz = encode_key(self, ix_schema, 'i_add', nil, xk, xk_buf_sz, cols, '[]', dt)
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

	local dt0 = {}
	function ix_schema.update(ix_schema, self, k, k_sz, v, v_sz, v0, v0_sz)

		local ix_dbi = self:dbi(ix_name, 'w')
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

		--derive index key from v
		local xk, xk_buf_sz = ix1_key_rec_buffer(ix_schema.key_fields.max_rec_size)
		local vn = decode_val(val_schema, v, v_sz, dt, cols, '[]')
		local xk_sz = encode_key(self, ix_schema, 'i_update', nil, xk, xk_buf_sz, cols, '[]', dt)
		clear(dt)

		if v0 then --record updated: remove the old index record

			--derive old index key from v0 to compare with the new one.
			local xk0, xk0_buf_sz = ix2_key_rec_buffer(ix_schema.key_fields.max_rec_size)
			local vn = decode_val(val_schema, v0, v0_sz, dt0, cols, '[]')
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
		local ix_dbi = self:dbi(ix_name, 'w')
		local xk0, xk0_buf_sz = ix2_key_rec_buffer(ix_schema.key_fields.max_rec_size)
		decode_val(val_schema, v0, v0_sz, dt0, cols, '[]')
		local xk0_sz = encode_key(self, ix_schema, 'i_del', nil, xk0, xk0_buf_sz, cols, '[]', dt0)
		clear(dt0)
		if ix_schema.dup_keys then --remove the exact (key, pk) pair.
			assert(self:try_del_raw(ix_dbi, xk0, xk0_sz, k, k_sz))
		else --remove the unique key.
			assert(self:try_del_raw(ix_dbi, xk0, xk0_sz))
		end
	end

	--read-only check that the new index key derived from v doesn't already map
	--to a different pk (i.e. would not violate uniqueness). lets a caller verify
	--before writing, so the write can't soft-fail and need a rollback.
	function ix_schema.check_unique(ix_schema, self, k, k_sz, v, v_sz)
		local xk, xk_buf_sz = ix1_key_rec_buffer(ix_schema.key_fields.max_rec_size)
		decode_val(val_schema, v, v_sz, dt, cols, '[]')
		local xk_sz = encode_key(self, ix_schema, 'i_check', nil, xk, xk_buf_sz, cols, '[]', dt)
		clear(dt)
		local ok, pk, pk_sz = self:get_raw(self:dbi(ix_name), xk, xk_sz)
		if ok and (pk_sz ~= k_sz or memcmp(pk, k, k_sz) ~= 0) then
			return false, 'exists' --index key belongs to a different row
		end
		return true
	end

end

function Db:try_add_index(val_table, ix)
	local val_dbi, val_schema = self:dbi_schema(val_table, 'w')
	local ix_schema = self:index_schema(val_schema, ix)
	if val_schema.ixs and val_schema.ixs[ix_schema.name] then
		return false, 'exists', ix_schema.name
	end
	self:compile_table_schema(ix_schema)
	self:begin'w'
	local ok, err = ix_schema:try_create(self)
	if not ok then
		self:abort()
		return false, err, ix_schema.name
	end
	attr(val_schema, 'ixs')[ix_schema.name] = ix
	local ix_schemas = attr(val_schema, 'ix_schemas')
	binsearch_insert(val_schema.ix_schemas, ix_schema, function(ix_schemas, i, ix_schema)
		return ix_schemas[i].name < ix_schema.name
	end)
	val_schema.has_unique_ix = has_unique_ix(val_schema)
	self:save_table_schema(val_schema)
	self:commit()
	return true, nil, ix_schema.name
end
function Db:add_index(val_table, cols)
	local ok, err, ix_name = self:try_add_index(val_table, cols)
	return self:check('i_add', ok, '%s: %s', ix_name, err)
end

function Db:try_drop_index(ix_name)
	local val_table = assert(ix_name:match'^[^/]+')
	local val_dbi, val_schema = self:dbi_schema(val_table)
	if not val_dbi or (not (val_schema.ixs and val_schema.ixs[ix_name])) then
		return false, 'not_found'
	end
	val_schema.ixs[ix_name] = nil
	local n = #val_schema.ix_schemas
	for i, ix_schema in ipairs(val_schema.ix_schemas) do
		if ix_name == ix_schema.name then
			remove(val_schema.ix_schemas, i)
			break
		end
	end
	assert(#val_schema.ix_schemas == n - 1)
	if #val_schema.ix_schemas == 0 then
		val_schema.ix_schemas = nil
	end
	val_schema.has_unique_ix = has_unique_ix(val_schema)
	self:try_drop_table(ix_name)
	self:save_table_schema(val_schema)
	return true
end
function Db:drop_index(ix_name)
	local ok, err = self:try_drop_index(ix_name)
	return self:check('i_drop', ok, '%s: %s', ix_name, err)
end

------------------------------------------------------------------------------

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

--encoding and decoding ------------------------------------------------------

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
		local i = assert(cols[col])
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

function Db:check_col(event, tab, col, ret, ...)
	if ret then return ret end
	local e = error_for('field', self, event, ...)
	e.table = tab
	e.col = col
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

local put_v0_buffer = buffer()
local function try_put(self, flags, op, tab, cols, ...)
	local dbi, schema = self:dbi_schema(tab, 'w')
	local cols, as = cols_list(cols)
	cols = cols or schema.cols
	local k, k_buf_sz = key_rec_buffer(schema.key_fields.max_rec_size)
	local v, v_buf_sz = val_rec_buffer(schema.val_fields.max_rec_size)
	local autoinc_f = op == 'insert' and schema.autoinc_field
	local k_sz, autoinc_v = encode_key(self, schema, op, autoinc_f, k, k_buf_sz, cols, as, ...)
	local ret, err
	if op == 'update' or op == 'upsert' or schema.ix_schemas or schema.fks then
		--updating an unique index can fail so make a sub tx that we can rollback.
		local in_sub = schema.has_unique_ix
		if in_sub then self:begin'w' end
		local cur = self:cursor(dbi, 'w') --created in the sub-txn so its writes belong to it
		local ok, v0, v0_sz = cur:get_raw(k, k_sz)
		local v_sz
		if ok then
			if op == 'insert' then
				cur:close(); if in_sub then self:abort() end
				return false, 'exists'
			end
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
			else --update all cols so no need to decode v0
				v_sz = encode_val(self, schema, op, v, v_buf_sz, cols, as, ...)
			end
			if schema.fks then
				for _,fk in ipairs(schema.fks) do
					local ok, err = fk:check(self, k, k_sz, v, v_sz)
					if not ok then
						cur:close(); if in_sub then self:abort() end
						return false, err
					end
				end
			end
			assert(cur:set_raw(v, v_sz)) --overwrite at the positioned cursor (no 2nd lookup)
		elseif op == 'update' then --update but existing row not found
			cur:close(); if in_sub then self:abort() end
			return false, v0
		else --put, insert, or upsert new record
			v0, v0_sz = nil --no previous value (v0 currently holds the get_raw err)
			v_sz = encode_val(self, schema, op, v, v_buf_sz, cols, as, ...)
			if schema.fks then
				for _,fk in ipairs(schema.fks) do
					local ok, err = fk:check(self, k, k_sz, v, v_sz)
					if not ok then
						cur:close(); if in_sub then self:abort() end
						return false, err
					end
				end
			end
			local ret, err = cur:put_raw(k, k_sz, v, v_sz, flags)
			if not ret then
				cur:close(); if in_sub then self:abort() end
				return false, err
			end
		end
		cur:close()
		if schema.ix_schemas then
			for _, ix_schema in ipairs(schema.ix_schemas) do
				local ok, err = ix_schema:update(self, k, k_sz, v, v_sz, v0, v0_sz)
				if not ok then
					if in_sub then self:abort() end
					return false, err
				end
			end
		end
		if in_sub then self:commit() end
	else --put or insert with no indexes to update or fks to check.
		local v_sz = encode_val(self, schema, op, v, v_buf_sz, cols, as, ...)
		local ret, err = self:try_put_raw(dbi, k, k_sz, v, v_sz, flags)
		if not ret then return false, err end
	end
	log('note', 'db', op, '%s %s', schema.name, cols[S])
	return true, autoinc_v
end
function Db:try_put(tab, ...)
	return try_put(self, nil, 'put', tab, ...)
end
function Db:put(tab, ...)
	local ret, err = try_put(self, nil, 'put', tab, ...)
	if ret then return ret end
	self:check('put', ret, '%s: %s', self:table_name(tab), err)
end
function Db:try_insert(tab, ...)
	return try_put(self, mdbx.MDBX_NOOVERWRITE, 'insert', tab, ...)
end
function Db:insert(tab, ...)
	local ret, autoinc_v = try_put(self, mdbx.MDBX_NOOVERWRITE, 'insert', tab, ...)
	if ret then return autoinc_v end
	self:check('insert', false, '%s: %s', self:table_name(tab), autoinc_v)
end
function Db:try_update(tab, ...)
	return try_put(self, mdbx.MDBX_CURRENT, 'update', tab, ...)
end
function Db:update(tab, ...)
	local ret, err = try_put(self, mdbx.MDBX_CURRENT, 'update', tab, ...)
	if ret then return ret end
	self:check('update', false, '%s: %s', self:table_name(tab), err)
end
function Db:upsert(tab, ...)
	local ret, err = try_put(self, nil, 'upsert', tab, ...)
	if ret then return ret end
	self:check('upsert', false, '%s: %s', self:table_name(tab), err)
end

local del_v0_buffer = buffer()
function Db:try_del(tab, ...)
	local dbi, schema = self:dbi_schema(tab)
	if not dbi then return false, schema end
	local k, k_buf_sz = key_rec_buffer(schema.key_fields.max_rec_size)
	local k_sz = encode_key(self, schema, 'del', nil, k, k_buf_sz, schema.key_cols, nil, ...)
	if not schema.ix_schemas then
		return self:try_del_raw(dbi, k, k_sz)
	end
	--indexed: read the row value first to recompute its index keys, then delete
	--the row and remove its index entries.
	local ok, v0, v0_sz = self:get_raw(dbi, k, k_sz)
	if not ok then return false, v0 end
	local v0u = v0; v0 = del_v0_buffer(v0_sz); copy(v0, v0u, v0_sz)
	assert(self:try_del_raw(dbi, k, k_sz))
	for _,ix_schema in ipairs(schema.ix_schemas) do
		ix_schema:del(self, k, k_sz, v0, v0_sz)
	end
	return true
end
function Db:del(tab, ...)
	local ok, err = self:try_del(tab, ...)
	if ok then return end
	self:check('del', false, '%s: %s', self:table_name(tab), err)
end

function Db:try_put_records(tab, cols, records)
	if istab(cols) then
		cols, records = '[]', cols
	end
	local dbi, schema = self:dbi_schema(tab, 'w')
	local cols, as = cols_list(cols)
	cols = cols or schema.cols
	local k, k_buf_sz = key_rec_buffer(schema.key_fields.max_rec_size)
	local v, v_buf_sz = val_rec_buffer(schema.val_fields.max_rec_size)
	for _,vals in ipairs(records) do
		local k_sz = encode_key(self, schema, 'put_rec', nil, k, k_buf_sz, cols, as, vals)
		local v_sz = encode_val(self, schema, 'put_rec', v, v_buf_sz, cols, as, vals)
		local ok, err = self:try_put_raw(dbi, k, k_sz, v, v_sz)
		if not ok then
			return false, err
		end
	end
	return true
end

function Db:put_records(...)
	assert(self:try_put_records(...))
end

--cursors --------------------------------------------------------------------

local function check_cur(self, op, ok, ...)
	if ok then return ... end
	self.db:check(op, false, '%s: %s', self.schema.name, (...))
end

local db_try_cursor = Db.try_cursor
function Db:try_cursor(tab, mode)
	local cur, err = db_try_cursor(self, tab, mode)
	if not cur then return nil, err end
	cur.schema = self.dbim[cur:dbi()]
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
	local k_sz = encode_key(self, schema, 'c_get', nil, k, k_buf_sz, schema.key_cols, nil, ...)
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
		return false, 'not_found'
	end
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
	local v_sz = encode_val(self, schema, 'c_update', v, v_buf_sz, val_cols, '{}', t)
	if not schema.ix_schemas then
		assert(self:set_raw(v, v_sz))
	else
		--check would-be unique index violations so we can return before updating.
		--copy k and v0 first: mdbx invalidates get-pointers on the next write.
		local db = self.db
		local kk = cur_k_buffer(k_sz); copy(kk, k, k_sz)
		local v0c = cur_v0_buffer(v0_sz); copy(v0c, v0, v0_sz)
		for _, ix_schema in ipairs(schema.ix_schemas) do
			if not ix_schema.dup_keys then
				local ok, err = ix_schema:check_unique(db, kk, k_sz, v, v_sz)
				if not ok then return false, err end
			end
		end
		assert(self:set_raw(v, v_sz))
		for _, ix_schema in ipairs(schema.ix_schemas) do
			assert(ix_schema:update(db, kk, k_sz, v, v_sz, v0c, v0_sz))
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

local MS = {engime = 'mdbx'}

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

function Db:create_fk(fk)
	local dbi, schema = self:dbi_schema(fk.ref_table)
	add(attr(schema, 'fks'), fk)
	--self.db:on(fk.table, 'put', function()
	--	--
	--end)
	local fk_del
	if fk.onupdate == 'cascade' then
		function fk_del()

		end
	elseif fk.onupdate == 'set null' then
		function fk_del()

		end
	else --assume restrict
		function fk_del()

		end
	end
	self:on(fk.ref_table, 'del', fk_del)
end

function Db:drop_fk(fk)

end

function Db:sync_schema(src, opt)
	assert(not self.schema)
	opt = opt or empty
	local src_sc =
		schema.isschema(src) and src
		or inherits(src, mdbx_db) and src:extract_schema()
		or assertf(false, 'schema or mdbx_db expected, got %s', type(src))
	local function P(...)
		pr(fmt(...))
	end
	self:atomic(opt.dry and 'r' or 'w', function()
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
							self:create_fk(fk)
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
	end)
end
