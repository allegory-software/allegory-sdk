--go@ ~/sdk/bin/luajit -joff -lscite ~/sdk/tests/mdbx_query_nodes_pk_and_probe_bench.lua
--
-- jit off: matches this codebase's benchmarking convention (see
-- mdbx_query_builder_bench.lua's header).
--
-- pk_and_probe vs pk_filter for a same-table AND condition with no
-- composite index (driver index on `status`, residual condition on
-- `score`, separate single-column index on each). mdbx_query_builder.lua
-- has a "FIXED BY BENCH" note saying pk_and_probe lost to pk_filter in
-- both shapes tested and was dropped from the builder; the node stays,
-- unused. Rebenching found the winner actually depends on the probed
-- index's duplicate-group size, which the note's blanket phrasing
-- doesn't capture:
--   - fine-grained score column (many distinct values, small dup groups):
--     pk_and_probe wins -- its per-row cost is one GET_BOTH_RANGE probe,
--     cheaper than pk_filter's base-table seek + field decode. Measured
--     ~9% faster, jit off.
--   - coarse-grained score column (few distinct values, large dup groups):
--     pk_filter wins -- GET_BOTH_RANGE's cost grows with dup-group size,
--     while a base-table point lookup by PK doesn't scale with it.
--     Measured ~13%-25% faster, jit off.
-- Neither strategy is a universal winner, and choosing correctly would
-- need the runtime duplicate-group cardinality -- exactly the kind of
-- data-driven signal this codebase's query planner is designed to never
-- use (choose_access/lower() are structural, not statistics-driven).
--
-- Verdict: not worth adding. The only direction with a real margin
-- (coarse case, pk_filter) tops out around 25%, nowhere near this
-- codebase's 2x bar for taking on a new strategy (see e.g. hash_distinct
-- and pk_hash_filter's own bench notes). pk_and_probe stays unused by
-- the builder; this file exists to keep the numbers behind that call
-- honest and rerunnable instead of a one-line comment.

require'glue'
require'mdbx_query_nodes'

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

local N_POSTS     = env_num  ('MDBX_BENCH_POSTS'  , 30000, 1)
local BENCH_TIME  = env_float('MDBX_BENCH_SECONDS', 0.35 , 0.01)
local WARMUP_RUNS = env_num  ('MDBX_BENCH_WARMUP' , 2    , 0)

local function printf_line(...)
	printf(...)
	io.stdout:write'\n'
end

local function clock() return os.clock() end

local function bench_query(name, fn)
	collectgarbage()
	collectgarbage()
	for _ = 1, WARMUP_RUNS do fn() end
	local runs, rows = 0, 0
	local t0 = clock()
	local dt
	repeat
		rows = rows + fn()
		runs = runs + 1
		dt = clock() - t0
	until dt >= BENCH_TIME
	printf_line('%-24s %9.1f q/s %8.3f ms/q %8.1f rows/q',
		name, runs / dt, dt * 1000 / runs, rows / runs)
end

--status cycles every 6 ids ('draft' = 1/6); n_score_values controls the
--probed index's duplicate-group size (fewer values = bigger groups).
local function fill_post(db, n_posts, n_score_values)
	local statuses = {'draft', 'published', 'published', 'published', 'archived', 'review'}
	for id = 1, n_posts do
		local score = (id % 23 == 0) and nil or (id % n_score_values)
		db:insert('post', '{}', {
			id = id,
			status = statuses[(id % #statuses) + 1],
			score = score,
			title = 'post '..id,
		})
	end
end

--find a score value that actually co-occurs with status='draft', so the
--comparison exercises a real, nonzero result set (the two are
--independent-looking but both deterministic functions of id, so an
--arbitrarily picked score value can land on a zero-overlap residue by
--sheer modular coincidence). the returned count is a rough estimate for
--picking a good value, not asserted against (it doesn't account for the
--null-score rows at id % 23 == 0, since null vs 0 equality isn't the
--point of this bench).
local function pick_intersecting_score(n_posts, n_score_values)
	local statuses = {'draft', 'published', 'published', 'published', 'archived', 'review'}
	local counts = {} --{score->n}
	for id = 1, n_posts do
		if statuses[(id % #statuses) + 1] == 'draft' and id % 23 ~= 0 then
			local score = id % n_score_values
			counts[score] = (counts[score] or 0) + 1
		end
	end
	local best_score, best_n = nil, 0
	for score, n in pairs(counts) do
		if n > best_n then best_score, best_n = score, n end
	end
	return best_score, best_n
end

local function bench_shape(label, n_score_values)
	local db_file = '/tmp/sdk_pk_and_probe_bench_'..uuid()..'.mdb'
	os.remove(db_file); os.remove(db_file..'-lck')
	local db = mdbx_open(db_file)
	db:begin'w'
	db:create_table('post', {fields = {
		{col = 'id'    , mdbx_type = 'u32' , not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
		{col = 'score' , mdbx_type = 'i32' },
		{col = 'title' , mdbx_type = 'utf8', maxlen = 128, nozero = true, not_null = true},
	}, pk = {'id'}})
	db:add_index('post', {'status'})
	db:add_index('post', {'score'})
	fill_post(db, N_POSTS, n_score_values)
	db:commit()

	local s1 = 'draft'
	local s2 = pick_intersecting_score(N_POSTS, n_score_values)

	db:atomic('r', function()
		local probe_node = db:pk_and_probe(
			db:pk_seek('post/status', 'S1'),
			{ix = 'post/score', keys = {'S2'}})

		local filter_driver = db:pk_seek('post/status', 'S1')
		local score_fn --compiled once, reused every row (matches compile_scan's decoder cache)
		local filter_node = db:pk_filter(filter_driver, function(node, params)
			if not score_fn then score_fn = node:compile_col('post', 'score') end
			return score_fn() == params.S2
		end)

		local function count_with(node, params)
			node:open(params)
			local n = 0
			while node:next_item() do n = n + 1 end
			node:close()
			return n
		end

		local params = {S1 = s1, S2 = s2}
		local n1 = count_with(probe_node, params)
		local n2 = count_with(filter_node, params)
		assert(n1 == n2 and n1 > 0, 'count mismatch: probe='..n1..' filter='..n2)

		printf_line('')
		printf_line('%s: %d score values (status=%s and score=%s, %d rows)',
			label, n_score_values, s1, s2, n1)
		bench_query('pk_and_probe'      , function() return count_with(probe_node , params) end)
		bench_query('pk_filter'         , function() return count_with(filter_node, params) end)

		--full select: also read `title` for every row that passes.
		local probe_node2 = db:pk_and_probe(
			db:pk_seek('post/status', 'S1'),
			{ix = 'post/score', keys = {'S2'}})
		local filter_driver2 = db:pk_seek('post/status', 'S1')
		local score_fn2
		local filter_node2 = db:pk_filter(filter_driver2, function(node, p)
			if not score_fn2 then score_fn2 = node:compile_col('post', 'score') end
			return score_fn2() == p.S2
		end)
		local title_fn_probe, title_fn_filter
		local sink = 0

		local function select_with(node, get_title_fn, set_title_fn, params)
			node:open(params)
			local n = 0
			while node:next_item() do
				local title_fn = get_title_fn()
				if not title_fn then
					title_fn = node:compile_col('post', 'title')
					set_title_fn(title_fn)
				end
				sink = sink + #title_fn()
				n = n + 1
			end
			node:close()
			return n
		end

		bench_query('pk_and_probe+select', function()
			return select_with(probe_node2,
				function() return title_fn_probe end,
				function(f) title_fn_probe = f end, params)
		end)
		bench_query('pk_filter+select'   , function()
			return select_with(filter_node2,
				function() return title_fn_filter end,
				function(f) title_fn_filter = f end, params)
		end)
	end)

	db:close()
	os.remove(db_file); os.remove(db_file..'-lck')
end

printf_line('pk_and_probe vs pk_filter -- N_POSTS=%d', N_POSTS)
bench_shape('fine-grained score index  ', 1000)
bench_shape('coarse-grained score index', 10)
