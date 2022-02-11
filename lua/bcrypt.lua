--[[

	bcrypt binding.
	Written by Cosmin Apreutesei. Public Domain.

	bcrypt.crypt(password, secret, [rounds]) -> hash

]]

local ffi = require'ffi'
local C = ffi.load'bcrypt1'

ffi.cdef[[
char *crypt(const char *key, const char *setting);
char *crypt_gensalt(const char *prefix, unsigned long count,
	const char *input, int size);
]]

local bcrypt = {}

function bcrypt.crypt(key, secret, rounds)
	local salt = C.crypt_gensalt('$2a$', rounds or 12, secret, #secret)
	assert(salt ~= nil, 'secret too short')
	return ffi.string(C.crypt('abcd', salt))
end

if not ... then
	assert(bcrypt.crypt('dude', '0123456789012345') ==
		'$2a$12$KBCwKxOzLha2MR.vKhKyLOPn6ktd5Jn14htId0DRB7/3RZF7.VbHu')
end

return bcrypt
