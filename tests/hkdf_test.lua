require'hkdf'
require'glue'

--RFC 5869 Test Case 1 (SHA-256, basic)
local ikm  = fromhex('0b'):rep(22)
local salt = fromhex'000102030405060708090a0b0c'
local info = fromhex'f0f1f2f3f4f5f6f7f8f9'
local prk  = fromhex'077709362c2e32df0ddc3f0dc47bba63'
            ..fromhex'90b6c73bb50f9c3122ec844ad7c2b3e5'
local okm  = fromhex'3cb25f25faacd57a90434f64d0362f2a'
            ..fromhex'2d2d0a90cf1a5a4c5db02d56ecc4c5bf'
            ..fromhex'34007208d5b887185865'
assert(hkdf_extract_sha256(salt, ikm) == prk, 'RFC5869 TC1 extract')
assert(hkdf_expand_sha256(prk, info, 42) == okm, 'RFC5869 TC1 expand')
assert(hkdf_sha256(ikm, salt, info, 42)  == okm, 'RFC5869 TC1 one-shot')

--RFC 5869 Test Case 2 (SHA-256, longer inputs/outputs)
local ikm  = fromhex'000102030405060708090a0b0c0d0e0f'
            ..fromhex'101112131415161718191a1b1c1d1e1f'
            ..fromhex'202122232425262728292a2b2c2d2e2f'
            ..fromhex'303132333435363738393a3b3c3d3e3f'
            ..fromhex'404142434445464748494a4b4c4d4e4f'
local salt = fromhex'606162636465666768696a6b6c6d6e6f'
            ..fromhex'707172737475767778797a7b7c7d7e7f'
            ..fromhex'808182838485868788898a8b8c8d8e8f'
            ..fromhex'909192939495969798999a9b9c9d9e9f'
            ..fromhex'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf'
local info = fromhex'b0b1b2b3b4b5b6b7b8b9babbbcbdbebf'
            ..fromhex'c0c1c2c3c4c5c6c7c8c9cacbcccdcecf'
            ..fromhex'd0d1d2d3d4d5d6d7d8d9dadbdcdddedf'
            ..fromhex'e0e1e2e3e4e5e6e7e8e9eaebecedeeef'
            ..fromhex'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff'
local prk  = fromhex'06a6b88c5853361a06104c9ceb35b45c'
            ..fromhex'ef760014904671014a193f40c15fc244'
local okm  = fromhex'b11e398dc80327a1c8e7f78c596a4934'
            ..fromhex'4f012eda2d4efad8a050cc4c19afa97c'
            ..fromhex'59045a99cac7827271cb41c65e590e09'
            ..fromhex'da3275600c2f09b8367793a9aca3db71'
            ..fromhex'cc30c58179ec3e87c14c01d5c1f3434f'
            ..fromhex'1d87'
assert(hkdf_extract_sha256(salt, ikm) == prk, 'RFC5869 TC2 extract')
assert(hkdf_expand_sha256(prk, info, 82) == okm, 'RFC5869 TC2 expand')
assert(hkdf_sha256(ikm, salt, info, 82)  == okm, 'RFC5869 TC2 one-shot')

--RFC 5869 Test Case 3 (SHA-256, empty salt and info)
local ikm  = fromhex'0b':rep(22)
local prk  = fromhex'19ef24a32c717b167f33a91d6f648bdf'
            ..fromhex'96596776afdb6377ac434c1c293ccb04'
local okm  = fromhex'8da4e775a563c18f715f802a063c5a31'
            ..fromhex'b8a11f5c5ee1879ec3454e5f3c738d2d'
            ..fromhex'9d201395faa4b61a96c8'
assert(hkdf_extract_sha256(''      , ikm) == prk, 'RFC5869 TC3 extract (empty salt)')
assert(hkdf_extract_sha256(nil     , ikm) == prk, 'RFC5869 TC3 extract (nil salt)')
assert(hkdf_expand_sha256(prk, ''   , 42) == okm, 'RFC5869 TC3 expand (empty info)')
assert(hkdf_expand_sha256(prk, nil  , 42) == okm, 'RFC5869 TC3 expand (nil info)')
assert(hkdf_sha256(ikm, nil, nil, 42)     == okm, 'RFC5869 TC3 one-shot')

--domain separation: different info → different output
local k1 = hkdf_sha256('master', 'salt', 'cookie-encrypt', 32)
local k2 = hkdf_sha256('master', 'salt', 'jwt-sign',       32)
assert(k1 ~= k2 and #k1 == 32 and #k2 == 32, 'info should domain-separate')

--length limit
local ok, err = pcall(hkdf_expand_sha256, ('\0'):rep(32), '', 255*32+1)
assert(not ok and err:find'too long', 'should reject oversized output')

--sha384/sha512 smoke (no RFC vectors, just non-empty / right-length)
assert(#hkdf_sha384('ikm', 'salt', 'info', 48) == 48)
assert(#hkdf_sha512('ikm', 'salt', 'info', 64) == 64)
assert(hkdf_sha384('a','b','c',16) ~= hkdf_sha512('a','b','c',16))

print'hkdf ok'
