--go@ plink d10 -t -batch sdk/bin/linux/luajit sdk/tests/httplite_test.lua
require'glue'
require'http_server'
logging.debug = true

if os.getenv'AUTO' then return end

local HOST = '*'
local ADDR = nil -- '127.0.0.1'

local server = http_server{
	listen = {
		{
			host = HOST,
			addr = ADDR,
			port = 8888,
		},
		{
			host = HOST,
			addr = ADDR,
			port = 4443,
			tls = true,
			tls_options = {
				cert_file = exedir()..'/../tests/localhost.crt',
				key_file  = exedir()..'/../tests/localhost.key',
			},
		},
	},
	debug = {
		protocol = true,
		--stream = true,
		tracebacks = true,
		errors = true,
	},
	--compress = false,
	respond = function(req, thread)
		while true do
			local buf, sz, left = req:read_body_chunk()
			if left == 0 then break end
			local s = str(buf, sz)
			print(s)
		end
		if req.uri == '/favicon.ico' then
			raise('http_response', {status = 404})
		end
		local out = req:send_headers()
		req:send_body_chunk(('hello '):rep(1000)):finish()
		--raise{status = 404, content = 'Dude, no page here'}
	end,
	--respond = webb_respond,
}

start()
server:stop()
