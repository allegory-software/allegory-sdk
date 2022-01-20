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

local function string_xor(s1, s2)
	assert(#s1 == #s2, 'strings must be of equal length')
	local buf = ffi.new('uint8_t[?]', #s1)
	for i=1,#s1 do
		buf[i-1] = bit.bxor(s1:byte(i,i), s2:byte(i,i))
	end
	return ffi.string(buf, #s1)
end

--any hash function works, md5, sha256, etc.
--blocksize is that of the underlying hash function (64 for MD5 and SHA-256, 128 for SHA-384 and SHA-512)
local function compute(key, message, hash, blocksize, opad, ipad)
   if #key > blocksize then
		key = hash(key) --keys longer than blocksize are shortened
   end
   key = key .. string.rep('\0', blocksize - #key) --keys shorter than blocksize are zero-padded
   opad = opad or string_xor(key, string.rep(string.char(0x5c), blocksize))
   ipad = ipad or string_xor(key, string.rep(string.char(0x36), blocksize))
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
	md5    = function() hmac.md5    = require'md5'.hmac end,
	sha1   = function() hmac.sha1   = require'sha1'.hmac end,
	sha256 = function() hmac.sha256 = require'sha2'.sha256_hmac end,
	sha384 = function() hmac.sha384 = require'sha2'.sha384_hmac end,
	sha512 = function() hmac.sha512 = require'sha2'.sha512_hmac end,
})

--[[

--TODO: check if this implementation from sha1.lua is faster.

-- Precalculate replacement tables.
local xor_with_0x5c = {}
local xor_with_0x36 = {}

for i = 0, 0xff do
   xor_with_0x5c[schar(i)] = schar(byte_xor(0x5c, i))
   xor_with_0x36[schar(i)] = schar(byte_xor(0x36, i))
end

-- 512 bits.
local BLOCK_SIZE = 64

function sha1.hmac(key, text)
   if #key > BLOCK_SIZE then
      key = sha1.binary(key)
   end

   local key_xord_with_0x36 = key:gsub('.', xor_with_0x36) .. srep(schar(0x36), BLOCK_SIZE - #key)
   local key_xord_with_0x5c = key:gsub('.', xor_with_0x5c) .. srep(schar(0x5c), BLOCK_SIZE - #key)

   return sha1.sha1(key_xord_with_0x5c .. sha1.binary(key_xord_with_0x36 .. text))
end

function sha1.hmac_binary(key, text)
   return hex_to_binary(sha1.hmac(key, text))
end
]]
