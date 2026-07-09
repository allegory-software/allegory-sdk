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
			local function ids(q, params)
				local t = {}
				for r in q:select{'users.id'}:rows(params) do
					t[#t+1] = r['users.id']
				end
				sort(t)
				return t
			end

			-- indexed path: status column has users/status index; starts folds to pk_range;
			-- no residual pk_filter is added, so the plan root is the pk_range node directly.
			local plan = db:from'users':starts('status', 'P'):lower():explain()
			assert(plan.kind == 'pk_range', 'expected pk_range, got '..tostring(plan.kind))

			local t = ids(db:from'users':starts('status', 'P'), {P='act'})
			assert(#t == 3 and t[1] == 1 and t[2] == 2 and t[3] == 4, S(t))

			t = ids(db:from'users':starts('status', 'P'), {P='ban'})
			assert(#t == 2 and t[1] == 3 and t[2] == 5, S(t))

			-- no match
			t = ids(db:from'users':starts('status', 'P'), {P='xyz'})
			assert(#t == 0, S(t))

			-- residual path: no_index forces full scan; mk_pkfn handles starts as a predicate.
			t = ids(db:from'users':starts('status', 'P'):no_index('users'), {P='act'})
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
			local q = db:from'users'
				:where('status', 'P_st')
				:where('score', 'P_sc')
				:use_counts()
			local plan = q:lower():explain()
			assert(plan.kind == 'pk_filter', 'expected pk_filter, got '..tostring(plan.kind))
			assert(plan.inputs[1].kind == 'pk_seek',
				'expected pk_seek input, got '..tostring(plan.inputs[1].kind))

			local t = {}
			for r in q:select{'users.id'}:rows({P_st='active', P_sc=80}) do
				t[#t+1] = r['users.id']
			end
			assert(#t == 1 and t[1] == 1, S(t))
		end)
	end)
end

function test.order_by_join_unselected_column_exec()
	with_db('order_by_join_unselected_column_exec', function(db)
		db:atomic('r', function()
			local q = db:from'sessions'
				:join'users'
				:select{'sessions.id sid'}
				:order_by('users.score desc', 'sessions.id asc')
				:limit(2)
			local t = {}
			for r in q:rows() do
				t[#t+1] = tonumber(r.sid)
				assert(r['users.score'] == nil, 'hidden sort column leaked')
			end
			assert(cat(t, ',') == '14,11', S(t))
		end)
	end)
end

function test.in_query_exec()
	with_db('in_query_exec', function(db)
		db:atomic('r', function()
			local function ids(q, params)
				local t = {}
				for r in q:select{'users.id'}:rows(params) do
					t[#t+1] = r['users.id']
				end
				sort(t)
				return t
			end

			-- query-based in_: subquery produces PKs of users with score > 80 (only id=2).
			local t = ids(db:from'users':in_('id',
				db:from'users':where('score', '>', 'P')), {P=80})
			assert(#t == 1 and t[1] == 2, S(t))

			-- query-based not_in: exclude banned users (3 and 5) -> active users.
			t = ids(db:from'users':not_in('id',
				db:from'users':where('status', 'P')), {P='banned'})
			assert(#t == 3 and t[1] == 1 and t[2] == 2 and t[3] == 4, S(t))
		end)
	end)
end

function test.union_exec()
	with_db('union_exec', function(db)
		db:atomic('r', function()
			local function ids(q, params)
				local t = {}
				for r in q:rows(params) do t[#t+1] = tonumber(r.id) end
				return t
			end
			local function statuses(q, params)
				local t = {}
				for r in q:rows(params) do t[#t+1] = r.status end
				return t
			end

			local q1 = db:from'users'
				:where('status', 'P_st')
				:select{'users.id id'}
			local q2 = db:from'users'
				:where('score', 'P_sc')
				:select{'users.id id'}

			local t = ids(db:union('distinct', q1, q2), {P_st='active', P_sc=50})
			assert(cat(t, ',') == '1,2,4,3', S(t))

			t = ids(db:union('all', q1, q2), {P_st='active', P_sc=50})
			assert(cat(t, ',') == '1,2,4,3', S(t))

			local q3 = db:from'users'
				:where('score', 'P_sc')
				:select{'users.id id'}
			t = ids(db:union_all(q1, q3), {P_st='active', P_sc=80})
			assert(cat(t, ',') == '1,2,4,1', S(t))

			local q4 = db:from'users'
				:where('status', 'P_st')
				:select{'users.status status'}
			local q5 = db:from'users'
				:where('score', 'P_sc')
				:select{'users.status status'}
			t = statuses(db:union(q4, q5), {P_st='active', P_sc=80})
			assert(cat(t, ',') == 'active', S(t))

			local plan = db:union_all(q1, q3):lower():explain()
			assert(plan.kind == 'value_concat', plan.kind)
			plan = db:union('distinct', q1, q3):lower():explain()
			assert(plan.kind == 'union_distinct', plan.kind)
		end)
	end)
end

function test.where_exists_exec()
	with_db('where_exists_exec', function(db)
		db:atomic('r', function()
			local function user_ids(q, params)
				local t = {}
				for r in q:select{'users.id'}:rows(params) do
					t[#t+1] = tonumber(r['users.id'])
				end
				sort(t)
				return t
			end

			-- correlated semi_join: users that have at least one session.
			-- sessions has a user_id index; the correlated remap assigns a
			-- string param to the outer ref so try_ix_plan selects the index.
			local t = user_ids(db:from'users u':where_exists(
				db:from'sessions':where('user_id', mdbx_outer'u.id')))
			assert(#t == 3 and t[1]==1 and t[2]==2 and t[3]==4, S(t))

			-- correlated anti_join: users with no sessions.
			t = user_ids(db:from'users u':where_not_exists(
				db:from'sessions':where('user_id', mdbx_outer'u.id')))
			assert(#t == 2 and t[1]==3 and t[2]==5, S(t))

			-- uncorrelated: inner query finds no sessions with started_at > 1400,
			-- so the factory always returns empty and no users pass.
			t = user_ids(db:from'users':where_exists(
				db:from'sessions':where('started_at', '>', 'P')), {P=1400})
			assert(#t == 0, S(t))

			-- uncorrelated with match: session 15 has started_at=1400 > 1300,
			-- so the factory always returns a row and all users pass.
			t = user_ids(db:from'users':where_exists(
				db:from'sessions':where('started_at', '>', 'P')), {P=1300})
			assert(#t == 5, S(t))

			-- multi-filter correlated: active users with a session started after
			-- 1200. sessions 14 (user 2, 1300) and 15 (user 4, 1400) qualify.
			t = user_ids(db:from'users u'
				:where('status', 'P_st')
				:where_exists(db:from'sessions'
					:where('user_id', mdbx_outer'u.id')
					:where('started_at', '>', 'P_sa')
				), {P_st='active', P_sa=1200})
			assert(#t == 2 and t[1]==2 and t[2]==4, S(t))

			-- plan: correlated inner query uses sessions/user_id index via remapped
			-- string param (the real correlated path uses the same mechanism).
			-- with the index: pk_seek; without (full scan): pk_filter(pk_range).
			local inner = db:from'sessions':where('user_id', '__ov1')
			local plan = inner:lower():explain()
			assert(plan.kind == 'pk_seek',
				'expected pk_seek for indexed user_id filter, got '..plan.kind)
		end)
	end)
end

function test.join_parent_to_child_exec()
	with_db('join_parent_to_child_exec', function(db)
		db:atomic('r', function()
			local function pairs_ids(q, params)
				local t = {}
				for r in q:rows(params) do
					t[#t+1] = tonumber(r.uid)..':'..(r.sid and tonumber(r.sid) or 'none')
				end
				return t
			end

			local function join_kind(q) return q:lower():explain().inputs[1].kind end

			--plain join, unaliased, first join, no left: pk_join_seek path
			--(parent->child never uses merge_join -- see "FIXED BY BENCH"
			--in mdbx_query_builder.lua's lower() doc comment).
			local q1 = db:from'users':join'sessions'
				:select{'users.id uid', 'sessions.id sid'}
			assert(join_kind(q1) == 'pk_join_seek', join_kind(q1))
			assert(cat(pairs_ids(q1), ',') == '1:11,1:12,1:13,2:14,4:15', S(pairs_ids(q1)))

			--left join: pk_join_seek path.
			local q2 = db:from'users':left_join'sessions'
				:select{'users.id uid', 'sessions.id sid'}
			assert(join_kind(q2) == 'pk_join_seek', join_kind(q2))
			assert(cat(pairs_ids(q2), ',')
				== '1:11,1:12,1:13,2:14,3:none,4:15,5:none', S(pairs_ids(q2)))

			--aliased join: pk_join_seek path.
			local q3 = db:from'users':join'sessions s'
				:select{'users.id uid', 's.id sid'}
			assert(join_kind(q3) == 'pk_join_seek', join_kind(q3))
			assert(cat(pairs_ids(q3), ',') == '1:11,1:12,1:13,2:14,4:15', S(pairs_ids(q3)))
		end)
	end)
end

function test.or_where_exec()
	with_db('or_where_exec', function(db)
		db:atomic('r', function()
			local function ids(q, params)
				local t = {}
				for r in q:select{'users.id'}:rows(params) do
					t[#t+1] = r['users.id']
				end
				sort(t)
				return t
			end

			--AND branch (score index) or OR branch (status index); merge_union'd.
			local t = ids(db:from'users'
				:where('score', '>', 'P_hi')
				:or_where('status', 'P_ban'), {P_hi = 90, P_ban = 'banned'})
			assert(#t == 3 and t[1]==2 and t[2]==3 and t[3]==5, S(t))

			--no preceding :where -> has_and assert fires.
			assert(not pcall(function()
				return db:from'users':or_where('status', 'x'):lower()
			end))

			--or_where column not on the from-table -> assert fires.
			assert(not pcall(function()
				return db:from'users':where('status', 'P')
					:join'sessions'
					:or_where('sessions.started_at', '>', 'X')
					:lower()
			end))
		end)
	end)
end

function test.multi_filter_and_exec()
	with_db('multi_filter_and_exec', function(db)
		db:atomic('r', function()
			--residual: 2 unindexed AND filters compose into 1 pk_filter node.
			local q1 = db:from'users'
				:where('status', 'P_st'):where('score', 'P_sc')
				:no_index('users')
				:select{'users.id id'}
			local plan1 = q1:lower():explain()
			assert(plan1.inputs[1].kind == 'pk_filter', plan1.inputs[1].kind)
			assert(plan1.inputs[1].inputs[1].kind == 'pk_range',
				plan1.inputs[1].inputs[1].kind)
			local t = {}
			for r in q1:rows({P_st = 'active', P_sc = 80}) do t[#t+1] = tonumber(r.id) end
			assert(cat(t, ',') == '1', S(t))

			--join-member: 2 filters on the joined member compose into 1 pk_filter.
			local q2 = db:from'users':join'sessions'
				:where('sessions.started_at', '>', 'P_lo')
				:where('sessions.started_at', '<', 'P_hi')
				:select{'users.id uid', 'sessions.id sid'}
			local plan2 = q2:lower():explain()
			assert(plan2.inputs[1].kind == 'pk_filter', plan2.inputs[1].kind)
			assert(plan2.inputs[1].inputs[1].kind == 'pk_join_seek',
				plan2.inputs[1].inputs[1].kind)
			t = {}
			for r in q2:rows({P_lo = 1050, P_hi = 1250}) do
				t[#t+1] = tonumber(r.uid)..':'..tonumber(r.sid)
			end
			assert(cat(t, ',') == '1:12,1:13', S(t))

			--having: 2 conditions compose into 1 value_filter node.
			local q3 = db:from'sessions':group_by('user_id')
				:agg{{name = 'cnt', op = 'count'}}
				:having('cnt', '>=', 'P_lo')
				:having('cnt', '<', 'P_hi')
			local plan3 = q3:lower():explain()
			assert(plan3.kind == 'value_filter', plan3.kind)
			assert(plan3.inputs[1].kind ~= 'value_filter', plan3.inputs[1].kind)
			t = {}
			for r in q3:rows({P_lo = 1, P_hi = 3}) do t[#t+1] = tonumber(r.user_id) end
			sort(t)
			assert(cat(t, ',') == '2,4', S(t))
		end)
	end)
end

function test.nested_join_exec()
	with_db('nested_join_exec', function(db)
		db:atomic('r', function()
			--uncorrelated inner (fn ignores outer_fn): cross product of
			--5 users x 5 sessions = 25 tuples, with select projecting both.
			local q = db:from'users':nested_join(function(outer_fn)
				return db:from'sessions'
			end):select{'users.id uid', 'sessions.id sid'}
			local n = 0
			for r in q:rows() do
				n = n + 1
				assert(r.sid ~= nil, 'sessions member missing from row')
			end
			assert(n == 25, n)

			--nested_join's members list isn't extended until first runtime
			--iteration, so at build time it looks like a flat 1-member
			--stream even though it's a tuple; order_by without select must
			--reject it.
			local q2 = db:from'users':nested_join(function(outer_fn)
				return db:from'sessions'
			end):order_by('users.id desc')
			assert(not pcall(function() return q2:lower() end))
		end)
	end)
end

function test.group_by_index_exec()
	with_db('group_by_index_exec', function(db)
		db:atomic('r', function()
			--group cols exactly match the users/status index key, no agg
			--exprs/filters/joins: grp_ix path, pk_group_first drives the
			--group scan directly (no access node built first).
			local q = db:from'users':group_by('status'):agg{}
			local plan = q:lower():explain()
			assert(plan.kind == 'stream_aggregate', plan.kind)
			assert(plan.inputs[1].kind == 'pk_group_first', plan.inputs[1].kind)
			local t = {}
			for r in q:rows() do t[#t+1] = r.status end
			sort(t)
			assert(cat(t, ',') == 'active,banned', S(t))
		end)
	end)
end

function test.is_not_null_exec()
	with_db('is_not_null_exec', function(db)
		db:begin'w'
		db:insert('users', '{}', {id = 6, status = 'active', score = null})
		db:commit()

		db:atomic('r', function()
			--nullable indexed column: ntnull resolves to a '> __null' lower
			--bound; user 6 (null score) is excluded via the index.
			local q1 = db:from'users':is_not_null('score'):select{'users.id'}
			local plan1 = q1:lower():explain()
			assert(plan1.inputs[1].kind == 'pk_range', plan1.inputs[1].kind)
			local t = {}
			for r in q1:rows() do t[#t+1] = tonumber(r['users.id']) end
			sort(t)
			assert(cat(t, ',') == '1,2,3,4,5', S(t))

			--not_null column combined with an eq filter on the same composite
			--index (sessions/user_id,started_at, forced via use_index since
			--the plain user_id index alone would score higher): ntnull is
			--vacuously true (noop) and gets absorbed into the index plan's
			--consumed set, rather than becoming a residual row predicate.
			local q2 = db:from'sessions'
				:where('user_id', 'UID'):is_not_null('started_at')
				:use_index('sessions', 'sessions/user_id,started_at')
				:select{'sessions.id'}
			local plan2 = q2:lower():explain()
			--pk_range: pk_prefix is a build-time plan label, not a distinct
			--node kind -- it lowers through pk_range like any bounded scan.
			--kind == 'pk_range' directly (no pk_filter wrapper) confirms
			--both filters were absorbed by the index, none left residual.
			assert(plan2.inputs[1].kind == 'pk_range', plan2.inputs[1].kind)
			local t = {}
			for r in q2:rows({UID = 1}) do t[#t+1] = tonumber(r['sessions.id']) end
			sort(t)
			assert(cat(t, ',') == '11,12,13', S(t))
		end)
	end)
end

function test.correlated_fn_exec()
	with_db('correlated_fn_exec', function(db)
		db:atomic('r', function()
			local function user_ids(q, params)
				local t = {}
				for r in q:select{'users.id'}:rows(params) do
					t[#t+1] = tonumber(r['users.id'])
				end
				sort(t)
				return t
			end

			--where_exists(fn): o'member.col' proxies the outer row; users
			--with at least one session. fn is called once (5 outer rows),
			--not per row: it only ever hands back a param name, so the
			--query it builds is the same every time; only the bound value
			--(read via outer_fn) varies per row.
			local n1 = 0
			local t = user_ids(db:from'users':where_exists(function(o)
				n1 = n1 + 1
				return db:from'sessions':where('user_id', o'users.id')
			end))
			assert(cat(t, ',') == '1,2,4', S(t))
			assert(n1 == 1, n1)

			--nested_join(fn): same proxy convention, correlated per outer row.
			local n2 = 0
			local q2 = db:from'users':nested_join(function(o)
				n2 = n2 + 1
				return db:from'sessions':where('user_id', o'users.id')
			end):select{'users.id uid', 'sessions.id sid'}
			local pairs_t = {}
			for r in q2:rows() do
				pairs_t[#pairs_t+1] = tonumber(r.uid)..':'..tonumber(r.sid)
			end
			assert(cat(pairs_t, ',') == '1:11,1:12,1:13,2:14,4:15', S(pairs_t))
			assert(n2 == 1, n2)

			--where_has(fn): fn adds a condition on the child rows; users
			--with a session started after 1250 (sessions 14, 15 -> users 2, 4).
			local n3 = 0
			t = user_ids(db:from'users':where_has('sessions', function(o)
				n3 = n3 + 1
				return db:from'sessions'
					:where('user_id', o'users.id'):where('started_at', '>', 'P')
			end), {P = 1250})
			assert(cat(t, ',') == '2,4', S(t))
			assert(n3 == 1, n3)
		end)
	end)
end

function test.outer_ref_scope_exec()
	with_db('outer_ref_scope_exec', function(db)
		db:atomic('r', function()
			--skip-level ref: innermost query wants the grandparent ('u'),
			--skipping its immediate parent ('s') -- must fail to build
			--instead of silently reading the wrong node at runtime.
			assert(not pcall(function()
				return db:from'users u':where_exists(
					db:from'sessions s':where_exists(
						db:from'events':where('session_id', mdbx_outer'u.id')
					)):lower()
			end))

			--valid case: outer ref to a joined member (not the from-table's
			--own alias) of the immediate enclosing query.
			local q = db:from'users':join'sessions'
				:where_exists(db:from'events'
					:where('session_id', mdbx_outer'sessions.id'))
				:select{'users.id uid', 'sessions.id sid'}
			local t = {}
			for r in q:rows() do
				t[#t+1] = tonumber(r.uid)..':'..tonumber(r.sid)
			end
			sort(t)
			assert(cat(t, ',') == '1:11,2:14', S(t))
		end)
	end)
end

function test.pk_range_bound_exec()
	with_db('pk_range_bound_exec', function(db)
		--own fixture: a composite index (cat, score, extra) where score
		--(the range column) isn't last -- extra trails it, and several
		--rows share one score value. this is what an exclusive '>' lo or
		--inclusive '<=' hi must get right despite the trailing column.
		db:begin'w'
		db:create_table('items', {fields = {
			{col = 'id', mdbx_type = 'u64', not_null = true},
			{col = 'cat', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'score', mdbx_type = 'i32', not_null = true},
			{col = 'extra', mdbx_type = 'u64', not_null = true},
		}, pk = {'id'}})
		db:add_index('items', {'cat', 'score', 'extra'})
		local items = {
			{id=1, cat='a', score=100, extra=1},
			{id=2, cat='a', score=100, extra=2},
			{id=3, cat='a', score=100, extra=3},
			{id=4, cat='a', score=90,  extra=1},
			{id=5, cat='a', score=110, extra=1},
			{id=6, cat='a', score=110, extra=2},
		}
		for _, r in ipairs(items) do db:insert('items', '{}', r) end
		db:commit()

		db:atomic('r', function()
			local function ids(q, params)
				local t = {}
				for r in q:select{'items.id'}:rows(params) do
					t[#t+1] = tonumber(r['items.id'])
				end
				sort(t)
				return t
			end

			local plan = db:from'items':where('cat', 'CAT'):where('score', '<=', 'V')
				:lower():explain()
			assert(plan.kind == 'pk_range', 'expected pk_range, got '..tostring(plan.kind))

			-- inclusive hi at a boundary three rows share.
			local t = ids(db:from'items':where('cat', 'CAT'):where('score', '<=', 'V'),
				{CAT = 'a', V = 100})
			assert(cat(t, ',') == '1,2,3,4', S(t))

			-- exclusive lo at a boundary: score=90 excluded entirely.
			t = ids(db:from'items':where('cat', 'CAT'):where('score', '>', 'V'),
				{CAT = 'a', V = 90})
			assert(cat(t, ',') == '1,2,3,5,6', S(t))

			-- inclusive lo at the same boundary: score=90 included.
			t = ids(db:from'items':where('cat', 'CAT'):where('score', '>=', 'V'),
				{CAT = 'a', V = 90})
			assert(cat(t, ',') == '1,2,3,4,5,6', S(t))

			-- strict hi at a boundary: score=100 excluded entirely.
			t = ids(db:from'items':where('cat', 'CAT'):where('score', '<', 'V'),
				{CAT = 'a', V = 100})
			assert(cat(t, ',') == '4', S(t))

			-- exclusive lo + inclusive hi together.
			t = ids(db:from'items':where('cat', 'CAT')
				:where('score', '>', 'LO'):where('score', '<=', 'HI'),
				{CAT = 'a', LO = 90, HI = 100})
			assert(cat(t, ',') == '1,2,3', S(t))
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
