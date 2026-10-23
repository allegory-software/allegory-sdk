require'rowset'
require'mdbx_scan'

local ffi = require'ffi' -- foreign function interface

rowset.db_explorer_tables = virtual_rowset(function(rs)
	rs.fields = {
		{name = 'name', label = 'Table', readonly = true, not_null = true},
		{name = 'row_count', label = 'Rows', type = 'number', readonly = true},
		{name = 'column_count', label = 'Columns', type = 'number', readonly = true},
	}
	rs.pk = 'name'
	function rs:load_rows(res)
		res.rows = {} -- {row_i -> {table_name, row_count, column_count}}
		db():atomic('r', function()
			for table_name in db():each_table() do
				local schema = db():table_schema(table_name)
				add(res.rows, {
					table_name,
					db():table_entries(table_name),
					schema and not schema.is_index and #schema.cols or 2,
				})
			end
		end)
	end
end)

local function init_table_rowset(rs, table_name)
	local schema = db():table_schema(table_name)
	rs.manual_init_fields = true
	rs.can_move_rows = false
	if schema and not schema.is_index then
		rs.fields = {} -- {field_i -> field}
		for field_i, col in ipairs(schema.cols) do
			local field = update({}, schema.fields[col])
			field.name = col
			field.index = field_i
			field.internal = false
			field.readonly = true
			rs.fields[field_i] = field
		end
		rs.pk = cat(schema.pk, ' ')
		rs.cols = cat(schema.cols, ' ')
		function rs:load_rows(res)
			res.rows = db():scan(table_name, '')
				:select(cat(schema.cols, ', '))
				:null_value(null):rows_array('[]')
		end
	else
		rs.fields = {
			{name = 'key', label = 'Key (hex)', readonly = true,
				not_null = true},
			{name = 'value', label = 'Value (hex)', readonly = true,
				not_null = true},
		}
		rs.pk = 'key value'
		function rs:load_rows(res)
			res.rows = {} -- {row_i -> {hex_key, hex_value}}
			for cursor, key, key_size, value, value_size in
				db():each_raw(table_name)
			do
				add(res.rows, {
					tohex(ffi.string(key, key_size)),
					tohex(ffi.string(value, value_size)),
				})
			end
		end
	end
	rs:init_fields(false)
end

rowset.db_explorer_rows = function(name, out_format)
	checkarg(method'GET')
	local filter = json_decode(args'filter', null)
	local table_name = checkarg(filter and filter[1], 'table required')
	return db():atomic('r', function()
		local rs = virtual_rowset(init_table_rowset, table_name)
		return rs(name, out_format)
	end)
end
