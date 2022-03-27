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
	 (without pressuring the gc).
	 * the coro module reimplements all the methods of the built-in coroutine
	 module such that it can replace it entirely, which is what enables arbitrary
	 transfering of control from inside standard-behaving coroutines.
	 * `coro.safewrap()` is added which allows cross-yielding.

coro.create(f, [fmt, ...]) -> thread

	Create a coroutine which can be started with either `coro.resume()` or
	with `coro.transfer()`.

coro.transfer(thread[, ...]) -> ...

	Transfer control (and optionally any values) to a coroutine, suspending
	execution. The target coroutine either hasn't started yet, in which case it
	is started and it receives the values as the arguments of its main function,
	or it's suspended in a call to `coro.transfer()`, in which case it is resumed
	and receives the values as the return values of that call. Likewise, the
	coroutine which transfers execution will stay suspended until `coro.transfer()`
	is called again with it as target.

	Errors raised inside a coroutine which was transferred into are re-raised
	into the main thread.

	A coroutine which was transferred into (as opposed to one which was
	resumed into) must finish by transferring control to another coroutine
	(or to the main thread) otherwise an error is raised.

coro.ptransfer(thread[, ok, ...]) -> ok, ... | nil, err

	Protected transfer: a low-level variant of `coro.transfer()` that doesn't
	raise, and which can raise an error into the waiting target thread.

return coro.finish(thread, ...)

	Finish the coroutine by transferring control to another thread.


return coro.pfinish(thread, ok, ...)

	Finish the coroutine by transferring control to another thread, possibly
	raising an error in that thread analogous to ptransfer.

coro.install() -> old_coroutine_module

	Replace `_G.coroutine` with `coro` and return the old coroutine module.
	This enables coroutine-based-generators-over-abstract-I/O-callbacks
	from external modules to work with scheduled I/O functions which call
	`coro.transfer()` inside.

coro.yield(...) -> ...

	Behaves like standard coroutine.yield(). A coroutine that was transferred
	into via coro.transfer() cannot yield (an error is raised if attempted).

coro.resume(...) -> true, ... | false, err, traceback

	Behaves like standard coroutine.resume(). Adds a traceback as the third
	return value in case of error.

coro.running() -> thread, is_main

	Behaves like standard coroutine.running() (from Lua 5.2 / LuaJIT 2).

coro.main -> thread

	Returns the main thread.

coro.status(thread) -> status

	Behaves like standard coroutine.status()

NOTE: In this implementation `type(thread) == 'thread'`.

coro.wrap(f) -> wrapper

	Behaves like standard coroutine.wrap()

coro.safewrap(f, [fmt, ...]) -> wrapped, thread

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
	type, tostring, select, assert, error, pcall =
	type, tostring, select, assert, error, pcall

local traceback = debug.traceback
local resume    = coroutine.resume
local yield     = coroutine.yield
local cocreate  = coroutine.create

local callers = setmetatable({}, {__mode = 'k'}) --{thread -> caller_thread}
local main, is_main = coroutine.running()
assert(is_main, 'coro must be loaded from the main thread')
local current = main
local coro = {main = main}

function coro.thread_id(thread)
	local logging = coro.logging
	if logging then return logging.arg(thread) end
	return tostring(thread)
end

function coro.live(thread, ...)
	local logging = coro.logging
	if logging then return logging.live(thread, ...) end
end

local function unprotect(thread, ok, ...)
	if not ok then
		local e, trace = ...
		if type(e) == 'string' and trace then
			e = e..'\n'..trace:gsub('stack traceback:',
				coro.thread_id(thread)..' stack traceback:')
		end
		error(e, 2)
	end
	return ...
end

local FIN = {}
function coro.pfinish(thread, ok, ...)
	return FIN, thread, ok, ...
end
function coro.finish(thread, ...)
	return FIN, thread, true, ...
end

--the coroutine ends by transferring control to the caller (or finish) thread.
local function finish(thread, ok, ...)
	if ... == FIN then --called coro.[p]finish()
		callers[thread] = select(2, ...)
		return finish(thread, select(3, ...))
	end
	coro.live(thread, nil)
	local caller = callers[thread]
	if not caller then
		return main, false, 'coroutine ended without transferring control'
	end
	callers[thread] = nil
	return caller, ok, ...
end
function coro.create(f, fmt, ...)
	local thread
	thread = cocreate(function(ok, ...)
		if not ok then --ptransferred into with an error.
			error(..., 2)
		end
		return finish(thread, true, f(...))
	end)
	if fmt then
		coro.live(thread, fmt, ...)
	else
		coro.live(thread, traceback())
	end
	return thread
end

function coro.running()
	return current, current == main
end

coro.status = coroutine.status

local go --fwd. decl.
local function check(thread, ok, ...)
	if not ok then
		--the coroutine finished with an error. pass the error back to the
		--caller thread, or to the main thread if there's no caller thread.
		coro.live(thread, nil)
		local caller = callers[thread]
		if caller then
			callers[thread] = nil
		else
			caller = main
		end
		return go(caller, false, ..., traceback(thread)) --tail call
	end
	return go(...) --tail call: loop over the next transfer request.
end
function go(thread, ok, ...)
	current = thread
	if thread == main then
		--transfer to the main thread: stop the scheduler.
		return ok, ...
	end
	--transfer to a coroutine: resume it and check the result.
	return check(thread, resume(thread, ok, ...)) --tail call
end

local function ptransfer(thread, ok, ...)
	if type(thread) ~= 'thread' then
		error('coroutine expected, got: '..type(thread), 2)
	end
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
	return unprotect(thread, ptransfer(thread, true, ...))
end

coro.ptransfer = ptransfer
coro.transfer = transfer

local function remove_caller(thread, ...)
	callers[thread] = nil
	return ...
end
function coro.resume(thread, ...)
	assert(thread ~= current, 'trying to resume the running thread')
	assert(thread ~= main, 'trying to resume the main thread')
	callers[thread] = current
	return remove_caller(thread, ptransfer(thread, true, ...))
end

function coro.yield(...)
	assert(current ~= main, 'yielding from the main thread')
	local caller = callers[current]
	assert(caller, 'yielding from a non-resumed thread')
	return transfer(caller, ...)
end

function coro.wrap(f)
	local thread = coro.create(f)
	return function(...)
		return unprotect(thread, coro.resume(thread, ...))
	end
end

function coro.safewrap(f, fmt, ...)
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
		if not ok then
			return ft, false, ..., traceback(current)
		else
			return ft, true, ...
		end
	end
	local function wrapper(ok, ...)
		return finish(pcall(f, yield, ...))
	end
	yt = cocreate(wrapper)
	if fmt then
		coro.live(yt, fmt, ...)
	else
		coro.live(yt, traceback())
	end
	return function(...)
		assert(yt, 'cannot resume dead coroutine')
		ct = current
		return transfer(yt, ...)
	end, yt
end

function coro.install()
	_G.coroutine = coro
	return coroutine
end

return coro
