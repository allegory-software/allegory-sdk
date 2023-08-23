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
require'proc'
require'fs'
require'cmdline'

--daemonize (Linux only) -----------------------------------------------------

local pidfile
local run_server

if Linux then

cmd_server = cmdsection'SERVER CONTROL'

local function findpid(pid, cmd)
	local s = load(_('/proc/%s/cmdline', pid), false, true)
	return s and s:find(cmd, 1, true) and true or false
end

local function running()
	local pid = tonumber((load(pidfile, false)))
	if not pid then return false end
	return findpid(pid, arg[0]), pid
end

cmd_server('running', 'Check if the server is running', function()
	return running() and 0 or 1
end)

cmd_server('status', 'Show server status', function()
	local is_running, pid = running()
	if is_running then
		say('Running. PID: %d', pid)
	else
		say 'Not running.'
		rm(pidfile)
	end
end)

cmd_server('run', 'Run server in foreground', function()
	run_server()
end)

cmd_server('start', 'Start the server', function()
	local is_running, pid = running()
	if is_running then
		say('Already running. PID: %d', pid)
		return 1
	elseif pid then
		rm(pidfile)
		say'Stale pid file found and removed.'
	end
	--step 1..11.
	local pid = daemonize()
	--12. save pid to pidfile.
	save(pidfile, tostring(pid))
	local ok = pcall(run_server)
	logging:tofile_stop()
	rm(pidfile)
	exit(ok and 0 or 1)
end)

cmd_server('stop', 'Stop the server', function()
	local is_running, pid = running()
	if not is_running then
		say'Not running.'
		return 0
	end
	sayn('Killing PID %d...', pid)
	local p = C.kill(pid, 9)
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

cmd_server('restart', 'Restart the server', function()
	if cmd_server.stop.fn() == 0 then
		cmd_server.start.fn()
	end
end)

cmd_server('tail', 'tail -f the log file', function()
	local p = exec(_('tail -f %s', logfile))
	p:wait()
	p:forget()
end)

else --Linux

cmd('run', 'Run server in foreground', function()
	run_server()
end)

end

--init -----------------------------------------------------------------------

function daemon(...)

	local app = {before = before, after = after}

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
	sopath(indir(scriptdir(), 'bin', win and 'windows' or 'linux'))

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

	function run_server() --fw. declared.
		server_running = true
		env('TZ', ':/etc/localtime')
		--^^avoid having os.date() stat /etc/localtime.
		logging:tofile(logfile)
		logging.autoflush = logging.debug
		local logtoserver = config'log_host' and config'log_port'
		if logtoserver then
			require'sock'
			local start_heartbeat, stop_heartbeat do
				local stop, sleeper
				function start_heartbeat()
					resume(thread(function()
						sleeper = wait_job()
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
			logging:toserver(config'log_host', config'log_port')
			start_heartbeat()
			app:run_server()
			stop_heartbeat()
			logging:toserver_stop()
		else
			app:run_server()
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
