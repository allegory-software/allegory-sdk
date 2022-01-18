local ffi = require'ffi'
if ffi.os == 'Windows' then
	return require'jit.vmdef_windows'
elseif ffi.os == 'Linux' then
	return require'jit.vmdef_linux'
elseif ffi.os == 'OSX' then
	return require'jit.vmdef_osx'
else
	error('jit.vmdef_'..ffi.os:lower()..' missing')
end
