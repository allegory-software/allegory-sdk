--[[

	webb_auth file-based storage

OBJECTIVES

	1. process crashes leave the store in a recoverable state.
	2. power cuts don't undo finished operations (with PLP drives!).
	3. race-free multi-process access.
	4. no path injection.

Since we don't have transactions, process crashes can leave the store in an
inconsistent state. A scan+repair is thus performed on startup, which uses
the user profile file as point of truth because it is saved first.

]]

if not ... then require'webb_auth_fs_test'; return end

require'webb_auth'
require'fs'

local fs = {}
auth_stores.fs = fs

local function checknotexists(NAME, val)
	allow(not val, S(NAME..'_already_exists', NAME..' already exists: %s', val))
end

--paths ----------------------------------------------------------------------

local function check_filename(s)
	s = s:trim():lower()
	return checkarg(s and s ~= '' and s ~= '.' and s ~= '..' and #s <= 200
		and not s:find'[/\\%z]' and s)
end
local function hostlinkpath(host)
	return varpath('hosts', check_filename(host))
end
local function tpath(tid, ...)
	assert(isint(tid))
	return varpath('tenants', tostring(tid), ...)
end
local function userpath(uid, ...)
	assert(isint(uid))
	return varpath('users', tostring(uid), ...)
end
local function uidbypath(KEY, tid, key)
	return tpath(tid, 'uid_by_'..KEY, check_filename(key))
end
local function sessionpath(tid, sid)
	return tpath(tid, 'sessions', check_filename(sid))
end
local function usersessionpath(uid, sid)
	return userpath(uid, 'sessions', check_filename(sid))
end

local function check_tenant(tid)
	return checkfound(file_is(tpath(tid), 'dir') and tid,
		S('invalid_tenant', 'Invalid tenant'))
end

local function check_user(uid)
	return checkfound(file_is(userpath(uid), 'dir') and uid,
		S('invalid_user', 'Invalid user'))
end

--global lock ----------------------------------------------------------------

local lf, locked, locked_w
local function end_sync_op(lf, ok, ...)
	locked = false
	locked_w = false
	lf:unlock()
	if not ok then error(..., 2) end
	return ...
end
function fs.with_lock(lock_type, fn, ...)
	assert(not locked)
	if not lf or lf:closed() then
		lf = open(varpath('auth_lock'), 'a')
	end
	lf:lock(lock_type)
	locked = true
	locked_w = lock_type == 'w'
	return end_sync_op(lf, pcall(fn, ...))
end

--hosts and tenants ----------------------------------------------------------

local function try_tenant_by_host(host)
	local s = readlink(hostlinkpath(host), 'raw')
	return s and assert(tonumber(s:match'/(%d+)$'))
end
local function tenant_by_host(host)
	return checkfound(try_tenant_by_host(host), S('invalid_host', 'Invalid host'))
end
fs.tenant_by_host = tenant_by_host

function fs.tenants()
	assert(locked)
	local t = {}
	for host in ls(varpath('hosts')) do
		t[#t+1] = {
			host = host,
			tenant = try_tenant_by_host(host),
		}
	end
	return t
end

function fs.add_tenant(host)
	assert(locked_w)
	local hlpath = hostlinkpath(host)
	checknotexists('host', try_tenant_by_host(host) and host)
	local tid = gen_id'tenant_id'
	mkdir(tpath(tid))
	mkdir(tpath(tid, 'sessions'))
	mkdir(tpath(tid, 'uid_by_email'))
	mkdir(tpath(tid, 'uid_by_phone'))
	symlink(hlpath, '../tenants/'..tid) --commit
	return tid
end

function fs.del_tenant(host)
	assert(locked_w)
	local tid = tenant_by_host(host)
	rmfile(hostlinkpath(host)) --commit
	fs.repair()
end

function fs.rename_host(old_host, new_host)
	assert(locked_w)
	checknotexists('host', try_tenant_by_host(new_host) and new_host)
	rename(hostlinkpath(old_host), hostlinkpath(new_host)) --commit
end

--sessions -------------------------------------------------------------------

function fs.add_session(tid, sid, uid)
	assert(locked_w)
	assert(isint(uid))
	check_tenant(tid)
	check_user(uid)
	symlink(sessionpath(tid, sid), '../../../users/'..uid..'/profile') --commit
	symlink(usersessionpath(uid, sid), '../../../tenants/'..tid..'/sessions/'..sid)
end

local function read_session(tid, sid) --atomic
	local file = sessionpath(tid, sid)
	local s = readlink(file, 'raw')
	return s and tonumber(s:match'/(%d+)/profile')
end

function fs.del_session(tid, sid)
	assert(locked_w)
	local uid = read_session(tid, sid)
	if not uid then return end --session removed async
	rmfile(sessionpath(tid, sid)) --commit
	rmfile(usersessionpath(uid, sid))
end

function fs.touch_session(tid, sid) --non-durable, non-locked for speed
	try_set_file_attr(sessionpath(tid, sid), {mtime = now()}, false)
end

local function check_session(tid, sid)
	local file = sessionpath(tid, sid)
	local mtime = file_attr(file, 'mtime', false)
	if not mtime then return end --session removed async
	local lifetime = config('session_lifetime', 2 * 365 * 24 * 3600)
	if mtime + lifetime < now() then return end --expired
	return read_session(tid, sid) --returns nil if session removed async
end

--users ----------------------------------------------------------------------

local function try_load_user_profile_by(file)
	local s = load(file)
	if not s then return end
	local u = eval(s)
	assert(istab(u))
	return u
end
local function try_load_user_profile(uid)
	local u = try_load_user_profile_by(userpath(uid, 'profile'))
	assert(not u or u.id == uid)
	return u
end
function load_user_profile(uid) --already atomic
	return checkfound(try_load_user_profile(uid),
		S('user_not_found', 'User not found'))
end
fs.user = load_user_profile

function fs.users() --return {u1,...}
	assert(locked)
	local t = {}
	for uid, d in ls(varpath('users')) do
		local uid = assert(tonumber(uid))
		t[#t+1] = load_user_profile(uid)
	end
	return t
end

local function save_user_profile(u)
	assert(locked_w)
	save(userpath(u.id, 'profile'), pp(u))
end

--read-locked because session->uid and profile/index updates are not
--committed atomically across files.
function fs.load_session_user(tid, sid)
	assert(locked)
	local uid = check_session(tid, sid)
	return uid and try_load_user_profile(uid)
end

function fs.uid_by(KEY, tid, key)
	assert(locked)
	local path = uidbypath(KEY, tid, key)
	local s = readlink(path, 'raw')
	return s and tonumber(s:match'/(%d+)/profile')
end

local function check_uid_by(KEY, tid, key)
	allow(not fs.uid_by(KEY, tid, key), S(KEY..'_taken', KEY..' already registered'))
end

local function add_uid_by(KEY, tid, key, uid)
	assert(isint(uid))
	local path = uidbypath(KEY, tid, key)
	symlink(path, '../../../users/'..uid..'/profile')
end

local function del_uid_by(KEY, tid, key)
	rmfile(uidbypath(KEY, tid, key))
end

--user ids are global so a user can be in multiple tenants.
function fs.add_user(tid, u)
	assert(locked_w)
	check_tenant(tid)
	local uid = gen_id'user_id'
	--check email and/or phone before committing.
	if u.email then check_uid_by('email', tid, u.email) end
	if u.phone then check_uid_by('phone', tid, u.phone) end
	u.tenants = {tid}
	u.roles = {}
	u.id = uid
	save_user_profile(u) --commit
	if u.email then add_uid_by('email', tid, u.email, uid) end
	if u.phone then add_uid_by('phone', tid, u.phone, uid) end
	mkdir(userpath(uid, 'sessions'))
	return u
end

function fs.del_user(uid)
	assert(locked_w)
	local u = load_user_profile(uid)
	rmfile(userpath(uid, 'profile')) --commit
	for _,tid in ipairs(u.tenants) do
		if u.email then del_uid_by('email', tid, u.email) end
		if u.phone then del_uid_by('phone', tid, u.phone) end
	end
	for sid in ls(userpath(uid, 'sessions')) do
		local target = readlink(usersessionpath(uid, sid), 'raw')
		local tid = assert(tonumber(target:match'/tenants/(%d+)/'))
		rmfile(sessionpath(tid, sid))
		rmfile(usersessionpath(uid, sid))
	end
	rm_rf(userpath(uid))
end

function fs.update_user(uid, update_fields)
	assert(locked_w)
	local u = load_user_profile(uid)
	local old = {email = u.email, phone = u.phone, tenants = u.tenants}
	local old_tenants = cat(old.tenants, ' ')
	local new = u
	update_fields(new)
	assert(new.id == uid)
	assert(cat(new.tenants, ' ') == old_tenants)
	assert(istab(new.roles))
	--check if new email and/or phone is available on the tenants before committing.
	for _,KEY in ipairs{'email', 'phone'} do
		if new[KEY] and new[KEY] ~= old[KEY] then
			for _,tid in ipairs(old.tenants) do
				check_uid_by(KEY, tid, new[KEY])
			end
		end
	end
	save_user_profile(new) --commit
	for _,KEY in ipairs{'email', 'phone'} do
		if new[KEY] ~= old[KEY] then
			for _,tid in ipairs(old.tenants) do
				if old[KEY] then del_uid_by(KEY, tid, old[KEY]) end
				if new[KEY] then add_uid_by(KEY, tid, new[KEY], uid) end
			end
		end
	end
	return new
end

function fs.user_add_tenant(uid, tid)
	assert(locked_w)
	check_tenant(tid)
	local u = load_user_profile(uid)
	assert(not indexof(tid, u.tenants))
	add(u.tenants, tid)
	save_user_profile(u) --commit
	for _,KEY in ipairs{'email', 'phone'} do
		if u[KEY] then
			add_uid_by(KEY, tid, u[KEY], uid)
		end
	end
end

function fs.user_del_tenant(uid, tid)
	assert(locked_w)
	local u = load_user_profile(uid)
	assert(remove_value(u.tenants, tid))
	save_user_profile(u) --commit
	for _,KEY in ipairs{'email', 'phone'} do
		if u[KEY] then
			del_uid_by(KEY, tid, u[KEY])
		end
	end
	for sid in ls(userpath(uid, 'sessions')) do
		fs.del_session(tid, sid)
	end
end

--repair ---------------------------------------------------------------------

function fs.repair()
	assert(locked_w)
	mkdir(varpath('hosts'))
	mkdir(varpath('tenants'))
	mkdir(varpath('users'))
	local tids = {} --live tids, taken from host links
	for host in ls(varpath('hosts')) do
		tids[tenant_by_host(host)] = true
	end
	for tid in ls(varpath('tenants')) do
		tid = assert(tonumber(tid))
		if not tids[tid] then --del_tenant or interrupted add_tenant
			rm_rf(tpath(tid))
		end
	end
	local users = {}
	for uid in ls(varpath('users')) do
		uid = assert(tonumber(uid))
		local u = try_load_user_profile(uid)
		if not u then --interrupted del_user
			rm_rf(userpath(uid))
		else
			users[uid] = u
			mkdir(userpath(uid, 'sessions')) --if interrupted add_user
			for i = #u.tenants, 1, -1 do
				local tid = u.tenants[i]
				if not tids[tid] then --del_tenant
					remove_value(u.tenants, tid)
					save_user_profile(u)
				end
			end
		end
	end
		local sidmap = {}
		for tid in pairs(tids) do
			for sid in ls(tpath(tid, 'sessions')) do
				--expired sessions are GC'd here so the request read path stays read-only.
				local uid = check_session(tid, sid) --check expired
				if not uid then
					fs.del_session(tid, sid)
				end
			local u = uid and users[uid]
			if uid and (not u or not indexof(tid, u.tenants)) then
				--^^dangling session from interrupted del_user or user_del_tenant
				fs.del_session(tid, sid)
				uid = nil
			end
			if uid and not exists(usersessionpath(uid, sid)) then
				--^^missing from interrupted add_session
				symlink(usersessionpath(uid, sid),
					'../../../tenants/'..tid..'/sessions/'..sid)
			end
			sidmap[sid] = uid
		end
	end
	for uid,u in pairs(users) do
		for sid in ls(userpath(uid, 'sessions')) do
			if sidmap[sid] ~= uid then --dangling from interrupted del_session
				rmfile(usersessionpath(uid, sid))
			end
		end
		for _,KEY in ipairs{'email', 'phone'} do
			local key = u[KEY]
			if key then
				for _,tid in ipairs(u.tenants) do
					local ix_uid = fs.uid_by(KEY, tid, key)
					if ix_uid and ix_uid ~= uid then --dangling from update_user
						del_uid_by(KEY, tid, key)
						ix_uid = nil
					end
					if not ix_uid then --missing from interrupted add_user
						add_uid_by(KEY, tid, key, uid)
					end
				end
			end
		end
	end
	for _,KEY in ipairs{'email', 'phone'} do
		for tid in pairs(tids) do
			for key in ls(tpath(tid, 'uid_by_'..KEY)) do
				local uid = assert(fs.uid_by(KEY, tid, key))
				local u = users[uid]
				if not u or u[KEY] ~= key or not indexof(tid, u.tenants) then
					--^^dangling index from add_user, update_user, del_user, user_del_tenant
					del_uid_by(KEY, tid, key)
				end
			end
		end
	end
end

function fs.init()
	fs.with_lock('w', fs.repair)
end
