
## `local md5 = require'md5'`

MD5 hash.

## API

### `md5.sum(s[, #s]) -> s`

Compute the MD5 hash of a string or a cdata buffer.

### `md5.digest() -> digest`

Get a function that can consume multiple data chunks until called with
no arguments to return the final hash:

| digest API               | Description |
| :---                     | :---        |
| `digest(s[, size])`      | add a string
| `digest(cdata, size)`    | add a cdata buffer
| `digest() -> s`          | return the hash

The functions return the binary representation of the hash.
To get the hex representation, use `glue.tohex()`.
