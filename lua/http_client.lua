--[=[

	Async http(s) downloader.
	Written by Cosmin Apreutesei. Public Domain.

	Features https, gzip compression, connection pool, multiple client IPs,
	auto-redirects, auto-retries, cookie jars, caching.

CLIENT
	http_client(opt1,...) -> client   create a client object, merging options tables
	- client_ips <- {ip1,...}         a list of client IPs to assign to requests
	- debug <- flags                  debug flags: 'protocol tracebacks stream sched'
	client:send_request_headers(opt) -> req   make a HTTP request and send headers
	- max_conn                        connections limit (per target)
	- max_waiting_threads             waiting thread limit (per target)
	- wait_timeout                    conn pool wait timeout (per target)
	- tls_options                     options to pass to sock_bearssl (per target)
	- connect_timeout                 connect timeout
	- headers_timeout                 timeout for sending/receiving headers
	- max_retries                     retry limit for retriable network errors
	- max_redirects                   redirects limit
	- client_ip                       client ip to bind to
	- compress                        allow compression (true)
	- user_agent                      user-agent header to use for requests
	req:send_buffer() -> pb           get a pbuffer to put upload data in
	req:flush_send_buffer() -> left   flush the send bufer afer adding to it
	req:send_request_body_chunk(s | chunk,len) -> left   upload body chunk
	req:recv_response_headers()       receive response headers
	req:recv_response_body_chunk() -> chunk, len, [left]    receive response body chunk
	client:fetch(opt | url) -> s, ht  make a request and get response body and headers
	http_client_request_class         req class with defaults to override
CONFIG
	http_client_debug                 see debug flags for http_client above
FETCH
	fetch(opt | url, [body]) -> content, req

NOTES

	A target is a combination of (vhost, client_ip, https) on which
	one or more HTTP connections can be created subject to per-target limits.

	client:request() must be called from a scheduled socket thread.

]=]

--if not ... then require'http_client_test'; return end

require'glue'
require'json'
require'url'
require'sock'
require'sock_bearssl'
require'pbuffer'
require'gzip'
require'fs'
require'resolver'
require'http_date'
require'resource_pool'

--http connection and request ------------------------------------------------

local http = {
	type = 'http_connection',
	debug_prefix = 'H',
}

local function http_conn(tcp)
	local rb = pbuffer{
		f = tcp,
		readahead = recv_buffer_size,
		lineterm = '\r\n',
		linesize = 8192,
	}
	local wb = pbuffer{
		f = tcp,
	}
	return object(http, {
		tcp = tcp,
		rb = rb, --read pbuffer
		wb = wb, --write pbuffer
		rb_skip = 0, --bytes to skip in rb before next read
		ready = true, --ready to send next request
		gz = nil, --created on first request with req.gzip
		gzb_needs_reset = nil, --gz.b needs reset before next read
	})
end

local req = {
	max_conn = 6,
	max_waiting_threads = 600,
	wait_timeout = 60,
	connect_timeout = 10,
	headers_timeout = 5,
	max_retries = 0,
	max_redirects = 8,
	method = 'GET',
	uri = '/',
	user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
	compress = true,
}
http_client_request_class = req --for overriding defaults

local function http_req(client, target, opt)
	local req = object(req, {
		client = client,
		target = target,
		host = target.host,
		start_clock = clock(),
		dp = not client.debug.protocol and noop or nil,
	}, opt)
	req.headers = update({}, req.headers)
	return req
end

function req:dp(event, fmt, ...)
	local req = self
	if logging.filter[''] then return end
	local dt = clock() - req.start_clock
	local s = fmt and _(fmt, logargs(...)) or ''
	log('', 'htcl', event, '%-4s %4dms %s', req.http.tcp, dt * 1000, s)
end

function req:finish(close)
	local req = self
	local http = req.http
	local tcp = req.http.tcp

	if tcp:closed() then return end
	while not http.ready do --read entire body
		req:recv_response_body_chunk()
	end
	if close then
		tcp:close()
	else
		req.target.conn_pool:reuse(http)
	end
end

function req:send_request_headers()
	local req = self
	local http = req.http
	local tcp = http.tcp

	assert(http.ready, 'finish() not called on previous fetch')
	if http.gz then
		http.gz:reset()
	end
	req.headers['host'] = tcp:checknp(req.host, 'host missing') --required by http
	if not req.headers['user-agent'] then
		req.headers['user-agent'] = req.user_agent
	end
	if req.close then
		req.headers['connection'] = 'close'
	end
	if req.compress then
		req.headers['accept-encoding'] = 'gzip'
	end
	local cookies = req.cookies
	if istab(cookies) then
		local t = {}
		for k,v in sortedpairs(cookies) do
			tcp:checknp(not (k:has'=' or k:has';'), 'invalid cookie name')
			tcp:checknp(not (v:has';'), 'invalid cookie value')
			append(t, k, '=', v, ';')
		end
		pop(t) --last ';'
		req.headers['cookie'] = cat(t)
	end
	req.upload_unsent_size = req.upload_size or 0
	req.headers['content-length'] = tostring(req.upload_size or 0)
	req.wb = http.wb

	tcp:settimeout(req.headers_timeout, 'w')
	local wb = http.wb

	--send request line
	assert(req.method and req.method == req.method:upper())
	assert(req.uri)
	req:dp('=>', '%s %s HTTP/1.1', req.method, req.uri)
	wb:putf('%s %s HTTP/1.1\r\n', req.method, req.uri)

	--send request headers.
	--header names are case-insensitive and can't contain newlines.
	local t = {}
	for k,v in pairs(req.headers) do
		if not istab(v) then t[1] = v; v = t end --must be 'cookie'
		for _,v in ipairs(v) do
			tcp:checknp(not (k:has'\n' or k:has'\r' or k:has':' or k:starts' '),
				'invalid header name: %s', k)
			tcp:checknp(not v:has'\n' and not v:has'\r',
				'invalid header value for: %s', k)
			req:dp('->', '%-17s %s', k, v)
			wb:putf('%s: %s\r\n', k, v)
		end
	end
	wb:putf'\r\n'
	wb:flush()

	tcp:settimeout(nil, 'w')
end

--two ways to send the body:
-- 1. put data into req.wb and then call flush_send_buffer()
-- 2. call send_request_body_chunk() for larger chunks (saves a memcopy).

function req:flush_send_buffer()
	local req = self
	local http = req.http

	local n = req.upload_unsent_size
	assert(n, 'request not sent')
	local len = #http.wb
	http.tcp:checknp(n >= len, 'upload size mismatch')
	http.wb:flush()
	n = n - len
	req.upload_unsent_size = n
	return n
end

function req:send_request_body_chunk(chunk, len)
	local req = self
	local tcp = req.http.tcp
	local n = req.upload_unsent_size
	assert(n, 'request not sent')
	len = len or #chunk
	tcp:checknp(n >= len, 'upload size mismatch')
	tcp:send(chunk, len)
	n = n - len
	req.upload_unsent_size = n
	return n
end

function req:recv_response_headers()
	local req = self
	local http = req.http
	local tcp = http.tcp
	local rb = http.rb

	tcp:settimeout(req.headers_timeout, 'r')

	--read status line
	local skipped = 0 --number of 1xx replies skipped
	::again::
	local line, err = rb:needline()
	if not line then return nil, err end
	local http_version, status = line:match'^HTTP/(%d+%.%d+)%s+(%d%d%d)'
	status = tonumber(status)
	tcp:checkp(http_version == '1.1' and status >= 100, 'invalid status line: %s', line)
	if status < 200 then --skip 1xx reply
		for i = 1, 11 do --skip any headers
			if rb:needline() == '' then break end
			tcp:checkp(i <= 10, 'too many headers')
		end
		skipped = skipped + 1
		tcp:checkp(skipped < 5, 'too many 1xx replies')
		goto again
	end
	req.status = status
	req:dp('<=', '%s', status)
	tcp:checkp(status >= 200 and status <= 999, 'invalid status line: %s', line)

	--read response headers
	req.response_headers = {}
	for i = 1, 101 do
		local line = rb:needline()
		if line == '' then break end --headers end with a blank line
		tcp:checkp(i <= 100, 'too many headers')
		local name, value = line:match'^([^:]+):%s*(.*)'
		tcp:checkp(name, 'invalid header')
		name = name:lower() --header names are case-insensitive
		value = value:trim()
		req:dp('<-', '%-17s %s', name, value)
		local prev_value = req.response_headers[name]
		if name == 'set-cookie' or name == 'www-authenticate' then --can't combine
			add(attr(req.response_headers, name), value)
		elseif prev_value then --duplicate header: combine with prev value
			req.response_headers[name] = prev_value .. ',' .. value
		else
			req.response_headers[name] = value
		end
	end

	tcp:settimeout(nil, 'r')

	req.close = req.close or (req.response_headers['connection'] or ''):has'close'

	local redirect =
		status == 301 or
		status == 302 or
		status == 303 or
		status == 307 or
		status == 308
	if redirect then
		local location = req.response_headers['location']
		tcp:checkp(location, 'location missing for status %d', status)
		req.redirect_location = location
	end

	--self:store_cookies(target, req)
	--if req.redirect_location then
	--	local t = self:redirect_request_args(t, req)
	--	local max_redirects = self.max_redirects or self.client.max_redirects
	--	if t.redirect_count >= max_redirects then
	--		return nil, 'too many redirects', req
	--	end
	--	self:try_recv_request_body()
	--	local ok, err = self:try_send_request_headers(t)
	--	return self:try_recv_response_headers()
	--end

	--prepare req for reading the body
	local te = req.response_headers['transfer-encoding']
	local ce = req.response_headers['content-encoding']
	local len = tonumber(req.response_headers['content-length'])
	if te then len = nil end --chunked takes precedence
	tcp:checkp(not te or te == 'chunked')
	tcp:checkp(not ce or ce == 'gzip')
	tcp:checkp(not len or len >= 0)
	req.chunked = te == 'chunked'
	req.gzip = ce == 'gzip'
	req.body_len = len
	req.body_unread_len = len

	http.ready = len == 0
end

local function decompress(http, req, buf, len)
	if not req.gzip then
		return buf, len
	end
	local ok, err = http.gz:try_push(buf, len)
	http.tcp:checkp(ok, 'gzip error: %s', err)
	http.gzb_needs_reset = true
	local p, len = http.gz.b:ref()
	if len == 0 and err == 'eof' then
		http.tcp:checkp(http.ready, 'premature gzip eof')
		return nil, 'eof'
	end
	return p, len
end
function req:recv_response_body_chunk()
	local req = self
	local http = req.http
	local tcp = http.tcp
	local rb = http.rb

	rb:skip(http.rb_skip)
	if http.ready then
		return nil, 'eof'
	end
	if req.gzip and not http.gz then
		http.gz = gzip_state{op = 'decompress'}
		tcp:onclose(function()
			http.gz:free()
		end)
	elseif http.gzb_needs_reset then
		http.gz.b:reset()
		http.gzb_needs_reset = false
	end
	if req.chunked then
		local line = rb:needline()
		local len = tonumber(line:gsub(';.*', ''), 16) --len[; extension]
		tcp:checkp(len, 'invalid chunk size')
		req:dp('<<', '%7d bytes (chunk)', len)
		if len > 0 then
			local p = rb:need(len + 2):ref() --ends in \r\n
			http.rb_skip = len + 2
			return decompress(http, req, p, len)
		else --last chunk
			rb:need(2):skip(2)
			req:dp('<<', '%7d bytes (chunk end)', 0)
			http.ready = true
			http.rb_skip = 0
			return decompress(http, req, nil, 'eof')
		end
	elseif req.body_len then
		local buf, len = rb:need(1):ref()
		req.body_unread_len = req.body_unread_len - len
		tcp:checkp(req.body_unread_len >= 0, 'body length mismatch')
		if req.body_unread_len == 0 then
			http.ready = true
		end
		http.rb_skip = len
		req:dp('<<', '%7d bytes (full)', len)
		return decompress(http, req, buf, len)
	else --read till EOF
		if rb:have(1) then
			local buf, len = rb:ref()
			http.rb_skip = len
			req:dp('<<', '%7d bytes (not eof)', len)
			return decompress(http, req, buf, len)
		else
			req:dp('<<', '%7d bytes (eof)', 0)
			http.ready = true
			http.rb_skip = 0
			return decompress(http, req, nil, 'eof')
		end
	end
end

--http client ----------------------------------------------------------------

local client = {
	type = 'http_client',
	client_ips = {},
}

function client:dp(target, event, fmt, ...)
	if logging.filter[''] then return end
	local s = fmt and _(fmt, logargs(...)) or ''
	return log('', 'htcl', event, '%-4s %s %s', target or '', s)
end

function http_client(...)

	local client = object(client, {}, ...)

	local debug = client.debug or config'http_client_debug' or ''
	if isstr(debug) then
		client.debug = index(collect(words(debug)))
	end
	if not client.debug.sched then
		client.dp = noop
	end

	client.targets = {} -- 'HOST[ CLIENT_IP]' -> target
	client.last_client_ip_index = {} -- host -> index
	client.cookies = {}

	return client
end

--connection pool ------------------------------------------------------------

--client ips are assigned in round-robin per vhost to create new targets.
function client:assign_client_ip(host)
	if #self.client_ips == 0 then return end
	local i = (self.last_client_ip_index[host] or 0) + 1
	if i > #self.client_ips then i = 1 end
	self.last_client_ip_index[host] = i
	return self.client_ips[i]
end

--A target is a combination of (vhost, client_ip, https) on which one or more
--HTTP connections can be created subject to per-target limits.
--Connections are reused using the target's connection pool.
local http_target = {
	type = 'http_target',
	debug_prefix = '@',
}
function client:target(req)
	local host = assert(req.host, 'host missing'):lower()
	local client_ip = req.client_ip or self:assign_client_ip(host)
	local target_key = host
		.. (client_ip and ' '..client_ip or '')
		.. (req.https and ' S' or '')
	local target = attr(self.targets, target_key)
	if not target.type then --just created
		object(http_target, target)
		target.host = host
		target.https = req.https
		target.client_ip = client_ip
		target.conn_pool = resource_pool{
			max_resources = req.max_conn,
			max_waiting_threads = req.max_waiting_threads,
		}
		target.tls_options = req.tls_options
	end
	return target
end

function client:get_conn(req)
	local target = req.target
	local http, err = target.conn_pool:get(req.start_clock + req.wait_timeout)
	if not http and err == 'create' then
		local tcp, err = try_connect(target.host,
			target.https and 443 or 80,
			req.connect_timeout,
			target.client_ip
		)
		if not tcp then
			target.conn_pool:cancel()
			return nil, err
		end
		if self.debug.stream then
			tcp:debug_stream'http'
		end
		if target.https then
			local stcp, err = try_client_stcp(tcp, target.host, req.tls_options)
			if not stcp then
				tcp:try_close()
				target.conn_pool:cancel()
				return nil, err
			end
			tcp = stcp
		end
		http = http_conn(tcp)
		target.conn_pool:put(http)
		tcp:onclose(function()
			target.conn_pool:pull(http)
		end)
	end
	return http, err
end

--request call ---------------------------------------------------------------

function client:send_request_headers(req_opt)
	local target = self:target(req_opt)
	local req = http_req(self, target, req_opt)
	local http, err = self:get_conn(req)
	if not http then return nil, err end
	req.http = http
	--req.cookies = self:get_cookies(target.client_ip, target.host,
	--	req.uri, target.https)
	req:send_request_headers()
	return req
end

--global fetch ---------------------------------------------------------------

local cl
function fetch(...)
	cl = cl or http_client()
	return cl:fetch(...)
end

if not ... then

logging.verbose = true
logging.debug = true
config('http_client_debug', 'protocol')

local client = http_client()
run(function()
	for i=1,2 do
		local req = client:send_request_headers{
			host = 'echo.websocket.org', https = true, uri = '/', compress = true,
		}
		req:recv_response_headers()
		while not req.http.ready do
			local chunk, len, left = req:recv_response_body_chunk()
			if not chunk then break end
			if len > 0 then
				pr('CHUNK: ', len)
				pr(str(chunk, len))
			end
		end
		req:finish()
	end
end)

end
