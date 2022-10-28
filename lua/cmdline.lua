--[==[

	command-line scripts
	Written by Cosmin Apreutesei. Public Domain.

	cmdsection(name, [wrap_fn]) -> section         create a cmdline section
	section([active, ]cmd+args, help[, descr], fn) add a command to a section
	cmd    ([active, ]cmd+args, help[, descr], fn) add a command to the misc section
	cmdaction(...) -> action, opt, args, run       process cmdline options
	fn : function(opt, args...)                    cmd action handler

]==]

require'glue'
require'proc'

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
			for i = 2, debug.getinfo(fn).nparams do --arg#1 gets the options.
				args[i-1] = debug.getlocal(fn, i):gsub('_', '-'):upper()
			end
			if debug.getinfo(fn, 'u').isvararg then
				add(args, '...')
			end
			args = #args > 0 and cat(args, ' ') or nil
		end
		local wrap = getmetatable(self).wrap
		if wrap then fn = wrap(fn) end
		local cmd = {name = name, args = args, fn = fn, helpline = helpline, help = help}
		if name:find('|', 1, true) then
			local isalias
			for name in words(name:gsub('|', ' ')) do
				addcmdalias(self, name, cmd, isalias)
				isalias = true
			end
		else
			addcmdalias(self, name, cmd)
		end
	end
end

local cmdsections = {}

function cmdsection(name, wrap)
	local key = name:upper()
	local s = cmdsections[key]
	if not s then
		s = setmetatable({}, {name = name, wrap = wrap, __call = addcmd})
		cmdsections[key] = s
		add(cmdsections, s)
	end
	return s
end

cmd = cmdsection'MISC'

local function usage()
	say(' USAGE: %s [OPTIONS] COMMAND ...', arg[0]:match'([^/\\]+)%.lua$')
end

local help = noop
function cmdhelp(f)
	local help0 = help
	help = function()
		help0()
		f()
	end
end
cmd('help', 'Show this screen', function()
	local function helpline(cmd)
		local args = cmd.args
		local name = cmd.name:gsub('_', '-')
		local args = args and ' '..args or ''
		say(fmt('   %-33s %s', name..args, cmd.helpline or ''))
	end
	say''
	usage()
	for _,section in ipairs(cmdsections) do
		say''
		say(getmetatable(section).name)
		say''
		for _,cmd in ipairs(section) do
			helpline(cmd)
		end
	end
	say''
	say'OPTIONS'
	say''
	say'   -v             verbose'
	say'   -q             quiet'
	say'   -vv|--debug    debug'
	say''
	if help then
		help()
	end
end)

local function run_action(action, opt, ...)
	local fn = cmds[action]
	if fn then
		return fn(opt, ...)
	else
		say(' ERROR: Unknown command: %s', action:gsub('_', '-'))
		usage()
	end
end

function cmdaction(...)

	local action
	local args = {n = 0}
	local opt = {}
	local noopt
	for i = 1, select('#',...) do
		local s = trim(select(i, ...))
		if s == '-' then
			noopt = true --stop processing options (allow args that start with `-`)
			goto next
		end
		if not noopt then
			local k,v = s:match'^%-%-?([^=]+)=(.*)' -- `-k=v` or `--k=v`
			if k then
				opt[k] = v
				goto next
			end
			local k = s:match'^%-%-?(.+)' -- `-k` or `--k`
			if k then
				if k:starts'no-' then -- `-no-k` or `--no-k`
					opt[k:sub(3)] = false
				else
					opt[k] = true
				end
				goto next
			end
		end
		if not action then
			action = s:gsub('-', '_')
			goto next
		end
		args.n = args.n + 1
		args[args.n] = repl(s, '') --empty args are received as `nil`
		::next::
	end

	if opt.v then
		logging.verbose = true
		env('VERBOSE', 1) --propagate verbosity to sub-processes.
	end

	if opt.q then
		logging.quiet = true
		env('QUIET', 1)
	end

	if opt.debug or opt.vv then
		logging.verbose = true
		logging.debug = true
		env('DEBUG', 1) --propagate debug to sub-processes.
		env('VERBOSE', 1) --propagate verbosity to sub-processes.
	end

	--inherit debug and verbosity from parent process.
	if repl(env'DEBUG'  , '', nil) then logging.debug   = true end
	if repl(env'VERBOSE', '', nil) then logging.verbose = true end

	return action or 'help', opt, args, run_action
end
