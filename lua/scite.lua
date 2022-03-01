io.stdout:setvbuf'no'
local glue = require'glue'
local fs = require'fs'
local tests_dir = fs.exedir()..'/../../tests'
glue.luapath(tests_dir)
fs.chdir(tests_dir)
require'$log'
