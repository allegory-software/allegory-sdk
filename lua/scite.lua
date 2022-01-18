io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

local logging = require'logging'
function pr(...)
	print(logging.printargs(...))
	io.stdout:flush()
	return ...
end

--pp = require'pp'
--require'terra'
glue = require'glue'
--pr = terralib.printraw
