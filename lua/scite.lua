io.stdout:setvbuf'no'
io.stderr:setvbuf'no'
require'strict'
if not arg[0] then return end
local script_dir = arg[0]:gsub('[/]?[^/]+$', '')
if not script_dir:find'^/' then
	local ffi = require'ffi'
	ffi.cdef'char *getcwd(char *buf, size_t size);'
	local cwd = ffi.string(ffi.C.getcwd(ffi.new('char[4096]'), 4096))
	script_dir = cwd..'/'..script_dir
end
local tests_dir = script_dir..'/../tests'
package.path = package.path..';'..tests_dir..'/?.lua'
