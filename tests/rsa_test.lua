require'bearssl_crypto'
require'glue'

--vectors generated with:
--  openssl genrsa -out rsa.pem 2048
--  openssl dgst -sha{256|384|512} -sign rsa.pem -out sig.bin msg.txt
--  where msg.txt is the bytes 'hello, world' (no trailing newline)

local msg = 'hello, world'
local e   = fromhex'010001'
local n   = fromhex(
	'b2088e2c49054ef73578d4b093d515355de4576372e06c988ca4859cd0cc3b34'..
	'01363f6ab54f7dcef33dc4baa2fd19331f0c21f61413eb4c82df4076702782bd'..
	'bbb0ddd1c738d9d78b9842b27d6c499b2ecfadad1a475d97305caa61081d9e5f'..
	'5081d4a6681c339bf4eae833967096c0859309cba28b15a0d9015fa7f9e20fcb'..
	'8f726fc1b4bfa1558c41f6db6d632c0cb04bb5823a9a1f881896a89a9110e72b'..
	'c8bce0a352fd6916b3be1203fa1b739535bfca6cefc707aa88f86d56b8172a30'..
	'b490d9c14137f50ebbde1e73d8359e10e1d3b471271bc2b2934457aa4f203c14'..
	'd85bd559650b0ba9f58001861f8a261acf5c5a2f842db023a5c904ba1343212b')

local sig256 = fromhex(
	'8f6cd15d7133b177eab146fa05ee4cd84bf0ca8d3b1781fb9ebf3abda0bfb228'..
	'7fb7c0e119331c2dfb3f41383f8af3ee922ab595401f6655445f1ac4032e60ad'..
	'5114ef683cc4708d0ad3d5ef6335743ee1b900baa8702cc7a250ec3a934e9b78'..
	'66b6120f761bb4f4477b308e38a02a34543465dd47ba076ee03b31a573cc486c'..
	'2a60c032418339bde088dbb19ec5df0f33fe5cc7ed7e42fcb25aa886ffde0d7b'..
	'1a59fcf310cfdc1dc4efb86db07ed918982164c923d2ddb27b569e15e50d596b'..
	'dd96e749a658986b15dc8371721921e357878a9fa33162cd83e877733373c4b0'..
	'ff5afdedf305166061a2493f95057f345bca0bf1bfdd25fb1a2bf60cedaabee5')

local sig384 = fromhex(
	'02c046d676b11a00d9679caa73856d938720545695bafc2645fd0867ea49c5fa'..
	'1a2178329298fe77322986fd4737f9fb08ceaff38fc4a6f22f9ea4c07d58402c'..
	'648e8803a24018d52685d9b79f5afba5a36e1ef18d2a852dcc04f2599c8e4d32'..
	'531ebcb4113abfd3a2b0d303c94b32b6fd83bb0416ffca0895cf8aae364b206b'..
	'06810cfcbf147be820b7be71d330c75bcfec227c3d2f5c45870dc431c25a06d5'..
	'5f6556ce268243cd28754a42817eacea99413b2ee158c19d59865651264ff741'..
	'f6f82ee43aac2fe40a816fea4e320473fc057afb1224eb272a79c5dfd0cab2a2'..
	'7e2d7aff0755a9abcc55742b0a9ba3e2136451ff75c7fb0332339ad8170b5ba2')

local sig512 = fromhex(
	'5b57c475ce655c8dbd3dac1db5734511f00de40ea025f2f26c581fb031d2bb9f'..
	'226861343a6534aea0bc95bc244d2622260cfaf4dc0e2435066dfd54e61214a3'..
	'7a8e34a33f53f53023acfff9e0fa27fc3da638312df22c23bdf87392697d3220'..
	'dab6fd6119d367f041a7f7db4d723df35fd394de3f398452ae4f912066f223c4'..
	'c8a135e5874ceb8b97ef54ae68217d0248cd274f3f01009dfc746b83d8d049a1'..
	'f9d96650bfbecf4ac9fc91d72c853814d099d45e95a167066a3d41d880bcf26a'..
	'38832e0486b4252f6418470256f719130ef722dd678a2451cc90c5dba332cc0d'..
	'73492a0c75ac68f59489b1caa54ca0e14a294d19c665919c53f2a8d7c19da43e')

local pk = rsa_public_key(n, e)

assert(rsa_sha256_verify(msg, sig256, pk) == true , 'sha256 should verify')
assert(rsa_sha384_verify(msg, sig384, pk) == true , 'sha384 should verify')
assert(rsa_sha512_verify(msg, sig512, pk) == true , 'sha512 should verify')

assert(rsa_sha256_verify(msg..'!', sig256, pk) == false, 'tampered msg should fail')
assert(rsa_sha384_verify(msg..'!', sig384, pk) == false, 'tampered msg should fail')
assert(rsa_sha512_verify(msg..'!', sig512, pk) == false, 'tampered msg should fail')

--flip the last byte of the signature
local function flip_last(s)
	return s:sub(1, -2) .. string.char(bxor(s:byte(-1), 1))
end
assert(rsa_sha256_verify(msg, flip_last(sig256), pk) == false, 'tampered sig should fail')
assert(rsa_sha384_verify(msg, flip_last(sig384), pk) == false, 'tampered sig should fail')
assert(rsa_sha512_verify(msg, flip_last(sig512), pk) == false, 'tampered sig should fail')

--const_time_eq sanity
assert(const_time_eq('abc', 'abc'))
assert(not const_time_eq('abc', 'abd'))
assert(not const_time_eq('abc', 'abcd'))
assert(const_time_eq('', ''))

print'rsa ok'
