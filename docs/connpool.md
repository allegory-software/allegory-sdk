
## `local connpool = require'connpool'`

Connection pools allow reusing and sharing a limited number of connections
between multiple threads in order to 1) avoid creating too many connections
and 2) avoid the lag of connecting and authenticating every time
a connection is needed.

The pool mechanics is simple (it's just a free list) until the connection
limit is reached and then it gets more complicated because we need to put
the threads on a waiting list and resume them in fifo order and we also
need to remove them from wherever they are on the waiting list on timeout.
This is made easy because we have: 1) a ring buffer that allows removal at
arbitrary positions and 2) sock's interruptible timers.

## API

| API                              | Description |
| :---                             | :---        |
| `pools:setlimits(key, opt)`      | set limits for a specific pool
| `pools:get(key, [expires]) -> c` | get a connection from a pool
| `pools:put(key, c, s)`           | put a connection in a pool

## `connpool.new([opt]) -> pools`

The `opt` table has the fields:

* `max_connections`: max connections for all pools (defaults to 100)
* `max_waiting_threads` max threads to queue up (defaults to 1000)

## `pools:setlimits(key, opt)`

Set limits for a specific pool identified by `key`.

The `opt` table has the fields:

* `max_connections`: max connections for all pools (defaults to `pools.max_connections`)
* `max_waiting_threads` max threads to queue up (defaults to `pools.max_waiting_threads`)

## `pools:get(key, [expires]) -> c`

Get a connection from the pool identified by `key`. Returns `nil` if the
pool is empty, in which case the caller has to create a connection itself,
use it, and put it in the pool after it's done with it.

The optional `expires` specifies how much to wait for a connection
when the pool is full. If not given, there's no waiting.

## `pools:put(key, c, s)`

Put a connection in a pool to be reused.

* `s` is a connected TCP client [socket](sock.md).
* `c` is the hi-level protocol state object that encapsulates the low-level
socket connection.
