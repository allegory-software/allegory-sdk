
## `local stls = require'sock_libtls'`

Secure async TCP sockets based on [sock](sock.md) and LibTLS.

## API

| API                                                  | Description |
| :---                                                 | :---        |
| `stls.config(opt) -> conf`                           | create a shared config object
| `conf:free()`                                        | free the config object
| `stls.client_stcp(tcp, servername, opt) -> cstcp`    | create a secure socket for a client
| `stls.server_stcp(tcp, opt) -> sstcp`                | create a secure socket for a server
| `cstcp:connect(vhost)`                               | connect to a server
| `sstcp:accept() -> cstcp`                            | accept a client connection
| `cstcp:recv()`                                       | same semantics as `tcp:recv()`
| `cstcp:send()`                                       | same semantics as `tcp:send()`
| `cstcp:recvn()`                                      | same semantics as `tcp:recvn()`
| `cstcp:recvall()`                                    | same semantics as `tcp:recvall()`
| `cstcp:recvall_read()`                               | same semantics as `tcp:recvall_read()`
| `cstcp:shutdown('r'\|'w'\|'rw')`                     | calls `self.tcp:shutdown()`
| `cstcp:close()`                                      | close client socket
| `sstcp:close()`                                      | close server socket

### Config options

| Option                              | Description      |
| :---                                | :---             |
| `alpn`                              |
| `ca`                                | CA certificate
| `key`                               | server key
| `cert`                              | server certificate
| `ocsp_staple`                       | ocsp staple
| `crl`                               | CRL data
| `keypairs`                          | `{{cert=, key=, ocsp_staple=},...}`
| `ticket_keys`                       | `{{keyrev=, key=},...}`
| `ciphers`                           | cipher list
| `dheparams`                         | DHE params
| `ecdhecurve`                        | ECDHE curve
| `ecdhecurves`                       | ECDHE curves
| `protocols`                         | protocols ('tlsv1.0'..'tlsv1.3')
| `verify_depth`                      | certificate verification depth
| `prefer_ciphers_client`             | prefer client's cipher list
| `prefer_ciphers_server`             | prefer server's cipher list
| `insecure_noverifycert`             | don't verify server's certificate
| `insecure_noverifyname`             | don't verify server's name
| `insecure_noverifytime`             | disable cert and OSCP validation
| `ocsp_require_stapling`             | require OCSP stapling
| `verify_client`                     | check client certificate
| `verify_client_optional`            | check client certificate if provided
| `session_id`                        | session id
| `session_lifetime`                  | session lifetime

## Implementation notes

### LibTLS rationale

The LibTLS API is originally from LibreSSL, but it also has an implementation
for BearSSL called `libtls_bearssl`, which is our underlying TLS library.
The LibTLS API allows yielding in I/O, it's simpler and more consistent
compared to OpenSSL, and works on user-provided I/O. And if it turns out that
BearSSL is not enough, it can be replaced with LibreSSL without code changes.

### BearSSL limitations

* no TLS sessions (BearSSL has them but they aren't wrapped yet).
* No TLS 1.3 -- [waiting for final spec](https://bearssl.org/tls13.html).
* No CRL or OCSP (see below).
* No DHE by design (use ECDHE).

### A word on certificate revocation solutions

Certificate revocation is one big elephant in the TLS room. CRL is long
deprecated, but OCSP is no better as it introduces latency, leaks information
and is ineffective in MITM scenarios. Mozilla's CRLite seems to be the only
solution that doesn't have these problems, but we haven't implemented that yet.
