io.stdout:setvbuf'no'
require'glue'
require'fs'
local tests_dir = exedir()..'/../../tests'
luapath(tests_dir)
chdir(tests_dir)
