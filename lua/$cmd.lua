--[=[

	$ | command-line scripts
	Written by Cosmin Apreutesei. Public Domain.

	say(s)
	sayn(s)
	die(s)

	cmdsection(name) -> section
	section([active], 'cmd ARGS...', 'help line'[, 'long descr.'], function(...) end)

]=]

require'$'
require'$log'

--print vocabulary -----------------------------------------------------------

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

local function addcmd(self, active, s, helpline, help, fn)
	if active == false then return end
	if isstr(active) then --shift active arg
		active, s, helpline, help, fn = true, active, s, helpline, help
	end
	if isfunc(help) or istab(help) then --shift help arg
		help, fn = nil, help
	end
	local name, shortname, cmd, args
	if istab(fn) then --alias
		name, cmd = s, fn
	else
		assertf(isfunc(fn), 'cmdline function missing for %s', s)
		name, args = s:match'^([^%s]+)(.*)'
		name = assert(name, 'cmdline command name missing'):gsub('-', '_'):lower()
		helpname = name
		if name:find'%[' then
			shortname = name:match'^(.-)%['
			name = name:gsub('[%[%]]', '')
		end
		assertf(not self[name], 'cmdline command already defined: %s', name)
		args = repl(args:trim(), '')
		cmd = {name = helpname, args = args, fn = fn, helpline = helpline, help = help}
	end
	rawset(self, #self + 1, cmd)
	rawset(self, name, cmd)
	cmds[name] = fn
	if shortname then
		rawset(cmds, shortname, fn)
	end
end

local function newcmd(self, s, fn)
	addcmd(self, s, nil, fn)
end

local cmdsections = {}

function cmdsection(name)
	local key = name:upper()
	local s = cmdsections[key]
	if not s then
		s = setmetatable({}, {name = name, __newindex = newcmd, __call = addcmd})
		cmdsections[key] = s
		add(cmdsections, s)
	end
	return s
end

cmd = cmdsection'MISC'

cmd('help', 'Show this screen', function()
	local function helpline(cmd)
		local args = cmd.args
		if not args then
			args = {}
			for i = 1, debug.getinfo(cmd.fn).nparams do
				args[i] = debug.getlocal(cmd.fn, i):gsub('_', '-'):upper()
			end
			if debug.getinfo(cmd.fn, 'u').isvararg then
				add(args, '...')
			end
			args = #args > 0 and cat(args, ' ')
		end
		local name = cmd.name:gsub('_', '-')
		local args = args and ' '..args or ''
		say(fmt('   %-33s %s', name..args, cmd.helpline or ''))
	end
	say''
	say(' USAGE: '..app_name..' [OPTIONS] COMMAND ...')
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
			f = cmds[c] or cmds.help
			break
		end
	end

	--inherit debug and verbosity from parent process.
	if repl(env'DEBUG'  , '', nil) then logging.debug   = true end
	if repl(env'VERBOSE', '', nil) then logging.verbose = true end

	return f, i
end

