require'mdbx_query'

local N = 1000  -- rows per side; inner-loop iterations = N^2

local function test_file()
	return '/tmp/sdk_mdbx_query_jit_'..uuid()..'.mdb'
end
local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
end

local function build(db, n)
	db:begin'w'
	db:create_table('items', {fields = {
		{col = 'id',  mdbx_type = 'u32', not_null = true},
		{col = 'cat', mdbx_type = 'utf8', maxlen = 1, nozero = true},
	}, pk = {'id'}})
	db:add_index('items', {'cat'})
	for i = 1, n do
		db:insert('items', '{}', {id = i, cat = 'x'})
	end
	db:commit()
end

local function run(db)
	local count = 0
	db:atomic('r', function()
		local join = db:merge_join(
			db:pk_range('items/cat'),
			db:pk_range('items/cat'))
		local node = db:pk_filter(join, function() return false end)
		node:open()
		while node:next_group() do count = count + 1 end
		node:close()
	end)
	return count
end

local file = test_file()
cleanup(file)
local db = mdbx_open(file)
local ok, err = xpcall(function()

	build(db, N)

	local trace_file = '/tmp/mdbx_query_jit_v.txt'
	local v = require'jit.v'
	v.start(trace_file)

	-- correctness: pk_filter(always-false) must yield nothing
	-- warm-up: give JIT a full pass to build type feedback
	local n = run(db)
	assert(n == 0, 'expected 0 survivors, got '..n)

	local t0 = os.clock()
	run(db)
	local t1 = os.clock()
	v.off()
	print(('jit on  (warm): %.3fs  (%d x %d = %d inner iterations)'):format(
		t1 - t0, N, N, N * N))
	local f = assert(io.open(trace_file))
	io.write(f:read('*a'))
	f:close()
	os.remove(trace_file)

	jit.off()
	t0 = os.clock()
	run(db)
	t1 = os.clock()
	jit.on()
	print(('jit off:        %.3fs'):format(t1 - t0))

end, debug.traceback)
if db.env then db:close() end
cleanup(file)
assert(ok, err)
