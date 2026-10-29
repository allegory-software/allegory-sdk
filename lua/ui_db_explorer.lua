require'rowset_mdbx'

--the param of the rowsets that show one table.
local table_param = {
	label = 'Table', accept_many = false,
	lookup_rowset_name = 'db_explorer_tables',
}

local function format_key_cols(cols)
	local t = {} -- {key_i -> 'COL [desc]'}
	for key_i, col in ipairs(cols) do
		t[key_i] = col..(cols.desc and cols.desc[key_i] and ' desc' or '')
	end
	return cat(t, ', ')
end

rowset.db_explorer_tables = virtual_rowset(function(rs)
	rs.fields = {
		{
			name = 'name', label = 'Table', icon = 'database',
			readonly = true, not_null = true,
		},
		{
			name = 'row_count', label = 'Rows', icon = 'table-row',
			type = 'number', readonly = true,
		},
		{
			name = 'column_count', label = 'Columns', icon = 'table-column',
			type = 'number', readonly = true,
		},
		{
			name = 'raw', label = 'Raw', type = 'bool', readonly = true,
			not_null = true, filter = '=false', icon = 'binary',
		},
		{
			name = 'is_index', label = 'Index', type = 'bool',
			readonly = true, hidden = true,
		},
		{
			name = 'is_unique', label = 'Unique index', type = 'bool',
			readonly = true, hidden = true,
		},
		{name = 'pk', label = 'Primary key', icon = 'key', readonly = true},
		{
			name = 'name_col', label = 'Name column', readonly = true,
			hidden = true,
		},
		{
			name = 'val_table', label = 'Base table', readonly = true,
			hidden = true,
		},
		{
			name = 'row_check_expr', label = 'Row check',
			icon = 'shield-check', readonly = true,
		},
		{
			name = 'row_check_error', label = 'Row check error',
			readonly = true, hidden = true,
		},
		{
			name = 'dyn_offset_size', label = 'Dynamic offset size',
			type = 'number', readonly = true, hidden = true,
		},
	}
	rs.pk = 'name'
	rs.label = 'Tables'
	function rs:load_rows(res)
		res.rows = {} -- {row_i -> {value in rs.fields order}}
		db():atomic('r', function()
			for table_name in db():each_table() do
				local schema = db():table_schema(table_name)
				add(res.rows, {
					table_name,
					db():table_entries(table_name),
					schema and not schema.is_index and #schema.cols or 2,
					schema == nil or not not schema.is_index,
					schema and schema.is_index or false,
					schema and schema.is_unique or false,
					schema and format_key_cols(schema.pk) or null,
					schema and schema.name_col or null,
					schema and schema.val_table or null,
					schema and schema.row_check_expr or null,
					schema and schema.row_check_error or null,
					schema and schema.dyn_offset_size or null,
				})
			end
		end)
	end
end)

rowset.db_explorer_fields = virtual_rowset(function(rs)
	rs.fields = {
		{
			name = 'col', label = 'Column', icon = 'table-column',
			readonly = true, not_null = true,
		},
		{name = 'mdbx_type', label = 'MDBX type', readonly = true},
		{
			name = 'key_index', label = 'Key position', type = 'number',
			readonly = true, icon = 'key',
		},
		{
			name = 'not_null', label = 'Not null', type = 'bool',
			readonly = true, icon = 'asterisk',
		},
		{
			name = 'auto_increment', label = 'Auto increment', type = 'bool',
			readonly = true, icon = 'number',
		},
		{
			name = 'maxlen', label = 'Max length', type = 'number',
			readonly = true, icon = 'ruler',
		},
		{
			name = 'fixed', label = 'Fixed', type = 'bool',
			readonly = true, hidden = true,
		},
		{
			name = 'nozero', label = 'No zero', type = 'bool',
			readonly = true, hidden = true,
		},
		{
			name = 'scale', label = 'Scale', type = 'number',
			readonly = true, icon = 'decimal',
		},
		{name = 'mdbx_collation', label = 'Collation', readonly = true},
		{name = 'default_expr', label = 'Default', readonly = true},
		{
			name = 'gen_expr', label = 'Generated', icon = 'bolt',
			readonly = true,
		},
		{name = 'on_update_expr', label = 'On update', readonly = true},
		{
			name = 'check_expr', label = 'Check', icon = 'shield-check',
			readonly = true,
		},
		{
			name = 'check_error', label = 'Check error', readonly = true,
			hidden = true,
		},
	}
	rs.pk = 'col'
	rs.params = {table = table_param}
	function rs:load_rows(res, params)
		local table_name = params.table -- the table to describe
		checkarg(table_name ~= null, 'table required')
		res.rows = {} -- {row_i -> {value in rs.fields order}}
		db():atomic('r', function()
			local schema = db():table_schema(table_name)
			if not schema then return end
			for _, field in ipairs(schema.fields) do
				local row = {} -- {attribute_i -> value}
				for attribute_i, attribute in ipairs(rs.fields) do
					row[attribute_i] = repl(field[attribute.name], nil, null)
				end
				add(res.rows, row)
			end
		end)
	end
end)

rowset.db_explorer_indexes = virtual_rowset(function(rs)
	rs.fields = {
		{name = 'name', label = 'Index', readonly = true, not_null = true},
		{
			name = 'cols', label = 'Columns', icon = 'table-column',
			readonly = true,
		},
		{
			name = 'is_unique', label = 'Unique', type = 'bool',
			readonly = true,
		},
		{
			name = 'row_count', label = 'Rows', type = 'number',
			icon = 'table-row',
			readonly = true,
		},
	}
	rs.pk = 'name'
	rs.params = {table = table_param}
	function rs:load_rows(res, params)
		local table_name = params.table -- the table to describe
		checkarg(table_name ~= null, 'table required')
		res.rows = {} -- {row_i -> {name, cols, is_unique, row_count}}
		db():atomic('r', function()
			local schema = db():table_schema(table_name)
			if not schema then return end
			for _, index_schema in ipairs(schema.indexes or empty) do
				add(res.rows, {
					index_schema.name,
					format_key_cols(index_schema.pk),
					index_schema.is_unique or false,
					db():table_entries(index_schema.name),
				})
			end
		end)
	end
end)

dynamic_rowset('^db_explorer_rows_(.+)$', function(tbl)
	local schema = checkfound(db():atomic('any', function(tbl)
		return db():table_schema(tbl)
	end, tbl))
	checkfound(not schema.is_index)
	local field_attrs = {}
	for _, col in ipairs(schema.cols) do
		field_attrs[col] = {internal = false, hidden = false, cols = null}
	end
	local sel = cat(schema.cols, ', ')
	return scan_rowset{
		scan = function(db) return db:scan(tbl, ''):select(sel) end,
		pk = cat(schema.pk, ' '),
		cols = cat(schema.cols, ' '),
		field_attrs = field_attrs,
	}
end)

--the keys and values of a table as stored, for an index table or a table
--without a schema. base tables with a schema are rowset.table_NAME.
rowset.db_explorer_rows_raw = virtual_rowset(function(rs)
	rs.manual_init_fields = true
	rs.can_move_rows = false
	rs.params = {table = table_param}
	rs.fields = {
		{name = 'key', label = 'Key (hex)', readonly = true,
			not_null = true},
		{name = 'value', label = 'Value (hex)', readonly = true,
			not_null = true},
	}
	rs.pk = 'key value'
	function rs:load_rows(res, params)
		res.rows = {} -- {row_i -> {hex_key, hex_value}}
		db():atomic('r', function()
			for cursor, key, key_size, value, value_size in
				db():each_raw(params.table)
			do
				add(res.rows, {
					tohex(str(key, key_size)),
					tohex(str(value, value_size)),
				})
			end
		end)
	end
	rs:init_fields(false)
end)
