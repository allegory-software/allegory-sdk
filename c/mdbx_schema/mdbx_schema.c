/*

	Schema encoding and decoding for LMDB/LibMDBX.
	Written by Cosmin Apreutesei. Public Domain.

	Builds with gcc -O2 -fno-strict-aliasing -Wall

	Schema means partitioning records (keys and values) into predefined columns,
	which allows multi-key ordering as well as efficient storage and retrieval
	of structured values.

	Data types:
		- ints: 8, 16, 32 bit, signed/unsigned
		- floats: 32 and 64 bit
		- arrays: fixed-size and variable-size
		- nullable keys and values

	Keys:
		- composite keys with per-field ascending/descending order.

	Limitations:
		- varsize keys are 0-terminated so they are not 8-bit clean!

*/

#include <stdint.h>
#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <limits.h>
#include <mdbx.h>

#define INLINE static inline __attribute__((always_inline))

typedef int8_t   i8;
typedef int16_t  i16;
typedef int32_t  i32;
typedef uint8_t  bool8;
typedef uint8_t  u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef uint64_t u64;
typedef float    f32;
typedef double   f64;

int mdbx_cursor_has_txn(const MDBX_cursor *cursor) {
	return mdbx_cursor_txn(cursor) != 0;
}

double mdbx_txn_id_double(const MDBX_txn *txn) {
	return (double)mdbx_txn_id(txn);
}

int mdbx_dbi_sequence_double(MDBX_txn *txn, MDBX_dbi dbi, double *result,
	u64 increment
) {
	u64 seq;
	int rc = mdbx_dbi_sequence(txn, dbi, &seq, increment);
	*result = (double)seq;
	return rc;
}

// API -----------------------------------------------------------------------

typedef enum schema_col_type {
	schema_col_type_i8,
	schema_col_type_i16,
	schema_col_type_i32,
	schema_col_type_u8,
	schema_col_type_u16,
	schema_col_type_u32,
	schema_col_type_f32,
	schema_col_type_f64,
} schema_col_type;

/*

In-memory layout:
 - key records: fixed_size_cols, first_varsize_col, varoffset_cols (varsize or not).
 - val records: null_bits, dyn_offsets, fixed_size_cols, first_varsize_col, varsize_cols.

fixed_size means scalar (len=1) or fixed-size array. The opposite
is varsize for which len in the definition means max len. Varsize values are
zero-terminated inside key records, so they are not 8-bit clean except the
last column if it's ascending. In value records an offset table is used instead
so all columns are 8-bit clean. The zero terminator is skipped for values with
len = max len so the value never takes more space than len. The offset table
is an array of u8, u16 or i32. In value records, all varsize columns are after
all fixed_size columns to minimize the offset table since column order doesn't
matter there.

Key records are encoded differently than val records because keys are encoded
for lexicographic binary ordering, which means: no nulls, no offset table for
varsize fields, instead we use 0 as separator, so no 8-bit clean varsize
keys either, value bits are negated for descending order, ints and floats are
encoded so that byte order matches numeric order.

*/
typedef struct schema_col {
	int   len; // for varsize cols it means max len.
	bool8 fixed_size; // fixed-size array or varsize.
	bool8 descending; // for key cols
	bool8 nullable; // for key cols
	u8    type; // schema_col_type
	u8    elem_size_shift; // computed
	bool8 fixed_offset; // computed: decides what the .offset field means
	int   offset; // computed: a static offset or the offset where the dyn. offset is.
} schema_col;

typedef struct schema_table {
	schema_col* key_cols;
	schema_col* val_cols;
	u16  n_key_cols;
	u16  n_val_cols;
	u8   dyn_offset_size; // 1,2,4
} schema_table;

int schema_key_cmp_rec(const MDBX_val* a, const MDBX_val* b);

int schema_get_key(schema_table* tbl, int col_i,
	void* rec, int rec_size,
	u8* out, int out_size,
	u8** pout,
	u8** pp
);
int schema_get_key_rec(schema_table* tbl, int col_i,
	const MDBX_val* rec,
	u8* out, int out_size,
	u8** pout,
	u8** pp
);
int schema_val_is_null(schema_table* tbl, int col_i,
	const void* rec, int rec_size
);
int schema_key_has_null(schema_table* tbl, void* rec);
int schema_get_val(schema_table* tbl, int col_i,
	void* rec, int rec_size,
	u8** pout
);
int schema_get_val_rec(schema_table* tbl, int col_i,
	const MDBX_val* rec,
	u8** pout
);
void schema_key_add(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, int val_len,
	u8** pp
);
int schema_key_size(const void* rec, u8** pp);
void schema_key_add_start(void* rec, int offset, u8** pp);
void schema_key_pad(const void* data, int size, void* out, int out_size);
int schema_key_add_key_rec(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, u8** pp,
	schema_table* src_tbl, int src_col_i, const MDBX_val* src_rec
);
int schema_key_add_val_rec(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, u8** pp,
	schema_table* src_tbl, int src_col_i, const MDBX_val* src_rec
);
int schema_key_reencode(
	schema_table* fk_ix, schema_table* parent,
	void* fk_key, int fk_key_size,
	void* out, int out_size
);
int schema_key_reencode_rec(
	schema_table* fk_ix, schema_table* parent,
	const MDBX_val* fk_key, MDBX_val* out,
	void* out_data, int out_size
);
void schema_val_add_start(schema_table* tbl,
	void* rec, int rec_buf_size,
	u8** pp
);
void schema_val_add(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, int val_len,
	u8** pp
);

// implementation ------------------------------------------------------------

INLINE schema_col* try_get_key_col(schema_table* tbl, int col_i) {
	int n_cols = tbl->n_key_cols;
	schema_col* cols = tbl->key_cols;
	return col_i >= 0 && col_i < n_cols ? &cols[col_i] : 0;
}

int schema_key_cmp_rec(const MDBX_val* a, const MDBX_val* b) {
	size_t size = a->iov_len < b->iov_len ? a->iov_len : b->iov_len;
	int c = memcmp(a->iov_base, b->iov_base, size);
	if (c == 0)
		return (a->iov_len > b->iov_len) - (a->iov_len < b->iov_len);
	return c;
}

INLINE schema_col* get_key_col(schema_table* tbl, int col_i) {
	schema_col* col = try_get_key_col(tbl, col_i);
	assert(col);
	return col;
}
INLINE schema_col* try_get_val_col(schema_table* tbl, int col_i) {
	int n_cols = tbl->n_val_cols;
	schema_col* cols = tbl->val_cols;
	return col_i >= 0 && col_i < n_cols ? &cols[col_i] : 0;
}
INLINE schema_col* get_val_col(schema_table* tbl, int col_i) {
	schema_col* col = try_get_val_col(tbl, col_i);
	assert(col);
	return col;
}
INLINE schema_col* try_get_col(schema_table* tbl, int is_key, int col_i) {
	return is_key ? try_get_key_col(tbl, col_i) : try_get_val_col(tbl, col_i);
}

static void decode_u16(u16* d, u16* s, int len) {
	while (len--)
		*d++ = __builtin_bswap16(*s++);
}
static void encode_u16(u16* d, u16* s, int len) {
	while (len--)
		*d++ = __builtin_bswap16(*s++);
}
static void decode_u32(u32* d, u32* s, int len) {
	while (len--)
		*d++ = __builtin_bswap32(*s++);
}
static void encode_u32(u32* d, u32* s, int len) {
	while (len--)
		*d++ = __builtin_bswap32(*s++);
}
static void decode_i8(u8* d, u8* s, int len) {
	while (len--)
		*d++ = *s++ ^ 0x80;
}
static void encode_i8(u8* d, u8* s, int len) {
	while (len--)
		*d++ = *s++ ^ 0x80;
}
static void decode_i16(u16* d, u16* s, int len) {
	while (len--)
		*d++ = __builtin_bswap16(*s++) ^ 0x8000;
}
static void encode_i16(u16* d, u16* s, int len) {
	while (len--)
		*d++ = __builtin_bswap16(*s++ ^ 0x8000);
}
static void decode_i32(u32* d, u32* s, int len) {
	while (len--)
		*d++ = __builtin_bswap32(*s++) ^ 0x80000000;
}
static void encode_i32(u32* d, u32* s, int len) {
	while (len--)
		*d++ = __builtin_bswap32(*s++ ^ 0x80000000);
}
static void decode_f32(u32* d, u32* s, int len) {
	while (len--) {
		u32 v = __builtin_bswap32(*s++);
		*d++ = v & 0x80000000 ? v ^ 0x80000000 : ~v;
	}
}
static void encode_f32(u32* d, u32* s, int len) {
	while (len--) {
		u32 v = *s++;
		v = v & 0x80000000 ? ~v : v ^ 0x80000000;
		*d++ = __builtin_bswap32(v);
	}
}
static void decode_f64(u64* d, u64* s, int len) {
	while (len--) {
		u64 v = __builtin_bswap64(*s++);
		*d++ = v & 0x8000000000000000ULL ? v ^ 0x8000000000000000ULL : ~v;
	}
}
static void encode_f64(u64* d, u64* s, int len) {
	while (len--) {
		u64 v = *s++;
		v = v & 0x8000000000000000ULL ? ~v : v ^ 0x8000000000000000ULL;
		*d++ = __builtin_bswap64(v);
	}
}

typedef void (*encdec_t)(void* d, void* s, int len);

/* NOTE: must match schema_col_type enum order! */
static encdec_t decoders[] = {
	(encdec_t)&decode_i8,
	(encdec_t)&decode_i16,
	(encdec_t)&decode_i32,
	(encdec_t)(0),
	(encdec_t)&decode_u16,
	(encdec_t)&decode_u32,
	(encdec_t)&decode_f32,
	(encdec_t)&decode_f64,
};

/* NOTE: must match schema_col_type enum order! */
static encdec_t encoders[] = {
	(encdec_t)&encode_i8,
	(encdec_t)&encode_i16,
	(encdec_t)&encode_i32,
	(encdec_t)(0),
	(encdec_t)&encode_u16,
	(encdec_t)&encode_u32,
	(encdec_t)&encode_f32,
	(encdec_t)&encode_f64,
};

INLINE void invert_bits(void* d, void* s, int len) {
	for (int i = 0; i < len; i++)
		((u8*)d)[i] = ~((u8*)s)[i];
}

INLINE int val_is_null(int col_i, const void* rec, int rec_size) {
	int byte_i = col_i >> 3;
	int bit_i  = col_i & 7;
	int mask   = 1 << bit_i;
	const u8* p = rec;
	assert(byte_i < rec_size);
	return (p[byte_i] & mask) != 0;
}

INLINE void val_set_null(int col_i, int is_null, void* rec, int rec_size) {
	int byte_i = col_i >> 3;
	int bit_i  = col_i & 7;
	int mask   = 1 << bit_i;
	u8* p = rec;
	assert(byte_i < rec_size);
	if (is_null)
		p[byte_i] = p[byte_i] | mask;
	else
		p[byte_i] = p[byte_i] & ~mask;
}

// scan for terminator up-to size
static int scan_end(schema_col* col, void* p, int len, int encoded) {
	int ss = col->elem_size_shift;
	if (ss == 0) {
		u8 t = encoded && col->descending ? 0xff : 0;
		void *r = memchr(p, t, len);
		return r ? r - p : len;
	} else if (ss == 1) {
		u16 t = encoded && col->descending ? 0xffff : 0;
		u16* q = p;
		for (int i = 0; i < len; i++)
			if (q[i] == t)
				return i;
	} else if (ss == 2) {
		u32 t = encoded && col->descending ? 0xffffffff : 0;
		u32* q = p;
		for (int i = 0; i < len; i++)
			if (q[i] == t)
				return i;
	} else if (ss == 3) {
		u64 t = encoded && col->descending ? 0xffffffffffffffffULL : 0;
		u64* q = p;
		for (int i = 0; i < len; i++)
			if (q[i] == t)
				return i;
	}
	return len;
}

INLINE int key_is_null(schema_col* col, void* p) {
	return col->nullable && *(u8*)p == (col->descending ? 0xff : 0);
}

INLINE int get_dyn_offset(schema_table* tbl, schema_col* col,
	void* rec, int rec_size
) {
	assert(col->offset + tbl->dyn_offset_size <= rec_size);
	     if (tbl->dyn_offset_size == 1) return *(u8* )(rec + col->offset);
	else if (tbl->dyn_offset_size == 2) return *(u16*)(rec + col->offset);
	else if (tbl->dyn_offset_size == 4) return *(int*)(rec + col->offset);
	else assert(0);
}

INLINE void set_dyn_offset(schema_table* tbl, schema_col* col, int offset,
	void* rec, int rec_size
) {
	assert(col->offset + tbl->dyn_offset_size <= rec_size);
	     if (tbl->dyn_offset_size == 1) *(u8* )(rec + col->offset) = offset;
	else if (tbl->dyn_offset_size == 2) *(u16*)(rec + col->offset) = offset;
	else if (tbl->dyn_offset_size == 4) *(int*)(rec + col->offset) = offset;
}

INLINE int get_key_mem_size(schema_table* tbl, schema_col* col,
	void *p
) {
	int ss = col->elem_size_shift;
	if (col->fixed_size) {
		return (col->len << ss) + col->nullable;
	} else if (key_is_null(col, p)) {
		return col->nullable;
	} else {
		return ((scan_end(col, p + col->nullable, col->len, 1) + 1) << ss)
			+ col->nullable; // 0-terminated
	}
}

INLINE void* get_key_ptr(schema_table* tbl, int col_i, schema_col* col,
	void* rec
) {
	if (col->fixed_offset) {
		return rec + col->offset;
	} else { // key col at dyn. offset
		void* p = rec;
		for (int col_j = 0; col_j < col_i; col_j++)
			p += get_key_mem_size(tbl, &tbl->key_cols[col_j], p);
		return p;
	}
}

INLINE void* get_val_ptr(schema_table* tbl, int col_i, schema_col* col,
	void* rec, int rec_size
) {
	if (col->fixed_offset) {
		return rec + col->offset;
	} else { // val col at dyn. offset
		return rec + get_dyn_offset(tbl, col, rec, rec_size);
	}
}

INLINE int get_key_len(schema_table* tbl, int col_i, schema_col* col,
	void* rec, void* p, int rec_size
) {
	if (col->fixed_size) {
		return key_is_null(col, p) ? -1 : col->len;
	} else { // varsize key col
		if (key_is_null(col, p))
			return -1;
		return scan_end(col, p + col->nullable, col->len, 1);
	}
}

INLINE int get_val_len(schema_table* tbl, int col_i, schema_col* col,
	void* rec, void* p, int rec_size
) {
	if (col->fixed_size) {
		return col->len;
	} else { // varsize val col
		int offset = col->fixed_offset
			? col->offset
			: get_dyn_offset(tbl, col, rec, rec_size);
		if (col_i < tbl->n_val_cols-1) { // non-last col
			schema_col* next_col = &tbl->val_cols[col_i+1];
			int next_offset = get_dyn_offset(tbl, next_col, rec, rec_size);
			return (next_offset - offset) >> col->elem_size_shift;
		} else { // last col
			return (rec_size - offset) >> col->elem_size_shift;
		}
	}
}

int schema_val_is_null(schema_table* tbl, int col_i,
	const void* rec, int rec_size
) {
	assert(get_val_col(tbl, col_i));
	return val_is_null(col_i, rec, rec_size);
}

// true if any key col is null (key cols have no offset table, so each one
// is found by stepping over the ones before it).
int schema_key_has_null(schema_table* tbl, void* rec) {
	u8* p = rec;
	for (int col_i = 0; col_i < tbl->n_key_cols; col_i++) {
		schema_col* col = &tbl->key_cols[col_i];
		if (key_is_null(col, p))
			return 1;
		p += get_key_mem_size(tbl, col, p);
	}
	return 0;
}

int schema_get_key(schema_table* tbl, int col_i,
	void* rec, int rec_size,
	u8* out, int out_size,
	u8** pout,
	u8** pp
) {
	schema_col* col = get_key_col(tbl, col_i);
	int ss = col->elem_size_shift;
	void* p = pp && *pp ? *pp : get_key_ptr(tbl, col_i, col, rec);
	int in_len = get_key_len(tbl, col_i, col, rec, p, rec_size);
	int mem_size = get_key_mem_size(tbl, col, p);
	if (in_len == -1) {
		*pout = 0;
		if (pp)
			*pp = p + mem_size;
		return -1;
	}
	int in_size = in_len << ss;
	assert(out_size >= in_size);
	void* in = p + col->nullable;
	*pout = in;
	if (col->descending) { // invert bits
		invert_bits(out, in, in_size);
		in = out; // decode in place then.
		*pout = out;
	}
	encdec_t decode = decoders[col->type];
	if (decode) {
		decode(out, in, in_len);
		*pout = out;
	}
	if (pp)
		*pp = p + mem_size;
	return in_size >> ss;
}

int schema_get_val(schema_table* tbl, int col_i,
	void* rec, int rec_size,
	u8** pout
) {
	schema_col* col = get_val_col(tbl, col_i);
	if (val_is_null(col_i, rec, rec_size))
		return -1; // signal null
	int ss = col->elem_size_shift;
	void* p = get_val_ptr(tbl, col_i, col, rec, rec_size);
	int in_size = get_val_len(tbl, col_i, col, rec, p, rec_size) << ss;
	if (pout)
		*pout = p;
	return in_size >> ss;
}

int schema_get_key_rec(schema_table* tbl, int col_i,
	const MDBX_val* rec,
	u8* out, int out_size,
	u8** pout,
	u8** pp
) {
	return schema_get_key(tbl, col_i,
		rec->iov_base, (int)rec->iov_len,
		out, out_size, pout, pp);
}

int schema_get_val_rec(schema_table* tbl, int col_i,
	const MDBX_val* rec,
	u8** pout
) {
	return schema_get_val(tbl, col_i,
		rec->iov_base, (int)rec->iov_len, pout);
}

// update the dyn. offset of the next col if there is one.
INLINE void set_next_dyn_offset(schema_table* tbl, int col_i,
	void* p, int mem_size,
	void* rec, int rec_size
) {
	if (col_i == tbl->n_val_cols-1)
		return;
	schema_col* next_col = &tbl->val_cols[col_i+1];
	if (next_col->fixed_offset)
		return;
	set_dyn_offset(tbl, next_col, p + mem_size - rec, rec, rec_size);
}

void schema_key_add(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, int val_len,
	u8** pp
) {
	schema_col* col = get_key_col(tbl, col_i);
	int ss = col->elem_size_shift;
	void* p = *pp;
	void* data = p + col->nullable;

	if (val_len == -1) { // null key
		assert(col->nullable);
		int mem_size = col->fixed_size ? ((col->len << ss) + col->nullable) : col->nullable;
		assert(p + mem_size <= rec + rec_buf_size);
		memset(p, 0, mem_size);
		if (col->descending)
			invert_bits(p, p, mem_size);
		*pp = p + mem_size;
		return;
	}

	// check val_len and the nozero invariant for varsize keys.
	assert(val_len >= 0 && val_len <= col->len);
	if (!col->fixed_size)
		assert(scan_end(col, p, val_len, 0) == val_len);
	int val_size = val_len << ss;

	// figure out mem_size (size of this value in memory) and check it.
	int payload_mem_size = col->fixed_size ? col->len << ss : val_size + (1 << ss);
	int mem_size = payload_mem_size + col->nullable;
	assert(p + mem_size <= rec + rec_buf_size);

	if (col->nullable) {
		memmove(data, p, val_size);
		*(u8*)p = 1;
	}

	// zero-pad (fixed_size), or write terminator (varsize).
	memset(data + val_size, 0, payload_mem_size - val_size);

	// encode for lexicographic binary ordering.
	encdec_t encode = encoders[col->type];
	if (encode)
		encode(data, data, val_len);

	// descending col: invert bits (including padding or terminator).
	if (col->descending)
		invert_bits(p, p, mem_size);

	// advance data pointer.
	*pp = p + mem_size;
}

int schema_key_size(const void* rec, u8** pp) {
	return *pp - (const u8*)rec;
}

void schema_key_add_start(void* rec, int offset, u8** pp) {
	*pp = (u8*)rec + offset;
}

void schema_key_pad(const void* data, int size, void* out, int out_size) {
	if (data != out)
		memmove(out, data, size);
	memset((u8*)out + size, 0, out_size - size);
}

int schema_key_add_key_rec(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, u8** pp,
	schema_table* src_tbl, int src_col_i, const MDBX_val* src_rec
) {
	u8* p = *pp;
	u8* data;
	int len = schema_get_key_rec(src_tbl, src_col_i, src_rec,
		p, rec_buf_size - (p - (u8*)rec), &data, 0);
	if (len < 0)
		return 0;
	int size = len << get_key_col(src_tbl, src_col_i)->elem_size_shift;
	if (data != p)
		memmove(p, data, size);
	schema_key_add(tbl, col_i, rec, rec_buf_size, len, pp);
	return 1;
}

int schema_key_add_val_rec(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, u8** pp,
	schema_table* src_tbl, int src_col_i, const MDBX_val* src_rec
) {
	u8* p = *pp;
	u8* data;
	int len = schema_get_val_rec(src_tbl, src_col_i, src_rec, &data);
	if (len < 0)
		return 0;
	int size = len << get_val_col(src_tbl, src_col_i)->elem_size_shift;
	if (data != p)
		memmove(p, data, size);
	schema_key_add(tbl, col_i, rec, rec_buf_size, len, pp);
	return 1;
}

/*
Re-encode a key form one format to another. Used for converting
FK index key prefix -> parent PK and parent PK -> FK index key prefix
when the FK contains nullable columns so the raw FK key differs from PK key.
Returns -1 if any source key part is null (no parent row to reference).
*/
int schema_key_reencode(
	schema_table* fk_ix, schema_table* parent,
	void* fk_key, int fk_key_size,
	void* out, int out_size
) {
	int n = fk_ix->n_key_cols < parent->n_key_cols
		? fk_ix->n_key_cols : parent->n_key_cols;
	u8* pp_in = fk_key;
	u8* pp_out = out;
	for (int i = 0; i < n; i++) {
		u8* pout;
		int len = schema_get_key(fk_ix, i, fk_key, fk_key_size,
			pp_out, out_size - (pp_out - (u8*)out), &pout, &pp_in);
		if (len == -1)
			return -1; // null FK component: no parent reference
		schema_col* col = get_key_col(fk_ix, i);
		int val_size = len << col->elem_size_shift;
		if (pout != pp_out) // schema_get_key didn't write into out
			memmove(pp_out, pout, val_size);
		schema_key_add(parent, i, out, out_size, len, &pp_out);
	}
	return pp_out - (u8*)out;
}

int schema_key_reencode_rec(
	schema_table* fk_ix, schema_table* parent,
	const MDBX_val* fk_key, MDBX_val* out,
	void* out_data, int out_size
) {
	int size = schema_key_reencode(fk_ix, parent,
		fk_key->iov_base, (int)fk_key->iov_len, out_data, out_size);
	if (size < 0)
		return 0;
	out->iov_base = out_data;
	out->iov_len = size;
	return 1;
}

void schema_val_add_start(schema_table* tbl,
	void* rec, int rec_buf_size,
	u8** pp
) {
	schema_col* col = get_val_col(tbl, 0);
	assert(col->fixed_offset);
	*pp = rec + col->offset;
}

void schema_val_add(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, int val_len,
	u8** pp
) {
	schema_col* col = get_val_col(tbl, col_i);
	int ss = col->elem_size_shift;

	val_set_null(col_i, val_len == -1, rec, rec_buf_size);

	if (val_len == -1)
		val_len = 0;

	void* p = get_val_ptr(tbl, col_i, col, rec, rec_buf_size);

	assert(val_len >= 0 && val_len <= col->len);
	int val_size = val_len << ss;

	// figure out mem_size (size of this value in memory) and check it.
	int mem_size = col->fixed_size ? col->len << ss : val_size;
	assert(p + mem_size <= rec + rec_buf_size);

	// adjust rec before writing the data.
	if (col->fixed_size) {
		// fixed_size: zero-pad
		memset(p + val_size, 0, mem_size - val_size);
	} else {
		// varsize: set offset of next col for next add.
		set_next_dyn_offset(tbl, col_i, p, mem_size, rec, rec_buf_size);
	}

	// advance data pointer.
	*pp = p + mem_size;
}

/*
Sort an array of 4-byte big-endian u32 elements using LSD radix sort over
bytes 3, 2, 1, 0, skipping passes where all records have the same byte.
Descending u32 keys are encoded by inverting the bytes so sorting the
encoded bytes still matches memcmp() and MDBX raw key order.
tmp must be a distinct n * 4 byte scratch buffer.
*/
void schema_sort_u32_be(void* buf, void* tmp, size_t n) {
	if (n < 2)
		return;

	u8* src = buf;
	u8* dst = tmp;
	size_t pos[256];

	for (int byte_i = 3; byte_i >= 0; byte_i--) {
		memset(pos, 0, sizeof(pos));
		for (size_t i = 0; i < n; i++)
			pos[src[i * 4 + byte_i]]++;

		size_t sum = 0;
		int used = 0;
		for (int i = 0; i < 256; i++) {
			size_t count = pos[i];
			pos[i] = sum;
			sum += count;
			used += count != 0;
		}
		if (used == 1)
			continue;

		for (size_t i = 0; i < n; i++) {
			u8* s = src + i * 4;
			u8* d = dst + pos[s[byte_i]]++ * 4;
			memcpy(d, s, 4);
		}

		u8* p = src;
		src = dst;
		dst = p;
	}

	if (src != (u8*)buf)
		memcpy(buf, src, n * 4);
}

// binsearch in sorted u32-BE array. Returns the index if found, -1 if not.
int schema_find_u32_be(const u32* buf, size_t n, const u32* key) {
	u32 k = __builtin_bswap32(*key);
	size_t lo = 0;
	size_t hi = n;
	while (lo < hi) {
		size_t mid = lo + ((hi - lo) >> 1);
		u32 v = __builtin_bswap32(buf[mid]);
		if (v < k)
			lo = mid + 1;
		else
			hi = mid;
	}
	return (lo < n && __builtin_bswap32(buf[lo]) == k) ? (int)lo : -1;
}

// row changes mmaped shared ring buffer -------------------------------------

// Offsets are absolute positions in file (writers only increase it).
// offset % capacity is the position in the ring buffer.
typedef struct schema_row_changes_header {
	u64 capacity;       // ring buffer size in bytes, after the header page
	u64 retained_start; // offset of the oldest batch still in the buffer
	u64 published_end;  // offset after the newest published batch
	u64 wake;           // nothing reads it; writers write it to wake inotify
} schema_row_changes_header;

typedef struct schema_row_changes_writer {
	schema_row_changes_header* header; // header page of the changes file
	u8* data;  // the ring, mapped twice in a row so a batch can cross its end
	u64 start; // offset of the batch that the current txn is writing
	u32 size;  // size of that batch so far: header and rows
} schema_row_changes_writer;

typedef struct schema_row_changes_reader {
	const schema_row_changes_header* header; // header page of the file
	const u8* data;  // the ring buffer, mapped twice in a row
	u64 offset;      // offset of the next batch to read
	u64 prev_txn_id; // id of the last returned batch, or since_txn_id
	u32 size;        // buffer size needed when next() returns -1
	double txn_id;   // id of the batch returned by next()
} schema_row_changes_reader;

#define CHANGES_BATCH_HEADER_SIZE 12 // size u32, txn_id u64
#define CHANGES_ROW_HEADER_SIZE 4 // table_size u16, key_size u16

INLINE u64 changes_load(const u64* p) {
	return __atomic_load_n(p, __ATOMIC_SEQ_CST);
}

INLINE void changes_store(u64* p, u64 value) {
	__atomic_store_n(p, value, __ATOMIC_SEQ_CST);
}

INLINE u64 changes_align(u64 size) {
	return (size + 7) & ~7ULL;
}

// The space for a batch is its size plus 4 bytes at the end that hold the
// size again, so that a reader can walk the ring backward, rounded up to 8
// bytes.
INLINE u64 changes_slot_size(u64 size) {
	return changes_align(size + 4);
}

INLINE u32 changes_size(const u8* data) {
	u32 size;
	memcpy(&size, data, sizeof(size));
	return size;
}

void schema_row_changes_begin(schema_row_changes_writer* writer,
	schema_row_changes_header* header, void* data
) {
	writer->header = header;
	writer->data = data;
	writer->start = changes_load(&header->published_end);
	writer->size = CHANGES_BATCH_HEADER_SIZE;
}

// Make room for a batch of `size` bytes at writer->start by dropping the
// oldest batches.
static void changes_reserve(schema_row_changes_writer* writer, u64 size) {
	schema_row_changes_header* header = writer->header;
	u64 retained_start = changes_load(&header->retained_start);
	u64 start = retained_start;
	u64 end = writer->start + changes_slot_size(size);
	u64 capacity = header->capacity;
	while (end - start > capacity) {
		assert(start < writer->start);
		u64 batch_size = changes_size(writer->data + start % capacity);
		assert(batch_size >= CHANGES_BATCH_HEADER_SIZE
			&& batch_size <= capacity);
		start += changes_slot_size(batch_size);
	}
	if (start != retained_start)
		changes_store(&header->retained_start, start);
}

int schema_row_changes_add(schema_row_changes_writer* writer,
	const void* table, u16 table_size, const void* key, u16 key_size
) {
	u64 size = (u64)writer->size + CHANGES_ROW_HEADER_SIZE
		+ table_size + key_size;
	u64 capacity = writer->header->capacity;
	int overflow;
	// If the row fits in the ring, append it to the batch. Otherwise only add
	// its size, so that publish() sees that the batch is too large, and
	// report the overflow for the first row that doesn't fit.
	if (changes_slot_size(size) <= capacity) {
		changes_reserve(writer, size);
		u8* data = writer->data + writer->start % capacity + writer->size;
		memcpy(data, &table_size, 2);
		memcpy(data + 2, &key_size, 2);
		memcpy(data + 4, table, table_size);
		memcpy(data + 4 + table_size, key, key_size);
		overflow = 0;
	} else {
		overflow = changes_slot_size(writer->size) <= capacity;
		// Stop at capacity + 1 so that the size can't wrap around u32.
		size = capacity + 1;
	}
	writer->size = (u32)size;
	return overflow;
}

void schema_row_changes_publish(schema_row_changes_writer* writer,
	const MDBX_txn* txn
) {
	u64 txn_id = mdbx_txn_id(txn);
	u64 capacity = writer->header->capacity;
	// If the batch doesn't fit in the ring, publish nothing. Readers then see
	// that this txn's id has no batch.
	u64 slot_size = changes_slot_size(writer->size);
	if (slot_size > capacity)
		return;
	// Write the header and the size at the end, then advance published_end so
	// that readers see the batch.
	changes_reserve(writer, writer->size);
	u8* data = writer->data + writer->start % capacity;
	memcpy(data, &writer->size, 4);
	memcpy(data + 4, &txn_id, 8);
	memcpy(data + slot_size - 4, &writer->size, 4);
	changes_store(&writer->header->published_end,
		writer->start + slot_size);
}

void schema_row_changes_reader_init(schema_row_changes_reader* r,
	const schema_row_changes_header* header, const void* data,
	u64 since_txn_id
) {
	memset(r, 0, sizeof(*r));
	r->header = header;
	r->data = data;
	r->offset = changes_load(&header->published_end);
	r->prev_txn_id = since_txn_id;
	// Walk back from the newest batch to the first batch after since_txn_id.
	// Stop early if a writer overwrote the batch before r->offset; next()
	// then sees the missing ids.
	u64 capacity = header->capacity;
	while (r->offset > changes_load(&header->retained_start)) {
		u32 size = changes_size(r->data + (r->offset - 4) % capacity);
		u64 batch_offset = r->offset - changes_slot_size(size);
		u64 txn_id;
		memcpy(&txn_id, r->data + (batch_offset + 4) % capacity, 8);
		__atomic_thread_fence(__ATOMIC_SEQ_CST);
		if (r->offset <= changes_load(&header->retained_start))
			break;
		assert(size >= CHANGES_BATCH_HEADER_SIZE && size <= capacity);
		if (txn_id <= since_txn_id)
			break;
		r->offset = batch_offset;
	}
}

// Called when no more batches are visible to the caller's read snapshot.
// Every writer publishes its batch before it commits, so if the snapshot's
// txn id is newer than the last batch, the txns in between published none.
static int changes_end(schema_row_changes_reader* r, u64 max_txn_id) {
	if (max_txn_id <= r->prev_txn_id)
		return 0;
	r->prev_txn_id = max_txn_id;
	r->txn_id = (double)max_txn_id;
	return 3;
}

// Returns 1 when it copied a batch to out, 2 when it copied a batch and the
// caller missed changes before it, 3 when the caller missed changes up to
// r->txn_id and there is no batch, 0 when no new batch is visible to txn,
// and -1 when out is too small; r->size then holds the size needed.
int schema_row_changes_next(schema_row_changes_reader* r,
	const MDBX_txn* txn, void* out, u32 out_size
) {
	const schema_row_changes_header* header = r->header;
	u64 capacity = header->capacity;
	u64 max_txn_id = mdbx_txn_id(txn);
	for (;;) {
		// If a writer overwrote batches that this reader had not read yet,
		// continue from the oldest batch that the ring still holds.
		u64 start = changes_load(&header->retained_start);
		u64 end = changes_load(&header->published_end);
		if (r->offset < start)
			r->offset = start;
		if (r->offset >= end)
			return changes_end(r, max_txn_id);

		// Read the batch header. If a writer overwrote it during the read,
		// start over.
		const u8* batch = r->data + r->offset % capacity;
		u32 size;
		u64 txn_id;
		memcpy(&size, batch, 4);
		memcpy(&txn_id, batch + 4, 8);
		__atomic_thread_fence(__ATOMIC_SEQ_CST);
		if (r->offset < changes_load(&header->retained_start))
			continue;
		assert(size >= CHANGES_BATCH_HEADER_SIZE && size <= capacity);
		assert(r->offset + changes_slot_size(size) <= end);

		// Stop at a batch from a txn newer than the caller's read snapshot.
		if (txn_id > max_txn_id)
			return changes_end(r, max_txn_id);

		// Copy the batch. If a writer overwrote it during the copy, start
		// over.
		if (size > out_size) {
			r->size = size;
			return -1;
		}
		memcpy(out, batch, size);
		__atomic_thread_fence(__ATOMIC_SEQ_CST);
		if (r->offset < changes_load(&header->retained_start))
			continue;
		r->offset += changes_slot_size(size);

		// The caller missed changes if ids are missing between the previous
		// batch and this one. An id has no batch when its writer published
		// none, or when another writer overwrote the batch before this reader
		// read it.
		int has_gap = txn_id > r->prev_txn_id + 1;

		r->prev_txn_id = txn_id;
		r->txn_id = (double)txn_id;
		return has_gap ? 2 : 1;
	}
}
