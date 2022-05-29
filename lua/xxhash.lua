--[=[

	XXHASH: extremely fast non-cryptographic hash.
	Written by Cosmin Apreutesei. Public Domain.

	xxhash32|64|128(data[, len[, seed]]) -> hash

		Compute a 32|64|128 bit hash.

	xxhash128_digest([seed]) -> st
	st:reset()
	st:update(s | buf,sz)
	st:hash() -> hash
	st:free()

]=]

local ffi = require'ffi'
local bit = require'bit'
require'xxhash_h'
local C = ffi.load'xxhash'

function xxhash32 (data, sz, seed) return C.XXH32 (data, sz or #data, seed or 0) end
function xxhash64 (data, sz, seed) return C.XXH64 (data, sz or #data, seed or 0) end
function xxhash128(data, sz, seed) return C.XXH128(data, sz or #data, seed or 0) end

local h = {}

function h:bin()
	return ffi.string(self, 16)
end

function h:hex()
	local h = bit.tohex
	return
		h(self.u32[0])..
		h(self.u32[1])..
		h(self.u32[2])..
		h(self.u32[3])
end

ffi.metatype('XXH128_hash_t', {__index = h})

local st = {}
local st_meta = {__index = st}

function st:free()
	assert(C.XXH3_freeState(self) == 0)
end
st_meta.__gc = st.free

function st:reset(seed)
	assert(C.XXH3_128bits_reset_withSeed(self, seed or 0) == 0)
	return self
end

function st:update(s, len)
	assert(C.XXH3_128bits_update(self, s, len or #s) == 0)
	return self
end

function st:hash()
	return C.XXH3_128bits_digest(self)
end

function xxhash128_digest(seed)
	local st = C.XXH3_createState()
	assert(st ~= nil)
	return st:reset(seed)
end

ffi.metatype('XXH3_state_t', st_meta)

if not ... then --self-test
	local st = xxhash128_digest()
	st:update('abcd')
	st:update('1324')
	assert(st:hash():bin() == xxhash128('abcd1324'):bin())
	assert(st:hash():hex() == xxhash128('abcd1324'):hex())
	print'ok'
end
