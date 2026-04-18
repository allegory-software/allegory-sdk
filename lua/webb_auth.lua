--[==[

	webb | session-based authentication
	Written by Cosmin Apreutesei. Public Domain.

AUTH API
	[try_]login([params][, switch_user]) -> real_uid   login and set lang (if not set)
	usr([field|'*']) -> val | t | uid         login and get current user field(s) or id
	usr_touch([uid])                          update (current) user's atime
	tenant() -> tenant                        get current tenant
ADMIN API
	usr_list() -> {uid1,...}                  list users
	usr_save({k->v}) -> uid                   create and/or update a user
	usr_delete(uid)                           delete a user

SCHEMA
	auth_schema                              auth schema

CONFIG
	auth_store          'fs'           user/session storage: 'fs' or 'mdbx'
	auto_create_user    true           auto-create anonymous users for current session
	allow_create_user   true           allow creating new users at all
	auth_code_lifetime  600            one-time auth code lifetime (seconds)
	auth_code_maxtry    5              max failed attempts before code is invalidated
	auth_code_cooldown  30             auth code min resend interval in seconds
	session_lifetime    2 years        session lifetime in seconds
	auth_allow_nopass   false          allow auth without a password (for dev env)

TODO:
	- update docs to reflect current API.

API --------------------------------------------------------------------------

	[try_]login([params][, switch_user]) -> uid

	Login using a specific method and and parameters (see below).

[real]usr() -> uid

	Get the current user id. Same as calling `login()` without args.

[real]usr(field) -> v

	Get the value of a specific field from the user info.

[real]usr'*' -> t

	Get full user info.

touch_usr([uid])

	Update user's access time. Call it on every request as a way of tracking
	user activity, eg. for knowing when to send those annoying "forgot items
	in your cart" emails.

usr_update({email = , phone = , pass = , name = })

	Update the info of the currently logged-in user.
	errors:
		'email_taken' - email already used on another account.
		'phone_taken' - phone already used on another account.


AUTH PARAMETERS

{type = 'session'}

	login using session cookie (default). if there's no session cookie
	or it's invalid, an anonymous user is created subject to auto_create_user,
	errors:
		'invalid_session' - session is invalid or expired, login a different way.

{type = 'logout'}

	Clears the session cookie and creates an anonymous user and returns it.

{type = 'anonymous'}

	login using session cookie but logout and create an anonymous user
	if the logged in user is not anonymous.

{type = 'pass', email = , phone = , pass = }

	login to an existing user using its email or phone and password.
	errors:
		'invalid_credentials' - email/phone/password is wrong.

{type = 'code', email = , phone = , code = }

	login using a one-time 6-digit code.
	email or phone must match what the code was generated for.
	errors:
		'invalid_code'   - code was not found, expired, or wrong.
		'too_many_tries' - auth_code_maxtry limit reached; code invalidated.

{type = 'register_code', email = | phone = }

	Find a user or create one and generate a 6-digit code to be sent via email
	or phone and be used with type = 'code' authentication.
	Generating a new code invalidates any previous code.
	errors:
		'too_many_tries' - auth_code_cooldown limit reached.

{type = 'register_pass', email = , phone = , pass = }

	Create a user with a password and login to it.
	errors:
		'email_taken' - email already used on another account.
		'phone_taken' - phone already used on another account.

{type = 'nopass', email = , phone = }

	Login without a password or code (for debugging only).

USER SWITCHING

Regardless of how the user is authenticated, the session cookie is
updated and it will be sent with the reply. If there was already a user
logged in before and it was a different user, the callback
`switch_user(new_uid, old_uid)` is called. If that previous user was
anonymous then that user is also deleted afterwards.

]==]

require'webb'
require'glue'
require'schema'
require'bcrypt'
require'http_date'

local _store = {}
local store = memoize(function()
	return _store[config'auth_store' or 'fs']
end)

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

local function valid_path(s)
	if not s or s == '' or s == '.' or s == '..' or #s > 200 or s:find'[/\\%z]' then
		return
	end
	return s
end

function fs.valid_host(host)
	return file_is(varpath('hosts', assert(valid_path(host))), 'dir') and host or nil
end

local function uid_by_path(index_name, host, val)
	local path = assert(valid_path(val:lower():trim()))
	return varpath('hosts', host, index_name, path)
end

local function user_data_path(host, uid)
	assert(isint(uid))
	return varpath('hosts', host, 'users', tostring(uid), 'data')
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

function fs.save_user(t, old)
	local uid = t.id
	local old = old or empty
	local new = update({}, old, t)
	local host = new.host

	--check if update is possible before starting because once we start,
	--we can't afford errors since we don't have transactions.
	assert(not old.host or host == old.host) --bug, not moving users here.
	if not old.host and not fs.valid_host(host) then
		return nil,
			S('invalid_host', 'Invalid host: %s', host),
			'invalid_host'
	end
	if new.email and new.email ~= old.email
		and fs.uid_by('email', host, new.email)
	then
		return nil,
			S('email_taken', 'Email already registered'),
			'email_taken'
	end
	if new.phone and new.phone ~= old.phone
		and fs.uid_by('phone', host, new.phone)
	then
		return nil,
			S('phone_taken', 'Phone already registered'),
			'phone_taken'
	end

 	--user ids are global in case we need to move them between hosts.
	uid = uid or gen_id'user_id'

	--insert/delete/update indexes into user. we do this first so if save(data)
	--fails, indexes are left orphan and uid_by() returns nil, no harm done.
	for _,F in ipairs{'email', 'phone'} do
		local old = old[F]
		local new = new[F]
		if old ~= new then
			--TODO: call uid_by_path() in check section because it asserts.
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

function fs.delete_user(host, uid)
	local u = fs.load_user(host, uid)
	if not u then return end
	rm_rf(varpath('hosts', host, 'users', assert(tostring(uid))))
	--we remove indexes after the data is removed, same idea as on update.
	for _,F in ipairs{'email', 'phone'} do
		if u[F] then rmfile(uid_by_path(F, host, u[F])) end
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
	return varpath('sessions', host, sid)
end

function fs.load_session(host, sid)
	local path = session_path(host, sid)
	local uid = tonumber(load(path))
	if not uid then return end
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
	local path = valid_path(host)
	return path and tonumber(load(varpath('hosts', path, 'tenant')))
end

function fs.create_tenant(host)
	local path = assert(valid_path(host))
	local tid = gen_id'tenant_id'
	save(varpath('hosts', path, 'tenant'), tid)
end

function fs.rename_host(old_host, new_host)
	local old_path = varpath('hosts', assert(valid_path(old_host)))
	local new_path = varpath('hosts', assert(valid_path(new_host)))
	rename(old_path, new_path)
end

--current host ---------------------------------------------------------------

local chost = http_once_per_request(function()
	return allow(store().valid_host(host()), 'invalid host: %s', host())
end)

--session objects ------------------------------------------------------------

local session = http_once_per_request(function()
	local s = headers('cookie'); if not s then return end
	local sid = s:match'^session=([^;]*)' or s:match'; *session=([^;]*)'
	if not sid or #sid ~= 32 or sid:find'[^%x]' then return {} end
	return store().load_session(chost(), sid) or {}
end)

local function update_session(uid)
	local sess = session()
	sess.uid = uid
	local secure_flag = scheme'https'
	if sess.uid then --login
		sess.id = sess.id or tohex(random_string(16))
		store().save_session(chost(), sess)
	elseif sess.id then --logout
		store().delete_session(chost(), sess.id)
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
	return store().load_user(chost(), uid)
end)

local function valid_pass(pass)
	return pass and #pass >= 1 and #pass <= 72 and pass or nil
end

local function save_user(t)
	--validate fields
	t = t or {}
	allow(not t.email or (#t.email >= 1 and #t.email <= 200))
	allow(not t.phone or (#t.phone >= 1 and #t.phone <=  15))
	allow(not t.name  or (#t.name  >= 1 and #t.name  <= 200))
	allow(not t.pass or valid_pass(t.pass))
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
			lang = multilang() and lang(),
			active = true,
			anonymous = true,
		})
	end
	t.host = chost()
	local old_u = t.id and user(t.id)
	local uid, err, errcode = store().save_user(t, old_u)
	if not uid then return nil, err, errcode end
	user(POISON)
	return uid
end

local function delete_user(uid)
	store().delete_user(chost(), uid)
	user(POISON)
end

local function uid_by(which, s)
	return store().uid_by(which, chost(), s)
end

--authentication methods -----------------------------------------------------

local auth = {} --auth.<type>(params) -> uid | nil, err, err_code

--login using session cookie
function auth.session()
	local uid = session().uid
	if not (uid and (user(uid) or empty).active) then
		if not config('auto_create_user', true) then
			return nil,
				S('invalid_session', 'Invalid session'),
				'invalid_session'
		end
		return save_user()
	end
	return uid
end

--logout and re-login with an anonymous user or not.
function auth.logout()
	update_session(nil)
	return auth.session()
end

--login using session cookie but logout and create an anonymous user
--if the logged in user is not anonymous.
function auth.anonymous()
	return save_user()
end

--no-password authentication (for dev env).
local function _auth_nopass(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local uid =
		email and uid_by('email', email) or
		phone and uid_by('phone', phone)
	if not uid then
		return nil,
			S('invalid_credentials', 'Invalid credentials'),
			'invalid_credentials'
	end
	return uid
end
function auth.nopass(a)
	allow(config('auth_allow_nopass'))
	return _auth_nopass(a)
end

--login with an username and password.
function auth.pass(a)
	local uid, err, errcode = _auth_nopass(a)
	if not uid then return nil, err, errcode end
	local u = user(uid)
	local ok = u and u.active and u.pass and valid_pass(a.pass)
		and bcrypt_verify(a.pass, u.pass)
	if not ok then
		return nil,
			S('invalid_credentials', 'Invalid credentials'),
			'invalid_credentials'
	end
	return uid
end

--register a new user with a password.
function auth.register_pass(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local pass  = json_str_arg(a.pass)
	allow(email or phone)
	allow(pass)
	return save_user{
		anonymous = false,
		email     = email,
		phone     = phone,
		pass      = pass,
	}
end

--find user or create a new one and generate a one-time code for it.
function auth.register_code(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	allow(email or phone)
	allow(not (email and phone))
	local uid_email = email and uid_by('email', email)
	local uid_phone = phone and uid_by('phone', phone)
	local uid = uid_email or uid_phone
	local code = ('%06d'):format(random(0, 999999))
	if uid then
		local u = allow(user(uid))
		allow(u.active)
		local cooldown = config('auth_code_cooldown', 30)
		if u.auth_code and u.auth_code_created + cooldown > now() then
      	return nil,
				S('too_many_tries',
					'Too many attempts. Please wait before requesting a new code.'),
				'too_many_tries'
		end
	end
	return save_user{
		id = uid,
		email = not uid and email or nil,
		phone = not uid and phone or nil,
		auth_code           = code,
		auth_code_created   = now(),
		auth_code_trycount  = 0,
		auth_code_validates = email and 'email' or 'phone',
	}
end

--login with one-time code generated by auth.register_code().
function auth.code(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local code  = json_str_arg(a.code)
	allow(email or phone)
	allow(code and #code == 6)
	local uid_email = email and uid_by('email', email)
	local uid_phone = phone and uid_by('phone', phone)
	local uid = allow(uid_email or uid_phone)
	local u = allow(user(uid))
	allow(u.active)
	if not u.auth_code then
		return nil,
			S('invalid_code', 'Invalid or expired code'),
			'invalid_code'
	end
	local code_lifetime = config('auth_code_lifetime', 10 * 60)
	local expired = u.auth_code_created + code_lifetime < now()
	if expired then
		assert(save_user{
			id = uid,
			--delete code
			auth_code = POISON,
			auth_code_created = POISON,
			auth_code_validates = POISON,
			auth_code_trycount = POISON,
		})
		return nil,
			S('invalid_code', 'Invalid or expired code'),
			'invalid_code'
	end
	if code == u.auth_code then
		return save_user{
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
		assert(save_user{
			id = uid,
			--delete code
			auth_code = POISON,
			auth_code_created = POISON,
			auth_code_validates = POISON,
			auth_code_trycount = POISON,
		})
		return nil,
			S('too_many_tries', 'Too many attempts. Please request a new code.'),
			'too_many_tries'
	else
		assert(save_user{
			id = uid,
			auth_code_trycount = trycount,
		})
		return nil,
			S('invalid_code', 'Invalid or expired code'),
			'invalid_code'
	end
end

--authentication frontend ----------------------------------------------------

function try_login(a, switch_user)
	switch_user = switch_user or pass
	local authenticate = allow(auth[a and istab(a) and a.type or 'session'])
	chost()
	log('', 'auth', 'auth', '%s', a)
	local uid, err, errcode = authenticate(a)
	if not uid then
		log('', 'auth', 'auth-fail', '%s', err)
		return nil, err, errcode
	end
	log('', 'auth', 'auth-ok', 'uid=%d', uid)
	local suid = session().uid
	if suid and uid ~= suid then
		switch_user(uid, suid)
		local su = user(suid)
		if su and su.anonymous then
			delete_user(suid)
			session().id = nil
			session().uid = nil
		end
	end
	local u = user(uid)
	setlang(u.lang) --user lang has priority over action lang.
	setcountry(u.country)
	update_session(uid)
	return uid
end
function login(...)
	return allow(try_login(...))
end

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

function usr_touch(uid)
	--only touch usr on page requests
	--TODO: change this test after ui_action refactor.
	if args(1) and args(1):find'%.' and not args(1):find'%.html$' then
		return
	end
	uid = uid or session().uid
	if not uid then return end
	store().touch_user(chost(), uid)
end

--update current user profile.
function usr_update(a)
	local email = json_str_arg(a.email)
	local phone = json_str_arg(a.phone)
	local pass  = json_str_arg(a.pass)
	local name  = json_str_arg(a.name)
	local uid = session().uid
	local u = allow(uid and user(uid))
	allow(u.active)
	return save_user{
		id = uid,
		email = email,
		phone = phone,
		pass = pass,
		name = name,
		emailvalid = email and email ~= u.email and false or nil,
		phonevalid = phone and phone ~= u.phone and false or nil,
	}
end

function usr_list()
	if http_request() then
		--
	end
end

function usr_save(t)
	if http_request() then
		local u = t.id and user(t.id)
		local r = usr'roles'
		allow(r.admin or r.dev,
			'must be admin or dev to create or update user')
		allow(r.dev or not (u and u.roles.dev),
			'only devs can create or update devs')
		allow(r.dev or t.host == chost(),
			'only devs can create/move users of/to other hosts')
		allow(r.dev or not (t.roles and t.roles.dev),
			'non-devs cannot make devs')
		allow(r.dev or r.admin or not (t.roles and t.roles.admin),
			'non-admins cannot make admins')
	end
	return save_user(t)
end

function usr_delete(uid)
	if http_request() then
		allow(usr() ~= uid, 'cannot delete your own user')
		local u = allow(user(uid))
		local r = usr'roles'
		allow(r.dev or r.admin, 'only devs and admins can remove users')
		allow(r.dev or u.host == chost(),
			'only devs can remove users of other hosts')
	end
	delete_user(uid)
end

--return schema so you can call schema:import'webb_auth'
return auth_schema
