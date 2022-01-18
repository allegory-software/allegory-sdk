
## `local libjpeg = require'libjpeg'`

JPEG encoding and decoding. Supports progressive loading, yielding from
the reader function, partial loading, fractional scaling and multiple
pixel formats. Based on [libjpeg-turbo].

## API

| API                                 | Description      |
| :---                                | :---             |
| `libjpeg.open(opt \| read) -> jpg`  | open a JPEG image for decoding
| `jpg:load([opt]) -> bmp`            | load the image into a [bitmap]
| `jpg:free()`                        | free the image
| `libjpeg.save(opt)`                 | compress a [bitmap] into a JPEG image

### `libjpeg.open(opt | read) -> jpg`

Open a JPEG image and read its header. `opt` is a table containing at least
the read function and possibly other options.

The read function has the form `read(buf, len) -> readlen`, it can yield
and it can signal I/O errors by returning `nil, err`. It will only be asked
to read a positive number of bytes and it can return less bytes than asked,
including zero which signals EOF.

The `opt` table has the fields:

  * `read`: the read function (required).
  * `partial_loading`: `true/false` (default is `true`); display broken images
    partially or break with an error.
  * `warning`: a function to be called as `warning(msg, level)` on non-fatal
  errors.
  * `read_buffer`: optional, the read buffer to use.
  * `read_buffer_size`: the read buffer size.

The returned `jpg` object contains information about the file and can be used
to load/decode the actual image. Its fields are:

  * `w`, `h`: width and height of the image.
  * `format`: the format in which the image is stored.
  * `progressive`: `true` if it's a progressive image.
  * `jfif`: JFIF marker (see code).
  * `adobe`: Adobe marker (see code).
  * `partial`: true if the image was found to be truncated and it was
  partially loaded (this may become `true` after loading the image).

__NOTE:__ Unknown JPEG formats are opened but the `format` field is missing.

__NOTE:__ Arithmetic decoding doesn't work with suspended I/O and we need
that to allow the read callback to yield (browsers don't support arithmetic
decoding either for the same reason).

__TIP__: Wrap `tcp:read()` from [sock](sock.md) to read from a TCP socket.

__TIP__: Use `f:buffered_read()` from [fs](fs.md) to read from a file.

Example:

```lua
local fs = require'fs'
local f = assert(fs.open'foo.jpg')
local jpg = assert(libjpeg.open{read = f:buffered_read(), skip_buffer = false})
```

### `jpg:load([opt]) -> bmp`

Load the image, returning a [bitmap] object.
The `opt` table can have the fields:

  * `accept.<pixel_format>`: `true/false` specify one or more accepted
  pixel formats (see conversion table below).
  * `accept.bottom_up`: `true/false` (default is `false`) - specify that the
  output bitmap should have its rows upside-down.
  * `accept.stride_aligned`: `true/false` (default is `false`) - specify that
  the row stride should be a multiple of 4.
  * `scale_num`, `scale_denom`: scale down the image by the fraction
  scale_num/scale_denom. Currently, the only supported scaling ratios are M/8
  with all M from 1 to 16, or any reduced fraction thereof (such as 1/2, 3/4,
  etc.) Smaller scaling ratios permit significantly faster decoding since
  fewer pixels need be processed and a simpler IDCT method can be used.
  * `dct_method`: `'accurate'`, `'fast'`, `'float'` (default is `'accurate'`)
  * `fancy_upsampling`: `true/false` (default is `false`); use a fancier
  upsampling method.
  * `block_smoothing`: `true/false` (default is `false`); smooth out large
  pixels of early progression stages for progressive JPEGs.

#### Format Conversions

| source formats | destination formats |
| :---           | :---                |
| `ycc8`, `g8`   | `rgb8`, `bgr8`, `rgba8`, `bgra8`, `argb8`, `abgr8`, `rgbx8`, `bgrx8`, `xrgb8`, `xbgr8`, `g8`
| `ycck8`        | `cmyk8`

__NOTE__: As can be seen, not all conversions are possible with libjpeg-turbo,
so always check the image's `format` field to get the actual format. Use
the [bitmap] module to further convert the image if necessary.

For more info on the decoding process and options read the [libjpeg-turbo doc].

__NOTE:__ the number of bits per channel in the output bitmap is always 8.

### `jpg:free()`

Free the image and associated resources.

### `libjpeg.save(opt)`

Encode a bitmap as JPEG. `opt` is a table containing at least
the source bitmap and an output write function, and possibly other options:

  * `bitmap`: a [bitmap] in an accepted format.
  * `write`: write data to a sink of the form `write(buf, size) -> true | nil,err`.
  * `finish`: optional function to be called after all the data is written.
  * `format`: output format (see list of supported formats above).
  * `quality`: `0..100` range. you know what that is.
  * `progressive`: `true/false` (default is `false`). make it progressive.
  * `dct_method`: `'accurate'`, `'fast'`, `'float'` (default is `'accurate'`).
  * `optimize_coding`: optimize huffmann tables.
  * `smoothing`: `0..100` range. smoothing factor.
  * `write_buffer_size`: internal buffer size (default is 4096).
  * `write_buffer`: internal buffer (default is to internally allocate one).


[bitmap]:             bitmap.md
[libjpeg-turbo]:      http://www.libjpeg-turbo.org/
[libjpeg-turbo doc]:  http://sourceforge.net/p/libjpeg-turbo/code/HEAD/tree/trunk/libjpeg.txt
