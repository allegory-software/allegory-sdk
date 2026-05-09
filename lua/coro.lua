--[=[

	Symmetric Coroutines
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
	* `coro.wrap()` is added which allows cross-yielding.

WHY IT WORKS

	This works because calling transfer() from a coroutine is not resuming the
	coroutine but instead it suspends the calling coroutine giving back control
	to the main coroutine which does the resuming. Since the calling coroutine
	is now suspended, it can later be resumed from any other coroutine.

coro.create(fn) -> co

	Create a coroutine which can be started with `coro.transfer()`.

coro.try_transfer(co, ...) -> true, ... | nil, err
coro.transfer(co, ...) -> ...

	Transfer control (and optionally any values) to a coroutine, suspending
	execution. The target coroutine either hasn't started yet, in which case it
	is started and it receives the values as the arguments of its main function,
	or it's suspended in a call to `coro.transfer()`, in which case it is
	resumed and receives the values as the return values of that call.
	Likewise, the coroutine which transfers execution will stay suspended until
	transfer() is called again with it as target.

	Errors raised inside a coroutine which was transferred into are re-raised
	into main. The try_ variant only protects target validation errors; errors
	raised by a running coroutine are still re-raised into main.

	Coroutines must finish by returning `co, ...` to transfer control to
	another coroutine. Returning nothing/nil transfers to main. The finish
	target must be a live coroutine other than the current coroutine.

coro.running() -> co, is_main

	Behaves like standard coroutine.running() (from Lua 5.2 / LuaJIT 2).

coro.main -> co

	Returns the main coroutine.

coro.status(co) -> status

	Behaves like standard coroutine.status() except 'normal' is reported as
	'suspended' because transfer() actually yields to the scheduler.

coro.wrap(fn) -> wrapped, co

	Behaves like coroutine.wrap() except that fn receives a custom `yield`
	function as its first argument. Calling wrapped(...) starts/resumes fn,
	passing ... as fn arguments or as the return values of yield(). Values
	passed to yield() and values returned by fn are returned plainly by
	wrapped(); errors raised by fn are raised in the wrapped() caller.

	The custom yield function always yields back to the calling coroutine even
	when called from a different coroutine. This allows cross-yielding i.e.
	yielding past multiple levels of nested coroutines which enables
	unrestricted inversion-of-control.

	With this you can turn any callback-based library into a sequential library,
	even if said library uses coroutines itself and wouldn't normally allow
	the callbacks to yield.

coro.pcall

	Function used by coro.wrap() to protect fn. Defaults to pcall and can be
	replaced to add tracebacks.

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

local main, is_main = coroutine.running()
assert(is_main, 'coro module must be loaded from the main coroutine')
local current = main
coro = {main = main, pcall = pcall}

local function unprotect(ok, ...)
	if ok then return ... end
	error(..., 0)
end

local function finish(co, ...)
	if co == nil then co = main end
	assert(type(co) == 'thread', 'thread expected')
	assert(co ~= current, 'finish to self')
	assert(status(co) ~= 'dead', 'finish to a dead coroutine')
	return co, ...
end
function coro.create(fn)
	return cocreate(function(...)
		return finish(fn(...))
	end)
end

function coro.running()
	return current, current == main
end

coro.status = status

local function unprotect_resume(ok, ...)
	if ok then return ... end
	current = main
	error(..., 0)
end
local function go(co, ...)
	current = co
	if co == main then --transfer to the main coroutine: stop the scheduler.
		return ...
	end
	--transfer to a coroutine: resume it and do the next transfer on come back.
	return go(unprotect_resume(resume(co, ...))) --tail call
end

local function transfer(co, ...)
	if current ~= main then
		--we're inside a coroutine: signal the transfer request by yielding.
		return yield(co, ...)
	else
		--we're in the main coroutine: start the scheduler.
		return go(co, ...) --tail call
	end
end

function coro.try_transfer(co, ...)
	if type(co) ~= 'thread' then return nil, 'thread expected' end
	if co == current then return nil, 'transfer to self' end
	if status(co) == 'dead' then return nil, 'transfer to a dead coroutine' end
	return true, transfer(co, ...)
end
function coro.transfer(...)
	return unprotect(coro.try_transfer(...))
end

coro.pcall = pcall
function coro.wrap(fn)
	local ct --calling coroutine
	local yt --yielding coroutine
	local function yield(...)
		yt = current
		return transfer(ct, true, ...)
	end
	local function finish(ok, ...)
		local ft = ct
		yt = nil
		ct = nil
		return ft, ok, ...
	end
	local function wrapper(...)
		return finish(coro.pcall(fn, yield, ...))
	end
	yt = cocreate(wrapper)
	return function(...)
		assert(yt, 'resume to a dead coroutine')
		ct = current
		return unprotect(transfer(yt, ...))
	end, yt
end

return coro
