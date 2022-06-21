--go@ plink d10 -t -batch sdk/bin/linux/luajit sdk/tests/sock_test.lua

io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

require'glue'
require'os_thread'
require'sock'

local function test_addr()
	local function dump(...)
		for ai in getaddrinfo(...):addrs() do
			pr(ai:tostring(), ai:type(), ai:family(), ai:protocol(), ai:name())
		end
	end
	dump('1234:2345:3456:4567:5678:6789:7890:8901', 0, 'tcp', 'inet6')
	dump('123.124.125.126', 1234, 'tcp', 'inet', nil, {cannonname = true})
	dump('*', 0)
end

local function test_sockopt()
	local s = tcp()
	for _,k in ipairs{
		'error             ',
		'reuseaddr         ',
	} do
		if k then
			local sk, k = k, trim(k)
			local v, err = s:try_getopt(k)
			pr('getopt', sk, v, err)
		end
	end

	pr''

	for _,k in ipairs{
		'broadcast              ',
		'conditional_accept     ',
		'dontlinger             ',
		'dontroute              ',
		'exclusiveaddruse       ',
		'keepalive              ',
		'linger                 ',
		'max_msg_size           ',
		'oobinline              ',
		'pause_accept           ',
		'port_scalability       ',
		'randomize_port         ',
		'rcvbuf                 ',
		'rcvlowat               ',
		'rcvtimeo               ',
		'reuseaddr              ',
		'sndbuf                 ',
		'sndlowat               ',
		'sndtimeo               ',
		'update_accept_context  ',
		'update_connect_context ',
		'tcp_bsdurgent          ',
		'tcp_expedited_1122  	',
		'tcp_maxrt           	',
		'tcp_nodelay            ',
		'tcp_timestamps      	',
	} do
		local sk, k = k, trim(k)
		local canget, v, err = pcall(s.try_getopt, s, k)
		if canget and v ~= nil then
			pr('setopt', k, s:try_setopt(k, v))
		end
	end
end

local function start_server()
	pr'server'
	local server_thread = os_thread(function()
		require'sock'
		local s = tcp():listen('*', 8090)
		resume(thread(function()
			while true do
				pr'...'
				local cs = s:accept()
				pr('accepted', cs,
					cs.remote_addr, cs.remote_port,
					cs. local_addr, cs. local_port)
				pr('accepted_thread', currentthread())
				thread(function()
					pr'closing cs'
					--cs:recv(buf, len)
					cs:close()
					pr('closed', currentthread())
				end)
				pr('backto accepted_thread', currentthread())
			end
			s:close()
		end))
		start()
	end)

	-- local s = tcp()
	-- --s:bind('127.0.0.1', 8090)
	-- pr(s:connect('127.0.0.1', '8080'))
	-- --s:send'hello'
	-- s:close()

	server_thread:join()
end

local function start_client()
	pr'client'
	local s = tcp()
	resume(thread(function()
		pr'...'
		s:connect('10.0.0.5', 8090, 1)
		s:send'hello'
		s:close()
		stop()
	end))
	start()
end

local function test_http()
	thread(function()
		local s = tcp()
		pr('connect', s:connect(ffi.abi'win' and '127.0.0.1' or '10.8.2.153', 80))
		pr('send', s:send'GET / HTTP/1.0\r\n\r\n')
		local buf = ffi.new'char[4096]'
		local n, err, ec = s:recv(buf, 4096)
		if n then
			pr('recv', n, ffi.string(buf, n))
		else
			pr(n, err, ec)
		end
		s:close()
	end)
	pr('start', start())
end

local function test_timers()
	run(function()
		local i = 1
		local job = runevery(.1, function()
			pr(i); i = i + 1
		end)
		runafter(1, function()
			pr'canceling'
			job:cancel()
			pr'done'
		end)
	end)
end

test_timers()
test_addr()
test_sockopt()
--test_http()

if win then
	start_server()
else
	start_client()
end
