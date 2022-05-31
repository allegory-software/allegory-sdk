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
require'linebuffer'
require'base64'
require'sock'
require'sock_libtls'
require'multipart'

local client = {
	type = 'smtp_client', debug_prefix = 'm',
	host = '127.0.0.1',
	port = 465,
	tls = true,
	connect_timeout = 5,
	sendmail_timeout = 60,
	domain = 'localhost', --client's domain (useless)
	max_line_size = 8192,
	xmailer = 'allegory-sdk smtp client',
	tls_options = {
		ca_file = ca_file_path,
	},
}

local check_io, checkp, check, protect = tcp_protocol_errors'smtp'

function try_smtp_connect(t)

	local self = object(client, {}, t)

	self.host_addr = check(self, resolve(self.host))
	self.tcp = check(self, tcp())

	--logging & debugging

	if self.debug and self.debug.tracebacks then
		self.tracebacks = true --for tcp_protocol_errors.
	end

	local function mprotect(method)
		local oncaught
		if self.debug and self.debug.errors then
			function oncaught(err)
				log('ERROR', 'smtp', method, '%s', err)
			end
		end
		self['try_'..method] = protect(self[method], oncaught)
	end

	if self.debug and self.debug.stream then
		self.tcp:debug('smtp', log)
	end

	--I/O

	local expires
	local function set_timeout(dt)
		expires = dt and clock() + dt or nil
	end

	local function read(buf, sz)
		return self.tcp:recv(buf, sz, expires)
	end
	local readline = linebuffer(read, '\r\n', self.max_line_size).readline

	local function send(s)
		check_io(self, self.tcp:send(s, nil, expires))
	end

	local function send_line(fmt, s)
		s = _(fmt, s)
		check(self, not s:find'[\r\n]', 'invalid line: %s', s)
		send(s..'\r\n')
	end

	local function check_reply(match)
		while true do
			local s = check_io(self, readline())
			local code, sep = s:match'^(%d%d%d)(.?)'
			checkp(self, tonumber(code), 'invalid response line: %s', s)
			if sep == ' ' then
				checkp(self, code:find(match), 'unexpected response code: %s', s)
				break
			end
		end
	end

	function self:_connect()
		set_timeout(self.connect_timeout)
		check_io(self, self.tcp:connect(self.host_addr, self.port, expires))
		if self.tls then
			self.tcp = check_io(self, client_stcp(self.tcp, self.host, self.tls_options))
		end
		check_reply'2..'
		send_line('EHLO %s', self.domain)
		check_reply'2..'
		if self.user then
			send_line('AUTH PLAIN %s', base64_encode(
				'\0' .. self.user .. '\0' .. self.pass))
			check_reply'2..'
		end
		return self
	end
	mprotect'_connect'

	function self:sendmail(req)
		if log then
			log('note', 'smtp', 'sendmail', '%s from=%s to=%s subj="%s" msg#=%s',
				self.tcp, req.from, req.to, req.headers and req.headers.subject,
				kbytes(#req.message))
		end
		set_timeout(self.sendmail_timeout)
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
		send(headers)
		local data = req.message:gsub('^%.', '..'):gsub('\n%.', '..')
		send(data)
		send'\r\n.\r\n'
		check_reply'2..'
		return true
	end
	mprotect'sendmail'

	function self:close()
		if self.tcp:closed() then
			return true
		end
		set_timeout(self.connect_timeout)
		send_line'QUIT'
		check_reply'2..'
		check_io(self, self.tcp:close(expires))
		return true
	end
	mprotect'close'

	return self:try__connect()
end
smtp_connect = protect(try_smtp_connect)

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
	check('smtp', 'sendmail', ok, 'from: %s\n  to: %s\n%s', opt.from, opt.to, err)
end
