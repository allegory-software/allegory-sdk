local coroutine = require'coro'
local main = coroutine.running()

local function test(descr, f)
	local ok, err = xpcall(f, debug.traceback)
	print((ok and 'ok:   ' or 'fail: ') .. descr)
	if not ok then
		print(err)
	end
	assert(coroutine.running() == main)
end

local function narg(n, ...)
	assert(select('#', ...) == n)
	return ...
end

test('first transfer() args are passed as function args', function()
	local thread = coroutine.create(function(...)
		local ret1, ret2, ret3 = narg(3, ...)
		assert(ret1 == 'ret1')
		assert(ret2 == 'ret2')
		assert(ret3 == 'ret3')
		coroutine.transfer(main)
	end)
	coroutine.transfer(thread, 'ret1', 'ret2', 'ret3')
end)

test('transfer() args are passed to the other thread', function()
	local thread = coroutine.create(function()
		coroutine.transfer(main, 'ret1', 'ret2', 'ret3')
	end)
	local ret1, ret2, ret3 = narg(3, coroutine.transfer(thread))
	assert(ret1 == 'ret1')
	assert(ret2 == 'ret2')
	assert(ret3 == 'ret3')
end)

test('first resume() args are passed as function args', function()
	local thread = coroutine.create(function(...)
		assert(select('#', ...) == 3)
		local a, b, c = ...
		assert(a == 5)
		assert(b == 7)
		assert(c == 9)
	end)
	local ok = narg(1, coroutine.resume(thread, 5, 7, 9))
	assert(ok == true)
end)

test('thread\'s return values are passed to the caller thread', function()
	local thread = coroutine.create(function(...)
		return 5, 7, 9
	end)
	local ok, a, b, c = narg(4, coroutine.resume(thread, 5, 7, 9))
	assert(ok == true)
	assert(a == 5)
	assert(b == 7)
	assert(c == 9)
end)

test('yield() args are passed to the caller thread', function()
	local thread = coroutine.create(function()
		coroutine.yield(3, 2, 1)
		coroutine.yield('a', nil, 'c', false, nil)
	end)
	local ok, a, b, c = narg(4, coroutine.resume(thread))
	assert(ok == true)
	assert(a == 3)
	assert(b == 2)
	assert(c == 1)
	local ok, a, b, c, d, e = narg(6, coroutine.resume(thread))
	assert(ok == true)
	assert(a == 'a')
	assert(b == nil)
	assert(c == 'c')
	assert(d == false)
	assert(e == nil)
end)

test('first resume() args are passed as function args to wrapped coroutine',
function()
	local thread = coroutine.wrap(function(...)
		local a, b, c = narg(3, ...)
		assert(a == 5)
		assert(b == 7)
		assert(c == 9)
	end)
	thread(5, 7, 9)
end)

test('return values of wrapped coroutine are passed to the caller thread',
function()
	local thread = coroutine.wrap(function()
		return 5, 7, 9
	end)
	local a, b, c = narg(3, thread())
	assert(a == 5)
	assert(b == 7)
	assert(c == 9)
end)

test('yield() args in wrapped coroutine are passed to the caller thread',
function()
	local thread = coroutine.wrap(function()
		coroutine.yield(5, 7, 9)
		coroutine.yield('a', nil, 'c', nil)
	end)
	local a, b, c = narg(3, thread())
	assert(a == 5)
	assert(b == 7)
	assert(c == 9)
	local a, b, c, d = narg(4, thread())
	assert(a == 'a')
	assert(b == nil)
	assert(c == 'c')
	assert(d == nil)
	narg(0, thread())
end)

test('yield() from the main thread raises error in main', function()
	local ok, err = pcall(coroutine.yield)
	assert(ok == false)
	assert(err:find'yielding from the main')
end)

test('yield() from a non-resumed thread raises error in thread', function()
	local thread = coroutine.create(function()
		local ok, err = pcall(coroutine.yield)
		assert(ok == false)
		assert(err:find'yielding from a non')
		coroutine.transfer(main)
	end)
	coroutine.transfer(thread)
end)

test('coroutine ending without transferring control raises error in main',
function()
	local thread = coroutine.create(function() end)
	local ok, err = pcall(coroutine.transfer, thread)
	assert(ok == false)
	assert(err:find'without transferring')
end)

test('coroutine ending without transferring control raises error in main (2)',
function()
	local thread = coroutine.create(function()
		local thread2 = coroutine.create(function() end)
		pcall(coroutine.transfer, thread2)
		assert(false) --transfer breaks in main thread, not reaching here
	end)
	local ok, err = pcall(coroutine.transfer, thread)
	assert(ok == false)
	assert(err:find'without transferring')
end)

test('error() in thread is reported to the parent thread', function()
	local thread = coroutine.create(function()
		error'!err!'
	end)
	local ok, err = coroutine.resume(thread)
	assert(ok == false)
	assert(err:find'!err!')
end)

test('error() in sub-thread is reported to the parent thread', function()
	local thread = coroutine.create(function()
		local sub = coroutine.create(function()
			error'!sub!'
		end)
		local ok, err = coroutine.resume(sub)
		coroutine.yield(ok, err)
	end)
	local ok_thread, ok, err = coroutine.resume(thread)
	assert(ok_thread == true)
	assert(ok == false)
	assert(err:find'!sub!')
end)

test('error() in wrapped sub-thread is raised in the parent thread',
function()
	local thread = coroutine.create(function()
		local sub = coroutine.wrap(function()
			error'!err!'
		end)
		sub()
		error'here' --not reaching here, sub() re-raises the error
	end)
	local ok, err = coroutine.resume(thread)
	assert(ok == false)
	assert(err:find'!err!')
end)

test('error() in transferred thread is raised in the main thread', function()
	local ok, err, traceback = coroutine.ptransfer(coroutine.create(function()
		local thread = coroutine.create(function()
			error'here'
		end)
		coroutine.transfer(thread)
		assert(false) --not reaching here, transfer() didn't set a caller.
	end))
	assert(not ok)
	assert(err:find'here')
	assert(traceback)
end)

test('trying to resume the current thread', function()
	local ok, err = pcall(coroutine.resume, coroutine.running())
	assert(ok == false)
	assert(err:find'resume the running thread')
end)

test('trying to resume the main thread', function()
	local thread = coroutine.wrap(function()
		local ok, err = pcall(coroutine.resume, main, 5, 6, 7)
		assert(ok == false)
		assert(err:find'resume the main thread')
	end)
	thread()
end)

test('nested wrap()-based iterators', function()
	local iter1 = coroutine.wrap(function()
		local iter2 = coroutine.wrap(function()
			coroutine.yield('k1', 'v1')
			coroutine.yield('k2', 'v2')
			coroutine.yield('k3', 'v3')
		end)
		for k,v in iter2 do
			coroutine.yield(v, k)
		end
	end)
	local t = {}
	for v,k in iter1 do
		t[#t+1] = k..v
	end
	assert(#t == 3)
	assert(t[1] == 'k1v1')
	assert(t[2] == 'k2v2')
	assert(t[3] == 'k3v3')
end)

test('transfer() inside wrap()/yield()-based iterator', function()
	local i = 0
	local function nextval()
		if i == 10 then
			return
		end
		i = i + 1
		return i
	end

	local scheduler = coroutine.create(function(thread)
		while true do
			thread = coroutine.transfer(thread, nextval())
		end
	end)

	local function read()
		return coroutine.transfer(scheduler, (coroutine.running()))
	end

	local thread = coroutine.wrap(function(...)

		local p,a1,a2 = narg(3,...)
		assert(p == 'passed')
		assert(a1 == 'arg1')
		assert(a2 == 'arg2')

		local iter = coroutine.wrap(function()
			local i = 0
			while true do
				i = i + 1
				local v1 = read()
				local v2 = read()
				coroutine.yield('step'..i, v1, v2)
				if v2 == 10 then break end
				if not v1 or not v2 then break end
			end
		end)
		local t = {}
		for step, v1, v2 in iter do
			t[#t+1] = {step, v1, v2}
		end

		assert(#t == 5)
		for i=1,#t do
			assert(t[i][1] == 'step'..i)
			assert(t[i][2] == i*2-1)
			assert(t[i][3] == i*2)
		end

		return 'returned', 'ret1', 'ret2'
	end)
	local r,r1,r2 = narg(3, thread('passed', 'arg1', 'arg2'))
	assert(r == 'returned')
	assert(r1 == 'ret1')
	assert(r2 == 'ret2')
end)

test('transfer() is not stack bound', function()
	local i = 0
	local max = 100000
	local function more() i = i + 1; return i < max end
	local t1, t2, t3
	t1 = coroutine.create(function()
		while more() do coroutine.transfer(t2) end
		coroutine.transfer(main)
	end)
	t2 = coroutine.create(function()
		while more() do coroutine.transfer(t3) end
		coroutine.transfer(main)
	end)
	t3 = coroutine.create(function()
		while more() do coroutine.transfer(t1) end
		coroutine.transfer(main)
	end)
	coroutine.transfer(t1)
	assert(i == max)
end)

test('transfer() chains and coroutine.running()', function()
	local t = {}
	coroutine.transfer(coroutine.create(function()
		local parent = coroutine.running()
		local thread = coroutine.create(function()
			table.insert(t, 'sub')
			coroutine.transfer(parent)
		end)
		coroutine.transfer(thread)
		table.insert(t, 'back')
		coroutine.transfer(main)
	end))
	assert(coroutine.running() == main)
	assert(#t == 2)
	assert(t[1] == 'sub')
	assert(t[2] == 'back')

	local t = {}
	coroutine.transfer(coroutine.create(function()
		local parent = coroutine.running()
		local thread = coroutine.wrap(function()
			for i=1,1000 do
				coroutine.transfer(parent, i * i)
			end
		end)
		for s in thread do
			table.insert(t, s)
		end
		coroutine.transfer(main)
	end))
	assert(coroutine.running() == main)
	assert(#t == 1000)
	for i=1,1000 do assert(t[i] == i * i) end
end)

test('safewrap() cross-yielding', function()

	local f1 = coroutine.safewrap(function(yield1, a)
			assert(a == 1)
			local f2 = coroutine.safewrap(function(yield2, a)
				assert(coroutine.transfer(main, coroutine.running(), 'go') == 'back')
				assert(a == 11)
				assert(yield1(1) == 2)
				assert(yield2(22) == 33)
				return 44
			end)
			assert(f2(11) == 22)
			assert(f2(33) == 44)
			assert(yield1(3) == 4)
			return 5
	end)

	local co = coroutine.create(function()
		assert(f1(1) == 1)
		assert(f1(2) == 3)
		assert(f1(4) == 5)
		assert(select(2, pcall(f1)):find('dead'))
		coroutine.transfer(main, 'over')
	end)

	local thread, val = coroutine.transfer(co)
	assert(val == 'go')
	assert(coroutine.transfer(thread or main, 'back') == 'over')

end)

test('suspended coroutines are garbage-collected', function()
	local t = setmetatable({}, {__mode = 'k'})
	local parent = coroutine.running()
	local co = coroutine.create(function(...)
		coroutine.transfer(parent, ...)
		print'unreachable code'
	end)
	t[co] = true
	collectgarbage(); assert(next(t))
	assert(coroutine.transfer(co, 'abc') == 'abc')
	collectgarbage(); assert(next(t))
	co = nil
	collectgarbage(); assert(not next(t))
end)
