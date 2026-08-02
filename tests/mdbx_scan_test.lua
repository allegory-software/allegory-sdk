require'mdbx_scan'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function test_file(name)
	return '/tmp/sdk_mdbx_scan_test_'..name..'_'..uuid()..'.mdb'
end

local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
end

--run f(db, file) against a fresh isolated db.
local function with_db(name, f)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(f, debug.traceback, db, file)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

local function add_table_scanner_data(db)
	db:begin'w'
	db:create_table('scan_rows', {fields = {
		{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16,
			nozero = true, not_null = true},
		{col = 'active', mdbx_type = 'bool', not_null = true},
		{col = 'score', mdbx_type = 'i32'},
	}, pk = {'tenant_id', 'id'}})
	db:add_index('scan_rows', {'status'})
	db:add_index('scan_rows', {'active'})
	db:add_index('scan_rows', {'score'})
	for _, row in ipairs{
		{tenant_id = 1, id = 1, status = 'ready', active = false},
		{tenant_id = 1, id = 2, status = 'ready', active = true,
			score = 10},
		{tenant_id = 1, id = 3, status = 'ready', active = false,
			score = 20},
		{tenant_id = 2, id = 1, status = 'ready', active = false,
			score = 30},
		{tenant_id = 2, id = 2, status = 'done', active = true},
	} do
		db:insert('scan_rows', '{}', row)
	end

	db:create_table('scan_files', {fields = {
		{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
		{col = 'path', mdbx_type = 'utf8', maxlen = 32,
			nozero = true, not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16,
			nozero = true, not_null = true},
	}, pk = {'tenant_id', 'path'}})
	db:add_index('scan_files', {'status'})
	for _, row in ipairs{
		{tenant_id = 1, path = 'a/1', status = 'ready'},
		{tenant_id = 1, path = 'a/2', status = 'ready'},
		{tenant_id = 1, path = 'b/1', status = 'ready'},
		{tenant_id = 2, path = 'a/3', status = 'ready'},
		{tenant_id = 1, path = 'a/4', status = 'done'},
	} do
		db:insert('scan_files', '{}', row)
	end
	db:commit()
end

local function table_scanner_col_decoder(db, scan, col)
	local cursor_schema = db:table_schema(scan.table)
	local base_schema = cursor_schema.val_schema or cursor_schema
	local pk_rec = cursor_schema.is_index and scan.val_rec or scan.key_rec
	return db:col_decoder(cursor_schema, col,
		cursor_schema.is_index and scan.key_rec or nil, pk_rec, function()
			if not cursor_schema.is_index then
				return scan.val_rec.data, scan.val_rec.size
			end
			local ok, data, sz = db:find_raw(base_schema.name,
				pk_rec.data, pk_rec.size)
			assert(ok)
			return data, sz
		end)
end

local function table_scanner_values(scan, get)
	local t = {}
	while scan.advance() do t[#t + 1] = get() end
	return cat(t, ',')
end

function test.table_scanner_access_paths()
	with_db('table_scanner_access_paths', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local full = db:table_scanner('scan_rows', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_tenant = table_scanner_col_decoder(db, full, 'tenant_id')
		local get_id = table_scanner_col_decoder(db, full, 'id')
		full.reset()
		assert(table_scanner_values(full, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1,2:2')

		local exact = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {arg = 1}},
			{'id', '=', {arg = 2}},
		})
		get_id = table_scanner_col_decoder(db, exact, 'id')
		exact.reset{1, 2}
		assert(table_scanner_values(exact, get_id) == '2')
		exact.reset{9, 9}
		assert(table_scanner_values(exact, get_id) == '')

		local range = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {arg = 1}},
			{'id', 'range', '>=', {arg = 2}, '<=', {arg = 3},
				dir = 'desc'},
		})
		get_id = table_scanner_col_decoder(db, range, 'id')
		range.reset{1, 1, 3}
		assert(table_scanner_values(range, get_id) == '3,2,1')

		local index = db:table_scanner('scan_rows/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, index, 'tenant_id')
		get_id = table_scanner_col_decoder(db, index, 'id')
		index.reset{'ready'}
		assert(table_scanner_values(index, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1')

		local status_prefix = db:table_scanner('scan_rows/status', {
			{'status', 'starts', {arg = 1}, dir = 'asc'},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, status_prefix, 'tenant_id')
		get_id = table_scanner_col_decoder(db, status_prefix, 'id')
		status_prefix.reset{'rea'}
		assert(table_scanner_values(status_prefix, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1')
		status_prefix.reset{'x'}
		assert(table_scanner_values(status_prefix, get_id) == '')

		local groups = db:table_scanner('scan_rows/status', {
			{'status', dir = 'asc'},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_status = table_scanner_col_decoder(db, groups, 'status')
		get_tenant = table_scanner_col_decoder(db, groups, 'tenant_id')
		get_id = table_scanner_col_decoder(db, groups, 'id')
		local grouped = {}
		groups.reset()
		while groups.advance_key() do
			local pks = {get_tenant()..':'..get_id()}
			while groups.advance_pk() do
				pks[#pks + 1] = get_tenant()..':'..get_id()
			end
			grouped[#grouped + 1] = get_status()..'='..cat(pks, ',')
		end
		assert(cat(grouped, ';') == 'done=2:2;ready=1:1,1:2,1:3,2:1')

		local pk_range = db:table_scanner('scan_rows/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', '=', {arg = 2}},
			{'id', 'range', '>=', {arg = 3}, '<=', {arg = 4},
				dir = 'desc'},
		})
		get_id = table_scanner_col_decoder(db, pk_range, 'id')
		pk_range.reset{'ready', 1, 1, 3}
		assert(table_scanner_values(pk_range, get_id) == '3,2,1')

		local prefix = db:table_scanner('scan_files/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', '=', {arg = 2}},
			{'path', 'starts', {arg = 3}, dir = 'desc'},
		})
		local get_path = table_scanner_col_decoder(db, prefix, 'path')
		prefix.reset{'ready', 1, 'a/'}
		assert(table_scanner_values(prefix, get_path) == 'a/2,a/1')
		prefix.reset{'ready', 1, 'a/1'}
		assert(table_scanner_values(prefix, get_path) == 'a/1')
		prefix.reset{'ready', 1, 'z/'}
		assert(table_scanner_values(prefix, get_path) == '')

		local prefix_asc = db:table_scanner('scan_files/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', '=', {arg = 2}},
			{'path', 'starts', {arg = 3}, dir = 'asc'},
		})
		get_path = table_scanner_col_decoder(db, prefix_asc, 'path')
		prefix_asc.reset{'ready', 1, 'a/'}
		assert(table_scanner_values(prefix_asc, get_path) == 'a/1,a/2')

		for _, scan in ipairs{
			full, exact, range, index, status_prefix, groups, pk_range,
			prefix, prefix_asc,
		} do
			scan.close()
		end
		db:commit()
	end)
end

function test.table_scanner_merge_union()
	with_db('table_scanner_merge_union', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local function pk_of(db, scan)
			local get_tenant = table_scanner_col_decoder(db, scan, 'tenant_id')
			local get_id = table_scanner_col_decoder(db, scan, 'id')
			return get_tenant()..':'..get_id()
		end

		--same value on both sides: dedups down to the plain single-scan
		--result, not doubled.
		local ready1 = db:table_scanner('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local ready2 = db:table_scanner('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local dup = ready1:merge_union(ready2)
		dup.reset()
		assert(table_scanner_values(dup, function() return pk_of(db, dup) end)
			== '1:1,1:2,1:3,2:1')
		dup.close()

		--the same index key needs its duplicate PK as the tie-breaker.
		local ready_tail = db:table_scanner('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {value = 1}}, {'id', '>=', {value = 2}},
		})
		local ready_head = db:table_scanner('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {value = 1}}, {'id', '<=', {value = 2}},
		})
		local overlap = ready_tail:merge_union(ready_head)
		overlap.reset()
		assert(table_scanner_values(overlap,
			function() return pk_of(db, overlap) end) == '1:1,1:2,1:3')
		overlap.close()

		--different index keys stay in index order, not primary-key order.
		local act_true = db:table_scanner('scan_rows/active', {
			{'active', '=', {value = true}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local act_false = db:table_scanner('scan_rows/active', {
			{'active', '=', {value = false}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local merged = act_true:merge_union(act_false)
		merged.reset()
		assert(table_scanner_values(merged, function() return pk_of(db, merged) end)
			== '1:1,1:3,2:1,1:2,2:2')
		merged.close()

		--reverse direction.
		local act_true_desc = db:table_scanner('scan_rows/active', {
			{'active', '=', {value = true}},
			{'tenant_id', dir = 'desc'}, {'id', dir = 'desc'},
		})
		local act_false_desc = db:table_scanner('scan_rows/active', {
			{'active', '=', {value = false}},
			{'tenant_id', dir = 'desc'}, {'id', dir = 'desc'},
		})
		local merged_desc = act_true_desc:merge_union(act_false_desc)
		merged_desc.reset()
		assert(table_scanner_values(merged_desc,
			function() return pk_of(db, merged_desc) end)
			== '2:2,1:2,2:1,1:3,1:1')
		merged_desc.close()

		--pairwise chaining: a third input duplicating the first's value
		--still dedups, across two merge_union() layers.
		local ready3 = db:table_scanner('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local done1 = db:table_scanner('scan_rows/status', {
			{'status', '=', {value = 'done'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local ready4 = db:table_scanner('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local chained = ready3:merge_union(done1):merge_union(ready4)
		chained.reset()
		assert(table_scanner_values(chained, function() return pk_of(db, chained) end)
			== '2:2,1:1,1:2,1:3,2:1')
		chained.close()

		--mismatched tables are rejected.
		local files = db:table_scanner('scan_files/status', {
			{'status', '=', {value = 'ready'}},
		})
		local rows = db:table_scanner('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
		})
		assert(not pcall(function() return files:merge_union(rows) end))
		files.close()
		rows.close()

		db:commit()
	end)
end

function test.table_scanner_max_bounds()
	with_db('table_scanner_max_bounds', function(db)
		db:begin'w'
		db:create_table('scan_max', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:insert('scan_max', 'id', 1)
		db:insert('scan_max', 'id', 0xffffffff)
		db:commit()
		db:begin'r'

		local gt = db:table_scanner('scan_max', {
			{'id', '>', {arg = 1}},
		})
		local get_id = table_scanner_col_decoder(db, gt, 'id')
		gt.reset{0xffffffff}
		assert(table_scanner_values(gt, get_id) == '')

		local le = db:table_scanner('scan_max', {
			{'id', '<=', {arg = 1}},
		})
		get_id = table_scanner_col_decoder(db, le, 'id')
		le.reset{0xffffffff}
		assert(table_scanner_values(le, get_id) == '1,4294967295')

		gt.close()
		le.close()
		db:commit()
	end)
end

function test.table_scanner_descending_ranges()
	with_db('table_scanner_descending_ranges', function(db)
		db:begin'w'
		db:create_table('scan_desc', {fields = {
			{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'status', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
		}, pk = {
			'tenant_id', 'id', desc = {false, true},
		}})
		db:add_index('scan_desc', {'status'})
		for _, row in ipairs{
			{1, 1, 'ready'},
			{1, 2, 'ready'},
			{1, 3, 'ready'},
			{1, 4, 'ready'},
			{2, 2, 'ready'},
		} do
			db:insert('scan_desc', 'tenant_id id status', unpack(row))
		end
		db:commit()
		db:begin'r'

		local full = db:table_scanner('scan_desc', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'desc'},
		})
		local get_tenant = table_scanner_col_decoder(db, full, 'tenant_id')
		local get_id = table_scanner_col_decoder(db, full, 'id')
		full.reset()
		assert(table_scanner_values(full, function()
			return get_tenant()..':'..get_id()
		end) == '1:4,1:3,1:2,1:1,2:2')

		local reverse = db:table_scanner('scan_desc', {
			{'tenant_id', dir = 'desc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, reverse, 'tenant_id')
		get_id = table_scanner_col_decoder(db, reverse, 'id')
		reverse.reset()
		assert(table_scanner_values(reverse, function()
			return get_tenant()..':'..get_id()
		end) == '2:2,1:1,1:2,1:3,1:4')

		for _, range_test in ipairs{
			{{'id', '>', {arg = 1}, dir = 'desc'}, {2}, '4,3'},
			{{'id', '>=', {arg = 1}, dir = 'desc'}, {2}, '4,3,2'},
			{{'id', '<', {arg = 1}, dir = 'desc'}, {3}, '2,1'},
			{{'id', '<=', {arg = 1}, dir = 'desc'}, {3}, '3,2,1'},
			{{'id', 'range', '>', {arg = 1}, '<=', {arg = 2},
				dir = 'desc'}, {1, 3}, '3,2'},
			{{'id', 'range', '>=', {arg = 1}, '<', {arg = 2},
				dir = 'desc'}, {1, 3}, '2,1'},
			{{'id', '>', {arg = 1}, dir = 'desc'}, {4}, ''},
			{{'id', '<=', {arg = 1}, dir = 'desc'}, {0}, ''},
			{{'id', 'range', '>=', {arg = 1}, '<=', {arg = 2},
				dir = 'desc'}, {3, 2}, ''},
		} do
			local term, args, expected = unpack(range_test, 1, 3)
			local scan = db:table_scanner('scan_desc', {
				{'tenant_id', '=', {value = 1}},
				term,
			})
			get_id = table_scanner_col_decoder(db, scan, 'id')
			scan.reset(args)
			assert(table_scanner_values(scan, get_id) == expected)
			scan.close()
		end

		local pk_range = db:table_scanner('scan_desc/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {arg = 1}},
			{'id', 'range', '>', {arg = 2}, '<=', {arg = 3},
				dir = 'desc'},
		})
		get_id = table_scanner_col_decoder(db, pk_range, 'id')
		pk_range.reset{1, 1, 3}
		assert(table_scanner_values(pk_range, get_id) == '3,2')

		local pk_range_asc = db:table_scanner('scan_desc/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {arg = 1}},
			{'id', 'range', '>', {arg = 2}, '<=', {arg = 3},
				dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, pk_range_asc, 'id')
		pk_range_asc.reset{1, 1, 3}
		assert(table_scanner_values(pk_range_asc, get_id) == '2,3')

		full.close()
		reverse.close()
		pk_range.close()
		pk_range_asc.close()
		db:commit()
	end)
end

function test.table_scanner_nil_null_and_false()
	with_db('table_scanner_nil_null_and_false', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local active = db:table_scanner('scan_rows/active', {
			{'active', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_tenant = table_scanner_col_decoder(db, active, 'tenant_id')
		local get_id = table_scanner_col_decoder(db, active, 'id')
		active.reset{false}
		assert(table_scanner_values(active, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:3,2:1')

		local score_eq = db:table_scanner('scan_rows/score', {
			{'score', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, score_eq, 'tenant_id')
		get_id = table_scanner_col_decoder(db, score_eq, 'id')
		local function score_pks(scan)
			return table_scanner_values(scan, function()
				return get_tenant()..':'..get_id()
			end)
		end
		score_eq.reset{null}
		assert(score_pks(score_eq) == '')

		local score_is = db:table_scanner('scan_rows/score', {
			{'score', 'is', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, score_is, 'tenant_id')
		get_id = table_scanner_col_decoder(db, score_is, 'id')
		score_is.reset{null}
		assert(score_pks(score_is) == '1:1,2:2')

		local status_prefix = db:table_scanner('scan_rows/status', {
			{'status', 'starts', {value = null}},
		})
		status_prefix.reset()
		assert(not status_prefix.advance())

		active.close()
		score_eq.close()
		score_is.close()
		status_prefix.close()
		db:commit()
	end)
end

function test.table_scanner_null_comparisons()
	with_db('table_scanner_null_comparisons', function(db)
		db:begin'w'
		db:create_table('scan_null', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'g', mdbx_type = 'u32', not_null = true},
			{col = 'score', mdbx_type = 'i32'},
		}, pk = {'id'}})
		local _, _, score_asc = db:add_index('scan_null', {'score'})
		local _, _, score_desc = db:add_index('scan_null', {
			'score', desc = {true},
		})
		local _, _, group_asc = db:add_index('scan_null', {'g', 'score'})
		local _, _, group_desc = db:add_index('scan_null', {
			'g', 'score', desc = {false, true},
		})
		for _, row in ipairs{
			{id = 1, g = 1},
			{id = 2, g = 1, score = -1},
			{id = 3, g = 1, score = 10},
			{id = 4, g = 1, score = 20},
			{id = 5, g = 2},
			{id = 6, g = 2, score = 10},
		} do
			db:insert('scan_null', '{}', row)
		end
		db:commit()
		db:begin'r'

		local function values(index, path, args, col)
			local scan = db:table_scanner(index, path)
			local get = table_scanner_col_decoder(db, scan, col or 'id')
			scan.reset(args)
			local s = table_scanner_values(scan, get)
			scan.close()
			return s
		end

		assert(values(score_asc, {
			{'score', '=', {value = null}},
		}) == '')
		assert(values(score_asc, {
			{'score', 'is', {value = null}},
		}) == '1,5')
		assert(values(score_asc, {
			{'score', 'is', {value = 10}},
		}) == '3,6')
		assert(values('scan_null', {
			{'id', 'is', {value = null}},
		}) == '')
		assert(values('scan_null', {
			{'id', 'is_not_null', dir = 'asc'},
		}) == '1,2,3,4,5,6')

		for _, index in ipairs{score_asc, score_desc} do
			assert(values(index, {
				{'score', 'is_not_null', dir = 'asc'},
			}, nil, 'score') == '-1,10,10,20')
			assert(values(index, {
				{'score', '<=', {value = 10}, dir = 'asc'},
			}, nil, 'score') == '-1,10,10')
			assert(values(index, {
				{'score', '<=', {value = 10}, dir = 'desc'},
			}, nil, 'score') == '10,10,-1')
			assert(values(index, {
				{'score', '>', {value = null}, dir = 'asc'},
			}) == '')
			assert(values(index, {
				{'score', '<=', {value = null}, dir = 'asc'},
			}) == '')
		end

		for _, index in ipairs{group_asc, group_desc} do
			assert(values(index, {
				{'g', '=', {value = 1}},
				{'score', '<=', {value = 10}, dir = 'asc'},
			}, nil, 'score') == '-1,10')
		end

		local id_bound_read
		local null_eq = db:table_scanner(group_asc, {
			{'g', '=', {value = 1}},
			{'score', '=', {value = null}},
			{'id', '<=', {get = function()
				id_bound_read = true
				return 6
			end}},
		})
		null_eq.reset()
		assert(not id_bound_read and not null_eq.advance())

		local max_score = null
		local by_max = db:table_scanner(score_asc, {
			{'score', '<=', {get = function() return max_score end},
				dir = 'asc'},
		})
		local get_score = table_scanner_col_decoder(db, by_max, 'score')
		by_max.reset()
		assert(table_scanner_values(by_max, get_score) == '')
		max_score = 10
		by_max.reset()
		assert(table_scanner_values(by_max, get_score) == '-1,10,10')
		max_score = null
		by_max.reset()
		assert(table_scanner_values(by_max, get_score) == '')

		local exact_score = null
		local exact_get = db:table_scanner(score_asc, {
			{'score', 'is', {get = function() return exact_score end}},
		})
		local get_id = table_scanner_col_decoder(db, exact_get, 'id')
		exact_get.reset()
		assert(table_scanner_values(exact_get, get_id) == '1,5')
		exact_score = nil
		exact_get.reset()
		assert(table_scanner_values(exact_get, get_id) == '1,5')

		by_max.close()
		exact_get.close()
		null_eq.close()
		db:commit()
	end)
end

function test.table_scanner_column_refs()
	with_db('table_scanner_column_refs', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local outer = db:table_scanner('scan_rows', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		outer.reset()
		assert(outer.advance())

		local same_status = db:table_scanner('scan_rows/status', {
			{'status', '=', {scan = outer, col = 'status'}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_id = table_scanner_col_decoder(db, same_status, 'id')
		same_status.reset()
		assert(table_scanner_values(same_status, get_id) == '1,2,3,1')

		local same_active = db:table_scanner('scan_rows/active', {
			{'active', '=', {scan = outer, col = 'active'}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_tenant = table_scanner_col_decoder(db, same_active,
			'tenant_id')
		get_id = table_scanner_col_decoder(db, same_active, 'id')
		same_active.reset()
		assert(table_scanner_values(same_active, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:3,2:1')

		assert(outer.advance())
		same_active.reset()
		assert(table_scanner_values(same_active, function()
			return get_tenant()..':'..get_id()
		end) == '1:2,2:2')

		local same_pk = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {scan = outer, col = 'tenant_id'}},
			{'id', '=', {scan = outer, col = 'id'}},
		})
		get_id = table_scanner_col_decoder(db, same_pk, 'id')
		same_pk.reset()
		assert(table_scanner_values(same_pk, get_id) == '2')

		local id_scan = db:table_scanner('scan_rows', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		id_scan.reset()
		assert(id_scan.advance())
		assert(id_scan.advance())
		assert(id_scan.advance())
		local tenant_id_scan = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {scan = outer, col = 'tenant_id'}},
			{'id', '=', {scan = id_scan, col = 'id'}},
		})
		get_id = table_scanner_col_decoder(db, tenant_id_scan, 'id')
		tenant_id_scan.reset()
		assert(table_scanner_values(tenant_id_scan, get_id) == '3')

		local same_score = db:table_scanner('scan_rows/score', {
			{'score', '=', {scan = outer, col = 'score'}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, same_score, 'id')
		same_score.reset()
		assert(table_scanner_values(same_score, get_id) == '2')
		same_score.reset()
		assert(same_score.advance())
		local index_score = db:table_scanner('scan_rows/score', {
			{'score', '=', {scan = same_score, col = 'score'}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, index_score, 'id')
		index_score.reset()
		assert(table_scanner_values(index_score, get_id) == '2')
		outer.reset()
		assert(outer.advance())
		same_score.reset()
		assert(table_scanner_values(same_score, get_id) == '')

		outer.close()
		same_status.close()
		same_active.close()
		same_pk.close()
		id_scan.close()
		tenant_id_scan.close()
		same_score.close()
		index_score.close()
		db:commit()
	end)
end

--a correlated param whose source column has a different (but decodable)
--layout than the output key field: the raw-bytes path can't be used, so the
--source is decoded and re-encoded through the output field.
function test.table_scanner_incompatible_decode()
	with_db('table_scanner_incompatible_decode', function(db)
		db:begin'w'
		--source cols are utf8 maxlen 8; dest index cols are utf8 maxlen 16.
		db:create_table('src', {fields = {
			{col = 'tag', mdbx_type = 'utf8', maxlen = 8,
				nozero = true, not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 8,
				nozero = true, not_null = true},
		}, pk = {'tag'}})
		db:insert('src', '{}', {tag = 'x', name = 'foo'})

		db:create_table('dst', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'tag', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('dst', {'tag'})
		db:add_index('dst', {'name'})
		for _, row in ipairs{
			{id = 1, tag = 'x', name = 'foo'},
			{id = 2, tag = 'x', name = 'bar'},
			{id = 3, tag = 'y', name = 'foo'},
		} do
			db:insert('dst', '{}', row)
		end
		db:commit()
		db:begin'r'

		local outer = db:table_scanner('src', {{'tag', dir = 'asc'}})
		outer.reset()
		assert(outer.advance())

		--key-column source: src.tag (key_rec) -> dst/tag key (is_key_read).
		local by_tag = db:table_scanner('dst/tag', {
			{'tag', '=', {scan = outer, col = 'tag'}},
			{'id', dir = 'asc'},
		})
		local get_id = table_scanner_col_decoder(db, by_tag, 'id')
		by_tag.reset()
		assert(table_scanner_values(by_tag, get_id) == '1,2')

		--value-column source: src.name (val_rec) -> dst/name key.
		local by_name = db:table_scanner('dst/name', {
			{'name', '=', {scan = outer, col = 'name'}},
			{'id', dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, by_name, 'id')
		by_name.reset()
		assert(table_scanner_values(by_name, get_id) == '1,3')

		outer.close()
		by_tag.close()
		by_name.close()
		db:commit()
	end)
end

function test.table_scanner_reuse()
	with_db('table_scanner_reuse', function(db)
		add_table_scanner_data(db)
		db:begin'r'
		local scan = db:table_scanner('scan_rows/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_id = table_scanner_col_decoder(db, scan, 'id')

		scan.reset{'ready'}
		assert(scan.advance() and get_id() == 1)
		scan.reset{'done'}
		assert(table_scanner_values(scan, get_id) == '2')
		scan.close()
		scan.reset{'ready'}
		assert(scan.advance() and get_id() == 1)
		scan.close()
		db:commit()

		db:begin'r'
		scan.reset{'done'}
		assert(table_scanner_values(scan, get_id) == '2')
		scan.close()
		db:commit()
	end)
end

------------------------------------------------------------------------------

--fixture: users <- sessions <- events <- tags (FK chain). sessions
--12/13 and 15 have no events; event 22 and 23 have no tags -- exercises
--a left-joined group with two inner joins inside it (sessions JOIN
--events JOIN tags) attached to users, and found() propagation through
--all three levels (event 23's own missing tags drops session 14 and
--event 23 too, nulling the whole group for user 2).
local function build_join_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	for _, r in ipairs{{id=1},{id=2},{id=3},{id=4},{id=5}} do
		db:insert('users', '{}', r)
	end
	db:create_table('sessions', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'user_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	for _, r in ipairs{
		{id=11,user_id=1}, {id=12,user_id=1}, {id=13,user_id=1},
		{id=14,user_id=2}, {id=15,user_id=4},
	} do db:insert('sessions', '{}', r) end
	db:create_table('events', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'session_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('events', {'session_id'})
	for _, r in ipairs{{id=21,session_id=11},{id=22,session_id=11},
		{id=23,session_id=14}}
	do db:insert('events', '{}', r) end
	db:create_table('tags', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'event_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('tags', {'event_id'})
	for _, r in ipairs{{id=31,event_id=21},{id=32,event_id=21}} do
		db:insert('tags', '{}', r)
	end
	db:commit()
end

function test.join_scans_nested_group()
	with_db('join_scans_nested_group', function(db)
		build_join_fixture(db)
		db:begin'r'

		local users = db:table_scanner('users', {{'id', dir = 'asc'}})
		local sessions = db:table_scanner('sessions/user_id', {
			{'user_id', '=', {scan = users, col = 'id'}},
			{'id', dir = 'asc'},
		})
		local events = db:table_scanner('events/session_id', {
			{'session_id', '=', {scan = sessions, col = 'id'}},
			{'id', dir = 'asc'},
		})
		local tags = db:table_scanner('tags/event_id', {
			{'event_id', '=', {scan = events, col = 'id'}},
			{'id', dir = 'asc'},
		})
		local get_session_id = sessions:col_decoder('sessions', 'id')
		local get_event_id = events:col_decoder('events', 'id')
		local get_tag_id = tags:col_decoder('tags', 'id')

		--sessions JOIN events JOIN tags, all inner: only session 11's
		--events (21 has 2 tags, 22 has none) ever survive.
		local se = db:join_scans(sessions, events)
		local group = db:join_scans(se, tags)
		--the whole group left-joined onto users: user1 gets 2 real rows
		--(via session 11/event 21/tags 31,32); users 2,3,4,5 each get one
		--null-extended row.
		local result = db:left_join_scans(users, group)

		local t = {}
		result.reset()
		while result.advance() do
			local uid = users:col_decoder('users', 'id')()
			if group.found() then
				t[#t+1] = uid..':'..get_session_id()..':'..get_event_id()
					..':'..get_tag_id()
			else
				t[#t+1] = uid..':-'
			end
		end
		result.close()
		assert(cat(t, ',') ==
			'1:11:21:31,1:11:21:32,2:-,3:-,4:-,5:-', cat(t, ','))

		db:commit()
	end)
end

function test.child_scan_basic()
	with_db('child_scan_basic', function(db)
		build_join_fixture(db)
		db:begin'r'

		local users = db:table_scanner('users', {{'id', dir = 'asc'}})
		local sessions = db:table_scanner('sessions/user_id', {
			{'user_id', '=', {scan = users, col = 'id'}},
			{'id', dir = 'asc'},
		})
		db:child_scan(users, sessions)
		local get_session_id = sessions:col_decoder('sessions', 'id')

		--each(): inner-join sugar -- user 1 has 3 sessions, drives
		--3 iterations; a user with none (below) yields nothing at all.
		users.reset()
		assert(users.advance())
		local t = {}
		for _ in sessions:each() do t[#t+1] = get_session_id() end
		assert(cat(t, ',') == '11,12,13', cat(t, ','))

		--left_rows(): user 3 has no sessions -- exactly one
		--null-extended row, get_session_id() reading nil through the
		--gated col_decoder.
		while users.advance() and users:col_decoder('users', 'id')() ~= 3 do end
		clear(t)
		for _ in sessions:left_rows() do
			t[#t+1] = sessions.found() and get_session_id() or '-'
		end
		assert(cat(t, ',') == '-', cat(t, ','))

		--select()'s own decoders already go through the gated
		--col_decoder, so a null-extended row null-fills with no
		--separate wrapper: same user 3, via select() this time.
		sessions:select'id'
		for row in sessions:left_rows() do
			local _, id_val = row.get()
			assert(id_val == nil)
		end

		--first()/exists(): user 4 has session 15.
		while users.advance() and users:col_decoder('users', 'id')() ~= 4 do end
		assert(sessions:exists())
		assert(sessions:first() == 15)

		users.close()
		db:commit()
	end)
end

function test.child_scan_nested_group()
	with_db('child_scan_nested_group', function(db)
		build_join_fixture(db)
		db:begin'r'

		local users = db:table_scanner('users', {{'id', dir = 'asc'}})
		local sessions = db:table_scanner('sessions/user_id', {
			{'user_id', '=', {scan = users, col = 'id'}},
			{'id', dir = 'asc'},
		})
		local events = db:table_scanner('events/session_id', {
			{'session_id', '=', {scan = sessions, col = 'id'}},
			{'id', dir = 'asc'},
		})
		local tags = db:table_scanner('tags/event_id', {
			{'event_id', '=', {scan = events, col = 'id'}},
			{'id', dir = 'asc'},
		})
		db:child_scan(users, sessions)
		db:child_scan(sessions, events)
		db:child_scan(events, tags)
		local get_session_id = sessions:col_decoder('sessions', 'id')
		local get_event_id = events:col_decoder('events', 'id')
		local get_tag_id = tags:col_decoder('tags', 'id')

		--same fixture, same expected shape as join_scans_nested_group,
		--but driven by hand-written nested loops instead of a
		--compiler-built join tree -- sessions/events are inner-joined
		--(no matches drops the row entirely), only the outermost level
		--(against users) null-extends.
		local t = {}
		for _ in users:each() do
			local uid = users:col_decoder('users', 'id')()
			local any = false
			for _ in sessions:each() do
				for _ in events:each() do
					for _ in tags:each() do
						any = true
						t[#t+1] = uid..':'..get_session_id()..':'
							..get_event_id()..':'..get_tag_id()
					end
				end
			end
			if not any then t[#t+1] = uid..':-' end
		end
		assert(cat(t, ',') ==
			'1:11:21:31,1:11:21:32,2:-,3:-,4:-,5:-', cat(t, ','))

		tags.close()
		events.close()
		sessions.close()
		users.close()
		db:commit()
	end)
end

function test.select_table_outputs()
	with_db('select_table_outputs', function(db)
		build_join_fixture(db)
		db:begin'r'

		local users = db:table_scanner('users', {{'id', dir = 'asc'}})
		users:select{{name = 'uid', member = 'users', col = 'id'}}

		local t = {}
		for _, uid in users:rows() do t[#t+1] = uid end
		assert(cat(t, ',') == '1,2,3,4,5', cat(t, ','))

		local users_from = db:table_scanner('users', {
			{'id', '>=', {arg = 'MIN'}, dir = 'asc'},
		})
		users_from:select{{name = 'uid', member = 'users', col = 'id'}}
		t = {}
		for _, uid in users_from:rows{MIN = 3} do t[#t+1] = uid end
		assert(cat(t, ',') == '3,4,5', cat(t, ','))

		db:commit()
	end)
end

function test.scan_group_by()
	with_db('scan_group_by', function(db)
		build_join_fixture(db)
		db:begin'r'

		local sessions = db:table_scanner('sessions/user_id', {
			{'user_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		sessions:group_by{{member = 'sessions', col = 'user_id'}}
		local get_user_id = sessions:col_decoder('sessions', 'user_id')
		local get_id = sessions:col_decoder('sessions', 'id')

		local groups = {}
		sessions.reset()
		while sessions.advance() do
			local uid = get_user_id()
			local ids = {get_id()}
			while sessions.advance_pk() do ids[#ids+1] = get_id() end
			groups[#groups+1] = uid..':'..cat(ids, ',')
		end
		assert(cat(groups, ' ') == '1:11,12,13 2:14 4:15', cat(groups, ' '))

		sessions.close()
		db:commit()
	end)
end

function test.scan_aggregate_grouped()
	with_db('scan_aggregate_grouped', function(db)
		build_join_fixture(db)
		db:begin'r'

		local sessions = db:table_scanner('sessions/user_id', {
			{'user_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local cols = {{member = 'sessions', col = 'user_id'}}
		sessions:group_by(cols)
		sessions:aggregate({
			{name = 'uid', op = 'key', part = 1},
			{name = 'cnt', op = 'count'},
			{name = 'idsum', op = 'sum', member = 'sessions', col = 'id'},
		}, cols)

		local t = {}
		for _, uid, cnt, idsum in sessions:rows() do
			t[#t+1] = uid..':'..cnt..':'..idsum
		end
		assert(cat(t, ' ') == '1:3:36 2:1:14 4:1:15', cat(t, ' '))

		db:commit()
	end)
end

function test.scan_aggregate_grand_total()
	with_db('scan_aggregate_grand_total', function(db)
		build_join_fixture(db)
		db:begin'r'

		local sessions = db:table_scanner('sessions/user_id', {
			{'user_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		sessions:aggregate{
			{name = 'cnt', op = 'count'},
			{name = 'idsum', op = 'sum', member = 'sessions', col = 'id'},
		}

		local cnt, idsum = sessions:first()
		assert(cnt == 5 and idsum == 65, cnt..':'..idsum)

		db:commit()
	end)
end

function test.scan_hash_aggregate()
	with_db('scan_hash_aggregate', function(db)
		db:begin'w'
		db:create_table('events', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'user_id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		--user_id interleaved, not adjacent -- group_by() would see 4
		--separate single-row groups here; the hash mode must still find
		--the 2 real groups regardless of scan order.
		for _, r in ipairs{
			{id=1,user_id=1}, {id=2,user_id=2}, {id=3,user_id=1}, {id=4,user_id=2},
		} do db:insert('events', '{}', r) end
		db:commit()
		db:begin'r'

		local events = db:table_scanner('events', {{'id', dir = 'asc'}})
		local cols = {{member = 'events', col = 'user_id'}}
		events:aggregate({
			{name = 'uid', op = 'key', part = 1},
			{name = 'cnt', op = 'count'},
			{name = 'idsum', op = 'sum', member = 'events', col = 'id'},
		}, cols, true)

		local t = {}
		for _, uid, cnt, idsum in events:rows() do
			t[#t+1] = uid..':'..cnt..':'..idsum
		end
		sort(t)
		assert(cat(t, ' ') == '1:2:4 2:2:6', cat(t, ' '))

		db:commit()
	end)
end

------------------------------------------------------------------------------

function test.scan_sort()
	with_db('scan_sort', function(db)
		db:begin'w'
		db:create_table('items', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'score', mdbx_type = 'i32'},
		}, pk = {'id'}})
		for _, r in ipairs{
			{id=1,score=30}, {id=2,score=10}, {id=3}, {id=4,score=20},
		} do db:insert('items', '{}', r) end
		db:commit()
		db:begin'r'

		local items = db:table_scanner('items', {{'id', dir = 'asc'}})
		items:select{
			{name = 'id', member = 'items', col = 'id'},
			{name = 'score', member = 'items', col = 'score'},
		}
		--desc: null sorts last, per doc.
		items:sort{{col = 'score', desc = true}}

		local t = {}
		for _, row in items:rows'{}' do
			t[#t+1] = row.id..':'..tostring(row.score)
		end
		assert(cat(t, ' ') == '1:30 4:20 2:10 3:nil', cat(t, ' '))

		db:commit()
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
