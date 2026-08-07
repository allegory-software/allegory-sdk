--[[
	mdbx-query-node nested-loop join benchmark: same table shape and op
	sequence as tests/mdbx_join_bench.c and mdbx_join_bench.lua
	(MDBX_FIRST/MDBX_NEXT driver over author, MDBX_SET_KEY/MDBX_NEXT_DUP
	per author on the FK index) but driven through db:pk_range +
	db:pk_join_seek (mdbx_query_nodes.lua) instead of raw FFI calls.
	Compares against the other two to isolate query-node abstraction
	overhead from unavoidable MDBX cost.
]]

require'mdbx_query_builder'
local ffi = require'ffi'
local C = ffi.load'mdbx'

jit.off()

local N_AUTHORS = tonumber(os.getenv'MDBX_BENCH_AUTHORS') or 1000
local N_POSTS   = tonumber(os.getenv'MDBX_BENCH_POSTS') or 200000
local DURATION  = tonumber(os.getenv'MDBX_BENCH_SECONDS') or 3.0

local file = '/tmp/sdk_mdbx_join_bench_nodes.mdb'
os.remove(file); os.remove(file..'-lck')
local db = mdbx_open(file)
db:begin'w'
db:create_table('author', {fields = {
	{col = 'id', mdbx_type = 'u32', not_null = true},
}, pk = {'id'}})
db:create_table('post', {fields = {
	{col = 'id'       , mdbx_type = 'u32', not_null = true},
	{col = 'author_id', mdbx_type = 'u32', not_null = true},
}, pk = {'id'}})
db:add_fk{table = 'post', cols = {'author_id'},
	ref_table = 'author', ref_cols = {'id'}}
for i = 1, N_AUTHORS do db:insert('author', '{}', {id = i}) end
for id = 1, N_POSTS do
	db:insert('post', '{}', {id = id, author_id = ((id * 17) % N_AUTHORS) + 1})
end
db:commit()

db:begin'r'

-- warm every page into the OS/mdbx cache so no run pays a cold-disk-read
-- cost that another run avoids by luck of the cache.
local function warm_full_scan(tbl)
	local cur = db:cursor(tbl)
	local k, v = MDBX_val(), MDBX_val()
	while cur:move_raw_into(C.MDBX_NEXT, k, v) do end
	cur:close()
end
warm_full_scan('author')
warm_full_scan('post/author_id')

-- nested loop join through the query-node API: pk_range drives the author
-- scan (MDBX_FIRST/MDBX_NEXT), pk_join_seek does one MDBX_SET_KEY seek on
-- the FK index per driver row then MDBX_NEXT_DUP to walk that author's
-- posts -- same op sequence as the C and raw-Lua benches, but with the
-- node machinery (open/close per run, member/pk indirection) in the path.
local node = db:pk_join_seek(db:pk_range'author', 'post/author_id')
local function run_join()
	node:open()
	local pairs = 0
	while node:next_group() do
		pairs = pairs + 1
	end
	node:close()
	return pairs
end

for _ = 1, 3 do run_join() end --jit warmup

local t0 = clock()
local runs, pairs = 0, 0
repeat
	pairs = pairs + run_join()
	runs = runs + 1
until clock() - t0 >= DURATION
local elapsed = clock() - t0

printf('seek (nodes): %d runs, %d pairs in %.3fs -> %.0f runs/s, %.0f pairs/s\n',
	runs, pairs, elapsed, runs / elapsed, pairs / elapsed)

db:commit()
db:close()
os.remove(file); os.remove(file..'-lck')
