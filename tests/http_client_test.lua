require'glue'
require'http_client'
require'unit'
--logging.verbose = true
--logging.debug = true
--config('http_client_debug', 'protocol')

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v); rawset(t, #t+1, k)
end})

local _terr

local function sthread(f, name)
	local t = thread(f, name)
	onthreadfinish(t, function(th, ok, err)
		if not ok then _terr = _terr and (_terr..'\n'..tostring(err)) or tostring(err) end
	end)
	return t
end

local function checked_run(f)
	_terr = nil
	run(function(...)
		local ok, err = pcall(f, ...)
		if not ok then
			_terr = _terr and (_terr..'\n'..tostring(err)) or tostring(err)
		end
	end)
	if _terr then error(_terr, 2) end
end

local BASE = 'https://httpbingo.org'

-- GET /get -------------------------------------------------------------------

function test.get()
	checked_run(function()
		local body, req = fetch(BASE..'/get')
		assert(req.status == 200)
		assert(istab(body))
		assert(body.url == BASE..'/get')
	end)
end

-- POST /post -----------------------------------------------------------------

function test.post()
	checked_run(function()
		local body, req = fetch{url = BASE..'/post', body = 'hello', body_type = 'text/plain'}
		assert(req.status == 200)
		assert(body.data == 'hello')
	end)
end

-- POST /post JSON body -------------------------------------------------------

function test.post_json()
	checked_run(function()
		local body, req = fetch{url = BASE..'/post', body = {foo = 'bar'}}
		assert(req.status == 200)
		assert(body.json.foo == 'bar')
	end)
end

-- PUT /put -------------------------------------------------------------------

function test.put()
	checked_run(function()
		local body, req = fetch{url = BASE..'/put', method = 'PUT', body = 'data', body_type = 'text/plain'}
		assert(req.status == 200)
		assert(body.data == 'data')
	end)
end

-- PATCH /patch ---------------------------------------------------------------

function test.patch()
	checked_run(function()
		local body, req = fetch{url = BASE..'/patch', method = 'PATCH', body = 'pdata', body_type = 'text/plain'}
		assert(req.status == 200)
		assert(body.data == 'pdata')
	end)
end

-- DELETE /delete --------------------------------------------------------------

function test.delete()
	checked_run(function()
		local body, req = fetch{url = BASE..'/delete', method = 'DELETE'}
		assert(req.status == 200)
		assert(istab(body))
	end)
end

-- HEAD /head -----------------------------------------------------------------

function test.head()
	checked_run(function()
		local body, req = fetch{url = BASE..'/head', method = 'HEAD'}
		assert(req.status == 200)
		assert(body == '', 'HEAD response should have no body')
	end)
end

-- GET /status/:code ----------------------------------------------------------

function test.status_codes()
	checked_run(function()
		for _,code in ipairs{200, 201, 204, 400, 404, 500} do
			local body, req = fetch{url = BASE..'/status/'..code, compress = false}
			assert(req.status == code, 'expected '..code..' got '..req.status)
		end
	end)
end

-- GET /headers ---------------------------------------------------------------

function test.headers()
	checked_run(function()
		local body, req = fetch{url = BASE..'/headers',
			headers = {['x-custom-header'] = 'testvalue'}}
		assert(req.status == 200)
		assert(body.headers['X-Custom-Header'] and body.headers['X-Custom-Header'][1] == 'testvalue')
	end)
end

-- GET /gzip ------------------------------------------------------------------

function test.gzip()
	checked_run(function()
		local body, req = fetch{url = BASE..'/gzip', compress = true}
		assert(req.status == 200)
		assert(body.gzipped == true)
	end)
end

-- GET /deflate ---------------------------------------------------------------
-- NOTE: client only supports gzip, not deflate. /deflate returns
-- content-encoding: deflate which the client rejects. Skipped.


-- GET /redirect/:n -----------------------------------------------------------

function test.redirect()
	checked_run(function()
		local body, req = fetch(BASE..'/redirect/3')
		assert(req.status == 200)
		assert(body.url == BASE..'/get')
	end)
end

-- GET /cookies/set + /cookies ------------------------------------------------

function test.cookies()
	checked_run(function()
		local cl = http_client()
		-- set cookies via redirect to /cookies
		local body, req = cl:fetch(BASE..'/cookies/set?name=value&foo=bar')
		assert(req.status == 200)
		assert(body.cookies.name == 'value')
		assert(body.cookies.foo == 'bar')
		-- read cookies back
		local body2, req2 = cl:fetch(BASE..'/cookies')
		assert(req2.status == 200)
		assert(body2.cookies.name == 'value')
		assert(body2.cookies.foo == 'bar')
	end)
end

-- GET /cookies/delete --------------------------------------------------------

function test.cookies_delete()
	checked_run(function()
		local cl = http_client()
		cl:fetch(BASE..'/cookies/set?gone=here')
		cl:fetch(BASE..'/cookies/delete?gone=')
		local body, req = cl:fetch(BASE..'/cookies')
		assert(req.status == 200)
	end)
end

-- GET /response-headers ------------------------------------------------------

function test.response_headers()
	checked_run(function()
		local body, req = fetch(BASE..'/response-headers?x-test=hello')
		assert(req.status == 200)
		assert(req.response_headers['x-test'] == 'hello')
	end)
end

-- GET /delay/:n --------------------------------------------------------------

function test.delay()
	checked_run(function()
		local t0 = clock()
		local body, req = fetch{url = BASE..'/delay/1', headers_timeout = 10}
		assert(req.status == 200)
		assert(clock() - t0 >= 0.5)
	end)
end

-- GET /bytes/:n --------------------------------------------------------------

function test.bytes()
	checked_run(function()
		local body, req = fetch{url = BASE..'/bytes/1024', compress = false}
		assert(req.status == 200)
		assert(#body == 1024)
	end)
end

-- GET /stream-bytes/:n -------------------------------------------------------

function test.stream_bytes()
	checked_run(function()
		local body, req = fetch{url = BASE..'/stream-bytes/512', compress = false}
		assert(req.status == 200)
		assert(#body == 512)
	end)
end

-- GET /stream/:n -------------------------------------------------------------

function test.stream()
	checked_run(function()
		local body, req = fetch{url = BASE..'/stream/5', compress = false}
		assert(req.status == 200)
		assert(isstr(body))
		-- each line is a JSON object
		local n = 0
		for line in body:gmatch'[^\n]+' do n = n + 1 end
		assert(n == 5, 'expected 5 lines, got '..n)
	end)
end

-- GET /etag with If-None-Match -----------------------------------------------

function test.etag_match()
	checked_run(function()
		local body, req = fetch{url = BASE..'/etag/test-etag', compress = false,
			headers = {['if-none-match'] = '"test-etag"'}}
		assert(req.status == 304)
	end)
end

-- Custom user-agent ----------------------------------------------------------

function test.custom_user_agent()
	checked_run(function()
		local body, req = fetch{url = BASE..'/user-agent', user_agent = 'TestBot/1.0'}
		assert(req.status == 200)
		assert(body['user-agent'] == 'TestBot/1.0')
	end)
end

-- max_redirects exceeded ------------------------------------------------------

function test.max_redirects()
	checked_run(function()
		local ok, err = pcall(fetch, {url = BASE..'/redirect/5', max_redirects = 2})
		assert(not ok)
		assert(tostring(err):has'too many redirects')
	end)
end

-- 307 preserves method and body ----------------------------------------------

function test.redirect_307_preserves_body()
	checked_run(function()
		local dest = url_escape(BASE..'/post', '/:')
		local body, req = fetch{
			url = BASE..'/redirect-to?url='..dest..'&status_code=307',
			method = 'POST', body = 'kept', body_type = 'text/plain',
		}
		assert(req.status == 200)
		assert(body.data == 'kept')
	end)
end

-- 302 downgrades to GET (body dropped) ---------------------------------------

function test.redirect_302_drops_body()
	checked_run(function()
		local dest = url_escape(BASE..'/get', '/:')
		local body, req = fetch{
			url = BASE..'/redirect-to?url='..dest..'&status_code=302',
			method = 'POST', body = 'dropped', body_type = 'text/plain',
		}
		assert(req.status == 200)
		assert(body.method == 'GET')
	end)
end

-- Same-origin redirect preserves auth header ---------------------------------

function test.redirect_same_origin_keeps_auth()
	checked_run(function()
		local dest = url_escape(BASE..'/headers', '/:')
		local body, req = fetch{
			url = BASE..'/redirect-to?url='..dest,
			headers = {authorization = 'Bearer secret'},
		}
		assert(req.status == 200)
		assert(body.headers['Authorization'][1] == 'Bearer secret')
	end)
end

-- Cross-origin redirect strips auth header -----------------------------------

function test.redirect_cross_origin_strips_auth()
	checked_run(function()
		-- redirect to http:// (port 80) vs https:// (port 443) = different port
		local dest = url_escape('http://httpbingo.org/headers', '/:')
		local body, req = fetch{
			url = BASE..'/redirect-to?url='..dest,
			headers = {authorization = 'Bearer secret'},
		}
		assert(req.status == 200)
		local got_auth = body.headers['Authorization']
		assert(not got_auth, 'authorization header leaked cross-origin')
	end)
end

-- Connection close -----------------------------------------------------------

function test.connection_close()
	checked_run(function()
		local cl = http_client()
		local body, req = cl:fetch{url = BASE..'/get', close = true}
		assert(req.status == 200)
		assert(req.http.tcp:closed())
	end)
end

-- Connection pool: reuse (max_conn=1, sequential reuse) ----------------------

function test.pool_reuse()
	checked_run(function()
		local cl = http_client()
		local body1, req1 = cl:fetch{url = BASE..'/get', max_conn = 1}
		assert(req1.status == 200)
		local tcp1 = req1.http.tcp
		local body2, req2 = cl:fetch{url = BASE..'/get', max_conn = 1}
		assert(req2.status == 200)
		local tcp2 = req2.http.tcp
		assert(tcp1 == tcp2, 'connection was not reused')
	end)
end

-- Connection pool: wait when busy (max_conn=1, 2 concurrent) -----------------

function test.pool_wait()
	checked_run(function()
		local cl = http_client()
		local ts = threadset()
		local t0 = clock()
		for i = 1, 2 do
			resume(ts:thread(function()
				local body, req = cl:fetch{
					url = BASE..'/delay/1',
					max_conn = 1,
					headers_timeout = 10,
					wait_timeout = 30,
				}
				assert(req.status == 200)
			end, 'pool-wait-'..i))
		end
		local all_ok, rets = ts:join()
		assert(all_ok, tostring(rets))
		local elapsed = clock() - t0
		-- with max_conn=1, requests run sequentially: ~2s, not ~1s
		assert(elapsed >= 1.5, 'expected sequential execution, got '..elapsed..'s')
	end)
end

-- Connection pool: timeout when wait queue full ------------------------------

function test.pool_waitlist_full()
	checked_run(function()
		local cl = http_client()
		local ts = threadset()
		local ok_count = 0
		local fail_count = 0
		-- 1 connection allowed, 0 waiters allowed, 3 concurrent requests
		for i = 1, 3 do
			resume(ts:thread(function()
				local body, req = cl:fetch{
					url = BASE..'/delay/1',
					max_conn = 1,
					max_waiting_threads = 0,
					headers_timeout = 10,
				}
				assert(req.status == 200)
				ok_count = ok_count + 1
			end, 'pool-full-'..i))
		end
		local all_ok, rets = ts:join()
		for _,ret in ipairs(rets) do
			if not ret.ok then
				fail_count = fail_count + 1
			end
		end
		assert(ok_count >= 1, 'at least one request should succeed')
		assert(fail_count >= 1, 'at least one request should fail from pool limit')
	end)
end

-- 308 preserves method and body ----------------------------------------------

function test.redirect_308_preserves_body()
	checked_run(function()
		local dest = url_escape(BASE..'/post', '/:')
		local body, req = fetch{
			url = BASE..'/redirect-to?url='..dest..'&status_code=308',
			method = 'POST', body = 'kept308', body_type = 'text/plain',
		}
		assert(req.status == 200)
		assert(body.data == 'kept308')
	end)
end

-- 301 downgrades to GET ------------------------------------------------------

function test.redirect_301_to_get()
	checked_run(function()
		local dest = url_escape(BASE..'/get', '/:')
		local body, req = fetch{
			url = BASE..'/redirect-to?url='..dest..'&status_code=301',
			method = 'POST', body = 'dropped', body_type = 'text/plain',
		}
		assert(req.status == 200)
		assert(body.method == 'GET')
	end)
end

-- 303 downgrades to GET ------------------------------------------------------

function test.redirect_303_to_get()
	checked_run(function()
		local dest = url_escape(BASE..'/get', '/:')
		local body, req = fetch{
			url = BASE..'/redirect-to?url='..dest..'&status_code=303',
			method = 'POST', body = 'dropped', body_type = 'text/plain',
		}
		assert(req.status == 200)
		assert(body.method == 'GET')
	end)
end

-- fetch(url, body) two-arg shorthand -----------------------------------------

function test.fetch_url_body_shorthand()
	checked_run(function()
		local body, req = fetch(BASE..'/post', {msg = 'shorthand'})
		assert(req.status == 200)
		assert(body.json.msg == 'shorthand')
	end)
end

-- Cookie: store and retrieve with mock requests ------------------------------

function test.cookie_store_get()
	checked_run(function()
		local cl = http_client()
		local target = {host = 'example.com', client_ip = nil}

		-- store a cookie
		cl:store_cookies{
			target = target, uri = '/app/page',
			response_headers = {
				['set-cookie'] = {'sid=abc123; Path=/app'},
			},
		}

		-- retrieve it for matching path
		local cookies = cl:get_cookies{target = target, uri = '/app/data', secure = true}
		assert(cookies.sid == 'abc123', 'cookie not found')

		-- not returned for non-matching path
		local cookies2 = cl:get_cookies{target = target, uri = '/other', secure = true}
		assert(not cookies2.sid, 'cookie should not match /other')
	end)
end

-- Cookie: path matching rules ------------------------------------------------

function test.cookie_path_matching()
	checked_run(function()
		local cl = http_client()
		local target = {host = 'example.com', client_ip = nil}

		cl:store_cookies{
			target = target, uri = '/a/b/c',
			response_headers = {
				['set-cookie'] = {'x=1; Path=/a'},
			},
		}

		-- exact match
		local c = cl:get_cookies{target = target, uri = '/a', secure = true}
		assert(c.x == '1', 'exact path match failed')

		-- prefix with /
		local c2 = cl:get_cookies{target = target, uri = '/a/b', secure = true}
		assert(c2.x == '1', 'prefix path match failed')

		-- no match
		local c3 = cl:get_cookies{target = target, uri = '/ab', secure = true}
		assert(not c3.x, '/ab should not match /a')
	end)
end

-- Cookie: default path from request URI -------------------------------------

function test.cookie_default_path()
	checked_run(function()
		local cl = http_client()
		local target = {host = 'example.com', client_ip = nil}

		-- no Path attr -> default path is /foo/ (from /foo/bar)
		cl:store_cookies{
			target = target, uri = '/foo/bar',
			response_headers = {
				['set-cookie'] = {'tok=v1'},
			},
		}

		-- should match /foo/anything
		local c = cl:get_cookies{target = target, uri = '/foo/other', secure = true}
		assert(c.tok == 'v1', 'default path should be /foo/')

		-- should NOT match /baz
		local c2 = cl:get_cookies{target = target, uri = '/baz', secure = true}
		assert(not c2.tok, 'should not match /baz')
	end)
end

-- Cookie: secure flag only sent over HTTPS -----------------------------------

function test.cookie_secure_flag()
	checked_run(function()
		local cl = http_client()
		local target = {host = 'example.com', client_ip = nil}

		cl:store_cookies{
			target = target, uri = '/',
			response_headers = {
				['set-cookie'] = {'sec=yes; Path=/; Secure'},
			},
		}

		-- returned over HTTPS
		local c = cl:get_cookies{target = target, uri = '/', secure = true}
		assert(c.sec == 'yes', 'secure cookie should be sent over HTTPS')

		-- NOT returned over HTTP
		local c2 = cl:get_cookies{target = target, uri = '/', secure = false}
		assert(not c2.sec, 'secure cookie must not be sent over HTTP')
	end)
end

-- Cookie: domain matching (wildcard) -----------------------------------------

function test.cookie_domain_matching()
	checked_run(function()
		local cl = http_client()

		-- set cookie with Domain=example.com from sub.example.com
		local target_sub = {host = 'sub.example.com', client_ip = nil}
		cl:store_cookies{
			target = target_sub, uri = '/',
			response_headers = {
				['set-cookie'] = {'d=1; Path=/; Domain=example.com'},
			},
		}

		-- should be sent to other.example.com (wildcard)
		local target_other = {host = 'other.example.com', client_ip = nil}
		local c = cl:get_cookies{target = target_other, uri = '/', secure = true}
		assert(c.d == '1', 'wildcard domain cookie not sent to sibling subdomain')

		-- should be sent to example.com itself
		local target_apex = {host = 'example.com', client_ip = nil}
		local c2 = cl:get_cookies{target = target_apex, uri = '/', secure = true}
		assert(c2.d == '1', 'wildcard domain cookie not sent to apex')
	end)
end

-- Cookie: exact-host cookie not sent to subdomains ---------------------------

function test.cookie_exact_host()
	checked_run(function()
		local cl = http_client()

		-- set cookie WITHOUT Domain attr from example.com
		local target = {host = 'example.com', client_ip = nil}
		cl:store_cookies{
			target = target, uri = '/',
			response_headers = {
				['set-cookie'] = {'h=exact; Path=/'},
			},
		}

		-- should be sent to example.com
		local c = cl:get_cookies{target = target, uri = '/', secure = true}
		assert(c.h == 'exact', 'exact-host cookie not sent to same host')

		-- should NOT be sent to sub.example.com
		local target_sub = {host = 'sub.example.com', client_ip = nil}
		local c2 = cl:get_cookies{target = target_sub, uri = '/', secure = true}
		assert(not c2.h, 'exact-host cookie leaked to subdomain')
	end)
end

-- Cookie: expired via max-age=0 is removed -----------------------------------

function test.cookie_expiry()
	checked_run(function()
		local cl = http_client()
		local target = {host = 'example.com', client_ip = nil}

		-- set a cookie
		cl:store_cookies{
			target = target, uri = '/',
			response_headers = {
				['set-cookie'] = {'gone=yes; Path=/'},
			},
		}
		local c = cl:get_cookies{target = target, uri = '/', secure = true}
		assert(c.gone == 'yes')

		-- expire it with max-age=0
		cl:store_cookies{
			target = target, uri = '/',
			response_headers = {
				['set-cookie'] = {'gone=; Path=/; Max-Age=0'},
			},
		}
		local c2 = cl:get_cookies{target = target, uri = '/', secure = true}
		assert(not c2.gone, 'expired cookie still present')
	end)
end

-- runner ---------------------------------------------------------------------

local name = ...
if name == 'http_client_test' then name = nil end
local tests_to_run = name and {name} or test
local n_ok, n_fail = 0, 0
for _, k in ipairs(tests_to_run) do
	if type(k) == 'string' then
		io.write('test.'..k..' ... ')
		io.flush()
		local ok, err = xpcall(test[k], debug.traceback)
		if ok then
			print'ok'
			n_ok = n_ok + 1
		else
			pr('FAILED: ', k)
			pr(err)
			n_fail = n_fail + 1
			break
		end
	end
end
print(('ok: %d, failed: %d'):format(n_ok, n_fail))
