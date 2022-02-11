--[[

	bcrypt binding.
	Written by Cosmin Apreutesei. Public Domain.

	bcrypt.crypt(password, [rounds]) -> hash
	bcrypt.verify(password, hash) -> true|false

]]

local ffi = require'ffi'
local C = ffi.load'bcrypt1'
local glue = require'glue'

ffi.cdef[[
char *crypt(const char *key, const char *setting);
char *crypt_gensalt(const char *prefix, unsigned long count,
	const char *input, int size);
]]

local bcrypt = {}

function bcrypt.crypt(key, rounds)
	local secret = glue.random_string(16)
	local salt = C.crypt_gensalt('$2a$', rounds or 10, secret, #secret)
	assert(salt ~= nil, 'secret too short')
	return ffi.string(C.crypt(key, salt))
end

function bcrypt.verify(key, hash)
	return ffi.string(C.crypt(key, hash)) == hash
end

if not ... then
	math.randomseed(require'time'.clock())
	local hash = bcrypt.crypt('dude')
	assert(bcrypt.verify('dude', hash))
end

return bcrypt
