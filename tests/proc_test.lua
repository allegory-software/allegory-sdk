--go@ plink d10 -t -batch sdk/bin/linux/luajit sdk/tests/proc_test.lua

require'proc'
require'sock'
require'fs'

io.stdin:setvbuf'no'
io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

chdir(exedir()..'/../tests')

local tests = {}
local test = setmetatable({}, {__newindex = function(self, k, v)
	rawset(self, k, v)
	add(tests, k)
end})

local WNOHANG = 1

function test.env()
	env('zz', '123')
	env('zZ', '567')
	assert(env('zz') == '123')
	assert(env('zZ') == '567')
	env('zz', false)
	env('zZ', false)
	assert(not env'zz')
	assert(not env'zZ')
	env('Zz', '321')
	local t = env()
	assert(t.Zz == '321')
	assert(basename(t.PWD) == basename(startcwd()))
end

function test.exec_lua()
	local p = exec_lua[[
		print'hello from subprocess'
		os.exit(123)
	]]
	run(function()
		p:wait()
		assert(p:exit_code() == 123)
		p:forget()
	end)
end

function test.exec_fail_closes()
	local owner = _own(mainthread(), {})
	local p, err = try_exec{
		cmd = '/definitely/not/here',
		stdin = true,
		stdout = true,
		stderr = true,
		owner = owner,
	}
	assert(not p)
	assert(err == 'not_found')
	if owner.owns then
		for i,res in ipairs(owner.owns) do
			assert(not res)
		end
	end

	local noexec = 'proc_test_noexec'
	save(noexec, '#!/bin/sh\nexit 0\n')
	chmod(noexec, tonumber('600', 8))
	local ok, err = pcall(try_exec, {
		cmd = abspath(noexec),
		stdin = true,
		stdout = true,
		stderr = true,
		owner = owner,
	})
	rmfile(noexec)
	assert(not ok)
	assert(iserror(err, 'proc'))
	assert(err.message == 'access_denied', tostring(err))
	if owner.owns then
		for i,res in ipairs(owner.owns) do
			assert(not res)
		end
	end
	owner:try_close()
end

function test.exec_error()
	local ok, err = pcall(exec, '/definitely/not/here')
	assert(not ok)
	assert(iserror(err, 'proc'))
	assert(err.message == 'not_found', tostring(err))
end

function test.kill_errors()
	local ok, err = kill(999999999)
	assert(not ok)
	assert(err == 'no_such_process')

	local ok, err = pcall(kill, getpid(), 999999)
	assert(not ok)
	assert(iserror(err, 'proc'))
	assert(err.message == 'invalid_argument', tostring(err))
end

function test.external_reap()
	local p = exec{exefile(), '-e', 'os.exit(7)'}
	local status = new'int[1]'
	assert(C.waitpid(p.pid, status, 0) == p.pid)
	local ok, err = pcall(p.exit_code, p)
	assert(not ok)
	assert(iserror(err, 'proc'))
	p:forget()
end

function test.kill()
	local luajit = exefile()

	local p, err, errno = exec(
		{luajit, '-e', 'local n=.12; for i=1,1000000000 do n=n*0.5321 end; print(n); os.exit(123)'},
		--{'-e', 'print(os.getenv\'XX\', require\'fs\'.cd()); os.exit(123)'},
		{XX = 55},
		exedir()
	)
	if not p then print(err, errno) end
	assert(p)
	print('pid:', p.pid)
	print'sleeping'
	sleep(.5)
	print'killing'
	p:kill()
	sleep(.5)
	assert(select(2, p:kill()) == 'already_killed')
	sleep(.5)
	print('exit code', p:exit_code())
	print('exit code', p:exit_code())
	--assert(p:exit_code() == 123)
	p:forget()
end

function test.forget_reaps()
	local forgotten_pid
	run(function()
		local waited = exec{'/bin/true'}
		local forgotten = exec{'/bin/sleep', '.1'}
		forgotten_pid = forgotten.pid
		forgotten:forget()
		assert(waited:wait() == 0)
		waited:forget()
	end)
	local status = new'int[1]'
	local reaped = C.waitpid(forgotten_pid, status, WNOHANG)
	assertf(reaped == -1, 'forgotten process %d was not reaped: %d',
		forgotten_pid, reaped)

	local killed_pid
	run(function()
		local killed = exec{'/bin/sleep', '10'}
		killed_pid = killed.pid
		killed:try_close()
	end)
	local reaped = C.waitpid(killed_pid, status, WNOHANG)
	assertf(reaped == -1, 'killed process %d was not reaped: %d',
		killed_pid, reaped)
end

function test.pipe()

	save('proc_test_pipe.lua', [[
io.stdin:setvbuf'no'
io.stdout:setvbuf'no'
io.stderr:setvbuf'no'
require'glue'
sleep(.1)
print'Started'
sleep(.1)
local n = assert(io.stdin:read('*n'))
print('Got '..n)
sleep(.1)
io.stderr:write'Error1\n'
sleep(.1)
print'Hello1'
sleep(.1)
io.stderr:write'Error2\n'
sleep(.1)
print'Hello2'
io.stderr:write'Error3\n'
sleep(.1)
print'Hello3'
sleep(.1)
print'Waiting for EOF'
assert(io.stdin:read('*a') == '\n')
assert(io.stdin:read('*a') == '') --eof
print'Exiting'
os.exit(123)
]])

	local sz = 1024

	run(function()

		local p = assert(exec_lua_file({
			script = 'proc_test_pipe.lua',
			stdin = true,
			stdout = true,
			stderr = true,
			autokill = true,
		}))

		if p.stdin then
			resume(thread(function()
				local s = '1234\n'
				p.stdin:write(s)
				p.stdin:close()
			end))
		end

		if p.stdout then
			resume(thread(function()
				local buf = u8a(sz)
				while true do
					local len = assert(p.stdout:read(buf, sz))
					if len > 0 then
						io.stdout:write(str(buf, len))
					else
						p.stdout:close()
						break
					end
				end
			end))
		end

		if p.stderr then
			resume(thread(function()
				local buf = u8a(sz)
				while true do
					local len = assert(p.stderr:read(buf, sz))
					if len > 0 then
						io.stdout:write(str(buf, len))
					else
						p.stderr:close()
						break
					end
				end
			end))
		end

		print('Process finished. Exit code:', p:wait(1/0))

		while
			   (p.stdin  and not p.stdin :closed())
			or (p.stdout and not p.stdout:closed())
			or (p.stderr and not p.stderr:closed())
		do
			print'Still waiting for the pipes to close...'
			print(catargs(' ',
				p.stdin  and not p.stdin :closed() and 'stdin' or nil,
				p.stdout and not p.stdout:closed() and 'stdout' or nil,
				p.stderr and not p.stderr:closed() and 'stderr' or nil
			))
			sleep(.1)
		end

		assert(os.remove('proc_test_pipe.lua'))

	end)

end

function test.autokill()
	assert(exec{cmd = '/bin/sleep 123', autokill = true})
	print'waiting 1s'
	sleep(1)
	print'done'
end

function test.cmdline_split_args()
	local function check(s, ecmd, ...)
		local eargs = select('#', ...) > 0 and {...} or nil
		local cmd, args = cmdline_split_args(s)
		assert(cmd == ecmd, string.format('cmd: %q ~= %q', tostring(cmd), tostring(ecmd)))
		if eargs then
			assert(args and #args == #eargs)
			for i, v in ipairs(eargs) do
				assert(args[i] == v, string.format('arg[%d]: %q ~= %q', i, tostring(args[i]), v))
			end
		else
			assert(not args, 'expected no args')
		end
	end
	check('/bin/ls',    '/bin/ls')                            -- no args
	check('  /bin/ls  ', '/bin/ls')                          -- leading/trailing spaces
	check('/bin/ls -la /tmp',                '/bin/ls', '-la', '/tmp')    -- multiple plain args
	check('/bin/echo "hello world"',         '/bin/echo', 'hello world')  -- double-quoted arg with space
	check("/bin/echo 'hello world'",         '/bin/echo', 'hello world')  -- single-quoted arg with space
	check('/bin/echo "say \\"hi\\""',        '/bin/echo', 'say "hi"')     -- escaped quote inside dquoted
	check('/bin/echo "back\\\\slash"',       '/bin/echo', 'back\\slash')  -- escaped backslash in dquoted
	check("/bin/echo 'no \\escape here'",    '/bin/echo', 'no \\escape here') -- no escaping in squoted
	check('/bin/echo foo\\ bar',             '/bin/echo', 'foo bar')      -- backslash-escaped space
	check('/bin/echo un"quo"ted',            '/bin/echo', 'unquoted')     -- adjacent quoted+unquoted
	check('cmd a b c',                       'cmd', 'a', 'b', 'c')        -- many args
	check('cmd "" arg',                      'cmd', '', 'arg')             -- empty double-quoted arg
	check("cmd '' arg",                      'cmd', '', 'arg')             -- empty single-quoted arg
	check("cmd\t\ta\tb",                     'cmd', 'a', 'b')             -- tabs as whitespace
	check([[cmd "foo"'bar'baz]],             'cmd', 'foobarbaz')           -- mixed adjacent segments
	check('"/path to/cmd" arg',              '/path to/cmd', 'arg')        -- quoted cmd with space
	assert(not cmdline_split_args(''))                                           -- empty string -> nil
	assert(not cmdline_split_args('   '))                                        -- only spaces -> nil
	-- roundtrip: cmdline_quote_cmd -> cmdline_split_args
	local orig = {'/usr/bin/grep', 'hello world', "it's", 'back\\slash'}
	local s = cmdline_quote_cmd(orig)
	local cmd, args = cmdline_split_args(s)
	assert(cmd == orig[1], 'roundtrip cmd')
	for i = 2, #orig do
		assert(args[i-1] == orig[i], string.format('roundtrip arg[%d]: %q ~= %q', i-1, tostring(args[i-1]), orig[i]))
	end
end

function test_all(test_name)
	for i,k in ipairs(tests) do
		if not test_name or k == test_name then
			test[k]()
			print('test.'..k..' ok')
		end
	end
	print'proc ok'
end
test_all(... ~= 'proc_test' and ... or nil)
