
require'glue'
require'smtp'
require'sock'
require'logging'
require'multipart'
tls_libname = 'tls_bearssl'

logging.debug = true

run(function()

	local smtp = smtp_connect{
		debug = {
			protocol = true,
			errors = true,
			tracebacks = true,
			stream = true,
		},
		logging = true,
		host = 'mail.bpnpart.com',
		port = 587,
		--port = 465, tls = true,
		user = 'admin@bpnpart.com',
		pass = 'Bpnpart@0@0',
		tls_options = {
			ca_file = 'x:/care/cacert.pem',
			loadfile = glue.readfile,
		},
	}

	if false then

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

	else

		local req = multipart.mail{
			from = 'admin@bpnpart.com',
			to = 'cosmin.apreutesei@gmail.com',
			subject = 'How are you today?',
			text = 'Hello Dude!',
			html = '<h1>Hello</h1><p>Hello Dude</p><img src="cid:img1"><img src="cid:img2">',
			inlines = {
				{
					cid = 'img1',
					filename = 'progressive.jpg',
					content_type = 'image/jpeg',
					contents = assert(glue.readfile'jpeg_test/progressive.jpg'),
				},
				{
					cid = 'img2',
					filename = 'birds.jpg',
					content_type = 'image/jpeg',
					contents = assert(glue.readfile'pillow_test/birds.jpg'),
				},
			},
			attachments = {
				{
					name = 'Att1',
					filename = 'att1.txt',
					content_type = 'text/plain',
					contents = 'att1!',
				},
				{
					name = 'Att2',
					filename = 'att2.html',
					content_type = 'text/html',
					contents = '<h1>Wasup</h1>',
				},
			},
		}

		assert(smtp:sendmail(req))

	end

	assert(smtp:close())

end)
