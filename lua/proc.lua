--[=[

	Process & IPC API for Windows & Linux.
	Written by Cosmin Apreutesei. Public Domain.

	Missing features: named mutexes, semaphores and events.

	proc.exec(opt | cmd,...) -> p                   spawn a child process
	proc.exec_luafile(opt | script,...) -> p        spawn a process running a Lua script
	p:kill()                                        kill process
	p:wait([expires]) -> status                     wait for a process to finish
	p:status() -> active|finished|killed|forgotten  process status
	p:exit_code() -> code | nil,status              get process exit code
	p:forget()                                      close process handles

	proc.env(k) -> v                                get env. var
	proc.env(k, v)                                  set env. var
	proc.env(k, false)                              delete env. var
	proc.env() -> env                               get all env. vars

	proc.esc(s, [platform]) -> s                    escape string (but not quote)
	proc.quote_arg(s, [platform]) -> s              quote as cmdline arg
	proc.quote_arg[_PLATFORM](s) -> s               quote as cmdline arg
	proc.quote_args(platform, ...) -> s             quote as cmdline args
	proc.quote_args[_PLATFORM](...) -> s            quote as cmdline args
	proc.quote_vars({k->v}, [format], [platform]) -> s   quote as var assignments

proc.exec(opt | cmd, [env], [cur_dir], [stdin], [stdout], [stderr], [autokill]) -> p

	Spawn a child process and return a process object to query and control the
	process. Options can be given as separate args or in a table.

	* `cmd` can be either a **string or an array** containing the filepath
	  of the executable to run and its command-line arguments.
	* `env` is a table of environment variables (if not given, the current
	  environment is inherited).
	* `cur_dir` is the directory to start the process in.
	* `stdin`, `stdout`, `stderr` are pipe ends created with `fs.pipe()`
	  to redirect the standard input, output and error streams of the process;
	  you can also set any of these to `true` to have them opened (and closed)
	  for you.
	* `autokill` kills the process when the calling process exits.

proc.exec_luafile(opt | script,...) -> p

	Spawn a process running a Lua script, using the same LuaJIT executable
	as that of the running process. The process starts in the current directory
	unless otherwise specified. The arguments and options are the same as for
	`exec()`, except that `cmd` must be a Lua file instead of an executable file.

--NOTES ----------------------------------------------------------------------

#### Env vars

Only use uppercase env. var names because like file names, env. vars
are case-sensitive on POSIX, but case-insensitive on Windows.

Only use `proc.env()` to read variables instead of `os.getenv()` because
the latter won't see the changes made to variables.

#### Exit codes

Only use exit status codes in the 0..255 range because Windows exit
codes are int32 but POSIX codes are limited to a byte.

In Windows, if you kill a process from Task Manager, `exit_code()` returns `1`
instead of `nil, 'killed'`, and `status()` returns `'finished'` instead
of `'killed'`. You only get `'killed'` when you kill the process yourself
by calling `kill()`.

#### Standard I/O redirection

The only way to safely redirect both stdin and stdout of child processes
without potentially causing deadlocks is to use async pipes and perform
the writes and the reads in separate [sock](sock.md) threads.

Don't forget to close the stdin file when you're done with it to signal
end-of-input to the child process.

Don't forget to check for a zero-length read which can happen any time
and signals that the child process closed its end of the pipe.

#### Cleaning up

Always call forget() when you're done with the process, even after you
killed it, but not before you're done with all its redirected pipes if any
(because forget() also closes them).

#### Autkill caveats

In Linux, if you start your autokilled process from a thread other than
the main thread, the process is killed when the thread finishes, IOW
autokill is only portable if you start processes from the main thread.

In Windows, the autokill behavior is by default inherited by the child
processes. In Linux it isn't. IOW autkill inheritance is not portable.

]=]

if not ... then require'proc_test'; return end

local ffi = require'ffi'
local current_platform = ffi.os == 'Windows' and 'win' or 'posix'
local M = require('proc_'..current_platform)

local function extend(dt, t)
	if not t then return dt end
	local j = #dt
	for i=1,#t do dt[j+i]=t[i] end
end

--see https://docs.microsoft.com/en-us/archive/blogs/twistylittlepassagesallalike/everyone-quotes-command-line-arguments-the-wrong-way
--You will lose precious IQ points if you read that. Lose enough of them
--and you might get a job at Microsoft!
function M.esc_win(s) --escape for putting inside double-quoted string
	s = tostring(s)
	if not s:find'[\\"]' then
		return s
	end
	s = s:gsub('(\\*)"', function(s) return s:rep(2)..'\\"' end)
	s = s:gsub('\\+$', function(s) return s:rep(2) end)
	return s
end

function M.esc_unix(s) --escape for putting inside double-quoted string
	return tostring(s):gsub('[$`\\!]', '\\%1')
end

function M.esc(s, platform)
	platform = platform or current_platform
	local esc =
		   platform == 'win'  and M.esc_win
		or platform == 'unix' and M.esc_unix
	assert(esc, 'invalid platform')
	return esc(s)
end

function M.quote_path_win(s)
	if s:find'%s' then
		s = '"'..s..'"'
	end
	return s
end

function M.quote_arg_win(s)
	s = tostring(s)
	if not s:find'[ \t\n\v"^&<>|]' then
		return s
	else
		return '"'..M.esc_win(s)..'"'
	end
end

function M.quote_arg_unix(s)
	s = tostring(s)
	if not s:find'[^a-zA-Z0-9._+:@%%/%-=]' then
		return s
	else
		return '"'..M.esc_unix(s)..'"'
	end
end

function M.quote_arg(s, platform)
	platform = platform or current_platform
	local quote_arg =
		   platform == 'win'  and M.quote_arg_win
		or platform == 'unix' and M.quote_arg_unix
	assert(quote_arg, 'invalid platform')
	return quote_arg(s)
end

function M.quote_vars(vars, format, platform)
	local t = {}
	for k,v in sortedpairs(vars) do
		t[#t+1] = string.format(format or '%s=%s\n', k, M.quote_arg(v, platform))
	end
	return table.concat(t)
end

function M.quote_args(platform, ...)
	local t = {}
	for i=1,select('#',...) do
		local v = select(i,...)
		t[i] = M.quote_arg(v, platform)
	end
	return table.concat(t, ' ')
end
function M.quote_args_win (...) return M.quote_args('win', ...) end
function M.quote_args_unix(...) return M.quote_args('unix', ...) end

--cmd|{cmd,arg1,...}, env, ...
--{cmd=cmd|{cmd,arg1,...}, env=, ...}
local exec = M.exec
function M.exec(t, ...)
	if type(t) == 'table' then
		return exec(t.cmd, t.env, t.dir, t.stdin, t.stdout, t.stderr,
			t.autokill, t.async, t.inherit_handles)
	else
		return exec(t, ...)
	end
end

--script|{script,arg1,...}, env, ...
--{script=, env=, ...}
function M.exec_luafile(arg, ...)
	local exepath = require'package.exepath'
	local script = type(arg) == 'string' and arg or arg.script
	local cmd = type(script) == 'string' and {exepath, script} or extend({exepath}, script)
	if type(arg) == 'string' then
		return M.exec(cmd, ...)
	else
		local t = {cmd = cmd}
		for k,v in pairs(arg) do
			if k ~= 'script' then
				t[k] = v
			end
		end
		return M.exec(t)
	end
end

return M
