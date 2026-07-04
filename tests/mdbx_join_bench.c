/* raw MDBX nested-loop join benchmark: no Lua, no query-node machinery.
 * mirrors pk_join_seek's per-row op sequence (MDBX_SET_KEY then
 * MDBX_NEXT_DUP) so its cost can be compared directly against the Lua
 * benches (tests/mdbx_query_bench.lua, mdbx_join_bench.lua) to isolate
 * how much of the total join cost is unavoidable MDBX cost vs Lua/FFI/
 * query-node overhead on top of it. */

#include "mdbx.h"
#include <endian.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static void check(int rc, const char *what) {
	if (rc != MDBX_SUCCESS) {
		fprintf(stderr, "%s: (%d) %s\n", what, rc, mdbx_strerror(rc));
		exit(1);
	}
}

static double now(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec + ts.tv_nsec / 1e9;
}

int main(int argc, char **argv) {
	uint64_t n_authors = argc > 1 ? strtoull(argv[1], NULL, 10) : 1000;
	uint64_t n_posts   = argc > 2 ? strtoull(argv[2], NULL, 10) : 200000;
	double   duration  = argc > 3 ? strtod(argv[3], NULL) : 3.0;

	const char *file = "/tmp/sdk_mdbx_join_bench.mdb";
	char lck[256];
	snprintf(lck, sizeof lck, "%s-lck", file);
	remove(file);
	remove(lck);

	MDBX_env *env;
	check(mdbx_env_create(&env), "env_create");
	/* same geometry/pagesize as mdbx_open() in lua/mdbx.lua, for a fair
	 * comparison against the Lua benches. */
	check(mdbx_env_set_geometry(env, 0, -1, 1024e9, -1, -1, 4096), "set_geometry");
	check(mdbx_env_set_option(env, MDBX_opt_max_db, 8), "set_option max_db");
	check(mdbx_env_open(env, file, MDBX_NOSUBDIR, 0664), "env_open");

	MDBX_txn *txn;
	MDBX_dbi author_dbi, post_dbi;
	check(mdbx_txn_begin(env, NULL, 0, &txn), "txn_begin w");
	check(mdbx_dbi_open(txn, "author", MDBX_CREATE, &author_dbi),
		"dbi_open author");
	/* DUPSORT|DUPFIXED: same physical layout as a FK index on a fixed-size
	 * u32 key (author_id -> post pk), see table_flags() in mdbx_schema.lua. */
	check(mdbx_dbi_open(txn, "post_by_author",
		MDBX_CREATE | MDBX_DUPSORT | MDBX_DUPFIXED, &post_dbi),
		"dbi_open post_by_author");

	for (uint64_t i = 1; i <= n_authors; i++) {
		uint32_t k = htobe32((uint32_t)i);
		MDBX_val key = {&k, sizeof k};
		MDBX_val val = {"", 0};
		check(mdbx_put(txn, author_dbi, &key, &val, 0), "put author");
	}
	for (uint64_t id = 1; id <= n_posts; id++) {
		uint64_t author_id = ((id * 17) % n_authors) + 1;
		uint32_t k = htobe32((uint32_t)author_id);
		uint32_t v = htobe32((uint32_t)id);
		MDBX_val key = {&k, sizeof k};
		MDBX_val val = {&v, sizeof v};
		check(mdbx_put(txn, post_dbi, &key, &val, 0), "put post");
	}
	check(mdbx_txn_commit(txn), "txn_commit w");

	check(mdbx_txn_begin(env, NULL, MDBX_TXN_RDONLY, &txn), "txn_begin r");

	/* warm every page into the OS/mdbx cache so no run pays a cold-disk-read
	 * cost that another run avoids by luck of the cache -- same reasoning as
	 * warm_full_scan() in tests/mdbx_query_bench.lua. */
	MDBX_cursor *cur;
	MDBX_val k, v;
	int rc;
	check(mdbx_cursor_open(txn, author_dbi, &cur), "cursor_open author (warm)");
	for (rc = mdbx_cursor_get(cur, &k, &v, MDBX_FIRST); rc == MDBX_SUCCESS;
		rc = mdbx_cursor_get(cur, &k, &v, MDBX_NEXT));
	mdbx_cursor_close(cur);
	check(mdbx_cursor_open(txn, post_dbi, &cur), "cursor_open post (warm)");
	for (rc = mdbx_cursor_get(cur, &k, &v, MDBX_FIRST); rc == MDBX_SUCCESS;
		rc = mdbx_cursor_get(cur, &k, &v, MDBX_NEXT));
	mdbx_cursor_close(cur);

	check(mdbx_cursor_open(txn, post_dbi, &cur), "cursor_open post (bench)");
	MDBX_cursor *author_cur;
	check(mdbx_cursor_open(txn, author_dbi, &author_cur), "cursor_open author (bench)");

	/* nested loop join: the driver is a cursor scan of the author table
	 * (MDBX_FIRST/MDBX_NEXT), same as pk_join_seek's driver (pk_range over
	 * author); for each driver row, one MDBX_SET_KEY seek on the FK index
	 * then MDBX_NEXT_DUP to walk that author's posts -- the exact op
	 * sequence pk_join_seek:next_group() runs per driver row
	 * (mdbx_query_nodes.lua). */
	double t0 = now();
	uint64_t runs = 0, pairs = 0;
	do {
		MDBX_val a_key, a_val;
		for (int ar = mdbx_cursor_get(author_cur, &a_key, &a_val, MDBX_FIRST);
			ar == MDBX_SUCCESS;
			ar = mdbx_cursor_get(author_cur, &a_key, &a_val, MDBX_NEXT)) {
			MDBX_val val;
			int r = mdbx_cursor_get(cur, &a_key, &val, MDBX_SET_KEY);
			while (r == MDBX_SUCCESS) {
				pairs++;
				r = mdbx_cursor_get(cur, &a_key, &val, MDBX_NEXT_DUP);
			}
		}
		runs++;
	} while (now() - t0 < duration);
	double elapsed = now() - t0;

	printf("seek (C): %llu runs, %llu pairs in %.3fs -> %.0f runs/s, %.0f pairs/s\n",
		(unsigned long long)runs, (unsigned long long)pairs, elapsed,
		runs / elapsed, pairs / elapsed);

	mdbx_cursor_close(cur);
	mdbx_cursor_close(author_cur);
	mdbx_txn_abort(txn);
	mdbx_env_close(env);
	remove(file);
	remove(lck);
	return 0;
}
