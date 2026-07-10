--go@ ~/sdk/bin/luajit -joff -lscite ~/sdk/tests/mdbx_query_builder_bench.lua
--
-- jit off: JIT warmup/trace-compilation timing swamps the actual effect
-- being measured for close comparisons (a left-join merge_join vs
-- pk_join_seek micro-benchmark below flipped from a clean 2x-4x win to
-- a loss once jit was disabled -- see bench_left_join_strategy).
--
-- Real-life-ish benchmark for mdbx_query_builder.
--
-- The query workload is a scaled blog/content model:
-- author/category -> post <- tag through post_tag.
--
-- The insert workload measures db:insert() into the same post shape with:
--   1. no secondary indexes and no FKs
--   2. secondary indexes only
--   3. secondary indexes plus FK checks
--
-- put_records() is intentionally not used because it refuses tables with
-- indexes or FKs and would skip the path being measured.

require'glue'
require'mdbx_query_builder'
local ffi = require'ffi'
local C = ffi.load'mdbx'

if ... then return end

io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

local function env_num(name, default, min_value)
	local v = tonumber(os.getenv(name))
	if not v then return default end
	v = math.floor(v)
	if min_value and v < min_value then return min_value end
	return v
end

local function env_float(name, default, min_value)
	local v = tonumber(os.getenv(name))
	if not v then return default end
	if min_value and v < min_value then return min_value end
	return v
end

local N_AUTHORS    = env_num  ('MDBX_BENCH_AUTHORS'       , 1000 , 1)
local N_CATEGORIES = env_num  ('MDBX_BENCH_CATEGORIES'    , 64   , 1)
local N_TAGS       = env_num  ('MDBX_BENCH_TAGS'          , 256  , 16)
local N_POSTS      = env_num  ('MDBX_BENCH_POSTS'         , 20000, 1)
local N_EXISTING   = env_num  ('MDBX_BENCH_EXISTING_POSTS', 10000, 0)
local N_INSERT     = env_num  ('MDBX_BENCH_INSERT_ROWS'   , 5000 , 1)
local BENCH_TIME   = env_float('MDBX_BENCH_SECONDS'       , 0.35 , 0.01)
local WARMUP_RUNS  = env_num  ('MDBX_BENCH_WARMUP'        , 2    , 0)
local KEEP_FILES   = os.getenv'MDBX_BENCH_KEEP'

local BASE_TIME = 1700000000
local statuses = {'draft', 'published', 'published', 'published', 'archived', 'review'}
local files = {}
local sink = 0

local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
end

local function cleanup_all()
	if KEEP_FILES then return end
	for _, file in ipairs(files) do
		cleanup(file)
	end
end

local function test_file(name)
	local file = '/tmp/sdk_mdbx_query_bench_'..name..'_'..uuid()..'.mdb'
	files[#files+1] = file
	cleanup(file)
	return file
end

local function printf_line(...)
	printf(...)
	io.stdout:write'\n'
end

local function fill_post(row, id, n_authors, n_categories)
	row.id = id
	row.author_id = ((id * 17) % n_authors) + 1
	row.category_id = ((id * 13) % n_categories) + 1
	row.status = statuses[(id % #statuses) + 1]
	row.ctime = BASE_TIME + id * 60
	if id % 23 == 0 then
		row.score = nil
	else
		row.score = (id * 37) % 1000
	end
	row.title = 'post '..id
	return row
end

local function post_tag_count(post_id)
	return post_id % 4
end

local function tag_id_for(post_id, j, n_tags)
	return ((post_id + j * 37) % n_tags) + 1
end

local function create_reference_tables(db, n_tags)
	db:create_table('author', {fields = {
		{col = 'id'    , mdbx_type = 'u64' , not_null = true},
		{col = 'name'  , mdbx_type = 'utf8', maxlen = 64, nozero = true, not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
	}, pk = {'id'}})
	db:add_index('author', {'status'})

	db:create_table('category', {fields = {
		{col = 'id'  , mdbx_type = 'u64' , not_null = true},
		{col = 'slug', mdbx_type = 'utf8', maxlen = 32, nozero = true, not_null = true},
		{col = 'name', mdbx_type = 'utf8', maxlen = 64, nozero = true, not_null = true},
	}, pk = {'id'}})
	db:add_index('category', {'slug', is_unique = true})

	if n_tags then
		db:create_table('tag', {fields = {
			{col = 'id'  , mdbx_type = 'u64' , not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 32, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('tag', {'name', is_unique = true})
	end
end

local function create_post_table(db)
	db:create_table('post', {fields = {
		{col = 'id'         , mdbx_type = 'u64' , not_null = true},
		{col = 'author_id'  , mdbx_type = 'u64' , not_null = true},
		{col = 'category_id', mdbx_type = 'u64' , not_null = true},
		{col = 'status'     , mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
		{col = 'ctime'      , mdbx_type = 'i64' , not_null = true},
		{col = 'score'      , mdbx_type = 'i64' },
		{col = 'title'      , mdbx_type = 'utf8', maxlen = 128, nozero = true, not_null = true},
	}, pk = {'id'}})
end

local function add_post_indexes(db)
	db:add_index('post', {'status'})
	db:add_index('post', {'ctime'})
	db:add_index('post', {'score'})
	db:add_index('post', {'author_id', 'ctime'})
	db:add_index('post', {'category_id', 'ctime'})
end

local function add_post_fks(db)
	db:add_fk{table = 'post', cols = {'author_id'},
		ref_table = 'author', ref_cols = {'id'}}
	db:add_fk{table = 'post', cols = {'category_id'},
		ref_table = 'category', ref_cols = {'id'}}
end

local function create_tag_link_table(db)
	db:create_table('post_tag', {fields = {
		{col = 'post_id', mdbx_type = 'u64', not_null = true},
		{col = 'tag_id' , mdbx_type = 'u64', not_null = true},
	}, pk = {'post_id', 'tag_id'}})
	db:add_fk{table = 'post_tag', cols = {'post_id'},
		ref_table = 'post', ref_cols = {'id'}}
	db:add_fk{table = 'post_tag', cols = {'tag_id'},
		ref_table = 'tag', ref_cols = {'id'}}
end

local function insert_reference_rows(db, n_authors, n_categories, n_tags)
	local author = {}
	for i = 1, n_authors do
		author.id = i
		author.name = 'author '..i
		author.status = i % 9 == 0 and 'inactive' or 'active'
		db:insert('author', '{}', author)
	end
	local category = {}
	for i = 1, n_categories do
		category.id = i
		category.slug = 'cat-'..i
		category.name = 'category '..i
		db:insert('category', '{}', category)
	end
	if n_tags then
		local tag = {}
		for i = 1, n_tags do
			tag.id = i
			tag.name = 'tag-'..i
			db:insert('tag', '{}', tag)
		end
	end
end

local function insert_posts(db, first_id, n, n_authors, n_categories)
	local row = {}
	for id = first_id, first_id + n - 1 do
		db:insert('post', '{}', fill_post(row, id, n_authors, n_categories))
	end
end

local function insert_post_tags(db, first_post_id, n_posts, n_tags)
	local row = {}
	for post_id = first_post_id, first_post_id + n_posts - 1 do
		row.post_id = post_id
		for j = 1, post_tag_count(post_id) do
			row.tag_id = tag_id_for(post_id, j, n_tags)
			db:insert('post_tag', '{}', row)
		end
	end
end

local function create_query_db()
	local file = test_file'query'
	local db = mdbx_open(file)
	local t0 = clock()
	db:begin'w'
	create_reference_tables(db, N_TAGS)
	create_post_table(db)
	add_post_indexes(db)
	add_post_fks(db)
	create_tag_link_table(db)
	insert_reference_rows(db, N_AUTHORS, N_CATEGORIES, N_TAGS)
	insert_posts(db, 1, N_POSTS, N_AUTHORS, N_CATEGORIES)
	insert_post_tags(db, 1, N_POSTS, N_TAGS)
	db:commit()
	local dt = clock() - t0
	printf_line('setup query db: %d posts, %d post_tag rows, %.2fs',
		N_POSTS, math.floor(N_POSTS * 1.5), dt)
	return db
end

local function each_row(q, params)
	local n = 0
	for _ in q:rows(params) do
		n = n + 1
	end
	sink = sink + n
	return n
end

local function each_node(node, params)
	node:open(params)
	local n = 0
	while node:next_group() do
		n = n + 1
	end
	node:close()
	sink = sink + n
	return n
end

local function bench_query(name, fn)
	collectgarbage()
	collectgarbage()
	for _ = 1, WARMUP_RUNS do fn() end
	local runs = 0
	local rows = 0
	local t0 = clock()
	local dt
	repeat
		rows = rows + fn()
		runs = runs + 1
		dt = clock() - t0
	until dt >= BENCH_TIME
	printf('%-36s %9.1f q/s %11.0f rows/s %8.3f ms/q %8.1f rows/q\n',
		name, runs / dt, rows / dt, dt * 1000 / runs, rows / runs)
end

-- same fk (all N_POSTS entries) throughout; driver size swept as a
-- fraction of N_AUTHORS. Three strategy comparisons, all on author<->post:
--   parent->child:  pk_join_seek     vs merge_join
--   child->parent:  pk_parent_lookup vs merge_join (roles reversed)
--   set difference: pk_hash_filter   vs merge_except (authors w/o posts)
-- merge_join/merge_except require their inputs already in ascending-PK
-- order; a plain pk_range on the base table (driver here) and
-- fk_parent_scan's output both qualify without an extra pk_sort, so this
-- is a fair like-for-like comparison, not one strategy paying a sort the
-- other doesn't.
local function bench_join_sweep(db, label, author_tbl, fk_name, n_authors)
	for _, frac in ipairs{0.01, 0.05, 0.10, 0.25, 0.50, 1.00} do
		local lo, hi = 1, math.max(1, math.min(n_authors, math.floor(n_authors * frac)))
		local p = {LO = lo, HI = hi}
		bench_query(('%s pk_join_seek (n=%d%%)'):format(label, frac * 100), function()
			return each_node(
				db:pk_join_seek(
					db:pk_range(author_tbl, '>=', 'LO', '<=', 'HI'), fk_name),
				p)
		end)
		bench_query(('%s merge_join (n=%d%%)'):format(label, frac * 100), function()
			return each_node(
				db:merge_join(
					db:pk_range(author_tbl, '>=', 'LO', '<=', 'HI'),
					db:pk_range(fk_name)),
				p)
		end)
	end
end

local function bench_parent_lookup_sweep(db, label, author_tbl, fk_name, n_authors)
	for _, frac in ipairs{0.01, 0.05, 0.10, 0.25, 0.50, 1.00} do
		local lo, hi = 1, math.max(1, math.min(n_authors, math.floor(n_authors * frac)))
		local p = {LO = lo, HI = hi}
		-- both driven by the same author_id-ordered post range, so the
		-- comparison isolates the parent-lookup strategy, not the input scan.
		bench_query(('%s pk_parent_lookup (n=%d%%)'):format(label, frac * 100), function()
			return each_node(
				db:pk_parent_lookup(
					db:pk_range(fk_name, '>=', 'LO', '<=', 'HI'), fk_name),
				p)
		end)
		bench_query(('%s merge_join rev (n=%d%%)'):format(label, frac * 100), function()
			return each_node(
				db:merge_join(
					db:pk_range(fk_name, '>=', 'LO', '<=', 'HI'),
					db:pk_range(author_tbl)),
				p)
		end)
	end
end

local function bench_except_sweep(db, label, author_tbl, fk_name, n_authors)
	for _, frac in ipairs{0.01, 0.05, 0.10, 0.25, 0.50, 1.00} do
		local lo, hi = 1, math.max(1, math.min(n_authors, math.floor(n_authors * frac)))
		local p = {LO = lo, HI = hi}
		bench_query(('%s pk_hash_filter not_in (n=%d%%)'):format(label, frac * 100), function()
			return each_node(
				db:pk_hash_filter(
					db:pk_range(author_tbl, '>=', 'LO', '<=', 'HI'),
					db:fk_parent_scan(fk_name),
					'not_in'),
				p)
		end)
		bench_query(('%s merge_except (n=%d%%)'):format(label, frac * 100), function()
			return each_node(
				db:merge_except(
					db:pk_range(author_tbl, '>=', 'LO', '<=', 'HI'),
					db:fk_parent_scan(fk_name)),
				p)
		end)
	end
end

--[[
all three sweeps above feed merge_join/merge_except a driver that's
already ascending-PK-ordered for free (a plain pk_range on the base
table), so they never pay for the pk_sort that pk_join_seek/pk_hash_filter
don't need either way -- a favorable case for the merge strategies that
doesn't show what happens when the driver isn't already sorted.

author/status (unbounded, both values) breaks that: it's ordered by
status first, so PK order resets at the status boundary (all 'active'
authors ascending by PK, then all 'inactive' ones, which are scattered
throughout the PK range, not just at the end). merge_join/merge_except
need an explicit pk_sort here to converge correctly; pk_join_seek/
pk_hash_filter tolerate the input in any order as-is and are unaffected.
This isolates the sort cost the sweeps above didn't have to pay.
]]
local function bench_unsorted_driver_cost(db, label, author_tbl, fk_name)
	local function driver() return db:pk_range(author_tbl..'/status') end
	bench_query(label..' pk_join_seek (unsorted driver)', function()
		return each_node(db:pk_join_seek(driver(), fk_name))
	end)
	bench_query(label..' merge_join (+pk_sort)', function()
		return each_node(db:merge_join(db:pk_sort(driver()), db:pk_range(fk_name)))
	end)
	bench_query(label..' pk_hash_filter not_in (unsorted driver)', function()
		return each_node(db:pk_hash_filter(driver(), db:fk_parent_scan(fk_name), 'not_in'))
	end)
	bench_query(label..' merge_except (+pk_sort)', function()
		return each_node(db:merge_except(db:pk_sort(driver()), db:fk_parent_scan(fk_name)))
	end)
end

local function bench_op(name, fn)
	collectgarbage()
	collectgarbage()
	for _ = 1, WARMUP_RUNS do fn() end
	local runs = 0
	local t0 = clock()
	local dt
	repeat
		fn()
		runs = runs + 1
		dt = clock() - t0
	until dt >= BENCH_TIME
	printf('%-36s %9.1f ops/s %8.3f us/op\n',
		name, runs / dt, dt * 1000000 / runs)
end

local function run_query_benchmarks(db)
	printf_line('')
	printf_line('query execution, cached lower() plans')
	printf_line('%-36s %13s %16s %13s %12s',
		'case', 'queries', 'rows', 'latency', 'rows/q')

	local hot_id = math.max(1, math.floor(N_POSTS * 0.61))
	local hot_author = ((hot_id * 17) % N_AUTHORS) + 1
	local hot_category = ((hot_id * 13) % N_CATEGORIES) + 1
	local hot_tag = 'tag-'..tag_id_for(hot_id, 1, N_TAGS)
	local lo_time = BASE_TIME + math.floor(N_POSTS * 0.25) * 60
	local hi_time = BASE_TIME + math.floor(N_POSTS * 0.90) * 60
	local since = BASE_TIME + math.floor(N_POSTS * 0.80) * 60

	db:begin'r'

	local q_pk = db:from'post'
		:where('id', 'ID')
		:select{'post.id id', 'post.title title'}
	local p_pk = {ID = hot_id}
	bench_query('post pk lookup + select', function()
		return each_row(q_pk, p_pk)
	end)

	local q_status_count = db:from'post'
		:where('status', 'STATUS')
	local p_published = {STATUS = 'published'}
	bench_query('count published posts', function()
		return q_status_count:count(p_published)
	end)

	local q_status_rows = db:from'post'
		:where('status', 'STATUS')
		:select{'post.id id', 'post.ctime ctime', 'post.title title'}
		:limit(1000)
	bench_query('read first 1000 published', function()
		return each_row(q_status_rows, p_published)
	end)

	local q_author_range = db:from'post'
		:where('author_id', 'AUTHOR')
		:between('ctime', 'LO', 'HI')
		:use_index('post', 'post/author_id,ctime')
		:select{'post.id id', 'post.ctime ctime', 'post.score score'}
	local p_author_range = {AUTHOR = hot_author, LO = lo_time, HI = hi_time}
	bench_query('author time range hinted index', function()
		return each_row(q_author_range, p_author_range)
	end)

	local q_feed_sort = db:from'post'
		:where('status', 'STATUS')
		:select{'post.id id', 'post.ctime ctime', 'post.title title'}
		:order_by'ctime desc'
		:limit(50)
	bench_query('published feed sort + limit', function()
		return each_row(q_feed_sort, p_published)
	end)

	local q_category_join = db:from'post'
		:where('category_id', 'CAT')
		:join'category'
		:select{'post.id post_id', 'category.slug slug', 'post.title title'}
		:limit(200)
	local p_category = {CAT = hot_category}
	bench_query('post -> category join', function()
		return each_row(q_category_join, p_category)
	end)

	local q_tag_join = db:from'tag'
		:where('name', 'TAG')
		:join'post_tag'
		:join'post'
		:select{'tag.name tag', 'post.id post_id', 'post.title title'}
	local p_tag = {TAG = hot_tag}
	bench_query('tag -> post_tag -> post join', function()
		return each_row(q_tag_join, p_tag)
	end)

	printf_line('')
	printf_line('join / set-op strategy comparison (author <-> post, u64 ids)')
	bench_join_sweep(db, 'author->post', 'author', 'post/author_id', N_AUTHORS)
	bench_parent_lookup_sweep(db, 'post->author', 'author', 'post/author_id', N_AUTHORS)
	bench_except_sweep(db, 'author w/o post', 'author', 'post/author_id', N_AUTHORS)
	bench_unsorted_driver_cost(db, 'author->post', 'author', 'post/author_id')
	printf_line('')

	local q_has_posts = db:from'category'
		:where_has'post'
	bench_query('categories with posts', function()
		return q_has_posts:count()
	end)

	local q_author_exists = db:from'author a'
		:where_exists(db:from'post'
			:where('author_id', mdbx_outer'a.id')
			:where('status', 'STATUS')
			:where('ctime', '>=', 'SINCE'))
	local p_author_exists = {STATUS = 'published', SINCE = since}
	bench_query('authors with recent published', function()
		return q_author_exists:count(p_author_exists)
	end)

	local q_status_or = db:from'post'
		:where('status', 'S1')
		:or_where('status', 'S2')
	bench_query('status draft OR review', function()
		return q_status_or:count({S1 = 'draft', S2 = 'review'})
	end)

	local q_group_status = db:from'post'
		:group_by'status'
		:agg{
			{name = 'n', op = 'count'},
			{name = 'avg_score', op = 'avg', member = 'post', col = 'score'},
		}
	bench_query('group posts by status', function()
		return each_row(q_group_status)
	end)

	local q_distinct_status = db:from'post'
		:select{'post.status'}
		:distinct{'post.status'}
	bench_query('distinct statuses', function()
		return each_row(q_distinct_status)
	end)

	db:commit()

	printf_line('')
	printf_line('query planning/lowering only')
	bench_op('lower simple indexed query', function()
		db:from'post'
			:where('status', 'STATUS')
			:select{'post.id id'}
			:lower()
	end)
	bench_op('lower three-table join', function()
		db:from'tag'
			:where('name', 'TAG')
			:join'post_tag'
			:join'post'
			:select{'tag.name tag', 'post.id post_id'}
			:lower()
	end)
	bench_op('lower correlated exists', function()
		db:from'author a'
			:where_exists(db:from'post'
				:where('author_id', mdbx_outer'a.id')
				:where('status', 'STATUS')
				:where('ctime', '>=', 'SINCE'))
			:lower()
	end)
end

local function create_insert_db(name, with_indexes, with_fks)
	local file = test_file(name)
	local db = mdbx_open(file)
	db:begin'w'
	create_reference_tables(db, nil)
	create_post_table(db)
	if with_indexes then
		add_post_indexes(db)
	end
	if with_fks then
		add_post_fks(db)
	end
	insert_reference_rows(db, N_AUTHORS, N_CATEGORIES, nil)
	if N_EXISTING > 0 then
		insert_posts(db, 1, N_EXISTING, N_AUTHORS, N_CATEGORIES)
	end
	db:commit()
	return db
end

local function bench_insert_case(name, with_indexes, with_fks)
	local db = create_insert_db(name, with_indexes, with_fks)
	collectgarbage()
	collectgarbage()
	local first_id = N_EXISTING + 1
	local t0 = clock()
	db:begin'w'
	insert_posts(db, first_id, N_INSERT, N_AUTHORS, N_CATEGORIES)
	db:commit()
	local dt = clock() - t0
	printf('%-36s %10.0f rows/s %8.3f us/row %8.2f s\n',
		name, N_INSERT / dt, dt * 1000000 / N_INSERT, dt)
	db:close()
end

local function run_insert_benchmarks()
	printf_line('')
	printf_line('bulk insert into post, one write transaction')
	printf_line('existing rows before measured insert: %d', N_EXISTING)
	bench_insert_case('insert no indexes/fks', false, false)
	bench_insert_case('insert maintained indexes', true, false)
	bench_insert_case('insert indexes + FK checks', true, true)
end

--[[
dedicated fixtures for join/group strategy comparisons that don't fit
the author/post/tag shape above:
  lp/lc_*: one-to-many parent->child with a controllable match rate
    (fraction of parents with >=1 child), for the left-join comparison.
  p/c1/c2: two one-to-many children of the same parent in the same key
    space, for the n-ary merge_join comparison.
  gx: two-column indexed table with real per-key duplication, for the
    distinct-group-by prefix comparison.
]]
local N_LP = 40000
local LP_CHILDREN_PER_MATCH = 3
local N_P = 40000
local P_K1, P_K2 = 3, 2
local GX_A, GX_B, GX_DUPS = 20, 20, 200
local N_TIX_SMALL = 50
local N_TIX_BIG = 2000000
local DFX_KEYS = 20
local DFX_DUPS_PER_KEY = 2000
local N_UC_SMALL, N_UC_MED, N_UC_BIG = 1000, 20000, 100000

local function create_strategy_db()
	local file = test_file'strategy'
	local db = mdbx_open(file)
	db:begin'w'

	db:create_table('lp', {fields = {
		{col = 'id', mdbx_type = 'u64', not_null = true},
	}, pk = {'id'}})
	local function make_lc(name)
		db:create_table(name, {fields = {
			{col = 'id', mdbx_type = 'u64', not_null = true},
			{col = 'parent_id', mdbx_type = 'u64', not_null = true},
		}, pk = {'id'}})
		db:add_index(name, {'parent_id'})
		db:add_fk{table = name, cols = {'parent_id'},
			ref_table = 'lp', ref_cols = {'id'}}
	end
	make_lc('lc_full')
	make_lc('lc_half')
	make_lc('lc_none')

	db:create_table('p', {fields = {
		{col = 'id', mdbx_type = 'u64', not_null = true},
	}, pk = {'id'}})
	local function make_pc(name)
		db:create_table(name, {fields = {
			{col = 'id', mdbx_type = 'u64', not_null = true},
			{col = 'parent_id', mdbx_type = 'u64', not_null = true},
		}, pk = {'id'}})
		db:add_index(name, {'parent_id'})
		db:add_fk{table = name, cols = {'parent_id'},
			ref_table = 'p', ref_cols = {'id'}}
	end
	make_pc('c1')
	make_pc('c2')

	db:create_table('gx', {fields = {
		{col = 'id', mdbx_type = 'u64', not_null = true},
		{col = 'a' , mdbx_type = 'u64', not_null = true},
		{col = 'b' , mdbx_type = 'u64', not_null = true},
	}, pk = {'id'}})
	db:add_index('gx', {'a', 'b'})

	local function make_tix(name)
		db:create_table(name, {fields = {
			{col = 'id', mdbx_type = 'u64', not_null = true},
			{col = 'k' , mdbx_type = 'u64', not_null = true},
		}, pk = {'id'}})
		db:add_index(name, {'k'})
	end
	make_tix('tix_small')
	make_tix('tix_big')

	-- deliberately unindexed on k: the correlated exists()/not_exists()
	-- fallback case (no index to seek), for bench_unindexed_exists below.
	local function make_uc(name)
		db:create_table(name, {fields = {
			{col = 'id', mdbx_type = 'u64', not_null = true},
			{col = 'k' , mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
	end
	make_uc('uc_small')
	make_uc('uc_med')
	make_uc('uc_big')

	local row = {}
	for id = 1, N_LP do row.id = id; db:insert('lp', '{}', row) end
	local crow = {}
	local next_full, next_half = 1, 1
	for pid = 1, N_LP do
		for k = 1, LP_CHILDREN_PER_MATCH do
			crow.id = next_full; crow.parent_id = pid
			db:insert('lc_full', '{}', crow)
			next_full = next_full + 1
		end
		if pid % 2 == 0 then
			for k = 1, LP_CHILDREN_PER_MATCH do
				crow.id = next_half; crow.parent_id = pid
				db:insert('lc_half', '{}', crow)
				next_half = next_half + 1
			end
		end
	end
	-- lc_none: one child far outside the swept range; ~0% match.
	crow.id = 1; crow.parent_id = N_LP
	db:insert('lc_none', '{}', crow)

	for id = 1, N_P do row.id = id; db:insert('p', '{}', row) end
	local nid = 1
	for pid = 1, N_P do
		for k = 1, P_K1 do
			crow.id = nid; crow.parent_id = pid
			db:insert('c1', '{}', crow)
			nid = nid + 1
		end
	end
	nid = 1
	for pid = 1, N_P do
		for k = 1, P_K2 do
			crow.id = nid; crow.parent_id = pid
			db:insert('c2', '{}', crow)
			nid = nid + 1
		end
	end

	local gxrow = {}
	local gid = 1
	for a = 1, GX_A do
		for b = 1, GX_B do
			for k = 1, GX_DUPS do
				gxrow.id = gid; gxrow.a = a; gxrow.b = b
				db:insert('gx', '{}', gxrow)
				gid = gid + 1
			end
		end
	end

	for id = 1, N_TIX_SMALL do db:insert('tix_small', '{}', {id = id, k = id}) end
	for id = 1, N_TIX_BIG do db:insert('tix_big', '{}', {id = id, k = id}) end

	-- k scattered, not ascending with id: a rescan's expected stop position
	-- for an existing match is ~m/2, not near the start of the table --
	-- an ascending fill would understate the rescan cost being measured.
	local function fill_uc(name, m)
		local row = {}
		for id = 1, m do
			row.id = id
			row.k = ((id * 2654435761) % m) + 1
			db:insert(name, '{}', row)
		end
	end
	fill_uc('uc_small', N_UC_SMALL)
	fill_uc('uc_med', N_UC_MED)
	fill_uc('uc_big', N_UC_BIG)

	db:create_table('dfx', {fields = {
		{col = 'id', mdbx_type = 'u64', not_null = true},
		{col = 'k' , mdbx_type = 'u64', not_null = true},
	}, pk = {'id'}})
	db:add_index('dfx', {'k'})
	local nid = 1
	for k = 1, DFX_KEYS do
		for _ = 1, DFX_DUPS_PER_KEY do
			db:insert('dfx', '{}', {id = nid, k = k})
			nid = nid + 1
		end
	end

	db:commit()
	return db
end

--[[
left join strategy: pk_join_seek(left=true) vs merge_join + db.left,
across match rate (fraction of parents with >=1 child). With the JIT
on, merge_join looked like a 2x-4x win here, which briefly motivated
dropping mdbx_query_builder.lua's "not j.left" restriction on merge_ok
-- but that was a JIT warmup artifact: with the JIT off (see go@ above),
pk_join_seek(left=true) is consistently faster instead, so "not j.left"
stays. Kept here as a permanent record and regression check.
]]
local function bench_left_join_strategy(db)
	printf_line('')
	printf_line('left join strategy (parent->child, one-to-many)')
	for _, child in ipairs{'lc_full', 'lc_half', 'lc_none'} do
		bench_query(('pk_join_seek left=true  (%s)'):format(child), function()
			return each_node(db:pk_join_seek(
				db:pk_range('lp'), child..'/parent_id', {left = true}))
		end)
		bench_query(('merge_join db.left       (%s)'):format(child), function()
			return each_node(db:merge_join(
				db:pk_range('lp'), db.left(db:pk_range(child..'/parent_id'))))
		end)
	end
end

--[[
n-ary merge_join vs chained pk_join_seek for two parent->child joins in
the same key space (root -> c1, root -> c2). n-ary is the only correct
option of the two: chaining two binary merge_join calls silently drops
rows when both sides have real duplicate fan-out for the same key
(verified separately -- a chained-binary repro returned 10 of an
expected 30 rows for a 3x2 per-parent cross product). Speed-wise,
n-ary looked ~35% faster with the JIT on, but with the JIT off (see
go@ above) it's consistently a slight loss instead -- another JIT
warmup artifact, not a real effect. NOT wired into the builder; kept
here so that decision has a number attached to it.
]]
local function bench_nary_merge_strategy(db)
	printf_line('')
	printf_line('n-ary merge_join vs chained pk_join_seek (2 one-to-many joins, same key space)')
	for _, frac in ipairs{0.01, 0.05, 0.10, 0.25, 0.50, 1.00} do
		local lo, hi = 1, math.max(1, math.floor(N_P * frac))
		local p = {LO = lo, HI = hi}
		bench_query(('chained pk_join_seek (n=%d%%)'):format(frac * 100), function()
			return each_node(
				db:pk_join_seek(
					db:pk_join_seek(
						db:pk_range('p', '>=', 'LO', '<=', 'HI'), 'c1/parent_id'),
					'c2/parent_id'),
				p)
		end)
		bench_query(('n-ary merge_join     (n=%d%%)'):format(frac * 100), function()
			return each_node(
				db:merge_join(
					db:pk_range('p', '>=', 'LO', '<=', 'HI'),
					db:pk_range('c1/parent_id'),
					db:pk_range('c2/parent_id')),
				p)
		end)
	end
end

--[[
distinct group_by(a,b) with an equality filter on the leading index
column: current fallback (hash_aggregate over a full select of matching
rows) vs pk_group_first's prefix-arg support (NEXT_NODUP skips duplicate
(a,b) rows entirely). Several hundred x in the exploratory bench that
motivated the grp_ix extension in mdbx_query_builder.lua's lower()
("group index" comment) -- an algorithmic difference (skipping
duplicate rows entirely, not a constant-factor speedup), so unlike the
two strategies above this one holds with the JIT off too. Kept here as
a permanent record.
]]
local function bench_grp_ix_prefix_strategy(db)
	printf_line('')
	printf_line('distinct group_by(a,b) with equality filter on leading col')
	local p = {A = 7}
	bench_query('current: hash_aggregate(select(pk_range))', function()
		local node = db:pk_range('gx/a,b', {prefix = true, n_fixed_params = 1}, 'A')
		local outputs = {
			{name = 'a', fn = function(n) return n:col('gx', 'a') end},
			{name = 'b', fn = function(n) return n:col('gx', 'b') end},
		}
		local vnode = db:hash_aggregate(db:select(node, outputs), {'a', 'b'},
			{{name = 'a', op = 'key', part = 1}, {name = 'b', op = 'key', part = 2}})
		return each_node(vnode, p)
	end)
	bench_query('proposed: pk_group_first(ix, A) + stream_aggregate', function()
		local node = db:pk_group_first('gx/a,b', 'A')
		local cols = {{member = 'gx', col = 'a'}, {member = 'gx', col = 'b'}}
		local vnode = db:stream_aggregate(node, cols,
			{{name = 'a', op = 'key', part = 1}, {name = 'b', op = 'key', part = 2}})
		return each_node(vnode, p)
	end)
end

--[[
use_counts tie-break: db:table_entries(ix) is used only to break a score
tie between two candidate indexes in build_access, preferring the one with
fewer entries. An exact-match pk_seek is an mdbx btree lookup, O(log n) in
entries with a large fanout per page, so the entries-count gap needed to
move tree depth by even one level is enormous. Compares single-row seek
latency on a 50-entry unique index against a 2,000,000-entry unique index
(same key shape, same result shape -- 1 row each -- so this isolates seek
cost from row-iteration cost).
]]
local function bench_use_counts_tiebreak(db)
	printf_line('')
	printf_line('pk_seek latency vs index entry count (use_counts tie-break rationale)')
	printf_line('tix_small/k entries=%d  tix_big/k entries=%d',
		db:table_entries'tix_small/k', db:table_entries'tix_big/k')
	bench_query('pk_seek small index (tix_small/k, 50 entries)', function()
		return each_node(db:pk_seek('tix_small/k', 'K'), {K = 25})
	end)
	bench_query('pk_seek big index (tix_big/k, 2000000 entries)', function()
		return each_node(db:pk_seek('tix_big/k', 'K'), {K = 1000000})
	end)
end

--[[
hash_aggregate vs value_sort+pk_group+stream_aggregate for a distinct
group_by(a,b) with no natural order (no matching index prefix, driver in
PK order). This is the fallback in lower()'s step 7 when
group_ordered(node, grp_cols) is false. The doc comment called the
alternative "pk_sort+pk_group"; the actual alternative is value_sort (sorts
by the group columns) + pk_group, since pk_sort only normalises PK order
and doesn't touch a,b order at all -- corrected here. Reasoning was
asymptotic (O(n) hash pass vs O(n log n) sort-then-stream); this confirms
it holds in practice, not just in theory.
]]
local function bench_hash_vs_sort_group(db)
	printf_line('')
	printf_line('group_by(a,b) with no natural order: hash_aggregate vs value_sort+pk_group')
	local agg = {
		{name = 'a', op = 'key', part = 1},
		{name = 'b', op = 'key', part = 2},
		{name = 'cnt', op = 'count'},
	}
	bench_query('hash_aggregate(select(pk_range))', function()
		local outputs = {
			{name = 'a', fn = function(n) return n:col('gx', 'a') end},
			{name = 'b', fn = function(n) return n:col('gx', 'b') end},
		}
		local vnode = db:hash_aggregate(db:select(db:pk_range('gx'), outputs),
			{'a', 'b'}, agg)
		return each_node(vnode)
	end)
	bench_query('value_sort+pk_group+stream_aggregate', function()
		local cols = {{member = 'gx', col = 'a'}, {member = 'gx', col = 'b'}}
		local sorted = db:value_sort(db:pk_range('gx'), cols)
		local vnode = db:stream_aggregate(db:pk_group(sorted, cols), cols, agg)
		return each_node(vnode)
	end)
end

--[[
pk_seek's DUPFIXED bulk-read path (MDBX_SEEK_AND_GET_MULTIPLE / NEXT_MULTIPLE,
whole pages of same-key dups per call) vs a forced one-dup-at-a-time walk
(MDBX_SET_KEY then MDBX_NEXT_DUP), bypassing pk_seek and driving both
cursor op sequences by hand. The bulk side must still walk the returned
buffer one fixed-size chunk at a time (not just sum bytes per page) --
pk_seek's next_group() has to yield one row per call regardless of which
branch it's in, so a bench that doesn't pay that same per-row cost isn't
comparable to what the node actually does.
]]
local function bench_dupfixed_bulk_read(db)
	printf_line('')
	printf_line('DUPFIXED bulk multi-get vs forced one-dup-at-a-time (%d dups/key)',
		DFX_DUPS_PER_KEY)
	local cur = db:cursor('dfx/k')
	local ok, k, k_sz = cur:first_raw()
	assert(ok, 'dfx/k: empty index')
	local key = u8a(k_sz); copy(key, k, k_sz)

	bench_query('bulk, walked one row at a time (SEEK_AND_GET_MULTIPLE/NEXT_MULTIPLE)', function()
		local n = 0
		local ok, v, v_sz = cur:find_multiple_raw(key, k_sz)
		if ok then
			local v_o = 0
			while true do
				if v_o >= v_sz then
					ok, v, v_sz = cur:next_multiple_raw()
					if not ok then break end
					v_o = 0
				end
				n = n + 1
				v_o = v_o + 8  -- 8 = sizeof(u64 pk)
			end
		end
		return n
	end)
	local val = MDBX_val()
	bench_query('forced one-at-a-time (SET_KEY/NEXT_DUP)', function()
		local n = 0
		if cur:find_raw(key, k_sz) then
			n = 1
			while cur:move_raw_into(C.MDBX_NEXT_DUP, nil, val) do n = n + 1 end
		end
		return n
	end)
	cur:close()
end

--[[
same DUPFIXED question, but through the real db:pk_seek node instead of
hand-rolled cursor ops -- the raw-cursor bench above proves the algorithm
wins, this one checks the actual mdbx_query_nodes.lua code preserves that
win rather than losing it to Lua/FFI/node overhead. MDBX_NODUPFIXED
(mdbx_query_nodes.lua, pk_seek) forces the non-DUPFIXED branch on the same
physical dfx table -- no separate table needed, no confound: MDBX_NEXT_DUP
works fine on a DUPFIXED-flagged table, DUPFIXED only adds the bulk ops.
]]
local function bench_dupfixed_node(db)
	printf_line('')
	printf_line('pk_seek DUPFIXED vs non-DUPFIXED, through the real node (%d dups/key)',
		DFX_DUPS_PER_KEY)
	bench_query('dfx/k (DUPFIXED)', function()
		return each_node(db:pk_seek('dfx/k', 'K'), {K = 1})
	end)
	MDBX_NODUPFIXED = true
	bench_query('dfx/k (non-DUPFIXED, forced)', function()
		return each_node(db:pk_seek('dfx/k', 'K'), {K = 1})
	end)
	MDBX_NODUPFIXED = false
end

--[[
pk_join_seek's wide vs narrow fk path: narrow (single-col fk, p/c1 here)
walks children via MDBX_NEXT_DUP; wide walks a pk_prefix key range instead.
MDBX_WIDEFK forces the wide branch on the same narrow-fk table.
]]
local function bench_widefk_node(db)
	printf_line('')
	printf_line('pk_join_seek narrow vs forced-wide fk path (p/c1, %d children/parent)', P_K1)
	bench_query('c1/parent_id (narrow)', function()
		return each_node(db:pk_join_seek(db:pk_range('p'), 'c1/parent_id'))
	end)
	MDBX_WIDEFK = true
	bench_query('c1/parent_id (wide, forced)', function()
		return each_node(db:pk_join_seek(db:pk_range('p'), 'c1/parent_id'))
	end)
	MDBX_WIDEFK = false
end

--[[
correlated exists()/not_exists() with no index on the correlation column:
mdbx_query.lua's compile_scan 'full' plan restarts from cur:first_raw()
on every outer row it's probed for (see open_exists_source/
eval_exists_source there) -- O(outer rows * table size) worst case. This
isolates that reopen-and-rescan-to-first-match cost against a build-once
Lua hash set + O(1) probe (the pk_hash_filter strategy), swept across
increasing unindexed table sizes.

pk_join_hash (.unused/mdbx_query_nodes_unused.lua) already tried an
O(n+m) hash vs O(n log m) pk_join_seek and never won, at any driver
fraction, u64 or u32 keys. That was hash vs an already-indexed seek
though -- this targets the worse baseline (O(m) unindexed rescan, not
O(log m)) that's the actual reason this comparison is being run again.

the rescan branch here goes through db:pk_range(name):open()/:close()
per probe, which reopens a cursor each time -- mdbx_query.lua's own
'full' plan reuses one already-open cursor across probes within one
execution (fixed earlier), so this rescan branch pays a small extra
cost real code doesn't. that biases toward finding a hash win, not
away from it, so a clean loss here is decisive; a win needs a tighter
follow-up (reused cursor, real compile_scan) before trusting it.

build cost is reported separately (bench_op, one-time) from probe-only
cost (bench_query, set already built): a real execution pays build once
then probes once per outer row, so whether hash wins depends on outer
row count, not just table size.
]]
local function bench_unindexed_exists(db, name, m)
	printf_line('')
	printf_line('correlated exists(), no index on correlation column (%s, m=%d)', name, m)

	--[[
	targets are k-values read back from rows spread evenly across the
	whole id range, plus guaranteed misses (k never exceeds m). cycling
	through a fixed precomputed list keeps sampled match positions spread
	across the full table no matter how many bench_query iterations
	actually run -- a live counter fed straight into the same scatter
	formula used to fill k would stay in lockstep with low ids (a 0.35s
	run for a large m never advances the counter past the first few
	hundred ids, so every rescan would falsely find its match near the
	very start of the table every time).
	]]
	local N_HITS, N_MISSES = 48, 16
	local targets = {}
	do
		local node = db:pk_range(name)
		node:open{}
		local k_fn = node:compile_col(name, 'k')
		local id, step = 0, math.max(1, math.floor(m / N_HITS))
		while node:next_item() do
			id = id + 1
			if id % step == 0 and #targets < N_HITS then
				targets[#targets + 1] = k_fn()
			end
		end
		node:close()
		for i = 1, N_MISSES do targets[#targets + 1] = m + i end
	end

	local probe_i = 0
	local function next_target()
		probe_i = probe_i + 1
		return targets[(probe_i - 1) % #targets + 1]
	end

	bench_query('full rescan per probe (current fallback mechanism)', function()
		local target = next_target()
		local node = db:pk_range(name)
		node:open{}
		local k_fn = node:compile_col(name, 'k')
		local found = 0
		while node:next_item() do
			if k_fn() == target then found = 1; break end
		end
		node:close()
		return found
	end)

	bench_op(('hash set build (one-time cost, m=%d)'):format(m), function()
		local node = db:pk_range(name)
		node:open{}
		local k_fn = node:compile_col(name, 'k')
		local set = {}
		while node:next_item() do set[k_fn()] = true end
		node:close()
	end)

	local node = db:pk_range(name)
	node:open{}
	local k_fn = node:compile_col(name, 'k')
	local set = {}
	while node:next_item() do set[k_fn()] = true end
	node:close()
	bench_query('hash probe only (set already built)', function()
		local target = next_target()
		return set[target] and 1 or 0
	end)
end

local function run_strategy_benchmarks()
	printf_line('')
	printf_line('join/group strategy micro-benchmarks (dedicated fixtures)')
	local db = create_strategy_db()
	db:begin'r'
	bench_left_join_strategy(db)
	bench_nary_merge_strategy(db)
	bench_grp_ix_prefix_strategy(db)
	bench_use_counts_tiebreak(db)
	bench_hash_vs_sort_group(db)
	bench_dupfixed_bulk_read(db)
	bench_dupfixed_node(db)
	bench_widefk_node(db)
	bench_unindexed_exists(db, 'uc_small', N_UC_SMALL)
	bench_unindexed_exists(db, 'uc_med', N_UC_MED)
	bench_unindexed_exists(db, 'uc_big', N_UC_BIG)
	db:commit()
	db:close()
end

local function main()
	printf_line('mdbx_query_builder benchmark')
	printf_line('posts=%d authors=%d categories=%d tags=%d seconds=%.2f',
		N_POSTS, N_AUTHORS, N_CATEGORIES, N_TAGS, BENCH_TIME)
	printf_line('insert_rows=%d existing_posts=%d', N_INSERT, N_EXISTING)

	local db = create_query_db()
	run_query_benchmarks(db)
	db:close()
	run_insert_benchmarks()
	run_strategy_benchmarks()

	if KEEP_FILES then
		printf_line('')
		printf_line('MDBX_BENCH_KEEP is set; files kept:')
		for _, file in ipairs(files) do
			printf_line('%s', file)
		end
	end
	printf_line('')
	printf_line('sink=%d', sink)
end

local ok, err = xpcall(main, debug.traceback)
cleanup_all()
if not ok then error(err) end
