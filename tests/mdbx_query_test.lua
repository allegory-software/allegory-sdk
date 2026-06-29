require'mdbx_query'

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

local function S(v) --printable form for assert messages.
	if istab(v) then return '{'..cat(imap(v, tostring), ',')..'}' end
	return tostring(v)
end

local function get_pk(node, name)
	local ok, p, sz = node:pk(name)
	assert(ok, 'expected current pk')
	return p, sz
end

local schema_C = ffi.load'mdbx_schema'
local pk_out = u8a(MDBX_MAX_KEY_SIZE)
local pk_pout = new'const u8*[1]'
local pk_pp = new'const u8*[1]'

local function decode_pk(schema, p, sz)
	assert(schema and #schema.key_fields == 1, 'single-column pk schema required')
	local f = schema.key_fields[1]
	pk_pp[0] = p
	local len = schema_C.schema_get_key(schema._st, 0,
		p, sz, pk_out, MDBX_MAX_KEY_SIZE, pk_pout, pk_pp)
	assert(len ~= -1, 'expected non-null pk')
	return tonumber(f.decode(pk_pout[0], len))
end

local function pk_id(node, name, db_or_schema)
	local schema = db_or_schema
	if db_or_schema and db_or_schema.table_schema then
		schema = db_or_schema:table_schema(name)
	end
	local p, sz = get_pk(node, name)
	return decode_pk(schema, p, sz)
end

local function collect_pks(node, name, schema)
	node:open()
	local t = {}
	while node:next_group() do
		repeat
			t[#t+1] = pk_id(node, name, schema)
		until not node:next_pk()
	end
	node:close()
	return t
end

--fixture: users <- sessions <- events, with the indexes used in the spec.
--data exercises pk-order vs ix-order (duplicate status keys) and FK fan-out
--(user 1 has three sessions).
local function build_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id'    , mdbx_type = 'u64', not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16, nozero = true},
		{col = 'score' , mdbx_type = 'i64'},
	}, pk = {'id'}})
	db:add_index('users', {'status'})
	db:add_index('users', {'score'})

	db:create_table('sessions', {fields = {
		{col = 'id'        , mdbx_type = 'u64', not_null = true},
		{col = 'user_id'   , mdbx_type = 'u64', not_null = true},
		{col = 'started_at', mdbx_type = 'i64', not_null = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	db:add_index('sessions', {'started_at'})
	db:add_index('sessions', {'user_id', 'started_at'})
	db:add_fk{table = 'sessions', cols = {'user_id'},
		ref_table = 'users', ref_cols = {'id'}}

	db:create_table('events', {fields = {
		{col = 'id'        , mdbx_type = 'u64', not_null = true},
		{col = 'session_id', mdbx_type = 'u64', not_null = true},
		{col = 'kind'      , mdbx_type = 'utf8', maxlen = 16, nozero = true},
	}, pk = {'id'}})
	db:add_index('events', {'session_id'})
	db:add_index('events', {'kind'})
	db:add_fk{table = 'events', cols = {'session_id'},
		ref_table = 'sessions', ref_cols = {'id'}}

	local users = {
		{id = 1, status = 'active', score = 80},
		{id = 2, status = 'active', score = 95},
		{id = 3, status = 'banned', score = 50},
		{id = 4, status = 'active', score = 70},
		{id = 5, status = 'banned', score = 60},
	}
	for _, r in ipairs(users) do db:insert('users', '{}', r) end

	local sessions = {
		{id = 11, user_id = 1, started_at = 1000},
		{id = 12, user_id = 1, started_at = 1100},
		{id = 13, user_id = 1, started_at = 1200},
		{id = 14, user_id = 2, started_at = 1300},
		{id = 15, user_id = 4, started_at = 1400},
	}
	for _, r in ipairs(sessions) do db:insert('sessions', '{}', r) end

	local events = {
		{id = 21, session_id = 11, kind = 'open'},
		{id = 22, session_id = 11, kind = 'click'},
		{id = 23, session_id = 14, kind = 'open'},
	}
	for _, r in ipairs(events) do db:insert('events', '{}', r) end
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

------------------------------------------------------------------------------

function test.explain_pk_range()
	with_db('explain_pk_range', function(db)
		db:atomic('r', function()
			local e = db:pk_range('users'):explain()
			assert(e.kind == 'pk_range', e.kind)
			assert(e.item == 'pk', e.item)
			assert(#e.members == 1 and e.members[1] == 'users', S(e.members))
			assert(e.order[1] == 'users.id asc', e.order[1])
			assert(e.unique == true)
			assert(e.source == 'cursor', e.source)
		end)
	end)
end

function test.explain_pk_get()
	with_db('explain_pk_get', function(db)
		db:atomic('r', function()
			local e = db:pk_get('users', 1):explain()
			assert(e.kind == 'pk_get', e.kind)
			assert(e.item == 'pk', e.item)
			assert(e.members[1] == 'users', e.members[1])
			assert(e.order[1] == 'users.pk asc', e.order[1])
			assert(e.unique == true)
			assert(e.source == 'pk_bytes', e.source)
		end)
	end)
end

function test.resolve_errors()
	with_db('resolve_errors', function(db)
		db:atomic('r', function()
			--unknown table.
			assert(not pcall(db.pk_range, db, 'nope'))
			--wrong bound arg count.
			assert(not pcall(db.pk_range, db, 'users', 1))
			--wrong pk arity.
			assert(not pcall(db.pk_get, db, 'users'))
			assert(not pcall(db.pk_get, db, 'users', 1, 2))
		end)
	end)
end

------------------------------------------------------------------------------

function test.pk_seek_exec()
	with_db('pk_seek_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			--seek 'active' -> users 1, 2, 4 in pk-order
			local node = db:pk_seek('users/status', 'active')
			local pks = collect_pks(node, 'users', schema)
			assert(#pks == 3, 'expected 3, got '..#pks)
			assert(pks[1] == 1 and pks[2] == 2 and pks[3] == 4, S(pks))
			--seek missing key -> nil immediately
			local n = db:pk_seek('users/status', 'missing')
			n:open()
			assert(n:next_group() == nil)
			assert(n:pk('users') == nil)
			n:close()
		end)
	end)
end

function test.pk_get_exec()
	with_db('pk_get_exec', function(db)
		db:atomic('r', function()
			--existing PK returns it
			local node = db:pk_get('users', 3)
			node:open()
			assert(node:next_group() == true)
			assert(pk_id(node, 'users', db) == 3)
			--exhausted after one item
			assert(node:next_group() == nil)
			assert(node:pk('users') == nil)
			node:close()
			--missing PK returns nil
			local n = db:pk_get('users', 999)
			n:open()
			assert(n:next_group() == nil)
			assert(n:pk('users') == nil)
			n:close()
		end)
	end)
end

function test.pk_range_base_exec()
	with_db('pk_range_base_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local pks = collect_pks(db:pk_range('users'), 'users', schema)
			assert(#pks == 5, 'expected 5 pks, got '..#pks)
			for i, pk in ipairs(pks) do
				assert(pk == i, 'expected pk '..i..', got '..tostring(pk))
			end
		end)
	end)
end

function test.pk_prefix_exec()
	with_db('pk_prefix_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('sessions')
			--prefix user_id=1 -> sessions 11,12,13 in started_at (index-key) order
			local pks = collect_pks(
				db:pk_prefix('sessions/user_id,started_at', 1),
				'sessions', schema)
			assert(#pks == 3, 'expected 3 sessions, got '..#pks)
			assert(pks[1] == 11 and pks[2] == 12 and pks[3] == 13, S(pks))
			--prefix user_id=3 -> no sessions (user 3 has none)
			local n = db:pk_prefix('sessions/user_id,started_at', 3)
			n:open()
			assert(n:next_group() == nil)
			assert(n:pk('sessions') == nil)
			n:close()
			--wrong arity: full key (2 cols) not allowed; need 1..n-1
			assert(not pcall(db.pk_prefix, db, 'sessions/user_id,started_at', 1, 1000))
			--wrong arity: zero cols not allowed
			assert(not pcall(db.pk_prefix, db, 'sessions/user_id,started_at'))
			--single-column index: no valid prefix length
			assert(not pcall(db.pk_prefix, db, 'sessions/user_id', 1))
		end)
	end)
end

function test.fk_parent_scan_exec()
	with_db('fk_parent_scan_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local pks = collect_pks(db:fk_parent_scan('sessions/user_id'), 'users', schema)
			--users 1,2,4 have sessions; 3,5 do not
			assert(#pks == 3, 'expected 3, got '..#pks)
			assert(pks[1] == 1 and pks[2] == 2 and pks[3] == 4,
				'expected {1,2,4}, got '..S(pks))
			--non-FK index rejected
			assert(not pcall(db.fk_parent_scan, db, 'users/status'))
		end)
	end)
end

function test.merge_join_and_exec()
	with_db('merge_join_and_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node)
				return collect_pks(node, 'users', schema)
			end
			local t = pks(db:merge_join(
				db:pk_range('users'),
				db:pk_seek('users/status', 'active')))
			assert(cat(t, ',') == '1,2,4', S(t))
			t = pks(db:merge_join(
				db:pk_seek('users/status', 'active'),
				db:pk_seek('users/status', 'banned')))
			assert(#t == 0, S(t))
			assert(not pcall(db.merge_join, db,
				db:pk_range('users'),
				db:pk_range('users/score', '>=', 70, '<=', 95)))
		end)
	end)
end

function test.merge_join_exec()
	with_db('merge_join_exec', function(db)
		db:atomic('r', function()
			local node = db:merge_join(
				db:pk_range('users'),
				db:pk_range('sessions/user_id'))
			node:open()
			local tuples = {}
			while node:next_group() do
				tuples[#tuples+1] = pk_id(node, 'users', db)..':'..pk_id(node, 'sessions', db)
			end
			node:close()
			assert(cat(tuples, ',') == '1:11,1:12,1:13,2:14,4:15', S(tuples))

			local left = db:merge_join(
				db:pk_range('users'),
				db.left(db:pk_range('sessions/user_id')))
			left:open()
			local missing = {}
			while left:next_group() do
				if not left:pk('sessions') then
					missing[#missing+1] = pk_id(left, 'users', db)
				end
			end
			left:close()
			assert(cat(missing, ',') == '3,5', S(missing))
		end)
	end)
end

function test.merge_join_reset_group()
	with_db('merge_join_reset_group', function(db)
		db:atomic('r', function()
			--self-join on events/kind: cross-product of event PKs per kind group.
			--'click':{22} x {22} = 1 pair; 'open':{21,23} x {21,23} = 4 pairs.
			local node = db:merge_join(
				db:pk_range('events/kind'),
				db:pk_range('events/kind'))
			node:open()
			local lefts = {}
			while node:next_group() do
				lefts[#lefts+1] = pk_id(node, 'events', db)
			end
			node:close()
			--left PKs: 22 (click group), then 21,21,23,23 (open group)
			assert(cat(lefts, ',') == '22,21,21,23,23', S(lefts))
		end)
	end)
end

function test.pk_range_exec()
	with_db('pk_range_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node)
				return collect_pks(node, 'users', schema)
			end
			local function eq(a, b)
				if #a ~= #b then return false end
				for i = 1, #a do if a[i] ~= b[i] then return false end end
				return true
			end
			assert(eq(pks(db:pk_range('users/score', '>=', 70, '<=', 95)), {4,1,2}))
			assert(eq(pks(db:pk_range('users/score', '>=', 70, '<=', 95, {desc=true})), {2,1,4}))
			assert(eq(pks(db:pk_range('users/score', '>', 70, '<=', 95)), {1,2}))
			assert(eq(pks(db:pk_range('users/score', '>=', 70, '<', 95)), {4,1}))
			assert(eq(pks(db:pk_range('users/score')), {3,5,4,1,2}))
			assert(eq(pks(db:pk_range('users/score', {desc=true})), {2,1,4,5,3}))
			assert(eq(pks(db:pk_range('users/score', '>=', null, '<=', null)), {}))
			assert(eq(pks(db:pk_range('users/score', '>', null)), {3,5,4,1,2}))
			assert(not pcall(db.pk_range, db, 'users/score', '>=', 95, '<=', 70))
		end)
	end)
end

function test.merge_union_or_exec()
	with_db('merge_union_or_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node)
				return collect_pks(node, 'users', schema)
			end
			--active OR banned = all 5 users in pk order
			local t = pks(db:merge_union(
				db:pk_seek('users/status', 'active'),
				db:pk_seek('users/status', 'banned')))
			assert(cat(t, ',') == '1,2,3,4,5', S(t))
			--dedup: active OR active = just active
			t = pks(db:merge_union(
				db:pk_seek('users/status', 'active'),
				db:pk_seek('users/status', 'active')))
			assert(cat(t, ',') == '1,2,4', S(t))
			--one side empty: active OR missing = just active
			t = pks(db:merge_union(
				db:pk_seek('users/status', 'active'),
				db:pk_seek('users/status', 'missing')))
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.merge_except_exec()
	with_db('merge_except_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node)
				return collect_pks(node, 'users', schema)
			end
			--all users except active = banned {3,5}
			local t = pks(db:merge_except(
				db:pk_range('users'),
				db:pk_seek('users/status', 'active')))
			assert(cat(t, ',') == '3,5', S(t))
			--active except banned = active {1,2,4}
			t = pks(db:merge_except(
				db:pk_seek('users/status', 'active'),
				db:pk_seek('users/status', 'banned')))
			assert(cat(t, ',') == '1,2,4', S(t))
			--except self = empty
			t = pks(db:merge_except(
				db:pk_seek('users/status', 'active'),
				db:pk_seek('users/status', 'active')))
			assert(#t == 0, S(t))
			--except empty = unchanged
			t = pks(db:merge_except(
				db:pk_seek('users/status', 'active'),
				db:pk_seek('users/status', 'missing')))
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.pk_join_seek_exec()
	with_db('pk_join_seek_exec', function(db)
		db:atomic('r', function()
			-- active users (1,2,4) + their sessions; driver order preserved
			local node = db:pk_join_seek(db:pk_seek('users/status', 'active'), 'sessions/user_id')
			node:open()
			local tuples = {}
			while node:next_group() do
				tuples[#tuples+1] = pk_id(node, 'users', db)..':'..pk_id(node, 'sessions', db)
			end
			node:close()
			-- user 1 has sessions 11,12,13; user 2 has 14; user 4 has 15
			assert(cat(tuples, ',') == '1:11,1:12,1:13,2:14,4:15', S(tuples))
			-- user with no children: user 3 has no sessions
			local node2 = db:pk_join_seek(db:pk_get('users', 3), 'sessions/user_id')
			node2:open()
			assert(node2:next_group() == nil)
			node2:close()
			-- error: driver member must match parent table
			assert(not pcall(db.pk_join_seek, db, db:pk_range('sessions'), 'sessions/user_id'))
			-- error: not a FK index
			assert(not pcall(db.pk_join_seek, db, db:pk_range('users'), 'users/status'))
		end)
	end)
end

function test.pk_join_hash_exec()
	with_db('pk_join_hash_exec', function(db)
		db:atomic('r', function()
			-- driver in score order (users 4,1,2); output in FK-index order (user PK asc)
			local node = db:pk_join_hash(
				db:pk_range('users/score', '>=', 70),
				'sessions/user_id')
			node:open()
			local tuples = {}
			while node:next_group() do
				tuples[#tuples+1] = pk_id(node, 'users', db)..':'..pk_id(node, 'sessions', db)
			end
			node:close()
			-- FK index order: user 1 first (not user 4 which led in score order)
			assert(cat(tuples, ',') == '1:11,1:12,1:13,2:14,4:15', S(tuples))
			-- driver with no matches: user 3 has no sessions
			local node2 = db:pk_join_hash(db:pk_get('users', 3), 'sessions/user_id')
			node2:open()
			assert(node2:next_group() == nil)
			node2:close()
		end)
	end)
end

function test.pk_parent_lookup_exec()
	with_db('pk_parent_lookup_exec', function(db)
		db:atomic('r', function()
			-- all sessions -> their users; sessions in PK order 11..15
			local node = db:pk_parent_lookup(db:pk_range('sessions'), 'sessions/user_id')
			node:open()
			local tuples = {}
			while node:next_group() do
				tuples[#tuples+1] = pk_id(node, 'sessions', db)..':'..pk_id(node, 'users', db)
			end
			node:close()
			assert(cat(tuples, ',') == '11:1,12:1,13:1,14:2,15:4', S(tuples))
			-- covered read: user_id is in sessions/user_id,started_at index key
			local node2 = db:pk_parent_lookup(
				db:pk_prefix('sessions/user_id,started_at', 1),
				'sessions/user_id')
			node2:open()
			local t2 = {}
			while node2:next_group() do
				t2[#t2+1] = pk_id(node2, 'sessions', db)..':'..pk_id(node2, 'users', db)
			end
			node2:close()
			-- sessions 11,12,13 (user 1's sessions in started_at order) -> user 1
			assert(cat(t2, ',') == '11:1,12:1,13:1', S(t2))
			-- left join: events -> sessions (event 23 -> session 14 -> user 2; events 21,22 -> session 11)
			local node3 = db:pk_parent_lookup(db:pk_range('events'), 'events/session_id')
			node3:open()
			local t3 = {}
			while node3:next_group() do
				t3[#t3+1] = pk_id(node3, 'events', db)..':'..pk_id(node3, 'sessions', db)
			end
			node3:close()
			assert(cat(t3, ',') == '21:11,22:11,23:14', S(t3))
			-- error: driver member must match child table
			assert(not pcall(db.pk_parent_lookup, db, db:pk_range('users'), 'sessions/user_id'))
		end)
	end)
end

function test.pk_hash_filter_exec()
	with_db('pk_hash_filter_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node)
				return collect_pks(node, 'users', schema)
			end
			-- 'in': score >= 70 (ix-order: u4,u1,u2) intersect active (u1,u2,u4) = u4,u1,u2
			local t = pks(db:pk_hash_filter(
				db:pk_range('users/score', '>=', 70),
				db:pk_seek('users/status', 'active'),
				'in'))
			assert(cat(t, ',') == '4,1,2', S(t))
			-- 'not_in': all scores (ix-order: u3,u5,u4,u1,u2) minus active (u1,u2,u4) = u3,u5
			t = pks(db:pk_hash_filter(
				db:pk_range('users/score'),
				db:pk_seek('users/status', 'active'),
				'not_in'))
			assert(cat(t, ',') == '3,5', S(t))
			-- 'in' with empty set: nothing passes
			t = pks(db:pk_hash_filter(
				db:pk_range('users/score'),
				db:pk_seek('users/status', 'missing'),
				'in'))
			assert(#t == 0, S(t))
			-- 'not_in' with full set: nothing passes
			t = pks(db:pk_hash_filter(
				db:pk_seek('users/status', 'active'),
				db:pk_range('users'),
				'not_in'))
			assert(#t == 0, S(t))
		end)
	end)
end

function test.limit_exec()
	with_db('limit_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node)
				return collect_pks(node, 'users', schema)
			end
			assert(cat(pks(db:limit(db:pk_range('users'), 3)),    ',') == '1,2,3',   'limit 3')
			assert(cat(pks(db:limit(db:pk_range('users'), 3, 2)), ',') == '3,4,5',   'limit 3 offset 2')
			assert(    pks(db:limit(db:pk_range('users'), 0))     [1]  == nil,        'limit 0')
			assert(cat(pks(db:limit(db:pk_range('users'), 10)),   ',') == '1,2,3,4,5','limit > count')
		end)
	end)
end

function test.nested_join_exec()
	with_db('nested_join_exec', function(db)
		db:atomic('r', function()
			local function run(driver)
				local node = db:nested_join(driver, function(outer)
					local uid = pk_id(outer, 'users', db)
					return db:pk_seek('sessions/user_id', uid)
				end)
				node:open()
				local tuples = {}
				while node:next_group() do
					tuples[#tuples+1] = pk_id(node, 'users', db)..':'..pk_id(node, 'sessions', db)
				end
				node:close()
				return tuples
			end
			-- active users (1,2,4) x their sessions
			local t = run(db:pk_seek('users/status', 'active'))
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,4:15', S(t))
			-- all users: users 3 and 5 have no sessions and are skipped
			t = run(db:pk_range('users'))
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,4:15', S(t))
			-- members extended with inner members after first iteration
			local node = db:nested_join(
				db:pk_seek('users/status', 'active'),
				function(outer)
					return db:pk_seek('sessions/user_id', pk_id(outer, 'users', db))
				end)
			node:open()
			node:next_group()
			assert(#node.members == 2 and node.members[1] == 'users' and node.members[2] == 'sessions',
				S(node.members))
			node:close()
		end)
	end)
end

function test.anti_join_exec()
	with_db('anti_join_exec', function(db)
		db:atomic('r', function()
			local function pks(node)
				return collect_pks(node, 'users', db)
			end
			-- keep users with NO sessions (users 3 and 5 have none)
			local t = pks(db:anti_join(
				db:pk_range('users'),
				function(outer)
					local uid = pk_id(outer, 'users', db)
					return db:pk_seek('sessions/user_id', uid)
				end))
			assert(cat(t, ',') == '3,5', S(t))
			-- inner always empty: all outer items pass
			t = pks(db:anti_join(
				db:pk_seek('users/status', 'active'),
				function(outer) return db:pk_seek('sessions/user_id', 999) end))
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.semi_join_exec()
	with_db('semi_join_exec', function(db)
		db:atomic('r', function()
			local function pks(node)
				return collect_pks(node, 'users', db)
			end
			-- keep users that have at least one session (users 1,2,4 do; 3,5 don't)
			local t = pks(db:semi_join(
				db:pk_range('users'),
				function(outer)
					local uid = pk_id(outer, 'users', db)
					return db:pk_seek('sessions/user_id', uid)
				end))
			assert(cat(t, ',') == '1,2,4', S(t))
			-- inner always empty: no outer items pass
			t = pks(db:semi_join(
				db:pk_range('users'),
				function(outer) return db:pk_seek('sessions/user_id', 999) end))
			assert(#t == 0, S(t))
		end)
	end)
end

function test.pk_group_exec()
	with_db('pk_group_exec', function(db)
		db:atomic('r', function()
			local function uid_key(n)
				local uid = n:col('sessions', 'user_id')
				return {uid}
			end
			-- sessions/user_id order: user 1 -> {11,12,13}, user 2 -> {14}, user 4 -> {15}
			-- first item per group: 11, 14, 15
			local node = db:pk_group(db:pk_range('sessions/user_id'), uid_key)
			node:open()
			local firsts = {}
			while node:next_group() do
				firsts[#firsts+1] = pk_id(node, 'sessions', db)
				-- intentionally skip next_pk to test group-skip in next_group
			end
			node:close()
			assert(cat(firsts, ',') == '11,14,15', S(firsts))
			-- full group iteration via next_pk: all sessions per user group
			node = db:pk_group(db:pk_range('sessions/user_id'), uid_key)
			node:open()
			local groups = {}
			while node:next_group() do
				local grp = {pk_id(node, 'sessions', db)}
				while node:next_pk() do
					grp[#grp+1] = pk_id(node, 'sessions', db)
				end
				groups[#groups+1] = cat(grp, ',')
			end
			node:close()
			assert(cat(groups, '|') == '11,12,13|14|15', cat(groups, '|'))
		end)
	end)
end

function test.pk_filter_exec()
	with_db('pk_filter_exec', function(db)
		db:atomic('r', function()
			local function pks(node)
				return collect_pks(node, 'users', db)
			end
			-- keep users with id <= 3 using get_pk in the predicate
			local t = pks(db:pk_filter(
				db:pk_range('users'),
				function(node)
					local ok = node:pk('users')
					return ok and pk_id(node, 'users', db) <= 3
				end))
			assert(cat(t, ',') == '1,2,3', S(t))
			-- always-true: all active users pass through unchanged
			t = pks(db:pk_filter(
				db:pk_seek('users/status', 'active'),
				function() return true end))
			assert(cat(t, ',') == '1,2,4', S(t))
			-- always-false: empty result
			t = pks(db:pk_filter(
				db:pk_range('users'),
				function() return false end))
			assert(#t == 0, S(t))
		end)
	end)
end

function test.pk_project_exec()
	with_db('pk_project_exec', function(db)
		db:atomic('r', function()
			local user_schema    = db:table_schema('users')
			local session_schema = db:table_schema('sessions')
			-- project 'users': one entry per (user,session) pair; user 1 repeats 3 times
			local t = collect_pks(
				db:pk_project(
					db:merge_join(db:pk_range('users'), db:pk_range('sessions/user_id')),
					'users'),
				'users', user_schema)
			assert(cat(t, ',') == '1,1,1,2,4', S(t))
			-- project 'sessions': session PKs in session-PK order
			t = collect_pks(
				db:pk_project(
					db:merge_join(db:pk_range('users'), db:pk_range('sessions/user_id')),
					'sessions'),
				'sessions', session_schema)
			assert(cat(t, ',') == '11,12,13,14,15', S(t))
			-- left join: projecting 'sessions' skips absent members (users 3 and 5 have none)
			t = collect_pks(
				db:pk_project(
					db:merge_join(db:pk_range('users'), db.left(db:pk_range('sessions/user_id'))),
					'sessions'),
				'sessions', session_schema)
			assert(cat(t, ',') == '11,12,13,14,15', S(t))
			-- error: member not present in input
			assert(not pcall(db.pk_project, db, db:pk_range('users'), 'sessions'))
		end)
	end)
end

function test.pk_and_probe_exec()
	with_db('pk_and_probe_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node)
				return collect_pks(node, 'users', schema)
			end
			-- single probe: score desc (u2,u1,u4,u5,u3), keep only active (1,2,4) -> 2,1,4
			local t = pks(db:pk_and_probe(
				db:pk_range('users/score', {desc=true}),
				{ix='users/status', key='active'}))
			assert(cat(t, ',') == '2,1,4', S(t))
			-- two probes: all users (pk order), keep active (1,2,4) AND score=80 (user 1 only)
			t = pks(db:pk_and_probe(
				db:pk_range('users'),
				{ix='users/status', key='active'},
				{ix='users/score', key=80}))
			assert(cat(t, ',') == '1', S(t))
			-- no match: active users probed against banned key -> empty
			t = pks(db:pk_and_probe(
				db:pk_seek('users/status', 'active'),
				{ix='users/status', key='banned'}))
			assert(#t == 0, S(t))
			-- error: not an index
			assert(not pcall(db.pk_and_probe, db, db:pk_range('users'), {ix='users', key=1}))
			-- error: no probes
			assert(not pcall(db.pk_and_probe, db, db:pk_range('users')))
		end)
	end)
end

function test.select_exec()
	with_db('select_exec', function(db)
		db:atomic('r', function()
			-- base table: read value columns (status, score) via pk_range.
			-- bug: decode_kv prepends key cols (id) before val cols, so select
			-- captures id instead of the requested val col.
			local function collect_recs(node)
				node:open()
				local t = {}
				while node:next_group() do t[#t+1] = node:row() end
				node:close()
				return t
			end
			local recs = collect_recs(db:select(db:pk_range('users'), 'users.status, users.score'))
			assert(#recs == 5, 'expected 5, got '..#recs)
			assert(recs[1]['users.status'] == 'active',
				'user 1 status: expected active, got '..tostring(recs[1]['users.status']))
			assert(recs[1]['users.score'] == 80,
				'user 1 score: expected 80, got '..tostring(recs[1]['users.score']))
			assert(recs[3]['users.status'] == 'banned',
				'user 3 status: expected banned, got '..tostring(recs[3]['users.status']))
			-- index scan: read user_id from sessions/user_id index.
			-- covered read: user_id is in the index key, so no base table seek needed.
			-- bug: same decode_kv issue returns session id instead of user_id.
			recs = collect_recs(db:select(db:pk_range('sessions/user_id'), 'sessions.user_id'))
			-- sessions/user_id order: user 1 (sessions 11,12,13), user 2 (14), user 4 (15)
			assert(#recs == 5, 'expected 5, got '..#recs)
			assert(recs[1]['sessions.user_id'] == 1,
				'session 11 user_id: expected 1, got '..tostring(recs[1]['sessions.user_id']))
			assert(recs[4]['sessions.user_id'] == 2,
				'session 14 user_id: expected 2, got '..tostring(recs[4]['sessions.user_id']))
			assert(recs[5]['sessions.user_id'] == 4,
				'session 15 user_id: expected 4, got '..tostring(recs[5]['sessions.user_id']))
		end)
	end)
end

------------------------------------------------------------------------------

function test.starts_exec()
	with_db('starts_exec', function(db)
		db:atomic('r', function()
			local function ids(q)
				local t = {}
				for r in q:select{'users.id'}:rows() do t[#t+1] = r['users.id'] end
				sort(t)
				return t
			end

			-- indexed path: status column has users/status index; starts folds to pk_range;
			-- no residual pk_filter is added, so the plan root is the pk_range node directly.
			local plan = db:from'users':starts('status', 'act'):_lower():explain()
			assert(plan.kind == 'pk_range', 'expected pk_range, got '..tostring(plan.kind))

			local t = ids(db:from'users':starts('status', 'act'))
			assert(#t == 3 and t[1] == 1 and t[2] == 2 and t[3] == 4, S(t))

			t = ids(db:from'users':starts('status', 'ban'))
			assert(#t == 2 and t[1] == 3 and t[2] == 5, S(t))

			-- no match
			t = ids(db:from'users':starts('status', 'xyz'))
			assert(#t == 0, S(t))

			-- residual path: no_index forces full scan; mk_pkfn handles starts as a predicate.
			t = ids(db:from'users':starts('status', 'act'):no_index('users'))
			assert(#t == 3 and t[1] == 1 and t[2] == 2 and t[3] == 4, S(t))
		end)
	end)
end

function test.use_counts_exec()
	with_db('use_counts_exec', function(db)
		db:atomic('r', function()
			-- both users/status and users/score score equally (single eq, score=30).
			-- use_counts() opts in to entry-count tie-breaking; with equal counts here
			-- the winner is the same as without it, so we verify results are correct
			-- and the plan uses an index (pk_filter over pk_seek, not a full scan).
			local q = db:from'users':eq('status', 'active'):eq('score', 80):use_counts()
			local plan = q:_lower():explain()
			assert(plan.kind == 'pk_filter', 'expected pk_filter, got '..tostring(plan.kind))
			assert(plan.inputs[1].kind == 'pk_seek', 'expected pk_seek input, got '..tostring(plan.inputs[1].kind))

			local t = {}
			for r in q:select{'users.id'}:rows() do t[#t+1] = r['users.id'] end
			assert(#t == 1 and t[1] == 1, S(t))
		end)
	end)
end

function test.in_query_exec()
	with_db('in_query_exec', function(db)
		db:atomic('r', function()
			local function ids(q)
				local t = {}
				for r in q:select{'users.id'}:rows() do t[#t+1] = r['users.id'] end
				sort(t)
				return t
			end

			-- query-based in_: subquery produces PKs of users with score > 80 (only id=2).
			local t = ids(db:from'users':in_('id', db:from'users':gt('score', 80)))
			assert(#t == 1 and t[1] == 2, S(t))

			-- query-based not_in: exclude banned users (3 and 5) -> active users.
			t = ids(db:from'users':not_in('id', db:from'users':eq('status', 'banned')))
			assert(#t == 3 and t[1] == 1 and t[2] == 2 and t[3] == 4, S(t))

		end)
	end)
end

------------------------------------------------------------------------------

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
