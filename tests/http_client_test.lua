
tls_libname = 'tls_bearssl'
--tls_libname = 'tls_libressl'

require'glue'
require'logging'
require'http_client'
logging.debug = true

local function search_page_url(pn)
	return 'https://luapower.com/'
end

function kbytes(n)
	if type(n) == 'string' then n = #n end
	return n and string.format('%.1fkB', n/1024)
end

function mbytes(n)
	if type(n) == 'string' then n = #n end
	return n and string.format('%.1fmB', n/(1024*1024))
end

local client = http_client{
	max_conn = 1,
	max_pipelined_requests = 10,
	debug = {protocol = true},
	libs = 'sock sock_libtls zlib',
}
local n = 0
for i=1,5 do
	--client.max_pipelined_requests = 0
	thread(function()
		--print('sleep .5')
		--sleep(.5)
		local res, req, err = client:request{
			--host = 'www.websiteoptimization.com', uri = '/speed/tweak/compress/',
			--host = 'www.libpng.org', uri = '/pub/png/spec/1.2/PNG-Chunks.html',
			host = 'luapower.com', uri = '/',
			--max_redirects = 0,
			--https = true,
			--host = 'mokingburd.de',
			--host = 'www.google.com', https = true,
			receive_content = 'string',
			debug = {protocol = true, stream = false},
			--max_line_size = 1024,
			--close = true,
			--connect_timeout = 0.5,
			--request_timeout = 0.5,
			--reply_timeout = 0.3,
		}
		require'pp'(res, req, err)
		if res then
			n = n + (res and res.content and #res.content or 0)
		else
			print('sleep .5')
			sleep(.5)
			print('ERROR:', req)
		end
	end)
end
local t0 = clock()
start()
t1 = clock()
print(mbytes(n / (t1 - t0))..'/s')
