--[=[

	HMAC authentication (RFC 2104)
	Written by Cosmin Apreutesei. Public Domain.

	hmac_md5    (message, key) -> HMAC-MD5
	hmac_sha1   (message, key) -> HMAC-SHA256
	hmac_sha256 (message, key) -> HMAC-SHA256
	hmac_sha384 (message, key) -> HMAC-SHA384
	hmac_sha512 (message, key) -> HMAC-SHA512

]=]

require'glue'

local
	cast, u8a, xor, str, rep =
	cast, u8a, xor, str, rep

local function str_xor(s, c, n)
	assert(#s == n)
	local p = cast(u8p, s)
	local b = u8a(n)
	for i = 0, n-1 do
		b[i] = xor(p[i], c)
	end
	return str(b, n)
end

function hmac(key, message, hash, blocksize, opad, ipad)
   if #key > blocksize then
		key = hash(key) --keys longer than blocksize are shortened
   end
   key = key .. rep('\0', blocksize - #key)
	--^^keys shorter than blocksize are zero-padded.
	opad = opad or str_xor(key, 0x5c, blocksize)
   ipad = ipad or str_xor(key, 0x36, blocksize)
	--^^opad and ipad can be cached for the same key.
	return hash(opad .. hash(ipad .. message)), opad, ipad
end

local function mk(module_name, hash_name, blocksize)
	require(module_name)
	local hash = _G[hash_name]
	return function(message, key)
		return hmac(key, message, hash, blocksize)
	end
end
hmac_md5    = mk('md5' , 'md5'   ,  64)
hmac_sha1   = mk('sha1', 'sha1'  ,  64)
hmac_sha256 = mk('sha2', 'sha256',  64)
hmac_sha384 = mk('sha2', 'sha384', 128)
hmac_sha512 = mk('sha2', 'sha512', 128)
