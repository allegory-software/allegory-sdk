require'glue'
require'owner'

setcurrentowner(mainthread())

local function live_owned(owner)
	local n = 0
	local owns = owner.owns
	if owns and owns ~= false then
		for i = 1, #owns do
			if owns[i] then
				n = n + 1
			end
		end
	end
	return n
end

local function test_res(log, name)
	local res = {name = name}
	function res:try_close()
		if self.closed then return true end
		self.closed = true
		if log then add(log, name) end
		_disown(self)
		return true
	end
	return res
end

local function new_root()
	local root = _own(mainthread(), {})
	setcurrentowner(root)
	return root
end

local function close_root(root)
	root:try_close()
	setcurrentowner(mainthread())
end

--_own: sets owner metadata and owner slot
do
	local root = new_root()
	local res = _own(root, test_res())
	assert(res.owner == root)
	assert(root.owns[res.owner_i] == res)
	close_root(root)
end

--_disown: clears slot and reuses free slots
do
	local root = new_root()
	local a = _own(root, test_res())
	local i = a.owner_i
	_disown(a)
	assert(a.owner == nil)
	assert(a.owner_i == -1)
	assert(root.owns[i] == false)
	local b = _own(root, test_res())
	assert(b.owner_i == i)
	close_root(root)
end

--closing owner closes resources in reverse order
do
	local root = new_root()
	local log = {}
	_own(root, test_res(log, 'a'))
	_own(root, test_res(log, 'b'))
	_own(root, test_res(log, 'c'))
	root:try_close()
	setcurrentowner(mainthread())
	assert(table.concat(log, ',') == 'c,b,a')
end

--closing a resource closes its owned children too
do
	local root = new_root()
	local parent = _own(root, test_res())
	local child = _own(parent, test_res())
	parent:try_close()
	assert(parent.owner == nil)
	assert(child.owner == nil)
	assert(live_owned(root) == 0)
	close_root(root)
end

--setowner: reparents and rejects cycles
do
	local root = new_root()
	local owner1 = _own(root, {})
	local owner2 = _own(root, {})
	local res = _own(owner1, test_res())
	local old_i = res.owner_i
	setowner(res, owner2)
	assert(owner1.owns[old_i] == false)
	assert(res.owner == owner2)
	assert(owner2.owns[res.owner_i] == res)
	local child = _own(owner1, {})
	local ok = pcall(function()
		setowner(owner1, child)
	end)
	assert(not ok)
	assert(owner1.owner == root)
	close_root(root)
end

--with_owner: normal return closes scope and restores currentowner
do
	local root = new_root()
	local res
	local a, b = with_owner(function()
		res = _own(currentowner(), test_res())
		return 1, 2
	end)
	assert(a == 1 and b == 2)
	assert(currentowner() == root)
	assert(res.owner == nil)
	assert(live_owned(root) == 0)
	close_root(root)
end

--with_owner: structured errors close scope and restore currentowner
do
	local root = new_root()
	local res
	local ok, e = try(function()
		with_owner(function()
			res = _own(currentowner(), test_res())
			error(newerror{type = 'io', message = 'x'})
		end)
	end)
	assert(ok == false)
	assert(iserror(e, 'io', 'x'))
	assert(currentowner() == root)
	assert(res.owner == nil)
	assert(live_owned(root) == 0)
	close_root(root)
end

--with_owner: string errors close scope and restore currentowner
do
	local root = new_root()
	local res
	local ok, e = lua_pcall(function()
		with_owner(function()
			res = _own(currentowner(), test_res())
			error'x'
		end)
	end)
	assert(ok == false)
	assert(type(e) == 'string')
	assert(currentowner() == root)
	assert(res.owner == nil)
	assert(live_owned(root) == 0)
	close_root(root)
end

--with_owner: CANCEL restores currentowner but leaves scope for owner cleanup
do
	local root = new_root()
	local res
	local ok, e = lua_pcall(function()
		with_owner(function()
			res = _own(currentowner(), test_res())
			error(CANCEL)
		end)
	end)
	assert(ok == false)
	assert(e == CANCEL)
	assert(currentowner() == root)
	assert(res.owner)
	assert(res.owner.owner == root)
	assert(live_owned(root) == 1)
	close_root(root)
	assert(res.owner == nil)
end

assert(currentowner() == mainthread())
assert(live_owned(mainthread()) == 0)

print'owner ok'
