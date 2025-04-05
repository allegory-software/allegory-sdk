--go@ plink d10 -t -batch /root/sdk/bin/linux/luajit /root/sdk/tests/fs_test.lua

--Portable filesystem API for LuaJIT | Linux+OSX backend
--Written by Cosmin Apreutesei. Public Domain.

if not ... then require'fs_test'; return end

require'glue'
require'unixperms'

--POSIX does not define an ABI and platfoms have different cdefs thus we have
--to limit support to the platforms and architectures we actually tested for.
assert(Linux or OSX, 'platform not Linux or OSX')
assert(package.loaded.fs)

local
	C, cast, bor, band, bnot, shl =
	C, cast, bor, band, bnot, shl

local file  = _fs_file
local dir   = _fs_dir
local check = check_errno

--types, consts, utils -------------------------------------------------------

cdef[[
typedef size_t ssize_t; // for older luajit
typedef unsigned int mode_t;
typedef unsigned int uid_t;
typedef unsigned int gid_t;
typedef size_t time_t;
typedef int64_t off64_t;
]]

cdef'int fcntl(int fd, int cmd, ...);' --fallocate, set_inheritable

if Linux then
	cdef'long syscall(int number, ...);' --stat, fstat, lstat
end

local cbuf = buffer'char[?]'

local default_file_perms = tonumber('644', 8)
local default_dir_perms  = tonumber('755', 8)

local function parse_perms(s, base)
	if isstr(s) then
		return unixperms_parse(s, base)
	else --pass-through
		return s or default_file_perms, false
	end
end

--open/close -----------------------------------------------------------------

cdef[[
int open(const char *pathname, int flags, mode_t mode);
int close(int fd);
]]

local o_bits = {
	--Linux & OSX
	rdonly    = OSX and 0x000000 or 0x000000, --access: read only
	wronly    = OSX and 0x000001 or 0x000001, --access: write only
	rdwr      = OSX and 0x000002 or 0x000002, --access: read + write
	accmode   = OSX and 0x000003 or 0x000003, --access: ioctl() only
	append    = OSX and 0x000008 or 0x000400, --append mode: write() at eof
	trunc     = OSX and 0x000400 or 0x000200, --truncate the file on opening
	creat     = OSX and 0x000200 or 0x000040, --create if not exist
	excl      = OSX and 0x000800 or 0x000080, --create or fail (needs 'creat')
	nofollow  = OSX and 0x000100 or 0x020000, --fail if file is a symlink
	directory = OSX and 0x100000 or 0x010000, --open if directory or fail
	async     = OSX and 0x000040 or 0x002000, --enable signal-driven I/O
	sync      = OSX and 0x000080 or 0x101000, --enable _file_ sync
	fsync     = OSX and 0x000080 or 0x101000, --'sync'
	dsync     = OSX and 0x400000 or 0x001000, --enable _data_ sync
	noctty    = OSX and 0x020000 or 0x000100, --prevent becoming ctty
	--Linux only
	direct    = Linux and 0x004000, --don't cache writes
	noatime   = Linux and 0x040000, --don't update atime
	rsync     = Linux and 0x101000, --'sync'
	path      = Linux and 0x200000, --open only for fd-level ops
   tmpfile   = Linux and 0x410000, --create anon temp file (Linux 3.11+)
	--OSX only
	shlock    = OSX and 0x000010, --get a shared lock
	exlock    = OSX and 0x000020, --get an exclusive lock
	evtonly   = OSX and 0x008000, --open for events only (allows unmount)
	symlink   = OSX and 0x200000, --open the symlink itself
}

_open_mode_opt = {
	['r' ] = {flags = 'rdonly'},
	['r+'] = {flags = 'rdwr'},
	['w' ] = {flags = 'creat wronly trunc'},
	['w+'] = {flags = 'creat rdwr'},
	['a' ] = {flags = 'creat wronly', seek_end = true},
	['a+'] = {flags = 'creat rdwr', seek_end = true},
}

local F_GETFL     = 3
local F_SETFL     = 4
local O_NONBLOCK  = OSX and 0x000004 or 0x000800 --async I/O
local O_CLOEXEC   = OSX and     2^24 or 0x080000 --close-on-exec

local F_GETFD = 1
local F_SETFD = 2
local FD_CLOEXEC = 1

local function fcntl_set_flags_func(GET, SET)
	return function(f, mask, bits)
		local cur_bits = C.fcntl(f.fd, GET)
		local bits = setbits(cur_bits, mask, bits)
		assert(check(C.fcntl(f.fd, SET, cast('int', bits)) == 0))
	end
end
local fcntl_set_fl_flags = fcntl_set_flags_func(F_GETFL, F_SETFL)
local fcntl_set_fd_flags = fcntl_set_flags_func(F_GETFD, F_SETFD)

function file_wrap_fd(fd, opt, async, file_type, path, quiet)

	file_type = file_type or 'file'

	--make `if f.seek then` the idiom for checking if a file is seekable.
	local seek; if file_type ~= 'file' or async then seek = false end

	local f = object(file, {
		fd = fd,
		s = fd, --for async use with sock
		type = file_type,
		seek = seek,
		debug_prefix =
			   file_type == 'file' and 'F'
			or file_type == 'pipe' and 'P'
			or file_type == 'pidfile' and 'D',
		w = 0, r = 0,
		quiet = repl(quiet, nil, file_type == 'pipe' or nil), --pipes are quiet
		path = path,
		async = async,
	}, opt)
	live(f, f.path or '')

	if f.async then
		fcntl_set_fl_flags(f, O_NONBLOCK, O_NONBLOCK)
		local ok, err = _sock_register(f)
		if not ok then
			assert(f:close())
			return nil, err
		end
	end

	return f
end

function _open(path, opt, quiet, file_type)
	local async = opt.async --files are sync by defualt
	local flags = bitflags(opt.flags or 'rdonly', o_bits)
	flags = bor(flags, async and O_NONBLOCK or 0)
	if not opt.inheritable then
		flags = bor(flags, O_CLOEXEC)
	end
	local r = band(flags, o_bits.rdonly) == o_bits.rdonly
	local w = band(flags, o_bits.wronly) == o_bits.wronly
	quiet = repl(quiet, nil, not w or nil) --r/o opens are quiet
	local perms = parse_perms(opt.perms)
	local open = opt.open or C.open
	local fd = open(path, flags, perms)
	if fd == -1 then
		return check()
	end
	local f, err = file_wrap_fd(fd, opt, async, file_type, path, quiet)
	if not f then
		return nil, err
	end
	log(f.quiet and '' or 'note', 'fs', 'open',
		'%-4s %s%s %s fd=%d', f, r and 'r' or '', w and 'w' or '', path, fd)

	if opt.seek_end then
		local pos, err = f:seek('end', 0)
		if not pos then
			assert(f:close())
			return nil, err
		end
	end

	return f
end

function file.closed(f)
	return f.fd == -1
end

function file.try_close(f)
	if f:closed() then return true end
	if f.async then
		_sock_unregister(f)
	end
	local ok = C.close(f.fd) == 0
	f.fd = -1 --fd is gone no matter the error.
	if not ok then return check(false) end
	log(f.quiet and '' or 'note', 'fs', 'closed', '%-4s r:%d w:%d', f, f.r, f.w)
	live(f, nil)
	return true
end

cdef[[
int fileno(struct FILE *stream);
]]

function fileno(file)
	local fd = C.fileno(file)
	if fd == -1 then return check() end
	return fd
end

function file_wrap_file(file, opt)
	local fd = C.fileno(file)
	if fd == -1 then return check() end
	return file_wrap_fd(fd, opt)
end

function file.set_inheritable(file, inheritable)
	fcntl_set_fd_flags(file, FD_CLOEXEC, inheritable and 0 or FD_CLOEXEC)
end

--pipes ----------------------------------------------------------------------

cdef[[
int pipe2(int[2], int flags);
int mkfifo(const char *pathname, mode_t mode);
]]

function try_mkfifo(path, perms, quiet)
	perms = parse_perms(perms)
	local ok, err = check(C.mkfifo(path, perms) == 0)
	if not ok and err ~= 'already_exists' then return nil, err end
	log(quiet and '' or 'note', 'fs', 'mkfifo', '%s %o', path, perms)
	if err == 'already_exists' then return true, err end
	return ok
end

function mkfifo(path, perms)
	perms = parse_perms(perms)
	local ok, err = try_mkfifo(path, perms)
	check('fs', 'mkfifo', ok, '%s %o', path, perms)
	if err then return ok, err end
	return ok
end

function _pipe(path, opt)
	local async = repl(opt.async, nil, true) --pipes are async by default
	if path then --named pipe
		local ok, err = try_mkfifo(path, perms, opt.quiet)
		if not ok then return nil, err end
		return _open(path, update({
			async = async,
		}, opt), true, 'pipe')
	else --unnamed pipe
		local fds = new'int[2]'
		local flags = not opt.inheritable and O_CLOEXEC or 0
		local ok = C.pipe2(fds, flags) == 0
		if not ok then return check() end
		local r_async = repl(opt.async_read , nil, async)
		local w_async = repl(opt.async_write, nil, async)
		local rf, err1 = file_wrap_fd(fds[0], opt, r_async, 'pipe', 'pipe.r')
		local wf, err2 = file_wrap_fd(fds[1], opt, w_async, 'pipe', 'pipe.w')
		if not (rf and wf) then
			if rf then assert(rf:close()) end
			if wf then assert(wf:close()) end
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
end

--stdio streams --------------------------------------------------------------

cdef'FILE *fdopen(int fd, const char *mode);'

function file.stream(f, mode)
	local fs = C.fdopen(f.fd, mode)
	if fs == nil then return check() end
	return fs
end

--i/o ------------------------------------------------------------------------

cdef(format([[
ssize_t read(int fd, void *buf, size_t count);
ssize_t write(int fd, const void *buf, size_t count);
int fsync(int fd);
int64_t lseek(int fd, int64_t offset, int whence) asm("lseek%s");
]], Linux and '64' or ''))

--NOTE: always ask for more than 0 bytes from a pipe or you'll not see EOF.
function file.try_read(f, buf, sz)
	if sz == 0 then return 0 end --masked for compat.
	if f.async then
		return _file_async_read(f, buf, sz)
	else
		local n = C.read(f.fd, buf, sz)
		if n == -1 then return check() end
		n = tonumber(n)
		f.r = f.r + n
		return n
	end
end

function file._write(f, buf, sz)
	if f.async then
		return _file_async_write(f, buf, sz)
	else
		local n = C.write(f.fd, buf, sz or #buf)
		if n == -1 then return check() end
		n = tonumber(n)
		f.w = f.w + n
		return n
	end
end

function file.try_flush(f)
	return check(C.fsync(f.fd) == 0)
end

function file._seek(f, whence, offset)
	local offs = C.lseek(f.fd, offset, whence)
	if offs == -1 then return check() end
	return tonumber(offs)
end

--truncate -------------------------------------------------------------------

cdef'int ftruncate(int fd, int64_t length);'

--NOTE: ftruncate() creates a sparse file (and so would seeking to size-1
--and writing '\0' there), so we need to call fallocate() to actually reserve
--any disk space. OTOH, fallocate() is only efficient on some file systems.

local fallocate

if OSX then

	local F_PREALLOCATE    = 42
	local F_ALLOCATECONTIG = 2
	local F_PEOFPOSMODE    = 3
	local F_ALLOCATEALL    = 4

	local fstore_ct = ctype[[
		struct {
			uint32_t fst_flags;
			int      fst_posmode;
			off64_t  fst_offset;
			off64_t  fst_length;
			off64_t  fst_bytesalloc;
		}
	]]

	local void = ctype'void*'
	local store
	function fallocate(fd, size)
		store = store or fstore_ct(F_ALLOCATECONTIG, F_PEOFPOSMODE, 0, 0)
		store.fst_bytesalloc = size
		local ret = C.fcntl(fd, F_PREALLOCATE, cast(void, store))
		if ret == -1 then --too fragmented, allocate non-contiguous space
			store.fst_flags = F_ALLOCATEALL
			local ret = C.fcntl(fd, F_PREALLOCATE, cast(void, store))
			if ret == -1 then return check(false) end
		end
		return true
	end

else

	cdef'int fallocate64(int fd, int mode, off64_t offset, off64_t len);'

	function fallocate(fd, size)
		return check(C.fallocate64(fd, 0, 0, size) == 0)
	end

end

--NOTE: lseek() is not defined for shm_open()'ed fds, that's why we ask
--for a `size` arg. The seek() behavior is just for compat with Windows.
function file.try_truncate(f, size, opt)
	assert(isnum(size), 'size expected')
	if not f.shm then
		local pos, err = f:seek('set', size)
		if not pos then return nil, err end
	end
	if not f.shm then
		opt = opt or 'fallocate fail' --emulate Windows behavior.
		if opt:find'fallocate' then
			local cursize, err = f:try_attr'size'
			if not cursize then return nil, err end
			local ok, err = fallocate(f.fd, size)
			if not ok then
				if err == 'disk_full' then
					--when fallocate() fails because disk is full, a file is still
					--created filling up the entire disk, so shrink back the file
					--to its original size. this is courtesy: we don't check to see
					--if this fails or not, and we return the original error code.
					C.ftruncate(f.fd, cursize)
				end
				if opt:find'fail' then
					return nil, err
				end
			end
		end
	end
	return check(C.ftruncate(f.fd, size) == 0)
end

--filesystem operations ------------------------------------------------------

cdef[[
int mkdir(const char *pathname, mode_t mode);
int rmdir(const char *pathname);
int chdir(const char *path);
char *getcwd(char *buf, size_t size);
int unlink(const char *pathname);
int rename(const char *oldpath, const char *newpath);
]]

function _mkdir(path, perms)
	perms = parse_perms(perms) or default_dir_perms
	return check(C.mkdir(path, perms) == 0)
end

function _rmdir(path)
	return check(C.rmdir(path) == 0)
end

function _chdir(path)
	startcwd()
	return check(C.chdir(path) == 0)
end

local ERANGE = 34

function cwd()
	while true do
		local buf, sz = cbuf(256)
		if C.getcwd(buf, sz) == nil then
			if errno() ~= ERANGE or buf >= 2048 then
				return assert(check())
			else
				buf, sz = cbuf(sz * 2)
			end
		end
		return str(buf)
	end
end
startcwd = memoize(cwd)

function _rmfile(path)
	return check(C.unlink(path) == 0)
end

function _mv(oldpath, newpath)
	return check(C.rename(oldpath, newpath) == 0)
end

--hardlinks & symlinks -------------------------------------------------------

cdef[[
int link(const char *oldpath, const char *newpath);
int symlink(const char *oldpath, const char *newpath);
ssize_t readlink(const char *path, char *buf, size_t bufsize);
]]

function _mksymlink(link_path, target_path)
	return check(C.symlink(target_path, link_path) == 0)
end

function _mkhardlink(link_path, target_path)
	return check(C.link(target_path, link_path) == 0)
end

local EINVAL = 22

function _readlink(link_path)
	local buf, sz = cbuf(256)
	::again::
	local len = C.readlink(link_path, buf, sz)
	if len == -1 then
		if errno() == EINVAL then --make it legit: no symlink, no target
			return nil
		end
		return check()
	end
	if len >= sz then --we don't know if sz was enough
		buf, sz = cbuf(sz * 2)
		goto again
	end
	return str(buf, len)
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

if OSX then
	cdef'int _NSGetExecutablePath(char* buf, uint32_t* bufsize);'
	function exepath()
		local buf, sz = cbuf(256)
		local out_sz = u32a(1)
		::again::
		if C._NSGetExecutablePath(buf, out_sz) ~= 0 then
			buf, sz = cbuf(out_sz[0])
			goto again
		end
		return (str(buf, sz):gsub('//', '/'))
	end
else
	function exepath()
		return readlink'/proc/self/exe'
	end
end
exepath = memoize(exepath)

--file attributes ------------------------------------------------------------

if Linux then cdef[[
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
]] elseif OSX then cdef[[
struct stat { // NOTE: 64bit version
	uint32_t st_dev;
	uint16_t st_mode;
	uint16_t st_nlink;
	uint64_t st_ino;
	uint32_t st_uid;
	uint32_t st_gid;
	uint32_t st_rdev;
	// NOTE: these were `struct timespec`
	time_t   st_atime;
	long     st_atime_nsec;
	time_t   st_mtime;
	long     st_mtime_nsec;
	time_t   st_ctime;
	long     st_ctime_nsec;
	time_t   st_btime; // birth-time i.e. creation time
	long     st_btime_nsec;
	int64_t  st_size;
	int64_t  st_blocks;
	int32_t  st_blksize;
	uint32_t st_flags;
	uint32_t st_gen;
	int32_t  st_lspare;
	int64_t  st_qspare[2];
};
int fstat64(int fd, struct stat *buf);
int stat64(const char *path, struct stat *buf);
int lstat64(const char *path, struct stat *buf);
]]
end

local fstat, stat, lstat

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
	return file_types[type]
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
	btime   = OSX and
				 function(st) return st_time(st.st_btime, st.st_btime_nsec) end,
}

local stat_ct = ctype'struct stat'
local st
local function wrap(stat_func)
	return function(arg, attr)
		st = st or stat_ct()
		local ok = stat_func(arg, st) == 0
		if not ok then return check() end
		if attr then
			local get = stat_getters[attr]
			return get and get(st)
		else
			local t = {}
			for k, get in pairs(stat_getters) do
				t[k] = get(st)
			end
			return t
		end
	end
end
if Linux then
	local void = ctype'void*'
	local int = ctype'int'
	fstat = wrap(function(f, st)
		return C.syscall(5, cast(int, f.fd), cast(void, st))
	end)
	stat = wrap(function(path, st)
		return C.syscall(4, cast(void, path), cast(void, st))
	end)
	lstat = wrap(function(path, st)
		return C.syscall(6, cast(void, path), cast(void, st))
	end)
elseif OSX then
	fstat = wrap(function(f, st) return C.fstat64(f.fd, st) end)
	stat = wrap(C.stat64)
	lstat = wrap(C.lstat64)
end

local utimes, futimes, lutimes

if Linux then

	cdef[[
	struct timespec {
		time_t tv_sec;
		long   tv_nsec;
	};
	int futimens(int fd, const struct timespec times[2]);
	int utimensat(int dirfd, const char *path, const struct timespec times[2], int flags);
	]]

	local UTIME_OMIT = shl(1,30)-2

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
	local ts
	function futimes(f, atime, mtime)
		ts = ts or ts_ct()
		set_timespec(atime, ts[0])
		set_timespec(mtime, ts[1])
		return check(C.futimens(f.fd, ts) == 0)
	end

	function utimes(path, atime, mtime)
		ts = ts or ts_ct()
		set_timespec(atime, ts[0])
		set_timespec(mtime, ts[1])
		return check(C.utimensat(AT_FDCWD, path, ts, 0) == 0)
	end

	local AT_SYMLINK_NOFOLLOW = 0x100

	function lutimes(path, atime, mtime)
		ts = ts or ts_ct()
		set_timespec(atime, ts[0])
		set_timespec(mtime, ts[1])
		return check(C.utimensat(AT_FDCWD, path, ts, AT_SYMLINK_NOFOLLOW) == 0)
	end

elseif OSX then

	cdef[[
	struct timeval {
		time_t  tv_sec;
		int32_t tv_usec; // ignored by futimes()
	};
	int futimes(int fd, const struct timeval times[2]);
	int utimes(const char *path, const struct timeval times[2]);
	int lutimes(const char *path, const struct timeval times[2]);
	]]

	local function set_timeval(ts, t)
		t.tv_sec = ts
		t.tv_usec = (ts - floor(ts)) * 1e7 --apparently ignored
	end

	--TODO: find a way to change btime too (probably with CF or Cocoa, which
	--means many more LOC and more BS for setting one damn integer).
	local tv_ct = ctype'struct timeval[2]'
	local tv
	local function wrap(utimes_func, stat_func)
		return function(arg, atime, mtime)
			tv = tv or tv_ct()
			if not atime or not mtime then
				local t, err = stat_func(arg)
				if not t then return nil, err end
				atime = atime or t.atime
				mtime = mtime or t.mtime
			end
			set_timeval(atime, tv[0])
			set_timeval(mtime, tv[1])
			return check(utimes_func(arg, tv) == 0)
		end
	end
	futimes = wrap(function(f, tv) return C.futimes(f.fd, tv) end, fstat)
	utimes  = wrap(C.utimes, stat)
	lutimes = wrap(C.lutimes, lstat)

end

cdef[[
int fchmod(int fd,           mode_t mode);
int  chmod(const char *path, mode_t mode);
int lchmod(const char *path, mode_t mode);
]]

local function wrap(chmod_func, stat_func)
	return function(f, perms)
		local cur_perms
		local _, is_rel = parse_perms(perms)
		if is_rel then
			local cur_perms, err = stat_func(f, 'perms')
			if not cur_perms then return nil, err end
		end
		local mode = parse_perms(perms, cur_perms)
		return chmod_func(f, mode) == 0
	end
end
local fchmod = wrap(function(f, mode) return C.fchmod(f.fd, mode) end, fstat)
local chmod = wrap(C.chmod, stat)
local lchmod = wrap(C.lchmod, lstat)

cdef[[
int fchown(int fd,           uid_t owner, gid_t group);
int  chown(const char *path, uid_t owner, gid_t group);
int lchown(const char *path, uid_t owner, gid_t group);
]]

cdef[[
typedef unsigned int uid_t;
typedef unsigned int gid_t;
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

local function wrap(chown_func)
	return function(arg, uid, gid)
		return chown_func(arg, get_uid(uid) or -1, get_gid(gid) or -1) == 0
	end
end
local fchown = wrap(function(f, uid, gid) return C.fchown(f.fd, uid, gid) end)
local chown = wrap(C.chown)
local lchown = wrap(C.lchown)

_file_attr_get = fstat

function _fs_attr_get(path, attr, deref)
	local stat = deref and stat or lstat
	return stat(path, attr)
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

_file_attr_set = wrap(fchmod, fchown, futimes)

local set_deref   = wrap( chmod,  chown,  utimes)
local set_symlink = wrap(lchmod, lchown, lutimes)
function _fs_attr_set(path, t, deref)
	local set = deref and set_deref or set_symlink
	return set(path, t)
end

--directory listing ----------------------------------------------------------

if Linux then cdef[[
struct dirent { // NOTE: 64bit version
	uint64_t        d_ino;
	int64_t         d_off;
	unsigned short  d_reclen;
	unsigned char   d_type;
	char            d_name[256];
};
]] elseif OSX then cdef[[
struct dirent { // NOTE: 64bit version
	uint64_t d_ino;
	uint64_t d_seekoff;
	uint16_t d_reclen;
	uint16_t d_namlen;
	uint8_t  d_type;
	char     d_name[1024];
};
]] end

cdef(format([[
typedef struct DIR DIR;
DIR *opendir(const char *name);
struct dirent *readdir(DIR *dirp) asm("%s");
int closedir(DIR *dirp);
]], Linux and 'readdir64' or OSX and 'readdir$INODE64'))

dir_ct = ctype[[
	struct {
		DIR *_dirp;
		struct dirent* _dentry;
		int  _errno;
		int  _dirlen;
		char _skip_dot_dirs;
		char _dir[?];
	}
]]

function dir.try_close(dir)
	if dir:closed() then return true end
	local ok = C.closedir(dir._dirp) == 0
	if not ok then return check(false) end
	dir._dirp = nil
	return true
end

function dir.close(dir)
	assert(dir:try_close())
end

function dir_ready(dir)
	return dir._dentry ~= nil
end

function dir.closed(dir)
	return dir._dirp == nil
end

function dir_name(dir)
	return str(dir._dentry.d_name)
end

function dir.dir(dir)
	return str(dir._dir, dir._dirlen)
end

function dir.next(dir)
	if dir:closed() then
		if dir._errno ~= 0 then
			local errno = dir._errno
			dir._errno = 0
			return check(false, errno)
		end
		return nil
	end
	errno(0)
	dir._dentry = C.readdir(dir._dirp)
	if dir._dentry ~= nil then
		local name = dir:name()
		if dir._skip_dot_dirs == 1 and (name == '.' or name == '..') then
			return dir.next(dir)
		end
		return name, dir
	else
		local errno = errno()
		dir:close()
		if errno == 0 then
			return nil
		end
		return check(false, errno)
	end
end

function _ls(path, skip_dot_dirs)
	local dir = dir_ct(#path)
	dir._dirlen = #path
	copy(dir._dir, path, #path)
	dir._skip_dot_dirs = skip_dot_dirs and 1 or 0
	dir._dirp = C.opendir(path)
	if dir._dirp == nil then
		dir._errno = errno()
	end
	return dir.next, dir
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

function _dir_attr_get(dir, attr)
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

--memory mapping -------------------------------------------------------------

local librt = C
if Linux then --for shm_open()
	local ok, rt = pcall(ffi.load, 'rt')
	if ok then librt = rt end
end

if Linux then
	cdef'int __getpagesize();'
elseif OSX then
	cdef'int getpagesize();'
end
local getpagesize = Linux and C.__getpagesize or C.getpagesize
pagesize = memoize(function() return getpagesize() end)

cdef[[
int shm_open(const char *name, int oflag, mode_t mode);
int shm_unlink(const char *name);
]]

cdef(format([[
void* mmap(void *addr, size_t length, int prot, int flags,
	int fd, off64_t offset) asm("%s");
int munmap(void *addr, size_t length);
int msync(void *addr, size_t length, int flags);
int mprotect(void *addr, size_t len, int prot);
]], OSX and 'mmap' or 'mmap64'))

local PROT_READ  = 1
local PROT_WRITE = 2
local PROT_EXEC  = 4

local function protect_bits(write, exec, copy)
	return bor(PROT_READ,
		(write or copy) and PROT_WRITE or 0,
		exec and PROT_EXEC or 0)
end

local function mmap(...)
	local addr = C.mmap(...)
	local ok, err = check(cast('intptr_t', addr) ~= -1)
	if not ok then return nil, err end
	return addr
end

local MAP_SHARED  = 1
local MAP_PRIVATE = 2 --copy-on-write
local MAP_FIXED   = 0x0010
local MAP_ANON    = OSX and 0x1000 or 0x0020

function _mmap(path, access, size, offset, addr, tagname, perms)

	local write, exec, copy = parse_access(access or '')

	path = path or tagname and check_tagname(tagname)

	--open the file, if any.

	local file
	local function exit(err)
		if file then file:try_close() end
		return nil, err
	end

	if isstr(path) then
		local flags = write and 'rdwr creat' or 'rdonly'
		local perms = perms and parse_perms(perms)
			or tonumber('400', 8) +
				(write and tonumber('200', 8) or 0) +
				(exec  and tonumber('100', 8) or 0)
		local err
		file, err = _open(path, {
				flags = flags, perms = perms,
				open = tagname and librt.shm_open,
				shm = tagname and true or nil,
			})
		if not file then
			return nil, err
		end
	end

	--emulate Windows behavior for missing size and size mismatches.

	if file then
		if not size then --if size not given, assume entire file.
			local filesize, err = file:try_attr'size'
			if not filesize then
				return exit(err)
			end
			size = filesize - offset
		elseif write then --if writable file too short, extend it.
			local filesize, err = file:try_attr'size'
			if not filesize then
				return exit(err)
			end
			if filesize < offset + size then
				local ok, err = file:try_truncate(offset + size)
				if not ok then
					return exit(err)
				end
			end
		else --if read/only file too short.
			local filesize, err = file:try_attr'size'
			if not filesize then
				return exit(err)
			end
			if filesize < offset + size then
				return exit'file_too_short'
			end
		end
	end

	--mmap the file.

	local protect = protect_bits(write, exec, copy)

	local flags = bor(
		copy and MAP_PRIVATE or MAP_SHARED,
		file and 0 or MAP_ANON,
		addr and MAP_FIXED or 0)

	local addr, err = mmap(addr, size, protect, flags, file and file.fd or -1, offset)
	if not addr then return exit(err) end

	--create the map object.

	local MS_ASYNC      = 1
	local MS_INVALIDATE = 2
	local MS_SYNC       = OSX and 0x0010 or 4

	local function flush(self, async, addr, sz)
		if not isbool(async) then --async arg is optional
			async, addr, sz = false, async, addr
		end
		local addr = aligned_addr(addr or self.addr, 'left')
		local flags = bor(async and MS_ASYNC or MS_SYNC, MS_INVALIDATE)
		local ok = C.msync(addr, sz or self.size, flags) == 0
		if not ok then return check(false) end
		return true
	end

	local function free()
		C.munmap(addr, size)
		exit()
	end

	local function unlink()
		return unlink_mapfile(tagname)
	end

	return {addr = addr, size = size, free = free,
		flush = flush, unlink = unlink, access = access}

end

function unlink_mapfile(tagname)
	local ok, err = check(librt.shm_unlink(check_tagname(tagname)) == 0)
	if ok or err == 'not_found' then return true end
	return nil, err
end

function mprotect(addr, size, access)
	local protect = protect_bits(parse_access(access or 'x'))
	return check(C.mprotect(addr, size, protect) == 0)
end

--mirror buffer --------------------------------------------------------------

if Linux then

cdef'int memfd_create(const char *name, unsigned int flags);'
local MFD_CLOEXEC = 0x0001

function mirror_buffer(size, addr)

	local size = aligned_size(size or 1)

	local fd = C.memfd_create('mirror_buffer', MFD_CLOEXEC)
	if fd == -1 then return check() end

	local addr1, addr2

	local function free()
		if addr1 then C.munmap(addr1, size) end
		if addr2 then C.munmap(addr2, size) end
		if fd then C.close(fd) end
	end

	local ok, err = check(C.ftruncate(fd, size) == 0)
	if not ok then
		free()
		return nil, err
	end

	for i = 1, 100 do

		local addr = cast('void*', addr)
		local flags = bor(MAP_PRIVATE, MAP_ANON, addr ~= nil and MAP_FIXED or 0)
		local addr0, err = mmap(addr, size * 2, 0, flags, 0, 0)
		if not addr0 then
			free()
			return nil, err
		end

		C.munmap(addr0, size * 2)

		local protect = bor(PROT_READ, PROT_WRITE)
		local flags = bor(MAP_SHARED, MAP_FIXED)

		addr1, err = mmap(addr0, size, protect, flags, fd, 0)
		if not addr1 then
			goto skip
		end

		addr2 = cast('uint8_t*', addr1) + size
		addr2, err = mmap(addr2, size, protect, flags, fd, 0)
		if not addr2 then
			C.munmap(addr1, size)
			goto skip
		end

		C.close(fd)
		fd = nil

		do return {addr = addr1, size = size, free = free} end

		::skip::
	end

	free()
	return nil, 'max_tries'

end

elseif OSX then

function mirror_buffer(size, addr)
	error'NYI'
end

end --if OSX

if Linux then

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
	fsblkcnt_t f_bavail;  /* Free blocks available to
									 unprivileged user */
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
	local ok, err = check(C.statfs(path, statfs_buf) == 0)
	if not ok then return nil, err end
	return statfs_buf
end

function fs_info(path)
	local buf, err = statfs(path)
	if not buf then return nil, err end
	local t = {}
	t.size = tonumber(buf.f_blocks * buf.f_bsize)
	t.free = tonumber(buf.f_bfree  * buf.f_bsize)
	return t
end

--pollable pid files ---------------------------------------------------------

--NOTE: Linux 5.3+ feature, not used yet. Intended to replace polling
--for process status change in proc_posix.lua.

local PIDFD_NONBLOCK = 0x000800

function pidfd_open(pid, opt, quiet)
	local async = not (opt and opt.async == false)
	local flags = async and PIDFD_NONBLOCK or 0
	local fd = syscall(434, pid, flags)
	if fd == -1 then
		return check()
	end
	local f, err = file_wrap_fd(fd, opt, async, 'pidfile', nil, quiet)
	if not f then
		return nil, err
	end
	return f
end


end --if Linux
