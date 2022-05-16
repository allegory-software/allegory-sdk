--[[

	$ | filesystem ops

EXPORTS

	fs path proc

FILESYSTEM API (NOT ASYNC)

	indir(dir, ...) -> path
	filedir(file) -> dir
	filename(file) -> name
	filenameext(file) -> name, ext
	fileext(file) -> ext
	exists(file, [type]) -> t|f
	checkexists(file, [type])
	startcwd()
	cwd()
	chdir(dir)
	run_indir(dir, fn)
	searchpaths(paths, file, [type]) -> abs_path
	rm(path)
	mv(old_path, new_path)
	mkdir(dir) -> dir
	mkdirs(file) -> file
	load(path, [default])
	[try]save(path, s[, sz])
	saver(path) -> write(s[, sz] | nil | fs.abort) -> ok, err
	cp(src_file, dst_file)
	touch(file, mtime, btime, silent)
	chmod(file, perms)
	mtime(file)
	dir(path, patt, min_mtime, create, order_by, recursive)
	gen_id(name[, start]) -> n

PROCESS API (NOT ASYNC!)

	exec(fmt,...)
	readpipe(fmt,...) -> s
	env(name, [val|false]) -> s

]]

require'$'
require'$log'
fs = require'fs'
path = require'path'
proc = require'proc'

function indir(...)
	local path, err = path.indir(...)
	if path then return path end
	check('fs', 'indir', nil, '%s\n%s', cat(imap(pack(...), tostring), ', '), err)
end
filedir = path.dir
filename = path.file
filenameext = path.nameext
fileext = path.ext

function exists(file, type)
	local is, err = fs.is(file, type)
	check('fs', 'exists', not err, '%s\n%s', file, err)
	return is
end

function checkexists(file, type)
	check('fs', 'exists', exists(file, type), '%s', file)
end

function startcwd(dir)
	return assert(fs.startcwd())
end

function cwd(dir)
	return assert(fs.cwd())
end

function chdir(dir)
	local ok, err = fs.chdir(dir)
	check('fs', 'chdir', ok, '%s\n%s', dir, err)
end

function run_indir(dir, fn, ...)
	local cwd = cwd()
	chdir(dir)
	local function pass(ok, ...)
		chdir(cwd)
		if ok then return ... end
		error(..., 2)
	end
	pass(errors.pcall(fn, ...))
end

function searchpaths(paths, file, type)
	for _,path in ipairs(paths) do
		local abs_path = indir(path, file)
		if fs.is(abs_path, type) then
			return abs_path
		end
	end
end

tryrm = fs.remove

function rm(path)
	local ok, err = fs.remove(path)
	check('fs', 'rm', ok or err == 'not_found', '%s\n%s', path, err)
	return ok
end

function mv(oldpath, newpath)
	local ok, err = fs.move(oldpath, newpath)
	check('fs', 'mv', ok, 'old: %s\nnew: %s\nerror: %s', oldpath, newpath, err)
end

function mkdir(dir)
	local ok, err = fs.mkdir(dir, true)
	check('fs', 'mkdir', ok, '%s\n%s', dir, err)
	return dir
end

function mkdirs(file)
	mkdir(assert(path.dir(file)))
	return file
end

function load_tobuffer(path, default_buf, default_len, ignore_file_size) --load a file into a cdata buffer.
	local buf, len = fs.load_tobuffer(path, ignore_file_size)
	if not buf and len == 'not_found' and default_buf ~= nil then
		return default_buf, default_len
	end
	check('fs', 'load', buf, '%s\n%s', path, len)
	return buf, len
end

function load(path, default, ignore_file_size) --load a file into a string.
	local s, err = fs.load(path, ignore_file_size)
	if not s and err == 'not_found' and default ~= nil then
		return default
	end
	return check('fs', 'load', s, '%s\n%s', path, err)
end

trysave = fs.save
saver = fs.saver

function save(file, s)
	if type(s) == 'table' then
		pp.save(file, s)
	end
	note('fs', 'save', '%s (%s)', file, kbytes(#s))
	check('fs', 'save', fs.save(file, s))
end

function cp(src_file, dst_file)
	note('fs', 'cp', '1. %s ->\n2. %s', src_file, dst_file)
	save(dst_file, load(src_file))
end

function touch(file, mtime, btime, silent) --create file or update its mtime.
	if not silent then
		dbg('fs', 'touch', '%s to %s%s', file,
			date('%d-%m-%Y %H:%M', mtime) or 'now',
			btime and ', btime '..date('%d-%m-%Y %H:%M', btime) or '')
	end
	if not exists(file) then
		save(file, '')
		if not (mtime or btime) then
			return
		end
	end
	local ok, err = fs.attr(file, {
		mtime = mtime or time(),
		btime = btime or nil,
	})
	check('fs', 'touch', ok, 'could not set mtime/btime for %s: %s', file, err)
end

function chmod(file, perms)
	note('fs', 'chmod', '%s', file)
	local ok, err = fs.attr(file, {perms = perms})
	check('fs', 'chmod', ok, 'could not set perms for %s: %s', file, err)
end

function mtime(file)
	return fs.attr(file, 'mtime')
end

function dir(path, patt, min_mtime, create, order_by, recursive)
	if type(path) == 'table' then
		local t = path
		path, patt, min_mtime, create, order_by, recursive =
			t.path, t.find, t.min_mtime, t.create, t.order_by, t.recursive
	end
	local t = {}
	local create = create or function(file) return {} end
	if recursive then
		for sc in fs.scan(path) do
			local file, err = sc:name()
			if not file and err == 'not_found' then break end
			check('fs', 'dir', file, 'dir listing failed for %s: %s', sc:path(-1), err)
			if     (not min_mtime or sc:attr'mtime' >= min_mtime)
				and (not patt or file:find(patt))
			then
				local f = create(file, sc)
				if f then
					f.name    = file
					f.path    = sc:path()
					f.relpath = sc:relpath()
					f.type    = sc:attr'type'
					f.mtime   = sc:attr'mtime'
					f.btime   = sc:attr'btime'
					t[#t+1] = f
				end
			end
		end
	else
		for file, d in fs.dir(path) do
			if not file and d == 'not_found' then break end
			check('fs', 'dir', file, 'dir listing failed for %s: %s', path, d)
			if     (not min_mtime or d:attr'mtime' >= min_mtime)
				and (not patt or file:find(patt))
			then
				local f = create(file, d)
				if f then
					f.name    = file
					f.path    = d:path()
					f.relpath = file
					f.type    = sc:attr'type'
					f.mtime   = d:attr'mtime'
					f.btime   = d:attr'btime'
					t[#t+1] = f
				end
			end
		end
	end
	sort(t, glue.cmp(order_by or 'mtime path'))
	dbg('fs', 'dir', '%-20s %5d files%s%s', path,
		#t,
		patt and '\n  match: '..patt or '',
		min_mtime and '\n  mtime >= '..date('%d-%m-%Y %H:%M', min_mtime) or '')
	local i = 0
	return function()
		i = i + 1
		return t[i]
	end
end

--proc -----------------------------------------------------------------------

function exec(fmt, ...) --exec/wait program without redirecting its stdout/stderr.
	local cmd = fmt:format(...)
	note('fs', 'exec', '%s', cmd)
	local exitcode, err = os.execute(cmd)
	return check('fs', 'exec', exitcode, 'could not exec `%s`: %s', cmd, err)
end

function readpipe(fmt, ...) --exec/wait program and get its stdout into a string.
	local cmd = fmt:format(...)
	note('fs', 'readpipe', '%s', cmd)
	local s, err = glue.readpipe(cmd)
	return check('fs', 'readpipe', s, 'could not exec `%s`: %s', cmd, err)
end

env = proc.env

--autoincrement ids ----------------------------------------------------------

local function toid(s, field) --validate and id minimally.
	local n = tonumber(s)
	if n and n >= 0 and floor(n) == n then return n end
 	return nil, '%s invalid: %s', field or 'field', s
end

function gen_id(name, start)
	local next_id_file = indir(var_dir, 'next_'..name)
	if not exists(next_id_file) then
		save(next_id_file, tostring(start or 1))
	else
		touch(next_id_file)
	end
	local n = tonumber(load(next_id_file))
	check('fs', 'gen_id', toid(n, next_id_file))
	save(next_id_file, tostring(n + 1))
	note ('fs', 'gen_id', '%s: %d', name, n)
	return n
end
