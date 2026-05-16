require'bearssl_crypto'
require'glue'

--vectors generated with:
--  openssl ecparam -genkey -name prime256v1 -noout -out ec.pem
--  openssl dgst -sha{256|384|512} -sign ec.pem -out sig.der msg.txt
--  where msg.txt is the bytes 'hello, world' (no trailing newline)
--openssl signs in DER (SEQUENCE { INTEGER r, INTEGER s }); JWS/JWT use raw r||s.
--converted by hand: strip the DER framing/sign-pad bytes from each INTEGER.

local msg = 'hello, world'

--uncompressed point: 04 || x(32) || y(32) = 65 bytes
local q = fromhex(
	'047f0c6a702391bc671cc2892c6dc267ac523154abeed7b916286292c2835b11'..
	'b2c3fdd8abd7942a76e58bba64555d237646df94baa4c1ff8deac4f89d7b48c6'..
	'a8')

local sig256 = fromhex(
	'e2c2b6094720271659e7e09df3c79312bee914cbc831b3a430382135b9cc87c6'..
	'ceda58ebb04b7ed03ad2ccf43a74f79518bdd532c6ceeadea7afc34fdce7a6d7')

local sig384 = fromhex(
	'3a17113a93d3e5ffc66a1d81986f738b11fb4eb30c49cc6ccf89400d3d06b6da'..
	'da24baf1b3c78e5c23a42d257365de6c30ca5b0c6e8c0a735bef4e6e99be149d')

local sig512 = fromhex(
	'bcce76746570fcb8f232be09211c389ad0e51ef25b64ff7f5c3316b0df8d99dd'..
	'63cb00d0235d8da933c1915afb3384602e996ed9626ffb528c00d845e88849d9')

local pk = ec_public_key('P-256', q)

assert(ecdsa_sha256_verify(msg, sig256, pk) == true , 'sha256 should verify')
assert(ecdsa_sha384_verify(msg, sig384, pk) == true , 'sha384 should verify')
assert(ecdsa_sha512_verify(msg, sig512, pk) == true , 'sha512 should verify')

assert(ecdsa_sha256_verify(msg..'!', sig256, pk) == false, 'tampered msg should fail')
assert(ecdsa_sha384_verify(msg..'!', sig384, pk) == false, 'tampered msg should fail')
assert(ecdsa_sha512_verify(msg..'!', sig512, pk) == false, 'tampered msg should fail')

local function flip_last(s)
	return s:sub(1, -2) .. string.char(bxor(s:byte(-1), 1))
end
assert(ecdsa_sha256_verify(msg, flip_last(sig256), pk) == false, 'tampered sig should fail')
assert(ecdsa_sha384_verify(msg, flip_last(sig384), pk) == false, 'tampered sig should fail')
assert(ecdsa_sha512_verify(msg, flip_last(sig512), pk) == false, 'tampered sig should fail')

--unknown curve must throw
local ok = pcall(ec_public_key, 'P-bogus', q)
assert(not ok, 'unknown curve should error')

print'ecdsa ok'
