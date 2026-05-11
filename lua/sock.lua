--[=[

	Sockets API for Linux.
	Written by Cosmin Apreutesei. Public Domain.
	TLS support in sock_bearssl.lua.

ADDRESSES
	[try_]sockaddr(addr, [port], [timeout]) -> sa  make a sockaddr from a string (see addr format)
	[try_]sockaddrs(addr, [port], [timeout]) -> {sa1,...}  resolves to multiple IPs
	sa:family() -> 'ip|ip6|unix'           socket family
	sa:port() -> port|nil                  port (for ip/ip6 family)
	sa:tostring() -> ip|ip6|path           string representation
	is_ipv4(s) -> true|false               check if s looks like an IPv4 adress
	addr_parse(s[, default_port]) ->  host, [port], 'ip|ip6|hostname'
SOCKETS
	s:[try_]close()                        close connection and free socket
	s:closed() -> t|f                      check if the socket is closed
	s:onclose(fn)                          exec fn after the socket is closed
	issocket(s) -> t|f                     check if s is a socket
	s.fd -> fd                             POSIX file descriptor
	s:[try_]bind(addr, [port])             bind socket to an address
	s:bound_addr() -> sa                   get bound sockaddr
	s:[try_]setopt(opt, val)               set socket option ('so_*', 'tcp_*', etc.)
	s:[try_]getopt(opt) -> val             get socket option
	s:debug_stream([protocol_name])        log recv/send data
WAIT JOBS
	s:wait_job() -> sj          wait job that is auto-canceled on socket close
	s:wait_until(t) -> ...      wait_until() on auto-canceled wait job
	s:wait(s) -> ...            wait() on auto-canceled wait job
TCP
	tcp([family='ip'], [opt]) -> tcp                make a SOCK_STREAM socket
	[try_]connect(addr, [port], [timeout], [client_ip]) -> tcp  create tcp socket and connect
	listen(addr, [port], [backlog], [onaccept]) -> tcp          create tcp socket and listen
	tcp:[try_]connect(addr, [port])                 connect to an address
	tcp:[try_]send(s|buf, [len], [flags]) -> true   send bytes to connected address
	tcp:[try_]recv(buf, maxlen) -> len              receive bytes
	tcp:[try_]listen(addr, [port], [backlog], [onaccept])         put socket in listening mode
	tcp:[try_]accept([opt], [timeout]) -> ctcp | nil,err,[retry]  accept a client connection
	tcp:[try_]recvn(buf, n)                         receive n bytes
	tcp:[try_]recvall() -> buf, len                 receive until closed
	tcp:remote_addr() -> sa                         get connected/accepted sockaddr
UDP
	udp([family='ip'], [opt]) -> udp                make a SOCK_DGRAM socket
	udp:[try_]connect(addr, [port])                 connect to an address
	udp:[try_]send(s|buf, [len], [flags]) -> len    send bytes to connected address
	udp:[try_]recv(buf, maxlen) -> len              receive bytes
	udp:[try_]sendto(addr, [port], s|buf, [len]) -> len     send a datagram to an address
	udp:[try_]recvnext(buf, maxlen, [flags]) -> len, sa     receive the next datagram
	tcp:[try_]shutdown(['r'|'w'|'rw'])         send FIN

PROGRAMMING NOTES ------------------------------------------------------------

The addr arg is either a sockaddr (sa) or a string of form:

	'IP', 'IP6', 'HOST', 'IP:PORT', 'IP6:PORT', 'HOST:PORT', 'unix:PATH'

Some error messages are normalized across platforms, like 'access_denied'
and 'address_already_in_use' so they can be used in conditionals.

I/O functions only work inside threads created with thread().

Raising methods close the socket on errors, but the try_*() variants do not!

Never abandon threads in suspended state, it will cause leaks!

SOCKETS ----------------------------------------------------------------------

s:[try_]close()

	Close the connection and free the socket.

	For TCP sockets, if 1) there's unread incoming data (i.e. recv() hasn't
	returned 0 yet), or 2) so_linger socket option was set with a zero timeout,
	then a TCP RST packet is sent to the client, otherwise a FIN is sent.

s:[try_]bind(addr, [port])

	Bind socket to an interface/port (which defaults to '0.0.0.0:0' / ':::0'
	meaning all interfaces and a random port).

s:setexpires(clock|nil, ['r'|'w'])
s:settimeout(seconds|nil, ['r'|'w'])

	Set or clear the expiration clock for all subsequent I/O operations.
	If the expiration clock is reached before an operation completes,
	nil,'timeout' is returned.

tcp|udp:[try_]connect(addr, ...)

	Connect to an address.

	For UDP sockets, this has the effect of filtering incoming packets so that
	only those coming from the connected address get through the socket. Also,
	you can call connect() multiple times (use ('0.0.0.0', 0) to switch back to
	unfiltered mode).

tcp:[try_]send(s|buf, [len], [flags]) -> true

	Send bytes to the connected address.
	Trying to send zero bytes is allowed but it's a no-op (doesn't go to the OS).

udp:[try_]send(s|buf, [len], [flags]) -> len

	Send bytes to the connected address.
	Empty packets (zero bytes) are allowed.

tcp|udp:[try_]recv(buf, maxlen, [flags]) -> len | 0,'eof'

	Receive bytes from the connected address.
	Returns (and keeps returning) 0,'eof' if the socket was closed on the other side.

tcp:[try_]listen(addr, [port], [backlog], [onaccept])

	Put the socket in listening mode, binding the socket if not bound already
	(in which case addr is ignored). The backlog defaults
	to 1/0 which means "use the maximum allowed".

tcp:[try_]accept([opt], [timeout]) -> ctcp | nil,err,[retry]

	Accept a client connection. Timeout is to limit TLS handshake for sock_bearssl.

	A third return value indicates that the error is a network error and thus
	the call can be retried.

tcp:[try_]recvn(buf, len) -> true

	Repeat recv until len bytes are received.
	Partial reads are signaled with nil,err,readlen.

tcp:[try_]recvall() -> buf,len | nil,err,buf,len

	Receive until closed into an accumulating buffer.

udp:[try_]sendto(addr, [port], s|buf, [maxlen], [flags]) -> len

	Send a datagram to a specific destination, regardless of whether the socket
	is connected or not.

udp:[try_]recvnext(buf, maxlen, [flags]) -> len, sa

	Receive the next incoming datagram, wherever it came from, along with the
	source address. If the socket is connected, packets are still filtered though.

tcp:[try_]shutdown(['r'|'w'|'rw'])

	Shutdown the socket for receiving, sending or both (default). Does not block.

	Sends a TCP FIN packet to indicate refusal to send/receive any more data
	on the connection. The FIN packet is only sent after all the current pending
	data is sent (unlike RST which is sent immediately). When a FIN is received
	recv() returns 0.

	Calling close() without shutdown may send a RST (see the notes on close()
	for when that can happen) which may cause any data that is pending either
	on the sender side or on the receiving side to be discarded (that's how TCP
	works: RST has that data-cutting effect).

	Required for lame protocols like HTTP with pipelining: a HTTP server
	that wants to close the connection before honoring all the received
	pipelined requests needs to call s:shutdown'w' (which sends a FIN to
	the client) and then continue to receive (and discard) everything until
	a recv that returns 0 comes in (which is a FIN from the client, as a reply
	to the FIN from the server) and only then it can close the connection without
	messing up the client.

]=]

if not ... then require'sock_test'; return end

require'glue'
require'ipv6'
require'epoll'
require'owner'

assert(Linux, 'platform not Linux')

local
	assert, isstr, clock, max, abs, min =
	assert, isstr, clock, max, abs, min
local
	band, bor, shr, cast, u8p, fill, str =
	band, bor, shr, cast, u8p, fill, str

local C = C

--sockaddr -------------------------------------------------------------------

cdef[[
struct sockaddr_in {
	short          family_num;
	uint8_t        port_bytes[2];
	uint8_t        ip_bytes[4];
	char           _zero[8];
};
struct sockaddr_in6 {
	short           family_num;
	uint8_t         port_bytes[2];
	unsigned long   flowinfo;
	uint8_t         ip_bytes[16];
	unsigned long   scope_id;
};
struct sockaddr_un {
	short family_num;
	char  path[108];
};
typedef struct sockaddr {
	union {
		struct {
			short   family_num;
			uint8_t port_bytes[2];
		};
		struct sockaddr_in  addr_in;
		struct sockaddr_in6 addr_in6;
		struct sockaddr_un  addr_un;
	};
} sockaddr;
]]

local sockaddr_ct = ctype'sockaddr'

function issockaddr(sa)
	return isctype(sockaddr_ct, sa)
end

local AF_UNIX      = 1
local AF_INET      = 2
local AF_INET6     = 10
local SOCK_STREAM  = 1
local SOCK_DGRAM   = 2
local IPPROTO_TCP  = 6
local IPPROTO_UDP  = 17
local IPPROTO_IP   = 0
local IPPROTO_IPV6 = 41

local unix_path_maxlen = sizeof(sockaddr_ct().addr_un.path)
local function sockaddr_from_unix_path(path)
	if path == '' or #path + 1 >= unix_path_maxlen then return nil end
	local sa = sockaddr_ct()
	sa.family_num = AF_UNIX
	copy(sa.addr_un.path, path)
	return sa
end

function is_ipv4(s)
	return s:find'^%d+%.%d+%.%d+%.%d+$' and true or false
end

local function ipv4_tobin(s)
	local n1, n2, n3, n4 = s:match'^(%d+)%.(%d+)%.(%d+)%.(%d+)$'
	if not n1 then return nil end --invalid
	n1 = tonumber(n1)
	n2 = tonumber(n2)
	n3 = tonumber(n3)
	n4 = tonumber(n4)
	if n1 > 255 or n2 > 255 or n3 > 255 or n4 > 255 then return nil end --invalid
	return char(n1, n2, n3, n4)
end

local function sockaddr_from_ipv4(s, port) --s is in binary!
	local sa = sockaddr_ct()
	sa.family_num = AF_INET
	copy(sa.addr_in.ip_bytes, s, 4)
	if port then sa:set_port(port) end
	return sa
end

local function sockaddr_from_ipv6(s, port) --s is in binary!
	local sa = sockaddr_ct()
	sa.family_num = AF_INET6
	copy(sa.addr_in6.ip_bytes, s, 16)
	if port then sa:set_port(port) end
	return sa
end

function addr_parse(s, default_port) -- returns: host, [port], 'ip|ip6|hostname'
	local ip6, port, host
	if s:starts'[' then --[ip6]:port or [ip6] (RFC 3986)
		ip6, port = s:match'^%[(.+)%]:(%d+)$'
		if not ip6 then ip6 = s:match'^%[(.+)%]$' end
		if not ip6 then return nil end
	elseif s:find(':.*:') then -- bare ip6 (multiple colons; ambiguous but practical)
		ip6 = s
	elseif s:has':' then -- host:port or ip:port
		host, port = s:match'^(.+):(%d+)$'
		if not host then return nil end
	else --host or ip
		host = s
		if #host == 0 then return nil end
	end
	port = tonumber(port) or default_port
	if port and not (port >= 0 and port <= 0xffff) then return nil end
	if ip6 then
		ip6 = ipv6_tobin(ip6)
		if not ip6 then return nil end
		return ip6, port, 'ip6'
	elseif is_ipv4(host) then
		host = ipv4_tobin(host)
		if not host then return nil end
		return host, port, 'ip'
	else
		return host, port, 'hostname'
	end
end

local function _try_sockaddrs(s, default_port, timeout) --returns sockaddr or {sockaddr1, ...}
	if issockaddr(s) then return s end --pass-through
	if s:starts'unix:' then
		return sockaddr_from_unix_path(s:sub(6))
	end
	local addr, port, addr_type = addr_parse(s, default_port)
	if not addr then
		return nil
	elseif addr_type == 'ip6' then
		return sockaddr_from_ipv6(addr, port)
	elseif addr_type == 'ip' then
		return sockaddr_from_ipv4(addr, port)
	elseif addr_type == 'hostname' then
		if timeout == 'noresolve' then
			return nil, 'hostname'
		end
		require'resolver'
		--TODO: make try_resolve() give both 'A' and 'AAAA' records at once.
		local addrs, err = try_resolve(addr, nil, timeout)
		if not addrs then return nil, err end
		for i,addr in ipairs(addrs) do
			if is_ipv4(addr) then
				addrs[i] = sockaddr_from_ipv4(ipv4_tobin(addr), port)
			elseif addr:has':' then
				addrs[i] = sockaddr_from_ipv6(ipv6_tobin(addr), port)
			else
				assert(false) --resolver bug
			end
		end
		return addrs
	else
		assert(false) --bug
	end
end
function try_sockaddrs(...)
	local sa, err = _try_sockaddrs(...)
	if not sa then return nil, err end
	return istab(sa) and sa or {sa}
end
function try_sockaddr(...)
	local sa, err = _try_sockaddrs(...)
	if not sa then return nil, err end
	return istab(sa) and sa[1] or sa
end
function sockaddrs(s, ...)
	local sas, err = try_sockaddrs(s, ...)
	return check_io(nil, sas, '%s: %s', err or 'invalid address', s)
end
function sockaddr(s, ...)
	local sa, err = try_sockaddr(s, ...)
	return check_io(nil, sa, '%s: %s', err or 'invalid address', s)
end

local sa = {}
function sa:family()
	return (
		self.family_num == AF_INET  and 'ip' or
		self.family_num == AF_INET6 and 'ip6' or
		self.family_num == AF_UNIX  and 'unix'
		or nil
	)
end
function sa:port()
	if self.family_num == AF_INET or self.family_num == AF_INET6 then
		return self.port_bytes[0] * 0x100 + self.port_bytes[1]
	end
end
function sa:set_port(port)
	self.port_bytes[0] = shr(port, 8)
	self.port_bytes[1] = band(port, 0xff)
end
function sa:size()
	return (
		self.family_num == AF_INET  and sizeof'struct sockaddr_in' or
		self.family_num == AF_INET6 and sizeof'struct sockaddr_in6' or
		self.family_num == AF_UNIX  and offsetof('struct sockaddr_un', 'path')
			+ strlen(self.addr_un.path, sizeof(self.addr_un.path)) + 1
		or nil
	)
end
function sa:ip()
	if self.family_num == AF_INET then
		local b = self.addr_in.ip_bytes
		return format('%d.%d.%d.%d', b[0], b[1], b[2], b[3])
	elseif self.family_num == AF_INET6 then
		local b = self.addr_in6.ip_bytes
		return ipv6_tostring(str(b, 16), true, false)
	elseif self.family_num == AF_UNIX then
		return str(self.addr_un.path)
	end
end
function sa:tostring()
	return self:ip()..(self:port() and ':'..self:port() or '')
end

metatype('struct sockaddr', {__index = sa, type = 'sockaddr'})

--POSIX sockets --------------------------------------------------------------

cdef[[
typedef int SOCKET;
int socket(int af, int type, int protocol);
int accept4(int s, struct sockaddr *addr, int *addrlen, int flags);
int close(int s);
int connect(int s, const struct sockaddr *name, int namelen);
int ioctl(int s, long cmd, unsigned long *argp, ...);
int getsockopt(int sockfd, int level, int optname, char *optval, unsigned int *optlen);
int setsockopt(int sockfd, int level, int optname, const char *optval, unsigned int optlen);
int recv(int s, char *buf, int len, int flags);
int recvfrom(int s, char *buf, int len, int flags, struct sockaddr *from, int *fromlen);
int send(int s, const char *buf, int len, int flags);
int sendto(int s, const char *buf, int len, int flags, const struct sockaddr *to, int tolen);
int getsockname(int sockfd, struct sockaddr *restrict addr, int *restrict addrlen);
]]

local socket = {
	debug_prefix = 'S',
	check_io = check_io,
	checkp = checkp,
	checknp = checknp,
	protect = protect,
} --common socket methods
local tcp = {type = 'tcp_socket', socktype = 'tcp'} --all SOCK_STREAM really
local udp = {type = 'udp_socket', socktype = 'udp'} --all SOCK_DGRAM really

function issocket(s)
	local mt = getmetatable(s)
	return istab(mt) and rawget(mt, 'issocket') or false
end

local SOCK_NONBLOCK  = 0x000800 --async I/O
local SOCK_CLOEXEC   = 0x080000 --close-on-exec (non-inheritable on exec())

local function wrap_socket(opt, class, fd, family)
	return _initowner(object(class, {
		fd = assert(fd), family = family, issocket = true,
		r = 0, w = 0,
	}, opt))
end

socket.default_owner = 'current'
socket.setowner = setowner

local function create_socket(st, family, class, opt)
	local af =
		family == 'ip'   and AF_INET  or
		family == 'ip6'  and AF_INET6 or
		family == 'unix' and AF_UNIX  or
		assert(false)
	local fd = C.socket(af, bor(st, SOCK_NONBLOCK, SOCK_CLOEXEC), 0)
	assert(try_errno(fd ~= -1))
	local s = wrap_socket(opt, class, fd, family)
	live(s, '%s/%s fd=%d', s.socktype, family, fd)
	return s
end
local function create_tcp(family, opt)
	return create_socket(SOCK_STREAM, family or 'ip', tcp, opt)
end
local function create_udp(family, opt)
	return create_socket(SOCK_DGRAM, family or 'ip', udp, opt)
end

--NOTE: close() returns false on error but it should be ignored.
local function socket_try_close(self, cancel_thread)
	if self.fd == -1 then return true end
	local fd = self.fd; self.fd = -1 --set barrier for entire API incl. close().
	_epoll_remove(self, fd) --close() not called yet so fd is still valid.
	--NOTE: close() failing doesn't mean failed to close, the fd is still gone.
	--close only reports pending I/O errors.
	local close_ok, close_err = try_errno(C.close(fd) == 0)
	if self._onclose then
		--disown before waking thread owners which will try to disown and fail.
		self:_onclose()
	end
	_epoll_cancel(self, cancel_thread) --raise into waiting I/O threads.
	local ps = self.listen_socket
	if ps then
		ps._sockets_n = ps._sockets_n - 1
		ps._sockets[self] = nil
	end
	if self._sockets then --close all accepted sockets if any.
		for s in pairs(self._sockets) do
			s:try_close()
		end
		assert(self._sockets_n == 0)
	end
	live(self, nil, 'r:%d w:%d%s', self.r, self.w,
		self._sockets and ' clients:'..self._sockets_n or '')
	if not close_ok then return false, close_err end
	return true
end
function socket:try_close()
	return socket_try_close(self)
end
function socket:_try_cancel_io(cancel_thread)
	if self.fd == -1 then return nil, 'thread not waiting' end
	return socket_try_close(self, cancel_thread)
end
socket.close = unprotect_io(socket.try_close)

function socket:closed()
	return self.fd == -1
end

function socket:onclose(fn)
	after(self, '_onclose', fn)
end

socket.setexpires  = _epoll_setexpires
socket.settimeout  = _epoll_settimeout

function socket:_epoll_error()
	return self:try_getopt'so_error' --NOTE: this clears the error!
end

function socket:wait_job()
	local job = wait_job()
	self:onclose(function()
		job:cancel()
	end)
	return job
end
function socket:wait_until(expires)
	return self:wait_job():wait_until(expires)
end
function socket:wait(timeout)
	return self:wait_job():wait(timeout)
end

--async sock functions -------------------------------------------------------

local socket_connect = _make_async_connect(function(self, sa)
	return C.connect(self.fd, sa, sa:size())
end)

function tcp:try_connect(addr, port)
	if self.fd == -1 then return nil, 'closed' end
	local resolve_timeout = self.send_expires and self.send_expires - clock()
	local sa, err = try_sockaddr(addr, port, resolve_timeout)
	if not sa then return nil, err end
	log('', 'sock', 'connect', '%-4s %s', self, sa:tostring())
	if not self._bound_addr and self.family ~= 'unix' then
		local ok, err = self:try_bind()
		if not ok then return false, err end
	end
	local ok, err = socket_connect(self, sa)
	if not ok then return false, err end
	self._remote_addr = sa
	live(self, 'connected %s', sa:tostring())
	return true
end
tcp.connect = unprotect_io(tcp.try_connect)
udp.try_connect = tcp.try_connect
udp.connect = unprotect_io(udp.try_connect)

function tcp:remote_addr()
	return self._remote_addr
end

do
	local nbuf = new'int[1]'
	local socket_accept = _make_async('r', false, function(self, accept_sa)
		nbuf[0] = sizeof(sockaddr_ct)
		local r = C.accept4(self.fd, accept_sa, nbuf, bor(SOCK_NONBLOCK, SOCK_CLOEXEC))
		return r
	end)

	function tcp:try_accept(opt, timeout)
		if self.fd == -1 then return nil, 'closed' end
		local accept_sa = sockaddr_ct()
		local fd, err = socket_accept(self, accept_sa)
		--See man accept(2): Linux can return these pending connection errors.
		local retry =
			   err == 'network_down'
			or err == 'protocol_error'
			or err == 'protocol_not_available'
			or err == 'host_down'
			or err == 'network_missing'
			or err == 'host_unreachable'
			or err == 'not_supported'
			or err == 'network_unreachable'
			or err == 'connection_aborted'
		if not fd then
			return nil, err, retry
		end
		local s = wrap_socket(opt, tcp, fd, self.family)
		_epoll_add(s, fd)
		self._sockets_n = self._sockets_n + 1
		self._sockets[s] = true
		self.next_i = (self.next_i or 0) + 1
		s.i = self.next_i
		live(s, 'accepted %s.%d %s fd=%d clients:%d',
			self, s.i, accept_sa:tostring(), s.fd, self._sockets_n)
		s._remote_addr = accept_sa
		s.listen_socket = self
		if timeout then
			s:settimeout(timeout)
		end
		return s
	end
	function tcp:accept(...)
		local s, err, retry = self:try_accept(...)
		if s then return s end
		self:check_io(retry, err)
		return nil, err, true
	end
end

local MSG_NOSIGNAL = 0x4000

--NOTE: to send many small pieces use a pbuffer instead, this will crawl!
local socket_send = _make_async('w', true, function(self, buf, sz, flags)
	return C.send(self.fd, buf, sz, flags or MSG_NOSIGNAL)
end)
function socket:try_send(buf, sz, flags)
	if self.fd == -1 then return nil, 'closed' end
	sz = sz or #buf
	if sz == 0 then return true end --mask-out null-writes
	local left = sz
	while true do
		local n, err = socket_send(self, buf, left, flags)
		if not n then return nil, err end
		if n == 0 then return nil, 'eof' end --shouldn't be possible
		left = left - n
		if left == 0 then return true end
		if isstr(buf) then --only creating a buffer on a rare second pass.
			buf = cast(u8p, buf)
		end
		buf = buf + n
	end
end
socket.send = unprotect_io(socket.try_send)
socket.try_write = socket.try_send
socket.write = socket.send

local socket_recv = _make_async('r', true, function(self, buf, sz, flags)
	return C.recv(self.fd, buf, sz, flags or 0)
end)

--NOTE: to read many small pieces, use a pbuffer instead, this will crawl!
function socket:try_recv(buf, sz, flags)
	if self.fd == -1 then return nil, 'closed' end
	if sz == 0 then return 0 end --mask out null reads
	local n, err = socket_recv(self, buf, sz, flags)
	if not n then return nil, err end
	if n == 0 then return 0, 'eof' end
	return n
end
socket.recv = unprotect_io(socket.try_recv)
socket.try_read = socket.try_recv
socket.read = socket.recv

local udp_sendto = _make_async('w', true, function(self, sa, buf, len, flags)
	return C.sendto(self.fd, buf, len, flags or 0, sa, sa:size())
end)

function udp:try_sendto(addr, port, buf, len, flags)
	if self.fd == -1 then return nil, 'closed' end
	len = len or #buf
	local resolve_timeout = self.send_expires and self.send_expires - clock()
	local sa, err = try_sockaddr(addr, port, resolve_timeout)
	if not sa then return nil, err end
	local len, err = udp_sendto(self, sa, buf, len, flags)
	if not len then return nil, err end
	return len
end
udp.sendto = unprotect_io(udp.try_sendto)

do
	local src_buf = sockaddr_ct()
	local src_buf_len = sizeof(src_buf)
	local src_len_buf = new'int[1]'

	local udp_recvnext = _make_async('r', true, function(self, buf, len, flags)
		src_len_buf[0] = src_buf_len
		return C.recvfrom(self.fd, buf, len, flags or 0, src_buf, src_len_buf)
	end)

	function udp:try_recvnext(buf, len, flags)
		if self.fd == -1 then return nil, 'closed' end
		assert(len > 0)
		local len, err = udp_recvnext(self, buf, len, flags)
		if not len then return nil, err end
		assert(src_len_buf[0] <= src_buf_len) --not truncated
		return len, src_buf
	end
end
udp.recvnext = unprotect_io(udp.try_recvnext)

--shutdown() -----------------------------------------------------------------

cdef[[
int shutdown(SOCKET s, int how);
]]

function tcp:try_shutdown(which)
	if self.fd == -1 then return nil, 'closed' end
	return try_errno(C.shutdown(self.fd,
		   which == 'r' and 0
		or which == 'w' and 1
		or (not which or which == 'rw') and 2) == 0)
end
tcp.shutdown = unprotect_io(tcp.try_shutdown)

--bind() ---------------------------------------------------------------------

cdef[[
int bind(SOCKET s, const sockaddr*, int namelen);
]]

function socket:try_bind(addr, port)
	if self._bound_addr then return nil, 'already_bound' end
	addr = addr or
		self.family == 'ip'  and '0.0.0.0:'..(port or 0) or
		self.family == 'ip6' and '[::]:'..(port or 0)
		or nil
	local sa, err = try_sockaddr(addr, port)
	if not sa then return nil, err end
	local ok, err = try_errno(C.bind(self.fd, sa, sa:size()) == 0)
	if not ok then return false, err end
	self._bound_addr = sa
	_epoll_add(self, self.fd)
	return true
end
socket.bind = unprotect_io(socket.try_bind)

function socket:bound_addr()
	local sa = self._bound_addr
	if not sa then
		sa = sockaddr_ct()
		local nbuf = new('int[1]', sizeof(sa))
		self:check_io(try_errno(C.getsockname(self.fd, sa, nbuf) == 0))
		self._bound_addr = sa
	end
	return sa
end

--listen() -------------------------------------------------------------------

cdef[[
int listen(SOCKET s, int backlog);
]]

function tcp:try_listen(addr, port, backlog, onaccept)
	if self._bound_addr then return nil, 'already_bound' end
	local sa, err = try_sockaddr(addr, port)
	if not sa then return nil, err end
	log('', 'sock', 'listen?', '%-4s %s', self, sa:tostring())
	local ok, err = self:try_bind(sa)
	if not ok then return nil, err end
	backlog = clamp(backlog or 1/0, 0, 0x7fffffff)
	local ok = C.listen(self.fd, backlog) == 0
	if not ok then return try_errno() end
	liveadd(self, 'listen=%s', self._bound_addr)
	self._sockets = {} --live client connections: {socket->true}
	self._sockets_n = 0 --live client connection count

	if onaccept then
		repeat
			local ctcp, err = self:try_accept()
			if not ctcp then
				if not self:closed() then
					--transient error. let it retry but pause a little
					--to avoid killing the CPU while the error persists.
					wait(.2)
				end
			else
				resume(thread(function()
					local ok, err = pcall(onaccept, self, ctcp)
					ctcp:close()
					ctcp:checkp(ok or iserror(err, 'io'), '%s', err)
				end, 'accept %s %s', self, ctcp))
			end
		until self:closed()
	end

	return self
end
tcp.listen = unprotect_io(tcp.try_listen)

do --getopt() & setopt() -----------------------------------------------------

local buf = new[[
	union {
		char     c[8];
		uint32_t u;
		uint16_t u16;
		int32_t  i;
		struct { int onoff; int linger; } linger;
	}
]]

local function get_bool   (buf) return buf.u == 1 end
local function get_int    (buf) return buf.i end
local function get_uint   (buf) return buf.u end
local function get_uint16 (buf) return buf.u16 end

local function get_error(buf)
	if buf.i == 0 then return nil end
	local _, s = try_errno(nil, buf.i)
	return s
end

local function set_bool(v) --BOOL aka DWORD
	buf.u = v and 1 or 0
	return buf.c, 4
end

local function set_int(v)
	buf.i = v
	return buf.c, 4
end

local function set_uint(v)
	buf.u = v
	return buf.c, 4
end

local function set_uint16(v)
	buf.u16 = v
	return buf.c, 2
end

local function set_str(v)
	return v, #v
end

local function get_linger()
	return buf.linger.onoff ~= 0 and buf.linger.linger or false
end
local function set_linger(v)
	buf.linger.onoff  = v and 1 or 0
	buf.linger.linger = isnum(v) and v or 0
	return buf.c, 8
end

local SOL_SOCKET  = 1

local OPT = {
	--SOL_SOCKET options (so_ prefix)l
	so_reuseaddr      = 2,  --allow local address reuse
	so_type           = 3,  --get socket type (RO)
	so_error          = 4,  --get and clear pending error (RO)
	so_broadcast      = 6,  --allow sending broadcast datagrams
	so_sndbuf         = 7,  --send buffer size
	so_rcvbuf         = 8,  --receive buffer size
	so_keepalive      = 9,  --enable keep-alive probes
	so_priority       = 12, --set packet priority
	so_linger         = 13, --linger on close if data is present
	so_reuseport      = 15, --allow multiple sockets to bind to same port
	so_bindtodevice   = 25, --bind to a specific network interface
	so_acceptconn     = 30, --is socket listening (RO)
	so_protocol       = 38, --get socket protocol (RO)
	so_domain         = 39, --get socket domain/family (RO)
	--IPPROTO_TCP options (tcp_ prefix)
	tcp_nodelay       =  1, --disable Nagle's algorithm
	tcp_maxseg        =  2, --max segment size
	tcp_cork          =  3, --cork output (accumulate before sending)
	tcp_keepidle      =  4, --idle time before keepalive probes (seconds)
	tcp_keepintvl     =  5, --time between keepalive probes (seconds)
	tcp_keepcnt       =  6, --max keepalive probes before drop
	tcp_defer_accept  =  9, --wake listener only when data arrives (seconds)
	tcp_quickack      = 12, --enable quickack mode
	tcp_user_timeout  = 18, --max time for unacked data (ms)
	tcp_fastopen      = 23, --max pending TFO SYNs on listener
	tcp_fastopen_connect = 30, --defer connect until data is sent
	--IPPROTO_IP options (ip_ prefix)
	ip_tos            =  1, --type-of-service byte
	ip_ttl            =  2, --time-to-live
	ip_multicast_ttl  = 33, --multicast TTL
	ip_multicast_loop = 34, --multicast loopback
	ip_freebind       = 15, --bind to nonlocal address
	--IPPROTO_IPV6 options (ipv6_ prefix)
	ipv6_v6only       = 26, --restrict to IPv6 only
	--IPPROTO_UDP options (udp_ prefix)
	udp_cork          =  1, --cork output (accumulate datagrams)
}

local get_opt = {
	--SOL_SOCKET
	so_reuseaddr      = get_bool,
	so_type           = get_int,
	so_error          = get_error,
	so_broadcast      = get_bool,
	so_sndbuf         = get_uint,
	so_rcvbuf         = get_uint,
	so_keepalive      = get_bool,
	so_priority       = get_int,
	so_linger         = get_linger,
	so_reuseport      = get_bool,
	so_acceptconn     = get_bool,
	so_protocol       = get_int,
	so_domain         = get_int,
	--IPPROTO_TCP
	tcp_nodelay       = get_bool,
	tcp_maxseg        = get_int,
	tcp_cork          = get_bool,
	tcp_keepidle      = get_int,
	tcp_keepintvl     = get_int,
	tcp_keepcnt       = get_int,
	tcp_defer_accept  = get_int,
	tcp_quickack      = get_bool,
	tcp_user_timeout  = get_uint,
	tcp_fastopen      = get_int,
	tcp_fastopen_connect = get_bool,
	--IPPROTO_IP
	ip_tos            = get_int,
	ip_ttl            = get_int,
	ip_multicast_ttl  = get_int,
	ip_multicast_loop = get_bool,
	ip_freebind       = get_bool,
	--IPPROTO_IPV6
	ipv6_v6only       = get_bool,
	--IPPROTO_UDP
	udp_cork          = get_bool,
}

local set_opt = {
	--SOL_SOCKET
	so_reuseaddr      = set_bool,
	so_broadcast      = set_bool,
	so_sndbuf         = set_uint,
	so_rcvbuf         = set_uint,
	so_keepalive      = set_bool,
	so_priority       = set_int,
	so_linger         = set_linger,
	so_reuseport      = set_bool,
	so_bindtodevice   = set_str,
	--IPPROTO_TCP
	tcp_nodelay       = set_bool,
	tcp_maxseg        = set_int,
	tcp_cork          = set_bool,
	tcp_keepidle      = set_int,
	tcp_keepintvl     = set_int,
	tcp_keepcnt       = set_int,
	tcp_defer_accept  = set_int,
	tcp_quickack      = set_bool,
	tcp_user_timeout  = set_uint,
	tcp_fastopen      = set_int,
	tcp_fastopen_connect = set_bool,
	--IPPROTO_IP
	ip_tos            = set_int,
	ip_ttl            = set_int,
	ip_multicast_ttl  = set_int,
	ip_multicast_loop = set_bool,
	ip_freebind       = set_bool,
	--IPPROTO_IPV6
	ipv6_v6only       = set_bool,
	--IPPROTO_UDP
	udp_cork          = set_bool,
}

local opt_levels = {
	so_   = SOL_SOCKET,
	tcp_  = IPPROTO_TCP,
	ip_   = IPPROTO_IP,
	ipv6_ = IPPROTO_IPV6,
	udp_  = IPPROTO_UDP,
}
local function parse_opt(k)
	local opt = assertf(OPT[k], 'invalid socket option: %s', k)
	for prefix, proto in pairs(opt_levels) do
		if k:find(prefix, 1, true) == 1 then
			return opt, proto
		end
	end
	assertf(false, 'invalid socket option prefix: %s', k)
end

local szbuf = i32a(1, 4)
function socket:try_getopt(k)
	local opt, level = parse_opt(k)
	local get = assertf(get_opt[k], 'write-only socket option: %s', k)
	local ok, err = try_errno(C.getsockopt(self.fd, level, opt, buf.c, szbuf) == 0)
	if not ok then return nil, err end
	return get(buf, szbuf[0])
end
function socket:getopt(k) --can't wrap with unprotect_io because it returns false
	local v, err = self:try_getopt(k)
	self:check_io(not (v == nil and err), err)
	return v
end

function socket:try_setopt(k, v)
	local opt, level = parse_opt(k)
	local set = assertf(set_opt[k], 'read-only socket option: %s', k)
	local buf, sz = set(v)
	return try_errno(C.setsockopt(self.fd, level, opt, buf, sz) == 0)
end
socket.setopt = unprotect_io(socket.try_setopt)

end --getopt/setopt decl. scope

--tcp repeat I/O -------------------------------------------------------------

--NOTE: to read many small pieces use a pbuffer instead, this will crawl!
function tcp:try_recvn(buf, sz)
	local sz0 = sz
	local buf = cast(u8p, buf)
	while sz > 0 do
		local len, err = self:try_recv(buf, sz)
		if not len or err == 'eof' then --short read
			return nil, err, sz0 - sz
		end
		buf = buf + len
		sz  = sz  - len
	end
	return true
end
tcp.recvn = unprotect_io(tcp.try_recvn)
tcp.try_readn = tcp.try_recvn
tcp.readn = tcp.recvn

function tcp:try_recvall(max_size)
	max_size = max_size or 64 * 1024^2 --arbitrary, adjust to use case.
	local readahead_size = 16 * 1024
	local b = string_buffer(readahead_size)
	while true do
		local buf, sz = b:reserve(readahead_size)
		local len, err = self:try_recv(buf, sz)
		if not len then return nil, err, b:ref() end
		if err == 'eof' then return b:ref() end
		b:commit(len)
		if #b > max_size then return nil, 'max_size' end
	end
end
tcp.recvall = unprotect_io(tcp.try_recvall)

--debug API ------------------------------------------------------------------

function socket:debug_stream(protocol_name)

	local function ds(event, s)
		log('', protocol_name or 'sock', event, '%-4s %5s %s',
			self, s and #s or '', s or '')
	end

	override(self, 'try_recv', function(inherited, self, buf, ...)
		local sz, err = inherited(self, buf, ...)
		if not err then ds('<', str(buf, sz)); return sz end
		return sz, err
	end)
	self.recv = unprotect_io(self.try_recv)
	self.try_read = self.try_recv
	self.read = self.recv

	override(self, 'try_send', function(inherited, self, buf, sz, ...)
		local ok, err = inherited(self, buf, sz, ...)
		if not ok then return nil, err end
		ds('>', str(buf, sz or #buf))
		return ok
	end)
	self.send = unprotect_io(self.try_send)
	self.try_write = self.try_send
	self.write = self.send

	override(self, 'try_close', function(inherited, self, ...)
		local ok, err = inherited(self, ...)
		if not ok then return nil, err  end
		ds('CC')
		return ok
	end)

end

--hi-level APIs --------------------------------------------------------------

function try_connect(addr, port, timeout, client_ip)
	local sas, err = try_sockaddrs(addr, port, timeout)
	if not sas then return nil, err end
	local sa = sas[1]
	if #sas > 1 then
		--TODO: implement Happy Eyeballs algorithm.
	end
	local self = create_tcp(sa:family())
	self:settimeout(timeout)
	if client_ip then
		local ok, err = self:try_bind(client_ip)
		if not ok then
			self:try_close()
			return nil, err
		end
	end
	local ok, err = self:try_connect(sa)
	if not ok then
		self:try_close()
		return nil, err
	end
	self:settimeout(nil)
	return self
end
function connect(...)
	return check_io(nil, try_connect(...))
end

function listen(addr, port, backlog, onaccept)
	local sa = sockaddr(addr, port)
	local self = create_tcp(sa:family())
	if sa:family() == 'unix' then
		--remove the socket file to emulate reuseaddr.
		local socket_path = sa:tostring()
		if file_is(socket_path, 'socket') then
			try_rmfile(socket_path)
		end
	else
		self:setopt('so_reuseaddr', true)
	end
	return self:listen(sa, backlog, onaccept)
end

--wrap-up --------------------------------------------------------------------

update(tcp, socket)
update(udp, socket)

udp_class = udp
tcp_class = tcp

_G.socket = create_socket
_G.tcp    = create_tcp
_G.udp    = create_udp
