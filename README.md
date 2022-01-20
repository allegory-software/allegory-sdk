
# The Allegory SDK

The **Allegory SDK** is a self-contained programming environment for developing
**web apps** on **Linux** and **Windows** using **LuaJIT** and **JavaScript**.

The stack is written entirely in Lua including networking and scheduling
and contains a web server as a library, a procedural web framework, database
connectors for MySQL and Tarantool, an async DNS resolver, a http client
and more, all leveraging Lua's powerful coroutines, made even more powerful
with symmetric coroutines, and using epoll and IOCP for I/O multiplexing.

On the client side, a collection of **web components** written in plain
JavaScript, including a **data-bound virtual editable tree-grid widget**,
complete the picture for developing **SAAS data-driven business apps**,
the primary use case of the SDK.

# Status

Follow the [releases](https://github.com/allegory-software/allegory-sdk/releases)
to see what's new and the [dev branch](https://github.com/allegory-software/allegory-sdk/commits/dev)
to see what's cooking for the next release.<br>
Look at the [issues](https://github.com/allegory-software/allegory-sdk/issues)
to see what's missing, broken or wanted.

# Compatibility

 * Operating Systems: **Debian 10**, **Windows 10**
 * Browsers: **Desktop Chrome**, **Desktop Firefox** (Safari planned)
 * Architectures: x86-64

# Binaries

Binaries are included in separate repos for each supported platform and are
versioned to follow the main repo.

	$  git clone git@github.com:allegory-software/allegory-sdk-bin-debian10  bin/linux
	>  git clone git@github.com:allegory-software/allegory-sdk-bin-windows   bin/windows

# Building

See our [Building Guide](BUILDING.md) which also teaches how create build
scripts for new libraries.

# Documentation

* __Runtime__
  * [LuaJIT](RUNTIME.md)               - custom build of LuaJIT
* __Standard Library__
  * [glue](lua/glue.lua)               - "Assorted lengths of wire" library
  * [pp](lua/pp.lua)                   - Pretty printer and serializer
  * [coro](lua/coro.lua)               - Symmetric coroutines for yielding accross iterators
  * [errors](lua/errors.lua)           - Structured exceptions for writing network protocols
  * [logging](lua/logging.lua)         - Logging to files and network
  * [lpeglabel](lua/lpeglabel.lua)     - PEG (Parsing Expression Grammars) parser
  * [$](lua/$.lua)                     - "Drop all your tools on the floor" library
* __OS APIs__
  * [time](lua/time.lua)               - Wall clock, monotonic clock, sleep (Windows, Linux, OSX)
  * [fs](lua/fs.lua)                   - Filesystem API with mmapping and symlinks (Windows, Linux, OSX)
  * [proc](lua/proc.lua)               - Async processes with I/O redirection (Windows, Linux)
  * [pthread](lua/pthread.lua)         - Low-level threads (Linux, Windows, OSX)
  * [luastate](lua/luastate.lua)       - Create Lua interpreters to use with OS threads
  * [thread](lua/thread.lua)           - High-level threads API based on pthread and luastate
  * [path](lua/path.lua)               - File path manipulation
  * [unixperms](lua/unixperms.lua)     - Unix permissons parser
* __Networking__
  * [sock](lua/sock.lua)               - Async sockets (Windows/IOCP, Linux/epoll)
  * [resolver](lua/resolver.lua)       - Async DNS resolver
  * [connpool](lua/connpool.lua)       - Connection pools
  * [http_client](lua/http_client.lua) - HTTP 1.1 async client for high-volume web scraping
  * [http_server](lua/http_server.lua) - HTTP 1.1 async server with TLS, gzip, etc.
  * [uri](lua/uri.lua)                 - URI manipulation
* __Data Exchange__
  * [base64](lua/base64.lua)           - Base64 encoding & decoding
  * [cjson](lua/cjson.lua)             - JSON encoding & decoding
  * [msgpack](lua/msgpack.lua)         - MessagePack encoding & decoding
  * [expat](lua/expat.lua)             - XML decoding
  * [genx](lua/genx.lua)               - XML encoding
  * [csv](lua/csv.lua)                 - CSV parsing
  * [xlsxwriter](lua/xlsxwriter.lua)   - XLSX generation
* __Hashing__
  * [xxhash](lua/xxhash.lua)           - xxHash non-cryptographic 32, 64 and 128 bit hash
  * [blake2](lua/blake2.lua)           - BLAKE2 cryptographic hash
  * [sha1](lua/sha1.lua)               - SHA1 hash
  * [sha2](lua/sha2.lua)               - SHA2 hash
  * [md5](lua/md5.lua)                 - MD5 hash
  * [hmac](lua/hmac.lua)               - HMAC signing
* __Compression__
  * [zlib](lua/zlib.lua)               - DEFLATE, ZLIB and GZIP compression & decompression
  * [minizip2](lua/minizip2.lua)       - ZIP file reading, creating and updating
* __Databases__
  * [sqlpp](lua/sqlpp.lua)             - SQL preprocessor
  * [mysql](lua/mysql.lua)             - MySQL async driver
  * [tarantool](lua/tarantool.lua)     - Tarantool async driver
  * [schema](lua/schema.lua)           - Database schema diff'ing and migrations
* __Image Formats__
  * [libjpeg](lua/libjpeg.lua)         - JPEG async decoding & encoding
  * [libspng](lua/libspng.lua)         - PNG decoding & encoding
  * [bmp](lua/bmp.lua)                 - BMP decoding & encoding
  * [bitmap](lua/bitmap.lua)           - Bitmap conversions & effects
* __2D Graphics__
  * [cairo](lua/cairo.lua)             - 2D vector graphics
  * [color](lua/color.lua)             - Color parser and RGB-HSL converters
  * [boxblur](lua/boxblur.lua)         - Fast image blur on CPU
* __Templating__
  * [mustache](lua/mustache.lua)       - Logic-less templates
* __Data Structures__
  * [heap](lua/heap.lua)
  * [queue](lua/queue.lua)
  * [linkedlist](lua/linkedlist.lua)
  * [lrucache](lua/lrucache.lua)
* __Math__
  * [ldecnumber](lua/ldecnumber.lua)   - Fixed-precision decimal numbers math
* __Web Development__
  * [webb](lua/webb.lua)               - Procedural web framework
  * [glue.js](www/glue.js)             - JS standard utilities
  * [divs.js](www/divs.js)             - DOM API and mechanism for web components
  * [mustache.js](www/mustache.js)     - Mustache templates
* __Web Components__
  * [x-widgets.js](lua/x-widgets.lua)  - Data-bound widgets
* __Support Libs__
  * [jsmin](lua/jsmin.lua)             - Minify JavaScript code
  * [linebuffer](lua/linebuffer.lua)   - Line buffer for text-based network protocols

# Contributing code

The SDK is open to contributions for fixing bugs and improving the existing
modules. We also accept new modules but we take the liberty to chose what to
include if we are to take resonsibility for maintaining them.

Before contributing code to the repo, it might be helpful to read our
[Programming Guide](PROGRAMMING.md) which contains:

 * The Lua coding style guide,
 * Notes on programming for LuaJIT,
 * Notes on Lua API design,
 * Notes on contributing code.

# License

The Allegory SDK is MIT Licensed.
3rd-party libraries have various non-viral free licenses.

------------------------------------------------------------------------------
<sup>Allegory SDK (c) 2020 Allegory Software SRL</sup>
