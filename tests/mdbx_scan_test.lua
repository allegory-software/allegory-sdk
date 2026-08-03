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

local function add_scan_data(db)
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

local function scan_col_decoder(db, scan, col)
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

local function scan_values(scan, get)
	local t = {}
	while scan.advance() do t[#t + 1] = get() end
	return cat(t, ',')
end

function test.scan_access_paths()
	with_db('scan_access_paths', function(db)
		add_scan_data(db)
		db:begin'r'

		local full = db:scan('scan_rows', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_tenant = scan_col_decoder(db, full, 'tenant_id')
		local get_id = scan_col_decoder(db, full, 'id')
		full.reset()
		assert(scan_values(full, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1,2:2')

		local exact = db:scan('scan_rows', {
			{'tenant_id', '=', {arg = 1}},
			{'id', '=', {arg = 2}},
		})
		get_id = scan_col_decoder(db, exact, 'id')
		exact.reset{1, 2}
		assert(scan_values(exact, get_id) == '2')
		exact.reset{9, 9}
		assert(scan_values(exact, get_id) == '')

		local range = db:scan('scan_rows', {
			{'tenant_id', '=', {arg = 1}},
			{'id', 'range', '>=', {arg = 2}, '<=', {arg = 3},
				dir = 'desc'},
		})
		get_id = scan_col_decoder(db, range, 'id')
		range.reset{1, 1, 3}
		assert(scan_values(range, get_id) == '3,2,1')

		local index = db:scan('scan_rows/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = scan_col_decoder(db, index, 'tenant_id')
		get_id = scan_col_decoder(db, index, 'id')
		index.reset{'ready'}
		assert(scan_values(index, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1')

		local status_prefix = db:scan('scan_rows/status', {
			{'status', 'starts', {arg = 1}, dir = 'asc'},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = scan_col_decoder(db, status_prefix, 'tenant_id')
		get_id = scan_col_decoder(db, status_prefix, 'id')
		status_prefix.reset{'rea'}
		assert(scan_values(status_prefix, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1')
		status_prefix.reset{'x'}
		assert(scan_values(status_prefix, get_id) == '')

		local groups = db:scan('scan_rows/status', {
			{'status', dir = 'asc'},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_status = scan_col_decoder(db, groups, 'status')
		get_tenant = scan_col_decoder(db, groups, 'tenant_id')
		get_id = scan_col_decoder(db, groups, 'id')
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

		local pk_range = db:scan('scan_rows/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', '=', {arg = 2}},
			{'id', 'range', '>=', {arg = 3}, '<=', {arg = 4},
				dir = 'desc'},
		})
		get_id = scan_col_decoder(db, pk_range, 'id')
		pk_range.reset{'ready', 1, 1, 3}
		assert(scan_values(pk_range, get_id) == '3,2,1')

		local prefix = db:scan('scan_files/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', '=', {arg = 2}},
			{'path', 'starts', {arg = 3}, dir = 'desc'},
		})
		local get_path = scan_col_decoder(db, prefix, 'path')
		prefix.reset{'ready', 1, 'a/'}
		assert(scan_values(prefix, get_path) == 'a/2,a/1')
		prefix.reset{'ready', 1, 'a/1'}
		assert(scan_values(prefix, get_path) == 'a/1')
		prefix.reset{'ready', 1, 'z/'}
		assert(scan_values(prefix, get_path) == '')

		local prefix_asc = db:scan('scan_files/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', '=', {arg = 2}},
			{'path', 'starts', {arg = 3}, dir = 'asc'},
		})
		get_path = scan_col_decoder(db, prefix_asc, 'path')
		prefix_asc.reset{'ready', 1, 'a/'}
		assert(scan_values(prefix_asc, get_path) == 'a/1,a/2')

		for _, scan in ipairs{
			full, exact, range, index, status_prefix, groups, pk_range,
			prefix, prefix_asc,
		} do
			scan.close()
		end
		db:commit()
	end)
end

function test.scan_merge_union()
	with_db('scan_merge_union', function(db)
		add_scan_data(db)
		db:begin'r'

		local function pk_of(db, scan)
			local get_tenant = scan_col_decoder(db, scan, 'tenant_id')
			local get_id = scan_col_decoder(db, scan, 'id')
			return get_tenant()..':'..get_id()
		end

		--same value on both sides: dedups down to the plain single-scan
		--result, not doubled.
		local ready1 = db:scan('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local ready2 = db:scan('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local dup = ready1:merge_union(ready2)
		dup.reset()
		assert(scan_values(dup, function() return pk_of(db, dup) end)
			== '1:1,1:2,1:3,2:1')
		dup.close()

		--the same index key needs its duplicate PK as the tie-breaker.
		local ready_tail = db:scan('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {value = 1}}, {'id', '>=', {value = 2}},
		})
		local ready_head = db:scan('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {value = 1}}, {'id', '<=', {value = 2}},
		})
		local overlap = ready_tail:merge_union(ready_head)
		overlap.reset()
		assert(scan_values(overlap,
			function() return pk_of(db, overlap) end) == '1:1,1:2,1:3')
		overlap.close()

		--different index keys stay in index order, not primary-key order.
		local act_true = db:scan('scan_rows/active', {
			{'active', '=', {value = true}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local act_false = db:scan('scan_rows/active', {
			{'active', '=', {value = false}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local merged = act_true:merge_union(act_false)
		merged.reset()
		assert(scan_values(merged, function() return pk_of(db, merged) end)
			== '1:1,1:3,2:1,1:2,2:2')
		merged.close()

		--reverse direction.
		local act_true_desc = db:scan('scan_rows/active', {
			{'active', '=', {value = true}},
			{'tenant_id', dir = 'desc'}, {'id', dir = 'desc'},
		})
		local act_false_desc = db:scan('scan_rows/active', {
			{'active', '=', {value = false}},
			{'tenant_id', dir = 'desc'}, {'id', dir = 'desc'},
		})
		local merged_desc = act_true_desc:merge_union(act_false_desc)
		merged_desc.reset()
		assert(scan_values(merged_desc,
			function() return pk_of(db, merged_desc) end)
			== '2:2,1:2,2:1,1:3,1:1')
		merged_desc.close()

		--pairwise chaining: a third input duplicating the first's value
		--still dedups, across two merge_union() layers.
		local ready3 = db:scan('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local done1 = db:scan('scan_rows/status', {
			{'status', '=', {value = 'done'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local ready4 = db:scan('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', dir = 'asc'}, {'id', dir = 'asc'},
		})
		local chained = ready3:merge_union(done1):merge_union(ready4)
		chained.reset()
		assert(scan_values(chained, function() return pk_of(db, chained) end)
			== '2:2,1:1,1:2,1:3,2:1')
		chained.close()

		--mismatched tables are rejected.
		local files = db:scan('scan_files/status', {
			{'status', '=', {value = 'ready'}},
		})
		local rows = db:scan('scan_rows/status', {
			{'status', '=', {value = 'ready'}},
		})
		assert(not pcall(function() return files:merge_union(rows) end))
		files.close()
		rows.close()

		db:commit()
	end)
end

function test.scan_max_bounds()
	with_db('scan_max_bounds', function(db)
		db:begin'w'
		db:create_table('scan_max', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:insert('scan_max', 'id', 1)
		db:insert('scan_max', 'id', 0xffffffff)
		db:commit()
		db:begin'r'

		local gt = db:scan('scan_max', {
			{'id', '>', {arg = 1}},
		})
		local get_id = scan_col_decoder(db, gt, 'id')
		gt.reset{0xffffffff}
		assert(scan_values(gt, get_id) == '')

		local le = db:scan('scan_max', {
			{'id', '<=', {arg = 1}},
		})
		get_id = scan_col_decoder(db, le, 'id')
		le.reset{0xffffffff}
		assert(scan_values(le, get_id) == '1,4294967295')

		gt.close()
		le.close()
		db:commit()
	end)
end

function test.scan_descending_ranges()
	with_db('scan_descending_ranges', function(db)
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

		local full = db:scan('scan_desc', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'desc'},
		})
		local get_tenant = scan_col_decoder(db, full, 'tenant_id')
		local get_id = scan_col_decoder(db, full, 'id')
		full.reset()
		assert(scan_values(full, function()
			return get_tenant()..':'..get_id()
		end) == '1:4,1:3,1:2,1:1,2:2')

		local reverse = db:scan('scan_desc', {
			{'tenant_id', dir = 'desc'},
			{'id', dir = 'asc'},
		})
		get_tenant = scan_col_decoder(db, reverse, 'tenant_id')
		get_id = scan_col_decoder(db, reverse, 'id')
		reverse.reset()
		assert(scan_values(reverse, function()
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
			local scan = db:scan('scan_desc', {
				{'tenant_id', '=', {value = 1}},
				term,
			})
			get_id = scan_col_decoder(db, scan, 'id')
			scan.reset(args)
			assert(scan_values(scan, get_id) == expected)
			scan.close()
		end

		local pk_range = db:scan('scan_desc/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {arg = 1}},
			{'id', 'range', '>', {arg = 2}, '<=', {arg = 3},
				dir = 'desc'},
		})
		get_id = scan_col_decoder(db, pk_range, 'id')
		pk_range.reset{1, 1, 3}
		assert(scan_values(pk_range, get_id) == '3,2')

		local pk_range_asc = db:scan('scan_desc/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {arg = 1}},
			{'id', 'range', '>', {arg = 2}, '<=', {arg = 3},
				dir = 'asc'},
		})
		get_id = scan_col_decoder(db, pk_range_asc, 'id')
		pk_range_asc.reset{1, 1, 3}
		assert(scan_values(pk_range_asc, get_id) == '2,3')

		full.close()
		reverse.close()
		pk_range.close()
		pk_range_asc.close()
		db:commit()
	end)
end

function test.scan_nil_null_and_false()
	with_db('scan_nil_null_and_false', function(db)
		add_scan_data(db)
		db:begin'r'

		local active = db:scan('scan_rows/active', {
			{'active', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_tenant = scan_col_decoder(db, active, 'tenant_id')
		local get_id = scan_col_decoder(db, active, 'id')
		active.reset{false}
		assert(scan_values(active, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:3,2:1')

		local score_eq = db:scan('scan_rows/score', {
			{'score', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = scan_col_decoder(db, score_eq, 'tenant_id')
		get_id = scan_col_decoder(db, score_eq, 'id')
		local function score_pks(scan)
			return scan_values(scan, function()
				return get_tenant()..':'..get_id()
			end)
		end
		score_eq.reset{null}
		assert(score_pks(score_eq) == '')

		local score_is = db:scan('scan_rows/score', {
			{'score', 'is', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = scan_col_decoder(db, score_is, 'tenant_id')
		get_id = scan_col_decoder(db, score_is, 'id')
		score_is.reset{null}
		assert(score_pks(score_is) == '1:1,2:2')

		local status_prefix = db:scan('scan_rows/status', {
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

function test.scan_null_comparisons()
	with_db('scan_null_comparisons', function(db)
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
			local scan = db:scan(index, path)
			local get = scan_col_decoder(db, scan, col or 'id')
			scan.reset(args)
			local s = scan_values(scan, get)
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
		local null_eq = db:scan(group_asc, {
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
		local by_max = db:scan(score_asc, {
			{'score', '<=', {get = function() return max_score end},
				dir = 'asc'},
		})
		local get_score = scan_col_decoder(db, by_max, 'score')
		by_max.reset()
		assert(scan_values(by_max, get_score) == '')
		max_score = 10
		by_max.reset()
		assert(scan_values(by_max, get_score) == '-1,10,10')
		max_score = null
		by_max.reset()
		assert(scan_values(by_max, get_score) == '')

		local exact_score = null
		local exact_get = db:scan(score_asc, {
			{'score', 'is', {get = function() return exact_score end}},
		})
		local get_id = scan_col_decoder(db, exact_get, 'id')
		exact_get.reset()
		assert(scan_values(exact_get, get_id) == '1,5')
		exact_score = nil
		exact_get.reset()
		assert(scan_values(exact_get, get_id) == '1,5')

		by_max.close()
		exact_get.close()
		null_eq.close()
		db:commit()
	end)
end

function test.scan_column_refs()
	with_db('scan_column_refs', function(db)
		add_scan_data(db)
		db:begin'r'

		local outer = db:scan('scan_rows', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		outer.reset()
		assert(outer.advance())

		local same_status = db:scan('scan_rows/status', {
			{'status', '=', {scan = outer, col = 'status'}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_id = scan_col_decoder(db, same_status, 'id')
		same_status.reset()
		assert(scan_values(same_status, get_id) == '1,2,3,1')

		local same_active = db:scan('scan_rows/active', {
			{'active', '=', {scan = outer, col = 'active'}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_tenant = scan_col_decoder(db, same_active,
			'tenant_id')
		get_id = scan_col_decoder(db, same_active, 'id')
		same_active.reset()
		assert(scan_values(same_active, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:3,2:1')

		assert(outer.advance())
		same_active.reset()
		assert(scan_values(same_active, function()
			return get_tenant()..':'..get_id()
		end) == '1:2,2:2')

		local same_pk = db:scan('scan_rows', {
			{'tenant_id', '=', {scan = outer, col = 'tenant_id'}},
			{'id', '=', {scan = outer, col = 'id'}},
		})
		get_id = scan_col_decoder(db, same_pk, 'id')
		same_pk.reset()
		assert(scan_values(same_pk, get_id) == '2')

		local id_scan = db:scan('scan_rows', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		id_scan.reset()
		assert(id_scan.advance())
		assert(id_scan.advance())
		assert(id_scan.advance())
		local tenant_id_scan = db:scan('scan_rows', {
			{'tenant_id', '=', {scan = outer, col = 'tenant_id'}},
			{'id', '=', {scan = id_scan, col = 'id'}},
		})
		get_id = scan_col_decoder(db, tenant_id_scan, 'id')
		tenant_id_scan.reset()
		assert(scan_values(tenant_id_scan, get_id) == '3')

		local same_score = db:scan('scan_rows/score', {
			{'score', '=', {scan = outer, col = 'score'}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_id = scan_col_decoder(db, same_score, 'id')
		same_score.reset()
		assert(scan_values(same_score, get_id) == '2')
		same_score.reset()
		assert(same_score.advance())
		local index_score = db:scan('scan_rows/score', {
			{'score', '=', {scan = same_score, col = 'score'}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_id = scan_col_decoder(db, index_score, 'id')
		index_score.reset()
		assert(scan_values(index_score, get_id) == '2')
		outer.reset()
		assert(outer.advance())
		same_score.reset()
		assert(scan_values(same_score, get_id) == '')

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
function test.scan_incompatible_decode()
	with_db('scan_incompatible_decode', function(db)
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

		local outer = db:scan('src', {{'tag', dir = 'asc'}})
		outer.reset()
		assert(outer.advance())

		--key-column source: src.tag (key_rec) -> dst/tag key (is_key_read).
		local by_tag = db:scan('dst/tag', {
			{'tag', '=', {scan = outer, col = 'tag'}},
			{'id', dir = 'asc'},
		})
		local get_id = scan_col_decoder(db, by_tag, 'id')
		by_tag.reset()
		assert(scan_values(by_tag, get_id) == '1,2')

		--value-column source: src.name (val_rec) -> dst/name key.
		local by_name = db:scan('dst/name', {
			{'name', '=', {scan = outer, col = 'name'}},
			{'id', dir = 'asc'},
		})
		get_id = scan_col_decoder(db, by_name, 'id')
		by_name.reset()
		assert(scan_values(by_name, get_id) == '1,3')

		outer.close()
		by_tag.close()
		by_name.close()
		db:commit()
	end)
end

function test.scan_reuse()
	with_db('scan_reuse', function(db)
		add_scan_data(db)
		db:begin'r'
		local scan = db:scan('scan_rows/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_id = scan_col_decoder(db, scan, 'id')

		scan.reset{'ready'}
		assert(scan.advance() and get_id() == 1)
		scan.reset{'done'}
		assert(scan_values(scan, get_id) == '2')
		scan.close()
		scan.reset{'ready'}
		assert(scan.advance() and get_id() == 1)
		scan.close()
		db:commit()

		db:begin'r'
		scan.reset{'done'}
		assert(scan_values(scan, get_id) == '2')
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

		local users = db:scan('users', {{'id', dir = 'asc'}})
		local sessions = db:scan('sessions/user_id', {
			{'user_id', '=', {scan = users, col = 'id'}},
			{'id', dir = 'asc'},
		})
		local events = db:scan('events/session_id', {
			{'session_id', '=', {scan = sessions, col = 'id'}},
			{'id', dir = 'asc'},
		})
		local tags = db:scan('tags/event_id', {
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

		local users = db:scan('users', {{'id', dir = 'asc'}})
		local sessions = db:scan('sessions/user_id', {
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

		local users = db:scan('users', {{'id', dir = 'asc'}})
		local sessions = db:scan('sessions/user_id', {
			{'user_id', '=', {scan = users, col = 'id'}},
			{'id', dir = 'asc'},
		})
		local events = db:scan('events/session_id', {
			{'session_id', '=', {scan = sessions, col = 'id'}},
			{'id', dir = 'asc'},
		})
		local tags = db:scan('tags/event_id', {
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

		local users = db:scan('users', {{'id', dir = 'asc'}})
		users:select{{name = 'uid', member = 'users', col = 'id'}}

		local t = {}
		for _, uid in users:rows() do t[#t+1] = uid end
		assert(cat(t, ',') == '1,2,3,4,5', cat(t, ','))

		local users_from = db:scan('users', {
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

		local sessions = db:scan('sessions/user_id', {
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

		local sessions = db:scan('sessions/user_id', {
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

		local sessions = db:scan('sessions/user_id', {
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

		local events = db:scan('events', {{'id', dir = 'asc'}})
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

		local items = db:scan('items', {{'id', dir = 'asc'}})
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
-- join by spec ----------------------------------------------------------

--users 1,2,3; user 3 has no sessions (left-join case). messages carries two
--FKs to users and users.manager_id points back at users, so both need an
--alias to appear twice. audit has no FK at all.
local function build_join_spec_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id'        , mdbx_type = 'u32', not_null = true},
		{col = 'manager_id', mdbx_type = 'u32', not_null = false},
	}, pk = {'id'}})
	db:add_index('users', {'manager_id'})
	for _, r in ipairs{
		{id = 1, manager_id = null},
		{id = 2, manager_id = 1},
		{id = 3, manager_id = 1},
	} do db:insert('users', '{}', r) end
	db:create_table('sessions', {fields = {
		{col = 'id'     , mdbx_type = 'u32' , not_null = true},
		{col = 'user_id', mdbx_type = 'u32' , not_null = true},
		{col = 'token'  , mdbx_type = 'utf8', not_null = true,
			maxlen = 8, nozero = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	db:add_index('sessions', {'token', is_unique = true})
	for _, r in ipairs{
		{id = 11, user_id = 1, token = 'aa'},
		{id = 12, user_id = 1, token = 'bb'},
		{id = 13, user_id = 2, token = 'cc'},
	} do db:insert('sessions', '{}', r) end
	db:create_table('messages', {fields = {
		{col = 'id'          , mdbx_type = 'u32', not_null = true},
		{col = 'from_user_id', mdbx_type = 'u32', not_null = true},
		{col = 'to_user_id'  , mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('messages', {'from_user_id'})
	db:add_index('messages', {'to_user_id'})
	for _, r in ipairs{
		{id = 101, from_user_id = 1, to_user_id = 2},
		{id = 102, from_user_id = 2, to_user_id = 1},
		{id = 103, from_user_id = 1, to_user_id = 3},
	} do db:insert('messages', '{}', r) end
	db:create_table('audit', {fields = {
		{col = 'id'      , mdbx_type = 'u32', not_null = true},
		{col = 'actor_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('audit', {'actor_id'})
	for _, r in ipairs{{id = 201, actor_id = 1}, {id = 202, actor_id = 3}} do
		db:insert('audit', '{}', r)
	end
	db:commit()
end

local function join_rows(scan, fmt)
	local t = {}
	for _, row in scan:rows'{}' do t[#t+1] = fmt(row) end
	scan.close()
	return cat(t, ',')
end

--to the referenced table: exact pk seek, at most one row.
function test.join_to_pk()
	with_db('join_to_pk', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local scan = db:scan('messages', {{'id', dir = 'asc'}}, 'm')
			:join'users@u.id = m.to_user_id'
			:select'm.id mid, u.id uid'
		local got = join_rows(scan, function(r) return r.mid..':'..r.uid end)
		assert(got == '101:2,102:1,103:3', got)
		db:commit()
	end)
end

--to an index: range scan, many rows per outer row.
function test.join_to_index()
	with_db('join_to_index', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local scan = db:scan('users', {{'id', dir = 'asc'}}, 'u')
			:join'sessions@s.user_id = u.id'
			:select'u.id uid, s.id sid'
		local got = join_rows(scan, function(r) return r.uid..':'..r.sid end)
		assert(got == '1:11,1:12,2:13', got)
		db:commit()
	end)
end

function test.left_join_to_index()
	with_db('left_join_to_index', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local scan = db:scan('users', {{'id', dir = 'asc'}}, 'u')
			:left_join'sessions@s.user_id = u.id'
			:select'u.id uid, s.id sid'
		local got = join_rows(scan,
			function(r) return r.uid..':'..tostring(r.sid) end)
		assert(got == '1:11,1:12,2:13,3:nil', got)
		db:commit()
	end)
end

--the same table joined twice, once per FK column; aliases keep the two
--added members apart.
function test.join_same_table_twice()
	with_db('join_same_table_twice', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local scan = db:scan('messages', {{'id', dir = 'asc'}}, 'm')
			:join'users@snd.id = m.from_user_id'
			:join'users@rcv.id = m.to_user_id'
			:select'm.id mid, snd.id from_id, rcv.id to_id'
		local got = join_rows(scan,
			function(r) return r.mid..':'..r.from_id..'>'..r.to_id end)
		assert(got == '101:1>2,102:2>1,103:1>3', got)
		db:commit()
	end)
end

--a table joined to itself: nothing special beyond a non-colliding alias.
function test.join_self_to_parent()
	with_db('join_self_to_parent', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local scan = db:scan('users', {{'id', dir = 'asc'}}, 'u')
			:join'users@mgr.id = u.manager_id'
			:select'u.id uid, mgr.id mid'
		local got = join_rows(scan, function(r) return r.uid..':'..r.mid end)
		--user 1 has no manager, so an inner join drops it.
		assert(got == '2:1,3:1', got)
		db:commit()
	end)
end

function test.join_self_to_children()
	with_db('join_self_to_children', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local scan = db:scan('users', {{'id', dir = 'asc'}}, 'u')
			:join'users@rep.manager_id = u.id'
			:select'u.id uid, rep.id rid'
		local got = join_rows(scan, function(r) return r.uid..':'..r.rid end)
		assert(got == '1:2,1:3', got)
		db:commit()
	end)
end

--no FK is declared between audit and users; the spec joins them anyway.
function test.join_without_fk()
	with_db('join_without_fk', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local scan = db:scan('users', {{'id', dir = 'asc'}}, 'u')
			:join'audit@a.actor_id = u.id'
			:select'u.id uid, a.id aid'
		local got = join_rows(scan, function(r) return r.uid..':'..r.aid end)
		assert(got == '1:201,3:202', got)
		db:commit()
	end)
end

--a unique index is a key like any other.
function test.join_to_unique_index()
	with_db('join_to_unique_index', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local scan = db:scan('sessions', {{'id', dir = 'asc'}}, 's')
			:join'sessions@s2.token = s.token'
			:select's.id sid, s2.id sid2'
		local got = join_rows(scan, function(r) return r.sid..':'..r.sid2 end)
		assert(got == '11:11,12:12,13:13', got)
		db:commit()
	end)
end

--an added member is joinable from in turn, so hops chain.
function test.join_chained()
	with_db('join_chained', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local scan = db:scan('messages', {{'id', dir = 'asc'}}, 'm')
			:join'users@u.id = m.from_user_id'
			:join'sessions@s.user_id = u.id'
			:select'm.id mid, u.id uid, s.id sid'
		local got = join_rows(scan,
			function(r) return r.mid..':'..r.uid..':'..r.sid end)
		assert(got == '101:1:11,101:1:12,102:2:13,103:1:11,103:1:12', got)
		db:commit()
	end)
end

--nested form: each level is its own iterator, so two branches off one
--outer row are consumed separately instead of as their product.
function test.join_scan_nested_branches()
	with_db('join_scan_nested_branches', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local users = db:scan('users', {{'id', dir = 'asc'}}, 'u')
		local sessions = users:join_scan'sessions@s.user_id = u.id'
		local sent = users:join_scan'messages@m.from_user_id = u.id'
		local get_uid = users:col_decoder('u', 'id')
		local get_sid = sessions:col_decoder('s', 'id')
		local get_mid = sent:col_decoder('m', 'id')
		local t = {}
		for _ in users:each() do
			for _ in sessions:each() do t[#t+1] = get_uid()..'s'..get_sid() end
			for _ in sent:each()     do t[#t+1] = get_uid()..'m'..get_mid() end
		end
		assert(cat(t, ',') == '1s11,1s12,1m101,1m103,2s13,2m102', cat(t, ','))
		sent.close()
		sessions.close()
		users.close()
		db:commit()
	end)
end

--every rejection names the spec and says which part of it is wrong.
function test.join_spec_errors()
	with_db('join_spec_errors', function(db)
		build_join_spec_fixture(db)
		db:begin'r'
		local u = db:scan('users', {{'id', dir = 'asc'}}, 'u')
		local function rejects(spec, msg)
			local ok, err = pcall(u.join, u, spec)
			assert(not ok, spec)
			err = tostring(err)
			assertf(err:find(msg, 1, true), '%s -> %s', spec, err)
			--the spec itself is in every message, to point at the call.
			assertf(err:find(spec, 1, true), '%s -> %s', spec, err)
		end
		rejects('sessions.user_id'                , 'invalid spec')
		rejects('nosuch@s.user_id = u.id'         , 'no table: nosuch')
		rejects('sessions@s.user_id = nobody.id'  , 'no member: nobody')
		rejects('sessions@s.nope = u.id'          , 'no col: sessions.nope')
		rejects('sessions@s.user_id = u.nope'     , 'no col: u.nope')
		rejects('sessions@s.user_id = u.id,id'    , 'invalid')
		rejects('audit@a.id,actor_id = u.id,id'   , 'no key on audit')
		--alias collides with a member already in the scan.
		assert(not pcall(u.join, u, 'sessions@u.user_id = u.id'))
		u.close()
		db:commit()
	end)
end

--tags(user_id, kind, id) has a composite index; joining on user_id alone
--seeks its prefix, so a shorter key does not have to exist.
local function build_prefix_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	for _, r in ipairs{{id = 1}, {id = 2}, {id = 3}} do
		db:insert('users', '{}', r)
	end
	db:create_table('tags', {fields = {
		{col = 'id'     , mdbx_type = 'u32' , not_null = true},
		{col = 'user_id', mdbx_type = 'u32' , not_null = true},
		{col = 'kind'   , mdbx_type = 'utf8', not_null = true,
			maxlen = 4, nozero = true},
	}, pk = {'id'}})
	db:add_index('tags', {'user_id', 'kind'})
	for _, r in ipairs{
		{id = 31, user_id = 1, kind = 'aa'},
		{id = 32, user_id = 1, kind = 'bb'},
		{id = 33, user_id = 2, kind = 'aa'},
	} do db:insert('tags', '{}', r) end
	db:commit()
end

function test.join_key_prefix()
	with_db('join_key_prefix', function(db)
		build_prefix_fixture(db)
		db:begin'r'
		local scan = db:scan('users', {{'id', dir = 'asc'}}, 'u')
			:join'tags@t.user_id = u.id'
			:select'u.id uid, t.id tid'
		local got = join_rows(scan, function(r) return r.uid..':'..r.tid end)
		assert(got == '1:31,1:32,2:33', got)
		db:commit()
	end)
end

--both cols of the same index: an exact key, one seek per outer row.
function test.join_key_whole_composite()
	with_db('join_key_whole_composite', function(db)
		build_prefix_fixture(db)
		db:begin'r'
		local scan = db:scan('tags', {{'id', dir = 'asc'}}, 't')
			:join'tags@t2.user_id,kind = t.user_id,kind'
			:select't.id tid, t2.id tid2'
		local got = join_rows(scan, function(r) return r.tid..':'..r.tid2 end)
		assert(got == '31:31,32:32,33:33', got)
		db:commit()
	end)
end

--with both tags/user_id and tags/user_id,kind present, the shorter key
--wins; naming the longer index picks it instead.
function test.join_key_shortest_wins()
	with_db('join_key_shortest_wins', function(db)
		build_prefix_fixture(db)
		db:begin'w'
		db:add_index('tags', {'user_id'})
		db:commit()
		db:begin'r'
		local u = db:scan('users', {{'id', dir = 'asc'}}, 'u')
		local chosen = u:join_scan'tags@t.user_id = u.id'
		assert(chosen.explain().key == 'tags/user_id',
			chosen.explain().key)
		local named = u:join_scan'tags/user_id,kind@t2.user_id = u.id'
		assert(named.explain().key == 'tags/user_id,kind',
			named.explain().key)
		named.close()
		chosen.close()
		u.close()
		db:commit()
	end)
end

--a named index still has to start with the join cols.
function test.join_named_index_errors()
	with_db('join_named_index_errors', function(db)
		build_prefix_fixture(db)
		db:begin'r'
		local u = db:scan('users', {{'id', dir = 'asc'}}, 'u')
		--tags/user_id,kind starts with user_id, not with kind.
		local ok, err = pcall(u.join, u, 'tags/user_id,kind@t.kind = u.id')
		assert(not ok)
		assertf(tostring(err):find('does not start with kind', 1, true),
			tostring(err))
		--no such index.
		assert(not pcall(u.join, u, 'tags/nope@t.user_id = u.id'))
		u.close()
		db:commit()
	end)
end

--an index name in TABLE position still names the member after the base
--table, so its columns are read the same way.
function test.join_named_index_member()
	with_db('join_named_index_member', function(db)
		build_prefix_fixture(db)
		db:begin'r'
		local scan = db:scan('users', {{'id', dir = 'asc'}}, 'u')
			:join'tags/user_id,kind.user_id = u.id'
			:select'u.id uid, tags.id tid, tags.kind kind'
		local got = join_rows(scan,
			function(r) return r.uid..':'..r.tid..r.kind end)
		assert(got == '1:31aa,1:32bb,2:33aa', got)
		db:commit()
	end)
end

function test.scan_spec_strings()
	with_db('scan_spec_strings', function(db)
		add_scan_data(db)
		db:begin'r'

		local full = db:scan('scan_rows', 'tenant_id, id')
		local get_tenant = scan_col_decoder(db, full, 'tenant_id')
		local get_id = scan_col_decoder(db, full, 'id')
		full.reset()
		assert(scan_values(full, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1,2:2')

		local exact = db:scan('scan_rows', 'tenant_id = ?, id = ?')
		get_id = scan_col_decoder(db, exact, 'id')
		exact.reset{1, 2}
		assert(scan_values(exact, get_id) == '2')

		local named = db:scan('scan_rows',
			'tenant_id = :T, id = :ID')
		get_id = scan_col_decoder(db, named, 'id')
		named.reset{T = 1, ID = 3}
		assert(scan_values(named, get_id) == '3')

		local range = db:scan('scan_rows',
			'tenant_id = ?, id >= ? <= ? desc')
		get_id = scan_col_decoder(db, range, 'id')
		range.reset{1, 1, 3}
		assert(scan_values(range, get_id) == '3,2,1')

		local lo_only = db:scan('scan_rows', 'tenant_id = ?, id >= ?')
		get_id = scan_col_decoder(db, lo_only, 'id')
		lo_only.reset{1, 2}
		assert(scan_values(lo_only, get_id) == '2,3')

		local prefix = db:scan('scan_files/status',
			'status = ?, tenant_id = ?, path starts ? desc')
		local get_path = scan_col_decoder(db, prefix, 'path')
		prefix.reset{'ready', 1, 'a/'}
		assert(scan_values(prefix, get_path) == 'a/2,a/1')

		local nn = db:scan('scan_rows/score', 'score is_not_null')
		local get_score = scan_col_decoder(db, nn, 'score')
		nn.reset()
		assert(scan_values(nn, get_score) == '10,20,30')

		local is_null = db:scan('scan_rows/score', 'score is :S')
		get_id = scan_col_decoder(db, is_null, 'id')
		is_null.reset{S = null}
		assert(scan_values(is_null, get_id) == '1,2')

		for _, scan in ipairs{full, exact, named, range, lo_only, prefix,
			nn, is_null}
		do
			scan.close()
		end
		db:commit()
	end)
end

function test.scan_spec_errors()
	with_db('scan_spec_errors', function(db)
		add_scan_data(db)
		db:begin'r'
		local function rejects(spec)
			assert(not pcall(db.scan, db, 'scan_rows', spec), spec)
		end
		rejects'tenant_id = '
		rejects'tenant_id = 5'
		rejects'tenant_id = ?, id = ? junk'
		rejects'tenant_id = ? >= ?'
		rejects'nope = ?'
		db:commit()
	end)
end

function test.explain_composites()
	with_db('explain_composites', function(db)
		build_join_spec_fixture(db)
		db:begin'r'

		local leaf = db:scan('users', 'id asc', 'u')
		local e = leaf.explain()
		assert(e.kind == nil and e.table == 'users' and e.key == 'users')

		local join = leaf:join'sessions@s.user_id = u.id'
		e = join.explain()
		assert(e.kind == 'join')
		assert(e[1].key == 'users')
		assert(e[2].key == 'sessions/user_id')

		local left = db:scan('users', 'id asc', 'u')
			:left_join'sessions@s.user_id = u.id'
		assert(left.explain().kind == 'left_join')

		local a = db:scan('users', 'id = ?', 'a')
		local b = db:scan('users', 'id = ?', 'b')
		e = a:union(b).explain()
		assert(e.kind == 'union' and e[1].key == 'users' and #e == 2)

		local c = db:scan('users', 'id = ?')
		local d = db:scan('users', 'id = ?')
		assert(c:merge_union(d).explain().kind == 'merge_union')

		local deep = db:scan('messages', 'id asc', 'm')
			:join'users@u.id = m.from_user_id'
			:join'sessions@s.user_id = u.id'
		e = deep.explain()
		assert(e.kind == 'join' and e[1].kind == 'join')
		assert(e[1][1].key == 'messages')
		assert(e[1][2].key == 'users')
		assert(e[2].key == 'sessions/user_id')

		join.close()
		left.close()
		deep.close()
		db:commit()
	end)
end

function test.values_scan_in()
	with_db('values_scan_in', function(db)
		build_join_spec_fixture(db)
		db:begin'r'

		local function ids_for(vals, arg_list)
			local drv = db:values_scan(vals)
			local rows = db:scan('sessions/user_id',
				{{'user_id', '=', {get = drv.get}}, {'id', dir = 'asc'}})
			local scan = db:join_scans(drv, rows)
			local get_id = rows:col_decoder('sessions', 'id')
			local t = {}
			scan.reset(arg_list)
			while scan.advance() do t[#t+1] = get_id() end
			scan.close()
			return cat(t, ',')
		end

		assert(ids_for{1} == '11,12')
		assert(ids_for{2} == '13')
		assert(ids_for{1, 2} == '11,12,13')
		assert(ids_for{3} == '')
		assert(ids_for{1, 3, 2} == '11,12,13')
		assert(ids_for({arg = 'IDS'}, {IDS = {2, 1}}) == '13,11,12')
		assert(ids_for({arg = 'IDS'}, {IDS = {}}) == '')

		db:commit()
	end)
end

function test.values_scan_reusable()
	with_db('values_scan_reusable', function(db)
		build_join_spec_fixture(db)
		db:begin'r'

		local drv = db:values_scan{arg = 'IDS'}
		local rows = db:scan('sessions/user_id',
			{{'user_id', '=', {get = drv.get}}, {'id', dir = 'asc'}})
		local scan = db:join_scans(drv, rows)
		local get_id = rows:col_decoder('sessions', 'id')
		local function run(ids)
			local t = {}
			scan.reset{IDS = ids}
			while scan.advance() do t[#t+1] = get_id() end
			return cat(t, ',')
		end
		assert(run{1} == '11,12')
		assert(run{1, 2} == '11,12,13')
		assert(run{2} == '13')
		assert(not pcall(scan.reset, {}))
		scan.close()
		db:commit()
	end)
end

function test.scan_merge_union_orders_by_key()
	with_db('scan_merge_union_orders_by_key', function(db)
		add_scan_data(db)
		db:begin'r'
		local ready = db:scan('scan_rows/status', 'status = :S')
		local done = db:scan('scan_rows/status', 'status = :D')
		local merged = ready:merge_union(done)
		merged.reset{S = 'ready', D = 'done'}
		assert(scan_values(merged, function()
			return scan_col_decoder(db, merged, 'status')()..'/'
				..scan_col_decoder(db, merged, 'tenant_id')()..':'
				..scan_col_decoder(db, merged, 'id')()
		end) == 'done/2:2,ready/1:1,ready/1:2,ready/1:3,ready/2:1')
		merged.close()
		db:commit()
	end)
end

local function build_ci_fixture(db)
	db:begin'w'
	db:create_table('people', {fields = {
		{col = 'id'  , mdbx_type = 'u32' , not_null = true},
		{col = 'name', mdbx_type = 'utf8', not_null = true, maxlen = 16,
			nozero = true, mdbx_collation = 'utf8_ai_ci'},
		{col = 'age' , mdbx_type = 'u32' , not_null = true},
	}, pk = {'id'}})
	db:add_index('people', {'name'})
	for _, r in ipairs{
		{id = 1, name = 'Jose'  , age = 30},
		{id = 2, name = 'JOSÉ'  , age = 40},
		{id = 3, name = 'Ana'   , age = 50},
	} do db:insert('people', '{}', r) end
	db:commit()
end

function test.filter_cols_form()
	with_db('filter_cols_form', function(db)
		build_ci_fixture(db)
		db:begin'r'
		local scan = db:scan('people', 'id asc')
			:filter('people.age, people.id n', function(r)
				return r.age >= 40 and r.n ~= 3
			end)
			:select'people.id id'
		local t = {}
		for _, row in scan:rows'{}' do t[#t+1] = row.id end
		assert(cat(t, ',') == '2', cat(t, ','))
		scan.close()
		db:commit()
	end)
end

function test.filter_fn_only_form()
	with_db('filter_fn_only_form', function(db)
		build_ci_fixture(db)
		db:begin'r'
		local scan = db:scan('people', 'id asc')
		local get_age = scan:col_decoder('people', 'age')
		scan:filter(function() return get_age() > 35 end)
		scan:select'people.id id'
		local t = {}
		for _, row in scan:rows'{}' do t[#t+1] = row.id end
		assert(cat(t, ',') == '2,3', cat(t, ','))
		scan.close()
		db:commit()
	end)
end

--a filter sees the comparison form, so an ai_ci col matches whatever
--db:collate() makes of the literal, from either the base table or the index.
function test.filter_ai_ci()
	with_db('filter_ai_ci', function(db)
		build_ci_fixture(db)
		db:begin'r'
		local want = db:collate('people', 'name', 'josÉ')
		assert(want == 'jose', want)

		local base = db:scan('people', 'id asc')
			:filter('people.name', function(r) return r.name == want end)
			:select'people.id id'
		local t = {}
		for _, row in base:rows'{}' do t[#t+1] = row.id end
		assert(cat(t, ',') == '1,2', cat(t, ','))
		base.close()

		local ix = db:scan('people/name', 'name')
			:filter('people.name', function(r) return r.name == want end)
			:select'people.id id'
		t = {}
		for _, row in ix:rows'{}' do t[#t+1] = row.id end
		assert(cat(t, ',') == '1,2', cat(t, ','))
		ix.close()

		--rows() keeps the display form.
		local disp = db:scan('people', 'id asc'):select'people.name name'
		t = {}
		for _, row in disp:rows'{}' do t[#t+1] = row.name end
		assert(cat(t, ',') == 'Jose,JOSÉ,Ana', cat(t, ','))
		disp.close()

		--a non-ai_ci col passes through db:collate() untouched.
		assert(db:collate('people', 'age', 40) == 40)
		db:commit()
	end)
end

function test.not_in_collates()
	with_db('not_in_collates', function(db)
		build_ci_fixture(db)
		db:begin'r'
		local function ids(scan)
			local t = {}
			for _, row in scan:rows'{}' do t[#t+1] = row.id end
			scan.close()
			return cat(t, ',')
		end

		--one literal spelling excludes every spelling that folds to it.
		assert(ids(db:scan('people', 'id asc')
			:not_in('name', {'josé'})
			:select'people.id id') == '3')

		--same answer off the index, where the col is already folded.
		assert(ids(db:scan('people/name', 'name')
			:not_in('name', {'josé'})
			:select'people.id id') == '3')

		--a non-ai_ci col is compared as-is.
		assert(ids(db:scan('people', 'id asc')
			:not_in('age', {30, 50})
			:select'people.id id') == '2')

		--a qualified col names its member on a join.
		local scan = db:scan('people', 'id asc', 'p')
			:join'people@q.id = p.id'
			:not_in('q.age', {30})
			:select'p.id id'
		assert(ids(scan) == '2,3')

		local one = db:scan('people', 'id asc')
		assert(not pcall(one.not_in, one, 'age, id', {1}))
		one.close()
		db:commit()
	end)
end

--nulls and false bools ------------------------------------------------------

--ok is null on 3 and 5 and false on 1 and 4; flag is a false pk col on
--1, 3 and 5. every col is reachable both from the index and from the
--base table.
local function add_bool_data(db)
	db:begin'w'
	db:create_table('bool_rows', {fields = {
		{col = 'flag', mdbx_type = 'bool', not_null = true},
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'ok', mdbx_type = 'bool'},
	}, pk = {'flag', 'id'}})
	db:add_index('bool_rows', {'ok'})
	for _, row in ipairs{
		{flag = false, id = 1, ok = false},
		{flag = true , id = 2, ok = true },
		{flag = false, id = 3},
		{flag = true , id = 4, ok = false},
		{flag = false, id = 5},
	} do
		db:insert('bool_rows', '{}', row)
	end
	db:commit()
end

--a bool col holding false reads back as false, not as an empty col: one
--case per record a col can be read from (index key, base key, base val).
function test.scan_reads_false_bool()
	with_db('scan_reads_false_bool', function(db)
		add_bool_data(db)
		db:begin'r'

		local function reads(tbl, path, col)
			local scan = db:scan(tbl, path)
			local get = scan:col_decoder('bool_rows', col)
			scan.reset()
			local t = {}
			while scan.advance() do t[#t+1] = tostring(get()) end
			scan.close()
			return cat(t, ',')
		end

		--ok is the index key.
		local ix_key = reads('bool_rows/ok', 'ok asc', 'ok')
		assert(ix_key == 'nil,nil,false,false,true', ix_key)
		--flag is a pk col, read from the index's val rec.
		local base_key = reads('bool_rows/ok', 'ok asc', 'flag')
		assert(base_key == 'false,false,false,true,true', base_key)
		--ok is a base-table val col.
		local base_val = reads('bool_rows', 'flag asc', 'ok')
		assert(base_val == 'false,nil,nil,true,false', base_val)

		db:commit()
	end)
end

--the same three reads through db:col_decoder(), the schema-level getter.
function test.schema_col_decoder_reads_false_bool()
	with_db('schema_col_decoder_reads_false_bool', function(db)
		add_bool_data(db)
		db:begin'r'

		local function reads(tbl, path, col)
			local scan = db:scan(tbl, path)
			local get = scan_col_decoder(db, scan, col)
			scan.reset()
			local t = {}
			while scan.advance() do t[#t+1] = tostring(get()) end
			scan.close()
			return cat(t, ',')
		end

		local ix_key = reads('bool_rows/ok', 'ok asc', 'ok')
		assert(ix_key == 'nil,nil,false,false,true', ix_key)
		local base_key = reads('bool_rows/ok', 'ok asc', 'flag')
		assert(base_key == 'false,false,false,true,true', base_key)
		local base_val = reads('bool_rows', 'flag asc', 'ok')
		assert(base_val == 'false,nil,nil,true,false', base_val)

		db:commit()
	end)
end

--an unreached inner col yields exactly one value (nil), not zero values:
--a getter's result has to survive being passed on as an argument.
function test.unmatched_inner_getter_arity()
	with_db('unmatched_inner_getter_arity', function(db)
		build_join_spec_fixture(db)
		db:begin'r'

		local scan = db:scan('users', 'id asc', 'u')
			:left_join'sessions@s.user_id = u.id'
		local get_sid = scan:col_decoder('s', 'id')
		local t = {}
		scan.reset()
		while scan.advance() do t[#t+1] = tostring(get_sid()) end
		scan.close()
		assert(cat(t, ',') == '11,12,13,nil', cat(t, ','))

		local parent = db:scan('users', 'id asc', 'u')
		local child = parent:join_scan'sessions@s.user_id = u.id'
		local get_child_sid = child:col_decoder('s', 'id')
		t = {}
		parent.reset()
		while parent.advance() do
			child.reset()
			child.advance()
			t[#t+1] = tostring(get_child_sid())
		end
		child.close()
		parent.close()
		assert(cat(t, ',') == '11,13,nil', cat(t, ','))

		db:commit()
	end)
end

--a group key reads back the way select() reads the same col: an empty
--col is nil, a false bool is false. hashed grouping must not merge them.
function test.scan_group_keys_null_and_false()
	with_db('scan_group_keys_null_and_false', function(db)
		add_bool_data(db)
		db:begin'r'

		local cols = {{member = 'bool_rows', col = 'ok'}}
		local function counts(hash)
			local scan = db:scan('bool_rows/ok', 'ok asc')
			if not hash then scan:group_by(cols) end
			scan:aggregate({
				{name = 'ok', op = 'key', part = 1},
				{name = 'cnt', op = 'count'},
			}, cols, hash)
			local t = {}
			for _, ok, cnt in scan:rows() do
				t[#t+1] = tostring(ok)..':'..cnt
			end
			sort(t)
			return cat(t, ' ')
		end
		local streamed, hashed = counts(false), counts(true)
		assert(streamed == 'false:2 nil:2 true:1', streamed)
		assert(hashed   == 'false:2 nil:2 true:1', hashed)

		local sel = db:scan('bool_rows/ok', 'ok asc')
		sel:select{{name = 'ok', member = 'bool_rows', col = 'ok'}}
		local t = {}
		for _, ok in sel:rows() do t[#t+1] = tostring(ok) end
		assert(cat(t, ',') == 'nil,nil,false,false,true', cat(t, ','))

		db:commit()
	end)
end

function test.scan_distinct_null_and_false()
	with_db('scan_distinct_null_and_false', function(db)
		add_bool_data(db)
		db:begin'r'

		local scan = db:scan('bool_rows', 'flag asc')
		scan:select{{name = 'ok', member = 'bool_rows', col = 'ok'}}
		scan:distinct({{name = 'ok', member = 'bool_rows', col = 'ok'}}, true)
		local t = {}
		for _, ok in scan:rows() do t[#t+1] = tostring(ok) end
		sort(t)
		assert(cat(t, ',') == 'false,nil,true', cat(t, ','))

		db:commit()
	end)
end

--'is' means the col may be null, so a nil arg asks for the null rows.
--every other op still refuses a nil arg, so a misspelled arg name is
--reported instead of silently matching nothing.
function test.scan_is_nil_arg()
	with_db('scan_is_nil_arg', function(db)
		add_bool_data(db)
		db:begin'r'

		local function ids(spec, args)
			local scan = db:scan('bool_rows/ok', spec)
			local get = scan:col_decoder('bool_rows', 'id')
			scan.reset(args)
			local t = {}
			while scan.advance() do t[#t+1] = get() end
			scan.close()
			return cat(t, ',')
		end

		assert(ids('ok is ?', {}) == '3,5')
		assert(ids('ok is ?') == '3,5')
		assert(ids('ok is ?', {null}) == '3,5')
		assert(ids('ok is ?', {false}) == '1,4')

		local ok, err = pcall(ids, 'ok = ?', {})
		assert(not ok and tostring(err):find'missing arg', tostring(err))

		db:commit()
	end)
end

--sort() over aggregate() output: the null group's key is nil like any
--other empty col, and sorts first ascending.
function test.scan_sort_null_group_key()
	with_db('scan_sort_null_group_key', function(db)
		db:begin'w'
		db:create_table('grp', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'g', mdbx_type = 'i32'},
		}, pk = {'id'}})
		local _, _, g_asc = db:add_index('grp', {'g'})
		for _, r in ipairs{
			{id = 1, g = 2}, {id = 2}, {id = 3, g = 1}, {id = 4},
		} do db:insert('grp', '{}', r) end
		db:commit()
		db:begin'r'

		local cols = {{member = 'grp', col = 'g'}}
		local scan = db:scan(g_asc, 'g asc')
		scan:group_by(cols)
		scan:aggregate({
			{name = 'g', op = 'key', part = 1},
			{name = 'cnt', op = 'count'},
		}, cols)
		scan:sort{{field = 'g'}}

		local t = {}
		for _, g, cnt in scan:rows() do
			t[#t+1] = tostring(g)..':'..cnt
		end
		assert(cat(t, ' ') == 'nil:2 1:1 2:1', cat(t, ' '))

		db:commit()
	end)
end

--OUTPUT-STAGE CURRENT ROW ----------------------------------------------------

local function add_people(db)
	db:begin'w'
	db:create_table('people', {fields = {
		{col = 'id'  , mdbx_type = 'u32', not_null = true},
		{col = 'team', mdbx_type = 'utf8', maxlen = 16, not_null = true},
		{col = 'name', mdbx_type = 'utf8', maxlen = 32, not_null = true,
			mdbx_collation = 'utf8_ai_ci'},
	}, pk = {'id'}})
	for _, r in ipairs{
		{id = 1, team = 'a', name = 'Zoe' },
		{id = 2, team = 'a', name = 'ange'},
		{id = 3, team = 'a', name = 'Ange'},
		{id = 4, team = 'b', name = 'bob' },
	} do db:insert('people', '{}', r) end
	db:commit()
end

local function people_select(db)
	local scan = db:scan('people', 'id asc')
	scan:select{
		{name = 'id'  , member = 'people', col = 'id'  },
		{name = 'name', member = 'people', col = 'name'},
	}
	return scan
end

--a stage that redefines advance() owns the current row, so found() must
--follow it: the cursor underneath is exhausted while sort()/distinct()/
--aggregate() are still serving what they kept.
function test.output_stage_found()
	with_db('output_stage_found', function(db)
		add_people(db)
		db:begin'r'

		local function count_found(scan)
			scan.reset()
			assert(not scan.found())
			local n = 0
			while scan.advance() do
				assert(scan.found(), 'found() must hold on a served row')
				n = n + 1
			end
			assert(not scan.found())
			scan.close()
			return n
		end

		assert(count_found(people_select(db):sort{{col = 'id'}}) == 4)
		assert(count_found(people_select(db)
			:distinct({{name = 'name'}}, true)) == 3)

		local agg = db:scan('people', 'id asc')
		agg:aggregate{{name = 'n', op = 'count'}}
		assert(count_found(agg) == 1)

		db:commit()
	end)
end

--MEMBER SCAN -----------------------------------------------------------------

--both member scans rename an output scan's cols under one alias.
--streamed_scan() re-runs the child on every reset(); materialized_scan()
--keeps the child's rows until close() and rewinds them, for an inner
--side that an outer row loop re-reads.
function test.streamed_scan_rereads_child()
	with_db('streamed_scan_rereads_child', function(db)
		add_people(db)
		db:begin'r'

		local m = people_select(db):streamed_scan'u'
		local get = m:col_decoder('u', 'name')
		local t = {}
		for _ = 1, 2 do --a second run re-reads the child
			m.reset()
			while m.advance() do t[#t+1] = get() end
		end
		m.close()
		assert(cat(t, ',') == 'Zoe,ange,Ange,bob,Zoe,ange,Ange,bob', cat(t, ','))

		db:commit()
	end)
end

function test.materialized_scan_rewinds_rows()
	with_db('materialized_scan_rewinds_rows', function(db)
		add_people(db)
		db:begin'r'

		local m = people_select(db):materialized_scan'u'
		local get = m:col_decoder('u', 'name')
		local folded = m:col_decoder('u', 'name', true)
		local t, f = {}, {}
		for _ = 1, 2 do --a second reset() rewinds the kept rows
			m.reset()
			while m.advance() do t[#t+1] = get(); f[#f+1] = folded() end
		end
		m.close()
		assert(cat(t, ',') == 'Zoe,ange,Ange,bob,Zoe,ange,Ange,bob', cat(t, ','))
		assert(cat(f, ',') == 'zoe,ange,ange,bob,zoe,ange,ange,bob', cat(f, ','))

		db:commit()
	end)
end

--col_decoder() answers for the alias only: the inner query's own member
--names are not reachable from outside.
function test.member_scan_unknown_member()
	with_db('member_scan_unknown_member', function(db)
		add_people(db)
		db:begin'r'

		local m = people_select(db):streamed_scan'u'
		local ok, err = pcall(function()
			return m:col_decoder('people', 'name')
		end)
		assert(not ok)
		assert(tostring(err):find('unknown member', 1, true), err)

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
