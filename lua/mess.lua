--[[

	Simple TCP protocol for sending and receiving Lua values.
	Written by Cosmin Apreutesei. Public Domain.

	Features:
		- fast binary de/serialization of Lua objects
		- full-duplex
		- raising & catching errors in event handlers

SERVER
	mess.listen(host, port, onaccept, [onerror], [server_name]) -> server
	onaccept(server, channel)
	onerror(server, error)

	server:stop()

CLIENT
	mess.connect(host, port, [expires], [tcp_opt]) -> channel

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
	mess.protocol(tcp) -> channel

]]

local errors = require'errors'
local sock = require'sock'
local buffer = require'string.buffer'
local ffi = require'ffi'
local glue = require'glue'

local cast, u32p = ffi.cast, glue.u32p

local check_io, checkp, check, protect = errors.tcp_protocol_errors'mess'

local M = {}
local channel = {maxlen = 16 * 1024^2}

function M.protocol(tcp)

	local chan = glue.update({tcp = tcp}, channel)

	local buf = buffer.new()
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

	local buf = buffer.new()
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
		local ok, err = errors.pcall(fn, ...)
		if not ok then
			if onerror then
				onerror(self, err)
			end
			sock.log('ERROR', 'mess', event, '%s', err)
		end
	end
end

function M.listen(host, port, onaccept, onerror, server_name)

	server_name = server_name or 'mess'

	local tcp = assert(sock.tcp())

	local server = {tcp = tcp}

	check_io(server, tcp:setopt('reuseaddr', true))
	check_io(server, tcp:listen(host, port))

	sock.liveadd(tcp, server_name)

	local stop
	function server:stop()
		stop = true
		tcp:close()
	end

	local onaccept = wrapfn('accept', onaccept, onerror, server)
	sock.resume(sock.thread(function()
		while not stop do
			local ctcp, err, retry = tcp:accept()
			if not ctcp then
				if tcp:closed() then --stop() called.
					break
				elseif retry then
					--temporary network error. retry without killing the CPU.
					sock.sleep(0.2)
					goto skip
				else
					check_io(server, nil, err)
				end
			end
			sock.liveadd(ctcp, server_name)
			sock.resume(sock.thread(function()
				local chan = M.protocol(ctcp)
				onaccept(server, chan)
				ctcp:close()
			end, server_name..'-accepted %s', ctcp))
			::skip::
		end
	end, server_name..'-listen %s', tcp))

	return server
end

function M.connect(host, port, exp, tcp_opt)
	local tcp = assert(sock.tcp())
	glue.update(tcp, tcp_opt)
	local ok, err = tcp:connect(host, port, exp)
	if not ok then
		tcp:close()
		return nil, err
	end
	return M.protocol(tcp)
end

function channel:close() return self.tcp:close() end
function channel:onclose(fn) return self.tcp:onclose(fn) end
function channel:closed() return self.tcp:closed() end

function channel:recvall(onmessage, onerror)
	local onmessage = wrapfn('recvall', onmessage, onerror, self)
	while not self:closed() do
		local ok, msg = self:recv()
		if not ok then
			if not errors.is(msg, 'tcp') then
				sock.log('ERROR', 'mess', 'recv', '%s', msg)
			end
		else
			onmessage(self, msg)
		end
	end
end

if not ... then

	local mess = M
	local pp = require'pp'
	local logging = require'logging'
	sock.logging = logging
	logging.verbose = true
	logging.debug = true

	sock.resume(sock.thread(function()

		local server = mess.listen('127.0.0.1', '1234', function(self, chan)
			chan:recvall(function(self, msg)
				pp('recv', msg)
			end)
			chan:close()
			self:stop()
		end)

	end))

	sock.resume(sock.thread(function()

		local chan = mess.connect('127.0.0.1', '1234')
		for i = 1, 100 do
			assert(chan:send{a = i, b = 2*i, i = tostring(i)})
		end
		chan:close()

	end))

	sock.start()

end

return M