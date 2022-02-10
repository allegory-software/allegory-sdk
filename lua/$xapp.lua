--[==[

	X-Widgets Application Server
	Written by Cosmin Apreutesei. Public Domain.

USAGE

	local myapp = require('$xapp')('myapp', ...)
	....
	return myapp:run(...)

CONFIG

	TODO

]==]

require'$daemon'
require'$sock'
require'xapp'
require'webb_query'
require'xrowset_sql'
require'xusers'

require'http'        .logging = logging
require'http_client' .logging = logging
require'http_server' .logging = logging
require'mysql'       .logging = logging
require'tarantool'   .logging = logging

local schema = require'schema'

ffi.tls_libname = 'tls_bearssl'

cmd_server('run', 'Run server in foreground', function()
	local server = webb.server()
	server.start()
end)

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

return function(app_name, ...)

	local app = daemon(app_name, ...)

	function app:run_cmd(f, ...)
		return webb.run(function(...)
			local exit_code = f(...)
			self:finish()
			return exit_code
		end, ...)
	end

	config('app_name', app.name)
	config('app_dir' , app.dir)

	config('main_module', function()
		checkfound(action(unpack(args())))
	end)

	config('body_classes', 'x-container')

	Sfile(app.name..'.lua')

	app.schema = schema.new()

	app.schema.env.null = null
	app.schema.env.S = S

	app.schema:import'schema_std'
	app.schema:import'schema_lang'
	app.schema:import(webb.auth_schema)

	sqlpps.mysql    .define_symbol('current_timestamp', app.schema.env.current_timestamp)
	sqlpps.tarantool.define_symbol('current_timestamp', app.schema.env.current_timestamp)

	config('db_schema', app.schema)

	--pass all other app conf options to webb.
	for k,v in pairs(app.conf) do
		config(k, v)
	end

	return app
end
