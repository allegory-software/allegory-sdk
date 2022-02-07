
local smtp = require'smtp'
local sock = require'sock'
local logging = require'logging'

logging.debug = true

sock.run(function()

	local smtp = smtp:new{
		libs = 'sock',
		debug = {
			protocol = true,
			errors = true,
			tracebacks = true,
			stream = true,
		},
		logging = true,
		domain = '"localhost"',
		host = 'mail.bpnpart.com',
		port = 587,
		user = 'admin@bpnpart.com',
		pass = 'Bpnpart@0@0',
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

end)
