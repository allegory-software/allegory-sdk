--[=[

	HMAC authentication (RFC 2104)
	Written by Cosmin Apreutesei. Public Domain.

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
hmac_sha256 = mk('sha2', 'sha256',  64)
hmac_sha384 = mk('sha2', 'sha384', 128)
hmac_sha512 = mk('sha2', 'sha512', 128)


if not ... then --self-test (RFC 4231 test case 2)

	local key  = 'Jefe'
	local data = 'what do ya want for nothing?'

	assert(tohex((hmac_sha256(data, key))) == '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
	assert(tohex((hmac_sha384(data, key))) == 'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649')
	assert(tohex((hmac_sha512(data, key))) == '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737')

	print'hmac ok'

end
