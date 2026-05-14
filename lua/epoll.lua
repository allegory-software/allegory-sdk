--[[

	Epoll-based coroutine scheduler.
	Written by Cosmin Apreutesei. Public Domain.

EPOLLABLE OBJECT INTEGRATION
	_epoll_add(eo)
	_epoll_remove(eo, fd)
	_epoll_cancel(eo, [cancel_thread])
	eo:_try_cancel_io(thread) -> true|nil,err
	_make_async('r|w', returns_n, fn) -> fn(self, ...)
	_make_async_connect(fn) -> fn(self, ...)
	_epoll_setexpires(eo, expires, ['r|w'])
	_epoll_settimeout(eo, timeout, ['r|w'])
	eo:_epoll_error() -> err                (cannot raise)
THREADS
	thread(fn[, fmt, ...]) -> th           create a thread for async I/O
	[try_]resume(th, ...)                  run thread until it blocks/finishes
	[try_]resume_with(th, ok, ...)         resume thread with value/error
	[try_]suspend() -> ...                 suspend current thread
	[try_]transfer(th, ...) -> ...         transfer to suspended thread
	[try_]transfer_with(th, ok,...) -> ... transfer with value/error
	iterator(fn) -> th                     create an iterator with a yield function
	- fn(yield, n1,...) -> y1,...
	- yield(y1,...) -> n1,...
	- th.next(n1,...) -> y1,...
	currentthread() -> th                  current thread
	mainthread() -> th                     main thread
	th.ismain                              is main thread
	th:status() -> s                       coroutine.status(th.co)
	return finish_in(th, ...)              finish and transfer to th
	return finish_in_with(th, ok, ...)     finish with value/error into th
	return finish_with(ok, ...)            finish with value/error into caller
	th.env -> t                            get thread's inherited or own environment
	th:ownenv() -> t                       get/create thread's own environment
	th:onfinish(fn)                        run fn(thread) when thread finishes
	th:cancel()                            cancel what the thread is waiting on
	error(CANCEL)                          cancel current thread
THREAD SETS
	threadset() -> ts
	- ts:thread(fn, [fmt, ...]) -> th
	- ts:join() -> all_ok, first_err
SCHEDULER
	[try_]start([ignore_interrupts])       keep polling until all threads finish
	stop()                                 stop polling
	[try_]run(fn, ...) -> ...              run a function inside a thread
WAIT JOBS
	wait_job() -> wj            make an interruptible async wait job
	- wj:wait_until(t) -> ...   wait until clock()
	- wj:wait(s) -> ...         wait for s seconds
	- wj:[try_]resume(...)      resume the waiting thread with values
	- wj:[try_]resume_with(ok,...) resume with value/error
	- wj:cancel()               resume with CANCEL error
	wait_until(t) -> ...        wait until clock() value
	wait(s) -> ...              wait for s seconds
TIMERS
	timer(fn, [name]) -> tm     create a timer that runs fn
	- tm:setexpires(t)          run timer fn at clock t
	- tm:settimeout(s)          run timer fn after s seconds
	- tm:setinterval(s)         run timer fn every s seconds
	- tm:cancel()               remove timer from queue (can be added back)
	- tm:run()                  run timer fn now
	- error(CANCEL) in fn       cancel timer
	- return CANCEL in fn       cancel timer
	runat(t, fn) -> tm          run fn at clock t
	runafter(s, fn) -> tm       run fn after s seconds
	runevery(s, fn) -> tm       run fn every s seconds
	runagainevery(s, fn) -> tm  run fn now and every s seconds afterwards
MULTI-THREADING
	epoll_fd([epfd]) -> epfd    get/set epoll fd

EPOLLABLE OBJECTS ------------------------------------------------------------

Epollable Objects (EO) are Lua objects with a `fd` field that represents an
epollable open fd. To make those async, call epoll_add() on constructor and
epoll_remove() on destructor. Create async I/O methods with _make_async() which
wraps a syscall that returns EWOULDBLOCK (or EINPROGRESS) and returns an async
method. epoll_setexpires, etc. can be used directly as methods.

Thread cancellation of an epollable waiter calls eo:try_cancel_io(thread),
which must close eo and call _epoll_cancel(eo, thread). The canceled thread gets
CANCEL; other waiters on the same eo get `nil, 'closed'`.

SCHEDULING -------------------------------------------------------------------

Scheduling is based on symmetric coroutines provided by coro.lua which allows
doing I/O inside coroutine-based iterators. The coroutines are wrapped in
tables and we call those threads, mainly because threads have their own
semantics different than plain coroutines, and also because coroutines don't
have a fenv or metatable slot and threads need to hold state.

thread(func[, fmt, ...]) -> th

	Create and wrap coroutine for performing async I/O. The thread must be
	resumed to start. When the thread finishes, control is transferred to the
	current resume caller, the I/O thread, or the main thread.

	Full-duplex I/O on a socket or pipe can be achieved by performing reads
	in one thread and writes in another.

resume(th, ...)

	Resume a thread, which means transfer control to it, but also temporarily
	change the I/O thread to be this thread so that the first suspending call
	(send, recv, wait, suspend, etc.) gives control back to this thread.
	_This_ is the trick to starting multiple threads before starting polling.

	Resume returns when the resumed thread blocks or finishes. Successful
	finish values are ignored by resume(); errors passed with finish_in_with()
	or finish_with(false, err) are raised by resume(). While blocked in
	resume(), a thread can only be entered by finish_in(), not transfer() or
	resume(). Cancelling a thread blocked in resume() marks it so that resume()
	raises CANCEL when the resumed chain comes back.

transfer(th, ...) -> ...

	Transfer to a suspended thread and return the values that are transferred
	back. Unlike resume(), transfer() can only enter generally suspended
	threads, not threads blocked in resume(), I/O, or wait jobs.

finish_in(th, ...)
finish_in_with(th, ok, ...)
finish_with(ok, ...)

	Finish the current thread. With finish_in(), control is transferred to a
	suspended thread. With finish_with(), the target is the current resume/I/O
	caller, or the main thread if there is none. The _with variants use the
	usual ok,... convention: ok=false raises into the target's blocking call.

suspend() -> ...

	Suspend current thread, transferring to the polling thread (but see
	resume()).

[try_]start([ignore_interrupts])

	Start polling. Stops when no active waits/timers or stop() was called.

stop()

	Tell the loop to stop dequeuing and return.

TIMERS -----------------------------------------------------------------------

wait_until(t)

	Wait until a clock() value without blocking other threads.

wait(s) -> ...

	Wait s seconds without blocking other threads.

wait_job() -> wj

	Make an interruptible waiting job. Put the current thread to sleep using
	wj:wait() or wj:wait_until() and then from another thread call wj:resume()
	to resume the waiting thread. Any arguments passed to wj:resume() will be
	returned by wj:wait(). wj:cancel() raises CANCEL in the waiting thread.

MULTI-THREADING --------------------------------------------------------------

epoll_fd([epfd]) -> epfd

	Get/set the global epoll fd.

	Epoll fds can be shared between OS threads and having a single epfd for all
	threads is more efficient for the kernel than having one epfd per thread.

	To share the epfd with another Lua state running on a different thread,
	get the epfd with epoll_fd(), copy it over to the other state,
	then set it with epoll_fd(copied_epfd).

]]

if not ... then require'epoll_test'; return end

require'coro'
require'glue'
require'heap'
require'owner'

assert(Linux, 'platform not Linux')

coro.pcall = pcall

local coro_transfer = coro.transfer

--fw. decl.
local try_resume_until_blocked_with
local wait_io
local waiting

local function unprotect(ok, ...)
	if ok then return ... end
	error(..., 0)
end

local function log_error(ok, ...)
	if not ok and ... ~= CANCEL then
		log('ERROR', 'epoll', 'thread', '%s', ...)
	end
	return ok, ...
end

--expires heaps --------------------------------------------------------------
--xo = expirable object: epollable, wait_job, timer.

--used for EPOLLIN events but also for wait jobs and timers.
local recv_expires_heap = heap{
	cmp = function(xo1, xo2)
		return xo1.recv_expires < xo2.recv_expires
	end,
	index_key = 'recv_heap_index', --enable O(log n) removal.
}

--used for EPOLLOUT events only. we use two heaps for full-duplex send/recv.
local send_expires_heap = heap{
	cmp = function(xo1, xo2)
		return xo1.send_expires < xo2.send_expires
	end,
	index_key = 'send_heap_index', --enable O(log n) removal.
}

local function set_recv_expires(xo, expires)
	local in_heap = repl(xo.recv_heap_index, -1)
	xo.recv_expires = expires
	if not expires and in_heap then
		assert(recv_expires_heap:remove(xo))
		return 'removed'
	elseif expires and in_heap then
		recv_expires_heap:replace(xo.recv_heap_index, xo)
	elseif expires and not in_heap then
		recv_expires_heap:push(xo)
		return 'added'
	end
end
local function set_send_expires(xo, expires)
	local in_heap = repl(xo.send_heap_index, -1)
	xo.send_expires = expires
	if not expires and in_heap then
		assert(send_expires_heap:remove(xo))
		return 'removed'
	elseif expires and in_heap then
		send_expires_heap:replace(xo.send_heap_index, xo)
	elseif expires and not in_heap then
		send_expires_heap:push(xo)
		return 'added'
	end
end

--epoll ----------------------------------------------------------------------

cdef[[
typedef union epoll_data {
	void *ptr;
	int fd;
	uint32_t u32;
	uint64_t u64;
} epoll_data_t;

struct epoll_event {
	uint32_t events;
	epoll_data_t data;
} __attribute__((packed));

int epoll_create1(int flags);
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event);
int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout);
]]

local EPOLLIN    = 0x0001
local EPOLLOUT   = 0x0004
local EPOLLERR   = 0x0008
local EPOLLHUP   = 0x0010
local EPOLLRDHUP = 0x2000
local EPOLLET    = 2^31 --edge-triggered

local EPOLL_CTL_ADD = 1
local EPOLL_CTL_DEL = 2

local EPOLL_CLOEXEC = 0x80000

local _epoll_fd
function epoll_fd(shared_epoll_fd, flags)
	if shared_epoll_fd then
		--must put thread number in epoll_event and ignore events of foreign
		--threads since all events from all threads are seen by every thread.
		error'NYI'
		_epoll_fd = shared_epoll_fd
	elseif not _epoll_fd then
		flags = flags or EPOLL_CLOEXEC
		_epoll_fd = C.epoll_create1(flags)
		assert(try_errno(_epoll_fd >= 0))
	end
	return _epoll_fd
end

local epolled = {} --{epollable_object1, ...}
local free_slots = {} --{i1, ...}; indexes of free slots in epolled array.
local in_epoll_wait = false --freelist consumption barrier
local wait_count = 0

local epoll_ev = new'struct epoll_event'

--eo = epollable object: socket or file, where epoll owns the fields:
--		fd, epoll_i, send_expires, recv_expires, send_thread, recv_thread.
function _epoll_add(eo)
	assert(not eo.epoll_i)
	local free_i = not in_epoll_wait and pop(free_slots)
	local i = free_i or #epolled + 1
	epoll_ev.data.u32 = i
	epoll_ev.events = EPOLLIN + EPOLLOUT + EPOLLET
	local ok = C.epoll_ctl(epoll_fd(), EPOLL_CTL_ADD, eo.fd, epoll_ev) == 0
	if not ok then --ENOSPC is the only maybe-but-not-really recoverable error.
		if free_i then push(free_slots, free_i) end
		assert(try_errno())
	end
	eo.epoll_i = i
	epolled[i] = eo
end

function _epoll_remove(eo)
	local i = eo.epoll_i
	if not i then return end
	eo.epoll_i = nil --_epoll_remove() barrier
	epolled[i] = false
	push(free_slots, i)
	set_recv_expires(eo, nil)
	set_send_expires(eo, nil)
	epoll_ev.events = EPOLLIN + EPOLLOUT + EPOLLET
	assert(try_errno(C.epoll_ctl(epoll_fd(), EPOLL_CTL_DEL, eo.fd, epoll_ev) == 0))
end

function _epoll_setexpires(eo, expires, rw)
	local r = rw == 'r' or not rw
	local w = rw == 'w' or not rw
	if r then set_recv_expires(eo, expires) end
	if w then set_send_expires(eo, expires) end
end
function _epoll_settimeout(eo, s, rw)
	eo:setexpires(s and clock() + s, rw)
end

local function clear_recv_thread(eo)
	local thread = eo.recv_thread
	if not thread then return end
	assert(thread.waiting == eo)
	eo.recv_thread = nil
	return thread
end
local function clear_send_thread(eo)
	local thread = eo.send_thread
	if not thread then return end
	assert(thread.waiting == eo)
	eo.send_thread = nil
	return thread
end

--closing an epollable doesn't trigger an epoll event, instead the fd is
--silently removed from the epoll list, thus we have to wake up any waiting
--threads manually when the epollable is closed from another thread.
local function epoll_cancel_resume(thread, cancel_thread)
	if thread == cancel_thread then
		log_error(try_resume_until_blocked_with(thread, false, CANCEL))
	else
		log_error(try_resume_until_blocked_with(thread, true, nil, 'closed'))
	end
end
function _epoll_cancel(eo, cancel_thread)
	local thread = clear_recv_thread(eo)
	if thread then
		epoll_cancel_resume(thread, cancel_thread) --to wait_io_cont()
	end
	local thread = clear_send_thread(eo)
	if thread then
		epoll_cancel_resume(thread, cancel_thread) --to wait_io_cont()
	end
end

local function check_heap(heap, EXPIRES, THREAD, t)
	while true do
		local xo = heap:peek() --xo = expirable object: epollable, wait_job, timer.
		if not xo then break end --heap is empty
		if xo[EXPIRES] - t > 0.01 then break end --not expired, and neither is the rest.
		--^^ the threshold of 0.01 assumes that the current loop will take more
		--than 20ms to complete, so might as well expire some jobs now
		--because the next loop might just be a bit too late for them.
		local thread = xo[THREAD] --thread (epollable, wait_job) or timer function.
		if isthread(thread) then --epollable, wait_job
			xo[EXPIRES] = nil
			assert(thread.waiting == xo)
			xo[THREAD] = nil
			assert(heap:pop())
			log_error(coro_transfer(thread.co, true, nil, 'timeout')) --into wait_io_cont()
		elseif thread == nil then --epollable: timeout fired with no I/O in progress
			xo[EXPIRES] = nil
			assert(heap:pop())
		else --timer: run it, which removes it from the heap or moves it (if repeating).
			xo:run()
		end
	end
end

local maxevents = 64 --arbitrary default to minimize syscalls.
local events = new('struct epoll_event[?]', maxevents)
local RECV_MASK = EPOLLIN  + EPOLLERR + EPOLLHUP + EPOLLRDHUP
local SEND_MASK = EPOLLOUT + EPOLLERR + EPOLLHUP + EPOLLRDHUP

local function epoll_wait()
	local ss = send_expires_heap:peek()
	local rs = recv_expires_heap:peek()
	local sx = ss and ss.send_expires
	local rx = rs and rs.recv_expires
	local expires = min(sx or 1/0, rx or 1/0)
	local timeout = expires < 1/0 and max(0, expires - clock()) or 1/0

	local timeout_ms = max(timeout * 1000, 0)
	if timeout_ms > 0x7fffffff then timeout_ms = -1 end --infinite

	local n = C.epoll_wait(epoll_fd(), events, maxevents, timeout_ms)
	if n == -1 then return try_errno() end
	--handle ready ops.
	in_epoll_wait = true --don't allow slot reuse while iterating epolled!
	for i = 0, n-1 do
		local ev = events[i].events
		local si = events[i].data.u32
		local eo = epolled[si]
		if eo then --because it could've been removed inside earlier wake_*()
			--When EPOLL{HUP|RDHUP|ERR} arrives, we need to wake up all waiting
			--threads because EPOLL{IN|OUT} might never follow, which is why
			--we check {RECV|SEND}_MASK instead of EPOLL{IN|OUT} alone.
			local ok, err = true
			if band(ev, EPOLLERR) ~= 0 then
				ok, err = nil, eo._epoll_error and eo._epoll_error(eo) or 'error'
			end
			if band(ev, RECV_MASK) ~= 0 then
				local thread = clear_recv_thread(eo)
				if thread then --was waiting on recv
					log_error(coro_transfer(thread.co, true, ok, err)) --to wait_io_cont()
				end
			end
			if band(ev, SEND_MASK) ~= 0 then
				local thread = clear_send_thread(eo)
				if thread then --was waiting on send
					log_error(coro_transfer(thread.co, true, ok, err)) --to wait_io_cont()
				end
			end
		end
	end
	in_epoll_wait = false
	--handle timed-out ops.
	local t = clock()
	check_heap(send_expires_heap, 'send_expires', 'send_thread', t)
	check_heap(recv_expires_heap, 'recv_expires', 'recv_thread', t)
	return true
end

local EINTR = 4
local EWOULDBLOCK = 11
local EINPROGRESS = 115

function _make_async_connect(func)
	return function(eo, ...)
		::again::
		local ret = func(eo, ...)
		if ret >= 0 then return true end
		local errno = errno()
		if errno == EINPROGRESS then
			eo.send_thread = currentthread()
			local ok, err = wait_io(eo)
			if ok then
				err = eo:_epoll_error() --cannot raise
				if err then ok = false end
			end
			return ok, err
		elseif errno == EINTR then
			goto again
		else
			return try_errno(false, errno)
		end
	end
end

function _make_async(RW, returns_n, func)
	local THREAD = RW == 'w' and 'send_thread' or 'recv_thread'
	return function(eo, ...)
		if eo[THREAD] then
			return nil, 'already waiting'
		end
		::again::
		local ret = func(eo, ...)
		if ret >= 0 then
			if returns_n then
				eo[RW] = eo[RW] + ret
			end
			return ret
		end
		local errno = errno()
		if errno == EWOULDBLOCK or errno == EINPROGRESS then
			eo[THREAD] = currentthread()
			local ok, err = wait_io(eo)
			if not ok then
				return nil, err
			else
				goto again
			end
		elseif errno == EINTR then
			goto again
		else
			return try_errno(nil, errno)
		end
	end
end

function _epoll_try_wait(eo, rw)
	local THREAD = rw == 'w' and 'send_thread' or 'recv_thread'
	if eo[THREAD] then
		return nil, 'already waiting'
	end
	eo[THREAD] = currentthread()
	return wait_io(eo)
end

--wait jobs ------------------------------------------------------------------

local wj = {
	type = 'wait_job',
	debug_prefix = 'W',
}
function wait_job()
	local self = object(wj)
	--log('', 'sock', 'wait-job', '%s', self)
	return self
end
function wj:wait_until(expires)
	self.recv_thread = currentthread()
	set_recv_expires(self, expires)
	return wait_io(self)
end
function wj:wait(timeout)
	return self:wait_until(clock() + timeout)
end
function wj:try_resume_with(...)
	local thread = self.recv_thread
	if not (thread and thread.waiting == self) then
		return nil, 'thread not waiting (on this job)'
	end
	set_recv_expires(self, nil)
	self.recv_thread = nil
	return try_resume_until_blocked_with(thread, ...) --to wait_io_cont()
end
function wj:try_resume(...)
	return self:try_resume_with(true, ...)
end
function wj:resume_with(...)
	return unprotect(self:try_resume_with(...))
end
function wj:resume(...)
	return unprotect(self:try_resume_with(true, ...))
end
function wj:cancel()
	local thread = self.recv_thread
	if not (thread and thread.waiting == self) then return end
	self:resume_with(false, CANCEL)
	return true
end
function wait_until(expires)
	return wait_job():wait_until(expires)
end
function wait(timeout)
	return wait_job():wait(timeout)
end

--lightweight timers that run in the main thread -----------------------------

local tm = {type = 'timer', debug_prefix = 'R'}
function timer(f, name)
	if name == 'debug' then
		local i = debug.getinfo(f, 'nS')
		name = _('%s (%s:%s)', i.name or '?', i.short_src, i.linedefined)
	end
	return object(tm, {
		recv_thread = assert(f),
		name = name,
		recv_heap_index = -1,
	})
end
function tm:cancel()
	if set_recv_expires(self, nil) == 'removed' then
		wait_count = wait_count - 1
	end
	return self
end
function tm:setexpires(expires)
	if set_recv_expires(self, expires) == 'added' then
		wait_count = wait_count + 1
	end
	return self
end
function tm:settimeout(timeout)
	self:setexpires(clock() + timeout)
	return self
end
function tm:setinterval(interval)
	--avoid infinite loop in check_heap().
	assertf(interval >= 0.02, 'timer interval too short: %.2f', interval)
	self.interval = interval
	self:settimeout(interval)
	return self
end
function tm:run()
	--return CANCEL or error(CANCEL) from fn has the same effect.
	local ok, err = pcall(self.recv_thread)
	if not ok and err ~= CANCEL then
		--nowhere to raise timer errors into, so we just log them.
		log('ERROR', 'epoll', 'timer', '%s%s', err, catall('\n', self.name) or '')
	end
	if self.interval and err ~= CANCEL then
		self:settimeout(self.interval)
	else
		self:cancel()
	end
end
function runat(expires, f, name)
	return timer(f, name):setexpires(expires)
end
function runafter(timeout, f, name)
	return timer(f, name):settimeout(timeout)
end
function runevery(interval, f, name)
	return timer(f, name):setinterval(interval)
end
function runagainevery(interval, f, name)
	local tm = timer(f, name):setinterval(interval)
	tm:run()
	return tm
end

--threads and poll loop ------------------------------------------------------

local Thread = {
	type = 'thread',
	debug_prefix = 'T',
}

function isthread(s)
	local mt = getmetatable(s)
	return istab(mt) and rawget(s, 'isthread')
end

local threads = {} --{co->thread}
local poll_thread

local coro_running = coro.running
function currentthread()
	return assert(threads[coro_running()], 'not inside a thread')
end

local function wrap_thread(co, fmt, ...)
	local owner = _check_owner()
	local thread = _init_owner(owner, object(Thread, {
		co = co,
		env = currentthread().env, --start with parent env
		isthread = true, --rawsetting so that isthread() can rawget()
		waiting = true, --true | wait_job | socket
		finished = false,
		name = fmt and _(fmt, ...),
	}))
	threads[co] = thread
	return thread
end

local _mainthread = object(Thread, {
	co = coro.main,
	env = {},
	isthread = true,
	waiting = false,
	ismain = true,
})
threads[_mainthread.co] = _mainthread
function mainthread()
	return _mainthread
end

local function free_thread(self)
	assert(not self.waiting)
	threads[self.co] = nil --free it
	self.co = nil --make it unusable
end

local FIN = {'FIN'} --"finish-in-with" marker
function finish_in_with(in_thread, with_ok, ...)
	assert(isthread(in_thread), 'thread finish into non-thread')
	assert(in_thread.waiting == true
		or (in_thread.waiting == 'resume' and in_thread == poll_thread),
		'thread finish into a non-suspended thread')
	if in_thread.waiting == 'resume' then
		assert(with_ok == false or select('#', ...) == 0,
         'cannot transfer values into a thread waiting on resume()')
	end
	return FIN, in_thread, with_ok, ...
end
function finish_with(with_ok, ...)
	return FIN, nil, with_ok, ...
end
function finish_in(in_thread, ...)
	return finish_in_with(in_thread, true, ...)
end
local function thread_finish(self, fin, in_thread, ok, ...)
	if ... == FIN then --allow overriding (in_thread, ok)
		return thread_finish(self, ...)
	end
	if not fin and not ok then
		--nowhere to transfer thread errors into, so log the error and move on.
		log_error(ok, ...)
	end
	if self._on_finish then
		log_error(pcall(self._on_finish, self))
	end
	free_thread(self)
	in_thread = in_thread or poll_thread or mainthread()
	if fin then --allow raising into suspend/transfer/resume caller
		return in_thread.co, ok, ...
	elseif ok then --pass return values
		return in_thread.co, true, ...
	else --return success, don't pass on the error (already logged)
		return in_thread.co, true
	end
end
local coro_create = coro.create
function thread(fn, ...)
	local th
	th = wrap_thread(coro_create(function(ok, ...)
		th.waiting = false --block all transfers into
		if not ok then --transferred into with an error
			return thread_finish(th, nil, nil, false, ...)
		else
			return thread_finish(th, nil, nil, pcall(fn, ...))
		end
	end), ...)
	return th
end

function Thread:onfinish(fn)
	after(self, '_on_finish', fn)
end

local function iterator_finish(self, ok, ...)
	local fin_ok, fin_err = true
	if self._on_finish then
		fin_ok, fin_err = pcall(self._on_finish, self)
	end
	free_thread(self)
	if not ok then error(..., 0) end --re-raised in the caller thread.
	if not fin_ok then error(fin_err, 0) end --re-raised in the caller thread.
	return ...
end
local coro_wrap = coro.wrap
function iterator(fn, ...)
	local wrapped, co, th
	wrapped, co = coro_wrap(function(...)
		th.waiting = false --block all transfers into
		return iterator_finish(th, pcall(fn, ...))
	end)
	th = wrap_thread(co, ...)
	th.next = wrapped
	return th
end

--NOTE: for clarity, threads should only set their own `waiting` barrier!

local function reset_waiting(...)
	local self = currentthread()
	self.waiting = false --block all transfers into
	if self.cancelled then
		self.cancelled = nil
		return false, CANCEL
	end
	return ...
end
function try_transfer_with(thread, ...)
	assert(isthread(thread), 'resume: thread expected')
	assert(thread.waiting == true, 'transfer: thread not suspended')
	currentthread().waiting = true --allow transfer/resume/finish into
	return reset_waiting(coro_transfer(thread.co, ...))
end
function try_transfer(thread, ...)
	return try_transfer_with(thread, true, ...)
end
function transfer_with(thread, ...)
	return unprotect(try_transfer_with(thread, ...))
end
function transfer(thread, ...)
	return unprotect(try_transfer_with(thread, true, ...))
end
function try_suspend()
	assert(poll_thread, 'suspend: poll loop not started')
	currentthread().waiting = true --allow transfer/resume/finish into
	return reset_waiting(coro_transfer(poll_thread.co, true))
end
function suspend()
	return unprotect(try_suspend())
end

--[[local]] function try_resume_until_blocked_with(thread, ...)
	--change poll_thread temporarily so that we get back here
	--from the first call to suspend(), wait_io() or thread finishing.
	local self = currentthread()
	local real_poll_thread = poll_thread
	poll_thread = self
	local ok, err = coro_transfer(thread.co, ...)
	poll_thread = real_poll_thread
	if not ok then return false, err end
	return true
end
local function reset_resuming(self, ...)
	self.resuming = nil
	return ...
end
function try_resume_with(thread, ...)
	assert(isthread(thread), 'resume: thread expected')
	assert(thread.waiting == true, 'resume: thread not suspended')
	local self = currentthread()
	self.waiting = 'resume' --allow finish into, block all else
	self.resuming = thread
	return reset_waiting(reset_resuming(self,
		try_resume_until_blocked_with(thread, ...)))
end
function try_resume(thread, ...)
	return try_resume_with(thread, true, ...)
end
function resume_with(thread, ...)
	return unprotect(try_resume_with(thread, ...))
end
function resume(thread, ...)
	return unprotect(try_resume_with(thread, true, ...))
end
Thread.try_resume_with = try_resume_with
Thread.try_resume = try_resume
Thread.resume_with = resume_with
Thread.resume = resume

local function wait_io_cont(currentthread, ...)
	currentthread.waiting = false --block all transfers into
	wait_count = wait_count - 1
	return unprotect(...)
end
--[[local]] function wait_io(wo) --wo = wait-object: epollable or wait_job
	local thread = currentthread()
	assert(poll_thread, 'poll loop not started')
	assert(not thread.ismain, 'trying to perform I/O from the main thread')
	thread.waiting = assert(wo) --allow wake_*(), block all else
	wait_count = wait_count + 1
	return wait_io_cont(thread, coro_transfer(poll_thread.co, true))
end

function Thread:status()
	return self.co and coro.status(self.co) or 'dead'
end

function Thread:try_cancel()
	if self.waiting == true then --suspend(), transfer()
		self:resume_with(false, CANCEL)
		return true
	elseif self.waiting == 'resume' then
		self.cancelled = true --mark-and-wait
		if self.resuming then
			self.resuming:try_cancel()
		end
		return true
	elseif istab(self.waiting) and self.waiting._try_cancel_io then --epollable
		return self.waiting:_try_cancel_io(self)
	elseif istab(self.waiting) and self.waiting.type == 'wait_job' then
		self.waiting:cancel()
		return true
	elseif self.waiting then
		assert(false) --not covered (bug)
	else
		return nil, 'thread not waiting'
	end
end
function Thread:cancel()
	return unprotect(self:try_cancel())
end

function Thread:ownenv(create)
	local t = self._ownenv
	if not t and create ~= false then
		t = {}
		local pt = self.env
		if pt then --inherit parent env, if any.
			t.__index = pt
			setmetatable(t, t)
		end
		self._ownenv = t
		self.env = t
	end
	return t
end

--threads as owners
Thread.try_close = try_cancel
Thread.setowner = setowner

function threadset()
	local ts = {}
	local n = 0
	local all_ok = true
	local first_err
	local join_thread
	function ts:thread(f, ...)
		return thread(function(...)
			n = n + 1
			local ok, err = log_error(pcall(f, ...))
			if not ok then
				if all_ok then
					all_ok = false
					first_err = err
				end
			end
			n = n - 1
			if n == 0 and join_thread then
				return finish_in(join_thread)
			end
		end, ...)
	end
	function ts:join()
		if n ~= 0 then
			assert(not join_thread, 'threadset already joining')
			join_thread = currentthread()
			local ok, err = try_suspend()
			join_thread = nil
			if not ok then error(err, 0) end
		end
		return all_ok, first_err
	end
	return ts
end

--poll loop -----------------------------------------------------------------

local term_sig_f

local function poll(ignore_interrupts)
	if wait_count == 0 then
		return nil, 'empty'
	elseif wait_count == 1 and term_sig_f then --nobody left to kill this guy
		return nil, 'empty'
	end
	local ok, err = epoll_wait()
	if ok then return true end
	if err == 'interrupted' then
		if ignore_interrupts == nil then
			ignore_interrupts = config('ignore_interrupts', true)
		end
		log('note', 'epoll', 'poll', 'interrupted: %s.',
			ignore_interrupts and 'ignoring' or 'breaking')
		if ignore_interrupts then
			return true, err
		end
	end
	return false, err
end

local _stop = false
local _running = false

function stop()
	_stop = true
	if term_sig_f then
		term_sig_f:close()
		term_sig_f = nil
	end
end
interrupt = stop --overridable

function try_start(ignore_interrupts)
	if _running then return true end
	if wait_count == 0 then return true end

	require'signal'

	--signal thread to stop loop on SIGINT (Ctrl+C) and SIGTERM (kill) events.
	assert(not term_sig_f)
	term_sig_f = on_signal('SIGINT SIGTERM', function()
		interrupt()
		return 'stop'
	end)

	poll_thread = currentthread()
	_running = true
	local ret, err = true
	repeat
		ret, err = poll(ignore_interrupts)
		if not ret then
			stop()
			if err == 'interrupted' or err == 'empty' then
				ret = true
			end
			break
		end
	until _stop
	_running = false
	_stop = false
	return ret, err
end
function start(...)
	assert(try_start(...))
end

--NOTE: `return finish_with()` from f is not supported right now.
function try_run(f, ...)
	if _running then
		return pcall(f, ...)
	else
		local ret
		local function wrapper(...)
			ret = pack(pcall(f, ...))
		end
		resume(thread(wrapper, 'sock-run'), ...)
		start()
		assert(ret, 'run function did not run')
		return unpack(ret)
	end
end
function run(f, ...)
	return unprotect(try_run(f, ...))
end
