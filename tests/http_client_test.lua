
tls_libname = 'tls_bearssl'
--tls_libname = 'tls_libressl'

require'glue'
require'http_client'
logging.verbose = true
--logging.debug = true
--logging.filter.tls = true
--config('getpage_debug', 'protocol')
config('ca_file', scriptdir()..'/cacert.pem')

local function search_page_url(pn)
	return 'https://luapower.com/'
end

function test_update_ca_file()
	resume(thread(function()
		update_ca_file()
	end))
end

function test_getpage(url, n)
	local b = 0
	for i=1,n do
		resume(thread(function()
			local s, err = getpage(url)
			b = b + (s and #s or 0)
			say('%-10s %s', s and kbytes(#s) or err, url)
		end))
	end
	local t0 = clock()
	start()
	t1 = clock()
	pr(kbytes(b / (t1 - t0))..'/s')
end

--test_update_ca_file()
test_getpage('https://luapower.com/', 10)
