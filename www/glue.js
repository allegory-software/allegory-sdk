/*

	JavaScript "assorted lengths of wire" library.
	Written by Cosmin Apreutesei. Public domain.

BROWSER DETECTION

	Firefox Chrome Safari Safari_min Safari_maj

TYPE CHECKING

	isobject(e)
	isarray(a)
	isobj(t)
	isstr(s)
	isnum(n)
	isbool(b)
	isfunc(f)

LOGIC

	strict_or(x, z)
	repl(x, v, z)

TYPE CONVERSIONS

	num(s) -> n
	str(v) -> s
	bool(s) -> b
	null_bool(s) -> b | null
	bool_attr(s[, z]) -> b | z

MATH

	inf
	floor(x) ceil(x) round(x) snap(x, p)
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
	mod(a, b)
	nextpow2(x)
	x.dec([decimals])
	x.base([base], [digits])

CALLBACKS

	noop
	return_true
	return_false
	return_arg
	wrap(inherited, f) -> f'
	do_before(inherited, f) -> f'
	do_after(inherited, f) -> f'

ERRORS

	pr[int](...)
	warn(...)
	warn_if(cond, ...) -> cond
	debug(...)
	trace(...)
	debug_if(cond, ...)
	trace_if(cond, ...)
	assert(v, err, ...) -> v
	stacktrace()

EXTENDING BUILT-IN OBJECTS

	property(class|instance, prop, descriptor | get,set)
	method(class|instance, method, func)
	override(class|instance, method, func)
	alias(class|instance, new_name, old_name)
	override_property_setter(class|instance, prop, set)

STRINGS

	s.subst('{0} {1}', a0, a1, ...)
	s.starts(s)
	s.ends(s)
	s.upper()   upper(s)
	s.lower()   lower(s)
	s.len
	s.num()
	s.display_name()
	s.lower_ai_ci()
	s.find_ai_ci(s)
	s.words() -> a
	words(s) -> a|null
	e.wordset() -> {word1: true, ...}
	wordset(s) -> {word1: true, ...}|null
	catany(sep, ...); sep.catany(...)
	catall(...)
	s.captures(re) -> [capture1, ...]

ARRAYS

	array(...) -> a                        new Array(...)
	empty_array -> []                      global empty array, read-only!
	range(i, j, step, f) -> a
	a.slice()                              overall fastest way to copy on FF & Chrome
	a.set(a1) -> s
	a.extend(a1) -> a
	a.insert(i, v) -> a
	a.remove(i) -> v
	a.remove_value(v) -> i
	a.remove_values(cond) -> a
	a.last
	a.len
	a.equals(b, [i1], [i2]) -> t|f
	a.binsearch(v, cmp, i1, i2)
	a.each(f)
	a.tokeys([v], [cons]) -> t
	tokeys(a, [v], [cons]) -> t|null
	a.uniq_sorted() -> a
	a.remove_duplicates() -> a

HASH MAPS

	obj() -> o                      create a native map, string keys only
	set(iter) -> m                  create a set, holds all types
	s.addset(s2) -> s               dump set into set
	s.set(s2) -> s                  set elements to s'
	s.toarray() -> [v1,...]         array of elements in insert order
	s.equals(s2[, same_order]) -> t|f    compare sets
	map(iter) -> m                  create a map, keys and values can be of any type
	m.first_key
	empty -> {}                     global empty object, inherits Object
	empty_obj -> obj()              global empty object, does not inherit Object
	empty_set -> set()              global empty set, read-only!
	keys(t) -> [k1, ...]
	assign(dt, t1, ...)             dump t1, ... into dt
	assign_opt(dt, t1, ...)         dump t1, ... into dt, skips undefined values
	attr(t, k[, cons])              t[k] = t[k] || cons(); cons defaults to obj
	memoize(f)
	count_keys(t, [max_n]) -> n     count keys in t up-to max_n
	first_key(t) -> k

TYPED ARRAYS

	[dyn_][f32|i8|u8|i16|u16|i32|u32]arr(arr|[...]|capacity, [nc]) -> [dyn]arr
		.set(in_arr, [offset=0], [len], [in_offset=0])
		.invalidate([offset=0], [len])
		.grow(cap, [preserve_contents=true], [pow2=true])
		.grow_type(arr_type|max_index|[...]|arr, [preserve_contents=true])
		.setlen(len)

DATE/TIME CALCULATIONS

	time() -> ts
	time(y, m, d, H, M, s, ms) -> ts
	time(date_str) -> ts
	[day|month|year|week](ts[, offset], [local]) -> ts
	days(delta_ts) -> ds
	[year|month|week_day|month_day|hours|minutes|seconds]_of(ts, [local]) -> n
	set_[year|month|month_day|hours|minutes|seconds](ts, n)
	week_start_offset([country])

DATE/TIME FORMATTING

	locale()

	weekday_name (ts, ['long'], [locale])
	month_name   (ts, ['long'], [locale])
	month_year   (ts, ['long'], [locale])

	format_timeofday(ds, ['s|ms']) -> s
	format_date(ts, [locale], ['d|s|ms']) -> s
	format_duration(ds, ['approx[+s]'|'long']) -> s
	format_timeago(ts) -> s

DATE/TIME PARSING

	parse_date(s, [locale], [validate], ['d|s|ms']) -> ts
	parse_timeofday(s, [validate], ['s|ms']) -> ds
	parse_duration(s) -> ds

	date_placeholder_text([locale])

FILE SIZE FORMATTING

	x.kbytes(x, [dec], [mag], [mul = 1024]) -> s

COLORS

	hsl_to_rgb(h, s, L) -> '#rrggbb'

GEOMETRY

	point_around(cx, cy, r, angle) -> [x, y]
	clip_rect(x1, y1, w1, h1, x2, y2, w2, h2, [out]) -> [x, y, w, h]
	rect_intersects(x1, y1, w1, h1, x2, y2, w2, h2) -> t|f

TIMERS

	runafter(t, f) -> tid
	runevery(t, f) -> tid
	runagainevery(t, f) -> tid
	clock()
	timer(f) -> tm; tm(t) to rearm; tm() to cancel; tm(true) to rearm to last duration.

SERIALIZATION

	[try_]json_arg(s) -> t
	json(t) -> s

CLIPBOARD

	copy_to_clipboard(text, done_func)

LOCAL STORAGE

	save(key, [s])
	load(key) -> s

URL DECODING, ENCODING AND UPDATING

	url_parse(s) -> t
	url_format(t) -> s

EVENTS

	event(name|ev, [bubbles], ...args) -> ev
	e.on   (name|ev[, element], f, [enable], [capture])
	e.off  (name|ev, f, [capture])
	e.once (name|ev, f, [enable], [capture])
	e.fire    (name, ...args)
	e.fireup  (name, ...args)
	on   ([id, ]name|ev, f, [enable], [capture])
	ev.forward(e)
	listener() -> ls
		ls.on(event, f, enable, capture)
		ls.on_bind(f)
		ls.target
		ls.target_id
		ls.enabled
	event_installers.EVENT = f() { ... }
	event_callers.EVENT = f(ev, f) { return f.call(this, ...) }
	DEBUG_EVENTS = false
	DEBUG_EVENTS_FIRE = false

FAST GLOBAL EVENTS

	listen(event, f, [on])
	announce(event, ...args)

INTER-WINDOW COMMUNICATION

	broadcast(name, ...args)
	setglobal(name, val)
	^window.global_changed(name, v, v0)
	^window.NAME_changed(v, v0)

MULTI-LANGUAGE STUBS

	S(id, default)                         get labeled string in current language
	lang()                                 get current language
	country()                              get current country
	href(url, [lang])                      rewrite URL for (current) language

AJAX REQUESTS

	ajax(opt) -> req
	get(url, success, [error], [opt]) -> req
	post(url, data, [success], [error], [opt]) -> req

JS LINTING

	lint([js_file], [lint_options])

*/

(function () {
"use strict"
let G = window

G.DEBUG = function(k, dv) {
	dv = dv ?? false
	if (!(k in G))
		G[k] = dv
	if (G[k] !== dv)
		console.log(k, G[k])
}

DEBUG('DEBUG_EVENTS')
DEBUG('DEBUG_EVENTS_FIRE')
DEBUG('DEBUG_AJAX')

// browser detection ---------------------------------------------------------

{
let ua = navigator.userAgent.toLowerCase()
G.Firefox = ua.includes('firefox')
G.Chrome  = ua.includes('chrome')
G.Safari  = ua.includes('safari') && !Chrome
if (Safari) {
	// Safari is by far the shittiest browser that doesn't even have auto-update
	// so you might need this so you can give the finger to those poor bastards
	// who haven't yet bought this years's hardware so they can have this year's
	// OS which ships with this year's Safari.
	let m = ua.match(/version\/(\d+)\.(\d+)/)
	G.Safari_maj = m && parseFloat(m[1])
	G.Safari_min = m && parseFloat(m[2])
}
}

// types ---------------------------------------------------------------------

G.isobject = e => e != null && typeof e == 'object' // includes arrays, HTMLElements, etc.
G.isarray = Array.isArray
G.isobj = t => isobject(t) && (t.constructor == Object || t.constructor === undefined)
G.isstr = s => typeof s == 'string'
G.isnum = n => typeof n == 'number'
G.isbool = b => typeof b == 'boolean'
G.isfunc = f => typeof f == 'function'

// logic ---------------------------------------------------------------------

// non-shortcircuiting `||` operator for which only `undefined` is falsey.
G.strict_or = function(x, z) { return x !== undefined ? x : z }

// single-value filter.
G.repl = function(x, v, z) { return x === v ? z : x }

// type conversion -----------------------------------------------------------

G.num = function(s) {
	let x = parseFloat(s)
	return x != x ? undefined : x
}

G.bool = b => !!b
G.null_bool = b => b != null ? !!b : null

// parse a bool html attr value.
// NOTE: returns z or undefined for failure.
G.bool_attr = function(s, z) {
	if (s == 'false') return false
	if (s == '') return true
	if (s == 'true') return true
	return z
}

G.str = String

// math ----------------------------------------------------------------------

G.inf = Infinity
G.floor = Math.floor // rounds towards -1/0
G.ceil = Math.ceil
G.round = Math.round
G.snap = (x, p) => round(x / p) * p
G.trunc = Math.trunc // rounds towards 0
G.abs = Math.abs
G.min = Math.min
G.max = Math.max
G.sqrt = Math.sqrt
G.ln = Math.log
G.log10 = Math.log10
G.logbase = (x, base) => ln(x) / ln(base)
G.random = Math.random
G.sign = Math.sign

// NOTE: returns x1 if x1 < x0, which enables the idiom
// `a[clamp(i, 0, b.length-1)]` to return undefined when b is empty.
G.clamp = function(x, x0, x1) {
	return min(max(x, x0 ?? -1/0), x1 ?? 1/0)
}

// sign() that only returns -1 or 1, never 0, and returns -1 for -0.
G.strict_sign = function(x) {
	return 1/x == 1/-0 ? -1 : (x >= 0 ? 1 : -1)
}

G.lerp = function(x, x0, x1, y0, y1) {
	return y0 + (x-x0) * ((y1-y0) / (x1 - x0))
}

// % that works with negative numbers.
G.mod = function(a, b) {
	return (a % b + b) % b
}

G.nextpow2 = function(x) {
	return max(0, 2**(ceil(ln(x) / ln(2))))
}

G.PI  = Math.PI
G.sin = Math.sin
G.cos = Math.cos
G.tan = Math.tan
G.rad = PI / 180
G.deg = 180 / PI

G.asin  = Math.asin
G.acos  = Math.acos
G.atan  = Math.atan
G.atan2 = Math.atan2

Number.prototype.base = function(base, digits) {
	let s = this.toString(base)
	if (digits != null)
		s = s.padStart(digits, '0')
	return s
}
Number.prototype.dec = Number.prototype.toFixed

// callbacks -----------------------------------------------------------------

G.noop = function() {}
G.return_true = function() { return true; }
G.return_false = function() { return false; }
G.return_arg = function(arg) { return arg; }

G.wrap = function(inherited, func) {
	inherited = inherited || noop
	return function(...args) {
		return func.call(this, inherited, ...args)
	}
}

G.do_before = function(inherited, func) {
	return repl(inherited, noop) && function(...args) {
		func.call(this, ...args)
		inherited.call(this, ...args)
	} || func
}

G.do_after = function(inherited, func) {
	return repl(inherited, noop) && function(...args) {
		inherited.call(this, ...args)
		func.call(this, ...args)
	} || func
}

// error handling ------------------------------------------------------------

G.print = null
G.pr    = console.log
G.warn  = console.warn
G.debug = console.log // console.debug makes everything blue wtf.
G.trace = console.trace

G.warn_if = function(cond, ...args) {
	if (!cond) return
	warn(...args)
	return cond
}

G.trace_if = function(cond, ...args) {
	if (!cond) return
	console.trace(...args)
}

G.debug_if = function(cond, ...args) {
	if (!cond) return
	debug(...args)
}

G.assert = function(ret, err, ...args) {
	if (ret == null || ret === false) {
		throw ((err && err.subst(...args) || 'assertion failed'))
	}
	return ret
}

/* extending built-in objects ------------------------------------------------

NOTE: built-in methods are actually "data properties" that shadow normal
methods so if we want to override one we need to replace the property.
These special kinds of methods are also non-enumerable, unlike normal
methods, which is useful if we want to extend Object without injecting
enumerables into it.

*/

// extend an object with a property, checking for upstream name clashes.
// NOTE: shadows both instance and prototype fields.
G.property = function(cls, prop, get, set) {
	let proto = cls.prototype || cls
	if (prop in proto)
		assert(false, '{0}.{1} already exists and it\'s set to: {2}',
			cls.debug_name || cls.constructor.name, prop, proto[prop])
	let descriptor = isobject(get) ? get : {get: get, set: set}
	Object.defineProperty(proto, prop, descriptor)
}

// extend an object with a method, checking for upstream name clashes.
// NOTE: shadows both instance and prototype methods!
G.method = function(cls, meth, func) {
	property(cls, meth, {
		value: func,
		enumerable: false,
	})
}

// override a method, with the ability to override a built-in method.
G.override = function(cls, meth, func) {
	let proto = cls.prototype || cls
	let inherited = proto[meth]
	assert(inherited, '{0}.{1} does not exist', cls.type || cls.name, meth)
	function wrapper(...args) {
		return func.call(this, inherited, ...args)
	}
	Object.defineProperty(proto, meth, {
		value: wrapper,
		enumerable: false,
	})
}

G.getRecursivePropertyDescriptor = function(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key)
		? Object.getOwnPropertyDescriptor(obj, key)
		: getRecursivePropertyDescriptor(Object.getPrototypeOf(obj), key)
}
method(Object, 'getPropertyDescriptor', function(key) {
	return key in this && getRecursivePropertyDescriptor(this, key)
})

G.alias = function(cls, new_name, old_name) {
	let proto = cls.prototype || cls
	let d = proto.getPropertyDescriptor(old_name)
	assert(d, '{0}.{1} does not exist', cls.type || cls.name, old_name)
	Object.defineProperty(proto, new_name, d)
}

// override a property setter in a prototype *or instance*.
G.override_property_setter = function(cls, prop, set) {
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
		return this.valueOf()
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

G.lower = s => s.lower()
G.upper = s => s.upper()

property(String, 'len', function() { return this.length })

String.prototype.num = function() {
	return num(this)
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

method(String, 'lower_ai_ci', function() {
	return this.normalize('NFKD').replace(/\p{Diacritic}/gu, '').lower()
})

method(String, 'find_ai_ci', function(s) {
	return repl(this.lower_ai_ci().indexOf(s.lower_ai_ci()), -1, null)
})

{
// concat args, skipping null ones. returns null if all args are null.
let non_null = (s) => s != null
G.catany = function(sep, ...args) {
	if (args.length == 0)
		return null
	if (args.length == 1)
		return args[0] != null ? args[0] : null
	else if (args.length == 2)
		return (
			  args[0] != null && args[1] != null ? args[0] + sep + args[1]
			: args[0] != null ? args[0]
			: args[1] != null ? args[1]
			: null
		)
	let a = args.filter(non_null)
	return a.length ? a.join(sep) : null
}
}
method(String, 'catany', function(...args) { return catany(this, ...args) })

// concat args. if any arg is null return nothing.
G.catall = function(...args) {
	for (let i = 0, n = args.length; i < n; i++)
		if (args[i] == null)
			return
	return catany('', ...args)
}

method(String, 'esc', function() {
	return this.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
})

method(String, 'words', function() {
	let s = this.trim()
	if (!s) return []
	return s.split(/\s+/)
})
G.words = s => isstr(s) ? s.words() : s

method(String, 'wordset', function() {
	return this.words().tokeys()
})
G.wordset = s => isstr(s) ? s.wordset() : s

method(String, 'captures', function(re) {
	let m = this.match(re)
	if (m) m.remove(0)
	return m || empty_array
})

// arrays --------------------------------------------------------------------

G.empty_array = []

G.range = function(i1, j, step, f) {
	step = step ?? 1
	f = f || return_arg
	let a = []
	for (let i = i1; i < j; i += step)
		a.push(f(i))
	return a
}

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
	if (i != -1)
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

property(Array, 'len', function() { return this.length }, function(n) { this.length = n })

method(Array, 'equals', function(a, i0, i1) {
	i0 = i0 || 0
	i1 = i1 || max(this.length, a.length)
	if (i1 > min(this.length, a.length))
		return false
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
	let lo = (i1 ?? 0) - 1
	let hi = (i2 ?? this.length)
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

method(Array, 'tokeys', function(v, cons) {
	v = v ?? true
	let t = cons || obj()
	for (let k of this)
		t[k] = v
	return t
})
G.tokeys = (a, v, cons) => isarray(a) ? a.tokeys(v, cons) : a

method(Array, 'uniq_sorted', function() {
	return this.remove_values(function(v, i, a) {
		return i && v == a[i-1]
	})
})

method(Array, 'remove_duplicates', function() {
	if (this.len > 40) { // go heavy after 64k iterations.. too soon?
		let s = set(this)
		this.length = 0
		for (let v of s)
			this.push(v)
		return this
	}
	return this.remove_values(function(v, i, a) {
		return a.indexOf(v) != i
	})
})

// hash maps -----------------------------------------------------------------

G.obj = () => Object.create(null)
G.set = (iter) => new Set(iter)
G.map = (iter) => new Map(iter)
G.array = (...args) => new Array(...args)

property(Map, 'first_key', function() {
	// let's hope the compiler sees this pattern and doesn't actually allocate
	// an iterator object for this.
	for (let k of this.keys())
		return k
})

method(Set, 'addset', function(s) {
	for (let k of s)
		this.add(k)
	return this
})

method(Set, 'set', function(s) {
	this.clear()
	this.addset(s)
	return this
})

method(Set, 'toarray', function() {
	return Array.from(this)
})

method(Set, 'equals', function(s2, same_order) {
	let s1 = this
	if (s1.size != s2.size)
		return false
	if (same_order) {
		let it1 = s1.values()
		let it2 = s2.values()
		for (let i = 0, n = s1.size; i < n; i++) {
			let v1 = it1.next().value
			let v2 = it2.next().value
			if (v1 != v2)
				return false
		}
	} else {
		for (let k1 of s1)
			if (!s2.has(k1))
				return false
	}
	return true
})

G.empty = {}
G.empty_obj = obj()
G.empty_set = set()

G.keys = Object.keys

G.assign = Object.assign

// like Object.assign() but skips assigning `undefined` values.
G.assign_opt = function(dt, ...ts) {
	for (let t of ts)
		if (t != null)
			for (let k in t)
				if (!t.hasOwnProperty || t.hasOwnProperty(k))
					if (t[k] !== undefined)
						dt[k] = t[k]
	return dt
}

G.attr = function(t, k, cons) {
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
G.memoize = function(f) {
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

G.count_keys = function(t, max_n) {
	let n = 0
	for (let k in t) {
		if (!t.hasOwnProperty(k))
			continue
		if (n === max_n)
			break
		n++
	}
	return n
}


G.first_key = function(t) {
	for (let k in t)
		if (t.hasOwnProperty(k))
			return k
}

// typed arrays --------------------------------------------------------------

G.f32arr = Float32Array
G.i8arr  = Int8Array
G.u8arr  = Uint8Array
G.i16arr = Int16Array
G.u16arr = Uint16Array
G.i32arr = Int32Array
G.u32arr = Uint32Array

G.max_index_from_array = function(a) {
	if (a.max_index != null) // hint
		return a.max_index
	let max_idx = 0
	for (let idx of a)
		max_idx = max(max_idx, idx)
	return max_idx
}

G.arr_type_from_max_index = function(max_idx) {
	return max_idx > 65535 && u32arr || max_idx > 255 && u16arr || u8arr
}

// for inferring the data type of gl.ELEMENT_ARRAY_BUFFER VBOs.
G.index_arr_type = function(arg) {
	if (isnum(arg)) // max_idx
		return arr_type_from_max_index(arg)
	if (isarray(arg)) // [...]
		return arr_type_from_max_index(max_index_from_array(arg))
	if (arg.BYTES_PER_ELEMENT) // arr | arr_type
		return arg.constructor.prototype == Object.getPrototypeOf(arg) ? arg.constructor : arg
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
			data_len = data.len ?? data.length
		} else {
			data_len = data.length * this.inv_nc
			assert(data_len == floor(data_len), 'source array length not multiple of {0}', this.nc)
		}
		assert(data_offset >= 0 && data_offset <= data_len, 'source offset out of range')
		len = clamp(len ?? 1/0, 0, data_len - data_offset)
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
		len = max(0, min(len ?? 1, this.len - offset))
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
		len = max(0, len ?? 1/0)
		let o2 = min(o1 + len, this.len)
		o1 = min(this.invalid_offset1 ??  1/0, o1)
		o2 = max(this.invalid_offset2 ?? -1/0, o2)
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

G.dyn_arr = function(arr_type, data_or_cap, nc) {
	return new dyn_arr_class(arr_type, data_or_cap, nc)
}

dyn_arr.index_arr_type = index_arr_type

{
let dyn_arr_func = function(arr_type) {
	return function(data_or_cap, nc) {
		return new dyn_arr_class(arr_type, data_or_cap, nc)
	}
}
G.dyn_f32arr = dyn_arr_func(f32arr)
G.dyn_i8arr  = dyn_arr_func(i8arr)
G.dyn_u8arr  = dyn_arr_func(u8arr)
G.dyn_i16arr = dyn_arr_func(i16arr)
G.dyn_u16arr = dyn_arr_func(u16arr)
G.dyn_i32arr = dyn_arr_func(i32arr)
G.dyn_u32arr = dyn_arr_func(u32arr)
}

// data structures -----------------------------------------------------------

G.freelist = function(create, init, destroy) {
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
G.freelist_stack = function(create, init, destroy) {
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

G._d = new Date() // public temporary date object.

// NOTE: months start at 1, and seconds can be fractionary.
G.time = function(y, m, d, H, M, s, local) {
	assert(!local, 'NYI')
	if (isnum(y)) {
		_d.setTime(0) // necessary to reset the time first!
		_d.setUTCFullYear(y)
		_d.setUTCMonth((m ?? 1) - 1)
		_d.setUTCDate(d ?? 1)
		_d.setUTCHours(H ?? 0)
		_d.setUTCMinutes(M ?? 0)
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
G.day = function(t, offset, local) {
	if (t == null) return null
	_d.setTime(t * 1000)
	if (local) {
		_d.setMilliseconds(0)
		_d.setSeconds(0)
		_d.setMinutes(0)
		_d.setHours(0)
		_d.setDate(_d.getDate() + (offset || 0))
	} else {
		_d.setUTCMilliseconds(0)
		_d.setUTCSeconds(0)
		_d.setUTCMinutes(0)
		_d.setUTCHours(0)
		_d.setUTCDate(_d.getUTCDate() + (offset || 0))
	}
	return _d.valueOf() / 1000
}

// get the time at the start of the month of a given time, plus/minus a number of months.
G.month = function(t, offset, local) {
	assert(!local, 'NYI')
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
G.year = function(t, offset, local) {
	assert(!local, 'NYI')
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
G.week = function(t, offset, country, local) {
	assert(!local, 'NYI')
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

G.days = function(dt) {
	if (dt == null) return null
	return dt / (3600 * 24)
}

G.year_of       = function(t, local) { if (t == null) return null; _d.setTime(t * 1000); return local ? _d.getFullYear() : _d.getUTCFullYear() }
G.month_of      = function(t, local) { if (t == null) return null; _d.setTime(t * 1000); return local ? _d.getMonth()+1  : _d.getUTCMonth()+1  }
G.week_day_of   = function(t, local) { if (t == null) return null; _d.setTime(t * 1000); return local ? _d.getDay     () : _d.getUTCDay     () }
G.month_day_of  = function(t, local) { if (t == null) return null; _d.setTime(t * 1000); return local ? _d.getDate    () : _d.getUTCDate    () }
G.hours_of      = function(t, local) { if (t == null) return null; _d.setTime(t * 1000); return local ? _d.getHours   () : _d.getUTCHours   () }
G.minutes_of    = function(t, local) { if (t == null) return null; _d.setTime(t * 1000); return local ? _d.getMinutes () : _d.getUTCMinutes () }
G.seconds_of    = function(t, local) { if (t == null) return null; _d.setTime(t * 1000); return local ? _d.getSeconds () : _d.getUTCSeconds () }

G.set_year = function(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCFullYear(x)
	return _d.valueOf() / 1000
}

G.set_month = function(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCMonth(x - 1)
	return _d.valueOf() / 1000
}

G.set_month_day = function(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCDate(x)
	return _d.valueOf() / 1000
}

G.set_hours = function(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCHours(x)
	return _d.valueOf() / 1000
}

G.set_minutes = function(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCMinutes(x)
	return _d.valueOf() / 1000
}

G.set_seconds = function(t, x) {
	if (t == null) return null
	_d.setTime(t * 1000)
	_d.setUTCSeconds(x)
	return _d.valueOf() / 1000
}

let weekday_names = memoize(function(locale1) {
	let wd = {short: obj(), long: obj()}
	for (let i = 0; i < 7; i++) {
		_d.setTime(1000 * 3600 * 24 * (3 + i))
		for (let how of ['short', 'long'])
			wd[how][i] = _d.toLocaleDateString(locale1 || locale(), {weekday: how, timeZone: 'UTC'})
	}
	return wd
})
G.weekday_name = function(t, how, locale1) {
	if (t == null) return null
	_d.setTime(t * 1000)
	let wd = _d.getDay()
	return weekday_names(locale1 || locale())[how || 'short'][wd]
}

G.month_name = function(t, how, locale1) {
	if (t == null) return null
	_d.setTime(t * 1000)
	return _d.toLocaleDateString(locale1 || locale(), {month: how || 'short'})
}

G.month_year = function(t, how, locale1) {
	if (t == null) return null
	_d.setTime(t * 1000)
	return _d.toLocaleDateString(locale1 || locale(), {month: how || 'short', year: 'numeric'})
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
G.week_start_offset = function(country1) {
	return (wso[country1 || country()] || 4) - 3
}
}

{

// NOTE: the parsers accept negative numbers in time positions to allow
// decrementing past zero, eg. `01:-1` => `00:59`. We don't allow that in
// dates because the date separator can be '-'.

let time_re = /(\-?\d+)\s*:\s*(\-?\d+)\s*(?::\s*(\-?\d+))?\s*(?:[\:\.]\s*(\-?)(\d+))?/;
let date_re = /(\d+)\s*[\-\/\.,\s]\s*(\d+)\s*[\-\/\.,\s]\s*(\d+)/;
let timeonly_re = new RegExp('^\\s*' + time_re.source + '\\s*$')
let datetime_re = new RegExp('^\\s*' + date_re.source + '(?:\\s+' + time_re.source + '\\s*)?$')

// NOTE: validate=false accepts any timestamp including negative values but still
// mods the input to the [0..24h) interval.
// NOTE: specifying less precision ignores precision parts, doesn't validate them.
// NOTE: returns undefined for failure like num().
G.parse_timeofday = function(s, validate, precision) {
	let t = s
	if (isstr(s)) {
		let tm = timeonly_re.exec(s)
		if (!tm)
			return
		precision = precision || 'ms' // defaults to highest
		let with_s  = precision == 's' || precision == 'ms'
		let with_ms = precision == 'ms'
		let H = num(tm[1])
		let M = num(tm[2])
		let S = with_s && num(tm[3]) || 0
		let fs = with_ms && tm[5] || ''
		let f = with_ms && (tm[4] ? -1 : 1) * (num(fs) ?? 0) / 10**fs.len || 0
		t = H * 3600 + M * 60 + S + f
		if (validate)
			if (hours_of(t) != H || minutes_of(t) != M || (with_s && seconds_of(t) != S))
				return
	}
	if (validate) {
		if (t < 0 || t >= 3600 * 24)
			return
	} else {
		t = mod(t, 3600 * 24)
	}
	return t
}
method(String, 'parse_timeofday', function(validate, precision) {
	return parse_timeofday(this.valueOf(), validate, precision)
})

let date_parts = memoize(function(locale) {
	if (locale == 'SQL') { // yyyy-mm-dd
		let m = {type: 'literal', value: '-'}
		return [{type: 'year'}, m, {type: 'month', value: 'xx'}, m, {type: 'day', value: 'xx'}]
	}
	let dtf = new Intl.DateTimeFormat(locale)
	return dtf.formatToParts(0)
})

// NOTE: returns undefined for failure like num().
let date_parser = memoize(function(locale) {
	let yi, mi, di
	let i = 1
	for (let p of date_parts(locale)) {
		if (p.type == 'day'  ) di = i++
		if (p.type == 'month') mi = i++
		if (p.type == 'year' ) yi = i++
	}
	if (i != 4) { // failed? default to `m d y`
		mi = 1; di = 2; yi = 3
	}
	return function(s, validate, precision) {
		let dm = datetime_re.exec(s)
		if (!dm)
			return
		precision = precision || 'ms' // defaults to highest
		let with_time = precision != 'd'
		let with_s    = precision == 's' || precision == 'ms'
		let with_ms   = precision == 'ms'
		let y = num(dm[yi])
		let m = num(dm[mi])
		let d = num(dm[di])
		let H = with_time && num(dm[3+1]) || 0
		let M = with_time && num(dm[3+2]) || 0
		let S = with_s && num(dm[3+3]) || 0
		let fs = with_ms && dm[3+5] || ''
		let f = with_ms && (dm[3+4] ? -1 : 1) * (num(fs) ?? 0) / 10**fs.len || 0
		let t = time(y, m, d, H, M, S) + f
		if (validate)
			if (
				year_of(t) != y
				|| month_of(t) != m
				|| month_day_of(t) != d
				|| (with_time && hours_of(t) != H)
				|| (with_time && minutes_of(t) != M)
				|| (with_s && seconds_of(t) != S)
			) return
		return t
	}
})

G.parse_date = function(s, locale1, validate, precision) {
	return isstr(s) ? date_parser(locale1 || locale())(s, validate, precision) : s
}
method(String, 'parse_date', function(locale1, validate, precision) {
	return parse_date(this.valueOf(), locale1, validate, precision)
})

let a1 = [0, ':', 0, ':', 0]
let a2 = [0, ':', 0]
let seconds_format = new Intl.NumberFormat('nu', {
	minimumIntegerDigits: 2,
	maximumFractionDigits: 6, // mySQL-compatible
})
G.format_timeofday = function(t, precision) {
	let with_s  = precision == 's' || precision == 'ms'
	let with_ms = precision == 'ms'
	let H = floor(t / 3600)
	let M = floor(t / 60) % 60
	let Sf = t % 60
	let S = floor(Sf)
	if (with_s) {
		if (H < 10) H = '0'+H
		if (M < 10) M = '0'+M
		if (S < 10) S = '0'+S
		a1[0] = H
		a1[2] = M
		a1[4] = (with_ms && Sf != S) ? seconds_format.format(Sf) : S
		return a1.join('')
	} else {
		if (H < 10) H = '0'+H
		if (M < 10) M = '0'+M
		a2[0] = H
		a2[2] = M
		return a2.join('')
	}
}
method(Number, 'timeofday', function(precision) {
	return format_timeofday(this.valueOf(), precision)
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
	return function(t, precision) {
		let with_time = precision != 'd'
		let with_s    = precision == 's' || precision == 'ms'
		let with_ms   = precision == 'ms'
		// if this is slow, see
		//   http://git.musl-libc.org/cgit/musl/tree/src/time/__secs_to_tm.c?h=v0.9.15
		_d.setTime(t * 1000)
		let y = _d.getUTCFullYear()
		let m = _d.getUTCMonth() + 1
		let d = _d.getUTCDate()
		let H = _d.getUTCHours()
		let M = _d.getUTCMinutes()
		let S = _d.getUTCSeconds()
		let Sf = S + t - floor(t)
		if (m < 10 && md > 1) m = '0'+m
		if (d < 10 && dd > 1) d = '0'+d
		if (with_s) {
			if (H < 10) H = '0'+H
			if (M < 10) M = '0'+M
			if (S < 10) S = '0'+S
			a1[yi] = y
			a1[mi] = m
			a1[di] = d
			a1[Hi] = H
			a1[Mi] = M
			a1[Si] = (with_ms && Sf != S) ? seconds_format.format(Sf) : S
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
G.format_date = function(t, locale1, precision) {
	return date_formatter(locale1 || locale())(t, precision)
}
method(Number, 'date', function(locale, precision) {
	return format_date(this.valueOf(), locale, precision)
})

let _date_placeholder_text = memoize(function(locale) {
	let a = []
	for (let p of date_parts(locale)) {
		if (p.type == 'day'  ) a.push('d')
		if (p.type == 'month') a.push('m')
		if (p.type == 'year' ) a.push('yyyy')
		if (p.type == 'literal') a.push(p.value)
	}
	return a.join('')
})
G.date_placeholder_text = function(locale1) {
	return _date_placeholder_text(locale1 || locale())
}

}

// duration parsing & formatting ---------------------------------------------

// parse `N d[ays] N h[ours] N m[in] N s[ec]` in any order, spaces optional.
// NOTE: returns undefined for failure like num().
// TODO: years and months!
// TODO: multi-language.
let d_re = /(\d+)\s*([^\d\s])[^\d\s]*/g
G.parse_duration = function(s) {
	if (!isstr(s))
		return s
	s = s.trim()
	let m
	let d = 0
	d_re.lastIndex = 0 // reset regex state.
	while ((m = d_re.exec(s)) != null) {
		let x = num(m[1])
		let t = m[2].lower()
		if (t == 'd')
			d += x * 3600 * 24
		else if (t == 'h')
			d += x * 3600
		else if (t == 'm')
			d += x * 60
		else if (t == 's')
			d += x
		else
			return
	}
	return d
}
method(String, 'parse_duration', function() {
	return parse_duration(this.valueOf())
})

{
let a = []
G.format_duration = function(ss, format) {  // approx[+s] | long | null
	let s = abs(ss)
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
}
}
method(Number, 'duration', function(format) {
	return format_duration(this.valueOf(), format)
})

G.format_timeago = function(t) {
	let d = time() - t
	return (d > -1 ? S('time_ago', '{0} ago') : S('in_time', 'in {0}'))
		.subst(abs(d).duration('approx'))
}
method(Number, 'timeago', function() {
	return format_timeago(this.valueOf())
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
G.hsl_to_rgb = function(h, s, L, a) {
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
G.point_around = function(cx, cy, r, angle) {
	return [
		cx + cos(rad * angle) * r,
		cy + sin(rad * angle) * r
	]
}

G.clip_rect = function(x1, y1, w1, h1, x2, y2, w2, h2, out) {
	// intersect on one dimension
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
	if (out) {
		out[0] = _x1
		out[1] = _y1
		out[2] = _w
		out[3] = _h
		return out
	} else {
		return [_x1, _y1, _w, _h]
	}
}

{
let segs_overlap = function(ax1, ax2, bx1, bx2) { // check if two 1D segments overlap
	return !(ax2 < bx1 || bx2 < ax1)
}
G.rect_intersects = function(x1, y1, w1, h1, x2, y2, w2, h2) {
	return (
		segs_overlap(x1, x1+w1, x2, x2+w2) &&
		segs_overlap(y1, y1+h1, y2, y2+h2)
	)
}
}

// timers --------------------------------------------------------------------

G.runafter = function(t, f) { return setTimeout(f, t * 1000) }
G.runevery = function(t, f) { return setInterval(f, t * 1000) }
G.runagainevery = function(t, f) { f(); return runevery(t, f) }
G.clock = function() { return performance.now() / 1000 }

G.timer = function(f) {
	let timer_id, t0
	function wrapper() {
		timer_id = null
		f()
	}
	return function(t) {
		if (timer_id != null) {
			clearTimeout(timer_id)
			timer_id = null
		}
		if (t != null && t !== false) {
			t = repl(t, true, t0); t0 = t
			timer_id = runafter(t, wrapper)
		}
	}
}

// serialization -------------------------------------------------------------

G.json_arg = s => isstr(s) ? JSON.parse(s) : s
G.json = JSON.stringify

G.try_json_arg = function(s) {
	if (!isstr(s))
		return s
	try {
		return JSON.parse(s)
	} catch {
		// let it return undefined
	}
}

// clipboard -----------------------------------------------------------------

G.copy_to_clipboard = function(text, done) {
	return navigator.clipboard.writeText(text).then(done)
}

// local storage -------------------------------------------------------------

G.save = function(key, s) {
	if (s == null) {
		debug('REMOVE', key)
		localStorage.removeItem(key)
	} else {
		debug_if(!key.starts('__'), 'SET', key, s)
		localStorage.setItem(key, s)
	}
}

G.load = function(key) {
	return localStorage.getItem(key)
}

// URL parsing & formatting --------------------------------------------------

G.url_parse = function(s) {

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
G.url_format = function(t) {

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

/* events --------------------------------------------------------------------

There are 5 types of events in this joint:

TYPE           FIRE                  LISTEN
------------------------------------------------------------------------------
hook           e.foo()               e.do_{after|before}('foo', f); e.on_foo(f)
^element       e.fire[up](k, ...)    e.on(k, f, [on])
^window        fire(k, ...)          on(k, f, [on])
^^announce     announce(k, ...)      listen(k, f, [on])
^^^broadcast   broadcast(k, ...)     on(k, f, [on])

Hooks are just function composition. They are the fastest but can't be unhooked.
Use them when extending widgets. Element events are what we get from the browser.
Most of them bubble so you get them on parents too. Events that are usually
interesting to the outside world should be fired with announce() (preferred
over firing native events on window/document). Broadcast should only be used
when you need to sync all browser tabs of the same app.

*/

// DOM events ----------------------------------------------------------------

{
let callers = obj()
let installers = obj()

let etrack = DEBUG_EVENTS && new Map()

G.stacktrace = () => (new Error()).stack

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

let on = function(ev, element, f, enable, capture) {

	if (isfunc(element)) // shift arg
		return on.call(this, ev, null, element, f, enable)

	assert(enable === undefined || typeof enable == 'boolean')

	let name = isstr(ev) ? ev : ev.type

	let is_raw = name.starts('raw:')
	if (is_raw)
		name = name.slice(4)

	let listener = is_raw ? f : f.listener

	if (enable == false) {

		assert(!element) // on/off is automatic with elements
		assert(listener, 'function not an event handler for {0}', name)

		if (DEBUG_EVENTS)
			log_remove_event(this, name, listener, capture)

		this.removeEventListener(ev, listener, capture)

		return
	}

	if (element) { // an element is hooking on us. unhook when it's unbound.
		assert(iselem(element))
		let target = this
		function bind(on) {
			target.on(ev, null, f, on, capture)
		}
		element.on_bind(bind)
		if (element.bound)
			bind(true)
		return
	}

	let install = installers[name]
	if (install && !(this.__installed && this.__installed[name])) {
		install.call(this)
		attr(this, '__installed')[name] = true
	}

	if (!listener) {
		assert(!is_raw)
		listener = function(ev) {
			let caller = callers[ev.type]
			let ret
			if (caller)
				ret = caller.call(this, ev, f)
			else if (ev.args) {
				if (DEBUG_EVENTS_FIRE && !(ev.type in hidden_events))
					debug(ev.type, ...ev.args)
				ret = f.call(this, ...ev.args, ev)
			} else
				ret = f.call(this, ev)
			if (ret === false) { // like jquery
				ev.preventDefault()
				ev.stopPropagation()
				ev.stopImmediatePropagation()
			}
		}
		f.listener = listener
	}

	if (DEBUG_EVENTS)
		log_add_event(this, name, listener, capture)

	this.addEventListener(ev, listener, capture)

}

let off = function(ev, f, capture) {
	return on.call(this, ev, null, f, false, capture)
}

let once = function(ev, f, enable, capture) {
	if (enable == false) {
		this.off(ev, f, capture)
		return
	}
	let wrapper = function(...args) {
		let ret = f(...args)
		this.off(ev, wrapper, capture)
		return ret
	}
	this.on(ev, wrapper, true, capture)
	f.listener = wrapper.listener // so it can be off'ed.
}

let ev = obj()
let ep = obj()
let log_fire = DEBUG_EVENTS && function(e) {
	ev[e.type] = (ev[e.type] || 0) + 1
	if (e.type == 'prop_changed') {
		let k = e.args[1]
		ep[k] = (ep[k] || 0) + 1
	}
	return e
} || return_arg

G.event = function(ev, bubbles, ...args) {
	if (!isstr(ev))
		return ev
	ev = new CustomEvent(ev, {cancelable: true, bubbles: bubbles})
	ev.args = args
	return ev
}

let fire = function(ev, ...args) {
	let e = log_fire(event(ev, false, ...args))
	return this.dispatchEvent(e)
}

let fireup = function(ev, ...args) {
	let e = log_fire(event(ev, true, ...args))
	return this.dispatchEvent(e)
}

method(EventTarget, 'on'     , on)
method(EventTarget, 'off'    , off)
method(EventTarget, 'once'   , once)
method(EventTarget, 'fire'   , fire)
method(EventTarget, 'fireup' , fireup)

G.event_callers = callers
G.event_installers = installers
} //scope

Event.prototype.forward = function(e) {
	let ev = new this.constructor(this.type, this)
	return e.fire(ev)
}

/* DOM events into dynamic targets -------------------------------------------

A listener is an object that you can add event handlers to with on() just like
you would on a real event target, and later on set its target property which
will then add those handlers to the target. The target can be set/unset at any
time and the event handlers will be reassigned to the new target. Moreover,
you can set target_id instead of target, which will set/unset the target
automatically when the element target with that id is bound/unbound.

props:
	target
	target_id
	enabled
methods:
	on(event, f, [on], [capture])
	on_bind(f); f(ls, on)

*/

G.listener = function() {
	let e = this
	let ls = {}
	let target, target_id
	let enabled = true
	let all_handlers = obj() // {event_name->[f1,...]}
	let user_bind = noop

	// add/remove event listeners, which also adds them to current target if any.
	ls.on = function(event, f, enable, capture) {
		if (enable != false) {
			let handlers = attr(all_handlers, event, array)
			assert(!handlers.includes(f), 'duplicate event handler for {0}', event)
			handlers.push(f)
		}
		else {
			let handlers = all_handlers[event]
			let i = handlers.remove_value(f)
			assert(i != -1, 'event handler not found for {0}', event)
		}
		if (target)
			target.on(event, f, enable, capture)
		return ls
	}

	// assigning the target, which adds/removes current event listeners.
	let target_bound = false
	function bind_target(on) {
		if (!target)
			return
		if (on == target_bound)
			return
		if (on && !enabled)
			return
		target_bound = on
		for (let event in all_handlers)
			for (let handler of all_handlers[event])
				target.on(event, handler, on)
		user_bind(ls, on)
	}
	function set_target(target1) {
		if (target1 == target)
			return
		bind_target(false)
		target = target1
		bind_target(true)
	}
	property(ls, 'target', () => target, function(target) {
		assert(!target_id, 'cannot set target while target_id is set')
		set_target(target)
	})
	ls.on_bind = function(f) {
		user_bind = do_after(user_bind, f)
	}

	// indirect target binding by id.
	function te_bind(te, on) {
		set_target(on ? te : null)
	}
	function id_changed(te, id1, id0) {
		if (target_id != id0) return // not our id
		e.target_id = id1
	}
	let target_id_bound = false
	function bind_target_id(on) {
		if (!target_id)
			return
		if (on == target_id_bound)
			return
		if (on && !enabled)
			return
		listen(target_id+'.bind', te_bind, on)
		listen('id_changed', id_changed, on)
		let te = on && window[target_id]
		set_target(te && te.bound && te || null)
	}
	property(ls, 'target_id', () => target_id, function(target_id1) {
		if (target_id1 == target)
			return
		bind_target_id(false)
		target_id = target_id1
		bind_target_id(true)
	})
	property(ls, 'enabled', () => enabled, function(enabled1) {
		enabled = !!enabled
		if (enabled1 == enabled)
			return
		enabled = enabled1
		if (target_id)
			bind_target_id(enabled)
		else
			bind_target(enabled)
	})

	return ls
}

// DOM events in elements based on id ----------------------------------------

// NOTE: does not react to target id changes!

function on_target(target_id, event, f, enable, capture) {
	f.bind = f.bind || function(te, on) {
		te.on(event, f, enable, capture)
	}
	listen(target_id+'.bind', f.bind, enable)
	let te = window[target_id]
	if (!te) return
	if (on && !te.bound) return
	f.bind(te, enable)
}
override(Window, 'on', function(inherited, target_id, event, f, enable, capture) {
	if (!(isstr(target_id) && (isstr(event) || event instanceof Event)))
		return inherited.call(this, target_id, event, f, enable)
	return on_target(target_id, event, f, enable, capture)
})

/* fast global events --------------------------------------------------------

These do the same job as window.on(event, f) / window.fire(event, ...)
except they are faster because they make less garbage (or none if JS is
smart enough to keep the varargs on the stack or sink them).

*/

{
let all_handlers = obj() // {event_name->set(f)}

G.listen = function(event, f, on) {
	if (on != false) {
		let handlers = attr(all_handlers, event, set)
		assert(!handlers.has(f), 'duplicate event handler for {0}', event)
		handlers.add(f)
	} else {
		let handlers = all_handlers[event]
		assert(handlers && handlers.has(f), 'event handler not found for {0}', event)
		handlers.delete(f)
	}
}

G.announce = function(event, ...args) {
	let handlers = all_handlers[event]
	if (!handlers) return
	for (let handler of handlers) {
		let ret = handler(...args)
		if (ret !== undefined)
			return ret
	}
}
}

// inter-window events -------------------------------------------------------

addEventListener('storage', function(e) {
	// decode the message.
	if (e.key != '__broadcast')
		return
	let v = e.newValue
	if (!v)
		return
	v = json_arg(v)
	announce(v.topic, ...v.args)
})

// broadcast a message to other windows.
G.broadcast = function(topic, ...args) {
	announce(topic, ...args)
	save('__broadcast', '')
	save('__broadcast', json({
		topic: topic,
		args: args,
	}))
	save('__broadcast', '')
}

G.setglobal = function(k, v, default_v) {
	let v0 = strict_or(window[k], default_v)
	if (v === v0)
		return
	window[k] = v
	broadcast('global_changed', k, v, v0)
	broadcast(k+'_changed', v, v0)
}

// multi-language stubs replaced in webb_spa.js ------------------------------

// stub for getting message strings that can be translated multiple languages.
if (!G.S) {
	G.S = function(name, en_s, ...args) {
		return en_s.subst(...args)
	}
}

G.Sf = function(...args) {
	return () => S(...args)
}

// stub for getting current language.
if (!G.lang) {
	let nav_lang = navigator.language.substring(0, 2)
	G.lang = function() {
		return document.documentElement.lang || nav_lang
	}
}

// stub for getting current country.
if (!G.country) {
	let nav_country = navigator.language.substring(3, 5)
	G.country = function() {
		return document.documentElement.attr('country') || nav_country
	}
}

let locale = memoize(function() { return lang() + '-' + country() })

// stub for rewriting links to current language.
if (!G.href) {
	G.href = return_arg
}

/* AJAX requests -------------------------------------------------------------

	ajax(opt) -> req
		opt.url
		opt.upload: object (sent as json) | s
		opt.timeout (browser default)
		opt.method ('POST' or 'GET' based on req.upload)
		opt.slow_timeout (4)
		opt.headers: {h->v}
		opt.response_mime_type // needed for loading CSS files non-async in Firefox
		opt.user
		opt.pass
		opt.async (true)
		opt.dont_send (false)
		opt.notify: widget to send 'load' events to.
		opt.notify_error: error notify function: f(message, 'error').
		opt.notify_notify: json `notify` notify function.
		opt.silent: don't notify
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

	^^ajax_error  : error notification.
	^^ajax_notify : notification for json results containing a field called `notify`.

*/

G.ajax = function(req) {

	req = assign_opt(new EventTarget(), {slow_timeout: 4}, req)

	let xhr

	if (req.xhr) { // mock xhr

		xhr = assign_opt({}, req.xhr)
		xhr.open = noop
		xhr.setRequestHeader = noop
		xhr.getResponseHeader = noop
		xhr.abort = noop
		xhr.upload = {}
		xhr.send = function() {
			runafter(xhr.wait || 0, function() {
				xhr.status = 200
				xhr.readyState = 4
				xhr.onreadystatechange()
			})
		}

	} else {

		xhr = new XMLHttpRequest()

	}

	let method = req.method || (req.upload ? 'POST' : 'GET')
	let async = req.async !== false // NOTE: this is deprecated but that's ok.
	let url = url_format(req.url)

	xhr.open(method, url, async, req.user, req.pass)

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
		try { // non-async requests raise errors, catch and call our callbacks.
			xhr.send(upload)
			if (!async)
				done(200)
		} catch (err) {
			// NOTE: xhr.status is always 0 on non-async requests so there's no way
			// to know the failure mode. We classify them all as 'network' errors.
			xhr.onerror()
		}
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

	// NOTE: only fired on network errors like "connection refused" and on CORS errors!
	xhr.onerror = function() {
		req.failtype = 'network'
		fire('done', 'fail', req.error_message('network'), 'network')
	}

	xhr.onabort = function() {
		req.failtype = 'abort'
		fire('done', 'fail', null, 'abort')
	}

	function done(status) {
		let res = xhr.response
		if (!xhr.responseType || xhr.responseType == 'text')
			if (xhr.getResponseHeader('content-type') == 'application/json' && res)
				res = json_arg(res)
		req.response = res
		if (status == 200) {
			debug_if(DEBUG_AJAX, '$', method, url)
			fire('done', 'success', res)
		} else {
			req.failtype = 'http'
			let status_message = xhr.statusText
			debug_if(DEBUG_AJAX, '!', method, url)
			fire('done', 'fail',
				req.error_message('http', status, status_message, res),
				'http', status, status_message, res)
		}
	}

	xhr.onreadystatechange = function(ev) {
		if (!async)
			return
		if (xhr.readyState > 1)
			stop_slow_watch()
		if (xhr.readyState > 2 && req.onchunk)
			if (req.onchunk(xhr.response, xhr.readyState == 4) === false)
				req.abort()
		if (xhr.readyState == 4)
			if (xhr.status)
				done(xhr.status)
	}

	req.abort = function() {
		xhr.abort()
		return req
	}

	let notify_error  = req.notify_error  || req.silent && noop || function(...args) { announce('ajax_error' , ...args) }
	let notify_notify = req.notify_notify || req.silent && noop || function(...args) { announce('ajax_notify', ...args) }

	function fire(name, arg1, ...rest) {

		if (name == 'done')
			fire(arg1, ...rest)

		if (req.fire(name, arg1, ...rest)) {
			if (name == 'fail' && arg1)
				notify_error(arg1, ...rest)
			if (name == 'success' && isobject(arg1) && isstr(arg1.notify))
				notify_notify(arg1.notify, arg1.notify_kind)
		}

		if (req[name])
			req[name](arg1, ...rest)

		let notify = req.notify instanceof EventTarget ? [req.notify] : req.notify
		if (isarray(notify))
			for (let target of notify)
				target.fire('load', name, arg1, ...rest)

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

G.get = function(url, success, fail, opt) {
	return ajax(assign({
		url: url,
		method: 'GET',
		success: success,
		fail: fail,
	}, opt))
}

G.post = function(url, upload, success, fail, opt) {
	return ajax(assign({
		url: url,
		method: 'POST',
		upload: upload,
		success: success,
		fail: fail,
	}, opt))
}

// JSHint linter -------------------------------------------------------------

// lint any loaded js file from the browser directly, no server needed!
// we use this mostly to catch `for (v ...` which should be `for(let v ...`.
G.lint = function(file, opt) {
	if (!G.JSHINT) {
		let script = document.createElement('script')
		script.onload = function() {
			assert(G.JSHINT, 'jshint.js not loaded')
			lint(file, opt)
		}
		script.src = 'jshint.js'
		document.documentElement.append(script)
		return
	}
	$('script[src]').each(function(sc) {
		if (file && !sc.src.ends(file))
			return
		get(sc.src, function(s) {
			pr(sc.src, s.len)
			pr('------------------------------------------------------')
			JSHINT(s, assign({
				asi: true,
				esversion: 6,
				strict: true,
				browser: true,
				'-W014': true, // says starting a line with `?` is "confusing".
				'-W119': true, // `a**b` is es7
				'-W082': true, // func decl in block: in strict mode it's no problem.
				'-W008': true, // says `.5` is confusing :facepalm:
				'-W054': true, // says we shouldn't use `new Function()` sheesh.
				'-W069': true, // says `foo['bar']` should be `foo.bar`, whatever.
				'-W083': true, // says we shouldn't make closures in loops, what a joykill.
				'-W061': true, // says eval() is "harmful"... only in the wrong hands :)
				'-W018': true, // says "confusing use of !" in charts.js, dunno why.
				'-W040': true, // says we shouldn't make standalone functions with `this` inside.
			}, opt))
			pr(JSHINT.errors.map(e => sc.src+':'+e.line + ':' + e.character + ': '
				+ e.code + ' ' + e.raw.subst(e)).join('\n'))
		})
	})
}

}()) // module function
