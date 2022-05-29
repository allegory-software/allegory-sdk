
local ffi = require'ffi'
require'pthread'
require'luastate'

--make a new Lua state
local state = luastate()

--load the standard libraries into the Lua state
state:openlibs()

--create a callback into the Lua state to be called from a different thread
state:push(function()

	--up-values are not copied, so we have to require ffi again.
	local ffi = require'ffi'

	--this is our worker function that will run in a different thread.
	local function worker()
		--print() is thread-safe so no need to guard it.
		print'Hello from thread!'
	end

	--make a ffi callback frame to call into our worker function.
	--luajit anchors both the callback object and its function
	--so we don't care about them getting garbage collected.
	local worker_cb = ffi.cast('void *(*)(void *)', worker)

	--get the callback pointer out of the Lua state as a number,
	--because we can't pass cdata between Lua states.
	--tonumber() works on x64 too in this case because the Lua state
	--was allocated by LuaJIT which can only allocate stuff in the
	--lowest 4GB of the address space.
	return tonumber(ffi.cast('intptr_t', worker_cb))
end)

--call the function that we just pushed into the Lua state
--to get the callback pointer.
local worker_cb_ptr = ffi.cast('void*', state:call())

--create a thread which will start running automatically.
local thread = pthread(worker_cb_ptr)

--wait for the thread to finish.
thread:join()

--close the Lua state.
state:close()
