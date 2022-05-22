--[[

	Task system with process hierarchy, output capturing and scheduling.
	Written by Cosmin Apreutesei. Public Domain.

FACTS
	* tasks have a status: 'not started', 'running', 'finished'.
		* status info: .start_time, .duration, .killed, .exit_code, .freed.
	* tasks form a tree:
		* killing a task kills all its children.
		* tasks wait for child tasks to finish before they are freed.
		* events bubble up to parent tasks.
	* each task has a recording terminal piped to the terminal of the parent
	  task, or to the current terminal if the task has no parent.
	* the current terminal is set to the task's terminal while the task is running.
	* the main thread has a cmdline_terminal by default.
	*

TERMINALS
	tasks.null_terminal(nt, opt...) -> nt
		nt:out(src_term, channel, ...)
		nt:notify_kind(kind, fmt, ...)
		nt:notify(fmt, ...)
		nt:notify_error(fmt, ...)
		nt:notify_warn(fmt, ...)
		nt:out_stdout(s)
		nt:out_stderr(s)
		nt:pipe(nt, [on])
	tasks.recording_terminal(rt, opt...) -> rt
		rt:playback(term)
		rt:stdout()
		rt:stderr()
		rt:stdouterr()
		rt:notifications()
	tasks.cmdline_terminal(ct, opt...) -> ct
	tasks.streaming_terminal(st, opt...) -> st
		st:send_on(channel_code, s)
		st.send(s)
	tasks.streaming_terminal_reader(term) -> read(buf, sz)
		term:receive_on(channe_code, s)     receive message on custom channel

CURRENT TERMINAL
	tasks.set_current_terminal(te) -> prev_te      set/replace current terminal
	tasks.current_terminal() -> te                 get current terminal
	tasks.METHOD(...)            call a method on the current terminal

TASKS
	local ta = tasks.task(opt)
		opt.action = fn(ta)       action to run
		opt.parent_task           child of `parent_task`
		opt.free_after            free after N seconds (10). false = 1/0.
		opt.name                  task name (for listing and for debugging).
		opt.stdin                 stdin (for exec() tasks)
	t.id
	M.tasks -> {ta->true}      root task list
	M.tasks_by_id -> {id->ta}  root task list mapped by id
	ta.status                  task status
	ta.start_time              set when task starts
	ta.duration                set when task finishes
	ta.exit_code               set if task finished and not killed
	ta.pinned                  set to prevent freeing, unset to resume freeing
	ta.freed                   task was freed
	ta:start() -> ta           start task in background
	ta:run() -> ret            run task in current thread
	ta:pcall() -> ok,ret       run task in current thread, protected
	ta:kill() -> t|f           kill task along with its children.
	ta:do_kill() -> t|f        implement kill. must return true on success.
	ta:free() -> t|f           free task along with its children, if none are running.
	^setstatus(ta, status)
	^add_task(parent_ta, child_ta)
	^remove_task(parent_ta, child_ta)

PROCESS TASK
	M.exec(cmd_args|{cmd,arg1,...}, opt) -> ta

]]

local glue = require'glue'
local time = require'time'
local proc = require'proc'
local sock = require'sock'
local events = require'events'
local proc = require'proc'
local errors = require'errors'
local json = require'json'
local buffer = require'string.buffer'

local _ = string.format
local add = table.insert
local cat = table.concat

local time = time.time

local pack = glue.pack
local unpack = glue.unpack
local update = glue.update
local empty = glue.empty
local attr = glue.attr
local imap = glue.imap
local repl = glue.repl
local sortedpairs = glue.sortedpairs

local thread = sock.thread
local resume = sock.resume
local sleep = sock.sleep
local runafter = sock.runafter
local currentthread = sock.currentthread
local threadenv = sock.threadenv
local getownthreadenv = sock.getownthreadenv

local M = {}

function M.log(severity, event, ...)
	local logging = M.logging
	if not logging then return end
	logging.log(severity, 'tasks', event, ...)
end

--terminals ------------------------------------------------------------------

--null terminal: fires events for input. can pipe input to other terminals.
--publishes: pipe(term, [on]).

local nterm = glue.object(nil, nil, events)
M.null_terminal = nterm
nterm.subclass = glue.object
nterm.override = glue.override
nterm.before = glue.before
nterm.after = glue.after

function nterm:__call(opt, ...)
	local self = glue.object(self, opt, ...)
	self:init()
	return self
end

nterm.init = glue.noop

function nterm:out(src_term, chan, ...)
	self:fire('out', src_term, chan, ...)
end

function nterm:out_notify(src_term, kind, s)
	self:out(src_term, 'notify', kind, s)
end
function nterm:notify_kind (kind, ...) self:out_notify(self,  kind  , _(...)) end
function nterm:notify            (...) self:out_notify(self, 'info' , _(...)) end
function nterm:notify_error      (...) self:out_notify(self, 'error', _(...)) end
function nterm:notify_warn       (...) self:out_notify(self, 'warn' , _(...)) end

function nterm:out_stdout(s) self:out(self, 'stdout', s) end
function nterm:out_stderr(s) self:out(self, 'stderr', s) end

function nterm:print(...)
	local n = select('#', ...)
	for i=1,n do
		local v = select(i, ...)
		self:out_stdout(tostring(v))
		if i < n then
			self:out_stdout'\t'
		end
	end
	self:out_stdout'\n'
end

function nterm:pipe(term, on) --pipe out self to term.
	if on == false then
		return self:off{'out', term}
	end
	self:on({'out', term}, function(self, src_term, chan, ...)
		term:out(src_term, chan, ...)
	end)
end

--recording terminal: records input and plays it back on another terminal.
--publishes: playback(te), stdout(), stderr(), stdouterr(), notifications().

local rterm = glue.object(nil, nil, nterm)
M.recording_terminal = rterm

function rterm:init()
	self.buffer = {}
end

rterm:after('out', function(self, src_term, chan, ...)
	add(self.buffer, pack(src_term, chan, ...))
end)

function rterm:playback(term)
	for _,t in ipairs(self.buffer) do
		term:out(unpack(t))
	end
end

do
local function add_some(self, maybe_add)
	local dt = {}
	for _,t in ipairs(self.buffer) do
		maybe_add(dt, unpack(t))
	end
	return dt
end
local function add_stdout(t, src_term, chan, s)
	if chan == 'stdout' then add(t, s) end
end
local function add_stderr(t, src_term, chan, s)
	if chan == 'stderr' then add(t, s) end
end
local function add_stdouterr(t, src_term, chan, s)
	if chan == 'stdout' or chan == 'stderr' then add(t, s) end
end
local function add_notify(t, src_term, chan, kind, message)
	if chan == 'notify' then add(t, {kind = kind, message = message}) end
end
function rterm:stdout        () return cat(add_some(self, add_stdout)) end
function rterm:stderr        () return cat(add_some(self, add_stderr)) end
function rterm:stdouterr     () return cat(add_some(self, add_stdouterr)) end
function rterm:notifications () return add_some(self, add_notify) end
end

--command-line terminal: formats input for command-line consumption.

local cterm = glue.object(nil, nil, nterm)
M.cmdline_terminal = cterm

cterm:after('out', function(self, src_term, chan, ...)
	if chan == 'stdout' then
		local s = ...
		io.stdout:write(s)
	elseif chan == 'stderr' then
		local s = ...
		io.stderr:write(s)
		io.stderr:flush()
	elseif chan == 'notify' then
		local kind, s = ...
		io.stderr:write(_('%s: %s\n', repl(kind, 'info', 'note'):upper(), s))
		io.stderr:flush()
	end
end)

--streaming output terminal: serializes input for network transmission.
--calls: sterm.send(s)

local sterm = glue.object(nil, nil, nterm)
M.streaming_terminal = sterm

function sterm:send_on(chan, s)
	self.send(format('%s%08x\n%s', chan, #s, s))
end

sterm:after('out', function(self, src_term, chan, ...)
	if     chan == 'stdout' then self:send_on('1', ...)
	elseif chan == 'stderr' then self:send_on('2', ...)
	elseif chan == 'notify' then
		self:send_on(
				kind == 'info'  and 'N'
			or kind == 'warn'  and 'W', ...)
	else
		self:send(chan, ...)
	end
end)

--streaming terminal reader: returns `write(buf, sz)` which when called,
--deserializes a terminal output stream and sends it to a terminal.

function M.streaming_terminal_reader(term)
	local buf = buffer.new()
	local chan, size
	return function(in_buf, sz)
		buf:putcdata(in_buf, sz)
		::again::
		if not size and #buf >= 10 then
			chan = buf:get(1)
			size = assert(tonumber(buf:get(9), 16))
		end
		if size and #buf >= size then
			local s = buf:get(size)
			if chan == '1' then
				term:out('stdout', s)
			elseif chan == '2' then
				term:out('stderr', s)
			elseif chan == 'N' then
				term:out('notify', 'info', s)
			elseif chan == 'W' then
				term:out('notify', 'warn', s)
			elseif chan == 'E' then
				term:out('notify', 'error', s)
			elseif term.receive_on then
				term:receive_on(chan, s)
			end
			chan, size = nil
			goto again
		end
	end
end

--current thread's terminal --------------------------------------------------

local function current_terminal(thread)
	local env = threadenv[thread or currentthread()]
	return env and env.terminal
end
M.current_terminal = current_terminal

function M.set_current_terminal(term, thread)
	local env = getownthreadenv(thread)
	local term0 = env.terminal
	env.terminal = term
	return term0
end

M.set_current_terminal(cterm())

function M.notify_kind  (...) current_terminal():notify_kind  (...) end
function M.notify       (...) current_terminal():notify       (...) end
function M.notify_error (...) current_terminal():notify_error (...) end
function M.notify_warn  (...) current_terminal():notify_warn  (...) end
function M.out_stdout(s) current_terminal():out_stdout(s) end
function M.out_stderr(s) current_terminal():out_stderr(s) end

--tasks ----------------------------------------------------------------------

M.tasks = {}
M.tasks_by_id = {}
M.last_task_id = 0

local task = glue.object(nil, nil, events)
M.task = task
task.subclass = glue.object
task.override = glue.override
task.before = glue.before
task.after = glue.after

function task:__call(opt, ...)
	local self = glue.object(self, opt, ...)
	self:init()
	return self
end

task.module = 'task' --default
task.free_after = 10

function task:init()

	M.last_task_id = M.last_task_id + 1
	self.id = M.last_task_id
	self.status = 'not started'
	self.child_tasks = {} --{task1,...}
	self.name = self.name or self.id
	self.terminal = M.recording_terminal()
	M.tasks[self] = true
	M.tasks_by_id[self.id] = self

	if self.parent_task then
		self.parent_task:add_task(self)
	else
		local pt = current_terminal()
		if pt then
			self.parent_terminal = pt
			self.terminal:pipe(pt)
		end
	end

	local function run_task()
		self.start_time = time()
		self.status = 'running'
		self:fire_up('setstatus', 'running')
		local term0 = M.set_current_terminal(self.terminal)
		local ok, ret = errors.pcall(self.action, self)
		M.set_current_terminal(term0)
		self.duration = time() - self.start_time
		self.status = 'finished'
		self:fire_up('setstatus', 'finished')
		runafter(self.free_after or 1/0, function()
			while not self:free() do
				sleep(1)
			end
		end, 'task-zombie %s', self.name)
		return ok, ret
	end

	function self:start()
		if self.start_time then
			return self --already started
		end
		resume(thread(run_task), 'task %s', self.name)
		return self
	end

	self.pcall = run_task

	function self:run()
		assert(run_task())
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

function task:_cannot_free()
	if self.status == 'running' then return true end
	for _,child_task in ipairs(self.child_tasks) do
		if child_task:_cannot_free() then
			return true
		end
	end
end

function task:free()
	if self.freed then return false end
	if self.pinned then return false end
	if self:_cannot_free() then return false end
	while #self.child_tasks > 0 do
		child_task:free()
	end
	if self.parent_task then
		self.parent_task:remove_task(self)
	elseif self.parent_terminal then
		self.terminal:pipe(self.parent_terminal, false)
	end
	M.tasks[self] = nil
	M.tasks_by_id[self.id] = nil
	self.freed = true
	return true
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
	end
	return true
end

--child tasks

function task:add_task(child_task)
	add(self.child_tasks, child_task)
	self:fire_up('add_task', child_task)
	child_task.terminal:pipe(self.terminal, true)
end

function task:remove_task(child_task)
	local i = indexof(child_task, self.child_tasks)
	assert(i, 'Child task not found: %s', child_task.name)
	remove(self.child_tasks, i)
	self:fire_up('remove_task', child_task)
	child_task.terminal:pipe(self.terminal, false)
end

--async process tasks with stdout/err capturing ------------------------------

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

	local errors = {}
	local function add_error(method, err)
		add(errors, method..': '..err)
	end

	function task:action()

		if p.stdin then
			resume(thread(function()
				local ok, err = p.stdin:write(opt.stdin)
				if not ok then
					add_error('stdinwr', err)
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
						add_error('stdout.read', err)
						break
					elseif len == 0 then
						break
					end
					local s = ffi.string(buf, len)
					M.out_stdout(s)
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
						add_error('stderr.read', err)
						break
					elseif len == 0 then
						break
					end
					local s = ffi.string(buf, len)
					M.out_stderr(s)
				end
				assert(p.stderr:close())
			end, 'exec-stderr %s', p))
		end

		local exit_code, err = p:wait()
		if not exit_code then
			if not (err == 'killed' and task.killed) then --crashed/killed from outside
				add_error('proc.wait', err)
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

		if not self.bg and not self.allow_fail and exit_code ~= 0 then
			local cmd_s = isstr(cmd) and cmd or proc.quote_args(nil, unpack(cmd))
			local s = _('%s [%s]', cmd_s, exit_code)
			if task.stdin then
				s = s .. '\nSTDIN:\n' .. task.stdin
			end
			if opt.env then
				local dt = {}
				for k,v in sortedpairs(t) do
					add(dt, _('%s = %s', k, v))
				end
				s = s .. '\nENV:\n' .. cat(dt, '\n')
			end
			add_error('proc.exec', s)
		end

		if #errors > 0 then
			error(cat(errors, '\n'))
		end

		return exit_code
	end

	function task:do_kill()
		return p:kill()
	end

	if task.bg then
		if task.autostart ~= false then
			return task:start()
		end
	else
		if task.autostart ~= false then
			return task:run()
		end
	end

	return task
end

--scheduled tasks ------------------------------------------------------------

M.scheduled_tasks = {} --{name->sched}

function M.set_scheduled_task(name, opt)
	if not opt then
		M.scheduled_tasks[name] = nil
	else
		assert(opt.action)
		assert(opt.start_hours or opt.run_every)
		local sched = M.scheduled_tasks[name]
		if not sched then
			sched = {name = name, ctime = time(), active = true, running = false}
			M.scheduled_tasks[name] = sched
		end
		update(sched, opt)
	end
end

--we need this minimum amount of persistence for scheduled tasks to work.
function M.load_tasks_data() end --stub
function M.save_task_data(name, t) end --stub

local function run_tasks()
	local now = time()
	local today = glue.day(now)

	for name, sched in pairs(M.scheduled_tasks) do

		if sched.active then

			local start_hours = sched.start_hours
			local last_run    = sched.last_run
			local run_every   = sched.run_every
			local action      = sched.action

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

			if now >= min_time and not sched.running then
				local rearm = run_every and true or false
				M.log('note', 'run-task', '%s', name)
				sched.last_run = now
				M.save_task_data(name, {last_run = now})
				M.task(sched):start()
			end

		end
	end
end

local sched_job
function M.task_scheduler(cmd)
	if cmd == 'start' and not sched_job then
		sched_job = sock.runevery(1, run_tasks)
	elseif cmd == 'stop' and sched_job then
		sched_job:wakeup()
		sched_job = nil
	elseif cmd == 'running' then
		return sched_job and true or false
	end
end

--self-test ------------------------------------------------------------------

if not ... then
	local tasks = M
	tasks.logging = require'logging'
	tasks.logging.verbose = true
	tasks.logging.debug = true
	sock.run(function()

		local ta = tasks.exec('echo hello', {
			free_after = 0,
			bg = true,
			autostart = false,
		})
		ta:start()
		tasks.notify_warn"The times they are a-changin'"
		tasks.notify_error"Gotcha!"

		tasks.set_scheduled_task('wasup', {
			task_name = 'wasup',
			action = function()
				tasks.notify'Wasup!'
			end,
			start_hours = 0,
			run_every = 10,
		})

		tasks.task_scheduler'start'
	end)
end

return M
