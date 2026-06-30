require'mdbx_query_builder'

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
if name == 'mdbx_query_builder_test' then name = nil end
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
