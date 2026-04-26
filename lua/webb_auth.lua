--[==[

	webb | session-based authentication
	Written by Cosmin Apreutesei. Public Domain.

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
	auth_init([store_name])                   init auth module
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

Regardless of how the user is authenticated, the session cookie is updated
and it will be sent with the reply. If a prev. anon. user was logged in, the
callback `switch_user(new_uid, old_uid)` is called before deleting it to
allow for moving data like a shopping cart etc. to the new user.

]==]

if not ... then require'webb_auth_test'; return end

require'webb'
require'glue'
require'bcrypt'
require'http_date'

--validators -----------------------------------------------------------------

function valid_email(email)
	checkarg(not email or (#email >= 1 and #email <= 200))
end

function valid_phone(phone)
	checkarg(not phone or (#phone >= 1 and #phone <=  15))
end

function valid_name(name)
	checkarg(not name  or (#name  >= 1 and #name  <= 200))
end

function valid_pass(pass)
	return pass and #pass >= 1 and #pass <= 72 and pass or nil
end

local function check_field(NAME, validate, u)
	if not u then return end
	checkarg(not u or validate(u[NAME]), S('invalid_'..NAME, 'Invalid %s', NAME))
end
local function check_user_fields(u)
	check_field('email', valid_email, u)
	check_field('phone', valid_phone, u)
	check_field('name' , valid_name , u)
	check_field('pass' , valid_pass , u)
 	if u.pass then u.pass = bcrypt_hash(u.pass) end
end

--store API ------------------------------------------------------------------

auth_stores = {}

local store

function auth_init(store_name)
	store = assert(auth_stores[config'auth_store' or store_name or 'fs'])
	if store.init then store.init() end
end

function auth_store()
	return store
end

local function add_user(tid, init_values)
	local u = update({
		anonymous = true,
		active = true,
	}, init_values)
	check_user_fields(u)
	return store.add_user(tid, u)
end

local function update_user(tid, updates)
	store.update_user(tid, function(u)
		local new = u
		if isfunc(updates) then
			local old_tenants = cat(old.tenants, ' ')
			updates(new)
			assert(cat(new.tenants, ' ') == old_tenants)
		else
			assert(istab(updates))
			assert(not updates.tenants)
			for k,v in pairs(updates) do
				new[k] = repl(v, CLEAR, nil)
			end
		end
		check_user_fields(new)
	end)
end

--session cookie -------------------------------------------------------------

local function parse_session_cookie()
	local s = headers('cookie'); if not s then return end
	local sid = s:match'^session=([^;]*)' or s:match'; *session=([^;]*)'
	if not sid or #sid ~= 32 or sid:find'[^%x]' then return end
	return sid
end

local function set_session_cookie(sid)
	local secure_flag = scheme'https'
	setheader('set-cookie',
		'session='..(sid or 0)
		..'; Path=/'
		..'; Max-Age='..(sid and 9999999999 or 0)
		..(secure_flag and '; Secure' or '') --prevent MITM
		..'; HttpOnly' --prevent JS access
		..'; SameSite='..(secure_flag and 'strict' or 'lax') --prevent BREACH (but also img tracking)
	)
end

--auth flows -----------------------------------------------------------------

local _host = host
tenant = http_once_per_request(function()
	return store.tenant_by_host(_host())
end)
function host() --override to validated version to prevent host injection
	tenant()
	return _host()
end

local function create_or_update_user(t, upgrade_uid)
	t = t or {}
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
	local old_u = t.id and user(t.id)
	local uid = store.save_user(t, old_u)
	return uid
end
local function create_user(t, upgrade_uid)
	assert(not t or not t.id)
	return create_or_update_user(t, upgrade_uid)
end
local function update_user(t)
	assert(t and t.id)
	return create_or_update_user(t)
end

local function set_req_session(sid, uid)
	local req = http_request()
	req.session_id = sid
	req.user_id = uid
end

local function create_session(uid)
	local sid = tohex(secure_random_string(16))
	store.add_session(tenant(), sid, uid)
	set_session_cookie(sid)
	set_req_session(sid, uid)
end

local function load_session_user()
	local sid = parse_session_cookie()
	if not sid then return end
	local uid, u = store.load_session_user(tenant(), sid)
	if not uid then return end
	return sid, uid, u
end

--login based on session cookie.
local function auth_session()
	local sid, uid, u = load_session_user()
	if u and u.active then
		set_req_session(sid, uid)
	elseif config('auto_create_user', true) then
		local uid = create_user()
		create_session(uid)
	end
end

--logout and re-login with an anonymous user or not.
local function auth_logout()
	local sid, uid = load_session()
	set_session_cookie(nil)
	if uid then store.delete_session(tenant(), sid) end
	set_req_session(nil, nil)
	local u = uid and load_user(uid)
	if u and u.anonymous then --can't get it back
		store.delete_user(uid)
	end
	if config('auto_create_user', true) then
		local uid = create_user()
		create_session(uid)
	end
end

--no-password authentication (for dev env).
local function _auth_nopass(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local uid =
		email and uid_by('email', email) or
		phone and uid_by('phone', phone)
	allow(uid, S('invalid_credentials', 'Invalid credentials'))
	local sid, uid = load_session()
	create_session(uid)
	return uid
end
local function auth_nopass(a)
	allow(config('auth_allow_nopass'))
	return _auth_nopass(a)
end

--login with an username and password.
local function auth_pass(a)
	_auth_nopass(a)
	--if http_request().user_id
	local u = user(uid)
	local valid = u and u.active and u.pass and valid_pass(a.pass)
		and bcrypt_verify(a.pass, u.pass)
	allow(valid, S('invalid_credentials', 'Invalid credentials'))
	del_session()
	create_session(uid)
end

--request state --------------------------------------------------------------

local user = http_once_per_request(function(uid)
	local u = store.load_user(tenant(), uid)
	if not u then return nil end
	u.real_id = u.id
	u.real_roles = u.roles
	return u
end)

local function delete_user(uid)
	local u = assert(user(uid))
	store.delete_user(uid)
	user(CLEAR)
end

local function uid_by(which, s)
	return store.uid_by(which, tenant(), s)
end

local function parse_session_cookie()
	local s = headers('cookie'); if not s then return end
	local sid = s:match'^session=([^;]*)' or s:match'; *session=([^;]*)'
	if not sid or #sid ~= 32 or sid:find'[^%x]' then return end
	return sid
end

local function create_or_upgrade_user(t)
	local uid = session_uid()
	if uid then
		local u = user(upgrade_uid)
		assert(u.anonymous) --don't hijack a real user's account
		assert(u.active) --don't resurrect a deactivated account
		t.id = suid
	else

	end
end

function auto_anon_uid()
	if not config('auto_create_user', true) then return end
	return create_user()
end

--authentication methods -----------------------------------------------------

local auth = {} --auth.<type>(params) -> uid

--login using session cookie (default method).
function auth.session()
	local req = http_request()
	local sid = parse_session_cookie()
	local uid = sid and store.load_session(tenant(), sid)
	local u = uid and store.load_user(uid)
	return u and u.active and uid or nil
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
	return create_or_upgrade_user{
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
		update_user{
			id = uid,
			auth_code           = code,
			auth_code_created   = now(),
			auth_code_trycount  = 0,
			auth_code_validates = email and 'email' or 'phone',
		}
	else
		uid = create_or_upgrade_user{
			anonymous = false,
			email = email,
			phone = phone,
			auth_code           = code,
			auth_code_created   = now(),
			auth_code_trycount  = 0,
			auth_code_validates = email and 'email' or 'phone',
		}
	end
	return code, uid
end

--login with one-time code generated by gen_auth_code().
local function invalid_code()
	allow(nil, S('invalid_code', 'Invalid or expired code'))
end
local function delete_auth_code(uid)
	update_user{
		id = uid,
		auth_code = CLEAR,
		auth_code_created = CLEAR,
		auth_code_validates = CLEAR,
		auth_code_trycount = CLEAR,
	}
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
		delete_auth_code(uid)
		return invalid_code()
	end
	if code == u.auth_code then
		return update_user{
			id = uid,
			--delete code
			auth_code = CLEAR,
			auth_code_created = CLEAR,
			auth_code_validates = CLEAR,
			auth_code_trycount = CLEAR,
			--validate email or phone depending on where the code was sent.
			emailvalid = u.auth_code_validates == 'email' and true or nil,
			phonevalid = u.auth_code_validates == 'phone' and true or nil,
			anonymous = false,
		}
	end
	local maxtry = config('auth_code_maxtry', 5)
	local trycount = (u.auth_code_trycount or 0) + 1
	if trycount >= maxtry then
		delete_auth_code()
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
	wlog('', 'auth', 'auth', '%s', a or '')
	local uid = authenticate(a)
	local suid = session_uid()
	if suid and uid ~= suid then
		switch_user(uid, suid)
		local su = user(suid)
		if su and su.anonymous then
			delete_user(suid)
		end
	end
	local u = user(uid)
	if multilang() then
		setlang(u.lang) --user lang has priority over action lang.
		setcountry(u.country)
	end
	update_session(uid)
	wlog('', 'auth', 'auth-ok', 'uid=%d', uid)
	return uid
end

--user profile web API -------------------------------------------------------

function realusr(attr)
	local u = user(session_uid())
	if attr == '*' then
		return u
	elseif attr then
		return u[attr]
	else
		return u.id
	end
end

function usr(attr)
	local uid = args'uid' --impersonated user
	if not uid then return realusr(attr) end
	uid = uid and checkarg(id_arg(uid))
	local u  = uid and allow(user(uid))
	local ru = user()
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
	local uid = suid()
	if not uid then return end
	store.touch_user(tenant(), uid)
end

--update current user profile.
function usr_update_profile(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local pass  = json_str_arg(a.pass)
	local name  = json_str_arg(a.name)
	local uid = suid()
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
	return store.user_ids()
end

function usr_get(uid)
	local r = usr'roles'
	allow(r.admin or r.dev)
	return checkfound(user(uid))
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
