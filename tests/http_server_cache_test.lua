require'glue'
require'fs'
require'http_server'
require'http_client'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local PORT = 18081
local BASE = 'http://127.0.0.1:'..PORT..'/'
local dir = '/tmp/http_server_cache_test_'..getpid() -- gzip cache dir

local body_s = ('hello '):rep(1000) -- response body, over 1000 bytes
local small_s = 'hello' -- response body under 1000 bytes
local sent_n = 0 -- times that respond sent the body itself
local source_mtime = 100 -- source mtime that respond passes to send_cached
local status = 200 -- status that respond uses on a miss
local body_to_send = body_s -- body that respond sends on a miss

local function cache_files()
	local t = {}
	for name in ls(dir, nil, 'if_exists') do
		t[#t+1] = name
	end
	return t
end

local function with_server(f)
	rm_rf(dir)
	sent_n, source_mtime, status, body_to_send = 0, 100, 200, body_s
	run(function()
		local server = http_server{
			listen = {{host = '*', addr = '127.0.0.1', port = PORT}},
			gzip_cache_dir = dir,
			respond = function(req)
				req.response_headers['content-type'] = 'text/plain'
				if req:send_cached('k', source_mtime) then return end
				sent_n = sent_n + 1
				req.status = status
				req.response_headers['content-length'] = tostring(#body_to_send)
				req:send_headers():send_body_chunk(body_to_send)
			end,
		}
		local client = http_client{owner = mainthread()}
		local ok, err = pcall(f, client)
		client:close()
		server:stop()
		assert(ok, err)
	end)
	rm_rf(dir)
end

function test.miss_then_hit()
	with_server(function(client)
		local s, req = client:fetch(BASE)
		assert(s == body_s and req.gzip and sent_n == 1)
		assert(#cache_files() == 1)
		assert(mtime(indir(dir, cache_files()[1])) == source_mtime)
		local s, req = client:fetch(BASE)
		assert(s == body_s and req.gzip and sent_n == 1)
		assert(#cache_files() == 1)
	end)
end

function test.changed_source_mtime_is_a_miss()
	with_server(function(client)
		client:fetch(BASE)
		source_mtime = 200
		body_to_send = ('bye '):rep(1000)
		local s = client:fetch(BASE)
		assert(s == body_to_send and sent_n == 2)
		assert(mtime(indir(dir, cache_files()[1])) == 200)
		local s = client:fetch(BASE)
		assert(s == body_to_send and sent_n == 2)
	end)
end

function test.non_gzip_client_is_not_cached()
	with_server(function(client)
		local s, req = client:fetch{url = BASE, compress = false}
		assert(s == body_s and not req.gzip and sent_n == 1)
		assert(#cache_files() == 0)
	end)
end

function test.small_body_is_not_cached()
	with_server(function(client)
		body_to_send = small_s
		client:fetch(BASE)
		client:fetch(BASE)
		assert(sent_n == 2 and #cache_files() == 0)
	end)
end

function test.error_status_is_not_cached()
	with_server(function(client)
		status = 500
		client:fetch(BASE)
		assert(#cache_files() == 0)
		status = 200
		client:fetch(BASE)
		assert(#cache_files() == 1)
	end)
end

local name = ...
if name == 'http_server_cache_test' then name = nil end

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
print'http_server_cache ok'
