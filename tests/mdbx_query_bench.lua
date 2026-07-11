--go@ ~/sdk/bin/luajit -joff -lscite ~/sdk/tests/mdbx_query_bench.lua
--
-- jit off: JIT warmup/trace-compilation timing swamps the actual effect
-- being measured for close comparisons -- see mdbx_query_builder_bench.lua's
-- own note on this for a concrete before/after example.
--
-- Benchmark home for lua/mdbx_query.lua (the new query engine), as opposed
-- to mdbx_query_builder_bench.lua which benchmarks the old
-- mdbx_query_builder.lua/mdbx_query_nodes.lua stack. Grows as gaps in
-- mdbx_query.lua's index-choosing/using get addressed one at a time.

require'glue'
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
local WARMUP_RUNS  = env_num  ('MDBX_BENCH_WARMUP', 2, 0)
local KEEP_FILES  = os.getenv'MDBX_BENCH_KEEP'

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

local function each_row(rows_iter)
	local n = 0
	for _ in rows_iter do n = n + 1 end
	sink = sink + n
	return n
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
	printf('%-46s %9.1f q/s %11.0f rows/s %8.3f ms/q %8.1f rows/q\n',
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
	printf('%-46s %9.1f ops/s %8.3f us/op\n',
		name, runs / dt, dt * 1000000 / runs)
end

--[[
dfx: one indexed key (k, u32) with many dups per key, fixed-size dup
values (a plain u32 PK) -- DUPFIXED-eligible, so compile_scan's
'exact' plan kind walks it via find_multiple_raw/next_multiple_raw
(bulk) instead of one MDBX_NEXT_DUP-equivalent call per row.
]]
local DFX_KEYS = 20
local DFX_DUPS_PER_KEY = 2000

local function create_dfx_db()
	local file = test_file'dfx'
	local db = mdbx_open(file)
	db:begin'w'
	db:create_table('dfx', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'k' , mdbx_type = 'u32', not_null = true},
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
DUPFIXED bulk multi-get vs forced one-dup-at-a-time, through the real
mdbx_query.lua :rows() API (not hand-rolled cursor ops) -- confirms the
win survives real query-engine overhead (row_ctx, decode_col, output
projection), not just the raw mdbx call sequence. MDBX_NODUPFIXED
(lua/mdbx_query.lua, compile_scan's walk_dups) forces the non-bulk
branch on the same physical dfx table for a controlled comparison.
]]
local function bench_dupfixed(db)
	printf_line('')
	printf_line('DUPFIXED bulk multi-get vs forced one-dup-at-a-time, through :rows() (%d dups/key)',
		DFX_DUPS_PER_KEY)
	local function q_dfx()
		return db:from('dfx d')
			:where(q.eq(c'd.k', p'K'))
			:select{'d.id id'}
	end
	bench_query('dfx/k (DUPFIXED bulk)', function()
		return each_row(q_dfx():rows{K = 1})
	end)
	MDBX_NODUPFIXED = true
	bench_query('dfx/k (non-DUPFIXED, forced)', function()
		return each_row(q_dfx():rows{K = 1})
	end)
	MDBX_NODUPFIXED = false
end

local function main()
	printf_line('mdbx_query benchmark')
	printf_line('seconds=%.2f', BENCH_TIME)

	local db = create_dfx_db()
	db:begin'r'
	bench_dupfixed(db)
	db:commit()
	db:close()

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
