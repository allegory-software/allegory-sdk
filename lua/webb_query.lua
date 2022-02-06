--[==[

	webb | SQL database access
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
	[db:]each_row([opt,]sql, ...) -> iter          query and iterate rows
	[db:]each_row_vals([opt,]sql, ...) -> iter     query and iterate rows unpacked
	[db:]each_group(col, [opt,]sql, ...) -> iter   query, group rows and and iterate groups
	[db:]atomic(func)                              execute func in transaction

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

	pqr(rows, cols)                                pretty-print query result

]==]

require'webb'
sqlpps = {}
sqlpps.mysql     = require'sqlpp'.new'mysql'
sqlpps.tarantool = require'sqlpp'.new'tarantool'
local default_port = {mysql = 3306, tarantool = 3301}
local pool = require'connpool'.new{log = webb.log}
local mysql_print = require'mysql_print'

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
	local default = assert(config'app_name')..(ns and '_'..ns or '')
	return pconfig(ns, 'db_name', default)
end

local conn_opt = glue.memoize(function(ns)
	local t = {}
	local engine = pconfig(ns, 'db_engine', 'mysql')
	t.sqlpp      = assert(sqlpps[engine])
	t.host       = pconfig(ns, 'db_host', '127.0.0.1')
	t.port       = pconfig(ns, 'db_port', assert(default_port[engine]))
	t.user       = pconfig(ns, 'db_user', 'root')
	t.password   = pconfig(ns, 'db_pass')
	t.db         = dbname(ns)
	t.charset    = 'utf8mb4'
	t.pool_key   = t.user..'@'..t.host..':'..t.port..':'..(t.db or '')
	t.tracebacks = true
	t.schema     = pconfig(ns, 'db_schema')
	return t
end)

function sqlpp(ns)
	return conn_opt(ns).sqlpp
end

function db(ns, without_current_db)
	ns = ns or false
	local opt = conn_opt(ns)
	local key = opt.pool_key
	local thread = currentthread()
	local env = attr(threadenv, thread)
	local dbs = env.dbs
	if not dbs then
		dbs = {}
		env.dbs = dbs
		onthreadfinish(thread, function()
			for _,db in pairs(dbs) do
				db:release()
			end
		end)
	end
	local db, err = dbs[key]
	if not db then
		db, err = pool:get(key)
		if not db then
			if err == 'empty' then
				if without_current_db then
					opt = update({}, opt)
					opt.db = nil
				end
				db = opt.sqlpp.connect(opt)
				pool:put(key, db, db.rawconn.tcp)
				dbs[key] = db
			else
				assert(nil, err)
			end
		end
	end
	return db
end

function create_db(ns)
	local db = db(ns, true)
	local dbname = dbname(ns)
	db:create_db(dbname)
	db:use(dbname)
end

function sqlpps.mysql.fk_message_remove()
	return S('fk_message_remove', 'Cannot remove {foreign_entity}: remove any associated {entity} first.')
end

function sqlpps.mysql.fk_message_set()
	return S('fk_message_set', 'Cannot set {entity}: {foreign_entity} not found in database.')
end

for method, name in pairs{
	--preprocessor
	sqlval=1, sqlrows=1, sqlname=1, sqlparams=1, sqlquery=1,
	--query execution
	query=1, first_row=1, each_row=1, each_row_vals=1, each_group=1,
	atomic=1,
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
	name = type(name) == 'string' and name or method
	_G[name] = function(...)
		local db = db()
		return db[method](db, ...)
	end
end

function pqr(rows, cols)
	return mysql_print.result(rows, cols)
end
