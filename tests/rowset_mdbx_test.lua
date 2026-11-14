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

function test.scan_param_settings()
	local schema = mdbx_schema()
	schema:import(function()
		import'schema_mdbx'
		tables.unit = {unit, idpk}
		tables.detail = {
			id, idpk,
			unit, id, not_null, child_fk'unit',
		}
	end)
	with_db('scan_param_settings', function(tdb)
		tdb:atomic('w', function()
			tdb:insert('unit', '{}', {unit = 1})
			tdb:insert('unit', '{}', {unit = 2})
			tdb:insert('detail', '{}', {id = 1, unit = 1})
			tdb:insert('detail', '{}', {id = 2, unit = 2})
		end)
		rowset.unit_details = scan_rowset{
			pk = 'id',
			params = {
				unit = {
					for_cols = 'unit',
					lookup_rowset_name = 'table_unit',
					lookup_cols = 'unit',
					auto_bind = true,
					accept_many = false,
					min = 1,
				},
			},
			scan = function(db)
				return db:scan('detail/unit', 'unit = :unit')
					:select('id, unit')
			end,
		}
		local rs = rowset.unit_details
		rs:prepare()
		local res = rs:load({unit = 1}, {rows = true})
		local param = res.params.unit
		assert(param.for_cols == 'unit')
		assert(param.lookup_rowset_name == 'table_unit')
		assert(param.lookup_cols == 'unit')
		assert(param.auto_bind == true and param.accept_many == false)
		assert(param.type == 'number' and param.min == 1)
		assert(param.max == 2^32-1)
		assert(#res.rows == 1 and res.rows[1][1] == 1)
		rowset.unit_details = nil
		rowset.lookup_unit = nil
	end, schema)
end

--a fetch on a scan with a param returns the changed rows inside the scan
--for the request's param values, and the others as removed.
function test.changed_rows_with_params()
	local schema = mdbx_schema()
	schema:import(function()
		import'schema_mdbx'
		tables.t = {
			id, idpk,
		}
		tables.child = {
			id, idpk,
			t_id, id, fk't',
			name, text,
		}
	end)
	with_db('changed_rows_with_params', function(tdb)
		tdb:atomic('w', function()
			tdb:insert('t', '{}', {id = 1})
			tdb:insert('t', '{}', {id = 2})
			tdb:insert('child', '{}', {id = 1, t_id = 1, name = 'a'})
			tdb:insert('child', '{}', {id = 2, t_id = 2, name = 'b'})
		end)
		rowset.children = scan_rowset{
			scan = function(db)
				return db:scan('child/t_id', 't_id = :t_id')
					:select('id, t_id, name')
			end,
			pk = 'id',
		}
		local rs = rowset.children
		rs:prepare()
		local params = {t_id = 1}
		local res = rs:load(params)
		assert(res.can_load_changed_rows)
		local txn_id = res.txn_id

		local function fetch()
			res = {}
			rs:load_changed_rows(res, params, txn_id)
			assert(not res.reload)
			txn_id = res.txn_id
			local ids = {} -- {id -> true}
			for _, row in ipairs(res.rows) do ids[row[1]] = true end
			local removed_ids = {} -- {id -> true}
			for _, pk in ipairs(res.removed_pks) do removed_ids[pk[1]] = true end
			return ids, removed_ids
		end

		--insert under another master: removed (the nav doesn't have it).
		tdb:atomic('w', tdb.insert, tdb, 'child', '{}',
			{id = 3, t_id = 2, name = 'c'})
		local ids, removed_ids = fetch()
		assert(not next(ids) and removed_ids[3])

		--insert and update under the requested master: rows.
		tdb:atomic('w', function()
			tdb:insert('child', '{}', {id = 4, t_id = 1, name = 'd'})
			tdb:update('child', '{}', {id = 1, name = 'a2'})
		end)
		ids, removed_ids = fetch()
		assert(ids[4] and ids[1] and not next(removed_ids))
		assert(res.rows[1][3] == 'a2' or res.rows[2][3] == 'a2')

		--moved to another master: removed; moved in: row.
		tdb:atomic('w', function()
			tdb:update('child', '{}', {id = 1, t_id = 2})
			tdb:update('child', '{}', {id = 2, t_id = 1})
		end)
		ids, removed_ids = fetch()
		assert(ids[2] and removed_ids[1] and not ids[1])

		--deleted: removed.
		tdb:atomic('w', tdb.del, tdb, 'child', 4)
		ids, removed_ids = fetch()
		assert(removed_ids[4] and not next(ids))

		--without the param the load loads no rows and returns no txn_id;
		--the fetch that follows a push answers no changes and keeps it.
		local res0 = rs:load({})
		assert(#res0.rows == 0 and res0.txn_id == nil)
		tdb:atomic('w', tdb.insert, tdb, 'child', '{}',
			{id = 5, t_id = 1, name = 'e'})
		res = rs:exec_load_changed_rows({}, {since_txn_id = null})
		assert(not res.reload and #res.rows == 0 and #res.removed_pks == 0)
		assert(res.txn_id == null)

		rowset.children = nil
		rowset.lookup_t = nil
	end, schema)
end

--a table rowset filters by its one auto_bind fk param on the server, through
--the fk's index, and fetches by it; without the param it loads every row.
function test.table_rowset_server_param()
	local schema = mdbx_schema()
	schema:import(function()
		import'schema_mdbx'
		tables.t = {
			id, idpk,
		}
		tables.part = {
			id, idpk,
			t_id, id, not_null, child_fk't',
			other_t_id, id, fk't',
			name, text,
		}
	end)
	with_db('table_rowset_server_param', function(tdb)
		tdb:atomic('w', function()
			tdb:insert('t', '{}', {id = 1})
			tdb:insert('t', '{}', {id = 2})
			tdb:insert('part', '{}', {id = 1, t_id = 1, name = 'a'})
			tdb:insert('part', '{}', {id = 2, t_id = 2, name = 'b'})
		end)
		local rs = rowset.table_part
		rs:prepare()
		local params = rs:load{}.params
		assert(params.t_id.client_filter == false)
		assert(params.other_t_id.client_filter == true)

		local function ids(rows)
			local t = {}
			for _, row in ipairs(rows) do add(t, row[1]) end
			sort(t)
			return cat(t, ',')
		end
		local res = rs:load({t_id = {1}}, {rows = true})
		assert(ids(res.rows) == '1')
		assert(res.can_load_changed_rows)
		local txn_id = res.txn_id
		assert(ids(rs:load({}, {rows = true}).rows) == '1,2')
		assert(ids(rs:load({t_id = {1, 2}}, {rows = true}).rows) == '1,2')

		--insert under the other master: removed; moved in: row.
		tdb:atomic('w', function()
			tdb:insert('part', '{}', {id = 3, t_id = 2, name = 'c'})
			tdb:update('part', '{}', {id = 2, t_id = 1})
		end)
		res = {}
		rs:load_changed_rows(res, {t_id = {1}}, txn_id)
		assert(not res.reload)
		assert(ids(res.rows) == '2')
		assert(#res.removed_pks == 1 and res.removed_pks[1][1] == 3)

		rowset.table_part = nil
		rowset.lookup_t = nil
		rowset.table_t = nil
	end, schema)
end

--table flags `internal` and info'...' reach the table and members rowsets;
--`internal` stays a field flag too.
function test.table_flags_internal_info()
	local schema = mdbx_schema()
	schema:import(function()
		import'schema_mdbx'
		tables.grp = {
			internal, info'Groups text',
			grp, idpk,
			secret, text, internal,
		}
		tables.person = {person, idpk}
		tables.grp_person = {
			internal, icon'users', members,
			grp   , id, not_null, child_fk,
			person, id, not_null, child_fk, pk(grp, person),
		}
	end)
	with_db('table_flags_internal_info', function(tdb)
		prepare_table_rowsets()
		local rs = rowset.table_grp
		assert(rs.internal and rs.info == 'Groups text')
		assert(rs.fields.secret.internal and not rs.fields.grp.internal)
		assert(rs:load{}.info == 'Groups text')
		assert(not rowset.table_person.internal)
		assert(rowset.table_grp_person.internal)
		assert(rowset.table_grp_person.label == 'Grp Person')
		assert(rowset.table_grp_person.icon == 'users')
		local listed = {} -- {rowset_name -> label}
		for _, row in ipairs(rowset.rowsets:load{}.rows) do
			listed[row[1]] = row[2]
		end
		assert(listed.table_person == 'Person')
		assert(listed.rowsets == null) --no label: the client derives it.
		assert(not listed.table_grp and not listed.table_grp_person)
		local names = {'table_grp', 'table_person', 'table_grp_person',
			'lookup_grp', 'lookup_person'}
		for _, name in ipairs(names) do
			rowset[name] = nil
		end
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
