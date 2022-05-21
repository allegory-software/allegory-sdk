--[[

	ZLIB binding, providing:
		* DEFLATE compression & decompression.
		* GZIP file compression & decompression.
		* CRC32 & ADLER32 checksums.
	Written by Cosmin Apreutesei. Public Domain.

DEFLATE ----------------------------------------------------------------------

zlib.deflate(read, write, [bufsize], [format], [level], [method], [windowBits], [memLevel], [strategy])
zlib.inflate(read, write, [bufsize], [format], [windowBits])

	Compress/decompress a data stream using the DEFLATE algorithm.

	* `read` is a function `read() -> s[,size] | cdata,size | nil | false,err`,
	  but it can also be a string or a table of strings.

	* `write` is a function `write(cdata, size) -> nil | false,err`, but it
	  can also be '' (in which case a string with the output is returned) or
	  an output table (in which case a table of output chunks is returned).

	* callbacks are allowed to yield and abort by returning `false,err`.
	* errors raised in callbacks pass-through uncaught (but don't leak).
	* `nil,err` is returned for zlib errors and callback aborts.
	* an abandoned thread suspended in read/write callbacks is gc'ed leak-free.

	* `bufsize` affects the frequency and size of the writes (defaults to 64K).
	* `format` can be 'zlib' (default), 'gzip' or 'raw'.
	* `level` controls the compression level (0-9 from none to best).
	* for `windowBits`, `memLevel` and `strategy` refer to the zlib manual.
	  * note that our `windowBits` is always in the positive range 8..15.

GZIP files -------------------------------------------------------------------

zlib.open(filename[, mode][, bufsize]) -> gzfile
gzfile:close()
gzfile:flush('none|partial|sync|full|finish|block|trees')
gzfile:read_tobuffer(buf, size) -> bytes_read
gzfile:read(size) -> s
gzfile:write(cdata, size) -> bytes_written
gzfile:write(s[, size]) -> bytes_written
gzfile:eof() -> true|false     NOTE: only true if trying to read *past* EOF!
gzfile:seek(['cur'|'set'], [offset])
	If the file is opened for reading, this function is emulated but can be
	extremely slow. If the file is opened for writing, only forward seeks are
	supported: `seek()` then compresses a sequence of zeroes up to the new
	starting position. If the file is opened for writing and the new starting
	position is before the current position, an error occurs.
	Returns the resulting offset location as measured in bytes from the
	beginning of the uncompressed stream.
gzfile:offset() -> n
	When reading, the offset does not include as yet unused buffered input.
	This information can be used for a progress indicator.

CRC32 & ADLER32 --------------------------------------------------------------

zlib.adler32(cdata, size[, adler]) -> n
zlib.adler32(s, [size][, adler]) -> n
zlib.crc32(cdata, size[, crc]) -> n
zlib.crc32(s, [size][, crc]) -> n

NOTE: Adler-32 is much faster than CRC-32B and almost as reliable.
]]

if not ... then require'zlib_test'; return end

local ffi = require'ffi'
require'zlib_h'
local C = ffi.load'z'

local zlib = {C = C}

function zlib.version()
	return ffi.string(C.zlibVersion())
end

local u8a = ffi.typeof'uint8_t[?]'

local function inflate_deflate(deflate, read, write, bufsize, format, windowBits, ...)

	if type(read) == 'string' then
		local s = read
		local done
		read = function()
			if done then return end
			done = true
			return s
		end
	elseif type(read) == 'table' then
		local t = read
		local i = 0
		read = function()
			i = i + 1
			return t[i]
		end
	end

	local t
	local asstring = write == ''
	if type(write) == 'table' or asstring then
		t = asstring and {} or write
		write = function(data, sz)
			t[#t+1] = ffi.string(data, sz)
		end
	end

	bufsize = bufsize or 64 * 1024

	--range 8..15; 0=use-value-in-zlib-header; see gzip manual.
	windowBits = windowBits or C.Z_MAX_WBITS
	if format == 'gzip' then windowBits = windowBits + 16 end
	if format == 'raw'  then windowBits = -windowBits end

	local strm = ffi.new'z_stream'
	local ret, flate, flate_end
	if deflate then
		local level, method, memLevel, strategy = ...
		level = level or C.Z_DEFAULT_COMPRESSION
		method = method or C.Z_DEFLATED
		memLevel = memLevel or 8
		strategy = strategy or C.Z_DEFAULT_STRATEGY
		flate, flate_end = C.deflate, C.deflateEnd
		ret = C.deflateInit2_(strm, level, method, windowBits, memLevel,
			strategy, C.zlibVersion(), ffi.sizeof(strm))
	else
		flate, flate_end = C.inflate, C.inflateEnd
		ret = C.inflateInit2_(strm, windowBits, C.zlibVersion(), ffi.sizeof(strm))
	end
	if ret ~= 0 then
		error(ffi.string(C.zError(ret)))
	end
	ffi.gc(strm, flate_end)

	local buf = u8a(bufsize)
	strm.next_out, strm.avail_out = buf, bufsize
	strm.next_in, strm.avail_in = nil, 0

	local ok, err, ret, data, size --data must be anchored as an upvalue!
	::read::
		data, size = read()
		if data == false then
			ok, err = false, size
			goto finish
		end
		size = size or (data and #data) or 0
		strm.next_in, strm.avail_in = data, size
	::flate::
		ret = flate(strm, size > 0 and C.Z_NO_FLUSH or C.Z_FINISH)
		if not (ret == 0 or ret == C.Z_STREAM_END) then
			ok, err = false, ffi.string(C.zError(ret))
			goto finish
		end
		if strm.avail_out == bufsize then --nothing to write, need more data.
			assert(strm.avail_in == 0)
			if ret ~= C.Z_STREAM_END then goto read end
		end
	::write::
		ok, err = write(buf, bufsize - strm.avail_out)
		if ok == false then goto finish end --abort
		strm.next_out, strm.avail_out = buf, bufsize
		if ret == C.Z_STREAM_END then ok = true; goto finish end
		if strm.avail_in > 0 then goto flate end --more data to flate.
		goto read
	::finish::
		flate_end(ffi.gc(strm, nil))
		if not ok then return nil, err end
		if asstring then return table.concat(t) end
		return t or true
end
function zlib.deflate(read, write, bufsize, format, level, method, windowBits, ...)
	return inflate_deflate(true, read, write, bufsize, format, windowBits, level, method, ...)
end
function zlib.inflate(read, write, bufsize, format, windowBits)
	return inflate_deflate(false, read, write, bufsize, format, windowBits)
end

--gzip file access functions -------------------------------------------------

local function checkz(ret) assert(ret == 0) end
local function checkminus1(ret) assert(ret ~= -1); return ret end
local function ptr(o) return o ~= nil and o or nil end

local function gzclose(gzfile)
	checkz(C.gzclose(gzfile))
	ffi.gc(gzfile, nil)
end

function zlib.open(filename, mode, bufsize)
	local gzfile = ptr(C.gzopen(filename, mode or 'r'))
	if not gzfile then
		return nil, string.format('errno %d', ffi.errno())
	end
	ffi.gc(gzfile, gzclose)
	if bufsize then C.gzbuffer(gzfile, bufsize) end
	return gzfile
end

local flush_enum = {
	none    = C.Z_NO_FLUSH,
	partial = C.Z_PARTIAL_FLUSH,
	sync    = C.Z_SYNC_FLUSH,
	full    = C.Z_FULL_FLUSH,
	finish  = C.Z_FINISH,
	block   = C.Z_BLOCK,
	trees   = C.Z_TREES,
}

local function gzflush(gzfile, flush)
	checkz(C.gzflush(gzfile, flush_enum[flush]))
end

local function gzread_tobuffer(gzfile, buf, sz)
	return checkminus1(C.gzread(gzfile, buf, sz))
end

local function gzread(gzfile, sz)
	local buf = ffi.new('uint8_t[?]', sz)
	return ffi.string(buf, gzread_tobuffer(gzfile, buf, sz))
end

local function gzwrite(gzfile, data, sz)
	sz = C.gzwrite(gzfile, data, sz or #data)
	if sz == 0 then return nil,'error' end
	return sz
end

local function gzeof(gzfile)
	return C.gzeof(gzfile) == 1
end

local function gzseek(gzfile, ...)
	local narg = select('#',...)
	local whence, offset
	if narg == 0 then
		whence, offset = 'cur', 0
	elseif narg == 1 then
		if type(...) == 'string' then
			whence, offset = ..., 0
		else
			whence, offset = 'cur',...
		end
	else
		whence, offset = ...
	end
	whence = assert(whence == 'set' and 0 or whence == 'cur' and 1)
	return checkminus1(C.gzseek(gzfile, offset, whence))
end

local function gzoffset(gzfile)
	return checkminus1(C.gzoffset(gzfile))
end

ffi.metatype('gzFile_s', {__index = {
	close = gzclose,
	read = gzread,
	write = gzwrite,
	flush = gzflush,
	eof = gzeof,
	seek = gzseek,
	offset = gzoffset,
}})

--checksum functions ---------------------------------------------------------

function zlib.adler32(data, sz, adler)
	adler = adler or C.adler32(0, nil, 0)
	return tonumber(C.adler32(adler, data, sz or #data))
end

function zlib.crc32(data, sz, crc)
	crc = crc or C.crc32(0, nil, 0)
	return tonumber(C.crc32(crc, data, sz or #data))
end

return zlib
