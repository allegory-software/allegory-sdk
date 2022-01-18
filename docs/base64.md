
## `local b64 = require'base64'`

Base64 encoding & decoding.

## API

### b64.[encode|decode](s[, size], [outbuf], [outbuf_size]) -> outbuf, len

Encode/decode string or cdata buffer.
Returns a cdata buffer that you can convert to string with `ffi.string()`.

### b64.url[encode|decode](s) -> s

Encode/decode URL based on RFC4648 Section 5 / RFC7515 Section 2 (JSON Web Signature).
