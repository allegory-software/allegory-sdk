--[==[

	daemon apps
	Written by Cosmin Apreutesei. Public Domain.

	daemon(cmdline_args...) -> app

	cmd_server     cmdline section for server control

	exit(app:run(...))    run the daemon app with cmdline args

	deploy         app deployment name.
	machine        app machine name.
	env            app environment ('dev').
	log_host       log server host.
	log_port       log server port.

]==]

require'glue'
require'cmdline'
require'sock'

--daemonize (Linux only) -----------------------------------------------------

cmd_server = cmdsection'SERVER CONTROL'

cdef[[
int setsid(void);
int fork(void);
unsigned int umask(unsigned int mask);
int close(int fd);
]]

local pidfile

local function findpid(pid, cmd)
	local s = load(_('/proc/%s/cmdline', pid), false, true)
	return s and s:find(cmd, 1, true) and true or false
end

local function running()
	local pid = tonumber((load(pidfile, false)))
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
		rm(pidfile)
	end
end)

local run_server
cmd_server('run', 'Run server in foreground', function()
	run_server()
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
		save(pidfile, tostring(pid))
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
		C.close(0)
		C.close(1)
		C.close(2)
		local ok = pcall(run_server)
		rm(pidfile)
		os.exit(ok and 0 or 1)
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
	for i=1,10 do
		if not running() then
			say'OK.'
			rm(pidfile)
			return 0
		end
		sayn'.'
		wait(.1)
	end
	say'Failed.'
	return 1
end)

cmd_server(Linux, 'restart', 'Restart the server', function()
	if cmd_server.stop.fn() == 0 then
		cmd_server.start.fn()
	end
end)

cmd_server('tail', 'tail -f the log file', function()
	exec('tail -f %s', logfile)
end)

--init -----------------------------------------------------------------------

function daemon(...)

	local app = {}

	local cmd_action, cmd_opt, cmd_args, cmd_run = cmdaction(...) --process cmdline options.

	randomseed(clock()) --mainly for resolver.

	local conffile

	--non-configurable, convention-based things.
	pidfile  = indir(scriptdir(), scriptname..'.pid')
	logfile  = indir(scriptdir(), scriptname..'.log')
	conffile = indir(scriptdir(), scriptname..'.conf')

	--consider this module loaded so that other app submodules that
	--require it at runtime don't try to load it again.
	package.loaded[scriptname] = app

	--make require() see Lua modules from the script dir.
	luapath(scriptdir())
	ffipath(indir(scriptdir(), 'bin', win and 'windows' or 'linux'))

	--cd to scriptdir so that we can use relative paths for everything if we want to.
	chdir(scriptdir())
	function chdir(dir)
		error'chdir() not allowed'
	end

	--load an optional config file.
	load_config_file(conffile)

	--set up logging.
	logging.deploy  = config'deploy'
	logging.machine = config'machine'
	logging.env     = config'env'

	local start_heartbeat, stop_heartbeat do
		local stop, sleeper
		function start_heartbeat()
			resume(thread(function()
				sleeper = wait_job(1)
				while not stop do
					logging.logvar('live', time())
					sleeper:wait(1)
				end
			end, 'logging-heartbeat'))
		end
		function stop_heartbeat()
			stop = true
			if sleeper then
				sleeper:resume()
			end
		end
	end

	function run_server() --fw. declared.
		server_running = true
		env('TZ', ':/etc/localtime')
		--^^avoid having os.date() stat /etc/localtime.
		logging:tofile(logfile)
		logging.flush = logging.debug
		local logtoserver = config'log_host' and config'log_port'
		if logtoserver then
			logging:toserver(config'log_host', config'log_port')
			start_heartbeat()
		end
		app:run_server()
		if logtoserver then
			stop_heartbeat()
			logging:toserver_stop()
		end
		logging:tofile_stop()
	end

	function app:run_cmd(cmd_action, cmd_run, cmd_opt, ...) --stub
		return cmd_run(cmd_action, cmd_opt, ...)
	end

	function app:run()
		if cmd_action == scriptname then --caller module loaded with require()
			return app
		end
		return self:run_cmd(cmd_action, cmd_run, cmd_opt, unpack(cmd_args))
	end

	return app

end
