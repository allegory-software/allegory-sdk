require'glue'
require'epoll'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v); rawset(t, #t+1, k)
end})

local _terr

local function sthread(f, name)
	local t = thread(f, name)
	t:onclose(function(th, ok, err)
		if not ok then
			_terr = _terr and (_terr..'\n'..tostring(err)) or tostring(err)
		end
	end)
	return t
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

-- Wait jobs -----------------------------------------------------------------

function test.wait_job_resume_args()
	checked_run(function()
		local job
		local r1, r2
		resume(sthread(function()
			job = wait_job()
			r1, r2 = job:wait(10)
		end, 'waiter'))
		job:resume('hello', 42)
		assert(r1 == 'hello')
		assert(r2 == 42)
	end)
end

function test.wait_and_cancel()
	checked_run(function()
		local job
		local result
		resume(sthread(function()
			job = wait_job()
			result = job:wait(10)
		end, 'waiter'))
		job:cancel()
		assert(result == CANCEL)
	end)
end

-- Timers --------------------------------------------------------------------

function test.runat_fires()
	checked_run(function()
		local fired = false
		runat(clock() + 0.05, function()
			fired = true
		end)
		wait(0.1)
		assert(fired)
	end)
end

function test.runat_cancel()
	checked_run(function()
		local fired = false
		local job = runat(clock() + 0.05, function()
			fired = true
		end)
		job:cancel()
		wait(0.1)
		assert(not fired)
	end)
end

function test.runevery()
	checked_run(function()
		local count = 0
		local job = runevery(0.02, function()
			count = count + 1
		end)
		wait(0.1)
		job:cancel()
		assert(count >= 3)
	end)
end

-- Threads -------------------------------------------------------------------

function test.threadset_join()
	checked_run(function()
		local ts = threadset()
		local results = {}
		for i = 1, 5 do
			resume(ts:thread(function()
				wait(0.01)
				results[#results+1] = i
			end))
		end
		local ok = ts:join()
		assert(ok)
		assert(#results == 5)
	end)
end

function test.threadset_join_resumes_waiter()
	local joined = false
	local child
	checked_run(function()
		local ts = threadset()
		child = ts:thread(function()
			wait(0)
		end)
		resume(child)
		local ok = ts:join()
		assert(ok)
		joined = true
	end)
	assert(joined)
	assert(child:status() == 'dead')
end

function test.thread_cofinish_resumes_target()
	local joined = false
	local child
	checked_run(function()
		local parent = currentthread()
		child = thread(function()
			wait(0)
			return finishthread(parent, 'done')
		end)
		resume(child)
		local ret = suspend()
		assert(ret == 'done')
		assert(child:status() == 'dead')
		joined = true
	end)
	assert(joined)
	assert(child:status() == 'dead')
end

function test.threadset_error_propagation()
	checked_run(function()
		local ts = threadset()
		resume(ts:thread(function()
			error'boom'
		end))
		resume(ts:thread(function()
			wait(0)
		end))
		local ok, err = ts:join()
		assert(not ok)
		assert(tostring(err):find'boom')
	end)
end

function test.threadset_join_empty()
	checked_run(function()
		local ts = threadset()
		local ok, err = ts:join()
		assert(ok)
		assert(err == nil)
	end)
end

function test.thread_env_inherit()
	checked_run(function()
		local env = currentthread():ownenv()
		env.testval = 42
		local child_val
		resume(sthread(function()
			child_val = currentthread().env.testval
		end, 'child'))
		assert(child_val == 42)
	end)
end

function test.run_when_already_running()
	checked_run(function()
		local called = false
		wait(0)
		local ret = run(function()
			called = true
			return 42
		end)
		assert(called)
		assert(ret == 42)
	end)
end

-- runner --------------------------------------------------------------------

local name = ...
if name == 'epoll_test' then name = nil end -- loaded as module: run all tests
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
