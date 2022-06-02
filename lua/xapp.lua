--[==[

	X-Widgets Application Server
	Written by Cosmin Apreutesei. Public Domain.

LOADS

	x-widgets, fontawesome, markdown-it, xauth

USAGE

	local myapp = require('xapp')(...)
	....
	return myapp:run(...)


]==]

require'daemon'
require'webb_spa'
require'xrowset'
require'xmodule'
require'schema'

Sfile[[
schema_std.lua
]]

function load_opensans()
	css[[
	body {
		font-family: opensans, Arial, sans-serif;
	}
	]]
	fontfile'OpenSans-Regular.ttf'
	fontfile'OpenSans-SemiBold.ttf'
	fontfile'OpenSansCondensed-Light.ttf'
	fontfile'OpenSansCondensed-Bold.ttf'
end

js[[
on_dom_load(function() {
	init_xmodule({layers: []})
	init_components()
	init_root_widget()
	init_auth()
	init_action()
})
]]

cssfile[[
fontawesome.css
x-widgets.css
]]

jsfile[[
markdown-it.js
markdown-it-easy-tables.js
x-widgets.js
x-nav.js
x-input.js
x-listbox.js
x-grid.js
x-module.js
]]

Sfile[[
webb.lua
webb_query.lua
webb_spa.lua
xapp.lua
x-widgets.js
x-nav.js
x-input.js
x-listbox.js
x-grid.js
x-module.js
]]

fontfile'fa-solid-900.woff2'

require'xauth'

local function xapp(...)

	local app = daemon(...)

	function app:run_server()
		app.server = webb_http_server()
		start()
	end

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

	config('body_classes', 'x-container')

	Sfile(scriptname..'.lua')

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

	return app
end

--[==[

TODO

--e2e testing ----------------------------------------------------------------

function xapp_request(uri)
	run(function()
		resume(thread(function()
			webb_http_server{
				listen = {
					{host = 'localhost', addr = '127.0.0.1', port = 12345},
				},
			}
		end))
		resume(thread(function()
			getpage('http://localhost:12345'..uri)
		end))
	end)

end

if not ... then

	load_config_string[[
db_host = '10.0.0.5'
db_port = 3307
db_pass = 'root'
db_name = 'mm'
]]

	local app = xapp()
	app:run_server()

	return
end

]==]

return xapp
