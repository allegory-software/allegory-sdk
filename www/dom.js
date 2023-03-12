/*

	DOM API & web components.
	Written by Cosmin Apreutesei. Public domain.

You must load first:

	glue.js

You must call on DOM load:

	init_components()

Defines CSS rules for:

	[hidden]
	[disabled]
	.popup
	.modal
	.modal-overlay

Uses CSS classes:

	.outline-focus
	.no-outline

Uses CSS classes on the <html> tag:

	.theme-light .theme-dark
	.theme-small .theme-large

CSS-IN-JS

	css_layer(name) -> layer; layer(selector, includes, rules)
	css[_base _util _state _role _role_state _generic_state _light _dark][_chrome _firefox](selector, includes, rules)

DOM load event:

	on_dom_load(f)

DEBUGGING

	e.debug(...)
	e.debug_if(cond, ...)
	e.debug_open_if(cond, ...)
	e.debug_close_if(cond, ...)
	e.trace(...)
	e.trace_if(cond, ...)
	e.debug_name
	e.debug_anon_name()

ELEMENT ATTRS

	e.hasattr(k) -> t|f
	e.attr(k[, v]) -> v
	e.bool_attr(k[, v]) -> v
	e.closest_attr(k) -> v
	e.attrs = {k: v}
	e.tag

ELEMENT CSS CLASSES

	e.hasclass(k)
	e.class('k1 ...'[, enable])
	e.switch_class(k1, k2, normal)
	e.classess = 'k1 k2 ...'

ELEMENT COMPUTED STYLES

	e.css(k[, state])
	e.css() -> css
	css.prop(k[, v])

CSS QUERYING

	css_class_prop(selector, style) -> v
	fontawesome_char(name) -> s

DOM NAVIGATION INCLUDING TEXT NODES

	n.nodes -> nlist, n.nodes[i], n.nodes.len, n.parent
	n.first_node, n.last_node, n.next_node, n.prev_node

DOM NAVIGATION EXCLUDING TEXT NODES

	e.at[i], e.len, e.at.length, e.parent
	e.index
	e.first, e.last, e.next, e.prev

DOM QUERYING

	iselem(v) -> t|f
	isnode(v) -> t|f
	e.$(sel) -> nlist
	e.$1(sel|e) -> e
	$(sel) -> nlist
	$1(sel|e) -> e
	e.closest_child(ancestor_e) -> ce
	nlist.each(f)
	nlist.first nlist.last
	nlist.trim() -> [n1,...]|null
	root

DOM <-> HTML

	e.html -> s
	[unsafe_]html(s, [unwrap: false]) -> e
	e.[unsafe_]html = s

DOM MANIPULATION

	T[C](te[,whitespace]) where `te` is f|e|text_str
	e.clone()
	e.set(te)
	e.add(te1,...)
	e.insert(i, te1,...)
	e.replace([e0], te)
	e.move([pe], [i0])
	e.clear()
	update_element_list([id|{id:,...}|e, ...], [e1, ...]) -> [e1, ...]
	tag(tag, [attrs], [e1,...])
	div(...)
	span(...)
	element(node | stringable | null | {id|tag:, PROP->VAL}, [attrs], [e1,...]) -> node | null
	[].join_nodes([separator])

SVG ELEMENTS

	svg_tag(tag, [attrs], e1,...)
	svg([attrs], e1, ...) -> svg
	svg_arc_path(x, y, r, a1, a2, ['M'|'L'])
	svg.path(attrs) -> svg_path
	svg.text(attrs) -> svg_text

ELEMENT METHOD OVERRIDING

	e.override(method, f)
	e.do_before(method, f)
	e.do_after(method, f)

ELEMENT PROPERTIES

	e.property(name, [get],[set] | descriptor)
	e.prop(name, attrs)
	e.alias(new_name, existing_name)
	e.set_prop(k, v)
	e.get_prop(k) -> v
	e.get_prop_attrs(k) -> {attr->val}
	e.get_props() -> {k->attrs}
	e.serialize_prop(k) -> s

PROPERTY PERSISTENCE

	e.xoff()
	e.xon()
	e.xsave()

DEFERRED DOM UPDATING

	e.update([opt])
	e.position()
	e.on_update(f)
	e.on_measure(f)
	e.on_position(f)

TIMERS

	e.timer(f) -> tm

ELEMENT INIT

	component('TAG'|'TAG[ATTR]'[, category], initializer) -> create([props], ...children)
	e.init_child_components()
	e.initialized -> null|t|f
	e.on_init(f); f()
	^^init(e)
	^^ID.init(e)
	init_components()

ELEMENT BIND

	e.on_bind(f); f(on)
	^^bind(e, on)
	^^ID.bind(e, on)
	e.bound -> t|f

GLOBAL EVENTS

	e.listen(event, f)
	e.announce(event, ...args)

MOUSE EVENTS

	^hover              (ev, on, mx, my)
	^[right]click       (ev, nclicks, mx, my)
	^[right]pointerdown (ev, mx, my)
	^[right]pointerup   (ev, mx, my)
	^pointermove        (ev, mx, my)
	^wheel              (ev, dy, mx, my)
	this.capture_pointer(ev, [on_pointermove], [on_pointerup])
		^on_pointermove (ev, mx, my, mx0, my0)
		^on_pointerup   (ev, mx, my, mx0, my0)
	force_cursor(cursor|false)

KEYBOARD EVENTS

	^keydown            (key, shift, ctrl, alt, ev)
	^keyup              (key, shift, ctrl, alt, ev)
	^keypress           (key, shift, ctrl, alt, ev)
	^document.stopped_event(stopped_ev, ev)

LAYOUT CHANGE EVENT

	^document.layout_changed()

DOM RECTANGLES

	domrect([x, y, w, h]) -> r
	r.x, r.y, r.x1, r.y1, r.x2, r.y2, r.w, r.h
	r.set(r | x,y,w,h)
	r.clip(r, [out_r]) -> out_r
	r.contains(x, y) -> t|f
	r.intersects(r) -> t|f

ELEMENT GEOMETRY / SIZING

	px(x)
	e.x, e.y, e.x1, e.y1, e.x2, e.y2, e.w, e.h
	e.min_w, e.min_h, e.max_w, e.max_h

ELEMENT GEOMETRY / MEASURING

	e.ox, e.oy, e.ow, e.oh
	e.cx, e.cy, e.cw, e.ch
	e.sx, e.sy, e.sw, e.sh
	e.rect() -> r
	e.orect() -> r

ELEMENT STATE

	e.hide([on])
	e.show([on])
	e.hovered
	e.focused_element
	e.focused
	e.hasfocus
	e.focusables()
	e.effectively_disabled
	e.effectively_hidden
	e.focus_first()
	e.make_disablable()
		e.disabled
		e.disable(reason, disabled)
	e.make_focusable([focusable_element1, ...])
		e.tabindex
		e.focusable
	focused_focusable([e]) -> e

TEXT EDITING

	input.select_range(i, j)
	e.select(i, j)
	e.contenteditable
	e.insert_at_caret(s)
	e.select_all()
	e.unselect()

SCROLLING

	scroll_to_view_dim(x, w, pw, sx, [align])
	scroll_to_view_rect(x, y, w, h, pw, ph, sx, sy, [halign[, valign]])
	e.scroll_to_view_rect_offset(sx0, sy0, x, y, w, h, [halign, valign]])
	e.scroll_to_view_rect(sx0, sy0, x, y, w, h, halign, valign)
	e.make_visible_scroll_offset(sx0, sy0, [parent], [halign[, valign]])
	e.make_visible([halign[, valign]], [smooth])
	e.is_in_viewport()
	scrollbar_widths() -> [vs_w, hs_h]
	scrollbox_client_dimensions(w, h, cw, ch, [overflow_x], [overflow_y], [cs_w], [hs_h])

ANIMATION FRAMES

	raf(f) -> raf_id
	cancel_raf(raf_id)
	in_raf -> t|f
	raf_wrap(f) -> wf
		wf()
		wf.cancel()

ANIMATION EASING

	transition(f, [dt], [x0], [x1], [easing]) -> tr
		tr.stop()
		tr.finish = func

HIT-TESTING

	hit_test_rect_sides(x0, y0, d1, d2, x, y, w, h)
	e.hit_test_sides(mx, my, [d1], [d2])

CANVAS

	cx.clear()
	e.resize(w, h, [pw], [ph])

MODALS & OVERLAYS

	e.modal([on])
	overlay(attrs, content)

IMAGE LAZY LOADING

	<img data-src=""> images are loaded when they come into view.

TIME-AGO AUTO-UPDATING

	<... timeago time=""> auto-updates every minute.

EXECUTABLE SCRIPTS

	<script run></script> scripts declared in html are executable.
	script_e.run([this_arg])

HTML COMPONENTS

	<component tag=foo>
		<script>
			...
		</script>
	</component>

CONDITIONAL ELEMENT BINDING

	<if global=> ... </if>

POPUPS

	e.popup([side], [align])      make element a popup.
	e.popup_side                  '[inner-]{top bottom left right center}'
	e.popup_align                 'center start end'
	e.popup_{x1,y1,x2,y2}
	e.popup_fixed

LIVE-MOVE LIST ELEMENTS

	live_move_mixin(e)

THEMING

	is_theme_dark() -> t|f
	set_theme_dark(dark)
	get_theme_size() -> cur_size
	set_theme_size(['large'|'small'|'normal'])
	^^theme_changed()

CSS SPECIFICITY REPORTING

	css_report_specificity(file, max_spec)

*/

{ // module scope

// debugging -----------------------------------------------------------------

DEBUG_INIT = false
DEBUG_BIND = false
DEBUG_ELEMENT_BIND = false
PROFILE_BIND_TIME = true
SLOW_BIND_TIME_MS = 10
DEBUG_UPDATE = false
DEBUG_CSS_USAGE = false
DEBUG_CSS_SPECIFICITY = false

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

// DOM load event ------------------------------------------------------------

function on_dom_load(fn) {
	if (document.readyState === 'loading')
		document.on('DOMContentLoaded', fn)
	else // `DOMContentLoaded` already fired
		fn()
}

// CSS-in-JS -----------------------------------------------------------------

// Why this instead of pure CSS? First, all selectors get specificity 0 which
// effectively disables this genius CSS feature so rules are applied in source
// order in layers (what @layer and :where() would do in a CSS). Layers let
// you restyle elements without accidentally muting role/state-modifier styles.
// Second, you get composable CSS without silly offline preprocessors.
// Now you can style with utility classes inside arbitrary CSS selectors
// including those with :hover and :focus-visible. Now you can use fontawesome
// icons by name inside ::before rules. Third, because you get to put widget
// styles near the widget code that they're coupled to. Fourth, because now
// you get warnings when mistyping utility class names, which also facilitates
// refactoring the utility classes. Fifth, because you get to solve all these
// old problems with a page of JS. The cost is 1-3 frames at startup for
// a site with some 3000 rules (most of which come from fontawesome).

let class_props = obj() // {class->props} from all layers.
let class_includes = obj() // {class->includes}

on_dom_load(function() {
	let t0 = time()
	let n = 0
	function add_rule(rule) {
		let selector = rule.selectorText // this is slow on Chrome :(
		if (!isstr(selector))
			return
		// TODO: support `foo-1.5` utility classes!
		let props = rule.cssText.slice(selector.length + 3, -2)
		let selectors = selector.includes(',') ? selector.split(/\s*,\s*/) : [selector]
		for (let selector of selectors) {
			let [cls] = selector
				.replace(/::before$/, '') // strip ::before (fontawesome)
				.replace(/::after$/ , '') // strip ::after  (?)
				.captures(/^\.([^ >#:\.+~]+)$/) // simple .class selector
			if (!cls)
				return
			props = props.trim()
			if (class_props[cls])
				class_props[cls] = class_props[cls] + '\n\t' + props
			else
				class_props[cls] = props
		}
		n++
	}
	function add_rules(rules) {
		for (let rule of rules) {
			if (rule instanceof CSSLayerBlockRule) // @layer block
				add_rules(rule.cssRules)
			else
				add_rule(rule)
		}
	}
	for (let sheet of document.styleSheets)
		if (!sheet.ownerNode.css_in_js_layer)
			add_rules(sheet.cssRules)
	let t1 = time()
	debug('CSS-in-JS mapped', n, 'rules in', floor((t1 - t0) * 1000), 'ms')
})

let utils_usage = obj()

css_layers = []

css_layer = memoize(function(layer) {

	let pieces = ['@layer '+layer+' {\n']
	let style = document.createElement('style')
	style.setAttribute('x-layer', layer) // for debugging.
	style.css_in_js_layer = true // we map classes ourselves.
		document.head.append(style)
		css_layers.push(layer)

	on_dom_load(function() {
		pieces.push('\n} /*layer*/')
		let final_pieces = []
		for (let piece of pieces)
			if (isfunc(piece)) // expand includes
				piece(final_pieces)
			else
				final_pieces.push(piece)
		style.textContent = final_pieces.join('')
	})

	function add_includes(includes, pieces, e) {
		for (let cls of includes.words()) {
			let props = class_props[cls]
			if (props == null) {
				warn('css unknown class', cls, 'at',
					e.stack.captures(/\s+at\s+[^\r\n]+\r?\n+\s+at ([^\n]+)/)[0])
				continue
			}
			let cls_includes = class_includes[cls]
			if (cls_includes) {
				add_includes(cls_includes, pieces, e)
			}
			pieces.push('\n\t', props)
			utils_usage[cls] = (utils_usage[cls] || 0)+1
		}
	}

	function add_rule(selector, includes, props) {
		if (includes == null && props == null) { // verbatim CSS, eg. @keyframes
			pieces.push(selector.trim())
			return
		}
		if (isarray(selector)) {
			for (let sel of selector)
				add_rule(sel, includes, props)
			return
		}
		// ::before needs to be outside :where(), so we must split the selector.
		selector = selector.trim()
		let [prefix, suffix] = selector.captures(/^(.+?)(\s*::[^ >#:\.+~,]+)$/)
		if (!prefix) {
			prefix = selector
			suffix = ''
		}
		pieces.push('\n:where(', prefix, ')', suffix, ' {')
		if (includes) {
			let e = new Error()
			pieces.push(function(dest_pieces) {
				add_includes(includes, dest_pieces, e)
			})
		}
		props = props && props.trim()
		if (props)
			pieces.push('\n\t', props)
		pieces.push('\n}\n')

		let [cls] = prefix.captures(/^\.([^ >#:\.+~]+)$/) // reusable class?
		if (cls) {
			class_props[cls] = catany('\n\t', class_props[cls], props) || ''
			class_includes[cls] = catany(' ', class_includes[cls], includes)
		}
	}

	add_rule.layer_name = layer
	add_rule.style_node = style

	return add_rule

})

for (layer of 'base util state role role_state generic_state'.words()) {
	window['css_'+layer] = css_layer(layer.replace('_', '-'))
	window['css_'+layer+'_chrome' ] = Chrome  ? window['css_'+layer] : noop
	window['css_'+layer+'_firefox'] = Firefox ? window['css_'+layer] : noop
}
css         = css_base
css_chrome  = css_base_chrome
css_firefox = css_base_firefox

// css.js usage ranking ------------------------------------------------------

function css_rank_utils_usage() {
	if (!DEBUG_CSS_USAGE)
		return
	let a = []
	for (let k in utils_usage) {
		let n = utils_usage[k]
		a[n] = catany(' ', a[n], k)
	}
	for (let i = a.len; i > 0; i--)
		if (a[i])
			pr(i, a[i])
}
on_dom_load(css_rank_utils_usage)

// element attribute manipulation --------------------------------------------

alias(Element, 'hasattr', 'hasAttribute')

// NOTE: JS values `true`, `false` and `undefined` cannot be stored in an attribute:
// setting `true` gets back 'true' while `false` and `undefined` gets back `null`.
// To store `true`, `false` and `null`, use bool_attr().
e.attr = function(k, v) {
	if (arguments.length < 2)
		return this.getAttribute(k)
	else if (v == null || v === false)
		this.removeAttribute(k)
	else
		this.setAttribute(k, v)
}

// NOTE: storing `false` explicitly allows setting the value `false` on
// props whose default value is `true`.
e.bool_attr = function(k, v) {
	if (arguments.length < 2)
		return repl(repl(this.getAttribute(k), '', true), 'false', false)
	else if (v == null)
		this.removeAttribute(k)
	else
		this.setAttribute(k, repl(repl(v, true, ''), false, 'false'))
}

// NOTE: setting this doesn't remove existing attrs!
property(Element, 'attrs', {
	get: function() {
		let t = obj()
		for (let i = 0, n = this.attributes.length; i < n; i++) {
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
e.closest_attr = function(attr) {
	let e = this.closest('['+attr+']')
	return e && e.attr(attr)
}

property(Element, 'tag', function() { return this.tagName.lower() }, noop)

// element CSS class list manipulation ---------------------------------------

e.class = function(names, enable) {
	if (arguments.length < 2)
		enable = true
	if (names.includes(' ')) {
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
}

e.hasclass = function(name) {
	return this.classList.contains(name)
}

e.switch_class = function(s1, s2, normal) {
	this.class(s1, normal == false)
	this.class(s2, normal != false)
}


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

// CSS querying --------------------------------------------------------------

e.css = function(prop, state) {
	let css = getComputedStyle(this, state)
	return prop ? css[prop] : css
}

method(CSSStyleDeclaration, 'prop', function(k, v) {
	if (arguments.length < 2)
		return this.getPropertyValue(k)
	else
		this.setProperty(k, v)
})

{
let each_css_rule = function(rules, f) {
	for (let rule of rules) {
		let ret
		if (rule instanceof CSSLayerBlockRule) {
			ret = each_css_rule(rule.cssRules, f)
		} else {
			ret = f(rule)
		}
		if (ret != null)
			return ret
	}
}
method(StyleSheet, 'each_rule', function(f) {
	return each_css_rule(this.cssRules, f)
})
}

function each_css_rule(f) {
	for (let sheet of document.styleSheets)
		if(sheet.cssRules) {
			let ret = sheet.each_rule(f)
			if (ret != null)
				return ret
		}
}

function css_class_prop(selector, style) {
	return each_css_rule(function(rule) {
		if (rule.selectorText && rule.selectorText.split(',').includes(selector))
			return rule.style[style]
	})
}

// use this to to draw fontawesome icons on a canvas.
fontawesome_char = memoize(function(icon) {
	return css_class_prop('.'+icon+'::before', 'content').slice(1, -1)
})

// DOM navigation for elements, skipping over text nodes ---------------------

alias(Element, 'at'     , 'children')
alias(Element, 'len'    , 'childElementCount')
alias(Element, 'first'  , 'firstElementChild')
alias(Element, 'last'   , 'lastElementChild')
alias(Element, 'next'   , 'nextElementSibling')
alias(Element, 'prev'   , 'previousElementSibling')

// DOM navigation for nodes --------------------------------------------------
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

// DOM querying --------------------------------------------------------------

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

// return closest element whose parent is e.
e.closest_child = function(e) {
	let ce = this
	while (ce.parent && ce.parent != e) ce = ce.parent
	return ce.parent == e && ce || null
}

/* DOM manipulation with lifecycle management --------------------------------

The DOM manipulation API works with strings, nodes, arrays of nodes and also
functions (aka constructors) that are called to return those objects.

The "lifecycle management" part of this is an implementation of web components.
The reason we're reinventing web components is because the web components API
built into the browser is unusable. Needless to say, all DOM manipulation
needs to be done through this API exclusively for any of this to work, so use
e.add() instead of e.append(), etc. everywhere!

Lifecycle management means you can add an init function on a tag to be called
every time an element of that tag is created via this DOM API. This can be
a custom tag or a built-in tag, and you can also specify a html attribute
as a condition for initialization (see uses of component() in this file).

To init components declared in html you need to call init_components() when
the DOM is loaded! This is not called automatically so you can have a central
place in which you init things in the right order.

Components can be either attached to the DOM (bound) or not. When bound they
become alive, when unbound they die and must remove all event handlers that
they registered in document, window or other external objects, or they leak!

When a component is initialized, its parents are only partially initialized
so take that into account if you mess with them at that stage.

When a component is bound, its parents are already bound and its children unbound.
When a component is unbound, its children are still bound and its parents unbound.

Moving bound elements to an unbound tree will unbind them.
Adding unbound elements to the bound tree will bind them.
Moving elements around in the bound tree will *not* rebind them.

Getting back to the init function, inside it you can:

1. Replace the element's inner html with whatever the component is be made of.
For more complex components, the inner html can be used to configure the
component. For container-type components, call e.init_child_components()
so that inner components can be initialized before use.

2. Declare properties with e.prop(). Properties are initialized using values
gathered from the element() call or from html attributes if coming from html.
The init function can also return a map of default initial prop vals.

While props are initialized, e.initialized is false, ^^prop_changed event is
not fired, and prop's default is set to the initial value.

3. Register event handlers, with the caveat that handlers into window, document
or external components need to be set inside a bind handler, passing along the
`on` arg, so that they get unset when the component is unbound.

*/

// element init --------------------------------------------------------------

let component_init = obj() // {tagName->init}
let component_attr = obj() // {tagName->attr}

function component(selector, category, init) {
	if (isfunc(category)) { // shift arg
		init = category
		category = 'Other'
	}
	let [tag, tag_attr] = selector.captures(/^(.+?)\[(.+?)\]$/) // TAG[ATTR]
	tag = tag || selector
	assert(tag.match(/^[a-z]+[a-z\-]*$/), 'invalid component tag')
	let tagName = tag.upper()
	assert(!(init && component_init[tagName]), 'component already registered: {0}', tag)
	component_init[tagName] = init
	if (tag_attr)
		component_attr[tagName] = tag_attr
	if (!init) { // unregister
		attr(component.categories, category, array).remove_value(create)
		return
	}
	function create(prop_vals, ...children) {
		prop_vals = prop_vals || obj()
		prop_vals.tag = tag
		return element(prop_vals, null, ...children)
	}
	create.construct = init // use as mixin in other components
	attr(component.categories, category, array).push(create)
	return create
}

component.categories = obj() // {cat->{create1,...}}

component.init_instance = function(e, prop_vals) { // stub, see module.js.
	e.xoff()
	for (let k in prop_vals)
		e.set_prop(k, prop_vals[k])
	e.xon()
}

component.instance_tag = noop // stub, see module.js.

// TODO: e.property() props can't be set from html. Convert them
// to e.prop() if you want them to be settable from html attrs!
let attr_prop_vals = function(e) {
	let prop_vals = obj()
	let pmap = e.attr_prop_map
	for (let attr of e.attributes) {
		let k = attr.name
		k = pmap && pmap[k] || k
		let v = attr.value
		let pa = e.get_prop_attrs(k)
		if (!k.starts('on_')) {
			if (!(pa && pa.from_attr))
				continue
			v = pa.from_attr(v)
			if (k in prop_vals)
				continue
		}
		prop_vals[k] = v
	}
	return prop_vals
}

e._init_component = function(prop_vals) {

	let e = this

	if (e.initialized)
		return

	let tagName = e.tagName
	let init = component_init[tagName]
	let tag_attr = init && component_attr[tagName]
	if (!(init && (!tag_attr || e.hasattr(tag_attr)
		|| (prop_vals && prop_vals.attrs && prop_vals.attrs[tag_attr] != null))
	)) {
		if (prop_vals)
			assign_opt(e, prop_vals)
		e.init_child_components()
		return
	}

	e.debug_open_if(DEBUG_INIT, '^')

	// prop attrs can be given to element() as {props: {PROP->{K->V}}}.
	// TODO: side effect of doing it this way is that now you need to use
	// `attr(e.props, 'PROP').k = v` instead of `e.props.PROP = {...}` in init().
	e.props = assign_opt(obj(), prop_vals && prop_vals.props)

	e.initialized = null // for log_add_event(), see glue.js.

	let cons_prop_vals = init(e)

	// initial prop values come from multiple sources, in priority order:
	// - element() arg keys.
	// - constructor return value.
	// - html attributes.
	prop_vals = assign_opt(attr_prop_vals(e), cons_prop_vals, prop_vals)

	// register events from `on_EVENT` props.
	for (let k in prop_vals) {
		if (k.starts('on_')) {
			let f = prop_vals[k]
			delete prop_vals[k]
			k = k.slice(3)
			if (isstr(f)) { // set from html: name of global function.
				let fname = f
				f = function(...args) {
					let f = window[fname]
					if (!f) return
					f.call(this, ...args)
				}
			}
			e.on(k, f)
		}
	}

	// set props to their initial values.
	e.initialized = false // let prop setters know that we're not fully initialized.
	component.init_instance(e, prop_vals)
	e.initialized = true

	// call the after-all-properties-are-set init function.
	if (e._user_init)
		e._user_init()

	// NOTE: id must be given when the component is created, not set later!
	if (e.id) {
		e.on('attr_changed', function(k, v, v0) {
			if (k == 'id')
				e.announce('id_changed', v, v0)
		})
		e.announce('init')
		e.announce(e.id+'.init')
	}

	e.debug_close_if(DEBUG_INIT)
}

// the component is responsible for calling init_child_components()
// in its initializer if it knows it can have components as children.
e.init_child_components = function() {
	if (this.len)
		for (let ce of this.children)
			ce._init_component()
}

e.on_init = function(f) {
	this.do_after('_user_init', f)
}

// element bind --------------------------------------------------------------

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
})

e._bind_children = function bind_children(on) {
	if (!this.len)
		return
	assert(isbool(on))
	for (let ce of this.children)
		ce._bind(on)
}

e._bind = function bind(on) {
	assert(isbool(on))
	let e = this
	// only tags that called on_bind() or have an id get this event.
	if (e._bound != null || e.id) {
		if (e._bound == on)
			return
		e._bound = on
		assert(e.bound != null)
		if (on) {
			e.debug_open_if(DEBUG_BIND, '+')
			let t0 = PROFILE_BIND_TIME && time()
			if (e._user_bind)
				e._user_bind(true)
			if (e.id) {
				announce(e, 'bind', true)
				announce(e, e.id+'.bind', true)
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
			if (e._user_bind)
				e._user_bind(false)
			if (e.id) {
				announce(e, 'bind', false)
				announce(e, e.id+'.bind', false)
			}
			e.debug_close_if(DEBUG_BIND)
		}
	}
	// bind children after their parent is bound to allow components to remove
	// their children inside the bind event handler before them getting bound,
	// and also so that children see a bound parent when they are getting bound.
	e._bind_children(on)
}

e.on_bind = function(f) {
	if (this._bound == null)
		this._bound = this.bound
	this.do_after('_user_bind', f)
}

root = document.documentElement

function init_components() {
	body = document.body // for debugging, don't use in code.
	head = document.head // for debugging, don't use in code.
	if (DEBUG_INIT)
		debug('ROOT INIT ---------------------------------')
	root._init_component()
	if (DEBUG_BIND)
		debug('ROOT BIND ---------------------------------')
	root._bind(true)
	if (DEBUG_BIND)
		debug('ROOT BIND DONE ----------------------------')
}

// element global events -----------------------------------------------------

// listen to a global event *while the element is bound*.
e.listen = function(event, f) {
	let handlers = obj() // event->f
	this.listen = function(event, f) {
		handlers[event] = f
	}
	this.listen(event, f)
	function bind(on) {
		for (let event in handlers)
			listen(event, handlers[event], on)
	}
	this.on_bind(bind)
	if (this.bound)
		bind(true)
}

e.announce = function(event, ...args) {
	if (!this.bound) return
	announce(event, this, ...args)
}

// DOM manipulation API ------------------------------------------------------

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
function unsafe_html(s, unwrap) {
	if (typeof s != 'string') // pass-through: nulls, elements, etc.
		return s
	let span = document.createElement('span')
	span.unsafe_html = s.trim()
	span._init_component()
	let n = span.childNodes.length
	if (unwrap == false && (n > 1 || !span.len)) // not a single element
		return span
	return n > 1 ? [...span.nodes] : span.firstChild
}

function sanitize_html(s) {
	if (typeof s != 'string') // pass-through: nulls, elements, etc.
		return s
	assert(DOMPurify.isSupported)
	return DOMPurify.sanitize(s)
}

function html(s, unwrap) {
	return unsafe_html(sanitize_html(s), unwrap)
}

let create_element = function(tag, prop_vals, attrs, ...children) {
	let e = document.createElement(tag)
	e.attrs = attrs
	for (let s of children) {
		if (isfunc(s)) // constructor
			s = s()
		if (s == null) // skip nulls
			continue
		if (isarray(s)) // expand array
			for (let cs of s)
				e.append(cs)
		else
			e.append(s)
	}
	e._init_component(prop_vals)
	return e
}

// element(node | stringable | null | {id|tag:, PROP->VAL}, [attrs], [e1,...]) -> node | null
function element(t, attrs, ...children) {
	if (isfunc(t)) // constructor
		t = t()
	if (t == null || isnode(t)) // node | null | undefined: pass through
		return t
	if (isobj(t)) { // {id|tag:, PROP->VAL}: create element
		let id = t.id
		let e0 = window[id]
		if (e0)
			return e0 // already created (called from a prop's `convert()`).
		let tag = t.tag || component.instance_tag(id)
		if (!tag) {
			warn('component id not found:', id)
			return
		}
		return create_element(tag, t, attrs, ...children)
	}
	return document.createTextNode(t) // stringable -> node
}

// create a HTML element from an attribute map and a list of child nodes.
// skips nulls, calls constructors, expands arrays.
function tag(tag, attrs, ...children) {
	return create_element(tag, null, attrs, ...children)
}

div  = (...a) => tag('div' , ...a)
span = (...a) => tag('span', ...a)

function svg_tag(tag, attrs, ...children) {
	let e = document.createElementNS('http://www.w3.org/2000/svg', tag)
	e.attrs = tag == 'svg' ? assign_opt({
		preserveAspectRatio: 'xMidYMid meet',
	}, attrs) : attrs
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
	cloned._init_component()
	return cloned
})

alias(Element, 'as_html', 'outerHTML')

property(Element, 'unsafe_html', {
	set: function(s) {
		let _bound = this._bound
		let bound = this.bound
		if (bound)
			this._bind_children(false)
		this.innerHTML = s
		this._bound = false // prevent bind in init for children.
		this.init_child_components()
		this._bound = _bound
		if (bound)
			this._bind_children(true)
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

e.clear = function() {
	this.unsafe_html = null
	return this
}

// set element contents to: text, node, null.
// calls constructors, expands arrays.
e.set = function E_set(s) {
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
					s1._bind(false)
			this.innerHTML = null
			for (let s1 of s)
				if (s1 != null)
					this.append(s1)
		} else {
			// unbind nodes that are not in the new list.
			for (let node of this.nodes)
				if (iselem(node) && !s.includes(node)) // TODO: O(n^2) !
					node._bind(false)
			this.innerHTML = null
			for (let s1 of s)
				if (s1 != null)
					this.append(s1)
			// bind any unbound new elements.
			this._bind_children(true)
		}
	} else { // string or stringable: set as text.
		this.clear() // unbind children
		this.textContent = s
	}
	return this
}

// append nodes to an element.
// skips nulls, calls constructors, expands arrays.
e.add = function E_add(...args) {
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
			s._bind(false)
		this.append(s)
		if (bind == true)
			s._bind(true)
	}
	return this
}

// insert nodes into an element at a position.
// skips nulls, calls constructors, expands arrays.
e.insert = function E_insert(i0, ...args) {
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
			s._bind(false)
		this.insertBefore(s, this.at[i0])
		if (bind == true)
			s._bind(true)
	}
	return this
}

override(Element, 'remove', function E_remove(inherited) {
	this._bind(false)
	inherited.call(this)
	return this
})

// replace child node with: text, node, null (or a constructor returning those).
// if the node to be replaced is null, the new node is appended instead.
// if the new node is null, the old node is removed.
e.replace = function E_replace(e0, s) {
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
			e0._bind(false)
		let bind = iselem(s) ? this.bound : null
		if (bind == false)
			s._bind(false)
		this.replaceChild(s, e0)
		if (bind == true)
			s._bind(true)
	} else if (s != null) {
		let bind = iselem(s) ? this.bound : null
		if (bind == false)
			s._bind(false)
		this.appendChild(s)
		if (bind == true)
			s._bind(true)
	}
	return this
}

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

// diff an element array against a new words/array of elements/element-ids/element-prop-vals.
// elements not in the old array are created, elements present in the old array
// or having the same id are retained, elements not in the new array are marked
// for removal by setting the `_remove` flag. if t and cur_elems have the same
// contents, cur_elems is returned.
{
let cur_set = set()
let cur_by_id = map()
function update_element_list(t, cur_elems) {
	t = isstr(t) ? t.words() : t
	if (t.equals(cur_elems))
		return cur_elems
	// map current items by identity and by id.
	cur_set.clear()
	cur_by_id.clear()
	for (let item of cur_elems) {
		cur_set.add(item)
		if (item.id)
			cur_by_id.set(item.id, item)
		item._remove = true
	}
	// create new items or reuse existing ones as needed.
	let items = []
	for (let v of t) {
		// v is either an item from cur_elems, an id, or the prop_vals of a new item.
		let cur_item = cur_set.has(v) ? v : cur_by_id.get(isstr(v) ? v : v.id)
		let item = cur_item || element(isstr(v) ? {id: v} : v)
		items.push(item)
		item._remove = false
	}
	return items
}
}

// util to convert an array to a html bullet list ----------------------------

{
let ul = function(a, ul_tag, ul_attrs, only_if_many) {
	if (only_if_many && a.length < 2)
		return a[0] || ''
	return tag(ul_tag, ul_attrs, ...a.map(s => tag('li', 0, s)))
}
Array.prototype.ul = function(attrs, only_if_many) { return ul(this, 'ul', attrs, only_if_many) }
Array.prototype.ol = function(attrs, only_if_many) { return ul(this, 'ol', attrs, only_if_many) }
}

/* component method overriding -----------------------------------------------

NOTE: unlike global override(), e.override() cannot override built-in methods.
You can still use the global override() to override built-in methods in an
instance without affecting the prototype, and just the same you can use
override_property_setter() to override a setter in an instance without
affecting the prototype.

*/

e.override = function(method, func) {
	let inherited = this[method] || noop
	this[method] = function(...args) {
		return func.call(this, inherited, ...args)
	}
}

e.do_before = function(method, func) {
	let inherited = repl(this[method], noop)
	this[method] = inherited && function(...args) {
		func.call(this, ...args)
		inherited.call(this, ...args)
	} || func
}

e.do_after = function(method, func) {
	let inherited = repl(this[method], noop)
	this[method] = inherited && function(...args) {
		inherited.call(this, ...args)
		func.call(this, ...args)
	} || func
}

/* component virtual properties ----------------------------------------------

publishes:
	e.property(name, get, [set])
	e.prop(name, attrs)
	e.<prop>
	e.props: {prop->prop_attrs}
		store: false          value is read by calling `e.get_<prop>()`.
		attr: true|NAME       value is *also* stored into a html attribute.
		private               window is not notifed of prop value changes.
		default               default value.
		convert(v, v0) -> v   convert value when setting the property.
		type                  for html attr val conversion and for object inspector.
		from_attr(s) -> v     convert from html attr text representation.
		to_attr(v) -> s       convert to html attr text representation.
		serialize()
		bind_id               the prop represents an element id to dynamically link to.
calls:
	e.get_<prop>() -> v
	e.set_<prop>(v1, v0)
fires:
	^^prop_changed(e, prop, v1, v0)
	^^id_changed(e, id, id0)

*/

e.property = function(name, get, set) {
	return property(this, name, get, set)
}

e.xoff = function() { this._xoff = true  }
e.xon  = function() { this._xoff = false }

function announce_prop_changed(e, prop, v1, v0) {
	if (e._xoff) {
		e.props[prop].default = v1
	} else {
		e.announce('prop_changed', prop, v1, v0)
	}
}

let resolve_linked_element = function(id) { // stub
	let e = window[id]
	return iselem(e) && e.bound ? e : null
}

let from_bool_attr = v => repl(repl(v, '', true), 'false', false)

let from_attr_func = function(opt) {
	if (opt.from_attr == false)
		return false
	return opt.from_attr
			|| (opt.type == 'bool'   && from_bool_attr)
			|| (opt.type == 'number' && num)
			|| return_arg
}

let set_attr_func = function(e, k, opt) {
	if (opt.to_attr)
		return v => e.attr(k, v)
	if (opt.type == 'bool')
		return v => e.bool_attr(k, v || null)
	return v => e.attr(k, v)
}

e.prop = function(prop, opt) {
	let e = this
	opt = opt || obj()
	assign_opt(opt, e.props && e.props[prop])
	let getter = 'get_'+prop
	let setter = 'set_'+prop
	opt.name = prop
	let convert = opt.convert || return_arg
	let priv = opt.private
	if (!e[setter])
		e[setter] = noop
	let prop_changed = announce_prop_changed
	let dv = opt.default

	opt.from_attr = from_attr_func(opt)
	let prop_attr = isstr(opt.attr) ? opt.attr : prop
	let set_attr = opt.attr && set_attr_func(e, prop_attr, opt)
	if (prop_attr != prop)
		attr(e, 'attr_prop_map')[prop_attr] = prop

	if (opt.store != false) { // stored prop
		let v = dv
		function get() {
			return v
		}
		function set(v1, ev) {
			let v0 = v
			v1 = convert(v1, v0)
			if (v1 === v0)
				return
			v = v1
			e[setter](v1, v0, ev)
			if (set_attr)
				set_attr(v1)
			if (!priv)
				prop_changed(e, prop, v1, v0, ev)
			e.update()
		}
		if (dv != null && set_attr && !e.hasattr(prop_attr))
			set_attr(dv)
	} else { // virtual prop with getter
		assert(!('default' in opt))
		function get() {
			return e[getter]()
		}
		function set(v, ev) {
			let v0 = e[getter]()
			v = convert(v, v0)
			if (v === v0)
				return
			e[setter](v, v0, ev)
			if (!priv)
				prop_changed(e, prop, v, v0, ev)
			e.update()
		}
	}

	// id-based dynamic binding of external elements to a prop.
	if (opt.bind_id || opt.on_bind) {
		assert(!priv)
		let ID = prop
		let DEBUG_ID = DEBUG_ELEMENT_BIND && '['+ID+']'
		let REF = opt.bind_id || ID+'_ref'
		let on_bind = opt.on_bind
		function id_bind(id, on) {
			if (!id) return
			let te = on ? resolve_linked_element(id) : null
			if (on_bind && e[REF])
				on_bind.call(e, e[REF], false)
			e[REF] = te
			if (on_bind && te)
				on_bind.call(e, te, true)
			e.debug_if(DEBUG_ELEMENT_BIND, te ? '==' : '=/=', DEBUG_ID, id)
		}
		e.listen('bind', function(te, on) {
			if (!e[ID] || e[ID] != te.id) return
			if (on_bind && e[REF])
				on_bind.call(e, e[REF], false)
			e[REF] = on ? te : null
			if (on_bind && on)
				on_bind.call(e, te, true)
			e.debug_if(DEBUG_ELEMENT_BIND, on ? '==' : '=/=', DEBUG_ID, te.id)
		})
		e.listen('id_changed', function(te, id1, id0) {
			if (e[ID] != id0) return
			e[ID] = id1
		})
		e.on_bind(function(on) {
			id_bind(e[ID], on)
		})
		prop_changed = function(e, k, v1, v0) {
			announce_prop_changed(e, k, v1, v0)
			id_bind(v0, false)
			id_bind(v1, true)
		}
		if (e.bound)
			id_bind(e[ID], true)
	}

	e.property(prop, get, set)
	opt.get = get
	opt.set = set

	attr(e, 'props')[prop] = opt

}

e.alias = function(new_name, old_name) {
	if (this.props) {
		let attrs = this.get_prop_attrs(old_name)
		if (attrs)
			this.props[new_name] = attrs
	}
	alias(this, new_name, old_name)
}

// dynamic properties.
e.set_prop = function(k, v, ev) {
	let pa = this.get_prop_attrs(k)
	if (pa)
		pa.set.call(this, v, ev)
	else
		this[k] = v
} // stub
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

e.serialize = function() {
	let e = this
	if (e.id)
		return e.id
	let t = {tag: e.tag}
	if (e.props) {
		for (let prop in e.get_props()) {
			let v = e.serialize_prop(prop, e.get_prop(prop))
			if (v !== undefined)
				t[prop] = v
		}
	} else { // built-in tag
		t.attrs = e.attrs
		t.html = e.html
	}
	return t
}

/* element disablable mixin --------------------------------------------------

publishes:
	e.disabled
	e.disable(reason, disabled)

NOTE: The `disabled` state is a concerted effort located in multiple places:
- pointer events are blocked by `pointer-events: none`, and they're also
- blocked in the pointer event wrappers in case `pointer-events: none` doesn't
- cut it (raw events still work in that case).
- forcing the default cursor on the element and its children is done with css.
- showing the element with .5 opacity is done with css.
- keyboard focusing is disabled in make_focusable().

NOTE: Don't put disablables on top of other elements (eg. popups can't be
disablable), because they are click-through. If you set .click-through-off
on a disablable, pointer events will still get blocked, but `:hover` and
`:active` will start working again, so you'll need to add `:not([disabled])`
on your state styles. You can't win on the web.

NOTE: Scrolling doesn't work with click-through elements, which can be an issue.

NOTE: For non-focusables setting the `disabled` attr is enough to disable them.

*/

css_generic_state('[disabled]', '', `
	opacity: .5;
	filter: grayscale();
	pointer-events: none;
`)

css_generic_state('[disabled] [disabled]', '', `
	opacity: unset;
	filter: unset;
`)

css_generic_state('[disabled], [disabled] *', '', `
	cursor: default !important;
`)

e.make_disablable = function() {

	let e = this
	e.make_disablable = noop
	e.disablable = true

	e.on_bind(function(on) {
		// each disabled ancestor is a reason for this element to be disabled.
		// NOTE: this makes disabled sub-trees non-movable in the DOM.
		if (on) {
			let p = this.parent
			while (p) {
				if (p.disabled)
					this.disable(p, true)
				p = p.parent
			}
		} else {
			let p = this.parent
			while (p) {
				this.disable(p, false)
				p = p.parent
			}
		}
	})

	function disable_children(e, reason, disabled) {
		for (let ce of e.children)
			if (ce.disablable)
				ce.disable(reason, disabled)
			else
				disable_children(ce, reason, disabled)
	}

	e.do_after('set_disabled', function(disabled) {
		// add/remove this element as a reason for its children to be disabled.
		disable_children(this, this, disabled)
	})

	function get_disabled() {
		return this.hasattr('disabled')
	}
	function set_disabled(disabled) {
		disabled = !!disabled
		let disabled0 = this.hasattr('disabled')
		if (disabled0 == disabled)
			return
		this.bool_attr('disabled', disabled || null)
		this.set_disabled(disabled, disabled0)
	}
	if (e.disabled == null) {
		e.property('disabled', get_disabled, set_disabled)
	} else {
		override_property_setter(e, 'disabled', function(inherited, disabled) {
			set_disabled.call(this, disabled)
			return inherited.call(this, disabled)
		})
	}

	let dr
	e.disable = function(reason, disabled) {
		if (disabled != false) {
			dr = dr || set()
			dr.add(reason)
			e.disabled = true
		} else if (dr) {
			dr.delete(reason)
			if (!dr.size) {
				e.disabled = false
			}
		}
		e.disabled_reasons = dr
	}
}

e.disable = function(...args) {
	this.make_disablable()
	return this.disable(...args)
}

/* element focusable mixin ---------------------------------------------------

publishes:
	e.tabindex
	e.focusable
sets css classes:
	focusable

*/

// NOTE: uses CSS classes `.outline-focus` and `.no-outline` that are
// not defined here, define them yourself or load css.js which has them.

// move the focus ring from focused element to the outermost element with `.focus-within`.
css_role_state('.focus-within:has(.focus-outside:focus-visible)', 'outline-focus') // outermost
css_role_state('.focus-within .focus-within:has(.focus-outside:focus-visible)', 'no-outline') // not outermost
css_role_state_firefox('.focus-within:focus-within', 'outline-focus') // no :has() yet on FF.
css_role_state('.focus-outside:focus-visible', 'no-outline')

// Popup focusables attached to a focusable are DOM-wise within the focusable,
// but visually they're near it. Mark them as such with the .not-within class
// so that they get a focus outline instead of their outermost focusable ancestor getting it.
css_role_state('.not-within:has(.focus-outside:focus-visible)', 'outline-focus')
css_role_state('.focus-within:has(.not-within .focus-outside:focus-visible)', 'no-outline')

let builtin_focusables = {button:1, input:1, select:1, textarea:1, a:1, area:1}
function is_builtin_focusable(e) {
	return builtin_focusables[e.tag]
}

e.make_focusable = function(...fes) {

	let e = this
	e.make_focusable = noop

	if (!fes.length)
		fes.push(e)

	for (fe of fes)
		if (!fe.hasattr('tabindex'))
			fe.attr('tabindex', 0)

	if (fes[0] != e) {
		e.class('focus-within')
		for (let fe of fes)
			fe.class('focus-outside')
	}

	function update() {
		let can_be_focused = e.focusable && !e.disabled
		e.class('focusable', can_be_focused)
		for (let fe of fes)
			fe.attr('tabindex', can_be_focused ? e.tabindex : (is_builtin_focusable(fe) ? -1 : null))
		if (!can_be_focused)
			e.blur()
	}

	e.do_after('set_disabled', update)

	e.set_tabindex = update
	e.set_focusable = update
	e.prop('tabindex' , {type: 'number', default: 0})
	e.prop('focusable', {type: 'bool', private: true, default: true})

	let last_focused
	function set_last_focused() {
		last_focused = this
	}
	if (fes.length > 1)
		for (let fe of fes)
			fe.on('focusout', set_last_focused)

	let inh_focus = e.focus
	e.focus = function() {
		if (fes[0] == this || this.widget_selected)
			inh_focus.call(this)
		else
			(last_focused || fes[0]).focus()
	}

}

function focused_focusable(e) {
	e = e || document.activeElement
	return e && e.focusable && e || (e.parent && e.parent != e && focused_focusable(e.parent))
}

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

e.update = function(opt) {
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
	if (update_set.has(this)) // update() inside do_update(), eg. a prop was set.
		return
	update_set.add(this)
	if (updating)
		return
	// ^^ update() called while updating: the update_set iterator will
	// call do_update() in this frame, no need to ask for another frame.
	update_all()
}

e.cancel_update = function() {
	update_set.delete(e)
	position_set.delete(e)
}

e.on_update = function(f) {
	this._bound = this.bound || false
	this.do_after('do_update', f)
}

e._do_update = function() {
	let opt = this._update_opt
	this._update_opt = null
	this.debug_open_if(DEBUG_UPDATE, 'U', Object.keys(opt).join(','))
	if (opt.show != null)
		this.show(opt.show)
	if (this.do_update)
		this.do_update(opt)
	this.position()
	this.debug_close_if(DEBUG_UPDATE)
}

e.position = function() {
	if (!this.do_position)
		return
	if (!this.bound)
		return
	position_set.add(this)
	if (updating)
		return
	// ^^ position() called while updating: no need to ask for another frame.
	update_all()
}

e.on_measure = function(f) {
	this._bound = this.bound || false
	this.do_after('do_measure', f)
}

e.on_position = function(f) {
	this._bound = this.bound || false
	this.do_after('do_position', f)
}

// timer that is paused on unbind --------------------------------------------

e.timer = function(f) {
	let tm = timer(f)
	this.on_bind(function(on) {
		if (!on) tm()
	})
	return tm
}

// events & event wrappers ---------------------------------------------------

let installers = on.installers
let callers = on.callers

// resize event --------------------------------------------------------------

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

// DOM change events ---------------------------------------------------------

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

let nodes_change_observer = new MutationObserver(function(mutations) {
	for (let mut of mutations)
		mut.target.fire('nodes_changed', mut)
})
installers.nodes_changed = function() {
	if (this.__detecting_node_changes)
		return
	this.__detecting_node_changes = true
	let observing
	function bind(on) {
		if (on) {
			if (!observing) {
				nodes_change_observer.observe(this, {
					childList: true,
					subtree: true,
					characterData: true,
					characterDataOldValue: true,
				})
				observing = true
			}
		} else {
			if (observing) {
				nodes_change_observer.disconnect(this)
				observing = false
			}
		}
	}
	this.on_bind(bind)
	if (this.bound)
		bind.call(this, true)
}

/* mouse events --------------------------------------------------------------

NOTE: these wrappers block mouse events on any target that has attr `disabled`
or that has any ancestor with attr `disabled`. We're not using
`pointer-events: none` because that makes disabled elements click-through
(think clicking through disabled popups) and also disables scrolling, so you
wouldn't see or select text from a disabled container with a scrollbar.

*/

alias(PointerEvent, 'shift', 'shiftKey')
alias(PointerEvent, 'ctrl' , 'ctrlKey')
alias(PointerEvent, 'alt'  , 'altKey')

installers.hover = function() {
	if (this.__hover_installed)
		return
	this.__hover_installed = true
	this.on('pointerover', function(ev, mx, my) {
		if (this.pointer_captured)
			return
		if (ev.buttons)
			return
		if (this.hasattr('disabled'))
			return
		this.fire('hover', ev, true, mx, my)
	})
	this.on('pointerleave', function(ev) {
		if (this.pointer_captured)
			return
		if (this.hasattr('disabled'))
			return
		this.fire('hover', ev, false)
	})
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
	let cursor_style
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

// when using capture_pointer(), setting the cursor for the element that
// is hovered doesn't work anymore, so use this hack instead.
{
let cursor_style
function force_cursor(cursor) {
	if (cursor) {
		if (!cursor_style) {
			cursor_style = tag('style')
			cursor_style.unsafe_html = '* {cursor: '+cursor+' !important; }'
			root.add(cursor_style)
		} else {
			cursor_style.unsafe_html = '* {cursor: '+cursor+' !important; }'
		}
	} else if (cursor_style) {
		cursor_style.remove()
		cursor_style = null
	}
}
}

/* drag & drop protocol ------------------------------------------------------

TL;DR:
- as a source, listen on start_drag(), dragging(), stop_drag().
  call start(payload, payload_rect) inside start_drag() to start the drag.
- as a dest, listen on drag_started(), drag_stopped(), dropping(), drop(),
  and possibly accept_drop(). call add_drop_area(elem, drop_area_rect)
  inside drag_started() to register drop areas.

LONG(ER) VERSION:
- listen on ^start_drag(pointermove_ev, start, mx, my, pointerdown_ev, mx0, my0)
  which is called on ^pointerdown and on ^pointermove.
- inside ^start_drag, call start([payload[, payload_rect]]) to start dragging
  a payload (defaults to this). the payload can have a rect in abs. coords
  (defaults to a zero-sized rect at cursor position).
- ^^drag_started(payload, add_drop_area, source_elem) is then announced so that potential
  acceptors can announce their drop area rect(s) by calling add_drop_area(elem, drop_area_rect).
- while the mouse moves, hit elements get ^accept_drop(pointermove_ev, payload, payload_rect)
  which they can cancel, signaling refusal to accept the drop.
- if multiple elements accept the drop at the same time, the one with the largest
  intersected area wins, and gets ^dropping(pointermove_ev, true, payload, payload_rect),
  and the element that won last time gets ^dropping(pointermove_ev, false, payload, payload_rect).
- on ^pointerup, the source elem gets ^stop_drag(pointermove_ev, [dest_elem], payload, payload_rect),
  and canceling it means refusal to drop to dest_elem.
- the destination elem gets ^drop(pointerup_ev, payload, payload_rect) if the drop wasn't
  canceled or ^dropping(pointerup_ev, false, payload, payload_rect) if it was.
- source elem also gets ^dragging(ev, payload, payload_rect, [dest_elem]) while the mouse moves,
  and canceling it means refusal to accept dest_elem as a drop target.
- ^^drag_stopped(payload, payload_rect) is always announced when the drag stopped.

*/
installers.start_drag = function() {
	this.on('pointerdown', function(ev, mx0, my0) {

		let source_elem = this
		let down_ev = ev
		let mx, my
		let dragging, payload
		let px, py, pw, ph // payload rect in relative-to-cursor coords.
		let drop_areas = [] // [r1, ...]
		let drop_elems = [] // [e1, ...]

		function add_drop_area(e, r) {
			drop_areas.push(assert(r))
			drop_elems.push(assert(e))
		}

		function start(payload_arg, payload_r) {
			dragging = true
			payload = payload_arg || source_elem
			px = payload_r && payload_r.x - mx0 || 0
			py = payload_r && payload_r.y - my0 || 0
			pw = payload_r && payload_r.w || 0
			ph = payload_r && payload_r.h || 0
			announce('drag_started', payload, add_drop_area, source_elem)
		}

		let dest_elem

		let payload_r = domrect()
		let temp_r = domrect()
		function source_elem_move(ev, mx1, my1) {
			mx = mx1
			my = my1
			if (!dragging)
				source_elem.fireup('start_drag', ev, start, mx, my, down_ev, mx0, my0)
			if (dragging) {
				payload_r.x = mx + px
				payload_r.y = my + py
				payload_r.w = pw
				payload_r.h = ph
				let max_area = 0
				let last_dest_elem = dest_elem
				dest_elem = null
				for (let i = 0, n = drop_areas.length; i < n; i++) {
					let drop_area_r = drop_areas[i]
					let cr = payload_r.clip(drop_area_r, temp_r)
					let area = cr.w * cr.h
					if (pw == 0 || ph == 0 || area > 0) {
						let e = drop_elems[i]
						if (e.fire('accept_drop', ev, payload, payload_r)) {
							if (area > max_area) {
								max_area = area
								dest_elem = e
							}
						}
					}
				}
				if (!source_elem.fire('dragging', ev, payload, payload_r, dest_elem))
					dest_elem = null
				if (last_dest_elem && last_dest_elem != dest_elem)
					last_dest_elem.fire('dropping', ev, false, payload, payload_r)
				if (dest_elem)
					dest_elem.fire('dropping', ev, true, payload, payload_r)
			}
		}

		function source_elem_up(ev, mx, my) {
			if (!dragging)
				return
			if (!source_elem.fireup('stop_drag', ev, dest_elem, payload, payload_r)) {
				if (dest_elem)
					dest_elem.fireup('dropping', ev, false, payload, payload_r)
			} else if (dest_elem)
				dest_elem.fireup('drop', ev, payload, pr)
			announce('drag_stopped', payload, source_elem)
		}

		source_elem_move(ev, mx0, my0)

		return this.capture_pointer(ev, source_elem_move, source_elem_up)
	})
}

/* keyboard events -----------------------------------------------------------

NOTE: preventing focusing is a matter of not-setting/removing attr `tabindex`
except for input elements that must have an explicit `tabindex=-1`.
This is not done here, see e.make_disablable() and e.make_focusable().

*/

callers.keydown = function(ev, f) {
	return f.call(this, ev.key, ev.shiftKey, ev.ctrlKey, ev.altKey, ev)
}
callers.keyup    = callers.keydown
callers.keypress = callers.keydown

alias(KeyboardEvent, 'shift', 'shiftKey')
alias(KeyboardEvent, 'ctrl' , 'ctrlKey')
alias(KeyboardEvent, 'alt'  , 'altKey')

callers.wheel = function(ev, f) {
	if (ev.target.effectively_disabled)
		return
	let dy = ev.wheelDeltaY
	if (dy)
		return f.call(this, ev, dy, ev.clientX, ev.clientY)
}

override(Event, 'stopPropagation', function(inherited, ...args) {
	inherited.call(this, ...args)
	this.propagation_stoppped = true
	// notify document of stopped events.
	if (this.type == 'pointerdown')
		document.fire('stopped_event', this)
})

// DOMRect extensions --------------------------------------------------------

function domrect(...args) {
	return new DOMRect(...args)
}

alias(DOMRectReadOnly, 'x1', 'left')
alias(DOMRectReadOnly, 'y1', 'top')
alias(DOMRectReadOnly, 'w' , 'width')
alias(DOMRectReadOnly, 'h' , 'height')
alias(DOMRectReadOnly, 'x2', 'right')
alias(DOMRectReadOnly, 'y2', 'bottom')

alias(DOMRect, 'x1', 'left')
alias(DOMRect, 'y1', 'top')
alias(DOMRect, 'w' , 'width')
alias(DOMRect, 'h' , 'height')
alias(DOMRect, 'x2', 'right')
alias(DOMRect, 'y2', 'bottom')

method(DOMRectReadOnly, 'contains', function(x, y) {
	return (
		(x >= this.left && x <= this.right) &&
		(y >= this.top  && y <= this.bottom))
})

method(DOMRect, 'set', function(x, y, w, h) {
	if (x instanceof DOMRectReadOnly) {
		this.x = x.x
		this.y = x.y
		this.w = x.w
		this.h = x.h
	} else {
		this.x = x
		this.y = y
		this.w = w
		this.h = h
	}
})

{
let out = []
method(DOMRectReadOnly, 'clip', function(r, out_r) {
	out = clip_rect(this.x, this.y, this.w, this.h, r.x, r.y, r.w, r.h, out)
	if (out_r) {
		out_r.set(...out)
		return out_r
	} else {
		return domrect(...out)
	}
})
}

method(DOMRectReadOnly, 'intersects', function(r) {
	return rect_intersects(this.x, this.y, this.w, this.h, r.x, r.y, r.w, r.h)
})

/* element geometry ----------------------------------------------------------

NOTE: x, y, w, h, x1, x2, y1, y2 set offsets from offsetParent to the element's
box *including its margins*, so what you want to measure those against are
ox, oy, ow, oh, but note that those are rounded!

*/

// NOTE: setting style.* to undefined is ignored so we change it to null!
function px(v) {
	return isnum(v) ? v+'px' : or(v, null)
}

property(Element, 'x1'   , function() { return this.__x1 }, function(v) { if (v !== this.__x1) { this.__x1 = v; this.style.left          = px(v) } })
property(Element, 'y1'   , function() { return this.__y1 }, function(v) { if (v !== this.__y1) { this.__y1 = v; this.style.top           = px(v) } })
property(Element, 'x2'   , function() { return this.__x2 }, function(v) { if (v !== this.__x2) { this.__x2 = v; this.style.right         = px(v) } })
property(Element, 'y2'   , function() { return this.__y2 }, function(v) { if (v !== this.__y2) { this.__y2 = v; this.style.bottom        = px(v) } })
property(Element, 'w'    , function() { return this.__w  }, function(v) { if (v !== this.__w ) { this.__w  = v; this.style.width         = px(v) } })
property(Element, 'h'    , function() { return this.__h  }, function(v) { if (v !== this.__h ) { this.__h  = v; this.style.height        = px(v) } })
property(Element, 'min_w', function() { return this.__mw }, function(v) { if (v !== this.__mw) { this.__mw = v; this.style['min-width' ] = px(v) } })
property(Element, 'min_h', function() { return this.__mh }, function(v) { if (v !== this.__mh) { this.__mh = v; this.style['min-height'] = px(v) } })
property(Element, 'max_w', function() { return this.__Mw }, function(v) { if (v !== this.__Mw) { this.__Mw = v; this.style['max-width' ] = px(v) } })
property(Element, 'max_h', function() { return this.__Mh }, function(v) { if (v !== this.__Mh) { this.__Mh = v; this.style['max-height'] = px(v) } })

alias(Element, 'x', 'x1')
alias(Element, 'y', 'y1')

// NOTE: these are rounded, integer values!
alias(HTMLElement, 'ox', 'offsetLeft')
alias(HTMLElement, 'oy', 'offsetTop')
alias(HTMLElement, 'ow', 'offsetWidth')
alias(HTMLElement, 'oh', 'offsetHeight')
e.orect = function() {
	return domrect(this.ox, this.oy, this.ow, this.oh)
}

// position in viewport space; includes padding and border, but not margins.
e.rect = function() {
	return this.getBoundingClientRect()
}

alias(Element, 'cx', 'clientLeft')
alias(Element, 'cy', 'clientTop')
alias(Element, 'cw', 'clientWidth')
alias(Element, 'ch', 'clientHeight')

alias(HTMLElement, 'sx', 'scrollLeft')
alias(HTMLElement, 'sy', 'scrollTop')
alias(HTMLElement, 'sw', 'scrollWidth')
alias(HTMLElement, 'sh', 'scrollHeight')

method(Window, 'rect', function() {
	return domrect(0, 0, this.innerWidth, this.innerHeight)
})

window.on('resize', function window_resize() {
	document.fire('layout_changed')
})

// this is only needed on Firefox with the debugger open,
// and if you don't preload fonts (which you should).
document.fonts.on('loadingdone', function() {
	document.fire('layout_changed')
})

// common state wrappers -----------------------------------------------------

css_generic_state('[hidden]', '', `
	display: none !important;
`)

e.hide = function(on) {
	if (!arguments.length)
		on = true
	else
		on = !!on
	if (this.hidden == on)
		return
	this.hidden = on
	this.fire('show', !on)
	return this
}

e.show = function(on) {
	if (!arguments.length)
		on = true
	this.hide(!on)
	return this
}

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

e.focusables = function() {
	let a = []
	let sel = ':is(button,a[href],area[href],input,select,textarea,[tabindex]):not([tabindex="-1"])'
	for (let e of this.$(sel)) {
		if (!e.effectively_hidden && !e.effectively_disabled)
			a.push(e)
	}
	return a
}

e.focus_first = function() {
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
}

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

function scroll_to_view_dim(x, w, pw, sx, align) {
	if (align == 'center') { // enlarge content around its center to center it
		x -= (10**6 - w) / 2
		w = 10**6
	}
	if (w > pw) // content larger than viewport.
		if (align == 'center' || align == 'center-auto')
			return -(x + (w - pw) / 2)
	let min_sx = -x
	let max_sx = -(x + w - pw)
	return clamp(sx, min_sx, max_sx)
}

function scroll_to_view_rect(x, y, w, h, pw, ph, sx, sy, halign, valign) {
	sx = scroll_to_view_dim(x, w, pw, sx, halign)
	sy = scroll_to_view_dim(y, h, ph, sy, or(valign, halign))
	return [sx, sy]
}

e.scroll_to_view_rect_offset = function(sx0, sy0, x, y, w, h, halign, valign) {
	let pw  = this.cw
	let ph  = this.ch
	if (sx0 == null) { sx0 = this.scrollLeft; }
	if (sy0 == null) { sy0 = this.scrollTop ; }
	let e = this
	let [sx, sy] = scroll_to_view_rect(x, y, w, h, pw, ph, -sx0, -sy0, halign, valign)
	return [-sx, -sy]
}

// scroll to make inside rectangle invisible.
e.scroll_to_view_rect = function(sx0, sy0, x, y, w, h, halign, valign) {
	let [sx, sy] = this.scroll_to_view_rect_offset(sx0, sy0, x, y, w, h, halign, valign)
	this.scroll(sx, sy)
	return [sx, sy]
}

e.make_visible_scroll_offset = function(sx0, sy0, parent, halign, valign) {
	parent = this.parent
	let x = this.ox
	let y = this.oy
	let w = this.ow
	let h = this.oh
	return parent.scroll_to_view_rect_offset(sx0, sy0, x, y, w, h, halign, valign)
}

// scroll parent to make self visible.
e.make_visible = function(halign, valign, smooth) {
	let parent = this.parent
	while (parent && parent != document) {
		let [sx, sy] = this.make_visible_scroll_offset(null, null, parent, halign, valign)
		parent.scroll({left: sx, top: sy, behavior: (smooth ? 'smooth' : 'auto')})
		parent = parent.parent
		break
	}
}

// check if element is partially or fully visible.
e.is_in_viewport = function(m) {
	let r = this.rect()
	m = m || 0
	return (
		   (r.x2 + m) >= 0
		&& (r.y2 + m) >= 0
		&& (r.x1 - m) <= window.innerWidth
		&& (r.y1 - m) <= window.innerHeight
	)
}

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

easing = obj() // from easing.lua

easing.reverse = (f, t, ...args) => 1 - f(1 - t, ...args)
easing.inout   = (f, t, ...args) => t < .5 ? .5 * f(t * 2, ...args) : .5 * (1 - f((1 - t) * 2, ...args)) + .5
easing.outin   = (f, t, ...args) => t < .5 ? .5 * (1 - f(1 - t * 2, ...args)) : .5 * (1 - (1 - f(1 - (1 - t) * 2, ...args))) + .5

// ease any interpolation function.
easing.ease = function(f, way, t, ...args) {
	f = or(easing[f], f)
	if (way == 'in')
		return f(t, ...args)
	else if (way == 'inout')
		return easing.inout(f, t, ...args)
	else if (way == 'outin')
		return easing.outin(f, t, ...args)
	else if (way == 'out')
		return easing.reverse(f, t, ...args)
	else
		assert(false)
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

function transition(f) {
	let raf_id, t0
	let dt, y0, y1, ease_f, ease_way, ease_args
	let e = {started: false}
	let start = noop
	let finish = noop
	e.on_start = function(f) {
		let f0 = start
		start = function() { f0(); f() }
	}
	e.on_finish = function(f) {
		let f0 = finish
		finish = function() { f0(); f() }
	}
	e.stop = function() {
		if (raf_id == null) return
		cancel_raf(raf_id)
		raf_id = null
		let t = performance.now()
		let lin_x = lerp(t, t0, t0 + dt * 1000, 0, 1)
		t0 = null
		e.started = false
		f(y1, lin_x, true)
		finish()
	}
	e.restart = function(dt_, y0_, y1_, ease_f_, ease_way_, ...ease_args_) {
		dt = dt_
		y0 = y0_
		y1 = y1_
		ease_f = ease_f_
		ease_way = or(ease_way_, 'out')
		ease_args = ease_args_
		dt = or(dt, 1)
		y0 = or(y0, 0)
		y1 = or(y1, 1)
		ease_f = or(ease_f, 'cubic')
		e.stop()
		raf_id = raf(wrapper)
		e.started = true
		start()
	}
	let wrapper = function(t) {
		t0 = or(t0, t)
		let lin_x = lerp(t, t0, t0 + dt * 1000, 0, 1)
		if (lin_x < 1) {
			let eas_x = easing.ease(ease_f, ease_way, lin_x, ...ease_args)
			let y = lerp(eas_x, 0, 1, y0, y1)
			if (f(y, lin_x) !== false)
				raf_id = raf(wrapper)
		} else {
			raf_id = null
			t0 = null
			e.started = false
			f(y1, lin_x, true)
			finish()
		}
	}
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

e.hit_test_sides = function(mx, my, d1, d2) {
	let r = this.rect()
	return hit_test_rect_sides(mx, my, or(d1, 5), or(d2, 5), r.x, r.y, r.w, r.h)
}

// canvas --------------------------------------------------------------------

method(CanvasRenderingContext2D, 'clear', function() {
	this.clearRect(0, 0, this.canvas.width, this.canvas.height)
})

method(CanvasRenderingContext2D, 'user_to_device', function(x, y, out) {
	let m = this.getTransform()
	out = out || []
	out[0] = m.a * x + m.c * y + m.e
	out[1] = m.b * x + m.d * y + m.f
	return out
})

method(CanvasRenderingContext2D, 'device_to_user', function(x, y, out) {
	let m = this.getTransform().inverse()
	out = out || []
	out[0] = m.a * x + m.c * y + m.e
	out[1] = m.b * x + m.d * y + m.f
	return out
})

// pw & ph are size multiples for lowering the number of resizes.
method(HTMLCanvasElement, 'resize', function(w, h, pw, ph) {
	pw = pw || 100
	ph = ph || 100
	let r = devicePixelRatio
	w = ceil(w / pw) * pw
	h = ceil(h / ph) * ph
	if (this.width  != w) { this.width  = w * r; this.w = w; }
	if (this.height != h) { this.height = h * r; this.h = h; }
})

// Create a div with a canvas inside. The canvas is resized automatically
// to fill the div when the div size changes. The div's redraw(cx, w, h)
// method is called on div's update and when the canvas is resized.
// Before each redraw call the canvas is cleared and the context is reset.
function resizeable_canvas(pw, ph) {
	let canvas = tag('canvas', {class: 'abs', width: 0, height: 0})
	let ct = div({class: 'S rel clip'}, canvas)
	ct.do_redraw = noop
	let cx = canvas.getContext('2d')
	let w0, h0
	let w, h
	ct.on_measure(function() {
		w0 = w || 0
		h0 = h || 0
		w = ct.cw
		h = ct.ch
	})
	let redraw_pass = null
	function redraw() {
		do {
			let pass = redraw_pass
			redraw_pass = null
			canvas.resize(w, h, pw, ph)
			cx.save()
			cx.clear()
			cx.scale(devicePixelRatio, devicePixelRatio)
			ct.do_redraw(cx, w, h, pass)
			cx.restore()
		} while (redraw_pass)
	}
	ct.redraw_again = function(pass) {
		redraw_pass = pass || true
	}
	ct.on_position(redraw)
	function update() {
		ct.update()
	}
	ct.on('resize', update)
	ct.listen('theme_changed', update)
	ct.on_redraw = function(f) {
		ct.do_after('do_redraw', f)
	}
	// Firefox loads fonts into canvas asynchronously, even though said fonts
	// are already loaded and were preloaded using <link preload>.
	// NOTE: this delay is only visible with the debugger on.
	ct.on_bind(function(on) {
		document.on('layout_changed', update, on)
		document.fonts.on('loadingdone', update, on)
	})
	ct.redraw_now = redraw
	ct.canvas = canvas
	ct.ctx = cx
	return ct
}

// modals & overlays ---------------------------------------------------------

// from css.js but we don't depend on that.
css('.overlay', '', `
	position: absolute;
	left: 0;
	top: 0;
	right: 0;
	bottom: 0;
`)

function overlay(attrs, content) {
	let e = div(attrs)
	e.class('overlay')
	e.set(content || div())
	return e
}

css_role('.modal-overlay', '', `
	position: fixed;
	background-color: rgba(0,0,0,0.2);
	display: grid;
	justify-content: center;
	align-content: center;
	z-index: 1;
`)

e.modal = function(on) {
	let e = this
	on = on != false
	if (!on && e.modal_overlay) {
		e.class('modal', false)
		e.modal_overlay.remove()
		e.modal_overlay = null
		document.body.disable(e, false)
	} else if (on && !e.overlay) {
		e.modal_overlay = overlay({class: 'modal-overlay'}, e)
		e.class('modal')
		document.body.disable(e, true)
		root.add(e.modal_overlay)
		e.modal_overlay.focus_first()
	}
	return e
}

// keep Tab navigation inside the app, modals & popups -----------------------

root.on('keydown', function(key, shift, ctrl, alt, ev) {
	if (key == 'Tab') {
		let modal = ev.target.closest('.modal') || this
		if (!modal)
			return
		let focusables = modal.focusables()
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

// lazy image loading --------------------------------------------------------

let lazy_load_all = function() {
	for (let e of $('img[data-src]'))
		e.position()
}
window.on('scroll', lazy_load_all)
window.on('resize', lazy_load_all)
on_dom_load(function() {
	document.body.on('scroll', lazy_load_all)
})

component('img[data-src]', function(e) {
	let is_in_viewport
	let updated
	e.on_measure(function() {
		if (updated) return
		is_in_viewport = this.is_in_viewport(300)
	})
	e.on_position(function() {
		if (updated) return
		if (!is_in_viewport) return
		let src = e.attr('data-src')
		e.attr('data-src', null)
		e.attr('src', src)
		updated = true
	})
})

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

let script = HTMLScriptElement.prototype
script.run = function(this_arg) {
	return (new Function('', this.text)).call(this_arg || this)
}

component('script[run]', function(e) {
	if (e.type && e.type != 'javascript')
		return
	if (e.src)
		return
	// calling with `e` as `this` allows `this.on_bind(...)` inside the script
	// and also attaching other elements to the script for lifetime control!
	// NOTE: `function foo() {}` declarations are local. Use `foo = function() {}`
	// to declare global functions.
	e.run()
})

// html-declared components --------------------------------------------------

css('component', '', `display: contents;`)

component('component', function(e) {

	let tag = e.attr('tag')
	let script = e.$1(':scope>script')

	if (warn_if(!tag, '<component> tag attr missing')) return
	if (warn_if(!script, '<component> <script> tag missing')) return

	script.remove()
	let cons = new Function('e', script.text)

	component(tag, cons)

	e.on_bind(function(on) {
		if (!on)
			component(tag, false)
	})

})

// not initializing components inside the template tag -----------------------

component('template', noop) // do not init child components.

/* "if" container for conditional element binding ----------------------------

attrs:
	global
props:
	e.global

*/

css('.if', '', `display: contents;`)

component('if', 'Containers', function(e) {

	let html_content = e.html
	e.clear()
	e.hide()

	e.prop('global', {attr: true})

	e.cond = function(v) {
		return !!v
	}

	e.do_update = function(opt) {
		if (opt.show) {
			e.unsafe_html = html_content
			document.fire('layout_changed')
		}
		e.show(!!opt.show)
	}

	function global_changed() {
		let k = e.global
		if (!k) return
		let on = e.cond(window[k])
		e.update({show: on})
	}

	function bind_global(k, on) {
		if (!k) return
		window.on(k+'_changed', global_changed, on)
	}

	e.set_global = function(k1, k0) {
		if (!e.bound) return
		bind_global(k0, false)
		bind_global(k1, true)
		global_changed()
	}

	e.on_bind(function(on) {
		bind_global(e.global, on)
		if (on) {
			global_changed()
		} else {
			e.hide()
			e.clear()
		}
	})

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

// hack to escape parents' `overflow: hidden` which works as long as
// none of them creates a stacking context, so watch out for that!
css_role('.popup', '', `
	position: fixed !important;
`)

e.popup = function(target, side, align) {

	let e = this
	if (e.hasclass('popup'))
		return

	e.ispopup = true
	e.class('popup')

	// view -------------------------------------------------------------------

	let er, tr, br, fixed, sx, sy, spx, spy

	e.on_measure(function() {
		if (e.hidden)
			return
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
		if (e.hidden)
			return

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
}

// live-move list elements ---------------------------------------------------

// implements:
//   e.move_element_start(move_i, move_n, i1, i2[, x1, x2, xoffset])
//   e.move_element_update(elem_x)
//   e.move_element_stop() -> over_id
// uses:
//   e.movable_element_size(elem_i) -> w
//   e.set_movable_element_pos(i, x, moving)
//
function live_move_mixin(e) {

	e = e || {}

	let move_i1, move_i2, i1, i2, i1x, i2x, offsetx
	let move_x, over_i, over_p, over_x
	let sizes = []
	let positions = []
	let initial_positions = []

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
		initial_positions.length = sizes.length
		let x = 0
		for (let i = i1; i < i2; i++) {
			let w = e.movable_element_size(i)
			sizes[i] = w
			initial_positions[i] = x
			x += w
		}
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
				e.set_movable_element_pos(i, offsetx + x, moving, initial_positions[i])
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
						e.set_movable_element_pos(i, offsetx + x, false, initial_positions[i])
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

// theming -------------------------------------------------------------------

// NOTE: dom.js is independent of any css, including css.js.
// These class names are the only references to css.js.

function is_theme_dark() {
	return root.hasclass('theme-dark')
}

function set_theme_dark(dark) {
	root.class('theme-dark' , !!dark)
	root.class('theme-light', !dark)
	announce('theme_changed')
	document.fire('layout_changed')
}

function get_theme_size() {
	return root.hasclass('theme-large') && 'large'
		|| root.hasclass('theme-small') && 'small'
		|| 'normal'
}

function set_theme_size(size) {
	size = repl(size, 'normal')
	root.class('theme-large theme-small', false)
	if (size)
		root.class('theme-'+size)
	announce('theme_changed')
	document.fire('layout_changed')
}

// make `.theme-inverted` work.
if (!is_theme_dark())
	root.class('theme-light')

function css_light(selector, ...args) {
	return css(':is(:root, .theme-light, .theme-dark .theme-inverted)'+selector, ...args)
}

function css_dark(selector, ...args) {
	return css(':is(.theme-dark, .theme-light .theme-inverted)'+selector, ...args)
}

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
				n += (sm[0] == '#' && 10 || sm[0] == '.' && 1 || sm[0] == ':' && sm[1] != ':' && 1 || .1)
			return next()
		}
		warn('invalid selector: '+s0, s)
	}
	return next()
}

function css_report_specificity(file, max_spec) {
	max_spec = max_spec || {base: 1.1, state: 2.1, _default: 1}
	let t0 = time()
	let n = 0
	function check_rule(rule, layer_name) {
		let sel = rule.selectorText
		if (!isstr(sel))
			return
		let spec = css_selector_specificity(sel)
		if (spec > max_spec[layer_name || '_default'])
			debug('CSS specificity', spec, sel)
		n++
	}
	function check_rules(rules, layer_name) {
		for (let rule of rules)
			if (rule instanceof CSSLayerBlockRule) // @layer block
				check_rules(rule.cssRules, rule.name)
			else
				check_rule(rule, layer_name)
	}
	for (let sheet of document.styleSheets) {
		if (file) // filtered
			if (isfunc(file)) { // layer
				if (sheet.ownerNode != file.style_node)
					continue
			} else { // file name
				if (!sheet.href)
					continue
				if (!sheet.href.ends(file))
					continue
			}
		check_rules(sheet.cssRules)
	}
	let file_name = isfunc(file) && '@'+file.layer_name || file
	warn_if(!n, 'CSS file empty', file_name)
	debug('CSS specificity checked for', file_name, n, 'rules in', floor((time() - t0) * 1000), 'ms')
}

on_dom_load(function() {
	if (!DEBUG_CSS_SPECIFICITY)
		return
	for (let layer of css_layers)
		css_report_specificity(css_layer(layer), {[layer] : 0.1})
})

} // module scope
