--[==[

	SQL database access
	Written by Cosmin Apreutesei. Public Domain.

PREPROCESSOR

	sqlval(s) -> s                                 quote string to SQL literal
	sqlname(s) -> s                                quote string to SQL identifier
	sqlparams(s, t) -> s                           quote query with :name placeholders.
	sqlquery(s, t) -> s                            quote query with any preprocessor directives.
	sqlrows(rows[, opt]) -> s                      quote rows to SQL insert values list
	null                                           placeholder for null value in params and results
	sql_default                                    placeholder for "default value" in params
	qsubst(typedef)                                create a substitution definition
	qmacro.<name> = f(args...)                     create a macro definition

	sqlpp([ns])                                    get the sqlpp instance, for extending.
	sqlpps.ENGINE                                  get the sqlpp instance, for extending.

EXECUTION

	db([ns]) -> db                                 get a sqlpp connection
	[db:]create_db([ns])                           create database
	[db:]query([opt,]sql, ...) -> rows             query and return rows in a table
	[db:]first_row([opt,]sql, ...) -> t            query and return first row or value
	[db:]first_row_vals([opt,]sql, ...) -> v1,...  query and return the first row unpacked
	[db:]each_row([opt,]sql, ...) -> iter          query and iterate rows
	[db:]each_row_vals([opt,]sql, ...) -> iter     query and iterate rows unpacked
	[db:]each_group(col, [opt,]sql, ...) -> iter   query, group rows and and iterate groups
	[db:]atomic(f)                                 run f in transaction
	[db:]on_table_changed(f)                       run f(schema, table) when a table changes
	[db:]start_transaction()                       start transaction
	[db:]end_transaction('commit'|'rollback')      end transaction
	[db:]commit()                                  commit
	[db:]rollback()                                rollback

	release_dbs()                                  release db connections back into the pool

DDL

	[db:]db_exists(dbname) -> t|f                  check if db exists
	[db:]table_def(tbl) -> def                     table definition
	[db:]drop_table(name)                          drop table
	[db:]drop_tables('T1 T2 ...')                  drop multiple tables
	[db:]table_exists(tbl) -> t|f                  check if table exists
	[db:]add_column(tbl, name, type, pos)          add column
	[db:]rename_column(tbl, old_name, new_name)    rename column
	[db:]drop_column(tbl, col)                     remove column
	[db:][re]add_fk(tbl, col, ...)                 (re)create foreign key
	[db:][re]add_uk(tbl, col)                      (re)create unique key
	[db:][re]add_ix(tbl, col)                      (re)create index
	[db:]drop_fk(tbl, col)                         drop foreign key
	[db:]drop_uk(tbl, col)                         drop unique key
	[db:]drop_ix(tbl, col)                         drop index
	[db:][re]add_trigger(name, tbl, on, code)      (re)create trigger
	[db:]drop_trigger(name, tbl, on)               drop trigger
	[db:][re]add_proc(name, args, code)            (re)create stored proc
	[db:]drop_proc(name)                           drop stored proc
	[db:][re]add_column_locks(tbl, cols)           trigger to make columns read-only

DEBUGGING

	pqr(opt | rows,fields)                         pretty-print query result
	outpqr(opt | rows,fields)                      same but using out()

]==]

require'webb'
require'connpool'
require'mysql_print'
require'sqlpp'

sqlpps = {}
sqlpps.mysql     = sqlpp'mysql'
sqlpps.tarantool = sqlpp'tarantool'
local default_port = {mysql = 3306, tarantool = 3301}
local pool = connpool()

sql_default = {'default'}

sqlpps.mysql    .define_symbol('null', null)
sqlpps.tarantool.define_symbol('null', null)

sqlpps.mysql    .define_symbol('default', sql_default)
sqlpps.tarantool.define_symbol('default', sql_default)

qsubst = sqlpps.mysql.subst
qmacro = sqlpps.mysql.macro

ttsubst = sqlpps.tarantool.subst
ttmacro = sqlpps.tarantool.macro

local function pconfig(ns, k, default)
	if ns then
		return config(ns..'_'..k, config(k, default))
	else
		return config(k, default)
	end
end

function dbname(ns)
	return pconfig(ns, 'db_name')
		or pconfig(ns, 'db_name', scriptname..(ns and '_'..ns or ''))
end

local conn_opt = memoize(function(ns)
	local t = {}
	local engine = pconfig(ns, 'db_engine', 'mysql')
	t.sqlpp      = assert(sqlpps[engine])
	t.host       = pconfig(ns, 'db_host', '127.0.0.1')
	t.port       = pconfig(ns, 'db_port', assert(default_port[engine]))
	t.user       = pconfig(ns, 'db_user', 'root')
	t.pass       = pconfig(ns, 'db_pass', 'root')
	t.db         = dbname(ns)
	t.charset    = 'utf8mb4'
	t.pool_key   = t.user..'@'..t.host..':'..t.port..':'..(t.db or '')
	t.tracebacks = true
	t.schema     = pconfig(ns, 'db_schema')
	return t
end)

function sqlpp(ns)
	return conn_opt(ns or false).sqlpp
end

local DBS = {}

local function _release_dbs(dbs, ok)
	for key, db in pairs(dbs) do
		if db:in_transaction() then
			db:end_transaction(ok and 'commit' or 'rollback')
		end
	end
	for key, db in pairs(dbs) do
		db:release()
		dbs[key] = nil
	end
end

local function getownthreaddbs(thread, create_env)
	local env = getownthreadenv(thread, create_env)
	local dbs = env and rawget(env, DBS)
	if not dbs then
		if create_env ~= false then
			dbs = {}
			rawset(env, DBS, dbs)
			onthreadfinish(thread, function(thread, ok)
				_release_dbs(dbs, ok)
			end)
		end
	end
	return dbs
end

function release_dbs()
	local dbs = getownthreaddbs(nil, false)
	if not dbs then return end
	_release_dbs(dbs, true)
end

--NOTE: browsers keep multiple connections open, and even keep them
--open for a while after closing the last browser window(!), and
--we don't want to hold on to pooled resources like db connections
--on idle http connections, so we're releasing them after each request.

function db(ns, without_current_db)
	local opt = conn_opt(ns or false)
	local key = opt.pool_key
	local thread = currentthread()
	local dbs = getownthreaddbs(thread)
	local req = _G.http_request and http_request(thread)
	if req and thread == req.thread then
		if not req._release_dbs_hooked then
			http_request():onfinish(function(req, ok)
				_release_dbs(dbs, ok)
			end)
			req._release_dbs_hooked = true
		end
	end
	local db, err = dbs[key]
	if not db then
		db, err = pool:get(key)
		if not db then
			assert(err == 'empty', err)
			if without_current_db then
				opt = update({}, opt)
				opt.db = nil
			end
			db = opt.sqlpp.connect(opt)
			pool:put(key, db, db.rawconn.f)
		end
		db:start_transaction()
		dbs[key] = db
	end
	return db
end

function create_db(ns)
	local db = db(ns, true)
	local dbname = dbname(ns)
	db:create_db(dbname)
	local schema = conn_opt(ns or false).schema
	db:use(dbname, schema)
	return db
end

for method in pairs{
	--preprocessor
	sqlval=1, sqlrows=1, sqlname=1, sqlparams=1, sqlquery=1,
	--query execution
	query=1, first_row=1, first_row_vals=1, each_row=1, each_row_vals=1, each_group=1,
	atomic=1, on_table_changed=1,
	start_transaction=1, end_transaction=1, commit=1, rollback=1,
	--schema reflection
	dbs=1, db_exists=1, table_def=1,
	--ddl
	drop_table=1, drop_tables=1, table_exists=1,
	add_column=1, rename_column=1, drop_column=1,
	add_check=1, readd_check=1, drop_check=1,
	add_fk=1, readd_fk=1, drop_fk=1,
	add_uk=1, readd_uk=1, drop_uk=1,
	add_ix=1, readd_ix=1, drop_ix=1,
	add_trigger=1, readd_trigger=1, drop_trigger=1,
	add_proc=1, read_proc=1, drop_proc=1,
	add_column_locks=1, readd_column_locks=1,
	--mdl
	insert_row=1, insert_or_update_row=1, update_row=1, delete_row=1,
} do
	_G[method] = function(...)
		local db = db()
		return db[method](db, ...)
	end
end

function pqr(rows, fields)
	local opt = rows.rows and rows or {rows = rows, fields = fields}
	return mysql_print.result(opt)
end

function outpqr(rows, fields)
	local opt = rows.rows and update({}, rows) or {rows = rows, fields = fields}
	opt.print = outprint
	mysql_print.result(opt)
end


if not ... then

config('db_host', '10.0.0.5')
config('db_port', 3307)
config('db_name', 'information_schema')

run(function()
	for _,s in each_row_vals([[
		select table_name from tables where table_schema = ?
	]], 'mysql') do
		pr(s)
	end
end)

end
