--[=[

	Wall clock, monotonic clock, and sleep function (Linux).
	Written by Cosmin Apreutesei. Public Domain.

	now() -> ts          current time with ~100us precision
	clock() -> ts        monotonic clock in seconds with ~1us precision
	startclock           clock() when this module was loaded
	sleep(s)             sleep with sub-second precision (~10-100ms)

	now() -> ts

		Reads the time as a UNIX timestamp (a Lua number).
		It is the same as the time returned by `os.time()` on all platforms,
		except it has sub-second precision. It is affected by drifting,
		leap seconds and time adjustments by the user. It is not affected
		by timezones. It can be used to synchronize time between different
		boxes on a network regardless of platform.

	clock() -> ts

		Reads a monotonic performance counter, and is thus more accurate than
		`now()`, it should never go back or drift, but it doesn't have
		a fixed time base between program executions. It can be used
		for measuring short time intervals for thread synchronization, etc.

	sleep(s)

		Suspends the current process `s` seconds. Different than wait() which
		only suspends the current Lua thread.

]=]

local ffi = require'ffi'
local C = ffi.C

ffi.cdef[[
typedef struct {
	long s;
	long ns;
} time_timespec;

int time_nanosleep(time_timespec*, time_timespec *) asm("nanosleep");
]]

local EINTR = 4

local t = ffi.new'time_timespec'

function sleep(s)
	local int, frac = math.modf(s)
	t.s = int
	t.ns = frac * 1e9
	local ret = C.time_nanosleep(t, t)
	while ret == -1 and ffi.errno() == EINTR do --interrupted
		ret = C.time_nanosleep(t, t)
	end
	assert(ret == 0)
end

ffi.cdef[[
int time_clock_gettime(int clock_id, time_timespec *tp) asm("clock_gettime");
]]

local CLOCK_REALTIME = 0
local CLOCK_MONOTONIC = 1

local ok, rt_C = pcall(ffi.load, 'rt')
local clock_gettime = (ok and rt_C or C).time_clock_gettime

local function tos(t)
	return tonumber(t.s) + tonumber(t.ns) / 1e9
end

function now()
	assert(clock_gettime(CLOCK_REALTIME, t) == 0)
	return tos(t)
end

local t0 = 0
function clock()
	assert(clock_gettime(CLOCK_MONOTONIC, t) == 0)
	return tos(t) - t0
end
t0 = clock()
startclock = t0

--demo -----------------------------------------------------------------------

if not ... then
	io.stdout:setvbuf'no'

	print('now'   , now())
	print('clock' , clock())

	local function test_sleep(s, ss)
		local t0 = clock()
		local times = math.floor(s*1/ss)
		s = times * ss
		print(string.format('sleeping %gms in %gms increments (%d times)...', s * 1000, ss * 1000, times))
		for i=1,times do
			sleep(ss)
		end
		local t1 = clock()
		print(string.format('  missed by: %0.2fms', (t1 - t0 - s) / times * 1000))
	end

	test_sleep(0.001, 0.001)
	test_sleep(0.2, 0.02)
	test_sleep(2, 0.2)
end
