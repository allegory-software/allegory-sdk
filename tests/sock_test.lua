
io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

require'glue'
require'os_thread'
require'sock'

local function test_addr()
	local function dump(...)
		for ai in assert(sockaddr(...)):addrs() do
			print(ai:tostring(), ai:type(), ai:family(), ai:protocol(), ai:name())
		end
	end
	dump('1234:2345:3456:4567:5678:6789:7890:8901', 0, 'tcp', 'inet6')
	dump('123.124.125.126', 1234, 'tcp', 'inet', nil, {cannonname = true})
	dump('*', 0)
end

local function test_sockopt()
	local s = assert(tcp())
	for _,k in ipairs{
		'error             ',
		'reuseaddr         ',
	} do
		if k then
			local sk, k = k, trim(k)
			local v = s:getopt(k)
			print(sk, v)
		end
	end

	print''

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
		local canget, v = pcall(s.getopt, s, k)
		if canget then
			print(k, pcall(s.setopt, s, k, v))
		end
	end
end

local function start_server()
	pr'server'
	local server_thread = os_thread(function()
		require'sock'
		require'logging'
		local s = assert(tcp())
		assert(s:listen('*', 8090))
		resume(thread(function()
			while true do
				print'...'
				local cs = assert(s:accept())
				pr('accepted', cs,
					cs.remote_addr, cs.remote_port,
					cs. local_addr, cs. local_port)
				pr('accepted_thread', currentthread())
				thread(function()
					print'closing cs'
					--cs:recv(buf, len)
					assert(cs:close())
					print('closed', currentthread())
				end)
				print('backto accepted_thread', currentthread())
			end
			s:close()
		end))
		start()
	end)

	-- local s = assert(tcp())
	-- --assert(s:bind('127.0.0.1', 8090))
	-- print(s:connect('127.0.0.1', '8080'))
	-- --assert(s:send'hello')
	-- s:close()

	server_thread:join()
end

local function start_client()
	pr'client'
	local s = assert(tcp())
	resume(thread(function()
		print'...'
		print(assert(s:connect('10.0.0.5', 8090, 1)))
		print(assert(s:send'hello'))
		print(assert(s:close()))
		stop()
	end))
	start()
end

local function test_http()

	thread(function()

		local s = assert(tcp())
		print('connect', s:connect(ffi.abi'win' and '127.0.0.1' or '10.8.2.153', 80))
		print('send', s:send'GET / HTTP/1.0\r\n\r\n')
		local buf = ffi.new'char[4096]'
		local n, err, ec = s:recv(buf, 4096)
		if n then
			print('recv', n, ffi.string(buf, n))
		else
			print(n, err, ec)
		end
		s:close()

	end)

	print('start', start(1))

end

local function test_timers()
	run(function()
		local i = 1
		local job = runevery(.1, function()
			print(i); i = i + 1
		end)
		runafter(1, function()
			print'canceling'
			job:cancel()
			print'done'
		end)
	end)
end

local function test_errors()
	local check_io, checkp, check, protect = tcp_protocol_errors'test'
	local t = {tcp = {close = function(self) self.closed = true end}}
	t.test0 = protect(function(t) check(t) end)
	t.test1 = protect(function(t) checkp(t, nil, 'see %d', 123) end)
	t.test2 = protect(function(t) check_io(t, nil, 'see %d', 321) end)
	t.test3 = protect(function(t) checkp(t) end)
	local _, err = t:test0()
	print(tostring(err), getmetatable(err).__tostring(err))
	assert(iserror(err))
	assert(not t.tcp.closed)
	pr(t:test1())
	assert(t.tcp.closed)
	pr(t:test2())
	pr(t:test3())
end

test_errors()
test_timers()
test_addr()
test_sockopt()
test_http()

if win then
	start_server()
else
	start_client()
end

