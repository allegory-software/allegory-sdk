--[=[

	Secure async TCP sockets based on BearSSL (push-pull engine API).
	Written by Cosmin Apreutesei. Public Domain.

API
	[try_]client_stcp(tcp, host, opt) -> cstcp   create a secure client socket
	[try_]server_stcp(tcp, opt) -> sstcp         create a secure server socket
	- sstcp:[try_]accept([opt], [timeout]) -> cstcp   accept a TLS client connection
	- - cstcp:[try_]recv(buf, sz) -> n           receive decrypted bytes
	- - cstcp:[try_]send(buf, sz) -> true        send bytes (encrypted)
	- - cstcp:[try_]close()                      close with SSL shutdown
	- - cstcp:[try_]shutdown('r'|'w'|'rw')       shutdown underlying TCP
	opt table:
	- cert[_file]            certificate PEM data or file (for server or mutual TLS)
	- key[_file]             private key PEM data or file (for server or mutual TLS)
	- cert_issuer_rsa        hint: server EC cert was issued by RSA CA (default: EC)
	- min_rsa_size           minimum RSA key size for server cert chains (default: 2048)
	- session_cache_entries  number of TLS session cache entries (default: 1024)
	opt table / client only:
	- ca[_file]              CA certificate PEM data or file
	- insecure_noverifycert  skip server certificate verification
CONFIG
	ca_file                path to CA file. autodetected. client only.

]=]

require'glue'
require'sock'
require'fs'

local C = ffi.load'bearssl'

local
	min, band, bor, cast, copy, tonumber =
	min, band, bor, cast, copy, tonumber

cdef[[

/* pem */
typedef struct {
	struct { uint32_t *dp; uint32_t *rp; const unsigned char *ip; } cpu;
	uint32_t dp_stack[32];
	uint32_t rp_stack[32];
	int err;
	const unsigned char *hbuf;
	size_t hlen;
	void (*dest)(void *dest_ctx, const void *src, size_t len);
	void *dest_ctx;
	unsigned char event;
	char name[128];
	unsigned char buf[255];
	size_t ptr;
} br_pem_decoder_context;
void br_pem_decoder_init(br_pem_decoder_context *ctx);
size_t br_pem_decoder_push(br_pem_decoder_context *ctx,
	const void *data, size_t len);
int br_pem_decoder_event(br_pem_decoder_context *ctx);

/* hash */
typedef struct br_hash_class_ br_hash_class;
typedef struct { const br_hash_class *vtable; unsigned char buf[64];  uint64_t count; uint32_t val[4]; } br_md5_context;
typedef struct { const br_hash_class *vtable; unsigned char buf[64];  uint64_t count; uint32_t val[5]; } br_sha1_context;
typedef struct { const br_hash_class *vtable; unsigned char buf[64];  uint64_t count; uint32_t val[8]; } br_sha224_context;
typedef br_sha224_context br_sha256_context;
typedef struct { const br_hash_class *vtable; unsigned char buf[128]; uint64_t count; uint64_t val[8]; } br_sha384_context;
typedef br_sha384_context br_sha512_context;
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

/* prf */
typedef struct { const void *data; size_t len; } br_tls_prf_seed_chunk;
typedef void (*br_tls_prf_impl)(void *dst, size_t len,
	const void *secret, size_t secret_len, const char *label,
	size_t seed_num, const br_tls_prf_seed_chunk *seed);

/* protocol versions */
enum {
	BR_SSL30 = 0x0300,
	BR_TLS10 = 0x0301,
	BR_TLS11 = 0x0302,
	BR_TLS12 = 0x0303,
};

/* ec */
typedef struct { int curve; unsigned char *q; size_t qlen; } br_ec_public_key;
typedef struct { int curve; unsigned char *x; size_t xlen; } br_ec_private_key;
typedef struct br_ec_impl br_ec_impl;
typedef size_t (*br_ecdsa_sign)(const br_ec_impl *impl,
	const br_hash_class *hf, const void *hash_value,
	const br_ec_private_key *sk, void *sig);
typedef uint32_t (*br_ecdsa_vrfy)(const br_ec_impl *impl,
	const void *hash, size_t hash_len,
	const br_ec_public_key *pk, const void *sig, size_t sig_len);
const br_ec_impl *br_ec_get_default(void);
br_ecdsa_sign br_ecdsa_sign_asn1_get_default(void);

/* rsa */
typedef struct { unsigned char *n; size_t nlen; unsigned char *e; size_t elen; } br_rsa_public_key;
typedef struct {
	uint32_t n_bitlen;
	unsigned char *p; size_t plen; unsigned char *q;  size_t qlen;
	unsigned char *dp; size_t dplen; unsigned char *dq; size_t dqlen;
	unsigned char *iq; size_t iqlen;
} br_rsa_private_key;
typedef uint32_t (*br_rsa_public)(unsigned char *x, size_t xlen,
	const br_rsa_public_key *pk);
typedef uint32_t (*br_rsa_pkcs1_vrfy)(const unsigned char *x, size_t xlen,
	const unsigned char *hash_oid, size_t hash_len,
	const br_rsa_public_key *pk, unsigned char *hash_out);
typedef uint32_t (*br_rsa_private)(unsigned char *x, const br_rsa_private_key *sk);
typedef uint32_t (*br_rsa_pkcs1_sign)(const unsigned char *hash_oid,
	const unsigned char *hash, size_t hash_len,
	const br_rsa_private_key *sk, unsigned char *x);
br_rsa_pkcs1_sign br_rsa_pkcs1_sign_get_default(void);

/* x509 */
typedef struct {
	unsigned char key_type;
	union { br_rsa_public_key rsa; br_ec_public_key ec; } key;
} br_x509_pkey;
typedef struct { unsigned char *data; size_t len; } br_x500_name;
typedef struct { br_x500_name dn; unsigned flags; br_x509_pkey pkey; } br_x509_trust_anchor;
typedef struct br_x509_class_ br_x509_class;
struct br_x509_class_ {
	size_t context_size;
	void (*start_chain)(const br_x509_class **ctx, const char *server_name);
	void (*start_cert)(const br_x509_class **ctx, uint32_t length);
	void (*append)(const br_x509_class **ctx, const unsigned char *buf, size_t len);
	void (*end_cert)(const br_x509_class **ctx);
	unsigned (*end_chain)(const br_x509_class **ctx);
	const br_x509_pkey *(*get_pkey)(const br_x509_class **ctx, unsigned *usages);
};
typedef struct { const unsigned char *oid; char *buf; size_t len; int status; } br_name_element;
typedef struct {
	const br_x509_class *vtable;
	br_x509_pkey pkey;
	struct { uint32_t *dp; uint32_t *rp; const unsigned char *ip; } cpu;
	uint32_t dp_stack[32]; uint32_t rp_stack[32];
	int err;
	const char *server_name;
	unsigned char key_usages;
	uint32_t days, seconds;
	uint32_t cert_length; uint32_t num_certs;
	const unsigned char *hbuf; size_t hlen;
	unsigned char pad[256];
	unsigned char ee_pkey_data[520]; unsigned char pkey_data[520];
	unsigned char cert_signer_key_type;
	uint16_t cert_sig_hash_oid; unsigned char cert_sig_hash_len;
	unsigned char cert_sig[512]; uint16_t cert_sig_len;
	int16_t min_rsa_size;
	const br_x509_trust_anchor *trust_anchors; size_t trust_anchors_num;
	unsigned char do_mhash;
	br_multihash_context mhash;
	unsigned char tbs_hash[64];
	unsigned char do_dn_hash;
	const br_hash_class *dn_hash_impl;
	br_hash_compat_context dn_hash;
	unsigned char current_dn_hash[64]; unsigned char next_dn_hash[64];
	unsigned char saved_dn_hash[64];
	br_name_element *name_elts; size_t num_name_elts;
	br_rsa_pkcs1_vrfy irsa;
	br_ecdsa_vrfy iecdsa;
	const br_ec_impl *iec;
} br_x509_minimal_context;
typedef struct {
	br_x509_pkey pkey;
	struct { uint32_t *dp; uint32_t *rp; const unsigned char *ip; } cpu;
	uint32_t dp_stack[32]; uint32_t rp_stack[32];
	int err;
	unsigned char pad[256];
	unsigned char decoded;
	uint32_t notbefore_days, notbefore_seconds;
	uint32_t notafter_days, notafter_seconds;
	unsigned char isCA; unsigned char copy_dn;
	void *append_dn_ctx;
	void (*append_dn)(void *ctx, const void *buf, size_t len);
	const unsigned char *hbuf; size_t hlen;
	unsigned char pkey_data[520];
	unsigned char signer_key_type; unsigned char signer_hash_id;
} br_x509_decoder_context;
void br_x509_decoder_init(br_x509_decoder_context *ctx,
	void (*append_dn)(void *ctx, const void *buf, size_t len),
	void *append_dn_ctx);
void br_x509_decoder_push(br_x509_decoder_context *ctx,
	const void *data, size_t len);
typedef struct { unsigned char *data; size_t data_len; } br_x509_certificate;
typedef struct {
	union { br_rsa_private_key rsa; br_ec_private_key ec; } key;
	struct { uint32_t *dp; uint32_t *rp; const unsigned char *ip; } cpu;
	uint32_t dp_stack[32]; uint32_t rp_stack[32];
	int err;
	const unsigned char *hbuf; size_t hlen;
	unsigned char pad[256];
	unsigned char key_type;
	unsigned char key_data[3 * 512];
} br_skey_decoder_context;
void br_skey_decoder_init(br_skey_decoder_context *ctx);
void br_skey_decoder_push(br_skey_decoder_context *ctx,
	const void *data, size_t len);

/* ssl record layer */
typedef struct br_sslrec_in_class_      br_sslrec_in_class;
typedef struct br_sslrec_out_class_     br_sslrec_out_class;
typedef struct br_sslrec_in_cbc_class_  br_sslrec_in_cbc_class;
typedef struct br_sslrec_out_cbc_class_ br_sslrec_out_cbc_class;
typedef struct br_sslrec_in_gcm_class_  br_sslrec_in_gcm_class;
typedef struct br_sslrec_out_gcm_class_ br_sslrec_out_gcm_class;
typedef struct br_sslrec_in_chapol_class_  br_sslrec_in_chapol_class;
typedef struct br_sslrec_out_chapol_class_ br_sslrec_out_chapol_class;
typedef struct br_sslrec_in_ccm_class_  br_sslrec_in_ccm_class;
typedef struct br_sslrec_out_ccm_class_ br_sslrec_out_ccm_class;
typedef struct { const br_sslrec_out_class *vtable; } br_sslrec_out_clear_context;
typedef struct {
	const br_sslrec_in_cbc_class *vtable;
	uint64_t seq;
	union { const br_block_cbcdec_class *vtable; br_aes_gen_cbcdec_keys aes; br_des_gen_cbcdec_keys des; } bc;
	br_hmac_key_context mac;
	size_t mac_len;
	unsigned char iv[16];
	int explicit_IV;
} br_sslrec_in_cbc_context;
typedef struct {
	const br_sslrec_out_cbc_class *vtable;
	uint64_t seq;
	union { const br_block_cbcenc_class *vtable; br_aes_gen_cbcenc_keys aes; br_des_gen_cbcenc_keys des; } bc;
	br_hmac_key_context mac;
	size_t mac_len;
	unsigned char iv[16];
	int explicit_IV;
} br_sslrec_out_cbc_context;
typedef struct {
	union { const void *gen; const br_sslrec_in_gcm_class *in; const br_sslrec_out_gcm_class *out; } vtable;
	uint64_t seq;
	union { const br_block_ctr_class *vtable; br_aes_gen_ctr_keys aes; } bc;
	br_ghash gh;
	unsigned char iv[4];
	unsigned char h[16];
} br_sslrec_gcm_context;
typedef struct {
	union { const void *gen; const br_sslrec_in_chapol_class *in; const br_sslrec_out_chapol_class *out; } vtable;
	uint64_t seq;
	unsigned char key[32];
	unsigned char iv[12];
	br_chacha20_run ichacha;
	br_poly1305_run ipoly;
} br_sslrec_chapol_context;
typedef struct {
	union { const void *gen; const br_sslrec_in_ccm_class *in; const br_sslrec_out_ccm_class *out; } vtable;
	uint64_t seq;
	union { const br_block_ctrcbc_class *vtable; br_aes_gen_ctrcbc_keys aes; } bc;
	unsigned char iv[4];
	size_t tag_len;
} br_sslrec_ccm_context;

/* ssl engine */
typedef struct {
	unsigned char session_id[32];
	unsigned char session_id_len;
	uint16_t version;
	uint16_t cipher_suite;
	unsigned char master_secret[48];
} br_ssl_session_parameters;
typedef struct {
	int err;
	unsigned char *ibuf, *obuf;
	size_t ibuf_len, obuf_len;
	uint16_t max_frag_len;
	unsigned char log_max_frag_len;
	unsigned char peer_log_max_frag_len;
	size_t ixa, ixb, ixc;
	size_t oxa, oxb, oxc;
	unsigned char iomode;
	unsigned char incrypt;
	unsigned char shutdown_recv;
	unsigned char record_type_in, record_type_out;
	uint16_t version_in;
	uint16_t version_out;
	union {
		const br_sslrec_in_class *vtable;
		br_sslrec_in_cbc_context cbc;
		br_sslrec_gcm_context gcm;
		br_sslrec_chapol_context chapol;
		br_sslrec_ccm_context ccm;
	} in;
	union {
		const br_sslrec_out_class *vtable;
		br_sslrec_out_clear_context clear;
		br_sslrec_out_cbc_context cbc;
		br_sslrec_gcm_context gcm;
		br_sslrec_chapol_context chapol;
		br_sslrec_ccm_context ccm;
	} out;
	unsigned char application_data;
	br_hmac_drbg_context rng;
	int rng_init_done;
	int rng_os_rand_done;
	uint16_t version_min;
	uint16_t version_max;
	uint16_t suites_buf[48];
	unsigned char suites_num;
	char server_name[256];
	unsigned char client_random[32];
	unsigned char server_random[32];
	br_ssl_session_parameters session;
	unsigned char ecdhe_curve;
	unsigned char ecdhe_point[133];
	unsigned char ecdhe_point_len;
	unsigned char reneg;
	unsigned char saved_finished[24];
	uint32_t flags;
	struct { uint32_t *dp; uint32_t *rp; const unsigned char *ip; } cpu;
	uint32_t dp_stack[32];
	uint32_t rp_stack[32];
	unsigned char pad[512];
	unsigned char *hbuf_in, *hbuf_out, *saved_hbuf_out;
	size_t hlen_in, hlen_out;
	void (*hsrun)(void *ctx);
	unsigned char action;
	unsigned char alert;
	unsigned char close_received;
	br_multihash_context mhash;
	const br_x509_class **x509ctx;
	const br_x509_certificate *chain;
	size_t chain_len;
	const unsigned char *cert_cur;
	size_t cert_len;
	const char **protocol_names;
	uint16_t protocol_names_num;
	uint16_t selected_protocol;
	br_tls_prf_impl prf10;
	br_tls_prf_impl prf_sha256;
	br_tls_prf_impl prf_sha384;
	const br_block_cbcenc_class *iaes_cbcenc;
	const br_block_cbcdec_class *iaes_cbcdec;
	const br_block_ctr_class *iaes_ctr;
	const br_block_ctrcbc_class *iaes_ctrcbc;
	const br_block_cbcenc_class *ides_cbcenc;
	const br_block_cbcdec_class *ides_cbcdec;
	br_ghash ighash;
	br_chacha20_run ichacha;
	br_poly1305_run ipoly;
	const br_sslrec_in_cbc_class *icbc_in;
	const br_sslrec_out_cbc_class *icbc_out;
	const br_sslrec_in_gcm_class *igcm_in;
	const br_sslrec_out_gcm_class *igcm_out;
	const br_sslrec_in_chapol_class *ichapol_in;
	const br_sslrec_out_chapol_class *ichapol_out;
	const br_sslrec_in_ccm_class *iccm_in;
	const br_sslrec_out_ccm_class *iccm_out;
	const br_ec_impl *iec;
	br_rsa_pkcs1_vrfy irsavrfy;
	br_ecdsa_vrfy iecdsa;
} br_ssl_engine_context;
unsigned br_ssl_engine_current_state(const br_ssl_engine_context *cc);
unsigned char *br_ssl_engine_sendapp_buf(const br_ssl_engine_context *cc, size_t *len);
void br_ssl_engine_sendapp_ack(br_ssl_engine_context *cc, size_t len);
unsigned char *br_ssl_engine_recvapp_buf(const br_ssl_engine_context *cc, size_t *len);
void br_ssl_engine_recvapp_ack(br_ssl_engine_context *cc, size_t len);
unsigned char *br_ssl_engine_sendrec_buf(const br_ssl_engine_context *cc, size_t *len);
void br_ssl_engine_sendrec_ack(br_ssl_engine_context *cc, size_t len);
unsigned char *br_ssl_engine_recvrec_buf(const br_ssl_engine_context *cc, size_t *len);
void br_ssl_engine_recvrec_ack(br_ssl_engine_context *cc, size_t len);
void br_ssl_engine_flush(br_ssl_engine_context *cc, int force);
void br_ssl_engine_close(br_ssl_engine_context *cc);
void br_ssl_engine_set_buffer(br_ssl_engine_context *cc,
	void *iobuf, size_t iobuf_len, int bidi);
typedef struct br_ssl_session_cache_class_ br_ssl_session_cache_class;
typedef struct br_ssl_session_cache_lru_ {
	const br_ssl_session_cache_class *vtable;
	unsigned char *store; size_t store_len, store_ptr;
	unsigned char index_key[32];
	const br_hash_class *hash;
	int init_done;
	uint32_t head, tail, root;
} br_ssl_session_cache_lru;
void br_ssl_session_cache_lru_init(br_ssl_session_cache_lru *cc,
	unsigned char *store, size_t store_len);
void br_ssl_engine_set_suites(br_ssl_engine_context *cc,
	const uint16_t *suites, size_t suites_num);

/* ssl client */
typedef struct br_ssl_client_context_ br_ssl_client_context;
typedef struct br_ssl_client_certificate_class_ br_ssl_client_certificate_class;
typedef struct {
	const br_ssl_client_certificate_class *vtable;
	const br_x509_certificate *chain; size_t chain_len;
	const br_rsa_private_key *sk;
	br_rsa_pkcs1_sign irsasign;
} br_ssl_client_certificate_rsa_context;
typedef struct {
	const br_ssl_client_certificate_class *vtable;
	const br_x509_certificate *chain; size_t chain_len;
	const br_ec_private_key *sk;
	unsigned allowed_usages; unsigned issuer_key_type;
	const br_multihash_context *mhash;
	const br_ec_impl *iec;
	br_ecdsa_sign iecdsa;
} br_ssl_client_certificate_ec_context;
struct br_ssl_client_context_ {
	br_ssl_engine_context eng;
	uint16_t min_clienthello_len;
	uint32_t hashes;
	int server_curve;
	const br_ssl_client_certificate_class **client_auth_vtable;
	unsigned char auth_type; unsigned char hash_id;
	union {
		const br_ssl_client_certificate_class *vtable;
		br_ssl_client_certificate_rsa_context single_rsa;
		br_ssl_client_certificate_ec_context single_ec;
	} client_auth;
	br_rsa_public irsapub;
};
void br_ssl_client_init_full(br_ssl_client_context *cc,
	br_x509_minimal_context *xc,
	const br_x509_trust_anchor *trust_anchors, size_t trust_anchors_num);
int br_ssl_client_reset(br_ssl_client_context *cc,
	const char *server_name, int resume_session);
void br_ssl_client_set_single_rsa(br_ssl_client_context *cc,
	const br_x509_certificate *chain, size_t chain_len,
	const br_rsa_private_key *sk, br_rsa_pkcs1_sign irsasign);
void br_ssl_client_set_single_ec(br_ssl_client_context *cc,
	const br_x509_certificate *chain, size_t chain_len,
	const br_ec_private_key *sk, unsigned allowed_usages,
	unsigned cert_issuer_key_type,
	const br_ec_impl *iec, br_ecdsa_sign iecdsa);

/* ssl server */
typedef struct br_ssl_server_policy_class_ br_ssl_server_policy_class;
typedef struct {
	const br_ssl_server_policy_class *vtable;
	const br_x509_certificate *chain; size_t chain_len;
	const br_rsa_private_key *sk;
	unsigned allowed_usages;
	br_rsa_private irsacore;
	br_rsa_pkcs1_sign irsasign;
} br_ssl_server_policy_rsa_context;
typedef struct {
	const br_ssl_server_policy_class *vtable;
	const br_x509_certificate *chain; size_t chain_len;
	const br_ec_private_key *sk;
	unsigned allowed_usages; unsigned cert_issuer_key_type;
	const br_multihash_context *mhash;
	const br_ec_impl *iec;
	br_ecdsa_sign iecdsa;
} br_ssl_server_policy_ec_context;
typedef struct br_ssl_session_cache_class_ br_ssl_session_cache_class;
typedef uint16_t br_suite_translated[2];
typedef struct {
	br_ssl_engine_context eng;
	uint16_t client_max_version;
	const br_ssl_session_cache_class **cache_vtable;
	br_suite_translated client_suites[48];
	unsigned char client_suites_num;
	uint32_t hashes; uint32_t curves;
	const br_ssl_server_policy_class **policy_vtable;
	uint16_t sign_hash_id;
	union {
		const br_ssl_server_policy_class *vtable;
		br_ssl_server_policy_rsa_context single_rsa;
		br_ssl_server_policy_ec_context single_ec;
	} chain_handler;
	unsigned char ecdhe_key[70];
	size_t ecdhe_key_len;
	const br_x500_name *ta_names;
	const br_x509_trust_anchor *tas;
	size_t num_tas;
	size_t cur_dn_index;
	const unsigned char *cur_dn; size_t cur_dn_len;
	unsigned char hash_CV[64];
	size_t hash_CV_len; int hash_CV_id;
} br_ssl_server_context;
void br_ssl_server_init_full_rsa(br_ssl_server_context *cc,
	const br_x509_certificate *chain, size_t chain_len,
	const br_rsa_private_key *sk);
void br_ssl_server_init_full_ec(br_ssl_server_context *cc,
	const br_x509_certificate *chain, size_t chain_len,
	unsigned cert_issuer_key_type, const br_ec_private_key *sk);
int br_ssl_server_reset(br_ssl_server_context *cc);
]]

assert(sizeof'br_ssl_engine_context'   == 3616)
assert(sizeof'br_ssl_client_context'   == 3720)
assert(sizeof'br_ssl_server_context'   == 4128)
assert(sizeof'br_x509_minimal_context' == 3168)
assert(sizeof'br_x509_decoder_context' == 1168)
assert(sizeof'br_skey_decoder_context' == 2192)

local BR_PEM_BEGIN_OBJ = 1
local BR_PEM_END_OBJ   = 2
local BR_PEM_ERROR     = 3

local BR_SSL_CLOSED  = 0x0001
local BR_SSL_SENDREC = 0x0002
local BR_SSL_RECVREC = 0x0004
local BR_SSL_SENDAPP = 0x0008
local BR_SSL_RECVAPP = 0x0010

local BR_KEYTYPE_RSA  = 1
local BR_KEYTYPE_EC   = 2
local BR_KEYTYPE_KEYX = 0x10
local BR_KEYTYPE_SIGN = 0x20
local BR_X509_TA_CA   = 0x0001

local BR_SSL_BUFSIZE_BIDI = (16384 + 325) + (16384 + 85)

--SSL error mapping ----------------------------------------------------------

local BR_ERR_RECV_FATAL_ALERT = 256
local BR_ERR_SEND_FATAL_ALERT = 512

local br_alert_name = {
	-- from c/bearssl/src/inc/bearssl_ssl.h BR_ALERT_* defs
	[0]   = 'close_notify',
	[10]  = 'unexpected_message',
	[20]  = 'bad_record_mac',
	[22]  = 'record_overflow',
	[30]  = 'decompression_failure',
	[40]  = 'handshake_failure',
	[42]  = 'bad_certificate',
	[43]  = 'unsupported_certificate',
	[44]  = 'certificate_revoked',
	[45]  = 'certificate_expired',
	[46]  = 'certificate_unknown',
	[47]  = 'illegal_parameter',
	[48]  = 'unknown_ca',
	[49]  = 'access_denied',
	[50]  = 'decode_error',
	[51]  = 'decrypt_error',
	[70]  = 'protocol_version',
	[71]  = 'insufficient_security',
	[80]  = 'internal_error',
	[90]  = 'user_canceled',
	[100] = 'no_renegotiation',
	[110] = 'unsupported_extension',
	[120] = 'no_application_protocol',
}

local function ssl_alert_error(e)
	if e >= BR_ERR_SEND_FATAL_ALERT then
		e = e - BR_ERR_SEND_FATAL_ALERT
		return 'ssl_send_error_'..(br_alert_name[e] or e)
	elseif e >= BR_ERR_RECV_FATAL_ALERT then
		e = e - BR_ERR_RECV_FATAL_ALERT
		return 'ssl_recv_error_'..(br_alert_name[e] or e)
	end
end

local br_err_name = {
	-- from c/bearssl/src/inc/bearssl_ssl.h BR_ERR_* defs
	[1]  = 'bad_param',
	[2]  = 'bad_state',
	[3]  = 'unsupported_version',
	[4]  = 'bad_version',
	[5]  = 'bad_length',
	[6]  = 'too_large',
	[7]  = 'bad_mac',
	[8]  = 'no_random',
	[9]  = 'unknown_type',
	[10] = 'unexpected',
	[12] = 'bad_ccs',
	[13] = 'bad_alert',
	[14] = 'bad_handshake',
	[15] = 'oversized_id',
	[16] = 'bad_cipher_suite',
	[17] = 'bad_compression',
	[18] = 'bad_fraglen',
	[19] = 'bad_secreneg',
	[20] = 'extra_extension',
	[21] = 'bad_sni',
	[22] = 'bad_hello_done',
	[23] = 'limit_exceeded',
	[24] = 'bad_finished',
	[25] = 'resume_mismatch',
	[26] = 'invalid_algorithm',
	[27] = 'bad_signature',
	[28] = 'wrong_key_usage',
	[29] = 'no_client_auth',
	[31] = 'io',
	-- from c/bearssl/src/inc/bearssl_x509.h BR_ERR_X509_* defs
	[32] = 'x509_ok',
	[33] = 'x509_invalid_value',
	[34] = 'x509_truncated',
	[35] = 'x509_empty_chain',
	[36] = 'x509_inner_trunc',
	[37] = 'x509_bad_tag_class',
	[38] = 'x509_bad_tag_value',
	[39] = 'x509_indefinite_length',
	[40] = 'x509_extra_element',
	[41] = 'x509_unexpected',
	[42] = 'x509_not_constructed',
	[43] = 'x509_not_primitive',
	[44] = 'x509_partial_byte',
	[45] = 'x509_bad_boolean',
	[46] = 'x509_overflow',
	[47] = 'x509_bad_dn',
	[48] = 'x509_bad_time',
	[49] = 'x509_unsupported',
	[50] = 'x509_limit_exceeded',
	[51] = 'x509_wrong_key_type',
	[52] = 'x509_bad_signature',
	[53] = 'x509_time_unknown',
	[54] = 'x509_expired',
	[55] = 'x509_dn_mismatch',
	[56] = 'x509_bad_server_name',
	[57] = 'x509_critical_extension',
	[58] = 'x509_not_ca',
	[59] = 'x509_forbidden_key_usage',
	[60] = 'x509_weak_public_key',
	[62] = 'x509_not_trusted',
}

local function ssl_br_error(err)
	return 'ssl_error_'..(br_err_name[err] or err)
end

--PEM parsing ----------------------------------------------------------------

local _pem_acc     -- uint8_t* write head
local _pem_acc_pos -- current fill count
local _pem_maxsz   -- allocated size

local _pem_dest_cb = cast('void(*)(void*, const void*, size_t)',
	function(ctx, src, len)
		len = tonumber(len)
		if _pem_acc_pos + len > _pem_maxsz then return end
		copy(_pem_acc + _pem_acc_pos, src, len)
		_pem_acc_pos = _pem_acc_pos + len
	end)

local _dn_acc = new('uint8_t[4096]') -- reused DN accumulator
local _dn_pos = 0

local _dn_cb = cast('void(*)(void*, const void*, size_t)',
	function(ctx, src, len)
		len = tonumber(len)
		if _dn_pos + len > 4096 then return end
		copy(_dn_acc + _dn_pos, src, len)
		_dn_pos = _dn_pos + len
	end)

-- Parse PEM string; returns list of {name=, data=uint8_t[], len=n}.
local function parse_pem(s)
	local data_len = #s
	local acc = new('uint8_t[?]', data_len)
	local pdc = new('br_pem_decoder_context')
	C.br_pem_decoder_init(pdc)
	local sp = cast('const uint8_t*', s)
	local i = 0
	local objs = {}
	local cur_name

	_pem_acc     = acc
	_pem_maxsz   = data_len
	_pem_acc_pos = 0

	while i < data_len do
		local consumed = tonumber(C.br_pem_decoder_push(pdc, sp + i, data_len - i))
		i = i + consumed
		local ev = C.br_pem_decoder_event(pdc)
		if ev == BR_PEM_BEGIN_OBJ then
			cur_name     = ffi.string(pdc.name)
			_pem_acc_pos = 0
			pdc.dest     = _pem_dest_cb
			pdc.dest_ctx = nil
		elseif ev == BR_PEM_END_OBJ then
			if cur_name then
				local n    = _pem_acc_pos
				local data = new('uint8_t[?]', n)
				copy(data, acc, n)
				objs[#objs + 1] = {name = cur_name, data = data, len = n}
				cur_name = nil
				pdc.dest = nil
			end
		elseif ev == BR_PEM_ERROR then
			return nil, 'pem_decode_error'
		end
	end
	return objs
end
jit.off(parse_pem) --calls back into Lua through br_pem_decoder_push.

--Key struct helpers ---------------------------------------------------------

-- Copy br_rsa_private_key fields into a new [1] array (pointer-compatible).
-- The actual key bytes still live in skdc.key_data; skdc must stay alive.
local function copy_rsa_sk(src, keepalive)
	local sk = new'br_rsa_private_key[1]'
	sk[0].n_bitlen = src.n_bitlen
	sk[0].p  = src.p;  sk[0].plen  = src.plen
	sk[0].q  = src.q;  sk[0].qlen  = src.qlen
	sk[0].dp = src.dp; sk[0].dplen = src.dplen
	sk[0].dq = src.dq; sk[0].dqlen = src.dqlen
	sk[0].iq = src.iq; sk[0].iqlen = src.iqlen
	add(keepalive, sk)
	return sk
end

local function copy_ec_sk(src, keepalive)
	local sk = new('br_ec_private_key[1]')
	sk[0].curve = src.curve
	sk[0].x     = src.x; sk[0].xlen = src.xlen
	add(keepalive, sk)
	return sk
end

--Trust anchors --------------------------------------------------------------

-- Build br_x509_trust_anchor[] from CA PEM.
-- Returns (ta_array, ta_count, keepalive) or (nil, err).
local function load_trust_anchors(ca_pem)
	local objs, err = parse_pem(ca_pem)
	if not objs then return nil, err end

	local certs = {}
	for _, o in ipairs(objs) do
		if o.name == 'CERTIFICATE' then certs[#certs + 1] = o end
	end
	if #certs == 0 then return nil, 'no_certificates_in_ca' end

	local n        = #certs
	local ta_array = new('br_x509_trust_anchor[?]', n)
	local keepalive = {ta_array}

	for i, cert in ipairs(certs) do
		local dc = new('br_x509_decoder_context')
		_dn_pos = 0
		C.br_x509_decoder_init(dc, _dn_cb, nil)
		C.br_x509_decoder_push(dc, cert.data, cert.len)

		local e = tonumber(dc.err)
		if e ~= 0 or tonumber(dc.decoded) == 0 then
			return nil, 'cert_decode_error_'..(br_err_name[e] or e)
		end

		local ta   = ta_array[i - 1]
		local pkey = dc.pkey
		local kt   = tonumber(pkey.key_type)

		-- copy DN into a persistent buffer
		local dn_len  = _dn_pos
		local dn_copy = new('uint8_t[?]', dn_len)
		copy(dn_copy, _dn_acc, dn_len)
		add(keepalive, dn_copy)
		ta.dn.data = dn_copy
		ta.dn.len  = dn_len
		ta.flags   = BR_X509_TA_CA

		if kt == BR_KEYTYPE_RSA then
			local rsa  = pkey.key.rsa
			local nlen = tonumber(rsa.nlen)
			local elen = tonumber(rsa.elen)
			local nc   = new('uint8_t[?]', nlen)
			local ec_e = new('uint8_t[?]', elen)
			copy(nc, rsa.n, nlen)
			copy(ec_e, rsa.e, elen)
			add(keepalive, nc)
			add(keepalive, ec_e)
			ta.pkey.key_type      = BR_KEYTYPE_RSA
			ta.pkey.key.rsa.n     = nc;   ta.pkey.key.rsa.nlen = nlen
			ta.pkey.key.rsa.e     = ec_e; ta.pkey.key.rsa.elen = elen
		elseif kt == BR_KEYTYPE_EC then
			local ec   = pkey.key.ec
			local qlen = tonumber(ec.qlen)
			local qc   = new('uint8_t[?]', qlen)
			copy(qc, ec.q, qlen)
			add(keepalive, qc)
			ta.pkey.key_type     = BR_KEYTYPE_EC
			ta.pkey.key.ec.curve = tonumber(ec.curve)
			ta.pkey.key.ec.q     = qc; ta.pkey.key.ec.qlen = qlen
		else
			return nil, 'unsupported_ca_key_type_'..kt
		end
	end

	return ta_array, n, keepalive
end
jit.off(load_trust_anchors) --calls back into Lua through br_x509_decoder_push.

--Certificate chain ----------------------------------------------------------

local function load_cert_chain(cert_pem)
	local objs, err = parse_pem(cert_pem)
	if not objs then return nil, err end
	local certs = {}
	for _, o in ipairs(objs) do
		if o.name == 'CERTIFICATE' then certs[#certs + 1] = o end
	end
	if #certs == 0 then return nil, 'no_certificates_in_chain' end
	local n        = #certs
	local chain    = new('br_x509_certificate[?]', n)
	local keepalive = {chain}
	for i, cert in ipairs(certs) do
		chain[i - 1].data     = cert.data
		chain[i - 1].data_len = cert.len
		add(keepalive, cert.data)
	end
	return chain, n, keepalive
end

--Private key ----------------------------------------------------------------

-- Returns (skdc, key_type, keepalive) or (nil, err).
-- skdc kept alive because key struct pointers reference skdc.key_data.
local function load_private_key(key_pem)
	local objs, err = parse_pem(key_pem)
	if not objs then return nil, err end
	local der
	for _, o in ipairs(objs) do
		if o.name == 'RSA PRIVATE KEY'
		or o.name == 'EC PRIVATE KEY'
		or o.name == 'PRIVATE KEY' then
			der = o; break
		end
	end
	if not der then return nil, 'no_private_key_in_pem' end
	local skdc = new('br_skey_decoder_context')
	C.br_skey_decoder_init(skdc)
	C.br_skey_decoder_push(skdc, der.data, der.len)
	if tonumber(skdc.err) ~= 0 then
		return nil, 'key_decode_error_'..tonumber(skdc.err)
	end
	local kt = tonumber(skdc.key_type)
	if kt == 0 then return nil, 'key_decode_incomplete' end
	return skdc, kt, {skdc, der.data}
end

--SSL context builders -------------------------------------------------------

local function P(s)
	return exists(s) and s or nil
end
local function os_ca_file(path)
	return false
		or P'/etc/ssl/certs/ca-certificates.crt'                --Debian/Ubuntu/Gentoo etc.
		or P'/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem' --Fedora/RHEL 7
		or P'/etc/pki/tls/certs/ca-bundle.crt'                  --Fedora/RHEL 6
		or P'/etc/ssl/ca-bundle.pem'                            --OpenSUSE
		or P'/etc/pki/tls/cacert.pem'                           --OpenELEC
		or P'/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem' --CentOS/RHEL 7
		or P'/etc/ssl/cert.pem'                                 --Alpine Linux
end
local ca, ca_clock
local function load_ca(ca_file)
	if not ca or clock() - ca_clock > 3600 * 24 then
		ca_file = assert(ca_file or config'ca_file' or os_ca_file(), 'ca file not found')
		ca = load(ca_file)
		ca_clock = clock()
	end
	return ca
end

local load_once = memoize(load)
local function cert_key_opt(opt, required)
	local cert = opt.cert or opt.cert_file and load_once(opt.cert_file)
	local key  = opt.key  or opt.key_file  and load_once(opt.key_file)
	if required or (cert or key) then
		assert(cert, 'tls_client: cert or cert_file required')
		assert(key , 'tls_client: key or key_file required')
		return cert, key
	end
end

-- BearSSL cipher suite ids
local BR_TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256 = 0xCCA9
local BR_TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256   = 0xCCA8
local BR_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384       = 0xC02C
local BR_TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384         = 0xC030
local BR_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256       = 0xC02B
local BR_TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256         = 0xC02F

--noverify x509: clone x509_minimal vtable, override end_chain to suppress
--BR_ERR_X509_NOT_TRUSTED, following BearSSL's own x509_noanchor pattern.
local noverify_vt --created on first use from x509_minimal's vtable.
local noverify_end_chain_cb --prevent GC of FFI callback
local function noverify_x509(xc)
	if not noverify_vt then
		local orig_vt = xc.vtable
		noverify_vt = new('br_x509_class')
		copy(noverify_vt, orig_vt, ffi.sizeof('br_x509_class'))
		local orig_end_chain = orig_vt.end_chain
		noverify_end_chain_cb = cast('unsigned (*)(const br_x509_class **)', function(ctx)
			local r = orig_end_chain(ctx)
			return r == 62 and 0 or r --62 = BR_ERR_X509_NOT_TRUSTED
		end)
		noverify_vt.end_chain = noverify_end_chain_cb
	else
		assert(xc.vtable.start_chain == noverify_vt.start_chain) --same static vtable from bearssl
	end
	xc.vtable = noverify_vt
end

-- Returns (sc, eng_ptr, keepalive) or (nil, err).
local function make_client_ctx(opt)
	local keepalive = {}
	local sc  = new('br_ssl_client_context')
	local xc  = new('br_x509_minimal_context')
	local buf = new('uint8_t[?]', BR_SSL_BUFSIZE_BIDI)
	local eng = cast('br_ssl_engine_context*', sc) -- eng is first field
	add(keepalive, sc)
	add(keepalive, xc)
	add(keepalive, buf)

	if not opt.insecure_noverifycert then
		local ca = opt.ca or load_ca(opt.ca_file)
		local ta, ta_n, ta_kp = load_trust_anchors(ca)
		if not ta then return nil, ta_n end
		append(keepalive, ta_kp)
		C.br_ssl_client_init_full(sc, xc, ta, ta_n)
	else
		C.br_ssl_client_init_full(sc, xc, nil, 0)
		noverify_x509(xc)
	end

	-- enforce RSA key size floor for server cert chains (default 2048).
	xc.min_rsa_size = (opt.min_rsa_size or 2048) / 8 - 128

	C.br_ssl_engine_set_buffer(eng, buf, BR_SSL_BUFSIZE_BIDI, 1)
	eng.version_min = C.BR_TLS12
	eng.version_max = C.BR_TLS12
	local suites = {
		BR_TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
		BR_TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
		BR_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
		BR_TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
		BR_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
		BR_TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
	}
	local n = #suites
	local suites_buf = new('uint16_t[?]', n)
	for i = 1, n do suites_buf[i - 1] = suites[i] end
	C.br_ssl_engine_set_suites(eng, suites_buf, n)

	local cert, key = cert_key_opt(opt)
	if cert then
		local chain, chain_n, chain_kp = load_cert_chain(cert)
		if not chain then return nil, chain_n end
		append(keepalive, chain_kp)

		local skdc, kt, key_kp = load_private_key(key)
		if not skdc then return nil, kt end
		append(keepalive, key_kp)

		if kt == BR_KEYTYPE_RSA then
			local sk = copy_rsa_sk(skdc.key.rsa, keepalive)
			C.br_ssl_client_set_single_rsa(sc, chain, chain_n,
				sk, C.br_rsa_pkcs1_sign_get_default())
		elseif kt == BR_KEYTYPE_EC then
			local sk = copy_ec_sk(skdc.key.ec, keepalive)
			C.br_ssl_client_set_single_ec(sc, chain, chain_n,
				sk, bor(BR_KEYTYPE_KEYX, BR_KEYTYPE_SIGN), 0,
				C.br_ec_get_default(), C.br_ecdsa_sign_asn1_get_default())
		end
	end

	return sc, eng, keepalive
end

local function make_server_ctx(chain, chain_n, sk, kt, issuer_kt, cache)
	local sc  = new('br_ssl_server_context')
	local buf = new('uint8_t[?]', BR_SSL_BUFSIZE_BIDI)
	local eng = cast('br_ssl_engine_context*', sc) -- eng is first field
	if kt == BR_KEYTYPE_RSA then
		C.br_ssl_server_init_full_rsa(sc, chain, chain_n, sk)
	else
		C.br_ssl_server_init_full_ec(sc, chain, chain_n, issuer_kt, sk)
	end
	C.br_ssl_engine_set_buffer(eng, buf, BR_SSL_BUFSIZE_BIDI, 1)
	eng.version_min = C.BR_TLS12
	eng.version_max = C.BR_TLS12
	if cache then
		sc.cache_vtable = cast(voidp, cache)
		assert(sc.cache_vtable[0] == cache[0].vtable)
	end
	local suites = {
		BR_TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
		BR_TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
		BR_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
		BR_TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
		BR_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
		BR_TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
	}
	local n = #suites
	local suites_buf = new('uint16_t[?]', n)
	for i = 1, n do suites_buf[i - 1] = suites[i] end
	C.br_ssl_engine_set_suites(eng, suites_buf, n)
	return sc, eng, {sc, buf}
end

--Push-pull engine driver ----------------------------------------------------

local _szp = new'size_t[1]' -- shared; safe because reads are captured before yields

-- Drive the engine until `target` state bits are set.
-- Returns true, or nil+err on error/closed.
local function engine_run(self, target)
	local eng = self.eng
	local tcp = self.tcp
	while true do
		local state = tonumber(C.br_ssl_engine_current_state(eng))
		if band(state, target) ~= 0 then
			return true
		end
		if band(state, BR_SSL_CLOSED) ~= 0 then
			local e = tonumber(eng.err)
			return nil, e == 0 and 'eof' or ssl_alert_error(e) or ssl_br_error(e)
		end
		if band(state, BR_SSL_SENDREC) ~= 0 then
			local buf = C.br_ssl_engine_sendrec_buf(eng, _szp)
			local n = tonumber(_szp[0])
			local ok, err = tcp:try_send(buf, n)
			if not ok then return nil, err end
			C.br_ssl_engine_sendrec_ack(eng, n)
		elseif band(state, BR_SSL_RECVREC) ~= 0 then
			local buf = C.br_ssl_engine_recvrec_buf(eng, _szp)
			local n = tonumber(_szp[0])
			local len, err = tcp:try_recv(buf, n)
			if not len or err == 'eof' then return nil, err end
			C.br_ssl_engine_recvrec_ack(eng, len)
		else
			return nil, 'ssl_stall'
		end
	end
end
jit.off(engine_run) --can call back into Lua through x509 noverify_end_chain_cb.

--Sockets --------------------------------------------------------------------

local stcp = {
	issocket     = true,
	istlssocket  = true,
	socktype     = 'tcp',
	debug_prefix = 'X',
	check_io     = check_io,
	checkp       = checkp,
	checknp      = checknp,
	protect      = protect,
	default_owner = 'current',
	setowner     = setowner,
}

function stcp:onclose(fn)
	after(self.tcp, '_after_close', fn)
end

function stcp:closed()
	return self.tcp.fd == -1
end

function stcp:try_shutdown(mode)
	if self.tcp.fd == -1 then return nil, 'closed' end
	return self.tcp:try_shutdown(mode)
end
stcp.shutdown = unprotect_io(stcp.try_shutdown)

function stcp:try_getopt (...) return self.tcp:try_getopt (...) end
function stcp:getopt     (...) return self.tcp:getopt     (...) end
function stcp:try_setopt (...) return self.tcp:try_setopt (...) end
function stcp:setopt     (...) return self.tcp:setopt     (...) end
function stcp:setexpires (...) return self.tcp:setexpires (...) end
function stcp:settimeout (...) return self.tcp:settimeout (...) end
function stcp:cancel_recv(...) return self.tcp:cancel_recv(...) end
function stcp:cancel_send(...) return self.tcp:cancel_send(...) end
function stcp:cancel     (...) return self.tcp:cancel     (...) end
function stcp:wait_job   (...) return self.tcp:wait_job   (...) end
function stcp:wait_until (...) return self.tcp:wait_until (...) end
function stcp:wait       (...) return self.tcp:wait       (...) end
function stcp:remote_addr(...) return self.tcp:remote_addr(...) end
function stcp:bound_addr (...) return self.tcp:bound_addr (...) end

function stcp:debug_stream(protocol_name)
	return tcp_class.debug(self, protocol_name or 'ssock')
end

-- Client sockets (connected TLS socket, both sides) -------------------------

local client_stcp = merge({type = 'client_tls_socket'}, stcp)

local function wrap_client_stcp(tcp, eng, keepalive)
	local s = object(client_stcp, {
		tcp        = tcp,
		eng        = eng,
		_keepalive = keepalive,
	})
	tcp.stcp = s --cross-ref
	return s
end

function _G.try_client_stcp(tcp, host, opt)
	opt = opt or empty
	local sc, eng, keepalive = make_client_ctx(opt)
	if not sc then return nil, eng end

	if C.br_ssl_client_reset(sc, host, 0) == 0 then
		return nil, 'ssl_client_reset_failed'
	end

	local s = wrap_client_stcp(tcp, eng, keepalive)
	live(s, 'tcp=%s', tcp)
	local ok, err = engine_run(s, bor(BR_SSL_SENDAPP, BR_SSL_RECVAPP))
	if not ok then
		live(s, nil)
		return nil, err
	end
	initowner(s)
	tcp:setowner(nil) --stcp owns it now
	return s
end
_G.client_stcp = unprotect_io(_G.try_client_stcp)

function client_stcp:try_close()
	if self.tcp.fd == -1 then
		--BearSSL doesn't malloc, so no cleanup needed if the fd is lost.
		return true
	end
	-- best-effort TLS close_notify
	C.br_ssl_engine_close(self.eng)
	while true do
		local state = tonumber(C.br_ssl_engine_current_state(self.eng))
		if band(state, BR_SSL_CLOSED) ~= 0 then break end
		if band(state, BR_SSL_SENDREC) ~= 0 then
			local buf = C.br_ssl_engine_sendrec_buf(self.eng, _szp)
			local n = tonumber(_szp[0])
			if not self.tcp:try_send(buf, n) then break end
			C.br_ssl_engine_sendrec_ack(self.eng, n)
		elseif band(state, BR_SSL_RECVREC) ~= 0 then
			local buf = C.br_ssl_engine_recvrec_buf(self.eng, _szp)
			local n = tonumber(_szp[0])
			local len, err = self.tcp:try_recv(buf, n)
			if not len or err == 'eof' then break end
			C.br_ssl_engine_recvrec_ack(self.eng, len)
		else
			break
		end
	end
	if self.owner then
		self.owner:disown(self)
	end
	live(self, nil)
	local ok, err = self.tcp:try_close()
	self.eng = nil
	self._keepalive = nil
	return ok, err
end

function client_stcp:try_recv(buf, sz)
	if self.tcp.fd == -1 then return nil, 'closed' end
	local ok, err = engine_run(self, BR_SSL_RECVAPP)
	if not ok then return err == 'eof' and 0 or nil, err end
	local app_buf = C.br_ssl_engine_recvapp_buf(self.eng, _szp)
	local n = min(sz, tonumber(_szp[0]))
	copy(buf, app_buf, n)
	C.br_ssl_engine_recvapp_ack(self.eng, n)
	return n
end

function client_stcp:try_send(buf, sz)
	if self.tcp.fd == -1 then return nil, 'closed' end
	sz = sz or #buf
	if sz == 0 then return true end --mask-out null-writes
	local bp = cast(u8p, buf)
	local sent = 0
	while sent < sz do
		local ok, err = engine_run(self, BR_SSL_SENDAPP)
		if not ok then return nil, err end
		local app_buf = C.br_ssl_engine_sendapp_buf(self.eng, _szp)
		local n = min(sz - sent, tonumber(_szp[0]))
		copy(app_buf, bp + sent, n)
		C.br_ssl_engine_sendapp_ack(self.eng, n)
		C.br_ssl_engine_flush(self.eng, 0)
		sent = sent + n
	end
	-- drain encrypted output to TCP; ignore EOF (data already accepted)
	local ok, err = engine_run(self, bor(BR_SSL_SENDAPP, BR_SSL_RECVAPP))
	if not ok then return nil, err end
	return true
end

client_stcp.try_recvn   = tcp_class.try_recvn
client_stcp.try_recvall = tcp_class.try_recvall
client_stcp.close       = unprotect_io(client_stcp.try_close)
client_stcp.recv        = unprotect_io(client_stcp.try_recv)
client_stcp.send        = unprotect_io(client_stcp.try_send)
client_stcp.recvn       = unprotect_io(client_stcp.try_recvn)
client_stcp.recvall     = unprotect_io(client_stcp.try_recvall)
client_stcp.try_readn   = client_stcp.try_recvn
client_stcp.readn       = client_stcp.recvn
client_stcp.try_read    = client_stcp.try_recv
client_stcp.read        = client_stcp.recv
client_stcp.try_write   = client_stcp.try_send
client_stcp.write       = client_stcp.send

-- Server (listening) socket -------------------------------------------------

local server_stcp = merge({type = 'server_tls_socket'}, stcp)

function _G.try_server_stcp(tcp, opt)
	opt = opt or empty
	local cert, key = cert_key_opt(opt, true)
	local keepalive = {}
	local chain, chain_n, chain_kp = load_cert_chain(cert)
	assert(chain, chain_n)
	append(keepalive, chain_kp)
	local skdc, kt, key_kp = load_private_key(key)
	assert(skdc, kt)
	append(keepalive, key_kp)
	local sk
	if kt == BR_KEYTYPE_RSA then
		sk = copy_rsa_sk(skdc.key.rsa, keepalive)
	elseif kt == BR_KEYTYPE_EC then
		sk = copy_ec_sk(skdc.key.ec, keepalive)
	else
		error('unsupported_key_type_'..kt)
	end
	local cache, cache_buf
	local cache_entries = opt.session_cache_entries or 1024
	if cache_entries > 0 then
		local bufsize = cache_entries * 100 -- BearSSL uses 100 bytes per entry
		cache = new'br_ssl_session_cache_lru[1]'
		cache_buf = u8a(bufsize)
		C.br_ssl_session_cache_lru_init(cache, cache_buf, bufsize)
		add(keepalive, cache)
		add(keepalive, cache_buf)
	end
	local issuer_kt = opt.cert_issuer_rsa and BR_KEYTYPE_RSA or BR_KEYTYPE_EC
	local s = object(server_stcp, {
		tcp = tcp,
		_chain = chain, _chain_n = chain_n,
		_sk = sk, _kt = kt, _issuer_kt = issuer_kt,
		_cache = cache,
		_keepalive = keepalive,
	})
	tcp.stcp = s --cross-ref for client socket tracking
	initowner(s)
	tcp:setowner(nil) --stcp owns it now
	live(s, 'tcp=%s', tcp)
	return s
end
_G.server_stcp = unprotect_io(_G.try_server_stcp)

function server_stcp:try_close()
	if self.tcp.fd == -1 then return true end
	if self.owner then
		self.owner:disown(self)
	end
	live(self, nil)
	--NOTE: normally we should iterate tcp._sockets[s] and call s.stcp:close() on
	--each which sends TLS close_notify, but that calls send() and recv() and
	--we want to be able to call this from a different thread precisely so we can
	--interrupt all the threads waiting on these sockets. so we force-close instead.
	local ok, err = self.tcp:try_close()
	self.eng = nil
	self._keepalive = nil
	return ok, err
end
server_stcp.close = unprotect_io(server_stcp.try_close)

function server_stcp:try_accept(opt, timeout)
	if self.tcp.fd == -1 then return nil, 'closed' end
	local ctcp, err, retry = self.tcp:try_accept(opt, timeout)
	if not ctcp then return nil, err, retry end

	local sc, eng, keepalive = make_server_ctx(
		self._chain, self._chain_n, self._sk, self._kt, self._issuer_kt, self._cache)

	if C.br_ssl_server_reset(sc) == 0 then
		ctcp:try_close()
		return nil, 'ssl_server_reset_failed'
	end

	local s = wrap_client_stcp(ctcp, eng, keepalive)
	s.listen_socket = self
	local ok, err = engine_run(s, bor(BR_SSL_SENDAPP, BR_SSL_RECVAPP))
	if not ok then
		s:try_close()
		return nil, err, true --retriable
	end

	live(s, 'accepted %s.%d tcp=%s clients:%d',
		self, ctcp.i, ctcp, self.tcp._sockets_n)
	initowner(s)
	ctcp:setowner(nil) --stcp owns it now

	local sn = sc.eng.server_name
	s.server_name = sn[0] ~= 0 and str(sn) or nil

	return s
end
server_stcp.accept = unprotect_io(server_stcp.try_accept)
