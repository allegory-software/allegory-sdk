require'rowset_mdbx'
require'proc'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function test_file(name)
	return '/tmp/sdk_rowset_mdbx_test_'..name..'_'..uuid()..'.mdb'
end

local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
	os.remove(file..'.changes')
end

local current_db -- db returned by db(), set by with_db()
function db() return current_db end

--run f(db, file) against a fresh isolated db with table t and its changes
--file open. db() returns that db while f runs.
local function with_db(name, f)
	local file = test_file(name)
	cleanup(file)
	local tdb = mdbx_open(file)
	tdb:begin'w'
	tdb:create_table('t', {
		name = 't',
		fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
		pk = {'id'},
	})
	tdb:commit()
	tdb:open_changes_file(pagesize())
	current_db = tdb
	local ok, err = xpcall(f, debug.traceback, tdb, file)
	current_db = nil
	if tdb.env then tdb:close() end
	cleanup(file)
	assert(ok, err)
end

function test.push_from_other_process()
	with_db('push_from_other_process', function(tdb, file)
		rowset.t_rs = table_rowset('t', {db = tdb})
		prepare_rowsets()
		local pushes = {} -- {{names = {rowset_name -> true}, txn_id = n}, ...}
		local waiter -- wait_job resumed by the first push
		local push0 = push_rowset_changed_events
		function push_rowset_changed_events(rowset_names, txn_id)
			add(pushes, {names = rowset_names, txn_id = txn_id})
			if waiter then waiter:resume() end
		end
		local code = [[
require'mdbx_schema'
local db = mdbx_open(arg[1])
db:open_changes_file(pagesize())
db:begin'w'
db:insert('t', '{}', {id = 1})
db:insert('t', '{}', {id = 2})
db:commit()
db:close()
]]
		run(function()
			local txn_id0 = tdb:atomic('r', tdb.txn_id, tdb)
			watch_row_changes(tdb)
			local process = exec{
				cmd = {
					exefile(), '-joff', '-lscite', '-e', code,
					'/dev/null', file,
				},
			}
			local exit_code = process:wait(10)
			process:forget()
			assert(exit_code == 0, 'child failed')
			if #pushes == 0 then
				waiter = wait_job()
				waiter:wait(5)
			end
			assert(#pushes == 1, 'no push from the other process')
			assert(pushes[1].names.t_rs and pushes[1].txn_id > txn_id0)
			--closing the db ends the watcher thread.
			tdb:close()
		end)
		push_rowset_changed_events = push0
		rowset.t_rs = nil
	end)
end

local name = ...
if name == 'rowset_mdbx_test' then name = nil end
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
