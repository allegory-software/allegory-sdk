--[[

	libmdbx binding.
	Written by Cosmin Apreutesei. Public Domain.

	libmdbx is a fast mmap-based MVCC key-value store in 40 KLOC of C.
	libmdbx provides ACID with serializable semantics, good for read-heavy loads.

MDBX->LUA

 * safe API (no use-after-free), uses our terminology (env -> db, DBI -> table).
 * extendable, see mdbx_schema.lua which adds column schema to keys and values.
 * current transaction is implicit since we can't use parallel transactions.
 * tables can be referenced by name everywhere (no need to use DBIs).
 * tables are auto-created on write ops and auto-opened in r/o mode on read ops.
 * APIs raise on unexpected errors; expected states return nil,err or false,err.
 * write ops and errors are logged, except raw CRUD ops which are to be used
   to implement structured CRUD ops and have those be logged.
 * use DBI 1 to read the main table.

DATABASES
	[try_]mdbx_open(file_path, [opt]) -> db,[err],created   open/create a database
		opt.max_readers    64                max read txns across all processes
		opt.max_tables     4K                max tables that can be opened
		opt.readonly       false             open in r/o mode
		opt.file_mode      0660
		opt.flags                            see MDBX_env_flags
	db:[try_]close()                        close db (idempotent)
	db:closed() -> t|f                      check if db is closed
	db:max_key_size() -> n                  get max key size in bytes
	mdbx_delete(file_path, [flags]) -> true | false,'not_found'   delete a database
TRANSACTIONS
	db:begin(['w'|'r'])                     begin transaction
	db:commit()                             commit transaction
	db:abort()                              abort transaction
	db.txn                                  current txn (or nil)
	db:atomic(['w',], fn, ...) -> ...       run fn in transaction
TABLES
	db:dbi(table_name|dbi, ['r'|'w'|'c']) -> dbi              open/create table
	db:[try_]rename_table (table_name|dbi, new_table_name)    rename table
	db:[try_]drop_table   (table_name|dbi)                    drop table
	db:[try_]clear_table  (table_name|dbi)                    delete all records
	db:create_table       (table_name, ...) -> dbi, created   open or recreate (clear) table
	db:each_table() -> iter() -> table_name                   iterate table names
	db:table_count() -> n                                     get number of tables
	db:table_exists(table_name) -> t|f                        check if table exists
	db:[try_]table_stat(table_name|dbi) -> MDBX_stat          get table stats (shared buffer)
	db:try_dbi_flags(table_name|dbi) -> dbi_state, dbi_flags  get DBI state and flags
CRUD
	db:get_raw         (table_name|dbi, k, k_sz) -> true, v, v_sz | false,err
	db:try_put_raw     (table_name|dbi, k, k_sz, v, v_sz, [flags]) -> true | false,'exists',cur_v,cur_v_sz | false,'not_found'
	db:try_insert_raw  (table_name|dbi, k, k_sz, v, v_sz, [flags]) -> true | false,'exists',cur_v,cur_v_sz
	db:try_update_raw  (table_name|dbi, k, k_sz, v, v_sz, [flags]) -> true | false,'not_found'
	db:try_del_raw     (table_name|dbi, k, k_sz, [v], [v_sz]) -> true|false,err
	db:gen_id          (table_name|dbi) -> n     gen unique increasing id
	db:try_move_key_raw(table_name|dbi, k, k_sz, new_k, new_k_sz) -> true | false,err
	db:each_raw(table_name[, 'w']) -> iter() -> cur, k, k_sz, v, v_sz   missing table is empty
CURSORS
	db:cursor(table_name|dbi[, 'w']) -> cur
	cur:close()                            close cursor
	cur:closed() -> t|f                    check if cursor is closed
	cur:dbi() -> dbi
	cur:{first|last|next|prev|current}_raw() -> true, k, k_sz, v, v_sz | false,err
	cur:each[_reverse]_raw() -> iter() -> true, k, k_sz, v, v_sz
	cur:get_raw      (k, k_sz, [op]) -> true, v, v_sz | false,err
	cur:get_pair_raw (k, k_sz, v, v_sz, [op]) -> true, v, v_sz | false,err
	cur:put_raw (k, k_sz, v, v_sz, [flags]) -> true | false,'exists',cur_v,cur_v_sz | false,'not_found'
	cur:set_raw (v, v_sz) -> true | false,'not_found'
	cur:del     ([flags])
DEBUG
	mdbx_set_log_level(level)              set MDBX log level (now is 'warn')

]]

if not ... then require'mdbx_test'; return end

require'glue'
require'fs'

require'mdbx_h'
local C = ffi.load'mdbx'

local
	isnum, isstr, bor, band, num, assert =
	isnum, isstr, bor, bit.band, num, assert

mdbx = C
local MAIN_DBI = 1

-- log level -----------------------------------------------------------------

--set libmdbx's runtime log level (process-global). level names:
--  fatal < error < warn < notice < verbose < debug < trace < extra
--for levels finer than 'notice', build mdbx with MDBX_DEBUG>0 (now is 0).
local mdbx_log_levels = {
	fatal   = C.MDBX_LOG_FATAL  , error = C.MDBX_LOG_ERROR  ,
	warn    = C.MDBX_LOG_WARN   , notice = C.MDBX_LOG_NOTICE,
	verbose = C.MDBX_LOG_VERBOSE, debug  = C.MDBX_LOG_DEBUG ,
	trace   = C.MDBX_LOG_TRACE  , extra  = C.MDBX_LOG_EXTRA ,
}
local mdbx_logger_dontchange = ffi.cast('MDBX_debug_func *', -1)
function mdbx_set_log_level(level)
	local lvl = mdbx_log_levels[level]
	assert(lvl, 'invalid mdbx log level: '..tostring(level))
	C.mdbx_setup_debug(lvl, C.MDBX_DBG_DONTCHANGE, mdbx_logger_dontchange)
end
mdbx_set_log_level'warn' --mdbx default is 'notice', needlesly chatty.

-- databases -----------------------------------------------------------------

local Db = {}; mdbx_db = Db

function Db:check(...)
	return check_for('db', self, ...)
end

function Db:tryz(event, rc, fmt, ...)
	if rc == 0 then return true end
	if rc == C.MDBX_NOTFOUND then return false, 'not_found' end
	if rc == C.MDBX_KEYEXIST then return false, 'exists' end
	local err = fmt and _(fmt, ...) or str(C.mdbx_strerror(rc))
	check_for('db', self, event, false, err)
end

function Db:checkz(...)
	assert(self:tryz(...))
end

local mdbx_open_error = {
	[C.MDBX_ENOFILE] = 'not_found',
	[C.MDBX_VERSION_MISMATCH] = 'version_mismatch',
	[C.MDBX_INVALID] = 'invalid',
	[C.MDBX_EACCESS] = 'access_denied',
	[C.MDBX_INCOMPATIBLE] = 'incompatible',
	[C.MDBX_WANNA_RECOVERY] = 'need_recovery',
	[C.MDBX_TOO_LARGE] = 'too_large',
	[C.MDBX_BUSY] = 'busy',
}

local envp = new'MDBX_env*[1]'
function try_mdbx_open(file, opt)
	opt = opt or empty
	local owner = _check_owner(opt.owner)
	local create = not opt.readonly and not exists(file)
	local perms = unixperms_parse(opt.file_mode or '0660')
	if not opt.readonly then
		mkdirs(file)
	end
	assert(Db.tryz(file, 'db_create', C.mdbx_env_create(envp)))
	local env = envp[0]
	local function check_open(rc)
		if rc ~= 0 then
			C.mdbx_env_close_ex(env, 1)
			assert(Db.tryz(file, 'db_open', rc))
		end
	end
	check_open(C.mdbx_env_set_geometry(env, 0, -1, 1024e9, -1, -1, -1))
	check_open(C.mdbx_env_set_option(env, C.MDBX_opt_max_readers, opt.max_readers or 64))
	check_open(C.mdbx_env_set_option(env, C.MDBX_opt_max_db, opt.max_tables or 4096))
	local flags = bor(C.MDBX_NOSUBDIR, opt.readonly and C.MDBX_RDONLY or 0, opt.flags or 0)
	local rc = C.mdbx_env_open(env, file, flags, perms)
	if rc ~= 0 then
		local err = mdbx_open_error[rc]
		if err then
			C.mdbx_env_close_ex(env, 1)
			return nil, err, create
		end
		assert(Db.tryz(file, 'db_open', rc))
	end
	local self = _own(owner, object(Db, {
		file = file,
		env = env,
		env_dbis = setmetatable({}, {}), --{dbi->name, name->dbi}
		env_dbim = setmetatable({}, {}), --{dbi->schema}, see mdbx_schema.lua
		readonly = opt.readonly,
		_ro_txn = nil,
		_cursors = {},
		type = 'DB',
	}))
	self.env_dbis[MAIN_DBI] = '<main>'
	self.dbis = self.env_dbis
	self.dbim = self.env_dbim
	live(self, file)
	log(create and 'note' or '', 'db', create and 'db_create' or 'db_open', '%s', file)
	return self, nil, create
end

function mdbx_open(file, opt)
	local db, err, create = try_mdbx_open(file, opt)
	if not db then
		check_for('db', file, create and 'db_create' or 'db_open', false,
			'%s: %s', file, err)
	end
	return db, create
end

function Db:close()
	if not self.env then return end
	while self.txn do
		self:abort()
	end
	local ro_txn = self._ro_txn
	if ro_txn then
		self:checkz('txn_abort', C.mdbx_txn_abort(ro_txn))
		self._ro_txn = nil
	end
	for _,cur in ipairs(self._cursors) do
		self:checkz('cursor_close', C.mdbx_cursor_close2(cur.c))
		cur.c = nil
	end
	self._cursors = nil
	self:checkz('db_close', C.mdbx_env_close_ex(self.env, 0))
	live(self, nil)
	self.dbis = nil
	self.dbim = nil
	self.env = nil
	_disown(self)
end

function Db:closed()
	return not self.env
end

function Db:try_close()
	if not self.env then return true end
	self:close()
	return true
end

function Db:max_key_size()
	local rc = C.mdbx_env_get_maxkeysize_ex(self.env, C.MDBX_DB_DEFAULTS)
	assert(rc ~= -1)
	return rc
end

function mdbx_delete(file, flags)
	local rc = C.mdbx_env_delete(file, flags or 0)
	if rc == -1 then return false, 'not_found' end
	return assert(Db.tryz(file, 'db_delete', rc))
end

--dbi cache ------------------------------------------------------------------

--[[
In mdbx all ops are transactional including table create/rename/drop. DBIs
however are global with the exception of DBIs of tables opened in sub-txns and
DBIs of created tables, which are local to the txn that created them and are
automatically discarded on abort and promoted to the parent txn on commit and
become global on top txn commit. Since we don't want to work with DBIs in Lua
but only with table names we need to keep a table_name->dbi mapping for opened
tables. We _could_ not do this and open tables every time to get the DBI but
1) we also need to keep metadata (schema) for each DBI, and 2) mdbx_open does
some array scans which become O(n^2) on repeat ops. So we keep the mapping
in Lua and we match DBI lifetime semantics by creating txn-local dbis/dbim
tables when tables are opened in a sub-txn or created or renamed (in any txn).
Dropped DBIs are invalidated globally and we match that by removing them from
both txn-level and env-level dbis/dbim.
]]

local dbis_freelist = {}
local dbim_freelist = {}

local function local_dbis(self)
	local dbis = self.dbis
	local dbim = self.dbim
	local txn = self.txn
	if getmetatable(dbis).txn ~= txn then --not local, create
		local parent_dbis = dbis
		local parent_dbim = dbim
		dbis = pop(dbis_freelist) or setmetatable({}, {})
		dbim = pop(dbim_freelist) or setmetatable({}, {})
		getmetatable(dbis).__index = parent_dbis
		getmetatable(dbim).__index = parent_dbim
		getmetatable(dbis).txn = txn
		self.dbis = dbis
		self.dbim = dbim
	end
	return dbis
end

local function local_dbis_discard(self, commited, parent)
	if getmetatable(self.dbis).txn == self.txn then --local, (promote and) discard
		local dbis = self.dbis
		local dbim = self.dbim
		local parent_dbis = getmetatable(dbis).__index
		local parent_dbim = getmetatable(dbim).__index
		if commited and parent and getmetatable(parent_dbis).txn ~= parent then
			--enclosing write txn has no local maps yet: hand this layer to it
			--instead of promoting to env, so a later parent abort discards it.
			getmetatable(dbis).txn = parent
			getmetatable(dbim).txn = parent
			return
		end
		if commited then --promote created dbis to parent txn (env if top-level)
			update(parent_dbis, dbis)
			update(parent_dbim, dbim)
		end
		clear(dbis)
		clear(dbim)
		clear(getmetatable(dbis))
		clear(getmetatable(dbim))
		push(dbis_freelist, dbis)
		push(dbim_freelist, dbim)
		self.dbis = parent_dbis
		self.dbim = parent_dbim
	end
end

-- transactions --------------------------------------------------------------

local function check_txn(self)
	assert(self.txn, 'not in transaction')
end

local function check_wtxn(self)
	assert(self.txn and self.txn ~= self._ro_txn, 'not in write transaction')
end

local txnp = new'MDBX_txn*[1]'
function Db:begin(mode)
	assert(self.env, 'closed')
	if not mode or mode == 'r' then
		assert(not self.txn, 'in transaction')
		local ro_txn = self._ro_txn
		if ro_txn then
			self:checkz('txn_begin', C.mdbx_txn_renew(ro_txn))
		else
			self:checkz('txn_begin',
				C.mdbx_txn_begin_ex(self.env, nil, C.MDBX_RDONLY, txnp, nil))
			ro_txn = txnp[0]
			self._ro_txn = ro_txn
		end
		self.txn = ro_txn
	elseif mode == 'w' then
		assert(not self.readonly, 'read-only database')
		assert(not self.txn or self.txn ~= self._ro_txn, 'begin() in r/o transaction')
		self:checkz('txn_begin', C.mdbx_txn_begin_ex(self.env, self.txn, 0, txnp, nil))
		self.txn = txnp[0]
	else
		assert(false)
	end
end

function Db:commit()
	check_txn(self)
	if self.txn == self._ro_txn then
		self:checkz('txn_commit', C.mdbx_txn_reset(self.txn))
		self.txn = nil
	else
		local parent = ptr(self.txn._parent)
		local rc = C.mdbx_txn_commit_ex(self.txn, nil)
		if rc ~= 0 then
			local_dbis_discard(self)
			self.txn = parent
			self:checkz('txn_commit', rc)
		end
		local_dbis_discard(self, true, parent)
		self.txn = parent
	end
end

function Db:abort()
	check_txn(self)
	if self.txn == self._ro_txn then
		self:checkz('txn_abort', C.mdbx_txn_reset(self.txn))
		self.txn = nil
	else
		local parent = ptr(self.txn._parent)
		self:checkz('txn_abort', C.mdbx_txn_abort(self.txn))
		local_dbis_discard(self)
		self.txn = parent
	end
end

do
local function finish(self, parent_txn, ok, ...)
	if ok then
		while self.txn ~= parent_txn do
			self:commit()
		end
		return ...
	else
		while self.txn ~= parent_txn do
			self:abort()
		end
		error(..., 0)
	end
end
function Db:atomic(mode, f, ...)
	if isfunc(mode) then mode, f = 'r', mode end
	local parent_txn = self.txn
	self:begin(mode)
	return finish(self, parent_txn, pcall(f, ...))
end
end

-- tables --------------------------------------------------------------------

function Db:table_name(tab)
	assert(tab, 'table expected')
	if tab == MAIN_DBI then return '<main>' end
	return isstr(tab) and tab or self.dbis[tab]
end

local dbip = new'MDBX_dbi[1]'
function Db:try_open_table(name, mode, schema, flags)
	assert(isstr(name))
	local create_flag = mode == 'w' or mode == 'c'
	if create_flag then check_wtxn(self) else check_txn(self) end
	local dbi = self.dbis[name]
	if mode == 'c' and dbi then
		self:clear_table(dbi)
		return dbi, false
	end
	assert(not dbi)
	flags = flags or 0
	local created = not self:table_exists(name)
	if created and not create_flag then
		return nil, 'not_found'
	end
	self:checkz('t_open', C.mdbx_dbi_open(self.txn,
		name or nil, created and bor(flags, C.MDBX_CREATE) or flags, dbip))
	local dbi = dbip[0]
	--created dbis, and dbis opened in a nested txn, are local to the txn so we
	--must create local dbis/dbim maps. only a top-level open is env-scoped.
	local nested = ptr(self.txn._parent) ~= nil
	local dbis = (created or nested) and local_dbis(self) or self.env_dbis
	dbis[name] = dbi
	dbis[dbi] = name
	if mode == 'c' and not created then
		self:clear_table(dbi)
	end
	if created then
		log('note', 'db', 't_create', '%s', name)
	end
	return dbi, created
end
function Db:open_table(tab, mode, schema, flags, ...)
	local dbi, created, schema = self:try_open_table(tab, mode, schema, flags, ...)
	if dbi then return dbi, created, schema end
	self:check('t_open', false, '%s %s: %s', tab, mode or 'r', created)
end

function Db:dbi(tab, mode)
	if isnum(tab) then
		if mode == 'c' then self:clear_table(tab) end
		return tab, self.dbim[tab]
	end --tab is dbi
	assert(tab, 'table expected')
	local dbi = self.dbis[tab]
	if dbi then
		if mode == 'c' then self:clear_table(dbi) end
		return dbi, self.dbim[dbi]
	end
	local schema = self.schema and self.schema.tables[tab]
	local created
	if mode == 'w' or mode == 'c' then
		dbi, created, schema = self:open_table(tab, mode, schema)
	else
		dbi, created, schema = self:try_open_table(tab, mode, schema)
	end
	if not dbi then
		return nil, created
	else
		return dbi, schema
	end
end

function Db:localize_dbi(tab, mode)
	local dbi, inherited = self:dbi(tab, mode)
	if not dbi then return nil, inherited end
	local_dbis(self)
	return dbi, rawget(self.dbim, dbi), inherited
end

function Db:try_rename_table(tab, new_table_name)
	assert(tab)
	assert(isstr(new_table_name))
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab)
	local old_table_name = isnum(tab) and (dbi and self.dbis[dbi] or '?') or tab
	if not dbi then return false, 'not_found', old_table_name end
	local ok, err = self:tryz('t_rename',
		C.mdbx_dbi_rename(self.txn, dbi, new_table_name))
	if not ok then return false, err, old_table_name end
	--MDBX invalidates the old DBI on rename. Keep the new name/schema txn-local
	--so commit promotes it and abort discards it, and remove the old env cache
	--so abort can reopen the restored old table instead of reusing a stale DBI.
	local schema = self.dbim[dbi]
	local dbis = local_dbis(self)
	local dbim = self.dbim
	dbis[old_table_name] = false
	dbis[dbi] = new_table_name
	dbis[new_table_name] = dbi
	dbim[dbi] = schema
	self.env_dbis[old_table_name] = nil
	self.env_dbis[dbi] = nil
	self.env_dbim[dbi] = nil
	log('note', 'db', 't_rename', '%s -> %s', old_table_name, new_table_name)
	return true, nil, old_table_name
end
function Db:rename_table(tab, new_table_name)
	local ok, err, old_table_name = self:try_rename_table(tab, new_table_name)
	return self:check('t_rename', ok, '%s -> %s: %s',
		old_table_name, new_table_name, err)
end

function Db:try_drop_table(tab)
	assert(tab)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab)
	if not dbi then return false, 'not_found' end
	self:checkz('t_drop', C.mdbx_drop(self.txn, dbi, 1))
	local name = assert(self.dbis[dbi])
	self.dbis[dbi]  = nil
	self.dbis[name] = nil
	self.dbim[dbi] = nil
	--dropped dbis are discarded globally by mdbx.
	self.env_dbis[dbi]  = nil
	self.env_dbis[name] = nil
	self.env_dbim[dbi] = nil
	log('note', 'db', 't_drop', '%s', name)
	return true
end
function Db:drop_table(tab)
	local ok, err = self:try_drop_table(tab)
	if ok then return end
	self:check('t_drop', false, '%s: %s', self:table_name(tab), err)
end

function Db:try_clear_table(tab)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab)
	if not dbi then return false, 'not_found' end
	local ok, err = self:tryz('t_clear', C.mdbx_drop(self.txn, dbi, 0))
	if not ok then return false, err end
	log('note', 'db', 't_clear', '%s', self:table_name(tab))
	return ok
end
function Db:clear_table(tab)
	local ok, err = self:try_clear_table(tab)
	if ok then return end
	self:check('t_clear', false, '%s: %s', self:table_name(tab), err)
end

function Db:create_table(tbl_name, ...)
	return self:open_table(tbl_name, 'c', ...)
end

local stat = new'MDBX_stat'
local stat_sz = sizeof(stat)
function Db:try_table_stat(tab)
	check_txn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab)
	if not dbi then return nil, 'table_not_found' end
	self:checkz('t_stat', C.mdbx_dbi_stat(self.txn, dbi, stat, stat_sz))
	return stat
end
function Db:table_stat(tab)
	local stat, err = self:try_table_stat(tab)
	if stat then return stat end
	self:check('t_stat', false, '%s: %s', self:table_name(tab), err)
end

function Db:table_entries(tab)
	return num(self:table_stat(tab).entries)
end

do
local dbi_flags = new'unsigned[1]'
local dbi_state = new'unsigned[1]'
function Db:try_dbi_flags(tab)
	local dbi = isnum(tab) and tab or self:dbi(tab)
	if not dbi then return nil, 'table_not_found' end
	self:checkz('t_flags', C.mdbx_dbi_flags_ex(self.txn, dbi, dbi_flags, dbi_state))
	return dbi_state[0], dbi_flags[0]
end
end

-- table data ----------------------------------------------------------------

local key = new'MDBX_val'
local val = new'MDBX_val'

function Db:get_raw(tab, k, k_sz)
	check_txn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab)
	if not dbi then return false, 'table_not_found' end
	key.data = k
	key.size = k_sz
	local rc = C.mdbx_get(self.txn, dbi, key, val)
	if rc == 0 then return true, val.data, num(val.size) end
	return self:tryz('get', rc)
end

function Db:try_put_raw(tab, k, k_sz, v, v_sz, flags)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab, 'w')
	key.data = k
	key.size = k_sz
	val.data = v
	val.size = v_sz
	local rc = C.mdbx_put(self.txn, dbi, key, val, flags or 0)
	if rc == C.MDBX_KEYEXIST then return false, 'exists', val.data, num(val.size) end
	return self:tryz('put', rc)
end

function Db:try_insert_raw(tab, k, k_sz, v, v_sz, flags)
	return self:try_put_raw(tab, k, k_sz, v, v_sz,
		bor(flags or 0, C.MDBX_NOOVERWRITE))
end

function Db:try_update_raw(tab, k, k_sz, v, v_sz, flags)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab)
	if not dbi then return false, 'not_found' end
	key.data = k
	key.size = k_sz
	val.data = v
	val.size = v_sz
	return self:tryz('put', C.mdbx_put(self.txn, dbi, key, val,
		bor(flags or 0, C.MDBX_CURRENT)))
end

function Db:try_del_raw(tab, k, k_sz, v, v_sz)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab)
	if not dbi then return false, 'table_not_found' end
	key.data = k
	key.size = k_sz
	local vp = val
	if v then
		vp.data = v
		vp.size = v_sz
	else
		vp = nil
	end
	return self:tryz('del', C.mdbx_del(self.txn, dbi, key, vp))
end

local seqbuf = u64a(1)
function Db:gen_id(tab)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab, 'w')
	local rc = C.mdbx_dbi_sequence(self.txn, dbi, seqbuf, 1)
	assert(rc ~= -1, 'overflow')
	self:checkz('gen_id', rc)
	local seq = num(seqbuf[0])
	log('note', 'db', 'gen_id', '%s: %d', self:table_name(tab), seq)
	return seq
end

function Db:try_move_key_raw(tab, k1, k1_sz, k2, k2_sz)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi(tab)
	if not dbi then return false, 'table_not_found' end
	local _, flags = self:try_dbi_flags(dbi)
	assert(band(flags, C.MDBX_DUPSORT) == 0, 'cannot move key in DUPSORT table')
	local ok, v, v_sz = self:get_raw(dbi, k1, k1_sz)
	if not ok then
		return false, v
	end
	--NOTE: calling put before del because del invalidates the v pointer.
	local ok, err = self:try_insert_raw(dbi, k2, k2_sz, v, v_sz)
	if not ok then
		return false, err
	end
	assert(self:try_del_raw(dbi, k1, k1_sz))
	return true
end

-- cursors -------------------------------------------------------------------

local Cur = {}; mdbx_cursor = Cur

--NOTE: cursors created with db:cursor() are reused, so never use a cursor
--beyond transaction boundaries or you might end up using an unrelated cursor.
local curp = new'MDBX_cursor*[1]'
function Db:try_cursor(tab, mode)
	if mode == 'w' then check_wtxn(self) else check_txn(self) end
	local dbi = isnum(tab) and tab or self:dbi(tab, mode)
	if not dbi then return nil, 'not_found' end
	local cur
	local t = self._cursors
	for i = #t,1,-1 do --find an unbound cursor
		local cur1 = t[i]
		if cur1:closed() then
			cur = cur1
			break
		end
	end
	if cur then
		self:checkz('cursor', C.mdbx_cursor_bind(self.txn, cur.c, dbi))
	else
		self:checkz('cursor', C.mdbx_cursor_open(self.txn, dbi, curp))
		cur = object(Cur, {c = curp[0], db = self})
		add(self._cursors, cur)
	end
	return cur
end

function Db:cursor(tab, mode)
	local cur, err = self:try_cursor(tab, mode)
	if cur then return cur end
	self:check('cursor', false, '%s: %s', self:table_name(tab), err)
end

function Cur:close()
	if self:closed() then return end
	self.db:checkz('cursor_close', C.mdbx_cursor_unbind(self.c))
end

function Cur:closed()
	return not self.c or not ptr(C.mdbx_cursor_txn(self.c))
end

local function check_cursor(self)
	assert(not self:closed(), 'cursor closed')
end

function Cur:dbi()
	check_cursor(self)
	return repl(C.mdbx_cursor_dbi(self.c), 0xffffffff)
end

local function cursor_get(self, flags)
	check_cursor(self)
	local rc = C.mdbx_cursor_get(self.c, key, val, flags)
	if rc == 0 or rc == -1 then
		return true, key.data, num(key.size),
			val.data, num(val.size)
	end
	return self.db:tryz('cursor_get', rc)
end

local function cursor_each_next(self, k0)
	if k0 == 'start' then return cursor_get(self, C.MDBX_FIRST) end
	return cursor_get(self, C.MDBX_NEXT)
end

local function cursor_each_prev(self, k0)
	if k0 == 'start' then return cursor_get(self, C.MDBX_LAST) end
	return cursor_get(self, C.MDBX_PREV)
end

function Cur:first_raw   () return cursor_get(self, C.MDBX_FIRST) end
function Cur:last_raw    () return cursor_get(self, C.MDBX_LAST) end
function Cur:next_raw    () return cursor_get(self, C.MDBX_NEXT) end
function Cur:prev_raw    () return cursor_get(self, C.MDBX_PREV) end
function Cur:current_raw () return cursor_get(self, C.MDBX_GET_CURRENT) end

function Cur:each_raw         () return cursor_each_next, self, 'start' end
function Cur:each_reverse_raw () return cursor_each_prev, self, 'start' end

function Cur:get_raw(k, k_sz, op)
	key.data = k
	key.size = k_sz
	local ok, err_or_k, _, v, v_sz = cursor_get(self, op or C.MDBX_SET_KEY)
	if not ok then return ok, err_or_k end
	return true, v, v_sz
end

function Cur:get_pair_raw(k, k_sz, v, v_sz, op)
	key.data = k
	key.size = k_sz
	val.data = v
	val.size = v_sz
	local ok, err_or_k, _, v, v_sz = cursor_get(self, op or C.MDBX_GET_BOTH)
	if not ok then return ok, err_or_k end
	return true, v, v_sz
end

function Cur:put_raw(k, k_sz, v, v_sz, flags)
	check_cursor(self)
	check_wtxn(self.db)
	key.data = k
	key.size = k_sz
	val.data = v
	val.size = v_sz
	local rc = C.mdbx_cursor_put(self.c, key, val, flags or 0)
	if rc == C.MDBX_KEYEXIST then return false, 'exists', val.data, num(val.size) end
	return self.db:tryz('cursor_put', rc)
end

function Cur:set_raw(v, v_sz)
	check_cursor(self)
	check_wtxn(self.db)
	local ok, err = self.db:tryz('cursor_set',
		C.mdbx_cursor_get(self.c, key, val, C.MDBX_GET_CURRENT))
	if not ok then
		return false, err
	end
	val.data = v
	val.size = v_sz
	ok, err = self.db:tryz('cursor_set',
		C.mdbx_cursor_put(self.c, key, val, C.MDBX_CURRENT))
	if not ok then
		return false, err
	end
	return true
end

function Cur:del(flags)
	check_cursor(self)
	check_wtxn(self.db)
	self.db:checkz('cursor_del', C.mdbx_cursor_del(self.c, flags or 0))
end

local function each_raw_next(self)
	local ok, k, k_sz, v, v_sz = cursor_get(self, C.MDBX_NEXT)
	if not ok then
		self:close()
		return
	end
	return self, k, k_sz, v, v_sz
end
function Db:each_raw(tab, mode)
	local cur = self:try_cursor(tab, mode)
	if not cur then
		return noop
	end
	return each_raw_next, cur
end

-- table catalog -------------------------------------------------------------

do
local function next_table(self)
	local ok, k, k_sz = cursor_get(self, C.MDBX_NEXT)
	if not ok then
		self:close()
		return
	end
	return str(k, k_sz)
end
function Db:each_table()
	local cur = self:cursor(MAIN_DBI)
	return next_table, cur
end
end
function Db:table_count()
	return num(self:table_stat(MAIN_DBI).entries)
end
function Db:table_exists(table_name)
	check_txn(self)
	assert(table_name, 'table expected')
	if table_name == MAIN_DBI then return true end --main table always exists.
	if self.dbis[table_name] then return true end --opened thus exists
	return (self:get_raw(MAIN_DBI, table_name, #table_name))
end
