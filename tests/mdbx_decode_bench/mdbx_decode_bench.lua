local C = ffi.load'mdbx_decode_bench'

cdef[[
typedef struct schema_col_read {
	schema_table* table;
	const MDBX_val* rec;
	int col_i;
	bool8 is_key;
	bool8 is_scalar;
} schema_col_read;

void schema_decode_cols(const schema_col_read* reads, int n,
	double* numbers, const u8** data, int* lengths,
	u8* scratch, int scratch_size
);
]]

return function(db, scan)
	assert(not scan.is_index)
	local schema = db:table_schema(scan.table)
	local names = scan.out_cols
	local n = #names
	local reads = new('schema_col_read[?]', n)
	local numbers = new('double[?]', n)
	local data = new('const u8*[?]', n)
	local lengths = new('int[?]', n)
	local kinds, decoders = {}, {}
	local scratch = u8a(n * MDBX_MAX_KEY_SIZE)
	for i, name in ipairs(names) do
		local f = schema.fields[name]
		local read = reads[i-1]
		read.table = schema._st
		read.is_key = f.key_index and 1 or 0
		read.rec = f.key_index and scan.key_rec or scan.val_rec
		read.col_i = (f.key_index or f.val_index) - 1
		read.is_scalar = f.maxlen and 0 or 1
		if f.maxlen then
			kinds[i] = (f.mdbx_type == 'utf8' or f.mdbx_type == 'binary')
				and 'string' or 'array'
		elseif f.mdbx_type == 'bool' then
			kinds[i] = 'bool'
		else
			kinds[i] = 'number'
		end
		decoders[i] = f.decode
	end
	return function(row)
		C.schema_decode_cols(reads, n, numbers, data, lengths,
			scratch, MDBX_MAX_KEY_SIZE)
		for i = 1, n do
			local len = lengths[i-1]
			local v
			if len == -1 then
				v = null
			elseif kinds[i] == 'number' then
				v = numbers[i-1]
			elseif kinds[i] == 'bool' then
				v = numbers[i-1] ~= 0
			elseif kinds[i] == 'string' then
				v = str(data[i-1], len)
			else
				v = decoders[i](data[i-1], len)
			end
			row[names[i]] = v
		end
	end
end
