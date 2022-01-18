
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
  * [LuaJIT](docs/luajit.md)           - custom build of LuaJIT
* __Standard Library__
  * [glue](docs/glue.md)               - "Assorted lengths of wire" library
  * [pp](docs/pp.md)                   - Pretty printer and serializer
  * [coro](docs/coro.md)               - Symmetric coroutines for yielding accross iterators
  * [errors](docs/errors.md)           - Structured exceptions for writing network protocols
  * [logging](docs/logging.md)         - Logging to files and network
  * [lpeglabel](docs/lpeglabel.md)     - PEG (Parsing Expression Grammars) parser
  * [$](docs/$.md)                     - "Drop all your tools on the floor" library
* __OS APIs__
  * [time](docs/time.md)               - Wall clock, monotonic clock, sleep (Windows, Linux, OSX)
  * [fs](docs/fs.md)                   - Filesystem API with mmapping and symlinks (Windows, Linux, OSX)
  * [proc](docs/proc.md)               - Async processes with I/O redirection (Windows, Linux)
  * [pthread](docs/pthread.md)         - Low-level threads (Linux, Windows, OSX)
  * [luastate](docs/luastate.md)       - Create Lua interpreters to use with OS threads
  * [thread](docs/thread.md)           - High-level threads API based on pthread and luastate
  * [path](docs/path.md)               - File path manipulation
  * [unixperms](docs/unixperms.md)     - Unix permissons parser
* __Networking__
  * [sock](docs/sock.md)               - Async sockets (Windows/IOCP, Linux/epoll)
  * [resolver](docs/resolver.md)       - Async DNS resolver
  * [connpool](docs/connpool.md)       - Connection pools
  * [http_client](docs/http_client.md) - HTTP 1.1 async client for high-volume web scraping
  * [http_server](docs/http_server.md) - HTTP 1.1 async server with TLS, gzip, etc.
  * [uri](docs/uri.md)                 - URI manipulation
* __Data Exchange__
  * [base64](docs/base64.md)           - Base64 encoding & decoding
  * [cjson](docs/cjson.md)             - JSON encoding & decoding
  * [msgpack](docs/msgpack.md)         - MessagePack encoding & decoding
  * [expat](docs/expat.md)             - XML decoding
  * [genx](docs/genx.md)               - XML encoding
  * [csv](docs/csv.md)                 - CSV parsing
  * [xlsxwriter](docs/xlsxwriter.md)   - XLSX generation
* __Hashing__
  * [xxhash](docs/xxhash.md)           - xxHash non-cryptographic 32, 64 and 128 bit hash
  * [blake2](docs/blake2.md)           - BLAKE2 cryptographic hash
  * [sha1](docs/sha1.md)               - SHA1 hash
  * [sha2](docs/sha2.md)               - SHA2 hash
  * [md5](docs/md5.md)                 - MD5 hash
  * [hmac](docs/hmac.md)               - HMAC signing
* __Compression__
  * [zlib](docs/zlib.md)               - DEFLATE, ZLIB and GZIP compression & decompression
  * [minizip2](docs/minizip2.md)       - ZIP file reading, creating and updating
* __Databases__
  * [sqlpp](docs/sqlpp.md)             - SQL preprocessor
  * [mysql](docs/mysql.md)             - MySQL async driver
  * [tarantool](docs/tarantool.md)     - Tarantool async driver
  * [schema](docs/schema.md)           - Database schema diff'ing and migrations
* __Image Formats__
  * [libjpeg](docs/libjpeg.md)         - JPEG async decoding & encoding
  * [libspng](docs/libspng.md)         - PNG decoding & encoding
  * [bmp](docs/bmp.md)                 - BMP decoding & encoding
  * [bitmap](docs/bitmap.md)           - Bitmap conversions & effects
* __2D Graphics__
  * [cairo](docs/cairo.md)             - 2D vector graphics
  * [color](docs/color.md)             - Color parser and RGB-HSL converters
  * [boxblur](docs/boxblur.md)         - Fast image blur on CPU
* __Templating__
  * [mustache](docs/mustache.md)       - Logic-less templates
* __Data Structures__
  * [heap](docs/heap.md)
  * [queue](docs/queue.md)
  * [linkedlist](docs/linkedlist.md)
  * [lrucache](docs/lrucache.md)
* __Math__
  * [ldecnumber](docs/ldecnumber.md)   - Fixed-precision decimal numbers math
* __Web Development__
  * [webb](docs/webb.md)               - Procedural web framework
  * [glue.js](www/glue.js)             - JS standard utilities
  * [divs.js](www/divs.js)             - DOM API and mechanism for web components
  * [mustache.js](www/mustache.js)     - Mustache templates
* __Web Components__
  * [x-widgets.js](docs/x-widgets.md)  - Data-bound widgets
* __Support Libs__
  * [jsmin](docs/jsmin.md)             - Minify JavaScript code
  * [linebuffer](docs/linebuffer.md)   - Line buffer for text-based network protocols

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
