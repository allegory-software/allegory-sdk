--[[
	raw MDBX nested-loop join benchmark, Lua side: no query-node
	machinery, no result materialization -- just the same cursor op
	sequence as tests/mdbx_join_bench.c (MDBX_FIRST/MDBX_NEXT over
	author, then MDBX_SET_KEY/MDBX_NEXT_DUP per author on the FK index),
	driven straight through the FFI. Compares against the C benchmark to
	isolate Lua/FFI call overhead from the query-node abstraction.
]]

require'mdbx_query_builder'
local ffi = require'ffi'
local C = ffi.load'mdbx'

jit.off()

local N_AUTHORS = tonumber(os.getenv'MDBX_BENCH_AUTHORS') or 1000
local N_POSTS   = tonumber(os.getenv'MDBX_BENCH_POSTS') or 200000
local DURATION  = tonumber(os.getenv'MDBX_BENCH_SECONDS') or 3.0

local file = '/tmp/sdk_mdbx_join_bench_lua.mdb'
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

local author_cur = db:cursor('author')
local fk_cur = db:cursor('post/author_id')
local a_key, a_val, val = MDBX_val(), MDBX_val(), MDBX_val()

-- nested loop join: driver is a cursor scan of author (FIRST/NEXT); per
-- driver row, one MDBX_SET_KEY seek on the FK index then MDBX_NEXT_DUP to
-- walk that author's posts -- same op sequence as the C benchmark and as
-- pk_join_seek:next_group() (mdbx_query_nodes.lua).
local function run_join()
	local pairs = 0
	local ok = author_cur:move_raw_into(C.MDBX_FIRST, a_key, a_val)
	while ok do
		if fk_cur:move_raw_into(C.MDBX_SET_KEY, a_key, val) then
			repeat
				pairs = pairs + 1
			until not fk_cur:move_raw_into(C.MDBX_NEXT_DUP, nil, val)
		end
		ok = author_cur:move_raw_into(C.MDBX_NEXT, a_key, a_val)
	end
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

printf('seek (Lua raw): %d runs, %d pairs in %.3fs -> %.0f runs/s, %.0f pairs/s\n',
	runs, pairs, elapsed, runs / elapsed, pairs / elapsed)

db:commit()
db:close()
os.remove(file); os.remove(file..'-lck')
