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
	local ok, p, sz = node:get_pk(name)
	assert(ok, 'expected current pk')
	return p, sz
end

local function collect_pks(node, name, schema)
	node:open()
	local t = {}
	while node:next_group() do
		repeat
			local p, sz = get_pk(node, name)
			t[#t+1] = tonumber(schema.decode_int_key(p, sz))
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
			assert(n:get_pk('users') == nil)
			n:close()
		end)
	end)
end

function test.pk_get_exec()
	with_db('pk_get_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			--existing PK returns it
			local node = db:pk_get('users', 3)
			node:open()
			assert(node:next_group() == true)
			local p, sz = get_pk(node, 'users')
			assert(tonumber(schema.decode_int_key(p, sz)) == 3)
			--exhausted after one item
			assert(node:next_group() == nil)
			assert(node:get_pk('users') == nil)
			node:close()
			--missing PK returns nil
			local n = db:pk_get('users', 999)
			n:open()
			assert(n:next_group() == nil)
			assert(n:get_pk('users') == nil)
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
			assert(n:get_pk('sessions') == nil)
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
			local user_schema = db:table_schema('users')
			local session_schema = db:table_schema('sessions')
			local function decode_user(p, sz)
				return tonumber(user_schema.decode_int_key(p, sz))
			end
			local function decode_session(p, sz)
				return tonumber(session_schema.decode_int_key(p, sz))
			end
			local node = db:merge_join(
				db:pk_range('users'),
				db:pk_range('sessions/user_id'))
			node:open()
			local tuples = {}
			while node:next() do
				local up, up_sz = get_pk(node, 'users')
				local sp, sp_sz = get_pk(node, 'sessions')
				tuples[#tuples+1] = decode_user(up, up_sz)..':'..decode_session(sp, sp_sz)
			end
			node:close()
			assert(cat(tuples, ',') == '1:11,1:12,1:13,2:14,4:15', S(tuples))

			local left = db:merge_join(
				db:pk_range('users'),
				db.left(db:pk_range('sessions/user_id')))
			left:open()
			local missing = {}
			while left:next() do
				local up, up_sz = get_pk(left, 'users')
				if not left:get_pk('sessions') then
					missing[#missing+1] = decode_user(up, up_sz)
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
			local event_schema = db:table_schema('events')
			local function decode_event(p, sz)
				return tonumber(event_schema.decode_int_key(p, sz))
			end
			--self-join on events/kind: cross-product of event PKs per kind group.
			--'click':{22} x {22} = 1 pair; 'open':{21,23} x {21,23} = 4 pairs.
			local node = db:merge_join(
				db:pk_range('events/kind'),
				db:pk_range('events/kind'))
			node:open()
			local lefts = {}
			while node:next() do
				local p, sz = get_pk(node, 'events')
				lefts[#lefts+1] = decode_event(p, sz)
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
