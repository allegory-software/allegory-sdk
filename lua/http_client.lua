--[=[

	Async http(s) downloader.
	Written by Cosmin Apreutesei. Public Domain.

	Features https, gzip compression, persistent connections, pipelining,
	multiple client IPs, resource limits, auto-redirects, auto-retries,
	cookie jars, multi-level debugging, caching, cdata-buffer-based I/O.
	In short, your dream library for web scraping.

	http_client(opt) -> client           create a client object
	client:request(opt) -> req, res      make a HTTP request
	client:close_all()                   close all connections
	getpage(...) -> ...                  perform a http request on a static client

http_client(opt) -> client

		max_conn                limit the number of total connections
		max_conn_per_target     limit the number of connections per target
		max_pipelined_requests  limit the number of pipelined requests
		client_ips              a list of client IPs to assign to requests
		max_retries             number of retries before giving up
		max_redirects           number of redirects before giving up
		debug                   true to enable client-level debugging
		tls_options             options to pass to sock_libtls

	NOTE: A target is a combination of (vhost, port, client_ip) on which
	one or more HTTP connections can be created subject to per-target limits.

	### Pipelined requests

	A pipelined request is a request that is sent in advance of receiving the
	response for the previous request. Most HTTP servers accept these but
	in a limited number. Browsers don't have them though so if you use them
	you'll look like the robot that you really are to the servers.

	Spawning a new connection for a new request has a lot more initial latency
	than pipelining the request on an existing connection. On the other hand,
	pipelined responses come serialized and also the server might decide not
	to start processing pipelined requests as soon as they arrive because it
	would have to buffer the results before it can start sending them.

client:request(opt) -> req, res

	Make a HTTP request. This must be called from a scheduled socket thread.

		connection options...     options to pass to `http()`
		request options...        options to pass to `http:make_request()`
		client_ip                 client ip to bind to (optional)
		connect_timeout           connect timeout (optional)
		request_timeout           timeout for the request part (optional)
		reply_timeout             timeout for the reply part (optional)

client:close_all()

	Close all connections. This must be called after the socket loop finishes.

]=]

if not ... then require'http_client_test'; return end

require'glue'
require'json'
require'url'
require'sock'
require'sock_libtls'
require'gzip'
require'fs'
require'resolver'
require'http'

local pull = function(t)
	return remove(t, 1)
end

local client = {
	type = 'http_client', http = http,
	max_conn = 50,
	max_conn_per_target = 20,
	max_pipelined_requests = 10,
	client_ips = {},
	max_redirects = 20,
	max_cookie_length = 8192,
	max_cookies = 1e6,
	max_cookies_per_host = 1000,
	tls_options = {
		ca_file = ca_file_path,
	},
}

--targets --------------------------------------------------------------------

--A target is a combination of (vhost, port, client_ip) on which one or more
--HTTP connections can be created subject to per-target limits.

function client:assign_client_ip(host, port)
	if #self.client_ips == 0 then
		return nil
	end
	local ci = self.last_client_ip_index(host, port)
	local i = (ci.index or 0)
	if i > #self.client_ips then i = 1 end
	ci.index = i
	return self.client_ips[i]
end

function client:target(t) --t is request options
	local host = assert(t.host, 'host missing'):lower()
	local https = t.https and true or false
	local port = t.port and assert(tonumber(t.port), 'invalid port')
		or (https and 443 or 80)
	local client_ip = t.client_ip or self:assign_client_ip(host, port)
	local target = self.targets(host, port, client_ip)
	if not target.type then
		target.type = 'http_target'
		target.debug_prefix = '@'
		target.host = host
		target.client_ip = client_ip
		target.connect_timeout = t.connect_timeout
		target.http_args = {
			target = target,
			host = host,
			port = port,
			client_ip = client_ip,
			https = https,
			max_line_size = t.max_line_size,
			debug = t.debug or self.debug,
		}
		target.max_pipelined_requests = t.max_pipelined_requests
		target.max_conn = t.max_conn_per_target
		target.max_redirects = t.max_redirects
	end
	return target
end

--connections ----------------------------------------------------------------

function client:inc_conn_count(target, n)
	n = n or 1
	self.conn_count = (self.conn_count or 0) + n
	target.conn_count = (target.conn_count or 0) + n
	self:dp(target, (n > 0 and '+' or '-')..'CO', '%s=%d, total=%d',
		target, target.conn_count, self.conn_count)
end

function client:dec_conn_count(target)
	self:inc_conn_count(target, -1)
end

function client:push_ready_conn(target, http)
	push(attr(target, 'ready'), http)
	self:dp(target, '+READY', '%s', http)
end

function client:pull_ready_conn(target)
	local http = target.ready and pull(target.ready)
	if not http then return end
	self:dp(target, '-READY', '%s', http)
	return http
end

function client:push_wait_conn_thread(thread, target)
	local queue = attr(self, 'wait_conn_queue')
	push(queue, {thread, target})
	self:dp(target, '+WAIT_CO', '%s %s Q: %d', thread, target, #queue)
end

function client:pull_wait_conn_thread()
	local queue = self.wait_conn_queue
	local t = queue and pull(queue)
	if not t then return end
	local thread, target = t[1], t[2]
	self:dp(target, '-WAIT_CO', '%s Q: %d', thread, #queue)
	return thread, target
end

function client:pull_matching_wait_conn_thread(target)
	local queue = self.wait_conn_queue
	if not queue then return end
	for i,t in ipairs(queue) do
		if t[2] == target then
			table.remove(queue, i)
			local thread = t[1]
			self:dp(target, '-WAIT_CO', '%s: %s Q: %d', target, thread, #queue)
			return thread
		end
	end
end

function client:_can_connect_now(target)
	if (self.conn_count or 0) >= self.max_conn then return false end
	if target then
		local target_conn_count = target.conn_count or 0
		local target_max_conn = target.max_conn or self.max_conn_per_target
		if target_conn_count >= target_max_conn then return false end
	end
	return true
end
function client:can_connect_now(target)
	local can = self:_can_connect_now(target)
	self:dp(target, '?CAN_CO', '%s', can)
	return can
end

function client:stcp_options(host, port)
	if not self._tls_config then
		local t = {}
		for k,v in pairs(self.tls_options) do
			t[k] = call(v, self, k)
		end
		self._tls_config = tls_config(t)
	end
	return self._tls_config
end

function client:connect_now(target)
	local host, port, client_ip = target()
	local tcp = tcp()
	if client_ip then
		local ok, err = tcp:bind(client_ip)
		if not ok then return nil, err end
	end
	self:inc_conn_count(target)
	local dt = target.connect_timeout
	local expires = dt and clock() + dt or nil
	local ip, err = try_resolve(host)
	if not ip then
		return nil, 'lookup failed for "'..host..'": '..tostring(err)
	end
	local ok, err = tcp:connect(ip, port, expires)
	self:dp(target, '+CO', '%s %s', tcp, err or '')
	if not ok then
		self:dec_conn_count(target)
		return nil, err
	end
	local function pass(closed, ...)
		if not closed then
			self:dp(target, '-CO', '%s', tcp)
			self:dec_conn_count(target)
			self:resume_next_wait_conn_thread()
		end
		return ...
	end
	override(tcp, 'close', function(inherited, tcp, ...)
		return pass(tcp:closed(), inherited(tcp, ...))
	end)
	if target.http_args.https then
		local stcp, err = client_stcp(tcp, host, self:stcp_options(host, port))
		self:dp(target, ' TLS', '%s %s %s', stcp, http, err or '')
		if not stcp then
			return nil, err
		end
		tcp = stcp
	end
	target.http_args.f = tcp
	local http = http(target.http_args)
	self:dp(target, ' BIND', '%s %s', tcp, http)
	return http
end

function client:wait_conn(target)
	local thread = currentthread()
	self:push_wait_conn_thread(thread, target)
	local http = suspend()
	if http == 'connect' then
		return self:connect_now(target)
	else
		return http
	end
end

function client:get_conn(target)
	local http, err = self:pull_ready_conn(target)
	if http then return http end
	if self:can_connect_now(target) then
		return self:connect_now(target)
	else
		return self:wait_conn(target)
	end
end

function client:resume_next_wait_conn_thread()
	local thread, target = self:pull_wait_conn_thread()
	if not thread then return end
	self:dp(target, '^WAIT_CO', '%s', thread)
	resume(thread, 'connect')
end

function client:resume_matching_wait_conn_thread(target, http)
	local thread = self:pull_matching_wait_conn_thread(target)
	if not thread then return end
	self:dp(target, '^WAIT_CO', '%s < %s', thread, http)
	resume(thread, http)
	return true
end

function client:can_pipeline_new_requests(http, target, req)
	local close = req.close
	local pr_count = http.wait_response_threads and #http.wait_response_threads or 0
	local max_pr = target.max_pipelined_requests or self.max_pipelined_requests
	local can = not close and pr_count < max_pr
	self:dp(target, '?CAN_PIPE', '%s (wait: %d, close: %s)', can, pr_count, close)
	return can
end

--pipelining -----------------------------------------------------------------

function client:push_wait_response_thread(http, thread, target)
	push(attr(http, 'wait_response_threads'), thread)
	self:dp(target, '+WAIT_RS', 'wait: %d', #http.wait_response_threads)
end

function client:pull_wait_response_thread(http, target)
	local queue = http.wait_response_threads
	local thread = queue and pull(queue)
	if not thread then return end
	self:dp(target, '-WAIT_RS', 'wait: %d', #queue)
	return thread
end

function client:read_response_now(http, req)
	http.reading_response = true
	self:dp(http.target, '+READ_RS', '%s.%s.%s', http.target, http, req)
	local res, err = http:read_response(req)
	self:dp(http.target, '-READ_RS', '%s.%s.%s %s', http.target, http, req, err or '')
	http.reading_response = false
	return res, err
end

--redirects ------------------------------------------------------------------

function client:redirect_request_args(t, req, res)
	local location = assert(res.redirect_location, 'no location')
	local loc = url_parse(location)
	local uri = url_format{
		path = loc.path,
		query = loc.query,
		fragment = loc.fragment,
	}
	local https = loc.scheme == 'https' or nil
	return {
		http_version = res.http_version,
		method = 'GET',
		close = t.close,
		host = loc.host or t.host,
		port = loc.port or (not loc.host and t.port or nil) or nil,
		https = https,
		uri = uri,
		compress = t.compress,
		headers = merge({['content-type'] = false}, t.headers),
		receive_content = res.receive_content,
		redirect_count = (t.redirect_count or 0) + 1,
		connect_timeout = t.connect_timeout,
		request_timeout = t.request_timeout,
		reply_timeout   = t.reply_timeout,
		debug = t.debug or self.debug,
	}
end

--cookie management ----------------------------------------------------------

function client:accept_cookie(cookie, host)
	return http:cookie_domain_matches_request_host(cookie.domain, host)
end

function client:cookie_jar(ip)
	return attr(attr(self, 'cookies'), ip or '*')
end

function client:remove_cookie(jar, domain, path, name)
	--
end

function client:clear_cookies(client_ip, host)
	--
end

function client:store_cookies(target, req, res)
	local cookies = res.headers['set-cookie']
	if not cookies then return end
	local time = time()
	local client_jar = self:cookie_jar(target.client_ip)
	local host = target.host
	for _,cookie in ipairs(cookies) do
		if self:accept_cookie(cookie, host) then
			local expires
			if cookie.expires then
				expires = cookie.expires
			elseif cookie['max-age'] then
				expires = time + cookie['max-age']
			end
			local domain = cookie.domain or host
			local path = cookie.path or http:cookie_default_path(req.uri)
			if expires and expires < time then --expired: remove from jar.
				self:remove_cookie(client_jar, domain, path, cookie.name)
			else
				local sc = attr(attr(attr(client_jar, domain), path), cookie.name)
				sc.wildcard = cookie.domain and true or false
				sc.secure = cookie.secure
				sc.expires = expires
				sc.value = cookie.value
			end
		end
	end
end

function client:get_cookies(client_ip, host, uri, https)
	local client_jar = self:cookie_jar(client_ip)
	if not client_jar then return end
	local path = uri:match'^[^%?#]+'
	local time = time()
	local cookies = {}
	local names = {}
	for s in host:gmatch'[^%.]+' do
		push(names, s)
	end
	local domain = names[#names]
	for i = #names-1, 1, -1 do
		domain = names[i] .. '.' .. domain
		local domain_jar = client_jar[domain]
		if domain_jar then
			for cpath, path_jar in pairs(domain_jar) do
				if http:cookie_path_matches_request_path(cpath, path) then
					for name, sc in pairs(path_jar) do
						if sc.expires and sc.expires < time then --expired: auto-clean.
							self:remove_cookie(client_jar, domain, cpath, sc.name)
						elseif https or not sc.secure then --allow
							cookies[name] = sc.value
						end
					end
				end
			end
		end
	end
	return cookies
end

function client:save_cookies(file)
	return pp_save(file, self.cookies)
end

function client:load_cookies(file)
	local s, err = try_load(file)
	if not s then return nil, err end
	local t, err = try_eval(s)
	if not t then return nil, err end
	self.cookies = t
end

--request call ---------------------------------------------------------------

function client:request(t)

	local target = self:target(t)

	self:dp(target, '+RQ', '%s = %s', target, tostring(target))

	local http, err = self:get_conn(target)
	if not http then return nil, err end

	local cookies = self:get_cookies(target.client_ip, target.host,
		t.uri or '/', target.http_args.https)

	local req = http:build_request(t, cookies)

	self:dp(target, '+SEND_RQ', '%s.%s.%s %s %s',
		target, http, req, req.method, req.uri)

	local ok, err = http:send_request(req)
	if not ok then return nil, err, req end

	self:dp(target, '-SEND_RQ', '%s.%s.%s', target, http, req)

	local waiting_response
	if http.reading_response then
		self:push_wait_response_thread(http, currentthread(), target)
		waiting_response = true
	else
		http.reading_response = true
	end

	local taken
	if self:can_pipeline_new_requests(http, target, req) then
		taken = true
		if not self:resume_matching_wait_conn_thread(target, http) then
			self:push_ready_conn(target, http)
		end
	end

	if waiting_response then
		suspend()
	end

	local res, err = self:read_response_now(http, req)
	if not res then return nil, err, req end

	self:store_cookies(target, req, res)

	if not taken and not http.closed then
		if not self:resume_matching_wait_conn_thread(target, http) then
			self:push_ready_conn(target, http)
		end
	end

	if not http.closed then
		local thread = self:pull_wait_response_thread(http, target)
		if thread then
			resume(thread)
		end
	end

	self:dp(target, '-RQ', '%s.%s.%s body: %d bytes',
		target, http, req,
		res and isstr(res.content) and #res.content or 0)

	if res and res.redirect_location then
		local t = self:redirect_request_args(t, req, res)
		local max_redirects = target.max_redirects or self.max_redirects
		if t.redirect_count >= max_redirects then
			return nil, 'too many redirects', req, res
		end
		return self:request(t)
	end

	return res, true, req
end

--hi-level API: getpage ------------------------------------------------------

function client:getpage(arg1, upload, receive_content)

	local opt = istab(arg1) and arg1 or empty
	upload = upload or opt.upload
	receive_content = receive_content or opt.receive_content

	local headers = {}
	if upload ~= nil and not isstr(upload) then
		upload = json_encode(upload)
		headers['content-type'] = 'application/json'
	end

	local url = isstr(arg1) and arg1 or opt.url
	local u = url and url_parse(url)

	local opt = update({
		host = u and u.host,
		uri = u and u.path,
		https = u and u.scheme == 'https' or not u and opt.https ~= false,
		method = upload and 'POST',
		content = upload,
		receive_content = receive_content or 'string',
	}, opt)
	opt.headers = update(headers, opt.headers)

	local res, err, req = self:request(opt)

	if not res then
		return nil, err, req
	end
	local ct = res.headers['content-type']
	if ct and ct.media_type == 'application/json' then
		res.rawcontent = res.content
		res.content = repl(json_decode(res.content), nil, null)
	end
	return res.content, res, req
end

--instantiation --------------------------------------------------------------

function client:log(target, severity, module, event, fmt, ...)
	if logging.filter[severity] then return end
	local s = fmt and _(fmt, logargs(...)) or ''
	log(severity, module, event, '%-4s %s', target or '', s)
end

function client:dp(target, ...)
	return self:log(target, '', 'htcl', ...)
end

function http_client(t)

	local self = object(client, {}, t)

	self.last_client_ip_index = tuples(2)
	self.targets = tuples(3)
	self.cookies = {}

	if self.debug and self.debug.sched then
		local function pass(target, rc, ...)
			self:dp(target, '', ('<'):rep(1+rc)..('-'):rep(30-rc))
			return ...
		end
		override(self, 'request', function(inherited, self, t, ...)
			local rc = t.redirect_count or 0
			local target = self:target(t)
			self:dp(target, '', ('>'):rep(1+rc)..('-'):rep(30-rc))
			return pass(target, rc, inherited(self, t, ...))
		end)
	else
		self.dp = noop
	end

	return self
end

--global getpage -------------------------------------------------------------

local cl
function getpage(...)
	cl = cl or http_client{
		max_conn               = config'getpage_max_conn',
		max_conn_per_target    = config'getpage_max_conn_per_target',
		max_pipelined_requests = config'getpage_max_pipelined_requests',
		client_ips             = config'getpage_client_ips',
		max_redirects          = config'getpage_max_redirects',
		debug = config'getpage_debug' and index(collect(words(config'getpage_debug'))),
	}
	return cl:getpage(...)
end

function update_ca_file()
	local file = config'ca_file' or varpath'cacert.pem'
	local s, err = getpage{
		url = 'https://curl.haxx.se/ca/cacert.pem',
	}
	assert(s, err)
	save(file, s)
end
