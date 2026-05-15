--[[

	Resource ownership tree.
	Written by Cosmin Apreutesei. Public Domain.

API
	setowner(res, [owner])             set owner of res (nil for mainthread())
	currentowner([thread]) -> owner    get (current) thread's current owner
	setcurrentowner(owner, [thread])   set (current) thread's current owner

INTEGRATION API
	_check_owner(owner) -> vowner  check/get owner before creating res (raises!)
	_own(vowner, res)              call it in constructor after resource is created.
	_disown(res)                   call it in try_close() after resource is freed.

RATIONALE

	Scarce external resources that need deterministic freeing must be put in
	the owner tree (whose root is mainthread()) by calling _own() in their
	constructor and _disown() in their destructor, which ties their lifetime
	to the lifetime of their owner.

	The default owner for a new resource is currentowner() which by default
	is currentthread(), so for a resource (that doesn't specify an owner)
	to survive the thread in which it was created, setowner() must be called.

	Threads free up their owned objects when the thread finishes, including
	when an error is raised inside the thread which is the primary motivation
	for having an ownership model. With automatic cleanup, errors can now be
	raised freely in user code without worrying about leaks.

CONSTRAINTS

 * resource constructors must follow this protocol:

	1. valid_owner = _check_owner(owner) -- raises on invalid owner.
	2. create the resource -- no yielding or valid_owner might not stay valid.
	3. call _own(valid_owner, res)
	4. init the resource -- safe to raise now, rely on owner to free the resource.

	If step 4 inovolves multiple steps that can raise, make sure try_close()
	can deal with a partially initialized object.

 * try_close() must follow this protocol:

	1. claim close barrier -- prevents re-entry into try_close()
	2. free external resources without raising!
	3. call _disown(res) --do not disown before resources are freed!
	4. call onclose callbacks --callbacks see a closed owner.

	Also, on step 2, be careful not to call into things that might try to
	close the owner, otherwise _close_owned(owner) will raise. Yielding
	increases that risk greatly, so just don't yield before _disown()!

]]

local function _do_close_owned(owner)
	local owns = owner.owns
	if owns == false then return end
	owner.owns = false --prevent further owning and re-entry.
	if not owns then return end
	--phase 1: close owned threads, which forces them to finish synchronously
	--and close their owned threads and their resources and so on.
	for i = #owns, 1, -1 do
		local res = owns[i]
		if isthread(res) then
			assert(res.owner == owner)
			res:try_close()
		end
	end
	--phase 2: close all remaining owned resources.
	for i = #owns, 1, -1 do
		local res = owns[i]
		if res and res.owner then
			assert(res.owner == owner)
			res:try_close()
			assert(res.owner == nil) --try_close() called _disown()
		end
	end
end

local function _do_disown(res)
	local owner = res.owner
	if not owner then return end
	if owner.owns then --not inside _do_close_owned()
		add(owner.owns.free_slots, res.owner_index)
		owner.owns[res.owner_index] = false
	end
	res.owner = nil --_disown() barrier
	res.owner_index = -1
end

function _disown(res)
	 _do_close_owned(res)
	 _do_disown(res)
end

function _check_owner(owner)
	owner = owner or currentowner()
	assert(istab(owner), 'invalid owner')
	assertf(owner.owner or owner == mainthread(), 'owner is not owned')
	assert(owner.owns ~= false, 'owner closed')
	return owner
end

local function _do_own(owner, res)
	if owner.owns == nil then
		owner.owns = {free_slots = {}}
	end
	local i = pop(owner.owns.free_slots) or #owner.owns + 1
	owner.owns[i] = res
	res.owner = owner
	res.owner_index = i
end

function setowner(res, owner)
	owner = owner or mainthread()
	if res.owner == owner then return end
	assert(res.try_close, 'resource has no try_close method')
	_check_owner(owner)
	local o = owner
	while o do
		assert(o ~= res, 'owner is owned by the resource')
		o = o.owner
	end
	_do_disown(res)
	_do_own(owner, res)
	return res
end

local function res_try_close(res)
	_do_close_owned(res)
	_do_disown(res)
	return true
end

function _own(owner, res)
	if not res.try_close then --plain object, make ownable
		res.try_close = res_try_close
	end
	_do_own(owner, res)
	return res
end

function currentowner(thread)
	thread = thread or currentthread()
	return thread.currentowner or thread
end

function setcurrentowner(owner, thread)
	thread = thread or currentthread()
	thread.currentowner = assert(owner)
end

--stubs if not using epoll.lua
local _dummy = {}
function mainthread() return _dummy end
function currentthread() return _dummy end
function isthread(x) return x == _dummy end
