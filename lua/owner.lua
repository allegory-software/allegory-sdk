--[[

	Resource ownership tree.
	Written by Cosmin Apreutesei. Public Domain.

API
	makeownernode(o) -> o       turn a plain object into what can be owned or owner
	setowner(res, owner)        set owner of res (owner=nil means mainthread())
	_initowner(res)             init res.owner if any (call in res' constructor)

makeownernode(o) -> o

	To be an owner, `res` must have `onclose` and `try_close` that honors `onclose`
	hooks and`owner` must have `onclose`. makeownernode() creates stubs for both.

]]

local function owner_try_close_owned(owner)
	local owns = owner.owns
	owner.owns = false
	--^^ don't allow try_close() to acquire more resources.
	--^^ false instead of nil is a makeowner() barrier.
	for i = #owns, 1, -1 do
		local res = owns[i]
		if res then
			assert(res.owner == owner)
			res:try_close()
			assert(res.owner == nil) --disowned
		end
	end
end

local owner_disown --fw. decl.

local function res_disown(res)
	if not res.owner then return end
	owner_disown(res.owner, res)
end

local function owner_own(owner, res)
	assert(owner.owns, 'own: owner closed')
	local o = owner
	while o do
		assert(o ~= res, 'own: cycle')
		o = o.owner
	end
	if res.owner_index == nil then --makeowned
		assert(res.onclose, 'makeowned: resource has no onclose method')
		assert(res.try_close, 'makeowned: resource has no try_close method')
		res:onclose(res_disown)
	end
	local i = pop(owner.owns.free_slots) or #owner.owns + 1
	owner.owns[i] = res
	res.owner = owner
	res.owner_index = i
end

--[[local]] function owner_disown(owner, res)
	assert(res.owner == owner)
	if owner.owns then --not inside owner_try_close_owned()
		add(owner.owns.free_slots, res.owner_index)
		owner.owns[res.owner_index] = false
	end
	res.owner = nil
	res.owner_index = -1 -- -1 instead of not nil is a makeowned barrier.
end

local function node_try_close(o)
	if not o._onclose then return end
	o:_onclose()
	return true
end
local function node_close(o)
	assert(o:try_close())
end
function makeownernode(o)
	if o.onclose then return o end --already made
	assert(not o.close)
	assert(not o.try_close)
	function o:onclose(fn)
		after(self, '_onclose', fn)
	end
	o.try_close = node_try_close
	o.close = node_close
	return o
end

local function makeowner(owner)
	if owner.owns ~= nil then return owner end
	assert(owner.onclose, 'makeowner: no onclose method')
	owner.owns = {free_slots = {}}
	owner:onclose(owner_try_close_owned)
	return owner
end

function setowner(res, owner)
	owner = owner or mainthread()
	if res.owner == owner then return end
	if res.owner then
		owner_disown(res.owner, res)
	end
	owner_own(makeowner(owner), res)
	return res
end

function _initowner(res)
	makeownernode(res)
	local owner = res.owner
	if not owner then
		if res.default_owner == 'main' then
			owner = mainthread()
		elseif res.default_owner == 'current' then
			owner = currentowner()
		elseif istab(res.default_owner) then
			owner = res.default_owner
		else
			assert(false, 'invalid default_owner')
		end
	end
	owner_own(makeowner(owner), res)
	return res
end
