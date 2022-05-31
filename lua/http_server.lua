--[=[

	HTTP 1.1 coroutine-based async server (based on sock.lua, sock_libtls.lua).
	Written by Cosmin Apreutesei. Public Domain.

	Features, https, gzip compression, persistent connections, pipelining,
	resource limits, multi-level debugging, cdata-buffer-based I/O.

server:new(opt) -> server   | Create a server object

	listen          {host=, port=, tls=t|f, tls_options=}
	tls_options     options to pass to sock_libtls.

]=]

if not ... then require'http_server_test'; return end

require'glue'
require'sock'
require'sock_libtls'
require'gzip'
require'fs'
require'http'

local server = {
	type = 'http_server', http = http,
	tls_options = {
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

function server:log(tcp, severity, module, event, fmt, ...)
	if not logging or logging.filter[severity] then return end
	local s = isstr(fmt) and _(fmt, logargs(...)) or fmt or ''
	log(severity, module, event, '%-4s %s', tcp, s)
end

function server:check(tcp, ret, ...)
	if ret then return ret end
	self:log(tcp, 'ERROR', 'htsrv', ...)
end

function http_server(t)

	local self = object(server, {}, t)

	local function req_onfinish(req, f)
		after(req, 'finish', f)
	end

	local function handler(stcp, ctcp, listen_opt)

		local http = http({
			debug = self.debug,
			max_line_size = self.max_line_size,
			tcp = ctcp,
			listen_options = listen_opt,
		})

		while not ctcp:closed() do

			local req = assert(http:read_request())

			local out, out_thread, send_started, send_finished

			local function send_response(opt)
				send_started = true
				local res = http:build_response(req, opt, time())
				assert(http:send_response(res))
				send_finished = true
			end

			--NOTE: both req:respond() and out() raise on I/O errors breaking
			--user's code, so use req:onfinish() to free resources.
			function req.respond(req, opt)
				if opt.want_out_function then
					out, out_thread = cowrap(function(yield)
						opt.content = yield
						send_response(opt)
					end, 'http-server-out %s %s', ctcp, req.uri)
					out()
					return out
				else
					send_response(opt)
				end
			end

			req.thread = currentthread()

			req.onfinish = req_onfinish

			local ok, err = pcall(self.respond, req)
			if req.finish then
				req:finish()
			end

			if not ok then
				if not send_started then
					if iserror(err, 'http_response') then
						req:respond(err)
					else
						self:check(ctcp, false, 'respond', '%s', err)
						req:respond{status = 500}
					end
				else --status line already sent, too late to send HTTP 500.
					if out_thread and threadstatus(out_thread) ~= 'dead' then
						--Signal eof so that the out() thread finishes. We could
						--abandon the thread and it will be collected without leaks
						--but we want it to be removed from logging.live immediately.
						--NOTE: we're checking that out_thread is really suspended
						--because we also get here on I/O errors which kill it.
						out()
					end
					error(err)
				end
			elseif not send_finished then
				if out then --out() thread waiting for eof
					out() --signal eof
				else --respond() not called
					send_response{}
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

		local tcp = assert(tcp())
		assert(tcp:setopt('reuseaddr', true))
		local addr, port = t.addr or '*', t.port or (t.tls and 443 or 80)

		local ok, err = tcp:listen(addr, port)
		if not ok then
			self:check(tcp, false, 'listen', '("%s", %s): %s', addr, port, err)
			goto continue
		end

		local tls = t.tls
		if tls then
			local opt = update(self.tls_options, t.tls_options)
			local stcp, err = server_stcp(tcp, opt)
			if not self:check(tcp, stcp, 'stcp', '%s', err) then
				tcp:close()
				goto continue
			end
			live(stcp, 'listen %s:%d', tcp.bound_addr, tcp.bound_port)
			tcp = stcp
		end
		liveadd(tcp, tls and 'https' or 'http')
		push(self.sockets, tcp)

		function accept_connection()
			local ctcp, err, retry = tcp:accept()
			if not self:check(tcp, ctcp, 'accept', '%s', err) then
				if retry then
					--temporary network error. let it retry but pause a little
					--to avoid killing the CPU while the error persists.
					wait(.2)
				else
					self:stop()
				end
				return
			end
			liveadd(ctcp, tls and 'https' or 'http')
			resume(thread(function()
				local ok, err = pcall(handler, tcp, ctcp, t)
				self:check(ctcp, ok or iserror(err, 'tcp'), 'handler', '%s', err)
				ctcp:close()
			end, 'http-server-client %s', ctcp))
		end

		resume(thread(function()
			while not stop do
				accept_connection()
			end
		end, 'http-listen %s', tcp))

		::continue::
	end

	return self
end
