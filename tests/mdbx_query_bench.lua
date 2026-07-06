--go@ ~/sdk/bin/luajit -lscite ~/sdk/tests/mdbx_query_bench.lua
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

local function main()
	printf_line('mdbx_query_builder benchmark')
	printf_line('posts=%d authors=%d categories=%d tags=%d seconds=%.2f',
		N_POSTS, N_AUTHORS, N_CATEGORIES, N_TAGS, BENCH_TIME)
	printf_line('insert_rows=%d existing_posts=%d', N_INSERT, N_EXISTING)

	local db = create_query_db()
	run_query_benchmarks(db)
	db:close()
	run_insert_benchmarks()

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
