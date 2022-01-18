
## `local resolver = require'resolver'`

DNS client/resolver. Unlike other resolvers, it always queries all servers
at once, returns the first reply and discards the rest.

## API

| API                                                | Description |
| :---                                               | :---        |
| `resolver.new(t) -> r`                             | create a resolver
| `r:query(name,[type],[timeout] | t) -> answers`    | query
| `r:lookup(name,[type],[timeout]) -> addresses`     | name lookup
| `r:reverse_lookup(address,[timeout]) -> hosts`     | reverse lookup

IMPORTANT: call `math.randomseed` prior to using this module to decrease
the chance of cache poisoning attacks.

Supported record types: A, NS, CNAME, SOA, PTR, MX, TXT, AAAA, SRV, SPF.

Unsupported types must be given by number and they will be received unparsed
in the `rdata` field of the answer.

The resolver queries all the servers all the time and uses the result that
comes first. This results in the best lookup times and impact-free
(for the client) failovers at the expense of a little more network traffic.

## API

### `resolver:new(t) -> r`

Create a resolver object. Options:

* `servers`

	a list (space-separated string or array) of DNS server IP addresses.
	Each entry can be either a hostname or a table of form
	`{host=, [port=], [tcp_only=true]}`.

* `max_cache_entries`

	max. number of response cache entries (defaults to 10K).

### `r:query(name,[type],[timeout] | t) -> answers`

Perform a DNS query and return a list of parsed DNS records, or `nil, err`
for input, network or server errors (where `err` is an error object).

Options:

* `name`:

	name to look up DNS records for.

* `type`:

	record type (string or numeric).
	NOTE: `CNAME` records are always returned for all query types.

* `timeout`

	lookup timeout in seconds (defaults to 5).

* `recurse`

	if `false`, disables the "recursion desired" (RD) flag (defaults to `true`).

### `r:lookup(name,[type],[timeout]) -> addresses`

Make a query and return.

### `r:reverse_lookup(address,[timeout]) -> hostnames`

Make a `PTR` lookup for both IPv4 and IPv6 addresses.

