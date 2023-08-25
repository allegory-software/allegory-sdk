--[==[

	Canvas-UI-based Application Server.
	Written by Cosmin Apreutesei. Public Domain.

LOADS

	widgets, fontawesome, markdown-it, xauth

USAGE

	local myapp = require('xapp')(...)
	....
	return myapp:run(...)

PUBLISHES

	myapp.schema

USES

	function myapp:install() end

]==]

require'daemon'
require'webb_spa'
require'xrowset'
require'schema'

js[[
on_dom_load(function init_all() {
	init_action()
})
]]

jsfile[[
ui.js
ui_validation.js
ui_nav.js
ui_grid.js
adapter.js
webrtc.js
]]

require'xauth'

local function xapp(...)

	local app = daemon(...)

	function app:run_server()
		app.server = webb_http_server()
		start(config('ignore_interrupts', true))
	end

	function logging.rpc:close_all_sockets()
		app.server:close_all_sockets()
		close_all_dbs()
	end

	app.before = before
	app.after = after

	function app:run_cmd(cmd_name, cmd_fn, ...)
		if cmd_name == 'run' then
			return cmd_fn(cmd_name, ...)
		end
		return run(function(...)
			local ok, err = pcall(cmd_fn, cmd_name, ...)
			if not ok then --check500, assert, etc.
				log('ERROR', 'xapp', 'run', '%s', err)
				return 1
			end
			return err --exit_code
		end, ...)
	end

	config('main_module', function()
		checkfound(action(unpack(args())))
	end)

	app.schema = schema()

	app.schema.env.null = null
	app.schema.env.Sf = Sf

	app.schema:import'schema_std'
	app.schema:import'webb_auth'

	sqlpps.mysql    .define_symbol('current_timestamp', app.schema.env.current_timestamp)
	sqlpps.tarantool.define_symbol('current_timestamp', app.schema.env.current_timestamp)

	config('db_schema', app.schema)

	if config('multilang', true) then
		require'xlang'
	end

	cmd('install [forealz]', 'Install or migrate the app', function(opt, doit)
		create_db()
		local dry = doit ~= 'forealz'
		db():sync_schema(app.schema, {dry = dry})
		if not dry then
			insert_or_update_row('tenant', {
				tenant = 1,
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
			if app.install then
				app:install()
			end
		end
		say'Install done.'
	end)

	return app
end

return xapp
