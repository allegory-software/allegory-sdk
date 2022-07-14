--go@ plink d10 -t -batch sdk/bin/linux/luajit sdk/lua/mess.lua
--[[

	Simple TCP protocol for sending and receiving Lua values.
	Written by Cosmin Apreutesei. Public Domain.

	Features:
		- fast binary de/serialization of Lua objects
		- full-duplex
		- raising & catching errors in event handlers

SERVER
	mess_listen([tcp, ]host, port, onaccept, [onerror], [server_name]) -> server
	onaccept(server, channel)
	onerror(server, error)

	server:stop()

CLIENT
	[try_]mess_connect([tcp, ]host, port, [timeout]) -> channel

CHANNEL
	channel:[try_]send(msg, [expires]) -> ok | false,err
	channel:[try_]recv([expires]) -> ok,msg | nil,err

	channel:recvall(onmessage, [onerror])
	onmessage(channel, msg)
	onerror(channel, err)

	channel:[try_]close()
	channel:closed()
	channel:onclose(fn)

	channel:wait_job()
	channel:wait_until(expires)
	channel:wait(timeout)

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

function mess_listen(s, host, port, onaccept, onerror, server_name)

	if not issocket(s) then
		return mess_listen(tcp(), s, host, port, onaccept, onerror)
	end

	server_name = server_name or 'mess'

	local server = {tcp = s}

	s:setopt('reuseaddr', true)
	s:listen(host, port)

	liveadd(s, server_name)

	local stop
	function server:stop()
		stop = true
		s:shutdown'r'
		s:close()
	end

	local onaccept = wrapfn('accept', onaccept, onerror, server)
	resume(thread(function()
		while not stop do
			local ctcp, err, retry = s:try_accept()
			if not ctcp then
				if s:closed() then --stop() called.
					break
				end
				s:check_io(retry, err)
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
	end, server_name..'-listen %s', s))

	return server
end

function mess_connect(s, host, port, timeout)
	if not issocket(s) then
		return mess_connect(tcp(), s, host, port)
	end
	s:settimeout(timeout)
	s:connect(host, port)
	s:settimeout(nil)
	return mess_protocol(s)
end
try_mess_connect = protect_io(mess_connect)

function channel:try_close   ()        return self.tcp:try_close() end
function channel:close       ()        return self.tcp:close() end
function channel:onclose     (fn)      return self.tcp:onclose(fn) end
function channel:closed      ()        return self.tcp:closed() end
function channel:wait_job    ()        return self.tcp:wait_job() end
function channel:wait_until  (expires) return self.tcp:wait_until(expires) end
function channel:wait        (timeout) return self.tcp:wait(timeout) end

function channel:try_recvall(onmessage, onerror)
	local onmessage = wrapfn('recvall', onmessage, onerror, self)
	while not self:closed() do
		local msg, err = self:try_recv()
		if not msg and err then
			if iserror(err, 'io') and err.message == 'eof' then
				break
			else
				return nil, err
			end
		else
			onmessage(self, msg)
		end
	end
	return true
end

function channel:recvall(...)
	return assert(self:try_recvall(...))
end

if not ... then

	logging.verbose = true
	logging.debug = true

	local server = mess_listen('127.0.0.1', '5555', function(self, chan)
		chan:recvall(function(self, msg)
			self:send(msg)
		end)
		chan:close()
		self:stop()
	end)

	resume(thread(function()

		local chan = mess_connect('127.0.0.1', '5555', 1)
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
