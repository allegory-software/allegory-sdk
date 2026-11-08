require'glue'
require'fs'
require'sock_bearssl'
require'pbuffer'

chdir(exedir()..'/../tests')
--logging.debug = true

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v); rawset(t, #t+1, k)
end})

local PORT = 23000
local function nextport() PORT = PORT + 1; return PORT end

local CERT = assert(load'localhost.crt')
local KEY  = assert(load'localhost.key')

local function mkserver(port, owner)
	return server_stcp(listen('127.0.0.1', port), {
		cert = CERT,
		key = KEY,
		owner = owner,
	})
end

local function mkclient(port, owner)
	return client_stcp(connect('127.0.0.1', port), 'localhost', {
		insecure_noverifycert = true,
		owner = owner,
	})
end

local BUF = new'char[65536]'
local _terr

local function sthread(f, name)
	return thread(function(...)
		local ok, err = pcall(f, ...)
		if not ok then _terr = _terr and (_terr..'\n'..tostring(err)) or tostring(err) end
	end, name):setowner(mainthread())
end

local function accept_tls(server)
	local ctcp = assert(server:try_accept())
	return server:tls_accept(ctcp)
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
		local s = accept_tls(server)
		local n = s:recv(BUF, 64)
		assert(str(BUF, n) == 'ping')
		s:send'pong'
		s:close()
		server:close()
	end)
end

function test.server_tracks_tls_sockets()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local c = mkclient(port)
			wait(.1)
			c:try_close()
		end, 'client'))
		local ctcp = assert(server:try_accept())
		assert(server.sockets ~= server.tcp.sockets)
		assert(server.tcp.sockets[ctcp])
		assert(not next(server.sockets))
		local s = server:tls_accept(ctcp)
		assert(server.sockets[s])
		assert(not server.sockets[ctcp])
		server:close()
		assert(s:closed())
		assert(not next(server.sockets))
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
			c:send_close_notify()
			c:close()
		end, 'client'))
		local s = accept_tls(server)
		local buf = new'char[5]'
		assert(s:recvn(buf, 5))
		assert(str(buf, 5) == 'hello')
		local n = s:recv(BUF, 64)
		assert(n == 0)
		s:close()
		server:close()
	end)
end

function test.tls_readall_close_notify()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local c = mkclient(port)
			c:send'hello '
			c:send'world'
			c:send_close_notify()
			c:close()
		end, 'client'))
		local s = accept_tls(server)
		local b = pbuffer{f = s}
		local buf, len = b:readall():ref()
		assert(str(buf, len) == 'hello world')
		b:free()
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
			c:send_close_notify()
			c:close()
		end, 'client'))
		local s = accept_tls(server)
		local n = s:recv(BUF, 64)
		assert(str(BUF, n) == 'hello')
		local n = s:recv(BUF, 64)
		assert(n == 0)
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
			c:send_close_notify()
			c:close()
		end, 'client'))
		local s = accept_tls(server)
		local b = pbuffer{f = s}
		local buf, len = b:readall():ref()
		assert(len == size)
		assert(buf[0] == 0x41)
		assert(buf[size - 1] == 0x41)
		b:free()
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
		local s = accept_tls(server)
		s:settimeout(0.05, 'r')
		local ok, err = catch('net', s.recv, s, BUF, 64)
		assert(not ok)
		assert(iserror(err, 'net', 'timeout'))
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
		local s = accept_tls(server)
		s:debug_stream'tls-test'
		local n = s:recv(BUF, 64)
		assert(str(BUF, n) == 'hello')
		s:close()
		server:close()
	end)
end

function test.tls_listener_owner()
	checked_run(function()
		local owner0 = _own(currentthread(), {})
		local owner1 = _own(currentthread(), {})
		local server = mkserver(nextport(), owner0)
		local closed_n = 0
		server:onclose(function(s)
			assert(s == server)
			assert(s:closed())
			assert(s.tcp.owner == nil)
			assert(s._keepalive == nil)
			closed_n = closed_n + 1
		end)
		assert(server.owner == nil)
		assert(server.tcp.owner == owner0)
		assert(server:setowner(owner1) == server)
		owner0:try_close()
		assert(not server:closed())
		owner1:try_close()
		assert(server:closed())
		assert(closed_n == 1)
		assert(server:try_close())
		assert(closed_n == 1)
		local ok, err = pcall(server.check_closed, server)
		assert(not ok and err == CLOSED)
	end)
end

local function tls_receiver_close(cancel, raw_close)
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local s
		local closed_n = 0
		local worker = sthread(function()
			local raw = assert(server:try_accept())
			raw:setowner(currentthread())
			s = server:tls_accept(raw)
			assert(s.owner == nil)
			assert(raw.owner == currentthread())
			s:onclose(function(self)
				assert(self == s)
				assert(self:closed())
				assert(self.tcp.owner == nil)
				assert(self._keepalive == nil)
				closed_n = closed_n + 1
			end)
			s:send'r'
			local ok, err = pcall(s.recv, s, BUF, 1)
			assert(not ok)
			assert(err == (cancel and CANCEL or CLOSED))
			assert(s:closed())
			assert(s:try_close())
		end, 'tls recv owner')
		resume(worker)
		local owner0 = _own(currentthread(), {})
		local owner1 = _own(currentthread(), {})
		local c = mkclient(port, owner0)
		assert(c.owner == nil)
		assert(c.tcp.owner == owner0)
		assert(c:setowner(owner1) == c)
		owner0:try_close()
		assert(not c:closed())
		assert(c:recv(BUF, 1) == 1)
		assert(worker.waiting == s.tcp)
		if cancel then
			assert(worker:try_cancel())
		elseif raw_close then
			assert(s.tcp:try_close())
		else
			assert(s:try_close())
		end
		assert(worker:status() == 'dead')
		assert(worker.owner == nil)
		assert(s.tcp.owner == nil)
		assert(closed_n == 1)
		local ok, err = pcall(s.recv, s, BUF, 1)
		assert(not ok and err == CLOSED)
		ok, err = pcall(s.send, s, 'x')
		assert(not ok and err == CLOSED)
		assert(not next(server.sockets))
		owner1:try_close()
		assert(c:closed())
		assert(c._keepalive == nil)
		server:close()
	end)
end

function test.tls_close_receiver_owner()
	tls_receiver_close(false, false)
end

function test.tls_raw_close_receiver_owner()
	tls_receiver_close(false, true)
end

function test.tls_cancel_receiver_owner()
	tls_receiver_close(true, false)
end

function test.tls_thread_finish_closes_socket()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local s
		local worker = sthread(function()
			local raw = assert(server:try_accept())
			raw:setowner(currentthread())
			s = server:tls_accept(raw)
			s:send'r'
		end, 'tls socket owner')
		resume(worker)
		local c = mkclient(port)
		assert(c:recv(BUF, 1) == 1)
		assert(worker:status() == 'dead')
		assert(worker.owner == nil)
		assert(s:closed())
		assert(s.tcp.owner == nil)
		assert(s._keepalive == nil)
		assert(not next(server.sockets))
		c:close()
		server:close()
	end)
end

function test.tls_listener_cancel_suspended_clients()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local workers = {}
		local closed_n = 0
		local listener = sthread(function()
			while true do
				local ok, raw = pcall(server.try_accept, server)
				if not ok then
					assert(raw == CANCEL)
					break
				end
				local suspended = #workers < 2
				local worker = sthread(function()
					raw:setowner(currentthread())
					local s = server:tls_accept(raw)
					local waiting_thread
					s:onclose(function()
						closed_n = closed_n + 1
						if waiting_thread then
							resume(waiting_thread, 'closed')
						end
					end)
					s:send'r'
					if suspended then
						waiting_thread = currentthread()
						assert(suspend() == 'closed')
						waiting_thread = nil
					else
						local ok, err = pcall(s.recv, s, BUF, 1)
						assert(not ok and err == CLOSED)
					end
					assert(s:closed())
					s:close()
				end, 'tls client handler')
				add(workers, worker)
				resume(worker)
			end
		end, 'tls accept waiter')
		resume(listener)
		local clients = {}
		for i = 1, 3 do
			local c = mkclient(port)
			assert(c:recv(BUF, 1) == 1)
			add(clients, c)
		end
		assert(workers[1].waiting == true)
		assert(workers[2].waiting == true)
		assert(listener:try_cancel())
		assert(listener:status() == 'dead')
		assert(server:closed())
		assert(server._keepalive == nil)
		assert(not next(server.sockets))
		assert(server.tcp._sockets_n == 0)
		assert(closed_n == 3)
		for _, worker in ipairs(workers) do
			assert(worker:status() == 'dead')
			assert(worker.owner == nil)
		end
		server:close()
		assert(closed_n == 3)
		for _, c in ipairs(clients) do c:close() end
	end)
end

local function tls_server_handshake_close(cancel)
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local c = connect('127.0.0.1', port)
		local raw = assert(server:try_accept())
		local worker = sthread(function()
			raw:setowner(currentthread())
			local ok, err = pcall(server.tls_accept, server, raw)
			assert(not ok)
			assert(err == (cancel and CANCEL or CLOSED))
		end, 'tls server handshake')
		resume(worker)
		assert(worker.waiting == raw)
		local s = assert(raw.stcp)
		assert(not server.sockets[s])
		local closed_n = 0
		s:onclose(function() closed_n = closed_n + 1 end)
		if cancel then
			assert(worker:try_cancel())
		else
			server:close()
		end
		assert(worker:status() == 'dead')
		assert(worker.owner == nil)
		assert(raw.owner == nil)
		assert(s:closed())
		assert(s._keepalive == nil)
		assert(closed_n == 1)
		assert(server.tcp._sockets_n == 0)
		c:close()
		server:close()
	end)
end

function test.tls_cancel_server_handshake()
	tls_server_handshake_close(true)
end

function test.tls_listener_close_during_handshake()
	tls_server_handshake_close(false)
end

function test.tls_cancel_client_handshake()
	checked_run(function()
		local port = nextport()
		local server = listen('127.0.0.1', port)
		local raw = connect('127.0.0.1', port)
		local peer = server:accept()
		local worker = sthread(function()
			local ok, err = pcall(client_stcp, raw, 'localhost', {
				insecure_noverifycert = true,
			})
			assert(not ok and err == CANCEL)
		end, 'tls client handshake')
		resume(worker)
		assert(worker.waiting == raw)
		local s = assert(raw.stcp)
		assert(raw.owner == worker)
		local closed_n = 0
		s:onclose(function() closed_n = closed_n + 1 end)
		assert(worker:try_cancel())
		assert(worker:status() == 'dead')
		assert(worker.owner == nil)
		assert(raw.owner == nil)
		assert(s:closed())
		assert(s._keepalive == nil)
		assert(closed_n == 1)
		peer:close()
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
if n_fail == 0 then print'sock_bearssl ok' end
if n_fail > 0 then os.exit(1) end
