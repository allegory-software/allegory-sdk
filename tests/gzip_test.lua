require'gzip'
require'glue'
require'unit'

local function gen(n)
	local t = {}
	for i=1,n do
		t[i] = string.format('dude %g\r\n', math.random())
	end
	return table.concat(t)
end

local function writer()
	local t = {}
	return function(data, sz)
		if not data then return table.concat(t) end
		t[#t+1] = ffi.string(data, sz)
	end
end

--gzip_state compress + decompress roundtrip
for _,size in ipairs{0, 1, 13, 2049, 100000} do
	local src = gen(size)
	local cwrite = writer()
	local gz = gzip_state{op = 'compress', write = cwrite}
	gz:push(src)
	gz:finish()
	local compressed = cwrite()
	local dwrite = writer()
	local gz = gzip_state{op = 'decompress', write = dwrite}
	local status = gz:push(compressed)
	assert(status == 'eof')
	local src2 = dwrite()
	assert(src == src2)
	print(string.format('gzip_state: size: %5dK ratio: %d%%',
		#src/1024, #compressed / math.max(#src, 1) * 100))
end

--gzip/gunzip wrappers
for _,size in ipairs{0, 1, 13, 2049, 100000} do
	local src = gen(size)
	local compressed = gzip(src):get()
	local dst = gunzip(compressed):get()
	assert(src == dst)
	print(string.format('gzip/gunzip: size: %5dK ratio: %d%%',
		#src/1024, #compressed / math.max(#src, 1) * 100))
end

--decompress truncated stream errors on eof
do
	local src = gen(100)
	local compressed = gzip(src):get()
	local truncated = compressed:sub(1, math.floor(#compressed / 2))
	local gz = gzip_state{op = 'decompress'}
	local ok, err = gz:try_push(truncated, nil, true)
	test(ok, nil)
	test(err, 'buffer error')
	print('truncated stream detected: ok')
end

--decompress stream with trailing data after end marker
do
	local src = gen(100)
	local compressed = gzip(src):get()
	local padded = compressed .. 'trailing garbage data'
	local gz = gzip_state{op = 'decompress'}
	local status = gz:push(padded)
	test(status, 'eof')
	local dst = gz.b:get()
	test(dst, src)
	print('trailing bytes ignored: ok')
end

test(tohex(adler32'The game done changed.'), '587507ba')
test(tohex(crc32'Game\'s the same, just got more fierce.'), '2c40120a')

print'gzip ok'
