local coroutine = require'coro'
local main = coroutine.running()

local n_fail = 0
local function test(descr, f)
	local ok, err = xpcall(f, debug.traceback)
	print((ok and 'ok:   ' or 'fail: ') .. descr)
	if not ok then
		print(err)
		n_fail = n_fail + 1
	end
	assert(coroutine.running() == main)
end

local function narg(n, ...)
	assert(select('#', ...) == n)
	return ...
end

test('first transfer() args are passed as function args', function()
	local co = coroutine.create(function(...)
		local ret1, ret2, ret3 = narg(3, ...)
		assert(ret1 == 'ret1')
		assert(ret2 == 'ret2')
		assert(ret3 == 'ret3')
		coroutine.transfer(main)
	end)
	coroutine.transfer(co, 'ret1', 'ret2', 'ret3')
end)

test('transfer() args are passed to the other coroutine', function()
	local co = coroutine.create(function()
		coroutine.transfer(main, 'ret1', 'ret2', 'ret3')
	end)
	local ret1, ret2, ret3 = narg(3, coroutine.transfer(co))
	assert(ret1 == 'ret1')
	assert(ret2 == 'ret2')
	assert(ret3 == 'ret3')
end)

test('finish() transfers to target coroutine', function()
	local co = coroutine.create(function()
		return coroutine.finish_into(main, 'ret1', false, nil)
	end)
	local ret1, ret2, ret3 = narg(3, coroutine.transfer(co))
	assert(ret1 == 'ret1')
	assert(ret2 == false)
	assert(ret3 == nil)
	assert(coroutine.status(co) == 'dead')
end)

test('finish_with() transfers error to target coroutine', function()
	local co = coroutine.create(function()
		return coroutine.finish_into_with(main, false, '!err!')
	end)
	local ok, err = coroutine.transfer_with(co, true)
	assert(ok == false)
	assert(err == '!err!')
	assert(coroutine.status(co) == 'dead')
end)

test('resumed coroutine cannot finish with a transfer', function()
	local child
	local parent = coroutine.create(function()
		child = coroutine.create(function()
			return coroutine.finish_into(main)
		end)
		coroutine.resume(child)
		assert(false) --resume breaks in main coroutine, not reaching here
	end)
	local ok, err = pcall(coroutine.transfer, parent)
	assert(ok == false)
	assert(err:find'resumed coroutine finished with a transfer')
	assert(coroutine.status(child) == 'dead')
end)

test('first resume() args are passed as function args', function()
	local co = coroutine.create(function(...)
		assert(select('#', ...) == 3)
		local a, b, c = ...
		assert(a == 5)
		assert(b == 7)
		assert(c == 9)
	end)
	local ok = narg(1, coroutine.resume(co, 5, 7, 9))
	assert(ok == true)
end)

test('coroutine\'s return values are passed to the caller coroutine', function()
	local co = coroutine.create(function(...)
		return 5, 7, 9
	end)
	local ok, a, b, c = narg(4, coroutine.resume(co, 5, 7, 9))
	assert(ok == true)
	assert(a == 5)
	assert(b == 7)
	assert(c == 9)
end)

test('yield() args are passed to the caller coroutine', function()
	local co = coroutine.create(function()
		coroutine.yield(3, 2, 1)
		coroutine.yield('a', nil, 'c', false, nil)
	end)
	local ok, a, b, c = narg(4, coroutine.resume(co))
	assert(ok == true)
	assert(a == 3)
	assert(b == 2)
	assert(c == 1)
	local ok, a, b, c, d, e = narg(6, coroutine.resume(co))
	assert(ok == true)
	assert(a == 'a')
	assert(b == nil)
	assert(c == 'c')
	assert(d == false)
	assert(e == nil)
end)

test('resumed coroutine can yield repeatedly', function()
	local co = coroutine.create(function()
		assert(coroutine.yield(1) == 10)
		assert(coroutine.yield(2) == 20)
		assert(coroutine.yield(3) == 30)
		return 4
	end)
	local ok, v = narg(2, coroutine.resume(co))
	assert(ok == true)
	assert(v == 1)
	local ok, v = narg(2, coroutine.resume(co, 10))
	assert(ok == true)
	assert(v == 2)
	local ok, v = narg(2, coroutine.resume(co, 20))
	assert(ok == true)
	assert(v == 3)
	local ok, v = narg(2, coroutine.resume(co, 30))
	assert(ok == true)
	assert(v == 4)
end)

test('first resume() args are passed as function args to wrapped coroutine',
function()
	local co = coroutine.wrap(function(...)
		local a, b, c = narg(3, ...)
		assert(a == 5)
		assert(b == 7)
		assert(c == 9)
	end)
	co(5, 7, 9)
end)

test('return values of wrapped coroutine are passed to the caller coroutine',
function()
	local co = coroutine.wrap(function()
		return 5, 7, 9
	end)
	local a, b, c = narg(3, co())
	assert(a == 5)
	assert(b == 7)
	assert(c == 9)
end)

test('yield() args in wrapped coroutine are passed to the caller coroutine',
function()
	local co = coroutine.wrap(function()
		coroutine.yield(5, 7, 9)
		coroutine.yield('a', nil, 'c', nil)
	end)
	local a, b, c = narg(3, co())
	assert(a == 5)
	assert(b == 7)
	assert(c == 9)
	local a, b, c, d = narg(4, co())
	assert(a == 'a')
	assert(b == nil)
	assert(c == 'c')
	assert(d == nil)
	narg(0, co())
end)

test('yield() from the main coroutine raises error in main', function()
	local ok, err = pcall(coroutine.yield)
	assert(ok == false)
	assert(err:find'yielding from the main')
end)

test('yield() from a non-resumed coroutine raises error in coroutine', function()
	local co = coroutine.create(function()
		local ok, err = pcall(coroutine.yield)
		assert(ok == false)
		assert(err:find'yielding from a non')
		coroutine.transfer(main)
	end)
	coroutine.transfer(co)
end)

test('coroutine ending without transferring control raises error in main',
function()
	local co = coroutine.create(function() end)
	local ok, err = pcall(coroutine.transfer, co)
	assert(ok == false)
	assert(err:find'without transferring')
end)

test('coroutine ending without transferring control raises error in main (2)',
function()
	local co = coroutine.create(function()
		local co2 = coroutine.create(function() end)
		pcall(coroutine.transfer, co2)
		assert(false) --transfer breaks in main coroutine, not reaching here
	end)
	local ok, err = pcall(coroutine.transfer, co)
	assert(ok == false)
	assert(err:find'without transferring')
end)

test('error() in coroutine is reported to the parent', function()
	local co = coroutine.create(function()
		error'!err!'
	end)
	local ok, err = coroutine.resume(co)
	assert(ok == false)
	assert(err:find'!err!')
end)

test('error() in safewrap coroutine is reported to the caller coroutine', function()
	local ok, err = coroutine.resume(coroutine.create(function()
		local f = coroutine.safewrap(function(yield)
			error'!err!'
		end)
		local ok,err = pcall(f)
		assert(ok == false)
		assert(err:find'!err!')
		assert(ok, err)
	end))
	assert(ok == false)
	assert(err:find'!err!')
end)

test('error() in safewrap coroutine is reported to the caller coroutine', function()
	local was_here
	local ok, err = coroutine.resume(coroutine.create(function()
		local f = coroutine.safewrap(function(yield)
			yield'first'
			error'!err!'
		end)
		assert(f() == 'first')
		local ok,err = pcall(f)
		assert(ok == false)
		assert(err:find'!err!')
		was_here = true
		assert(ok, err)
	end))
	assert(was_here)
	assert(ok == false)
	assert(err:find'!err!')
end)

test('error() in sub-coroutine is reported to the parent coroutine', function()
	local co = coroutine.create(function()
		local sub = coroutine.create(function()
			error'!sub!'
		end)
		local ok, err = coroutine.resume(sub)
		coroutine.yield(ok, err)
	end)
	local ok_co, ok, err = coroutine.resume(co)
	assert(ok_co == true)
	assert(ok == false)
	assert(err:find'!sub!')
end)

test('error() in wrapped sub-coroutine is raised in the parent coroutine',
function()
	local co = coroutine.create(function()
		local sub = coroutine.wrap(function()
			error'!err!'
		end)
		sub()
		error'here' --not reaching here, sub() re-raises the error
	end)
	local ok, err = coroutine.resume(co)
	assert(ok == false)
	assert(err:find'!err!')
end)

test('error() in transferred coroutine is raised in main', function()
	local ok, err, traceback = coroutine.transfer_with(coroutine.create(function()
		local co = coroutine.create(function()
			error'here'
		end)
		coroutine.transfer(co)
		assert(false) --not reaching here, transfer() didn't set a caller.
	end), true)
	assert(not ok)
	assert(err:find'here')
end)

test('trying to resume the current coroutine', function()
	local ok, err = pcall(coroutine.resume, coroutine.running())
	assert(ok == false)
	assert(err:find'resume the running coroutine')
end)

test('trying to resume main', function()
	local co = coroutine.wrap(function()
		local ok, err = pcall(coroutine.resume, main, 5, 6, 7)
		assert(ok == false)
		assert(err:find'main')
	end)
	co()
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

	local scheduler = coroutine.create(function(co)
		while true do
			co = coroutine.transfer(co, nextval())
		end
	end)

	local function read()
		return coroutine.transfer(scheduler, (coroutine.running()))
	end

	local co = coroutine.wrap(function(...)

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
	local r,r1,r2 = narg(3, co('passed', 'arg1', 'arg2'))
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
		local co = coroutine.create(function()
			table.insert(t, 'sub')
			coroutine.transfer(parent)
		end)
		coroutine.transfer(co)
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
		local co = coroutine.wrap(function()
			for i=1,1000 do
				coroutine.transfer(parent, i * i)
			end
		end)
		for s in co do
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

	local co, val = coroutine.transfer(co)
	assert(val == 'go')
	assert(coroutine.transfer(co or main, 'back') == 'over')

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

test('abandoned resumed transfer cycle is garbage-collected', function()
	local t = setmetatable({}, {__mode = 'k'})
	do
		local parent
		parent = coroutine.create(function()
			local child = coroutine.create(function()
				coroutine.transfer(main)
				print'unreachable code'
			end)
			t[child] = true
			coroutine.resume(child)
			print'unreachable code'
		end)
		t[parent] = true
		coroutine.transfer(parent)
		parent = nil
	end
	collectgarbage()
	collectgarbage()
	assert(not next(t))
end)

if n_fail > 0 then
	pr('FAILED: '..n_fail)
else
	print'ALL OK'
end
