--[=[

	Connection pools.
	Written by Cosmin Apreutesei. Public domain.

Connection pools allow reusing and sharing a limited number of connections
between multiple threads in order to 1) avoid creating too many connections
and 2) avoid the lag of connecting and authenticating every time a connection
is needed.

	pools:setlimits(key, opt)        set limits for a specific pool
	pools:get(key, [expires]) -> c   get a connection from a pool
	pools:put(key, c, s)             put a connection in a pool

connpool.new([opt]) -> pools

	* max_connections     : max connections for all pools (100)
	* max_waiting_threads : max threads to queue up (1000)

pools:setlimits(key, opt)

	Set limits for a specific pool identified by `key`.
	* max_connections     : max connections for all pools (pools.max_connections)
	* max_waiting_threads : max threads to queue up (pools.max_waiting_threads)

pools:get(key, [expires]) -> c

	Get a connection from the pool identified by `key`. Returns nil if the
	pool is empty, in which case the caller has to create a connection itself,
	use it, and put it in the pool after it's done with it.

	The optional `expires` arg specifies how much to wait for a connection
	when the pool is full. If not given, there's no waiting.

pools:put(key, c, s)

	Put a connection in a pool to be reused.
	* `s` is a connected TCP client socket.
	* `c` is the hi-level protocol state object that encapsulates the
	  low-level socket connection.

IMPLEMENTATION

The pool mechanics is simple (it's just a free list) until the connection
limit is reached and then it gets more complicated because we need to put
the threads on a waiting list and resume them in fifo order and we also
need to remove them from wherever they are on the waiting list on timeout.
This is made easy because we have: 1) a ring buffer that allows removal at
arbitrary positions and 2) sock's interruptible timers.

]=]

local glue = require'glue'
local sock = require'sock'
local queue = require'queue'

local add = table.insert
local pop = table.remove

local M = {}

function M.new(opt)

	local all_limit = opt and opt.max_connections or 100
	local all_waitlist_limit = opt and opt.max_waiting_threads or 1000
	assert(all_limit >= 1)
	assert(all_waitlist_limit >= 0)

	local pools = {}
	local servers = {}

	local logging = opt and opt.logging
	local log_ = opt.log or logging and logging.log
	local log = log and function(severity, ev, ...)
		log_(severity, 'cnpool', ev, ...)
	end or glue.noop

	local function pool(key)
		local pool = servers[key]
		if pool then
			return pool
		end
		pool = {}
		servers[key] = pool

		local n = 0
		local free = {}
		local limit = all_limit
		local waitlist_limit = all_waitlist_limit

		local log = logging and function(severity, ev, s)
			log(severity, ev, '%s n=%d free=%d %s', key, n, #free, s or '')
		end or glue.noop
		local dbg  = logging and function(ev, s) log(''    , ev, s) end or glue.noop
		local note = logging and function(ev, s) log('note', ev, s) end or glue.noop

		function pool:setlimits(opt)
			limit = opt.max_connections or limit
			waitlist_limit = opt.max_waiting_threads or waitlist_limit
			assert(limit >= 1)
			assert(waitlist_limit >= 0)
		end

		local q
		local function wait(expires)
			if waitlist_limit < 1 or not expires or expires <= sock.clock() then
				dbg'notime'
				return nil, 'timeout'
			end
			q = q or queue.new(waitlist_limit, 'queue_index')
			if q:full() then
				dbg'q-full'
				return nil, 'timeout'
			end
			local sleeper = sock.sleep_job()
			q:push(sleeper)
			if sleeper:sleep_until(expires) then
				return true
			else
				return nil, 'timeout'
			end
		end

		local function check_waitlist()
			local sleeper = q and q:pop()
			if not sleeper then return end
			sleeper:wakeup(true)
		end

		function pool:get(expires)
			dbg'get'
			local c = pop(free)
			if c then
				return c
			end
			if n >= limit then
				local ok, err = wait(expires)
				if not ok then return nil, err end
				local c = pop(free)
				if c then
					return c
				end
				if n >= limit then
					dbg'full'
					return nil, 'busy'
				end
			end
			return nil, 'empty'
		end

		function pool:put(c, s)
			assert(n < limit)
			pool[c] = true
			n = n + 1
			dbg'put'
			glue.before(s, 'close', function()
				pool[c] = nil
				n = n - 1
				dbg'close'
				check_waitlist()
			end)
			function c:release()
				add(free, c)
				dbg'release'
				check_waitlist()
			end
			return c
		end

		return pool
	end

	function pools:setlimits(key, opt)
		assert(limit >= 1)
		pool(key):setlimits(opt)
	end

	function pools:get(key, expires)
		return pool(key):get(expires)
	end

	function pools:put(key, c, s)
		return pool(key):put(c, s)
	end

	return pools
end

return M
