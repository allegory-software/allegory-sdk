require'webb_auth'
require'lang'

rm_rf'/tmp/webb_auth_test'
config('vardir', '/tmp/webb_auth_test')

--init storage
save(varpath'hosts/test/tenant', '1')

--mock webb, time, etc.
local function newreq()
	ownthreadenv().http_request = {
		uri = '/',
		headers = {host = 'test'},
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

local function wrong_code(code)
	return ('%06d'):format((tonumber(code) + 1) % 1000000)
end

--try_login: pcall login, return uid on success or nil+err on failure.
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

--test gen_auth_code / login round-trip (successful)
newreq()
local code, uid = gen_auth_code{phone = '123456'}
assert(uid == 1)
local uid = login{type = 'code', phone = '123456', code = code}
assert(uid == 1)
print'ok gen_auth_code'

--test wrong code returns invalid_code
newreq()
local code3, uid3 = gen_auth_code{phone = '333333'}
local uid, err = try_login{type = 'code', phone = '333333', code = wrong_code(code3)}
assert(not uid); assert_err(err, 'expired code')
print'ok gen_auth_code / invalid code'

--test gen_auth_code cooldown
newreq()
local code2, uid2 = gen_auth_code{phone = '222222'}
local ok, err = pcall(gen_auth_code, {phone = '222222'})
assert(not ok); assert_err(err, 'too many')
passtime(30)
newreq()
local code2b, uid2b = gen_auth_code{phone = '222222'}
assert(uid2b == uid2) --same user, new code
print'ok gen_auth_code / too many tries'

--test code expiry
newreq()
local code7, uid7 = gen_auth_code{phone = '777777'}
passtime(601)
newreq()
local uid, err = try_login{type = 'code', phone = '777777', code = code7}
assert(not uid); assert_err(err, 'expired code')
print'ok code / expired'

--test too many tries invalidates the code
newreq()
local code4, uid4 = gen_auth_code{phone = '444444'}
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
assert(usr'anonymous')
newreq()
local uid6c = login{type = 'session'} --session cookie gone, new anon user
assert(uid6c ~= uid6b)
print'ok logout'

--test switch_user deletes old anonymous user
newreq()
local anon_uid8 = login{type = 'session'} --creates anonymous user
assert(usr'anonymous')
local uid8 = login{type = 'pass', email = 'foo@test.com', pass = 'secret'} --different user logs in
assert(uid8 ~= anon_uid8) --switched to real user
assert(not auth_store().load_user(host(), anon_uid8)) --old anon was deleted
print'ok switch_user / anon cleanup'

--test anonymous user upgrade (de-anonymization)
newreq()
local anon_uid = login{type = 'session'} --creates anonymous user
local real_uid = login{type = 'register_pass', email = 'bar@test.com', pass = 'secret'}
assert(real_uid == anon_uid) --same uid, upgraded in place
assert(not usr'anonymous') --no longer anonymous
print'ok anon / upgrade'

--clean-up
rm_rf'/tmp/webb_auth_test'
