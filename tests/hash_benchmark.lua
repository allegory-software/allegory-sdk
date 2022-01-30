--benchmark for the included hash functions.
local ffi = require'ffi'
local time = require'time'

if ... then return end --prevent loading as module

io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

local function benchmark(s, hash, iter)
	local sz = 1024^2 * 10
	local iter = iter or 100
	local key = ffi.new('uint8_t[?]', sz)
	for i=0,sz-1 do key[i] = i % 256 end
	local h = 0
	local t0 = time.clock()
	for i=1,iter do
		h = hash(key, sz, h)
	end
	local t1 = time.clock()
	print(string.format('%s  %8.2f MB/s (%s)', s,
		(sz * iter) / 1024^2 / (t1 - t0),
		type(h) == 'string' and (#h * 8)..' bits' or type(h)))
	collectgarbage()
end

local _b3 = require'blake3'.hash
local function b3(s, sz) return _b3(s, sz) end

local _sha1 = require'sha1'.sha1
local function sha1(s, sz)
	return _sha1(ffi.string(s, sz))
end

benchmark('BLAKE3         ', b3)
benchmark('md5 C          ', require'md5'.sum, 128)
benchmark('sha1 Lua       ', sha1, 8)
benchmark('crc32 C        ', require'zlib'.crc32, 256)
benchmark('xxHash32 C     ', require'xxhash'.hash32, 2048)
benchmark('xxHash64 C     ', require'xxhash'.hash64, 2048)
benchmark('adler32 C      ', require'zlib'.adler32, 1024)
benchmark('sha256 C       ', require'sha2'.sha256, 32)
benchmark('sha384 C       ', require'sha2'.sha384, 32)
benchmark('sha512 C       ', require'sha2'.sha512, 32)
