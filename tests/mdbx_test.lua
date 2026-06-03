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

function test.write_in_readonly_txn_raises()
	with_db('write_in_readonly_txn_raises', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()

		db:begin()
		local ok, err = pcall(function()
			db:try_put_raw('t', 'k2', 2, 'v2', 2)
		end)
		assert(not ok)
		assert(iserror(err, 'db'))
		assert(err.target == db)
		assert(tostring(err):find('Permission denied', 1, true)
			or tostring(err):find('EACCESS', 1, true))
		db:commit()
	end)
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
