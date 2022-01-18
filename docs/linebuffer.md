
## `local linebuffer = require'linebuffer'`

A line buffer allows reading from a socket an unknown amount of bytes into
a memory buffer, and consuming the data from the buffer line by line.

It is used for text-based network protocols like HTTP.
