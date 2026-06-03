--[=[

	Process & IPC API for Linux.
	Written by Cosmin Apreutesei. Public Domain.

EXEC/KILL/PROCESS INFO
	[try_]exec(opt | cmd,[env],[dir],...) -> p
	- cmd       {cmd, arg1, ... } | 'cmd arg1 ...'  command and args
	- env       {VAR=VAL}                           env vars
	- dir       s                                   child process working directory
	- stdin,stdout,stderr   true|pipe               stdin/stdout/stderr redirection
	- autokill  t|f                                 kill child when parent dies
	- owner                                         owner (defaults to currentowner())
	[try_]exec_luafile(opt | script_file,...) -> p  spawn a process running a Lua script
	[try_]exec_lua(opt | script_code, ...)          spawn a process running Lua code
	p.pid                                           process ID
	p:kill([signal=SIGTERM]) -> ok | nil,err        kill process
	p:status() -> status                            active, finished, killed, forgotten
	p:wait_until([expires]) -> code | nil,status    wait for a process to finish
	p:wait([timeout]) -> code | nil,status          wait for a process to finish
	p:exit_code() -> code | nil,status              get process exit code
	p:forget()                                      close process handles
	p:try_close()                                   kill(9) and forget
	p:info() -> t                                   parse /proc/PID/stat
	kill(pid, [signal=SIGTERM]) -> ok | nil,err     kill a process
	proc_info([pid]) -> t                           parse /proc/PID/stat
ENV VARS
	env(k) -> v                                get env. var
	env(k, v)                                  set env. var
	env(k, false)                              delete env. var
	env() -> env                               get all env. vars
CMDLINE SPLIT/QUOTE
	cmdline_split_args(s) -> {arg1,...}        unquote and split args
	cmdline_escape(s) -> s                     escape string (but don't quote)
	cmdline_quote_arg(s) -> s                  quote as cmdline arg
	cmdline_quote_args(...) -> s               quote as cmdline args
	cmdline_quote_cmd(cmd) -> s                quote command
	cmdline_quote_vars({k->v}, [format]) -> s  quote as var assignments
OS INFO
	os_info() -> t                             parse /proc/* files
DAEMONIZE
	daemonize() -> pid                         daemonize current process
	daemonized -> true | false                 is current process daemonized?

------------------------------------------------------------------------------

[try_]exec(opt | cmd, [env], [dir], [stdin], [stdout], [stderr], [autokill]) -> p

	Spawn a child process and return a process object to query and control the
	process. Options can be given as separate args or in a table.

		cmd
			a string or an array containing the filepath of the executable to run
			and its command-line arguments.
		env
			a table of environment variables (if not given, the current
			environment is inherited).
		dir
			the directory to start the process in
		stdin, stdout, stderr
			pipe ends created with pipe() to redirect the standard input,
			output and error streams of the process; you can also set any
			of these to `true` to have them opened (and closed) for you.
		autokill
			kills the process when the calling process exits.

[try_]exec_luafile(opt | script_file,...) -> p
[try_]exec_lua(opt | script_code,...) -> p

	Spawn a process running a Lua script, using the same LuaJIT executable
	as that of the running process. The process starts in the current directory
	unless otherwise specified. The arguments and options are the same as for
	`exec()`, except that `cmd` must be a Lua file instead of an executable file.

--NOTES ----------------------------------------------------------------------

#### Env vars

Env vars are case-sensitive on POSIX.

#### Exit codes

POSIX codes are limited to 0..255.

#### Standard I/O redirection

The only way to safely redirect both stdin and stdout of child processes
without potentially causing deadlocks is to use async pipes and perform
the writes and the reads in separate epoll threads.

Don't forget to close the stdin file when you're done with it to signal
end-of-input to the child process.

Don't forget to check for read() returning 0, which can happen any time
and signals that the child process closed its end of the pipe.

#### Cleaning up

Always call forget() when you're done with the process, even after you
killed it, but not before you're done with all its redirected pipes if any
(because forget() also closes them).

#### Autokill caveats

If you start your autokilled process from a thread other than the main thread,
the process is killed when that thread ends, not when the process ends.

]=]

if not ... then require'proc_test'; return end

require'glue'
require'fs'
require'pbuffer'
require'signal'
local re = require'relabel'

assert(Linux, 'platform not Linux')

local
	C, errno =
	C, errno

local u8pa = ctype'char*[?]'

local proc = {type = 'process', debug_prefix = 'p'}
proc.__index = proc

cdef[[
extern char **environ;
int setenv(const char *name, const char *value, int overwrite);
int unsetenv(const char *name);
int execvpe(const char *file, char *const argv[], char *const envp[]);
typedef int pid_t;
pid_t fork(void);
int kill(pid_t pid, int sig);
typedef int idtype_t;
typedef int id_t;
pid_t waitpid(pid_t pid, int *status, int options);
void _exit(int status);
int dup2(int oldfd, int newfd);
pid_t getpid(void);
pid_t getppid(void);
int prctl(
	int option,
	unsigned long arg2,
	unsigned long arg3,
	unsigned long arg4,
	unsigned long arg5
);
int setsid();
unsigned int umask(unsigned int mask);
]]

local PR_SET_PDEATHSIG = 1

local WNOHANG = 1
local EINTR = 4

function env(k, v)
	if k then
		if v then
			assert(C.setenv(k, tostring(v), 1) == 0)
		elseif v == false then
			assert(C.unsetenv(k) == 0)
		else
			return os.getenv(k)
		end
	end
	local e = C.environ
	local t = {}
	local i = 0
	while e[i] ~= nil do
		local s = str(e[i])
		local k,v = s:match'^([^=]*)=(.*)'
		if k and k ~= '' then
			t[k] = v
		end
		i = i + 1
	end
	return t
end

local function close_fd(fd)
	return C.close(fd) == 0
end

--A token is one or more adjacent pieces concatenated by the {~ ~} (Cs) capture.
--A piece is one of: "..." (with \-escaping) | '...' (literal) | \char | plain chars.
--Quotes and backslashes are stripped via -> '' (replacement with empty string).
local split_args_patt = re.compile[[
	args    <- {| (S* token)* S* |}
	token   <- {~ piece+ ~}
	piece   <- dquoted / squoted / escaped / plain
	dquoted <- ('"' -> '') ('\' -> '' {.} / {[^"\]})* ('"' -> '')
	squoted <- ("'" -> '') {[^']*} ("'" -> '')
	escaped <- ('\' -> '') {.}
	plain   <- {(!%s !['"\] .)+}
	S       <- %s+
]]

function cmdline_split_args(s) --parse a shell-like command string into cmd, args
	local t = split_args_patt:match(s) or {}
	if not t[1] then return nil end
	local args
	if #t > 1 then
		args = {}
		for i = 2, #t do args[i-1] = t[i] end
	end
	return t[1], args
end

local function _exec(t, env, dir, stdin, stdout, stderr, autokill, owner)

	owner = _check_owner(owner)

	local cmd, args
	if istab(t) then
		cmd = t[1]
		if #t > 1 then
			args = {}
			for i = 2, t.n or #t do
				if t[i] then --nil and false args are skipped! pass '' to inject empty args.
					args[#args+1] = t[i]
				end
			end
		end
	else
		cmd, args = cmdline_split_args(t)
	end

	if dir and cmd:sub(1, 1) ~= '/' then
		cmd = cwd() .. '/' .. cmd
	end

	--copy the args list to a char*[] buffer.
	local arg_buf, arg_ptr
	do
		local n = #cmd + 1
		local m = args and #args + 1 or 1
		for i,s in ipairs(args or empty) do
			n = n + #s + 1
		end
		arg_buf = u8a(n)
		arg_ptr = u8pa(m + 1)
		local n = 0
		copy(arg_buf, cmd, #cmd + 1)
		arg_ptr[0] = arg_buf
		n = n + #cmd + 1
		for i,s in ipairs(args or empty) do
			copy(arg_buf + n, s, #s + 1)
			arg_ptr[i] = arg_buf + n
			n = n + #s + 1
		end
		arg_ptr[m] = nil
	end

	--copy the env. table to a char*[] buffer.
	local env_buf, env_ptr
	if env then
		local n = 0
		local m = 0
		for k,v in pairs(env) do
			v = tostring(v)
			n = n + #k + 1 + #v + 1
			m = m + 1
		end
		env_buf = u8a(n)
		env_ptr = u8pa(m + 1)
		local i = 0
		local n = 0
		for k,v in pairs(env) do
			v = tostring(v)
			env_ptr[i] = env_buf + n
			copy(env_buf + n, k, #k)
			n = n + #k
			env_buf[n] = string.byte('=')
			n = n + 1
			copy(env_buf + n, v, #v + 1)
			n = n + #v + 1
			i = i + 1
		end
		env_ptr[m] = nil
	end

	local self = setmetatable({cmd = cmd, args = args}, proc)
	_own(owner, self)

	local inp_rf, inp_wf
	local out_rf, out_wf
	local err_rf, err_wf
	local errno_rf, errno_wf

	local function check(ret, err)
		if ret then return ret end
		local ret, err = try_errno(ret, err)
		self:try_close()
		if err == 'not_found' or err == 'not_dir' then return nil, err end
		return check_for('proc', cmd, 'exec', ret, err)
	end

	--see https://stackoverflow.com/questions/1584956/how-to-handle-execvp-errors-after-fork
	local errno_rf, errno_wf = pipe{
		async = false,
		quiet = true,
		owner = self,
	}

	if stdin == true then
		inp_rf, inp_wf = pipe{
			async_read = false,
			read_inheritable = true,
			owner = self,
		}
		self.stdin = inp_wf
	elseif stdin then
		inp_rf = stdin
	end

	if stdout == true then
		out_rf, out_wf = pipe{
			async_write = false,
			write_inheritable = true,
			owner = self,
		}
		self.stdout = out_rf
	elseif stdout then
		out_wf = stdout
	end

	if stderr == true then
		err_rf, err_wf = pipe{
			async_write = false,
			write_inheritable = true,
			owner = self,
		}
		self.stderr = err_rf
	elseif stderr then
		err_wf = stderr
	end

	local ppid_before_fork = autokill and C.getpid()
	local pid = C.fork()

	if pid == -1 then --in parent process, error

		return check()

	elseif pid == 0 then --in child process

		--we're doing raw syscalls in here because if anything were to fail
		--in this setup part we won't see a stack trace anywhere.

		--put errno on the errno pipe and exit.
		local function check(ret, err)
			if ret then return ret end
			local err = u32a(1, err or errno())
			while C.write(errno_wf.fd, err, sizeof(err)) == -1 and errno() == EINTR do end
			--^^ this can fail but it should not block.
			C._exit(0)
		end

		--see https://stackoverflow.com/questions/284325/how-to-make-child-process-die-after-parent-exits/36945270#36945270
		--NOTE: prctl() must be called from the main thread. If instead it is
		--called from a secondary thread, the process will die with that thread !!
		if autokill then
			check(C.prctl(PR_SET_PDEATHSIG, SIGTERM, 0, 0, 0) ~= -1)
			--exit if the parent exited just before the prctl() call.
			if C.getppid() ~= ppid_before_fork then
				C._exit(0)
			end
		end

		check(close_fd(errno_rf.fd))

		check(not dir or C.chdir(dir) == 0)

		local function close_dup(close_f, dup_f, fd)
			if close_f then check(close_fd(close_f.fd)) end
			if dup_f then
				check(C.dup2(dup_f.fd, fd) == fd)
				if dup_f.fd ~= fd then check(close_fd(dup_f.fd)) end
			end
		end
		close_dup(inp_wf, inp_rf, 0)
		close_dup(out_rf, out_wf, 1)
		close_dup(err_rf, err_wf, 2)

		C.execvpe(cmd, arg_ptr, env_ptr or C.environ)

		--if we got here then exec failed.
		check()

	else --in parent process, success

		--set pid first so try_close() can clean up a partially initialized object.
		self.pid = pid

		--check if exec failed by reading from the errno pipe.
		errno_wf:close()
		local buf, len = pbuffer{f = errno_rf}:load(4):ref()
		assert(len == 0 or len == 4)
		if len == 4 then
			return check(nil, cast(u32p, buf)[0])
		end
		errno_rf:close()

		--Let the child process have the only handles to their pipe ends,
		--otherwise when the child process exits, the pipes will stay open on
		--account of us (the parent process) holding a handle to them.
		if inp_rf then inp_rf:close() end
		if out_wf then out_wf:close() end
		if err_wf then err_wf:close() end

		local s = cmdline_quote_args(cmd, unpack(args or empty))
		log('', 'proc', 'exec', '%s %s', self, s)
		live(self, '%s', s)

		return self
	end
end

function proc:forget()
	local pid = self.pid
	if not pid then return end --forget barrier
	self.pid = false
	_disown(self)
	if pid then live(self, nil) end
end

function kill(pid, sig)
	local ok, err = try_errno(C.kill(pid, sig or SIGTERM) == 0)
	if err == 'no_such_process' then return false, err end
	return check_for('proc', 'pid#'..pid, 'kill', ok, err)
end

getpid = C.getpid

function proc:kill(sig)
	if not self.pid then
		return false, 'forgotten'
	elseif self:status() == 'killed' then
		return true, 'already_killed'
	end
	return kill(self.pid, sig)
end

function proc:try_close()
	if self.pid then
		C.kill(self.pid, 9)
	end
	self:forget()
end

function proc:exit_code()
	if self._exit_code then
		return self._exit_code
	elseif self._killed then
		return nil, 'killed'
	end
	if not self.pid then
		return nil, 'forgotten'
	end
	local status = u32a(1)
	local pid
	repeat
		pid = C.waitpid(self.pid, status, WNOHANG)
	until not (pid < 0 and errno() == EINTR)
	check_for('proc', self, 'wait', try_errno(pid >= 0))
	if pid == 0 then
		return nil, 'active'
	end
	--save the exit status so we can forget the process.
	if band(status[0], 0x7f) == 0 then --exited with exit code
		self._exit_code = shr(band(status[0], 0xff00), 8)
		return self._exit_code
	else
		self._killed = true
		return nil, 'killed'
	end
end

function proc:wait_until(expires)
	if not self.pid then
		return nil, 'forgotten'
	end
	local exit_code, err = self:exit_code()
	if exit_code or err ~= 'active' then
		return exit_code, err
	end
	local pidf, err = pidfd_open{pid = self.pid, owner = self}
	if not pidf then
		return nil, err
	end
	pidf:setexpires(expires)
	local ok, err = pidf:try_wait()
	pidf:close()
	if not ok then
		return nil, err == 'timeout' and 'active' or err
	end
	return self:exit_code()
end
function proc:wait(timeout)
	return self:wait_until(timeout and clock() + timeout)
end

function proc:status() --finished | killed | active | forgotten
	local x, err = self:exit_code()
	return x and 'finished' or err
end

--process state --------------------------------------------------------------

local load_proc = load

local USER_HZ do
	cdef'long int sysconf(int name);'
	local _SC_CLK_TCK = 2
	USER_HZ = tonumber(C.sysconf(2))
	assert(USER_HZ ~= -1)
end

local parse_stat do
	local state_name = {
		R = 'running',
		S = 'sleeping', -- in an interruptible wait
		D = 'waiting', --in uninterruptible disk sleep
		Z = 'zombie',
		T = 'stopped',
		t = 'tracing stop',
		X = 'dead',
	}
	local N = {'(-?%d+)', tonumber}
	local T = {'(-?%d+)', function(s) return tonumber(s) / USER_HZ end}
	local t = {
		'pid'        , N,
		'comm'       , {'%((.-)%)', function(s) return s end},
		'state'      , {'(.)', function(s) return state_name[s] end},
		'ppid'       , N,
		'pgrp'       , N,
		'session'    , N,
		'tty_nr'     , N,
		'tpgid'      , N,
		'flags'      , N,
		'minflt'     , N,
		'cminflt'    , N,
		'majflt'     , N,
		'cmajflt'    , N,
		'utime'      , T,
		'stime'      , T,
		'cutime'     , T,
		'cstime'     , T,
		'priority'   , N,
		'nice'       , N,
		'num_threads', N,
		'itrealvalue', N,
		'starttime'  , T,
		'vsize'      , N,
		'rss'        , {'(-?%d+)', function(s) return tonumber(s) * pagesize() end},
		'rsslim'     , N,
	}
	local nt, pt, dt = {}, {}, {}
	for i = 1, #t, 2 do
		local name, p = t[i], t[i+1]
		nt[#nt+1] = name
		pt[#pt+1] = p[1]
		dt[#dt+1] = p[2]
	end
	local patt = table.concat(pt, '%s+')
	local function pass(...)
		local t = {}
		for i=1,select('#',...) do
			t[nt[i]] = dt[i]((select(i,...)))
		end
		return t
	end
	function parse_stat(s)
		return pass(s:match(patt))
	end
end
function proc_info(pid)
	local s, err = load_proc(format('/proc/%d/stat', pid or C.getpid()))
	if not s then return nil, err end
	return parse_stat(s)
end

function proc:info()
	if not self.pid then return nil, 'forgotten' end
	return proc_info(self.pid)
end

function os_info()
	local s, err = load_proc'/proc/meminfo'
	if not s then return nil, err end
	local total = tonumber(s:match'MemTotal:%s*(%d+) kB')
	local avail = tonumber(s:match'MemAvailable:%s*(%d+) kB')
	total = total and total * 1024
	avail = avail and avail * 1024

	local s, err = load_proc'/proc/stat'
	if not s then return nil, err end
	local cputimes = {}
	for cpu, user, nice, sys, idle in s:gmatch'cpu(%d+)%s+(%d+)%s+(%d+)%s+(%d+)%s+(%d+)' do
		cpu     = tonumber(cpu)
		user    = tonumber(user)  / USER_HZ
		nice    = tonumber(nice)  / USER_HZ
		sys     = tonumber(sys)   / USER_HZ
		idle    = tonumber(idle)  / USER_HZ
		cputimes[cpu+1] = {user = user, nice = nice, sys = sys, idle = idle}
	end

	local s, err = load_proc'/proc/uptime'
	if not s then return nil, err end
	local uptime = tonumber(s:match'^%d+')

	return {
		ram_size = total,   --in bytes
		ram_free = avail,   --in bytes
		uptime   = uptime,  --in seconds
		cputimes = cputimes, --per-cpu times
	}
end

--https://www.freedesktop.org/software/systemd/man/daemon.html#SysV%20Daemons
function daemonize()
	--1. close all fds above 0, 1, 2: can't do that.
	--2. reset all signal handlers: can't do that.
	--signal_ignore'SIGHUP SIGTERM SIGINT SIGQUIT'
	--3. no need to call sigprocmask() as LuaJIT doesn't change them.
	--4. no need to sanitize the environment block.
	--5. call fork.
	local pid = C.fork()
	assert(pid >= 0)
	if pid > 0 then --parent process
		C._exit(0)
	end
	--child process
	--6. detach from any terminal and create an independent session.
	assert(C.setsid() >= 0)
	--7. call fork() again so that the daemon can never re-acquire a terminal.
	local pid = C.fork()
	assert(pid >= 0)
	if pid > 0 then --parent process
		--8. exit the first child, so that only the second child stays around.
		C._exit(0)
	end
	--child process
	--9. redirect stdin/out/err to /dev/null.
	logging.quiet = true --no point logging to /dev/null.
	local O_RDWR = 2
	local null_fd = C.open('/dev/null', O_RDWR, 0)
	assert(C.dup2(null_fd, 0) == 0)
	assert(C.dup2(null_fd, 1) == 1)
	assert(C.dup2(null_fd, 2) == 2)
	C.umask(0)
	--10. reset the umask to 0.
	--11. no need to chdir to `/`.
	daemonized = true
	return C.getpid()
end

function cmdline_escape(s) --escape for putting inside double-quoted string
	return tostring(s):gsub('[$`\\!]', '\\%1')
end

function cmdline_quote_arg(s)
	s = tostring(s)
	if not s:find'[^a-zA-Z0-9._+:@%%/%-=]' then
		return s
	else
		return '"'..cmdline_escape(s)..'"'
	end
end

function cmdline_quote_vars(vars, format)
	local t = {}
	for k,v in sortedpairs(vars) do
		t[#t+1] = string.format(format or '%s=%s\n', k, cmdline_quote_arg(v))
	end
	return table.concat(t)
end

function cmdline_quote_args(...)
	local t = {}
	for i=1,select('#',...) do
		local v = select(i,...)
		if v then --nil and false args are skipped. pass '' to inject empty args.
			t[#t+1] = cmdline_quote_arg(v)
		end
	end
	return table.concat(t, ' ')
end

function cmdline_quote_cmd(cmd)
	if not istab(cmd) then
		return cmd
	end
	local t = {}
	t[1] = cmd[1]
	for i = 2, cmd.n or #cmd do
		if cmd[i] then --nil and false args are skipped. pass '' to inject empty args.
			t[#t+1] = cmdline_quote_arg(cmd[i])
		end
	end
	return concat(t, ' ')
end

--cmd|{cmd,arg1,...}, env, ...
--{cmd=cmd|{cmd,arg1,...}, env=, ...}
function try_exec(t, ...)
	if istab(t) and t.cmd then
		return _exec(t.cmd, t.env, t.dir, t.stdin, t.stdout, t.stderr, t.autokill, t.owner)
	else
		return _exec(t, ...)
	end
end

--script|{script,arg1,...}, env, ...
--{script=, env=, ...}
function try_exec_lua_file(arg, ...)
	local script = isstr(arg) and arg or arg.script
	local cmd = isstr(script) and {exefile(), script} or extend({exefile()}, script)
	if isstr(arg) then
		return _exec(cmd, ...)
	else
		local t = {cmd = cmd}
		for k,v in pairs(arg) do
			if k ~= 'script' then
				t[k] = v
			end
		end
		return try_exec(t)
	end
end

function try_exec_lua(arg, ...)
	local script = isstr(arg) and arg or arg.script
	local t = {cmd = {exefile(), '-'}, stdin = true}
	if isstr(arg) then
		t.env, t.dir, t.stdout, t.stderr, t.autokill, t.owner = ...
	else
		for k,v in pairs(arg) do
			if k ~= 'script' and t[k] == nil then
				t[k] = v
			end
		end
	end
	local p, err = try_exec(t)
	if not p then return nil, err end
	run(function()
		p.stdin:write(script)
		p.stdin:close()
	end)
	return p
end

local function wrap(f)
	return function(...)
		local p, err = f(...)
		if p then return p end
		local t = ...; local cmd = istab(t) and t.cmd or t
		local cmd = cmdline_quote_cmd(cmd)
		check_for('proc', cmd, 'exec', nil, err)
	end
end
exec          = wrap(try_exec)
exec_lua_file = wrap(try_exec_lua_file)
exec_lua      = wrap(try_exec_lua)
