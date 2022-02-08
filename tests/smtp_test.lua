
local glue = require'glue'
local smtp = require'smtp'
local sock = require'sock'
local logging = require'logging'
require'ffi'.tls_libname = 'tls_bearssl'

logging.debug = true

sock.run(function()

	local smtp = smtp:connect{
		debug = {
			protocol = true,
			errors = true,
			tracebacks = true,
			stream = true,
		},
		logging = true,
		domain = 'localhost',
		host = 'mail.bpnpart.com',
		--port = 587,
		port = 465, tls = true,
		user = 'admin@bpnpart.com',
		pass = 'Bpnpart@0@0',
		tls_options = {
			ca_file = 'x:/care/cacert.pem',
			loadfile = glue.readfile,
		},
	}

	assert(smtp:sendmail{
		from = 'admin@bpnpart.com',
		to = 'cosmin.apreutesei@gmail.com',
		message = 'Hello Dude!',
		headers = {
			from = 'admin@bpnpart.com',
			to = 'cosmin.apreutesei@gmail.com',
			subject = 'How are you today?',
		},
	})

	assert(smtp:close())

end)
