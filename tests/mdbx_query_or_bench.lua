--go@ ~/sdk/bin/luajit -joff -lscite ~/sdk/tests/mdbx_query_or_bench.lua
--
-- jit off: matches this codebase's benchmarking convention (see
-- mdbx_query_builder_bench.lua's header).
--
-- mdbx_query.lua's q.or_() only optimizes a same-column equality OR into
-- in_(); a mixed-column or mixed-op OR (e.g. score > P OR status = S)
-- stays a residual row check over a single full scan (TODO_MDBX.txt).
-- The old mdbx_query_builder.lua's or_where() instead built one access
-- node per branch (index seek/range where possible) and merge_union'd
-- them. Two questions, both open before porting that mechanism:
--   1. when every OR branch is index-eligible, does per-branch access +
--      merge_union actually beat today's single-scan residual check?
--   2. when one branch has no matching index, or_where()'s fallback for
--      that branch is a full scan wrapped in pk_filter, merge_union'd
--      with the other branch's index scan -- does that ever beat a
--      plain single full scan with a residual OR check, or is it always
--      the same full scan plus pure sort/merge overhead on top?
--
-- Both sides are hand-built here from lua/mdbx_query_nodes.lua's node
-- primitives (pk_range/pk_seek/pk_sort/pk_filter/merge_union) rather
-- than through db:or_where(), because mdbx_query_builder.lua and
-- mdbx_query.lua both define Db:from on the same shared Db table and
-- can't be require'd in the same process without one silently
-- clobbering the other. The "proposed" plan below is exactly what
-- or_where() would build for this query shape (see its stage in
-- mdbx_query_builder.lua's OR CONDITIONS comment). The "current" side
-- runs the real q.or_() through mdbx_query.lua's actual :count() API.

require'glue'
require'mdbx_query_nodes'
require'mdbx_query'

if ... then return end

io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

local q = mdbx_query
local c = q.col
local p = q.param

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

local BENCH_TIME  = env_float('MDBX_BENCH_SECONDS', 0.35, 0.01)
local WARMUP_RUNS = env_num  ('MDBX_BENCH_WARMUP', 2, 0)

local function printf_line(...)
	printf(...)
	io.stdout:write'\n'
end

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
	printf('%-52s %9.1f q/s %8.3f ms/q %8.1f rows/q\n',
		name, runs / dt, dt * 1000 / runs, rows / runs)
end

--[[
post_or: id (pk), score and status each get their own single-column
index (both OR-branch columns in the mixed scenario); views has no
index (the OR branch that can't use one, in the second scenario).
moduli are pairwise coprime (97, 5, 997) so the three columns don't
line up with each other -- id % 97 doesn't determine id % 5.
]]
local N_POSTS = env_num('MDBX_BENCH_POSTS', 30000, 1)

local SCORE_VALUES = 97
local SCORE_THRESH = 87   --score > 87 selects 88..96, 9/97 ~= 9.3%
local STATUSES = {'draft', 'published', 'archived', 'review', 'pending'}
local STATUS_PICK = 'draft'  --1/5 = 20%
local VIEWS_VALUES = 997
local VIEWS_PICK = 500       --1/997 ~= 0.1%

local function create_db()
	local file = '/tmp/sdk_mdbx_query_or_bench_'..uuid()..'.mdb'
	os.remove(file); os.remove(file..'-lck')
	local db = mdbx_open(file)
	db:begin'w'
	db:create_table('post_or', {fields = {
		{col = 'id'    , mdbx_type = 'u32', not_null = true},
		{col = 'score' , mdbx_type = 'u32', not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
		{col = 'views' , mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('post_or', {'score'})
	db:add_index('post_or', {'status'})
	for id = 1, N_POSTS do
		db:insert('post_or', '{}', {
			id     = id,
			score  = id % SCORE_VALUES,
			status = STATUSES[(id % #STATUSES) + 1],
			views  = id % VIEWS_VALUES,
		})
	end
	db:commit()
	return db, file
end

local function count_node(node, params)
	node:open(params)
	local n = 0
	while node:next_item() do n = n + 1 end
	node:close()
	return n
end

--[[
scenario 1: score > P OR status = S, both branches index-eligible.
proposed: pk_range(score) sorted into pk order (it comes back in
score-index order), pk_seek(status) (already in pk order), merge_union'd.
current: mdbx_query.lua's q.or_() can't collapse a mixed-column OR into
in_(), so it's a residual check over a full scan.
]]
local function bench_mixed(db)
	printf_line('')
	printf_line('score > %d OR status = %q (both indexed, %d rows)',
		SCORE_THRESH, STATUS_PICK, N_POSTS)

	local params = {P = SCORE_THRESH, S = STATUS_PICK}

	local proposed = db:merge_union(
		db:pk_sort(db:pk_range('post_or/score', '>', 'P')),
		db:pk_seek('post_or/status', 'S'))

	local current = db:from('post_or')
		:where(q.or_(q.gt(c'score', p'P'), q.eq(c'status', p'S')))

	local n1 = count_node(proposed, params)
	local n2 = current:count(params)
	assert(n1 == n2 and n1 > 0, 'count mismatch: proposed='..n1..' current='..n2)
	printf_line('matched rows: %d', n1)

	bench_query('proposed: per-branch access + merge_union', function()
		return count_node(proposed, params)
	end)
	bench_query('current: q.or_() residual over full scan', function()
		return current:count(params)
	end)
end

--[[
scenario 2: score > P OR views = V, only score has an index.
proposed: same merge_union shape, but the views branch has no index to
seek, so or_where's own fallback applies -- a full scan wrapped in
pk_filter -- merge_union'd with the score branch.
current: same single full scan + residual OR check as scenario 1 (the
missing index on views doesn't change today's plan at all; it never
tried to use one).
]]
local function bench_unindexed_arm(db)
	printf_line('')
	printf_line('score > %d OR views = %d (score indexed, views not, %d rows)',
		SCORE_THRESH, VIEWS_PICK, N_POSTS)

	local params = {P = SCORE_THRESH, V = VIEWS_PICK}

	local views_fn
	local proposed = db:merge_union(
		db:pk_sort(db:pk_range('post_or/score', '>', 'P')),
		db:pk_filter(db:pk_range('post_or'), function(node, prm)
			if not views_fn then views_fn = node:compile_col('post_or', 'views') end
			return views_fn() == prm.V
		end))

	local current = db:from('post_or')
		:where(q.or_(q.gt(c'score', p'P'), q.eq(c'views', p'V')))

	local n1 = count_node(proposed, params)
	local n2 = current:count(params)
	assert(n1 == n2 and n1 > 0, 'count mismatch: proposed='..n1..' current='..n2)
	printf_line('matched rows: %d', n1)

	bench_query('proposed: merge_union (full scan fallback branch)', function()
		return count_node(proposed, params)
	end)
	bench_query('current: q.or_() residual over full scan', function()
		return current:count(params)
	end)
end

printf_line('mixed-column OR: per-branch access + merge_union vs single-scan residual check')
printf_line('N_POSTS=%d', N_POSTS)

local db, file = create_db()
db:begin'r'
bench_mixed(db)
bench_unindexed_arm(db)
db:commit()
db:close()
os.remove(file); os.remove(file..'-lck')
