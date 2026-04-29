--[==[

	Canvas-UI-based Application Server.
	Written by Cosmin Apreutesei. Public Domain.

LOADS

	canvas-ui

USAGE

	require('cui_app')(...)
	....
	return app:run(...)

CONFIG

	ignore_interrupts
	host

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

--configure webb_action static file loading.
wwwdir'www'

local fontfiles = {}
function fontfile(name, path)
	add(fontfiles, {name, path})
end

local function user_json()
	return {
		anonymous = user'anonymous',
		email = user'email',
		phone = user'phone',
	}
end

--tie webb to cui
function action.en()
	local vars = {}
	if _G.login then
		login() --sets lang from user profile.
		vars.theme = user'theme'
		vars.user_id = user()
	end
	vars.title = (args(1) or ''):gsub('[-_]', ' ')
	vars.lang = lang()
	vars.country = country()
	vars.favicon_href = call(config'favicon_href')
	vars.preloads = {}
	vars.css = {}
	for _,t in ipairs(fontfiles) do
		local name, path = unpack(t)
		local ext = path_ext(path)
		add(vars.preloads, format('\t<link rel="preload" href="/%s" as="font" type="font/%s" crossorigin>\n',
			path, ext))
		add(vars.css, format([[
@font-face {
	font-family: "%s";
	src: url(/%s) format(%s);
	font-display: block;
}
]], name, path, ext))
	end
	vars.main = load(app.main_file)
	vars.preloads = cat(vars.preloads, '\n')
	vars.css = cat(vars.css, '\n')
	vars.user = json(user_json())
	out((([[
<html lang={{lang}} country={{country}} theme="{{theme}}"><head>
	<meta charset="utf-8">
	<title>{{title}}</title>
{{preloads}}
	<style>
{{css}}
	</style>
	<script src="/glue.js" global></script>
	<script src="/ui.js" global></script>
	<script src="/ui_validation.js" ></script>
	<script src="/ui_nav.js" ></script>
	<script src="/ui_grid.js" ></script>
	<script src="/ui_code_edit.js" ></script>
	<script src="/lezer.js" ></script>
	<script src="/adapter.js" ></script>
	<script src="/webrtc.js" ></script>
	<script>
user = {{user}}
{{main}}
	</script>
</head><style></style>
<body>
</body>
</html>
]]):gsub('{{(.-)}}', function(k) return vars[k] or '' end)))
end

action['404.html'] = action.en

action['gen_auth_code.json'] = function()
	checkarg(method'POST')
	local email = checkarg(str_arg(post'email'))
	local code = auth_gen_code{email = email}
	return {email = email, code = code}
end

action['login.json'] = function()
	checkarg(method'POST')
	local email = checkarg(str_arg(post'email'))
	local code = checkarg(str_arg(post'code'))
	login{type = 'code', email = email, code = code}
	return user_json()
end

local function cui_app(...)

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
	local rel_vardir = relpath(vardir(), scriptdir())
	function vardir()
		return rel_vardir
	end

	--non-configurable, convention-based things.
	local pidfile  = scriptname..'.pid'
	local logfile  = scriptname..'.log'
	local conffile = scriptname..'.conf'

	--consider this module loaded so that other app submodules that
	--require it at runtime don't try to load it again.
	package.loaded[scriptname] = app

	--make require() and ffi.load() see app dependencies.
	luapath(scriptdir())
	sopath(indir(scriptdir(), 'bin', win and 'windows' or 'linux'))

	--load an optional config file.
	load_config_file(conffile)

	--set up logging.
	logging.deploy  = config'deploy'
	logging.machine = config'machine'
	logging.env     = config'env'

	function run_server() --fw. declared.
		server_running = true
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

	function app:run()
		if cmd_action == scriptname then --caller module loaded with require()
			return app
		end
		return self:run_cmd(cmd_action, cmd_run, cmd_opt, unpack(cmd_args))
	end

	function app:run_server()
		app.server = http_server{
			respond = function(req)
				checkfound(action(unpack(args())))
			end,
		}
		function interrupt()
			app.server:stop()
		end
		start()
		auth_store().close()
	end

	function logging.rpc:close_all_sockets()
		app.server:close_all_sockets()
		close_all_dbs()
	end

	function app:run_cmd(cmd_name, cmd_run, cmd_opt, ...)
		local exit_code
		if cmd_name == 'run' then --run server in main thread
			if config'http_host' == '*' then
				local auth_host = assert(config'auth_host')
				auth_init()
				auth_store().with_lock('w', function()
					auth_store().try_add_tenant(auth_host)
				end)
			end
			exit_code = cmd_run(cmd_name, cmd_opt, ...)
		else
			exit_code = run(function(...)
				local ok, err = pcall(cmd_run, cmd_name, cmd_opt, ...)
				if not ok then --check500, assert, etc.
					log('ERROR', 'cui_app', 'run', '%s', err)
					return 1
				end
				return err --exit_code
			end, ...)
		end
		if logging.debug then --show any leaks.
			logging.printlive()
		end
		return exit_code
	end

	_G.app = app
end

return cui_app
