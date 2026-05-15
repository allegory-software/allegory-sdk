--[=[

	Lua "assorted lengths of wire" library.
	Written by Cosmin Apreutesei. Public domain.

TYPES MATH VARARGS ARRAYS TABLES CACHING STRINGS STDOUT/ERR
ITERATORS CALLBACKS OBJECTS PROCESS-CONTROL TIME DATES ERRORS MODULES
EVAL BITS FFI ALLOCATION BUFFERS CONFIG DEBUGGING LOGGING SERIALIZATION

TYPES
	typeof                       = type
	isstr(v)                       is v a string
	isnum(v)                       is v a number
	isint(v)                       is v an integer (includes 1/0 and -1/0)
	istab(v)                       is v a table
	isbool(v)                      is v a boolean
	isempty(v)                     is v a table and is it empty
	isfunc(v)                      is v a function
	iscdata(v)                     is v a cdata
	iscoro(v)                      is v a Lua coroutine
	isctype(ct, v)               = ffi.istype
	inherits(v, class)             is v an object that inherits from class
MATH
	floor                        = math.floor
	ceil                         = math.ceil
	round(x) -> y                  math.floor(x + 0.5)
	snap(x[, p]) -> y              round x to nearest multiple of p=1 half-up
	min                          = math.min
	max                          = math.max
	clamp(x, min, max) -> y        clamp x in range
	abs                          = math.abs
	sign(x) -> 1|0|-1              sign
	strict_sign(x) -> 1|-1         strict sign
	sqrt                         = math.sqrt
	ln                           = math.log
	log10                        = math.log10
	log2                         = math.log(x, 2)
	logbase(x, base) -> y          log in given base
	sin                          = math.sin
	cos                          = math.cos
	tan                          = math.tan
	rad                          = math.rad
	deg                          = math.deg
	PI                           = math.pi
	random                       = math.random
	randomseed                   = math.randomseed
	random_string(n) -> s          generate random string of length n
	secure_random_string(n) -> s   generate CSPRNG of length n
	uuid() -> s                    generate random UUID v4
	lerp(x, x0, x1, y0, y1) -> y   project x in x0..x1 over y0..y1
	nextpow2(x) -> y               next power-of-2 number
	repl(x, v, r) -> x             replace v with r in x
VARARGS
	pack(...) -> t                 pack varargs, setting t.n to arg num
	unpack(t, [i], [j]) -> ...     unpack varargs, using t.n if any
ARRAYS
	insert                       = table.insert
	remove                       = table.remove
	del                          = table.remove
	add(t, v)                      insert(t, v)
	push(t, v)                     insert(t, v)
	pop(t) -> v                    remove(t)
	clear                        = table.clear
	sort(t, [cmp]) -> t          = table.sort but returns the table
	extend(dt, t1, ...) -> dt      extend an array with contents of other arrays
	append(dt, v1, ...) -> dt      append non-nil values to an array
	popn(dt, n) -> v1, ...         remove n values from the end and return them
	remove_value(t, v) -> i|nil    find and remove value from array
	shift(t, i, n) -> t            shift array elements
	slice(t, [i], [j]) -> t        slice an array
	imap(t, field|f,...) -> t      map f over ipairs of t or pluck field
	indexof(v, t, [eq], [i], [j]) -> i   scan array for value
	cmp'KEY1[>] ...' -> f          create a cmp function for sort and binsearch
	binsearch(v, t, [cmp], [i], [j]) -> i    bin search in sorted array
	binsearch_insert(t, v, [cmp]) -> t       order-preserving insert in sorted array
	sortedarray([sa]) -> sa        stay-sorted array with fast search
	  sa:find(v) -> i|nil          find value in O(logN)
	  sa:add(v)                    add value in O(N+logN)
	  sa:remove(v) -> v|nil        remove value in O(N+logN)
	  sa.cmp                       cmp function for binsearch
	reverse(t, [i], [j]) -> t      reverse array in place
	last(t) -> v                   t[#t]
TABLES
	empty                          shared empty r/o table
	count(t[, maxn]) -> n          count keys in table up to maxn=1/0
	index(t) -> dt                 switch keys with values
	keys(t,[cmp]) -> dt            make a list with keys of t
	sortedkeys(t,[cmp]) -> dt      make a sorted list of keys of t
	sortedpairs(t,[cmp]) => k, v   like pairs() but in key order
	update(dt, t1, ...) -> dt      merge tables - overwrites keys
	merge(dt, t1, ...) -> dt       merge tables - no overwriting
	map(t, field|f,...) -> t       map f over pairs of t or pluck field
	attr(t, k, [f, ...]) -> v      autofield pattern for one key
	attrs(t, N, [f], k1,...) -> v  autofield pattern for a chain of keys
	attrs_find(t, k1,...) -> v     return t[k1][k2]... as found
	attrs_clear(t, k1,...)         remove value at the end of key chain
CACHING
	memoize[_multiret](f,opt...) -> mf,cache   memoize pattern
	tuples(opt...) -> tuple(...) -> t          create a tuple space
	istuple(t)                     is t a tuple
	CLEAR                          poison value to clear cache on memoized func
STRINGS
	format                       = string.format
	fmt                          = string.format
	_                            = string.format
	concat                       = table.concat
	cat                          = concat
	catany(sep, ...) -> s          concat non-nil args
	catall(...) -> s               concat args; return nil if any arg is nil
	rep                          = string.rep
	char                         = string.char
	byte                         = string.byte
	num                          = tonumber
	gsub                         = string.gsub
	split(s,sep[,start[,plain]]) => e[,captures...]  split a string on regex
	words'name1 ... ' => 'name1'   iterate words in a string
	lines(s, [opt], [i]) => s, i, j, k      iterate the lines of a string
	outdent(s, [newindent]) -> s, indent       outdent/reindent text
	lineinfo(s, [i]) -> line, col  find text position at byte position
	trim(s) -> s                   remove whitespace paddings
	lpad(s, n, [c]) -> s           left-pad string
	rpad(s, n, [c]) -> s           right-pad string
	pad(s, n, [c], dir) -> s       pad string left or right
	esc(s [,mode]) -> pat          escape string to use in regex
	[to]hex(s|n [,upper]) -> s     string or number to hex
	fromhex(s) -> s                hex to string
	hexblock(s)                    string to hex block
	starts(s, prefix) -> t|f       find if string starts with prefix
	ends(s, suffix) -> t|f         find if string ends with suffix
	s:has(substring[, i]) -> t|f   s:find(i, true)
	subst(s, t) -> s               string interpolation pattern
	capitalize(s) -> s             capitalize words
	html_escape(s) -> s            escape HTML string
	kbytes(x [,decimals]) -> s     format byte size in k/M/G/T-bytes
STDOUT/ERR
	print_function(write, [format], [newline]) -> f  create a print()-like function
	printf(fmt, ...)               print with string formatting
	say([fmt, ...])                print to stderr
	sayn([fmt, ...])               print to stderr without newline
	die([fmt, ...])                exit with abort message and exit code 1
ITERATORS
	collect([i,] iter) -> t        collect iterated values into an array
CALLBACKS
	pass(...) -> ...               does nothing, returns back all arguments
	noop(...)                      does nothing, returns nothing
	call(f, ...)                   calls f if f is a func, otherwise returns args
	do_before(f, do_f) -> f        wrap f so as to call do_f first
	do_after(f, do_f) -> f         wrap f so as to call do_f last
	CANCEL                         generic "cancel" command to pass to callbacks
OBJECTS
	object([super], [t], ...) -> t    create a class or object
	before(class, method_name, f)     call f at the beginning of a method
	after(class, method_name, f)      call f at the end of a method
	override(class, method_name, f)   override a method
	gettersandsetters([gets], [sets], [super]) -> mt    add virtual properties
PLATFORM
	Windows                        true if platform is Windows
	Linux                          true if platform is Linux
	OSX                            true if platform is OSX
PROCESS
	sleep(s)                       suspend process i.e. blocking sleep
	exit                         = os.exit
	getpid() -> pid                get current process PID
TIME & DATES
	now() -> ts                    os.time() but more accurate
	clock() -> x                   os.clock() but more accurate
	time([utc, ][t]) -> ts         os.time() but more accurate and with utc option
	time([utc, ][y], [m], [d], [H], [M], [S], [isdst]) -> ts  with positional args
	date                         = os.date
	utc_diff(t) -> seconds                     seconds from local time t to UTC
	sunday ([utc, ]t, [weeks]) -> ts           time at last Sunday before t
	day    ([utc, ][t], [plus_days]) -> ts     time at day's beginning from t
	month  ([utc, ][t], [plus_months]) -> ts   time at month's beginning from t
	year   ([utc, ][t], [plus_years]) -> ts    time at year's beginning from t
ERRORS
	assertf(v[, fmt,...]) -> v     assert with error message formatting
	fpcall(f, ...) -> ok, ...      pcall with finally/onerror
	fcall(f, ...) -> ...           same but re-raises errors
	die(fmt,...)                   exit with code 1 and message
	must(...) -> ...               die with traceback if not arg#1
STRUCTURED EXCEPTIONS
	see errors.lua
	see errors_io.lua
MODULES
	require'glue'.with'module1 ...'  require syntax sugar
	module([name, ][parent]) -> M  create a module
	autoload(t, submodules) -> M   autoload table keys from submodules
	autoload(t, key, module|loader) -> t       autoload table key from module
	rel_scriptdir                  get the script's directory
	scriptname                     get the script's name
	sopath(path)                   add a search path for ffi.load()
EVAL
	[try_]eval(s) -> ...         = loadstring('return '..s)
BITS
	bit                          = require'bit'
	bnot                         = bit.bnot
	shl                          = bit.lshift
	shr                          = bit.rshift
	band                         = bit.band
	bor                          = bit.bor
	xor                          = bit.bxor
	bxor                         = bit.bxor
	getbit(x, mask) -> bit         get the value of a single bit from x
	setbit(x, mask, bits) -> x     set the value of a single bit on x
	setbits(x, mask, bits) -> x    set the value of multiple bits over x
	bitflags(flags, masks, [x], [strict]) -> mask    bor() flags over x
FFI
	ffi                          = require'ffi'
	C                            = ffi.C
	cdef                         = ffi.cdef
	new                          = ffi.new
	cast                         = ffi.cast
	sizeof                       = ffi.sizeof
	offsetof                     = ffi.offsetof
	ctype                        = ffi.typeof
	copy                         = ffi.copy
	fill                         = ffi.fill
	gc                           = ffi.gc
	metatype                     = ffi.metatype
	isctype                      = ffi.istype
	errno                        = ffi.errno
	try_errno(v[, err]) -> v | nil, err
	check_errno(v[, err]) -> v
	str(buf, len)                = ffi.string(buf, len) if buf is not null
	strlen(buf[, maxlen]) -> len|nil  = strnlen, stops at 64k by default
	ptr(p)                       = p ~= nil and p  or nil
	ptr_serialize(p) -> n|s             store pointer address in Lua value
	ptr_deserialize([ct,]n|s) -> p      convert address to pointer
	memcmp(p1, p2, sz) -> i        memcmp
ALLOCATION
	freelist([create], [destroy]) -> alloc,free   Lua freelist allocation pattern
	buffer([ct]) -> alloc
		alloc(len) -> buf,len        alloc len and get a buffer
	malloc(size) -> p              C malloc
	realloc(p, size) -> p          C realloc
	free(p)                        C free
BUFFERS
	dynarray([ct][,cap]) -> alloc
		alloc(len) -> buf, len      alloc len and get a buffer, contents preserved
	dynarray_pump() -> write, collect, reset
	  write(s | buf, len)          append to internal buffer
	  collect() -> buf,len         get internal buffer
	  reset()                      start again
	string_buffer() -> b           make a luajit string buffer, see https://luajit.org/ext_buffer.html
CONFIG
	config(k[, default]) -> v      get/set global config value
	with_config(conf, f, ...) -> ...    run f with custom config table
	load_config_file(file)         load config file
	load_config_string(s)          load config from string
DEBUGGING
	traceback                    = debug.traceback
	trace()                        print current stack trace to stderr
	pr(...)                        print to stderr with logargs
LOGGING
	see logging.lua
LANG
	S(id, en_s, ...) -> s          get Lua string in current language

]=]

if not ... then require'glue_test'; return end

ffi = require'ffi'
bit = require'bit'
require'table.clear'
require'strict'
require'time'
require'pp'

local
	type, select, pairs, next, rawget, rawset, assert, error, tostring, setmetatable, getmetatable =
	type, select, pairs, next, rawget, rawset, assert, error, tostring, setmetatable, getmetatable

local format = string.format
local concat = table.concat
local insert = table.insert
local remove = table.remove
local gsub   = string.gsub
local io_stderr = io.stderr
local math_floor = math.floor

local table_sort = table.sort
function sort(t, cmp)
	table_sort(t, cmp)
	return t
end

--types ----------------------------------------------------------------------

typeof   = type
isstr    = function(v) return type(v) == 'string' end
isnum    = function(v) return type(v) == 'number' end
isint    = function(v) return type(v) == 'number' and math_floor(v) == v end
istab    = function(v) return type(v) == 'table'  end
isbool   = function(v) return v == true or v == false end
isempty  = function(v) return next(v) == nil end
isfunc   = function(v) return type(v) == 'function' end
iscdata  = function(v) return type(v) == 'cdata'  end
iscoro   = function(v) return type(v) == 'thread' end

--math -----------------------------------------------------------------------

min    = math.min
max    = math.max
floor  = math.floor
ceil   = math.ceil
abs    = math.abs
sqrt   = math.sqrt
ln     = math.log
log10  = math.log10
log2   = function(x) return math.log(x, 2) end --base arg is Lua5.2/LuaJIT
sin    = math.sin
cos    = math.cos
tan    = math.tan
rad    = math.rad
deg    = math.deg
PI     = math.pi
random = math.random
randomseed = math.randomseed

local
	min, max, floor, ceil, ln, random =
	min, max, floor, ceil, ln, random

--CAVEAT: for negative half-integers like -0.5 it returns 0, so it rounds
--toward +inf, not -1.
function round(x)
	return floor(x + .5)
end

--round a number towards nearest integer or multiple of p.
--rounds half-up (i.e. it returns -1 for -1.5).
--works with numbers up to +/-2^52.
--it's not dead accurate as it returns eg. 1 instead of 0 for
--   0.49999999999999997 (the number right before 0.5) which is < 0.5.
function snap(x, p)
	p = p or 1
	return floor(x / p + .5) * p
end

--clamp a value in range. If max < min, the result is max.
function clamp(x, x0, x1)
	return min(max(x, x0), x1)
end

--linearly project x in x0..x1 range to the y0..y1 range.
function lerp(x, x0, x1, y0, y1)
	return y0 + (x-x0) * ((y1-y0) / (x1 - x0))
end

function logbase(x, base)
	return ln(x) / ln(base)
end

function nextpow2(x)
	return max(0, 2^(ceil(ln(x) / ln(2))))
end

function sign(x)
	return x > 0 and 1 or x == 0 and 0 or -1
end

function strict_sign(x)
	return x >= 0 and 1 or -1
end

function repl(x, v, r)
	if x == v then return r else return x end
end

function uuid() --don't forget to seed the randomizer!
	return format('%08x-%04x-%04x-%04x-%08x%04x',
		random(0xffff) * 0x10000 + random(0xffff), random(0xffff),
		0x4000 + random(0x0fff), --4xxx
		0x8000 + random(0x3fff), --10bb-bbbb-bbbb-bbbb
		random(0xffff) * 0x10000 + random(0xffff), random(0xffff))
end

do
local u32a = ffi.typeof'uint32_t[?]'
local ffi_string = ffi.string
function random_string(n)
	local buf = u32a(n/4+1)
	for i=0,n/4 do
		buf[i] = random(0, 2^31)
	end
	return ffi_string(buf, n)
end
end

--varargs --------------------------------------------------------------------

if table.pack then
	pack = table.pack
else
	function pack(...)
		return {n = select('#', ...), ...}
	end
end

--always use this because table.unpack's default j is #t not t.n.
local lua_unpack = unpack
function unpack(t, i, j)
	return lua_unpack(t, i or 1, j or t.n or #t)
end

--tables ---------------------------------------------------------------------

_G.concat = concat
_G.cat    = concat
_G.insert = insert
_G.remove = remove
_G.del    = remove

function add(t, v)
	insert(t, v)
end
push = add

function pop(t)
	return remove(t)
end

clear = table.clear

--scan list for value. works with ffi arrays too given i and j.
function indexof(v, t, eq, i, j)
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

function remove_value(t, v)
	local i = indexof(v, t)
	if not i then return nil end
	remove(t, i)
	return i
end

--reverse elements of a list in place. works with ffi arrays too given i and j.
function reverse(t, i, j)
	i = i or 1
	j = (j or #t) + 1
	for k = 1, (j-i)/2 do
		t[i+k-1], t[j-k] = t[j-k], t[i+k-1]
	end
	return t
end

function last(t)
	return t[#t]
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
function binsearch(v, t, cmp, lo, hi)
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

function binsearch_insert(t, v, cmp)
	local i = binsearch(v, t, cmp) or #t + 1
	insert(t, i, v)
	return i
end

--array that stays sorted with search in O(logN) and add/remove in O(N+logN).
--if given an array to be wrapped, it must be already sorted.
--sa.cmp is used for cmp in binarysearch().
do
local sa = {}
local insert, remove, binsearch = insert, remove, binsearch
function sa:find(v)
	return binsearch(v, self, self.cmp)
end
function sa:add(v)
	local i = self:find(v) or #self+1
	insert(self, i, v)
	return i
end
function sa:remove(v)
	local i = self:find(v)
	if not i then return nil end
	return remove(self, i)
end
function sortedarray(t)
	return object(sa, t)
end
end

empty = setmetatable({}, {
	__newindex = function() error'trying to set a field in empty' end, --read-only
	__metatable = false,
})

--count the keys in a table with an optional upper limit.
function count(t, maxn)
	local maxn = maxn or 1/0
	local n = 0
	for _ in pairs(t) do
		n = n + 1
		if n >= maxn then break end
	end
	return n
end

--reverse keys with values.
function index(t)
	local dt={}
	for k,v in pairs(t) do dt[v]=k end
	return dt
end

--create a comparison function for sorting objects with sort().
local function cmp_asc  (a, b) return a < b end
local function cmp_desc (a, b) return a > b end
local function cmp_k_asc(k)
	return function(a, b)
		local a, b = a[k], b[k]
		return a < b and -1 or a > b and 1
	end
end
local function cmp_k_desc(k)
	return function(a, b)
		local a, b = a[k], b[k]
		return a > b and -1 or a < b and 1
	end
end
function cmp(keys) --true|false|'KEY1[>] ...'
	if keys == true then
		return cmp_asc
	elseif keys == false then
		return cmp_desc
	elseif type(keys) ~= 'string' then
		return keys
	end
	local f
	for s in keys:gmatch'%S+' do
		local k, desc = s:match'^(.-)([<>])$'
		if k then
			desc = desc == '>'
		else
			k = s
		end
		local f1 = desc and cmp_k_desc(k) or cmp_k_asc(k)
		if not f then
			f = f1
		else
			local f0 = f
			f = function(a, b)
				return f0(a, b) or f1(a, b)
			end
		end
	end
	return function(a, b)
		return f(a, b) == -1
	end
end

--put keys in a list, optionally sorted.
local function desc_cmp(a, b) return a > b end
local glue_cmp = cmp
function keys(t, cmp)
	local dt={}
	for k in pairs(t) do
		dt[#dt+1]=k
	end
	if cmp == true then
		table_sort(dt)
	elseif cmp == false then
		table_sort(dt, desc_cmp)
	elseif type(cmp) == 'string' then
		cmp = glue_cmp(cmp)
		table_sort(dt, function(k1, k2)
			return cmp(t[k1], t[k2])
		end)
	elseif cmp then
		table_sort(dt, cmp)
	end
	return dt
end

local
	repl, keys =
	repl, keys

function sortedkeys(t, cmp)
	return keys(t, repl(cmp, nil, true))
end

--stateless pairs() that iterate elements in key order.
function sortedpairs(t, cmp)
	local kt = keys(t, repl(cmp, nil, true))
	local i, n = 0, #kt
	return function()
		i = i + 1
		if i > n then return end
		return kt[i], t[kt[i]]
	end
end

--update a table with the contents of other table(s) (falsey args skipped).
function update(dt,...)
	for i=1,select('#',...) do
		local t=select(i,...)
		if t then
			for k,v in pairs(t) do dt[k]=v end
		end
	end
	return dt
end

--add the contents of other table(s) without overwrite.
function merge(dt,...)
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

local NIL = {'NIL'}

--`attr(t, k1)[k2] = v` is like `t[k1][k2] = v` with auto-creating `t[k1]`.
function attr(t, k, cons, ...)
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

function attrs(t, n, cons, ...)
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

function attrs_find(t, ...)
	for i = 1, select('#', ...) do
		local k = select(i,...)
		if k == nil then k = NIL end
		local v = t[k]
		if v == nil then return nil end
		t = v
	end
	return t
end

function attrs_clear(t, ...)
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

local attrs, attrs_clear = attrs, attrs_clear

local NOARG = {'NOARG'} --special arg for zero-arg functions or calls.

--with fixarg functions we store the memoized value in the leaf node directly.
local function memoize_fixarg(f, n, cache)
	cache = cache or {}
	if n == 0 then --TODO: optimize this case (attrs uses select(i,...))
		return function()
			return attrs(cache, 1, f, NOARG)
		end, cache
	elseif n == 1 then --TODO: optimize this case (attrs uses select(i,...))
		return function(arg)
			return attrs(cache, 1, f, arg)
		end, cache
	else
		return function(...)
			return attrs(cache, n, f, ...)
		end, cache
	end
end

--with vararg functions we can't just store the memoized value in the
--leaf node because any leaf node can become a key node on future calls.
local VAL = {'VAL'} --special key to store the memoized value in the leaf node.
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

--special value to use as arg#1 on a memoized function to clear the cache
--on a prefix of arguments.
CLEAR = {'CLEAR'}
local CLEAR = CLEAR
local debug_getinfo = debug.getinfo
function memoize(f, cache, minarg, maxarg)
	if not minarg then
		local info = debug_getinfo(f, 'u')
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
		if ... == CLEAR then
			attrs_clear(cache, select(2, ...))
		else
			return mf(...)
		end
	end, cache, minarg, maxarg
end

function memoize_multiret(f, ...)
	local mf = memoize(function(...)
		return pack(f(...))
	end, ...)
	return function(...)
		return unpack(mf(...))
	end
end

--tuples are interned value lists that can be used as table keys to achieve
--multi-key indexing because they have value semantics: a tuple space returns
--the same tuple object for the same combination of values.
do
local tuple_mt = {__call = unpack}
function tuple_mt:__tostring()
	local t = {}
	for i=1,self.n do
		t[i] = tostring(self[i])
	end
	return format('(%s)', concat(t, ', '))
end
function tuples(n, space)
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
function istuple(t)
	return getmetatable(t) == tuple_mt
end
end

cmp_k_asc  = memoize(cmp_k_asc)
cmp_k_desc = memoize(cmp_k_desc)

--extend a list with the elements of other lists (skipping falsey args).
function extend(dt,...)
	for j=1,select('#',...) do
		local t=select(j,...)
		if t then
			local j = dt.n or #dt
			local n = t.n or #t
			for i=1,n do dt[j+i]=t[i] end
			if t.n or dt.n then dt.n = j+n end --adding a sparse array makes dt sparse.
		end
	end
	return dt
end

--append non-nil arguments to a list.
function append(dt,...)
	local j = #dt
	for i=1,select('#',...) do
		local v = select(i,...)
		if v ~= nil then
			j = j + 1
			dt[j] = v
		end
	end
	return dt
end

--insert n elements at i, shifting elements on the right of i (i inclusive)
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

local function _popn(t, n, ...)
	remove_n(t, #t-n+1, n)
	return ...
end
function popn(t, n)
	n = min(n, #t)
	return _popn(t, n, unpack(t, #t-n+1))
end

--shift all the elements on the right of i (i inclusive), n positions to the
--to the left (if n is negative), removing elements, or further to the right
--(if n is positive), making room for new elements.
function shift(t, i, n)
	if n > 0 then
		insert_n(t, i, n)
	elseif n < 0 then
		remove_n(t, i, -n)
	end
	return t
end

local clamp = clamp
function slice(t, i, j) --TODO: not used. use it or scrape it.
	local n = t.n or #t
	i = i or 1
	j = j or n
	if i < 0 then i = n + i + 1 end
	if j < 0 then j = n + j + 1 end
	i = clamp(i, 1, n)
	j = clamp(j, 1, n)
	local dt = {}
	for i=i,j do dt[i] = t[i] end
	return dt
end

--map `f(k, v, ...) -> v1` over t or extract a column from a list of records.
--if f is not a function, then the values of t must be themselves tables,
--in which case f is a key to pluck from those tables. Plucked functions
--are called as methods and their result is selected instead. This allows eg.
--calling a method for each element in a table of objects and collecting
--the results in a table.
function map(t, f, ...)
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
function imap(t, f, ...)
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

--strings --------------------------------------------------------------------

_G.format = format
_G.fmt    = format
_G._      = format
_G.rep    = string.rep
_G.char   = string.char
_G.byte   = string.byte
_G.num    = tonumber
_G.gsub   = string.gsub

--split a string by a separator pattern (or plain string).
--returns a stateless iterator for the pieces.
--if sep is '' returns the entire string in one iteration.
--empty strings between separators are always returned, eg. split(',', ',')
--produces 2 empty strings.
--captures are allowed in sep and they are returned after the element,
--except for the last element for which they don't match (by definition).
local function iterate_once(s, s1)
	return s1 == nil and s or nil
end
function split(s, sep, start, plain)
	start = start or 1
	plain = plain or false
	if not s:find(sep, start, plain) then
		return iterate_once, s:sub(start)
	end
	local done = false
	local function cont(i, j, ...)
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
		return cont(s:find(sep, start, plain))
	end
end
string.split = split

--iterate words in a strings. unlike split(s, '%s+'), it ignores
--any resulting empty elements.
function words(s)
	if type(s) ~= 'string' then return s end
	return s:gmatch'%S+'
end
string.words = words

--[[
 split a string into lines, optionally including the line terminator.
* for each line it returns the line contents, the content-start, content-end
  and the next-content-start indices.
* the lines are split at '\r\n', '\r' and '\n' markers.
* the line ending markers are included or excluded depending on the second
  arg, which can be '*L' (include line endings) or '*l' (exclude; default).
* if the string is empty or doesn't contain a line ending marker, it is
  iterated once.
* if the string ends with a line ending marker, one more empty string is
  iterated.
* init tells it where to start parsing (default is 1).
]]
function lines(lines_s, opt, i)
	opt = opt or '*l'
	local patt = opt == '*L'
		and '()([^\r\n]*()\r?\n?())'
		 or '()([^\r\n]*)()\r?\n?()'
	i = i or 1
	local ended
	return function()
		if ended then return end
		local i0, s, i1, i2 = lines_s:match(patt, i)
		ended = i1 == i2
		i = i2
		return s, i0, i1, i2
	end
end
string.lines = lines

--outdent lines based on the indentation of the first non-empty line.
--bails out if a subsequent line is less indented than the first non-empty line.
--newindent is an optional indentation to prepend to each unindented line.
function outdent(lines_s, newindent)
	newindent = newindent or ''
	local indent
	local t = {}
	for s in lines(lines_s) do
		local indent1 = s:match'^([\t ]*)[^%s]'
		if not indent then
			indent = indent1
		elseif indent1 then
			if indent ~= indent1 then
				if #indent1 > #indent then --more indented
					if not starts(indent1, indent) then
						indent = ''
						break
					end
				elseif #indent > #indent1 then --less indented
					if not starts(indent, indent1) then
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
		return lines_s, indent
	end
	for i=1,#t do
		t[i] = newindent .. t[i]:sub(#indent + 1)
	end
	return concat(t, '\n'), indent
end
string.outdent = outdent

--return the line and column numbers at a specific index in a string.
--if i is not given, returns a function f(i) that is faster on repeat calls.
function lineinfo(s, i)
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
		--TODO: replace this with binsearch().
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
string.lineinfo = lineinfo

--string trim12 from Lua wiki (trims any %s).
function trim(s)
	local from = s:match'^%s*()'
	return from > #s and '' or s:match('.*%S', from)
end
string.trim = trim

--pad string s to length n using char c (which defaults to ' ') on its right
--side (dir = 'r') or left side (dir = 'l').
function pad(s, n, c, dir)
	local pad = (c or ' '):rep(n - #s)
	return dir == 'l' and pad..s or dir == 'r' and s..pad or error'dir arg required'
end
local pad = pad
function lpad(s, n, c) return pad(s, n, c, 'l') end
function rpad(s, n, c) return pad(s, n, c, 'r') end
string.pad = pad
string.lpad = lpad
string.rpad = rpad

--escape a string so that it can be matched literally inside a pattern.
--escape magic characters of string s so that it can be used as a pattern
--that matches s literally in string matching functions.
--the optional arg mode can have the value '*i' (for case insensitive).
local function format_ci_pat(c)
	return format('[%s%s]', c:lower(), c:upper())
end
function esc(s, mode) --escape is a reserved word in Terra
	s = gsub(gsub(gsub(s, '%%','%%%%'), '%z','%%z'), '([%^%$%(%)%.%[%]%*%+%-%?])', '%%%1')
	if mode == '*i' then s = gsub(s, '[%a]', format_ci_pat) end
	return s
end
string.esc = esc

--convert binary string or a Lua number to its hex representation.
--numbers must be in the unsigned 32 bit integer range.
function tohex(s, upper)
	if type(s) == 'number' then
		return format(upper and '%08.8X' or '%08.8x', s)
	end
	if upper then
		return (gsub(s, '.', function(c)
		  return format('%02X', c:byte())
		end))
	else
		return (gsub(s, '.', function(c)
		  return format('%02x', c:byte())
		end))
	end
end
hex = tohex
string.tohex = tohex
string.hex = tohex

--convert hex string to its binary representation.
function fromhex(s)
	if #s % 2 == 1 then
		return fromhex('0'..s)
	end
	return (gsub(s, '..', function(cc)
		return char(assert(tonumber(cc, 16)))
	end))
end
string.fromhex = fromhex

function hexblock(s)
	local n = 16
	local t = {}
	for i = 1, #s, n do
		local s = s:sub(i, i+n-1)
		s = s:tohex():gsub('(..)', '%1 '):rpad(49)
			.. s:gsub('[%z\1-\31\127-\255]', '.')
		add(t, s)
	end
	add(t, '')
	return cat(t, '\n')
end
string.hexblock = hexblock

function starts(s, p) --5x faster than s:find'^...' in LuaJIT 2.1
	return s:sub(1, #p) == p
end
string.starts = starts

function ends(s, p)
	return p == '' or s:sub(-#p) == p
end
string.ends = ends

function string:has(p, i)
	return self:find(p, i or 1, true)
end

function subst(s, t, get_missing) --subst('{foo} {bar}', {foo=1, bar=2}) -> '1 2'
	if get_missing then
		local missing
		return gsub(s, '{([_%w]+)}', function(s)
			if t[s] ~= nil then
				return t[s]
			else
				if not missing then missing = {} end
				missing[#missing + 1] = s
			end
		end), missing
	else
		return gsub(s, '{([_%w]+)}', t)
	end
end
string.subst = subst

--concat args, skipping nil ones. returns nil if there are no non-nil args.
function catany(sep, ...)
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

function catall(...)
	for i=1,select('#',...) do
		if not select(i,...) then
			return nil
		end
	end
	return catany('', ...)
end

--capitalize the first letter of every word in string.
local function cap(a, b) return a:upper()..b end
function capitalize(s)
	return gsub(s, '(%l)(%w*)', cap)
end
string.capitalize = capitalize

--NOTE: this is not generic enough to be in here but we won't make a full
--module just for it.

local escapes = { --from mustache.js
	['&']  = '&amp;',
	['<']  = '&lt;',
	['>']  = '&gt;',
	['"']  = '&quot;',
	["'"]  = '&#39;',
	['/']  = '&#x2F;',
	['`']  = '&#x60;', --attr. delimiter in IE
	['=']  = '&#x3D;',
}
function html_escape(s)
	if s == nil then return '' end
	return s:gsub('[&<>"\'/`=]', escapes)
end
string.html_escape = html_escape

do
local suffixes = {[0] = 'B', 'K', 'M', 'G', 'T', 'P', 'E'}
local magnitudes = index(suffixes)
local clamp, ln1024 = clamp, ln(1024)
local decfmt = memoize(function(dec) return '%.'..dec..'f%s' end)
function kbytes(x, dec, mag)
	local i = mag and magnitudes[mag] or clamp(floor(ln(x) / ln1024), 0, #suffixes-1)
	local z = x / 1024^i
	local fmt = dec and dec ~= 0 and decfmt(dec) or '%.0f%s'
	return format(fmt, z, suffixes[i])
end
end

--stdout & stderr ------------------------------------------------------------

--virtualize the print function, eg. print_function(io.write, tostring)
--gets you standard print().
function print_function(out, format, newline)
	newline = newline or '\n'
	format = format or tostring
	return function(...)
		local n = select('#', ...)
		for i=1,n do
			out(format((select(i, ...))))
			if i < n then
				out'\t'
			end
		end
		out(newline)
	end
end

function printf(...)
	return io.stdout:write(format(...))
end

local function fmtargs(fmt, ...)
	return fmt and fmt:format(...) or ''
end

function say(fmt, ...)
	if logging.quiet then return end
	io_stderr:write(fmtargs(fmt, ...)..'\n')
	io_stderr:flush()
end

function sayn(fmt, ...)
	if logging.quiet then return end
	io_stderr:write(fmtargs(fmt, ...))
	io_stderr:flush()
end

function die(fmt, ...)
	logging.quiet = false --let's see it in systemd log
	say(fmt and 'ABORT: '..fmt or 'ABORT', ...)
	exit(1)
end

function must(...)
	if ... then return ... end
	die(traceback())
end

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
function collect(n,...)
	if type(n) == 'number' then
		return collect_at(n,...)
	elseif type(n) == 'function' then
		return collect_first(n,...)
	else --pass-through, eg. collect(words(nil)) -> nil.
		return n,...
	end
end

--stubs ----------------------------------------------------------------------

function pass(...) return ... end
function noop() return end

function call(f, ...)
	if isfunc(f) then return f(...) end
	return f, ...
end

--objects --------------------------------------------------------------------

--[[
This 5 LOC object model has the following qualities:
* small memory footprint: only 2 table slots and no extra tables.
* funcall-style instantiation with t(...) by defining t:__call(...).
* subclassing from instances is allowed (prototype-based inheritance).
* do `t.__call = object` to get t(...) -> t1 i.e. use `object` as
  constructor stub for both subclassing and instantiation.
* do `t.new = object` to get t:new(...) -> t1 (same thing, different style).
* do `t.subclass = object` to get t:subclass(...) -> t1, i.e. use
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
  `C.override = override`, `C.before = before`, `C.after = after`.
]]
function object(super, o, ...)
	o = o or {}
	o.__index = super
	o.__call = super and super.__call
	update(o, ...) --add mixins, defaults, etc.
	return setmetatable(o, o)
end

function inherits(v, class)
	local mt = getmetatable(v)
	if type(mt) ~= 'table' then return false end
	local parent = rawget(mt, '__index')
	if parent == nil then return false end
	if parent == class then return true end
	return inherits(parent, class)
end

--[[
We call these method overriding hooks. Check it out:
	before   (foo, 'bar', f)  # foo.bar method patched to call f(self, ...) first
	after    (foo, 'bar', f)  # foo.bar method patched to call f(self, ...) last
	override (foo, 'bar', f)  # foo.bar(...) returns f(inherited, self, ...)
or:
	Foo.before = before       # Foo class got new ability
	Foo.after  = after        # Foo class got new ability
	foo:before  ('bar', f)    # foo.bar method patched to call f(self, ...) first
	foo:after   ('bar', f)    # foo.bar method patched to call f(self, ...) last
	foo:override('bar', f)    # foo.bar(...) returns f(inherited, self, ...)
]]
local function install(self, combine, method_name, hook)
	rawset(self, method_name, combine(self[method_name], hook))
end
function do_before(method, hook)
	if repl(method, noop, nil) then
		if repl(hook, noop, nil) then
			return function(self, ...)
				hook(self, ...)
				return method(self, ...)
			end
		else
			return method
		end
	else
		return hook
	end
end
function before(self, method_name, hook)
	install(self, do_before, method_name, hook)
end
function do_after(method, hook)
	if repl(method, noop, nil) then
		if repl(hook, noop, nil) then
			return function(self, ...)
				method(self, ...)
				return hook(self, ...)
			end
		else
			return method
		end
	else
		return hook
	end
end
function after(self, method_name, hook)
	install(self, do_after, method_name, hook)
end
local function do_override(method, hook)
	local method = method or noop
	return function(...)
		return hook(method, ...)
	end
end
function override(self, method_name, hook)
	install(self, do_override, method_name, hook)
end

--Return a metatable that supports virtual properties with getters and setters.
--Can be used with setmetatable() and ffi.metatype(). `super` allows keeping
--the functionality of __index while __index is being used for getters.
function gettersandsetters(getters, setters, super)
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

CANCEL = {'CANCEL'} --generic "cancel" command to pass to callbacks.

--process control ------------------------------------------------------------

exit = os.exit

--dates & timestamps ---------------------------------------------------------

local now = now
local os_date = os.date
local os_time = os.time

function date(fmt, t)
	t = t or now()
	local d = os_date(fmt, t)
	if type(d) == 'table' then
		d.sec = d.sec + t - floor(t) --increase accuracy in d.sec
	end
	return d
end

local date = date

--compute timestamp diff. to UTC because os.time() has no option for UTC.
function utc_diff(t)
	local ld = date('*t', t)
	ld.isdst = false --adjust for DST.
	local ud = date('!*t', t)
	local lt = os_time(ld)
	local ut = os_time(ud)
	return lt and ut and lt - ut
end

--Like os.time() but with utc option and sub-second accuracy.
--NOTE: You should only use date() and time() for current dates and use
--something else for historical dates because these functions don't work
--with negative timestamps. They're Y2038-safe though.
function time(utc, y, m, d, h, M, s, isdst)
	if utc ~= nil and utc ~= true and utc ~= false then --shift arg#1
		     utc, y, m, d, h, M, s, isdst =
		nil, utc, y, m, d, h, M, s
	end
	local t
	if y then
		if type(y) == 'table' then
			local t = y
			if utc == nil then utc = t.utc end
			y, m, d, h, M, s, isdst = t.year, t.month, t.day, t.hour, t.min, t.sec, t.isdst
		end
		s = s or 0
		t = os_time{year = y, month = m or 1, day = d or 1, hour = h or 0,
			min = M or 0, sec = s, isdst = isdst}
		if not t then return nil end
		t = t + s - floor(s)
	else
		t = now()
	end
	local d = not utc and 0 or utc_diff(t)
	if not d then return nil end
	return t + d
end

local time = time

--get the time at last sunday before a given time, plus/minus a number of weeks.
function sunday(utc, t, offset)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, t, offset = false, utc, t
	end
	local d = date(utc and '!*t' or '*t', t)
	return time(false, d.year, d.month, d.day - (d.wday - 1) + (offset or 0) * 7)
end

--get the time at the start of the day of a given time, plus/minus a number of days.
function day(utc, t, offset)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, t, offset = false, utc, t
	end
	local d = date(utc and '!*t' or '*t', t)
	return time(false, d.year, d.month, d.day + (offset or 0))
end

--get the time at the start of the month of a given time, plus/minus a number of months.
function month(utc, t, offset)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, t, offset = false, utc, t
	end
	local d = date(utc and '!*t' or '*t', t)
	return time(false, d.year, d.month + (offset or 0))
end

--get the time at the start of the year of a given time, plus/minus a number of years.
function year(utc, t, offset)
	if type(utc) ~= 'boolean' then --shift arg#1
		utc, t, offset = false, utc, t
	end
	local d = date(utc and '!*t' or '*t', t)
	return time(false, d.year + (offset or 0))
end

--error handling -------------------------------------------------------------

local xpcall = xpcall

--like standard assert() but with error message formatting via string.format()
--and doesn't allocate memory unless the assertion fails.
--NOTE: unlike standard assert(), this only returns the first argument
--to avoid returning the error message and it's args along with it so don't
--use it with functions returning multiple values if you want those values.
function assertf(v, err, ...)
	if v then return v end
	err = err and format(err, logargs(...)) or 'assertion failed!'
	error(err, 2)
end

--[[
pcall with finally and except "clauses":

	local ret,err = fpcall(function(finally, onerror, ...)
		local foo = getfoo()
		finally(function() foo:free() end)
		onerror(function(err) io.stderr:write(err, '\n') end)
	end, ...)

NOTE: a bit bloated at 2 tables and 4 closures. Can we reduce the overhead?
NOTE: LuaJIT and Lua 5.2 only from using a xpcall message handler.
]]
local function _fpcall(f,...)
	local fint, errt = {}, {}
	local function finally(f) fint[#fint+1] = f end
	local function onerror(f) errt[#errt+1] = f end
	local function err(e)
		for i=#errt,1,-1 do errt[i](e) end
		for i=#fint,1,-1 do fint[i]() end
		return traceback(e)
	end
	local function cont(ok,...)
		if ok then
			for i=#fint,1,-1 do fint[i]() end
		end
		return ok,...
	end
	return cont(xpcall(f, err, finally, onerror, ...))
end
local function unprotect_fpcall(ok, result, ...)
	if not ok then return nil, result, ... end
	if result == nil then result = true end --to distinguish from error.
	return result, ...
end
function fpcall(...)
	return unprotect_fpcall(_fpcall(...))
end

--fcall is like fpcall() but without the protection (i.e. raises errors).
local function assert_fpcall(ok, ...)
	if not ok then error(..., 0) end
	return ...
end
function fcall(...)
	return assert_fpcall(_fpcall(...))
end

--modules --------------------------------------------------------------------

--require shorthand: require'glue'.with'module1 ...'
package.loaded.glue = {with = function(s)
	for s in words(s) do
		require(s)
	end
end}

--[[
Create a module with a public and private namespace and set the environment
of the calling function (not the global one!) to the module's private
namespace and return the namespaces. Cross-references between the namespaces
are also created at M._P, P._M, P._P and M._M, so both _P and _M can be
accessed directly from the new environment.

`parent` controls what the namespaces will inherit and it can be either
another module, in which case M inherits parent and P inherits parent._P,
or it can be a string in which case the module to inherit is first required.
`parent` defaults to _M so that calling module() creates a submodule
of the current module. If there's no _M in the current environment then P
inherits _G and M inherits nothing.

Specifying a name for the module either returns package.loaded[name] if it is
set or creates a module, sets package.loaded[name] to it and returns that.
This is useful for creating and referencing shared namespaces without having
to make a Lua file and require that.

Naming the module also sets P[name] = M so that public symbols can be
declared in foo.bar style instead of _M.bar.

Setting foo.module = module makes module foo directly extensible
by calling foo:module'bar' or require'foo':module'bar'.

All this functionality is packed into just 27 LOC, less than it takes to
explain it, so read the code to get to another level of understanding.
]]
_M = nil --strict
function module(name, parent)
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
return autoload({
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
function autoload(t, k, v)
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
		update(mt.__autoload, k) --multiple key -> module associations.
	else
		mt.__autoload[k] = v --single key -> module association.
	end
	return t
end

do
local arg = rawget(_G, 'arg')
local arg0 = arg and arg[0]

--get script's directory, based on arg[0].
--NOTE: the path is not absolute, but relative to the starting current directory!
local dir = arg0 and arg0:gsub('[/]?[^/]+$', '') --remove file name
rel_scriptdir = dir == '' and '.' or dir

--get script's name without Lua file extension, based on arg[0].
--NOTE: for bundled executables, this returns the executable's name.
scriptname = arg0 and arg0:gsub('%.lua$', ''):match'[^/\\]+$' or '?'
end

function sopath(path)
	require'proc'
	env('LD_LIBRARY_PATH', catany(':', env'LD_LIBRARY_PATH', path))
end

--interpreter ----------------------------------------------------------------

local loadstring = loadstring
local setfenv = setfenv
function try_eval(s, ...)
	local f, err = loadstring('return '..s)
	if not f then return false, err end
	return pcall(f, ...)
end
function eval(s, ...)
	return assert(loadstring('return '..s))(...)
end

local loadfile = loadfile
function try_eval_file(s, ...)
	local f, err = loadfile(s)
	if not f then return false, err end
	local ok, ret = pcall(f, ...)
	if not ok then return nil, ret end
	return ret
end
function eval_file(s, ...)
	return assert(try_eval_file(s, ...))
end

--bits -----------------------------------------------------------------------

bnot = bit.bnot
shl  = bit.lshift
shr  = bit.rshift
band = bit.band
bor  = bit.bor
xor  = bit.bxor
bxor = bit.bxor
bswap = bit.bswap

local
	band, bor, bnot, shr, bswap =
	band, bor, bnot, shr, bswap

function bswap16(x)
	return shr(bswap(x), 16)
end

--extract the bool value of a bitmask from a value.
function getbit(from, mask)
	return band(from, mask) == mask
end

--set a single bit of a value without affecting other bits.
function setbit(over, mask, yes)
	return bor(yes and mask or 0, band(over, bnot(mask)))
end

--set one or more bits of a value without affecting other bits.
function setbits(over, mask, bits)
	return bor(bits, band(over, bnot(mask)))
end

--turn a table of boolean options into a bit mask.
local function table_flags(t, masks, strict)
	local bits = 0
	local mask = 0
	for k,v in pairs(t) do
		local flag
		if type(k) == 'string' and v then --flags as table keys: {flag->true}
			flag = k
		elseif type(k) == 'number'
			and floor(k) == k
			and type(v) == 'string'
		then --flags as array: {flag1,...}
			flag = v
		end
		local bitmask = masks[flag]
		if strict then
			assertf(bitmask, 'invalid flag: "%s"', tostring(flag))
		end
		if bitmask then
			mask = bit.bor(mask, bitmask)
			if flag then
				bits = bit.bor(bits, bitmask)
			end
		end
	end
	return bits, mask
end

--turn 'opt1 +opt2 -opt3' -> {opt1=true, opt2=true, opt3=false}
local string_flags = memoize(function(strict, masks, s)
	local t = {}
	for s in s:gmatch'[^ ,]+' do
		local m,s = s:match'^([%+%-]?)(.*)$'
		t[s] = m ~= '-'
	end
	return {table_flags(t, masks, strict)}
end)

--bor() that takes its arguments as a string of form 'opt1 +opt2 -opt3...',
--a list of form {'opt1', 'opt2', ...} or a map of form {opt->true|false},
--and performs bor() on the numeric values of those arguments where the
--numeric values are given as the `masks` table in form {opt->mask}.
--Useful for Luaizing C functions that take bitmask flags.
--Example: bitflags('a c', {a=1, b=2, c=4}) -> 5
function bitflags(arg, masks, cur_bits, strict)
	if type(arg) == 'string' then
		local bits, mask = unpack(string_flags(strict or false, masks, arg))
		return setbits(cur_bits or 0, mask, bits)
	elseif type(arg) == 'table' then
		local bits, mask = table_flags(arg, masks, strict)
		return setbits(cur_bits or 0, mask, bits)
	elseif type(arg) == 'number' then
		return arg
	elseif arg == nil then
		return 0
	else
		assertf(false, 'flags expected but "%s" given', type(arg))
	end
end

--ffi ------------------------------------------------------------------------

C      = ffi.C
cdef   = ffi.cdef
new    = ffi.new
cast   = ffi.cast
sizeof = ffi.sizeof
offsetof = ffi.offsetof
ctype  = ffi.typeof
copy   = ffi.copy
fill   = ffi.fill
gc     = ffi.gc
metatype = ffi.metatype
isctype = ffi.istype
errno  = ffi.errno
_G[ffi.os] = true --Windows, Linux, OSX

local
	C, cast, copy, ctype =
	C, cast, copy, ctype

i8p = ctype'int8_t*'
i8a = ctype'int8_t[?]'
u8p = ctype'uint8_t*'
u8a = ctype'uint8_t[?]'

i16p = ctype'int16_t*'
i16a = ctype'int16_t[?]'
u16p = ctype'uint16_t*'
u16a = ctype'uint16_t[?]'

i32p = ctype'int32_t*'
i32a = ctype'int32_t[?]'
u32p = ctype'uint32_t*'
u32a = ctype'uint32_t[?]'

i64p = ctype'int64_t*'
i64a = ctype'int64_t[?]'
u64p = ctype'uint64_t*'
u64a = ctype'uint64_t[?]'

f32p = ctype'float*'
f32a = ctype'float[?]'
f64p = ctype'double*'
f64a = ctype'double[?]'

i32 = ctype'int32_t'
u32 = ctype'uint32_t'
u64 = ctype'uint64_t'
i64 = ctype'int64_t'
f32 = ctype'float'
f64 = ctype'double'

voidp   = ctype'void*'
intptr  = ctype'intptr_t'
uintptr = ctype'uintptr_t'

cdef[[
typedef   int8_t i8;
typedef  uint8_t u8;
typedef  int16_t i16;
typedef uint16_t u16;
typedef  int32_t i32;
typedef uint32_t u32;
typedef  int64_t i64;
typedef uint64_t u64;
typedef  float   f32;
typedef double   f64;

typedef uint8_t  bool8;
]]

cdef'int memcmp(const void * ptr1, const void * ptr2, size_t num);'
memcmp = C.memcmp

local ffi_string = ffi.string
local function str(s, len)
	if s == nil and not len then return nil end
	return ffi_string(s, len)
end
_G.str = str

--strnlen but returns nil if string is not null-terminated!
cdef'size_t strnlen(const char *s, size_t maxlen);'
function strlen(s, maxlen)
	maxlen = maxlen or 0xffff
	local len = C.strnlen(s, maxlen)
	if len == maxlen then return nil end
	return len
end

function ptr(p)
	return p ~= nil and p or nil
end

cdef'int getrandom(void *buf, size_t buflen, unsigned int flags);'
function secure_random_string(n)
	local buf = u8a(n)
	local ret = C.getrandom(buf, n, 0)
	assert(ret == n, 'getrandom() failed')
	return ffi_string(buf, n)
end

cdef[[
typedef int pid_t;
pid_t getpid(void);
]]
getpid = C.getpid

--allocation -----------------------------------------------------------------

--freelist for Lua tables. Returns alloc() -> e and free(e) functions.
--alloc() returns the last freed object if any or calls create().
local function create_table()
	return {}
end
function freelist(create, destroy)
	create = create or create_table
	destroy = destroy or noop
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

cdef[[
void* malloc  (size_t size);
void* realloc (void* ptr, size_t size);
void  free    (void* ptr);
]]
local ptr = ptr
function malloc(size) return ptr(C.malloc(size)) end
function realloc(p, size) return ptr(C.realloc(p, size)) end
free = C.free

--[[
auto-growing buffer allocation pattern.
- ct must be a VLA: the returned buffer will have that type.
- the buffer only grows in powers-of-two steps.
- alloc() returns the buffer's current capacity which can be equal or
  greater than the requested length.
- the returned buffer is referenced by the allocation function. call
  alloc(false) to let it loose.
- the contents of the buffer are not preserved between allocations.
]]
local nextpow2 = nextpow2
function buffer(ct)
	local vla = ctype(ct or u8a)
	local buf, len = nil, -1
	return function(minlen)
		if minlen == false then
			buf, len = nil, -1
		elseif minlen > len then
			len = nextpow2(minlen)
			buf = vla(len)
		end
		return buf, len
	end
end

--pointer serialization/deserialization --------------------------------------

--convert a pointer's address to a Lua number or possibly string.
--use case #1: hashing on pointer values i.e. using pointers as table keys.
--use case #2: moving pointers in and out of Lua states when using luastate.lua.
local intptr_a1 = ctype'intptr_t[1]'
function ptr_serialize(p)
	local np = cast(intptr, cast(voidp, p))
	local n = tonumber(np)
	if cast(intptr, n) ~= np then
		--address too big (ASLR? tagged pointers?): convert to string.
		return str(intptr_a1(np), 8)
	end
	return n
end

--convert a pointer address to a pointer, optionally specifying a ctype.
local intptrp = ctype'const intptr_t*'
function ptr_deserialize(ct, addr)
	if not addr then
		ct, addr = voidp, ct
	end
	if type(addr) == 'string' then
		return cast(ct, cast(voidp, cast(intptrp, addr)[0]))
	else
		return cast(ct, addr)
	end
end

--errno unified messages -----------------------------------------------------
--only list here user errors and recoverable errors.

cdef'char *strerror(int errnum);'

local errno_msgs = {
	--fs & proc
	[  1] = 'access_denied', --EPERM
	[  2] = 'not_found', --ENOENT, _open_osfhandle(), _fdopen(), open(), mkdir(),
	                     --rmdir(), opendir(), rename(), unlink()
	[  4] = 'interrupted', --EINTR, epoll_wait()
	[  5] = 'io_error', --EIO, read(), write(), fsync()
	[  9] = 'bad_file', --EBADF
	[ 12] = 'out_of_mem', --ENOMEM, mmap()
	[ 13] = 'access_denied', --EACCES, open(), mkdir(), unlink(), rmdir()
	[ 17] = 'already_exists', --EEXIST, open(), mkdir(), mkfifo(), rename()
	[ 18] = 'cross_device', --EXDEV, rename()
	[ 19] = 'no_device', --ENODEV, block device disappeared (fatal)
	[ 20] = 'not_dir', --ENOTDIR, open(), opendir()
	[ 21] = 'is_dir', --EISDIR, open(), unlink()
	[ 22] = 'invalid_argument', --EINVAL, mmap()
	[ 23] = 'too_many_open_files', --ENFILE, open()
	[ 24] = 'too_many_fds', --EMFILE, open() (fatal: fd leak)
	[ 27] = 'file_too_big', --EFBIG, write(), fallocate(), truncate()
	[ 28] = 'no_space', --ENOSPC, write(), fallocate(), mkdir(), rename(), epoll_add() (fatal)
	[ 29] = 'invalid_seek', --ESPIPE, lseek() on pipe/socket (fatal: programming error)
	[ 30] = 'read_only', --EROFS, open(), mkdir(), unlink(), rename() (fatal)
	[ 32] = 'eof', --EPIPE, write()
	[ 36] = 'name_too_long', --ENAMETOOLONG, open(), rename(), mkdir()
	[ 38] = 'not_implemented', --ENOSYS, syscall not implemented (fatal: wrong kernel)
	[ 39] = 'not_empty', --ENOTEMPTY, rmdir()
	[ 40] = 'too_many_symlinks', --ELOOP, open(), stat() (too many symlinks in path)
	[ 95] = 'not_supported', --EOPNOTSUPP, fallocate()
	[122] = 'disk_quota', --EDQUOT, write(), open(), mkdir()
	--sock
	[ 64] = 'network_missing', --ENONET, accept()
	[ 71] = 'protocol_error', --EPROTO, accept()
	[ 92] = 'protocol_not_available', --ENOPROTOOPT, accept()
	[ 98] = 'address_already_in_use', --EADDRINUSE, bind()
	[ 99] = 'address_not_available', --EADDRNOTAVAIL, bind(), connect()
	[100] = 'network_down', --ENETDOWN, connect(), send()
	[101] = 'network_unreachable', --ENETUNREACH, connect(), send()
	[103] = 'connection_aborted', --ECONNABORTED, accept()
	[104] = 'connection_reset', --ECONNRESET, recv(), send()
	[107] = 'not_connected', --ENOTCONN, send(), recv(), shutdown() (fatal)
	[110] = 'timed_out', --ETIMEDOUT, connect()
	[111] = 'connection_refused', --ECONNREFUSED, connect()
	[112] = 'host_down', --EHOSTDOWN, accept()
	[113] = 'host_unreachable', --EHOSTUNREACH, connect(), send()
	[114] = 'already_in_progress', --EALREADY, connect() (fatal)
	[115] = 'in_progress', --EINPROGRESS, connect() (handled in scheduler)
}

function try_errno(ret, err)
	if ret then return ret end
	if isstr(err) then return ret, err end
	err = err or errno()
	local s = errno_msgs[err]
	assert(s ~= 'invalid_argument', s)
	assert(s ~= 'bad_file', s)
	assert(s ~= 'invalid_seek', s)
	assert(s ~= 'no_device', s)
	assert(s ~= 'too_many_fds', s)
	assert(s ~= 'read_only', s)
	assert(s ~= 'not_implemented', s)
	assert(s ~= 'not_connected', s)
	assert(s ~= 'already_in_progress', s)
	if s then return ret, s end
	local s = C.strerror(err)
	local s = str(s) or 'errno '..err
	return ret, s
end
function check_errno(ret)
	assert(try_errno(ret))
end

--buffers --------------------------------------------------------------------

--like buffer() but preserves data on reallocations.
--also returns minlen instead of capacity.
function dynarray(ct, min_capacity)
	ct = ct or u8a
	local alloc = buffer(ct)
	local elem_size = sizeof(ct, 1)
	local buf0, minlen0
	return function(minlen)
		local buf, len = alloc(minlen and max(min_capacity or 0, minlen))
		--TODO: would realloc() be better than copy? probably not...
		if buf ~= buf0 and buf ~= nil and buf0 ~= nil then
			copy(buf, buf0, minlen0 * elem_size)
		end
		buf0, minlen0 = buf, minlen
		return buf, minlen
	end
end

--make a write(buf, sz) function that appends data to a dynamic buffer.
function dynarray_pump()
	local b = string_buffer()
	local function write(src, len)
		if isstr(src) then
			assert(not len)
			b:put(src)
		elseif src == nil then --nil, 0 means eof
			assert(len == 0)
			return true
		else
			b:putcdata(src, len)
		end
		return true
	end
	local function collect()
		return b:ref()
	end
	local function reset()
		b:reset()
	end
	return write, collect, reset
end

--like dynarray() but with a lot more features, including fast binary
--(de)serialization of Lua values and a queue-like push/pull API.
--see https://luajit.org/ext_buffer.html
string_buffer = require'string.buffer'.new

--config ---------------------------------------------------------------------

do
	local conf = {}
	function config(k, default)
		if istab(k) then
			for k, v in pairs(k) do
				config(k, v)
			end
		else
			local v = conf[k]
			if v == nil then
				v = default
				conf[k] = v
			end
			return v
		end
	end

	function with_config(t, f, ...)
		local old_conf = conf
		local function pass(ok,...)
			conf = old_conf
			assert(ok,...)
			return ...
		end
		conf = setmetatable(t, {__index = old_conf})
		return pass(pcall(f, ...))
	end

	function load_config_string(s)
		local f = assert(loadstring(s))
		setfenv(f, conf)
		f()
		return true
	end

	function load_config_file(file)
		require'fs'
		local s = load(file)
		return s and load_config_string(s)
	end
end

--debugging ------------------------------------------------------------------

traceback = debug.traceback

function pr(...)
	local n = select('#',...)
	for i=1,n do
		io_stderr:write((logarg((select(i,...)))))
		if i < n then
			io_stderr:write'\t'
		end
	end
	io_stderr:write'\n'
	io_stderr:flush()
	return ...
end

function trace(...)
	if select('#',...) > 0 then pr(...) end
	pr(traceback())
end
function traceif(cond, ...)
	if not cond then return end
	trace(...)
end

function S(id, ...)
	return format(...)
end

require'errors'
require'errors_io'
require'logging'
