--[=[

	$ | command-line scripts
	Written by Cosmin Apreutesei. Public Domain.

	say(s)
	sayn(s)
	die(s)

	[win|lin]cmd('cmd ARGS...', 'help line', function(...) end)

	[win|lin]cmd   {name->f} add command-line handlers here.
	cmdargs        {cmd->s} args description for command.
	cmdhelp        {cmd->s} help line for command.

]=]

require'$'
require'$log'

local function addcmd(self, s, help, fn)
	if not self.active then return end
	assertf(fn, 'cmdline function missing for %s', s)
	local name, args = s:match'^([^%s]+)(.*)'
	name = assert(name):gsub('-', '_')
	rawset(cmd, #cmd + 1, name)
	rawset(cmd, name, fn)
	cmdargs[name] = repl(args:trim(), '')
	cmdhelp[name] = help
end

local function newcmd(t, k, v)
	addcmd(t, k, nil, v)
end
cmd    = setmetatable({active = true   }, {__newindex = newcmd, __call = addcmd})
wincmd = setmetatable({active = Windows}, {__newindex = newcmd, __call = addcmd})
lincmd = setmetatable({active = Linux  }, {__newindex = newcmd, __call = addcmd})
cmdargs = {}
cmdhelp = {}

function say(fmt, ...)
	io.stderr:write((fmt and fmt:format(...) or '')..'\n')
	io.stderr:flush()
end

function sayn(fmt, ...)
	io.stderr:write((fmt and fmt:format(...) or ''))
end

function die(fmt, ...)
	say(fmt and ('ABORT: '..fmt):format(...) or 'ABORT')
	os.exit(1)
end

cmd('help', 'Show this screen', function()
	local function helpline(k, f)
		local args = cmdargs[k]
		if not args then
			args = {}
			for i = 1, debug.getinfo(f).nparams do
				args[i] = debug.getlocal(f, i):gsub('_', '-'):upper()
			end
			if debug.getinfo(f, 'u').isvararg then
				add(args, '...')
			end
			args = #args > 0 and cat(args, ' ')
		end
		say(fmt('   %-33s %s', k:gsub('_', '-')..(args and ' '..args or ''), cmdhelp[k] or ''))
	end
	say''
	say(' USAGE: '..app_name..' [OPTIONS] COMMAND ...')
	say''
	for _,k in ipairs(cmd) do helpline(k, cmd[k]) end
	say''
	say' OPTIONS:'
	say''
	say'   -v       verbose'
	say'   --debug  debug'
	say''
end)

function cmdhandle(...)

	local i = 1
	local f
	while true do
		local s = select(i, ...)
		i = i + 1
		if s == '-v' then
			logging.verbose = true
			env('VERBOSE', 1) --propagate verbosity to sub-processes.
		elseif s == '--debug' then
			logging.verbose = true
			logging.debug = true
			env('DEBUG', 1) --propagate debug to sub-processes.
			env('VERBOSE', 1) --propagate verbosity to sub-processes.
		else
			if s == '--help' then s = 'help' end
			local c = s and s:gsub('-', '_') or 'help'
			f = cmd[c] or cmd.help
			break
		end
	end

	--inherit debug and verbosity from parent process.
	if repl(env'DEBUG'  , '', nil) then logging.debug   = true end
	if repl(env'VERBOSE', '', nil) then logging.verbose = true end

	return f, i
end

