io.stdout:setvbuf'no'
io.stderr:setvbuf'no'
require'glue'
require'fs'
local tests_dir = exedir()..'/../../tests'
luapath(tests_dir)

if win then
	local sdkd_dir = indir('x:/sdkd')
	sopath (indir(sdkd_dir, 'bin/windows'))
	luapath(indir(sdkd_dir, 'lua'))
	luapath(indir(sdkd_dir, 'tests'))
end

--chdir(tests_dir)
