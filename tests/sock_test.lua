require'glue'
require'sock'

--logging.debug = true

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v); rawset(t, #t+1, k)
end})

local PORT = 19800 --base port; each test increments to avoid conflicts
local function nextport() PORT = PORT + 1; return PORT end

-- helpers
local function mkserver(port)
	local s = listen('127.0.0.1', port)
	assert(s)
	return s
end

local function mkclient(port)
	local s = connect('127.0.0.1', port)
	assert(s)
	return s
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

-- [1] Address ----------------------------------------------------------------

function test.addr_ipv4()
	local sa = sockaddr('1.2.3.4:1234')
	assert(issockaddr(sa))
	assert(sa:family() == 'ip')
	assert(sa:port() == 1234)
	assert(sa:tostring() == '1.2.3.4:1234')
end

function test.addr_ipv6()
	local sa = sockaddr('[::1]:80')
	assert(sa:family() == 'ip6')
	assert(sa:port() == 80)
end

function test.addr_unix()
	local sa = sockaddr('unix:/tmp/test.sock')
	assert(sa:family() == 'unix')
	assert(sa:tostring() == '/tmp/test.sock')
end

function test.addr_passthrough()
	local sa1 = sockaddr('1.2.3.4:80')
	local sa2 = sockaddr(sa1)
	assert(sa1 == sa2)
end

function test.addr_invalid()
	local sa = try_sockaddr('not-an-address', nil, 'noresolve')
	assert(not sa)
end

-- [2] TCP Connection Lifecycle -------------------------------------------------

function test.tcp_connect_send_recv_close()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local got
		resume(sthread(function()
			local cs = server:accept()
			local n = cs:recv(BUF, 64)
			got = str(BUF, n)
			cs:close()
			server:close()
		end, 'server'))
		resume(sthread(function()
			local s = mkclient(port)
			s:send'hello'
			s:close()
		end, 'client'))
		wait(0.1)
		assert(got == 'hello')
	end)
end

function test.tcp_connect_refused()
	checked_run(function()
		local s, err = try_connect('127.0.0.1', nextport(), 1)
		assert(not s)
		assert(err)
	end)
end

function test.tcp_remote_local_addr()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local s = mkclient(port)
			s:send'x'
			s:close()
		end, 'client'))
		local cs = server:accept()
		assert(cs:remote_addr():ip() == '127.0.0.1')
		assert(str(BUF, cs:recv(BUF, 1)) == 'x')
		cs:close()
		server:close()
	end)
end

function test.tcp_issocket()
	local s = tcp()
	assert(issocket(s))
	assert(not issocket({}))
	assert(not issocket('foo'))
	s:close()
end

function test.tcp_closed()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local cs = server:accept()
			cs:close()
			server:close()
		end, 'server'))
		local s = mkclient(port)
		assert(not s:closed())
		s:close()
		assert(s:closed())
	end)
end

function test.tcp_unix_socket()
	local path = '/tmp/sock_test_unix.sock'
	os.remove(path)
	checked_run(function()
		local server = listen('unix:'..path)
		resume(sthread(function()
			local s = connect('unix:'..path)
			s:send'unix-hello'
			s:close()
		end, 'client'))
		local cs = server:accept()
		local n = cs:recv(BUF, 64)
		assert(str(BUF, n) == 'unix-hello')
		cs:close()
		server:close()
	end)
	os.remove(path)
end

-- [3] TCP Server Operations ----------------------------------------------------

function test.tcp_server_onaccept()
	checked_run(function()
		local port = nextport()
		local accepted = 0
		local server = tcp()
		server:setopt('so_reuseaddr', true)
		resume(sthread(function()
			server:listen('127.0.0.1', port, nil, function(srv, cs)
				accepted = accepted + 1
				cs:recv(BUF, 64)
				-- cs closed by listen's wrapper
			end)
		end, 'server'))
		for i = 1, 3 do
			resume(sthread(function()
				local s = mkclient(port)
				s:send'x'
				s:close()
			end, 'client'..i))
		end
		wait(0.1)
		server:close()
		assert(accepted == 3)
	end)
end

function test.tcp_server_multiple_clients()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local results = {}
		resume(sthread(function()
			local ts = threadset()
			for i = 1, 3 do
				local cs = server:accept()
				resume(ts:thread(function()
					local buf = new'char[64]'
					local n = cs:recv(buf, 64)
					results[#results+1] = str(buf, n)
					cs:close()
				end, 'handler'..i))
			end
			ts:join()
			server:close()
		end, 'server'))
		for i = 1, 3 do
			resume(sthread(function()
				local s = mkclient(port)
				s:send('msg'..i)
				s:close()
			end, 'client'..i))
		end
		wait(0.1)
		table.sort(results)
		assert(#results == 3)
	end)
end

-- [4] Full-Duplex TCP Communication --------------------------------------------

function test.tcp_recvn()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local s = mkclient(port)
			s:send'he'
			wait(0.01)
			s:send'llo'
			s:close()
		end, 'client'))
		local cs = server:accept()
		local buf = new'char[5]'
		cs:recvn(buf, 5)
		assert(str(buf, 5) == 'hello')
		cs:close()
		server:close()
	end)
end

function test.tcp_recvall()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local s = mkclient(port)
			s:send'hello '
			s:send'world'
			s:close() -- FIN triggers recvall EOF
		end, 'client'))
		local cs = server:accept()
		local buf, len = cs:recvall()
		assert(buf and str(buf, len) == 'hello world')
		cs:close()
		server:close()
	end)
end

function test.tcp_recvall_partial_error()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local s = mkclient(port)
			s:send'partial' -- send some bytes then stop (no close)
			wait(0.2)       -- outlast the server's timeout
			s:close()
		end, 'client'))
		local cs = server:accept()
		cs:settimeout(0.05, 'r') -- short recv deadline
		local ok, err = pcall(cs.recvall, cs)
		assert(not ok)
		assert(tostring(err):find'timeout')
		cs:close()
		server:close()
	end)
end

function test.tcp_fullduplex()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local sbuf = new'char[64]'
		resume(sthread(function()
			local s = mkclient(port)
			resume(sthread(function()
				s:send'ping'
			end, 'cwrite'))
			local cbuf = new'char[64]'
			local n = s:recv(cbuf, 64)
			assert(str(cbuf, n) == 'pong')
			s:close()
		end, 'client'))
		local cs = server:accept()
		resume(sthread(function()
			cs:send'pong'
		end, 'swrite'))
		local n = cs:recv(sbuf, 64)
		assert(str(sbuf, n) == 'ping')
		wait(0.1)
		cs:close()
		server:close()
	end)
end

function test.tcp_shutdown()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local s = mkclient(port)
			s:shutdown('w')
			s:close()
		end, 'client'))
		local cs = server:accept()
		local n = cs:recv(BUF, 64)
		assert(n == 0) -- shutdown('w') sends FIN
		cs:close()
		server:close()
	end)
end

function test.tcp_large_transfer()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local SIZE = 256 * 1024
		resume(sthread(function()
			local s = mkclient(port)
			local buf = new('char[?]', SIZE)
			fill(buf, SIZE, 0x41)
			s:send(buf, SIZE)
			s:close()
		end, 'client'))
		local cs = server:accept()
		local buf = new('char[?]', SIZE)
		local received = 0
		while received < SIZE do
			local n = cs:recv(buf, SIZE - received)
			if n == 0 then break end
			received = received + n
		end
		assert(received == SIZE)
		cs:close()
		server:close()
	end)
end

-- [5] UDP Datagram Communication -----------------------------------------------

function test.udp_sendto_recvnext()
	checked_run(function()
		local port = nextport()
		local server = udp()
		server:bind('127.0.0.1', port)
		resume(sthread(function()
			local s = udp()
			s:bind('127.0.0.1', 0)
			s:sendto('127.0.0.1', port, 'udp-hello')
			s:close()
		end, 'client'))
		local buf = new'char[256]'
		local n, sa = server:recvnext(buf, 256)
		assert(str(buf, n) == 'udp-hello')
		server:close()
	end)
end

function test.udp_connected_mode()
	checked_run(function()
		local port = nextport()
		local server = udp()
		server:bind('127.0.0.1', port)
		resume(sthread(function()
			local s = udp()
			s:connect('127.0.0.1', port)
			s:send'udp-connected'
			s:close()
		end, 'client'))
		local buf = new'char[256]'
		local n = server:recv(buf, 256)
		assert(str(buf, n) == 'udp-connected')
		server:close()
	end)
end

function test.udp_connected_send_returns_len()
	checked_run(function()
		local port = nextport()
		local server = udp()
		server:bind('127.0.0.1', port)
		resume(sthread(function()
			local s = udp()
			s:connect('127.0.0.1', port)
			local n, err = s:try_send'udp'
			assert(n == 3)
			assert(err == nil)
			s:close()
		end, 'client'))
		local buf = new'char[256]'
		local n = server:recv(buf, 256)
		assert(str(buf, n) == 'udp')
		server:close()
	end)
end

function test.udp_connected_zero_len_datagram()
	checked_run(function()
		local port = nextport()
		local server = udp()
		server:bind('127.0.0.1', port)
		server:settimeout(0.2, 'r')
		resume(sthread(function()
			local s = udp()
			s:connect('127.0.0.1', port)
			local n, err = s:try_send('', 0)
			assert(n == 0)
			assert(err == nil)
			s:close()
		end, 'client'))
		local buf = new'char[1]'
		local n, err = server:try_recv(buf, 1)
		assert(n == 0)
		assert(err == nil)
		server:close()
	end)
end

function test.udp_zero_len_recv_asserts()
	checked_run(function()
		local port = nextport()
		local server = udp()
		server:bind('127.0.0.1', port)
		server:settimeout(0.2, 'r')
		resume(sthread(function()
			local s = udp()
			s:connect('127.0.0.1', port)
			s:send'x'
			s:close()
		end, 'client'))
		local buf = new'char[1]'
		local ok, err = pcall(server.try_recv, server, buf, 0)
		assert(not ok and tostring(err):find('recv size must be > 0', 1, true))
		local n = server:recv(buf, 1)
		assert(str(buf, n) == 'x')
		server:close()
	end)
end

function test.udp_recv_truncated()
	checked_run(function()
		local port = nextport()
		local server = udp()
		server:bind('127.0.0.1', port)
		server:settimeout(0.2, 'r')
		resume(sthread(function()
			local s = udp()
			s:connect('127.0.0.1', port)
			s:send'abcdef'
			s:send'ok'
			s:close()
		end, 'client'))
		local buf = new'char[3]'
		local n, err = server:try_recv(buf, 3)
		assert(n == nil)
		assert(err == 'message_too_long')
		local n = server:recv(buf, 3)
		assert(str(buf, n) == 'ok')
		server:close()
	end)
end

function test.udp_recvnext_truncated()
	checked_run(function()
		local port = nextport()
		local client_port = nextport()
		local server = udp()
		server:bind('127.0.0.1', port)
		server:settimeout(0.2, 'r')
		resume(sthread(function()
			local s = udp()
			s:bind('127.0.0.1', client_port)
			s:sendto('127.0.0.1', port, 'abcdef')
			s:sendto('127.0.0.1', port, 'ok')
			s:close()
		end, 'client'))
		local buf = new'char[3]'
		local n, err = server:try_recvnext(buf, 3)
		assert(n == nil)
		assert(err == 'message_too_long')
		local n, sa = server:recvnext(buf, 3)
		assert(str(buf, n) == 'ok')
		assert(sa:port() == client_port)
		server:close()
	end)
end

function test.udp_recvnext_source_addr()
	checked_run(function()
		local port = nextport()
		local client_port = nextport()
		local server = udp()
		server:bind('127.0.0.1', port)
		resume(sthread(function()
			local s = udp()
			s:bind('127.0.0.1', client_port)
			s:sendto('127.0.0.1', port, 'probe')
			s:close()
		end, 'client'))
		local buf = new'char[256]'
		local n, sa = server:recvnext(buf, 256)
		assert(str(buf, n) == 'probe')
		assert(issockaddr(sa))
		assert(sa:family() == 'ip')
		assert(sa:port() == client_port)
		server:close()
	end)
end

-- [6] Socket Options -----------------------------------------------------------

function test.sockopt_reuseaddr()
	checked_run(function()
		local s = tcp()
		s:setopt('so_reuseaddr', true)
		assert(s:getopt('so_reuseaddr') == true)
		s:setopt('so_reuseaddr', false)
		assert(s:getopt('so_reuseaddr') == false)
		s:close()
	end)
end

function test.sockopt_tcp_nodelay()
	checked_run(function()
		local s = tcp()
		s:setopt('tcp_nodelay', true)
		assert(s:getopt('tcp_nodelay') == true)
		s:close()
	end)
end

function test.sockopt_bufsize()
	checked_run(function()
		local s = tcp()
		s:setopt('so_sndbuf', 65536)
		local v = s:getopt('so_sndbuf')
		assert(v >= 65536) -- kernel may double it
		s:close()
	end)
end

function test.sockopt_keepalive()
	checked_run(function()
		local s = tcp()
		s:setopt('so_keepalive', true)
		assert(s:getopt('so_keepalive') == true)
		s:setopt('tcp_keepidle', 60)
		s:setopt('tcp_keepintvl', 10)
		s:setopt('tcp_keepcnt', 3)
		assert(s:getopt('tcp_keepidle') == 60)
		assert(s:getopt('tcp_keepintvl') == 10)
		assert(s:getopt('tcp_keepcnt') == 3)
		s:close()
	end)
end

function test.sockopt_linger()
	checked_run(function()
		local s = tcp()
		s:setopt('so_linger', 5)
		assert(s:getopt('so_linger') == 5)
		s:setopt('so_linger', false)
		assert(s:getopt('so_linger') == false)
		s:close()
	end)
end

function test.sockopt_readonly_error()
	checked_run(function()
		local s = tcp()
		local ok, err = pcall(s.setopt, s, 'so_type', 1)
		assert(not ok)
		s:close()
	end)
end

function test.sockopt_invalid()
	checked_run(function()
		local s = tcp()
		local ok, err = pcall(s.getopt, s, 'no_such_opt')
		assert(not ok)
		s:close()
	end)
end

-- [7] Timeout and Deadline Enforcement -----------------------------------------

function test.timeout_recv()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local s = mkclient(port)
			wait(0.2) -- don't send anything
			s:close()
		end, 'client'))
		local cs = server:accept()
		cs:settimeout(0.05, 'r')
		local buf = new'char[256]'
		local n, err = cs:try_recv(buf, 256)
		assert(err == 'timeout')
		cs:close()
		server:close()
	end)
end

function test.timeout_connect()
	checked_run(function()
		-- Connect to a non-routable address with short timeout
		local s = tcp()
		s:settimeout(0.05)
		local ok, err = s:try_connect('10.255.255.1', 1)
		assert(not ok)
		assert(err == 'timeout' or err) -- may be 'timeout' or other net error
		if not s:closed() then s:close() end
	end)
end

function test.socket_thread_cancel_recv_closes_socket()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local cs
		local recv_ok, recv_err
		local th = thread(function()
			cs = server:accept()
			recv_ok, recv_err = lua_pcall(function()
				cs:try_recv(BUF, 64)
			end)
		end, 'recv waiter')
		resume(th)
		local s = mkclient(port)
		wait(0.02)
		assert(cs)
		assert(th:try_cancel())
		assert(recv_ok == false)
		assert(recv_err == CANCEL)

		assert(cs:closed())
		local n, err = cs:try_recv(BUF, 64)
		assert(n == nil)
		assert(err == 'closed')
		s:close()
		server:close()
	end)
end

-- [8] Error and Edge Case Handling ---------------------------------------------

function test.error_ops_on_closed_socket()
	checked_run(function()
		local s = tcp()
		s:close()
		local ok, err = s:try_recv(BUF, 64)
		assert(not ok and err == 'closed')
		local ok, err = s:try_send'x'
		assert(not ok and err == 'closed')
		local ok, err = catch('closed', s.bind, s, '127.0.0.1', 0)
		assert(not ok)
		assert(iserror(err, 'closed'))
	end)
end

function test.local_addr_does_not_block_bind()
	checked_run(function()
		local s = tcp()
		assert(s:local_addr():port() == 0)
		s:bind('127.0.0.1', 0)
		local sa = s:local_addr()
		assert(sa:ip() == '127.0.0.1')
		assert(sa:port() ~= 0)
		s:close()
	end)
end

function test.error_bind_conflict()
	checked_run(function()
		local port = nextport()
		local s1 = tcp()
		s1:bind('127.0.0.1', port)
		local s2 = tcp()
		local ok, err = catch('net', s2.bind, s2, '127.0.0.1', port)
		assert(not ok)
		assert(iserror(err, 'net', 'address_already_in_use'))
		s1:close()
		s2:close()
	end)
end

function test.error_zero_len_send()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		resume(sthread(function()
			local cs = server:accept()
			cs:close()
			server:close()
		end, 'server'))
		local s = mkclient(port)
		local ok = s:try_send('', 0) -- zero-length send is a no-op
		assert(ok)
		s:close()
	end)
end

function test.error_recv_eof()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		-- client thread: connect then immediately close (sends FIN)
		resume(sthread(function()
			local s = mkclient(port)
			s:close()
		end, 'client'))
		-- outer thread accepts and recvs sequentially
		local cs = server:accept()
		local n, err = cs:try_recv(BUF, 64)
		assert(n == 0) -- EOF
		assert(err == nil)
		cs:close()
		server:close()
	end)
end

function test.error_recvn_eof()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		-- client sends only 2 bytes then closes
		resume(sthread(function()
			local s = mkclient(port)
			s:send'hi'
			s:close()
		end, 'client'))
		-- outer thread accepts and tries to recv 10 bytes (gets EOF after 2)
		local cs = server:accept()
		local buf = new'char[10]'
		local ok, err = pcall(cs.recvn, cs, buf, 10)
		assert(not ok)
		assert(tostring(err):find'eof')
		assert(str(buf, 2) == 'hi')
		cs:close()
		server:close()
	end)
end

function test.close_while_blocked_recv()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local s = mkclient(port)
		local cs
		local recv_n, recv_err
		resume(sthread(function()
			cs = server:accept()
			recv_n, recv_err = cs:try_recv(BUF, 64)
		end, 'server'))
		wait(0.02) -- let server thread reach the blocking recv
		cs:close()  -- cancel_wait_io fires
		s:close()
		server:close()
		assert(recv_n == nil)
		assert(recv_err == 'closed')
	end)
end

-- [9] Threading and Concurrency ------------------------------------------------

function test.concurrent_server_clients()
	checked_run(function()
		local port = nextport()
		local server = mkserver(port)
		local N = 10
		local received = 0
		resume(sthread(function()
			local hts = threadset()
			for i = 1, N do
				local cs = server:accept()
				resume(hts:thread(function()
					local buf = new'char[64]'
					local n = cs:recv(buf, 64)
					received = received + n
					cs:close()
				end, 'h'..i))
			end
			hts:join()
			server:close()
		end, 'server'))
		local ts = threadset()
		for i = 1, N do
			resume(ts:thread(function()
				local s = mkclient(port)
				s:send'x'
				s:close()
			end, 'c'..i))
		end
		ts:join()
		wait(0.05) -- let handler threads finish receiving
		assert(received == N)
	end)
end

-- [10] Mixed Protocol Scenarios ------------------------------------------------

function test.tcp_and_udp_same_port()
	checked_run(function()
		local port = nextport()
		-- TCP and UDP can share the same port number
		local tcp_got, udp_got
		local tserver = mkserver(port)
		local userver = udp()
		userver:bind('127.0.0.1', port)
		resume(sthread(function()
			local cs = tserver:accept()
			local buf = new'char[64]'
			local n = cs:recv(buf, 64)
			tcp_got = str(buf, n)
			cs:close()
			tserver:close()
		end, 'tcp-server'))
		resume(sthread(function()
			local buf = new'char[64]'
			local n = userver:recv(buf, 64)
			udp_got = str(buf, n)
			userver:close()
		end, 'udp-server'))
		resume(sthread(function()
			local s = mkclient(port)
			s:send'tcp-msg'
			s:close()
		end, 'tcp-client'))
		resume(sthread(function()
			local s = udp()
			s:connect('127.0.0.1', port)
			s:send'udp-msg'
			s:close()
		end, 'udp-client'))
		wait(0.1) -- let server threads receive
		assert(tcp_got == 'tcp-msg')
		assert(udp_got == 'udp-msg')
	end)
end

function test.ipv4_and_ipv6_loopback()
	checked_run(function()
		local port = nextport()
		local got4, got6
		-- IPv4 server
		local s4 = listen('127.0.0.1', port)
		resume(sthread(function()
			local c = connect('127.0.0.1', port); c:send'v4'; c:close()
		end, 'c4'))
		local cs4 = s4:accept()
		local buf4 = new'char[64]'
		got4 = str(buf4, cs4:recv(buf4, 64))
		cs4:close(); s4:close()
		-- IPv6 server on a separate port (skip gracefully if unavailable)
		local port6 = nextport()
		local ok6, s6 = pcall(listen, '[::1]', port6)
		if ok6 then
			resume(sthread(function()
				local c = connect('[::1]', port6); c:send'v6'; c:close()
			end, 'c6'))
			local cs6 = s6:accept()
			local buf6 = new'char[64]'
			got6 = str(buf6, cs6:recv(buf6, 64))
			cs6:close(); s6:close()
		else
			print('  ipv6 unavailable, skipping')
			got6 = 'v6'
		end
		assert(got4 == 'v4')
		assert(got6 == 'v6')
	end)
end

-- runner -----------------------------------------------------------------------

local name = ...
if name == 'sock_test' then name = nil end -- loaded as module: run all tests
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
		else --failures goto stderr
			pr('FAILED: ', k)
			pr(err)
			n_fail = n_fail + 1
			break
		end
	end
end
print(('ok: %d, failed: %d'):format(n_ok, n_fail))
