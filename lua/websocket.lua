--[=[

	WebSocket protocol (RFC 6455), client + server.
	Written by Claude Opus 4.7 XHigh. Public Domain.

	Single-thread model: control frames (ping, pong, close) are handled inline
	by recv() so the app must call recv() or the peer may drop us as idle.

CLIENT
	websocket_connect(url, [opt]) -> ws        connect to ws:// or wss://
	- url                                      ws://host[:port][/path] or wss://...
	- headers                                  extra request headers ({k=v})
	- tls_options                              passed to sock_bearssl
	- connect_timeout                          connect timeout in seconds
	- handshake_timeout                        handshake send+recv timeout (default 5)
	- max_message_size                         inbound message size limit (16M)
	- max_frame_size                           inbound frame size limit (16M)

SERVER
	websocket_upgrade(req, [opt]) -> ws        upgrade an http_server request
	- max_message_size                         inbound message size limit (16M)
	- max_frame_size                           inbound frame size limit (16M)

WS OBJECT
	ws.headers     -> {k=v}                    response (client) / request (server) headers
	ws.tcp         -> tcp|stcp                 the underlying socket
	ws:send(s, ['text'|'binary'])              send a message (text default)
	ws:recv() -> s, kind                       receive next data message
	          | nil, code, reason              clean close from peer or local
	ws:close([code], [reason])                 send Close, drain peer Close, shutdown
	ws:ping([payload])                         send a Ping (pong handled inside recv)
	ws:send_chunk(s, [kind], [fin])            streaming send: first call sets kind,
	                                           subsequent calls use continuation;
	                                           pass fin=true on last chunk
	ws:recv_chunk() -> s, kind, fin            streaming recv: returns each frame's
	                | nil, code, reason        payload (controls handled inline)

CLOSE CODES (RFC 6455 7.4)
	1000 normal closure        1007 invalid frame payload data
	1001 going away            1008 policy violation
	1002 protocol error        1009 message too big
	1003 unsupported data      1011 internal error

TODO:
	- permessage-deflate.
	- auto-ping heartbeat.
	- concurrent sends.
	- send 1007/1002 on errors.

]=]

if not ... then require'websocket_test'; return end

require'glue'
require'pbuffer'
require'sock'
require'sock_bearssl'
require'base64'
require'url'
require'sha1'

local C_bs = ffi.load'bearssl'

local
	byte, char, concat, band, str, cast =
	byte, char, concat, band, str, cast

local WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

local OP_CONT  = 0x0
local OP_TEXT  = 0x1
local OP_BIN   = 0x2
local OP_CLOSE = 0x8
local OP_PING  = 0x9
local OP_PONG  = 0xA

--Sec-WebSocket-Accept computation -------------------------------------------

local function ws_accept(key)
	return base64_encode(sha1(key..WS_GUID))
end

local function valid_ws_key(key)
	if not key or not key:find'^[A-Za-z0-9+/]+=?=?$' then
		return false
	end
	local _, len = base64_decode_tobuffer(key)
	return len == 16
end

local function valid_close_code(code)
	if code == 1004 or code == 1005 or code == 1006 or code == 1015 then
		return false
	end
	if code >= 1000 and code <= 1011 then return true end
	if code >= 3000 and code <= 4999 then return true end
	return false
end

--frame I/O ------------------------------------------------------------------

local function read_frame_header(self)
	local tcp = self.tcp
	local rb = self.rb
	rb:need(2)
	local b1 = rb:get_u8()
	local b2 = rb:get_u8()
	local fin = band(b1, 0x80) ~= 0
	tcp:checkp(band(b1, 0x70) == 0, 'rsv bits set')
	local opcode = band(b1, 0x0F)
	local masked = band(b2, 0x80) ~= 0
	if self.is_server then
		tcp:checkp(masked, 'client frame not masked')
	else
		tcp:checkp(not masked, 'server frame masked')
	end
	local len7 = band(b2, 0x7F)
	local plen
	if len7 < 126 then
		plen = len7
	elseif len7 == 126 then
		rb:need(2)
		plen = rb:get_u16_be()
	else
		rb:need(8)
		local hi = rb:get_u32_be()
		local lo = rb:get_u32_be()
		tcp:checkp(hi < 0x200000, 'frame length overflow') --keep within 2^53
		plen = hi * 4294967296 + lo
	end
	if opcode >= 0x8 then
		tcp:checkp(plen <= 125, 'control frame too big')
		tcp:checkp(fin, 'fragmented control frame')
		tcp:checkp(opcode == OP_CLOSE or opcode == OP_PING or opcode == OP_PONG,
			'unknown control opcode')
	else
		tcp:checkp(opcode == OP_CONT or opcode == OP_TEXT or opcode == OP_BIN,
			'unknown data opcode')
	end
	tcp:checkp(plen <= self.max_frame_size, 'frame too big')
	local mask
	if masked then
		rb:need(4)
		mask = rb:get(4)
	end
	return fin, opcode, plen, mask
end

local function read_payload(self, plen, mask)
	if plen == 0 then return '' end
	local rb = self.rb
	rb:need(plen)
	local p = rb:ref()
	if mask then
		local mk = cast(u8p, mask)
		for i = 0, plen - 1 do
			p[i] = bxor(p[i], mk[band(i, 3)])
		end
	end
	local s = str(p, plen)
	rb.b:skip(plen)
	return s
end

local function write_frame(self, fin, opcode, payload, len)
	len = len or (payload and #payload or 0)
	local wb = self.wb
	wb:put_u8(bor(fin and 0x80 or 0, opcode))
	local mask_bit = self.is_client and 0x80 or 0
	if len < 126 then
		wb:put_u8(bor(mask_bit, len))
	elseif len < 65536 then
		wb:put_u8(bor(mask_bit, 126))
		wb:put_u16_be(len)
	else
		wb:put_u8(bor(mask_bit, 127))
		wb:put_u32_be(math.floor(len / 4294967296))
		wb:put_u32_be(len % 4294967296)
	end
	if self.is_client and len > 0 then
		local mask_key = secure_random_string(4)
		wb:put(mask_key)
		local p = wb:reserve(len)
		copy(p, payload, len)
		local mk = cast(u8p, mask_key)
		for i = 0, len - 1 do
			p[i] = bxor(p[i], mk[band(i, 3)])
		end
		wb:commit(len)
	elseif len > 0 then
		wb:put(payload)
	end
	wb:flush()
end

local function write_close_frame(self, code, reason)
	if code == nil then
		write_frame(self, true, OP_CLOSE, '', 0)
		return
	end
	reason = reason or ''
	assert(#reason <= 123, 'close reason too long')
	local payload = char(shr(code, 8), band(code, 0xff))..reason
	write_frame(self, true, OP_CLOSE, payload, #payload)
end

local function parse_close_payload(self, payload)
	if #payload == 0 then
		return 1005, ''
	end
	self.tcp:checkp(#payload >= 2, 'close payload of length 1')
	local code = byte(payload, 1) * 256 + byte(payload, 2)
	local reason = payload:sub(3)
	self.tcp:checkp(valid_close_code(code), 'invalid close code')
	return code, reason
end

--ws object ------------------------------------------------------------------

local ws = {
	type = 'websocket',
	max_message_size = 16 * 1024 * 1024,
	max_frame_size   = 16 * 1024 * 1024,
	close_timeout    = 5,
}
ws.__index = ws

function ws:try_close_socket()
	return self.tcp:try_close()
end

--called when peer sends close, or we want to flush our close from inside recv
local function handle_peer_close(self, payload)
	local code, reason = parse_close_payload(self, payload)
	self.peer_closed = true
	self.peer_code, self.peer_reason = code, reason
	if not self.closed_sent then
		local echo = (code == 1005) and nil or code
		write_close_frame(self, echo)
		self.closed_sent = true
	end
	return code, reason
end

function ws:recv()
	if self.peer_closed then
		return nil, self.peer_code, self.peer_reason
	end
	local msg = {}
	local msg_kind, msg_total = nil, 0
	while true do
		local fin, opcode, plen, mask = read_frame_header(self)
		if opcode >= 0x8 then
			local payload = read_payload(self, plen, mask)
			if opcode == OP_PING then
				write_frame(self, true, OP_PONG, payload, #payload)
			elseif opcode == OP_PONG then
				--ignore
			else --OP_CLOSE
				local code, reason = handle_peer_close(self, payload)
				return nil, code, reason
			end
		else
			if opcode == OP_CONT then
				self.tcp:checkp(msg_kind, 'continuation without start')
			else
				self.tcp:checkp(not msg_kind, 'data frame inside message')
				msg_kind = (opcode == OP_TEXT) and 'text' or 'binary'
			end
			msg_total = msg_total + plen
			self.tcp:checkp(msg_total <= self.max_message_size, 'message too big')
			msg[#msg + 1] = read_payload(self, plen, mask)
			if fin then
				local s = #msg == 1 and msg[1] or concat(msg)
				return s, msg_kind
			end
		end
	end
end

function ws:send(s, kind)
	assert(type(s) == 'string', 'string expected')
	assert(not self.closed_sent, 'connection closed')
	assert(not self.send_in_progress, 'message in progress (use send_chunk)')
	local opcode = (kind == 'binary') and OP_BIN or OP_TEXT
	write_frame(self, true, opcode, s, #s)
end

function ws:send_chunk(s, kind, fin)
	assert(type(s) == 'string', 'string expected')
	assert(not self.closed_sent, 'connection closed')
	local opcode
	if self.send_in_progress then
		opcode = OP_CONT
	else
		opcode = (kind == 'binary') and OP_BIN or OP_TEXT
		self.send_in_progress = true
	end
	if fin then
		self.send_in_progress = false
	end
	write_frame(self, fin and true or false, opcode, s, #s)
end

function ws:recv_chunk()
	if self.peer_closed then
		return nil, self.peer_code, self.peer_reason
	end
	while true do
		local fin, opcode, plen, mask = read_frame_header(self)
		if opcode >= 0x8 then
			local payload = read_payload(self, plen, mask)
			if opcode == OP_PING then
				write_frame(self, true, OP_PONG, payload, #payload)
			elseif opcode == OP_PONG then
				--ignore
			else --OP_CLOSE
				local code, reason = handle_peer_close(self, payload)
				return nil, code, reason
			end
		else
			local kind
			if opcode == OP_CONT then
				self.tcp:checkp(self.recv_in_progress, 'continuation without start')
				kind = self.recv_in_progress
			else
				self.tcp:checkp(not self.recv_in_progress, 'data frame inside message')
				kind = (opcode == OP_TEXT) and 'text' or 'binary'
				self.recv_in_progress = fin and nil or kind
				self.recv_total = 0
			end
			self.recv_total = self.recv_total + plen
			self.tcp:checkp(self.recv_total <= self.max_message_size, 'message too big')
			if fin then
				self.recv_in_progress = nil
				self.recv_total = nil
			end
			local payload = read_payload(self, plen, mask)
			return payload, kind, fin
		end
	end
end

function ws:ping(payload)
	payload = payload or ''
	assert(#payload <= 125, 'ping payload too big')
	write_frame(self, true, OP_PING, payload, #payload)
end

function ws:close(code, reason)
	if not self.closed_sent then
		self.closed_sent = true
		code = code or 1000
		write_close_frame(self, code, reason)
		if not self.peer_closed then
			self.tcp:settimeout(self.close_timeout)
			while not self.peer_closed do
				local _, opcode, plen, mask = read_frame_header(self)
				local payload = read_payload(self, plen, mask)
				if opcode == OP_CLOSE then
					handle_peer_close(self, payload)
				end
				--ignore data/ping frames during close handshake
			end
		end
	end
	if self.is_client then
		self.tcp:try_close()
	end
end

--server-side upgrade --------------------------------------------------------

function websocket_upgrade(req, opt)
	opt = opt or empty
	local h = req.headers
	if req.method ~= 'GET' then
		error{type = 'http_response', status = 405, content = 'Expected GET\n'}
	end
	if not (h.upgrade and h.upgrade:lower() == 'websocket') then
		error{type = 'http_response', status = 400, content = 'Expected Upgrade: websocket\n'}
	end
	if not (h.connection and h.connection:lower():find('upgrade', 1, true)) then
		error{type = 'http_response', status = 400, content = 'Expected Connection: Upgrade\n'}
	end
	if h['sec-websocket-version'] ~= '13' then
		error{type = 'http_response', status = 426,
			headers = {['sec-websocket-version'] = '13'},
			content = 'Unsupported WebSocket version\n'}
	end
	local key = h['sec-websocket-key']
	if not valid_ws_key(key) then
		error{type = 'http_response', status = 400, content = 'Invalid Sec-WebSocket-Key\n'}
	end
	local wb = req.tcp.wb
	wb:put'HTTP/1.1 101 Switching Protocols\r\n'
	wb:put'Upgrade: websocket\r\n'
	wb:put'Connection: Upgrade\r\n'
	wb:put('Sec-WebSocket-Accept: '..ws_accept(key)..'\r\n')
	wb:put'\r\n'
	wb:flush()
	--prevent http_server from sending/closing further on this conn
	req.headers_sent = true
	req.close = true
	local self = setmetatable({
		tcp = req.tcp,
		rb  = req.tcp.rb,
		wb  = req.tcp.wb,
		is_server = true,
		is_client = false,
		headers = h,
		max_message_size = opt.max_message_size or ws.max_message_size,
		max_frame_size   = opt.max_frame_size   or ws.max_frame_size,
	}, ws)
	--auto-close on handler return if app didn't already close
	req:onfinish(function()
		if not self.closed_sent then
			self:close(1001, 'going away')
		end
	end)
	return self
end

--client-side connect --------------------------------------------------------

function websocket_connect(url_s, opt)
	opt = opt or {}
	local u = url_parse(url_s)
	local scheme = (u.scheme or ''):lower()
	assert(scheme == 'ws' or scheme == 'wss', 'expected ws:// or wss://')
	local secure = scheme == 'wss'
	local port = tonumber(u.port) or (secure and 443 or 80)
	local tcp = connect(u.host, port, opt.connect_timeout)

	if secure then
		tcp = client_stcp(tcp, u.host, opt.tls_options)
	end
	tcp:setopt('tcp_nodelay', true)
	local rb = pbuffer{
		f = tcp,
		readahead = 64 * 1024,
		lineterm = '\r\n',
		linesize = 8192,
	}
	local wb = pbuffer{f = tcp}
	local key = base64_encode(secure_random_string(16))
	local path = u.path or '/'
	if u.query then path = path..'?'..u.query end
	local host_header = u.host
	if u.port then host_header = host_header..':'..u.port end
	tcp:settimeout(opt.handshake_timeout or 5)
	wb:put('GET '..path..' HTTP/1.1\r\n')
	wb:put('Host: '..host_header..'\r\n')
	wb:put'Upgrade: websocket\r\n'
	wb:put'Connection: Upgrade\r\n'
	wb:put('Sec-WebSocket-Key: '..key..'\r\n')
	wb:put'Sec-WebSocket-Version: 13\r\n'
	if opt.headers then
		for k, v in pairs(opt.headers) do
			wb:put(k..': '..tostring(v)..'\r\n')
		end
	end
	wb:put'\r\n'
	wb:flush()
	local line = rb:needline()
	local version, status = line:match'^HTTP/(%d+%.%d+)%s+(%d+)'
	tcp:checkp(version == '1.1', 'invalid http version')
	tcp:checkp(status == '101', 'expected 101, got '..(status or '?'))
	local resp = {}
	for i = 1, 100 do
		local line = rb:needline()
		if line == '' then break end
		tcp:checkp(i <= 99, 'too many headers')
		local name, value = line:match'^([^:]+):%s*(.*)'
		tcp:checkp(name, 'bad header')
		resp[name:lower()] = (value or ''):match'^%s*(.-)%s*$'
	end
	tcp:checkp((resp.upgrade or ''):lower() == 'websocket', 'missing Upgrade response')
	tcp:checkp((resp.connection or ''):lower():find('upgrade', 1, true), 'missing Connection response')
	tcp:checkp(resp['sec-websocket-accept'] == ws_accept(key), 'bad Sec-WebSocket-Accept')
	tcp:settimeout(nil)
	local self = setmetatable({
		tcp = tcp,
		rb  = rb,
		wb  = wb,
		is_server = false,
		is_client = true,
		headers = resp,
		max_message_size = opt.max_message_size or ws.max_message_size,
		max_frame_size   = opt.max_frame_size   or ws.max_frame_size,
	}, ws)
	return self
end

websocket_class = ws

return ws
