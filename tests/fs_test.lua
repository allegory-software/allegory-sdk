--#!../bin/luajit
require'glue'
require'fs'
require'logging'
require'sock'

--if luapower sits on a VirtualBox shared folder on a Windows host
--we can't mmap files, create symlinks or use locking on that, so we'll use
--$HOME, which is usually a disk mount.
local tests_dir = exedir()..'/../tests'
local fs_test_lua = tests_dir..'/fs_test.lua'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local _terr

local function checked_run(f)
	_terr = nil
	run(function(...)
		local ok, err = pcall(f, ...)
		if not ok then
			_terr = _terr and (_terr..'\n'..tostring(err)) or tostring(err)
		end
	end)
	if _terr then error(_terr, 2) end
end

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
	local f, err = try_open({
			path = testfile,
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
	local f, err = try_open({
			path = testfile,
			flags = 'creat excl',
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
	assert(f)
	f:close()
	rmdir(testfile)
end

--pipes ----------------------------------------------------------------------

function test.pipe() --I/O test in proc_test.lua
	local rf, wf = pipe{async = false}
	rf:close()
	wf:close()
end

function test.pidfd_open()
	local f = pidfd_open(getpid(), {async = false})
	assert(isfile(f, 'pidfd'))
	assert(not f.async)
	f:close()

	local f = pidfd_open{pid = getpid()}
	assert(isfile(f, 'pidfd'))
	assert(f.async)
	assert(f.epoll_i)
	f:close()
	assert(not f.epoll_i)
end

function test.async_pipe_close_wakes_waiter_before_onclose()
	checked_run(function()
		local rf, wf = pipe{async = true}
		local th, read_n, read_err, cancel_ok, cancel_err
		th = thread(function()
			read_n, read_err = rf:try_read(u8a(1), 1)
		end, 'pipe reader')
		rf:onclose(function()
			cancel_ok, cancel_err = th:try_cancel()
		end)
		resume(th)
		rf:close()
		wf:close()
		assert(read_n == nil)
		assert(read_err == 'closed')
		assert(cancel_ok == nil)
		assert(cancel_err == 'thread not waiting')
	end)
end

function test.async_pipe_thread_cancel_read_closes_pipe()
	checked_run(function()
		local rf, wf = pipe{async = true}
		local buf = u8a(1)
		local read_ok, read_err
		local th = thread(function()
			read_ok, read_err = lua_pcall(function()
				rf:try_read(buf, 1)
			end)
		end, 'pipe reader')
		resume(th)
		assert(th:try_cancel())
		assert(read_ok == false)
		assert(read_err == CANCEL)

		assert(rf:closed())
		local n, err = rf:try_read(buf, 1)
		assert(n == nil)
		assert(err == 'closed')
		wf:close()
	end)
end

--NOTE: I/O tests in proc_test.lua!
function test.named_pipe()
	require'sock'
	local path = 'fs_test_pipe'
	rmfile(path)
	mkfifo(path)
	local p1, err1 = assert(open{path = path, type = 'pipe', async = true})
	local p2, err2 = assert(open{path = path, type = 'pipe', async = true})
	assert(not err1)
	assert(not err2)
	p1:close()
	p2:close()
	rmfile(path)
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
	local testfile = 'fs_test_open_modes'

	--table opts path: open with flags and custom perms
	local f = open{path = testfile, flags = 'creat wronly trunc', perms = tonumber('600', 8)}
	f:write('hello')
	f:close()
	assert(file_attr(testfile, 'perms', false) == tonumber('600', 8))

	--mode string dispatch: all mode strings produce valid files
	for _, mode in ipairs{'r', 'r+', 'w', 'w+', 'a', 'a+', 'rw'} do
		local f, err = try_open(testfile, mode)
		assert(f, mode..': '..tostring(err))
		f:close()
	end

	--excl flag: already_exists error path
	local f, err = try_open{path = testfile, flags = 'creat excl'}
	assert(not f)
	assert(err == 'already_exists')

	--closed file detection
	local f = open(testfile)
	f:close()
	assert(f:closed())
	local ok, err = f:try_read(u8a(1), 1)
	assert(not ok)
	assert(err == 'closed')

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

function test.rm_rf()
	local rootdir = 'fs_test_rmdir_rec/'
	rm_rf(rootdir)
	local fs_mkdir = mkdir
	local function mkdir(dir)
		fs_mkdir(rootdir..dir, true)
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
	rm_rf(rootdir)
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
	rename(f1, f2)
	rmfile(f2)
	assert(select(2, try_rmfile(f1)) == 'not_found')
end

function test.move_not_found()
	local ok, err = try_rename('fs_nonexistent_file', 'fs_nonexistent2')
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

	rename(f1, f2)

	local f = open(f2)
	f:read(buf, 1)
	assert(buf[0] == ('1'):byte(1))
	f:close()

	rmfile(f2)
end

--symlinks -------------------------------------------------------------------

local function symlink_file(f1, f2)
	local buf = u8a(1)

	rmfile(f1)
	rmfile(f2)

	local f = open(f2, 'w')
	buf[0] = ('X'):byte(1)
	f:write(buf, 1)
	f:close()

	sleep(0.1)

	local ok, err = try_symlink(f1, f2)
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

function test.symlink_file()
	local f1 = 'fs_test_symlink_file'
	local f2 = 'fs_test_symlink_file_target'
	symlink_file(f1, f2)
	assert(file_is(f1, 'symlink'))
	rmfile(f1)
	rmfile(f2)
end

function test.symlink_dir()
	local link = 'fs_test_symlink_dir'
	local dir = 'fs_test_symlink_dir_target'
	rmfile(link)
	rmdir(dir..'/test_dir')
	rmdir(dir)
	mkdir(dir)
	mkdir(dir..'/test_dir')
	local ok,err = try_symlink(link, dir, 'replace')
	if ok then
		assert(file_is(link..'/test_dir', 'dir'))
		rmdir(link..'/test_dir')
		rmfile(link)
		rmdir(dir)
	else
		rm_rf(dir)
	end
	assert(ok,err)
end

function test.readlink_file()
	local f1 = 'fs_test_readlink_file'
	local f2 = 'fs_test_readlink_file_target'
	symlink_file(f1, f2)
	assert(readlink(f1) == f2)
	rmfile(f1)
	rmfile(f2)
end

function test.readlink_dir()
	local d1 = 'fs_test_readlink_dir'
	local d2 = 'fs_test_readlink_dir_target'
	rmfile(d1)
	rmdir(d2..'/test_dir')
	rmdir(d2)
	rmdir(d2)
	mkdir(d2)
	mkdir(d2..'/test_dir')
	local ok,err = try_symlink(d1, d2, 'replace')
	if ok then
		assert(file_is(d1, 'symlink'))
		local t = {}
		for d in try_ls(d1) do
			t[#t+1] = d
		end
		assert(#t == 1)
		assert(t[1] == 'test_dir')
		rmdir(d1..'/test_dir')
		assert(readlink(d1) == d2)
		rmfile(d1)
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
	local f1 = 'fs_test_attr_deref_link'
	local f2 = 'fs_test_attr_deref_target'
	rmfile(f1)
	rmfile(f2)
	local f = open(f2, 'w')
	f:write('hello')
	f:close()
	local ok, err = try_symlink(f1, f2)
	if not ok then
		rmfile(f2)
		assert(ok, err)
	end
	--deref=true (default): get target attrs
	local t = file_attr(f1)
	assert(t.type == 'file')
	assert(t.size == 5)
	--deref=false: get symlink attrs
	local t = file_attr(f1, false)
	assert(t.type == 'symlink')
	--single attr with deref
	assert(file_attr(f1, 'type', true) == 'file')
	assert(file_attr(f1, 'type', false) == 'symlink')
	rmfile(f1)
	rmfile(f2)
end

function test.symlink_attr_deref()
	local f1 = 'fs_test_readlink_file'
	local f2 = 'fs_test_readlink_file_target'
	symlink_file(f1, f2)
	local lattr  = file_attr(f1, false)
	local tattr1 = file_attr(f1, true)
	local tattr2 = file_attr(f2)
	assert(lattr .type == 'symlink')
	assert(tattr1.type == 'file')
	assert(tattr2.type == 'file')
	assert(tattr1.inode == tattr2.inode) --same file
	assert(lattr.inode ~= tattr1.inode) --diff. file
	rmfile(f1)
	rmfile(f2)
end

--hardlinks ------------------------------------------------------------------

function test.hardlink() --hardlinks only work for files in NTFS
	local f1 = 'fs_test_hardlink'
	local f2 = 'fs_test_hardlink_target'
	rmfile(f1)
	rmfile(f2)

	local buf = ffi.new'char[1]'

	local f = open(f2, 'w')
	buf[0] = ('X'):byte(1)
	f:write(buf, 1)
	f:close()

	hardlink(f1, f2)

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
	assert(t.ctime >= 0)
	f:close()
	rmfile(testfile)
end

function test.times_set()
	local testfile = 'fs_test_time'
	local f = open(testfile, 'w')

	local frac = 1/2
	local t = math.floor(os.time())
	local mtime = t - 3600 - frac
	local ctime = t - 2800 - frac
	local atime = t - 1800 - frac

	f:set_attr{mtime = mtime, ctime = ctime, atime = atime}
	local mtime1 = f:attr'mtime'
	local ctime1 = f:attr'ctime'
	local atime1 = f:attr'atime'
	assert(mtime == mtime1)
	assert(atime == atime1)

	--change only mtime, should not affect atime
	mtime = mtime + 100
	f:set_attr{mtime = mtime}
	local mtime1 = f:attr().mtime
	local atime1 = f:attr().atime
	assert(mtime == mtime1)
	assert(atime == atime1)

	--change only atime, should not affect mtime
	atime = atime + 100
	f:set_attr{atime = atime}
	local mtime1 = f:attr'mtime'
	local atime1 = f:attr'atime'
	assert(mtime == mtime1)
	assert(atime == atime1)

	f:close()
	rmfile(testfile)
end

--common paths ---------------------------------------------------------------

function test.paths()
	assert(homedir() == '/root' or homedir():starts'/home')
	assert(tmpdir() == '/tmp')
	assert(exefile():ends'luajit')
	assert(exedir():ends'bin')
	--TODO: scriptdir()
end

--file attributes ------------------------------------------------------------

function test.attr()
	local testfile = fs_test_lua
	local function test(attr)
		assert(attr.type == 'file')
		assert(attr.size > 10000)
		assert(attr.atime)
		assert(attr.mtime)
		assert(attr.ctime)
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
	local attr = file_attr(testfile, false)
	test(attr)
	assert(file_attr(testfile, 'type' , false) == attr.type)
	assert(file_attr(testfile, 'atime', false) == attr.atime)
	assert(file_attr(testfile, 'mtime', false) == attr.mtime)
	assert(file_attr(testfile, 'size' , false) == attr.size)
end

function test.attr_set()
	local testfile = 'fs_test_attr_set'
	local f = open(testfile, 'w')
	f:write('hello')
	f:close()
	--set perms via set_file_attr
	try_set_file_attr(testfile, {perms = tonumber('600', 8)})
	local p = file_attr(testfile, 'perms', false)
	assert(p == tonumber('600', 8))
	--set mtime via set_file_attr
	local t = math.floor(os.time()) - 3600
	try_set_file_attr(testfile, {mtime = t})
	local m = file_attr(testfile, 'mtime', false)
	assert(math.abs(m - t) < 1)
	--set mtime via dir:set_attr
	t = t - 60
	for name, d in ls('.') do
		if name == testfile then
			d:set_attr({mtime = t}, false)
			d:close()
			break
		end
	end
	m = file_attr(testfile, 'mtime', false)
	assert(math.abs(m - t) < 1)
	rmfile(testfile)
end

--directory listing ----------------------------------------------------------

function test.ls_empty()
	local d = 'fs_test_dir_empty/a/b'
	rm_rf'fs_test_dir_empty/'
	mkdir(d, true)
	local found
	for name in try_ls(d) do
		found = true
	end
	assert(not found)
	rm_rf'fs_test_dir_empty/'
end

function test.ls()
	local t0 = time()
	rm_rf'fs_test_ls'
	mkdir('fs_test_ls/d', true)
	open('fs_test_ls/f', 'w'):close()
	local files = {}
	for file, d in try_ls'fs_test_ls' do
		local t = {}
		files[file] = t
		t.type  = assert(d:attr('type' , false))
		t.inode = assert(d:attr('inode', false))
		t.mtime = assert(d:attr('mtime', false))
		t.atime = assert(d:attr('atime', false))
		t.size  = assert(d:attr('size' , false))
		t._all_attrs = assert(d:attr(false))
		local ok, err = pcall(function() return d:try_attr('non_existent_attr', false) end)
		assert(not ok)
		assert(err:find'non_existent_attr')
	end
	assert(not files['.'])  --skipping this by default
	assert(not files['..']) --skipping this by default
	assert(files.d)
	assert(files.f)
	assert(files.d.type == 'dir')
	assert(files.f.type == 'file')
	assert(files.d.mtime >= t0 - 1 and files.d.mtime <= t0 + 5)
	assert(files.f.mtime >= t0 - 1 and files.f.mtime <= t0 + 5)
end

function test.scandir()
	cdef'int getpid(void);'
	local pid = C.getpid()
	local t = {}
	for sc in scandir('/proc/self/task/'..pid) do
		local path = sc:relpath()
		local typ = sc:attr'type'
		t[path] = typ
	end
	assert(t['fd/0'] == 'chardev')
	assert(t['environ'] == 'file')
	assert(t['cmdline'] == 'file')
end

function test.ls_not_found()
	local n = 0
	local err
	for file, err1 in try_ls'nonexistent_dir' do
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

function test.ls_is_file()
	local n = 0
	local err
	for file, err1 in try_ls(fs_test_lua) do
		if not file then
			err = err1
			break
		else
			n = n + 1
		end
	end
	assert(n == 0)
	assert(#err > 0)
	assert(err == 'not_dir')
end

--readall, readn, skip -------------------------------------------------------

function test.readall()
	local testfile = 'fs_test_readall'
	--non-empty file
	local f = open(testfile, 'w')
	f:write('hello world')
	f:close()
	local f = open(testfile)
	local buf, len = f:readall()
	assert(len == 11)
	assert(str(buf, len) == 'hello world')
	f:close()
	--empty file
	local f = open(testfile, 'w')
	f:close()
	local f = open(testfile)
	local buf, len = f:readall()
	assert(len == 0)
	assert(str(buf, len) == '')
	f:close()
	rmfile(testfile)
end

function test.readall_empty()
	local testfile = 'fs_test_readall_empty'
	local f = open(testfile, 'w')
	f:close()
	local f = open(testfile)
	local buf, len = f:readall()
	assert(len == 0)
	assert(str(buf, len) == '')
	f:close()
	rmfile(testfile)
end

function test.readn()
	local testfile = 'fs_test_readn'
	local f = open(testfile, 'w')
	f:write('abcdefghij') --10 bytes
	f:close()
	local f = open(testfile)
	local buf = u8a(10)
	local ok = f:readn(buf, 10)
	assert(ok)
	assert(str(buf, 10) == 'abcdefghij')
	--readn past EOF
	f:seek('set', 0)
	local ok, err, n = f:try_readn(buf, 20)
	assert(not ok)
	assert(err == 'eof')
	assert(n == 10)
	f:close()
	rmfile(testfile)
end

function test.skip()
	local testfile = 'fs_test_skip'
	local f = open(testfile, 'w')
	f:write('abcdefghij')
	f:close()
	local f = open(testfile)
	local n = f:skip(3)
	assert(n == 3)
	assert(f:seek() == 3)
	local n = f:skip(5)
	assert(n == 5)
	assert(f:seek() == 8)
	f:close()
	rmfile(testfile)
end

function test.truncate_opts()
	local testfile = 'fs_test_truncate_opts'
	--default opt: 'fallocate fail'
	local f = open(testfile, 'w')
	f:truncate(4096)
	assert(f:seek() == 4096)
	assert(f:attr'size' == 4096)
	--shrink: fallocate skipped (size <= cursize)
	f:truncate(1024)
	assert(f:seek() == 1024)
	assert(f:attr'size' == 1024)
	--opt without fallocate: just ftruncate
	f:truncate(2048, 'none')
	assert(f:attr'size' == 2048)
	f:close()
	rmfile(testfile)
end

--buffered_reader ------------------------------------------------------------

function test.buffered_reader()
	require'pbuffer'
	local testfile = 'fs_test_bufread'
	local data = ('abcdefghij'):rep(100) --1000 bytes
	local f = open(testfile, 'w')
	f:write(data)
	f:close()
	local f = open(testfile)
	local read = pbuffer{f = f, readahead = 64}:reader() --small buffer
	local parts = {}
	local buf = u8a(37) --odd size
	while true do
		local n = read(buf, 37)
		if not n or n == 0 then break end
		parts[#parts+1] = str(buf, n)
	end
	local result = table.concat(parts)
	assert(result == data)
	f:close()
	rmfile(testfile)
end

--load/save ------------------------------------------------------------------

function test.load_save()
	local testfile = 'fs_test_load_save'
	rmfile(testfile)
	--save and load string
	save(testfile, 'hello world')
	local s = load(testfile)
	assert(s == 'hello world')
	--save overwrites atomically
	save(testfile, 'replaced')
	local s = load(testfile)
	assert(s == 'replaced')
	--save empty string
	save(testfile, '')
	local s = load(testfile)
	assert(s == '')
	rmfile(testfile)
end

function test.load_not_found()
	local ok, err = try_load('fs_test_nonexistent_file')
	assert(not ok)
	assert(err == 'not_found')
end

function test.load_not_found_returns_nil()
	local s = load('fs_test_nonexistent_file')
	assert(s == nil)
end

function test.save_buffer()
	local testfile = 'fs_test_save_buf'
	local buf = u8a(5)
	copy(buf, 'abcde', 5)
	save(testfile, buf, 5)
	local s = load(testfile)
	assert(s == 'abcde')
	rmfile(testfile)
end

--touch ----------------------------------------------------------------------

function test.touch()
	local testfile = 'fs_test_touch'
	rmfile(testfile)
	--touch creates file
	touch(testfile)
	assert(exists(testfile))
	--touch updates mtime
	local t = math.floor(os.time()) - 7200
	touch(testfile, t)
	local m = mtime(testfile)
	assert(math.abs(m - t) < 1)
	rmfile(testfile)
end

--file_is / exists -----------------------------------------------------------

function test.file_is()
	local testfile = 'fs_test_file_is'
	local testdir = 'fs_test_file_is_dir'
	rmfile(testfile)
	rmdir(testdir)

	--non-existent
	local is, err = try_file_is(testfile)
	assert(is == false)
	assert(err == 'not_found')
	assert(not exists(testfile))

	--file exists
	local f = open(testfile, 'w'); f:close()
	assert(exists(testfile))
	assert(file_is(testfile, 'file'))
	assert(not file_is(testfile, 'dir'))

	--dir exists
	mkdir(testdir)
	assert(file_is(testdir, 'dir'))
	assert(not file_is(testdir, 'file'))

	rmfile(testfile)
	rmdir(testdir)
end

function test.isfile()
	local testfile = 'fs_test_isfile'
	local f = open(testfile, 'w')
	assert(isfile(f))
	assert(isfile(f, 'file'))
	assert(not isfile(f, 'pipe'))
	assert(not isfile('not a file'))
	assert(not isfile(42))
	f:close()
	rmfile(testfile)
end

--locking --------------------------------------------------------------------

function test.lock_unlock()
	local testfile = 'fs_test_lock'
	local f = open(testfile, 'w')
	f:write('data')
	--exclusive lock
	f:lock'w'
	f:unlock()
	--shared lock
	f:lock'r'
	f:unlock()
	--nonblocking lock
	local ok, err = f:try_lock('w', 'nonblock')
	assert(ok)
	assert(not err)
	--nonblocking: already locked, same process (flock allows re-locking)
	local ok2, err2 = f:try_lock('w', 'nonblock')
	assert(ok2)
	f:unlock()
	f:close()
	rmfile(testfile)
end


--mkdirs ---------------------------------------------------------------------

function test.mkdirs()
	--mkdirs creates parent dirs for a file path
	local filepath = 'fs_test_mkdirs/a/b/file.txt'
	mkdirs(filepath)
	assert(exists('fs_test_mkdirs/a/b', 'dir'))
	--file itself is NOT created
	assert(not exists(filepath))
	rm_rf'fs_test_mkdirs/'
	--mkdirs with no dir component
	local r = mkdirs('justfile.txt')
	assert(r == 'justfile.txt')
end

--symlink replace ------------------------------------------------------------

function test.symlink_replace()
	local link = 'fs_test_symlink_replace'
	local t1 = 'fs_test_symlink_replace_t1'
	local t2 = 'fs_test_symlink_replace_t2'
	rmfile(link)
	rmfile(t1)
	rmfile(t2)
	local f = open(t1, 'w'); f:close()
	local f = open(t2, 'w'); f:close()
	--create symlink
	symlink(link, t1)
	assert(readlink(link) == t1)
	--replace symlink
	local ok, err = try_symlink(link, t2, 'replace')
	assert(ok)
	assert(err == 'replaced')
	assert(readlink(link) == t2)
	--replace with same target: no-op
	local ok, err = try_symlink(link, t2, 'replace')
	assert(ok)
	assert(err == 'already_exists')
	rmfile(link)
	rmfile(t1)
	rmfile(t2)
end

--readlink branches ----------------------------------------------------------

function test.readlink_non_symlink()
	local testfile = 'fs_test_readlink_nonsym'
	local f = open(testfile, 'w'); f:close()
	--readlink on regular file returns the file itself
	local target = readlink(testfile)
	assert(target == testfile)
	rmfile(testfile)
end

function test.readlink_chain()
	--test relative symlink resolution: a -> b -> target
	local dir = 'fs_test_readlink_chain'
	rm_rf(dir..'/')
	mkdir(dir)
	local f = open(dir..'/target', 'w'); f:close()
	--b points to target (relative)
	symlink(dir..'/b', 'target')
	--a points to b (relative)
	symlink(dir..'/a', 'b')
	--readlink resolves the full chain
	local result = readlink(dir..'/a')
	assert(result == dir..'/target', 'expected '..dir..'/target, got '..tostring(result))
	rm_rf(dir..'/')
end

--hardlink already exists (same inode) ---------------------------------------

function test.hardlink_already_exists()
	local f1 = 'fs_test_hlink_ae'
	local f2 = 'fs_test_hlink_ae_target'
	rmfile(f1)
	rmfile(f2)
	local f = open(f2, 'w'); f:write('x'); f:close()
	hardlink(f1, f2)
	--hardlink again: same inode, should return true, 'already_exists'
	local ok, err = try_hardlink(f1, f2)
	assert(ok)
	assert(err == 'already_exists')
	rmfile(f1)
	rmfile(f2)
end

--rm_rf edge cases -----------------------------------------------------------

function test.rm_rf_nonexistent()
	local ok, err = try_rm_rf('fs_test_rm_rf_nonexistent')
	assert(ok)
	assert(err == 'not_found')
end

function test.rm_rf_symlink()
	--rm_rf on a symlink to a dir should remove the symlink, not the dir
	local dir = 'fs_test_rm_rf_sym_dir'
	local link = 'fs_test_rm_rf_sym_link'
	rmfile(link)
	rm_rf(dir..'/')
	mkdir(dir)
	local f = open(dir..'/file', 'w'); f:close()
	local ok, err = try_symlink(link, dir)
	if ok then
		rm_rf(link) --should remove the symlink, not recurse into dir
		assert(not exists(link))
		assert(exists(dir, 'dir')) --dir should still exist
		assert(exists(dir..'/file'))
	end
	rm_rf(dir..'/')
end

--fs_info --------------------------------------------------------------------

function test.fs_info()
	local info = fs_info('/')
	assert(info)
	assert(info.size > 0)
	assert(info.free >= 0)
	assert(info.free <= info.size)
end

--ls with '..' opt -----------------------------------------------------------

function test.ls_dotdirs()
	local d = 'fs_test_ls_dotdirs'
	rmdir(d)
	mkdir(d)
	local found_dot, found_dotdot = false, false
	for name, dir in try_ls(d, '..') do
		if not name then break end
		if name == '.' then found_dot = true end
		if name == '..' then found_dotdot = true end
	end
	assert(found_dot, '. not found with .. opt')
	assert(found_dotdot, '.. not found with .. opt')
	rmdir(d)
end

--scandir with dive filter ---------------------------------------------------

function test.scandir_dive()
	local root = 'fs_test_scandir_dive/'
	rm_rf(root)
	mkdir(root..'a/b', true)
	local f = open(root..'a/f1', 'w'); f:close()
	local f = open(root..'a/b/f2', 'w'); f:close()
	--dive filter that skips 'b' subdir
	local names = {}
	for sc in scandir(root..'a', function(d)
		return d:name() ~= 'b'
	end) do
		names[#names+1] = sc:name()
	end
	assert(#names == 2) --f1 and b (listed but not dived into)
	local has_f2 = false
	for _, n in ipairs(names) do
		if n == 'f2' then has_f2 = true end
	end
	assert(not has_f2, 'f2 should not be found when b is skipped')
	rm_rf(root)
end

function test.scandir_multipath()
	local d1 = 'fs_test_scandir_mp1/'
	local d2 = 'fs_test_scandir_mp2/'
	rm_rf(d1)
	rm_rf(d2)
	mkdir(d1)
	mkdir(d2)
	local f = open(d1..'f1', 'w'); f:close()
	local f = open(d2..'f2', 'w'); f:close()
	local names = {}
	for sc in scandir{d1, d2} do
		names[#names+1] = sc:name()
	end
	table.sort(names)
	assert(#names == 2)
	assert(names[1] == 'f1')
	assert(names[2] == 'f2')
	rm_rf(d1)
	rm_rf(d2)
end

function test.scandir_depth_relpath()
	local root = 'fs_test_scandir_dr/'
	rm_rf(root)
	mkdir(root..'a/b', true)
	local f = open(root..'a/b/f', 'w'); f:close()
	local found = false
	for sc in scandir(root) do
		if sc:name() == 'f' then
			found = true
			local rp = sc:relpath()
			assert(rp, 'relpath should not be nil')
			local depth = sc:depth()
			assert(depth == 3) --root/a/b/f = depth 3
		end
	end
	assert(found, 'f not found in scandir')
	rm_rf(root)
end

--test cmdline ---------------------------------------------------------------

chdir(os.getenv'HOME')
mkdir'fs_test'
chdir'fs_test'

local name = rawget(_G, 'FS_TEST') or ...
if not name or name == 'fs_test' then
	--run all tests in the order in which they appear in the code.
	local n,m = 0, 0
	for i,k in ipairs(test) do
		if not k:find'^_' then
			print('test.'..k)
			local ok, err = xpcall(test[k], debug.traceback)
			if not ok then
				print('FAILED: ', err)
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

assert(basename(cwd()) == 'fs_test')
chdir'..'
rm_rf'fs_test'
