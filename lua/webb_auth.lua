--[==[

	webb | session-based authentication
	Written by Cosmin Apreutesei. Public Domain.

AUTH API
	auth_gen_code{email=|phone=} -> code,uid  find/create user and gen auth code
	login{type=,...}                          login with params:
	- {type='session'}                        login with session cookie (default)
	- {type='logout'}                         logout and create/login an anon user
	- {type='pass',email=,phone=,pass=}       login with email/phone and password
	- {type='code',email=|phone=,code=}       login with code from gen_auth_code()
	- {type='register_pass',email=,phone=,pass=} create a user with a password
	host() -> host                            get host, raises if no matching tenant
	tenant() -> tid                           get tenant id for host()
	user([field]|'*') -> val|u                login with session cookie and get user
USER PROFILE API
	[real_]user([field|'*']) -> val|t|uid      session-login and get user field(s)
	user_update_profile({k->v}) -> uid         update current user's profile data
USER ADMIN API
	user_list() -> {uid1,...}                 list users on current host
	user_create(tid, {k->v}) -> u             create user
	user_update(uid, {k->v}) -> u             update user
	user_delete(uid)                          delete user
AUTH STORE API
	auth_init([store_name])                   init auth module
	auth_store() -> as                        get store object (see code)
TO OVERRIDE
	{email|phone|name|pass}_is_valid(s)       field validators
	auth_switch_user(new_u, old_u)            callback when login from anonymous login

REQUEST ARGS
	uid        user id, for impersonation

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
	auth_nopass_ip                allow auth without a password from IP (for dev env)

USER SWITCHING

Regardless of how the user is authenticated, the session cookie is updated
and it will be sent with the reply. If a prev. anon. user was logged in, the
callback `auth_switch_user(new_uid, old_uid)` is called before deleting it to
allow for moving data like a shopping cart etc. to the new user.

]==]

if not ... then require'webb_auth_test'; return end

require'webb'
require'glue'
require'bcrypt'
require'http_date'

--storage backend ----------------------------------------------------------------

local store
function auth_store()
	return store
end
function auth_init(store_name)
	local s = config'auth_store' or store_name or 'fs'
	store = require('webb_auth_'..s)
	if store.init then store.init() end
end

--request host and tenant --------------------------------------------------------

local _host = host

tenant = http_once_per_request(function()
	return store.tenant_by_host(_host())
end)

function host() --override to validated version to prevent host injection
	tenant()
	return _host()
end

--create/update/load user --------------------------------------------------------

function email_is_valid(s)
	return #s >= 1 and #s <= 200
end
function phone_is_valid(s)
	return #s >= 1 and #s <=  15
end
function name_is_valid(s)
	return #s >= 1 and #s <= 200
end
function pass_is_valid(s)
	return #s >= 1 and #s <= 72
end
function code_is_valid(s)
	return #s == 6 and not s:find'[^%d]'
end

local function check_field(NAME, is_valid, u)
	if not (u and u[NAME] ~= nil) then return end
	checkarg(is_valid(u[NAME]), NAME)
end
local function check_fields(u)
	check_field('email', email_is_valid, u)
	check_field('phone', phone_is_valid, u)
	check_field('name' ,  name_is_valid, u)
	check_field('pass' ,  pass_is_valid, u)
	check_field('code' ,  code_is_valid, u)
end

local function create_user(u)
	allow(config('allow_create_user', true))
	u = update({
		anonymous = true,
		active = true,
		clientip = client_ip(),
		lang = multilang() and lang() or nil,
	}, u)
	check_fields(u)
	u.pass = u.pass and bcrypt_hash(u.pass)
	return store.add_user(tenant(), u)
end

local function update_user(uid, updates)
	return store.update_user(uid, function(u)
		assert(istab(updates))
		for k,v in pairs(updates) do
			v = repl(v, CLEAR, nil)
			updates[k] = v
			u[k] = v
		end
		check_fields(updates)
		u.pass = updates.pass and bcrypt_hash(updates.pass)
	end)
end

local function try_load_user(uid)
	local u = uid and store.try_load_user(uid)
	if not u then return end
	if not u.active then return end
	if u.roles.dev then return u end --devs can access any tenant
	if not indexof(tenant(), u.tenants) then return end
	return u
end

--session management -------------------------------------------------------------

local function parse_session_cookie()
	local sid = http_request().session_id
	if sid then return sid end --set-cookie in the same request
	local s = headers('cookie'); if not s then return end
	local sid = s:match'^session=([^;]*)' or s:match'; *session=([^;]*)'
	if not sid or #sid ~= 32 or sid:find'[^%x]' then return end
	http_request().session_id = sid
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
	http_request().session_id = sid
end

local function create_session(u)
	local sid = tohex(secure_random_string(16))
	store.add_session(tenant(), sid, u.id)
	return sid
end

local function try_load_session()
	local sid = parse_session_cookie()
	if not sid then return end
	local lifetime = config('session_lifetime', 2 * 365 * 24 * 3600)
	return store.load_session(tenant(), sid, lifetime)
end

local function set_req_user(ru)
	local u = ru
	local req = http_request()
	req.real_user = ru
	req.user = u
	if not u then return end
	--impersonate other user if asked
	local iuid = args'uid'
	if ru and iuid then
		iuid = checkarg(id_arg(iuid), 'uid')
		if iuid ~= ru.id then
			allow(ru.roles.admin, 'user impersonation denied')
			u = allow(try_load_user(iuid))
			req.user = u
		end
	end
	if multilang() then
		setlang(u.lang) --user lang has priority over action lang.
		setcountry(u.country)
	end
	wlog('', 'auth', 'auth-ok', 'uid=%d%s%s', u.id,
		ru and ru ~= u and ' ruid=' or '',
		ru and ru ~= u and ru.id or '')
end

--auth flows ---------------------------------------------------------------------

local auth = {}

--logout and re-login with an anonymous user or not.
function auth.logout()
	set_session_cookie(nil)
	set_req_user(nil)
end

local function allow_creds(ret)
	return allow(ret, S('invalid_credentials', 'Invalid credentials'))
end

local function try_find_user(a)
	return (
		a.email and store.uid_by('email', tenant(), a.email) or
		a.phone and store.uid_by('phone', tenant(), a.phone)
	)
end

auth_switch_user = noop --stub

--login with an username and password.
function auth.pass(a)
	wait(0.2) --bcrypt has delay but it's CPU bound.
	check_fields(a)
	checkarg(a.email or a.phone, 'email or phone')
	local u = store.with_lock('r', function()
		return allow_creds(try_load_user(try_find_user(a)))
	end)
	local nopass_ip = config'auth_nopass_ip'
	local nopass = nopass_ip and client_ip() == nopass_ip
	local u_pass = u.pass
	--check pass without keeping the store locked because it can be slow.
	allow_creds(nopass or u_pass)
	allow_creds(nopass or bcrypt_verify(a.pass, u_pass))
	store.with_lock('w', function()
		--recheck user/pass in transaction to avoid TOCTOU.
		local u = allow_creds(try_load_user(try_find_user(a)))
		allow_creds(nopass or u.pass == u_pass)
		--^^password already verified, just checking that it hasn't changed.
		local sid = create_session(u)
		set_session_cookie(sid)
		set_req_user(u)
	end)
end

--register a new user with a password.
function auth.register_pass(a)
	check_fields(a)
	checkarg(a.email or a.phone, 'email or phone')
	checkarg(a.pass, 'pass')
	store.with_lock('w', function()
		local updates = {
			anonymous = false,
			email = a.email,
			phone = a.phone,
			pass  = a.pass,
		}
		local u = try_load_user(try_load_session())
		if u and u.anonymous then
			u = update_user(u.id, updates)
			set_req_user(u)
		else
			u = create_user(updates)
			local sid = create_session(u)
			set_session_cookie(sid)
			set_req_user(u)
		end
	end)
end

local function six_digit_code()
	local s = secure_random_string(20)
	local n = 0
	for i = 1, #s do
		n = (n * 256 + s:byte(i)) % 1000000
	end
	return _('%06d', n)
end

local function allow_code(ret)
	return allow(ret, S('invalid_code', 'Invalid or expired code'))
end

--find user or create a new one and generate a one-time code for it.
--return the code and the uid.
function auth_gen_code(a)
	check_fields(a)
	checkarg(a.email or a.phone, 'email or phone')
	checkarg(not (a.email and a.phone), 'email OR phone')
	return store.with_lock('w', function()
		local u = try_load_user(try_find_user(a))
		local code = six_digit_code()
		if u then
			local uid = u.id
			local cooldown = config('auth_code_cooldown', 30)
			allow(not u.auth_code or u.auth_code_created + cooldown <= now(),
				S('too_many_tries',
					'Too many attempts. Please wait before requesting a new code.'))
			update_user(uid, {
				auth_code           = code,
				auth_code_created   = now(),
				auth_code_trycount  = 0,
				auth_code_validates = a.email and 'email' or 'phone',
			})
		else
			local updates = {
				anonymous = false,
				email = a.email,
				phone = a.phone,
				auth_code           = code,
				auth_code_created   = now(),
				auth_code_trycount  = 0,
				auth_code_validates = a.email and 'email' or 'phone',
			}
			u = try_load_user(try_load_session())
			if u and u.anonymous then
				update_user(u.id, updates)
			else
				u = create_user(updates)
			end
		end
		return code, u.id
	end)
end

--login with one-time code generated by gen_auth_code().
local function delete_auth_code(uid)
	update_user(uid, {
		auth_code = CLEAR,
		auth_code_created = CLEAR,
		auth_code_validates = CLEAR,
		auth_code_trycount = CLEAR,
	})
end
function auth.code(a)
	check_fields(a)
	checkarg(a.email or a.phone, 'email or phone')
	store.with_lock('w', function()
		local u = allow(try_load_user(try_find_user(a)))
		local uid = u.id
		allow_code(u.auth_code)
		local code_lifetime = config('auth_code_lifetime', 10 * 60)
		local expired = u.auth_code_created + code_lifetime < now()
		if expired then
			delete_auth_code(uid)
			allow_code(false)
		end
		if a.code == u.auth_code then
			u = update_user(uid, {
				--delete code
				auth_code = CLEAR,
				auth_code_created = CLEAR,
				auth_code_validates = CLEAR,
				auth_code_trycount = CLEAR,
				--validate email or phone depending on where the code was sent.
				emailvalid = u.auth_code_validates == 'email' and true or nil,
				phonevalid = u.auth_code_validates == 'phone' and true or nil,
				anonymous = false,
			})
			local sid = create_session(u)
			set_session_cookie(sid)
			set_req_user(u)
		else
			local maxtry = config('auth_code_maxtry', 5)
			local trycount = (u.auth_code_trycount or 0) + 1
			if trycount >= maxtry then
				delete_auth_code(uid)
				allow(false, S('too_many_tries',
					'Too many attempts. Please request a new code.'))
			else
				update_user(uid, {
					auth_code_trycount = trycount,
				})
				allow_code(false)
			end
		end
	end)
end

function auth.session()
	local req = http_request()
	if req.session_loaded then return end
	req.session_loaded = true
	store.with_lock('r', function()
		local u = try_load_user(try_load_session())
		set_req_user(u)
	end)
end

function login(a)
	local a_type = a and a.type or 'session'
	if a_type ~= 'session' then
		auth.session()
	end
	local req = http_request()
	local su = req.real_user
	checkarg(auth[a_type], 'login type')(a)
	local u = req.real_user
	if su and su.anonymous then
		store.with_lock('w', function()
			local su = store.try_load_user(su.id)
			if not su then return end --deleted async
			if u and u.id ~= su.id then
				auth_switch_user(u, su)
			end
			store.try_del_user(su.id)
		end)
	end
	local u = req.real_user
	if not u and config('auto_create_user', true) then
		--doing this outside auth's transaction is ok, there's no race condition
		--when creating a new user + session.
		store.with_lock('w', function()
			local u = create_user()
			local sid = create_session(u)
			set_session_cookie(sid)
			set_req_user(u)
		end)
	end
	return req.user
end

--user profile web API -----------------------------------------------------------

local function _user(USER, attr)
	login()
	local u = http_request()[USER]
	if attr == '*' then
		return u
	elseif attr then
		return u and u[attr]
	else
		return u and u.id
	end
end
function real_user(attr) return _user('real_user', attr) end
function user(attr) return _user('user', attr) end

--update current user profile.
function user_update_profile(a)
	check_fields(a)
	local u = login()
	update_user(u.id, {
		email = a.email,
		phone = a.phone,
		pass = a.pass,
		name = a.name,
		emailvalid = a.email and a.email ~= u.email and false or nil,
		phonevalid = a.phone and a.phone ~= u.phone and false or nil,
	})
end

--user admin web API -------------------------------------------------------------

function user_list()
	allow(user'roles'.admin, 'only admins can see users')
	return store.users()
end

local function check_rights(u)
	local r = user'roles'
	allow(r.admin, 'only admins can change users')
	allow(r.dev or not (u and u.roles.dev), 'only devs can change devs')
end

function user_create(tid, u)
	check_fields(u)
	check_rights(u)
	u.pass = u.pass and bcrypt_hash(u.pass)
	return store.add_user(tid, u)
end

function user_update(uid, u)
	local u = store.load_user(uid)
	check_rights(u)
	check_fields(u)
	u.pass = u.pass and bcrypt_hash(u.pass)
	return store.update_user(uid, u)
end

function usr_delete(uid)
	local u = store.load_user(uid)
	check_rights(u)
	store.try_del_user(u.id)
end

--return schema so you can call schema:import'webb_auth'
return auth_schema
