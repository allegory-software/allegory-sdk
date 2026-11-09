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
local function with_db(name, f, schema)
	local file = test_file(name)
	cleanup(file)
	local tdb = mdbx_open(file)
	if schema then
		tdb.schema = schema
		tdb:sync_schema()
	else
		tdb:begin'w'
		tdb:create_table('t', {
			name = 't',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		tdb:commit()
	end
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
		local rs = rowset.table_t
		prepare_rowsets()
		assert(rs.name == 'table_t')
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
			assert(pushes[1].names.table_t and pushes[1].txn_id > txn_id0)
			local names, txn_id = changed_rowsets_since(tdb, txn_id0)
			assert(names.table_t and txn_id == pushes[1].txn_id)
			local names1, txn_id1 = changed_rowsets_since(tdb, txn_id)
			assert(next(names1) == nil and txn_id1 == txn_id)
			--closing the db ends the watcher thread.
			tdb:close()
		end)
		push_rowset_changed_events = push0
		rowset.table_t = nil
	end)
end

function test.prepare_table_rowsets()
	local schema = mdbx_schema()
	schema:import(function()
		import'schema_mdbx'
		tables.t = {
			id, idpk,
			name, text,
			secret, text, {internal = true},
		}
		tables.pair = {
			a, id,
			b, id, pk('a', 'b'),
		}
		tables.child = {
			id, idpk,
			t_id, id, fk't',
			c1, id,
			c2, id,
		}
		tables.terminal = {
			t_id, id, pk't_id', fk't',
			name, id, fk't',
		}
		add_fk('child', 'c1 c2', 'pair')
	end)
	with_db('prepare_table_rowsets', function(tdb)
		assert(rawget(rowset, 'table_t') == nil)
		assert(rawget(rowset, 'table_child') == nil)
		prepare_table_rowsets()
		local rs = assert(rawget(rowset, 'table_t'))
		local child_rs = assert(rawget(rowset, 'table_child'))
		assert(rs.name == 'table_t' and rs.fields.secret.internal)
		assert(child_rs.name == 'table_child' and child_rs.fields.t_id)
		assert(child_rs.fields.t_id.lookup_rowset_name == 'lookup_t')
		local child_params = child_rs:load{}.params
		local param = child_params.t_id
		assert(param.for_cols == 't_id' and param.lookup_cols == 'id')
		assert(param.lookup_rowset_name == 'table_t')
		assert(param.client_filter == true)
		assert(param.auto_bind == false)
		local pair_param = child_params['c1,c2']
		assert(pair_param.for_cols == 'c1 c2')
		assert(pair_param.lookup_cols == 'a b')
		assert(pair_param.lookup_rowset_name == 'table_pair')
		assert(pair_param.client_filter == true)
		assert(pair_param.auto_bind == false)
		local terminal_params = rowset.table_terminal:load{}.params
		assert(terminal_params.t_id.auto_bind == true)
		assert(terminal_params.name.auto_bind == false)
		local parent_ids = {} -- {tree row id -> parent id}
		for _, row in ipairs(rowset.rowsets_tree:load{}.rows) do
			parent_ids[row[1]] = row[2]
		end
		assert(parent_ids.table_child == null)
		assert(parent_ids['table_t/table_child'] == nil)
		assert(parent_ids['table_t/table_terminal'] == 'table_t')
		local lookup = assert(rawget(rowset, 'lookup_t'))
		assert(lookup.internal)
		assert(lookup:can_add_row{} == false)
		assert(lookup:can_change_row{} == false)
		assert(lookup:can_remove_row{} == false)
		local terminal = rowset.lookup_terminal
		terminal:prepare()
		for _, f in ipairs(terminal.fields) do
			assert(not f.lookup_rowset_name)
			assert(not f.lookup_cols and not f.display_col)
		end
		assert(rowset.table_terminal.fields.t_id.lookup_rowset_name == 'lookup_t')
		assert(rowset.table_terminal.fields.name.lookup_rowset_name == 'lookup_t')
		prepare_table_rowsets()
		assert(rowset.table_t == rs and rowset.table_child == child_rs)
		local listed = {}
		for _, row in ipairs(rowset.rowsets:load{}.rows) do
			listed[row[1]] = true
		end
		assert(listed.table_t and listed.table_child)
		assert(not listed.lookup_t)
		rowset.table_t = nil
		rowset.table_child = nil
		rowset.table_pair = nil
		rowset.lookup_t = nil
		rowset.table_terminal = nil
		rowset.lookup_terminal = nil
	end, schema)
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
