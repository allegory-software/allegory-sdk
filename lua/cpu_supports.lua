local ffi = require'ffi'
local bit = require'bit'
local C = ffi.load'cpu_supports'
ffi.cdef'int cpu_supports();'

local flags = {
	sse   = 0x0001,
	sse2  = 0x0002,
	sse3  = 0x0010,
	ssse3 = 0x0020,
	sse41 = 0x0040,
	sse42 = 0x0080,
	avx   = 0x0100,
	avx2  = 0x0200,
}

return function(what)
	return bit.band(C.cpu_supports(), assert(flags[what])) ~= 0
end
