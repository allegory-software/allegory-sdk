
## `local glue = require'glue'`

Glue is a collection of "hand tools" necessary in any good dynamic language.
It is compatible with Lua 5.1 with a few functions only available to LuaJIT.

# API Summary

| Function                                                            | Description |
| :---                                                                | :--- |
| __types__                                                           |
| `glue.isstr`                                                        | is string
| `glue.isnum`                                                        | is number
| `glue.isint`                                                        | is integer (includes 1/0 and -1/0)
| `glue.istab`                                                        | is table
| `glue.isfunc`                                                       | is function
| __math__                                                            |
| `glue.round(x[, p]) -> y`                                           | round x to nearest integer or multiple of `p` (half up)
| `glue.snap(x[, p]) -> y`                                            | synonym for glue.round
| `glue.floor(x[, p]) -> y`                                           | round x down to nearest integer or multiple of `p`
| `glue.ceil(x[, p]) -> y`                                            | round x up to nearest integer or multiple of `p`
| `glue.clamp(x, min, max) -> y`                                      | clamp x in range
| `glue.lerp(x, x0, x1, y0, y1) -> y`                                 | linear interpolation
| `glue.sign(x) -> 1\\|0\\|-1`                                        | sign
| `glue.strict_sign(x) -> 1\|-1`                                      | strict sign
| `glue.nextpow2(x) -> y`                                             | next power-of-2 number
| `glue.repl(x, v, r) -> x`                                           | replace v with r in x
| `glue.random_string(n) -> s`                                        | generate random string of length `n`
| `glue.uuid() -> s`                                                  | generate random UUID v4
| __varargs__                                                         |
| `glue.pack(...) -> t`                                               | pack varargs
| `glue.unpack(t, [i] [,j]) -> ...`                                   | unpack varargs
| __tables__                                                          |
| `glue.empty`                                                        | empty r/o table
| `glue.count(t[, maxn]) -> n`                                        | number of keys in table
| `glue.index(t) -> dt`                                               | switch keys with values
| `glue.keys(t[,sorted\|cmp]) -> dt`                                  | make a list of all the keys
| `glue.sortedkeys(t[,cmp]) -> dt`                                    | make a sorted list of all keys
| `glue.sortedpairs(t [,cmp]) -> iter() -> k, v`                      | like pairs() but in key order
| `glue.update(dt, t1, ...) -> dt`                                    | merge tables - overwrites keys
| `glue.merge(dt, t1, ...) -> dt`                                     | merge tables - no overwriting
| `glue.attr(t, k1 [,v])[k2] = v`                                     | autofield pattern
| __arrays__                                                          |
| `glue.extend(dt, t1, ...) -> dt`                                    | extend an array
| `glue.append(dt, v1, ...) -> dt`                                    | append non-nil values to an array
| `glue.shift(t, i, n) -> t`                                          | shift array elements
| `glue.map(t, field\|f,...) -> t`                                    | map f over pairs of t or select a column from an array of records
| `glue.imap(t, field\|f,...) -> t`                                   | map f over ipairs of t or select a column from an array of records
| `glue.indexof(v, t, [i], [j]) -> i`                                 | scan array for value
| `glue.binsearch(v, t, [cmp], [i], [j]) -> i`                        | binary search in sorted array
| `glue.sortedarray([sa]) -> sa`                                      | stay-sorted array with insertion and removal in O(log n)
| `glue.reverse(t, [i], [j]) -> t`                                    | reverse array in place
| __strings__                                                         |
| `glue.gsplit(s,sep[,start[,plain]]) -> iter() -> e[,captures...]`   | split a string by a pattern
| `glue.split(s,sep[,start[,plain]]) -> {s1,...}`                     | split a string by a pattern
| `glue.names('name1 ...') -> {'name1', ...}`                         | split a string by whitespace
| `glue.capitalize(s) -> s`                                           | capitalize the first letter of every word in string
| `glue.lines(s, [opt], [init]) -> iter() -> s, i, j, k`              | iterate the lines of a string
| `glue.outdent(s, [indent]) -> s, indent`                            | outdent/reindent text based on first line's indentation
| `glue.lineinfo(s, [i]) -> line, col`                                | return text position from byte position
| `glue.trim(s) -> s`                                                 | remove padding
| `glue.pad(s, n, [c], dir) -> s`                                     | pad string
| `glue.lpad(s, n, [c]) -> s`                                         | left-pad string
| `glue.rpad(s, n, [c]) -> s`                                         | right-pad string
| `glue.esc(s [,mode]) -> pat`                                        | escape magic pattern characters
| `glue.tohex(s\|n [,upper]) -> s`                                    | string to hex
| `glue.fromhex(s[, isvalid]) -> s`                                   | hex to string
| `glue.starts(s, prefix) -> t\|f`                                    | find if string `s` starts with string `prefix`
| `glue.ends(s, suffix) -> t\|f`                                      | find if string `s` ends with string `suffix`
| `glue.subst(s, t) -> s`                                             | string interpolation of `{foo}` occurences
| `glue.catargs(sep, ...) -> s`                                       | concat non-nil args
| __iterators__                                                       |
| `glue.collect([i,] iterator) -> t`                                  | collect iterated values into an array
| __stubs__                                                           |
| `glue.pass(...) -> ...`                                             | does nothing, returns back all arguments
| `glue.noop(...)`                                                    | does nothing, returns nothing
| __caching__                                                         |
| `glue.memoize(f, [narg], [weak]) -> f`                              | memoize pattern
| `glue.memoize_multiret(f, [narg], [weak]) -> f`                     | memoize for multiple-return-value functions
| `glue.tuples([narg], [weak]) -> f(...) -> t`                        | create a tuple space
| `glue.weaktuples([narg]) -> f(...) -> t`                            | create a weak tuple space
| `glue.tuple(...) -> t`                                              | create a tuple in a global weak tuple space
| __objects__                                                         |
| `glue.inherit(t, parent) -> t`                                      | set or clear inheritance
| `glue.object([super][, t], ...) -> t`                               | create a class or object (see description)
| `glue.before(class, method_name, f)`                                | call f at the beginning of a method
| `glue.after(class, method_name, f)`                                 | call f at the end of a method
| `glue.override(class, method_name, f)`                              | override a method
| `glue.gettersandsetters([getters], [setters], [super]) -> mt`       | create a metatable that supports virtual properties
| __os__                                                              |
| `glue.win`                                                          | true if platform is Windows
| __i/o__                                                             |
| `glue.canopen(filename[, mode]) -> filename \| nil`                 | check if a file exists and can be opened
| `glue.readfile(filename[, format][, open]) -> s \| nil, err`        | read the contents of a file into a string
| `glue.readpipe(cmd[,format][, open]) -> s \| nil, err`              | read the output of a command into a string
| `glue.writefile(filename, s\|t\|read, [format], [tmpfile])`         | write data to file safely
| `glue.printer(out[, format]) -> f`                                  | virtualize the print() function
| __time__                                                            |
| `glue.time([utc, ][t]) -> ts`                                       | like `os.time()` with optional UTC and date args
| `glue.time([utc, ][y, [m], [d], [h], [min], [s], [isdst]]) -> ts`   | like `os.time()` with optional UTC and date args
| `glue.utc_diff([t]) -> seconds`                                     | seconds to UTC
| `glue.day([utc, ][ts], [plus_days]) -> ts`                          | timestamp at day's beginning from `ts`
| `glue.month([utc, ][ts], [plus_months]) -> ts`                      | timestamp at month's beginning from `ts`
| `glue.year([utc, ][ts], [plus_years]) -> ts`                        | timestamp at year's beginning from `ts`
| `glue.timeago(ts[, from_ts]) -> s`                                  | format relative time
| __sizes__                                                           |
| `glue.kbytes(x [,decimals]) -> s`                                   | format byte size in k/M/G/T-bytes
| __errors__                                                          |
| `glue.assert(v [,message [,format_args...]]) -> v`                  | assert with error message formatting
| `glue.protect(func) -> protected_func`                              | wrap an error-raising function
| `glue.pcall(f, ...) -> true, ... \| false, traceback`               | pcall with traceback
| `glue.fpcall(f, ...) -> result \| nil, traceback`                   | coding with finally and except (protected)
| `glue.fcall(f, ...) -> result`                                      | coding with finally and except
| __modules__                                                         |
| `glue.module([name, ][parent]) -> M`                                | create a module
| `glue.autoload(t, submodules) -> M`                                 | autoload table keys from submodules
| `glue.autoload(t, key, module\|loader) -> t`                        | autoload table keys from submodules
| `glue.bin`                                                          | get the script's directory
| `glue.luapath(path [,index [,ext]])`                                | insert a path in package.path
| `glue.cpath(path [,index])`                                         | insert a path in package.cpath
| __allocation__                                                      |
| `glue.freelist([create], [destroy]) -> alloc, free`                 | freelist allocation pattern
| `glue.buffer(ctype) -> alloc(minlen) -> buf,capacity`               | auto-growing buffer
| `glue.dynarray(ctype[,cap]) -> alloc(minlen\|false) -> buf, minlen` | auto-growing buffer that preserves data
| `glue.dynarray_pump([dynarray]) -> write(), collect()`              | make a buffer with a `write()` API for writing into
| `glue.dynarray_loader([dynarray]) -> get(), put(), collect()`       | make a buffer with a `get()/put()` API for writing into
| `glue.readall(read, self, ...) -> buf, len`                         | repeat read based on a `read` function
| `glue.buffer_reader(buf, len) -> read`                              | make a read function that consumes a buffer
| `glue.malloc(size) -> p`                                            | C malloc
| `glue.realloc(p, size) -> p`                                        | C realloc
| `glue.free(p)`                                                      | C free
| __ffi__                                                             |
| `glue.addr(ptr) -> number \| string`                                | store pointer address in Lua value
| `glue.ptr([ctype, ]number\|string) -> ptr`                          | convert address to pointer
| `glue.getbit(val, mask) -> true\|false`                             | get the value of a single bit from an integer
| `glue.setbit(val, mask, bitval) -> val`                             | set the value of a single bit from an integer
| `glue.bor(flags, bits, [strict]) -> mask`                           | `bit.bor()` that takes a string or table

# API

## Math

### `glue.round(x[, p]) -> y` <br> `glue.snap(x[, p]) -> y`

Round a number towards nearest integer or multiple of `p`.
Implemented as `math.floor(x / p + .5) * p`.
Rounds half-up (i.e. it returns `-1` for `-1.5`).
Works with numbers up to `+/-2^52`.
It's not dead accurate as it returns eg. `1` instead of `0`
for `0.49999999999999997` (the number right before `0.5`) which is < `0.5`.

## `glue.floor(x[, p]) -> y`

Round a number towards nearest smaller integer or multiple of `p`.
Implemented as `math.floor(x / p) * p`.

## `glue.ceil(x[, p]) -> y`

Round a number towards nearest larger integer or multiple of `p`.
Implemented as `math.ceil(x / p) * p`.

### `glue.clamp(x, min, max)`

Clamp a value in range. Implemented as `math.min(math.max(x, min), max)`,
so if `max < min`, the result is `max`.

### `glue.lerp(x, x0, x1, y0, y1) -> y`

Linear interpolation, i.e. linearly project `x` in `x0..x1` range to
the `y0..y1` range.

### `glue.sign(x) -> 1|0|-1`

Return sign of `x`.

### `glue.strict_sign(x) -> 1|-1`

Return strict sign of `x`.

### `glue.nextpow2(x) -> y`

Find the smallest `n` for which `x <= 2^n`.

### `glue.repl(x, v, r) -> x`

If x == v, return r, otherwise return x.

### `glue.random_string(n) -> s`

Generate random string of length `n`.

### `glue.uuid() -> s`

Generate random UUID (v4).

Don't forget to seed the randomizer first, eg. with
`math.randomseed(require'time'.clock())` or what have you.

------------------------------------------------------------------------------

## Varargs

### `glue.pack(...) -> t`

Pack varargs. Implemented as `n = select('#', ...), ...}`.

### `glue.unpack(t,[i][,j]) -> ...`

Unpack varargs. Implemented as `unpack(t, i or 1, j or t.n or #t)`.

------------------------------------------------------------------------------

## Tables

### `glue.count(t[, maxn]) -> n`

Count the keys in a table, optionally up to `maxn`.

------------------------------------------------------------------------------

### `glue.index(t) -> dt`

Switch table keys with values.

------------------------------------------------------------------------------

### `glue.keys(t[,sorted|cmp]) -> dt` <br> `glue.sortedkeys(t[,cmp]) -> dt`

Make an array of all the keys of `t`, optionally sorted. The second arg
can be `true`, `'asc'`, `'desc'` or a comparison function.

------------------------------------------------------------------------------

### `glue.sortedpairs(t[,cmp]) -> iter() -> k,v`

Like pairs() but in key order.

The implementation creates a temporary table to sort the keys in.

------------------------------------------------------------------------------

### `glue.update(dt,t1,...) -> dt`

Update a table with elements of other tables, overwriting any existing keys.

  * falsey arguments are skipped.

------------------------------------------------------------------------------

### `glue.merge(dt,t1,...) -> dt`

Update a table with elements of other tables skipping on any existing keys.

  * falsey arguments are skipped.

------------------------------------------------------------------------------

### `glue.attr(t,k1[,v])[k2] = v`

Idiom for `t[k1][k2] = v` with auto-creating of `t[k1]` if not present.

------------------------------------------------------------------------------

## Arrays

### `glue.extend(dt,t1,...) -> dt`

Extend an array with the elements of other arrays.

  * falsey arguments are skipped.
  * array elements are the ones from 1 to `#dt`.

#### Uses

Accumulating values from multiple array sources.

------------------------------------------------------------------------------

### `glue.append(dt,v1,...) -> dt`

Append non-nil arguments to an array.

#### Uses

Appending an object to a flattened array of arrays (eg. appending a path
element to a 2d path).

------------------------------------------------------------------------------

### `glue.shift(t,i,n) -> t`

Shift all the array elements starting at index `i`, `n` positions to the left
or further to the right.

For a positive `n`, shift the elements further to the right, effectively
creating room for `n` new elements at index `i`. When `n` is 1, the effect
is the same as for `table.insert(t, i, t[i])`. The old values at index `i`
to `i+n-1` are preserved, so `#t` still works after the shifting.

For a negative `n`, shift the elements to the left, effectively removing
`n` elements at index `i`. When `n` is -1, the effect is the same as for
`table.remove(t, i)`.

#### Uses

Removing a portion of an array or making room for more elements inside the array.

------------------------------------------------------------------------------

### `glue.map(t, field|f,...) -> t`

Map function `f(k, v, ...) -> v1` over the key-value pairs of `t` or.

If `f` is not a function, then the values of `t` must be themselves tables,
in which case `f` is a key to pluck from those tables. Plucked functions
are called as methods and their result is selected instead. This allows eg.
calling a method for each element in a table of objects and collecting
the results in a table.

------------------------------------------------------------------------------

### `glue.imap(t, field|f,...) -> t`

Map function `f(v, ...) -> v1` over the array elements of `t` taken to be
from `1` up to `t.n or #t`.

If `f` is not a function, then the values of `t` must be themselves tables,
in which case `f` is a key to pluck from those tables. Plucked functions
are called as methods and their result is selected instead. This allows eg.
calling a method for each element in an array of objects and collecting
the results in an array.

------------------------------------------------------------------------------

### `glue.indexof(v, t, [i], [j]) -> i`

Scan an array for a value and if found, return the index.

__NOTE:__ Works on ffi arrays too if `i` and `j` are provided.

------------------------------------------------------------------------------

### `glue.binsearch(v, t, [cmp], [i], [j]) -> i`

Return the smallest index whereby inserting the value `v` in sorted array `t`
will keep `t` sorted i.e. `t[i-1] < v` and `t[i] >= v`. Return `nil` if `v`
is larger than the largest value or if `t` is empty.

The comparison function `cmp` is called as `cmp(t, i, v)` and must return
`true` when `t[i] < v`. Built-in functions are also available by passing
one of `'<'`, `'>'`, `'<='`, `'>='`.

__TIP:__ Use a `cmp` that returns `true` when `t[i] > v` to search in a
reverse-sorted array (i.e. use `'>'`).

__TIP:__ Use a `cmp` that returns `true` when `t[i] <= v` to get the *largest*
index (as opposed to the *smallest* index) that will keep `t` sorted when
inserting `v`, i.e. `t[i-1] <= v` and `t[i] > v`.

__NOTE:__ Works on ffi arrays too if `i` and `j` are provided.

------------------------------------------------------------------------------

### `glue.sortedarray([sa]) -> sa`

Creates an array that stays sorted with insertion, searching and removal
in O(log n) leveraging binary search.

  * if given an existing `sa` to be wrapped, it must be already sorted.
  * `sa.cmp` is used for `cmp` in `binarysearch()`.
  * use `sa:push(v)` to add values.
  * use `sa:find(v) -> i|nil` to look up values.
  * use `sa:remove_value(v) -> v|nil` to find and remove a value.

------------------------------------------------------------------------------

### `glue.reverse(t, [i], [j]) -> t`

Reverse an array in-place and return the input arg.

__NOTE:__ Works on ffi arrays too if `i` and `j` are provided.

------------------------------------------------------------------------------

## Strings

### `glue.gsplit(s,sep[,start[,plain]]) -> iter() -> e[,captures...]`

### `glue.split(s,sep[,start[,plain]]) -> {s1,...}`

Split a string by a separator pattern (or plain string) and iterate over
the elements.

  * if sep is "" return the entire string in one iteration
  * if s is "" return s in one iteration
  * empty strings between separators are always returned,
  eg. `glue.gsplit(',', ',')` produces 2 empty strings
  * captures are allowed in sep and they are returned after the element,
    except for the last element for which they don't match (by definition).

------------------------------------------------------------------------------

### `glue.names('name1 ...') -> {'name1', ...}`

Split a string by whitespace. Unlike `glue.split(s, '%s+')`, it ignores
resulting empty elements. Also, non-string args pass through.

------------------------------------------------------------------------------

### `glue.capitalize(s) -> s`

Capitalize the first letter of every word in string.

------------------------------------------------------------------------------

### `glue.lines(s, [opt], [init]) -> iter() -> s, i, j, k`

Iterate the lines of a string. For each line it returns the line contents,
the content-start, content-end and the next-content-start indices.

  * the lines are split at `\r\n`, `\r` and `\n` markers.
  * the line ending markers are included or excluded depending on the second
  arg, which can be `*L` (include line endings; default) or `*l` (exclude).
  * if the string is empty or doesn't contain a line ending marker, it is
  iterated once.
  * if the string ends with a line ending marker, one more empty string is
  iterated.
  * `init` tells it where to start parsing (default is 1).

------------------------------------------------------------------------------

### `glue.outdent(s, [indent]) -> s, indent`

Remove spaces/tabs indentation of multi-line text based on the indentation
of the first line. If a subsequent line is less indented than the first line,
returns the original string. If `indent` given, it is prepended to each line.

------------------------------------------------------------------------------

### `glue.lineinfo(s, [i]) -> line, col`

Given a byte position in a text, return the text position. If `i` is not
given, returns a function `f(i)` that is faster on repeat calls.

------------------------------------------------------------------------------

### `glue.trim(s) -> s`

Remove whitespace (defined as Lua pattern `"%s"`) from the beginning and end of a string.

------------------------------------------------------------------------------

### `glue.pad(s, n, [c], dir) -> s` <br> `glue.lpad(s, n, [c]) -> s` <br> `glue.rpad(s, n, [c]) -> s`

Pad a string `s` to length `n` using char `c` (which defaults to `' '`)
on its right (dir = 'r') or left (dir = 'l').

------------------------------------------------------------------------------

### `glue.esc(s[,mode]) -> pat`

Escape magic characters of the string `s` so that it can be used as a pattern
to string matching functions.

  * the optional argument `mode` can have the value `"*i"` (for case
  insensitive), in which case each alphabetical character in `s` will also be
  escaped as `"[aA]"` so that it matches both its lowercase and uppercase
  variants.
  * escapes embedded zeroes as the `%z` pattern.

#### Uses

  * workaround for lack of pattern syntax for "this part of a match is an
  arbitrary string"
  * workaround for lack of a case-insensitive flag in pattern matching
  functions

------------------------------------------------------------------------------

### `glue.tohex(s|n[,upper]) -> s`

Convert a binary string or a Lua number to its hex representation.

  * lowercase by default
  * uppercase if the arg `upper` is truthy
  * numbers must be in the unsigned 32 bit integer range

------------------------------------------------------------------------------

### `glue.fromhex(s[, isvalid]) -> s`

Convert a hex string to its binary representation. Returns `nil` on invalid
input unless `isvalid` is `true` which makes it raise on invalid input.

------------------------------------------------------------------------------

### `glue.starts(s, prefix) -> t|f`

Find if string `s` starts with `prefix`. Implemented as `s:sub(1, #p) == p`
which is 5x faster than `s:find'^...'` in LuaJIT 2.1 with JIT on (and about
the same with jit off).

------------------------------------------------------------------------------

### `glue.ends(s, suffix) -> t|f`

Find if string `s` ends with `suffix`.

------------------------------------------------------------------------------

### `glue.subst(s, t) -> s`

Replace all `{foo}` occurences within `s` with `t.foo`.

------------------------------------------------------------------------------

### `glue.catargs(sep, ...) -> s`

Concat args, skipping `nil` ones. Returns `nil` on zero non-nil args.

------------------------------------------------------------------------------

## Iterators

### `glue.collect([i,]iterator) -> t`

Iterate an iterator and collect its i'th return value of every step into an array.

  * i defaults to 1

------------------------------------------------------------------------------

## Stubs

### `glue.pass(...) -> ...`

The identity function. Does nothing, returns back all arguments.

#### Uses

Default value for optional callback arguments:

```lua
function urlopen(url, callback, errback)
   callback = callback or glue.pass
   errback = errback or glue.pass
   ...
   callback()
end
```

### `glue.noop()`

Does nothing. Returns nothing.

------------------------------------------------------------------------------

## Caching

### `glue.memoize(f, [narg], [weak]) -> f`

### `glue.memoize_multiret(f, [narg], [weak]) -> f`

Memoization for functions with any number of arguments. `memoize()` supports
functions with _one return value_. `memoize_multiret()` supports any function.
Both support `nil` and `NaN` args and retvals.

Memoization guarantees to only call the original function _once_ for the same
combination of arguments.

Special attention is given to the vararg part of the function, if any. For
instance, for a function `f(x, y, ...)`, calling `f(1)` is considered to be
the same as calling `f(1, nil)`, but calling `f(1, nil)` is not the same as
calling `f(1, nil, nil)`.

The optional `narg` argument fixates the function to always take exactly
`narg` args regardless of how the function was defined.

The optional `weak` argument makes the cache of returned values weak and is
useful for caching objects that are pinned elsewere without leaking memory.
Using this flag requires that the function to be memoized returns heap
objects only and always!

### `glue.tuples([narg], [weak]) -> f(...) -> t`

### `glue.weaktuples([narg]) -> f(...) -> t`

Create a tuple space, which is a function that returns the same identity `t`
for the same list of arguments. It is implemented as:

```lua
local tuple_mt = {__call = glue.unpack}
function glue.tuples(...)
	return glue.memoize(function(...)
		return setmetatable(glue.pack(...), tuple_mt)
	end, ...)
end
```
Tuples are immutable lists that can be used as table keys because they have
value semantics since the tuple constructor returns the same identity for
the exact same list of identities.

The result tuple can be expanded back by calling it: `t() -> args...`.

> __NOTE:__ Tuple elements are indexed internally with a hash tree.
Creating a tuple thus takes N hash lookups and M table creations, where N+M
is the number of elements in the tuple. Lookup time depends on how dense the
tree is on the search path, which depends on how many existing tuples share
a first sequence of elements with the tuple being created. In particular,
creating tuples out of all permutations of a certain set of values hits the
worst case for lookup time, but creates the minimum amount of tables relative
to the number of tuples.

### `glue.tuple([narg]) -> t`

Create a tuple in a default global weak tuple space.

------------------------------------------------------------------------------

## Objects

### `glue.inherit(t, parent) -> t` <br> `glue.inherit(t, nil) -> t`

Set a table to inherit attributes from a parent table, or clear inheritance.

If the table has no metatable and inheritance has to be set, not cleared,
then make it one.

To get the effect of static (single or multiple) inheritance, use `glue.update`.

When setting inheritance, you can pass in a function.

Unlike `glue.object`, this doesn't add any keys to the object.

------------------------------------------------------------------------------

### `glue.object([super][, t], ...) -> t`

Create a class or object from `t` (which defaults to `{}`) by setting `t`
as its own metatable, setting `t.__index` to `super` and `t.__call` to
`super.__call`. Extra args are passed to `glue.update(self, ...)`.
This simple object model has the following qualities:

  * the implementation is only 4 LOC (14 LOC if extra args are used) and can
  thus be copy-pasted into any module to avoid a dependency on the glue library.
  * funcall-style instantiation with `t(...)` which calls `t:__call(...)`.
  * small memory footprint (3 table slots and no additional tables).
  * subclassing from instances is allowed (prototype-based inheritance).
  * `glue.object` can serve as a stub class/instance constructor:
  `t.__call = glue.object` (`t.new = glue.object` works too).
  * a separate constructor to be used only for subclassing can be made with
  the same pattern: `t.subclass = glue.object`.
  * virtual classes (aka dependency injection, aka nested inner classes
  whose fields and methods can be overridden by subclasses of the outer
  class): composite objects which need to instantiate other objects can be
  made extensible by exposing those objects' classes as fields of the
  container class with `container_class.inner_class = inner_class` and
  instantiating with `self.inner_class(...)` so that replacing `inner_class`
  in a sub-class of `container_class` is possible. Moreso, instantiation with
  `self:inner_class(...)` (so with a colon) passes the container object to
  `inner_class`'s constructor automatically which allows referencing the
  container object from the inner object.
  * overriding syntax sugar so that the super class need not be referenced
  explicitly when overriding can be incorporated into the base class with
  `base.override = glue.override`.

------------------------------------------------------------------------------

### `glue.before(class, method_name, f)`

Modify a method such that it calls `f` at the beginning. `f` receives all
the arguments passed to the method. `f`'s results are discarded.

Usage:

```lua
glue.before(foo, 'bar', function(self, ...)
    ...
end)
```

Alternatively,

```lua
foo.before = glue.before
foo:before('bar', function(self, ...)
  ...
end)
```
------------------------------------------------------------------------------

### `glue.after(class, method_name, f)`

Modify a method such that it calls `f` at the end. `f` receives all the
arguments passed to the method. The modified method returns what `f` returns.

Usage:

```lua
glue.after(foo, 'bar', function(self, ...)
    ...
end)
```

Alternatively,

```lua
foo.after = glue.after
foo:after('bar', function(self, ...)
  ...
end)
```
------------------------------------------------------------------------------

### `glue.override(class, method_name, f)`

Override a method such that the new implementation only calls `f` as
`f(inherited, self, ...)` where `inherited` is the old implementation.
`f` receives all the method arguments and the method returns what `f` returns.

Usage:

```lua
glue.override(foo, 'bar', function(inherited, self, ...)
  ...
  local ret = inherited(self, ...)
  ...
end)
```

Alternatively,

```lua
foo.override = glue.override
foo:override('bar', function(inherited, self, ...)
  ...
  local ret = inherited(self, ...)
  ...
end)
```
------------------------------------------------------------------------------

### `glue.gettersandsetters([getters], [setters], [super]) -> mt`

Return a metatable that supports virtual properties with getters and setters.
Can be used with setmetatable() and ffi.metatype(). `super` is for preserving
the functionality of `__index` while `__index` is being used for getters.

------------------------------------------------------------------------------

## I/O

### `glue.canopen(file[, mode]) -> filename | nil`

Checks whether a file exists and it's available for reading or writing.
The `mode` arg is the same as for `io.open` and defaults to 'rb'.

------------------------------------------------------------------------------

### `glue.readfile(filename[,format][,open]) -> s | nil, err`

Read the contents of a file into a string.

  * `format` can be `"t"` in which case the file will be read in text mode
  (default is binary mode).
  * `open` is the file open function which defaults to `io.open`.

------------------------------------------------------------------------------

### `glue.readpipe(cmd[,format][,open]) -> s | nil, err`

Read the output of a command into a string.
The options are the same as for `glue.readfile`.

------------------------------------------------------------------------------

### `glue.replacefile(oldpath, newpath)`

Move or rename a file. If `newpath` exists and it's a file, it is replaced
by the old file atomically. The operation can still fail under many
circumstances like if `newpath` is a directory or if the files are
in different filesystems or if `oldpath` is missing or locked, etc.

For consistent behavior across OSes, both paths should be absolute paths
or just filenames.

On LuaJIT, this is implemented based on `MoveFileExA` on Windows.

------------------------------------------------------------------------------

### `glue.writefile(filename,s|t|read,[format],[tmpfile]) -> ok, err`

Write the contents of a string, table or iterator to a file.

  * the contents can be given as a string, an array of strings, or a function
  that returns a string or `nil` to signal end-of-stream.
  * `format` can be `"t"` in which case the file will be written in text mode
   (default is binary mode). It can also be `"a"` or `"at"` for appending.
  * `tmpfile` enables atomic saving via a temporary file (enabled by default)
  which is then renamed to `filename` and if writing or renaming fails the
  temp file is removed and `filename` is not touched (and if the program is
  killed while writing, you get a stale temp file but no data corruption).
  If `tmpfile` is false and writing fails then `filename` is removed (and if
  the program is killed while writing, you get a partially written file).

------------------------------------------------------------------------------

### `glue.printer(out[, format]) -> f`

Create a `print()`-like function which uses the function `out` to output
its values and uses the optional `format` to format each value. For instance
`glue.printer(io.write, tostring)` returns a function which behaves like
the standard `print()` function.

------------------------------------------------------------------------------

### `glue.time([utc, ][t]) -> ts` <br> `glue.time([utc, ][year, [month], [day], [hour], [min], [sec], [isdst]]) -> ts`

Like `os.time()` but considers the arguments to be in UTC if either `utc`
or `t.utc` is `true`.

__NOTE:__ You should only use `os.date()` and `os.time()` and therefore
`glue.time()` for current dates and use something else for historical dates
because these functions don't work with negative timestamps because
apparently time didn't exist before UNIX. At least they don't suffer from
Y2038 so that's that.

__NOTE:__ `os.time()` has second accuracy (so those timestamps are integers).
For sub-second accuracy use the [time](time.md) module.

------------------------------------------------------------------------------

### `glue.utc_diff([t]) -> seconds`

Difference between local time and UTC in seconds.

------------------------------------------------------------------------------

### `glue.day([utc, ][ts], [plus_days]) -> ts`

Timestamp at day's beginning from `ts`, plus/minus some days.

------------------------------------------------------------------------------

### `glue.month([utc, ][ts], [plus_months]) -> ts`

Timestamp at month's beginning from `ts`, plus/minus some months.

------------------------------------------------------------------------------

### `glue.year([utc, ][ts], [plus_years]) -> ts`

Timestamp at year's beginning from `ts`, plus/minus some years.

------------------------------------------------------------------------------

### `glue.timeago(ts[, from_ts]) -> s`

Format relative time, eg. `3 hours ago` or `in 2 weeks`.

------------------------------------------------------------------------------

## Errors

### `glue.assert(v[,message[,format_args...]])`

Like `assert` but supports formatting of the error message using
`string.format()`.

This is better than `assert(v, string.format(message, format_args...))`
because it avoids creating the message string when the assertion is true.

__CAVEAT__: Unlike standard `assert()`, this only returns its first argument
even when no message is given, to avoid returning the error message and its
args when a message is given and the assertion is true. So the pattern
`a, b = glue.assert(f())` doesn't work.

#### Example

```lua
glue.assert(depth <= maxdepth, 'maximum depth %d exceeded', maxdepth)
```

------------------------------------------------------------------------------

### `glue.protect(func) -> protected_func`

In Lua, API functions conventionally signal errors by returning nil and
an error message instead of raising errors.
In the implementation however, using assert() and error() is preferred
to coding explicit conditional flows to cover exceptional cases.
Use this function to convert error-raising functions to nil,err-returning
functions:

```lua
protected_function = glue.protect(function()
	...
	assert(...)
	...
	error(...)
	...
	return result_value
end)

local ret, err = protected_function()
```

------------------------------------------------------------------------------

### `glue.pcall(f,...) -> true,... | false,traceback`

With Lua's pcall() you lose the stack trace, and with usual uses of pcall()
you don't want that. This variant appends the traceback to the error message.

> __NOTE__: Lua 5.2 and LuaJIT only.

------------------------------------------------------------------------------

### `glue.fpcall(f,...) -> result | nil,traceback`

### `glue.fcall(f,...) -> result`

These constructs bring the try/finally/except idiom to Lua. The first variant
returns nil,error when errors occur while the second re-raises the error.

#### Example

```lua
local result = glue.fpcall(function(finally, except, ...)
  local temporary_resource = acquire_resource()
  finally(function() temporary_resource:free() end)
  ...
  local final_resource = acquire_resource()
  except(function() final_resource:free() end)
  ... code that might break ...
  return final_resource
end, ...)
```
> __NOTE__: Lua 5.2 and LuaJIT only.

------------------------------------------------------------------------------

## Modules

### `glue.module([name, ][parent]) -> M, P`

### `glue.module([parent, ][name]) -> M, P`

Create a module with a public and private namespace and set the environment
of the calling function (not the global one!) to the module's private
namespace and return the namespaces. Cross-references between the namespaces
are also created at `M._P`, `P._M`, `P._P` and `M._M`, so both `_P` and `_M`
can be accessed directly from the new environment.

`parent` controls what the namespaces will inherit and it can be either
another module, in which case `M` inherits `parent` and `P` inherits
`parent._P`, or it can be a string in which case the module to inherit is
first required. `parent` defaults to `_M` so that calling `glue.module()`
creates a submodule of the current module. If there's no `_M` in the current
environment then `P` inherits `_G` and `M` inherits nothing.

Specifying a `name` for the module either returns `package.loaded[name]`
if it is set or creates a module, sets `package.loaded[name]` to it and
returns that. This is useful for creating and referencing shared namespaces
without having to make a Lua file and require that.

Naming the module also sets `P[name] = M` so that public symbols can be
declared in `foo.bar` style instead of `_M.bar`.

Setting `foo.module = glue.module` makes module `foo` directly extensible
by calling `foo:module'bar'` or `require'foo':module'bar'`.

NOTE: All that functionality is done in just 27 LOC, less than it takes
to explain it, so read the code to get to another level of clarity.

### `glue.autoload(t, submodules) -> t` <br> `glue.autoload(t, key, module|loader) -> t`

Assign a metatable to `t` (or override an existing metatable's `__index`) such
that when a missing key is accessed, the module said to contain that key is
require'd automatically.

The `submodules` argument is table of form `{key = module_name | load_function}`
specifying the corresponding Lua module (or load function) that make each key
available to `t`. The alternative syntax allows specifying the key - submodule
associations one by one.

#### Motivation

Module autoloading allows splitting the implementation of a module in many
submodules containing optional, self-contained functionality, without having
to make this visible in the user API. This effectively disconnects how an API
is modularized from how its implementation is modularized, allowing the
implementation to be refactored at a later time without changing the API.

#### Example

**main module (foo.lua):**

```lua
local function bar() --function implemented in the main module
  ...
end

--create and return the module table
return glue.autoload({
   ...
   bar = bar,
}, {
   baz = 'foo_extra', --autoloaded function, implemented in module foo_extra
})
```

**submodule (foo_extra.lua):**

```lua
local foo = require'foo'

function foo.baz(...)
  ...
end
```

**in usage:**

```lua
local foo = require'foo'

foo.baz(...) -- foo_extra was now loaded automatically
```

------------------------------------------------------------------------------

### `glue.bin`

Get the script's directory. This allows finding files in the script's
directory regardless of the directory that Lua is started in.

#### Example

```lua
local foobar = glue.readfile(glue.bin .. '/' .. file_near_this_script)
```

#### Caveats

The path is relative to the current directory, so this stops working as soon
as the current directory is changed. Also, depending on how the LuaJIT process
was started, this information might be missing or wrong since it's set by the
parent process. Better use `fs.exedir` which has none of these problems.

------------------------------------------------------------------------------

### `glue.luapath(path[,index[,ext]])`

Insert a Lua search pattern in `package.path` such that `require` will be able
to load Lua modules from that path. The optional `index` arg specifies the
insert position (default is 1, that is, before all existing paths; can be
negative, to start counting from the end; can be the string 'after', which is
the same as 0). The optional `ext` arg specifies the file extension to use
(default is "lua").

------------------------------------------------------------------------------

### `glue.cpath(path[,index])`

Insert a Lua search pattern in `package.cpath` such that `require` will be
able to load Lua/C modules from that path. The `index` arg has the same
meaning as with `glue.luapath`.

#### Example

```lua
glue.luapath(glue.bin)
glue.cpath(glue.bin)

require'foo' --looking for `foo` in the same directory as the running script first
```

------------------------------------------------------------------------------

## Allocation

### `glue.freelist([create], [destroy]) -> alloc, free`

Returns `alloc() -> e` and `free(e)` functions to allocate and deallocate
Lua objects. The allocator returns the last freed object or calls `create()`
to create a new one if the freelist is empty. `create` defaults to
`function() return {} end`; `destroy` defaults to `glue.noop`.

------------------------------------------------------------------------------

### `glue.buffer(ctype) -> alloc(minlen|false) -> buf, capacity`

(LuaJIT only) Return an allocation function that reuses or reallocates
an internal buffer based on the `len` argument.

  * `ctype` must be a VLA: the returned buffer will have that type.
    this makes `glue.buffer(ctype)` compatible with `ffi.typeof(ctype)`.
  * the buffer only grows, it never shrinks and it only grows in
    powers of two steps.
  * the allocation function returns the buffer's current capacity which
    can be equal or greater than the requested length.
  * the returned buffer is anchored by the allocation function. calling
    `alloc(false)` unanchors the buffer.
  * the contents of the buffer _are not preserved_ between allocations
    but you _are allowed_ to access both buffers between two consecutive
    allocations in order to do that yourself.

------------------------------------------------------------------------------

### `glue.dynarray(ctype[, min_capacity]) -> alloc(minlen|false) -> buf, minlen`

Like `glue.buffer()` but preserves data between reallocations, and always
returns `minlen` instead of capacity.

------------------------------------------------------------------------------

### `glue.readall(read, self, ...) -> buf, len`

Repeat read based on a `read(self, buf, len, ...) -> readlen` function.

------------------------------------------------------------------------------

### `glue.buffer_reader(buf,len | nil,err) -> read`

Return a `read(buf, len) -> readlen` function that consumes data from the
supplied buffer. The supplied `buf,len` can also be `nil,err` in which case
the `read` function will always return just that. The buffer must be a
`(u)int8_t` pointer or VLA.

------------------------------------------------------------------------------

### `glue.malloc(size) -> p`

C malloc. Returns `nil` on failure.
Use only for allocating large chunks.
Not gc-tied (must call `free`).

### `glue.realloc(p, size) -> p`

C realloc. Returns `nil` on failure.
Not gc-tied (must call `free`).

### `glue.free(p)`

C free.

------------------------------------------------------------------------------

## FFI

### `glue.addr(ptr) -> number | string`

Convert the address of a pointer into a Lua number (or possibly string
on 64bit platforms). This is useful for:

  * hashing on pointer values (i.e. using pointers as table keys)
  * moving pointers in and out of Lua states when using [luastate](luastate.md)

### `glue.ptr([ctype,]number|string) -> ptr`

Convert an address value stored as a Lua number or string to a cdata pointer,
optionally specifying a ctype for the pointer (defaults to `void*`).

------------------------------------------------------------------------------

### `glue.getbit(val, mask) -> true|false`

Get the value of a single bit from an integer.

### `glue.setbit(val, mask, bitval) -> val`

Set the value of a single bit from an integer.

### `glue.bor(flags, bits, [strict]) -> mask`

`bit.bor()` that takes its arguments as a string of form `'opt1 opt2 ...'`,
a list of form `{'opt1', 'opt2', ...}` or a map of form `{opt->true}`
and performs `bit.bor()` on the numeric values of those arguments where
the numeric values are given as the `bits` table of form `{opt->bitvalue}`.

Useful for Luaizing C functions that take bitmask flags.

Example: `glue.bor('a c', {a=1, b=2, c=4}) -> 5`.

------------------------------------------------------------------------------

# Tips

String functions are also in the `glue.string` table.
You can extend the Lua `string` namespace:

	glue.update(string, glue.string)

so you can use them as string methods:

	s:trim()

------------------------------------------------------------------------------

# Adding new functions to glue

## Naming

The idea is to find the most popular, familiar and _short_ names for _each
and every_ function (no underscores and no capitals). Python gets this right,
so does UNIX. A function with an unheard of name or alien semantics will be
avoided. People rather recall known names/semantics rather than learn
unfamiliar new names/semantics, even when those would be more clear.

## Semantics

Follow the general [API design](../PROGRAMMING.md) rules.

### Objects vs glue

Don't provide data structures like list and set in a glue library, or a way
to do OOP. Instead just provide the mechanisms as functions working on bare
tables. Don't do both either: if your list type gets widely adopted, your
programs will now be a mixture of bare tables (this is inevitable) and lists
so now you have to decide which of your lists has a `sort()` method and which
need to be wrapped first.

### Write in Lua

String lambdas, callable strings, list comprehensions are all fun, but they
add syntax and a learning curve and should be generally avoided in contexts
where their use is spare.

### Sugar

Don't add shortcut functions except when calling the shortcut function makes
the intent clearer than when reading the equivalent Lua code.

If something is an idiom, don't add a function for it, use it directly.
Chances are its syntax will be more popular than its name. Eg. it's
harder to recall and trust semantic equivalence of `isnan(x)` to the odd
looking but mnemonic idiom `x ~= x` (eg. does `isnan` raise an error when `x`
is not a number?). That doesn't mean `a < b and a or b` is a good idiom for
`math.min(a, b)` though, `min()` itself is the idiom as we know it from math
(`sign()`, `clamp()`, etc. are idioms too).

Functional programming sugars like `compose` and `bind` makes code harder to
read because brains are slow to switch between abstraction levels unless it's
a self-contained DSL with radically different syntax and semantics than the
surrounding code. Eg. it's easier to read a Lua string pattern or an embedded
SQL string than it is to read expressions involving `bind` and `compose`
which force you to simulate the equivalent Lua syntax in your head.

## Implementation

Keep the code readable and compact. Code changes that compromise these
qualities for optimization should come with a benchmark to justify them.

Document the limits of the algorithms involved with respect to input, like
when does it have non-linear performance and if and how it is stack bound.
Performance characteristics are not an implementation detail.
