io.stdout:setvbuf'no'

require'glue'
require'os_thread'
require'pthread'
require'luastate'

local N = os.getenv'AUTO' and 10 or 1000

local function test_events()
	local event = os_thread_event()

	--event starts cleared
	assert(not event:isset())

	--wait on cleared event times out
	assert(not event:wait(clock() + 0.01))

	--set/isset/clear work
	event:set()
	assert(event:isset())
	event:clear()
	assert(not event:isset())

	--wait on set event returns immediately
	event:set()
	assert(event:wait())

	--test cross-thread signaling: producer sets event, consumer waits for it
	event:clear()
	local result = synchronized_queue(8)

	local t1 = os_thread(function(event, result)
		for i = 1, 5 do
			event:wait()
			result:push(i)
			event:clear()
		end
	end, event, result)

	for i = 1, 5 do
		sleep(0.01)
		event:set()
		sleep(0.01) --give consumer time to wake and clear
	end

	t1:join()
	assert(result:length() == 5, format('expected 5 results, got %d', result:length()))
	for i = 1, 5 do
		local _, v = result:shift()
		assert(v == i, format('expected %d, got %s', i, tostring(v)))
	end
	result:free()
	print 'os_thread_event() ok'
end

local function printtime(s, n, dt)
	print(string.format('time to create %4d %-10s: %.2fs %6d %s/s', n, s, dt, n/dt, s))
end

local function test_pthread_creation()
	local state = luastate()
	state:openlibs()
	state:push{[0] = arg[0]} --used to make `rel_scriptdir`
	state:setglobal'arg'
	state:push(function()
   	require'glue'
		local function worker() end
	   local worker_cb = ffi.cast('void *(*)(void *)', worker)
	   return ptr_serialize(worker_cb)
	end)
	local worker_cb_ptr = ptr_deserialize(state:call())
	local t0 = clock()
	local n = N
	for i=1,n do
		local thread = pthread(worker_cb_ptr)
		thread:join()
	end
	local dt = clock() - t0
	state:close()
	printtime('pthreads', n, dt)
end

local function test_luastate_creation()
	local t0 = clock()
	local n = N / 10
	for i=1,n do
		local state = luastate()
		state:openlibs() --this takes 10x than the luastate creation itself.
		require'glue'
		require'fs'
		require'sock'
		state:push(function() end)
		state:call()
		state:close()
	end
	local dt = clock() - t0
	printtime('states', n, dt)
end

local function test_thread_creation()
	local t0 = clock()
	local n = max(1, N / 100)
	for i=1,n do
		os_thread(function() end):join()
	end
	local dt = clock() - t0
	printtime('threads', n, dt)
end

local function test_thread_ownership()
	local th = os_thread(function()
		return 42, nil, false, 'x'
	end)
	local a, b, c, d = th:join()
	assert(a == 42)
	assert(b == nil)
	assert(c == false)
	assert(d == 'x')
	assert(th:closed())
	assert(th.owner == nil)
	assert(th:try_close())

	th = os_thread(function()
		error('os_thread test error', 0)
	end)
	local ok, err = pcall(function()
		th:join()
	end)
	assert(not ok)
	assert(err:find('os_thread test error', 1, true))
	assert(th:closed())
	assert(th.owner == nil)

	th = os_thread(function()
		return 'closed'
	end)
	ok, err = th:try_close()
	assert(ok == true)
	assert(err == 'closed')
	assert(th:closed())
	assert(th.owner == nil)

	th = os_thread(function() end)
	local child_closed
	local child = {
		try_close = function(self)
			child_closed = true
			_disown(self)
			return true
		end,
	}
	setowner(child, th)
	th:join()
	assert(child_closed)
	assert(child.owner == nil)

	local root = _own(mainthread(), {})
	th = os_thread(function() end)
	setowner(th, root)
	root:try_close()
	assert(root.owner == nil)
	assert(th:closed())
	assert(th.owner == nil)

	print 'os_thread ownership ok'
end

--pn/pm/cn/cm: producer/consumer threads/messages
local function test_queue(qsize, pn, pm, cn, cm, msg)

	msg = msg or {i = 321, j = 123, s = 'hello', bool = true}

	local q = synchronized_queue(qsize)

	local pt = {}
	for i = 1, pn do
		pt[i] = os_thread(function(q, n, msg)
			for i = 1, n do
				local z = q:push(msg)
				--io.stdout:write(table.concat({'push', z}, '\t')..'\n')
			end
		end, q, pm, msg)
	end

	local ct = {}
	for i = 1, cn do
		ct[i] = os_thread(function(q, n, msg)
			for i = 1, n do
				local _, v, z = q:shift()
				--io.stdout:write(table.concat({'pop', v, z}, '\t')..'\n')
			end
		end, q, cm, msg)
	end

	local t0 = clock()
	for i = 1, #pt do pt[i]:join() end
	for i = 1, #ct do ct[i]:join() end
	local t1 = clock()

	assert(q:length() == 0)
	assert(not q:peek())
	assert(not q:peek(-1))
	q:free()

	print(string.format('queue test: %d*%d -> %d*%d, queue size: %4d, time: %dms',
		pn, pm, cn, cm, qsize, (t1 - t0) * 1000))
end

local function test_pool()
	local pool = os_thread_pool(4)
	local n = 100
	for i = 1, n do
		assert(pool:push(function() end))
	end
	pool:join()
	assert(pool.queue == nil) --join freed the queue
	print 'os_thread_pool() ok'
end

test_events()
test_pthread_creation()
test_luastate_creation()
test_thread_creation()
test_thread_ownership()
test_queue(N, 10,    N, 10,    N)
test_queue(N,  1, 10*N,  1, 10*N)
test_queue(N,  1, 10*N, 10,    N)
test_queue(N, 10,    N,  1, 10*N)
test_queue(1,  1, 10*N, 10,    N)
test_queue(1, 10,    N,  1, 10*N)
test_pool()

print'os_thread ok'
