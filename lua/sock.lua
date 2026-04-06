--[=[

	Async sockets and coroutine scheduler (epoll-based).
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
	issocket(s) -> t|f                     check if s is a socket
	s:[try_]close()                        close connection and free socket
	s:closed() -> t|f                      check if the socket is closed
	s:onclose(fn)                          exec fn after the socket is closed
	s:[try_]bind(addr, [port])             bind socket to an address
	s:bound_addr() -> sa                   get bound sockaddr
	s:[try_]setopt(opt, val)               set socket option ('so_*', 'tcp_*', etc.)
	s:[try_]getopt(opt) -> val             get socket option
	s:debug_stream([protocol_name])        log recv/send data
	s:cancel[_recv|_send]()                cancel currently waiting I/O ops
TCP
	tcp([family='ip'], [opt]) -> tcp                     make a SOCK_STREAM socket
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
THREADS
	thread(func[, fmt, ...]) -> co         create a coroutine for async I/O
	resume(thread, ...)                    resume thread
	yield(...) -> ...                      safe yield (see coro.lua)
	suspend() -> ...                       suspend thread
	cowrap(f) -> wrapper                   see coro.safewrap()
	currentthread() -> co, is_main         current coroutine and whether it's the main one
	threadstatus(co) -> s                  coroutine.status()
	transfer(co, ...) -> ...               see coro.transfer()
	cofinish(co, ...) -> ...               see coro.finish()
	threadenv([co]) -> t                   get (current) thread's own environment
	ownthreadenv([co], [create]) -> t      get/create (current) thread's own environment
	onthreadfinish(co, f)                  run f(thread) when thread finishes
SCHEDULER
	poll([ignore_interrupts])              poll for I/O
	start([ignore_interrupts])             keep polling until all threads finish
	stop()                                 stop polling
	run(f, ...) -> ...                     run a function inside a thread
WAIT JOBS
	wait_job() -> sj            make an interruptible async wait job
	sj:wait_until(t) -> ...     wait until clock()
	sj:wait(s) -> ...           wait for s seconds
	sj:resume(...)              resume the waiting thread
	sj:cancel()                 calls sj:resume(CANCEL)
	wait_until(t) -> ...        wait until clock() value
	wait(s) -> ...              wait for s seconds
	s:wait_job() -> sj          wait job that is auto-canceled on socket close
	s:wait_until(t) -> ...      wait_until() on auto-canceled wait job
	s:wait(s) -> ...            wait() on auto-canceled wait job
TIMERS
	timer(f, [name]) -> tm      create a timer that runs f
	tm:setexpires(t)            run f at clock t
	tm:settimeout(s)            run f after s seconds
	tm:setinterval(s)           run f every s seconds
	tm:cancel()                 remove timer from queue (can be added back)
	tm:run()                    run f now
	runat(t, f) -> sj           run f at clock t
	runafter(s, f) -> sj        run f after s seconds
	runevery(s, f) -> sj        run f every s seconds
	runagainevery(s, f) -> sj   run f now and every s seconds afterwards
THREAD SETS
	threadset() -> ts
	  ts:thread(f, [fmt, ...]) -> co
	  ts:join() -> {{ok=,ret=,thread=},...}
MULTI-THREADING (WITH OS THREADS)
	epoll_fd([epfd]) -> epfd    get/set epoll fd

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

SCHEDULING -------------------------------------------------------------------

	Scheduling is based on synchronous coroutines provided by coro.lua which
	allows coroutine-based iterators that perform socket I/O to be written.

thread(func[, fmt, ...]) -> co

	Create a coroutine for performing async I/O. The coroutine must be resumed
	to start. When the coroutine finishes, the control is transfered to
	the I/O thread (the thread that called start()).

	Full-duplex I/O on a socket can be achieved by performing reads in one thread
	and writes in another.

resume(thread, ...)

	Resume a thread, which means transfer control to it, but also temporarily
	change the I/O thread to be this thread so that the first suspending call
	(send, recv, wait, suspend, etc.) gives control back to this thread.
	_This_ is the trick to starting multiple threads before starting polling.

suspend() -> ...

	Suspend current thread, transfering to the polling thread (but see resume()).

poll([ignore_interrupts]) -> true | false,'empty'

	Poll for the next I/O event and resume the coroutine that waits for it.

start([ignore_interrupts])

	Start polling. Stops when no more I/O or stop() was called.

stop()

	Tell the loop to stop dequeuing and return.

TIMERS -----------------------------------------------------------------------

wait_until(t)

	Wait until a clock() value without blocking other threads.

wait(s) -> ...

	Wait s seconds without blocking other threads.

wait_job() -> sj

	Make an interruptible waiting job. Put the current thread to sleep using
	sj:wait() or sj:wait_until() and then from another thread call
	sj:resume() to resume the waiting thread. Any arguments passed to
	sj:resume() will be returned by sj:wait().

MULTI-THREADING --------------------------------------------------------------

epoll_fd([epfd]) -> epfd

	Get/set the global epoll fd.

	Epoll fds can be shared between OS threads and having a single epfd for all
	threads is more efficient for the kernel than having one epfd per thread.

	To share the epfd with another Lua state running on a different thread,
	get the epfd with epoll_fd(), copy it over to the other state,
	then set it with epoll_fd(copied_epfd).

]=]

if not ... then require'sock_test'; return end

require'glue'
require'heap'
require'ipv6'
local coro = require'coro'
coro.live  = live
coro.pcall = pcall

assert(Linux, 'platform not Linux')

local
	assert, isstr, clock, max, abs, min, errno =
	assert, isstr, clock, max, abs, min, errno
local
	band, bor, shr, cast, u8p, fill, str =
	band, bor, shr, cast, u8p, fill, str

local coro_create   = coro.create
local coro_safewrap = coro.safewrap
local coro_transfer = coro.transfer
local coro_finish   = coro.finish

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

metatype('struct sockaddr', {__index = sa})

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
	return object(class, {
		fd = assert(fd), family = family, issocket = true,
		r = 0, w = 0,
	}, opt)
end
local function create_socket(st, family, class, opt)
	local af =
		family == 'ip'   and AF_INET  or
		family == 'ip6'  and AF_INET6 or
		family == 'unix' and AF_UNIX  or
		assert(false)
	local fd = C.socket(af, bor(st, SOCK_NONBLOCK, SOCK_CLOEXEC), 0)
	assert(check_errno(fd ~= -1))
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
function socket:try_close()
	if not self.fd then return true end
	epoll_remove(self)
	local fd = self.fd; self.fd = nil --make closed() true.
	--NOTE: it is unsafe to close a socket twice no matter the error.
	local ok, err = check_errno(C.close(fd) == 0)
	self:cancel('closed')
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
	if self._after_close then
		self:_after_close()
	end
	live(self, nil, 'r:%d w:%d%s', self.r, self.w,
		self._sockets and ' clients:'..self._sockets_n or '')
	if not ok then return false, err end
	return true
end
socket.close = unprotect_io(socket.try_close)

function socket:closed()
	return not self.fd
end

function socket:onclose(fn)
	after(self, '_after_close', fn)
end

--epoll ----------------------------------------------------------------------

cdef[[
typedef union epoll_data {
	void *ptr;
	int fd;
	uint32_t u32;
	uint64_t u64;
} epoll_data_t;

struct epoll_event {
	uint32_t events;
	epoll_data_t data;
} __attribute__((packed));

int epoll_create1(int flags);
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event);
int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout);
]]

local EPOLLIN    = 0x0001
local EPOLLOUT   = 0x0004
local EPOLLERR   = 0x0008
local EPOLLHUP   = 0x0010
local EPOLLRDHUP = 0x2000
local EPOLLET    = 2^31

local EPOLL_CTL_ADD = 1
local EPOLL_CTL_DEL = 2

local EPOLL_CLOEXEC = 0x80000

local _epoll_fd
function epoll_fd(shared_epoll_fd, flags)
	if shared_epoll_fd then
		_epoll_fd = shared_epoll_fd
	elseif not _epoll_fd then
		flags = flags or EPOLL_CLOEXEC
		_epoll_fd = C.epoll_create1(flags)
		assert(check_errno(_epoll_fd >= 0))
	end
	return _epoll_fd
end

local epolled = {} --{epollable_object1, ...}
local free_slots = {} --{i1, ...}; indexes of free slots in epolled array.

local epoll_ev = new'struct epoll_event'

--o is an epollable object (socket, file, etc.), with fields:
--		fd, _i, send_expires, recv_expires, send_thread, recv_thread.
function epoll_add(eo)
	local i = pop(free_slots) or #epolled + 1
	epoll_ev.data.u32 = i
	epoll_ev.events = EPOLLIN + EPOLLOUT + EPOLLET
	local ok, err = check_errno(C.epoll_ctl(epoll_fd(), EPOLL_CTL_ADD, eo.fd, epoll_ev) == 0)
	if not ok then
		push(free_slots, i)
		return nil, err
	end
	eo._i = i
	epolled[i] = eo
	--TODO: this is hacky, and only non-sockets need it.
	eo.setexpires = socket.setexpires
	eo.settimeout = socket.settimeout
	eo.cancel_recv = socket.cancel_recv
	eo.cancel_send = socket.cancel_send
	eo.cancel = socket.cancel
	return true
end

function epoll_remove(eo)
	local i = eo._i
	if not i then return end --epoll_add() was not called on this object.
	epoll_ev.data.u32 = i
	epoll_ev.events = EPOLLIN + EPOLLOUT + EPOLLET
	assert(check_errno(C.epoll_ctl(epoll_fd(), EPOLL_CTL_DEL, eo.fd, epoll_ev) == 0))
	epolled[i] = false
	push(free_slots, i)
end

function socket:setexpires(expires, rw)
	local r = rw == 'r' or not rw
	local w = rw == 'w' or not rw
	if r then self.recv_expires = expires end
	if w then self.send_expires = expires end
end
function socket:settimeout(s, rw)
	self:setexpires(s and clock() + s, rw)
end

--used for EPOLLIN events but also for wait jobs and timers.
local recv_expires_heap = heap{
	cmp = function(s1, s2)
		return s1.recv_expires < s2.recv_expires
	end,
	index_key = 'recv_heap_index', --enable O(log n) removal.
}

--used for EPOLLOUT events only. we use two heaps for full-duplex send/recv.
local send_expires_heap = heap{
	cmp = function(s1, s2)
		return s1.send_expires < s2.send_expires
	end,
	index_key = 'send_heap_index', --enable O(log n) removal.
}

local function wake(eo, for_writing, has_err)
	local thread
	if for_writing then
		thread = eo.send_thread
	else
		thread = eo.recv_thread
	end
	if not thread then --misfire or bug
		return
	end
	if for_writing then
		if eo.send_expires then
			assert(send_expires_heap:remove(eo))
		end
		eo.send_thread = nil
	else
		if eo.recv_expires then
			assert(recv_expires_heap:remove(eo))
		end
		eo.recv_thread = nil
	end
	if has_err then
		local err = issocket(eo) and eo:try_getopt'so_error' --NOTE: this clears the error!
		coro_transfer(thread, nil, err or 'error')
	else
		coro_transfer(thread, true)
	end
end

local function check_heap(heap, EXPIRES, THREAD, t)
	while true do
		local xo = heap:peek() --xo = expirable object: epollable, wait_job, timer.
		if not xo then break end --heap is empty
		if xo[EXPIRES] - t > 0.01 then break end --not expired, and neither is the rest.
		--^^ the threshold of 0.01 assumes that the current loop will take more
		--than 20ms to complete, so might as well expire some jobs now
		--because the next loop might just be a bit too late for them.
		xo[EXPIRES] = nil
		local thread = xo[THREAD] --thread (epollable, wait_job) or timer function.
		if isthread(thread) then --epollable, wait_job
			xo[THREAD] = nil
			assert(heap:pop())
			coro_transfer(thread, nil, 'timeout')
		else --timer: run it, which removes it from the heap or moves it (if repeating).
			xo:run()
		end
	end
end

local maxevents = 64 --arbitrary default to minimize syscalls.
local events = new('struct epoll_event[?]', maxevents)
local RECV_MASK = EPOLLIN  + EPOLLERR + EPOLLHUP + EPOLLRDHUP
local SEND_MASK = EPOLLOUT + EPOLLERR + EPOLLHUP + EPOLLRDHUP

local function epoll_wait()
	local ss = send_expires_heap:peek()
	local rs = recv_expires_heap:peek()
	local sx = ss and ss.send_expires
	local rx = rs and rs.recv_expires
	local expires = min(sx or 1/0, rx or 1/0)
	local timeout = expires < 1/0 and max(0, expires - clock()) or 1/0

	local timeout_ms = max(timeout * 1000, 0)
	if timeout_ms > 0x7fffffff then timeout_ms = -1 end --infinite

	local n = C.epoll_wait(epoll_fd(), events, maxevents, timeout_ms)
	if n == -1 then return check_errno() end
	--handle ready ops.
	for i = 0, n-1 do
		local ev = events[i].events
		local si = events[i].data.u32
		local eo = epolled[si]
		--When EPOLL{HUP|RDHUP|ERR} arrives, we need to wake up all waiting
		--threads because EPOLL{IN|OUT} might never follow, which is why
		--we check {RECV|SEND}_MASK instead of EPOLL{IN|OUT} alone.
		local has_err = band(ev, EPOLLERR) ~= 0
		if band(ev, RECV_MASK) ~= 0 then wake(eo, false, has_err) end
		if band(ev, SEND_MASK) ~= 0 then wake(eo, true , has_err) end
	end
	--handle timed-out ops.
	local t = clock()
	check_heap(send_expires_heap, 'send_expires', 'send_thread', t)
	check_heap(recv_expires_heap, 'recv_expires', 'recv_thread', t)
	return true
end

--coroutine-based scheduler --------------------------------------------------

local weak_keys = {__mode = 'k'}

local poll_thread

local wait_count = 0
local waiting = setmetatable({}, weak_keys) --{thread -> true}

local function wait_io_cont(thread, ...)
	wait_count = wait_count - 1
	waiting[thread] = nil
	return ...
end
local function wait_io(job)
	local thread, is_main = currentthread()
	assert(poll_thread, 'poll loop not started')
	assert(not is_main, 'trying to perform I/O from the main thread')
	wait_count = wait_count + 1
	waiting[thread] = job or true
	return wait_io_cont(thread, coro_transfer(poll_thread))
end

--closing an epollable doesn't trigger an epoll event, instead the fd is
--silently removed from the epoll list, thus we have to wake up any waiting
--threads manually when the epollable is closed from another thread.
function socket:cancel_recv(reason)
	local thread = self.recv_thread
	if not thread then return end
	waiting[thread] = nil
	self.recv_thread = nil
	if self.recv_expires then
		recv_expires_heap:remove(self)
		self.recv_expires = nil
	end
	resume(thread, nil, reason or 'canceled')
end
function socket:cancel_send(reason)
	local thread = self.send_thread
	if not thread then return end
	waiting[thread] = nil
	self.send_thread = nil
	if self.send_expires then
		send_expires_heap:remove(self)
		self.send_expires = nil
	end
	resume(thread, nil, reason or 'canceled')
end
function socket:cancel(reason)
	self:cancel_recv(reason)
	self:cancel_send(reason)
end
epoll_cancel = socket.cancel

local term_sig_f

function poll(ignore_interrupts)
	if wait_count == 0 then
		return nil, 'empty'
	elseif wait_count == 1 and term_sig_f then --nobody left to kill this guy
		return nil, 'empty'
	end
	local ok, err = epoll_wait()
	if ok then return true end
	if err == 'interrupted' then
		log('note', 'sock', 'poll', 'interrupted: %s.',
			ignore_interrupts and 'ignoring' or 'breaking')
		if ignore_interrupts then
			return true, err
		end
	end
	return false, err
end

local function make_async(for_writing, returns_n, func, wait_errno)
	local heap = for_writing and send_expires_heap or recv_expires_heap
	local EXPIRES = for_writing and 'send_expires' or 'recv_expires'
	local THREAD = for_writing and 'send_thread' or 'recv_thread'
	local RW = for_writing and 'w' or 'r'
	return function(self, ...)
		::again::
		local ret = func(self, ...)
		if ret >= 0 then
			if returns_n then
				self[RW] = self[RW] + ret
			end
			return ret
		end
		local errno = errno()
		if errno == wait_errno then
			if self[EXPIRES] then
				heap:push(self)
			end
			self[THREAD] = currentthread()
			local ok, err = wait_io()
			if not ok then
				return nil, err
			else
				goto again
			end
		else
			local ok, err = check_errno(nil, errno)
			return ok, err, errno
		end
	end
end

local threadfinish = setmetatable({}, weak_keys)
function onthreadfinish(thread, f)
	after(threadfinish, thread, f)
end

currentthread = coro.running
threadstatus = coro.status
cofinish = coro.finish

--NOTE: NOT weak-keyed! LuaJIT has no ephemerons, so if a value in a weak-key
--table transitively references its key, the entry is never collected.
--User code routinely stores back-refs (e.g. ownthreadenv().req.thread = thread).
--Explicit cleanup in thread_onfinish avoids the problem entirely.
local threadenvs    = {}
local ownthreadenvs = {}

function threadenv(thread)
	return threadenvs[thread or currentthread()]
end

function ownthreadenv(thread, create)
	thread = thread or currentthread()
	local t = ownthreadenvs[thread]
	if not t and create ~= false then
		t = {}
		local pt = threadenvs[thread]
		if pt then --inherit parent env, if any.
			t.__index = pt
			setmetatable(t, t)
		end
		ownthreadenvs[thread] = t
		threadenvs[thread] = t
	end
	return t
end

local function thread_onfinish(thread, ok, ...)
	local finish = threadfinish[thread]
	if finish then
		finish(thread, ok, ...)
	end
	threadenvs[thread] = nil
	ownthreadenvs[thread] = nil
	--poll threads don't have a caller thread to re-raise their errors into,
	--and we don't want them to break the main thread either as coro thereads
	--do by default, so errors are just logged and the thread finishes in the
	--current poll_thread (which is the caller thread when using resume()).
	if not ok then
		log('ERROR', 'sock', 'thread', '%s', ...)
	end
	return true, coro_finish(poll_thread)
end
function thread(f, ...)
	local thread = coro_create(f, thread_onfinish, ...)
	threadenvs[thread] = threadenvs[currentthread()] --inherit threadenv.
	return thread
end

local function cowrap_onfinish(thread, ok, ...)
	local finish = threadfinish[thread]
	if finish then
		finish(thread, ok, ...)
	end
	--cowrap threads re-raise their errors in their caller thread (they always
	--have one) so no need to log them. finalizers are still available for them.
	return ok, ...
end
function cowrap(f, ...)
	local wrapped, thread = coro_safewrap(f, cowrap_onfinish, ...)
	threadenvs[thread] = threadenvs[currentthread()] --inherit threadenv.
	return wrapped, thread
end

function transfer(thread, ...)
	assert(not waiting[thread], 'attempt to resume a waiting thread')
	return coro_transfer(thread, ...)
end

function suspend()
	assert(poll_thread, 'poll loop not started')
	return coro_transfer(poll_thread)
end

function resume(thread, ...)
	assert(not waiting[thread], 'attempt to resume a waiting thread')
	local real_poll_thread = poll_thread
	--change poll_thread temporarily so that we get back here
	--from the first call to suspend() or wait_io().
	poll_thread = currentthread()
	coro_transfer(thread, ...)
	poll_thread = real_poll_thread
end

yield = coro.yield

local function rets_tostring(rets)
	local t = {}
	for i,ret in ipairs(rets) do
		local args = concat(imap(ret, logarg), ', ')
		t[i] = logarg(ret.thread) .. ': '..args
	end
	return concat(t, '\n')
end
local rets_mt = {__tostring = rets_tostring}

function threadset()
	local ts = {}
	local n = 0
	local all_ok = true
	local rets = {}
	setmetatable(rets, rets_mt)
	local wait_thread = currentthread()
	local function pass(ret, ok, ...)
		local n = select('#',...)
		for i=1,n do
			ret[i] = select(i,...)
		end
		ret.ok = ok
		ret.n = n
		rets[#rets+1] = ret
		if not ok then all_ok = false end
	end
	function ts:thread(f, ...)
		return thread(function(...)
			n = n + 1
			local ret = {thread = currentthread()}
			pass(ret, pcall(f, ...))
			n = n - 1
			if n == 0 then
				transfer(wait_thread)
			end
		end, ...)
	end
	function ts:join()
		if n ~= 0 then
			wait_thread = currentthread()
			suspend()
		end
		return all_ok, rets
	end
	return ts
end

local _stop = false
local _running = false

function stop()
	_stop = true
	if term_sig_f then
		term_sig_f:close()
		term_sig_f = nil
	end
end

function try_start(ignore_interrupts)
	if _running then
		return
	end

	require'signal'

	--NOTE: not creating the signal-catching thread if there are no waiting I/O
	--threads otherwise there will not be no opportunity to ever close it.
	if wait_count > 0 then
		--signals thread to stop loop on SIGINT (Ctrl+C) and SIGTERM (kill) events.
		term_sig_f = on_signal('SIGINT SIGTERM', function()
			stop()
			return 'stop'
		end)
	end

	poll_thread = currentthread()
	_running = true
	local ret, err = true
	repeat
		ret, err = poll(ignore_interrupts)
		if not ret then
			stop()
			if err == 'interrupted' then
				ret = true
				break
			elseif err ~= 'empty' then
				break
			else
				ret, err = true
			end
		end
	until _stop
	_running = false
	_stop = false
	return ret, err
end
function start(...)
	assert(try_start(...))
end

function run(f, ...)
	if _running then
		return f(...)
	else
		local ret
		local function wrapper(...)
			ret = pack(f(...))
		end
		resume(thread(wrapper, 'sock-run'), ...)
		start()
		return ret and unpack(ret)
	end
end

--wait jobs ------------------------------------------------------------------

local wj = {
	type = 'wait_job',
	debug_prefix = 'W',
}
function wait_job()
	local self = object(wj)
	--log('', 'sock', 'wait-job', '%s', self)
	return self
end
function wj:wait_until(expires)
	self.recv_thread = currentthread()
	self.recv_expires = expires
	recv_expires_heap:push(self)
	return wait_io(self)
end
function wj:wait(timeout)
	return self:wait_until(clock() + timeout)
end
function wj:resume(...)
	local thread = self.recv_thread
	assert(waiting[thread] == self, 'thread not waiting (on this wait job)')
	assert(recv_expires_heap:remove(self))
	waiting[thread] = nil --can't resume() a waiting thread
	resume(thread, ...) --to wait_io_cont()
	return true
end
function wj:cancel()
	if not self.recv_thread then return end
	self:resume(CANCEL)
end
function wait_until(expires)
	return wait_job():wait_until(expires)
end
function wait(timeout)
	return wait_job():wait(timeout)
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

--lightweight timers that run in the main thread -----------------------------

local tm = {type = 'timer', debug_prefix = 'R'}
function timer(f, name)
	if name == 'debug' then
		local i = debug.getinfo(f, 'nS')
		name = _('%s (%s:%s)', i.name or '?', i.short_src, i.linedefined)
	end
	return object(tm, {
		recv_thread = assert(f),
		name = name,
		recv_heap_index = -1,
	})
end
function tm:cancel()
	if self.recv_heap_index == -1 then return end
	assert(recv_expires_heap:remove(self))
	return self
end
function tm:setexpires(expires)
	self.recv_expires = expires
	if self.recv_heap_index ~= -1 then
		recv_expires_heap:replace(self.recv_heap_index, self)
	else
		recv_expires_heap:push(self)
	end
	return self
end
function tm:settimeout(timeout)
	self:setexpires(clock() + timeout)
	return self
end
function tm:setinterval(interval)
	--avoid infinite loop in check_heap().
	assertf(interval >= 0.02, 'timer interval too short: %.2f', interval)
	self.interval = interval
	self:settimeout(interval)
	return self
end
function tm:run()
	local ok, err = pcall(self.recv_thread)
	if not ok then --nowhere to raise errors to, so we just log them.
		log('ERROR', 'sock', 'timer', '%s%s', err, catall('\n', self.name) or '')
	end
	if self.interval and err ~= CANCEL then
		self:settimeout(self.interval)
	else
		self:cancel()
	end
end
function runat(expires, f, name)
	return timer(f, name):setexpires(expires)
end
function runafter(timeout, f, name)
	return timer(f, name):settimeout(timeout)
end
function runevery(interval, f, name)
	return timer(f, name):setinterval(interval)
end
function runagainevery(interval, f, name)
	local tm = timer(f, name):setinterval(interval)
	tm:run()
	return tm
end

--async sock functions -------------------------------------------------------

local EAGAIN      = 11
local EWOULDBLOCK = 11
local EINPROGRESS = 115

local socket_connect = make_async(true, false, function(self, sa)
	return C.connect(self.fd, sa, sa:size())
end, EINPROGRESS)

function tcp:try_connect(addr, port)
	if not self.fd then return nil, 'closed' end
	local resolve_timeout = self.send_expires and self.send_expires - clock()
	local sa, err = try_sockaddr(addr, port, resolve_timeout)
	if not sa then return nil, err end
	log('', 'sock', 'connect', '%-4s %s', self, sa:tostring())
	if not self._bound_addr and self.family ~= 'unix' then
		local ok, err = self:try_bind()
		if not ok then return false, err end
	end
	local ret, err = socket_connect(self, sa)
	local ok = ret == 0
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
	--see man accept(2); get error codes with `sh c/precompile errno.h`.
	local ENETDOWN      = 100
	local EPROTO        =  71
	local ENOPROTOOPT   =  92
	local EHOSTDOWN     = 112
	local ENONET        =  64
	local EHOSTUNREACH  = 113
	local EOPNOTSUPP    =  95
	local ENETUNREACH   = 101

	local nbuf = new'int[1]'
	local socket_accept = make_async(false, false, function(self, accept_sa)
		nbuf[0] = sizeof(sockaddr_ct)
		local r = C.accept4(self.fd, accept_sa, nbuf, bor(SOCK_NONBLOCK, SOCK_CLOEXEC))
		return r
	end, EWOULDBLOCK)

	function tcp:try_accept(opt, timeout)
		if not self.fd then return nil, 'closed' end
		local accept_sa = sockaddr_ct()
		local s, err, errno = socket_accept(self, accept_sa)
		local retry =
			   errno == ENETDOWN
			or errno == EPROTO
			or errno == ENOPROTOOPT
			or errno == EHOSTDOWN
			or errno == ENONET
			or errno == EHOSTUNREACH
			or errno == EOPNOTSUPP
			or errno == ENETUNREACH
		if not s then
			return nil, err, retry
		end
		local s = wrap_socket(opt, tcp, s, self.family)
		local ok, err = epoll_add(s)
		if not ok then
			s:try_close()
			return nil, err
		end
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
function socket:try_send(buf, sz, flags)
	if not self.fd then return nil, 'closed' end
	sz = sz or #buf
	if sz == 0 then return true end --mask-out null-writes
	local left = sz
	::again::
	local n = C.send(self.fd, buf, left, flags or MSG_NOSIGNAL)
	if n > 0 then
		self.w = self.w + n
		left = left - n
		if left == 0 then return true end
		if isstr(buf) then --only make pointer on the rare second pass.
			buf = cast(u8p, buf)
		end
		buf = buf + n
		goto again
	elseif n == 0 then --can't happen but just in case
		return nil, 'eof'
	else
		local errno = errno()
		if errno == EWOULDBLOCK then
			if self.send_expires then
				send_expires_heap:push(self)
			end
			self.send_thread = currentthread()
			local ok, err = wait_io()
			if not ok then
				return nil, err
			else
				goto again
			end
		else
			local ok, err = check_errno(nil, errno)
			return ok, err, errno
		end
	end
end
socket.send = unprotect_io(socket.try_send)
socket.try_write = socket.try_send
socket.write = socket.send

local socket_recv = make_async(false, true, function(self, buf, sz, flags)
	return C.recv(self.fd, buf, sz, flags or 0)
end, EWOULDBLOCK)

--NOTE: to read many small pieces, use a pbuffer instead, this will crawl!
function socket:try_recv(buf, sz, flags)
	if not self.fd then return nil, 'closed' end
	if sz == 0 then return 0 end --mask out null reads
	local n, err = socket_recv(self, buf, sz, flags)
	if not n then return nil, err end
	if n == 0 then return 0, 'eof' end
	return n
end
socket.recv = unprotect_io(socket.try_recv)
socket.try_read = socket.try_recv
socket.read = socket.recv

local udp_sendto = make_async(true, true, function(self, sa, buf, len, flags)
	return C.sendto(self.fd, buf, len, flags or 0, sa, sa:size())
end, EWOULDBLOCK)

function udp:try_sendto(addr, port, buf, len, flags)
	if not self.fd then return nil, 'closed' end
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

	local udp_recvnext = make_async(false, true, function(self, buf, len, flags)
		src_len_buf[0] = src_buf_len
		return C.recvfrom(self.fd, buf, len, flags or 0, src_buf, src_len_buf)
	end, EWOULDBLOCK)

	function udp:try_recvnext(buf, len, flags)
		if not self.fd then return nil, 'closed' end
		assert(len > 0)
		local len, err = udp_recvnext(self, buf, len, flags)
		if not len then return nil, err end
		assert(src_len_buf[0] <= src_buf_len) --not truncated
		return len, src_buf
	end
end
udp.recvnext = unprotect_io(udp.try_recvnext)

--making pipes async.

_file_async_write = make_async(true, true, function(self, buf, len)
	return tonumber(C.write(self.fd, buf, len))
end, EAGAIN)

_file_async_read = make_async(false, true, function(self, buf, len)
	return tonumber(C.read(self.fd, buf, len))
end, EAGAIN)

--shutdown() -----------------------------------------------------------------

cdef[[
int shutdown(SOCKET s, int how);
]]

function tcp:try_shutdown(which)
	if not self.fd then return nil, 'closed' end
	return check_errno(C.shutdown(self.fd,
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
	local ok, err = check_errno(C.bind(self.fd, sa, sa:size()) == 0)
	if not ok then return false, err end
	self._bound_addr = sa
	--epoll_ctl() must be called after bind() for some reason.
	return epoll_add(self)
end
socket.bind = unprotect_io(socket.try_bind)

function socket:bound_addr()
	local sa = self._bound_addr
	if not sa then
		sa = sockaddr_ct()
		local nbuf = new('int[1]', sizeof(sa))
		self:check_io(check_errno(C.getsockname(self.fd, sa, nbuf) == 0))
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
	if not ok then return check_errno() end
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
	local _, s = check_errno(nil, buf.i)
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
	local ok, err = check_errno(C.getsockopt(self.fd, level, opt, buf.c, szbuf) == 0)
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
	return check_errno(C.setsockopt(self.fd, level, opt, buf, sz) == 0)
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
