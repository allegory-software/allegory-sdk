--[[

	Resource ownership tree.
	Written by Cosmin Apreutesei. Public Domain.

API
	setowner(res, [owner])             set owner of res (nil for mainthread())
	currentowner([thread]) -> owner    get (current) thread's current owner
	setcurrentowner(owner, [thread])   set (current) thread's current owner

INTEGRATION API
	_check_owner(owner) -> owner  check/get owner before creating res (raises!)
	_init_owner(owner, res)       init checked owner of res: call in res constructor
	_close_owned(owner)           call it on your try_close() method
	_disown(res)                  call it on your try_close() method

RATIONALE

	Scarce external resources that need deterministic freeing must be put in
	the owner tree (whose root is mainthread()) by calling _init_owner() in
	their constructor which ties their lifetime to the lifetime of their owner.

	The default owner for a new resource is currentowner() which by default
	is currentthread(), so for a resource (that doesn't specify an owner)
	to survive the thread in which it was created, setowner() must be called.

	Threads free up their owned objects when the thread finishes, including
	when an error is raised inside the thread which is the primary motivation
	for having an ownership model. With automatic cleanup, errors can now be
	raised freely in user code without worrying about leaks.

CONSTRAINTS

	try_close() must follow this exact protocol:

	1. claim close barrier -- prevents re-entry into try_close()
	2. free external resources without raising!
	4. call _close_owned(res) --owned resources see a closed owner.
	4. call _disown(res) --do not disown before resources are freed!
	5. call onclose callbacks --callbacks see a closed owner.

	Also, on step 2, be careful not to call into things that might try to
	close the owner, otherwise _close_owned(owner) will raise. Yielding
	increases that risk greatly, so just don't yield before _disown()!

]]

function _close_owned(owner)
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

function _disown(res)
	local owner = res.owner
	if not owner then return end
	if owner.owns then --not inside _close_owned()
		add(owner.owns.free_slots, res.owner_index)
		owner.owns[res.owner_index] = false
	end
	res.owner = nil --_disown() barrier
	res.owner_index = -1
end

local function _own(owner, res)
	if owner.owns == nil then
		owner.owns = {free_slots = {}}
	end
	local i = pop(owner.owns.free_slots) or #owner.owns + 1
	owner.owns[i] = res
	res.owner = owner
	res.owner_index = i
end

function _check_owner(owner)
	owner = owner or currentowner()
	assert(istab(owner), 'invalid owner')
	assertf(owner.owner or owner == mainthread(), 'owner is not owned')
	assert(owner.owns ~= false, 'owner closed')
	return owner
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
	_disown(res)
	_own(owner, res)
	return res
end

local function res_try_close(res)
	_close_owned(res)
	_disown(res)
	return true
end

function _init_owner(owner, res)
	if not res.try_close then --plain object, make ownable
		res.try_close = res_try_close
	end
	_own(owner, res)
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
