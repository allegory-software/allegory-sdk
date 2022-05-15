--[=[

	Portable filesystem API for Windows, Linux and OSX.
	Written by Cosmin Apreutesei. Public Domain.

FEATURES
  * utf8 filenames on all platforms
  * symlinks and hard links on all platforms
  * memory mapping on all platforms
  * some error code unification for common error cases
  * cdata buffer-based I/O
  * platform-specific functionality exposed

FILE OBJECTS
	fs.open(path[, mode|opt]) -> f                open file
	f:close()                                     close file
	f:closed() -> true|false                      check if file is closed
	fs.isfile(f) -> true|false                    check if f is a file object
	f.handle -> HANDLE                            Windows HANDLE (Windows platforms)
	f.fd -> fd                                    POSIX file descriptor (POSIX platforms)
PIPES
	fs.pipe() -> rf, wf                           create an anonymous pipe
	fs.pipe({path=,<opt>=} | path[,options]) -> pf   create a named pipe (Windows)
	fs.pipe({path=,mode=} | path[,mode]) -> true  create a named pipe (POSIX)
STDIO STREAMS
	f:stream(mode) -> fs                          open a FILE* object from a file
	fs:close()                                    close the FILE* object
MEMORY STREAMS
	fs.open_buffer(buf, [size], [mode]) -> f      create a memory stream
FILE I/O
	f:read(buf, len) -> readlen                   read data from file
	f:readn(buf, n) -> true                       read exactly n bytes
	f:readall([expires], [ignore_file_size]) -> buf, len    read until EOF into a buffer
	f:write(s | buf,len) -> true                  write data to file
	f:flush()                                     flush buffers
	f:seek([whence] [, offset]) -> pos            get/set the file pointer
	f:truncate([opt])                             truncate file to current file pointer
	f:buffered_read([bufsize]) -> read(buf, sz)   get a buffered read function
OPEN FILE ATTRIBUTES
	f:attr([attr]) -> val|t                       get/set attribute(s) of open file
	f:size() -> n                                 get file size
DIRECTORY LISTING
	fs.dir(dir, [opt]) -> d, next                 directory contents iterator
	d:next() -> name, d                           call the iterator explicitly
	d:close()                                     close iterator
	d:closed() -> true|false                      check if iterator is closed
	d:name() -> s                                 dir entry's name
	d:dir() -> s                                  dir that was passed to fs.dir()
	d:path() -> s                                 full path of the dir entry
	d:attr([attr, ][deref]) -> t|val              get/set dir entry attribute(s)
	d:is(type, [deref]) -> t|f                    check if dir entry is of type
FILE ATTRIBUTES
	fs.attr(path, [attr, ][deref]) -> t|val       get/set file attribute(s)
	fs.is(path, [type], [deref]) -> t|f           check if file exists or is of a certain type
FILESYSTEM OPS
	fs.mkdir(path, [recursive], [perms])          make directory
	fs.cwd() -> path                              get current working directory
	fs.chdir(path)                                set current working directory
	fs.startcwd() -> path                         get the cwd that process started with
	fs.remove(path, [recursive])                  remove file or directory (recursively)
	fs.move(path, newpath, [opt])                 rename/move file on the same filesystem
SYMLINKS & HARDLINKS
	fs.mksymlink(symlink, path, is_dir)           create a symbolic link for a file or dir
	fs.mkhardlink(hardlink, path)                 create a hard link for a file
	fs.readlink(path) -> path                     dereference a symlink recursively
COMMON PATHS
	fs.homedir() -> path                          get current user's home directory
	fs.tmpdir() -> path                           get the temporary directory
	fs.exepath() -> path                          get the full path of the running executable
	fs.exedir() -> path                           get the directory of the running executable
	fs.appdir([appname]) -> path                  get the current user's app data dir
	fs.scriptdir() -> path                        get the directory of the main script
LOW LEVEL
	fs.wrap_handle(HANDLE) -> f                   wrap opened HANDLE (Windows)
	fs.wrap_fd(fd) -> f                           wrap opened file descriptor
	fs.wrap_file(FILE*) -> f                      wrap opened FILE* object
	fs.fileno(FILE*) -> fd                        get stream's file descriptor
MEMORY MAPPING
	fs.map(...) -> map                            create a memory mapping
	f:map([offset],[size],[addr],[access]) -> map   create a memory mapping
	map.addr                                      a void* pointer to the mapped memory
	map.size                                      size of the mapped memory in bytes
	map:flush([async, ][addr, size])              flush (parts of) the mapping to disk
	map:free()                                    release the memory and associated resources
	fs.unlink_mapfile(tagname)                    remove the shared memory file from disk (Linux, OSX)
	map:unlink()
	fs.mirror_buffer([size], [addr]) -> map       create a mirrored memory-mapped ring buffer
	fs.pagesize() -> bytes                        get allocation granularity
	fs.aligned_size(bytes[, dir]) -> bytes        next/prev page-aligned size
	fs.aligned_addr(ptr[, dir]) -> ptr            next/prev page-aligned address
FILESYSTEM INFO
	fs.info(path) -> {size=, free=}               get free/total disk space for a path
HI-LEVEL APIs
	fs.load[_tobuffer](path, [ignore_fsize]) -> buf,len  read file to string or buffer
	fs.save(path, v | buf,len | t | read)         atomic save value/buffer/array/read-results
	fs.saver(path) -> f(v | buf,len | t | read)   atomic save writer function

The `deref` arg is true by default, meaning that by default, symlinks are
followed recursively and transparently where this option is available.

All functions raise on user error and unrecoverable OS error, but return
`nil,err` on recoverable failure. Functions which are listed as having no
return value actually return true for indicating success. Recoverable errors
are normalized and made portable, eg. 'not_found' (see full list below).

FILE ATTRIBUTES

 attr          | Win    | OSX    | Linux    | Description
 --------------+--------+--------+----------+--------------------------------
 type          | r      | r      | r        | file type (see below)
 size          | r      | r      | r        | file size
 atime         | rw     | rw     | rw       | last access time (seldom correct)
 mtime         | rw     | rw     | rw       | last contents-change time
 btime         | rw     | r      |          | creation (aka "birth") time
 ctime         | rw     | r      | r        | last metadata-or-contents-change time
 target        | r      | r      | r        | symlink's target (nil if not symlink)
 dosname       | r      |        |          | 8.3 filename (Windows)
 archive       | rw     |        |          | archive bit (for backup programs)
 hidden        | rw     |        |          | hidden bit (don't show in Explorer)
 readonly      | rw     |        |          | read-only bit (can't open in write mode)
 system        | rw     |        |          | system bit
 temporary     | rw     |        |          | writes need not be commited to storage
 not_indexed   | rw     |        |          | exclude from indexing
 sparse_file   | r      |        |          | file is sparse
 reparse_point | r      |        |          | has a reparse point or is a symlink
 compressed    | r      |        |          | file is compressed
 encrypted     | r      |        |          | file is encrypted
 perms         |        | rw     | rw       | permissions
 uid           |        | rw     | rw       | user id
 gid           |        | rw     | rw       | group id
 dev           |        | r      | r        | device id containing the file
 inode         |        | r      | r        | inode number (int64_t)
 volume        | r      |        |          | volume serial number
 id            | r      |        |          | file id (int64_t)
 nlink         | r      | r      | r        | number of hard links
 rdev          |        | r      | r        | device id (if special file)
 blksize       |        | r      | r        | block size for I/O
 blocks        |        | r      | r        | number of 512B blocks allocated

On the table above, `r` means that the attribute is read/only and `rw` means
that the attribute can be changed. Attributes can be queried and changed
from different contexts via `f:attr()`, `fs.attr()` and `d:attr()`.

NOTE: File sizes and offsets are Lua numbers not 64bit ints, so they can
hold at most 8KTB. This will change when that becomes a problem.

FILE TYPES

 name         | Win    | OSX    | Linux    | description
 -------------+--------+--------+----------+---------------------------------
 file         | *      | *      | *        | file is a regular file
 dir          | *      | *      | *        | file is a directory
 symlink      | *      | *      | *        | file is a symlink
 dev          | *      |        |          | file is a Windows device
 blockdev     |        | *      | *        | file is a block device
 chardev      |        | *      | *        | file is a character device
 pipe         |        | *      | *        | file is a pipe
 socket       |        | *      | *        | file is a socket
 unknown      |        | *      | *        | file type unknown


NORMALIZED ERROR MESSAGES

	not_found          file/dir/path not found
	io_error           I/O error
	access_denied      access denied
	already_exists     file/dir already exists
	is_dir             trying this on a directory
	not_empty          dir not empty (for remove())
	io_error           I/O error
	disk_full          no space left on device

File Objects -----------------------------------------------------------------

fs.open(path[, mode|opt]) -> f

Open/create a file for reading and/or writing. The second arg can be a string:

	'r'  : open; allow reading only (default)
	'r+' : open; allow reading and writing
	'w'  : open and truncate or create; allow writing only
	'w+' : open and truncate or create; allow reading and writing
	'a'  : open and seek to end or create; allow writing only
	'a+' : open and seek to end or create; allow reading and writing

	... or an options table with platform-specific options which represent
	OR-ed bitmask flags which must be given either as 'foo bar ...',
	{foo=true, bar=true} or {'foo', 'bar'}, eg. {sharing = 'read write'}
	sets the `dwShareMode` argument of CreateFile() to
	`FILE_SHARE_READ | FILE_SHARE_WRITE` on Windows.
	All fields and flags are documented in the code.

 field     | OS           | reference                              | default
 ----------+--------------+----------------------------------------+----------
 access    | Windows      | `CreateFile() / dwDesiredAccess`       | 'file_read'
 sharing   | Windows      | `CreateFile() / dwShareMode`           | 'file_read'
 creation  | Windows      | `CreateFile() / dwCreationDisposition` | 'open_existing'
 attrs     | Windows      | `CreateFile() / dwFlagsAndAttributes`  | ''
 flags     | Windows      | `CreateFile() / dwFlagsAndAttributes`  | ''
 flags     | Linux, OSX   | `open() / flags`                       | 'rdonly'
 mode      | Linux, OSX   | `octal or symbolic perms`              | '0666' / 'rwx'

The `mode` arg is passed to `unixperms.parse()`.

Pipes ------------------------------------------------------------------------

fs.pipe() -> rf, wf

	Create an anonymous (unnamed) pipe. Return two files corresponding to the
	read and write ends of the pipe.

	NOTE: If you're using async anonymous pipes in Windows _and_ you're
	also creating multiple Lua states _per OS thread_, make sure to set a unique
	`fs.lua_state_id` per Lua state to distinguish them. That is because
	in Windows, async anonymous pipes are emulated using named pipes.

fs.pipe({path=,<opt>=} | path[,options]) -> pf

	Create or open a named pipe (Windows). Named pipes on Windows cannot
	be created in any directory like on POSIX systems, instead they must be
	created in the special directory called `\\.\pipe`. After creation,
	named pipes can be opened for reading and writing like normal files.

	Named pipes on Windows cannot be removed and are not persistent. They are
	destroyed automatically when the process that created them exits.

fs.pipe({path=,mode=} | path[,mode]) -> true

	Create a named pipe (POSIX). Named pipes on POSIX are persistent and can be
	created in any directory as they are just a type of file.

Stdio Streams ----------------------------------------------------------------

f:stream(mode) -> fs

	Open a `FILE*` object from a file. The file should not be used anymore while
	a stream is open on it and `fs:close()` should be called to close the file.

fs:close()

	Close the `FILE*` object and the underlying file object.

Memory Streams ---------------------------------------------------------------

fs.open_buffer(buf, [size], [mode]) -> f

	Create a memory stream for reading and writing data from and into a buffer
	using the file API. Only opening modes 'r' and 'w' are supported.

File I/O ---------------------------------------------------------------------

f:read(buf, len, [expires]) -> readlen

	Read data from file. Returns (and keeps returning) 0 on EOF or broken pipe.

f:readn(buf, len, [expires]) -> true

	Read data from file until `len` is read.
	Partial reads are signaled with `nil, err, readlen`.

f:readall([expires]) -> buf, len

	Read until EOF into a buffer.

f:write(s | buf,len) -> true

	Write data to file.
	Partial writes are signaled with `nil, err, writelen`.

f:flush()

	Flush buffers.

f:seek([whence] [, offset]) -> pos

	Get/set the file pointer. Same semantics as standard `io` module seek
	i.e. `whence` defaults to `'cur'` and `offset` defaults to `0`.

f:truncate(size, [opt])

	Truncate file to given `size` and move the current file pointer to `EOF`.
	This can be done both to shorten a file and thus free disk space, or to
	preallocate disk space to be subsequently filled (eg. when downloading a file).

	On Linux

		`opt` is an optional string for Linux which can contain any of the words
		`fallocate` (call `fallocate()`) and `fail` (do not call `ftruncate()`
		if `fallocate()` fails: return an error instead). The problem with calling
		`ftruncate()` if `fallocate()` fails is that on most filesystems, that
		creates a sparse file which doesn't help if what you want is to actually
		reserve space on the disk, hence the `fail` option. The default is
		`'fallocate fail'` which should never create a sparse file, but it can be
		slow on some file systems (when it's emulated) or it can just fail
		(like on virtual filesystems).

		Btw, seeking past EOF and writing something there will also create a sparse
		file, so there's no easy way out of this complexity.

	On Windows

		On NTFS truncation is smarter: disk space is reserved but no zero bytes are
		written. Those bytes are only written on subsequent write calls that skip
		over the reserved area, otherwise there's no overhead.

f:buffered_read([bufsize]) -> read(buf, len)

	Returns a `read(buf, len) -> readlen` function which reads ahead from file
	in order to lower the number of syscalls. `bufsize` specifies the buffer's
	size (default is 64K).

Open file attributes ---------------------------------------------------------

f:attr([attr]) -> val|t

	Get/set attribute(s) of open file. `attr` can be:
	* nothing/nil: get the values of all attributes in a table.
	* string: get the value of a single attribute.
	* table: set one or more attributes.

Directory listing ------------------------------------------------------------

fs.dir([dir], [opt]) -> d, next

	Directory contents iterator. `dir` defaults to '.'.
	`opt` is a string that can include:
		* `..`   :  include `.` and `..` dir entries (excluded by default).

	USAGE

		for name, d in fs.dir() do
			if not name then
				print('error: ', d)
				break
			end
			print(d:attr'type', name)
		end

	Always include the `if not name` condition when iterating. The iterator
	doesn't raise any errors. Instead it returns `false, err` as the
	last iteration when encountering an error. Initial errors from calling
	`fs.dir()` (eg. `'not_found'`) are passed to the iterator also, so the
	iterator must be called at least once to see them.

	d:next() -> name, d | false, err | nil

		Call the iterator explicitly.

	d:close()

		Close the iterator. Always call `d:close()` before breaking the for loop
		except when it's an error (in which case `d` holds the error message).

	d:closed() -> true|false

		Check if the iterator is closed.

	d:name() -> s

		The name of the current file or directory being iterated.

	d:dir() -> s

		The directory that was passed to `fs.dir()`.

	d:path() -> s

		The full path of the current dir entry (`d:dir()` combined with `d:name()`).

	d:attr([attr, ][deref]) -> t|val

		Get/set dir entry attribute(s).

		`deref` means return the attribute(s) of the symlink's target if the file is
		a symlink (`deref` defaults to `true`!). When `deref=true`, even the `'type'`
		attribute is the type of the target, so it will never be `'symlink'`.

		Some attributes for directory entries are free to get (but not for symlinks
		when `deref=true`) meaning that they don't require a system call for each
		file, notably `type` on all platforms, `atime`, `mtime`, `btime`, `size`
		and `dosname` on Windows and `inode` on Linux and OSX.

	d:is(type, [deref]) -> true|false

		Check if dir entry is of type.

fs.scandir([path]) -> iter() -> sc

	Recursive dir walker. All sc methods return `nil, err` if an error occured
	on the current dir entry, but the iteration otherwise continues.
	`depth` arg can be 0=sc:depth(), 1=first-level, -1=parent-level, etc.

	sc:close()
	sc:closed() -> true|false
	sc:name([depth]) -> s
	sc:dir([depth]) -> s
	sc:path([depth]) -> s
	sc:attr([attr, ][deref]) -> t|val
	sc:depth([n]) -> n (from 1)

File attributes --------------------------------------------------------------

fs.attr(path, [attr, ][deref]) -> t|val

	Get/set a file's attribute(s) given its path in utf8.

fs.is(path, [type], [deref]) -> true|false

	Check if file exists or if it is of a certain type.

Filesystem operations --------------------------------------------------------

fs.mkdir(path, [recursive], [perms])

	Make directory. `perms` can be a number or a string passed to `unixperms.parse()`.

	NOTE: In recursive mode, if the directory already exists this function
	returns `true, 'already_exists'`.

fs.cd|cwd|chdir([path]) -> path

	Get/set current directory.

fs.remove(path, [recursive])

	Remove a file or directory (recursively if `recursive=true`).

fs.move(path, newpath, [opt])

	Rename/move a file on the same filesystem. On Windows, `opt` represents
	the `MOVEFILE_*` flags and defaults to `'replace_existing write_through'`.

	This operation is atomic on all platforms.

Symlinks & Hardlinks ---------------------------------------------------------

fs.mksymlink(symlink, path, is_dir)

	Create a symbolic link for a file or dir. The `is_dir` arg is required
	for Windows for creating symlinks to directories. It's ignored on Linux
	and OSX.

fs.mkhardlink(hardlink, path)

	Create a hard link for a file.

fs.readlink(path) -> path

	Dereference a symlink recursively. The result can be an absolute or
	relative path which can be valid or not.

Memory Mapping ---------------------------------------------------------------

	FEATURES
	  * file-backed and pagefile-backed (anonymous) memory maps
	  * read-only, read/write and copy-on-write access modes plus executable flag
	  * name-tagged memory maps for sharing memory between processes
	  * mirrored memory maps for using with lock-free ring buffers.
	  * synchronous and asynchronous flushing

	LIMITATIONS
	  * I/O errors from accessing mmapped memory cause a crash (and there's
	  nothing that can be done about that with the current ffi), which makes
	  this API unsuitable for mapping files from removable media or recovering
	  from write failures in general. For all other uses it is fine.

fs.map(args_t) -> map
fs.map(path, [access], [size], [offset], [addr], [tagname], [perms]) -> map
f:map([offset], [size], [addr], [access])

	Create a memory map object. Args:

	* `path`: the file to map: optional; if nil, a portion of the system pagefile
	will be mapped instead.
	* `access`: can be either:
		* '' (read-only, default)
		* 'w' (read + write)
		* 'c' (read + copy-on-write)
		* 'x' (read + execute)
		* 'wx' (read + write + execute)
		* 'cx' (read + copy-on-write + execute)
	* `size`: the size of the memory segment (optional, defaults to file size).
		* if given it must be > 0 or an error is raised.
		* if not given, file size is assumed.
			* if the file size is zero the mapping fails with `'file_too_short'`.
		* if the file doesn't exist:
			* if write access is given, the file is created.
			* if write access is not given, the mapping fails with `'not_found'` error.
		* if the file is shorter than the required offset + size:
			* if write access is not given (or the file is the pagefile which
			can't be resized), the mapping fails with `'file_too_short'` error.
			* if write access is given, the file is extended.
				* if the disk is full, the mapping fails with `'disk_full'` error.
	* `offset`: offset in the file (optional, defaults to 0).
		* if given, must be >= 0 or an error is raised.
		* must be aligned to a page boundary or an error is raised.
		* ignored when mapping the pagefile.
	* `addr`: address to use (optional; an error is raised if zero).
		* it's best to provide an address that is above 4 GB to avoid starving
		LuaJIT which can only allocate in the lower 4 GB of the address space.
	* `tagname`: name of the memory map (optional; cannot be used with `file`;
		must not contain slashes or backslashes).
		* using the same name in two different processes (or in the same process)
		gives access to the same memory.

	Returns an object with the fields:

	* `addr` - a `void*` pointer to the mapped memory
	* `size` - the actual size of the memory block

	If the mapping fails, returns `nil,err` where `err` can be:

	* `'not_found'` - file not found.
	* `'file_too_short'` - the file is shorter than the required size.
	* `'disk_full'` - the file cannot be extended because the disk is full.
	* `'out_of_mem'` - size or address too large or specified address in use.
	* an OS-specific error message.

NOTES

	* when mapping or resizing a `FILE` that was written to, the write buffers
	should be flushed first.
	* after mapping an opened file handle of any kind, that file handle should
	not be used anymore except to close it after the mapping is freed.
	* attempting to write to a memory block that wasn't mapped with write
	or copy-on-write access results in a crash.
	* changes done externally to a mapped file may not be visible immediately
	(or at all) to the mapped memory.
	* access to shared memory from multiple processes must be synchronized.

map:free()

	Free the memory and all associated resources and close the file
	if it was opened by the `fs.map()` call.

map:flush([async, ][addr, size]) -> true | nil,err

	Flush (part of) the memory to disk. If the address is not aligned,
	it will be automatically aligned to the left. If `async` is true,
	perform the operation asynchronously and return immediately.

fs.unlink_mapfile(tagname)` <br> `map:unlink()

	Remove a (the) shared memory file from disk. When creating a shared memory
	mapping using `tagname`, a file is created on the filesystem on Linux
	and OS X (not so on Windows). That file must be removed manually when it is
	no longer needed. This can be done anytime, even while mappings are open and
	will not affect said mappings.

fs.mirror_buffer([size], [addr]) -> map  (OSX support is NYI)

	Create a mirrored buffer to use with a lock-free ring buffer. Args:
	* `size`: the size of the memory segment (optional; one page size
	  by default. automatically aligned to the next page size).
	* `addr`: address to use (optional; can be anything convertible to `void*`).

	The result is a table with `addr` and `size` fields and all the mirror map
	objects in its array part (freeing the mirror will free all the maps).
	The memory block at `addr` is mirrored such that
	`(char*)addr[i] == (char*)addr[size+i]` for any `i` in `0..size-1`.

fs.aligned_size(bytes[, dir]) -> bytes

	Get the next larger (dir = 'right', default) or smaller (dir = 'left') size
	that is aligned to a page boundary. It can be used to align offsets and sizes.

fs.aligned_addr(ptr[, dir]) -> ptr

	Get the next (dir = 'right', default) or previous (dir = 'left') address that
	is aligned to a page boundary. It can be used to align pointers.

fs.pagesize() -> bytes

	Get the current page size. Memory will always be allocated in multiples
	of this size and file offsets must be aligned to this size too.

Async I/O --------------------------------------------------------------------

Named pipes can be opened with `async = true` option which opens them
in async mode, which uses the [sock](sock.md) scheduler to multiplex the I/O
which means all I/O then must be performed inside sock threads.
In this mode, the `read()` and `write()` methods take an additional `expires`
arg that behaves just like with sockets.

Programming Notes ------------------------------------------------------------

### Filesystem operations are non-atomic

Most filesystem operations are non-atomic (unless otherwise specified) and
thus prone to race conditions. This library makes no attempt at fixing that
and in fact it ignores the issue entirely in order to provide a simpler API.
For instance, in order to change _only_ the "archive" bit of a file on
Windows, the file attribute bits need to be read first (because WinAPI doesn't
take a mask there). That's a TOCTTOU. Resolving a symlink or removing a
directory recursively in userspace has similar issues. So never work on the
(same part of the) filesystem from multiple processes without proper locking
(watch Niall Douglas's "Racing The File System" presentation for more info).

### Flushing does not protect against power loss

Flushing does not protect against power loss on consumer hard drives because
they usually don't have non-volatile write caches (and disabling the write
cache is generally not possible nor feasible). Also, most Linux distros do
not mount ext3 filesystems with the "barrier=1" option by default which means
no power loss protection there either, even when the hardware works right.

### File locking doesn't always work

File locking APIs only work right on disk mounts and are buggy or non-existent
on network mounts (NFS, Samba).

### Async disk I/O

Async disk I/O is a complete afterthought on all major Operating Systems.
If your app is disk-bound just bite the bullet and make a thread pool.
Read Arvid Norberg's article[1] for more info.

[1] https://blog.libtorrent.org/2012/10/asynchronous-disk-io/

]=]

if not ... then require'fs_test'; return end

local ffi = require'ffi'
local bit = require'bit'
local glue = require'glue'
local path = require'path'

local min, max, floor, ceil, ln =
	math.min, math.max, math.floor, math.ceil, math.log

local C = ffi.C

local backend = setmetatable({}, {__index = _G})
setfenv(1, backend)

cdef = ffi.cdef
x64 = ffi.arch == 'x64' or nil
osx = ffi.os == 'OSX' or nil
linux = ffi.os == 'Linux' or nil
win = ffi.abi'win' or nil

--namespaces in which backends can add methods directly.
fs = {backend = backend} --fs module namespace
file = {}; file.__index = file --file object methods
stream = {}; stream.__index = stream --FILE methods
dir = {}; dir.__index = dir --dir listing object methods

local uint64_ct   = ffi.typeof'uint64_t'
local void_ptr_ct = ffi.typeof'void*'
local uintptr_ct  = ffi.typeof'uintptr_t'

memoize = glue.memoize
assertf = glue.assert
buffer = glue.buffer
update = glue.update

local u8p = glue.u8p
local u8a = glue.u8a

--error reporting ------------------------------------------------------------

cdef'char *strerror(int errnum);'

local errors = {
	[2] = 'not_found', --ENOENT, _open_osfhandle(), _fdopen(), open(), mkdir(),
	                   --rmdir(), opendir(), rename(), unlink()
	[5] = 'io_error', --EIO, readlink(), read()
	[13] = 'access_denied', --EACCESS, mkdir() etc.
	[17] = 'already_exists', --EEXIST, open(), mkdir()
	[20] = 'not_found', --ENOTDIR, opendir()
	[21] = 'is_dir', --EISDIR, unlink()
	[linux and 39 or osx and 66 or ''] = 'not_empty', --ENOTEMPTY, rmdir()
	[28] = 'disk_full', --ENOSPC: fallocate()
	[linux and 95 or ''] = 'not_supported', --EOPNOTSUPP: fallocate()
	[linux and 32 or ''] = 'eof', --EPIPE: write()
}

function check_errno(ret, errno, xtra_errors)
	if ret then return ret end
	errno = errno or ffi.errno()
	local err = errors[errno] or (xtra_errors and xtra_errors[errno])
	if not err then
		local s = C.strerror(errno)
		err = s ~= nil and ffi.string(s) or 'Error '..errno
	end
	return ret, err
end

function fs.log(...)
	local logging = fs.logging
	if not logging then return end
	logging.log(...)
end

function fs.live(...)
	local logging = fs.logging
	if not logging then return end
	logging.live(...)
end

--flags arg parsing ----------------------------------------------------------

--turn a table of boolean options into a bit mask.
local function table_flags(t, masks, strict)
	local bits = 0
	local mask = 0
	for k,v in pairs(t) do
		local flag
		if type(k) == 'string' and v then --flags as table keys: {flag->true}
			flag = k
		elseif type(k) == 'number'
			and floor(k) == k
			and type(v) == 'string'
		then --flags as array: {flag1,...}
			flag = v
		end
		local bitmask = masks[flag]
		if strict then
			assertf(bitmask, 'invalid flag: "%s"', tostring(flag))
		end
		if bitmask then
			mask = bit.bor(mask, bitmask)
			if flag then
				bits = bit.bor(bits, bitmask)
			end
		end
	end
	return bits, mask
end

--turn 'opt1 +opt2 -opt3' -> {opt1=true, opt2=true, opt3=false}
local string_flags = memoize(function(strict, masks, s)
	local t = {}
	for s in s:gmatch'[^ ,]+' do
		local m,s = s:match'^([%+%-]?)(.*)$'
		t[s] = m ~= '-'
	end
	return {table_flags(t, masks, strict)}
end)

--set one or more bits of a value without affecting other bits.
function setbits(bits, mask, over)
	return over and bit.bor(bits, bit.band(over, bit.bnot(mask))) or bits
end

function flags(arg, masks, cur_bits, strict)
	if type(arg) == 'string' then
		local bits, mask = unpack(string_flags(strict or false, masks, arg))
		return setbits(bits, mask, cur_bits)
	elseif type(arg) == 'table' then
		local bits, mask = table_flags(arg, masks, strict)
		return setbits(bits, mask, cur_bits)
	elseif type(arg) == 'number' then
		return arg
	elseif arg == nil then
		return 0
	else
		assertf(false, 'flags expected but "%s" given', type(arg))
	end
end

--file objects ---------------------------------------------------------------

function fs.isfile(f)
	local mt = getmetatable(f)
	return type(mt) == 'table' and rawget(mt, '__index') == file
end

function open_opt(mode_opt, str_opt)
	mode_opt = mode_opt or 'r'
	local opt = type(mode_opt) == 'table' and mode_opt or nil
	local mode = type(mode_opt) == 'string' and mode_opt or opt and opt.mode
	local mopt = mode and assertf(str_opt[mode], 'invalid open mode: %s', mode)
	return opt and mopt and update({}, mopt, opt) or opt or mopt
end

--returns a read(buf, sz) -> len function which reads ahead from file.
function file.buffered_read(f, bufsize)
	local ptr_ct = u8p
	local buf_ct = u8a
	local o1, err = f:size()
	local o0, err = f:seek'cur'
	if not (o0 and o1) then
		return function() return nil, err end
	end
	local bufsize = math.min(bufsize or 64 * 1024, o1 - o0)
	local buf = buf_ct(bufsize)
	local ofs, len = 0, 0
	local eof = false
	return function(dst, sz)
		if not dst then --skip bytes (libjpeg semantics)
			local i, err = f:seek('cur')    ; if not i then return nil, err end
			local j, err = f:seek('cur', sz); if not j then return nil, err end
			return j - i
		end
		local rsz = 0
		while sz > 0 do
			if len == 0 then
				if eof then
					return 0
				end
				ofs = 0
				local len1, err = f:read(buf, bufsize)
				if not len1 then return nil, err end
				len = len1
				if len == 0 then
					eof = true
					return rsz
				end
			end
			--TODO: benchmark: read less instead of copying.
			local n = min(sz, len)
			ffi.copy(ffi.cast(ptr_ct, dst) + rsz, buf + ofs, n)
			ofs = ofs + n
			len = len - n
			rsz = rsz + n
			sz = sz - n
		end
		return rsz
	end
end

--stdio streams --------------------------------------------------------------

cdef[[
typedef struct FILE FILE;
int fclose(FILE*);
]]

stream_ct = ffi.typeof'struct FILE'

function stream.close(fs)
	local ok = C.fclose(fs) == 0
	if not ok then return check_errno(false) end
	return true
end

--i/o ------------------------------------------------------------------------

local whences = {set = 0, cur = 1, ['end'] = 2} --FILE_*
function file:seek(whence, offset)
	if tonumber(whence) and not offset then --middle arg missing
		whence, offset = 'cur', tonumber(whence)
	end
	whence = whence or 'cur'
	offset = tonumber(offset or 0)
	whence = assertf(whences[whence], 'invalid whence: "%s"', whence)
	return self:_seek(whence, offset)
end

function file:write(buf, sz, expires)
	sz = sz or #buf
	if sz == 0 then return true end --mask out null writes
	local sz0 = sz
	while true do
		local len, err = self:_write(buf, sz, expires)
		if len == sz then
			break
		elseif not len then --short write
			return nil, err, sz0 - sz
		end
		assert(len > 0)
		if type(buf) == 'string' then --only make pointer on the rare second iteration.
			buf = ffi.cast(u8p, buf)
		end
		buf = buf + len
		sz  = sz  - len
	end
	return true
end

function file:readn(buf, sz, expires)
	local sz0 = sz
	while sz > 0 do
		local len, err = self:read(buf, sz, expires)
		if not len or len == 0 then --short read
			return nil, err, sz0 - sz
		end
		buf = buf + len
		sz  = sz  - len
	end
	return true
end

local u8a = ffi.typeof'uint8_t[?]'
function file:readall(expires, ignore_file_size)
	if self.type == 'pipe' or ignore_file_size then
		return glue.readall(self.read, self, expires)
	end
	assert(self.type == 'file')
	local size, err = self:attr'size'; if not size then return nil, err end
	local offset, err = self:seek(); if not offset then return nil, err end
	local sz = size - offset
	if sz == 0 then return nil, 0 end
	local buf = u8a(sz)
	local n, err = self:read(buf, sz)
	if not n then return nil, err end
	if n < sz then return nil, 'partial', buf, n end
	return buf, n
end

--filesystem operations ------------------------------------------------------

function fs.mkdir(dir, recursive, ...)
	if recursive then
		if win and not path.dir(dir) then --because mkdir'c:/' gives access denied.
			return true
		end
		dir = path.normalize(dir) --avoid creating `dir` in `dir/..` sequences
		local t = {}
		while true do
			local ok, err, errno = mkdir(dir, ...)
			if ok then break end
			if err ~= 'not_found' then --other problem
				ok = err == 'already_exists' and #t == 0
				return ok, err, errno
			end
			table.insert(t, dir)
			dir = path.dir(dir)
			if not dir then --reached root
				return ok, err
			end
		end
		while #t > 0 do
			local dir = table.remove(t)
			local ok, err, errno = mkdir(dir, ...)
			if not ok then return ok, err, errno end
		end
		return true
	else
		return mkdir(dir, ...)
	end
end

local function remove(path)
	local type = fs.attr(path, 'type', false)
	if type == 'dir' or (win and type == 'symlink'
		and fs.is(path, 'dir'))
	then
		return rmdir(path)
	end
	return rmfile(path)
end

--TODO: for Windows, this simple algorithm is not correct. On NTFS we
--should be moving all files to a temp folder and deleting them from there.
local function rmdir_recursive(dir)
	for file, d in fs.dir(dir) do
		if not file then
			return file, d
		end
		local filepath = path.combine(dir, file)
		local ok, err
		local realtype = d:attr('type', false)
		if realtype == 'dir' then
			ok, err = rmdir_recursive(filepath)
		elseif win and realtype == 'symlink' and fs.is(filepath, 'dir') then
			ok, err = rmdir(filepath)
		else
			ok, err = rmfile(filepath)
		end
		if not ok then
			d:close()
			return ok, err
		end
	end
	return rmdir(dir)
end

function fs.remove(dirfile, recursive)
	if recursive then
		--not recursing if the dir is a symlink, unless it has an endsep!
		if not path.endsep(dirfile) then
			local type, err = fs.attr(dirfile, 'type', false)
			if not type then return nil, err end
			if type == 'symlink' then
				if win and fs.is(dirfile, 'dir') then
					return rmdir(dirfile)
				end
				return rmfile(dirfile)
			end
		end
		return rmdir_recursive(dirfile)
	else
		return remove(dirfile)
	end
end

function fs.cwd() return getcwd() end
function fs.chdir(dir) return chdir(dir) end

--symlinks -------------------------------------------------------------------

local function readlink_recursive(link, maxdepth)
	if not fs.is(link, 'symlink') then
		return link
	end
	if maxdepth == 0 then
		return nil, 'not_found'
	end
	local target, err = readlink(link)
	if not target then
		return nil, err
	end
	if path.isabs(target) then
		link = target
	else --relative symlinks are relative to their own dir
		local link_dir = path.dir(link)
		if not link_dir then
			return nil, 'not_found'
		elseif link_dir == '.' then
			link_dir = ''
		end
		link = path.combine(link_dir, target)
	end
	return readlink_recursive(link, maxdepth - 1)
end

function fs.readlink(link)
	return readlink_recursive(link, 32)
end

--common paths ---------------------------------------------------------------

fs.exedir = memoize(function()
	return path.dir(fs.exepath())
end)

fs.scriptdir = memoize(function()
	local s = path.combine(fs.startcwd(), glue.bin)
	return s and path.normalize(s) or glue.bin
end)

--file attributes ------------------------------------------------------------

function file.attr(f, attr)
	if type(attr) == 'table' then
		return file_attr_set(f, attr)
	else
		return file_attr_get(f, attr)
	end
end

function file.size(f)
	return f:attr'size'
end

local function attr_args(attr, deref)
	if type(attr) == 'boolean' then --middle arg missing
		attr, deref = nil, attr
	end
	if deref == nil then
		deref = true --deref by default
	end
	return attr, deref
end

function fs.attr(path, ...)
	local attr, deref = attr_args(...)
	if attr == 'target' then
		--NOTE: posix doesn't need a type check here, but Windows does
		if not win or fs.is(path, 'symlink') then
			return readlink(path)
		else
			return nil --no error for non-symlink files
		end
	end
	if type(attr) == 'table' then
		return fs_attr_set(path, attr, deref)
	else
		return fs_attr_get(path, attr, deref)
	end
end

function fs.is(path, type, deref)
	if type == 'symlink' then
		deref = false
	end
	local ftype, err = fs.attr(path, 'type', deref)
	if not type and not ftype and err == 'not_found' then
		return false
	elseif not type and ftype then
		return true
	elseif not ftype then
		return nil, err
	else
		return ftype == type
	end
end

--directory listing ----------------------------------------------------------

local function dir_check(dir)
	assert(not dir:closed(), 'dir closed')
	assert(dir_ready(dir), 'dir not ready') --must call next() at least once.
end

function fs.dir(dir, opt)
	local skip_dot_dirs = not (opt and opt:find('..', 1, true))
	return fs_dir(dir or '.', skip_dot_dirs)
end

function dir.path(dir)
	return path.combine(dir:dir(), dir:name())
end

function dir.name(dir)
	dir_check(dir)
	return dir_name(dir)
end

local function dir_is_symlink(dir)
	return dir_attr_get(dir, 'type', false) == 'symlink'
end

function dir.attr(dir, ...)
	dir_check(dir)
	local attr, deref = attr_args(...)
	if attr == 'target' then
		if dir_is_symlink(dir) then
			return readlink(dir:path())
		else
			return nil --no error for non-symlink files
		end
	end
	if type(attr) == 'table' then
		return fs_attr_set(dir:path(), attr, deref)
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

function dir.is(dir, type, deref)
	if type == 'symlink' then
		deref = false
	end
	return dir:attr('type', deref) == type
end

local push = table.insert
local pop = table.remove

function fs.scandir(path)
	local pds = {}
	local next, d = fs.dir(path)
	local name, err
	local sc = {}
	setmetatable(sc, sc)
	function sc:close()
		repeat
			local ok, err = d:close()
			if not ok then return nil, err end
			d = pop(pds)
		until not d
		name, err = nil, 'closed'
	end
	function sc:depth(n)
		n = n or 0
		local maxdepth = #pds + 1
		return n > 0 and min(maxdepth, n) or max(1, maxdepth + n)
	end
	function sc:__index(k) --forward other method calls to a dir object.
		local f
		function f(self, depth, ...)
			if not name then return nil, err end
			if type(depth) ~= 'number' then
				return f(self, 0, depth, ...)
			end
			local d = d
		 	if depth ~= 0 then
				depth = self:depth(depth)
				d = pds[depth] or d
			end
			return d[k](d, ...)
		end
		self[k] = f
		return f
	end
	local function iter()
		if not d then return nil end --closed
		if name and d:is('dir', false) then
			local next1, d1 = fs.dir(d:path())
			assert(next1 == next)
			push(pds, d)
			d = d1
		end
		name, err = next(d)
		if name == nil then
			d = pop(pds)
			if d then
				return iter()
			else
				return nil
			end
		end
		return sc
	end
	return iter
end

--memory mapping -------------------------------------------------------------

do
local m = ffi.new[[
	union {
		struct { uint32_t lo; uint32_t hi; };
		uint64_t x;
	}
]]
function split_uint64(x)
	m.x = x
	return m.hi, m.lo
end
function join_uint64(hi, lo)
	m.hi, m.lo = hi, lo
	return m.x
end
end

function fs.aligned_size(size, dir) --dir can be 'l' or 'r' (default: 'r')
	if ffi.istype(uint64_ct, size) then --an uintptr_t on x64
		local pagesize = fs.pagesize()
		local hi, lo = split_uint64(size)
		local lo = fs.aligned_size(lo, dir)
		return join_uint64(hi, lo)
	else
		local pagesize = fs.pagesize()
		if not (dir and dir:find'^l') then --align to the right
			size = size + pagesize - 1
		end
		return bit.band(size, bit.bnot(pagesize - 1))
	end
end

function fs.aligned_addr(addr, dir)
	return ffi.cast(void_ptr_ct,
		fs.aligned_size(ffi.cast(uintptr_ct, addr), dir))
end

function parse_access(s)
	assert(not s:find'[^rwcx]', 'invalid access flags')
	local write = s:find'w' and true or false
	local exec  = s:find'x' and true or false
	local copy  = s:find'c' and true or false
	assert(not (write and copy), 'invalid access flags')
	return write, exec, copy
end

function check_tagname(tagname)
	assert(not tagname:find'[/\\]', 'tagname cannot contain `/` or `\\`')
	return tagname
end

function file.map(f, ...)
	local access, size, offset, addr
	if type(t) == 'table' then
		access, size, offset, addr = t.access, t.size, t.offset, t.addr
	else
		offset, size, addr, access = ...
	end
	return fs.map(f, access or f.access, size, offset, addr)
end

function fs.map(t,...)
	local file, access, size, offset, addr, tagname, perms
	if type(t) == 'table' then
		file, access, size, offset, addr, tagname, perms =
			t.file, t.access, t.size, t.offset, t.addr, t.tagname, t.perms
	else
		file, access, size, offset, addr, tagname, perms = t, ...
	end
	assert(not file or type(file) == 'string' or fs.isfile(file), 'invalid file argument')
	assert(file or size, 'file and/or size expected')
	assert(not size or size > 0, 'size must be > 0')
	local offset = file and offset or 0
	assert(offset >= 0, 'offset must be >= 0')
	assert(offset == fs.aligned_size(offset), 'offset not page-aligned')
	local addr = addr and ffi.cast(void_ptr_ct, addr)
	assert(not addr or addr ~= nil, 'addr can\'t be zero')
	assert(not addr or addr == fs.aligned_addr(addr), 'addr not page-aligned')
	assert(not (file and tagname), 'cannot have both file and tagname')
	assert(not tagname or not tagname:find'\\', 'tagname cannot contain `\\`')
	return fs_map(file, access, size, offset, addr, tagname, perms)
end

--memory streams -------------------------------------------------------------

local vfile = {}

function fs.open_buffer(buf, sz, mode)
	sz = sz or #buf
	mode = mode or 'r'
	assertf(mode == 'r' or mode == 'w', 'invalid mode: "%s"', mode)
	local f = {
		buffer = ffi.cast(u8p, buf),
		size = sz,
		offset = 0,
		mode = mode,
		_buffer = buf, --anchor it
		w = 0,
		r = 0,
		__index = vfile,
	}
	return setmetatable(f, f)
end

function vfile.close(f) f._closed = true; return true end
function vfile.closed(f) return f._closed end

function vfile.flush(f)
	if f._closed then
		return nil, 'access_denied'
	end
	return true
end

function vfile.read(f, buf, sz)
	if f._closed then
		return nil, 'access_denied'
	end
	sz = min(max(0, sz), max(0, f.size - f.offset))
	ffi.copy(buf, f.buffer + f.offset, sz)
	f.offset = f.offset + sz
	f.r = f.r + sz
	return sz
end

function vfile.write(f, buf, sz)
	if f._closed then
		return nil, 'access_denied'
	end
	if f.mode ~= 'w' then
		return nil, 'access_denied'
	end
	sz = min(max(0, sz), max(0, f.size - f.offset))
	ffi.copy(f.buffer + f.offset, buf, sz)
	f.offset = f.offset + sz
	f.w = f.w + sz
	return sz
end

vfile.seek = file.seek

function vfile._seek(f, whence, offset)
	if whence == 1 then --cur
		offset = f.offset + offset
	elseif whence == 2 then --end
		offset = f.size + offset
	end
	offset = max(offset, 0)
	f.offset = offset
	return offset
end

function vfile:truncate(size)
	local pos, err = f:seek(size)
	if not pos then return nil, err end
	f.size = size
	return true
end

vfile.buffered_read = file.buffered_read

--hi-level APIs --------------------------------------------------------------

fs.abort = {} --error signal to pass to save()'s reader function.

function fs.load_tobuffer(file, ignore_file_size)
	local f, err = fs.open(file)
	if not f then
		return nil, err
	end
	local buf, len = f:readall(nil, ignore_file_size)
	f:close()
	return buf, len
end

function fs.load(file, ignore_file_size)
	local buf, len = fs.load_tobuffer(file, ignore_file_size)
	if not buf then return nil, len end
	return ffi.string(buf, len)
end

--write a Lua value, array of values or function results to a file atomically.
function fs.save(file, s, sz)

	local tmpfile = file..'.tmp'

	local dir = path.dir(tmpfile)
	if path.dir(dir) then --because mkdir'c:/' gives access denied.
		local ok, err = fs.mkdir(dir, true)
		if not ok then
			return false, _('could not create dir %s:\n\t%s', dir, err)
		end
	end

	local f, err = fs.open(tmpfile, 'w')
	if not f then
		return false, _('could not open file %s:\n\t%s', tmpfile, err)
	end

	local ok, err = true
	if type(s) == 'table' then --table of stringables
		for i = 1, #s do
			ok, err = f:write(tostring(s[i]))
			if not ok then break end
		end
	elseif type(s) == 'function' then --reader of buffers or stringables
		local read = s
		while true do
			local s, sz
			ok, s, sz = xpcall(read, debug.traceback)
			if not ok then err = s; break end
			if s == nil or s == '' then break end
			if s == fs.abort then ok = false; break end
			if type(s) ~= 'cdata' then
				s = tostring(s)
			end
			ok, err = f:write(s, sz)
			if not ok then break end
		end
	elseif s ~= nil and s ~= '' then --buffer or stringable
		if type(s) ~= 'cdata' then
			s = tostring(s)
		end
		ok, err = f:write(s, sz)
	end
	f:close()

	if not ok then
		local err_msg = 'could not write to file %s:\n\t%s'
		local ok, rm_err = fs.remove(tmpfile)
		if not ok then
			err_msg = err_msg..'\nremoving it also failed:\n\t%s'
		end
		return false, _(err_msg, tmpfile, err, rm_err)
	end

	local ok, err = fs.move(tmpfile, file)
	if not ok then
		local err_msg = 'could not move file %s -> %s:\n\t%s'
		local ok, rm_err = fs.remove(tmpfile)
		if not ok then
			err_msg = err_msg..'\nremoving it also failed:\n\t%s'
		end
		return false, _(err_msg, tmpfile, file, err, rm_err)
	end

	return true
end

function fs.saver(file)
	local write = coroutine.wrap(function()
		return fs.save(file, coroutine.yield)
	end)
	local ok, err = write()
	if not ok then return false, err end
	return write
end

--load platfrom module -------------------------------------------------------

package.loaded.fs = fs --prevent recursive loading by submodules.
if win then
	require'fs_win'
elseif linux or osx then
	require'fs_posix'
else
	error'platform not Windows, Linux or OSX'
end

ffi.metatype(stream_ct, stream)
ffi.metatype(dir_ct, dir)

return fs
