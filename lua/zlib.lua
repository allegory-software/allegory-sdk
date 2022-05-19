--[[

	ZLIB binding, providing:
		* DEFLATE compression & decompression
		* GZIP file compression & decompression
		* CRC32 & ADLER32 checksums.
	Written by Cosmin Apreutesei. Public Domain.

DEFLATE ----------------------------------------------------------------------

zlib.deflate(read, write, [bufsize], [format], [level], [windowBits], [memLevel], [strategy])
zlib.inflate(read, write, [bufsize], [format], [windowBits])

	Compress/decompress a data stream using the DEFLATE algorithm.

	* `read` is a function `read() -> s[,size] | cdata,size | nil (=eof)`,
	  but it can also be a string or a table of strings.

	* `write` is a function `write(cdata, size)`, but it can also be an
	  empty string (in which case a string with the output is returned) or
	  an output table (in which case a table of output chunks is returned).

	* both the reader and the writer are allowed to yield and raise errors.

	* all errors be it from zlib or from callbacks are captured and `nil,err`
	  is returned if that happens (otherwise true is returned).

	* an abandoned thread suspended in read/write callbacks is gc'ed leak-free
	  but gc pressure is not proportional to consumed memory (88 bytes),
	  so abort the operation by raising an error in the callbacks instead.

	* `bufsize` affects the frequency and size of the writes (defaults to 64K).

	* `format` can be:
	  * 'zlib' - wrap the deflate stream with a zlib header and trailer (default).
	  * 'gzip' - wrap the deflate stream with a gzip header and trailer.
	  * 'deflate' - write a raw deflate stream with no header or trailer.

	* `level` controls the compression level (0-9 from none to best).

	* for `windowBits`, `memLevel` and `strategy` refer to the zlib manual.
	  * note that `windowBits` is always in the positive range 8..15.

GZIP files -------------------------------------------------------------------

zlib.open(filename[, mode][, bufsize]) -> gzfile

	Open a gzip file for reading or writing.

gzfile:close()

	Close the gzip file flushing any pending updates.

gzfile:flush(flag)

	Flushes any pending updates to the file. The flag can be
	`'none'`, `'partial'`, `'sync'`, `'full'`, `'finish'`, `'block'` or `'trees'`.
	Refer to the [zlib manual] for their meaning.

gzfile:read_tobuffer(buf, size) -> bytes_read
gzfile:read(size) -> s

	Read the given number of uncompressed bytes from the compressed file.
	If the input file is not in gzip format, copy the bytes as they are instead.

gzfile:write(cdata, size) -> bytes_written
gzfile:write(s[, size]) -> bytes_written

	Write the given number of uncompressed bytes into the compressed file.
	Return the number of uncompressed bytes actually written.

gzfile:eof() -> true|false

	Returns true if the end-of-file indicator has been set while reading,
	false otherwise. Note that the end-of-file indicator is set only if the read
	tried to go past the end of the input, but came up short. Therefore, `eof()`
	may return false even if there is no more data to read, in the event that the
	last read request was for the exact number of bytes remaining in the input
	file. This will happen if the input file size is an exact multiple of the
	buffer size.

gzfile:seek([whence][, offset])

	Set the starting position for the next `read()` or `write()`. The offset
	represents a number of bytes in the uncompressed data stream. `whence` can
	be "cur" or "set" ("end" is not supported).

	If the file is opened for reading, this function is emulated but can be
	extremely slow. If the file is opened for writing, only forward seeks are
	supported: `seek()` then compresses a sequence of zeroes up to the new
	starting position.

	If the file is opened for writing and the new starting position is before
	the current position, an error occurs.

	Returns the resulting offset location as measured in bytes from the beginning
	of the uncompressed stream.

gzfile:offset() -> n

	Return the current offset in the file being read or written. When reading,
	the offset does not include as yet unused buffered input. This information
	can be used for a progress indicator.

CRC32 & ADLER32 --------------------------------------------------------------

zlib.adler32(cdata, size[, adler]) -> n
zlib.adler32(s, [size][, adler]) -> n

	Start or update a running Adler-32 checksum of a string or cdata buffer and
	return the updated checksum.

	Adler-32 is almost as reliable as a CRC32 but can be computed much faster.

zlib.crc32(cdata, size[, crc]) -> n
zlib.crc32(s, [size][, crc]) -> n

	Start or update a running CRC-32B of a string or cdata buffer and return
	the updated CRC-32. Pre- and post-conditioning (one's complement) is performed
	within this function so it shouldn't be done by the application.

]]

local ffi = require'ffi'
require'zlib_h'
local C = ffi.load'z'

local function version()
	return ffi.string(C.zlibVersion())
end

local function checkz(ret)
	if ret == 0 then return end
	error(ffi.string(C.zError(ret)))
end

local function flate(api)
	return function(...)
		local ret = api(...)
		if ret == 0 then return true end
		if ret == C.Z_STREAM_END then return false end
		checkz(ret)
	end
end

local deflate = flate(C.deflate)
local inflate = flate(C.inflate)

--FUN TIME: windowBits is range 8..15 (default = 15) but can also be -8..15
--for raw deflate with no zlib header or trailer and can also be greater than
--15 which reads/writes a gzip header and trailer instead of a zlib wrapper.
--so I added a format parameter which can be 'deflate', 'zlib', 'gzip'
--(default = 'zlib') to cover all the cases so that windowBits can express
--only the window bits in the initial 8..15 range. additionally for inflate,
--windowBits can be 0 which means use the value in the zlib header of the
--compressed stream.

local function format_windowBits(format, windowBits)
	if format == 'gzip' then windowBits = windowBits + 16 end
	if format == 'deflate' then windowBits = -windowBits end
	return windowBits
end

local function init_deflate(format, level, method, windowBits, memLevel, strategy)
	level = level or C.Z_DEFAULT_COMPRESSION
	method = method or C.Z_DEFLATED
	windowBits = format_windowBits(format, windowBits or C.Z_MAX_WBITS)
	memLevel = memLevel or 8
	strategy = strategy or C.Z_DEFAULT_STRATEGY

	local strm = ffi.new'z_stream'
	checkz(C.deflateInit2_(strm, level, method, windowBits, memLevel, strategy, version(), ffi.sizeof(strm)))
	ffi.gc(strm, C.deflateEnd)
	return strm, deflate, C.deflateEnd
end

local function init_inflate(format, windowBits)
	windowBits = format_windowBits(format, windowBits or C.Z_MAX_WBITS)

	local strm = ffi.new'z_stream'
	checkz(C.inflateInit2_(strm, windowBits, version(), ffi.sizeof(strm)))
	ffi.gc(strm, C.inflateEnd)
	return strm, inflate, C.inflateEnd
end

local function inflate_deflate(init)
	return function(read, write, bufsize, ...)
		bufsize = bufsize or 64 * 1024

		local strm, flate, flate_end = init(...)

		local buf = ffi.new('uint8_t[?]', bufsize)
		strm.next_out, strm.avail_out = buf, bufsize
		strm.next_in, strm.avail_in = nil, 0

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

		local function flush()
			local sz = bufsize - strm.avail_out
			if sz == 0 then return end
			write(buf, sz)
			strm.next_out, strm.avail_out = buf, bufsize
		end

		local ok, err = pcall(function()
			local data, size --data must be anchored as an upvalue!
			while true do
				if strm.avail_in == 0 then --input buffer empty: refill
					::again::
					data, size = read()
					if not data then --eof: finish up
						local ret
						repeat
							flush()
						until not flate(strm, C.Z_FINISH)
						flush()
						break
					end
					size = size or #data
					if size == 0 then --avoid buffer error
						goto again
					end
					strm.next_in, strm.avail_in = data, size
				end
				flush()
				if not flate(strm, C.Z_NO_FLUSH) then
					flush()
					break
				end
			end
		end)
		flate_end(ffi.gc(strm, nil))
		if not ok then
			return nil, err
		end

		if asstring then
			return table.concat(t)
		else
			return t or true
		end
	end
end

--inflate(read, write[, bufsize][, format][, windowBits])
local inflate = inflate_deflate(init_inflate)
--deflate(read, write[, bufsize][, format][, level][, windowBits][, memLevel][, strategy])
local deflate = inflate_deflate(init_deflate)

--gzip file access functions

local function checkz(ret) assert(ret == 0) end
local function checkminus1(ret) assert(ret ~= -1); return ret end
local function ptr(o) return o ~= nil and o or nil end

local function gzclose(gzfile)
	checkz(C.gzclose(gzfile))
	ffi.gc(gzfile, nil)
end

local function gzopen(filename, mode, bufsize)
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

--checksum functions

local function adler32(data, sz, adler)
	adler = adler or C.adler32(0, nil, 0)
	return tonumber(C.adler32(adler, data, sz or #data))
end

local function crc32(data, sz, crc)
	crc = crc or C.crc32(0, nil, 0)
	return tonumber(C.crc32(crc, data, sz or #data))
end

return {
	C = C,
	version = version,
	inflate = inflate,
	deflate = deflate,
	open = gzopen,
	adler32 = adler32,
	crc32 = crc32,
}
