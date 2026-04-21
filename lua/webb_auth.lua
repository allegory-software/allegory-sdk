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

Regardless of how the user is authenticated, the session cookie is updated
and it will be sent with the reply. If a prev. anon. user was logged in, the
callback `switch_user(new_uid, old_uid)` is called before deleting it to
allow for moving data like a shopping cart etc. to the new user.

TODO
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

	tables.usr_tenant = {
		usr         , id, not_null, child_fk,
		tenant      , id, not_null, chilk_fk, pk(usr, tenant),
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

--OBJECTIVES:
-- 1. a process crash leaves the store in a recoverable state.
-- 2. a hard poweroff leaves the store in a recoverable state (with PLP drives!).
-- 3. multi-process access is synchronized or otherwise accounted for.
-- 4. no path injection.

local fs = {}
_store.fs = fs

local function check_filename(s)
	s = s:trim():lower()
	return checkarg(s and s ~= '' and s ~= '.' and s ~= '..' and #s <= 200
		and not s:find'[/\\%z]' and s)
end

local function hostpath(host, ...)
	return varpath('hosts', check_filename(host), ...)
end

function fs.check_host(host)
	return checkarg(file_is(hostpath(host), 'dir') and host, 'invalid host: %s', host)
end

function fs.add_tenant(host)
	host = check_filename(host)
	local tid = gen_id'tenant_id'
	save(hostpath(host, 'tenant'), tid)
	return tid
end

function fs.delete_tenant(host)
	rm_rf(hostpath(host))
	sync_dir(varpath('hosts')) --make rm of host dir durable
end

function fs.rename_host(old_host, new_host)
	local old_path = hostpath(old_host)
	local new_path = hostpath(new_host)
	local ok, err = try_rename(old_path, new_path)
	check_io(nil, ok or err == 'not_empty', err)
	allow(ok, S('host_already_exists', 'Host already exists: %s', new_host))
	sync_dir(varpath('hosts')) --make rename durable
end

local function user_path(uid, ...)
	assert(isint(uid))
	return varpath('users', tostring(uid), ...)
end

function fs.hosts() --return {host1, ...}
	local t = {}
	for name, d in ls(varpath('hosts')) do
		if d:is'dir' then t[#t+1] = name end
	end
	return t
end

function fs.user_ids() --return {uid1,...}
	local t = {}
	for uid, d in ls(varpath('users')) do
		local uid = tonumber(uid)
		if uid then t[#t+1] = uid end
	end
	return t
end

function fs.uid_by(ix_name, host, ix_val)
	local path = varpath('hosts', host, 'uid_by_'..ix_name, check_filename(ix_val))
	local f, err = try_open(path, 'r')
	if not f then return nil end
	f:lock'sh' --wait for any in-progress write
	local s = str(f:readall())
	f:unlock()
	f:close()
	return tonumber(s)
end

--create/update/delete email/phone->uid index, also checking for clashes.
--flock serializes concurrent access; creat+rdwr allows idempotent retries.
--sync_dir() makes creates/removes durable across power loss.
local function fs_link_unlink_user_unique_index(host, ix_name, ix_val, uid)
	ix_val = check_filename(ix_val)
	local ix_dir = varpath('hosts', host, 'uid_by_'..ix_name)
	local ix_file = indir(ix_dir, ix_val)
	if uid then
		assert(isint(uid))
		mkdir(ix_dir)
		local uid_s = tostring(uid)
		local f = open{path = ix_file, flags = 'creat rdwr'}
		f:lock'ex'
		local s = str(f:readall())
		if s and #s > 0 then
			f:unlock()
			f:close()
			allow(s == uid_s, S(ix_name..'_taken', ix_name..' already registered'))
		else
			f:write(uid_s)
			f:sync()
			f:unlock()
			f:close()
		end
	else
		rmfile(ix_file)
	end
	sync_dir(ix_dir) --make create/remove durable
end
local function fs_link_host_user(host, uid, u)
	if u.email then fs_link_unlink_user_unique_index(host, 'email', u.email, uid) end
	if u.phone then fs_link_unlink_user_unique_index(host, 'phone', u.phone, uid) end
end
local function fs_unlink_host_user(host, uid, u)
	if u.email then fs_link_unlink_user_unique_index(host, 'email', u.email, nil) end
	if u.phone then fs_link_unlink_user_unique_index(host, 'phone', u.phone, nil) end
end
local function fs_update_user_unique_index(host, ix_name, uid, old_val, new_val)
	if old_val == new_val then return end
	if new_val then fs_link_unlink_user_unique_index(host, ix_name, new_val, uid) end
	if old_val then fs_link_unlink_user_unique_index(host, ix_name, old_val, nil) end
end

local function load_user_profile(uid)
	local s = load(user_path(uid, 'profile'))
	if not s then return end
	local u = eval(s)
	assert(istab(u))
	return u
end

local function save_user_profile(uid, u)
	save(user_path(uid, 'profile'), pp(u))
end

local function with_locked_user(uid, fn)
	local lf = open(user_path(uid, 'lock'), 'a')
	lf:lock'ex'
	local ok, err = pcall(function()
		local u = assert(load_user_profile(uid))
		fn(uid, u)
	end)
	lf:unlock()
	lf:close()
	if not ok then error(err, 2) end
end

--user ids are global so a user can be in multiple hosts.
function fs.add_user(init_values)
	local uid = gen_id'user_id'
	local defaults = {anonymous = true, active = true, roles = {}}
	local u = update(defaults, init_values)
	save_user_profile(uid, u)
	return uid
end

function fs.load_user(uid)
	local u = assert(load_user_profile(uid))
	u.id = uid
	u.atime = file_attr(user_path(uid, 'profile'), 'atime')
	return u
end

function fs.delete_user(uid)
	with_locked_user(uid, function(uid, u)
		--removing indexes before the user dir for two reasons:
		--1) if removal fails the user becomes unreachable but delete_user()
		--can be re-attempted (user is still listed) to finish the job.
		--2) leaving orphaned indexes would lock in the email/phone which
		--would block creating the user again.
		for _,host in ipairs(fs.hosts()) do
			fs_unlink_host_user(host, uid, u)
		end
		rm_rf(user_path(uid))
		sync_dir(varpath('users')) --make rm of user dir durable
	end)
end

function fs.update_user(uid, updates)
	with_locked_user(uid, function(uid, u)
		local old_email = u.email
		local old_phone = u.phone
		for k,v in pairs(updates) do
			u[k] = repl(v, CLEAR, nil)
		end
		--update indexes: if these fail, user is left unreachable by new email/phone.
		for _,host in ipairs(fs.hosts()) do
			fs_update_user_unique_index(host, 'email', uid, old_email, u.email)
			fs_update_user_unique_index(host, 'phone', uid, old_phone, u.phone)
		end
		save_user_profile(uid, u)
	end)
end

function fs.touch_user(uid)
	file_attr(user_path(uid, 'profile'), {atime = now()})
end

local function session_path(host, sid)
	return varpath('hosts', host, 'sessions', check_filename(sid))
end

function fs.load_session(host, sid)
	local path = session_path(host, sid)
	local uid = tonumber(load(path))
	if not uid then return nil end
	local mtime = file_attr(path, 'mtime')
	local lifetime = config('session_lifetime', 2 * 365 * 24 * 3600)
	if mtime + lifetime < now() then --expired
		fs.delete_session(host, sid) --cleanup
		return
	end
	return uid
end

function fs.save_session(host, sid, uid)
	save(session_path(host, sid), assert(uid))
end

function fs.delete_session(host, sid)
	rmfile(session_path(host, sid))
	sync_dir(varpath('hosts', host, 'sessions')) --make rm of session file durable
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

local function set_req_session(sid, uid)
	local req = http_request()
	req.session_id = sid
	req.user_id = uid
end

local function set_session(uid)
	local sid = tohex(random_string(16))
	store().save_session(host(), sid, uid)
	set_session_cookie(sid)
	set_req_session(sid, uid)
end

local function load_session()
	local sid = parse_session_cookie()
	local uid = sid and store().load_session(host(), sid)
	if not uid then sid = nil end --prevent sid injection
	return sid, uid
end

local function load_user(uid)
	return store().load_user(uid)
end

--login based on session cookie.
local function auth_session()
	local sid, uid = load_session()
	local u = uid and load_user(uid)
	if not u then --user deleted
		store().delete_session(host(), sid)
	end
	if u and u.active then
		set_req_session(sid, uid)
	elseif config('auto_create_user', true) then
		local uid = create_user()
		set_session(uid)
		if sid then store().delete_session(host(), sid) end --can't get it back
	end
end

--logout and re-login with an anonymous user or not.
local function auth_logout()
	local sid, uid = load_session()
	set_session_cookie(nil)
	if uid then store().delete_session(host(), sid) end --can't get it back
	set_req_session(nil, nil)
	local u = uid and load_user(uid)
	if u and u.anonymous then --can't get it back
		store().delete_user(uid)
	end
	if config('auto_create_user', true) then
		local uid = create_user()
		set_session(uid)
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
	set_session(uid)
	return uid
end
local function auth_nopass(a)
	allow(config('auth_allow_nopass'))
	return _auth_nopass(a)
end

--login with an username and password.
local function auth_pass(a)
	_auth_nopass(a)
	if http_request().user_id
	local u = user(uid)
	local valid = u and u.active and u.pass and valid_pass(a.pass)
		and bcrypt_verify(a.pass, u.pass)
	allow(valid, S('invalid_credentials', 'Invalid credentials'))
	del_session()
	set_session(uid)
end

--request state --------------------------------------------------------------

--override host() to validate it before use to avoid host injection.
local _host = host
host = http_once_per_request(function()
	local h = _host()
	return store().check_host(h)
end)

local user = http_once_per_request(function(uid)
	local u = store().load_user(host(), uid)
	if not u then return nil end
	u.real_id = u.id
	u.real_roles = u.roles
	return u
end)

local function valid_pass(pass)
	return pass and #pass >= 1 and #pass <= 72 and pass or nil
end

local function create_or_update_user(t, upgrade_uid)

	--validate and transform fields
	t = t or {}
	checkarg(not t.email or (#t.email >= 1 and #t.email <= 200))
	checkarg(not t.phone or (#t.phone >= 1 and #t.phone <=  15))
	checkarg(not t.name  or (#t.name  >= 1 and #t.name  <= 200))
	checkarg(not t.pass or valid_pass(t.pass))
	t.pass = t.pass and bcrypt_hash(t.pass)

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
	user(CLEAR)
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

local function delete_user(uid)
	local u = assert(user(uid))
	store().delete_user(uid)
	user(CLEAR)
end

local function uid_by(which, s)
	return store().uid_by(which, host(), s)
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
	local uid = sid and store().load_session(host(), sid)
	local u = uid and store().load_user(uid)
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
	store().touch_user(host(), uid)
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
	return store().user_ids()
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
