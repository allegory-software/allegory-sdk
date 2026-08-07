require'mdbx_backup'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function test_path(name)
	return '/tmp/sdk_mdbx_backup_test_'..name..'_'..uuid()
end

local function remove_files(files)
	for _, file in ipairs(files) do
		rmfile(file, false)
		rmfile(file..'-lck', false)
	end
end

local function copy_file(src, dst)
	local inf = must_open(src)
	local outf = must_open(dst, 'w')
	fcall(function(finally)
		finally(function() inf:close() end)
		finally(function() outf:close() end)
		local pb = pbuffer{f = inf}
		while pb:have(1) do
			local p, len = pb:ref()
			outf:write(p, len)
			pb:skip(len)
		end
	end)
end

local function same_file(file1, file2)
	local f1 = must_open(file1)
	local f2 = must_open(file2)
	return fcall(function(finally)
		finally(function() f1:close() end)
		finally(function() f2:close() end)
		if f1:size() ~= f2:size() then return false end
		local pb1 = pbuffer{f = f1}
		local pb2 = pbuffer{f = f2}
		while pb1:have(1) do
			local p1, len1 = pb1:ref()
			pb2:need(len1)
			local p2 = pb2:ref()
			if memcmp(p1, p2, len1) ~= 0 then return false end
			pb1:skip(len1)
			pb2:skip(len1)
		end
		return not pb2:have(1)
	end)
end

local function put_rows(db, first, last, suffix)
	for id = first, last do
		local key = tostring(id)
		local val = string.rep(string.char(64 + id % 26), 100)..suffix
		assert(db:try_put_raw('t', key, #key, val, #val))
	end
end

function test.full_and_incremental()
	local prefix = test_path'full_and_incremental'
	local files = {
		prefix..'.mdb',
		prefix..'.full',
		prefix..'.delta',
		prefix..'.restored',
		prefix..'.full-restored',
		prefix..'.wrong.mdb',
		prefix..'.wrong.full',
		prefix..'.damaged',
		prefix..'.damaged-restored',
		prefix..'.wrong-restored',
	}
	remove_files(files)
	fcall(function(finally)
		finally(function() remove_files(files) end)
		local db = mdbx_open(files[1])
		finally(function() if db.env then db:close() end end)
		db:begin'w'
		db:create_table_raw't'
		put_rows(db, 1, 500, 'a')
		db:commit()
		assert(db:backup(files[2]))
		db:begin'w'
		put_rows(db, 101, 300, 'b')
		put_rows(db, 501, 700, 'c')
		db:commit()
		local ok, err = pcall(db.backup, db, files[3], files[1])
		assert(not ok)
		assert(tostring(err):find('full backup path is the database path',
			1, true))
		assert(db:backup(files[3], files[2]))
		db:close()

		assert(mdbx_restore(files[3], files[4], files[2]))
		local restored = mdbx_open(files[4], {readonly = true})
		restored:begin()
		for _, row in ipairs{{101, 'b'}, {500, 'a'}, {650, 'c'}} do
			local id, suffix = unpack(row)
			local key = tostring(id)
			local ok, val, val_size = restored:find_raw('t', key, #key)
			assert(ok)
			assert(str(val, val_size):sub(-1) == suffix)
		end
		restored:commit()
		restored:close()
		assert(mdbx_restore(files[2], files[5]))
		assert(same_file(files[2], files[5]))

		local wrong_db = mdbx_open(files[6])
		wrong_db:begin'w'
		wrong_db:create_table_raw't'
		put_rows(wrong_db, 1, 20, 'wrong')
		wrong_db:commit()
		wrong_db:backup(files[7])
		wrong_db:close()
		local ok, err = pcall(mdbx_restore,
			files[3], files[10], files[7])
		assert(not ok)
		assert(tostring(err):find('different full backup', 1, true))

		copy_file(files[3], files[8])
		local damaged = must_open(files[8], 'r+')
		local byte = u8a(1)
		damaged:seek('end', -1)
		damaged:readn(byte, 1)
		byte[0] = bit.bxor(byte[0], 1)
		damaged:seek('end', -1)
		damaged:write(byte, 1)
		damaged:sync()
		damaged:close()
		local ok, err = pcall(mdbx_restore,
			files[8], files[9], files[2])
		assert(not ok)
		assert(tostring(err):find('contents are damaged', 1, true))
	end)
end

local name = ...
if name == 'mdbx_backup_test' then name = nil end
local tests = name and {name} or test
local n_ok, n_fail = 0, 0
for _, k in ipairs(tests) do
	io.write('test.'..k..' ... ')
	io.flush()
	local ok, err = xpcall(function() run(test[k]) end, debug.traceback)
	if ok then
		print'ok'
		n_ok = n_ok + 1
	else
		print'FAILED'
		print(err)
		n_fail = n_fail + 1
		break
	end
end
print(('ok: %d, failed: %d'):format(n_ok, n_fail))
if n_fail > 0 then os.exit(1) end
