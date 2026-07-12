--go@ ~/sdk/bin/luajit -joff -lscite ~/sdk/tests/mdbx_query_group_skip_bench.lua
--
-- standalone bench for mdbx_query.lua's distinct() gap: build_rows's
-- streaming distinct decodes every row and compares adjacent decoded
-- values, discarding duplicates in Lua instead of skipping them at the
-- cursor. Two questions:
--   1. does skipping duplicates at the cursor actually pay off, and at
--      what duplication ratio does it stop paying off?
--   2. does the skip mechanism matter -- MDBX_NEXT_NODUP (old
--      pk_group_first, index-only, group must be the whole key) vs a
--      general encode+increment_prefix+MDBX_SET_RANGE seek (also works
--      for a group shorter than the full key, and for plain tables)?
--
-- fixture: one table per ratio, indexed on a single 'k' column, filled
-- so consecutive ids share the same k in runs of dups-per-group.

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

local TOTAL_ROWS  = env_num  ('MDBX_BENCH_ROWS'   , 100000, 100)
local BENCH_TIME  = env_float('MDBX_BENCH_SECONDS', 0.35  , 0.01)
local RATIOS = {2, 10, 50, 200}

local function printf_line(...)
	printf(...)
	io.stdout:write'\n'
end

local file = '/tmp/sdk_mdbx_group_skip_bench_'..uuid()..'.mdb'
os.remove(file); os.remove(file..'-lck')
local db = mdbx_open(file)

local function table_name(ratio) return 'gs_r'..ratio end

db:begin'w'
for _, ratio in ipairs(RATIOS) do
	local tname = table_name(ratio)
	db:create_table(tname, {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'k' , mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index(tname, {'k'})
	local row = {}
	for id = 1, TOTAL_ROWS do
		row.id = id
		row.k = math.floor((id - 1) / ratio) + 1
		db:insert(tname, '{}', row)
	end
end
db:commit()
db:begin'r'

local function bench(fn)
	collectgarbage(); collectgarbage()
	fn() --warmup: page cache, decoder closures
	local runs, groups, t0 = 0, 0, clock()
	local dt
	repeat
		groups = groups + fn()
		runs = runs + 1
		dt = clock() - t0
	until dt >= BENCH_TIME
	return dt / runs, groups / runs
end

--[[
compute the smallest encoded key strictly after a byte prefix: same
algorithm as mdbx_query.lua's (local, unexported) increment_prefix,
reproduced here since this bench runs outside that module.
]]
local function increment_prefix(buf, sz)
	local i = sz - 1
	while i >= 0 and buf[i] == 255 do
		i = i - 1
	end
	if i < 0 then return nil end
	buf[i] = buf[i] + 1
	return i + 1
end

--today's mdbx_query.lua mechanism: decode every row, compare adjacent
--decoded k values, count a new group each time k changes.
local function bench_decode_all(schema)
	return function()
		local cur = db:cursor(schema.name)
		local ix_rec, pk_rec = MDBX_val(), MDBX_val()
		local decode_k = db:compile_col(schema, 'k', ix_rec, pk_rec, nil)
		local n = 0
		local prev
		local ok = cur:move_raw_into(C.MDBX_FIRST, ix_rec, pk_rec)
		while ok do
			local k = decode_k()
			if k ~= prev then n = n + 1; prev = k end
			ok = cur:move_raw_into(C.MDBX_NEXT, ix_rec, pk_rec)
		end
		cur:close()
		return n
	end
end

--old pk_group_first mechanism: only reachable here because the index
--key IS the whole group key (a single 'k' column) -- the literal
--DUPSORT boundary MDBX_NEXT_NODUP skips.
local function bench_next_nodup(schema)
	return function()
		local cur = db:cursor(schema.name)
		local ix_rec, pk_rec = MDBX_val(), MDBX_val()
		local decode_k = db:compile_col(schema, 'k', ix_rec, pk_rec, nil)
		local n = 0
		local ok = cur:move_raw_into(C.MDBX_FIRST, ix_rec, pk_rec)
		while ok do
			decode_k()
			n = n + 1
			ok = cur:move_raw_into(C.MDBX_NEXT_NODUP, ix_rec, pk_rec)
		end
		cur:close()
		return n
	end
end

--proposed general mechanism for mdbx_query.lua's compile_scan: also
--works for a group shorter than the full key and for plain tables,
--unlike MDBX_NEXT_NODUP -- at the cost of a root seek per group
--instead of a cursor-relative step.
local function bench_set_range_skip(schema)
	return function()
		local cur = db:cursor(schema.name)
		local ix_rec, pk_rec = MDBX_val(), MDBX_val()
		local decode_k = db:compile_col(schema, 'k', ix_rec, pk_rec, nil)
		local buf = u8a(MDBX_MAX_KEY_SIZE)
		local n = 0
		local ok = cur:move_raw_into(C.MDBX_FIRST, ix_rec, pk_rec)
		while ok do
			local k = decode_k()
			n = n + 1
			local sz = mdbx_encode_key_prefix(db, schema, 'get', buf,
				MDBX_MAX_KEY_SIZE, 1, false, k)
			sz = increment_prefix(buf, sz)
			if not sz then break end
			ix_rec.data, ix_rec.size = buf, sz
			ok = cur:move_raw_into(C.MDBX_SET_RANGE, ix_rec, pk_rec)
		end
		cur:close()
		return n
	end
end

printf_line('mdbx_query.lua distinct() group-skip mechanism comparison')
printf_line('total rows=%d, sweeping dups/group', TOTAL_ROWS)
for _, ratio in ipairs(RATIOS) do
	local schema = db:table_schema(table_name(ratio)..'/k')
	printf_line('')
	printf_line('-- dups/group=%d (groups=%d) --', ratio, TOTAL_ROWS / ratio)
	for _, case in ipairs{
		{'decode every row + adjacent compare', bench_decode_all},
		{'MDBX_NEXT_NODUP', bench_next_nodup},
		{'encode+increment+SET_RANGE', bench_set_range_skip},
	} do
		local name, mk = case[1], case[2]
		local dt, groups = bench(mk(schema))
		printf('%-38s %8.3f ms/scan %10.0f groups/s\n', name, dt * 1000, groups / dt)
	end
end

db:commit()
db:close()
os.remove(file); os.remove(file..'-lck')
