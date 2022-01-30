
# Building C libraries

__NOTE:__ Binaries for supported platforms are already included, so
rebuilding them is not necesssary unless you want to.

## What you need to know first

C sources are included as git submodules so you need to clone them first:

	git submodule update --init --recursive

Building is based on bash scripts most of which invoke gcc directly.
To (re)build a library, type:

	sh <lib>/build

To (re)build all libraries, type:

	sh build-all

## Building on Windows for Windows

1. Download and install [MSYS2].

2. Add to PATH (in this order):

		<msys2-path>\mingw64\bin
		<msys2-path>\usr\bin

3. Install the toolchain:

		pacman -S mingw-w64-x86_64-gcc
		pacman -S mingw-w64-x86_64-cmake
		pacman -S make nasm

[MSYS2]: https://repo.msys2.org/distrib/x86_64/msys2-x86_64-20211130.exe

## Building on Linux for Linux

The current stack is built on a **Debian 10 x64 Server**
and it's the only supported way to build it. To install the toolchain, type:

	sudo apt-get install gcc cmake nasm
	sudo apt-get install libssl-dev

Note that Linux binaries are not very backwards compatible because of glibc's
"versioned symbols". If you need backwards-compatible binaries you'll have to
build them on the _oldest_ Linux that you care to support, but using the
_newest_ GCC that you can install on that system. Good luck!

## Binary facts

* both dynamic libraries (stripped) and static libraries are created.
* static libraries can be [bundled](docs/bundle.md) into your app executable.
* libgcc is statically linked.
* libstdc++ is statically linked.
* binaries on Windows are linked to msvcrt.dll.
* the luajit exe on Linux sets `rpath` to `$ORIGIN`
* Lua/C modules on Windows are linked to lua51.dll.

------------------------------------------------------------------------------

# Creating build scripts for new libraries

Note that the same gcc/g++ frontend is used on every platform,
which greatly reduces what you need to know for writing build scripts.

## Build scripts

The best way to create a new build script is to use an existing one as a
starting point so that you retain some desirable properties of the script:

* make it independent of the current directory.
* make it detect the current platform and build for it.

## Output files

The build script must generate binaries as follows:

	bin/windows/foo.dll             C library, Windows
	bin/windows/foo.a               C library, Windows, static version
	bin/windows/clib/foo.dll        Lua/C library, Windows
	bin/windows/foo.a               Lua/C library, Windows, static version
	bin/linux/libfoo.so             C library, Linux
	bin/linux/libfoo.a              C library, Linux, static version
	bin/linux/clib/foo.so           Lua/C library, Linux
	bin/linux/libfoo.a              Lua/C library, Linux, static version

So prefix everything with `lib` except for Windows and except for dynamic
Lua/C libs; put dynamic Lua/C libs in the `clib` subdirectory but put static
Lua/C libs in the platform directory along with the normal C libs.

## Building with GCC

Building with gcc is a 2-step process, compilation and linking,
because we want to build both static and dynamic versions the libraries.

### Compiling with gcc/g++

	gcc -c options... files...
	g++ -c options... files...

  * `-c`                         : compile only (don't link; produce .o files)
  * `-O2`                        : enable code optimizations
  * `-I<dir>`                    : search path for headers (eg. `-I../lua`)
  * `-I../lua-headers`           : necessary include path for Lua/C modules.
  * `-D<name>`                   : set a `#define`
  * `-D<name>=<value>`           : set a `#define` with a value
  * `-U<name>`                   : unset `#define`
  * `-fpic` or `-fPIC`           : generate position-independent code (required for linux64)
  * `-D_WIN32_WINNT=0x601`       : Windows: set API level to Windows 7 (set WINVER too)
  * `-DWINVER=0x601`             : Windows: set API level to Windows 7
  * `-D_POSIX_SOURCE`            : Linux and MinGW: enable POSIX 1003.1-1990 APIs
  * `-D_XOPEN_SOURCE=700`        : Linux: enable POSIX.1 + POSIX.2 + X/Open 7 (SUSv4) APIs
  * `-U_FORTIFY_SOURCE=1`        : gcc: enable some runtime checks
  * `-std=c++11`                 : for C++11 libraries

### Dynamic linking with gcc/g++

	gcc -shared options... files...
	g++ -shared options... files...

  * `-shared`                    : create a shared library
  * `-s`                         : strip debug and private symbols
  * `-o <output-file>`           : output file path (eg. `-o ../../bin/windows/z.dll`)
  * `-L<dir>`                    : search path for library dependencies (eg. `-L../../bin/windows`)
  * `-l<libname>`                : library dependency (eg. `-lz` looks for `z.dll`/`libz.so`/`libz.dylib` or `libz.a`)
  * `-Wl,--no-undefined`         : do not allow unresolved symbols in the output library.
  * `-static-libstdc++`          : link libstdc++ statically (for C++ libraries)
  * `-static-libgcc`             : link the GCC runtime library statically (for C and C++ libraries)
  * `-pthread`                   : enable pthread support (not for Windows)
  * `-Wl,-Bstatic -lstdc++ -lpthread -Wl,-Bdynamic` : statically link the winpthread library (for C++ libraries on Windows)
  * `-fno-exceptions`            : avoid linking to libstdc++ if the code doesn't use exceptions
  * `-fno-rtti`                  : make the binary smaller if the code doesn't use dynamic_cast or typeid
  * `-fvisibility=hidden`        : make the symbol table smaller if the code is explicit about exports

__IMPORTANT__: The order in which `-l` options appear is significant!
Always place all object files _and_ all dependent libraries _before_
all dependency libraries.

### Static linking with ar

	rm -f  ../../bin/<platform>/static/<libname>.a
	ar rcs ../../bin/<platform>/static/<libname>.a *.o

__IMPORTANT__: Always remove the old `.a` file first before invoking `ar`.

### Example: compile and link lpeg for Linux

	gcc -c -O2 lpeg.c -fPIC -I. -I../lua-headers
	gcc -shared -s -static-libgcc -o ../../bin/linux/clib/lpeg.so
	rm -f  ../../bin/linux/liblpeg.a
	ar rcs ../../bin/linux/liblpeg.a

In some cases it's going to be more complicated than that.

  * sometimes you won't get away with specifying `*.c` -- some libraries rely
  on the makefile to choose which .c files need to be compiled for a
  specific platform or set of options as opposed to using platform defines.
  * some libraries actually do use one or two of the myriad of defines
  generated by the `configure` script -- you might have to grep for those
  and add appropriate `-D` switches to the command line.
  * some libraries have parts written in assembler or other language.
  At that point, maybe a simple makefile is a better alternative, YMMV
  (if the package has a clean and simple makefile that doesn't add more
  dependencies to the toolchain, use that instead)

After compilation, check that your builds work on your oldest platforms.
