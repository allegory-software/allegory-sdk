--[=[

	Symmetric coroutines from the paper at
		http://www.inf.puc-rio.br/~roberto/docs/corosblp.pdf
	Written by Cosmin Apreutesei. Public Domain.

OVERVIEW

	Symmetric coroutines are coroutines that can transfer control freely between
	themselves, unlike Lua's standard coroutines which can only yield back to
	the coroutine that resumed them (and are called asymmetric coroutines
	or generators because of that reason).

RATIONALE

	Using coroutine-based async I/O methods (like the `read()` and `write()`
	methods of async socket libraries) inside user-created standard coroutines
	is by default not possible because the I/O methods would yield to the parent
	coroutine instead of yielding to their scheduler. This can be solved using
	a coroutine scheduler that allows transferring control not only to the parent
	coroutine but to any specified coroutine.

	This implementation is loosely based on the one from the paper
	[Coroutines in Lua](http://www.inf.puc-rio.br/~roberto/docs/corosblp.pdf)
	with some important modifications:

	* `coro.transfer()` can transfer multiple values between coroutines
	  without pressuring the gc.
	* the built-in coroutine module is reimplemented here with identical API
	  such that it can be replaced entirely with coro, which is what enables
	  arbitrary transfering of control from inside standard-behaving coroutines.
	* `coro.safewrap()` is added which allows cross-yielding.
	* a finalizer can be specified to run when the coroutine finishes (whether
	  with an error or not) and can change the outcome of the coroutine (error
	  or success), its return values, and the transfer coroutine.
	* `coro.pcall` can be replaced to add tracebacks.
	* `coro.live` can be replaced for live-tracking threads.

coro.create(f, [onfinish], [fmt, ...]) -> thread

	Create a coroutine which can be started with either `coro.resume()` or
	with `coro.transfer()`.

	`onfinish` is a finalizer function `f(thread, ok, ...) -> ok, ...` that is
	called from inside the thread when the thread finishes.

coro.transfer(thread[, ...]) -> ...

	Transfer control (and optionally any values) to a coroutine, suspending
	execution. The target coroutine either hasn't started yet, in which case it
	is started and it receives the values as the arguments of its main function,
	or it's suspended in a call to `coro.transfer()`, in which case it is resumed
	and receives the values as the return values of that call. Likewise, the
	coroutine which transfers execution will stay suspended until `coro.transfer()`
	is called again with it as target.

	Errors raised inside a coroutine which was transferred into are re-raised
	into the main thread, unless the thread's `onfinish` handler changes that.

	A coroutine which was transferred into (as opposed to one which was
	resumed into) must finish by transferring control to another coroutine
	(or to the main thread) otherwise an error is raised.

coro.transfer_with(thread[, ok, ...]) -> ok, ... | nil, err

	Protected transfer: a low-level variant of `coro.transfer()` that doesn't
	raise, and which can raise an error into the waiting target thread.

return coro.finish(thread, ...)

	Finish the coroutine by transferring control to another thread.

return coro.finish_with(thread, ok, ...)

	Finish the coroutine by transferring control to another thread, possibly
	raising an error in that thread analogous to transfer_with.

coro.yield(...) -> ...

	Behaves like standard coroutine.yield(). A coroutine that was transferred
	into via coro.transfer() cannot yield (an error is raised if attempted).

coro.resume(thread, ...) -> true, ... | false, err

	Behaves like standard coroutine.resume().

coro.resume_with(thread, ok, ...) -> true, ... | false, err

	Like resume() but can resume the target thread by raising an error in it.

coro.running() -> thread, is_main

	Behaves like standard coroutine.running() (from Lua 5.2 / LuaJIT 2).

coro.main -> thread

	Returns the main thread.

coro.status(thread) -> status

	Behaves like standard coroutine.status()

NOTE: In this implementation `type(thread) == 'thread'`.

coro.wrap(f, [onfinish], [fmt, ...]) -> wrapper

	Behaves like standard coroutine.wrap()

coro.safewrap(f, [onfinish], [fmt, ...]) -> wrapped, thread

	Behaves like coroutine.wrap() except that the wrapped function receives
	a custom `yield` function as its first argument which always yields back
	to the calling thread even when called from a different thread. This allows
	cross-yielding i.e. yielding past multiple levels of nested coroutines
	which enables unrestricted inversion-of-control.

	With this you can turn any callback-based library into a sequential library,
	even if said library uses coroutines itself and wouldn't normally allow
	the callbacks to yield.

WHY IT WORKS

	This works because calling resume() from a thread is a lie: instead of
	resuming the thread it actually suspends the calling thread giving back
	control to the main thread which does the resuming. Since the calling
	thread is now suspended, it can later be resumed from any other thread.

]=]

if not ... then require'coro_test'; return end

--Tip: don't be deceived by the small size of this code.

local
	type, tostring, select, assert, error =
	type, tostring, select, assert, error

local traceback = debug.traceback
local resume    = coroutine.resume
local yield     = coroutine.yield
local cocreate  = coroutine.create
local status    = coroutine.status

local function onfinish_pass(thread, ...) return ... end

local callers = setmetatable({}, {__mode = 'k'}) --{thread -> caller_thread}
local main, is_main = coroutine.running()
assert(is_main, 'coro must be loaded from the main thread')
local current = main
local coro = {main = main, pcall = pcall}

function coro.live() end --stub

local function unprotect(ok, ...)
	if not ok then
		error(..., 2)
	end
	return ...
end

local FIN = {}
function coro.finish_with(thread, ok, ...)
	return FIN, thread, ok, ...
end
function coro.finish(thread, ...)
	return FIN, thread, true, ...
end

--the coroutine ends by transferring control to the caller (or finish) thread,
local function finish(thread, ok, ...)
	if ... == FIN then --called coro.[p]finish()
		callers[thread] = (select(2, ...))
		return finish(thread, select(3, ...))
	end
	coro.live(thread, nil)
	local caller = callers[thread]
	callers[thread] = nil
	if not caller then
		if ok then
			return main, false, 'coroutine ended without transferring control'
		else
			caller = main
		end
	elseif caller == thread then
		return main, false, 'coroutine ended by transferring control to itself'
	elseif caller ~= main and status(caller) == 'dead' then
		return main, false, 'coroutine ended by transferring control to a dead coroutine'
	end
	return caller, ok, ...
end
function coro.create(f, onfinish, fmt, ...)
	onfinish = onfinish or onfinish_pass
	local thread
	thread = cocreate(function(ok, ...)
		if not ok then --transferred into with an error.
			return finish(thread, onfinish(thread, false, ...))
		end
		return finish(thread, onfinish(thread, coro.pcall(f, ...)))
	end)
	if fmt then
		coro.live(thread, fmt, ...)
	else
		coro.live(thread, '%s', traceback'unnamed thread')
	end
	return thread
end

function coro.running()
	return current, current == main
end

coro.status = status

local function go(thread, ok, ...)
	current = thread
	if thread == main then --transfer to the main thread: stop the scheduler.
		return ok, ...
	end
	--transfer to a coroutine: resume it and do the next transfer on come back.
	--since the coroutine handler is pcalled, we assume that resume() can't fail.
	return go(select(2, resume(thread, ok, ...))) --tail call
end

local function transfer_with(thread, ok, ...)
	assert(status(thread) ~= 'dead', 'cannot transfer to a dead coroutine')
	assert(thread ~= current, 'trying to transfer to the running thread')
	if current ~= main then
		--we're inside a coroutine: signal the transfer request by yielding.
		return yield(thread, ok, ...)
	else
		--we're in the main thread: start the scheduler.
		return go(thread, ok, ...) --tail call
	end
end

local function transfer(thread, ...)
	return unprotect(transfer_with(thread, true, ...))
end

coro.transfer_with = transfer_with
coro.transfer = transfer

local function remove_caller(thread, ...)
	callers[thread] = nil
	return ...
end
local function resume_with(thread, ok, ...)
	assert(thread ~= current, 'trying to resume the running thread')
	assert(thread ~= main, 'trying to resume the main thread')
	callers[thread] = current
	return remove_caller(thread, transfer_with(thread, ok, ...))
end
coro.resume_with = resume_with
function coro.resume(thread, ...)
	return resume_with(thread, true, ...)
end

function coro.yield(...)
	assert(current ~= main, 'yielding from the main thread')
	local caller = callers[current]
	assert(caller, 'yielding from a non-resumed thread')
	return transfer(caller, ...)
end

function coro.wrap(f, ...)
	local thread = coro.create(f, ...)
	return function(...)
		return unprotect(coro.resume(thread, ...))
	end
end

function coro.safewrap(f, onfinish, fmt, ...)
	local ct --calling thread
	local yt --yielding thread
	local function yield(...)
		yt = current
		return transfer(ct, ...)
	end
	local function finish(ok, ...)
		local ft = ct
		yt = nil
		ct = nil
		coro.live(current, nil)
		return ft, ok, ...
	end
	onfinish = onfinish or onfinish_pass
	local function wrapper(ok, ...)
		return finish(onfinish(current, coro.pcall(f, yield, ...)))
	end
	yt = cocreate(wrapper)
	if fmt then
		coro.live(yt, fmt, ...)
	else
		coro.live(yt, '%s', traceback'unnamed thread')
	end
	return function(...)
		assert(yt, 'cannot resume dead coroutine')
		ct = current
		return transfer(yt, ...)
	end, yt
end

return coro
