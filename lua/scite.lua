
io.stdout:setvbuf'no'
io.stderr:setvbuf'no'

local logging = require'logging'
function pr(...)
	print(logging.printargs(...))
	io.stdout:flush()
	return ...
end

local glue = require'glue'
local fs = require'fs'
local tests_dir = fs.exedir()..'/../../tests'
glue.luapath(tests_dir)
fs.cd(tests_dir)

