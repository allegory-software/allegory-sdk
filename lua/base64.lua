--[=[

	Base64 encoding & decoding.
	Written by Cosmin Apreutesei. Public Domain.

	Original code from:
		https://github.com/kengonakajima/luvit-base64/issues/1
		http://lua-users.org/wiki/BaseSixtyFour

base64[_encode|_decode][_tobuffer](s, [size], [outbuf], [outbuf_size], [max_line]) -> outbuf, len

	Encode/decode string or cdata buffer to a string or buffer.

base64url[_encode|_decode](s) -> s

	Encode/decode URL based on RFC4648 Section 5 / RFC7515 Section 2 (JSON Web Signature).

]=]

if not ... then require'base64_test'; return end

require'glue'

local
	shl, shr, bor, band, u8a, u8p, u16a, u16p, cast =
	shl, shr, bor, band, u8a, u8p, u16a, u16p, cast

local str = ffi.string --null,0 => empty string, unlike glue's str().

local EQ = byte'='

local s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local b64c = u8a(#s+1, s)

--encode ---------------------------------------------------------------------

local b64digits = u16a(4096)
for j=0,63,1 do
	for k=0,63,1 do
		b64digits[j*64+k] = bor(shl(b64c[k], 8), b64c[j])
	end
end

function base64_encode_tobuffer(s, sn, dbuf, dn, max_line)

	local sn = sn or #s
	local min_dn = math.ceil(sn / 3) * 4
	local newlines = max_line and math.ceil(min_dn / max_line) or 0
	min_dn = min_dn + newlines * 2 --CRLF per MIME
	local dn = dn or min_dn
	assert(dn >= min_dn, 'buffer too small')
	local dp  = dbuf and cast(u8p, dbuf) or u8a(min_dn)
	local sp  = cast(u8p, s)
	local dpw = cast(u16p, dp)
	local si = 0
	local di, li = 0, 0

	while sn > 2 do
		local n = sp[si]
		n = shl(n, 8)
		n = bor(n, sp[si+1])
		n = shl(n, 8)
		n = bor(n, sp[si+2])
		local c1 = shr(n, 12)
		local c2 = band(n, 0x00000fff)

		dpw[di] = b64digits[c1]
		di = di + 1
		li = li + 2
		if li == max_line then dpw[di] = 0x0a0d; di = di + 1; li = 0 end

		dpw[di] = b64digits[c2]
		di = di + 1
		li = li + 2
		if li == max_line then dpw[di] = 0x0a0d; di = di + 1; li = 0 end

		sn = sn - 3
		si = si + 3
	end

	di = di * 2

	if sn > 0 then
		local c1 = shr(band(sp[si], 0xfc), 2)
		local c2 = shl(band(sp[si], 0x03), 4)
		if sn > 1 then
			si = si + 1
			c2 = bor(c2, shr(band(sp[si], 0xf0), 4))
		end
		dp[di  ] = b64c[c1]
		dp[di+1] = b64c[c2]
		di = di + 2
		if sn == 2 then
			local c3 = shl(band(sp[si], 0xf), 2)
			si = si + 1
			c3 = bor(c3, shr(band(sp[si], 0xc0), 6))
			dp[di] = b64c[c3]
			di = di + 1
		end
		if sn == 1 then
			dp[di] = EQ
			di = di + 1
		end
		dp[di] = EQ
		di = di + 1
	end

	if max_line and di < min_dn then
		dp[di  ] = 0x0d
		dp[di+1] = 0x0a
		di = di + 2
	end
	assert(di == min_dn)

	return dp, min_dn
end

function base64_encode(...)
	return str(base64_encode_tobuffer(...))
end

--decode ---------------------------------------------------------------------

local b64i = u8a(256, 0xff)
for i = 0, sizeof(b64c)-1 do
	b64i[b64c[i]] = i
end
b64i[EQ] = 0

local block = u8a(4)

function base64_decode_tobuffer(s, sn, dbuf, dn)
	sn = sn or #s
   local sp = cast(u8p, s)

	local n = 0
	for i = 0, sn-1 do
		if b64i[sp[i]] ~= 0xff then
			n = n + 1
		end
	end
	if n == 0 or band(n, 3) ~= 0 then
		return nil, 0
	end

	local min_dn = n / 4 * 3
	local dn = dn or min_dn
	assert(dn >= min_dn, 'buffer too small')
	local dp  = dbuf and cast(u8p, dbuf) or u8a(min_dn)

	local j = 0
	local pad = 0
	local count = 0
	for i = 0, sn-1 do
		local b = b64i[sp[i]]
		if b == 0xff then
			goto skip
		end
		if sp[i] == EQ then
			pad = pad + 1
		end
		block[count] = b
		count = count + 1
		if count == 4 then
			dp[j+0] = bor(shl(block[0], 2), shr(block[1], 4))
			dp[j+1] = bor(shl(block[1], 4), shr(block[2], 2))
			dp[j+2] = bor(shl(block[2], 6),     block[3])
			j = j + 3
			count = 0
			if pad ~= 0 then
				if pad == 1 then
					j = j - 1
				elseif pad == 2 then
					j = j - 2
				else
					return nil, 'invalid padding'
				end
				break
			end
		end
		::skip::
	end
	return dp, j
end

function base64_decode(...)
	return str(base64_decode_tobuffer(...))
end

function base64url_encode(s)
	return base64_encode(s):gsub('/', '_'):gsub('+', '-'):gsub('=*$', '')
end

function base64url_decode(s)
	return base64_decode(s):gsub('_', '/'):gsub('-', '+'):gsub('=*$', '')
end
