local genx = require'genx'
local ffi = require'ffi'

local w = genx.new()

local ns1 = w:ns('ns1', 'pns1')
local ns2 = w:ns('ns2', 'pns2')
local body = w:tag('body', ns1)
local a1 = w:attr('a1')
local a2 = w:attr('a2')

w:start_doc(io.stdout)
w:start_tag'root'
w:text'hello'
w:end_tag()
w:end_doc()
print()

local t = {}
w:start_doc(function(s, sz)
	s = s and (sz and ffi.string(s, sz) or ffi.string(s)) or '\n!EOF\n'
	t[#t+1] = s
end)

w:start_tag('html')
w:add_ns(ns1)
w:add_ns(ns2, 'g')

	w:text'\n\t'
	w:start_tag('head')
	w:add_attr('b', 'vb')
	w:add_attr('a', 'va')
	w:text'hello'
	w:end_tag()
	w:text'\n\t'

	w:start_tag(body)
	w:add_attr(a1, 'v1')
	w:add_attr(a2, 'v2')
	w:text'hey'
	w:end_tag()
	w:text'\n'

w:end_tag()

w:end_doc()

w:free()

local s = table.concat(t)
assert(s == [[
<html xmlns:g="ns2" xmlns:pns1="ns1">
	<head a="va" b="vb">hello</head>
	<pns1:body a1="v1" a2="v2">hey</pns1:body>
</html>
!EOF
]])
