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
	load_css(file, [layer])

DOM LOAD

	on_dom_load(f); f()
	dom_loaded -> t|f

DEBUGGING

	e.debug(...)
	e.debug_if(cond, ...)
	e.debug_open_if(cond, ...)
	e.debug_close_if(cond, ...)
	e.trace(...)
	e.trace_if(cond, ...)
	e.debug_name
	e.debug_anon_name()

ELEMENT ATTRIBUTES

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
	e.classes = 'k1 k2 ...'

ELEMENT COMPUTED STYLES

	e.css(k[, state])
	e.css() -> css
	css.prop(k[, v])

CSS QUERYING

	fontawesome_char(name) -> s

DOM NAVIGATION INCLUDING TEXT NODES

	n.nodes -> nlist, n.nodes[i], n.nodes.len, n.parent
	n.first_node, n.last_node, n.next_node, n.prev_node

DOM NAVIGATION EXCLUDING TEXT NODES

	e.at[i], e.len, e.at.len, e.parent
	e.index
	e.first, e.last, e.next, e.prev
	e.all

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
	e.del() -> e
	e.replace([e0], te)
	e.move([pe], [i0])
	e.clear()
	diff_element_list([id|{id:,...}|e, ...], [e1, ...]) -> [e1, ...]
	e.make_items_prop([prop_name], [html_items])
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

DYNAMIC PROPERTIES

	e.set_prop(k, v)
	e.get_prop(k) -> v
	e.get_prop_attrs(k) -> {attr->val}
	e.get_props() -> {k->attrs}

FORWARD PROPERTIES

	e.forward_prop(name, forward_element, [attr], ['forward|backward|bidi'='forward'])

PROPERTY PERSISTENCE

	e.xoff()
	e.xon()
	e.xsave()
	e.serialize_prop(k) -> s
	e.serialize() -> s

DEFERRED DOM UPDATING

	e.update([opt])
	e.position()
	e.on_update(f)
	e.on_first_update(f)
	e.on_measure(f)
	e.on_position(f)

ELEMENT INIT

	component('TAG'|'TAG[ATTR]'[, category], initializer) -> create([props], ...children)
	component.extend(tag[, 'before|after'], initializer)
	e.prop_vals <- {prop->html_value}
	e.construct(tag, ...)
	e.init_component()
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

EXTERNAL EVENTS

	target.on(event, e, f, [on], [capture])
	e.listener() -> ls

MOUSE EVENTS

	^hover              (ev, on, mx, my)
	^[right]click       (ev, nclicks, mx, my)
	^[right]pointerdown (ev, mx, my)
	^[right]pointerup   (ev, mx, my)
	^pointermove        (ev, mx, my)
	^wheel              (ev, dy, is_trackpad, mx, my)
	this.capture_pointer(ev, [on_pointermove], [on_pointerup])
		^on_pointermove (ev, mx, my, mx0, my0)
		^on_pointerup   (ev, mx, my, mx0, my0)
	force_cursor(cursor|false)

KEYBOARD EVENTS

	^keydown            (key, shift, ctrl, alt, ev)
	^keyup              (key, shift, ctrl, alt, ev)
	^keypress           (key, shift, ctrl, alt, ev)
	^document.stopped_event(stopped_ev, ev)

ELEMENT CLIPBOARD & CLIPBOARD EVENTS

	copied_elements: set(element)

	^cut   (ev)
	^copy  (ev)
	^paste (ev)

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

	e.hide([on], [ev])
	e.show([on], [ev])
	e.on_show(f); f(on, ev)
	e.hovered
	e.focused_element
	e.focused
	e.has_focus
	e.focus_visible
	e.has_focus_visible
	e.focusables()
	e.effectively_disabled
	e.effectively_hidden
	e.focus_first() -> found
	e.make_disablable()
		e.disabled
		e.disable(reason, disabled)
	e.make_focus_ring([focusable_element1, ...])
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
	e.trim_inner_html()

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
	resizeable_canvas_container() -> ct; ct.ctx, ct.canvas, ct.on_redraw(f)
	is2dcx(cx) -> t|f

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

	e.make_popup([side], [align]) make element a popup.
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
	^^layout_changed([what])

CSS SPECIFICITY REPORTING

	css_report_specificity(file, max_spec)

*/

(function () {
"use strict"
let G = window
let e = Element.prototype

// debugging -----------------------------------------------------------------

DEBUG('DEBUG_INIT')
DEBUG('DEBUG_BIND')
DEBUG('DEBUG_ELEMENT_BIND')
DEBUG('PROFILE_BIND_TIME', true)
DEBUG('SLOW_BIND_TIME_MS', 10)
DEBUG('DEBUG_UPDATE')
DEBUG('DEBUG_CSS_USAGE')
DEBUG('DEBUG_CSS_SPECIFICITY')

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

function update_dom_loaded() {
	G.dom_loaded = document.readyState === 'interactive'
}
update_dom_loaded()
document.on('DOMContentLoaded', update_dom_loaded)

G.on_dom_load = function(fn) {
	if (dom_loaded)
		fn()
	else
		document.on('DOMContentLoaded', fn)
}

// CSS-in-JS -----------------------------------------------------------------

// Why this instead of pure CSS? First, all selectors get specificity 0 which
// effectively disables this genius CSS feature so rules are applied in source
// order in layers (what @layer and :where() would do in a CSS). Layers let
// you restyle elements without accidentally muting role/state-modifier styles.
// Second, you get composable CSS without silly offline preprocessors.
// Now you can style with utility classes inside arbitrary CSS selectors
// including those with :hover and :focus-visible, and you can use fontawesome
// icons by name inside ::before rules. Third, because you get to put widget
// styles near the widget code that they're coupled to. Fourth, because now
// you get warnings when mistyping utility class names, which also facilitates
// refactoring the utility classes. Fifth, because you get to solve all these
// old problems with two pages of JS. The cost is 1-3 frames at startup for
// a site with some 3000 rules (most of which come from fontawesome).

// NOTE: Only rules of form `.class` and `.class::pseudo` are reusable.
// Rules of form `.class::pseudo` must be used as if they were `.class`!

// NOTE: Conflicting classes behave differently when used as includes in
// css() declarations and when used directly in the class attr of an element.
// When used as includes, include order applies. When used in the class attr,
// source order applies.

let include_props = obj() // {include->props} from all layers.
let include_includes = obj() // {include->[include1,...]}
let include_pseudos = obj() // {include->

// Safari only added CSS layers in 15.4.
// Our layers already work without `@layer` blocks but we generate them
// anyway if supported to make it easier to integrate with external CSS.
let supports_css_layers = window.CSSLayerBlockRule
function is_css_layer(rule) {
	return supports_css_layers && rule instanceof CSSLayerBlockRule
}

let utils_usage = obj()

G.css_layers = []

G.css_layer = memoize(function(layer) {

	let pieces = supports_css_layers ? ['@layer '+layer+' {\n'] : []
	let style = document.createElement('style')
	style.setAttribute('x-layer', layer) // for debugging.
	style.css_in_js_layer = true // we map classes ourselves.
		document.head.append(style)
		css_layers.push(layer)

	on_dom_load(function() {
		load_css_files()
		if (supports_css_layers)
			pieces.push('\n} /*layer*/')
		let final_pieces = []
		for (let piece of pieces)
			if (isfunc(piece)) // expand includes
				piece(final_pieces)
			else
				final_pieces.push(piece)
		style.textContent = final_pieces.join('')
	})

	function add_includes(err, includes, pieces) {
		for (let inc of includes) {
			let props = include_props[inc]
			if (props == null) {
				warn('css unknown include', inc, 'at',
					err.stack.captures(/\s+at\s+[^\r\n]+\r?\n+\s+at ([^\n]+)/)[0])
				continue
			}
			let inc_includes = include_includes[inc]
			if (inc_includes) {
				add_includes(err, inc_includes, pieces)
			}
			pieces.push('\n\t', props)
			utils_usage[inc] = (utils_usage[inc] || 0)+1
		}
	}

	function add_include_pseudos(err, prefix, suffix, includes, pieces) {
		/*
		// TODO: finish this
		for (let inc of includes) {
			let props = include_props[inc]
			if (props == null) {
				warn('css unknown class', inc, 'at',
					err.stack.captures(/\s+at\s+[^\r\n]+\r?\n+\s+at ([^\n]+)/)[0])
				continue
			}
			let inc_includes = include_includes[inc]
			if (inc_includes) {
				add_includes(err, inc_includes, pieces)
			}
			if (suffix) {
				warn('css pseudo include on pseudo rule', inc, 'at',
					err.stack.captures(/\s+at\s+[^\r\n]+\r?\n+\s+at ([^\n]+)/)[0])
				continue
			}
			pieces.push('\n:where(', prefix, ')', pseudo, ' {')
			pieces.push('\n\t', props)
			utils_usage[inc] = (utils_usage[inc] || 0)+1
		}
		*/
	}

	// NOTE: this is a dumb parser: start all your CSS rules on a newline!

	let css_re = /[\r\n]([#:\.a-zA-Z][\s\S#:\.a-zA-Z>+~\-]*?){([^}]+?)}/g

	function add_rules(err, css) {
		css = css.replaceAll(/\/\*.*?\*\//gs, '')
		if (!css.includes('{')) {
			warn('css invalid verbatim rule', selector, 'at',
				err.stack.captures(/\s+at\s+[^\r\n]+\r?\n+\s+at ([^\r\n]+)/)[0])
			return
		}
		function fix_rule(s, sel, props) {
			add_rule(err, sel, '', props)
			return ''
		}
		css = css.replaceAll(css_re, fix_rule)
		pieces.push(css)
	}

	function add_rule(err, selector, includes_arg, props) {
		let includes = words(repl(includes_arg, '', null))
		if (includes && !includes.length)
			includes = null
		if (isarray(selector)) {
			for (let sel of selector)
				add_rule(err, sel, includes, props)
			return
		}
		// ::pseudos need to be outside :where(), so we must split the selector.
		selector = selector.trim()
		let m = selector.match(/^(.*?)(::[a-zA-Z\-]+)$/)
		let prefix, suffix
		if (m) {
			prefix = m[1]
			suffix = m[2]
			warn_if(prefix.includes('::'), 'bad selector', selector)
		} else {
			prefix = selector
			suffix = ''
		}
		if (prefix) pieces.push('\n:where(', prefix, ')')
		if (suffix) pieces.push(suffix)
		pieces.push(' {')
		if (includes)
			pieces.push(function(dest_pieces) {
				add_includes(err, includes, dest_pieces)
			})
		props = props && props.trim()
		if (props)
			pieces.push('\n\t', props)
		pieces.push('\n}\n')
		// some includes can be rules with :: which we must add as separate rules.
		if (includes)
			pieces.push(function(dest_pieces) {
				add_include_pseudos(err, prefix, suffix, includes, dest_pieces, e)
			})
		let inc = prefix.captures(/^\.([^ >#:\.+~]+)$/)[0] // reusable class?
		if (inc) {
			include_props[inc] = catany('\n\t', include_props[inc], props) || ''
			if (includes)
				attr(include_includes, inc, array).extend(includes)
		}
	}

	function add(selector, includes, props) {
		let err = new Error() // for stack trace
		if (includes == null && props == null)
			add_rules(err, selector) // verbatim CSS, needs parsed.
		else
			add_rule(err, selector, includes, props)
	}

	add.layer_name = layer
	add.style_node = style

	return add
})

for (let layer of 'base util state role role_state generic_state'.words()) {
	window['css_'+layer] = css_layer(layer.replace('_', '-'))
	window['css_'+layer+'_chrome' ] = Chrome  ? window['css_'+layer] : noop
	window['css_'+layer+'_firefox'] = Firefox ? window['css_'+layer] : noop
}
G.css         = css_base
G.css_chrome  = css_base_chrome
G.css_firefox = css_base_firefox

G.load_css = function(url, layer) {
	get(url, function(s) {
		css_layer(layer || 'base')(s)
	}, null, {
		async: false,
		silent: true,
		// hack for Firefox otherwise it loads it as XML and gives a parse error.
		response_mime_type: 'application/octet-stream',
	})
}

let load_css_files = memoize(function() {
	for (let e of $('style[src]')) {
		let t0 = time()
		let src = e.attr('src')
		let layer = e.attr('layer')
		if (load_css(src, layer)) {
			let t1 = time()
			debug(src, 'loaded in', floor((t1 - t0) * 1000), 'ms')
		}
	}
})

// css.js usage ranking ------------------------------------------------------

G.css_rank_utils_usage = function() {
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

// NOTE: a bool attr has 3 possible values: `true`, `false` and `null`,
// corresponding to html '', 'false', and missing attr.
e.bool_attr = function(k, v) {
	if (arguments.length < 2)
		return bool_attr(this.getAttribute(k))
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
	if (arguments.length < 2) {
		let v = repl(this.getPropertyValue(k), '', null)
		warn_if(v == null, 'css property not set', k)
		return v
	} else {
		this.setProperty(k, v)
	}
})

// use this to to draw fontawesome icons on a canvas.
G.fontawesome_char = memoize(function(icon) {
	let s = include_props[icon].captures(/content\s*:\s*"\\([^"]+)";/)[0]
	let cp = parseInt(s, 16)
	return String.fromCodePoint(cp)
})

// DOM navigation for elements, skipping over text nodes ---------------------

alias(Element, 'at'     , 'children')
alias(Element, 'len'    , 'childElementCount')
alias(Element, 'first'  , 'firstElementChild')
alias(Element, 'last'   , 'lastElementChild')
alias(Element, 'next'   , 'nextElementSibling')
alias(Element, 'prev'   , 'previousElementSibling')

property(e, 'all', function*() {
	for (let ce of this.at) {
		yield ce
		yield* ce.all
	}
})

// DOM navigation for nodes --------------------------------------------------
// also faster for elements when you know that you don't have text nodes.

alias(Node, 'parent'     , 'parentNode')
alias(Node, 'nodes'      , 'childNodes')
alias(Node, 'first_node' , 'firstChild')
alias(Node, 'last_node'  , 'lastChild')
alias(Node, 'next_node'  , 'nextSibling')
alias(Node, 'prev_node'  , 'previousSibling')

alias(NodeList, 'len', 'length')
alias(HTMLCollection, 'len', 'length')

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

G.iselem = function(e) { return e instanceof Element }
G.isnode = function(e) { return e instanceof Node }

// NOTE: spec says the search is depth-first and we use that.
alias(Element         , '$', 'querySelectorAll')
alias(DocumentFragment, '$', 'querySelectorAll')
G.$ = function(s) { return document.querySelectorAll(s) }

alias(Element         , '$1', 'querySelector')
alias(DocumentFragment, '$1', 'querySelector')
G.$1 = function(s) { return typeof s == 'string' ? document.querySelector(s) : s }

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

G.component = function(selector, category, init) {
	if (isfunc(category)) { // shift arg
		init = category
		category = 'Other'
	}
	let m = selector.match(/^(.+?)\[(.+?)\]$/) // TAG[ATTR]
	let tag = m && m[1] || selector
	let tag_attr = m && m[2]
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
	attr(component.categories, category, array).push(create)
	return create
}

e.construct = function(tag, ...args) {
	component_init[tag.upper()](this, ...args)
}

component.extend = function(tag, where, init) {
	if (!init) { init = where; where = 'after'; } // shift arg#2
	let tagName = tag.upper()
	let init0 = assert(component_init[tagName], 'component not registered: {0}', tag)
	let combine = where == 'before' && do_before || where == 'after' && do_after
	component_init[tagName] = combine(init0, init)
}

component.categories = obj() // {cat->{create1,...}}

component.init_instance = function(e, prop_vals) { // stub, see xmodule.js.
	e.xoff()
	for (let k in prop_vals)
		e.set_prop(k, prop_vals[k])
	e.xon()
}

component.instance_tag = noop // stub, see xmodule.js.

// NOTE: e.property() props can't be set from html. Make them e.prop() with
// a type if you want them to be settable from html attrs!
let attr_prop_vals = function(e) {
	let prop_vals = obj()
	let pmap = e.attr_prop_map
	for (let attr of e.attributes) {
		let k = attr.name
		let v = attr.value
		if (!k.starts('on_')) { // not an event listener
			k = pmap && pmap[k] || k
			let pa = e.get_prop_attrs(k)
			if (!pa) // not a prop
				continue
			if (k in prop_vals)
				warn('duplicate attr', attr.name)
			v = pa.from_attr(v)
		}
		prop_vals[k] = v
	}
	return prop_vals
}

let global_caller = function(fname) {
	return function(...args) {
		let f = window[fname]
		if (!f) return
		f.call(this, ...args)
	}
}

e.init_component = function(prop_vals) {

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

	// initial prop values come from multiple sources, in priority order:
	// 1. prop values passed to element().
	// 2. init values set by the constructor from interpreting the inner html.
	// 3. html attributes that match prop names.
	e.prop_vals = obj()
	init(e)
	e.prop_vals = assign_opt(attr_prop_vals(e), e.prop_vals, prop_vals)

	// register events from `on_EVENT` props.
	for (let k in e.prop_vals) {
		if (k.starts('on_')) {
			let f = e.prop_vals[k]
			delete e.prop_vals[k]
			k = k.slice(3)
			if (isstr(f)) // set from html: name of global function.
				f = global_caller(f)
			e.on(k, f)
		}
	}

	// set props to their initial values.
	e.initialized = false // let prop setters know that we're not fully initialized.
	component.init_instance(e, e.prop_vals)
	e.initialized = true

	// call the after-all-properties-are-set init function.
	if (e._user_init)
		e._user_init()

	// NOTE: id must be given when the component is created, not set later!
	if (e.id) {
		e.on('attr_changed', function(k, v, v0) {
			if (k == 'id')
				announce('id_changed', e, v, v0)
		})
		announce('init', e)
		announce(e.id+'.init', e)
	}

	e.debug_close_if(DEBUG_INIT)
}

// the component is responsible for calling init_child_components()
// in its initializer if it knows it can have components as children.
e.init_child_components = function() {
	if (this.len)
		for (let ce of this.children)
			ce.init_component()
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
		if (on) {
			e.debug_open_if(DEBUG_BIND, '+')
			let t0 = PROFILE_BIND_TIME && time()
			if (e._user_bind)
				e._user_bind(true)
			if (e.id) {
				announce('bind', e, true)
				announce(e.id+'.bind', e, true)
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
				announce('bind', e, false)
				announce(e.id+'.bind', e, false)
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

G.root = document.documentElement

G.init_components = function() {
	G.body = document.body // for debugging, don't use in code.
	G.head = document.head // for debugging, don't use in code.
	if (DEBUG_INIT)
		debug('ROOT INIT ---------------------------------')
	root.init_component()
	if (DEBUG_BIND)
		debug('ROOT BIND ---------------------------------')
	root._bind(true)
	if (DEBUG_BIND)
		debug('ROOT BIND DONE ----------------------------')
}

// element events into external objects --------------------------------------

e.listener = function() {
	let ls = listener()
	function bind(on) {
		ls.enabled = on
	}
	this.on_bind(on)
	ls.set_prop = function(k, v) { ls[k] = v }
	if (this.bound)
		bind()
	return ls
}

// element global events -----------------------------------------------------

// listen to a global event *while the element is bound*.
e.listen = function(event, f) {
	let handlers = obj() // event->f
	this.listen = function(event, f) {
		handlers[event] = do_after(handlers[event], f)
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
	return announce(event, this, ...args)
}

// DOM manipulation API ------------------------------------------------------

// create a text node from a stringable. calls a constructor first.
// wraps the node in a span if wrapping control is specified.
// elements, nulls and arrays pass-through regardless of wrapping control.
// TODO: remove this!
G.T = function(s, whitespace) {
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
G.TC = function(s, whitespace) {
	if (typeof s == 'function')
		s = s()
	if (isnode(s))
		s = s.clone()
	return T(s, whitespace)
}

// create a html element or text node from a html string.
// if the string contains more than one node, return an array of nodes.
G.unsafe_html = function(s, unwrap) {
	if (typeof s != 'string') // pass-through: nulls, elements, etc.
		return s
	let span = document.createElement('span')
	span.unsafe_html = s.trim()
	span.init_component()
	let n = span.childNodes.length
	if (unwrap == false && (n > 1 || !span.len)) // not a single element
		return span
	return n > 1 ? [...span.nodes] : span.firstChild
}

let sanitize_html = function(s) {
	if (typeof s != 'string') // pass-through: nulls, elements, etc.
		return s
	assert(DOMPurify.isSupported)
	return DOMPurify.sanitize(s)
}

G.html = function(s, unwrap) {
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
	e.init_component(prop_vals)
	return e
}

// element(node | stringable | null | {id|tag:, PROP->VAL}, [attrs], [e1,...]) -> node | null
G.element = function(t, attrs, ...children) {
	if (isfunc(t)) // constructor
		t = t()
	if (t == null || isnode(t)) // node | null | undefined: pass through
		return t
	if (isobj(t)) { // {id|tag:, PROP->VAL}: create element
		let id = t.id
		let e0 = window[id]
		if (e0)
			return e0 // already created (called from a prop's `parse()`).
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
G.tag = function(tag, attrs, ...children) {
	return create_element(tag, null, attrs, ...children)
}

G.div  = (...a) => tag('div' , ...a)
G.span = (...a) => tag('span', ...a)

G.svg_tag = function(tag, attrs, ...children) {
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

G.svg = function(...args) { return svg_tag('svg', ...args) }

G.svg_arc_path = function(x, y, r, a1, a2, start_cmd) {
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
					node.del()
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
	i0 = max(0, min(i0 ?? 1/0, this.nodes.length))
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

e.del = function E_del() {
	this._bind(false)
	this.remove()
	return this
}

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
			e0.del()
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
// for removal by setting the `_removed` flag. if t and cur_elems have the same
// contents, cur_elems is returned.
{
let cur_set = set()
let cur_by_id = map()
G.diff_element_list = function(t, cur_elems) {
	t = words(t) ?? empty_array
	if (t.equals(cur_elems))
		return cur_elems
	// map current items by identity and by id.
	cur_set.clear()
	cur_by_id.clear()
	for (let item of cur_elems) {
		cur_set.add(item)
		if (item.id)
			cur_by_id.set(item.id, item)
		item._removed = true
	}
	// create new items or reuse existing ones as needed.
	let items = []
	for (let v of t) {
		// v is either an item from cur_elems, an id, or the prop_vals of a new item.
		let cur_item = cur_set.has(v) ? v : cur_by_id.get(isstr(v) ? v : v.id)
		let item = cur_item || element(isstr(v) ? {id: v} : v)
		items.push(item)
		item._removed = false
	}
	return items
}
}

/* items property that is a list of elements mixin ---------------------------

publishes:
  e.items
when items are set, it sets:
	item._removed
calls:
  e.update({items: trues})

*/

e.make_items_prop = function(ITEMS, html_items) {

	let e = this
	ITEMS = ITEMS || 'items'

	function serialize(items) {
		let t = []
		for (let item of items)
			t.push(item.serialize())
		return t
	}

	e.prop(ITEMS, {type: 'array', element_type: 'node',
			serialize: serialize, parse: diff_element_list,
			default: empty_array, updates: ITEMS})

	if (e.len) {
		e.init_child_components()
		if (!html_items) {
			html_items = [...e.children]
			e.clear()
		}
	}

	e.prop_vals.items = html_items

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
	this[method] = wrap(this[method], func)
}

e.do_before = function(method, func) {
	this[method] = do_before(this[method], func)
}

e.do_after = function(method, func) {
	this[method] = do_after(this[method], func)
}

/* component virtual properties ----------------------------------------------

publishes:
	e.property(PROP, get, [set])
	e.prop(PROP, attrs)
	e.PROP
	e.props: {PROP->prop_attrs}
		store: false          value is read by calling `e.get_PROP()`.
		private               window is not notifed of prop value changes.
		default               default value.
		parse(v, v0) -> v     convert value when setting the property.
		updates: 'opt1 ...'   options to pass to update() when the prop value changes
		type                  for html attr val conversion and for object inspector.
		attr: NAME            value is read from html attr named NAME instead of PROP.
		to_attr: true         value is also written to html attr when changed.
		to_attr: f(v) -> s    formatter for the html attr value.
		from_attr: f(s) -> v  parser for the html attr value.
		serialize: f()
		bind_id               the prop represents an element id to dynamically link to.
calls:
	e.get_<prop>() -> v
	e.set_<prop>(v1, v0)
hooks:
	e.on_prop_changed(f); f(prop, v, v0, ev)
fires:
	^^prop_changed(e, prop, v1, v0, ev)
	^^id_changed(e, id, id0)

NOTE: With `store: false` you're responsible for calling e.prop_changed()
when the value changes by other means than by assigning to the property!

*/

e.property = function(name, get, set) {
	return property(this, name, get, set)
}

e.prop_changed = function(prop, v1, v0, ev) {
	if (this._xoff) {
		this.props[prop].default = v1
	} else {
		this.announce('prop_changed', prop, v1, v0, ev)
	}
}
e.on_prop_changed = function(f) {
	this.do_after('prop_changed', f)
}

let set_attr_func = function(e, k, opt) {
	let to_attr = opt.to_attr
	if (!to_attr)
		return
	if (isfunc(to_attr))
		return v => e.attr(k, to_attr(v))
	if (opt.type == 'bool')
		return v => e.bool_attr(k, v || null)
	return v => e.attr(k, v)
}

e.prop = function(prop, opt) {
	let e = this
	opt = opt || obj()
	assign_opt(opt, e.props && e.props[prop])
	let GET = 'get_'+prop
	let SET = 'set_'+prop
	opt.name = prop
	let parse = opt.parse
		|| opt.type == 'bool'   && bool
		|| opt.type == 'number' && num
	let priv = opt.private
	if (!e[SET])
		e[SET] = noop
	let dv = 'default' in opt ? opt.default : null
	let update_opt = opt.updates && words(opt.updates).tokeys() || null

	opt.from_attr = opt.from_attr || opt.type == 'bool' && bool_attr || return_arg
	let prop_attr = isstr(opt.attr) ? opt.attr : prop
	let set_attr = set_attr_func(e, prop_attr, opt)
	if (prop_attr != prop)
		attr(e, 'attr_prop_map')[prop_attr] = prop
	if (prop_attr.includes('_')) // allow foo-bar in addition to foo_bar
		attr(e, 'attr_prop_map')[prop_attr.replace('_', '-')] = prop

	let get, set
	if (opt.store != false) { // stored prop
		let v = dv
		get = function() {
			return v
		}
		set = function(v1, ev) {
			let v0 = v
			if (parse)
				v1 = parse(v1, v0)
			if (v1 === v0)
				return
			v = v1
			e[SET](v1, v0, ev)
			if (set_attr)
				set_attr(v1)
			if (!priv)
				e.prop_changed(prop, v1, v0, ev)
			e.update(update_opt)
		}
		if (dv != null && set_attr && !e.hasattr(prop_attr))
			set_attr(dv)
	} else { // virtual prop with getter
		assert(!('default' in opt))
		get = function() {
			return e[GET]()
		}
		set = function(v, ev) {
			let v0 = e[GET]()
			if (parse)
				v = parse(v, v0)
			if (v === v0)
				return
			e[SET](v, v0, ev)
			if (!priv)
				e.prop_changed(prop, v, v0, ev)
			e.update(update_opt)
		}
	}

	// id-based dynamic binding of external elements to a prop.
	if (opt.bind_id || opt.on_bind) {
		assert(!priv)
		assert(!e.bound)
		let ID = prop
		let DEBUG_ID = DEBUG_ELEMENT_BIND && '['+ID+']'
		let REF = opt.bind_id || ID+'_ref'
		let on_bind = opt.on_bind
		let id = null
		function te_bind(te, on) {
			assert(on == !e[REF])
			e[REF] = on ? te : null
			if (on_bind)
				on_bind.call(e, te, on)
			if (DEBUG_ELEMENT_BIND)
				e.debug(on ? '==' : '=/=', DEBUG_ID, te.id)
		}
		let bound = false
		function bind_id(on) {
			if (on == bound)
				return
			if (!id)
				return
			listen(id+'.bind', te_bind, on)
			if (on) {
				let te = window[id]
				if (te && te.bound)
					te_bind(te, true)
			} else {
				let te = e[REF]
				if (te)
					te_bind(te, false)
			}
			bound = on
		}
		e.listen('id_changed', function(te, id1, id0) {
			if (id != id0) return // not our id
			e[ID] = id1
		})
		e.on_prop_changed(function(k, id1, id0, ev) {
			if (k != ID) return
			bind_id(false)
			id = id1
			bind_id(true)
		})
		e.on_bind(bind_id)
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

/* dynamic properties --------------------------------------------------------

Rationale: object properties in JS cannot be dynamic unless you use a proxy.
But we need dynamic props to store props of grid column (which are dynamic)
in xmodule. So use e.get_prop(k) instead of e[k] every time when dealing with
an unknwon k that might be a dynamic prop.

*/

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

// forward properties --------------------------------------------------------

e.forward_prop = function(k, fe, fk, attr, dir) {
	let e = this
	dir = dir || 'forward'
	fk = fk || k
	if (!e.props[k]) {
		let pa_fw = fe.get_prop_attrs(fk)
		if (!pa_fw) {
			let pd = fe.getPropertyDescriptor(fk)
			if (!pd)
				assert(false, 'forward_prop: property {0} not found in {1}', fk, fe.debug_name)
		}
		let pa = assign(obj(), pa_fw)
		pa.store = true
		if (attr != null)
			pa.attr = attr
		e.prop(k, pa)
	}
	if (dir == 'bidi') { // bidirectional
		e.do_after('set_'+k, function(v, v0, ev) {
			if (ev && ev.forwarded_from == fe)
				return
			fe.set_prop(fk, v, ev)
		})
		fe.on_prop_changed(function(k1, v, v0, ev) {
			if (k1 != fk)
				return
			ev = ev || obj()
			ev.forwarded_from = fe
			e.set_prop(k, v, ev)
		})
	} else if (dir == 'forward') {
		e.do_after('set_'+k, function(v, v0, ev) {
			fe.set_prop(fk, v, ev)
		})
	} else if (dir == 'backward') {
		fe.on_prop_changed(function(k1, v, v0, ev) {
			if (k1 != fk)
				return
			e.set_prop(k, v, ev)
		})
	} else {
		assert(false)
	}
}

// prop & element serialization & saving -------------------------------------

e.serialize_prop = function(k, v) {
	let pa = this.get_prop_attrs(k)
	if (pa && pa.serialize)
		v = pa.serialize(v)
	else if (isobject(v) && v.serialize)
		v = v.serialize()
	return v
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

e.xoff = function() { this._xoff = true  }
e.xon  = function() { this._xoff = false }

e.xsave = function() {
	let xm = window.xmodule
	if (xm)
		xm.save()
}

/* mixing for adding disabled state to any element ---------------------------

publishes:
	e.disabled
	e.disable(reason, disabled)

disable(reason) allows multiple independent external actors to disable an element
each for its own reason and the element will stay disabled as long as there's
at least one reason for it to be disabled.

NOTE: The `disabled` state is a concerted effort located in multiple places:
- pointer events are blocked by `pointer-events: none`, but they're also
  blocked in the pointer event wrappers in case you need `pointer-events: all`
  on a disabled element (raw events still work in that case).
- forcing the default cursor on the element and its children is done with css.
- showing the element with reduced opacity is done with css.
- keyboard focusing is disabled in make_focusable().

NOTE: Don't put disablables on top of other elements (eg. popups can't be
disablable), because you will be clicking *through* them (by virtue of
`pointer-events: none`). If you set .click-through-off on a disablable,
pointer events will still get blocked, but `:hover` and `:active` will start
working again, so you'll need to add `:not([disabled])` on your state styles.
You can't win on the web.

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

e.make_disablable = function(de) {

	let e = this
	de = de || e
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
		return de.hasattr('disabled')
	}
	function set_disabled(disabled) {
		disabled = !!disabled
		let disabled0 = de.hasattr('disabled')
		if (disabled0 == disabled)
			return
		de.bool_attr('disabled', disabled || null)
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

A focusable is an element with a tabindex (or with a child or more with a tabindex)
that has changeable focusable state and becomes unfocusable when it's disabled.
It can also be made to show a focus ring on behalf of its inside focusables.

publishes:
	e.tabindex
	e.focusable
	e.remember_last_focused
sets css classes:
	focusable

*/

// NOTE: uses CSS classes `.outline-focus` and `.no-outline` that are
// not defined here, define them yourself or load css.js which has them.

// move the focus ring from focused element to the outermost element with `.focus-ring`.
css_role_state('.focus-ring:has(.focus-outside:focus-visible)', 'outline-focus') // outermost
css_role_state('.focus-ring .focus-ring:has(.focus-outside:focus-visible)', 'no-outline') // not outermost
css_role_state('.focus-outside:focus-visible', 'no-outline')

// Firefox doesn't have :has() yet. Luckily for us, most of our widgets that
// use .focus-ring have input elements with .focus-outside, and for input elements
// :focus-within is the same as :has(:focus-visible).
css_role_state_firefox('.focus-ring:focus-within', 'outline-focus')

// Popups are DOM-wise "inside" their parent, but visually they're near it,
// so the whole outer focus ring thing doesn't apply across popup boundaries.
css_role_state('.not-within:has(.focus-outside:focus-visible)', 'outline-focus')
css_role_state('.focus-ring:has(.not-within .focus-outside:focus-visible)', 'no-outline')

e.make_focus_ring = function(...fes) {
	this.class('focus-ring')
	for (let fe of fes)
		fe.class('focus-outside')
}

e.make_focusable = function(...fes) {

	let e = this
	e.make_focusable = noop

	if (!fes.len)
		fes.push(e)

	for (let fe of fes)
		if (!fe.hasattr('tabindex'))
			fe.attr('tabindex', 0)

	function update() {
		let can_be_focused = e.focusable && !e.disabled
		e.class('focusable', can_be_focused)
		for (let fe of fes)
			fe.attr('tabindex', can_be_focused ? e.tabindex : -1)
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
		if (fes[0] == this)
			return inh_focus.call(this)
		let fe = e.remember_last_focused && last_focused || fes[0]
		fe.focus()
	}

}

G.focused_focusable = function(e) {
	e = e || document.activeElement
	return e && e.focusable && e || (e.parent && e.parent != e && focused_focusable(e.parent))
}

G.unfocus = function() {
	if (document.activeElement)
		document.activeElement.blur()
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
widgets in any way. do_update() also calls position(), which asks to
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
		e.do_measure(e._update_opt)
		e.debug_if(DEBUG_UPDATE, 'P')
		e.do_position(e._update_opt)
		position_set.delete(e)
	}
}

let update_all = function() {

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
		e.do_measure(e._update_opt)
	}
	for (let e of position_set) {
		e.debug_if(DEBUG_UPDATE, 'P')
		e.do_position(e._update_opt)
	}

	for (let e of update_set)
		e._update_opt = null

	update_set.clear()
	position_set.clear()

	updating = false
}

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
	update_set.delete(this)
	position_set.delete(this)
}

e.on_update = function(f) {
	this._bound = this.bound || false
	this.do_after('do_update', f)
}

e.on_first_update = function(f) {
	this.on_update(function(opt) {
		if (this._updated_once) return
		this._updated_once = true
		f(opt)
	})
}

e._do_update = function() {
	let opt = this._update_opt
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

// events & event wrappers ---------------------------------------------------

let installers = event_installers
let callers = event_callers

// resize event --------------------------------------------------------------

let resize_observer = new ResizeObserver(function(entries) {
	for (let entry of entries)
		if (entry.target.bound) // sometimes it comes in late
			entry.target.fire('resize', entry.contentRect, entry)
})
installers.resize = function() {
	if (this == window)
		return // built-in.
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
	return ret
}

// NOTE: capturing the mouse on ^pointerdown inhibits ^click and ^dblclick on the children.
// To fix, listen for ^click / ^dblclick on the parent and use document.elementFromPoint()
// to identify the target child that was actually clicked.
method(EventTarget, 'capture_pointer', function(ev, move, up) {

	this.setPointerCapture(ev.pointerId)
	if (warn_if(!this.hasPointerCapture(ev.pointerId), 'setPointerCapture failed'))
		return
	this.pointer_captured = true

	move = move ?? noop
	up   = up   ?? noop
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

	// return false so you can call `return this.pointer_capture(ev, ...)`
	// inside a ^pointerdown handler if you want to inhibit further action.
	return false
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
G.force_cursor = function(cursor) {
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
- as a source, listen on ^start_drag, ^dragging, ^stop_drag.
  call start(payload, payload_rect) inside ^start_drag to start the drag.
- as a dest, listen on ^^drag_started, ^^drag_stopped, ^dropping, ^drop,
  and possibly ^accept_drop. call add_drop_area(elem, drop_area_rect)
  inside ^^drag_started to register drop areas.
- return false from ^allow_drag until ready to drag to prevent premature pointer capturing.
LONG(ER) VERSION:
- listen on ^start_drag(pointermove_ev, start, mx, my, pointerdown_ev, mx0, my0)
  which is called on ^pointerdown and on ^pointermove.
- inside ^start_drag, call start([payload[, payload_rect]]) to start dragging
  a payload (defaults to this). the payload can have a rect in abs. coords
  (defaults to a zero-sized rect at cursor position).
- ^^drag_started(payload, add_drop_area, source_elem) is then announced so that potential
  acceptors can announce their drop area rect(s) by calling add_drop_area(elem, drop_area_rect).
- while the mouse moves, hit elements get ^accept_drop(pointermove_ev, payload, payload_rect, source_elem)
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
- ^allow_drag(ev, mx, my, down_mx, down_my) is called before pointer is captured
  in order to allow default behavior that would otherwise be inhibited by pointer
  capturing (eg. clicking on a child).

NOTE: this implementation is more complicated and less correct than it could be
bacause we don't want to start capturing the mouse on ^pointerdown because that
inhibits ^click and ^dblclick on the children.

*/
installers.start_drag = function() {

	let e = this
	let down_ev, mx0, my0

	function start_drag(ev, mx, my) {

		let source_elem = e
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
			payload = payload_arg || e
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
			assert(dragging)
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
					if (e.fire('accept_drop', ev, payload, payload_r, source_elem)) {
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

		return e.capture_pointer(ev, source_elem_move, source_elem_up)
	}

	function check_drag(ev, mx, my) {
		if (!e.fireup('allow_drag', ev, mx, my, down_ev, mx0, my0))
			return
		return start_drag(ev, mx, my)
	}

	e.on('pointermove', function(ev, mx, my) {
		if (e.pointer_captured)
			return
		if (!down_ev)
			return
		if (!ev.buttons)
			return
		ev.preventDefault() // Safari: prevent selecting all text on the page.
		return check_drag(ev, mx, my)
	})

	e.on('pointerleave', function(ev) {
		if (e.pointer_captured)
			return
		down_ev = false
	})

	e.on('pointerup', function(ev) {
		if (ev.buttons) // pressed both buttons?
			return
		down_ev = false
		mx0 = null
		my0 = null
	})

	e.on('pointerdown', function(ev, mx, my) {
		if (e.pointer_captured)
			return
		down_ev = ev
		mx0 = mx
		my0 = my
		return check_drag(ev, mx, my)
	})

}

/* keyboard events -----------------------------------------------------------

NOTE: preventing focusing is a matter of not-setting/removing attr `tabindex`
except for input elements that must have an explicit `tabindex=-1`.
This is not done here, see e.make_disablable() and e.make_focusable().

*/

G.shift_pressed = null
G.ctrl_pressed  = null
G.alt_pressed   = null

callers.keydown = function(ev, f) {
	shift_pressed = ev.shiftKey
	ctrl_pressed  = ev.ctrlKey
	alt_pressed   = ev.altKey
	return f.call(this, ev, ev.key, ev.shiftKey, ev.ctrlKey, ev.altKey)
}
callers.keyup    = callers.keydown
callers.keypress = callers.keydown

// making sure that *_pressed globals are set.
document.on('keydown', noop)
document.on('keyup'  , noop)
document.on('stopped_event', function(ev) {
	if (ev.type == 'keydown' || ev.type == 'keyup') {
		shift_pressed = ev.shiftKey
		ctrl_pressed  = ev.ctrlKey
		alt_pressed   = ev.altKey
	}
})

alias(KeyboardEvent, 'shift', 'shiftKey')
alias(KeyboardEvent, 'ctrl' , 'ctrlKey')
alias(KeyboardEvent, 'alt'  , 'altKey')

callers.wheel = function(ev, f) {
	if (ev.target.effectively_disabled)
		return
	let dy = ev.wheelDeltaY
	if (!dy) return
	let is_trackpad = ev.wheelDeltaY === -ev.deltaY * 3
	return f.call(this, ev, dy, is_trackpad, ev.clientX, ev.clientY)
}

G.stopped_event_types = {pointerdown:1, keydown:1, keyup: 1}

override(Event, 'stopPropagation', function(inherited, ...args) {
	inherited.call(this, ...args)
	// notify document of stopped events.
	if (this.type in stopped_event_types)
		document.fire('stopped_event', this)
})

// clipboard of elements & copy/paste events ---------------------------------

G.copied_elements = set() // {element}

document.on('keydown', function(ev, key, shift, ctrl, alt) {
	if (alt || shift)
		return
	if (ctrl && key == 'c') {
		ev.target.fireup('copy', ev)
	} else if (ctrl && key == 'x') {
		ev.target.fireup('cut', ev)
	} else if (ctrl && key == 'v') {
		if (copied_elements.size)
			ev.target.fireup('paste', ev)
	}
})

// DOMRect extensions --------------------------------------------------------

G.domrect = function(...args) {
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
G.px = function(v) {
	return isnum(v) ? v+'px' : v ?? null
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
	announce('layout_changed')
})

// this is only needed on Firefox with the debugger open,
// and if you don't preload fonts (which you should).
document.fonts.on('loadingdone', function() {
	announce('layout_changed', 'fonts')
})

// common state wrappers -----------------------------------------------------

css_generic_state('[hidden]', '', `
	display: none !important;
`)

e.hide = function(on, ev) {
	if (!arguments.length)
		on = true
	else
		on = !!on
	if (this.hidden == on)
		return
	this.hidden = on
	this.announce('show', !on)
	return this
}
e.show = function(on, ev) {
	if (!arguments.length)
		on = true
	this.hide(!on, ev)
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

property(Element, 'has_focus', function() {
	return this.contains(document.activeElement)
})

property(Element, 'focus_visible', function() {
	return this.matches(':focus-visible')
})

property(Element, 'has_focus_visible', function() {
	if (Firefox) {
		return !!this.$1(':focus-visible')
	} else {
		return this.matches(':has(:focus-visible)')
	}
})

property(Element, 'effectively_focusable', function() {
	let t = this.tag, e = this
	return (
			t == 'button' || t == 'input' || t == 'select' || t == 'textarea'
			|| ((t == 'a' || t == 'area') && this.hasattr('href'))
			|| (e.hasattr('tabindex') && e.attr('tabindex') != '-1')
			|| e.hasclass('focusable')
		) && !e.effectively_hidden && !e.effectively_disabled
})

e.focusables = function() {
	let a = []
	let sel = ':is(button,a[href],area[href],input,select,textarea,[tabindex],.focusable):not([tabindex="-1"])'
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
	let node = html(s)
	let sel = getSelection()
	let range = sel.getRangeAt(0)
	range.insertNode(node)
	range.setStartAfter(node)
	range.setEndAfter(node)
	sel.removeAllRanges()
	sel.addRange(range)
})

method(HTMLElement, 'is_caret_at_text_end', function() {
	let sel = getSelection()
	let offset = sel.focusOffset
	sel.modify('move', 'forward', 'character')
	if (offset == sel.focusOffset) {
		return true
	} else {
		sel.modify ('move', 'backward', 'character')
		return false
	}
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

G.is_node_trimmable = node => (node && (
	(node.nodeType == Node.ELEMENT_NODE && node.tagName == 'BR') ||
	(node.nodeType == Node.TEXT_NODE    && node.textContent.trim() == '')
))

method(HTMLElement, 'trim_inner_html', function() {
	let node = this.last_node
	while (is_node_trimmable(node)) {
		let node_to_remove = node
		node = node.prev_node
		node_to_remove.del()
	}
	node = this.first_node
	while (is_node_trimmable(node)) {
		let node_to_remove = node
		node = node.next_node
		node_to_remove.del()
	}
})

// scrolling -----------------------------------------------------------------

G.scroll_to_view_dim = function(x, w, pw, sx, align) {
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

G.scroll_to_view_rect = function(x, y, w, h, pw, ph, sx, sy, halign, valign) {
	sx = scroll_to_view_dim(x, w, pw, sx, halign)
	sy = scroll_to_view_dim(y, h, ph, sy, valign ?? halign)
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

G.scrollbar_widths = memoize(function() {
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

G.scrollbox_client_dimensions = function(w, h, cw, ch, overflow_x, overflow_y, vscrollbar_w, hscrollbar_h) {

	overflow_x = overflow_x || 'auto'
	overflow_y = overflow_y || 'auto'
	vscrollbar_w = vscrollbar_w ?? scrollbar_widths()[0]
	hscrollbar_h = hscrollbar_h ?? scrollbar_widths()[1]

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
G.raf = function(f, last_id) {
	return last_id == null ? requestAnimationFrame(f) : last_id
}
G.cancel_raf = cancelAnimationFrame

G.in_raf = false // public

G.raf_wrap = function(f) {
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

update_all = raf_wrap(update_all)

// animation easing ----------------------------------------------------------

// NOTE: with Web Animations API you don't get a callback for each frame,
// hence why we still need a js easing API.

G.easing = obj() // from easing.lua

easing.reverse = (f, t, ...args) => 1 - f(1 - t, ...args)
easing.inout   = (f, t, ...args) => t < .5 ? .5 * f(t * 2, ...args) : .5 * (1 - f((1 - t) * 2, ...args)) + .5
easing.outin   = (f, t, ...args) => t < .5 ? .5 * (1 - f(1 - t * 2, ...args)) : .5 * (1 - (1 - f(1 - (1 - t) * 2, ...args))) + .5

// ease any interpolation function.
easing.ease = function(f, way, t, ...args) {
	f = easing[f] ?? f
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

// restartable, abortable, callback-based transitions.
// like the animation API but simpler and with a per-frame callback.
G.transition = function(f) {
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
	e.abort = function() {
		if (raf_id == null) return
		cancel_raf(raf_id)
		raf_id = null
		t0 = null
		e.started = false
	}
	e.stop = function() {
		if (raf_id == null) return
		e.started = false // stop on next frame
	}
	e.restart = function(_dt, _y0, _y1, _ease_f, _ease_way, ..._ease_args) {
		t0 = null
		dt = max(0, _dt)
		y0 = _y0
		y1 = _y1
		ease_f = _ease_f
		ease_way = _ease_way ?? 'out'
		ease_args = _ease_args
		y0 = y0 ?? 0
		y1 = y1 ?? 1
		ease_f = ease_f ?? 'cubic'
		raf_id = raf(wrapper)
		e.started = true
		start()
	}
	let wrapper = function(t) {
		t0 = t0 ?? t
		let lin_x = e.started ? lerp(t, t0, t0 + dt * 1000, 0, 1) : 1
		if (lin_x < 1) {
			let eas_x = easing.ease(ease_f, ease_way, lin_x, ...ease_args)
			let y = lerp(eas_x, 0, 1, y0, y1)
			if (f(y, lin_x) !== false)
				raf_id = raf(wrapper)
		} else {
			raf_id = null
			t0 = null
			e.started = false
			f(y1, 1, true)
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

G.hit_test_rect_sides = function(x0, y0, d1, d2, x, y, w, h) {
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
	return hit_test_rect_sides(mx, my, d1 ?? 5, d2 ?? 5, r.x, r.y, r.w, r.h)
}

// canvas --------------------------------------------------------------------

G.is2dcx = cx => cx instanceof CanvasRenderingContext2D

method(CanvasRenderingContext2D, 'clear', function() {
	this.clearRect(0, 0, this.canvas.width, this.canvas.height)
})

method(CanvasRenderingContext2D, 'user_to_device', function(x, y, out, scaled) {
	let m = this.getTransform()
	// ^^ we're trying not to litter with `out` but the browser litters anyway
	// by allocating a matrix on each getMatrix() call. great job...
	out = out || []
	out[0] = m.a * x + m.c * y + m.e
	out[1] = m.b * x + m.d * y + m.f
	if (scaled) {
		out[0] /= devicePixelRatio
		out[1] /= devicePixelRatio
	}
	return out
})

method(CanvasRenderingContext2D, 'device_to_user', function(x, y, out, scaled) {
	let m = this.getTransform().invertSelf()
	if (scaled)
		m.scaleSelf(devicePixelRatio, devicePixelRatio)
	out = out || []
	out[0] = m.a * x + m.c * y + m.e
	out[1] = m.b * x + m.d * y + m.f
	return out
})

// pw & ph are size multiples for lowering the number of resizes.
method(HTMLCanvasElement, 'resize', function(w, h, pw, ph) {
	w = min(w, 4000)
	h = min(h, 4000)
	pw = pw || 100
	ph = ph || 100
	w = ceil(w / pw) * pw
	h = ceil(h / ph) * ph
	let r = devicePixelRatio
	let rw = ceil(w * r)
	let rh = ceil(h * r)
	if (this.width  != rw) this.width  = rw
	if (this.height != rh) this.height = rh
	this.w = w
	this.h = h
})

// Create a div with a canvas inside. The canvas is resized automatically
// to fill the div when the div size changes. The div's redraw(cx, w, h)
// method is called on div's update and when the canvas is resized.
// Before each redraw call the canvas is cleared and the context is reset.
G.resizeable_canvas_container = function() {
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
		// TODO: WTF is going on with Safari??
		if (Safari) {
			canvas.height = 0
			canvas.height = h
		}
		do {
			let pass = redraw_pass
			redraw_pass = null
			canvas.resize(w, h)
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
	ct.listen('layout_changed', update)
	ct.on_redraw = function(f) {
		ct.do_after('do_redraw', f)
	}
	ct.redraw_now = redraw
	ct.canvas = canvas
	ct.context = cx
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
	content: ''; /* because it's used in ::before and ::after */
`)

G.overlay = function(attrs, content) {
	let e = div(attrs)
	e.class('overlay')
	e.content = content || div()
	e.set(e.content)
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
		e.modal_overlay.del()
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

root.on('keydown', function(ev, key, shift, ctrl, alt) {
	if (key == 'Tab') {
		let modal = ev.target.closest('.modal, .popup') || this
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

	e.on_update(function(opt) {
		if (opt.show) {
			e.unsafe_html = html_content
			announce('layout_changed')
		}
	})

	function global_changed() {
		let k = e.global
		if (!k) return
		let on = e.cond(window[k])
		e.update({show: on})
	}

	function bind_global(k, on) {
		if (!k) return
		listen(k+'_changed', global_changed, on)
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
		|| repl(css['z-index'        ], 'auto')
		|| repl(css['opacity'        ], '1')
		|| repl(css['mix-blend-mode' ], 'normal')
		|| repl(css['transform'      ], 'none')
		|| repl(css['filter'         ], 'none')
		|| repl(css['backdrop-filter'], 'none') // not in Safari 16
		|| repl(css['perspective'    ], 'none')
		|| repl(css['clip-path'      ], 'none')
		|| repl(css['mask'           ], 'none')
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

e.make_popup = function(target, side, align) {

	let e = this
	e.make_popup = noop

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
		if (!(sp == root || sp.hasclass('popup') || sp.hasclass('modal-overlay')))
			warn('invalid stacking parent detected:', sp.debug_name,
				'popup could be partially obscured.')
		let sr = sp.rect()
		spx = sr.x + sp.cx
		spy = sr.y + sp.cy
	})

	function layout(w, h, side, align) {

		let tx1 = tr.x + (e.popup_x1 ?? 0)
		let ty1 = tr.y + (e.popup_y1 ?? 0)
		let tx2 = tr.x + (e.popup_x2 ?? tr.w)
		let ty2 = tr.y + (e.popup_y2 ?? tr.h)
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

		e.fire('popup_position', side, align)

	})

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

	e.prop('popup_x1'    , {private: true, type: 'number'})
	e.prop('popup_y1'    , {private: true, type: 'number'})
	e.prop('popup_x2'    , {private: true, type: 'number'})
	e.prop('popup_y2'    , {private: true, type: 'number'})
	e.prop('popup_ox'    , {private: true, type: 'number', default: 0})
	e.prop('popup_oy'    , {private: true, type: 'number', default: 0})
	e.prop('popup_fixed' , {private: true, type: 'bool', default: false})

	e.property('popup_target_rect',
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

	function window_scroll(ev) {
		if (ev.target.contains(e.parent))
			e.position()
	}

	function update() {
		e.update()
	}

	e.on_bind(function(on) {

		// changes in content size updates the popup position.
		e.on('resize', update, on)

		// changes in parent size updates the popup position.
		e.parent.on('resize', update, on)

		// changes in content size updates the popup position.
		e.on('content_resize', update, on)

		// scrolling on any of the parents updates the popup position.
		window.on('scroll', window_scroll, on, true)

		// layout changes update the popup position.
		listen('layout_changed', update, on)

		// hovering on target can make it a stacking context
		// (eg. target sets opacity) which needs a popup update.
		e.parent.on('pointerover' , update, on)
		e.parent.on('pointerleave', update, on)

	})

	function no_bubble(ev) { ev.stopPropagation() }
	e.on('raw:pointerdown' , no_bubble)
	e.on('raw:pointerup'   , no_bubble)
	e.on('raw:pointermove' , no_bubble)
	e.on('raw:pointerover' , no_bubble)
	e.on('raw:pointerleave', no_bubble)
	e.on('raw:click'       , no_bubble)
	e.on('raw:dblclick'    , no_bubble)

	return e
}

// NOTE: not used yet. Right now we add popups directly to their owner element
// but that's a pain because we can't add the popup directly to its target
// element so we have to wrap the target to avoid messing up its box dimensions
// and the CSS of its direct children (eg. border-collapse), and then there's
// the stacking context problem (eg. we can't make the owner transparent).
// This solution seems better but we need to try it and see what breaks.
// TODO: finish this and use it!
e.add_popup = function(pe) {
	function bind(on) {
		if (on) {
			pe.hide()
			body.add(pe)
			if (!e.effectively_hidden)
				pe.update({show: true})
		} else {
			pe.del()
		}
	}
	e.on_bind(bind)
	e.listen('show', function(te, on) {
		if (te.contains(e))
			pe.update({show: on && !e.effectively_hidden})
	})
	if (!e.effectively_hidden)
		bind(true)
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
G.live_move_mixin = function(e) {

	e = e || {}

	let move_i1, move_i2, i1, i2, i1x, i2x, offsetx
	let move_x, over_i, over_p, over_x
	let sizes = []
	let positions = []
	let initial_positions = []

	e.move_element_start = function(move_i, move_n, _i1, _i2, _i1x, _i2x, _offsetx) {
		move_n = move_n ?? 1
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
		let x1 = i2x
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
						over_x = over_x ?? x
						move_ri1 = move_ri1 ?? i
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

G.is_theme_dark = function() {
	return root.hasclass('theme-dark')
}

G.set_theme_dark = function(dark) {
	root.class('theme-dark' , !!dark)
	root.class('theme-light', !dark)
	announce('layout_changed', 'theme')
}

G.get_theme_size = function() {
	return root.hasclass('theme-large') && 'large'
		|| root.hasclass('theme-small') && 'small'
		|| 'normal'
}

G.set_theme_size = function(size) {
	size = repl(size, 'normal')
	root.class('theme-large theme-small', false)
	if (size)
		root.class('theme-'+size)
	announce('layout_changed', 'theme')
}

// make `.theme-inverted` work.
if (!is_theme_dark())
	root.class('theme-light')

G.css_light = function(selector, ...args) {
	return css(':is(:root, .theme-light, .theme-dark .theme-inverted)'+selector, ...args)
}

G.css_dark = function(selector, ...args) {
	return css(':is(.theme-dark, .theme-light .theme-inverted)'+selector, ...args)
}

// CSS specificity reporting -------------------------------------------------

G.css_selector_specificity = function(s0) {
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

G.css_report_specificity = function(file, max_spec) {
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
			if (is_css_layer(rule)) // @layer block
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

}()) // module function
