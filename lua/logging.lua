--[[

	File and TCP logging with capped disk & memory usage.
	Written by Cosmin Apreutesei. Public domain.

LOGGING
	logging.log(severity, module, event, fmt, ...)
	logging.logvar(k, v)
	logging.live(e, fmt, ...)
	logging.live(e, nil, [fmt, ...])
UTILS
	logging.arg(v) -> s
	logging.printlive() -> s
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
	logging.queue_size        queue size for when the server is slow (1000)
	logging.timeout           timeout (2)
	logging.filter.NAME = true    filter out debug messages of specific module/event
	logging.censor.name <- f(severity, module, ev, msg)  |set a function for censoring secrets in logs
	logging:logtostderr(line)
INIT
	logging:tofile(logfile, max_disk_size)
	logging:toserver(host, port, queue_size, timeout)

Logging is done to stderr by default. To start logging to a file, call
logging:tofile(). To start logging to a server, call logging:toserver().
You can call both.


LOGGING API

	log(severity, module, event, fmt, ...)
	live(e[, nil][, fmt, ...])   track/untrack an object for logging purposes
	liveadd(e, fmt, ...)         update the tracking label on a live object

	logarg(v) -> s               format a value for logging
	logargs(...) -> ...          format multiple values for logging

]]

if not ... then require'logging_test'; return end

require'glue'
local reflect = require'reflect'

local
	type, istab, rawget =
	type, istab, rawget

logging = {
	quiet = false,
	verbose = false,
	debug = false,
	flush = false, --too slow (but you can tail)
	autosync = false,
	censor = {},
	max_disk_size = 16 * 1024^2,
	queue_size = 1000,
	timeout = 2,
	vars = {
		profiler_started = false,
		jit_on = jit.status(),
	},
}

function logging:logtostderr(entry)
	io.stderr:write(entry:sub(17))
	if self.flush then io.stderr:flush() end
end

function logging:tofile(logfile, max_size, queue_size)

	require'fs'
	require'queue'

	local logfile0 = logfile:gsub('(%.[^%.]+)$', '0%1')
	if logfile0 == logfile then logfile0 = logfile..'0' end

	local save_wait_job
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
			rename(logfile, logfile0)
			open_logfile()
		end
	end

	local function save_message(s)
		open_logfile()
		rotate_logfile(#s)
		size = size + #s
		f:write(s)
		if self.autosync then f:sync() end
		return true
	end

	local function try_close_file()
		if not f then return end
		f:try_close()
		f, size = nil
	end

	local function try_save_message(s)
		local ok, err = catch('fs', save_message, s)
		if not ok then try_close_file() end
		return ok
	end

	local queue_size = queue_size or logging.queue_size
	local queue = queue(queue_size or 1/0)

	function self:logtofile(s)
		if not queue:push(s) then
			queue:pull()
			queue:push(s)
		end
	end

	resume(thread(function()
		while self.logtofile do
			local s = queue:peek()
			if s then
				if try_save_message(s) then
					queue:pull()
				else --wait for user to fix the fs issue.
					save_wait_job = wait_job()
					save_wait_job:wait(5)
					save_wait_job = nil
				end
			else
				save_wait_job = wait_job()
				save_wait_job:wait(.2)
				save_wait_job = nil
			end
		end
	end, 'logging-save'))

	function self:tofile_flush()
		if not self.logtofile then return end
		while 1 do
			local s = queue:peek()
			if not s then break end
			if not try_save_message(s) then break end
			queue:pull()
		end
	end

	function self:tofile_stop()
		if not self.logtofile then return end
		self:tofile_flush()
		self.logtofile = nil
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
	require'pbuffer'

	timeout = timeout or logging.timeout
	local queue_size = queue_size or logging.queue_size
	local sendq = wait_queue(queue_size or 1/0)
	local pending_msg

	local toserver_thread = thread(function()
		while 1 do
			catch_with_owner('net protocol closed', function()

				local tcp = connect(host, port, timeout)
				local wb = pbuffer{f = tcp}
				local rb = pbuffer{f = tcp}
				self.liveadd(tcp, 'logging')

				local ts = threadset()
				--recv RPCs
				resume(ts:thread(function()
					while 1 do
						local cmd_args = rb:get_value()
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
				end, 'logging-rpc'))

				resume(ts:thread(function()
					--send current var states.
					for k,v in pairs(self.vars) do
						wb:put_value(logvar_message(self, k, v)):flush()
					end

					--send log messages as they come.
					while 1 do
						local msg = pending_msg or sendq:pull()
						wb:put_value(msg)
						pending_msg = msg --if flush fails, we'll retry this
						wb:flush()
						pending_msg = nil
					end
				end, 'logging-send'))

				assert(ts:wait())
			end)
			--wait for network/peer to come back before attempting to reconnect
			--because connect can fail without delay and we don't want to busy-loop.
			wait(timeout)
		end
	end, 'logging-toserver')
	resume(toserver_thread)

	function self:logtoserver(msg)
		if not sendq:try_push(msg) then
			sendq:try_pull() --drop one to make room
			sendq:try_push(msg)
		end
	end

	function self:toserver_stop()
		toserver_thread:cancel()
		self.logtoserver = nil
	end

	return self
end

function logging:toserver_stop() end

function logging:listen(host, port)

	require'sock'
	require'pbuffer'

	self.clients = {}

	local listen_tcp = listen(host, port)

	local function handle_connection(ctcp)
		local rb = pbuffer{f = ctcp}
		local wb = pbuffer{f = ctcp}
		local sendq = wait_queue(1)
		local client = {tcp = ctcp, sendq = sendq, vars = {}}
		add(self.clients, client)
		currentthread():onfinish(function()
			remove_value(self.clients, client)
		end)
		local ts = threadset()
		--send thread
		resume(ts:thread(function()
			while 1 do
				wb:put_value(sendq:pull()):flush()
			end
		end, 'logging-srv-send'))
		--recv loop
		resume(ts:thread(function()
			while 1 do
				local msg = rb:get_value()
				if istab(msg) then
					if msg.deploy  then client.deploy  = msg.deploy  end
					if msg.machine then client.machine = msg.machine end
					if msg.env     then client.env     = msg.env     end
					if msg.event == 'set' then
						client.vars[msg.k] = msg.v
						self.onvar(self, client, msg)
					else
						self.onlog(self, client, msg)
					end
				end
			end
		end, 'logging-srv-recv'))
		--wait until any one of the I/O threads finishes. this is needed because
		--if one thread breaks on timeout, the other one doesn't and we'd be stuck
		--with a half-broken connection.
		assert(ts:wait())
	end
	local accept_thread = thread(function()
		while 1 do
			local ctcp, err = listen_tcp:try_accept()
			if not ctcp then
				self.log('ERROR', 'log', 'accept', '%s', err)
			else
				resume(thread(function()
					ctcp:setowner(currentowner())
					--the catch is only to mute these error types.
					catch('net protocol closed', handle_connection, ctcp)
				end, 'logging-srv-session %s', ctcp))
			end
		end
	end, 'logging-srv-listen %s', listen_tcp)
	resume(accept_thread)

	function self:listen_stop()
		accept_thread:cancel()
		assert(#self.clients == 0)
	end

	function self:rpc_call(client, cmd, ...)
		return client.sendq:try_push{cmd, ...}
	end

	function self:rpc_broadcast(cmd, ...)
		for _,c in ipairs(self.clients) do
			self:rpc_call(c, cmd, ...)
		end
	end

	return self
end

function logging:listen_stop() end

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

local function getmetatable_ex(v)
	if type(v) == 'cdata' then
		return reflect.getmetatable(v)
	end
	return getmetatable(v)
end

local function debug_type(v)
	local mt = getmetatable_ex(v)
	return istab(mt) and mt.type or type(v)
end

local prefixes = {
	thread = 't', --wrapped thread is T
	['function'] = 'f',
	cdata = 'c',
}

local function debug_prefix(v)
	local mt = getmetatable_ex(v)
	local prefix = istab(mt) and mt.debug_prefix
	if prefix then return prefix end
	local type = debug_type(v)
	return prefixes[type] or type
end

local ids_db = {} --{type->{last_id=,live=,[obj]->id}}
local function debug_id(v)
	local P = debug_prefix(v)
	local ids = ids_db[P]
	if not ids then
		ids = setmetatable({
			live = setmetatable({}, mode_k)
			-- ^^ this table is weak because threads can be abandoned
			-- in suspended state so live(nil) never gets called on them.
		}, mode_k)
		ids_db[P] = ids
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
	return P..id, ids
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
	local mt = getmetatable_ex(v)
	if istab(mt) and mt.__tostring then
		v = tostring(v)
	elseif istab(v) and not (mt and (mt.type or mt.debug_prefix)) then
		local s = pp(v, pp_opt)
		return #s < 50 and pp(v, pp_opt_compact) or s
	elseif type(v) ~= 'string' then
		if type(v) == 'cdata' and (isctype(i64, v) or isctype(u64, v)) then
			return tostring(v)
		end
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

local severity_symbol = {
	note  = '!',
	warn  = 'W',
	ERROR = 'E',
}

function logging:onlog(client, e) --stub
	local prefix = client.deploy or '?'
	io.stderr:write(_('%s %s %-1s %-6s %-8s %s\n',
		prefix, date('%Y-%m-%d %H:%M:%S', e.time),
		severity_symbol[e.severity] or e.severity or '',
		e.module or '', (e.event or ''):sub(1, 8),
		e.message or ''))
	if self.flush then io.stderr:flush() end
end

function logging:onvar(client, e) end --stub

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
		msg = outdent(msg, '  ')
		if not arg1_multiline then
			msg = '\n\n'..msg..'\n'
		end
		--shorten stacktrace paths to paths relative to project_dir.
		local project_dir = config'project_dir'
		if project_dir then
			msg = msg:gsub('([^%s<]*%.lua):', function(path)
				path = relpath(path, project_dir) or path
				path = path_normalize(path, true) --no symlinks in code
				return path .. ':'
			end)
		end
	end
	if (severity ~= '' or self.debug) and (severity ~= 'note' or self.verbose) then
		local entry = (self.logtofile or not self.quiet)
			and _('%s %s %-1s %-6s %-8s %-4s %s\n',
				env, date('%Y-%m-%d %H:%M:%S', time),
				severity_symbol[severity] or severity,
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
			self:logtostderr(entry)
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
	local live_s = ids.live[o]
	local was_live = live_s ~= nil
	local event = '~'
	local s
	if fmt ~= nil then
		s = fmtargs(self, fmt, ...)
		if not was_live then
			ids.live_count = (ids.live_count or 0) + 1
			event = '+ ' .. ids.live_count
		end
	elseif was_live then
		ids.live_count = ids.live_count - 1
		event = '- ' .. ids.live_count
		live_s = ... and fmtargs(self, ...) or ''
	end
	self.log('', 'log', event, '%-4s %s', o, s or live_s)
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

function logging.rpc:get_livelist()
	self.logvar('livelist', self.livelist())
end

function logging.rpc:get_procinfo()
	local proc = require'proc'
	local t  = proc_info()
	local pt = os_info()
	local ft = fs_info'/'
	local clock = clock()
	local counts = debug.counts or noop
	local
		lua_heap, lua_freed, lua_allocated,
		strings, tables, functions, threads, udata, cdata,
		traces, snap_restores, aborted_traces, mcode_size = counts()
	self.logvar('procinfo', {
		clock    = clock,
		--process
		utime      = t and t.utime,
		stime      = t and t.stime,
		rss        = t and t.rss,
		vsize      = t and t.vsize,
		state      = t and t.state,
		os_threads = t and t.num_threads,
		--OS
		uptime   = pt and pt.uptime,
		cputimes = pt and pt.cputimes,
		ram_size = pt and pt.ram_size,
		ram_free = pt and pt.ram_free,
		hdd_size = ft and ft.size,
		hdd_free = ft and ft.free,
		--debug.counts()
		lua_heap       = lua_heap       ,
		lua_freed      = lua_freed      ,
		lua_allocated  = lua_allocated  ,
		strings        = strings        ,
		tables         = tables         ,
		functions      = functions      ,
		threads        = threads        ,
		udata          = udata          ,
		cdata          = cdata          ,
		traces         = traces         ,
		snap_restores  = snap_restores  ,
		aborted_traces = aborted_traces ,
		mcode_size     = mcode_size     ,
	})
end

function logging.rpc:reset_counts()
	if debug.reset_counts then
		debug.reset_counts()
	end
end

function logging.rpc:get_env()
	self.logvar('env', env())
end

local function out_stderr(s)
	io.stderr:write(s)
	io.stderr:flush()
end
function logging.printlive(out)
	local out = out or out_stderr
	local types = {}
	for ty in pairs(ids_db) do
		types[#types+1] = ty
	end
	table.sort(types)
	for _,ty in ipairs(types) do
		local ids = ids_db[ty]
		local live = ids.live
		if ids.live_count then
			out(('%-12s: %d\n'):format(ty, ids.live_count))
		end
		local ids, ss = {}, {}
		for o in pairs(live) do
			local id = logarg(o)
			ids[#ids+1] = id
			ss[id] = live[o]
		end
		table.sort(ids)
		for _,id in ipairs(ids) do
			out(('  %-4s: %s\n'):format(id, ss[id]))
		end
	end
end

local profiler_lines

function logging.start_profiler(mode)
	if profiler_lines then return end
	local p = require'jit.p'
	local lines = {}
	local out = {close = noop}
	function out:write(s)
		add(lines, s)
	end
	p.start(mode, out)
	profiler_lines = lines
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

function logging.rpc:collectgarbage()
	local m0 = collectgarbage'count'
	collectgarbage()
	local m1 = collectgarbage'count'
	logging.log('note', 'gc', 'collect', 'collected: %s', kbytes((m0 - m1) * 1024))
end

function logging.rpc:jit_onoff(on)
	if on then jit.on() else jit.off() end
	local on = jit.status()
	logging.log('note', 'jit', on and 'on' or 'off')
	logging.logvar('jit_on', on)
end

function logging.rpc:eval(s)
	logging.logvar('eval_result', {pcall(eval, s)})
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
