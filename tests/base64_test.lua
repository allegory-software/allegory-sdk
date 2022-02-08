local ffi = require'ffi'
local base64 = require'base64'

local decode = function(...) return ffi.string(base64.decode(...)) end
local encode = base64.encode

assert(decode'YW55IGNhcm5hbCBwbGVhc3VyZS4=' == 'any carnal pleasure.')
assert(decode'YW55IGNhcm5hbCBwbGVhc3VyZQ==' == 'any carnal pleasure')
assert(decode'YW55IGNhcm5hbCBwbGVhc3Vy' == 'any carnal pleasur')
assert(decode'YW55IGNhcm5hbCBwbGVhc3U=' == 'any carnal pleasu')
assert(decode'YW55IGNhcm5hbCBwbGVhcw==' == 'any carnal pleas')
assert(decode'., ? !@#$%^& \n\r\n\r YW55IGNhcm5hbCBwbGVhcw== \n\r' == 'any carnal pleas')

assert(encode'any carnal pleasure.' == 'YW55IGNhcm5hbCBwbGVhc3VyZS4=')
assert(encode'any carnal pleasure' == 'YW55IGNhcm5hbCBwbGVhc3VyZQ==')
assert(encode'any carnal pleasur' == 'YW55IGNhcm5hbCBwbGVhc3Vy')
assert(encode'any carnal pleasu' == 'YW55IGNhcm5hbCBwbGVhc3U=')
assert(encode'any carnal pleas' == 'YW55IGNhcm5hbCBwbGVhcw==')

assert(decode(encode'') == '')
assert(decode(encode'x') == 'x')
assert(decode(encode'xx') == 'xx')
assert(decode'.!@#$%^&*( \n\r\t' == '')

local function encln(s, n) return encode(s:rep(n), nil, nil, nil, 76) end
assert(encln('.', 1) == 'Lg==\r\n')
assert(encln('.', 76/4*3) == ('Li4u'):rep(76/4)..'\r\n')
assert(encln('.', 76/4*3+1) == ('Li4u'):rep(76/4)..'\r\nLg==\r\n')
