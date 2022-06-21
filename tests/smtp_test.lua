require'glue'
require'smtp'
require'resolver'
require'sock'
require'logging'
require'multipart'
logging.filter.tls = true
config('ca_file', exedir()..'/../../tests/cacert.pem')

logging.debug = true

config('smtp_host' , 'mail.bpnpart.com')
--config('smtp_port' , 587)
--config('smtp_tls'  , false)
config('smtp_user' , 'admin@bpnpart.com')
config('smtp_pass' , 'Bpnpart@0@0')
config('smtp_debug', 'protocol errors stream tracebacks')

run(function()

	if false then

		sendmail{
			from = 'admin@bpnpart.com',
			to = 'cosmin.apreutesei@gmail.com',
			message = 'Hello Dude!',
			headers = {
				from = 'admin@bpnpart.com',
				to = 'cosmin.apreutesei@gmail.com',
				subject = 'How are you today?',
			},
		}

	else

		sendmail{
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
					contents = load'jpeg_test/progressive.jpg',
				},
				{
					cid = 'img2',
					filename = 'birds.jpg',
					content_type = 'image/jpeg',
					contents = load'resize_image_test/birds.jpg',
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

	end

end)
