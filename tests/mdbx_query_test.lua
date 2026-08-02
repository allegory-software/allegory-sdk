require'mdbx_query'

local q = mdbx_query
local compile_step = mdbx_compile_step

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function test_file(name)
	return '/tmp/sdk_mdbx_query_test_'..name..'_'..uuid()..'.mdb'
end

local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
end

local function collect_ids(node, name, args)
	local get_id = node:col_decoder(name, 'id')
	node.reset(args)
	local t = {}
	while node.advance() do
		t[#t+1] = get_id()
	end
	node.close()
	return t
end

--fixture: users <- sessions (FK), no joins beyond one level -- matches
--compile_step()'s current scope (single base step + at most one join).
local function build_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id'    , mdbx_type = 'u32', not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16, nozero = true},
		{col = 'score' , mdbx_type = 'i32'},
	}, pk = {'id'}})
	db:add_index('users', {'status'})
	db:add_index('users', {'score'})
	local users = {
		{id = 1, status = 'active', score = 80},
		{id = 2, status = 'active', score = 95},
		{id = 3, status = 'banned', score = 50},
		{id = 4, status = 'active', score = 70},
		{id = 5, status = 'banned', score = 60},
	}
	for _, r in ipairs(users) do db:insert('users', '{}', r) end

	db:create_table('sessions', {fields = {
		{col = 'id'     , mdbx_type = 'u32', not_null = true},
		{col = 'user_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	db:add_fk{table = 'sessions', cols = {'user_id'},
		ref_table = 'users', ref_cols = {'id'}}
	local sessions = {
		{id = 11, user_id = 1},
		{id = 12, user_id = 1},
		{id = 13, user_id = 1},
		{id = 14, user_id = 2},
		{id = 15, user_id = 4},
	}
	for _, r in ipairs(sessions) do db:insert('sessions', '{}', r) end
	db:commit()
end

local function with_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--fixture: users <- sessions <- events <- tags (FK chain). sessions
--12/13 and 15 have no events; event 22 and 23 have no tags -- exercises
--a left-joined group with two joins inside it (sessions JOIN events
--JOIN tags) attached to users, and null-propagation through all three
--levels (event 23's own missing tags drops session 14 and event 23
--too, nulling the whole group for user 2).
local function build_group_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	local users = {{id = 1}, {id = 2}, {id = 3}, {id = 4}, {id = 5}}
	for _, r in ipairs(users) do db:insert('users', '{}', r) end

	db:create_table('sessions', {fields = {
		{col = 'id'     , mdbx_type = 'u32', not_null = true},
		{col = 'user_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	db:add_fk{table = 'sessions', cols = {'user_id'},
		ref_table = 'users', ref_cols = {'id'}}
	local sessions = {
		{id = 11, user_id = 1},
		{id = 12, user_id = 1},
		{id = 13, user_id = 1},
		{id = 14, user_id = 2},
		{id = 15, user_id = 4},
	}
	for _, r in ipairs(sessions) do db:insert('sessions', '{}', r) end

	db:create_table('events', {fields = {
		{col = 'id'        , mdbx_type = 'u32', not_null = true},
		{col = 'session_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('events', {'session_id'})
	db:add_fk{table = 'events', cols = {'session_id'},
		ref_table = 'sessions', ref_cols = {'id'}}
	local events = {
		{id = 21, session_id = 11},
		{id = 22, session_id = 11},
		{id = 23, session_id = 14},
	}
	for _, r in ipairs(events) do db:insert('events', '{}', r) end

	db:create_table('tags', {fields = {
		{col = 'id'      , mdbx_type = 'u32', not_null = true},
		{col = 'event_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('tags', {'event_id'})
	db:add_fk{table = 'tags', cols = {'event_id'},
		ref_table = 'events', ref_cols = {'id'}}
	local tags = {
		{id = 31, event_id = 21},
		{id = 32, event_id = 21},
	}
	for _, r in ipairs(tags) do db:insert('tags', '{}', r) end
	db:commit()
end

local function with_group_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_group_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

------------------------------------------------------------------------------
--compile_step() builds a real scan/join_scans chain from a query
--compiled through mdbx_query.lua's actual builder + compile() pipeline,
--not a hand-built plan.

--'=' on the table's own pk column: compiles to an 'exact' plan on the
--base table, bound value read through q.param().
function test.exact_via_param_exec()
	with_db('exact_via_param_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.id'), q.param('ID')})
				:select'users.id id'
				:prepare()
			local params = {}
			local node = compile_step(db, rel)
			params.ID = 3
			local ids = collect_ids(node, 'users', params)
			assert(cat(ids, ',') == '3', cat(ids, ','))
			--same node, same shared params table, different value: the
			--getter must read the table's current contents, not a
			--snapshot taken when the node was built.
			params.ID = 1
			ids = collect_ids(node, 'users', params)
			assert(cat(ids, ',') == '1', cat(ids, ','))
			--missing id -> no rows.
			params.ID = 999
			ids = collect_ids(node, 'users', params)
			local ok, err = pcall(function() node.reset{} end)
			assert(not ok and tostring(err):find'missing arg: ID', err)
			node.close()
			assert(#ids == 0, cat(ids, ','))
		end)
	end)
end

--q.between() on an indexed, non-pk column: compiles to a 'range' plan
--on the score index, both bounds read through q.param().
function test.range_via_param_exec()
	with_db('range_via_param_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where(q.between(q.col('users.score'),
					q.param('LO'), q.param('HI')))
				:select'users.id id'
				:prepare()
			local params = {LO = 70, HI = 95}
			local node = compile_step(db, rel)
			local ids = collect_ids(node, 'users', params)
			assert(cat(ids, ',') == '4,1,2', cat(ids, ','))
		end)
	end)
end

function test.not_equal_index_ranges_exec()
	with_db('not_equal_index_ranges_exec', function(db)
		db:begin'w'
		db:insert('users', '{}', {id = 6, status = null, score = null})
		db:insert('users', '{}', {id = 7, status = 'closed', score = 10})
		db:commit()
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'~=', q.col('users.status'), 'banned'})
				:select'users.id id'
				:prepare()
			local plan = rel.access[1].plan
			local node = compile_step(db, rel)
			local ids = collect_ids(node, 'users')
			table.sort(ids)
			assert(cat(ids, ',') == '1,2,4,7', cat(ids, ','))
			assert(plan.schema.name == 'users/status' and #plan.residual == 0)
		end)
	end)
end

--choose_access() uses duplicate PK suffix equality, range, prefix, and
--reverse order after it fixes an index key.
function test.index_pk_suffix_exec()
	with_db('index_pk_suffix_exec', function(db)
		db:begin'w'
		db:create_table('files', {fields = {
			{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
			{col = 'path', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
			{col = 'status', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
		}, pk = {'tenant_id', 'path'}})
		db:add_index('files', {'status'})
		for _, row in ipairs{
			{tenant_id = 1, path = 'a/1', status = 'ready'},
			{tenant_id = 1, path = 'a/2', status = 'ready'},
			{tenant_id = 1, path = 'b/1', status = 'ready'},
			{tenant_id = 2, path = 'a/3', status = 'ready'},
			{tenant_id = 1, path = 'z/1', status = 'done'},
		} do
			db:insert('files', '{}', row)
		end
		db:commit()

		db:atomic('r', function()
			local rel = db:from('files')
				:where({'=', q.col('files.status'), 'ready'})
				:where({'=', q.col('files.tenant_id'), 1})
				:where({'=', q.col('files.path'), 'a/2'})
				:select'files.path path'
				:prepare()
			local plan = rel.access[1].plan
			assert(plan.schema.name == 'files/status' and plan.kind == 'exact'
				and plan.depth == 3 and #plan.residual == 0)
			assert(rel:must_one() == 'a/2')

			rel = db:from('files')
				:where({'=', q.col('files.status'), 'ready'})
				:where({'=', q.col('files.tenant_id'), 1})
				:where(q.between(q.col('files.path'), 'a/2', 'b/1'))
				:select'files.path path'
				:prepare()
			plan = rel.access[1].plan
			assert(plan.schema.name == 'files/status' and plan.kind == 'range'
				and plan.depth == 2 and plan.bound_col == 'path'
				and #plan.residual == 0)
			local paths = {}
			for _, path in rel:rows() do paths[#paths + 1] = path end
			assert(cat(paths, ',') == 'a/2,b/1', cat(paths, ','))

			rel = db:from('files')
				:where({'=', q.col('files.status'), 'ready'})
				:where({'=', q.col('files.tenant_id'), 1})
				:where({'starts', q.col('files.path'), 'a/'})
				:select'files.path path'
				:prepare()
			plan = rel.access[1].plan
			assert(plan.schema.name == 'files/status' and plan.kind == 'prefix'
				and plan.depth == 2 and plan.bound_col == 'path'
				and #plan.residual == 0)
			paths = {}
			for _, path in rel:rows() do paths[#paths + 1] = path end
			assert(cat(paths, ',') == 'a/1,a/2', cat(paths, ','))

			rel = db:from('files')
				:where({'=', q.col('files.status'), 'ready'})
				:select'files.tenant_id tenant_id, files.path path'
				:order_by('files.status, files.tenant_id desc, files.path desc')
				:prepare()
			plan = rel.access[1].plan
			assert(plan.schema.name == 'files/status' and plan.kind == 'exact'
				and plan.depth == 1 and plan.dir == 'desc'
				and #plan.residual == 0 and not rel.sort_needed)
			local rows = rel:rows_array'[]'
			local values = {}
			for _, row in ipairs(rows) do
				values[#values + 1] = row[1]..':'..row[2]
			end
			assert(cat(values, ',') == '2:a/3,1:b/1,1:a/2,1:a/1',
				cat(values, ','))
		end)
	end)
end

--'=' against a bare literal (no q.param() at all): compiles to an
--'exact' plan on the status index, bound value is a plain constant
--getter.
function test.exact_literal_exec()
	with_db('exact_literal_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.status'), 'active'})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local ids = collect_ids(node, 'users')
			assert(cat(ids, ',') == '1,2,4', cat(ids, ','))
		end)
	end)
end

function test.indexed_null_comparison_exec()
	with_db('indexed_null_comparison_exec', function(db)
		db:begin'w'
		db:insert('users', '{}', {id = 6, status = null, score = null})
		db:commit()
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.status'), null})
				:select'users.id id'
				:prepare()
			assert(rel.access[1].plan.kind == 'exact')
			local node = compile_step(db, rel)
			assert(#collect_ids(node, 'users') == 0)

			rel = db:from('users')
				:where({'is_null', q.col('users.status')})
				:select'users.id id'
				:prepare()
			assert(rel.access[1].plan.kind == 'exact')
			local ids = {}
			for _, id in rel:rows() do ids[#ids+1] = id end
			assert(cat(ids, ',') == '6', cat(ids, ','))

			rel = db:from('users')
				:where({'is_not_null', q.col('users.status')})
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			assert(rel.access[1].plan.kind == 'range')
			ids = {}
			for _, id in rel:rows() do ids[#ids+1] = id end
			assert(cat(ids, ',') == '1,2,3,4,5', cat(ids, ','))

			rel = db:from('users')
				:where({'is_not_null', q.col('users.score')})
				:where({'>=', q.col('users.score'), 70})
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local plan = rel.access[1].plan
			assert(plan.kind == 'range' and plan.lo
				and plan.lo.op == '>=' and plan.lo.expr == 70)
			ids = {}
			for _, id in rel:rows() do ids[#ids+1] = id end
			assert(cat(ids, ',') == '1,2,4', cat(ids, ','))

			local params = {LO = null, HI = 95}
			rel = db:from('users')
				:where(q.between(q.col('users.score'),
					q.param('LO'), q.param('HI')))
				:select'users.id id'
				:prepare()
			assert(rel.access[1].plan.kind == 'range')
			node = compile_step(db, rel)
			assert(#collect_ids(node, 'users', params) == 0)

			params = {PREFIX = null}
			rel = db:from('users')
				:where({'starts', q.col('users.status'), q.param('PREFIX')})
				:select'users.id id'
				:prepare()
			assert(rel.access[1].plan.kind == 'prefix')
			node = compile_step(db, rel)
			assert(#collect_ids(node, 'users', params) == 0)
		end)
	end)
end

function test.nonleading_key_column_join_exec()
	with_db('nonleading_key_column_join_exec', function(db)
		db:begin'w'
		db:create_table('src', {fields = {
			{col = 'a', mdbx_type = 'u32', not_null = true},
			{col = 'b', mdbx_type = 'u32', not_null = true},
		}, pk = {'a', 'b'}})
		db:create_table('dst', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:insert('src', '{}', {a = 1, b = 99})
		db:insert('dst', '{}', {id = 1})
		db:insert('dst', '{}', {id = 99})
		db:commit()

		db:atomic('r', function()
			local rel = db:from('src')
				:join('dst', {'=', q.col('dst.id'), q.col('src.b')})
				:select'src.b b, dst.id id'
			local rows = rel:rows_array'[]'
			assert(#rows == 1 and rows[1][1] == 99 and rows[1][2] == 99)
		end)
	end)
end

function test.non_equality_join_rejected()
	with_db('non_equality_join_rejected', function(db)
		db:atomic('r', function()
			local ok, err = pcall(function()
				db:from('users')
					:join('sessions', {'<', q.col('sessions.user_id'),
						q.col('users.id')})
					:prepare()
			end)
			assert(not ok and tostring(err):find(
				'cannot compare cols from different sources', 1, true), err)
		end)
	end)
end

--{'in', ...} against the (single-column) pk with a short literal list:
--try_key() used to offer this as a seekable 'in' plan, which no
--executor implements (pk_scan's own kind assert never included 'in')
---- choose_access() would pick it anyway (best coverage) and crash at
--prepare() time, even though eval_expr()'s residual path already
--handles list membership correctly on its own.
function test.where_in_literal_list_exec()
	with_db('where_in_literal_list_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'in', q.col('users.id'), {2, 4}})
				:select'users.id id'
				:order_by'id'
				:prepare()
			local node = compile_step(db, rel)
			local ids = collect_ids(node, 'users')
			assert(cat(ids, ',') == '2,4', cat(ids, ','))
		end)
	end)
end

--order_by() over a non-literal in_() list needs no sort: the per-value
--seeks are chained with merge_union(), which compares key recs and so
--yields in key order whatever the runtime values turn out to be.
function test.in_dynamic_order_by_exec()
	with_db('in_dynamic_order_by_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'in', q.col('users.id'),
					{q.param('A'), q.param('B')}})
				:select'users.id id'
				:order_by'id'
				:prepare()
			assert(not rel.sort_needed)
			local rows = rel:rows_array('[]', {A = 3, B = 1})
			local ids = {}
			for i, row in ipairs(rows) do ids[i] = row[1] end
			assert(cat(ids, ',') == '1,3', cat(ids, ','))
		end)
	end)
end

--two distinct q.param() sources aren't compared at compile time (their
--runtime values aren't known yet), and Scan:union() doesn't dedupe --
--two seeks landing on the same row at runtime must not return it twice.
function test.in_duplicate_params_exec()
	with_db('in_duplicate_params_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'in', q.col('users.id'),
					{q.param('A'), q.param('B')}})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local ids = collect_ids(node, 'users', {A = 1, B = 1})
			assert(cat(ids, ',') == '1', cat(ids, ','))
		end)
	end)
end

--an ai_ci literal list with two spellings that fold to the same key
--must not match the same row twice.
function test.in_ai_ci_duplicate_literals_exec()
	with_db('in_ai_ci_duplicate_literals_exec', function(db)
		db:begin'w'
		db:create_table('people', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 32, nozero = true,
				not_null = true, mdbx_collation = 'utf8_ai_ci'},
		}, pk = {'id'}})
		db:add_index('people', {'name'})
		db:insert('people', '{}', {id = 1, name = 'a'})
		db:commit()
		db:atomic('r', function()
			local rel = db:from('people')
				:where({'in', q.col('people.name'), {'a', 'A'}})
				:select'people.id id'
				:prepare()
			local node = compile_step(db, rel)
			local ids = collect_ids(node, 'people')
			assert(cat(ids, ',') == '1', cat(ids, ','))
		end)
	end)
end

--a literal null in an in() list can never match (three-valued logic);
--it must not crash ordered_in_values()'s sort.
function test.in_null_literal_exec()
	with_db('in_null_literal_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'in', q.col('users.id'), {null, 1}})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local ids = collect_ids(node, 'users')
			assert(cat(ids, ',') == '1', cat(ids, ','))
		end)
	end)
end

--order_by() over an ai_ci-collated in_() literal list must sort by the
--folded key (what the index actually orders by), not by raw byte value.
function test.in_ai_ci_literal_order_by_exec()
	with_db('in_ai_ci_literal_order_by_exec', function(db)
		db:begin'w'
		db:create_table('people', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 32, nozero = true,
				not_null = true, mdbx_collation = 'utf8_ai_ci'},
		}, pk = {'id'}})
		db:add_index('people', {'name'})
		db:insert('people', '{}', {id = 1, name = 'apple'})
		db:insert('people', '{}', {id = 2, name = 'Banana'})
		db:commit()
		db:atomic('r', function()
			local rel = db:from('people')
				:where({'in', q.col('people.name'), {'Banana', 'apple'}})
				:select'people.id id'
				:order_by'people.name'
				:prepare()
			assert(not rel.sort_needed)
			local rows = rel:rows_array('[]')
			local ids = {}
			for i, row in ipairs(rows) do ids[i] = row[1] end
			assert(cat(ids, ',') == '1,2', cat(ids, ','))
		end)
	end)
end

--an in_() literal list with a null, on an ai_ci column, evaluated as a
--residual check (not a seek): compile_col_decoders()'s cached-set
--builder must skip null like candidate_matches()'s per-row path does,
--not fold it.
function test.in_ai_ci_null_residual_exec()
	with_db('in_ai_ci_null_residual_exec', function(db)
		db:begin'w'
		db:create_table('people', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 32, nozero = true,
				not_null = true, mdbx_collation = 'utf8_ai_ci'},
		}, pk = {'id'}})
		db:add_index('people', {'name'})
		db:insert('people', '{}', {id = 1, name = 'a'})
		db:commit()
		db:atomic('r', function()
			--the id equality plan wins the seek (kind_rank exact > in),
			--so the name in_() condition stays a residual check.
			local rel = db:from('people')
				:where({'=', q.col('people.id'), 1})
				:where({'in', q.col('people.name'), {null, 'A'}})
				:select'people.id id'
				:prepare()
			assert(#rel.access[1].plan.residual == 1)
			local node = compile_step(db, rel)
			local ids = collect_ids(node, 'people')
			assert(cat(ids, ',') == '1', cat(ids, ','))
		end)
	end)
end

--two independent equality facts (status, score), each with its own
--single-column index and no composite index covering both:
--choose_access can only drive the seek from one of them, so the other
--stays in plan.residual and must be checked by apply_residual/
--pk_filter at runtime, not just assumed to match.
function test.residual_filter_exec()
	with_db('residual_filter_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.status'), 'active'})
				:where({'=', q.col('users.score'), 80})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local ids = collect_ids(node, 'users')
			--users 2 and 4 are also status='active' but score ~= 80 --
			--without the residual check, they'd leak through.
			assert(cat(ids, ',') == '1', cat(ids, ','))
		end)
	end)
end

--prepare() gives rel.access[2] a sessions/user_id scan with users.id as a
--row-derived '=' param. compile_step() executes it through join_scans().
function test.inner_join_exec()
	with_db('inner_join_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:join('sessions',
					{'=', q.col('sessions.user_id'), q.col('users.id')})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_u()..':'..get_s()
			end
			node.close()
			--users 3 and 5 have no sessions -- inner join drops them.
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,4:15', cat(t, ','))
		end)
	end)
end

--left_join_scans() emits a parent once when the FK has no child and returns
--nil for the child cols.
function test.left_join_exec()
	with_db('left_join_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:left_join('sessions',
					{'=', q.col('sessions.user_id'), q.col('users.id')})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_u()..':'..(get_s() or '-')
			end
			node.close()
			--left_join_scans() keeps users 3 and 5 and returns nil for child cols.
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,3:-,4:15,5:-',
				cat(t, ','))
		end)
	end)
end

function test.left_join_chain_exec()
	with_group_db('left_join_chain_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:left_join('sessions',
					{'=', q.col('sessions.user_id'), q.col('users.id')})
				:left_join('events',
					{'=', q.col('events.session_id'), q.col('sessions.id')})
				:left_join('tags',
					{'=', q.col('tags.event_id'), q.col('events.id')})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			local get_e = node:col_decoder('events', 'id')
			local get_g = node:col_decoder('tags', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				local u, s, e, g = get_u(), get_s(), get_e(), get_g()
				t[#t+1] = u..':'..(s or '-')..':'..(e or '-')..':'..(g or '-')
			end
			node.close()
			assert(cat(t, ',') ==
				'1:11:21:31,1:11:21:32,1:11:22:-,1:12:-:-,1:13:-:-,'..
				'2:14:23:-,3:-:-:-,4:15:-:-,5:-:-:-', cat(t, ','))
		end)
	end)
end

--a where() on a left-joined member: attribute_conditions() forces this
--late (see the left-join doc in compile()'s ATTRIBUTE CONDITIONS
--section) since a left join's own matching must depend only on its
--on_expr. compile_step must still check the condition once against the
--finished row, or every candidate -- including null-extended ones --
--would leak through unfiltered.
function test.left_join_where_late_exec()
	with_db('left_join_where_late_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:left_join('sessions',
					{'=', q.col('sessions.user_id'), q.col('users.id')})
				:where({'=', q.col('sessions.id'), q.param('SID')})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			node.reset{SID = 11}
			local t = {}
			while node.advance() do
				t[#t+1] = get_u()..':'..(get_s() or '-')
			end
			node.close()
			--only user 1's session 11 matches; user 1's other sessions,
			--user 2/4's non-11 sessions, and users 3/5's null-extended
			--rows all fail the late check.
			assert(cat(t, ',') == '1:11', cat(t, ','))
		end)
	end)
end

--left join a whole group (sessions JOIN events, events required) onto
--users: compiles rel.access[2] as a step.nested, wired up by
--compile_nested() as nested_join(base_node, inner, {left = true,
--from_member = 'users'}). Same scenario as
--nested_join_group_left_exec in mdbx_query_nodes2_test.lua, built by
--hand there -- here it comes from a real db:from():left_join() query.
--user 4's session has no events -- the whole group nulls out,
--including the session, not just the event.
function test.left_join_group_exec()
	with_group_db('left_join_group_exec', function(db)
		db:atomic('r', function()
			local group = db:from('sessions')
				:join('events',
					{'=', q.col('events.session_id'), q.col('sessions.id')})
			local rel = db:from('users')
				:left_join(group,
					{'=', q.col('sessions.user_id'), q.col('users.id')})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			local get_e = node:col_decoder('events', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				local u, s, e = get_u(), get_s(), get_e()
				t[#t+1] = u..':'..(s or '-')..':'..(e or '-')
			end
			node.close()
			assert(cat(t, ',') ==
				'1:11:21,1:11:22,2:14:23,3:-:-,4:-:-,5:-:-', cat(t, ','))
		end)
	end)
end

--build_access() adds an inner group's base as a plain joined step and then
--adds the group's required joins to the same access chain.
--compile_step() keeps only rows where sessions and events both match.
function test.inner_join_group_exec()
	with_group_db('inner_join_group_exec', function(db)
		db:atomic('r', function()
			local group = db:from('sessions')
				:join('events',
					{'=', q.col('events.session_id'), q.col('sessions.id')})
			local rel = db:from('users')
				:join(group,
					{'=', q.col('sessions.user_id'), q.col('users.id')})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			local get_e = node:col_decoder('events', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				local u, s, e = get_u(), get_s(), get_e()
				t[#t+1] = u..':'..(s or '-')..':'..(e or '-')
			end
			node.close()
			assert(cat(t, ',') == '1:11:21,1:11:22,2:14:23', cat(t, ','))
		end)
	end)
end

--three plain top-level joins (users JOIN sessions JOIN events):
--rel.access has 3 entries, exercising compile_step's loop past the
--single-join case. Sessions/events with no match at any level are
--dropped, same inner-join semantics as the two-join case.
function test.inner_join_chain_exec()
	with_group_db('inner_join_chain_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:join('sessions',
					{'=', q.col('sessions.user_id'), q.col('users.id')})
				:join('events',
					{'=', q.col('events.session_id'), q.col('sessions.id')})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			local get_e = node:col_decoder('events', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_u()..':'..get_s()..':'..get_e()
			end
			node.close()
			assert(cat(t, ',') == '1:11:21,1:11:22,2:14:23', cat(t, ','))
		end)
	end)
end

--left join a group with two joins inside it (sessions JOIN events
--JOIN tags) onto users: step.nested has 3 entries, exercising
--compile_nested's loop past the single-join-inside-a-group case.
--user 2's only event (23) has no tags -- the failure propagates
--through two inner-join levels, nulling the whole group (session,
--event, and tag all absent), not just the tag.
function test.left_join_group_chain_exec()
	with_group_db('left_join_group_chain_exec', function(db)
		db:atomic('r', function()
			local group = db:from('sessions')
				:join('events',
					{'=', q.col('events.session_id'), q.col('sessions.id')})
				:join('tags',
					{'=', q.col('tags.event_id'), q.col('events.id')})
			local rel = db:from('users')
				:left_join(group,
					{'=', q.col('sessions.user_id'), q.col('users.id')})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			local get_e = node:col_decoder('events', 'id')
			local get_g = node:col_decoder('tags', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				local u, s, e, g = get_u(), get_s(), get_e(), get_g()
				t[#t+1] = u..':'..(s or '-')..':'..(e or '-')..':'..(g or '-')
			end
			node.close()
			assert(cat(t, ',') ==
				'1:11:21:31,1:11:21:32,2:-:-:-,3:-:-:-,4:-:-:-,5:-:-:-',
				cat(t, ','))
		end)
	end)
end

--events is a member nested inside the group (not its base, sessions);
--resolve_sources() ANDs the group's own where() into the outer
--left_join()'s on_expr (join.op == 'left'), so access_conditions()
--must attribute the merged condition to whichever step within the
--group actually reads it -- not dump it onto the group's base
--(sessions) step, which can't read events at all before events is
--joined in.
function test.left_join_group_internal_where_exec()
	with_group_db('left_join_group_internal_where_exec', function(db)
		db:atomic('r', function()
			local group = db:from('sessions')
				:join('events',
					{'=', q.col('events.session_id'), q.col('sessions.id')})
				:where({'=', q.col('events.id'), 21})
			local rel = db:from('users')
				:left_join(group,
					{'=', q.col('sessions.user_id'), q.col('users.id')})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_e = node:col_decoder('events', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_u()..':'..(get_e() or '-')
			end
			node.close()
			--only event 21 (user 1's session 11) satisfies the group's own
			--where(); every other user's group null-extends, including
			--user 2 whose session 14 has an event (23) that fails it.
			assert(cat(t, ',') == '1:21,2:-,3:-,4:-,5:-', cat(t, ','))
		end)
	end)
end

--fixture: sessions has a wide index {user_id, kind}, but the FK is
--declared on user_id alone.
local function build_wide_fk_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:insert('users', '{}', {id = 1})
	db:insert('users', '{}', {id = 2})
	db:create_table('sessions', {fields = {
		{col = 'id'     , mdbx_type = 'u32', not_null = true},
		{col = 'user_id', mdbx_type = 'u32', not_null = true},
		{col = 'kind'   , mdbx_type = 'utf8', maxlen = 16, nozero = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	db:add_index('sessions', {'user_id', 'kind'})
	db:add_fk{table = 'sessions', cols = {'user_id'},
		ref_table = 'users', ref_cols = {'id'}}
	local sessions = {
		{id = 11, user_id = 1, kind = 'web'},
		{id = 12, user_id = 1, kind = 'app'},
		{id = 13, user_id = 2, kind = 'web'},
	}
	for _, r in ipairs(sessions) do db:insert('sessions', '{}', r) end
	db:commit()
end

local function with_wide_fk_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_wide_fk_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--choose_access() must keep both joined columns in the wide index scan path.
function test.inner_join_wide_fk_seek_exec()
	with_wide_fk_db('inner_join_wide_fk_seek_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:join('sessions', {'and',
					{'=', q.col('sessions.user_id'), q.col('users.id')},
					{'=', q.col('sessions.kind'), 'web'}})
				:select'users.id id'
				:prepare()
			local plan = rel.access[2].plan
			assert(plan.kind == 'exact' and plan.depth == 2
				and #plan.seek == 2 and #plan.residual == 0)
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_u()..':'..get_s()
			end
			node.close()
			assert(cat(t, ',') == '1:11,2:13', cat(t, ','))
		end)
	end)
end

--when db:scan() finds no full {user_id,kind} key,
--left_join_scans() must emit the outer row with an absent child.
function test.left_join_wide_fk_no_match_exec()
	with_wide_fk_db('left_join_wide_fk_no_match_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:left_join('sessions', {'and',
					{'=', q.col('sessions.user_id'), q.col('users.id')},
					{'=', q.col('sessions.kind'), 'admin'}})
				:select'users.id id'
				:order_by'id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_u()..':'..(get_s() and 'y' or 'n')
			end
			node.close()
			--user 1 has sessions (11 web, 12 app) and user 2 has one (13
			--web), but none is kind='admin' -- both must still appear,
			--null-extended, not disappear.
			assert(cat(t, ',') == '1:n,2:n', cat(t, ','))
		end)
	end)
end

--fixture: sessions.kind has NO index at all (unlike build_wide_fk_fixture,
--where it's part of a wider index alongside user_id) -- the residual
--condition here was never a candidate for ANY chosen index, not even
--a trailing column of one, so it must always land in plan.residual.
local function build_narrow_fk_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:insert('users', '{}', {id = 1})
	db:create_table('sessions', {fields = {
		{col = 'id'     , mdbx_type = 'u32', not_null = true},
		{col = 'user_id', mdbx_type = 'u32', not_null = true},
		{col = 'kind'   , mdbx_type = 'utf8', maxlen = 16, nozero = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	db:add_fk{table = 'sessions', cols = {'user_id'},
		ref_table = 'users', ref_cols = {'id'}}
	db:insert('sessions', '{}', {id = 11, user_id = 1, kind = 'web'})
	db:commit()
end

local function with_narrow_fk_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_narrow_fk_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--choose_access() leaves kind='admin' in plan.residual because sessions.kind
--has no index.
function test.left_join_residual_unindexed_col_null_extends_exec()
	with_narrow_fk_db('left_join_residual_unindexed_col_null_extends_exec',
	function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:left_join('sessions', {'and',
					{'=', q.col('sessions.user_id'), q.col('users.id')},
					{'=', q.col('sessions.kind'), 'admin'}})
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_u()..':'..(get_s() and 'y' or 'n')
			end
			node.close()
			--user 1's only session is kind='web', never 'admin' -- must
			--still appear, null-extended.
			assert(cat(t, ',') == '1:n', cat(t, ','))
		end)
	end)
end

--fixture: sessions has two separately single-column-indexed columns
--(user_id, dept_id) -- unlike build_wide_fk_fixture's composite index,
--neither can be folded into the other's seek, so an on_expr
--correlating both against users leaves one of them in plan.residual
--no matter which index choose_access() picks.
local function build_two_index_fk_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id'     , mdbx_type = 'u32', not_null = true},
		{col = 'dept_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:insert('users', '{}', {id = 1, dept_id = 10})
	db:insert('users', '{}', {id = 2, dept_id = 20})
	db:create_table('sessions', {fields = {
		{col = 'id'     , mdbx_type = 'u32', not_null = true},
		{col = 'user_id', mdbx_type = 'u32', not_null = true},
		{col = 'dept_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	db:add_index('sessions', {'dept_id'})
	db:add_fk{table = 'sessions', cols = {'user_id'},
		ref_table = 'users', ref_cols = {'id'}}
	local sessions = {
		{id = 11, user_id = 1, dept_id = 10}, --matches both conditions
		{id = 12, user_id = 1, dept_id = 99}, --user matches, dept doesn't
		{id = 13, user_id = 2, dept_id = 20}, --matches both conditions
	}
	for _, r in ipairs(sessions) do db:insert('sessions', '{}', r) end
	db:commit()
end

local function with_two_index_fk_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_two_index_fk_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--choose_access() can only seek sessions by one of its two single-column
--indexes; the other equality condition stays in plan.residual and
--reads users, the already-joined outer source -- not sessions, the
--step's own new scanner that apply_residual() currently filters
--through alone. session 12 fails the residual dept_id check.
function test.inner_join_residual_reads_outer_member_exec()
	with_two_index_fk_db('inner_join_residual_reads_outer_member_exec',
	function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:join('sessions', {'and',
					{'=', q.col('sessions.user_id'), q.col('users.id')},
					{'=', q.col('sessions.dept_id'), q.col('users.dept_id')}})
				:select'users.id id'
				:prepare()
			local plan = rel.access[2].plan
			assert(#plan.residual == 1, #plan.residual)
			local node = compile_step(db, rel)
			local get_u = node:col_decoder('users', 'id')
			local get_s = node:col_decoder('sessions', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_u()..':'..get_s()
			end
			node.close()
			assert(cat(t, ',') == '1:11,2:13', cat(t, ','))
		end)
	end)
end

--compile_scan_param() maps sessions.user_id to the row-derived '=' param
--for the users.id scan in a child-to-parent join.
function test.inner_join_child_to_parent_exec()
	with_db('inner_join_child_to_parent_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('sessions')
				:join('users', {'=', q.col('users.id'), q.col('sessions.user_id')})
				:select'sessions.id sid'
				:prepare()
			local node = compile_step(db, rel)
			local get_s = node:col_decoder('sessions', 'id')
			local get_u = node:col_decoder('users', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_s()..':'..get_u()
			end
			node.close()
			assert(cat(t, ',') == '11:1,12:1,13:1,14:2,15:4', cat(t, ','))
		end)
	end)
end

--cross join: on_expr is a bare `true`, so no eq/lo/hi facts exist at
--all for sessions. choose_access() returns a full scan that join_scans()
--resets once per user row.
function test.cross_join_exec()
	with_db('cross_join_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:join('sessions', true)
				:select'users.id uid, sessions.id sid'
				:prepare()
			local node = compile_step(db, rel)
			node.reset()
			local n = 0
			while node.advance() do n = n + 1 end
			node.close()
			--5 users x 5 sessions, every combination.
			assert(n == 25, n)
		end)
	end)
end

--fixture: self-referencing FK (users.manager_id -> users.id) with its
--own index.
local function build_self_fk_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id'        , mdbx_type = 'u32', not_null = true},
		{col = 'manager_id', mdbx_type = 'u32', not_null = false},
	}, pk = {'id'}})
	db:add_index('users', {'manager_id'})
	db:add_fk{table = 'users', cols = {'manager_id'},
		ref_table = 'users', ref_cols = {'id'}}
	local users = {
		{id = 1, manager_id = null},
		{id = 2, manager_id = 1},
		{id = 3, manager_id = 1},
		{id = 4, manager_id = 2},
		{id = 5, manager_id = null},
	}
	for _, r in ipairs(users) do db:insert('users', '{}', r) end
	db:commit()
end

local function with_self_fk_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_self_fk_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--compile_joined_step() keeps 'users' for the base member and passes 'mgr'
--as the joined scanner's member name.
function test.inner_join_self_fk_alias_exec()
	with_self_fk_db('inner_join_self_fk_alias_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:join('users mgr',
					{'=', q.col('mgr.manager_id'), q.col('users.id')})
				:select'users.id boss'
				:prepare()
			local node = compile_step(db, rel)
			local get_boss = node:col_decoder('users', 'id')
			local get_report = node:col_decoder('mgr', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_boss()..':'..get_report()
			end
			node.close()
			--each report's boss, via the aliased self-join member 'mgr' --
			--users 3,4,5 have no reports and drop out of the inner join.
			assert(cat(t, ',') == '1:2,1:3,2:4', cat(t, ','))
		end)
	end)
end

--fixture: b has a composite (2-col) FK to a, but the join only
--equates the first column -- a partial match against the FK.
local function build_composite_fk_fixture(db)
	db:begin'w'
	db:create_table('a', {fields = {
		{col = 'x', mdbx_type = 'u32', not_null = true},
		{col = 'y', mdbx_type = 'u32', not_null = true},
	}, pk = {'x', 'y'}})
	db:create_table('b', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'x' , mdbx_type = 'u32', not_null = true},
		{col = 'y' , mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('b', {'x', 'y'})
	db:add_fk{table = 'b', cols = {'x', 'y'}, ref_table = 'a', ref_cols = {'x', 'y'}}
	db:insert('a', '{}', {x = 1, y = 1})
	db:insert('a', '{}', {x = 1, y = 2})
	db:insert('b', '{}', {id = 10, x = 1, y = 1})
	db:insert('b', '{}', {id = 11, x = 1, y = 2})
	db:commit()
end

local function with_composite_fk_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_composite_fk_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--when join() equates only x, choose_access() uses the x prefix of b/x,y
--and leaves y unconstrained.
function test.inner_join_composite_fk_partial_match_exec()
	with_composite_fk_db('inner_join_composite_fk_partial_match_exec',
	function(db)
		db:atomic('r', function()
			local rel = db:from('a')
				:join('b', {'=', q.col('b.x'), q.col('a.x')})
				:select'a.x id'
				:prepare()
			local node = compile_step(db, rel)
			node.reset()
			local n = 0
			while node.advance() do n = n + 1 end
			node.close()
			--2 a-rows (x=1,y=1 and x=1,y=2) x 2 b-rows (x=1,y=1 and
			--x=1,y=2) -- the join only equates x, so every a-row pairs
			--with every b-row regardless of y.
			assert(n == 4, n)
		end)
	end)
end

--compile_step() registers a base source under source.name, not schema.name,
--so node:col_decoder() can find an aliased source.
function test.from_alias_exec()
	with_db('from_alias_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users u')
				:where({'=', q.col('u.status'), 'active'})
				:select'u.id id'
				:prepare()
			local node = compile_step(db, rel)
			local get_id = node:col_decoder('u', 'id')
			node.reset()
			local t = {}
			while node.advance() do
				t[#t+1] = get_id()
			end
			node.close()
			assert(cat(t, ',') == '1,2,4', cat(t, ','))
		end)
	end)
end

------------------------------------------------------------------------------
--terminals: rows()/first()/one()/must_one(), each building on
--compile_step()'s chain with select() projection and, when requested,
--distinct()/order_by()/limit(). Uses build_fixture's plain users
--table (no joins) -- the chain past compile_step is what's new here.

function test.rows_exec()
	with_db('rows_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.status'), 'active'})
				:select{'users.id id', 'users.score score'}
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, row in rel:rows'{}' do
				t[#t+1] = row.id..':'..row.score
			end
			assert(cat(t, ',') == '1:80,2:95,4:70', cat(t, ','))
		end)
	end)
end

--the three row shapes, plus unpacked (no shape): same prepared rel,
--three separate rows() calls -- proves multiple terminal calls reuse
--the already-compiled plan instead of re-running compile().
function test.rows_shape_exec()
	with_db('rows_shape_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.id'), 1})
				:select{'users.id id', 'users.score score'}
				:prepare()
			local scan, id, score = rel:rows()()
			assert(id == 1 and score == 80, id..','..tostring(score))
			scan.close()
			local scan, row = rel:rows'[]'()
			assert(row[1] == 1 and row[2] == 80, cat(row, ','))
			scan.close()
			local scan, drow = rel:rows'{}'()
			assert(drow.id == 1 and drow.score == 80,
				drow.id..','..drow.score)
			scan.close()
		end)
	end)
end

function test.rows_array_shape_exec()
	with_db('rows_array_shape_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.id'), 1})
				:select{'users.id id', 'users.score score'}
				:prepare()
			local rows = rel:rows_array'[]'
			assert(#rows == 1 and rows[1][1] == 1 and rows[1][2] == 80)
			local drows = rel:rows_array'{}'
			assert(#drows == 1 and drows[1].id == 1
				and drows[1].score == 80)
		end)
	end)
end

function test.unpacked_trailing_null_arity_exec()
	with_db('unpacked_trailing_null_arity_exec', function(db)
		db:begin'w'
		db:insert('users', '{}', {id = 6, status = null, score = null})
		db:commit()
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.id'), 6})
				:select{'users.id id', 'users.status status'}
				:prepare()
			local function assert_row(...)
				local values = pack(...)
				assert(values.n == 2 and values[1] == 6 and values[2] == nil,
					values.n..':'..tostring(values[1])..':'
						..tostring(values[2]))
			end
			local scan, id, status = rel:rows()()
			assert_row(id, status)
			scan.close()

			local null_rel = db:from('users')
				:where({'=', q.col('users.id'), 6})
				:select{'users.status status'}
				:prepare()
			local n = 0
			for _, status in null_rel:rows() do
				assert(status == nil)
				n = n + 1
			end
			assert(n == 1)
			assert_row(rel:first())
			assert_row(rel:one())
			assert_row(rel:must_one())
		end)
	end)
end

--first(): returns just the first row even when more than one matches;
--nil when nothing matches.
function test.first_exec()
	with_db('first_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.status'), 'active'})
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			assert(rel:first() == 1)

			local none = db:from('users')
				:where({'=', q.col('users.id'), 999})
				:select'users.id id'
				:prepare()
			assert(none:first() == nil)
		end)
	end)
end

--one(): nil for zero matches, the row for exactly one, raises for more
--than one. must_one(): raises for zero matches too.
function test.one_must_one_exec()
	with_db('one_must_one_exec', function(db)
		db:atomic('r', function()
			local single = db:from('users')
				:where({'=', q.col('users.id'), 3})
				:select'users.id id'
				:prepare()
			assert(single:one() == 3)

			local none = db:from('users')
				:where({'=', q.col('users.id'), 999})
				:select'users.id id'
				:prepare()
			assert(none:one() == nil)
			local none2 = db:from('users')
				:where({'=', q.col('users.id'), 999})
				:select'users.id id'
				:prepare()
			assert(not pcall(function() none2:must_one() end))

			local multi = db:from('users')
				:where({'=', q.col('users.status'), 'active'})
				:select'users.id id'
				:prepare()
			assert(not pcall(function() multi:one() end))

			local must_single = db:from('users')
				:where({'=', q.col('users.id'), 3})
				:select'users.id id'
				:prepare()
			assert(must_single:must_one() == 3)
		end)
	end)
end

--distinct() with no cols given dedups by every returned field. No
--where(): choose_access picks the status index for group_key_terms's
--sake (same reasoning as group_by_aggregate_streamed_exec), so
--distinct_streaming should come out true. The desc order_by() only
--comes out right if value_sort actually ran -- the status index's own
--natural order is ascending, so this would pass by accident with asc.
function test.distinct_exec()
	with_db('distinct_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:select'users.status status'
				:distinct()
				:order_by'status desc'
				:prepare()
			assert(rel.distinct_streaming, 'expected the streaming path here')
			local t = {}
			for _, status in rel:rows() do t[#t+1] = status end
			assert(cat(t, ',') == 'banned,active', cat(t, ','))
		end)
	end)
end

--where() on score forces choose_access onto the score index instead
--(same reasoning as group_by_aggregate_hashed_exec), so status's free
--order is gone and distinct_streaming should come out false --
--hash_distinct carries the same result.
function test.distinct_hashed_exec()
	with_db('distinct_hashed_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'>=', q.col('users.score'), 0})
				:select'users.status status'
				:distinct()
				:order_by'status desc'
				:prepare()
			assert(not rel.distinct_streaming, 'expected the hash path here')
			local t = {}
			for _, status in rel:rows() do t[#t+1] = status end
			assert(cat(t, ',') == 'banned,active', cat(t, ','))
		end)
	end)
end

--sort_actually_needed() reuses encounter order through streaming and hash
--aggregate()/distinct(), including both calls in one pipeline.
function test.group_distinct_order_preserved_exec()
	with_db('group_distinct_order_preserved_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:group_by{'users.status status', {{'count'}, 'n'}}
				:order_by'status'
				:prepare()
			assert(rel.group_streaming and not rel.sort_needed)
			local values = {}
			for _, row in rel:rows'{}' do
				values[#values + 1] = row.status..':'..row.n
			end
			assert(cat(values, ',') == 'active:3,banned:2', cat(values, ','))

			rel = db:from('users')
				:where({'>=', q.col('users.score'), 0})
				:group_by{'users.score score', 'users.status status',
					{{'count'}, 'n'}}
				:order_by'score'
				:prepare()
			assert(not rel.group_streaming and not rel.sort_needed)
			values = {}
			for _, row in rel:rows'{}' do
				values[#values + 1] = row.score..':'..row.status..':'..row.n
			end
			assert(cat(values, ',') == '50:banned:1,60:banned:1,70:active:1,'
				..'80:active:1,95:active:1', cat(values, ','))

			rel = db:from('users')
				:select'users.status status'
				:distinct()
				:order_by'status'
				:prepare()
			assert(rel.distinct_streaming and not rel.sort_needed)
			values = {}
			for _, status in rel:rows() do values[#values + 1] = status end
			assert(cat(values, ',') == 'active,banned', cat(values, ','))

			rel = db:from('users')
				:where({'>=', q.col('users.score'), 0})
				:select'users.score score, users.status status'
				:distinct()
				:order_by'score'
				:prepare()
			assert(not rel.distinct_streaming and not rel.sort_needed)
			values = {}
			for _, row in rel:rows'{}' do
				values[#values + 1] = row.score..':'..row.status
			end
			assert(cat(values, ',') == '50:banned,60:banned,70:active,'
				..'80:active,95:active', cat(values, ','))

			rel = db:from('users')
				:group_by{'users.status status', {{'count'}, 'n'}}
				:distinct'status'
				:order_by'status'
				:prepare()
			assert(rel.group_streaming and not rel.distinct_streaming
				and not rel.sort_needed)
			values = {}
			for _, row in rel:rows'{}' do
				values[#values + 1] = row.status..':'..row.n
			end
			assert(cat(values, ',') == 'active:3,banned:2', cat(values, ','))

			rel = db:from('users')
				:group_by{{{'count'}, 'n'},
					{{'sum', q.col('users.score')}, 'total'}}
				:order_by'total desc'
				:prepare()
			assert(not rel.sort_needed)
			local row = rel:must_one'{}'
			assert(row.n == 5 and row.total == 355)
		end)
	end)
end

function test.materialized_null_positional_exec()
	with_db('materialized_null_positional_exec', function(db)
		db:begin'w'
		db:insert('users', '{}', {id = 6, status = 'active', score = null})
		db:insert('users', '{}', {id = 7, status = null, score = 100})
		db:commit()
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.status'), 'active'})
				:select{'users.id id', 'users.score score'}
				:order_by'score desc'
				:prepare()
			assert(rel.sort_needed)
			local t = {}
			for _, row in rel:rows'[]' do
				t[#t+1] = row[1]..':'..tostring(row[2])
			end
			assert(cat(t, ',') == '2:95,1:80,4:70,6:nil', cat(t, ','))

			rel = db:from('users')
				:where({'>=', q.col('users.score'), 0})
				:select{'users.id id', 'users.status status'}
				:distinct'status'
				:prepare()
			assert(not rel.distinct_streaming)
			t = {}
			for _, row in rel:rows'[]' do
				t[#t+1] = row[1]..':'..tostring(row[2])
			end
			assert(cat(t, ',') == '3:banned,4:active,7:nil', cat(t, ','))
		end)
	end)
end

--order_by() on a column not in select(): binds directly to the source
--col (out_col_or_source mode falls through to bind_col since the
--reference is qualified), so value_sort's spec reads it via
--col_decoder passthrough, not the projected row dict.
function test.order_by_unselected_col_exec()
	with_db('order_by_unselected_col_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:select'users.id id'
				:order_by'users.score desc'
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '2,1,4,5,3', cat(t, ','))
		end)
	end)
end

--choose_access() keeps the later status,score index when it satisfies the
--same order or grouping with one more fixed col.
function test.best_compatible_index_exec()
	with_db('best_compatible_index_exec', function(db)
		db:begin'w'
		db:add_index('users', {'status', 'score'})
		db:commit()
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.status'), 'active'})
				:select'users.id id'
				:order_by'users.score desc'
				:prepare()
			local plan = rel.access[1].plan
			assert(plan.schema.name == 'users/status,score'
				and plan.depth == 1 and plan.coverage == 1
				and plan.dir == 'desc' and not rel.sort_needed)
			local ids = {}
			for _, id in rel:rows() do ids[#ids + 1] = id end
			assert(cat(ids, ',') == '2,1,4', cat(ids, ','))

			rel = db:from('users')
				:where({'=', q.col('users.status'), 'active'})
				:group_by{'users.score score', {{'count'}, 'n'}}
				:prepare()
			plan = rel.access[1].plan
			assert(plan.schema.name == 'users/status,score'
				and plan.depth == 1 and plan.coverage == 1
				and rel.group_streaming)
			local rows = {}
			for _, row in rel:rows'{}' do
				rows[#rows + 1] = row.score..':'..row.n
			end
			assert(cat(rows, ',') == '70:1,80:1,95:1', cat(rows, ','))
		end)
	end)
end

function test.limit_exec()
	with_db('limit_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:select'users.id id'
				:order_by'users.score desc'
				:limit(2)
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '2,1', cat(t, ','))

			local rel2 = db:from('users')
				:select'users.id id'
				:order_by'users.score desc'
				:limit(2, 1)
				:prepare()
			local t2 = {}
			for _, id in rel2:rows() do t2[#t2+1] = id end
			assert(cat(t2, ',') == '1,4', cat(t2, ','))
		end)
	end)
end

--limit(q.param()) reads the args that rows() passes to scan.reset().
function test.limit_via_param_exec()
	with_db('limit_via_param_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:select'users.id id'
				:order_by'users.id'
				:limit(q.param('N'))
				:prepare()
			local t = {}
			for _, id in rel:rows{N = 2} do t[#t+1] = id end
			assert(cat(t, ',') == '1,2', cat(t, ','))
			local ok, err = pcall(function() rel:rows() end)
			assert(not ok and tostring(err):find'missing arg: N', err)
		end)
	end)
end

--select() re-projecting group_by()'s own output (a value-to-value
--reshape) isn't implemented yet -- compile_terminal() rejects it
--clearly instead of silently running group_by()'s out_cols as if
--select() had never been called.
function test.select_after_group_by_not_implemented_exec()
	with_db('select_after_group_by_not_implemented_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:group_by'users.status status'
				:select'status s'
				:prepare()
			assert(not pcall(function() rel:rows() end))
		end)
	end)
end

------------------------------------------------------------------------------
--group_by()/having(): compile_group() building on choose_access's own
--group_key_terms/try_group_key (unchanged) and the new group_streaming
--decision -- streamed (pk_group+stream_aggregate) when the chosen
--access plan already groups by status for free, hashed
--(hash_aggregate) when a where() on a different column forces a
--different index and that free order is gone.

--no where(): choose_access has nothing else to seek by, so it picks
--the status index for try_group_key's sake -- group_streaming should
--come out true. Exercises count/sum/min/max/avg together.
function test.group_by_aggregate_streamed_exec()
	with_db('group_by_aggregate_streamed_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:group_by{'users.status status',
					{{'count'}, 'n'},
					{{'sum', q.col('users.score')}, 'total'},
					{{'min', q.col('users.score')}, 'lo'},
					{{'max', q.col('users.score')}, 'hi'},
					{{'avg', q.col('users.score')}, 'avg'}}
				:order_by'status'
				:prepare()
			assert(rel.group_streaming, 'expected the streaming path here')
			local t = {}
			for _, row in rel:rows'{}' do
				t[#t+1] = ('%s:%d:%d:%d:%d:%.2f'):format(row.status, row.n,
					row.total, row.lo, row.hi, row.avg)
			end
			assert(cat(t, ',') ==
				'active:3:245:70:95:81.67,banned:2:110:50:60:55.00', cat(t, ','))
		end)
	end)
end

--where() on score forces choose_access onto the score index instead
--(the only candidate that try_key can seek with), so status's natural
--group order is gone -- group_streaming should come out false and
--hash_aggregate carries the same result.
function test.group_by_aggregate_hashed_exec()
	with_db('group_by_aggregate_hashed_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'>=', q.col('users.score'), 0})
				:group_by{'users.status status',
					{{'count'}, 'n'}, {{'sum', q.col('users.score')}, 'total'}}
				:order_by'status'
				:prepare()
			assert(not rel.group_streaming, 'expected the hash path here')
			local t = {}
			for _, row in rel:rows'{}' do
				t[#t+1] = row.status..':'..row.n..':'..row.total
			end
			assert(cat(t, ',') == 'active:3:245,banned:2:110', cat(t, ','))
		end)
	end)
end

--the group key is named '_agg2', matching what the first aggregate's
--auto-generated projected-field name would also be, and two
--aggregates (sum/avg) both read the same source column (score):
--compile_group()'s hash path used to name that first aggregate's
--field '_agg'..#outputs, colliding with (and silently overwriting)
--the key's own output slot instead of checking for that name already
--being taken, and separately projected that column once per
--aggregate instead of once total.
function test.group_by_aggregate_hashed_name_collision_exec()
	with_db('group_by_aggregate_hashed_name_collision_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'>=', q.col('users.score'), 0})
				:group_by{'users.status _agg2',
					{{'sum', q.col('users.score')}, 'total'},
					{{'avg', q.col('users.score')}, 'avg'}}
				:order_by'_agg2'
				:prepare()
			assert(not rel.group_streaming, 'expected the hash path here')
			local t = {}
			for _, row in rel:rows'{}' do
				t[#t+1] = row._agg2..':'..row.total..':'..row.avg
			end
			--active: scores 80,95,70 -> sum 245, avg 245/3; banned: 50,60
			---> sum 110, avg 55.
			assert(cat(t, ',') ==
				'active:245:'..(245/3)..',banned:110:55', cat(t, ','))
		end)
	end)
end

--grand total: group_by() with only aggregate outputs, no key col --
--one row, no grouping or order needed either way.
function test.group_by_grand_total_exec()
	with_db('group_by_grand_total_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:group_by{{{'count'}, 'n'},
					{{'sum', q.col('users.score')}, 'total'}}
				:prepare()
			local row = rel:first'{}'
			assert(row.n == 5 and row.total == 355, row.n..','..row.total)
		end)
	end)
end

--having(): filters group_by()'s own output rows (by out_col name, not
--a raw source column) after aggregation -- only 'active' has 3+ users.
function test.having_exec()
	with_db('having_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:group_by{'users.status status', {{'count'}, 'n'}}
				:having({'>=', q.col('n'), 3})
				:order_by'status'
				:prepare()
			local t = {}
			for _, row in rel:rows'{}' do t[#t+1] = row.status..':'..row.n end
			assert(cat(t, ',') == 'active:3', cat(t, ','))
		end)
	end)
end

------------------------------------------------------------------------------
--count()/exists(): don't need select()/group_by() -- answer straight
--off compile_step()'s chain when neither is present.

function test.count_exec()
	with_db('count_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'=', q.col('users.status'), 'active'})
				:prepare()
			assert(rel:count() == 3)
		end)
	end)
end

--distinct() changes count()'s answer: 5 raw rows, 2 distinct statuses.
function test.count_distinct_exec()
	with_db('count_distinct_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:select'users.status status'
				:distinct()
				:prepare()
			assert(rel:count() == 2)
		end)
	end)
end

--group_by() counts groups, not raw rows: 2 statuses -> 2 groups.
function test.count_group_by_exec()
	with_db('count_group_by_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:group_by'users.status status'
				:prepare()
			assert(rel:count() == 2)
		end)
	end)
end

--having() filters before count(): only 'active' has 3+ users.
function test.count_having_exec()
	with_db('count_having_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:group_by{'users.status status', {{'count'}, 'n'}}
				:having({'>=', q.col('n'), 3})
				:prepare()
			assert(rel:count() == 1)
		end)
	end)
end

function test.exists_exec()
	with_db('exists_exec', function(db)
		db:atomic('r', function()
			local yes = db:from('users')
				:where({'=', q.col('users.id'), 1})
				:prepare()
			assert(yes:exists() == true)
			local no = db:from('users')
				:where({'=', q.col('users.id'), 999})
				:prepare()
			assert(no:exists() == false)
		end)
	end)
end

--having() filtering out every group makes exists() false even though
--matching rows existed before aggregation -- a group only "exists"
--once its having() has been checked.
function test.exists_having_exec()
	with_db('exists_having_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:group_by{'users.status status', {{'count'}, 'n'}}
				:having({'>=', q.col('n'), 10})
				:prepare()
			assert(rel:exists() == false)
		end)
	end)
end

function test.union_count_exists_exec()
	with_db('union_count_exists_exec', function(db)
		db:atomic('r', function()
			local function selected(id)
				return db:from('users')
					:where({'=', q.col('users.id'), id})
					:select'users.id id'
			end
			local grouped = db:from('users')
				:where({'=', q.col('users.id'), 3})
				:group_by'users.id id'
			local rel = db:union(
				db:union(selected(1), selected(2)), grouped):prepare()
			assert(rel:count() == 3)
			assert(rel:exists())
			assert(rel:count() == 3)

			local empty_group = db:from('users')
				:where({'=', q.col('users.id'), 99})
				:group_by'users.id id'
			local empty_rel = db:union(selected(99), empty_group):prepare()
			assert(empty_rel:count() == 0)
			assert(not empty_rel:exists())
		end)
	end)
end

------------------------------------------------------------------------------
--where_has()/where_hasnt() evaluate exists()/not_exists() via FK with one
--persistent scan. where_has() returns users 1/2/4; where_hasnt() returns
--users 3/5.

function test.where_has_exec()
	with_group_db('where_has_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where_has('sessions', 'user_id')
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '1,2,4', cat(t, ','))
			--rows() closes the main scan and its correlated condition scan.
			for _, cur in ipairs(db._cursors) do assert(cur:closed()) end
		end)
	end)
end

function test.where_hasnt_exec()
	with_group_db('where_hasnt_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where_hasnt('sessions', 'user_id')
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '3,5', cat(t, ','))
		end)
	end)
end

--[[
where_has() combines the filter with the FK condition. choose_access()
uses the FK equality for the seek. apply_residual() reads MIN from the
args and checks each found session. rows() returns users 2 and 4.
]]
function test.where_has_filter_exec()
	with_group_db('where_has_filter_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where_has('sessions', 'user_id',
					{'>', q.col('sessions.id'), q.param('MIN')})
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows{MIN = 13} do t[#t+1] = id end
			assert(cat(t, ',') == '2,4', cat(t, ','))
		end)
	end)
end

--[[
q.exists() can occur anywhere in the boolean tree. q.exists() with no
on_expr checks whether the table has any row; where_has() supplies the
FK correlation instead.
]]
function test.exists_in_and_expr_exec()
	with_group_db('exists_in_and_expr_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where({'and',
					q.exists('sessions',
						{'=', q.col('sessions.user_id'), q.col('users.id')}),
					{'~=', q.col('users.id'), 2}})
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '1,4', cat(t, ','))
		end)
	end)
end

--[[
q.exists(sub) uses the same correlation as where_has_exec, written
explicitly instead of resolved from a FK. sub:where() puts the outer
q.col() in its base seek; compile_scan_param() reads it from the outer
scan. apply_residual() reads MIN from the args passed to sub.reset().
]]
function test.exists_rel_exec()
	with_group_db('exists_rel_exec', function(db)
		db:atomic('r', function()
			local sub = db:from('sessions')
				:where({'=', q.col('sessions.user_id'), q.col('users.id')})
				:where({'>', q.col('sessions.id'), q.param('MIN')})
			local rel = db:from('users')
				:where(q.exists(sub))
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows{MIN = 13} do t[#t+1] = id end
			assert(cat(t, ',') == '2,4', cat(t, ','))
			--rows() closes the main scan and its correlated relation scan.
			for _, cur in ipairs(db._cursors) do assert(cur:closed()) end
		end)
	end)
end

function test.not_exists_rel_exec()
	with_group_db('not_exists_rel_exec', function(db)
		db:atomic('r', function()
			local sub = db:from('sessions')
				:where({'=', q.col('sessions.user_id'), q.col('users.id')})
			local rel = db:from('users')
				:where(q.not_exists(sub))
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '3,5', cat(t, ','))
		end)
	end)
end

--[[
compile_exists_checker() materializes every sessions.user_id once for
an uncorrelated in/not_in relation.
]]
function test.in_rel_exec()
	with_group_db('in_rel_exec', function(db)
		db:atomic('r', function()
			local sub = db:from('sessions'):select'sessions.user_id id'
			local rel = db:from('users')
				:where({'in', q.col('users.id'), sub})
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '1,2,4', cat(t, ','))
		end)
	end)
end

function test.in_correlated_nullable_rel_exec()
	with_db('in_correlated_nullable_rel_exec', function(db)
		db:begin'w'
		db:create_table('user_values', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'user_id', mdbx_type = 'u32', not_null = true},
			{col = 'value', mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:add_index('user_values', {'user_id'})
		db:insert('user_values', '{}', {id = 11, user_id = 1})
		db:insert('user_values', '{}', {id = 12, user_id = 1, value = 1})
		db:insert('user_values', '{}', {id = 13, user_id = 2})
		db:commit()

		db:atomic('r', function()
			local sub = db:from('user_values')
				:where({'=', q.col('user_values.user_id'),
					q.col('users.id')})
				:select'user_values.value value'
			local rel = db:from('users')
				:where({'in', q.col('users.id'), sub})
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '1', cat(t, ','))
		end)
	end)
end

function test.not_in_rel_exec()
	with_group_db('not_in_rel_exec', function(db)
		db:atomic('r', function()
			local sub = db:from('sessions'):select'sessions.user_id id'
			local rel = db:from('users')
				:where({'not_in', q.col('users.id'), sub})
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '3,5', cat(t, ','))
		end)
	end)
end

--[[
compile_exists_checker() delegates a relation with its own join to
compile_step(). user 4's session 15 has no events, so the inner join
drops it and q.exists(sub) rejects user 4.
]]
function test.exists_rel_join_exec()
	with_group_db('exists_rel_join_exec', function(db)
		db:atomic('r', function()
			local sub = db:from('sessions')
				:join('events',
					{'=', q.col('events.session_id'), q.col('sessions.id')})
				:where({'=', q.col('sessions.user_id'), q.col('users.id')})
			local rel = db:from('users')
				:where(q.exists(sub))
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '1,2', cat(t, ','))
		end)
	end)
end

--[[
prepare() computes output, distinct, sort, and exists() descriptors
once. two rows() calls keep the same descriptor objects.
]]
function test.descriptors_compiled_once_exec()
	with_group_db('descriptors_compiled_once_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where_has('sessions', 'user_id')
				:select'users.id id'
				:order_by'id desc'
				:distinct()
				:prepare()
			local exists_expr
			for _, cond in ipairs(rel.access[1].plan.residual) do
				if cond.expr[1] == 'exists' then exists_expr = cond.expr end
			end
			assert(exists_expr, 'expected where_has() to leave a residual'
				..' exists() condition on the base step')
			local output_descriptor = rel.output_descriptor
			local distinct_key_cols = rel.distinct_key_cols
			local sort_spec = rel.sort_spec
			local exists_plan = exists_expr.plan
			assert(output_descriptor and distinct_key_cols and sort_spec
				and exists_plan, 'expected every descriptor to be precomputed')
			for _ in rel:rows() do end
			for _ in rel:rows() do end
			assert(rel.output_descriptor == output_descriptor,
				'output_descriptor rebuilt')
			assert(rel.distinct_key_cols == distinct_key_cols,
				'distinct_key_cols rebuilt')
			assert(rel.sort_spec == sort_spec, 'sort_spec rebuilt')
			assert(exists_expr.plan == exists_plan,
				'exists() checker plan rebuilt')
		end)
	end)
end

--fixture: sessions has an index on started_at (not on user_id) --
--exercises a range correlation against an outer column, which the old
--equality-only correlation check rejected outright regardless of any
--index.
local function build_range_correlation_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id'       , mdbx_type = 'u32', not_null = true},
		{col = 'min_start', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	local users = {
		{id = 1, min_start = 100},
		{id = 2, min_start = 1000},
	}
	for _, r in ipairs(users) do db:insert('users', '{}', r) end
	db:create_table('sessions', {fields = {
		{col = 'id'        , mdbx_type = 'u32', not_null = true},
		{col = 'started_at', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'started_at'})
	local sessions = {
		{id = 11, started_at = 150},
		{id = 12, started_at = 50},
		{id = 13, started_at = 300},
	}
	for _, r in ipairs(sessions) do db:insert('sessions', '{}', r) end
	db:commit()
end

local function with_range_correlation_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_range_correlation_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--[[
choose_access() uses the started_at index for a range correlation.
compile_getter() reads users.min_start once per outer row.
]]
function test.exists_range_correlation_exec()
	with_range_correlation_db('exists_range_correlation_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where(q.exists('sessions',
					{'>=', q.col('sessions.started_at'), q.col('users.min_start')}))
				:select'users.id id'
				:order_by'id'
				:prepare()
			local exists_expr
			for _, cond in ipairs(rel.access[1].plan.residual) do
				if cond.expr[1] == 'exists' then exists_expr = cond.expr end
			end
			assert(exists_expr and exists_expr.correlated,
				'expected a correlated exists() classification')
			assert(exists_expr.plan.kind == 'range',
				'expected the started_at index to drive a range seek')
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			--user 1 (min_start=100): sessions 11/13 qualify -> true.
			--user 2 (min_start=1000): no session qualifies -> false, dropped.
			assert(cat(t, ',') == '1', cat(t, ','))
		end)
	end)
end

function test.exists_correlated_residual_exec()
	with_db('exists_correlated_residual_exec', function(db)
		db:begin'w'
		db:create_table('residual_users', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'dept_id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:create_table('residual_sessions', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'user_id', mdbx_type = 'u32', not_null = true},
			{col = 'dept_id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('residual_sessions', {'user_id'})
		db:add_index('residual_sessions', {'dept_id'})
		db:insert('residual_users', '{}', {id = 1, dept_id = 10})
		db:insert('residual_users', '{}', {id = 2, dept_id = 20})
		db:insert('residual_sessions', '{}',
			{id = 11, user_id = 1, dept_id = 10})
		db:insert('residual_sessions', '{}',
			{id = 12, user_id = 2, dept_id = 99})
		db:commit()

		db:atomic('r', function()
			local exists_expr = q.exists('residual_sessions', {'and',
				{'=', q.col('residual_sessions.user_id'),
					q.col('residual_users.id')},
				{'=', q.col('residual_sessions.dept_id'),
					q.col('residual_users.dept_id')}})
			local rel = db:from('residual_users')
				:where(exists_expr)
				:select'residual_users.id id'
				:order_by'id'
				:prepare()
			assert(#exists_expr.plan.residual == 1,
				'expected one unconsumed correlation')
			local t = {}
			for _, id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '1', cat(t, ','))
		end)
	end)
end

--[[
compile() classifies exists() with q.param() but no outer q.col() as
uncorrelated. attribute_conditions() puts it in rel.late_conditions
because it reads no source from the outer relation.
]]
function test.exists_uncorrelated_classified_exec()
	with_db('exists_uncorrelated_classified_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where(q.exists('sessions',
					{'=', q.col('sessions.id'), q.param('SID')}))
				:select'users.id id'
				:order_by'id'
				:prepare()
			local exists_expr
			for _, cond in ipairs(rel.late_conditions) do
				if cond.expr[1] == 'exists' then exists_expr = cond.expr end
			end
			assert(exists_expr and exists_expr.correlated == false,
				'expected an uncorrelated exists() classification')
			local t = {}
			for _, id in rel:rows{SID = 11} do t[#t+1] = id end
			--session 11 exists (user_id=1), so every user matches --
			--the check doesn't vary per row, same for all 5 users.
			assert(cat(t, ',') == '1,2,3,4,5', cat(t, ','))
			assert(rel:first{SID = 99} == nil)
		end)
	end)
end

------------------------------------------------------------------------------

--[[
two FKs from one table to the same parent: naming the FK cols is what
tells fk_join()/where_has() which one to use. before fk_cols was
required, resolve_fk() found both and rejected the pair as ambiguous.
]]
local function with_two_fk_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		db:begin'w'
		db:create_table('users', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		for _, r in ipairs{{id=1},{id=2},{id=3}} do db:insert('users','{}',r) end
		db:create_table('messages', {fields = {
			{col = 'id'          , mdbx_type = 'u32', not_null = true},
			{col = 'from_user_id', mdbx_type = 'u32', not_null = true},
			{col = 'to_user_id'  , mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_fk{table = 'messages', cols = {'from_user_id'},
			ref_table = 'users', ref_cols = {'id'}}
		db:add_fk{table = 'messages', cols = {'to_user_id'},
			ref_table = 'users', ref_cols = {'id'}}
		for _, r in ipairs{
			{id = 101, from_user_id = 1, to_user_id = 2},
			{id = 102, from_user_id = 2, to_user_id = 1},
			{id = 103, from_user_id = 1, to_user_id = 3},
		} do db:insert('messages', '{}', r) end
		db:commit()
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

function test.fk_join_two_fks_exec()
	with_two_fk_db('fk_join_two_fks_exec', function(db)
		db:atomic('r', function()
			local sent = db:from'users'
				:fk_join('messages', 'from_user_id')
				:select'users.id uid, messages.id mid'
				:order_by'users.id, messages.id'
			local t = {}
			for _, row in sent:rows'{}' do t[#t+1] = row.uid..':'..row.mid end
			assert(cat(t, ',') == '1:101,1:103,2:102', cat(t, ','))

			local recv = db:from'users'
				:fk_join('messages', 'to_user_id')
				:select'users.id uid, messages.id mid'
				:order_by'users.id, messages.id'
			t = {}
			for _, row in recv:rows'{}' do t[#t+1] = row.uid..':'..row.mid end
			assert(cat(t, ',') == '1:102,2:101,3:103', cat(t, ','))
		end)
	end)
end

function test.where_has_two_fks_exec()
	with_two_fk_db('where_has_two_fks_exec', function(db)
		db:atomic('r', function()
			--user 3 never sent a message; user 2 never received two.
			local senders = db:from'users'
				:where_has('messages', 'from_user_id')
				:select'users.id id'
				:order_by'users.id'
			local t = {}
			for _, row in senders:rows'{}' do t[#t+1] = row.id end
			assert(cat(t, ',') == '1,2', cat(t, ','))

			local no_recv = db:from'users'
				:where_hasnt('messages', 'to_user_id')
				:select'users.id id'
				:order_by'users.id'
			t = {}
			for _, row in no_recv:rows'{}' do t[#t+1] = row.id end
			assert(cat(t, ',') == '', cat(t, ','))
		end)
	end)
end

function test.fk_join_requires_fk_cols()
	with_two_fk_db('fk_join_requires_fk_cols', function(db)
		db:atomic('r', function()
			assert(not pcall(function()
				return db:from'users':fk_join'messages':prepare()
			end))
			--a name that is not a declared FK on the child table.
			assert(not pcall(function()
				return db:from'users':fk_join('messages', 'nope'):prepare()
			end))
		end)
	end)
end

function test.or_in_param_keeps_order()
	with_group_db('or_in_param_keeps_order', function(db)
		db:atomic('r', function()
			local rel = db:from'sessions'
				:where{'or',
					{'=', q.col'sessions.user_id', q.param'A'},
					{'=', q.col'sessions.user_id', q.param'B'}}
				:select'sessions.id id'
				:order_by'sessions.user_id, sessions.id'
				:prepare()
			assert(rel.access[1].plan.kind == 'in', rel.access[1].plan.kind)
			assert(not rel.sort_needed)
			local t = {}
			for _, row in rel:rows('{}', {A = 4, B = 1}) do t[#t+1] = row.id end
			assert(cat(t, ',') == '11,12,13,15', cat(t, ','))
		end)
	end)
end

local function with_desc_ix_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		db:begin'w'
		db:create_table('dt', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'k' , mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('dt', {'k', desc = {true}})
		for _, r in ipairs{{id = 1, k = 10}, {id = 2, k = 20},
			{id = 3, k = 30}}
		do db:insert('dt', '{}', r) end
		db:commit()
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--a descending index col runs the cursor from high to low, so the literal
--in_() seeks must be issued high to low for union() to come out in key
--order.
function test.in_literal_descending_index_exec()
	with_desc_ix_db('in_literal_descending_index_exec', function(db)
		db:atomic('r', function()
			local rel = db:from'dt'
				:where{'in', q.col'dt.k', {10, 30}}
				:select'dt.id id'
				:order_by'dt.k desc, dt.id'
				:prepare()
			assert(rel.access[1].plan.kind == 'in', rel.access[1].plan.kind)
			assert(not rel.sort_needed)
			local t = {}
			for _, row in rel:rows'{}' do t[#t+1] = row.id end
			assert(cat(t, ',') == '3,1', cat(t, ','))
		end)
	end)
end

local name = ...
if name == 'mdbx_query_test' then name = nil end
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
