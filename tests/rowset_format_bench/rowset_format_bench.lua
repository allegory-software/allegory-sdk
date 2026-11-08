require'rowset_mdbx'
require'time'
require'gzip'

local dir = assert(arg[1], 'output directory required')
local stages_only = arg[2] == 'stages'
local batch_only = arg[2] == 'batch'
local batch_json = arg[2] == 'batch_json'
local compile_batch = (batch_only or batch_json)
	and dofile'tests/mdbx_decode_bench.lua'
local sizes = (stages_only or batch_only or batch_json) and {100000}
	or {1000, 10000, 100000}
local results = {}
local function write_file(name, s)
	local f = assert(io.open(dir..'/'..name, 'wb'))
	assert(f:write(s))
	assert(f:close())
end

for _, shape in ipairs{'numeric', 'mixed'} do
	for _, n in ipairs(sizes) do
		local name = shape..'_'..n
		local file = dir..'/'..name..'.mdb'
		local schema = mdbx_schema()
		schema:import(function()
			import'schema_mdbx'
			if shape == 'numeric' then
				tables.t = {id, idpk, a, i32, b, i32, c, i32,
					d, i32, e, i32}
			else
				tables.t = {id, idpk, a, i32, b, text, c, text,
					d, text, e, i32}
			end
		end)
		local db = mdbx_open(file)
		db.schema = schema
		db:sync_schema()
		db:begin'w'
		for i = 1, n do
			local row = {id = i, a = i % 1000, e = i % 17}
			if shape == 'numeric' then
				row.b, row.c, row.d = i * 3, -i, i % 100
			else
				row.b = 'name '..i
				row.c = 'category '..(i % 20)
				if i % 5 ~= 0 then row.d = 'description '..i end
			end
			db:insert('t', '{}', row)
		end
		db:commit()
		local rowset_scan
		local rs = scan_rowset{
			name = name, db = db, pk = 'id',
			scan = function(db)
				rowset_scan = db:scan('t', ''):select('id, a, b, c, d, e')
				return rowset_scan
			end,
		}
		rs:prepare()
		if stages_only or batch_only then
			local scan = db:atomic('r', function()
				return db:scan('t', ''):select('id, a, b, c, d, e')
					:null_value(null)
			end)
			local params = {}
			local stages = {'cursor', 'decode', 'columns', 'rowset'}
			local batch_get, batch_rowset_get
			local rowset_get = rowset_scan.get
			if batch_only then
				batch_get = db:atomic('r', compile_batch, db, scan)
				batch_rowset_get = db:atomic('r', compile_batch, db, rowset_scan)
				stages = {
					'decode', 'batch_decode', 'columns', 'batch_columns',
					'rowset', 'batch_rowset',
				}
				db:atomic('r', function()
					local row0, row1 = {}, {}
					scan.reset(params)
					while scan.next() do
						scan.get(row0)
						batch_get(row1)
						for _, name in ipairs(scan.out_cols) do
							assert(row0[name] == row1[name])
						end
					end
					scan.close()
				end)
				local res0 = rs:load(params)
				rowset_scan.get = batch_rowset_get
				local res1 = rs:load(params)
				rowset_scan.get = rowset_get
				for fi = 1, #res0.col_vals do
					for ri = 1, n do
						assert(res0.col_vals[fi][ri] == res1.col_vals[fi][ri])
					end
				end
			end
			local stage_samples = {}
			for _, stage in ipairs(stages) do stage_samples[stage] = {} end
			local function run_stage(stage)
				if stage == 'columns' then
					return scan:cols_array(params)
				end
				if stage == 'batch_columns' then
					local get = scan.get
					scan.get = batch_get
					local cols = scan:cols_array(params)
					scan.get = get
					return cols
				end
				local get = stage == 'decode' and scan.get or batch_get
				local scratch = stage ~= 'cursor' and {}
				local count = 0
				scan.reset(params)
				while scan.next() do
					if scratch then get(scratch) end
					count = count + 1
				end
				scan.close()
				return count, scratch
			end
			for iteration = 1, 11 do
				for i = 1, #stages do
					local stage = stages[(i + iteration - 2) % #stages + 1]
					local is_rowset = stage == 'rowset' or stage == 'batch_rowset'
					rowset_scan.get = stage == 'batch_rowset'
						and batch_rowset_get or rowset_get
					collectgarbage'collect'
					local t0 = clock()
					local res, scratch
					if is_rowset then
						res = rs:load(params)
					else
						res, scratch = db:atomic('r', run_stage, stage)
					end
					local ms = (clock() - t0) * 1000
					rowset_scan.get = rowset_get
					if is_rowset then res = res.col_vals end
					if stage == 'columns' or is_rowset
						or stage == 'batch_columns'
					then
						assert(#res == 6 and #res[1] == n)
						assert(res[1][1] == 1 and res[1][n] == n)
					else
						assert(res == n)
						if scratch then assert(scratch.id == n) end
					end
					if iteration > 2 then add(stage_samples[stage], ms) end
				end
			end
			for _, stage in ipairs(stages) do
				local samples = stage_samples[stage]
				table.sort(samples)
				print(json_encode{
					name = name, stage = stage, median_ms = samples[5],
					samples_ms = samples,
				})
			end
		else
			local samples = {rows = {}, col_vals = {}}
			local formats = {'rows', 'col_vals'}
			local batch_get
			local get = rowset_scan.get
			if batch_json then
				batch_get = db:atomic('r', compile_batch, db, rowset_scan)
				formats = {'rows', 'col_vals', 'batch_rows', 'batch_col_vals'}
				samples.batch_rows, samples.batch_col_vals = {}, {}
			end
			local gz = gzip_state{op = 'compress', level = 1}
			for iteration = 1, 11 do
				for i = 1, #formats do
					local format = formats[(i + iteration - 2) % #formats + 1]
					rowset_scan.get = format:find('batch_', 1, true)
						and batch_get or get
					local want_rows = format == 'rows' or format == 'batch_rows'
					collectgarbage'collect'
					local t0 = clock()
					local res = rs:load({}, {rows = want_rows})
					local t1 = clock()
					local s = json_encode(res)
					local t2 = clock()
					gz:reset()
					gz:push(s)
					gz:finish()
					local t3 = clock()
					rowset_scan.get = get
					if iteration > 2 then
						add(samples[format], {
							load_ms = (t1 - t0) * 1000,
							encode_ms = (t2 - t1) * 1000,
							gzip_ms = (t3 - t2) * 1000,
						})
					end
					if iteration == 11 then
						write_file(name..'_'..format..'.json', s)
						write_file(name..'_'..format..'.json.gz', gz.b:get())
					end
				end
			end
			gz:free()
			add(results, {name = name, n = n, samples = samples})
		end
		db:close()
		io.stderr:write(name..' complete\n')
	end
end
write_file('server.json', json_encode(results))
