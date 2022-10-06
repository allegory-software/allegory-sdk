--[=[

	HTTP 1.1 client & server protocol
	Written by Cosmin Apreutesei. Public Domain.

	This module only implements the protocol. For a working HTTP client
	see http_client.lua, for a server see http_server.lua.

	All functions return nil,err on I/O errors.

http(opt) -> http

	Create a HTTP protocol object that should be used on a single freshly open
	HTTP or HTTPS connection to either perform HTTP requests on it (as client)
	or to read-in HTTP requests and send-out responses (as server).

		tcp               the I/O API (required)
		port              if client: server's port (optional)
		https             if client: `true` if using TLS (optional)

Client-side API --------------------------------------------------------------

http:build_request(opt) -> creq              | Make a HTTP request object.

	host                    vhost name
	close                   close the connection after replying
	content, content_size   body: string, read function or buffer
	compress                false: don't compress body

http:send_request(creq) -> true | nil,err    | Send a request.
http:read_response(creq) -> cres | nil,err   | Receive server's response.

Server-side API --------------------------------------------------------------

http:read_request() -> sreq                  | Receive a client's request.

	sreq:read_body'string' -> s               | Read request body to a string.
	sreq:read_body'buffer' -> buf, sz         | Read request body to a buffer.
	sreq:read_body'reader' -> read            | Read request body pull-style.
	sreq:read_body(write) -> true             | Read request body push-style.

	NOTE: read()->buf,sz returns nil on eof.
	NOTE: write() is called one last time without args on eof.

http:build_response(sreq, opt) -> sres       | Make a HTTP response object.

	close                   close the connection (and tell client to)
	content, content_size   body: string, read function or cdata buffer
	compress                false: don't compress body
	allowed_methods         allowed methods: {method->true} (optional)
	content_type            content type (optional)

http:send_response(sres) -> true | nil,err   | Send a response.

]=]

if not ... then require'http_server_test'; return end

require'glue'
require'pbuffer'
require'gzip'
require'sock'
local http_headers = require'http_headers'

local http = {type = 'http_connection', debug_prefix = 'H'}

function http:log(severity, module, event, fmt, ...)
	if not logging or logging.filter[severity] then return end
	local S = self.f or '-'
	local dt = clock() - self.start_time
	local s = fmt and _(fmt, logargs(...)) or ''
	log(severity, module, event, '%-4s %4dms %s', S, dt * 1000, s)
end

function http:dp(...)
	return self:log('', 'http', ...)
end

function http:protect(method)
	local function oncaught(err)
		if self.debug and self.debug.errors then
			self:log('ERROR', 'http', method, '%s', err)
		end
	end
	self[method] = protect_io(self[method], oncaught)
end

--request line & status line -------------------------------------------------

--only useful (i.e. that browsers act on) status codes are listed here.
http.status_messages = {
	[200] = 'OK',
	[500] = 'Internal Server Error', --crash handler.
	[406] = 'Not Acceptable',        --basically 400, based on `accept-encoding`.
	[405] = 'Method Not Allowed',    --basically 400, based on `allowed_methods`.
	[404] = 'Not Found',             --not found and not ok to redirect to home page.
	[403] = 'Forbidden',             --needs login and not ok to redirect to login page.
	[400] = 'Bad Request',           --client bug (misuse of protocol or API).
	[401] = 'Unauthorized',          --only for Authorization / WWW-Authenticate.
	[301] = 'Moved Permanently',     --link changed (link rot protection / upgrade path).
	[303] = 'See Other',             --redirect away from a POST.
	[307] = 'Temporary Redirect',    --retry request with same method this time.
	[308] = 'Permanent Redirect',    --retry request with same method from now on.
	[429] = 'Too Many Requests',     --for throttling.
	[304] = 'Not Modified',          --use for If-None-Match or If-Modified-Since.
	[412] = 'Precondition Failed',   --use for If-Unmodified-Since or If-None-Match.
	[503] = 'Service Unavailable',   --use when server is down and avoid google indexing.
	[416] = 'Range Not Satisfiable', --for dynamic downloadable content.
	[451] = 'Unavailable For Legal Reasons', --to punish EU users for GDPR.
}

function http:send_request_line(method, uri, http_version)
	assert(http_version == '1.1' or http_version == '1.0')
	assert(method and method == method:upper())
	assert(uri)
	self:dp('=>', '%s %s HTTP/%s', method, uri, http_version)
	self.f:send(_('%s %s HTTP/%s\r\n', method, uri, http_version))
	return true
end

function http:read_request_line()
	local line = self.b:needline()
	local method, uri, http_version = line:match'^([%u]+)%s+([^%s]+)%s+HTTP/(%d+%.%d+)'
	self:dp('<=', '%s %s HTTP/%s', method, uri, http_version)
	self.f:checkp(method and (http_version == '1.0' or http_version == '1.1'), 'invalid request line')
	return http_version, method, uri
end

function http:send_status_line(status, message, http_version)
	message = message
		and message:gsub('[\r?\n]', ' ')
		or self.status_messages[status] or ''
	assert(status and status >= 100 and status <= 999, 'invalid status code')
	assert(http_version == '1.1' or http_version == '1.0')
	local s = _('HTTP/%s %d %s\r\n', http_version, status, message)
	self:dp('=>', '%s %s %s', status, message, http_version)
	self.f:send(s)
end

function http:read_status_line()
	local line, err = self.b:needline()
	if not line then return nil, err end
	local http_version, status, status_message
		= line:match'^HTTP/(%d+%.%d+)%s+(%d%d%d)%s*(.*)'
	self:dp('<=', '%s %s %s', status, status_message, http_version)
	status = tonumber(status)
	self.f:checkp(http_version and status, 'invalid status line')
	return http_version, status, status_message
end

--headers --------------------------------------------------------------------

function http:format_header(k, v)
	return http_headers.format_header(k, v)
end

function http:parsed_headers(rawheaders)
	return http_headers.parsed_headers(rawheaders)
end

--special value to have a header removed because `false` might be a valid value.
http.remove = {}

--header names are case-insensitive.
--multiple spaces in header values are equivalent to a single space.
--spaces around header values are ignored.
--header names and values must not contain newlines.
--passing a table as value will generate duplicate headers for each value
--  (set-cookie will come like that because it's not safe to send it folded).
function http:send_headers(headers)
	for k, v in sortedpairs(headers) do
		if v ~= http.remove then
			k, v = self:format_header(k, v)
			if v then
				if istab(v) then --must be sent unfolded.
					for i,v in ipairs(v) do
						self:dp('->', '%-17s %s', k, v)
						self.f:send(_('%s: %s\r\n', k, v))
					end
				else
					self:dp('->', '%-17s %s', k, v)
					self.f:send(_('%s: %s\r\n', k, v))
				end
			end
		end
	end
	self.f:send'\r\n'
end

function http:read_headers(rawheaders)
	local line, name, value
	line = self.b:needline()
	while line ~= '' do --headers end up with a blank line
		name, value = line:match'^([^:]+):%s*(.*)'
		self.f:checkp(name, 'invalid header')
		name = name:lower() --header names are case-insensitive
		line = self.b:needline()
		while line:find'^%s' do --unfold any folded values
			value = value .. line
			line = self.b:needline()
		end
		value = value:gsub('%s+', ' ') --multiple spaces equal one space.
		value = value:gsub('%s*$', '') --around-spaces are meaningless.
		self:dp('<-', '%-17s %s', name, value)
		if http_headers.nofold[name] then --prevent folding.
			if rawheaders[name] then --duplicate header: add to list.
				table.insert(rawheaders[name], value)
			else
				rawheaders[name] = {value}
			end
		else
			if rawheaders[name] then --duplicate header: fold.
				rawheaders[name] = rawheaders[name] .. ',' .. value
			else
				rawheaders[name] = value
			end
		end
	end
end

--body -----------------------------------------------------------------------

function http:set_body_headers(headers, content, content_size, close)
	if isstr(content) then
		assert(not content_size, 'content_size would be ignored')
		headers['content-length'] = #content
	elseif iscdata(content) then
		headers['content-length'] = assert(content_size, 'content_size missing')
	elseif isfunc(content) then
		if content_size then
			headers['content-length'] = content_size
		elseif not close then
			headers['transfer-encoding'] = 'chunked'
		end
	else
		assert(false, type(content))
	end
end

function http:read_chunks(write_content)
	local total = 0
	local chunk_num = 0
	while true do
		chunk_num = chunk_num + 1
		local line = self.b:needline()
		local len = tonumber(line:gsub(';.*', ''), 16) --len[; extension]
		self.f:checkp(len, 'invalid chunk size')
		total = total + len
		self:dp('<<', '%7d bytes; chunk %d', len, chunk_num)
		if len == 0 then --last chunk (trailers not supported)
			self.b:needline()
			break
		end
		self.b:readn_to(len, write_content)
		self.b:needline()
	end
	self:dp('<<', '%7d bytes in %d chunks', total, chunk_num)
end

function http:send_chunked(read_content)
	local total = 0
	local chunk_num = 0
	while true do
		chunk_num = chunk_num + 1
		local chunk, len = read_content()
		if chunk then
			local len = len or #chunk
			total = total + len
			self:dp('>>', '%7d bytes; chunk %d', len, chunk_num)
			self.f:send(_('%X\r\n', len))
			self.f:send(chunk, len)
			self.f:send'\r\n'
		else
			self:dp('>>', '%7d bytes; chunk %d', 0, chunk_num)
			self.f:send'0\r\n\r\n'
			break
		end
	end
	self:dp('>>', '%7d bytes in %d chunks', total, chunk_num)
end

function http:gzip_decoder(format, write)
	--NOTE: gzip decoder threads are abandoned in suspended state on errors.
	--That doesn't leak them but don't expect them to finish!
	local decode = cowrap(function(yield)
		assert(inflate(yield, write, self.recv_buffer_size, format))
	end, 'http-gzip-decode %s', self.f)
	decode()
	return decode
end

function http:chained_decoder(write, encodings)
	if encodings then
		for i = #encodings, 1, -1 do
			local encoding = encodings[i]
			if encoding == 'identity' or encoding == 'chunked' then
				--identity does nothing, chunked would already be set.
			elseif encoding == 'gzip' or encoding == 'deflate' then
				write = self:gzip_decoder(encoding, write)
			else
				error'unsupported encoding'
			end
		end
	end
	return write
end

function http:gzip_encoder(format, content, content_size)
	if isstr(content) or isfunc(content) or iscdata(content) then
		if iscdata(content) then
			assert(content_size)
			local buf, sz, was_read = content, content_size
			content = function()
				if was_read then return end
				was_read = true
				return buf, sz
			end
		end
		--NOTE: on error, the gzip thread is left in suspended state (either
		--not yet started or waiting on write), and we could just abandon it
		--and it will get gc'ed along with the zlib object. The reason we go
		--the extra mile to make sure it always finishes is so it gets removed
		--from the logging.live list immediately.
		local content, gzip_thread = cowrap(function(yield, s)
			if s == false then return end --abort on entry
			local ok, err = deflate(content, yield, self.recv_buffer_size, format)
			assert(ok or err == 'abort', err)
		end, 'http-gzip-encode %s', self.f)
		function self:after_send_response() --called on errors too.
			if threadstatus(gzip_thread) ~= 'dead' then
				content(false, 'abort')
			end
		end
		self.f.gzt = gzip_thread
		return content
	else
		assert(false, type(content))
	end
end

function http:send_body(content, content_size, transfer_encoding, close)
	if transfer_encoding == 'chunked' then
		self:send_chunked(content)
	else
		assert(not transfer_encoding, 'invalid transfer-encoding')
		if isfunc(content) then
			local total = 0
			while true do
				local chunk, len = content()
				if not chunk then break end --eof
				local len = len or #chunk
				total = total + len
				self:dp('>>', '%7d bytes total', len)
				self.f:send(chunk, len)
			end
			self:dp('>>', '%7d bytes total', total)
		else
			local len = content_size or #content
			if len > 0 then
				self:dp('>>', '%7d bytes', len)
				self.f:send(content, len)
			end
		end
	end
	self:dp('>>', '0 bytes')
	if close then
		--this is the "http graceful close" you hear about: we send a FIN to
		--the client then we wait for it to close the connection in response
		--to our FIN, and only after that we can close our end.
		--if we'd just call close() that would send a RST to the client which
		--would cut short the client's pending input stream (it's how TCP works).
		--TODO: limit how much traffic we absorb for this.
		self.f:shutdown'w'
		self.b:readall_to(noop)
		self.f:close()
	end
end

function http:read_body_to_writer(headers, write, from_server, close, state)
	if state then state.body_was_read = false end
	write = write and self:chained_decoder(write, headers['content-encoding'])
		or noop
	local te = headers['transfer-encoding']
	if te and te[#te] == 'chunked' then
		self:read_chunks(write)
	elseif headers['content-length'] then
		local len = headers['content-length']
		self:dp('<<', '%7d bytes total', len)
		self.b:readn_to(len, write)
	elseif from_server and close then
		--NOTE: not allowing this by default to prevent truncation attacks.
		self.f:checkp(config'http_allow_read_until_closed',
			'non-self-terminating request')
		self:dp('<<', '?? bytes (reading until closed)')
		self.b:readall_to(write)
	end
	if close and from_server then
		self.f:close()
	end
	if state then state.body_was_read = true end
end

function http:read_body(headers, write, from_server, close, state)
	if write == 'string' or write == 'buffer' then
		local to_string = write == 'string'
		local write, collect = dynarray_pump()
		self:read_body_to_writer(headers, write, from_server, close, state)
		local buf, sz = collect()
		if to_string then
			return ffi.string(buf, sz)
		else
			return buf, sz
		end
	elseif write == 'reader' then
		--don't read the body, but return a reader function for it instead.
		return (cowrap(function(yield)
			self:read_body_to_writer(headers, yield, from_server, close, state)
			--not returning anything here signals eof.
		end, 'http-read-body %s', self.f))
	else --function or nil
		self:read_body_to_writer(headers, write, from_server, close, state)
		if write then write() end --signal eof to writer.
		return true --signal that content was read.
	end
end

--client-side ----------------------------------------------------------------

local creq = {type = 'http_request', debug_prefix = '>'}
http.client_request_class = creq

function http:build_request(opt, cookies)
	local req = object(creq, {http = self})

	req.http_version = opt.http_version or '1.1'
	req.method = opt.method or 'GET'
	req.uri = opt.uri or '/'

	req.headers = {}

	assert(opt.host, 'host missing') --required, even for HTTP/1.0.
	local default_port = self.https and 443 or 80
	local port = self.port ~= default_port and self.port or nil
	req.headers['host'] = {host = opt.host, port = port}

	req.close = opt.close or req.http_version == '1.0'
	if req.close then
		req.headers['connection'] = 'close'
	end

	if repl(opt.compress, nil, self.compress) ~= false then
		req.headers['accept-encoding'] = 'gzip, deflate'
	end

	req.headers['cookie'] = cookies

	req.content, req.content_size = opt.content or '', opt.content_size

	self:set_body_headers(req.headers, req.content, req.content_size, req.close)
	update(req.headers, opt.headers)

	req.request_timeout = opt.request_timeout
	req.reply_timeout   = opt.reply_timeout

	local write = opt.receive_content
	if isfunc(write) then
		local user_write = write
		function write(buf, sz)
			return user_write(req, buf, sz)
		end
	end
	req.receive_content = write
	req.headers_received = opt.headers_received

	return req
end

function http:send_request(req)
	local dt = req.request_timeout
	self.start_time = clock()
	self.f:setexpires('w', dt and self.start_time + dt or nil)
	self:send_request_line(req.method, req.uri, req.http_version)
	self:send_headers(req.headers)
	self:send_body(req.content, req.content_size, req.headers['transfer-encoding'])
	return true
end
http:protect'send_request'

function http:should_have_response_body(method, status)
	if method == 'HEAD' then return false end
	if status == 204 or status == 304 then return false end
	if status >= 100 and status < 200 then return false end
	return true
end

function http:should_redirect(req, res)
	local method, status = req.method, res.status
	return res.headers['location']
		and (status == 301 or status == 302 or status == 303 or status == 307)
end

local function is_ip(s)
	return s:find'^%d+%.%d+%.%d+%.%d+'
end

function http:cookie_default_path(req_uri)
	return '/' --TODO
end

--either the cookie domain matches host exactly or the domain is a suffix.
function http:cookie_domain_matches_request_host(domain, host)
	return not domain or domain == host or (
		host:sub(-#domain) == domain
		and host:sub(-#domain-1, -#domain-1) == '.'
		and not is_ip(host)
	)
end

--cookie path matches request path exactly, or
--cookie path ends in `/` and is a prefix of the request path, or
--cookie path is a prefix of the request path, and the first
--character of the request path that is not included in the cookie path is `/`.
function http:cookie_path_matches_request_path(cpath, rpath)
	if cpath == rpath then
		return true
	elseif cpath == rpath:sub(1, #cpath) then
		if cpath:sub(-1, -1) == '/' then
			return true
		elseif rpath:sub(#cpath + 1, #cpath + 1) == '/' then
			return true
		end
	end
	return false
end

--NOTE: cookies are not port-specific nor protocol-specific.
function http:should_send_cookie(cookie, host, path, https)
	return (https or not cookie.secure)
		and self:cookie_domain_matches_request_host(cookie, host)
		and self:cookie_path_matches_request_path(cookie, path)
end

local cres = {type = 'http_response', debug_prefix = '<'}

function http:read_response(req)
	local res = object(cres, {http = self, request = req})
	req.response = res
	res.rawheaders = {}

	local dt = req.reply_timeout
	self.f:setexpires('r', dt and clock() + dt or nil)

	res.http_version, res.status, res.status_message = self:read_status_line()

	while res.status == 100 do --ignore any 100-continue messages
		self:read_headers(res.rawheaders)
		res.http_version, res.status = self:read_status_line()
	end

	self:read_headers(res.rawheaders)
	res.headers = self:parsed_headers(res.rawheaders)

	if req.headers_received then
		req.headers_received(res)
	end

	res.close = req.close
		or (res.headers['connection'] and res.headers['connection'].close)
		or res.http_version == '1.0'

	local receive_content = req.receive_content
	if self:should_redirect(req, res) then
		receive_content = nil --ignore the body (it's not the body we want)
		res.redirect_location = self.f:checkp(res.headers['location'], 'no location')
		res.receive_content = req.receive_content
	end

	if self:should_have_response_body(req.method, res.status) then
		res.content, res.content_size =
			self:read_body(res.headers, receive_content, true, res.close, res)
	end

	return res
end
http:protect'read_response'

--server side ----------------------------------------------------------------

local sreq = {type = 'http_request', debug_prefix = '<'}
http.server_request_class = sreq

function http:read_request()
	local req = object(sreq, {http = self})
	self.start_time = clock()
	req.http_version, req.method, req.uri = self:read_request_line()
	req.rawheaders = {}
	self:read_headers(req.rawheaders)
	req.headers = self:parsed_headers(req.rawheaders)
	req.close = req.headers['connection'] and req.headers['connection'].close
	return req
end
http:protect'read_request'

function sreq:read_body(write)
	return self.http:read_request_body(self, write)
end

function http:read_request_body(req, write)
	return self:read_body(req.headers, write, false, false, req)
end
http:protect'read_request_body'

local function content_size(opt)
	local content = opt.content or ''
	return isstr(content) and #content or opt.content_size
end

local function no_body(res, status)
	res.status = status
	res.content, res.content_size = ''
end

local function q0(t)
	return istab(t) and t.q == 0
end

http.nocompress_mime_types = index{
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

function http:accept_content_type(req, opt)
	return true, opt.content_type
end

function http:accept_content_encoding(req, opt)
	local accept = req.headers['accept-encoding']
	if not accept then
		return true
	end
	local compress = repl(opt.compress, nil, self.compress) ~= false
		and (content_size(opt) or 1/0) >= 1000
		and (not opt.content_type or not self.nocompress_mime_types[opt.content_type])
	if not compress then
		return true
	end
	if not q0(accept.gzip   ) then return true, 'gzip'    end
	if not q0(accept.deflate) then return true, 'deflate' end
	return true
end

function http:encode_content(content, content_size, content_encoding)
	if content_encoding == 'gzip' or content_encoding == 'deflate' then
		content, content_size =
			self:gzip_encoder(content_encoding, content, content_size)
	else
		assert(not content_encoding, 'invalid content-encoding')
	end
	return content, content_size
end

function http:allow_method(req, opt)
	local allowed_methods = opt.allowed_methods
	return not allowed_methods or allowed_methods[req.method], allowed_methods
end

local sres = {type = 'http_response', debug_prefix = '>'}

function http:build_response(req, opt, time)
	local res = object(sres, {http = self, request = req})
	res.headers = {}

	res.http_version = opt.http_version or req.http_version

	res.close = opt.close or req.close
	if res.close then
		res.headers['connection'] = 'close'
	end

	if opt.status then
		res.status = opt.status
		res.status_message = opt.status_message
	else
		res.status = 200
	end

	local allow, methods = self:allow_method(req, opt)
	if not allow then
		res.headers['allow'] = methods
		no_body(res, 405) --method not allowed
		return res
	end

	local accept, content_type = self:accept_content_type(req, opt)
	if not accept then
		no_body(res, 406) --not acceptable
		return res
	else
		res.headers['content-type'] = content_type
	end

	local accept, content_encoding = self:accept_content_encoding(req, opt)
	if not accept then
		no_body(res, 406) --not acceptable
		return res
	else
		res.headers['content-encoding'] = content_encoding
	end

	res.content, res.content_size =
		self:encode_content(opt.content or '', opt.content_size, content_encoding)

	res.headers['date'] = time

	self:set_body_headers(res.headers, res.content, res.content_size, res.close)
	update(res.headers, opt.headers)

	return res
end

function http:send_response(res)
	self:send_status_line(res.status, res.status_message, res.http_version)
	self:send_headers(res.headers)
	self:send_body(res.content, res.content_size, res.headers['transfer-encoding'], res.close)
	return true
end
http:protect'send_response'
local send_response = http.send_response
http.after_send_response = noop
function http:send_response(res)
	local ret, err = send_response(self, res)
	self:after_send_response(ret, err)
	if ret then return ret end
	return ret, err
end

--instantiation --------------------------------------------------------------

function _G.http(t)

	assert(t.f)
	local self = object(http, {}, t)

	if self.debug and self.debug.tracebacks then
		self.f.tracebacks = true --for check_io()
	end
	if not (logging and self.debug and self.debug.protocol) then
		self.dp = noop
	end
	if logging and self.debug and self.debug.stream then
		self.f:debug'http'
	end

	--NOTE: 128k on Debian 10, 64k on Windows 10.
	self.recv_buffer_size = self.recv_buffer_size or self.f:getopt'rcvbuf'

	self.b = pbuffer{
		f = self.f,
		readahead = self.recv_buffer_size,
	} --for reading only

	return self
end

function http:free()
	self.b:free()
end
