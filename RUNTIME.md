
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
  * our own customizations:
    * `package.path` and `package.cpath` looks only in the SDK for modules.
    * built with `-msse4.2` so that it hashes strings with hardware CRC32.
    * built with `-pthread` so that pthread.lua can be used.

## How to run Lua scripts with it

  $ path-to-sdk/bin/linux/luajit        myapp.lua
  > path-to-sdk\bin\windows\luajit.exe  myapp.lua

## How to make portable apps with it

A portable app is one that runs from any current directory (CWD).
For that to work all the files that are loaded by the app at runtime must be
looked for in locations that are relative to the app's directory. That
includes modules loaded by `require()`, shared libraries loaded by the OS,
as well as any assets, config files, etc. that the app loads specifically.

The LuaJIT executable is already set up to find Lua modules and shared
libraries from the SDK independent of CWD, but it doesn't know anything
about your app's directory layout.

To enable `require()` to look for Lua modules in the app's directory too,
call `glue.luapath(fs.scriptdir())`.

If your app also contains shared libraries, you need to make the OS aware
of their location. On Linux this is achieved by setting the `LD_LIBRARY_PATH`
env var. On Windows, you need to change the CWD before loading the libraries
(because CWD is always in the search path on Windows).

As for other files that you load explicitly, just make sure to only use
paths that are relative to `fs.scriptdir()`.

Changing the CWD to `fs.scriptdir()` from the beginning and using only
relative paths throughout the app also works if you can make sure that
the CWD will not be changed afterwards by other parts of the app.
