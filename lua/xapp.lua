--[==[

	Canvas-UI-based Application Server.
	Written by Cosmin Apreutesei. Public Domain.

LOADS

	canvas-ui

USAGE

	local myapp = require('xapp')(...)
	....
	return myapp:run(...)

PUBLISHES

	myapp.schema

USES

	function myapp:install() end

CONFIG

	host
	dev_email

]==]

--NOTE: wwwdir() must be called before any jsfile(), cssfile(), htmlfile() calls!
require'glue'
require'webb'

local sdkdir = dirname(exedir())
wwwdir'www'
wwwdir(indir(sdkdir, 'www'))
wwwdir(indir(sdkdir, 'canvas-ui/www'))

require'daemon'
require'webb_spa'
require'xrowset'
require'schema'
require'mdbx_query'

js[[
document.addEventListener('DOMContentLoaded', function init_all() {
	init_action()
})
]]

jsfile[[
ui.js
ui_validation.js
ui_nav.js
ui_grid.js
ui_code_edit.js
lezer.js
adapter.js
webrtc.js
]]

fontfile[[
far=icons/fa-regular-400.woff2
fas=icons/fa-solid-900.woff2
mono=fonts/jetbrains-mono-nl-regular.woff2
]]

local function xapp(...)

	local app = daemon(...)

	function app:run_server()
		app.server = webb_http_server()
		start()
	end

	function logging.rpc:close_all_sockets()
		app.server:close_all_sockets()
		close_all_dbs()
	end

	app.before = before
	app.after = after

	function app:run_cmd(cmd_name, cmd_run, cmd_opt, ...)
		local exit_code
		if cmd_name == 'run' then --run server in main thread
			exit_code = cmd_run(cmd_name, cmd_opt, ...)
		else
			exit_code = run(function(...)
				local ok, err = pcall(cmd_run, cmd_name, cmd_opt, ...)
				if not ok then --check500, assert, etc.
					log('ERROR', 'xapp', 'run', '%s', err)
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

	config{main_module = function()
		checkfound(action(unpack(args())))
	end}

	app.schema = schema.new()

	app.schema.engine = 'mdbx'

	app.schema.env.null = null
	app.schema.env.Sf = Sf

	app.schema:import'schema_mdbx'
	app.schema:import'webb_auth'

	config{db_schema = app.schema}

	cmd('install [forealz]', 'Install or migrate the app', function(opt, doit)
		local dry = doit ~= 'forealz'
		db():sync_schema(app.schema, {dry = dry})
		if not dry then
			atomic('w', function(tx)
				tx:insert('tenant', '{}', {
					--tenant = 1,
					name = 'default',
					host = config'host',
				})
				if config'dev_email' then
					usr_create_or_update{
						tenant = 1,
						email = config'dev_email',
						roles = 'dev admin',
					}
				end
			end)
			if app.install then
				app:install()
			end
		end
		say'Install done.'
	end)

	_G.app = app
end

return xapp
