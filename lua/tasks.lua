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
		* terminals are piped to their parent task.
	* errors raised with add_error() as well as any errors in the action handler
	  are captured and re-raised if the task runs in foreground.

TERMINALS
	tasks.null_terminal      (nt, opt...) -> nt
	tasks.recording_terminal (rt, opt...) -> rt
	tasks.cmdline_terminal   (ct, opt...) -> ct
	tasks.streaming_terminal (st, opt...) -> st
	st.out_bytes(s)
	tasks.streaming_terminal_reader(term) -> read(buf, sz)
	*t:add_error(event, err)
	*t:notify_kind(kind, fmt, ...)
	*t:notify(fmt, ...)
	*t:notify_error(fmt, ...)
	*t:notify_warn(fmt, ...)
	*t:out_stdout(s)
	*t:out_stderr(s)
	*t:set_retval(v)
	*t:pipe(*t, [on])
	rt:playback(*t)
	rt:stdout()
	rt:stderr()
	rt:stdouterr()
	rt:errors()
	rt:notifications()

API
	local ta = tasks.task(opt)
		opt.action = fn(ta)       action to run
		opt.parent_task           child of `parent_task`
		opt.bg                    run in background.
		opt.allow_fail            do not re-raise the errors raised with add_error().
		opt.free_after            free after N seconds (10). false = 1/0.
		opt.name                  task name (for listing and for debugging).
		opt.stdin                 stdin (for exec() tasks)

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
	ta:start() -> ta           start task.
	ta:kill() -> t|f           kill task along with its children.
	ta:do_kill() -> t|f        implement kill. must return true on success.
	ta:free() -> t|f           free task along with its children, if none are running.
	^setstatus(ta, status)
	^add_task(parent_ta, child_ta)
	^remove_task(parent_ta, child_ta)

TERMINALS
	M.terminal(opt) -> te      create a terminal that can watch one or more tasks.
	te:attach(ta)              attach terminal to a task.
	te:detach(ta)              detach terminal from a task.
	^<task event>(...)         attached tasks forward their events to the terminal.

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

function nterm:log(severity, event, ...)
	local logging = self.logging
	if not logging then return end
	logging.log(severity, 'term', event, ...)
end

function nterm:out(...)
	self:fire('out', ...)
end

function nterm:add_error(event, err)
	self:log('ERROR', event, '%s', err)
	self:out('error', event, err)
end

function nterm:out_notify(kind, s)
	self:out('notify', kind, s)
end
function nterm:notify_kind (kind, ...) self:out_notify( kind  , _(...)) end
function nterm:notify            (...) self:out_notify('info' , _(...)) end
function nterm:notify_error      (...) self:out_notify('error', _(...)) end
function nterm:notify_warn       (...) self:out_notify('warn' , _(...)) end

function nterm:out_stdout(s)
	self:out('stdout', s)
end

function nterm:out_stderr(s)
	self:out('stderr', s)
end

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

function nterm:set_retval(v)
	self:out('retval', v)
end

function nterm:pipe(term, on) --pipe out self to term.
	if on == false then
		return self:off{'out', term}
	end
	self:on({'out', term}, function(self, ...)
		term:out(...)
	end)
end

--recording terminal: records input and plays it back on another terminal.
--publishes: playback(te), stdout(), stderr(), stdouterr(), errors(), notifications().

local rterm = glue.object(nil, nil, nterm)
M.recording_terminal = rterm

function rterm:init()
	self.buffer = {}
end

rterm:after('out', function(self, ...)
	add(self.buffer, pack(...))
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
local function add_stdout(t, cmd, s)
	if cmd == 'stdout' then add(t, s) end
end
local function add_stderr(t, cmd, s)
	if cmd == 'stderr' then add(t, s) end
end
local function add_stdouterr(t, cmd, s)
	if cmd == 'stdout' or cmd == 'stderr' then add(t, s) end
end
local function add_error(t, cmd, event, err)
	if cmd == 'error' then add(t, {event = event, err = err}) end
end
local function add_notify(t, cmd, kind, message)
	if cmd == 'notify' then add(t, {kind = kind, message = message}) end
end
function rterm:stdout        () return cat(add_some(self, add_stdout)) end
function rterm:stderr        () return cat(add_some(self, add_stderr)) end
function rterm:stdouterr     () return cat(add_some(self, add_stdouterr)) end
function rterm:errors        () return add_some(self, add_error) end
function rterm:notifications () return add_some(self, add_notify) end
end

--command-line terminal: formats input for command-line consumption.

local cterm = glue.object(nil, nil, nterm)
M.cmdline_terminal = cterm

cterm:after('out', function(self, cmd, ...)
	if cmd == 'stdout' then
		local s = ...
		io.stdout:write(s)
	elseif cmd == 'stderr' then
		local s = ...
		io.stderr:write(s)
		io.stderr:flush()
	elseif cmd == 'notify' then
		local kind, s = ...
		io.stderr:write(_('%s: %s\n', repl(kind, 'info', 'note'):upper(), s))
		io.stderr:flush()
	elseif cmd == 'error' then
		local event, err = ...
		io.stderr:write(_('ERROR [%s]: %s\n', event, tostring(err)))
		io.stderr:flush()
	end
end)

--streaming output terminal: serializes input for network transmission.
--calls: sterm.out_bytes(s)

local sterm = glue.object(nil, nil, nterm)
M.streaming_terminal = sterm

function sterm:out_on(chan, s)
	self.out_bytes(format('%s%08x\n%s', chan, #s, s))
end

sterm:after('out', function(self, cmd, ...)
	if     cmd == 'stdout' then self:out_on('1', ...)
	elseif cmd == 'stderr' then self:out_on('2', ...)
	elseif cmd == 'notify' then
		self:out_on(
				kind == 'info'  and 'N'
			or kind == 'warn'  and 'W'
			or kind == 'error' and 'E', ...)
	elseif cmd == 'error' then
		local event, err = ...
		self:out_on('e', json.encode{event, tostring(...)})
	elseif cmd == 'retval' then
		local ret = ...
		self:out_on('R', json.encode(ret))
	end
end)

--return `write(buf, sz)` which when called, deserializes a terminal output
--stream and sends it to a terminal.

function M.streaming_terminal_reader(self)
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
				self:out('stdout', s)
			elseif chan == '2' then
				self:out('stderr', s)
			elseif chan == 'N' then
				self:out('notify', 'info', s)
			elseif chan == 'W' then
				self:out('notify', 'warn', s)
			elseif chan == 'E' then
				self:out('notify', 'error', s)
			elseif chan == 'e' then
				local event, err = json.decode(s)
				self:out('error', event, err)
			elseif chan == 'R' then
				local ret = json.decode(s)
				self:out('retval', ret)
			else
				error(_('invalid channel: "%s"', chan))
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
	getownthreadenv(thread).terminal = term
end

M.set_current_terminal(cterm())

function M.add_error    (...) current_terminal():add_error    (...) end
function M.notify_kind  (...) current_terminal():notify_kind  (...) end
function M.notify       (...) current_terminal():notify       (...) end
function M.notify_error (...) current_terminal():notify_error (...) end
function M.notify_warn  (...) current_terminal():notify_warn  (...) end
function M.out_stdout(s) current_terminal():out_stdout(s) end
function M.out_stderr(s) current_terminal():out_stderr(s) end
function M.set_retval(v) current_terminal():out_retval(v) end

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

	function self:start()

		if self.start_time then
			return self --already started
		end
		self.start_time = time()
		self:_setstatus'running'

		local function run_task()

			getownthreadenv().terminal = self.terminal

			local ok, ret = errors.pcall(self.action, self)
			if not ok then
				M.add_error('run', ret)
				self:_finish()
			else
				self:_finish(ret or 0)
			end

			runafter(self.free_after or 1/0, function()
				while not self:free() do
					sleep(1)
				end
			end, 'task-zombie %s', self.name)
		end

		if self.bg then
			resume(thread(run_task), 'task %s', self.name)
		else
			run_task()
			if not self.allow_fail and #self.errors > 0 then
				error(cat(imap(imap(self.errors, 'error'), tostring), '\n'))
			end
		end

		return self
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

function task:_running()
	if self.status == 'running' then return true end
	for _,child_task in ipairs(self.child_tasks) do
		if child_task:_running() then
			return true
		end
	end
end

function task:free()
	if self.freed then return false end
	if self.pinned then return false end
	if self:_running() then return false end
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

function task:_setstatus(s)
	self.status = s
	self:fire_up('setstatus', s)
end

function task:_finish(exit_code)
	if not self.start_time then return end --not started.
	if self.duration then return end --already called.
	self.duration = time() - self.start_time
	self.exit_code = exit_code
	self:_setstatus'finished'
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

	function task:action()

		if p.stdin then
			resume(thread(function()
				--dbg('mm', 'execin', '%s', opt.stdin)
				local ok, err = p.stdin:write(opt.stdin)
				if not ok then
					M.add_error('stdinwr', err)
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
						M.add_error('stdoutrd', err)
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
						M.add_error('stderrrd', err)
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
			if not (err == 'killed' and task.killed) then
				M.add_error('procwait', err)
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
			M.add_error('exec', s)
		end

		return exit_code
	end

	function task:do_kill()
		return p:kill()
	end

	if task.autostart ~= false then
		task:start()
	end

	return task
end

--scheduled tasks ------------------------------------------------------------

M.scheduled_tasks = {}

function M.set_scheduled_task(name, opt)
	if not opt then
		M.scheduled_tasks[name] = nil
	else
		assert(opt.task_name)
		assert(opt.action)
		assert(opt.start_hours or opt.run_every)
		assert(opt.machine or opt.deploy)
		local sched = M.scheduled_tasks[name]
		if not sched then
			sched = {sched_name = name, ctime = time(), active = true}
			M.scheduled_tasks[name] = sched
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

	for sched_name,t in pairs(M.scheduled_tasks) do

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

			if now >= min_time and not M.running_task(t.task_name) then
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
						M.add_error('mm', 'runtask', '%s: %s', sched_name, err)
					end
				end, 'run-task %s', t.task_name))
			end

		end
	end
end

--self-test ------------------------------------------------------------------

if not ... then
	local tasks = M
	sock.run(function()
		local ta = tasks.exec('echo hello', {
			free_after = 0,
			bg = true,
			autostart = false,
		})
		ta:start()
		M.notify_warn"The times they are a-changin'"
		M.add_error("steamin'", 'Gotcha!')
		M.add_error("cookin'" , 'Gotcha!')
		M.add_error("relaxin'", 'Gotcha!')
		M.add_error("workin'" , 'Gotcha!')
	end)
end

return M
