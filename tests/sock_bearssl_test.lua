require'glue'
require'fs'
require'sock_bearssl'

chdir(exedir()..'/../tests')
--logging.debug = true

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v); rawset(t, #t+1, k)
end})

local PORT = 23000
local function nextport() PORT = PORT + 1; return PORT end

local CERT = assert(load'localhost.crt')
local KEY  = assert(load'localhost.key')

local function mkserver(port)
	return server_stcp(listen('127.0.0.1', port), {
		cert = CERT,
		key = KEY,
	})
end

local function mkclient(port)
	return client_stcp(connect('127.0.0.1', port), 'localhost', {
		insecure_noverifycert = true,
	})
end

local BUF = new'char[65536]'
local _terr

local function sthread(f, name)
	return thread(function(...)
		local ok, err = pcall(f, ...)
		if not ok then _terr = _terr and (_terr..'\n'..tostring(err)) or tostring(err) end
	end, name):setowner()
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

function test.tls_request_response()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local c = mkclient(port)
			c:send'ping'
			local n = c:recv(BUF, 64)
			assert(str(BUF, n) == 'pong')
			c:close()
		end, 'client'))
		local s = server:accept()
		local n = s:recv(BUF, 64)
		assert(str(BUF, n) == 'ping')
		s:send'pong'
		s:close()
		server:close()
	end)
end

function test.tls_recvn_fragmented()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local c = mkclient(port)
			c:send'he'
			wait(0.01)
			c:send'llo'
			assert(c:try_send_close_notify())
			c:close()
		end, 'client'))
		local s = server:accept()
		local buf = new'char[5]'
		assert(s:try_recvn(buf, 5))
		assert(str(buf, 5) == 'hello')
		local n, err = s:try_recv(BUF, 64)
		assert(n == 0)
		assert(err == 'eof')
		s:close()
		server:close()
	end)
end

function test.tls_recvall_close_notify()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local c = mkclient(port)
			c:send'hello '
			c:send'world'
			assert(c:try_send_close_notify())
			c:close()
		end, 'client'))
		local s = server:accept()
		local buf, len = s:recvall()
		assert(str(buf, len) == 'hello world')
		s:close()
		server:close()
	end)
end

function test.tls_close_notify_eof()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local c = mkclient(port)
			c:send'hello'
			assert(c:try_send_close_notify())
			c:close()
		end, 'client'))
		local s = server:accept()
		local n = s:recv(BUF, 64)
		assert(str(BUF, n) == 'hello')
		local n, err = s:try_recv(BUF, 64)
		assert(n == 0)
		assert(err == 'eof')
		s:close()
		server:close()
	end)
end

function test.tls_large_transfer()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local size = 256 * 1024
		resume(sthread(function()
			local c = mkclient(port)
			local buf = new('char[?]', size)
			fill(buf, size, 0x41)
			c:send(buf, size)
			assert(c:try_send_close_notify())
			c:close()
		end, 'client'))
		local s = server:accept()
		local buf, len = s:recvall()
		assert(len == size)
		assert(buf[0] == 0x41)
		assert(buf[size - 1] == 0x41)
		s:close()
		server:close()
	end)
end

function test.tls_recv_timeout()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local c = mkclient(port)
			wait(0.2)
			c:close()
		end, 'client'))
		local s = server:accept()
		s:settimeout(0.05, 'r')
		local n, err = s:try_recv(BUF, 64)
		assert(n == nil)
		assert(err == 'timeout')
		s:close()
		server:close()
	end)
end

function test.tls_zero_len_recv_returns_immediately()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local c = mkclient(port)
			wait(0.2)
			c:close()
		end, 'client'))
		local s = server:accept()
		s:settimeout(0.05, 'r')
		local n, err = s:try_recv(BUF, 0)
		assert(n == 0)
		assert(err == nil)
		s:close()
		server:close()
	end)
end

function test.tls_debug_stream()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local c = mkclient(port)
			c:debug_stream'tls-test'
			c:send'hello'
			c:close()
		end, 'client'))
		local s = server:accept()
		s:debug_stream'tls-test'
		local n = s:recv(BUF, 64)
		assert(str(BUF, n) == 'hello')
		s:close()
		server:close()
	end)
end

-- runner --------------------------------------------------------------------

local name = ...
if name == 'sock_bearssl_test' then name = nil end
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
if n_fail > 0 then os.exit(1) end
