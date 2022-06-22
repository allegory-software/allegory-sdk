--go@ plink d10 -t -batch sdk/bin/linux/luajit sdk/lua/mess.lua
--[[

	Simple TCP protocol for sending and receiving Lua values.
	Written by Cosmin Apreutesei. Public Domain.

	Features:
		- fast binary de/serialization of Lua objects
		- full-duplex
		- raising & catching errors in event handlers

SERVER
	mess_listen(host, port, onaccept, [onerror], [server_name]) -> server
	onaccept(server, channel)
	onerror(server, error)

	server:stop()

CLIENT
	[try_]mess_connect(host, port, [timeout], [opt]) -> channel
		opt.debug

CHANNEL
	channel:send(msg, [expires]) -> ok | false,err
	channel:recv([expires]) -> ok,msg | nil,err

	channel:recvall(onmessage, [onerror])
	onmessage(channel, msg)
	onerror(channel, err)

	channel:close()
	channel:closed()
	channel:onclose(fn)

PROTOCOL
	mess_protocol(tcp) -> channel

]]

require'glue'
require'sock'

local
	cast, u32p =
	cast, u32p

local channel = {maxlen = 16 * 1024^2}

function mess_protocol(tcp)

	local chan = update({tcp = tcp}, channel)

	local buf = string_buffer()
	function chan:send(msg, exp)
		buf:reset()
		buf:reserve(4)
		buf:commit(4)
		buf:encode(msg)
		local p, len = buf:ref()
		cast(u32p, p)[0] = len - 4
		tcp:send(p, len, exp)
		return true
	end
	chan.try_send = protect_io(chan.send)

	local buf = string_buffer()
	function chan:recv()
		buf:reset()
		local plen = buf:reserve(4)
		tcp:recvn(plen, 4)
		local len = cast(u32p, plen)[0]
		tcp:checkp(len <= self.maxlen, 'message too big: %d', len)
		local p = buf:reset():reserve(len)
		tcp:recvn(p, len)
		buf:commit(len)
		local t = buf:decode()
		return t
	end
	chan.try_recv = protect_io(chan.recv)

	return chan
end

local function wrapfn(event, fn, onerror, self)
	return function(...)
		local ok, err = pcall(fn, ...)
		if not ok then
			if onerror then
				onerror(self, err)
			end
			log('ERROR', 'mess', event, '%s', err)
		end
	end
end

function mess_listen(host, port, onaccept, onerror, server_name)

	server_name = server_name or 'mess'

	local tcp = tcp()

	local server = {tcp = tcp}

	tcp:setopt('reuseaddr', true)
	tcp:listen(host, port)

	liveadd(tcp, server_name)

	local stop
	function server:stop()
		stop = true
		tcp:shutdown'r'
		tcp:close()
	end

	local onaccept = wrapfn('accept', onaccept, onerror, server)
	resume(thread(function()
		while not stop do
			local ctcp, err, retry = tcp:try_accept()
			if not ctcp then
				if tcp:closed() then --stop() called.
					break
				end
				tcp:check_io(retry, err)
				--temporary network error. retry without killing the CPU.
				wait(0.2)
				goto skip
			end
			liveadd(ctcp, server_name)
			resume(thread(function()
				local chan = mess_protocol(ctcp)
				onaccept(server, chan)
				ctcp:close()
			end, server_name..'-accepted %s', ctcp))
			::skip::
		end
	end, server_name..'-listen %s', tcp))

	return server
end

function mess_connect(host, port, timeout, opt)
	local tcp = tcp()
	if opt and opt.debug then
		tcp:debug'mess'
	end
	tcp:settimeout(timeout)
	tcp:connect(host, port)
	tcp:settimeout(nil)
	return mess_protocol(tcp)
end
try_mess_connect = protect_io(mess_connect)

function channel:try_close   ()        return self.tcp:try_close() end
function channel:close       ()        return self.tcp:close() end
function channel:onclose     (fn)      return self.tcp:onclose(fn) end
function channel:closed      ()        return self.tcp:closed() end
function channel:wait_job    ()        return self.tcp:wait_job() end
function channel:wait_until  (expires) return self.tcp:wait_until(expires) end
function channel:wait        (timeout) return self.tcp:wait(timeout) end

function channel:recvall(onmessage, onerror)
	local onmessage = wrapfn('recvall', onmessage, onerror, self)
	while not self:closed() do
		local msg, err = self:try_recv()
		if not msg and err then
			if iserror(err, 'io') and err.message == 'eof' then
				break
			else
				log('ERROR', 'mess', 'recv', '%s', err)
			end
		else
			onmessage(self, msg)
		end
	end
end

if not ... then

	logging.verbose = true
	logging.debug = true

	resume(thread(function()

		local server = mess_listen('127.0.0.1', '5555', function(self, chan)
			chan:recvall(function(self, msg)
				self:send(msg)
			end)
			chan:close()
			self:stop()
		end)

	end, 'server'))

	resume(thread(function()

		local chan = mess_connect('127.0.0.1', '5555', {timeout = 1})
		for i = 1, 20 do
			chan:send{a = i, b = 2*i, s = tostring(i)}
			local t = chan:recv()
			pr(t)
		end
		chan:close()

	end, 'client'))

	start()

end

return M
