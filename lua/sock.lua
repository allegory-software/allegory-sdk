--[=[

	Portable async socket API for Windows (IOCP) and Linux (epoll).
	Written by Cosmin Apreutesei. Public Domain.
	TLS support in sock_libtls.lua.

ADDRESS LOOKUP
	[try_]getaddrinfo(...) -> ai               look-up a hostname
	ai:free()                                  free the address list
	ai:next() -> ai|nil                        get next address in list
	ai:addrs() -> iter() -> ai                 iterate addresses
	ai:type() -> s                             socket type: 'tcp', ...
	ai:family() -> s                           address family: 'inet', ...
	ai:protocol() -> s                         protocol: 'tcp', 'icmp', ...
	ai:name() -> s                             cannonical name
	ai:tostring() -> s                         formatted address
	ai.addr -> sa                              address object
	sa:family() -> s                           address family: 'inet', ...
	sa:port() -> n                             address port
	sa:tostring() -> s                         'ip:port'
	sa:addr() -> ip                            IP address object
	ip:tobinary() -> uint8_t[4|16], 4|16       IP address in binary form
	ip:tostring() -> s                         IP address in string form

SOCKETS
	tcp([family], [protocol]) -> tcp           make a TCP socket
	udp([family], [protocol]) -> udp           make a UDP socket
	rawsocket([family][, protocol]) -> raw     make a raw socket
	[try_]connect(host, port, [timeout]) -> tcp         create tcp socket and connect
	listen([backlog, ]host, port, [onaccept]) -> tcp    create tcp socket and listen
	s:socktype() -> s                               socket type: 'tcp', ...
	s:family() -> s                                 address family: 'inet', ...
	s:protocol() -> s                               protocol: 'tcp', 'icmp', ...
	s:[try_]close()                                 send FIN and/or RST and free socket
	s:closed() -> t|f                               check if the socket is closed
	s:onclose(fn)                                   exec fn after the socket is closed
	s:[try_]bind([host], [port], [af])              bind socket to an address
	s:[try_]setopt(opt, val)                        set socket option (`'so_*'` or `'tcp_*'`)
	s:[try_]getopt(opt) -> val                      get socket option
	tcp|udp:[try_]connect(host, port, [af], ...)    connect to an address
	tcp:[try_]send(s|buf, [len]) -> true            send bytes to connected address
	udp:[try_]send(s|buf, [len]) -> len             send bytes to connected address
	tcp|udp:[try_]recv(buf, maxlen) -> len          receive bytes
	tcp:[try_]listen([backlog, ]host, port, [onaccept], [af])   put socket in listening mode
	tcp:[try_]accept() -> ctcp | nil,err,[retry]    accept a client connection
	tcp:[try_]recvn(buf, n) -> buf, n               receive n bytes
	tcp:[try_]recvall() -> buf, len                 receive until closed
	tcp:[try_]recvall_read() -> read                make a buffered read function
	udp:[try_]sendto(host, port, s|buf, [len], [af]) -> len    send a datagram to an address
	udp:[try_]recvnext(buf, maxlen, [flags]) -> len, sa        receive the next datagram
	tcp:[try_]shutdown(['r'|'w'|'rw'])         send FIN
	s:debug([protocol])                        enable debugging

THREADS
	thread(func[, fmt, ...]) -> co         create a coroutine for async I/O
	resume(thread, ...) -> ...             resume thread
	yield(...) -> ...                      safe yield (see [coro])
	suspend(...) -> ...                    suspend thread
	cowrap(f) -> wrapper                   see coro.safewrap()
	currentthread() -> co, is_main         current coroutine and whether it's the main one
	threadstatus(co) -> s                  coroutine.status()
	transfer(co, ...) -> ...               see coro.transfer()
	cofinish(co, ...) -> ...               see coro.finish()
	threadenv[co] -> t                     get a thread's own or inherited environment
	getthreadenv([co]) -> t                get (current) thread's own enviornment
	getownthreadenv([co], [create]) -> t   get/create (current) thread's own environment
	onthreadfinish(co, f)                  run `f(thread)` when thread finishes

SCHEDULER
	poll()                                 poll for I/O
	start()                                keep polling until all threads finish
	stop()                                 stop polling
	run(f, ...) -> ...                     run a function inside a thread

TIMERS
	wait_job() -> sj            make an interruptible async wait job
	  sj:wait_until(t) -> ...   wait until clock()
	  sj:wait(s) -> ...         wait for `s` seconds
	  sj:resume(...)            resume the waiting thread
	  sj:cancel()               calls sj:resume(sj.CANCEL)
	  sj.CANCEL                 magic arg that can cancel runat()
	wait_until(t) -> ...        wait until clock() value
	wait(s) -> ...              wait for s seconds
	runat(t, f) -> sj           run `f` at clock `t`
	runafter(s, f) -> sj        run `f` after `s` seconds
	runevery(s, f) -> sj        run `f` every `s` seconds
	runagainevery(s, f) -> sj   run `f` now and every `s` seconds afterwards
	s:wait_job() -> sj          wait job that is auto-canceled on socket close
	s:wait_until(t) -> ...      wait_until() on auto-canceled wait job
	s:wait(s) -> ...            wait() on auto-canceled wait job

THREAD SETS
	threadset() -> ts
	  ts:thread(f, [fmt, ...]) -> co
	  ts:join() -> {{ok=,ret=,thread=},...}

MULTI-THREADING (WITH OS THREADS)
	iocp([iocp_h]) -> iocp_h    get/set IOCP handle (Windows)
	epoll_fd([epfd]) -> epfd    get/set epoll fd (Linux)

------------------------------------------------------------------------------

All function return `nil, err` on error (but raise on user error
or unrecoverable OS failure). Some error messages are normalized
across platforms, like 'access_denied' and 'address_already_in_use'
so they can be used in conditionals.

I/O functions only work inside threads created with `thread()`.

`host, port` args are passed to `getaddrinfo()` (with the optional `af` arg),
which means that an already resolved address can be passed as `ai, nil`
in place of `host, port`.

ADDRESS LOOKUP ---------------------------------------------------------------

getaddrinfo(...) -> ai

	Look-up a hostname. Returns an "address info" object which is a OS-allocated
	linked list of one or more addresses resolved with the system's `getaddrinfo()`.
	The args can be either an existing `ai` object which is passed through, or:

	* `host, port, [socket_type], [family], [protocol], [af]`

	where

  * `host` can be a hostname, ip address or `'*'` which means "all interfaces".
  * `port` can be a port number, a service name or `0` which means "any available port".
  * `socket_type` can be `'tcp'`, `'udp'`, `'raw'` or `0` (the default, meaning "all").
  * `family` can be `'inet'`, `'inet6'` or `'unix'` or `0` (the default, meaning "all").
  * `protocol` can be `'ip'`, `'ipv6'`, `'tcp'`, `'udp'`, `'raw'`, `'icmp'`,
  `'igmp'` or `'icmpv6'` or `0` (the default is either `'tcp'`, `'udp'`
  or `'raw'`, based on socket type).
  * `af` are a `bor()` list of `passive`, `cannonname`,
    `numerichost`, `numericserv`, `all`, `v4mapped`, `addrconfig`
    which map to `getaddrinfo()` flags.

NOTE: `getaddrinfo()` is blocking! Use resolve() to resolve hostnames first!

SOCKETS ----------------------------------------------------------------------

tcp([family][, protocol]) -> tcp

	Make a TCP socket. The default family is `'inet'`.

udp([family][, protocol]) -> udp

	Make an UDP socket. The default family is `'inet'`.

rawsocket([family][, protocol]) -> raw`

	Make a raw socket. The default family is `'inet'`.

s:[try_]close()

	Close the connection and free the socket.

	For TCP sockets, if 1) there's unread incoming data (i.e. recv() hasn't
	returned 0 yet), or 2) `so_linger` socket option was set with a zero timeout,
	then a TCP RST packet is sent to the client, otherwise a FIN is sent.

s:[try_]bind([host], [port], [af])

	Bind socket to an interface/port (which default to '*' and 0 respectively
	meaning all interfaces and a random port).

s:setexpires(['r'|'w'], clock|nil)
s:settimeout(['r'|'w'], seconds|nil)

	Set or clear the expiration clock for all subsequent I/O operations.
	If the expiration clock is reached before an operation completes,
	`nil, 'timeout'` is returned.

tcp|udp:[try_]connect(host, port, [af], ...)

	Connect to an address, binding the socket to `('*', 0)` if not bound already.

	For UDP sockets, this has the effect of filtering incoming packets so that
	only those coming from the connected address get through the socket. Also,
	you can call connect() multiple times (use `('*', 0)` to switch back to
	unfiltered mode).

tcp:[try_]send(s|buf, [len], [flags]) -> true

	Send bytes to the connected address.
	Partial writes are signaled with `nil, err, writelen`.
	Trying to send zero bytes is allowed but it's a no-op (doesn't go to the OS).

udp:[try_]send(s|buf, [len], [flags]) -> len

	Send bytes to the connected address.
	Empty packets (zero bytes) are allowed.

tcp|udp:[try_]recv(buf, maxlen, [flags]) -> len

	Receive bytes from the connected address.
	With TCP, returning 0 means that the socket was closed on the other side.
	With UDP it just means that an empty packet was received.

tcp:[try_]listen([backlog, ]host, port, [onaccept], [af])

	Put the socket in listening mode, binding the socket if not bound already
	(in which case `host` and `port` args are ignored). The `backlog` defaults
	to `1/0` which means "use the maximum allowed".

tcp:[try_]accept() -> ctcp | nil,err,[retry]

	Accept a client connection. The connection socket has additional fields:
	`remote_addr`, `remote_port`, `local_addr`, `local_port`.

	A third return value indicates that the error is a network error and thus
	the call be retried.

tcp:[try_]recvn(buf, len) -> true

	Repeat recv until `len` bytes are received.
	Partial reads are signaled with `nil, err, readlen`.

tcp:[try_]recvall() -> buf,len | nil,err,buf,len

	Receive until closed into an accumulating buffer. If an error occurs
	before the socket is closed, the partial buffer and length is returned after it.

tcp:recvall_read() -> read

	Receive all data into a buffer and make a `read` function that consumes it.
	Useful for APIs that require an input `read` function that cannot yield.

udp:[try_]sendto(host, port, s|buf, [maxlen], [flags], [af]) -> len

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

	Calling close() without shutdown may send a RST (see the notes on `close()`
	for when that can happen) which may cause any data that is pending either
	on the sender side or on the receiving side to be discarded (that's how TCP
	works: RST has that data-cutting effect).

	Required for lame protocols like HTTP with pipelining: a HTTP server
	that wants to close the connection before honoring all the received
	pipelined requests needs to call `s:shutdown'w'` (which sends a FIN to
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
	the I/O thread (the thread that called `start()`).

	Full-duplex I/O on a socket can be achieved by performing reads in one thread
	and writes in another.

resume(thread, ...)

	Resume a thread, which means transfer control to it, but also temporarily
	change the I/O thread to be this thread so that the first suspending call
	(send, recv, wait, suspend, etc.) gives control back to this thread.
	_This_ is the trick to starting multiple threads before starting polling.

suspend(...) -> ...

	Suspend current thread, transfering to the polling thread (but see resume()).

poll(timeout) -> true | false,'timeout'

	Poll for the next I/O event and resume the coroutine that waits for it.

	Timeout is in seconds with anything beyond 2^31-1 taken as infinte
	and defaults to infinite.

start()

	Start polling. Stops when no more I/O or `stop()` was called.

stop()

	Tell the loop to stop dequeuing and return.

wait_until(t)

	Wait until a clock() value without blocking other threads.

wait(s) -> ...

	Wait `s` seconds without blocking other threads.

wait_job() -> sj

	Make an interruptible waiting job. Put the current thread wait using
	`sj:wait()` or `sj:wait_until()` and then from another thread call
	`sj:resume()` to resume the waiting thread. Any arguments passed to
	`sj:resume()` will be returned by `wait()`.

MULTI-THREADING --------------------------------------------------------------

iocp([iocp_handle]) -> iocp_handle

	Get/set the global IOCP handle (Windows).

	IOCPs can be shared between OS threads and having a single IOCP for all
	threads (as opposed to having one IOCP per thread/Lua state) enables the
	kernel to better distribute the completion events between threads.

	To share the IOCP with another Lua state running on a different thread,
	get the IOCP handle with `iocp()`, copy it over to the other state,
	then set it with `iocp(copied_iocp)`.

epoll_fd([epfd]) -> epfd

	Get/set the global epoll fd (Linux).

	Epoll fds can be shared between OS threads and having a single epfd for all
	threads is more efficient for the kernel than having one epfd per thread.

	To share the epfd with another Lua state running on a different thread,
	get the epfd with `epoll_fd()`, copy it over to the other state,
	then set it with `epoll_fd(copied_epfd)`.

]=]

if not ... then require'sock_test'; return end

require'glue'
require'heap'
require'logging'
local coro = require'coro'
coro.live  = live
coro.pcall = pcall

local
	assert, isstr, clock, max, abs, min, bor, band, cast, u8p, fill, str, errno =
	assert, isstr, clock, max, abs, min, bor, band, cast, u8p, fill, str, errno

local coro_create   = coro.create
local coro_safewrap = coro.safewrap
local coro_transfer = coro.transfer
local coro_finish   = coro.finish

assert(Windows or Linux or OSX, 'unsupported platform')

local C = Windows and ffi.load'ws2_32' or C

local socket = {issocket = true, debug_prefix = 'S'} --common socket methods
local tcp = {type = 'tcp_socket'}
local udp = {type = 'udp_socket'}
local raw = {type = 'raw_socket'}

function issocket(s)
	local mt = getmetatable(s)
	return istab(mt) and rawget(mt, 'issocket') or false
end

--forward declarations
local check, _poll, wait_io, cancel_wait_io, create_socket, wrap_socket

--NOTE: close() returns `false` on error but it should be ignored.
function socket:try_close()
	if not self.s then return true end
	_sock_unregister(self)
	if self.listen_socket then
		self.listen_socket.n = self.listen_socket.n - 1
	end
	local ok, err = self:_close()
	live(self, nil)
	self.s = nil --unsafe to close twice no matter the error.
	if not ok then return false, err end
	log('', 'sock', 'closed', '%-4s r:%d w:%d%s', self, self.r, self.w,
		self.n and ' live:'..self.n or '')
	return true
end

function socket:closed()
	return not self.s
end

function socket:onclose(fn)
	local try_close = self.try_close
	function self:try_close()
		local ok, err = try_close(self)
		fn()
		if not ok then return false, err end
		return true
	end
end

--getaddrinfo() --------------------------------------------------------------

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

typedef struct sockaddr {
	union {
		struct {
			short   family_num;
			uint8_t port_bytes[2];
		};
		struct sockaddr_in  addr_in;
		struct sockaddr_in6 addr_in6;
	};
} sockaddr;
]]

-- working around ABI blindness of C programmers...
if Windows then
	cdef[[
	struct addrinfo {
		int              flags;
		int              family_num;
		int              socktype_num;
		int              protocol_num;
		size_t           addrlen;
		char            *name_ptr;
		struct sockaddr *addr;
		struct addrinfo *next_ptr;
	};
	]]
else
	cdef[[
	struct addrinfo {
		int              flags;
		int              family_num;
		int              socktype_num;
		int              protocol_num;
		size_t           addrlen;
		struct sockaddr *addr;
		char            *name_ptr;
		struct addrinfo *next_ptr;
	};
	]]
end

cdef[[
int getaddrinfo(const char *node, const char *service,
	const struct addrinfo *hints, struct addrinfo **res);
void freeaddrinfo(struct addrinfo *);
]]

local socketargs
do
	local families = {
		inet  = Windows and  2 or Linux and  2,
		inet6 = Windows and 23 or Linux and 10,
		unix  = Linux and 1,
	}
	local family_map = index(families)

	local socket_types = {
		tcp = Windows and 1 or Linux and 1,
		udp = Windows and 2 or Linux and 2,
		raw = Windows and 3 or Linux and 3,
	}
	local socket_type_map = index(socket_types)

	local protocols = {
		ip     = Windows and   0 or Linux and   0,
		icmp   = Windows and   1 or Linux and   1,
		igmp   = Windows and   2 or Linux and   2,
		tcp    = Windows and   6 or Linux and   6,
		udp    = Windows and  17 or Linux and  17,
		raw    = Windows and 255 or Linux and 255,
		ipv6   = Windows and  41 or Linux and  41,
		icmpv6 = Windows and  58 or Linux and  58,
	}
	local protocol_map = index(protocols)

	local flag_bits = {
		passive     = Windows and 0x00000001 or 0x0001,
		cannonname  = Windows and 0x00000002 or 0x0002,
		numerichost = Windows and 0x00000004 or 0x0004,
		numericserv = Windows and 0x00000008 or 0x0400,
		all         = Windows and 0x00000100 or 0x0010,
		v4mapped    = Windows and 0x00000800 or 0x0008,
		addrconfig  = Windows and 0x00000400 or 0x0020,
	}

	local default_protocols = {
		[socket_types.tcp] = protocols.tcp,
		[socket_types.udp] = protocols.udp,
		[socket_types.raw] = protocols.raw,
	}

	function socketargs(socket_type, family, protocol)
		local st = socket_types[socket_type] or socket_type or 0
		local af = families[family] or family or 0
		local pr = protocols[protocol] or protocol or default_protocols[st] or 0
		return st, af, pr
	end

	local hints = new'struct addrinfo'
	local addrs = new'struct addrinfo*[1]'
	local addrinfo_ct = typeof'struct addrinfo'

	local getaddrinfo_error
	if Windows then
		function getaddrinfo_error()
			return check()
		end
	else
		cdef'const char *gai_strerror(int ecode);'
		function getaddrinfo_error(err)
			return nil, str(C.gai_strerror(err))
		end
	end

	function try_getaddrinfo(host, port, socket_type, family, protocol, flags)
		if host == '*' then host = '0.0.0.0' end --all.
		if istype(addrinfo_ct, host) then
			return host, true --pass-through and return "not owned" flag
		elseif istab(host) then
			local t = host
			host, port, family, socket_type, protocol, flags =
				t.host, t.port or port, t.family, t.socket_type, t.protocol, t.flags
		end
		assert(host, 'host required')
		assert(port, 'port required')
		fill(hints, sizeof(hints))
		hints.socktype_num, hints.family_num, hints.protocol_num
			= socketargs(socket_type, family, protocol)
		hints.flags = flags and bitflags(flags, flag_bits, nil, true) or 0
		local ret = C.getaddrinfo(host, port and tostring(port), hints, addrs)
		if ret ~= 0 then return getaddrinfo_error(ret) end
		return gc(addrs[0], C.freeaddrinfo)
	end
	function getaddrinfo(...)
		return assert(try_getaddrinfo(...))
	end

	local ai = {}

	function ai:free()
		gc(self, nil)
		C.freeaddrinfo(self)
	end

	function ai:next(ai)
		local ai = ai and ai.next_ptr or self
		return ai ~= nil and ai or nil
	end

	function ai:addrs()
		return ai.next, self
	end

	function ai:type     () return socket_type_map[self.socktype_num] end
	function ai:family   () return family_map     [self.family_num  ] end
	function ai:protocol () return protocol_map   [self.protocol_num] end
	function ai:name     () return str(self.name_ptr) end
	function ai:tostring () return self.addr:tostring() end

	local sa = {}

	function sa:family () return family_map[self.family_num] end
	function sa:port   () return self.port_bytes[0] * 0x100 + self.port_bytes[1] end

	local AF_INET  = families.inet
	local AF_INET6 = families.inet6
	local AF_UNIX  = families.unix

	function sa:addr()
		return self.family_num == AF_INET  and self.addr_in
			 or self.family_num == AF_INET6 and self.addr_in6
			 or error'NYI'
	end

	function sa:tostring()
		return self.addr_in:tostring()..(self:port() ~= 0 and ':'..self:port() or '')
	end

	metatype('struct sockaddr', {__index = sa})

	local sa_in4 = {}

	function sa_in4:tobinary()
		return self.ip_bytes, 4
	end

	function sa_in4:tostring()
		local b = self.ip_bytes
		return format('%d.%d.%d.%d', b[0], b[1], b[2], b[3])
	end

	metatype('struct sockaddr_in', {__index = sa_in4})

	local sa_in6 = {}

	function sa_in6:tobinary()
		return self.ip_bytes, 16
	end

	function sa_in6:tostring()
		local b = self.ip_bytes
		return format('%x:%x:%x:%x:%x:%x:%x:%x',
			b[ 0]*0x100+b[ 1], b[ 2]*0x100+b[ 3], b[ 4]*0x100+b[ 5], b[ 6]*0x100+b[ 7],
			b[ 8]*0x100+b[ 9], b[10]*0x100+b[11], b[12]*0x100+b[13], b[14]*0x100+b[15])
	end

	metatype('struct sockaddr_in6', {__index = sa_in6})

	metatype(addrinfo_ct, {__index = ai})

	function socket:socktype () return socket_type_map[self._st] end
	function socket:family   () return family_map     [self._af] end
	function socket:protocol () return protocol_map   [self._pr] end

	function socket:addr(host, port, flags)
		return getaddrinfo(host, port, self._st, self._af, self._pr, addr_flags)
	end

end

local sockaddr_ct = typeof'sockaddr'

--Winsock2 & IOCP ------------------------------------------------------------

if Windows then

cdef[[

// required types from `winapi.types` ----------------------------------------

typedef unsigned long   ULONG;
typedef unsigned long   DWORD;
typedef int             BOOL;
typedef unsigned short  WORD;
typedef BOOL            *LPBOOL;
typedef int             *LPINT;
typedef DWORD           *LPDWORD;
typedef void            VOID;
typedef VOID            *LPVOID;
typedef const VOID      *LPCVOID;
typedef uint64_t ULONG_PTR, *PULONG_PTR;
typedef VOID            *PVOID;
typedef char            CHAR;
typedef CHAR            *LPSTR;
typedef VOID            *HANDLE;
typedef struct {
    unsigned long  Data1;
    unsigned short Data2;
    unsigned short Data3;
    unsigned char  Data4[8];
} GUID, *LPGUID;

// IOCP ----------------------------------------------------------------------

typedef struct _OVERLAPPED {
	ULONG_PTR Internal;
	ULONG_PTR InternalHigh;
	PVOID Pointer;
	HANDLE    hEvent;
} OVERLAPPED, *LPOVERLAPPED;

HANDLE CreateIoCompletionPort(
	HANDLE    FileHandle,
	HANDLE    ExistingCompletionPort,
	ULONG_PTR CompletionKey,
	DWORD     NumberOfConcurrentThreads
);

BOOL GetQueuedCompletionStatus(
	HANDLE       CompletionPort,
	LPDWORD      lpNumberOfBytesTransferred,
	PULONG_PTR   lpCompletionKey,
	LPOVERLAPPED *lpOverlapped,
	DWORD        dwMilliseconds
);

BOOL CancelIoEx(
	HANDLE       hFile,
	LPOVERLAPPED lpOverlapped
);

// Sockets -------------------------------------------------------------------

typedef uintptr_t SOCKET;
typedef HANDLE WSAEVENT;
typedef unsigned int GROUP;

typedef struct _WSAPROTOCOL_INFOW WSAPROTOCOL_INFOW, *LPWSAPROTOCOL_INFOW;

SOCKET WSASocketW(
	int                 af,
	int                 type,
	int                 protocol,
	LPWSAPROTOCOL_INFOW lpProtocolInfo,
	GROUP               g,
	DWORD               dwFlags
);
int closesocket(SOCKET s);

typedef struct WSAData {
	WORD wVersion;
	WORD wHighVersion;
	char szDescription[257];
	char szSystemStatus[129];
	unsigned short iMaxSockets; // to be ignored
	unsigned short iMaxUdpDg;   // to be ignored
	char *lpVendorInfo;         // to be ignored
} WSADATA, *LPWSADATA;

int WSAStartup(WORD wVersionRequested, LPWSADATA lpWSAData);
int WSACleanup(void);
int WSAGetLastError();

int getsockopt(
	SOCKET s,
	int    level,
	int    optname,
	char   *optval,
	int    *optlen
);

int setsockopt(
	SOCKET     s,
	int        level,
	int        optname,
	const char *optval,
	int        optlen
);

typedef struct _WSABUF {
	ULONG len;
	CHAR  *buf;
} WSABUF, *LPWSABUF;

int WSAIoctl(
	SOCKET        s,
	DWORD         dwIoControlCode,
	LPVOID        lpvInBuffer,
	DWORD         cbInBuffer,
	LPVOID        lpvOutBuffer,
	DWORD         cbOutBuffer,
	LPDWORD       lpcbBytesReturned,
	LPOVERLAPPED  lpOverlapped,
	void*         lpCompletionRoutine
);

typedef BOOL (*LPFN_CONNECTEX) (
	SOCKET s,
	const sockaddr* name,
	int namelen,
	PVOID lpSendBuffer,
	DWORD dwSendDataLength,
	LPDWORD lpdwBytesSent,
	LPOVERLAPPED lpOverlapped
);

typedef BOOL (*LPFN_ACCEPTEX) (
	SOCKET sListenSocket,
	SOCKET sAcceptSocket,
	PVOID lpOutputBuffer,
	DWORD dwReceiveDataLength,
	DWORD dwLocalAddressLength,
	DWORD dwRemoteAddressLength,
	LPDWORD lpdwBytesReceived,
	LPOVERLAPPED lpOverlapped
);

int connect(
	SOCKET         s,
	const sockaddr *name,
	int            namelen
);

int WSASend(
	SOCKET       s,
	LPWSABUF     lpBuffers,
	DWORD        dwBufferCount,
	LPDWORD      lpNumberOfBytesSent,
	DWORD        dwFlags,
	LPOVERLAPPED lpOverlapped,
	void*        lpCompletionRoutine
);

int WSARecv(
	SOCKET       s,
	LPWSABUF     lpBuffers,
	DWORD        dwBufferCount,
	LPDWORD      lpNumberOfBytesRecvd,
	LPDWORD      lpFlags,
	LPOVERLAPPED lpOverlapped,
	void*        lpCompletionRoutine
);

int WSASendTo(
	SOCKET          s,
	LPWSABUF        lpBuffers,
	DWORD           dwBufferCount,
	LPDWORD         lpNumberOfBytesSent,
	DWORD           dwFlags,
	const sockaddr  *lpTo,
	int             iTolen,
	LPOVERLAPPED    lpOverlapped,
	void*           lpCompletionRoutine
);

int WSARecvFrom(
	SOCKET       s,
	LPWSABUF     lpBuffers,
	DWORD        dwBufferCount,
	LPDWORD      lpNumberOfBytesRecvd,
	LPDWORD      lpFlags,
	sockaddr*    lpFrom,
	LPINT        lpFromlen,
	LPOVERLAPPED lpOverlapped,
	void*        lpCompletionRoutine
);

void GetAcceptExSockaddrs(
	PVOID      lpOutputBuffer,
	DWORD      dwReceiveDataLength,
	DWORD      dwLocalAddressLength,
	DWORD      dwRemoteAddressLength,
	sockaddr** LocalSockaddr,
	LPINT      LocalSockaddrLength,
	sockaddr** RemoteSockaddr,
	LPINT      RemoteSockaddrLength
);

]]

local WSAGetLastError = C.WSAGetLastError

local nbuf = new'DWORD[1]' --global buffer shared between many calls.

--error handling
do
	cdef[[
	DWORD FormatMessageA(
		DWORD dwFlags,
		LPCVOID lpSource,
		DWORD dwMessageId,
		DWORD dwLanguageId,
		LPSTR lpBuffer,
		DWORD nSize,
		va_list *Arguments
	);
	]]

	local FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000

	local error_msgs = {
		[10013] = 'access_denied', --WSAEACCES
		[10048] = 'address_already_in_use', --WSAEADDRINUSE
		[10053] = 'connection_aborted', --WSAECONNABORTED
		[10054] = 'connection_reset', --WSAECONNRESET
		[10061] = 'connection_refused', --WSAECONNREFUSED
		[ 1225] = 'connection_refused', --ERROR_CONNECTION_REFUSED
		[  109] = 'eof', --ERROR_BROKEN_PIPE, ReadFile (masked)
	}

	local buf
	function check(ret, err)
		if ret then return ret end
		local err = err or WSAGetLastError()
		local msg = error_msgs[err]
		if not msg then
			buf = buf or new('char[?]', 256)
			local sz = ffi.C.FormatMessageA(
				FORMAT_MESSAGE_FROM_SYSTEM, nil, err, 0, buf, 256, nil)
			msg = sz > 0 and str(buf, sz):gsub('[\r\n]+$', '') or 'Error '..err
		end
		return ret, msg, err
	end
end

--init winsock library.
do
	local WSADATA = new'WSADATA'
	assert(check(C.WSAStartup(0x101, WSADATA) == 0))
	assert(WSADATA.wVersion == 0x101)
end

--dynamic binding of winsock functions.
local bind_winsock_func
do
	local IOC_OUT = 0x40000000
	local IOC_IN  = 0x80000000
	local IOC_WS2 = 0x08000000
	local SIO_GET_EXTENSION_FUNCTION_POINTER = bor(IOC_IN, IOC_OUT, IOC_WS2, 6)

	function bind_winsock_func(socket, func_ct, func_guid)
		local cbuf = new(typeof('$[1]', typeof(func_ct)))
		assert(check(C.WSAIoctl(
			socket, SIO_GET_EXTENSION_FUNCTION_POINTER,
			func_guid, sizeof(func_guid),
			cbuf, sizeof(cbuf),
			nbuf, nil, nil
		)) == 0)
		assert(cbuf[0] ~= nil)
		return cbuf[0]
	end
end

--Binding ConnectEx() because WSAConnect() doesn't do IOCP.
local function ConnectEx(s, ...)
	ConnectEx = bind_winsock_func(s, 'LPFN_CONNECTEX', new('GUID',
		0x25a207b9,0xddf3,0x4660,{0x8e,0xe9,0x76,0xe5,0x8c,0x74,0x06,0x3e}))
	return ConnectEx(s, ...)
end

local function AcceptEx(s, ...)
	AcceptEx = bind_winsock_func(s, 'LPFN_ACCEPTEX', new('GUID',
		{0xb5367df1,0xcbac,0x11cf,{0x95,0xca,0x00,0x80,0x5f,0x48,0xa1,0x92}}))
	return AcceptEx(s, ...)
end

do
	local iocp
	function _G.iocp(shared_iocp)
		if shared_iocp then
			iocp = shared_iocp
		elseif not iocp then
			local INVALID_HANDLE_VALUE = cast('HANDLE', -1)
			iocp = ffi.C.CreateIoCompletionPort(INVALID_HANDLE_VALUE, nil, 0, 0)
			assert(check(iocp ~= nil))
		end
		return iocp
	end
end

do
	local WSA_FLAG_OVERLAPPED = 0x01
	local INVALID_SOCKET = cast('SOCKET', -1)

	function _sock_register(socket)
		local iocp = iocp()
		local h = cast('HANDLE', socket.s)
		if ffi.C.CreateIoCompletionPort(h, iocp, 0, 0) ~= iocp then
			return check()
		end
		return true
	end

	_sock_unregister = noop --no need.

	--[[local]] function create_socket(class, socktype, family, protocol)

		local st, af, pr = socketargs(socktype, family or 'inet', protocol)
		assert(st ~= 0, 'socket type required')
		local flags = WSA_FLAG_OVERLAPPED

		local s = C.WSASocketW(af, st, pr, nil, 0, flags)
		assert(check(s ~= INVALID_SOCKET))

		local s = wrap_socket(class, s, st, af, pr)
		live(s, socktype)

		local ok, err = _sock_register(s)
		if not ok then
			s:try_close()
			error(err)
		end

		return s
	end
end

function socket:_close()
	return check(C.closesocket(self.s) == 0)
end

local expires_heap = heap{
	cmp = function(job1, job2)
		return job1.expires < job2.expires
	end,
	index_key = 'index', --enable O(log n) removal.
}

do
local function wait_until(job, expires)
	job.thread = currentthread()
	job.expires = expires
	expires_heap:push(job)
	return wait_io(false)
end
local function wait(job, timeout)
	return wait_until(job, clock() + timeout)
end
local function job_resume(job, ...)
	if not expires_heap:remove(job) then
		return false
	end
	resume(job.thread, ...)
	return true
end
local CANCEL = {}
local function cancel(job)
	job_resume(job, CANCEL)
end
function wait_job()
	return {wait = wait, wait_until = wait_until, resume = job_resume,
		cancel = cancel, CANCEL = CANCEL}
end
end

local overlapped, free_overlapped
do
	local jobs = {} --{job1, ...}
	local freed = {} --{job_index1, ...}

	local overlapped_ct = typeof[[
		struct {
			OVERLAPPED overlapped;
			int job_index;
		}
	]]
	local overlapped_ptr_ct = typeof('$*', overlapped_ct)

	local OVERLAPPED = typeof'OVERLAPPED'
	local LPOVERLAPPED = typeof'LPOVERLAPPED'

	function overlapped(socket, done, expires)
		if #freed > 0 then
			local job_index = pop(freed)
			local job = jobs[job_index]
			job.socket = socket --socket or file object from fs.pipe()
			job.done = done
			job.expires = expires
			local o = cast(LPOVERLAPPED, job.overlapped)
			fill(o, sizeof(OVERLAPPED))
			return o, job
		else
			local job = {socket = socket, done = done, expires = expires}
			local o = overlapped_ct()
			job.overlapped = o
			push(jobs, job)
			o.job_index = #jobs
			return cast(LPOVERLAPPED, o), job
		end
	end

	function free_overlapped(o)
		local o = cast(overlapped_ptr_ct, o)
		push(freed, o.job_index)
		return jobs[o.job_index]
	end

end

do
	local keybuf = new'ULONG_PTR[1]'
	local obuf = new'LPOVERLAPPED[1]'

	local WAIT_TIMEOUT = 258
	local ERROR_OPERATION_ABORTED = 995
	local ERROR_NOT_FOUND = 1168
	local INFINITE = 0xffffffff

	local voidp = voidp
	local GetQueuedCompletionStatus = ffi.C.GetQueuedCompletionStatus
	local CancelIoEx = ffi.C.CancelIoEx

	--[[local]] function _poll()

		local job = expires_heap:peek()
		local timeout = job and max(0, job.expires - clock()) or 1/0

		local timeout_ms = max(timeout * 1000, 100)
		--we're going infinite after 0x7fffffff for compat. with Linux.
		if timeout_ms > 0x7fffffff then timeout_ms = INFINITE end

		local ok = GetQueuedCompletionStatus(
			iocp(), nbuf, keybuf, obuf, timeout_ms) ~= 0

		local o = obuf[0]

		if o == nil then
			assert(not ok)
			local err = WSAGetLastError()
			if err == WAIT_TIMEOUT then
				--cancel all timed-out jobs.
				local t = clock()
				while true do
					local job = expires_heap:peek()
					if not job then
						break
					end
					if abs(t - job.expires) <= .05 then --arbitrary threshold.
						expires_heap:pop()
						job.expires = nil
						if job.socket then
							local s = job.socket.s --pipe or socket
							local o = job.overlapped.overlapped
							local ok = CancelIoEx(cast(voidp, s), o) ~= 0
							if not ok then
								local err = WSAGetLastError()
								if err == ERROR_NOT_FOUND then --too late, already gone
									free_overlapped(o)
									coro_transfer(job.thread, nil, 'timeout')
								else
									assert(check(ok, err))
								end
							end
						else --wait()
							coro_transfer(job.thread)
						end
					else
						--jobs are popped in expire-order so no point looking beyond this.
						break
					end
				end
				--even if we canceled them all, we still have to wait for the OS
				--to abort them. until then we can't recycle the OVERLAPPED structures.
				return true
			else
				return check(nil, err)
			end
		else
			local n = nbuf[0]
			local job = free_overlapped(o)
			if ok then
				if job.expires then
					assert(expires_heap:remove(job))
				end
				coro_transfer(job.thread, job:done(n))
			else
				local err = WSAGetLastError()
				if err == ERROR_OPERATION_ABORTED then --canceled
					coro_transfer(job.thread, nil, 'timeout')
				else
					if job.expires then
						assert(expires_heap:remove(job))
					end
					coro_transfer(job.thread, check(nil, err))
				end
			end
			return true
		end
	end
end

do
	local WSA_IO_PENDING = 997 --alias to ERROR_IO_PENDING

	local function check_pending(ok, job)
		if ok or WSAGetLastError() == WSA_IO_PENDING then
			if job.expires then
				expires_heap:push(job)
			end
			job.thread = currentthread()
			return wait_io()
		end
		return check()
	end

	local function return_true()
		return true
	end

	function tcp:try_connect(host, port, addr_flags, ...)
		log('', 'sock', 'connect', '%-4s %s:%s', self, host, port)
		if not self.bound_addr then
			--ConnectEx requires binding first.
			local ok, err = self:try_bind(...)
			if not ok then return false, err end
		end
		local ai, ext_ai = self:addr(host, port, addr_flags)
		if not ai then return nil, ext_ai end
		local o, job = overlapped(self, return_true, self.recv_expires)
		local ok = ConnectEx(self.s, ai.addr, ai.addrlen, nil, 0, nil, o) == 1
		local ok, err = check_pending(ok, job)
		if not ok then
			if not ext_ai then ai:free() end
			return false, err
		end
		local ip = ai:tostring()
		log('', 'sock', 'connectd', '%-4s %s', self, ip)
		live(self, 'connected %s', ip)
		if not ext_ai then ai:free() end
		return true
	end

	function udp:try_connect(host, port, addr_flags)
		local ai, ext_ai = self:addr(host, port, addr_flags)
		if not ai then return nil, ext_ai end
		local ok = C.connect(self.s, ai.addr, ai.addrlen) == 0
		if not ext_ai then ai:free() end
		if not ok then return check(ok) end
		log('', 'sock', 'connected', '%-4s %s', self, ai:tostring())
		return true
	end

	local WSAEACCES     = 10013
	local WSAECONNRESET = 10054
	local WSAENETDOWN   = 10050
	local WSAEMFILE     = 10024
	local WSAENOBUFS    = 10055
	local WSATRY_AGAIN  = 11002

	local accept_buf_ct = typeof[[
		struct {
			struct sockaddr local_addr;
			char reserved[16];
			struct sockaddr remote_addr;
			char reserved[16];
		}
	]]
	local accept_buf = accept_buf_ct()
	local sa_len = sizeof(accept_buf) / 2
	function tcp:try_accept()
		log('', 'sock', 'accept', '%-4s', self)
		local s = create_socket(tcp, 'tcp', self._af, self._pr)
		live(s, 'wait-accept %s', self) --only shows in Windows.
		local o, job = overlapped(self, return_true, self.recv_expires)
		local ok = AcceptEx(self.s, s.s, accept_buf, 0, sa_len, sa_len, nil, o) == 1
		local ok, msg, err = check_pending(ok, job)
		if not ok then
			s:try_close()
			local retry =
				   err == WSAEACCES
				or err == WSAECONNRESET
				or err == WSAENETDOWN
				or err == WSAEMFILE
				or err == WSAENOBUFS
				or err == WSATRY_AGAIN
			return nil, msg, retry
		end
		local ra = accept_buf.remote_addr:addr():tostring()
		local rp = accept_buf.remote_addr:port()
		local la = accept_buf. local_addr:addr():tostring()
		local lp = accept_buf. local_addr:port()
		self.n = self.n + 1
		s.i = self.n
		log('', 'sock', 'accepted', '%-4s %s.%d %s:%s <- %s:%s live:%d',
			s, self, s.i, la, lp, ra, rp, self.n)
		live(s, 'accepted %s.%d %s:%s <- %s:%s', self, s.i, la, lp, ra, rp)
		s.remote_addr = ra
		s.remote_port = rp
		s. local_addr = la
		s. local_port = lp
		s.listen_socket = self
		return s
	end

	local wsabuf = new'WSABUF'
	local flagsbuf = new'DWORD[1]'

	local function io_done(job, n)
		return n
	end

	local function socket_send(self, buf, len)
		wsabuf.buf = isstr(buf) and cast(u8p, buf) or buf
		wsabuf.len = len
		local o, job = overlapped(self, io_done, self.send_expires)
		local ok = C.WSASend(self.s, wsabuf, 1, nil, 0, o, nil) == 0
		local n, err = check_pending(ok, job)
		if not n then return nil, err end
		self.w = self.w + n
		return n
	end

	function udp:try_send(buf, len)
		return socket_send(self, buf, len or #buf)
	end

	function tcp:_send(buf, len)
		if not self.s then return nil, 'closed' end
		len = len or #buf
		if len == 0 then return 0 end --mask-out null-writes
		return socket_send(self, buf, len)
	end

	function socket:try_recv(buf, len)
		if not self.s then return nil, 'closed' end
		assert(len > 0)
		wsabuf.buf = buf
		wsabuf.len = len
		local o, job = overlapped(self, io_done, self.recv_expires)
		flagsbuf[0] = 0
		local ok = C.WSARecv(self.s, wsabuf, 1, nil, flagsbuf, o, nil) == 0
		local r, err = check_pending(ok, job)
		if not r then return nil, err end
		self.r = self.r + r
		return r
	end

	function udp:try_sendto(host, port, buf, len, flags, addr_flags)
		len = len or #buf
		local ai, ext_ai = self:addr(host, port, addr_flags)
		if not ai then return nil, ext_ai end
		wsabuf.buf = isstr(buf) and cast(u8p, buf) or buf
		wsabuf.len = len
		local o, job = overlapped(self, io_done, self.send_expires)
		local ok = C.WSASendTo(self.s, wsabuf, 1, nil, flags or 0, ai.addr, ai.addrlen, o, nil) == 0
		if not ext_ai then ai:free() end
		local n, err = check_pending(ok, job)
		if not n then return nil, err end
		self.w = self.w + n
		return n
	end

	local int_buf_ct = typeof'int[1]'
	local sa_buf_len = sizeof(sockaddr_ct)

	function udp:try_recvnext(buf, len, flags)
		assert(len > 0)
		wsabuf.buf = buf
		wsabuf.len = len
		local o, job = overlapped(self, io_done, self.recv_expires)
		flagsbuf[0] = flags or 0
		if not job.sa then job.sa = sockaddr_ct() end
		if not job.sa_len_buf then job.sa_len_buf = int_buf_ct() end
		job.sa_len_buf[0] = sa_buf_len
		local ok = C.WSARecvFrom(self.s, wsabuf, 1, nil, flagsbuf, job.sa, job.sa_len_buf, o, nil) == 0
		local n, err = check_pending(ok, job)
		if not n then return nil, err end
		assert(job.sa_len_buf[0] <= sa_buf_len) --not truncated
		self.r = self.r + n
		return n, job.sa
	end

	function _file_async_read(f, read_overlapped, buf, sz)
		local o, job = overlapped(f, io_done, f.recv_expires)
		local ok = read_overlapped(f, o, buf, sz)
		local n, err = check_pending(ok, job)
		if not n then return nil, err end
		return n
	end

	function _file_async_write(f, write_overlapped, buf, sz)
		local o, job = overlapped(f, io_done, f.send_expires)
		local ok = write_overlapped(f, o, buf, sz)
		local n, err = check_pending(ok, job)
		if not n then return nil, err end
		return n
	end

end

end --if Windows

--POSIX sockets --------------------------------------------------------------

if Linux or OSX then

cdef[[
typedef int SOCKET;
int socket(int af, int type, int protocol);
int accept(int s, struct sockaddr *addr, int *addrlen);
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
// for async pipes
ssize_t read(int fd, void *buf, size_t count);
ssize_t write(int fd, const void *buf, size_t count);
]]

--error handling.

--[[local]] check = check_errno

local SOCK_NONBLOCK = Linux and tonumber(4000, 8)

--[[local]] function create_socket(class, socktype, family, protocol)
	local st, af, pr = socketargs(socktype, family or 'inet', protocol)
	local s = C.socket(af, bor(st, SOCK_NONBLOCK), pr)
	assert(check(s ~= -1))
	local s = wrap_socket(class, s, st, af, pr)
	live(s, socktype)
	return s
end

function socket:_close()
	local ok, err = check(C.close(self.s) == 0)
	cancel_wait_io(self)
	return ok, err
end

local EAGAIN      = 11
local EWOULDBLOCK = 11
local EINPROGRESS = 115

local recv_expires_heap = heap{
	cmp = function(s1, s2)
		return s1.recv_expires < s2.recv_expires
	end,
	index_key = 'index', --enable O(log n) removal.
}

local send_expires_heap = heap{
	cmp = function(s1, s2)
		return s1.send_expires < s2.send_expires
	end,
	index_key = 'index', --enable O(log n) removal.
}

do
local function wait_until(job, expires)
	job.recv_thread = currentthread()
	job.recv_expires = expires
	recv_expires_heap:push(job)
	return wait_io(false)
end
local function wait(job, timeout)
	return wait_until(job, clock() + timeout)
end
local function job_resume(job, ...)
	if not recv_expires_heap:remove(job) then
		return false
	end
	resume(job.recv_thread, ...)
	return true
end
local CANCEL = {}
local function cancel(job)
	job_resume(job, CANCEL)
end
function wait_job()
	return {wait = wait, wait_until = wait_until, resume = job_resume,
		cancel = cancel, CANCEL = CANCEL}
end
end

local function make_async(for_writing, returns_n, func, wait_errno)
	return function(self, ...)
		::again::
		local ret = func(self, ...)
		if ret >= 0 then
			if returns_n then
				if for_writing then
					self.w = self.w + ret
				else
					self.r = self.r + ret
				end
			end
			return ret
		end
		if errno() == wait_errno then
			if for_writing then
				if self.send_expires then
					send_expires_heap:push(self)
				end
				self.send_thread = currentthread()
			else
				if self.recv_expires then
					recv_expires_heap:push(self)
				end
				self.recv_thread = currentthread()
			end
			local ok, err = wait_io()
			if not ok then
				return nil, err
			end
			goto again
		end
		return check()
	end
end

local _connect = make_async(true, false, function(self, ai)
	return C.connect(self.s, ai.addr, ai.addrlen)
end, EINPROGRESS)

function tcp:try_connect(host, port, addr_flags, ...)
	log('', 'sock', 'connect', '%-4s %s:%s', self, host, port)
	local ai, ext_ai = self:addr(host, port, addr_flags)
	if not ai then return false, ext_ai end
	if not self.bound_addr then
		local ok, err = self:try_bind(...)
		if not ok then
			if not ext_ai then ai:free() end
			return false, err
		end
	end
	local len, err = _connect(self, ai)
	if not len then
		if not ext_ai then ai:free() end
		return false, err
	end
	local ip = ai:tostring()
	log('', 'sock', 'connectd', '%-4s %s', self, ip)
	live(self, 'connected %s', ip)
	if not ext_ai then ai:free() end
	return true
end
udp.try_connect = tcp.try_connect

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
	local accept_buf = sockaddr_ct()
	local accept_buf_size = sizeof(accept_buf)

	local tcp_accept = make_async(false, false, function(self)
		nbuf[0] = accept_buf_size
		local r = C.accept4(self.s, accept_buf, nbuf, SOCK_NONBLOCK)
		return r
	end, EWOULDBLOCK)

	function tcp:try_accept()
		log('', 'sock', 'accept', '%-4s', self)
		local s, err, errno = tcp_accept(self)
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
		local s = wrap_socket(tcp, s, self._st, self._af, self._pr)
		local ok, err = _sock_register(s)
		if not ok then
			s:try_close()
			return nil, err
		end
		local ra = accept_buf:addr():tostring()
		local rp = accept_buf:port()
		--get local addr
		nbuf[0] = accept_buf_size
		local ok, err = check(C.getsockname(s.s, accept_buf, nbuf) == 0)
		if not ok then
			s:try_close()
			return nil, err
		end
		local la = accept_buf:addr():tostring()
		local lp = accept_buf:port()
		self.n = self.n + 1
		s.i = self.n
		log('', 'sock', 'accepted', '%-4s %s.%d %s:%s <- %s:%s live:%d',
			s, self, s.i, la, lp, ra, rp, self.n)
		live(s, 'accepted %s.%d %s:%s <- %s:%s', self, s.i, la, lp, ra, rp)
		s.remote_addr = ra
		s.remote_port = rp
		s. local_addr = la
		s. local_port = lp
		return s
	end
end

local MSG_NOSIGNAL = Linux and 0x4000 or nil

local socket_send = make_async(true, true, function(self, buf, len, flags)
	return C.send(self.s, buf, len, flags or MSG_NOSIGNAL)
end, EWOULDBLOCK)

function tcp:_send(buf, len, flags)
	if not self.s then return nil, 'closed' end
	len = len or #buf
	if len == 0 then return 0 end --mask-out null-writes
	return socket_send(self, buf, len, flags)
end

function udp:try_send(buf, len, flags)
	return socket_send(self, buf, len or #buf, flags)
end

local socket_recv = make_async(false, true, function(self, buf, len, flags)
	return C.recv(self.s, buf, len, flags or 0)
end, EWOULDBLOCK)

function socket:try_recv(buf, len, flags)
	if not self.s then return nil, 'closed' end
	assert(len > 0)
	return socket_recv(self, buf, len, flags)
end

local udp_sendto = make_async(true, true, function(self, ai, buf, len, flags)
	return C.sendto(self.s, buf, len, flags or 0, ai.addr, ai.addrlen)
end, EWOULDBLOCK)

function udp:try_sendto(host, port, buf, len, flags, addr_flags)
	len = len or #buf
	local ai, ext_ai = self:addr(host, port, addr_flags)
	if not ai then return nil, ext_ai end
	local len, err = udp_sendto(self, ai, buf, len, flags)
	if not len then return nil, err end
	if not ext_ai then ai:free() end
	return len
end

do
	local src_buf = sockaddr_ct()
	local src_buf_len = sizeof(src_buf)
	local src_len_buf = new'int[1]'

	local udp_recvnext = make_async(false, true, function(self, buf, len, flags)
		src_len_buf[0] = src_buf_len
		return C.recvfrom(self.s, buf, len, flags or 0, src_buf, src_len_buf)
	end, EWOULDBLOCK)

	function udp:try_recvnext(buf, len, flags)
		assert(len > 0)
		local len, err = udp_recvnext(self, buf, len, flags)
		if not len then return nil, err end
		assert(src_len_buf[0] <= src_buf_len) --not truncated
		return len, src_buf
	end
end

local file_write = make_async(true, true, function(self, buf, len)
	return tonumber(C.write(self.fd, buf, len))
end, EAGAIN)

local file_read = make_async(false, true, function(self, buf, len)
	return tonumber(C.read(self.fd, buf, len))
end, EAGAIN)

function _file_async_write(f, buf, len)
	return file_write(f, buf, len)
end
function _file_async_read(f, buf, len)
	return file_read(f, buf, len)
end

--epoll ----------------------------------------------------------------------

if Linux then

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
};

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
local EPOLL_CTL_MOD = 3

do
	local epoll_fd
	function _G.epoll_fd(shared_epoll_fd, flags)
		if shared_epoll_fd then
			epoll_fd = shared_epoll_fd
		elseif not epoll_fd then
			flags = flags or 0 --TODO: flags
			epoll_fd = C.epoll_create1(flags)
			assert(check(epoll_fd >= 0))
		end
		return epoll_fd
	end
end

do
	local sockets = {} --{socket1, ...}
	local free_indices = {} --{i1, ...}

	local e = new'struct epoll_event'
	function _sock_register(s)
		local i = pop(free_indices) or #sockets + 1
		s._i = i
		sockets[i] = s
		e.data.u32 = i
		e.events = EPOLLIN + EPOLLOUT + EPOLLET
		return check(C.epoll_ctl(epoll_fd(), EPOLL_CTL_ADD, s.s, e) == 0)
	end

	local ENOENT = 2

	function _sock_unregister(s)
		local i = s._i
		if not i then return end --closing before bind() was called.
		sockets[i] = false
		push(free_indices, i)
	end

	local function wake(socket, for_writing, has_err)
		local thread
		if for_writing then
			thread = socket.send_thread
		else
			thread = socket.recv_thread
		end
		if not thread then return end --misfire.
		if for_writing then
			if socket.send_expires then
				assert(send_expires_heap:remove(socket))
				socket.send_expires = nil
			end
			socket.send_thread = nil
		else
			if socket.recv_expires then
				assert(recv_expires_heap:remove(socket))
				socket.recv_expires = nil
			end
			socket.recv_thread = nil
		end
		if has_err then
			local err = socket:try_getopt'error'
			coro_transfer(thread, nil, err or 'socket error')
		else
			coro_transfer(thread, true)
		end
	end

	local function check_heap(heap, EXPIRES, THREAD, t)
		while true do
			local socket = heap:peek() --gets a socket or wait job
			if not socket then
				break
			end
			if socket[EXPIRES] - t <= .05 then --arbitrary threshold.
				assert(heap:pop())
				socket[EXPIRES] = nil
				local thread = socket[THREAD]
				socket[THREAD] = nil
				coro_transfer(thread, nil, 'timeout')
			else
				--socket are popped in expire-order so no point looking beyond this.
				break
			end
		end
	end

	--NOTE: If you think of making maxevents > 1 for a modest perf gain,
	--note that epoll_wait() will coalesce multiple events affecting the same
	--fd in a single epoll_event item, and it returns the number of events,
	--not the number of epoll_event items that were filled, contrary to what
	--the epoll man page says, so it's not trivial to parse the result.
	local maxevents = 1
	local events = new('struct epoll_event[?]', maxevents)
	local RECV_MASK = EPOLLIN  + EPOLLERR + EPOLLHUP + EPOLLRDHUP
	local SEND_MASK = EPOLLOUT + EPOLLERR + EPOLLHUP + EPOLLRDHUP

	--[[local]] function _poll()

		local ss = send_expires_heap:peek()
		local rs = recv_expires_heap:peek()
		local sx = ss and ss.send_expires
		local rx = rs and rs.recv_expires
		local expires = min(sx or 1/0, rx or 1/0)
		local timeout = expires < 1/0 and max(0, expires - clock()) or 1/0

		local timeout_ms = max(timeout * 1000, 100)
		if timeout_ms > 0x7fffffff then timeout_ms = -1 end --infinite

		local n = C.epoll_wait(epoll_fd(), events, maxevents, timeout_ms)
		if n > 0 then
			assert(n == 1)
			local e = events[0].events
			local si = events[0].data.u32
			local socket = sockets[si]
			--if EPOLLHUP/RDHUP/ERR arrives (and it'll arrive alone because maxevents == 1),
			--we need to wake up all waiting threads because EPOLLIN/OUT might never follow!
			local has_err = band(e, EPOLLERR) ~= 0
			if band(e, RECV_MASK) ~= 0 then wake(socket, false, has_err) end
			if band(e, SEND_MASK) ~= 0 then wake(socket, true , has_err) end
			return true
		elseif n == 0 then
			--handle timed-out ops.
			local t = clock()
			check_heap(send_expires_heap, 'send_expires', 'send_thread', t)
			check_heap(recv_expires_heap, 'recv_expires', 'recv_thread', t)
			return true
		else
			return check()
		end
	end
end

end --if Linux

--kqueue ---------------------------------------------------------------------

if OSX then

cdef[[
int kqueue(void);
int kevent(int kq, const struct kevent *changelist, int nchanges,
	struct kevent *eventlist, int nevents,
	const struct timespec *timeout);
// EV_SET(&kev, ident, filter, flags, fflags, data, udata);
]]

end --if OSX

end --if Linux or OSX

--shutodnw() -----------------------------------------------------------------

cdef[[
int shutdown(SOCKET s, int how);
]]

function tcp:try_shutdown(which)
	if not self.s then return nil, 'closed' end
	return check(C.shutdown(self.s,
		   which == 'r' and 0
		or which == 'w' and 1
		or (not which or which == 'rw') and 2))
end

--bind() ---------------------------------------------------------------------

cdef[[
int bind(SOCKET s, const sockaddr*, int namelen);
]]

function socket:try_bind(host, port, addr_flags)
	assert(not self.bound_addr)
	local ai, ext_ai = self:addr(host or '*', port or 0, addr_flags)
	if not ai then return nil, ext_ai end
	local ok, err = check(C.bind(self.s, ai.addr, ai.addrlen) == 0)
	local ba = ok and ai.addr:addr():tostring()
	local bp = ok and ai.addr:port()
	if not ext_ai then ai:free() end
	if not ok then return false, err end
	self.bound_addr = ba
	self.bound_port = bp
	if Linux then
		--epoll_ctl() must be called after bind() for some reason.
		return _sock_register(self)
	else
		return true
	end
end

--listen() -------------------------------------------------------------------

cdef[[
int listen(SOCKET s, int backlog);
]]

function tcp:try_listen(backlog, host, port, onaccept, addr_flags)
	if not isnum(backlog) then
		backlog, host, port, onaccept, addr_flags = 1/0, backlog, host, port, onaccept
	end
	if not self.bound_addr then
		local ok, err = self:try_bind(host, port, addr_flags)
		if not ok then return nil, err end
	end
	backlog = clamp(backlog or 1/0, 0, 0x7fffffff)
	local ok = C.listen(self.s, backlog) == 0
	if not ok then return check() end
	log('', 'sock', 'listen', '%-4s %s:%d', self, self.bound_addr, self.bound_port)
	live(self, 'listen %s:%d', self.bound_addr, self.bound_port)
	self.n = 0 --live client connection count

	if onaccept then
		repeat
			local ctcp, err = self:accept()
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

	return true
end

do --getopt() & setopt() -----------------------------------------------------

local buf = new[[
	union {
		char     c[4];
		uint32_t u;
		uint16_t u16;
		int32_t  i;
	}
]]

local function get_bool   (buf) return buf.u == 1 end
local function get_int    (buf) return buf.i end
local function get_uint   (buf) return buf.u end
local function get_uint16 (buf) return buf.u16 end

local function get_str(buf, sz)
	return str(C.strerror(buf.i))
end

local function set_bool(v) --BOOL aka DWORD
	buf.u = v
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

local function nyi() error'NYI' end

local get_protocol_info = nyi
local set_linger = nyi
local get_csaddr_info = nyi

local OPT, get_opt, set_opt

if Windows then

OPT = { --Windows 7 options only
	acceptconn         = 0x0002, -- socket has had listen()
	broadcast          = 0x0020, -- permit sending of broadcast msgs
	bsp_state          = 0x1009, -- get socket 5-tuple state
	conditional_accept = 0x3002, -- enable true conditional accept (see msdn)
	connect_time       = 0x700C, -- number of seconds a socket has been connected
	dontlinger         = bnot(0x0080),
	dontroute          = 0x0010, -- just use interface addresses
	error              = 0x1007, -- get error status and clear
	exclusiveaddruse   = bnot(0x0004), -- disallow local address reuse
	keepalive          = 0x0008, -- keep connections alive
	linger             = 0x0080, -- linger on close if data present
	max_msg_size       = 0x2003, -- maximum message size for UDP
	maxdg              = 0x7009,
	maxpathdg          = 0x700a,
	oobinline          = 0x0100, -- leave received oob data in line
	pause_accept       = 0x3003, -- pause accepting new connections
	port_scalability   = 0x3006, -- enable port scalability
	protocol_info      = 0x2005, -- wsaprotocol_infow structure
	randomize_port     = 0x3005, -- randomize assignment of wildcard ports
	rcvbuf             = 0x1002, -- receive buffer size
	rcvlowat           = 0x1004, -- receive low-water mark
	reuseaddr          = 0x0004, -- allow local address reuse
	sndbuf             = 0x1001, -- send buffer size
	sndlowat           = 0x1003, -- send low-water mark
	type               = 0x1008, -- get socket type
	update_accept_context  = 0x700b,
	update_connect_context = 0x7010,
	useloopback        = 0x0040, -- bypass hardware when possible
	tcp_bsdurgent      = 0x7000,
	tcp_expedited_1122 = 0x0002,
	tcp_maxrt          =      5,
	tcp_nodelay        = 0x0001,
	tcp_timestamps     =     10,
}

get_opt = {
	acceptconn         = get_bool,
	broadcast          = get_bool,
	bsp_state          = get_csaddr_info,
	conditional_accept = get_bool,
	connect_time       = get_uint,
	dontlinger         = get_bool,
	dontroute          = get_bool,
	error              = get_uint,
	exclusiveaddruse   = get_bool,
	keepalive          = get_bool,
	linger             = get_linger,
	max_msg_size       = get_uint,
	maxdg              = get_uint,
	maxpathdg          = get_uint,
	oobinline          = get_bool,
	pause_accept       = get_bool,
	port_scalability   = get_bool,
	protocol_info      = get_protocol_info,
	randomize_port     = get_uint16,
	rcvbuf             = get_uint,
	rcvlowat           = get_uint,
	reuseaddr          = get_bool,
	sndbuf             = get_uint,
	sndlowat           = get_uint,
	type               = get_uint,
	tcp_bsdurgent      = get_bool,
	tcp_expedited_1122 = get_bool,
	tcp_maxrt          = get_uint,
	tcp_nodelay        = get_bool,
	tcp_timestamps     = get_bool,
}

set_opt = {
	broadcast          = set_bool,
	conditional_accept = set_bool,
	dontlinger         = set_bool,
	dontroute          = set_bool,
	exclusiveaddruse   = set_bool,
	keepalive          = set_bool,
	linger             = set_linger,
	max_msg_size       = set_uint,
	oobinline          = set_bool,
	pause_accept       = set_bool,
	port_scalability   = set_bool,
	randomize_port     = set_uint16,
	rcvbuf             = set_uint,
	rcvlowat           = set_uint,
	reuseaddr          = set_bool,
	sndbuf             = set_uint,
	sndlowat           = set_uint,
	update_accept_context  = set_bool,
	update_connect_context = set_bool,
	tcp_bsdurgent      = set_bool,
	tcp_expedited_1122 = set_bool,
	tcp_maxrt          = set_uint,
	tcp_nodelay        = set_bool,
	tcp_timestamps     = set_bool,
}

elseif Linux then

OPT = {
	debug             = 1,
	reuseaddr         = 2,
	type              = 3,
	error             = 4,
	dontroute         = 5,
	broadcast         = 6,
	sndbuf            = 7,
	rcvbuf            = 8,
	sndbufforce       = 32,
	rcvbufforce       = 33,
	keepalive         = 9,
	oobinline         = 10,
	no_check          = 11,
	priority          = 12,
	linger            = 13,
	bsdcompat         = 14,
	reuseport         = 15,
	passcred          = 16,
	peercred          = 17,
	rcvlowat          = 18,
	sndlowat          = 19,
	rcvtimeo          = 20,
	sndtimeo          = 21,
	security_authentication = 22,
	security_encryption_transport = 23,
	security_encryption_network = 24,
	bindtodevice      = 25,
	attach_filter     = 26,
	detach_filter     = 27,
	get_filter        = 26, --attach_filter
	peername          = 28,
	timestamp         = 29,
	scm_timestamp        = 29, --timestamp
	acceptconn        = 30,
	peersec           = 31,
	passsec           = 34,
	timestampns       = 35,
	scm_timestampns      = 35, --timestampns
	mark              = 36,
	timestamping      = 37,
	scm_timestamping     = 37, --timestamping
	protocol          = 38,
	domain            = 39,
	rxq_ovfl          = 40,
	wifi_status       = 41,
	scm_wifi_status      = 41, --wifi_status
	peek_off          = 42,
	nofcs             = 43,
	lock_filter       = 44,
	select_err_queue  = 45,
	busy_poll         = 46,
	max_pacing_rate   = 47,
	bpf_extensions    = 48,
	incoming_cpu      = 49,
	attach_bpf        = 50,
	detach_bpf        = 27, --detach_filter
	attach_reuseport_cbpf = 51,
	attach_reuseport_ebpf = 52,
	cnx_advice        = 53,
	scm_timestamping_opt_stats = 54,
	meminfo           = 55,
	incoming_napi_id  = 56,
	cookie            = 57,
	scm_timestamping_pktinfo = 58,
	peergroups        = 59,
	zerocopy          = 60,
}

get_opt = {
	error              = get_str,
	reuseaddr          = get_bool,
}

set_opt = {
	reuseaddr          = set_bool,
}

elseif OSX then --TODO

OPT = {

}

get_opt = {

}

set_opt = {

}

end

local function parse_opt(k)
	local opt = assertf(OPT[k], 'invalid socket option: %s', k)
	local level =
		(k:find('tcp_', 1, true) and 6) --TCP protocol number
		or (
			(Windows and 0xffff)
			or (Linux and 1) --SOL_SOCKET
		)
	return opt, level
end

function socket:try_getopt(k)
	local opt, level = parse_opt(k)
	local get = assertf(get_opt[k], 'write-only socket option: %s', k)
	local nbuf = i32a(1)
	local ok, err = check(C.getsockopt(self.s, level, opt, buf.c, nbuf) == 0)
	if not ok then return nil, err end
	return get(buf, sz)
end

function socket:try_setopt(k, v)
	local opt, level = parse_opt(k)
	local set = assert(set_opt[k], 'read-only socket option')
	local buf, sz = set(v)
	return check(C.setsockopt(self.s, level, opt, buf, sz))
end

end --do

--tcp repeat I/O -------------------------------------------------------------

function tcp:try_send(buf, sz)
	sz = sz or #buf
	local sz0 = sz
	while true do
		local len, err = self:_send(buf, sz)
		if len == sz then
			break
		end
		if not len then --short write
			return nil, err, sz0 - sz
		end
		assert(len > 0)
		if isstr(buf) then --only make pointer on the rare second pass.
			buf = cast(u8p, buf)
		end
		buf = buf + len
		sz  = sz  - len
	end
	return true
end

function tcp:try_recvn(buf, sz)
	local buf0, sz0 = buf, sz
	while sz > 0 do
		local len, err = self:recv(buf, sz)
		if not len then --short read
			return nil, err, sz0 - sz
		elseif len == 0 then --closed
			return nil, 'eof', sz0 - sz
		end
		buf = buf + len
		sz  = sz  - len
	end
	return buf0, sz0
end

function tcp:try_recvall()
	return readall(self.recv, self)
end

function tcp:recvall_read()
	return buffer_reader(self:recvall())
end

--sleeping & timers ----------------------------------------------------------

function wait_until(expires)
	wait_job():wait_until(expires)
end

function wait(timeout)
	wait_job():wait(timeout)
end

function runat(t, f, ...)
	local job = wait_job()
	resume(thread(function()
		if job:wait_until(t) == job.CANCEL then
			return
		end
		f()
	end, ...))
	return job
end

function runafter(timeout, f, ...)
	return runat(clock() + timeout, f, ...)
end

local function _runevery(now_too, interval, f, ...)
	local job = wait_job()
	resume(thread(function()
		if now_too then
			if f() == false then
				return
			end
		end
		while true do
			if job:wait(interval) == job.CANCEL then
				return
			end
			if f() == false then
				return
			end
		end
	end, ...))
	return job
end
function runevery      (...) return _runevery(false, ...) end
function runagainevery (...) return _runevery(true , ...) end

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

--debug API ------------------------------------------------------------------

function socket:debug(protocol)

	local function ds(event, s)
		log('', protocol or '', event, '%-4s %5s %s',
			self, s and #s or '', s or '')
	end

	override(self, 'try_recv', function(inherited, self, buf, ...)
		local sz, err = inherited(self, buf, ...)
		if not sz then return nil, err end
		ds('<', str(buf, sz))
		return sz
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

function socket:setexpires(rw, expires)
	if not isstr(rw) then rw, expires = nil, rw end
	local r = rw == 'r' or not rw
	local w = rw == 'w' or not rw
	if r then self.recv_expires = expires end
	if w then self.send_expires = expires end
end
function socket:settimeout(s, rw)
	self:setexpires(s and clock() + s, rw)
end

socket.getopt  = unprotect_io(socket.try_getopt)
socket.setopt  = unprotect_io(socket.try_setopt)
socket.close   = unprotect_io(socket.try_close)
socket.bind    = unprotect_io(socket.try_bind)
socket.recv    = unprotect_io(socket.try_recv)
tcp.connect    = unprotect_io(tcp.try_connect)
tcp.listen     = unprotect_io(tcp.try_listen)
tcp.recvn      = unprotect_io(tcp.try_recvn)
tcp.recvall    = unprotect_io(tcp.try_recvall)
tcp.send       = unprotect_io(tcp.try_send)
tcp.shutdown   = unprotect_io(tcp.try_shutdown)
udp.connect    = unprotect_io(udp.try_connect)
udp.recvnext   = unprotect_io(udp.try_recvnext)
udp.send       = unprotect_io(udp.try_send)
udp.sendto     = unprotect_io(udp.try_sendto)

function tcp:accept()
	local s, err, retry = self:try_accept()
	if s then return s end
	self:check_io(retry, err)
	return nil, err, true
end

--I/O API for protocol buffers.
socket.try_read = socket.try_recv
socket.read   = socket.recv
tcp.try_readn = tcp.try_recvn
tcp.try_write = tcp.try_send
tcp.readn     = tcp.recvn
tcp.write     = tcp.send

function socket:pbuffer()
	return pbuffer{f = self}
end

--[[local]] function wrap_socket(class, s, st, af, pr)
	local s = {s = s, __index = class,
		check_io = check_io, checkp = checkp,
		protect = protect,
		_st = st, _af = af, _pr = pr, r = 0, w = 0}
	setmetatable(s, s)
	log('', 'sock', 'create', '%-4s', s)
	return s
end
function _G.tcp       (...) return create_socket(tcp, 'tcp', ...) end
function _G.udp       (...) return create_socket(udp, 'udp', ...) end
function _G.rawsocket (...) return create_socket(raw, 'raw', ...) end

update(tcp, socket)
update(udp, socket)
update(raw, socket)

udp_class = udp
tcp_class = tcp
raw_class = raw

local create_tcp = _G.tcp

function try_connect(host, port, timeout)
	local self = create_tcp()
	self:settimeout(timeout)
	local ok, err = self:try_connect(host, port)
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

function listen(host, port, onaccept)
	local self = create_tcp()
	self:setopt('reuseaddr', true)
	self:listen(host, port, onaccept)
	return self
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
--[[local]] function wait_io(register)
	local thread, is_main = currentthread()
	assert(poll_thread, 'poll loop not started')
	assert(not is_main, 'trying to perform I/O from the main thread')
	wait_count = wait_count + 1
	if register ~= false then
		waiting[thread] = true
	end
	return wait_io_cont(thread, coro_transfer(poll_thread))
end

--closing a socket doesn't trigger an epoll event, instead the socket is
--silently removed from the epoll list, thus we have to wake up any waiting
--threads manually when the socket is closed from another thread.
--[[local]] function cancel_wait_io(self)
	local t = self.recv_thread
	if t then
		waiting[t] = nil
		self.recv_thread = nil
		resume(t, nil, 'closed')
	end
	local t = self.send_thread
	if t then
		waiting[t] = nil
		self.send_thread = nil
		resume(t, nil, 'closed')
	end
end

function poll()
	if wait_count == 0 then
		return nil, 'empty'
	end
	return _poll()
end

local threadfinish = setmetatable({}, weak_keys)
function onthreadfinish(thread, f)
	after(threadfinish, thread, f)
end

currentthread = coro.running
threadstatus = coro.status
cofinish = coro.finish

local threadenv = setmetatable({}, weak_keys)
local ownthreadenv = setmetatable({}, weak_keys)
_G.threadenv = threadenv

function getthreadenv(thread)
	return threadenv[thread or currentthread()]
end

function getownthreadenv(thread, create)
	thread = thread or currentthread()
	local t = ownthreadenv[thread]
	if not t and create ~= false then
		t = {}
		local pt = threadenv[thread]
		if pt then --inherit parent env, if any.
			t.__index = pt
			setmetatable(t, t)
		end
		ownthreadenv[thread] = t
		threadenv[thread] = t
	end
	return t
end

local function thread_onfinish(thread, ok, ...)
	local finish = threadfinish[thread]
	if finish then
		finish(thread, ok, ...)
	end
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
	threadenv[thread] = threadenv[currentthread()] --inherit threadenv.
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
	threadenv[thread] = threadenv[currentthread()] --inherit threadenv.
	return wrapped, thread
end

function transfer(thread, ...)
	assert(not waiting[thread], 'attempt to resume a thread that is waiting on I/O')
	return coro_transfer(thread, ...)
end

function suspend(...)
	assert(poll_thread, 'poll loop not started')
	return coro_transfer(poll_thread, ...)
end

do
local function cont(real_poll_thread, ...)
	poll_thread = real_poll_thread
	return ...
end
function resume(thread, ...)
	assert(not waiting[thread], 'attempt to resume a thread that is waiting on I/O')
	local real_poll_thread = poll_thread
	--change poll_thread temporarily so that we get back here
	--from the first call to suspend() or wait_io().
	poll_thread = currentthread()
	return cont(real_poll_thread, coro_transfer(thread, ...))
end
end

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
local running = false
function stop() _stop = true end
function try_start()
	if running then
		return
	end
	poll_thread = currentthread()
	repeat
		running = true
		local ret, err = poll()
		if not ret then
			stop()
			if err ~= 'empty' then
				running = false
				_stop = false
				return ret, err
			end
		end
	until _stop
	running = false
	_stop = false
	return true
end
function start()
	assert(try_start())
end

function run(f, ...)
	if running then
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
