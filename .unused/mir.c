// go@ plink -batch root@m1 gcc -static -o mir_test -Isdk/c/mir -Lsdk/bin/linux sdk/lua/mir.c -lmir

#include <mir.h>

void main() {
	printf("Start.\n");
	MIR_context_t ctx = MIR_init();

	MIR_new_module(ctx, "m");

	// Create a function: int add(int a, int b)
	MIR_type_t res[1] = {MIR_T_I64};
	char* a = "a";
	char* b = "b";
	char* t = "t";
	MIR_var_t args[2] = {{MIR_T_I64, a, 8}, {MIR_T_I64, b, 8}};
	MIR_item_t fn = MIR_new_func_arr(ctx, "add", 1, res, 2, args);

	MIR_reg_t a_reg = MIR_reg(ctx, a, fn->u.func);
	MIR_reg_t b_reg = MIR_reg(ctx, b, fn->u.func);
	MIR_reg_t t_reg = MIR_new_func_reg(ctx, fn->u.func, MIR_T_I64, t);

	MIR_op_t add_ops[3] = {
			MIR_new_reg_op(ctx, t_reg),
			MIR_new_reg_op(ctx, a_reg),
			MIR_new_reg_op(ctx, b_reg),
	};
	MIR_append_insn(ctx, fn, MIR_new_insn_arr(ctx, MIR_ADD, 3, add_ops));

	MIR_op_t ret_ops[1] = {MIR_new_reg_op(ctx, t_reg)};
	MIR_append_insn(ctx, fn,
		MIR_new_insn_arr(ctx, MIR_RET, 1, ret_ops));

	MIR_finish_func(ctx);
	MIR_finish_module(ctx);

	// MIR_link(ctx, MIR_set_interface, nil);

	// MIR_gen_init(ctx, 0)
	// MIR_gen(ctx, 0, fn)
	// local add = cast('int64_t(*fun_t)(int64_t, int64_t)', MIR_gen_get_code(ctx, 0, fn))
	// print(add(5, 7))
	// MIR_gen_finish(ctx, 0)

	MIR_finish(ctx);

	printf("Done.\n");
}
