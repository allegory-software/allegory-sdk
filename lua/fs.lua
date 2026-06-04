--[=[

	Filesystem API for Linux.
	Written by Cosmin Apreutesei. Public Domain.

TODO
	* API to flip sync-by-default temporarily or even per dir?
	* cp() via copy_file_range() (sync only)
	* realpath() instead of recursive readlink() (faster, more accurate?)
	* get/set btime via statx() (ext4+)

FILE OBJECTS
	[must_]open(opt | path,[mode]) -> f|nil,'not_found'|'already_exists' open file
	f:[try_]close()                               close file
	f:closed() -> true|false                      check if file is closed
	f:onclose(fn)                                 exec fn after the file is closed
	isfile(f [,type]) -> true|false               check if f is a file or pipe
	f.fd -> fd                                    POSIX file descriptor
PIPES
	pipe([opt]) -> rf, wf                         create an anonymous pipe
	mkfifo(path|{path=,...}) -> true              create a named pipe
STDIN/OUT/ERR ASYNC PIPES
	std{in|out|err}_async_pipe() -> pipe          get stdin/out/err as async pipes
EVENTFD
	eventfd([initval], [flags]) -> f              create an eventfd
	f:read_value() -> n                           read counter (async)
	f:write_value([n])                            add n (default 1) to counter (async)
	EFD_SEMAPHORE                                 flag for semaphore mode
FILE I/O
	f:[try_]read(buf, len) -> readlen|0           read data from file
	f:readn(buf, n)                               read exactly n bytes
	f:write(s | buf,len)                          write data to file
	f:sync()                                      sync kernel write buffer to disk
	f:seek([whence] [, offset]) -> pos            get/set the file pointer
	f:skip(n) -> actual_n                         skip bytes
	f:truncate(size, [opt])                       truncate file and set pointer to end
OPEN FILE ATTRIBUTES
	f:attr([attr]) -> val|t                       get attribute(s) of open file
	f:set_attr(attr) -> ok                        set attribute(s) of open file
	f:size() -> n                                 get file size
	f:set_inheritable(true|false)                 change O_CLOEXEC flag
FILE LOCKING
	f:lock(['r'|'w'], [nonblock])
	f:unlock([nonblock])
DIRECTORY LISTING
	ls(dir, [opt], ['if_exists']) -> iter() -> name,d  contents iterator
	try_ls(dir, [opt]) -> iter() -> name,d        ls(..., 'if_exists')
	  d:next() -> name,d                          call the iterator explicitly
	  d:[try_]close()                             close iterator
	  d:closed() -> true|false                    check if iterator is closed
	  d:name() -> s                               dir entry's name
	  d:dir() -> s                                dir that was passed to ls()
	  d:path() -> s                               full path of the dir entry
	  d:attr([attr, ][deref]) -> t|val|nil,'not_found'   get dir entry attribute(s)
	  d:set_attr(attr, [deref]) -> ok|nil,'not_found'    set dir entry attribute(s)
	  d:is(type, [deref]) -> t|f                  check if dir entry is of type
	  d:sync()                                    sync directory to disk
	scandir(path|{path1,...}, [dive]) -> iter() -> sc     recursive dir iterator
	  sc:close()
	  sc:closed() -> true|false
	  sc:name([depth]) -> s
	  sc:dir([depth]) -> s
	  sc:path([depth]) -> s
	  sc:relpath([depth]) -> s
	  sc:attr([attr, ][deref]) -> t|val|nil,'not_found'
	  sc:set_attr(attr, [deref]) -> ok|nil,'not_found'
	  sc:depth([n]) -> n (from 1)
FILE ATTRIBUTES
	file_attr(path, [attr, ][deref]) -> t|val|nil,'not_found' get file attribute(s)
	set_file_attr(path, attr, [deref]) -> ok|nil,'not_found' set file attribute(s)
	file_is(path, [type], [deref]) -> t|f,['not_found'] check if file exists or is of a certain type
	exists                                      = file_is
	check_exists(path, [type], [deref])           raise if file does not exist
	mtime(path, [deref]) -> ts|nil,'not_found'    get file's modification time
	chmod(path, perms) -> path[, 'not_found']     change a file or dir's permissions
	chown(path, [uid], [gid]) -> path[, 'not_found'] change a file or dir's owner/group
FILESYSTEM OPS
	cwd() -> path                                 get current working directory
	abspath(path[, cwd]) -> path                  convert path to absolute path
	startcwd() -> path                            get the cwd that process started with
	chdir(path)                                   set current working directory
	mkdir(dir, [recursive], [perms], [sync]) -> dir[, 'already_exists'] make directory
	rmfile(path) -> path[, 'not_found']           remove file
	rmdir(path) -> path[, 'not_found']            remove empty directory
	rm_rf(path) -> path[, 'not_found']            like `rm -rf`
	mkdirs(file, [perms], [sync]) -> file         make file's dir
	rename(old_path, new_path, [dst_dirs_perms], [sync])   rename/move file or dir on the same filesystem
	sync_dir(dir)                                 make fs changes inside dir durable
SYMLINKS & HARDLINKS
	symlink(symlink, path, [replace='replace'], [sync])  create a symbolic link for a file or dir
	hardlink(hardlink, path, [sync])              create a hard link for a file
	readlink(path, [maxdepth]) -> path            dereference a symlink recursively
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
	_make_file(owner, fd, f) -> f                 create file object from file descriptor
	_init_file(f) -> f                            init file object
FILESYSTEM INFO
	fs_info(path) -> {size=, free=}               get free/total disk space for a path
HI-LEVEL APIs
	load(path[, maxlen]) -> s | nil,'not_found'
	load_tobuffer(path[, maxlen]) -> buf,len | nil,'not_found'
	save(path, v | buf,len | read, [file_perms], [dir_perms], [sync]) atomic save value/buffer/reader
	file_saver(path, [file_perms], [dir_perms])
		-> try_write(v | buf,len | nil,0) -> ok, err
	touch(file, [mtime])                          create file or update mtime
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

open(opt | path,[mode]) -> f|nil,'not_found'|'already_exists'

Open/create a file for reading/writing/appending.
Opening read/only returns nil,'not_found' if file is missing.
Opening exclusive returns nil,'already_exists' if file exists.

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

pipe([opt]) -> rf, wf

	Create an anonymous (unnamed) pipe. Return two files corresponding to the
	read and write ends of the pipe.

	Options:
		* inheritable, read_inheritable, write_inheritable: make one
		or both pipes inheritable by sub-processes.

mkfifo(path, [perms]) -> true[,'already_exists']

	Create a named pipe.

FILE I/O ---------------------------------------------------------------------

f:[try_]read(buf, len) -> readlen | 0

	Read data from file. len must be > 0. Returns (and keeps returning) 0
	on EOF or broken pipe.

f:readn(buf, len) -> true

	Read data from file until len is read.
	Raises on EOF or I/O error.

f:write(s | buf,len) -> true

	Write data to file.

f:sync()

	Sync kernel write buffer to disk.

f:setexpires(clock|nil, ['r'|'w'])
f:settimeout(seconds|nil, ['r'|'w'])

	Set or clear async expire time or timeout (see sock.lua).

f:seek([whence] [, offset]) -> pos

	Get/set the file pointer. Same semantics as standard io module seek
	i.e. whence defaults to 'cur' and offset defaults to 0.

f:truncate(size, [opt])

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

	f:attr([attr]) -> val|t
	f:set_attr(attr) -> ok

		Get attribute(s) of open file. attr can be:
	* nothing/nil: get the values of all attributes in a table.
	* string: get the value of a single attribute.

		f:set_attr(attr)

		Set one or more attributes from a table.

DIRECTORY LISTING ------------------------------------------------------------

ls([dir], [opt], ['if_exists']) -> iter,d
try_ls([dir], [opt]) -> iter,[d]

	Directory contents iterator. dir defaults to '.'.
	opt can include:
		dot_dirs: include . and .. dir entries (excluded by default).
		owner: specify an owner.
		if_exists: return an empty iterator for missing dirs.

	USAGE

		for name, d in ls() do
			print(d:attr'type', name)
		end

	ls() raises on open and iteration errors. Pass 'if_exists' as the last
	arg (or opt.if_exists = true) to return an empty iterator for missing dirs.
	try_ls() is the same as ls(..., 'if_exists').

	d:next() -> name,d | nil

		Call the iterator explicitly.

	d:close()

		Close the iterator. Always call d:close() before breaking the for loop.

	d:closed() -> true|false

		Check if the iterator is closed.

	d:name() -> s

		The name of the current file or directory being iterated.

	d:dir() -> s

		The directory that was passed to ls().

	d:path() -> s

		The full path of the current dir entry (d:dir() combined with d:name()).

	d:attr([attr, ][deref]) -> t|val|nil,'not_found'

		Get dir entry attribute(s).
		Returns nil,'not_found' if the dir entry's path no longer exists.

		deref means return the attribute(s) of the symlink's target if the file is
		a symlink (deref defaults to true!). When deref=true, even the 'type'
		attribute is the type of the target, so it will never be 'symlink'.

		Some attributes for directory entries are free to get (but not for symlinks
		when deref=true) meaning that they don't require a system call for each
		file, notably type and inode.

	d:set_attr(attr, [deref]) -> ok|nil,'not_found'

		Set dir entry attribute(s).
		Returns nil,'not_found' if the dir entry's path no longer exists.

	d:is(type, [deref]) -> true|false

		Check if dir entry is of type.

scandir(path|{path1,...}, [dive]) -> iter() -> sc

	Recursive dir walker.
	* depth arg can be 0=sc:depth(), 1=first-level, -1=parent-level, etc.
	* dive(sc) -> true is an optional filter to skip from diving into dirs.

	sc:close()
	sc:closed() -> true|false
	sc:name([depth]) -> s
	sc:dir([depth]) -> s
	sc:path([depth]) -> s
	sc:relpath([depth]) -> s
	sc:attr([attr, ][deref]) -> t|val|nil,'not_found'
	sc:set_attr(attr, [deref]) -> ok|nil,'not_found'
	sc:depth([n]) -> n (from 1)

FILE ATTRIBUTES --------------------------------------------------------------

file_attr(path, [attr, ][deref]) -> t|val|nil,'not_found'

	Get a file's attribute(s) given its path in utf8.

set_file_attr(path, attr, [deref]) -> ok|nil,'not_found'

	Set a file's attribute(s) given its path in utf8.

file_is(path, [type], [deref]) -> true|false, ['not_found']

	Check if file exists or if it is of a certain type.

FILESYSTEM OPERATIONS --------------------------------------------------------

mkdir(path, [recursive], [perms])

	Make directory. perms is passed to unixperms_parse().

	NOTE: In recursive mode, if the directory already exists this function
	returns true,'already_exists'.

rmfile(path) -> path[, 'not_found']
rmdir(path) -> path[, 'not_found']
rm_rf(path) -> path[, 'not_found']

	Remove files and directories.

rename(path, new_path, [sync])

	Rename/move a file on the same filesystem.

	This operation is atomic.

SYMLINKS & HARDLINKS ---------------------------------------------------------

symlink(symlink, path, [replace='replace'], [sync])

	Create a symbolic link for a file or dir. By default, replace an existing
	symlink target. Pass replace=false to fail if the symlink already exists.

hardlink(hardlink, path)

	Create a hard link for a file.

readlink(path, [maxdepth]) -> path

	Dereference a symlink recursively. The result can be an absolute or
	relative path which can be valid or not.

PROGRAMMING NOTES ------------------------------------------------------------

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
require'owner'
require'pbuffer'

--POSIX does not define an ABI and platfoms have different cdefs thus we have
--to limit support to the platforms and architectures we actually tested for.
assert(Linux, 'platform not Linux')

local
	C, min, max, floor, ceil, ln, push, pop, istab, isstr =
	C, min, max, floor, ceil, ln, push, pop, istab, isstr

local
	cast, bor, band, bnot, shl, check, try_errno =
	cast, bor, band, bnot, shl, check, try_errno

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

local open_mode_flags = {
	['r' ] = 'rdonly',
	['r+'] = 'rdwr',
	['w' ] = 'creat wronly trunc',
	['w+'] = 'creat rdwr trunc',
	['a' ] = 'creat wronly append',
	['a+'] = 'creat rdwr append',
	['rw'] = 'creat rdwr', --non-standard but useful for updating
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
		check_errno(cur_bits ~= -1)
		local bits = setbits(cur_bits, mask, bits)
		check_errno(C.fcntl(f.fd, SET, cast('int', bits)) == 0)
	end
end
local fcntl_set_fl_flags = fcntl_set_flags_func(F_GETFL, F_SETFL)
local fcntl_set_fd_flags = fcntl_set_flags_func(F_GETFD, F_SETFD)

local file = {type = 'file', error_type = 'fs', debug_prefix = 'f'}

function _make_file(owner, fd, f)
	local f = _own(owner, object(file, f))
	f.fd = fd
	f.w = 0
	f.r = 0
	if not (f.type == 'file' and not f.async) then --not seekable
		f.seek = false
	end
	return f
end
function _init_file(f)
	if f.async then
		fcntl_set_fl_flags(f, O_NONBLOCK, O_NONBLOCK)
		_epoll_add(f)
	end
	live(f, f.path or f.name or f.type or '')
	return f
end

file.setowner = setowner

function isfile(f, type)
	local mt = getmetatable(f)
	return istab(mt) and rawget(mt, '__index') == file and (not type or f.type == type)
end

function file.closed(f)
	return f.fd == -1
end

local function try_file_close(f, cancel_thread)
	if f.fd == -1 then return true end
	if f.async then
		_epoll_remove(f)
	end
	local fd = f.fd; f.fd = -1 --close barrier
	--NOTE: close() failing doesn't mean failed to close, the fd is still gone.
	--close failing only means there are pending I/O errors to report.
	local ok, err = try_errno(C.close(fd) == 0)
	_disown(f)
	--f.quiet and '' or 'note', 'fs', 'closed', '%-4s r:%d w:%d', f, f.r, f.w)
	live(f, nil, 'r:%d w:%d', f.r, f.w)
	if f.async then
		_epoll_cancel(f, cancel_thread) --raise into waiting I/O threads.
	end
	if f._onclose then
		f:_onclose()
		f._onclose = nil
	end
	return ok, err
end
function file.try_close(f)
	return try_file_close(f)
end
file.close = make_raising('close', file.try_close)

function file._try_cancel_io(f, cancel_thread)
	if f.fd == -1 then return nil, 'thread not waiting' end
	return try_file_close(f, cancel_thread)
end

function file.onclose(f, fn)
	after(f, '_onclose', fn)
end

function file.set_inheritable(f, inheritable)
	f:check_closed()
	fcntl_set_fd_flags(f, FD_CLOEXEC, inheritable and 0 or FD_CLOEXEC)
end

function open(path_or_opt, mode)
	local f = istab(path_or_opt)
		and update({}, path_or_opt)
		or {path = path_or_opt, mode = mode}
	assert(isstr(f.path), 'path required')
	local mode_flags = f.mode and assertf(open_mode_flags[f.mode],
		'open: invalid mode: %s', f.mode)
	assert(not (f.async and f.type == 'file'),
		'open: files cannot be opened async')
	local flags = bor(
		bitflags(f.flags, o_bits),
		bitflags(mode_flags, o_bits),
		f.async and O_NONBLOCK or 0,
		not f.inheritable and O_CLOEXEC or 0
	)
	local wo = getbit(flags, o_bits.wronly)
	local rw = getbit(flags, o_bits.rdwr)
	assert(not (wo and rw), 'open: conflicting flags: wronly + rdwr')
	if f.quiet == nil then f.quiet = not (wo or rw) end
	local perms = parse_perms(f.perms) or default_file_perms
	local owner = _check_owner(f.owner)
	local fd = C.open(f.path, flags, perms)
	if fd == -1 then
		local _, err = try_errno()
		if err == 'not_found' then
			local ro = not (wo or rw) and not getbit(flags, o_bits.creat)
			if ro then return nil, err end
		elseif err == 'already_exists' then
			local claim = getbit(flags, o_bits.creat) and getbit(flags, o_bits.excl)
			if claim then return nil, err end
		end
		check_fs(f.path, 'open', false, err)
	end
	local f = _init_file(_make_file(owner, fd, f))
	log(f.quiet and '' or 'note', 'fs', 'open',
		'%-4s %s %s fd=%d', f, wo and 'wo' or rw and 'rw' or 'r', f.path, fd)
	return f
end

function must_open(path_or_opt, mode)
	local path = istab(path_or_opt) and path_or_opt.path or path_or_opt
	return check_fs(path, 'open', open(path_or_opt, mode))
end

function file:check_io(event, ...)
	return check_for(nil, self, event, ...)
end
function file:check_closed()
	if self.fd ~= -1 then return end
	error(CLOSED)
end
file.checkp = checkp

function file.skip(f, n)
	local i = f:seek('cur', 0)
	local j = f:seek('cur', n)
	return j - i
end

file.setexpires  = _epoll_setexpires
file.settimeout  = _epoll_settimeout

--pipes ----------------------------------------------------------------------

cdef[[
int pipe2(int[2], int flags);
int mkfifo(const char *pathname, mode_t mode);
]]

function mkfifo(path, perms)
	perms = parse_perms(perms) or default_file_perms
	local ok, err = try_errno(C.mkfifo(path, perms) == 0)
	check_fs(path, 'mkfifo', ok or err == 'already_exists', err)
	log('note', 'fs', 'mkfifo', '%s %o', path, perms)
	return true, err
end

local pipe_fds = new'int[2]'
function pipe(opt) --unnamed pipe
	opt = opt or empty
	local owner = _check_owner(opt.owner)
	local r_async = repl(opt.async_read , nil, repl(opt.async, nil, true))
	local w_async = repl(opt.async_write, nil, repl(opt.async, nil, true))
	local rf = merge({async = r_async, type = 'pipe', error_type = 'pipe', debug_prefix = 'pipe.r'}, opt)
	local wf = merge({async = w_async, type = 'pipe', error_type = 'pipe', debug_prefix = 'pipe.w'}, opt)
	local flags = not opt.inheritable and O_CLOEXEC or 0
	check_errno(C.pipe2(pipe_fds, flags) == 0)
	local rf = _make_file(owner, pipe_fds[0], rf)
	local wf = _make_file(owner, pipe_fds[1], wf)
	--both files are owned now so any _init_file() call can fail without leaking.
	_init_file(rf)
	_init_file(wf)
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

local function make_stdpipe(fd, debug_prefix)
	return memoize(function()
		local f = {
			type = 'pipe', error_type = 'pipe', async = true,
			debug_prefix = debug_prefix,
		}
		return _init_file(_make_file(mainthread(), fd, f))
	end)
end
stdin_async_pipe  = make_stdpipe(0, '<stdin>' )
stdout_async_pipe = make_stdpipe(1, '<stdout>')
stderr_async_pipe = make_stdpipe(2, '<stderr>')

--eventfd --------------------------------------------------------------------

cdef'int eventfd(unsigned int initval, int flags);'

EFD_SEMAPHORE = 1

function eventfd(initval, flags)
	local owner = _check_owner()
	local fd = C.eventfd(initval or 0, bor(O_CLOEXEC, flags or 0))
	check_errno(fd ~= -1)
	local f = _init_file(_make_file(owner, fd, {
		type = 'eventfd', debug_prefix = 'E',
		async = true, quiet = true,
	}))
	local rbuf = new'uint64_t[1]'
	local wbuf = new'uint64_t[1]'
	f.read_value = function(f)
		f:readn(rbuf, 8)
		return tonumber(rbuf[0])
	end
	f.write_value = function(f, n)
		wbuf[0] = n or 1
		f:write(wbuf, 8)
	end
	return f
end

--i/o ------------------------------------------------------------------------

cdef[[
ssize_t read(int fd, void *buf, size_t count);
ssize_t write(int fd, const void *buf, size_t count);
int fsync(int fd);
int64_t lseek(int fd, int64_t offset, int whence) asm("lseek64");
]]


local file_async_read = _make_async('r', true, function(self, buf, len)
	return tonumber(C.read(self.fd, buf, len))
end)

local file_async_write = _make_async('w', true, function(self, buf, len)
	return tonumber(C.write(self.fd, buf, len))
end)

--TODO: remove try_read() entirely after updating its callsites.
--NOTE: to read many small pieces use a pbuffer instead, this will crawl!
function file.try_read(f, buf, sz)
	assert(sz and sz > 0, 'read size must be > 0')
	f:check_closed()
	if f.async then
		return file_async_read(f, buf, sz)
	else
		local n = C.read(f.fd, buf, sz)
		if n == -1 then return try_errno() end
		n = tonumber(n)
		f.r = f.r + n
		return n
	end
end
file.read = make_raising('read', file.try_read)

function file.sync(f)
	f:check_closed()
	local ok = C.fsync(f.fd) == 0
	if not ok and errno() == EINVAL then return true end --vboxfs
	return f:check_io('sync', try_errno(ok))
end

--synonims for familiarity with Lua's io module.
file.flush = file.sync

local whences = {set = 0, cur = 1, ['end'] = 2} --FILE_*
function file.seek(f, whence, offset)
	f:check_closed()
	if tonumber(whence) and not offset then --middle arg missing
		whence, offset = 'cur', tonumber(whence)
	end
	whence = whence or 'cur'
	offset = tonumber(offset or 0)
	whence = assertf(whences[whence], 'invalid whence: "%s"', whence)
	local offs = C.lseek(f.fd, offset, whence)
	if offs == -1 then f:check_io('seek', try_errno()) end
	return tonumber(offs)
end

--NOTE: to write many small pieces use a pbuffer instead, this will crawl!
function file.write(f, buf, sz)
	f:check_closed()
	sz = sz or #buf
	if sz == 0 then return end --mask out null writes
	::again::
	local len, err
	if f.async then
		len, err = file_async_write(f, buf, sz)
	else
		len = C.write(f.fd, buf, sz)
		if len == -1 then
			len, err = try_errno()
		else
			len = tonumber(len)
			f.w = f.w + len
		end
	end
	if len == sz then
		return
	elseif not len then --short write
		if err == 'interrupted' then goto again end
		f:check_io('write', false, err)
	end
	assert(len > 0)
	if isstr(buf) then --only make pointer on the rare second iteration.
		buf = cast(u8p, buf)
	end
	buf = buf + len
	sz  = sz  - len
	goto again
end

--NOTE: to read many small pieces use a pbuffer instead, this will crawl!
function file.readn(f, buf, sz)
	if sz == 0 then return true end
	local buf = cast(u8p, buf)
	::again::
	local len, err = f:try_read(buf, sz)
	if err == 'interrupted' then goto again end
	if not len or len == 0 then --short read
		f:check_io('read', false, err or 'eof')
	end
	if sz == len then return true end
	buf = buf + len
	sz  = sz  - len
	goto again
end

--truncate -------------------------------------------------------------------

cdef[[
int ftruncate(int fd, int64_t length);
int fallocate64(int fd, int mode, off64_t offset, off64_t len);
]]

--NOTE: ftruncate() creates a sparse file (and so would seeking past size
--and writing there), so we need to call fallocate() to actually reserve
--any disk space. OTOH, fallocate() is only efficient on some file systems.

local function fallocate(f, size)
	local cursize = f:attr'size'
	if size <= cursize then return true end
	local ok, err = try_errno(C.fallocate64(f.fd, 0, 0, size) == 0)
	if ok then return true end
	if err == 'no_space' then
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
function file.truncate(f, size, opt)
	assert(isnum(size), 'size expected')
	f:check_closed()
	opt = opt or 'fallocate fail' --avoid creating a sparse file
	if not f.shm then
		if opt:find'fallocate' then
			local ok, err = fallocate(f, size)
			if not ok and opt:find'fail' then
				f:check_io('truncate', false, err)
			end
		end
	end
	f:check_io('truncate', try_errno(C.ftruncate(f.fd, size) == 0))
	if not f.shm then
		return f:seek('set', size)
	end
end

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
	local ok, err = try_errno(C.getcwd(cbuf, 4096) ~= nil)
	check_fs('cwd', 'cwd', ok, err)
	return str(cbuf)
end
startcwd = memoize(cwd)

function chdir(dir)
	startcwd()
	local ok, err = try_errno(C.chdir(dir) == 0)
	check_fs(dir, 'chdir', ok, err)
	log('', 'fs', 'chdir', '%s', dir)
	return dir
end

local function _try_mkdir(path, perms)
	perms = perms and parse_perms(perms) or default_dir_perms
	local ok, err = try_errno(C.mkdir(path, perms) == 0)
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
function mkdir(dir, recursive, perms, sync)
	if recursive then
		local d = path_normalize(dir, true, true) --avoid creating dir in dir/.. sequences
		assertf(d and d ~= '.', '%s: invalid_path', dir)
		local t = {}
		while true do
			local ok, err = _try_mkdir(d, perms)
			if ok then
				if sync ~= false and err ~= 'already_exists' then
					sync_dir(dirname(d))
				end
				break
			end
			if err ~= 'not_found' then
				check_fs(d, 'mkdir', false, err)
			end
			push(t, d)
			d = dirname(d)
			check_fs(dir, 'mkdir', d and d ~= '.' and d ~= '/', 'not_found')
		end
		while #t > 0 do
			local p = pop(t)
			local ok, err = _try_mkdir(p, perms)
			check_fs(p, 'mkdir', ok, err)
			if sync ~= false and err ~= 'already_exists' then
				sync_dir(dirname(p))
			end
		end
		return dir
	else
		local ok, err = _try_mkdir(dir, perms)
		check_fs(dir, 'mkdir', ok, err)
		if sync ~= false and err ~= 'already_exists' then
			sync_dir(dirname(dir))
		end
		return dir, err
	end
end

function mkdirs(filepath, perms, sync)
	local dir = dirname(filepath)
	if dir and dir ~= '.' and dir ~= '/' then
		mkdir(dir, true, perms, sync)
	end
	return filepath
end

function rmdir(dir, sync)
	local ok, err = try_errno(C.rmdir(dir) == 0)
	check_fs(dir, 'rmdir', ok or err == 'not_found', err)
	if ok then
		if sync ~= false then sync_dir(dirname(dir)) end
		log('note', 'fs', 'rmdir', '%s', dir)
	end
	return dir, err
end

function rmfile(path, sync)
	local ok, err = try_errno(C.unlink(path) == 0)
	check_fs(path, 'rmfile', ok or err == 'not_found', err)
	if ok then
		if sync ~= false then sync_dir(dirname(path)) end
		log('note', 'fs', 'rmfile', '%s', path)
	end
	return path, err
end

local function rmdir_recursive(dir, sync)
	for file, d in try_ls(dir) do
		local filepath = indir(dir, file)
		local filetype, err = d:attr('type', false)
		assert(filetype or err == 'not_found', err)
		if filetype == 'dir' then
			rmdir_recursive(filepath, false)
		elseif filetype then
			rmfile(filepath, false)
		end
	end
	return rmdir(dir, sync)
end

function rm_rf(path, sync)
	--not recursing if the dir is a symlink, unless it has an endsep!
	if not path:ends'/' then
		local type, err = file_attr(path, 'type', false)
		if not type then return path, err end --not_found (file_attr raises on other errors)
		if type == 'symlink' then
			return rmfile(path, sync)
		end
	end
	return rmdir_recursive(path, sync)
end

function rename(old_path, new_path, dst_dirs_perms, sync)
	if dst_dirs_perms ~= false then
		mkdirs(new_path, dst_dirs_perms, sync)
	end
	local ok, err = try_errno(C.rename(old_path, new_path) == 0)
	if not ok then check_fs(old_path..' -> '..new_path, 'rename', false, err) end
	if sync ~= false then
		local d1 = dirname(old_path)
		local d2 = dirname(new_path)
		sync_dir(d1)
		if d2 ~= d1 then sync_dir(d2) end
	end
	log('note', 'fs', 'mv', 'old: %s\nnew: %s', old_path, new_path)
	return true
end

--if using `mount -o dirsync` this is reduntant.
function sync_dir(dir, quiet)
	assert(dir, 'sync_dir: dir required') --because dirname(file) can return nil
	local f, err = open{path = dir, flags = 'rdonly directory', quiet = quiet}
	check_fs(dir, 'sync_dir', f, err)
	f:sync()
	local ok, err = f:try_close()
	check_fs(dir, 'sync_dir', ok, err)
end

function symlink(link_path, target_path, replace, sync)
	if replace == nil then replace = 'replace' end
	local ok, err = try_errno(C.symlink(target_path, link_path) == 0)
	if not ok and err == 'already_exists' and replace
		and file_attr(link_path, 'type', false) == 'symlink'
	then
		assert(replace == 'replace')
		if readlink(link_path, 'raw') == target_path then
			return link_path, 'already_exists'
		end
		local tmp = link_path..'~'..getpid()
		local ok1, err1 = try_errno(C.symlink(target_path, tmp) == 0)
		check_fs(tmp, 'symlink', ok1, 'symlink to %s: %s', target_path, err1)
		local ok2, err2 = try_errno(C.rename(tmp, link_path) == 0)
		if not ok2 then
			rmfile(tmp)
			check_fs(tmp, 'symlink', false, 'rename to %s: %s', link_path, err2)
		end
		ok, err = true, 'replaced'
	end
	check_fs(link_path, 'symlink', ok, 'symlink to %s: %s', target_path, err)
	if sync ~= false then
		sync_dir(dirname(link_path))
	end
	log('note', 'fs', 'symlink', 'link:   %s\ntarget:  %s', link_path, target_path)
	return link_path, err
end

function hardlink(link_path, target_path, sync)
	local ok, err = try_errno(C.link(target_path, link_path) == 0)
	if not ok and err == 'already_exists' then --check if the target is the same
		local i1 = file_attr(target_path, 'inode', false)
		local i2 = file_attr(link_path, 'inode', false)
		if i1 and i2 and i1 == i2 then
			return link_path, 'already_exists'
		end
	end
	check_fs(link_path, 'hardlink', ok, 'hardlink to %s: %s', target_path, err)
	if sync ~= false then
		sync_dir(dirname(link_path))
	end
	log('note', 'fs', 'hardlink', 'link:   %s\ntarget:  %s', link_path, target_path)
	return link_path
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
		return try_errno()
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
function readlink(link, maxdepth)
	maxdepth = maxdepth or 32
	assert(maxdepth == 'raw' or (maxdepth > 0 and maxdepth <= 32))
	local target, err = _try_readlink(link, maxdepth)
	if not target and err == 'not_found' then return nil, err end
	return check_fs(link, 'readlink', target, err)
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
		if not ok then return try_errno() end
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
	return try_errno(C.futimens(f.fd, ts) == 0)
end

local function utimes(path, atime, mtime)
	set_timespec(atime, ts[0])
	set_timespec(mtime, ts[1])
	return try_errno(C.utimensat(AT_FDCWD, path, ts, 0) == 0)
end

local AT_SYMLINK_NOFOLLOW = 0x100

local function lutimes(path, atime, mtime)
	set_timespec(atime, ts[0])
	set_timespec(mtime, ts[1])
	return try_errno(C.utimensat(AT_FDCWD, path, ts, AT_SYMLINK_NOFOLLOW) == 0)
end

cdef[[
int fchmod(int fd,           mode_t mode);
int  chmod(const char *path, mode_t mode);
]]

local function wrap(chmod_func, stat_func)
	return function(f, perms)
		assert(perms, 'perms missing')
		local perms, is_rel = parse_perms(perms)
		if is_rel then
			local cur_perms, err = stat_func(f, 'perms')
			if not cur_perms then return nil, err end
			perms = parse_perms(perms, cur_perms)
		end
		return try_errno(chmod_func(f, perms) == 0)
	end
end
local fchmod = wrap(function(f, mode) return C.fchmod(f.fd, mode) end, fstat)
local pchmod = wrap(C.chmod, stat)
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
	if not p then return nil, 'not_found' end
	return p.pw_uid
end
local function get_gid(s)
	if not s or isnum(s) then return s end
	local p = ptr(C.getgrnam(s))
	if not p then return nil, 'not_found' end
	return p.gr_gid
end

local function get_uid_gid(uid, gid)
	local uid, err = get_uid(uid); if err then return nil, nil, 'user_not_found' end
	local gid, err = get_gid(gid); if err then return nil, nil, 'group_not_found' end
	return uid or -1, gid or -1
end
local function fchown(f, uid, gid)
	local uid, gid, err = get_uid_gid(uid, gid)
	if err then return nil, err end
	return try_errno(C.fchown(f.fd, uid, gid) == 0)
end
local function pchown(path, uid, gid)
	local uid, gid, err = get_uid_gid(uid, gid)
	if err then return nil, err end
	return try_errno(C.chown(path, uid, gid) == 0)
end
local function lchown(path, uid, gid)
	local uid, gid, err = get_uid_gid(uid, gid)
	if err then return nil, err end
	return try_errno(C.lchown(path, uid, gid) == 0)
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
local set_deref     = wrap(pchmod, pchown,  utimes)
local set_symlink   = wrap(lchmod, lchown, lutimes)

local function fs_attr_set(path, t, deref)
	local set = deref and set_deref or set_symlink
	return set(path, t)
end

function file.attr(f, attr)
	if istab(attr) then
		return f:set_attr(attr)
	end
	f:check_closed()
	local ret, err = fstat(f, attr)
	if err then f:check_io('attr', false, err) end
	return ret
end

function file.set_attr(f, attr)
	f:check_closed()
	assertf(istab(attr), 'table expected, got: %s', type(attr))
	local ret, err = file_attr_set(f, attr)
	if err then f:check_io('set_attr', false, err) end
	return ret
end

function file.size(f)
	return f:attr'size'
end

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

function set_file_attr(path, attr, deref)
	attr, deref = set_attr_args(attr, deref)
	local ret, err = fs_attr_set(path, attr, deref)
	local ok = ret ~= nil or err == nil or err == 'not_found'
	check_fs(path, 'set_attr', ok, err)
	return ret, err
end

function file_attr(path, ...)
	local attr, deref = attr_args(...)
	if istab(attr) then
		return set_file_attr(path, attr, deref)
	end
	if attr == 'target' then
		return readlink(path)
	end
	local ret, err = fs_attr_get(path, attr, deref)
	local ok = ret ~= nil or err == nil or err == 'not_found'
	check_fs(path, 'attr', ok, err)
	return ret, err
end

function mtime(file, deref)
	return file_attr(file, 'mtime', deref)
end

function chmod(path, perms)
	local _, err = set_file_attr(path, {perms = perms})
	if not err then log('note', 'fs', 'chmod', '%s %s', path, perms) end
	return path, err
end
function chown(path, uid, gid)
	local _, err = set_file_attr(path, {uid = uid, gid = gid})
	if not err then
		log('note', 'fs', 'chown', '%s%s%s', path,
			uid and ' uid='..uid or '',
			gid and ' gid='..gid or '')
	end
	return path, err
end

function file_is(path, type, deref)
	if type == 'symlink' then
		deref = false
	end
	local ftype, err = file_attr(path, 'type', deref)
	if not ftype then return false, err end
	if not type then return true end
	return ftype == type
end
exists = file_is

function check_exists(path, type, deref)
	check_fs(path, 'exists', exists(path, type, deref), 'not_found')
end

--file locking ---------------------------------------------------------------

cdef'int flock(int fd, int operation);'

local LOCK_SH = 1 --shared
local LOCK_EX = 2 --exclusive
local LOCK_NB = 4 --non-blocking
local LOCK_UN = 8 --unlock

local lock_ops = {r = LOCK_SH, w = LOCK_EX, un = LOCK_UN}

--NOTE: returns true, 'again' if nonblock is passed but lock not acquired.
function file.lock(f, op, nonblock)
	f:check_closed()
	local flags = assertf(lock_ops[op or 'w'], 'invalid lock op: %s', op)
	if nonblock then flags = bor(flags, LOCK_NB) end
	local ok, err = try_errno(C.flock(f.fd, flags) == 0)
	if ok then return true end
	if err == 'again' then return true, 'again' end
	return f:check_io('lock', false, err)
end
function file.unlock(f, nonblock)
	return f:lock('un', nonblock)
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

local dir = {type = 'dir', error_type = 'fs', debug_prefix = 'd'}

function dir.try_close(d)
	if d:closed() then return true end
	local _dirp = d._dirp
	d._dirp = nil --close barrier
	check_errno(C.closedir(_dirp) == 0)
	_disown(d)
	return true
end
dir.close = make_raising('close', dir.try_close)

function dir.closed(d)
	return d._dirp == nil
end
function dir:check_closed()
	if self._dirp ~= nil then return end
	error(CLOSED)
end

function dir.sync(d)
	d:check_closed()
	return check_fs(d, 'sync', try_errno(C.fsync(C.dirfd(d._dirp)) == 0))
end

function dir.dir(d)
	return d._dir
end

function dir.next(d)
	if d:closed() then
		return nil
	end
	errno(0)
	d._dentry = C.readdir(d._dirp)
	if d._dentry ~= nil then
		local name = d:name()
		if not d.dot_dirs and (name == '.' or name == '..') then
			return d:next()
		end
		return name, d
	else
		local errno = errno()
		d:close()
		if errno == 0 then
			return nil
		end
		local _, err = try_errno(false, errno)
		check_fs(d, 'next', false, err)
	end
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

local function dir_attr_get(d, attr)
	if attr == 'type' and d._dentry.d_type == DT_UNKNOWN then
		--some filesystems (eg. VFAT) require this extra call to get the type.
		local type, err = lstat(d:path(), 'type')
		if not type then
			return false, nil, err
		end
		local dt = dt_types[type]
		d._dentry.d_type = dt --cache it
	end
	if attr == 'type' then
		return dt_names[d._dentry.d_type]
	elseif attr == 'inode' then
		return d._dentry.d_ino
	else
		return nil, false
	end
end

local function check_dir(d)
	d:check_closed()
	assert(d._dentry ~= nil, 'dir not ready') --must call next() at least once.
end

local function ls_args(p, opt, if_exists)
	p = p or '.'
	if opt == 'if_exists' then
		opt, if_exists = nil, true
	elseif if_exists == 'if_exists' then
		if_exists = true
	elseif istab(opt) and opt.if_exists then
		if_exists = true
	end
	return p, opt, if_exists
end

local function open_dir(p, opt)
	local owner = _check_owner(istab(opt) and opt.owner)
	local dirp = C.opendir(p)
	if dirp == nil then
		return try_errno()
	end
	local d = object(dir, {
		_dirp = dirp,
		_dentry = nil,
		_dir = p,
		dot_dirs = istab(opt) and opt.dot_dirs,
	})
	_own(owner, d)
	return d
end

function ls(p, opt, if_exists)
	p, opt, if_exists = ls_args(p, opt, if_exists)
	local d, err = open_dir(p, opt)
	if not d then
		if if_exists and err == 'not_found' then return noop end
		check_fs(p, 'ls', false, err)
	end
	return dir.next, d
end
function try_ls(p, opt)
	return ls(p, opt, 'if_exists')
end

function dir.path(d)
	return indir(d:dir(), d:name())
end

function dir.name(d)
	check_dir(d)
	return str(d._dentry.d_name)
end

local function dir_is_symlink(d)
	return dir_attr_get(d, 'type') == 'symlink'
end

function dir.attr(d, ...)
	check_dir(d)
	local attr, deref = attr_args(...)
	local ret, err
	if attr == 'target' then
		if dir_is_symlink(d) then
			local path = d:path()
			ret, err = _try_readlink(path, 32)
		else
			return nil --no error for non-symlink files
		end
	elseif istab(attr) then
		return d:set_attr(attr, deref)
	elseif not attr or (deref and dir_is_symlink(d)) then
		ret, err = fs_attr_get(d:path(), attr, deref)
	else
		local found
		ret, found, err = dir_attr_get(d, attr)
		if err then
			ret = nil
		elseif found == false then --attr not found in state
			ret, err = fs_attr_get(d:path(), attr)
		else
			return ret
		end
	end
	if err and err ~= 'not_found' then check_fs(d, 'attr', false, err) end
	return ret, err
end

function dir.set_attr(d, attr, deref)
	check_dir(d)
	attr, deref = set_attr_args(attr, deref)
	local ret, err = fs_attr_set(d:path(), attr, deref)
	if err and err ~= 'not_found' then check_fs(d, 'set_attr', false, err) end
	return ret, err
end

function dir.size(d)
	return d:attr'size'
end

function dir.is(d, type, deref)
	if type == 'symlink' then
		deref = false
	end
	return d:attr('type', deref) == type
end

local function scandir1(path, dive)
	local ds = {}
	local _, d = try_ls(path)
	local name
	local sc = {}
	setmetatable(sc, sc)
	function sc:close()
		while d do
			d:try_close()
			d = pop(ds)
		end
		name = nil
	end
	function sc:closed()
		return not d or d:closed()
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
				local _, d1 = try_ls(d:path())
				if d1 then
					push(ds, d)
					d = d1
				end
			end
		end
		name = d:next()
		if name == nil then --end
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
		local i, n = 1, #arg
		local iter = scandir1(arg[i], dive)
		return function()
			::again::
			local sc = iter()
			if sc == nil then --end
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

function load_tobuffer(file, maxlen)
	return with_owner(function()
		local f, err = open(file)
		if not f then return nil, err end
		local buf, len = pbuffer{f = f}:readall(maxlen):ref()
		return buf, len
	end)
end

function load(file, maxlen) --load a file into a string, nil if not found.
	local buf, len = load_tobuffer(file, maxlen)
	if buf == nil then return nil, len end
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
			rename(tmpfile, file, nil, sync)
			log('note', 'fs', 'save', '%s (%s)', file, kbytes(n))
		end
	end
	local function write(buf, sz)
		assert(not (f and f:closed()))
		local ok, err
		if buf == nil and sz ~= 0 then --caller wants to abort with error
			ok, err = buf, sz
		else
			ok, err = catch('fs', _write, buf, sz)
		end
		if ok then
			return true, f:closed() and 'closed' or nil
		else
			if f then
				f:try_close()
				catch('fs', rmfile, tmpfile) --best-effort
			end
			return false, err
		end
	end
	return write
end

--write a Lua value or read()->buf,sz to a file
--atomically and durably (on drives with PLP).
function save(file, arg, sz, file_perms, dir_perms, sync)
	local write = file_saver(file, file_perms, dir_perms, sync)
	if isfunc(arg) then --reader
		local read = arg
		while true do
			local ok, buf, len = pcall(read)
			if not ok then
				write(nil, buf) --abort and clean up.
				error(buf, 0) --user-code error, not a save error.
			end
			local ok, err = write(buf, len)
			check_fs(file, 'save', ok, err)
			if err == 'closed' then break end --eof
		end
	else --buffer or stringable
		local ok, err = write(arg, sz)
		check_fs(file, 'save', ok, err)
		if not err then
			local ok, err = write(nil, 0) --eof
			check_fs(file, 'save', ok, err)
		end
	end
end

function touch(file, mtime, sync) --create file or update its mtime.
	local f = open(file, 'a')
	mtime = mtime or now()
	local ok, err = futimes(f, mtime, mtime)
	check_fs(file, 'touch', ok, err)
	if sync ~= false then
		f:sync()
	end
	f:close()
	if sync ~= false then sync_dir(dirname(file)) end
	log('note', 'fs', 'touch', '%s to %s', file, date('%d-%m-%Y %H:%M', mtime))
end

--8 syscalls and many allocs to increment a number safely, maybe you need a DB :)
function gen_id(name, start)
	local next_id_file = varpath('next_'..name)
	local f = open(next_id_file, 'rw')
	f:lock'w'
	local s = pbuffer{f = f}:load(32):get()
	local n = tonumber(s)
	local need_sync_dir = not n --most likely file was created now
	n = n or start or 1
	f:check_io('gen_id', n and n >= 0 and floor(n) == n, '%s invalid: %s', next_id_file, s)
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
	local ok, err = try_errno(C.statfs(path, statfs_buf) == 0)
	if not ok then return nil, err end
	return statfs_buf
end

function fs_info(path)
	local buf, err = statfs(path)
	if not buf and err == 'not_found' then return nil, err end
	check_fs(path, 'fs_info', buf, err)
	local t = {}
	t.size = tonumber(buf.f_blocks * buf.f_bsize)
	t.free = tonumber(buf.f_bavail * buf.f_bsize)
	return t
end

--pollable pid files ---------------------------------------------------------

--NOTE: Linux 5.3+ feature, not used yet. Intended to replace polling
--for process status change in proc.lua.

local PIDFD_NONBLOCK = 0x000800

local function pidfd_try_wait(f)
	return _epoll_try_wait(f, 'r')
end
local pidfd_wait = make_raising('wait', pidfd_try_wait)

local pidfd_opt = {
	type = 'pidfd', async = true, debug_prefix = 'p',
	try_wait = pidfd_try_wait,
	wait = pidfd_wait,
}
function pidfd_open(pid_or_opt, opt)
	local f = istab(pid_or_opt)
		and update({}, pidfd_opt, pid_or_opt)
		or update({pid = pid_or_opt}, pidfd_opt, opt)
	local owner = _check_owner(f.owner)
	local flags = f.async and PIDFD_NONBLOCK or 0
	local fd = C.syscall(434, cast('int', f.pid), cast('unsigned int', flags))
	if fd == -1 then
		local _, err = try_errno()
		if err == 'no_such_process' then return nil, err end
		return check_fs('pid#'..f.pid, 'pidfd_open', false, err)
	end
	return _init_file(_make_file(owner, fd, f))
end
