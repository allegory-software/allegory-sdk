--benchmark for the included hash functions.
require'glue'

if ... then return end --prevent loading as module

io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

local function benchmark(s, hash, iter)
	local sz = 1024^2 * 10
	local iter = iter or 100
	local key = u8a(sz)
	for i=0,sz-1 do key[i] = i % 256 end
	local h = 0
	local t0 = clock()
	for i=1,iter do
		h = hash(key, sz, h)
	end
	local t1 = clock()
	print(format('%s  %8.2f MB/s (%s)', s,
		(sz * iter) / 1024^2 / (t1 - t0),
		type(h) == 'string' and (#h * 8)..' bits' or type(h)))
	collectgarbage()
end

require'blake3'
require'md5'
require'gzip'
require'xxhash'
require'sha1'
require'sha2'

benchmark('BLAKE3         ', function(s, sz) return blake3(s, sz) end)
benchmark('sha1 Lua       ', function(s, sz) return sha1(str(s, sz)) end, 4)
benchmark('md5 C          ', md5, 128)
benchmark('crc32 C        ', crc32, 256)
benchmark('xxHash32 C     ', xxhash32, 2048)
benchmark('xxHash64 C     ', xxhash64, 2048)
benchmark('adler32 C      ', adler32, 1024)
benchmark('sha256 C       ', sha256, 32)
benchmark('sha384 C       ', sha384, 32)
benchmark('sha512 C       ', sha512, 32)
