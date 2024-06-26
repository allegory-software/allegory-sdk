--[=[

	HTTP 1.1 coroutine-based async server (based on sock.lua, sock_libtls.lua).
	Written by Cosmin Apreutesei. Public Domain.

	Features, https, gzip compression, persistent connections, pipelining,
	resource limits, multi-level debugging, cdata-buffer-based I/O.

server:new(opt) -> server         Create a server object
	opt.listen                     {{host=, port=, tls=t|f, tls_options=},...}
	opt.tls_options             -> tls_config()
	opt.max_line_size           -> http.max_line_size
	opt.recv_buffer_size        -> http.recv_buffer_size
	opt.debug                   -> http.debug
	opt.respond(server, req)
		req                      <- http:read_request()
		req:respond(opt) -> out
			opt                   -> http:build_response()
			opt.want_out_function    have respond() return an out() function
		req:onfinish(f)             add code to run when request finishes
		req.thread                  the thread that handled the request

http_request([thread]) -> req     (current) thread's http request object
http_error(t | status,[content])  raise http error
http_redirect(url, [status=303])  raise http redirect error

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

local function req_onfinish(req, f)
	after(req, 'finish', f)
end

function http_server(...)

	local host = config('host', 'localhost')

	local listen = {}

	if config'http_addr' ~= false then
		local http_addr = config('http_addr', '*')
		add(listen, {
			host = host,
			addr = http_addr,
			port = config'http_port',
			unix_socket = config'http_unix_socket',
		})
	end

	if config'https_addr' ~= false then
		local https_addr = config('https_addr', '*')
		local crt_file = config'https_crt_file' or varpath(host..'.crt')
		local key_file = config'https_key_file' or varpath(host..'.key')
		if host == 'localhost'
			and not config'https_crt_file'
			and not config'https_key_file'
			and not exists(crt_file)
			and not exists(key_file)
		then
			crt_file = indir(exedir(), '..', '..', 'tests', 'localhost.crt')
			key_file = indir(exedir(), '..', '..', 'tests', 'localhost.key')
		end
		add(listen, {
			host = host,
			addr = https_addr,
			port = config'https_port',
			unix_socket = config'https_unix_socket',
			tls = true,
			tls_options = {
				cert_file = crt_file,
				key_file  = key_file,
			},
		})
	end

	local self = object(server, {
		listen = listen,
		compress = config'http_compress',
		debug = config'http_debug'
			and index(collect(words(config'http_debug' or ''))),
	}, ...)

	local next_request_id = 1

	local function handle_request(ctcp, http, req)

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

		req.request_id = next_request_id
		next_request_id = next_request_id + 1

		--`self.respond(req)` needs to call `req:respond(opt)` or it's a 404.
		local ok, err = pcall(self.respond, req)
		if req.finish then
			req:finish(ok, err)
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
				req:respond{status = 404}
			end
		end

		--the request must be entirely read before we can read the next request.
		if req.body_was_read == nil then
			req:read_body()
		end
		assert(req.body_was_read, 'request body was not read')

	end

	local function handle_connection(stcp, ctcp, http)
		while not ctcp:closed() do
			local req = assert(http:read_request())
			ownthreadenv().http_request = req
			handle_request(ctcp, http, req)
		end
	end

	local stop
	function self:stop()
		stop = true
	end

	self.sockets = {}

	assert(self.listen and #self.listen > 0, 'listen option is missing or empty')

	for i,listen_opt in ipairs(self.listen) do
		if listen_opt.addr == false then
			goto continue
		end

		local tcp = tcp(nil, listen_opt.unix_socket and 'unix')
		tcp:setopt('reuseaddr', true)
		local addr =
			listen_opt.unix_socket and 'unix:'..listen_opt.unix_socket
			or listen_opt.addr or '*'
		local port =
			listen_opt.unix_socket and 0
			or listen_opt.port or (listen_opt.tls and 443 or 80)

		if listen_opt.unix_socket and file_is(listen_opt.unix_socket, 'socket') then
			try_rmfile(listen_opt.unix_socket)
		end

		tcp:listen(addr, port)

		local tls = listen_opt.tls
		if tls then
			local opt = update(self.tls_options, listen_opt.tls_options)
			local stcp = server_stcp(tcp, opt)
			live(stcp, 'listen %s:%d', tcp.bound_addr, tcp.bound_port)
			tcp = stcp
		end
		push(self.sockets, tcp)

		local function accept_connection()
			local ctcp, err = tcp:accept()
			if not ctcp then
				if tcp:closed() then --stop() called.
					return
				else
					self:check(tcp, false, 'accept', '%s', err)
					--temporary network error. let it retry but pause a little
					--to avoid killing the CPU while the error persists.
					wait(.2)
					return
				end
			end
			resume(thread(function()
				local http = http({
					debug = self.debug,
					max_line_size = self.max_line_size,
					recv_buffer_size = self.recv_buffer_size,
					compress = self.compress,
					f = ctcp,
				})
				local ok, err = pcall(handle_connection, tcp, ctcp, http)
				http:free()
				self:check(ctcp, ok or iserror(err, 'io'), 'handler', '%s', err)
				ctcp:close()
			end, 'http-server-client %s', ctcp))
		end

		function self:close_all_sockets()
			self:log(tcp, 'note', 'htsrv', 'kill-all', '%s',
				cat(sort(imap(keys(tcp.sockets), logarg)), ' '))
			for s in pairs(tcp.sockets) do
				s:close()
			end
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

--responding by raising an error.

errortype'http_response'.__tostring = function(self)
	local s = self.traceback or self.message or ''
	if self.status then
		s = self.status .. ' ' .. s
	end
	return s
end

function http_request(thread)
	local tenv = threadenv(thread)
	return tenv and tenv.http_request
end

function http_error(status, content) --status,[content] | http_response
	local err
	if isnum(status) then
		err = {status = status, content = content}
	elseif istab(status) then
		err = status
	else
		assert(false)
	end
	raise(3, 'http_response', err)
end

--TODO: make it work with relative paths
function http_redirect(url, status)
	http_error{status = status or 303, headers = {location = url}}
end
