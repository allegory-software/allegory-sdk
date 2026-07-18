require'mdbx_query2'

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

local function pk_id(node, name, db)
	local p, sz = get_pk(node, name)
	return decode_pk(db:table_schema(name), p, sz)
end

local function collect_pks(node, name, db, params)
	node:reset(params)
	local t = {}
	while node:next_group() do
		repeat
			t[#t+1] = pk_id(node, name, db)
		until not node:next_pk()
	end
	node:close()
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

------------------------------------------------------------------------------
--compile_step: builds a real pk_scan/pk_join_seek node from a query
--compiled through mdbx_query2.lua's actual builder + compile() pipeline,
--not a hand-built plan -- exercises compile_getter/compile_plan/
--compile_step end to end.

--q.eq() on the table's own pk column: compiles to an 'exact' plan on the
--base table, bound value read through q.param().
function test.exact_via_param_exec()
	with_db('exact_via_param_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where(q.eq(q.col('users.id'), q.param('ID')))
				:select'users.id id'
				:prepare()
			local params = {}
			local node = compile_step(db, rel, params)
			params.ID = 3
			local pks = collect_pks(node, 'users', db, params)
			assert(cat(pks, ',') == '3', cat(pks, ','))
			--same node, same shared params table, different value: the
			--getter must read the table's current contents, not a
			--snapshot taken when the node was built.
			params.ID = 1
			pks = collect_pks(node, 'users', db, params)
			assert(cat(pks, ',') == '1', cat(pks, ','))
			--missing id -> no rows.
			params.ID = 999
			pks = collect_pks(node, 'users', db, params)
			assert(#pks == 0, cat(pks, ','))
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
			local node = compile_step(db, rel, params)
			local pks = collect_pks(node, 'users', db, params)
			assert(cat(pks, ',') == '4,1,2', cat(pks, ','))
		end)
	end)
end

--q.eq() against a bare literal (no q.param() at all): compiles to an
--'exact' plan on the status index, bound value is a plain constant
--getter.
function test.exact_literal_exec()
	with_db('exact_literal_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where(q.eq(q.col('users.status'), 'active'))
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel, {})
			local pks = collect_pks(node, 'users', db)
			assert(cat(pks, ',') == '1,2,4', cat(pks, ','))
		end)
	end)
end

--an inner join on the FK: compiles rel.access[2] as an index seek on
--sessions/user_id, so compile_step wires it up as
--pk_join_seek(base_node, plan.schema) instead of a getter-driven
--pk_scan.
function test.inner_join_exec()
	with_db('inner_join_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:join('sessions',
					q.eq(q.col('sessions.user_id'), q.col('users.id')))
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel, {})
			node:reset()
			local t = {}
			while node:next_item() do
				local u = pk_id(node, 'users', db)
				local s = pk_id(node, 'sessions', db)
				t[#t+1] = u..':'..s
			end
			node:close()
			--users 3 and 5 have no sessions -- inner join drops them.
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,4:15', cat(t, ','))
		end)
	end)
end

--a left join on the FK: same plan shape as the inner join, but
--step.join.op == 'left' -> compile_step passes {left = true} into
--pk_join_seek, so a parent with no matching child still emits once,
--with the child pk absent.
function test.left_join_exec()
	with_db('left_join_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:left_join('sessions',
					q.eq(q.col('sessions.user_id'), q.col('users.id')))
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel, {})
			node:reset()
			local t = {}
			while node:next_item() do
				local u = pk_id(node, 'users', db)
				local ok, p, sz = node:pk('sessions')
				local s = ok and decode_pk(db:table_schema('sessions'), p, sz)
				t[#t+1] = u..':'..(s or '-')
			end
			node:close()
			--users 3 and 5 have no sessions -- left join keeps them, child
			--pk absent.
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,3:-,4:15,5:-', cat(t, ','))
		end)
	end)
end

------------------------------------------------------------------------------

local name = ...
if name == 'mdbx_query2_test' then name = nil end
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
