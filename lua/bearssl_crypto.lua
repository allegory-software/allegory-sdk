--[[

	BearSSL crypto API.
	Written by Cosmin Apreutesei. Public Domain.

SHA{1|256|384|512}
	sha{1|256|384|512}(s | p,sz) -> hash
	sha{1|256|384|512}_digest() -> d
	d:init() -> d
	d:update(s | p,sz)
	d:out() -> hash

RSA-PKCS1.5
	rsa_public_key(n, e) -> pk
	rsa_sha{1|256|384|512}_verify(msg, sig, pk) -> ok

ECDSA (signatures in raw r||s format, e.g. JWS/JWT)
	ec_public_key(curve, q) -> pk     curve: 'P-256' | 'P-384' | 'P-521'
	                                  q: '\x04' .. x .. y (uncompressed point)
	ecdsa_sha{256|384|512}_verify(msg, sig, pk) -> ok

UTIL
	const_time_eq(a, b) -> ok            constant-time string compare

]]

if not ... then
	require'sha1_test'
	require'sha2_test'
	require'rsa_test'
	require'ecdsa_test'
	return
end

require'glue'

local C = ffi.load'bearssl'

cdef[[

/* hash */
typedef struct br_hash_class_ br_hash_class;
typedef struct { const br_hash_class *vtable; unsigned char buf[64];  uint64_t count; uint32_t val[4]; } br_md5_context;
typedef struct { const br_hash_class *vtable; unsigned char buf[64];  uint64_t count; uint32_t val[5]; } br_sha1_context;
typedef struct { const br_hash_class *vtable; unsigned char buf[64];  uint64_t count; uint32_t val[8]; } br_sha224_context;
typedef struct { const br_hash_class *vtable; unsigned char buf[64];  uint64_t count; uint32_t val[8]; } br_sha256_context;
typedef struct { const br_hash_class *vtable; unsigned char buf[128]; uint64_t count; uint64_t val[8]; } br_sha384_context;
typedef struct { const br_hash_class *vtable; unsigned char buf[128]; uint64_t count; uint64_t val[8]; } br_sha512_context;
typedef struct { const br_hash_class *vtable; unsigned char buf[64];  uint64_t count; uint32_t val_md5[4]; uint32_t val_sha1[5]; } br_md5sha1_context;
typedef union {
	const br_hash_class *vtable;
	br_md5_context md5; br_sha1_context sha1;
	br_sha224_context sha224; br_sha256_context sha256;
	br_sha384_context sha384; br_sha512_context sha512;
	br_md5sha1_context md5sha1;
} br_hash_compat_context;
typedef struct {
	unsigned char buf[128]; uint64_t count;
	uint32_t val_32[25]; uint64_t val_64[16];
	const br_hash_class *impl[6];
} br_multihash_context;
typedef void (*br_ghash)(void *y, const void *h, const void *data, size_t len);

/* block */
typedef struct br_block_cbcenc_class_ br_block_cbcenc_class;
typedef struct br_block_cbcdec_class_ br_block_cbcdec_class;
typedef struct br_block_ctr_class_    br_block_ctr_class;
typedef struct br_block_ctrcbc_class_ br_block_ctrcbc_class;
typedef struct { const br_block_cbcenc_class *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_big_cbcenc_keys;
typedef struct { const br_block_cbcdec_class *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_big_cbcdec_keys;
typedef struct { const br_block_ctr_class    *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_big_ctr_keys;
typedef struct { const br_block_ctrcbc_class *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_big_ctrcbc_keys;
typedef struct { const br_block_cbcenc_class *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_small_cbcenc_keys;
typedef struct { const br_block_cbcdec_class *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_small_cbcdec_keys;
typedef struct { const br_block_ctr_class    *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_small_ctr_keys;
typedef struct { const br_block_ctrcbc_class *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_small_ctrcbc_keys;
typedef struct { const br_block_cbcenc_class *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_ct_cbcenc_keys;
typedef struct { const br_block_cbcdec_class *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_ct_cbcdec_keys;
typedef struct { const br_block_ctr_class    *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_ct_ctr_keys;
typedef struct { const br_block_ctrcbc_class *vtable; uint32_t skey[60]; unsigned num_rounds; } br_aes_ct_ctrcbc_keys;
typedef struct { const br_block_cbcenc_class *vtable; uint64_t skey[30]; unsigned num_rounds; } br_aes_ct64_cbcenc_keys;
typedef struct { const br_block_cbcdec_class *vtable; uint64_t skey[30]; unsigned num_rounds; } br_aes_ct64_cbcdec_keys;
typedef struct { const br_block_ctr_class    *vtable; uint64_t skey[30]; unsigned num_rounds; } br_aes_ct64_ctr_keys;
typedef struct { const br_block_ctrcbc_class *vtable; uint64_t skey[30]; unsigned num_rounds; } br_aes_ct64_ctrcbc_keys;
typedef struct { const br_block_cbcenc_class *vtable; union { unsigned char skni[240]; } skey; unsigned num_rounds; } br_aes_x86ni_cbcenc_keys;
typedef struct { const br_block_cbcdec_class *vtable; union { unsigned char skni[240]; } skey; unsigned num_rounds; } br_aes_x86ni_cbcdec_keys;
typedef struct { const br_block_ctr_class    *vtable; union { unsigned char skni[240]; } skey; unsigned num_rounds; } br_aes_x86ni_ctr_keys;
typedef struct { const br_block_ctrcbc_class *vtable; union { unsigned char skni[240]; } skey; unsigned num_rounds; } br_aes_x86ni_ctrcbc_keys;
typedef struct { const br_block_cbcenc_class *vtable; union { unsigned char skni[240]; } skey; unsigned num_rounds; } br_aes_pwr8_cbcenc_keys;
typedef struct { const br_block_cbcdec_class *vtable; union { unsigned char skni[240]; } skey; unsigned num_rounds; } br_aes_pwr8_cbcdec_keys;
typedef struct { const br_block_ctr_class    *vtable; union { unsigned char skni[240]; } skey; unsigned num_rounds; } br_aes_pwr8_ctr_keys;
typedef struct { const br_block_ctrcbc_class *vtable; union { unsigned char skni[240]; } skey; unsigned num_rounds; } br_aes_pwr8_ctrcbc_keys;
typedef union {
	const br_block_cbcenc_class *vtable;
	br_aes_big_cbcenc_keys c_big; br_aes_small_cbcenc_keys c_small;
	br_aes_ct_cbcenc_keys c_ct;   br_aes_ct64_cbcenc_keys c_ct64;
	br_aes_x86ni_cbcenc_keys c_x86ni; br_aes_pwr8_cbcenc_keys c_pwr8;
} br_aes_gen_cbcenc_keys;
typedef union {
	const br_block_cbcdec_class *vtable;
	br_aes_big_cbcdec_keys c_big; br_aes_small_cbcdec_keys c_small;
	br_aes_ct_cbcdec_keys c_ct;   br_aes_ct64_cbcdec_keys c_ct64;
	br_aes_x86ni_cbcdec_keys c_x86ni; br_aes_pwr8_cbcdec_keys c_pwr8;
} br_aes_gen_cbcdec_keys;
typedef union {
	const br_block_ctr_class *vtable;
	br_aes_big_ctr_keys c_big; br_aes_small_ctr_keys c_small;
	br_aes_ct_ctr_keys c_ct;   br_aes_ct64_ctr_keys c_ct64;
	br_aes_x86ni_ctr_keys c_x86ni; br_aes_pwr8_ctr_keys c_pwr8;
} br_aes_gen_ctr_keys;
typedef union {
	const br_block_ctrcbc_class *vtable;
	br_aes_big_ctrcbc_keys c_big; br_aes_small_ctrcbc_keys c_small;
	br_aes_ct_ctrcbc_keys c_ct;   br_aes_ct64_ctrcbc_keys c_ct64;
	br_aes_x86ni_ctrcbc_keys c_x86ni; br_aes_pwr8_ctrcbc_keys c_pwr8;
} br_aes_gen_ctrcbc_keys;
typedef struct { const br_block_cbcenc_class *vtable; uint32_t skey[96]; unsigned num_rounds; } br_des_tab_cbcenc_keys;
typedef struct { const br_block_cbcdec_class *vtable; uint32_t skey[96]; unsigned num_rounds; } br_des_tab_cbcdec_keys;
typedef struct { const br_block_cbcenc_class *vtable; uint32_t skey[96]; unsigned num_rounds; } br_des_ct_cbcenc_keys;
typedef struct { const br_block_cbcdec_class *vtable; uint32_t skey[96]; unsigned num_rounds; } br_des_ct_cbcdec_keys;
typedef union {
	const br_block_cbcenc_class *vtable;
	br_des_tab_cbcenc_keys tab; br_des_ct_cbcenc_keys ct;
} br_des_gen_cbcenc_keys;
typedef union {
	const br_block_cbcdec_class *vtable;
	br_des_tab_cbcdec_keys c_tab; br_des_ct_cbcdec_keys c_ct;
} br_des_gen_cbcdec_keys;
typedef uint32_t (*br_chacha20_run)(const void *key,
	const void *iv, uint32_t cc, void *data, size_t len);
typedef void (*br_poly1305_run)(const void *key, const void *iv,
	void *data, size_t len, const void *aad, size_t aad_len,
	void *tag, br_chacha20_run ichacha, int encrypt);

/* rand */
typedef struct br_prng_class_ br_prng_class;
typedef struct {
	const br_prng_class *vtable;
	unsigned char K[64]; unsigned char V[64];
	const br_hash_class *digest_class;
} br_hmac_drbg_context;

/* hmac */
typedef struct {
	const br_hash_class *dig_vtable;
	unsigned char ksi[64], kso[64];
} br_hmac_key_context;

void br_sha1_init(br_sha1_context *ctx);
void br_sha1_update(br_sha1_context *ctx, const void *data, size_t len);
void br_sha1_out(const br_sha1_context *ctx, void *out);

void br_sha224_update(void *ctx, const void *data, size_t len);
void br_sha384_update(void *ctx, const void *data, size_t len);

void br_sha256_init(br_sha256_context *ctx);
void br_sha256_out(const br_sha256_context *ctx, void *out);

void br_sha384_init(br_sha384_context *ctx);
void br_sha384_out(const br_sha384_context *ctx, void *out);

void br_sha512_init(br_sha512_context *ctx);
void br_sha512_out(const br_sha512_context *ctx, void *out);

/* rsa */
typedef struct {
	unsigned char *n; size_t nlen;
	unsigned char *e; size_t elen;
} br_rsa_public_key;
typedef uint32_t (*br_rsa_pkcs1_vrfy)(const unsigned char *x, size_t xlen,
	const unsigned char *hash_oid, size_t hash_len,
	const br_rsa_public_key *pk, unsigned char *hash_out);
br_rsa_pkcs1_vrfy br_rsa_pkcs1_vrfy_get_default(void);

/* ecdsa */
typedef struct br_ec_impl_ br_ec_impl;
typedef struct {
	int curve;
	unsigned char *q; size_t qlen;
} br_ec_public_key;
const br_ec_impl *br_ec_get_default(void);
typedef uint32_t (*br_ecdsa_vrfy)(const br_ec_impl *impl,
	const void *hash, size_t hash_len,
	const br_ec_public_key *pk, const void *sig, size_t sig_len);
br_ecdsa_vrfy br_ecdsa_vrfy_raw_get_default(void);
]]

local sha1_out = u8a(20)
metatype('br_sha1_context', {__index = {
	init = function(self)
		C.br_sha1_init(self)
		return self
	end,
	update = function(self, p, sz)
		C.br_sha1_update(self, p, sz or #p)
		return self
	end,
	out = function(self)
		C.br_sha1_out(self, sha1_out)
		return str(sha1_out, 20)
	end,
}})
sha1_digest = ctype'br_sha1_context'
local sha1_d = sha1_digest()
function sha1(s)
	return sha1_d:init():update(s):out()
end

local sha256_out = u8a(32)
metatype('br_sha256_context', {__index = {
	init = function(self)
		C.br_sha256_init(self)
		return self
	end,
	update = function(self, p, sz)
		C.br_sha224_update(self, p, sz or #p)
		return self
	end,
	out = function(self)
		C.br_sha256_out(self, sha256_out)
		return str(sha256_out, 32)
	end,
}})
sha256_digest = ctype'br_sha256_context'
local sha256_d = sha256_digest()
function sha256(s)
	return sha256_d:init():update(s):out()
end

local sha384_out = u8a(48)
metatype('br_sha384_context', {__index = {
	init = function(self)
		C.br_sha384_init(self)
		return self
	end,
	update = function(self, p, sz)
		C.br_sha384_update(self, p, sz or #p)
		return self
	end,
	out = function(self)
		C.br_sha384_out(self, sha384_out)
		return str(sha384_out, 48)
	end,
}})
sha384_digest = ctype'br_sha384_context'
local sha384_d = sha384_digest()
function sha384(s)
	return sha384_d:init():update(s):out()
end

local sha512_out = u8a(64)
metatype('br_sha512_context', {__index = {
	init = function(self)
		C.br_sha512_init(self)
		return self
	end,
	update = function(self, p, sz)
		C.br_sha384_update(self, p, sz or #p)
		return self
	end,
	out = function(self)
		C.br_sha512_out(self, sha512_out)
		return str(sha512_out, 64)
	end,
}})
sha512_digest = ctype'br_sha512_context'
local sha512_d = sha512_digest()
function sha512(s)
	return sha512_d:init():update(s):out()
end

function const_time_eq(a, b)
	if #a ~= #b then return false end
	local pa, pb = cast(u8p, a), cast(u8p, b)
	local diff = 0
	for i = 0, #a - 1 do
		diff = bor(diff, bxor(pa[i], pb[i]))
	end
	return diff == 0
end

local rsa_vrfy   = C.br_rsa_pkcs1_vrfy_get_default()
local ec_impl    = C.br_ec_get_default()
local ecdsa_vrfy = C.br_ecdsa_vrfy_raw_get_default()

local oid_sha1   = '\x05\x2B\x0E\x03\x02\x1A'
local oid_sha256 = '\x09\x60\x86\x48\x01\x65\x03\x04\x02\x01'
local oid_sha384 = '\x09\x60\x86\x48\x01\x65\x03\x04\x02\x02'
local oid_sha512 = '\x09\x60\x86\x48\x01\x65\x03\x04\x02\x03'

local curve_id = {['P-256'] = 23, ['P-384'] = 24, ['P-521'] = 25}

function rsa_public_key(n, e)
	local pk = new'br_rsa_public_key'
	pk.n = cast(u8p, n); pk.nlen = #n
	pk.e = cast(u8p, e); pk.elen = #e
	return {_pk = pk, _n = n, _e = e}
end

local hash_buf = u8a(64)
local function rsa_verify(oid, hlen, hash_fn, msg, sig, pk)
	if rsa_vrfy(sig, #sig, oid, hlen, pk._pk, hash_buf) == 0 then
		return false
	end
	return const_time_eq(hash_fn(msg), str(hash_buf, hlen))
end
function rsa_sha1_verify  (m, s, p) return rsa_verify(oid_sha1,   20, sha1,   m, s, p) end
function rsa_sha256_verify(m, s, p) return rsa_verify(oid_sha256, 32, sha256, m, s, p) end
function rsa_sha384_verify(m, s, p) return rsa_verify(oid_sha384, 48, sha384, m, s, p) end
function rsa_sha512_verify(m, s, p) return rsa_verify(oid_sha512, 64, sha512, m, s, p) end

function ec_public_key(curve, q)
	local id = assert(curve_id[curve], 'unknown curve')
	local pk = new'br_ec_public_key'
	pk.curve = id
	pk.q = cast(u8p, q); pk.qlen = #q
	return {_pk = pk, _q = q}
end

local function ecdsa_verify(hlen, hash_fn, msg, sig, pk)
	return ecdsa_vrfy(ec_impl, hash_fn(msg), hlen, pk._pk, sig, #sig) ~= 0
end
function ecdsa_sha256_verify(m, s, p) return ecdsa_verify(32, sha256, m, s, p) end
function ecdsa_sha384_verify(m, s, p) return ecdsa_verify(48, sha384, m, s, p) end
function ecdsa_sha512_verify(m, s, p) return ecdsa_verify(64, sha512, m, s, p) end
