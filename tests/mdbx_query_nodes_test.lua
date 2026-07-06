require'mdbx_query_nodes'

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

local function collect_pks(node, name, schema, params)
	node:open(params)
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

local function build_u32_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id'    , mdbx_type = 'u32', not_null = true},
		{col = 'status', mdbx_type = 'u32', not_null = true},
		{col = 'score' , mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('users', {'status'})
	db:add_index('users', {'score'})

	db:create_table('sessions', {fields = {
		{col = 'id'     , mdbx_type = 'u32', not_null = true},
		{col = 'user_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	db:add_fk{table = 'sessions', cols = {'user_id'},
		ref_table = 'users', ref_cols = {'id'}}

	for _, r in ipairs{
		{id = 1, status = 1, score = 80},
		{id = 2, status = 1, score = 95},
		{id = 3, status = 2, score = 50},
		{id = 4, status = 1, score = 70},
		{id = 5, status = 2, score = 60},
	} do db:insert('users', '{}', r) end

	for _, r in ipairs{
		{id = 11, user_id = 1},
		{id = 12, user_id = 1},
		{id = 13, user_id = 2},
		{id = 14, user_id = 4},
	} do db:insert('sessions', '{}', r) end
	db:commit()
end

local function with_u32_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_u32_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--fixture for pk_join_seek's nullable-FK reencode path: nuser_id is
--nullable, so its index key differs (extra marker byte) from users' own
--not_null pk. narrow index is the fk's own; wide adds started_at.
local function build_nullable_fk_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id', mdbx_type = 'u64', not_null = true},
	}, pk = {'id'}})

	db:create_table('sessions', {fields = {
		{col = 'id'        , mdbx_type = 'u64', not_null = true},
		{col = 'nuser_id'  , mdbx_type = 'u64', not_null = false},
		{col = 'started_at', mdbx_type = 'u64', not_null = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'nuser_id'})
	db:add_index('sessions', {'nuser_id', 'started_at'})
	db:add_fk{table = 'sessions', cols = {'nuser_id'},
		ref_table = 'users', ref_cols = {'id'}}

	db:insert('users', '{}', {id = 1})
	db:insert('users', '{}', {id = 2})
	local sessions = {
		{id = 11, nuser_id = 1, started_at = 100},
		{id = 12, nuser_id = 1, started_at = 200},
		{id = 13, nuser_id = null, started_at = 50},
	}
	for _, r in ipairs(sessions) do db:insert('sessions', '{}', r) end
	db:commit()
end

local function with_nullable_fk_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_nullable_fk_fixture(db)
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
			local e = db:pk_get('users', 'K'):explain()
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
			--missing KEY param name.
			assert(not pcall(db.pk_get, db, 'users'))
		end)
	end)
end

------------------------------------------------------------------------------

function test.pk_seek_exec()
	with_db('pk_seek_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			--seek 'active' -> users 1, 2, 4 in pk-order
			local node = db:pk_seek('users/status', 'S')
			local pks = collect_pks(node, 'users', schema, {S='active'})
			assert(#pks == 3, 'expected 3, got '..#pks)
			assert(pks[1] == 1 and pks[2] == 2 and pks[3] == 4, S(pks))
			--seek missing key -> nil immediately
			local n = db:pk_seek('users/status', 'S')
			n:open({S='missing'})
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
			local node = db:pk_get('users', 'K')
			node:open({K=3})
			assert(node:next_group() == true)
			assert(pk_id(node, 'users', db) == 3)
			--exhausted after one item
			assert(node:next_group() == nil)
			assert(node:pk('users') == nil)
			node:close()
			--missing PK returns nil
			local n = db:pk_get('users', 'K')
			n:open({K=999})
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
				db:pk_prefix('sessions/user_id,started_at', 'P'),
				'sessions', schema, {P=1})
			assert(#pks == 3, 'expected 3 sessions, got '..#pks)
			assert(pks[1] == 11 and pks[2] == 12 and pks[3] == 13, S(pks))
			--prefix user_id=3 -> no sessions (user 3 has none)
			local n = db:pk_prefix('sessions/user_id,started_at', 'P')
			n:open({P=3})
			assert(n:next_group() == nil)
			assert(n:pk('sessions') == nil)
			n:close()
			--missing KEY rejected at construction
			assert(not pcall(db.pk_prefix, db, 'sessions/user_id,started_at'))
		end)
	end)
end

function test.pk_range_partial_prefix_exec()
	with_db('pk_range_partial_prefix_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			local t = pks(db:pk_range('users/status',
				{prefix = 'partial'}, 'P'), {P = 'act'})
			assert(cat(t, ',') == '1,2,4', S(t))

			t = pks(db:pk_range('users/status',
				{prefix = 'partial', desc = true}, 'P'), {P = 'act'})
			assert(cat(t, ',') == '4,2,1', S(t))

			local e = db:pk_range('users/status',
				{prefix = 'partial'}, 'P'):explain()
			assert(e.order[1] == 'users.status asc', e.order[1])

			assert(not pcall(function()
				local n = db:pk_range('users/status', {prefix = 'partial'}, 'P')
				n:open({P = nil})
			end))
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
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			local t = pks(db:merge_join(
				db:pk_range('users'),
				db:pk_seek('users/status', 'S')), {S='active'})
			assert(cat(t, ',') == '1,2,4', S(t))
			t = pks(db:merge_join(
				db:pk_seek('users/status', 'S1'),
				db:pk_seek('users/status', 'S2')), {S1='active', S2='banned'})
			assert(#t == 0, S(t))
			assert(not pcall(db.merge_join, db,
				db:pk_range('users'),
				db:pk_range('users/score', '>=', 'LO', '<=', 'HI')))
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
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			local function eq(a, b)
				if #a ~= #b then return false end
				for i = 1, #a do if a[i] ~= b[i] then return false end end
				return true
			end
			assert(eq(pks(db:pk_range('users/score', '>=', 'LO', '<=', 'HI'), {LO=70, HI=95}), {4,1,2}))
			assert(eq(pks(db:pk_range('users/score', {desc=true}, '>=', 'LO', '<=', 'HI'), {LO=70, HI=95}), {2,1,4}))
			assert(eq(pks(db:pk_range('users/score', '>', 'LO', '<=', 'HI'), {LO=70, HI=95}), {1,2}))
			assert(eq(pks(db:pk_range('users/score', '>=', 'LO', '<', 'HI'), {LO=70, HI=95}), {4,1}))
			assert(eq(pks(db:pk_range('users/score')), {3,5,4,1,2}))
			assert(eq(pks(db:pk_range('users/score', {desc=true})), {2,1,4,5,3}))
			assert(eq(pks(db:pk_range('users/score', '>=', 'LO', '<=', 'HI'), {LO=null, HI=null}), {}))
			assert(eq(pks(db:pk_range('users/score', '>', 'LO'), {LO=null}), {3,5,4,1,2}))
			assert(eq(pks(db:pk_range('users/score', '>=', 'LO', '<=', 'HI'),
				{LO=95, HI=70}), {}))
		end)
	end)
end

function test.merge_union_or_exec()
	with_db('merge_union_or_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			--active OR banned = all 5 users in pk order
			local t = pks(db:merge_union(
				db:pk_seek('users/status', 'S1'),
				db:pk_seek('users/status', 'S2')), {S1='active', S2='banned'})
			assert(cat(t, ',') == '1,2,3,4,5', S(t))
			--dedup: active OR active = just active
			t = pks(db:merge_union(
				db:pk_seek('users/status', 'S'),
				db:pk_seek('users/status', 'S')), {S='active'})
			assert(cat(t, ',') == '1,2,4', S(t))
			--one side empty: active OR missing = just active
			t = pks(db:merge_union(
				db:pk_seek('users/status', 'S1'),
				db:pk_seek('users/status', 'S2')), {S1='active', S2='missing'})
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.merge_except_exec()
	with_db('merge_except_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			--all users except active = banned {3,5}
			local t = pks(db:merge_except(
				db:pk_range('users'),
				db:pk_seek('users/status', 'S')), {S='active'})
			assert(cat(t, ',') == '3,5', S(t))
			--active except banned = active {1,2,4}
			t = pks(db:merge_except(
				db:pk_seek('users/status', 'S1'),
				db:pk_seek('users/status', 'S2')), {S1='active', S2='banned'})
			assert(cat(t, ',') == '1,2,4', S(t))
			--except self = empty
			t = pks(db:merge_except(
				db:pk_seek('users/status', 'S'),
				db:pk_seek('users/status', 'S')), {S='active'})
			assert(#t == 0, S(t))
			--except empty = unchanged
			t = pks(db:merge_except(
				db:pk_seek('users/status', 'S1'),
				db:pk_seek('users/status', 'S2')), {S1='active', S2='missing'})
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.pk_join_seek_exec()
	with_db('pk_join_seek_exec', function(db)
		db:atomic('r', function()
			-- active users (1,2,4) + their sessions; driver order preserved
			local node = db:pk_join_seek(db:pk_seek('users/status', 'S'), 'sessions/user_id')
			node:open({S='active'})
			local tuples = {}
			while node:next_group() do
				tuples[#tuples+1] = pk_id(node, 'users', db)..':'..pk_id(node, 'sessions', db)
			end
			node:close()
			-- user 1 has sessions 11,12,13; user 2 has 14; user 4 has 15
			assert(cat(tuples, ',') == '1:11,1:12,1:13,2:14,4:15', S(tuples))
			-- user with no children: user 3 has no sessions
			local node2 = db:pk_join_seek(db:pk_get('users', 'K'), 'sessions/user_id')
			node2:open({K=3})
			assert(node2:next_group() == nil)
			node2:close()
			-- error: driver member must match parent table
			assert(not pcall(db.pk_join_seek, db, db:pk_range('sessions'), 'sessions/user_id'))
			-- error: not a FK index
			assert(not pcall(db.pk_join_seek, db, db:pk_range('users'), 'users/status'))
		end)
	end)
end

function test.pk_join_seek_nullable_fk_exec()
	with_nullable_fk_db('pk_join_seek_nullable_fk_exec', function(db)
		db:atomic('r', function()
			-- narrow index on the nullable FK column itself
			local node = db:pk_join_seek(db:pk_range('users'), 'sessions/nuser_id')
			node:open()
			local tuples = {}
			while node:next_group() do
				tuples[#tuples+1] = pk_id(node, 'users', db)..':'..pk_id(node, 'sessions', db)
			end
			node:close()
			-- session 13 (nuser_id null) has no parent and is excluded
			assert(cat(tuples, ',') == '1:11,1:12', S(tuples))

			-- wide index: nuser_id plus a trailing, non-FK column
			local node2 = db:pk_join_seek(db:pk_range('users'), 'sessions/nuser_id,started_at')
			node2:open()
			local tuples2 = {}
			while node2:next_group() do
				tuples2[#tuples2+1] = pk_id(node2, 'users', db)..':'..pk_id(node2, 'sessions', db)
			end
			node2:close()
			assert(cat(tuples2, ',') == '1:11,1:12', S(tuples2))
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
				db:pk_prefix('sessions/user_id,started_at', 'P'),
				'sessions/user_id')
			node2:open({P=1})
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
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			-- 'in': score >= 70 (ix-order: u4,u1,u2) intersect active (u1,u2,u4) = u4,u1,u2
			local t = pks(db:pk_hash_filter(
				db:pk_range('users/score', '>=', 'LO'),
				db:pk_seek('users/status', 'S'),
				'in'), {LO=70, S='active'})
			assert(cat(t, ',') == '4,1,2', S(t))
			-- 'not_in': all scores (ix-order: u3,u5,u4,u1,u2) minus active (u1,u2,u4) = u3,u5
			t = pks(db:pk_hash_filter(
				db:pk_range('users/score'),
				db:pk_seek('users/status', 'S'),
				'not_in'), {S='active'})
			assert(cat(t, ',') == '3,5', S(t))
			-- 'in' with empty set: nothing passes
			t = pks(db:pk_hash_filter(
				db:pk_range('users/score'),
				db:pk_seek('users/status', 'S'),
				'in'), {S='missing'})
			assert(#t == 0, S(t))
			-- 'not_in' with full set: nothing passes
			t = pks(db:pk_hash_filter(
				db:pk_seek('users/status', 'S'),
				db:pk_range('users'),
				'not_in'), {S='active'})
			assert(#t == 0, S(t))
		end)
	end)
end

function test.pk_hash_filter_u32_exec()
	with_u32_db('pk_hash_filter_u32_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			local t = pks(db:pk_hash_filter(
				db:pk_range('users/score', '>=', 'LO'),
				db:pk_seek('users/status', 'S'),
				'in'), {LO=70, S=1})
			assert(cat(t, ',') == '4,1,2', S(t))

			t = pks(db:pk_hash_filter(
				db:pk_range('users/score'),
				db:pk_seek('users/status', 'S'),
				'not_in'), {S=1})
			assert(cat(t, ',') == '3,5', S(t))

			t = pks(db:pk_hash_filter(
				db:pk_range('users/score'),
				db:pk_seek('users/status', 'S'),
				'in'), {S=9})
			assert(#t == 0, S(t))

			t = pks(db:pk_hash_filter(
				db:pk_range('users/score'),
				db:pk_seek('users/status', 'S'),
				'not_in'), {S=9})
			assert(cat(t, ',') == '3,5,4,1,2', S(t))

			t = pks(db:pk_hash_filter(
				db:pk_seek('users/status', 'S'),
				db:pk_range('users'),
				'not_in'), {S=1})
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
			-- factory receives outer_fn; inner params use plain values (not wrapped).
			local function factory(outer)
				return db:pk_seek('sessions/user_id', 'UID'), {UID = outer('users.id')[1]}
			end
			local function run(driver, params)
				local node = db:nested_join(driver, factory)
				node:open(params)
				local tuples = {}
				while node:next_group() do
					tuples[#tuples+1] = pk_id(node, 'users', db)..':'..pk_id(node, 'sessions', db)
				end
				node:close()
				return tuples
			end
			-- active users (1,2,4) x their sessions
			local t = run(db:pk_seek('users/status', 'S'), {S='active'})
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,4:15', S(t))
			-- all users: users 3 and 5 have no sessions and are skipped
			t = run(db:pk_range('users'))
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,4:15', S(t))
			-- members extended with inner members after first iteration
			local node = db:nested_join(db:pk_seek('users/status', 'S'), factory)
			node:open({S='active'})
			node:next_group()
			assert(#node.members == 2 and node.members[1] == 'users' and node.members[2] == 'sessions',
				S(node.members))
			node:close()
		end)
	end)
end

function test.nested_join_left_exec()
	with_db('nested_join_left_exec', function(db)
		db:atomic('r', function()
			local function factory(outer)
				return db:pk_seek('sessions/user_id', 'UID'), {UID = outer('users.id')[1]}
			end
			-- left join: users 3 and 5 (no sessions) are still emitted, with the
			-- sessions member absent.
			local node = db:nested_join(db:pk_range('users'), factory, {left = true})
			node:open()
			local t = {}
			while node:next_group() do
				local uid = pk_id(node, 'users', db)
				local ok = node:pk('sessions')
				t[#t+1] = ok and uid..':'..pk_id(node, 'sessions', db) or uid..':none'
			end
			node:close()
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,3:none,4:15,5:none', S(t))
		end)
	end)
end

function test.anti_join_exec()
	with_db('anti_join_exec', function(db)
		db:atomic('r', function()
			local function pks(node, p)
				return collect_pks(node, 'users', db, p)
			end
			-- keep users with NO sessions (users 3 and 5 have none)
			local function factory(outer)
				return db:pk_seek('sessions/user_id', 'UID'), {UID = outer('users.id')[1]}
			end
			local t = pks(db:anti_join(db:pk_range('users'), factory))
			assert(cat(t, ',') == '3,5', S(t))
			-- inner always empty: all outer items pass
			local function empty_factory(_)
				return db:pk_seek('sessions/user_id', 'UID'), {UID=999}
			end
			t = pks(db:anti_join(db:pk_seek('users/status', 'S'), empty_factory), {S='active'})
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.semi_join_exec()
	with_db('semi_join_exec', function(db)
		db:atomic('r', function()
			local function pks(node, p)
				return collect_pks(node, 'users', db, p)
			end
			-- keep users that have at least one session (users 1,2,4 do; 3,5 don't)
			local function factory(outer)
				return db:pk_seek('sessions/user_id', 'UID'), {UID = outer('users.id')[1]}
			end
			local t = pks(db:semi_join(db:pk_range('users'), factory))
			assert(cat(t, ',') == '1,2,4', S(t))
			-- inner always empty: no outer items pass
			local function empty_factory(_)
				return db:pk_seek('sessions/user_id', 'UID'), {UID=999}
			end
			t = pks(db:semi_join(db:pk_range('users'), empty_factory))
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
			local function pks(node, p)
				return collect_pks(node, 'users', db, p)
			end
			-- keep users with id <= 3 using pk in the predicate
			local t = pks(db:pk_filter(db:pk_range('users'), function(node)
				local ok = node:pk('users')
				return ok and pk_id(node, 'users', db) <= 3
			end))
			assert(cat(t, ',') == '1,2,3', S(t))
			-- always-true: all active users pass through unchanged
			t = pks(db:pk_filter(db:pk_seek('users/status', 'S'), function() return true end),
				{S='active'})
			assert(cat(t, ',') == '1,2,4', S(t))
			-- always-false: empty result
			t = pks(db:pk_filter(db:pk_range('users'), function() return false end))
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
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			-- single probe: score desc (u2,u1,u4,u5,u3), keep only active (1,2,4) -> 2,1,4
			local t = pks(db:pk_and_probe(
				db:pk_range('users/score', {desc=true}),
				{ix='users/status', keys={'S1'}}), {S1='active'})
			assert(cat(t, ',') == '2,1,4', S(t))
			-- two probes: all users (pk order), keep active (1,2,4) AND score=80 (user 1 only)
			t = pks(db:pk_and_probe(
				db:pk_range('users'),
				{ix='users/status', keys={'S1'}},
				{ix='users/score', keys={'S2'}}), {S1='active', S2=80})
			assert(cat(t, ',') == '1', S(t))
			-- no match: active users probed against banned key -> empty
			t = pks(db:pk_and_probe(
				db:pk_seek('users/status', 'S1'),
				{ix='users/status', keys={'S2'}}), {S1='active', S2='banned'})
			assert(#t == 0, S(t))
			-- error: not an index
			assert(not pcall(db.pk_and_probe, db, db:pk_range('users'), {ix='users', keys={'K'}}))
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

function test.pk_group_first_exec()
	with_db('pk_group_first_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			-- no prefix: one pk per distinct status value.
			-- users/status index order: 'active'(1,2,4) then 'banned'(3,5);
			-- NEXT_NODUP yields first dup per distinct key -> pks 1 and 3.
			local t = pks(db:pk_group_first('users/status'))
			assert(#t == 2, 'expected 2, got '..#t)
			assert(t[1] == 1 and t[2] == 3, S(t))

			-- with prefix: user_id=1 on 2-col sessions/user_id,started_at index.
			-- each (user_id,started_at) pair is unique, so NEXT_NODUP yields all
			-- three sessions for user 1 in started_at order (11,12,13).
			local sschema = db:table_schema('sessions')
			local ts = collect_pks(
				db:pk_group_first('sessions/user_id,started_at', 'U'),
				'sessions', sschema, {U=1})
			assert(#ts == 3 and ts[1]==11 and ts[2]==12 and ts[3]==13, S(ts))

			-- prefix on a single-col index violates nk < nkey; errors on open.
			assert(not pcall(function()
				local n = db:pk_group_first('users/status', 'K')
				n:open({K='active'})
			end))
		end)
	end)
end

function test.pk_sort_exec()
	with_db('pk_sort_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			-- score-desc index order: 2,1,4,5,3; pk_sort reorders to 1,2,3,4,5.
			local t = pks(db:pk_sort(db:pk_range('users/score', {desc=true})))
			assert(cat(t, ',') == '1,2,3,4,5', S(t))

			-- dedup: union_all of two identical active streams yields 1,1,2,2,4,4;
			-- pk_sort sorts and removes adjacent equal PKs -> 1,2,4.
			t = pks(db:pk_sort(db:merge_union('union_all',
				db:pk_seek('users/status', 'S'),
				db:pk_seek('users/status', 'S'))), {S='active'})
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.pk_sort_u32_exec()
	with_u32_db('pk_sort_u32_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			-- u32 fast path: C radix sort; score-desc 2,1,4,5,3 -> sorted 1,2,3,4,5.
			local t = pks(db:pk_sort(db:pk_range('users/score', {desc=true})))
			assert(cat(t, ',') == '1,2,3,4,5', S(t))

			-- u32 dedup: union_all of two status=1 streams -> 1,1,2,2,4,4
			-- -> pk_sort radix-sorts then deduplicates -> 1,2,4.
			t = pks(db:pk_sort(db:merge_union('union_all',
				db:pk_seek('users/status', 'S'),
				db:pk_seek('users/status', 'S'))), {S=1})
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.merge_union_modes_exec()
	with_db('merge_union_modes_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function pks(node, p)
				return collect_pks(node, 'users', schema, p)
			end
			-- union_all: only the yielding input is advanced; no dedup.
			-- two identical active streams -> 1,1,2,2,4,4 (interleaved merge order).
			local t = pks(db:merge_union('union_all',
				db:pk_seek('users/status', 'S'),
				db:pk_seek('users/status', 'S')), {S='active'})
			assert(cat(t, ',') == '1,1,2,2,4,4', S(t))

			-- full: dedup like union; all equal-key inputs are advanced together.
			-- non-overlapping active+banned -> 1,2,3,4,5 same as union.
			t = pks(db:merge_union('full',
				db:pk_seek('users/status', 'S1'),
				db:pk_seek('users/status', 'S2')), {S1='active', S2='banned'})
			assert(cat(t, ',') == '1,2,3,4,5', S(t))

			-- full with overlap: both inputs at same key are advanced; deduped output.
			t = pks(db:merge_union('full',
				db:pk_seek('users/status', 'S'),
				db:pk_seek('users/status', 'S')), {S='active'})
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.pk_parent_lookup_left_exec()
	with_db('pk_parent_lookup_left_exec', function(db)
		-- session 99 for user 3 (valid FK at insert).
		db:begin'w'
		db:insert('sessions', '{}', {id=99, user_id=3, started_at=9999})
		db:commit()
		-- capture user 3's raw base-table key before deleting it.
		local u3_key_str
		db:atomic('r', function()
			local n = db:pk_get('users', 'K')
			n:open({K=3})
			n:next_group()
			local _, p, sz = n:pk('users')
			u3_key_str = ffi.string(p, sz)
			n:close()
		end)
		-- delete user 3 from the base table only; creates an orphan session 99.
		-- deleting only the base row (not indexes) is safe here because
		-- pk_parent_lookup seeks the base table, not the FK index.
		db:begin'w'
		db:try_del_raw('users', ffi.cast('const char*', u3_key_str), #u3_key_str)
		db:commit()
		db:atomic('r', function()
			-- inner join: session 99 (user_id=3, base row deleted) is skipped.
			local node = db:pk_parent_lookup(db:pk_range('sessions'), 'sessions/user_id')
			node:open()
			local inner = {}
			while node:next_group() do
				inner[#inner+1] = pk_id(node, 'sessions', db)
			end
			node:close()
			assert(cat(inner, ',') == '11,12,13,14,15', S(inner))

			-- left join: session 99 is emitted; pk('users') returns nil (no parent).
			local node2 = db:pk_parent_lookup(
				db:pk_range('sessions'), 'sessions/user_id', {left=true})
			node2:open()
			local left_t = {}
			while node2:next_group() do
				local sid = pk_id(node2, 'sessions', db)
				local ok = node2:pk('users')
				left_t[#left_t+1] = ok and sid..':has_parent' or sid..':no_parent'
			end
			node2:close()
			-- all 6 sessions emitted; session 99 has no parent.
			assert(#left_t == 6, 'expected 6, got '..#left_t)
			assert(left_t[6] == '99:no_parent', left_t[6])
		end)
	end)
end

function test.value_filter_exec()
	with_db('value_filter_exec', function(db)
		db:atomic('r', function()
			local function collect_recs(node)
				node:open()
				local t = {}
				while node:next_group() do t[#t+1] = node:row() end
				node:close()
				return t
			end
			-- keep users with score > 80; only user 2 (score=95) qualifies.
			local t = collect_recs(db:value_filter(
				db:select(db:pk_range('users'), 'users.status, users.score'),
				function(rec) return (rec['users.score'] or 0) > 80 end))
			assert(#t == 1 and t[1]['users.score'] == 95, S(imap(t, function(r)
				return tostring(r['users.score']) end)))

			-- always-true: all 5 users.
			t = collect_recs(db:value_filter(
				db:select(db:pk_range('users'), 'users.status, users.score'),
				function() return true end))
			assert(#t == 5, 'expected 5, got '..#t)

			-- always-false: empty.
			t = collect_recs(db:value_filter(
				db:select(db:pk_range('users'), 'users.status, users.score'),
				function() return false end))
			assert(#t == 0, 'expected 0, got '..#t)
		end)
	end)
end

function test.stream_distinct_exec()
	with_db('stream_distinct_exec', function(db)
		db:atomic('r', function()
			local function collect_recs(node)
				node:open()
				local t = {}
				while node:next_group() do t[#t+1] = node:row() end
				node:close()
				return t
			end
			-- input in status-group order (pk_range over status index):
			-- active(1),active(2),active(4),banned(3),banned(5)
			-- -> stream_distinct by status -> 2 records.
			local t = collect_recs(db:stream_distinct(
				db:select(db:pk_range('users/status'), 'users.status'),
				function(rec) return {rec['users.status']} end))
			assert(#t == 2, 'expected 2, got '..#t)
			assert(t[1]['users.status'] == 'active', tostring(t[1]['users.status']))
			assert(t[2]['users.status'] == 'banned', tostring(t[2]['users.status']))
		end)
	end)
end

function test.hash_distinct_exec()
	with_db('hash_distinct_exec', function(db)
		db:atomic('r', function()
			local function collect_recs(node)
				node:open()
				local t = {}
				while node:next_group() do t[#t+1] = node:row() end
				node:close()
				return t
			end
			-- score-asc order: 3(50,banned),5(60,banned),4(70,active),1(80,active),2(95,active)
			-- statuses interleaved: banned,banned,active,active,active
			-- hash_distinct deduplicates regardless of adjacency -> banned,active (first-seen).
			local t = collect_recs(db:hash_distinct(
				db:select(db:pk_range('users/score'), 'users.status'),
				function(rec) return {rec['users.status']} end))
			assert(#t == 2, 'expected 2, got '..#t)
			assert(t[1]['users.status'] == 'banned', tostring(t[1]['users.status']))
			assert(t[2]['users.status'] == 'active', tostring(t[2]['users.status']))

			-- multi-col key: (status, score) -> 5 distinct pairs -> 5 records.
			t = collect_recs(db:hash_distinct(
				db:select(db:pk_range('users/score'), 'users.status, users.score'),
				function(rec)
					return {rec['users.status'], rec['users.score']}
				end))
			assert(#t == 5, 'expected 5, got '..#t)
		end)
	end)
end

function test.value_sort_value_exec()
	with_db('value_sort_value_exec', function(db)
		db:atomic('r', function()
			local function collect_recs(node)
				node:open()
				local t = {}
				while node:next_group() do t[#t+1] = node:row() end
				node:close()
				return t
			end
			local sel = function()
				return db:select(db:pk_range('users'), 'users.status, users.score')
			end

			-- sort by score desc: 2(95),1(80),4(70),5(60),3(50).
			local t = collect_recs(db:value_sort(sel(), 'users.score desc'))
			assert(#t == 5, S(t))
			assert(t[1]['users.score'] == 95 and t[5]['users.score'] == 50,
				tostring(t[1]['users.score'])..','..tostring(t[5]['users.score']))

			-- sort by status asc then score desc:
			-- active(2,95), active(1,80), active(4,70), banned(5,60), banned(3,50).
			t = collect_recs(db:value_sort(sel(), 'users.status asc, users.score desc'))
			assert(t[1]['users.score'] == 95 and t[1]['users.status'] == 'active',
				tostring(t[1]['users.status'])..':'..tostring(t[1]['users.score']))
			assert(t[4]['users.score'] == 60 and t[4]['users.status'] == 'banned',
				tostring(t[4]['users.status'])..':'..tostring(t[4]['users.score']))

			-- sort by a joined column that was not selected. The output row
			-- stays narrow; value_sort reads users.score through select's input.
			t = collect_recs(db:value_sort(
				db:select(
					db:pk_parent_lookup(
						db:pk_range('sessions'), 'sessions/user_id'),
					'sessions.id sid'),
				'users.score desc, sessions.id asc'))
			assert(#t == 5, S(t))
			assert(tonumber(t[1].sid) == 14 and tonumber(t[5].sid) == 15,
				tostring(t[1].sid)..','..tostring(t[5].sid))
			assert(t[1]['users.score'] == nil, 'hidden sort column leaked')
		end)
	end)
end

function test.value_sort_pk_exec()
	with_db('value_sort_pk_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			-- pk path: pk_range(users) in pk order (1..5);
			-- value_sort by score asc reorders to 3(50),5(60),4(70),1(80),2(95).
			local t = collect_pks(
				db:value_sort(db:pk_range('users'), 'users.score asc'),
				'users', schema)
			assert(cat(t, ',') == '3,5,4,1,2', S(t))

			-- score desc: 2(95),1(80),4(70),5(60),3(50).
			t = collect_pks(
				db:value_sort(db:pk_range('users'), 'users.score desc'),
				'users', schema)
			assert(cat(t, ',') == '2,1,4,5,3', S(t))
		end)
	end)
end

function test.stream_aggregate_exec()
	with_db('stream_aggregate_exec', function(db)
		db:atomic('r', function()
			local function collect_recs(node)
				node:open()
				local t = {}
				while node:next_group() do t[#t+1] = node:row() end
				node:close()
				return t
			end

			-- grand total: nil key_fn, count + sum over all users.
			-- scores: 80+95+50+70+60 = 355.
			local t = collect_recs(db:stream_aggregate(
				db:pk_range('users'), nil, {
					{name='cnt', op='count'},
					{name='tot', op='sum', member='users', col='score'},
				}))
			assert(#t == 1, 'expected 1 row, got '..#t)
			assert(t[1].cnt == 5, 'count: expected 5, got '..tostring(t[1].cnt))
			assert(t[1].tot == 355, 'sum: expected 355, got '..tostring(t[1].tot))

			-- grouped: pk_range('users/status') groups by status; key_fn reads status
			-- from the positioned index node; next_pk() advances within group.
			-- active: 3 users, score sum=245; banned: 2 users, score sum=110.
			t = collect_recs(db:stream_aggregate(
				db:pk_range('users/status'),
				function(input) return {input:col('users', 'status')} end,
				{
					{name='status', op='key', part=1},
					{name='cnt', op='count'},
					{name='tot', op='sum', member='users', col='score'},
				}))
			assert(#t == 2, 'expected 2 groups, got '..#t)
			assert(t[1].status == 'active' and t[1].cnt == 3 and t[1].tot == 245,
				S(t[1]))
			assert(t[2].status == 'banned' and t[2].cnt == 2 and t[2].tot == 110,
				S(t[2]))
		end)
	end)
end

function test.hash_aggregate_exec()
	with_db('hash_aggregate_exec', function(db)
		db:atomic('r', function()
			local function collect_recs(node)
				node:open()
				local t = {}
				while node:next_group() do t[#t+1] = node:row() end
				node:close()
				return t
			end

			-- grand total: nil key_fn over a value stream.
			local t = collect_recs(db:hash_aggregate(
				db:select(db:pk_range('users'), 'users.status, users.score'),
				nil,
				{{name='cnt', op='count'}}))
			assert(#t == 1 and t[1].cnt == 5, 'expected 1 row with cnt=5')

			-- grouped by status: any-order input; active->3, banned->2.
			-- input in score-asc order so statuses are not pre-grouped.
			t = collect_recs(db:hash_aggregate(
				db:select(db:pk_range('users/score'), 'users.status, users.score'),
				function(rec) return {rec['users.status']} end,
				{
					{name='status', op='key',   part=1},
					{name='cnt',    op='count'},
					{name='tot',    op='sum',   input='users.score'},
				}))
			assert(#t == 2, 'expected 2 groups, got '..#t)
			-- hash_aggregate preserves first-seen insertion order;
			-- score-asc yields banned first (score 50,60), then active (70,80,95).
			assert(t[1].status == 'banned' and t[1].cnt == 2, S(t[1]))
			assert(t[2].status == 'active' and t[2].cnt == 3, S(t[2]))
		end)
	end)
end

function test.value_concat_exec()
	with_db('value_concat_exec', function(db)
		db:atomic('r', function()
			-- active (1,2,4 in pk_seek order) then banned (3,5 in pk_seek order).
			local node = db:value_concat(
				db:select(db:pk_seek('users/status', 'S1'), 'users.status'),
				db:select(db:pk_seek('users/status', 'S2'), 'users.status'))
			node:open({S1='active', S2='banned'})
			local recs = {}
			while node:next_group() do recs[#recs+1] = node:row() end
			node:close()
			-- active users appear before banned; 5 records total.
			assert(#recs == 5, 'expected 5, got '..#recs)
			assert(recs[1]['users.status'] == 'active', tostring(recs[1]['users.status']))
			assert(recs[4]['users.status'] == 'banned', tostring(recs[4]['users.status']))
		end)
	end)
end

function test.union_distinct_exec()
	with_db('union_distinct_exec', function(db)
		db:atomic('r', function()
			-- first input: active users (3 rows, all status='active')
			-- second input: banned users (2 rows, all status='banned')
			-- union_distinct deduplicates by all field values;
			-- first-seen wins -> 'active' then 'banned'.
			local node = db:union_distinct(
				db:select(db:pk_seek('users/status', 'S1'), 'users.status'),
				db:select(db:pk_seek('users/status', 'S2'), 'users.status'))
			node:open({S1='active', S2='banned'})
			local t = {}
			while node:next_group() do t[#t+1] = node:row()['users.status'] end
			node:close()
			assert(#t == 2, 'expected 2, got '..#t)
			assert(t[1] == 'active' and t[2] == 'banned', S(t))

			-- overlap: both inputs select same status -> only one record.
			local node2 = db:union_distinct(
				db:select(db:pk_seek('users/status', 'S'), 'users.status'),
				db:select(db:pk_seek('users/status', 'S'), 'users.status'))
			node2:open({S='active'})
			local t2 = {}
			while node2:next_group() do t2[#t2+1] = node2:row()['users.status'] end
			node2:close()
			assert(#t2 == 1 and t2[1] == 'active', S(t2))
		end)
	end)
end

function test.select_fn_exec()
	with_db('select_fn_exec', function(db)
		db:atomic('r', function()
			-- fn column: doubled_score is 2x the score value.
			-- also test mixing fn cols with regular decoded cols.
			local node = db:select(db:pk_range('users'), {
				'users.status',
				{name='doubled_score', fn=function(n)
					return (n:col('users', 'score') or 0) * 2
				end},
			})
			node:open()
			local recs = {}
			while node:next_group() do recs[#recs+1] = node:row() end
			node:close()
			assert(#recs == 5, 'expected 5, got '..#recs)
			-- user 1 has score=80; doubled = 160.
			assert(recs[1].doubled_score == 160,
				'user 1 doubled: expected 160, got '..tostring(recs[1].doubled_score))
			-- user 3 has score=50; doubled = 100.
			assert(recs[3].doubled_score == 100,
				'user 3 doubled: expected 100, got '..tostring(recs[3].doubled_score))
			assert(recs[1]['users.status'] == 'active',
				'user 1 status: got '..tostring(recs[1]['users.status']))
		end)
	end)
end

------------------------------------------------------------------------------

local name = ...
if name == 'mdbx_query_nodes_test' then name = nil end
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
