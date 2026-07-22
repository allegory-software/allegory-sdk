--[[

	structured data and multi-key indexing for mdbx.
	Written by Cosmin Apreutsei. Public Domain.

FEATURES
	- scalars: 8, 16, 32 bit int signed/unsigned; 32 and 64 bit floats; bool.
	- arrays: fixed-size (zero-padded) and variable-size.
	- table/index keys: composite, with per-field ascending/descending order.
	- null support (nulls come first in keys).
	- auto-increment primary keys.
	- indexes: unique and non-unique, utf-8 ai_ci, nullable columns for non-unique.
	- foreign keys: cascade or set-null on delete; enforced on insert/update.
	- triggers: Lua functions in schema fired before/after insert/update/delete.
	- computed columns (stored) via Lua functions in schema.
	- automatic schema migration: run DDL to sync stored schema to paper schema.
	- schema validation on table open: stored schema must match paper schema.
LIMITATIONS
	- varsize columns must have `nozero` (no embedded \0) to be used in indexes.
	- columns must have `not_null` to be used in primary keys and unique indexes.
	- primary keys are immutable!
	- utf8_ai_ci can only be used for index keys.
	- fks: only to pk columns, no "restrict", no "onupdate" (pk is immutable).
	- schema layouting errors are non-recoverable.
TABLES
	There can be 3 types of tables in the same database:
	1) raw tables without a schema, to be used only with raw methods.
	2) tables with a static declared-in-code paper schema (see schema.lua).
	can only be created/restructured via sync_schema() and when opened the
	on-disk schema must match the paper schema or dbi_schema() raises.
	this is how you get declarative schemas with automatic schema migration.
	3) tables without a paper schema, created with create_table() and
	restructured manually via DDL ops, since there's no blueprint to sync to.

This API extends the API in mdbx.lua so start there.

DDL
	db:[try_]dbi      (name|dbi) -> dbi             open existing table (once)
	db:table_schema   (name|dbi) -> table_schema    get table schema (if any)
	db:create_table   (name, schema_spec)           create table; no ixs/fks
	db:alter_table    (name|dbi, schema_spec)       change field types/attrs
	db:drop_table     (name|dbi)                    drop table and its ixs/fks
	db:rename_table   (name|dbi, new_name)          rename table (and its ixs)
	db:rename_column  (name|dbi, old_col, new_col)  rename column (and related ixs)
	db:add_index      (name|dbi, ix_spec)           add index
	db:drop_index     (ix_name)                     drop index
	db:add_fk         (fk_spec)                     add foreign key constraint
	db:drop_fk        (table_name, fk_cols)         drop fk; fk_cols='col1,col2...'
	db:sync_schema    ([schema], [opt])             auto-migrate schema to .schema
	db:extract_schema () -> schema                  extract schema
	db:schema_diff    () -> diff                    diff stored vs .schema
CURSORS
	db:cursor         (name|dbi) -> cur      create cursor
UPDATE
	db:insert         (name|dbi, [cols], keysvals...) -> seq  insert
	db:update         (name|dbi, [cols], keysvals...)         update (must exist)
	db:upsert         (name|dbi, [cols], keysvals...)         insert or update
	db:del            (name|uk_name|dbi, keys...) -> deleted  delete
	db:put_records    (name|dbi, [cols, ]{keysvals1,...})     bulk put
	cur:update        ([val_cols], vals...)                   update current
	cur:del           ()                                      delete current
QUERY
	db:[must_|try_]find     (name|dbi, [val_cols], keys...) -> vals...
	db:is_null              (name|dbi, col, keys...) -> is_null, [reason]
	db:exists               (name|dbi, keys...) -> record_exists
	db:each[_reverse]       (name|dbi, [val_cols]) -> iter() -> cur, keysvals...
	db:each_prefix          (name|dbi, [val_cols], pk_val1, ...) -> iter() -> cur, keysvals...
	db:each_dup       (ix_name|ix_dbi, [val_cols], keys...) -> iter() -> cur, keysvals...
	cur:[must_|try_]move    (op, [val_cols]) -> keysvals...
	cur:[must_|try_]first   ([val_cols]) -> keysvals...
	cur:[must_|try_]last    ([val_cols]) -> keysvals...
	cur:[must_|try_]next    ([val_cols]) -> keysvals...
	cur:[must_|try_]prev    ([val_cols]) -> keysvals...
	cur:[must_|try_]current ([val_cols]) -> keysvals...
	cur:[must_|try_]find    ([val_cols], keys...) -> vals...
	cur:[try_]find_prefix   ([val_cols], pk_val1, ...) -> keysvals...
	cur:is_null             (col) -> is_null, [reason]
	cur:each_prefix         ([val_cols], pk_val1, ...) -> iter() -> cur, keysvals...
	cur:each_dup            ([val_cols], keys...) -> iter() -> cur, keysvals...
	cur:each_current_dup    ([val_cols]) -> iter() -> cur, keysvals...
ENCODING / DECODING
	db:decode_kv   (name|dbi, k,k_sz, v,v_sz, [val_cols]) -> keysvals...
	cur:decode_kv  (k,k_sz, v,v_sz, [val_cols]) -> keysvals...
	db:col_decoder (schema, col, ix_key, pk, get_base_val) -> get()
	db:key_encoder (schema, cols, key_schema, ix_key, pk, get_base_val) -> enc()

COLUMS LISTS & IN/OUT VALUES FORMATS

	cols format   |  vals...              | keysvals...
	--------------+-----------------------+------------
	nil           |  col1_val,...         | keycol1_val,..., col1_val,...
	'col1 ...'    |  col1_val,...         | keycol1_val,..., col1_val,...
	'[col1 ...]'  |  {col1_val,...}       | {keycol1_val,..., col1_val,...}
	'{col1 ...}'  |  {col1=col1_val,...}  | {keycol1=keycol1_val,col1=col1_val}

INDEX QUERYING

	All query ops that return values accept index tables named TABLE/COL1,COL2
	as input and lookup and decode values form the base table automatically.

SCHEMA SPEC (create_table, alter_table)

	schema_spec: {
		fields = {
			{
				col=name, mdbx_type='u32|i32|u8|i8|u16|i16|f32|f64|utf8|bool',
				[not_null=true], [maxlen=N], [nozero=true], [padded=true]
			}, ...
		},
		pk = {'col1', ...},
	}

	NOTE: ixs and fks are NOT part of schema_spec! add them after create_table
	via add_index/add_fk.

	ix_spec:  {'col1', 'col2', ..., [is_unique=true]}
	fk_spec:  {table='t', cols={'col',...}, ref_table='r', ref_cols={'col',...},
					[ondelete='cascade'|'set null'], [onupdate='cascade']}

STATE

	db.schema.tables[table_name] -> paper_schema
		- db.schema itself is a schema object, see schema.lua.
		- layouting and compiling add many fields to it but *not* mutable state.
		so it is seen as global-shared (DDL is forbidden on paper schemas).
	table_schema.indexes -> {ix_schema1,...,[ix_name]=ix_schema}
		- all index schemas shared by ixs and fks (runtime).
	index_schema.val_schema -> table_schema
		- used by index lookup (runtime).
	table_schema.ref_fks[table_name/fk_name] -> fk (runtime) | true (stored).
		- reverse fk declarations used by fk enforcement.
	fk.index -> index_schema
		- used by fk enforcement (runtime).
	db.live_schema[table_name|index_name] -> paper_schema | stored_schema
	db.dirty_schema[table_name|index_name] -> true
		- live schema cache managed by dbi_schema() and DDL ops (transactional).
		- dirty_schema is used to invalidate DDL-modified schemas on txn end.

SCHEMA LOADING STEPS

	- load stored schema (already layouted); must be present.
	- look up paper schema and layout it (which also layouts its indexes).
	- if both present, compare and use paper schema as live schema.
	- if paper schema missing, use stored schema as live schema.
	- compile live schema (which compiles its indexes and fks).
	- register live schema in live cache along with its indexes.

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

local Db = mdbx_db
local Cur = mdbx_cursor
local MS = {}

MDBX_MAX_KEY_SIZE = mdbx_max_key_size()

--little optimization to avoid allocating a pointer on each cur:closed() check.
cdef'int mdbx_cursor_has_txn(const MDBX_cursor *cursor)'
function Cur:closed()
	return not (self.c and C.mdbx_cursor_has_txn(self.c) == 1)
end

--ERROR HANDLING -------------------------------------------------------------

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

--DML GLOBAL SHARED BUFFERS --------------------------------------------------

local key_rec_buffer = u8a(MDBX_MAX_KEY_SIZE)
local key_decode_buffer = u8a(MDBX_MAX_KEY_SIZE)
local val_rec_buffer = buffer()
local v0_buffer = buffer()
local fk_key_buffer = u8a(MDBX_MAX_KEY_SIZE)
local put_k_buffer = u8a(MDBX_MAX_KEY_SIZE)
mdbx_key_rec_buffer = key_rec_buffer

--ROW ENCODING & DECODING ----------------------------------------------------

cdef[[
typedef int8_t   i8;
typedef int16_t  i16;
typedef int32_t  i32;
typedef uint8_t  bool8;
typedef uint8_t  u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef float    f32;
typedef double   f64;

typedef enum schema_col_type {
	schema_col_type_i8,
	schema_col_type_i16,
	schema_col_type_i32,
	schema_col_type_u8,
	schema_col_type_u16,
	schema_col_type_u32,
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

int schema_key_reencode(
	schema_table* fk_ix, schema_table* parent,
	const void* fk_key, int fk_key_size,
	void* out, int out_size
);

void schema_val_add_start(schema_table* tbl,
	void* rec, int rec_buf_size,
	u8** pp
);

void schema_val_add(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, int val_len,
	u8** pp
);

void schema_sort_u32_be(void* buf, void* tmp, size_t n);
int schema_find_u32_be(const void* buf, size_t n, const void* key);
]]

mdbx_schema_sort_u32_be = C.schema_sort_u32_be
mdbx_schema_find_u32_be = C.schema_find_u32_be

local col_ct = {
	utf8 = 'u8',
	bool = 'u8',
}

local schema_col_types = {
	i8     = C.schema_col_type_i8,
	i16    = C.schema_col_type_i16,
	i32    = C.schema_col_type_i32,
	u8     = C.schema_col_type_u8,
	u16    = C.schema_col_type_u16,
	u32    = C.schema_col_type_u32,
	f32    = C.schema_col_type_f32,
	f64    = C.schema_col_type_f64,
	utf8   = C.schema_col_type_u8,
	bool   = C.schema_col_type_u8,
}

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
local function cols_list(cols)
	if not cols then return nil, nil end
	if cols == '[]' then return nil, '[]' end
	if cols == '{}' then return nil, '{}' end
	local as = cols:starts'[' and '[]' or cols:starts '{' and '{}' or nil
	return m_cols_list(cols), as
end

local function check_cols(schema, cols, vals)
	if cols then
		for _,col in ipairs(cols) do
			assertf(schema.fields[col], 'unknown field: %s.%s', schema.name, col)
		end
	elseif vals then
		for col in pairs(vals) do
			if isstr(col) then
				assertf(schema.fields[col], 'unknown field: %s.%s', schema.name, col)
			end
		end
	end
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

local pp = new'u8*[1]'

local function encode_key(
	self, schema, event, autoinc_f,
	rec, rec_buf_sz, cols, as, ...
)
	if #schema.key_fields == 0 then return 0 end
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
			if not f.not_null then
				C.schema_key_add(schema._st, ki-1, rec, rec_buf_sz, -1, pp)
			else
				self:check_col(event, schema.name, f.col, false, 'null_key')
			end
		else
			local len = f.encode(self, event, pp[0], val)
			C.schema_key_add(schema._st, ki-1, rec, rec_buf_sz, len, pp)
		end
	end
	return pp[0] - rec, autoinc_v
end
mdbx_encode_key = encode_key

local function key_reencode(fk_ix, parent, fk_key, fk_key_size, out, out_size)
	return C.schema_key_reencode(fk_ix._st, parent._st,
		fk_key, fk_key_size, out, out_size)
end
mdbx_key_reencode = key_reencode

local function encode_key_prefix(
	self, schema, event,
	rec, rec_buf_sz, n, partial, ...
)
	pp[0] = rec
	for ki = 1, n do
		local f = schema.key_fields[ki]
		local val = select(ki, ...)
		if val == nil or val == null then
			val = resolve_null_val(schema, f)
		end
		if val == nil then
			assert(not (partial and ki == n), 'partial key prefix is null')
			if not f.not_null then
				C.schema_key_add(schema._st, ki-1, rec, rec_buf_sz, -1, pp)
			else
				self:check_col(event, schema.name, f.col, false, 'null_key')
			end
		else
			local len = f.encode(self, event, pp[0], val)
			C.schema_key_add(schema._st, ki-1, rec, rec_buf_sz, len, pp)
		end
	end
	if partial then --last key val was a prefix so remove its \0 terminator.
		pp[0] = pp[0] - schema.key_fields[n].elem_size
	end
	return pp[0] - rec
end
mdbx_encode_key_prefix = encode_key_prefix

local function encode_val(self, schema, event, rec, rec_buf_sz, cols, as, ...)
	if #schema.val_fields == 0 then return 0 end
	C.schema_val_add_start(schema._st, rec, rec_buf_sz, pp)
	for vi,f in ipairs(schema.val_fields) do
		local val = select_col(cols, as, f.col, ...)
		if val == nil then
			val = resolve_null_val(schema, f)
		elseif val == null then
			val = nil
		end
		if val == nil and f.not_null and not f.generate then
			self:check_col(event, schema.name, f.col, false, 'not_null')
		end
		local len = val ~= nil and f.encode(self, event, pp[0], val) or -1
		C.schema_val_add(schema._st, vi-1, rec, rec_buf_sz, len, pp)
	end
	return pp[0] - rec
end

local pout = new'const u8*[1]'
local decode_pp = new'const u8*[1]'

local function decode_key(schema, rec, rec_sz, t, as, i0)
	i0 = i0 or 1
	local key_fields = schema.key_fields
	local out, out_sz = key_decode_buffer, MDBX_MAX_KEY_SIZE
	decode_pp[0] = rec
	local n = #key_fields
	for i=1,n do
		local f = key_fields[i]
		local len = C.schema_get_key(schema._st, i-1,
			rec, rec_sz,
			out, out_sz,
			pout, decode_pp)
		local k = as == '{}' and f.col or i0 + i - 1
		if len ~= -1 then
			t[k] = f.decode(pout[0], len)
		else
			t[k] = nil
		end
	end
	return i0 + n
end

local function decode_val(schema, rec, rec_sz, t, cols, as, i0)
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

local function decode_val_with_null(schema, v, v_sz, t)
	for vi, f in ipairs(schema.val_fields) do
		local len = C.schema_get_val(schema._st, vi-1, v, v_sz, pout)
		t[f.col] = len ~= -1 and f.decode(pout[0], len) or null
	end
end

--[[
decode one index col from the appropriate record into a decoded value. f must be
a field of val_schema; key fields are read from k/k_sz, val fields from v/v_sz.
kb/kb_sz is a scratch buffer for key col decode (for descending key inversion).
]]
local function decode_ix_col(val_schema, f, k, k_sz, v, v_sz, kb, kb_sz)
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

local function decode_kv(self, schema, k, k_sz, v, v_sz, val_cols)
	local i0 = 1
	local t = {}
	local as
	if schema.is_index then
		local val_table = assert(schema.val_table)
		local t_dbi     = assert(self.dbis[val_table])
		local t_schema  = assert(schema.val_schema)
		val_cols, as = cols_list(val_cols)
		check_cols(t_schema, val_cols)
		val_cols = val_cols or t_schema.val_cols
		local k, k_sz = v, v_sz
		local ok
		ok, v, v_sz = self:find_raw(t_dbi, k, k_sz)
		assert(ok, v)
		i0 = decode_key(t_schema, k, k_sz, t, as, i0)
		schema = t_schema
	else
		val_cols, as = cols_list(val_cols)
		check_cols(schema, val_cols)
		val_cols = val_cols or schema.val_cols
		if k then --if k is given it is decoded before v.
			i0 = decode_key(schema, k, k_sz, t, as, i0)
		end
	end
	i0 = decode_val(schema, v, v_sz, t, val_cols, as, i0)
	if as then
		return t, i0-1
	else
		return unpack(t, 1, i0-1)
	end
end

function Db:decode_kv(tab, ...)
	local schema = assert(self:table_schema(tab), 'table has no schema')
	return decode_kv(self, schema, ...)
end

function Cur:decode_kv(k, k_sz, v, v_sz, val_cols)
	return decode_kv(self.db, self.schema, k, k_sz, v, v_sz, val_cols)
end

--[[
Compile a single-column decoder for use in hot iteration loops.
ix_key: MDBX_val holding the index key (nil when schema is a base table).
pk: MDBX_val holding the base table pk (dup value when schema is an index).
get_base_val() -> data, sz; called lazily when a val field is needed.
Returns f() -> decoded value for the current cursor position.
]]
function Db:col_decoder(schema, col, ix_key, pk, get_base_val)
	local out, out_sz = key_decode_buffer, MDBX_MAX_KEY_SIZE
	local ix_f = schema.is_index and schema.fields[col]
	--an ai_ci index key stores lowercased, accent-stripped text, not the
	--original; the original is only in the base table.
	if ix_f and ix_f.mdbx_collation == 'utf8_ai_ci' then ix_f = nil end
	if ix_f then
		local st, ki, decode = schema._st, ix_f.key_index-1, ix_f.decode
		return function()
			local len = C.schema_get_key(st, ki, ix_key.data, ix_key.size,
				out, out_sz, pout, nil)
			return len ~= -1 and decode(pout[0], len) or nil
		end
	end
	local base_schema = schema.val_schema or schema
	local base_f = base_schema.fields[col]
	if base_f.key_index then
		local st, ki, decode = base_schema._st, base_f.key_index-1, base_f.decode
		return function()
			local len = C.schema_get_key(st, ki, pk.data, pk.size,
				out, out_sz, pout, nil)
			return len ~= -1 and decode(pout[0], len) or nil
		end
	else
		local st, vi, decode = base_schema._st, base_f.val_index-1, base_f.decode
		return function()
			local v, v_sz = get_base_val()
			local len = C.schema_get_val(st, vi, v, v_sz, pout)
			return len ~= -1 and decode(pout[0], len) or nil
		end
	end
end

--[[
Compile a key encoder for use in hot iteration loops.
schema: base-table schema or index schema for ix_key and pk.
cols: columns to read; cols[i] becomes key_schema's i-th key field.
key_schema: schema of the encoded key.
ix_key: MDBX_val holding the index key (nil when schema is a base table).
pk: MDBX_val holding the base table pk (dup value when schema is an index).
get_base_val() -> data, sz; called lazily when a val field is needed.
Returns: `enc() -> true, p, sz` for the current cursor position, or `false` if
any column is null.
]]
function Db:key_encoder(
	schema, cols, key_schema, ix_key, pk,
	get_base_val
)
	local table_schema = schema.val_schema or schema
	local col_reads = {}
	local key_prefix_schema, key_prefix_rec
	local output_has_ai_ci
	local all_cols_not_null = true
	-- col_reads[i] = {schema, field, record | nil}.
	-- nil record -> field in the base-table value.
	for i, col in ipairs(cols) do
		output_has_ai_ci = output_has_ai_ci
			or key_schema.key_fields[i].mdbx_collation == 'utf8_ai_ci'
		local field_schema = schema
		local field = schema.fields[col]
		local record = schema.is_index and ix_key or pk
		if not field or not field.key_index
			or field.mdbx_collation == 'utf8_ai_ci'
		then
			field_schema = table_schema
			field = table_schema.fields[col]
			record = field.key_index and pk or nil
		end
		all_cols_not_null = all_cols_not_null and field.not_null
		col_reads[i] = {
			schema = field_schema,
			field = field,
			record = record,
		}
		if i == 1 then
			key_prefix_schema = field_schema
			key_prefix_rec = record
		end
		if field_schema ~= key_prefix_schema
			or record ~= key_prefix_rec
			or field.key_index ~= i
		then
			key_prefix_schema = nil
		end
	end
	if key_prefix_schema
		and #cols == #key_prefix_schema.key_fields
		and key_prefix_schema.key_sig == key_schema.key_sig
		and all_cols_not_null
	then
		return function()
			return true, key_prefix_rec.data, key_prefix_rec.size
		end
	end
	-- rebuilding cannot apply utf8_ai_ci to base-table text.
	assert(not output_has_ai_ci)

	local out = key_rec_buffer
	if key_prefix_schema then
		return function()
			local sz = key_reencode(key_prefix_schema, key_schema,
				key_prefix_rec.data, key_prefix_rec.size, out,
				MDBX_MAX_KEY_SIZE)
			if sz >= 0 then return true, out, sz end
		end
	end

	local out_pos = pp
	return function()
		out_pos[0] = out
		for i, col_read in ipairs(col_reads) do
			local field = col_read.field
			local len
			if col_read.record then
				local record = col_read.record
				len = C.schema_get_key(col_read.schema._st,
					field.key_index - 1, record.data, record.size,
					out_pos[0], MDBX_MAX_KEY_SIZE - (out_pos[0] - out),
					pout, nil)
			else
				local data, sz = get_base_val()
				len = C.schema_get_val(col_read.schema._st,
					field.val_index - 1, data, sz, pout)
			end
			if len < 0 then return false end
			if pout[0] ~= out_pos[0] then
				copy(out_pos[0], pout[0], len * field.elem_size)
			end
			C.schema_key_add(key_schema._st, i - 1, out,
				MDBX_MAX_KEY_SIZE, len, out_pos)
		end
		return true, out, out_pos[0] - out
	end
end

--SCHEMA LAYOUTING AND COMPILATION -------------------------------------------

local format_ix_name, format_fk_name, index_schema, compile_index_schema --fw. decl.

--a field's type: the attrs that determine its on-disk encoding.
local field_type_attrs = {
	mdbx_type=1, --scalar/element type; selects the encoding and element size
	maxlen=1, --max array/string length
	padded=1, --fixsize (padded to maxlen)
	nozero=1, --forbid embedded \0 (required on varsize cols if used as keys)
	mdbx_collation=1, --not really a collation but enables utf8_ai_ci indexes.
}

local function valid_col_name(col)
	return isstr(col) and #col > 0 and not col:find'[^a-z0-9_]'
end

local function encoded_maxlen(schema, f)
	local maxlen = f.maxlen
	if schema.is_index and maxlen
		and f.mdbx_type == 'utf8' and f.mdbx_collation == 'utf8_ai_ci'
	then
		return maxlen * 3
	end
	return maxlen
end

local function table_flags(schema)
	if not schema then return 0 end
	return bor(
		schema.is_index      and C.MDBX_DUPSORT    or 0,
		schema.dup_fixedsize and C.MDBX_DUPFIXED   or 0
	)
end

--create an optimal physical column layout based on a table schema.
local function layout_table_schema(schema)

	if schema.layouted then return end
	schema.layouted = true

	local table_name = assert(schema.name)

	--index fields by name, typecheck, check for inconsistencies.
	for i,f in ipairs(schema.fields) do
		assertf(valid_col_name(f.col),
			'invalid field name: %s.%s', table_name, f.col)
		assertf(not schema.fields[f.col] or schema.fields[f.col] == f,
			'duplicate field name: %s.%s', table_name, f.col)
		schema.fields[f.col] = f
		f.col_pos = i
		assertf(schema_col_types[f.mdbx_type] ~= nil,
			'unknown type: %s for field: %s.%s', f.mdbx_type, table_name, f.col)
		local elem_ct = col_ct[f.mdbx_type] or f.mdbx_type
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
		if not schema.is_index then
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

	local has_generated = false
	for _, f in ipairs(val_fields) do
		if f.generate then has_generated = true; break end
	end
	schema.has_generated = has_generated or nil

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
			local db_max_key_size = mdbx_max_key_size(table_flags(schema))
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

	end --for fields in key_fields, val_fields

	--create and layout index table schemas.
	if schema.ixs or schema.fks then
		local indexes = {}
		for ix_name, ix in pairs(schema.ixs or empty) do
			assert(ix_name == format_ix_name(schema.name, ix))
			local ix_schema = index_schema(schema, ix, ix.is_unique)
			layout_table_schema(ix_schema)
			add(indexes, ix_schema)
			indexes[ix_name] = ix_schema
		end
		for _, fk in pairs(schema.fks or empty) do
			local ix_name = format_ix_name(schema.name, fk.cols)
			local ix_schema = indexes[ix_name] --use matching user index?
			if not ix_schema then
				ix_schema = index_schema(schema, fk.cols)
				layout_table_schema(ix_schema)
				add(indexes, ix_schema)
				indexes[ix_name] = ix_schema
			end
			fk.index = ix_schema
		end
		if #indexes > 0 then
			sort(indexes, function(a, b) return a.name < b.name end)
			schema.indexes = indexes
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

--turn a plain string into the same lowercased, accent-stripped form an
--ai_ci index stores, for comparing/sorting by hand when there's no index
--to do it for us.
local function fold_ai_ci(s)
	local p, sz = encode_ai_ci(s, #s)
	assertf(p, 'utf8_ai_ci: invalid utf8 (%d)', sz)
	return ffi.string(p, sz)
end
mdbx_fold_ai_ci = fold_ai_ci

local function compile_table_schema(schema)

	assert(schema.layouted)

	if schema.compiled then return end
	schema.compiled = true

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

	--compute key signature to check tables for raw key compatibility.
	for _, f in ipairs(key_fields) do
		schema.key_sig = (schema.key_sig and schema.key_sig..',' or '')
			..f.mdbx_type..':'..(f.maxlen or '')
			..':'..(f.padded and 'padded' or '')
			..':'..(f.nozero and 'nozero' or '')
			..':'..(f.mdbx_collation or '')
			..':'..(f.descending and 'desc' or '')
			..':'..(f.not_null and 'not_null' or '')
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

	--setup C schema and create field getters and setters.
	for _,fields in ipairs{key_fields, val_fields} do

		local is_key = fields == key_fields

		for kv_index,f in ipairs(fields) do

			--setup C schema.
			local sc = fields._sc[kv_index-1]
			sc.type = schema_col_types[f.mdbx_type]
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
			elseif f.mdbx_type == 'bool' then
				function f.encode(db, event, buf, val)
					cast(elemp_ct, buf)[0] = val and 1 or 0
					return 1
				end
				function f.decode(p)
					return cast(elemp_ct, p)[0] == 1
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
		compile_index_schema(schema)
	elseif schema.indexes then --compile indexes
		for _, ix_schema in ipairs(schema.indexes) do
			compile_table_schema(ix_schema)
		end
	end

end

function Db:save_table_schema(schema)
	assert(schema.layouted)
	--NOTE: only saving enough information to read the data back in absence of
	--a paper schema, and to validate a paper schema against the used layout.
	local t = {
		format = 1, --layout format (the only one we have, implemented here)
		dyn_offset_size = schema.dyn_offset_size,
		key_fields = {max_rec_size = schema.key_fields.max_rec_size},
		val_fields = {max_rec_size = schema.val_fields.max_rec_size},
		is_unique = schema.is_unique,
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
		for ix_name, ix in pairs(schema.ixs) do
			t.ixs[ix_name] = extend({
				is_unique = ix.is_unique,
				desc = imap(ix.desc),
			}, ix)
		end
	end
	if schema.fks then
		t.fks = {}
		for fk_name, fk in pairs(schema.fks) do
			t.fks[fk_name] = {
				cols = extend({desc = imap(fk.cols.desc)}, fk.cols),
				ref_table = fk.ref_table,
				ref_cols = imap(fk.ref_cols),
				ondelete = fk.ondelete,
			}
		end
	end
	if schema.ref_fks then --backrefs (parent side): {key->true} -> {key->fk}
		t.ref_fks = {}
		for k in pairs(schema.ref_fks) do
			t.ref_fks[k] = true
		end
	end
	local k = schema.name
	local v, v_sz = string_buffer():encode(t):ref()
	if not self:table_exists'$schema' then
		self:create_table_raw'$schema'
	end
	assert(self:try_put_raw('$schema', k, #k, v, v_sz))
end

function Db:load_table_schema(table_name)
	if table_name == '$schema' then return end
	if not self:table_exists'$schema' then return end
	local k = table_name
	local ok, v, v_len = self:find_raw('$schema', k, #k)
	if not ok then return end
	local schema = string_buffer():set(v, v_len):decode()
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

	--load indexes and fks
	if schema.ixs or schema.fks then

		--load each index once.
		local indexes = {}
		local function load_index(ix_name)
			local ix_schema = indexes[ix_name]
			if ix_schema then return ix_schema end --fk reusing index
			ix_schema = assertf(self:load_table_schema(ix_name),
				'schema missing for index: %s', ix_name)
			assert(ix_schema.is_index and ix_schema.val_table == table_name)
			ix_schema.val_schema = schema
			add(indexes, ix_schema)
			indexes[ix_name] = ix_schema
			return ix_schema
		end

		for ix_name in pairs(schema.ixs or empty) do
			load_index(ix_name)
		end

		--bind foreign keys to their indexes.
		for fk_name, fk in pairs(schema.fks or empty) do
			fk.name = fk_name
			fk.table = table_name
			fk.onupdate = 'cascade' --N/A, for schema diff only
			fk.index = load_index(format_ix_name(table_name, fk.cols))
		end

		--build the deterministic runtime array and name map.
		assert(#indexes > 0)
		sort(indexes, function(a, b) return a.name < b.name end)
		schema.indexes = indexes

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
local function try_validate_table_schema(stored_schema, paper_schema)

	local errs = {}
	local table_name = paper_schema.name or stored_schema.name

	--compare table attributes
	cmp_keys(paper_schema, stored_schema, {
		'dyn_offset_size', 'is_index', 'val_table',
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

	--compare index declarations.
	local pixs = paper_schema.ixs
	local sixs = stored_schema.ixs
	if pixs or sixs then
		cmp_map_str_keys(
			pixs or empty,
			sixs or empty,
			errs, '%s.%s', table_name, 'ixs')
		--comparing ixs by name is not enough: their attrs must match too.
		for ix_name, pix in pairs(pixs or empty) do
			local six = sixs and sixs[ix_name]
			if six then
				cmp_keys(pix, six, {'is_unique'}, errs, '%s', ix_name)
			end
		end
	end

	if #errs > 0 then
		return false, fmt('schema mismatch for table: %s:\n\t%s',
			table_name, cat(errs, '\n\t'))
	end

	return true
end

--DBI OPEN & SCHEMA CACHE LOADING --------------------------------------------

local function load_live_schema(self, name)
	local schema = self.live_schema[name]
	if schema ~= nil then return schema or nil end
	local paper_schema = self.schema and self.schema.tables[name]
	local stored_schema = self:load_table_schema(name)
	if paper_schema and stored_schema then --schemas must match exactly
		layout_table_schema(paper_schema)
		local ok, err = try_validate_table_schema(stored_schema, paper_schema)
		self:check_schema('t_open', name, nil, ok, err)
	elseif paper_schema then --raw table
		self:check_schema('t_open', name, nil, false,
			'trying to open a raw table with a schema')
	elseif stored_schema then --lost paper schema, use stored
		paper_schema = stored_schema
	end
	schema = paper_schema
	if schema then
		compile_table_schema(schema)
		--setting live_schema now prevents cycles on recursive load_live_schema().
		self.live_schema[name] = schema
		for _,ix_schema in ipairs(schema.indexes or empty) do
			self.live_schema[ix_schema.name] = ix_schema
		end
		for k in pairs(schema.ref_fks or empty) do
			local tbl, fk_name = k:match'^([^/]+)/(.+)$'
			schema.ref_fks[k] = load_live_schema(self, tbl).fks[fk_name]
		end
	else
		self.live_schema[name] = false
	end
	return schema or nil
end
function Db:table_schema(tab)
	local name = self:table_name(tab)
	if name:has'/' then --index: resolve base table first which resolves the index
		load_live_schema(self, name:match'^([^/]+)/')
		return self.live_schema[name] or nil
	end
	return load_live_schema(self, name)
end

local function try_open(self, tab)
	local dbi, err = self:try_dbi_raw(tab)
	if not dbi then return nil, err end
	local schema = self:table_schema(tab)
	if schema then
		--open indexes now just to check for errors.
		for _,ix_schema in ipairs(schema.indexes or empty) do
			try_open(self, ix_schema.name)
		end
	end
	return dbi
end
function Db:try_dbi(tab)
	if typeof(tab) == 'number' then return tab end --tab=dbi
	local dbi = self.dbis[tab]
	if dbi then return dbi end
	if tab:has'/' then --index: open base table first which opens the index
		local base_tab = tab:match'^([^/]+)/'
		local dbi, err = try_open(self, base_tab)
		if not dbi then return nil, err end
		local dbi = self.dbis[tab]
		if not dbi then return nil, 'not_found' end
		return dbi
	else
		return try_open(self, tab)
	end
end
function Db:dbi(tab)
	local dbi, err = self:try_dbi(tab)
	if dbi then return dbi end
	return self:check_schema('t_open', self:table_name(tab), nil, nil, err)
end
function Db:try_dbi_schema(tab)
	local dbi, err = self:try_dbi(tab)
	if not dbi then return nil, err end
	return dbi, assert(self:table_schema(tab), 'table has no schema')
end
function Db:dbi_schema(tab)
	local dbi = self:dbi(tab)
	return dbi, assert(self:table_schema(tab), 'table has no schema')
end

--SCHEMA CACHE INVALIDATION --------------------------------------------------

function Db:without_schema(fn)
	if not self.schema or self._in_without_schema then
		fn()
		return
	end
	assert(self.txn, 'not in transaction')
	local real_live_schema = self.live_schema
	local real_schema = self.schema
	--without_schema() temporarily replaces self.live_schema. If fn runs DDL and
	--then aborts, _wtxn_end() clears self.dirty_schema while self.live_schema is
	--the temporary table. Without a local reference to that dirty table, the
	--names changed by the aborted DDL are lost, and restoring real_live_schema
	--can bring back schema objects mutated by the aborted transaction.
	local dirty_schema = self.dirty_schema
	local new_dirty_schema = not dirty_schema
	dirty_schema = dirty_schema or {}
	self.dirty_schema = dirty_schema
	self.live_schema = {}
	self.schema = nil
	self._in_without_schema = true
	local ok, err = pcall(fn)
	self._in_without_schema = false
	for name in pairs(dirty_schema) do
		--invalidate changed schemas before restoring because those schemas
		--could've been stored schemas from tables without a paper schema that
		--must now be reloaded.
		real_live_schema[name] = nil
	end
	--If fn aborted and then opened a new write txn, touch_schema() could have
	--created a new dirty table; invalidate real_live_schema from that table too.
	local current_dirty_schema = self.dirty_schema
	if current_dirty_schema and current_dirty_schema ~= dirty_schema then
		for name in pairs(current_dirty_schema) do
			real_live_schema[name] = nil
		end
	end
	--Do not leave behind the empty dirty table that we created only to keep a
	--stable local reference for touch_schema().
	if new_dirty_schema and current_dirty_schema == dirty_schema
		and not next(dirty_schema)
	then
		self.dirty_schema = nil
	end
	self.schema = real_schema
	self.live_schema = real_live_schema
	assert(ok, err)
end

local function touch_schema(self, name)
	--DDL ops only work on tables without a paper schema because paper schema
	--is immutable and can't be reloaded. that's why sync_schema() wraps DDL
	--in without_schema() so DDL ops can only see and mutate stored schemas.
	assert(not self.schema or not self.schema.tables[name])
	--DDL dirties up live schemas so we mark them and clear them on txn end.
	self.dirty_schema = self.dirty_schema or {}
	self.dirty_schema[name] = true
end

function Db:_wtxn_end(commit, parent)
	if commit and parent then return end --promote dirty marks
	if not self.dirty_schema then return end
	for name in pairs(self.dirty_schema) do
		self.live_schema[name] = nil
	end
	if not parent then
		self.dirty_schema = nil
	end
end

--DDL / CREATE TABLE ---------------------------------------------------------

--paper schema field attrs (the rest are computed by layout).
local paper_field_attrs = update({
	col=1,
	not_null=1,
	mdbx_default=1,
	auto_increment=1,
}, field_type_attrs)

local function copy_base_schema(src, name)
	local schema = {
		name = name or assert(src.name),
		fields = {},
		pk = imap(assert(src.pk)),
	}
	schema.pk.desc = imap(src.pk.desc)
	for _, src_f in ipairs(assert(src.fields)) do
		local f = {}
		for k in pairs(paper_field_attrs) do
			f[k] = src_f[k]
		end
		add(schema.fields, f)
	end
	return schema
end

function Db:create_table(name, src_schema)
	assert(src_schema)
	assert(not src_schema.ixs)
	assert(not src_schema.fks)
	assert(not src_schema.name or src_schema.name == name)
	touch_schema(self, name)
	local schema = copy_base_schema(src_schema, name)
	layout_table_schema(schema)
	local dbi = self:create_table_raw(name, table_flags(schema))
	self:save_table_schema(schema)
	local schema = self:load_table_schema(name)
	compile_table_schema(schema)
	self.live_schema[name] = schema
	for _,ix_schema in ipairs(schema.indexes or empty) do
		self.live_schema[ix_schema.name] = ix_schema
	end
	return dbi
end

--DDL / ALTER TABLE ----------------------------------------------------------

local function check_alter_dependencies(self, old_schema, new_schema)

	--check secondary indexes.
	local pk_changed = schema.pk_change_affects(
			old_schema, new_schema, MS.index_field_attrs)
	for ix_name, ix in pairs(old_schema.ixs or empty) do
		self:check_schema('t_alter', old_schema.name, nil,
			not pk_changed,
			'primary key used by index: %s', ix_name)
		local changed, col =
			schema.cols_change_affects(
				old_schema, new_schema, ix, MS.index_field_attrs)
		self:check_schema('t_alter', old_schema.name, col,
			not changed,
			'column used by index: %s', ix_name)
	end

	--check outgoing foreign keys and their enforcement indexes.
	local fk_pk_changed = schema.pk_change_affects(
			old_schema, new_schema, MS.fk_field_attrs)
	for fk_name, fk in pairs(old_schema.fks or empty) do
		self:check_schema('t_alter', old_schema.name, nil,
			not fk_pk_changed,
			'primary key used by fk index: %s', fk_name)
		local changed, col =
			schema.cols_change_affects(
				old_schema, new_schema, fk.cols, MS.fk_field_attrs)
		self:check_schema('t_alter', old_schema.name, col,
			not changed,
			'column used by fk: %s', fk_name)
	end

	--check foreign keys referencing this table's primary key.
	local ref_pk_changed, col =
		schema.pk_change_affects(
			old_schema, new_schema, MS.fk_field_attrs)
	if ref_pk_changed then
		for _, fk in pairs(old_schema.ref_fks or empty) do
			self:check_schema('t_alter', old_schema.name, col, false,
				'primary key referenced by fk: %s/%s', fk.table, fk.name)
		end
	end
end

local alter_val_layout_attrs = {
	'mdbx_type',
	'maxlen',
	'padded',
	'nozero',
	'not_null',
	'elem_size',
	'val_index',
	'fixed_offset',
	'offset',
}

local function val_reencode_needed(old_schema, new_schema)
	if #old_schema.val_fields ~= #new_schema.val_fields
		or old_schema.dyn_offset_size ~= new_schema.dyn_offset_size
	then
		return true
	end
	for _, old_f in ipairs(old_schema.val_fields) do
		local new_f = new_schema.fields[old_f.col]
		if not new_f or not new_f.val_index then return true end
		for _, attr in ipairs(alter_val_layout_attrs) do
			if old_f[attr] ~= new_f[attr] then return true end
		end
	end
	return false
end

local alter_key_rec_buffer = u8a(MDBX_MAX_KEY_SIZE)

local function alter_values_in_place(self, dbi, old_schema, new_schema, event)
	local cur = self:cursor_raw(dbi)
	local ok, k, k_sz, v, v_sz = cur:first_raw()
	local rec = {}
	while ok do
		local kk = alter_key_rec_buffer; copy(kk, k, k_sz)
		decode_val_with_null(old_schema, v, v_sz, rec)
		local nv, nv_buf_sz =
			val_rec_buffer(new_schema.val_fields.max_rec_size)
		local nv_sz = encode_val(
			self, new_schema, event, nv, nv_buf_sz,
			new_schema.val_cols, '{}', rec)
		assert(cur:try_put_raw(kk, k_sz, nv, nv_sz, C.MDBX_CURRENT))
		ok, k, k_sz, v, v_sz = cur:next_raw()
	end
	cur:close()
end

local function alter_via_temp_table(self, dbi, old_schema, new_schema, event)

	--create the replacement table and capture its sequence.
	local temp_name = '$alter/'..uuid()
	local temp_dbi = self:create_table_raw(temp_name, table_flags(new_schema))
	local sequence = self:seq(dbi, 0)

	--reencode every key and value into the replacement table.
	local rec = {}
	for _, k, k_sz, v, v_sz in self:each_raw(dbi) do
		decode_key(old_schema, k, k_sz, rec, '{}')
		decode_val_with_null(old_schema, v, v_sz, rec)
		local nk, nk_buf_sz =
			alter_key_rec_buffer, MDBX_MAX_KEY_SIZE
		local nv, nv_buf_sz =
			val_rec_buffer(new_schema.val_fields.max_rec_size)
		local nk_sz = encode_key(self, new_schema, event, nil,
			nk, nk_buf_sz, new_schema.cols, '{}', rec)
		local nv_sz = encode_val(
			self, new_schema, event, nv, nv_buf_sz,
			new_schema.cols, '{}', rec)
		local ok, err = self:try_insert_raw(temp_dbi, nk, nk_sz, nv, nv_sz)
		self:check_schema('t_alter', old_schema.name, nil, ok, err)
	end

	--restore table state and replace the old DBI.
	if sequence > 0 then
		self:seq(temp_dbi, sequence)
	end

	assert(self:drop_table_raw(dbi))
	self:rename_table_raw(temp_name, old_schema.name)
end

function Db:alter_table(tab, src_schema)
	local table_name = self:table_name(tab)
	local dbi, old_schema = self:dbi_schema(table_name)
	self:check_schema('t_alter', table_name, nil,
		not old_schema.is_index, 'cannot alter index table')
	assert(not src_schema.name or src_schema.name == table_name)

	--build and validate the new schema.
	local new_schema = copy_base_schema(src_schema, old_schema.name)
	check_alter_dependencies(self, old_schema, new_schema)
	new_schema.ixs = old_schema.ixs
	new_schema.fks = old_schema.fks
	new_schema.ref_fks = old_schema.ref_fks
	layout_table_schema(new_schema)

	--compile fresh runtime schemas for every surviving index.
	compile_table_schema(new_schema)

	--rewrite records when their physical encoding changes.
	touch_schema(self, table_name)
	local event = {type = 'schema', event = 't_alter', table = table_name}
	local rewrite_keys =
		schema.pk_change_affects(
			old_schema, new_schema, MS.index_field_attrs)
	if rewrite_keys then
		alter_via_temp_table(self, dbi, old_schema, new_schema, event)
	elseif val_reencode_needed(old_schema, new_schema) then
		alter_values_in_place(self, dbi, old_schema, new_schema, event)
	end

	--install the new schema graph.
	self:save_table_schema(new_schema)
	self.live_schema[table_name] = new_schema
	for _, ix_schema in ipairs(new_schema.indexes or empty) do
		touch_schema(self, ix_schema.name)
		self.live_schema[ix_schema.name] = ix_schema
	end
	return true
end

function Db:drop_table(tab)
	local name = self:table_name(tab)
	local dbi, schema = self:try_dbi_schema(name)
	if not dbi then return nil, schema end --schema=err
	touch_schema(self, name)
	--as a child: drop the reverse refs our fks hold on their parents.
	if schema.fks then
		for fk_name, fk in pairs(schema.fks) do
			local _, ref_schema = self:dbi_schema(fk.ref_table)
			if ref_schema and ref_schema.ref_fks then
				touch_schema(self, ref_schema.name)
				ref_schema.ref_fks[name..'/'..fk_name] = nil
				if not next(ref_schema.ref_fks) then ref_schema.ref_fks = nil end
				self:save_table_schema(ref_schema)
			end
		end
	end
	--as a parent: untangle children referencing us (drop their fks, keep them).
	if schema.ref_fks then
		for _, fk in pairs(schema.ref_fks) do
			local _, child_schema = self:dbi_schema(fk.table)
			if child_schema then self:detach_fk(child_schema, fk.name, fk) end
		end
	end
	for _,ix_schema in ipairs(schema.indexes or empty) do
		self:drop_table(ix_schema.name)
	end
	assert(self:drop_table_raw(dbi))
	self:drop_table_schema(name)
	self.live_schema[name] = nil
	return true
end

--DDL / RENAME TABLE ---------------------------------------------------------

--[[
rename an index table to new_ix: rename the dbi, move its $schema row, and fix
its back-references (name, val_table) and the val_schema.ixs map. val_table is
taken from val_schema.name, so this works both when the table itself was renamed
(name already updated) and when only the index names change (column rename).
]]
local function rename_index(self, val_schema, ix_schema, new_ix)
	local old_ix = ix_schema.name
	touch_schema(self, old_ix)
	touch_schema(self, new_ix)
	self:rename_table_raw(old_ix, new_ix)
	self:drop_table_schema(old_ix)
	self.live_schema[old_ix] = nil
	ix_schema.name = new_ix
	ix_schema.val_table = val_schema.name
	self:save_table_schema(ix_schema)
	self.live_schema[new_ix] = ix_schema
	val_schema.indexes[old_ix] = nil
	val_schema.indexes[new_ix] = ix_schema
	if val_schema.ixs and val_schema.ixs[old_ix] ~= nil then --user index: rekey ixs.
		val_schema.ixs[new_ix] = val_schema.ixs[old_ix]
		val_schema.ixs[old_ix] = nil
	end
end
function Db:rename_table(tab, new_name)
	local old_name = self:table_name(tab)
	touch_schema(self, old_name)
	touch_schema(self, new_name)
	local schema = self:table_schema(old_name)
	for _, fk in pairs(schema and schema.fks or empty) do
		if fk.ref_table ~= old_name then self:dbi_schema(fk.ref_table) end
	end
	self:rename_table_raw(old_name, new_name)
	self.live_schema[old_name] = nil
	if not schema then
		self.live_schema[new_name] = false
		return
	end
	schema.name = new_name --set first: rename_index derives val_table from it
	self.live_schema[new_name] = schema
	--index table names embed the table name, so rename each.
	for _, ix_schema in ipairs(schema.indexes or empty) do
		rename_index(self, schema, ix_schema,
			new_name .. ix_schema.name:sub(#old_name + 1))
	end
	--fk references embed table names; fix them after the index rename above.
	if schema.fks then --as a child: its fk.table and each parent's reverse ref.
		for fk_name, fk in pairs(schema.fks) do
			fk.table = new_name
			local self_ref = fk.ref_table == old_name
			if self_ref then fk.ref_table = new_name end
			local ref_schema = self_ref and schema
				or select(2, self:dbi_schema(fk.ref_table))
			if ref_schema and ref_schema.ref_fks then
				touch_schema(self, ref_schema.name)
				ref_schema.ref_fks[old_name..'/'..fk_name] = nil
				ref_schema.ref_fks[new_name..'/'..fk_name] = fk
				if not self_ref then self:save_table_schema(ref_schema) end
			end
		end
	end
	if schema.ref_fks then --as a parent: each referencing child points back to us.
		for _, fk in pairs(schema.ref_fks) do
			if fk.table ~= new_name then --self-refs handled in the fks loop
				local _, child_schema = self:dbi_schema(fk.table)
				if child_schema then
					touch_schema(self, child_schema.name)
					fk.ref_table = new_name
					self:save_table_schema(child_schema)
				end
			end
		end
	end
	self:drop_table_schema(old_name)
	self:save_table_schema(schema)
end

--DDL / RENAME COLUMN --------------------------------------------------------

--[[
rename a column. encoding is positional (col_pos + offsets), so no row or index
data is rewritten; this only updates names: the field, the pk, the dependent
index/fk-index tables (whose names embed the column), the fks that use the
column, and the (descriptive) ref_cols of children when a pk column is renamed.
]]
local function rename_in_list(list, old, new) --returns true if `old` was present
	for i = 1, #list do
		if list[i] == old then list[i] = new; return true end
	end
end
function Db:rename_column(tab, old_col, new_col)
	local dbi, schema = self:dbi_schema(tab)
	local f = schema.fields[old_col]
	self:check_schema('c_rename', schema.name, old_col, f, 'not_found')
	self:check_schema('c_rename', schema.name, new_col,
		valid_col_name(new_col),
		'invalid field name: %s.%s', schema.name, new_col)
	self:check_schema('c_rename', schema.name, new_col,
		not schema.fields[new_col], 'column exists: %s.%s', schema.name, new_col)
	touch_schema(self, schema.name)
	local in_pk = schema.pk and rename_in_list(schema.pk, old_col, new_col)
	f.col = new_col
	schema.fields[new_col] = f
	schema.fields[old_col] = nil
	--indexes containing the column: their names embed it, so rename the tables.
	for _, ix in ipairs(schema.indexes or empty) do
		if rename_in_list(ix.pk, old_col, new_col) then
			local xf = ix.fields[old_col] --the index's own field copy
			if xf then
				xf.col = new_col
				ix.fields[new_col] = xf
				ix.fields[old_col] = nil
			end
			local old_ix = ix.name
			local new_ix = format_ix_name(schema.name, ix.pk)
			local ix_def = schema.ixs and schema.ixs[old_ix]
			if ix_def and ix_def ~= ix.pk then
				assert(rename_in_list(ix_def, old_col, new_col))
			end
			rename_index(self, schema, ix, new_ix)
		end
	end
	if schema.indexes then
		sort(schema.indexes, function(a, b) return a.name < b.name end)
	end
	--fks using the column (child side): update cols, identity and parent reverse ref.
	if schema.fks then
		local fks = {}
		for fk_name, fk in pairs(schema.fks) do
			rename_in_list(fk.cols, old_col, new_col)
			local new_fk_name = format_fk_name(fk.cols)
			if new_fk_name ~= fk_name then
				local ref_schema = fk.ref_table == schema.name and schema
					or select(2, self:dbi_schema(fk.ref_table))
				touch_schema(self, ref_schema.name)
				ref_schema.ref_fks[schema.name..'/'..fk_name] = nil
				fk.name = new_fk_name
				ref_schema.ref_fks[schema.name..'/'..new_fk_name] = fk
				if ref_schema ~= schema then self:save_table_schema(ref_schema) end
			end
			fks[new_fk_name] = fk
		end
		schema.fks = fks
	end
	--this table is a parent and a pk column changed: fix children's ref_cols.
	if in_pk and schema.ref_fks then
		for _, fk in pairs(schema.ref_fks) do
			local _, child = self:dbi_schema(fk.table)
			if child and fk.ref_cols then
				touch_schema(self, child.name)
				if rename_in_list(fk.ref_cols, old_col, new_col) then
					self:save_table_schema(child)
				end
			end
		end
	end
	--rebuild name-derived state (col lists, C schema): the table first, then every
	--index, since each index's val_cols references the table's (now rebuilt) list.
	schema.compiled = nil
	compile_table_schema(schema)
	for _, ix in ipairs(schema.indexes or empty) do
		ix.compiled = nil
		compile_table_schema(ix)
	end
	self:save_table_schema(schema)
	return true
end

--INDEXES --------------------------------------------------------------------

local ix1_key_rec_buffer = u8a(MDBX_MAX_KEY_SIZE)
local ix2_key_rec_buffer = u8a(MDBX_MAX_KEY_SIZE)
local ix_pk_col_buf = u8a(MDBX_MAX_KEY_SIZE)

local function ix_cols(cols)
	local t = {}
	for i,col in ipairs(cols) do
		t[i] = cols.desc and cols.desc[i] and col..':desc' or col
	end
	return t
end
--[[local]] function format_ix_name(tbl_name, cols)
	return _('%s/%s', tbl_name, cat(ix_cols(cols), ','))
end

--[[local]] function index_schema(val_schema, src_cols, is_unique)
	local cols = imap(src_cols)
	cols.desc = imap(src_cols.desc)
	local ix_name = format_ix_name(val_schema.name, cols)
	local ix_fields = {}
	for _,col in ipairs(cols) do
		local f = assertf(val_schema.fields[col],
			'index: %s unknown field %s.%s', ix_name, val_schema.name, col)
		if is_unique then
			assertf(f.not_null, 'unique index %s col must be not_null: %s.%s',
				ix_name, val_schema.name, col)
		end
		local ix_f = {
			col = f.col,
			not_null = f.not_null,
		}
		for k in pairs(field_type_attrs) do
			ix_f[k] = f[k]
		end
		add(ix_fields, ix_f)
	end
	local ix_schema = {
		name = ix_name,
		fields = ix_fields,
		pk = cols,
		is_unique = is_unique,
		is_index = true,
		val_table = val_schema.name,
		val_schema = val_schema,
	}
	return ix_schema
end

--[[local]] function compile_index_schema(ix_schema)

	assert(ix_schema.is_index)

	local val_table = assert(ix_schema.val_table)
	local val_schema = assert(ix_schema.val_schema) --base table is layouted

	local cols = cols_list(cat(ix_schema.pk, ' '))
	local dt = {}

	--default val_cols for index tables are the val_cols of the val_table.
	ix_schema.val_cols = val_schema.val_cols

	--dup values (base table pks) have fixed size when the pk is fixed-size.
	--used for the MDBX_DUPFIXED flag (table_flags) and bulk iteration (each_dup).
	local dup_fixed = true
	for _, f in ipairs(val_schema.key_fields) do
		if f.maxlen and not f.padded then
			dup_fixed = false
			break
		end
	end
	ix_schema.dup_fixedsize = dup_fixed and val_schema.key_fields.max_rec_size or nil

	--[[
	an index col may be a pk col of the val_table (e.g. composite-pk fk). for the
	common val-only case, decode_val handles everything. for the mixed case, decode
	each col individually into the right positional slot (dt[i] for cols[i]):
	val cols via schema_get_val, pk cols via schema_get_key with pp=nil (random
	access mode -- skips the sequential-scan optimisation, but avoids a separate
	buffer and stays with the cheap integer-keyed dt arrays throughout).
	]]
	local has_pk_col = false
	for _, col in ipairs(cols) do
		if val_schema.fields[col].key_index then has_pk_col = true; break end
	end
	local function decode_ix_into(k, k_sz, v, v_sz, out_dt)
		if not has_pk_col then
			decode_val(val_schema, v, v_sz, out_dt, cols, '[]')
			return
		end
		local kb, kb_sz = ix_pk_col_buf, MDBX_MAX_KEY_SIZE
		for i, col in ipairs(cols) do
			out_dt[i] = decode_ix_col(val_schema, val_schema.fields[col],
				k, k_sz, v, v_sz, kb, kb_sz)
		end
	end
	local dt0 = {}

	--create index methods

	function ix_schema.try_create(ix_schema, self, event)
		local name = ix_schema.name
		touch_schema(self, name)
		layout_table_schema(ix_schema)
		compile_table_schema(ix_schema)
		local ix_dbi = self:create_table_raw(name, table_flags(ix_schema))
		self:save_table_schema(ix_schema)
		local xk, xk_buf_sz = ix1_key_rec_buffer, MDBX_MAX_KEY_SIZE
		local xv, xv_buf_sz = val_rec_buffer(val_schema.key_fields.max_rec_size)
		for cur, k, k_sz, v, v_sz in self:each_raw(val_table) do
			decode_ix_into(k, k_sz, v, v_sz, dt)
			local xk_sz = encode_key(self, ix_schema, event, nil,
				xk, xk_buf_sz, cols, '[]', dt)
			assert(k_sz <= xv_buf_sz, k_sz)
			copy(xv, k, k_sz)
			local ok = self:try_put_raw(ix_dbi, xk, xk_sz, xv, k_sz,
				ix_schema.is_unique and C.MDBX_NOOVERWRITE or nil)
			if not ok then
				return false, 'duplicate_key'
			end
		end
		return true
	end

	function ix_schema.update(ix_schema, self, k, k_sz, v, v_sz, v0, v0_sz, cur)

		local ix_dbi
		local unique = ix_schema.is_unique

		--[[ cases to cover:
		      record       index
         ----------------------
				A -> X       X -> A  existing record and associated index key
			----------------------
			~  A -> X       X -> A  record updated but ix key didn't change: skip
			~  A -> Y    -  X -> A  record updated: remove old index
			             +  Y -> A  and add new index
			+  B -> X    x  X -> B  record inserted: unique key violation
			+  B -> Y    +  Y -> B  record inserted: add index
		]]

		--derive index key from v (key cols come from k, val cols from v)
		local xk, xk_buf_sz = ix1_key_rec_buffer, MDBX_MAX_KEY_SIZE
		decode_ix_into(k, k_sz, v, v_sz, dt)
		local xk_sz = encode_key(self, ix_schema, 'i_update', nil,
			xk, xk_buf_sz, cols, '[]', dt)
		clear(dt)

		if v0 then --record updated: remove the old index record

			--derive old index key from v0.
			--pk k is unchanged; only the val record differs.
			local xk0, xk0_buf_sz = ix2_key_rec_buffer, MDBX_MAX_KEY_SIZE
			decode_ix_into(k, k_sz, v0, v0_sz, dt0)
			local xk0_sz = encode_key(self, ix_schema, 'i_update', nil,
				xk0, xk0_buf_sz, cols, '[]', dt0)
			clear(dt0)

			--abort if index key didn't change
			if xk_sz == xk0_sz and memcmp(xk, xk0, xk_sz) == 0 then
				return true
			end

			if cur then
				cur:try_del_raw()
			else
				ix_dbi = self:dbi_raw(ix_schema.name) --live name: survives rename
				assert(self:try_del_raw(ix_dbi, xk0, xk0_sz, k, k_sz))
			end
		end

		if cur then
			return cur:try_put_raw(xk, xk_sz, k, k_sz,
				unique and C.MDBX_NOOVERWRITE or nil)
		end
		ix_dbi = ix_dbi or self:dbi_raw(ix_schema.name)
		return self:try_put_raw(ix_dbi, xk, xk_sz, k, k_sz,
			unique and C.MDBX_NOOVERWRITE or nil)
	end

	function ix_schema.del(ix_schema, self, k, k_sz, v0, v0_sz)
		local ix_dbi = self:dbi_raw(ix_schema.name)
		local xk0, xk0_buf_sz = ix2_key_rec_buffer, MDBX_MAX_KEY_SIZE
		decode_ix_into(k, k_sz, v0, v0_sz, dt0)
		local xk0_sz = encode_key(self, ix_schema, 'i_del', nil,
			xk0, xk0_buf_sz, cols, '[]', dt0)
		clear(dt0)
		assert(self:try_del_raw(ix_dbi, xk0, xk0_sz, k, k_sz))
	end

end

--create the index table, populate it from existing rows, and register it.
local function build_index(self, event, val_schema, ix_schema)
	layout_table_schema(ix_schema)
	compile_table_schema(ix_schema)
	local op = {type = 'schema', event = event, table = val_schema.name}
	local ok, err = ix_schema:try_create(self, op)
	self:check_schema(event, val_schema.name, nil, ok, err)
	local indexes = attr(val_schema, 'indexes')
	binsearch_insert(indexes, ix_schema, function(t, i, s)
		return t[i].name < s.name
	end)
	indexes[ix_schema.name] = ix_schema
	self.live_schema[ix_schema.name] = ix_schema
end

local function drop_index_table(self, val_schema, ix_schema)
	assert(self:drop_table(ix_schema.name))
	val_schema.indexes[ix_schema.name] = nil
	assert(remove_value(val_schema.indexes, ix_schema))
	if #val_schema.indexes == 0 then val_schema.indexes = nil end
end

local function validate_unique_index(self, ix_schema)
	local prev, prev_sz
	for cur, k, k_sz in self:each_raw(ix_schema.name) do
		if prev_sz then
			if k_sz == prev_sz and memcmp(k, prev, k_sz) == 0 then
				cur:close()
				return false, 'duplicate_key'
			end
		end
		prev = key_rec_buffer
		copy(prev, k, k_sz)
		prev_sz = k_sz
	end
	return true
end

function Db:add_index(val_table, ix)
	local val_dbi, val_schema = self:dbi_schema(val_table)
	local ix_name = format_ix_name(val_schema.name, ix)
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
	local ix_schema = index_schema(val_schema, ix, ix.is_unique)
	local db_max_key_size = mdbx_max_key_size(table_flags(ix_schema))
	self:check_schema('i_add', val_schema.name, nil,
		max_rec_size <= db_max_key_size,
		'pk too big: %d bytes (max is %d bytes)',
		max_rec_size, db_max_key_size)
	self:check_schema('i_add', val_schema.name, nil,
		not (val_schema.ixs and val_schema.ixs[ix_schema.name]),
		'index exists: %s', ix_schema.name)
	touch_schema(self, val_schema.name)
	attr(val_schema, 'ixs')[ix_schema.name] = ix
	local stored_ix_schema =
		val_schema.indexes and val_schema.indexes[ix_schema.name]
	if stored_ix_schema then
		if ix_schema.is_unique and not stored_ix_schema.is_unique then
			local ok, err = validate_unique_index(self, stored_ix_schema)
			self:check_schema('i_add', val_schema.name, nil, ok, err)
			touch_schema(self, stored_ix_schema.name)
			stored_ix_schema.is_unique = true
			self:save_table_schema(stored_ix_schema)
		end
	else
		build_index(self, 'i_add', val_schema, ix_schema)
	end
	self:save_table_schema(val_schema)
	return true, nil, ix_schema.name
end

function Db:drop_index(ix_name)
	local val_table = assert(ix_name:match'^[^/]+')
	local val_dbi, val_schema = self:dbi_schema(val_table)
	self:check_schema('i_drop', val_table, nil,
		val_schema.ixs and val_schema.ixs[ix_name],
		'index not found: %s', ix_name)
	touch_schema(self, val_schema.name)
	local ix_schema = assert(val_schema.indexes[ix_name])
	val_schema.ixs[ix_name] = nil
	if not next(val_schema.ixs) then val_schema.ixs = nil end
	local fk = val_schema.fks and val_schema.fks[format_fk_name(ix_schema.pk)]
	if fk and fk.index == ix_schema then
		if ix_schema.is_unique then
			touch_schema(self, ix_schema.name)
			ix_schema.is_unique = nil
			self:save_table_schema(ix_schema)
		end
	else
		drop_index_table(self, val_schema, ix_schema)
	end
	self:save_table_schema(val_schema)
	return true
end

--DDL / FOREIGN KEYS ---------------------------------------------------------

--register a foreign key (child.cols -> ref_table.pk) on the child table.
--input shape is schema.lua's fk definition without a caller-supplied name.
--[[local]] function format_fk_name(cols)
	return cat(cols, ',')
end
--check that existing rows satisfy the fk: every child row whose fk cols are all
--non-null must reference an existing parent row (MATCH SIMPLE: a row with any
--null fk col is skipped). mirrors how add_index validates existing data.
local function check_existing_fk(self, event, schema, fk_name, fk)
	local ref_dbi, ref_schema = self:dbi_schema(fk.ref_table)
	local n = #fk.cols
	for cur, row in self:each(fk.table, '{}') do
		local skip = false
		local vals = {}
		for i = 1, n do
			local v = row[fk.cols[i]]
			if v == nil or v == null then skip = true; break end
			vals[i] = v
		end
		if not skip then
			local pk, pk_buf_sz = fk_key_buffer, MDBX_MAX_KEY_SIZE
			local pk_sz = encode_key(self, ref_schema, event, nil,
				pk, pk_buf_sz, ref_schema.key_cols, nil, unpack(vals, 1, n))
			if not self:find_raw(ref_dbi, pk, pk_sz) then
				cur:close()
				return false, fmt('fk %s: existing row references missing %s',
					fk_name, fk.ref_table)
			end
		end
	end
	return true
end
function Db:add_fk(fk)
	local event = {type = 'schema', event = 'fk_add', table = fk.table}
	local dbi, schema = self:dbi_schema(fk.table)
	self:check_schema('fk_add', fk.table, nil, fk.cols and #fk.cols > 0,
		'fk has no columns')
	self:check_schema('fk_add', fk.table, nil,
		fk.ondelete == nil or fk.ondelete == 'cascade' or fk.ondelete == 'set null',
		'invalid ondelete: %s', fk.ondelete)
	self:check_schema('fk_add', fk.table, nil,
		fk.onupdate == nil or fk.onupdate == 'cascade',
		'invalid onupdate: %s', fk.onupdate)
	local fk_name = format_fk_name(fk.cols)
	self:check_schema('fk_add', fk.table, nil,
		not (schema.fks and schema.fks[fk_name]),
		'fk already exists: %s', fk_name)
	local ref_dbi, ref_schema = self:try_dbi_schema(fk.ref_table)
	self:check_schema('fk_add', fk.table, nil, ref_dbi,
		'fk %s: ref table missing: %s', fk_name, fk.ref_table)
	self:check_schema('fk_add', fk.table, nil,
		fk.ref_cols and #fk.cols == #fk.ref_cols and #fk.ref_cols == #ref_schema.pk,
		'fk %s: column count mismatch', fk_name)
	local seen = {}
	for i, col in ipairs(fk.cols) do
		local f = schema.fields[col]
		self:check_schema('fk_add', fk.table, col, f,
			'fk %s: unknown column: %s.%s', fk_name, fk.table, col)
		self:check_schema('fk_add', fk.table, col, not seen[col],
			'fk %s: duplicate column: %s.%s', fk_name, fk.table, col)
		seen[col] = true
		local ref_col = fk.ref_cols[i]
		self:check_schema('fk_add', fk.table, col, ref_col == ref_schema.pk[i],
			'fk %s: ref column must be pk column %s.%s',
			fk_name, fk.ref_table, ref_schema.pk[i])
		local ref_f = ref_schema.fields[ref_col]
		for k in sortedpairs(field_type_attrs) do
			self:check_schema('fk_add', fk.table, col, f[k] == ref_f[k],
				'fk %s: incompatible fields %s.%s and %s.%s: %s mismatch',
				fk_name, fk.table, col, fk.ref_table, ref_col, k)
		end
		if fk.ondelete == 'set null' then
			self:check_schema('fk_add', fk.table, col, not f.not_null,
				'fk %s: set null column must be nullable: %s.%s',
				fk_name, fk.table, col)
		end
	end
	--reject if existing data already violates the fk (before any change).
	local ok, err = check_existing_fk(self, event, schema, fk_name, fk)
	self:check_schema('fk_add', fk.table, nil, ok, err)

	--install the fk and its index; the fk index follows the ref pk's
	--per-column direction so scans can reuse raw key bytes instead of
	--going through key_reencode.
	touch_schema(self, schema.name)
	fk.name = fk_name
	fk.cols.desc = imap(ref_schema.pk.desc)
	local ix_name = format_ix_name(schema.name, fk.cols)
	local ix_schema = schema.indexes and schema.indexes[ix_name]
	if not ix_schema then
		ix_schema = index_schema(schema, fk.cols)
		build_index(self, 'fk_add', schema, ix_schema)
	end
	fk.index = ix_schema
	attr(schema, 'fks')[fk_name] = fk
	self:save_table_schema(schema)

	--register the reverse ref on the parent for delete-time enforcement.
	touch_schema(self, ref_schema.name)
	attr(ref_schema, 'ref_fks')[fk.table..'/'..fk_name] = fk
	self:save_table_schema(ref_schema)
	return true
end

function Db:drop_fk(table_name, fk_name)
	local dbi, schema = self:dbi_schema(table_name)
	local stored = schema.fks and schema.fks[fk_name]
	self:check_schema('fk_drop', table_name, nil, stored,
		'fk not found: %s', fk_name)
	--load parent before detach so ref_fks relinking can find stored in child.fks.
	local _, ref_schema = self:dbi_schema(stored.ref_table)
	self:detach_fk(schema, fk_name, stored)
	if ref_schema and ref_schema.ref_fks then
		touch_schema(self, ref_schema.name)
		ref_schema.ref_fks[stored.table..'/'..fk_name] = nil
		if not next(ref_schema.ref_fks) then ref_schema.ref_fks = nil end
		self:save_table_schema(ref_schema)
	end
	return true
end

--remove a fk from its child table and release its index.
--used by drop_fk and by drop_table when untangling a dropped parent's children.
function Db:detach_fk(schema, fk_name, fk)
	touch_schema(self, schema.name)
	local ix_schema = assert(fk.index)
	schema.fks[fk_name] = nil
	if not next(schema.fks) then schema.fks = nil end
	if not (schema.ixs and schema.ixs[ix_schema.name]) then
		drop_index_table(self, schema, ix_schema)
	end
	self:save_table_schema(schema)
end

--DDL / SCHEMA SYNC ----------------------------------------------------------

MS.engine = 'mdbx'

function mdbx_schema()
	return schema.new(update({}, MS))
end

--field-diff attrs: a paper schema's field attrs plus col_pos (catches reordering).
MS.diff_field_attrs = update({col_pos=1}, paper_field_attrs)

--a change to any of these on an indexed col forces the index to be rebuilt.
MS.index_field_attrs = update({not_null=1}, field_type_attrs)
MS.fk_field_attrs = MS.index_field_attrs

MS.supports_fks = true
MS.indexes_store_pk = true
MS.fk_indexes_store_pk = true

function MS:format_ix_name(tbl_name, cols)
	return format_ix_name(tbl_name, cols)
end

function MS:format_fk_name(tbl_name, cols, ref_table, ondelete)
	return format_fk_name(cols)
end

function Db:layout_schema()
	for table_name, table_schema in sortedpairs(self.schema.tables) do
		layout_table_schema(table_schema)
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
		or assertf(false, 'schema or mdbx_db expected, got %s', typeof(src))
	for tbl_name, tbl in sortedpairs(src_sc.tables) do
		if not tbl.raw then
			assert(not tbl.name or tbl.name == tbl_name)
			tbl.name = tbl_name
			layout_table_schema(tbl)
		end
	end
	local function P(...)
		pr(fmt(...))
	end
	local function copy_fk(fk)
		return {
			table = fk.table,
			cols = imap(fk.cols),
			ref_table = fk.ref_table,
			ref_cols = imap(fk.ref_cols),
			ondelete = fk.ondelete,
		}
	end
	local function sync()
		local stored_sc = self:extract_schema()
		local diff = schema.diff(stored_sc, src_sc)
		diff:pp()
		if opt.dry then return end
		local tables = diff.tables
		if not tables then return end

		--remove affected foreign keys before changing their tables or indexes.
		for tbl_name, d in sortedpairs(tables.update or empty) do
			for fk_name in sortedpairs(d.fks and d.fks.remove or empty) do
				P('drop fk: %s.%s', tbl_name, fk_name)
				self:drop_fk(tbl_name, fk_name)
			end
		end

		--remove changed or deleted index declarations.
		for tbl_name, d in sortedpairs(tables.update or empty) do
			for ix_name in sortedpairs(d.ixs and d.ixs.remove or empty) do
				P('drop index: %s', ix_name)
				self:drop_index(ix_name)
			end
		end

		--replace removed tables before creating new tables with the same names.
		for tbl_name in sortedpairs(tables.remove or empty) do
			P('drop table: %s', tbl_name)
			assert(self:drop_table(tbl_name))
		end
		for tbl_name, tbl in sortedpairs(tables.add or empty) do
			P('create table: %s', tbl_name)
			self:create_table(tbl_name, copy_base_schema(tbl))
		end

		--rename columns, then apply the complete new table definition.
		for tbl_name, d in sortedpairs(tables.update or empty) do
			for old_col, fd in sortedpairs(
				d.fields and d.fields.update or empty)
			do
				if fd.changed.col then
					P('rename column: %s.%s -> %s', tbl_name, old_col, fd.new.col)
					self:rename_column(tbl_name, old_col, fd.new.col)
				end
			end
			if d.fields or d.remove_pk or d.add_pk then
				P('alter table: %s', tbl_name)
				self:alter_table(tbl_name, d.new)
			end
		end

		--load initial rows before building indexes.
		for tbl_name, tbl in sortedpairs(tables.add or empty) do
			for _, row in ipairs(tbl.rows or empty) do
				self:insert(tbl_name, '[]', row)
			end
		end

		--build indexes after every table has its final record encoding.
		for tbl_name, tbl in sortedpairs(tables.add or empty) do
			for ix_name, ix in sortedpairs(tbl.ixs or empty) do
				P('add index: %s', ix_name)
				self:add_index(tbl_name, ix)
			end
		end
		for tbl_name, d in sortedpairs(tables.update or empty) do
			for ix_name, ix in sortedpairs(d.ixs and d.ixs.add or empty) do
				P('add index: %s', ix_name)
				self:add_index(tbl_name, ix)
			end
		end

		--add foreign keys last, after all referenced tables and indexes exist.
		for tbl_name, tbl in sortedpairs(tables.add or empty) do
			for fk_name, fk in sortedpairs(tbl.fks or empty) do
				P('add fk: %s.%s', tbl_name, fk_name)
				self:add_fk(copy_fk(fk))
			end
		end
		for tbl_name, d in sortedpairs(tables.update or empty) do
			for fk_name, fk in sortedpairs(d.fks and d.fks.add or empty) do
				P('add fk: %s.%s', tbl_name, fk_name)
				self:add_fk(copy_fk(fk))
			end
		end
	end
	self:atomic(opt.dry and 'r' or 'w', function()
		self:without_schema(sync)
	end)
end

--DML / CURSORS --------------------------------------------------------------

function Db:cursor(tab)
	local dbi, schema = self:dbi_schema(tab)
	local cur = self:cursor_raw(dbi)
	cur.schema = schema
	return cur
end
local db_cursor_close = Cur.close
function Cur:close()
	db_cursor_close(self)
	self.schema = nil
end

--DML / UPDATE ---------------------------------------------------------------

local max_trigger_depth = 16

local function fire_triggers(schema, event, db, ...)
	local evlist = schema.triggers[event]
	if not evlist then return end
	local depth = (db._trigger_depth or 0) + 1
	assertf(depth <= max_trigger_depth,
		'trigger max depth (%d) exceeded: %s.%s',
		max_trigger_depth, schema.name, event
	)
	db._trigger_depth = depth
	local ok, err = true
	for _, fn in ipairs(evlist) do
		ok, err = pcall(fn, db, ...)
		if not ok then break end
	end
	db._trigger_depth = depth - 1
	if not ok then error(err, 0) end
end

local function decode_row(schema, k, k_sz, v, v_sz)
	local t = {}
	decode_key(schema, k, k_sz, t, '{}')
	decode_val(schema, v, v_sz, t, schema.val_cols, '{}')
	return t
end

local function apply_generated(db, schema, new_t)
	for _, f in ipairs(schema.val_fields) do
		if f.generate then
			new_t[f.col] = f.generate(db, new_t)
		end
	end
end

--[[
check that every fk's referenced row exists for the selected values. on a full
write (insert/put) an unset col takes its default. a nil/null fk col means "no
reference" so the fk is skipped ("MATCH SIMPLE": any null col skips checking).
]]
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
			local pk, pk_buf_sz = fk_key_buffer, MDBX_MAX_KEY_SIZE
			local pk_sz = encode_key(self, ref_schema, 'get', nil,
				pk, pk_buf_sz, ref_schema.key_cols, nil, unpack(vals, 1, n))
			if not self:find_raw(ref_dbi, pk, pk_sz) then
				self:check_row(event, schema.name, false,
					fmt('fk %s: no parent row in %s', fk_name, fk.ref_table))
			end
		end
	end
end

local del_fk_key_buffer = u8a(MDBX_MAX_KEY_SIZE)
--[[
probe a child's fk index for the first row referencing the deleted parent pk
(`...`); returns find_raw's (ok, v, v_sz) where v is the child's encoded pk. the
key is re-encoded on every call because a recursive cascade reuses the buffer.
]]
local function first_referencing_child(self, ix_dbi, ix_schema, ...)
	local xk, xk_buf_sz = del_fk_key_buffer, MDBX_MAX_KEY_SIZE
	local xk_sz = encode_key(self, ix_schema, 'get', nil,
		xk, xk_buf_sz, ix_schema.key_cols, nil, ...)
	return self:find_raw(ix_dbi, xk, xk_sz)
end
--[[
apply the referential actions of fks that reference this (parent) table after
its row was deleted. `...` are the parent pk values (fk.cols order == ref pk
order). two passes so a sibling cascade that clears a reference is honored
before we check it: pass 1 cascades/nulls (each drains by re-probing -- a delete
/null removes the child's entry at this key, a cascade also recurses), pass 2
does the NO ACTION (default) checks -- reject if anything still references us.
]]
local function enforce_del_fks(self, schema, ...)
	for _, fk in pairs(schema.ref_fks) do
		local child_schema = fk.index.val_schema
		if fk.ondelete == 'cascade' then
			local ix_dbi = self:dbi_raw(fk.index.name)
			local n = #child_schema.key_fields
			while true do
				local ok, v, v_sz =
					first_referencing_child(self, ix_dbi, fk.index, ...)
				if not ok then break end
				local pk = {}
				decode_key(child_schema, v, v_sz, pk, nil)
				self:del(fk.table, unpack(pk, 1, n))
			end
		elseif fk.ondelete == 'set null' then
			local ix_dbi = self:dbi_raw(fk.index.name)
			while true do
				local ok, v, v_sz =
					first_referencing_child(self, ix_dbi, fk.index, ...)
				if not ok then break end
				local row = {}
				decode_key(child_schema, v, v_sz, row, '{}')
				for _, col in ipairs(fk.cols) do row[col] = null end
				self:update(fk.table, '{}', row)
			end
		end
	end
	for _, fk in pairs(schema.ref_fks) do --no action (default): reject if ref'ed
		if fk.ondelete ~= 'cascade' and fk.ondelete ~= 'set null' then
			local ix_dbi = self:dbi_raw(fk.index.name)
			if first_referencing_child(self, ix_dbi, fk.index, ...) then
				self:check_row('del', schema.name, false,
					fmt('fk %s: referenced by %s', fk.name, fk.table))
			end
		end
	end
end

local function update_indexes(
	self, event, schema,
	k, k_sz, v, v_sz, v0, v0_sz, ix_cur
)
	for _, ix_schema in ipairs(schema.indexes) do
		local cur = ix_cur and ix_cur.schema == ix_schema and ix_cur or nil
		local ok, err = ix_schema:update(self, k, k_sz, v, v_sz, v0, v0_sz, cur)
		self:check_row(event, schema.name, ok, err)
	end
end

--stable copy of a cursor's key across writes
local cur_k_buffer = u8a(MDBX_MAX_KEY_SIZE)

local function cur_update(self, ix_cur, val_cols, ...)
	local schema = assert(self.schema)
	if schema.is_index then
		local ok, _, _, k, k_sz = self:current_raw()
		if not ok then
			self.db:check_row('c_update', schema.name, false, 'not_found')
		end
		local cur = self.db:cursor(schema.val_table)
		local ok, err = cur:move_raw(C.MDBX_SET_KEY, k, k_sz)
		self.db:check_row('c_update', schema.val_table, ok, err)
		cur_update(cur, self, val_cols, ...)
		cur:close()
		return true
	end
	local cols, as = cols_list(val_cols)
	check_cols(schema, cols, as == '{}' and (...))
	cols = cols or schema.val_cols
	local v, v_buf_sz = val_rec_buffer(schema.val_fields.max_rec_size)
	local ok, k, k_sz, v0, v0_sz = self:current_raw()
	if not ok then
		self.db:check_row('c_update', schema.name, false, 'not_found')
	end
	local kk = cur_k_buffer; copy(kk, k, k_sz)
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
	local old_t
	if schema.triggers or schema.has_generated then
		decode_key(schema, k, k_sz, t, '{}')
		if schema.triggers then
			old_t = decode_row(schema, k, k_sz, v0, v0_sz)
			fire_triggers(schema, 'before_update', db, old_t, t)
		end
		if schema.has_generated then
			apply_generated(db, schema, t)
		end
	end
	local v_sz = encode_val(db, schema, 'c_update', v, v_buf_sz, val_cols, '{}', t)
	if schema.fks then
		--fk.cols may include pk cols; decode key into t (k is still valid pre-write).
		if not schema.triggers and not schema.has_generated then
			decode_key(schema, k, k_sz, t, '{}')
		end
		check_fks(db, 'c_update', schema, schema.cols, '{}', false, t)
	end
	if not schema.indexes then
		assert(self:try_put_raw(kk, k_sz, v, v_sz, C.MDBX_CURRENT))
	else
		--copy v0 first: mdbx invalidates get-pointers on the next write.
		local v0c = v0_buffer(v0_sz); copy(v0c, v0, v0_sz)
		assert(self:try_put_raw(kk, k_sz, v, v_sz, C.MDBX_CURRENT))
		update_indexes(db, 'c_update', schema, kk, k_sz, v, v_sz, v0c, v0_sz, ix_cur)
	end
	if schema.triggers then
		fire_triggers(schema, 'after_update', db, old_t, t)
	end
	return true
end
function Cur:update(...)
	return cur_update(self, nil, ...)
end
local function put(self, flags, op, tab, cols, ...)
	local dbi, schema = self:dbi_schema(tab)
	local cols, as = cols_list(cols)
	check_cols(schema, cols, as == '{}' and (...))
	cols = cols or schema.cols
	local k, k_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local v, v_buf_sz = val_rec_buffer(schema.val_fields.max_rec_size)
	local autoinc_f = op == 'insert' and schema.autoinc_field
	local k_sz, autoinc_v = encode_key(self, schema, op, autoinc_f,
		k, k_buf_sz, cols, as, ...)
	if op == 'update' or op == 'upsert'
		or schema.indexes or schema.fks
		or schema.triggers or schema.has_generated
	then
		local cur = self:cursor(dbi)
		--insert skips the get: v0=nil by definition, NOOVERWRITE detects exists
		local found, v0, v0_sz
		if op ~= 'insert' then
			found, v0, v0_sz = cur:move_raw_v(C.MDBX_SET_KEY, k, k_sz)
		end
		local v_sz
		local old_t, new_t --for triggers
		if found then
			--next mdbx put command will invalidate v0 so we need to save it.
			local v0_unstable = v0
			v0 = v0_buffer(v0_sz) --keep v0_sz: buffer() returns capacity, not size
			copy(v0, v0_unstable, v0_sz)
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
			if schema.triggers or schema.has_generated then
				local kk = put_k_buffer; copy(kk, k, k_sz); k = kk
				decode_key(schema, k, k_sz, t, '{}')
				if schema.triggers then
					old_t = decode_row(schema, k, k_sz, v0, v0_sz)
					fire_triggers(schema, 'before_update', self, old_t, t)
				end
				if schema.has_generated then
					apply_generated(self, schema, t)
				end
				new_t = t
			end
			v_sz = encode_val(self, schema, op, v, v_buf_sz, val_cols, '{}', t)
			if schema.fks then
				if not schema.triggers and not schema.has_generated then
					--pk not yet in t
					for _, f in ipairs(schema.key_fields) do
						t[f.col] = select_col(cols, as, f.col, ...)
					end
				end
				check_fks(self, op, schema, schema.cols, '{}', false, t)
			end
			assert(cur:try_put_raw(k, k_sz, v, v_sz, C.MDBX_CURRENT))
		elseif op == 'update' then --update but existing row not found
			self:check_row(op, schema.name, false, v0)
		else --insert or upsert new record
			v0, v0_sz = nil --no previous value (v0 currently holds the find_raw err)
			v_sz = encode_val(self, schema, op, v, v_buf_sz, cols, as, ...)
			if schema.triggers or schema.has_generated then
				local kk = put_k_buffer; copy(kk, k, k_sz); k = kk
				new_t = decode_row(schema, k, k_sz, v, v_sz)
				if schema.triggers then
					fire_triggers(schema, 'before_insert', self, new_t)
				end
				if schema.has_generated then
					apply_generated(self, schema, new_t)
				end
				v_sz = encode_val(self, schema, op,
					v, v_buf_sz, schema.val_cols, '{}', new_t)
				if schema.fks then
					check_fks(self, op, schema, schema.cols, '{}', true, new_t)
				end
			elseif schema.fks then
				--new row: full write (missing value means take default value).
				check_fks(self, op, schema, cols, as, true, ...)
			end
			local ret, err = cur:try_put_raw(k, k_sz, v, v_sz, flags)
			self:check_row(op, schema.name, ret, err)
		end
		cur:close()
		if schema.indexes then
			update_indexes(self, op, schema, k, k_sz, v, v_sz, v0, v0_sz)
		end
		if schema.triggers and new_t then
			if old_t then
				fire_triggers(schema, 'after_update', self, old_t, new_t)
			else
				fire_triggers(schema, 'after_insert', self, new_t)
			end
		end
	else --insert with no indexes to update or fks to check.
		local v_sz = encode_val(self, schema, op, v, v_buf_sz, cols, as, ...)
		local ret, err = self:try_put_raw(dbi, k, k_sz, v, v_sz, flags)
		self:check_row(op, schema.name, ret, err)
	end
	log('note', 'db', op, '%s %s', schema.name, cols[S])
	return autoinc_v
end
function Db:insert(tab, ...)
	return put(self, C.MDBX_NOOVERWRITE, 'insert', tab, ...)
end
function Db:update(tab, ...)
	put(self, C.MDBX_CURRENT, 'update', tab, ...)
	return true
end
function Db:upsert(tab, ...)
	put(self, nil, 'upsert', tab, ...)
	return true
end

function Cur:del()
	local schema = assert(self.schema)
	local ok, k, k_sz, v, v_sz = self:current_raw()
	if not ok then
		self.db:check_row('c_del', schema.name, false, 'not_found')
	end
	if schema.is_index then
		k, k_sz = v, v_sz --cursor's v is base row's pk
		schema = assert(schema.val_schema)
	end
	local db = self.db
	local kk = cur_k_buffer; copy(kk, k, k_sz)
	local cur = self
	if cur.schema.is_index then
		cur = db:cursor(schema.name)
		ok, v, v_sz = cur:move_raw_v(C.MDBX_SET_KEY, kk, k_sz)
		db:check_row('del', schema.name, ok, v)
	end
	if schema.indexes or schema.triggers then
		local v0u = v; v = v0_buffer(v_sz); copy(v, v0u, v_sz)
	end
	local old_t
	if schema.triggers then
		old_t = decode_row(schema, kk, k_sz, v, v_sz)
		fire_triggers(schema, 'before_delete', db, old_t)
	end
	cur:try_del_raw()
	for _,ix_schema in ipairs(schema.indexes or empty) do
		ix_schema:del(db, kk, k_sz, v, v_sz)
	end
	if schema.ref_fks then
		local pk = {}
		decode_key(schema, kk, k_sz, pk, nil)
		enforce_del_fks(db, schema, unpack(pk, 1, #schema.key_fields))
	end
	if cur ~= self then cur:close() end
	if schema.triggers then
		fire_triggers(schema, 'after_delete', db, old_t)
	end
	return true
end
function Db:del(tab, ...)
	local dbi, schema = self:dbi_schema(tab)
	assertf(not (schema.is_index and not schema.is_unique),
		'cannot delete through non-unique index: %s', schema.name)
	local k, k_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local k_sz = encode_key(self, schema, 'del', nil,
		k, k_buf_sz, schema.key_cols, nil, ...)
	local cur = self:cursor(dbi)
	local ok, err = cur:move_raw(C.MDBX_SET_KEY, k, k_sz)
	if not ok then
		assert(err == 'not_found') --the only error
		cur:close()
		return false
	end
	cur:del()
	cur:close()
	return true
end

--fast bulk put but can't have indexes or fks. for initializing new tables.
function Db:put_records(tab, cols, rows)
	if istab(cols) then
		cols, rows = '[]', cols
	end
	local dbi, schema = self:dbi_schema(tab)
	assert(not schema.indexes)
	assert(not schema.fks)
	assert(not schema.ref_fks)
	local cols, as = cols_list(cols)
	check_cols(schema, cols)
	cols = cols or schema.cols
	local k, k_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local v, v_buf_sz = val_rec_buffer(schema.val_fields.max_rec_size)
	for _,vals in ipairs(rows) do
		if as == '{}' then check_cols(schema, nil, vals) end
		local k_sz = encode_key(self, schema, 'put_rec', nil,
			k, k_buf_sz, cols, as, vals)
		local v_sz = encode_val(self, schema, 'put_rec',
			v, v_buf_sz, cols, as, vals)
		local ok, err = self:try_put_raw(dbi, k, k_sz, v, v_sz)
		self:check_row('put_rec', schema.name, ok, err)
	end
	return true
end

--DML / NAVIGATION -----------------------------------------------------------

local function skip_ok(ok, ...)
	if not ok then return end
	return ...
end

function Cur:try_move(op, val_cols)
	local schema = assert(self.schema)
	local ok, k, k_sz, v, v_sz = self:move_raw_kv(op)
	if not ok then return false, k end
	return true, decode_kv(self.db, schema, k, k_sz, v, v_sz, val_cols)
end
function Cur:move(op, val_cols)
	return skip_ok(self:try_move(op, val_cols))
end
function Cur:must_move(op, val_cols)
	return self.db:check_row('move', self.schema.name,
		self:try_move(op, val_cols))
end

--generate for each OP in {first,last,next,prev,current}:
--  try_OP(val_cols) -> false,err | true,k,v...   (OP_raw + decode_kv)
--  OP(val_cols)     -> k,v... | nil              (try_OP without ok retval)
--  must_OP(val_cols)-> k,v...                    (error on miss)
for _,OP in ipairs{'first', 'last', 'next', 'prev', 'current'} do
	local op_raw = Cur[OP..'_raw']
	local function try_op(self, val_cols)
		local schema = assert(self.schema)
		local ok, k, k_sz, v, v_sz = op_raw(self)
		if not ok then return false, k end
		return true, decode_kv(self.db, schema, k, k_sz, v, v_sz, val_cols)
	end
	local function do_op(self, val_cols)
		return skip_ok(try_op(self, val_cols))
	end
	local function must_op(self, val_cols)
		return self.db:check_row(OP, self.schema.name,
			try_op(self, val_cols))
	end
	Cur['try_'..OP] = try_op
	Cur[OP] = do_op
	Cur['must_'..OP] = must_op
end

local function cur_each_pass(cur, ok, ...)
	if not ok then cur:close(); return end
	return cur, ...
end
local function cur_each_try_next(self, k0)
	return cur_each_pass(self, self:try_move(
		k0 == 'start' and C.MDBX_FIRST or C.MDBX_NEXT, self.val_cols))
end
local function cur_each_try_prev(self, k0)
	return cur_each_pass(self, self:try_move(
		k0 == 'start' and C.MDBX_LAST or C.MDBX_PREV, self.val_cols))
end
function Db:each(tbl_name, val_cols, mode, t)
	local cur = self:cursor(tbl_name, mode)
	cur.val_cols = val_cols
	return cur_each_try_next, cur, 'start'
end
function Db:each_reverse(tbl_name, val_cols, mode, t)
	local cur = self:cursor(tbl_name, mode)
	cur.val_cols = val_cols
	return cur_each_try_prev, cur, 'start'
end

--DML / LOOKUP ---------------------------------------------------------------

local function find_raw_by_pk(self, dbi, schema, ...)
	local k, k_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local k_sz = encode_key(self, schema, 'get', nil,
		k, k_buf_sz, schema.key_cols, nil, ...)
	return self:find_raw(dbi, k, k_sz)
end

function Cur:try_find(val_cols, ...)
	local schema = assert(self.schema)
	local k, k_buf_sz = key_rec_buffer, MDBX_MAX_KEY_SIZE
	local k_sz = encode_key(self.db, schema, 'c_get', nil,
		k, k_buf_sz, schema.key_cols, nil, ...)
	local ok, v, v_sz = self:move_raw_v(C.MDBX_SET_KEY, k, k_sz)
	if not ok then return false, v end
	return true, decode_kv(self.db, schema, nil, nil, v, v_sz, val_cols)
end
function Cur:find(...)
	return skip_ok(self:try_find(...))
end
function Cur:must_find(...)
	return self.db:check_row('c_get', self.schema.name,
		self:try_find(...))
end
function Db:try_find(tab, val_cols, ...)
	local dbi, schema = self:dbi_schema(tab)
	local ok, v, v_sz = find_raw_by_pk(self, dbi, schema, ...)
	if not ok then return false, v end --v=err
	return true, decode_kv(self, schema, nil, nil, v, v_sz, val_cols)
end
function Db:find(...)
	return skip_ok(self:try_find(...))
end
function Db:must_find(tab, val_cols, ...)
	local dbi, schema = self:dbi_schema(tab)
	local ok, v, v_sz = find_raw_by_pk(self, dbi, schema, ...)
	self:check_row('get', schema.name, ok, v)
	return decode_kv(self, schema, nil, nil, v, v_sz, val_cols)
end

function Db:exists(tab, ...)
	local dbi, schema = self:dbi_schema(tab)
	local ok = find_raw_by_pk(self, dbi, schema, ...)
	if not ok then return false, true end
	return true, true
end

function Cur:is_null(col)
	local schema = assert(self.schema)
	local is_index = schema.is_index
	if is_index then schema = assert(schema.val_schema) end
	local _, vi = val_field(schema, col)
	local ok, k, _, v, v_sz = self:current_raw()
	if not ok then return true, k end
	if is_index then
		ok, v, v_sz = self.db:find_raw(assert(self.db.dbis[schema.name]), v, v_sz)
		assert(ok, v)
	end
	return C.schema_val_is_null(schema._st, vi-1, v, v_sz) ~= 0
end
function Db:is_null(tab, col, ...) --returns is_null, [reason]
	local dbi, schema = self:dbi_schema(tab)
	local tab_schema = schema
	if schema.is_index then schema = assert(schema.val_schema) end
	local _, vi = val_field(schema, col)
	local ok, v, v_sz = find_raw_by_pk(self, dbi, tab_schema, ...)
	if not ok then return true, 'not_found' end
	if tab_schema.is_index then
		ok, v, v_sz = self:find_raw(assert(self.dbis[schema.name]), v, v_sz)
		assert(ok, v)
	end
	return C.schema_val_is_null(schema._st, vi-1, v, v_sz) ~= 0
end

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

local function each_dup_from(db, cur, ix_schema, val_cols, close_cur, xk, xk_sz)
	assert(ix_schema.is_index)
	local fixedsize = ix_schema.dup_fixedsize
	if fixedsize then
		local op = xk and C.MDBX_SEEK_AND_GET_MULTIPLE or C.MDBX_GET_MULTIPLE
		local ok, v, v_sz = cur:move_raw_v(op, xk, xk_sz)
		if not ok then
			if close_cur then cur:close() end
			return noop
		end
		local v_o = 0
		return function()
			if v_o >= v_sz then
				ok, v, v_sz = cur:move_raw_v(C.MDBX_NEXT_MULTIPLE)
				if not ok then
					if close_cur then cur:close() end
					return
				end
				v_o = 0
			end
			local pk = v + v_o
			v_o = v_o + fixedsize
			return cur, decode_kv(db, ix_schema, nil, nil, pk, fixedsize, val_cols)
		end
	else
		if xk and not cur:move_raw(C.MDBX_SET_KEY, xk, xk_sz) then
			if close_cur then cur:close() end
			return noop
		end
		local op = C.MDBX_GET_CURRENT
		return function()
			local ok, v, v_sz = cur:move_raw_v(op)
			op = C.MDBX_NEXT_DUP
			if not ok then
				if close_cur then cur:close() end
				return
			end
			return cur, decode_kv(db, ix_schema, nil, nil, v, v_sz, val_cols)
		end
	end
end
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
function Cur:each_current_dup(val_cols)
	return each_dup_from(self.db, self, assert(self.schema), val_cols, false)
end
