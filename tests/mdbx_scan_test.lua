require'mdbx_scan'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t + 1, k)
end})

-- remove both files that an MDBX environment creates.
local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
end

-- run one test against a fresh database and always remove its files.
local function with_db(name, fn)
	local file = '/tmp/sdk_mdbx_scan_test_'..name..'_'..uuid()..'.mdb'
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		db:begin'w'
		db:create_table('items', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
			{col = 'status', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
			{col = 'created_at', mdbx_type = 'u32', not_null = true},
			{col = 'score', mdbx_type = 'i32'},
			{col = 'rank', mdbx_type = 'i32', not_null = true},
			{col = 'note', mdbx_type = 'utf8', maxlen = 32,
				nozero = true},
		}, pk = {'id'}})
		db:add_index('items', {'status'})
		db:add_index('items', {'score'})
		local rank_index = {'rank'}
		rank_index.desc = {true}
		db:add_index('items', rank_index)
		db:add_index('items', {'tenant_id', 'status', 'created_at'})
		local created_desc_index = {'tenant_id', 'status', 'created_at'}
		created_desc_index.desc = {false, false, true}
		db:add_index('items', created_desc_index)
		for _, row in ipairs{
			{id = 1, tenant_id = 1, status = 'active',
				created_at = 100, score = 10, rank = 10, note = 'one'},
			{id = 2, tenant_id = 1, status = 'active',
				created_at = 100, score = 20, rank = 20},
			{id = 3, tenant_id = 1, status = 'active',
				created_at = 200, score = 30, rank = 30,
				note = 'three'},
			{id = 4, tenant_id = 1, status = 'closed',
				created_at = 150, score = 40, rank = 40,
				note = 'four'},
			{id = 5, tenant_id = 2, status = 'active',
				created_at = 100, score = 50, rank = 50,
				note = 'five'},
		} do
			db:insert('items', '{}', row)
		end

		db:create_table('entries', {fields = {
			{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'status', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
		}, pk = {'tenant_id', 'id'}})
		db:add_index('entries', {'status'})
		for _, row in ipairs{
			{tenant_id = 1, id = 1, status = 'active'},
			{tenant_id = 1, id = 2, status = 'active'},
			{tenant_id = 1, id = 4, status = 'active'},
			{tenant_id = 2, id = 1, status = 'active'},
			{tenant_id = 2, id = 3, status = 'active'},
			{tenant_id = 3, id = 1, status = 'closed'},
		} do
			db:insert('entries', '{}', row)
		end

		local files_pk = {'tenant_id', 'path'}
		files_pk.desc = {false, true}
		db:create_table('files', {fields = {
			{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
			{col = 'path', mdbx_type = 'utf8', maxlen = 64,
				nozero = true, not_null = true},
			{col = 'status', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
		}, pk = files_pk})
		db:add_index('files', {'status'})
		for _, row in ipairs{
			{tenant_id = 1, path = 'invoices/2025/a',
				status = 'ready'},
			{tenant_id = 1, path = 'invoices/2026/a',
				status = 'ready'},
			{tenant_id = 1, path = 'invoices/2026/b',
				status = 'ready'},
			{tenant_id = 1, path = 'notes/a', status = 'ready'},
			{tenant_id = 2, path = 'invoices/2026/c',
				status = 'ready'},
			{tenant_id = 1, path = 'invoices/2026/c',
				status = 'closed'},
		} do
			db:insert('files', '{}', row)
		end
		db:commit()
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

-- add FK data for both join directions and self-joins.
local function add_join_data(db)
	db:begin'w'
	db:create_table('customers', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'name', mdbx_type = 'utf8', maxlen = 32,
			nozero = true, not_null = true},
	}, pk = {'id'}})
	db:create_table('orders', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'customer_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_fk{table = 'orders', cols = {'customer_id'},
		ref_table = 'customers', ref_cols = {'id'}}
	for _, customer_row in ipairs{
		{id = 1, name = 'Ada'},
		{id = 2, name = 'Bob'},
		{id = 3, name = 'Cyd'},
	} do
		db:insert('customers', '{}', customer_row)
	end
	for _, order_row in ipairs{
		{id = 10, customer_id = 1},
		{id = 11, customer_id = 1},
		{id = 12, customer_id = 2},
	} do
		db:insert('orders', '{}', order_row)
	end

	db:create_table('invoices', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'buyer_id', mdbx_type = 'u32', not_null = true},
		{col = 'seller_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_fk{table = 'invoices', cols = {'buyer_id'},
		ref_table = 'customers', ref_cols = {'id'}}
	db:add_fk{table = 'invoices', cols = {'seller_id'},
		ref_table = 'customers', ref_cols = {'id'}}
	db:insert('invoices', '{}', {id = 20, buyer_id = 1, seller_id = 2})
	db:insert('invoices', '{}', {id = 21, buyer_id = 2, seller_id = 1})

	db:create_table('employees', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'manager_id', mdbx_type = 'u32'},
		{col = 'name', mdbx_type = 'utf8', maxlen = 32,
			nozero = true, not_null = true},
	}, pk = {'id'}})
	db:add_fk{table = 'employees', cols = {'manager_id'},
		ref_table = 'employees', ref_cols = {'id'}}
	db:insert('employees', '{}', {id = 1, name = 'CEO'})
	db:insert('employees', '{}', {id = 2, manager_id = 1,
		name = 'Lead'})
	db:insert('employees', '{}', {id = 3, manager_id = 2,
		name = 'Dev A'})
	db:insert('employees', '{}', {id = 4, manager_id = 2,
		name = 'Dev B'})

	local account_pk = {'tenant_id', 'id'}
	account_pk.desc = {false, true}
	db:create_table('accounts', {fields = {
		{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
		{col = 'id', mdbx_type = 'u32', not_null = true},
	}, pk = account_pk})
	db:create_table('tickets', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
		{col = 'account_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_fk{table = 'tickets', cols = {'tenant_id', 'account_id'},
		ref_table = 'accounts', ref_cols = {'tenant_id', 'id'}}
	db:insert('accounts', '{}', {tenant_id = 1, id = 10})
	db:insert('accounts', '{}', {tenant_id = 1, id = 20})
	db:insert('tickets', '{}', {id = 30, tenant_id = 1,
		account_id = 10})
	db:insert('tickets', '{}', {id = 31, tenant_id = 1,
		account_id = 20})
	db:commit()
end

-- collect one compiled value from one scan execution.
local function collect(scan, get, ...)
	scan.reset(...)
	local t = {}
	while scan.advance() do t[#t + 1] = get() end
	return t
end

-- collect one compiled value from each distinct physical key.
local function collect_keys(scan, get, ...)
	scan.reset(...)
	local t = {}
	while scan.advance(true) do t[#t + 1] = get() end
	return t
end

-- collect two compiled values from each joined row.
local function collect_pairs(scan, get_a, get_b, ...)
	scan.reset(...)
	local t = {}
	while scan.advance() do
		local a, b = get_a(), get_b()
		t[#t + 1] = a..':'..(b == nil and 'nil' or b)
	end
	return t
end

-- compare one value list with its comma-separated expected values.
local function assert_values(values, expected)
	assert(cat(values, ',') == expected,
		'expected '..expected..', got '..cat(values, ','))
end

-- use the base-table PK for a complete exact lookup.
function test.exact_pk()
	with_db('exact_pk', function(db)
		db:atomic('r', function()
			local scan = db:scan('items', 'id')
			local get_id = scan.col_decoder'id'
			local get_note = scan.col_decoder'note'
			scan.reset(3)
			assert(scan.advance())
			assert(get_id() == 3 and get_note() == 'three')
			assert(scan.advance() == nil)
			scan.reset(999)
			assert(scan.advance() == nil)
			scan.close()
		end)
	end)
end

-- scan every duplicate under one exact secondary-index key.
function test.exact_index()
	with_db('exact_index', function(db)
		db:atomic('r', function()
			local scan = db:scan('items', 'status, id asc')
			local get_id = scan.col_decoder'id'
			local get_status = scan.col_decoder'status'
			local get_note = scan.col_decoder'note'
			assert_values(collect(scan, get_id, 'active'),
				'1,2,3,5')
			scan.reset('active')
			assert(scan.advance())
			assert(get_id() == 1 and get_status() == 'active')
			assert(get_note() == 'one')
			assert(scan.advance())
			assert(get_id() == 2 and get_note() == nil)
			local e = scan.explain()
			assert(e.key == 'items/status', e.key)
			assert(e.order[1] == 'id asc', e.order[1])
			scan.close()
		end)
	end)
end

-- follow equality columns in key-prefix order before the ranged field.
function test.composite_range_asc()
	with_db('composite_range_asc', function(db)
		db:atomic('r', function()
			local scan = db:scan('items',
				'tenant_id, status, created_at [:] asc, id asc')
			local get_id = scan.col_decoder'id'
			assert_values(collect(scan, get_id, 1, 'active', 100, 200),
				'1,2,3')
			assert(scan.explain().key
				== 'items/tenant_id,status,created_at')
			scan.close()
		end)
	end)
end

-- walk both the range keys and duplicate PKs backward.
function test.composite_range_desc()
	with_db('composite_range_desc', function(db)
		db:atomic('r', function()
			local scan = db:scan('items',
				'tenant_id, status, created_at [:] desc, id desc')
			local get_id = scan.col_decoder'id'
			assert_values(collect(scan, get_id, 1, 'active', 100, 200),
				'3,2,1')
			scan.close()
		end)
	end)
end

-- select the descending index when only its reverse has the requested order.
function test.mixed_index_order()
	with_db('mixed_index_order', function(db)
		db:atomic('r', function()
			local scan = db:scan('items',
				'tenant_id, status, created_at [:] asc, id desc')
			assert_values(collect(scan, scan.col_decoder'id',
				1, 'active', 100, 200), '2,1,3')
			local e = scan.explain()
			assert(e.key == 'items/tenant_id,status,created_at:desc')
			assert(e.reverse)
			scan.close()
		end)
	end)
end

-- honor every open and closed range-bound combination.
function test.range_bounds()
	with_db('range_bounds', function(db)
		db:atomic('r', function()
			local function ids(lo_op, hi_op, lo, hi)
				local open = lo_op == 'gt' and '(' or '['
				local close = hi_op == 'le' and ']' or ')'
				local scan = db:scan('items',
					'score '..open..':'..close..' asc, id asc')
				local values = collect(scan, scan.col_decoder'id', lo, hi)
				scan.close()
				return values
			end
			assert_values(ids('ge', 'le', 20, 40), '2,3,4')
			assert_values(ids('gt', 'le', 20, 40), '3,4')
			assert_values(ids('ge', 'lt', 20, 40), '2,3')
			assert_values(ids('ge', nil, 40), '4,5')
			assert_values(ids(nil, 'le', nil, 20), '1,2')
			assert_values(ids('gt', 'lt', 20, 20), '')
			assert_values(ids('ge', 'le', 40, 20), '')
		end)
	end)
end

-- map logical bounds through a descending physical key encoding.
function test.descending_key_range()
	with_db('descending_key_range', function(db)
		db:atomic('r', function()
			local function ids(rank_dir, id_dir)
				local scan = db:scan('items',
					'rank [:] '..rank_dir..', id '..id_dir)
				local values = collect(scan, scan.col_decoder'id', 20, 40)
				scan.close()
				return values
			end
			assert_values(ids('desc', 'asc'), '4,3,2')
			assert_values(ids('asc', 'desc'), '2,3,4')
		end)
	end)
end

-- require explicit full scans and honor both PK cursor directions.
function test.full_scan()
	with_db('full_scan', function(db)
		db:atomic('r', function()
			local asc = db:scan('items', '')
			local desc = db:scan('items', 'id desc')
			assert_values(collect(asc, asc.col_decoder'id'), '1,2,3,4,5')
			assert_values(collect(desc, desc.col_decoder'id'), '5,4,3,2,1')
			asc.close()
			desc.close()
		end)
	end)
end

-- return nil from a nullable value-field getter.
function test.null_output()
	with_db('null_output', function(db)
		db:atomic('r', function()
			local scan = db:scan('items', 'id')
			local get_note = scan.col_decoder'note'
			scan.reset(2)
			assert(scan.advance())
			assert(get_note() == nil)
			assert(scan.advance() == nil)
			scan.close()
		end)
	end)
end

-- reuse one scan and its cursor with different parameters.
function test.reuse()
	with_db('reuse', function(db)
		db:atomic('r', function()
			local scan = db:scan('items', 'status, id asc')
			local get_id = scan.col_decoder'id'
			assert_values(collect(scan, get_id, 'active'),
				'1,2,3,5')
			assert_values(collect(scan, get_id, 'closed'), '4')
			scan.close()
		end)
	end)
end

-- reset a cursor after iteration stops before its last row.
function test.reset_after_early_stop()
	with_db('reset_after_early_stop', function(db)
		db:atomic('r', function()
			local scan = db:scan('items', 'status, id asc')
			local get_id = scan.col_decoder'id'
			scan.reset('active')
			assert(scan.advance() and get_id() == 1)
			scan.reset('closed')
			assert(scan.advance() and get_id() == 4)
			assert(scan.advance() == nil)
			scan.close()
		end)
	end)
end

-- reopen owned cursors when the next execution uses a new transaction.
function test.reuse_across_transactions()
	with_db('reuse_across_transactions', function(db)
		local scan, get_id
		db:atomic('r', function()
			scan = db:scan('items', 'id')
			get_id = scan.col_decoder'id'
			assert_values(collect(scan, get_id, 1), '1')
		end)
		db:atomic('r', function()
			assert_values(collect(scan, get_id, 5), '5')
			scan.close()
			assert_values(collect(scan, get_id, 2), '2')
			scan.close()
		end)
	end)
end

-- skip duplicate PKs when advancing distinct physical index keys.
function test.next_key()
	with_db('next_key', function(db)
		db:atomic('r', function()
			local scan = db:scan('items',
				'tenant_id, status, created_at [:] asc, id asc')
			assert_values(collect_keys(scan, scan.col_decoder'id',
				1, 'active', 100, 200), '1,3')
			scan.close()
		end)
	end)
end

-- apply a range to the implicit single-column PK index suffix.
function test.pk_suffix_range()
	with_db('pk_suffix_range', function(db)
		db:atomic('r', function()
			local scan = db:scan('items', 'status, id [:] desc')
			local get_id = scan.col_decoder'id'
			assert_values(collect(scan, get_id, 'active', 2, 5), '5,3,2')
			assert_values(collect_keys(scan, get_id, 'active', 2, 5), '5')
			scan.close()
		end)
	end)
end

-- apply equality and range bounds to a fixed composite PK suffix.
function test.composite_pk_suffix()
	with_db('composite_pk_suffix', function(db)
		db:atomic('r', function()
			local scan = db:scan('entries',
				'status, tenant_id [:] desc, id desc')
			local get_tenant = scan.col_decoder'tenant_id'
			local get_id = scan.col_decoder'id'
			scan.reset('active', 1, 2)
			local rows = {}
			while scan.advance() do
				rows[#rows + 1] = get_tenant()..':'..get_id()
			end
			assert_values(rows, '2:3,2:1,1:4,1:2,1:1')
			scan.close()
		end)
	end)
end

-- apply a prefix bound to the implicit variable-size PK suffix.
function test.pk_suffix_starts()
	with_db('pk_suffix_starts', function(db)
		db:atomic('r', function()
			local function paths(dir)
				local scan = db:scan('files',
					'status, tenant_id, path ^ '..dir)
				local values = collect(scan, scan.col_decoder'path',
					'ready', 1, 'invoices/2026/')
				scan.close()
				return values
			end
			assert_values(paths'desc',
				'invoices/2026/b,invoices/2026/a')
			assert_values(paths'asc',
				'invoices/2026/a,invoices/2026/b')
		end)
	end)
end

-- concatenate distinct equality scans in the input value order.
function test.in_values()
	with_db('in_values', function(db)
		db:atomic('r', function()
			local scan = db:scan('items',
				'tenant_id, status, created_at [:] asc, id asc')
			local iter = scan:in_('status', {
				'closed', 'active', 'closed',
			})
			local get_id = iter.col_decoder'id'
			assert_values(collect(iter, get_id, 1, 100, 200), '4,1,2,3')
			assert(#iter.explain().order == 0)
			iter.close()
			local active = db:scan('items',
				'tenant_id, status, created_at [:] asc, id asc')
				:in_('status', {'active'})
			assert_values(collect_keys(active, active.col_decoder'id',
				1, 100, 200), '1,3')
			active.close()
		end)
	end)
end

-- run one Lua predicate for every candidate row.
function test.filter()
	with_db('filter', function(db)
		db:atomic('r', function()
			local scan = db:scan('items', 'id asc')
			local get_id = scan.col_decoder'id'
			scan:filter(function() return get_id() % 2 == 1 end)
			assert_values(collect(scan, get_id), '1,3,5')
			scan.close()
		end)
	end)
end

-- skip values in one hash while preserving the underlying scan order.
function test.not_in_values()
	with_db('not_in_values', function(db)
		db:atomic('r', function()
			local scan = db:scan('items', 'id asc')
			local iter = scan:not_in('id', {2, 4, 2})
			local get_id = iter.col_decoder'id'
			assert_values(collect(iter, get_id), '1,3,5')
			assert(iter.explain().order[1] == 'id asc')
			iter.close()

			local nullable = db:scan('items', 'id asc')
				:not_in('note', {null, 'one'})
			assert_values(collect(nullable, nullable.col_decoder'id'),
				'3,4,5')
			nullable.close()
		end)
	end)
end

-- filter only the representative row returned by advance(true).
function test.not_in_next_key()
	with_db('not_in_next_key', function(db)
		db:atomic('r', function()
			local scan = db:scan('items',
				'tenant_id, status, created_at [:] asc, id asc')
			local iter = scan:not_in('id', {1})
			assert_values(collect_keys(iter, iter.col_decoder'id',
				1, 'active', 100, 200), '3')
			iter.close()
		end)
	end)
end

-- follow one FK toward children and toward a parent.
function test.fk_join_directions()
	with_db('fk_join_directions', function(db)
		add_join_data(db)
		db:atomic('r', function()
			local children = db:scan('customers', 'id asc')
				:fk_join('orders.customer_id')
			assert_values(collect_pairs(children,
				children.col_decoder('customers', 'id'),
				children.col_decoder('orders', 'id')),
				'1:10,1:11,2:12')
			children.close()

			local parents = db:scan('orders',
				'customer_id asc, id asc')
				:fk_join('customers.customer_id')
			assert_values(collect_pairs(parents,
				parents.col_decoder('orders', 'id'),
				parents.col_decoder('customers', 'id')),
				'10:1,11:1,12:2')
			parents.close()

			local left = db:scan('customers', 'id asc')
				:fk_left_join('orders.customer_id')
			assert_values(collect_pairs(left,
				left.col_decoder('customers', 'id'),
				left.col_decoder('orders', 'id')),
				'1:10,1:11,2:12,3:nil')
			left.close()
		end)
	end)
end

-- use FK columns to select one of two relationships between two tables.
function test.fk_join_columns()
	with_db('fk_join_columns', function(db)
		add_join_data(db)
		db:atomic('r', function()
			local ambiguous = db:scan('invoices', 'id asc')
			assert(not pcall(function()
				ambiguous:fk_join('customers')
			end))
			ambiguous.close()

			local buyers = db:scan('invoices', 'id asc')
				:fk_join('customers.buyer_id')
			assert_values(collect_pairs(buyers,
				buyers.col_decoder('invoices', 'id'),
				buyers.col_decoder('customers', 'id')),
				'20:1,21:2')
			buyers.close()

			local sold = db:scan('customers', 'id asc')
				:fk_join('invoices.seller_id')
			assert_values(collect_pairs(sold,
				sold.col_decoder('customers', 'id'),
				sold.col_decoder('invoices', 'id')),
				'1:21,2:20')
			sold.close()
		end)
	end)
end

-- name both endpoints of a self-referencing FK with join aliases.
function test.self_join()
	with_db('self_join', function(db)
		add_join_data(db)
		db:atomic('r', function()
			local managers = db:scan('employees', 'id asc')
				:left_join('employees@manager.id = employees.manager_id')
			assert_values(collect_pairs(managers,
				managers.col_decoder('employees', 'id'),
				managers.col_decoder('manager', 'id')),
				'1:nil,2:1,3:2,4:2')
			managers.close()

			local reports = db:scan('employees', 'id asc')
				:join('employees@report.manager_id = employees.id')
			assert_values(collect_pairs(reports,
				reports.col_decoder('employees', 'id'),
				reports.col_decoder('report', 'id')),
				'1:2,2:3,2:4')
			reports.close()

			-- fk_join cannot resolve a self-referencing FK.
			assert(not pcall(function()
				db:scan('employees', 'id asc'):fk_join('employees.manager_id')
			end))
		end)
	end)
end

-- read a column from one joined table when chaining self-joins.
function test.self_join_chain()
	with_db('self_join_chain', function(db)
		add_join_data(db)
		db:atomic('r', function()
			local scan = db:scan('employees', 'id asc')
				:join('employees@manager.id = employees.manager_id')
				:join('employees@grandmanager.id = manager.manager_id')
			assert_values(collect_pairs(scan,
				scan.col_decoder('employees', 'id'),
				scan.col_decoder('grandmanager', 'id')),
				'3:1,4:1')
			scan.close()
		end)
	end)
end

-- convert composite FK fields into a descending parent PK.
function test.fk_composite_key()
	with_db('fk_composite_key', function(db)
		add_join_data(db)
		db:atomic('r', function()
			local parents = db:scan('tickets', 'id asc')
				:fk_join('accounts.tenant_id,account_id')
			assert_values(collect_pairs(parents,
				parents.col_decoder('tickets', 'id'),
				parents.col_decoder('accounts', 'id')),
				'30:10,31:20')
			parents.close()

			local children = db:scan('accounts',
				'tenant_id asc, id desc')
				:fk_join('tickets.tenant_id,account_id')
			assert_values(collect_pairs(children,
				children.col_decoder('accounts', 'id'),
				children.col_decoder('tickets', 'id')),
				'20:31,10:30')
			children.close()
		end)
	end)
end

-- reject scans for which no one key enforces every condition.
function test.missing_index()
	with_db('missing_index', function(db)
		db:atomic('r', function()
			local ok, err = pcall(function()
				db:scan('items', 'status, score')
			end)
			assert(not ok)
			assert(tostring(err):find('scan: no key: status, score',
				1, true))
		end)
	end)
end

-- reject equality fields that do not follow an existing key prefix.
function test.key_prefix_order()
	with_db('key_prefix_order', function(db)
		db:atomic('r', function()
			local ok, err = pcall(function()
				db:scan('items',
					'status, tenant_id, created_at [:) asc')
			end)
			assert(not ok)
			assert(tostring(err):find(
				'scan: no key: status, tenant_id, created_at asc',
				1, true))
		end)
	end)
end

-- reject invalid declarations and missing execution parameters.
function test.validation()
	with_db('validation', function(db)
		db:atomic('r', function()
			assert(not pcall(function()
				db:scan('items', 'missing')
			end))
			local scan = db:scan('items', 'id')
			assert(not pcall(function() scan.reset() end))
			scan.close()
		end)
	end)
end

local name = ...
if name == 'mdbx_scan_test' then name = nil end
local tests = name and {name} or test
local n_ok, n_fail = 0, 0
for _, k in ipairs(tests) do
	io.write('test.'..k..' ... ')
	io.flush()
	local ok, err = xpcall(test[k], debug.traceback)
	if ok then
		print'ok'
		n_ok = n_ok + 1
	else
		print'FAILED'
		print(err)
		n_fail = n_fail + 1
		break
	end
end
print(('ok: %d, failed: %d'):format(n_ok, n_fail))
if n_fail > 0 then os.exit(1) end
