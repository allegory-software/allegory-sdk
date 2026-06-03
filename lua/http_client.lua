--[=[

	Async http(s) downloader.
	Written by Cosmin Apreutesei. Public Domain.

	Features TLS, gzip compression, connection pool, multiple client IPs,
	auto-redirects, auto-retries, cookie jars, caching.

CLIENT
	http_client(opt1,...) -> client   create a client object, merging options tables
	- client_ips <- {ip1,...}         a list of local IPs to assign to requests
	- debug <- flags                  debug flags: 'protocol tracebacks stream sched'
	client:send_headers(opt) -> req   connect and send request line and headers
	- url                             full url, parsed into (host, uri, https), or:
	- host                            host[:port]
	- uri                             uri ('/')
	- secure                          use TLS (true)
	- body_size                       size of upload body (0; required for uploads)
	- body_type                       upload body content-type
	- max_conn                        connections limit (per target)
	- max_waiting_threads             waiting thread limit (per target)
	- wait_timeout                    conn pool wait timeout (per target)
	- tls_options                     options to pass to sock_bearssl (per target)
	- connect_timeout                 connect timeout
	- headers_timeout                 timeout for sending/receiving headers
	- max_retries                     retry limit for retriable network errors
	- max_redirects                   redirects limit
	- client_ip                       local ip to bind to
	- compress                        allow response compression (true)
	- user_agent                      user-agent header to use for requests
	req:send_buffer() -> pb           get a pbuffer to put upload data in
	req:flush_send_buffer() -> left   flush the send bufer afer adding to it
	req:send_body_chunk(s | chunk,len) -> left   upload body chunk
	req:recv_headers()                receive status and headers
	- status -> n                     response status code
	- response_headers -> {k->v}      response headers
	- redirect_location -> url_s      redirect location, if need to redirect
	- chunked -> true                 response comes chunked
	- gzip -> true                    response is compressed
	- response_body_size -> n         (compressed) body length, if known
	- response_body_unread_size -> n  body length left to read, if length known
	- eof -> true                     body was read or there is no body
	req:redirect_request() -> req     create redirect request from redirect_location
	- body_size -> n | 0              require resending the body or not
	req:recv_body_chunk() -> chunk,len | nil,'eof'  receive next response body chunk
	req:finish()                      finish request and release connection (required!)
	- finished -> true                request is finished
	client:[try_]fetch(opt | url) -> s,req  make request and get response body
	- req.response_body -> s          response body
	http_client_request_class         req class with defaults to override
CONFIG
	http_client_debug                 see debug flags for http_client above
FETCH
	[try_]fetch(req | url, [body]) -> content, req

NOTES

	A target is a combination of (vhost, client_ip, secure) on which
	one or more HTTP connections can be created subject to per-target limits.

	client:request() must be called from a scheduled socket thread.

]=]

if not ... then require'http_client_test'; return end

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
	local recv_buffer_size = tcp:getopt'so_rcvbuf' --usually 128k
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
	secure = true,
	compress = true,
}
http_client_request_class = req --for overriding defaults

local function http_req(client, opt)
	local req = object(req, {
		client = client,
		start_clock = clock(),
		finished = false, --connection released
		eof = false, --response body fully read
		redirect_count = 0,
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

function req:finish()
	local req = self
	local http = req.http
	local rb = http.rb
	if req.finished then return end
	--need to read until req.eof, not until recv_body_chunk() returns nil
	--because there can be more bytes to read after a gzip stream ends.
	while not req.eof do req:recv_body_chunk() end --read entire body
	rb:skip(http.rb_skip)
	http.rb_skip = 0
	if http.gzb_needs_reset then
		http.gz.b:reset()
		http.gzb_needs_reset = false
	end
	req.finished = true
	if req.close then
		req.http.tcp:close()
	else
		req.target.conn_pool:reuse(req.http)
	end
end

function req:send_headers()
	local req = self
	local http = req.http
	local tcp = http.tcp

	assert(not req.finished, 'request finished')
	if http.gz then
		http.gz:reset()
	end
	req.headers['host'] = tcp:checknp(req.host, 'host missing') --required by http
	req.headers['user-agent'] = req.user_agent
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
	req.body_size = req.body_size or 0
	tcp:checkp(req.body_size >= 0, 'invalid body_size')
	req.body_unsent_size = req.body_size
	req.headers['content-length'] = tostring(req.body_size)
	req.headers['content-type'] = req.body_type
	req.wb = http.wb

	tcp:settimeout(req.headers_timeout, 'w')
	local wb = http.wb

	--send request line
	tcp:checkp(req.method == req.method:upper(), 'invalid method')
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
-- 2. call send_body_chunk() for larger chunks (saves a memcopy).

function req:flush_send_buffer()
	local req = self
	local http = req.http

	assert(not req.finished, 'request finished')
	local n = req.body_unsent_size
	assert(n, 'request not sent')
	local len = #http.wb
	http.tcp:checknp(n >= len, 'request body size mismatch')
	http.wb:flush()
	n = n - len
	req.body_unsent_size = n
	return n
end

function req:send_body_chunk(chunk, len)
	local req = self
	local tcp = req.http.tcp

	assert(not req.finished, 'request finished')
	local n = req.body_unsent_size
	assert(n, 'request not sent')
	len = len or #chunk
	tcp:checknp(n >= len, 'request body size mismatch')
	tcp:send(chunk, len)
	n = n - len
	req.body_unsent_size = n
	return n
end

function req:recv_headers()
	local req = self
	local http = req.http
	local tcp = http.tcp
	local rb = http.rb

	assert(not req.finished, 'request finished')
	assert(req.body_unsent_size == 0, 'body not sent')
	assert(not req.response_headers, 'headers already received')

	tcp:settimeout(req.headers_timeout, 'r')

	--read status line
	local skipped = 0 --number of 1xx replies skipped
	::again::
	local line = rb:needline()
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

	req.client:store_cookies(req)

	--prepare req for reading the body
	local te = req.response_headers['transfer-encoding']
	local ce = req.response_headers['content-encoding']
	local len = tonumber(req.response_headers['content-length'])
	if te then len = nil end --chunked takes precedence
	tcp:checkp(not te or te == 'chunked')
	tcp:checkp(not ce or ce == 'gzip')
	tcp:checkp(req.compress or not ce)
	tcp:checkp(not len or len >= 0)
	req.chunked = te == 'chunked'
	req.gzip = ce == 'gzip'
	req.response_body_size = len
	req.response_body_unread_size = len
	if (req.method == 'HEAD' or status == 204 or status == 304)
		and not te and not len
	then
		req.eof = true --no body and no framing to drain
	else
		req.eof = len == 0
	end
end

function req:format_url()
	local req = self
	local u = url_parse(req.uri)
	local host, port, addr_type = addr_parse(req.host)
	u.scheme = req.secure and 'https' or 'http'
	u.host = host
	u.port = port
	return u
end

function req:redirect_request()
	local req = self
	local client = req.client
	local tcp = req.http.tcp
	assert(req.redirect_location, 'no redirect_location')
	tcp:checkp(req.redirect_count < req.max_redirects, 'too many redirects')
	local req_url = req:format_url()
	local re_url = url_resolve(req_url, req.redirect_location)
	tcp:checkp(re_url.scheme == 'http' or re_url.scheme == 'https', 'url scheme not http(s)')
	tcp:checkp(re_url.host, 'redirect location has no host')
	local resend_body = req.status == 307 or req.status == 308
	local headers = update({}, req.headers)
	local cross_origin = re_url.host ~= req_url.host
		or re_url.port ~= req_url.port
		or re_url.scheme ~= req_url.scheme
	if cross_origin then
		headers.authorization = nil
		headers.cookie = nil
		headers.host = nil
	end
	return {
		method = resend_body and req.method or 'GET',
		url = re_url,
		redirect_count = req.redirect_count + 1,
		headers = headers,
		body_size = resend_body and req.body_size or 0,
		body_type = resend_body and req.body_type or nil,
		--carry-over fetching options
		max_conn = req.max_conn,
		max_waiting_threads = req.max_waiting_threads,
		wait_timeout = req.wait_timeout,
		tls_options = req.tls_options, --these can only be generic or same server
		connect_timeout = req.connect_timeout,
		headers_timeout = req.headers_timeout,
		max_retries = req.max_retries,
		max_redirects = req.max_redirects,
		client_ip = req.client_ip,
		compress = req.compress,
		user_agent = req.user_agent,
	}
end

local function decompress(http, req, buf, len, eof)
	if not req.gzip then
		return buf, len
	end
	local ok, err = http.gz:try_push(buf, len, eof)
	http.tcp:checkp(ok, 'gzip error: %s', err)
	http.gzb_needs_reset = true
	local p, len = http.gz.b:ref()
	if len == 0 and err == 'eof' then return nil, 'eof' end
	if len == 0 then return req:recv_body_chunk() end --gzip buffering, need more input
	return p, len
end
function req:recv_body_chunk()
	local req = self
	local http = req.http
	local tcp = http.tcp
	local rb = http.rb

	assert(not req.finished, 'request finished')
	assert(req.response_headers, 'response headers not received')

	if req.eof then
		return nil, 'eof'
	end
	rb:skip(http.rb_skip)
	http.rb_skip = 0
	if req.gzip and not http.gz then
		http.gz = gzip_state{op = 'decompress'}
		tcp:onclose(function()
			http.gz:free()
			http.gz = nil
		end)
	elseif http.gzb_needs_reset then
		http.gz.b:reset()
		http.gzb_needs_reset = false
	end
	if req.chunked then
		local line = rb:needline()
		local len = tonumber(line:gsub(';.*', ''), 16) --len[; extension]
		tcp:checkp(len and len >= 0, 'invalid chunk size')
		req:dp('<<', '%7d bytes (chunk)', len)
		if len > 0 then
			local p = rb:need(len + 2):ref() --ends in \r\n
			http.rb_skip = len + 2
			return decompress(http, req, p, len)
		else --last chunk
			rb:need(2):skip(2)
			http.rb_skip = 0
			req.eof = true
			return decompress(http, req, nil, 'eof')
		end
	elseif req.response_body_size then
		local buf, len = rb:need(1):ref()
		req.response_body_unread_size = req.response_body_unread_size - len
		tcp:checkp(req.response_body_unread_size >= 0,
			'response body size mismatch')
		req:dp('<<', '%7d bytes (full)', len)
		http.rb_skip = len
		req.eof = req.response_body_unread_size == 0
		return decompress(http, req, buf, len, req.eof)
	else --read till EOF
		if rb:have(1) then
			local buf, len = rb:ref()
			req:dp('<<', '%7d bytes (not eof)', len)
			http.rb_skip = len
			return decompress(http, req, buf, len)
		else
			req:dp('<<', '%7d bytes (eof)', 0)
			http.rb_skip = 0
			req.eof = true
			return decompress(http, req, nil, 'eof')
		end
	end
end

function req:cancel()
	if not req.http then return end
	req.http.tcp:close()
end

--http client ----------------------------------------------------------------

local client = {
	type = 'http_client',
}

function client:dp(target, event, fmt, ...)
	if logging.filter[''] then return end
	local s = fmt and _(fmt, logargs(...)) or ''
	return log('', 'htcl', event, '%-4s %s %s', target or '', s)
end

function http_client(...)

	local client = object(client, {}, ...)
	_own(_check_owner(client.owner), client)
	attr(client, 'client_ips')

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

function client:close()
	assert(self:try_close())
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

--A target is a combination of (vhost, client_ip, secure) on which one or more
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
		.. (req.secure and ' S' or '')
	local target = attr(self.targets, target_key)
	if not target.type then --just created
		object(http_target, target)
		target.host = host
		target.secure = req.secure
		target.client_ip = client_ip
		target.conn_pool = resource_pool{
			max_resources = req.max_conn,
			max_waiting_threads = req.max_waiting_threads,
		}
		target.tls_options = req.tls_options
		_own(self, target)
	end
	return target
end

function client:connect(req)
	local target = req.target
	local tcp = connect(target.host,
		target.secure and 443 or 80,
		req.connect_timeout,
		target.client_ip
	)
	if self.debug.stream then
		tcp:debug_stream'http'
	end
	if target.secure then
		local tls_host = addr_parse(target.host) --strip port for SNI
		tcp = client_stcp(tcp, tls_host, req.tls_options)
	end
	local http = http_conn(tcp)
	tcp:setowner(target)
	return http
end

function client:get_conn(req)
	local target = req.target
	local http, err = target.conn_pool:get(req.start_clock + req.wait_timeout)
	if http then return http end
	if err ~= 'create' then
		check_net(nil, 'connect', false, err)
	end
	local ok, http = try_with_owner(self.connect, self, req)
	if ok then
		http.tcp:onclose(function()
			target.conn_pool:pull(http)
		end)
		target.conn_pool:put(http)
		return http
	else
		target.conn_pool:cancel()
		check_net(nil, 'connect', false, http) --http=err
	end
end

--cookie storage -------------------------------------------------------------

local function parse_set_cookie(s)
	local nv, attrs = s:match'^([^;]+)(.*)'
	if not nv then return end
	local name, value = nv:match'^%s*([^=]+)=(.*)'
	if not name then return end
	local c = {name = name:trim(), value = value:trim()}
	for k,v in attrs:gmatch';%s*([^=;]+)=?([^;]*)' do
		k = k:trim():lower()
		v = v:trim()
		if k == 'expires' then
			c.expires = http_date_parse(v)
		elseif k == 'max-age' then
			c['max-age'] = tonumber(v)
		elseif k == 'domain' then
			c.domain = v:gsub('^%.', ''):lower()
		elseif k == 'path' then
			c.path = v
		elseif k == 'secure' then
			c.secure = true
		elseif k == 'httponly' then
			c.httponly = true
		end
	end
	return c
end

local function accept_cookie(domain, host)
	return not domain or domain == host
		or (domain:find'%.' and host:ends('.'..domain)
			and not (is_ipv4(host) or is_ipv6(host)))
end

local function cookie_default_path(uri)
	local path = uri:match'^([^?#]*)'
	if not (path and path:starts'/' and path:find('/', 2, true)) then
		return '/'
	end
	return path:match'^(.*/)[^/]*$'
end

function client:store_cookies(req)
	local cookies = req.response_headers['set-cookie']
	if not cookies then return end
	local cookie_jar = attr(self.cookies, req.target.client_ip or '*')
	local host = req.target.host
	for i,s in ipairs(cookies) do
		local cookie = parse_set_cookie(s)
		if cookie and accept_cookie(cookie.domain, host) then
			local expires = cookie.expires and time(cookie.expires)
			local cur_time = now()
			if not expires and cookie['max-age'] then
				expires = cur_time + cookie['max-age']
			end
			local domain = cookie.domain or host
			local path = cookie.path or cookie_default_path(req.uri)
			if expires and expires < cur_time then --expired: remove from jar.
				attrs_clear(cookie_jar, domain, path, cookie.name)
			else
				local sc = attr(attr(attr(cookie_jar, domain), path), cookie.name)
				sc.wildcard = cookie.domain and true or false
				sc.secure = cookie.secure
				sc.expires = expires
				sc.value = cookie.value
			end
		end
	end
end

--cookie path matches request path exactly, or
--cookie path ends in `/` and is a prefix of the request path, or
--cookie path is a prefix of the request path, and the first
--character of the request path that is not included in the cookie path is `/`.
local function cookie_path_matches_request_path(cpath, rpath)
	if cpath == rpath then
		return true
	elseif cpath == rpath:sub(1, #cpath) then
		if cpath:sub(-1, -1) == '/' then
			return true
		elseif rpath:sub(#cpath + 1, #cpath + 1) == '/' then
			return true
		end
	elseif cpath == rpath..'/' then --curl-like: /cookies matches /cookies/
		return true
	end
	return false
end

function client:get_cookies(req)
	local target = req.target
	local cookie_jar = attr(self.cookies, req.target.client_ip or '*')
	if not cookie_jar then return end
	local path = req.uri:match'^[^%?#]+'
	local time = time()
	local cookies = {}
	local names = {}
	for s in req.target.host:gmatch'[^%.]+' do
		add(names, s)
	end
	local domain = names[#names]
	local host = target.host
	for i = #names-1, 1, -1 do
		domain = names[i] .. '.' .. domain
		local domain_jar = cookie_jar[domain]
		if domain_jar then
			for cpath, path_jar in pairs(domain_jar) do
				if cookie_path_matches_request_path(cpath, path) then
					for name, sc in pairs(path_jar) do
						if sc.expires and sc.expires < time then --expired: auto-clean.
							attrs_clear(cookie_jar, domain, cpath, name)
						elseif not sc.wildcard and domain ~= host then
							--skip: exact-host cookie, not our host.
						elseif req.secure or not sc.secure then
							cookies[name] = sc.value
						end
					end
				end
			end
		end
	end
	return cookies
end

--request call ---------------------------------------------------------------

function client:send_headers(req)
	local req = http_req(self, req)
	if req.url then
		assert(req.host == nil) --mutually exclusive
		local u = url_parse(req.url)
		u.scheme = u.scheme or (req.secure and 'https' or 'http')
		checkp(nil, u.scheme == 'http' or u.scheme == 'https', 'url scheme not http(s)')
		req.host = u.host .. (u.port and ':'..u.port or '')
		req.uri = url_format{path = u.path, query = u.query}
		req.secure = u.scheme == 'https'
		req.url = nil --call :format_url() to recreate
	end
	assert(req.host, 'host required')
	assert(req.uri, 'uri required')
	req.target = self:target(req)
	local http = self:get_conn(req)
	req.http = http
	req.cookies = self:get_cookies(req)
	req:send_headers()
	return req
end

function client:_fetch(req, body)
	req = self:send_headers(req)
	if req.body_size > 0 then --redirect can require resending the body, or not.
		req:send_body_chunk(body)
	end
	req:recv_headers()
	if req.redirect_location then
		req:finish()
		req = req:redirect_request()
		return self:_fetch(req, body)
	end
	if not req.eof then --there's a body
		local bb = string_buffer()
		while 1 do
			local chunk, len = req:recv_body_chunk()
			if not chunk then break end --eof
			bb:putcdata(chunk, len)
		end
		req.response_body = bb:tostring()

		local ct = req.response_headers['content-type']
		if ct and ct:starts'application/json' then
			local json, err = try_json_decode(req.response_body)
			req.http.tcp:checkp(json, err)
			--if the entire resonse is the json value "null", then return null
			--because nil is for errors.
			json = repl(json, nil, null)
			req.response_body = json
		end
	else
		req.response_body = '' --because nil is for errors
	end
	req:finish()
	return req
end
function client:fetch(arg1, body) --opt | url,body
	local default_max_retries = req.max_retries
	local req = istab(arg1) and update({}, arg1) or {url = arg1}
	local body = body or req.body
	req.headers = update({}, req.headers)
	if body ~= nil and not isstr(body) then
		body = json_encode(body)
		req.body_type = 'application/json'
	end
	if body then
		req.method = req.method or 'POST'
		req.body_size = #body
	end
	local retries = 0
	local max_retries = req.max_retries or default_max_retries
	local req_opt = req
	while 1 do
		local ok, req = catch('net', self._fetch, self, req_opt, body)
		if ok then
			return req.response_body, req
		end
		retries = retries + 1
		if retries >= max_retries then
			error(req) --req=err
		end
	end
end
function client:try_fetch(...)
	local ok, body, req = catch('net protocol', self.fetch, self, ...)
	if not ok then return nil, body end
	return body or '', req
end

--global fetch ---------------------------------------------------------------

local cl
function fetch(...)
	cl = cl or http_client{owner = mainthread()}
	return cl:fetch(...)
end
function try_fetch(...)
	cl = cl or http_client{owner = mainthread()}
	return cl:try_fetch(...)
end
