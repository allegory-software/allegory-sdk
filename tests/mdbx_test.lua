require'mdbx'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function test_file(name)
	return '/tmp/sdk_mdbx_test_'..name..'_'..uuid()..'.mdb'
end

local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
end

local function with_db(name, f)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		f(db)
	end, debug.traceback)
	if db.env then
		db:close()
	end
	cleanup(file)
	assert(ok, err)
end

local function put_string(db, tab, k, v)
	assert(db:try_put_raw(tab, k, #k, v, #v))
end

local function assert_plain_error(f, msg)
	local ok, err = pcall(f)
	assert(not ok)
	assert(not iserror(err, 'db'))
	assert(tostring(err):find(msg, 1, true), tostring(err))
end

local function table_exists(file, tab)
	local db = mdbx_open(file)
	db:begin()
	local exists = db:table_exists(tab)
	db:commit()
	db:close()
	return exists
end

function test.readonly_txn_is_reused()
	with_db('readonly_txn_is_reused', function(db)
		db:begin()
		local txn = db.txn
		assert(db._ro_txn == txn)
		db:commit()
		assert(not db.txn)
		assert(db._ro_txn == txn)

		db:begin()
		assert(db.txn == txn)
		db:commit()
	end)
end

function test.close_releases_cached_readonly_txn()
	local file = test_file('close_releases_cached_readonly_txn')
	cleanup(file)
	local db = mdbx_open(file)
	db:begin()
	local txn = db.txn
	db:commit()
	assert(db._ro_txn == txn)
	db:close()
	assert(not db._ro_txn)
	assert(not db.env)
	cleanup(file)
end

function test.close_releases_active_readonly_txn()
	local file = test_file('close_releases_active_readonly_txn')
	cleanup(file)
	local db = mdbx_open(file)
	db:begin()
	local txn = db.txn
	assert(db._ro_txn == txn)
	db:close()
	assert(not db.txn)
	assert(not db._ro_txn)
	assert(not db.env)
	cleanup(file)
end

function test.close_aborts_active_write_txn()
	local file = test_file('close_aborts_active_write_txn')
	cleanup(file)
	local db = mdbx_open(file)
	db:begin'w'
	put_string(db, 't', 'k', 'v')
	db:close()
	assert(not table_exists(file, 't'))
	cleanup(file)
end

function test.close_aborts_nested_write_txns()
	local file = test_file('close_aborts_nested_write_txns')
	cleanup(file)
	local db = mdbx_open(file)
	db:begin'w'
	put_string(db, 't1', 'k', 'v')
	db:begin'w'
	put_string(db, 't2', 'k', 'v')
	db:close()
	assert(not table_exists(file, 't1'))
	assert(not table_exists(file, 't2'))
	cleanup(file)
end

function test.failed_commit_discards_txn_state()
	with_db('failed_commit_discards_txn_state', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		local dbis = db.dbis
		assert(getmetatable(dbis).txn == db.txn)
		assert(mdbx.mdbx_txn_break(db.txn) == 0)
		local ok = pcall(function()
			db:commit()
		end)
		assert(not ok)
		assert(not db.txn)
		assert(db.dbis ~= dbis)
		assert(not getmetatable(db.dbis).txn)
		db:begin()
		assert(not db:table_exists't')
		db:commit()
	end)
end

function test.atomic_commits_unclosed_nested_write_txn()
	with_db('atomic_commits_unclosed_nested_write_txn', function(db)
		db:atomic('w', function()
			put_string(db, 't1', 'k', 'v')
			db:begin'w'
			put_string(db, 't2', 'k', 'v')
		end)
		assert(not db.txn)
		db:begin()
		assert(db:table_exists't1')
		assert(db:table_exists't2')
		db:commit()
	end)
end

function test.atomic_aborts_unclosed_nested_write_txn_on_error()
	with_db('atomic_aborts_unclosed_nested_write_txn_on_error', function(db)
		local ok = pcall(function()
			db:atomic('w', function()
				put_string(db, 't1', 'k', 'v')
				db:begin'w'
				put_string(db, 't2', 'k', 'v')
				error'boom'
			end)
		end)
		assert(not ok)
		assert(not db.txn)
		db:begin()
		assert(not db:table_exists't1')
		assert(not db:table_exists't2')
		db:commit()
	end)
end

function test.rename_created_table_in_top_level_txn_asserts()
	with_db('rename_created_table_in_top_level_txn_asserts', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		assert_plain_error(function()
			db:try_rename_table('t', 'u')
		end, 'created in current transaction')
		db:abort()
	end)
end

function test.rename_existing_table_in_top_level_txn()
	with_db('rename_existing_table_in_top_level_txn', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'
		assert(db:try_rename_table('t', 'u'))
		db:commit()
		db:begin()
		assert(not db:table_exists't')
		assert(db:table_exists'u')
		local ok, v, v_sz = db:get_raw('u', 'k', 1)
		assert(ok)
		assert(ffi.string(v, v_sz) == 'v')
		db:commit()
	end)
end

function test.rename_abort_reopens_old_table()
	with_db('rename_abort_reopens_old_table', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'
		assert(db:try_rename_table('t', 'u'))
		db:abort()
		db:begin()
		assert(db:table_exists't')
		assert(not db:table_exists'u')
		local ok, v, v_sz = db:get_raw('t', 'k', 1)
		assert(ok)
		assert(ffi.string(v, v_sz) == 'v')
		db:commit()
	end)
end

function test.rename_inherited_table_in_nested_txn_asserts()
	with_db('rename_inherited_table_in_nested_txn_asserts', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'
		db:begin'w'
		assert_plain_error(function()
			db:try_rename_table('t', 'u')
		end, 'rename table in nested transaction')
		db:abort()
		db:abort()
	end)
end

function test.rename_created_table_in_nested_txn_asserts()
	with_db('rename_created_table_in_nested_txn_asserts', function(db)
		db:begin'w'
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		assert_plain_error(function()
			db:try_rename_table('t', 'u')
		end, 'rename table in nested transaction')
		db:abort()
		db:abort()
	end)
end

function test.drop_table_in_nested_txn_asserts()
	with_db('drop_table_in_nested_txn_asserts', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'
		db:begin'w'
		assert_plain_error(function()
			db:try_drop_table't'
		end, 'drop table in nested transaction')
		db:abort()
		db:abort()
	end)
end

function test.dbi_c_clears_cached_table()
	with_db('dbi_c_clears_cached_table', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'
		assert(db:dbi't')
		assert(db:dbi('t', 'c'))
		local ok, err = db:get_raw('t', 'k', 1)
		assert(not ok)
		assert(err == 'not_found')
		db:abort()
	end)
end

function test.create_table_clears_cached_table()
	with_db('create_table_clears_cached_table', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'
		assert(db:dbi't')
		assert(db:create_table't')
		local ok, err = db:get_raw('t', 'k', 1)
		assert(not ok)
		assert(err == 'not_found')
		db:abort()
	end)
end

function test.update_missing_table_does_not_create_table()
	with_db('update_missing_table_does_not_create_table', function(db)
		db:begin'w'
		local ok, err = db:try_update_raw('t', 'k', 1, 'v', 1)
		assert(not ok)
		assert(err == 'not_found')
		assert(not db:table_exists't')
		db:commit()
		db:begin()
		assert(not db:table_exists't')
		db:commit()
	end)
end

function test.cursor_get_raw_accepts_cursor_op()
	with_db('cursor_get_raw_accepts_cursor_op', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		local ok, v, v_sz = cur:get_raw('a', 1, mdbx.MDBX_SET)
		assert(ok)
		assert(ffi.string(v, v_sz) == '1')
		cur:close()
		db:commit()
	end)
end

function test.cursor_get_pair_raw_uses_explicit_value()
	with_db('cursor_get_pair_raw_uses_explicit_value', function(db)
		db:begin'w'
		db:create_table('d', nil, mdbx.MDBX_DUPSORT)
		assert(db:try_put_raw('d', 'k', 1, 'a', 1))
		assert(db:try_put_raw('d', 'k', 1, 'b', 1))
		assert(db:try_put_raw('d', 'x', 1, 'q', 1))
		local cur = db:cursor('d')
		local ok, v, v_sz = cur:get_pair_raw('k', 1, 'b', 1)
		assert(ok)
		assert(ffi.string(v, v_sz) == 'b')
		db:abort()
	end)
end

function test.move_key_rejects_dupsort_table()
	with_db('move_key_rejects_dupsort_table', function(db)
		db:begin'w'
		db:create_table('d', nil, mdbx.MDBX_DUPSORT)
		assert(db:try_put_raw('d', 'k', 1, 'a', 1))
		assert(db:try_put_raw('d', 'k', 1, 'b', 1))
		assert_plain_error(function()
			db:try_move_key_raw('d', 'k', 1, 'j', 1)
		end, 'cannot move key in DUPSORT table')
		local vals = {}
		for cur, k, k_sz, v, v_sz in db:each_raw('d') do
			vals[#vals+1] = ffi.string(k, k_sz)..'='..ffi.string(v, v_sz)
		end
		assert(table.concat(vals, ',') == 'k=a,k=b')
		db:abort()
	end)
end

function test.cursor_del_returns_true()
	with_db('cursor_del_returns_true', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		local cur = db:cursor('t', 'w')
		assert(cur:get_raw('a', 1))
		assert(cur:del() == true)
		cur:close()
		db:commit()
	end)
end

function test.each_raw_missing_table_is_empty()
	with_db('each_raw_missing_table_is_empty', function(db)
		db:begin()
		local n = 0
		for cur, k, k_sz, v, v_sz in db:each_raw('missing') do
			n = n + 1
		end
		assert(n == 0)
		assert(not db:table_exists'missing')
		db:commit()
	end)
end

function test.nil_is_not_main_table()
	with_db('nil_is_not_main_table', function(db)
		db:begin'w'
		assert_plain_error(function()
			db:dbi(nil)
		end, 'table expected')
		assert_plain_error(function()
			db:table_exists(nil)
		end, 'table expected')
		assert_plain_error(function()
			db:try_put_raw(nil, 'x', 1, 'y', 1)
		end, 'table expected')
		db:abort()
	end)
end

function test.main_table_is_dbi_1()
	with_db('main_table_is_dbi_1', function(db)
		db:begin'w'
		assert(db:dbi(1) == 1)
		assert(db:table_name(1) == '<main>')
		assert(db:table_exists(1))
		assert(db:try_put_raw(1, 'x', 1, 'y', 1))
		local ok, v, v_sz = db:get_raw(1, 'x', 1)
		assert(ok)
		assert(ffi.string(v, v_sz) == 'y')
		db:abort()
	end)
end

function test.raw_ops_without_txn_assert()
	with_db('raw_ops_without_txn_assert', function(db)
		assert_plain_error(function()
			db:get_raw('t', 'k', 1)
		end, 'not in transaction')
		assert_plain_error(function()
			db:table_exists't'
		end, 'not in transaction')
	end)
end

function test.write_in_readonly_txn_raises()
	with_db('write_in_readonly_txn_raises', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()

		db:begin()
		assert_plain_error(function()
			db:try_put_raw('t', 'k2', 2, 'v2', 2)
		end, 'not in write transaction')
		db:commit()
	end)
end

function test.cursor_after_txn_asserts()
	with_db('cursor_after_txn_asserts', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		local cur = db:cursor('t')
		assert(cur:first_raw())
		db:commit()
		assert_plain_error(function()
			cur:next_raw()
		end, 'cursor closed')
	end)
end

function test.begin_write_on_readonly_db_asserts()
	local file = test_file('begin_write_on_readonly_db_asserts')
	cleanup(file)
	local db = mdbx_open(file)
	db:close()
	db = mdbx_open(file, {readonly = true})
	assert_plain_error(function()
		db:begin'w'
	end, 'read-only database')
	db:close()
	cleanup(file)
end

function test.delete_missing_db_returns_not_found()
	local file = test_file('delete_missing_db_returns_not_found')
	cleanup(file)
	local ok, err = mdbx_delete(file)
	assert(not ok)
	assert(err == 'not_found')
	cleanup(file)
end

function test.delete_open_db_raises()
	local file = test_file('delete_open_db_raises')
	cleanup(file)
	local db = mdbx_open(file)
	local ok = pcall(function()
		mdbx_delete(file, mdbx.MDBX_ENV_ENSURE_UNUSED)
	end)
	db:close()
	cleanup(file)
	assert(not ok)
end

local name = ...
if name == 'mdbx_test' then name = nil end
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
