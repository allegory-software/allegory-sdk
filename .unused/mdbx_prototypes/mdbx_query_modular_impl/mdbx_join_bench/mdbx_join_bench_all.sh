#!/bin/bash
# runs the C, Lua-raw and query-node nested-loop join benchmarks across
# small/large row counts and small/large driver-vs-fk ratios, to see
# whether any of those variables shift the C vs Lua-raw vs query-node
# comparison. JIT is off in both Lua benchmarks (jit.off() unconditional).
cd "${0%mdbx_join_bench_all.sh}" || exit 1

DURATION=${1:-3.0}

run_combo() {
	local n_posts=$1 ratio_authors=$2 ratio_posts=$3
	local n_authors=$(( n_posts * ratio_authors / ratio_posts ))

	printf 'posts=%s authors=%s (ratio %s/%s) seconds=%s\n' \
		"$n_posts" "$n_authors" "$ratio_authors" "$ratio_posts" "$DURATION"

	export MDBX_BENCH_AUTHORS=$n_authors
	export MDBX_BENCH_POSTS=$n_posts
	export MDBX_BENCH_SECONDS=$DURATION

	./mdbx_join_bench "$n_authors" "$n_posts" "$DURATION" 2>/dev/null | grep '^seek '
	~/sdk/bin/luajit mdbx_join_bench.lua       | grep '^seek '
	~/sdk/bin/luajit mdbx_join_bench_nodes.lua | grep '^seek '
	printf '\n'
}

for n_posts in 1000 100000; do
	for ratio in '20 80' '80 20'; do
		run_combo "$n_posts" $ratio
	done
done
