require'heap'

local function test_order()
	local h = heap()
	for i = 1, 100000 do
		h:push(math.random())
	end
	local n = -1/0
	while h:count() > 0 do
		local n0 = n
		n = h:pop()
		assert(n >= n0)
	end
end

local function test_example()
	local h = heap{cmp = function(a, b)
	      return a.priority < b.priority
	   end}
	h:push{priority = 20, etc = 'bar'}
	h:push{priority = 10, etc = 'foo'}
	assert(h:pop().priority == 10)
	assert(h:pop().priority == 20)
end

local function aeq(h, t)
	assert(#h == #t)
	for i=1,#t do assert(h[i] == t[i]) end
end

local function test_remove()
	local h = heap{1, 2, 100, 3, 4, 200, 300} -- 1-(2-(3, 4), 100-(200, 300))
	h:pop(2)
	aeq(h, {1, 3, 100, 300, 4, 200}) --2 replaced by 300; 300 swapped with 3
end

local function test_replace()
	local h = heap{1, 10, 10, 100, 100, 100, 100}
	h:replace(2, 300)
	aeq(h, {1, 100, 10, 300, 100, 100, 100}) --moved down
	local h = heap{1, 10, 10, 100, 100, 100, 100}
	h:replace(4, 5)
	aeq(h, {1, 5, 10, 10, 100, 100, 100}) --moved up
end

local function bench(type, h, size, valgen)
	local cmp = h.cmp or function(a, b) return a < b end
	local t0 = os.clock()
	for i=1,size do
	    h:push(valgen(h))
	end
	print(string.format('push speed: %-14s: %6d Ke/s', type, size / 10^3 / (os.clock() - t0)))
	t0 = os.clock()
	local v0 = h:pop()
	for i=2,size do
		local v = h:pop()
		assert(not cmp(v, v0))
		v0 = v
	end
	print(string.format('pop  speed: %-14s: %6d Ke/s', type, size / 10^3 / (os.clock() - t0)))
end

local function benchmark()
	if os.getenv'AUTO' then return end
	local size = 100000
	local function ngen(h) return math.random(1, size) end
	bench('Lua values',  heap{}, size, ngen)
	local function tgen(h) return {n = math.random(1, size)} end
	local function cmp(a, b) return a.n < b.n end
	bench('Lua tables'  , heap{cmp = cmp                 }, size, tgen)
	bench('Lua tables/i', heap{cmp = cmp, index_key = 'i'}, size, tgen)
end

local function test_heapify()
	--reverse-sorted input forces heapify to do real work
	local h = heap{50, 40, 30, 20, 10}
	local prev = -1/0
	while h:count() > 0 do
		local v = h:pop()
		assert(v >= prev)
		prev = v
	end
	--random input
	local t = {}
	for i = 1, 1000 do t[i] = math.random() end
	local h = heap(t)
	prev = -1/0
	while h:count() > 0 do
		local v = h:pop()
		assert(v >= prev)
		prev = v
	end
end

test_order()
test_example()
test_heapify()
test_remove()
test_replace()
if os.getenv'AUTO' then return end
benchmark()
print'heap ok'
