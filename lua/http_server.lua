--[=[

	HTTP 1.1 server (TLS 1.2, gzip, chunked, full-duplex, pipelined)
	Written by Cosmin Apreutesei. Public Domain.

SERVER
	http_server(opt1,...) -> server   Create a http server (opt tables are merged)
	- listen                       {{addr=,...}, {addr=,...}}
	- - host                       Host header match
	- - addr                       IP address to listen to
	- - port                       TCP port to listen to
	- - tls                        use TLS on this socket
	- - tls_options                TLS options, see sock_bearssl.lua
	- - unix_socket                unix socket file to listen to
	- - unix_socket_perms          set perms on socket file after bind()
	- - unix_socket_user           set user  on socket file after bind()
	- - unix_socket_group          set group on socket file after bind()
	- compress                     gzip-compress responses (true)
	- max_body_size                body size limit
	- respond <- fn(req)           request handler
	- debug <- flags               debug flags: 'protocol tracebacks stream'
REQUEST
	req.headers -> {k=v}           request headers (in lowercase)
	req.body_size -> n             request upload size in bytes
	req:read_body() -> buf,size    read whole body in a buffer
	req:read_body_chunk() -> buf,size,size_left  read body in chunks
	req:onfinish(fn)               run fn when request finishes, even if it raises
	req.thread                     the thread that handled the request
RESPONSE
	req.status <- n                set response status (default: 200)
	req.status_message <- s        set response status message (inconsequential)
	req.response_headers <- {k=v}  set response headers (in lowercase!)
		content-length <- n         set body size otherwise it's chunked transfer
		content-type <- mime        set content-type
	req.compress <- true|false     gzip-compress response (also see compressed_mime_types)
	req.max_body_size <- n         body size limit
	req:send_headers() -> req      send status line and headers
	req:send_body_chunk(s | buf,len | nil,'eof') -> req    send body chunk
	req:finish() -> req            finish response
CONFIG
	host                           'localhost'
	http_addr                      '0.0.0.0'
	http_port                      80
	http_unix_socket
	http_unix_socket_perms
	http_unix_socket_user
	http_unix_socket_group
	https_addr                     '0.0.0.0' (set to false to disable)
	https_port                     443
	https_crt_file                 var/HOST.crt or ../tests/localhost.crt
	https_key_file                 var/HOST.key or ../tests/localhost.key
	http_server_compress           set to false to disable
	http_server_debug              nil (set to true to enable)

]=]

if not ... then require'http_server_test'; return end

require'glue'
require'pbuffer'
require'gzip'
require'sock'
require'sock_bearssl'
require'http_date'

--http server ----------------------------------------------------------------

local server = {
	compress = true,
	max_body_size = 64*1024^2,
}

server.compressed_mime_types = index{
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/x-icon',
	'font/woff',
	'font/woff2',
	'application/pdf',
	'application/zip',
	'application/x-gzip',
	'application/x-xz',
	'application/x-bz2',
	'audio/mpeg',
	'text/event-stream',
}

local function logerror(tcp, action, ...)
	if logging.filter.ERROR then return end
	log('ERROR', 'htsrv', action, '%-4s %s', tcp, _(...))
end

local function req_dp(req, event, fmt, ...)
	if logging.filter[''] then return end
	local dt = clock() - req.start_clock
	local s = fmt and _(fmt, logargs(...)) or ''
	log('', 'htsrv', event, '%-4s %4dms %s', req.tcp, dt * 1000, s)
end

--responding by raising an error.
errortype'http_response'.__tostring = function(self)
	local s = self.traceback or self.message or ''
	if self.status then
		s = self.status .. ' ' .. s
	end
	return s
end

local req = {
	type = 'http_request', debug_prefix = 'R',
}

function http_server(...)

	local self = object(server, {
		compress = config'http_server_compress',
	}, ...)

	if not self.listen then
		self.listen = {}
		local host = config('host', 'localhost')
		if config'http_addr' ~= false then
			add(self.listen, {
				host = host,
				addr = config('http_addr', '0.0.0.0'),
				port = config'http_port',
				unix_socket = config'http_unix_socket',
				unix_socket_perms = config'http_unix_socket_perms',
				unix_socket_user  = config'http_unix_socket_user',
				unix_socket_group = config'http_unix_socket_group',
			})
		end
		if config'https_addr' ~= false then
			local crt_file = config'https_crt_file' or varpath(host..'.crt')
			local key_file = config'https_key_file' or varpath(host..'.key')
			if host == 'localhost'
				and not config'https_crt_file'
				and not config'https_key_file'
				and not exists(crt_file)
				and not exists(key_file)
			then --use bundled-in self-signed certs for localhost
				crt_file = exedir()..'/../tests/localhost.crt'
				key_file = exedir()..'/../tests/localhost.key'
			end
			add(self.listen, {
				host = host,
				addr = config('https_addr', '0.0.0.0'),
				port = config'https_port',
				tls = true,
				tls_options = {
					cert_file = crt_file,
					key_file  = key_file,
				},
			})
		end
	end
	assert(self.listen and #self.listen > 0, 'listen option is missing or empty')

	self.debug = self.debug or config'http_server_debug' or ''
	if isstr(self.debug) then
		self.debug = index(collect(words(self.debug)))
	end

	local next_request_id = 1

	local function handle_request(ctcp)
		local rb = ctcp.rb
		local wb = ctcp.wb

		--read/parse next request line, if any
		local line = rb:haveline()
		if not line then ctcp:close(); return end
		local method, uri, http_version = line:match'^([%u]+)%s+([^%s]+)%s+HTTP/(%d+%.%d+)'
		ctcp:checkp(http_version == '1.1', 'invalid http version')

		local req = object(req, {
			tcp = ctcp,
			server = self,
			method = method,
			uri = uri,
			headers = {},
			start_clock = clock(),
			thread = currentthread(),
			request_id = next_request_id,
			status = 200,
			response_headers = {}, --put them in lowercase!
			compress = self.compress,
			max_body_size = self.max_body_size,
			dp = self.debug.protocol and req_dp or noop,
		})

		req:dp('<=', '%s %s HTTP/%s', method, uri, http_version)

		ownthreadenv().http_request = req
		next_request_id = next_request_id + 1

		--read request headers
		for i = 1, 101 do
			local line = rb:needline()
			if line == '' then break end --headers end with a blank line
			ctcp:checkp(i <= 100, 'too many headers')
			local name, value = line:match'^([^:]+):%s*(.*)'
			ctcp:checkp(name, 'invalid header')
			name = name:lower() --header names are case-insensitive
			value = value:trim()
			req:dp('<-', '%-17s %s', name, value)
			local prev_value = req.headers[name]
			if prev_value then --duplicate header: append value.
				req.headers[name] = prev_value .. ',' .. value
			else
				req.headers[name] = value
			end
		end

		--prevent browsers from waiting for 1s on large uploads.
		local expect = req.headers['expect']
		if expect and expect:has'100' then
			wb:put'HTTP/1.1 100 Continue\r\n\r\n'
			wb:flush()
		end

		--parse relevant request headers into req fields.
		req.body_size = tonumber(req.headers['content-length']) or 0
		local cc = req.headers['connection']
		req.close = cc and cc:has'close'

		--make req methods for reading the request body and for responding.

		local finish
		function req.onfinish(req, fn)
			finish = do_after(finish, fn)
		end

		local rb_needs_reset
		local body_unread_len = req.body_size
		function req.read_body_chunk(req)
			if body_unread_len == 0 then
				return nil, 'eof', 0
			end
			if rb_needs_reset then
				rb:reset()
				rb_needs_reset = false
			end
			rb:need(1) --can read into the next request if pipelined
			local buf, len = rb:ref()
			len = min(len, body_unread_len)
			body_unread_len = body_unread_len - len
			rb_needs_reset = true
			return buf, len, body_unread_len
		end

		function req.read_body(req, max_body_size)
			max_body_size = max_body_size or req.max_body_size
			ctcp:checkp(body_unread_len <= max_body_size, 'body too long')
			rb:need(body_unread_len) --can read into the next request if pipelined
			local buf = rb:ref()
			local len = body_unread_len
			body_unread_len = 0
			return buf, len
		end

		local send_body_chunk
		local headers_sent

		function req.send_headers(req)
			assert(not headers_sent)
			headers_sent = true

			req.response_headers['date'] = http_date_format(time())
			if req.close then
				req.response_headers['connection'] = 'close'
			end
			if not req.response_headers['content-length'] then
				req.response_headers['transfer-encoding'] = 'chunked'
			end
			local mime_type = req.response_headers['content-type']
			local accept_enc = req.headers['accept-encoding']
			req.compress = req.compress and accept_enc and accept_enc:has'gzip'
				and not (mime_type and self.compressed_mime_types[mime_type])
			if req.compress then
				req.response_headers['transfer-encoding'] = 'chunked'
				req.response_headers['content-encoding'] = 'gzip'
				req.response_headers['vary'] = 'accept-encoding'
				req.response_headers['content-length'] = nil --must be the compressed size
			end

			--send status line
			assert(req.status >= 100 and req.status <= 999, 'invalid status code')
			req:dp('=>', '%s', req.status)
			wb:putf('HTTP/1.1 %d%s%s\r\n', req.status,
				req.status_message and ' ' or '', req.status_message or '')

			--send response headers.
			--header names are case-insensitive and can't contain newlines.
			--passing a table as value will generate duplicate headers for each value
			--set-cookie will be like that because it's not safe to send it folded.
			local t = {}
			for k,v in sortedpairs(req.response_headers) do
				if not istab(v) then t[1] = v; v = t end
				for _,v in ipairs(v) do
					ctcp:checknp(not (k:has'\n' or k:has'\r' or k:has':' or k:starts' '),
						'invalid header name: %s', k)
					ctcp:checknp(not v:has'\n' and not v:has'\r',
						'invalid header value for: %s', k)
					req:dp('->', '%-17s %s', k, v)
					wb:putf('%s: %s\r\n', k, v)
				end
			end
			wb:putf'\r\n'
			wb:flush()

			if req.compress then
				if not ctcp.gz then
					ctcp.gz = gzip_state{op = 'compress', write = send_body_chunk}
				else
					ctcp.gz:reset()
					ctcp.gz.write = send_body_chunk
				end
			end

			return req
		end --req:send_headers()

		local body_sent
		function send_body_chunk(chunk, len)
			assert(headers_sent)
			assert(not body_sent)
			if not (chunk == nil and len == 'eof') then
				len = len or #chunk
				if len == 0 then return end --can't send empty chunks chunked
				req:dp('>>', '%7d bytes', len)
				if req.response_headers['content-length'] then
					wb:putdata(chunk, len)
					wb:flush()
				else --chunked
					wb:putf('%X\r\n', len)
					wb:putdata(chunk, len)
					wb:put'\r\n'
					wb:flush()
				end
			else
				body_sent = true
				req:dp('>>', '%7d end', 0)
				if not req.response_headers['content-length'] then
					wb:put'0\r\n\r\n'
					wb:flush()
				end
			end
		end

		function req.send_body_chunk(req, chunk, len)
			if req.compress then
				ctcp.gz:push(chunk, len)
			else
				send_body_chunk(chunk, len)
			end
			return req
		end

		function req.finish(req)
			req:send_body_chunk(nil, 'eof')
			return req
		end

		--self.respond(req) needs to call req:respond(opt) or it's a 404.
		local ok, err = pcall(self.respond, req)

		if finish then
			finish(req, ok, err)
		end

		if not ok then
			if not headers_sent then
				if iserror(err, 'http_response') then
					req.status = err.status
					req:send_headers():send_body_chunk(tostring(err)):finish()
				else
					logerror(ctcp, 'respond', '%s', err)
					req.status = 500
					req:send_headers():finish()
				end
			else --status line already sent, too late to send HTTP 500.
				error(err)
			end
		elseif not headers_sent then
			req.status = 404
			req:send_headers():finish()
		end

		--the request must be entirely read before we can read the next request
		--or before we can close the connection.
		while req:read_body_chunk() do end
		rb:reset()

		if req.close then
			req:dp('>>', 'close')
			ctcp:close() --send FIN
		end

	end --handle_request()

	local function handle_connection(ctcp)
		repeat
			handle_request(ctcp)
		until ctcp:closed()
	end

	self.sockets = {}

	for _,listen_opt in ipairs(self.listen) do

		local addr =
			listen_opt.unix_socket and 'unix:'..listen_opt.unix_socket
			or listen_opt.addr or '0.0.0.0'

		local tcp = listen(addr, listen_opt.port or (listen_opt.tls and 443 or 80))

		if listen_opt.unix_socket then
			if listen_opt.unix_socket_perms or
				listen_opt.unix_socket_user  or
				listen_opt.unix_socket_group
			then
				file_attr(listen_opt.unix_socket, {
					perms = listen_opt.unix_socket_perms,
					uid   = listen_opt.unix_socket_user,
					gid   = listen_opt.unix_socket_group,
				})
			end
		end

		local tls = listen_opt.tls
		if tls then
			local opt = update({}, self.tls_options, listen_opt.tls_options)
			local stcp = server_stcp(tcp, opt)
			liveadd(stcp, 'listen=%s', tcp:bound_addr())
			tcp = stcp
		end

		if self.debug.tracebacks then
			tcp.tracebacks = true --for check_io()
		end
		if self.debug.stream then
			tcp:debug_stream'http'
		end

		push(self.sockets, tcp)

		local function accept_connection()
			local ctcp, err, retry = tcp:try_accept()
			if not ctcp then
				if err == 'closed' then return end --stop() called
				logerror(tcp, 'accept', '%s', err)
				if retry then
					--temporary network error. let it retry but pause a little
					--to avoid killing the CPU while the error persists.
					wait(.2)
				else
					self:stop()
				end
				return
			end
			if self.debug.tracebacks then
				ctcp.tracebacks = true --for check_io()
			end
			if self.debug.stream then
				ctcp:debug_stream'http'
			end
			local recv_buffer_size = ctcp:getopt'so_rcvbuf' --usually 128k
			resume(thread(function()
				ctcp.rb = pbuffer{
					f = ctcp,
					readahead = recv_buffer_size,
					lineterm = '\r\n',
					linesize = 8192,
				} --read buffer
				ctcp.wb = pbuffer{
					f = ctcp,
				} --write buffer
				local ok, err = pcall(handle_connection, ctcp)
				if ctcp.gz then
					ctcp.gz:free()
				end
				ctcp:try_close()
				ctcp.rb:free()
				ctcp.wb:free()
				if not ok and not iserror(err, 'io') then
					logerror(ctcp, 'handler', '%s', err)
				end
			end, 'http-accept %s', ctcp))
		end

		resume(thread(function()
			while not tcp:closed() do
				accept_connection()
			end
		end, 'http-listen %s', tcp))

	end --for in listen

	return self
end

function server:stop()
	log('note', 'htsrv', 'kill-all', '%s',
		cat(sort(imap(self.sockets, logarg)), ' '))
	for _,s in ipairs(self.sockets) do
		s:close()
	end
end
