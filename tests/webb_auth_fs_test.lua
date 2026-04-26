require'glue'
require'webb_auth_fs'

local testdir = '/tmp/webb_auth_fs_test'
rm_rf(testdir)
config('vardir', testdir)
mkdir(testdir)

function now()
	return 0
end

local store = auth_stores.fs

store.init()

store.with_lock('w', function()

local function tenants_by_host()
	local t = {}
	for _,tenant in ipairs(store.tenants()) do
		t[tenant.host] = tenant.tenant
	end
	return t
end

local tid1 = store.add_tenant('Shop.Example')
local tid2 = store.add_tenant('admin.example')
assert(tid2 ~= tid1)
assert(store.tenant_by_host('shop.example') == tid1)
assert(store.tenant_by_host('ADMIN.EXAMPLE') == tid2)

local tenants = tenants_by_host()
assert(tenants['shop.example'] == tid1)
assert(tenants['admin.example'] == tid2)

store.rename_host('shop.example', 'api.example')
assert(store.tenant_by_host('api.example') == tid1)
assert(not pcall(store.tenant_by_host, 'shop.example'))
print'ok tenants'

local u = store.add_user(tid1, {
	active = true,
	anonymous = false,
	email = 'foo@test.com',
	phone = '123456',
	name = 'Alice',
})
local uid = u.id
assert(store.uid_by('email', tid1, 'foo@test.com') == uid)
assert(store.uid_by('phone', tid1, '123456') == uid)

local u = assert(store.user(uid))
assert(u.email == 'foo@test.com')
assert(u.phone == '123456')
assert(u.name == 'Alice')
assert(u.active == true)
assert(u.anonymous == false)
assert(#u.tenants == 1 and u.tenants[1] == tid1)
print'ok add_user'

store.update_user(uid, function(u)
	u.email = 'bar@test.com'
	u.phone = '654321'
	u.name = 'Alice Updated'
end)
assert(store.uid_by('email', tid1, 'foo@test.com') == nil)
assert(store.uid_by('phone', tid1, '123456') == nil)
assert(store.uid_by('email', tid1, 'bar@test.com') == uid)
assert(store.uid_by('phone', tid1, '654321') == uid)

u = assert(store.user(uid))
assert(u.email == 'bar@test.com')
assert(u.phone == '654321')
assert(u.name == 'Alice Updated')
print'ok update_user'

store.user_add_tenant(uid, tid2)
assert(store.uid_by('email', tid2, 'bar@test.com') == uid)
assert(store.uid_by('phone', tid2, '654321') == uid)

u = assert(store.user(uid))
assert(indexof(tid2, u.tenants))
print'ok user_add_tenant'

local sid1 = ('a'):rep(32)
local sid2 = ('b'):rep(32)
store.add_session(tid1, sid1, uid)
store.add_session(tid2, sid2, uid)

local su = store.load_session_user(tid1, sid1)
assert(su.id == uid)
assert(su and su.email == 'bar@test.com')

local su2 = store.load_session_user(tid2, sid2)
assert(su.id == uid)
assert(su2 and su2.phone == '654321')
print'ok add_session'

store.del_session(tid1, sid1)
assert(store.load_session_user(tid1, sid1) == nil)
print'ok del_session'

store.user_del_tenant(uid, tid2)
assert(store.uid_by('email', tid2, 'bar@test.com') == nil)
assert(store.uid_by('phone', tid2, '654321') == nil)
assert(store.load_session_user(tid2, sid2) == nil)

u = assert(store.user(uid))
assert(not indexof(tid2, u.tenants))
assert(#u.tenants == 1 and u.tenants[1] == tid1)
print'ok user_del_tenant'

store.del_user(uid)
assert(not pcall(store.user, uid))
assert(store.uid_by('email', tid1, 'bar@test.com') == nil)
assert(store.uid_by('phone', tid1, '654321') == nil)
assert(store.load_session_user(tid1, sid1) == nil)
print'ok del_user'

store.del_tenant('admin.example')
store.del_tenant('api.example')
assert(#store.tenants() == 0)
assert(not pcall(store.tenant_by_host, 'admin.example'))
assert(not pcall(store.tenant_by_host, 'api.example'))
print'ok del_tenant'

rm_rf(testdir)

end) --with_lock
