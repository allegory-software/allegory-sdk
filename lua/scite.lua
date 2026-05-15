io.stdout:setvbuf'no'
io.stderr:setvbuf'no'
require'strict'
if not arg[0] then return end
local script_dir = arg[0]:gsub('[/]?[^/]+$', '')
if not script_dir:find'^/' then script_dir = '/home/cosmin/'..script_dir end
local tests_dir = script_dir..'/../tests'
package.path = package.path..';'..tests_dir..'/?.lua'
