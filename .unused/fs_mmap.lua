--[[
MEMORY MAPPING
	mmap(...) -> map                              create a memory mapping
	f:map([offset],[size],[addr],[access]) -> map   create a memory mapping
	map.addr                                      a void* pointer to the mapped memory
	map.size                                      size of the mapped memory in bytes
	map:flush([async, ][addr, size])              flush (parts of) the mapping to disk
	map:free()                                    release the memory and associated resources
	unlink_mapfile(tagname)                       remove the shared memory file from disk
	map:unlink()
	mirror_buffer([size], [addr]) -> map          create a mirrored memory-mapped ring buffer
	pagesize() -> bytes                           get allocation granularity
	aligned_size(bytes[, dir]) -> bytes           next/prev page-aligned size
	aligned_addr(ptr[, dir]) -> ptr               next/prev page-aligned address


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

[try_]mmap(args_t) -> map
[try_]mmap(path, [access], [size], [offset], [addr], [tagname], [perms]) -> map
f:[try_]map([offset], [size], [addr], [access])

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

map:[try_]flush([async, ][addr, size]) -> true | nil,err

	Flush (part of) the memory to disk. If the address is not aligned,
	it will be automatically aligned to the left. If `async` is true,
	perform the operation asynchronously and return immediately.

unlink_mapfile(tagname)` <br> `map:unlink()

	Remove a (the) shared memory file from disk. When creating a shared memory
	mapping using `tagname`, a file is created on the filesystem. That file
	must be removed manually when it is no longer needed. This can be done
	anytime, even while mappings are open and will not affect said mappings.

mirror_buffer([size], [addr]) -> map

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


]]

--memory mapping -------------------------------------------------------------

local librt = C
do --for shm_open()
	local ok, rt = pcall(ffi.load, 'rt')
	if ok then librt = rt end
end

cdef'int __getpagesize();'
local getpagesize = C.__getpagesize
pagesize = memoize(function() return getpagesize() end)

cdef[[
int shm_open(const char *name, int oflag, mode_t mode);
int shm_unlink(const char *name);

void* mmap(void *addr, size_t length, int prot, int flags,
	int fd, off64_t offset) asm("mmap64");
int munmap(void *addr, size_t length);
int msync(void *addr, size_t length, int flags);
int mprotect(void *addr, size_t len, int prot);
]]

local PROT_READ  = 1
local PROT_WRITE = 2
local PROT_EXEC  = 4

local function protect_bits(write, exec, copy)
	return bor(PROT_READ,
		(write or copy) and PROT_WRITE or 0,
		exec and PROT_EXEC or 0)
end

local function C_mmap(...)
	local addr = C.mmap(...)
	local ok, err = check_errno(cast('intptr_t', addr) ~= -1)
	if not ok then return nil, err end
	return addr
end

function check_tagname(tagname)
	assert(not tagname:find'[/\\]', 'tagname cannot contain `/` or `\\`')
	return tagname
end

local MAP_SHARED  = 1
local MAP_PRIVATE = 2 --copy-on-write
local MAP_FIXED   = 0x0010
local MAP_ANON    = 0x0020

--TODO: merge this into mmap()
local function _mmap(path, access, size, offset, addr, tagname, perms)

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
		local perms = parse_perms(perms)
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

	local addr, err = C_mmap(addr, size, protect, flags, file and file.fd or -1, offset)
	if not addr then return exit(err) end

	--create the map object.

	local MS_ASYNC      = 1
	local MS_INVALIDATE = 2
	local MS_SYNC       = 4

	local function flush(self, async, addr, sz)
		if not isbool(async) then --async arg is optional
			async, addr, sz = false, async, addr
		end
		local addr = aligned_addr(addr or self.addr, 'left')
		local flags = bor(async and MS_ASYNC or MS_SYNC, MS_INVALIDATE)
		local ok = C.msync(addr, sz or self.size, flags) == 0
		if not ok then return check_errno(false) end
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
	local ok, err = check_errno(librt.shm_unlink(check_tagname(tagname)) == 0)
	if ok or err == 'not_found' then return true end
	return nil, err
end

function mprotect(addr, size, access)
	local protect = protect_bits(parse_access(access or 'x'))
	return check_errno(C.mprotect(addr, size, protect) == 0)
end

local split_uint64, join_uint64
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
	if isctype(u64, size) then --an uintptr_t on x64
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

function file.try_mmap(f, t, ...)
	local access, size, offset, addr
	if istab(t) then
		access, size, offset, addr = t.access, t.size, t.offset, t.addr
	else
		offset, size, addr, access = t, ...
	end
	return try_mmap(f, access or f.access, size, offset, addr)
end
function file:mmap(...)
	self:check_io(self:try_mmap(...))
end

function try_mmap(t, ...)
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
	return _mmap(file, access, size, offset, addr, tagname, perms)
end
function mmap(...)
	return check_io(nil, try_mmap(...))
end

--mirror buffer --------------------------------------------------------------

cdef'int memfd_create(const char *name, unsigned int flags);'
local MFD_CLOEXEC = 0x0001

function mirror_buffer(size, addr)

	local size = aligned_size(size or 1)

	local fd = C.memfd_create('mirror_buffer', MFD_CLOEXEC)
	if fd == -1 then return check_errno() end

	local addr1, addr2

	local function free()
		if addr1 then C.munmap(addr1, size) end
		if addr2 then C.munmap(addr2, size) end
		if fd then C.close(fd) end
	end

	local ok, err = check_errno(C.ftruncate(fd, size) == 0)
	if not ok then
		free()
		return nil, err
	end

	for i = 1, 100 do

		local addr = cast('void*', addr)
		local flags = bor(MAP_PRIVATE, MAP_ANON, addr ~= nil and MAP_FIXED or 0)
		local addr0, err = try_mmap(addr, size * 2, 0, flags, 0, 0)
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
