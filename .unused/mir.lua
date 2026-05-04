--[[

	MIR binding (API v0.2).
	Written by Cosmin Apreutsei. Public Domain.

	API



]]

do return end

require'glue'
local C = ffi.load'mir'

cdef[[
typedef struct FILE FILE;

typedef unsigned htab_ind_t;
typedef unsigned htab_size_t;
typedef unsigned htab_hash_t;

typedef struct MIR_alloc {
  void *(*malloc) (size_t, void *);
  void *(*calloc) (size_t, size_t, void *);
  void *(*realloc) (void *, size_t, size_t, void *);
  void (*free) (void *, void *);
  void *user_data;
} *MIR_alloc_t;

typedef enum MIR_mem_protect {
  PROT_WRITE_EXEC,
  PROT_READ_EXEC
} MIR_mem_protect_t;

typedef struct MIR_code_alloc {
  void *(*mem_map) (size_t, void *);
  int (*mem_unmap) (void *, size_t, void *);
  int (*mem_protect) (void *, size_t, MIR_mem_protect_t, void *);
  void *user_data;
} *MIR_code_alloc_t;

typedef enum MIR_error_type {
  MIR_no_error , MIR_syntax_error , MIR_binary_io_error , MIR_alloc_error , MIR_finish_error , MIR_no_module_error , MIR_nested_module_error , MIR_no_func_error,
  MIR_func_error , MIR_vararg_func_error , MIR_nested_func_error , MIR_wrong_param_value_error , MIR_hard_reg_error,
  MIR_reserved_name_error , MIR_import_export_error , MIR_undeclared_func_reg_error , MIR_repeated_decl_error , MIR_reg_type_error,
  MIR_wrong_type_error , MIR_unique_reg_error , MIR_undeclared_op_ref_error , MIR_ops_num_error , MIR_call_op_error , MIR_unspec_op_error,
  MIR_wrong_lref_error , MIR_ret_error , MIR_op_mode_error , MIR_out_op_error , MIR_invalid_insn_error , MIR_ctx_change_error
} MIR_error_type_t;

typedef void (*MIR_error_func_t) (MIR_error_type_t error_type, const char *format, ...);

typedef enum {
  MIR_MOV , MIR_FMOV , MIR_DMOV , MIR_LDMOV,
  MIR_EXT8 , MIR_EXT16 , MIR_EXT32 , MIR_UEXT8 , MIR_UEXT16 , MIR_UEXT32,
  MIR_I2F , MIR_I2D , MIR_I2LD,
  MIR_UI2F , MIR_UI2D , MIR_UI2LD,
  MIR_F2I , MIR_D2I , MIR_LD2I,
  MIR_F2D , MIR_F2LD , MIR_D2F , MIR_D2LD , MIR_LD2F , MIR_LD2D,
  MIR_NEG , MIR_NEGS , MIR_FNEG , MIR_DNEG , MIR_LDNEG,
  MIR_ADDR , MIR_ADDR8 , MIR_ADDR16 , MIR_ADDR32,
  MIR_ADD , MIR_ADDS , MIR_FADD , MIR_DADD , MIR_LDADD,
  MIR_SUB , MIR_SUBS , MIR_FSUB , MIR_DSUB , MIR_LDSUB,
  MIR_MUL , MIR_MULS , MIR_FMUL , MIR_DMUL , MIR_LDMUL,
  MIR_DIV , MIR_DIVS , MIR_UDIV , MIR_UDIVS , MIR_FDIV , MIR_DDIV , MIR_LDDIV,
  MIR_MOD , MIR_MODS , MIR_UMOD , MIR_UMODS,
  MIR_AND , MIR_ANDS , MIR_OR , MIR_ORS , MIR_XOR , MIR_XORS,
  MIR_LSH , MIR_LSHS , MIR_RSH , MIR_RSHS , MIR_URSH , MIR_URSHS,
  MIR_EQ , MIR_EQS , MIR_FEQ , MIR_DEQ , MIR_LDEQ,
  MIR_NE , MIR_NES , MIR_FNE , MIR_DNE , MIR_LDNE,
  MIR_LT , MIR_LTS , MIR_ULT , MIR_ULTS , MIR_FLT , MIR_DLT , MIR_LDLT,
  MIR_LE , MIR_LES , MIR_ULE , MIR_ULES , MIR_FLE , MIR_DLE , MIR_LDLE,
  MIR_GT , MIR_GTS , MIR_UGT , MIR_UGTS , MIR_FGT , MIR_DGT , MIR_LDGT,
  MIR_GE , MIR_GES , MIR_UGE , MIR_UGES , MIR_FGE , MIR_DGE , MIR_LDGE,
  MIR_ADDO , MIR_ADDOS , MIR_SUBO , MIR_SUBOS , MIR_MULO , MIR_MULOS , MIR_UMULO , MIR_UMULOS,
  MIR_JMP , MIR_BT , MIR_BTS , MIR_BF , MIR_BFS,
  MIR_BEQ , MIR_BEQS , MIR_FBEQ , MIR_DBEQ , MIR_LDBEQ,
  MIR_BNE , MIR_BNES , MIR_FBNE , MIR_DBNE , MIR_LDBNE,
  MIR_BLT , MIR_BLTS , MIR_UBLT , MIR_UBLTS , MIR_FBLT , MIR_DBLT , MIR_LDBLT,
  MIR_BLE , MIR_BLES , MIR_UBLE , MIR_UBLES , MIR_FBLE , MIR_DBLE , MIR_LDBLE,
  MIR_BGT , MIR_BGTS , MIR_UBGT , MIR_UBGTS , MIR_FBGT , MIR_DBGT , MIR_LDBGT,
  MIR_BGE , MIR_BGES , MIR_UBGE , MIR_UBGES , MIR_FBGE , MIR_DBGE , MIR_LDBGE,
  MIR_BO , MIR_UBO,
  MIR_BNO , MIR_UBNO,
  MIR_LADDR,
  MIR_JMPI,
  MIR_CALL , MIR_INLINE , MIR_JCALL,
  MIR_SWITCH,
  MIR_RET,
  MIR_JRET,
  MIR_ALLOCA,
  MIR_BSTART , MIR_BEND,
  MIR_VA_ARG,
  MIR_VA_BLOCK_ARG,
  MIR_VA_START,
  MIR_VA_END,
  MIR_LABEL,
  MIR_UNSPEC,
  MIR_PRSET , MIR_PRBEQ , MIR_PRBNE,
  MIR_USE,
  MIR_PHI,
  MIR_INVALID_INSN,
  MIR_INSN_BOUND,
} MIR_insn_code_t;

typedef enum {
  MIR_T_I8 , MIR_T_U8 , MIR_T_I16 , MIR_T_U16 , MIR_T_I32 , MIR_T_U32 , MIR_T_I64 , MIR_T_U64,
  MIR_T_F , MIR_T_D , MIR_T_LD,
  MIR_T_P , MIR_T_BLK,
  MIR_T_RBLK = MIR_T_BLK + 5,
  MIR_T_UNDEF , MIR_T_BOUND,
} MIR_type_t;

typedef uint8_t MIR_scale_t;
typedef int64_t MIR_disp_t;
typedef uint32_t MIR_reg_t;

typedef union {
  int64_t i;
  uint64_t u;
  float f;
  double d;
  long double ld;
} MIR_imm_t;

typedef uint32_t MIR_alias_t;

typedef struct {
  MIR_type_t type;
  MIR_scale_t scale;
  MIR_alias_t alias;
  MIR_alias_t nonalias;
  uint32_t nloc;
  MIR_reg_t base, index;
  MIR_disp_t disp;
} MIR_mem_t;

typedef struct MIR_insn *MIR_label_t;

typedef const char *MIR_name_t;

typedef enum {
  MIR_OP_UNDEF , MIR_OP_REG , MIR_OP_VAR , MIR_OP_INT , MIR_OP_UINT , MIR_OP_FLOAT , MIR_OP_DOUBLE , MIR_OP_LDOUBLE,
  MIR_OP_REF , MIR_OP_STR , MIR_OP_MEM , MIR_OP_VAR_MEM , MIR_OP_LABEL , MIR_OP_BOUND,
} MIR_op_mode_t;

typedef struct MIR_item *MIR_item_t;

struct MIR_str {
  size_t len;
  const char *s;
};

typedef struct MIR_str MIR_str_t;

typedef struct {
  void *data;
  MIR_op_mode_t mode;
  MIR_op_mode_t value_mode;
  union {
    MIR_reg_t reg;
    MIR_reg_t var;
    int64_t i;
    uint64_t u;
    float f;
    double d;
    long double ld;
    MIR_item_t ref;
    MIR_str_t str;
    MIR_mem_t mem;
    MIR_mem_t var_mem;
    MIR_label_t label;
  } u;
} MIR_op_t;

typedef struct MIR_insn *MIR_insn_t;

typedef struct DLIST_LINK_MIR_insn_t { MIR_insn_t prev, next; } DLIST_LINK_MIR_insn_t;;

struct MIR_insn {
  void *data;
  DLIST_LINK_MIR_insn_t insn_link;
  MIR_insn_code_t code;
  unsigned int nops;
  MIR_op_t ops[1];
};

typedef struct DLIST_MIR_insn_t { MIR_insn_t head, tail; } DLIST_MIR_insn_t;

typedef struct MIR_var {
  MIR_type_t type;
  const char *name;
  size_t size;
} MIR_var_t;

typedef struct VARR_MIR_var_t { size_t els_num; size_t size; MIR_var_t *varr; MIR_alloc_t alloc; } VARR_MIR_var_t;

typedef struct MIR_func {
  const char *name;
  MIR_item_t func_item;
  size_t original_vars_num;
  DLIST_MIR_insn_t insns, original_insns;
  uint32_t nres, nargs, last_temp_num, n_inlines;
  MIR_type_t *res_types;
  char vararg_p;
  char expr_p;
  char jret_p;
  VARR_MIR_var_t * vars;
  VARR_MIR_var_t * global_vars;
  void *machine_code;
  void *call_addr;
  void *internal;
  struct MIR_lref_data *first_lref;
} *MIR_func_t;

typedef struct MIR_proto {
  const char *name;
  uint32_t nres;
  MIR_type_t *res_types;
  char vararg_p;
  VARR_MIR_var_t * args;
} *MIR_proto_t;

typedef struct MIR_data {
  const char *name;
  MIR_type_t el_type;
  size_t nel;
  union {
    long double d;
    uint8_t els[1];
  } u;
} *MIR_data_t;

typedef struct MIR_ref_data {
  const char *name;
  MIR_item_t ref_item;
  int64_t disp;
  void *load_addr;
} *MIR_ref_data_t;

typedef struct MIR_lref_data {
  const char *name;
  MIR_label_t label;
  MIR_label_t label2;
  MIR_label_t orig_label, orig_label2;
  int64_t disp;
  void *load_addr;
  struct MIR_lref_data *next;
} *MIR_lref_data_t;

typedef struct MIR_expr_data {
  const char *name;
  MIR_item_t expr_item;
  void *load_addr;
} *MIR_expr_data_t;

typedef struct MIR_bss {
  const char *name;
  uint64_t len;
} *MIR_bss_t;

typedef struct MIR_module *MIR_module_t;

typedef struct DLIST_LINK_MIR_item_t { MIR_item_t prev, next; } DLIST_LINK_MIR_item_t;;

typedef enum {
  MIR_func_item , MIR_proto_item , MIR_import_item , MIR_export_item , MIR_forward_item , MIR_data_item , MIR_ref_data_item , MIR_lref_data_item,
  MIR_expr_data_item , MIR_bss_item,
} MIR_item_type_t;
# 385 "mir.h"
struct MIR_item {
  void *data;
  MIR_module_t module;
  DLIST_LINK_MIR_item_t item_link;
  MIR_item_type_t item_type;
  MIR_item_t ref_def;
  void *addr;
  char export_p;
  char section_head_p;
  union {
    MIR_func_t func;
    MIR_proto_t proto;
    MIR_name_t import_id;
    MIR_name_t export_id;
    MIR_name_t forward_id;
    MIR_data_t data;
    MIR_ref_data_t ref_data;
    MIR_lref_data_t lref_data;
    MIR_expr_data_t expr_data;
    MIR_bss_t bss;
  } u;
};

typedef struct DLIST_MIR_item_t { MIR_item_t head, tail; } DLIST_MIR_item_t;

typedef struct DLIST_LINK_MIR_module_t { MIR_module_t prev, next; } DLIST_LINK_MIR_module_t;;

struct MIR_module {
  void *data;
  const char *name;
  DLIST_MIR_item_t items;
  DLIST_LINK_MIR_module_t module_link;
  uint32_t last_temp_item_num;
};

typedef struct DLIST_MIR_module_t { MIR_module_t head, tail; } DLIST_MIR_module_t;

struct MIR_context;
typedef struct MIR_context *MIR_context_t;

double _MIR_get_api_version (void);

MIR_context_t _MIR_init (MIR_alloc_t alloc, MIR_code_alloc_t code_alloc);

void MIR_finish (MIR_context_t ctx);

MIR_module_t MIR_new_module (MIR_context_t ctx, const char *name);
DLIST_MIR_module_t * MIR_get_module_list (MIR_context_t ctx);
MIR_item_t MIR_new_import (MIR_context_t ctx, const char *name);
MIR_item_t MIR_new_export (MIR_context_t ctx, const char *name);
MIR_item_t MIR_new_forward (MIR_context_t ctx, const char *name);
MIR_item_t MIR_new_bss (MIR_context_t ctx, const char *name,
                               size_t len);
MIR_item_t MIR_new_data (MIR_context_t ctx, const char *name, MIR_type_t el_type, size_t nel,
                                const void *els);
MIR_item_t MIR_new_string_data (MIR_context_t ctx, const char *name,
                                       MIR_str_t str);
MIR_item_t MIR_new_ref_data (MIR_context_t ctx, const char *name, MIR_item_t item,
                                    int64_t disp);
MIR_item_t MIR_new_lref_data (MIR_context_t ctx, const char *name, MIR_label_t label,
                                     MIR_label_t label2,
                                     int64_t disp);
MIR_item_t MIR_new_expr_data (MIR_context_t ctx, const char *name,
                                     MIR_item_t expr_item);
MIR_item_t MIR_new_proto_arr (MIR_context_t ctx, const char *name, size_t nres,
                                     MIR_type_t *res_types, size_t nargs, MIR_var_t *vars);
MIR_item_t MIR_new_proto (MIR_context_t ctx, const char *name, size_t nres,
                                 MIR_type_t *res_types, size_t nargs, ...);
MIR_item_t MIR_new_vararg_proto_arr (MIR_context_t ctx, const char *name, size_t nres,
                                            MIR_type_t *res_types, size_t nargs, MIR_var_t *vars);
MIR_item_t MIR_new_vararg_proto (MIR_context_t ctx, const char *name, size_t nres,
                                        MIR_type_t *res_types, size_t nargs, ...);
MIR_item_t MIR_new_func_arr (MIR_context_t ctx, const char *name, size_t nres,
                                    MIR_type_t *res_types, size_t nargs, MIR_var_t *vars);
MIR_item_t MIR_new_func (MIR_context_t ctx, const char *name, size_t nres,
                                MIR_type_t *res_types, size_t nargs, ...);
MIR_item_t MIR_new_vararg_func_arr (MIR_context_t ctx, const char *name, size_t nres,
                                           MIR_type_t *res_types, size_t nargs, MIR_var_t *vars);
MIR_item_t MIR_new_vararg_func (MIR_context_t ctx, const char *name, size_t nres,
                                       MIR_type_t *res_types, size_t nargs, ...);
const char *MIR_item_name (MIR_context_t ctx, MIR_item_t item);
MIR_func_t MIR_get_item_func (MIR_context_t ctx, MIR_item_t item);
MIR_reg_t MIR_new_func_reg (MIR_context_t ctx, MIR_func_t func, MIR_type_t type,
                                   const char *name);
MIR_reg_t MIR_new_global_func_reg (MIR_context_t ctx, MIR_func_t func, MIR_type_t type,
                                          const char *name, const char *hard_reg_name);
void MIR_finish_func (MIR_context_t ctx);
void MIR_finish_module (MIR_context_t ctx);

MIR_error_func_t MIR_get_error_func (MIR_context_t ctx);
void MIR_set_error_func (MIR_context_t ctx, MIR_error_func_t func);

MIR_alloc_t MIR_get_alloc (MIR_context_t ctx);

int MIR_get_func_redef_permission_p (MIR_context_t ctx);
void MIR_set_func_redef_permission (MIR_context_t ctx, int flag_p);

MIR_insn_t MIR_new_insn_arr (MIR_context_t ctx, MIR_insn_code_t code, size_t nops,
                                    MIR_op_t *ops);
MIR_insn_t MIR_new_insn (MIR_context_t ctx, MIR_insn_code_t code, ...);
MIR_insn_t MIR_new_call_insn (MIR_context_t ctx, size_t nops, ...);
MIR_insn_t MIR_new_jcall_insn (MIR_context_t ctx, size_t nops, ...);
MIR_insn_t MIR_new_ret_insn (MIR_context_t ctx, size_t nops, ...);
MIR_insn_t MIR_copy_insn (MIR_context_t ctx, MIR_insn_t insn);

const char *MIR_insn_name (MIR_context_t ctx, MIR_insn_code_t code);
size_t MIR_insn_nops (MIR_context_t ctx, MIR_insn_t insn);
MIR_op_mode_t MIR_insn_op_mode (MIR_context_t ctx, MIR_insn_t insn, size_t nop, int *out_p);

MIR_insn_t MIR_new_label (MIR_context_t ctx);

MIR_reg_t MIR_reg (MIR_context_t ctx, const char *reg_name, MIR_func_t func);
MIR_type_t MIR_reg_type (MIR_context_t ctx, MIR_reg_t reg, MIR_func_t func);
const char *MIR_reg_name (MIR_context_t ctx, MIR_reg_t reg, MIR_func_t func);
const char *MIR_reg_hard_reg_name (MIR_context_t ctx, MIR_reg_t reg, MIR_func_t func);

const char *MIR_alias_name (MIR_context_t ctx, MIR_alias_t alias);
MIR_alias_t MIR_alias (MIR_context_t ctx, const char *name);

MIR_op_t MIR_new_reg_op (MIR_context_t ctx, MIR_reg_t reg);
MIR_op_t MIR_new_int_op (MIR_context_t ctx, int64_t v);
MIR_op_t MIR_new_uint_op (MIR_context_t ctx, uint64_t v);
MIR_op_t MIR_new_float_op (MIR_context_t ctx, float v);
MIR_op_t MIR_new_double_op (MIR_context_t ctx, double v);
MIR_op_t MIR_new_ldouble_op (MIR_context_t ctx, long double v);
MIR_op_t MIR_new_ref_op (MIR_context_t ctx, MIR_item_t item);
MIR_op_t MIR_new_str_op (MIR_context_t ctx, MIR_str_t str);
MIR_op_t MIR_new_mem_op (MIR_context_t ctx, MIR_type_t type, MIR_disp_t disp, MIR_reg_t base,
                                MIR_reg_t index, MIR_scale_t scale);
MIR_op_t MIR_new_alias_mem_op (MIR_context_t ctx, MIR_type_t type, MIR_disp_t disp,
                                      MIR_reg_t base, MIR_reg_t index, MIR_scale_t scale,
                                      MIR_alias_t alias, MIR_alias_t noalias);
MIR_op_t MIR_new_label_op (MIR_context_t ctx, MIR_label_t label);
int MIR_op_eq_p (MIR_context_t ctx, MIR_op_t op1, MIR_op_t op2);
htab_hash_t MIR_op_hash_step (MIR_context_t ctx, htab_hash_t h, MIR_op_t op);

void MIR_append_insn (MIR_context_t ctx, MIR_item_t func, MIR_insn_t insn);
void MIR_prepend_insn (MIR_context_t ctx, MIR_item_t func, MIR_insn_t insn);
void MIR_insert_insn_after (MIR_context_t ctx, MIR_item_t func, MIR_insn_t after,
                                   MIR_insn_t insn);
void MIR_insert_insn_before (MIR_context_t ctx, MIR_item_t func, MIR_insn_t before,
                                    MIR_insn_t insn);
void MIR_remove_insn (MIR_context_t ctx, MIR_item_t func, MIR_insn_t insn);

void MIR_change_module_ctx (MIR_context_t old_ctx, MIR_module_t m, MIR_context_t new_ctx);

MIR_insn_code_t MIR_reverse_branch_code (MIR_insn_code_t code);

const char *MIR_type_str (MIR_context_t ctx, MIR_type_t tp);
void MIR_output_str (MIR_context_t ctx, FILE *f, MIR_str_t str);
void MIR_output_op (MIR_context_t ctx, FILE *f, MIR_op_t op, MIR_func_t func);
void MIR_output_insn (MIR_context_t ctx, FILE *f, MIR_insn_t insn, MIR_func_t func,
                             int newline_p);
void MIR_output_item (MIR_context_t ctx, FILE *f, MIR_item_t item);
void MIR_output_module (MIR_context_t ctx, FILE *f, MIR_module_t module);
void MIR_output (MIR_context_t ctx, FILE *f);


void MIR_write (MIR_context_t ctx, FILE *f);
void MIR_write_module (MIR_context_t ctx, FILE *f, MIR_module_t module);
void MIR_read (MIR_context_t ctx, FILE *f);
void MIR_write_with_func (MIR_context_t ctx,
                                 int (*const writer_func) (MIR_context_t, uint8_t));
void MIR_write_module_with_func (MIR_context_t ctx,
                                        int (*const writer_func) (MIR_context_t, uint8_t),
                                        MIR_module_t module);
void MIR_read_with_func (MIR_context_t ctx, int (*const reader_func) (MIR_context_t));

void MIR_scan_string (MIR_context_t ctx, const char *str);

MIR_item_t MIR_get_global_item (MIR_context_t ctx, const char *name);
void MIR_load_module (MIR_context_t ctx, MIR_module_t m);
void MIR_load_external (MIR_context_t ctx, const char *name, void *addr);
void MIR_link (MIR_context_t ctx, void (*set_interface) (MIR_context_t ctx, MIR_item_t item),
                      void *(*import_resolver) (const char *) );

typedef union {
  MIR_insn_code_t ic;
  void *a;
  int64_t i;
  uint64_t u;
  float f;
  double d;
  long double ld;
} MIR_val_t;

void MIR_interp (MIR_context_t ctx, MIR_item_t func_item, MIR_val_t *results, size_t nargs,
                        ...);
void MIR_interp_arr (MIR_context_t ctx, MIR_item_t func_item, MIR_val_t *results,
                            size_t nargs, MIR_val_t *vals);
void MIR_interp_arr_varg (MIR_context_t ctx, MIR_item_t func_item, MIR_val_t *results,
                                 size_t nargs, MIR_val_t *vals, va_list va);
void MIR_set_interp_interface (MIR_context_t ctx, MIR_item_t func_item);

double _MIR_get_api_version (void);
MIR_context_t _MIR_init (MIR_alloc_t alloc, MIR_code_alloc_t code_alloc);
const char *_MIR_uniq_string (MIR_context_t ctx, const char *str);
int _MIR_reserved_ref_name_p (MIR_context_t ctx, const char *name);
int _MIR_reserved_name_p (MIR_context_t ctx, const char *name);
int64_t _MIR_addr_offset (MIR_context_t ctx, MIR_insn_code_t code);
void _MIR_free_insn (MIR_context_t ctx, MIR_insn_t insn);
MIR_reg_t _MIR_new_temp_reg (MIR_context_t ctx, MIR_type_t type,
                                    MIR_func_t func);
size_t _MIR_type_size (MIR_context_t ctx, MIR_type_t type);
MIR_op_mode_t _MIR_insn_code_op_mode (MIR_context_t ctx, MIR_insn_code_t code, size_t nop,
                                             int *out_p);
MIR_insn_t _MIR_new_unspec_insn (MIR_context_t ctx, size_t nops, ...);
void _MIR_register_unspec_insn (MIR_context_t ctx, uint64_t code, const char *name,
                                       size_t nres, MIR_type_t *res_types, size_t nargs,
                                       int vararg_p, MIR_var_t *args);
void _MIR_duplicate_func_insns (MIR_context_t ctx, MIR_item_t func_item);
void _MIR_restore_func_insns (MIR_context_t ctx, MIR_item_t func_item);

void _MIR_output_data_item_els (MIR_context_t ctx, FILE *f, MIR_item_t item, int c_p);
void _MIR_get_temp_item_name (MIR_context_t ctx, MIR_module_t module, char *buff,
                                     size_t buff_len);

MIR_op_t _MIR_new_var_op (MIR_context_t ctx, MIR_reg_t var);

MIR_op_t _MIR_new_var_mem_op (MIR_context_t ctx, MIR_type_t type, MIR_disp_t disp,
                                     MIR_reg_t base, MIR_reg_t index, MIR_scale_t scale);
MIR_op_t _MIR_new_alias_var_mem_op (MIR_context_t ctx, MIR_type_t type, MIR_disp_t disp,
                                           MIR_reg_t base, MIR_reg_t index, MIR_scale_t scale,
                                           MIR_alias_t alias, MIR_alias_t no_alias);

MIR_item_t _MIR_builtin_proto (MIR_context_t ctx, MIR_module_t module, const char *name,
                                      size_t nres, MIR_type_t *res_types, size_t nargs, ...);
MIR_item_t _MIR_builtin_func (MIR_context_t ctx, MIR_module_t module, const char *name,
                                     void *addr);
void _MIR_flush_code_cache (void *start, void *bound);
uint8_t *_MIR_publish_code (MIR_context_t ctx, const uint8_t *code, size_t code_len);
uint8_t *_MIR_get_new_code_addr (MIR_context_t ctx, size_t size);
uint8_t *_MIR_publish_code_by_addr (MIR_context_t ctx, void *addr, const uint8_t *code,
                                           size_t code_len);
struct MIR_code_reloc {
  size_t offset;
  const void *value;
};

typedef struct MIR_code_reloc MIR_code_reloc_t;

void _MIR_set_code (MIR_code_alloc_t alloc, size_t prot_start, size_t prot_len,
                           uint8_t *base, size_t nloc, const MIR_code_reloc_t *relocs,
                           size_t reloc_size);
void _MIR_change_code (MIR_context_t ctx, uint8_t *addr, const uint8_t *code,
                              size_t code_len);
void _MIR_update_code_arr (MIR_context_t ctx, uint8_t *base, size_t nloc,
                                  const MIR_code_reloc_t *relocs);
void _MIR_update_code (MIR_context_t ctx, uint8_t *base, size_t nloc, ...);

void *va_arg_builtin (void *p, uint64_t t);
void va_block_arg_builtin (void *res, void *p, size_t s, uint64_t t);
void va_start_interp_builtin (MIR_context_t ctx, void *p, void *a);
void va_end_interp_builtin (MIR_context_t ctx, void *p);

void *_MIR_get_bstart_builtin (MIR_context_t ctx);
void *_MIR_get_bend_builtin (MIR_context_t ctx);

typedef struct {
  MIR_type_t type;
  size_t size;
} _MIR_arg_desc_t;

void *_MIR_get_ff_call (MIR_context_t ctx, size_t nres, MIR_type_t *res_types, size_t nargs,
                               _MIR_arg_desc_t *arg_descs, size_t arg_vars_num);
void *_MIR_get_interp_shim (MIR_context_t ctx, MIR_item_t func_item, void *handler);
void *_MIR_get_thunk (MIR_context_t ctx);
void *_MIR_get_thunk_addr (MIR_context_t ctx, void *thunk);
void _MIR_redirect_thunk (MIR_context_t ctx, void *thunk, void *to);
void *_MIR_get_jmpi_thunk (MIR_context_t ctx, void **res_loc, void *res, void *cont);
void *_MIR_get_wrapper (MIR_context_t ctx, MIR_item_t called_func, void *hook_address);
void *_MIR_get_wrapper_end (MIR_context_t ctx);
void *_MIR_get_bb_thunk (MIR_context_t ctx, void *bb_version, void *handler);
void _MIR_replace_bb_thunk (MIR_context_t ctx, void *thunk, void *to);
void *_MIR_get_bb_wrapper (MIR_context_t ctx, void *data, void *hook_address);

int _MIR_name_char_p (MIR_context_t ctx, int ch, int first_p);
void _MIR_dump_code (const char *name, uint8_t *code, size_t code_len);

int _MIR_get_hard_reg (MIR_context_t ctx, const char *hard_reg_name);
void *_MIR_get_module_global_var_hard_regs (MIR_context_t ctx, MIR_module_t module);
]]

io.stderr:setvbuf('no')

function main()

	local ctx = C._MIR_init(nil, nil)

	--C.MIR_set_error_func(ctx, function() end)

	C.MIR_new_module(ctx, 'm')

	-- Create a function: int add(int a, int b)
	local res = new('MIR_type_t[1]', C.MIR_T_I64)
	local a = new('char[2]', 'a')
	local b = new('char[2]', 'b')
	local t = new('char[2]', 't')
	local args = new('MIR_var_t[2]', {C.MIR_T_I64, a, 8}, {C.MIR_T_I64, b, 8})
	local fn = C.MIR_new_func_arr(ctx, 'add', 1, res, 2, args)

	local a_reg = C.MIR_reg(ctx, a, fn.u.func)
	local b_reg = C.MIR_reg(ctx, b, fn.u.func)
	local t_reg = C.MIR_new_func_reg(ctx, fn.u.func, C.MIR_T_I64, t)

	pr(a_reg, t_reg, tostring(C.MIR_new_reg_op(ctx, a_reg).mode))
	local add_ops = new('MIR_op_t[3]',
			C.MIR_new_reg_op(ctx, t_reg),
			C.MIR_new_reg_op(ctx, a_reg),
			C.MIR_new_reg_op(ctx, b_reg))
	C.MIR_append_insn(ctx, fn, C.MIR_new_insn_arr(ctx, C.MIR_ADD, 3, add_ops))

	local ret_ops = new('MIR_op_t[1]', C.MIR_new_reg_op(ctx, t_reg))
	C.MIR_append_insn(ctx, fn,
		C.MIR_new_insn_arr(ctx, C.MIR_RET, 1, ret_ops))

	C.MIR_finish_func(ctx)
	C.MIR_finish_module(ctx)

	C.MIR_link(ctx, C.MIR_set_interface, nil)

	C.MIR_gen_init(ctx, 0)
	C.MIR_gen(ctx, 0, fn)
	--local add = cast('int64_t(*fun_t)(int64_t, int64_t)', C.MIR_gen_get_code(ctx, 0, fn))
	--print(add(5, 7))
	C.MIR_gen_finish(ctx, 0)

	C.MIR_finish(ctx)
end
main()
