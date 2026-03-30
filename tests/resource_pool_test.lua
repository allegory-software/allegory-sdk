require'sock'
require'resource_pool'

--logging.debug = true

run(function()

	-- [1] empty pool: get() must create
	do
		local pool = resource_pool{max_resources = 2}
		local res, err = pool:get()
		assert(res == nil and err == 'create')
	end

	-- [2] basic lifecycle: create -> put -> reuse -> get
	do
		local pool = resource_pool{max_resources = 2}
		local r1, r2 = {}, {}
		local _, e = pool:get(); assert(e == 'create'); pool:put(r1)
		local _, e = pool:get(); assert(e == 'create'); pool:put(r2)
		pool:reuse(r1)
		local res = pool:get(); assert(res == r1)
		pool:reuse(r2)
		local res = pool:get(); assert(res == r2)
	end

	-- [3] full pool, no expires: immediate timeout
	do
		local pool = resource_pool{max_resources = 1}
		local r1 = {}
		local _, e = pool:get(); assert(e == 'create'); pool:put(r1)
		local res, err = pool:get()
		assert(res == nil and err == 'timeout')
	end

	-- [4] full pool, past expires: immediate timeout
	do
		local pool = resource_pool{max_resources = 1}
		local r1 = {}
		local _, e = pool:get(); assert(e == 'create'); pool:put(r1)
		local res, err = pool:get(clock() - 1)
		assert(res == nil and err == 'timeout')
	end

	-- [5] waitlist_limit=0: can't queue even with a future expires
	do
		local pool = resource_pool{max_resources = 1, max_waiting_threads = 0}
		local r1 = {}
		local _, e = pool:get(); assert(e == 'create'); pool:put(r1)
		local res, err = pool:get(clock() + 10)
		assert(res == nil and err == 'timeout')
	end

	-- [6] waiting thread woken by reuse()
	do
		local pool = resource_pool{max_resources = 1}
		local r1 = {}
		local _, e = pool:get(); assert(e == 'create'); pool:put(r1)
		local got_res, got_err
		resume(thread(function()
			got_res, got_err = pool:get(clock() + 10)
		end, 'test'))
		-- thread is now blocked on wait_until(); main continues
		pool:reuse(r1) -- check_waitlist() -> wait_job:resume() -> thread runs synchronously
		assert(got_res == r1)
		assert(got_err == nil)
	end

	-- [7] waiting thread woken by pull(): gets nil,'create' (slot freed)
	do
		local pool = resource_pool{max_resources = 1}
		local r1 = {}
		local _, e = pool:get(); assert(e == 'create'); pool:put(r1)
		local got_res, got_err
		resume(thread(function()
			got_res, got_err = pool:get(clock() + 10)
		end, 'test'))
		pool:pull(r1) -- n->0, wakes waiter; waiter sees n < limit -> 'create'
		assert(got_res == nil)
		assert(got_err == 'create')
	end

	-- [8] waiting thread woken by cancel(): gets nil,'create' (reserved slot freed)
	do
		local pool = resource_pool{max_resources = 1}
		local _, e = pool:get(); assert(e == 'create') -- n=1=limit, slot reserved
		local got_res, got_err
		resume(thread(function()
			got_res, got_err = pool:get(clock() + 10)
		end, 'test'))
		pool:cancel() -- n->0, wakes waiter
		assert(got_res == nil)
		assert(got_err == 'create')
	end

	-- [9] waiting thread times out
	do
		local pool = resource_pool{max_resources = 1}
		local r1 = {}
		local _, e = pool:get(); assert(e == 'create'); pool:put(r1)
		local got_res, got_err
		resume(thread(function()
			got_res, got_err = pool:get(clock() + 0.02)
		end, 'test'))
		wait(0.1) -- outlast the thread's deadline
		assert(got_res == nil)
		assert(got_err == 'timeout')
	end

	-- [10] FIFO order: waiters released in queue order
	do
		local pool = resource_pool{max_resources = 1}
		local r1 = {}
		local _, e = pool:get(); assert(e == 'create'); pool:put(r1)
		local order = {}
		resume(thread(function() -- A queues first
			local res = pool:get(clock() + 10)
			order[#order+1] = 'A'
			pool:reuse(res) -- wakes B
		end, 'test1'))
		resume(thread(function() -- B queues second
			local res = pool:get(clock() + 10)
			order[#order+1] = 'B'
			pool:reuse(res)
		end, 'test2'))
		pool:reuse(r1) -- wakes A; A reuses -> wakes B; B reuses -> done
		assert(order[1] == 'A')
		assert(order[2] == 'B')
	end

	-- [11] pull() on a free resource removes it from the free list
	do
		local pool = resource_pool{max_resources = 2}
		local r1, r2 = {}, {}
		local _, e = pool:get(); assert(e == 'create'); pool:put(r1)
		local _, e = pool:get(); assert(e == 'create'); pool:put(r2)
		pool:reuse(r1)
		pool:reuse(r2)
		pool:pull(r1) -- pull while free: n->1, r1 removed from free list
		local res = pool:get(); assert(res == r2) -- only r2 was free
		local _, err = pool:get(); assert(err == 'create') -- one slot still open
	end

	-- [12] concurrent creation: two threads both get nil,'create', both put() without crashing
	do
		local pool = resource_pool{max_resources = 2}
		local puts = 0
		resume(thread(function() -- Thread A gets first slot
			local _, e = pool:get(); assert(e == 'create') -- n=1, reserved=1
			wait(0) -- yield so Thread B can also call get()
			pool:put({})
			puts = puts + 1
		end, 'test1'))
		-- Thread A yielded. Thread B now runs:
		resume(thread(function()
			local _, e = pool:get(); assert(e == 'create') -- n=2, reserved=2
			pool:put({})
			puts = puts + 1
		end, 'test2'))
		-- Thread B done. Let Thread A resume its put():
		wait(0)
		assert(puts == 2)
		local _, err = pool:get()
		assert(err == 'timeout') -- pool is full (n=2=limit)
	end

	print'respool ok'
end)
