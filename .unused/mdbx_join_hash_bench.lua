--archived from tests/mdbx_query_builder_bench.lua (then named
--mdbx_query_bench.lua): the pk_join_hash vs pk_join_seek comparison that
--led to removing pk_join_hash from mdbx_query_nodes.lua (see
--mdbx_query_nodes_unused.lua). reference only: depends on Db.pk_join_hash
--(not available; see mdbx_query_nodes_unused.lua) and on helpers defined in
--mdbx_query_builder_bench.lua (test_file, printf_line, bench_query,
--each_node), none of which are available here, so this file is not
--runnable as-is.

-- u32-keyed mirror of author/post, sized identically, so pk_join_hash's
-- u32 sort+binsearch fast path (mdbx_query_nodes.lua u32_keyset) can be
-- compared against the same join at the same n/m under the generic
-- (u64, Lua string hash) path.
local function create_u32_join_tables(db)
	db:create_table('author32', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:create_table('post32', {fields = {
		{col = 'id'       , mdbx_type = 'u32', not_null = true},
		{col = 'author_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_fk{table = 'post32', cols = {'author_id'},
		ref_table = 'author32', ref_cols = {'id'}}
end

local function insert_u32_join_rows(db, n_authors, n_posts)
	local author = {}
	for i = 1, n_authors do
		author.id = i
		db:insert('author32', '{}', author)
	end
	local post = {}
	for id = 1, n_posts do
		post.id = id
		post.author_id = ((id * 17) % n_authors) + 1
		db:insert('post32', '{}', post)
	end
end

-- same fk (all N_POSTS entries) throughout; driver size swept as a
-- fraction of N_AUTHORS to find where (if anywhere) pk_join_hash's
-- O(n+m) actually beats pk_join_seek's O(n log m) once real per-row
-- costs (Lua string alloc+hash for generic keys, or the u32 sort+
-- binsearch fast path) are in play, not just the complexity model.
--
-- result (2026-07-05): pk_join_hash never won, at any fraction, for
-- either key type. Moved pk_join_hash to mdbx_query_nodes_unused.lua.
local function bench_join_sweep(db, label, author_tbl, fk_name, n_authors)
	for _, frac in ipairs{0.01, 0.05, 0.10, 0.25, 0.50, 1.00} do
		local join_lo = 1
		local join_hi = math.max(1, math.min(n_authors, math.floor(n_authors * frac)))
		local p_join_range = {LO = join_lo, HI = join_hi}
		bench_query(('%s pk_join_seek (n=%d%%)'):format(label, frac * 100), function()
			return each_node(
				db:pk_join_seek(
					db:pk_range(author_tbl, '>=', 'LO', '<=', 'HI'), fk_name),
				p_join_range)
		end)
		bench_query(('%s pk_join_hash (n=%d%%)'):format(label, frac * 100), function()
			return each_node(
				db:pk_join_hash(
					db:pk_range(author_tbl, '>=', 'LO', '<=', 'HI'), fk_name),
				p_join_range)
		end)
	end
end

-- call sites (were in run_query_benchmarks, after the tag->post_tag->post join bench):
--   bench_join_sweep(db, 'author->post (u64)', 'author', 'post/author_id', N_AUTHORS)
--   bench_join_sweep(db, 'author32->post32 (u32)', 'author32', 'post32/author_id', N_AUTHORS)
-- and in create_query_db (after insert_post_tags):
--   create_u32_join_tables(db)
--   insert_u32_join_rows(db, N_AUTHORS, N_POSTS)
