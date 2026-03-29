--memory mapping -------------------------------------------------------------

--TODO: how to test for disk full on 32bit?
--TODO: offset + size -> invalid arg
--TODO: test sync() with invalid address and/or size (clamp them?)
--TODO: test exec flag by trying to execute code in it
--TODO: COW on opened file doesn't work on OSX
--TODO: test protect

local mediumsize = 1024^2 * 10 + 1 -- 10 MB + 1 byte to make it non-aligned

function test.pagesize()
	assert(pagesize() > 0)
	assert(pagesize() % 4096 == 0)
end

local function zerosize_file(filename)
	local file = filename or 'fs_test_zerosize'
	rmfile(file)
	local f = assert(io.open(file, 'w'))
	f:close()
	return file
end

--[[
function test.filesize()
	local file = zerosize_file()
	assert(mmap.filesize(file) == 0)
	assert(mmap.filesize(file, 123) == 123) --grow
	assert(mmap.filesize(file) == 123)
	assert(mmap.filesize(file, 63) == 63) --shrink
	assert(mmap.filesize(file) == 63)
	rmfile(file)
end
]]

local function fill(map)
	assert(map.size/4 <= 2^32)
	local p = ffi.cast('int32_t*', map.addr)
	for i = 0, map.size/4-1 do
		p[i] = i
	end
end

local function check_filled(map, offset)
	local offset = (offset or 0) / 4
	local p = ffi.cast('int32_t*', map.addr)
	for i = 0, map.size/4-1 do
		assert(p[i] == i + offset)
	end
end

local function check_empty(map)
	local p = ffi.cast('int32_t*', map.addr)
	for i = 0, map.size/4-1 do
		assert(p[i] == 0)
	end
end

function test.map_anonymous_write(size)
	local map = mmap{access = 'w', size = size or mediumsize}
	check_empty(map)
	fill(map)
	check_filled(map)
	map:free()
end

--NOTE: there's no point in making an unshareable read-only mapping.
function test.map_anonymous_readonly_empty()
	local map = mmap{access = 'r', size = mediumsize}
	check_empty(map)
	map:free()
end

function test.map_file_read()
	local map = mmap{file = fs_test_lua}
	assert(str(map.addr, map.size):find'test%.map_file_read')
	map:free()
end

function test.map_file_write()
	local file = 'fs_test_mmap'
	rmfile(file)
	local map1 = mmap{file = file, size = mediumsize, access = 'w'}
	fill(map1)
	map1:free()
	local map2 = mmap{file = file, access = 'r'}
	check_filled(map2)
	map2:free()
	rmfile(file)
end

function test.map_file_write_live()
	local file = 'fs_test_mmap'
	rmfile(file)
	local map1 = mmap{file = file, size = mediumsize, access = 'w'}
	local map2 = mmap{file = file, access = 'r'}
	fill(map1)
	map1:sync()
	check_filled(map2)
	map1:free()
	map2:free()
	rmfile(file)
end

function test.map_file_copy_on_write()
	local file = 'fs_test_mmap'
	rmfile(file)
	local size = mediumsize
	local map = mmap{file = file, access = 'w', size = size}
	fill(map)
	map:free()
	local map = mmap{file = file, access = 'c'}
	assert(map.size == size)
	ffi.fill(map.addr, map.size, 123)
	map:sync()
	map:free()
	--check that the file wasn't altered by fill()
	local map = mmap{file = file}
	assert(map.size == size)
	check_filled(map)
	map:free()
	rmfile(file)
end

function test.map_file_copy_on_write_live()
	local file = 'fs_test_mmap'
	--TODO: COW on opened file doesn't work on OSX
	if ffi.os == 'OSX' then return end
	rmfile(file)
	local size = mediumsize
	local mapw = mmap{file = file, access = 'w', size = size}
	local mapc = mmap{file = file, access = 'c'}
	local mapr = mmap{file = file, access = 'r'}
	assert(mapw.size == size)
	assert(mapc.size == size)
	assert(mapr.size == size)
	fill(mapw)
	mapw:sync()
	check_filled(mapc) --COW mapping sees writes from W mapping.
	ffi.fill(mapc.addr, mapc.size, 123)
	mapc:sync()
	for i=0,size-1 do
		assert(cast(i8p, mapc.addr)[i] == 123)
	end
	check_filled(mapw) --W mapping doesn't see writes from COW mapping.
	check_filled(mapr) --R mapping doesn't see writes from COW mapping.
	mapw:free()
	mapc:free()
	mapr:free()
	rmfile(file)
end

function test.map_shared_via_tagname()
	local name = 'mmap_test_tagname'
	local size = mediumsize
	local map1 = mmap{tagname = name, access = 'w', size = size}
	local map2 = mmap{tagname = name, access = 'r', size = size}
	map1:unlink() --can be called while mappings are alive.
	map2:unlink() --ok even if file not found.
	assert(map1.addr ~= map2.addr)
	assert(map1.size == map2.size)
	fill(map1)
	map1:sync()
	check_filled(map2)
	map1:free()
	map2:free()
end

function test.map_file_exec()
	--TODO: test by exec'ing some code in the memory.
	local exe = exepath()
	local map = mmap{file = exe, access = 'x'}
	if win then
		assert(str(map.addr, 2) == 'MZ')
	else
		assert(str(ffi.cast(i8p, map.addr)+1, 3) == 'ELF')
	end
	map:free()
end

function test.map_offset_live()
	local file = 'fs_test_mmap'
	rmfile(file)
	local offset = pagesize()
	local size = offset * 2
	local map1 = mmap{file = file, size = size, access = 'w'}
	local map2 = mmap{file = file, offset = offset}
	fill(map1)
	map1:sync()
	check_filled(map2, offset)
	map1:free()
	map2:free()
	rmfile(file)
end

function test.map_mirror_buffer(addr)
	local map = mirror_buffer(1, addr)
	local p = cast(i8p, map.addr)
	p[0] = 123
	assert(p[map.size] == 123)
	map:free()
end

function test.map_mirror_buffer_fixed_addr()
	test.map_mirror_buffer(0x100000000)
end

--mmap failure modes

function test.map_invalid_size()
	local ok, err = pcall(try_mmap, {file = fs_test_lua, size = 0})
	assert(not ok and err:find'size')
end

function test.map_invalid_offset()
	local ok, err = pcall(try_mmap, {file = fs_test_lua, offset = 1})
	assert(not ok and err:find'aligned')
end

function test.map_invalid_address()
	local map, err = try_mmap{
		size = pagesize() * 1,
		addr = -pagesize(),
	}
	assert(not map and err == 'out_of_mem')
end

function test.map_size_too_large()
	local size = 1024^3 * (ffi.abi'32bit' and 3 or 1024^3)
	local map, err = try_mmap{access = 'w', size = size}
	assert(not map and err == 'out_of_mem')
end

function test.map_readonly_not_found()
	local map, err = try_mmap{file = 'askdfask8920349zjk'}
	assert(not map and err == 'not_found')
end

function test.map_readonly_too_short()
	local map, err = try_mmap{file = fs_test_lua, size = 1024*1000}
	assert(not map and err == 'file_too_short')
end

function test.map_readonly_too_short_zero()
	local map, err = try_mmap{file = zerosize_file()}
	assert(not map and err == 'file_too_short')
	rmfile'fs_test_zerosize'
end

function test.map_write_too_short_zero()
	local map, err = try_mmap{file = zerosize_file(), access = 'w'}
	assert(not map and err == 'file_too_short')
	rmfile'fs_test_zerosize'
end

function test.map_disk_full()
	local file = 'fs_test_file_huge'
	rmfile(file)
	local map, err = try_mmap{
		file = file,
		size = 1024^4, --let's see how this is gonna last...
		access = 'w',
	}
	rmfile(file)
	assert(not map and err == 'disk_full')
end

