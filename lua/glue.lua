--[=[

	Lua "assorted lengths of wire" library.
	Written by Cosmin Apreutesei. Public domain.

	Glue is a collection of "hand tools" necessary in any good dynamic language.
	It is compatible with Lua 5.1 with a few functions only available to LuaJIT.

TYPE CHECKING
	glue.isstr                                      is string
	glue.isnum                                      is number
	glue.isint                                      is integer (includes 1/0 and -1/0)
	glue.istab                                      is table
	glue.isfunc                                     is function
	glue.iscdata                                    is cdata
MATH
	glue.round(x[, p]) -> y                         round x to nearest integer or multiple of p (half up)
	glue.snap(x[, p]) -> y                          synonym for glue.round
	glue.floor(x[, p]) -> y                         round x down to nearest integer or multiple of p
	glue.ceil(x[, p]) -> y                          round x up to nearest integer or multiple of p
	glue.clamp(x, min, max) -> y                    clamp x in range
	glue.lerp(x, x0, x1, y0, y1) -> y               linear interpolation
	glue.sign(x) -> 1|0|-1                          sign
	glue.strict_sign(x) -> 1|-1                     strict sign
	glue.nextpow2(x) -> y                           next power-of-2 number
	glue.repl(x, v, r) -> x                         replace v with r in x
	glue.random_string(n) -> s                      generate random string of length n
	glue.uuid() -> s                                generate random UUID v4
VARARGS
	glue.pack(...) -> t                             pack varargs
	glue.unpack(t, [i] [,j]) -> ...                 unpack varargs
TABLES
	glue.empty                                      empty r/o table
	glue.count(t[, maxn]) -> n                      count keys in table (up to maxn)
	glue.index(t) -> dt                             switch keys with values
	glue.keys(t[,sorted|'desc'|cmp]) -> dt          make a list of all the keys
	glue.sortedkeys(t[,cmp]) -> dt                  make a sorted list of all keys
	glue.sortedpairs(t [,cmp]) -> iter() -> k, v    like pairs() but in key order
	glue.update(dt, t1, ...) -> dt                  merge tables - overwrites keys
	glue.merge(dt, t1, ...) -> dt                   merge tables - no overwriting
	glue.attr(t, k, [f, ...]) -> v                  autofield pattern for one key
	glue.attrs(t, N, [f], k1, ..., kN) -> v         autofield pattern for a chain of keys
	glue.attrs_find(t, k1, ..., kN) -> v            t[k1]...[kN]
	glue.attrs_clear(t, k1, ..., kN)                remove value at the end of key chain
CACHING
	glue.memoize(f,[cache],[minarg],[maxarg]) -> mf,cache   memoize pattern (fixarg or vararg)
	glue.tuples([narg],[space]) -> tuple(...)->t,space      create a tuple space (fixarg or vararg)
	glue.poison                                     value to use as arg#1 on a memoized function to clear the cache

ARRAYS
	glue.extend(dt, t1, ...) -> dt                  extend an array
	glue.append(dt, v1, ...) -> dt                  append non-nil values to an array
	glue.shift(t, i, n) -> t                        shift array elements
	glue.map(t, field|f,...) -> t                   map f over pairs of t or select a column from an array of records
	glue.imap(t, field|f,...) -> t                  map f over ipairs of t or select a column from an array of records
	glue.indexof(v, t, [i], [j]) -> i               scan array for value
	glue.binsearch(v, t, [cmp], [i], [j]) -> i      binary search in sorted array
	glue.sortedarray([sa]) -> sa                    stay-sorted array with insertion and removal in O(log n)
	glue.reverse(t, [i], [j]) -> t                  reverse array in place
STRINGS
	glue.gsplit(s,sep[,start[,plain]]) -> iter() -> e[,captures...]   split a string by a pattern
	glue.split(s,sep[,start[,plain]]) -> {s1,...}   split a string by a pattern
	glue.names('name1 ...') -> {'name1', ...}       split a string by whitespace
	glue.capitalize(s) -> s                         capitalize the first letter of every word in string
	glue.lines(s, [opt], [init]) -> iter() -> s, i, j, k   iterate the lines of a string
	glue.outdent(s, [indent]) -> s, indent          outdent/reindent text based on first line's indentation
	glue.lineinfo(s, [i]) -> line, col              return text position from byte position
	glue.trim(s) -> s                               remove padding
	glue.pad(s, n, [c], dir) -> s                   pad string
	glue.lpad(s, n, [c]) -> s                       left-pad string
	glue.rpad(s, n, [c]) -> s                       right-pad string
	glue.esc(s [,mode]) -> pat                      escape magic pattern characters
	glue.tohex(s|n [,upper]) -> s                   string or number to hex
	glue.fromhex(s[, isvalid]) -> s                 hex to string
	glue.starts(s, prefix) -> t|f                   find if string s starts with prefix
	glue.ends(s, suffix) -> t|f                     find if string s ends with suffix
	glue.subst(s, t) -> s                           string interpolation of {foo} occurences
	glue.catargs(sep, ...) -> s                     concat non-nil args
ITERATORS
	glue.collect([i,] iterator) -> t                collect iterated values into an array
STUBS
	glue.pass(...) -> ...                           does nothing, returns back all arguments
	glue.noop(...)                                  does nothing, returns nothing
OBJECTS
	glue.inherit(t, parent) -> t                    set or clear inheritance
	glue.object([super][, t], ...) -> t             create a class or object
	glue.before(class, method_name, f)              call f at the beginning of a method
	glue.after(class, method_name, f)               call f at the end of a method
	glue.override(class, method_name, f)            override a method
	glue.gettersandsetters([getters], [setters], [super]) -> mt  create a metatable that supports virtual properties
OS
	glue.win                                        true if platform is Windows
FILE & PIPE I/O
	glue.canopen(filename[, mode]) -> filename | nil            check if a file exists and can be opened
	glue.readfile(filename[, format][, open]) -> s | nil, err   read the contents of a file into a string
	glue.readpipe(cmd[,format][, open]) -> s | nil, err         read the output of a command into a string
	glue.writefile(filename, s|t|read, [format], [tmpfile])     write data to file safely
	glue.printer(out[, format]) -> f                            virtualize the print() function
TIME
	glue.time([utc, ][t]) -> ts                     like os.time() with optional UTC and date args
	glue.time([utc, ][y, [m], [d], [h], [min], [s], [isdst]]) -> ts  like os.time() with optional UTC and date args
	glue.utc_diff(t) -> seconds                     seconds from local time t to UTC
	glue.sunday([utc, ]t, [weeks]) -> t             time at last Sunday before t
	glue.day([utc, ][ts], [plus_days]) -> ts        timestamp at day's beginning from ts
	glue.month([utc, ][ts], [plus_months]) -> ts    timestamp at month's beginning from ts
	glue.year([utc, ][ts], [plus_years]) -> ts      timestamp at year's beginning from ts
	glue.timeago(ts[, from_ts]) -> s                format relative time
	glue.week_start_offset(country) -> n            week start offset for a country (0 for Sunday)
SIZES
	glue.kbytes(x [,decimals]) -> s                 format byte size in k/M/G/T-bytes
2D BOXES
	glue.fitbox(w, h, bw, bh) -> w, h               fit (w, h) box inside (bw, bh) box
ERRORS
	glue.assert(v [,message [,format_args...]]) -> v     assert with error message formatting
	glue.protect(func) -> protected_func                 wrap an error-raising function
	glue.pcall(f, ...) -> true, ... | false, traceback                pcall with traceback
	glue.fpcall(f, finally, onerror, ...) -> result | nil, traceback  pcall with finally/onerror
	glue.fcall(f, finally, onerror, ...) -> result                    same but re-raises
MODULES
	glue.module([name, ][parent]) -> M              create a module
	glue.autoload(t, submodules) -> M               autoload table keys from submodules
	glue.autoload(t, key, module|loader) -> t       autoload table keys from submodules
	glue.bin                                        get the script's directory
	glue.scriptname                                 get the script's name
	glue.luapath(path [,index [,ext]])              insert a path in package.path
	glue.cpath(path [,index])                       insert a path in package.cpath
ALLOCATION
	glue.freelist([create], [destroy]) -> alloc, free                  freelist allocation pattern
	glue.buffer(ctype) -> alloc(minlen) -> buf,capacity                auto-growing buffer
	glue.dynarray(ctype[,cap]) -> alloc(minlen|false) -> buf, minlen   auto-growing buffer that preserves data
	glue.dynarray_pump([dynarray]) -> write(), collect()               make a buffer with a write() API for writing into
	glue.dynarray_loader([dynarray]) -> get(), put(), collect()        make a buffer with a get()/put() API for writing into
	glue.readall(read, self, ...) -> buf, len       repeat read based on a read function
	glue.buffer_reader(buf, len) -> read            make a read function that consumes a buffer
	glue.malloc(size) -> p                          C malloc
	glue.realloc(p, size) -> p                      C realloc
	glue.free(p)                                    C free
FFI HELPERS
	glue.addr(ptr) -> number | string               store pointer address in Lua value
	glue.ptr([ctype, ]number|string) -> ptr         convert address to pointer
	glue.getbit(val, mask) -> true|false            get the value of a single bit from an integer
	glue.setbit(val, mask, bitval) -> val           set the value of a single bit from an integer
	glue.bor(flags, bits, [strict]) -> mask         bit.bor() that takes a string or table

TIP: Extend the Lua string namespace with glue.update(string, glue.string)
so you can use all glue string functions as string methods, eg. s:trim().

]=]

if not ... then require'glue_test'; return end

local glue = {}

local min, max, floor, ceil, ln, random =
	math.min, math.max, math.floor, math.ceil, math.log, math.random
local insert, remove, sort, concat = table.insert, table.remove, table.sort, table.concat
local char = string.char
local
	type, select, unpack, pairs, next, rawget, assert, setmetatable, getmetatable =
	type, select, unpack, pairs, next, rawget, assert, setmetatable, getmetatable

--types ----------------------------------------------------------------------

glue.isstr  = function(s) return type(s) == 'string' end
glue.isnum  = function(x) return type(x) == 'number' end
glue.isint  = function(x) return type(x) == 'number' and floor(x) == x end
glue.istab  = function(x) return type(x) == 'table'  end
glue.isfunc = function(f) return type(f) == 'function' end
glue.iscdata = function(f) return type(f) == 'cdata' end

--math -----------------------------------------------------------------------

--Round a number towards nearest integer or multiple of p.
--Rounds half-up (i.e. it returns -1 for -1.5).
--Works with numbers up to +/-2^52.
--It's not dead accurate as it returns eg. 1 instead of 0 for
--   0.49999999999999997 (the number right before 0.5) which is < 0.5.
function glue.round(x, p)
	p = p or 1
	return floor(x / p + .5) * p
end

--round a number towards nearest smaller integer or multiple of p.
function glue.floor(x, p)
	p = p or 1
	return floor(x / p) * p
end

--round a number towards nearest larger integer or multiple of p.
function glue.ceil(x, p)
	p = p or 1
	return ceil(x / p) * p
end

glue.snap = glue.round

--clamp a value in range. If max < min, the result is max.
function glue.clamp(x, x0, x1)
	return min(max(x, x0), x1)
end

--linearly project x in x0..x1 range to the y0..y1 range.
function glue.lerp(x, x0, x1, y0, y1)
	return y0 + (x-x0) * ((y1-y0) / (x1 - x0))
end

function glue.nextpow2(x)
	return max(0, 2^(ceil(ln(x) / ln(2))))
end

function glue.sign(x)
	return x > 0 and 1 or x == 0 and 0 or -1
end

function glue.strict_sign(x)
	return x >= 0 and 1 or -1
end

function glue.repl(x, v, r)
	if x == v then return r else return x end
end

if jit then
	local str = require'ffi'.string
	function glue.random_string(n)
		local buf = glue.u32a(n/4+1)
		for i=0,n/4 do
			buf[i] = random(0, 2^32-1)
		end
		return str(buf, n)
	end
else
	function glue.random_string(n)
		local t = {}
		for i=1,n do
			t[i] = random(0, 255)
		end
		return char(unpack(t))
	end
end

function glue.uuid() --don't forget to seed the randomizer!
	return ('%08x-%04x-%04x-%04x-%08x%04x'):format(
		random(0xffffffff), random(0xffff),
		0x4000 + random(0x0fff), --4xxx
		0x8000 + random(0x3fff), --10bb-bbbb-bbbb-bbbb
		random(0xffffffff), random(0xffff))
end

--varargs --------------------------------------------------------------------

if table.pack then
	glue.pack = table.pack
else
	function glue.pack(...)
		return {n = select('#', ...), ...}
	end
end

--always use this because table.unpack's default j is #t not t.n.
function glue.unpack(t, i, j)
	return unpack(t, i or 1, j or t.n or #t)
end

--tables ---------------------------------------------------------------------

glue.empty = setmetatable({}, {
	__newindex = function() error'trying to set a field in glue.empty' end, --read-only
	__metatable = false,
})

--count the keys in a table with an optional upper limit.
function glue.count(t, maxn)
	local maxn = maxn or 1/0
	local n = 0
	for _ in pairs(t) do
		n = n + 1
		if n >= maxn then break end
	end
	return n
end

--reverse keys with values.
function glue.index(t)
	local dt={}
	for k,v in pairs(t) do dt[v]=k end
	return dt
end

--put keys in a list, optionally sorted.
local function desc_cmp(a, b) return a > b end
function glue.keys(t, cmp)
	local dt={}
	for k in pairs(t) do
		dt[#dt+1]=k
	end
	if cmp == true or cmp == 'asc' then
		sort(dt)
	elseif cmp == 'desc' then
		sort(dt, desc_cmp)
	elseif cmp then
		sort(dt, cmp)
	end
	return dt
end

function glue.sortedkeys(t, cmp)
	return glue.keys(t, cmp or true)
end

--stateless pairs() that iterate elements in key order.
function glue.sortedpairs(t, cmp)
	local kt = glue.keys(t, cmp or true)
	local i, n = 0, #kt
	return function()
		i = i + 1
		if i > n then return end
		return kt[i], t[kt[i]]
	end
end

--update a table with the contents of other table(s) (falsey args skipped).
function glue.update(dt,...)
	for i=1,select('#',...) do
		local t=select(i,...)
		if t then
			for k,v in pairs(t) do dt[k]=v end
		end
	end
	return dt
end

--add the contents of other table(s) without overwrite.
function glue.merge(dt,...)
	for i=1,select('#',...) do
		local t=select(i,...)
		if t then
			for k,v in pairs(t) do
				if rawget(dt, k) == nil then dt[k]=v end
			end
		end
	end
	return dt
end

local NIL = {}

--`attr(t, k1)[k2] = v` is like `t[k1][k2] = v` with auto-creating `t[k1]`.
function glue.attr(t, k, cons, ...)
	if k == nil then k = NIL end
	local v = t[k]
	if v == nil then
		if cons == nil then
			v = {}
			t[k] = v
		else
			v = cons(...)
			t[k] = v == nil and NIL or v
		end
	end
	return v
end

function glue.attrs(t, n, cons, ...)
	for i = 1, n do
		local k = select(i,...)
		if k == nil then k = NIL end
		local v = t[k]
		if i < n then
			if v == nil then
				v = {}
				t[k] = v
			end
			t = v
		else
			if v == nil then
				if cons then
					v = cons(...)
					t[k] = v == nil and NIL or v
				else
					v = {}
					t[k] = v
				end
			elseif v == NIL then
				v = nil
			end
			return v
		end
	end
end

function glue.attrs_find(t, ...)
	for i = 1, select('#', ...) do
		local k = select(i,...)
		if k == nil then k = NIL end
		local v = t[k]
		if v == nil then return nil end
		t = v
	end
	return t
end

function glue.attrs_clear(t, ...)
	local n = select('#', ...)
	if n == 0 then
		for k,v in pairs(t) do
			t[k] = nil
		end
		return
	end
	local empty_t, empty_k
	--^^ first t[k] that will be pointing at a chain of empty tables after
	--the value is removed, so they can be safely removed with t[k] = nil.
	local t0, k0
	for i = 1, n do
		local k = select(i, ...)
		if k == nil then k = NIL end
		local v = t[k]
		if v == nil then
			break
		end
		if next(t) == k and next(t, k) == nil then --k is the only key left in t.
			if not empty_t then
				empty_t, empty_k = t0, k0
			end
		else
			empty_t, empty_k = nil
		end
		if i < n then
			t0, k0 = t, k
			t = v
		else
			t[k] = nil
			if empty_t then
				empty_t[empty_k] = nil
			end
		end
	end
end

local attrs, attrs_clear = glue.attrs, glue.attrs_clear

local NOARG = {} --special arg for zero-arg functions or calls.

--with fixarg functions we store the memoized value in the leaf node directly.
local function memoize_fixarg(f, n, cache)
	cache = cache or {}
	if n == 0 then
		return function()
			return attrs(cache, 1, f, NOARG)
		end, cache
	else
		return function(...)
			return attrs(cache, n, f, ...)
		end, cache
	end
end

--with vararg functions we can't just store the memoized value in the
--leaf node because any leaf node can become a key node on future calls.
local VAL   = {} --special key to store the memozied value in the leaf node.
local function memoize_vararg(f, minarg, maxarg, cache)
	cache = cache or {}
	return function(...)
		local n = min(max(select('#', ...), minarg), maxarg)
		local t = n == 0
			and attrs(cache, 1, nil, NOARG)
			 or attrs(cache, n, nil, ...)
		local v = t[VAL]
		if v == nil then
			v = f(...)
			assert(v ~= nil)
			t[VAL] = v
		end
		return v
	end, cache
end

--tuples are interned value lists that can be used as table keys to achieve
--multi-key indexing because they have value semantics: a tuple space returns
--the same tuple object for the same combination of values.
local tuple_mt = {__call = glue.unpack}
function tuple_mt:__tostring()
	local t = {}
	for i=1,self.n do
		t[i] = tostring(self[i])
	end
	return string.format('(%s)', concat(t, ', '))
end
function glue.tuples(n, space)
	space = space or {}
	local function gen_tuple(...)
		return setmetatable({n = select('#', ...), ...}, tuple_mt)
	end
	if n then --fixarg: use the leaf node itself as the tuple object.
		assert(n >= 1)
		return memoize_fixarg(gen_tuple, n, space)
	else --vararg: put the tuple in the special VAL key of the value-table.
		return memoize_vararg(gen_tuple, 0, 1/0, space)
	end
end
function glue.istuple(t)
	return getmetatable(t) == tuple_mt
end

--special value to use as arg#1 on a memoized function to clear the cache
--on a prefix of arguments.
local POISON = {}
glue.poison = POISON

function glue.memoize(f, cache, minarg, maxarg)
	if not minarg then
		local info = debug.getinfo(f, 'u')
		if info.isvararg then
			minarg, maxarg = info.nparams, 1/0
		else
			minarg, maxarg = info.nparams, info.nparams
		end
	end
	cache = cache or {}
	local mf = minarg ~= maxarg
		and memoize_vararg(f, minarg, maxarg, cache)
		 or memoize_fixarg(f, minarg, cache)
	return function(...)
		if ... == POISON then
			attrs_clear(cache, select(2, ...))
		else
			return mf(...)
		end
	end, cache, minarg, maxarg
end

--lists ----------------------------------------------------------------------

--extend a list with the elements of other lists (skipping falsey args).
function glue.extend(dt,...)
	for j=1,select('#',...) do
		local t=select(j,...)
		if t then
			local j = #dt
			for i=1,#t do dt[j+i]=t[i] end
		end
	end
	return dt
end

--append non-nil arguments to a list.
function glue.append(dt,...)
	local j = #dt
	for i=1,select('#',...) do
		dt[j+i] = select(i,...)
	end
	return dt
end

--insert n elements at i, shifting elemens on the right of i (i inclusive)
--to the right.
local function insert_n(t, i, n)
	if n == 1 then --shift 1
		insert(t, i, false)
		return
	end
	for p = #t,i,-1 do --shift n
		t[p+n] = t[p]
	end
end

--remove n elements at i, shifting elements on the right of i (i inclusive)
--to the left.
local function remove_n(t, i, n)
	n = min(n, #t-i+1)
	if n == 1 then --shift 1
		remove(t, i)
		return
	end
	for p=i+n,#t do --shift n
		t[p-n] = t[p]
	end
	for p=#t,#t-n+1,-1 do --clean tail
		t[p] = nil
	end
end

--shift all the elements on the right of i (i inclusive), n positions to the
--to the left (if n is negative), removing elements, or further to the right
--(if n is positive), making room for new elements.
function glue.shift(t, i, n)
	if n > 0 then
		insert_n(t, i, n)
	elseif n < 0 then
		remove_n(t, i, -n)
	end
	return t
end

--map `f(k, v, ...) -> v1` over t or extract a column from a list of records.
--if f is not a function, then the values of t must be themselves tables,
--in which case f is a key to pluck from those tables. Plucked functions
--are called as methods and their result is selected instead. This allows eg.
--calling a method for each element in a table of objects and collecting
--the results in a table.
function glue.map(t, f, ...)
	local dt = {}
	if type(f) == 'function' then
		for k,v in pairs(t) do
			dt[k] = f(k, v, ...)
		end
	else
		for k,v in pairs(t) do
			local sel = v[f]
			if type(sel) == 'function' then --method to apply
				dt[k] = sel(v, ...)
			else --field to pluck
				dt[k] = sel
			end
		end
	end
	return dt
end

--map `f(v, ...) -> v1` over t or extract a column from a list of records.
--same plucking semantics as map() but applied on lists.
function glue.imap(t, f, ...)
	local dt = {n = t.n}
	local n = t.n or #t
	if type(f) == 'function' then
		for i=1,n do
			dt[i] = f(t[i], ...)
		end
	else
		for i=1,n do
			local v = t[i]
			local sel = v[f]
			if type(sel) == 'function' then --method to apply
				dt[i] = sel(v, ...)
			else --field to pluck
				dt[i] = sel
			end
		end
	end
	return dt
end

--arrays ---------------------------------------------------------------------

--scan list for value. works with ffi arrays too given i and j.
--Works on ffi arrays too if i and j are provided.
function glue.indexof(v, t, eq, i, j)
	i = i or 1
	j = j or #t
	if eq then
		for i = i, j do
			if eq(t[i], v) then
				return i
			end
		end
	else
		for i = i, j do
			if t[i] == v then
				return i
			end
		end
	end
end

--reverse elements of a list in place. works with ffi arrays too given i and j.
function glue.reverse(t, i, j)
	i = i or 1
	j = (j or #t) + 1
	for k = 1, (j-i)/2 do
		t[i+k-1], t[j-k] = t[j-k], t[i+k-1]
	end
	return t
end

-- binary search for the smallest insert position that keeps the table sorted.
-- returns nil if v is larger than the largest value or if t is empty.
-- works with ffi arrays too if lo and hi are provided.
-- cmp is f(t, i, v) -> t|f or it can be '<', '>', '<=', '>='.
-- use t[i] <  v to get the smallest insert position.
-- use t[i] <= v to get the largest insert position.
-- use t[i] >  v (i.e. '>') to search in a reverse-sorted array.
local cmps = {}
cmps['<' ] = function(t, i, v) return t[i] <  v end
cmps['>' ] = function(t, i, v) return t[i] >  v end
cmps['<='] = function(t, i, v) return t[i] <= v end
cmps['>='] = function(t, i, v) return t[i] >= v end
local less = cmps['<']
function glue.binsearch(v, t, cmp, lo, hi)
	lo, hi = lo or 1, hi or #t
	cmp = cmp and cmps[cmp] or cmp or less
	local len = hi - lo + 1
	if len == 0 then return nil end
	if len == 1 then return not cmp(t, lo, v) and lo or nil end
	while lo < hi do
		local mid = floor(lo + (hi - lo) / 2)
		if cmp(t, mid, v) then
			lo = mid + 1
			if lo == hi and cmp(t, lo, v) then
				return nil
			end
		else
			hi = mid
		end
	end
	return lo
end

--array that stays sorted with insertion, searching and removal in O(log n).
--if given an array to be wrapped, it must be already sorted.
--sa.cmp is used for cmp in binarysearch().
--use sa:push(v) to add values.
--use sa:find(v) -> i|nil to look up values.
--use sa:remove_value(v) -> v|nil to find and remove a value.
do local sa = {}
	function sa:find(v) return glue.binsearch(v, self, self.cmp) end
	function sa:push(v) insert(self, self:find(v) or #self+1, v) end
	function sa:remove_value(v)
		local i = self:find(v)
		if not i then return nil end
		return remove(self, i)
	end
	function glue.sortedarray(t)
		return glue.object(sa, t)
	end
end

--strings --------------------------------------------------------------------

--string submodule. has its own namespace which can be merged with _G.string.
glue.string = {}

--split a string by a separator pattern (or plain string).
--returns a stateless iterator for the pieces.
--if sep is '' returns the entire string in one iteration.
--empty strings between separators are always returned, eg. glue.gsplit(',', ',')
--produces 2 empty strings.
--captures are allowed in sep and they are returned after the element,
--except for the last element for which they don't match (by definition).
local function iterate_once(s, s1)
	return s1 == nil and s or nil
end
function glue.string.gsplit(s, sep, start, plain)
	start = start or 1
	plain = plain or false
	if not s:find(sep, start, plain) then
		return iterate_once, s:sub(start)
	end
	local done = false
	local function pass(i, j, ...)
		if i then
			local seg = s:sub(start, i - 1)
			start = j + 1
			return seg, ...
		else
			done = true
			return s:sub(start)
		end
	end
	return function()
		if done then return end
		if sep == '' then done = true; return s:sub(start) end
		return pass(s:find(sep, start, plain))
	end
end

function glue.string.split(s, sep, start, plain)
	return glue.collect(glue.gsplit(s, sep, start, plain))
end

--split a string by whitespace. unlike glue.split(s, '%s+'), it ignores
--any resulting empty elements; also, non-string args pass through.
function glue.string.names(s)
	if type(s) ~= 'string' then
		return s
	end
	local t = {}
	for s in glue.trim(s):gmatch'[^%s]+' do
		t[#t+1] = s
	end
	return t
end

--capitalize the first letter of every word in string.
local function cap(a, b) return a:upper()..b end
function glue.string.capitalize(s)
	return s:gsub('(%l)(%w*)', cap)
end

--[[
 split a string into lines, optionally including the line terminator.
* for each line it returns the line contents, the content-start, content-end
  and the next-content-start indices.
* the lines are split at '\r\n', '\r' and '\n' markers.
* the line ending markers are included or excluded depending on the second
  arg, which can be '*L' (include line endings; default) or '*l' (exclude).
* if the string is empty or doesn't contain a line ending marker, it is
  iterated once.
* if the string ends with a line ending marker, one more empty string is
  iterated.
* init tells it where to start parsing (default is 1).
]]
function glue.string.lines(s, opt, i)
	local term = opt == '*L'
	local patt = term and '()([^\r\n]*()\r?\n?())' or '()([^\r\n]*)()\r?\n?()'
	i = i or 1
	local ended
	return function()
		if ended then return end
		local i0, s, i1, i2 = s:match(patt, i)
		ended = i1 == i2
		i = i2
		return s, i0, i1, i2
	end
end

--outdent lines based on the indentation of the first non-empty line.
--bails out if a subsequent line is less indented than the first non-empty line.
--newindent is an optional indentation to prepended to each unindented line.
function glue.string.outdent(s, newindent)
	newindent = newindent or ''
	local indent
	local t = {}
	for s in glue.lines(s) do
		local indent1 = s:match'^([\t ]*)[^%s]'
		if not indent then
			indent = indent1
		elseif indent1 then
			if indent ~= indent1 then
				if #indent1 > #indent then --more indented
					if not glue.starts(indent1, indent) then
						indent = ''
						break
					end
				elseif #indent > #indent1 then --less indented
					if not glue.starts(indent, indent1) then
						indent = ''
						break
					end
					indent = indent1
				else --same length, diff contents.
					indent = ''
					break
				end
			end
		end
		t[#t+1] = s
	end
	indent = indent or ''
	if indent == '' and newindent == '' then
		return s
	end
	for i=1,#t do
		t[i] = newindent .. t[i]:sub(#indent + 1)
	end
	return concat(t, '\n'), indent
end

--return the line and column numbers at a specific index in a string.
--if i is not given, returns a function f(i) that is faster on repeat calls.
function glue.string.lineinfo(s, i)
	if i then --simpler version with no garbage for when the index is given.
		assert(i > 0 and i <= #s + 1)
		local line, col = 1, 1
		local byte = string.byte
		for i = 1, i - 1 do
			col = col + 1
			if byte(s, i) == 10 then
				line = line + 1
				col = 1
			end
		end
		return line, col
	end
	--collect char indices of all the lines in s, incl. the index at #s + 1
	local t = {}
	for i in s:gmatch'()[^\r\n]*\r?\n?' do
		t[#t+1] = i
	end
	assert(#t >= 2)
	local function lineinfo(i)
		--do a binary search in t to find the line.
		--TODO: replace this with glue.binsearch().
		assert(i > 0 and i <= #s + 1)
		local min, max = 1, #t
		while true do
			local k = floor(min + (max - min) / 2)
			if i >= t[k] then
				if k == #t or i < t[k+1] then --found it
					return k, i - t[k] + 1
				else --look forward
					min = k
				end
			else --look backward
				max = k
			end
		end
	end
	return lineinfo
end

--string trim12 from Lua wiki (trims any %s).
function glue.string.trim(s)
	local from = s:match'^%s*()'
	return from > #s and '' or s:match('.*%S', from)
end

--pad string s to length n using char c (which defaults to ' ') on its right
--side (dir = 'r') or left side (dir = 'l').
local function pad(s, n, c, dir)
	local pad = (c or ' '):rep(n - #s)
	return dir == 'l' and pad..s or dir == 'r' and s..pad or error'dir arg required'
end
glue.string.pad = pad
function glue.string.lpad(s, n, c) return pad(s, n, c, 'l') end
function glue.string.rpad(s, n, c) return pad(s, n, c, 'r') end

--escape a string so that it can be matched literally inside a pattern.
--escape magic characters of string s so that it can be used as a pattern
--that matches s literally in string matching functions.
--the optional arg mode can have the value '*i' (for case insensitive).
local function format_ci_pat(c)
	return ('[%s%s]'):format(c:lower(), c:upper())
end
function glue.string.esc(s, mode) --escape is a reserved word in Terra
	s = s:gsub('%%','%%%%'):gsub('%z','%%z')
		:gsub('([%^%$%(%)%.%[%]%*%+%-%?])', '%%%1')
	if mode == '*i' then s = s:gsub('[%a]', format_ci_pat) end
	return s
end

--convert binary string or a Lua number to its hex representation.
--numbers must be in the unsigned 32 bit integer range.
function glue.string.tohex(s, upper)
	if type(s) == 'number' then
		return (upper and '%08.8X' or '%08.8x'):format(s)
	end
	if upper then
		return (s:gsub('.', function(c)
		  return ('%02X'):format(c:byte())
		end))
	else
		return (s:gsub('.', function(c)
		  return ('%02x'):format(c:byte())
		end))
	end
end

--convert hex string to its binary representation. returns nil on invalid
--input unless isvalid is given which makes it raise on invalid input.
local function fromhex(s, isvalid)
	if not isvalid then
		if s:find'[^0-9a-fA-F]' then
			return nil
		end
	else
		s = s:gsub('[^0-9a-fA-F]', '')
	end
	if #s % 2 == 1 then
		return fromhex('0'..s)
	end
	return (s:gsub('..', function(cc)
		return char(assert(tonumber(cc, 16)))
	end))
end
glue.string.fromhex = fromhex

function glue.string.starts(s, p) --5x faster than s:find'^...' in LuaJIT 2.1
	return s:sub(1, #p) == p
end

function glue.string.ends(s, p)
	return p == '' or s:sub(-#p) == p
end

function glue.string.subst(s, t, get_missing) --subst('{foo} {bar}', {foo=1, bar=2}) -> '1 2'
	if get_missing then
		local missing
		return s:gsub('{([_%w]+)}', function(s)
			if t[s] ~= nil then
				return t[s]
			else
				if not missing then missing = {} end
				missing[#missing + 1] = s
			end
		end), missing
	else
		return s:gsub('{([_%w]+)}', t)
	end
end

--concat args, skipping nil ones. returns nil if there are no non-nil args.
function glue.catargs(sep, ...)
	local n = select('#', ...)
	if n == 0 then
		return nil
	elseif n == 1 then
		local v = ...
		return v ~= nil and tostring(v) or nil
	elseif n == 2 then
		local v1, v2 = ...
		if v1 ~= nil then
			if v2 ~= nil then
				return v1 .. sep .. v2
			else
				return tostring(v1)
			end
		elseif v2 ~= nil then
			return tostring(v2)
		else
			return nil
		end
	else
		local t = {}
		for i = 1, n do
			local s = select(i, ...)
			if s ~= nil then
				t[#t+1] = tostring(s)
			end
		end
		return #t > 0 and concat(t, sep) or nil
	end
end

--publish the string submodule in the glue namespace.
glue.update(glue, glue.string)

--iterators ------------------------------------------------------------------

--run an iterator and collect the i-th return value into a list.
local function select_at(i,...)
	return ...,select(i,...)
end
local function collect_at(i,f,s,v)
	local t = {}
	repeat
		v,t[#t+1] = select_at(i,f(s,v))
	until v == nil
	return t
end
local function collect_first(f,s,v)
	local t = {}
	repeat
		v = f(s,v); t[#t+1] = v
	until v == nil
	return t
end
function glue.collect(n,...)
	if type(n) == 'number' then
		return collect_at(n,...)
	else
		return collect_first(n,...)
	end
end

--stubs ----------------------------------------------------------------------

function glue.pass(...) return ... end
function glue.noop() return end

--objects --------------------------------------------------------------------

--set up dynamic inheritance by creating or updating a table's metatable.
--unlike glue.object(), this doesn't add any keys to the object.
--for static (single or multiple) inheritance, use glue.update().
--parent can be a function for dynamic dispatching.
function glue.inherit(t, parent)
	local meta = getmetatable(t)
	if meta then
		meta.__index = parent
	elseif parent ~= nil then
		setmetatable(t, {__index = parent})
	end
	return t
end

--[[
This 5 LOC object model has the following qualities:
* small memory footprint: only 3 table slots and no extra tables.
* funcall-style instantiation with t(...) by defining t:__call(...).
* subclassing from instances is allowed (prototype-based inheritance).
* do `t.__call = glue.object` to get t(...) -> t1 i.e. use glue.object as
  constructor stub for both subclassing and instantiation.
* do `t.new = glue.object` to get t:new(...) -> t1 (same thing, different style).
* do `t.subclass = glue.object` to get t:subclass(...) -> t1, i.e. use
  different constructors for subclassing and for instantiation.
* virtual classes (aka dependency injection, aka nested inner classes whose
  fields and methods can be overridden by subclasses of the outer class):
  composite objects which need to instantiate other objects can be made
  extensible by exposing those objects' classes as fields of the container
  class with `container_class.inner_class = inner_class` and instantiating
  with `self.inner_class(...)` so that replacing `inner_class` in a sub-class
  of `container_class` is possible. Moreso, instantiation with
  `self:inner_class(...)` (so with a colon) passes the container object to
  `inner_class`'s constructor automatically which allows referencing the
  container object from the inner object.
* overriding syntax sugar so that the super class need not be referenced
  explicitly when overriding can be incorporated into a class C with
  `C.override = glue.override`, `C.before = glue.before`, `C.after = glue.after`.
]]
function glue.object(super, o, ...)
	o = o or {}
	o.__index = super
	o.__call = super and super.__call
	glue.update(o, ...) --add mixins, defaults, etc.
	return setmetatable(o, o)
end

--[[
We call these method overriding hooks. Check it out:
	glue.before   (foo, 'bar', f)  # foo.bar method patched to call f(self, ...) first
	glue.after    (foo, 'bar', f)  # foo.bar method patched to call f(self, ...) last
	glue.override (foo, 'bar', f)  # foo.bar(...) returns f(inherited, self, ...)
or:
	Foo.before = glue.before    # Foo class got new ability
	Foo.after  = glue.after     # Foo class got new ability
	foo:before  ('bar', f)      # foo.bar method patched to call f(self, ...) first
	foo:after   ('bar', f)      # foo.bar method patched to call f(self, ...) last
	foo:override('bar', f)      # foo.bar(...) returns f(inherited, self, ...)
]]
local function install(self, combine, method_name, hook)
	rawset(self, method_name, combine(self[method_name], hook))
end
local function before(method, hook)
	if method then
		return function(self, ...)
			hook(self, ...)
			return method(self, ...)
		end
	else
		return hook
	end
end
function glue.before(self, method_name, hook)
	install(self, before, method_name, hook)
end
local function after(method, hook)
	if method then
		return function(self, ...)
			method(self, ...)
			return hook(self, ...)
		end
	else
		return hook
	end
end
function glue.after(self, method_name, hook)
	install(self, after, method_name, hook)
end
local function override(method, hook)
	local method = method or glue.noop
	return function(...)
		return hook(method, ...)
	end
end
function glue.override(self, method_name, hook)
	install(self, override, method_name, hook)
end

--Return a metatable that supports virtual properties with getters and setters.
--Can be used with setmetatable() and ffi.metatype(). `super` allows keeping
--the functionality of __index while __index is being used for getters.
function glue.gettersandsetters(getters, setters, super)
	local get = getters and function(t, k)
		local get = getters[k]
		if get then return get(t) end
		return super and super[k]
	end
	local set = setters and function(t, k, v)
		local set = setters[k]
		if set then set(t, v); return end
		rawset(t, k, v)
	end
	return {__index = get, __newindex = set}
end

--os -------------------------------------------------------------------------

glue.win = package.config:sub(1,1) == '\\'

--i/o ------------------------------------------------------------------------

--check if a file exists and can be opened for reading or writing.
--TIP: use fs.is(name) instead if available.
function glue.canopen(name, mode)
	local f = io.open(name, mode or (glue.win and 'rb' or 'r'))
	if f then f:close() end
	return f ~= nil and name or nil
end

--read a file into a string (in binary mode by default).
--TIP: use fs.load(file) instead if available.
function glue.readfile(name, mode, open)
	open = open or io.open
	local f, err = open(name, mode=='t' and 'r' or (glue.win and 'rb' or 'r'))
	if not f then return nil, err end
	local s, err = f:read'*a'
	if s == nil then
		f:close()
		return nil, err
	end
	f:close()
	return s
end

--read the output of a command into a string.
--TIP: use proc.exec() instead if available.
function glue.readpipe(cmd, mode, open)
	return glue.readfile(cmd, mode, open or io.popen)
end

--[[
Move or rename a file. If `newpath` exists and it's a file, it is replaced by
the old file atomically. The operation can still fail under many circumstances
like if `newpath` is a directory or if the files are in different filesystems
or if `oldpath` is missing or locked, etc. For consistent behavior across OSes,
both paths should be either absolute paths or simple filenames without a path.
TIP: use fs.move() instead if available.
]]
if jit then

	local ffi = require'ffi'

	if ffi.os == 'Windows' then

		ffi.cdef[[
			int MoveFileExA(
				const char *lpExistingFileName,
				const char *lpNewFileName,
				unsigned long dwFlags
			);
			int GetLastError(void);
		]]

		local MOVEFILE_REPLACE_EXISTING = 1
		local MOVEFILE_WRITE_THROUGH    = 8
		local ERROR_FILE_EXISTS         = 80
		local ERROR_ALREADY_EXISTS      = 183

		function glue.replacefile(oldfile, newfile)
			if ffi.C.MoveFileExA(oldfile, newfile, 0) ~= 0 then
				return true
			end
			local err = ffi.C.GetLastError()
			if err == ERROR_FILE_EXISTS or err == ERROR_ALREADY_EXISTS then
				if ffi.C.MoveFileExA(oldfile, newfile,
					bit.bor(MOVEFILE_WRITE_THROUGH, MOVEFILE_REPLACE_EXISTING)) ~= 0
				then
					return true
				end
				err = ffi.C.GetLastError()
			end
			return nil, 'WinAPI error '..err
		end

	else

		function glue.replacefile(oldfile, newfile)
			return os.rename(oldfile, newfile)
		end

	end

end

--write a string, number, array of strings or function results to a file.
--uses binary mode by default. atomic by default by writing to a temp file.
--`format` can be 't' (text mode - Windows) or 'a' or 'at' for appending.
--TIP: use fs.save() instead if available.
function glue.writefile(filename, s, mode, tmpfile)
	local append = mode == 'a' or mode == 'at'
	if tmpfile == nil and not append then
		tmpfile = true --enabled by default.
	end
	if tmpfile then
		if tmpfile == true then
			tmpfile = filename..'.tmp'
		end
		local ok, err = glue.writefile(tmpfile, s, mode, false)
		if not ok then
			return nil, err
		end
		local ok, err = glue.replacefile(tmpfile, filename)
		if not ok then
			os.remove(tmpfile)
			return nil, err
		else
			return true
		end
	end
	local m = append and (mode=='at' and 'a' or 'ab') or (mode=='t' and 'w' or 'wb')
	local f, err = io.open(filename, m)
	if not f then
		return nil, err
	end
	local ok, err = true
	if type(s) == 'table' then
		for i = 1, #s do
			ok, err = f:write(s[i])
			if not ok then break end
		end
	elseif type(s) == 'function' then
		local read = s
		while true do
			ok, err = xpcall(read, debug.traceback)
			if not ok or err == nil then break end
			ok, err = f:write(err)
			if not ok then break end
		end
	else --string or number
		ok, err = f:write(s)
	end
	f:close()
	if not ok then
		if not append then
			os.remove(filename)
		end
		return nil, err
	else
		return true
	end
end

--virtualize the print function, eg. glue.printer(io.write, tostring)
--gets you standard print().
function glue.printer(out, format)
	format = format or tostring
	return function(...)
		local n = select('#', ...)
		for i=1,n do
			out(format((select(i, ...))))
			if i < n then
				out'\t'
			end
		end
		out'\n'
	end
end

--dates & timestamps ---------------------------------------------------------

--compute timestamp diff. to UTC because os.time() has no option for UTC.
function glue.utc_diff(t)
   local ld = os.date('*t', t)
	ld.isdst = false --adjust for DST.
	local ud = os.date('!*t', t)
	local lt = os.time(ld)
	local ut = os.time(ud)
	return lt and ut and os.difftime(lt, ut)
end

--[[
Like os.time() but considers the arguments to be in UTC if either `utc` or `t.utc` is `true`.

You should only use os.date() and os.time() and therefore glue.time() for
current dates and use something else for historical dates because these
functions don't work with negative timestamps. They're Y2038-safe though.

os.time() only has second accuracy. For sub-second accuracy use the time module.
]]
function glue.time(utc, y, m, d, h, M, s, isdst)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, y, m, d, h, M, s, isdst = nil, utc, y, m, d, h, M, s
	end
	if type(y) == 'table' then
		local t = y
		if utc == nil then utc = t.utc end
		y, m, d, h, M, s, isdst = t.year, t.month, t.day, t.hour, t.min, t.sec, t.isdst
	end
	local t
	if not y then
		t = os.time()
	else
		s = s or 0
		t = os.time{year = y, month = m or 1, day = d or 1, hour = h or 0,
			min = M or 0, sec = s, isdst = isdst}
		if not t then return nil end
		t = t + s - floor(s)
	end
	local d = not utc and 0 or glue.utc_diff(t)
	if not d then return nil end
	return t + d
end

--get the time at last sunday before a given time, plus/minus a number of weeks.
function glue.sunday(utc, t, offset)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, t, offset = false, utc, t
	end
	local d = os.date(utc and '!*t' or '*t', t)
	return glue.time(false, d.year, d.month, d.day - (d.wday - 1) + (offset or 0) * 7)
end

--get the time at the start of the day of a given time, plus/minus a number of days.
function glue.day(utc, t, offset)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, t, offset = false, utc, t
	end
	local d = os.date(utc and '!*t' or '*t', t)
	return glue.time(false, d.year, d.month, d.day + (offset or 0))
end

--get the time at the start of the month of a given time, plus/minus a number of months.
function glue.month(utc, t, offset)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, t, offset = false, utc, t
	end
	local d = os.date(utc and '!*t' or '*t', t)
	return glue.time(false, d.year, d.month + (offset or 0))
end

--get the time at the start of the year of a given time, plus/minus a number of years.
function glue.year(utc, t, offset)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, t, offset = false, utc, t
	end
	local d = os.date(utc and '!*t' or '*t', t)
	return glue.time(false, d.year + (offset or 0))
end

local function rel_time(s)
	if s > 2 * 365 * 24 * 3600 then
		return ('%d years'):format(floor(s / (365 * 24 * 3600)))
	elseif s > 2 * 30.5 * 24 * 3600 then
		return ('%d months'):format(floor(s / (30.5 * 24 * 3600)))
	elseif s > 1.5 * 24 * 3600 then
		return ('%d days'):format(floor(s / (24 * 3600)))
	elseif s > 2 * 3600 then
		return ('%d hours'):format(floor(s / 3600))
	elseif s > 2 * 60 then
		return ('%d minutes'):format(floor(s / 60))
	elseif s > 60 then
		return '1 minute'
	else
		return 'seconds'
	end
end

--format relative time, eg. `3 hours ago` or `in 2 weeks`.
function glue.timeago(utc, time, from_time)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, time, from_time = false, utc, time
	end
	local s = os.difftime(from_time or glue.time(utc), time)
	return string.format(s > 0 and '%s ago' or 'in %s', rel_time(math.abs(s)))
end

local wso = { -- fri=1, sat=2, sun=3
	MV=1,
	AE=2,AF=2,BH=2,DJ=2,DZ=2,EG=2,IQ=2,IR=2,JO=2,KW=2,LY=2,OM=2,QA=2,SD=2,SY=2,
	AG=3,AS=3,AU=3,BD=3,BR=3,BS=3,BT=3,BW=3,BZ=3,CA=3,CN=3,CO=3,DM=3,DO=3,ET=3,
	GT=3,GU=3,HK=3,HN=3,ID=3,IL=3,IN=3,JM=3,JP=3,KE=3,KH=3,KR=3,LA=3,MH=3,MM=3,
	MO=3,MT=3,MX=3,MZ=3,NI=3,NP=3,PA=3,PE=3,PH=3,PK=3,PR=3,PT=3,PY=3,SA=3,SG=3,
	SV=3,TH=3,TT=3,TW=3,UM=3,US=3,VE=3,VI=3,WS=3,YE=3,ZA=3,ZW=3,
}
function glue.week_start_offset(country) --sun=0, mon=1, sat=-1, fri=-2
	return (wso[country] or 4) - 3
end

--size formatting ------------------------------------------------------------

local suffixes = {[0] = 'b', 'k', 'M', 'G', 'T', 'P', 'E'}
function glue.kbytes(x, decimals)
	local base = ln(x) / ln(1024)
	local suffix = suffixes[floor(base)] or ''
	local fmt = decimals and decimals ~= 0 and '%.'..decimals..'f%s' or '%.0f%s'
	return (fmt):format(1024^(base - floor(base)), suffix)
end

--2D boxes -------------------------------------------------------------------

function glue.fitbox(w, h, bw, bh)
	if w / h > bw / bh then
		return bw, bw * h / w
	else
		return bh * w / h, bh
	end
end

--error handling -------------------------------------------------------------

--like standard assert() but with error message formatting via string.format()
--and doesn't allocate memory until the assertion fails.
--NOTE: unlike standard assert(), this only returns the first argument
--to avoid returning the error message and it's args along with it so don't
--use it with functions returning multiple values if you want those values.
function glue.assert(v, err, ...)
	if v then return v end
	err = err or 'assertion failed!'
	if select('#',...) > 0 then
		err = string.format(err, ...)
	end
	error(err, 2)
end

--pcall with traceback, which is lost with standard pcall. LuaJIT and Lua 5.2 only.
--TIP: use errors.pcall() instead if available.
local function pcall_error(e)
	return debug.traceback('\n'..tostring(e), 2)
end
function glue.pcall(f, ...)
	return xpcall(f, pcall_error, ...)
end

local function unprotect(ok, result, ...)
	if not ok then return nil, result, ... end
	if result == nil then result = true end --to distinguish from error.
	return result, ...
end

--wrap a function that raises errors on failure into a function that follows
--the Lua convention of returning nil,err on failure.
function glue.protect(func)
	return function(...)
		return unprotect(pcall(func, ...))
	end
end

--[[
Pcall with finally and except "clauses":

	local ret,err = fpcall(function(finally, onerror, ...)
		local foo = getfoo()
		finally(function() foo:free() end)
		onerror(function(err) io.stderr:write(err, '\n') end)
	end, ...)

NOTE: a bit bloated at 2 tables and 4 closures. Can we reduce the overhead?
NOTE: LuaJIT and Lua 5.2 only from using a xpcall message handler.
]]
local function fpcall(f,...)
	local fint, errt = {}, {}
	local function finally(f) fint[#fint+1] = f end
	local function onerror(f) errt[#errt+1] = f end
	local function err(e)
		for i=#errt,1,-1 do errt[i](e) end
		for i=#fint,1,-1 do fint[i]() end
		return tostring(e) .. '\n' .. debug.traceback()
	end
	local function pass(ok,...)
		if ok then
			for i=#fint,1,-1 do fint[i]() end
		end
		return ok,...
	end
	return pass(xpcall(f, err, finally, onerror, ...))
end

function glue.fpcall(...)
	return unprotect(fpcall(...))
end

--fcall is like fpcall() but without the protection (i.e. raises errors).
local function assert_fpcall(ok, ...)
	if not ok then error(..., 2) end
	return ...
end
function glue.fcall(...)
	return assert_fpcall(fpcall(...))
end

--modules --------------------------------------------------------------------

--[[
Create a module with a public and private namespace and set the environment
of the calling function (not the global one!) to the module's private
namespace and return the namespaces. Cross-references between the namespaces
are also created at M._P, P._M, P._P and M._M, so both _P and _M can be
accessed directly from the new environment.

`parent` controls what the namespaces will inherit and it can be either
another module, in which case M inherits parent and P inherits parent._P,
or it can be a string in which case the module to inherit is first required.
`parent` defaults to _M so that calling glue.module() creates a submodule
of the current module. If there's no _M in the current environment then P
inherits _G and M inherits nothing.

Specifying a name for the module either returns package.loaded[name] if it is
set or creates a module, sets package.loaded[name] to it and returns that.
This is useful for creating and referencing shared namespaces without having
to make a Lua file and require that.

Naming the module also sets P[name] = M so that public symbols can be
declared in foo.bar style instead of _M.bar.

Setting foo.module = glue.module makes module foo directly extensible
by calling foo:module'bar' or require'foo':module'bar'.

All this functionality is packed into just 27 LOC, less than it takes to
explain it, so read the code to get to another level of clarity.
]]
function glue.module(name, parent)
	if type(name) ~= 'string' then
		name, parent = parent, name
	end
	if type(parent) == 'string' then
		parent = require(parent)
	end
	parent = parent or _M
	local parent_P = parent and assert(parent._P, 'parent module has no _P') or _G
	local M = package.loaded[name]
	if M then
		return M, M._P
	end
	local P = {__index = parent_P}
	M = {__index = parent, _P = P}
	P._M = M
	M._M = M
	P._P = P
	setmetatable(P, P)
	setmetatable(M, M)
	if name then
		package.loaded[name] = M
		P[name] = M
	end
	setfenv(2, P)
	return M, P
end

--[[
Setup a module to load sub-modules when accessing specific keys.

Assign a metatable to `t` (or override an existing metatable's `__index`) such
that when a missing key is accessed, the module said to contain that key is
require'd automatically.

The `submodules` argument is table of form `{key = module_name | load_function}`
specifying the corresponding Lua module (or load function) that make each key
available to `t`. The alternative syntax allows specifying the key - submodule
associations one by one.

# Motivation

Module autoloading allows splitting the implementation of a module in many
submodules containing optional, self-contained functionality, without having
to make this visible in the user API. This effectively disconnects how an API
is modularized from how its implementation is modularized, allowing the
implementation to be refactored at a later time without changing the API.

#### Example

**main module (foo.lua):**

```lua
local function bar() --function implemented in the main module
  ...
end

--create and return the module table
return glue.autoload({
   ...
   bar = bar,
}, {
   baz = 'foo_extra', --autoloaded function, implemented in module foo_extra
})
```

**submodule (foo_extra.lua):**

```lua
local foo = require'foo'

function foo.baz(...)
  ...
end
```

**in usage:**

```lua
local foo = require'foo'

foo.baz(...) -- foo_extra was now loaded automatically
```
]]
function glue.autoload(t, k, v)
	local mt = getmetatable(t) or {}
	if not mt.__autoload then
		local old_index = mt.__index
	 	local submodules = {}
		mt.__autoload = submodules
		mt.__index = function(t, k)
			--overriding __index...
			if type(old_index) == 'function' then
				local v = old_index(t, k)
				if v ~= nil then return v end
			elseif type(old_index) == 'table' then
				local v = old_index[k]
				if v ~= nil then return v end
			end
			if submodules[k] then
				local mod
				if type(submodules[k]) == 'string' then
					mod = require(submodules[k]) --module
				else
					mod = submodules[k](k) --custom loader
				end
				submodules[k] = nil --prevent loading twice
				if type(mod) == 'table' then --submodule returned its module table
					assert(mod[k] ~= nil) --submodule has our symbol
					t[k] = mod[k]
				end
				return rawget(t, k)
			end
		end
		setmetatable(t, mt)
	end
	if type(k) == 'table' then
		glue.update(mt.__autoload, k) --multiple key -> module associations.
	else
		mt.__autoload[k] = v --single key -> module association.
	end
	return t
end

--portable way to get script's directory, based on arg[0].
--NOTE: the path is not absolute, but relative to the current directory!
--NOTE: for bundled executables, this returns the executable's directory.
local arg0 = rawget(_G, 'arg') and arg[0]
local dir = arg0 and arg0:gsub('[/\\]?[^/\\]+$', '') or '' --remove file name
glue.bin = dir == '' and '.' or dir

--portable way to get script's name without Lua file extension, based on arg[0].
--NOTE: for bundled executables, this returns the executable's name.
glue.scriptname = arg0
	and (glue.win and arg0:gsub('%.exe$', '') or arg0)
		:gsub('%.lua$', ''):match'[^/\\]+$'

--portable way to add more paths to package.path, at any place in the list.
--negative indices count from the end of the list like string.sub().
--index 'after' means 0. `ext` specifies the file extension to use.
function glue.luapath(path, index, ext)
	ext = ext or 'lua'
	index = index or 1
	local psep = package.config:sub(1,1) --'/'
	local tsep = package.config:sub(3,3) --';'
	local wild = package.config:sub(5,5) --'?'
	local paths = glue.collect(glue.gsplit(package.path, tsep, nil, true))
	path = path:gsub('[/\\]', psep) --normalize slashes
	if index == 'after' then index = 0 end
	if index < 1 then index = #paths + 1 + index end
	table.insert(paths, index,  path .. psep .. wild .. psep .. 'init.' .. ext)
	table.insert(paths, index,  path .. psep .. wild .. '.' .. ext)
	package.path = concat(paths, tsep)
end

--portable way to add more paths to package.cpath, at any place in the list.
--negative indices count from the end of the list like string.sub().
--index 'after' means 0.
function glue.cpath(path, index)
	index = index or 1
	local psep = package.config:sub(1,1) --'/'
	local tsep = package.config:sub(3,3) --';'
	local wild = package.config:sub(5,5) --'?'
	local ext = package.cpath:match('%.([%a]+)%'..tsep..'?') --dll | so | dylib
	local paths = glue.collect(glue.gsplit(package.cpath, tsep, nil, true))
	path = path:gsub('[/\\]', psep) --normalize slashes
	if index == 'after' then index = 0 end
	if index < 1 then index = #paths + 1 + index end
	table.insert(paths, index,  path .. psep .. wild .. '.' .. ext)
	package.cpath = concat(paths, tsep)
end

--allocation -----------------------------------------------------------------

--freelist for Lua tables. Returns alloc() -> e and free(e) functions.
--alloc() returns the last freed object if any or calls create().
local function create_table()
	return {}
end
function glue.freelist(create, destroy)
	create = create or create_table
	destroy = destroy or glue.noop
	local t = {} --{freed_index -> e}
	local n = 0
	local function alloc()
		local e = t[n]
		if e then
			t[n] = false
			n = n - 1
		end
		return e or create()
	end
	local function free(e)
		destroy(e)
		n = n + 1
		t[n] = e
	end
	return alloc, free
end

--ffi ------------------------------------------------------------------------

if jit then

local ffi = require'ffi'

glue.i8p = ffi.typeof'int8_t*'
glue.i8a = ffi.typeof'int8_t[?]'
glue.u8p = ffi.typeof'uint8_t*'
glue.u8a = ffi.typeof'uint8_t[?]'

glue.i16p = ffi.typeof'int16_t*'
glue.i16a = ffi.typeof'int16_t[?]'
glue.u16p = ffi.typeof'uint16_t*'
glue.u16a = ffi.typeof'uint16_t[?]'

glue.i32p = ffi.typeof'int32_t*'
glue.i32a = ffi.typeof'int32_t[?]'
glue.u32p = ffi.typeof'uint32_t*'
glue.u32a = ffi.typeof'uint32_t[?]'

glue.i64p = ffi.typeof'int64_t*'
glue.i64a = ffi.typeof'int64_t[?]'
glue.u64p = ffi.typeof'uint64_t*'
glue.u64a = ffi.typeof'uint64_t[?]'

glue.f32p = ffi.typeof'float*'
glue.f32a = ffi.typeof'float[?]'
glue.f64p = ffi.typeof'double*'
glue.f64a = ffi.typeof'double[?]'

ffi.cdef[[
void* malloc  (size_t size);
void* realloc (void* ptr, size_t size);
void  free    (void* ptr);
]]

local function ptr(p) return p ~= nil and p or nil end
function glue.malloc(size) return ptr(ffi.C.malloc(size)) end
function glue.realloc(p, size) return ptr(ffi.C.realloc(p, size)) end
glue.free = ffi.C.free

--[[
auto-growing buffer allocation pattern.
- ctype must be a VLA: the returned buffer will have that type.
- the buffer only grows in powers-of-two steps.
- alloc() returns the buffer's current capacity which can be equal or
  greater than the requested length.
- the returned buffer is pinned by the allocation function. call alloc(false)
  to unpin the buffer.
- the contents of the buffer are not preserved between allocations but you
  are allowed to access both buffers between two consecutive allocations
  in order to copy the contents to the new buffer yourself.
]]
function glue.buffer(ctype)
	local vla = ffi.typeof(ctype or glue.u8a)
	local buf, len = nil, -1
	return function(minlen)
		if minlen == false then
			buf, len = nil, -1
		elseif minlen > len then
			len = glue.nextpow2(minlen)
			buf = vla(len)
		end
		return buf, len
	end
end

--like glue.buffer() but preserves data on reallocations
--also returns minlen instead of capacity.
function glue.dynarray(ctype, min_capacity)
	ctype = ctype or glue.u8a
	local buffer = glue.buffer(ctype)
	local elem_size = ffi.sizeof(ctype, 1)
	local buf0, minlen0
	return function(minlen)
		local buf, len = buffer(max(min_capacity or 0, minlen))
		if buf ~= buf0 and buf ~= nil and buf0 ~= nil then
			ffi.copy(buf, buf0, minlen0 * elem_size)
		end
		buf0, minlen0 = buf, minlen
		return buf, minlen
	end
end

local intptr_ct = ffi.typeof'intptr_t'
local intptrptr_ct = ffi.typeof'const intptr_t*'
local intptr1_ct = ffi.typeof'intptr_t[1]'
local voidptr_ct = ffi.typeof'void*'

--convert a pointer's address to a Lua number or possibly string.
--use case: hashing on pointer values (i.e. using pointers as table keys)
--use case: moving pointers in and out of Lua states when using luastate.lua.
function glue.addr(p)
	local np = ffi.cast(intptr_ct, ffi.cast(voidptr_ct, p))
   local n = tonumber(np)
	if ffi.cast(intptr_ct, n) ~= np then
		--address too big (ASLR? tagged pointers?): convert to string.
		return ffi.string(intptr1_ct(np), 8)
	end
	return n
end

--convert a number or string to a pointer, optionally specifying a ctype.
function glue.ptr(ctype, addr)
	if not addr then
		ctype, addr = voidptr_ct, ctype
	end
	if type(addr) == 'string' then
		return ffi.cast(ctype, ffi.cast(voidptr_ct,
			ffi.cast(intptrptr_ct, addr)[0]))
	else
		return ffi.cast(ctype, addr)
	end
end

end --if jit

if bit then

local band, bor, bnot = bit.band, bit.bor, bit.bnot

--extract the bool value of a bitmask from a value.
function glue.getbit(from, mask)
	return band(from, mask) == mask
end

--set a single bit of a value without affecting other bits.
function glue.setbit(over, mask, yes)
	return bor(yes and mask or 0, band(over, bnot(mask)))
end

--bit.bor() that takes its arguments as a string of form 'opt1 opt2 ...',
--a list of form {'opt1', 'opt2', ...} or a map of form {opt->true}, and
--performs bit.bor() on the numeric values of those arguments where the
--numeric values are given as the `bits` table in form {opt->bitvalue}.
--Useful for Luaizing C functions that take bitmask flags.
--Example: glue.bor('a c', {a=1, b=2, c=4}) -> 5
local function bor_bit(bits, k, mask, strict)
	local b = bits[k]
	if b then
		return bit.bor(mask, b)
	elseif strict then
		error(string.format('invalid bit %s', k))
	else
		return mask
	end
end
function glue.bor(flags, bits, strict)
	local mask = 0
	if type(flags) == 'number' then
		return flags --passthrough
	elseif type(flags) == 'string' then
		for k in flags:gmatch'[^%s]+' do
			mask = bor_bit(bits, k, mask, strict)
		end
	elseif type(flags) == 'table' then
		for k,v in pairs(flags) do
			k = type(k) == 'number' and v or k
			mask = bor_bit(bits, k, mask, strict)
		end
	else
		error'flags expected'
	end
	return mask
end

end --if bit

--buffered I/O ---------------------------------------------------------------

if jit then

local ffi = require'ffi'

--make a write(buf, sz) that appends data to a dynarray accumulator.
function glue.dynarray_pump(dynarr)
	dynarr = dynarr or glue.dynarray()
	local i = 0
	local function write(src, len)
		local dst = dynarr(i + len)
		ffi.copy(dst + i, src, len or #src)
		i = i + len
		return len
	end
	local function collect()
		return dynarr(i)
	end
	return write, collect
end

--unlike a pump which copies the user's buffer, a loader provides a buffer
--for the user to fill up and mark (a portion of it) as filled.
function glue.dynarray_loader(dynarr)
	dynarr = dynarr or glue.dynarray()
	local i = 0
	local function get(sz)
		return dynarr(i + sz) + i, sz
	end
	local function put(len)
		i = i + len
	end
	local function collect()
		return dynarr(i)
	end
	return get, put, collect
end

--load up a dynarray with repeated reads given a read(self, buf, sz, expires) method.
function glue.readall(read, self, ...)
	local get, put, collect = glue.dynarray_loader()
	while true do
		local buf, sz = get(16 * 1024)
		local len, err = read(self, buf, sz, ...)
		if not len then return nil, err, collect() end --short read
		if len == 0 then return collect() end --eof
		put(len)
	end
end

--return a read(buf, sz) -> readsz function that consumes data from the
--supplied buffer. The supplied buf,sz can also be nil,err in which case
--the read function will always return just that. The buffer must be a
--(u)int8_t pointer or VLA.
function glue.buffer_reader(p, n)
	return function(buf, sz)
		if p == nil then return p, n end
		sz = math.min(n, sz)
		if sz == 0 then return nil, 'eof' end
		ffi.copy(buf, p, sz)
		p = p + sz
		n = n - sz
		return sz
	end
end

end --if jit

return glue
