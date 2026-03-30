function http:cookie_domain_matches_request_host(domain, host)
	return not domain or domain == host
		or (host:ends('.'..domain) and not (is_ipv4(host) or is_ipv6(host)))
end

function http:cookie_default_path(uri)
	return '/' --TODO
end

--cookie path matches request path exactly, or
--cookie path ends in `/` and is a prefix of the request path, or
--cookie path is a prefix of the request path, and the first
--character of the request path that is not included in the cookie path is `/`.
function http:cookie_path_matches_request_path(cpath, path)
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



function client:can_connect_now(target)
	local can = self.conn_count < self.max_conn
	if can and target then
		can = target.conn_count < (target.max_conn or self.max_conn_per_target)
	end
	self:dp(target, '?CAN_CO', '%s', can)
	return can
end

function client:get_conn(target)
	local http = remove(target.ready, 1)
	if http then
		self:dp(target, '-READY', '%s', http)
		return http
	else
		if not self:can_connect_now(target) then
			add(self.wait_conn_queue, currentthread())
			add(self.wait_conn_queue, target)
			self:dp(target, '+WAIT_CO', '%s Q: %d', thread, #self.wait_conn_queue / 2)
			assert(suspend() == 'connect')
			self:dp(target, '+WAIT_CO', '%s Q: %d', thread, #self.wait_conn_queue / 2)
		end

		if not ok then return nil, err end
	end
end

function client:resume_next_wait_conn_thread()
	local target = remove(self.wait_conn_queue, 1)
	local thread = remove(self.wait_conn_queue, 1)
	if not target then return end
	resume(thread, 'connect')
end

--redirects ------------------------------------------------------------------

function client:redirect_request_args(t, req, res)
	local location = assert(req.redirect_location, 'no location')
	local loc = url_parse(location)
	local uri = url_format{
		path = loc.path,
		query = loc.query,
		fragment = loc.fragment,
	}
	local https = loc.scheme == 'https' or nil
	local port = loc.port or (not loc.host and t.port) or nil
	local host = loc.host or t.host
	if port then host = host..':'..port end
	return {
		method = 'GET',
		close = t.close,
		host = host,
		https = https,
		uri = uri,
		compress = t.compress,
		headers = merge({['content-type'] = false}, t.headers),
		redirect_count = (t.redirect_count or 0) + 1,
		connect_timeout = t.connect_timeout,
		request_timeout = t.request_timeout,
		respone_timeout = t.response_timeout,
		debug = t.debug or self.debug,
	}
end

--cookie management ----------------------------------------------------------

function client:accept_cookie(cookie, host, http)
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
	local cookies = req.response_headers['set-cookie']
	if not cookies then return end
	local time = time()
	local client_jar = self:cookie_jar(target.client_ip)
	local host = target.host
	for _,cookie in ipairs(cookies) do
		if self:accept_cookie(cookie, host, req.http) then
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
		add(names, s)
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
	return save(file, pp(self.cookies))
end

function client:load_cookies(file)
	local s, err = try_load(file)
	if not s then return nil, err end
	local t, err = try_eval(s)
	if not t then return nil, err end
	self.cookies = t
end

--request call ---------------------------------------------------------------

local function req_dp(req, event, fmt, ...)
	if logging.filter[''] then return end
	local dt = clock() - req.start_time
	local s = fmt and _(fmt, logargs(...)) or ''
	log('', 'htcl', event, '%-4s %4dms %s', req.tcp, dt * 1000, s)
end

function client:try_send_request_headers(opt)

	local target = self:target(opt)

	self:dp(target, '+RQ')

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

	local cookies = self:get_cookies(target.client_ip, target.host,
		req.uri, target.https)

	local ok, err = http:try_send_request_headers(req, cookies)
	if not ok then return nil, err end

	function req:try_send_request_body_chunk()
		http:try_send_request_body_chunk(self)
	end

	function req:try_recv_response_headers()
		http:recv_response_headers(req)
		self:store_cookies(target, req)
		if req.redirect_location then
			local t = self:redirect_request_args(t, req)
			local max_redirects = self.max_redirects or self.client.max_redirects
			if t.redirect_count >= max_redirects then
				return nil, 'too many redirects', req
			end
			self:try_recv_request_body()
			local ok, err = self:try_send_request_headers(t)
			return self:try_recv_response_headers()
		end
	end

	function req:try_recv_response_body_chunk()

		local chunk, len, left = http:try_recv_response_body_chunk(self)

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

--hi-level API: fetch --------------------------------------------------------

--opt | url,[body]
function client:fetch(arg1, body)

	local opt = istab(arg1) and arg1 or empty
	body = body or opt.body

	local headers = {}

	if body ~= nil and not isstr(body) then
		body = json_encode(body)
		headers['content-type'] = 'application/json'
	end
	if body then
		headers['content-length'] = #body
	end

	local url = isstr(arg1) and arg1 or opt.url
	local u = url and url_parse(url)

	local opt = update({
		host = u and u.host,
		uri = u and u.path,
		https = u and u.scheme == 'https' or not u and opt.https ~= false,
		method = body and 'POST',
		body = body,
	}, opt)
	opt.headers = update(headers, opt.headers)

	local req, err = self:try_send_request_headers(opt)
	if not req then return nil, err end

	if body then
		local ok, err = req:try_send_request_body(body)
		if not ok then return nil, err end
	end

	local ok, err = req:try_recv_response_headers()
	if not ok then return nil, err end

	local ok, err = req:try_recv_response_body()
	if not ok then return nil, err end

	local ct = req.response_headers['content-type']
	if ct and ct.media_type == 'application/json' then
		req.response = json_decode(req.response)
		--if the entire resonse is the json value "null", then return null
		--because nil is for errors.
		req.response = repl(req.response, nil, null)
	end

	return req.response, req
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
