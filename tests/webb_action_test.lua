require'webb'
require'webb_action'
require'http_client'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local PORT = 18083
local BASE = 'http://127.0.0.1:'..PORT..'/'
local www = '/tmp/webb_action_test_www_'..getpid() -- www dir

local function with_server(f)
	rm_rf(www)
	mkdir(www)
	wwwdir(www)
	run(function()
		local server = http_server{
			listen = {{host = '*', addr = '127.0.0.1', port = PORT}},
			gzip_cache_dir = false,
			respond = function(req)
				local t = {} -- {path_segment,...}
				for s in req.uri:gmatch'[^/]+' do t[#t+1] = s end
				checkfound(action(unpack(t)))
			end,
		}
		local client = http_client{owner = mainthread()}
		local ok, err = pcall(f, client)
		client:close()
		server:stop()
		assert(ok, err)
	end)
	rm_rf(www)
end

function test.function_action_gets_args()
	action['fn_action'] = function(a, b)
		out(_('<p>%s %s</p>', a, b))
	end
	with_server(function(client)
		local s = client:fetch(BASE..'fn_action/x/y')
		assert(s == '<p>x y</p>', s)
	end)
end

function test.string_action()
	action['str_action.txt'] = 'plain text'
	with_server(function(client)
		local s = client:fetch(BASE..'str_action.txt')
		assert(s == 'plain text', s)
	end)
end

function test.virtual_www_file_gets_max_age()
	wwwfile['virtual.css'] = 'b {}'
	with_server(function(client)
		local s, req = client:fetch(BASE..'virtual.css')
		assert(s == 'b {}', s)
		assert(req.response_headers['cache-control'] == 'max-age=60')
	end)
	wwwfile['virtual.css'] = nil
end

function test.static_file_gets_max_age()
	with_server(function(client)
		save(indir(www, 'static.css'), 'a {}')
		local s, req = client:fetch(BASE..'static.css')
		assert(s == 'a {}', s)
		assert(req.response_headers['cache-control'] == 'max-age=60')
	end)
end

function test.dev_gets_no_store_instead_of_max_age()
	config{env = 'dev'}
	wwwfile['virtual.css'] = 'b {}'
	with_server(function(client)
		save(indir(www, 'static.css'), 'a {}')
		local s, req = client:fetch(BASE..'static.css')
		assert(req.response_headers['cache-control'] == 'no-store')
		local s, req = client:fetch(BASE..'virtual.css')
		assert(req.response_headers['cache-control'] == 'no-store')
	end)
	wwwfile['virtual.css'] = nil
	config{env = false}
end

function test.static_file_post_is_405()
	with_server(function(client)
		save(indir(www, 'static.css'), 'a {}')
		local s, req = client:fetch{url = BASE..'static.css', method = 'POST',
			body = 'x', body_type = 'text/plain'}
		assert(req.status == 405, req.status)
	end)
end

function test.lua_action_file_gets_args()
	with_server(function(client)
		save(indir(www, 'lua_page.html.lua'), "out(_('lua %s', ...))")
		local s = client:fetch(BASE..'lua_page/z')
		assert(s == 'lua z', s)
	end)
end

function test.not_found_runs_404_action_with_original_action()
	action['404.html'] = function(missing_action, a)
		out(_('missing %s %s', missing_action, a))
	end
	with_server(function(client)
		local s = client:fetch(BASE..'no_such_page/q')
		assert(s == 'missing no_such_page q', s)
	end)
	action['404.html'] = nil
end

function test.not_found_without_404_action()
	with_server(function(client)
		local s, req = client:fetch(BASE..'no_such_file.css')
		assert(req.status == 404)
	end)
end

local name = ...
if name == 'webb_action_test' then name = nil end

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
print'webb_action ok'
