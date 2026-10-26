require'webb'
require'webb_action'
require'http_client'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local PORT = 18082
local BASE = 'http://127.0.0.1:'..PORT..'/'
local pid_s = tostring(getpid())
local www = '/tmp/webb_static_cache_test_www_'..pid_s -- static files dir
local cache = '/tmp/webb_static_cache_test_cache_'..pid_s -- gzip cache dir

local css_s = ('a { color: red; }\n'):rep(200) -- plain static file
local js_s = ('var x = 1;\n'):rep(200) -- file served by the js filter
local html_s = ('<p>hello</p>\n'):rep(200) -- file served by the html filter

local function cache_files()
	local t = {}
	for name in ls(cache, nil, 'if_exists') do
		t[#t+1] = indir(cache, name)
	end
	return t
end

local function with_server(f)
	rm_rf(www)
	rm_rf(cache)
	mkdir(www)
	save(indir(www, 'a.css'), css_s)
	save(indir(www, 'b.js'), js_s)
	save(indir(www, 'c.html'), html_s)
	wwwdir(www)
	run(function()
		local server = http_server{
			listen = {{host = '*', addr = '127.0.0.1', port = PORT}},
			gzip_cache_dir = cache,
			respond = function(req)
				checkfound(action(req.uri:sub(2)))
			end,
		}
		local client = http_client{owner = mainthread()}
		local ok, err = pcall(f, client)
		client:close()
		server:stop()
		assert(ok, err)
	end)
	rm_rf(www)
	rm_rf(cache)
end

--a hit is proven by replacing the cached body and getting it back.
local function check_cached(client, name, source_s)
	local s, req = client:fetch(BASE..name)
	assert(s == source_s, name)
	assert(req.gzip, name)
	local files = cache_files()
	assert(#files == 1, name)
	local source_mtime = mtime(indir(www, name))
	assert(mtime(files[1]) == source_mtime, name)
	save({path = files[1], mtime = source_mtime}, gzip('replaced'):get())
	local s, req = client:fetch(BASE..name)
	assert(s == 'replaced' and req.gzip, name)
	local s = client:fetch{url = BASE..name, compress = false}
	assert(s == source_s, name)
	rm_rf(cache)
end

function test.plain_file()
	with_server(function(client)
		check_cached(client, 'a.css', css_s)
	end)
end

function test.js_file()
	with_server(function(client)
		check_cached(client, 'b.js', js_s)
	end)
end

function test.minified_js_file()
	config{minify_js = true}
	local minified_s = require'jsmin'.minify(js_s) -- body that the js filter sends
	assert(minified_s ~= js_s)
	with_server(function(client)
		local s = client:fetch(BASE..'b.js')
		assert(s == minified_s)
		local files = cache_files()
		assert(#files == 1)
		config{minify_js = false}
		local s = client:fetch(BASE..'b.js')
		assert(s == js_s)
		assert(#cache_files() == 2)
	end)
	config{minify_js = false}
end

function test.html_file()
	with_server(function(client)
		check_cached(client, 'c.html', html_s)
	end)
end

local name = ...
if name == 'webb_static_cache_test' then name = nil end

if name then
	assert(test[name], 'unknown test: '..name)
	test[name]()
else
	local n_ok, n_fail = 0, 0
	for _, k in ipairs(test) do
		io.write('test.'..k..' ... ')
		io.flush()
		local ok, err = xpcall(test[k], debug.traceback)
		if ok then
			print'ok'
			n_ok = n_ok + 1
		else
			print'FAILED'
			print(err)
			n_fail = n_fail + 1
		end
	end
	print(('ok: %d, failed: %d'):format(n_ok, n_fail))
	assert(n_fail == 0)
end
print'webb_static_cache ok'
