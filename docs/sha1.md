
## `local sha1 = require'sha1'`

SHA1 hashing.

## API

### `sha1.sha1(s) -> s`

Compute the SHA-1 hash of a string. Returns the binary representation
of the hash. To get the hex representation, use `glue.tohex()`.
