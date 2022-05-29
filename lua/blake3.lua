--[=[

	BLAKE3 fast cryptographic hash.
	Writen by Cosmin Apreutesei. Public Domain.

	blake3_state([key[, sz]]) -> b3               get a hash state
	blake3_derive_key(context[, sz]) -> b3        get a hash state in key derivation mode
	blake3(s, [sz], [key], [out[, outsz]]) -> s   hash a string
	b3:update(s[, sz]) -> b3                      digest a string or buffer
	b3:finalize([buf[, sz]]) -> s                 finalize and get the hash
	b3:finalize_tobuffer([buf[, sz]]) -> buf, sz  finalize and get the hash into a buffer
	b3:length() -> n                              get the hash byte length
	b3:reset() -> b3                              prepare for another digestion

]=]

if not ... then require'blake3_test'; return end

local ffi = require'ffi'
local C = ffi.load'blake3'

ffi.cdef[[
enum {
	BLAKE3_KEY_LEN   = 32,
	BLAKE3_OUT_LEN   = 32,
	BLAKE3_BLOCK_LEN = 64,
	BLAKE3_CHUNK_LEN = 1024,
	BLAKE3_MAX_DEPTH = 54
};

typedef struct {
	uint32_t cv[8];
	uint64_t chunk_counter;
	uint8_t buf[BLAKE3_BLOCK_LEN];
	uint8_t buf_len;
	uint8_t blocks_compressed;
	uint8_t flags;
} blake3_chunk_state;

typedef struct {
	uint32_t key[8];
	blake3_chunk_state chunk;
	uint8_t cv_stack_len;
	uint8_t cv_stack[(BLAKE3_MAX_DEPTH + 1) * BLAKE3_OUT_LEN];
} blake3_hasher;

void blake3_hasher_init                (blake3_hasher *self);
void blake3_hasher_init_keyed          (blake3_hasher *self, const uint8_t key[BLAKE3_KEY_LEN]);
void blake3_hasher_init_derive_key_raw (blake3_hasher *self, const void *context, size_t context_len);
void blake3_hasher_update              (blake3_hasher *self, const void *input, size_t input_len);
void blake3_hasher_finalize            (const blake3_hasher *self, uint8_t *out, size_t out_len);
void blake3_hasher_finalize_seek       (const blake3_hasher *self, uint64_t seek, uint8_t *out, size_t out_len);
void blake3_hasher_reset               (blake3_hasher *self);
]]

local blake3_hasher = ffi.typeof'blake3_hasher'
local blake3_outbuf = ffi.typeof'uint8_t[BLAKE3_OUT_LEN]'

local b3 = {}

local kbuf = ffi.new'uint8_t[BLAKE3_KEY_LEN]'
function blake3_state(key, sz)
	local self = blake3_hasher()
	if key then
		ffi.fill(kbuf, C.BLAKE3_KEY_LEN)
		ffi.copy(kbuf, key, math.min(C.BLAKE3_KEY_LEN, sz or #key))
		C.blake3_hasher_init_keyed(self, kbuf)
	else
		C.blake3_hasher_init(self)
	end
	return self
end

function blake3_derive_key(cx, sz)
	local self = blake3_hasher()
	C.blake3_hasher_init_derive_key_raw(self, cx, sz or #cx)
	return self
end

function b3:reset()
	C.blake3_hasher_reset(self)
	return self
end

function b3:update(s, sz)
	C.blake3_hasher_update(self, s, sz or #s)
	return self
end

function b3:length()
	return C.BLAKE3_OUT_LEN
end

function b3:finalize_tobuffer(out, sz)
	if not out then
		out, sz = blake3_outbuf(), C.BLAKE3_OUT_LEN
	end
	C.blake3_hasher_finalize(self, out, sz)
	return out, sz
end

function b3:finalize(out, sz)
	return ffi.string(self:finalize_tobuffer(out, sz))
end

ffi.metatype(blake3_hasher, {__index = b3})

function blake3(s, sz, key, out, outsz)
	return blake3_state(key):update(s, sz):finalize(out, outsz)
end
