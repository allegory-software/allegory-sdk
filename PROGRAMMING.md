
# Lua coding style

__NOTE__: This guide assumes familiarity with the
[LuaStyleGuide](http://lua-users.org/wiki/LuaStyleGuide) from the Lua wiki.
Read that first if you're new to Lua.

## General

Start each module with small comment specifying what the module does,
who's the author and what the license is:

```lua

--glue: everyday Lua functions.
--Written by Cosmin Apreutesei. Public domain.

...
```

Don't embed the full contents of the license in the source code.

## Formatting

Indent code with tabs, and use spaces inside the line, don't force your
tab size on people (also, very few editors can jump through space indents).
If you can't follow this, use 3 spaces for Lua and 4 spaces for C.

Keep lines under 80 chars as much as you reasonably can.

Tell your editor to remove trailing spaces and to keep an empty line at EOF.

Use `\r\n` as line separator only for Windows-specific modules, if at all.
Generally just use `\n`.

## Modules

Don't use `module()`, it's not necessary. Just make things global, that's ok,
it forces you find good names and it makes user code easier to read because
there's no renaming involved, everybody knows one thing.

## Submodules

Name submodules of `foo` `foo_bar.lua` instead of `foo/bar.lua`. In general,
*don't make directories* unless you really really have to.

Submodules can be loaded manually by the user with require() or they can be
set up to be loaded automatically with `autoload()`.

## Naming

Take time to find good names and take time to _re-factor those names_
as much as necessary. As a wise stackoverflow user once said,
the process of naming makes you face the horrible fact that you have
no idea what you're doing.

Use Lua's naming conventions `foo_bar` and `foobar` instead of `FooBar` or `fooBar`.

### Temporary variables

  * `t` is for tables
  * `dt` is for destination (accumulation) tables
  * `i` and `j` are for indexing
  * `n` is for counting
  * `k, v` is what you get out of pairs()
  * `i, v` is what you get out of ipairs()
  * `k` is for table keys
  * `v` is for values that are passed around
  * `x` is for generic math quantities
  * `s` is for strings
  * `c` is for 1-char strings
  * `f`, `fn`, `func` are for functions
  * `f` is also for files
  * `o` is for objects
  * `ret` is for return values
  * `ok, ret` is what you get out of `pcall`
  * `buf, sz` is a (buffer, size) pair
  * `p` is for pointers
  * `x, y, w, h` is for rectangles
  * `t0`, `t1` is for timestamps
  * `err` is for errors
  * `t0`, `i0`, etc. is for "previous value of"

### Abbreviations

Abbreviations are ok, just don't forget to document them when they first
appear in the code. Short names are mnemonic and you can juggle more of them
in your head at the same time, and they're indicative of a deeply understood
problem: you're not being lazy for using them.

## Comments

Assume your readers already know Lua so try not to teach that to them
(it would only show that you're really trying to teach it to yourself).
But don't tell them that the code "speaks for itself" either because
it doesn't. Take time to document the tricky parts of the code.
If there's an underlying narrative on how you solved a problem, take time
to document that too. Don't worry about how long that is, people love stories.
And in fact the high-level overview, how everything is put together
is _much more important_ than the nitty-gritty details and it's too often missing.

## Syntax

* use `foo()` instead of `foo ()`.
* use `foo{}` instead of `foo({})` (there's no font to save you from that).
* use `foo'bar'` instead of `foo"bar"`, `foo "bar"` or `foo("bar")`.
* use `foo.bar` instead of `foo['bar']`.
* use `local function foo() end` instead of `local foo = function() end`.
(this sugar shouldn't have existed, but it's too late now, use it).
* put a comma after the last element of vertical lists.

## FFI Declarations

Put cdefs in a separate `foo_h.lua` file because it may contain types that
other modules might need. If this is unlikely and the API is small, embed
the cdefs in the main module file directly.

Add a comment on top of your `foo_h.lua` file describing the origin
(which files? which version?) and process (cpp? by hand?) used for generating
the file. This adds confidence that the C API is complete and up-to-date
and can hint a maintainer on how to upgrade the definitions.

Call `ffi.load()` without paths, custom names or version numbers to keep
the module away from any decisions regarding how and where the library
is to be found. This allows for more freedom on how to deploy libraries.

## Idioms

Below is a list of Lua idioms that may not be immediately apparent to the
casual code reader. It's ok and even encouraged to use these instead of
making library functions for them. More complicated patterns belong
to the [glue](lua/glue.lua) library.

| Idiom | Decription |
| :---  | :---       |
| __logic__                                   |
| `not a == not b`                            | both or none
| __numbers__                                 |
| `min(max(x, x0), x1)`                       | clamp x (upper limit takes precedence)
| `x ~= x`                                    | number is NaN
| `1/0`                                       | inf
| `-1/0`                                      | -inf
| `floor(x+.5)`                               | round
| `(x >= 0 and 1 or -1)`                      | sign
| __tables__                                  |
| `next(t) == nil`                            | table is empty
| __strings__                                 |
| `s:match'^something'`                       | starts with
| `s:match'something$'`                       | ends with
| `s:match'["\'](.-)%1'`                      | match pairs of single or double quotes
| __i/o__                                     |
| `f:read(4096, '*l')`                        | read lines efficiently

------------------------------------------------------------------------------

# Programming for LuaJIT

## LuaJIT assumptions

* LuaJIT hoists table accesses with constant keys out of loops, so caching
module functions in locals is no longer needed, except if the JIT bails out.
* LuaJIT hoists constant branches out of loops so it's ok to specialize
loop kernels with `if/else` or with `and/or` inside the loops.
* LuaJIT inlines functions (except when using `...` and `select()` with
non-constant indices), so it's ok to specialize loop kernels with function
composition.
* multiplications and additions are cheaper than memory access, so storing
the results of these operations in temporary variables might actually harm
performance (more register spills).
* there's no difference between using `if/else` statements and using
`and/or` expressions -- they generate the same branchy code, so avoid
expressions with non-constant `and/or` operators in tight loops.
* divisions are 4x slower than multiplications on x86, so when dividing by
a constant, it helps turning `x / c` into `x * (1 / c)` since the constant
expression is folded -- LuaJIT does this already for power-of-2 constants
where the semantics are proven to be equivalent.
* the `%` operator is slow (it's implemented in terms of `math.floor()`
and division) and really kills hot loops; `math.fmod()` is even slower;
I don't have a solution for this except for `x % powers-of-two` which
can be computed with bit ops.
* `__newindex` and `__index` metamethods must check the hash part of the
table, so it's best to avoid adding keys on the hash part of an array
that uses these metamethods.
* pointers and 64bit numbers are allocated on the heap unless sunk by
allocation sinking, but that requires a small and predictable code path
between pointer creation and usage so it's not a general solution.
So APIs that need to be fast should work with (base-pointer, offset) pairs
instead of just pointers.

## LuaJIT gotchas

### Nil equality of pointers

`ptr == nil` evaluates to true for a NULL pointer. As innocent as this looks,
this is actually a language extension because in Lua 5.1 world, objects of
different types can't ever be equal, so a cdata cannot be equal to nil.

This has two implications:

1. Lua-ffi cannot implement this for Lua 5.1, so compatibility with Lua
cannot be acheived if this idiom is used.
2. The `if ptr then` idiom doesn't work, although you'd expect that anything
that `== nil` to pass the `if` test too.

Both problems can be solved easily with a NULL->nil converter which must be
applied on all pointers that flow into Lua (so mostly in constructors):

```lua
function ptr(p)
	return p ~= nil and p or nil
end
```

### Reference semantics vs value semantics

The result of `a[i]` for an array of structs is a reference type,
not a copy of the struct object. This is different than with arrays
of scalars which have value semantics (scalars being immutable).
This shows when trying to implement data structures that generalize
on the element type. Because value semantics cannot be assumed,
you can't just use `a[i]` to pop a value out or for swapping values
(the idiom `a[i], a[j] = a[j], a[i]` doesn't work anymore).

### Callbacks and JIT

JIT must be disabled on any Lua function that calls a C function that can
trigger a ffi callback or you might get a "bad callback" exception. LuaJIT
takes great pains to ensure that you won't, but there's no guarantee. This
can turn into a "99% is worse than 0%" situation, because you might forget
to disable the jit for a particular callback-triggering function only to get
a crash in production.

There is currently no way to disable these jit barriers.

### Callbacks and passing structs by value

Currently, passing structs by value or returning structs by value is not
supported with callbacks. This is generally not a problem, as most APIs
don't do that.

### CData finalizer call order

Finalizers for cdata objects are called in undefined order. This means that
objects anchored in a finalizer are not guaranteed to not be already finalized
when that finalizer is called.

Consider this:

```lua
local heap = ffi.gc(CreateHeap(), FreeHeap)

local mem = ffi.gc(CreateMem(heap, size), function(mem)
	FreeMem(heap, mem) -- heap anchored in mem's finalizer
end)
```

When the program exits, sometimes the heap's finalizer is called before
mem's finalizer, even though mem's finalizer holds a reference to heap.
So it's ok and useful to anchor objects in finalizers, but don't _use_ them
in finalizers unless you can ensure that they're still alive by other means.

There is no way to fix this with the current garbage collector.

### Floating point numbers from outside

In places where an arbitrary bit pattern can be injected in place of a double
or float, you have to normalize these to a standard NaN pattern
(`0xffc00000` for floats and `0xfff8000000000000` for doubles), or check for
NaN before accessing them. Failing to do so will get you a crash.

> The bit pattern for NaN is: exponent is all '1', mantissa non-zero,
sign ignored.

Here's a handy NaN checker for doubles:

```lua
local cast, band, bor = ffi.cast, bit.band, bit.bor
local lohi_p = ffi.typeof("struct { int32_t "..(
  ffi.abi("le") and "lo, hi" or "hi, lo").."; } *")

local function double_isnan(p)
   local q = cast(lohi_p, p)
   return band(q.hi, 0x7ff00000) == 0x7ff00000 and
	        bor(q.lo, band(q.hi, 0xfffff)) ~= 0
end
```

## LuaJIT tricks

Pointer to number conversion that turns into a no-op when compiled:

	tonumber(ffi.cast('intptr_t', ffi.cast('void *', ptr)))

Switching endianness of a 64bit integer (to use in conjunction with
`ffi.abi'le'` and `ffi.abi'be'`):

	local p = ffi.cast('uint32*', int64_buffer)
	p[0], p[1] = bit.bswap(p[1]), bit.bswap(p[0])

------------------------------------------------------------------------------

# Making Lua APIs

## The golden rule

Design is overrated. An API that is refactored and tweaked many times by the
person that is using it for something serious will always be superior to
an API "designed" on imagined use cases. It's the same with programming
languages and everything. So don't worry about getting your API right, you
will never get it perfect, which is why you need to own as much of your stack
as you possibly can, so that you can constantly re-fit things so that they
work better together with less friction, and for that you need to be able to
change things at every level of the stack. The lower down the stack you can
fix something, the better it is for everything that sits on it.

## Compact your API

Structuring your API semantically makes it easier to learn and later
to recall because humans work best with semantic hierarchies.
Here's a few techniques you can use:

  * group functions into namespaces (the easy one, and the wrong approach!)
  * group semantic variations into a single function using parameter
  polymorphism (aka function overloading)

Lua uses both of these techniques to extremes, making its API seem much
smaller than it actually is, eg. by carefully shelving even the most basic
functions like `table.insert` into their proper namespaces, or cramming
multiple variations for reading from a file into a single function,
`file:read()` with a `mode` argument with values that form a small namespace
of their own and are cleverly mnemonic.

Note that semantic hierarchies are different than classification hierarchies.
In terms of helping with remembering, the first is good, the second is bad.
Eg. `file:read(mode)` creates a semantic hierarchy file -> read -> mode
because each level in the hierarchy contains a concept of a different kind
(file object -> file method -> mode parameter). Human memory is helped by
this association. But `urllib.parse.urlparse` is a classification hierarchy,
which although a logical one to make from the implementation point of view,
the fact that `urlparse` is to be found under the `parse` sub-namespace is
completely arbitrary from the user's pov. and thus hard to remember.

## Caveats of function overloading

Dispatching based on select('#', ...) means there's now a difference between
passing a nil as the last argument or not passing that argument at all which
can lead to subtle bugs. Eg. if function `f` is sensitive to the number
of arguments passed, the expression `f(a,b,c,g())` is now sensitive to
whether `g()` returns nil or nothing which can lead to hard to find bugs
since many functions signal a missing result value implicitly by exiting
the function scope instead of calling `return nil`. It can also make it
harder to wrap such a function sometimes, eg. to cap a depth variable
with an optional maximum value you can't just write
`depth = math.min(depth, maxdepth)`, instead you have to write
`depth = math.min(depth, maxdepth or depth)`.

Dispatching based on type can create ambiguities when passing objects
with metamethods, eg. a function that can use either a table or an iterator
to get its data would have to decide on how it would use a callable table
(which eg. modules and classes sometimes are). Again, analyze the usage
scenarios to decide: if they lead to a clear choice, the ambiguity is
resolved, if not, avoid the overloading.

Make argument optional only when it doesn't leave you wondering what
the default is, eg. as the default separator for a `split()` function would.
Contrast with `table.concat` for which the default separator is implied
by the verb.

Avoid boolean flag arguments, you can never tell what they stand for
by looking at the code, eg. `fileopen(filename, mode = '*b' or '*t')`
not `fileopen(filename, is_binary)` which could just as well be
`fileopen(filename, is_text)` and you wouldn't know which by looking
at a code like: `fileopen('file', false)`. On the other hand,
it's ok to use use boolean for on/off enable/disable switches.
Avoid inverted switches though where `true` means "disabled".
Even when "disabled" is the default value it's usually better to
disambiguate on `nil` rather than make an inverted flag.

Don't close your semantic options with generalized rules like "arguments
should never/always be coerced" or "mutating operations should never
return a value". A function's behavior and signature is dictated by
its usage patterns which may be idiosyncratic and thus make generalized
rules seem arbitrary.
Eg. `t = update({}, t)` works better than `tt = {}; update(tt, t); t = tt`.

## Convention over configuration

Don't make it configurable if it affects portability, eg. a table
serialization function that generates Lua code can be made to generate
locale-dependent identifier keys that Lua 5.2 would refuse to load.
Instead of making this choice a configuration option, it's better to just
generate ascii identifier keys.

Don't make it configurable if there's a clear best choice between alternatives,
even if that would upset some users. Avoid compulsive customization.
Best to add in customization options after presented with use cases from users,
and use them to justify and document each option.

## Virtualization is overrated

Lua doesn't have the virtualization capabilities of some of the more extreme
OO languages like Eiffel. In these languages you have enough hooks to achieve
semantic equivalence of the native types and it's not easy to subvert the
virtualization, making libraries mostly work automatically with the new types.
This model is incompatible with Lua for practical reasons. The high
performance standard that Lua has set to follow is enough of a show-stopper:
hooks are expensive to check and many standard utilities exploit implementation
details for performance. It is also a broken model philosophically because
abstractions leak, like how `1/0` breaks when LUA_NUMBER is int,
or `#` lacking a good definition for a utf-8 string. It's also because of
Lua's philosophy of "mechanism not policy" that you don't even have a clear
(semantic or behavioral) definition of what exactly an array is.
The Lua standard library is also hostile to virtualization, typechecking
arguments and refusing to check hooks all over the place. If still
not convinced, search the Lua mailing list for "`__next`". I don't know why
they even bothered with `__pairs` and `__ipairs`. This clearly isn't going
anywhere.

That being said, there may be patterns of virtualization that you might want
to care for. In particular, callable tables and userdata are common enough
that typechecking for functions could be made with a function which also
checks for `__call` besides `type(f)=='function'`. Virtualized functions work
because the API of a function (i.e. what you can do with it) is almost
leak-free: except for dumping and loading, all you can do with a function
is call it and pass it around.

## Mutating arguments

Never mutate received arguments except on constructors, where you should
accept an `options` arg and convert that into the constructed object.

