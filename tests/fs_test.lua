--go@ plink d10 -t -batch sdk/bin/linux/luajit sdk/tests/fs_test.lua
--go@ x:\sdk\bin\windows\luajit.exe -lscite fs_test.lua
require'glue'
require'fs'
require'logging'

--if luapower sits on a VirtualBox shared folder on a Windows host
--we can't mmap files, create symlinks or use locking on that, so we'll use
--$HOME, which is usually a disk mount.
local tests_dir = exedir()..'/../../tests'
local fs_test_lua = tests_dir..'/fs_test.lua'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

--open/close -----------------------------------------------------------------

function test.open_close()
	local testfile = 'fs_testfile'
	local f = open(testfile, 'w')
	assert(isfile(f))
	assert(not f:closed())
	f:close()
	assert(f:closed())
	rmfile(testfile)
end

function test.open_not_found()
	local nonexistent = 'this_file_should_not_exist'
	local f, err = try_open(nonexistent)
	assert(not f)
	assert(err == 'not_found')
end

function test.open_already_exists_file()
	local testfile = 'fs_testfile'
	local f = try_open(testfile, 'w')
	f:close()
	local f, err = try_open(testfile,
		win and {
			access = 'write',
			creation = 'create_new',
			flags = 'backup_semantics'
		} or {
			flags = 'creat excl'
		})
	assert(not f)
	assert(err == 'already_exists')
	rmfile(testfile)
end

function test.open_already_exists_dir()
	local testfile = 'fs_test_dir_already_exists'
	rmdir(testfile)
	mkdir(testfile)
	local f, err = try_open(testfile,
		win and {
			access = 'write',
			creation = 'create_new',
			flags = 'backup_semantics'
		} or {
			flags = 'creat excl'
		})
	assert(not f)
	assert(err == 'already_exists')
	rmdir(testfile)
end

function test.open_dir()
	local testfile = 'fs_test_open_dir'
	local using_backup_semantics = true
	rmdir(testfile)
	mkdir(testfile)
	local f, err = try_open(testfile)
	if win and not using_backup_semantics then
		--using `backup_semantics` flag on CreateFile allows us to upen
		--directories like in Linux, otherwise we'd get an access_denied error.
		--Need more testing to see if this flag does not create other problems.
		assert(not f)
		assert(err == 'access_denied')
	else
		assert(f)
		f:close()
	end
	rmdir(testfile)
end

function test.wrap_file() --indirectly tests wrap_fd() and wrap_handle()
	local name = 'fs_test_wrap_file'
	rmfile(name)
	local f = io.open(name, 'w')
	f:write'hello'
	f:flush()
	if Linux then
		os.execute'sleep .2' --WTF??
	end
	local f2 = file_wrap_file(f)
	assert(f2:attr'size' == 5)
	f:close()
	rmfile(name)
end

--pipes ----------------------------------------------------------------------

function test.pipe() --I/O test in proc_test.lua
	local rf, wf = pipe()
	rf:close()
	wf:close()
end

--NOTE: I/O tests in proc_test.lua!
function test.named_pipe_win()
	if not win then return end
	local opt = 'rw' --'rw single_instance'
	local name = [[\\.\pipe\fs_test_pipe]]
	local p1 = pipe(name, opt)
	local p2 = pipe(name, opt)
	p1:close()
	p2:close()
end

--NOTE: I/O tests in proc_test.lua!
function test.named_pipe_posix()
	if win then return end
	local opt = 'rw'
	local file = 'fs_test_pipe'
	rmfile(file)
	local p = pipe(name, opt)
	p:close()
	rmfile(file)
end

--i/o ------------------------------------------------------------------------

function test.read_write()
	local testfile = 'fs_test_read_write'
	local sz = 4096
	local buf = ffi.new('uint8_t[?]', sz)

	--write some patterns
	local f = open(testfile, 'w')
	for i=0,sz-1 do
		buf[i] = i
	end
	for i=1,4 do
		f:write(buf, sz)
	end
	f:close()

	--read them back
	local f = open(testfile)
	local t = {}
	while true do
		local readsz = f:read(buf, sz)
		if readsz == 0 then break end
		t[#t+1] = ffi.string(buf, readsz)
	end
	f:close()

	--check them out
	local s = table.concat(t)
	for i=1,#s do
		assert(s:byte(i) == (i-1) % 256)
	end

	rmfile(testfile)
end

function test.open_modes()
	local testfile = 'fs_test'
	--TODO:
	local f = open(testfile, 'w')
	f:close()
	rmfile(testfile)
end

function test.seek()
	local testfile = 'fs_test'
	local f = open(testfile, 'w')

	--test large file support by seeking past 32bit
	local newpos = 2^40
	local pos = f:seek('set', newpos)
	assert(pos == newpos)
	local pos = f:seek(-100)
	assert(pos == newpos -100)
	local pos = f:seek('end', 100)
	assert(pos == 100)

	--write some data and check again
	local newpos = 1024^2
	local buf = ffi.new'char[1]'
	local pos = f:seek('set', newpos)
	assert(pos == newpos) --seeked outside
	buf[0] = 0xaa
	f:write(buf, 1) --write outside cur
	local pos = f:seek()
	assert(pos == newpos + 1) --cur advanced
	local pos = f:seek('end')
	assert(pos == newpos + 1) --end updated
	assert(f:seek'end' == newpos + 1)
	f:close()

	rmfile(testfile)
end

--streams --------------------------------------------------------------------

function test.stream()
	local testfile = 'fs_test'
	local f = open(testfile, 'w'):stream('w')
	f:close()
	local f = open(testfile, 'r'):stream('r')
	f:close()
	rmfile(testfile)
end

--truncate -------------------------------------------------------------------

function test.truncate_seek()
	local testfile = 'fs_test_truncate_seek'
	--truncate/grow
	local f = open(testfile, 'w')
	local newpos = 1024^2
	f:truncate(newpos)
	assert(f:seek() == newpos)
	f:close()
	--check size
	local f = open(testfile, 'r+')
	local pos = f:seek'end'
	assert(pos == newpos)
	--truncate/shrink
	local pos = f:seek('end', -100)
	f:truncate(pos)
	assert(pos == newpos - 100)
	f:close()
	--check size
	local f = open(testfile, 'r')
	local pos = f:seek'end'
	assert(pos == newpos - 100)
	f:close()

	rmfile(testfile)
end

--filesystem operations ------------------------------------------------------

function test.cd_mkdir_remove()
	local testdir = 'fs_test_dir'
	local cd = cwd()
	mkdir(testdir) --relative paths should work
	chdir(testdir) --relative paths should work
	chdir(cd)
	assert(cwd() == cd)
	rmdir(testdir) --relative paths should work
end

function test.mkdir_recursive()
	mkdir('fs_test_dir/a/b/c', true)
	rmdir'fs_test_dir/a/b/c'
	rmdir'fs_test_dir/a/b'
	rmdir'fs_test_dir/a'
	rmdir'fs_test_dir'
end

function test.remove_recursive()
	do return end --TODO:
	local rootdir = 'fs_test_rmdir_rec/'
	rmfile(rootdir, true)
	local function mkdir(dir)
		mkdir(rootdir..dir, true)
	end
	local function mkfile(file)
		local f = open(rootdir..file, 'w')
		f:close()
	end
	mkdir'a/b/c'
	mkfile'a/b/c/f1'
	mkfile'a/b/c/f2'
	mkdir'a/b/c/d1'
	mkdir'a/b/c/d2'
	mkfile'a/b/f1'
	mkfile'a/b/f2'
	mkdir'a/b/d1'
	mkdir'a/b/d2'
	rmfile(rootdir, true)
end

function test.dir_empty()
	local d = 'fs_test_dir_empty/a/b'
	rm_rf'fs_test_dir_empty/'
	mkdir(d, true)
	for name in ls(d) do
		print(name)
	end
	rm_rf'fs_test_dir_empty/'
end

function test.mkdir_already_exists_dir()
	mkdir'fs_test_dir'
	local ok, err = try_mkdir'fs_test_dir'
	assert(ok)
	assert(err == 'already_exists')
	rmdir'fs_test_dir'
end

function test.mkdir_already_exists_file()
	local testfile = 'fs_test_dir_already_exists_file'
	local f = open(testfile, 'w')
	f:close()
	local ok, err = try_mkdir(testfile)
	assert(ok)
	assert(err == 'already_exists')
	rmfile(testfile)
end

function test.mkdir_not_found()
	local ok, err = try_mkdir'fs_test_nonexistent/nonexistent'
	assert(not ok)
	assert(err == 'not_found')
end

function test.remove_dir_not_found()
	local testfile = 'fs_test_rmdir_not_found'
	rmdir(testfile)
	local ok, err = rmfile(testfile)
	assert(ok)
	assert(err == 'not_found')
end

function test.remove_not_empty()
	local dir1 = 'fs_test_rmdir'
	local dir2 = 'fs_test_rmdir/subdir'
	rmdir(dir2)
	rmdir(dir1)
	mkdir(dir1)
	mkdir(dir2)
	local ok, err = try_rmdir(dir1)
	assert(not ok)
	assert(err == 'not_empty')
	rmdir(dir2)
	rmdir(dir1)
end

function test.remove_file()
	local name = 'fs_test_remove_file'
	rmfile(name)
	assert(io.open(name, 'w')):close()
	rmfile(name)
	assert(not io.open(name, 'r'))
end

function test.cd_not_found()
	local ok, err = try_chdir'fs_test_nonexistent/nonexistent'
	assert(not ok)
	assert(err == 'not_found')
end

function test.remove()
	local testfile = 'fs_test_remove'
	local f = open(testfile, 'w')
	f:close()
	rmfile(testfile)
	assert(not try_open(testfile))
end

function test.remove_file_not_found()
	local testfile = 'fs_test_remove'
	local ok, err = try_rmfile(testfile)
	assert(ok)
	assert(err == 'not_found')
end

function test.move()
	local f1 = 'fs_test_move1'
	local f2 = 'fs_test_move2'
	local f = open(f1, 'w')
	f:close()
	mv(f1, f2)
	rmfile(f2)
	assert(select(2, try_rmfile(f1)) == 'not_found')
end

function test.move_not_found()
	local ok, err = try_mv('fs_nonexistent_file', 'fs_nonexistent2')
	assert(not ok)
	assert(err == 'not_found')
end

function test.move_replace()
	local f1 = 'fs_test_move1'
	local f2 = 'fs_test_move2'
	local buf = ffi.new'char[1]'

	local f = open(f1, 'w')
	buf[0] = ('1'):byte(1)
	f:write(buf, 1)
	f:close()

	local f = open(f2, 'w')
	buf[0] = ('2'):byte(1)
	f:write(buf, 1)
	f:close()

	mv(f1, f2)

	local f = open(f2)
	f:read(buf, 1)
	assert(buf[0] == ('1'):byte(1))
	f:close()

	rmfile(f2)
end

--symlinks -------------------------------------------------------------------

local function mksymlink_file(f1, f2)
	local buf = u8a(1)

	rmfile(f1)
	rmfile(f2)

	local f = open(f2, 'w')
	buf[0] = ('X'):byte(1)
	f:write(buf, 1)
	f:close()

	sleep(0.1)

	local ok, err = try_mksymlink(f1, f2)
	if ok then
		assert(file_is(f1, 'symlink'))
		local f = open(f1)
		f:read(buf, 1)
		assert(buf[0] == ('X'):byte(1))
		f:close()
	else
		rmfile(f1)
		rmfile(f2)
		assert(ok, err)
	end
end

function test.mksymlink_file()
	local f1 = 'fs_test_symlink_file'
	local f2 = 'fs_test_symlink_file_target'
	mksymlink_file(f1, f2)
	assert(file_is(f1, 'symlink'))
	rmfile(f1)
	rmfile(f2)
end

function test.mksymlink_dir()
	local link = 'fs_test_symlink_dir'
	local dir = 'fs_test_symlink_dir_target'
	rm(link)
	rmdir(dir..'/test_dir')
	rmdir(dir)
	mkdir(dir)
	mkdir(dir..'/test_dir')
	local ok,err = mksymlink(link, dir, true)
	if ok then
		assert(file_is(link..'/test_dir', 'dir'))
		rmdir(link..'/test_dir')
		rm(link)
		rmdir(dir)
	else
		rm_rf(dir)
	end
	assert(ok,err)
end

function test.readlink_file()
	local f1 = 'fs_test_readlink_file'
	local f2 = 'fs_test_readlink_file_target'
	mksymlink_file(f1, f2)
	assert(readlink(f1) == f2)
	rmfile(f1)
	rmfile(f2)
end

function test.readlink_dir()
	local d1 = 'fs_test_readlink_dir'
	local d2 = 'fs_test_readlink_dir_target'
	rmdir(d1)
	rmdir(d2..'/test_dir')
	rmdir(d2)
	rmdir(d2)
	mkdir(d2)
	mkdir(d2..'/test_dir')
	local ok,err = try_mksymlink(d1, d2, true)
	if ok then
		assert(file_is(d1, 'symlink'))
		local t = {}
		for d in ls(d1) do
			t[#t+1] = d
		end
		assert(#t == 1)
		assert(t[1] == 'test_dir')
		rmdir(d1..'/test_dir')
		assert(readlink(d1) == d2)
		rmdir(d1)
		rmdir(d2)
	else
		rmdir(d2, true)
	end
	assert(ok,err)
end

--TODO: readlink() with relative symlink chain
--TODO: attr() with defer and symlink chain
--TODO: dir() with defer and symlink chain

function test.attr_deref()
	--
end

function test.symlink_attr_deref()
	local f1 = 'fs_test_readlink_file'
	local f2 = 'fs_test_readlink_file_target'
	mksymlink_file(f1, f2)
	local lattr  = file_attr(f1, false)
	local tattr1 = file_attr(f1, true)
	local tattr2 = file_attr(f2)
	assert(lattr .type == 'symlink')
	assert(tattr1.type == 'file')
	assert(tattr2.type == 'file')
	if win then
		assert(lattr.symlink_type == 'file')
		assert(tattr1.id == tattr2.id) --same file
	else
		assert(tattr1.inode == tattr2.inode) --same file
	end
	assert(tattr1.btime == tattr2.btime)
	if win then
		assert(lattr.id ~= tattr1.id) --diff. file
	else
		assert(lattr.inode ~= tattr1.inode) --diff. file
	end
	rmfile(f1)
	rmfile(f2)
end

--hardlinks ------------------------------------------------------------------

function test.mkhardlink() --hardlinks only work for files in NTFS
	local f1 = 'fs_test_hardlink'
	local f2 = 'fs_test_hardlink_target'
	rmfile(f1)
	rmfile(f2)

	local buf = ffi.new'char[1]'

	local f = open(f2, 'w')
	buf[0] = ('X'):byte(1)
	f:write(buf, 1)
	f:close()

	mkhardlink(f1, f2)

	local f = open(f1)
	f:read(buf, 1)
	assert(buf[0] == ('X'):byte(1))
	f:close()

	rmfile(f1)
	rmfile(f2)
end

--file times -----------------------------------------------------------------

function test.times()
	local testfile = 'fs_test_time'
	rmfile(testfile)
	local f = open(testfile, 'w')
	local t = f:attr()
	assert(t.atime >= 0)
	assert(t.mtime >= 0)
	assert(win or t.ctime >= 0)
	assert(Linux or t.btime >= 0)
	f:close()
	rmfile(testfile)
end

function test.times_set()
	local testfile = 'fs_test_time'
	local f = open(testfile, 'w')

	--TODO: futimes() on OSX doesn't use tv_usec
	local frac = (OSX or win) and 0 or 1/2
	local t = math.floor(os.time())
	local btime = t - 7200 - frac
	local mtime = t - 3600 - frac
	local ctime = t - 2800 - frac
	local atime = t - 1800 - frac

	f:attr{btime = btime, mtime = mtime, ctime = ctime, atime = atime}
	local btime1 = f:attr'btime' --OSX has it but can't be changed currently
	local mtime1 = f:attr'mtime'
	local ctime1 = f:attr'ctime'
	local atime1 = f:attr'atime'
	assert(mtime == mtime1)
	assert(atime == atime1)
	if win then
		assert(btime == btime1)
		assert(ctime == ctime1)
	end

	--change only mtime, should not affect atime
	mtime = mtime + 100
	f:attr{mtime = mtime}
	local mtime1 = f:attr().mtime
	local atime1 = f:attr().atime
	assert(mtime == mtime1)
	assert(atime == atime1)

	--change only atime, should not affect mtime
	atime = atime + 100
	f:attr{atime = atime}
	local mtime1 = f:attr'mtime'
	local atime1 = f:attr'atime'
	assert(mtime == mtime1)
	assert(atime == atime1)

	f:close()
	rmfile(testfile)
end

--common paths ---------------------------------------------------------------

function test.paths()
	print('homedir', homedir())
	print('tmpdir ', tmpdir())
	print('exepath', exepath())
	print('exedir' , exedir())
	print('scriptdir', scriptdir())
end

--file attributes ------------------------------------------------------------

function test.attr()
	local testfile = fs_test_lua
	local function test(attr)
		assert(attr.type == 'file')
		assert(attr.size > 10000)
		assert(attr.atime)
		assert(attr.mtime)
		assert(Linux and attr.ctime or attr.btime)
		assert(not win or attr.archive)
		if not win then
			assert(attr.inode)
			assert(attr.uid >= 0)
			assert(attr.gid >= 0)
			assert(attr.perms >= 0)
			assert(attr.nlink >= 1)
			assert(attr.perms > 0)
			assert(attr.blksize > 0)
			assert(attr.blocks > 0)
			assert(attr.dev >= 0)
		end
	end
	local attr = file_attr(testfile, false)
	test(attr)
	assert(file_attr(testfile, 'type' , false) == attr.type)
	assert(file_attr(testfile, 'atime', false) == attr.atime)
	assert(file_attr(testfile, 'mtime', false) == attr.mtime)
	assert(file_attr(testfile, 'btime', false) == attr.btime)
	assert(file_attr(testfile, 'size' , false) == attr.size)
end

function test.attr_set()
	--TODO
end

--directory listing ----------------------------------------------------------

function test.dir()
	local found
	local n = 0
	local files = {}
	for file, d in ls(tests_dir) do
		if not file then break end
		found = found or file == 'fs_test.lua'
		n = n + 1
		local t = {}
		files[file] = t
		--these are fast to get on all platforms
		t.type = d:attr('type', false)
		t.inode = d:attr('inode', false) --missing on Windows, so nil
		--these are free to get on Windows but need a stat() call on POSIX
		if win then
			t.btime = assert(d:attr('btime', false))
			t.mtime = assert(d:attr('mtime', false))
			t.atime = assert(d:attr('atime', false))
			t.size  = assert(d:attr('size' , false))
		end
		--getting all attrs is free on Windows but needs a stat() call on POSIX
		t._all_attrs = assert(d:attr(false))
		local noval, err = d:attr('non_existent_attr', false)
		assert(noval == nil) --non-existent attributes are free to get
		assert(not err) --and they are not an error
		--print('', d:attr('type', false), file)
	end
	assert(not files['.'])  --skipping this by default
	assert(not files['..']) --skipping this by default
	assert(files['fs_test.lua'].type == 'file')
	local t = files['fs_test.lua']
	print(string.format('  found %d dir/file entries in cwd', n))
	assert(found, 'fs_test.lua not found in cwd')
end

function test.dir_recursive()
	local n = 0
	for sc in scandir(win and 'c:\\' or '/proc') do
		local typ, err = sc:attr'type'
		local path, err = sc:path()
		print(string.format('%-5s %-60s %s', typ, path, err or ''))
		n = n + 1
		if n >= 20 then
			break
		end
	end
	print(n)
end

function test.dir_not_found()
	local n = 0
	local err
	for file, err1 in ls'nonexistent_dir' do
		if not file then
			err = err1
			break
		else
			n = n + 1
		end
	end
	assert(n == 0)
	assert(#err > 0)
	assert(err == 'not_found')
end

function test.dir_is_file()
	local n = 0
	local err
	for file, err1 in ls(fs_test_lua) do
		if not file then
			err = err1
			break
		else
			n = n + 1
		end
	end
	assert(n == 0)
	assert(#err > 0)
	assert(err == 'not_found')
end

--memory mapping -------------------------------------------------------------

--TODO: how to test for disk full on 32bit?
--TODO: offset + size -> invalid arg
--TODO: test flush() with invalid address and/or size (clamp them?)
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
	map1:flush()
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
	map:flush()
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
	mapw:flush()
	check_filled(mapc) --COW mapping sees writes from W mapping.
	ffi.fill(mapc.addr, mapc.size, 123)
	mapc:flush()
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
	map1:flush()
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
	map1:flush()
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

--virtual files --------------------------------------------------------------

function test.open_buffer()
	local sz = 100
	local buf = ffi.new('char[?]', sz)
	ffi.fill(buf, sz, 42)
	local f = open_buffer(buf, sz, 'w')
	assert(f:seek(100) == 100)
	assert(f:seek(100) == 200)
	assert(f:seek() == 200)
	assert(f:seek('end', 0) == 100)
	assert(f:seek('set', 0) == 0)
	local buf = ffi.new('char[?]', 100)
	assert(f:seek(200) == 200)
	assert(f:read(buf, 10) == 0)
	assert(f:seek('set', 50) == 50)
	assert(f:read(buf, 1000) == 50)
	assert(str(buf, 50) == (char(42):rep(50)))
	assert(f:write(buf, 1000) == 1000)
	assert(f:seek('set', 0))
	ffi.fill(buf, sz, 43)
	assert(f:write(buf, 1000) == 1000)
	assert(str(buf, 100) == (char(43):rep(100)))
	f:close()
	assert(f:closed())
	assert(f:try_read(buf, 1000) == nil)
	assert(f:try_write(buf, 1000) == nil)
end

--test cmdline ---------------------------------------------------------------

chdir(win and tests_dir or os.getenv'HOME')
mkdir'fs_test'
chdir'fs_test'

local name = ...
if not name or name == 'fs_test' then
	--run all tests in the order in which they appear in the code.
	local n,m = 0, 0
	for i,k in ipairs(test) do
		if not k:find'^_' then
			print('test.'..k)
			local ok, err = xpcall(test[k], debug.traceback)
			if not ok then
				print(err)
				n=n+1
			else
				m=m+1
			end
		end
	end
	print(string.format('ok: %d, failed: %d', m, n))
elseif test[name] then
	test[name](select(2, ...))
else
	print('Unknown test "'..(name)..'".')
end

assert(path_file(cwd()) == 'fs_test')
chdir'..'
rm_rf'fs_test'
