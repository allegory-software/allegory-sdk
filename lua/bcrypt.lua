--[[

	bcrypt binding.
	Written by Cosmin Apreutesei. Public Domain.

	bcrypt_hash(password, [rounds]) -> hash
	bcrypt_verify(password, hash) -> true|false

]]

require'glue'
local C = ffi.load'bcrypt1'

cdef[[
char *crypt(const char *key, const char *setting);
char *crypt_gensalt(const char *prefix, unsigned long count,
	const char *input, int size);
]]

function bcrypt_hash(key, rounds)
	local secret = random_string(16)
	local salt = C.crypt_gensalt('$2a$', rounds or 10, secret, #secret)
	assert(salt ~= nil, 'secret too short')
	return ffi.string(C.crypt(key, salt))
end

function bcrypt_verify(key, hash)
	return ffi.string(C.crypt(key, hash)) == hash
end

if not ... then
	math.randomseed(require'time'.clock())
	local hash = bcrypt_hash('dude')
	print(#hash, hash) --60 bytes
	assert(bcrypt_verify('dude', hash))
end
