require'glue'
require'base64'

assert(base64_decode'YW55IGNhcm5hbCBwbGVhc3VyZS4=' == 'any carnal pleasure.')
assert(base64_decode'YW55IGNhcm5hbCBwbGVhc3VyZQ==' == 'any carnal pleasure')
assert(base64_decode'YW55IGNhcm5hbCBwbGVhc3Vy' == 'any carnal pleasur')
assert(base64_decode'YW55IGNhcm5hbCBwbGVhc3U=' == 'any carnal pleasu')
assert(base64_decode'YW55IGNhcm5hbCBwbGVhcw==' == 'any carnal pleas')
assert(base64_decode'., ? !@#$%^& \n\r\n\r YW55IGNhcm5hbCBwbGVhcw== \n\r' == 'any carnal pleas')

assert(base64_encode'any carnal pleasure.' == 'YW55IGNhcm5hbCBwbGVhc3VyZS4=')
assert(base64_encode'any carnal pleasure' == 'YW55IGNhcm5hbCBwbGVhc3VyZQ==')
assert(base64_encode'any carnal pleasur' == 'YW55IGNhcm5hbCBwbGVhc3Vy')
assert(base64_encode'any carnal pleasu' == 'YW55IGNhcm5hbCBwbGVhc3U=')
assert(base64_encode'any carnal pleas' == 'YW55IGNhcm5hbCBwbGVhcw==')

assert(base64_decode((base64_encode'')) == '')
assert(base64_decode((base64_encode'x')) == 'x')
assert(base64_decode((base64_encode'xx')) == 'xx')
assert(base64_decode'.!@#$%^&*( \n\r\t' == '')

local function encln(s, n) return base64_encode(s:rep(n), nil, nil, nil, 76) end
assert(encln('.', 1) == 'Lg==\r\n')
assert(encln('.', 76/4*3) == ('Li4u'):rep(76/4)..'\r\n')
assert(encln('.', 76/4*3+1) == ('Li4u'):rep(76/4)..'\r\nLg==\r\n')
