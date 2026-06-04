--[=[

	Structured errors for protocol, decoder and I/O boundaries.

CREATING ERRORS
	newerror(e) -> e                              make an error object
	CANCEL                                        static error that try/catch can't catch
	CLOSED                                        static error for "self is closed"
	e.addtraceback -> true                        add traceback (see pcall override in glue)
RAISING ERRORS
	check_for (errtype, target, event, ret, fmt, ...) -> ret  raise typed error
	check_fs  (target, event, ret, fmt, ...) -> ret  check_for with 'fs' errtype
	check_net (target, event, ret, fmt, ...) -> ret  check_for with 'net' errtype
	checkp    (target, ret, fmt, ...) -> ret      check_for with 'protocol' errtype
	checknp   (target, ret, fmt, ...) -> ret      check_for with 'data' errtype
	try_errno(ret, err) -> ret | nil,err          map errno to string errors
	check_errno(ret, err) -> ret                  assert(try_errno(ret, err))
	make_raising([errtype], event, f) -> f        turn nil,err-returning f into raising
	target.error_type                             default errtype for check_for()
	target.tracebacks                             add traceback to errors on target
CATCHING ERRORS
	catch([errtypes], f, ...) -> true,... | false,e   pcall and catch table errors
	try(f, ...) -> true,... | false,e             catch all table errors
	iserror(e, [types], [message]) -> t|f         check if e is an error object

RATIONALE

Structured errors are an enhancement over plain string errors by adding
selective catching while bugs still raise, and providing a context for
the failure to help with freeing resources, recovery or logging. They're
most useful at network, protocol, file and decoder boundaries.

I/O AND PROTOCOL ERRORS

I/O errors, protocol errors, file format errors, data errors, etc. must not
raise into the app like normal bugs. Instead they must be contained at
connection / file decoder boundary to allow the app to close the connection
or file and deal with the error without breaking with a stack trace. At the
same time, bugs should pass through that boundary and raise normally. Hence
the need to distinguish I/O errors from normal programming errors.

You should distinguish between multiple types of errors:

- Invalid API usage, i.e. bugs on this side, which should raise outside
  connection scope (but shouldn't happen in production). Use assert()
  and error() with string errors for those.

- Response/format validation errors, i.e. bugs on the other side or corrupt
  data which shouldn't raise outside connection scope. Use checkp() short
  for "check protocol" for those. For internal protocols that are part of
  the same application and don't run on the Internet you can skip these
  checks and let bugs from the remote side surface as bugs on the local side.

- Request or response data validation errors, which can be retried without
  reconnecting, so they must not raise outside connection scope and must only
  be raised before advancing connection state. Use checknp() short for
  "check non-protocol" for those.

- Network and pipe I/O errors, some of which can be temporary and thus make
  the request retriable (in a new connection, this one must be closed), so
  they must not raise outside connection scope. Use check_net() for network
  errors and check_for('pipe', ...) for pipe errors. At the call site then
  check the error object for deciding when to retry, if to log the error or
  not, etc.

- I/O errors on stable storage, i.e. disk failures which you might want to
  kill the whole app on. Use check_fs() for those.

- CANCEL: a static error that cannot be caught by catch() so it can
  be used to break an epoll thread and it won't be logged as an error.

- CLOSED: a static error for trying to use a closed file. This can be a user
  error but also the result of thread cancellation, so you may want to log
  a trace for it or not.

Following this protocol should easily cut your network code in half, increase
its readability (no more error-handling noise) and its reliability (no more
confusion about when to raise and when not to or forgetting to handle an error).

Expose try_* APIs only when the caller has a meaningful failure path and can
continue using the same owner/resource. For straight-line library code, prefer
raising APIs and let the owner tree handle cleanup; don't add try_* variants
just to avoid stack unwinding.

make_raising(event, f) uses target.error_type for the raised error type. Pass
an explicit errtype only when the error type is a property of the operation
instead of the target object: make_raising(errtype, event, f).

TRACEBACKS

Structured errors don't get a traceback by default unless asked by setting
addtraceback=true in the error object or by setting tracebacks=true in the
target object. This is useful because the uncaught error handler only adds
a traceback for the last raising site, the traces inside pcall are be lost.

]=]

if not ... then require'errors_test'; return end

assert(update) --glue loaded

local
    type, pcall, error, assert =
    type, pcall, error, assert

local error_mt = {
	--this is for Lua's uncaught handler that expects tostring(e) -> s.
	__tostring = function(e)
		return catany(' ', e.target and logarg(e.target)..':',
			e.event and e.event..':', e.traceback or e.message or e.type)
	end,
}
function newerror(e, ...)
	return setmetatable(e, error_mt)
end
local errtypes_table = memoize(function(errtypes)
	return index(collect(words(errtypes)))
end)
function iserror(e, errtypes, message)
	return getmetatable(e) == error_mt
		and (not errtypes or errtypes_table(errtypes)[e.type])
		and (not message or e.message == message)
end

--raise CANCEL to cancel any waiting thread. catch() won't catch it.
CANCEL = newerror{type = 'cancel'}
CLOSED = newerror{type = 'closed'}

local function return_catch(errtypes, ok, ...)
	if ok then return true, ... end
	local e = ...
	if e == CANCEL or type(e) == 'string' then --can't catch these
		error(e, 2)
	end
	if iserror(e, errtypes) then
		return false, e --caught
	end
	error(e)
end

function catch(errtypes, f, ...)
	return return_catch(errtypes, pcall(f, ...))
end

local catch = catch
function try(f, ...)
	return catch(nil, f, ...)
end

function error_for(errtype, target, event, s, ...)
	errtype = errtype or (target and target.error_type)
	assert(type(errtype) == 'string')
	assert(event == nil or type(event) == 'string')
	s = ... ~= nil and _(s, ...) or s
	return newerror{type = errtype, target = target, event = event, message = s,
		addtraceback = istab(target) and target.tracebacks}
end

local function return_raising(target, errtype, event, ret, err, ...)
	if ret then return ret, err, ... end
	if iserror(err) then error(err) end --pass-through structured errors
	if err == 'closed' then error(CLOSED) end --convert 'closed' to CLOSED error
	local e = error_for(errtype, target, event, err, ...)
	error(e)
end
function make_raising(errtype, event, f)
	if type(event) == 'function' then --make_raising(event, f)
		event, f = errtype, event
		errtype = nil
	end
	assert(type(event) == 'string')
	assert(type(f) == 'function')
	return function(target, ...)
		return return_raising(target, errtype, event, f(target, ...))
	end
end

--errno unified messages -----------------------------------------------------
--only list here user errors and recoverable errors.

cdef'char *strerror(int errnum);'

local errno_msgs = {
	[  1] = 'access_denied', --EPERM
	[  2] = 'not_found', --ENOENT, _open_osfhandle(), _fdopen(), open(), mkdir(),
	                     --rmdir(), opendir(), rename(), unlink()
	[  3] = 'no_such_process', --ESRCH, pidfd_open(), kill()
	[  4] = 'interrupted', --EINTR, epoll_wait()
	[  5] = 'io_error', --EIO, read(), write(), fsync()
	[  9] = 'bad_file', --EBADF
	[ 11] = 'again', --EAGAIN/EWOULDBLOCK, flock() with LOCK_NB
	[ 12] = 'out_of_mem', --ENOMEM, mmap()
	[ 13] = 'access_denied', --EACCES, open(), mkdir(), unlink(), rmdir()
	[ 14] = 'bad_address', --EFAULT, syscall got an invalid pointer (fatal)
	[ 16] = 'device_busy', --EBUSY, rmdir() of mount point, flock() races
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
	[ 32] = 'peer_closed', --EPIPE, write(); peer sent FIN
	[ 36] = 'name_too_long', --ENAMETOOLONG, open(), rename(), mkdir()
	[ 38] = 'not_implemented', --ENOSYS, syscall not implemented (fatal: wrong kernel)
	[ 39] = 'not_empty', --ENOTEMPTY, rmdir()
	[ 40] = 'too_many_symlinks', --ELOOP, open(), stat() (too many symlinks in path)
	[ 95] = 'not_supported', --EOPNOTSUPP, fallocate(), accept()
	[122] = 'disk_quota', --EDQUOT, write(), open(), mkdir()
	--socket errors
	[ 64] = 'network_missing', --ENONET, accept()
	[ 71] = 'protocol_error', --EPROTO, accept()
	[ 88] = 'not_socket', --ENOTSOCK, socket operation on non-socket (fatal)
	[ 90] = 'message_too_long', --EMSGSIZE, send(), sendto(); datagram exceeds PMTU
	[ 92] = 'protocol_not_available', --ENOPROTOOPT, accept()
	[ 97] = 'address_family_not_supported', --EAFNOSUPPORT, socket(), connect() with wrong family (fatal)
	[ 98] = 'address_already_in_use', --EADDRINUSE, bind()
	[ 99] = 'address_not_available', --EADDRNOTAVAIL, bind(), connect()
	[100] = 'network_down', --ENETDOWN, connect(), send()
	[101] = 'network_unreachable', --ENETUNREACH, connect(), send()
	[103] = 'connection_aborted', --ECONNABORTED, accept()
	[104] = 'connection_reset', --ECONNRESET, recv(), send(); peer sent RST
	[105] = 'no_buffer_space', --ENOBUFS, send(), sendto()
	[106] = 'already_connected', --EISCONN, connect() on already-connected socket (fatal)
	[107] = 'not_connected', --ENOTCONN, send(), recv(), shutdown() (fatal)
	[110] = 'timeout', --ETIMEDOUT, connect(), recv(); peer is unresponsive
	[111] = 'connection_refused', --ECONNREFUSED, connect()
	[112] = 'host_down', --EHOSTDOWN, accept()
	[113] = 'host_unreachable', --EHOSTUNREACH, connect(), send()
	[114] = 'already_in_progress', --EALREADY, connect() (fatal)
	[115] = 'in_progress', --EINPROGRESS, connect() (handled in scheduler)
}

--TODO: find a way to set addtraceback on typed errors made out of these.
local usage_errors = {
	invalid_argument    = true, --EINVAL
	bad_address         = true, --EFAULT
	bad_file            = true, --EBADF
	not_socket          = true, --ENOTSOCK
	invalid_seek        = true, --ESPIPE
	too_many_fds        = true, --EMFILE
	not_implemented     = true, --ENOSYS
	not_connected       = true, --ENOTCONN
	already_in_progress = true, --EALREADY
	already_connected   = true, --EISCONN
	address_family_not_supported = true, --EAFNOSUPPORT
}

function try_errno(ret, err)
	if ret then return ret end
	err = err or errno()
	local s = errno_msgs[err]
	return ret, s or str(C.strerror(err)) or 'errno#'..err
end
function check_errno(...)
	return assert(try_errno(...))
end

function check_for(errtype, target, event, ret, s, ...)
	if ret then return ret, s, ... end
	if iserror(s) then error(s) end
	return error(error_for(errtype, target, event, s, ...))
end
function check_fs  (target, ...) return check_for('fs'      , target, ...) end
function check_net (target, ...) return check_for('net'     , target, ...) end
function checkp    (target, ret, ...) return check_for('protocol', target, nil, ret, ...) end
function checknp   (target, ret, ...) return check_for('data'    , target, nil, ret, ...) end
