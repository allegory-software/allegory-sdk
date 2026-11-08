require'webb_auth'
require'lang'

rm_rf'/tmp/webb_auth_test'
config{vardir = '/tmp/webb_auth_test'}
mkdir('/tmp/webb_auth_test', true)

local ok, err = pcall(function()

auth_init'fs'

--mock webb, time, etc.
local passtime --strict
local function newreq()
	local te = currentthread().env
	local req = te and te.http_request
	local rh = req and req.response_headers
	local sc = rh and rh['set-cookie']
	local sid = sc and sc[1]:match'session=(.-);'
	currentthread():ownenv().http_request = {
		uri = '/',
		headers = {host = 'test',
			cookie = sid and 'session='..sid},
		response_headers = {},
		log = noop,
	}
end
local _time = 0
function passtime(s) _time = _time + s end
function now() return _time end
function wait() return end
function client_ip() return '127.0.0.1' end
function multilang() return false end
function scheme() return 'https' end

--fixate relevant config values.
config{
	auto_create_user   = true,
	allow_create_user  = true,
	auth_code_lifetime = 600,
	auth_code_maxtry   = 5,
	auth_code_cooldown = 30,
}

newreq()

auth_store().with_lock('w', function()
	local tid = auth_store().add_tenant()
	auth_store().add_host('test', tid)
end)

local function wrong_code(code)
	return ('%06d'):format((tonumber(code) + 1) % 1000000)
end

--try_login: pcall login, return uid on success or nil+err on failure.
local _login = login
local function login(a)
	local u = _login(a)
	return u and u.id
end
local function try_login(a)
	local ok, ret = pcall(login, a)
	if ok then return ret end
	return nil, ret --ret is the error message
end
local function assert_err(err, substring)
	err = err.content or err --it's a http_response exception sometimes
	assert(err and err:lower():has(substring:lower()),
		'expected "'..substring..'" in: '..(err or 'nil'))
end

--test auth_gen_code / login round-trip (successful)
newreq()
local code, uid = auth_gen_code{phone = '123456'}
assert(uid == 1)
local uid = login{type = 'code', phone = '123456', code = code}
assert(uid == 1)
print'ok auth_gen_code'

--test wrong code returns invalid_code
newreq()
local code3, uid3 = auth_gen_code{phone = '333333'}
local uid, err = try_login{type = 'code', phone = '333333', code = wrong_code(code3)}
assert(not uid); assert_err(err, 'expired code')
print'ok auth_gen_code / invalid code'

--test auth_gen_code cooldown
newreq()
local code2, uid2 = auth_gen_code{phone = '222222'}
local ok, err = pcall(auth_gen_code, {phone = '222222'})
assert(not ok); assert_err(err, 'too many')
passtime(30)
newreq()
local code2b, uid2b = auth_gen_code{phone = '222222'}
assert(uid2b == uid2) --same user, new code
print'ok auth_gen_code / too many tries'

--test code expiry
newreq()
local code7, uid7 = auth_gen_code{phone = '777777'}
passtime(601)
newreq()
local uid, err = try_login{type = 'code', phone = '777777', code = code7}
assert(not uid); assert_err(err, 'expired code')
print'ok code / expired'

--test too many tries invalidates the code
newreq()
local code4, uid4 = auth_gen_code{phone = '444444'}
for i = 1, 4 do
	local uid, err = try_login{type = 'code', phone = '444444', code = wrong_code(code4)}
	assert_err(err, 'expired code')
end
local uid, err = try_login{type = 'code', phone = '444444', code = wrong_code(code4)}
assert(not uid); assert_err(err, 'too many')
--correct code is now rejected too (code was invalidated)
local uid, err = try_login{type = 'code', phone = '444444', code = code4}
assert(not uid); assert_err(err, 'expired code')
print'ok code / too many tries'

--test register_pass round-trip (successful)
newreq()
local uid5 = login{type = 'register_pass', email = 'foo@test.com', pass = 'secret'}
assert(uid5)
newreq()
local uid5b = login{type = 'pass', email = 'foo@test.com', pass = 'secret'}
assert(uid5b == uid5)
print'ok register_pass'

--test register_pass failure cases
newreq()
local uid, err = try_login{type = 'register_pass', email = 'foo@test.com', pass = 'other'}
assert(not uid); assert_err(err, 'already')
print'ok register_pass / email taken'

newreq()
local uid, err = try_login{type = 'pass', email = 'foo@test.com', pass = 'wrong'}
assert(not uid); assert_err(err, 'credentials')
newreq()
local uid, err = try_login{type = 'pass', email = 'wrong@test.com', pass = 'secret'}
assert(not uid); assert_err(err, 'credentials')
print'ok register_pass / invalid credentials'

--test logout
newreq()
local uid6 = login{type = 'pass', email = 'foo@test.com', pass = 'secret'}
local uid6b = login{type = 'logout'}
assert(uid6b ~= uid6) --new anonymous user
assert(user'anonymous')
newreq()
local uid6c = login{type = 'session'} --session cookie gone, new anon user
assert(uid6c ~= uid6b)
print'ok logout'

--test switch_user deletes old anonymous user
newreq()
local anon_uid8 = login{type = 'session'} --creates anonymous user
assert(user'anonymous')
local uid8 = login{type = 'pass', email = 'foo@test.com', pass = 'secret'} --different user logs in
assert(uid8 ~= anon_uid8) --switched to real user
auth_store().with_lock('r', function()
	assert(not auth_store().try_load_user(anon_uid8)) --old anon was deleted
end)
print'ok switch_user / anon cleanup'

--test anonymous user upgrade (de-anonymization)
newreq()
local anon_uid = login{type = 'session'} --creates anonymous user
local real_uid = login{type = 'register_pass', email = 'bar@test.com', pass = 'secret'}
assert(real_uid == anon_uid) --same uid, upgraded in place
assert(not user'anonymous') --no longer anonymous
print'ok anon / upgrade'

--impersonation: each request carries the cookies set by the previous one.
local jar --{cookie name -> value}
local function newreq_jar()
	local req = currentthread().env.http_request
	for _, sc in ipairs(req.response_headers['set-cookie'] or {}) do
		local name, val = sc:match'^(%w+)=(.-);'
		jar[name] = val ~= '0' and val or nil
	end
	currentthread():ownenv().http_request = {
		uri = '/',
		headers = {host = 'test',
			cookie = jar.session and 'session='..jar.session},
		cookies = {impersonate = jar.impersonate},
		response_headers = {},
		log = noop,
	}
end
local function sets_cookie(prefix)
	for _, sc in ipairs(http_request().response_headers['set-cookie'] or {}) do
		if sc:find(prefix, 1, true) == 1 then return true end
	end
	return false
end
local function register(email, roles)
	newreq()
	local uid = login{type = 'register_pass', email = email, pass = 'secret'}
	auth_store().with_lock('w', auth_store().update_user, uid, function(u)
		u.roles = roles
	end)
	return uid
end
local function new_browser() --first request of a browser with no cookies
	newreq()
	jar = {}
	newreq_jar()
end
local function sign_in(email)
	new_browser()
	login{type = 'pass', email = email, pass = 'secret'}
end

local admin_uid  = register('admin@test.com', {admin = true})
local plain_uid  = register('plain@test.com', {})
local dev_uid    = register('dev@test.com', {admin = true, dev = true})
local dev2_uid   = register('dev2@test.com', {dev = true})
local victim_uid = register('victim@test.com', {})

--test impersonate / unimpersonate
sign_in('admin@test.com')
newreq_jar()
assert(login{type = 'impersonate', uid = plain_uid} == plain_uid)
assert(real_user() == admin_uid)
newreq_jar()
assert(login{type = 'session'} == plain_uid) --the cookie keeps impersonating
assert(real_user() == admin_uid)
newreq_jar()
assert(login{type = 'unimpersonate'} == admin_uid)
newreq_jar()
assert(login{type = 'session'} == admin_uid)
print'ok impersonate'

--test impersonation denied
sign_in('plain@test.com')
newreq_jar()
local uid, err = try_login{type = 'impersonate', uid = admin_uid}
assert(not uid); assert_err(err, 'impersonation denied')
sign_in('admin@test.com')
newreq_jar()
local uid, err = try_login{type = 'impersonate', uid = dev2_uid}
assert(not uid); assert_err(err, 'impersonation denied')
newreq_jar()
local uid, err = try_login{type = 'impersonate', uid = 99999}
assert(not uid); assert_err(err, 'impersonation denied')
sign_in('dev@test.com')
newreq_jar()
assert(login{type = 'impersonate', uid = dev2_uid} == dev2_uid)
print'ok impersonate / denied'

--test a non-admin's impersonation cookie is ignored and cleared
sign_in('plain@test.com')
newreq_jar()
http_request().cookies = {impersonate = tostring(admin_uid)}
assert(login{type = 'session'} == plain_uid)
assert(real_user() == plain_uid)
assert(sets_cookie'impersonate=0;')
print'ok impersonate / forged cookie'

--test impersonating a deleted user ends the impersonation
sign_in('admin@test.com')
newreq_jar()
login{type = 'impersonate', uid = victim_uid}
auth_store().with_lock('w', auth_store().try_del_user, victim_uid)
newreq_jar()
assert(login{type = 'session'} == admin_uid)
assert(sets_cookie'impersonate=0;')
newreq_jar()
assert(login{type = 'session'} == admin_uid)
print'ok impersonate / deleted user'

--test logout and login end the impersonation
sign_in('admin@test.com')
newreq_jar()
login{type = 'impersonate', uid = plain_uid}
newreq_jar()
login{type = 'logout'}
assert(sets_cookie'impersonate=0;')
sign_in('admin@test.com')
newreq_jar()
login{type = 'impersonate', uid = plain_uid}
newreq_jar()
login{type = 'pass', email = 'admin@test.com', pass = 'secret'}
assert(sets_cookie'impersonate=0;')
print'ok impersonate / new login'

--test user admin API when signed out
config{auto_create_user = false}
new_browser()
local ok, err = pcall(user_list)
assert(not ok); assert_err(err, 'only admins')
local ok, err = pcall(user_create, 1, {})
assert(not ok); assert_err(err, 'only admins')
local ok, err = pcall(user_update, admin_uid, {})
assert(not ok); assert_err(err, 'only admins')
local ok, err = pcall(user_delete, admin_uid)
assert(not ok); assert_err(err, 'only admins')
config{auto_create_user = true}
print'ok user admin / signed out'

--clean-up
rm_rf'/tmp/webb_auth_test'

end) --pcall

if not ok then
	err = tostring(err):gsub('/home/cosmin/sdk/bin/..', 'sdk')
	pr(err)
else
	print'webb_auth ok'
end
