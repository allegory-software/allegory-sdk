require'sock'
require'connpool'
logging.debug = true

local pool = connpool{max_connections = 2, max_waiting_threads = 1}

local S = {}
function S:close() _onclose(self); print'close' end
function S:onclose(f) self._onclose = f end
local C = function()
	local s = object(S)
	return {s = s}
end

local h = 'test'
run(function()
	local c1 = C()
	local c2 = C()
	local c, err = pool:get(h)
	assert(not c and err == 'empty')
	local c1 = pool:put(h, c1, c1.s)
	local c2 = pool:put(h, c2, c2.s)
	local c, err = pool:get(h, clock() + .1)
	assert(not c and err == 'timeout')
	--assert(not c and err == 'empty')
	c1:release_to_pool()
	local c, err = pool:get(h, 5)
	assert(c == c1)
	s:close()
end)
