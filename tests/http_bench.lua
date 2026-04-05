--go@ plink m1 -t "ulimit -n 10000 && sdk/bin/luajit -lscite sdk/tests/http_bench.lua"
--
-- HTTP client+server benchmark.
-- Tests throughput under different combinations of gzip, chunked, tls.
--

require'glue'
require'http_server'
require'http_client'

local PORT  = 18090
local SPORT = 18493
local BASE  = 'http://127.0.0.1:'..PORT
local SBASE = 'https://localhost:'..SPORT

local crt_file = exedir()..'/../tests/localhost.crt'
local key_file = exedir()..'/../tests/localhost.key'

local DURATION    = 5    --seconds per benchmark
local MAX_CONN    = 500
local MAX_WAITING = 10000
local N_PAYLOADS  = 10

-- load real source files as payloads (mix of small and large)
local payload_files = {
	'lua/glue.lua',       -- 68k
	'lua/sock.lua',       -- 56k
	'lua/http_client.lua',-- 25k
	'lua/http_server.lua',-- 14k
	'lua/gzip.lua',       --  6k
	'lua/pbuffer.lua',    -- 10k
	'lua/errors.lua',     --  7k
	'lua/http_date.lua',  --  2k
	'lua/hmac.lua',       --  2k
	'lua/imtui.lua',      -- 91k
}
local payloads = {}
for i, f in ipairs(payload_files) do
	payloads[i] = assert(load(exedir()..'/../'..f))
end
N_PAYLOADS = #payloads

-- server -----------------------------------------------------------------------

local server_compress -- set per benchmark run

local server = http_server{
	compress = false, --we control this per-request below
	listen = {
		{addr = '127.0.0.1', port = PORT},
		{addr = '127.0.0.1', port = SPORT, tls = true, tls_options = {
			cert_file = crt_file,
			key_file  = key_file,
		}},
	},
	respond = function(req)
		local body_buf, body_len = req:read_body(16 * 1024^2)
		local i = tonumber(req.uri:match'/(%d+)') or 1
		local payload = payloads[((i - 1) % N_PAYLOADS) + 1]
		req.compress = server_compress
		if req.headers['x-no-chunked'] then
			req.response_headers['content-type'] = 'application/octet-stream'
			req.response_headers['content-length'] = tostring(#payload)
		end
		req:send_headers():send_body_chunk(payload):finish()
	end,
}

-- benchmark runner ------------------------------------------------------------

local function bench(label, opt)
	server_compress = opt.gzip or false
	local base = opt.tls and SBASE or BASE
	local nconn = MAX_CONN
	local cl = http_client()
	local reqs = 0
	local bytes = 0
	local t0 = clock()
	local deadline = t0 + DURATION
	local done = false

	local headers = {}
	if not opt.chunked and not opt.gzip then
		headers['x-no-chunked'] = '1'
	end

	-- spawn workers
	local ts = threadset()
	for i = 1, nconn do
		resume(ts:thread(function()
			while not done do
				local url = base..'/'..((reqs + i) % N_PAYLOADS + 1)
				local body, req = cl:fetch{
					url = url,
					compress = opt.gzip or false,
					max_conn = nconn,
					max_waiting_threads = MAX_WAITING,
					tls_options = opt.tls and {insecure_noverifycert = true} or nil,
					headers = headers,
				}
				reqs = reqs + 1
				bytes = bytes + #tostring(body)
				if clock() >= deadline then
					done = true
				end
			end
		end, 'bench-'..i))
	end
	local all_ok, rets = ts:join()
	cl:close()
	if not all_ok then
		local first_err
		for _,ret in ipairs(rets) do
			if not ret.ok then first_err = ret[1]; break end
		end
		if first_err and reqs == 0 then
			printf('%-30s ERROR: %s\n', label, first_err)
			return
		end
	end

	local elapsed = clock() - t0
	printf('%-30s %5d req/s  %6.0f MB/s  %5.1fs  (%d conn)\n',
		label, reqs / elapsed, bytes / elapsed / 1024^2, elapsed, nconn)
end

-- main ------------------------------------------------------------------------

run(function()
	wait(.1) --let server start

	local min_size, max_size = 1/0, 0
	for i = 1, N_PAYLOADS do
		min_size = min(min_size, #payloads[i])
		max_size = max(max_size, #payloads[i])
	end
	printf('payloads: %d x %dk-%dk  |  connections: %d  |  duration: %ds\n\n',
		N_PAYLOADS, min_size / 1024, max_size / 1024, MAX_CONN, DURATION)

	bench('plain (content-length)',    {})
	bench('chunked',                   {chunked = true})
	bench('gzip + chunked',            {gzip = true, chunked = true})
	bench('tls + content-length',      {tls = true})
	bench('gzip + chunked + tls',      {gzip = true, chunked = true, tls = true})

	printf('\ndone.\n')
	server:stop()
end)

server:stop()
