--[=[

	Error handling for network protocols and file decoders

RATIONALE

I/O errors, protocol errors, file format errors, data errors, etc. must not
raise into the app like normal bugs. Instead they must be contained at
connection / file decoder boundary to allow the app to close the connection
or file and deal with the error without breaking with a stack trace. At the
same time, bugs should pass through that boundary and raise normally. Hence
the need to distingish I/O errors from normal programming errors.

You should distinguish between multiple types of errors:

- Invalid API usage, i.e. bugs on this side, which should raise outside
  connection scope (but shouldn't happen in production). Use assert()
  and error() normally for those.

- Response/format validation errors, i.e. bugs on the other side or corrupt
  data which shouldn't raise outside connection scope. Use checkp() short
  for "check protocol" for those. For internal protocols that are part of
  the same application and don't run on the Internet you can skip these
  checks and let bugs from the remote side surface as bugs on the local side.

- Request or response content validation errors, which can be retried without
  reconnecting, so they must not raise outside connection scope and must only
  be raised before advancing connection state. Use checknp() short for
  "check non-protocol" for those.

- I/O errors, i.e. network/pipe failures, some of which can be temporary and
  thus make the request retriable (in a new connection, this one must be
  closed), so they must not raise outside connection scope. Use check_io()
  for those. At the call site then check the error object for deciding
  when to retry.

- I/O errors on stable storage, i.e. disk failures which you might want to
  kill the whole app on.

- CANCEL: a static error that cannot be caught by try() / catch() so it can
be used to break an epoll thread and it won't be logged as an error.

Following this protocol should easily cut your network code in half, increase
its readability (no more error-handling noise) and its reliability (no more
confusion about when to raise and when not to or forgetting to handle an error).

Note that protect_io() only catches errors raised by check*(), other Lua
errors are raised through it.

You can also implement things the opposite way i.e. the golang/C way i.e.
only call non-raising I/O methods inside so try_*() only, and early-exit on
errors with nil,err and then use unprotect_io() to create rasing variants
of your protocol methods. Doing it this way is noisy and error-prone, but
also has advantages: there's no hidden control flow so you get more control
and legibility at each failure point.

CAVEATS

- unprotect_io() will turn nil,string_error into an 'io'-type error
  so return typed errors if they're not of 'io' type.

- protect_io() will not catch string errors, so assert(f:try_read()) will
  be re-raised. Use f:read() or f:check_io(f:try_read()) instead.

- check_errno() raises string errors so it's for raising programming errors
not I/O errors. Use check_io(f, try_errno()) to raise I/O errors.

]=]

if not ... then require'errors_io_test'; return end

require'glue'

local
	error, iserror =
	error, iserror

--errortype'io'
--errortype'protocol'
--errortype'content'

--errno unified messages -----------------------------------------------------
--only list here user errors and recoverable errors.

cdef'char *strerror(int errnum);'

local errno_msgs = {
	--fs & proc
	[  1] = 'access_denied', --EPERM
	[  2] = 'not_found', --ENOENT, _open_osfhandle(), _fdopen(), open(), mkdir(),
	                     --rmdir(), opendir(), rename(), unlink()
	[  4] = 'interrupted', --EINTR, epoll_wait()
	[  5] = 'io_error', --EIO, read(), write(), fsync()
	[  9] = 'bad_file', --EBADF
	[ 12] = 'out_of_mem', --ENOMEM, mmap()
	[ 13] = 'access_denied', --EACCES, open(), mkdir(), unlink(), rmdir()
	[ 17] = 'already_exists', --EEXIST, open(), mkdir(), mkfifo(), rename()
	[ 18] = 'cross_device', --EXDEV, rename()
	[ 19] = 'no_device', --ENODEV, block device disappeared (fatal)
	[ 20] = 'not_dir', --ENOTDIR, open(), opendir()
	[ 21] = 'is_dir', --EISDIR, open(), unlink()
	[ 22] = 'invalid_argument', --EINVAL, mmap()
	[ 23] = 'too_many_open_files', --ENFILE, open()
	[ 24] = 'too_many_fds', --EMFILE, open() (fatal: fd leak)
	[ 27] = 'file_too_big', --EFBIG, write(), fallocate(), truncate()
	[ 28] = 'no_space', --ENOSPC, write(), fallocate(), mkdir(), rename(), epoll_add() (fatal)
	[ 29] = 'invalid_seek', --ESPIPE, lseek() on pipe/socket (fatal: programming error)
	[ 30] = 'read_only', --EROFS, open(), mkdir(), unlink(), rename() (fatal)
	[ 32] = 'eof', --EPIPE, write()
	[ 36] = 'name_too_long', --ENAMETOOLONG, open(), rename(), mkdir()
	[ 38] = 'not_implemented', --ENOSYS, syscall not implemented (fatal: wrong kernel)
	[ 39] = 'not_empty', --ENOTEMPTY, rmdir()
	[ 40] = 'too_many_symlinks', --ELOOP, open(), stat() (too many symlinks in path)
	[ 95] = 'not_supported', --EOPNOTSUPP, fallocate()
	[122] = 'disk_quota', --EDQUOT, write(), open(), mkdir()
	--sock
	[ 64] = 'network_missing', --ENONET, accept()
	[ 71] = 'protocol_error', --EPROTO, accept()
	[ 92] = 'protocol_not_available', --ENOPROTOOPT, accept()
	[ 98] = 'address_already_in_use', --EADDRINUSE, bind()
	[ 99] = 'address_not_available', --EADDRNOTAVAIL, bind(), connect()
	[100] = 'network_down', --ENETDOWN, connect(), send()
	[101] = 'network_unreachable', --ENETUNREACH, connect(), send()
	[103] = 'connection_aborted', --ECONNABORTED, accept()
	[104] = 'connection_reset', --ECONNRESET, recv(), send()
	[107] = 'not_connected', --ENOTCONN, send(), recv(), shutdown() (fatal)
	[110] = 'timed_out', --ETIMEDOUT, connect()
	[111] = 'connection_refused', --ECONNREFUSED, connect()
	[112] = 'host_down', --EHOSTDOWN, accept()
	[113] = 'host_unreachable', --EHOSTUNREACH, connect(), send()
	[114] = 'already_in_progress', --EALREADY, connect() (fatal)
	[115] = 'in_progress', --EINPROGRESS, connect() (handled in scheduler)
}

function try_errno(target, errclass, ret, err)
	if ret then return ret end
	if isstr(err) then return ret, err end
	err = err or errno()
	local s = errno_msgs[err]
	assert(s ~= 'invalid_argument', s)
	assert(s ~= 'bad_file', s)
	assert(s ~= 'invalid_seek', s)
	assert(s ~= 'no_device', s)
	assert(s ~= 'too_many_fds', s)
	assert(s ~= 'read_only', s)
	assert(s ~= 'not_implemented', s)
	assert(s ~= 'not_connected', s)
	assert(s ~= 'already_in_progress', s)
	if s then return ret, s end
	local s = C.strerror(err)
	local s = str(s) or 'errno_'..err
	return ret, s
end

--TODO: find a good name for this generic version.
--[[
function check_class(target, errclass, ret, ...)
	if ret then return ret end
	return newerror(errclass, {target = target}, ...)
end
]]

function check_io(target, ret, ...)
	if ret then return ret end
	error(..., 0)
	raise('io', {target = target}, ...)
end

function checkp(target, ret, ...)
	if ret then return ret end
	error(..., 0)
	raise('protocol', {target = target}, ...)
end

function checknp(target, ret, ...)
	if ret then return ret end
	error(..., 0)
	raise('content', {target = target}, ...)
end

--function protect_io(f, oncaught)
--	return protect('io protocol content', f, oncaught)
--end

--NOTE: unprotect_io() will turn nil,string_error into an 'io'-type error
--so return typed errors if they're not of 'io' type.
local function cont(target, ret, ...)
	if ret then return ret, ... end
	error(..., 0)
	raise('io', {target = target}, (...))
end
function unprotect_io(f)
	return function(target, ...)
		return cont(target, f(target, ...))
	end
end

function check_errno(...)
	cont(nil, try_errno(nil, 'io', ...))
end

function check(errorclass, event, v, ...)
	if v then return v end
	assert(type(errorclass) == 'string' or iserror(errorclass))
	assert(type(event) == 'string')
	local e = newerror(errorclass, ...)
	if not e.logged then
		log('ERROR', e.errortype, event, '%s', e.message)
		e.logged = true
	end
	raise(e)
end