
## `local sha2 = require'sha2'`

SHA-256/-384/-512 hashing.

### `sha2.sha[256|384|512](s[, size]) -> s`
### `sha2.sha[256|384|512](cdata, size) -> s`

Compute the SHA-2 hash of a string or a cdata buffer.

### `sha2.sha[256|384|512]_digest() -> digest`

Get a SHA-2 digest function that can consume multiple data chunks.

| digest API               | Description |
| :---                     | :---        |
| `digest(s[, size])`      | add a string
| `digest(cdata, size)`    | add a cdata buffer
| `digest() -> s`          | return the hash

The functions return the binary representation of the hash.
To get the hex representation, use `glue.tohex()`.
