--[=[

	HMAC authentication (RFC 2104)
	Written by Cosmin Apreutesei. Public Domain.

hmac.compute(key, message, hash_function, blocksize[, opad][, ipad]) -> hash, opad, ipad

	Compute a hmac hash based on a hash function. Any function that takes a string
	as single argument works, like `md5.sum`. `blocksize` is that of the underlying
	hash function, i.e. 64 for MD5 and SHA-256, 128 for SHA-384 and SHA-512.

hmac.new(hash_function, block_size) -> hmac_function

	Returns a HMAC function of form `hmac_function(message, key) -> hash` that
	can be used with a specific hash function.

hmac.md5   (message, key) -> HMAC-MD5 hash         Compute HMAC-MD5
hmac.sha1  (message, key) -> HMAC-SHA256 hash      Compute HMAC-SHA1
hmac.sha256(message, key) -> HMAC-SHA256 hash      Compute HMAC-SHA256
hmac.sha384(message, key) -> HMAC-SHA384 hash      Compute HMAC-SHA384
hmac.sha512(message, key) -> HMAC-SHA512 hash      Compute HMAC-SHA512

]=]

local ffi = require'ffi'
local bit = require'bit'

local u8p = ffi.typeof'uint8_t*'
local u8a = ffi.typeof'uint8_t[?]'
local xor = bit.bxor
local function str_xor(s, c, n)
	assert(#s == n)
	local p = ffi.cast(u8p, s)
	local b = u8a(n)
	for i = 0, n-1 do
		b[i] = xor(p[i], c)
	end
	return ffi.string(b, n)
end

--any hash function works, md5, sha256, etc.
--blocksize is that of the underlying hash function (64 for MD5 and SHA-256, 128 for SHA-384 and SHA-512)
local function compute(key, message, hash, blocksize, opad, ipad)
   if #key > blocksize then
		key = hash(key) --keys longer than blocksize are shortened
   end
   key = key .. string.rep('\0', blocksize - #key) --keys shorter than blocksize are zero-padded
	opad = opad or str_xor(key, 0x5c, blocksize)
   ipad = ipad or str_xor(key, 0x36, blocksize)
	return hash(opad .. hash(ipad .. message)), opad, ipad --opad and ipad can be cached for the same key
end

local function new(hash, blocksize)
	return function(message, key)
		return (compute(key, message, hash, blocksize))
	end
end

local glue = require'glue'

local hmac = {
	new = new,
	compute = compute,
}

return glue.autoload(hmac, {
	md5    = function() hmac.md5    = hmac.new(require'md5' .sum   ,  64) end,
	sha1   = function() hmac.sha1   = hmac.new(require'sha1'.sha1  ,  64) end,
	sha256 = function() hmac.sha256 = hmac.new(require'sha2'.sha256,  64) end,
	sha384 = function() hmac.sha384 = hmac.new(require'sha2'.sha384, 128) end,
	sha512 = function() hmac.sha512 = hmac.new(require'sha2'.sha512, 128) end,
})
