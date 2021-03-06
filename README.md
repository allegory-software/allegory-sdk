
# :candy: The Allegory SDK

The **Allegory SDK** is a self-contained cross-platform programming
environment for developing web-based **database-driven business apps** in
**LuaJIT** and **JavaScript**.

The **server-side stack** is written entirely in Lua and contains:

 * a coroutine-based scheduler for epoll and IOCP multiplexing.
 * a programmable web-server-as-a-library.
 * a fully-featured http client and async DNS resolver.
 * OS threads with synchronized queues.
 * async process execution with pipes and shared memory.
 * the fastest libraries for hashing, encryption, compression, image codecs,
   image resizing, JSON and XML codecs, CSV parsing and XLS generation.
 * async connectors for MySQL and Tarantool.
 * a powerful SQL preprocessor with conditionals and macros.
 * a database schema DSL with automatic schema synchronization.
 * ...and more, see full list of modules below.

The **client-side stack** is written from scratch in JavaScript and contains:

* a virtual editable tree-grid widget that can handle 100,000 records at 60fps.
* a collection of data-bound widgets for data entry, navigation and reporting.
* layouting widgets for split-pane layouts common in data-dense business applications.
* a mechanism for web components better than the native one.

# Status

Follow the [releases](https://github.com/allegory-software/allegory-sdk/tags)
to see what's new and the [dev branch](https://github.com/allegory-software/allegory-sdk/commits/dev)
to see what's cooking for the next release.<br>
Look at the [issues](https://github.com/allegory-software/allegory-sdk/issues)
to see what's missing, broken or wanted.

# Where it's used

  * [Many Machines - the independent man's SAAS provisioning tool](https://github.com/allegory-software/many-machines)

# Compatibility

 * Operating Systems: **Debian 10+**, **Windows 10**
 * Browsers: Desktop **Chrome**, **Firefox**, **Edge** (Safari planned)
 * CPUs: x86-64 with SSE 4.2 (AVX2 used if found).

# Binaries

Binaries are included in separate repos for each supported platform and are
versioned to follow the main repo.

	$  git clone git@github.com:allegory-software/allegory-sdk-bin-debian10  bin/linux
	>  git clone git@github.com:allegory-software/allegory-sdk-bin-windows   bin/windows

# Building

See our [Building Guide](c/README.md) which also teaches how create build
scripts for new libraries.

# Runtime

  * [LuaJIT](RUNTIME.md)               - Custom build of LuaJIT

# Modules

* __Standard Library__
  * [glue](lua/glue.lua)               - "Assorted lengths of wire" library
  * [pp](lua/pp.lua)                   - Pretty printer and serializer
  * [coro](lua/coro.lua)               - [Symmetric coroutines](https://stackoverflow.com/questions/41891989) for cross-yielding
  * [logging](lua/logging.lua)         - Logging to files and network
  * [events](lua/events.lua)           - Event system (pub/sub) mixin for any object or class
  * [lpeglabel](c/lpeglabel/lpeglabel.md) - PEG (Parsing Expression Grammars) parser with labels
  * [daemon](lua/daemon.lua)           - Scaffold/boilerplate for writing server apps
  * [cmdline](lua/cmdline.lua)         - Command-line arg processing
  * [pbuffer](lua/pbuffer.lua)         - Dynamic binary buffer for decoding and encoding
* __Platform APIs__
  * [fs](lua/fs.lua)                   - Filesystems, pipes, memory mapping
  * [proc](lua/proc.lua)               - Async process execution with I/O redirection
  * [path](lua/path.lua)               - Path manipulation
  * [unixperms](lua/unixperms.lua)     - Unix permissons string parser
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
  * [http_client](lua/http_client.lua) - Async HTTP(s) 1.1 client for high-volume web scraping
  * [http_server](lua/http_server.lua) - Async HTTP(s) 1.1 server
  * [smtp](lua/smtp.lua)               - Async SMTP(s) client
  * [url](lua/url.lua)                 - URL parsing and formatting
  * [ipv6](lua/ipv6.lua)               - IPv6 conversion routines
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
  * [md5](lua/md5.lua)                 - MD5 hash
  * [hmac](lua/hmac.lua)               - HMAC signing
  * [bcrypt](lua/bcrypt.lua)           - Password hashing
* __Compression__
  * [gzip](lua/gzip.lua)               - DEFLATE & GZIP (based on [zlib-ng](https://github.com/zlib-ng/zlib-ng))
  * [minizip2](lua/minizip2.lua)       - ZIP file reading, creating and updating (based on [minizip-ng](https://github.com/zlib-ng/minizip-ng))
* __Databases__
  * [sqlpp](lua/sqlpp.lua)             - SQL preprocessor
  * [mysql](lua/mysql.lua)             - MySQL async driver
  * [tarantool](lua/tarantool.lua)     - Tarantool async driver
  * [schema](lua/schema.lua)           - Database schema diff'ing and migrations
  * [query](lua/query.lua)             - SQL queries with preprocessor on a connection pool
* __Raster Images__
  * [jpeg](lua/jpeg.lua)               - Fast JPEG decoding & encoding (based on [libjpeg-turbo](https://libjpeg-turbo.org/))
  * [png](lua/png.lua)                 - Fast PNG decoding & encoding (based on [libspng](https://libspng.org/))
  * [bmp](lua/bmp.lua)                 - BMP decoding & encoding
  * [bitmap](lua/bitmap.lua)           - Bitmap conversions
  * [pillow](lua/pillow.lua)           - Fast image resizing (based on [Pillow-SIMD](https://github.com/uploadcare/pillow-simd#pillow-simd))
  * [resize_image](lua/resize_image.lua) - Image resizing and format conversion
* __Templating__
  * [mustache](lua/mustache.lua)       - Logic-less [templates](https://mustache.github.io/) on server-side
* __Data Structures__
  * [heap](lua/heap.lua)               - Priority Queue
  * [queue](lua/queue.lua)             - Ring Buffer
  * [linkedlist](lua/linkedlist.lua)   - Linked List
  * [lrucache](lua/lrucache.lua)       - LRU Cache
* __Math__
  * [ldecnumber](c/ldecNumber/ldecnumber.txt) - Fixed-precision decimal numbers math
  * [rect](lua/rect.lua)               - 2D rectangle math
* __Support Libs__
  * [cpu_supports](lua/cpu_supports.lua) - check CPU SIMD sets at runtime
* __Dev Tools__
  * [debugger](lua/debugger.lua)       - Lua command-line debugger
* __Web / Server side__
  * [webb](lua/webb.lua)               - Procedural web framework
  * [webb_action](lua/webb_action.lua) - Action-based routing with multi-language URL support
  * [webb_auth](lua/webb_auth.lua)     - Session-based authentication
  * [webb_spa](lua/webb_spa.lua)       - Single-page app support
  * [jsmin](c/jsmin/jsmin.txt)         - JavaScript minification
* __Web / Client side__
  * [X-Widgets](X-WIDGETS.md)          - Overview of the web components suite
  * [glue.js](www/glue.js)             - JS "assorted lenghs of wire" library
  * [divs.js](www/divs.js)             - DOM API and mechanism for web components
  * [webb_spa.js](www/webb_spa.js)     - SPA client-side counterpart of [webb_spa.lua](lua/webb_spa.lua)
  * [x-widgets.js](www/x-widgets.js)   - Web components & layouting widgets
  * [x-nav.js](www/x-nav.js)           - Model mixin for data-driven widgets
  * [x-grid.js](www/x-grid.js)         - Nav-based virtual tree-grid widget
  * [x-listbox.js](www/x-listbox.js)   - Nav-based listbox widget
  * [x-input.js](www/x-input.js)       - Nav-based single-value (scalar) widgets
  * [x-module.js](www/x-module.js)     - Persistence layer for widget-based self-editing UIs
* __Web / Client side / Support libs__
  * [mustache.js](www/mustache.js)     - Logic-less [templates](https://mustache.github.io/) on client-side
  * [purify.js](www/purify.js)         - HTML sanitizer
  * [markdown-it.js](www/markdown-it.js) - Markdown parser

# Contributing

The SDK is open to contributions for fixing bugs and improving the existing
modules. We also accept new modules but we take the liberty to chose what to
include if we are to take resonsibility for maintaining them.

Before issuing a pull request, it might be helpful to read our
[Programming Guide](PROGRAMMING.md) which contains:

 * The Lua coding style guide,
 * Notes on programming for LuaJIT,
 * Notes on Lua API design.

# License

The Allegory SDK is MIT Licensed.
3rd-party libraries have various non-viral free licenses.

# FAQ

Q: Why Lua (for web apps)?

A: Because Lua is like modern JavaScript, except
[it got there 10 years earlier](https://stackoverflow.com/questions/1022560#1022683)
and it didn't keep the baggage while doing so. That being said, we're all
engineers here, we don't have language affectations. We're just happy to use
a language with stackful coroutines, real closures with full lexical scoping,
hash maps, a garbage collector, a better ffi than we could ever ask for,
and an overall non-opinionated design that doesn't pretend to know better
than its user.

Q: Why not OpenResty?

A: We actually used OpenResty in the past, nothing wrong with it. It's
probably even faster. It definitely has more features. Nginx is however quite
large, not nearly as hackable as our pure-Lua server, it wants to control
the main loop and manage threads all by itself, and its configuration
directives are inescapably byzantine and undebuggable by trying to do
declaratively what is sometimes better done procedurally.

------------------------------------------------------------------------------
<sup>Allegory SDK (c) 2020 Allegory Software SRL</sup>
