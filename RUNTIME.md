
## What Lua dialect is this?

This is a custom build of LuaJIT 2.1, which means the base language is
[Lua 5.1](http://www.lua.org/manual/5.1/manual.html) plus the following
extensions:

 * [LuaJIT's bit, ffi and jit modules](http://luajit.org/extensions.html#modules)
 * [LuaJIT's extensions](http://luajit.org/extensions.html#lua52)
   from [Lua 5.2](http://www.lua.org/manual/5.2/manual.html),
   including those enabled with `DLUAJIT_ENABLE_LUA52COMPAT`
 * [LuaJIT's string.buffer module](https://htmlpreview.github.io/?https://github.com/LuaJIT/LuaJIT/blob/v2.1/doc/ext_buffer.html)
 * `!` can be used in `package.path` and `package.cpath` on Linux and OSX too.

## How it was built

 * `package.path` and `package.cpath` looks only in the SDK for modules.
 * built with `-pthread` so that pthread.lua can be used.
 * built with `-msse4.2`.

## How to run Lua scripts with it

	$ path-to-sdk/bin/linux/luajit        myapp.lua
	> path-to-sdk\bin\windows\luajit.exe  myapp.lua

## How to make portable apps with it

A portable app is one that runs from any current directory (CWD).
For that to work all the files that are loaded by the app at runtime must be
looked for in locations that are relative to the app's directory. That
includes modules loaded by `require()`, shared libraries loaded by the OS,
as well as any assets, config files, etc. that the app loads.

The LuaJIT executable is already set up to find Lua modules and shared
libraries from the SDK independent of CWD, but it doesn't know anything
about your app's directory layout.

To enable `require()` to look for Lua modules in your app's directory too,
call `luapath(scriptdir())` (use `luacpath()` for Lua/C modules).

If your app also contains shared libraries, you need to make the OS aware
of their location. You can't just give absolute paths to `ffi.load()`
because if your shared libraries also depend on (that is, are dynamically
linked to) other shared libraries, it's the OS that has to load those,
not LuaJIT. The fix is to either call `sopath()` before loading shared
libraries from your app dir, or call `ffi.load` with absolute paths on
all dependencies to preload them.

As for other files that you load explicitly, just make sure to only use paths
that are relative to `scriptdir()` (eg. use `indir(scriptdir(), 'rel path')`).

Changing CWD to `scriptdir()` from the beginning (`chdir(scriptdir())`)
and using only relative paths throughout the app also works if you can make
sure that the CWD will not be changed afterwards from other parts of the app.
