--go@ plink d10 -t -batch sdk/bin/linux/luajit sdk/tests/proc_test.lua

require'proc'
require'sock'

io.stdin:setvbuf'no'
io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

local tests = {}
local test = setmetatable({}, {__newindex = function(self, k, v)
	rawset(self, k, v)
	add(tests, k)
end})

function test.env()
	env('zz', '123')
	env('zZ', '567')
	if win then
		assert(env('zz') == '567')
		assert(env('zZ') == '567')
	else
		assert(env('zz') == '123')
		assert(env('zZ') == '567')
	end
	env('zz', false)
	env('zZ', false)
	assert(not env'zz')
	assert(not env'zZ')
	env('Zz', '321')
	local t = env()
	pr(t)
	assert(t.Zz == '321')
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

function test.kill()
	local luajit = exepath()

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
	assert(p:kill())
	sleep(.5)
	assert(select(2, p:kill()) == 'killed')
	sleep(.5)
	print('exit code', p:exit_code())
	print('exit code', p:exit_code())
	--assert(p:exit_code() == 123)
	p:forget()
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
				assert(p.stdin:write(s))
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
	if win then
		assert(exec{cmd = 'notepad', autokill = true})
		print'waiting 1s'
		sleep(1)
	else
		assert(exec{cmd = '/bin/sleep 123', autokill = true})
		print'waiting 5s'
		sleep(5)
	end
	print'done'
end

function test_all()
	for i,k in ipairs(tests) do
		print'+--------------------------------------------------------------+'
		print(string.format('| %-60s |', k))
		print'+--------------------------------------------------------------+'
		test[k]()
	end
end

function test.esc()
	if win then
		assert(cmdline_quote_arg[[a\"xx"yx\\\]] == [["a\\\"xx\"yx\\\\\\"]])
	else
		--TODO
	end
end

--test.env()
--test.esc()
--test.pipe()
--test.autokill()
--test.kill()
--test.exec_lua()
test_all()
