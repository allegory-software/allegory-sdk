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
		opt.restart_after         restart after s seconds in case of error
	t.id
	tasks -> {ta->true}        root task list
	tasks_by_id -> {id->ta}    root task list mapped by id
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
	task_exec(cmd_args|{cmd,arg1,...}, opt) -> ta

]]

require'glue'
require'proc'
require'sock'
require'events'
require'json'

--terminals ------------------------------------------------------------------

--null terminal: fires events for input. can pipe input to other terminals.
--publishes: pipe(term, [on]).

local nterm = object(nil, nil, events)
null_terminal = nterm
nterm.subclass = object
nterm.override = override
nterm.before = before
nterm.after = after

function nterm:__call(...)
	local self = object(self, ...)
	self:init()
	return self
end

nterm.init = noop

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
	self._print = self._print or print_function(function(s) self:out_stdout(s) end)
	self._print(...)
end

function nterm:pipe(term, on, filter) --pipe out self to term.
	if on == false then
		return self:off{'out', term}
	end
	self:on({'out', term}, function(self, src_term, chan, ...)
		if not filter or filter(self, chan, ...) then
			local ok, err = pcall(term.out, term, src_term, chan, ...)
			if not ok then --if the output terminal breaks, unpipe it.
				self:pipe(term, false)
				local task = src_term.task
				log('ERROR', 'tasks', 'out', '[%d] %s: %s',
					task and task.id or '?',
					task and task.name or '?',
					err)
			end
		end
	end)
	return self
end

--recording terminal: records input and plays it back on another terminal.
--publishes: playback(te), stdout(), stderr(), stdouterr(), notifications().

local rterm = object(nil, nil, nterm)
recording_terminal = rterm

function rterm:init()
	self.tape = {}
end

rterm:after('out', function(self, src_term, chan, ...)
	add(self.tape, pack(src_term, chan, ...))
end)

function rterm:playback(term)
	for _,t in ipairs(self.tape) do
		term:out(unpack(t))
	end
end

do
local function add_some(self, maybe_add)
	local dt = {}
	for _,t in ipairs(self.tape) do
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

local cterm = object(nil, nil, nterm)
cmdline_terminal = cterm

local stdout, stderr = io.stdout, io.stderr
cterm:after('out', function(self, src_term, chan, ...)
	if chan == 'stdout' then
		local s = ...
		stdout:write(s)
	elseif chan == 'stderr' then
		local s = ...
		stderr:write(s)
		stderr:flush()
	elseif chan == 'notify' then
		local kind, s = ...
		stderr:write(_('%s: %s\n', repl(kind, 'info', 'note'):upper(), s))
		stderr:flush()
	end
end)

--streaming output terminal: serializes input for network transmission.
--calls: sterm.send(s)

local sterm = object(nil, nil, nterm)
streaming_terminal = sterm

function sterm:send_on(chan, s)
	assert(#chan == 1)
	self.send(format('%s%08x\n%s', chan, #s, s))
end

sterm:after('out', function(self, src_term, chan, ...)
	if     chan == 'stdout' then self:send_on('1', ...)
	elseif chan == 'stderr' then self:send_on('2', ...)
	elseif chan == 'notify' then
		local kind = ...
		self:send_on(
				kind == 'info'  and 'N'
			or kind == 'warn'  and 'W'
			or kind == 'error' and 'E'
			or error(_('invalid notify kind: %s', kind)), select(2, ...))
	else
		self:send(chan, ...)
	end
end)

--streaming terminal reader: returns `write(buf, sz)` which when called,
--deserializes a terminal output stream and sends it to a terminal.

function streaming_terminal_reader(term)
	local buf = string_buffer()
	local chan, size
	return function(in_buf, sz)
		buf:putcdata(in_buf, sz)
		::again::
		if not size and #buf >= 10 then
			chan = buf:get(1)
			local s = buf:get(9)
			size = assert(tonumber(s, 16))
		end
		if size and #buf >= size then
			local s = buf:get(size)
			if chan == '1' then
				term:out(nil, 'stdout', s)
			elseif chan == '2' then
				term:out(nil, 'stderr', s)
			elseif chan == 'N' then
				term:out(nil, 'notify', 'info', s)
			elseif chan == 'W' then
				term:out(nil, 'notify', 'warn', s)
			elseif chan == 'E' then
				term:out(nil, 'notify', 'error', s)
			elseif term.receive_on then
				term:receive_on(chan, s)
			end
			chan, size = nil
			goto again
		end
	end
end

--current thread's terminal --------------------------------------------------

function current_terminal(thread)
	local env = threadenv(thread)
	return env and env.terminal
end
local current_terminal = current_terminal

function set_current_terminal(term, thread)
	local env = ownthreadenv(thread)
	local term0 = env.terminal
	env.terminal = term
	return term0
end

set_current_terminal(cterm())

function notify_kind  (...) current_terminal():notify_kind  (...) end
function notify       (...) current_terminal():notify       (...) end
function notify_error (...) current_terminal():notify_error (...) end
function notify_warn  (...) current_terminal():notify_warn  (...) end
function out_stdout(s) current_terminal():out_stdout(s) end
function out_stderr(s) current_terminal():out_stderr(s) end
out_stdout_print = print_function(out_stdout)
out_stderr_print = print_function(out_stderr)

--tasks ----------------------------------------------------------------------

tasks = {}
tasks_by_id = {}
local last_task_id = 0

task = object(nil, nil, events)
task.subclass = object
task.override = override
task.before = before
task.after = after

function task:__call(...)
	local self = object(self)
	self:init(...)
	if self.autostart then
		self:start_or_run()
	end
	return self
end

task.module = 'task' --default
task.free_after = 10

function task:stdout        () return self.terminal:stdout        () end
function task:stderr        () return self.terminal:stderr        () end
function task:stdouterr     () return self.terminal:stdouterr     () end
function task:notifications () return self.terminal:notifications () end

function task:init(...)
	last_task_id = last_task_id + 1
	self.visible = true
	self.name = last_task_id
	update(self, ...)
	self.id = last_task_id
	self.status = 'not started'
	self.child_tasks = {} --{task1,...}
	self.terminal = recording_terminal()
	self.terminal.task = self
	self.restart_count = 0
	tasks[self] = true
	tasks_by_id[self.id] = self
	if self.parent_task then
		self.parent_task:add_task(self)
	else
		local pt = current_terminal()
		if pt then
			self.parent_terminal = pt
			self.terminal:pipe(pt, true, self.out_filter)
		end
	end
end

function task:try_run()
	::again::
	self.start_time = time()
	self.status = 'running'
	self:fire_up('setstatus', 'running')
	local term0 = set_current_terminal(self.terminal)
	log('', 'tasks', 'run', '[%d] %s', self.id, self.name)
	local ok, ret = pcall(self.action, self)
	set_current_terminal(term0)
	self.duration = time() - self.start_time
	self.status = 'finished'
	self:fire_up('setstatus', 'finished')
	local err = not ok and tostring(ret):trim() or nil
	log('', 'tasks', 'finished', '[%d] %s: %s, took %s, %s', self.id, self.name,
		ok and 'OK' or err, duration(self.duration),
		self.killed and 'killed'
			or self.exit_code and 'exit code: '..self.exit_code
				or 'no exit code')
	if not ok and not self.killed then
		log('ERROR', 'tasks', 'run', '%s%s', err,
			self.restart_after
				and _('\nrestarting in %ds, restarted %d times before',
					self.restart_after, self.restart_count))
		if self.restart_after then
			wait(self.restart_after)
			self.restart_count = self.restart_count + 1
			goto again
		end
	end
	runafter(self.free_after or 1/0, function()
		while not self:free() do
			wait(1)
		end
	end, 'task-zombie %s', self.name)
	return self, ok, ret
end
function task:run()
	return assert(self:try_run())
end

function task:start()
	if self.start_time then
		return self --already started
	end
	resume(thread(self.run, 'task %s', self.name), self)
	return self
end

function task:start_or_run()
	if self.bg then
		return self:start()
	else
		return self:run()
	end
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
	tasks[self] = nil
	tasks_by_id[self.id] = nil
	self.freed = true
	self:fire_up('free')
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
	self.killed = true
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

exec_task = task:subclass{autostart = true}

exec_task:override('init', function(inherited, self, cmd, opt)

	opt = opt or empty

	local allow_out_stdout = opt.out_stdout ~= false
	local allow_out_stderr = opt.out_stderr ~= false
	function self:out_filter(term, chan)
		if not allow_out_stdout and chan == 'stdout' then return false end
		if not allow_out_stderr and chan == 'stderr' then return false end
		return true
	end

	self.poll_interval = .1

	inherited(self, opt)

	self.autokill = self.autokill ~= false
	self.capture_stdout = self.capture_stdout ~= false
	self.capture_stderr = self.capture_stderr ~= false
	self.env = self.env and update(env(), self.env)
	self.cmd = cmd

	function self:action()

		local p = exec{
			cmd = self.cmd,
			env = self.env,
			autokill = self.autokill,
			stdout = self.capture_stdout,
			stderr = self.capture_stderr,
			stdin = self.stdin and true or false,
		}

		self.process = p

		if p.stdin then
			resume(thread(function()
				local ok, err = p.stdin:write(self.stdin)
				if not ok then
					notify_error('stdin:write(): %s', err)
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
						notify_error('stdout:read(): %s', err)
						break
					elseif len == 0 then
						break
					end
					local s = str(buf, len)
					out_stdout(s)
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
						notify_error('stderr:read(): %s', err)
						break
					elseif len == 0 then
						break
					end
					local s = str(buf, len)
					out_stderr(s)
				end
				assert(p.stderr:close())
			end, 'exec-stderr %s', p))
		end

		local exit_code, err = p:wait(nil, self.poll_interval)
		self.exit_code = exit_code
		if not exit_code then
			if not (err == 'killed' and self.killed) then --crashed/killed from outside
				notify_error('proc:wait(): %s', err)
			end
		end
		while not (
				 (not p.stdin  or p.stdin :closed())
			and (not p.stdout or p.stdout:closed())
			and (not p.stderr or p.stderr:closed())
		) do
			wait(.1)
		end
		p:forget()

		if not self.bg and not self.allow_fail and exit_code ~= 0 then
			local cmd_s = isstr(cmd) and cmd or cmdline_quote_args(nil, unpack(cmd))
			local s = _('%s [%s]', cmd_s, exit_code)
			if self.stdin then
				s = s .. '\nSTDIN:\n' .. self.stdin
			end
			if self.env then
				local dt = {}
				for k,v in sortedpairs(t) do
					add(dt, _('%s = %s', k, v))
				end
				s = s .. '\nENV:\n' .. cat(dt, '\n')
			end
			notify_error('proc:exec(): %s', s)
		end

		return exit_code
	end

end)

function exec_task:do_kill()
	if not self.process then return end
	return self.process:kill()
end

--scheduled tasks ------------------------------------------------------------

scheduled_tasks = {} --{name->sched}

function set_scheduled_task(name, opt)
	if not opt then
		scheduled_tasks[name] = nil
	else
		assert(opt.action)
		assert(opt.start_hours or opt.run_every)
		local sched = scheduled_tasks[name]
		if not sched then
			sched = {name = name, ctime = time(), active = true, running = false}
			scheduled_tasks[name] = sched
		end
		update(sched, opt)
	end
end

--we need this minimum amount of persistence for scheduled tasks to work.
function load_tasks_data() end --stub
function save_task_data(name, t) end --stub

local function run_tasks()
	local now = time()
	local today = day(now)

	for name, sched in pairs(scheduled_tasks) do

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
				sched.last_run = now
				save_task_data(name, {last_run = now})
				task(sched):start()
			end

		end
	end
end

local sched_job
function task_scheduler(cmd)
	if cmd == 'start' and not sched_job then
		sched_job = runevery(1, run_tasks, 'tasks-sched')
	elseif cmd == 'stop' and sched_job then
		sched_job:resume()
		sched_job = nil
	elseif cmd == 'running' then
		return sched_job and true or false
	end
end

--self-test ------------------------------------------------------------------

if not ... then
	logging.verbose = true
	logging.debug = true
	run(function()

		local ta = exec_task('echo hello', {
			free_after = 0,
			bg = true,
			autostart = false,
		})
		ta:start()
		notify_warn"The times they are a-changin'"
		notify_error"Gotcha!"

		set_scheduled_task('wasup', {
			task_name = 'wasup',
			action = function()
				notify'Wasup!'
			end,
			start_hours = 0,
			run_every = 10,
		})

		task_scheduler'start'
	end)

end
