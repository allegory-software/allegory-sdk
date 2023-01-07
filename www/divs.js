/*

	DOM API & web components.
	Written by Cosmin Apreutesei. Public domain.

	Depends on:
		glue.js
		divs.css

	CSS:
		[hidden]
		[disabled]
		.popup
		.modal
		.modal-overlay

	Must call on DOM load:
		init_components()

	debugging:
		e.debug()
		e.debug_if()
		e.debug_open_if()
		e.debug_close_if()
		e.trace()
		e.trace_if()
		e.debug_name
		e.debug_anon_name()
	element attribute manipulation:
		e.hasattr(k)
		e.attr(k[, v]) -> v
		e.bool_attr(k[, v]) -> v
		e.closest_attr(k) -> v
		e.attrs = {k: v}
		e.tag
	element CSS class list manipulation:
		e.hasclass(k)
		e.class('k1 ...'[, enable])
		e.switch_class(k1, k2, normal)
		e.classess = 'k1 k2 ...'
	access to element computed styles:
		e.css([k][, state])
	CSS querying:
		css_class_prop(class, prop) -> v
		fontawesome_char(name) -> s
	DOM navigation including text nodes:
		n.nodes -> nlist, n.nodes[i], n.nodes.len, n.parent
		n.first_node, n.last_node, n.next_node, n.prev_node
	DOM navigation excluding text nodes:
		e.at[i], e.len, e.at.length, e.parent
		e.index
		e.first, e.last, e.next, e.prev
	DOM querying:
		iselem(v) -> t|f
		isnode(v) -> t|f
		e.$(sel) -> nlist
		e.$1(sel|e) -> e
		$(sel) -> nlist
		$1(sel|e) -> e
		nlist.each(f)
		nlist.trim() -> [n1,...]|null
		root, body, head
	DOM de/serialization:
		e.html -> s
		[unsafe_]html(s) -> e
		e.[unsafe_]html = s
	DOM manipulation with lifecycle management:
		T[C](te[,whitespace]) where `te` is f|e|text_str
		e.clone()
		e.set(te)
		e.add(te1,...)
		e.insert(i, te1,...)
		e.replace([e0], te)
		e.move([pe], [i0])
		e.clear()
		tag(tag, [attrs], e1,...)
		div(...)
		span(...)
		element(tag, options...)
		[].join_nodes([separator])
	SVG elements:
		svg_tag(tag, [attrs], e1,...)
		svg([attrs], e1, ...) -> svg
		svg_arc_path(x, y, r, a1, a2, ['M'|'L'])
		svg.path(attrs) -> svg_path
		svg.text(attrs) -> svg_text
	method overriding:
		e.override(method, f)
		e.do_before(method, f)
		e.do_after(method, f)
	properties:
		e.property(name, [get],[set] | descriptor)
		e.prop(name, attrs)
		e.alias(new_name, existing_name)
		e.notify_id_changed()
		e.xoff()
		e.xon()
		e.xsave()
		e.set_prop(k, v)
		e.get_prop(k) -> v
		e.get_prop_attrs(k) -> {attr->val}
		e.get_props() -> {k->attrs}
		e.serialize_prop(k) -> s
		e.element_links()
	deferred DOM updating:
		e.update([opt])
		e.on_update(f)
		e.on_measure(f)
		e.on_position(f)
	components:
		register_component(tag, initializer, [selector])
		e.init_child_components()
		e.initialized -> t|f
		e.bind(t|f)
		e.on_bind(f)
		^e.bind(on)
		^window.element_bind(e, on)
		^window['ID.bind'](e, on)
		e.bound -> t|f
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
		scrollbar_widths() -> [vs_w, hs_h]
		scrollbox_client_dimensions(w, h, cw, ch, [overflow_x], [overflow_y], [cs_w], [hs_h])
	animation frames:
		raf(f) -> raf_id
		cancel_raf(raf_id)
		in_raf -> t|f
		raf_wrap(f) -> wf
			wf()
			wf.cancel()
	animation easing:
		transition(f, [dt], [x0], [x1], [easing]) -> tr
			tr.stop()
			tr.finish = func
	hit testing:
		hit_test_rect_sides(x0, y0, d1, d2, x, y, w, h)
		e.hit_test_sides(mx, my, [d1], [d2])
	canvas:
		e.clear()
	UI patterns:
		e.modal([on])
		overlay(attrs, content)
		live_move_mixin(e)
		lazy-loading of <img data-src="">
		auto-updating of <tag timeago time="">
		exec-ing of <script run> scripts from injected html
	popups:
		e.popup([side], [align])
		e.popup_side
		e.popup_align
		e.popup_{x1,y1,x2,y2}
		e.popup_fixed
	lists:
		e.make_list()
	css dev tools:
		css_report_specificity(file, max_spec)
	composable css:
		`--inc: cls1 ...;` css declarations.

*/

{

// debugging -----------------------------------------------------------------

DEBUG_INIT = false
DEBUG_BIND = false
DEBUG_ELEMENT_BIND = false
PROFILE_BIND_TIME = true
SLOW_BIND_TIME_MS = 10
DEBUG_UPDATE = false

let e = Element.prototype

let debug_indent = ''

e.debug_anon_name = function() {  // stub
	return this.tag
}

let debug_name = function(e, suffix) {
	suffix = catany('>', e.id || e.debug_anon_name(), suffix)
	if (e.id) // enough context
		return suffix
	if (!repl(e.parent, document))
		return suffix
	return debug_name(e.parent, suffix)
}
property(e, 'debug_name', function() { return debug_name(this) })

e.debug = function(action, ...args) {
	debug(debug_indent + (action || ''), this.debug_name, ...args)
}

e.debug_if = function(cond, ...args) {
	if (!cond) return
	this.debug(...args)
}

e.debug_open_if = function(cond, ...args) {
	if (!cond) return
	this.debug(...args)
	debug_indent += '  '
}

e.debug_close_if = function(cond) {
	if (!cond) return
	debug_indent = debug_indent.slice(2)
}

e.trace = function(...args) {
	trace(this.debug_name, ...args)
}

e.trace_if = function(cond, ...args) {
	if (!cond) return
	trace(this.debug_name, ...args)
}

// element attribute manipulation --------------------------------------------

alias(Element, 'hasattr', 'hasAttribute')

// NOTE: JS values `true`, `false` and `undefined` cannot be stored in an attribute:
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
		let t = obj()
		for (var i = 0, n = this.attributes.length; i < n; i++) {
			let attr = this.attributes[i]
			t[attr.name] = attr.value
		}
		return t
	},
	set: function(attrs) {
		if (attrs)
			for (let k in attrs)
				this.attr(k, attrs[k])
	}
})

// get the attr value of the closest parent that has it.
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

// dom tree navigation for elements, skipping over text nodes ----------------

alias(Element, 'at'     , 'children')
alias(Element, 'len'    , 'childElementCount')
alias(Element, 'first'  , 'firstElementChild')
alias(Element, 'last'   , 'lastElementChild')
alias(Element, 'next'   , 'nextElementSibling')
alias(Element, 'prev'   , 'previousElementSibling')

// dom tree navigation for nodes ---------------------------------------------
// also faster for elements when you know that you don't have text nodes.

alias(Node, 'parent'     , 'parentNode')
alias(Node, 'nodes'      , 'childNodes')
alias(Node, 'first_node' , 'firstChild')
alias(Node, 'last_node'  , 'lastChild')
alias(Node, 'next_node'  , 'nextSibling')
alias(Node, 'prev_node'  , 'previousSibling')

alias(NodeList, 'len', 'length')

method(NodeList, 'trim', function() {
	let a = []
	let i1 = 0
	while (this[i1] instanceof Text && !this[i1].textContent.trim()) i1++
	let i2 = this.length-1
	while (this[i2] instanceof Text && !this[i2].textContent.trim()) i2--
	for (; i1 <= i2; i1++)
		a.push(this[i1])
	return a.length ? a : null
})

// dom tree querying ---------------------------------------------------------

function iselem(e) { return e instanceof Element }
function isnode(e) { return e instanceof Node }

// NOTE: spec says the search is depth-first and we use that.
alias(Element         , '$', 'querySelectorAll')
alias(DocumentFragment, '$', 'querySelectorAll')
function $(s) { return document.querySelectorAll(s) }

alias(Element         , '$1', 'querySelector')
alias(DocumentFragment, '$1', 'querySelector')
function $1(s) { return typeof s == 'string' ? document.querySelector(s) : s }

method(NodeList, 'each', Array.prototype.forEach)

property(NodeList, 'first', function() { return this[0] })
property(NodeList, 'last' , function() { return this[this.length-1] })

/* safe DOM manipulation with lifecycle management ---------------------------

The DOM API works with strings, nodes, arrays of nodes and also functions
that will be called to return those objects (we call those constructors).

The "lifecycle management" part of this is basically poor man's web components.
The reason we're reinventing web components is because the actual web components
API built into the browser is unusable. Needless to say, all DOM manipulation
needs to be done through this API exclusively for components to work.

Components can be either attached to the DOM (bound) or not. When bound they
become alive, when unbound they die and must remove all event handlers that
they registered in document, window or other external components.

When a component is initialized, its parents are only partially initialized
so take that into account if you mess with them at that stage.

When a component is bound, its parents are already bound and its children unbound.
When a component is unbound, its children are still bound and its parents unbound.

Moving bound elements to an unbound tree will unbind them.
Adding unbound elements to the bound tree will bind them.
Moving elements around in the bound tree will *not* rebind them.

*/

let component_init = obj() // {tag->init}
let component_selector = obj() // {tag->selector}

function register_component(tag, init, selector) {
	let tagName = tag.upper()
	selector = selector || tagName
	component_init[tagName] = init
	component_selector[tagName] = selector
}

// NOT for users to call!
method(Element, 'init_component', function(...args) {
	if (this.initialized)
		return
	let tagName = this.tagName
	let init = component_init[tagName]
	let sel = component_selector[tagName]
	if (init && (sel == tagName || this.matches(sel))) {
		init(this, ...args)
		this.initialized = true
	} else {
		this.init_child_components()
	}
})

// the component is responsible for calling init_child_components()
// in its initializer if it knows it can have components as children.
method(Element, 'init_child_components', function() {
	if (this.len)
		for (let ce of this.children)
			ce.init_component()
})

// NOT for users to call!
property(Element, 'bound', {
	get: function() {
		if (this._bound != null)
			return this._bound
		let p = this.parent
		if (!p)
			return false
		if (p == document)
			return true
		return p.bound
	},
	set: function(bound) {
		this._bound = bound
	}
})

// NOT for users to call!
method(Element, 'bind_children', function bind_children(on) {
	if (!this.len)
		return
	assert(isbool(on))
	for (let ce of this.children)
		ce.bind(on)
})

// NOT for users to call!
method(Element, 'bind', function bind(on) {
	assert(isbool(on))
	if (this._bound != null) { // any tag that called on('bind') or on_bind()
		if (this._bound == on)
			return
		this._bound = on
		this.do_bind(on)
	}
	// bind children after their parent is bound to allow components to remove
	// their children inside the bind event handler before them getting bound,
	// and also so that children see a bound parent when they are getting bound.
	this.bind_children(on)
})

method(Element, 'on_bind', function(f) {
	if (this._bound == null)
		this._bound = this.bound
	this.do_after('do_bind', f)
})

// create a text node from a stringable. calls a constructor first.
// wraps the node in a span if wrapping control is specified.
// elements, nulls and arrays pass-through regardless of wrapping control.
// TODO: remove this!
function T(s, whitespace) {
	if (isfunc(s)) // constructor
		s = s()
	if (s == null || iselem(s) || isarray(s)) // pass-through
		return s
	// node or string or stringable: pass-through or create node.
	s = isnode(s) ? s : document.createTextNode(s)
	if (whitespace) // wrap in span to set whitespace
		s = document.createElement('span').set(s, whitespace)
	return s
}

// like T() but clones nodes instead of passing them through.
// TODO: remove this!
function TC(s, whitespace) {
	if (typeof s == 'function')
		s = s()
	if (isnode(s))
		s = s.clone()
	return T(s, whitespace)
}

// create a html element or text node from a html string.
// if the string contains more than one node, return an array of nodes.
function unsafe_html(s) {
	if (typeof s != 'string') // pass-through: nulls, elements, etc.
		return s
	let span = document.createElement('span')
	span.unsafe_html = s.trim()
	return span.childNodes.length > 1 ? [...span.nodes] : span.firstChild
}

function sanitize_html(s) {
	if (typeof s != 'string') // pass-through: nulls, elements, etc.
		return s
	assert(DOMPurify.isSupported)
	return DOMPurify.sanitize(s)
}

function html(s) {
	return unsafe_html(sanitize_html(s))
}

// create a HTML element from an attribute map and a list of child nodes.
// skips nulls, calls constructors, expands arrays.
function tag(tag, attrs, ...children) {
	let e = document.createElement(tag)
	e.attrs = attrs
	for (let s of children) {
		if (isfunc(s))
			s = s()
		if (s == null)
			continue
		if (isarray(s))
			for (let cs of s)
				e.append(cs)
		else
			e.append(s)
	}
	e.init_component()
	return e
}

div  = (...a) => tag('div' , ...a)
span = (...a) => tag('span', ...a)

function element(tag, ...args) {
	let e = document.createElement(tag)
	e.init_component(...args)
	return e
}

function svg_tag(tag, attrs, ...children) {
	let e = document.createElementNS('http://www.w3.org/2000/svg', tag)
	e.attrs = attrs
	for (let s of children) {
		if (isfunc(s))
			s = s()
		if (s == null)
			continue
		if (isarray(s))
			for (let cs of s)
				e.append(cs)
		else
			e.append(s)
	}
	return e
}

function svg(...args) { return svg_tag('svg', ...args) }

function svg_arc_path(x, y, r, a1, a2, start_cmd) {
	let [x1, y1] = point_around(x, y, r, a1)
	let [x2, y2] = point_around(x, y, r, a2)
	let large_arc_flag = a2 - a1 <= 180 ? '0' : '1'
	let a = start_cmd ? [start_cmd, x1, y1] : []
	a.extend(['A', r, r, 0, large_arc_flag, 0, x2, y2])
	return a.join(' ')
}

method(SVGElement, 'path', function(attrs) {
	let p = svg_tag('path', attrs)
	this.append(p)
	return p
})

method(SVGElement, 'text', function(attrs, s) {
	let t = svg_tag('text', attrs, s)
	this.append(t)
	return t
})

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

// NOTE: you can end up with duplicate ids after this!
method(Node, 'clone', function() {
	let cloned = this.cloneNode(true)
	cloned.init_component()
	return cloned
})

alias(Element, 'as_html', 'outerHTML')

property(Element, 'unsafe_html', {
	set: function(s) {
		let _bound = this._bound
		let bound = this.bound
		if (bound)
			this.bind_children(false)
		this.innerHTML = s
		this._bound = false // prevent bind in init for children.
		this.init_child_components()
		this._bound = _bound
		if (bound)
			this.bind_children(true)
	},
})

property(Element, 'html', {
	get: function() {
		return this.innerHTML
	},
	set: function(s) {
		this.unsafe_html = sanitize_html(s)
	}
})

method(Element, 'clear', function() {
	this.unsafe_html = null
	return this
})

// set element contents to: text, node, null.
// calls constructors, expands arrays.
method(Element, 'set', function E_set(s) {
	if (isfunc(s)) // constructor
		s = s()
	if (s == null) {
		this.clear()
	} else if (isnode(s)) { // s->[..s?..]
		if (s.parent == this) {
			if (this.nodes.length == 1) // s->[s]
				return this
			for (let node of this.nodes) // s->[..s..]
				if (node != s)
					node.remove()
		} else { // s->[...]
			this.clear()
			this.add(s)
		}
	} else if (isarray(s)) { // [..]->[..], diff it
		if (!this.bound) {
			for (let s1 of s)
				if (iselem(s1))
					s1.bind(false)
			this.innerHTML = null
			for (let s1 of s)
				if (s1 != null)
					this.append(s1)
		} else {
			// unbind nodes that are not in the new list.
			for (let node of this.nodes)
				if (iselem(node) && s.indexOf(node) == -1) // TODO: O(n^2) !
					node.bind(false)
			this.innerHTML = null
			for (let s1 of s)
				if (s1 != null)
					this.append(s1)
			// bind any unbound new elements.
			this.bind_children(true)
		}
	} else { // string or stringable: set as text.
		this.clear() // unbind children
		this.textContent = s
	}
	return this
})

// append nodes to an element.
// skips nulls, calls constructors, expands arrays.
method(Element, 'add', function E_add(...args) {
	for (let s of args) {
		if (isfunc(s)) // constructor
			s = s()
		if (s == null)
			continue
		if (isarray(s)) {
			this.add(...s)
			continue
		}
		let bind = iselem(s) ? this.bound : null
		if (bind == false)
			s.bind(false)
		this.append(s)
		if (bind == true)
			s.bind(true)
	}
	return this
})

// insert nodes into an element at a position.
// skips nulls, calls constructors, expands arrays.
method(Element, 'insert', function E_insert(i0, ...args) {
	i0 = max(0, min(or(i0, 1/0), this.nodes.length))
	for (let i = args.length-1; i >= 0; i--) {
		let s = args[i]
		if (isfunc(s))
			s = s()
		if (s == null)
			continue
		if (isarray(s)) {
			this.insert(i0, ...s)
			continue
		}
		let bind = iselem(s) ? this.bound : null
		if (bind == false)
			s.bind(false)
		this.insertBefore(s, this.at[i0])
		if (bind == true)
			s.bind(true)
	}
	return this
})

override(Element, 'remove', function E_remove(inherited) {
	this.bind(false)
	inherited.call(this)
	return this
})

// replace child node with: text, node, null (or a constructor returning those).
// if the node to be replaced is null, the new node is appended instead.
// if the new node is null, the old node is removed.
method(Element, 'replace', function E_replace(e0, s) {
	if (isfunc(s))
		s = s()
	s = T(s)
	if (e0 != null) {
		assert(e0.parent == this)
		if (s === e0)
			return this
		if (s == null) {
			e0.remove()
			return this
		}
		if (iselem(e0))
			e0.bind(false)
		let bind = iselem(s) ? this.bound : null
		if (bind == false)
			s.bind(false)
		this.replaceChild(s, e0)
		if (bind == true)
			s.bind(true)
	} else if (s != null) {
		let bind = iselem(s) ? this.bound : null
		if (bind == false)
			s.bind(false)
		this.appendChild(s)
		if (bind == true)
			s.bind(true)
	}
	return this
})

// move an element into a new position in its parent preserving the scroll position.
let indexOf = Array.prototype.indexOf
property(Element, 'index', {
	get: function() {
		return indexOf.call(this.parentNode.children, this)
	},
	set: function(i) {
		i = clamp(i, 0, this.parent.len-1)
		let i0 = this.index
		if (i == i0)
			return
		let sx = this.scrollLeft
		let sy = this.scrollTop
		let before_node = this.parent.nodes[i + (i0 <= i ? 1 : 0)]
		this.parent.insertBefore(this, before_node)
		this.scroll(sx, sy)
	}
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

/* element method overriding -------------------------------------------------

NOTE: unlike global override(), e.override() cannot override built-in methods.
You can still use the global override() to override built-in methods in an
instance without affecting the prototype, and just the same you can use
override_property_setter() to override a setter in an instance without
affecting the prototype.

*/

method(Element, 'override', function(method, func) {
	let inherited = this[method] || noop
	this[method] = function(...args) {
		return func.call(this, inherited, ...args)
	}
})

method(Element, 'do_before', function(method, func) {
	let inherited = repl(this[method], noop)
	this[method] = inherited && function(...args) {
		func.call(this, ...args)
		inherited.call(this, ...args)
	} || func
})

method(Element, 'do_after', function(method, func) {
	let inherited = repl(this[method], noop)
	this[method] = inherited && function(...args) {
		inherited.call(this, ...args)
		func.call(this, ...args)
	} || func
})

/* ---------------------------------------------------------------------------
// element virtual properties
// ---------------------------------------------------------------------------
publishes:
	e.property(name, get, [set])
	e.prop(name, attrs)
	e.<prop>
	e.props: {prop->prop_attrs}
		store: false          value is read by calling `e.get_<prop>()`.
		attr: true|NAME       value is *also* stored into a html attribute.
		style                 prop represents a css style.
		private               document is not notifed of prop value changes.
		default               default value.
		convert(v1, v0)       convert value when setting the property.
		type                  type for object inspector.
		style_format          format css style to set value.
		style_parse           parse css style to get value.
		from_attr             converter from html attr representation.
		to_attr               converter to html attr representation.
		bind_id               the prop represents an element id to dynamically link to.
calls:
	e.get_<prop>() -> v
	e.set_<prop>(v1, v0)
fires:
	^document.'prop_changed' (e, prop, v1, v0)
	^window.'element_id_changed' (e, id, id0)
	^window.'ID0.id_changed' (e, id, id0)
--------------------------------------------------------------------------- */

method(Element, 'property', function(name, get, set) {
	return property(this, name, get, set)
})

method(Element, 'xoff', function() { this._xoff = true  })
method(Element, 'xon' , function() { this._xoff = false })

let fire_prop_changed = function(e, prop, v1, v0) {
	if (e._xoff) {
		e.props[prop].default = v1
	} else {
		document.fire('prop_changed', e, prop, v1, v0)
	}
}

let resolve_linked_element = function(id) { // stub
	let e = window[id]
	return iselem(e) && e.bound ? e : null
}

// NOTE: all elements need to call this if they want to be linked-to!
method(Element, 'notify_id_changed', function() {
	if (this._notify_id_changed)
		return
	this._notify_id_changed = true
	this.on('attr_changed', function(k, v, v0) {
		if (k == 'id') {
			window.fire('element_id_changed', this, v, v0)
			window.fire(v0+'.id_changed', this, v, v0)
		}
	})
})

let from_bool_attr = v => repl(repl(v, '', true), 'false', false)

let from_attr_func = function(opt) {
	return opt.from_attr
			|| (opt.type == 'bool'   && from_bool_attr)
			|| (opt.type == 'number' && num)
}

let set_attr_func = function(e, k, opt) {
	if (opt.to_attr)
		return (v) => e.attr(k, v)
	if (opt.type == 'bool')
		return (v) => e.bool_attr(k, v || null)
	return (v) => e.attr(k, v)
}

method(Element, 'prop', function(prop, opt) {
	let e = this
	opt = opt || {}
	assign_opt(opt, e.props && e.props[prop])
	let getter = 'get_'+prop
	let setter = 'set_'+prop
	let type = opt.type
	opt.name = prop
	let convert = opt.convert || return_arg
	let priv = opt.private
	if (!e[setter])
		e[setter] = noop
	let prop_changed = fire_prop_changed
	let dv = opt.default

	opt.from_attr = from_attr_func(opt)
	let prop_attr = isstr(opt.attr) ? opt.attr : prop
	let set_attr = opt.attr && set_attr_func(e, prop_attr, opt)
	if (prop_attr != prop)
		attr(e, 'attr_prop_map')[prop_attr] = prop

	if (!(opt.store == false) && !opt.style) { // stored prop
		let v = dv
		function get() {
			return v
		}
		function set(v1) {
			let v0 = v
			v1 = convert(v1, v0)
			if (v1 === v0)
				return
			v = v1
			e[setter](v1, v0)
			if (set_attr)
				set_attr(v1)
			if (!priv)
				prop_changed(e, prop, v1, v0)
			e.update()
		}
		if (dv != null && set_attr && !e.hasattr(prop_attr))
			set_attr(dv)
	} else { // virtual prop with getter
		assert(!('default' in opt))
		function get() {
			return e[getter]()
		}
		function set(v) {
			let v0 = e[getter]()
			v = convert(v, v0)
			if (v === v0)
				return
			e[setter](v, v0)
			if (!priv)
				prop_changed(e, prop, v, v0)
			e.update()
		}
	}

	// id-based dynamic binding of external elements.
	if (opt.bind_id) {
		assert(!priv)
		let ID = prop
		let DEBUG_ID = DEBUG_ELEMENT_BIND && '['+ID+']'
		let REF = opt.bind_id
		function element_bind(te, on) {
			if (e[ID] == te.id) {
				e[REF] = on ? te : null
				e.debug_if(DEBUG_ELEMENT_BIND, on ? '==' : '=/=', DEBUG_ID, te.id)
			}
		}
		function element_id_changed(te, id1, id0) {
			e[ID] = id1
		}
		let bind_element
		function id_prop_changed(id1, id0) {
			if (id0 != null) {
				bind_element(false)
				e.on('bind', bind_element, false)
				bind_element = null
			}
			if (id1 != null) {
				bind_element = function(on) {
					e[REF] = on ? resolve_linked_element(e[ID]) : null
					e.debug_if(DEBUG_ELEMENT_BIND, on ? '==' : '=/=', DEBUG_ID, e[ID])
					window.on(id1+'.bind', element_bind, on)
					window.on(id1+'.id_changed', element_id_changed, true)
				}
				e.on('bind', bind_element, true)
				if (e.bound)
					bind_element(true)
			}
		}
		prop_changed = function(e, k, v1, v0) {
			fire_prop_changed(e, k, v1, v0)
			id_prop_changed(v1, v0)
		}
		id_prop_changed(e[ID])
	}

	e.property(prop, get, set)

	if (!priv)
		attr(e, 'props')[prop] = opt
	else if (e.props && prop in e.props)
		delete e.props[prop]

})

method(Element, 'alias', function(new_name, old_name) {
	if (this.props) {
		let attrs = this.get_prop_attrs(old_name)
		if (attrs)
			this.props[new_name] = attrs
	}
	alias(this, new_name, old_name)
})

// dynamic properties.
e.set_prop = function(k, v) { this[k] = v } // stub
e.get_prop = function(k) { return this[k] } // stub
e.get_prop_attrs = function(k) { return this.props[k] } // stub
e.get_props = function() { return this.props }

// prop serialization.
e.serialize_prop = function(k, v) {
	let pa = this.get_prop_attrs(k)
	if (pa && pa.serialize)
		v = pa.serialize(v)
	else if (isobject(v) && v.serialize)
		v = v.serialize()
	return v
}

e.xsave = function() {
	let xm = window.xmodule
	if (xm)
		xm.save()
}

/* ---------------------------------------------------------------------------
// dynamic element binding mixin
// ---------------------------------------------------------------------------
provides:
	e.set_linked_element(key, id)
calls:
	e.bind_linked_element(key, te, on)
	e.linked_element_id_changed(key, id1, id0)
--------------------------------------------------------------------------- */

method(Element, 'element_links', function() {

	let e = this

	e.bind_linked_element = noop
	e.linked_element_id_changed = noop

	let links = map() // k->te
	let all_keys = map() // id->set(K)

	e.set_linked_element = function(k, id1) {
		let te1 = id1 != null && resolve_linked_element(id1)
		let te0 = links.get(k)
		if (te0) {
			let id0 = te0.id
			if (te1 == te0)
				return
			let keys = all_keys.get(id0)
			keys.delete(k)
			if (!keys.size)
				all_keys.delete(id0)
			if (te0.bound)
				e.bind_linked_element(k, te0, false)
		}
		links.set(k, te1)
		if (id1)
			attr(all_keys, id1, set).add(k)
		if (te1)
			e.bind_linked_element(k, te1, true)
	}

	function element_bind(te, on) { // ^window.element_bind
		let keys = all_keys.get(te.id)
		if (!keys) return
		te = resolve_linked_element(te.id)
		if (!te) return
		for (let k of keys) {
			links.set(k, on ? te : null)
			e.bind_linked_element(k, te, on)
		}
	}

	function element_id_changed(te, id1, id0) { // ^window.element_id_changed
		let keys = all_keys.get(id0)
		if (keys)
			for (let k of keys)
				e.linked_element_id_changed(k, id1, id0)
	}

	e.on_bind(function(on) {
		for (let [id, keys] of all_keys) {
			for (let k of keys) {
				if (on) {
					let te = resolve_linked_element(id)
					if (te) {
						links.set(k, te)
						e.bind_linked_element(k, te, true)
					}
				} else {
					let te = links.get(k)
					if (te) {
						links.set(k, null)
						e.bind_linked_element(k, te, false)
					}
				}
			}
		}
		window.on('element_bind', element_bind, on)
		window.on('element_id_changed', element_id_changed, on)
	})

})

/* deferred DOM updating -----------------------------------------------------

Rationale: some widgets need to measure the DOM in order to position
themselves (eg. popups) or resize their canvas (eg. grid), which requires
that the DOM that they depend on be fully updated for rect() to be correct.
Solution: split DOM updating into stages. When widgets need to update their
DOM, they call their update() method which adds them to a global update set.
On the next animation frame, their do_update() method is called in which they
update their DOM, or at least the part of their DOM that they can update
without measuring the DOM in any way and without accessing the DOM of other
widgets in any way. In do_update() widgets can call position() which asks to
be allowed to measure the DOM later. In stage 2, for the widgets that called
position(), their do_measure() is called in which they can call rect() but
only on themselves and their parents. Stage 3, their do_position() method is
called, in which they can update their DOM based on measurements kept from
do_measure() (this causes a reflow on first measurement, and there might be
a reflow after positioning as well).

Outside of do_update() you can update the DOM freely but not measure it after.
If you need to measure it (eg. in pointermove events), do it first!

NOTE: Inside do_update() widgets should not access any parts of other widgets
that those widgets update in their own do_update() method since the order of
do_update() calls is undefined. Widgets can only be sure that their parents
are positioned by the time their own do_measure() is called.

NOTE: For widgets that asked to be positioned, their parents are positioned
first, in top-down order, possibly causing multiple reflows.

NOTE: The reason for splitting do_measure() and do_positon() into separate
stages is to minimize reflows, otherwise the DOM doesn't change between
do_measure() and do_position() as far as the widget is concerned.

Enable DEBUG_UPDATE to trace the whole process.

*/

let updating = false
let update_set = set() // {elem}
let position_set = set() // {elem}

let position_with_parents = function(e) {
	if (position_set.has(e)) {
		position_with_parents(e.parent)
		e.debug_if(DEBUG_UPDATE, 'M')
		e.do_measure()
		e.debug_if(DEBUG_UPDATE, 'P')
		e.do_position()
		position_set.delete(e)
	}
}

let update_all = raf_wrap(function update_all() {

	updating = true

	// NOTE: do_update() can add widgets which calls bind() on them which calls
	// update() which adds more widgets to update_set while iterating it.
	// The iterator will iterate over those as well (tested on FF & Chrome).
	for (let e of update_set)
		e._do_update()

	// DOM updates done. We can now positon any elements that require measuring
	// the DOM to position themselves. For each element that wants to measure
	// the DOM, we make sure that all its parents are measured and positioned
	// first, in top-to-bottom order.
	for (let e of position_set)
		position_with_parents(e.parent)

	// only leaf widgets left to measure and position: measure all first,
	// then position all.
	for (let e of position_set) {
		e.debug_if(DEBUG_UPDATE, 'M')
		e.do_measure()
	}
	for (let e of position_set) {
		e.debug_if(DEBUG_UPDATE, 'P')
		e.do_position()
	}

	update_set.clear()
	position_set.clear()

	updating = false
})

method(Element, 'update', function(opt) {
	let update_opt = this._update_opt
	if (update_opt) {
		if (opt)
			assign_opt(update_opt, opt)
		else
			update_opt.all = true
	} else if (opt) {
		update_opt = opt
		this._update_opt = update_opt
	} else {
		update_opt = {all: true}
		this._update_opt = update_opt
	}
	if (!this.bound)
		return
	if (update_opt.show != null)
		this.show(update_opt.show)
	if (this.hidden)
		return
	if (update_set.has(this)) // update() inside do_update(), eg. a prop was set.
		return
	update_set.add(this)
	if (updating)
		return
	// ^^ update() called while updating: the update_set iterator will
	// call do_update() in this frame, no need to ask for another frame.
	update_all()
})

method(Element, 'cancel_update', function() {
	update_set.delete(e)
	position_set.delete(e)
})

method(Element, 'on_update', function(f) {
	this.bound = this.bound || false
	this.do_after('do_update', f)
})

method(Element, '_do_update', function() {
	let opt = this._update_opt
	this._update_opt = null
	this.debug_open_if(DEBUG_UPDATE, 'U', Object.keys(opt).join(','))
	if (this.do_update)
		this.do_update(opt)
	if (opt.show)
		this.show()
	this.position()
	this.debug_close_if(DEBUG_UPDATE)
})

method(Element, 'position', function() {
	if (!this.do_position)
		return
	if (!this.bound)
		return
	if (this.hidden)
		return
	position_set.add(this)
	if (updating)
		return
	// ^^ position() called while updating: no need to ask for another frame.
	update_all()
})

method(Element, 'on_measure', function(f) {
	this.bound = this.bound || false
	this.do_after('do_measure', f)
})

method(Element, 'on_position', function(f) {
	this.bound = this.bound || false
	this.do_after('do_position', f)
})

e.do_bind = function(on) {
	let e = this
	assert(e.bound != null)
	if (on) {
		e.debug_open_if(DEBUG_BIND, '+')
		let t0 = PROFILE_BIND_TIME && time()
		e.fire('bind', true)
		if (e.id) {
			window.fire('element_bind', e, true)
			window.fire(e.id+'.bind', e, true)
		}
		if (PROFILE_BIND_TIME) {
			let t1 = time()
			let dt = (t1 - t0) * 1000
			if (dt >= SLOW_BIND_TIME_MS)
				debug((dt).dec().padStart(3, ' ')+'ms', e.debug_name)
		}
		e.update()
		e.debug_close_if(DEBUG_BIND)
	} else {
		e.debug_open_if(DEBUG_BIND, '-')
		e.cancel_update()
		e.fire('bind', false)
		if (e.id) {
			window.fire('element_bind', e, false)
			window.fire(e.id+'.bind', e, false)
		}
		e.debug_close_if(DEBUG_BIND)
	}
}

/* events & event wrappers ---------------------------------------------------

NOTE: these wrappers block mouse events on any target that has attr `disabled`
or that has any ancestor with attr `disabled`. We're not using
`pointer-events: none` because that makes disabled popups click-through.

NOTE: preventing focusing is a matter of not-setting/removing attr `tabindex`
except for input elements that must have an explicit `tabindex=-1`.
This is not done here, see disablable_widget() and focusable_widget().

*/

let installers = on.installers
let callers = on.callers

installers.bind = function() {
	if (this._bound == null)
		this._bound = this.bound
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
	this.on_bind(bind)
	if (this.bound)
		bind.call(this, true)
}

let attr_change_observer = new MutationObserver(function(mutations) {
	for (let mut of mutations)
		if (mut.type == 'attributes')
			mut.target.fire('attr_changed', mut.attributeName,
				mut.target.attr(mut.attributeName), mut.oldValue)
})
installers.attr_changed = function() {
	if (this.__detecting_attr_changes)
		return
	this.__detecting_attr_changes = true
	let observing
	function bind(on) {
		if (on) {
			if (!observing) {
				attr_change_observer.observe(this, {
					attributes: true,
					attributeOldValue: true,
				})
				observing = true
			}
		} else {
			if (observing) {
				attr_change_observer.disconnect(this)
				observing = false
			}
		}
	}
	this.on_bind(bind)
	if (this.bound)
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
	if (DEBUG_INIT)
		debug('ROOT INIT ---------------------------------')
	root.init_component()
	if (DEBUG_BIND)
		debug('ROOT BIND ---------------------------------')
	root.bind(true)
	if (DEBUG_BIND)
		debug('ROOT BIND DONE ----------------------------')
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

// geometry wrappers ---------------------------------------------------------

function domrect(...args) {
	return new DOMRect(...args)
}

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
method(Element, 'rect', function() {
	return this.getBoundingClientRect()
})

alias(Element, 'cx', 'clientLeft')
alias(Element, 'cy', 'clientTop')
alias(Element, 'cw', 'clientWidth')
alias(Element, 'ch', 'clientHeight')
alias(HTMLElement, 'ox', 'offsetLeft')
alias(HTMLElement, 'oy', 'offsetTop')
alias(HTMLElement, 'ow', 'offsetWidth')
alias(HTMLElement, 'oh', 'offsetHeight')

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

method(DOMRectReadOnly, 'clip', function(r) {
	return domrect(...clip_rect(this.x, this.y, this.w, this.h, r.x, r.y, r.w, r.h))
})

window.on('resize', function window_resize() {
	document.fire('layout_changed')
})

method(Window, 'rect', function() {
	return new DOMRect(0, 0, this.innerWidth, this.innerHeight)
})

// common state wrappers -----------------------------------------------------

method(Element, 'hide', function(on) {
	if (!arguments.length)
		on = true
	else
		on = !!on
	if (this.hidden == on)
		return
	this.hidden = on
	this.fire('show', !on)
	return this
})

method(Element, 'show', function(on) {
	if (!arguments.length)
		on = true
	this.hide(!on)
	return this
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

/* NOTE: doesn't check `display: none` and `visibility: hidden` from CSS ! */
property(Element, 'effectively_hidden', {get: function() {
	if (this.hidden)
		return true
	if (!this.parent)
		return true
	if (this.parent.effectively_hidden)
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
	return [sx, sy]
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

scrollbar_widths = memoize(function() {
	let d = div({style: `
		position: absolute;
		visibility: hidden;
		overflow: scroll;
	`}, div({
		style: `
		width: 100px;
		height: 100px;
	`}))
	document.body.add(d)
	let w = d.ow - d.cw
	let h = d.oh - d.ch
	d.remove()
	return [w, h]
})

function scrollbox_client_dimensions(w, h, cw, ch, overflow_x, overflow_y, vscrollbar_w, hscrollbar_h) {

	overflow_x = overflow_x || 'auto'
	overflow_y = overflow_y || 'auto'
	vscrollbar_w = or(vscrollbar_w, scrollbar_widths()[0])
	hscrollbar_h = or(hscrollbar_h, scrollbar_widths()[1])

	let hs
	if (overflow_x == 'scroll')
		hs = true
	else if (overflow_x == 'hidden')
		hs = false
	else if (overflow_x == 'auto')
		hs =
			   (overflow_y == 'auto'   && w > cw - vscrollbar_w && h > ch)
			|| (overflow_y == 'scroll' && w > cw - vscrollbar_w)
			|| (overflow_y == 'hidden' && w > cw)
	else
		assert(false)

	let vs
	if (overflow_y == 'scroll')
		vs = true
	else if (overflow_y == 'hidden')
		vs = false
	else if (overflow_y == 'auto')
		vs =
			   (overflow_x == 'auto'   && h > ch - hscrollbar_h && w > cw)
			|| (overflow_x == 'scroll' && h > ch - hscrollbar_h)
			|| (overflow_x == 'hidden' && h > ch)
	else
		assert(false)

	if (vs) cw -= vscrollbar_w
	if (hs) ch -= hscrollbar_h
	return [cw, ch]
}

// animation frames ----------------------------------------------------------

// TODO: remove these, use raf_wrap() only!
function raf(f, last_id) {
	return last_id == null ? requestAnimationFrame(f) : last_id
}
cancel_raf = cancelAnimationFrame

in_raf = false // public

function raf_wrap(f) {
	let id
	function raf_f() {
		id = null
		in_raf = true
		f()
		in_raf = false
	}
	let wrapper = function raf_wrapper() {
		id = raf(raf_f, id)
	}
	wrapper.cancel = function() {
		if (id != null) {
			cancel_raf(id)
			id = null
		}
	}
	return wrapper
}

// animation easing ----------------------------------------------------------

// TODO: reimplement this over the Web Animation API, but keep this API.

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

// canvas --------------------------------------------------------------------

method(CanvasRenderingContext2D, 'clear', function() {
	this.clearRect(0, 0, this.canvas.width, this.canvas.height)
})

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
		let dialog = div({class: 'modal-overlay'}, e)
		e.dialog = dialog
		e.class('modal')
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
register_component('img', lazy_load, 'img[data-src]')

// timeago auto-updating -----------------------------------------------------

runevery(60, function() {

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

	for (let e of $('[has-timeago]'))
		e.update()

})

// exec'ing js scripts inside html -------------------------------------------

register_component('script', function(e) {
	if (e.type && e.type != 'javascript')
		return
	if (e.src)
		return
	// calling with `e` as `this` allows `this.on('bind',...)` inside the script
	// and also attaching other elements to the script for lifetime control!
	(new Function('', e.text)).call(e)
}, '[run]')

// not initializing components inside the template tag -----------------------

register_component('template', noop) // do not init child components.

// canvas helpers ------------------------------------------------------------

// pw & ph are size multiples for lowering the number of resizes.
method(HTMLCanvasElement, 'resize', function(w, h, pw, ph) {
	let r = devicePixelRatio
	w = ceil(w / pw) * pw
	h = ceil(h / ph) * ph
	if (this.width  != w) { this.width  = w * r; this.w = w; }
	if (this.height != h) { this.height = h * r; this.h = h; }
})

/* popups --------------------------------------------------------------------

Why are popups so complicated? Because the forever not-quite-there-yet
web platform doesn't have the notion of a global z-index so we use the
`display: fixed` hack[1] to escape the clipping region set by parents'
`overflow: hidden`, which leaves us with having to position the popups
manually every time the layout changes. The downside of this hack is that
elements that create a stacking context indirectly by using `opacity`,
`filter`, `transform`, etc. might still obscure a popup.

[1] https://github.com/w3c/csswg-drafts/issues/4092
*/

property(Element, 'creates_stacking_context', function() {
	if (this.parent == document)
		return true
	let css = this.css()
	// TODO: `will-change` check is incomplete.
	return (false
		|| css['z-index'        ] != 'auto'
		|| css['opacity'        ] != '1'
		|| css['mix-blend-mode' ] != 'normal'
		|| css['transform'      ] != 'none'
		|| css['filter'         ] != 'none'
		|| css['backdrop-filter'] != 'none'
		|| css['perspective'    ] != 'none'
		|| css['clip-path'      ] != 'none'
		|| css['mask'           ] != 'none'
		|| css['isolation'      ] == 'isolate'
		|| css['contain'        ] == 'layout'
		|| css['contain'        ] == 'paint'
		|| css['contain'        ] == 'strict'
		|| css['contain'        ] == 'content'
		|| css['will-change'    ] == 'opacity'
		|| css['will-change'    ] == 'transform'
		|| css['will-change'    ] == 'filter'
	)
})

let get_stacking_parent = function(p) {
	if (p.creates_stacking_context)
		return p
	return get_stacking_parent(p.parent)
}
property(Element, 'stacking_parent', function() {
	if (!this.isConnected)
		return
	if (this.parent == document)
		return
	return get_stacking_parent(this.parent)
})

method(Element, 'popup', function(target, side, align) {

	let e = this
	if (e.hasclass('popup'))
		return

	e.ispopup = true
	e.class('popup')

	// view -------------------------------------------------------------------

	let er, tr, br, fixed, sx, sy, spx, spy

	e.on_measure(function() {
		er = e.rect()
		tr = (e.popup_target || e.parent).rect()
		br = window.rect()
		sx = window.scrollX
		sy = window.scrollY
		let sp = e.stacking_parent
		trace_if(!sp, e.isConnected, e.bound, e.parent)
		sr = sp.rect()
		spx = sr.x + sp.cx
		spy = sr.y + sp.cy
	})

	function layout(w, h, side, align) {

		let tx1 = tr.x + or(e.popup_x1, 0)
		let ty1 = tr.y + or(e.popup_y1, 0)
		let tx2 = tr.x + or(e.popup_x2, tr.w)
		let ty2 = tr.y + or(e.popup_y2, tr.h)
		let tw = tx2 - tx1
		let th = ty2 - ty1

		let x, y
		if (side == 'right') {
			;[x, y] = [tx2, ty1]
		} else if (side == 'left') {
			;[x, y] = [tx1 - w, ty1]
		} else if (side == 'top') {
			;[x, y] = [tx1, ty1 - h]
		} else if (side == 'bottom') {
			side = 'bottom'
			;[x, y] = [tx1, ty2]
		} else if (side == 'inner-right') {
		 	;[x, y] = [tx2 - w, ty1]
		} else if (side == 'inner-left') {
		 	;[x, y] = [tx1, ty1]
		} else if (side == 'inner-top') {
		 	;[x, y] = [tx1, ty1]
		} else if (side == 'inner-bottom') {
		 	;[x, y] = [tx1, ty2 - h]
		} else if (side == 'inner-center') {
			;[x, y] = [
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
			x = x + (tw - w) / 2
		else if (align == 'center' && sdx)
			y = y + (th - h) / 2
		else if (align == 'end' && sdy)
			x = x + tw - w
		else if (align == 'end' && sdx)
			y = y + th - h

		return [x, y]
	}

	e.do_position_popup = noop

	e.on_position(function() {

		let w = er.w
		let h = er.h

		let side  = e.popup_side
		let align = e.popup_align
		let [x, y] = layout(w, h, side, align)

		// if popup doesn't fit the screen, first try to change its side
		// or alignment and relayout, and if that didn't work, its offset.

		let d = 10
		let bw = br.w
		let bh = br.h

		let out_x1 = x < d
		let out_y1 = y < d
		let out_x2 = x + w > (bw - d)
		let out_y2 = y + h > (bh - d)

		let re
		if (side == 'bottom' && out_y2) {
			re = 1; side = 'top'
		} else if (side == 'top' && out_y1) {
			re = 1; side = 'bottom'
		} else if (side == 'right' && out_x2) {
			re = 1; side = 'left'
		} else if (side == 'top' && out_x1) {
			re = 1; side = 'bottom'
		}

		let vert =
			   side == 'bottom'
			|| side == 'top'
			|| side == 'inner-bottom'
			|| side == 'inner-top'

		if (align == 'end' && ((vert && out_x2) || (!vert && out_y2))) {
			re = 1; align = 'start'
		} else if (align == 'start' && ((vert && out_x1) || (!vert && out_y1))) {
			re = 1; align = 'end'
		}

		if (re)
			[x, y] = layout(w, h, side, align)

		// if nothing else works, adjust the offset to fit the screen.
		let ox2 = max(0, x + w - (bw - d))
		let ox1 = min(0, x)
		let oy2 = max(0, y + h - (bh - d))
		let oy1 = min(0, y)
		x -= ox1 ? ox1 : ox2
		y -= oy1 ? oy1 : oy2

		e.x = x + e.popup_ox + (e.popup_fixed ? sx : 0) - spx
		e.y = y + e.popup_oy + (e.popup_fixed ? sy : 0) - spy

		e.do_position_popup(side, align)

	})

	e.property('target_rect',
		function() {
			return domrect(
				e.popup_x1,
				e.popup_y1,
				e.popup_x2 - e.popup_x1,
				e.popup_y2 - e.popup_y1
			)
		}, function(r) {
			e.popup_x1 = r.x1
			e.popup_y1 = r.y1
			e.popup_x2 = r.x2
			e.popup_y2 = r.y2
		}
	)

	// controller -------------------------------------------------------------

	e.prop('popup_target' , {private: true, default: target})

	e.prop('popup_side'   , {private: true, type: 'enum',
			enum_values: [
				'top', 'bottom', 'left', 'right',
				'inner-top', 'inner-bottom', 'inner-left', 'inner-right', 'inner-center'
			],
			default: side || 'top'})

	e.prop('popup_align'  , {private: true, type: 'enum',
			enum_values: ['center', 'start', 'end'],
			default: align || 'center'})

	e.prop('popup_x1'     , {private: true, type: 'number'})
	e.prop('popup_y1'     , {private: true, type: 'number'})
	e.prop('popup_x2'     , {private: true, type: 'number'})
	e.prop('popup_y2'     , {private: true, type: 'number'})
	e.prop('popup_ox'     , {private: true, type: 'number', default: 0})
	e.prop('popup_oy'     , {private: true, type: 'number', default: 0})
	e.prop('popup_fixed'  , {private: true, type: 'bool', default: false})

	function window_scroll(ev) {
		if (ev.target.contains(e.parent))
			e.position()
	}

	function update() {
		e.update()
	}

	e.on_bind(function(on) {

		// changes in parent size updates the popup position.
		e.parent.on('resize', update, on)

		// scrolling on any of the parents updates the popup position.
		window.on('scroll', window_scroll, on, true)

		// layout changes update the popup position.
		document.on('layout_changed', update, on)

		// hovering on target can make it a stacking context
		// (eg. target sets opacity) which needs a popup update.
		e.parent.on('pointerover' , update, on)
		e.parent.on('pointerleave', update, on)

	})

	return e
})

// lists ---------------------------------------------------------------------

method(Element, 'make_list', function() {
	let e = this
	live_move_mixin(e)

	// e.move_element_start(move_i, move_n, i1, i2[, x1, x2])
	// e.move_element_update(elem_x, [i1, i2, x1, x2])

	e.movable_element_size = function(elem_i) {
		//
	}

	e.set_movable_element_pos = function(i, x, moving) {

	}

})

// CSS specificity reporting -------------------------------------------------

function css_selector_specificity(s0) {
	let s = s0
	let n = 0 // current specificity
	let maxn = 0 // current max specificity
	let cs = [0] // call stack: 1 for :is(), 0 for :not() and :where()
	let ns = [] // specificity stack for :is()
	let maxns = [] // max specificity stack for :is()
	let z = 0 // call stack depth of first :where()
	let sm // last matched string
	function match(re) {
		let m = s.match(re)
		if (!m) return
		sm = m[0]
		assert(sm.len)
		s = s.slice(sm.len)
		return true
	}
	function next() {
		if (!s.len) return max(maxn, n)
		if (match(/^[ >+~*]+/ )) return next()
		if (match(/^\)/      )) {
			assert(cs.len > 1, 'unexpected )')
			if (cs.pop()) { n = ns.pop() + max(maxn, n); maxn = maxns.pop() }
			if (z == cs.len) z = 0; return next()
		}
		if (match(/^:is\(/   )) {
			cs.push(1); ns.push(n); maxns.push(maxn); n = 0; maxn = 0
			return next()
		}
		if (match(/^:not\(/  )) { cs.push(0); return next() }
		if (match(/^:has\(/  )) { cs.push(0); return next() }
		if (match(/^:where\(/)) { if (!z) z = cs.len; cs.push(0); return next() }
		if (match(/^,/       )) { maxn = max(maxn, n); n = 0; return next() }
		if (match(/^\[[^\]]*\]/) || match(/^[\.:#]?[:a-zA-Z\-_][a-zA-Z0-9\-_]*/)) {
			if (!z)
				n += (sm[0] == '#' && 10 || sm[0] == '.' && 1 || sm[0] == ':' && 1 || .1)
			return next()
		}
		warn('invalid selector: '+s0, s)
	}
	return next()
}

function css_report_specificity(file, max_spec) {
	for (let ss of document.styleSheets) {
		if (!((ss.href || '').ends(file || '')))
			continue
		for (let r of ss.cssRules) {
			let s = r.selectorText
			if (!isstr(s))
				continue
			let spec = css_selector_specificity(s)
			if (spec > max_spec)
				debug('CSS spec', spec, s)
		}
	}
}

/* composable CSS ------------------------------------------------------------

	example.css:
		.foo { }
		.bar { }
		.baz { --inc: foo bar; }  # gets all properties from .foo and .bar

*/

on_dom_load(function() {

	css_report_specificity('x-widgets.css', 2)

	let t0 = time()

	let n = 0
	let class_rules = obj()
	for (let ss of document.styleSheets) {
		for (let r of ss.cssRules) {
			let s = r.selectorText // this is slow on Chrome :(
			if (!isstr(s))
				continue
			let m = s.match(/^\.([a-zA-Z0-9\-_]+)$/) // simple class
			if (!m)
			 	continue
			class_rules[m[1]] = r
			n++
		}
	}

	let t1 = time()

	for (let ss of document.styleSheets) {
		for (let r of ss.cssRules) {
			let sm = r.styleMap
			if (!sm) continue
			let inc = sm.get('--inc') // this is slow on Chrome :(
			inc = inc && inc[0]
			if (!inc) continue
			for (let s of words(inc)) {
				let cr = class_rules[s]
				if (cr) {
					debug('CSS', s, '->', r.selectorText)
					for (let [k, v] of cr.styleMap)
						r.style[k] = v
				} else {
					warn('class not found: '+s)
				}
			}
		}
	}

	let t2 = time()

	debug('CSS --inc', n,
		((t1 - t0) * 1000).dec(0)+'ms',
		((t2 - t1) * 1000).dec(0)+'ms')

})

}
