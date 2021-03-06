--go@ plink d10 -t -batch sdk/bin/linux/luajit sdk/tests/http_server_test.lua
require'glue'
require'http_server'
logging.debug = true
local zero6 = Linux

local server = http_server{
	listen = {
		{
			host = 'localhost',
			addr = zero6 and '10.0.0.6' or '127.0.0.1',
			port = 80,
		},
		{
			host = 'localhost',
			addr = zero6 and '10.0.0.6' or '127.0.0.1',
			port = 443,
			tls = true,
			tls_options = {
				keypairs = {
					{
						cert_file = exedir()..'/../../tests/localhost.crt',
						key_file  = exedir()..'/../../tests/localhost.key',
					},
				},
			},
		},
	},
	debug = {
		protocol = true,
		--stream = true,
		--tracebacks = true,
		errors = true,
	},
	respond = function(req, thread)
		local read_body = req:read_body'reader'
		while true do
			local buf, sz = read_body()
			if buf == nil then break end --eof
			local s = str(buf, sz)
			print(s)
		end
		if req.uri == '/favicon.ico' then
			raise('http_response', {status = 404})
		end
		local out = req:respond({
			--compress = false,
			want_out_function = true,
		})
		out(('hello '):rep(1000))
		--raise{status = 404, content = 'Dude, no page here'}
	end,
	--respond = webb_respond,
}

start()
