--[[

	File and TCP logging with capped disk & memory usage.
	Written by Cosmin Apreutesei. Public domain.

LOGGING
	logging.log(severity, module, event, fmt, ...)
	logging.logvar(k, v)
	logging.live(e, [fmt, ...] | nil)
UTILS
	logging.arg(v) -> s
	logging.print(v) -> s
	logging.args(...) -> ...
CONFIG
	logging.deploy            app deployment name (logged to server)
	logging.machine           app machine name (logged to server)
	logging.env               app deployment type: 'dev', 'prod', etc.
	logging.quiet             do not log anything to stderr (false)
	logging.verbose           log `note` messages to stderr (false)
	logging.debug             log `debug` messages to stderr (false)
	logging.flush             flush stderr after each message (false)
	logging.max_disk_size     max disk size occupied by logging (16M)
	logging.queue_size        queue size for when the server is slow (10000)
	logging.timeout           timeout (5)
	logging.filter.NAME = true    filter out debug messages of specific module/event
	logging.censor.name <- f(severity, module, ev, msg)  |set a function for censoring secrets in logs
INIT
	logging:tofile(logfile, max_disk_size)
	logging:toserver(host, port, queue_size, timeout)

Logging is done to stderr by default. To start logging to a file, call
logging:tofile(). To start logging to a server, call logging:toserver().
You can call both.


LOGGING API

	log(severity, module, event, fmt, ...)
	loglive(e, [fmt, ...] | nil)
	logliveadd(e, fmt, ...)

	logarg(v) -> s
	logargs(...) -> ...

]]

require'glue'

local
	type, istab, rawget =
	type, istab, rawget

logging = {
	quiet = false,
	verbose = false,
	debug = false,
	flush = false, --too slow (but you can tail)
	censor = {},
	max_disk_size = 16 * 1024^2,
	queue_size = 1000,
	timeout = 5,
	vars = {profiler_started = false},
}

function logging:tofile(logfile, max_size, queue_size)

	require'fs'
	require'queue'

	local logfile0 = logfile:gsub('(%.[^%.]+)$', '0%1')
	if logfile0 == logfile then logfile0 = logfile..'0' end

	local f, size

	local function open_logfile()
		if f then return end
		f = open(logfile, 'a')
		size = f:attr'size'
	end

	max_size = max_size or self.max_disk_size

	local function rotate_logfile(len)
		if max_size and size + len > max_size / 2 then
			f:close()
			f = nil
			mv(logfile, logfile0)
			open_logfile()
		end
	end

	local function save_message(s)
		open_logfile()
		rotate_logfile(#s + 1)
		size = size + #s + 1
		f:write(s)
		return true
	end

	local function try_close_file()
		if not f then return end
		f:try_close()
		f, size = nil
	end

	local try_save_message = protect_io(save_message, try_close_file)

	local queue_size = queue_size or logging.queue_size
	local queue = queue(queue_size or 1/0)

	function self:logtofile(s)
		if not queue:push(s) then
			queue:pop()
			queue:push(s)
		end
	end

	resume(thread(function()
		while self.logtofile do
			local s = queue:peek()
			if s then
				if try_save_message(s) then
					queue:pop()
				else --wait for user to fix the fs issue.
					save_wait_job = wait_job()
					save_wait_job:wait(5)
					save_wait_job = nil
				end
			else
				if f and self.autoflush then
					f:flush()
				end
				save_wait_job = wait_job()
				save_wait_job:wait(.2)
				save_wait_job = nil
			end
		end
	end, 'logging-save'))

	function self:tofile_flush()
		if not self.logtofile then return end
		while 1 do
			local s = queue:pop()
			if not s then break end
			if not try_save_message(s) then break end
			if f and self.autoflush then
				f:flush()
			end
		end
	end

	function self:tofile_stop()
		if not self.logtofile then return end
		self.logtofile = nil
		self:tofile_flush()
		try_close_file()
		if save_wait_job then
			save_wait_job:resume()
		end
	end

	return self
end

logging.rpc = {}

function logging.rpc:set_debug   (v) self.debug   = v end
function logging.rpc:set_verbose (v) self.verbose = v end

local logvar_message --fw. decl.

function logging:toserver(host, port, queue_size, timeout)

	require'sock'
	require'queue'
	require'mess'

	timeout = timeout or logging.timeout

	local chan
	local reconn_wait_job
	local stop

	local function check_io(ret, ...)
		if ret then return ret, ... end
		if chan then chan:try_close() end
		chan = nil
	end

	local function connect()
		if chan then return chan end
		while not stop do

			local exp = clock() + timeout

			--wait _before_ reconnecting (instead of after) because ssh tunnels
			--accept connections even after the other end is no longer listening.
			--also because 'connection_refused' error comes instantly on Linux.
			if not stop and exp > clock() + 0.2 then
				reconn_wait_job = wait_job()
				reconn_wait_job:wait_until(exp)
				reconn_wait_job = nil
			end

			local tcp = tcp()

			chan = try_mess_connect(tcp, host, port, timeout)

			if chan then

				--send current var states.
				for k,v in pairs(self.vars) do
					if not check_io(chan:try_send(logvar_message(self, k, v))) then
						break
					end
				end

				--create RPC thread/loop
				self.liveadd(chan.tcp, 'logging')
				resume(thread(function()
					while not stop do
						local cmd_args = check_io(chan:try_recv())
						if not cmd_args then break end
						if istab(cmd_args) then
							local cmd = cmd_args[1]
							local f = self.rpc[cmd]
							if f then
								f(self, unpack(cmd_args, 2))
							else
								self.log('ERROR', 'log', 'rpc', 'unknown RPC call: %s', cmd)
							end
						end
					end
				end, 'logging-rpc %s', chan.tcp))

				return true
			end

		end
		return false
	end

	local queue_size = queue_size or logging.queue_size
	local queue = queue(queue_size or 1/0)
	local send_wait_job

	resume(thread(function()
		while not stop do
			local msg = queue:peek()
			if msg then
				if connect() and chan then
					if check_io(chan:try_send(msg)) then
						queue:pop()
					end
				end
			else
				send_wait_job = wait_job()
				send_wait_job:wait(.2)
				send_wait_job = nil
			end
		end
		self.logtoserver = nil
	end, 'logging-send'))

	function self:logtoserver(msg)
		if not queue:push(msg) then
			queue:pop()
			queue:push(msg)
		end
	end

	function self:toserver_stop()
		stop = true
		check_io()
		if send_wait_job then
			send_wait_job:resume()
		elseif reconn_wait_job then
			reconn_wait_job:resume()
		end
	end

	return self
end

function logging:toserver_stop() end

logging.filter = {}

local mode_k = {__mode = 'k'}

local names = setmetatable({}, mode_k) --{[obj]->name}

function logging.name(obj, name)
	names[obj] = name
end

do
	local main, is_main = coroutine.running()
	if is_main then
		logging.name(main, 'TM')
	end
end

local function debug_type(v)
	local mt = getmetatable(v)
	return istab(mt) and mt.type or type(v)
end

local prefixes = {
	thread = 'T',
	['function'] = 'f',
	cdata = 'c',
}

local function debug_prefix(v)
	local mt = getmetatable(v)
	local prefix = istab(mt) and mt.debug_prefix
	if prefix then return prefix end
	local type = debug_type(v)
	return prefixes[type] or type
end

local ids_db = {} --{type->{last_id=,live=,[obj]->id}}
local function debug_id(v)
	local ty = debug_type(v)
	local ids = ids_db[ty]
	if not ids then
		ids = setmetatable({
			live_count = 0,
			live = setmetatable({}, mode_k)
			-- ^^ this table is weak because threads can be abandoned
			-- in suspended state so live(nil) never gets called on them.
		}, mode_k)
		ids_db[ty] = ids
	end
	local id = ids[v]
	if not id then
		id = istab(v) and rawget(v, 'debug_id')
		if not id then
			id = (ids.last_id or 0) + 1
			ids.last_id = id
		end
		ids[v] = id
	end
	return debug_prefix(v)..id, ids
end

local pp_skip = {
	__index = 1,
	__newindex = 1,
	__mode = 1,
}
local function pp_filter(v, k, t)
	if type(v) == 'function' then return true, '#'..debug_id(v) end --TODO
	if getmetatable(t) == t and pp_skip[k] then return end --skip inherits.
	return true, v
end
local function pp_onerror(err, v)
	if err == 'cycle' then return '(cycle)' end
	if err == 'unserializable' then return '#'..type(v) end
end
local pp_opt = {
	filter = pp_filter,
	onerror = pp_onerror,
}
local pp_opt_compact = {
	filter = pp_filter,
	onerror = pp_onerror,
	indent = false,
}
local function logarg(v)
	if v == nil then return 'nil' end
	if type(v) == 'boolean' then return v and 'Y' or 'N' end
	if type(v) == 'number' then return v end
	local name = names[v]
	if name then return name end
	local mt = getmetatable(v)
	if istab(mt) and mt.__tostring then
		v = tostring(v)
	elseif istab(v) and not (mt and (mt.type or mt.debug_prefix)) then
		local s = pp(v, pp_opt)
		return #s < 50 and pp(v, pp_opt_compact) or s
	elseif type(v) ~= 'string' then
		return debug_id(v)
	end
	if v:find'[%z\1-\8\11\12\14-\31\127-\255]' then --binary, make it hexblock
		v = '\n\n'..hexblock(v)
	elseif v:find('\n', 1, true) then --multiline, make room for it.
		v = v:gsub('\r\n', '\n'):gsub('\n+$', '')
		v = outdent(v):gsub('\t', '   ')
		v = '\n\n'..v..'\n'
	end
	return v
end
logging.arg = logarg

function logging.args(...)
	local n = select('#', ...)
	if n == 1 then
		return logarg((...))
	end
	local args = {...}
	for i=1,n do
		args[i] = logarg(args[i])
	end
	return unpack(args, 1, n)
end

local function fmtargs(self, fmt, ...)
	return _(fmt, self.args(...))
end

local function log(self, severity, module, event, fmt, ...)
	if severity == '' and self.filter[module  ] then return end
	if severity == '' and self.filter[event   ] then return end
	local env = logging.env and logging.env:sub(1, 1):upper() or 'D'
	local time = time()
	local msg = fmt and fmtargs(self, fmt, ...) or ''
	if next(self.censor) then
		for _,censor in pairs(self.censor) do
			msg = censor(msg, self, severity, module, event)
		end
	end
	if msg:find('\n', 1, true) then --multiline
		local arg1_multiline = msg:find'^\n\n'
		msg = outdent(msg, '\t')
		if not arg1_multiline then
			msg = '\n\n'..msg..'\n'
		end
	end
	if (severity ~= '' or self.debug) and (severity ~= 'note' or self.verbose) then
		local entry = (self.logtofile or not self.quiet)
			and _('%s %s %-6s %-6s %-8s %-4s %s\n',
				env, date('%Y-%m-%d %H:%M:%S', time), severity,
				module or '', (event or ''):sub(1, 8),
				logarg((coroutine.running())), msg)
		if self.logtofile then
			self:logtofile(entry)
		end
		if self.logtoserver then
			self:logtoserver{
				deploy = self.deploy, env = logging.env, time = time,
				severity = severity, module = module, event = event,
				message = msg:gsub('^\n\n', ''),
			}
		end
		if not self.quiet then
			io.stderr:write(entry)
			io.stderr:flush()
		end
	end
end

--[[local]] function logvar_message(self, k, v)
	return {
		deploy = self.deploy, machine = self.machine,
		env = logging.env, time = time(),
		event = 'set', k = k, v = v,
	}
end

local function logvar(self, k, v)
	self.vars[k] = v
	if self.logtoserver then
		self:logtoserver(logvar_message(self, k, v))
	end
end

local function live(self, o, fmt, ...)
	local id, ids = debug_id(o)
	local s = fmt and fmtargs(self, fmt, ...)
	local was_live = ids.live[o] ~= nil
	local event = '~'
	if fmt ~= nil then
		if not was_live then
			ids.live_count = ids.live_count + 1
			event = '+'
		end
	elseif was_live then
		ids.live_count = ids.live_count - 1
		event = '-'
	end
	self.log('', 'log', event, '%-4s %s live=%d', o, s or ids.live[o], ids.live_count)
	ids.live[o] = s
end

local function liveadd(self, o, fmt, ...)
	local id, ids = debug_id(o)
	local s = assert(ids.live[o]) .. ' ' .. fmtargs(self, fmt, ...)
	self.log('', 'log', '~', '%-4s %s', o, s)
	ids.live[o] = s
end

local function init(self)
	self.log       = function(...) return log        (self, ...) end
	self.logvar    = function(...) return logvar     (self, ...) end
	self.live      = function(...) return live       (self, ...) end
	self.liveadd   = function(...) return liveadd    (self, ...) end
	return self
end

function logging.livelist()
	local t = {cols = 3, o_type = 0, o_id = 1, o_descr = 2}
	for type, ids in pairs(ids_db) do
		for o, s in pairs(ids.live) do
			t[#t+1] = type
			t[#t+1] = logarg(o)
			t[#t+1] = s
		end
	end
	return t
end

function logging.rpc:poll_livelist()
	self.logvar('livelist', self.livelist())
end

function logging.rpc:get_procinfo()
	local proc = require'proc'
	local t  = proc_info()
	local pt = os_info()
	local ft = fs_info'/'
	local clock = clock()
	local lua_heap = collectgarbage'count' * 1024
	self.logvar('procinfo', {
		clock    = clock,
		utime    = t and t.utime,
		stime    = t and t.stime,
		rss      = t and t.rss,
		vsize    = t and t.vsize,
		state    = t and t.state,
		num_threads = t and t.num_threads,
		uptime   = pt and pt.uptime,
		cputimes = pt and pt.cputimes,
		ram_size = pt and pt.ram_size,
		ram_free = pt and pt.ram_free,
		hdd_size = ft and ft.size,
		hdd_free = ft and ft.free,
		lua_heap = lua_heap,
	})
end

function logging.rpc:get_osinfo()
	local pt = proc.osinfo()
	local ft = fs_info'/'
	self.logvar('osinfo', {
		clock    = clock(),
		uptime   = pt and pt.uptime,
		cputimes = pt and pt.cputimes,
		ram_size = pt and pt.ram_size,
		ram_free = pt and pt.ram_free,
		hdd_size = ft and ft.size,
		hdd_free = ft and ft.free,
	})
end

function logging.printlive(custom_print)
	local print = custom_print or print
	local types = {}
	for ty in pairs(ids_db) do
		types[#types+1] = ty
	end
	table.sort(types)
	for _,ty in ipairs(types) do
		local ids = ids_db[ty]
		local live = ids.live
		print(('%-12s: %d'):format(ty, ids.live_count))
		local ids, ss = {}, {}
		for o in pairs(live) do
			local id = logarg(o)
			ids[#ids+1] = id
			ss[id] = live[o]
		end
		table.sort(ids)
		for _,id in ipairs(ids) do
			print(('  %-4s: %s'):format(id, ss[id]))
		end
	end
end

local profiler_lines

function logging.start_profiler(mode)
	if profiler_lines then return end
	local p = require'jit.p'
	local io_open = io.open
	profiler_lines = {}
	function io.open()
		local f = {close = noop}
		function f:write(s)
			add(profiler_lines, s)
		end
		return f
	end
	p.start(mode, true)
	io.open = io_open
	logging.log('note', 'log', 'prof_start', 'profiler started %s', mode or '')
	logging.logvar('profiler_started', true)
	logging.logvar('profiler_output', 'Recording...')
end

function logging.stop_profiler()
	if not profiler_lines then return end
	local p = require'jit.p'
	p.stop()
	logging.log('note', 'log', 'prof_stop', 'profiler stopped')
	logging.logvar('profiler_started', false)
	logging.logvar('profiler_output', cat(profiler_lines))
	profiler_lines = nil
end

function logging.rpc:start_profiler(mode)
	logging.start_profiler(mode)
end

function logging.rpc:stop_profiler()
	logging.stop_profiler()
end

init(logging)

logging.__index = logging

function logging.new()
	return init(setmetatable({}, logging))
end

_G.log          = logging.log
_G.live         = logging.live
_G.liveadd      = logging.liveadd
_G.logarg       = logging.arg
_G.logargs      = logging.args


if not ... then

	require'sock'

	local log = _G.log

	resume(thread(function()
		wait(5)
		logging:toserver_stop()
		print'told to stop'
	end, 'test'))

	run(function()

		logging.debug = true

		logging:tofile('test.log', 64000)
		logging:toserver('127.0.0.1', 1234, 998, 1)

		for i=1,1000 do
			log('note', 'test-m', 'test-ev', 'foo %d bar', i)
		end

		local s1 = tcp()
		local s2 = tcp()
		local t1 = thread(function() end, 't1')
		local t2 = thread(function() end, 't2')

		log('', 'test-m', 'test-ev', '%s %s %s %s\nanother thing', s1, s2, t1, t2)

	end)

end
