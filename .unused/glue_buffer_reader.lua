--[[

buffer_reader(buf,len)->read   make a read function that consumes a buffer

]]

--return a read(buf, sz) -> readsz function that consumes data from the
--supplied buffer. The supplied buf,sz can also be nil,err in which case
--the read function will always return just that. The buffer must be a
--(u)int8_t pointer or VLA.
function buffer_reader(p, n)
	return function(buf, sz)
		if p == nil then return p, n end
		sz = min(n, sz)
		if sz == 0 then return nil, 'eof' end
		copy(buf, p, sz)
		p = p + sz
		n = n - sz
		return sz
	end
end

--test

do --buffer_reader: reads in chunks and signals eof
	local ffi = require'ffi'
	local src = ffi.new('uint8_t[5]')
	copy(src, 'abcde', 5)
	local read = buffer_reader(src, 5)
	local dst = ffi.new('uint8_t[3]')
	local n = read(dst, 3)
	assert(n == 3)
	assert(str(dst, 3) == 'abc')
	n = read(dst, 3) --only 2 bytes left
	assert(n == 2)
	assert(str(dst, 2) == 'de')
	local v, err = read(dst, 3) --eof
	assert(v == nil and err == 'eof')
end
do --buffer_reader: nil input passes through
	local read = buffer_reader(nil, 'some error')
	local ffi = require'ffi'
	local dst = ffi.new('uint8_t[4]')
	local v, err = read(dst, 4)
	assert(v == nil and err == 'some error')
end
