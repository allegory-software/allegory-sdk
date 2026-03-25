require'queue'

do
	local q = queue(4)
	local function test(s)
		local t = {}
		for s in q:items() do t[#t+1] = s.s end
		local s1 = table.concat(t)
		assert(s1 == s)
		assert(q:count() == #s)
	end
	local a = {s='a'}
	local b = {s='b'}
	local c = {s='c'}
	local d = {s='d'}
	local e = {s='e'}
	local f = {s='f'}
	assert(q:push(a))
	assert(q:push(b))
	assert(q:push(c))
	assert(q:push(d))
	assert(q:full())
	assert(q:pull())
	assert(q:push(e))
	assert(q:pull())
	assert(q:push(f))
	test'cdef'
	assert(q:remove(d) == d)
	test'cef'
	assert(q:remove(e) == e)
	test'cf'
	assert(q:remove(c) == c)
	test'f'
	q:remove(f)
	test''; assert(q:empty())
	assert(q:push(a))
	assert(q:push(b))
	assert(q:push(c))
	assert(q:push(d))
	assert(q:pull())
	assert(q:pull())
	assert(q:push(e))
	assert(q:push(f))
	test'cdef'
	print'queue ok'
end
