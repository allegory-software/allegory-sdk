require'rowset_mdbx'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function test_file(name)
	return '/tmp/sdk_rowset_members_test_'..name..'_'..uuid()..'.mdb'
end

local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
	os.remove(file..'.changes')
end

local current_db -- db returned by db(), set by with_db()
function db() return current_db end

local function members_schema()
	local schema = mdbx_schema()
	schema:import(function()
		import'schema_mdbx'
		tables.grp = {
			grp   , idpk,
			name  , name,
		}
		tables.person = {
			person, idpk,
			name  , name,
			email , text,
		}
		tables.grp_person = {
			grp   , id, not_null, child_fk,
			person, id, not_null, child_fk, pk(grp, person),
			role  , text,
		}
	end)
	return schema
end

--run f(db, rs) against a fresh db with two groups, three persons and the
--links g1-p1 (role 'admin') and g2-p3. db() returns that db while f runs.
local function with_db(name, f)
	local file = test_file(name)
	cleanup(file)
	local tdb = mdbx_open(file)
	tdb.schema = members_schema()
	tdb:sync_schema()
	tdb:open_changes_file(pagesize())
	current_db = tdb
	local ok, err = xpcall(function()
		tdb:atomic('w', function()
			tdb:insert('grp', '{}', {grp = 1, name = 'g1'})
			tdb:insert('grp', '{}', {grp = 2, name = 'g2'})
			tdb:insert('person', '{}', {person = 1, name = 'p1', email = 'e1'})
			tdb:insert('person', '{}', {person = 2, name = 'p2', email = 'e2'})
			tdb:insert('person', '{}', {person = 3, name = 'p3', email = 'e3'})
			tdb:insert('grp_person', '{}', {grp = 1, person = 1, role = 'admin'})
			tdb:insert('grp_person', '{}', {grp = 2, person = 3})
		end)
		local rs = rowset.members_grp_person
		rs:prepare()
		f(tdb, rs)
	end, debug.traceback)
	current_db = nil
	rowset.members_grp_person = nil
	rowset.lookup_grp = nil
	rowset.lookup_person = nil
	if tdb.env then tdb:close() end
	cleanup(file)
	assert(ok, err)
end

--{'GRP PERSON' -> row} for the rows of res.
local function rows_by_key(rs, rows)
	local t = {}
	for _, row in ipairs(rows) do
		t[row[2]..' '..row[3]] = row
	end
	return t
end

local function col(rs, row, name)
	return row[rs.fields[name].index]
end

local function save(rs, values, param_vals)
	local res = rs:apply_changes({rows = {{type = 'update', values = values}}},
		param_vals or {})
	local rt = res.rows[1]
	assert(not rt.error and not rt.field_errors, rt.error)
	return rt
end

function test.fields()
	with_db('fields', function(tdb, rs)
		local f = rs.fields
		assert(rs.pk == 'grp person')
		assert(f.grp.readonly and f.grp.hidden)
		assert(f.person.readonly and f.person.hidden)
		assert(f.person.lookup_rowset_name == 'lookup_person')
		assert(f['$member'].type == 'bool' and not f['$member'].readonly)
		assert(not f.role.readonly and not f.role.hidden)
		assert(f.grp_name.readonly and not f.grp_name.hidden)
		assert(f.person_name.readonly and not f.person_name.hidden)
		assert(f.person_email.readonly and f.person_email.hidden)
		assert(not f.person_person and not f.grp_grp)
		assert(rs.can_add_rows == false and rs.can_remove_rows == false)
		assert(rs.can_change_rows ~= false)
		local params = rs:load{}.params
		assert(params.grp.for_cols == 'grp')
		assert(params.grp.lookup_rowset_name == 'table_grp')
		assert(params.person.for_cols == 'person')
	end)
end

function test.load_cartesian()
	with_db('load_cartesian', function(tdb, rs)
		local rows = rows_by_key(rs, rs:load{grp = {1, 2}}.rows)
		assert(count(rows) == 6)
		assert(col(rs, rows['1 1'], '$member') == true)
		assert(col(rs, rows['1 1'], 'role') == 'admin')
		assert(col(rs, rows['1 1'], 'person_email') == 'e1')
		assert(col(rs, rows['1 2'], '$member') == false)
		assert(col(rs, rows['1 2'], 'role') == null)
		assert(col(rs, rows['1 2'], 'person_name') == 'p2')
		assert(col(rs, rows['2 3'], '$member') == true)
		assert(col(rs, rows['2 1'], '$member') == false)
	end)
end

function test.load_params()
	with_db('load_params', function(tdb, rs)
		local rows = rows_by_key(rs, rs:load{grp = {1}}.rows)
		assert(count(rows) == 3)
		assert(rows['1 1'] and rows['1 2'] and rows['1 3'])
		rows = rows_by_key(rs, rs:load{grp = {1, 2}, person = {3}}.rows)
		assert(count(rows) == 2)
		assert(col(rs, rows['1 3'], '$member') == false)
		assert(col(rs, rows['2 3'], '$member') == true)
		assert(#rs:load{grp = {}}.rows == 0)
		--the scan for {grp} is reused with other values.
		rows = rows_by_key(rs, rs:load{grp = {2}}.rows)
		assert(count(rows) == 3 and rows['2 1'])
	end)
end

function test.check_uncheck()
	with_db('check_uncheck', function(tdb, rs)
		local rt = save(rs, {['grp:old'] = 1, ['person:old'] = 2,
			['$member'] = true}, {grp = {1}})
		assert(tdb:atomic('r', tdb.exists, tdb, 'grp_person', 1, 2))
		assert(col(rs, rt.values, '$member') == true)
		rt = save(rs, {['grp:old'] = 1, ['person:old'] = 1,
			['$member'] = false}, {grp = {1}})
		assert(not tdb:atomic('r', tdb.exists, tdb, 'grp_person', 1, 1))
		assert(col(rs, rt.values, '$member') == false)
		assert(col(rs, rt.values, 'role') == null)
		assert(col(rs, rt.values, 'person_name') == 'p1')
	end)
end

function test.check_linked_row()
	with_db('check_linked_row', function(tdb, rs)
		local rt = save(rs, {['grp:old'] = 1, ['person:old'] = 1,
			['$member'] = true}, {grp = {1}})
		assert(col(rs, rt.values, '$member') == true)
		assert(col(rs, rt.values, 'role') == 'admin')
		assert(tdb:atomic('r', tdb.must_find, tdb, 'grp_person', 'role', 1, 1)
			== 'admin')
	end)
end

function test.edit_value_col()
	with_db('edit_value_col', function(tdb, rs)
		--unchecked row: the edit inserts the link row.
		local rt = save(rs, {['grp:old'] = 2, ['person:old'] = 2,
			role = 'guest'})
		assert(col(rs, rt.values, '$member') == true)
		assert(col(rs, rt.values, 'role') == 'guest')
		--checked row: the edit updates the link row.
		rt = save(rs, {['grp:old'] = 1, ['person:old'] = 1, role = 'owner'})
		assert(tdb:atomic('r', tdb.must_find, tdb, 'grp_person', 'role', 1, 1)
			== 'owner')
	end)
end

function test.changed_rows()
	with_db('changed_rows', function(tdb, rs)
		local params = {grp = {1}}
		local txn_id = rs:load(params).txn_id

		--link insert in another group: not requested.
		tdb:atomic('w', tdb.insert, tdb, 'grp_person', '{}',
			{grp = 2, person = 2})
		local res = {}
		rs:load_changed_rows(res, params, txn_id)
		assert(not res.reload and #res.rows == 0)

		--link insert in the requested group.
		txn_id = res.txn_id
		tdb:atomic('w', tdb.insert, tdb, 'grp_person', '{}',
			{grp = 1, person = 3})
		res = {}
		rs:load_changed_rows(res, params, txn_id)
		assert(#res.rows == 1)
		assert(res.rows[1][2] == 1 and res.rows[1][3] == 3)
		assert(col(rs, res.rows[1], '$member') == true)

		--link delete: the row stays, unchecked.
		txn_id = res.txn_id
		tdb:atomic('w', tdb.del, tdb, 'grp_person', 1, 3)
		res = {}
		rs:load_changed_rows(res, params, txn_id)
		assert(#res.rows == 1 and col(rs, res.rows[1], '$member') == false)

		--lookup update: the person's row in each requested group.
		txn_id = res.txn_id
		tdb:atomic('w', tdb.update, tdb, 'person', '{}',
			{person = 2, name = 'p2b'})
		res = {}
		rs:load_changed_rows(res, {}, txn_id)
		local rows = rows_by_key(rs, res.rows)
		assert(count(rows) == 2)
		assert(col(rs, rows['1 2'], 'person_name') == 'p2b')
		assert(col(rs, rows['2 2'], '$member') == true)

		--lookup insert: a new row per group.
		txn_id = res.txn_id
		tdb:atomic('w', tdb.insert, tdb, 'person', '{}',
			{person = 4, name = 'p4'})
		res = {}
		rs:load_changed_rows(res, params, txn_id)
		assert(#res.rows == 1 and res.rows[1][3] == 4)

		--lookup delete: full reload.
		txn_id = res.txn_id
		tdb:atomic('w', tdb.del, tdb, 'person', 4)
		res = {}
		rs:load_changed_rows(res, params, txn_id)
		assert(res.reload)
	end)
end

local name = ...
if name == 'rowset_members_test' then name = nil end
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
