local hmac = require'md5'.hmac
local glue = require'glue'
local unit = require'unit'

test(glue.tohex(hmac('dude', 'key')), 'e9ecd7d5b2d9dc558d1c2cd173be7c38')
test(glue.tohex(hmac('what do ya want for nothing?', 'Jefe')), '750c783e6ab0b503eaa86e310a5db738')
