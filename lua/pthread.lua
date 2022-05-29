--[=[

	POSIX threads binding for Linux (glibc only!), OSX and Windows (winpthreads).
	Written by Cosmin Apreutesei. Public Domain.

THREADS
	pthread(func_ptr[, attrs]) -> th              create and start a new thread
	th:equal(other_th) -> true | false            check if two threads are equal
	th:join() -> status                           wait for a thread to finish
	th:detach()                                   detach a thread
	th:priority(new_priority)                     set thread priority
	th:priority() -> priority                     get thread priority
	pthread_min_priority() -> priority            get min. priority
	pthread_max_priority() -> priority            get max. priority
	pthread_yield()                               relinquish control to the scheduler

MUTEXES
	mutex([mattrs]) -> mutex                      create a mutex
	mutex:free()                                  free a mutex
	mutex:lock()                                  lock a mutex
	mutex:unlock()                                unlock a mutex
	mutex:trylock() -> true | false               lock a mutex or return false

CONDITION VARIABLES
	condvar() -> cond                             create a condition variable
	cond:free()                                   free the condition variable
	cond:broadcast()                              broadcast
	cond:signal()                                 signal
	cond:wait(mutex[, expires]) -> true | false   wait until `expires` (*)

READ/WRITE LOCKS
	rwlock() -> rwlock                            create a r/w lock
	rwlock:free()                                 free a r/w lock
	rwlock:writelock()                            lock for writing
	rwlock:readlock()                             lock for reading
	rwlock:trywritelock() -> true | false         try to lock for writing
	rwlock:tryreadlock() -> true | false          try to lock for reading
	rwlock:unlock()                               unlock the r/w lock

> (*) `expires` is a time() value, not a timeout nor a clock() value!

NOTE: All functions raise errors but error messages are not included
and error codes are platform specific. Use `c/precompile errno.h | grep CODE`
to search for specific codes.

pthread(func_ptr[, attrs]) -> th

	Create and start a new thread and return the thread object.

	`func_ptr` is a C callback declared as: `void *(*func_ptr)(void *arg)`.
	Its return value is returned by `th:join()`.

	The optional attrs table can have the fields:

  * `detached = true` - start detached (not very useful with Lua states)
  * `priority = n` - thread priority; must be between pthread.min_priority()
  and pthread.max_priority() -- in Linux these are both 0.
  * `stackaddr = n` - stack address.
  * `stacksize = n` - stack size in bytes (OS restrictions apply).


mutex([mattrs]) -> mutex

	Create a mutex. The optional mattrs table can have the fields:

	* `type = 'normal' | 'recursive' | 'errorcheck'`:
		* 'normal' (default) - non-recursive mutex: locks are not counted
		and not owned, so double-locking as well as unlocking by a
		different thread results in undefined behavior.
		* 'recursive' - recursive mutex: locks are counted and owned, so
		double-locking is allowed as long as done by the same thread.
		* 'errorcheck' - non-recursive mutex with error checking, so
		double-locking and unlocking by a different thread results
		in an error being raised.

IMPLEMENTATION NOTES ---------------------------------------------------------

IMPORTANT: Build your LuaJIT binary with `-pthread`!

POSIX is a standard indifferent to binary compatibility, resulting in each
implementation having a different ABI. Moreso, different implementations
only cover a subset of the API.

Only functionality that is common _to all_ supported platforms is available.
Winpthreads dumbs down the API the most (no process-shared objects,
no real-time extensions, etc.), but OSX too (no timed waits, no semaphores,
no barriers, etc.) and even Linux (setting priority levels needs root access).
Functions that don't make sense with Lua (pthread_once) or are stubs
in one or more implementations (pthread_setconcurrency) or are unsafe
to use with Lua states (killing, cancelation) were also dropped. All in all
you get a pretty thin library with just the basics covered.
The good news is that this is really all you need for most apps.
A more comprehensive but still portable threading library would have to
be implemented on top of native synchronization primitives.

Next are a few tips to get a rough idea of the portability situation.

To find out (part of) the truth about API coverage, you can start by
checking the exported symbols on the pthreads library on each platform
and compare them:

	On Linux:

		c/syms /lib/libpthread.so.0 | \
			grep '^pthread' > pthread_syms_linux.txt

	On OSX:

		(c/syms /usr/lib/libpthread.dylib
		c/syms /usr/lib/system/libsystem_pthread.dylib) | \
			grep '^pthread' > pthread_syms_osx.txt

	On Windows:

		c/syms bin\mingw64\libwinpthread-1.dll | \
			grep ^^pthread > pthread_syms_mingw.txt

	Compare the results (the first column tells the number of platforms
	that a symbol was found on):

		sort pthread_syms_* | uniq -c | sort -nr

To find out the differences in ABI and supported flags, you can preprocess
the headers on different platforms and compare them:

	c/precompile pthread.h sched.h semaphore.h > pthread_h_<platform>.lua

The above will use gcc to preprocess the headers and generate a
(very crude, mind you) Lua cdef template file that you can use
as a starting point for a binding and/or to check ABI differences.

Next step is to look at the source code for winpthreads and find out what
is really implemented (and how).

]=]

if not ... then return require'pthread_test' end

local ffi = require'ffi'
local lib = ffi.os == 'Windows' and 'libwinpthread-1' or 'pthread'
local C = ffi.load(lib)
local H = {} --header namespace
assert(ffi.abi'64bit')

if ffi.os == 'Linux' then

	ffi.cdef[[
	typedef long int time_t;

	enum {
		PTHREAD_CREATE_DETACHED = 1,
		PTHREAD_CANCEL_ENABLE = 0,
		PTHREAD_CANCEL_DISABLE = 1,
		PTHREAD_CANCEL_DEFERRED = 0,
		PTHREAD_CANCEL_ASYNCHRONOUS = 1,
		PTHREAD_CANCELED = -1,
		PTHREAD_EXPLICIT_SCHED = 1,
		PTHREAD_PROCESS_PRIVATE = 0,
		PTHREAD_MUTEX_NORMAL = 0,
		PTHREAD_MUTEX_ERRORCHECK = 2,
		PTHREAD_MUTEX_RECURSIVE = 1,
		SCHED_OTHER = 0,
		PTHREAD_STACK_MIN = 16384,
	};

	typedef unsigned long int real_pthread_t;
	typedef struct { real_pthread_t _; } pthread_t;

	typedef struct pthread_attr_t {
		union {
			char __size[56];
			long int __align;
		};
	} pthread_attr_t;

	typedef struct pthread_mutex_t {
		union {
			char __size[40];
			long int __align;
		};
	} pthread_mutex_t;

	typedef struct pthread_cond_t {
		union {
			char __size[48];
			long long int __align;
		};
	} pthread_cond_t;

	typedef struct pthread_rwlock_t {
		union {
			char __size[56];
			long int __align;
		};
	} pthread_rwlock_t;

	typedef struct pthread_mutexattr_t {
		union {
			char __size[4];
			int __align;
		};
	} pthread_mutexattr_t;

	typedef struct pthread_condattr_t {
		union {
			char __size[4];
			int __align;
		};
	} pthread_condattr_t;

	typedef struct pthread_rwlockattr_t {
		union {
			char __size[8];
			long int __align;
		};
	} pthread_rwlockattr_t;

	struct sched_param {
		int sched_priority;
	};
	]]

	H.EBUSY     = 16
	H.ETIMEDOUT = 110

	local function nop(t) end
	H.PTHREAD_MUTEX_INITIALIZER  = nop
	H.PTHREAD_RWLOCK_INITIALIZER = nop
	H.PTHREAD_COND_INITIALIZER   = nop

elseif ffi.os == 'OSX' then

	ffi.cdef[[
	typedef long time_t;

	enum {
		PTHREAD_CREATE_DETACHED = 2,
		PTHREAD_CANCEL_ENABLE = 0x01,
		PTHREAD_CANCEL_DISABLE = 0x00,
		PTHREAD_CANCEL_DEFERRED = 0x02,
		PTHREAD_CANCEL_ASYNCHRONOUS = 0x00,
		PTHREAD_CANCELED = 1,
		PTHREAD_EXPLICIT_SCHED = 2,
		PTHREAD_PROCESS_PRIVATE = 2,
		PTHREAD_MUTEX_NORMAL = 0,
		PTHREAD_MUTEX_ERRORCHECK = 1,
		PTHREAD_MUTEX_RECURSIVE = 2,
		SCHED_OTHER = 1,
		PTHREAD_STACK_MIN = 8192,
	};

	typedef void *real_pthread_t;
	typedef struct { real_pthread_t _; } pthread_t;

	typedef struct pthread_attr_t {
		long __sig;
		char __opaque[56];
	} pthread_attr_t;

	typedef struct pthread_mutex_t {
		long __sig;
		char __opaque[56];
	} pthread_mutex_t;

	typedef struct pthread_cond_t {
		long __sig;
		char __opaque[40];
	} pthread_cond_t;

	typedef struct pthread_rwlock_t {
		long __sig;
		char __opaque[192];
	} pthread_rwlock_t;

	typedef struct pthread_mutexattr_t {
		long __sig;
		char __opaque[8];
	} pthread_mutexattr_t;

	typedef struct pthread_condattr_t {
		long __sig;
		char __opaque[8];
	} pthread_condattr_t;

	typedef struct pthread_rwlockattr_t {
		long __sig;
		char __opaque[16];
	} pthread_rwlockattr_t;

	struct sched_param {
		int sched_priority;
		char __opaque[4];
	};
	]]

	local _PTHREAD_MUTEX_SIG_init  = 0x32AAABA7
	local _PTHREAD_COND_SIG_init   = 0x3CB0B1BB
	local _PTHREAD_RWLOCK_SIG_init = 0x2DA8B3B4

	H.EBUSY     = 16
	H.ETIMEDOUT = 60

	function H.PTHREAD_RWLOCK_INITIALIZER(t) t.__sig = _PTHREAD_RWLOCK_SIG_init end
	function H.PTHREAD_MUTEX_INITIALIZER(t)  t.__sig = _PTHREAD_MUTEX_SIG_init end
	function H.PTHREAD_COND_INITIALIZER(t)   t.__sig = _PTHREAD_COND_SIG_init end

elseif ffi.os == 'Windows' then

	ffi.cdef'typedef int64_t time_t;'

	ffi.cdef[[
	enum {
		PTHREAD_CREATE_DETACHED = 0x04,
		PTHREAD_CANCEL_ENABLE = 0x01,
		PTHREAD_CANCEL_DISABLE = 0,
		PTHREAD_CANCEL_DEFERRED = 0,
		PTHREAD_CANCEL_ASYNCHRONOUS = 0x02,
		PTHREAD_CANCELED = 0xDEADBEEF,
		PTHREAD_EXPLICIT_SCHED = 0,
		PTHREAD_PROCESS_PRIVATE = 0,
		PTHREAD_MUTEX_NORMAL = 0,
		PTHREAD_MUTEX_ERRORCHECK = 1,
		PTHREAD_MUTEX_RECURSIVE = 2,
		SCHED_OTHER = 0,
		PTHREAD_STACK_MIN = 8192,
	};

	typedef uintptr_t real_pthread_t;
	typedef struct { real_pthread_t _; } pthread_t;

	struct sched_param {
	  int sched_priority;
	};
	typedef struct pthread_attr_t {
		 unsigned p_state;
		 void *stack;
		 size_t s_size;
		 struct sched_param param;
	} pthread_attr_t;
	typedef struct pthread_mutex_t { void *_; } pthread_mutex_t;
	typedef struct pthread_cond_t { void *_; } pthread_cond_t;
	typedef struct pthread_rwlock_t { void *_; } pthread_rwlock_t;
	typedef struct pthread_mutexattr_t { unsigned _; } pthread_mutexattr_t;
	typedef struct { int _; } pthread_condattr_t;
	typedef struct { int _; } pthread_rwlockattr_t;
	]]

	H.EBUSY     = 16
	H.ETIMEDOUT = 138

	local GENERIC_INITIALIZER = ffi.cast('void*', -1)
	function H.PTHREAD_MUTEX_INITIALIZER(t)  t._ = GENERIC_INITIALIZER end
	function H.PTHREAD_COND_INITIALIZER(t)   t._ = GENERIC_INITIALIZER end
	function H.PTHREAD_RWLOCK_INITIALIZER(t) t._ = GENERIC_INITIALIZER end

else
	error('platform not supported')
end

ffi.cdef[[
typedef struct {
	time_t s;
	long ns;
} timespec;

int pthread_create(pthread_t *th, const pthread_attr_t *attr, void *(*func)(void *), void *arg);
real_pthread_t pthread_self(void);
int pthread_equal(pthread_t th1, pthread_t th2);
void pthread_exit(void *retval);
int pthread_join(pthread_t, void **retval);
int pthread_detach(pthread_t);
int pthread_getschedparam(pthread_t th, int *pol, struct sched_param *param);
int pthread_setschedparam(pthread_t th, int pol, const struct sched_param *param);

int pthread_attr_init(pthread_attr_t *attr);
int pthread_attr_destroy(pthread_attr_t *attr);
int pthread_attr_setdetachstate(pthread_attr_t *a, int flag);
int pthread_attr_setinheritsched(pthread_attr_t *a, int flag);
int pthread_attr_setschedparam(pthread_attr_t *attr, const struct sched_param *param);
int pthread_attr_setstackaddr(pthread_attr_t *attr, void *stack);
int pthread_attr_setstacksize(pthread_attr_t *attr, size_t size);

int pthread_mutex_init(pthread_mutex_t *m, const pthread_mutexattr_t *a);
int pthread_mutex_destroy(pthread_mutex_t *m);
int pthread_mutex_lock(pthread_mutex_t *m);
int pthread_mutex_unlock(pthread_mutex_t *m);
int pthread_mutex_trylock(pthread_mutex_t *m);

int pthread_mutexattr_init(pthread_mutexattr_t *a);
int pthread_mutexattr_destroy(pthread_mutexattr_t *a);
int pthread_mutexattr_settype(pthread_mutexattr_t *a, int type);

int pthread_cond_init(pthread_cond_t *cv, const pthread_condattr_t *a);
int pthread_cond_destroy(pthread_cond_t *cv);
int pthread_cond_broadcast(pthread_cond_t *cv);
int pthread_cond_signal(pthread_cond_t *cv);
int pthread_cond_wait(pthread_cond_t *cv, pthread_mutex_t *external_mutex);
int pthread_cond_timedwait(pthread_cond_t *cv, pthread_mutex_t *external_mutex, const timespec *t);

int pthread_rwlock_init(pthread_rwlock_t *l, const pthread_rwlockattr_t *attr);
int pthread_rwlock_destroy(pthread_rwlock_t *l);
int pthread_rwlock_wrlock(pthread_rwlock_t *l);
int pthread_rwlock_rdlock(pthread_rwlock_t *l);
int pthread_rwlock_trywrlock(pthread_rwlock_t *l);
int pthread_rwlock_tryrdlock(pthread_rwlock_t *l);
int pthread_rwlock_unlock(pthread_rwlock_t *l);

int sched_yield(void);
int sched_get_priority_min(int pol);
int sched_get_priority_max(int pol);
]]

--helpers

local function check(ok, ret)
	if ok then return end
	error(string.format('pthread error: %d\n%s', ret, debug.traceback()), 3)
end

--return-value checker for '0 means OK' functions
local function checkz(ret)
	check(ret == 0, ret)
end

--return-value checker for 'try' functions
local function checkbusy(ret)
	check(ret == 0 or ret == H.EBUSY, ret)
	return ret == 0
end

--return-value checker for 'timedwait' functions
local function checktimeout(ret)
	check(ret == 0 or ret == H.ETIMEDOUT, ret)
	return ret == 0
end

--convert a time returned by os.time() to timespec
local function timespec(time, ts)
	local int, frac = math.modf(time)
	ts.s = int
	ts.ns = frac * 1e9
	return ts
end

--threads

--create a new thread with a C callback. to use with a Lua callback,
--create a Lua state and a ffi callback pointing to a function inside
--the state, and use that as func_cb.
function pthread(func_cb, attrs, ud)
	local thread = ffi.new'pthread_t'
	local attr
	if attrs then
		attr = ffi.new'pthread_attr_t'
		C.pthread_attr_init(attr)
		if attrs.detached then --not very useful, see pthread:detach()
			checkz(C.pthread_attr_setdetachstate(attr, C.PTHREAD_CREATE_DETACHED))
		end
		if attrs.priority then --useless on Linux for non-root users
			checkz(C.pthread_attr_setinheritsched(attr, C.PTHREAD_EXPLICIT_SCHED))
			local param = ffi.new'struct sched_param'
			param.sched_priority = attrs.priority
			checkz(C.pthread_attr_setschedparam(attr, param))
		end
		if attrs.stackaddr then
			checkz(C.pthread_attr_setstackaddr(attr, attrs.stackaddr))
		end
		if attrs.stacksize then
			checkz(C.pthread_attr_setstacksize(attr, attrs.stacksize))
		end
	end
	local ret = C.pthread_create(thread, attr, func_cb, ud)
	if attr then
		C.pthread_attr_destroy(attr)
	end
	checkz(ret)
	return thread
end

--current thread
function pthread_self()
	return ffi.new('pthread_t', C.pthread_self())
end

--test two thread objects for equality.
local function pthread_equal(t1, t2)
	return C.pthread_equal(t1, t2) ~= 0
end

--wait for a thread to finish.
local function pthread_join(thread)
	local status = ffi.new'void*[1]'
	checkz(C.pthread_join(thread, status))
	return status[0]
end

--set a thread loose (not very useful because it's hard to know when
--a detached thread has died so that another thread can clean up after it,
--and a Lua state can't free itself up from within either).
local function pthread_detach(thread)
	checkz(C.pthread_detach(thread))
end

--set thread priority: level is between min_priority() and max_priority().
--NOTE: on Linux, min_priority() == max_priority() == 0 for SCHED_OTHER
--(which is the only cross-platform SCHED_* value), and SCHED_RR needs root
--which is a major usability hit, so it's not included.
local function pthread_priority(thread, sched, level)
	assert(not sched or sched == 'other')
	local param = ffi.new'sched_param'
	if level then
		param.sched_priority = level
		checkz(C.pthread_setschedparam(thread, C.SCHED_OTHER, param))
	else
		checkz(C.pthread_getschedparam(thread, C.SCHED_OTHER, param))
		return param.sched_priority
	end
end
function pthread_min_priority(sched)
	assert(not sched or sched == 'other')
	return C.sched_get_priority_min(C.SCHED_OTHER)
end
function pthread_max_priority(sched)
	assert(not sched or sched == 'other')
	return C.sched_get_priority_max(C.SCHED_OTHER)
end

ffi.metatype('pthread_t', {
		__index = {
			equal = pthread_equal,
			join = pthread_join,
			detach = pthread_detach,
			priority = pthread_priority,
		},
	})

--mutexes

local mutex = {}

local mtypes = {
	normal     = C.PTHREAD_MUTEX_NORMAL,
	errorcheck = C.PTHREAD_MUTEX_ERRORCHECK,
	recursive  = C.PTHREAD_MUTEX_RECURSIVE,
}

function _G.mutex(mattrs, space)
	local mutex = space or ffi.new'pthread_mutex_t'
	H.PTHREAD_MUTEX_INITIALIZER(mutex)
	local mattr
	if mattrs then
		mattr = ffi.new'pthread_mutexattr_t'
		checkz(C.pthread_mutexattr_init(mattr))
		if mattrs.type then
			local mtype = assert(mtypes[mattrs.type], 'invalid mutex type')
			checkz(C.pthread_mutexattr_settype(mattr, mtype))
		end
	end
	local ret = C.pthread_mutex_init(mutex, mattr)
	if mattr then
		C.pthread_mutexattr_destroy(mattr)
	end
	checkz(ret)
	if not space then
		ffi.gc(mutex, mutex.free)
	end
	return mutex
end

function mutex.free(mutex)
	checkz(C.pthread_mutex_destroy(mutex))
	ffi.gc(mutex, nil)
end

function mutex.lock(mutex)
	checkz(C.pthread_mutex_lock(mutex))
end

function mutex.unlock(mutex)
	checkz(C.pthread_mutex_unlock(mutex))
end


function mutex.trylock(mutex)
	return checkbusy(C.pthread_mutex_trylock(mutex))
end

ffi.metatype('pthread_mutex_t', {__index = mutex})

--condition variables

local cond = {}

function _G.condvar(_, space)
	local cond = space or ffi.new'pthread_cond_t'
	H.PTHREAD_COND_INITIALIZER(cond)
	checkz(C.pthread_cond_init(cond, nil))
	if not space then
		ffi.gc(cond, cond.free)
	end
	return cond
end

function cond.free(cond)
	checkz(C.pthread_cond_destroy(cond))
	ffi.gc(cond, nil)
end

function cond.broadcast(cond)
	checkz(C.pthread_cond_broadcast(cond))
end

function cond.signal(cond)
	checkz(C.pthread_cond_signal(cond))
end

local ts
--NOTE: `time` is time per os.time(), not a time period.
function cond.wait(cond, mutex, time)
	if time then
		ts = ts or ffi.new'timespec'
		return checktimeout(C.pthread_cond_timedwait(cond, mutex, timespec(time, ts)))
	else
		checkz(C.pthread_cond_wait(cond, mutex))
		return true
	end
end

ffi.metatype('pthread_cond_t', {__index = cond})

--read/write locks

local rwlock = {}

function _G.rwlock(_, space)
	local rwlock = space or ffi.new'pthread_rwlock_t'
	H.PTHREAD_RWLOCK_INITIALIZER(rwlock)
	checkz(C.pthread_rwlock_init(rwlock, nil))
	if not space then
		ffi.gc(rwlock, rwlock.free)
	end
	return rwlock
end

function rwlock.free(rwlock)
	checkz(C.pthread_rwlock_destroy(rwlock))
	ffi.gc(rwlock, nil)
end

function rwlock.writelock(rwlock)
	checkz(C.pthread_rwlock_wrlock(rwlock))
end

function rwlock.readlock(rwlock)
	checkz(C.pthread_rwlock_rdlock(rwlock))
end

function rwlock.trywritelock(rwlock)
	return checkbusy(C.pthread_rwlock_trywrlock(rwlock))
end

function rwlock.tryreadlock(rwlock)
	return checkbusy(C.pthread_rwlock_tryrdlock(rwlock))
end

function rwlock.unlock(rwlock)
	checkz(C.pthread_rwlock_unlock(rwlock))
end

ffi.metatype('pthread_rwlock_t', {__index = rwlock})

local SC = ffi.os == 'Windows' and C or ffi.C
function pthread_yield()
	checkz(SC.sched_yield())
end
