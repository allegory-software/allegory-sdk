--[=[

	Async SMTP(s) client.
	Written by Cosmin Apreutesei. Public Domain.

	[try_]smtp_connect{host=, port=, tls=, user=, pass=} -> c
	c:[try_]sendmail{from=, to=, headers=, message=} -> c
	c:close() -> c

	[try_]sendmail(multipart|multipart_opt)

]=]

if not ... then require'smtp_test'; return end

require'glue'
require'pbuffer'
require'base64'
require'sock'
require'sock_libtls'
require'multipart'

local client = {
	type = 'smtp_client', debug_prefix = 'm',
	host = '127.0.0.1',
	tls = true,
	connect_timeout = 5,
	sendmail_timeout = 60,
	domain = 'localhost', --client's domain (useless)
	xmailer = 'allegory-sdk smtp client',
	tls_options = {
		ca_file = ca_file_path,
	},
}

function smtp_connect(t)

	local self = object(client, {}, t)
	self.host_addr = check_io(nil, try_resolve(self.host))
	self.f = tcp()
	self.f:settimeout(self.connect_timeout)
	self.f:connect(self.host_addr, self.port or self.tls and 465 or 587)
	if self.tls then
		self.f = self.f:check_io(client_stcp(self.f, self.host, self.tls_options))
	end
	self.b = pbuffer{f = self.f}
	self.f:onclose(function()
		self.b:free()
		self.b = nil
	end)

	--logging & debugging
	if self.debug and self.debug.tracebacks then
		self.f.tracebacks = true
	end
	if self.debug and self.debug.stream then
		self.f:debug'smtp'
	end

	--I/O

	local function send_line(fmt, s)
		s = _(fmt, s)
		assert(not s:find'[\r\n]', 'invalid line: %s', s)
		self.f:send(s..'\r\n')
	end

	local function check_reply(match)
		while true do
			local s = self.b:needline()
			local code, sep = s:match'^(%d%d%d)(.?)'
			self.f:checkp(tonumber(code), 'invalid response line: %s', s)
			if sep == ' ' then
				self.f:checkp(code:find(match), 'unexpected response code: %s', s)
				break
			end
		end
	end

	--EHLO & AUTH

	check_reply'2..'
	send_line('EHLO %s', self.domain)
	check_reply'2..'
	if self.user then
		send_line('AUTH PLAIN %s', base64_encode(
			'\0' .. self.user .. '\0' .. self.pass))
		check_reply'2..'
	end

	local function mprotect(method)
		local oncaught
		if self.debug and self.debug.errors then
			function oncaught(err)
				log('ERROR', 'smtp', method, '%s', err)
			end
		end
		self['try_'..method] = protect_io(self[method], oncaught)
	end

	function self:sendmail(req)
		log('note', 'smtp', 'sendmail', '%s from=%s to=%s subj="%s" msg#=%s',
			self.f, req.from, req.to, req.headers and req.headers.subject,
			kbytes(#req.message))
		self.f:settimeout(self.sendmail_timeout)
		send_line('MAIL FROM: %s', req.from)
		check_reply'2..'
		local to = isstr(req.to) and {req.to} or req.to
		for i,to in ipairs(to) do
			 send_line('RCPT TO: %s', req.to)
			 check_reply'2..'
		end
		send_line'DATA'
		check_reply'3..'
		local ht = update({}, req.headers)
		ht.date = os.date('!%a, %d %b %Y %H:%M:%S -0000')
		ht.x_mailer = self.xmailer
		ht.mime_version = '1.0'
		local t = {}
		for k,v in sortedpairs(ht) do
			t[#t+1] = k:gsub('_', '-'):lower() .. ': ' .. tostring(v)
		end
		t[#t+1] = ''
		t[#t+1] = ''
		local headers = concat(t, '\r\n')
		self.f:send(headers)
		local data = req.message:gsub('^%.', '..'):gsub('\n%.', '..')
		self.f:send(data)
		self.f:send'\r\n.\r\n'
		check_reply'2..'
		return true
	end
	mprotect'sendmail'

	function self:close()
		if self.f:closed() then
			return true
		end
		self.f:settimeout(self.connect_timeout)
		send_line'QUIT'
		check_reply'2..'
		self.f:close()
		return true
	end
	mprotect'close'

	return self
end
try_smtp_connect = protect_io(smtp_connect)

local function strip_name(email)
	return email:match'<(.-)>' or email
end
function try_sendmail(opt)

	local smtp, err = try_smtp_connect{
		debug = config'smtp_debug' and index(collect(words(config'smtp_debug'))),
		host  = config'smtp_host',
		port  = config'smtp_port',
		tls   = config'smtp_tls',
		user  = config'smtp_user',
		pass  = config'smtp_pass',
	}
	if not smtp then return nil, err end

	req = multipart_mail(update({}, opt))
	req.from = strip_name(opt.from)
	req.to   = strip_name(opt.to)

	local ok, err = smtp:try_sendmail(req)
	if not ok then return nil, err end

	local ok, err = smtp:close()
	if not ok then return nil, err end

	return true
end
function sendmail(opt)
	local ok, err = try_sendmail(opt)
	check('smtp', 'sendmail', ok, 'from: %s\n  to: %s\n%s', opt.from, opt.to, err or '')
end
