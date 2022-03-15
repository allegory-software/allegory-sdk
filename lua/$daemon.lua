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

	exit(app:run(...))    run the daemon app with cmdline args

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
require'$sock'

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
	local s = load(_('/proc/%s/cmdline', pid), false, true)
	return s and s:find(cmd, 1, true) and true or false
end

local function running()
	local pid = tonumber((load(app.pidfile, false)))
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
	local run = assert(cmdaction(2, 'run'), 'cmdline action "run" not defined')
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
		os.exit(0)
	else --child process
		C.umask(0)
		local sid = C.setsid() --prevent killing the child when parent is killed.
		assert(sid >= 0)
		logging.quiet = true
		io.stdin:close()
		io.stdout:close()
		io.stderr:close()
		local ok, exit_code = pcall(run)
		rm(app.pidfile)
		os.exit(ok and (exit_code or 0) or 1)
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

local run_server
cmd_server('run', 'Run server in foreground', function()
	run_server()
end)

--init -----------------------------------------------------------------------

function daemon(app_name, ...)

	local arg_i = cmdoptions(...) --process cmdline options.

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
	function fs.chdir(dir)
		error'chdir() not allowed'
	end

	--load an optional config file.
	do
		local conf_s = load(app.conffile, false)
		app.conf = {}
		if conf_s then
			local conf_fn = assert(loadstring(conf_s))
			setfenv(conf_fn, app.conf)
			conf_fn()
		end
	end

	--set up logging.
	logging.deploy  = app.conf.deploy
	logging.env     = app.conf.env

	local start_heartbeat, stop_heartbeat do
		local stop, sleeper
		function start_heartbeat()
			thread(function()
				sleeper = sleep_job(1)
				while not stop do
					logging.logvar('live', time())
					sleeper:sleep(1)
				end
			end)
		end
		function stop_heartbeat()
			stop = true
			if sleeper then
				sleeper:wakeup()
			end
		end
	end

	function run_server() --fw. declared.
		if app.conf.log_host and app.conf.log_port then
			logging:tofile(app.logfile)
			logging.flush = logging.debug
			logging:toserver(app.conf.log_host, app.conf.log_port)
			start_heartbeat()
		end
		app:run_server()
		stop_heartbeat()
		logging:toserver_stop()
		logging:tofile_stop()
	end

	function app:run_cmd(cmd_name, cmd_fn, ...) --stub
		return cmd_fn(...)
	end

	function app:init(cmd, ...) end --stub
	function app:finish(cmd) end --stub

	function app:run(...)
		if ... == app.name then --caller module loaded with require()
			return app
		end
		local cmd_fn, cmd_name = cmdaction(arg_i, ...)
		return self:run_cmd(cmd_name, cmd_fn, select(arg_i, ...))
	end

	return app

end
