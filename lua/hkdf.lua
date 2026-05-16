--[=[

	HKDF (RFC 5869)
	Written by Cosmin Apreutesei. Public Domain.

	hkdf_sha{256|384|512}(ikm, salt, info, len) -> okm
	hkdf_extract_sha{256|384|512}(salt, ikm) -> prk
	hkdf_expand_sha{256|384|512}(prk, info, len) -> okm

	Derive one or more cryptographically strong keys from some input keying
	material (a master secret, DH shared secret, password hash, etc.).

		ikm   input keying material (the secret you have)
		salt  optional non-secret, ideally random; '' or nil means all-zeros
		info  domain separator / purpose label ('cookie-encrypt', 'jwt-sign', ...).
		      Different `info` with the same ikm/salt give independent keys.
		len   bytes of output requested (<= 255 * hash_len)

	The one-shot `hkdf_shaXXX` is what you want most of the time. Use
	`extract`+`expand` when you derive *many* keys from the same ikm/salt:
	run extract once to get prk, then call expand repeatedly with different
	`info` strings.

		local prk   = hkdf_extract_sha256(salt, master_secret)
		local k_enc = hkdf_expand_sha256(prk, 'cookie-encrypt', 32)
		local k_mac = hkdf_expand_sha256(prk, 'cookie-mac',     32)

]=]

if not ... then require'hkdf_test' return end

require'glue'
require'hmac'

local function mk(hash_name, hash_len)
	local hmac = _G['hmac_'..hash_name]
	local zero_salt = ('\0'):rep(hash_len)
	local function extract(salt, ikm)
		if not salt or salt == '' then salt = zero_salt end
		return hmac(ikm, salt)
	end
	local function expand(prk, info, len)
		assert(len <= 255 * hash_len, 'HKDF: output too long')
		info = info or ''
		local n = ceil(len / hash_len)
		local out = {}
		local t = ''
		for i = 1, n do
			t = hmac(t..info..char(i), prk)
			out[i] = t
		end
		return concat(out):sub(1, len)
	end
	local function one_shot(ikm, salt, info, len)
		return expand(extract(salt, ikm), info, len)
	end
	return one_shot, extract, expand
end

hkdf_sha256, hkdf_extract_sha256, hkdf_expand_sha256 = mk('sha256', 32)
hkdf_sha384, hkdf_extract_sha384, hkdf_expand_sha384 = mk('sha384', 48)
hkdf_sha512, hkdf_extract_sha512, hkdf_expand_sha512 = mk('sha512', 64)
