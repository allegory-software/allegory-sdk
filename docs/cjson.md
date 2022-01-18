
## `local json = require'cjson'`

JSON encoding & decoding

## API

| API                                | Description |
| :---                               | :---        |
| `cjson.new() -> cjson`             | new cjson instance
| `require'cjson.safe' -> cjson`     | cjson module that doesn't raise
| `cjson.encode(v) -> s`             | encode value
| `cjson.decode(s) -> v`             | decode value

`cjson` raises an error for invalid data.
`cjson.safe` returns `nil, err` instead.

`cjson.decode()` requires that NULL (ASCII 0) and double quote (ASCII 34)
characters are escaped within strings. All escape codes will be decoded and
other bytes will be passed transparently. UTF-8 characters are not validated
during decoding and should be checked elsewhere if required.

### Nulls

JSON `null` is converted to `cjson.null`.

### Tables

By default, empty tables are encoded as `[]` instead of `{}`.
This can be changed with `cjson.encode_empty_table_as_array(false)`.

By default, Lua CJSON will reject JSON with arrays and/or objects nested
more than 1000 levels deep. This can be changed with `cjson.decode_max_depth(depth)`.

### Numbers

By default, numbers incompatible with the JSON specification
(infinity, NaN, hexadecimal) can be decoded. This default can be changed
with `cjson.decode_invalid_numbers(false)`.

By default, Lua CJSON encodes numbers with 14 significant digits. This can
be changed with `cjson.encode_number_precision(precision)`.

### Sparse arrays

Lua CJSON classifies a Lua table into one of three kinds when encoding
a JSON array. This is determined by the number of values missing from the
Lua array as follows:

 * normal - All values are available.
 * sparse - At least 1 value is missing.
 * excessively sparse - the number of values missing exceeds the configured ratio.

Lua CJSON encodes sparse Lua arrays as JSON arrays using JSON null for the missing entries.

An array is excessively sparse when
`ratio > 0 and maximum_index > safe and maximum_index > item_count * ratio`.

Lua CJSON will never consider an array to be excessively sparse when `ratio = 0`.
The safe limit ensures that small Lua arrays are always encoded as sparse arrays.

By default, attempting to encode an excessively sparse array will generate
an error. If convert is set to true, excessively sparse arrays will be
converted to a JSON object.

This can be changed with::

`cjson.encode_sparse_array([convert[, ratio[, safe]]])`

* `convert` must be a boolean. Default: false.
* `ratio` must be a positive integer. Default: 2.
* `safe` must be a positive integer. Default: 10.
