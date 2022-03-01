--[=[

	HTTP 1.1 coroutine-based async server (based on sock.lua, sock_libtls.lua).
	Written by Cosmin Apreutesei. Public Domain.

	Features, https, gzip compression, persistent connections, pipelining,
	resource limits, multi-level debugging, cdata-buffer-based I/O.

server:new(opt) -> server   | Create a server object

	libs            required: pass 'sock sock_libtls zlib'
	listen          {host=, port=, tls=t|f, tls_options=}
	tls_options     options to pass to sock_libtls.

]=]

if not ... then require'http_server_test'; return end

local http = require'http'
local time = require'time'
local glue = require'glue'
local errors = require'errors'

local _ = string.format
local attr = glue.attr
local push = table.insert

local server = {
	type = 'http_server', http = http,
	tls_options = {
		loadfile = glue.readfile, --stub
		protocols = 'tlsv1.2',
		ciphers = [[
			ECDHE-ECDSA-AES256-GCM-SHA384
			ECDHE-RSA-AES256-GCM-SHA384
			ECDHE-ECDSA-CHACHA20-POLY1305
			ECDHE-RSA-CHACHA20-POLY1305
			ECDHE-ECDSA-AES128-GCM-SHA256
			ECDHE-RSA-AES128-GCM-SHA256
			ECDHE-ECDSA-AES256-SHA384
			ECDHE-RSA-AES256-SHA384
			ECDHE-ECDSA-AES128-SHA256
			ECDHE-RSA-AES128-SHA256
		]],
		prefer_ciphers_server = true,
	},
}

function server:bind_libs(libs)
	for lib in libs:gmatch'[^%s]+' do
		if lib == 'sock' then
			local sock = require'sock'
			self.tcp           = sock.tcp
			self.cowrap        = sock.cowrap
			self.newthread     = sock.newthread
			self.resume        = sock.resume
			self.thread        = sock.thread
			self.start         = sock.start
			self.sleep         = sock.sleep
			self.currentthread = sock.currentthread
		elseif lib == 'sock_libtls' then
			local socktls = require'sock_libtls'
			self.stcp          = socktls.server_stcp
		elseif lib == 'zlib' then
			self.http.zlib = require'zlib'
		elseif lib == 'fs' then
			self.loadfile = require'fs'.load
			self.tls_options.loadfile = self.loadfile
		else
			assert(false)
		end
	end
end

function server:time(ts)
	return glue.time(ts)
end

server.request_finish = glue.noop --request finalizer stub

function server:log(tcp, severity, module, event, fmt, ...)
	local logging = self.logging
	if not logging or logging.filter[severity] then return end
	local s = type(fmt) == 'string' and _(fmt, logging.args(...)) or fmt or ''
	logging.log(severity, module, event, '%-4s %s', tcp, s)
end

function server:check(tcp, ret, ...)
	if ret then return ret end
	self:log(tcp, 'ERROR', 'htsrv', ...)
end

function server:new(t)

	local self = glue.object(self, {}, t)

	if self.libs then
		self:bind_libs(self.libs)
	end

	if self.debug and (self.logging == nil or self.logging == true) then
		self.logging = require'logging'
	end

	local function handler(stcp, ctcp, listen_opt)

		local http = self.http:new({
			debug = self.debug,
			max_line_size = self.max_line_size,
			tcp = ctcp,
			cowrap = self.cowrap,
			currentthread = self.currentthread,
			listen_options = listen_opt,
		})

		while not ctcp:closed() do

			local req = assert(http:read_request())

			local finished, out, sending_response
			local res_ok, res_err

			local function send_response(opt)
				if opt.content == nil then
					opt.content = ''
				end
				sending_response = true
				local res = http:build_response(req, opt, self:time())
				res_ok, res_err = http:send_response(res)
				finished = true
			end

			function req.respond(req, opt)
				if opt.want_out_function then
					local protected_out = self.cowrap(function(yield)
						opt.content = yield
						send_response(opt)
					end)
					function out(s, len)
						protected_out(s, len)
						if finished then
							assert(res_ok, res_err)
						end
					end
					out()
					return out
				else
					send_response(opt)
					assert(res_ok, res_err)
				end
			end

			function req.raise(req, status, content)
				local err
				if type(status) == 'number' then
					err = {status = status, content = content}
				elseif type(status) == 'table' then
					err = status
				else
					assert(false)
				end
				errors.raise('http_response', err)
			end

			req.thread = self.currentthread()

			local ok, err = errors.pcall(self.respond, req)
			self:request_finish(req)

			if not ok then
				if errors.is(err, 'http_response') then
					assert(not sending_response, 'response already sent')
					req:respond(err)
				elseif not sending_response then
					self:check(tcp, false, 'respond', '%s', err)
					req:respond{status = 500}
				else
					error(err)
				end
			elseif not finished then --eof not signaled.
				if out then
					out() --eof
				else
					send_response{}
					assert(res_ok, res_err)
				end
			end

			--the request must be entirely read before we can read the next request.
			if req.body_was_read == nil then
				req:read_body()
			end
			assert(req.body_was_read, 'request body was not read')

		end
	end

	local stop
	function self:stop()
		stop = true
	end

	self.sockets = {}

	assert(self.listen and #self.listen > 0, 'listen option is missing or empty')

	for i,t in ipairs(self.listen) do
		if t.addr == false then
			goto continue
		end

		local tcp = assert(self.tcp())
		assert(tcp:setopt('reuseaddr', true))
		local addr, port = t.addr or '*', t.port or (t.tls and 443 or 80)

		local ok, err = tcp:listen(addr, port)
		if not ok then
			self:check(tcp, false, 'listen', '("%s", %s): %s', addr, port, err)
			goto continue
		end
		self:log(tcp, 'note', 'htsrv', 'LISTEN', '%s:%d', addr, port)

		if t.tls then
			local opt = glue.update(self.tls_options, t.tls_options)
			local stcp, err = self.stcp(tcp, opt)
			if not self:check(tcp, stcp, 'stcp', '%s', err) then
				tcp:close()
				goto continue
			end
			tcp = stcp
		end
		push(self.sockets, tcp)

		function accept_connection()
			local ctcp, err = tcp:accept()
			if not self:check(tcp, ctcp, 'accept',' %s', err) then
				return
			end
			self.thread(function()
				self:log(tcp, 'note', 'htsrv', 'accept', '%s', ctcp)
				local ok, err = errors.pcall(handler, tcp, ctcp, t)
				self:check(ctcp, ok or errors.is(err, 'tcp'), 'handler', '%s', err)
				self:log(tcp, 'note', 'htsrv', 'closed', '%s', ctcp)
				ctcp:close()
			end)
		end

		self.thread(function()
			while not stop do
				accept_connection()
			end
		end)

		::continue::
	end

	return self
end

return server
