--[=[
	WebSocket loopback smoke test.
	Spins up an http_server on 127.0.0.1, runs a small ws client through
	each scenario, and exits.
]=]

require'glue'
require'http_server'
require'websocket'

local PORT = 18890

local n_ok, n_fail = 0, 0
local function test(name, fn)
	local ok, err = xpcall(fn, debug.traceback)
	if ok then
		print('ok:   '..name)
		n_ok = n_ok + 1
	else
		print('fail: '..name)
		io.stderr:write(tostring(err)..'\n')
		n_fail = n_fail + 1
	end
end

local server = http_server{
	listen = {{host = '*', addr = '127.0.0.1', port = PORT}},
	respond = function(req)
		if req.uri == '/echo' then
			local ws = websocket_upgrade(req)
			while true do
				local msg, kind = ws:recv()
				if not msg then break end
				ws:send(msg, kind)
			end
		elseif req.uri == '/echo-chunked' then
			local ws = websocket_upgrade(req)
			while true do
				local s, kind, fin = ws:recv_chunk()
				if not s then break end
				ws:send_chunk(s, kind, fin)
			end
		elseif req.uri == '/closer' then
			local ws = websocket_upgrade(req)
			ws:send('hi')
			ws:close(1000, 'bye')
		elseif req.uri == '/pinger' then
			local ws = websocket_upgrade(req)
			ws:ping('ping?')
			local m = ws:recv()
			ws:send(m or '<closed>')
			ws:close()
		else
			raise('http_response', {status = 404, content = 'no such ws route\n'})
		end
	end,
}

local function url(path) return 'ws://127.0.0.1:'..PORT..path end

run(function()

	test('echo text', function()
		local ws = websocket_connect(url'/echo')
		ws:send('hello')
		local m, k = ws:recv()
		assert(m == 'hello', 'got '..tostring(m))
		assert(k == 'text', 'kind '..tostring(k))
		ws:close()
	end)

	test('echo binary', function()
		local ws = websocket_connect(url'/echo')
		local bin = '\0\1\2\xfd\xfe\xff'
		ws:send(bin, 'binary')
		local m, k = ws:recv()
		assert(m == bin)
		assert(k == 'binary')
		ws:close()
	end)

	test('echo medium (16-bit length)', function()
		local ws = websocket_connect(url'/echo')
		local s = string.rep('A', 300)  --> u16 ext length
		ws:send(s)
		assert(ws:recv() == s)
		ws:close()
	end)

	test('echo large (64-bit length)', function()
		local ws = websocket_connect(url'/echo')
		local s = string.rep('X', 100000)  --> u64 ext length
		ws:send(s)
		local m = ws:recv()
		assert(#m == 100000 and m == s)
		ws:close()
	end)

	test('chunked send and recv', function()
		local ws = websocket_connect(url'/echo')
		ws:send_chunk('abc')
		ws:send_chunk('def')
		ws:send_chunk('ghi', nil, true)
		assert(ws:recv() == 'abcdefghi')
		ws:close()
	end)

	test('recv_chunk preserves fragmentation', function()
		local ws = websocket_connect(url'/echo-chunked')
		ws:send_chunk('one', 'text')
		ws:send_chunk('two')
		ws:send_chunk('end', nil, true)
		local s1, k1, f1 = ws:recv_chunk()
		local s2, k2, f2 = ws:recv_chunk()
		local s3, k3, f3 = ws:recv_chunk()
		assert(s1 == 'one' and k1 == 'text' and f1 == false, 'frame 1')
		assert(s2 == 'two' and k2 == 'text' and f2 == false, 'frame 2')
		assert(s3 == 'end' and k3 == 'text' and f3 == true , 'frame 3')
		ws:close()
	end)

	test('recv_chunk enforces message limit', function()
		local ws = websocket_connect(url'/echo-chunked', {max_message_size = 5})
		ws:send_chunk('abc', 'text')
		ws:send_chunk('def', nil, true)
		local s, k, fin = ws:recv_chunk()
		assert(s == 'abc' and k == 'text' and fin == false)
		local ok, err = catch('protocol', ws.recv_chunk, ws)
		assert(not ok)
		assert(iserror(err, 'protocol'))
		assert(err.message == 'message too big')
		ws:try_close_socket()
	end)

	test('peer-initiated close with code/reason', function()
		local ws = websocket_connect(url'/closer')
		assert(ws:recv() == 'hi')
		local m, code, reason = ws:recv()
		assert(m == nil, 'expected nil msg')
		assert(code == 1000, 'got code '..tostring(code))
		assert(reason == 'bye', 'got reason '..tostring(reason))
	end)

	test('ping is replied with pong (handled inside recv)', function()
		--server sends a ping, then waits for a normal recv;
		--client's recv() must swallow the ping (no message returned) but
		--the implicit pong reply must reach the server so it can recv 'foo'.
		local ws = websocket_connect(url'/pinger')
		ws:send('foo')
		local m = ws:recv()
		assert(m == 'foo', 'got '..tostring(m))
	end)

	test('text payload is not utf-8 validated', function()
		local ws = websocket_connect(url'/echo')
		local s = '\xff\xfe'
		ws:send(s, 'text')
		local m, k = ws:recv()
		assert(m == s)
		assert(k == 'text')
		ws:close()
	end)

	server:stop()
end)

print(string.format('---\n%d ok, %d fail', n_ok, n_fail))
if n_fail == 0 then print'websocket ok' end
os.exit(n_fail > 0 and 1 or 0)
