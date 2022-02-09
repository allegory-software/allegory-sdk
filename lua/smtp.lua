--[=[

	Async SMTP(s) client.
	Written by Cosmin Apreutesei. Public Domain.

	smtp:connect{host=, port=, tls=, user=, pass=} -> c
	c:sendmail{from=, to=, headers=, message=} -> c
	c:close() -> c

]=]

if not ... then require'smtp_test'; return end

local glue = require'glue'
local errors = require'errors'
local linebuffer = require'linebuffer'
local b64 = require'base64'.encode
local _ = string.format

local client = {
	libs = 'sock sock_libtls',
	type = 'smtp_client', debug_prefix = 'S',
	host = '127.0.0.1',
	port = 587,
	connect_timeout = 5,
	sendmail_timeout = 60,
	domain = 'localhost', --client's domain (useless)
	max_line_size = 8192,
	xmailer = 'allegory-sdk smtp client',
}

local check_io, checkp, check, protect = errors.tcp_protocol_errors'smtp'

function client:connect(t)

	local self = glue.object(self, {}, t)

	for lib in self.libs:gmatch'[^%s]+' do
		if lib == 'sock' then
			local sock = require'sock'
			self.create_tcp = sock.tcp
			self.clock      = sock.clock
			self.resolve = self.resolve
				or function(_, host)
					return sock.addr(host, 0):tostring()
				end
		elseif lib == 'sock_libtls' then
			local socktls = require'sock_libtls'
			self.create_stcp = socktls.client_stcp
			self.stcp_config = socktls.config
		else
			assert(false)
		end
	end

	self.host_addr = check(self, self:resolve(self.host))
	self.tcp = check(self, self.create_tcp())

	--logging & debugging

	if self.debug and self.debug.tracebacks then
		self.tracebacks = true --for tcp_protocol_errors.
	end

	self.logging = (self.logging == true or self.debug and self.logging == nil)
		and require'logging' or self.logging
	local log = self.logging and self.logging.log

	local function mprotect(method)
		local oncaught
		if log and self.debug and self.debug.errors then
			function oncaught(err)
				log('ERROR', 'smtp', method, '%s', err)
			end
		end
		self[method] = protect(self[method], oncaught)
	end

	if log and self.debug and self.debug.stream then
		self.tcp:debug('smtp', log)
	end

	local dp = glue.noop
	if log and self.debug and self.debug.protocol then
		function dp(...)
			return log('', 'smtp', ...)
		end
	end

	--I/O

	local expires
	local function set_timeout(dt)
		expires = dt and self.clock() + dt or nil
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
		dp('connect', '%s', self.tcp)
		if self.tls then
			self.tcp = check_io(self, self.create_stcp(self.tcp, self.host, self.tls_options))
		end
		check_reply'2..'
		send_line('EHLO %s', self.domain)
		check_reply'2..'
		if self.user then
			send_line('AUTH PLAIN %s', b64('\0' .. self.user .. '\0' .. self.pass))
			check_reply'2..'
		end
		return self
	end
	mprotect'_connect'

	function self:sendmail(req)
		if log then
			log('note', 'smtp', 'sendmail', '%s from=%s to=%s subj="%s" msg#=%s',
				self.tcp, req.from, req.to, req.headers and req.headers.subject,
				glue.kbytes(#req.message))
		end
		set_timeout(self.sendmail_timeout)
		send_line('MAIL FROM: %s', req.from)
		check_reply'2..'
		local to = type(req.to) == 'string' and {req.to} or req.to
		for i,to in ipairs(to) do
			 send_line('RCPT TO: %s', req.to)
			 check_reply'2..'
		end
		send_line'DATA'
		check_reply'3..'
		local ht = glue.update({}, req.headers)
		ht.date = os.date('!%a, %d %b %Y %H:%M:%S -0000')
		ht.x_mailer = self.xmailer
		ht.mime_version = '1.0'
		local t = {}
		for k,v in glue.sortedpairs(ht) do
			t[#t+1] = k:gsub('_', '-'):lower() .. ': ' .. tostring(v)
		end
		t[#t+1] = ''
		t[#t+1] = ''
		local headers = table.concat(t, '\r\n')
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
		dp('close', '%s', self.tcp)
		set_timeout(self.connect_timeout)
		send_line'QUIT'
		check_reply'2..'
		check_io(self, self.tcp:close(expires))
		return true
	end
	mprotect'close'

	return self:_connect()
end

return client