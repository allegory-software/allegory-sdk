
local pool = require'connpool'.new{max_connections = 2, max_waiting_threads = 1}
local h = 'test'

sock.run(function()

	local c1 = pool:put(h, {}, {})
	local c2 = pool:put(h, {}, {})
	print(pool:get(h, sock.clock() + 1))

	--local c, err = pool:get(h, 5)
	--assert(not c and err == 'empty')
	--local s = {close = function() print'close' end}
	--local c1 = {s = s}
	--c = pool:put(h, c1, s)
	--c:release()
	--local c, err = pool:get(h, 5)
	--assert(c == c1)
	--s:close()

end)

