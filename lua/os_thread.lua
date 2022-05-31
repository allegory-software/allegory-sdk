--[=[

	Hi-level thread primitives based on pthread and luastate.
	Written by Cosmin Apreutesei. Public Domain.

THREADS
	os_thread(func, args...) -> th         create and start an os thread
	th:join() -> retvals...                wait on a thread to finish

QUEUES
	synchronized_queue([maxlength]) -> q   create a synchronized queue
	q:length() -> n                        queue length
	q:maxlength() -> n                     queue max. length
	q:push(val[, expires]) -> true, len    add value to the top (*)
	q:shift([expires]) -> true, val, len   remove bottom value (*)
	q:pop([expires]) -> true, val, len     remove top value (*)
	q:peek([index]) -> true, val | false   peek into the list without removing (**)
	q:free()                               free queue and its resources

EVENTS
	os_thread_event([initially_set]) -> e  create an event
	e:set()                                set the flag
	e:clear()                              reset the flag
	e:isset() -> true | false              check if the flag is set
	e:wait([expires]) -> true | false      wait until the flag is set
	e:free()                               free event

SHARED OBJECTS
	shared_object(name, class)
	shared_pointer(in_ctype, out_ctype)

THREAD POOLS
	os_thread_pool(n) -> pool
	pool:join()
	pool:push(task, expires)

(*) the `expires` arg is a timestamp, not a time period; when a timeout is
passed, the function returns `false, 'timeout'` if the specified timeout
expires before the underlying mutex is locked.

(**) default index is 1 (bottom element); negative indices count from top,
-1 being the top element; returns false if the index is out of range.

THREADS ----------------------------------------------------------------------

osthread(func, args...) -> th

	Create a new thread and Lua state, push `func` and `args` to the Lua state
	and execute `func(args...)` in the context of the thread. The return values
	of func can be retreived by calling `th:join()` (see below).

	* the function's upvalues are not copied to the Lua state along with it.
	* args can be of two kinds: copiable types and shareable types.
	* copiable types are: nils, booleans, strings, functions without upvalues,
	tables without cyclic references or multiple references to the same
	table inside.
	* shareable types are: pthread threads, mutexes, cond vars and rwlocks,
	top level Lua states, threads, queues and events.

	Copiable objects are copied over to the Lua state, while shareable
	objects are only shared with the thread. All args are kept from being
	garbage-collected up until the thread is joined.

	The returned thread object must not be discarded and `th:join()`
	must be called on it to release the thread resources.

th:join() -> retvals...

	Wait on a thread to finish and return the return values of its worker
	function. Same rules apply for copying return values as for args.
	Errors are propagated to the calling thread.

QUEUES -----------------------------------------------------------------------

synchronized_queue([maxlength]) -> q

	Create a queue that can be safely shared and used between threads.
	Elements can be popped from both ends, so it can act as both a LIFO
	or a FIFO queue, as needed. When the queue is empty, attempts to
	pop from it blocks until new elements are pushed again. When a
	bounded queue (i.e. with maxlength) is full, attempts to push
	to it blocks until elements are consumed. The order in which
	multiple blocked threads wake up is arbitrary.

	The queue can be locked and operated upon manually too. Use `q.mutex` to
	lock/unlock it, `q.state` to access the elements (they occupy the Lua stack
	starting at index 1), and `q.cond_not_empty`, `q.cond_not_full` to
	wait/broadcast on the not-empty and not-full events.

	Vales are transferred between states according to the rules of [luastate](luastate.md).

EVENTS -----------------------------------------------------------------------

thread.event([initially_set]) -> e

	Events are a simple way to make multiple threads block on a flag.
	Setting the flag unblocks any threads that are blocking on `e:wait()`.

NOTES ------------------------------------------------------------------------

Creating hi-level threads is slow because Lua modules must be loaded
every time for each thread. For best results, use a thread pool.

On Windows, the current directory is per thread! Same goes for env vars.

]=]

if not ... then require'os_thread_test'; return end

require'glue'
require'pthread'
require'luastate'

--shareable objects ----------------------------------------------------------

--objects that implement the shareable interface can be shared
--between Lua states when passing args in and out of Lua states.

local typemap = {} --{ctype_name = {identify=f, decode=f, encode=f}}

--shareable pointers
local function pointer_class(in_ctype, out_ctype)
	local class = {}
	function class.identify(p)
		return istype(in_ctype, p)
	end
	function class.encode(p)
		return {addr = ptr_encode(p)}
	end
	function class.decode(t)
		return ptr_decode(out_ctype or in_ctype, t.addr)
	end
	return class
end

function shared_object(name, class)
	if typemap[name] then return end --ignore duplicate registrations
	typemap[name] = class
end

function shared_pointer(in_ctype, out_ctype)
	shared_object(in_ctype, pointer_class(in_ctype, out_ctype))
end

shared_pointer'lua_State*'
shared_pointer('pthread_t'        , 'pthread_t*')
shared_pointer('pthread_mutex_t'  , 'pthread_mutex_t*')
shared_pointer('pthread_rwlock_t' , 'pthread_rwlock_t*')
shared_pointer('pthread_cond_t'   , 'pthread_cond_t*')

--identify a shareable object and encode it.
local function encode_shareable(x)
	for typename, class in pairs(typemap) do
		if class.identify(x) then
			local t = class.encode(x)
			t.type = typename
			return t
		end
	end
end

--decode an encoded shareable object
local function decode_shareable(t)
	return typemap[t.type].decode(t)
end

--encode all shareable objects in a packed list of args
function _os_thread_encode_args(t)
	t.shared = {} --{i1,...}
	for i=1,t.n do
		local e = encode_shareable(t[i])
		if e then
			t[i] = e
			--put the indices of encoded objects aside for identification
			--and easy traversal when decoding
			add(t.shared, i)
		end
	end
	return t
end

--decode all encoded shareable objects in a packed list of args
function _os_thread_decode_args(t)
	for _,i in ipairs(t.shared) do
		t[i] = decode_shareable(t[i])
	end
	return t
end

--events ---------------------------------------------------------------------

cdef[[
typedef struct {
	int flag;
	pthread_mutex_t mutex;
	pthread_cond_t cond;
} thread_event_t;
]]

function os_thread_event(set)
	local e = new'thread_event_t'
	mutex(nil, e.mutex)
	condvar(nil, e.cond)
	e.flag = set and 1 or 0
	return e
end

local event = {}

local function set(self, val)
	self.mutex:lock()
	self.flag = val
	self.cond:broadcast()
	self.mutex:unlock()
end

function event:set()
	set(self, 1)
end

function event:clear()
	set(self, 0)
end

function event:isset()
	self.mutex:lock()
	local ret = self.flag == 1
	self.mutex:unlock()
	return ret
end

function event:wait(expires)
	self.mutex:lock()
	local cont = true
	while cont do
		if self.flag == 1 then
			self.mutex:unlock()
			return true
		end
		cont = self.cond:wait(self.mutex, expires)
	end
	self.mutex:unlock()
	return false
end

metatype('thread_event_t', {__index = event})

shared_pointer('thread_event_t', 'thread_event_t*')

--queues ---------------------------------------------------------------------

local queue = {}
queue.__index = queue

function synchronized_queue(maxlen)
	assert(not maxlen or (floor(maxlen) == maxlen and maxlen >= 1),
		'invalid queue max. length')
	local state = luastate() --values will be kept on the state's stack
	return setmetatable({
		state          = state,
		mutex          = mutex(),
		cond_not_empty = condvar(),
		cond_not_full  = condvar(),
		maxlen         = maxlen,
	}, queue)
end

function queue:free()
	self.cond_not_full:free();  self.cond_not_full = nil
	self.cond_not_empty:free(); self.cond_not_empty = nil
	self.state:close();         self.state = nil
	self.mutex:free();          self.mutex = nil
end

function queue:maxlength()
	return self.maxlen
end

local function queue_length(self)
	return self.state:gettop()
end

local function queue_isfull(self)
	return self.maxlen and queue_length(self) == self.maxlen
end

local function queue_isempty(self)
	return queue_length(self) == 0
end

function queue:length()
	self.mutex:lock()
	local ret = queue_length(self)
	self.mutex:unlock()
	return ret
end

function queue:isfull()
	self.mutex:lock()
	local ret = queue_isfull(self)
	self.mutex:unlock()
	return ret
end

function queue:isempty()
	self.mutex:lock()
	local ret = queue_isempty(self)
	self.mutex:unlock()
	return ret
end

function queue:push(val, timeout)
	self.mutex:lock()
	while queue_isfull(self) do
		if not self.cond_not_full:wait(self.mutex, timeout) then
			self.mutex:unlock()
			return false, 'timeout'
		end
	end
	local was_empty = queue_isempty(self)
	self.state:push(val)
	local len = queue_length(self)
	if was_empty then
		self.cond_not_empty:broadcast()
	end
	self.mutex:unlock()
	return true, len
end

local function queue_remove(self, index, timeout)
	self.mutex:lock()
	while queue_isempty(self) do
		if not self.cond_not_empty:wait(self.mutex, timeout) then
			self.mutex:unlock()
			return false, 'timeout'
		end
	end
	local was_full = queue_isfull(self)
	local val = self.state:get(index)
	self.state:remove(index)
	local len = queue_length(self)
	if was_full then
		self.cond_not_full:broadcast()
	end
	self.mutex:unlock()
	return true, val, len
end

function queue:pop(timeout)
	return queue_remove(self, -1, timeout)
end

--NOTE: this is O(N) where N = self:length().
function queue:shift(timeout)
	return queue_remove(self, 1, timeout)
end

function queue:peek(i)
	i = i or 1
	self.mutex:lock()
	local len = queue_length(self)
	if i <= 0 then
		i = len + i + 1  -- index -1 is top
	end
	if i < 1 or i > len then
		self.mutex:unlock()
		return false
	end
	local val = self.state:get(i)
	self.mutex:unlock()
	return true, val
end

--queues / shareable interface

function queue:identify()
	return getmetatable(self) == queue
end

function queue:encode()
	return {
		state_addr          = ptr_encode(self.state),
		mutex_addr          = ptr_encode(self.mutex),
		cond_not_full_addr  = ptr_encode(self.cond_not_full),
		cond_not_empty_addr = ptr_encode(self.cond_not_empty),
		maxlen              = self.maxlen,
	}
end

function queue.decode(t)
	return setmetatable({
		state          = ptr_decode('lua_State*',       t.state_addr),
		mutex          = ptr_decode('pthread_mutex_t*', t.mutex_addr),
		cond_not_full  = ptr_decode('pthread_cond_t*',  t.cond_not_full_addr),
		cond_not_empty = ptr_decode('pthread_cond_t*',  t.cond_not_empty_addr),
		maxlen         = t.maxlen,
	}, queue)
end

shared_object('queue', queue)

--threads --------------------------------------------------------------------

local thread = {type = 'os_thread', debug_prefix = '!'}
thread.__index = thread

function os_thread(func, ...)
	local state = luastate()

	state:openlibs()
	state:push{[0] = arg[0]} --used to make `rel_scriptdir`
	state:setglobal'arg'
	if package.loaded.bundle_loader then
		local bundle_luastate = require'bundle_luastate'
		bundle_luastate.init_bundle(state)
	end

	state:push(function(func, args)

	   require'glue'
		require'pthread'
		require'luastate'
		require'os_thread'
	   local cast = cast
	   local addr = addr

		local function pass(ok, ...)
			local retvals = ok and _os_thread_encode_args(pack(...)) or {err = ...}
			rawset(_G, '__ret', retvals) --is this the only way to get them out?
		end
	   local function worker()
	   	local t = _os_thread_decode_args(args)
	   	pass(pcall(func, unpack(t)))
	   end

		--worker_cb is anchored by luajit along with the function it frames.
	   local worker_cb = cast('void *(*)(void *)', worker)
	   return ptr_encode(worker_cb)
	end)
	local args = pack(...)
	local encoded_args = _os_thread_encode_args(args)
	local worker_cb_ptr = ptr_decode(state:call(func, encoded_args))
	local pthread = pthread(worker_cb_ptr)

	return setmetatable({
			pthread = pthread,
			state = state,
			args = args, --keep args to avoid shareables from being collected
		}, thread)
end

function thread:join()
	self.pthread:join()
	self.args = nil --release args
	--get the return values of worker function
	self.state:getglobal'__ret'
	local retvals = self.state:get()
	self.state:close()
	--propagate the error
	if retvals.err then
		error(retvals.err, 2)
	end
	return unpack(_os_thread_decode_args(retvals))
end

--threads / shareable interface

function thread:identify()
	return getmetatable(self) == thread
end

function thread:encode()
	return {
		pthread_addr = ptr_encode(self.pthread),
		state_addr   = ptr_encode(self.state),
	}
end

function thread.decode(t)
	return setmetatable({
		pthread = ptr_decode('pthread_t*', t.thread_addr),
		state   = ptr_decode('lua_State*', t.state_addr),
	}, thread)
end

shared_object('thread', thread)

--thread pools ---------------------------------------------------------------

local pool = {}
pool.__index = pool

local function pool_worker(q)
	while true do
		print('waiting for task', q:length())
		local _, task = q:shift()
		print'got task'
		task()
	end
end

function os_thread_pool(n)
	local t = {}
	t.queue = synchronized_queue(1)
	for i = 1, n do
		t[i] = thread(pool_worker, t.queue)
	end
	return setmetatable(t, pool)
end

function pool:join()
	for i = #self, 1, -1 do
		self[i]:join()
		self[i] = nil
	end
	self.queue:free()
	self.queue = nil
end

function pool:push(task, timeout)
	return self.queue:push(task, timeout)
end

