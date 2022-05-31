require'glue'
require'http_server'
logging.debug = true

local server = http_server{
	listen = {
		{
			host = 'localhost',
			addr = '127.0.0.1',
			port = 80,
		},
		{
			host = 'localhost',
			addr = '127.0.0.1',
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
