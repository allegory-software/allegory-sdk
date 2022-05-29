require'queue'

local q = queue(4)
local function test(s)
	local t = {}
	for s in q:items() do t[#t+1] = s end
	local s1 = table.concat(t)
	assert(s1 == s)
	assert(q:count() == #s)
end
assert(q:push'a')
assert(q:push'b')
assert(q:push'c')
assert(q:push'd')
assert(q:full())
assert(q:pop())
assert(q:push'e')
assert(q:pop())
assert(q:push'f')
test'cdef'
q:remove'd'
test'cef'
q:remove'e'
test'cf'
q:remove'c'
test'f'
q:remove'f'
test''; assert(q:empty())
assert(q:push'a')
assert(q:push'b')
assert(q:push'c')
assert(q:push'd')
assert(q:pop())
assert(q:pop())
assert(q:push'e')
assert(q:push'f')
test'cdef'
assert(q:exists'c')
assert(q:exists'd')
assert(q:exists'e')
assert(q:exists'f')
