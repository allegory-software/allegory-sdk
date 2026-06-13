require'schema'

local opt = {
	engine = 'test',
	supports_fks = true,
	relevant_field_attrs = {
		col=1,
		col_pos=1,
		type=1,
		not_null=1,
		default=1,
	},
	index_field_attrs = {
		type=1,
		not_null=1,
	},
	fk_field_attrs = {
		type=1,
		not_null=1,
	},
	indexes_store_pk = true,
	fk_indexes_store_pk = true,
}

local function field(col, type, default)
	return {col = col, type = type, default = default}
end

local function table_def(name, fields, pk, ixs, fks)
	for i, f in ipairs(fields) do
		f.col_pos = i
	end
	return {
		name = name,
		fields = fields,
		pk = pk,
		ixs = ixs,
		fks = fks,
	}
end

local function fk(table_name, col, ref_table, ref_col)
	return {
		name = col,
		table = table_name,
		cols = {col},
		ref_table = ref_table,
		ref_cols = {ref_col},
		onupdate = 'cascade',
	}
end

local function test_schema(parent_type, child_type, child_default)
	local sc = schema.new(update({}, opt))
	sc.tables.parent = table_def('parent', {
		field('id', parent_type),
		field('name', 'text'),
	}, {'id'}, {
		parent_name = {'name'},
	})
	sc.tables.child = table_def('child', {
		field('id', 'u32'),
		field('parent_id', child_type),
		field('note', 'text', child_default),
	}, {'id'}, {
		child_note = {'note'},
	}, {
		parent_id = fk('child', 'parent_id', 'parent', 'id'),
	})
	return sc
end

local function assert_replaced(d, kind, name)
	local deps = assert(d[kind], kind)
	assert(deps.remove and deps.remove[name], kind..' remove '..name)
	assert(deps.add and deps.add[name], kind..' add '..name)
end

--A changed indexed field rebuilds its index but an irrelevant default does not.
do
	local old = test_schema('u32', 'u32')
	local new = test_schema('u32', 'u32', 1)
	local d = schema.diff(old, new)
	assert(d.tables.update.child.fields.update.note)
	assert(not d.tables.update.child.ixs)

	new.tables.child.fields[3].type = 'bytes'
	d = schema.diff(old, new)
	assert_replaced(d.tables.update.child, 'ixs', 'child_note')
end

--Changing either FK endpoint recreates the FK on its child table.
do
	local old = test_schema('u32', 'u32')
	local new = test_schema('u64', 'u32')
	local d = schema.diff(old, new)
	assert_replaced(d.tables.update.child, 'fks', 'parent_id')

	new = test_schema('u32', 'u64')
	d = schema.diff(old, new)
	assert_replaced(d.tables.update.child, 'fks', 'parent_id')
end

--Indexes and FK enforcement indexes embed the base-table primary key.
do
	local old = test_schema('u32', 'u32')
	local new = test_schema('u32', 'u32')
	new.tables.child.fields[1].type = 'u64'
	local d = schema.diff(old, new)
	assert_replaced(d.tables.update.child, 'ixs', 'child_note')
	assert_replaced(d.tables.update.child, 'fks', 'parent_id')
end

print'schema_diff ok'
