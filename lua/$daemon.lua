	--[[

	Scaffold/boilerplate for writing server apps.
	Written by Cosmin Apreutesei. Public Domain.

	daemon(app_name) -> app

	app_name       app codename (the name of your main Lua module).
	APP_conf.lua   optional app config file loaded by the daemon() call.
		deploy      app deployment name.
		env         app environment ('dev').
		log_host    log server host.
		log_port    log server port.
	app_dir        app directory.
	bin_dir        app bin directory.
	var_dir        r/w persistent data dir.
	tmp_dir        r/w persistent temp dir.
	www_dir        app www directory.
	libwww_dir     shared www directory.
	cmd            {name->f} place to add command-line handlers.
	wincmd         add Windows-only commands here.
	lincmd         add Linux-only commands here.
	help           {cmd->s} help line for command.

	say(s)
	sayn(s)
	die(s)

]]

require'$fs'
require'$log'

local app = {}
cmd = {}
wincmd = setmetatable({}, {__index = cmd})
lincmd = setmetatable({}, {__index = cmd})
help = {}

--tools ----------------------------------------------------------------------

function say(fmt, ...)
	io.stderr:write((fmt and fmt:format(...) or '')..'\n')
	io.stderr:flush()
end

function sayn(fmt, ...)
	io.stderr:write((fmt and fmt:format(...) or ''))
end

function die(fmt, ...)
	say(fmt and ('ABORT: '..fmt):format(...) or 'ABORT')
	os.exit(1)
end

--daemonize (Linux only) -----------------------------------------------------

ffi.cdef[[
int setsid(void);
int fork(void);
unsigned int umask(unsigned int mask);
int close(int fd);
]]

local function pidfile()
	return indir(var_dir, app_name..'.pid')
end

local function findpid(pid, cmd)
	local s = readfile(_('/proc/%s/cmdline', pid))
	return s and s:find(cmd, 1, true) and true or false
end

local function running()
	local pid = tonumber((readfile(pidfile())))
	if not pid then return false end
	return findpid(pid, arg[0]), pid
end

function lincmd.running()
	return running() and 0 or 1
end

function lincmd.status()
	local is_running, pid = running()
	if is_running then
		say('Running. PID: %d', pid)
	else
		say 'Not running.'
	end
end

function lincmd.start()
	local is_running, pid = running()
	if is_running then
		say('Already running. PID: %d', pid)
		return 1
	elseif pid then
		say'Stale pid file found.'
	end
	local pid = C.fork()
	assert(pid >= 0)
	if pid > 0 then --parent process
		save(pidfile(), tostring(pid))
		say('Started. PID: %d', pid)
	else --child process
		C.umask(0)
		local sid = C.setsid()
		assert(sid >= 0)
		C.close(0)
		C.close(1)
		C.close(2)
		lincmd.run()
	end
end

function lincmd.stop()
	local is_running, pid = running()
	if not is_running then
		say'Not running.'
		return 1
	end
	sayn('Killing PID %d...', pid)
	exec('kill %d', pid)
	if running() then
		say'Failed.'
		return 1
	end
	say'OK.'
	rm(pidfile())
	return 0
end

function lincmd.restart()
	if lincmd.stop() == 0 then
		lincmd.start()
	end
end

function cmd.tail()
	local logfile = indir(var_dir, app_name..'.log')
	exec('tail -f %s', logfile)
end

--init -----------------------------------------------------------------------

--for strict mode...
app_name = app_name
app_dir = app_dir
bin_dir = bin_dir
var_dir = var_dir
tmp_dir = tmp_dir
www_dir = www_dir
libwww_dir = libwww_dir

function daemon(app_name)

	_G.app_name = assert(app_name)

	--consider this module loaded so that other app submodules that
	--require it at runtime don't try to load it again.
	package.loaded[app_name] = app

	app_dir = fs.scriptdir()
	bin_dir = bin_dir or indir(app_dir, 'bin', win and 'windows' or 'linux')
	var_dir = var_dir or indir(app_dir, 'var')
	tmp_dir = tmp_dir or indir(app_dir, 'tmp')
	www_dir = www_dir or indir(app_dir, 'www')
	libwww_dir = libwww_dir or indir(app_dir, 'sdk', 'www')

	--make require() see Lua modules from the app dir.
	glue.luapath(app_dir)

	app.conf = {
		app_name = app_name,
		app_dir  = app_dir,
		bin_dir  = bin_dir,
		var_dir  = var_dir,
		tmp_dir  = tmp_dir,
		www_dir  = www_dir,
		libwww_dir = libwww_dir,
	}

	--require an optional config file.
	local ok, opt = pcall(require, app_name..'_conf')
	if ok and type(opt) == 'table' then
		update(app.conf, opt)
	end

	local wrapped = {help=1, start=1}
	function cmd.help(extra)
		if extra then
			for k,v in sortedpairs(cmd) do
				if not wrapped[k] then
					say(fmt('   %-33s %s', k:gsub('_', '-'), help[k] or ''))
				end
			end
			return
		end
		say''
		say(' USAGE: '..app_name..' [OPTIONS] COMMAND ...')
		say''
		for k,v in sortedpairs(cmd) do
			print(fmt('   %-33s %s', k:gsub('_', '-'), help[k] or ''))
		end
		say''
		say' OPTIONS:'
		say''
		say'   -v       verbose'
		say'   --debug  debug'
		say''
	end

	function app:run_cmd(f, ...) --stub
		local exit_code = f(...)
		self:finish()
		return exit_code
	end

	function app:init() end --stub

	--if you override run_cmd() then you have to call this!
	function app:finish()
		logging:toserver_stop()
	end

	function app:run(...)

		if ... == app_name then --caller module loaded with require()
			return app
		end

		mkdir(var_dir)
		mkdir(tmp_dir)

		--cd to app_dir so that we can use relative paths for everything.
		chdir(app_dir)

		--set up logging.
		logging.deploy  = app.conf.deploy
		logging.env     = app.conf.env
		logging.verbose = app_name

		local i = 1
		local f
		while true do
			local s = select(i, ...)
			i = i + 1
			if s == '-v' then
				logging.verbose = true
				env('VERBOSE', 1) --propagate verbosity to sub-processes.
			elseif s == '--debug' then
				logging.verbose = true
				logging.debug = true
				env('DEBUG', 1) --propagate debug to sub-processes.
				env('VERBOSE', 1) --propagate verbosity to sub-processes.
			else
				if s == '--help' then s = 'help' end
				local c = s and s:gsub('-', '_') or 'help'
				f = (Windows and wincmd[c])
					or (Linux and lincmd[c])
				break
			end
		end

		--inherit debug and verbosity from parent process.
		if repl(env'DEBUG'  , '', nil) then logging.debug   = true end
		if repl(env'VERBOSE', '', nil) then logging.verbose = true end

		local logfile = indir(var_dir, app_name..'.log')
		logging:tofile(logfile)

		if app.conf.log_host and app.conf.log_port then
			logging:toserver(app.conf.log_host, app.conf.log_port)
		end

		self:init()

		return self:run_cmd(f, select(i, ...))
	end

	return app

end
