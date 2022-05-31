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
	mess_connect(host, port, [expires], [tcp_opt]) -> channel

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
local string_buffer = require'string.buffer'.new

local
	cast, u32p =
	cast, u32p

local check_io, checkp, check, protect = tcp_protocol_errors'mess'

local channel = {maxlen = 16 * 1024^2}

function mess_protocol(tcp)

	local chan = update({tcp = tcp}, channel)

	local buf = string_buffer()
	chan.send = protect(function(self, msg, exp)
		buf:reset()
		buf:reserve(4)
		buf:commit(4)
		buf:encode(msg)
		local p, len = buf:ref()
		cast(u32p, p)[0] = len - 4
		check_io(self, tcp:send(p, len, exp))
		return true
	end)

	local buf = string_buffer()
	chan.recv = protect(function(self)
		buf:reset()
		local plen = buf:reserve(4)
		check_io(self, tcp:recvn(plen, 4))
		local len = cast(u32p, plen)[0]
		checkp(self, len <= self.maxlen, 'message too big: %d', len)
		local p = buf:reset():reserve(len)
		check_io(self, tcp:recvn(p, len))
		buf:commit(len)
		return check(self, pcall(buf.decode, buf))
	end)

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

	local tcp = assert(tcp())

	local server = {tcp = tcp}

	check_io(server, tcp:setopt('reuseaddr', true))
	check_io(server, tcp:listen(host, port))

	liveadd(tcp, server_name)

	local stop
	function server:stop()
		stop = true
		tcp:close()
	end

	local onaccept = wrapfn('accept', onaccept, onerror, server)
	resume(thread(function()
		while not stop do
			local ctcp, err, retry = tcp:accept()
			if not ctcp then
				if tcp:closed() then --stop() called.
					break
				elseif retry then
					--temporary network error. retry without killing the CPU.
					wait(0.2)
					goto skip
				else
					check_io(server, nil, err)
				end
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

function mess_connect(host, port, exp, tcp_opt)
	local tcp = assert(tcp())
	update(tcp, tcp_opt)
	local ok, err = tcp:connect(host, port, exp)
	if not ok then
		tcp:close()
		return nil, err
	end
	return mess_protocol(tcp)
end

function channel:close       ()        return self.tcp:close() end
function channel:onclose     (fn)      return self.tcp:onclose(fn) end
function channel:closed      ()        return self.tcp:closed() end
function channel:wait_job    ()        return self.tcp:wait_job() end
function channel:wait_until  (expires) return self.tcp:wait_until(expires) end
function channel:wait        (timeout) return self.tcp:wait(timeout) end

function channel:recvall(onmessage, onerror)
	local onmessage = wrapfn('recvall', onmessage, onerror, self)
	while not self:closed() do
		local ok, msg = self:recv()
		if not ok then
			if not iserror(msg, 'tcp') then
				log('ERROR', 'mess', 'recv', '%s', msg)
			end
		else
			onmessage(self, msg)
		end
	end
end

if not ... then

	require'glue'
	require'logging'
	logging.verbose = true
	logging.debug = true

	resume(thread(function()

		local server = mess_listen('127.0.0.1', '1234', function(self, chan)
			chan:recvall(function(self, msg)
				assert(self:send(msg))
			end)
			assert(chan:close())
			self:stop()
		end)

	end))

	resume(thread(function()

		local chan = mess_connect('127.0.0.1', '1234', clock() + 1)
		for i = 1, 20 do
			assert(chan:send{a = i, b = 2*i, s = tostring(i)})
			local _, t = assert(chan:recv())
			pr(t)
		end
		assert(chan:close())

	end))

	start()

end

return M
