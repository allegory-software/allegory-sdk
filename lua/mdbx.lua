--[[

	libmdbx binding.
	Written by Cosmin Apreutesei. Public Domain.

	libmdbx is a fast mmap-based MVCC key-value store in 40 KLOC of C.
	libmdbx provides ACID with serializable semantics, good for read-heavy loads.

C->LUA

 * safe API (no use-after-free), uses our terminology (env -> db, DBI -> table).
 * extendable, see mdbx_schema.lua which adds column schema to keys and values.
 * current transaction is implicit since we can't use parallel transactions.
 * tables can be referenced by name everywhere (no need to use DBIs).
 * tables must be created explicitly and are auto-opened on data ops.
 * APIs raise on unexpected errors; expected states return nil,err or false,err.
   * 'db'-type errors are raised on unexpected mdbx errors.
   * 'schema'-type errors are raised on schema-caused errors on table ops and
	  the txn is aborted.
 * table ops are logged.
 * use DBI 1 to read the main table.

DATABASES
	mdbx_open(file_path, [opt]) -> db,[err],created   open/create a database
	- opt.max_readers    64                    max read txns across all processes
	- opt.max_tables     4K                    max tables that can be opened
	- opt.readonly       false                 open in r/o mode
	- opt.file_mode      0660                  perms for file creation
	- opt.flags                                see MDBX_env_flags
	db:[try_]close()                           close db (idempotent)
	db:closed() -> t|f                         check if db is closed
	db:max_key_size() -> n                     get max key size in bytes
	mdbx_delete(file_path, [flags])            delete a database
TRANSACTIONS
	db:begin(['w'|'r'])                        begin transaction
	db:commit()                                commit transaction
	db:abort()                                 abort transaction
	db.txn                                     current txn (nil if none)
	db:atomic(['w',], fn, ...) -> ...          run fn in transaction
TABLES
	db:[try_]dbi_raw(table|dbi) -> dbi         open existing table (once)
	db:create_table_raw(name, [flags]) -> dbi  create table
	db:rename_table_raw(table|dbi, new_name)   rename table
	db:drop_table_raw(table|dbi)               raw drop
	db:clear_table_raw(table|dbi)              delete all records
	db:each_table() -> iter() -> name          iterate table names
	db:table_count() -> n                      get number of tables
	db:table_exists(name) -> t|f               check if table exists
	db:table_stat(name|dbi) -> MDBX_stat       get table stats (shared buffer)
	db:dbi_flags(name|dbi) -> dbi_state, dbi_flags  get DBI state and flags
CRUD
	db:get_raw         (table|dbi, k, k_sz) -> true, v, v_sz | false,err
	db:try_put_raw     (table|dbi, k, k_sz, v, v_sz, [flags]) -> true | false,'already_exists',cur_v,cur_v_sz | false,'not_found'
	db:try_insert_raw  (table|dbi, k, k_sz, v, v_sz, [flags]) -> true | false,'already_exists',cur_v,cur_v_sz
	db:try_update_raw  (table|dbi, k, k_sz, v, v_sz, [flags]) -> true | false,'not_found'
	db:try_del_raw     (table|dbi, k, k_sz, [v], [v_sz]) -> true | false,'not_found'
	db:seq             (table|dbi, increment) -> n     get/increment sequence
	db:try_move_key_raw(table|dbi, k, k_sz, new_k, new_k_sz) -> true | false,err
	db:each_raw(table) -> iter() -> cur, k, k_sz, v, v_sz
	db:[try_]cursor_raw(table|dbi) -> cur      create cursor
	cur:close()                                close cursor
	cur:closed() -> t|f                        check if cursor is closed
	cur:dbi() -> dbi|nil                       get cursor's dbi
	cur:{first|last|next|prev|current}_raw() -> true, k, k_sz, v, v_sz | false,err
	cur:each[_reverse]_raw() -> iter() -> true, k, k_sz, v, v_sz
	cur:get_raw      (k, k_sz, [op]) -> true, v, v_sz | false,err
	cur:get_pair_raw (k, k_sz, v, v_sz, [op]) -> true, v, v_sz | false,err
	cur:try_put_raw  (k, k_sz, v, v_sz, [flags]) -> true | false,'already_exists',cur_v,cur_v_sz | false,'not_found'
	cur:del_raw([flags])
DEBUG
	mdbx_set_log_level(level)               set MDBX log level (now is 'warn')

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

function Db:check_schema(event, tab, col, ret, ...)
	if ret then return ret, ... end
	local e = error_for('schema', self, event, ...)
	e.table = tab
	e.col = col
	self:abort()
	error(e)
end

function Db:tryz(event, rc, fmt, ...)
	if rc == 0 then return true end
	if rc == C.MDBX_NOTFOUND then return false, 'not_found' end
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
function mdbx_open(file, opt)
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
	local event = create and 'db_create' or 'db_open'
	if rc ~= 0 then
		local err = mdbx_open_error[rc]
		if err then
			C.mdbx_env_close_ex(env, 1)
			local ok = err == 'not_found' and not create
			return check_for('db', file, event, ok or nil, err)
		end
	end
	local self = _own(owner, object(Db, {
		file = file,
		env = env,
		env_dbis = setmetatable({}, {}), --{dbi->name, name->dbi}
		readonly = opt.readonly,
		_ro_txn = nil,
		_cursors = {},
		type = 'DB',
		live_schema = {}, --{table_name->table_schema}
	}))
	self.env_dbis[MAIN_DBI] = '<main>'
	self.dbis = self.env_dbis
	live(self, file)
	log(create and 'note' or '', 'db', event, '%s', file)
	return self, nil, create
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

In mdbx all ops are transactional including table create/rename/drop.

DBIs however are weird:

 - DBIs of tables OPENED in a TOP txn are GLOBAL (env-scoped).
 - DBIs of tables OPENED in a NESTED txn are LOCAL to that txn.
 - DBIs of CREATED tables are LOCAL to the txn in which they were created.
 - LOCAL DBIs are automatically DISCARDED on abort and PROMOTED to the parent
   txn on commit and become GLOBAL when the TOP txn is committed.
 - DBIs are DISCARDED immediately from ALL txn levels on DROP and RENAME.

Since we don't want to work with DBIs in Lua but only with table names we need
to keep a TABLE_NAME->DBI mapping for opened tables. We _could_ not do this
and open tables every time to get the DBI but mdbx_open does some array scans
which become O(n^2) on repeat ops. So we keep the mapping in Lua.

Here's the invariants around these mappings (it's not pretty):

- Txns create their own dbis layers but only lazily when needed: table
  open in nested txn or table create/drop/rename in any txn (table open in a
  top txn always puts the DBI in the global env_dbis directly). The new layer
  inherits the current layer. A top txn inherits env_dbis.
- On commit, layer contents are promoted (copied over) to the parent layer.
- On both commit and abort the layer is discarded.

]]

local dbis_freelist = {}

local function local_dbis(self)
	local dbis = self.dbis
	local txn = self.txn
	if getmetatable(dbis).txn ~= txn then --not local, create
		local parent_dbis = dbis
		dbis = pop(dbis_freelist) or setmetatable({}, {})
		getmetatable(dbis).__index = parent_dbis
		getmetatable(dbis).txn = txn
		self.dbis = dbis
	end
	return dbis
end

local function local_dbis_discard(self, committed, parent)
	if getmetatable(self.dbis).txn ~= self.txn then --not local, nothing to do.
		return
	end
	--local, (promote and) discard
	local dbis = self.dbis
	local parent_dbis = getmetatable(dbis).__index
	if committed and parent and getmetatable(parent_dbis).txn ~= parent then
		--parent txn has no local maps: hand this layer to it as-is.
		getmetatable(dbis).txn = parent
		return
	end
	if committed then --promote created dbis to parent txn (env if top-level).
		update(parent_dbis, dbis)
	end
	clear(dbis)
	clear(getmetatable(dbis))
	push(dbis_freelist, dbis)
	self.dbis = parent_dbis
end

--dbi was lost from drop or rename: remove it from all layers.
local function invalidate_dbi(self, dbi, name)
	local dbis = self.dbis
	while dbis do
		dbis[dbi] = nil
		dbis[name] = nil
		dbis = getmetatable(dbis).__index
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

Db._wtxn_end = noop --stub

function Db:commit()
	check_txn(self)
	if self.txn == self._ro_txn then
		self:checkz('txn_commit', C.mdbx_txn_reset(self.txn))
		self.txn = nil
	else
		local parent = ptr(self.txn.parent)
		local rc = C.mdbx_txn_commit_ex(self.txn, nil)
		local committed = rc == 0
		local_dbis_discard(self, committed, parent)
		self:_wtxn_end(committed, parent)
		self.txn = parent
		self:checkz('txn_commit', rc)
	end
end

function Db:abort()
	check_txn(self)
	if self.txn == self._ro_txn then
		self:checkz('txn_abort', C.mdbx_txn_reset(self.txn))
		self.txn = nil
	else
		local parent = ptr(self.txn.parent)
		self:checkz('txn_abort', C.mdbx_txn_abort(self.txn))
		local_dbis_discard(self)
		self:_wtxn_end(false, parent)
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
local typeof, assert = typeof, assert
function Db:try_dbi_raw(tab, flags) --tab=name|dbi
	if typeof(tab) == 'number' then return tab end --tab=dbi
	local dbi = self.dbis[tab]
	if dbi then return dbi end
	assert(typeof(tab) == 'string', 'dbi: table expected')
	check_txn(self)
	local ok, err = self:tryz('t_open',
		C.mdbx_dbi_open(self.txn, tab, flags or C.MDBX_DB_ACCEDE, dbip))
	if not ok then return nil, err end
	local dbi = dbip[0]
	--DBIs opened in a nested txn are local to the txn, so we must create local
	--dbis/meta maps. only a top-level open is env-scoped.
	local nested_txn = self.txn.parent ~= nil
	local dbis = nested_txn and local_dbis(self) or self.env_dbis
	dbis[tab] = dbi
	dbis[dbi] = tab
	return dbi
end
function Db:dbi_raw(tab, flags)
	local dbi, err = self:try_dbi_raw(tab, flags)
	return self:check_schema('t_open', self:table_name(tab), nil, dbi, err)
end

function Db:create_table_raw(tab, create_flags)
	assert(typeof(tab) == 'string', 'create_table: table name expected')
	check_wtxn(self)
	local exists = self:table_exists(tab)
	self:check_schema('t_create', tab, nil, not exists, 'already_exists')
	--created DBIs are local to the txn, so create local dbis maps.
	local dbis = local_dbis(self)
	local flags = bor(C.MDBX_CREATE, create_flags or 0)
	self:checkz('t_create', C.mdbx_dbi_open(self.txn, tab, flags, dbip))
	local dbi = dbip[0]
	dbis[tab] = dbi
	dbis[dbi] = tab
	log('note', 'db', 't_create', '%s', tab)
	return dbi
end

function Db:rename_table_raw(tab, new_table_name)
	local old_table_name = self:table_name(tab)
	assert(isstr(new_table_name))
	check_wtxn(self)
	local dbi, err = self:try_dbi_raw(tab)
	self:check_schema('t_rename', old_table_name, nil, dbi, err)
	local old_table_name = self:table_name(tab)
	local rc = C.mdbx_dbi_rename(self.txn, dbi, new_table_name)
	self:check_schema('t_rename', old_table_name, nil,
		rc ~= C.MDBX_KEYEXIST, 'already_exists')
	self:checkz('t_rename', rc)
	--MDBX invalidates the old DBI on rename. Keep the new name txn-local
	--so commit promotes it and abort discards it.
	local dbis = local_dbis(self)
	invalidate_dbi(self, dbi, old_table_name)
	dbis[dbi] = new_table_name
	dbis[new_table_name] = dbi
	log('note', 'db', 't_rename', '%s -> %s', old_table_name, new_table_name)
	return true
end

function Db:drop_table_raw(tab)
	assert(tab)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:try_dbi_raw(tab)
	if not dbi then return false, 'not_found' end
	self:checkz('t_drop', C.mdbx_drop(self.txn, dbi, 1))
	local name = assert(self.dbis[dbi])
	local_dbis(self)
	invalidate_dbi(self, dbi, name)
	log('note', 'db', 't_drop', '%s', name)
	return true
end

function Db:clear_table_raw(tab)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:try_dbi_raw(tab)
	if not dbi then return false, 'not_found' end
	self:checkz('t_clear', C.mdbx_drop(self.txn, dbi, 0))
	log('note', 'db', 't_clear', '%s', self:table_name(tab))
	return true
end

local stat = new'MDBX_stat'
local stat_sz = sizeof(stat)
function Db:table_stat(tab)
	check_txn(self)
	local dbi = isnum(tab) and tab or self:dbi_raw(tab)
	self:checkz('t_stat', C.mdbx_dbi_stat(self.txn, dbi, stat, stat_sz))
	return stat
end

function Db:table_entries(tab)
	return num(self:table_stat(tab).entries)
end

do
local dbi_flags = new'unsigned[1]'
local dbi_state = new'unsigned[1]'
function Db:dbi_flags(tab)
	local dbi = isnum(tab) and tab or self:dbi_raw(tab)
	self:checkz('t_flags', C.mdbx_dbi_flags_ex(self.txn, dbi, dbi_flags, dbi_state))
	return dbi_state[0], dbi_flags[0]
end
end

-- table data ----------------------------------------------------------------

local key = new'MDBX_val'
local val = new'MDBX_val'

function Db:get_raw(tab, k, k_sz)
	check_txn(self)
	local dbi = isnum(tab) and tab or self:dbi_raw(tab)
	key.data = k
	key.size = k_sz
	local rc = C.mdbx_get(self.txn, dbi, key, val)
	if rc == 0 then return true, val.data, num(val.size) end
	return self:tryz('get', rc)
end

function Db:try_put_raw(tab, k, k_sz, v, v_sz, flags)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi_raw(tab)
	key.data = k
	key.size = k_sz
	val.data = v
	val.size = v_sz
	local rc = C.mdbx_put(self.txn, dbi, key, val, flags or 0)
	if rc == C.MDBX_KEYEXIST then
		return false, 'already_exists', val.data, num(val.size)
	end
	return self:tryz('put', rc)
end

function Db:try_insert_raw(tab, k, k_sz, v, v_sz, flags)
	return self:try_put_raw(tab, k, k_sz, v, v_sz,
		bor(flags or 0, C.MDBX_NOOVERWRITE))
end

function Db:try_update_raw(tab, k, k_sz, v, v_sz, flags)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi_raw(tab)
	key.data = k
	key.size = k_sz
	val.data = v
	val.size = v_sz
	return self:tryz('put', C.mdbx_put(self.txn, dbi, key, val,
		bor(flags or 0, C.MDBX_CURRENT)))
end

function Db:try_del_raw(tab, k, k_sz, v, v_sz)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi_raw(tab)
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
function Db:seq(tab, increment)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi_raw(tab)
	local rc = C.mdbx_dbi_sequence(self.txn, dbi, seqbuf, assert(increment))
	if rc < 0 then
		self:check_schema('seq', self:table_name(tab), nil, rc ~= -1, 'overflow')
		self:checkz('seq', rc)
	end
	local seq = num(seqbuf[0])
	log('note', 'db', 'seq', '%s: %d', self:table_name(tab), seq)
	return seq
end

function Db:try_move_key_raw(tab, k1, k1_sz, k2, k2_sz)
	check_wtxn(self)
	local dbi = isnum(tab) and tab or self:dbi_raw(tab)
	local _, flags = self:dbi_flags(dbi)
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

--NOTE: cursors created with db:cursor_raw() are reused, so never use a cursor
--beyond transaction boundaries or you might end up using an unrelated cursor.
local curp = new'MDBX_cursor*[1]'
function Db:try_cursor_raw(tab)
	local dbi = isnum(tab) and tab or self:dbi_raw(tab)
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

function Db:cursor_raw(tab)
	local cur, err = self:try_cursor_raw(tab)
	if cur then return cur end
	self:check_schema('cursor', self:table_name(tab), nil, false, err)
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
	if rc == C.MDBX_ENODATA then return false, 'not_found' end
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

function Cur:try_put_raw(k, k_sz, v, v_sz, flags)
	check_cursor(self)
	check_wtxn(self.db)
	key.data = k
	key.size = k_sz
	val.data = v
	val.size = v_sz
	local rc = C.mdbx_cursor_put(self.c, key, val, flags or 0)
	if rc == C.MDBX_KEYEXIST then
		return false, 'already_exists', val.data, num(val.size)
	end
	return self.db:tryz('cursor_put', rc)
end

function Cur:del_raw(flags)
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
function Db:each_raw(tab)
	local cur = self:cursor_raw(tab)
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
	local cur = self:cursor_raw(MAIN_DBI)
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
