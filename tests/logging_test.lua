require'glue'
require'logging'
require'sock'
require'fs'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v); rawset(t, #t+1, k)
end})

local _terr
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

local PORT = 11999

-- Client/server -------------------------------------------------------------

function test.client_server_log()
	checked_run(function()
		local server = logging.new()
		server.quiet = true
		local got, done = nil, wait_job()
		function server:onlog(client, e)
			got = e
			runafter(0, function() done:resume() end)
		end
		server:listen('127.0.0.1', PORT)

		local client = logging.new()
		client.quiet = true
		client.deploy = 'depl-x'
		client:toserver('127.0.0.1', PORT)
		client.log('warn', 'mod', 'ev', 'hello %s', 'world')

		done:wait(2)
		assert(got, 'no log received')
		assert(got.severity == 'warn', tostring(got.severity))
		assert(got.module == 'mod')
		assert(got.event == 'ev')
		assert(got.message:find('hello world'), got.message)
		assert(got.deploy == 'depl-x')

		client:toserver_stop()
		server:listen_stop()
	end)
end

function test.client_server_var()
	checked_run(function()
		local server = logging.new()
		server.quiet = true
		local done = wait_job()
		function server:onvar(client, e)
			if e.k == 'mykey' then
				runafter(0, function() done:try_resume() end)
			end
		end
		server:listen('127.0.0.1', PORT)

		local client = logging.new()
		client.quiet = true
		client:toserver('127.0.0.1', PORT)
		client.logvar('mykey', 'myval')

		done:wait(2)
		assert(#server.clients == 1)
		assert(server.clients[1].vars.mykey == 'myval')

		client:toserver_stop()
		server:listen_stop()
	end)
end

function test.server_rpc_to_client()
	checked_run(function()
		local server = logging.new()
		server.quiet = true
		local connected = wait_job()
		function server:onvar(client, e)
			runafter(0, function() connected:try_resume() end)
		end
		server:listen('127.0.0.1', PORT)

		local client = logging.new()
		client.quiet = true
		local rpc_done = wait_job()
		logging.rpc.set_test = function(self, v)
			self.test_val = v
			runafter(0, function() rpc_done:resume() end)
		end
		client:toserver('127.0.0.1', PORT)

		connected:wait(2) --wait until a client is registered
		server:rpc_call(server.clients[1], 'set_test', 42)

		rpc_done:wait(2)
		assert(client.test_val == 42)

		logging.rpc.set_test = nil
		client:toserver_stop()
		server:listen_stop()
	end)
end

function test.server_rpc_send_timeout_removes_client()
	checked_run(function()
		local server = logging.new()
		server.quiet = true
		server:listen('127.0.0.1', PORT)

		local peer = connect('127.0.0.1', PORT)
		wait(.05)
		assert(#server.clients == 1, 'client not registered')

		local client = server.clients[1]
		local ctcp = client.tcp
		ctcp:setopt('so_sndbuf', 4096)
		ctcp:settimeout(.05, 'w')

		server:rpc_call(client, 'probe', ('x'):rep(8 * 1024^2))
		wait(.2)

		local nclients = #server.clients
		local closed = ctcp:closed()
		server:listen_stop()
		peer:try_close()

		assert(nclients == 0, 'stale client after RPC send timeout')
		assert(closed, 'client TCP remains open after RPC send timeout')
	end)
end

function test.server_rpc_call_does_not_block_when_queue_is_full()
	checked_run(function()
		local server = logging.new()
		server.quiet = true
		server:listen('127.0.0.1', PORT)

		local peer = connect('127.0.0.1', PORT)
		wait(.05)
		assert(#server.clients == 1, 'client not registered')

		local client = server.clients[1]
		client.tcp:setopt('so_sndbuf', 4096)
		server:rpc_call(client, 'probe', ('x'):rep(8 * 1024^2))
		server:rpc_call(client, 'queued')

		local ok, err = server:rpc_call(client, 'full')
		assert(not ok and err == 'full')

		peer:close()
		wait(.05)
		server:listen_stop()
	end)
end

function test.client_reconnects_after_idle_disconnect()
	checked_run(function()
		local server = logging.new()
		server.quiet = true
		local connected = wait_job()
		function server:onvar(client, e)
			if e.k == 'probe' then
				runafter(0, function() connected:try_resume() end)
			end
		end
		server:listen('127.0.0.1', PORT)

		local client = logging.new()
		client.quiet = true
		client.logvar('probe', true)
		client:toserver('127.0.0.1', PORT, nil, .05)

		connected:wait(2)
		local old_tcp = server.clients[1].tcp
		old_tcp:close()
		connected:wait(2)

		assert(#server.clients == 1)
		assert(server.clients[1].tcp ~= old_tcp)

		client:toserver_stop()
		server:listen_stop()
	end)
end

-- File logging --------------------------------------------------------------

local function tmp_logfile()
	return '/tmp/logging_test_'..os.time()..'_'..math.random(1, 999999)..'.log'
end

function test.tofile_writes()
	checked_run(function()
		local logfile = tmp_logfile()
		local l = logging.new()
		l.quiet = true
		l:tofile(logfile)
		l.log('warn', 'm', 'e', 'hello-disk')
		l:tofile_stop()
		local f = io.open(logfile, 'r')
		assert(f, 'logfile not created')
		local s = f:read('*a')
		f:close()
		os.remove(logfile)
		assert(s:find('hello-disk', 1, true), s)
	end)
end

function test.tofile_rotates()
		checked_run(function()
			local logfile = tmp_logfile()
			local logfile0 = logfile:gsub('(%.[^%.]+)$', '0%1')
			if logfile0 == logfile then logfile0 = logfile..'0' end
			local l = logging.new()
		l.quiet = true
		l:tofile(logfile, 200) --rotate when size > 100
		for i = 1, 10 do
			l.log('warn', 'm', 'e', 'msg-%d-padding-padding', i)
		end
		l:tofile_stop()
		local f = io.open(logfile0, 'r')
		assert(f, 'rotated file not created')
		f:close()
		os.remove(logfile)
		os.remove(logfile0)
	end)
end

-- Utilities -----------------------------------------------------------------

function test.logarg_formats()
	assert(logarg(nil) == 'nil')
	assert(logarg(true) == 'Y')
	assert(logarg(false) == 'N')
	assert(logarg(42) == 42)
	assert(logarg('plain') == 'plain')
	--binary string becomes hex block
	local s = logarg('\1\2\3')
	assert(type(s) == 'string')
	assert(s:find('\n\n', 1, true), s)
end

-- runner --------------------------------------------------------------------

local name = ...
if name == 'logging_test' then name = nil end
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
if n_fail == 0 then print'logging ok' end
if n_fail > 0 then os.exit(1) end
