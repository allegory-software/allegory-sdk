--[[

	Epoll-based coroutine scheduler.
	Written by Cosmin Apreutesei. Public Domain.

EPOLLABLE OBJECT INTEGRATION
	epoll_add(eo)
	epoll_remove(eo)
	make_async('r|w', returns_n, func) -> func(self, ...)
	epoll_setexpires(eo, expires, ['r|w'])
	epoll_settimeout(eo, timeout, ['r|w'])
	epoll_cancel[_read|_write](eo)         must call after close()!
	eo:epoll_error() -> err
THREADS
	thread(func[, fmt, ...]) -> co         create a coroutine for async I/O
	resume(thread, ...)                    resume thread
	yield(...) -> ...                      safe yield (see coro.lua)
	suspend() -> ...                       suspend thread
	cowrap(f) -> wrapper                   see coro.safewrap()
	currentthread() -> co, is_main         current coroutine and whether it's the main one
	threadstatus(co) -> s                  coroutine.status()
	transfer(co, ...) -> ...               see coro.transfer()
	cofinish(co, ...) -> ...               see coro.finish()
	threadenv([co]) -> t                   get (current) thread's own environment
	ownthreadenv([co], [create]) -> t      get/create (current) thread's own environment
	onthreadfinish(co, f)                  run f(thread) when thread finishes
SCHEDULER
	poll([ignore_interrupts])              poll for I/O
	start([ignore_interrupts])             keep polling until all threads finish
	stop()                                 stop polling
	run(f, ...) -> ...                     run a function inside a thread
WAIT JOBS
	wait_job() -> wj            make an interruptible async wait job
	wj:wait_until(t) -> ...     wait until clock()
	wj:wait(s) -> ...           wait for s seconds
	wj:[try_]resume(...)        resume the waiting thread
	wj:cancel()                 calls wj:resume(CANCEL)
	wait_until(t) -> ...        wait until clock() value
	wait(s) -> ...              wait for s seconds
TIMERS
	timer(f, [name]) -> tm      create a timer that runs f
	tm:setexpires(t)            run f at clock t
	tm:settimeout(s)            run f after s seconds
	tm:setinterval(s)           run f every s seconds
	tm:cancel()                 remove timer from queue (can be added back)
	tm:run()                    run f now
	runat(t, f) -> wj           run f at clock t
	runafter(s, f) -> wj        run f after s seconds
	runevery(s, f) -> wj        run f every s seconds
	runagainevery(s, f) -> wj   run f now and every s seconds afterwards
THREAD SETS
	threadset() -> ts
	  ts:thread(f, [fmt, ...]) -> co
	  ts:join() -> all_ok, first_err
MULTI-THREADING (WITH OS THREADS)
	epoll_fd([epfd]) -> epfd    get/set epoll fd

EPOLLABLE OBJECTS ------------------------------------------------------------

Epollable Objects (EO) are Lua objects with a `fd` field that represents an
epollable open fd. To make async, call epoll_add() on constructor and
epoll_remove() on destructor. Create async I/O methods with make_async() which
wraps a syscall that returns EWOULDBLOCK (or EINPROGRESS) and returns an async
method. epoll_setexpires, etc. can be used directly as methods.

SCHEDULING -------------------------------------------------------------------

	Scheduling is based on synchronous coroutines provided by coro.lua which
	allows coroutine-based iterators that perform socket I/O to be written.

thread(func[, fmt, ...]) -> co

	Create a coroutine for performing async I/O. The coroutine must be resumed
	to start. When the coroutine finishes, the control is transfered to
	the I/O thread (the thread that called start()).

	Full-duplex I/O on a socket can be achieved by performing reads in one thread
	and writes in another.

resume(thread, ...)

	Resume a thread, which means transfer control to it, but also temporarily
	change the I/O thread to be this thread so that the first suspending call
	(send, recv, wait, suspend, etc.) gives control back to this thread.
	_This_ is the trick to starting multiple threads before starting polling.

suspend() -> ...

	Suspend current thread, transfering to the polling thread (but see resume()).

poll([ignore_interrupts]) -> true | false,'empty'

	Poll for the next I/O event and resume the coroutine that waits for it.

start([ignore_interrupts])

	Start polling. Stops when no more I/O or stop() was called.

stop()

	Tell the loop to stop dequeuing and return.

TIMERS -----------------------------------------------------------------------

wait_until(t)

	Wait until a clock() value without blocking other threads.

wait(s) -> ...

	Wait s seconds without blocking other threads.

wait_job() -> wj

	Make an interruptible waiting job. Put the current thread to sleep using
	wj:wait() or wj:wait_until() and then from another thread call
	wj:resume() to resume the waiting thread. Any arguments passed to
	wj:resume() will be returned by wj:wait().

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

assert(Linux, 'platform not Linux')

coro.live  = live
coro.pcall = pcall

local coro_create   = coro.create
local coro_safewrap = coro.safewrap
local coro_transfer = coro.transfer
local coro_finish   = coro.finish

--fw. decl.
local _resume
local wait_io
local waiting

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
		_epoll_fd = shared_epoll_fd
	elseif not _epoll_fd then
		flags = flags or EPOLL_CLOEXEC
		_epoll_fd = C.epoll_create1(flags)
		assert(check_errno(_epoll_fd >= 0))
	end
	return _epoll_fd
end

local epolled = {} --{epollable_object1, ...}
local free_slots = {} --{i1, ...}; indexes of free slots in epolled array.

local epoll_ev = new'struct epoll_event'

--o is an epollable object (socket, file, etc.), with fields:
--		fd, _i, send_expires, recv_expires, send_thread, recv_thread.
function epoll_add(eo)
	local i = pop(free_slots) or #epolled + 1
	epoll_ev.data.u32 = i
	epoll_ev.events = EPOLLIN + EPOLLOUT + EPOLLET
	local ok, err = check_errno(C.epoll_ctl(epoll_fd(), EPOLL_CTL_ADD, eo.fd, epoll_ev) == 0)
	if not ok then
		push(free_slots, i)
		return nil, err
	end
	eo._i = i
	epolled[i] = eo
	return true
end

function epoll_remove(eo)
	local i = eo._i
	if not i then return end --epoll_add() was not called on this object.
	epoll_ev.data.u32 = i
	epoll_ev.events = EPOLLIN + EPOLLOUT + EPOLLET
	assert(check_errno(C.epoll_ctl(epoll_fd(), EPOLL_CTL_DEL, eo.fd, epoll_ev) == 0))
	epolled[i] = false
	push(free_slots, i)
end

function epoll_setexpires(self, expires, rw)
	local r = rw == 'r' or not rw
	local w = rw == 'w' or not rw
	if r then self.recv_expires = expires end
	if w then self.send_expires = expires end
end
function epoll_settimeout(self, s, rw)
	self:setexpires(s and clock() + s, rw)
end

--used for EPOLLIN events but also for wait jobs and timers.
local recv_expires_heap = heap{
	cmp = function(s1, s2)
		return s1.recv_expires < s2.recv_expires
	end,
	index_key = 'recv_heap_index', --enable O(log n) removal.
}

--used for EPOLLOUT events only. we use two heaps for full-duplex send/recv.
local send_expires_heap = heap{
	cmp = function(s1, s2)
		return s1.send_expires < s2.send_expires
	end,
	index_key = 'send_heap_index', --enable O(log n) removal.
}

local function wake_r(eo, err, transfer)
	local thread = eo.recv_thread
	if not thread then return end --wasn't waiting on recv
	if eo.recv_expires then
		assert(recv_expires_heap:remove(eo))
	end
	eo.recv_thread = nil
	if err then
		transfer(thread, nil, err)
	else
		transfer(thread, true)
	end
end
local function wake_w(eo, err, transfer)
	local thread = eo.send_thread
	if not thread then return end --wasn't waiting on send
	if eo.send_expires then
		assert(send_expires_heap:remove(eo))
	end
	eo.send_thread = nil
	if err then
		transfer(thread, nil, err)
	else
		transfer(thread, true)
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
		xo[EXPIRES] = nil
		local thread = xo[THREAD] --thread (epollable, wait_job) or timer function.
		if isthread(thread) then --epollable, wait_job
			xo[THREAD] = nil
			assert(heap:pop())
			coro_transfer(thread, nil, 'timeout')
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
	if n == -1 then return check_errno() end
	--handle ready ops.
	for i = 0, n-1 do
		local ev = events[i].events
		local si = events[i].data.u32
		local eo = epolled[si]
		--When EPOLL{HUP|RDHUP|ERR} arrives, we need to wake up all waiting
		--threads because EPOLL{IN|OUT} might never follow, which is why
		--we check {RECV|SEND}_MASK instead of EPOLL{IN|OUT} alone.
		local err
		if band(ev, EPOLLERR) ~= 0 then
			err = eo.epoll_error and eo.epoll_error(eo) or 'error'
		end
		if band(ev, RECV_MASK) ~= 0 then wake_r(eo, err, coro_transfer) end
		if band(ev, SEND_MASK) ~= 0 then wake_w(eo, err, coro_transfer) end
	end
	--handle timed-out ops.
	local t = clock()
	check_heap(send_expires_heap, 'send_expires', 'send_thread', t)
	check_heap(recv_expires_heap, 'recv_expires', 'recv_thread', t)
	return true
end

--closing an epollable doesn't trigger an epoll event, instead the fd is
--silently removed from the epoll list, thus we have to wake up any waiting
--threads manually when the epollable is closed from another thread.
function epoll_cancel_recv(self, reason)
	wake_r(self, reason or 'canceled', _resume)
end
function epoll_cancel_send(self, reason)
	wake_w(self, reason or 'canceled', _resume)
end
function epoll_cancel(self, reason)
	self:cancel_recv(reason)
	self:cancel_send(reason)
end

local EWOULDBLOCK = 11
local EINPROGRESS = 115

function make_async(RW, returns_n, func)
	local heap = RW == 'w' and send_expires_heap or recv_expires_heap
	local EXPIRES = RW == 'w' and 'send_expires' or 'recv_expires'
	local THREAD = RW == 'w' and 'send_thread' or 'recv_thread'
	return function(self, ...)
		::again::
		local ret = func(self, ...)
		if ret >= 0 then
			if returns_n then
				self[RW] = self[RW] + ret
			end
			return ret
		end
		local errno = errno()
		if errno == EWOULDBLOCK or errno == EINPROGRESS then
			if self[EXPIRES] then
				heap:push(self)
			end
			self[THREAD] = currentthread()
			local ok, err = wait_io()
			if not ok then
				return nil, err
			else
				goto again
			end
		else
			local ok, err = check_errno(nil, errno)
			return ok, err, errno
		end
	end
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
	self.recv_expires = expires
	recv_expires_heap:push(self)
	return wait_io(self)
end
function wj:wait(timeout)
	return self:wait_until(clock() + timeout)
end
function wj:try_resume(...)
	local thread = self.recv_thread
	if waiting[thread] ~= self then
		return nil, 'thread not waiting on this job'
	end
	self.recv_thread = nil
	assert(recv_expires_heap:remove(self))
	_resume(thread, ...) --to wait_io_cont()
	return true
end
function wj:resume(...)
	assert(self:try_resume(...))
end
function wj:cancel()
	if not self.recv_thread then return end
	self:resume(CANCEL)
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
	if self.recv_heap_index == -1 then return end
	assert(recv_expires_heap:remove(self))
	return self
end
function tm:setexpires(expires)
	self.recv_expires = expires
	if self.recv_heap_index ~= -1 then
		recv_expires_heap:replace(self.recv_heap_index, self)
	else
		recv_expires_heap:push(self)
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
	local ok, err = pcall(self.recv_thread)
	if not ok then --nowhere to raise errors to, so we just log them.
		log('ERROR', 'sock', 'timer', '%s%s', err, catall('\n', self.name) or '')
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

local poll_thread

function set_poll_thread(thread)
	poll_thread = thread
end

local _wait_io_count = 0
local _suspended_count = 0
--[[local]] waiting = {} --{thread->wait_job|true on I/O}

function wait_io_count() return _wait_io_count end
function suspended_count() return _suspended_count end

local function wait_io_cont(thread, ...)
	_wait_io_count = _wait_io_count - 1
	waiting[thread] = nil
	return ...
end
--[[local]] function wait_io(job)
	local thread, is_main = currentthread()
	assert(poll_thread, 'poll loop not started')
	assert(not is_main, 'trying to perform I/O from the main thread')
	waiting[thread] = job or true
	_wait_io_count = _wait_io_count + 1
	return wait_io_cont(thread, coro_transfer(poll_thread))
end

local threadfinish = {}
function onthreadfinish(thread, f)
	after(threadfinish, thread, f)
end

currentthread = coro.running
threadstatus = coro.status
cofinish = coro.finish

--NOTE: these thread maps are not weak-keyed! LuaJIT has no ephemerons,
--so a cycle like `ownthreadenv().req.thread = thread` is never collected!
--It's one of the reasons why threads must always finish.
local threadenvs    = {}
local ownthreadenvs = {}
local currowner     = {}

function threadenv(thread)
	return threadenvs[thread or currentthread()]
end

function ownthreadenv(thread, create)
	thread = thread or currentthread()
	local t = ownthreadenvs[thread]
	if not t and create ~= false then
		t = {}
		local pt = threadenvs[thread]
		if pt then --inherit parent env, if any.
			t.__index = pt
			setmetatable(t, t)
		end
		ownthreadenvs[thread] = t
		threadenvs[thread] = t
	end
	return t
end

local function thread_finish(thread, ok, ...)
	local finish = threadfinish[thread]
	if finish then
		threadfinish[thread] = nil
		finish(thread, ok, ...)
	end
	assert(not waiting[thread])
	threadenvs[thread] = nil
	ownthreadenvs[thread] = nil
	currowner[thread] = nil
end
local coro_finish_target = coro.finish_target
local function thread_onfinish(thread, ok, ...)
	thread_finish(thread, ok, ...)
	--poll threads don't have a caller thread to re-raise their errors into,
	--and we don't want them to break the main thread either as coro thereads
	--do by default, so errors are just logged and the thread finishes in the
	--current poll_thread (which is the caller thread when using resume()).
	if not ok then
		log('ERROR', 'thread', 'finish', '%s', ...)
	end
	if coro_finish_target(...) then --make cofinish() work.
		return ok, ...
	else
		return true, coro_finish(poll_thread)
	end
end
function thread(f, ...)
	local thread = coro_create(f, thread_onfinish, ...)
	threadenvs[thread] = threadenvs[currentthread()] --inherit threadenv.
	return thread
end

local function cowrap_onfinish(thread, ok, ...)
	thread_finish(thread, ok, ...)
	--cowrap threads re-raise their errors in their caller thread (they always
	--have one) so no need to log them. finalizers are still available for them.
	return ok, ...
end
function cowrap(f, ...)
	local wrapped, thread = coro_safewrap(f, cowrap_onfinish, ...)
	threadenvs[thread] = threadenvs[currentthread()] --inherit threadenv.
	return wrapped, thread
end

local function transfer_cont(...)
	_suspended_count = _suspended_count - 1
	return ...
end
function transfer(thread, ...)
	assert(not waiting[thread], 'transfer: thread waiting on I/O')
	_suspended_count = _suspended_count + 1
	return transfer_cont(coro_transfer(thread, ...))
end
function suspend()
	assert(poll_thread, 'suspend: poll loop not started')
	_suspended_count = _suspended_count + 1
	return transfer_cont(coro_transfer(poll_thread))
end

--[[local]] function _resume(thread, ...)
	--change poll_thread temporarily so that we get back here
	--from the first call to suspend(), wait_io() or thread finishing.
	local real_poll_thread = poll_thread
	poll_thread = currentthread()
	coro_transfer(thread, ...)
	poll_thread = real_poll_thread
end
function resume(thread, ...)
	assert(not waiting[thread], 'resume: thread waiting on I/O')
	_resume(thread, ...)
end

yield = coro.yield

local owner = {isowner = true}

function owner:try_close_owned()
	assert(not self.threads or next(self.threads) == nil,
		'owner closed with live threads')
	for i = #self.owns, 1, -1 do
		local o = self.owns[i]
		o:try_close()
		o.owner = nil
	end
	self.owns = nil --don't allow further owning.
end

function owner:thread(f, ...)
	local parent = self
	local th = thread(function(...)
		setcurrentowner(parent)
		return f(...)
	end, ...)
	attr(parent, 'threads')[th] = true
	onthreadfinish(th, function()
		parent.threads[th] = nil
	end)
	return th
end

function make_owner(o)
	local th
	if isthread(o) then
		th = o
		o = ownthreadenv(o)
	end
	if o.isowner then return o end
	update(o, owner)
	o.owns = {}
	if th then
		onthreadfinish(th, function()
			o:try_close_owned()
		end)
	elseif o.onclose then
		o:onclose(function()
			o:try_close_owned()
		end)
	end
	return o
end

function currentowner(create)
	local thread = currentthread()
	local owner = currowner[thread]
	if not owner and create ~= false then
		owner = make_owner(thread)
		currowner[thread] = owner
	end
	return owner
end

function setcurrentowner(owner, thread)
	thread = thread or currentthread()
	currowner[thread] = owner and make_owner(owner) or nil
end

function threadset()
	local ts = {}
	local n = 0
	local all_ok = true
	local first_err
	local wait_thread = currentthread()
	function ts:thread(f, ...)
		return thread(function(...)
			n = n + 1
			local ok, err = pcall(f, ...)
			if not ok and all_ok then
				all_ok = false
				first_err = err
			end
			n = n - 1
			if n == 0 then
				return cofinish(wait_thread)
			end
		end, ...)
	end
	function ts:join()
		if n ~= 0 then
			wait_thread = currentthread()
			suspend()
		end
		return all_ok, first_err
	end
	return ts
end

local term_sig_f

function poll(ignore_interrupts)
	if wait_io_count() == 0 then
		return nil, 'empty'
	elseif wait_io_count() == 1 and term_sig_f then --nobody left to kill this guy
		return nil, 'empty'
	end
	local ok, err = epoll_wait()
	if ok then return true end
	if err == 'interrupted' then
		if ignore_interrupts == nil then
			ignore_interrupts = config('ignore_interrupts', true)
		end
		log('note', 'sock', 'poll', 'interrupted: %s.',
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
	if wait_io_count() == 0 then return true end

	require'signal'

	--signals thread to stop loop on SIGINT (Ctrl+C) and SIGTERM (kill) events.
	assert(not term_sig_f)
	term_sig_f = on_signal('SIGINT SIGTERM', function()
		interrupt()
		return 'stop'
	end)

	set_poll_thread(currentthread())
	_running = true
	local ret, err = true
	repeat
		ret, err = poll(ignore_interrupts)
		if not ret then
			stop()
			if err == 'interrupted' or err == 'empty' then
				ret = true
				break
			else
				ret, err = true
			end
		end
	until _stop
	_running = false
	_stop = false
	return ret, err
end
function start(...)
	assert(try_start(...))
end

function run(f, ...)
	if _running then
		return f(...)
	else
		local ret
		local function wrapper(...)
			ret = pack(f(...))
		end
		resume(thread(wrapper, 'sock-run'), ...)
		start()
		return ret and unpack(ret)
	end
end
