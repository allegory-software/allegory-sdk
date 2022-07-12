require'glue'
require'http_client'
logging.verbose = true
--logging.debug = true
--config('getpage_debug', 'protocol stream')
logging.filter.tls = true
config('ca_file', exedir()..'/../../tests/cacert.pem')

local function search_page_url(pn)
	return 'https://luapower.com/'
end

function test_update_ca_file()
	resume(thread(function()
		update_ca_file()
	end))
	start()
end

function test_getpage(url, n)
	local b = 0
	for i=1,n do
		resume(thread(function()
			local s, err = getpage{url = url}
			b = b + (s and #s or 0)
			say('%-10s %s', s and kbytes(#s) or err, url)
		end, 'P'..i))
	end
	local t0 = clock()
	start()
	t1 = clock()
	pr(kbytes(b / (t1 - t0))..'/s')
end

test_update_ca_file()
--test_getpage('http://luapower.com/', 1)
