--[=[

	POSIX threads binding for Linux (glibc only!)
	Written by Cosmin Apreutesei. Public Domain.

THREADS
	pthread(func_ptr[, attrs]) -> th              create and start a new thread
	th:equal(other_th) -> true | false            check if two threads are equal
	th:join() -> status                           wait for a thread to finish
	th:detach()                                   detach a thread
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
SEMAPHORES
	semaphore([value]) -> sem                     create a semaphore (process-private)
	sem:free()                                    destroy a semaphore
	sem:post()                                    increment (signal)
	sem:wait([expires]) -> true | false           decrement (wait) until `expires` (*)
	sem:trywait() -> true | false                 try to decrement or return false
	sem:value() -> n                              get current value
BARRIERS
	barrier(count) -> barrier                     create a barrier for `count` threads
	barrier:free()                                destroy a barrier
	barrier:wait() -> true | false                wait; one thread returns true
THREAD EXTRAS
	th:name([name])                               get/set thread name (max 15 chars)
	th:affinity([{cpu, ...}])                     get/set CPU affinity mask

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
pthread implementation potentially having a different ABI.

Functions that don't make sense with Lua (pthread_once) or are unsafe
to use with Lua states (killing, cancelation) were dropped. All in all
you get a pretty thin library with just the basics covered.
The good news is that this is really all you need for most apps.

]=]

if not ... then return require'pthread_test' end

require'glue'
assert(Linux)

local C = C

cdef[[
typedef long int time_t;

enum {
	PTHREAD_CREATE_DETACHED = 1,
	PTHREAD_CANCEL_ENABLE = 0,
	PTHREAD_CANCEL_DISABLE = 1,
	PTHREAD_CANCEL_DEFERRED = 0,
	PTHREAD_CANCEL_ASYNCHRONOUS = 1,
	PTHREAD_CANCELED = -1,
	PTHREAD_BARRIER_SERIAL_THREAD = -1,
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

typedef struct {
	union {
		char __size[32];
		long int __align;
	};
} sem_t;

typedef struct {
	union {
		char __size[32];
		long int __align;
	};
} pthread_barrier_t;

typedef struct {
	union {
		char __size[4];
		int __align;
	};
} pthread_barrierattr_t;

typedef struct {
	unsigned long int __bits[16];
} cpu_set_t;

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

int sem_init(sem_t *sem, int pshared, unsigned int value);
int sem_destroy(sem_t *sem);
int sem_post(sem_t *sem);
int sem_wait(sem_t *sem);
int sem_trywait(sem_t *sem);
int sem_timedwait(sem_t *sem, const timespec *abs_timeout);
int sem_getvalue(sem_t *sem, int *sval);

int pthread_barrier_init(pthread_barrier_t *b, const pthread_barrierattr_t *a, unsigned int count);
int pthread_barrier_destroy(pthread_barrier_t *b);
int pthread_barrier_wait(pthread_barrier_t *b);

int pthread_setname_np(pthread_t thread, const char *name);
int pthread_getname_np(pthread_t thread, char *name, size_t len);

int pthread_setaffinity_np(pthread_t thread, size_t cpusetsize, const cpu_set_t *cpuset);
int pthread_getaffinity_np(pthread_t thread, size_t cpusetsize, cpu_set_t *cpuset);
]]

local EBUSY     = 16
local ETIMEDOUT = 110
local EAGAIN    = 11

--helpers

local function check_errno(...)
	assert(try_errno(...))
end

--return-value checker for '0 means OK' functions
local function checkz(ret)
	check_errno(ret == 0, ret)
end

--return-value checker for 'try' functions
local function checkbusy(ret)
	check_errno(ret == 0 or ret == EBUSY, ret)
	return ret == 0
end

--return-value checker for 'timedwait' functions
local function checktimeout(ret)
	check_errno(ret == 0 or ret == ETIMEDOUT, ret)
	return ret == 0
end

--errno-based checkers for sem_* functions which set errno().
local function checkz_sem(ret)
	check_errno(ret == 0)
end

local function checkbusy_sem(ret)
	if ret == 0 then return true end
	local err = errno()
	check_errno(err == EAGAIN, err)
	return false
end

local function checktimeout_sem(ret)
	if ret == 0 then return true end
	local err = errno()
	check_errno(err == ETIMEDOUT, err)
	return false
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

function pthread_yield()
	checkz(C.sched_yield())
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

local function pthread_name(thread, name)
	if name then
		checkz(C.pthread_setname_np(thread, name))
	else
		local buf = ffi.new('char[16]')
		checkz(C.pthread_getname_np(thread, buf, 16))
		return ffi.string(buf)
	end
end

local function pthread_affinity(thread, cpus)
	local cs = ffi.new'cpu_set_t'
	if cpus then
		local p = ffi.cast('uint32_t*', cs.__bits)
		for _, cpu in ipairs(cpus) do
			local i = bit.rshift(cpu, 5)
			p[i] = bit.bor(p[i], bit.lshift(1, bit.band(cpu, 31)))
		end
		checkz(C.pthread_setaffinity_np(thread, ffi.sizeof'cpu_set_t', cs))
	else
		checkz(C.pthread_getaffinity_np(thread, ffi.sizeof'cpu_set_t', cs))
		local p = ffi.cast('uint32_t*', cs.__bits)
		local result = {}
		for i = 0, 1023 do
			if bit.band(p[bit.rshift(i, 5)], bit.lshift(1, bit.band(i, 31))) ~= 0 then
				result[#result+1] = i
			end
		end
		return result
	end
end

ffi.metatype('pthread_t', {
		__index = {
			equal    = pthread_equal,
			join     = pthread_join,
			detach   = pthread_detach,
			name     = pthread_name,
			affinity = pthread_affinity,
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
		ts = ts or new'timespec'
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

--semaphores

local sem = {}

function _G.semaphore(value, space)
	local s = space or ffi.new'sem_t'
	checkz_sem(C.sem_init(s, 0, value or 0))
	if not space then
		ffi.gc(s, s.free)
	end
	return s
end

function sem.free(s)
	checkz_sem(C.sem_destroy(s))
	ffi.gc(s, nil)
end

function sem.post(s)
	checkz_sem(C.sem_post(s))
end

local sem_ts
--NOTE: `time` is time per os.time(), not a time period.
function sem.wait(s, time)
	if time then
		sem_ts = sem_ts or ffi.new'timespec'
		return checktimeout_sem(C.sem_timedwait(s, timespec(time, sem_ts)))
	else
		checkz_sem(C.sem_wait(s))
		return true
	end
end

function sem.trywait(s)
	return checkbusy_sem(C.sem_trywait(s))
end

function sem.value(s)
	local v = ffi.new'int[1]'
	checkz_sem(C.sem_getvalue(s, v))
	return v[0]
end

ffi.metatype('sem_t', {__index = sem})

--barriers

local barrier = {}

function _G.barrier(count, space)
	local b = space or ffi.new'pthread_barrier_t'
	checkz(C.pthread_barrier_init(b, nil, count))
	if not space then
		ffi.gc(b, b.free)
	end
	return b
end

function barrier.free(b)
	checkz(C.pthread_barrier_destroy(b))
	ffi.gc(b, nil)
end

function barrier.wait(b)
	local ret = C.pthread_barrier_wait(b)
	check_errno(ret == 0 or ret == C.PTHREAD_BARRIER_SERIAL_THREAD, ret)
	return ret == C.PTHREAD_BARRIER_SERIAL_THREAD
end

ffi.metatype('pthread_barrier_t', {__index = barrier})
