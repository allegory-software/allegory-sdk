--[=[

	Secure async TCP sockets based on LibTLS.
	Written by Cosmin Apreutesei. Public Domain.

API

	tls_config(opt) -> conf               create a shared config object
	conf:free()                           free the config object
	client_stcp(tcp, servername, opt) -> cstcp  create a secure socket for a client
	server_stcp(tcp, opt) -> sstcp        create a secure socket for a server
	cstcp:[try_]connect(vhost)            connect to a server
	sstcp:[try_]accept() -> cstcp         accept a client connection
	cstcp:[try_]recv()                    same semantics as `tcp:recv()`
	cstcp:[try_]send()                    same semantics as `tcp:send()`
	cstcp:[try_]recvn()                   same semantics as `tcp:recvn()`
	cstcp:[try_]recvall()                 same semantics as `tcp:recvall()`
	cstcp:[try_]recvall_read()            same semantics as `tcp:recvall_read()`
	cstcp:[try_]shutdown('r'|'w'|'rw')    calls `self.tcp:shutdown()`
	cstcp:[try_]close()                   close client socket
	sstcp:[try_]close()                   close server socket

Config options

	alpn                       ALPN
	ca                         CA certificate
	key                        server key
	cert                       server certificate
	ocsp_staple                ocsp staple
	crl                        CRL data
	keypairs                   {{cert=, key=, ocsp_staple=},...}
	ticket_keys                {{keyrev=, key=},...}
	ciphers                    cipher list
	dheparams                  DHE params
	ecdhecurve                 ECDHE curve
	ecdhecurves                ECDHE curves
	protocols                  protocols ('tlsv1.0'..'tlsv1.3')
	verify_depth               certificate verification depth
	prefer_ciphers_client      prefer client's cipher list
	prefer_ciphers_server      prefer server's cipher list
	insecure_noverifycert      don't verify server's certificate
	insecure_noverifyname      don't verify server's name
	insecure_noverifytime      disable cert and OSCP validation
	ocsp_require_stapling      require OCSP stapling
	verify_client              check client certificate
	verify_client_optional     check client certificate if provided
	session_id                 session id
	session_lifetime           session lifetime

LibTLS rationale

	LibTLS is a simple TLS API with implementations over multiple backends:

		* BearSSL  - libtls-bearssl (what we ship)
		* LibreSSL - built-in
		* OpenSSL  - LibreTLS

BearSSL limitations

	* no TLS sessions (BearSSL has them but they aren't wrapped yet).
	* No TLS 1.3 -- waiting for final spec, see https://bearssl.org/tls13.html.
	* No DHE by design (use ECDHE).
	* No CRL or OCSP (see below).

A word on certificate revocation

	Certificate revocation is one big elephant in the TLS room: CRL solves
	nothing while OCSP ties your server availability to your CA's availability
	and leaks users' browsing history as a bonus. OCSP stapling is the right
	answer in theory but is currently unenforceable. CRLite pushes the problem
	to the client which now has to download CRL diffs every few hours from
	Mozilla, which makes Mozilla a giant SPF, kinda like say, the jQuery CDN.

]=]

require'glue'
require'sock'
require'libtls'

local stcp = {
	issocket = true,
	istcpsocket = true,
	istlssocket = true,
	debug_prefix = 'X',
}
local client_stcp = merge({type = 'client_tls_socket'}, tcp_class)
local server_stcp = merge({type = 'server_tls_socket'}, tcp_class)

local w_bufs = {}
local r_bufs = {}
local bufs_n = 0
local buf_freelist = {}
local buf_freelist_n = 0

local function alloc_buf_slot()
	if buf_freelist_n > 0 then
		buf_freelist_n = buf_freelist_n - 1
		return buf_freelist[buf_freelist_n + 1]
	else
		bufs_n = bufs_n + 1
		return bufs_n
	end
end

local function free_buf_slot(i)
	buf_freelist_n = buf_freelist_n + 1
	buf_freelist[buf_freelist_n] = i
end

local
	tonumber, assert, TLS_WANT_POLLIN, TLS_WANT_POLLOUT =
	tonumber, assert, TLS_WANT_POLLIN, TLS_WANT_POLLOUT

local read_cb = cast('tls_read_cb', function(tls, buf, sz, i)
	sz = tonumber(sz)
	i = tonumber(i)
	assert(i >= 1 and i <= bufs_n, i)
	local r_buf, r_sz = r_bufs[2*i], r_bufs[2*i+1]
	if not r_buf then
		r_bufs[2*i] = buf
		r_bufs[2*i+1] = sz
		return TLS_WANT_POLLIN
	else
		assert(r_buf == buf)
		assert(r_sz <= sz)
		r_bufs[2*i] = false
		return r_sz
	end
end)

local write_cb = cast('tls_write_cb', function(tls, buf, sz, i)
	sz = tonumber(sz)
	i = tonumber(i)
	assert(i >= 1 and i <= bufs_n, i)
	local w_buf, w_sz = w_bufs[2*i], w_bufs[2*i+1]
	if not w_buf then
		w_bufs[2*i] = buf
		w_bufs[2*i+1] = sz
		return TLS_WANT_POLLOUT
	else
		assert(w_buf == buf)
		assert(w_sz <= sz)
		w_bufs[2*i] = false
		return w_sz
	end
end)

local function checkio(self, tls_ret, tls_err)
	if tls_err == 'wantrecv' then
		local i = self.buf_slot
		local buf, sz = r_bufs[2*i], r_bufs[2*i+1]
		local len, err = self.tcp:try_recv(buf, sz)
		if not len then
			return false, len, err
		end
		r_bufs[2*i+1] = len
		return true
	elseif tls_err == 'wantsend' then
		local i = self.buf_slot
		local buf, sz = w_bufs[2*i], w_bufs[2*i+1]
		local len, err = self.tcp:_send(buf, sz)
		if not len then
			return false, len, err
		end
		w_bufs[2*i+1] = len
		return true
	else
		return false, tls_ret, tls_err
	end
end

function client_stcp:try_recv(buf, sz)
	if self._closed then return nil, 'closed' end
	while true do
		local recall, ret, err = checkio(self, self.tls:try_recv(buf, sz))
		if not recall then return ret, err end
	end
end

function client_stcp:_send(buf, sz)
	if self._closed then return nil, 'closed' end
	while true do
		local recall, ret, err = checkio(self, self.tls:try_send(buf, sz))
		if not recall then return ret, err end
	end
end

function stcp:try_close()
	if self._closed then return true end
	self._closed = true --close barrier.
	local recall, tls_ok, tls_err
	repeat
		recall, tls_ok, tls_err = checkio(self, self.tls:try_close())
	until not recall
	live(self, nil)
	self.tls:free()
	local tcp_ok, tcp_err = self.tcp:try_close()
	self.tls = nil
	self.tcp = nil
	self.s = nil
	free_buf_slot(self.buf_slot)
	if not tls_ok then return false, tls_err end
	if not tcp_ok then return false, tcp_err end
	return true
end

function stcp:onclose(fn)
	if self._closed then return end
	after(self.tcp, '_after_close', fn)
end

function stcp:closed()
	return self._closed or false
end

local function wrap_stcp(stcp_class, tcp, tls, buf_slot, name)
	local stcp = object(stcp_class, {
		tcp = tcp,
		tls = tls,
		buf_slot = buf_slot,
		--make it work like a socket
		s = tcp.s, --for getopt()
		check_io = check_io, checkp = checkp,
		log = tcp.log, live = tcp.live, liveadd = tcp.liveadd,
		r = 0, w = 0, --TODO: fill these on recv and send
	})
	live(stcp, name or stcp_class.type)
	return stcp
end

function _G.client_stcp(tcp, servername, opt)
	local tls = tls_client(opt)
	local buf_slot = alloc_buf_slot()
	local ok, err = tls:try_connect(servername, read_cb, write_cb, buf_slot)
	if not ok then
		tls:free()
		return nil, err
	end
	return wrap_stcp(client_stcp, tcp, tls, buf_slot)
end

function _G.server_stcp(tcp, opt)
	local tls = tls_server(opt)
	local buf_slot = alloc_buf_slot() --for close()
	return wrap_stcp(server_stcp, tcp, tls, buf_slot)
end

function server_stcp:try_accept()
	local ctcp, err = self.tcp:try_accept()
	if not ctcp then
		return nil, err
	end
	local buf_slot = alloc_buf_slot()
	local ctls, err = self.tls:try_accept(read_cb, write_cb, buf_slot)
	if not ctls then
		free_buf_slot(buf_slot)
		return nil, err
	end
	return wrap_stcp(client_stcp, ctcp, ctls, buf_slot)
end

function stcp:try_shutdown(mode)
	return self.tcp:try_shutdown(mode)
end

update(client_stcp, stcp)
update(server_stcp, stcp)

stcp.close         = unprotect_io(stcp.try_close)
stcp.shutdown      = unprotect_io(stcp.try_shutdown)
client_stcp.recv   = unprotect_io(client_stcp.try_recv)
server_stcp.accept = unprotect_io(server_stcp.try_accept)

client_stcp.try_read  = client_stcp.try_recv
client_stcp.read      = client_stcp.recv
