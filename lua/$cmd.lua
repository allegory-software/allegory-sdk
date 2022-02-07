--[==[

	$ | command-line scripts
	Written by Cosmin Apreutesei. Public Domain.

	say(fmt,...)
	sayn(fmt,...)
	die(fmt,...)

CMDLINE

	cmdsection(name) -> section                    create a cmdline section
	section([active, ]cmdargs, help[, descr], fn)  add a command to a section
	cmd    ([active, ]cmdargs, help[, descr], fn)  add a command to the misc section
	cmdaction(...) -> fn, arg_i                    process cmdline & get the cmd action handler

]==]

require'$'
require'$log'

--printing -------------------------------------------------------------------

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

--commands -------------------------------------------------------------------

local cmds = {}

local function addcmdalias(self, name, cmd, isalias)
	assertf(not self[name], 'cmdline command already defined: %s', name)
	if not isalias then
		rawset(self, #self + 1, cmd)
	end
	rawset(self, name, cmd)
	cmds[name] = cmd.fn
end
local function addcmd(self, active, s, helpline, help, fn)
	if not active then return end
	if isstr(active) then --shift active arg
		active, s, helpline, help, fn = true, active, s, helpline, help
	end
	if isfunc(help) or istab(help) then --shift help arg
		help, fn = nil, help
	end
	if istab(fn) then --alias
		addcmdalias(self, s, fn)
	else
		assertf(isfunc(fn), 'cmdline function missing for %s', s)
		local name, args = s:match'^([^%s]+)(.*)'
		name = assert(name, 'cmdline command name missing'):gsub('-', '_'):lower()
		local args = repl(args:trim(), '')
		if not args then
			args = {}
			for i = 1, debug.getinfo(fn).nparams do
				args[i] = debug.getlocal(fn, i):gsub('_', '-'):upper()
			end
			if debug.getinfo(fn, 'u').isvararg then
				add(args, '...')
			end
			args = #args > 0 and cat(args, ' ') or nil
		end
		local cmd = {name = name, args = args, fn = fn, helpline = helpline, help = help}
		if name:find('|', 1, true) then
			for i,name in ipairs(names(name, '|')) do
				addcmdalias(self, name, cmd, i > 1)
			end
		else
			addcmdalias(self, name, cmd)
		end
	end
end

local cmdsections = {}

function cmdsection(name)
	local key = name:upper()
	local s = cmdsections[key]
	if not s then
		s = setmetatable({}, {name = name, __call = addcmd})
		cmdsections[key] = s
		add(cmdsections, s)
	end
	return s
end

cmd = cmdsection'MISC'

cmd('help', 'Show this screen', function()
	local function helpline(cmd)
		local args = cmd.args
		local name = cmd.name:gsub('_', '-')
		local args = args and ' '..args or ''
		say(fmt('   %-33s %s', name..args, cmd.helpline or ''))
	end
	say''
	say(' USAGE: %s %s [OPTIONS] COMMAND ...', arg[-1], arg[0])
	for _,section in ipairs(cmdsections) do
		say''
		say(getmetatable(section).name)
		say''
		for _,cmd in ipairs(section) do
			helpline(cmd)
		end
	end
	say''
	say' OPTIONS'
	say''
	say'   -v         verbose'
	say'   --debug    debug'
	say''
end)

function cmdoptions(...)

	local i = 1
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
			break
		end
	end

	--inherit debug and verbosity from parent process.
	if repl(env'DEBUG'  , '', nil) then logging.debug   = true end
	if repl(env'VERBOSE', '', nil) then logging.verbose = true end

	return i
end

function cmdaction(arg_i, ...)
	local s = select(arg_i-1, ...)
	if s == '--help' then s = 'help' end
	local c = s and s:gsub('-', '_')
	return cmds[c] or cmds.help
end
