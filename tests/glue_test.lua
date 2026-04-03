require'glue'
require'unit'

--math -----------------------------------------------------------------------

test(round(1.2), 1)
test(round(-1.2), -1)
test(round(1.5), 2) --half-up
test(round(-1.5), -1) --half-up
test(round(2^52+.49), 2^52) --largest number that works
test(round(0), 0)
test(round(0.5), 1) --half-up at 0
test(round(-0.5), 0) --half-up negative
test(round(2^52), 2^52) --boundary: largest exact int in double
test(round(-2^52), -2^52)

test(snap(7, 5), 5)
test(snap(7.5, 5), 10) --half-up
test(snap(-7.5, 5), -5) --half-up
test(snap(0, 5), 0) --zero snaps to zero
test(snap(2.5, 5), 5) --half-up
test(snap(-2.5, 5), 0) --half-up for negatives
test(snap(3), 3) --default p=1
test(snap(3.7), 4) --default p=1 with rounding

test(clamp(3, 2, 5), 3)
test(clamp(1, 2, 5), 2)
test(clamp(6, 2, 5), 5)

test(#random_string(1), 1)
test(#random_string(200), 200)

assert(uuid():gsub('[0-9a-f]', 'x') == 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')

--tables ---------------------------------------------------------------------

test(count({[0] = 1, 2, 3, a = 4}), 4)
test(count{}, 0)
test(count({a=1,b=2,c=3,d=4}, 2), 2) --stops early at maxn
test(count({a=1}, 100), 1) --maxn larger than table

test(indexof('b', {'a', 'b', 'c'}), 2)
test(indexof('b', {'x', 'y', 'z'}), nil)
test(indexof('b', {'a', 'b', 'c', 'b'}, nil, 3), 4) --start from i=3
test(indexof('b', {'a', 'b', 'c', 'b'}, nil, 2, 2), 2) --j limits search
test(indexof('b', {'a', 'b', 'c', 'b'}, nil, 3, 3), nil) --not found in range
do --custom eq function
	local function eq_lower(a, b) return a:lower() == b:lower() end
	test(indexof('B', {'a', 'b', 'c'}, eq_lower), 2)
end

test(index{a=5,b=7,c=3}, {[5]='a',[7]='b',[3]='c'})
do --index with duplicate values: last one wins
	local t = index{a=1, b=1}
	assert(t[1] == 'a' or t[1] == 'b')
end

local a1, a2, a3, b1, b2 = {a=1, b=1}, {a=1, b=2}, {a=1, b=3}, {a=2, b=1}, {a=2, b=2}
local function testcmp(s, t1, t2)
	table.sort(t1, cmp(s))
	test(t1, t2)
end
testcmp('a b'   , {a1, a2, a3, b1, b2}, {a1, a2, a3, b1, b2})
testcmp('a> b>' , {a1, a2, a3, b1, b2}, {b2, b1, a3, a2, a1})
testcmp('a b>'  , {a1, a2, a3, b1, b2}, {a3, a2, a1, b2, b1})
testcmp('a> b'  , {a1, a2, a3, b1, b2}, {b1, b2, a1, a2, a3})
do local f = cmp(true); assert(f(1,2) == true); assert(f(2,1) == false) end --ascending
do local f = cmp(false); assert(f(1,2) == false); assert(f(2,1) == true) end --descending

test(keys({a=5,b=7,c=3}, true), {'a','b','c'})
test(keys({'a','b','c'}, true), {1,2,3})
test(keys({a=5,b=7,c=3}, false), {'c','b','a'}) --descending sort
test(keys({a=5,b=7,c=3}, function(a,b) return a > b end), {'c','b','a'}) --custom cmp

local t1, t2 = {}, {}
for k,v in sortedpairs{c=5,b=7,a=3} do
	table.insert(t1, k)
	table.insert(t2, v)
end
test(t1, {'a','b','c'})
test(t2, {3,7,5})
do local n = 0; for k,v in sortedpairs{} do n = n + 1 end; assert(n == 0) end --empty

test(update({a=1,b=2,c=3}, {d='add',b='overwrite'}, {b='over2'}), {a=1,b='over2',c=3,d='add'})
test(update({a=1}, nil, {b=2}), {a=1, b=2}) --nil arg skipped

test(merge({a=1,b=2,c=3}, {d='add',b='overwrite'}, {b='over2'}), {a=1,b=2,c=3,d='add'})
test(merge({a=1}, nil, {b=2}), {a=1, b=2}) --nil arg skipped
test(merge({a=1}, {a=99, b=2}), {a=1, b=2}) --no overwrite

local t = {k0 = {v0 = 1}}
test(attr(t, 'k0').v0, 1) --existing key
attr(t, 'k').v = 1
test(t.k, {v = 1}) --created key
attr(t, 'k2', function() return 'v2' end)
test(t.k2, 'v2') --custom value

do --attrs_find
	local t = {a = {b = {c = 42}}}
	test(attrs_find(t, 'a', 'b', 'c'), 42) --existing chain
	test(attrs_find(t, 'a', 'x', 'c'), nil) --missing key in chain
end
do local t = {x = 1}; assert(attrs_find(t) == t) end --empty chain returns t

assert(not pcall(function() empty.x = 1 end)) --empty table is read-only
assert(isempty(empty))

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
test(extend({n=2, 1, 2}, {n=2, 3, nil}), {n=4, 1, 2, 3}) --sparse arrays with n
test(extend({1,2}, false, {3}), {1,2,3}) --false arg skipped

test(append({1,2,3}, 5,6), {1,2,3,5,6})
test(append({1}, 'a', nil, 'b'), {1, 'a', 'b'}) --skips nils without holes
test(append({}, nil, nil), {})
test(append({}, nil, 1, nil, 2, nil), {1, 2})
test(append({1}), {1}) --no extra args

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

test({popn({'a','b','c','d'}, 8)}, {'a','b','c','d'})
test({popn({'a','b','c','d'}, 2)}, {'c','d'})
test({popn({1,2,3}, 0)}, {}) --pop 0
do local t = {1,2,3}; local a,b,c = popn(t, 3); test({a,b,c}, {1,2,3}); test(t, {}) end --pop all

test(reverse({}), {})
test(reverse({5}), {5})
test(reverse({5, 2}), {2, 5})
test(reverse({5, 2, 1}), {1, 2, 5})
test(reverse({1, 3, 7, 5, 2}), {2, 5, 7, 3, 1})
test(reverse({1, 3, 7, 5, 2}, 3), {1, 3, 2, 5, 7})
test(reverse({1, 3, 7, 5, 2}, 2, 3), {1, 7, 3, 5, 2})
test(reverse({1,2,3,4}, 2, 3), {1, 3, 2, 4}) --even-length subrange

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
test(binsearch(12, {11, 13, 15}, '<'), 2) --string cmp '<'
test(binsearch(12, {11, 13, 15}, '<='), 2) --string cmp '<='
test(binsearch(12, {15, 13, 11}, '>'), 3) --reverse-sorted
test(binsearch(12, {15, 13, 11}, '>='), 3) --reverse-sorted
test(binsearch(13, {5, 11, 13, 15, 20}, nil, 2, 4), 3) --lo/hi subrange

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
do --split with start parameter
	local t = {}; for c in split('xxa,b,c', ',', 3) do t[#t+1] = c end
	test(t, {'a', 'b', 'c'})
end
do --split with plain=true
	local t = {}; for c in split('a.b.c', '.', 1, true) do t[#t+1] = c end
	test(t, {'a', 'b', 'c'})
end

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
test(trim(''), '') --empty
test(trim('   '), '') --all whitespace
test(trim('\t\n hello \t\n'), 'hello') --mixed whitespace
test(trim('nowhitespace'), 'nowhitespace') --no trimming needed

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
do --esc with *i mode (case insensitive)
	local p = esc('abc', '*i')
	assert(('ABC'):match(p) == 'ABC')
	assert(('abc'):match(p) == 'abc')
	assert(('AbC'):match(p) == 'AbC')
end

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

assert(('hello world'):has('world')) --string:has
assert(('hello world'):has('hello', 1))
assert(not ('hello world'):has('xyz'))

do --hexblock
	local s = hexblock('A')
	assert(type(s) == 'string')
	assert(s:find('41')) --'A' = 0x41
end

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

--date: returns a table with fractional seconds preserved
do
	local t0 = time(2000, 6, 15, 12, 30, 45.5)
	local d = date('*t', t0)
	assert(d.year == 2000)
	assert(d.month == 6)
	assert(d.day == 15)
	assert(d.hour == 12)
	assert(d.min == 30)
	assert(math.abs(d.sec - 45.5) < 0.01) --sub-second preserved
end

--date: string format
do
	local t0 = time(2000, 1, 1, 0, 0, 0)
	local s = date('%Y-%m-%d', t0)
	assert(s == '2000-01-01')
end

--time: with explicit date components
do
	local t1 = time(2000, 6, 15, 12, 0, 0)
	local t2 = time(2000, 6, 15, 13, 0, 0)
	assert(math.abs((t2 - t1) - 3600) < 1) --1 hour apart
end

--time: defaults (month=1, day=1, hour=0, min=0, sec=0)
do
	local t1 = time(2000)
	local t2 = time(2000, 1, 1, 0, 0, 0)
	assert(math.abs(t1 - t2) < 1)
end

--time: with table arg
do
	local t1 = time{year=2000, month=6, day=15, hour=12, min=30, sec=0}
	local t2 = time(2000, 6, 15, 12, 30, 0)
	assert(math.abs(t1 - t2) < 1)
end

--time: sub-second precision
do
	local t = time(2000, 1, 1, 0, 0, 0.75)
	local d = date('*t', t)
	assert(math.abs(d.sec - 0.75) < 0.01)
end

--time: utc flag shifts by utc_diff
do
	local t_local = time(false, 2000, 6, 15, 12, 0, 0)
	local t_utc   = time(true,  2000, 6, 15, 12, 0, 0)
	local diff = utc_diff(t_local)
	assert(math.abs((t_utc - t_local) - diff) == 0)
end

--utc_diff: returns a number (may vary by timezone/DST but is always valid)
do
	local t = time(2000, 6, 15)
	local d = utc_diff(t)
	assert(type(d) == 'number')
	assert(d == math.floor(d)) --integer seconds
	assert(math.abs(d) <= 14 * 3600) --max UTC offset is +/-14h
end

--day: start-of-day and day offset
do
	local t = time(2000, 6, 15, 14, 30, 0) --mid-afternoon
	local d0 = day(t)
	local dd = date('*t', d0)
	assert(dd.hour == 0 and dd.min == 0 and dd.sec == 0) --start of day
	assert(dd.day == 15)
	local d1 = day(t, 1) --next day
	assert(math.abs((d1 - d0) - 86400) < 2) --~24h apart (DST can shift by 1s rounding)
	local dm1 = day(t, -1) --prev day
	assert(math.abs((d0 - dm1) - 86400) < 2)
end

--month: start-of-month and month offset
do
	local t = time(2000, 6, 15, 14, 30, 0)
	local m0 = month(t)
	local md = date('*t', m0)
	assert(md.month == 6 and md.day == 1 and md.hour == 0)
	local m1 = month(t, 1)
	local m1d = date('*t', m1)
	assert(m1d.month == 7 and m1d.day == 1)
	local mm1 = month(t, -1)
	local mm1d = date('*t', mm1)
	assert(mm1d.month == 5 and mm1d.day == 1)
end

--month: wraps across year boundary
do
	local t = time(2000, 1, 15)
	local mp = month(t, -1)
	local mpd = date('*t', mp)
	assert(mpd.year == 1999 and mpd.month == 12 and mpd.day == 1)
	local t2 = time(2000, 12, 15)
	local mn = month(t2, 1)
	local mnd = date('*t', mn)
	assert(mnd.year == 2001 and mnd.month == 1 and mnd.day == 1)
end

--year: start-of-year and year offset
do
	local t = time(2000, 6, 15, 14, 30, 0)
	local y0 = year(t)
	local yd = date('*t', y0)
	assert(yd.year == 2000 and yd.month == 1 and yd.day == 1 and yd.hour == 0)
	local y1 = year(t, 1)
	local y1d = date('*t', y1)
	assert(y1d.year == 2001 and y1d.month == 1 and y1d.day == 1)
	local ym1 = year(t, -1)
	local ym1d = date('*t', ym1)
	assert(ym1d.year == 1999 and ym1d.month == 1 and ym1d.day == 1)
end

--sunday: returns start of the week (sunday)
do
	local t = time(2000, 6, 15, 14, 30, 0) --thursday
	local s = sunday(t)
	local sd = date('*t', s)
	assert(sd.wday == 1) --sunday
	assert(sd.hour == 0 and sd.min == 0 and sd.sec == 0)
	assert(s <= t) --sunday is before thursday
	assert(t - s < 7 * 86400) --within the same week
end

--sunday: offset moves by weeks
do
	local t = time(2000, 6, 15)
	local s0 = sunday(t)
	local s1 = sunday(t, 1)
	assert(math.abs((s1 - s0) - 7 * 86400) < 2) --1 week apart
	local sm1 = sunday(t, -1)
	assert(math.abs((s0 - sm1) - 7 * 86400) < 2)
end

--errors ---------------------------------------------------------------------

--assertf
assert(assertf(1) == 1)
assert(not pcall(assertf, false, 'err %s', 'msg'))

do --fpcall: finally runs on success
	local finally_ran = false
	local ret = fpcall(function(finally, onerror)
		finally(function() finally_ran = true end)
		return 42
	end)
	assert(ret == 42)
	assert(finally_ran)
end
do --fpcall: finally and onerror run on error
	local finally_ran = false
	local error_ran = false
	local ret, err = fpcall(function(finally, onerror)
		finally(function() finally_ran = true end)
		onerror(function() error_ran = true end)
		error('boom')
	end)
	assert(ret == nil)
	assert(finally_ran)
	assert(error_ran)
end
do --fcall: returns result on success
	local ret = fcall(function(finally, onerror)
		finally(function() end)
		return 99
	end)
	assert(ret == 99)
end
do --fcall: re-raises on error
	local ok = pcall(function()
		fcall(function(finally, onerror) error('fcall boom') end)
	end)
	assert(not ok)
end

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
do --memoize_multiret
	local n = 0
	local f = memoize_multiret(function(x) n = n + 1; return x, x*2 end)
	local a, b = f(5)
	test(a, 5); test(b, 10)
	local a2, b2 = f(5)
	test(a2, 5); test(b2, 10)
	test(n, 1) --only called once
end
do --poison: clear memoize cache
	local n = 0
	local f = memoize(function(x) n = n + 1; return x * 10 end)
	test(f(3), 30); test(n, 1)
	f(POISON, 3) --clear cache for arg 3
	test(f(3), 30); test(n, 2) --recomputed
end
do --istuple
	local tuple = tuples(2)
	local t = tuple(1, 2)
	assert(istuple(t))
	assert(not istuple({}))
	assert(not istuple(nil))
	assert(not istuple('x'))
end
do --tuple __tostring
	local tuple = tuples(2)
	assert(tostring(tuple(1, 2)) == '(1, 2)')
end
do --tuple __call (unpack)
	local tuple = tuples(2)
	local a, b = tuple(10, 20)()
	test(a, 10); test(b, 20)
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
assert(getfenv() == _G) --not changing the global scope

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
luacpath('bar')
luapath('baz', 'after')
luacpath('zab', 'after')
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

assert(str(nil) == nil) --str: nil for NULL
do local buf = ffi.new('char[4]', 'abc'); assert(str(buf, 3) == 'abc') end --str: valid pointer
assert(ptr(nil) == nil) --ptr: nil for NULL
assert(ptr(ffi.cast('void*', 0)) == nil) --ptr: nil for NULL cast
do local p = ffi.new('int[1]', {42}); assert(ptr(p) == p) end --ptr: non-NULL

--types ------------------------------------------------------------------

assert(isstr('hello'))
assert(not isstr(1))
assert(not isstr(nil))

assert(isnum(1))
assert(isnum(1.5))
assert(not isnum('1'))
assert(not isnum(nil))

assert(isint(1))
assert(isint(-5))
assert(isint(0))
assert(isint(1/0))  --documented: includes inf
assert(isint(-1/0)) --documented: includes -inf
assert(not isint(1.5))
assert(not isint(0/0)) --NaN is not an integer
assert(not isint('1'))

assert(istab({}))
assert(istab({1}))
assert(not istab('x'))
assert(not istab(nil))

assert(isbool(true))
assert(isbool(false))
assert(not isbool(nil))
assert(not isbool(1))

assert(isempty({}))
assert(not isempty({1}))
assert(not isempty({a=1}))

assert(isfunc(print))
assert(isfunc(function() end))
assert(not isfunc(nil))
assert(not isfunc('x'))

assert(iscdata(ffi.new('int[1]')))
assert(not iscdata({}))
assert(not iscdata(nil))

assert(isthread(coroutine.create(function() end)))
assert(not isthread(nil))
assert(not isthread({}))

--inherits
local base = object()
local child = object(base)
local grandchild = object(child)
assert(inherits(child, base))
assert(inherits(grandchild, base))
assert(inherits(grandchild, child))
assert(not inherits(base, child))
assert(not inherits({}, base))
assert(not inherits(nil, base) )
assert(not inherits('x', base))

--math (additional) ----------------------------------------------------------

test(lerp(0.5, 0, 1, 0, 10), 5)
test(lerp(0, 0, 1, 10, 20), 10)
test(lerp(1, 0, 1, 10, 20), 20)
test(lerp(0.5, 0, 1, 0, 100), 50)
test(lerp(2, 0, 1, 0, 10), 20) --extrapolation beyond range
test(lerp(-1, 0, 1, 0, 10), -10) --extrapolation below range

test(sign(5), 1)
test(sign(0), 0)
test(sign(-3), -1)
test(sign(1/0), 1) --positive infinity
test(sign(-1/0), -1) --negative infinity

test(strict_sign(5), 1)
test(strict_sign(0), 1)
test(strict_sign(-3), -1)
test(strict_sign(-0.0001), -1)

assert(math.abs(logbase(256, 2) - 8) < 1e-10)
assert(math.abs(logbase(100, 10) - 2) < 1e-10)
assert(math.abs(logbase(1, 10) - 0) < 1e-10) --log of 1 is always 0
assert(math.abs(logbase(8, 2) - 3) < 1e-10)

test(nextpow2(1), 1)
test(nextpow2(3), 4)
test(nextpow2(5), 8)
test(nextpow2(128), 128)
test(nextpow2(129), 256)
test(nextpow2(2), 2) --exact power of 2
test(nextpow2(1024), 1024)

test(repl(1, 1, 'x'), 'x')
test(repl(2, 1, 'x'), 2)
test(repl(nil, nil, 'y'), 'y')
test(repl('a', 'b', 'c'), 'a')

--varargs --------------------------------------------------------------------

test(pack(1,2,3), {n=3, 1,2,3})
test(pack(), {n=0})
test(pack(nil), {n=1})
test({unpack({1,2,3})}, {1,2,3})
test({unpack({1,2,3, n=3})}, {1,2,3})
test({unpack({1,nil,3, n=3})}, {1,nil,3})
test({unpack({10,20,30,40}, 2, 3)}, {20, 30}) --explicit i,j

--arrays (additional) --------------------------------------------------------

--add/push/pop
local t = {1,2,3}
add(t, 4)
test(t, {1,2,3,4})
push(t, 5)
test(t, {1,2,3,4,5})
test(pop(t), 5)
test(t, {1,2,3,4})

--remove_value
test(remove_value({1,2,3,4}, 3), 3)
test(remove_value({1,2,3,4}, 5), nil)
local t = {'a','b','c'}
remove_value(t, 'b')
test(t, {'a','c'})
do --first occurrence removed
	local t = {'a','b','a','c'}
	test(remove_value(t, 'a'), 1)
	test(t, {'b','a','c'})
end

--last
test(last({1,2,3}), 3)
test(last({5}), 5)
test(last({}), nil)

--slice
test(slice({1,2,3,4,5}, 2, 4), {[2]=2,[3]=3,[4]=4})
test(slice({1,2,3,4,5}, -3, -1), {[3]=3,[4]=4,[5]=5})
test(slice({1,2,3}, 1, 3), {1,2,3})
test(slice({}, 1, 1), {})
test(slice({10,20,30}, 1, 100), {10,20,30}) --beyond bounds
test(slice({10,20,30}, -100, 100), {10,20,30}) --beyond bounds

--binsearch_insert
local t = {1,3,5,7}
binsearch_insert(t, 4)
test(t, {1,3,4,5,7})
binsearch_insert(t, 0)
test(t, {0,1,3,4,5,7})
binsearch_insert(t, 10)
test(t, {0,1,3,4,5,7,10})
do local t = {}; binsearch_insert(t, 5); test(t, {5}) end --into empty
do local t = {1,3,5}; binsearch_insert(t, 3); test(t, {1,3,3,5}) end --duplicates

--sortedarray
local sa = sortedarray()
sa:add(5)
sa:add(1)
sa:add(3)
test(sa:find(3), 2)
test(sa:find(9), nil)
assert(sa:remove(3) == 3)
assert(sa:remove(9) == nil)
test({sa[1], sa[2]}, {1, 5})
do --empty operations and duplicates
	local sa = sortedarray()
	test(sa:find(1), nil) --find in empty
	assert(sa:remove(1) == nil) --remove from empty
	sa:add(3); sa:add(3)
	test({sa[1], sa[2]}, {3, 3})
end

--map
test(map({a=1, b=2}, function(k, v) return v * 10 end), {a=10, b=20})
test(map({a={x=10}, b={x=20}}, 'x'), {a=10, b=20}) --field plucking
do --method plucking
	local obj1 = {name = function(self) return self._n end, _n = 'foo'}
	local obj2 = {name = function(self) return self._n end, _n = 'bar'}
	test(map({a=obj1, b=obj2}, 'name'), {a='foo', b='bar'})
end

--imap
test(imap({10, 20, 30}, function(v) return v + 1 end), {11, 21, 31})
test(imap({{x=10}, {x=20}, {x=30}}, 'x'), {10, 20, 30}) --field plucking
do --method plucking
	local function mk(n) return {val = function(self) return self._v end, _v = n} end
	test(imap({mk(1), mk(2)}, 'val'), {1, 2})
end
test(imap({1, nil, 3, n=3}, function(v) return (v or 0) + 1 end), {2, 1, 4, n=3}) --sparse

--tables (additional) --------------------------------------------------------

--sortedkeys
test(sortedkeys({c=1, a=2, b=3}), {'a','b','c'})
test(sortedkeys({c=1, a=2, b=3}, function(a,b) return a > b end), {'c','b','a'}) --custom cmp

--strings (additional) -------------------------------------------------------

--words
local t = {}
for w in words'hello world foo' do t[#t+1] = w end
test(t, {'hello', 'world', 'foo'})
assert(words(nil) == nil) --pass-through for non-strings

--lines with *l mode (exclude line endings; this is the default)
local t = {}
for s in lines('a\nb\n', '*l') do t[#t+1] = s end
test(t, {'a', 'b', ''})
local t = {}
for s in lines('a\nb\n') do t[#t+1] = s end --default = *l
test(t, {'a', 'b', ''})

--outdent
test(outdent('  a\n  b\n  c'), 'a\nb\nc')
test(outdent('  a\n  b', '\t'), '\ta\n\tb')
do
	local s, indent = outdent('a\nb') --no indent to remove
	test(s, 'a\nb')
	test(indent, '')
end
do
	local s, indent = outdent('\t\ta\n\t\tb')
	test(s, 'a\nb')
	test(indent, '\t\t')
end
do --mixed indentation with more-indented lines
	local s, indent = outdent('  a\n    b\n  c')
	test(s, 'a\n  b\nc')
	test(indent, '  ')
end

--lpad/rpad/pad
test(lpad('x', 5), '    x')
test(lpad('x', 5, '0'), '0000x')
test(rpad('x', 5), 'x    ')
test(rpad('x', 5, '.'), 'x....')
test(lpad('hello', 3), 'hello') --no truncation
test(rpad('hello', 3), 'hello') --no truncation
test(pad('x', 5, '.', 'r'), 'x....') --pad with dir
test(pad('x', 5, '.', 'l'), '....x')
assert(not pcall(pad, 'x', 5, '.', 'x')) --invalid dir

--subst
test(subst('{foo} {bar}', {foo='a', bar='b'}), 'a b')
test(subst('{x}', {x=1}), '1')
test(subst('{missing}', {}), '{missing}')
do
	local s, missing = subst('{a} {b}', {a=1}, true)
	test(s, '1 {b}')
	test(missing, {'b'})
end
do --get_missing with no missing keys
	local s, missing = subst('{a}', {a=1}, true)
	test(s, '1')
	test(missing, nil)
end

--catany
test(catany(',', 'a', nil, 'b'), 'a,b')
test(catany(',', nil, nil), nil)
test(catany(',', 'x'), 'x')
test(catany(','), nil)
test(catany(',', 'a', 'b'), 'a,b')
test(catany('-', 'a', nil, nil, 'b', nil, 'c'), 'a-b-c') --many nils

--catall
test(catall('a', 'b'), 'ab')
test(catall('a', nil, 'b'), nil)
test(catall(), nil)

--capitalize
test(capitalize('hello world'), 'Hello World')
test(capitalize('foo bar baz'), 'Foo Bar Baz')

--html_escape
test(html_escape('<b>"hi"</b>'), '&lt;b&gt;&quot;hi&quot;&lt;&#x2F;b&gt;')
test(html_escape(nil), '')

--kbytes
test(kbytes(0), '0B')
test(kbytes(1024), '1K')
test(kbytes(1024*1024), '1M')
test(kbytes(1536, 1), '1.5K')
test(kbytes(1), '1B')
test(kbytes(1023), '1023B')
test(kbytes(1024*1024*1024), '1G')
test(kbytes(1024*1024*1024*1024), '1T')

--print_function -------------------------------------------------------------

do
	local buf = ''
	local out = function(s) buf = buf .. s end
	local pr = print_function(out)
	pr('hello', 'world')
	assert(buf == 'hello\tworld\n')
	buf = ''
	pr(42)
	assert(buf == '42\n')
	buf = ''
	pr() --no args: just a newline
	assert(buf == '\n')
end
do --custom format and newline
	local buf = ''
	local out = function(s) buf = buf .. s end
	local pr = print_function(out, function(v) return '['..tostring(v)..']' end, '\r\n')
	pr('a', 'b')
	assert(buf == '[a]\t[b]\r\n')
end

--callbacks ------------------------------------------------------------------

test(noop(), nil)
test({noop(1,2,3)}, {})

test(call(nil, 1, 2), nil)
test({call(nil, 1, 2)}, {nil, 1, 2})
test(call(function(x) return x*2 end, 5), 10)

--do_before / do_after
local log = {}
local f = function(self) log[#log+1] = 'main' end
local fb = do_before(f, function(self) log[#log+1] = 'before' end)
fb({})
test(log, {'before', 'main'})

local log = {}
local f = function(self) log[#log+1] = 'main' end
local fa = do_after(f, function(self) log[#log+1] = 'after' end)
fa({})
test(log, {'main', 'after'})
do --do_before with noop method
	local log = {}
	local f = do_before(noop, function(self) log[#log+1] = 'hook' end)
	f({})
	test(log, {'hook'}) --noop is replaced
end
do --do_after with noop hook
	local log = {}
	local f = do_after(function(self) log[#log+1] = 'main' end, noop)
	f({})
	test(log, {'main'}) --noop is stripped
end
do --do_before with nil method
	local log = {}
	local f = do_before(nil, function(self) log[#log+1] = 'hook' end)
	f({})
	test(log, {'hook'}) --hook becomes the method
end

--before/after on objects
local o = object()
function o:greet() return 'hello' end
local log = {}
before(o, 'greet', function(self) log[#log+1] = 'before' end)
o:greet()
test(log, {'before'})

local o = object()
function o:greet() return 'hello' end
local log = {}
after(o, 'greet', function(self) log[#log+1] = 'after' end)
o:greet()
test(log, {'after'})

--objects (additional) -------------------------------------------------------

--object basics
local A = object()
A.x = 10
local B = object(A)
assert(B.x == 10) --inherited
B.y = 20
assert(B.y == 20)
assert(A.y == nil) --not polluted

--gettersandsetters
local mt = gettersandsetters(
	{name = function(t) return t._name:upper() end},
	{name = function(t, v) t._name = v end}
)
local o = setmetatable({_name = 'test'}, mt)
assert(o.name == 'TEST')
o.name = 'foo'
assert(o._name == 'foo')
assert(o.name == 'FOO')
do --gettersandsetters with super
	local super = {color = 'red', size = 10}
	local mt = gettersandsetters(
		{name = function(t) return t._name:upper() end},
		{name = function(t, v) t._name = v end},
		super
	)
	local o = setmetatable({_name = 'test'}, mt)
	assert(o.name == 'TEST') --getter works
	assert(o.color == 'red') --falls through to super
	assert(o.size == 10) --falls through to super
	o.name = 'foo'
	assert(o._name == 'foo') --setter works
	o.age = 25
	assert(o.age == 25) --non-setter goes to rawset
end
do --gettersandsetters with nil getters/setters
	local mt = gettersandsetters(nil, nil)
	local o = setmetatable({x = 1}, mt)
	assert(o.x == 1)
end
do --object with mixins
	local A = object(); A.x = 1
	local B = object(A, nil, {y = 2, z = 3})
	assert(B.x == 1) --inherited from super
	assert(B.y == 2) --from mixin
	assert(B.z == 3) --from mixin
end
do --inherits: self-reference
	local A = object()
	assert(not inherits(A, A))
end

--eval -----------------------------------------------------------------------

test(eval('1+2'), 3)
test(eval('"hello"'), 'hello')
test({try_eval('1+2')}, {true, 3})
assert(try_eval('invalid syntax @@') == false)
test(eval('nil'), nil)
test(eval('"a".."b"'), 'ab')
test({try_eval('{1,2}')}, {true, {1,2}})

--bits -----------------------------------------------------------------------

assert(getbit(0xff, 0x10))
assert(not getbit(0x00, 0x10))
assert(not getbit(0xef, 0x10))

test(setbit(0x00, 0x10, true), 0x10)
test(setbit(0xff, 0x10, false), 0xef)

test(setbits(0x00, 0xff, 0xab), 0xab)
test(setbits(0xff00, 0x00ff, 0x0012), 0xff12)

test(bitflags('a c', {a=1, b=2, c=4}), 5)
test(bitflags({a=true, c=true}, {a=1, b=2, c=4}), 5)
test(bitflags(7), 7)
test(bitflags(nil), 0)
test(bitflags('a -c', {a=1, b=2, c=4}), 1) --minus prefix
test(bitflags({'a', 'c'}, {a=1, b=2, c=4}), 5) --array-form table
do local v = bswap16(0x1234); test(v, 0x3412) end --bswap16

--config ---------------------------------------------------------------------

test(config('_test_key', 42), 42) --returns default
test(config('_test_key'), 42) --returns stored value
test(config('_test_missing'), nil)
config{_test_a = 10, _test_b = 20} --table form
test(config('_test_a'), 10)
test(config('_test_b'), 20)

do
	local inner
	with_config({_test_wc = 99}, function()
		inner = config('_test_wc')
	end)
	test(inner, 99)
	test(config('_test_wc'), nil) --not leaked
end
do --load_config_string
	load_config_string('_test_lcs = 555')
	test(config('_test_lcs'), 555)
end
do --with_config: inner config doesn't leak
	config('_test_wc2', 10)
	local inner
	with_config({_test_wc2 = 99}, function() inner = config('_test_wc2') end)
	test(inner, 99)
	test(config('_test_wc2'), 10) --restored
end

--freelist -------------------------------------------------------------------

do
	local n = 0
	local alloc, free = freelist(
		function() n = n + 1; return {id = n} end,
		function(e) e.freed = true end
	)
	local a = alloc()
	assert(a.id == 1)
	local b = alloc()
	assert(b.id == 2)
	free(a)
	assert(a.freed)
	local c = alloc() --should reuse freed object
	assert(c == a) --same object returned
	local d = alloc() --no more freed: creates new
	assert(d.id == 3)
end
do --freelist with defaults (creates tables)
	local alloc, free = freelist()
	local a = alloc()
	assert(type(a) == 'table')
	free(a)
	local b = alloc()
	assert(b == a) --reused
end

--buffer ---------------------------------------------------------------------

do --buffer: grows in power-of-two steps
	local alloc = buffer()
	local buf, len = alloc(10)
	assert(buf ~= nil)
	assert(len >= 10) --capacity >= requested
	assert(len == nextpow2(10)) --power of 2
	local buf2, len2 = alloc(5) --smaller request: no realloc
	assert(buf2 == buf) --same buffer
	assert(len2 == len) --same capacity
end
do --buffer: release with false
	local alloc = buffer()
	local buf, len = alloc(8)
	assert(buf ~= nil)
	local buf2, len2 = alloc(false) --release
	assert(buf2 == nil and len2 == -1)
end
do --buffer: custom ctype
	local alloc = buffer('int32_t[?]')
	local buf, len = alloc(4)
	assert(buf ~= nil and len >= 4)
	buf[0] = 42; buf[1] = 99
	assert(buf[0] == 42 and buf[1] == 99)
end

--dynarray -------------------------------------------------------------------

do --dynarray: preserves data across reallocations
	local da = dynarray()
	local buf, len = da(4)
	assert(buf ~= nil and len == 4)
	buf[0] = 65; buf[1] = 66; buf[2] = 67; buf[3] = 68 --'ABCD'
	local buf2, len2 = da(100) --force realloc
	assert(len2 == 100)
	assert(buf2[0] == 65 and buf2[1] == 66 and buf2[2] == 67 and buf2[3] == 68) --preserved
end
do --dynarray: with min_capacity
	local da = dynarray(nil, 64)
	local buf, len = da(1) --request 1, but min_capacity is 64
	assert(buf ~= nil and len == 1) --returns minlen, not capacity
end
do --dynarray_pump: write and collect
	local write, collect, reset = dynarray_pump()
	write('hello')
	write(' world')
	local buf = collect()
	assert(buf ~= nil)
	assert(str(buf, 11) == 'hello world')
	reset()
	write('abc')
	buf = collect()
	assert(str(buf, 3) == 'abc')
end
do --dynarray_pump: nil write is eof (no-op)
	local write, collect = dynarray_pump()
	write('x')
	assert(write(nil, 0) == true)
	assert(write('') == true)
	local buf = collect()
	assert(str(buf, 1) == 'x')
end

--structured exceptions ------------------------------------------------------

require'errors_test'
require'errors_io_test'

print'glue ok'
