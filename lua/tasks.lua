--[[

	Task system with process hierarchy, output capturing and scheduling.
	Written by Cosmin Apreutesei. Public Domain.

FACTS
	* tasks have a status: 'not started', 'running', 'finished'.
		* status info: .start_time, .duration, .killed, .exit_code, .freed.
	* tasks form a tree:
		* killing a task kills all its children.
		* tasks wait for their child tasks to complete before they are finished.
		* events, stdout/stderr, notifications and errors bubble up to parent tasks.
	* errors

API
	local ta = tasks.task(opt)
		opt.action = fn(ta)       action to run
		opt.parent_task           child of `parent_task`
		opt.bg = true             run in background
		opt.free_after = N        free after N seconds
		opt.name = s              task name (for listing and for debugging)
	t.id
	M.tasks -> {ta->true}
	M.tasks_by_id[id] -> ta

STATE
	ta.status                  task status
	ta.start_time              set when task starts
	ta.duration                set when task finishes
	ta.exit_code               set if task finished and not killed
	ta.pinned                  set to prevent freeing, unset to resume freeing
	ta.freed                   task was freed
	ta:start()                 start task.
	ta:kill() -> t|f           kill task along with its children.
	ta:do_kill() -> t|f        implement kill. must return true on success.
	ta:free() -> t|f           free task along with its children, if none are running.
	^setstatus(ta, status)
	^add_task(parent_ta, child_ta)
	^remove_task(parent_ta, child_ta)

LOGGING
	ta:logerror(event, fmt, ...)
	ta.errors -> {{task,event,fmt,...},...}
	^logerror(ta, event, fmt, ...)

NOTIFICATIONS
	ta.notifications -> {{task=, kind=, message=},...}
	ta:notify_kind(kind, fmt, ...)
	ta:notify       (fmt, ...)
	ta:notify_warn  (fmt, ...)
	ta:notify_error (fmt, ...)
	^notify(ta, kind, message)

STDOUT/STDERR
	ta.stdout_chunks -> {s1,...}
	ta.stderr_chunks -> {s1,...}
	ta.stdouterr_chunks -> {s1,...}
	ta:write_stdout(s)
	ta:write_stderr(s)
	ta:stdout() -> s
	ta:stderr() -> s
	ta:stdouterr() -> s
	^write_stdout(ta, s)
	^write_stderr(ta, s)

]]

local glue = require'glue'
local time = require'time'
local proc = require'proc'
local sock = require'sock'
local events = require'events'
local proc = require'proc'
local errors = require'errors'

local _ = string.format
local add = table.insert
local cat = table.concat
local time = time.time
local object = glue.object
local update = glue.update
local empty = glue.empty
local attr = glue.attr
local thread = sock.thread
local resume = sock.resume

local M = {}
M.tasks = {}
M.tasks_by_id = {}
M.last_task_id = 0

local task = update({}, events)

task.module = 'task' --default
task.free_after = 10

function M.task(opt)

	M.last_task_id = M.last_task_id + 1
	local self = object(task, opt, {
		id = M.last_task_id,
		status = 'not started',
		stdout_chunks = {},
		stderr_chunks = {},
		stdouterr_chunks = {},
		errors = {}, --{{},...}
		notifications = {}, --{{task,event,fmt,...},...}
	 	child_tasks = {}, --{task1,...}
	})
	self.name = self.name or self.id
	M.tasks[self] = true
	M.tasks_by_id[self.id] = self

	if opt.parent_task then
		opt.parent_task:add_task(self)
	end

	function self:start()

		self.start_time = time()
		self:_setstatus'running'

		local function run_task()
			local ok, ret = errors.pcall(self.action, self)
			if not ok then
				self:logerror('run', '%s', ret)
				self:_finish()
			else
				self:_finish(ret or 0)
			end
			runafter(self.free_after or 0, function()
				while not self:free() do
					sleep(1)
				end
			end, 'task-zombie %s', self.name)
		end
		if opt.bg then
			resume(thread(run_task), 'task %s', self.name)
		else
			run_task()
		end
	end

	return self
end

--events

function task:fire_up(ev, ...)
	local ret = self:fire(ev, self, ...)
	if ret ~= nil then return ret end
	local parent_task = self.parent_task
	while parent_task do
		local ret = parent_task:fire(ev, self, ...)
		if ret ~= nil then return ret end
		parent_task = parent_task.parent_task
	end
end

--state

function task:_tasks_running()
	if self.status == 'running' then return true end
	for _,child_task in ipairs(self.child_tasks) do
		if child_task:_tasks_running() then
			return true
		end
	end
end

function task:free()
	if self.freed then return false end
	if self.pinned then return false end
	if self:_tasks_running() then return false end
	while #self.child_tasks > 0 do
		child_task:free()
	end
	if self.parent_task then
		self.parent_task:remove_task(self)
	end
	mm.tasks[self] = nil
	mm.tasks_by_id[self.id] = nil
	self.freed = true
	return true
end

function task:_setstatus(s)
	self.status = s
	self:fire_up('setstatus', s)
end

function task:_finish(exit_code)
	if not self.start_time then return end --not started.
	if self.duration then return end --already called.
	self.duration = time() - self.start_time
	self.exit_code = exit_code
	--TODO: wait_for_children_to_finish
	self:_setstatus(exit_code and 'finished')
end

function task:do_kill() return false end --stub

function task:kill()
	for _,child_task in ipairs(self.child_tasks) do
		if not child_task:kill() then
			self:notify_error('Child task could not be killed: %s.', child_task.id)
			return false
		end
	end
	if self.status == 'running' then
		if not self:do_kill() then
			self:notify_error('Task could not be killed: %s.', self.id)
			return false
		end
		self:_finish()
	end
	return true
end

--child tasks

function task:add_task(child_task)
	add(self.child_tasks, child_task)
	self:fire_up('add_task', child_task)
end

function task:remove_task(child_task)
	local i = indexof(child_task, self.child_tasks)
	assert(i, 'Child task not found: %s', child_task.name)
	remove(self.child_tasks, i)
	self:fire_up('remove_task', child_task)
end

--logging

function task:log(severity, event, ...)
	local logging = self.logging
	if not logging then return end
	logging.log(severity, self.module, event, ...)
end

function task:on_logerror(task, event, ...)
	add(self.errors, pack(task, event, ...))
end
function task:logerror(event, ...)
	self:log('ERROR', event, ...)
	self:fire_up('logerror', event, ...)
end

--notifications

function task:on_notify(task, kind, message)
	add(self.notifications, {task = task, kind = kind, message = message})
end
function task:notify_kind(kind, fmt, ...) --kind: error|warn|info|nil
	self:fire_up('notify', kind, _(fmt, ...))
end

function task:notify       (...) self:notify_kind('info' , ...) end
function task:notify_error (...) self:notify_kind('error', ...) end
function task:notify_warn  (...) self:notify_kind('warn' , ...) end

--stdout & stderr

function task:on_write_stdout(task, s)
	add(self.stdout_chunks, s)
	add(self.stdouterr_chunks, s)
end
function task:write_stdout(s)
	self:fire_up('write_stdout', s)
end

function task:on_write_stderr(task, s)
	add(self.stderr_chunks, s)
	add(self.stdouterr_chunks, s)
end
function task:write_stderr(s, source_task)
	self:fire_up('write_stderr', source_task, s)
end

function task:stdout    () return cat(self.stdout_chunks) end
function task:stderr    () return cat(self.stderr_chunks) end
function task:stdouterr () return cat(self.stdouterr_chunks) end

--async exec tasks -----------------------------------------------------------

function M.exec(cmd, opt)

	opt = opt or empty

	local capture_stdout = opt.capture_stdout ~= false
	local capture_stderr = opt.capture_stderr ~= false

	local env = opt.env and update(proc.env(), opt.env)

	local p = assert(proc.exec{
		cmd = cmd,
		env = env,
		async = true,
		autokill = opt.autokill ~= false,
		stdout = capture_stdout,
		stderr = capture_stderr,
		stdin = opt.stdin and true or false,
	})

	local task = M.task(update({}, opt))

	task.cmd = cmd
	task.process = p

	function task:action()

		if p.stdin then
			resume(thread(function()
				--dbg('mm', 'execin', '%s', opt.stdin)
				local ok, err = p.stdin:write(opt.stdin)
				if not ok then
					self:logerror('stdinwr', '%s', err)
				end
				assert(p.stdin:close()) --signal eof
			end, 'exec-stdin %s', p))
		end

		if p.stdout then
			resume(thread(function()
				local buf, sz = u8a(4096), 4096
				while true do
					local len, err = p.stdout:read(buf, sz)
					if not len then
						task:logerror('stdoutrd', '%s', err)
						break
					elseif len == 0 then
						break
					end
					local s = ffi.string(buf, len)
					task:write_stdout(s)
				end
				assert(p.stdout:close())
			end, 'exec-stdout %s', p))
		end

		if p.stderr then
			resume(thread(function()
				local buf, sz = u8a(4096), 4096
				while true do
					local len, err = p.stderr:read(buf, sz)
					if not len then
						task:logerror('stderrrd', '%s', err)
						break
					elseif len == 0 then
						break
					end
					local s = ffi.string(buf, len)
					task:write_stderr(s)
				end
				assert(p.stderr:close())
			end, 'exec-stderr %s', p))
		end

		local exit_code, err = p:wait()
		if not exit_code then
			if not (err == 'killed' and task.killed) then
				task:logerror('procwait', '%s', err)
			end
		end
		while not (
				 (not p.stdin  or p.stdin :closed())
			and (not p.stdout or p.stdout:closed())
			and (not p.stderr or p.stderr:closed())
		) do
			sleep(.1)
		end
		p:forget()
		return exit_code
	end

	function task:do_kill()
		return p:kill()
	end

	if not opt.allow_fail and task.exit_code and task.exit_code ~= 0 then
		local cmd_s = isstr(cmd) and cmd or proc.quote_args_unix(unpack(cmd))
		check500(false, 'exec: %s\nEXIT CODE: %s\nSTDIN:\n%s\nENV:%s\n',
			cms_s, task.exit_code, task.stdin, opt.env)
	end

	task:start()

	return task
end

--scheduled tasks ------------------------------------------------------------

M.scheduled_tasks = {}

--[=[
function M.set_scheduled_task(name, opt)
	if not opt then
		mm.scheduled_tasks[name] = nil
	else
		assert(opt.task_name)
		assert(opt.action)
		assert(opt.start_hours or opt.run_every)
		assert(opt.machine or opt.deploy)
		local sched = mm.scheduled_tasks[name]
		if not sched then
			sched = {sched_name = name, ctime = time(), active = true}
			mm.scheduled_tasks[name] = sched
		end
		update(sched, opt)
	end
	rowset_changed'scheduled_tasks'
end

--we need this minimum amount of persistence for scheduled tasks to work.
function M.load_tasks_last_run() error'stub' end
function M.save_task_last_run(name, t) error'stub' end

local function run_tasks()
	local now = time()
	local today = glue.day(now)

	for sched_name,t in pairs(mm.scheduled_tasks) do

		if t.active then

			local start_hours = t.start_hours
			local last_run = t.last_run
			local run_every = t.run_every
			local action = t.action

			local min_time = not start_hours and last_run and run_every
				and last_run + run_every or -1/0

			if start_hours and run_every then
				local today_at = today + start_hours
				local seconds_late = (now - today_at) % run_every --always >= 0
				local last_sched_time = now - seconds_late
				local already_run = last_run and last_run >= last_sched_time
				local too_late = seconds_late > run_every / 2
				if already_run or too_late then
					min_time = 1/0
				end
			end

			if now >= min_time and not mm.running_task(t.task_name) then
				local rearm = run_every and true or false
				note('mm', 'run-task', '%s', t.task_name)
				t.last_run = now
				insert_or_update_row('task_last_run', {
					sched_name = sched_name,
					last_run = now,
				})
				resume(thread(function()
					local ok, err = errors.pcall(action)
					if not ok then
						logerror('mm', 'runtask', '%s: %s', sched_name, err)
					end
				end, 'run-task %s', t.task_name))
			end

		end
	end
end
]=]

--self-test ------------------------------------------------------------------

if not ... then

	local tasks = M
	local ta = tasks.exec({
		'echo', 'hello'
	}, {
		--
	})
	pr(ta)

end
