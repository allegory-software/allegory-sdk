
## What Lua dialect is this?

This is OpenResty's LuaJIT 2.1 fork, which means the base language is
[Lua 5.1](http://www.lua.org/manual/5.1/manual.html) plus the following
extensions:

  * [LuaJIT's bit, ffi and jit modules](http://luajit.org/extensions.html#modules)
  * [LuaJIT's extensions](http://luajit.org/extensions.html#lua52)
    from [Lua 5.2](http://www.lua.org/manual/5.2/manual.html),
    including those enabled with `DLUAJIT_ENABLE_LUA52COMPAT`
  * [LuaJIT's string.buffer module](https://htmlpreview.github.io/?https://github.com/LuaJIT/LuaJIT/blob/v2.1/doc/ext_buffer.html)
  * [OpenResty's extensions](https://github.com/openresty/luajit2#openresty-extensions)
  * our own extensions:
    * `package.exedir` module which returns the full path of the directory of the executable.
    * `package.exepath` module which returns the full path of the executable.
    * `LUA_PATH` and `LUA_CPATH` supports `'!'` in Linux and OSX too.
  * our own customizations:
    * `package.path` and `package.cpath` were modified as described below.
    * `SONAME` is not set in `libluajit.so`.
  * built with `-msse4.2` so that it hashes strings with hardware CRC32.
  * built with `-pthread` so that pthread.lua can be used.

## What is included

Comes with the `luajit` command, which is a simple shell script that finds
and loads the appropriate luajit executable for your platform/arch so that
typing `./luajit` (that's `luajit` on Windows) always works.

## Making portable apps

To make a portable app that can run from any directory out of the box, every
subsystem of the app that needs to open a file must look for that file in
a location relative to the app's directory. This means at least three things:

 * Lua's require() must look in exe-relative dirs first,
 * the OS's shared library loader must look in exe-relative dirs first,
 * the app itself must look for assets, config files, etc. in exe-relative
 dirs first.

The solutions for the first two problems are platform-specific and
are described below. As for the third problem, you can use `package.exedir`.

To get the location of the _running script_, as opposed to that of the
executable, use `glue.bin`, or better yet `fs.scriptdir()`.

### Finding Lua modules

`package.path` was modified to `!\..\..\?.lua` (set in `luaconf.h`).
This allows Lua modules to be found regardless of what the current directory
is, making the distribution portable.

The default `package.cpath` was also modified to `!\clib\?.dll`.
This is to distinguish between Lua/C modules and other binary dependencies
and avoid name clashes on Windows where shared libraries are not prefixed
with `lib`.

The `!` symbol was implemented for Linux and OSX too.

To enable Lua to look for modules in the main script's directory,
use `glue.luapath(fs.scriptdir())`.

#### The current directory

Lua modules (including Lua/C modules) are **not** searched for in the current
directory, unlike standard Lua behavior.

### Finding shared libraries

#### Windows

Windows looks for dlls in the directory of the executable first by default,
and that's where our shared libs are, so isolation from system libraries
is acheived automatically in this case.

#### Linux

Linux binaries are built with `rpath=$ORIGIN` which makes ldd look for
shared objects in the directory of the exe first.

`-Wl,--disable-new-dtags` was also used so that it's `RPATH` not `RUNPATH`
that is being set, which makes `dlopen()` work the same when called from
dynamically loaded code too.

#### OSX

OSX binaries are built with `rpath=@loader_path` which makes the
dynamic loader look for dylibs in the directory of the exe first.

#### The current directory

The current directory is _not used_ for finding shared libraries
on Linux and OSX. It's only used on Windows, but it has lower priority
than the exe's directory.
