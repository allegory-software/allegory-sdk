require'mdbx_query_nodes2'

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
	node:reset()
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
		{col = 'id'    , mdbx_type = 'u32', not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16, nozero = true},
		{col = 'score' , mdbx_type = 'i32'},
	}, pk = {'id'}})
	db:add_index('users', {'status'})
	db:add_index('users', {'score'})

	db:create_table('sessions', {fields = {
		{col = 'id'        , mdbx_type = 'u32', not_null = true},
		{col = 'user_id'   , mdbx_type = 'u32', not_null = true},
		{col = 'started_at', mdbx_type = 'i32', not_null = true},
	}, pk = {'id'}})
	db:add_index('sessions', {'user_id'})
	db:add_index('sessions', {'started_at'})
	db:add_index('sessions', {'user_id', 'started_at'})
	db:add_fk{table = 'sessions', cols = {'user_id'},
		ref_table = 'users', ref_cols = {'id'}}

	db:create_table('events', {fields = {
		{col = 'id'        , mdbx_type = 'u32', not_null = true},
		{col = 'session_id', mdbx_type = 'u32', not_null = true},
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
--pk_scan: covers what mdbx_query_nodes.lua splits into pk_get/pk_seek/
--pk_range/pk_prefix, run through the one unified node instead, with
--getters standing in for what those nodes read via named params.

local function const(v) return function() return v end end

local function pk_scan_seek(schema, depth, vals)
	local seek = {}
	for i, v in ipairs(vals) do seek[i] = const(v) end
	return seek
end

function test.explain_pk_scan()
	with_db('explain_pk_scan', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local e = db:pk_scan{kind = 'full', schema = schema, depth = 0,
				dir = 'asc', seek = {}}:explain()
			assert(e.kind == 'pk_scan', e.kind)
			assert(e.item == 'pk', e.item)
			assert(#e.members == 1 and e.members[1] == 'users', S(e.members))
			assert(e.order[1] == 'users.id asc', e.order[1])
			assert(e.unique == true)
			assert(e.source == 'cursor', e.source)
		end)
	end)
end

function test.pk_scan_resolve_errors()
	with_db('pk_scan_resolve_errors', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			--unknown plan kind (e.g. the not-yet-implemented 'in').
			assert(not pcall(db.pk_scan, db, {kind = 'in', schema = schema,
				depth = 0, dir = 'asc', seek = {}}))
			--dir=desc only valid for full/eq_prefix.
			assert(not pcall(db.pk_scan, db, {kind = 'range', schema = schema,
				depth = 0, dir = 'desc', seek = {},
				lo = {op = 'ge', get = const(1)}}))
		end)
	end)
end

--exact on a base table: same as pk_get.
function test.pk_scan_exact_table_exec()
	with_db('pk_scan_exact_table_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local node = db:pk_scan{kind = 'exact', schema = schema, depth = 1,
				dir = 'asc', seek = pk_scan_seek(schema, 1, {3})}
			node:reset()
			assert(node:next_group() == true)
			assert(pk_id(node, 'users', db) == 3)
			assert(node:next_group() == nil)
			assert(node:pk('users') == nil)
			node:close()
			--missing pk -> no rows.
			local n = db:pk_scan{kind = 'exact', schema = schema, depth = 1,
				dir = 'asc', seek = pk_scan_seek(schema, 1, {999})}
			n:reset()
			assert(n:next_group() == nil)
			n:close()
		end)
	end)
end

--exact on an index, full key pinned but non-unique: same as pk_seek,
--walks every dup under the one matching key.
function test.pk_scan_exact_index_exec()
	with_db('pk_scan_exact_index_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local ix = db:table_schema('users/status')
			local node = db:pk_scan{kind = 'exact', schema = ix, depth = 1,
				dir = 'asc', seek = pk_scan_seek(ix, 1, {'active'})}
			local pks = collect_pks(node, 'users', schema)
			assert(#pks == 3, 'expected 3, got '..#pks)
			assert(pks[1] == 1 and pks[2] == 2 and pks[3] == 4, S(pks))
			--missing key -> no rows.
			local n = db:pk_scan{kind = 'exact', schema = ix, depth = 1,
				dir = 'asc', seek = pk_scan_seek(ix, 1, {'missing'})}
			n:reset()
			assert(n:next_group() == nil)
			n:close()
		end)
	end)
end

--range on an index: same bound combinations as pk_range_exec.
function test.pk_scan_range_exec()
	with_db('pk_scan_range_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local ix = db:table_schema('users/score')
			--range plans are always dir='asc' (see pk_scan's doc: desc only
			--occurs for eq_prefix/full, since try_order_key() never returns
			--kind 'range').
			local function range(lo_op, lo_v, hi_op, hi_v)
				return db:pk_scan{kind = 'range', schema = ix, depth = 0,
					dir = 'asc', seek = {},
					lo = lo_op and {op = lo_op, get = const(lo_v)} or nil,
					hi = hi_op and {op = hi_op, get = const(hi_v)} or nil}
			end
			local function pks(node)
				return collect_pks(node, 'users', schema)
			end
			assert(cat(pks(range('ge', 70, 'le', 95)), ',') == '4,1,2')
			assert(cat(pks(range('gt', 70, 'le', 95)), ',') == '1,2')
			assert(cat(pks(range('ge', 70, 'lt', 95)), ',') == '4,1')
			assert(cat(pks(range('ge', 95, 'le', 70)), ',') == '')
		end)
	end)
end

--prefix (starts()) on an index: same as pk_range's partial-prefix test.
function test.pk_scan_prefix_exec()
	with_db('pk_scan_prefix_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local ix = db:table_schema('users/status')
			--prefix plans are always dir='asc' too, same reason as range
			--above: try_key() never sets a dir, only try_order_key() does,
			--and it never returns kind 'prefix'.
			local function prefix(v)
				return db:pk_scan{kind = 'prefix', schema = ix, depth = 0,
					dir = 'asc', seek = {}, prefix = const(v)}
			end
			assert(cat(collect_pks(prefix('act'), 'users', schema), ',')
				== '1,2,4')
			--null prefix value is rejected, same as pk_range's own check.
			assert(not pcall(function()
				db:pk_scan{kind = 'prefix', schema = ix, depth = 0,
					dir = 'asc', seek = {}, prefix = const(null)}:reset()
			end))
		end)
	end)
end

--eq_prefix on a composite index: leading col pinned, trailing col left
--to vary -- same rows as pk_prefix_exec, forward and backward.
function test.pk_scan_eq_prefix_exec()
	with_db('pk_scan_eq_prefix_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('sessions')
			local ix = db:table_schema('sessions/user_id,started_at')
			local function eq_prefix(desc)
				return db:pk_scan{kind = 'eq_prefix', schema = ix, depth = 1,
					dir = desc and 'desc' or 'asc',
					seek = pk_scan_seek(ix, 1, {1})}
			end
			assert(cat(collect_pks(eq_prefix(), 'sessions', schema), ',')
				== '11,12,13')
			assert(cat(collect_pks(eq_prefix(true), 'sessions', schema), ',')
				== '13,12,11')
			--user with no sessions -> no rows.
			local n = db:pk_scan{kind = 'eq_prefix', schema = ix, depth = 1,
				dir = 'asc', seek = pk_scan_seek(ix, 1, {3})}
			n:reset()
			assert(n:next_group() == nil)
			n:close()
		end)
	end)
end

--full: no bound at all, forward and backward.
function test.pk_scan_full_exec()
	with_db('pk_scan_full_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function full(desc)
				return db:pk_scan{kind = 'full', schema = schema, depth = 0,
					dir = desc and 'desc' or 'asc', seek = {}}
			end
			assert(cat(collect_pks(full(), 'users', schema), ',')
				== '1,2,3,4,5')
			assert(cat(collect_pks(full(true), 'users', schema), ',')
				== '5,4,3,2,1')
		end)
	end)
end

------------------------------------------------------------------------------
--pk_join_seek: nested join, one MDBX_SET_KEY seek on the fk index per
--driver row, driver in this case being a plain pk_scan full scan of
--the parent table.

function test.pk_join_seek_exec()
	with_db('pk_join_seek_exec', function(db)
		db:atomic('r', function()
			local users_schema = db:table_schema('users')
			local fk_schema = db:table_schema('sessions/user_id')
			local driver = db:pk_scan{kind = 'full', schema = users_schema,
				depth = 0, dir = 'asc', seek = {}}
			local node = db:pk_join_seek(driver, fk_schema)
			node:reset()
			local t = {}
			while node:next_item() do
				local u = pk_id(node, 'users', db)
				local s = pk_id(node, 'sessions', db)
				t[#t+1] = u..':'..s
			end
			node:close()
			--user 3 and 5 have no sessions -- inner join drops them.
			assert(cat(t, ',') == '1:11,1:12,1:13,2:14,4:15', S(t))
			--single driver row with no children -> no rows.
			local n2 = db:pk_join_seek(db:pk_scan{kind = 'exact',
				schema = users_schema, depth = 1, dir = 'asc',
				seek = {const(3)}}, fk_schema)
			n2:reset()
			assert(n2:next_group() == nil)
			n2:close()
		end)
	end)
end

function test.explain_pk_join_seek()
	with_db('explain_pk_join_seek', function(db)
		db:atomic('r', function()
			local users_schema = db:table_schema('users')
			local fk_schema = db:table_schema('sessions/user_id')
			local driver = db:pk_scan{kind = 'full', schema = users_schema,
				depth = 0, dir = 'asc', seek = {}}
			local e = db:pk_join_seek(driver, fk_schema):explain()
			assert(e.kind == 'pk_join_seek', e.kind)
			assert(e.item == 'pk_tuple', e.item)
			assert(cat(e.members, ',') == 'users,sessions', S(e.members))
		end)
	end)
end

function test.pk_join_seek_resolve_errors()
	with_db('pk_join_seek_resolve_errors', function(db)
		db:atomic('r', function()
			local users_schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = users_schema,
				depth = 0, dir = 'asc', seek = {}}
			--users/status is not a FK index.
			local not_fk = db:table_schema('users/status')
			assert(not pcall(db.pk_join_seek, db, driver, not_fk))
			--driver member doesn't match the FK's parent table.
			local sessions_schema = db:table_schema('sessions')
			local sessions_driver = db:pk_scan{kind = 'full',
				schema = sessions_schema, depth = 0, dir = 'asc', seek = {}}
			local fk_schema = db:table_schema('sessions/user_id')
			assert(not pcall(db.pk_join_seek, db, sessions_driver, fk_schema))
		end)
	end)
end

--fixture for pk_join_seek's nullable-FK reencode path: nuser_id is
--nullable, so its index key differs (extra marker byte) from users'
--own not_null pk. narrow index is the FK's own; wide adds started_at.
local function build_nullable_fk_fixture(db)
	db:begin'w'
	db:create_table('users', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:create_table('sessions', {fields = {
		{col = 'id'        , mdbx_type = 'u32', not_null = true},
		{col = 'nuser_id'  , mdbx_type = 'u32', not_null = false},
		{col = 'started_at', mdbx_type = 'u32', not_null = true},
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

function test.pk_join_seek_nullable_fk_exec()
	with_nullable_fk_db('pk_join_seek_nullable_fk_exec', function(db)
		db:atomic('r', function()
			local users_schema = db:table_schema('users')
			local function driver()
				return db:pk_scan{kind = 'full', schema = users_schema,
					depth = 0, dir = 'asc', seek = {}}
			end
			--narrow index on the nullable FK column itself.
			local fk_schema = db:table_schema('sessions/nuser_id')
			local node = db:pk_join_seek(driver(), fk_schema)
			node:reset()
			local t = {}
			while node:next_item() do
				local u = pk_id(node, 'users', db)
				local s = pk_id(node, 'sessions', db)
				t[#t+1] = u..':'..s
			end
			node:close()
			--session 13 (nuser_id null) has no parent and is excluded.
			assert(cat(t, ',') == '1:11,1:12', S(t))

			--wide index: nuser_id plus a trailing, non-FK column.
			local wide_fk_schema =
				db:table_schema('sessions/nuser_id,started_at')
			local node2 = db:pk_join_seek(driver(), wide_fk_schema)
			node2:reset()
			local t2 = {}
			while node2:next_item() do
				local u = pk_id(node2, 'users', db)
				local s = pk_id(node2, 'sessions', db)
				t2[#t2+1] = u..':'..s
			end
			node2:close()
			assert(cat(t2, ',') == '1:11,1:12', S(t2))
		end)
	end)
end

--[[
nested_join: left join a whole group (sessions JOIN events, events
required) onto users, one unit at a time. sessions_node is driven via
opts.from_member (nested_join reads outer:pk('users') raw and calls
inner:reset_prefix() with it) -- the group attaches to users through
an FK, same as any pk_join_seek edge, so no getter/decode/encode is
needed to re-seek it per outer row.
Group semantics (the reason that this node exists over pk_join_seek):
- user 1: sessions 12/13 have no events -- inner join drops them, only
  session 11 (with 2 events) survives.
- user 4: session 15 exists but has no events -- the whole group nulls
  out, including session 15, not just the event.
- users 3 and 5 have no sessions at all -- group absent, nulled too.
]]
local function build_group_join(db)
	local users_schema = db:table_schema('users')
	local outer = db:pk_scan{kind = 'full', schema = users_schema,
		depth = 0, dir = 'asc', seek = {}}
	local sessions_ix = db:table_schema('sessions/user_id')
	local sessions_node = db:pk_scan{kind = 'eq_prefix', schema = sessions_ix,
		depth = 1, dir = 'asc', seek = {}}
	local events_fk = db:table_schema('events/session_id')
	local inner = db:pk_join_seek(sessions_node, events_fk)
	return outer, db:nested_join(outer, inner,
		{left = true, from_member = 'users'})
end

function test.explain_nested_join()
	with_db('explain_nested_join', function(db)
		db:atomic('r', function()
			local _, node = build_group_join(db)
			local e = node:explain()
			assert(e.kind == 'nested_join', e.kind)
			assert(e.item == 'pk_tuple', e.item)
			assert(cat(e.members, ',') == 'users,sessions,events', S(e.members))
		end)
	end)
end

function test.nested_join_resolve_errors()
	with_db('nested_join_resolve_errors', function(db)
		db:atomic('r', function()
			local users_schema = db:table_schema('users')
			local outer = db:pk_scan{kind = 'full', schema = users_schema,
				depth = 0, dir = 'asc', seek = {}}
			--inner reusing the same member name as outer.
			local dup_inner = db:pk_scan{kind = 'full', schema = users_schema,
				depth = 0, dir = 'asc', seek = {}}
			assert(not pcall(db.nested_join, db, outer, dup_inner))
		end)
	end)
end

function test.nested_join_group_left_exec()
	with_db('nested_join_group_left_exec', function(db)
		db:atomic('r', function()
			local _, node = build_group_join(db)
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
				'1:11:21,1:11:22,2:14:23,3:-:-,4:-:-,5:-:-', S(t))
		end)
	end)
end

function test.explain_pk_filter()
	with_db('explain_pk_filter', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local e = db:pk_filter(driver, function() return true end):explain()
			assert(e.kind == 'pk_filter', e.kind)
			assert(cat(e.members, ',') == 'users', S(e.members))
		end)
	end)
end

--keeps rows where fn(node) is true, reading columns straight off the
--node that it's given (delegating through the wrapped input's col_decoder).
function test.pk_filter_exec()
	with_db('pk_filter_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local node = db:pk_filter(driver,
				function(n) return n:col('users', 'score') >= 80 end)
			node:reset()
			local t = {}
			while node:next_item() do t[#t+1] = pk_id(node, 'users', db) end
			node:close()
			--users 1(80) and 2(95) pass; 3(50), 4(70), 5(60) are filtered out.
			assert(cat(t, ',') == '1,2', S(t))
		end)
	end)
end

------------------------------------------------------------------------------
--select/value_filter/stream_distinct/hash_distinct/value_sort/limit:
--terminal-side nodes, decoding a pk stream into value records and
--shaping the result (filter, dedup, sort, cap).

function test.explain_select()
	with_db('explain_select', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local e = db:select(driver,
				{{name = 'id', member = 'users', col = 'id'}}):explain()
			assert(e.kind == 'select', e.kind)
			assert(e.item == 'value', e.item)
			assert(cat(e.members, ',') == 'users', S(e.members))
		end)
	end)
end

--plain columns and a synthetic fn() output, one record per input item.
function test.select_exec()
	with_db('select_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local node = db:select(driver, {
				{name = 'id', member = 'users', col = 'id'},
				{name = 'score', member = 'users', col = 'score'},
				{name = 'tag', fn = function() return 'x' end},
			})
			node:reset()
			local t = {}
			while node:next_item() do
				local row = node:row()
				t[#t+1] = row.id..':'..row.score..':'..row.tag
			end
			node:close()
			assert(cat(t, ',') == '1:80:x,2:95:x,3:50:x,4:70:x,5:60:x', S(t))
		end)
	end)
end

function test.explain_value_filter()
	with_db('explain_value_filter', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver,
				{{name = 'score', member = 'users', col = 'score'}})
			local e = db:value_filter(sel, function() return true end):explain()
			assert(e.kind == 'value_filter', e.kind)
			assert(e.item == 'value', e.item)
		end)
	end)
end

function test.value_filter_exec()
	with_db('value_filter_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver, {
				{name = 'id', member = 'users', col = 'id'},
				{name = 'score', member = 'users', col = 'score'},
			})
			local node = db:value_filter(sel,
				function(row) return row.score >= 70 end)
			node:reset()
			local t = {}
			while node:next_item() do t[#t+1] = node:row().id end
			node:close()
			--users 1(80), 2(95), 4(70) pass; 3(50), 5(60) filtered out.
			assert(cat(t, ',') == '1,2,4', S(t))
		end)
	end)
end

function test.explain_stream_distinct()
	with_db('explain_stream_distinct', function(db)
		db:atomic('r', function()
			local ix = db:table_schema('users/status')
			local driver = db:pk_scan{kind = 'full', schema = ix,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver,
				{{name = 'status', member = 'users', col = 'status'}})
			local e = db:stream_distinct(sel, {'status'}):explain()
			assert(e.kind == 'stream_distinct', e.kind)
			assert(e.unique == true)
		end)
	end)
end

--dedups adjacent records; needs input already grouped by field, which
--a full scan on the status index provides (equal keys are adjacent).
function test.stream_distinct_exec()
	with_db('stream_distinct_exec', function(db)
		db:atomic('r', function()
			local ix = db:table_schema('users/status')
			local driver = db:pk_scan{kind = 'full', schema = ix,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver, {
				{name = 'id', member = 'users', col = 'id'},
				{name = 'status', member = 'users', col = 'status'},
			})
			local node = db:stream_distinct(sel, {'status'})
			node:reset()
			local t = {}
			while node:next_item() do
				local row = node:row()
				t[#t+1] = row.id..':'..row.status
			end
			node:close()
			assert(cat(t, ',') == '1:active,3:banned', S(t))
		end)
	end)
end

function test.explain_hash_distinct()
	with_db('explain_hash_distinct', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver,
				{{name = 'status', member = 'users', col = 'status'}})
			local e = db:hash_distinct(sel, {'status'}):explain()
			assert(e.kind == 'hash_distinct', e.kind)
			assert(e.unique == true)
		end)
	end)
end

--dedups by first-seen, independent of input order -- unlike
--stream_distinct, a plain pk-order scan (not grouped by status) works.
function test.hash_distinct_exec()
	with_db('hash_distinct_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver, {
				{name = 'id', member = 'users', col = 'id'},
				{name = 'status', member = 'users', col = 'status'},
			})
			local node = db:hash_distinct(sel, {'status'})
			node:reset()
			local t = {}
			while node:next_item() do
				local row = node:row()
				t[#t+1] = row.id..':'..row.status
			end
			node:close()
			assert(cat(t, ',') == '1:active,3:banned', S(t))
		end)
	end)
end

function test.explain_value_sort()
	with_db('explain_value_sort', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local e = db:value_sort(driver, {{col = 'score'}}):explain()
			assert(e.kind == 'value_sort', e.kind)
			assert(e.item == 'pk', e.item)
		end)
	end)
end

--pk path: sorts a pk stream by column value, still yielding pks.
function test.value_sort_pk_exec()
	with_db('value_sort_pk_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local node = db:value_sort(driver, {{col = 'score'}})
			local pks = collect_pks(node, 'users', schema)
			assert(cat(pks, ',') == '3,5,4,1,2', S(pks))
		end)
	end)
end

--value path: sorts already-projected value records by a plain field.
function test.value_sort_value_exec()
	with_db('value_sort_value_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver, {
				{name = 'id', member = 'users', col = 'id'},
				{name = 'score', member = 'users', col = 'score'},
			})
			local node = db:value_sort(sel, {{field = 'score', desc = true}})
			node:reset()
			local t = {}
			while node:next_item() do t[#t+1] = node:row().id end
			node:close()
			assert(cat(t, ',') == '2,1,4,5,3', S(t))
		end)
	end)
end

function test.explain_limit()
	with_db('explain_limit', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local e = db:limit(driver, 2):explain()
			assert(e.kind == 'limit', e.kind)
			assert(e.item == 'pk', e.item)
		end)
	end)
end

function test.limit_exec()
	with_db('limit_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local function scan()
				return db:pk_scan{kind = 'full', schema = schema,
					depth = 0, dir = 'asc', seek = {}}
			end
			assert(cat(collect_pks(db:limit(scan(), 2), 'users', schema), ',')
				== '1,2')
			assert(cat(collect_pks(db:limit(scan(), 2, 1), 'users', schema), ',')
				== '2,3')
		end)
	end)
end

------------------------------------------------------------------------------
--pk_group/stream_aggregate/hash_aggregate: group_by() execution, two
--strategies for the same result.

function test.explain_pk_group()
	with_db('explain_pk_group', function(db)
		db:atomic('r', function()
			local ix = db:table_schema('users/status')
			local driver = db:pk_scan{kind = 'full', schema = ix,
				depth = 0, dir = 'asc', seek = {}}
			local e = db:pk_group(driver,
				{{member = 'users', col = 'status'}}):explain()
			assert(e.kind == 'pk_group', e.kind)
			assert(e.item == 'pk', e.item)
		end)
	end)
end

--full scan on the status index visits equal-status rows adjacently,
--so pk_group can walk it directly: next_group() lands on the first pk
--of each group, next_pk() walks the rest of that same group.
function test.pk_group_exec()
	with_db('pk_group_exec', function(db)
		db:atomic('r', function()
			local ix = db:table_schema('users/status')
			local driver = db:pk_scan{kind = 'full', schema = ix,
				depth = 0, dir = 'asc', seek = {}}
			local cols = {{member = 'users', col = 'status'}}
			local node = db:pk_group(driver, cols)
			node:reset()
			local t = {}
			while node:next_group() do
				local g = {}
				repeat
					g[#g+1] = pk_id(node, 'users', db)
				until not node:next_pk()
				t[#t+1] = cat(g, '+')
			end
			node:close()
			assert(cat(t, ',') == '1+2+4,3+5', S(t))
		end)
	end)
end

function test.explain_stream_aggregate()
	with_db('explain_stream_aggregate', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local e = db:stream_aggregate(driver, nil,
				{{name = 'n', op = 'count'}}):explain()
			assert(e.kind == 'stream_aggregate', e.kind)
			assert(e.item == 'value', e.item)
		end)
	end)
end

--grand total (cols = nil): one record for the whole input, no group key.
function test.stream_aggregate_grand_total_exec()
	with_db('stream_aggregate_grand_total_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local node = db:stream_aggregate(driver, nil, {
				{name = 'n', op = 'count'},
				{name = 'total', op = 'sum', member = 'users', col = 'score'},
			})
			node:reset()
			assert(node:next_item() == true)
			local row = node:row()
			assert(row.n == 5 and row.total == 355, row.n..','..row.total)
			assert(node:next_item() == nil)
			node:close()
		end)
	end)
end

--grouped: pk_group over the status index (already grouped) feeds
--stream_aggregate one group at a time via next_pk.
function test.stream_aggregate_grouped_exec()
	with_db('stream_aggregate_grouped_exec', function(db)
		db:atomic('r', function()
			local ix = db:table_schema('users/status')
			local driver = db:pk_scan{kind = 'full', schema = ix,
				depth = 0, dir = 'asc', seek = {}}
			local cols = {{member = 'users', col = 'status'}}
			local grouped = db:pk_group(driver, cols)
			local node = db:stream_aggregate(grouped, cols, {
				{name = 'status', op = 'key', part = 1},
				{name = 'n', op = 'count'},
				{name = 'total', op = 'sum', member = 'users', col = 'score'},
			})
			node:reset()
			local t = {}
			while node:next_item() do
				local row = node:row()
				t[#t+1] = row.status..':'..row.n..':'..row.total
			end
			node:close()
			assert(cat(t, ',') == 'active:3:245,banned:2:110', S(t))
		end)
	end)
end

function test.explain_hash_aggregate()
	with_db('explain_hash_aggregate', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver,
				{{name = 'score', member = 'users', col = 'score'}})
			local e = db:hash_aggregate(sel, nil,
				{{name = 'n', op = 'count'}}):explain()
			assert(e.kind == 'hash_aggregate', e.kind)
			assert(e.item == 'value', e.item)
		end)
	end)
end

--grand total (fields = nil), over an already-selected value stream.
function test.hash_aggregate_grand_total_exec()
	with_db('hash_aggregate_grand_total_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver,
				{{name = 'score', member = 'users', col = 'score'}})
			local node = db:hash_aggregate(sel, nil, {
				{name = 'n', op = 'count'},
				{name = 'total', op = 'sum', input = 'score'},
			})
			node:reset()
			assert(node:next_item() == true)
			local row = node:row()
			assert(row.n == 5 and row.total == 355, row.n..','..row.total)
			assert(node:next_item() == nil)
			node:close()
		end)
	end)
end

--grouped by first-seen, independent of input order -- a plain pk-order
--scan (not grouped by status) still gives the right groups.
function test.hash_aggregate_grouped_exec()
	with_db('hash_aggregate_grouped_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('users')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver, {
				{name = 'status', member = 'users', col = 'status'},
				{name = 'score', member = 'users', col = 'score'},
			})
			local node = db:hash_aggregate(sel, {'status'}, {
				{name = 'status', op = 'key', part = 1},
				{name = 'n', op = 'count'},
				{name = 'total', op = 'sum', input = 'score'},
			})
			node:reset()
			local t = {}
			while node:next_item() do
				local row = node:row()
				t[#t+1] = row.status..':'..row.n..':'..row.total
			end
			node:close()
			assert(cat(t, ',') == 'active:3:245,banned:2:110', S(t))
		end)
	end)
end

--fixture with a nullable column: count(expr) must count only its
--non-null rows, count() (no expr) counts every row regardless.
local function build_nulls_fixture(db)
	db:begin'w'
	db:create_table('scores', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'v' , mdbx_type = 'i32', not_null = false},
	}, pk = {'id'}})
	db:insert('scores', '{}', {id = 1, v = 10})
	db:insert('scores', '{}', {id = 2, v = null})
	db:insert('scores', '{}', {id = 3, v = 20})
	db:commit()
end

local function with_nulls_db(name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build_nulls_fixture(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

function test.stream_aggregate_count_null_exec()
	with_nulls_db('stream_aggregate_count_null_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('scores')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local node = db:stream_aggregate(driver, nil, {
				{name = 'n_all', op = 'count'},
				{name = 'n_v', op = 'count', member = 'scores', col = 'v'},
				{name = 'total', op = 'sum', member = 'scores', col = 'v'},
			})
			node:reset()
			assert(node:next_item() == true)
			local row = node:row()
			assert(row.n_all == 3 and row.n_v == 2 and row.total == 30,
				row.n_all..','..row.n_v..','..row.total)
			node:close()
		end)
	end)
end

function test.hash_aggregate_count_null_exec()
	with_nulls_db('hash_aggregate_count_null_exec', function(db)
		db:atomic('r', function()
			local schema = db:table_schema('scores')
			local driver = db:pk_scan{kind = 'full', schema = schema,
				depth = 0, dir = 'asc', seek = {}}
			local sel = db:select(driver,
				{{name = 'v', member = 'scores', col = 'v'}})
			local node = db:hash_aggregate(sel, nil, {
				{name = 'n_all', op = 'count'},
				{name = 'n_v', op = 'count', input = 'v'},
				{name = 'total', op = 'sum', input = 'v'},
			})
			node:reset()
			assert(node:next_item() == true)
			local row = node:row()
			assert(row.n_all == 3 and row.n_v == 2 and row.total == 30,
				row.n_all..','..row.n_v..','..row.total)
			node:close()
		end)
	end)
end

------------------------------------------------------------------------------

local name = ...
if name == 'mdbx_query_nodes2_test' then name = nil end
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
