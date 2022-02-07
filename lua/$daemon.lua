--[==[

	$ | daemon apps
	Written by Cosmin Apreutesei. Public Domain.

	daemon() -> app
	app.name       app name: the name of the Lua script without file extension.
	app.dir        app directory.
	app.bindir     app bin directory.
	app.vardir     r/w persistent data dir.
	app.tmpdir     r/w persistent temp dir.
	app.wwwdir     app www directory.
	app.libwwwdir  shared www directory.
	app.conf       options loaded from config file (see below).

	cmd_server     cmdline section for server control

FILES

	APP.conf       config file loaded at start-up. its globals go in app.conf.
	---------------------------------------------------------------------------
	deploy         app deployment name.
	env            app environment ('dev').
	log_host       log server host.
	log_port       log server port.

]==]

require'$fs'
require'$log'
require'$cmd'

local app = {}

--daemonize (Linux only) -----------------------------------------------------

cmd_server = cmdsection'SERVER CONTROL'

ffi.cdef[[
int setsid(void);
int fork(void);
unsigned int umask(unsigned int mask);
int close(int fd);
]]

local function findpid(pid, cmd)
	local s = readfile(_('/proc/%s/cmdline', pid))
	return s and s:find(cmd, 1, true) and true or false
end

local function running()
	local pid = tonumber((readfile(app.pidfile)))
	if not pid then return false end
	return findpid(pid, arg[0]), pid
end

cmd_server(Linux, 'running', 'Check if the server is running', function()
	return running() and 0 or 1
end)

cmd_server(Linux, 'status', 'Show server status', function()
	local is_running, pid = running()
	if is_running then
		say('Running. PID: %d', pid)
	else
		say 'Not running.'
		rm(app.pidfile)
	end
end)

cmd_server(Linux, 'start', 'Start the server', function()
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
		save(app.pidfile, tostring(pid))
		say('Started. PID: %d', pid)
	else --child process
		C.umask(0)
		local sid = C.setsid()
		assert(sid >= 0)
		C.close(0)
		C.close(1)
		C.close(2)
		local run = cmdhandle('run')
		local ok, err = xpcall(run, debug.traceback)
		rm(app.pidfile)
		assert(ok, err)
	end
end)

cmd_server(Linux, 'stop', 'Stop the server', function()
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
	rm(app.pidfile)
	return 0
end)

cmd_server(Linux, 'restart', 'Restart the server', function()
	if lincmd.stop() == 0 then
		lincmd.start()
	end
end)

cmd_server('tail', 'tail -f the log file', function()
	exec('tail -f %s', app.logfile)
end)


--init -----------------------------------------------------------------------

function daemon(app_name, ...)

	assert(not app.name, 'daemon() already called')

	randomseed(clock()) --mainly for resolver.

	--non-configurable, convention-based things.
	app.name      = assert(app_name, 'app name required')
	app.dir       = fs.scriptdir()
	app.startdir  = fs.startcwd()
	app.bindir    = indir(app.dir, 'bin', win and 'windows' or 'linux')
	app.vardir    = indir(app.dir, 'var')
	app.tmpdir    = indir(app.dir, 'tmp')
	app.wwwdir    = indir(app.dir, 'www')
	app.libwwwdir = indir(app.dir, 'sdk', 'www')

	app.pidfile   = indir(app.dir, app.name..'.pid')
	app.logfile   = indir(app.dir, app.name..'.log')
	app.conffile  = indir(app.dir, app.name..'.conf')

	--consider this module loaded so that other app submodules that
	--require it at runtime don't try to load it again.
	package.loaded[app.name] = app

	--make require() see Lua modules from the app dir.
	glue.luapath(app.dir)

	--cd to app.dir so that we can use relative paths for everything if we want to.
	chdir(app.dir)
	function chdir(dir)
		error'chdir() not allowed'
	end

	--load an optional config file.
	do
		local conf_fn = loadfile(app.conffile)
		app.conf = {}
		if conf_fn then
			setfenv(conf_fn, app.conf)
			conf_fn()
		end
	end

	--set up logging.
	logging.deploy  = app.conf.deploy
	logging.env     = app.conf.env
	logging.verbose = app.name --show app's notes only.

	logging:tofile(app.logfile)

	if app.conf.log_host and app.conf.log_port then
		logging:toserver(app.conf.log_host, app.conf.log_port)
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

	--process cmdline options and get the cmdline action.
	local arg_i = cmdoptions(...)

	function app:run(...)
		if ... == app.name then --caller module loaded with require()
			return app
		end
		self:init()
		local cmd_fn = cmdaction(arg_i, ...)
		return self:run_cmd(cmd_fn, select(arg_i, ...))
	end

	return app

end
