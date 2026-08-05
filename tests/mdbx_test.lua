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
	if not db:table_exists(tab) then
		db:create_table_raw(tab)
	end
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

function test.check_clean_db()
	with_db('check_clean_db', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		local ok, problem_count = db:check()
		assert(ok and problem_count == 0)
	end)
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

function test.nested_created_table_cache_discarded_on_parent_abort()
	with_db('nested_created_table_cache_discarded_on_parent_abort', function(db)
		db:begin'w'
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		assert(db:table_exists't')
		db:abort()
		db:begin()
		assert(not db:table_exists't')
		local dbi, err = db:try_dbi_raw't'
		assert(not dbi and err == 'not_found')
		db:commit()
	end)
end

function test.rename_created_table_in_top_level_txn()
	with_db('rename_created_table_in_top_level_txn', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:rename_table_raw('t', 'u') --created in this txn, renamed in it
		db:commit()
		db:begin()
		assert(not db:table_exists't' and db:table_exists'u')
		local ok, v, v_sz = db:find_raw('u', 'k', 1)
		assert(ok and ffi.string(v, v_sz) == 'v')
		db:commit()
	end)
end

function test.rename_existing_table_in_top_level_txn()
	with_db('rename_existing_table_in_top_level_txn', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'
		db:rename_table_raw('t', 'u')
		db:commit()
		db:begin()
		assert(not db:table_exists't')
		assert(db:table_exists'u')
		local ok, v, v_sz = db:find_raw('u', 'k', 1)
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
		db:rename_table_raw('t', 'u')
		db:abort()
		db:begin()
		assert(db:table_exists't')
		assert(not db:table_exists'u')
		local ok, v, v_sz = db:find_raw('t', 'k', 1)
		assert(ok)
		assert(ffi.string(v, v_sz) == 'v')
		db:commit()
	end)
end

function test.rename_inherited_table_in_nested_txn()
	with_db('rename_inherited_table_in_nested_txn', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'  --outer
		db:begin'w'  --nested
		db:rename_table_raw('t', 'u')
		db:commit()  --nested
		db:commit()  --outer
		db:begin()
		assert(not db:table_exists't' and db:table_exists'u')
		local ok, v, v_sz = db:find_raw('u', 'k', 1)
		assert(ok and ffi.string(v, v_sz) == 'v')
		db:commit()
	end)
end

--nested rename rolls back with the nested txn (outer keeps the old table).
function test.rename_in_nested_txn_abort()
	with_db('rename_in_nested_txn_abort', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'  --outer
		db:begin'w'  --nested
		db:rename_table_raw('t', 'u')
		db:abort()   --nested discarded
		assert(db:table_exists't' and not db:table_exists'u', 'nested rename not rolled back')
		db:commit()  --outer
		db:begin()
		assert(db:table_exists't' and not db:table_exists'u')
		db:commit()
	end)
end

function test.rename_created_table_in_nested_txn()
	with_db('rename_created_table_in_nested_txn', function(db)
		db:begin'w'  --outer
		db:begin'w'  --nested
		put_string(db, 't', 'k', 'v')
		db:rename_table_raw('t', 'u')
		db:commit()  --nested
		db:commit()  --outer
		db:begin()
		assert(not db:table_exists't' and db:table_exists'u')
		local ok, v, v_sz = db:find_raw('u', 'k', 1)
		assert(ok and ffi.string(v, v_sz) == 'v')
		db:commit()
	end)
end

function test.drop_table_in_nested_txn()
	with_db('drop_table_in_nested_txn', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'  --outer
		db:begin'w'  --nested
		assert(db:drop_table_raw't')
		db:commit()  --nested
		db:commit()  --outer
		db:begin()
		assert(not db:table_exists't')
		db:commit()
	end)
end

function test.drop_in_nested_txn_abort_reopens_parent_dbi()
	with_db('drop_in_nested_txn_abort_reopens_parent_dbi', function(db)
		local file = db.file
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:close()

		db = mdbx_open(file)
		db:begin'w'
		db:begin'w'
		assert(db:find_raw('t', 'k', 1))
		db:commit()
		db:begin'w'
		assert(db:drop_table_raw't')
		db:abort()
		local ok, v, v_sz = db:find_raw('t', 'k', 1)
		assert(ok and ffi.string(v, v_sz) == 'v')
		db:commit()
		db:close()
	end)
end

function test.drop_created_table_in_nested_txn_abort()
	with_db('drop_created_table_in_nested_txn_abort', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:begin'w'
		assert(db:drop_table_raw't')
		db:abort()

		assert(db:table_exists't')
		local ok, v, v_sz = db:find_raw('t', 'k', 1)
		assert(ok and ffi.string(v, v_sz) == 'v',
			'child drop+abort lost the parent-created table row')

		db:commit()
		db:begin()
		local ok, v, v_sz = db:find_raw('t', 'k', 1)
		assert(ok and ffi.string(v, v_sz) == 'v',
			'parent commit persisted the restored table without its row')
		db:commit()
	end)
end

function test.try_dbi_missing_table()
	with_db('try_dbi_missing_table', function(db)
		db:begin()
		local dbi, err = db:try_dbi_raw'missing'
		assert(not dbi and err == 'not_found')
		db:commit()
	end)
end

function test.create_table_existing_raises_and_preserves_table()
	with_db('create_table_existing_raises_and_preserves_table', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		db:commit()
		db:begin'w'
		local ok, e = catch('schema', db.create_table_raw, db, 't')
		assert(not ok and iserror(e, 'schema'), tostring(e))
		assert(e.event == 't_create' and e.table == 't', tostring(e))
		assert(e.message == 'already_exists', tostring(e.message))
		assert(not db.txn)
		db:begin()
		local found, v, v_sz = db:find_raw('t', 'k', 1)
		assert(found and ffi.string(v, v_sz) == 'v')
		db:commit()
	end)
end

function test.update_missing_table_does_not_create_table()
	with_db('update_missing_table_does_not_create_table', function(db)
		db:begin'w'
		local ok, e = catch('schema',
			db.try_update_raw, db, 't', 'k', 1, 'v', 1)
		assert(not ok and iserror(e, 'schema'), tostring(e))
		assert(e.event == 't_open' and e.table == 't', tostring(e))
		assert(e.message == 'not_found', tostring(e.message))
		assert(not db.txn)
		db:begin()
		assert(not db:table_exists't')
		db:commit()
	end)
end

function test.cursor_find_dup_raw()
	with_db('cursor_find_dup_raw', function(db)
		db:begin'w'
		db:create_table_raw('d', mdbx.MDBX_DUPSORT)
		assert(db:try_put_raw('d', 'k', 1, 'a', 1))
		assert(db:try_put_raw('d', 'k', 1, 'b', 1))
		assert(db:try_put_raw('d', 'x', 1, 'q', 1))
		local cur = db:cursor_raw('d')
		local ok, v, v_sz = cur:find_dup_raw('k', 1, 'b', 1)
		assert(ok)
		assert(ffi.string(v, v_sz) == 'b')
		db:abort()
	end)
end

--dup_count() reads how many dups the current key has off the subtree,
--so it does not step through them.
function test.cursor_dup_count()
	with_db('cursor_dup_count', function(db)
		db:begin'w'
		db:create_table_raw('d', mdbx.MDBX_DUPSORT)
		for _, v in ipairs{'a', 'b', 'c'} do
			assert(db:try_put_raw('d', 'k', 1, v, 1))
		end
		assert(db:try_put_raw('d', 'x', 1, 'q', 1))
		local cur = db:cursor_raw('d')
		assert(cur:find_raw('k', 1))
		assert(cur:dup_count() == 3, cur:dup_count())
		assert(cur:find_raw('x', 1))
		assert(cur:dup_count() == 1, cur:dup_count())
		db:abort()
	end)
end

function test.cursor_del_returns_true()
	with_db('cursor_del_returns_true', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		local cur = db:cursor_raw('t', 'w')
		assert(cur:find_raw('a', 1))
		cur:try_del_raw()
		cur:close()
		db:commit()
	end)
end

function test.each_raw_missing_table_raises()
	with_db('each_raw_missing_table_raises', function(db)
		db:begin()
		local ok, e = catch('schema', function()
			for _ in db:each_raw('missing') do end
		end)
		assert(not ok and iserror(e, 'schema'), tostring(e))
		assert(e.event == 't_open' and e.table == 'missing', tostring(e))
		assert(e.message == 'not_found', tostring(e.message))
		assert(not db.txn)
	end)
end

function test.nil_is_not_main_table()
	with_db('nil_is_not_main_table', function(db)
		db:begin'w'
		assert_plain_error(function()
			db:dbi_raw(nil)
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
		assert(db:dbi_raw(1) == 1)
		assert(db:table_name(1) == '<main>')
		assert(db:table_exists(1))
		assert(db:try_put_raw(1, 'x', 1, 'y', 1))
		local ok, v, v_sz = db:find_raw(1, 'x', 1)
		assert(ok)
		assert(ffi.string(v, v_sz) == 'y')
		db:abort()
	end)
end

function test.raw_ops_without_txn_assert()
	with_db('raw_ops_without_txn_assert', function(db)
		assert_plain_error(function()
			db:find_raw('t', 'k', 1)
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
		local cur = db:cursor_raw('t')
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

-- find_ge_raw ----------------------------------------------------------------

function test.find_ge_raw_exact_match()
	with_db('find_ge_raw_exact_match', function(db)
		db:begin'w'
		put_string(db, 't', 'b', '2')
		put_string(db, 't', 'd', '4')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local ok, k, k_sz, v, v_sz = cur:find_ge_raw('b', 1)
		assert(ok)
		assert(ffi.string(k, k_sz) == 'b')
		assert(ffi.string(v, v_sz) == '2')
		cur:close()
		db:commit()
	end)
end

function test.find_ge_raw_between_keys()
	with_db('find_ge_raw_between_keys', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		put_string(db, 't', 'c', '3')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local ok, k, k_sz, v, v_sz = cur:find_ge_raw('b', 1)
		assert(ok)
		assert(ffi.string(k, k_sz) == 'c')
		assert(ffi.string(v, v_sz) == '3')
		cur:close()
		db:commit()
	end)
end

function test.find_ge_raw_past_last()
	with_db('find_ge_raw_past_last', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local ok, err = cur:find_ge_raw('z', 1)
		assert(not ok and err == 'not_found')
		cur:close()
		db:commit()
	end)
end

-- each_from_raw --------------------------------------------------------------

function test.each_from_raw_from_middle()
	with_db('each_from_raw_from_middle', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		put_string(db, 't', 'c', '3')
		put_string(db, 't', 'e', '5')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local keys = {}
		for _, k, k_sz in cur:each_from_raw('c', 1) do
			keys[#keys+1] = ffi.string(k, k_sz)
		end
		cur:close()
		db:commit()
		assert(table.concat(keys, ',') == 'c,e', table.concat(keys, ','))
	end)
end

function test.each_from_raw_before_first()
	with_db('each_from_raw_before_first', function(db)
		db:begin'w'
		put_string(db, 't', 'b', '2')
		put_string(db, 't', 'd', '4')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local keys = {}
		for _, k, k_sz in cur:each_from_raw('a', 1) do
			keys[#keys+1] = ffi.string(k, k_sz)
		end
		cur:close()
		db:commit()
		assert(table.concat(keys, ',') == 'b,d', table.concat(keys, ','))
	end)
end

function test.each_from_raw_past_last()
	with_db('each_from_raw_past_last', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local count = 0
		for _ in cur:each_from_raw('z', 1) do count = count + 1 end
		cur:close()
		db:commit()
		assert(count == 0)
	end)
end

-- each_from_last_raw ------------------------------------------------------

function test.each_from_last_raw_from_middle()
	with_db('each_from_last_raw_from_middle', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		put_string(db, 't', 'c', '3')
		put_string(db, 't', 'e', '5')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local keys = {}
		for _, k, k_sz in cur:each_from_last_raw('c', 1) do
			keys[#keys+1] = ffi.string(k, k_sz)
		end
		cur:close()
		db:commit()
		assert(table.concat(keys, ',') == 'c,a', table.concat(keys, ','))
	end)
end

function test.each_from_last_raw_between_keys()
	with_db('each_from_last_raw_between_keys', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		put_string(db, 't', 'c', '3')
		put_string(db, 't', 'e', '5')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local keys = {}
		for _, k, k_sz in cur:each_from_last_raw('d', 1) do
			keys[#keys+1] = ffi.string(k, k_sz)
		end
		cur:close()
		db:commit()
		assert(table.concat(keys, ',') == 'c,a', table.concat(keys, ','))
	end)
end

function test.each_from_last_raw_before_first()
	with_db('each_from_last_raw_before_first', function(db)
		db:begin'w'
		put_string(db, 't', 'b', '2')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local count = 0
		for _ in cur:each_from_last_raw('a', 1) do count = count + 1 end
		cur:close()
		db:commit()
		assert(count == 0)
	end)
end

-- cursor navigation ----------------------------------------------------------

function test.cursor_navigation()
	with_db('cursor_navigation', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		put_string(db, 't', 'b', '2')
		put_string(db, 't', 'c', '3')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local ok, k, k_sz
		ok, k, k_sz = cur:first_raw()
		assert(ok and ffi.string(k, k_sz) == 'a')
		ok, k, k_sz = cur:next_raw()
		assert(ok and ffi.string(k, k_sz) == 'b')
		ok, k, k_sz = cur:current_raw()
		assert(ok and ffi.string(k, k_sz) == 'b')
		ok, k, k_sz = cur:prev_raw()
		assert(ok and ffi.string(k, k_sz) == 'a')
		ok, k, k_sz = cur:last_raw()
		assert(ok and ffi.string(k, k_sz) == 'c')
		local ok2, err = cur:next_raw()
		assert(not ok2 and err == 'not_found')
		cur:close()
		db:commit()
	end)
end

function test.cur_each_raw()
	with_db('cur_each_raw', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		put_string(db, 't', 'b', '2')
		put_string(db, 't', 'c', '3')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local keys = {}
		for _, k, k_sz in cur:each_raw() do
			keys[#keys+1] = ffi.string(k, k_sz)
		end
		cur:close()
		db:commit()
		assert(table.concat(keys, ',') == 'a,b,c', table.concat(keys, ','))
	end)
end

function test.cur_each_reverse_raw()
	with_db('cur_each_reverse_raw', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		put_string(db, 't', 'b', '2')
		put_string(db, 't', 'c', '3')
		db:commit()
		db:begin()
		local cur = db:cursor_raw('t')
		local keys = {}
		for _, k, k_sz in cur:each_reverse_raw() do
			keys[#keys+1] = ffi.string(k, k_sz)
		end
		cur:close()
		db:commit()
		assert(table.concat(keys, ',') == 'c,b,a', table.concat(keys, ','))
	end)
end

-- CRUD -----------------------------------------------------------------------

function test.try_insert_raw_conflict()
	with_db('try_insert_raw_conflict', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v1')
		local ok, err, v, v_sz = db:try_insert_raw('t', 'k', 1, 'v2', 2)
		assert(not ok and err == 'already_exists')
		assert(ffi.string(v, v_sz) == 'v1')
		db:abort()
	end)
end

function test.try_update_raw()
	with_db('try_update_raw', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'old')
		assert(db:try_update_raw('t', 'k', 1, 'new', 3))
		local ok, v, v_sz = db:find_raw('t', 'k', 1)
		assert(ok and ffi.string(v, v_sz) == 'new')
		db:abort()
	end)
end

function test.try_update_raw_missing()
	with_db('try_update_raw_missing', function(db)
		db:begin'w'
		db:create_table_raw('t')
		local ok, err = db:try_update_raw('t', 'k', 1, 'v', 1)
		assert(not ok and err == 'not_found')
		db:abort()
	end)
end

function test.try_del_raw()
	with_db('try_del_raw', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v')
		assert(db:try_del_raw('t', 'k', 1))
		local ok = db:find_raw('t', 'k', 1)
		assert(not ok)
		db:abort()
	end)
end

function test.try_del_raw_missing()
	with_db('try_del_raw_missing', function(db)
		db:begin'w'
		db:create_table_raw('t')
		local ok, err = db:try_del_raw('t', 'k', 1)
		assert(not ok and err == 'not_found')
		db:abort()
	end)
end

function test.cursor_try_put_raw_conflict()
	with_db('cursor_try_put_raw_conflict', function(db)
		db:begin'w'
		put_string(db, 't', 'k', 'v1')
		local cur = db:cursor_raw('t')
		cur:find_raw('k', 1)
		local ok, err, v, v_sz = cur:try_put_raw('k', 1, 'v2', 2, mdbx.MDBX_NOOVERWRITE)
		assert(not ok and err == 'already_exists')
		assert(ffi.string(v, v_sz) == 'v1')
		db:abort()
	end)
end

-- table ops ------------------------------------------------------------------

function test.clear_table_raw()
	with_db('clear_table_raw', function(db)
		db:begin'w'
		put_string(db, 't', 'a', '1')
		put_string(db, 't', 'b', '2')
		db:clear_table_raw('t')
		local ok = db:find_raw('t', 'a', 1)
		assert(not ok)
		assert(db:table_exists't')
		db:commit()
	end)
end

function test.each_table()
	with_db('each_table', function(db)
		db:begin'w'
		put_string(db, 'alpha', 'k', 'v')
		put_string(db, 'beta',  'k', 'v')
		put_string(db, 'gamma', 'k', 'v')
		db:commit()
		db:begin()
		local names = {}
		for name in db:each_table() do names[#names+1] = name end
		db:commit()
		assert(table.concat(names, ',') == 'alpha,beta,gamma', table.concat(names, ','))
	end)
end

function test.table_count()
	with_db('table_count', function(db)
		db:begin'w'
		put_string(db, 'a', 'k', 'v')
		put_string(db, 'b', 'k', 'v')
		db:commit()
		db:begin()
		assert(db:table_count() == 2)
		db:commit()
	end)
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
