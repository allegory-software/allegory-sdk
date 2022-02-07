--[=[

	Async SMTP(s) client.
	Written by Cosmin Apreutesei. Public Domain.

API
	...

]=]

if not ... then require'smtp_test'; return end

local ffi = require'ffi'
local clock = require'time'.clock
local glue = require'glue'
local errors = require'errors'
local linebuffer = require'linebuffer'
local b64 = require'base64'.encode
local _ = string.format

local client = {
	type = 'smtp_client', debug_prefix = 'S',
	host = '127.0.0.1',
	port = 25,
	connect_timeout = 5,
	domain = 'localhost', --client's domain
}

function client:bind_libs(libs)
	for lib in libs:gmatch'[^%s]+' do
		if lib == 'sock' then
			local sock = require'sock'
			self.create_tcp    = sock.tcp
			self.cowrap        = sock.cowrap
			self.newthread     = sock.newthread
			self.suspend       = sock.suspend
			self.resume        = sock.resume
			self.thread        = sock.thread
			self.start         = sock.start
			self.sleep         = sock.sleep
			self.currentthread = sock.currentthread
		elseif lib == 'sock_libtls' then
			local socktls = require'sock_libtls'
			self.stcp          = socktls.client_stcp
			self.stcp_config   = socktls.config
		else
			assert(false)
		end
	end
end

--error handling -------------------------------------------------------------

local check_io, checkp, check, protect = errors.tcp_protocol_errors'smtp'

client.check_io = check_io
client.checkp = checkp
client.check = check

function client:protect(method)
	local function oncaught(err)
		if self.debug and self.debug.errors then
			self:log('ERROR', 'smtp', method, '%s', err)
			self.logged = true
		end
	end
	self[method] = protect(self[method], oncaught)
end

--low-level I/O API ----------------------------------------------------------

function client:send(buf, sz)
	self:check_io(self.tcp:send(buf, sz, self.send_expires))
end

function client:send_line(fmt, s)
	self:send(_(fmt, s) .. '\r\n')
end

function client:close(expires)
	self:check_io(self.tcp:close(expires))
end

--linebuffer-based read API --------------------------------------------------

function client:read_exactly(n, write)
	local read = self.linebuffer.read
	local n0 = n
	while n > 0 do
		local buf, sz = read(n)
		self:check_io(buf, sz)
		write(buf, sz)
		n = n - sz
	end
end

function client:read_line()
	return self:check_io(self.linebuffer.readline())
end

function client:read_until_closed(write_content)
	local read = self.linebuffer.read
	while true do
		local buf, sz = read(1/0)
		if not buf then
			self:check_io(nil, sz)
		elseif sz == 0 then
			break
		end
		write_content(buf, sz)
	end
end

client.max_line_size = 8192

function client:create_linebuffer()
	local function read(buf, sz)
		return self.tcp:recv(buf, sz, self.read_expires)
	end
	self.linebuffer = linebuffer(read, '\r\n', self.max_line_size)
end

--instantiation --------------------------------------------------------------

function client:log(severity, module, event, fmt, ...)
	local logging = self.logging
	if not logging or logging.filter[severity] then return end
	local S = self.tcp or '-'
	local s = fmt and _(fmt, logging.args(...)) or ''
	logging.log(severity, module, event, '%-4s %s', S, s)
end

function client:new(t)

	local self = glue.object(self, {}, t)

	self:bind_libs(self.libs)

	if self.debug and self.debug.tracebacks then
		self.tracebacks = true --for tcp_protocol_errors.
	end

	if self.debug and (self.logging == nil or self.logging == true) then
		self.logging = require'logging'
	end

	if self.debug and self.debug.protocol then

		function self:dp(...)
			return self:log('', 'smtp', ...)
		end

	else
		self.dp = glue.noop
	end

	self:create_linebuffer()
	return self
end

function client:check_reply(match)
	while true do
		local s = self:check_io(self:read_line())
		local code, sep = s:match'^(%d%d%d)(.?)'
		self:checkp(tonumber(code), 'invalid response line: %s', s)
		if sep == ' ' then
			self:checkp(code:match(match),
				'unexpected response %s (expected it to match "%s")', s, match)
			break
		end
	end
end

function client:send_mail(req)
	self:check_reply'2..'
	self:send_line('EHLO %s', self.domain)
	self:check_reply'2..'
	--[[
		--TODO:
		self.try(self.tp:command("AUTH", "LOGIN"))
		self.try(self.tp:check("3.."))
		self.try(self.tp:send(mime.b64(user) .. "\r\n"))
		self.try(self.tp:check("3.."))
		self.try(self.tp:send(mime.b64(password) .. "\r\n"))
		return self.try(self.tp:check("2.."))
	]]
	self:send_line('AUTH PLAIN %s', b64('\0' .. self.user .. '\0' .. self.pass))
	self:check_reply'2..'
	self:send_line('MAIL FROM: %s', req.from)
	self:check_reply'2..'
	local to = type(req.to) == 'string' and {req.to} or req.to
	for i,to in ipairs(to) do
		 self:send_line('RCPT TO: %s', req.to)
		 self:check_reply'2..'
	end
	self:send_line'DATA'
	self:check_reply'3..'
	local ht = glue.update({}, req.headers)
	ht.date = os.date('!%a, %d %b %Y %H:%M:%S -0000')
	ht['x-mailer'] = 'allegory-sdk smtp client'
	ht['mime-version'] = '1.0'
	local t = {}
	for k,v in glue.sortedpairs(ht) do
		t[#t+1] = k:lower() .. ': ' .. tostring(v)
	end
	t[#t+1] = ''
	t[#t+1] = ''
	local headers = table.concat(t, '\r\n')
	self:send(headers)
	self:send(req.message)
	self:send'\r\n.\r\n'
	self:check_reply'2..'
end

function client:resolve(host) --stub (use a resolver)
	return host
end

function client:connect()
	self.tcp = self:check(self.create_tcp())

	if self.debug and self.debug.stream then

		local function ds(event, s)
			self:log('', 'smtp', event, '%5s %s', s and #s or '', s or '')
		end

		glue.override(self.tcp, 'recv', function(inherited, self, buf, ...)
			local sz, err = inherited(self, buf, ...)
			if not sz then return nil, err end
			ds('<', ffi.string(buf, sz))
			return sz
		end)

		glue.override(self.tcp, 'send', function(inherited, self, buf, sz, ...)
			local ok, err = inherited(self, buf, sz, ...)
			if not ok then return nil, err end
			ds('>', ffi.string(buf, sz or #buf))
			return ok
		end)

		glue.override(self.tcp, 'close', function(inherited, self, ...)
			local ok, err = inherited(self, ...)
			if not ok then return nil, err  end
			ds('CC')
			return ok
		end)

	end

	local dt = self.connect_timeout
	local expires = dt and clock() + dt or nil
	self:check_io(self.tcp:connect(self:resolve(self.host), self.port, expires))
	self:dp('connect', '%s', err or '')
end

function client:quit()
	self:send_line'QUIT'
	self:check_reply'2..'
	self.tcp:close()
end

function client:sendmail(req)
	self:connect()
	self:send_mail(req)
	self:quit()
	return true
end
client:protect'sendmail'


return client
