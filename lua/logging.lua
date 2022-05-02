--[[

	File and TCP logging with capped disk & memory usage.
	Written by Cosmin Apreutesei. Public domain.

LOGGING
	logging.log(severity, module, event, fmt, ...)
	logging.note(module, event, fmt, ...)
	logging.dbg(module, event, fmt, ...)
	logging.warnif(module, event, condition, fmt, ...)
	logging.logerror(module, event, fmt, ...)
	logging.logvar(k, v)
	logging.live(e, [fmt, ...] | nil)
UTILS
	logging.arg(v) -> s
	logging.printarg(v) -> s
	logging.args(...) -> ...
	logging.printargs(...) -> ...
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
	logging.filter.NAME = true    filter out messages of specific severity/module/event
	logging.censor.name <- f(severity, module, ev, msg)  |set a function for censoring secrets in logs
INIT
	logging:tofile(logfile, max_disk_size)
	logging:toserver(host, port, queue_size, timeout)

Logging is done to stderr by default. To start logging to a file, call
logging:tofile(). To start logging to a server, call logging:toserver().
You can call both.

]]

local ffi = require'ffi'
local time = require'time'
local pp = require'pp'
local glue = require'glue'

local clock = time.clock
local time = time.time
local _ = string.format

local logging = {
	quiet = false,
	verbose = false,
	debug = false,
	flush = false, --too slow (but you can tail)
	censor = {},
	max_disk_size = 16 * 1024^2,
	queue_size = 10000,
	timeout = 5,
}

function logging:tofile(logfile, max_size)

	local fs = require'fs'

	local logfile0 = logfile:gsub('(%.[^%.]+)$', '0%1')
	if logfile0 == logfile then logfile0 = logfile..'0' end

	local f, size

	local function log_locally(...)
		self.logto(false, false, ...)
	end

	local function open()
		if f then return true end
		f = fs.open(logfile, {mode = 'a', log = log_locally})
		if not f then return end
		size = f:attr'size'
		if not f then return end
		return true
	end

	max_size = max_size or self.max_disk_size

	local function rotate(len)
		if max_size and size + len > max_size / 2 then
			f:close(); f = nil
			if not fs.move(logfile, logfile0) then return end
			if not open() then return end
		end
		return true
	end

	function self:logtofile(s)
		if not open() then return end
		if not rotate(#s + 1) then return end
		size = size + #s + 1
		if not f:write(s) then return end
		if self.flush then f:flush() end
	end

	function self:tofile_stop()
		if not f then return end
		f:close()
		f = nil
	end

	return self
end

logging.rpc = {}

function logging.rpc:set_debug   (v) self.debug   = v end
function logging.rpc:set_verbose (v) self.verbose = v end

local logvar_message --fw. decl.

function logging:toserver(host, port, queue_size, timeout)

	local sock = require'sock'
	local queue = require'queue'
	local mess = require'mess'

	queue_size = queue_size or logging.queue_size
	timeout = timeout or logging.timeout

	local chan
	local reconn_sleeper
	local stop

	local function check_io(ret, ...)
		if ret then return ret, ... end
		if chan then chan:close() end
		chan = nil
	end

	local function connect()
		if chan then return chan end
		while not stop do
			local exp = timeout and clock() + timeout
			local function log_locally(...)
				self.logto(false, false, ...)
			end
			chan = mess.connect(host, port, exp, {log = log_locally})

			if chan then

				--send a first message so the server knows who we are.
				if not check_io(chan:send(logvar_message(self, 'hello'))) then
					break
				end

				--create RPC thread/loop
				self.liveadd(chan.tcp, 'logging')
				sock.resume(sock.thread(function()
					while not stop do
						local ok, cmd_args = check_io(chan:recv())
						if not ok then break end
						if type(cmd_args) == 'table' then
							local f = self.rpc[cmd_args[1]]
							if f then f(self, glue.unpack(cmd_args, 2)) end
						end
					end
				end, 'logging-rpc %s', chan.tcp))

				return true
			end

			--wait because 'connection_refused' error comes instantly on Linux.
			if not stop and exp > clock() + 0.2 then
				reconn_sleeper = sock.sleep_job()
				reconn_sleeper:sleep_until(exp)
				reconn_sleeper = nil
			end
		end
		return false
	end

	local queue = queue.new(queue_size or 1/0)
	local send_thread_suspended = true

	local send_thread = sock.thread(function()
		send_thread_suspended = false
		while not stop do
			local msg = queue:peek()
			if msg then
				if connect() and chan then
					if check_io(chan:send(msg)) then
						queue:pop()
					end
				end
			else
				send_thread_suspended = true
				sock.suspend()
				send_thread_suspended = false
			end
		end
		self.logtoserver = nil
	end, 'logging-send')

	function self:logtoserver(msg)
		if not queue:push(msg) then
			queue:pop()
			queue:push(msg)
		end
		if send_thread_suspended then
			sock.resume(send_thread)
		end
	end

	function self:toserver_stop()
		stop = true
		check_io()
		if send_thread_suspended then
			sock.resume(send_thread)
		elseif reconn_sleeper then
			reconn_sleeper:wakeup()
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
	return type(mt) == 'table' and mt.type or type(v)
end

local prefixes = {
	thread = 'T',
	['function'] = 'f',
	cdata = 'c',
}

local function debug_prefix(v)
	local mt = getmetatable(v)
	local prefix = type(mt) == 'table' and mt.debug_prefix
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
			live = {} --setmetatable({}, mode_k)
			-- ^^ TODO: put this back after making sure all objects are freed
			-- explicitly and not left dangling (mostly to ensure that thread
			-- finish events get triggered).
		}, mode_k)
		ids_db[ty] = ids
	end
	local id = ids[v]
	if not id then
		id = type(v) == 'table' and rawget(v, 'debug_id')
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
local function pp_compact(v)
	local s = pp.format(v, pp_opt)
	return #s < 50 and pp.format(v, pp_opt_compact) or s
end

local function debug_arg(v)
	if v == nil then return 'nil' end
	if type(v) == 'boolean' then return v and 'Y' or 'N' end
	if type(v) == 'number' then return _('%.17g', v) end
	if type(v) == 'string' then return v end
	local name = names[v]
	if name then return name end
	local mt = getmetatable(v)
	if mt and type(mt) == 'table' then
		if mt.__tostring then return tostring(v) end
	end
	if type(v) == 'table' and not (mt and (mt.type or mt.debug_prefix)) then
		return pp_compact(v)
	end
	return (debug_id(v))
end
local function debug_arg_pp(v)
	local v = debug_arg(v)
	if v:find('\n', 1, true) then --multiline, make room for it.
		v = v:gsub('\r\n', '\n')
		v = glue.outdent(v)
		v = v:gsub('\t', '   ')
		v = '\n\n'..v..'\n'
	end
	--avoid messing up the terminal when tailing logs.
	v = v:gsub('[%z\1-\8\11-\31\128-\255]', '.')
	return v
end
logging.arg       = debug_arg_pp
logging.printarg  = debug_arg

local function logging_args_func(debug_arg)
	return function(...)
		if select('#', ...) == 1 then
			return debug_arg((...))
		end
		local args, n = {...}, select('#',...)
		for i=1,n do
			args[i] = debug_arg(args[i])
		end
		return unpack(args, 1, n)
	end
end
logging.args      = logging_args_func(debug_arg_pp)
logging.printargs = logging_args_func(debug_arg)

local function logto(self, tofile, toserver, severity, module, event, fmt, ...)
	if self.filter[severity] then return end
	if self.filter[module  ] then return end
	if self.filter[event   ] then return end
	local env = logging.env and logging.env:sub(1, 1):upper() or 'D'
	local time = time()
	local msg = fmt and _(fmt, self.args(...))
	if next(self.censor) then
		for _,censor in pairs(self.censor) do
			msg = censor(msg, self, severity, module, event)
		end
	end
	if msg and msg:find('\n', 1, true) then --multiline
		local arg1_multiline = msg:find'^\n\n'
		msg = glue.outdent(msg, '\t')
		if not arg1_multiline then
			msg = '\n\n'..msg..'\n'
		end
	end
	if (severity ~= '' or self.debug) and (severity ~= 'note' or self.verbose) then
		local entry = (self.logtofile or not self.quiet)
			and _('%s %s %-6s %-6s %-8s %-4s %s\n',
				env, os.date('%Y-%m-%d %H:%M:%S', time), severity,
				module or '', (event or ''):sub(1, 8),
				debug_arg_pp((coroutine.running())), msg or '')
		if tofile and self.logtofile then
			self:logtofile(entry)
		end
		if toserver and self.logtoserver then
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
local function log      (self, ...) logto(self, true, true, ...) end
local function note     (self, ...) log(self, 'note', ...) end
local function dbg      (self, ...) log(self, '', ...) end
local function logerror (self, ...) log(self, 'ERROR', ...) end

local function warnif(self, module, event, cond, ...)
	if not cond then return end
	log(self, 'WARN', module, event, ...)
end

--[[local]] function logvar_message(self, k, v)
	return {
		deploy = self.deploy, machine = self.machine,
		env = logging.env, time = time(),
		event = 'set', k = k, v = v,
	}
end

local function logvar(self, k, v)
	if self.logtoserver then
		self:logtoserver(logvar_message(self, k, v))
	end
end

local function live(self, o, fmt, ...)
	local id, ids = debug_id(o)
	local was_live = ids.live[o] ~= nil
	if fmt ~= nil then
		if not was_live then
			ids.live_count = ids.live_count + 1
		end
	elseif was_live then
		ids.live_count = ids.live_count - 1
	end
	ids.live[o] = fmt and _(fmt, self.args(...)) or nil
end

local function liveadd(self, o, fmt, ...)
	local id, ids = debug_id(o)
	ids.live[o] = assert(ids.live[o]) .. ' ' .. _(fmt, self.args(...))
end

local function init(self)
	self.logto    = function(...) return logto    (self, ...) end
	self.log      = function(...) return log      (self, ...) end
	self.note     = function(...) return note     (self, ...) end
	self.dbg      = function(...) return dbg      (self, ...) end
	self.warnif   = function(...) return warnif   (self, ...) end
	self.logerror = function(...) return logerror (self, ...) end
	self.logvar   = function(...) return logvar   (self, ...) end
	self.live     = function(...) return live     (self, ...) end
	self.liveadd  = function(...) return liveadd  (self, ...) end
	return self
end

function logging.livelist()
	collectgarbage()
	local t = {cols = 3, o_type = 0, o_id = 1, o_descr = 2}
	for type, ids in pairs(ids_db) do
		for o, s in pairs(ids.live) do
			t[#t+1] = type
			t[#t+1] = debug_arg(o)
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
	local t = proc.info()
	local pt = proc.osinfo()
	local ft = fs.info'/'
	self.logvar('procinfo', {
		clock    = clock(),
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
	})
end

function logging.rpc:get_osinfo()
	local pt = proc.osinfo()
	local ft = fs.info'/'
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
	collectgarbage()
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
			local id = debug_arg(o)
			ids[#ids+1] = id
			ss[id] = live[o]
		end
		table.sort(ids)
		for _,id in ipairs(ids) do
			print(('  %-4s: %s'):format(id, ss[id]))
		end
	end
end

init(logging)

logging.__index = logging

function logging.new()
	return init(setmetatable({}, logging))
end

if not ... then

	local sock = require'sock'

	local logging = logging.new()

	sock.resume(sock.thread(function()
		sock.sleep(5)
		logging:toserver_stop()
		print'told to stop'
	end))

	sock.run(function()

		logging.debug = true

		logging:tofile('test.log', 64000)
		logging:toserver('127.0.0.1', 1234, 998, .5)

		for i=1,1000 do
			logging.note('test-m', 'test-ev', 'foo %d bar', i)
		end

		local sock = require'sock'
		local fs = require'fs'

		local s1 = sock.tcp()
		local s2 = sock.tcp()
		local t1 = coroutine.create(function() end)
		local t2 = coroutine.create(function() end)

		logging.dbg('test-m', 'test-ev', '%s %s %s %s\nanother thing', s1, s2, t1, t2)

	end)

end

return logging
