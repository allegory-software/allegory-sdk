
require'glue'
require'blake3'
require'json'
require'fs'

local tests = json_decode(assert(load'blake3_test/test_vectors.json'))

local b1 = blake3_state()
local b2 = blake3_state(tests.key)
local b3 = blake3_derive_key(tests.context_string)

assert(#tests.cases == 35)
for i,t in ipairs(tests.cases) do
	local s = ffi.new('uint8_t[?]', t.input_len)
	for i = 0, t.input_len-1 do
		s[i] = i % 251
	end
	local h1 = b1:update(s, t.input_len):finalize()
	local h2 = b2:update(s, t.input_len):finalize()
	local h3 = b3:update(s, t.input_len):finalize()
	assert(tohex(h1) == t.hash:sub(1, 64))
	assert(tohex(h2) == t.keyed_hash:sub(1, 64))
	assert(tohex(h3) == t.derive_key:sub(1, 64))
	b1:reset()
	b2:reset()
	b3:reset()
end
print'ok'
