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
	exists(file) -> t|f
	checkexists(file)
	startcwd()
	cwd()
	chdir(dir)
	run_indir(dir, fn)
	rm(path)
	mv(old_path, new_path)
	mkdir(dir) -> dir
	mkdirs(file) -> file
	reload(path, [default])
	[try]load(path, [default])
	[try]save(path, s[, sz])
	saver(path) -> write(s[, sz] | nil | fs.abort) -> ok, err
	cp(src_file, dst_file)
	touch(file, mtime, btime, silent)
	chmod(file, perms)
	mtime(file)
	dir(path, patt, min_mtime, create, desc, order_by)
	gen_id(name[, start]) -> n

PROCESS API (NOT ASYNC!)

	exec(fmt,...)
	readpipe(fmt,...) -> s
	env(name, [val|false]) -> s

]]

require'$'
fs = require'fs'
path = require'path'
proc = require'proc'

function indir(...)
	local path, err = path.indir(...)
	if path then return path end
	check('fs', 'indir', nil, 'indir(%s) failed: %s', cat(imap(pack(...), tostring), ', '), err)
end
filedir = path.dir
filename = path.file
filenameext = path.nameext
fileext = path.ext

function exists(file)
	local is, err = fs.is(file)
	check('fs', 'exists', not err, 'could not check file %s: %s', file, err)
	return is
end

function checkexists(file)
	check('fs', 'exists', exists(file), 'file missing: %s', file)
end

function startcwd(dir)
	local cwd, err = fs.startcwd()
	return check('fs', 'startcwd', cwd, 'startcwd() failed: %s', err)
end
function cwd(dir)
	local cwd, err = fs.cwd()
	return check('fs', 'cwd', 'cwd', 'could not get current directory: %s', err)
end

local function chdir(dir)
	local dir, err = fs.chdir(dir)
	return check('fs', 'chdir', dir, 'could not set current directory to %s: %s', dir, err)
end
_G.chdir = chdir

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

function tryrm(path)
	note('fs', 'rm', '%s', path)
	local ok, err = fs.remove(path)
	if ok then return ok end
	return ok, err
end

function rm(path)
	local ok, err = tryrm(path)
	if not ok and err == 'not_found' then ok = true end
	check('fs', 'rm', ok, 'could not remove file %s: %s', path, err)
end

function mv(old_path, new_path)
	note('fs', 'mv', '1. %s ->\n2. %s', old_path, new_path)
	local ok, err = fs.move(old_path, new_path)
	check('fs', 'mv', ok, 'could not move file %s -> %s: %s', old_path, new_path, err)
end

function mkdir(dir)
	if path.dir(dir) then --because mkdir'c:/' gives access denied.
		local ok, err = fs.mkdir(dir, true)
		if ok and err ~= 'already_exists' then
			note('fs', 'mkdir', '%s', dir)
		end
		check('fs', 'mkdir', ok, 'could not create dir %s: %s', dir, err)
	end
	return dir
end

function mkdirs(file)
	mkdir(assert(path.dir(file)))
	return file
end

function readfile(file, parse)
	parse = parse or glue.pass
	local s, err = glue.readfile(file)
	if not s then return nil, err end
	return parse(s)
end

function reload(path, default) --load a file into a string.
	if default ~= nil and not exists(path) then return default end
	return check('fs', 'load', readfile(path))
end

--NOTE: shamelessly changing built-in load() that we never use.
local load_cache = {} --{path -> {mtime, contents}}
function load(path, default)
	local mt, err = mtime(path)
	if not mt and err == 'not_found' then
		load_cache[path] = nil
	end
	if mt then
		local t = load_cache[path]
		if t and t[1] >= mt then
			return t[2]
		end
	end
	local s = reload(path, default)
	local t = attr(load_cache, path)
	t[1], t[2] = mt, s
	return s
end

trysave = fs.save
saver = fs.saver

function save(file, s)
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

function dir(path, patt, min_mtime, create, desc, order_by)
	local t = {}
	local create = create or function(file) return {} end
	for file, d in fs.dir(path) do
		if not file and d == 'not_found' then break end
		check('fs', 'dir', file, 'dir listing failed for %s: %s', path, d)
		if     (not min_mtime or d:attr'mtime' >= min_mtime)
			and (not patt or file:find(patt))
		then
			local f = create(file)
			if f then
				f.file  = indir(path, file)
				f.mtime = d:attr'mtime'
				f.btime = d:attr'btime'
				t[#t+1] = f
			end
		end
	end
	local cmp
	if order_by == 'name' then
		function cmp(a, b) return a.file < b.file end
	else
		function cmp(a, b)
			return a.mtime < b.mtime or (a.mtime == b.mtime and a.file < b.file)
		end
	end
	sort(t, cmp)
	if desc then
		glue.reverse(t)
	end
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

