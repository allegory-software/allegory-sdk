--[=[

	Resource pools for managing access to limited resources.
	Written by Cosmin Apreutesei. Public domain.

Resource pools are managing a limited number of resources that can be reused
in order to 1) avoid creating too many of those resouces in total and 2) avoid
creating and destroying resources on every use assuming these operations are
slow, like connections to external services.

	resource_pool([opt]) -> pool   create a resource pool
	  max_resources                max resources to accept in the pool (100)
	  max_waiting_threads          max threads to queue up (1000)
	pool:get([expires]) -> res     get a free resource from the pool
	pool:put(res)                  put a resource in the pool in busy state
	pool:reuse(res)                mark resource as free to be reused
	pool:pull(res)                 pull a dead resource out of the pool

pool:get(key, [expires]) -> res
	Get a free resource from the pool. The optional `expires` arg is a clock()
	deadline to wait for a resource to become available when all resources
	are busy. If not given, there's no waiting.

	Returns nil,'timeout' if the pool is full, all resources are busy, and:
		* the deadline expired, or:
		* the thread waiting list is full so it can't accept new threads.

	Returns nil,'create' if the pool is not at capacity, in which case the
	caller is free to create a resource and put it in the pool.

pool:put(res)
	Put a resource in a pool in busy state. Call pool:reuse(res) to mark it free.

pool:cancel()
	Signal that resource creation after get() returned nil,'create' failed.

pool:reuse(res)
	Mark a resource (that is already busy in the pool) as free for reuse.

pool:pull(res)
	Pull a resource out of the pool because it has become unusable (it was closed).


IMPLEMENTATION

The pool mechanics is simple (it's just a free list) until the resource
limit is reached and then it gets more complicated because we need to put
the threads on a waiting list and resume them in fifo order and we also
need to remove them from wherever they are on the waiting list on timeout.
This is made easy because we have: 1) a ring buffer that allows removal at
arbitrary positions and 2) sock's interruptible timers.

]=]

if not ... then require'respool_test'; return end

require'glue'
require'sock'
require'queue'

function resource_pool(opt)

	local pool = update({
		max_resources = 100,
		max_waiting_threads = 1000,
	}, opt)

	local limit = pool.max_resources
	local waitlist_limit = pool.max_waiting_threads
	assert(limit >= 1)
	assert(waitlist_limit >= 0)

	local n = 0 --number of resource in the pool, both busy and free.
	local free = {} --freelist of free resources
	local reserved = 0 --number of resources reserved for creation

	local function dbg(event, res, ufmt, ...)
		log('', 'rpool', event, '%-4s %-4s n=%d free=%d reserved=%d %s',
			currentthread(), res or '', n, #free, reserved, ufmt and _(ufmt, ...) or '')
	end

	local q
	local function wait(expires)
		if waitlist_limit < 1 or not expires or expires <= clock() then
			dbg'notime'
			return nil, 'timeout'
		end
		q = q or queue(waitlist_limit)
		if q:full() then
			dbg'q-full'
			return nil, 'timeout'
		end
		local wait_job = wait_job()
		q:push(wait_job)
		if wait_job:wait_until(expires) then
			return true --either reuse(), pull(), or cancel() was called
		else
			dbg'timeout'
			q:remove(wait_job)
			return nil, 'timeout'
		end
	end

	local function check_waitlist()
		local wait_job = q and q:pull()
		if not wait_job then return end
		wait_job:resume(true)
	end

	function pool:get(expires)
		local res = pop(free)
		if res then
			pool[res] = 'busy'
			dbg('pop', res)
			return res
		end
		if n >= limit then
			dbg('wait', nil, '%.2ds', expires and expires - clock() or 0)
			local ok, err = wait(expires)
			if not ok then return nil, err end
			local res = pop(free)
			if res then
				pool[res] = 'busy'
				dbg('pop', res)
				return res
			end
			if n >= limit then
				dbg'full'
				return nil, 'timeout'
			end
		end
		dbg'create'
		--reserve a slot for the new resource.
		--reserving the slot now prevents race conditions if res creation yields.
		--the complication is that if res creation fails you must call cancel().
		n = n + 1
		reserved = reserved + 1
		return nil, 'create'
	end

	function pool:cancel()
		assert(reserved > 0)
		n = n - 1
		reserved = reserved - 1
		check_waitlist()
	end

	function pool:put(res)
		assert(n <= limit)
		assert(reserved > 0) --only put if get() returned nil,'create'
		reserved = reserved - 1
		assert(not pool[res]) --only put a res once
		pool[res] = 'busy'
		dbg('put', res)
	end

	function pool:reuse(res)
		assert(pool[res] == 'busy') --only call reuse() once
		add(free, res)
		pool[res] = 'free'
		dbg('reuse', res)
		check_waitlist() --because #free > 0 now
	end

	function pool:pull(res)
		assert(pool[res]) --only pull once
		pool[res] = nil
		n = n - 1
		local i = remove_value(free, res)
		dbg('close', res, 'was_free=%s', i and true or false)
		check_waitlist() -- because n < limit now
	end

	return pool
end
