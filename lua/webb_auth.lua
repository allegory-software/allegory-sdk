--[==[

	webb | session-based authentication
	Written by Cosmin Apreutesei. Public Domain.

	IMPORTANT: call randomseed(clock()) prior to using this module or you'll
	get the same session ids and auth codes on every run!

AUTH API
	gen_auth_code({email=|phone=}) -> code,uid   find/create user and gen auth code
	login([params][, switch_user]) -> real_uid   login with params:
	- {type='session'}                        login with session cookie (default)
	- {type='logout'}                         logout and create/login an anon user
	- {type='pass', email=, phone=, pass=}    login with email/phone and password
	- {type='code', email=|phone=, code=}     login with code from gen_auth_code()
	- {type='register_pass', email=, phone=, pass=}  create a user with a password
	- {type='nopass', email=, phone=}         login without pw if auth_allow_nopass
	host() -> host                            get host, raises if no matching tenant
	tenant() -> tid                           get tenant id for host()
USER PROFILE API
	[real]usr([field|'*']) -> val|t|uid       session-login and get user field(s)
	usr_touch()                               update current user's atime
	usr_update_profile({k->v}) -> uid         update current user's profile data
USER ADMIN API
	usr_list() -> {uid1,...}                  list users on current host
	usr_get(uid) -> u                         get user profile
	usr_create({k->v}) -> uid                 create user
	usr_update({k->v}) -> uid                 update user
	usr_delete(uid)                           delete user
AUTH STORAGE API
	auth_store() -> as                        get storage object (see code)

SCHEMA
	auth_schema                              auth schema

CONFIG
	auth_store          'fs'      user/session storage: 'fs' or 'mdbx'
	auto_create_user    true      auto-create anonymous users for current session
	allow_create_user   true      allow creating new users at all
	auth_code_lifetime  600       one-time auth code lifetime (seconds)
	auth_code_maxtry    5         max failed attempts before code is invalidated
	auth_code_cooldown  30        auth code min resend interval in seconds
	session_lifetime    2 years   session lifetime in seconds
	auth_allow_nopass   false     allow auth without a password (for dev env)

USER SWITCHING

Regardless of how the user is authenticated, the session cookie is
updated and it will be sent with the reply. If there was already a user
logged in before and it was a different user, the callback
`switch_user(new_uid, old_uid)` is called. If the previous user was
anonymous then that user is also deleted afterwards.

TODO
	- option to look-up user in other hosts to allow for sharing a user across hosts.
		- sessions are still per-host but 2 sessions can go to the same user.
	- implement email/phone validations and put all validators together.

]==]

if not ... then require'webb_auth_test'; return end

require'webb'
require'glue'
require'schema'
require'bcrypt'
require'http_date'

local _store = {}
local store = memoize(function()
	return _store[config'auth_store' or 'fs']
end)
auth_store = store

--schema ---------------------------------------------------------------------

function auth_schema()

	import'schema_std'

	tables.tenant = {
		tenant      , idpk,
		name        , name,
		host        , name, uk,
		active      , bool1,
		ctime       , ctime,
	}

	tables.usr = {
		usr         , idpk    ,
		tenant      , id      , not_null, fk,
		anonymous   , bool1   ,
		email       , email   , uk,
		emailvalid  , bool0   ,
		pass        , hash    ,
		active      , bool1   ,
		title       , name    ,
		name        , name    ,
		phone       , strid   ,
		phonevalid  , bool0   ,
		sex         , enum'M F O',
		birthday    , date    ,
		newsletter  , bool0   ,
		roles       , text    ,
		note        , text    ,
		theme       , strid   ,
		auth_code   , strid   ,
		auth_code_created  , time ,
		auth_code_trycount , int  ,
		auth_code_validates, enum'email phone',
		clientip    , strid   , --when it was created
		atime       , atime   , --last access time
		ctime       , ctime   , --creation time
		mtime       , mtime   , --last modification time
	}

	tables.sess = {
		sess        , hash   , not_null, pk,
		usr         , id     , not_null, child_fk,
		clientip    , strid  , --when it was created
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

--mdbx storage ---------------------------------------------------------------

local mdbx = {}; _store.mdbx = mdbx

--TODO:

--fs storage -----------------------------------------------------------------

local fs = {}
_store.fs = fs

local function check_path(s)
	checkarg(s and s ~= '' and s ~= '.' and s ~= '..' and #s <= 200
		and not s:find'[/\\%z]')
	return s
end

function fs.check_host(host)
	checkarg(file_is(varpath('hosts', check_path(host)), 'dir'),
		'invalid host: %s', host)
	return host
end

local function uid_by_path(index_name, host, val)
	return varpath('hosts', host, index_name, check_path(val:lower():trim()))
end

local function user_data_path(host, uid)
	assert(isint(uid))
	return varpath('users', tostring(uid), 'profile')
end

function fs.list_hosts() --return {host = tenant_id}
	local t = {}
	for name, d in ls(varpath('hosts')) do
		if not name then break end
		if d:is'dir' then
			t[name] = fs.load_tenant(name)
		end
	end
	return t
end

function fs.list_users(host) --return {uid1,...}
	local t = {}
	for name, d in ls(varpath('users')) do
		if not name then break end
		if d:is'dir' then
			local uid = tonumber(name)
			if uid then t[#t+1] = uid end
		end
	end
	return t
end

function fs.load_user(host, uid)
	local path = user_data_path(host, uid)
	local s = load(path)
	if s == nil then return nil end
	local t = eval(s)
	assert(istab(t))
	t.id = uid
	t.host = host
	t.atime = file_attr(path, 'atime')
	t.roles = t.roles or {}
	return t
end

--give t.id for update, skip t.id for insert.
--old is the current user data and is *required* for update.
function fs.save_user(t, old)
	--check if update is possible before starting because once we start,
	--we can't afford errors since we don't have transactions.
	local uid = t.id
	local old = uid and assert(old) or empty
	local new = update({}, old, t)
	local host = fs.check_host(assert(new.host))
	assert(not old.host or host == old.host) --not moving users between hosts.

	--check if updating indexes is possible before we begin.
	for _,F in ipairs{'email', 'phone'} do
		local old = old[F]
		local new = new[F]
		if old ~= new then
			--need to call uid_by_path() on both fields before we begin because
			--they might crash from an invalid path.
			local old_exists = old and fs.uid_by(F, host, old)
			local new_exists = new and fs.uid_by(F, host, new)
			allow(not new_exists, S(F..'_taken', F..' already registered'))
		end
	end

	--user ids are global in case we need to move them between hosts.
	uid = uid or gen_id'user_id'

	--insert/delete/update indexes into user. we do this first so if save(data)
	--fails, indexes are left orphan and uid_by() returns nil, no harm done.
	for _,F in ipairs{'email', 'phone'} do
		local old = old[F]
		local new = new[F]
		if old ~= new then
			local old_path = old and uid_by_path(F, host, old)
			local new_path = new and uid_by_path(F, host, new)
			if old and new then
				rename(old_path, new_path)
			elseif old then
				rmfile(old_path)
			else
				save(new_path, tostring(uid))
			end
		end
	end

	--finally save the user data.
	new.id = nil --not saving uid, it's in the user's path.
	new.host = nil --not saving host, it's in the user's path.
	for k,v in pairs(new) do --check if asked to also remove some fields
		if v == POISON then new[k] = nil end
	end
	local atime = new.atime
	new.atime = nil --atime is kept in file's atime.
	local data_path = user_data_path(host, uid)
	save(data_path, pp(new))
	if atime then
		file_attr(data_path, {atime = atime})
	end

	return uid
end

function fs.delete_user(u)
	rm_rf(varpath('users', assert(tostring(u.id))))
	--we remove indexes after the data is removed, same idea as on update.
	for _,F in ipairs{'email', 'phone'} do
		if u[F] then rmfile(uid_by_path(F, u.host, u[F])) end
	end
end

function fs.touch_user(host, uid)
	file_attr(user_data_path(host, uid), {atime = now()})
end

function fs.uid_by(F, host, s)
	local path = uid_by_path(F, host, s)
	return tonumber((load(path)))
end

local function session_path(host, sid)
	return varpath('hosts', host, 'sessions', sid)
end

function fs.load_session(host, sid)
	local path = session_path(host, sid)
	local uid = tonumber(load(path))
	if not uid then return nil end
	local mtime = file_attr(path, 'mtime')
	local lifetime = config('session_lifetime', 2 * 365 * 24 * 3600)
	if mtime + lifetime < now() then --expired
		fs.delete_session(host, sid)
		return
	end
	return {id = sid, uid = uid}
end

function fs.save_session(host, sess)
	save(session_path(host, sess.id), assert(sess.uid))
end

function fs.delete_session(host, sid)
	rmfile(session_path(host, sid))
end

function fs.load_tenant(host)
	return tonumber(load(varpath('hosts', check_path(host), 'tenant')))
end

function fs.create_tenant(host)
	local path = check_path(host)
	local tid = gen_id'tenant_id'
	save(varpath('hosts', path, 'tenant'), tid)
end

function fs.rename_host(old_host, new_host)
	local old_path = varpath('hosts', check_path(old_host))
	local new_path = varpath('hosts', check_path(new_host))
	rename(old_path, new_path)
end

--host override --------------------------------------------------------------

--override host() to validate it before use to avoid host injection.
local _host = host
host = http_once_per_request(function()
	local h = _host()
	return store().check_host(h)
end)

tenant = http_once_per_request(function()
	return allow(store().load_tenant(host()))
end)

--session objects ------------------------------------------------------------

local session = http_once_per_request(function()
	local s = headers('cookie'); if not s then return {} end
	local sid = s:match'^session=([^;]*)' or s:match'; *session=([^;]*)'
	if not sid or #sid ~= 32 or sid:find'[^%x]' then return {} end
	return store().load_session(host(), sid) or {}
end)

local function update_session(uid)
	local sess = session()
	sess.uid = uid
	local secure_flag = scheme'https'
	if sess.uid then --login
		sess.id = sess.id or tohex(random_string(16))
		store().save_session(host(), sess)
	elseif sess.id then --logout
		store().delete_session(host(), sess.id)
		sess.id = nil
	end
	setheader('set-cookie',
		'session='..(sess.id or 0)
		..'; Path=/'
		..'; Max-Age='..(sess.id and 9999999999 or 0)
		..(secure_flag and '; Secure' or '') --prevent MITM
		..'; HttpOnly' --prevent JS access
		..'; SameSite='..(secure_flag and 'strict' or 'lax') --prevent BREACH (but also img tracking)
	)
end

--user objects (cached) ------------------------------------------------------

local user = http_once_per_request(function(uid)
	return store().load_user(host(), uid)
end)

local function valid_pass(pass)
	return pass and #pass >= 1 and #pass <= 72 and pass or nil
end

local function create_or_update_user(t)
	--validate fields
	t = t or {}
	checkarg(not t.email or (#t.email >= 1 and #t.email <= 200))
	checkarg(not t.phone or (#t.phone >= 1 and #t.phone <=  15))
	checkarg(not t.name  or (#t.name  >= 1 and #t.name  <= 200))
	checkarg(not t.pass or valid_pass(t.pass))
	t.pass = t.pass and bcrypt_hash(t.pass)
	if not t.id then --uid not given, assume current user.
		local suid = session().uid
		local u = suid and user(suid)
		if u --same user, just de-anonymizing it
			and u.anonymous --but: don't hijack a real user's account
			and u.active --and also: don't resurrect a deactivated account
		then
			t.id = suid
		end
	end
	if not t.id then --create user
		allow(config('allow_create_user', true))
		wait(0.2) --make flooding up the table a bit slower
		merge(t, { --apply defaults
			clientip = client_ip(),
			lang = multilang() and lang() or nil,
			active = true,
			anonymous = true,
		})
	end
	t.host = host()
	local old_u = t.id and user(t.id)
	local uid = store().save_user(t, old_u)
	user(POISON)
	return uid
end
local function create_user(t)
	assert(not t or not t.id)
	return create_or_update_user(t)
end
local function update_user(t)
	assert(t and t.id)
	return create_or_update_user(t)
end

local function delete_user(uid)
	allow(uid and session().uid ~= uid)
	local u = assert(user(uid))
	store().delete_user(u)
	user(POISON)
end

local function uid_by(which, s)
	return store().uid_by(which, host(), s)
end

--authentication methods -----------------------------------------------------

local auth = {} --auth.<type>(params) -> uid

--login using session cookie (default method).
function auth.session()
	local uid = session().uid
	if not (uid and (user(uid) or empty).active) then
		allow(config('auto_create_user', true), 'invalid_session')
		return create_user()
	end
	return uid
end

--logout and re-login with an anonymous user or not.
function auth.logout()
	update_session(nil)
	return auth.session()
end

--no-password authentication (for dev env).
local function _auth_nopass(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local uid =
		email and uid_by('email', email) or
		phone and uid_by('phone', phone)
	allow(uid, S('invalid_credentials', 'Invalid credentials'))
	return uid
end
function auth.nopass(a)
	allow(config('auth_allow_nopass'))
	return _auth_nopass(a)
end

--login with an username and password.
function auth.pass(a)
	local uid = _auth_nopass(a)
	local u = user(uid)
	local valid = u and u.active and u.pass and valid_pass(a.pass)
		and bcrypt_verify(a.pass, u.pass)
	allow(valid, S('invalid_credentials', 'Invalid credentials'))
	return uid
end

--register a new user with a password.
function auth.register_pass(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local pass  = json_str_arg(a.pass)
	checkarg(email or phone)
	checkarg(pass)
	return create_user{
		anonymous = false,
		email     = email,
		phone     = phone,
		pass      = pass,
	}
end

--find user or create a new one and generate a one-time code for it.
--return the code and the uid.
function gen_auth_code(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	checkarg(email or phone)
	checkarg(not (email and phone))
	local uid_email = email and uid_by('email', email)
	local uid_phone = phone and uid_by('phone', phone)
	local uid = uid_email or uid_phone
	local code = ('%06d'):format(random(0, 999999))
	if uid then
		local u = allow(user(uid))
		allow(u.active)
		local cooldown = config('auth_code_cooldown', 30)
		allow(not u.auth_code or u.auth_code_created + cooldown <= now(),
			S('too_many_tries',
				'Too many attempts. Please wait before requesting a new code.'))
	end
	--for existing users we're not updating their email/phone; for new users
	--we're setting their email/phone and we know it's not taken, so any
	--failure here is a bug, so we assert.
	local uid = create_or_update_user{
		id = uid,
		email = not uid and email or nil,
		phone = not uid and phone or nil,
		auth_code           = code,
		auth_code_created   = now(),
		auth_code_trycount  = 0,
		auth_code_validates = email and 'email' or 'phone',
	}
	return code, uid
end

--login with one-time code generated by gen_auth_code().
local function invalid_code()
	allow(nil, S('invalid_code', 'Invalid or expired code'))
end
function auth.code(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local code  = json_str_arg(a.code)
	checkarg(email or phone)
	checkarg(code and #code == 6)
	local uid_email = email and uid_by('email', email)
	local uid_phone = phone and uid_by('phone', phone)
	local uid = allow(uid_email or uid_phone)
	local u = allow(user(uid))
	allow(u.active)
	if not u.auth_code then
		return invalid_code()
	end
	local code_lifetime = config('auth_code_lifetime', 10 * 60)
	local expired = u.auth_code_created + code_lifetime < now()
	if expired then
		update_user{
			id = uid,
			--delete code
			auth_code = POISON,
			auth_code_created = POISON,
			auth_code_validates = POISON,
			auth_code_trycount = POISON,
		}
		return invalid_code()
	end
	if code == u.auth_code then
		return update_user{
			id = uid,
			--delete code
			auth_code = POISON,
			auth_code_created = POISON,
			auth_code_validates = POISON,
			auth_code_trycount = POISON,
			--validate email or phone depending on where the code was sent.
			emailvalid = u.auth_code_validates == 'email' and true or nil,
			phonevalid = u.auth_code_validates == 'phone' and true or nil,
			anonymous = false,
		}
	end
	local maxtry = config('auth_code_maxtry', 5)
	local trycount = (u.auth_code_trycount or 0) + 1
	if trycount >= maxtry then
		update_user{
			id = uid,
			--delete code
			auth_code = POISON,
			auth_code_created = POISON,
			auth_code_validates = POISON,
			auth_code_trycount = POISON,
		}
		allow(nil, S('too_many_tries',
			'Too many attempts. Please request a new code.'))
	else
		update_user{
			id = uid,
			auth_code_trycount = trycount,
		}
		return invalid_code()
	end
end

--authentication frontend ----------------------------------------------------

function login(a, switch_user)
	switch_user = switch_user or pass
	local authenticate = checkarg(auth[a and istab(a) and a.type or 'session'])
	host() --break for invalid host early
	log('', 'auth', 'auth', '%s', a)
	local uid = authenticate(a)
	log('', 'auth', 'auth-ok', 'uid=%d', uid)
	local suid = session().uid
	if suid and uid ~= suid then
		switch_user(uid, suid)
		local su = user(suid)
		if su and su.anonymous then
			session().id = nil
			session().uid = nil
			delete_user(suid)
		end
	end
	local u = user(uid)
	if multilang() then
		setlang(u.lang) --user lang has priority over action lang.
		setcountry(u.country)
	end
	update_session(uid)
	return uid
end

--user profile web API -------------------------------------------------------

function realusr(attr)
	local uid = login()
	local u = user(uid)
	if attr == '*' then
		return u
	elseif attr then
		return u[attr]
	else
		return uid
	end
end

function usr(attr)
	local real_uid = login()
	local uid = args'uid' --impersonated user
	uid = uid and checkarg(id_arg(uid)) or real_uid
	local u  = allow(user(uid))
	local ru = user(real_uid)
	if uid ~= real_uid then
		allow(ru.roles.dev or ru.roles.admin, 'user impersonation denied')
	end
	u.real_uid = real_uid
	u.real_uid_roles = ru.roles
	if attr == '*' then
		return u
	elseif attr then
		return u[attr]
	else
		return uid
	end
end

function usr_touch()
	--only touch usr on page requests
	--TODO: change this test after ui_action refactor.
	if args(1) and args(1):find'%.' and not args(1):find'%.html$' then
		return
	end
	local uid = session().uid
	if not uid then return end
	store().touch_user(host(), uid)
end

--update current user profile.
function usr_update_profile(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local pass  = json_str_arg(a.pass)
	local name  = json_str_arg(a.name)
	local uid = session().uid
	local u = allow(uid and user(uid))
	allow(u.active)
	return update_user{
		id = uid,
		email = email,
		phone = phone,
		pass = pass,
		name = name,
		emailvalid = email and email ~= u.email and false or nil,
		phonevalid = phone and phone ~= u.phone and false or nil,
	}
end

--user admin web API ---------------------------------------------------------

function usr_list()
	local r = usr'roles'
	allow(r.admin or r.dev)
	return store().list_users(host())
end

function usr_get(uid)
	local r = usr'roles'
	allow(r.admin or r.dev)
	return checkfound(store().load_user(host(), uid))
end

local function _usr_save(t, save_user)
	local u = t.id and user(t.id)
	local r = usr'roles'
	allow(r.admin or r.dev,
		'must be admin or dev to create or update user')
	allow(r.dev or not (u and u.roles.dev),
		'only devs can create or update devs')
	allow(r.dev or t.host == host(),
		'only devs can create/move users of/to other hosts')
	allow(r.dev or not (t.roles and t.roles.dev),
		'non-devs cannot make devs')
	allow(r.dev or r.admin or not (t.roles and t.roles.admin),
		'non-admins cannot make admins')
	return save_user(t)
end
function usr_create(t) return _usr_save(t, create_user) end
function usr_update(t) return _usr_save(t, update_user) end

function usr_delete(uid)
	allow(usr() ~= uid, 'cannot delete your own user')
	local u = allow(user(uid))
	local r = usr'roles'
	allow(r.dev or r.admin, 'only devs and admins can remove users')
	allow(r.dev or u.host == host(),
		'only devs can remove users of other hosts')
	delete_user(uid)
end

--return schema so you can call schema:import'webb_auth'
return auth_schema
