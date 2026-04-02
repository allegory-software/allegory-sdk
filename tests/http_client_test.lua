require'glue'
require'http_client'
require'base64'
require'unit'
logging.verbose = true
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
	end)
end

-- GET /anything --------------------------------------------------------------

function test.anything()
	checked_run(function()
		local body, req = fetch{url = BASE..'/anything/test', method = 'GET'}
		assert(req.status == 200)
		assert(body.url:has'/anything/test')
		assert(body.method == 'GET')
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

-- GET /ip --------------------------------------------------------------------

function test.ip()
	checked_run(function()
		local body, req = fetch(BASE..'/ip')
		assert(req.status == 200)
		assert(body.origin)
	end)
end

-- GET /user-agent ------------------------------------------------------------

function test.user_agent()
	checked_run(function()
		local body, req = fetch(BASE..'/user-agent')
		assert(req.status == 200)
		assert(body['user-agent']:has'Mozilla')
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

-- GET /redirect-to -----------------------------------------------------------

function test.redirect_to()
	checked_run(function()
		local body, req = fetch(BASE..'/redirect-to?url='..url_escape(BASE..'/get', '/:'))
		assert(req.status == 200)
		assert(body.url == BASE..'/get')
	end)
end

-- GET /absolute-redirect/:n --------------------------------------------------

function test.absolute_redirect()
	checked_run(function()
		local body, req = fetch(BASE..'/absolute-redirect/2')
		assert(req.status == 200)
	end)
end

-- GET /relative-redirect/:n --------------------------------------------------

function test.relative_redirect()
	checked_run(function()
		local body, req = fetch(BASE..'/relative-redirect/2')
		assert(req.status == 200)
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

-- GET /basic-auth/:user/:password --------------------------------------------

function test.basic_auth()
	checked_run(function()
		local cred = base64_encode('user:pass')
		local body, req = fetch{url = BASE..'/basic-auth/user/pass',
			headers = {authorization = 'Basic '..cred}}
		assert(req.status == 200)
		assert(body.authorized == true)
		assert(body.user == 'user')
	end)
end

-- GET /basic-auth without credentials (expect 401) ---------------------------

function test.basic_auth_fail()
	checked_run(function()
		local body, req = fetch{url = BASE..'/basic-auth/user/pass', compress = false}
		assert(req.status == 401)
	end)
end

-- GET /bearer ----------------------------------------------------------------

function test.bearer()
	checked_run(function()
		local body, req = fetch{url = BASE..'/bearer',
			headers = {authorization = 'Bearer mytoken123'}}
		assert(req.status == 200)
		assert(body.authenticated == true)
		assert(body.token == 'mytoken123')
	end)
end

-- GET /bearer without token (expect 401) ------------------------------------

function test.bearer_fail()
	checked_run(function()
		local body, req = fetch{url = BASE..'/bearer', compress = false}
		assert(req.status == 401)
	end)
end

-- GET /hidden-basic-auth/:user/:password (expect 404) -----------------------

function test.hidden_basic_auth()
	checked_run(function()
		local body, req = fetch{url = BASE..'/hidden-basic-auth/user/pass', compress = false}
		assert(req.status == 404)
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

-- GET /drip -------------------------------------------------------------------

function test.drip()
	checked_run(function()
		local body, req = fetch{
			url = BASE..'/drip?numbytes=5&duration=0&delay=0&code=200',
			compress = false, headers_timeout = 10,
		}
		assert(req.status == 200)
		assert(#body == 5)
	end)
end

-- GET /range/:n --------------------------------------------------------------

function test.range()
	checked_run(function()
		local body, req = fetch{url = BASE..'/range/128', compress = false}
		assert(req.status == 200)
		assert(#body == 128)
	end)
end

-- GET /range with Range header -----------------------------------------------

function test.range_partial()
	checked_run(function()
		local body, req = fetch{url = BASE..'/range/128', compress = false,
			headers = {range = 'bytes=0-9'}}
		assert(req.status == 206)
		assert(#body == 10)
	end)
end

-- GET /cache (no headers -> 200) ---------------------------------------------

function test.cache()
	checked_run(function()
		local body, req = fetch(BASE..'/cache')
		assert(req.status == 200)
	end)
end

-- GET /cache with If-None-Match -> 304 ---------------------------------------

function test.cache_304()
	checked_run(function()
		local body, req = fetch{url = BASE..'/cache',
			headers = {['if-none-match'] = '"anything"'}, compress = false}
		assert(req.status == 304)
	end)
end

-- GET /cache/:n --------------------------------------------------------------

function test.cache_control()
	checked_run(function()
		local body, req = fetch(BASE..'/cache/60')
		assert(req.status == 200)
		local cc = req.response_headers['cache-control']
		assert(cc and cc:has'60')
	end)
end

-- GET /etag/:etag ------------------------------------------------------------

function test.etag()
	checked_run(function()
		local body, req = fetch(BASE..'/etag/test-etag')
		assert(req.status == 200)
		assert(req.response_headers['etag'] == '"test-etag"')
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

-- GET /json ------------------------------------------------------------------

function test.json()
	checked_run(function()
		local body, req = fetch(BASE..'/json')
		assert(req.status == 200)
		assert(istab(body))
	end)
end

-- GET /xml -------------------------------------------------------------------

function test.xml()
	checked_run(function()
		local body, req = fetch{url = BASE..'/xml', compress = false}
		assert(req.status == 200)
		assert(isstr(body))
		assert(body:has'<?xml')
	end)
end

-- GET /html ------------------------------------------------------------------

function test.html()
	checked_run(function()
		local body, req = fetch{url = BASE..'/html', compress = false}
		assert(req.status == 200)
		assert(body:has'<html')
	end)
end

-- GET /encoding/utf8 ---------------------------------------------------------

function test.encoding_utf8()
	checked_run(function()
		local body, req = fetch{url = BASE..'/encoding/utf8', compress = false}
		assert(req.status == 200)
		assert(isstr(body))
	end)
end

-- GET /robots.txt ------------------------------------------------------------

function test.robots_txt()
	checked_run(function()
		local body, req = fetch{url = BASE..'/robots.txt', compress = false}
		assert(req.status == 200)
		assert(body:has'Disallow')
	end)
end

-- GET /deny ------------------------------------------------------------------

function test.deny()
	checked_run(function()
		local body, req = fetch{url = BASE..'/deny', compress = false}
		assert(req.status == 200)
		assert(body:has'YOU SHOULDN')
	end)
end

-- GET /image/png -------------------------------------------------------------

function test.image_png()
	checked_run(function()
		local body, req = fetch{url = BASE..'/image/png', compress = false}
		assert(req.status == 200)
		assert(req.response_headers['content-type']:has'image/png')
		assert(#body > 0)
	end)
end

-- GET /image/jpeg ------------------------------------------------------------

function test.image_jpeg()
	checked_run(function()
		local body, req = fetch{url = BASE..'/image/jpeg', compress = false}
		assert(req.status == 200)
		assert(req.response_headers['content-type']:has'image/jpeg')
	end)
end

-- GET /image/svg -------------------------------------------------------------

function test.image_svg()
	checked_run(function()
		local body, req = fetch{url = BASE..'/image/svg', compress = false}
		assert(req.status == 200)
		assert(req.response_headers['content-type']:has'image/svg')
	end)
end

-- GET /image/webp ------------------------------------------------------------

function test.image_webp()
	checked_run(function()
		local body, req = fetch{url = BASE..'/image/webp', compress = false}
		assert(req.status == 200)
		assert(req.response_headers['content-type']:has'image/webp')
	end)
end

-- GET /image (content negotiation) -------------------------------------------

function test.image_accept()
	checked_run(function()
		local body, req = fetch{url = BASE..'/image', compress = false,
			headers = {accept = 'image/png'}}
		assert(req.status == 200)
		assert(req.response_headers['content-type']:has'image/png')
	end)
end

-- GET /base64/encode/:value --------------------------------------------------

function test.base64_encode()
	checked_run(function()
		local body, req = fetch{url = BASE..'/base64/encode/hello world', compress = false}
		assert(req.status == 200)
		assert(body:trim() == base64_encode'hello world' or body:trim():has'aGVsbG8')
	end)
end

-- GET /base64/decode/:value --------------------------------------------------

function test.base64_decode()
	checked_run(function()
		local body, req = fetch{url = BASE..'/base64/decode/aGVsbG8gd29ybGQ=', compress = false}
		assert(req.status == 200)
		assert(body:trim() == 'hello world')
	end)
end

-- GET /base64/:value (shorthand decode) --------------------------------------

function test.base64_shorthand()
	checked_run(function()
		local body, req = fetch{url = BASE..'/base64/aGVsbG8gd29ybGQ=', compress = false}
		assert(req.status == 200)
		assert(body:trim() == 'hello world')
	end)
end

-- GET /uuid ------------------------------------------------------------------

function test.uuid()
	checked_run(function()
		local body, req = fetch(BASE..'/uuid')
		assert(req.status == 200)
		assert(body.uuid:match'^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$')
	end)
end

-- GET /links/:n --------------------------------------------------------------

function test.links()
	checked_run(function()
		local body, req = fetch{url = BASE..'/links/5', compress = false}
		assert(req.status == 200)
		assert(body:has'<a href')
	end)
end

-- GET /forms/post ------------------------------------------------------------

function test.forms_post()
	checked_run(function()
		local body, req = fetch{url = BASE..'/forms/post', compress = false}
		assert(req.status == 200)
		assert(body:has'<form')
	end)
end

-- GET /hostname --------------------------------------------------------------

function test.hostname()
	checked_run(function()
		local body, req = fetch(BASE..'/hostname')
		assert(req.status == 200)
		assert(body.hostname)
	end)
end

-- GET /env -------------------------------------------------------------------

function test.env()
	checked_run(function()
		local body, req = fetch(BASE..'/env')
		assert(req.status == 200)
		assert(istab(body))
	end)
end

-- GET /unstable ---------------------------------------------------------------

function test.unstable()
	checked_run(function()
		local body, req = fetch{url = BASE..'/unstable?failure_rate=0', compress = false}
		assert(req.status == 200)
	end)
end

-- GET /dump/request ----------------------------------------------------------

function test.dump_request()
	checked_run(function()
		local body, req = fetch{url = BASE..'/dump/request', compress = false}
		assert(req.status == 200)
		assert(body:has'GET /dump/request')
	end)
end

-- POST /upload ---------------------------------------------------------------

function test.upload()
	checked_run(function()
		local body, req = fetch{url = BASE..'/upload', method = 'POST', body = 'upload data'}
		assert(req.status == 200)
	end)
end

-- GET /digest-auth/:qop/:user/:password (without credentials -> 401) --------

function test.digest_auth()
	checked_run(function()
		local body, req = fetch{url = BASE..'/digest-auth/auth/user/pass', compress = false}
		assert(req.status == 401)
		assert(req.response_headers['www-authenticate'])
	end)
end

-- GET /sse (server-sent events) ----------------------------------------------

function test.sse()
	checked_run(function()
		local body, req = fetch{url = BASE..'/sse?count=3&duration=1&delay=0',
			compress = false, headers_timeout = 10}
		assert(req.status == 200)
		assert(body:has'data:')
	end)
end

-- GET /trailers ---------------------------------------------------------------

function test.trailers()
	checked_run(function()
		local body, req = fetch{url = BASE..'/trailers?foo=bar', compress = false}
		assert(req.status == 200)
	end)
end

-- Connection reuse (keep-alive) test -----------------------------------------

function test.keepalive()
	checked_run(function()
		local cl = http_client()
		local body1, req1 = cl:fetch(BASE..'/get')
		assert(req1.status == 200)
		local body2, req2 = cl:fetch(BASE..'/get')
		assert(req2.status == 200)
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
