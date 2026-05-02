io.stdout:setvbuf'no'
io.stderr:setvbuf'no'
local script_dir = arg[0]:gsub('[/]?[^/]+$', '')
local tests_dir = script_dir..'/../tests'
package.path = package.path..';'..tests_dir..'/?.lua'
