--[=[

	Error handling for network protocols and file decoders

API

	check{_io|p|np}(self, val, format, format_args...) -> val

RATIONALE

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
  entirely because they won't guard against anything and just bloat the code.

- Request or response content validation errors, which can be user-corrected
  so they mustn't raise and mustn't close the connection/file. Use `checknp()`
  short for "check non-protocol" for those.

- I/O errors, i.e. network/pipe failures which can be temporary and thus make
  the request retriable (in a new connection, this one must be closed), so they
  must be distinguishable from other types of errors. Use `check_io()` for
  those. On the call side then check the error class for implementing retries.

Following this protocol should easily cut your network code in half, increase
its readability (no more error-handling noise) and its reliability (no more
confusion about when to raise and when not to or forgetting to handle an error).

Your object must have a try_close() method which will be called by check_io()
and checkp() (but not by checknp()) on failure.

Note that protect_io() only catches errors raised by check*(), other Lua
errors pass through and the file/connection isn't closed either.

You can also implement protocols the opposite way, i.e. the golang-way, i.e.
in the protocol implementation only call nil,err-returning I/O methods
(so try_*() only) and early-exit on errors with nil,err. Then create raising
variants of your methods with unprotect_io(). That half-defeats the purpose
of this, but there's no hidden control flow in the protocol implementation
and you have more control on how to handle each failure case.

TODO: Currently try_*() methods on sock and fs modules do not break on usage
errors coming from the OS except for EINVAL and EBADF, so some errors might
come up as potentially retriable which is not correct. The correct behavior
is to raise on usage errors because these are usually bugs. This must be
thought through and fixed on case-by-case in fs and sock. See try_accept()
for how to fix it.
]=]

if not ... then require'errors_test'; return end

require'glue'

local function io_error_init(self)
	if self.target then
		local ok, err = self.target:try_close()
		if not ok then
			self.message = self.message..'\nclose() also failed: '..err
		end
	end
end

local io_error = errortype'io'
io_error.init = io_error_init
function check_io(self, v, ...)
	if v then return v, ... end
	raise(io_error({
		target = self,
		addtraceback = self and self.tracebacks,
	}, ...))
end

local protocol_error = errortype'protocol'
protocol_error.init = io_error_init
function checkp(self, v, ...)
	if v then return v, ... end
	raise(protocol_error({
		target = self,
		addtraceback = self and self.tracebacks,
	}, ...))
end

local content_error = errortype'content'
function checknp(self, v, ...)
	if v then return v, ... end
	raise(content_error({
		addtraceback = self and self.tracebacks,
	}, ...))
end

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
