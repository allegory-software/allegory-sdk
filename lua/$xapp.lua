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

require'fs'          .logging = logging
require'sock'        .logging = logging
require'http'        .logging = logging
require'http_client' .logging = logging
require'http_server' .logging = logging
require'mysql'       .logging = logging
require'tarantool'   .logging = logging

local schema = require'schema'

ffi.tls_libname = 'tls_bearssl'

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

return function(app_name, ...)

	local app = daemon(app_name, ...)

	function app:run_server()
		local server = webb.server()
		server.start()
	end

	function app:run_cmd(cmd_name, cmd_fn, ...)
		return webb.run(function(...)
			local ok, err = pcall(cmd_fn, ...)
			if not ok then --check500, assert, etc.
				webb.logerror('webb', 'run', '%s', err)
				return 1
			end
			return err --exit_code
		end, ...)
	end

	--pass all APP.conf options to webb.
	for k,v in pairs(app.conf) do
		config(k, v)
	end

	config('app_name'   , app.name)
	config('app_dir'    , app.dir)
	config('www_dir'    , app.wwwdir)
	config('libwww_dir' , app.libwwwdir)
	config('var_dir'    , app.vardir)
	config('tmp_dir'    , app.tmpdir)

	config('main_module', function()
		checkfound(action(unpack(args())))
	end)

	config('body_classes', 'x-container')

	Sfile(app.name..'.lua')

	app.schema = schema.new()

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
