--[=[

	Async http(s) downloader.
	Written by Cosmin Apreutesei. Public Domain.

	Features https, gzip compression, connection pool, multiple client IPs,
	auto-redirects, auto-retries, cookie jars, caching.

CLIENT
	http_client(opt1,...) -> client   create a client object, merging options tables
	  max_conn_per_target <- n        max connections per target
	  client_ips <- {ip1,...}         a list of client IPs to assign to requests
	  max_retries                     number of retries before giving up (0)
	  max_redirects                   number of redirects before giving up (8)
	  tls_options                     options to pass to sock_bearssl
	  compress <- true|false          allow compression (true)
	  debug <- flags                  debug flags: 'protocol tracebacks stream sched'
	client:send_request_headers(opt) -> req   make a HTTP request and send headers
	  connect_timeout                 connect timeout (set on target)
	  request_timeout                 timeout for the request part
	  response_timeout                timeout for the response part
	  client_ip                       client ip to bind to
	  max_conn                        connections limit (set on target)
	  max_redirects                   redirects limit
	  compress <- true|false          allow compression
	  tls_options                     options to pass to sock_bearssl
	req:flush_send_buffer() -> left   flush req.wb
	req:send_request_body_chunk(chunk[,len]) -> left  upload body chunk
	req:recv_response_headers()       receive response headers
	req:recv_response_body_chunk() -> chunk, len, [left]    receive response body chunk
	client:fetch(opt | url) -> s, ht  make a request and get response body and headers
	client:close_all()                close all connections
CONFIG
	fetch_max_conn_per_target
	fetch_client_ips
	http_debug
FETCH
	fetch(opt | url, [body]) -> content, req

NOTES

	A target is a combination of (vhost, client_ip) on which
	one or more HTTP connections can be created subject to per-target limits.

	client:request() must be called from a scheduled socket thread.

	client:close_all() must be called after the socket loop finishes.

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

--http connection object -----------------------------------------------------

local http = {type = 'http_connection', debug_prefix = 'H'}

local function http_conn(opt)
	local rb = pbuffer{
		f = opt.tcp,
		readahead = recv_buffer_size,
		lineterm = '\r\n',
		linesize = 8192,
	} --read buffer
	local wb = pbuffer{
		f = opt.tcp,
	} --write buffer
	return object(http, {
		rb = rb,
		wb = wb,
	}, opt)
end

function http:send_request_headers(req)
	local tcp = self.tcp
	req.headers['host'] = tcp:checknp(req.host, 'host missing') --required by http
	if req.close then
		req.headers['connection'] = 'close'
	end
	if repl(req.compress, nil, self.compress) ~= false then
		req.headers['accept-encoding'] = 'gzip'
	end
	local cookies = req.cookies
	if istab(cookies) then
		local t = {}
		for k,v in sortedpairs(cookies) do
			tcp:checknp(not (k:has'=' or k:has';' or v:has'=' or v:has';'),
				'invalid cookie value')
			append(t, k, '=', v)
		end
		req.headers['cookie'] = cat(t, ';')
	end
	req.upload_unsent_size = req.upload_size or 0
	if req.upload_size then
		req.headers['content-length'] = tostring(req.upload_size)
	end
	req.wb = self.wb

	tcp:settimeout(req.request_timeout, 'w')
	local wb = self.wb

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
			assert(not v:has'\n' and not v:has'\r')
			req:dp('->', '%-17s %s', k, v)
			wb:putf('%s: %s\r\n', k, v)
		end
	end
	wb:putf'\r\n'
	wb:flush()
end

--two ways to send the body:
-- 1. put data into req.wb and then call flush_send_buffer()
-- 2. call send_request_body_chunk() for larger chunks (saves a memcopy).

function http:flush_send_buffer(req)
	local n = req.upload_unsent_size
	assert(n, 'request not sent')
	local len = #self.wb
	self.tcp:checknp(n >= len, 'upload size mismatch')
	self.wb:flush()
	n = n - len
	req.upload_unsent_size = n
	return n
end

function http:send_request_body_chunk(req, chunk, len)
	local n = req.upload_unsent_size
	assert(n, 'request not sent')
	len = len or #chunk
	self.tcp:checknp(n >= len, 'upload size mismatch')
	self.tcp:send(chunk, len)
	n = n - len
	req.upload_unsent_size = n
	return n
end

function http:recv_response_headers(req)
	local tcp = self.tcp
	local rb = self.rb
	tcp:settimeout(req.response_timeout, 'r')

	--read status line
	local line, err = rb:needline()
	if not line then return nil, err end
	local http_version, status = line:match'^HTTP/(%d+%.%d+)%s+(%d%d%d)'
	status = tonumber(status)
	tcp:checkp(http_version == '1.1' and status >= 200 and status <= 999,
		'invalid status line: %s', line)
	req.status = status
	req:dp('<=', '%s', status)

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

	--prepare req for reading the body
	local te = req.response_headers['transfer-encoding']
	local ce = req.response_headers['content-encoding']
	local len = tonumber(req.response_headers['content-length'])
	if te then len = nil end
	tcp:checkp(not te or te == 'chunked')
	tcp:checkp(not ce or ce == 'gzip')
	tcp:checkp(not len or len >= 0)
	req.chunked = te == 'chunked'
	req.gzip = ce == 'gzip'
	req.body_len = len
	req.body_unread_len = len
	req.finished = len == 0
	if req.gzip then
		if not self.gz then
			self.gz = gzip_state{op = 'decompress'}
			tcp:onclose(function()
				self.gz:free()
			end)
		else
			self.gz:reset()
		end
	end
end

function http:decompress(req, buf, len)
	if req.gzip then
		pr('GZIP PUSH', buf, len)
		local ok, err = self.gz:try_push(buf, len)
		self.tcp:checkp(ok, 'gzip error: %s', err)
		self.gzb_needs_reset = true
		local p, len = self.gz.b:ref()
		return p, len
	else
		return buf, len
	end
end
function http:recv_response_body_chunk(req)
	local rb = self.rb
	local tcp = self.tcp
	if req.finished then
		return nil, 'eof'
	end
	if self.rb_needs_reset then
		rb:reset()
		self.rb_needs_reset = false
	end
	if self.gzb_needs_reset then
		self.gz.b:reset()
		self.gzb_needs_reset = false
	end
	if req.chunked then
		local line = rb:needline()
		local len = tonumber(line:gsub(';.*', ''), 16) --len[; extension]
		tcp:checkp(len, 'invalid chunk size')
		req:dp('<<', '%7d bytes', len)
		if len > 0 then
			local p = rb:ref()
			rb:need(len)
			self.rb_needs_reset = true
			rb:needline()
			return self:decompress(req, p, len)
		else --last chunk
			rb:needline()
			req.finshed = true
			return self:decompress(req, nil, 'eof')
		end
	elseif req.body_len then
		rb:need(1)
		self.rb_needs_reset = true
		local buf, len = rb:ref()
		req:dp('<<', '%7d bytes', len)
		req.body_unread_len = req.body_unread_len - len
		tcp:checkp(req.body_unread_len >= 0, 'length mismatch')
		if req.body_unread_len == 0 then
			req.finished = true
		end
		return self:decompress(req, buf, len)
	else --read till EOF
		if rb:have(1) then
			self.rb_needs_reset = true
			local buf, len = rb:ref()
			req:dp('<<', '%7d bytes', len)
			return self:decompress(req, buf, len)
		else
			req.finished = true
			return self:decompress(req, nil, 'eof')
		end
	end
end

--http client object ---------------------------------------------------------

local client = {
	type = 'http_client',
	max_conn_per_target = 6,
	client_ips = {},
	max_retries = 0,
	max_redirects = 8,
}

function client:dp(target, event, fmt, ...)
	if logging.filter[''] then return end
	local s = fmt and _(fmt, logargs(...)) or ''
	return log('', 'htcl', event, '%-4s %s %s', target or '', s)
end

function http_client(...)

	local self = object(client, {}, ...)

	self.debug = self.debug or config'http_debug' or ''
	if isstr(self.debug) then
		self.debug = index(collect(words(self.debug)))
	end
	if not self.debug.sched then
		self.dp = noop
	end

	self.targets = {} -- 'HOST[ CLIENT_IP]' -> target
	self.wait_conn_queue = {} -- {thread1, target1, ...}
	self.last_client_ip_index = {} -- host -> index
	self.cookies = {}
	self.conn_count = 0

	return self
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

--A target is a combination of (vhost, client_ip) on which one or more
--HTTP connections can be created subject to per-target limits.
--Connections are added to the target's ready FIFO after each request
--to be reused for future requests.
function client:target(req)
	local host = assert(req.host, 'host missing'):lower()
	local client_ip = req.client_ip or self:assign_client_ip(host)
	local target_key = host .. (client_ip and ' '..client_ip or '')
	local target = attr(self.targets, target_key)
	if not target.type then --just created
		target.type = 'http_target'
		target.debug_prefix = '@'
		target.host = host
		target.https = req.https
		target.client_ip = client_ip
		target.ready = {} --ready conn FIFO
		target.conn_count = 0
		--NOTE: these are set once so we assume they are static per target.
		target.connect_timeout = req.connect_timeout
		target.max_conn = req.max_conn
		target.tls_options = req.tls_options
	end
	return target
end

local function _connect(self, target)
	local tcp = connect(target.host,
		target.https and 443 or 80,
		target.connect_timeout,
		target.client_ip
	)
	if self.debug.stream then
		tcp:debug'http'
	end
	if target.https then
		tcp = client_stcp(tcp, target.host, target.tls_options or self.tls_options)
	end
	return tcp
end
function client:try_connect(target)
	local ok, tcp, err = catch('io protocol', _connect, self, target)
	if not ok then
		return nil, err
	else
		tcp:onclose(function(tcp)
		--	self:resume_next_wait_conn_thread()
		end)
		return tcp
	end
end

function client:get_conn(target)
	return self:try_connect(target)
end

--request call ---------------------------------------------------------------

local function req_dp(req, event, fmt, ...)
	if logging.filter[''] then return end
	local dt = clock() - req.start_time
	local s = fmt and _(fmt, logargs(...)) or ''
	log('', 'htcl', event, '%-4s %4dms %s', req.tcp, dt * 1000, s)
end

function client:send_request_headers(opt)

	local target = self:target(opt)

	local tcp, err = self:get_conn(target)
	if not tcp then return nil, err end

	local http = http_conn({tcp = tcp, compress = self.compress})

	local req = update({
		client = self,
		http = http,
		host = target.host,
		method = 'GET',
		uri = '/',
		headers = {},
		dp = self.debug.protocol and req_dp or noop,
	}, opt)

	--local cookies = self:get_cookies(target.client_ip, target.host,
	--	req.uri, target.https)

	http:send_request_headers(req, cookies)

	function req:send_request_body_chunk()
		http:send_request_body_chunk(self)
	end

	function req:recv_response_headers()
		http:recv_response_headers(req)
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
	end

	function req:recv_response_body_chunk()
		return http:recv_response_body_chunk(req)
	end

	function req:finish(close)
		if http.tcp:closed() then return end
		repeat --read entire body
			local _, _, left = self:try_recv_response_body_chunk()
		until left == 0
		if close then
			http.tcp:close()
		else
			add(target.ready, http)
			self:dp(target, '+READY', '%s', http)
		end
	end

	return req
end

--global fetch ---------------------------------------------------------------

local cl
function fetch(...)
	cl = cl or http_client{
		max_conn_per_target = config'fetch_max_conn_per_target',
		client_ips          = config'fetch_client_ips',
		max_redirects       = config'fetch_max_redirects',
	}
	return cl:fetch(...)
end

if not ... then

local client = http_client()
run(function()
	local req = client:send_request_headers{
		host = 'echo.websocket.org', https = true, uri = '/', compress = true,
	}
	req:recv_response_headers()
	pr(req.status, req.response_headers)
	while 1 do
		local chunk, len, left = req:recv_response_body_chunk()
		pr('!!!', chunk, len, left)
		if not chunk then break end
		if len > 0 then
			pr(len)
			pr(str(chunk, len))
		end
	end
end)

end
