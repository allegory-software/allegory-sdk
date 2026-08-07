--[==[

	webb-based Application Server.
	Written by Cosmin Apreutesei. Public Domain.

LOADS

	webb, webb_action, webb_auth, xrowset

USAGE

	require'webb_app'(...)
	....
	return exit(app:run())

API

	app:run() -> exit_code
	app:run_server()
	app:run_cmd(cmd_name, cmd_run, cmd_opt, ...) -> exit_code
	user_json() -> {signed_in=, anonymous=, email=, phone=}
	db() -> db                             open the configured db
	scan(tbl, [path], [alias]) -> scan     db():scan()
	query('TABLE [ALIAS]'|rel, [alias]) -> rel   db():from()

ACTIONS

	gen_auth_code.json
	login.json

CONFIG

	deploy
	machine
	env
	log_host
	log_port
	db_file      var/SCRIPTNAME.mdbx

]==]

--NOTE: www_dirs must be set before any jsfile(), cssfile(), htmlfile() calls!
require'glue'
require'cmdline'
require'webb'
require'webb_action'
require'webb_auth'
require'xrowset'

local run_server --fw. decl.

--tie cmdline to server
cmd('run', 'Run server', function()
	run_server()
end)
cmddefault'run'

--configure webb_action static file loading.
wwwdir'www'

function user_json()
	return {
		signed_in = user() ~= nil, --not used but dummy attr to avoid empty []
		anonymous = user'anonymous',
		email = user'email',
		phone = user'phone',
	}
end

action['gen_auth_code.json'] = function()
	checkarg(method'POST')
	local email = checkarg(str_arg(post'email'))
	local code = auth_gen_code{email = email}
	return {email = email, code = config'env' == 'dev' and code or nil}
end

action['login.json'] = function()
	checkarg(method'POST')
	local email = checkarg(str_arg(post'email'))
	local code = checkarg(str_arg(post'code'))
	login{type = 'code', email = email, code = code}
	return user_json()
end

local app_db
function db()
	if not app_db then
		require'mdbx_query'
		app_db = mdbx_open(config('db_file',
			varpath(scriptname..'.mdbx')), {owner = mainthread()})
	end
	return app_db
end
function scan(...) return db():scan(...) end
function query(...) return db():from(...) end

local function webb_app(...)

	if package.loaded[scriptname] then return end

	local app = {}

	--process cmdline args.
	local cmd_action, cmd_opt, cmd_args, cmd_run = cmdaction(...)

	randomseed(clock()) --mainly for resolver.
	env('TZ', ':/etc/localtime') --avoid having os.date() stat /etc/localtime.

	--cd to scriptdir so that we can use relative paths for everything.
	chdir(scriptdir())
	function chdir(dir)
		error'chdir() not allowed'
	end
	--overwrite vardir() so we can see only short rel paths in logs.
	local rel_vardir = relpath(vardir(), scriptdir())
	function vardir()
		return rel_vardir
	end
	mkdir(vardir(), true)

	--non-configurable, convention-based things.
	local logfile  = varpath(scriptname..'.log')
	local conffile = varpath(scriptname..'.conf')

	--consider this module loaded so that other app submodules that
	--require it at runtime don't try to load it again.
	package.loaded[scriptname] = app

	--make require() and ffi.load() see app dependencies.
	package.path = package.path..';'..scriptdir()..'/?.lua'
	sopath(scriptdir()..'/bin')

	--load an optional config file.
	load_config_file(conffile)

	auth_init()

	--set up logging.
	logging.deploy  = config'deploy'
	logging.machine = config'machine'
	logging.env     = config'env'

	function run_server() --fw. declared.
		env('TZ', ':/etc/localtime') --keep os.date() from stat'ing /etc/localtime.
		logging:tofile(logfile)
		logging.autosync = logging.debug
		if config'log_host' then
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
			logging:toserver(config'log_host', config('log_port', 5555))
			start_heartbeat()
			app:run_server()
			stop_heartbeat()
			logging:toserver_stop()
		else
			app:run_server()
		end
		logging:tofile_stop()
	end

	local ran
	function app:run()
		if ran then return end
		ran = true
		return self:run_cmd(cmd_action, cmd_run, cmd_opt,
			unpack(cmd_args, 1, cmd_args.n))
	end

	function app:run_server()
		app.server = http_server{
			respond = function(req)
				checkfound(action(unpack(args())))
			end,
		}
		start()
		auth_store().close()
	end

	function logging.rpc:close_all_sockets()
		app.server:close_all_sockets()
		if app_db then
			app_db:close()
			app_db = nil
		end
	end

	function app:run_cmd(cmd_name, cmd_run, cmd_opt, ...)
		local exit_code
		if cmd_name == 'run' then --run server in main thread
			exit_code = cmd_run(cmd_name, cmd_opt, ...)
		else
			exit_code = run(function(...)
				local ok, err = pcall(cmd_run, cmd_name, cmd_opt, ...)
				if not ok then --check500, assert, etc.
					log('ERROR', 'webb_app', 'run', '%s', err)
					return 1
				end
				return err --exit_code
			end, ...)
		end
		mainthread():close()
		if logging.debug then --show any leaks.
			logging.printlive()
			say('%-12s: %d', 'wait_count', epoll_wait_count())
		end
		return exit_code
	end

	rawset(_G, 'app', app)
end

return webb_app
