require'glue'
require'mdbx_schema'

db_schema = mdbx_schema()
db_schema:import'schema_mdbx'

require'webb_auth_mdbx'

local testdir = '/tmp/webb_auth_mdbx_test'
rm_rf(testdir)
mkdir(testdir)

local test_db = mdbx_open(testdir..'/test.mdbx')
test_db.schema = db_schema
function db()
	return test_db
end
test_db:sync_schema()

local t0 = 0 -- clock value returned by now()
function now()
	return t0
end

auth_init'mdbx'
local store = auth_store()

store.with_lock('w', function()

local function tenants_by_host()
	local t = {}
	for _,tenant in ipairs(store.tenants()) do
		t[tenant.host] = tenant.tenant
	end
	return t
end

local tid1 = store.add_tenant()
store.add_host('Shop.Example', tid1)
local tid2 = store.add_tenant()
store.add_host('admin.example', tid2)
assert(tid2 ~= tid1)
assert(store.tenant_exists(tid1))
assert(store.tenant_by_host('shop.example') == tid1)
assert(store.tenant_by_host('ADMIN.EXAMPLE') == tid2)

local tenants = tenants_by_host()
assert(tenants['shop.example'] == tid1)
assert(tenants['admin.example'] == tid2)

store.rename_host('shop.example', 'api.example')
assert(store.tenant_by_host('api.example') == tid1)
assert(not pcall(store.tenant_by_host, 'shop.example'))
assert(not pcall(store.rename_host, 'api.example', 'admin.example'))
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
assert(not pcall(store.add_user, tid1, {email = 'foo@test.com'}))

local u = assert(store.load_user(uid))
assert(u.email == 'foo@test.com')
assert(u.phone == '123456')
assert(u.name == 'Alice')
assert(u.active == true)
assert(u.anonymous == false)
assert(next(u.roles) == nil)
assert(#u.tenants == 1 and u.tenants[1] == tid1)
print'ok add_user'

store.update_user(uid, function(u)
	u.email = 'bar@test.com'
	u.phone = '654321'
	u.name = 'Alice Updated'
	u.roles.admin = true
end)
assert(store.uid_by('email', tid1, 'foo@test.com') == nil)
assert(store.uid_by('phone', tid1, '123456') == nil)
assert(store.uid_by('email', tid1, 'bar@test.com') == uid)
assert(store.uid_by('phone', tid1, '654321') == uid)

u = assert(store.load_user(uid))
assert(u.email == 'bar@test.com')
assert(u.phone == '654321')
assert(u.name == 'Alice Updated')
assert(u.roles.admin)

store.update_user(uid, function(u)
	u.name = nil
	u.roles.admin = nil
end)
u = assert(store.load_user(uid))
assert(u.name == nil)
assert(next(u.roles) == nil)
print'ok update_user'

store.user_add_tenant(uid, tid2)
assert(store.uid_by('email', tid2, 'bar@test.com') == uid)
assert(store.uid_by('phone', tid2, '654321') == uid)

u = assert(store.load_user(uid))
assert(indexof(tid2, u.tenants))
print'ok user_add_tenant'

--same email as uid, but on another tenant.
local u2 = store.add_user(tid2, {email = 'baz@test.com'})
local u3 = store.add_user(tid1, {email = 'baz@test.com'})
assert(store.uid_by('email', tid2, 'baz@test.com') == u2.id)
assert(store.uid_by('email', tid1, 'baz@test.com') == u3.id)
assert(#store.users() == 3)
assert(store.try_del_user(u2.id))
assert(store.try_del_user(u3.id))
assert(not store.try_del_user(u3.id))
print'ok per-tenant email'

local sid1 = ('a'):rep(32)
local sid2 = ('b'):rep(32)
store.add_session(tid1, sid1, uid)
store.add_session(tid2, sid2, uid)
assert(store.load_session(tid2, sid1) == nil)

local su = store.load_user(store.load_session(tid1, sid1))
assert(su.id == uid)
assert(su and su.email == 'bar@test.com')

local su2 = store.load_user(store.load_session(tid2, sid2))
assert(su2.id == uid)
assert(su2 and su2.phone == '654321')
print'ok add_session'

store.del_session(tid1, sid1)
assert(store.load_session(tid1, sid1) == nil)
print'ok del_session'

store.user_del_tenant(uid, tid2)
assert(store.uid_by('email', tid2, 'bar@test.com') == nil)
assert(store.uid_by('phone', tid2, '654321') == nil)
assert(store.load_session(tid2, sid2) == nil)

u = assert(store.load_user(uid))
assert(not indexof(tid2, u.tenants))
assert(#u.tenants == 1 and u.tenants[1] == tid1)
print'ok user_del_tenant'

store.add_session(tid1, sid1, uid)
t0 = 1e11 --atime defaults to the real clock
local ret, err = store.load_session(tid1, sid1)
assert(ret == nil and err == 'expired')
store.repair()
assert(not db():exists('sess', sid1))
t0 = 0
print'ok repair'

store.add_session(tid1, sid1, uid)
store.try_del_user(uid)
assert(not pcall(store.load_user, uid))
assert(store.uid_by('email', tid1, 'bar@test.com') == nil)
assert(store.uid_by('phone', tid1, '654321') == nil)
assert(store.load_session(tid1, sid1) == nil)
print'ok del_user'

store.del_tenant(tid2)
store.del_tenant(tid1)
assert(#store.tenants() == 0)
assert(not pcall(store.tenant_by_host, 'admin.example'))
assert(not pcall(store.tenant_by_host, 'api.example'))
print'ok del_tenant'

end) --with_lock

test_db:close()
rm_rf(testdir)
