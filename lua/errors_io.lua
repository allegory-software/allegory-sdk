--[=[

	Error handling for network protocols and file decoders

RAISE-FIRST
	check{_io|p|np}(self, val, format, format_args...) -> val
	protect_io(raising_f) -> try_f

TRY-FIRST
	io_error[_noclose](str_err) -> err
	protocol_error[_noclose](str_err) -> err
	content_error[_close](str_err) -> err
	unprotect_io(try_f) -> raising_f

RATIONALE for RAISE-FIRST

This is an error-handling discipline to use when writing TCP-based protocols
or file decoders and encoders. Instead of using standard assert() and pcall(),
use check_io(), checkp() and checknp() to raise errors inside protocol methods
and then wrap those methods in protect_io() to create nil,err-returning
variants (i.e. try_*() variants) of those methods.

You should distinguish between multiple types of errors:

- Invalid API usage, i.e. bugs on this side, which should raise (but shouldn't
  happen in production). Use `assert()` for those.

- Response/format validation errors, i.e. bugs on the other side or corrupt
  data which shouldn't raise but they put the connection/decoder in an
  inconsistent state so the connection/file must be closed. Use `checkp()`
  short for "check protocol" for those. Note that if your protocol is not meant
  to work with a hostile or unstable peer, you can skip the `checkp()` checks
  entirely and let bugs from the remote side surface as bugs on your side.

- Request or response content validation errors, which can be user-corrected
  so they must not raise and not close the connection/file. Use `checknp()`
  short for "check non-protocol" for those.

- I/O errors, i.e. network/pipe failures which can be temporary and thus make
  the request retriable (in a new connection, this one must be closed), so they
  must be distinguishable from other types of errors. Use `check_io()` for
  those. On the call side then check the error class for implementing retries.

Following this protocol should easily cut your network code in half, increase
its readability (no more error-handling noise) and its reliability (no more
confusion about when to raise and when not to or forgetting to handle an error).

The self passed to check*() must have a try_close() method which will be called
by check_io() and checkp() (but not by checknp()) on failure.

Note that protect_io() only catches errors raised by check*(), other Lua
errors are raised through it and the file/connection isn't closed either.

RATIONALE for TRY-FIRST

You can also implement things the opposite way i.e. the golang/C way i.e.
only call non-raising I/O methods inside so try_*() only, and early-exit on
errors with nil,err (with explicit clean-up) and then create rasing variants
of your protocol methods with unprotect_io(). Doing it this way is noisy
and error-prone and you must turn nil,str_err into nil,protocol_error(str_err)
as needed because unprotect_io() turns all nil,str_err into I/O errors.
But this also has advantages: there's no hidden control flow so you get more
control and legibility at each failure point and no re-raising on bugs
(which is necessary with protect_io() since pcall can't do selective catch).

TODO:
Currently try_*() methods on sock and fs modules do not break on usage
errors coming from the OS except for EINVAL and EBADF, so some errors might
come up as potentially retriable which is not correct. The correct behavior
is to raise on usage errors because these are usually bugs. This must be
thought through and fixed on case-by-case in fs and sock. See try_accept()
for how to fix it.
Also, these try methods don't close the file/socket on error and return string
errors instead of structured I/O errors. This allows for `err == 'not_found'`
checks but it's inconsistent with protocol try methods.
Also, file:try_close() is made with protect_io() so it returns I/O errors!
Also, pbuffer's try methods are all over the place (eg. see try_skip()).
]=]

if not ... then require'errors_io_test'; return end

require'glue'

local
	error, iserror =
	error, iserror

local function targeted_error_init(self)
	if self.target and not self.noclose and self.target.try_close then
		local ok, err = self.target:try_close()
		if not ok then
			self.message = self.message..'\nclose() also failed: '..err
		end
	end
end
local function targeted_error(error_classname)
	local errorclass = errortype(error_classname)
	errorclass.init = targeted_error_init
	local function newerror(self, arg1, ...)
		if iserror(arg1) then return arg1 end --pass-through structured errors
		if not self then return errorclass(arg1, ...) end --no target
		return errorclass({
			target = self,
			addtraceback = self.tracebacks,
		}, arg1, ...)
	end
	local function newerror_noclose(self, arg1, ...)
		if iserror(arg1) then return arg1 end --pass-through structured errors
		if not self then return errorclass(arg1, ...) end --no target
		return errorclass({
			target = self,
			addtraceback = self.tracebacks,
			noclose = true,
		}, arg1, ...)
	end
	local function check(self, v, ...)
		if v then return v, ... end
		error(newerror(self, ...))
	end
	local function check_noclose(self, v, ...)
		if v then return v, ... end
		error(newerror_noclose(self, ...))
	end
	return newerror, newerror_noclose, check, check_noclose
end
io_error, io_error_noclose,
	check_io, check_io_noclose = targeted_error'io'

protocol_error, protocol_error_noclose,
	checkp, checkp_noclose = targeted_error'protocol'

content_error_close, content_error,
	checknp_close, checknp = targeted_error'content'

function protect_io(f, oncaught)
	return protect('io protocol content', f, oncaught)
end

local check_io = check_io
function unprotect_io(f)
	assert(f)
	return function(self, ...)
		return check_io(self, f(self, ...))
	end
end
