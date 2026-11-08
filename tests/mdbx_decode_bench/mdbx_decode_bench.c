#include "../c/mdbx_schema/mdbx_schema.c"

typedef struct schema_col_read {
	schema_table* table;
	const MDBX_val* rec;
	int col_i;
	bool8 is_key;
	bool8 is_scalar;
} schema_col_read;

void schema_decode_cols(const schema_col_read* reads, int n,
	double* numbers, const u8** data, int* lengths,
	u8* scratch, int scratch_size
) {
	for (int i = 0; i < n; i++) {
		const schema_col_read* read = &reads[i];
		u8* p;
		int len;
		schema_col* col;
		if (read->is_key) {
			len = schema_get_key_rec(read->table, read->col_i, read->rec,
				scratch + i * scratch_size, scratch_size, &p, NULL);
			col = get_key_col(read->table, read->col_i);
		} else {
			len = schema_get_val_rec(read->table, read->col_i,
				read->rec, &p);
			col = get_val_col(read->table, read->col_i);
		}
		lengths[i] = len;
		if (len == -1) continue;
		if (read->is_scalar) {
			switch (col->type) {
				case schema_col_type_i8:  numbers[i] = *(i8* )p; break;
				case schema_col_type_i16: numbers[i] = *(i16*)p; break;
				case schema_col_type_i32: numbers[i] = *(i32*)p; break;
				case schema_col_type_u8:  numbers[i] = *(u8* )p; break;
				case schema_col_type_u16: numbers[i] = *(u16*)p; break;
				case schema_col_type_u32: numbers[i] = *(u32*)p; break;
				case schema_col_type_f32: numbers[i] = *(f32*)p; break;
				case schema_col_type_f64: numbers[i] = *(f64*)p; break;
				default: assert(0);
			}
		} else {
			data[i] = p;
		}
	}
}
