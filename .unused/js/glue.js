/*

	bool(s) -> b
	trace_if(cond, ...)
	log_if(cond, ...)
	push_log(...)
	push_log_if(cond, ...)
	pop_log(...)
	callable_constructor(cons) -> f
	inherit_properties(subclass, [superclass]) -> subclass
	override_property_getter(class|instance, prop, getter)
	override_property_setter(class|instance, prop, setter)
	lower_ai_ci(s)
	find_ai_ci(s, s1)
	wordset(s) -> {word1: true, ...} | null
	catall(...)
	range(i, j, step, f) -> a
	replace_value(a, v0, v1) -> i
	array_equals(a1, a2, [i1], [i2]) -> t|f
	group_sorted(a, eq_cond, [i1, i2]) -> iter() -> [i1, i2]
	remove_duplicates(a) -> a
	set_addset(s, s2) -> s          dump set into set
	set_set(s, s2) -> s             set elements to s'
	set_toarray(s) -> [v1,...]      array of elements in insert order
	map_first_key(m) -> k           get the first key out of a map
	map_assign(m, m1) -> m          like assign() but for a map
	clone(t) -> t1                  deep clone
	first_key(t) -> k               get the first key out of an object
	gen_id(prefix) -> id            generate autoincrement id
	hash32(s) -> x
	parse_duration(s) -> ds
	date_placeholder_text([locale])
	clip_rect(x1, y1, w1, h1, x2, y2, w2, h2) -> [x, y, w, h]
	rect_intersects(x1, y1, w1, h1, x2, y2, w2, h2) -> t|f
	hypot(a, b) -> d
	distance(x1, y1, x2, y2) -> d
	custom_event_up (name, ...)
	setglobal(name, val)
	^window.global_changed(name, v, v0)
	^window.NAME_changed(v, v0)

*/

let bool = b => !!b

function trace_if(cond, ...args) {
	if (!cond) return
	trace(...args)
}

function log_if(cond, ...args) {
	if (!cond) return
	log(...args)
}

let log_level = 0

let log_off_level

function push_log(...args) {
	log_level++
	if (DEBUG_LOG) // Collapsed
		console.groupCollapsed(...args)
}

function pop_log(...args) {
	if (DEBUG_LOG) {
		log(...args)
		console.groupEnd()
	}
	log_level--
	if (log_off_level === log_level) {
		log_off_level = null
		DEBUG_LOG = true
	}
}

function push_log_if(cond, ...args) {
	if (!cond && DEBUG_LOG) {
		log_off_level = log_level
		DEBUG_LOG = false
	}
	push_log(...args)
}

// TODO: is there a way to make a constructable also callable without wrapping it?
function callable_constructor(cons) {
	let name = cons.name
	let f = {[name]: function(...args) { return new cons(...args) }}[name]
	f.class = cons
	return f
}

function inherit_properties(cons, super_cons) {
	super_cons ??= Object.getPrototypeOf(cons)
	let child_methods = cons.prototype
	let super_methods = super_cons.prototype
	// copy super's methods to child.
	for (let k of Object.getOwnPropertyNames(super_methods))
		if (!(k in child_methods)) { // not overridden
			let desc = Object.getOwnPropertyDescriptor(super_methods, k)
			Object.defineProperty(child_methods, k, desc)
		}
	return cons
}

// override a property setter in a prototype *or instance*.
function override_property_setter(cls, prop, set) {
	let proto = cls.prototype || cls
	let d0 = getPropertyDescriptor(proto, prop)
	assert(d0, cls.type || cls.name, '.', prop, ' does not exist')
	let inherited = d0.set || noop
	function wrapper(v) {
		return set.call(this, inherited, v)
	}
	d0.set = wrapper
	Object.defineProperty(proto, prop, d0)
}

// override a property getter in a prototype *or instance*.
function override_property_getter(cls, prop, get) {
	let proto = cls.prototype || cls
	let d0 = getPropertyDescriptor(proto, prop)
	assert(d0, cls.type || cls.name, '.', prop, ' does not exist')
	let inherited = d0.get || noop
	function wrapper(v) {
		return get.call(this, inherited, v)
	}
	d0.get = wrapper
	Object.defineProperty(proto, prop, d0)
}

function lower_ai_ci(s) {
	return s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

function find_ai_ci(s, s1) {
	return repl(lower_ai_ci(s).indexOf(lower_ai_ci(s1)), -1, null)
}

// concat args. if any arg is null return nothing.
function catall(...args) {
	for (let i = 0, n = args.length; i < n; i++)
		if (args[i] == null)
			return
	return catany('', ...args)
}

function esc(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

function wordset(s) {
	if (!isstr(s)) return s
	let ws = obj()
	for (let word of words(s))
		ws[word] = true
	return ws
}

function range(i1, j, step, f) {
	step ??= 1
	f = f || return_arg
	let a = []
	for (let i = i1; i < j; i += step)
		a.push(f(i))
	return a
}

function replace_value(a, v0, v1) {
	let i = a.indexOf(v0)
	if (i >= 0)
		a[i] = v1
	return i
}

function array_equals(a1, a2, i1, i2) {
	i1 = i1 ?? 0
	i2 = i2 ?? max(a1.length, a2.length)
	if (i2 > min(a1.length, a2.length))
		return false
	for (let i = i1; i < i2; i++)
		if (a1[i] !== a2[i])
			return false
	return true
}

function remove_duplicates(a) {
	if (a.length > 40) { // go heavy after 64k iterations.. too soon?
		let s = set(a)
		a.length = 0
		for (let v of s)
			a.push(v)
		return a
	}
	return remove_values(a, function(v, i, a) {
		return a.indexOf(v, i+1) != -1
	})
}

// iterate a sorted array (or part of it) in chunks of items that are equal
// per eq_cond(). use i1, i2 to iterate nested groupings. i2 is exclusive!
function *group_sorted(a, eq_cond, i1, i2) {
	i1 ??= 0
	i2 ??= a.length
	let i0 = i1
	let i = i0 + 1
	if (i1 >= i2)
		return
	while (i < i2) {
		if (!eq_cond(a[i], a[i-1])) {
			yield [i0, i]
			i0 = i
		}
		i++
	}
	yield [i0, i2]
}

function map_first_key(m) {
	// let's hope the compiler sees this pattern and doesn't actually allocate
	// an iterator object for this.
	for (let k of m.keys())
		return k
}

function map_assign(m, m1) {
	for (let [k,v] of m1)
		m.set(k, v)
	return m
}

function set_addset(s, s1) {
	for (let k of s1)
		s.add(k)
	return s
}

function set_set(s, s1) {
	s.clear()
	return set_addset(s, s1)
}

function set_toarray(s) {
	return Array.from(s)
}

let clone = structuredClone

function first_key(t) {
	for (let k in t)
		if (t.hasOwnProperty(k))
			return k
}

let next_id = {}

window.DEBUG_GEN_ID = 1

function gen_id(k) {
	if (!DEBUG_GEN_ID)
		return null
	if (!next_id[k])
		next_id[k] = 1
	else
		next_id[k]++
	return next_id[k]
}

function hash32(s) {
	let hash = 0
	for (let i = 0, n = s.length; i < n; i++) {
		hash = ((hash << 5) - hash) + s.charCodeAt(i)
		hash |= 0 // convert to 32bit integer
	}
	return hash
}

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

function date_placeholder_text(locale1) {
	return _date_placeholder_text(locale1 || locale())
}

// parse `N d[ays] N h[ours] N m[in] N s[ec]` in any order, spaces optional.
// NOTE: returns undefined for failure like num().
// TODO: years and months!
// TODO: multi-language.
let d_re = /(\d+)\s*([^\d\s])[^\d\s]*/g

function parse_duration(s) {
	if (!isstr(s))
		return s
	s = s.trim()
	let m
	let d = 0
	d_re.lastIndex = 0 // reset regex state.
	while ((m = d_re.exec(s)) != null) {
		let x = num(m[1])
		let t = m[2].toLowerCase()
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

let clip_rect

{
let out = [0, 0, 0, 0]
clip_rect = function(x1, y1, w1, h1, x2, y2, w2, h2) {
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
	out[0] = _x1
	out[1] = _y1
	out[2] = _w
	out[3] = _h
	return out
}
}

function segs_overlap(ax1, ax2, bx1, bx2) { // check if two 1D segments overlap
	return !(ax2 < bx1 || bx2 < ax1)
}

function rect_intersects(x1, y1, w1, h1, x2, y2, w2, h2) {
	return (
		segs_overlap(x1, x1+w1, x2, x2+w2) &&
		segs_overlap(y1, y1+h1, y2, y2+h2)
	)
}

// hypotenuse function: computes sqrt(a^2 + b^2) without underflow / overflow problems.
function hypot(a, b) {
	if (a == 0 && b == 0) return 0
	a = abs(a)
	b = abs(b)
	let M = max(a, b)
	let m = min(a, b)
	return M * sqrt(1 + (m / M)**2)
}

// distance between two points. avoids underflow and overflow.
function distance(x1, y1, x2, y2) {
	return hypot(x2-x1, y2-y1)
}

function custom_event_up (...args) { return _event(true , ...args) }

async function concatUint8Arrays(chunks) {
	let blob = new Blob(chunks)
	let buffer = await blob.arrayBuffer()
	return new Uint8Array(buffer)
}

let tdec = new TextDecoder()

function compress(s) {
	let cs = new CompressionStream('gzip')
	let writer = cs.writable.getWriter()
	let b = tenc.encode(s)
	writer.write(b)
	writer.close()
	return new Response(cs.readable).arrayBuffer()
}

function decompress(byteArray, encoding) {
	let cs = new DecompressionStream(encoding)
	let writer = cs.writable.getWriter()
	writer.write(byteArray)
	writer.close()
	return new Response(cs.readable).arrayBuffer().then(function(arrayBuffer) {
		return tdec.decode(arrayBuffer)
	})
}

String.prototype.lower_ai_ci      = m(lower_ai_ci     )

String.prototype.find_ai_ci       = m(find_ai_ci      )

String.prototype.esc              = m(esc             )

String.prototype.wordset          = m(wordset         )

String.prototype.parse_duration   = m(parse_duration  )

alias(String.prototype, 'ends'  , 'endsWith'   )

method(Array.prototype, 'equals           ', m(array_equals            ))

method(Array.prototype, 'remove_duplicates', m(remove_duplicates       ))

property(Map, 'first_key', m(map_first_key))

Map.prototype.assign = m(map_assign)

Set.prototype.add_set = m(set_addset)

Set.prototype.set     = m(set_set)

Set.prototype.toarray = m(set_toarray)

function setglobal(k, v, default_v) {
	let v0 = window[k] ?? default_v
	if (v === v0)
		return
	window[k] = v
	broadcast('global_changed', k, v, v0)
	broadcast(k+'_changed', v, v0)
}

listen('global_changed', function(k, v) {
	window[k] = v
})

function log(...args) {
	console.log(snap_nums(args))
}

alias(String.prototype, 'starts', 'startsWith' )

alias(String.prototype, 'upper' , 'toUpperCase')

alias(String.prototype, 'lower' , 'toLowerCase')

if (script_attr('extend') || script_attr('glue-extend')) {

function m(f) {
	return function(...args) {
		return f(this, ...args)
	}
}

// String extensions ---------------------------------------------------------

String.prototype.subst            = m(subst           )
String.prototype.display_name     = m(display_name    )
String.prototype.catany           = m(catany          )
String.prototype.words            = m(words           )
String.prototype.captures         = m(captures        )
String.prototype.parse_timeofday  = m(parse_timeofday )
String.prototype.parse_date       = m(parse_date      )

// Number extensions ---------------------------------------------------------

Number.prototype.timeofday  = m(format_timeofday)
Number.prototype.date       = m(format_date)
Number.prototype.duration   = m(format_duration)
Number.prototype.timeago    = m(format_timeago)
Number.prototype.kbytes     = m(format_kbytes)
Number.prototype.kcount     = m(format_kcount)
Number.prototype.base       = m(format_base)

// Array extensions ----------------------------------------------------------

// NOTE: making these non-enumerable methods to avoid affecting Object.keys(array).

property(Array.prototype, 'last', function get_last() { return this[this.length-1] })

method(Array.prototype, 'resize           ', m(array_resize            ))
method(Array.prototype, 'extend           ', m(extend                  ))
method(Array.prototype, 'set              ', m(array_set               ))
method(Array.prototype, 'insert           ', m(insert                  ))
method(Array.prototype, 'remove           ', m(remove                  ))
method(Array.prototype, 'insert_n         ', m(insert_n                ))
method(Array.prototype, 'remove_n         ', m(remove_n                ))
method(Array.prototype, 'remove_value     ', m(remove_value            ))
method(Array.prototype, 'remove_values    ', m(remove_values           ))
method(Array.prototype, 'move             ', m(array_move              ))
method(Array.prototype, 'binsearch        ', m(binsearch               ))
method(Array.prototype, 'uniq_sorted      ', m(uniq_sorted             ))

// Set extensions ------------------------------------------------------------

Set.prototype.equals  = m(set_equals)

// Matrix extennsions --------------------------------------------------------

DOMMatrix.prototype.x = transform_point_x
DOMMatrix.prototype.y = transform_point_y

} // if (extend)
