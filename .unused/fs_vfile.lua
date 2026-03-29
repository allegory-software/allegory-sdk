--[[

MEMORY STREAMS
	open_buffer(buf, [size], [mode]) -> f         create a memory stream

Memory Streams ---------------------------------------------------------------

open_buffer(buf, [size], [mode]) -> f

	Create a memory stream for reading and writing data from and into a buffer
	using the file API. Only opening modes 'r' and 'w' are supported.

]]

--memory streams -------------------------------------------------------------

local vfile = {}

vfile.check_io = check_io
vfile.checkp   = checkp

function open_buffer(buf, sz, mode)
	sz = sz or #buf
	mode = mode or 'r'
	assertf(mode == 'r' or mode == 'w', 'invalid mode: "%s"', mode)
	local f = {
		b = string_buffer():set(buf, sz),
		offset = 0,
		mode = mode,
		w = 0,
		r = 0,
		__index = vfile,
	}
	return setmetatable(f, f)
end

function vfile.closed(f)
	return not f.b
end

function vfile.try_close(f)
	if f.b then
		f.b:free()
		f.b = nil
	end
	return true
end

vfile.onclose = file.onclose

function vfile.try_attr(f, attr)
	assert(not istab(attr))
	if attr == 'size' then
		return #f.b
	else
		assert(false)
	end
end

function vfile.try_flush(f)
	if not f.b then
		return nil, 'access_denied'
	end
	return true
end

function vfile.try_read(f, buf, sz)
	if not f.b then
		return nil, 'access_denied'
	end
	sz = min(max(0, sz), max(0, #f.b - f.offset))
	copy(buf, f.b:ref() + f.offset, sz)
	f.offset = f.offset + sz
	f.r = f.r + sz
	return sz
end

vfile.try_readn   = file.try_readn
vfile.try_readall = file.try_readall

function vfile.try_write(f, buf, sz)
	if not f.b then
		return nil, 'access_denied'
	end
	if f.mode ~= 'w' then
		return nil, 'access_denied'
	end
	sz = max(0, sz)
	local sz0 = #f.b
	local sz1 = f.offset + sz
	local grow = sz1 - sz0
	if grow > 0 then
		f.b:reserve(grow)
		f.b:commit(grow)
	end
	copy(f.b:ref() + f.offset, buf, sz)
	f.offset = f.offset + sz
	f.w = f.w + sz
	return sz
end

function vfile._seek(f, whence, offset)
	if whence == 1 then --cur
		offset = f.offset + offset
	elseif whence == 2 then --end
		offset = #f.b + offset
	end
	offset = max(offset, 0)
	f.offset = offset
	return offset
end
vfile.try_seek = file.try_seek
vfile.try_skip = file.try_skip

function vfile.try_truncate(f, n)
	local pos, err = f:try_seek(n)
	if not pos then return nil, err end
	local b = f.b
	local n0 = #b
	if n == 0 then
		b:reset()
	elseif n > n0 then
		local n = n - n0
		local p = b:reserve(n)
		fill(p, n)
		b:commit(n)
	elseif n < n0 then
		return nil, 'NYI'
	end
	return true
end

vfile.unbuffered_reader = file.unbuffered_reader
vfile  .buffered_reader = file  .buffered_reader

vfile.close    = unprotect_io(vfile.try_close)
vfile.read     = unprotect_io(vfile.try_read)
vfile.write    = unprotect_io(vfile.try_write)
vfile.readn    = unprotect_io(vfile.try_readn)
vfile.readall  = unprotect_io(vfile.try_readall)
vfile.flush    = unprotect_io(vfile.try_flush)
vfile.truncate = unprotect_io(vfile.try_truncate)
vfile.seek     = unprotect_io(vfile.try_seek)
vfile.skip     = unprotect_io(vfile.try_skip)

--tests ----------------------------------------------------------------------

function test.open_buffer()
	local sz = 100
	local buf = ffi.new('char[?]', sz)
	ffi.fill(buf, sz, 42)
	local f = open_buffer(buf, sz, 'w')
	assert(f:seek(100) == 100)
	assert(f:seek(100) == 200)
	assert(f:seek() == 200)
	assert(f:seek('end', 0) == 100)
	assert(f:seek('set', 0) == 0)
	local buf = ffi.new('char[?]', 100)
	assert(f:seek(200) == 200)
	assert(f:read(buf, 10) == 0)
	assert(f:seek('set', 50) == 50)
	assert(f:read(buf, 1000) == 50)
	assert(str(buf, 50) == (char(42):rep(50)))
	assert(f:write(buf, 1000) == 1000)
	assert(f:seek('set', 0))
	ffi.fill(buf, sz, 43)
	assert(f:write(buf, 1000) == 1000)
	assert(str(buf, 100) == (char(43):rep(100)))
	f:close()
	assert(f:closed())
	assert(f:try_read(buf, 1000) == nil)
	assert(f:try_write(buf, 1000) == nil)
end

