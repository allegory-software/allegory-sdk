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
	[try_]open(path[, mode|opt]) -> f             open file
	f:close()                                     close file
	f:closed() -> true|false                      check if file is closed
	isfile(f) -> true|false                       check if f is a file object
	f.handle -> HANDLE                            Windows HANDLE (Windows platforms)
	f.fd -> fd                                    POSIX file descriptor (POSIX platforms)
PIPES
	pipe() -> rf, wf                              create an anonymous pipe
	pipe({path=,<opt>=} | path[,options]) -> pf   create a named pipe (Windows)
	pipe({path=,mode=} | path[,mode]) -> true     create a named pipe (POSIX)
STDIO STREAMS
	f:stream(mode) -> fs                          open a FILE* object from a file
	fs:close()                                    close the FILE* object
MEMORY STREAMS
	open_buffer(buf, [size], [mode]) -> f         create a memory stream
FILE I/O
	f:read(buf, len) -> readlen                   read data from file
	f:readn(buf, n) -> true                       read exactly n bytes
	f:readall([expires], [ignore_file_size]) -> buf, len    read until EOF into a buffer
	f:write(s | buf,len) -> true                  write data to file
	f:flush()                                     flush buffers
	f:seek([whence] [, offset]) -> pos            get/set the file pointer
	f:truncate([opt])                             truncate file to current file pointer
	f:[un]buffered_reader([bufsize]) -> read(buf, sz)   get read(buf, sz)
OPEN FILE ATTRIBUTES
	f:[try_]attr([attr]) -> val|t                 get/set attribute(s) of open file
	f:size() -> n                                 get file size
DIRECTORY LISTING
	ls(dir, [opt]) -> d, next                     directory contents iterator
	  d:next() -> name, d                         call the iterator explicitly
	  d:[try_]close()                             close iterator
	  d:closed() -> true|false                    check if iterator is closed
	  d:name() -> s                               dir entry's name
	  d:dir() -> s                                dir that was passed to ls()
	  d:path() -> s                               full path of the dir entry
	  d:attr([attr, ][deref]) -> t|val            get/set dir entry attribute(s)
	  d:is(type, [deref]) -> t|f                  check if dir entry is of type
	scandir([path]) -> iter() -> sc               recursive dir iterator
	  sc:close()
	  sc:closed() -> true|false
	  sc:name([depth]) -> s
	  sc:dir([depth]) -> s
	  sc:path([depth]) -> s
	  sc:relpath([depth]) -> s
	  sc:attr([attr, ][deref]) -> t|val
	  sc:depth([n]) -> n (from 1)
	searchpaths({path1,...}, file, [type]) -> path
FILE ATTRIBUTES
	[try_]file_attr(path, [attr, ][deref]) -> t|val     get/set file attribute(s)
	file_is(path, [type], [deref]) -> t|f         check if file exists or is of a certain type
	exists                                      = file_is
	checkexists(path, [type], [deref])            assert that file exists
	mtime(path, [deref]) -> ts                    get file's modification time
	[try_]chmod(path, perms, [quiet]) -> path     change a file or dir's permissions
FILESYSTEM OPS
	cwd() -> path                                 get current working directory
	abspath(path[, cwd]) -> path                  convert path to absolute path
	startcwd() -> path                            get the cwd that process started with
	[try_]chdir(path)                             set current working directory
	run_indir(dir, fn)                            run function in specified cwd
	[try_]mkdir(dir, [recursive], [perms], [quiet]) -> dir    make directory
	[try_]rm[dir|file](path, [quiet])             remove directory or file
	[try_]rm_rf(path, [quiet])                    like `rm -rf`
	[try_]mkdirs(file, [quiet]) -> file           make file's dir
	[try_]mv(old_path, new_path, [quiet])         rename/move file or dir on the same filesystem
SYMLINKS & HARDLINKS
	[try_]mksymlink(symlink, path, is_dir, [quiet])  create a symbolic link for a file or dir
	[try_]mkhardlink(hardlink, path, [quiet])     create a hard link for a file
	[try_]readlink(path) -> path                  dereference a symlink recursively
COMMON PATHS
	homedir() -> path                             get current user's home directory
	tmpdir() -> path                              get the temporary directory
	exepath() -> path                             get the full path of the running executable
	exedir() -> path                              get the directory of the running executable
	appdir([appname]) -> path                     get the current user's app data dir
	scriptdir() -> path                           get the directory of the main script
	vardir() -> path                              get script's private r/w directory
	varpath(file) -> path                         get vardir-relative path
LOW LEVEL
	file_wrap_handle(HANDLE) -> f                 wrap opened HANDLE (Windows)
	file_wrap_fd(fd) -> f                         wrap opened file descriptor
	file_wrap_file(FILE*) -> f                    wrap opened FILE* object
	fileno(FILE*) -> fd                           get stream's file descriptor
MEMORY MAPPING
	mmap(...) -> map                              create a memory mapping
	f:map([offset],[size],[addr],[access]) -> map   create a memory mapping
	map.addr                                      a void* pointer to the mapped memory
	map.size                                      size of the mapped memory in bytes
	map:flush([async, ][addr, size])              flush (parts of) the mapping to disk
	map:free()                                    release the memory and associated resources
	unlink_mapfile(tagname)                       remove the shared memory file from disk (Linux, OSX)
	map:unlink()
	mirror_buffer([size], [addr]) -> map          create a mirrored memory-mapped ring buffer
	pagesize() -> bytes                           get allocation granularity
	aligned_size(bytes[, dir]) -> bytes           next/prev page-aligned size
	aligned_addr(ptr[, dir]) -> ptr               next/prev page-aligned address
FILESYSTEM INFO
	fs_info(path) -> {size=, free=}               get free/total disk space for a path
HI-LEVEL APIs
	[try_]load[_tobuffer](path, [ignore_fsize]) -> buf,len  read file to string or buffer
	[try_]save(path, s, [sz], [perms], [quiet])   atomic save value/buffer/array/read-results
	file_saver(path) -> f(v | buf,len | t | read) atomic save writer function
	touch(file, [mtime], [btime], [quiet])
	cp(src_file, dst_file)

The `deref` arg is true by default, meaning that by default, symlinks are
followed recursively and transparently where this option is available.

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
that the attribute can be changed. Attributes can be queried and changed via
`f:attr()`, `file_attr()` and `d:attr()`.

NOTE: File sizes and offsets are Lua numbers not 64bit ints, so they can hold
at most 8KTB.

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

[try_]open(path[, mode|opt]) -> f

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

The `mode` arg is passed to `unixperms_parse()`.

Pipes ------------------------------------------------------------------------

pipe() -> rf, wf

	Create an anonymous (unnamed) pipe. Return two files corresponding to the
	read and write ends of the pipe.

	NOTE: If you're using async anonymous pipes in Windows _and_ you're
	also creating multiple Lua states _per OS thread_, make sure to set a unique
	`lua_state_id` per Lua state to distinguish them. That is because
	in Windows, async anonymous pipes are emulated using named pipes.

pipe({path=,<opt>=} | path[,options]) -> pf

	Create or open a named pipe (Windows). Named pipes on Windows cannot
	be created in any directory like on POSIX systems, instead they must be
	created in the special directory called `\\.\pipe`. After creation,
	named pipes can be opened for reading and writing like normal files.

	Named pipes on Windows cannot be removed and are not persistent. They are
	destroyed automatically when the process that created them exits.

pipe({path=,mode=} | path[,mode]) -> true

	Create a named pipe (POSIX). Named pipes on POSIX are persistent and can be
	created in any directory as they are just a type of file.

Stdio Streams ----------------------------------------------------------------

f:stream(mode) -> fs

	Open a `FILE*` object from a file. The file should not be used anymore while
	a stream is open on it and `fs:close()` should be called to close the file.

fs:close()

	Close the `FILE*` object and the underlying file object.

Memory Streams ---------------------------------------------------------------

open_buffer(buf, [size], [mode]) -> f

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

	... On Linux

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

	... On Windows

	On NTFS truncation is smarter: disk space is reserved but no zero bytes are
	written. Those bytes are only written on subsequent write calls that skip
	over the reserved area, otherwise there's no overhead.

f:[un]buffered_reader([bufsize]) -> read(buf, len)

	Returns a `read(buf, len) -> readlen` function which reads ahead from file
	in order to lower the number of syscalls. `bufsize` specifies the buffer's
	size (default is 64K). The unbuffered version doesn't use a buffer.

Open file attributes ---------------------------------------------------------

f:attr([attr]) -> val|t

	Get/set attribute(s) of open file. `attr` can be:
	* nothing/nil: get the values of all attributes in a table.
	* string: get the value of a single attribute.
	* table: set one or more attributes.

Directory listing ------------------------------------------------------------

ls([dir], [opt]) -> d, next

	Directory contents iterator. `dir` defaults to '.'.
	`opt` is a string that can include:
		* `..`   :  include `.` and `..` dir entries (excluded by default).

	USAGE

		for name, d in ls() do
			if not name then
				print('error: ', d)
				break
			end
			print(d:attr'type', name)
		end

	Always include the `if not name` condition when iterating. The iterator
	doesn't raise any errors. Instead it returns `false, err` as the
	last iteration when encountering an error. Initial errors from calling
	`ls()` (eg. `'not_found'`) are passed to the iterator also, so the
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

		The directory that was passed to `ls()`.

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

scandir([path]) -> iter() -> sc

	Recursive dir walker. All sc methods return `nil, err` if an error occured
	on the current dir entry, but the iteration otherwise continues.
	`depth` arg can be 0=sc:depth(), 1=first-level, -1=parent-level, etc.

	sc:close()
	sc:closed() -> true|false
	sc:name([depth]) -> s
	sc:dir([depth]) -> s
	sc:path([depth]) -> s
	sc:relpath([depth]) -> s
	sc:attr([attr, ][deref]) -> t|val
	sc:depth([n]) -> n (from 1)

File attributes --------------------------------------------------------------

[try_]file_attr(path, [attr, ][deref]) -> t|val

	Get/set a file's attribute(s) given its path in utf8.

file_is(path, [type], [deref]) -> true|false

	Check if file exists or if it is of a certain type.

Filesystem operations --------------------------------------------------------

mkdir(path, [recursive], [perms])

	Make directory. `perms` can be a number or a string passed to `unixperms_parse()`.

	NOTE: In recursive mode, if the directory already exists this function
	returns `true, 'already_exists'`.

fileremove(path, [recursive])

	Remove a file or directory (recursively if `recursive=true`).

filemove(path, newpath, [opt])

	Rename/move a file on the same filesystem. On Windows, `opt` represents
	the `MOVEFILE_*` flags and defaults to `'replace_existing write_through'`.

	This operation is atomic on all platforms.

Symlinks & Hardlinks ---------------------------------------------------------

[try_]readlink(path) -> path

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

mmap(args_t) -> map
mmap(path, [access], [size], [offset], [addr], [tagname], [perms]) -> map
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
	if it was opened by the `mmap()` call.

map:flush([async, ][addr, size]) -> true | nil,err

	Flush (part of) the memory to disk. If the address is not aligned,
	it will be automatically aligned to the left. If `async` is true,
	perform the operation asynchronously and return immediately.

unlink_mapfile(tagname)` <br> `map:unlink()

	Remove a (the) shared memory file from disk. When creating a shared memory
	mapping using `tagname`, a file is created on the filesystem on Linux
	and OS X (not so on Windows). That file must be removed manually when it is
	no longer needed. This can be done anytime, even while mappings are open and
	will not affect said mappings.

mirror_buffer([size], [addr]) -> map  (OSX support is NYI)

	Create a mirrored buffer to use with a lock-free ring buffer. Args:
	* `size`: the size of the memory segment (optional; one page size
	  by default. automatically aligned to the next page size).
	* `addr`: address to use (optional; can be anything convertible to `void*`).

	The result is a table with `addr` and `size` fields and all the mirror map
	objects in its array part (freeing the mirror will free all the maps).
	The memory block at `addr` is mirrored such that
	`(char*)addr[i] == (char*)addr[size+i]` for any `i` in `0..size-1`.

aligned_size(bytes[, dir]) -> bytes

	Get the next larger (dir = 'right', default) or smaller (dir = 'left') size
	that is aligned to a page boundary. It can be used to align offsets and sizes.

aligned_addr(ptr[, dir]) -> ptr

	Get the next (dir = 'right', default) or previous (dir = 'left') address that
	is aligned to a page boundary. It can be used to align pointers.

pagesize() -> bytes

	Get the current page size. Memory will always be allocated in multiples
	of this size and file offsets must be aligned to this size too.

Async I/O --------------------------------------------------------------------

Named pipes can be opened with `async = true` option which opens them
in async mode, which uses the sock scheduler to multiplex the I/O
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

require'glue'
require'path'

local
	C, min, max, floor, ceil, ln, push, pop =
	C, min, max, floor, ceil, ln, push, pop

local file = {}; file.__index = file --file object methods
local stream = {}; stream.__index = stream --FILE methods
local dir = {}; dir.__index = dir --dir listing object methods

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
	[Linux and 39 or OSX and 66 or ''] = 'not_empty', --ENOTEMPTY, rmdir()
	[28] = 'disk_full', --ENOSPC: fallocate()
	[Linux and 95 or ''] = 'not_supported', --EOPNOTSUPP: fallocate()
	[Linux and 32 or ''] = 'eof', --EPIPE: write()
}

local function check_errno(ret, errno, xtra_errors)
	if ret then return ret end
	errno = errno or ffi.errno()
	local err = errors[errno] or (xtra_errors and xtra_errors[errno])
	if not err then
		local s = C.strerror(errno)
		err = s ~= nil and str(s) or 'Error '..errno
	end
	return ret, err
end

--file objects ---------------------------------------------------------------

function isfile(f)
	local mt = getmetatable(f)
	return istab(mt) and rawget(mt, '__index') == file
end

function try_open(path, mode_opt, quiet)
	mode_opt = mode_opt or 'r'
	local opt = istab(mode_opt) and mode_opt or nil
	local mode = isstr(mode_opt) and mode_opt or opt and opt.mode
	local mopt = mode and assertf(_open_mode_opt[mode], 'invalid open mode: %s', mode)
	return _open(path, opt and mopt and update({}, mopt, opt) or opt or mopt, quiet)
end

function open(path, mode_opt, quiet)
	local f, err = try_open(path, mode_opt, quiet)
	check('fs', 'open', f, '%s: %s', path, err)
	return f
end

function file.unbuffered_reader(f)
	return function(buf, sz)
		if not buf then
			local i, err = f:seek('cur',  0); if not i then return nil, err end
			local j, err = f:seek('cur', sz); if not i then return nil, err end
			return j - i
		else
			return f:read(buf, sz) --skip bytes (libjpeg semantics)
		end
	end
end

function file.buffered_reader(f, bufsize)
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
			local i, err = f:seek('cur',  0); if not i then return nil, err end
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
			copy(cast(ptr_ct, dst) + rsz, buf + ofs, n)
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

stream_ct = typeof'struct FILE'

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
		if isstr(buf) then --only make pointer on the rare second iteration.
			buf = cast(u8p, buf)
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

function file:readall(expires, ignore_file_size)
	if self.type == 'pipe' or ignore_file_size then
		return readall(self.read, self, expires)
	end
	assert(self.type == 'file')
	local size, err = self:attr'size'; if not size then return nil, err end
	local offset, err = self:seek(); if not offset then return nil, err end
	local sz = size - offset
	local buf = u8a(sz)
	local n, err = self:read(buf, sz)
	if not n then return nil, err end
	if n < sz then return nil, 'partial', buf, n end
	return buf, n
end

--filesystem operations ------------------------------------------------------

function try_chdir(dir)
	local ok, err = _chdir(dir)
	if not ok then return false, err end
	log('', 'fs', 'chdir', '%s', dir)
	return true
end

local function _try_mkdir(path, perms, quiet)
	local ok, err = _mkdir(path, perms)
	if not ok then
		if err == 'already_exists' then return true, err end
		return false, err
	end
	log(quiet and '' or 'note', 'fs', 'mkdir', '%s%s%s',
		path, perms and ' ' or '', perms or '')
	return true
end

function try_mkdir(dir, recursive, perms, quiet)
	if recursive then
		if win and not path_dir(dir) then --because mkdir'c:/' gives access denied.
			return true
		end
		dir = path_normalize(dir) --avoid creating `dir` in `dir/..` sequences
		local t = {}
		while true do
			local ok, err = _try_mkdir(dir, perms, quiet)
			if ok then break end
			if err ~= 'not_found' then --other problem
				return ok, err
			end
			push(t, dir)
			dir = path_dir(dir)
			if not dir then --reached root
				return ok, err
			end
		end
		while #t > 0 do
			local dir = pop(t)
			local ok, err = _try_mkdir(dir, perms, quiet)
			if not ok then return ok, err end
		end
		return true
	else
		return _try_mkdir(dir, perms, quiet)
	end
end

function try_mkdirs(file)
	local ok, err = try_mkdir(assert(path_dir(file)))
	if not ok then return nil, err end
	return file
end

function try_rmdir(dir, quiet)
	local ok, err, errcode = _rmdir(dir)
	if not ok then
		if err == 'not_found' then return true, err end
		return false, err
	end
	log(quiet and '' or 'note', 'fs', 'rmdir', '%s', dir)
	return true
end

function try_rmfile(file, quiet)
	local ok, err = _rmfile(file)
	if not ok then
		if err == 'not_found' then return true, err end
		return false, err
	end
	log(quiet and '' or 'note', 'fs', 'rmfile', '%s', file)
	return ok, err
end

local function try_rm(path, quiet)
	local type, err = try_file_attr(path, 'type', false)
	if not type and err == 'not_found' then
		return true, err
	end
	if type == 'dir' or (win and type == 'symlink' and err == 'dir') then
		return try_rmdir(path, quiet)
	else
		return try_rmfile(path, quiet)
	end
end

local function try_rmdir_recursive(dir, quiet)
	for file, d in ls(dir) do
		if not file then
			if d == 'not_found' then return true, d end
			return file, d
		end
		local filepath = path_combine(dir, file)
		local ok, err
		local realtype, err = d:attr('type', false)
		if realtype == 'dir' then
			ok, err = try_rmdir_recursive(filepath, quiet)
		elseif win and realtype == 'symlink' and err == 'dir' then
			ok, err = try_rmdir(filepath, quiet)
		elseif realtype then
			ok, err = try_rmfile(filepath, quiet)
		end
		if not ok then
			d:close()
			return ok, err
		end
	end
	return try_rmdir(dir, quiet)
end
local function try_rm_rf(path, quiet)
	--not recursing if the dir is a symlink, unless it has an endsep!
	if not path_endsep(path) then
		local type, err = try_file_attr(path, 'type', false)
		if not type then
			if err == 'not_found' then return true, err end
			return nil, err
		end
		if type == 'symlink' then
			if win and err == 'dir' then
				return try_rmdir(path, quiet)
			else
				return try_rmfile(path, quiet)
			end
		end
	end
	return try_rmdir_recursive(path, quiet)
end

function try_mv(old_path, new_path, quiet)
	local ok, err = _mv(old_path, new_path)
	if not ok then return false, err end
	log(quiet and '' or 'note', 'fs', 'mv', 'old: %s\nnew: %s', old_path, new_path)
	return true
end

--is_dir is required for Windows for creating symlinks to directories.
--it's ignored on Linux and OSX.
function try_mksymlink(link_path, target_path, is_dir, quiet, replace)
	if not win then is_dir = nil end
	local ok, err = _mksymlink(link_path, target_path, is_dir)
	if not ok then
		if err == 'already_exists' then
			local file_type, symlink_type = try_file_attr(link_path, 'type')
			if file_type == 'symlink'
				and (symlink_type == 'dir') == (is_dir or false)
			then
				if try_readlink(link_path) == target_path then
					return true, err
				elseif replace ~= false then
					if is_dir then
						local ok, err = try_rmdir(link_path)
						if not ok then return false, err end
					else
						local ok, err = try_rmfile(link_path)
						if not ok then return false, err end
					end
					local ok, err = _mksymlink(link_path, target_path, is_dir)
					if not ok then return false, err end
					return true, 'replaced'
				end
			end
		end
		return false, err
	end
	log('', 'fs', 'mkslink', 'link:   %s%s\ntarget:  %s', link_path,
		is_dir and ' (dir)' or is_dir == false and ' (file)' or '',
		target_path)
	return true
end

function try_mkhardlink(link_path, target_path, quiet)
	local ok, err = _mkhardlink(link_path, target_path)
	if not ok then
		if err == 'already_exists' then
			local ID = win and 'id' or 'inode'
			local i1 = try_file_attr(target_path, ID)
			if not i1 then goto fuggetit end
			local i2 = try_file_attr(link_path, ID)
			if not i2 then goto fuggetit end
			if i1 == i2 then return true, err end
		end
		::fuggetit::
		return false, err
	end
	log('', 'fs', 'mkhlink', 'link:   %s\ntarget:  %s', link_path, target_path)
	return true
end

--raising versions

function chdir(dir)
	local ok, err = try_chdir(dir)
	if ok then return dir, err end
	check('fs', 'chdir', ok, '%s: %s', dir, err)
end

function mkdir(dir, perms, quiet)
	local ok, err = try_mkdir(dir, true, perms, quiet)
	if ok then return dir, err end
	check('fs', 'mkdir', ok, '%s%s%s: %s', dir, perms and ' ' or '', perms or '', err)
end

function mkdirs(file)
	mkdir(assert(path_dir(file)))
	return file
end

function rmdir(dir, quiet)
	local ok, err = try_rmdir(dir, quiet)
	if ok then return dir, err end
	check('fs', 'rmdir', ok, '%s: %s', dir, err)
end

function rmfile(path, quiet)
	local ok, err = try_rmfile(path, quiet)
	if ok then return path, err end
	check('fs', 'rmfile', ok, '%s: %s', path, err)
end

function rm(path, quiet)
	local ok, err = try_rm(path, quiet)
	if ok then return path, err end
	check('fs', 'rm', ok, '%s: %s', path, err)
end

function rm_rf(path, quiet)
	local ok, err = try_rm_rf(path, quiet)
	if ok then return path, err end
	check('fs', 'rm_rf', ok, '%s: %s', path, err)
end

function mv(old_path, new_path, quiet)
	local ok, err = try_mv(old_path, new_path, quiet)
	if ok then return new_path, err end
	check('fs', 'mv', ok, 'old: %s\nnew: %s\nerror: %s',
		old_path, new_path, err)
end

function mksymlink(link_path, target_path, is_dir, quiet)
	local ok, err = try_mksymlink(link_path, target_path, is_dir)
	if ok then return dir, err end
	check('fs', 'mkslink', ok, '%s: %s', dir, err)
end

function mkhardlink(link_path, target_path, quiet)
	local ok, err = try_mkhardlink(link_path, target_path)
	if ok then return dir, err end
	check('fs', 'mkhlink', ok, '%s%s%s: %s', dir, perms and ' ' or '', perms or '', err)
end

--symlinks -------------------------------------------------------------------

function try_readlink(link, maxdepth)
	maxdepth = maxdepth or 32
	if not file_is(link, 'symlink') then
		return link
	end
	if maxdepth == 0 then
		return nil, 'not_found'
	end
	local target, err = _readlink(link)
	if not target then
		return nil, err
	end
	if path_isabs(target) then
		link = target
	else --relative symlinks are relative to their own dir
		local link_dir = path_dir(link)
		if not link_dir then
			return nil, 'not_found'
		elseif link_dir == '.' then
			link_dir = ''
		end
		link = path_combine(link_dir, target)
	end
	return try_readlink(link, maxdepth - 1)
end

function readlink(link, maxdepth)
	local target, err = try_readlink(link, maxdepth)
	local ok = target ~= nil or err == 'not_found'
	check('fs', 'readlink', ok, '%s: %s', link, err)
	if target == nil then return target, err end
	return target
end

--paths ----------------------------------------------------------------------

function abspath(path, pwd)
	if path_isabs(path) then
		return path
	end
	return path_combine(pwd or cwd(), path)
end

function run_indir(dir, fn, ...)
	local cwd = cwd()
	chdir(dir)
	local function pass(ok, ...)
		chdir(cwd)
		if ok then return ... end
		error(..., 2)
	end
	pass(pcall(fn, ...))
end

exedir = memoize(function()
	return path_dir(exepath())
end)

scriptdir = memoize(function()
	local s = path_combine(startcwd(), rel_scriptdir)
	return s and path_normalize(s) or rel_scriptdir
end)

vardir = memoize(function()
	return config'vardir' or indir(scriptdir(), 'var')
end)

function varpath(file)
	return indir(vardir(), file)
end

--file attributes ------------------------------------------------------------

function file.try_attr(f, attr)
	if istab(attr) then
		return _file_attr_set(f, attr)
	else
		return _file_attr_get(f, attr)
	end
end

function file.attr(f, attr)
	local ret, err = f:try_attr(attr)
	local ok = ret ~= nil or err == nil or err == 'not_found'
	check('fs', 'attr', ok, '%s: %s', f.path, err)
	if err ~= nil then return ret, err end
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

function try_file_attr(path, ...)
	local attr, deref = attr_args(...)
	if attr == 'target' then
		--NOTE: posix doesn't need a type check here, but Windows does
		if not win or file_is(path, 'symlink') then
			return try_readlink(path)
		else
			return nil --no error for non-symlink files
		end
	end
	if istab(attr) then
		return _fs_attr_set(path, attr, deref)
	else
		return _fs_attr_get(path, attr, deref)
	end
end
function file_attr(path, ...)
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

function try_chmod(path, perms, quiet)
	local ok, err = try_file_attr(path, {perms = perms})
	if not ok then return false, err end
	log(quiet and '' or 'note', 'fs', 'chmod', '%s', file)
	return path
end
function chmod(path, perms, quiet)
	local ok, err = try_chmod(path, perms, quiet)
	check('fs', 'chmod', ok, '%s: %s', path, err)
	return path
end

function file_is(path, type, deref)
	if type == 'symlink' then
		deref = false
	end
	local ftype, err = try_file_attr(path, 'type', deref)
	if not type and not ftype and err == 'not_found' then
		return false
	elseif not type and ftype then
		return true
	elseif not ftype then
		check('fs', 'file_is', nil, '%s: %s', path, err)
	else
		return ftype == type
	end
end
exists = file_is

function checkexists(file, type, deref)
	check('fs', 'exists', exists(file, type, deref), '%s', file)
end

--directory listing ----------------------------------------------------------

local function dir_check(dir)
	assert(not dir:closed(), 'dir closed')
	assert(dir_ready(dir), 'dir not ready') --must call next() at least once.
end

function ls(dir, opt)
	local skip_dot_dirs = not (opt and opt:find('..', 1, true))
	return fs_dir(dir or '.', skip_dot_dirs)
end

function dir.path(dir)
	return path_combine(dir:dir(), dir:name())
end

function dir.name(dir)
	dir_check(dir)
	return dir_name(dir)
end

local function dir_is_symlink(dir)
	return _dir_attr_get(dir, 'type', false) == 'symlink'
end

function dir.attr(dir, ...)
	dir_check(dir)
	local attr, deref = attr_args(...)
	if attr == 'target' then
		if dir_is_symlink(dir) then
			return try_readlink(dir:path())
		else
			return nil --no error for non-symlink files
		end
	end
	if istab(attr) then
		return fs_attr_set(dir:path(), attr, deref)
	elseif not attr or (deref and dir_is_symlink(dir)) then
		return _fs_attr_get(dir:path(), attr, deref)
	else
		local val, found = _dir_attr_get(dir, attr)
		if found == false then --attr not found in state
			return _fs_attr_get(dir:path(), attr)
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

function scandir(path)
	local pds = {}
	local next, d = ls(path)
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
	function sc:relpath(n)
		return relpath(sc:path(n), path)
	end
	function sc:__index(k) --forward other method calls to a dir object.
		local f
		function f(self, depth, ...)
			if not name then return nil, err end
			if not isnum(depth) then
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
			local next1, d1 = ls(d:path())
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

function searchpaths(paths, file, type)
	for _,path in ipairs(paths) do
		local abs_path = indir(path, file)
		if file_is(abs_path, type) then
			return abs_path
		end
	end
end

--memory mapping -------------------------------------------------------------

do
local m = new[[
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

function aligned_size(size, dir) --dir can be 'l' or 'r' (default: 'r')
	if istype(u64, size) then --an uintptr_t on x64
		local pagesize = pagesize()
		local hi, lo = split_uint64(size)
		local lo = aligned_size(lo, dir)
		return join_uint64(hi, lo)
	else
		local pagesize = pagesize()
		if not (dir and dir:find'^l') then --align to the right
			size = size + pagesize - 1
		end
		return band(size, bnot(pagesize - 1))
	end
end

function aligned_addr(addr, dir)
	return cast(voidp, aligned_size(cast(uintptr, addr), dir))
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

function file.mmap(f, ...)
	local access, size, offset, addr
	if istab(t) then
		access, size, offset, addr = t.access, t.size, t.offset, t.addr
	else
		offset, size, addr, access = ...
	end
	return mmap(f, access or f.access, size, offset, addr)
end

function mmap(t,...)
	local file, access, size, offset, addr, tagname, perms
	if istab(t) then
		file, access, size, offset, addr, tagname, perms =
			t.file, t.access, t.size, t.offset, t.addr, t.tagname, t.perms
	else
		file, access, size, offset, addr, tagname, perms = t, ...
	end
	assert(not file or isstr(file) or isfile(file), 'invalid file argument')
	assert(file or size, 'file and/or size expected')
	assert(not size or size > 0, 'size must be > 0')
	local offset = file and offset or 0
	assert(offset >= 0, 'offset must be >= 0')
	assert(offset == aligned_size(offset), 'offset not page-aligned')
	local addr = addr and cast(voidp, addr)
	assert(not addr or addr ~= nil, 'addr can\'t be zero')
	assert(not addr or addr == aligned_addr(addr), 'addr not page-aligned')
	assert(not (file and tagname), 'cannot have both file and tagname')
	assert(not tagname or not tagname:find'\\', 'tagname cannot contain `\\`')
	return fs_map(file, access, size, offset, addr, tagname, perms)
end

--memory streams -------------------------------------------------------------

local vfile = {}

function open_buffer(buf, sz, mode)
	sz = sz or #buf
	mode = mode or 'r'
	assertf(mode == 'r' or mode == 'w', 'invalid mode: "%s"', mode)
	local f = {
		buffer = cast(u8p, buf),
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
	copy(buf, f.buffer + f.offset, sz)
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
	copy(f.buffer + f.offset, buf, sz)
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

vfile.unbuffered_reader = file.unbuffered_reader
vfile  .buffered_reader = file  .buffered_reader

--hi-level APIs --------------------------------------------------------------

ABORT = {} --error signal to pass to save()'s reader function.

function try_load_tobuffer(file, default_buf, default_len, ignore_file_size)
	local f, err = try_open(file)
	if not f then
		if err == 'not_found' and default_buf ~= nil then
			return default_buf, default_len
		end
		return nil, err
	end
	local buf, len = f:readall(nil, ignore_file_size)
	f:close()
	return buf, len
end

function try_load(file, ignore_file_size)
	local buf, len = try_load_tobuffer(file, ignore_file_size)
	if not buf then return nil, len end
	return str(buf, len)
end

function load_tobuffer(file, default_buf, default_len, ignore_file_size)
	local buf, len = try_load_tobuffer(file, default_buf, default_len, ignore_file_size)
	check('fs', 'load', buf ~= nil, '%s: %s', file, len)
	return buf, len
end

function load(path, default, ignore_file_size) --load a file into a string.
	local buf, len = load_tobuffer(path, default, nil, ignore_file_size)
	if buf == default then return default end
	return str(buf, len)
end

--write a Lua value, array of values or function results to a file atomically.
--TODO: make a file_saver() out of this without coroutines and use it
--in resize_image()!
local function _save(file, s, sz, perms)

	local tmpfile = file..'.tmp'

	local dir = path_dir(tmpfile)
	if path_dir(dir) then --because mkdir'c:/' gives access denied.
		local ok, err = try_mkdir(dir, true, perms)
		if not ok then
			return false, _('could not create dir %s: %s', dir, err)
		end
	end

	local f, err = try_open(tmpfile, perms and {mode = 'w', perms = perms} or 'w', true)
	if not f then
		return false, _('could not open file %s: %s', tmpfile, err)
	end

	local ok, err = true
	if istab(s) then --array of stringables
		for i = 1, #s do
			ok, err = f:write(tostring(s[i]))
			if not ok then break end
		end
	elseif isfunc(s) then --reader of buffers or stringables
		local read = s
		while true do
			local s, sz
			ok, s, sz = pcall(read)
			if not ok then err = s; break end
			if s == nil then
				if sz ~= nil then ok = false end --error, not eof
				break
			end
			if not iscdata(s) then
				s = tostring(s)
			end
			ok, err = f:write(s, sz)
			if not ok then break end
		end
	elseif s ~= nil and s ~= '' then --buffer or stringable
		if not iscdata(s) then
			s = tostring(s)
		end
		ok, err = f:write(s, sz)
	end
	f:close()

	if not ok then
		local err_msg = 'could not write to file %s: %s'
		local ok, rm_err = try_rmfile(tmpfile, true)
		if not ok then
			err_msg = err_msg..'\nremoving it also failed: %s'
		end
		return false, _(err_msg, tmpfile, err, rm_err)
	end

	local ok, err = try_mv(tmpfile, file, true)
	if not ok then
		local err_msg = 'could not move file %s -> %s: %s'
		local ok, rm_err = try_rmfile(tmpfile, true)
		if not ok then
			err_msg = err_msg..'\nremoving it also failed: %s'
		end
		return false, _(err_msg, tmpfile, file, err, rm_err)
	end

	return true
end

function try_save(file, s, sz, perms, quiet)
	local ok, err = _save(file, s, sz, perms)
	if not ok then return false, err end
	local sz = sz or isstr(s) and #s
	local ssz = sz and _(' (%s)', kbytes(sz)) or ''
	log(quiet and '' or 'note', 'fs', 'save', '%s%s', file, ssz)
	return true
end

function save(file, s, sz, perms, quiet)
	local ok, err = try_save(file, s, sz, perms, quiet)
	check('fs', 'save', ok, '%s: %s', file, err)
end

function file_saver(file)
	local coro = require'coro'
	local write = coro.wrap(function()
		return try_save(file, coro.yield)
	end)
	local ok, err = write()
	if not ok then return false, err end
	return write
end

--TODO: try_cp()
function cp(src_file, dst_file, quiet)
	log(quiet and '' or 'note', 'fs', 'cp', 'src: %s ->\ndst: %s', src_file, dst_file)
	--TODO: buffered read for large files.
	save(dst_file, load(src_file))
end

function try_touch(file, mtime, btime, quiet) --create file or update its mtime.
	if not exists(file) then
		local ok, err = try_save(file, '', quiet)
		if not ok then return false, err end
		if not (mtime or btime) then
			return
		end
	end
	if not quiet then
		log('', 'fs', 'touch', '%s to %s%s', file,
			date('%d-%m-%Y %H:%M', mtime) or 'now',
			btime and ', btime '..date('%d-%m-%Y %H:%M', btime) or '')
	end
	local ok, err = try_file_attr(file, {
		mtime = mtime or time(),
		btime = btime or nil,
	})
end

function touch(file, mtime, btime, quiet)
	local ok, err = try_touch(file, mtime, btime, quiet)
	return check('fs', 'touch', ok and file, '%s: %s', file, err)
end

--TODO: remove this or incorporate into ls() ?
function ls_dir(path, patt, min_mtime, create, order_by, recursive)
	if istab(path) then
		local t = path
		path, patt, min_mtime, create, order_by, recursive =
			t.path, t.find, t.min_mtime, t.create, t.order_by, t.recursive
	end
	local t = {}
	local create = create or function(file) return {} end
	if recursive then
		for sc in scandir(path) do
			local file, err = sc:name()
			if not file and err == 'not_found' then break end
			check('fs', 'dir', file, 'dir listing failed for %s: %s', sc:path(-1), err)
			if     (not min_mtime or sc:attr'mtime' >= min_mtime)
				and (not patt or file:find(patt))
			then
				local f = create(file, sc)
				if f then
					f.name    = file
					f.path    = sc:path()
					f.relpath = sc:relpath()
					f.type    = sc:attr'type'
					f.mtime   = sc:attr'mtime'
					f.btime   = sc:attr'btime'
					t[#t+1] = f
				end
			end
		end
	else
		for file, d in ls(path) do
			if not file and d == 'not_found' then break end
			check('fs', 'dir', file, 'dir listing failed for %s: %s', path, d)
			if     (not min_mtime or d:attr'mtime' >= min_mtime)
				and (not patt or file:find(patt))
			then
				local f = create(file, d)
				if f then
					f.name    = file
					f.path    = d:path()
					f.relpath = file
					f.type    = sc:attr'type'
					f.mtime   = d:attr'mtime'
					f.btime   = d:attr'btime'
					t[#t+1] = f
				end
			end
		end
	end
	sort(t, cmp(order_by or 'mtime path'))
	log('', 'fs', 'dir', '%-20s %5d files%s%s', path,
		#t,
		patt and '\n  match: '..patt or '',
		min_mtime and '\n  mtime >= '..date('%d-%m-%Y %H:%M', min_mtime) or '')
	local i = 0
	return function()
		i = i + 1
		return t[i]
	end
end

local function toid(s, field) --validate and id minimally.
	local n = tonumber(s)
	if n and n >= 0 and floor(n) == n then return n end
 	return nil, '%s invalid: %s', field or 'field', s
end
function gen_id(name, start, quiet)
	local next_id_file = varpath'next_'..name
	if not exists(next_id_file) then
		save(next_id_file, tostring(start or 1), nil, quiet)
	else
		touch(next_id_file, nil, nil, quiet)
	end
	local n = tonumber(load(next_id_file))
	check('fs', 'gen_id', toid(n, next_id_file))
	save(next_id_file, tostring(n + 1), nil, quiet)
	log('note', 'fs', 'gen_id', '%s: %d', name, n)
	return n
end

--load platfrom module -------------------------------------------------------

_fs_file = file
_fs_dir = dir
_fs_check_errno = check_errno

if win then
	require'fs_win'
elseif Linux or OSX then
	require'fs_posix'
else
	error'unsupported platform'
end

metatype(stream_ct, stream)
metatype(dir_ct, dir)
