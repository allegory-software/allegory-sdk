local coroutine = require'coro'
local main = coroutine.running()

local n_ok, n_fail = 0, 0
local function test(descr, f)
	local ok, err = xpcall(f, debug.traceback)
	print((ok and 'ok:   ' or 'fail: ') .. descr)
	if not ok then
		io.stderr:write(tostring(err)..'\n')
		n_fail = n_fail + 1
	else
		n_ok = n_ok + 1
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
		assert(ret2 == false)
		assert(ret3 == nil)
		return main
	end)

	coroutine.transfer(co, 'ret1', false, nil)
	assert(coroutine.status(co) == 'dead')
end)

test('transfer() args are passed to suspended coroutine', function()
	local co = coroutine.create(function()
		local ret1, ret2, ret3 = narg(3, coroutine.transfer(main, 'ready'))
		assert(ret1 == 'ret1')
		assert(ret2 == false)
		assert(ret3 == nil)
		return main, 'done'
	end)

	assert(coroutine.transfer(co) == 'ready')
	assert(coroutine.transfer(co, 'ret1', false, nil) == 'done')
	assert(coroutine.status(co) == 'dead')
end)

test('coroutine return target transfers values', function()
	local co = coroutine.create(function()
		return main, 'ret1', false, nil
	end)

	local ret1, ret2, ret3 = narg(3, coroutine.transfer(co))
	assert(ret1 == 'ret1')
	assert(ret2 == false)
	assert(ret3 == nil)
	assert(coroutine.status(co) == 'dead')
end)

test('empty and nil target returns transfer to main', function()
	local empty = coroutine.create(function()
	end)
	narg(0, coroutine.transfer(empty))
	assert(coroutine.status(empty) == 'dead')

	local nil_target = coroutine.create(function()
		return nil, 'ret'
	end)
	assert(coroutine.transfer(nil_target) == 'ret')
	assert(coroutine.status(nil_target) == 'dead')
end)

test('false finish target raises error', function()
	local co = coroutine.create(function()
		return false, 'ret'
	end)

	local ok, err = pcall(coroutine.transfer, co)
	assert(ok == false)
	assert(tostring(err):find('thread expected', 1, true))
	assert(coroutine.status(co) == 'dead')
end)

test('finish to self raises error', function()
	local co
	co = coroutine.create(function()
		return co, 'ret'
	end)

	local ok, err = pcall(coroutine.transfer, co)
	assert(ok == false)
	assert(tostring(err):find('finish to self', 1, true))
	assert(coroutine.status(co) == 'dead')
end)

test('finish to dead coroutine raises error', function()
	local target = coroutine.create(function()
		return main, 'target-done'
	end)
	assert(coroutine.transfer(target) == 'target-done')
	assert(coroutine.status(target) == 'dead')

	local co = coroutine.create(function()
		return target, 'ret'
	end)

	local ok, err = pcall(coroutine.transfer, co)
	assert(ok == false)
	assert(tostring(err):find('finish to a dead coroutine', 1, true))
	assert(coroutine.status(co) == 'dead')
end)

test('try_transfer() validates target before transfer', function()
	local ok, err = coroutine.try_transfer({})
	assert(ok == nil)
	assert(err:find('thread expected', 1, true))

	local co = coroutine.create(function()
		return main
	end)
	assert(coroutine.transfer(co) == nil)
	assert(coroutine.status(co) == 'dead')

	ok, err = coroutine.try_transfer(co)
	assert(ok == nil)
	assert(err:find('dead', 1, true))
end)

test('transfer() to invalid target raises error', function()
	local ok, err = pcall(coroutine.transfer, {})
	assert(ok == false)
	assert(tostring(err):find('thread expected', 1, true))
end)

test('transfer() to self is rejected', function()
	local co
	co = coroutine.create(function()
		local ok, err = coroutine.try_transfer(co)
		assert(ok == nil)
		assert(err:find('self', 1, true))
		return main, 'done'
	end)

	assert(coroutine.transfer(co) == 'done')
end)

test('coroutine errors are raised in main and current is restored', function()
	local co = coroutine.create(function()
		error'!err!'
	end)

	local ok, err = pcall(coroutine.transfer, co)
	assert(ok == false)
	assert(tostring(err):find('!err!', 1, true))
	assert(coroutine.status(co) == 'dead')
	assert(coroutine.running() == main)

	local next_co = coroutine.create(function()
		return main, 'next'
	end)
	assert(coroutine.transfer(next_co) == 'next')
end)

test('coroutine errors preserve non-string error values', function()
	local co = coroutine.create(function()
		error(false)
	end)

	local ok, err = pcall(coroutine.transfer, co)
	assert(ok == false)
	assert(err == false)
	assert(coroutine.status(co) == 'dead')
end)

test('transfer() is not stack bound', function()
	local i = 0
	local max = 100000
	local function more() i = i + 1; return i < max end
	local t1, t2, t3
	t1 = coroutine.create(function()
		while more() do coroutine.transfer(t2) end
		return main
	end)
	t2 = coroutine.create(function()
		while more() do coroutine.transfer(t3) end
		return main
	end)
	t3 = coroutine.create(function()
		while more() do coroutine.transfer(t1) end
		return main
	end)
	coroutine.transfer(t1)
	assert(i == max)
end)

test('transfer() chains and coroutine.running()', function()
	local t = {}
	local co = coroutine.create(function()
		local parent = coroutine.running()
		local sub = coroutine.create(function()
			table.insert(t, 'sub')
			coroutine.transfer(parent)
			return main
		end)
		coroutine.transfer(sub)
		table.insert(t, 'back')
		return main
	end)

	coroutine.transfer(co)
	assert(coroutine.running() == main)
	assert(#t == 2)
	assert(t[1] == 'sub')
	assert(t[2] == 'back')
end)

test('wrap() returns plain values', function()
	local f, co = coroutine.wrap(function(yield, ...)
		local a, b, c = narg(3, ...)
		assert(a == 'arg1')
		assert(b == false)
		assert(c == nil)
		return 'ret1', false, nil
	end)

	local ret1, ret2, ret3 = narg(3, f('arg1', false, nil))
	assert(ret1 == 'ret1')
	assert(ret2 == false)
	assert(ret3 == nil)
	assert(coroutine.status(co) == 'dead')
end)

test('wrap() yield returns plain values', function()
	local f, co = coroutine.wrap(function(yield)
		local a, b, c = narg(3, yield('yield1', false, nil))
		assert(a == 'back1')
		assert(b == false)
		assert(c == nil)
		return 'done', a, b, c
	end)

	local a, b, c = narg(3, f())
	assert(a == 'yield1')
	assert(b == false)
	assert(c == nil)

	local r, a1, b1, c1 = narg(4, f('back1', false, nil))
	assert(r == 'done')
	assert(a1 == 'back1')
	assert(b1 == false)
	assert(c1 == nil)
	assert(coroutine.status(co) == 'dead')
end)

test('wrap() false yield value does not raise', function()
	local f = coroutine.wrap(function(yield)
		yield(false, 'value')
		return 'done'
	end)

	local a, b = narg(2, f())
	assert(a == false)
	assert(b == 'value')
	assert(f() == 'done')
end)

test('wrap() errors are raised in caller', function()
	local f, co = coroutine.wrap(function()
		error'!err!'
	end)

	local ok, err = pcall(f)
	assert(ok == false)
	assert(tostring(err):find('!err!', 1, true))
	assert(coroutine.status(co) == 'dead')
end)

test('wrap() errors after yield are raised in caller', function()
	local f, co = coroutine.wrap(function(yield)
		yield'first'
		error(false)
	end)

	assert(f() == 'first')
	local ok, err = pcall(f)
	assert(ok == false)
	assert(err == false)
	assert(coroutine.status(co) == 'dead')
end)

test('wrap() errors are catchable from coroutine caller', function()
	local parent = coroutine.create(function()
		local f = coroutine.wrap(function()
			error'!err!'
		end)
		local ok, err = pcall(f)
		return main, ok, tostring(err):find('!err!', 1, true) ~= nil
	end)

	local ok, found = narg(2, coroutine.transfer(parent))
	assert(ok == false)
	assert(found == true)
	assert(coroutine.status(parent) == 'dead')
end)

test('nested wrap()-based iterators', function()
	local iter1 = coroutine.wrap(function(yield1)
		local iter2 = coroutine.wrap(function(yield2)
			yield2('k1', 'v1')
			yield2('k2', 'v2')
			yield2('k3', 'v3')
		end)
		for k, v in iter2 do
			yield1(v, k)
		end
	end)

	local t = {}
	for v, k in iter1 do
		t[#t+1] = k..v
	end
	assert(#t == 3)
	assert(t[1] == 'k1v1')
	assert(t[2] == 'k2v2')
	assert(t[3] == 'k3v3')
end)

test('transfer() inside wrap()-based iterator', function()
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
		return coroutine.transfer(scheduler, coroutine.running())
	end

	local f = coroutine.wrap(function(yield, ...)
		local p, a1, a2 = narg(3, ...)
		assert(p == 'passed')
		assert(a1 == 'arg1')
		assert(a2 == 'arg2')

		local iter = coroutine.wrap(function(yield_iter)
			local i = 0
			while true do
				i = i + 1
				local v1 = read()
				local v2 = read()
				yield_iter('step'..i, v1, v2)
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

	local r, r1, r2 = narg(3, f('passed', 'arg1', 'arg2'))
	assert(r == 'returned')
	assert(r1 == 'ret1')
	assert(r2 == 'ret2')
end)

test('wrap() cross-yielding', function()
	local f1 = coroutine.wrap(function(yield1, a)
		assert(a == 1)
		local f2 = coroutine.wrap(function(yield2, a)
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
		return main, 'over'
	end)

	local co1, val = coroutine.transfer(co)
	assert(val == 'go')
	assert(coroutine.transfer(co1, 'back') == 'over')
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

test('abandoned suspended wrap() coroutine is garbage-collected', function()
	local t = setmetatable({}, {__mode = 'k'})
	do
		local f, co = coroutine.wrap(function(yield)
			yield('paused')
			print'unreachable code'
		end)
		t[co] = true
		assert(f() == 'paused')
		collectgarbage(); assert(next(t))
		f = nil
		co = nil
	end
	collectgarbage()
	collectgarbage()
	assert(not next(t))
end)

print(('ok: %d, failed: %d'):format(n_ok, n_fail))
