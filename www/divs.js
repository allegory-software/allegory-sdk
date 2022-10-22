/*

	DOM API & web components.
	Written by Cosmin Apreutesei. Public domain.

	Dependencies:
		glue.js

	CSS Requirements (see divs.js):
		[hidden]
		[disabled]
		.popup
		.modal-dialog

	Init requirements:
		init_components()

	element attribute manipulation:
		e.hasattr(k)
		e.attr(k[, v]) -> v
		e.bool_attr(k[, v]) -> v
		e.closest_attr(k)
		e.attrs = {k: v}
		e.tag
	element css class list manipulation:
		e.class('k1 ...'[, enable])
		e.hasclass(k)
		e.switch_class(k1, k2, normal)
		e.classess = 'k1 k2 ...'
	access to element computed styles:
		e.css([k][, state])
	css querying:
		css_class_prop(class, prop) -> v
		fontawesome_char(name) -> s
	dom tree navigation excluding text nodes:
		e.at[i], e.len, e.at.length
		e.parent
		e.index
		e.first, e.last, e.next, e.prev
		e.positionally_contains(ce) -> t|f
	dom tree querying:
		iselem(v) -> t|f
		isnode(v) -> t|f
		e.$(sel) -> ea
		$(sel) -> ea
		E(sel|e)
		ea.each(f)
		root, body, head
	dom tree de/serialization:
		e.html -> s
		[unsafe_]html(s) -> e
		e.[unsafe_]html = s
	safe dom tree manipulation:
		T[C](te[,whitespace]) where `te` is f|e|text_str
		e.clone()
		e.set(te[,whitespace])
		e.add(te1,...)
		e.insert(i, te1,...)
		e.replace([e0], te)
		e.move([pe], [i0])
		e.clear()
		tag(s, [attrs], te1,...)
		div(...)
		span(...)
		[].join_nodes([separator])
	components:
		bind_component(tag, initializer, [selector])
		e.bind(t|f)
		e.do_bind()
		e.do_move()
		^bind(on)
		e.bound -> t|f
		e.property(name, [get],[set] | descriptor)
		e.override(method, f)
		e.do_before(method, f)
		e.do_after(method, f)
	events:
		broadcast (name, ...args)
		^[right]click       (ev, nclicks, mx, my)
		^[right]pointerdown (ev, mx, my)
		^[right]pointerup   (ev, mx, my)
		^pointermove        (ev, mx, my)
		^wheel              (ev, dy, mx, my)
		^keydown            (key, shift, ctrl, alt, ev)
		^keyup              (key, shift, ctrl, alt, ev)
		^keypress           (key, shift, ctrl, alt, ev)
		^stopped_event      (stopped_ev, ev)
		^layout_changed()
		e.capture_pointer(ev, on_pointermove, on_pointerup)
		on_dom_load(fn)
	element geometry:
		px(x)
		e.x, e.y, e.x1, e.y1, e.x2, e.y2, e.w, e.h, e.ox, e.oy
		e.min_w, e.min_h, e.max_w, e.max_h
		e.rect() -> r
		r.x, r.y, r.x1, r.y1, r.x2, r.y2, r.w, r.h
		r.contains(x, y)
	element visibility:
		e.hide([on])
		e.show([on])
		element state:
		e.hovered
		e.focused_element
		e.focused
		e.hasfocus
		e.focusables()
		e.effectively_disabled
		e.effectively_hidden
		e.focus_first()
	text editing:
		input.select_range(i, j)
		e.select(i, j)
		e.contenteditable
		e.insert_at_caret(s)
		e.select_all()
		e.unselect()
	scrolling:
		scroll_to_view_rect(x, y, w, h, pw, ph, sx, sy)
		e.scroll_to_view_rect_offset(sx0, sy0, x, y, w, h)
		e.scroll_to_view_rect(sx0, sy0, x, y, w, h)
		e.make_visible_scroll_offset(sx0, sy0[, parent])
		e.make_visible()
		e.is_in_viewport()
	animation easing:
		raf(f) -> raf_id
		transition(f, [dt], [x0], [x1], [easing]) -> tr
			tr.stop()
			tr.finish = func
	hit testing:
		hit_test_rect_sides(x0, y0, d1, d2, x, y, w, h)
		e.hit_test_sides(mx, my, [d1], [d2])
	camvas:
		e.clear()
	UI patterns:
		e.popup([target|false], [side], [align], [px], [py])
		e.modal([on])
		overlay(attrs, content)
		live_move_mixin(e)
		lazy-loading of <img data-src="">
		auto-updating of <tag timeago time="">
		exec-ing of <script runit> scripts from injected html

*/

// element attribute manipulation --------------------------------------------

alias(Element, 'hasattr', 'hasAttribute')

// NOTE: `true`, `false` and `undefined` cannot be stored specifically:
// setting `true` gets back 'true' while `false` and `undefined` gets back `null`.
// To store `true`, `false` and `null`, use bool_attr().
method(Element, 'attr', function(k, v) {
	if (arguments.length < 2)
		return this.getAttribute(k)
	else if (v == null || v === false)
		this.removeAttribute(k)
	else
		this.setAttribute(k, v)
})

// NOTE: storing `false` explicitly allows setting the value `false` on
// props whose default value is `true`.
method(Element, 'bool_attr', function(k, v) {
	if (arguments.length < 2)
		return repl(repl(this.getAttribute(k), '', true), 'false', false)
	else if (v == null)
		this.removeAttribute(k)
	else
		this.setAttribute(k, repl(repl(v, true, ''), false, 'false'))
})

// NOTE: setting this doesn't remove existing attrs!
property(Element, 'attrs', {
	get: function() {
		return this.attributes
	},
	set: function(attrs) {
		if (attrs)
			for (let k in attrs)
				this.attr(k, attrs[k])
	}
})

method(Element, 'closest_attr', function(attr) {
	let e = this.closest('['+attr+']')
	return e && e.attr(attr)
})

property(Element, 'tag', function() { return this.tagName.lower() })

// element css class list manipulation ---------------------------------------

method(Element, 'class', function(names, enable) {
	if (arguments.length < 2)
		enable = true
	if (names.indexOf(' ') != -1) {
		for (let name of names.words())
			if (enable)
				this.classList.add(name)
			else
				this.classList.remove(name)
	} else {
		if (enable)
			this.classList.add(names)
		else
			this.classList.remove(names)
	}
})

method(Element, 'hasclass', function(name) {
	return this.classList.contains(name)
})

method(Element, 'switch_class', function(s1, s2, normal) {
	this.class(s1, normal == false)
	this.class(s2, normal != false)
})


// NOTE: setting this doesn't remove existing classes!
property(Element, 'classes', {
	get: function() {
		return this.attr('class')
	},
	set: function(s) {
		if (s)
			for (s of s.words())
				this.class(s, true)
	}
})

// css querying --------------------------------------------------------------

method(Element, 'css', function(prop, state) {
	let css = getComputedStyle(this, state)
	return prop ? css[prop] : css
})

alias(CSSStyleDeclaration, 'prop', 'getPropertyValue')

function css_class_prop(selector, style) {
	let sheets = document.styleSheets
	for (let i = 0, l = sheets.length; i < l; i++) {
		let sheet = sheets[i]
		if(!sheet.cssRules)
			continue
		for (let j = 0, k = sheet.cssRules.length; j < k; j++) {
			let rule = sheet.cssRules[j]
			if (rule.selectorText && rule.selectorText.split(',').indexOf(selector) !== -1)
				return rule.style[style]
		}
	}
}

fontawesome_char = memoize(function(icon) {
	return css_class_prop('.'+icon+'::before', 'content').slice(1, -1)
})

// dom tree navigation for elements, skipping text nodes ---------------------

alias(Element, 'at'     , 'children')
alias(Element, 'len'    , 'childElementCount')
alias(Element, 'parent' , 'parentNode')
alias(Element, 'first'  , 'firstElementChild')
alias(Element, 'last'   , 'lastElementChild')
alias(Element, 'next'   , 'nextElementSibling')
alias(Element, 'prev'   , 'previousElementSibling')

{
let indexOf = Array.prototype.indexOf
property(Element, 'index', {
	get: function() {
		return indexOf.call(this.parentNode.children, this)
	},
	set: function(i) {
		let sx = this.scrollLeft
		let sy = this.scrollTop
		this.parent.insertBefore(this, this.at[max(i, 0)])
		this.scroll(sx, sy)
	}
})
}

// dom tree navigation including text nodes ----------------------------------
// also faster for when you know that you don't have text nodes!

alias(Element , 'nodes'      , 'childNodes')
alias(Element , 'first_node' , 'firstChild')
alias(Element , 'last_node'  , 'lastChild')
alias(Element , 'next_node'  , 'nextSibling')
alias(Element , 'prev_node'  , 'previousSibling')
alias(NodeList, 'len', 'length')

// dom tree querying ---------------------------------------------------------

function iselem(e) { return e instanceof Element }
function isnode(e) { return e instanceof Node }

// NOTE: spec says the search is depth-first and we use that.
alias(Element         , '$', 'querySelectorAll')
alias(DocumentFragment, '$', 'querySelectorAll')
function $(s) { return document.querySelectorAll(s) }

alias(Element         , '$1', 'querySelector')
alias(DocumentFragment, '$1', 'querySelector')
function $1(s) { return document.querySelector(s) }

function E(s) {
	return typeof s == 'string' ? document.querySelector(s) : s
}

method(NodeList, 'each', function(f) {
	Array.prototype.forEach.call(this, f)
})

property(NodeList, 'first', function() { return this[0] })
property(NodeList, 'last' , function() { return this[this.length-1] })

method(Element, 'positionally_contains', function(e) {
	if (this.contains(e))
		return true
	let pe = e
	while(1) {
		pe = pe.popup_target || pe.parent
		if (!pe)
			break
		if (pe == this)
			return true
	}
	return false
})

/* dom tree manipulation with lifecycle management ---------------------------

The "lifecycle management" part of this is basically poor man's web components.
The reason we're reinventing web components in this inefficient way via DOM
querying is because the actual web components API built into the browser is
unusable. Needless to say, all DOM manipulation needs to be done through this
API exclusively for components to work.

*/

{
let component_init = obj() // {tag->init}
let component_selector = obj() // {tag->selector}
let component_query = ''
function bind_component(tag, init, selector) {
	selector = selector || tag
	let tagName = tag.upper()
	component_init[tagName] = init
	component_selector[tagName] = selector
	component_query = component_query ? component_query + ',' + selector : selector
}

method(Element, 'init_component', function() {
	this.init_child_components()
	let tagName = this.tagName
	let init = component_init[tagName]
	let sel = component_selector[tagName]
	if (init && (sel == tagName || this.matches(sel)))
		init(this)
})

method(Element, 'init_child_components', function() {
	let n = this.len
	if (!n)
		return
	if (n == 1) { // fast path (must be a wrapper)
		this.at[0].init_component()
		return
	}
	// CSS queries are depth-first, so parents are initialized first,
	// which gives them a chance to remove their children declared in html
	// before they are initialized as components.
	for (let ce of this.$(component_query))
		component_init[ce.tagName](ce)
})
}

method(Element, 'bind_children', function(on) {
	if (!this.len)
		return
	assert(isbool(on))
	// $() is depth-first so we iterate in normal order for bind and in reverse
	// order for unbind (bind children first, unbind them last).
	let children = this.$('[_bind]')
	if (on)
		for (let ci of children)
			ci.bind(on)
	else
		for (let i = children.length-1; i >= 0; i--)
			children[i].bind(false)
})

method(Element, 'bind', function(on) {
	assert(isbool(on))
	if (!this.bound == !on)
		return
	if (this.do_bind) { // component
		this.bound = on
		this.do_bind(on)
	} else if (this.hasattr('_bind')) { // any tag that registered a bind event
		this.bound = on
		this.fire('bind', on)
	}
	// bind children after the bound event to allow components to remove their
	// children inside the bind event handler before them getting bound, and
	// also so that children see a bound parent when they are getting bound.
	this.bind_children(on)
})

// create a text node from a string, quoting it automatically, with wrapping control.
// can also take a constructor or an existing node as argument.
function T(s, whitespace) {
	if (typeof s == 'function')
		s = s()
	if (isnode(s))
		return s
	else if (whitespace) {
		let e = document.createElement('span')
		e.style['white-space'] = whitespace
		e.textContent = s
		return e
	} else
		return document.createTextNode(s)
}

// like T() but clones nodes instead of passing them through.
function TC(s, whitespace) {
	if (typeof s == 'function')
		s = s()
	if (isnode(s))
		return s.clone()
	else
		return T(s, whitespace)
}

// create a html element or text node from a html string.
// if the string contains more than one element or text node, wrap them in a span.
function unsafe_html(s) {
	if (typeof s != 'string') // pass-through nulls and elements
		return s
	let span = document.createElement('span')
	span.unsafe_html = s.trim()
	return span.childNodes.length > 1 ? span : span.firstChild
}

function sanitize_html(s) {
	if (typeof s != 'string') // pass-through nulls and elements
		return s
	assert(DOMPurify.isSupported)
	return DOMPurify.sanitize(s)
}

function html(s) {
	return unsafe_html(sanitize_html(s))
}

// create a HTML element from an attribute map and a list of child nodes.
function tag(tag, attrs, ...children) {
	let e = document.createElement(tag)
	e.init_component()
	e.attrs = attrs
	if (children)
		e.add(...children)
	return e
}

div  = (...a) => tag('div' , ...a)
span = (...a) => tag('span', ...a)

Array.prototype.join_nodes = function(sep, parent_node) {

	if (
		(sep == null || this.length < 2) // no sep or sep won't be added
		&& !parent_node // no container
		&& this.filter(e => isstr(e)).length == this.length // all strings
	)
		return this.join(sep)

	parent_node = parent_node || span()
	let not_first
	for (let e of this) {
		if (sep != null && not_first)
			parent_node.add(TC(sep))
		parent_node.add(TC(e))
		not_first = true
	}
	return parent_node
}

method(Node, 'clone', function() {
	return this.cloneNode(true)
})

property(Element, 'html', {
	get: function() {
		return this.innerHTML
	},
	set: function(s) {
		this.unsafe_html = sanitize_html(s)
	}
})

property(Element, 'unsafe_html', {
	set: function(s) {
		this.bind_children(false)
		this.innerHTML = s
		this.init_child_components()
		if (this.isConnected)
			this.bind_children(true)
	},
})

method(Element, 'clear', function() {
	this.unsafe_html = null
	return this
})

method(Element, 'set', function(s, whitespace) {
	if (typeof s == 'function')
		s = s()
	if (isnode(s)) {
		if (iselem(s) && s.isConnected)
			s.bind(false)
		this.clear()
		this.append(s)
		if (iselem(s) && this.isConnected)
			s.bind(true)
	} else {
		this.textContent = s
		if (whitespace)
			this.style['white-space'] = whitespace
	}
	return this
})

method(Element, 'add', function(...args) {
	for (let s of args)
		if (s != null) {
			s = T(s)
			if (iselem(s) && s.isConnected)
				s.bind(false)
			this.append(s)
			if (iselem(s)) {
				if (this.isConnected)
					s.bind(true)
			}
		}
	return this
})

method(Element, 'insert', function(i0, ...args) {
	for (let i = args.length-1; i >= 0; i--) {
		let s = args[i]
		if (s != null) {
			s = T(s)
			if (iselem(s) && s.isConnected)
				s.bind(false)
			this.insertBefore(s, this.at[max(0, or(i0, 1/0))])
			if (iselem(s)) {
				if (this.isConnected)
					s.bind(true)
			}
		}
	}
	return this
})

override(Element, 'remove', function(inherited) {
	this.bind(false)
	inherited.call(this)
	return this
})

method(Element, 'replace', function(e0, s) {
	s = T(s)
	if (e0 != null) {
		if (s === e0)
			return this
		if (iselem(e0))
			e0.bind(false)
		this.replaceChild(s, e0)
	} else {
		this.appendChild(s)
	}
	if (iselem(s) && this.isConnected)
		s.bind(true)
	return this
})

// move element to a new parent and/or index without rebinding, unless
// the widget requires rebinding by returning false from `.do_move()`.
method(Element, 'move', function(pe, i) {
	assert(this.isConnected)
	pe = pe || this.parent
	let must_unbind = this.do_move && !this.do_move(pe, i)
	if (must_unbind)
		this.bind(false)
	if (pe == this.parent) // change index preserving current scroll.
		this.index == or(i, 1/0)
	else // change parent and index.
		pe.insertBefore(this, pe.at[max(0, or(i, 1/0))])
	if (must_unbind)
		this.bind(true)
})

// util to convert an array to a html bullet list.
{
let ul = function(a, ul_tag, ul_attrs, only_if_many) {
	if (only_if_many && a.length < 2)
		return a[0] || ''
	return tag(ul_tag, ul_attrs, ...a.map(s => tag('li', 0, s)))
}
Array.prototype.ul = function(attrs, only_if_many) { return ul(this, 'ul', attrs, only_if_many) }
Array.prototype.ol = function(attrs, only_if_many) { return ul(this, 'ol', attrs, only_if_many) }
}

/* instance method overriding for components ---------------------------------

NOTE: unlike global override(), e.override() cannot override built-in methods.
You can still use the global override() to override built-in methods in an
instance without disturbing the prototype, and just the same you can use
override_property_setter() to override a setter in an instance without
disturbing the prototype.

*/

method(Element, 'property', function(name, get, set) {
	return property(this, name, get, set)
})

method(Element, 'override', function(method, func) {
	let inherited = this[method] || noop
	this[method] = function(...args) {
		return func.call(this, inherited, ...args)
	}
})

method(Element, 'do_before', function(method, func) {
	let inherited = this[method]
	this[method] = inherited && function(...args) {
		func.call(this, ...args)
		inherited.call(this, ...args)
	} || func
})

method(Element, 'do_after', function(method, func) {
	let inherited = this[method]
	this[method] = inherited && function(...args) {
		inherited.call(this, ...args)
		func.call(this, ...args)
	} || func
})

/* events & event wrappers ---------------------------------------------------

NOTE: these wrappers block mouse events on any target that has attr `disabled`
or that has any ancestor with attr `disabled`. `pointer-events: none` is not
a solution because it makes click-through popups.

NOTE: preventing focusing is a matter of not-setting/removing attr `tabindex`
except for input elements that must have an explicit `tabindex=-1`.
*/

{
let installers = on.installers
let callers = on.callers

installers.bind = function() {
	this.bool_attr('_bind', true)
}

let resize_observer = new ResizeObserver(function(entries) {
	for (let entry of entries)
		entry.target.fire('resize', entry.contentRect, entry)
})
installers.resize = function() {
	if (this == window)
		return // built-in.
	if (this.__detecting_resize)
		return
	this.__detecting_resize = true
	let observing
	function bind(on) {
		if (on) {
			if (!observing) {
				resize_observer.observe(this)
				observing = true
			}
		} else {
			if (observing) {
				resize_observer.unobserve(this)
				observing = false
			}
		}
	}
	this.on('bind', bind)
	if (this.isConnected)
		bind.call(this, true)
}

callers.click = function(ev, f) {
	if (ev.target.effectively_disabled)
		return false
	if (ev.which == 1)
		return f.call(this, ev, ev.clientX, ev.clientY)
	else if (ev.which == 3)
		return this.fireup('rightclick', ev, ev.clientX, ev.clientY)
}

callers.dblclick = function(ev, f) {
	if (ev.target.effectively_disabled)
		return false
	if (ev.which == 1)
		return f.call(this, ev, ev.clientX, ev.clientY)
	else if (ev.which == 3)
		return this.fireup('rightdblclick', ev, ev.clientX, ev.clientY)
}

callers.pointerdown = function(ev, f) {
	if (ev.target.effectively_disabled)
		return false
	let ret
	if (ev.which == 1)
		ret = f.call(this, ev, ev.clientX, ev.clientY)
	else if (ev.which == 3)
		ret = this.fireup('rightpointerdown', ev, ev.clientX, ev.clientY)
	if (ret == 'capture') {
		this.setPointerCapture(ev.pointerId)
		this.pointer_captured = true
		ret = false
	}
	return ret
}

method(EventTarget, 'capture_pointer', function(ev, move, up) {
	move = or(move, return_false)
	up   = or(up  , return_false)
	let mx0 = ev.clientX
	let my0 = ev.clientY
	function wrap_move(ev, mx, my) {
		return move.call(this, ev, mx, my, mx0, my0)
	}
	function wrap_up(ev, mx, my) {
		this.off('pointermove', wrap_move)
		this.off('pointerup'  , wrap_up)
		return up.call(this, ev, mx, my, mx0, my0)
	}
	this.on('pointermove', wrap_move)
	this.on('pointerup'  , wrap_up)
	return 'capture'
})

callers.pointerup = function(ev, f) {
	if (ev.target.effectively_disabled)
		return false
	let ret
	try {
		if (ev.which == 1)
			ret = f.call(this, ev, ev.clientX, ev.clientY)
		else if (ev.which == 3)
			ret = this.fireup('rightpointerup', ev, ev.clientX, ev.clientY)
	} finally {
		this.pointer_captured = false
		if (this.hasPointerCapture(ev.pointerId))
			this.releasePointerCapture(ev.pointerId)
	}
	return ret
}

callers.pointermove = function(ev, f) {
	return f.call(this, ev, ev.clientX, ev.clientY)
}

callers.keydown = function(ev, f) {
	return f.call(this, ev.key, ev.shiftKey, ev.ctrlKey, ev.altKey, ev)
}
callers.keyup    = callers.keydown
callers.keypress = callers.keydown

callers.wheel = function(ev, f) {
	if (ev.target.effectively_disabled)
		return
	if (ev.deltaY) {
		let dy = ev.deltaY
		// 90% of Mozilla is funded by Google but they still hate each other...
		if (abs(dy) >= 100) // Chrome
			dy /= 100
		else
			dy /= 3 // Firefox
		return f.call(this, ev, dy, ev.clientX, ev.clientY)
	}
}

override(Event, 'stopPropagation', function(inherited, ...args) {
	inherited.call(this, ...args)
	this.propagation_stoppped = true
	// notify document of stopped events.
	if (this.type == 'pointerdown')
		document.fire('stopped_event', this)
})

// DOM load event.

function on_dom_load(fn) {
	if (document.readyState === 'loading')
		document.on('DOMContentLoaded', fn)
	else // `DOMContentLoaded` already fired
		fn()
}

function init_components() {
	root = document.documentElement  // for debugging, don't use in code.
	body = document.body // for debugging, don't use in code.
	head = document.head // for debugging, don't use in code.
	root.init_component()
	root.bind(true)
}

// inter-window event broadcasting.

window.addEventListener('storage', function(e) {
	// decode the message.
	if (e.key != '__broadcast')
		return
	let v = e.newValue
	if (!v)
		return
	v = json_arg(v)
	fire(v.topic, ...v.args)
})

// broadcast a message to other windows.
function broadcast(topic, ...args) {
	fire(topic, ...args)
	save('__broadcast', '')
	save('__broadcast', json({
		topic: topic,
		args: args,
	}))
	save('__broadcast', '')
}

}

// geometry wrappers ---------------------------------------------------------

function px(v) {
	return typeof v == 'number' ? v+'px' : v
}

property(Element, 'x1'   , { set: function(v) { if (v !== this.__x1) { this.__x1 = v; this.style.left          = px(v) } } })
property(Element, 'y1'   , { set: function(v) { if (v !== this.__y1) { this.__y1 = v; this.style.top           = px(v) } } })
property(Element, 'x2'   , { set: function(v) { if (v !== this.__x2) { this.__x2 = v; this.style.right         = px(v) } } })
property(Element, 'y2'   , { set: function(v) { if (v !== this.__y2) { this.__y2 = v; this.style.bottom        = px(v) } } })
property(Element, 'w'    , { set: function(v) { if (v !== this.__w ) { this.__w  = v; this.style.width         = px(v) } } })
property(Element, 'h'    , { set: function(v) { if (v !== this.__h ) { this.__h  = v; this.style.height        = px(v) } } })
property(Element, 'min_w', { set: function(v) { if (v !== this.__mw) { this.__mw = v; this.style['min-width' ] = px(v) } } })
property(Element, 'min_h', { set: function(v) { if (v !== this.__mh) { this.__mh = v; this.style['min-height'] = px(v) } } })
property(Element, 'max_w', { set: function(v) { if (v !== this.__Mw) { this.__Mw = v; this.style['max-width' ] = px(v) } } })
property(Element, 'max_h', { set: function(v) { if (v !== this.__Mh) { this.__Mh = v; this.style['max-height'] = px(v) } } })

alias(Element, 'x', 'x1')
alias(Element, 'y', 'y1')
alias(Element, 'rect', 'getBoundingClientRect')

alias(Element, 'cw', 'clientWidth')
alias(Element, 'ch', 'clientHeight')

alias(HTMLElement, 'ox', 'offsetLeft')
alias(HTMLElement, 'oy', 'offsetTop')

alias(DOMRectReadOnly, 'x' , 'left')
alias(DOMRectReadOnly, 'y' , 'top')
alias(DOMRectReadOnly, 'x1', 'left')
alias(DOMRectReadOnly, 'y1', 'top')
alias(DOMRectReadOnly, 'w' , 'width')
alias(DOMRectReadOnly, 'h' , 'height')
alias(DOMRectReadOnly, 'x2', 'right')
alias(DOMRectReadOnly, 'y2', 'bottom')

method(DOMRectReadOnly, 'contains', function(x, y) {
	return (
		(x >= this.left && x <= this.right) &&
		(y >= this.top  && y <= this.bottom))
})

method(DOMRectReadOnly, 'clip', function(r) { // from box2d.lua
	let x1 = this.x
	let y1 = this.y
	let w1 = this.w
	let h1 = this.h
	let x2 = r.x
	let y2 = r.y
	let w2 = r.w
	let h2 = r.h
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
	return new DOMRect(_x1, _y1, _w, _h)
})

{
let layout_changed = function() { document.fire('layout_changed') }
window.on('resize', layout_changed)
}

method(Window, 'rect', function() {
	return new DOMRect(0, 0, this.innerWidth, this.innerHeight)
})

function domrect(...args) { return new DOMRect(...args) }

// common state wrappers -----------------------------------------------------

method(Element, 'hide', function(on) {
	if (!arguments.length)
		on = true
	else
		on = !!on
	if (this.hidden == on)
		return
	this.hidden = on
})

method(Element, 'show', function(on) {
	if (!arguments.length)
		on = true
	this.hide(!on)
})

property(Element, 'hovered', function() {
	return this.matches(':hover')
})

property(Element, 'focused_element', function() {
	return this.querySelector(':focus')
})

property(Element, 'focused', function() {
	return document.activeElement == this
})

property(Element, 'hasfocus', function() {
	return this.contains(document.activeElement)
})

property(Element, 'effectively_focusable', function() {
	let t = this.tag, e = this
	return (
			t == 'button' || t == 'input' || t == 'select' || t == 'textarea'
			|| ((t == 'a' || t == 'area') && this.hasattr('href'))
			|| (e.hasattr('tabindex') && e.attr('tabindex') != '-1')
		) && !e.effectively_hidden && !e.effectively_disabled
})

method(Element, 'focusables', function() {
	let t = []
	let sel = 'button, a[href] area[href], input, select, textarea, '
		+ '[tabindex]:not([tabindex="-1"])'
	for (let e of this.$(sel)) {
		if (!e.effectively_hidden && !e.effectively_disabled)
			t.push(e)
	}
	return t
})

method(Element, 'focus_first', function() {
	if (this.effectively_focusable) {
		this.focus()
		return true
	}
	let e = this.$1('[focusfirst]')
	if (e && e.focus_first())
		return true
	e = this.focusables()[0]
	if (e) {
		e.focus()
		return true
	}
	return false
})

property(Element, 'effectively_disabled', {get: function() {
	return this.bool_attr('disabled')
		|| (this.parent && this.parent.effectively_disabled) || false
}})

property(Element, 'effectively_hidden', {get: function() {
	if (this.bool_attr('hidden'))
		return true
	let css = this.css()
	if (css.display == 'none')
		return true
	if (css.visibility == 'hidden')
		return true
	if (!this.parent)
		return true
	if (this.parent.effectively_hidden)
		return true
	return false
}})

/* faster variant that doesn't check `display: none` and `visibility: hidden` from CSS */
property(Element, 'effectively_hidden_nocss', {get: function() {
	if (this.bool_attr('hidden'))
		return true
	if (!this.parent)
		return true
	if (this.parent.effectively_hidden_nocss)
		return true
	return false
}})

// text editing --------------------------------------------------------------

alias(HTMLInputElement, 'select_range', 'setSelectionRange')

property(Element, 'contenteditable', {
	get: function() { return this.contentEditable == 'true' },
	set: function(v) { this.contentEditable = v ? 'true' : 'false' },
})

// for contenteditables.
method(HTMLElement, 'insert_at_caret', function(s) {
	let node = H(s)
	let sel = getSelection()
	let range = sel.getRangeAt(0)
	range.insertNode(node)
	range.setStartAfter(node)
	range.setEndAfter(node)
	sel.removeAllRanges()
	sel.addRange(range)
})

method(HTMLElement, 'select_all', function() {
	let range = document.createRange()
	range.selectNodeContents(this)
	let sel = getSelection()
	sel.removeAllRanges()
	sel.addRange(range)
})

method(HTMLElement, 'unselect', function() {
	let range = document.createRange()
	range.selectNodeContents(this)
	let sel = getSelection()
	sel.removeAllRanges()
})

// scrolling -----------------------------------------------------------------

function scroll_to_view_rect(x, y, w, h, pw, ph, sx, sy) {
	let min_sx = -x
	let min_sy = -y
	let max_sx = -(x + w - pw)
	let max_sy = -(y + h - ph)
	sx = clamp(sx, min_sx, max_sx)
	sy = clamp(sy, min_sy, max_sy)
	return [sx, sy]
}

method(Element, 'scroll_to_view_rect_offset', function(sx0, sy0, x, y, w, h) {
	let pw  = this.cw
	let ph  = this.ch
	if (sx0 == null) { sx0 = this.scrollLeft; }
	if (sy0 == null) { sy0 = this.scrollTop ; }
	let e = this
	let [sx, sy] = scroll_to_view_rect(x, y, w, h, pw, ph, -sx0, -sy0)
	return [-sx, -sy]
})

// scroll to make inside rectangle invisible.
method(Element, 'scroll_to_view_rect', function(sx0, sy0, x, y, w, h) {
	let [sx, sy] = this.scroll_to_view_rect_offset(sx0, sy0, x, y, w, h)
	this.scroll(sx, sy)
})

method(Element, 'make_visible_scroll_offset', function(sx0, sy0, parent) {
	parent = this.parent
	// TODO:
	//parent = parent || this.parent
	//let cr = this.rect()
	//let pr = parent.rect()
	//let x = cr.x - pr.x
	//let y = cr.y - pr.y
	let x = this.offsetLeft
	let y = this.offsetTop
	let w = this.offsetWidth
	let h = this.offsetHeight
	return parent.scroll_to_view_rect_offset(sx0, sy0, x, y, w, h)
})

// scroll parent to make self visible.
method(Element, 'make_visible', function() {
	let parent = this.parent
	while (parent && parent != document) {
		parent.scroll(...this.make_visible_scroll_offset(null, null, parent))
		parent = parent.parent
		break
	}
})

// check if element is partially or fully visible.
method(Element, 'is_in_viewport', function(m) {
	let r = this.rect()
	m = m || 0
	return (
		   (r.x2 + m) >= 0
		&& (r.y2 + m) >= 0
		&& (r.x1 - m) <= window.innerWidth
		&& (r.y1 - m) <= window.innerHeight
	)
})

// animation easing ----------------------------------------------------------

easing = obj() // from easing.lua

easing.reverse = (f, t, ...args) => 1 - f(1 - t, ...args)
easing.inout   = (f, t, ...args) => t < .5 ? .5 * f(t * 2, ...args) : .5 * (1 - f((1 - t) * 2, ...args)) + .5
easing.outin   = (f, t, ...args) => t < .5 ? .5 * (1 - f(1 - t * 2, ...args)) : .5 * (1 - (1 - f(1 - (1 - t) * 2, ...args))) + .5

// ease any interpolation function.
easing.ease = function(f, way, t, ...args) {
	f = or(easing[f], f)
	if (way == 'out')
		return easing.reverse(f, t, ...args)
	else if (way == 'inout')
		return easing.inout(f, t, ...args)
	else if (way == 'outin')
		return easing.outin(f, t, ...args)
	else
		return f(t, ...args)
}

// actual easing functions.
easing.linear = t => t
easing.quad   = t => t**2
easing.cubic  = t => t**3
easing.quart  = t => t**4
easing.quint  = t => t**5
easing.expo   = t => 2**(10 * (t - 1))
easing.sine   = t => -cos(t * (PI * .5)) + 1
easing.circ   = t => -(sqrt(1 - t**2) - 1)
easing.back   = t => t**2 * (2.7 * t - 1.7)

easing.bounce = function(t) {
	if (t < 1 / 2.75) {
		return 7.5625 * t**2
	} else if (t < 2 / 2.75) {
		t = t - 1.5 / 2.75
		return 7.5625 * t**2 + 0.75
	} else if (t < 2.5 / 2.75) {
		t = t - 2.25 / 2.75
		return 7.5625 * t**2 + 0.9375
	} else {
 		t = t - 2.625 / 2.75
		return 7.5625 * t**2 + 0.984375
	}
}

function raf(f, last_id) {
	return last_id == null ? requestAnimationFrame(f) : last_id
}
cancel_raf = cancelAnimationFrame

raf_wrap.cancel = obj()

function raf_wrap(f) {
	let id
	function raf_f() {
		id = null
		f()
	}
	return function(cancel) {
		if (cancel == raf_wrap.cancel) {
			if (id != null) {
				cancel_raf(id)
				id = null
			}
		} else {
			id = raf(raf_f, id)
		}
	}
}

function transition(f, dt, y0, y1, ease_f, ease_way, ...ease_args) {
	dt = or(dt, 1)
	y0 = or(y0, 0)
	y1 = or(y1, 1)
	ease_f = or(ease_f, 'cubic')
	let raf_id, t0, finished
	let e = {}
	e.stop = function() {
		if (raf_id)
			cancel_raf(raf_id)
		finished = true
	}
	let wrapper = function(t) {
		t0 = or(t0, t)
		let lin_x = lerp(t, t0, t0 + dt * 1000, 0, 1)
		if (lin_x < 1 && !finished) {
			let eas_x = easing.ease(ease_f, ease_way, lin_x, ...ease_args)
			let y = lerp(eas_x, 0, 1, y0, y1)
			if (f(y, lin_x) !== false)
				raf_id = raf(wrapper)
		} else {
			f(y1, lin_x, true)
			if (e.finish)
				e.finish()
			finished = true
		}
	}
	raf_id = raf(wrapper)
	return e
}

// hit-testing ---------------------------------------------------------------

{

// check if a point (x0, y0) is inside rect (x, y, w, h)
// offseted by d1 internally and d2 externally.
let hit = function(x0, y0, d1, d2, x, y, w, h) {
	x = x - d1
	y = y - d1
	w = w + d1 + d2
	h = h + d1 + d2
	return x0 >= x && x0 <= x + w && y0 >= y && y0 <= y + h
}

function hit_test_rect_sides(x0, y0, d1, d2, x, y, w, h) {
	if (hit(x0, y0, d1, d2, x, y, 0, 0))
		return 'top_left'
	else if (hit(x0, y0, d1, d2, x + w, y, 0, 0))
		return 'top_right'
	else if (hit(x0, y0, d1, d2, x, y + h, 0, 0))
		return 'bottom_left'
	else if (hit(x0, y0, d1, d2, x + w, y + h, 0, 0))
		return 'bottom_right'
	else if (hit(x0, y0, d1, d2, x, y, w, 0))
		return 'top'
	else if (hit(x0, y0, d1, d2, x, y + h, w, 0))
		return 'bottom'
	else if (hit(x0, y0, d1, d2, x, y, 0, h))
		return 'left'
	else if (hit(x0, y0, d1, d2, x + w, y, 0, h))
		return 'right'
}

method(Element, 'hit_test_sides', function(mx, my, d1, d2) {
	let r = this.rect()
	return hit_test_rect_sides(mx, my, or(d1, 5), or(d2, 5), r.x, r.y, r.w, r.h)
})

}

// canvas --------------------------------------------------------------------

method(CanvasRenderingContext2D, 'clear', function() {
	this.clearRect(0, 0, this.canvas.width, this.canvas.height)
})

/* popup pattern -------------------------------------------------------------

Why is this so complicated? Because the forever not-quite-there-yet web
platform doesn't have the notion of a global z-index so we can't have
relatively positioned and styled popups that are also painted last i.e.
on top of everything, so we have to choose between popups that are
well-positioned but most probably clipped or obscured by other elements,
or popups that stay on top but have to be manually positioned and styled,
and kept in sync with the position of their target. We choose the latter
since we have a lot of implicit "stacking contexts" (read: abstraction
leaks of the graphics engine) and we try to auto-update the popup position
the best we can, but there will be cases where you'll have to call popup()
to update the popup's position manually. We simply don't have an observer
for tracking changes to an element's position on screen or relative to
another element.

Calls `popup_visible` to allow changing/animating popup's visibility
based on target's hover state or focused state.

*/

{

let popup_timer = function() {

	let tm = {}
	let timer_id
	let handlers = new Set()
	let frequency = .25

	function tick() {
		for (let f of handlers)
			f()
	}

	tm.add = function(f) {
		handlers.add(f)
		timer_id = timer_id || setInterval(tick, frequency * 1000)
	}

	tm.remove = function(f) {
		handlers.delete(f)
		if (!handlers.size) {
			clearInterval(timer_id)
			timer_id = null
		}
	}

	return tm
}

popup_timer = popup_timer()

property(Element, 'popup_level',
	function() {
		if (this._popup_level != null)
			return this._popup_level
		if (iselem(this.parent))
			return this.parent.popup_level
		else
			return 0
	},
	function(n) {
		this._popup_level = n
	}
)

let popup_state = function(e) {

	let s = {}

	let target, side, align, px, py, pw, ph, ox, oy

	s.update = function(target1, side1, align1, px1, py1, pw1, ph1, ox1, oy1) {
		side  = or(side1, side)
		align = or(align1, align)
		px    = or(px1, px)
		py    = or(py1, py)
		pw    = or(pw1, pw)
		ph    = or(ph1, ph)
		ox    = or(ox1, ox)
		oy    = or(oy1, oy)
		target1 = strict_or(target1, target) // because `null` means remove...
		if (target1 != target) {
			if (target)
				free()
			target = target1 && E(target1)
			if (target)
				init()
			e.popup_target = target
		}
		if (!should_show()) // prevent expensive raf() if hidden.
			e.hide()
		else
			raf(do_update)
	}

	function init() {
		if (target != document.body) { // prevent infinite recursion.
			target.on('bind', target_bind)
		}
		if (target.isConnected || target.bound)
			target_bind(true)
	}

	function free() {
		if (target) {
			target_bind(false)
			target.off('bind', target_bind)
			target = null
		}
	}

	function window_scroll(ev) {
		if (target && ev.target.contains(target))
			raf(update)
	}

	let fixed

	function target_bind(on) {
		fixed = null
		if (on) {
			let css = target.css()
			// simulate css font inheritance.
			// NOTE: this overrides the same properties declared in css when
			// the element is displayed as a popup, which leaves `!important`
			// as the only way to override back these properties from css.
			e.__css_inherited = obj()
			for (let k of ['font-family', 'font-size', 'line-height']) {
				if (!e.style[k]) {
					e.style[k] = css[k]
					e.__css_inherited[k] = true
				}
			}
			e.class('popup')
			document.body.add(e)
			if (e.local_z == null) // get local z-index from css on first bind.
				e.local_z = num(e.css('z-index'), 0)
			e.popup_level = target.popup_level + 1
			// NOTE: this limits local z-index range to 0..9.
			e.style.zIndex = e.popup_level * 10 + e.local_z
			update()
			popup_timer.add(update)
		} else {
			for (let k in e.__css_inherited)
				e.style[k] = null
			e.remove()
			e.popup_level = null
			e.local_z = null
			e.class('popup', false)
			popup_timer.remove(update)
		}
		e.fire('popup_bind', on, target)

		// changes in target size updates the popup position.
		if (target.detect_resize) {
			target.detect_resize()
			target.on('resize', update, on)
		}

		// allow popup_update() to change popup visibility on target hover.
		// NOTE: this doesn't work for inner alignments, it will flicker!
		target.on('pointerenter', update, on)
		target.on('pointerleave', update, on)

		// allow popup_update() to change popup visibility on target focus.
		target.on('focusin' , update, on)
		target.on('focusout', update, on)

		// scrolling on any of the target's parents updates the popup position.
		window.on('scroll', window_scroll, on, true)

		// layout changes update the popup position.
		document.on('layout_changed', update, on)
	}

	function layout(w, h, side, align) {

		let tr = target.rect()

		let x = ox || 0
		let y = oy || 0
		let tx1 = tr.x + or(px, 0)
		let ty1 = tr.y + or(py, 0)
		let tx2 = tx1 + or(pw, tr.w)
		let ty2 = ty1 + or(ph, tr.h)
		let tw = tx2 - tx1
		let th = ty2 - ty1

		let x0, y0
		if (side == 'right') {
			;[x0, y0] = [tx2, ty1]
		} else if (side == 'left') {
			;[x0, y0] = [tx1 - w, ty1]
		} else if (side == 'top') {
			;[x0, y0] = [tx1, ty1 - h]
		} else if (side == 'bottom') {
			side = 'bottom'
			;[x0, y0] = [tx1, ty2]
		} else if (side == 'inner-right') {
		 	;[x0, y0] = [tx2 - w, ty1]
		} else if (side == 'inner-left') {
		 	;[x0, y0] = [tx1, ty1]
		} else if (side == 'inner-top') {
		 	;[x0, y0] = [tx1, ty1]
		} else if (side == 'inner-bottom') {
		 	;[x0, y0] = [tx1, ty2 - h]
		} else if (side == 'inner-center') {
			;[x0, y0] = [
				tx1 + (tw - w) / 2,
				ty1 + (th - h) / 2
			]
		} else {
			assert(false)
		}

		let sd = side.replace('inner-', '')
		let sdx = sd == 'left' || sd == 'right'
		let sdy = sd == 'top'  || sd == 'bottom'
		if (align == 'center' && sdy)
			x0 = x0 + (tw - w) / 2
		else if (align == 'center' && sdx)
			y0 = y0 + (th - h) / 2
		else if (align == 'end' && sdy)
			x0 = x0 + tw - w
		else if (align == 'end' && sdx)
			y0 = y0 + th - h

		x0 += (side == 'inner-right'  || (sdy && align == 'end')) ? -x : x
		y0 += (side == 'inner-bottom' || (sdx && align == 'end')) ? -y : y

		return [x0, y0]
	}

	function should_show() {
		if (!target || !target.isConnected)
			return
		if (target.effectively_hidden_nocss)
			return
		if (e.popup_visible)
			if (!e.popup_visible(target))
				return
		return true
	}

	function do_update() {

		if (!target || target.effectively_hidden) { // slow-to-calculate
			e.hide()
			return
		} else {
			e.show()
		}

		if (fixed == null)
			fixed = e.css().position == 'fixed'

		let er = e.rect()
		let w = er.w
		let h = er.h

		let side1 = side
		let align1 = align
		let [x0, y0] = layout(w, h, side1, align1)

		// if popup doesn't fit the screen, first try to change its side
		// or alignment and relayout, and if that didn't work, its offset.

		let br = window.rect()
		let d = 10
		let bw = br.w
		let bh = br.h

		let out_x1 = x0 < d
		let out_y1 = y0 < d
		let out_x2 = x0 + w > (bw - d)
		let out_y2 = y0 + h > (bh - d)

		let re
		if (side1 == 'bottom' && out_y2) {
			re = 1; side1 = 'top'
		} else if (side1 == 'top' && out_y1) {
			re = 1; side1 = 'bottom'
		} else if (side1 == 'right' && out_x2) {
			re = 1; side1 = 'left'
		} else if (side1 == 'top' && out_x1) {
			re = 1; side1 = 'bottom'
		}

		let vert =
			   side1 == 'bottom'
			|| side1 == 'top'
			|| side1 == 'inner-bottom'
			|| side1 == 'inner-top'

		if (align1 == 'end' && ((vert && out_x2) || (!vert && out_y2))) {
			re = 1; align1 = 'start'
		} else if (align1 == 'start' && ((vert && out_x1) || (!vert && out_y1))) {
			re = 1; align1 = 'end'
		}

		if (re)
			[x0, y0] = layout(w, h, side1, align1)

		// if nothing else works, adjust the offset to fit the screen.
		let ox2 = max(0, x0 + w - (bw - d))
		let ox1 = min(0, x0)
		let oy2 = max(0, y0 + h - (bh - d))
		let oy1 = min(0, y0)
		x0 -= ox1 ? ox1 : ox2
		y0 -= oy1 ? oy1 : oy2

		e.x = fixed ? x0 : window.scrollX + x0
		e.y = fixed ? y0 : window.scrollY + y0

		if (e.popup_updated)
			e.popup_updated(target, side1, align1)

	}

	function update() {
		if (!should_show()) {
			e.hide()
			return
		}
		do_update()
	}

	return s
}

method(HTMLElement, 'popup', function(target, side, align, px, py, pw, ph, ox, oy) {
	this.__popup_state = this.__popup_state || popup_state(this)
	this.__popup_state.update(target, side || 'bottom', align || 'start', px, py, pw, ph, ox, oy)
})

}

// modal window pattern ------------------------------------------------------

method(Element, 'modal', function(on) {
	let e = this
	if (on == false) {
		if (e.dialog) {
			e.class('modal', false)
			e.dialog.remove()
			e.dialog = null
		}
	} else if (!e.dialog) {
		let dialog = div({class: 'modal-dialog'}, e)
		e.dialog = dialog
		e.class('modal')
		dialog.popup_level = 10 // make popups aware of our level.
		document.body.add(dialog)
		dialog.focus_first()
	}
	return e
})

// tab cycling within the app, popups & modauls ------------------------------

document.on('keydown', function(key, shift, ctrl, alt, ev) {
	if (key == 'Tab') {
		let popup = ev.target.closest('.popup, .modal')
		popup = popup || document.body // TODO: make this configurable.
		if (!popup)
			return
		let focusables = popup.focusables()
		if (!focusables.length)
			return
		if (shift && ev.target == focusables[0]) {
			focusables.last.focus()
			return false
		} else if (!shift && ev.target == focusables.last) {
			focusables[0].focus()
			return false
		}
	}
})

// quick overlays ------------------------------------------------------------

function overlay(attrs, content) {
	let e = div(attrs)
	e.style = `
		position: absolute;
		left: 0;
		top: 0;
		right: 0;
		bottom: 0;
		display: flex;
		overflow: auto;
		justify-content: center;
	` + (attrs && attrs.style || '')
	if (content == null)
		content = div()
	e.set(content)
	e.content = e.at[0]
	e.content.style['margin'] = 'auto' // center it.
	return e
}

// live-move list element pattern --------------------------------------------

// implements:
//   move_element_start(move_i, move_n, i1, i2[, x1, x2])
//   move_element_update(elem_x, [i1, i2, x1, x2])
// uses:
//   movable_element_size(elem_i) -> w
//   set_movable_element_pos(i, x, moving)
//
function live_move_mixin(e) {

	e = e || {}

	let move_i1, move_i2, i1, i2, i1x, i2x, offsetx
	let move_x, over_i, over_p, over_x
	let sizes = []
	let positions = []

	e.move_element_start = function(move_i, move_n, _i1, _i2, _i1x, _i2x, _offsetx) {
		move_n = or(move_n, 1)
		move_i1 = move_i
		move_i2 = move_i + move_n
		move_x = null
		over_i = null
		over_x = null
		i1  = _i1
		i2  = _i2
		i1x = _i1x
		i2x = _i2x
		offsetx = _offsetx || 0
		sizes    .length = i2 - i1
		positions.length = i2 - i1
		for (let i = i1; i < i2; i++)
			sizes[i] = e.movable_element_size(i)
		if (i1x == null) {
			assert(i1 == 0)
			i1x = 0
			i2x = i1x
			for (let i = i1; i < i2; i++) {
				if (i < move_i1 || i >= move_i2)
					i2x += sizes[i]
			}
		}
	}

	e.move_element_stop = function() {
		set_moving_element_pos(over_x)
		return over_i
	}

	function hit_test(elem_x) {
		let x = i1x
		let x0 = i1x
		let last_over_i = over_i
		let new_over_i, new_over_p
		for (let i = i1; i < i2; i++) {
			if (i < move_i1 || i >= move_i2) {
				let w = sizes[i]
				let x1 = x + w / 2
				if (elem_x < x1) {
					new_over_i = i
					new_over_p = lerp(elem_x, x0, x1, 0, 1)
					over_i = new_over_i
					over_p = new_over_p
					return new_over_i != last_over_i
				}
				x += w
				x0 = x1
			}
		}
		new_over_i = i2
		x1 = i2x
		new_over_p = lerp(elem_x, x0, x1, 0, 1)
		over_i = new_over_i
		over_p = new_over_p
		return new_over_i != last_over_i
	}

 	// `[i1..i2)` index generator with `[move_i1..move_i2)` elements moved.
	function each_index(f) {
		if (over_i < move_i1) { // moving upwards
			for (let i = i1     ; i < over_i ; i++) f(i)
			for (let i = move_i1; i < move_i2; i++) f(i, true)
			for (let i = over_i ; i < move_i1; i++) f(i)
			for (let i = move_i2; i < i2     ; i++) f(i)
		} else {
			for (let i = i1     ; i < move_i1; i++) f(i)
			for (let i = move_i2; i < over_i ; i++) f(i)
			for (let i = move_i1; i < move_i2; i++) f(i, true)
			for (let i = over_i ; i <  i2    ; i++) f(i)
		}
	}

	let move_ri1, move_ri2, move_vi1

	function set_moving_element_pos(x, moving) {
		if (move_ri1 != null)
			for (let i = move_ri1; i < move_ri2; i++) {
				positions[i] = offsetx + x
				e.set_movable_element_pos(i, offsetx + x, moving)
				x += sizes[i]
			}
	}

	e.move_element_update = function(elem_x) {
		elem_x = clamp(elem_x, i1x, i2x)
		if (elem_x != move_x) {
			move_x = elem_x
			e.move_x = move_x
			if (hit_test(move_x)) {
				e.over_i = over_i
				e.over_p = over_p
				let x = i1x
				move_ri1 = null
				move_ri2 = null
				over_x = null
				each_index(function(i, moving) {
					if (moving) {
						over_x = or(over_x, x)
						move_ri1 = or(move_ri1, i)
						move_ri2 = i+1
					} else {
						positions[i] = offsetx + x
						e.set_movable_element_pos(i, offsetx + x)
					}
					x += sizes[i]
				})
			}
			set_moving_element_pos(move_x, true)
		}
		return positions
	}

	return e
}


// lazy image loading --------------------------------------------------------

{
let lazy_load_all = function() {
	for (let img of $('img[data-src]')) {
		if (img.is_in_viewport(300)) {
			let src = img.attr('data-src')
			img.attr('data-src', null)
			img.attr('src', src)
		}
	}
}
window.on('scroll', lazy_load_all)
window.on('resize', lazy_load_all)
on_dom_load(function() {
	document.body.on('scroll', lazy_load_all)
})

let lazy_load = function(img) {
	if (img.is_in_viewport(300)) {
		let src = img.attr('data-src')
		img.attr('data-src', null)
		img.attr('src', src)
	}
}
bind_component('img', lazy_load, 'img[data-src]')
}

// timeago auto-updating -----------------------------------------------------

setInterval(function() {
	for (let e of $('[timeago]')) {
		let t = num(e.attr('time'))
		if (!t) {
			// set client-relative time from timeago attribute.
			let time_ago = num(e.attr('timeago'))
			if (!time_ago)
				return
			t = time() - time_ago
			e.attr('time', t)
		}
		e.set(t.timeago())
	}
}, 60 * 1000)


// exec'ing js scripts inside html -------------------------------------------

bind_component('script', function(e) {
	if (e.type && e.type != 'javascript')
		return
	if (e.src)
		return
	if (!e.hasattr('runit'))
		return
	eval(e.text)
})
