--[[

	webb_auth mdbx storage

]]

function auth_schema()

	import'schema_mdbx'

	tables.tenant = {
		tenant      , idpk,
		name        , name,
		active      , bool1,
		ctime       , ctime,
	}

	tables.host = {
		host        , str, pk, --lowercase
		tenant      , id, not_null, child_fk,
	}

	tables.usr = {
		usr         , idpk    ,
		anonymous   , bool1   ,
		email       , email   ,
		emailvalid  , bool0   ,
		pass        , str     , --bcrypt_hash() is ascii nozero 60 chars
		active      , bool1   ,
		title       , name    ,
		name        , name    ,
		phone       , str     ,
		phonevalid  , bool0   ,
		sex         , enum'M F O',
		birthday    , date    ,
		newsletter  , bool0   ,
		roles       , tags    ,
		note        , text    ,
		theme       , str     ,
		auth_code   , str     , --six_digit_code()
		auth_code_created  , time ,
		auth_code_trycount , count, --capped by the auth_code_maxtry config
		auth_code_validates, enum'email phone',
		clientip    , str     , --when it was created
		atime       , atime   , --last access time
		ctime       , ctime   , --creation time
		mtime       , mtime   , --last modification time
	}

	tables.usr_tenant = {
		usr         , id, not_null, child_fk,
		tenant      , id, not_null, child_fk, pk(usr, tenant),
		--copies of usr.email and usr.phone, unique per tenant.
		email       , email, uk(tenant, email),
		phone       , str  , uk(tenant, phone),
	}

	tables.sess = {
		--the session id is tohex() of 16 random bytes, so always 32 chars.
		sess        , {str, maxlen = 32, fixed}, not_null, pk,
		tenant      , id     , not_null, child_fk,
		usr         , id     , not_null, child_fk,
		clientip    , str    , --when it was created
		atime       , atime  , --last use, for expiry
		ctime       , ctime  ,
	}

	if _G.multilang() then

		import'lang'

		add_cols('usr after note', {
			lang        , lang    , weak_fk,
			country     , country , weak_fk,
		})

	end

end

require'schema'
require'webb_auth'
require'mdbx_scan'

db_schema:import(auth_schema)

local store = {}

local function checknotexists(NAME, val)
	allow(not val,
		S(NAME..'_already_exists', NAME..' already exists: %s', val))
end

local function normalize_host(host)
	return host:trim():lower()
end

local function check_tenant(tid)
	return checkfound(db():exists('tenant', tid) and tid,
		S('invalid_tenant', 'Invalid tenant'))
end

local function check_user(uid)
	return checkfound(db():exists('usr', uid) and uid,
		S('invalid_user', 'Invalid user'))
end

function store.with_lock(lock_type, fn, ...)
	return db():atomic(lock_type, fn, ...)
end

--hosts and tenants ----------------------------------------------------------

local function find_tenant_by_host(host)
	return db():find('host', 'tenant', normalize_host(host))
end
--callable without the lock.
local function try_tenant_by_host(host)
	return db():atomic('any', find_tenant_by_host, host)
end
local function tenant_by_host(host)
	return checkfound(try_tenant_by_host(host),
		S('invalid_host', 'Invalid host: %s', host))
end
store.try_tenant_by_host = try_tenant_by_host
store.tenant_by_host = tenant_by_host

function store.tenants()
	local t = {}
	for _, host, tid in db():each('host', 'tenant') do
		t[#t+1] = {
			host = host,
			tenant = tid,
		}
	end
	return t
end

function store.add_tenant()
	return db():insert('tenant', '{}', {})
end

function store.add_host(host, tid)
	check_tenant(tid)
	db():insert('host', '{}', {
		host = normalize_host(host),
		tenant = tid,
	})
end

function store.del_host(host)
	db():del('host', normalize_host(host))
end

--hosts, user memberships and sessions are deleted by fk cascade.
function store.del_tenant(tid)
	db():del('tenant', tid)
end

function store.rename_host(old_host, new_host)
	checknotexists('host', try_tenant_by_host(new_host) and new_host)
	local tid = tenant_by_host(old_host)
	store.del_host(old_host)
	store.add_host(new_host, tid)
end

local function tenant_exists(tid)
	return (db():exists('tenant', tid))
end
--callable without the lock.
function store.tenant_exists(tid)
	return db():atomic('any', tenant_exists, tid)
end

--sessions -------------------------------------------------------------------

function store.add_session(tid, sid, uid)
	check_tenant(tid)
	check_user(uid)
	db():insert('sess', '{}', {sess = sid, tenant = tid, usr = uid})
end

function store.load_session(tid, sid)
	local sess_tid, uid, atime = db():find('sess', 'tenant usr atime', sid)
	if sess_tid ~= tid then return nil end --not found or other tenant's
	if atime + store.session_lifetime < now() then return nil, 'expired' end
	return uid
end

function store.del_session(tid, sid)
	if db():find('sess', 'tenant', sid) ~= tid then return end
	db():del('sess', sid)
end

local function touch_session(tid, sid)
	if db():find('sess', 'tenant', sid) ~= tid then return end
	db():update('sess', '{}', {sess = sid, atime = now()})
end
--callable without the lock.
function store.touch_session(tid, sid)
	db():atomic('w', touch_session, tid, sid)
end

--users ----------------------------------------------------------------------

local function decode_roles(s) -- 'role1 ...' | nil -> {role -> true}
	local t = {}
	if s then
		for role in words(s) do
			t[role] = true
		end
	end
	return t
end

local function encode_roles(roles) -- {role -> true} -> 'role1 ...' | null
	local t = {}
	for role, v in sortedpairs(roles) do
		if v then add(t, role) end
	end
	return #t > 0 and cat(t, ' ') or null
end

--user table: usr row fields + id, tenants, decoded roles.
local function user_row(u) -- user table -> usr row without the pk
	local row = update({}, u)
	row.id = nil
	row.tenants = nil
	row.roles = encode_roles(u.roles)
	return row
end

--built on first use because db:scan() needs a transaction.
local user_tenants_scan -- rows{uid} -> tid,...
local user_sessions_scan -- rows{uid} -> (sid, tid),...

local function load_tenants(uid) -- -> {tid1,...}
	local t = {}
	user_tenants_scan = user_tenants_scan
		or db():scan('usr_tenant', 'usr = ?'):select'tenant'
	for _, tid in user_tenants_scan:rows{uid} do
		t[#t+1] = tid
	end
	return t
end

local function try_load_user(uid)
	local u = db():find('usr', '{}', uid)
	if not u then return end
	u.id = uid
	u.roles = decode_roles(u.roles)
	u.tenants = load_tenants(uid)
	return u
end
local function load_user(uid)
	return checkfound(try_load_user(uid),
		S('user_not_found', 'User not found'))
end
store.try_load_user = try_load_user
store.load_user = load_user

function store.users() --return {u1,...}
	local tenants = {} -- {uid -> {tid1,...}}
	for _, uid, tid in db():each'usr_tenant' do
		add(attr(tenants, uid), tid)
	end
	local t = {}
	for _, u in db():each('usr', '{}') do
		local uid = u.usr
		u.usr = nil
		u.id = uid
		u.roles = decode_roles(u.roles)
		u.tenants = tenants[uid] or {}
		t[#t+1] = u
	end
	return t
end

function store.uid_by(KEY, tid, key)
	local row = db():find('usr_tenant/tenant,'..KEY, '{}', tid, key)
	return row and row.usr
end

local function check_uid_by(KEY, tid, key)
	allow(not store.uid_by(KEY, tid, key),
		S(KEY..'_taken', KEY..' already registered'))
end

local function add_usr_tenant(uid, tid, u)
	db():insert('usr_tenant', '{}', {
		usr = uid,
		tenant = tid,
		email = u.email,
		phone = u.phone,
	})
end

--user ids are global so a user can be in multiple tenants.
function store.add_user(tid, u)
	check_tenant(tid)
	--check first: a uk violation error has no user message.
	if u.email then check_uid_by('email', tid, u.email) end
	if u.phone then check_uid_by('phone', tid, u.phone) end
	u.roles = {}
	local uid = db():insert('usr', '{}', user_row(u))
	u.id = uid
	u.tenants = {tid}
	add_usr_tenant(uid, tid, u)
	return u
end

--memberships and sessions are deleted by fk cascade.
function store.try_del_user(uid)
	return db():del('usr', uid)
end

function store.update_user(uid, update_fields)
	local u = load_user(uid)
	local old_row = user_row(u)
	local cat_old_tenants = cat(u.tenants, ' ')
	update_fields(u)
	assert(u.id == uid)
	assert(cat(u.tenants, ' ') == cat_old_tenants)
	assert(istab(u.roles))
	--check first: a uk violation error has no user message.
	for _,KEY in ipairs{'email', 'phone'} do
		if u[KEY] and u[KEY] ~= old_row[KEY] then
			for _,tid in ipairs(u.tenants) do
				check_uid_by(KEY, tid, u[KEY])
			end
		end
	end
	local row = user_row(u)
	--field removed by update_fields: write null (db:update skips nil).
	for k in pairs(old_row) do
		if row[k] == nil then row[k] = null end
	end
	row.usr = uid
	db():update('usr', '{}', row)
	if u.email ~= old_row.email or u.phone ~= old_row.phone then
		for _,tid in ipairs(u.tenants) do
			db():update('usr_tenant', '{}', {
				usr = uid,
				tenant = tid,
				email = u.email or null,
				phone = u.phone or null,
			})
		end
	end
	return u
end

function store.user_add_tenant(uid, tid)
	check_tenant(tid)
	add_usr_tenant(uid, tid, load_user(uid))
end

function store.user_del_tenant(uid, tid)
	assert(db():del('usr_tenant', uid, tid))
	user_sessions_scan = user_sessions_scan
		or db():scan('sess/usr', 'usr = ?'):select'sess, tenant':for_update()
	for _, sid, sess_tid in user_sessions_scan:rows{uid} do
		if sess_tid == tid then
			db():del('sess', sid)
		end
	end
end

local function touch_user(uid)
	db():update('usr', '{}', {usr = uid, atime = now()})
end
--callable without the lock.
function store.touch_user(uid)
	db():atomic('w', touch_user, uid)
end

--repair ---------------------------------------------------------------------

--deletes expired sessions. call it after sync_schema().
function store.repair()
	for cur, _, atime in db():each('sess', 'atime') do
		if atime + store.session_lifetime < now() then
			cur:del()
		end
	end
end

--the app owns db().
function store.close() end

return store
