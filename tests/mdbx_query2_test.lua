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

local function collect_pks(node, name, db)
	node:reset()
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
			local pks = collect_pks(node, 'users', db)
			assert(cat(pks, ',') == '3', cat(pks, ','))
			--same node, same shared params table, different value: the
			--getter must read the table's current contents, not a
			--snapshot taken when the node was built.
			params.ID = 1
			pks = collect_pks(node, 'users', db)
			assert(cat(pks, ',') == '1', cat(pks, ','))
			--missing id -> no rows.
			params.ID = 999
			pks = collect_pks(node, 'users', db)
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
			local pks = collect_pks(node, 'users', db)
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

--two independent equality facts (status, score), each with its own
--single-column index and no composite index covering both:
--choose_access can only drive the seek from one of them, so the other
--stays in plan.residual and must be checked by apply_residual/
--pk_filter at runtime, not just assumed to match.
function test.residual_filter_exec()
	with_db('residual_filter_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where(q.eq(q.col('users.status'), 'active'))
				:where(q.eq(q.col('users.score'), 80))
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel, {})
			local pks = collect_pks(node, 'users', db)
			--users 2 and 4 are also status='active' but score ~= 80 --
			--without the residual check, they'd leak through.
			assert(cat(pks, ',') == '1', cat(pks, ','))
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
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,3:-,4:15,5:-',
				cat(t, ','))
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
					q.eq(q.col('events.session_id'), q.col('sessions.id')))
			local rel = db:from('users')
				:left_join(group,
					q.eq(q.col('sessions.user_id'), q.col('users.id')))
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel, {})
			node:reset()
			local t = {}
			while node:next_item() do
				local u = pk_id(node, 'users', db)
				local ok_s, sp, ssz = node:pk('sessions')
				local ok_e, ep, esz = node:pk('events')
				local s = ok_s and decode_pk(db:table_schema('sessions'), sp, ssz)
				local e = ok_e and decode_pk(db:table_schema('events'), ep, esz)
				t[#t+1] = u..':'..(s or '-')..':'..(e or '-')
			end
			node:close()
			assert(cat(t, ',') ==
				'1:11:21,1:11:22,2:14:23,3:-:-,4:-:-,5:-:-', cat(t, ','))
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
					q.eq(q.col('sessions.user_id'), q.col('users.id')))
				:join('events',
					q.eq(q.col('events.session_id'), q.col('sessions.id')))
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel, {})
			node:reset()
			local t = {}
			while node:next_item() do
				local u = pk_id(node, 'users', db)
				local s = pk_id(node, 'sessions', db)
				local e = pk_id(node, 'events', db)
				t[#t+1] = u..':'..s..':'..e
			end
			node:close()
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
					q.eq(q.col('events.session_id'), q.col('sessions.id')))
				:join('tags',
					q.eq(q.col('tags.event_id'), q.col('events.id')))
			local rel = db:from('users')
				:left_join(group,
					q.eq(q.col('sessions.user_id'), q.col('users.id')))
				:select'users.id id'
				:prepare()
			local node = compile_step(db, rel, {})
			node:reset()
			local t = {}
			while node:next_item() do
				local u = pk_id(node, 'users', db)
				local ok_s, sp, ssz = node:pk('sessions')
				local ok_e, ep, esz = node:pk('events')
				local ok_g, gp, gsz = node:pk('tags')
				local s = ok_s and decode_pk(db:table_schema('sessions'), sp, ssz)
				local e = ok_e and decode_pk(db:table_schema('events'), ep, esz)
				local g = ok_g and decode_pk(db:table_schema('tags'), gp, gsz)
				t[#t+1] = u..':'..(s or '-')..':'..(e or '-')..':'..(g or '-')
			end
			node:close()
			assert(cat(t, ',') ==
				'1:11:21:31,1:11:21:32,2:-:-:-,3:-:-:-,4:-:-:-,5:-:-:-',
				cat(t, ','))
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
				:where(q.eq(q.col('users.status'), 'active'))
				:select{'users.id id', 'users.score score'}
				:order_by'users.id'
				:prepare()
			local t = {}
			for row in rel:rows'{}' do
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
				:where(q.eq(q.col('users.id'), 1))
				:select{'users.id id', 'users.score score'}
				:prepare()
			local id, score = rel:rows()()
			assert(id == 1 and score == 80, id..','..tostring(score))
			local row = rel:rows'[]'()
			assert(row[1] == 1 and row[2] == 80, cat(row, ','))
			local drow = rel:rows'{}'()
			assert(drow.id == 1 and drow.score == 80,
				drow.id..','..drow.score)
		end)
	end)
end

--first(): returns just the first row even when more than one matches;
--nil when nothing matches.
function test.first_exec()
	with_db('first_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where(q.eq(q.col('users.status'), 'active'))
				:select'users.id id'
				:order_by'users.id'
				:prepare()
			assert(rel:first() == 1)

			local none = db:from('users')
				:where(q.eq(q.col('users.id'), 999))
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
				:where(q.eq(q.col('users.id'), 3))
				:select'users.id id'
				:prepare()
			assert(single:one() == 3)

			local none = db:from('users')
				:where(q.eq(q.col('users.id'), 999))
				:select'users.id id'
				:prepare()
			assert(none:one() == nil)
			local none2 = db:from('users')
				:where(q.eq(q.col('users.id'), 999))
				:select'users.id id'
				:prepare()
			assert(not pcall(function() none2:must_one() end))

			local multi = db:from('users')
				:where(q.eq(q.col('users.status'), 'active'))
				:select'users.id id'
				:prepare()
			assert(not pcall(function() multi:one() end))

			local must_single = db:from('users')
				:where(q.eq(q.col('users.id'), 3))
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
			for status in rel:rows() do t[#t+1] = status end
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
				:where(q.ge(q.col('users.score'), 0))
				:select'users.status status'
				:distinct()
				:order_by'status desc'
				:prepare()
			assert(not rel.distinct_streaming, 'expected the hash path here')
			local t = {}
			for status in rel:rows() do t[#t+1] = status end
			assert(cat(t, ',') == 'banned,active', cat(t, ','))
		end)
	end)
end

--order_by() on a column not in select(): binds directly to the source
--col (out_col_or_source mode falls through to bind_col since the
--reference is qualified), so value_sort's spec reads it via
--compile_col passthrough, not the projected row dict.
function test.order_by_unselected_col_exec()
	with_db('order_by_unselected_col_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:select'users.id id'
				:order_by'users.score desc'
				:prepare()
			local t = {}
			for id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '2,1,4,5,3', cat(t, ','))
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
			for id in rel:rows() do t[#t+1] = id end
			assert(cat(t, ',') == '2,1', cat(t, ','))

			local rel2 = db:from('users')
				:select'users.id id'
				:order_by'users.score desc'
				:limit(2, 1)
				:prepare()
			local t2 = {}
			for id in rel2:rows() do t2[#t2+1] = id end
			assert(cat(t2, ',') == '1,4', cat(t2, ','))
		end)
	end)
end

--limit(q.param()): resolved through the same params table rows()
--binds, same as any other bound value in a query.
function test.limit_via_param_exec()
	with_db('limit_via_param_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:select'users.id id'
				:order_by'users.id'
				:limit(q.param('N'))
				:prepare()
			local t = {}
			for id in rel:rows(nil, {N = 2}) do t[#t+1] = id end
			assert(cat(t, ',') == '1,2', cat(t, ','))
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
					{q.count(), 'n'},
					{q.sum(q.col('users.score')), 'total'},
					{q.min(q.col('users.score')), 'lo'},
					{q.max(q.col('users.score')), 'hi'},
					{q.avg(q.col('users.score')), 'avg'}}
				:order_by'status'
				:prepare()
			assert(rel.group_streaming, 'expected the streaming path here')
			local t = {}
			for row in rel:rows'{}' do
				t[#t+1] = ('%s:%d:%d:%d:%d:%.2f'):format(row.status, row.n,
					row.total, row.lo, row.hi, row.avg)
			end
			assert(cat(t, ',') ==
				'active:3:245:70:95:81.67,banned:2:110:50:60:55.00', cat(t, ','))
		end)
	end)
end

--where() on score forces choose_access onto the score index instead
--(the only candidate try_key can seek with), so status's natural
--group order is gone -- group_streaming should come out false and
--hash_aggregate carries the same result.
function test.group_by_aggregate_hashed_exec()
	with_db('group_by_aggregate_hashed_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:where(q.ge(q.col('users.score'), 0))
				:group_by{'users.status status',
					{q.count(), 'n'}, {q.sum(q.col('users.score')), 'total'}}
				:order_by'status'
				:prepare()
			assert(not rel.group_streaming, 'expected the hash path here')
			local t = {}
			for row in rel:rows'{}' do
				t[#t+1] = row.status..':'..row.n..':'..row.total
			end
			assert(cat(t, ',') == 'active:3:245,banned:2:110', cat(t, ','))
		end)
	end)
end

--grand total: group_by() with only aggregate outputs, no key col --
--one row, no grouping or order needed either way.
function test.group_by_grand_total_exec()
	with_db('group_by_grand_total_exec', function(db)
		db:atomic('r', function()
			local rel = db:from('users')
				:group_by{{q.count(), 'n'},
					{q.sum(q.col('users.score')), 'total'}}
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
				:group_by{'users.status status', {q.count(), 'n'}}
				:having(q.ge(q.col('n'), 3))
				:order_by'status'
				:prepare()
			local t = {}
			for row in rel:rows'{}' do t[#t+1] = row.status..':'..row.n end
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
				:where(q.eq(q.col('users.status'), 'active'))
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
				:group_by{'users.status status', {q.count(), 'n'}}
				:having(q.ge(q.col('n'), 3))
				:prepare()
			assert(rel:count() == 1)
		end)
	end)
end

function test.exists_exec()
	with_db('exists_exec', function(db)
		db:atomic('r', function()
			local yes = db:from('users')
				:where(q.eq(q.col('users.id'), 1))
				:prepare()
			assert(yes:exists() == true)
			local no = db:from('users')
				:where(q.eq(q.col('users.id'), 999))
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
				:group_by{'users.status status', {q.count(), 'n'}}
				:having(q.ge(q.col('n'), 10))
				:prepare()
			assert(rel:exists() == false)
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
