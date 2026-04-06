--go@ plink m1 -t sdk/bin/luajit -lscite sdk/tests/http_smoke_test.lua
--
-- HTTP client+server smoke test for leak detection.
-- Runs an echo server on localhost and hammers it with varied requests forever.
-- Prints memory usage every second -- if it climbs steadily, there's a leak.
--

require'glue'
require'http_server'
require'http_client'

--logging.verbose = true
--logging.debug = true
--config('http_client_debug', 'protocol')

local PORT = 18080
local SPORT = 18443
local BASE  = 'http://localhost:'..PORT
local SBAS  = 'https://localhost:'..SPORT

local crt_file = exedir()..'/../tests/localhost.crt'
local key_file = exedir()..'/../tests/localhost.key'

-- echo server: returns request info as response body ----------------------------

local server = http_server{
	listen = {
		{host = '*', addr = '127.0.0.1', port = PORT},
		{host = '*', addr = '127.0.0.1', port = SPORT, tls = true, tls_options = {
			cert_file = crt_file,
			key_file  = key_file,
		}},
	},
	respond = function(req)
		local body_buf, body_len = req:read_body(16 * 1024^2)
		local body = body_len > 0 and str(body_buf, body_len) or ''

		if req.uri == '/redirect' then
			req.status = 302
			req.response_headers['location'] = BASE..'/echo'
			req:send_headers():finish()
			return
		end

		if req.uri == '/redirect-chain' then
			req.status = 307
			req.response_headers['location'] = BASE..'/redirect'
			req:send_headers():finish()
			return
		end

		if req.uri == '/big' then
			req:send_headers()
			-- send 1MB in 4k chunks
			local chunk = ('X'):rep(4096)
			for i = 1, 256 do
				req:send_body_chunk(chunk)
			end
			req:finish()
			return
		end

		if req.uri == '/set-cookie' then
			req.response_headers['set-cookie'] = {
				'a=1; Path=/',
				'b=2; Path=/',
			}
			req.response_headers['content-type'] = 'text/plain'
			req.response_headers['content-length'] = '2'
			req:send_headers():send_body_chunk('ok'):finish()
			return
		end

		if req.uri == '/json' then
			local out = json_encode{
				method = req.method,
				uri = req.uri,
				body = body,
			}
			req.response_headers['content-type'] = 'application/json'
			req.response_headers['content-length'] = tostring(#out)
			req:send_headers():send_body_chunk(out):finish()
			return
		end

		-- default echo: return body as-is
		req.response_headers['content-type'] = req.headers['content-type'] or 'text/plain'
		req.response_headers['content-length'] = tostring(#body)
		req:send_headers():send_body_chunk(body):finish()
	end,
}

-- test cases ------------------------------------------------------------------

local tests = {}
local test_reqs = {} --tests that do more than 1 request

function tests.get()
	local body, req = fetch(BASE..'/echo')
	assert(req.status == 200)
	assert(body == '')
end

function tests.post_small()
	local body, req = fetch{url = BASE..'/echo', body = 'hello', body_type = 'text/plain'}
	assert(req.status == 200)
	assert(body == 'hello')
end

function tests.post_json()
	local body, req = fetch{url = BASE..'/json', body = {x = 1}}
	assert(req.status == 200)
	assert(body.body == '{"x":1}')
end

function tests.post_medium()
	local payload = ('A'):rep(64 * 1024)
	local body, req = fetch{url = BASE..'/echo', body = payload, body_type = 'text/plain'}
	assert(req.status == 200)
	assert(#body == 64 * 1024)
end

function tests.get_big_response()
	local body, req = fetch{url = BASE..'/big', compress = false}
	assert(req.status == 200)
	assert(#body == 1024 * 1024)
end

function tests.get_big_compressed()
	local body, req = fetch{url = BASE..'/big', compress = true}
	assert(req.status == 200)
	assert(#body == 1024 * 1024)
end

function tests.head()
	local body, req = fetch{url = BASE..'/echo', method = 'HEAD'}
	assert(req.status == 200)
	assert(body == '')
end

function tests.redirect()
	local body, req = fetch(BASE..'/redirect')
	assert(req.status == 200)
end; test_reqs.redirect = 2

function tests.redirect_chain()
	local body, req = fetch(BASE..'/redirect-chain')
	assert(req.status == 200)
end; test_reqs.redirect_chain = 3

function tests.https_get()
	local body, req = fetch{url = SBAS..'/echo', tls_options = {insecure_noverifycert = true}}
	assert(req.status == 200)
end

function tests.https_post()
	local body, req = fetch{url = SBAS..'/echo', body = 'secure', body_type = 'text/plain',
		tls_options = {insecure_noverifycert = true}}
	assert(req.status == 200)
	assert(body == 'secure')
end

test_reqs.cookies = 2
function tests.cookies()
	local cl = http_client()
	cl:fetch(BASE..'/set-cookie')
	local body, req = cl:fetch(BASE..'/echo')
	assert(req.status == 200)
	cl:close()
end

function tests.connection_close()
	local body, req = fetch{url = BASE..'/echo', close = true}
	assert(req.status == 200)
end

test_reqs.concurrent = 10
function tests.concurrent()
	local ts = threadset()
	for i = 1, 10 do
		local s = 'c'..i
		resume(ts:thread(function()
			local body, req = fetch{url = BASE..'/echo', body = s, body_type = 'text/plain'}
			assert(req.status == 200)
			assert(body == s, _('expected %q, got %q', s, body))
		end, 'conc-'..i))
	end
	local all_ok, rets = ts:join()
	if not all_ok then
		for _,ret in ipairs(rets) do
			if not ret.ok then error(ret[1]) end
		end
	end
end

test_reqs.pool_reuse = 2
function tests.pool_reuse()
	local cl = http_client()
	local body1, req1 = cl:fetch{url = BASE..'/echo', max_conn = 1}
	local tcp1 = req1.http.tcp
	local body2, req2 = cl:fetch{url = BASE..'/echo', max_conn = 1}
	local tcp2 = req2.http.tcp
	assert(tcp1 == tcp2, 'connection not reused')
	cl:close()
end

-- build ordered test list
local test_names = {}
for k in pairs(tests) do
	add(test_names, k)
end
sort(test_names)

-- runner ----------------------------------------------------------------------

run(function()

	-- let server sockets start accepting
	wait(.1)

	local round = 0
	local reqs = 0
	local t0 = clock()
	local last_report = t0
	local last_reqs = 0

	while true do
		round = round + 1
		for _, name in ipairs(test_names) do
			local ok, err = pcall(tests[name])
			if not ok then
				printf('FAIL %s: %s\n', name, err)
				server:stop()
				os.exit(1)
			end
			reqs = reqs + (test_reqs[name] or 1)
		end

		collectgarbage()
		collectgarbage()
		local now = clock()
		if now - last_report >= 1 then
			local dt = now - last_report
			local mem = collectgarbage'count'
			printf('round %4d | %5d req/s | %6.1f KB | elapsed %.0fs\n',
				round, (reqs - last_reqs) / dt, mem, now - t0)
			last_reqs = reqs
			last_report = now
		end
	end
end)

server:stop()
