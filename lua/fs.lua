--[=[

	Filesystem API for Linux.
	Written by Cosmin Apreutesei. Public Domain.

FEATURES
	* utf8 filenames
	* symlinks and hard links
	* named pipes with async I/O
	* cdata buffer-based I/O

TODO
	* API to flip sync-by-default temporarily or even per dir?
	* cp() via copy_file_range() (sync only)
	* realpath() instead of recursive readlink() (faster, more accurate?)
	* get/set btime via statx() (ext4+)

FILE OBJECTS
	[try_]open(opt | path,[mode]) -> f            open file
	f:[try_]close()                               close file
	f:closed() -> true|false                      check if file is closed
	f:onclose(fn)                                 exec fn after the file is closed
	isfile(f [,type]) -> true|false               check if f is a file or pipe
	f.fd -> fd                                    POSIX file descriptor
PIPES
	[try_]pipe([opt]) -> rf, wf                   create an anonymous pipe
	[try_]mkfifo(path|{path=,...}) -> true        create a named pipe
STDIN/OUT/ERR ASYNC PIPES
	std{in|out|err}_async_pipe() -> pipe          get stdin/out/err as async pipes
EVENTFD
	eventfd([initval], [flags]) -> f              create an eventfd
	f:[try_]read_value() -> n                     read counter (async)
	f:[try_]write_value([n])                      add n (default 1) to counter (async)
	EFD_SEMAPHORE                                 flag for semaphore mode
FILE I/O
	f:[try_]read(buf, len) -> readlen             read data from file
	f:[try_]readn(buf, n)                         read exactly n bytes
	f:[try_]readall([ignore_file_size]) -> buf, len    read until EOF into a buffer
	f:[try_]write(s | buf,len) -> true            write data to file
	f:[try_]sync()                                sync kernel write buffer to disk
	f:[try_]seek([whence] [, offset]) -> pos      get/set the file pointer
	f:[try_]skip(n) -> actual_n                   skip bytes
	f:[try_]truncate(size, [opt])                 truncate file and set pointer to end
OPEN FILE ATTRIBUTES
	f:[try_]attr([attr]) -> val|t                 get attribute(s) of open file
	f:[try_]set_attr(attr) -> ok                  set attribute(s) of open file
	f:[try_]size() -> n                           get file size
	f:set_inheritable(true|false)                 change O_CLOEXEC flag
FILE LOCKING
	f:[try_]lock(['r'|'w'], [nonblock])
	f:[try_]unlock([nonblock])
DIRECTORY LISTING
	[try_]ls(dir, [opt]) -> iter() -> name,d | false,err   contents iterator
	  d:[try_]next() -> name,d                    call the iterator explicitly
	  d:[try_]close()                             close iterator
	  d:closed() -> true|false                    check if iterator is closed
	  d:name() -> s                               dir entry's name
	  d:dir() -> s                                dir that was passed to ls()
	  d:path() -> s                               full path of the dir entry
	  d:[try_]attr([attr, ][deref]) -> t|val      get dir entry attribute(s)
	  d:[try_]set_attr(attr, [deref]) -> ok       set dir entry attribute(s)
	  d:is(type, [deref]) -> t|f                  check if dir entry is of type
	  d:[try_]sync()                              sync directory to disk
	scandir(path|{path1,...}, [dive]) -> iter() -> sc     recursive dir iterator
	  sc:close()
	  sc:closed() -> true|false
	  sc:name([depth]) -> s
	  sc:dir([depth]) -> s
	  sc:path([depth]) -> s
	  sc:relpath([depth]) -> s
	  sc:[try_]attr([attr, ][deref]) -> t|val
	  sc:[try_]set_attr(attr, [deref]) -> ok
	  sc:depth([n]) -> n (from 1)
FILE ATTRIBUTES
	[try_]file_attr(path, [attr, ][deref]) -> t|val     get file attribute(s)
	[try_]set_file_attr(path, attr, [deref], [sync]) -> ok  set file attribute(s)
	[try_]file_is(path, [type], [deref]) -> t|f,['not_found'] check if file exists or is of a certain type
	exists                                      = file_is
	checkexists(path, [type], [deref])            assert that file exists
	[try_]mtime(path, [deref]) -> ts              get file's modification time
	[try_]chmod(path, perms) -> path              change a file or dir's permissions
	[try_]chown(path, [uid], [gid]) -> path       change a file or dir's owner and/or group
FILESYSTEM OPS
	cwd() -> path                                 get current working directory
	abspath(path[, cwd]) -> path                  convert path to absolute path
	startcwd() -> path                            get the cwd that process started with
	[try_]chdir(path)                             set current working directory
	[try_]mkdir(dir, [recursive], [perms], [sync]) -> dir   make directory
	[try_]rmfile(path) -> path                    remove file
	[try_]rmdir(path) -> path                     remove empty directory
	[try_]rm_rf(path) -> path                     like `rm -rf`
	[try_]mkdirs(file, [perms], [sync]) -> file   make file's dir
	[try_]rename(old_path, new_path, [dst_dirs_perms], [sync])   rename/move file or dir on the same filesystem
	[try_]sync_dir(dir)                           make fs changes inside dir durable
SYMLINKS & HARDLINKS
	[try_]symlink(symlink, path, [replace], [sync])  create a symbolic link for a file or dir
	[try_]hardlink(hardlink, path, [sync])        create a hard link for a file
	[try_]readlink(path, [maxdepth]) -> path      dereference a symlink recursively
COMMON PATHS
	homedir() -> path                             get current user's home directory
	tmpdir() -> path                              get the temporary directory
	exefile() -> path                             get the full path of the running executable
	exedir() -> path                              get the directory of the running executable
	appdir([appname]) -> path                     get the current user's app data dir
	scriptdir() -> path                           get the directory of the main script
	vardir() -> path                              get script's private r/w directory
	varpath(...) -> path                          get vardir-relative path
LOW LEVEL
	file_wrap_fd(fd, opt) -> f                    wrap opened file descriptor
FILESYSTEM INFO
	fs_info(path) -> {size=, free=}               get free/total disk space for a path
HI-LEVEL APIs
	[try_]load[_tobuffer](path, [default], [ignore_fsize]) -> buf,len  read file to string or buffer
	[try_]save(path, v | buf,len | read, [file_perms], [dir_perms], [sync]) atomic save value/buffer/reader
	file_saver(path, [file_perms], [dir_perms])
		-> try_write(v | buf,len | nil,0) -> ok, err
	[try_]touch(file, [mtime])                    create file or update mtime
	gen_id(name, [start=1]) -> id                 durable, atomic, concurrent autoincrement
CONFIG
	vardir        default: scriptdir()..'/var'

FILE ATTRIBUTES --------------------------------------------------------------

 attr     | R/W | Description
 ---------+-----+--------------------------------
 type     | r   | file type (see below)
 size     | r   | file size
 atime    | rw  | last access time (seldom correct)
 mtime    | rw  | last contents-change time
 ctime    | r   | last metadata-or-contents-change time
 target   | r   | symlink's target (nil if not symlink)
 perms    | rw  | permissions
 uid      | rw  | user id or name
 gid      | rw  | group id or name
 dev      | r   | device id containing the file
 inode    | r   | inode number (int64_t)
 nlink    | r   | number of hard links
 rdev     | r   | device id (if special file)
 blksize  | r   | block size for I/O
 blocks   | r   | number of 512B blocks allocated

On the table above, `r` means that the attribute is read/only and `rw` means
that the attribute can be changed. Attributes can be queried via
f:attr(), file_attr() and d:attr(), and changed via
f:set_attr(), set_file_attr() and d:set_attr().

NOTE: File sizes and offsets are Lua numbers not 64bit ints, so they can hold
at most 8KTB.

FILE TYPES -------------------------------------------------------------------

 name      | description
 ----------+---------------------------------
 file      | file is a regular file
 dir       | file is a directory
 symlink   | file is a symlink
 blockdev  | file is a block device
 chardev   | file is a character device
 pipe      | file is a pipe
 socket    | file is a socket
 unknown   | file type unknown

FILE OBJECTS -----------------------------------------------------------------

[try_]open(opt | path,[mode]) -> f

Open/create a file for reading/writing/appending.

mode:

	'r'  : open; allow reading only (default)
	'r+' : open; allow reading and writing
	'w'  : open and truncate or create; allow writing only
	'w+' : open and truncate or create; allow reading and writing
	'a'  : open or create; allow appending only
	'a+' : open or create; allow reading and appending only

	... or an options table with platform-specific options which represent
	OR-ed bitmask flags which must be given either as 'foo bar ...',
	{foo=true, bar=true} or {'foo', 'bar'}.
	All fields and flags are documented in the code.

 field       | reference                            | default
 ------------+--------------------------------------+----------
 async       | async mode                           | false
 flags       | bitflags(flags)                      | 'rdonly'
 perms       | unixperms_parse(perms)               | '0666' / 'rwx'
 inheritable | sub-processes inherit the fd         | false
 quiet       | quiet logging                        | false

PIPES ------------------------------------------------------------------------

[try_]pipe([opt]) -> rf, wf

	Create an anonymous (unnamed) pipe. Return two files corresponding to the
	read and write ends of the pipe.

	Options:
		* inheritable, read_inheritable, write_inheritable: make one
		or both pipes inheritable by sub-processes.

[try_]mkfifo(path, [perms]) -> true[,'already_exists']

	Create a named pipe.

FILE I/O ---------------------------------------------------------------------

f:[try_]read(buf, len) -> readlen | 0,'eof'

	Read data from file. Returns (and keeps returning) 0,'eof' on EOF
	or broken pipe.

f:[try_]readn(buf, len) -> true

	Read data from file until len is read.
	Partial reads are signaled with nil,err,readlen.

f:[try_]readall([ignore_file_size]) -> buf, len

	Read until EOF into a buffer.
	If ignore_file_size is true, the file size is not checked and the
	read is done in chunks until EOF (true for pipes, must be set true
	explicity for virtual files).

f:[try_]write(s | buf,len) -> true

	Write data to file.
	Partial writes are signaled with nil,err,writelen.

f:[try_]sync()

	Sync kernel write buffer to disk.

f:setexpires(clock|nil, ['r'|'w'])
f:settimeout(seconds|nil, ['r'|'w'])

	Set or clear async expire time or timeout (see sock.lua).

f:[try_]seek([whence] [, offset]) -> pos

	Get/set the file pointer. Same semantics as standard io module seek
	i.e. whence defaults to 'cur' and offset defaults to 0.

f:[try_]truncate(size, [opt])

	Truncate file to given size and move the current file pointer to EOF.
	This can be done both to shorten a file and thus free disk space, or to
	preallocate disk space to be subsequently filled (eg. when downloading a file).

	opt is an optional string which can contain any of the words
	"fallocate" (call fallocate()) and "fail" (do not call ftruncate()
	if fallocate() fails: return an error instead). The problem with calling
	ftruncate() if fallocate() fails is that on most filesystems, that
	creates a sparse file which doesn't help if what you want is to actually
	reserve space on the disk, hence the fail option. The default is
	'fallocate fail' which should never create a sparse file, but it can be
	slow on some file systems (when it's emulated) or it can just fail
	(like on virtual filesystems).

	Btw, seeking past EOF and writing something there will also create a
	sparse file, so there's no easy way out of this complexity.

OPEN FILE ATTRIBUTES ---------------------------------------------------------

	f:[try_]attr([attr]) -> val|t
	f:[try_]set_attr(attr) -> ok

		Get attribute(s) of open file. attr can be:
	* nothing/nil: get the values of all attributes in a table.
	* string: get the value of a single attribute.

		f:[try_]set_attr(attr)

		Set one or more attributes from a table.

DIRECTORY LISTING ------------------------------------------------------------

[try_]ls([dir], [opt]) -> d, next

	Directory contents iterator. dir defaults to '.'.
	opt is a string that can include:
		".."   :  include . and .. dir entries (excluded by default).

	USAGE

		for name, d in try_ls() do
			if not name then
				print('error: ', d)
				break
			end
			print(d:attr'type', name)
		end

	Always include the `if not name` condition when iterating. The iterator
	doesn't raise any errors. Instead it returns false,err as the
	last iteration when encountering an error. Initial errors from calling
	ls() (eg. 'not_found') are passed to the iterator also, so the
	iterator must be called at least once to see them.

	d:[try_]next() -> name,d | false,err | nil

		Call the iterator explicitly.

	d:close()

		Close the iterator. Always call d:close() before breaking the for loop
		except when it's an error (in which case `d` holds the error message).

	d:closed() -> true|false

		Check if the iterator is closed.

	d:name() -> s

		The name of the current file or directory being iterated.

	d:dir() -> s

		The directory that was passed to ls().

	d:path() -> s

		The full path of the current dir entry (d:dir() combined with d:name()).

	d:[try_]attr([attr, ][deref]) -> t|val

		Get dir entry attribute(s).

		deref means return the attribute(s) of the symlink's target if the file is
		a symlink (deref defaults to true!). When deref=true, even the 'type'
		attribute is the type of the target, so it will never be 'symlink'.

		Some attributes for directory entries are free to get (but not for symlinks
		when deref=true) meaning that they don't require a system call for each
		file, notably type and inode.

	d:[try_]set_attr(attr, [deref]) -> ok

		Set dir entry attribute(s).

	d:is(type, [deref]) -> true|false

		Check if dir entry is of type.

scandir(path|{path1,...}, [dive]) -> iter() -> sc

	Recursive dir walker. All sc methods return nil,err if an error occured
	on the current dir entry, but the iteration otherwise continues, unless
	you call close() to stop it.
	* depth arg can be 0=sc:depth(), 1=first-level, -1=parent-level, etc.
	* dive(sc) -> true is an optional filter to skip from diving into dirs.

	sc:close()
	sc:closed() -> true|false
	sc:name([depth]) -> s
	sc:dir([depth]) -> s
	sc:path([depth]) -> s
	sc:relpath([depth]) -> s
	sc:[try_]attr([attr, ][deref]) -> t|val
	sc:[try_]set_attr(attr, [deref]) -> ok
	sc:depth([n]) -> n (from 1)

FILE ATTRIBUTES --------------------------------------------------------------

[try_]file_attr(path, [attr, ][deref]) -> t|val

	Get a file's attribute(s) given its path in utf8.

[try_]set_file_attr(path, attr, [deref], [sync]) -> ok

	Set a file's attribute(s) given its path in utf8.

[try_]file_is(path, [type], [deref]) -> true|false, ['not_found']

	Check if file exists or if it is of a certain type.

FILESYSTEM OPERATIONS --------------------------------------------------------

mkdir(path, [recursive], [perms])

	Make directory. perms is passed to unixperms_parse().

	NOTE: In recursive mode, if the directory already exists this function
	returns true,'already_exists'.

rmfile(path)
rmdir(path)
rm_rf(path)

	Remove files and directories.

[try_]rename(path, new_path, [sync])

	Rename/move a file on the same filesystem.

	This operation is atomic.

SYMLINKS & HARDLINKS ---------------------------------------------------------

[try_]symlink(symlink, path, [replace='replace'], [sync])

	Create a symbolic link for a file or dir. Pass replace='replace'
	to replace the target if the symlink already exists.

[try_]hardlink(hardlink, path)

	Create a hard link for a file.

[try_]readlink(path, [maxdepth]) -> path

	Dereference a symlink recursively. The result can be an absolute or
	relative path which can be valid or not.

PROGRAMMING NOTES ------------------------------------------------------------

### Raising vs non-raising (try_*()) methods

Raising methods close the file on errors, but the try_*() variants do not!

### Async I/O

Pipes are opened in async mode by default, which uses the sock scheduler
to multiplex the I/O which means that all I/O must be performed inside
sock threads.

### The deref arg

The deref arg is true by default, meaning that by default, symlinks are
followed recursively and transparently where this option is available.

### Filesystem operations are non-atomic

Most filesystem operations are non-atomic (unless otherwise specified) and
thus prone to race conditions. This library makes no attempt at fixing that
and in fact it ignores the issue entirely in order to provide a simpler API.
So never work on the (same part of the) filesystem from multiple processes
without proper locking (watch Niall Douglas's "Racing The File System"
presentation for more info).

### Syncing does not protect against power loss

Syncing does not protect against power loss on consumer hard drives because
they usually don't have non-volatile write caches (and disabling the write
cache is generally not possible nor feasible). The only way to ensure
durability after sync is to use drives with Power Loss Protection (PLP).

### File locking doesn't always work

File locking APIs only work right on disk mounts and are buggy or non-existent
on network mounts (NFS, Samba).

### Async disk I/O

Async disk I/O is a no-op on Linux with epoll, and we don't support io_uring.
If your app is disk-bound just bite the bullet and make a thread pool.
Read Arvid Norberg's article[1] for more info.

[1] https://blog.libtorrent.org/2012/10/asynchronous-disk-io/

]=]

if not ... then require'fs_test'; return end

require'glue'
require'path'
require'unixperms'
require'epoll'

--POSIX does not define an ABI and platfoms have different cdefs thus we have
--to limit support to the platforms and architectures we actually tested for.
assert(Linux, 'platform not Linux')

local
	C, min, max, floor, ceil, ln, push, pop, istab, isstr =
	C, min, max, floor, ceil, ln, push, pop, istab, isstr

local
	cast, bor, band, bnot, shl, check, check_errno =
	cast, bor, band, bnot, shl, check, check_errno

local file = {}; file.__index = file --file object methods
local dir = {}; dir.__index = dir --dir listing object methods

--types, consts, utils -------------------------------------------------------

cdef[[
typedef unsigned int mode_t;
typedef unsigned int uid_t;
typedef unsigned int gid_t;
typedef size_t time_t;
typedef int64_t off64_t;

int fcntl(int fd, int cmd, ...); // fallocate, set_inheritable
long syscall(int number, ...); // stat, fstat, lstat
]]

local ENOENT =  2
local EINVAL = 22

local cbuf = new'char[4096]'

local default_file_perms = tonumber('644', 8)
local default_dir_perms  = tonumber('755', 8)

local function parse_perms(s, base)
	if isstr(s) then
		return unixperms_parse(s, base)
	else --pass-through
		return s, false
	end
end

--open/close -----------------------------------------------------------------

cdef[[
int open(const char *pathname, int flags, mode_t mode);
int close(int fd);
]]

local o_bits = {
	rdonly    = 0x000000, --access: read only
	wronly    = 0x000001, --access: write only
	rdwr      = 0x000002, --access: read + write
	accmode   = 0x000003, --access: ioctl() only
	append    = 0x000400, --append mode: write() at eof
	trunc     = 0x000200, --truncate the file on opening
	creat     = 0x000040, --create if not exist
	excl      = 0x000080, --create or fail (needs 'creat')
	nofollow  = 0x020000, --fail if file is a symlink
	directory = 0x010000, --open if directory or fail
	async     = 0x002000, --enable signal-driven I/O
	sync      = 0x101000, --enable _file_ sync
	fsync     = 0x101000, --'sync'
	dsync     = 0x001000, --enable _data_ sync
	noctty    = 0x000100, --prevent becoming ctty
	direct    = 0x004000, --don't cache writes
	noatime   = 0x040000, --don't update atime
	rsync     = 0x101000, --'sync'
	path      = 0x200000, --open only for fd-level ops
	tmpfile   = 0x410000, --create anon temp file (Linux 3.11+)
}

local open_mode_opt = {
	['r' ] = {flags = 'rdonly'},
	['r+'] = {flags = 'rdwr'},
	['w' ] = {flags = 'creat wronly trunc'},
	['w+'] = {flags = 'creat rdwr trunc'},
	['a' ] = {flags = 'creat wronly append'},
	['a+'] = {flags = 'creat rdwr append'},
	['rw'] = {flags = 'creat rdwr'}, --non-standard but useful for updating
}

local F_GETFL     = 3
local F_SETFL     = 4
local O_NONBLOCK  = 0x000800 --async I/O
local O_CLOEXEC   = 0x080000 --close-on-exec

local F_GETFD = 1
local F_SETFD = 2
local FD_CLOEXEC = 1

local function fcntl_set_flags_func(GET, SET)
	return function(f, mask, bits)
		local cur_bits = C.fcntl(f.fd, GET)
		assert(check_errno(cur_bits ~= -1))
		local bits = setbits(cur_bits, mask, bits)
		assert(check_errno(C.fcntl(f.fd, SET, cast('int', bits)) == 0))
	end
end
local fcntl_set_fl_flags = fcntl_set_flags_func(F_GETFL, F_SETFL)
local fcntl_set_fd_flags = fcntl_set_flags_func(F_GETFD, F_SETFD)

function file_wrap_fd(fd, opt)

	local f = object(file, {
		fd = assert(fd),
		seek = repl(opt.type == 'file' and not opt.async, true, nil),
		debug_prefix = opt.debug_prefix,
		w = 0, r = 0,
	}, opt)

	if f.async then
		fcntl_set_fl_flags(f, O_NONBLOCK, O_NONBLOCK)
		local ok, err = epoll_add(f)
		if not ok then
			f:close()
			return nil, err
		end
	end

	live(f, f.path or f.name or f.type or '')

	return f
end

function isfile(f, type)
	local mt = getmetatable(f)
	return istab(mt) and rawget(mt, '__index') == file and (not type or f.type == type)
end

function file.closed(f)
	return f.fd == -1
end

function file.close(f)
	if f:closed() then return true end
	if f.async then
		epoll_remove(f)
	end
	local ok, err = check_errno(C.close(f.fd) == 0)
	f.fd = -1 --fd is gone no matter the error.
	if f._after_close then
		f:_after_close()
	end
	if f.async then
		epoll_cancel(f, 'closed')
	end
	--liveadd(f, 'r:%d w:%d', f.r, f.w)
	--f.quiet and '' or 'note', 'fs', 'closed', '%-4s r:%d w:%d', f, f.r, f.w)
	live(f, nil, 'r:%d w:%d', f.r, f.w)
	check_io(nil, ok, err)
	return true
end
file.try_close = protect_io(file.close)

function file.onclose(f, fn)
	after(f, '_after_close', fn)
end

function file.set_inheritable(f, inheritable)
	if f.fd == -1 then return nil, 'closed' end
	fcntl_set_fd_flags(f, FD_CLOEXEC, inheritable and 0 or FD_CLOEXEC)
end

function try_open(path, mode)
	local opt = istab(path) and update({}, path) or {path = path, mode = mode}
	opt.type = opt.type or 'file'
	opt.debug_prefix = 'f'
	assert(isstr(opt.path), 'path required')
	if opt.mode then
		local mode_opt = assertf(open_mode_opt[opt.mode],
			'invalid open mode: %s', opt.mode)
		merge(opt, mode_opt)
	end
	assert(not (opt.async and opt.type == 'file'),
		'open(): files cannot be opened async')
	local flags = bitflags(opt.flags or 'rdonly', o_bits)
	flags = bor(flags, opt.async and O_NONBLOCK or 0)
	if not opt.inheritable then
		flags = bor(flags, O_CLOEXEC)
	end
	local wo = getbit(flags, o_bits.wronly)
	local rw = getbit(flags, o_bits.rdwr)
	assert(not (wo and rw),
		'open(): conflicting flags: wronly + rdwr')
	if opt.quiet == nil then opt.quiet = not (wo or rw) end
	local perms = parse_perms(opt.perms) or default_file_perms
	local c_open = opt.open or C.open
	local fd = c_open(opt.path, flags, perms)
	if fd == -1 then
		return check_errno()
	end
	local f, err = file_wrap_fd(fd, opt)
	if not f then
		return nil, err
	end
	log(f.quiet and '' or 'note', 'fs', 'open',
		'%-4s %s %s fd=%d', f, wo and 'wo' or rw and 'rw' or 'r', opt.path, fd)
	return f
end

function open(arg1, ...)
	local f, err = try_open(arg1, ...)
	local path = isstr(arg1) and arg1 or arg1.path
	return check('fs', 'open', f, '%s: %s', path, err)
end

file.check_io = check_io
file.checkp   = checkp

function file.try_skip(f, n)
	local i, err = f:try_seek('cur', 0); if not i then return nil, err end
	local j, err = f:try_seek('cur', n); if not j then return nil, err end
	return j - i
end
file.skip = unprotect_io(file.try_skip)

file.setexpires  = epoll_setexpires
file.settimeout  = epoll_settimeout
file.cancel_recv = epoll_cancel_recv
file.cancel_send = epoll_cancel_send
file.cancel      = epoll_cancel

--pipes ----------------------------------------------------------------------

cdef[[
int pipe2(int[2], int flags);
int mkfifo(const char *pathname, mode_t mode);
]]

function try_mkfifo(path, perms)
	perms = parse_perms(perms) or default_file_perms
	local ok, err = check_errno(C.mkfifo(path, perms) == 0)
	if not ok and err ~= 'already_exists' then return nil, err, perms end
	log('note', 'fs', 'mkfifo', '%s %o', path, perms)
	if err == 'already_exists' then return true, err, perms end
	return ok, nil, perms
end
function mkfifo(path, perms)
	local ok, err, perms = try_mkfifo(path, perms)
	check('fs', 'mkfifo', ok, '%s %o', path, perms)
	if ok then return ok end
	return ok, err
end

function try_pipe(opt) --unnamed pipe
	opt = opt or empty
	local fds = new'int[2]'
	local flags = not opt.inheritable and O_CLOEXEC or 0
	local ok = C.pipe2(fds, flags) == 0
	if not ok then return check_errno() end
	local async = repl(opt.async, nil, true)
	local r_async = repl(opt.async_read , nil, async)
	local w_async = repl(opt.async_write, nil, async)
	local rf, err1 = file_wrap_fd(fds[0], merge({type = 'pipe', async = r_async, debug_prefix = 'pipe.r'}, opt))
	local wf, err2 = file_wrap_fd(fds[1], merge({type = 'pipe', async = w_async, debug_prefix = 'pipe.w'}, opt))
	if not (rf and wf) then
		if rf then rf:try_close() end
		if wf then wf:try_close() end
		return nil, err1 or err2
	end
	if not opt.inheritable then
		if opt. read_inheritable then rf:set_inheritable(true) end
		if opt.write_inheritable then wf:set_inheritable(true) end
	end
	log(rf.quiet and '' or 'note',
		'fs', 'pipe', 'r=%s%s w=%s%s rfd=%d wfd=%d',
		rf, rf.async and '' or ',blocking',
		wf, wf.async and '' or ',blocking', rf.fd, wf.fd)
	return rf, wf
end
function pipe(opt)
	local rf, wf = try_pipe(opt)
	check('fs', 'pipe', rf, '%s', wf)
	return rf, wf
end

stdin_async_pipe  = memoize(function() return file_wrap_fd(0, {type = 'pipe', async = true, debug_prefix = '<stdin>' }) end)
stdout_async_pipe = memoize(function() return file_wrap_fd(1, {type = 'pipe', async = true, debug_prefix = '<stdout>'}) end)
stderr_async_pipe = memoize(function() return file_wrap_fd(2, {type = 'pipe', async = true, debug_prefix = '<stderr>'}) end)

--eventfd --------------------------------------------------------------------

cdef'int eventfd(unsigned int initval, int flags);'

EFD_SEMAPHORE = 1

local function try_eventfd(initval, flags)
	local fd = C.eventfd(initval or 0, bor(O_CLOEXEC, flags or 0))
	if fd == -1 then return check_errno() end
	local f, err = file_wrap_fd(fd, {
		type = 'eventfd', async = true, debug_prefix = 'E', quiet = true,
	})
	if not f then
		C.close(fd)
		return nil, err
	end
	local rbuf = new'uint64_t[1]'
	local wbuf = new'uint64_t[1]'
	f.try_read_value = function(f)
		local len, err = f:try_readn(rbuf, 8)
		if not len then return nil, err end
		return tonumber(rbuf[0])
	end
	f.read_value = unprotect_io(f.try_read_value)
	f.try_write_value = function(f, n)
		wbuf[0] = n or 1
		local ok, err = f:try_write(wbuf, 8)
		if not ok then return nil, err end
		return true
	end
	f.write_value = unprotect_io(f.try_write_value)
	return f
end
function eventfd(...)
	return assert(try_eventfd(...))
end

--i/o ------------------------------------------------------------------------

cdef[[
ssize_t read(int fd, void *buf, size_t count);
ssize_t write(int fd, const void *buf, size_t count);
int fsync(int fd);
int64_t lseek(int fd, int64_t offset, int whence) asm("lseek64");
]]


local file_async_read = make_async('r', true, function(self, buf, len)
	return tonumber(C.read(self.fd, buf, len))
end)

local file_async_write = make_async('w', true, function(self, buf, len)
	return tonumber(C.write(self.fd, buf, len))
end)

--NOTE: to read many small pieces use a pbuffer instead, this will crawl!
function file.try_read(f, buf, sz)
	if f.fd == -1 then return nil, 'closed' end
	if sz == 0 then return 0 end --mask out null reads
	if f.async then
		local n, err = file_async_read(f, buf, sz)
		if not n then return nil, err end
		if n == 0 then return 0, 'eof' end
		return n
	else
		local n = C.read(f.fd, buf, sz)
		if n == 0 then return 0, 'eof' end
		if n == -1 then return check_errno() end
		n = tonumber(n)
		f.r = f.r + n
		return n
	end
end
file.read = unprotect_io(file.try_read)

function file.try_sync(f)
	if f.fd == -1 then return nil, 'closed' end
	local ok = C.fsync(f.fd) == 0
	if not ok and errno() == EINVAL then return true end --vboxfs
	return check_errno(ok)
end
file.sync = unprotect_io(file.try_sync)

--synonims for familiarity with Lua's io module.
file.try_flush = file.try_sync
file.flush = file.sync

local whences = {set = 0, cur = 1, ['end'] = 2} --FILE_*
function file.try_seek(f, whence, offset)
	if f.fd == -1 then return nil, 'closed' end
	if tonumber(whence) and not offset then --middle arg missing
		whence, offset = 'cur', tonumber(whence)
	end
	whence = whence or 'cur'
	offset = tonumber(offset or 0)
	whence = assertf(whences[whence], 'invalid whence: "%s"', whence)
	local offs = C.lseek(f.fd, offset, whence)
	if offs == -1 then return check_errno() end
	return tonumber(offs)
end
file.seek = unprotect_io(file.try_seek)

--NOTE: to write many small pieces use a pbuffer instead, this will crawl!
function file.try_write(f, buf, sz)
	if f.fd == -1 then return nil, 'closed' end
	sz = sz or #buf
	if sz == 0 then return true end --mask out null writes
	local sz0 = sz
	while true do
		local len, err
		if f.async then
			len, err = file_async_write(f, buf, sz)
		else
			len = C.write(f.fd, buf, sz)
			if len == -1 then
				len, err = check_errno()
			else
				len = tonumber(len)
				f.w = f.w + len
			end
		end
		if len == sz then
			break
		elseif not len then --short write
			return nil, err, sz0 - sz
		end
		assert(len > 0)
		if isstr(buf) then --only make pointer on the rare second iteration.
			buf = cast(u8p, buf)
		end
		buf = buf + len
		sz  = sz  - len
	end
	return true
end
file.write = unprotect_io(file.try_write)

--NOTE: to read many small pieces use a pbuffer instead, this will crawl!
function file.try_readn(f, buf, sz)
	local sz0 = sz
	local buf = cast(u8p, buf)
	while sz > 0 do
		local len, err = f:try_read(buf, sz)
		if not len or err == 'eof' then --short read
			return nil, err, sz0 - sz
		end
		buf = buf + len
		sz  = sz  - len
	end
	return true
end
file.readn = unprotect_io(file.try_readn)

local non_nil_ptr = cast(voidp, 1) --1 because voidp(0) == nil in LuaJIT!
function file.try_readall(f, ignore_file_size)
	local left = 1/0 --unknown
	if f.seek and not ignore_file_size then --find filesize to allocate once
		local size, err = f:try_attr'size'; if not size then return nil, err end
		local offset, err = f:try_seek(); if not offset then return nil, err end
		left = size - offset
		if left == 0 then return non_nil_ptr, 0 end --avoid returning nil-y,0
	end
	local b = string_buffer()
	local readahead_size = 16 * 1024
	while left > 0 do
		--NOTE: reserve(>0) is enough to ensure b:ref() doesn't return nil,0!
		local buf, sz = b:reserve(min(left, readahead_size))
		local len, err = f:try_read(buf, sz)
		if not len then return nil, err, b:ref() end
		if err == 'eof' then return b:ref() end
		b:commit(len)
		left = left - len
	end
	return b:ref()
end
file.readall = unprotect_io(file.try_readall)

--truncate -------------------------------------------------------------------

cdef[[
int ftruncate(int fd, int64_t length);
int fallocate64(int fd, int mode, off64_t offset, off64_t len);
]]

--NOTE: ftruncate() creates a sparse file (and so would seeking past size
--and writing there), so we need to call fallocate() to actually reserve
--any disk space. OTOH, fallocate() is only efficient on some file systems.

local function fallocate(f, size)
	local cursize, err = f:try_attr'size'
	if not cursize then return nil, err end
	if size <= cursize then return true end
	local ok, err = check_errno(C.fallocate64(f.fd, 0, 0, size) == 0)
	if ok then return true end
	if err == 'disk_full' then
		--when fallocate() fails because disk is full, a file is still
		--created filling up the entire disk, so shrink back the file
		--to its original size. this is courtesy: we don't check to see
		--if this fails or not, and we return the original error code.
		C.ftruncate(f.fd, cursize)
	end
	return nil, err
end

--NOTE: lseek() is not defined for shm_open()'ed fds, that's why we ask
--for a size arg. The seek() behavior is just for compat with Windows.
function file.try_truncate(f, size, opt)
	assert(isnum(size), 'size expected')
	if f.fd == -1 then return nil, 'closed' end
	opt = opt or 'fallocate fail' --avoid creating a sparse file
	if not f.shm then
		if opt:find'fallocate' then
			local ok, err = fallocate(f, size)
			if not ok and opt:find'fail' then
				return nil, err
			end
		end
	end
	local ok, err = check_errno(C.ftruncate(f.fd, size) == 0)
	if not ok then return nil, err end
	if not f.shm then
		return f:try_seek('set', size)
	end
	return true
end
file.truncate = unprotect_io(file.try_truncate)

--filesystem operations ------------------------------------------------------

cdef[[
int mkdir(const char *pathname, mode_t mode);
int rmdir(const char *pathname);
int chdir(const char *path);
char *getcwd(char *buf, size_t size);
int unlink(const char *pathname);
int rename(const char *oldpath, const char *newpath);
int link(const char *oldpath, const char *newpath);
int symlink(const char *oldpath, const char *newpath);
ssize_t readlink(const char *path, char *buf, size_t bufsize);
]]

function cwd()
	local ok, err = check_errno(C.getcwd(cbuf, 4096) ~= nil)
	check('fs', 'cwd', ok, 'cwd: %s', err)
	return str(cbuf)
end
startcwd = memoize(cwd)

function try_chdir(dir)
	startcwd()
	local ok, err = check_errno(C.chdir(dir) == 0)
	if not ok then return false, err end
	log('', 'fs', 'chdir', '%s', dir)
	return true
end
function chdir(dir)
	local ok, err = try_chdir(dir)
	if ok then return dir, err end
	check('fs', 'chdir', ok, '%s: %s', dir, err)
end

local function _try_mkdir(path, perms)
	perms = perms and parse_perms(perms) or default_dir_perms
	local ok, err = check_errno(C.mkdir(path, perms) == 0)
	if not ok then
		if err == 'already_exists' then return true, err end
		return false, err
	end
	log('note', 'fs', 'mkdir', '%s%s%s',
		path, perms and ' ' or '', perms or '')
	return true
end

--NOTE: sync defaults to true unlike most standard libraries.
--Set it to false only if you notice slowness or for cache dirs, etc.
function try_mkdir(dir, recursive, perms, sync)
	if recursive then
		dir = path_normalize(dir, true, true) --avoid creating dir in dir/.. sequences
		if not dir or dir == '.' then
			return nil, 'invalid_path'
		end
		local t = {}
		while true do
			local ok, err = _try_mkdir(dir, perms)
			if ok then break end
			if err ~= 'not_found' then --other problem
				return ok, err
			end
			push(t, dir)
			dir = dirname(dir)
			if not dir or dir == '.' or dir == '/' then
				return ok, err
			end
		end
		while #t > 0 do
			local dir = pop(t)
			local ok, err = _try_mkdir(dir, perms)
			if not ok then return ok, err end
			if sync ~= false and err ~= 'already_exists' then
				local ok, err = try_sync_dir(dirname(dir))
				if not ok then return ok, err end
			end
		end
		return true
	else
		local ok, err = _try_mkdir(dir, perms)
		if not ok then return ok, err end
		if sync ~= false and err ~= 'already_exists' then
			local sok, serr = try_sync_dir(dirname(dir))
			if not sok then return sok, serr end
		end
		return ok, err
	end
end
function mkdir(dir, recursive, perms, sync)
	local ok, err = try_mkdir(dir, recursive, perms, sync)
	if ok then return dir, err end
	check('fs', 'mkdir', ok, '%s%s%s: %s', dir, perms and ' ' or '', perms or '', err)
end

function try_mkdirs(filepath, perms, sync)
	local dir = dirname(filepath)
	if dir and dir ~= '.' and dir ~= '/' then
		local ok, err = try_mkdir(dir, true, perms, sync)
		if not ok then return nil, err end
	end
	return filepath
end
function mkdirs(filepath, perms, sync)
	local dir = dirname(filepath)
	if dir then
		mkdir(dir, true, perms, sync)
	end
	return filepath
end

function try_rmdir(dir, sync)
	local ok, err = check_errno(C.rmdir(dir) == 0)
	if not ok then
		return err == 'not_found', err
	end
	if sync ~= false then
		local ok, err = try_sync_dir(dirname(dir))
		if not ok then return false, err end
	end
	log('note', 'fs', 'rmdir', '%s', dir)
	return true
end
function rmdir(dir, sync)
	local ok, err = try_rmdir(dir, sync)
	if ok then return dir, err end
	check('fs', 'rmdir', ok, '%s: %s', dir, err)
end

function try_rmfile(file, sync)
	local ok, err = check_errno(C.unlink(file) == 0)
	if not ok then
		if err == 'not_found' then return true, err end
		return false, err
	end
	if sync ~= false then
		local ok, err = try_sync_dir(dirname(file))
		if not ok then return false, err end
	end
	log('note', 'fs', 'rmfile', '%s', file)
	return true
end
function rmfile(path, sync)
	local ok, err = try_rmfile(path, sync)
	if ok then return path, err end
	check('fs', 'rmfile', ok, '%s: %s', path, err)
end
function must_rmfile(path, sync)
	local ok, err = try_rmfile(path, sync)
	if err == 'not_found' then ok = false end
	if ok then return path end
	check('fs', 'rmfile', ok, '%s: %s', path, err)
end

function rm_rf(path, sync)
	local ok, err = try_rm_rf(path, sync)
	if ok then return path, err end
	check('fs', 'rm_rf', ok, '%s: %s', path, err)
end

local function try_rmdir_recursive(dir, sync)
	for file, d in try_ls(dir) do
		if not file then
			if d == 'not_found' then return true, d end
			return file, d
		end
		local filepath = indir(dir, file)
		local filetype, err = d:try_attr('type', false)
		if not filetype then d:try_close(); return nil, err end
		if filetype == 'dir' then
			local ok, err = try_rmdir_recursive(filepath, false)
			if not ok then d:try_close(); return ok, err end
		elseif filetype then
			local ok, err = try_rmfile(filepath, false)
			if not ok then d:try_close(); return ok, err end
		end
	end
	return try_rmdir(dir, sync)
end
function try_rm_rf(path, sync)
	--not recursing if the dir is a symlink, unless it has an endsep!
	if not path:ends'/' then
		local type, err = try_file_attr(path, 'type', false)
		if not type then
			if err == 'not_found' then return true, err end
			return nil, err
		end
		if type == 'symlink' then
			return try_rmfile(path, sync)
		end
	end
	return try_rmdir_recursive(path, sync)
end

function try_rename(old_path, new_path, dst_dirs_perms, sync)
	if dst_dirs_perms ~= false then
		local ok, err = try_mkdirs(new_path, dst_dirs_perms, sync)
		if not ok then return false, err end
	end
	local ok, err = check_errno(C.rename(old_path, new_path) == 0)
	if not ok then return false, err end
	if sync ~= false then
		local d1 = dirname(old_path)
		local d2 = dirname(new_path)
		local ok, err = try_sync_dir(d1)
		if not ok then return ok, err end
		if d2 ~= d1 then
			local ok, err = try_sync_dir(d2)
			if not ok then return ok, err end
		end
	end
	log('note', 'fs', 'mv', 'old: %s\nnew: %s', old_path, new_path)
	return true
end
function rename(old_path, new_path, perms)
	local ok, err = try_rename(old_path, new_path, perms)
	if ok then return ok end
	check('fs', 'mv', false, 'old: %s\nnew: %s\nerror: %s',
		old_path, new_path, err)
end

--if using `mount -o dirsync` this is reduntant.
function try_sync_dir(dir, quiet)
	assert(dir, 'sync_dir(): dir required') --because dirname(file) can return nil
	local f, err = try_open{path = dir, flags = 'rdonly directory', quiet = quiet}
	if not f then return false, err end
	local ok, err = f:try_sync()
	if not ok then
		f:try_close()
		return false, err
	end
	return f:try_close()
end
function sync_dir(dir, quiet)
	local ok, err = try_sync_dir(dir, quiet)
	if ok then return ok end
	check('fs', 'sync_dir', false, '%s: %s', dir, err)
end

function try_symlink(link_path, target_path, replace, sync)
	local ok, err = check_errno(C.symlink(target_path, link_path) == 0)
	if not ok and err == 'already_exists' and replace
		and try_file_attr(link_path, 'type', false) == 'symlink'
	then
		assert(replace == 'replace')
		if try_readlink(link_path) == target_path then
			return true, err
		end
		local tmp = link_path..'~'..getpid()
		local ok1, err1 = check_errno(C.symlink(target_path, tmp) == 0)
		if not ok1 then return false, err1 end
		local ok2, err2 = check_errno(C.rename(tmp, link_path) == 0)
		if not ok2 then try_rmfile(tmp); return false, err2 end
		ok, err = true, 'replaced'
	end
	if ok then
		if sync ~= false then
			local ok, err = try_sync_dir(dirname(link_path))
			if not ok then return ok, err end
		end
		log('note', 'fs', 'symlink', 'link:   %s\ntarget:  %s',
			link_path, target_path)
	end
	return ok, err
end
function symlink(link_path, target_path, replace, sync)
	local ok, err = try_symlink(link_path, target_path, replace, sync)
	check('fs', 'symlink', ok, '%s -> %s: %s', link_path, target_path, err)
end

function try_hardlink(link_path, target_path, sync)
	local ok, err = check_errno(C.link(target_path, link_path) == 0)
	if not ok then
		if err == 'already_exists' then --check if the target is the same
			local i1 = try_file_attr(target_path, 'inode', false)
			if not i1 then return false, err end
			local i2 = try_file_attr(link_path, 'inode', false)
			if not i2 then return false, err end
			if i1 == i2 then return true, err end
		end
		return ok, err
	end
	if sync ~= false then
		local ok, err = try_sync_dir(dirname(link_path))
		if not ok then return ok, err end
	end
	log('note', 'fs', 'mkhlink', 'link:   %s\ntarget:  %s', link_path, target_path)
	return true
end
function hardlink(link_path, target_path)
	local ok, err = try_hardlink(link_path, target_path)
	check('fs', 'mkhlink', ok, '%s -> %s: %s', link_path, target_path, err)
end

local function _try_readlink(link, maxdepth, recurse)
	local len = C.readlink(link, cbuf, 4096)
	if len == -1 then
		local errno = errno()
		if errno == EINVAL then --not a symlink
			if maxdepth == 'raw' then
				return nil, 'not_symlink'
			else
				return link
			end
		elseif recurse and errno == ENOENT then --target not found
			return link
		end
		return check_errno()
	end
	if len >= 4096 then --max len is 4095 for ext4 and btrfs
		return nil, 'path_too_long'
	end
	if maxdepth == 0 then
		return nil, 'too_many_symlinks'
	end
	local target = str(cbuf, len)
	if maxdepth == 'raw' then
		return target
	end
	if not target:starts'/' then --relative symlinks are relative to their own dir
		local target_dir = dirname(link)
		if target_dir and target_dir ~= '.' then
			target = indir(target_dir, target)
		end
	end
	return _try_readlink(target, maxdepth - 1, true)
end
function try_readlink(link, maxdepth)
	maxdepth = maxdepth or 32
	assert(maxdepth == 'raw' or (maxdepth > 0 and maxdepth <= 32))
	return _try_readlink(link, maxdepth)
end
function readlink(link, maxdepth)
	local target, err = try_readlink(link, maxdepth)
	if not ok and err == 'not_found' then return nil, err end
	return check('fs', 'readlink', target, '%s: %s', link, err)
end

--common paths ---------------------------------------------------------------

function homedir()
	return os.getenv'HOME'
end

function tmpdir()
	return os.getenv'TMPDIR' or '/tmp'
end

function appdir(appname)
	local dir = homedir()
	return dir and format('%s/.%s', dir, appname)
end

function exefile()
	return readlink'/proc/self/exe'
end
exefile = memoize(exefile)

function abspath(path, pwd)
	if path:starts'/' then
		return path
	end
	return indir(pwd or cwd(), path)
end

exedir = memoize(function()
	return assert(dirname(exefile()))
end)

scriptdir = memoize(function()
	local s = rel_scriptdir:starts'/' and rel_scriptdir or indir(startcwd(), rel_scriptdir)
	return path_normalize(s)
end)

vardir = memoize(function()
	return config'vardir' or indir(scriptdir(), 'var')
end)

function varpath(...)
	return indir(vardir(), ...)
end

--file attributes ------------------------------------------------------------

cdef[[
struct stat {
	uint64_t st_dev;
	uint64_t st_ino;
	uint64_t st_nlink;
	uint32_t st_mode;
	uint32_t st_uid;
	uint32_t st_gid;
	uint32_t __pad0;
	uint64_t st_rdev;
	int64_t  st_size;
	int64_t  st_blksize;
	int64_t  st_blocks;
	uint64_t st_atime;
	uint64_t st_atime_nsec;
	uint64_t st_mtime;
	uint64_t st_mtime_nsec;
	uint64_t st_ctime;
	uint64_t st_ctime_nsec;
	int64_t  __unused[3];
};
]]

local file_types = {
	[0xc000] = 'socket',
	[0xa000] = 'symlink',
	[0x8000] = 'file',
	[0x6000] = 'blockdev',
	[0x2000] = 'chardev',
	[0x4000] = 'dir',
	[0x1000] = 'pipe',
}
local function st_type(mode)
	local type = band(mode, 0xf000)
	return file_types[type] or type --some /proc files have type 0
end

local function st_perms(mode)
	return band(mode, bnot(0xf000))
end

local function st_time(s, ns)
	return tonumber(s) + tonumber(ns) * 1e-9
end

local stat_getters = {
	type    = function(st) return st_type(st.st_mode) end,
	dev     = function(st) return tonumber(st.st_dev) end,
	inode   = function(st) return st.st_ino end, --unfortunately, 64bit inode
	nlink   = function(st) return tonumber(st.st_nlink) end,
	perms   = function(st) return st_perms(st.st_mode) end,
	uid     = function(st) return st.st_uid end,
	gid     = function(st) return st.st_gid end,
	rdev    = function(st) return tonumber(st.st_rdev) end,
	size    = function(st) return tonumber(st.st_size) end,
	blksize = function(st) return tonumber(st.st_blksize) end,
	blocks  = function(st) return tonumber(st.st_blocks) end,
	atime   = function(st) return st_time(st.st_atime, st.st_atime_nsec) end,
	mtime   = function(st) return st_time(st.st_mtime, st.st_mtime_nsec) end,
	ctime   = function(st) return st_time(st.st_ctime, st.st_ctime_nsec) end,
}

local stat_ct = ctype'struct stat'
local st = stat_ct()
local function wrap(stat_func)
	return function(arg, attr)
		local ok = stat_func(arg, st) == 0
		if not ok then return check_errno() end
		if attr then
			local get = stat_getters[attr]
			assertf(get, 'unknown file attr: %s', attr)
			return get(st)
		else
			local t = {}
			for k, get in pairs(stat_getters) do
				t[k] = get(st)
			end
			return t
		end
	end
end

local int = ctype'int'
local fstat = wrap(function(f, st)
	return C.syscall(5, cast(int, f.fd), cast(voidp, st))
end)
local stat = wrap(function(path, st)
	return C.syscall(4, cast(voidp, path), cast(voidp, st))
end)
local lstat = wrap(function(path, st)
	return C.syscall(6, cast(voidp, path), cast(voidp, st))
end)

local function fs_attr_get(path, attr, deref)
	local stat = deref and stat or lstat
	return stat(path, attr)
end

cdef[[
struct timespec {
	time_t tv_sec;
	long   tv_nsec;
};
int futimens(int fd, const struct timespec times[2]);
int utimensat(int dirfd, const char *path, const struct timespec times[2], int flags);
]]

local UTIME_OMIT = shl(1,30)-2 --means "leave it, don't change it"

local function set_timespec(ts, t)
	if ts then
		t.tv_sec = ts
		t.tv_nsec = (ts - floor(ts)) * 1e9
	else
		t.tv_sec = 0
		t.tv_nsec = UTIME_OMIT
	end
end

local AT_FDCWD = -100

local ts_ct = ctype'struct timespec[2]'
local ts = ts_ct()

local function futimes(f, atime, mtime)
	set_timespec(atime, ts[0])
	set_timespec(mtime, ts[1])
	return check_errno(C.futimens(f.fd, ts) == 0)
end

local function utimes(path, atime, mtime)
	set_timespec(atime, ts[0])
	set_timespec(mtime, ts[1])
	return check_errno(C.utimensat(AT_FDCWD, path, ts, 0) == 0)
end

local AT_SYMLINK_NOFOLLOW = 0x100

local function lutimes(path, atime, mtime)
	set_timespec(atime, ts[0])
	set_timespec(mtime, ts[1])
	return check_errno(C.utimensat(AT_FDCWD, path, ts, AT_SYMLINK_NOFOLLOW) == 0)
end

cdef[[
int fchmod(int fd,           mode_t mode);
int  chmod(const char *path, mode_t mode);
]]

local function wrap(chmod_func, stat_func)
	return function(f, perms)
		assert(perms, 'perms missing')
		local _, is_rel = parse_perms(perms)
		if is_rel then
			local cur_perms, err = stat_func(f, 'perms')
			if not cur_perms then return nil, err end
			perms = parse_perms(perms, cur_perms)
		end
		return check_errno(chmod_func(f, perms) == 0)
	end
end
local fchmod = wrap(function(f, mode) return C.fchmod(f.fd, mode) end, fstat)
local chmod = wrap(C.chmod, stat)
local lchmod = function() return nil, 'nyi' end --kernel rejects fchmodat(AT_SYMLINK_NOFOLLOW)

cdef[[
int fchown(int fd,           uid_t owner, gid_t group);
int  chown(const char *path, uid_t owner, gid_t group);
int lchown(const char *path, uid_t owner, gid_t group);
struct passwd {
	char   *pw_name;    // Username
	char   *pw_passwd;  // User password (usually "x" or "*")
	uid_t   pw_uid;     // User ID
	gid_t   pw_gid;     // Group ID
	char   *pw_gecos;   // Real name or comment field
	char   *pw_dir;     // Home directory
	char   *pw_shell;   // Login shell
};
struct group {
	char   *gr_name;    // Group name
	char   *gr_passwd;  // Group password (usually "x" or "*")
	gid_t   gr_gid;     // Group ID
	char  **gr_mem;     // Null-terminated list of group members
};
struct passwd *getpwnam(const char *name);
struct group *getgrnam(const char *name);
]]
local function get_uid(s)
	if not s or isnum(s) then return s end
	local p = ptr(C.getpwnam(s))
	return p and p.pw_uid
end
local function get_gid(s)
	if not s or isnum(s) then return s end
	local p = ptr(C.getgrnam(s))
	return p and p.gr_gid
end

local function fchown(f, uid, gid)
	return check_errno(C.fchown(f.fd, get_uid(uid) or -1, get_gid(gid) or -1) == 0)
end
local function chown(path, uid, gid)
	return check_errno(C.chown(path, get_uid(uid) or -1, get_gid(gid) or -1) == 0)
end
local function lchown(path, uid, gid)
	return check_errno(C.lchown(path, get_uid(uid) or -1, get_gid(gid) or -1) == 0)
end

local function wrap(chmod_func, chown_func, utimes_func)
	return function(arg, t)
		local ok, err
		if t.perms then
			ok, err = chmod_func(arg, t.perms)
			if not ok then return nil, err end
		end
		if t.uid or t.gid then
			ok, err = chown_func(arg, t.uid, t.gid)
			if not ok then return nil, err end
		end
		if t.atime or t.mtime then
			ok, err = utimes_func(arg, t.atime, t.mtime)
			if not ok then return nil, err end
		end
		return ok --returns nil without err if no attr was set
	end
end
local file_attr_set = wrap(fchmod, fchown, futimes)
local set_deref     = wrap( chmod,  chown,  utimes)
local set_symlink   = wrap(lchmod, lchown, lutimes)

local function fs_attr_set(path, t, deref)
	local set = deref and set_deref or set_symlink
	return set(path, t)
end

function file.try_attr(f, attr)
	if istab(attr) then
		return f:try_set_attr(attr)
	end
	if f.fd == -1 then return nil, 'closed' end
	return fstat(f, attr)
end
function file.attr(f, attr)
	if istab(attr) then
		return f:set_attr(attr)
	end
	local ret, err = f:try_attr(attr)
	local ok = ret ~= nil or err == nil or err == 'not_found'
	check('fs', 'attr', ok, '%s: %s', f.path, err)
	if err ~= nil then return ret, err end
	return ret
end

function file.try_set_attr(f, attr)
	if f.fd == -1 then return nil, 'closed' end
	assertf(istab(attr), 'table expected, got: %s', type(attr))
	return file_attr_set(f, attr)
end
function file.set_attr(f, attr)
	local ret, err = f:try_set_attr(attr)
	local ok = ret ~= nil or err == nil or err == 'not_found'
	check('fs', 'set_attr', ok, '%s: %s', f.path, err)
	if err ~= nil then return ret, err end
	return ret
end

function file.try_size(f)
	return f:try_attr'size'
end
file.size = unprotect_io(file.try_size)

local function attr_args(attr, deref)
	if isbool(attr) then --middle arg missing
		attr, deref = nil, attr
	end
	if deref == nil then
		deref = true --deref by default
	end
	return attr, deref
end

local function set_attr_args(attr, deref)
	assertf(istab(attr), 'table expected, got: %s', type(attr))
	if deref == nil then
		deref = true --deref by default
	end
	return attr, deref
end

function try_set_file_attr(path, attr, deref, sync)
	attr, deref = set_attr_args(attr, deref)
	if sync ~= false then
		local flags = deref and 'rdonly' or 'rdonly nofollow'
		local f, err = try_open{path = path, flags = flags, quiet = true}
		if f then
			local ok, err = file_attr_set(f, attr)
			if not ok then f:try_close(); return false, err end
			local ok, err = f:try_sync()
			if not ok then f:try_close(); return false, err end
			return f:try_close()
		elseif err ~= 'too_many_symlinks' then
			return false, err
		else
			--symlink with deref=false: can't sync inode on Linux,
			--fallback to unsync'ed fs_attr_set().
		end
	end
	return fs_attr_set(path, attr, deref)
end
function set_file_attr(path, attr, deref, sync)
	local ret, err = try_set_file_attr(path, attr, deref, sync)
	local ok = ret ~= nil or err == nil or err == 'not_found'
	check('fs', 'set_attr', ok, '%s: %s', path, err)
	if err ~= nil then return ret, err end
	return ret
end

function try_file_attr(path, ...)
	local attr, deref = attr_args(...)
	if attr == 'target' then
		return try_readlink(path)
	end
	if istab(attr) then
		return try_set_file_attr(path, attr, deref)
	else
		return fs_attr_get(path, attr, deref)
	end
end
function file_attr(path, ...)
	local attr = ...
	if istab(attr) then
		return set_file_attr(path, ...)
	end
	local ret, err = try_file_attr(path, ...)
	local ok = ret ~= nil or err == nil or err == 'not_found'
	check('fs', 'attr', ok, '%s: %s', path, err)
	if err ~= nil then return ret, err end
	return ret
end

function try_mtime(file, deref)
	return try_file_attr(file, 'mtime', deref)
end
function mtime(file, deref)
	return file_attr(file, 'mtime', deref)
end

function try_chmod(path, perms)
	local ok, err = try_set_file_attr(path, {perms = perms})
	if not ok then return false, err end
	log('note', 'fs', 'chmod', '%s %s', path, perms)
	return path
end
function chmod(path, perms)
	local ok, err = try_chmod(path, perms)
	check('fs', 'chmod', ok, '%s %s: %s', path, perms, err)
	return path
end
function try_chown(path, uid, gid)
	local ok, err = try_set_file_attr(path, {uid = uid, gid = gid})
	if not ok then return false, err end
	log('note', 'fs', 'chown', '%s%s%s', path,
		uid and ' uid='..uid or '',
		gid and ' gid='..gid or '')
	return path
end
function chown(path, uid, gid)
	local ok, err = try_chown(path, uid, gid)
	check('fs', 'chown', ok, '%s%s%s: %s', path,
		uid and ' uid='..uid or '',
		gid and ' gid='..gid or '',
		err)
	return path
end

function try_file_is(path, type, deref)
	if type == 'symlink' then
		deref = false
	end
	local ftype, err = try_file_attr(path, 'type', deref)
	if not ftype and err == 'not_found' then
		return false, 'not_found'
	elseif not type and ftype then
		return true
	elseif not ftype then
		return nil, err
	else
		return ftype == type
	end
end
function file_is(path, type, deref)
	local is, err = try_file_is(path, type, deref)
	check('fs', 'file_is', is ~= nil, '%s: %s', path, err)
	return is, err
end
try_exists = try_file_is
exists = file_is

function checkexists(file, type, deref)
	check('fs', 'exists', exists(file, type, deref), '%s', file)
end

--file locking ---------------------------------------------------------------

cdef'int flock(int fd, int operation);'

local LOCK_SH = 1 --shared
local LOCK_EX = 2 --exclusive
local LOCK_NB = 4 --non-blocking
local LOCK_UN = 8 --unlock

local lock_ops = {r = LOCK_SH, w = LOCK_EX, un = LOCK_UN}

--NOTE: returns true, 'again' if nonblock is passed but lock not acquired,
--as opposed to nil, err for genuine errors.
function file.try_lock(f, op, nonblock)
	if f.fd == -1 then return nil, 'closed' end
	local flags = assertf(lock_ops[op or 'w'], 'invalid lock op: %s', op)
	if nonblock then flags = bor(flags, LOCK_NB) end
	local ok, err = check_errno(C.flock(f.fd, flags) == 0)
	if ok then return true end
	if err == 'again' then return true, 'again' end
	return ok, err
end
function file.lock(f, op, nonblock)
	return f:check_io(f:try_lock(op, nonblock))
end
function file.try_unlock(f, nonblock)
	return f:try_lock('un', nonblock)
end
function file.unlock(f, nonblock)
	return f:check_io(f:try_unlock(nonblock))
end

--directory listing ----------------------------------------------------------

cdef[[
struct dirent { // NOTE: 64bit version
	uint64_t        d_ino;
	int64_t         d_off;
	unsigned short  d_reclen;
	unsigned char   d_type;
	char            d_name[256];
};
typedef struct DIR DIR;
DIR *opendir(const char *name);
struct dirent *readdir(DIR *dirp) asm("readdir64");
int closedir(DIR *dirp);
int dirfd(DIR *dirp);
]]

dir_ct = ctype[[
	struct {
		DIR *_dirp;
		struct dirent* _dentry;
		int  _errno;
		int  _dirlen;
		char _skip_dot_dirs;
		bool tracebacks;
		char _dir[?];
	}
]]

function dir.try_close(dir)
	if dir:closed() then return true end
	local ok = C.closedir(dir._dirp) == 0
	if not ok then return check_errno(false) end
	dir._dirp = nil
	return true
end
dir.close = unprotect_io(dir.try_close)

function dir.closed(dir)
	return dir._dirp == nil
end

function dir.try_sync(dir)
	if dir:closed() then return nil, 'closed' end
	return check_errno(C.fsync(C.dirfd(dir._dirp)) == 0)
end
dir.sync = unprotect_io(dir.try_sync)

function dir.dir(dir)
	return str(dir._dir, dir._dirlen)
end

function dir.try_next(dir)
	if dir:closed() then
		if dir._errno ~= 0 then
			local errno = dir._errno
			dir._errno = 0
			return check_errno(false, errno)
		end
		return nil
	end
	errno(0)
	dir._dentry = C.readdir(dir._dirp)
	if dir._dentry ~= nil then
		local name = dir:name()
		if dir._skip_dot_dirs == 1 and (name == '.' or name == '..') then
			return dir:try_next()
		end
		return name, dir
	else
		local errno = errno()
		dir:close()
		if errno == 0 then
			return nil
		end
		return check_errno(false, errno)
	end
end
function dir.next(dir)
	local name, d = dir:try_next()
	if name == nil then return nil end --eof
	check_io(nil, name, d) --name, d | false, err
	return name, d
end

--dirent.d_type consts
local DT_UNKNOWN = 0
local DT_FIFO    = 1
local DT_CHR     = 2
local DT_DIR     = 4
local DT_BLK     = 6
local DT_REG     = 8
local DT_LNK     = 10
local DT_SOCK    = 12

local dt_types = {
	dir      = DT_DIR,
	file     = DT_REG,
	symlink  = DT_LNK,
	blockdev = DT_BLK,
	chardev  = DT_CHR,
	pipe     = DT_FIFO,
	socket   = DT_SOCK,
	unknown  = DT_UNKNOWN,
}

local dt_names = {
	[DT_DIR]  = 'dir',
	[DT_REG]  = 'file',
	[DT_LNK]  = 'symlink',
	[DT_BLK]  = 'blockdev',
	[DT_CHR]  = 'chardev',
	[DT_FIFO] = 'pipe',
	[DT_SOCK] = 'socket',
	[DT_UNKNOWN] = 'unknown',
}

local function dir_attr_get(dir, attr)
	if attr == 'type' and dir._dentry.d_type == DT_UNKNOWN then
		--some filesystems (eg. VFAT) require this extra call to get the type.
		local type, err = lstat(dir:path(), 'type')
		if not type then
			return false, nil, err
		end
		local dt = dt_types[type]
		dir._dentry.d_type = dt --cache it
	end
	if attr == 'type' then
		return dt_names[dir._dentry.d_type]
	elseif attr == 'inode' then
		return dir._dentry.d_ino
	else
		return nil, false
	end
end

local function dir_check(dir)
	assert(not dir:closed(), 'dir closed')
	assert(dir._dentry ~= nil, 'dir not ready') --must call next() at least once.
end

function try_ls(p, opt)
	local skip_dot_dirs = not (opt and opt:find('..', 1, true))
	p = p or '.'
	local dir = dir_ct(#p)
	dir._dirlen = #p
	copy(dir._dir, p, #p)
	dir._skip_dot_dirs = skip_dot_dirs and 1 or 0
	dir._dirp = C.opendir(p)
	if dir._dirp == nil then
		dir._errno = errno()
	end
	return dir.try_next, dir
end
function ls(...)
	local _, dir = try_ls(...)
	return dir.next, dir
end

function dir.path(dir)
	return indir(dir:dir(), dir:name())
end

function dir.name(dir)
	dir_check(dir)
	return str(dir._dentry.d_name)
end

local function dir_is_symlink(dir)
	return dir_attr_get(dir, 'type') == 'symlink'
end

function dir.try_attr(dir, ...)
	dir_check(dir)
	local attr, deref = attr_args(...)
	if attr == 'target' then
		if dir_is_symlink(dir) then
			local path = dir:path()
			return try_readlink(path)
		else
			return nil --no error for non-symlink files
		end
	end
	if istab(attr) then
		return dir:try_set_attr(attr, deref)
	elseif not attr or (deref and dir_is_symlink(dir)) then
		return fs_attr_get(dir:path(), attr, deref)
	else
		local val, found = dir_attr_get(dir, attr)
		if found == false then --attr not found in state
			return fs_attr_get(dir:path(), attr)
		else
			return val
		end
	end
end
dir.attr = unprotect_io(dir.try_attr)

function dir.try_set_attr(dir, attr, deref)
	dir_check(dir)
	attr, deref = set_attr_args(attr, deref)
	return fs_attr_set(dir:path(), attr, deref)
end
dir.set_attr = unprotect_io(dir.try_set_attr)

function dir.try_size(dir)
	return dir:try_attr'size'
end
dir.size = unprotect_io(dir.try_size)

function dir.is(dir, type, deref)
	if type == 'symlink' then
		deref = false
	end
	return dir:try_attr('type', deref) == type
end

local function scandir1(path, dive)
	local ds = {}
	local next, d = try_ls(path)
	local name, err
	local sc = {}
	setmetatable(sc, sc)
	function sc:close()
		repeat
			d:try_close()
			d = pop(ds)
		until not d
		name, err = nil
	end
	function sc:depth(n)
		n = n or 0
		local maxdepth = #ds + 1
		return n > 0 and min(maxdepth, n) or max(1, maxdepth + n)
	end
	function sc:relpath(n)
		return relpath(sc:path(n), path)
	end
	function sc:__index(k) --forward other method calls to a dir object.
		local f
		function f(self, depth, ...)
			if not name then return nil, 'closed' end
			if not isnum(depth) then
				return f(self, 0, depth, ...)
			end
			local d = d
			if depth ~= 0 then
				depth = self:depth(depth)
				d = ds[depth] or d
			end
			return d[k](d, ...)
		end
		self[k] = f
		return f
	end
	local function iter()
		if not d then return nil end --closed
		if name and d:is('dir', false) then
			if not dive or dive(d) then
				local next1, d1 = try_ls(d:path())
				assert(next1 == next) --because we reuse next()
				push(ds, d)
				d = d1
			end
		end
		name, err = next(d)
		if name == false then --error
			d:close() --now d is nil so next call to iter() will return nil
			return false, err
		elseif name == nil then --end
			d = pop(ds)
			return iter()
		end
		return sc
	end
	return iter
end
function scandir(arg, dive)
	if isstr(arg) then
		return scandir1(arg, dive)
	elseif istab(arg) then
		local i, n = 1, arg.n or #arg
		local iter = scandir1(arg[i], dive)
		return function()
			::again::
			local sc, err = iter()
			if sc == false then --error
				return false, err --sc will be nil in next iteration
			elseif sc == nil then --end
				if i == n then return nil end
				i = i + 1
				iter = scandir1(arg[i], dive)
				goto again
			end
			return sc
		end
	else
		assertf(false, 'string or table expected, got: %s', type(arg))
	end
end

--hi-level APIs --------------------------------------------------------------

function try_load_tobuffer(file, default_buf, default_len, ignore_file_size)
	local f, err = try_open(file)
	if not f then
		if err == 'not_found' and default_buf ~= nil then
			return default_buf, default_len
		end
		return nil, err
	end
	local buf, len = f:try_readall(ignore_file_size)
	if not buf then
		f:try_close()
		return nil, len
	end
	local ok, err = f:try_close()
	if not ok then return nil, err end
	return buf, len
end

function try_load(file, ignore_file_size)
	local buf, len = try_load_tobuffer(file, nil, nil, ignore_file_size)
	if not buf then return nil, len end
	return str(buf, len)
end

function load_tobuffer(file, default_buf, default_len, ignore_file_size)
	local buf, len = try_load_tobuffer(file, default_buf, default_len, ignore_file_size)
	check('fs', 'load', buf, '%s: %s', file, len)
	return buf, len
end

function load(file, ignore_file_size) --load a file into a string, nil if not found.
	local buf, len = try_load_tobuffer(file, nil, nil, ignore_file_size)
	if buf == nil then
		if len == 'not_found' then return nil end
		check('fs', 'load', false, '%s: %s', file, len)
	end
	return str(buf, len)
end

--return a try_write(v | buf,len) -> true | false,err function
--that doesn't yield, so you can use it in ffi write callbacks.
function file_saver(file, file_perms, dir_perms, sync)
	sync = sync ~= false
	local tmpfile = file..'~'..getpid()
	local f, n
	local function _write(buf, sz)
		if not f then
			mkdirs(tmpfile, dir_perms, sync)
			f = open{path = tmpfile, mode = 'w', perms = file_perms, quiet = true}
			n = 0
		end
		if buf ~= nil and not iscdata(buf) then
			buf = tostring(buf)
		end
		sz = sz or #buf
		if sz > 0 then
			f:write(buf, sz)
			n = n + sz
		else --eof
			if sync then f:sync() end
			f:close()
			rename(tmpfile, file)
			if sync then sync_dir(dirname(file)) end
			log('note', 'fs', 'save', '%s (%s)', file, kbytes(n))
		end
	end
	local function write(buf, sz)
		assert(not (f and f:closed()))
		local ok, err
		if buf == nil and sz ~= 0 then --caller wants to abort with error
			ok, err = buf, sz
		else
			ok, err = catch('io', _write, buf, sz)
		end
		if ok then
			return true, f:closed() and 'closed' or nil
		else
			--io error: file was either closed or not yet opened
			if f then
				assert(f:closed()) --bug check, io error should have closed the file
				try_rmfile(tmpfile)
			end
			return false, err
		end
	end
	return write
end

--write a Lua value or read()->buf,sz to a file
--atomically and durably (on drives with PLP).
function try_save(file, arg, sz, file_perms, dir_perms, sync)
	local write = file_saver(file, file_perms, dir_perms, sync)
	if isfunc(arg) then --reader
		local read = arg
		while true do
			local ok, buf, sz = pcall(read)
			if not ok then buf, sz = nil, buf end --send error to write()
			local ok, err = write(buf, sz)
			if not ok then return false, err end
			if err == 'closed' then break end --eof
		end
	else --buffer or stringable
		local ok, err = write(arg, sz)
		if not ok then return false, err end
		if not err then
			local ok, err = write(nil, 0) --eof
			if not ok then return false, err end
		end
		return true
	end
end
function save(file, arg, sz, file_perms, dir_perms)
	local ok, err = try_save(file, arg, sz, file_perms, dir_perms)
	check('fs', 'save', ok, '%s: %s', file, err)
end

function touch(file, mtime, sync) --create file or update its mtime.
	local f = open(file, 'a')
	mtime = mtime or now()
	check_io(f, futimes(f, mtime, mtime))
	if sync ~= false then f:sync() end
	f:close()
	if sync ~= false then sync_dir(dirname(file)) end
	log('note', 'fs', 'touch', '%s to %s', file, date('%d-%m-%Y %H:%M', mtime))
end
try_touch = protect_io(touch)

--8 syscalls to increment a number safely, maybe you need a DB :)
function gen_id(name, start)
	local next_id_file = varpath('next_'..name)
	local f = open(next_id_file, 'rw')
	f:lock'w'
	local s = str(f:readall())
	local n = tonumber(s)
	local need_sync_dir = not n --most likely file was created now
	n = n or start or 1
	f:check_io(n and n >= 0 and floor(n) == n, '%s invalid: %s', next_id_file, s)
	f:truncate(0)
	f:write(tostring(n + 1))
	f:sync()
	f:unlock()
	f:close()
	if need_sync_dir then sync_dir(vardir()) end
	log('note', 'fs', 'gen_id', '%s: %d', name, n)
	return n
end

--free space reporting -------------------------------------------------------

cdef[[
int statfs(const char *path, struct statfs *buf);
typedef long int __fsword_t;
typedef unsigned long int fsblkcnt_t;
typedef struct { int __val[2]; } fsid_t;
typedef unsigned long int fsfilcnt_t;
struct statfs {
	__fsword_t f_type;    /* Type of filesystem (see below) */
	__fsword_t f_bsize;   /* Optimal transfer block size */
	fsblkcnt_t f_blocks;  /* Total data blocks in filesystem */
	fsblkcnt_t f_bfree;   /* Free blocks in filesystem */
	fsblkcnt_t f_bavail;  /* Free blocks available unprivileged user */
	fsfilcnt_t f_files;   /* Total inodes in filesystem */
	fsfilcnt_t f_ffree;   /* Free inodes in filesystem */
	fsid_t     f_fsid;    /* Filesystem ID */
	__fsword_t f_namelen; /* Maximum length of filenames */
	__fsword_t f_frsize;  /* Fragment size (since Linux 2.6) */
	__fsword_t f_flags;   /* Mount flags of filesystem (since Linux 2.6.36) */
	__fsword_t f_spare[4]; /* Padding bytes reserved for future use */
};
]]
local statfs_ct = ctype'struct statfs'
local statfs_buf
local function statfs(path)
	statfs_buf = statfs_buf or statfs_ct()
	local ok, err = check_errno(C.statfs(path, statfs_buf) == 0)
	if not ok then return nil, err end
	return statfs_buf
end

function fs_info(path)
	local buf, err = statfs(path)
	if not buf then return nil, err end
	local t = {}
	t.size = tonumber(buf.f_blocks * buf.f_bsize)
	t.free = tonumber(buf.f_bavail * buf.f_bsize)
	return t
end

--pollable pid files ---------------------------------------------------------

--NOTE: Linux 5.3+ feature, not used yet. Intended to replace polling
--for process status change in proc.lua.

local PIDFD_NONBLOCK = 0x000800

function pidfd_open(pid, opt)
	opt = update({type = 'pidfd', async = true, debug_prefix = 'p'}, opt)
	local flags = opt.async and PIDFD_NONBLOCK or 0
	local fd = C.syscall(434, pid, flags)
	if fd == -1 then
		return check_errno()
	end
	return file_wrap_fd(fd, opt)
end

metatype(dir_ct, dir)
