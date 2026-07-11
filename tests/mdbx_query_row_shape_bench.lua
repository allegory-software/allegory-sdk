--go@ ~/sdk/bin/luajit -joff -lscite ~/sdk/tests/mdbx_query_row_shape_bench.lua
--
-- compare the actual rows() and rows_array() shapes with jit disabled.

require'glue'
require'mdbx_query'

if ... then return end

io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

local q = mdbx_query
local c = q.col

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

local ROWS = env_num('MDBX_BENCH_ROWS', 50000, 100)
local BENCH_TIME = env_float('MDBX_BENCH_SECONDS', 0.35, 0.01)
local WARMUP_RUNS = env_num('MDBX_BENCH_WARMUP', 2, 0)
local KEEP_FILES = os.getenv'MDBX_BENCH_KEEP'

local file = '/tmp/sdk_mdbx_query_row_shape_bench_'..uuid()..'.mdb'
local sink = 0

local function num(v)
	return v ~= nil and v ~= null and tonumber(v) or 0
end

local function cleanup()
	if KEEP_FILES then return end
	os.remove(file)
	os.remove(file..'-lck')
end

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
	printf('%-44s %9.1f q/s %11.0f rows/s %8.3f ms/q\n',
		name, runs / dt, rows / dt, dt * 1000 / runs)
end

local function create_db()
	cleanup()
	local db = mdbx_open(file)
	db:begin'w'
	db:create_table('rshape', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'a' , mdbx_type = 'u32', not_null = true},
		{col = 'b' , mdbx_type = 'u32'},
		{col = 'c' , mdbx_type = 'u32', not_null = true},
		{col = 'd' , mdbx_type = 'u32'},
	}, pk = {'id'}})
	local row = {}
	for id = 1, ROWS do
		row.id = id
		row.a = id
		row.b = id % 5 == 0 and null or id + 1
		row.c = id + 2
		row.d = id % 7 == 0 and null or id + 3
		db:insert('rshape', '{}', row)
	end
	db:commit()
	return db
end

local function make_rel(db)
	local rel = db:from('rshape r'):select{
		'r.a a',
		'r.b b',
		'r.c c',
		'r.d d',
	}
	rel:prepare'rows'
	return rel
end

local function rows_unpacked(rel)
	return function()
		local n, s = 0, 0
		for a, b, c, d in rel:rows() do
			s = s + num(a) + num(b) + num(c) + num(d)
			n = n + 1
		end
		sink = sink + s
		return n
	end
end

local function rows_array(rel)
	return function()
		local n, s = 0, 0
		for row in rel:rows'[]' do
			s = s + num(row[1]) + num(row[2]) + num(row[3]) + num(row[4])
			n = n + 1
		end
		sink = sink + s
		return n
	end
end

local function rows_named(rel)
	return function()
		local n, s = 0, 0
		for row in rel:rows'{}' do
			s = s + num(row.a) + num(row.b) + num(row.c) + num(row.d)
			n = n + 1
		end
		sink = sink + s
		return n
	end
end

local function collect_array(rel)
	return function()
		local rows = rel:rows_array()
		local s = 0
		for _, row in ipairs(rows) do
			s = s + num(row[1]) + num(row[2]) + num(row[3]) + num(row[4])
		end
		sink = sink + s
		return #rows
	end
end

local function collect_named(rel)
	return function()
		local rows = rel:rows_array'{}'
		local s = 0
		for _, row in ipairs(rows) do
			s = s + num(row.a) + num(row.b) + num(row.c) + num(row.d)
		end
		sink = sink + s
		return #rows
	end
end

local function main()
	printf_line('mdbx_query row shape benchmark')
	printf_line('rows=%d seconds=%.2f', ROWS, BENCH_TIME)

	local db = create_db()
	db:begin'r'
	local rel = make_rel(db)
	bench_query('rows() -> unpacked values', rows_unpacked(rel))
	bench_query("rows'[]' -> array rows", rows_array(rel))
	bench_query("rows'{}' -> named rows", rows_named(rel))
	bench_query('rows_array() -> array rows', collect_array(rel))
	bench_query("rows_array'{}' -> named rows", collect_named(rel))
	db:commit()
	db:close()

	if KEEP_FILES then
		printf_line('')
		printf_line('MDBX_BENCH_KEEP is set; file kept: %s', file)
	end
	printf_line('')
	printf_line('sink=%d', sink)
end

local ok, err = xpcall(main, debug.traceback)
cleanup()
if not ok then error(err) end
