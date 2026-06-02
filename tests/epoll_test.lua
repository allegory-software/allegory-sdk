require'glue'
require'epoll'
require'fs'
require'proc'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v); rawset(t, #t+1, k)
end})

local _terr

local function sthread(f, name)
	return thread(function(...)
		local ok, err = pcall(f, ...)
		if not ok then
			_terr = _terr and (_terr..'\n'..tostring(err)) or tostring(err)
		end
	end, name)
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

local function capture_log(f)
	local logs = {}
	local old_log = log
	log = function(...)
		logs[#logs+1] = {...}
	end
	local ok, err = xpcall(function() f(logs) end, debug.traceback)
	log = old_log
	assert(ok, err)
	return logs
end

local function logs_contain(logs, s)
	for _, e in ipairs(logs) do
		for i = 1, #e do
			if tostring(e[i]):find(s, 1, true) then
				return true
			end
		end
	end
	return false
end

local function assert_cancel(ok, err)
	assert(ok == false)
	assert(err == CANCEL)
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
		local ok, err
		resume(sthread(function()
			job = wait_job()
			ok, err = lua_pcall(function()
				job:wait(10)
			end)
		end, 'waiter'))
		job:cancel()
		assert(ok == false)
		assert(err == CANCEL)
	end)
end

function test.wait_job_try_resume_misuse()
	checked_run(function()
		local job = wait_job()
		local ok, err = job:try_resume('unused')
		assert(ok == nil)
		assert(tostring(err):find('not waiting', 1, true))

		ok, err = pcall(function()
			job:resume('unused')
		end)
		assert(not ok)
		assert(tostring(err):find('not waiting', 1, true))

		job:cancel()
	end)
end

function test.wait_timeout_returns_timeout()
	checked_run(function()
		local ok, err = wait(0)
		assert(ok == nil)
		assert(err == 'timeout')
	end)
end

-- Wait queue ----------------------------------------------------------------

function test.wait_queue_try_push_pull()
	checked_run(function()
		local q = wait_queue(3)
		assert(q:try_push('a'))
		assert(q:try_push('b'))
		assert(q:try_pull() == 'a')
		assert(q:try_pull() == 'b')
		assert(q:try_pull() == nil)
	end)
end

function test.wait_queue_try_push_full()
	checked_run(function()
		local q = wait_queue(2)
		assert(q:try_push(1))
		assert(q:try_push(2))
		local ok, err = q:try_push(3)
		assert(not ok)
		assert(err == 'full')
	end)
end

function test.wait_queue_try_push_wakes_puller()
	checked_run(function()
		local q = wait_queue(1)
		local got
		resume(sthread(function()
			got = q:pull()
		end, 'puller'))
		assert(got == nil)
		assert(q:try_push('x'))
		assert(got == 'x')
	end)
end

function test.wait_queue_try_pull_wakes_pusher()
	checked_run(function()
		local q = wait_queue(1)
		assert(q:push('x'))
		local pushed = false
		resume(sthread(function()
			q:push('y')
			pushed = true
		end, 'pusher'))
		assert(not pushed)
		assert(q:try_pull() == 'x')
		assert(pushed)
		assert(q:try_pull() == 'y')
	end)
end

function test.wait_queue_push_blocks_then_wakes()
	checked_run(function()
		local q = wait_queue(2)
		assert(q:push(1))
		assert(q:push(2))
		local pushed = false
		resume(sthread(function()
			q:push(3) --blocks: queue is full
			pushed = true
		end, 'pusher'))
		assert(not pushed) --pusher is suspended
		assert(q:pull() == 1) --makes room, wakes pusher
		assert(pushed)
		assert(q:pull() == 2)
		assert(q:pull() == 3)
	end)
end

function test.wait_queue_push_cancel()
	checked_run(function()
		local q = wait_queue(1)
		assert(q:push('x'))
		local ok, err
		local t = sthread(function()
			ok, err = lua_pcall(function() q:push('y') end)
		end, 'pusher')
		resume(t)
		t:cancel()
		assert(ok == false)
		assert(err == CANCEL)
	end)
end

function test.wait_queue_pull_blocks_then_wakes()
	checked_run(function()
		local q = wait_queue(8)
		local got
		resume(sthread(function()
			got = q:pull()
		end, 'puller'))
		assert(got == nil) --puller is suspended
		q:push('hello')
		assert(got == 'hello')
	end)
end

function test.wait_queue_multiple_waiters_fifo()
	checked_run(function()
		local q = wait_queue(8)
		local got = {}
		resume(sthread(function() got[1] = q:pull() end, 'p1'))
		resume(sthread(function() got[2] = q:pull() end, 'p2'))
		resume(sthread(function() got[3] = q:pull() end, 'p3'))
		q:push('x')
		q:push('y')
		q:push('z')
		assert(got[1] == 'x')
		assert(got[2] == 'y')
		assert(got[3] == 'z')
	end)
end

function test.wait_queue_pull_cancel()
	checked_run(function()
		local q = wait_queue(8)
		local ok, err
		local t = sthread(function()
			ok, err = lua_pcall(function() q:pull() end)
		end, 'puller')
		resume(t)
		t:cancel()
		assert(ok == false)
		assert(err == CANCEL)
	end)
end

function test.wait_queue_push_skips_cancelled_waiter()
	checked_run(function()
		local q = wait_queue(8)
		local ok1
		local got2
		local t1 = sthread(function()
			ok1 = lua_pcall(function() q:pull() end)
		end, 'p1')
		resume(t1)
		resume(sthread(function() got2 = q:pull() end, 'p2'))
		t1:cancel() --leaves dead entry at head of waiters list
		assert(ok1 == false)
		q:push('to-p2') --must skip dead t1 and resume p2
		assert(got2 == 'to-p2')
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

function test.timer_keeps_scheduler_running()
	local fired = false
	run(function()
		runafter(0.02, function()
			fired = true
		end)
	end)
	assert(fired)
end

function test.canceled_timer_does_not_keep_scheduler_running()
	local fired = false
	run(function()
		local tm = runafter(10, function()
			fired = true
		end)
		tm:cancel()
	end)
	assert(not fired)
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

function test.runafter_and_runagainevery()
	checked_run(function()
		local after_fired = false
		local again_count = 0

		runafter(0.02, function()
			after_fired = true
		end)

		local job = runagainevery(0.02, function()
			again_count = again_count + 1
		end)

		wait(0.07)
		job:cancel()

		assert(after_fired)
		assert(again_count >= 2)
	end)
end

local function assert_start_stops_on_signal(sig)
	local sent = false
	local expired = false
	local long_timer
	local ok, err = pcall(function()
		run(function()
			long_timer = runafter(10, function()
				expired = true
			end)
			runafter(0.01, function()
				sent = true
				kill(getpid(), sig)
			end)
		end)
	end)
	if long_timer then
		long_timer:cancel()
	end
	assert(ok, err)
	assert(sent)
	assert(not expired)
end

function test.start_stops_on_sigint()
	assert_start_stops_on_signal(SIGINT)
end

function test.start_stops_on_sigterm()
	assert_start_stops_on_signal(SIGTERM)
end

-- Epollable objects ---------------------------------------------------------

function test.make_async_success_and_timeout_paths()
	checked_run(function()
		local eo = {r = 0}
		local async_read = _make_async('r', true, function()
			return 3
		end)
		assert(async_read(eo) == 3)
		assert(eo.r == 3)

		local timeout_eo = {setexpires = _epoll_setexpires}
		_epoll_settimeout(timeout_eo, 0, 'r')
		local async_timeout = _make_async('r', false, function()
			errno(11) --EWOULDBLOCK
			return -1
		end)
		local ok, err = async_timeout(timeout_eo)
		assert(ok == nil)
		assert(err == 'timeout')

		local connect_eo = {setexpires = _epoll_setexpires}
		_epoll_settimeout(connect_eo, 0, 'w')
		local async_connect = _make_async_connect(function()
			errno(115) --EINPROGRESS
			return -1
		end)
		ok, err = async_connect(connect_eo)
		assert(ok == nil)
		assert(err == 'timeout')
	end)
end

function test.epollet_reads_ready_data_before_wait()
	checked_run(function()
		local rf, wf = pipe{async = true, quiet = true}
		local buf = new'char[3]'
		local n, err

		wf:write'abc'
		local th = thread(function()
			n, err = rf:try_read(buf, 3)
		end)
		resume(th)

		assert(th:status() == 'dead')
		assert(n == 3)
		assert(err == nil)
		assert(str(buf, 3) == 'abc')

		rf:close()
		wf:close()
	end)
end

function test.epollet_partial_drain_reads_remaining_data()
	checked_run(function()
		local rf, wf = pipe{async = true, quiet = true}
		local buf = new'char[3]'

		wf:write'abcdef'
		assert(rf:read(buf, 3) == 3)
		assert(str(buf, 3) == 'abc')
		assert(rf:read(buf, 3) == 3)
		assert(str(buf, 3) == 'def')

		rf:close()
		wf:close()
	end)
end

function test.epollet_wakes_after_drain_and_next_write()
	checked_run(function()
		local rf, wf = pipe{async = true, quiet = true}
		local buf = new'char[3]'
		local n, err

		wf:write'abc'
		assert(rf:read(buf, 3) == 3)
		assert(str(buf, 3) == 'abc')

		local th = thread(function()
			n, err = rf:try_read(buf, 3)
		end)
		resume(th)
		assert(th.waiting == rf)
		assert(n == nil)

		wf:write'def'
		wait(0.05)

		assert(th:status() == 'dead')
		assert(n == 3)
		assert(err == nil)
		assert(str(buf, 3) == 'def')

		rf:close()
		wf:close()
	end)
end

function test.epollet_hup_wakes_blocked_reader()
	checked_run(function()
		local rf, wf = pipe{async = true, quiet = true}
		local buf = new'char[3]'
		local n, err

		local th = thread(function()
			n, err = rf:try_read(buf, 3)
		end)
		resume(th)
		assert(th.waiting == rf)

		wf:close()
		wait(0.05)

		assert(th:status() == 'dead')
		assert(n == 0)
		assert(err == nil)

		rf:close()
	end)
end

function test.expires_heap_entry_persists_across_successful_io()
	checked_run(function()
		local eo = {setexpires = _epoll_setexpires, r = 0}
		_epoll_settimeout(eo, 1, 'r')
		local hi = eo.recv_heap_index
		assert(hi and hi ~= -1) --in heap after setexpires
		--successful I/O must NOT touch the heap
		local async_read = _make_async('r', true, function() return 3 end)
		assert(async_read(eo) == 3)
		assert(eo.recv_heap_index == hi) --unchanged
		assert(eo.recv_expires) --field preserved
		--cleanup
		_epoll_setexpires(eo, nil, 'r')
		assert(eo.recv_heap_index == -1)
	end)
end

function test.expires_fires_with_no_thread_waiting()
	checked_run(function()
		local eo = {setexpires = _epoll_setexpires}
		_epoll_settimeout(eo, 0.01, 'r')
		assert(eo.recv_heap_index and eo.recv_heap_index ~= -1)
		--drive the loop; check_heap should silently pop the entry
		wait(0.03)
		assert(eo.recv_heap_index == -1)
		assert(eo.recv_expires == nil)
	end)
end

function test.setexpires_twice_replaces_not_duplicates()
	checked_run(function()
		local eo = {setexpires = _epoll_setexpires}
		_epoll_settimeout(eo, 10, 'r')
		--would crash with 'duplicate' from heap:push if not the replace path
		_epoll_settimeout(eo, 5, 'r')
		assert(eo.recv_heap_index and eo.recv_heap_index ~= -1)
		--cleanup
		_epoll_setexpires(eo, nil, 'r')
		assert(eo.recv_heap_index == -1)
	end)
end

function test.setexpires_nil_removes_from_heap()
	checked_run(function()
		local eo = {setexpires = _epoll_setexpires}
		_epoll_settimeout(eo, 1, 'r')
		assert(eo.recv_heap_index and eo.recv_heap_index ~= -1)
		_epoll_setexpires(eo, nil, 'r')
		assert(eo.recv_heap_index == -1)
		assert(eo.recv_expires == nil)
	end)
end

-- Threads -------------------------------------------------------------------

function test.currentthread_and_mainthread()
	local mt = mainthread()
	assert(currentthread() == mt)
	assert(mt.ismain)

	checked_run(function()
		assert(currentthread() ~= mainthread())
		assert(not currentthread().ismain)
	end)
end

function test.thread_lifecycle_status_and_onfinish()
	local finished = 0
	local ran = false

	checked_run(function()
		local th
		th = thread(function(a, b)
			assert(currentthread() == th)
			assert(a == 'hello')
			assert(b == 42)
			ran = true
		end)

		assert(th:status() == 'suspended')
		assert(th:status() ~= 'dead')

		th:onfinish(function(self)
			assert(self == th)
			finished = finished + 1
		end)

		resume(th, 'hello', 42)

		assert(ran)
		assert(th:status() == 'dead')
		assert(finished == 1)
	end)
end

function test.thread_error_closes_owned_resources()
	local rf, wf
	local logs = capture_log(function()
		checked_run(function()
			local th = thread(function()
				rf, wf = pipe{quiet = true}
				error'thread-owned-resource-error'
			end)
			resume(th)
			assert(th:status() == 'dead')
			assert(th.owner == nil)
			assert(th.owns == false)
		end)
	end)

	assert(logs_contain(logs, 'thread-owned-resource-error'))
	assert(rf:closed())
	assert(wf:closed())
end

function test.resume_suspend_roundtrip_args()
	local seen = {}

	checked_run(function()
		local th = thread(function(a, b)
			seen.start_a = a
			seen.start_b = b
			local c, d = suspend()
			seen.resume_c = c
			seen.resume_d = d
		end)

		resume(th, 'start-a', 'start-b')
		assert(th.waiting == true)
		assert(th:status() ~= 'dead')

		resume(th, 'resume-c', 'resume-d')

		assert(seen.start_a == 'start-a')
		assert(seen.start_b == 'start-b')
		assert(seen.resume_c == 'resume-c')
		assert(seen.resume_d == 'resume-d')
		assert(th:status() == 'dead')
	end)
end

function test.cancel_suspend_raises_cancel()
	checked_run(function()
		local ok, err
		local th = thread(function()
			ok, err = lua_pcall(suspend)
		end)

		resume(th)
		assert(th:try_cancel())

		assert_cancel(ok, err)
		assert(th:status() == 'dead')
	end)
end

function test.owner_close_cancels_owned_suspended_thread()
	checked_run(function()
		local owner = _own(mainthread(), {})
		local ok, err
		local th = thread(function()
			ok, err = lua_pcall(suspend)
		end):setowner(owner)

		resume(th)
		assert(th.owner == owner)
		assert(th.waiting == true)

		assert(owner:try_close())

		assert_cancel(ok, err)
		assert(th.owner == nil)
		assert(th:status() == 'dead')
		assert(th.co == nil)
	end)
end

function test.transfer_and_finish_in_roundtrip_args()
	checked_run(function()
		local parent = currentthread()
		local child = thread(function(start_arg)
			assert(start_arg == 'start')
			local back_arg = transfer(parent, 'yielded')
			assert(back_arg == 'back')
			return finish_in(parent, 'done', false, nil)
		end)

		local yielded = transfer(child, 'start')
		assert(yielded == 'yielded')

		local a, b, c = transfer(child, 'back')
		assert(a == 'done')
		assert(b == false)
		assert(c == nil)
		assert(child:status() == 'dead')
	end)
end

function test.cancel_transfer_raises_cancel()
	checked_run(function()
		local parent = currentthread()
		local ok, err
		local th = thread(function()
			ok, err = lua_pcall(function()
				transfer(parent, 'ready')
			end)
		end)

		assert(transfer(th) == 'ready')
		assert(th:try_cancel())

		assert_cancel(ok, err)
		assert(th:status() == 'dead')
	end)
end

function test.cancel_wait_job_raises_cancel()
	checked_run(function()
		local ok, err
		local th = thread(function()
			local job = wait_job()
			ok, err = lua_pcall(function()
				job:wait(10)
			end)
		end)

		resume(th)
		assert(th:try_cancel())

		assert_cancel(ok, err)
		assert(th:status() == 'dead')
	end)
end

function test.cancel_epollable_reentrant_sibling_cancel_returns_not_waiting()
	checked_run(function()
		local fake = {_epoll_i = 1}
		function fake:_try_cancel_io(cancel_thread)
			if not self._epoll_i then return nil, 'thread not waiting' end
			self._epoll_i = nil --_try_cancel_io() closes the epollable first.
			_epoll_cancel(self, cancel_thread)
			return true
		end

		local send_val, send_err
		local recv_ok, recv_err, sibling_cancel_ok, sibling_cancel_err
		local send_th = thread(function()
			send_val, send_err = try_suspend()
		end)
		local recv_th = thread(function()
			recv_ok, recv_err = lua_pcall(suspend)
			sibling_cancel_ok, sibling_cancel_err = send_th:try_cancel()
		end)

		resume(send_th)
		resume(recv_th)
		fake.recv_thread = recv_th
		fake.send_thread = send_th
		recv_th.waiting = fake
		send_th.waiting = fake

		assert(recv_th:try_cancel())

		assert_cancel(recv_ok, recv_err)
		assert(sibling_cancel_ok == nil)
		assert(tostring(sibling_cancel_err):find('thread not waiting', 1, true))
		assert(send_val == false)
		assert(send_err == CLOSED)
		assert(recv_th:status() == 'dead')
		assert(send_th:status() == 'dead')
	end)
end

function test.owner_close_current_resume_caller_is_logged()
	local logs = capture_log(function()
		run(function()
			local wake_parent = wait_job()
			local wake_child = wait_job()

			local child = thread(function()
				wake_child:wait(10)
				wake_parent:resume()
			end)
			resume(child)

			runafter(0, function()
				wake_child:resume()
			end)
			wake_parent:wait(10)
		end)
	end)

	assert(logs_contain(logs, 'closing current resume caller'))
end

function test.cancel_non_waiting_thread_returns_error()
	checked_run(function()
		local th = thread(function()
		end)
		resume(th)

		local ok, err = th:try_cancel()
		assert(ok == nil)
		assert(tostring(err):find('thread not waiting', 1, true))
	end)
end

--resume() launches threads, it doesn't transfer data. delivering values into
--a thread blocked in resume() is therefore rejected at the call site.
function test.finish_in_resume_waiter_with_values_is_rejected()
	checked_run(function()
		local parent = currentthread()
		local ok, err
		local child = thread(function()
			ok, err = pcall(function()
				return finish_in(parent, 'cant-deliver')
			end)
			--exit cleanly with no payload (allowed for a resume-waiter).
			return finish_in(parent)
		end)

		resume(child)

		assert(ok == false)
		assert(tostring(err):find('waiting on resume', 1, true))
		assert(child:status() == 'dead')
	end)
end

function test.finish_in_current_resume_waiter_raises_in_resume()
	checked_run(function()
		local parent = currentthread()
		local child = thread(function()
			return finish_in_with(parent, false, 'finish-error')
		end)

		local ok, err = lua_pcall(function()
			resume(child)
		end)

		assert(ok == false)
		assert(err == 'finish-error')
		assert(child:status() == 'dead')
	end)
end

function test.finish_in_outer_resume_waiter_is_rejected()
	checked_run(function()
		local parent = currentthread()
		local a, b
		local ok, err

		a = thread(function()
			b = thread(function()
				ok, err = pcall(function()
					return finish_in(parent, 'skip-a')
				end)
				return finish_in(a)
			end)
			resume(b)
			return finish_in(parent)
		end)

		resume(a)

		assert(ok == false)
		assert(tostring(err):find('non%-suspended'))
		assert(a:status() == 'dead')
		assert(b:status() == 'dead')
	end)
end

function test.transfer_into_resume_waiter_is_rejected()
	checked_run(function()
		local parent = currentthread()
		local ok, err
		local child = thread(function()
			ok, err = pcall(function()
				transfer(parent, 'bad')
			end)
			return finish_in(parent)
		end)

		resume(child)

		assert(ok == false)
		assert(tostring(err):find('not suspended', 1, true))
		assert(child:status() == 'dead')
	end)
end

function test.cancel_resume_waiter_canceler_can_wait_after_cancel()
	checked_run(function()
		local parent = currentthread()
		local child
		local parent_ok, parent_err
		local wait_ok, wait_err

		local canceler = thread(function()
			parent:cancel()
			wait_ok, wait_err = wait(0)
			return finish_in(parent, 'done')
		end)

		child = thread(function()
			transfer(canceler)
			return finish_in(canceler, 'child-done')
		end)

		parent_ok, parent_err = lua_pcall(function()
			resume(child)
		end)
		local ret = suspend()

		assert_cancel(parent_ok, parent_err)
		assert(wait_ok == nil)
		assert(wait_err == 'timeout')
		assert(ret == 'done')
		assert(child:status() == 'dead')
		assert(canceler:status() == 'dead')
	end)
end

function test.cancel_cascades_down_resume_chain()
	checked_run(function()
		local parent = currentthread()
		local a, b
		local canceler = thread(function()
			parent:cancel()
		end)
		b = thread(function()
			transfer(canceler)
		end)
		a = thread(function()
			resume(b)
		end)
		local ok, err = lua_pcall(function()
			resume(a)
		end)
		assert_cancel(ok, err)
		assert(a:status() == 'dead')
		assert(b:status() == 'dead')
		assert(canceler:status() == 'dead')
	end)
end

function test.finish_with_raises_in_resume_waiter()
	checked_run(function()
		local child = thread(function()
			return finish_with(false, 'finish-with-error')
		end)

		local ok, err = lua_pcall(function()
			resume(child)
		end)

		assert(ok == false)
		assert(err == 'finish-with-error')
		assert(child:status() == 'dead')
	end)
end

function test.nested_resume_restores_poll_thread()
	checked_run(function()
		local parent = currentthread()
		local grandchild
		local child = thread(function()
			grandchild = thread(function()
				suspend()
			end)
			grandchild:setowner(parent)
			resume(grandchild)
		end)

		resume(child)

		local ok, err = wait(0)
		assert(ok == nil)
		assert(err == 'timeout')

		assert(grandchild:try_cancel())
	end)
end

function test.uncaught_cancel_does_not_log_thread_error()
	local logs = capture_log(function()
		checked_run(function()
			local th = thread(function()
				suspend()
			end)
			resume(th)
			assert(th:try_cancel())
			assert(th:status() == 'dead')
		end)
	end)

	for _, e in ipairs(logs) do
		assert(e[1] ~= 'ERROR')
	end
end

function test.invalid_thread_operations_raise()
	checked_run(function()
		local self = currentthread()
		local ok, err = pcall(resume, self)
		assert(not ok)
		assert(tostring(err):find('not suspended', 1, true))

		ok, err = pcall(transfer, self)
		assert(not ok)
		assert(tostring(err):find('not suspended', 1, true))

		ok, err = pcall(finish_in, self)
		assert(not ok)
		assert(tostring(err):find('non-suspended', 1, true))

		local dead = thread(function()
		end)
		resume(dead)
		assert(dead:status() == 'dead')

		ok, err = pcall(resume, dead)
		assert(not ok)
		assert(tostring(err):find('not suspended', 1, true))

		ok, err = pcall(transfer, dead)
		assert(not ok)
		assert(tostring(err):find('not suspended', 1, true))

		ok, err = pcall(resume, {})
		assert(not ok)
		assert(tostring(err):find('thread expected', 1, true))
	end)
end

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

function test.threadset_wait_resumes_on_child_finish()
	checked_run(function()
		local ts = threadset()
		local child = ts:thread(function()
			wait(0)
		end)
		resume(child)
		local ok, err = ts:wait()
		assert(ok)
		assert(err == nil)
		assert(ts:join())
	end)
end

function test.threadset_wait_preserves_finished_child_error()
	local logs = capture_log(function()
		checked_run(function()
			local ts = threadset()
			local child = ts:thread(function()
				error'boom'
			end)
			resume(child)
			local ok, err = ts:wait()
			assert(not ok)
			assert(tostring(err):find('boom', 1, true))
		end)
	end)
	assert(not logs_contain(logs, 'boom'))
end

function test.with_threads_closes_children_on_error()
	checked_run(function()
		local child
		local ok, err = pcall(function()
			with_threads(function(spawn)
				child = spawn(function()
					wait(10)
				end)
				error'boom'
			end)
		end)
		assert(not ok)
		assert(tostring(err):find('boom', 1, true))
		assert(child:status() == 'dead')
	end)
end

function test.threadset_child_finishes_before_join()
	local logs = capture_log(function()
		checked_run(function()
			local ts = threadset()
			resume(ts:thread(function()
				wait(0)
			end))
			wait(0.02) --let the child finish before join() starts waiting.
			assert(ts:join())
		end)
	end)
	for _, e in ipairs(logs) do
		local severity = e[1]
		local err = e[5]
		assert(not (
			severity == 'ERROR'
			and tostring(err):find('non%-suspended')
		))
	end
end

function test.thread_error_is_logged_and_scheduler_continues()
	local logs = capture_log(function()
		checked_run(function()
			local continued = false

			resume(thread(function()
				wait(0)
				error'thread-boom'
			end))

			resume(sthread(function()
				wait(0)
				continued = true
			end))

			wait(0.02)
			assert(continued)
		end)
	end)

	assert(logs_contain(logs, 'thread-boom'))
end

function test.thread_finish_in_resumes_target()
	local joined = false
	local child
	checked_run(function()
		local parent = currentthread()
		child = thread(function()
			wait(0)
			return finish_in(parent, 'done')
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

function test.iterator_success_and_error()
	checked_run(function()
		local th
		th = iterator(function(yield, arg)
			assert(currentthread() == th)
			assert(arg == 'start')
			local resumed = yield('yielded')
			assert(resumed == 'back')
			return 'done'
		end)

		assert(th.next('start') == 'yielded')
		assert(th:status() ~= 'dead')
		local ret = th.next('back')
		assert(ret == 'done')
		assert(th:status() == 'dead')

		local bad_th = iterator(function()
			error'iterator-boom'
		end)

		local ok, err = pcall(bad_th.next)
		assert(not ok)
		assert(tostring(err):find('iterator-boom', 1, true))
		assert(bad_th:status() == 'dead')
	end)
end

function test.threadset_error_propagation()
	local old_log = log
	log = noop
	local ok, err = xpcall(function()
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
	end, debug.traceback)
	log = old_log
	assert(ok, err)
end

function test.threadset_cancel_error_is_preserved_and_not_logged()
	local logs = capture_log(function()
		checked_run(function()
			local ts = threadset()
			resume(ts:thread(function()
				error(CANCEL)
			end))
			local ok, err = ts:join()
			assert(ok == false)
			assert(err == CANCEL)
		end)
	end)

	for _, e in ipairs(logs) do
		assert(e[1] ~= 'ERROR')
	end
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

function test.run_returns_values()
	local a, b, c = run(function(arg)
		return arg, nil, false
	end, 'value')

	assert(a == 'value')
	assert(b == nil)
	assert(c == false)
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
if n_fail == 0 then print'epoll ok' end
