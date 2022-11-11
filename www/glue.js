/*

	JavaScript "assorted lengths of wire" library.
	Written by Cosmin Apreutesei. Public domain.

TYPE CHECKING
	isobject(e)
	isarray(a)
	isobj(t)
	isstr(s)
	isnum(n)
	isbool(b)
	isfunc(f)
LOGIC
	or(x, z)
	strict_or(x, z)
	repl(x, v, z)
MATH
	inf
	floor(x) ceil(x) round(x)
	abs(x)
	min(x, y) max(x, y)
	sqrt(x)
	ln(x)
	log10(x)
	random()
	PI sin(x) cos(x) tan(x) rad deg
	clamp(x, x0, x1)
	sign(x)
	strict_sign(x)
	lerp(x, x0, x1, y0, y1)
	num(s, z)
	mod(a, b)
	nextpow2(x)
	x.dec([decimals])
	x.base([base], [digits])
CALLBACKS
	noop
	return_true
	return_false
	return_arg
	assert_false
ERRORS
	pr[int](...)
	warn(...)
	debug(...)
	trace()
	assert(v, err, ...) -> v
	stacktrace()
EXTENDING BUILT-IN OBJECTS
	property(cls, prop, descriptor | get,set)
	method(cls, method, func)
	override(cls, method, func)
	alias(cls, new_name, old_name)
	override_property_setter(cls, prop, set)
STRINGS
	s.subst('{0} {1}', a0, a1, ...)
	s.starts(s)
	s.ends(s)
	s.upper()
	s.lower()
	s.num(z)
	s.display_name()
	s.cat(sep, ...)
	s.words() -> a
MULTI-LANGUAGE STUBS
	S(id, default)                         get labeled string in current language
	lang()                                 get current language
	country()                              get current country
	href(url, [lang])                      rewrite URL for (current) language
ARRAYS
	array(...) -> a
	empty_array
	a.set(a1) -> s
	a.extend(a1)
	a.insert(i, v)
	a.remove(i) -> v
	a.remove_value(v) -> i
	a.remove_values(cond)
	a.last
	a.binsearch(v, cmp, i1, i2)
	a.each(f)
	a.tokeys([v]) -> t
	a.uniq_sorted()
	a.remove_duplicates()
HASH MAPS
	obj() -> o
	set(iter) -> m
	s.addset(s2) -> s
	map(iter) -> m
	m.first_key
	m.toarray() -> a
	empty
	keys(t)
	assign(dt, t1, ...)
	assign_opt(dt, t1, ...)
	attr(t, k[, cons])
	memoize(f)
	count_keys(t, [max_n]) -> n
TYPED ARRAYS
	[dyn_][f32|i8|u8|i16|u16|i32|u32]arr(arr|[...]|capacity, [nc]) -> [dyn]arr
		.set(in_arr, [offset=0], [len], [in_offset=0])
		.invalidate([offset=0], [len])
		.grow(cap, [preserve_contents=true], [pow2=true])
		.grow_type(arr_type|max_index|[...]|arr, [preserve_contents=true])
		.setlen(len)
TIME & DATE
	time() -> ts
	time(y, m, d, H, M, s, ms) -> ts
	time(date_str) -> ts
	[day|month|year|week](ts[, offset]) -> ts
	days(delta_ts) -> ds
	[year|month|week_day|month_day|hours|minutes|seconds]_of(ts)
	set_[year|month|month_day|hours|minutes|seconds](ts)
	locale()
	weekday_name (ts, ['long'], [locale])
	month_name   (ts, ['long'], [locale])
	month_year   (ts, ['long'], [locale])
	week_start_offset([country])
	ds.duration(['approx[+s]'|'long']) -> s
	ts.timeago() -> s
	ts.date([locale], [with_time], [with_seconds]) -> s
	s.parse_date([locale]) -> ts
FILE SIZE FORMATTING
	x.kbytes(x, [dec], [mag], [mul = 1024]) -> s
COLORS
	hsl_to_rgb(h, s, L) -> '#rrggbb'
GEOMETRY
	point_around(cx, cy, r, angle) -> [x, y]
	clip_rect(x1, y1, w1, h1, x2, y2, w2, h2) -> [x, y, w, h]
TIMERS
	runafter(t, f) -> tm
	runevery(t, f) -> tm
	runagainevery(t, f) -> tm
	clock()
	timer(f)
SERIALIZATION
	json_arg(s) -> t
	json(t) -> s
CLIPBOARD
	copy_to_clipboard(text, done_func)
LOCAL STORAGE
	save(key, s)
	load(key) -> s
URL DECODING, ENCODING AND UPDATING
	url_parse(s) -> t
	url_format(t) -> s
EVENTS
	event(name|ev, [bubbles], ...args) -> ev
	e.on   (name|ev, f, [enable], [capture])
	e.off  (name|ev, f, [capture])
	e.once (name|ev, f, [enable], [capture])
	e.fire    (name, ...args)
	e.fireup  (name, ...args)
	on.installers.EVENT = f() { ... }
	on.callers.EVENT = f(ev, f) { return f.call(this, ...) }
	DEBUG_EVENTS = false
AJAX REQUESTS
	ajax(opt) -> req
	get(url, success, [error], [opt]) -> req
	post(url, data, [success], [error], [opt]) -> req
BROWSER DETECTION
	Firefox

*/

// types ---------------------------------------------------------------------

isobject = e => e != null && typeof e == 'object' // includes arrays, HTMLElements, etc.
isarray = Array.isArray
isobj = t => isobject(t) && (t.constructor == Object || t.constructor === undefined)
isstr = s => typeof s == 'string'
isnum = n => typeof n == 'number'
isbool = b => typeof b == 'boolean'
isfunc = f => typeof f == 'function'

// logic ---------------------------------------------------------------------

// non-shortcircuiting `||` operator for which only `undefined` and `null` are falsey.
function or(x, z) { return x != null ? x : z }

// non-shortcircuiting `||` operator for which only `undefined` is falsey.
function strict_or(x, z) { return x !== undefined ? x : z }

// single-value filter.
function repl(x, v, z) { return x === v ? z : x }

// math ----------------------------------------------------------------------

inf = Infinity
floor = Math.floor
ceil = Math.ceil
round = Math.round
abs = Math.abs
min = Math.min
max = Math.max
sqrt = Math.sqrt
ln = Math.log
log10 = Math.log10
logbase = (x, base) => ln(x) / ln(base)
random = Math.random
sign = Math.sign

// NOTE: returns x1 if x1 < x0, which enables the idiom
// `a[clamp(i, 0, b.length-1)]` to return undefined when b is empty.
function clamp(x, x0, x1) {
	return min(max(x, or(x0, -1/0)), or(x1, 1/0))
}

// sign() that only returns -1 or 1, never 0, and returns -1 for -0.
function strict_sign(x) {
	return 1/x == 1/-0 ? -1 : (x >= 0 ? 1 : -1)
}

function lerp(x, x0, x1, y0, y1) {
	return y0 + (x-x0) * ((y1-y0) / (x1 - x0))
}

function num(s, z) {
	let x = parseFloat(s)
	return x != x ? z : x
}

// % that works with negative numbers.
function mod(a, b) {
	return (a % b + b) % b
}

function nextpow2(x) {
	return max(0, 2**(ceil(ln(x) / ln(2))))
}

PI  = Math.PI
sin = Math.sin
cos = Math.cos
tan = Math.tan
rad = PI / 180
deg = 180 / PI

asin  = Math.asin
acos  = Math.acos
atan  = Math.atan
atan2 = Math.atan2

Number.prototype.base = function(base, decimals) {
	let s = this.toString(base)
	if (decimals != null)
		s = s.padStart(decimals, '0')
	return s
}
Number.prototype.dec = Number.prototype.toFixed

// callback stubs ------------------------------------------------------------

function noop() {}
function return_true() { return true; }
function return_false() { return false; }
function return_arg(arg) { return arg; }

// error handling ------------------------------------------------------------

print = null
pr    = console.log
warn  = console.log
debug = console.log
trace = console.trace

function assert(ret, err, ...args) {
	if (ret == null || ret === false) {
		throw ((err && err.subst(...args) || 'assertion failed'))
	}
	return ret
}

function stacktrace() {
	try {
		throw new Error()
	} catch(e) {
		return e.stack
	}
}

/* extending built-in objects ------------------------------------------------

NOTE: built-in methods are actually "data properties" that shadow normal
methods so if we want to override one we need to replace the property.
These special kinds of methods are also non-enumerable, unlike normal
methods, which is useful if we want to extend Object without injecting
enumerables into it.

*/

// extend an object with a property, checking for upstream name clashes.
function property(cls, prop, get, set) {
	let proto = cls.prototype || cls
	assert(!(prop in proto), '{0}.{1} already exists', cls.type || cls.name, prop)
	let descriptor = isobject(get) ? get : {get: get, set: set}
	Object.defineProperty(proto, prop, descriptor)
}

// extend an object with a method, checking for upstream name clashes.
function method(cls, meth, func) {
	property(cls, meth, {
		value: func,
		enumerable: false,
	})
}

// override a method, with the ability to override a built-in method.
function override(cls, meth, func) {
	let proto = cls.prototype || cls
	let inherited = proto[meth]
	assert(inherited, '{0}.{1} does not exists', cls.type || cls.name, meth)
	function wrapper(...args) {
		return func.call(this, inherited, ...args)
	}
	Object.defineProperty(proto, meth, {
		value: wrapper,
		enumerable: false,
	})
}

function getRecursivePropertyDescriptor(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key)
		? Object.getOwnPropertyDescriptor(obj, key)
		: getRecursivePropertyDescriptor(Object.getPrototypeOf(obj), key)
}
method(Object, 'getPropertyDescriptor', function(key) {
	return key in this && getRecursivePropertyDescriptor(this, key)
})

function alias(cls, new_name, old_name) {
	let proto = cls.prototype || cls
	let d = proto.getPropertyDescriptor(old_name)
	assert(d, '{0}.{1} does not exist', cls.type || cls.name, old_name)
	Object.defineProperty(proto, new_name, d)
}

// override a property setter in a prototype *or instance*.
function override_property_setter(cls, prop, set) {
	let proto = cls.prototype || cls
	let d0 = proto.getPropertyDescriptor(prop)
	assert(d0, '{0}.{1} does not exist', cls.type || cls.name, prop)
	let inherited = d0.set || noop
	function wrapper(v) {
		return set.call(this, inherited, v)
	}
	d0.set = wrapper
	Object.defineProperty(proto, prop, d0)
}

// strings -------------------------------------------------------------------

// usage:
//	 '{1} of {0}'.subst(total, current)
//	 '{1} of {0}'.subst([total, current])
//	 '{1} of {0:foo:foos}'.subst([total, current])
//	 '{current} of {total}'.subst({'current': current, 'total': total})

method(String, 'subst', function(...args) {
	if (!args.length)
		return this
	if (isarray(args[0]))
		args = args[0]
	if (isobject(args[0]))
		args = args[0]
	return this.replace(/{(\w+)\:(\w+)\:(\w+)}/g, function(match, s, singular, plural) {
		let v = num(args[s])
		return v != null ? v + ' ' + (v > 1 ? plural : singular) : s
	}).replace(/{([\w\:]+)}/g, (match, s) => args[s])
})

alias(String, 'starts', 'startsWith')
alias(String, 'ends'  , 'endsWith')
alias(String, 'upper' , 'toUpperCase')
alias(String, 'lower' , 'toLowerCase')

String.prototype.num = function(z) {
	return num(this, z)
}

{
let upper = function(s) {
	return s.toUpperCase()
}
let upper2 = function(s) {
	return ' ' + s.slice(1).toUpperCase()
}
method(String, 'display_name', function() {
	return this.replace(/[\w]/, upper).replace(/(_[\w])/g, upper2)
})
}

{
let non_null = (s) => s != null
function catargs(sep, ...args) {
	return args.filter(non_null).join(sep)
}
method(String, 'cat', function(...args) { return catargs(this, ...args) })
}

method(String, 'esc', function() {
	return this.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
})

method(String, 'words', function() {
	return this.trim().split(/\s+/)
})

function words(s) {
	return isstr(s) ? s.words() : s
}

// multi-language stubs replaced in webb_spa.js ------------------------------

// stub for getting message strings that can be translated multiple languages.
if (!window.S)
	function S(name, en_s, ...args) {
		return en_s.subst(...args)
	}

function Sf(...args) {
	return () => S(...args)
}

// stub for getting current language.
if (!window.lang) {
	let nav_lang = navigator.language.substring(0, 2)
	function lang() {
		return document.documentElement.lang || nav_lang
	}
}

// stub for getting current country.
if (!window.country) {
	let nav_country = navigator.language.substring(3, 5)
	function country() {
		return document.documentElement.attr('country') || nav_country
	}
}

locale = memoize(function() { return lang() + '-' + country() })

// stub for rewriting links to current language.
if (!window.href)
	href = return_arg

// arrays --------------------------------------------------------------------

empty_array = []

method(Array, 'extend', function(a) {
	let i0 = this.length
	let n = a.length
	this.length += n
	for (let i = 0; i < n; i++)
		this[i0+i] = a[i]
	return this
})

method(Array, 'set', function(a) {
	let n = a.length
	this.length = n
	for (let i = 0; i < n; i++)
		this[i] = a[i]
	return this
})

method(Array, 'insert', function(i, v) {
	if (i == null)
		this.push(v)
	else if (i >= this.length)
		this[i] = v
	else
		this.splice(i, 0, v)
	return this
})

method(Array, 'remove', function(i) {
	return this.splice(i, 1)[0]
})

method(Array, 'remove_value', function(v) {
	let i = this.indexOf(v)
	if (i == -1)
		return null
	this.splice(i, 1)
	return i
})

method(Array, 'remove_values', function(cond) {
	let i = 0, j = 0
	while (i < this.length) {
		let v = this[i]
		if (!cond(v, i, this))
			this[j++] = v
		i++
	}
	this.length = j
	return this
})

method(Array, 'clear', function() {
	this.length = 0
	return this
})

// move the n elements at i1 to a new position which is an index in the
// array as it stands after the removal of the elements to be moved.
method(Array, 'move', function(i1, n, insert_i) {
	this.splice(insert_i, 0, ...this.splice(i1, n))
})

property(Array, 'last', {
	get: function() { return this[this.length-1] },
	set: function(v) { this[this.length-1] = v }
})

method(Array, 'equals', function(a, i0, i1) {
	i0 = i0 || 0
	i1 = i1 || max(this.length, a.length)
	for (let i = i0; i < i1; i++)
		if (this[i] !== a[i])
			return false
	return true
})

// binary search for an insert position that keeps the array sorted.
// using '<' gives the first insert position, while '<=' gives the last.
{
let cmps = {}
cmps['<' ] = ((a, b) => a <  b)
cmps['>' ] = ((a, b) => a >  b)
cmps['<='] = ((a, b) => a <= b)
cmps['>='] = ((a, b) => a >= b)
method(Array, 'binsearch', function(v, cmp, i1, i2) {
	let lo = or(i1, 0) - 1
	let hi = or(i2, this.length)
	cmp = cmps[cmp || '<'] || cmp
	while (lo + 1 < hi) {
		let mid = (lo + hi) >> 1
		if (cmp(this[mid], v))
			lo = mid
		else
			hi = mid
	}
	return hi
})
}

alias(Array, 'each', 'forEach')

method(Array, 'tokeys', function(v) {
	v = or(v, true)
	let t = obj()
	for (let k of this)
		t[k] = v
	return t
})

method(Array, 'uniq_sorted', function() {
	return this.remove_values(function(v, i, a) {
		return i && v == a[i-1]
	})
})

// NOTE: O(n^3)
method(Array, 'remove_duplicates', function() {
	return this.remove_values(function(v, i, a) {
		return a.indexOf(v) != i
	})
})

// hash maps -----------------------------------------------------------------

obj = () => Object.create(null)
set = (iter) => new Set(iter)
map = (iter) => new Map(iter)
array = (...args) => new Array(...args)

property(Map, 'first_key', function() {
	for (let [k] of this)
		return k
})

method(Set, 'addset', function(s) {
	for (let k of s)
		this.add(k)
	return this
})

method(Set, 'toarray', function() {
	return Array.from(this)
})

empty = obj()
empty_set = set()

keys = Object.keys

assign = Object.assign

// like Object.assign() but skips assigning `undefined` values.
function assign_opt(dt, ...ts) {
	for (let t of ts)
		if (t != null)
			for (let k in t)
				if (!t.hasOwnProperty || t.hasOwnProperty(k))
					if (t[k] !== undefined)
						dt[k] = t[k]
	return dt
}

function attr(t, k, cons) {
	cons = cons || obj
	let v = (t instanceof Map) ? t.get(k) : t[k]
	if (v === undefined) {
		v = cons()
		if (t instanceof Map)
			t.set(k, v)
		else
			t[k] = v
	}
	return v
}

// TOOD: multi-arg memoize.
function memoize(f) {
	let t = new Map()
	return function(x) {
		if (t.has(x))
			return t.get(x)
		else {
			let y = f(x)
			t.set(x, y)
			return y
		}
	}
}

function count_keys(t, max_n) {
	let n = 0
	for(let i in t) {
		if (n === max_n)
			break
		n++
	}
	return n
}

// typed arrays --------------------------------------------------------------

f32arr = Float32Array
i8arr  = Int8Array
u8arr  = Uint8Array
i16arr = Int16Array
u16arr = Uint16Array
i32arr = Int32Array
u32arr = Uint32Array

function max_index_from_array(a) {
	if (a.max_index != null) // hint
		return a.max_index
	let max_idx = 0
	for (let idx of a)
		max_idx = max(max_idx, idx)
	return max_idx
}

function arr_type_from_max_index(max_idx) {
	return max_idx > 65535 && u32arr || max_idx > 255 && u16arr || u8arr
}

// for inferring the data type of gl.ELEMENT_ARRAY_BUFFER VBOs.
function index_arr_type(arg) {
	if (isnum(arg)) // max_idx
		return arr_type_from_max_index(arg)
	if (isarray(arg)) // [...]
		return arr_type_from_max_index(max_index_from_array(arg))
	if (arg.BYTES_PER_ELEMENT) // arr | arr_type
		return arg.constructor.prototype == arg.__proto__ ? arg.constructor : arg
	return assert(arg, 'arr_type required')
}

class dyn_arr_class {

	// NOTE: `nc` is "number of components" useful for storing compound values
	// without having to compute offsets and lengths manually.

	constructor(arr_type, data_or_cap, nc) {
		this.arr_type = arr_type
		this.nc = nc || 1
		this.inv_nc = 1 / this.nc
		this.array = null
		this.invalid = false
		this.invalid_offset1 = null
		this.invalid_offset2 = null

		if (data_or_cap != null) {
			if (isnum(data_or_cap)) {
				let cap = data_or_cap
				this.grow(cap, false, false)
			} else if (data_or_cap) {
				let data = data_or_cap
				let data_len = data.length * this.inv_nc
				assert(data_len == floor(data_len),
					'source array length not multiple of {0}', this.nc)
				this.array = data
				this.array.len = data_len
			}
		}

	}

	grow(cap, preserve_contents, pow2) {
		cap = max(0, cap)
		if (this.capacity < cap) {
			if (pow2 !== false)
				cap = nextpow2(cap)
			let array = new this.arr_type(cap * this.nc)
			array.nc = this.nc
			array.len = this.len
			if (preserve_contents !== false && this.array)
				array.set(this.array)
			this.array = array
		}
		return this
	}

	grow_type(arg, preserve_contents) {
		let arr_type1 = index_arr_type(arg)
		if (arr_type1.BYTES_PER_ELEMENT <= this.arr_type.BYTES_PER_ELEMENT)
			return
		if (this.array) {
			let this_len = this.len
			let array1 = new arr_type1(this.capacity)
			if (preserve_contents !== false)
				for (let i = 0, n = this_len * this.nc; i < n; i++)
					array1[i] = this.array[i]
			array1.nc = this.nc
			array1.len = this_len
			this.array = array1
		}
		this.arr_type = arr_type1
		return this
	}

	set(offset, data, len, data_offset) {

		// check/clamp/slice source.
		data_offset = data_offset || 0
		let data_len
		if (data.nc != null) {
			assert(data.nc == this.nc, 'source array nc is {0}, expected {1}', data.nc, this.nc)
			data_len = or(data.len, data.length)
		} else {
			data_len = data.length * this.inv_nc
			assert(data_len == floor(data_len), 'source array length not multiple of {0}', this.nc)
		}
		assert(data_offset >= 0 && data_offset <= data_len, 'source offset out of range')
		len = clamp(or(len, 1/0), 0, data_len - data_offset)
		if (data_offset != 0 || len != data_len) // gotta make garbage here...
			data = data.subarray(data_offset * this.nc, (data_offset + len) * this.nc)

		assert(offset >= 0, 'offset out of range')

		this.setlen(max(this.len, offset + len))
		this.array.set(data, offset * this.nc)
		this.invalidate(offset, len)

		return this
	}

	remove(offset, len) {
		assert(offset >= 0, 'offset out of range')
		len = max(0, min(or(len, 1), this.len - offset))
		if (len == 0)
			return
		for (let a = this.array, o1 = offset, o2 = offset + len, i = 0; i < len; i++)
			a[o1+i] = a[o2+i]
		this._len -= len
		this.invalidate(offset)
		return this
	}

	setlen(len) {
		len = max(0, len)
		let arr = this.grow(len).array
		if (arr)
			arr.len = len
		if (this.invalid) {
			this.invalid_offset1 = min(this.invalid_offset1, len)
			this.invalid_offset2 = min(this.invalid_offset2, len)
		}
		return this
	}

	invalidate(offset, len) {
		let o1 = max(0, offset || 0)
		len = max(0, or(len, 1/0))
		let o2 = min(o1 + len, this.len)
		o1 = min(or(this.invalid_offset1,  1/0), o1)
		o2 = max(or(this.invalid_offset2, -1/0), o2)
		this.invalid = true
		this.invalid_offset1 = o1
		this.invalid_offset2 = o2
		return this
	}

	validate() {
		this.invalid = false
		this.invalid_offset1 = null
		this.invalid_offset2 = null
	}

}

property(dyn_arr_class, 'capacity',
	function() { return this.array ? this.array.length * this.inv_nc : 0 },
)

property(dyn_arr_class, 'len',
	function() { return this.array ? this.array.len : 0 },
	function(len) { this.setlen(len) }
)

function dyn_arr(arr_type, data_or_cap, nc) {
	return new dyn_arr_class(arr_type, data_or_cap, nc)
}

dyn_arr.index_arr_type = index_arr_type

{
	let dyn_arr_func = function(arr_type) {
		return function(data_or_cap, nc) {
			return new dyn_arr_class(arr_type, data_or_cap, nc)
		}
	}
	dyn_f32arr = dyn_arr_func(f32arr)
	dyn_i8arr  = dyn_arr_func(i8arr)
	dyn_u8arr  = dyn_arr_func(u8arr)
	dyn_i16arr = dyn_arr_func(i16arr)
	dyn_u16arr = dyn_arr_func(u16arr)
	dyn_i32arr = dyn_arr_func(i32arr)
	dyn_u32arr = dyn_arr_func(u32arr)
}

// data structures -----------------------------------------------------------

function freelist(create, init, destroy) {
	let e = []
	e.alloc = function() {
		let e = this.pop()
		if (e)
			init(e)
		else
			e = create()
		return e
	}
	e.release = function(e) {
		destroy(e)
		this.push(e)
	}
	return e
}

// stack with freelist.
function freelist_stack(create, init, destroy) {
	let e = {}
	let stack = []
	let fl = freelist(create, init, destroy)
	e.push = function() {
		let e = fl.alloc()
		stack.push(e)
		return e
	}
	e.pop = function() {
		let e = stack.pop()
		fl.release(e)
		return e
	}
	e.clear = function() {
		while (this.pop());
	}
	e.stack = stack
	return e
}

// timestamps ----------------------------------------------------------------

_d = new Date() // public temporary date object.

// NOTE: months start at 1, and seconds can be fractionary.
function time(y, m, d, H, M, s) {
	if (isnum(y)) {
		_d.setTime(0) // necessary to reset the time first!
		_d.setUTCFullYear(y)
		_d.setUTCMonth(or(m, 1) - 1)
		_d.setUTCDate(or(d, 1))
		_d.setUTCHours(H || 0)
		_d.setUTCMinutes(M || 0)
		s = s || 0
		_d.setUTCSeconds(s)
		_d.setUTCMilliseconds((s - floor(s)) * 1000)
		return _d.valueOf() / 1000
	} else if (isstr(y)) {
		return Date.parse(y) / 1000
	} else if (y == null) {
		return Date.now() / 1000
	} else {
		assert(false)
	}
}

// get the time at the start of the day of a given time, plus/minus a number of days.
function day(t, offset) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCMilliseconds(0)
	_d.setUTCSeconds(0)
	_d.setUTCMinutes(0)
	_d.setUTCHours(0)
	_d.setUTCDate(_d.getUTCDate() + (offset || 0))
	return _d.valueOf() / 1000
}

// get the time at the start of the month of a given time, plus/minus a number of months.
function month(t, offset) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCMilliseconds(0)
	_d.setUTCSeconds(0)
	_d.setUTCMinutes(0)
	_d.setUTCHours(0)
	_d.setUTCDate(1)
	_d.setUTCMonth(_d.getUTCMonth() + (offset || 0))
	return _d.valueOf() / 1000
}

// get the time at the start of the year of a given time, plus/minus a number of years.
function year(t, offset) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCMilliseconds(0)
	_d.setUTCSeconds(0)
	_d.setUTCMinutes(0)
	_d.setUTCHours(0)
	_d.setUTCDate(1)
	_d.setUTCMonth(0)
	_d.setUTCFullYear(_d.getUTCFullYear() + (offset || 0))
	return _d.valueOf() / 1000
}

// get the time at the start of the week of a given time, plus/minus a number of weeks.
function week(t, offset, country) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCMilliseconds(0)
	_d.setUTCSeconds(0)
	_d.setUTCMinutes(0)
	_d.setUTCHours(0)
	let days = -_d.getUTCDay() + week_start_offset(country)
	if (days > 0) days -= 7
	_d.setUTCDate(_d.getUTCDate() + days + (offset || 0) * 7)
	return _d.valueOf() / 1000
}

function days(dt) {
	if (dt == null) return null
	return dt / (3600 * 24)
}

function year_of      (t) { if (t == null) return null; _d.setTime(t * 1000); return _d.getUTCFullYear() }
function month_of     (t) { if (t == null) return null; _d.setTime(t * 1000); return _d.getUTCMonth() + 1 }
function week_day_of  (t) { if (t == null) return null; _d.setTime(t * 1000); return _d.getUTCDay() }
function month_day_of (t) { if (t == null) return null; _d.setTime(t * 1000); return _d.getUTCDate() }
function hours_of     (t) { if (t == null) return null; _d.setTime(t * 1000); return _d.getUTCHours() }
function minutes_of   (t) { if (t == null) return null; _d.setTime(t * 1000); return _d.getUTCMinutes() }
function seconds_of   (t) { if (t == null) return null; _d.setTime(t * 1000); return _d.getUTCSeconds() }

function set_year(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCFullYear(x)
	return _d.valueOf() / 1000
}

function set_month(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCMonth(x - 1)
	return _d.valueOf() / 1000
}

function set_month_day(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCDate(x)
	return _d.valueOf() / 1000
}

function set_hours(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCHours(x)
	return _d.valueOf() / 1000
}

function set_minutes(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCMinutes(x)
	return _d.valueOf() / 1000
}

function set_seconds(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCSeconds(x)
	return _d.valueOf() / 1000
}

{
	let weekday_names = memoize(function(locale1) {
		let wd = {short: obj(), long: obj()}
		for (let i = 0; i < 7; i++) {
			_d.setTime(1000 * 3600 * 24 * (3 + i))
			for (let how of ['short', 'long'])
				wd[how][i] = _d.toLocaleDateString(locale1 || locale(), {weekday: how, timeZone: 'UTC'})
		}
		return wd
	})

	function weekday_name(t, how, locale1) {
		if (t == null) return null
		_d.setTime(t * 1000)
		let wd = _d.getDay()
		return weekday_names(locale1 || locale())[how || 'short'][wd]
	}

	function month_name(t, how, locale1) {
		if (t == null) return null
		_d.setTime(t * 1000)
		return _d.toLocaleDateString(locale1 || locale(), {month: how || 'short'})
	}

	function month_year(t, how, locale1) {
		if (t == null) return null
		_d.setTime(t * 1000)
		return _d.toLocaleDateString(locale1 || locale(), {month: how || 'short', year: 'numeric'})
	}
}

{
let wso = { // fri:1, sat:2, sun:3
	MV:1,
	AE:2,AF:2,BH:2,DJ:2,DZ:2,EG:2,IQ:2,IR:2,JO:2,KW:2,LY:2,OM:2,QA:2,SD:2,SY:2,
	AG:3,AS:3,AU:3,BD:3,BR:3,BS:3,BT:3,BW:3,BZ:3,CA:3,CN:3,CO:3,DM:3,DO:3,ET:3,
	GT:3,GU:3,HK:3,HN:3,ID:3,IL:3,IN:3,JM:3,JP:3,KE:3,KH:3,KR:3,LA:3,MH:3,MM:3,
	MO:3,MT:3,MX:3,MZ:3,NI:3,NP:3,PA:3,PE:3,PH:3,PK:3,PR:3,PT:3,PY:3,SA:3,SG:3,
	SV:3,TH:3,TT:3,TW:3,UM:3,US:3,VE:3,VI:3,WS:3,YE:3,ZA:3,ZW:3,
}
function week_start_offset(country1) {
	return (wso[country1 || country()] || 4) - 3
}
}

{
let date_parts = memoize(function(locale) {
	if (locale == 'SQL') { // yyyy-mm-dd
		let m = {type: 'literal', value: '-'}
		return [{type: 'year'}, m, {type: 'month', value: 'xx'}, m, {type: 'day', value: 'xx'}]
	}
	let dtf = new Intl.DateTimeFormat(locale)
	return dtf.formatToParts(0)
})
let date_parser = memoize(function(locale) {
	let yi, mi, di
	let i = 1
	for (let p of date_parts(locale)) {
		if (p.type == 'day'  ) di = i++
		if (p.type == 'month') mi = i++
		if (p.type == 'year' ) yi = i++
	}
	let t1_re = /^(.*?)\s*(\d+)\s*:\s*(\d+)\s*:\s*([\.\d]+)$/;
	let t2_re = /^(.*?)\s*(\d+)\s*:\s*(\d+)$/;
	let d_re  = /^(\d+)[^\d]+(\d+)[^\d]+(\d+)$/;
	return function(s, validate) {
		s = s.trim()
		let tm = t1_re.exec(s) || t2_re.exec(s)
		s = tm ? tm[1] : s
		let dm = d_re.exec(s)
		if (!dm)
			return null
		let y = num(dm[yi])
		let m = num(dm[mi])
		let d = num(dm[di])
		if (tm) {
			let H = num(tm[2])
			let M = num(tm[3])
			let S = num(tm[4])
			let t = time(y, m, d, H, M, S)
			if (validate)
				if (year_of(t) != y || month_of(t) != m || month_day_of(t) != d
						|| hours_of(t) != H || minutes_of(t) != M || seconds_of(t) != S)
					return null
			return t
		} else {
			let t = time(y, m, d)
			if (validate)
				if (year_of(t) != y || month_of(t) != m || month_day_of(t) != d)
					return null
			return t
		}
	}
})
let date_formatter = memoize(function(locale) {
	let a = []
	let yi, mi, di, Hi, Mi, Si
	let dd, md
	let i = 0
	for (let p of date_parts(locale)) {
		if (p.type == 'day'    ) { dd = p.value.length; di = i++; }
		if (p.type == 'month'  ) { md = p.value.length; mi = i++; }
		if (p.type == 'year'   ) yi = i++
		if (p.type == 'literal') a[i++] = p.value
	}
	let a1 = a.slice()
	a1[i++] = ' '
	Hi = i++; a1[i++] = ':'
	Mi = i++; a1[i++] = ':'
	Si = i++;
	let a2 = a1.slice(0, -2) // without seconds
	return function(t, with_time, with_seconds) {
		// if this is slow, see
		//   http://git.musl-libc.org/cgit/musl/tree/src/time/__secs_to_tm.c?h=v0.9.15
		_d.setTime(t * 1000)
		let y = _d.getUTCFullYear()
		let m = _d.getUTCMonth() + 1
		let d = _d.getUTCDate()
		let H = _d.getUTCHours()
		let M = _d.getUTCMinutes()
		let S = _d.getUTCSeconds()
		if (m < 10 && md > 1) m = '0'+m
		if (d < 10 && dd > 1) d = '0'+d
		if (with_seconds) {
			if (H < 10) H = '0'+H
			if (M < 10) M = '0'+M
			if (S < 10) S = '0'+S
			a1[yi] = y
			a1[mi] = m
			a1[di] = d
			a1[Hi] = H
			a1[Mi] = M
			a1[Si] = S
			return a1.join('')
		} else if (with_time) {
			if (H < 10) H = '0'+H
			if (M < 10) M = '0'+M
			a2[yi] = y
			a2[mi] = m
			a2[di] = d
			a2[Hi] = H
			a2[Mi] = M
			return a2.join('')
		} else {
			a[yi] = y
         a[mi] = m
         a[di] = d
			return a.join('')
		}
	}
})

method(String, 'parse_date', function(locale1, validate) {
	return date_parser(locale1 || locale())(this, validate)
})

method(Number, 'date', function(locale1, with_time, with_seconds) {
	return date_formatter(locale1 || locale())(this, with_time, with_seconds)
})

}

// time formatting -----------------------------------------------------------

{
let a = []
method(Number, 'duration', function(format) {  // approx[+s] | long | null
	let ss = this
	let s = abs(this)
	if (format == 'approx') {
		if (s > 2 * 365 * 24 * 3600)
			return S('n_years', '{0} years', ss / (365 * 24 * 3600).dec())
		else if (s > 2 * 30.5 * 24 * 3600)
			return S('n_months', '{0} months', (ss / (30.5 * 24 * 3600)).dec())
		else if (s > 1.5 * 24 * 3600)
			return S('n_days', '{0} days', (ss / (24 * 3600)).dec())
		else if (s > 2 * 3600)
			return S('n_hours', '{0} hours', (ss / 3600).dec())
		else if (s > 2 * 60)
			return S('n_minutes', '{0} minutes', (ss / 60).dec())
		else if (s >= 60)
			return S('one_minute', '1 minute')
		else if (format == 'approx+s')
			return S('n_seconds', '{0} seconds', ss.dec())
		else
			return S('seconds', 'seconds')
	} else {
		let d = floor(s / (24 * 3600))
		s -= d * 24 * 3600
		let h = floor(s / 3600)
		s -= h * 3600
		let m = floor(s / 60)
		s -= m * 60
		s = floor(s)
		a.length = 0
		if (format == 'long') {
			if (d) { a.push(d); a.push(abs(d) > 1 ? S('days'   , 'days'   ) : S('day'   , 'day'   )); }
			if (h) { a.push(h); a.push(abs(d) > 1 ? S('hours'  , 'hours'  ) : S('hour'  , 'hour'  )); }
			if (m) { a.push(m); a.push(abs(d) > 1 ? S('minutes', 'minutes') : S('minute', 'minute')); }
			if (s || !a.length) { a.push(s); a.push(S('seconds', 'seconds')); }
			return (ss < 0 ? '-' : '') + a.join(' ')
		} else {
			if (d               ) { a.push(d                               + S('days_short'   , 'd')); }
			if (d || h          ) { a.push(h.base(10, d           ? 2 : 0) + S('hours_short'  , 'h')); }
			if (d || h || m     ) { a.push(m.base(10, d || h      ? 2 : 0) + S('minutes_short', 'm')); }
			if (1               ) { a.push(s.base(10, d || h || m ? 2 : 0) + S('seconds_short', 's')); }
			return (ss < 0 ? '-' : '') + a.join(' ')
		}
	}
})
}

method(Number, 'timeago', function() {
	let d = time() - this
	return (d > -1 ? S('time_ago', '{0} ago') : S('in_time', 'in {0}'))
		.subst(abs(d).duration('approx'))
})

// file size formatting ------------------------------------------------------

{
let suffixes = ['B', 'K', 'M', 'G', 'T', 'P', 'E']
let magnitudes = {K: 1, M: 2, G: 3, T: 4, P: 5, E: 6}
method(Number, 'kbytes', function(dec, mag) {
	dec = dec || 0
	let i = mag ? magnitudes[mag] : clamp(floor(logbase(this, 1024)), 0, suffixes.length-1)
	let z = this / 1024**i
	return z.dec(dec) + suffixes[i]
})
}

{
let suffixes = ['', 'K', 'M', 'G', 'T', 'P', 'E']
let magnitudes = {K: 1, M: 2, G: 3, T: 4, P: 5, E: 6}
method(Number, 'kcount', function(dec, mag, mul) {
	dec = dec || 0
	let i = mag ? magnitudes[mag] : clamp(floor(logbase(this, 1000)), 0, suffixes.length-1)
	let z = this / 1000**i
	return z.dec(dec) + suffixes[i]
})
}

// colors --------------------------------------------------------------------

{

let h2rgb = function(m1, m2, h) {
	if (h < 0) h = h+1
	if (h > 1) h = h-1
	if (h*6 < 1)
		return m1+(m2-m1)*h*6
	else if (h*2 < 1)
		return m2
	else if (h*3 < 2)
		return m1+(m2-m1)*(2/3-h)*6
	else
		return m1
}

let hex = x => round(255 * x).base(16, 2)

// hsla is in (0..360, 0..1, 0..1, 0..1); rgb is #rrggbb
function hsl_to_rgb(h, s, L, a) {
	h = h / 360
	let m2 = L <= .5 ? L*(s+1) : L+s-L*s
	let m1 = L*2-m2
	return '#' +
		hex(h2rgb(m1, m2, h+1/3)) +
		hex(h2rgb(m1, m2, h)) +
		hex(h2rgb(m1, m2, h-1/3)) + (a ? hex(a) : '')
}

}

// geometry ------------------------------------------------------------------

// point at a specified angle on a circle.
function point_around(cx, cy, r, angle) {
	angle = rad * angle
	return [
		cx + cos(angle) * r,
		cy + sin(angle) * r
	]
}

function clip_rect(x1, y1, w1, h1, x2, y2, w2, h2) {
	// intersect on each dimension
	// intersect_segs(ax1, ax2, bx1, bx2) => [max(ax1, bx1), min(ax2, bx2)]
	// intersect_segs(x1, x1+w1, x2, x2+w2)
	// intersect_segs(y1, y1+h1, y2, y2+h2)
	let _x1 = max(x1   , x2)
	let _x2 = min(x1+w1, x2+w2)
	let _y1 = max(y1   , y2)
	let _y2 = min(y1+h1, y2+h2)
	// clamp size
	let _w = max(_x2-_x1, 0)
	let _h = max(_y2-_y1, 0)
	return [_x1, _y1, _w, _h]
}

// timers --------------------------------------------------------------------

function runafter(t, f) { return setTimeout(f, t * 1000) }
function runevery(t, f) { return setInterval(f, t * 1000) }
function runagainevery(t, f) { f(); return runevery(t, f) }
function clock() { return performance.now() / 1000 }

function timer(f) {
	let timer_id
	function wrapper() {
		timer_id = null
		f()
	}
	return function(t) {
		if (timer_id != null) {
			clearTimeout(timer_id)
			timer_id = null
		}
		if (t != null && t !== false)
			timer_id = runafter(t, wrapper)
	}
}

// serialization -------------------------------------------------------------

json_arg = (s) => isstr(s) ? JSON.parse(s) : s
json = JSON.stringify

// clipboard -----------------------------------------------------------------

function copy_to_clipboard(text, done) {
	return navigator.clipboard.writeText(text).then(done)
}

// local storage -------------------------------------------------------------

function save(key, s) {
	localStorage.setItem(key, s)
}

function load(key) {
	return localStorage.getItem(key)
}

// URL parsing & formatting --------------------------------------------------

function url_parse(s) {

	if (!isstr(s))
		return s

	let path, query, fragment

	{
		let i = s.indexOf('#')
		if (i > -1) {
			fragment = path.substring(i + 1)
			path = s.substring(0, i)
		} else
			path = s
	}

	{
		let i = path.indexOf('?')
		if (i > -1) {
			query = path.substring(i + 1)
			path = path.substring(0, i)
		}
	}

	let a = path.split('/')
	for (let i = 0; i < a.length; i++)
		a[i] = decodeURIComponent(a[i])

	let t = obj()
	if (query !== undefined) {
		let args = query.split('&')
		for (let i = 0; i < args.length; i++) {
			let kv = args[i].split('=')
			let k = decodeURIComponent(kv[0])
			let v = kv.length == 1 ? true : decodeURIComponent(kv[1])
			if (t[k] !== undefined) {
				if (isarray(t[k]))
					t[k] = [t[k]]
				t[k].push(v)
			} else {
				t[k] = v
			}
		}
	}

	return {path: path, segments: a, query: query, args: t, fragment: fragment}
}

// TODO: this only works on urls without scheme and host !
function url_format(t) {

	if (!isobject(t))
		return t

	let path, args, fragment

	let segments = isarray(t) ? t : t.segments
	if (segments) {
		let a = []
		for (let i = 0; i < segments.length; i++)
			a[i] = encodeURIComponent(segments[i])
		path = a.join('/')
	} else
		path = t.path

	if (t.args) {
		let a = []
		let pkeys = keys(t.args).sort()
		for (let i = 0; i < pkeys.length; i++) {
			let pk = pkeys[i]
			let k = encodeURIComponent(pk)
			let v = t.args[pk]
			if (isarray(v)) {
				for (let j = 0; j < v.length; j++) {
					let z = v[j]
					let kv = k + (z !== true ? '=' + encodeURIComponent(z) : '')
					a.push(kv)
				}
			} else if (v != null) {
				let kv = k + (v !== true ? '=' + encodeURIComponent(v) : '')
				a.push(kv)
			}
		}
		args = a.join('&')
	} else
		args = t.args

	return path + (args ? '?' + args : '') + (fragment ? '#' + fragment : '')
}

/* events ----------------------------------------------------------------- */

{
let callers = obj()
let installers = obj()

DEBUG_EVENTS = false

etrack = DEBUG_EVENTS && new Map()

let log_add_event = function(target, name, f, capture) {
	if (target.initialized === null) // skip handlers added in the constructor.
		return
	capture = !!capture
	let ft = attr(attr(attr(etrack, name, map), target, map), capture, map)
	if (!ft.has(f))
		ft.set(f, stacktrace())
	else
		debug('on duplicate', name, capture)
}

let log_remove_event = function(target, name, f, capture) {
	capture = !!capture
	let t = etrack.get(name)
	let tt = t && t.get(target)
	let ft = tt && tt.get(capture)
	if (ft && ft.has(f)) {
		ft.delete(f)
		if (!ft.size) {
			tt.delete(target)
			if (!tt.size)
				t.delete(name)
		}
	} else {
		warn('off without on', name, capture)
	}
}

let hidden_events = {prop_changed: 1, attr_changed: 1, stopped_event: 1}

function passthrough_caller(ev, f) {
	if (isobject(ev.detail) && ev.detail.args) {
		//if (!(ev.type in hidden_events))
		//debug(ev.type, ...ev.detail.args)
		return f.call(this, ...ev.detail.args, ev)
	} else
		return f.call(this, ev)
}

let on = function(name, f, enable, capture) {
	assert(enable === undefined || typeof enable == 'boolean')
	if (enable == false) {
		this.off(name, f, capture)
		return
	}
	let install = installers[name]
	if (install)
		install.call(this)
	let listener
	if (name.starts('raw:')) { // raw handler
		name = name.slice(4)
		listener = f
	} else {
		listener = f.listener
		if (!listener) {
			let caller = callers[name] || passthrough_caller
			listener = function(ev) {
				let ret = caller.call(this, ev, f)
				if (ret === false) { // like jquery
					ev.preventDefault()
					ev.stopPropagation()
					ev.stopImmediatePropagation()
				}
			}
			f.listener = listener
		}
	}
	if (DEBUG_EVENTS)
		log_add_event(this, name, listener, capture)
	this.addEventListener(name, listener, capture)
}

let off = function(name, f, capture) {
	let listener = f.listener || f
	if (DEBUG_EVENTS)
		log_remove_event(this, name, listener, capture)
	this.removeEventListener(name, listener, capture)
}

let once = function(name, f, enable, capture) {
	if (enable == false) {
		this.off(name, f, capture)
		return
	}
	let wrapper = function(...args) {
		let ret = f(...args)
		this.off(name, wrapper, capture)
		return ret
	}
	this.on(name, wrapper, true, capture)
	f.listener = wrapper.listener // so it can be off'ed.
}

let ev = obj()
let ep = obj()
let log_fire = DEBUG_EVENTS && function(e) {
	ev[e.type] = (ev[e.type] || 0) + 1
	if (e.type == 'prop_changed') {
		let k = e.detail.args[1]
		ep[k] = (ep[k] || 0) + 1
	}
	return e
} || return_arg

function event(name, bubbles, ...args) {
	return typeof name == 'string'
		? new CustomEvent(name, {detail: {args}, cancelable: true, bubbles: bubbles})
		: name
}

let fire = function(name, ...args) {
	let e = log_fire(event(name, false, ...args))
	return this.dispatchEvent(e)
}

let fireup = function(name, ...args) {
	let e = log_fire(event(name, true, ...args))
	return this.dispatchEvent(e)
}

method(EventTarget, 'on'     , on)
method(EventTarget, 'off'    , off)
method(EventTarget, 'once'   , once)
method(EventTarget, 'fire'   , fire)
method(EventTarget, 'fireup' , fireup)

on.installers = installers
on.callers = callers
}

/* AJAX requests -------------------------------------------------------------

	ajax(opt) -> req
		opt.url
		opt.upload: object (sent as json) | s
		opt.timeout (browser default)
		opt.method ('POST' or 'GET' based on req.upload)
		opt.slow_timeout (4)
		opt.headers: {h->v}
		opt.user
		opt.pass
		opt.async (true)
		opt.dont_send (false)
		opt.notify: widget to send 'load' events to.
		opt.notify_error: error notify function: f(message, 'error').
		opt.onchunk: f(s, finished) [-> false]

	req.send()
	req.abort()

	^slow(show|hide)
	^progress(p, loaded, [total])
	^upload_progress(p, loaded, [total])
	^success(res)
	^fail(error, 'timeout'|'network'|'abort')
	^fail(error, 'http', status, message, content)
	^done('success' | 'fail', ...)

	ajax.notify_error: default error notify function (to be set by user).
	ajax.notify_notify: default notify function for json results containing
	  a field called `notify` (to be set by user).

*/
function ajax(req) {

	req = assign_opt(new EventTarget(), {slow_timeout: 4}, req)

	let xhr = new XMLHttpRequest()

	let method = req.method || (req.upload ? 'POST' : 'GET')
	let async = req.async !== false // NOTE: this is deprecated but that's ok.

	xhr.open(method, url_format(req.url), async, req.user, req.pass)

	let upload = req.upload
	if (isobj(upload) || isarray(upload)) {
		upload = json(upload)
		xhr.setRequestHeader('content-type', 'application/json')
	}

	if (async)
		xhr.timeout = (req.timeout || 0) * 1000

	if (req.headers)
		for (let h in req.headers)
			xhr.setRequestHeader(h, req.headers[h])

	let slow_watch

	function stop_slow_watch() {
		if (slow_watch) {
			clearTimeout(slow_watch)
			slow_watch = null
		}
		if (slow_watch === false) {
			fire('slow', false)
			slow_watch = null
		}
	}

	function slow_expired() {
		fire('slow', true)
		slow_watch = false
	}

	req.send = function() {
		fire('start')
		slow_watch = runafter(req.slow_timeout, slow_expired)
		xhr.send(upload)
		return req
	}

	req.send_async = function() {
		return new Promise(function(resolve, reject) {
			on('done', function(...args) {
				resolve(args)
			})
			req.send()
		})
	}

	// NOTE: only Firefox fires progress events on non-200 responses.
	xhr.onprogress = function(ev) {
		if (ev.loaded > 0)
			stop_slow_watch()
		let p = ev.lengthComputable ? ev.loaded / ev.total : .5
		fire('progress', p, ev.loaded, ev.total)
	}

	xhr.upload.onprogress = function(ev) {
		if (ev.loaded > 0)
			stop_slow_watch()
		let p = ev.lengthComputable ? ev.loaded / ev.total : .5
		fire('upload_progress', p, ev.loaded, ev.total)
	}

	xhr.ontimeout = function() {
		req.failtype = 'timeout'
		fire('done', 'fail', req.error_message('timeout'), 'timeout')
	}

	// NOTE: only fired on network errors like connection refused!
	xhr.onerror = function() {
		req.failtype = 'network'
		fire('done', 'fail', req.error_message('network'), 'network')
	}

	xhr.onabort = function() {
		req.failtype = 'abort'
		fire('done', 'fail', null, 'abort')
	}

	xhr.onreadystatechange = function(ev) {
		if (xhr.readyState > 1)
			stop_slow_watch()
		if (xhr.readyState > 2 && req.onchunk)
			if (req.onchunk(xhr.response, xhr.readyState == 4) === false)
				req.abort()
		if (xhr.readyState == 4) {
			let status = xhr.status
			if (status) { // status is 0 for network errors, incl. timeout.
				let res = xhr.response
				if (!xhr.responseType || xhr.responseType == 'text')
					if (xhr.getResponseHeader('content-type') == 'application/json' && res)
						res = json_arg(res)
				req.response = res
				if (status == 200) {
					fire('done', 'success', res)
				} else {
					req.failtype = 'http'
					let status_message = xhr.statusText
					fire('done', 'fail',
						req.error_message('http', status, status_message, res),
						'http', status, status_message, res)
				}
			}
		}
	}

	req.abort = function() {
		xhr.abort()
		return req
	}

	function fire(name, arg1, ...rest) {

		if (name == 'done')
			fire(arg1, ...rest)

		if (req.fire(name, arg1, ...rest)) {
			if (name == 'fail' && arg1)
				(req.notify_error || ajax.notify_error || noop)(arg1, ...rest)
			if (name == 'success' && isobject(arg1) && isstr(arg1.notify))
				(req.notify_notify || ajax.notify_notify || noop)(arg1.notify, arg1.notify_kind)
		}

		if (req[name])
			req[name](arg1, ...rest)

		let notify = req.notify instanceof EventTarget ? [req.notify] : req.notify
		if (isarray(notify))
			for (target of notify) {
				target.fire('load', name, arg1, ...rest)
			}

	}

	req.xhr = xhr

	req.error_message = function(type, status, status_message, content) {
		if (type == 'http') {
			return S('error_http', '{error}', {
				status: status,
				status_message: status_message,
				error: (isobj(content) ? content.error : content) || status_message,
			})
		} else if (type == 'network') {
			return S('error_network', 'Network error')
		} else if (type == 'timeout') {
			return S('error_timeout', 'Timed out')
		}
	}

	if (!req.dont_send)
		req.send()

	return req
}

function get(url, success, fail, opt) {
	return ajax(assign({
		url: url,
		method: 'GET',
		success: success,
		fail: fail,
	}, opt))
}

function post(url, upload, success, fail, opt) {
	return ajax(assign({
		url: url,
		method: 'POST',
		upload: upload,
		success: success,
		fail: fail,
	}, opt))
}

Firefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1
