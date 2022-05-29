io.stdout:setvbuf'no'

require'glue'
require'os_thread'
require'pthread'
require'luastate'

local function test_events()
	local event = os_thread_event()
	local t1 = os_thread(function(event)
			local time = require'time'
			while true do
				print'set'
				event:set()
				sleep(0.1)
				print'clear'
				event:clear()
				sleep(1)
			end
		end, event)

	local t2 = os_thread(function(event)
			local time = require'time'
			while true do
				event:wait()
				print'!'
				sleep(0.1)
			end
		end, event)

	t1:join()
	t2:join()
end

local function printtime(s, n, dt)
	print(string.format('time to create %4d %-10s: %.2fs %6d %s/s', n, s, dt, n/dt, s))
end

local function test_pthread_creation()
	local state = luastate()
	state:openlibs()
	state:push(function()
   	require'glue'
		local function worker() end
	   local worker_cb = ffi.cast('void *(*)(void *)', worker)
	   return ptr_encode(worker_cb)
	end)
	local worker_cb_ptr = ptr_decode(state:call())
	local t0 = clock()
	local n = 1000
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
	local n = 100
	for i=1,n do
		local state = luastate()
		state:openlibs()
		state:push(function()
		end)
		state:call()
		state:close()
	end
	local dt = clock() - t0
	printtime('states', n, dt)
end

local function test_thread_creation()
	local t0 = clock()
	local n = 10
	for i=1,n do
		os_thread(function() end):join()
	end
	local dt = clock() - t0
	printtime('threads', n, dt)
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

	print(string.format('queue test: %d*%d -> %d*%d, queue size: %d, time: %dms',
		pn, pm, cn, cm, qsize, (t1 - t0) * 1000))
end

local function test_pool()
	--local q = synchronized_queue(1)
	--q:push('hi')
	--print(q:push('hello', time() + 1))
	local pool = os_thread_pool(1)
	for i=1,100 do
		--print('pushing', i)
		print('push result', pool:push(function() print'hello' end, time() + 1))
	end
	print'joining'
	pool:join()
end

--test_events()
test_pthread_creation() --TODO: this crashes on mingw64 !!!
test_luastate_creation()
test_thread_creation()
test_queue(1000, 10,  1000, 10,  1000)
test_queue(1000,  1, 10000,  1, 10000)
test_queue(1000,  1, 10000, 10,  1000)
test_queue(1000, 10,  1000,  1, 10000)
test_queue(1,     1, 10000, 10,  1000)
test_queue(1,    10,  1000,  1, 10000)
--test_pool()
