require'glue'
require'unit'

--math -----------------------------------------------------------------------

test(round(1.2), 1)
test(round(-1.2), -1)
test(round(1.5), 2) --half-up
test(round(-1.5), -1) --half-up
test(round(2^52+.49), 2^52) --largest number that works

test(snap(7, 5), 5)
test(snap(7.5, 5), 10) --half-up
test(snap(-7.5, 5), -5) --half-up

test(clamp(3, 2, 5), 3)
test(clamp(1, 2, 5), 2)
test(clamp(6, 2, 5), 5)

test(#random_string(1), 1)
test(#random_string(200), 200)

assert(uuid():gsub('[0-9a-f]', 'x') == 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')

--tables ---------------------------------------------------------------------

test(count({[0] = 1, 2, 3, a = 4}), 4)
test(count{}, 0)

test(indexof('b', {'a', 'b', 'c'}), 2)
test(indexof('b', {'x', 'y', 'z'}), nil)

test(index{a=5,b=7,c=3}, {[5]='a',[7]='b',[3]='c'})

local a1, a2, a3, b1, b2 = {a=1, b=1}, {a=1, b=2}, {a=1, b=3}, {a=2, b=1}, {a=2, b=2}
local function testcmp(s, t1, t2)
	table.sort(t1, cmp(s))
	test(t1, t2)
end
testcmp('a b'   , {a1, a2, a3, b1, b2}, {a1, a2, a3, b1, b2})
testcmp('a> b>' , {a1, a2, a3, b1, b2}, {b2, b1, a3, a2, a1})
testcmp('a b>'  , {a1, a2, a3, b1, b2}, {a3, a2, a1, b2, b1})
testcmp('a> b'  , {a1, a2, a3, b1, b2}, {b1, b2, a1, a2, a3})

test(keys({a=5,b=7,c=3}, true), {'a','b','c'})
test(keys({'a','b','c'}, true), {1,2,3})

local t1, t2 = {}, {}
for k,v in sortedpairs{c=5,b=7,a=3} do
	table.insert(t1, k)
	table.insert(t2, v)
end
test(t1, {'a','b','c'})
test(t2, {3,7,5})

test(update({a=1,b=2,c=3}, {d='add',b='overwrite'}, {b='over2'}), {a=1,b='over2',c=3,d='add'})

test(merge({a=1,b=2,c=3}, {d='add',b='overwrite'}, {b='over2'}), {a=1,b=2,c=3,d='add'})

local t = {k0 = {v0 = 1}}
test(attr(t, 'k0').v0, 1) --existing key
attr(t, 'k').v = 1
test(t.k, {v = 1}) --created key
attr(t, 'k2', function() return 'v2' end)
test(t.k2, 'v2') --custom value

--test: attrs_clear removes chain of empty tables.
local t = {}
attrs(t, 3, nil, 'a', 'b', 'd')
attrs(t, 2, nil, 'x', 'c')
attrs_clear(t, 'a', 'b', 'd')
test(t, {x={c={}}})

--test: tuple with fixed number of elements (tests memoize implicitly).
local tuple = tuples(3)
local t = tuple()
assert(t == tuple(nil))
assert(t == tuple(nil, nil))
assert(t == tuple(nil, nil, nil))

--test: tuple with variable number of elements (tests memoize implicitly).
local tuple = tuples()
local t1 = tuple()
local t2 = tuple(nil)
local t3 = tuple(nil, nil)
local t4 = tuple(nil, nil, nil)
assert(t1 ~= t2)
assert(t1 ~= t3)
assert(t1 ~= t4)
assert(t2 ~= t3)
assert(t2 ~= t4)
assert(t3 ~= t4)

--lists ----------------------------------------------------------------------

test(extend({5,6,8}, {1,2}, {'b','x'}), {5,6,8,1,2,'b','x'})
test(extend({n=0}, pack(nil)), {n=1})

test(append({1,2,3}, 5,6), {1,2,3,5,6})

local function insert(t,i,...)
	local n = select('#',...)
	shift(t,i,n)
	for j=1,n do t[i+j-1] = select(j,...) end
	return t
end
test(insert({'a','b'}, 1, 'x','y'), {'x','y','a','b'}) --2 shifts
test(insert({'a','b','c','d'}, 3, 'x', 'y'), {'a','b','x','y','c','d'}) --2 shifts
test(insert({'a','b','c','d'}, 4, 'x', 'y'), {'a','b','c','x','y','d'}) --1 shift
test(insert({'a','b','c','d'}, 5, 'x', 'y'), {'a','b','c','d','x','y'}) --0 shifts
test(insert({'a','b','c','d'}, 6, 'x', 'y'), {'a','b','c','d',nil,'x','y'}) --out of bounds
test(insert({'a','b','c','d'}, 1, 'x', 'y'), {'x','y','a','b','c','d'}) --first pos
test(insert({}, 1, 'x', 'y'), {'x','y'}) --empty dest
test(insert({}, 3, 'x', 'y'), {nil,nil,'x','y'}) --out of bounds

local function remove(t,i,n) return shift(t,i,-n) end
test(remove({'a','b','c','d'}, 1, 3), {'d'})
test(remove({'a','b','c','d'}, 2, 2), {'a', 'd'})
test(remove({'a','b','c','d'}, 3, 2), {'a', 'b'})
test(remove({'a','b','c','d'}, 1, 5), {}) --too many
test(remove({'a','b','c','d'}, 4, 2), {'a', 'b', 'c'}) --too many
test(remove({'a','b','c','d'}, 5, 5), {'a', 'b', 'c', 'd'}) --from too far
test(remove({}, 5, 5), {}) --from too far

test(reverse({}), {})
test(reverse({5}), {5})
test(reverse({5, 2}), {2, 5})
test(reverse({5, 2, 1}), {1, 2, 5})
test(reverse({1, 3, 7, 5, 2}), {2, 5, 7, 3, 1})
test(reverse({1, 3, 7, 5, 2}, 3), {1, 3, 2, 5, 7})
test(reverse({1, 3, 7, 5, 2}, 2, 3), {1, 7, 3, 5, 2})

test(binsearch(10, {}), nil)
test(binsearch(10, {11}), 1)
test(binsearch(11, {11}), 1)
test(binsearch(12, {11}), nil)
test(binsearch(12, {11, 13}), 2)
test(binsearch(13, {11, 13}), 2)
test(binsearch(11, {11, 13}), 1)
test(binsearch(14, {11, 13}), nil)
test(binsearch(10, {11, 13}), 1)
test(binsearch(14, {11, 13, 15}), 3)
test(binsearch(12, {11, 13, 15}), 2)
test(binsearch(10, {11, 13, 15}), 1)
test(binsearch(16, {11, 13, 15}), nil)

--strings --------------------------------------------------------------------

local function test1(s,sep,expect)
	local t={} for c in split(s,sep) do t[#t+1]=c end
	assert(#t == #expect)
	for i=1,#t do assert(t[i] == expect[i]) end
	test(t, expect)
end
test1('','',{''})
test1('','asdf',{''})
test1('asdf','',{'asdf'})
test1('', ',', {''})
test1(',', ',', {'',''})
test1('a', ',', {'a'})
test1('a,b', ',', {'a','b'})
test1('a,b,', ',', {'a','b',''})
test1(',a,b', ',', {'','a','b'})
test1(',a,b,', ',', {'','a','b',''})
test1(',a,,b,', ',', {'','a','','b',''})
test1('a,,b', ',', {'a','','b'})
test1('asd  ,   fgh  ,;  qwe, rty.   ,jkl', '%s*[,.;]%s*', {'asd','fgh','','qwe','rty','','jkl'})
test1('Spam eggs spam spam and ham', 'spam', {'Spam eggs ',' ',' and ham'})
t = {} for s,n in split('a 12,b 15x,c 20', '%s*(%d*),') do t[#t+1]={s,n} end
test(t, {{'a','12'},{'b 15x',''},{'c 20',nil}})
--TODO: use case with () capture

local i = 0
local function assert_lines(s, t)
	i = i + 1
	local dt = {}
	for s in lines(s, '*L') do
		table.insert(dt, s)
	end
	if #t ~= #dt then goto err end
	for i=1,#t do
		if t[i] ~= dt[i] then goto err end
	end
	do return end
	::err::
	require'pp'('actual  ', #dt, dt)
	require'pp'('expected', #t, t)
	error('test '..i..' failed')
end
assert_lines('', {''})
assert_lines(' ', {' '})
assert_lines('x\ny', {'x\n', 'y'})
assert_lines('x\ny\n', {'x\n', 'y\n', ''})
assert_lines('x\n\ny', {'x\n', '\n', 'y'})
assert_lines('\n', {'\n', ''})
assert_lines('\n\r\n', {'\n','\r\n',''})
assert_lines('\r\n\n', {'\r\n','\n',''})
assert_lines('\n\r', {'\n','\r',''})
assert_lines('\n\r\n\r', {'\n','\r\n','\r',''})
assert_lines('\n\n\r', {'\n','\n','\r',''})

test(trim('  a  d '), 'a  d')

test({(pcall(lineinfo, 'abc', 0))}, {false})
test({(pcall(lineinfo('abc'), 0))}, {false})
test({(pcall(lineinfo, 'abc', 5))}, {false})
test({(pcall(lineinfo('abc'), 5))}, {false})
test({lineinfo('abc', 1)}, {1, 1})
test({lineinfo('a\nb\nc', 4)}, {2, 2}) --on \n
test({lineinfo('a\nb\nc', 5)}, {3, 1})
test({lineinfo('a\nb\nc')(4)}, {2, 2}) --on \n
test({lineinfo('a\nb\nc')(5)}, {3, 1})

test(esc'^{(.-)}$', '%^{%(%.%-%)}%$')
test(esc'%\0%', '%%%z%%')

if jit and jit.version:find'2%.1' then
	test(tohex(0xdeadbeef01), 'deadbeef01')       --LuaJIT 2.1+
	test(tohex(0xdeadbeef02, true), 'DEADBEEF02') --LuaJIT 2.1+
end
test(tohex'\xde\xad\xbe\xef\x01', 'deadbeef01')
test(tohex('\xde\xad\xbe\xef\x02', true), 'DEADBEEF02')
test(fromhex'deadbeef01', '\xde\xad\xbe\xef\x01')
test(fromhex'DEADBEEF02', '\xde\xad\xbe\xef\x02')
test(fromhex'5', '\5')
test(fromhex'5ff', '\5\xff')

test(starts('abc', 'ab'), true)
test(starts('aabc', 'ab'), false)
test(starts('', ''), true)
test(starts('abc', ''), true)
test(starts('', 'a'), false)

test(ends('', ''), true)
test(ends('x', ''), true)
test(ends('x', 'x'), true)
test(ends('', 'x'), false)
test(ends('x', 'y'), false)
test(ends('ax', 'x'), true)
test(ends('ax', 'a'), false)

--iterators ------------------------------------------------------------------

test(collect(('abc'):gmatch('.')), {'a','b','c'})
test(collect(2,ipairs{5,7,2}), {5,7,2})

--objects --------------------------------------------------------------------

--overide
local o = {}
function o:x(a)
	assert(a == 5)
	return 7
end
o.override = override
o:override('x', function(inherited, self)
	local seven = inherited(self, 5)
	assert(seven == 7)
	return 8
end)
assert(o:x() == 8)

--dates & timestamps ---------------------------------------------------------

--TODO: time, utc_diff, year, month, day

--no way to adjust TZ so these are commented out.
--assert(utc_diff(time(2000, 7, 1)) == 10800)
--assert(utc_diff(time(2000, 1, 1)) == 7200)

--errors ---------------------------------------------------------------------

--TODO: assert, protect, pcall, fpcall, fcall

local caught
local function test_errors()
	local e1 = errortype'e1'
	local e2 = errortype('e2', 'e1')
	local e3 = errortype'e3'
	local ok, e = catch('e2 e3', function()
		local ok, e = catch('e1', function()
			raise('e2', 'imma e2')
		end)
		print'should not get here'
	end)
	if not ok then
		caught = e
	end
	raise(e)
end
assert(not pcall(test_errors))
assert(caught.errortype == 'e2')
assert(caught.message == 'imma e2')

--closures -------------------------------------------------------------------

test(pass(32), 32)

local n = 0
local f = memoize(function() n = n + 1; return 6; end)
test(f(), 6)
test(f(), 6)
test(n, 1)
local n = 0
local f = memoize(function(x) n = n + 1; return x and 2*x; end)
for i=1,100 do
	test(f(2), 4)
	test(f(3), 6)
	test(f(3), 6)
	--test(f(0/0), 0/0)
	--test(f(), nil) --no distinction between 0 args and 1 nil arg!
	--test(f(nil), nil)
end
test(n, 2)
local n = 0
local f = memoize(function(x, y) n = n + 1; return x and y and x + y; end)
for i=1,100 do
	test(f(3,2), 5)
	test(f(2,3), 5)
	test(f(2,3), 5)
	--test(f(nil,3), nil)
	--test(f(3,nil), nil)
	--test(f(nil,nil), nil)
	--test(f(), nil)     --no distinction between missing args and nil args!
	--test(f(nil), nil)  --same here, this doesn't increment the count!
	--test(f(0/0), nil)
	--test(f(nil, 0/0), nil)
	--test(f(0/0, 1), 0/0)
	--test(f(1, 0/0), 0/0)
	--test(f(0/0, 0/0), 0/0)
end
test(n, 2)
local n = 0
local f = memoize(function(x, y, z) n = n + 1; return x + y + z; end)
for i=1,100 do
	test(f(3,2,1), 6)
	test(f(2,3,0), 5)
	test(f(2,3,0), 5)
	--test(f(nil,3), nil)
	--test(f(3,nil), nil)
	--test(f(nil,nil), nil)
	--test(f(), nil)     --no distinction between missing args and nil args!
	--test(f(nil), nil)  --same here, this doesn't increment the count!
	--test(f(0/0), nil)
	--test(f(nil, 0/0), nil)
	--test(f(0/0, 1), 0/0)
	--test(f(1, 0/0), 0/0)
	--test(f(0/0, 0/0), 0/0)
end
test(n, 2)
if false then --vararg memoize is NYI
local n = 0
local f = memoize(function(x, ...)
	n = n + 1
	local z = x or -10
	for i=1,select('#',...) do
		z = z + (select(i,...) or -1)
	end
	return z
end)
for i=1,100 do
	test(f(10, 1, 1), 12) --1+2 args
	test(f(), -10) --1+0 args (no distinction between 0 args and 1 arg)
	test(f(nil), -10) --same here, this doesn't increment the count!
	test(f(nil, nil), -11) --but this does: 1+1 args
	test(f(0/0), 0/0) --1+0 args with NaN
end
test(n, 4)
local n = 0
local f = memoize(function(x, y, z) n = n + 1; return x + y + z + n end)
test(f(1, 1, 1), 4)
test(f(1, 1, 1, 1), 4) --arg#4 ignored even though using memoize_vararg()
end

--modules --------------------------------------------------------------------

--module

local function test_module()
	local foo_mod, foo_priv = module'foo'

	assert(getfenv() == foo_priv)
	assert(foo_mod._P == foo_priv)
	assert(foo_mod ~= foo_priv)
	assert(_M == foo_mod)
	assert(_P == _M._P)
	assert(__index == _G)
	assert(_P._M == _M)
	a = 123
	assert(a == 123)
	assert(_P.a == 123)
	_M.a = 321
	assert(_M.a == 321) --P and M are diff namespaces

	foo.module = module --make submodule api for foo

	local bar_mod = require'foo':module'bar' --submodule api
	local bar_mod2 = foo:module'bar' --submodule alt. api
	assert(bar_mod == bar_mod2) --using package.loaded works
	assert(__index == foo_mod._P) --inheriting works
	assert(bar_mod.print == nil) --public namespace not polluted
	b = 123
	assert(b == 123)
	assert(_P.b == 123)
	assert(bar_mod.a == 321) --inheriting the public namespace

end
test_module()
assert(getfenv() == _G) --not chainging the global scope

--autoload

local M = {}
local x, y, z, p = 0, 0, 0, 0
autoload(M, 'x', function() x = x + 1 end)
autoload(M, 'y', function() y = y + 1 end)
autoload(M, {z = function() z = z + 1 end, p = function() p = p + 1 end})
local _ = M.x, M.x, M.y, M.y, M.z, M.z, M.p, M.p
assert(x == 1)
assert(y == 1)
assert(z == 1)
assert(p == 1)

luapath('foo')
cpath('bar')
luapath('baz', 'after')
cpath('zab', 'after')
local so = package.cpath:match'%.dll' and 'dll' or 'so'
local norm = function(s) return s:gsub('/', package.config:sub(1,1)) end
assert(package.path:match('^'..esc(norm'foo/?.lua;')))
assert(package.cpath:match('^'..esc(norm'bar/?.'..so..';')))
assert(package.path:match(esc(norm'baz/?.lua;baz/?/init.lua')..'$'))
assert(package.cpath:match(esc(norm'zab/?.'..so)..'$'))

--ffi ------------------------------------------------------------------------

local ffi = require'ffi'

assert(ptr_serialize(cast('void*', 0x55555555)) == 0x55555555)
assert(ptr_deserialize('int*', 0x55555555) == cast('void*', 0x55555555))

assert(ptr_serialize(cast('void*', 0x5555555555)) == 0x5555555555)
--going out of our way not to use the LL suffix so that Lua 5.1 can compile this.
local huge = ffi.new('union { struct { uint32_t lo; uint32_t hi; }; struct{} *p; }',
	{lo = 0x12345678, hi = 0xdeadbeef})
local huges = '\x78\x56\x34\x12\xef\xbe\xad\xde'
assert(ptr_serialize(huge.p) == huges) --string comparison
assert(ptr_deserialize('union{}*', huges) == huge.p) --pointer comparison

--list the namespace ---------------------------------------------------------

for k,v in sortedpairs(_G) do
	print(string.format('%-20s %s', k, v))
end

--TODO: freelist, buffer
