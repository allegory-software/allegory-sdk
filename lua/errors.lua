--[=[

	Structured errors for network protocols and file decoders.

CREATING ERRORS
	newerror(e) -> e                              make an error object
	error_for(target, errtype, fmt, ...) -> e     make a typed structured error
	CANCEL                                        static error that try/catch can't catch
RAISING ERRORS
	raise(target, errtype, fmt, ...)              raise a typed structured error
	check_for(target, errtype, ret, fmt, ...) -> ret  raise typed error if not ret
	check(errtype, event, v, ...) -> v            assert + log + raise structured error
	check_io  (target, ret, fmt, ...) -> ret      check_for with 'io' errtype
	checkp    (target, ret, fmt, ...) -> ret      check_for with 'protocol' errtype
	checknp   (target, ret, fmt, ...) -> ret      check_for with 'content' errtype
	try_errno(ret, err) -> ret | nil,err          map errno and raise on usage errors
	check_errno(ret, err) -> ret                  assert(try_errno(ret, err))
	make_raising(errtype, f) -> f                 turn nil,err-returning f into raising
CATCHING ERRORS
	catch([errtypes], f, ...) -> true,... | false,e   pcall and catch table errors
	try(f, ...) -> true,... | false,e             catch all table errors
	iserror(e, [type], [message]) -> t|f          check if e is an error object

RATIONALE

Structured errors are an enhancement over plain string errors by adding
selective catching while bugs still raise, and providing a context for
the failure to help with freeing resources, recovery or logging. They're
most useful in network protocols and file decoders.

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

- CANCEL: a static error that cannot be caught by catch() so it can
  be used to break an epoll thread and it won't be logged as an error.

Following this protocol should easily cut your network code in half, increase
its readability (no more error-handling noise) and its reliability (no more
confusion about when to raise and when not to or forgetting to handle an error).

Expose try_* APIs only when the caller has a meaningful failure path and can
continue using the same owner/resource. For straight-line library code, prefer
raising APIs and let the owner tree handle cleanup; don't add try_* variants
just to avoid stack unwinding.

TRACEBACKS

Structured errors don't get a traceback by default unless asked by setting
addtraceback=true in the error object. An uncaught structured error will
still get a traceback but it will be the traceback at the last catch site
which is usually not that useful.

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
			e.traceback or e.message or e.type)
	end,
}
function newerror(e, ...)
	return setmetatable(e, error_mt)
end
function iserror(e, errtype, message)
	return getmetatable(e) == error_mt
		and (not errtype or e.type == errtype)
		and (not message or e.message == message)
end

--raise CANCEL to cancel any waiting thread. catch() won't catch it.
CANCEL = newerror{type = 'CANCEL'}

local errtypes_table = memoize(function(errtypes)
	return index(collect(words(errtypes)))
end)
local function return_catch(errtypes, ok, ...)
	if ok then return true, ... end
	local e = ...
	if e == CANCEL or type(e) == 'string' then --can't catch these
		error(e, 2)
	end
	if iserror(e) and (not errtypes or errtypes_table(errtypes)[e.type]) then
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

function error_for(target, errtype, s, ...)
	assert(type(errtype) == 'string')
	s = ... ~= nil and _(s, ...) or s
	return newerror{type = errtype, target = target, message = s,
		addtraceback = target and target.tracebacks}
end

local function return_raising(target, errtype, ret, err, ...)
	if ret then return ret, err, ... end
	if iserror(err) then error(err) end --pass-through structured errors
	error(error_for(target, errtype, err, ...))
end
function make_raising(errtype, f)
	assert(type(errtype) == 'string')
	assert(type(f) == 'function')
	return function(target, ...)
		return return_raising(target, errtype, f(target, ...))
	end
end

function check(errtype, event, v, ...)
	if v then return v end
	assert(type(errtype) == 'string')
	assert(type(event) == 'string')
	local e = error_for(nil, errtype, ...)
	log('ERROR', e.type, event, '%s', e.message)
	e.logged = true
	error(e)
end

--errno unified messages -----------------------------------------------------
--only list here user errors and recoverable errors.

cdef'char *strerror(int errnum);'

local errno_msgs = {
	--fs & proc
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
	[104] = 'connection_reset', --ECONNRESET, recv(), send(); peer sent RST
	[107] = 'not_connected', --ENOTCONN, send(), recv(), shutdown() (fatal)
	[110] = 'timeout', --ETIMEDOUT, connect(), recv(); peer is unresponsive
	[111] = 'connection_refused', --ECONNREFUSED, connect()
	[112] = 'host_down', --EHOSTDOWN, accept()
	[113] = 'host_unreachable', --EHOSTUNREACH, connect(), send()
	[114] = 'already_in_progress', --EALREADY, connect() (fatal)
	[115] = 'in_progress', --EINPROGRESS, connect() (handled in scheduler)
}

function try_errno(ret, err, ...)
	if ret then return ret end
	if type(err) == 'string' then return ret, err end
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
	return ret, s or str(C.strerror(err)) or 'errno#'..err
end
function check_errno(...)
	return assert(try_errno(...))
end

function check_for(target, errtype, ret, s, ...)
	if ret then return ret, s, ... end
	if iserror(s) then error(s) end
	return error(error_for(target, errtype, s, ...))
end
function check_io (target, ...) return check_for(target, 'io'      , ...) end
function checkp   (target, ...) return check_for(target, 'protocol', ...) end
function checknp  (target, ...) return check_for(target, 'content' , ...) end

function raise(target, errtype, s, ...)
	if iserror(s) then error(s) end
	return error(error_for(target, errtype, s, ...))
end
