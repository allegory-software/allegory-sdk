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
	* the built-in coroutine module is reimplemented here with identical API
	  such that it can be replaced entirely with coro, which is what enables
	  arbitrary transfering of control from inside standard-behaving coroutines.
	* `coro.safewrap()` is added which allows cross-yielding.
	* a finalizer can be specified to run when the coroutine finishes (whether
	  with an error or not) and can change the outcome of the coroutine (error
	  or success), its return values, and the transfer coroutine.
	* `coro.pcall` can be replaced to add tracebacks.
	* `coro.live` can be replaced for live-tracking coroutines.

WHY IT WORKS

	This works because calling resume() from a coroutine is a lie: instead of
	resuming the coroutine it actually suspends the calling coroutine giving
	back control to the main coroutine which does the resuming. Since the calling
	coroutine is now suspended, it can later be resumed from any other coroutine.

coro.create(f, [onfinish], [fmt, ...]) -> co

	Create a coroutine which can be started with either `coro.resume()` or
	with `coro.transfer()`.

	`onfinish` is a finalizer function `f(co, ok, ...) -> ok, ...` that is
	pcalled from inside the coroutine when the coroutine finishes.

	Raising inside the finalizer is like raising inside the coroutine.

	Abandoned coroutines in suspended state do not get to run their finalizer.

coro.try_transfer_with(co[, ok, ...]) -> ok, ... | nil, err
coro.try_transfer(co[, ...]) -> ok, ... | nil, err
coro.transfer_with(co[, ok, ...]) -> ...
coro.transfer(co[, ...]) -> ...

	Transfer control (and optionally any values) to a coroutine, suspending
	execution. The target coroutine either hasn't started yet, in which case it
	is started and it receives the values as the arguments of its main function,
	or it's suspended in a call to `coro.transfer()`, in which case it is resumed
	and receives the values as the return values of that call. Likewise, the
	coroutine which transfers execution will stay suspended until transfer()
	is called again with it as target.

	Errors raised inside a coroutine which was transferred into are re-raised
	into the main coroutine, unless the co's `onfinish` handler changes that.

	A coroutine which was transferred into (as opposed to one which was
	resumed into) must finish by transferring control to another coroutine
	(or to the main coroutine) via coro.finish_into() otherwise an error
	is raised into main.

	The _with variants allow raising into the target coroutine.
	The try_ variants allow catching errors raised back into the coroutine.

return coro.finish_into(co, ...)
return coro.finish_into_with(co, ok, ...)

	Finish the coroutine by transferring control to another coroutine.
	The _with variant allows raising an error in the target coroutine.

coro.finish_target(ok, ...) -> co | nil

	To be called inside a finalizer to detect a coro.finish_into() redirect.

coro.yield(...) -> ...

	Behaves like standard coroutine.yield(). A coroutine that was transferred
	into via coro.transfer() cannot yield (an error is raised if attempted).

coro.resume(co, ...) -> true, ... | false, err

	Behaves like standard coroutine.resume().

coro.resume_with(co, ok, ...) -> true, ... | false, err

	Like resume() but can resume the target coroutine by raising an error in it.

coro.running() -> co, is_main

	Behaves like standard coroutine.running() (from Lua 5.2 / LuaJIT 2).

coro.main -> co

	Returns the main coroutine.

coro.status(co) -> status

	Behaves like standard coroutine.status() except 'normal' is reported as
	'suspended' because resume is implemented through yield.

	NOTE: In this implementation `type(co) == 'thread'`.

coro.wrap(f, [onfinish], [fmt, ...]) -> wrapper

	Behaves like standard coroutine.wrap()

coro.safewrap(f, [onfinish], [fmt, ...]) -> wrapped, co

	Behaves like coroutine.wrap() except that the wrapped function receives
	a custom `yield` function as its first argument which always yields back
	to the calling coroutine even when called from a different coroutine. This
	allows cross-yielding i.e. yielding past multiple levels of nested
	coroutines which enables unrestricted inversion-of-control.

	With this you can turn any callback-based library into a sequential library,
	even if said library uses coroutines itself and wouldn't normally allow
	the callbacks to yield.

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

local function onfinish_pass(co, ...) return ... end

local main, is_main = coroutine.running()
assert(is_main, 'coro must be loaded from the main coroutine')
local current = main
local current_caller
coro = {main = main, pcall = pcall}

function coro.live() end --stub

local function unprotect(ok, ...)
	if ok then return ... end
	error(..., 2)
end

local FIN = {'FIN'}
function coro.finish_into_with(co, ok, ...)
	return FIN, co, ok, ...
end
function coro.finish_into(co, ...)
	return FIN, co, true, ...
end
function coro.finish_target(fin, co)
	return fin == FIN and co or nil
end
--the coroutine ends by transferring control to the caller (or finish) coroutine.
local function finish(co, new_caller, onfinish_ok, ok, ...)
	local old_caller = current_caller
	local caller = new_caller or old_caller
	if ... == FIN then -- (...) is (FIN, new_caller, ok, ...)
		local new_caller = select(2, ...)
		local old_caller = caller
		if old_caller and new_caller ~= old_caller then
			return main, false, 'resumed coroutine finished with a transfer'
		end
		return finish(co, new_caller, onfinish_ok, select(3, ...)) --tail call
	end
	coro.live(co, nil)
	current_caller = nil
	if not onfinish_ok then
		return caller or main, false, ok --ok=onfinish_error
	elseif not caller then
		if ok then
			return main, false, 'coroutine finished without transferring control'
		else
			return main, false, ...
		end
	elseif caller == co then
		return main, false, 'coroutine finished by transferring control to itself'
	elseif caller ~= main and status(caller) == 'dead' then
		return main, false, 'coroutine finished by transferring control to a dead coroutine'
	else
		return caller, ok, ...
	end
end
function coro.create(f, onfinish, fmt, ...)
	onfinish = onfinish or onfinish_pass
	local co
	co = cocreate(function(ok, ...)
		if not ok then --transferred into with an error.
			return finish(co, nil, coro.pcall(onfinish, co, false, ...))
		else
			return finish(co, nil, coro.pcall(onfinish, co, coro.pcall(f, ...)))
		end
	end)
	if fmt then
		coro.live(co, fmt, ...)
	else
		coro.live(co, '%s', traceback'unnamed coroutine')
	end
	return co
end

function coro.running()
	return current, current == main
end

coro.status = status

local function go(co, ok, ...)
	current = co
	if co == main then --transfer to the main coroutine: stop the scheduler.
		return ok, ...
	end
	--transfer to a coroutine: resume it and do the next transfer on come back.
	--since the coroutine handler is pcalled, we assume that resume() can't fail.
	return go(select(2, resume(co, ok, ...))) --tail call
end

local function try_transfer_with(co, ok, ...)
	if current ~= main then
		--we're inside a coroutine: signal the transfer request by yielding.
		return yield(co, ok, ...)
	else
		--we're in the main coroutine: start the scheduler.
		return go(co, ok, ...) --tail call
	end
end
local function transfer(co, ...)
	return unprotect(try_transfer_with(co, true, ...))
end

local function restore_caller(old_caller, ...)
	current_caller = old_caller
	return ...
end

function coro.try_transfer_with(co, ...)
	assert(co ~= current, 'trying to transfer to the running coroutine')
	if status(co) == 'dead' then
		return nil, 'cannot transfer to a dead coroutine'
	end
	local old_caller = current_caller
	current_caller = nil
	return restore_caller(old_caller, try_transfer_with(co, ...))
end
function coro.try_transfer(co, ...)
	return coro.try_transfer_with(co, true, ...)
end
function coro.transfer_with(co, ...)
	return unprotect(coro.try_transfer_with(co,...))
end
function coro.transfer(co, ...)
	return unprotect(coro.try_transfer_with(co, true, ...))
end

local function resume_with(co, ok, ...)
	assert(co ~= current, 'trying to resume the running coroutine')
	assert(co ~= main, 'trying to resume the main coroutine')
	if status(co) == 'dead' then
		return nil, 'cannot resume a dead coroutine'
	end
	local old_caller = current_caller
	current_caller = current
	return restore_caller(old_caller, try_transfer_with(co, ok, ...))
end
coro.resume_with = resume_with
function coro.resume(co, ...)
	return resume_with(co, true, ...)
end

function coro.yield(...)
	assert(current ~= main, 'yielding from the main coroutine')
	assert(current_caller, 'yielding from a non-resumed coroutine')
	return transfer(current_caller, ...)
end

function coro.wrap(f, ...)
	local co = coro.create(f, ...)
	return function(...)
		return unprotect(coro.resume(co, ...))
	end
end

function coro.safewrap(f, onfinish, fmt, ...)
	local ct --calling coroutine
	local yt --yielding coroutine
	local function yield(...)
		yt = current
		return coro.transfer(ct, ...)
	end
	local function finish(onfinish_ok, ok, ...)
		local ft = ct
		yt = nil
		ct = nil
		coro.live(current, nil)
		if not onfinish_ok then
			return ft, false, ok --ok=onfinish_err
		end
		return ft, ok, ...
	end
	onfinish = onfinish or onfinish_pass
	local function wrapper(ok, ...)
		return finish(coro.pcall(onfinish, current, coro.pcall(f, yield, ...)))
	end
	yt = cocreate(wrapper)
	if fmt then
		coro.live(yt, fmt, ...)
	else
		coro.live(yt, '%s', traceback'unnamed coroutine')
	end
	return function(...)
		assert(yt, 'cannot resume dead coroutine')
		ct = current
		return coro.transfer(yt, ...)
	end, yt
end

return coro
