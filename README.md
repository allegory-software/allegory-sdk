
# :candy: The Allegory SDK

A self-contained programming environment for developing web-based
**database-driven business apps** in **LuaJIT** and **JavaScript**.

The **server-side** is written in Lua and contains:

 * async web server, http client, DNS resolver.
 * coroutine-based epoll scheduler for sockets and pipes.
 * async process execution with pipes and shared memory.
 * OS threads with synchronized queues.
 * the fastest libraries for hashing, encryption, compression, image codecs,
   image resizing, JSON and XML codecs, CSV parsing and XLSX generation.
 * RDBMS engine based on the MDBX key-value store.
 * database schema DSL with automatic schema sync.
 * ...and more, see full list of modules below.

The **client-side** is [canvas-ui], an immediate-mode GUI (IMGUI) library
written in JavaScript with no dependencies, featuring an editable virtual grid,
built-in screen sharing and more.

[canvas-ui]: https://github.com/allegory-software/canvas-ui

# Who is this for?

For experienced developers who could build this themselves but want a head
start. This is not a black box, and treating it as one will only bring sadness.
This code is supposed to be read, understood, owned and tailored to fit, not
abstracted away and extended.

If you're of the mind that procedural > functional > OOP, library > framework, JavaScript > TypeScript, relational > NoSQL, less LOC > more LOC, and you get
a rash whenever you hear the words "build system", "package manager",
"folder structure", "microservice", "container" or "dependency injection",
then this is for you.

# Status

The [master branch](https://github.com/allegory-software/allegory-sdk/commits/master)
is stable, the [dev branch](https://github.com/allegory-software/allegory-sdk/commits/dev)
is the kitchen.

Look at the [issues](https://github.com/allegory-software/allegory-sdk/issues)
to see what's missing, broken or wanted.

# Compatibility

  * Linux/x64, all major browsers.

# Binaries & Building

Binaries for Debian 12 are in the repo. To rebuild for your distro, clone all
git submodules and run `c/build-all`. It won't take long and you won't chase
dependencies.

For more info see the [Building Guide](c/README.md) which also teaches how
to create build scripts for new libraries without using a build system.

# Server Runtime

  * [LuaJIT](RUNTIME.md)               - Custom build of LuaJIT

# Server Modules

* __Standard Library__
  * [glue](lua/glue.lua)               - "Assorted lengths of wire" library
  * [pp](lua/pp.lua)                   - Pretty printer and serializer
  * [errors](lua/errors.lua)           - Structured exceptions
  * [errors_io](lua/errors_io.lua)     - Exceptions for writing protocols
  * [coro](lua/coro.lua)               - [Symmetric coroutines](https://stackoverflow.com/questions/41891989) for cross-yielding
  * [logging](lua/logging.lua)         - Logging to files and network
  * [events](lua/events.lua)           - Event system (pub/sub) mixin for any object or class
  * [lpeglabel](c/lpeglabel/lpeglabel.md) - PEG (Parsing Expression Grammars) parser with labels
  * [daemon](lua/daemon.lua)           - Scaffold/boilerplate for writing server apps
  * [cmdline](lua/cmdline.lua)         - Command-line arg processing
  * [pbuffer](lua/pbuffer.lua)         - Dynamic binary buffer for decoding and encoding
  * [lang](lua/lang.lua)               - Multi-language, country and currency support
  * [reflect](lua/reflect.lua)         - [FFI reflection](https://corsix.github.io/ffi-reflect/) library
* __Platform APIs__
  * [fs](lua/fs.lua)                   - Files, directories, symlinks, pipes, memory mapping
  * [proc](lua/proc.lua)               - Async process execution with I/O redirection
  * [path](lua/path.lua)               - Path manipulation
  * [unixperms](lua/unixperms.lua)     - Unix permissions string parser
  * [time](lua/time.lua)               - Wall clock, monotonic clock, sleep
* __Multi-threading__
  * [os_thread](lua/os_thread.lua)     - High-level threads API based on pthread and luastate
  * [luastate](lua/luastate.lua)       - Create Lua interpreters to use with OS threads
  * [pthread](lua/pthread.lua)         - Low-level threads
* __Multi-tasking__
  * [tasks](lua/tasks.lua)             - Task system with process hierarchy, output capturing and scheduling
* __Networking__
  * [sock](lua/sock.lua)               - Sockets & async scheduler for sockets & pipes
  * [sock_libtls](lua/sock_libtls.lua) - TLS-encrypted async TCP sockets
  * [connpool](lua/connpool.lua)       - Connection pools
  * [resolver](lua/resolver.lua)       - Async DNS resolver
  * [http_client](lua/http_client.lua) - Async [HTTP(s) 1.1](lua/http.lua) client for high-volume web scraping
  * [http_server](lua/http_server.lua) - Async [HTTP(s) 1.1](lua/http.lua) server
  * [smtp](lua/smtp.lua)               - Async SMTP(s) client
  * [mess](lua/mess.lua)               - Simple TCP-based protocol for Lua programs
  * [url](lua/url.lua)                 - URL parsing and formatting
* __Data Exchange__
  * [base64](lua/base64.lua)           - Base64 encoding & decoding
  * [json](lua/json.lua)               - Fast JSON encoding & decoding
  * [msgpack](lua/msgpack.lua)         - MessagePack encoding & decoding
  * [xml_parse](lua/xml_parse.lua)     - XML SAX parsing
  * [xml](lua/xml.lua)                 - XML formatting
  * [csv](lua/csv.lua)                 - CSV parsing
  * [xlsxwriter](lua/xlsxwriter.md)    - Excel 2007+ XLSX file generation
  * [multipart](lua/multipart.lua)     - Multipart MIME encoding
* __Hashing__
  * [xxhash](lua/xxhash.lua)           - Fast non-cryptographic hash (based on [xxHash](https://cyan4973.github.io/xxHash/))
  * [blake3](lua/blake3.lua)           - Fast secure hash & MAC (based on [BLAKE3](https://github.com/BLAKE3-team/BLAKE3))
  * [sha1](lua/sha1.lua)               - SHA1 hash
  * [sha2](lua/sha2.lua)               - SHA2 hash
  * [hmac](lua/hmac.lua)               - HMAC signing
  * [bcrypt](lua/bcrypt.lua)           - Password hashing
* __Compression__
  * [gzip](lua/gzip.lua)               - DEFLATE & GZIP (based on [zlib-ng](https://github.com/zlib-ng/zlib-ng))
  * [zip](lua/zip.lua)                 - ZIP file reading, creating and updating (based on [minizip-ng](https://github.com/zlib-ng/minizip-ng))
* __Databases__
  * [schema](lua/schema.lua)           - Database schema diff'ing and migrations
  * [mdbx](lua/mdbx.lua)               - MDBX database binding
  * [mdbx_schema](lua/mdbx_schema.lua) - Relational database engine over MDBX
  * [mdbx_scan](lua/mdbx_scan.lua)     - Table scanner for MDBX
  * [mdbx_query](lua/mdbx_query.lua)   - Query compiler for MDBX
* __Raster Images__
  * [jpeg](lua/jpeg.lua)               - Fast JPEG decoding & encoding (based on [libjpeg-turbo](https://libjpeg-turbo.org/))
  * [png](lua/png.lua)                 - Fast PNG decoding & encoding (based on [libspng](https://libspng.org/))
  * [bitmap](lua/bitmap.lua)           - Bitmap conversions
  * [pillow](lua/pillow.lua)           - Fast image resizing (based on [Pillow-SIMD](https://github.com/uploadcare/pillow-simd#pillow-simd))
  * [resize_image](lua/resize_image.lua) - Image resizing and format conversion
* __Templating__
  * [mustache](lua/mustache.lua)       - [Logic-less templates](https://mustache.github.io/) rendered on the server
* __Data Structures__
  * [heap](lua/heap.lua)               - Priority Queue
  * [queue](lua/queue.lua)             - Ring Buffer
  * [linkedlist](lua/linkedlist.lua)   - Linked List
  * [lrucache](lua/lrucache.lua)       - LRU Cache
* __Math__
  * [ldecnumber](c/ldecNumber/ldecnumber.txt) - Fixed-precision decimal numbers math
  * [rect](lua/rect.lua)               - 2D rectangle math
* __Support Libs__
  * [cpu_supports](lua/cpu_supports.lua) - Check CPU SIMD sets at runtime
* __Dev Tools__
  * [debugger](lua/debugger.lua)       - Lua command-line debugger

The runtime and the modules up to here can be used as a base to build any kind
of app including desktop apps (just add your favorite UI toolkit). You can also
use it as a base for your own web framework, since this part is mostly mechanical
and non-opinionated. The opinionated part comes next.

## Web Framework

* __The Webb Web Framework__
  * [webb](lua/webb.lua)               - Procedural web framework
  * [webb_action](lua/webb_action.lua) - Action-based routing with multi-language URL support
  * [webb_auth](lua/webb_auth.lua)     - Session-based authentication
  * [webb_spa](lua/webb_spa.lua)       - Single-page app scaffolding
  * [webb_app](lua/webb_app.lua)       - Webb-based application server
* __The Webb Web Framework / Client-side__
  * [webb_spa.js](www/webb_spa.js)     - client-side counterpart of [webb_spa.lua](lua/webb_spa.lua)
  * [mustache.js](www/mustache.js)     - [Logic-less templates](https://mustache.github.io/) rendered on the client
  * [glue.js](https://github.com/allegory-software/canvas-ui/blob/main/www/glue.js) - Utilities on the client side (part of [canvas-ui]).
* __Support Libs__
  * [jsmin](c/jsmin/jsmin.txt)         - JavaScript minification

## UI Widgets

Widgets are provided by [canvas-ui].

# Working on the SDK

Read the [Programming Guide](PROGRAMMING.md) if you want to keep up with the
style and conventions of the code base.

# License

The Allegory SDK is MIT Licensed.
3rd-party libraries have various non-viral free licenses.

# Questions you might have

### Why LuaJIT (for web apps)?

Any language with closures, lexical scoping, coroutines, a good FFI and zero
compile time would do. Even today, only LuaJIT fits the bill.

Plus Lua has non-opinionated semantics (they call that "mechanism, not policy"),
which is something very rare these days.

### Why not OpenResty?

Inversion of control, Byzantine declarative config. Use nginx as a load balancer.

### Why not Golang or Node?

Hackability. Golang and Node have their networking guts written in C, while this
is Lua all the way down to OS APIs with a few exceptions.
