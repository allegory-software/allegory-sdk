/*

	Schema encoding and decoding for LMDB/LibMDBX.
	Written by Cosmin Apreutesei. Public Domain.

	Builds with gcc -O2 -fno-strict-aliasing -Wall

	Schema means partitioning records (keys and values) into predefined columns,
	which allows multi-key ordering as well as efficient storage and retrieval
	of structured values.

	Data types:
		- ints: 8, 16, 32, 64 bit, signed/unsigned
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
typedef int64_t  i64;
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

// API -----------------------------------------------------------------------

typedef enum schema_col_type {
	schema_col_type_i8,
	schema_col_type_i16,
	schema_col_type_i32,
	schema_col_type_i64,
	schema_col_type_u8,
	schema_col_type_u16,
	schema_col_type_u32,
	schema_col_type_u64,
	schema_col_type_u32_le,
	schema_col_type_u64_le,
	schema_col_type_f32,
	schema_col_type_f64,
} schema_col_type;

/*

In-memory layout:
 - key records: fixed_size_cols, first_varsize_col, varoffset_cols (varsize or not).
 - val records: null_bits, dyn_offsets, fixed_size_cols, first_varsize_col, varsize_cols.

fixed_size means scalar (len=1) or fixed-size array (zero-padded). The opposite
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
	bool8 fixed_size; // fixed size array (padded) or varsize.
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

int schema_get_key(schema_table* tbl, int col_i,
	void* rec, int rec_size,
	u8* out, int out_size,
	u8** pout,
	u8** pp
);
int schema_val_is_null(schema_table* tbl, int col_i,
	const void* rec, int rec_size
);
int schema_get_val(schema_table* tbl, int col_i,
	void* rec, int rec_size,
	u8** pout
);
void schema_key_add(schema_table* tbl, int col_i,
	void* rec, int rec_buf_size, int val_len,
	u8** pp
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
static void decode_u64(u64* d, u64* s, int len) {
	while (len--)
		*d++ = __builtin_bswap64(*s++);
}
static void encode_u64(u64* d, u64* s, int len) {
	while (len--)
		*d++ = __builtin_bswap64(*s++);
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
static void decode_i64(u64* d, u64* s, int len) {
	while (len--)
		*d++ = __builtin_bswap64(*s++) ^ 0x8000000000000000ULL;
}
static void encode_i64(u64* d, u64* s, int len) {
	while (len--)
		*d++ = __builtin_bswap64(*s++ ^ 0x8000000000000000ULL);
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
	(encdec_t)&decode_i64,
	(encdec_t)(0),
	(encdec_t)&decode_u16,
	(encdec_t)&decode_u32,
	(encdec_t)&decode_u64,
	(encdec_t)(0),
	(encdec_t)(0),
	(encdec_t)&decode_f32,
	(encdec_t)&decode_f64,
};

/* NOTE: must match schema_col_type enum order! */
static encdec_t encoders[] = {
	(encdec_t)&encode_i8,
	(encdec_t)&encode_i16,
	(encdec_t)&encode_i32,
	(encdec_t)&encode_i64,
	(encdec_t)(0),
	(encdec_t)&encode_u16,
	(encdec_t)&encode_u32,
	(encdec_t)&encode_u64,
	(encdec_t)(0),
	(encdec_t)(0),
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

// Sort an array of 4-byte big-endian u32 elements using LSD radix sort over
// bytes 3, 2, 1, 0, skipping passes where all records have the same byte.
// Descending u32 keys are encoded by inverting the bytes so sorting the
// encoded bytes still matches memcmp() and MDBX raw key order.
// tmp must be a distinct n * 4 byte scratch buffer.
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

// binsearch in sorted u32-BE array.
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
	return lo < n && __builtin_bswap32(buf[lo]) == k;
}
