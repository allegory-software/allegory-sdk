/*

	Web Components in JavaScript.
	Written by Cosmin Apreutesei. Public Domain.

You must load first, in order:

	glue.js  dom.js  css.js

WIDGETS

	tooltip
	toaster
	list
	menu
	tabs
	split, vsplit
	action-band
	dlg
	toolbox
	slides
	md
	pagenav
	label
	info
	check
	toggle
	radio
	slider
	input-group
	labelbox
	input
	textarea
	button
	select-button
	tags-box, tags
	dropdown
	autocomplete
	calendar
	range-calendar
	ranges-calendar
	date-input
	time-input
	datetime-input
	date-range-input
	html-input

FUNCTIONS

	notify(text, ['search'|'info'|'error'], [timeout])

WRITING CSS RULES

	CSS REUSE

		Use var() for anything that is used in two places and is not a coincidence.
		Use utils classes over specific styles when you can.

	CSS STATES

		State classes are set only on the outermost element of a widget except
		`:focus-visible` which is set to the innermost element (which has tabindex).
		Use `.outer.state .inner` to style `.inner` on `.state`.
		Use `.outer:has(.inner:focus-visible)` to style `.outer` on `:focus-visible`
		but note that this doesn't work in Firefox in 2022 (but will work in 2023).

	CSS DESCENDANT COMBINATOR

		For container widgets like tabs and split you have to use the ">" combinator
		instead of " " at least until you reach a header or something, otherwise
		you will accidentally select child widgets of the same type as the container.

*/

(function () {
"use strict"
let G = window

let e = Element.prototype

css('.x-container', 'g-h shrinks clip') /* grid because grid-in-flex is buggy */

// container with `display: contents`. useful to group together
// an invisible widget like a nav with a visible one.
// Don't try to group together visible elements with this! CSS will see
// your <x-ct> tag in the middle, but the layout system won't!
css('.x-ct', 'skip')

/* .focusable-items ----------------------------------------------------------

These are widgets containing multiple focusable and selectable items,
so they don't show a focus outline on the entire widget, but only show
an inside .item element as being focused instead.
NOTE: an .item cannot itself be or contain .focusable-items!

*/

css_state('.item.disabled', 'dim')
css_state('.item.null'    , 'dim')
css_state('.item.empty'   , 'dim')

css_state('.item.row-focused' , '', ` background: var(--bg-row-focused);  `)
css_state('.item.new'         , '', ` background: var(--bg-new);          `)
css_state('.item.modified'    , '', ` background: var(--bg-modified);     `)
css_state('.item.new.modified', '', ` background: var(--bg-new-modified); `)
css_state('.item.removed'     , 'strike')

css_state('.item.selected', '', ` background-color: var(--bg-unselected); `)
css_state('.item.focused' , '', ` background-color: var(--bg-unfocused);  `)

// this does the opposite of .focus-ring/.focus-outside classes.
css_state('.focusable-items:focus-visible', 'no-outline')
css_state('.focusable-items:focus-visible .item.focused', 'outline-focus')

css_state('.focusable-items:focus-within .item.selected', '', `
	background : var(--bg-selected);
	color      : var(--fg-selected);
`)

css_state('.focusable-items:focus-within .item.focused', '', `
	background : var(--bg-focused);
	color      : var(--fg-focused);
`)

css_state('.focusable-items .item.focused.selected', '', `
	background : var(--bg-unfocused-selected);
	color      : var(--fg-unfocused-selected);
`)

css_state('.focusable-items:focus-within .item.focused.selected', '', `
	background: var(--bg-focused-selected);
`)

css_state('.item.invalid', 'bg-error')

css_state('.focusable-items:focus-within .item.focused.invalid', '', `
	background : var(--bg-focused-error);
`)

/* <tooltip> -----------------------------------------------------------------

in props:
	text
	icon_visible
	kind              default search info error warn cursor
	target -> popup_target
	align  -> popup_align
	side   -> popup_side

*/

// z: menu = 4, picker = 3, tooltip = 2, toolbox = 1
css('.tooltip', 'z2 h-l h-t noclip noselect', `
	max-width: 400px;  /* max. width of the message bubble before wrapping */
	--bg-tooltip: var(--bg1);
	--fg-tooltip: var(--fg);
	--fg-tooltip-xbutton: var(--fg-dim);
	--border-tooltip-xbutton: var(--border-light);
`)

css('.tooltip-body', 'h-bl p-y tight ro', `
	background: var(--bg-tooltip);
	color: var(--fg-tooltip);
	box-shadow: var(--shadow-tooltip);
`)

// visibility animation

// hiding with `op0 click-through` instead of `display: none` enables animated show/hide.
css_generic_state('.tooltip[hidden]', '', `display: inline-flex !important;`)

css('.tooltip[hidden]'      , 'op0 click-through     ease-out ease-02s')
css('.tooltip:not([hidden])', 'op1 click-through-off anim-out anim-02s')

css('.tooltip:not([hidden])[side=left  ]', '', ` animation-name: tooltip-in-left;   `)
css('.tooltip:not([hidden])[side=right ]', '', ` animation-name: tooltip-in-right;  `)
css('.tooltip:not([hidden])[side=top   ]', '', ` animation-name: tooltip-in-top;    `)
css('.tooltip:not([hidden])[side=bottom]', '', ` animation-name: tooltip-in-bottom; `)

css(`
@keyframes tooltip-in-left   { 0% { opacity: 0; transform: translate(-1em, 0);  } 100% { opacity: 1; } }
@keyframes tooltip-in-right  { 0% { opacity: 0; transform: translate( 1em, 0);  } 100% { opacity: 1; } }
@keyframes tooltip-in-top    { 0% { opacity: 0; transform: translate(0, -.5em); } 100% { opacity: 1; } }
@keyframes tooltip-in-bottom { 0% { opacity: 0; transform: translate(0,  .5em); } 100% { opacity: 1; } }
`)

css('.tooltip-content', 'p-x-2', `
	display: inline-block; /* shrink-wrap and also word-wrap when reaching container width */
`)

css('.tooltip-xbutton', 't-t small p-y-05 p-x-2 b0 b-l', `
	align-self: stretch;
	pointer-events: all;
	color       : var(--fg-tooltip-xbutton);
	border-color: var(--border-tooltip-xbutton);
`)

css_state('.tooltip-xbutton:not(.active):hover', '', `
	color: inherit;
`)

css('.tooltip-tip', 'z1', `
	display: block;
	border: .5em solid transparent; /* border-based triangle shape */
	color: var(--bg-tooltip);
`)

css('.tooltip-icon', 't-t m-t-05 m-l-2', `
	font-size: 1em; /* TODO: why? */
	line-height: inherit !important; /* override fontawesome's !important */
`)

css('.tooltip[side=left  ] > .tooltip-tip', '', ` border-left-color   : inherit; `)
css('.tooltip[side=right ] > .tooltip-tip', '', ` border-right-color  : inherit; `)
css('.tooltip[side=top   ] > .tooltip-tip', '', ` border-top-color    : inherit; `)
css('.tooltip[side=bottom] > .tooltip-tip', '', ` border-bottom-color : inherit; `)

// side & align combinations.

// NOTE: tooltip must have the exact same total width and height for each
// side and align combinations because side and/or align attrs can change
// _after_ the popup is being positioned when it's too late to re-measure it!
// This is why we put these paddings.
css('.tooltip:is([side=top],[side=bottom])', '', `padding-left: .5em; padding-right : .5em; margin-left: -.5em; margin-right : -.5em;`)
css('.tooltip:is([side=left],[side=right])', '', `padding-top : .5em; padding-bottom: .5em; margin-top : -.5em; margin-bottom: -.5em;`)

css('.tooltip:is([side=top],[side=bottom])', '', `flex-flow: column;`)
css('.tooltip[side=left   ]', '', `justify-content: flex-end;`)
css('.tooltip[align=start ]', '', `align-items: flex-start; `)
css('.tooltip[align=end   ]', '', `align-items: flex-end; `)
css('.tooltip[align=center]', '', `align-items: center; `)

css('.tooltip:is([side=right],[side=bottom]) > .tooltip-body', '', `order: 2;`)

css('.tooltip[align=center]:is([side=top],[side=bottom]) .tooltip-content', '', `text-align: center; `)
css('.tooltip[align=end   ]:is([side=top],[side=bottom]) .tooltip-content', '', `text-align: right; `)

css('.tooltip:is([side=top],[side=bottom]) > .tooltip-tip', '', ` margin: 0 .5em; `)
css('.tooltip:is([side=left],[side=right]) > .tooltip-tip', '', ` margin: .5em 0; `)

css('.tooltip[side=right ]', '', `margin-left   : -.25em; `)
css('.tooltip[side=left  ]', '', `margin-left   :  .25em; `)
css('.tooltip[side=top   ]', '', `margin-top    :  .25em; `)
css('.tooltip[side=bottom]', '', `margin-top    : -.25em; `)

// coloring based on kind attr.

css('.tooltip[kind=search]', '', `
	--bg-tooltip: var(--bg-search);
	--fg-tooltip: #000;
`)

css('.tooltip[kind=info]', '', `
	--bg-tooltip: var(--bg-info);
	--fg-tooltip: var(--fg-info);
	--fg-tooltip-xbutton    : var(--fg-dim-on-dark);
	--border-tooltip-xbutton: var(--border-light-on-dark);
`)

css('.tooltip[kind=error]', '', `
	--bg-tooltip: var(--bg-error);
	--fg-tooltip: var(--fg-error);
	--fg-tooltip-xbutton    : var(--fg-dim-on-dark);
	--border-tooltip-xbutton: var(--border-light-on-dark);
`)

css('.tooltip[kind=warn]', '', `
	--bg-tooltip: var(--bg-warn);
	--fg-tooltip: var(--fg-warn);
	--fg-tooltip-xbutton    : var(--fg-dim-on-dark);
	--border-tooltip-xbutton: var(--border-light-on-dark);
`)

css_light('.tooltip[kind=cursor]', '', `
	--bg-tooltip : #ffffcc; /* bg for at-cursor tooltips */
`)
css('.tooltip[kind=cursor]', '', `
	margin-left: .75em;
	margin-top : .75em;
`)
css('.tooltip[kind=cursor] > .tooltip-body', '', `
	padding: .15em 0;
	border: 1px solid #aaaa99;
	color: #333;
	background-color: var(--bg-tooltip);
	font-family: sans-serif;
	font-size: 12px;
	border-radius: 0;
`)
css('.tooltip[kind=cursor] > .tooltip-body > .tooltip-content', '', `
	padding: 0 .5em;
	white-space: pre !important;
`)
css('.tooltip[kind=cursor] > .tooltip-tip', 'hidden')

G.tooltip = component('tooltip', function(e) {

	e.class('tooltip')
	e.popup()

	e.prop('text'        , {slot: 'lang'})
	e.prop('icon_visible', {type: 'bool'})
	e.prop('kind'        , {type: 'enum',
			enum_values: 'default search info warn error cursor',
			default: 'default', attr: true})
	e.prop('timeout'     , {type: 'number'})
	e.prop('close_button', {type: 'bool'})

	e.alias('target' , 'popup_target')
	e.alias('side'   , 'popup_side')
	e.alias('align'  , 'popup_align')

	// SUBTLE: fixate side so that the tooltip has the exact same dimensions
	// when measured for the first time as when measured afterwards
	// after the side changes due to popup relayouting.
	e.attr('side', e.side)

	e.do_position_popup = function(side, align) {
		// slide-in + fade-in with css.
		e.attr('side' , side)
		e.attr('align', align)
	}

	e.close = function() {
		if (e.fire('close')) {
			e.remove()
			return true
		}
		return false
	}

	function close() { e.close() }

	let last_popup_time

	e.on_update(function(opt) {
		if (!e.content) {
			e.content = div({class: 'tooltip-content'})
			e.icon_box = div()
			e.body = div({class: 'tooltip-body'}, e.icon_box, e.content)
			e.pin = div({class: 'tooltip-tip'})
			e.add(e.body, e.pin)
			e.content.on('pointerdown', content_pointerdown)
		}
		if (e.close_button && !e.xbutton) {
			e.xbutton = div({class: 'tooltip-xbutton fa fa-times'})
			e.xbutton.on('pointerdown', return_false)
			e.xbutton.on('pointerup', close)
			e.body.add(e.xbutton)
		} else if (e.xbutton) {
			e.xbutton.hidden = !e.close_button
		}
		let icon_classes = e.icon_visible && tooltip.icon_classes[e.kind]
		e.icon_box.attr('class', icon_classes ? ('tooltip-icon ' + icon_classes) : null)
		if (opt.reset_timer)
			reset_timeout_timer()
		if (e.parent)
			last_popup_time = time()
		if (opt.text) {
			e.content.set(opt.text)
		}
	})

	e.set_text = function(s) {
		e.update({text: s, reset_timer: true})
	}

	let close_timer = timer(close)
	function reset_timeout_timer() {
		let t = e.timeout
		if (t == 'auto')
			t = clamp((e.content.textContent).length / (tooltip.reading_speed / 60), 1, 10)
		else
			t = num(t)
		close_timer(t)
	}
	e.on_bind(function(on) {
		if (!on) close_timer()
	})

	// keyboard, mouse & focusing behavior ------------------------------------

	e.on('keydown', function(key) {
		if (key == 'Escape') {
			e.close()
			return false
		}
	})

	function content_pointerdown(ev) {
		if (ev.target != this)
			return // clicked inside the tooltip.
		// TODO: generalize this behavior of focusing an element by clicking on empty space.
		this.focus_first()
		return false
	}

	// autoclose --------------------------------------------------------------

	e.prop('autoclose', {type: 'bool', default: false})

	e.on_bind(function(on) {
		document.on('pointerdown', document_pointerdown, on)
		document.on('stopped_event', document_stopped_event, on)
		document.on('focusin', document_focusin, on)
		document.on('focusout', document_focusout, on)
		if (on)
			e.update({reset_timer: true})
	})

	function too_soon() {
		// HACK: if less than 100ms has passed since the last call to popup()
		// then it means that this event is the one that made the popup show
		// in the first place, so we don't close the popup in that case.
		return (time() - last_popup_time) < .1
	}

	// clicking outside the tooltip or its anchor closes the tooltip.
	function document_pointerdown(ev) {
		if (!e.autoclose)
			return
		if (e.parent && e.parent.contains(ev.target)) // clicked inside the anchor.
			return
		if (e.contains(ev.target)) // clicked inside the tooltip.
			return
		if (too_soon())
			return
		e.close()
	}

	// clicking outside the tooltip closes the tooltip, even if the click did something.
	function document_stopped_event(ev) {
		if (!ev.type.ends('pointerdown'))
			return
		document_pointerdown(ev)
	}

	// focusing an element outside the tooltip or its anchor closes the tooltip.
	function document_focusin(ev) {
		document_pointerdown(ev)
	}

	// focusing out of the document (to the titlebar etc.) closes the tooltip.
	function document_focusout(ev) {
		if (!e.autoclose)
			return
		if (ev.relatedTarget)
			return
		if (!e.autoclose)
			return
		if (e.contains(ev.target))
			return
		e.close()
	}

})

tooltip.reading_speed = 800 // letters-per-minute.

tooltip.icon_classes = {
	info   : 'fa fa-info-circle',
	error  : 'fa fa-exclamation-circle',
	warn   : 'fa fa-exclamation-triangle',
}

/* <toaster> -----------------------------------------------------------------

methods:
	post(text, [kind], [timeout])
	close_all()

*/

css('.toaster', 'hidden') // don't mess up the layout

css('.toaster-message', 'op1 ease')

G.toaster = component('toaster', function(e) {

	e.class('toaster')
	e.tooltips = set()

	e.side = 'inner-top'
	e.align = 'center'
	e.timeout = 'auto'
	e.spacing = 6

	e.on_measure(function() {
		let y = e.spacing
		for (let t of e.tooltips) {
			t._y = y
			y += t.rect().h + e.spacing
		}
	})

	e.on_position(function() {
		for (let t of e.tooltips) {
			t.popup_y1 = t._y
			t.do_measure()
			t.do_position() // it being our child it's ok to force it.
		}
	})

	function close() {
		e.tooltips.delete(this)
		e.update()
	}

	e.post = function(text, kind, timeout) {
		let t = tooltip({
			classes: 'toaster-message',
			kind: kind,
			icon_visible: true,
			text: text,
			side: e.side,
			align: e.align,
			timeout: strict_or(timeout, e.timeout),
			close_button: true,
			zIndex: 1000, // TODO: show over modals.
		})
		t.on('close', close)
		e.tooltips.add(t)
		e.parent.add(t)
		e.update()
		return t
	}

	e.close_all = function() {
		for (let t of e.tooltips)
			t.close()
	}

	e.on_bind(function(on) {
		if (!on)
			e.close_all()
	})

})

// global notify function ----------------------------------------------------

let notify_toaster
G.notify = function(...args) {
	if (!dom_loaded)
		return
	if (!notify_toaster) {
		notify_toaster = toaster()
		document.body.add(notify_toaster)
	}
	let tt = notify_toaster.post(...args)
	console.log('NOTIFY', iselem(args[0]) ? args[0].textContent : args[0])
	return tt
}
listen('ajax_error' , function(err) { notify(err, 'error') })
listen('ajax_notify', function(msg, kind) { notify(msg, kind || 'info') })

/* lists of elements with one or more static items at the end ----------------

in state:
	list_static_lien
out state:
	list_len

*/

property(e, 'list_len', function() {
	return this.len - (this.list_static_len || 0)
})

/* drag & drop list elements: acting as a drag source ------------------------

item state:
	selected
list css classes:
	moving
item css classes:
	dragging
	grabbed
uses:
	list_can_drag_elements (defaults to true)
fires:
	items_changed()

*/

css_state('.dragging', 'abs m0 z5')
css_state('.grabbed', 'z6')

// NOTE: margins on list elements are not supported with drag & drop!
// Use padding and gap on the list instead, that works.
css_role('.list-drag-elements > *', 'm0')

e.make_list_drag_elements = function(can_drag_elements) {

	let e = this
	e.make_list_drag_elements = noop

	e.class('list-drag-elements')

	e.list_can_drag_elements = can_drag_elements != false

	// offsets when stacking multiple elements for dragging.
	let ox = 5
	let oy = 5

	let grabbed_item

	e.on('allow_drag', function(ev, mx, my, down_ev, mx0, my0) {

		if (!e.list_can_drag_elements)
			return false

		if ((my - my0)**2 + (mx - mx0)**2 < 5**2)
			return false

		grabbed_item = down_ev.target.closest_child(e)
		if (!grabbed_item)
			return false

	})

	e.on('start_drag', function(ev, start, mx, my, down_ev, mx0, my0) {

		let items = []
		for (let i = 0, n = e.list_len; i < n; i++) {
			let item = e.at[i]
			if (item.selected || item == grabbed_item)
				items.push(item)
		}

		let horiz = e.css('flexDirection') == 'row'
		let items_r = grabbed_item.rect()

		// save item props that we must change while dragging, to be restored on drop.
		for (let item of items) {
			item._x0 = item.style.left
			item._y0 = item.style.top
			item._w0 = item.style.width
			item._h0 = item.style.height
			item._r0 = item.rect()
			item._index0 = item.index // NOTE: O(n)
		}

		items.sort((e1, e2) => e1._index0 < e2._index0 ? -1 : 1)

		// --measuring stops here--

		for (let item of items) {
			item.class('dragging')
			if (items.len > 1) {
				let r = floor(random() * 15) - 5
				item.style.transform = `rotate(${r}deg)`
			}
			// fixate size so we can move it out of layout.
			item.w = item._r0.w
			item.h = item._r0.h
			// note: this enlarge-on-cross-axis-only thing ony makes sense when
			// moving elements between lists with same horiz.
			if (horiz)
				items_r.w += ox
			else
				items_r.h += oy
		}
		// move the items out of layout so they don't get clipped.
		for (let i = items.length-1; i >= 0; i--)
			root.add(items[i])
		e.fire('items_changed')

		e.class('moving')
		grabbed_item.class('grabbed')
		force_cursor('grabbing')

		start(items, items_r)
	})

	e.on('dragging', function(ev, items, items_r) {
		let x = 0
		let y = 0
		for (let item of items) {
			item.x = items_r.x + x
			item.y = items_r.y + y
			x += ox
			y += oy
		}
	})

	e.on('stop_drag', function(ev, dest_elem, items) {
		e.class('moving', false)
		grabbed_item.class('grabbed', false)
		force_cursor(false)
		for (let item of items) {
			item.class('dragging', false)
			item.style.transform = null
			item.x = item._x0
			item.y = item._y0
			item.w = item._w0
			item.h = item._h0
			if (!dest_elem) // put element back in its initial position.
				e.insert(item._index0, item)
		}
		if (!dest_elem)
			e.fire('items_changed')
	})

}

/* drag & drop list elements: acting as a drop destination -------------------

list css classes:
	list-accepts-items
list placeholder css classes:
	list-drop-placeholder
fires:
	items_changed()

*/

css_state('.list-accepts-items > *', 'rel ease z1')
css_state('.list-drop-placeholder', 'abs b2 b-dashed no-ease', `
	border-color: var(--fg-link);
`)

e.make_list_drop_elements = function() {

	let e = this
	e.make_list_drop_elements = noop

	e.class('list-drag-elements')

	let horiz
	let gap_y, placeholder_w
	let ys // y's of host elements in offset space.
	let mys // mid-points in host elements in viewport space.
	let placeholder
	let hit_i, hit_y

	function hit_test(elem_y) {
		let n = e.list_len
		for (let i = 0; i < n; i++) {
			if (elem_y < mys[i]) {
				hit_i = i
				hit_y = ys[i]
				return
			}
		}
		hit_i = n
	}

	e.listen('drag_started', function(drop_items, add_drop_area, source_e) {

		// --measuring starts here--

		let e_css = e.css()
		horiz = e_css.flexDirection == 'row'
		gap_y = num(horiz ? e_css.columnGap : e_css.rowGap) || 0
		placeholder_w = horiz
			? e.ch - (num(e_css.paddingTop ) || 0) - (num(e_css.paddingBottom) || 0)
			: e.cw - (num(e_css.paddingLeft) || 0) - (num(e_css.paddingRight ) || 0)
		ys = []
		mys = []
		let item, item_r
		for (let i = 0, n = e.list_len; i < n; i++) {
			item = e.at[i]
			item_r = item.rect()
			ys.push(horiz ? item.ox : item.oy)
			mys.push(horiz
				? item.ox + item.ow / 2
				: item.oy + item.oh / 2
			)
		}
		if (item)
			ys.push(horiz
				? item.ox + item.ow + gap_y
				: item.oy + item.oh + gap_y
			)
		else
			ys.push(0)

		add_drop_area(e, e.rect())

		// --measuring stops here--

		e.class('list-accepts-items')

	})

	e.listen('drag_stopped', function(drop_items, source_e) {

		e.class('list-accepts-items', false)

		// TODO: save and restore these.
		for (let i = 0, n = e.list_len; i < n; i++) {
			let ce = e.at[i]
			ce.x = null
			ce.y = null
		}

		ys = null
		mys = null

		if (placeholder) {
			placeholder.remove()
			placeholder = null
			e.list_static_len--
		}

	})

	e.on('dropping', function(ev, accepted, drop_items, items_r) {
		if (accepted) {
			hit_test(horiz
				? items_r.x - e.rect().x - e.cx + e.sx
				: items_r.y - e.rect().y - e.cy + e.sy
			)
		}
		if (accepted) {
			if (!placeholder) {
				placeholder = div({class: 'list-drop-placeholder'})
				placeholder.is_list_item = false // for excluding in iterations
				e.add(placeholder)
				e.list_static_len = (e.list_static_len || 0) + 1
			}
			if (horiz) {
				placeholder.x = ys[hit_i]
				placeholder.min_h = placeholder_w
				placeholder.min_w = items_r.w
			} else {
				placeholder.y = ys[hit_i]
				placeholder.min_w = placeholder_w
				placeholder.min_h = items_r.h
			}
			placeholder.show()
			placeholder.make_visible()
		} else if (placeholder) {
			placeholder.hide()
		}
		for (let i = 0, n = e.list_len; i < n; i++) {
			let item = e.at[i]
			item[horiz ? 'x' : 'y'] =
				accepted ? (i < hit_i ? 0 : gap_y + (horiz ? items_r.w : items_r.h)) : 0
		}
	})

	e.on('drop', function(ev, drop_items, source_e) {
		for (let i = drop_items.len-1; i >= 0; i--) {
			let item = drop_items[i]
			e.insert(hit_i, item)
		}
		e.fire('items_changed')
		if (e.focus_item)
			e.focus_item(hit_i, 0, {
				selected_items: drop_items,
				event: ev,
			})
	})

}

/* make list elements movable within the same list only ----------------------

uses:
	list_can_move_elements (defaults to true)
	list_can_drag_elements (defaults to true)

*/

e.make_list_items_movable = function(can_move) {

	let e = this

	e.make_list_drag_elements()
	e.make_list_drop_elements()

	e.list_can_drag_elements = can_move != false
	e.list_can_move_elements = can_move != false

	let r, horiz

	e.on('allow_drag', function() {
		return !!e.list_can_move_elements
	})

	e.listen('drag_started', function(payload, add_drop_area, source_elem) {
		if (source_elem != e)
			return
		add_drop_area(e, domrect(-1/0, -1/0, 1/0, 1/0))
		horiz = e.css('flexDirection') == 'row'
		r = e.rect()
	})

	e.on('dragging', function(ev, items, items_r) {
		for (let item of items) {
			if (horiz)
				item.y = r.y
			else
				item.x = r.x
		}
	})

}

/* focusable & selectable list elements --------------------------------------

config props:
	multiselect
out props:
	selected_items: [item1,...]
	focused_item
	focused_item_index
uses props from item:
	item.focusable
uses attrs from item:
	nofocus
update options:
	opt.state
	opt.scroll_to_focused_item opt.scroll_align opt.scroll_smooth
	opt.enter_edit
announces:
	^^selected_items_changed()
	^^focused_item_changed()
stubs:
	can_edit_item([item])
	can_focus_item([item], [for_editing], [assume_visible])

*/

css('.clickable-list', 'arrow')

e.make_list_items_focusable = function(opt) {

	let e = this
	e.make_list_items_focusable = noop
	e.class('clickable-list focusable-items')

	e.can_edit_item = return_false
	e.can_focus_item = function(item, for_editing, assume_visible) {
		return (!item || (item.focusable != false && !item.hasattr('nofocus') && (assume_visible || !item.hidden)))
			&& (!for_editing || e.can_edit_item(item))
	}
	e.can_select_item = e.can_focus_item
	e.multiselect = strict_or(opt && opt.multiselect, true)
	e.stay_in_edit_mode = true

	e.selected_item_index = null
	e.property('selected_items', function() {
		let sel_items = []
		for (let i = 0, n = e.list_len; i < n; i++) {
			let item = e.at[i]
			if (item.selected)
				sel_items.push(item)
		}
		return sel_items
	}, function(items) {
		for (let i = 0, n = e.list_len; i < n; i++)
			e.at[i].selected = false
		for (let item of items)
			item.selected = true
		e.update({state: true})
	})

	e.prop('focused_item_index')

	e.set_focused_item_index = function(i, i0, ev) {
		e.announce('focused_item_changed', ev)
		if (ev && ev instanceof UIEvent)
			e.fire('input', ev)
	}

	e.property('focused_item', function() {
		return e.focused_item_index != null && e.at[e.focused_item_index] || null
	})

	e.property('selected_item', function() {
		return e.selected_item_index != null && e.at[e.selected_item_index] || null
	})

	/*
		i: true             start from focused item
		i: i                start from index i
		i: null             start from nowhere
		n: n                move n positions (positive or negative)
		n: null             move 0 positions
		opt.must_move       return only if moved
		opt.must_not_move   return only if not moved
		opt.editable        skip non-editable items
	*/
	e.first_focusable_item_index = function(i, n, opt) {

		if (i === true)
			i = e.focused_item_index

		n = n ?? 0 // by default find the first focusable item.
		let inc = strict_sign(n)
		n = abs(n)

		opt = opt || empty

		// if starting from nowhere, include the first/last item into the count.
		if (i == null && n)
			n--

		let move = n >= 1
		let start_i = i

		// the default item is the first or the last depending on direction.
		i ??= inc * -1/0

		// clamp out-of-bound indices.
		i = clamp(i, 0, e.list_len-1)

		let last_valid_i = null

		// find the last valid item, stopping after the specified row count.
		if (e.can_focus_item(null, opt.editable)) {
			let len = e.list_len
			while (i >= 0 && i < len) {
				let item = e.at[i]
				if (e.can_focus_item(item, opt.editable)) {
					last_valid_i = i
					if (n <= 0)
						break
				}
				n--
				i += inc
			}
		}

		if (last_valid_i == null)
			return null

		let moved = last_valid_i != start_i

		if (opt.must_move && !moved)
			return null

		if (opt.must_not_move && moved)
			return null

		return last_valid_i
	}

	/*
		i, n:                        see first_focusable_item_index() above
		i: false                     unfocus
		opt.event                    event that triggered the focus (if any)
		opt.unfocus_if_not_found
		opt.expand_selection
		opt.invert_selection
		opt.preserve_selection
		opt.selected_items
		opt.must_move                focus it only if moved
		opt.must_not_move            focus it only if not moved
		opt.make_visible
		opt.focus_editor
		opt.editable
		opt.focus_non_editable_if_not_found
	*/
	e.focus_item = function(i, n, opt) {

		if (!e.list_len)
			return false

		if (i === false) { // false means unfocus.
			return e.focus_item(i === false ? null : i, 0, assign({
				must_not_move: i === false,
				unfocus_if_not_found: true,
			}, opt))
		}

		opt = opt || empty_obj
		let was_editing = !!e.editor
		let focus_editor = opt.focus_editor || (e.editor && e.editor.has_focus)
		let enter_edit = opt.enter_edit || (was_editing && e.stay_in_edit_mode)
		let editable = (opt.editable || enter_edit) && !opt.focus_non_editable_if_not_found
		let expand_selection = opt.expand_selection && e.multiselect
		let invert_selection = opt.invert_selection && e.multiselect
		opt = assign({editable: editable}, opt)

		i = e.first_focusable_item_index(i, n, opt)

		// failure to find cell means cancel.
		if (i == null && !opt.unfocus_if_not_found)
			return false

		let moved = e.focused_item != e.at[i]

		let last_i = e.focused_item_index
		let i0 = e.selected_item_index ?? last_i
		let item = e.at[i]

		e.set_prop('focused_item_index', i, opt.event)

		let sel_items_changed
		if (opt.preserve_selection) {
			// leave it
		} else if (opt.selected_items) {
			e.selected_items = opt.selected_items
			sel_items_changed = true
		} else if (expand_selection) {
			let i1 = min(i0, i)
			let i2 = max(i0, i)
			for (let i = i1; i <= i2; i++) {
				let item = e.at[i]
				if (!item.selected && e.can_select_item(item))
					item.selected = true
			}
			sel_items_changed = true
		} else if (invert_selection) {
			if (item) {
				item.selected = !item.selected
				sel_items_changed = true
			}
		} else { // replace it
			e.selected_items = item ? [item] : []
			sel_items_changed = true
		}

		e.selected_item_index = expand_selection ? i0 : null

		if (sel_items_changed)
			e.announce('selected_items_changed', opt)

		if (moved || sel_items_changed)
			e.update({state: true})

		if (enter_edit && i != null)
			e.update({enter_edit: [opt.editor_state, focus_editor || false]})

		if (opt.make_visible != false)
			if (e.focused_item)
				e.update({scroll_to_focused_item: true, scroll_align: opt.scroll_align, smooth: opt.scroll_smooth})

		return true
	}

	e.select_all_items = function(ev) {
		for (let i = 0, n = e.list_len; i < n; i++) {
			let item = e.at[i]
			if (e.can_select_item(item))
				item.selected = true
		}
		e.update({state: true})
		e.announce('selected_items_changed', ev)
	}

	e.do_after('items_changed', function() {
		if (e.focused_item)
			if (e.focused_item.parent != e) { // removed
				e.focused_item_index = null
				e.update({state: true})
			}
		if (e.selected_item)
			if (e.selected_item.parent != e) // removed
				e.selected_item_index = null
		for (let i = 0, n = e.list_len; i < n; i++) {
			let item = e.at[i]
			item.class('item')
			if (item.selected)
				item.selected = null
		}
		e.announce('selected_items_changed')
		e.update({state: true})
	})

	e.on_update(function(opt) {

		if (opt.state) {
			for (let i = 0, n = e.list_len; i < n; i++) {
				let item = e.at[i]
				e.update_item_state(item)
			}
		}

		if (opt.scroll_to_focused_item)
			if (e.focused_item)
				e.focused_item.make_visible(opt.scoll_align, opt.scroll_align, opt.scroll_smooth)

	})

	e.update_item_state = function(item) {
		item.class('item')
		item.class('selected', !!item.selected)
		item.class('focused', e.focused_item == item)
	}

	e.on('pointerdown', function(ev) {

		let item = ev.target.closest_child(e)
		if (!item) return

		if (ev.ctrl && ev.shift) {
			e.focus_item(false, 0, {event: ev})
			return // enter editing / select widget
		}

		if (!e.focus_item(item.index, 0, {
			must_not_move: true,
			expand_selection: ev.shift,
			invert_selection: ev.ctrl,
			event: ev,
		}))
			return false

	})

	// find the next item before/after the selected item that would need
	// scrolling, if the selected item would be on top/bottom of the viewport.
	function page_item(forward) {
		if (!e.focused_item)
			return forward ? e.first : e.at[e.list_len-1]
		let item = e.focused_item
		let sy0 = item.oy + (forward ? 0 : item.oh - e.ch)
		item = forward ? item.next : item.prev
		while(item) {
			let [sx, sy] = item.make_visible_scroll_offset(0, sy0)
			if (sy != sy0)
				return item
			item = forward ? item.next : item.prev
		}
		return forward ? e.at[e.list_len-1] : e.first
	}

	e.on('keydown', function(key, shift, ctrl, alt, ev) {

		if (alt)
			return

		let horiz = e.css('flexDirection') == 'row'
		let n
		switch (key) {
			case 'ArrowUp'   : if (!horiz) n = -1; break
			case 'ArrowDown' : if (!horiz) n =  1; break
			case 'ArrowLeft' : if ( horiz) n = -1; break
			case 'ArrowRight': if ( horiz) n =  1; break
			case 'Home'      : n = -1/0; break
			case 'End'       : n =  1/0; break
		}
		if (n) {
			if (!shift) {
				let i = e.first_focusable_item_index(true, n)
				let item = e.at[i]
				if (item && item.attr('href')) {
					item.click()
					return false
				}
			}
			e.focus_item(true, n, {
				expand_selection: shift,
				make_visible: true,
				event: ev,
			})
			return false
		}

		if (key == 'PageUp' || key == 'PageDown') {
			let item = page_item(key == 'PageDown')
			if (item) {
				if (!shift && item.attr('href')) {
					item.click()
					return false
				}
				e.focus_item(item.index, 0, {
					expand_selection: shift,
					make_visible: true,
					event: ev,
				})
				return false
			}
		}

		if (key == 'a' && ctrl) {
			e.select_all_items()
			return false
		}

	})

	e.on('cut', function(ev) {
		if (ev.target != e) return
		let sel_items = e.selected_items
		if (!sel_items.length) return
		copied_elements.set(sel_items)
		for (let item of sel_items)
			item.remove()
		e.fire('items_changed')
		return false
	})

	e.on('copy', function(ev) {
		if (ev.target != e) return
		let sel_items = e.selected_items
		if (!sel_items.length) return
		copied_elements.set(sel_items)
		return false
	})

	e.on('paste', function(ev) {
		if (ev.target != e) return
		if (!copied_elements.size) return
		e.selected_item_index = null
		let sel_items = []
		let i = e.focused_item_index || e.list_len
		for (let item of copied_elements) {
			e.insert(i, item)
			sel_items.push(item)
			i++
		}
		copied_elements.clear()
		e.selected_items = sel_items
		e.fire('items_changed')
	})

}

/* list text search in searchable content ------------------------------------

list item inner element attrs:
	searchable
state props:
	search_string
state methods:
	search(s)
stubs:
	search_into(s, in_s) -> [i, len] | empty_array

NOTE: Makes list items be focusable if not already.

*/

e.make_list_items_searchable = function() {

	let e = this
	e.make_list_items_searchable = noop

	e.make_list_items_focusable()

	e.search_into = function(s, in_s) { // stub
		let i = in_s.find_ai_ci(s)
		return i != null ? [i, s.len] : empty_array
	}

	let search_string = ''
	e.property('search_string', () => search_string)

	function update_search(ev) {
		let searching = !!search_string

		// step 1: search and record required changes.
		let first_item_i
		let tape = []
		for (let item_i = 0, item_n = e.list_len; item_i < item_n; item_i++) {
			let item_e = e.at[item_i]

			// skip non-focusables
			if (!e.can_focus_item(item_e, null, true))
				continue

			let show = !searching
			let searchables = item_e.hasattr('searchable') ? [item_e] : item_e.$('[searchable]')
			for (let val_e of searchables) {
				let v = val_e.textContent
				if (!v)
					continue
				if (!searching) {
					tape.push('reset', item_e, val_e, v)
					continue
				}
				let [i, n] = e.search_into(search_string, v)
				if (i != null) {
					let prefix = v.slice(0, i)
					let search = v.slice(i, i+n)
					let suffix = v.slice(i+n)
					tape.push('search', item_e, val_e, prefix, search, suffix)
					show = true
					if (first_item_i == null)
						first_item_i = item_i
				}
			}
			tape.push('show', item_e, show || !searchables.length)
		}

		if (searching && first_item_i == null)
			return

		for (let i = 0, n = tape.len; i < n; ) {
			let cmd  = tape[i++]
			if (cmd == 'reset') {
				let item_e = tape[i++]
				let val_e  = tape[i++]
				let v      = tape[i++]
				val_e.set(v)
				item_e.show()
			} else if (cmd == 'search') {
				let item_e = tape[i++]
				let val_e  = tape[i++]
				let prefix = tape[i++]
				let search = tape[i++]
				let suffix = tape[i++]
				val_e.clear()
				val_e.add(prefix)
				val_e.add(span({class: 'dropdown-search'}, search))
				val_e.add(suffix)
				item_e.show()
			} else if (cmd == 'show') {
				let item_e = tape[i++]
				let show   = tape[i++]
				item_e.show(show)
			}
		}

		// step 3: focus first found item.
		if (first_item_i != null) {
			e.focus_item(first_item_i, 0, {
				make_visible: true,
				event: ev,
			})
		} else {
			let item_e = e.focused_item
			if (item_e)
				item_e.make_visible()
		}

		e.update({value: true})

		return true
	}

	e.search = function(s, ev) {
		if (!s) s = ''
		if (search_string == s)
			return
		let s0 = search_string
		search_string = s
		let found = update_search(ev)
		if (!found)
			search_string = s0
		e.fire('search', found)
		return found
	}

	e.on('items_changed', update_search)

	e.on('keydown', function(key, shift, ctrl, alt, ev) {
		if (key == 'Backspace' && search_string) {
			e.search(search_string.slice(0, -1), ev)
			return false
		}
		if (!ctrl && !alt && (key.length == 1 || /[^a-zA-Z0-9]/.test(key))) {
			e.search((search_string || '') + key, ev)
			return false
		}
	})

}

/* <list> --------------------------------------------------------------------

inner html:
	<template>          inline template
	<script>            inline script to compute and return the items array
html attrs:
	item_template       template name for formatting an item
	items               items json array
config props:
	item_template       template text for formatting an item
	item_template_name  template name for formatting an item
	selected_items
data props:
	items               set of items
stubs:
	format_item(item, ts)

NOTE: removes element margins!

*/

css('.list', 'v-t scroll-auto rel')

G.list = component('list', function(e) {

	e.class('list')
	e.make_disablable()

	let ht = e.$1(':scope>template, :scope>script[type="text/x-mustache"], :scope>xmp')
	let html_template = ht && ht.html
	if (ht) ht.remove()

	let s = e.$1(':scope>script')
	let html_items = s && s.run(e) || json_arg(e.attr('items'))

	e.clear()

	e.property('item_template_string', function() {
		return template(e.item_template_name) || e.item_template
	})

	let items = empty_array
	e.get_items = () => items
	e.set_items = function(items1) {
		items = items1
		let ts = e.item_template_string
		if (!ts) return
		e.clear()
		for (let item of items) {
			let item_e = e.format_item(item, ts)
			item_e.data = item
			item_e.focusable = item.focusable
			if (e.update_item_state)
				e.update_item_state(item_e)
			e.add(item_e)
		}
		e.fire('items_changed', 'set_items')
	}
	e.prop('items', {store: false, type: 'array', element_type: 'node'})

	e.prop('item_template_name', {type: 'template_name', attr: 'item_template', updates: 'items'})
	e.prop('item_template'     , {type: 'template', updates: 'items'})

	e.format_item = function(item, ts) {
		return unsafe_html(render_string(ts, item || empty_obj), false)
	}

	e.rerender_item = function(e0, ts) {
		let item = e0.data
		let e1 = e.format_item(item, ts)
		e1.data = item
		e1.selected = e0.selected
		e.replace(e0, e1)
		if (e.update_item_state)
			e.update_item_state(e1)
		return e1
	}

	e.on('items_changed', function(from) {
		if (from == 'set_items')
			return
		items.clear()
		for (let i = 0, n = e.list_len; i < n; i++)
			items.push(e.at[i].data)
	})

	return {item_template: html_template, items: html_items}

})

/* <menu> --------------------------------------------------------------------

-- TODO

*/

// z4: menu = 4, picker = 3, tooltip = 2, toolbox = 1
// noclip: submenus are outside clipping area.
// fg: prevent inheritance by the .focused rule below.
css('.menu', 'm0 p0 b arial t-l abs z4 noclip bg1 fg shadow-menu noselect', `
	min-width: 200px;
	width: min-content; /* why the fuck is width:0 not working here? */
	display: table;
`)

// submenus are anchored to this td
css('.menu-tr > .menu-sub-td', 'rel')

css('.menu-tr > td', 'p')

css('.menu-tr > td:first-child', 'p-l-2')

css('.menu-separator', '', `height: 1em;`)

css('.menu-heading', 'p-y p-l-2 bold dim')

css('.menu-separator > hr', 'b0 b-t m-y')

css('.menu-title-td', 'p0 p-y p-l-0 clip nowrap', `width: 100%;`)

css_state('.menu:focus-visible', 'no-outline')

css_state('.menu-tr.focused > :not(.menu)', '', `
	background : var(--bg-unfocused-selected);
	color      : var(--fg-unfocused-selected);
`)

css_state('.menu:focus-within .menu-tr.focused > :not(.menu)', '', `
	background : var(--bg-focused-selected);
`)

css('.menu-check-div', 'p-x')

css('.menu-check-div::before', 'fa fa-check')

css('.menu-sub-div', 'p-x')
css('.menu-sub-div::before', 'fa fa-angle-right')

G.menu = component('menu', function(e) {

	e.make_disablable()
	e.make_focusable()
	e.class('menu')
	e.popup()

	// view

	function init_menu_item(tr) {

		tr.on('load', function(ev, ...args) {
			tr.attr('disabled', tr.item.disabled || ev != 'done')
			let s = tr.item.load_spin
			if (s) {
				s = repl(s, true, 'fa-spin')
				s = repl(s, 'reverse', 'fa-spin fa-spin-reverse')
				tr.icon_box.class(s, ev == 'start')
			}
		})

		tr.item.load = function(url, success, fail, opt) {
			return get(url, success, fail, assign({notify: tr}, opt))
		}

		tr.item.post = function(url, upload, success, fail, opt) {
			return post(url, upload, success, fail, assign({notify: tr}, opt))
		}
	}

	function create_item(item, disabled) {
		let check_box = div({class: 'menu-check-div'})
		let icon_box  = div({class: 'menu-icon-div'})
		if (isstr(item.icon))
			icon_box.classes = item.icon
		else
			icon_box.set(item.icon)
		let check_td  = tag('td', {class: 'menu-check-td'}, check_box, icon_box)
		let title_td  = tag('td', {class: 'menu-title-td'})
		title_td.set(item.text)
		let key_td    = tag('td', {class: 'menu-key-td'}, item.key)
		let sub_box   = div({class: 'menu-sub-div'})
		let sub_td    = tag('td', {class: 'menu-sub-td'}, sub_box)
		sub_box.style.visibility = item.items ? null : 'hidden'
		let tr = tag('tr', {class: 'item menu-tr'}, check_td, title_td, key_td, sub_td)
		tr.icon_box = icon_box
		tr.class('disabled', disabled || item.disabled)
		tr.item = item
		tr.check_box = check_box
		update_check(tr)
		tr.on('pointerdown' , item_pointerdown)
		tr.on('pointerenter', item_pointerenter)
		init_menu_item(tr)
		return tr
	}

	function create_heading(item) {
		let td = tag('td', {class: 'menu-heading', colspan: 4})
		td.set(item.heading)
		let tr = tag('tr', {}, td)
		tr.focusable = false
		tr.on('pointerenter', separator_pointerenter)
		return tr
	}

	function create_separator() {
		let td = tag('td', {class: 'menu-separator', colspan: 4}, tag('hr'))
		let tr = tag('tr', {}, td)
		tr.focusable = false
		tr.on('pointerenter', separator_pointerenter)
		return tr
	}

	function create_menu(table, items, is_submenu, disabled) {
		table = table || tag('table', {cellspacing: 0, cellpadding: 0})
		table.classes = 'widget menu'
		table.attr('tabindex', 0)
		for (let i = 0; i < items.length; i++) {
			let item = items[i]
			item.menu = e
			let tr = item.heading ? create_heading(item) : create_item(item, disabled)
			table.add(tr)
			if (item.separator)
				table.add(create_separator())
		}
		table.on('keydown', menu_keydown)
		return table
	}

	e.on_init(function() {
		e.table = create_menu(e, e.items, false, e.disabled)
	})

	function show_submenu(tr) {
		let table = tr.submenu_table
		if (!table) {

			let items = tr.item.items
			if (!items)
				return

			table = create_menu(null, items, true, tr.item.disabled)
			table.parent_menu = tr.parent
			tr.submenu_table = table
			tr.last.add(table)

		} else {

			table.x = null
			table.y = null

		}

		// adjust submenu to fit the screen.
		let r = table.rect()
		let br = document.body.rect()
		table.y = -max(0, r.y2 - br.y2 + 10)
		if (r.x2 - br.x2 > 10) {
			table.x = -r.w - tr.clientWidth + tr.last.clientWidth + 2
		} else {
			table.x = tr.last.clientWidth - 2
		}

		return table
	}

	function hide_submenu(tr) {
		if (!tr.submenu_table)
			return
		tr.submenu_table.remove()
		tr.submenu_table = null
	}

	function select_item(menu, tr) {
		unselect_selected_item(menu)
		menu.selected_item_tr = tr
		if (tr)
			tr.class('focused', true)
	}

	function unselect_selected_item(menu) {
		let tr = menu.selected_item_tr
		if (!tr)
			return
		menu.selected_item_tr = null
		hide_submenu(tr)
		tr.class('focused', false)
	}

	function update_check(tr) {
		tr.check_box.hidden = tr.item.checked == null
		tr.check_box.style.visibility = tr.item.checked ? null : 'hidden'
	}

	// popup protocol

	e.on_bind(function(on) {
		document.on('pointerdown', document_pointerdown, on)
		document.on('rightpointerdown', document_pointerdown, on)
		document.on('stopped_event', document_stopped_event, on)
		if (on && e.select_first_item)
			select_next_item(e.table)
	})

	function document_pointerdown(ev) {
		if (e.contains(ev.target)) // clicked inside the menu.
			return
		e.close()
	}

	// clicking outside the menu closes the menu, even if the click did something.
	function document_stopped_event(ev) {
		if (e.contains(ev.target)) // clicked inside the menu.
			return
		if (ev.type.ends('pointerdown'))
			e.close()
	}

	e.close = function(focus_target) {
		e.remove()
		select_item(e.table, null)
		if (e.parent && focus_target)
			e.parent.focus()
	}

	// navigation

	function next_valid_item(menu, down, tr) {
		let i = menu.children.length
		while (i--) {
			tr = tr && (down != false ? tr.next : tr.prev)
			tr = tr || (down != false ? menu.first : menu.last)
			if (tr && tr.focusable != false && !tr.hasclass('disabled'))
				return tr
		}
	}
	function select_next_item(menu, down, tr0) {
		select_item(menu, next_valid_item(menu, down, tr0))
	}

	function activate_submenu(tr) {
		let submenu = show_submenu(tr)
		if (!submenu)
			return
		submenu.focus()
		select_next_item(submenu)
		return true
	}

	function click_item(tr) {
		let item = tr.item
		if ((item.action || item.checked != null) && !item.disabled) {
			if (item.checked != null) {
				item.checked = !item.checked
				update_check(tr)
			}
			if (!item.action)
				return true
			if (item.confirm && !confirm(item.confirm))
				return false
			return item.action(item) != false
		}
	}

	// mouse bindings

	function item_pointerdown(ev) {
		return this.capture_pointer(ev, null, function() {
			if (click_item(this))
				return e.close()
		})
	}

	function item_pointerenter(ev) {
		if (this.submenu_table)
			return // mouse entered on the submenu.
		this.parent.focus()
		select_item(this.parent, this)
		show_submenu(this)
	}

	function separator_pointerenter(ev) {
		select_item(this.parent)
	}

	// keyboard binding

	function menu_keydown(key) {
		if (key == 'ArrowUp' || key == 'ArrowDown') {
			select_next_item(this, key == 'ArrowDown', this.selected_item_tr)
			return false
		}
		if (key == 'ArrowRight') {
			if (this.selected_item_tr)
				activate_submenu(this.selected_item_tr)
			return false
		}
		if (key == 'ArrowLeft') {
			if (this.parent_menu) {
				this.parent_menu.focus()
				hide_submenu(this.parent.parent)
			}
			return false
		}
		if (key == 'Home' || key == 'End') {
			select_next_item(this, key == 'Home')
			return false
		}
		if (key == 'PageUp' || key == 'PageDown') {
			select_next_item(this, key == 'PageUp')
			return false
		}
		if (key == 'Enter' || key == ' ') {
			let tr = this.selected_item_tr
			if (tr) {
				let submenu_activated = activate_submenu(tr)
				if (click_item(tr) && !submenu_activated)
					e.close(true)
			}
			return false
		}
		if (key == 'Escape') {
			if (this.parent_menu) {
				this.parent_menu.focus()
				hide_submenu(this.parent.parent)
			} else
				e.close(true)
			return false
		}
	}

})

/* <tabs> --------------------------------------------------------------------


*/

css('.tabs', 'S v flex')

css('tabs-header', 'h rel bg1')

css('tabs-box', 'S h rel shrinks clip')

css('tabs-fixed-header', 'S h-m')

css('.tabs[tabs_side=left ]', 'h-l')
css('.tabs[tabs_side=right]', 'h-r')

css('.tabs[tabs_side=left ] > tabs-header', 'v')
css('.tabs[tabs_side=right] > tabs-header', 'v')
css('.tabs[tabs_side=left ] > tabs-header > tabs-box', 'v')
css('.tabs[tabs_side=right] > tabs-header > tabs-box', 'v')

css('.tabs[tabs_side=bottom] > tabs-header', 'order-1')
css('.tabs[tabs_side=right ] > tabs-header', 'order-1')

css('.tabs[tabs_side=top   ] > tabs-header', 'b-b')
css('.tabs[tabs_side=bottom] > tabs-header', 'b-t')
css('.tabs[tabs_side=left  ] > tabs-header', 'b-r')
css('.tabs[tabs_side=right ] > tabs-header', 'b-l')

css('tabs-content', 'scroll-auto shrinks')

css('tabs-tab', 'rel label arrow h shrinks')

// reset focusable-items states.
css_state('tabs-tab', 'no-bg')
css_state('tabs-tab.selected', 'fg')
css_state('tabs-tab.tab-selected', 'fg')
css_state('tabs-tab:is(:hover)', 'label-hover')

css('tabs-title', 'noselect nowrap p-x-4', `
	padding-top    : .6em;
	padding-bottom : .4em;
	max-width: 10em;
`)

// make height stable when there are no tabs.
css('.tabs:is([tabs_side=top],[tabs_side=bottom]) > tabs-header tabs-box::before', 'zwsp', `
	padding-top    : .6em;
	padding-bottom : .4em;
`)

// header "+" button
css_role('.tabs-add-button', 'm0')

// tab "x" button
css('tabs-xbutton', 'abs dim arrow small w1 invisible', `
	top: 2px;
	right: calc(4px - var(--space-1));
`)
css('tabs-xbutton::before', 'fa fa-times')
css_state('tabs-tab:hover tabs-xbutton', 'visible')
css_state('tabs-xbutton:hover', 'fg')

// selection bar
css('tabs-selection-bar', 'abs bg-link', `
	width: 2px;
	height: 2px;
`)

// tab moving
css_state('.tabs.moving > tabs-header tabs-selection-bar', 'hidden')
css_state('.tabs:not(.moving) > tabs-header tabs-selection-bar', '', `
	transition: width .15s, height .15s, left .15s, top .15s;
`)

// tab renaming
css_state('tabs-tab.renaming', 'bg0 fg', `min-width: 6em;`)
css_state('tabs-tab.renaming tabs-title', 'no-outline nowrap')
css_state('tabs-tab.renaming::before', 'overlay click-through', `
	content: '';
	border: 2px dashed var(--fg-link);
`)

G.tabs = component('tabs', 'Containers', function(e) {

	e.class('tabs')
	e.make_disablable()

	let html_items = e.make_items_prop()

	e.fixed_header = html_items.find(e => e.tag == 'tabs-fixed-header')
	if (e.fixed_header)
		html_items.remove_value(e.fixed_header)

	e.prop('tabs_side', {type: 'enum',
			enum_values: 'top bottom left right', default: 'top', attr: true})

	e.prop('auto_focus', {type: 'bool', default: true})

	e.prop('header_width', {type: 'number'})

	e.prop('selected_item_id', {type: 'id'})

	e.prop('can_rename_items', {type: 'bool', default: false})
	e.prop('can_add_items'   , {type: 'bool', default: false})
	e.prop('can_remove_items', {type: 'bool', default: false})
	e.prop('can_move_items'  , {type: 'bool', default: false})

	// view -------------------------------------------------------------------

	e.selection_bar = tag('tabs-selection-bar')
	e.add_button = button({
		classes: 'tabs-add-button',
		icon: 'fa fa-plus',
		bare: true,
	}).hide()
	e.tabs_box = tag('tabs-box')
	e.tabs_box.make_list_items_focusable()
	e.tabs_box.make_list_items_movable(false)
	e.header = tag('tabs-header', 0,
		e.tabs_box, e.selection_bar, e.fixed_header, e.add_button)
	e.content = tag('tabs-content', {class: 'x-container'})
	e.add(e.header, e.content)
	e.add_button.on('click', add_button_click)

	e.make_focusable(e.tabs_box)

	function item_label(item) {
		return item._label || item.attr('label')
	}

	function item_label_changed() {
		if (!this._tab) return
		update_tab_title(this._tab) // TODO: defer this
	}

	function update_tab_title(tab) {
		let label = item_label(tab.item)
		tab.title_box.set(TC(label))
		tab.title_box.title = tab.title_box.textContent
	}

	let selected_tab, renaming_tab

	function update_selected_tab_state(selected) {
		let tab = selected_tab
		if (!tab) return
		tab.xbutton.hidden = !e.can_remove_items
		tab.class('tab-selected', !!selected)
	}

	function update_renaming_tab_state(on) {
		let tab = renaming_tab
		if (!tab) return
		e.class('renaming', on)
		tab.class('renaming', on)
		tab.title_box.contenteditable = on
		tab.title_box.sx = 0
	}

	e.on_update(function(opt) {

		if (opt.items) {
			for (let tab of e.tabs_box.at) {
				let item = tab.item
				if (item && item._removed) {
					item.on('label_changed', item_label_changed, false)
					item._tab = null
					item._tabs = null
				}
			}
			e.tabs_box.innerHTML = null // reappend items without rebinding them.
			for (let item of e.items) {
				if (item._tabs != e) {
					let xbutton = tag('tabs-xbutton')
					xbutton.hidden =  !e.can_remove_items
					let title_box = tag('tabs-title')
					let tab = tag('tabs-tab', 0, title_box, xbutton)
					tab.tabs = e
					tab.title_box = title_box
					tab.xbutton = xbutton
					tab.on('pointerdown'      , tab_pointerdown)
					tab.on('click'            , tab_click)
					tab.on('dblclick'         , tab_dblclick)
					title_box.on('input'      , tab_title_box_input)
					title_box.on('blur'       , tab_title_box_blur)
					title_box.on('keydown'    , tab_title_box_keydown)
					title_box.on('pointerdown', tab_title_box_pointerdown)
					xbutton.on('pointerdown', xbutton_pointerdown)
					tab.item = item
					item._tab = tab
					item._tabs = e
					item.on('label_changed', item_label_changed)
					update_tab_title(tab)
					item._tab.x = null
					e.tabs_box.add(tab)
				} else {
					e.tabs_box.append(item._tab)
				}
			}
		}

		e.header.w = e.header_width

		e.content.set(selected_item)

		let new_selected_tab = selected_item && selected_item._tab
		let selected_tab_changed = selected_tab != new_selected_tab
		if (selected_tab_changed) {
			if (selected_tab)
				update_selected_tab_state(false)
			selected_tab = new_selected_tab
		}
		update_selected_tab_state(true)

		if (selected_tab_changed)
			e.tabs_box.focus_item(selected_tab ? selected_tab.index : false)

		let new_renaming_tab = renaming_item && renaming_item._tab
		let renaming_tab_changed = renaming_tab != new_renaming_tab
		if (renaming_tab_changed) {
			if (renaming_tab) {
				renaming_tab.title_box.trim_inner_html()
				update_renaming_tab_state(false)
			}
			renaming_tab = new_renaming_tab
		}
		update_renaming_tab_state(true)

		if (renaming_tab_changed && renaming_tab) {
			renaming_tab.title_box.focus()
			renaming_tab.title_box.select_all()
		} else if (opt.focus_content) {
			e.content.focus_first()
		} else if (opt.focus_tabs) {
			e.tabs_box.focus()
		}

	})

	// selection bar positioning

	let tr, cr

	e.on_measure(function() {
		tr = e.tabs_box.rect()
		cr = selected_tab && selected_tab.at[0].rect()
	})

	e.on_position(function() {
		let b = e.selection_bar
		if (e.tabs_side == 'left') {
			b.x1 = null
			b.x2 = 0
			b.y1 = cr ? cr.y - tr.y : 0
			b.y2 = null
			b.w  = null
			b.h  = cr ? cr.h : 0
		} else if (e.tabs_side == 'right') {
			b.x1 = 0
			b.x2 = null
			b.y1 = cr ? cr.y - tr.y : 0
			b.y2 = null
			b.w  = null
			b.h  = cr ? cr.h : 0
		} else if (e.tabs_side == 'top') {
			b.x1 = cr ? cr.x - tr.x : 0
			b.x2 = null
			b.y1 = null
			b.y2 = 0
			b.w  = cr ? cr.w : 0
			b.h  = null
		} else if (e.tabs_side == 'bottom') {
			b.x1 = cr ? cr.x - tr.x : 0
			b.x2 = null
			b.y1 = 0
			b.y2 = null
			b.w  = cr ? cr.w : 0
			b.h  = null
		}
		b.hidden = !selected_tab
	})

	e.on('resize', function() {
		e.position()
	})

	// url-based selected item ------------------------------------------------

	function url_path_level() {
		let parent = e.parent
		let i = 0
		while (parent && parent.initialized) {
			i += parent.hasclass('tabs')
			parent = parent.parent
		}
		return i
	}

	function item_slug(item) {
		let s = item.slug || item_label(item) || ''
		return s.replace(/[\- ]/g, '-').lower()
	}

	function url_path_item() {
		let p = url_parse(location.pathname).segments.splice(2)
		let slug = p[url_path_level()]
		for (let item of e.items)
			if (slug == item_slug(item))
				return item
	}

	// config -----------------------------------------------------------------

	e.set_can_rename_items = function(v) {
		if (!v) {
			set_renaming(false)
			renaming_tab = null
		}
	}

	e.set_can_add_items = function(v) {
		e.add_button.hidden = !v
	}

	e.set_can_move_items = function(v) {
		e.tabs_box.list_can_drag_elements = v
		e.tabs_box.list_can_move_elements = v
	}

	// selected item ----------------------------------------------------------

	let selected_item = null

	function select_item(item, focus_content) {
		if (selected_item == item)
			return
		set_renaming(false)
		selected_item = item
		e.update()
		focus_content = item && focus_content != false && e.auto_focus || false
		e.update({focus_content: focus_content})
	}

	function find_selected_item() {
		return selected_item && e.items.find(item => item == selected_item)
			|| e.selected_item_id && e.items.find(item => item.id == e.selected_item_id)
	}

	e.set_items = function() {
		select_item(find_selected_item() || url_path_item() || e.items[0] || null)
	}

	e.select_item = function(...args) {
		select_item(...args)
	}

	// tab moving -------------------------------------------------------------

	e.tabs_box.on('allow_drag', function() {
		return !renaming_item
	})

	e.tabs_box.on('start_drag', function() {
		e.class('moving', true)
	})

	e.tabs_box.on('stop_drag', function() {
		e.class('moving', false)
	})

	e.tabs_box.on('drop', function() {
		let items = []
		for (let tab of e.tabs_box.at)
			if (tab.item)
				items.push(tab.item)
		e.items = items
	})

	// tab renaming -----------------------------------------------------------

	let renaming_item

	function set_renaming(item) {
		renaming_item = item || null
		e.update()
	}

	function tab_pointerdown(ev, mx, my) {
		select_item(this.item, false)
	}

	function tab_click(ev, mx, my) {
		if (e.auto_focus)
			e.update({focus_content: true})
	}

	function tab_dblclick(ev, mx, my) {
		if (e.can_rename_items) {
			set_renaming(this.item)
			return false
		}
	}

	function tab_title_box_input() {
		renaming_tab.item.label = renaming_tab.title_box.innerText
		e.position()
	}

	function tab_title_box_blur(ev) {
		if (ev.relatedTarget && this.contains(ev.relatedTarget))
			return
		set_renaming(false)
	}

	function tab_title_box_pointerdown(ev) {
		if (renaming_item == this.parent.item)
			ev.stopPropagation() // prevent list focusing while editing
	}

	function tab_title_box_keydown(key, shift, ctrl, alt, ev) {
		if (!renaming_item)
			return
		if ((ctrl || shift) && key == 'Enter') {
			// NOTE: browsers don't put the caret after an ending <br> so we must hack!
			if (!(this.last_node && this.last_node.tag == 'br') && this.is_caret_at_text_end())
				this.insert_at_caret('<br>')
			this.insert_at_caret('<br>')
			return false
		}
		if (key == 'Enter' || key == 'Escape' || key == 'F2') {
			set_renaming(false)
			e.update({focus_tabs: true})
			return false
		}
		ev.stopPropagation() // prevent list navigation while editing
	}

	// tab adding -------------------------------------------------------------

	e.create_item = noop // stub

	e.add_item = function(item, i, focus_content) {
		item = item || e.create_item()
		if (!item)
			return
		e.items = e.items.slice().insert(i, item)
		select_item(item, focus_content)
		return item
	}

	function add_button_click() {
		if (e.add_item())
			return false
	}

	// tab removing -----------------------------------------------------------

	e.can_remove_item = return_true // stub
	e.free_item = noop // stub

	e.remove_item = function(item, animated, focus_content) {
		if (animated) {
			let tab = item._tab
			if (tab) {
				let pr = tab.rect()
				let horiz = e.tabs_box.css('flexDirection') == 'row'
				tab.w = pr.w
				tab.h = pr.h
				tab.animate(
					[horiz ? {'width': '0px'} : {'height': '0px'}],
					{duration: 100, easing: 'ease-out'}
				).onfinish = function() {
					e.remove_item(item, null, focus_content)
					tab.w = null
					tab.h = null
				}
				return
			}
		}
		e.free_item(item)
		let new_items = e.items.slice()
		let item_index = new_items.remove_value(item)
		let next_item = e.items[item_index+1] || e.items[item_index-1]
		let next_selected_item = selected_item == item ? next_item : selected_item
		e.items = new_items
		select_item(next_selected_item, focus_content)
		e.tabs_box.focus_item(next_item ? e.items.indexOf(next_item) : false)
	}

	function xbutton_pointerdown() {
		let tab = this.parent
		let item = tab.item
		if (e.can_remove_item(item)) {
			this.hide()
			e.remove_item(item, true)
			return false
		}
	}

	// key bindings -----------------------------------------------------------

	e.tabs_box.on('keydown', function(key, shift, ctrl) {
		let tab = this.focused_item
		if (!tab)
			return

		// select tab
		if (key == ' ' || key == 'Enter') {
			select_item(tab.item, false)
			return false
		}

		// enter tab renaming
		if (e.can_rename_items && key == 'F2') {
			set_renaming(tab.item)
			return false
		}

		// add tab
		if (key == 'Insert' && e.can_add_items) {
			let i = this.focused_item_index
			if (e.add_item(null, i, false))
				return false
		}

		// remove tab
		if (key == 'Delete' && e.can_remove_items) {
			if (e.can_remove_item(tab.item)) {
				e.remove_item(tab.item, true, false)
				return false
			}
		}

	})

	e.on('keydown', function(key, shift, ctrl) {
		if (ctrl && key == 'T' && e.can_add_items) {
			let i = e.tabs_box.focused_item_index
			if (e.add_item(null, i, false))
				return false
		}
		if (ctrl && key == 'W' && e.can_remove_items) {
			let item = e.tabs_box.focused_item
			if (item && e.can_remove_item(item)) {
				e.remove_item(item, true, false)
				return false
			}
		}
	})

	return {items: html_items}

})

/* <split> & <vsplit> --------------------------------------------------------



*/

css('.split', 'S')
css('.split[orientation=horizontal]', 'h')
css('.split[orientation=vertical  ]', 'v')

css('.split-pane-auto', 'S shrinks')

css('split-sizer', 'h-c h-m', `
	background-color: var(--border-light);
`)
css('.split[orientation=vertical  ] > split-sizer', 'h', ` height: 1px; `)
css('.split[orientation=horizontal] > split-sizer', 'h', ` width : 1px; `)

css_state('.split[orientation=horizontal].resize', '', ` cursor: ew-resize; `)
css_state('.split[orientation=vertical  ].resize', '', ` cursor: ns-resize; `)

css_state('.split[orientation=horizontal] > split-pane.collapsed', '', `
	min-width: 0 !important;
	width: 0 !important;
`)
css_state('.split[orientation=vertical  ] > split-pane.collapsed', '', `
	min-height: 0 !important;
	height: 0 !important;
`)

css_state('.split.resize > split-sizer', '', `
	background-color: var(--border-light-hover);
	transition: background-color .2s;
`)

css('.split.collapsed > split-sizer::before', '', `
	content: '';
	box-sizing: border-box;
	border: 1px var(--fg-dim);
`)

css('.split.collapsed > split-sizer::before', '', `
	position: fixed; /* show over contents */
`)

css_state('.split[orientation=horizontal].collapsed > split-sizer::before', '', `
	min-width: 4px;
	height: 24px;
	border-style: none solid;
`)
css_state('.split[orientation=vertical  ].collapsed > split-sizer::before', '', `
	min-height: 4px;
	width: 24px;
	border-style: solid none;
`)

G.split = component('split', 'Containers', function(e) {

	e.class('split')
	e.make_disablable()

	e.init_child_components()
	let html_item1 = e.at[0]
	let html_item2 = e.at[1]
	e.clear()

	e.pane1 = tag('split-pane', {class: 'x-container'})
	e.pane2 = tag('split-pane', {class: 'x-container'})
	e.sizer = tag('split-sizer')
	e.add(e.pane1, e.sizer, e.pane2)

	e.prop('item1', {type: 'node', convert: element})
	e.prop('item2', {type: 'node', convert: element})

	let horiz, left

	e.widget_placeholder = () => div() // stub

	e.on_update(function() {

		e.xoff()
		if (!e.item1) e.item1 = e.widget_placeholder()
		if (!e.item2) e.item2 = e.widget_placeholder()
		e.xon()

		e.pane1.set(e.item1)
		e.pane2.set(e.item2)

		horiz = e.orientation == 'horizontal'
		left = e.fixed_side == 'first'
		e.fixed_pane = left ? e.pane1 : e.pane2
		e.auto_pane  = left ? e.pane2 : e.pane1
		e.fixed_pane.class('split-pane-fixed')
		e.fixed_pane.class('split-pane-auto', false)
		e.auto_pane.class('split-pane-auto')
		e.auto_pane.class('split-pane-fixed', false)
		e.class('resizeable', e.resizeable)
		e.sizer.hidden = !e.resizeable
		e.fixed_pane[horiz ? 'h' : 'w'] = null
		e.fixed_pane[horiz ? 'w' : 'h'] = e.fixed_size
		e.auto_pane.w = null
		e.auto_pane.h = null
		e.fixed_pane[horiz ? 'min_h' : 'min_w'] = null
		e.fixed_pane[horiz ? 'min_w' : 'min_h'] = e.min_size
		e.auto_pane.min_w = null
		e.auto_pane.min_h = null

		announce('layout_changed')
	})

	e.prop('orientation', {type: 'enum', enum_values: 'horizontal vertical', default: 'horizontal', attr: true})
	e.prop('fixed_side' , {type: 'enum', enum_values: 'first second', default: 'first', attr: true})
	e.prop('resizeable' , {type: 'bool', default: true, attr: true})
	e.prop('fixed_size' , {type: 'number', default: 200, attr: true, slot: 'user'})
	e.prop('min_size'   , {type: 'number', default: 0})

	// resizing ---------------------------------------------------------------

	let hit, hit_x, mx0, w0

	e.on('pointermove', function(ev, rmx, rmy) {
		if (e.pointer_captured)
			return
		if (!e.fixed_pane) // pointermove arrived before first animation frame
			return
		hit = false
		if (e.rect().contains(rmx, rmy)) {
			// ^^ mouse is not over some scrollbar.
			let mx = horiz ? rmx : rmy
			let sr = e.sizer.rect()
			let sx1 = horiz ? sr.x1 : sr.y1
			let sx2 = horiz ? sr.x2 : sr.y2
			w0 = e.fixed_pane.rect()[horiz ? 'w' : 'h']
			hit_x = mx - sx1
			hit = abs(hit_x - (sx2 - sx1) / 2) <= 5
			mx0 = mx
		}
		e.class('resize', hit)
		if (hit)
			return false
	})

	e.on('pointerleave', function(ev) {
		if (e.pointer_captured)
			return
		hit = false
		e.class('resize', hit)
	})

	function mm_resize(ev, rmx, rmy) {
		let mx = horiz ? rmx : rmy
		let w
		if (left) {
			let fpx1 = e.fixed_pane.rect()[horiz ? 'x' : 'y']
			w = mx - (fpx1 + hit_x)
		} else {
			let ex2 = e.rect()[horiz ? 'x2' : 'y2']
			let sw = e.sizer.rect()[horiz ? 'w' : 'h']
			w = ex2 - mx + hit_x - sw
		}

		if (!e.fixed_pane.hasclass('collapsed')) {
			if (w < min(max(e.min_size, 20), 30) - 5) {
				e.fixed_pane.class('collapsed', true)
				e.class('collapsed', true)
			}
		} else {
			if (w > max(e.min_size, 30)) {
				e.fixed_pane.class('collapsed', false)
				e.class('collapsed', false)
			}
		}

		w = max(w, e.min_size)
		if (e.fixed_pane.hasclass('collapsed'))
			w = 0

		e.fixed_size = round(w)
	}

	function mu_resize() {
		e.class('resizing', false)
		e.xsave()
	}

	e.on('pointerdown', function(ev) {
		if (!hit)
			return
		e.class('resizing')
		return this.capture_pointer(ev, mm_resize, mu_resize)
	})

	return {
		item1: html_item1,
		item2: html_item2,
	}

})

G.vsplit = component('vsplit', function(e) {
	e.class('vsplit')
	let opt = split.construct(e)
	opt.orientation = 'vertical'
	return opt
})

/* <action-band> -------------------------------------------------------------

in props:
	layout      'NAME[:ok|primary|cancel] ... < ... > ...'
out props:
	buttons.NAME -> b
methods:
	ok()
	cancel()

*/

css('.action-band', 'S h-r h-m gap-x')
css('.action-band .button-text', 'nowrap')

// hide cancel button icon unless space is tight when text is hidden
css('.action-band:not(.tight) .dlg-button-cancel .button-icon', 'hidden')

css('.action-band-center', 'S h-c gap-x')

G.action_band = component('action-band', 'Input', function(e) {

	e.make_disablable()
	e.class('action-band')
	e.layout = 'ok:ok cancel:cancel'

	e.on_init(function() {
		let ct = e
		for (let s of e.layout.words()) {
			if (s == '<') {
				ct = div({class: 'action-band-center'})
				e.add(ct)
				continue
			} else if (s == '>') {
				// TODO: align right
				ct = e
				continue
			}
			s = s.split(':')
			let name = s.shift()
			let spec = new Set(s)
			let bname = name.replaceAll('-', '_').replace(/[^\w]/g, '')
			let b = e.buttons && e.buttons[bname]
			let b_sets_text = true
			if (!(isnode(b))) {
				if (typeof b == 'function')
					b = {action: b}
				else
					b = assign_opt({}, b)
				if (spec.has('primary') || spec.has('ok'))
					b.primary = true
				b_sets_text = b.text != null
				b = button(b)
				e.buttons[bname] = b
			}
			b.class('dlg-button-'+name)
			b.dialog = e
			if (!b_sets_text) {
				b.text = S(bname, name.replace(/[_\-]/g, ' '))
				b.style['text-transform'] = 'capitalize'
			}
			if (name == 'ok' || spec.has('ok')) {
				b.on('click', function() {
					e.ok()
				})
			}
			if (name == 'cancel' || spec.has('cancel')) {
				b.on('click', function() {
					e.cancel()
				})
			}
			ct.add(b)
		}
	})

	e.ok = function() {
		e.fire('ok')
	}

	e.cancel = function() {
		e.fire('cancel')
	}

})

/* <dlg> aka modal dialog box ------------------------------------------------

in props:
	cancelable
	buttons
	buttons_layout
	heading header content footer
inner html:
	<heading> -> heading
	<header>  -> header
	<content> -> content
	<footer>  -> footer
methods:
	close([ok])
	cancel()
	ok()

*/

css('.dlg', 'rel v p-4 fg b0 ro bg1', `
	margin: 20px;
	box-shadow: var(--shadow-modal);
`)

css('.dlg-header' , 'm-b-2')
css('.dlg-footer' , 'm-t-2')
css('.dlg-content', 'm-y-2')

css('.dlg-heading', 'dim xlarge bold')

css_light('', '', `--stroke-dialog-xbutton : #00000066;`)
css_dark ('', '', `--stroke-dialog-xbutton : #000000cc;`)

css('.dlg-xbutton', 'abs ro-var b b-t-0 h-c h-m', `
	right: 8px;
	top: 0px;
	width: 52px;
	height: 18px;
	color: var(--fg-button);
	-webkit-text-stroke: 1px var(--stroke-dialog-xbutton);
`)
css('.dlg-xbutton::before', 'fa fa-times')

css_state('.dlg-xbutton:hover', '', `
	background-color: var(--bg-button-hover);
`)

css_state('.dlg-xbutton.active', '', `
	background-color: var(--bg-button-active);
`)

css('.dlg-content', 'S shrinks')

css('.dlg-footer', 'h-b')

G.dlg = component('dlg', function(e) {

	e.class('dlg')
	e.init_child_components()

	let html_heading = e.$1('heading')
	let html_header  = e.$1('header' )
	let html_content = e.$1('content')
	let html_footer  = e.$1('footer' )

	e.prop('heading'        , {attr: true}) // because title is taken
	e.prop('cancelable'     , {type: 'bool', attr: true, default: true})
	e.prop('buttons'        , {})
	e.prop('buttons_layout' , {})

	e.prop('header' , {type: 'nodes'})
	e.prop('content', {type: 'nodes'})
	e.prop('footer' , {type: 'nodes'})

	e.on_update(function() {

		e.clear()

		e._header  = e.header
		e._content = e.content
		e._footer  = e.footer || div()

		if (!e.header)
			if (e.heading) {
				e._heading = e._heading || div()
				e._header = e._header || div()
				e._header.set(e._heading)
				e._heading.set(e.heading)
			} else if (e._header)
				e._header.hide()

		if (!e.footer)
			if (e.buttons || e.buttons_layout) {
				e._footer = e._footer || div()
				e._footer.set(action_band({
					layout: e.buttons_layout,
					buttons: e.buttons,
				}))
			} else if (e._footer)
				e._footer.hide()

		if (e._heading ) e._heading .class('dlg-heading')
		if (e._header  ) e._header  .class('dlg-header')
		if (e._content ) e._content .class('dlg-content')
		if (e._footer  ) e._footer  .class('dlg-footer')

		if (e.cancelable && !e.x_button) {
			e.x_button = div({class: 'dlg-xbutton'})
			e.x_button.on('click', function() {
				e.cancel()
			})
			e.add(e.x_button)
		}
		if (e.x_button)
			e.x_button.show(e.cancelable)

		e.add(e._header, e._content, e._footer, e.x_button)

	})

	e.on_bind(function(on) {
		document.on('keydown', doc_keydown, on)
		document.on('keyup', doc_keyup, on)
		document.on('pointerdown', doc_pointerdown, on)
	})

	function doc_keydown(key) {
		if (key == 'Escape') {
			if (e.cancelable && e.x_button) {
				e.x_button.class('active', true)
				return false
			} else {
				if (e.cancel())
					return false
			}
		}
	}

	function doc_keyup(key) {
		if (key == 'Escape') {
			if (e.cancelable && e.x_button && e.x_button.hasclass('active')) {
				e.x_button.class('active', false)
				if (e.cancel())
					return false
			}
		}
	}

	function doc_pointerdown(ev) {
		if (e.contains(ev.target)) // clicked inside the dialog
			return
		e.cancel()
		return false
	}

	e.on('keydown', function(key) {
		if (key == 'Enter') {
			e.ok()
			return false
		}
	})

	e.close = function(ok) {
		e.modal(false)
		if (e.x_button)
			e.x_button.class('active', false)
		e.fire('close', ok != false)
	}

	e.cancel = function() {
		if (!e.cancelable) {
			e.animate([{transform: 'scale(1.05)'}], {duration: 100})
			return false
		}
		e.close(false)
		return true
	}

	e.ok = function() {
		for (let btn of e.$('.button[primary]')) {
			if (!(btn.effectively_hidden || btn.effectively_disabled)) {
				btn.click()
				return true
			}
		}
		return false
	}

	return {
		heading : html_heading,
		header  : html_header,
		content : html_content,
		footer  : html_footer,
	}

})

/* <toolbox> -----------------------------------------------------------------

in props:
	px py pw ph pinned
	content
	text
inner htnl:
	-> content

*/

// z1: menu = 4, picker = 3, tooltip = 2, toolbox = 1
css('.toolbox', 'z1 v scroll-auto b0 bg1 ro shadow-toolbox op02 ease ease-05s')

css_state('.toolbox[pinned], .toolbox:hover', 'op1 no-ease')

css('.toolbox-titlebar', 'h-m bold p-x-2 p-y-05 gap-2 noselect', `
	background : var(--bg-unfocused-selected);
	color      : var(--fg-unfocused-selected);
	cursor: move;
`)

css_state('.toolbox:focus-within > .toolbox-titlebar', '', `
	background : var(--bg-focused-selected);
	color      : var(--fg-focused-selected);
`)

css('.toolbox-title', 'S shrinks nowrap-dots click-through')

css('.toolbox-btn', 'dim-on-dark arrow')
css('.toolbox-btn-pin', 'small rotate-45')
css('.toolbox-btn-pin::before', 'fa fa-thumbtack')
css('.toolbox-btn-close::before', 'fa fa-times')
css_state('.toolbox[pinned] > .toolbox-titlebar > .toolbox-btn-pin', 'label-on-dark rotate-0')
css_state('.toolbox-btn:hover', 'white')

css('.toolbox-content', 'h shrinks scroll-auto')

// toolbox resizing by dragging the margins

css('.toolbox-resize-overlay', 'overlay', `
	clip-path: polygon(
		0 0, 0 100%, 100% 100%, 100% 0, 0 0, /* outer rect, counter-clockwise */
		5px 5px, calc(100% - 5px) 5px, calc(100% - 5px) calc(100% - 5px), 5px calc(100% - 5px), 5px 5px /* inner rect, clockwise */
	);
`)

css('.toolbox-resize-overlay[hit_side=top      ], .toolbox-resize-overlay[hit_side=bottom      ]', '', ` cursor: ns-resize  ; `)
css('.toolbox-resize-overlay[hit_side=left     ], .toolbox-resize-overlay[hit_side=right       ]', '', ` cursor: ew-resize  ; `)
css('.toolbox-resize-overlay[hit_side=top_left ], .toolbox-resize-overlay[hit_side=bottom_right]', '', ` cursor: nwse-resize; `)
css('.toolbox-resize-overlay[hit_side=top_right], .toolbox-resize-overlay[hit_side=bottom_left ]', '', ` cursor: nesw-resize; `)

G.toolbox = component('toolbox', function(e) {

	let html_content = [...e.nodes]
	e.clear()

	e.class('toolbox')

	e.props.popup_align = {default: 'top'}
	e.props.popup_side  = {default: 'inner-top'}
	e.popup()

	e.istoolbox = true
	e.class('pinned')

	e.pin_button     = div({class: 'toolbox-btn toolbox-btn-pin'})
	e.xbutton        = div({class: 'toolbox-btn toolbox-btn-close'})
	e.title_box      = div({class: 'toolbox-title'})
	e.titlebar       = div({class: 'toolbox-titlebar'}, e.title_box, e.pin_button, e.xbutton)
	e.content_box    = div({class: 'toolbox-content x-container'})
	e.resize_overlay = div({class: 'toolbox-resize-overlay'})
	e.add(e.titlebar, e.content_box, e.resize_overlay)

	e.alias('target', 'popup_target')
	e.alias('align' , 'popup_align')
	e.alias('side'  , 'popup_side')

	e.prop('px'    , {type: 'number', slot: 'user', default: 0})
	e.prop('py'    , {type: 'number', slot: 'user', default: 0})
	e.prop('pw'    , {type: 'number', slot: 'user'})
	e.prop('ph'    , {type: 'number', slot: 'user'})
	e.prop('pinned', {type: 'bool'  , slot: 'user', default: true, attr: true})

	e.set_px = (x) => e.popup_ox = x
	e.set_py = (y) => e.popup_oy = y
	e.set_pw = (w) => e.w = w
	e.set_ph = (h) => e.h = h

	e.prop('content', {type: 'nodes'})

	e.prop('text', {slot: 'lang'})

	function focus() {
		e.index = 1/0 // move to top
		e.focus()
	}

	e.on('focusin', function(ev) {
		e.index = 1/0 // move to top
		ev.target.focus() // because changing index stops the focusing.
	})

	e.on_update(function(opt) {
		e.title_box.set(e.text)
		e.content_box.set(e.content)
	})

	let hit_side
	function hit_test(mx, my) {
		hit_side = e.resize_overlay.hit_test_sides(mx, my)
		e.resize_overlay.attr('hit_side', hit_side)
	}

	let down
	e.resize_overlay.on('pointermove', function(ev, mx, my) {
		if (down)
			return
		hit_test(mx, my)
	})

	e.resize_overlay.on('pointerdown', function(ev, mx, my) {

		if (!hit_side)
			return

		down = true

		let r = e.rect()
		let mx0 = mx
		let my0 = my

		focus()

		let px0 = e.px
		let py0 = e.py

		return this.capture_pointer(ev, function(ev, mx, my) {
			let dx = mx - mx0
			let dy = my - my0
			let x1 = px0
			let y1 = py0
			let x2 = x1 + r.w
			let y2 = y1 + r.h
			if (hit_side.includes('top'   )) y1 += dy
			if (hit_side.includes('bottom')) y2 += dy
			if (hit_side.includes('right' )) x2 += dx
			if (hit_side.includes('left'  )) x1 += dx
			let w = x2 - x1
			let h = y2 - y1
			e.px = x1
			e.py = y1
			e.pw = w
			e.ph = h
		}, function(ev, mx, my) {
			down = false
			e.xsave()
			hit_test(mx, my)
		})

	},)

	e.titlebar.on('pointerdown', function(ev, mx, my) {

		if (ev.target != e.titlebar)
			return

		down = true

		focus()

		let px0 = e.px
		let py0 = e.py

		return this.capture_pointer(ev, function(ev, mx, my, mx0, my0) {
			e.update({input: e})
			e.px = px0 + mx - mx0
			e.py = py0 + my - my0
		}, function(ev, mx, my) {
			down = false
			let first_focusable = e.content_box.focusables()[0]
			if (first_focusable)
				first_focusable.focus()
			hit_test(mx, my)
		})

	})

	e.xbutton.on('pointerup', function() {
		e.hide()
		return false
	})

	e.pin_button.on('pointerup', function() {
		e.pinned = !e.pinned
		e.xsave()
		return false
	})

	e.on('resize', function() {
		announce('layout_changed')
	})

	return {content: html_content}

})

/* <slides> ------------------------------------------------------------------

in attrs:
	current current_index
in props:
	current_id current_index
out props:
	current_slide

*/

css('.slides', 'g-h')
css('.slide', 'x1 y1')
css('.slides > .x-ct > .', 'x1 y1')

css_state('.slide'        , 'invisible op0 click-through     ease-05s')
css_state('.slide-current', 'visible   op1 click-through-off ease-05s')

G.slides = component('slides', 'Containers', function(e) {

	e.class('slides')
	e.make_disablable()
	let html_items = e.make_items_prop()

	// model

	e.prop('current_index', {type: 'number', default: 0})
	e.prop('current_id'   , {type: 'id', attr: 'current'})

	e.property('current_slide',
		function() {
			let item
			if (e.current_id) {
				item = window[e.current_id]
				item = item && item.parent == e && item
			}
			return item || e.at[e.current_index] || e.at[0] || null
		}, function(item) {
			if (warn_if(item && item.parent != e, 'slide: invalid item'))
				return
			if (e.current_id) {
				if (warn_if(item && !item.id, 'slide: item has no id'))
					return
				e.current_id = item && item.id || null
			} else {
				e.current_index = item ? item.index : null
			}
		})

	function clamp_item(i, rollover) {
		if (e.len < 2) return 0
		if (rollover) return i % e.len
		return clamp(i, 0, e.len-1)
	}

	e.next_slide = function(rollover) {
		let e0 = e.current_slide
		let i1 = clamp_item(((e0 && e0.index) ?? -1) + 1, rollover)
		e.current_slide = e.at[i1]
	}

	e.prev_slide = function(rollover) {
		let e0 = e.current_slide
		let i1 = clamp_item(((e0 && e0.index) ?? -1) - 1, rollover)
		e.current_slide = e.at[i1]
	}

	// view

	let current_slide
	e.on_update(function(opt) {

		if (opt.items) {
			for (let item of e.at) {
				if (item._removed) {
					item.class('slide', false)
					item.class('slide-current', false)
					item._slides = null
				}
			}
			e.innerHTML = null // reappend items without rebinding them.
			for (let item of e.items) {
				if (item._slides != e) { // new item
					item._slides = e
					item.class('slide', true)
					e.add(item)
				} else { // existing item
					e.append(item)
				}
			}
		}

		let e0 = current_slide
		let e1 = e.current_slide
		if (e0 != e1) {
			if (e0)
				e0.class('slide-current', false)
			if (e1) {
				current_slide = e1
				e.fire('slide_start', e1)
				e1.class('slide-current', true)
				e1.focus_first()
				e1.once('transitionend', function() {
					e.fire('slide_end', e1)
				})
			}
		}

	})

	return {items: html_items}

})


/* <md> markdown tag ---------------------------------------------------------

inner html:
	markdown -> html

*/

css('md', 'skip')

{
let md
component('md', function(e) {

	md = md || markdownit()
	if (window.MarkdownItIndentedTable)
		md.use(MarkdownItIndentedTable)

	e.unsafe_html = md.render(e.html)
	e.init_child_components()

})
}

/* <pagenav> page navigation -------------------------------------------------

in props:
	page_size
	item_count
state:
	page
out props:
	cur_page
	page_count
	first_item
stubs:
	page_url(page) -> url
events:
	^page_changed(page)

*/

css('.pagenav', 'h-bl h-sb')
css('.pagenav-pages-box', 'h-bl')
css('.pagenav-button', 'm-x-05')
css('.pagenav-current', '')
css('.pagenav-dots', 'p-x noselect')

G.pagenav = component('pagenav', function(e) {

	e.class('pagenav')
	e.make_disablable()

	e.prop('page'      , {type: 'number', default: 1})
	e.prop('page_size' , {type: 'number', default: 100})
	e.prop('item_count', {type: 'number'})
	e.prop('bare'      , {type: 'bool', attr: true})

	e.property('cur_page'   , () => clamp(e.page || 1, 1, e.page_count))
	e.property('page_count' , () => ceil(e.item_count / e.page_size))
	e.property('first_item' , () => e.page * e.item_count)

	e.page_url = noop

	e.page_button = function(page, text, title, href) {
		let b = button({bare: e.bare})
		b.class('pagenav-button')
		b.class('pagenav-current', page == e.cur_page)
		b.disable('pagenav', !(page >= 1 && page <= e.page_count && page != e.cur_page))
		b.title = title ?? text ?? S('page', 'Page {0}', page)
		b.href = href !== false ? e.page_url(page) : null
		b.set(text ?? page)
		b.action = function() {
			e.fire('page_changed', page)
		}
		return b
	}

	e.nav_button = function(offset) {
		return e.page_button(e.cur_page + offset,
			offset > 0 ?
				S('next_page_button_text', 'Next →') :
				S('previous_page_button_text', '← Previous'),
			offset > 0 ?
				S('next_page', 'Next') :
				S('previous_page', 'Previous'),
			false
		)
	}

	e.on_update(function() {
		e.clear()
		e.add(e.nav_button(-1))
		let pages_box = div({class: 'pagenav-pages-box'})
		let n = e.page_count
		let p = e.cur_page
		let dotted
		for (let i = 1; i <= n; i++) {
			if (i == 1 || i == n || (i >= p-1 && i <= p+1)) {
				pages_box.add(e.page_button(i))
				dotted = false
			} else if (!dotted) {
				pages_box.add(div({class: 'pagenav-dots'}, unsafe_html('&mldr;')))
				dotted = true
			}
		}
		e.add(pages_box)
		e.add(e.nav_button(1))
	})

})

/* <label> -------------------------------------------------------------------

attrs/props:
	for/for_id
fires:
	^for.label_hover(on)
	^for.label_pointer{down|up}(ev)
	^for.label_click(ev)

*/

// NOTE: doesn't work as implicit label with an <input> inside because of `noselect`.
// using `label-widget` because `label` is a utility class...
css('.label-widget', 'label noselect')
css_state('.label-widget:is(:hover,.hover)', 'label-hover')

G.label = component('label', 'Input', function(e) {

	e.class('label-widget')
	e.make_disablable()

	e.alias('for_id', 'htmlFor')
	e.props.for_id = {type: 'id', attr: 'for'}

	e.property('target', function() {
		if (e.for_id)
			return window[e.for_id]
		let g = e.closest('.input-group')
		return g && g.$1('.input')
	})

	e.on('pointerenter', function() {
		let te = e.target
		if (!te) return
		te.fire('label_hover', true)
	})
	e.on('pointerleave', function() {
		let te = e.target
		if (!te) return
		te.fire('label_hover', false)
	})
	e.on('target_hover', function(on) {
		e.class('hover', on)
	})
	e.on('pointerdown', function(ev) {
		let te = e.target
		if (!te) return
		te.fire('label_pointerdown', ev)
	})
	e.on('pointerup', function(ev) {
		let te = e.target
		if (!te) return
		te.fire('label_pointerup', ev)
	})
	e.on('click', function(ev) {
		let te = e.target
		if (!te) return
		te.fire('label_click', ev)
	})
})

/* <info> text / button ------------------------------------------------------

classes:
	.info-button
props:
	collapsed
	text
styling:
	.info [collapsed]
inner html
	-> text

*/

css('.info-button', 'h-c h-m b round mono extrabold dim w1 h1 m', `
	border-width: .12em;
	border-color: var(--fg-dim);
`)
css('.info-button::before', '', ` content: 'i'; `)

css('.info', '', ` display: inline-block; `)

css('.info:not([collapsed])', 'smaller label h-bl gap-x')

// toggling visibility on hover requires click-through for stable hovering!
css('.info .tooltip:not([hidden])', 'click-through')

G.info = component('info', function(e) {

	e.class('info')
	e.make_disablable()

	let html_text = [...e.nodes]

	e.prop('collapsed', {type: 'bool', attr: true})
	e.prop('text', {type: 'nodes', slot: 'lang'})

	e.set_collapsed = function(v) {
		if (v) {
			e.btn = e.btn || div({class: 'info-button'})
			if (!e.tooltip) {
				e.tooltip = tooltip({kind: 'info', align: 'left', popup_ox: -4, target: e.btn})
				e.add(e.tooltip)
				e.tooltip.update({show: false})
				e.btn.on('hover', function(ev, on) {
					e.tooltip.update({show: on})
				})
			}
			e.tooltip.text = [...e.text]
			e.clear()
			e.add(e.btn, e.tooltip)
		} else {
			if (e.tooltip)
				e.tooltip.update({show: false})
			e.clear()
			e.add(div({class: 'info-button'}), div(0, e.text))
		}
	}

	return {
		text      : html_text,
		collapsed : e.collapsed ?? true,
	}
})

/* validators ----------------------------------------------------------------

We don't like abstractions around here but this one buys us many things:

  - validators are: reusable, composable, and easy to write logic for.
  - validators apply automatically, no need to specify which to apply where.
  - a validator can depend on, i.e. require that other validators pass first.
  - a validator can convert the input value so that subsequent validators
    operate on the converted value, thus only having to parse the value once.
  - null values are filtered automatically.
  - result containing all messages with `failed` and `checked` status on each.
  - it makes no garbage on re-validation so you can validate huge lists fast.
  - entire objects can be validated the same way simple values are, so it also
    works for validating db records, applying inter-widget constraints, etc.
  - it's not that much code for all of that.

props:
	validators
	triggered
	results
	value
	failed
	first_failed_result
methods:
	prop_changed(prop) -> needs_revalidation?
	validate([ev]) -> valid?

*/

let validators = obj()
G.validators = validators
G.INVALID = obj() // convert functions return this to distinguish from null.

let validator_props = obj()

G.add_validator = function(validator) {
	validators[validator.name] = validator
	validator. props = isstr(validator. props) && validator. props.words().tokeys() || null
	validator.vprops = isstr(validator.vprops) && validator.vprops.words().tokeys() || null
	validator.requires = words(validator.requires) || empty_array
	assign(validator_props, validator.props)
}

G.create_validator = function(e, field) {

	let my_validators_invalid = true
	let my_validators = []
	let my_vprops = obj()
	let results = []
	let checked = obj()

	function add_validator(name) {
		assert(checked[name] !== false, 'validator require cycle: {0}', name)
		if (checked[name])
			return true
		let validator = validators[name]
		if (warn_if(!validator, 'unknown validator', name))
			return
		if (!validator.applies(e, field))
			return
		checked[name] = false // means checking...
		if (!(e.id || e.name))
		for (let req of validator.requires) {
			if (!add_validator(req)) {
				checked[name] = true
				return true
			}
		}
		my_validators.push(validator)
		assign(my_vprops, validator.vprops)
		checked[name] = true
		return true
	}

	let validator = {results: results, validators: my_validators, triggered: false}

	validator.prop_changed = function(prop) {
		if (!prop || validator_props[prop]) {
			my_validators.clear()
			for (let k in my_vprops)
				my_vprops[k] = null
			for (let k in checked)
				checked[k] = null
			my_validators_invalid = true
			return true
		}
		return my_validators_invalid || my_vprops[prop] || false
	}

	function update_my_validators() {
		for (let name in validators)
			add_validator(name)
		my_validators_invalid = false
	}

	validator.validate = function(v, ann) {
		if (my_validators_invalid)
			update_my_validators()
		v = repl(v, '', null)
		let convert_failed
		for (let validator of my_validators) {
			validator._error = validator.error(e, v, field)
			validator._rule  = validator.rule (e, field)
			if (convert_failed) {
				validator._failed = true
				continue // if convert failed, subsequent validators cannot run!
			}
			if (validator._failed)
				continue
			if (validator._checked)
				continue
			if (v == null && !validator.check_null)
				continue
			for (let req of validator.requires)
				if (validators[req].failed) {
					validator._failed = true
					continue
				}
			let convert = validator.convert
			if (convert) {
				v = convert(e, v, field)
				convert_failed = v === INVALID
				v = repl(v, INVALID, null)
			}
			let failed = convert_failed || !validator.validate(e, v, field)
			validator._checked = true
			validator._failed = failed
		}
		results.len = my_validators.len
		this.failed = false
		this.first_failed_result = null
		for (let i = 0, n = my_validators.len; i < n; i++) {
			let validator = my_validators[i]
			let result = attr(results, i)
			result.checked = validator._checked || false
			result.failed  = validator._failed || false
			result.error   = validator._error
			result.rule    = validator._rule
			if (validator._failed && !this.failed) {
				this.failed = true
				this.first_failed_result = result
			}
			validator._checked = null
			validator._failed  = null
			validator._error  = null
			validator._rule   = null
		}
		this.value = this.failed ? null : repl(v, undefined, null)
		if (ann != false)
			announce('validate', e, this, field)
		this.triggered = true
		return !this.failed
	}

	return validator
}

let field_name = function(field) {
	return field.text || field.name || S('value', 'Value')
}

let field_value = function(field, v) {
	return field.to_text ? field.to_text(v) : v
}

add_validator({
	name     : 'required',
	check_null: true,
	props    : 'not_null required',
	vprops   : 'input_value',
	applies  : (e,    field) => field.not_null || field.required,
	validate : (e, v, field) => v != null || field.default != null,
	error    : (e, v, field) => S('validation_empty_error', '{0} is required', field_name(field)),
	rule     : (e,    field) => S('validation_empty_rule', '{0} is filled', field_name(field)),
})

add_validator({
	name     : 'number',
	vprops   : 'input_value',
	applies  : (e,    field) => field.is_number,
	convert  : (e, v, field) => isstr(v) ? field.to_num(v) ?? INVALID : v,
	validate : (e, v, field) => isnum(v),
	error    : (e, v, field) => S('validation_num_error',
		'{0} is not a number' , field_name(field)),
	rule     : (e,    field) => S('validation_num_rule' ,
		'{0} must be a number', field_name(field)),
})

add_validator({
	name     : 'min',
	requires : 'number',
	props    : 'min',
	vprops   : 'input_value',
	applies  : (e,    field) => field.min != null,
	validate : (e, v, field) => v >= field.min,
	error    : (e, v, field) => S('validation_min_error',
		'{0} is lower than {1}', field_name(field), field_value(field, field.min)),
	rule     : (e,    field) => S('validation_min_rule',
		'{0} must be larger than or equal to {1}', field_name(field),
			field_value(field, field.min)),
})

add_validator({
	name     : 'max',
	requires : 'number',
	props    : 'max',
	vprops   : 'input_value',
	applies  : (e,    field) => field.max != null,
	validate : (e, v, field) => v <= field.max,
	error    : (e, v, field) => S('validation_max_error',
		'{0} is larger than {1}', field_name(field), field_value(field, field.max)),
	rule     : (e,    field) => S('validation_max_rule',
		'{0} must be smaller than (or equal to) {1}', field_name(field),
			field_value(field, field.max)),
})

add_validator({
	name     : 'checked_value',
	props    : 'checked_value unchecked_value',
	vprops   : 'input_value',
	applies  : (e,    field) => field.checked_value !== undefined || field.unchecked_value !== undefined,
	validate : (e, v, field) => v == field.checked_value || v == field.unchecked_value,
	error    : (e, v, field) => S('validation_checked_value_error',
		'{0} is not {1} or {2}' , field_name(field), e.checked_value, e.unchecked_value),
	rule     : (e,    field) => S('validation_checked_value_rule' ,
		'{0} must be {1} or {2}', field_name(field), e.checked_value, e.unchecked_value),
})

add_validator({
	name     : 'range_values_valid',
	vprops   : 'invalid1 invalid2',
	applies  : (e   ) => e.is_range,
	validate : (e, v) => !e.invalid1 && !e.invalid2,
	error    : (e, v) => S('validation_range_values_valid_error', 'Range values are invalid'),
	rule     : (e, v) => S('validation_range_values_valid_rule' , 'Range values must be valid'),
})

add_validator({
	name     : 'positive_range',
	vprops   : 'value1 value2',
	applies  : (e   ) => e.is_range,
	validate : (e, v) => e.value1 == null || e.value2 == null || e.value1 <= e.value2,
	error    : (e, v) => S('validation_positive_range_error', 'Range is negative'),
	rule     : (e, v) => S('validation_positive_range_rule' , 'Range must be positive'),
})

add_validator({
	name     : 'minlen',
	props    : 'minlen',
	vprops   : 'input_value',
	applies  : (e,    field) => field.minlen,
	validate : (e, v, field) => v.len >= field.minlen,
	error    : (e, v, field) => S('validation_minlen_error',
		'{0} too short', field_name(field)),
	rule     : (e,    field) => S('validation_minlen_rule' ,
		'{0} must be at least {1} characters', field_name(field), field.minlen),
})

add_validator({
	name     : 'lower',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e,    field) => field.conditions && field.conditions.includes('lower'),
	validate : (e, v, field) => /[a-z]/.test(v),
	error    : (e, v, field) => S('validation_lower_error',
		'{0} does not contain a lowercase letter', field_name(field)),
	rule     : (e,    field) => S('validation_lower_rule' ,
		'{0} must contain at least one lowercase letter', field_name(field)),
})

add_validator({
	name     : 'upper',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e,    field) => field.conditions && field.conditions.includes('upper'),
	validate : (e, v, field) => /[A-Z]/.test(v),
	error    : (e, v, field) => S('validation_upper_error',
		'{0} does not contain a uppercase letter', field_name(field)),
	rule     : (e,    field) => S('validation_upper_rule' ,
		'{0} must contain at least one uppercase letter', field_name(field)),
})

add_validator({
	name     : 'digit',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e,    field) => field.conditions && field.conditions.includes('digit'),
	validate : (e, v, field) => /[0-9]/.test(v),
	error    : (e, v, field) => S('validation_digit_error',
		'{0} does not contain a digit', field_name(field)),
	rule     : (e,    field) => S('validation_digit_rule' ,
		'{0} must contain at least one digit', field_name(field)),
})

add_validator({
	name     : 'symbol',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e,    field) => field.conditions && field.conditions.includes('symbol'),
	validate : (e, v, field) => /[^A-Za-z0-9]/.test(v),
	error    : (e, v, field) => S('validation_symbol_error',
		'{0} does not contain a symbol', field_name(field)),
	rule     : (e,    field) => S('validation_symbol_rule' ,
		'{0} must contain at least one symbol', field_name(field)),
})

add_validator({
	name     : 'enum',
	vprops   : 'input_value',
	applies  : (e,    field) => field.value_known,
	validate : (e, v, field) => field.value_known(v) != null,
	error    : (e, v, field) => S('validation_known_error',
		'{0} unknown value {1}', field_name(field), field_value(field, v)),
	rule     : (e,    field) => S('validation_known_rule',
		'{0} must be a known value', field_name(field)),
})

add_validator({
	name     : 'lookup',
	props    : 'lookup_nav lookup_cols', // TODO: lookup_nav.ready ??
	vprops   : 'input_value',
	applies  : (e,    field) => field.lookup_nav,
	validate : (e, v, field) => field.lookup_nav.ready
			&& field.lookup_nav.lookup(field.lookup_cols, [v]).length > 0,
	error    : (e, v, field) => S('validation_lookup_error',
		'{0} unknown value {1}', field_name(field), field_value(field, v)),
	rule     : (e,    field) => S('validation_lookup_rule',
		'{0} value unknown', field_name(field)),
})

// NOTE: trying to be compliant with mySQL TIMESTAMP range.
// NOTE: you only get 6-digit of fractional precision for years >= 1900
// when making computations with timestamps, so we're not really fully
// mySQL compliant.
let min_time = time(1000, 1, 1, 0, 0, 0)
let max_time = time(10000) - 1
add_validator({
	name     : 'time',
	vprops   : 'input_value',
	applies  : (e,    field) => field.is_time,
	convert  : (e, v, field) => parse_date(v, 'SQL', true,
			e.with_time, e.with_seconds, e.with_fractions) ?? INVALID,
	validate : (e, v, field) => v >= min_time && v <= max_time,
	error    : (e, v, field) => S('validation_time_error',
		'{0} is an invalid date', field_name(field)),
	rule     : (e,    field) => S('validation_time_rule',
		'{0} must be a valid date'),
})

add_validator({
	name     : 'timeofday',
	vprops   : 'input_value',
	applies  : (e,    field) => field.is_timeofday,
	convert  : (e, v, field) => parse_timeofday(v, true,
		e.with_seconds, e.with_fractions) ?? INVALID,
	validate : return_true,
	error    : (e, v, field) => S('validation_timeofday_error',
		'{0} is an invalid time of day', field_name(field)),
	rule     : (e,    field) => S('validation_timeofday_rule',
		'{0} must be a valid time of day'),
})

/* <errors> ------------------------------------------------------------------

attr:      prop:
	for        target_id     id of input that fires ^^validate()
	           target        input that fires ^^validate()
   show_all                 shwo all rules with pass/fail mark or just the first error

*/

css('.errors', 'v p label')
css('.errors-line', 'h p-05 gap-x')
css('.errors-icon', 'w1 t-c')
css('.errors-message', '')
css('.errors-checked.errors-failed', 'fg-error bg-error')
css('.errors-not-checked', 'dim')
css('.errors-failed .errors-icon::before', 'fa fa-times')
css('.errors-checked.errors-passed .errors-icon::before', 'fa fa-check')

G.errors = component('errors', 'Input', function(e) {

	e.class('errors')

	e.prop('target'    , {type: 'element'})
	e.prop('target_id' , {type: 'id', attr: 'for'})
	e.prop('show_all'  , {type: 'bool', attr: 'show-all'})

	function update(validator) {
		if (e.show_all) {
			e.clear()
			for (let result of validator.results)
				if (result.rule)
					e.add(div({class: catany(' ',
								'errors-line',
								(result.checked ? 'errors-checked' : 'errors-not-checked'),
								(result.failed ? 'errors-failed' : 'errors-passed')
							)},
							div({class: 'errors-icon'}),
							div({class: 'errors-message'}, result.rule)
						))
		} else {
			let ffr = validator.first_failed_result
			if (ffr)
				e.set(ffr.error)
			// don't clear the error, just hide it so that box w and h stay stable.
			e.class('visible'  , !!ffr)
			e.class('invisible', !ffr)
		}
	}

	e.on_bind(function(on) {
		if (on) {
			let te = e.target || window[e.target_id]
			if (te && te.validator)
				update(te.validator)
		}
	})

	e.listen('validate', function(te, out) {
		if (!(te == e.target || (e.target_id && te.id == e.target_id)))
			return
		update(out)
	})

})

/* element validator ---------------------------------------------------------

An element with a validator gets re-validated automatically whenever any props
that are involved in validation change. Validation state and result is kept
in the element as well as a tooltip that shows up when the element has focus
or is hovered.
NOTE: This is excess-DRY but copy-paste is even worse.

uses props:
	input_value
state props:
	validator
	invalid
	errors
	errors_tooltip
methods:
	validate([ev]) -> valid?
	try_validate(v) -> valid?
hooks:
	on_validate(f); f([ev])
update options:
	validation

*/

css('.errors-tooltip .errors', 'bg-error')

e.make_validator = function(validate_on_init, errors_tooltip_target) {

	let e = this

	e.prop('invalid', {type: 'bool', attr: true, default: false, slot: 'state'})

	e.validator = create_validator(e, e)

	e.validate = function() {
		e.invalid = !e.validator.validate(e.input_value)
		e.update({validation: true})
	}
	e.on_validate = function(f) {
		e.do_after('validate', f)
	}

	e.try_validate = function(v) {
		let ok = e.validator.validate(v, false)
		e.validator.validate(e.input_value, false)
		return ok
	}

	e.on_prop_changed(function(k, v, v0, ev) {
		if (e.initialized == false)
			return
		if (e.validator.prop_changed(k))
			e.validate(ev)
	})

	if (validate_on_init != false)
		e.on_init(function() {
			e.validate()
		})

	let ett = errors_tooltip_target ?? e

	if (ett != false) {

		e.do_after('set_invalid', function(v) {
			ett.attr('invalid', v)
		})

		e.on_update(function(opt) {

			let show_tooltip = (opt.errors_tooltip || opt.validation)
				&& (e.invalid && (e.has_focus_visible || e.hovered))
				&& !e.getAnimations().length

			let et = e.errors_tooltip
			if (show_tooltip && !et) {
				e.errors = tag('errors', {show_all: false})
				e.errors.target = e
				et = tooltip({kind: 'error', align: 'center',
					text: e.errors, target: ett})
				et.class('errors-tooltip')
				e.errors_tooltip = et
				e.add(et)
			}
			if (et) {
				et.show(show_tooltip)
				et.class('click-through', !e.has_focus)
			}

		})

		function update_et() {
			e.update({errors_tooltip: true})
		}
		ett.on('focus', update_et)
		ett.on('blur' , update_et)
		ett.on('hover', update_et)

		// hide the tooltip while the target animates (slider thumb does that).
		ett.on('transitionstart', update_et)
		ett.on('transitionend'  , update_et)

	}

}

/* form ----------------------------------------------------------------------

Just wrapping the form so that it triggers validation on first submit,
and aborts the submit if validation fails.

*/

component('form', function(e) {

	e.init_child_components()

	e.on('submit', function(ev) {
		for (let input of e.elements) {
			if (input.widget && input.widget.validator) {
				if (!input.widget.validator.triggered)
					input.widget.validate(ev)
				if (input.widget.validator.failed) {
					ev.preventDefault()
					break
				}
			}
		}
	})

})

/* input_widget --------------------------------------------------------------

An input widget is a widget with a validator with an `input_value` prop that
gets validated and a `value` prop that is set as the result. It also has a
hidden <input> element set to `value` so that it works in a form.
NOTE: This is excess-DRY but copy-paste is even worse.

inherits:
	validator
config:
	name
	form
	required
	readonly
	min max     (for `number` and `time` value types)
state:
	input_value (attr: value)
	value
	invalid
stubs:
	update_value_input(ev)
	to_form

*/

e.make_input_widget = function(opt) {

	let e = this
	let vt = opt.value_type

	e.prop('name', {store: false})
	e.prop('form', {type: 'id', store: false})

	// initial value and also the value from user input, valid or not, typed or text.
	e.prop('input_value', {type: vt, attr: 'value', slot: 'state', default: undefined})

	// typed, validated value, not user-changeable.
	e.prop('value', {type: vt, slot: 'state'})

	e.prop('required', {type: 'bool', attr: true, default: false})
	e.prop('readonly', {type: 'bool', attr: true, default: false})

	if (vt == 'number' || vt == 'time') {
		e.prop('min', {type: vt})
		e.prop('max', {type: vt})
	}

	e.value_input = tag('input', {hidden : '', type: 'hidden'})
	e.value_input.widget = e
	e.add(e.value_input)

	e.get_name = function(s) { return e.value_input.name }
	e.set_name = function(s) { e.value_input.name = s }
	e.get_form = function() { return e.value_input.form }
	e.set_form = function(s) { e.value_input.form = s }

	e.set_value = function(v, v0, ev) {
		assert(ev) // not user-writable
	}

	e.make_validator(false, opt.errors_tooltip_target)

	e.to_form = e.to_form || return_arg // stub

	e.update_value_input = function(ev) {
		e.value_input.value = e.to_form(e.value) ?? ''
		e.value_input.disabled = e.value == null
	}
	e.on_validate(function(ev) {
		e.set_prop('value', e.validator.value, ev || {target: e})
		e.update_value_input(ev)
	})

	e.input_value_default = () => null // stub

	e.on_init(function() {
		if (e.input_value === undefined)
			e.input_value = e.input_value_default() // triggers validation
		else
			e.validate()
	})

}

/* range_input_widget --------------------------------------------------------

A range input widget is a widget that contains two validated input widgets
that define a range, and it also has a validator that validates the range.
NOTE: This is DRY at its worst but copy-paste is even worse.

inherits:
	validator
config:
	form
	name1 name2
	required1 required2
	readonly1 readonly2
	min1 min2 max1 max2     (for `number` and `time` value types)
state:
	input_value1 (attr: value1)
	input_value2 (attr: value2)
	value1 value2
	invalid1 invalid2

*/

e.make_range_input_widget = function(opt) {

	let e = this
	assert(opt.value_input_widgets.len == 2)

	e.make_validator(true, opt.errors_tooltip_target)

	e.prop('form', {type: 'id', store: false})

	for (let ve of opt.value_input_widgets) {

		let i = assert(ve.K)

		e.forward_prop('name'+i       , ve, 'name')
		e.forward_prop('required'+i   , ve, 'required')
		e.forward_prop('readonly'+i   , ve, 'readonly')
		e.forward_prop('input_value'+i, ve, 'input_value', 'value'+i)
		e.forward_prop('value'+i      , ve, 'value'      , null, 'bidi')
		e.forward_prop('invalid'+i    , ve, 'invalid'    , null, 'backward')

		let vt = ve.props.value.type
		if (vt == 'number' || vt == 'time') {
			e.forward_prop('min', ve, 'min')
			e.forward_prop('max', ve, 'max')
		}

		e.do_after('set_form', function(s) {
			ve.form = s
		})

		ve.value_input.widget = e

	}

	e.get_form = function() {
		return opt.value_input_widgets[0].form
	}

	e.property('input_value', () => e)
	e.on_validate(function(ev) {
		//
	})

	// e.on_init(function() {
	// 	e.validate()
	// })

}

/* <check>, <toggle>, <radio> buttons ----------------------------------------

inherits:
	input_widget
css classes:
	.hover
state attrs:
	checked
state props:
	checked <-> t|f
events:
	^input

*/

// check, toggle, radio ------------------------------------------------------

css('.checkbox', 'large t-m link h-c h-m round', `
	min-width  : 2em;
	min-height : 2em;
	max-width  : 2em;
	max-height : 2em;
	--fg-check: var(--fg-link);
`)

css('.checkbox.null', 'op06')
css('.checkbox[invalid]', 'fg-error bg-error')

css_state('.checkbox:is(:hover,.hover)', '', `
	--fg-check: var(--fg-link-hover);
`)

css_state('.checkbox:focus-visible', '', `
	--fg-check: var(--fg-white);
`)

css('.checkbox-focus-circle', '', ` r: 0; fill: var(--bg-focused-selected); `)
css_state('.checkbox:focus-visible .checkbox-focus-circle', '', ` r: 50%; `)

function check_widget(e, input_type) {
	e.clear()
	e.class('checkbox')
	e.make_disablable()
	e.make_input_widget({value_type: 'bool'})
	e.input_value_default = () => e.unchecked_value
	e.make_focusable()
	e.property('label', function() {
		if (!e.bound) return
		if (!e.id) return
		return $1('label[for='+e.id+']')
	})

	e.prop('checked_value'  , {default: true })
	e.prop('unchecked_value', {default: false})
	e.prop('checked', {type: 'bool', store: false})
	e.get_checked = function() {
		if (e.value === e.checked_value) return true
		if (e.value === e.unchecked_value) return false
		return null
	}
	e.set_checked = function(v, v0, ev) {
		if (v) v = e.checked_value
		else if (v != null) v = e.unchecked_value
		else v = null
		e.set_prop('input_value', v, ev)
	}

	e.on_update(function(opt) {
		if (opt.value) {
			e.bool_attr('checked', e.checked || null)
			e.class('null', e.value == null)
		}
	})

	e.on_validate(function(ev) {
		e.update({value: true})
	})

	e.update_value_input = function(ev) {
		// don't send any value when unchecked, just like native input does.
		e.value_input.value = e.checked_value
		e.value_input.disabled = !e.checked
	}

	e.user_set = function(v, ev) {
		e.set_checked(v, e.checked, ev || {target: e})
		e.fireup('input', ev)
	}
	function user_toggle(ev) { e.user_set(!e.checked, ev) }
	e.on('keydown', function(key, shift, ctrl, alt, ev) {
		if (key == ' ') { // same as for <button>
			user_toggle(ev)
			return false
		}
		if (key == 'Enter' && e.form) { // same as <input type=checkbox|radio>
			e.form.fire('submit')
			return false
		}
		if (key == 'Delete') {
			e.user_set(null, ev)
			return false
		}
	})
	e.on('click', function(ev) {
		user_toggle(ev)
	})
	e.on('label_hover', function(on) {
		e.class('hover', on)
	})
	e.on('label_click', function(ev) {
		user_toggle(ev)
	})
	e.on('hover', function(ev, on) {
		let label = e.label
		if (!label) return
		label.fire('target_hover', on)
	})

}

// check ---------------------------------------------------------------------

css('.check-line', '', `
	fill: none;
	stroke: var(--fg-check);
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 5%;
`)
css('.check-frame', 'check-line', `
	rx    : 1px;
	ry    : 1px;
	x     : -25%;
	y 		: -25%;
	width :  50%;
	height:  50%;
`)
css('.check-mark', 'check-line ease', `
	transform: translate(-25%, -25%) scale(.5);
	stroke-width: 15%;
	stroke-dasharray : 20;
	stroke-dashoffset: 20;
	transition-property: transform, stroke-dashoffset;
`)

css_state('.check[checked] .check-mark', 'ease', `
	stroke: var(--bg);
	stroke-dashoffset: 0;
	transition-property: transform, stroke-dashoffset;
`)

css_state('.check:focus-visible', 'no-outline')

css_state('.check:focus-visible .check-mark', 'ease', `
	stroke: var(--bg-focused-selected);
	transition-property: transform, stroke-dashoffset;
`)

css_state('.check[checked] .check-frame', '', `
	fill: var(--fg-check);
`)

G.check = component('check', function(e) {
	e.class('check')
	check_widget(e)
	e.add(svg({viewBox: '-10 -10 20 20'},
		svg_tag('circle'  , {class: 'checkbox-focus-circle'}),
		svg_tag('rect'    , {class: 'check-frame'}),
		svg_tag('polyline', {class: 'check-mark' , points: '4 11 8 15 16 6'})
	))
})

/* toggle --------------------------------------------------------------------

inherits:
	check_widget

*/

css('.toggle', 'm t-m p-05 round bg1 h-m ease ring rel', `
	min-width  : 2.4em;
	max-width  : 2.4em;
	min-height : 1.4em;
	max-height : 1.4em;
`)

/* TODO: pixel snapping makes this look wrong sometimes, redo it with svg. */
css('.toggle-thumb', 'round bg-white ring ease abs', `
	min-width  : 1em;
	min-height : 1em;
	left: .2em;
`)
css_state('.toggle[checked]', '', `
	background: var(--bg-button-primary);
`)
css_state('.toggle[checked] .toggle-thumb', 'ease', `
	transform: translateX(100%);
`)
css_state('.toggle:is(:hover,.hover)', '', `
	background: var(--bg1-hover);
`)
css_state('.toggle[checked]:is(:hover,.hover)', '', `
	background: var(--bg-button-primary-hover);
`)

G.toggle = component('toggle', function(e) {
	e.class('toggle')
	check_widget(e)
	e.add(div({class: 'toggle-thumb'}))
})

/* <radio> -------------------------------------------------------------------

inherits:
	check_widget

*/

css('.radio', 'checkbox')

css('.radio-circle', 'check-line', ` r: .5px; `)
css('.radio-thumb' , 'ease'      , ` r:    0; fill: var(--fg-check); `)

css_state('.radio[checked] .radio-thumb', 'ease', ` r: .2px; transition-property: r; `)

css_state('.radio:focus-visible', 'no-outline')

G.radio = component('radio', function(e) {

	e.class('radio')
	check_widget(e, 'radio')

	e.add(svg({viewBox: '-1 -1 2 2'},
		svg_tag('circle', {class: 'checkbox-focus-circle'}),
		svg_tag('circle', {class: 'radio-circle'}),
		svg_tag('circle', {class: 'radio-thumb'}),
	))

	e.group_elements = function() {
		let form = e.form || document.body
		return e.name ? [...form.$('.radio[name='+e.name+']')] : [e]
	}

	e.user_set = function(v, ev) {
		if (v == false)
			return // toggling doesn't make sense on a radio.
		if (v == null) {
			// setting `checked` to null doesn't make sense on a radio,
			// but removing the checked state does.
			v = false
		}
		for (let re of e.group_elements())
			if (re != e)
				re.checked = false
		e.set_prop('checked', v, ev || {target: e})
		e.fireup('input')
	}

	e.next_radio = function(inc) {
		let res = e.group_elements()
		return res[(res.indexOf(e)+inc) % res.len]
	}

	e.on('keydown', function(key, shift, ctrl, alt, ev) {
		if (key == 'ArrowDown' || key == 'ArrowUp' || key == 'ArrowLeft' || key == 'ArrowRight') {
			e.next_radio((key == 'ArrowUp' || key == 'ArrowLeft') ? -1 : 1).focus()
			return false
		}
		if (key == 'Tab') {
			// TODO: exit radio group on Tab like native input does?
			// Not sure about this, it's so confusing, but maybe people expect it?
		}
	})

})

/* <slider> & <range-slider> -------------------------------------------------

inherits:
	input_widget
model options:
	from to
	min max
	decimals
state:
	value | value1 value2
	progress | progress1 progress2
methods:

*/

css('.slider', 'S h t-m noclip rel', `
	--slider-marked: 1;
	--slider-mark-w: 40px; /* pixels only! */
	min-width: 8em;
	margin-left   : calc((var(--slider-marked) * var(--slider-mark-w) / 2) + var(--space-1));
	margin-right  : calc((var(--slider-marked) * var(--slider-mark-w) / 2) + var(--space-1));
	margin-top    : calc(var(--space-1) + 1em);
	margin-bottom : calc(var(--space-1) + 1em + var(--slider-marked) * 1em);
	width: calc(var(--w-input) - margin-left - margin-right);
`)
css('.slider-fill', 'abs round', ` height: 3px; `)
css('.slider-bg-fill', 'bg1')
css('.slider-valid-fill', 'bg3')
css('.slider-value-fill', 'bg-link')
css('.slider-thumb', 'bg-link')
css('.slider-thumb', 'abs round', `
	/* center vertically relative to the fill */
	margin-top : calc(-.6em + 1px);
	margin-left: calc(-.6em);
	width : 1.2em;
	height: 1.2em;
	box-shadow: var(--shadow-thumb);
`)

// toggling visibility on hover requires click-through for stable hovering!
css('.slider-thumb .tooltip', 'click-through m-l-0')

css('.slider-mark', 'abs b-l t-c noselect', `
	margin-left: -1px;
	top: 3px;
	height: 10px;
	border-color: var(--bg2);
`)
css('.slider-mark-label', 'rel label nowrap-dots', `
	left: -50%;
	top : .7em;
`)

css_state('.slider-thumb[invalid]', 'bg-error')
css_state('.slider[invalid] .slider-value-fill', 'bg-error')

css_state('.slider.animate .slider-thumb       ', 'ease')
css_state('.slider.animate .slider-value-fill'  , 'ease')

let compute_step_and_range = function(wanted_n, min, max, scale_base, scales, decimals) {
	scale_base = scale_base || 10
	scales = scales || [1, 2, 2.5, 5]
	let d = max - min
	let min_scale_exp = floor((d ? logbase(d, scale_base) : 0) - 2)
	let max_scale_exp = floor((d ? logbase(d, scale_base) : 0) + 2)
	let n0, step
	let step_multiple = decimals != null ? 10**(-decimals) : null
	for (let scale_exp = min_scale_exp; scale_exp <= max_scale_exp; scale_exp++) {
		for (let scale of scales) {
			let step1 = scale_base ** scale_exp * scale
			let n = d / step1
			if (n0 == null || abs(n - wanted_n) < n0) {
				if (step_multiple == null || floor(step1 / step_multiple) == step1 / step_multiple) {
					n0 = n
					step = step1
				}
			}
		}
	}
	min = ceil  (min / step) * step
	max = floor (max / step) * step
	return [step, min, max]
}

let slider_widget = function(e, range) {

	e.clear()
	e.class('slider')
	e.class('range', !!range)
	e.make_disablable()
	e.is_range = range // for range validator

	e.prop('from'    , {type: 'number', default: 0})
	e.prop('to'      , {type: 'number', default: 1})

	e.prop('decimals', {type: 'number', default: 2})

	e.prop('marked'  , {type: 'bool'  , default: true})

	e.mark_w = e.css().prop('--slider-mark-w').num()

	e.set_marked = function(v) {
		e.style.prop('--slider-marked', v ? 1 : 0)
	}

	e.bg_fill    = div({class: 'slider-fill slider-bg-fill'})
	e.valid_fill = div({class: 'slider-fill slider-valid-fill'})
	e.value_fill = div({class: 'slider-fill slider-value-fill'})

	e.marks = div({class: 'slider-marks'})

	function to_text(v) {
		if (v == null) return null
		return e.decimals != null ? v.dec(e.decimals) : v+''
	}

	e.thumbs = []
	for (let K of range ? ['1', '2'] : ['']) {
		let thumb = tag('slider-thumb')
		e.thumbs.push(thumb)
		thumb.class('slider-thumb')
		thumb.K = K
		thumb.to_num = num
		thumb.to_text = v => to_text
		if (range)
			thumb.make_input_widget({
				value_type: 'number',
				errors_tooltip_target: false,
			})
		e.do_after('set_invalid', function(v) {
			thumb.attr('invalid', v)
		})
	}
	if (range) {
		e.make_range_input_widget({
			value_input_widgets: e.thumbs,
			errors_tooltip_target: false,
		})
	} else {
		e.make_input_widget({
			value_type: 'number',
			errors_tooltip_target: false,
		})
	}

	e.add(e.bg_fill, e.valid_fill, e.value_fill, e.marks, ...e.thumbs)

	e.make_focusable(...e.thumbs)

	// model: progress

	function cmin() { return max(e.min ?? -1/0, e.from) }
	function cmax() { return min(e.max ??  1/0, e.to  ) }

	function multiple() { return e.decimals ? 1 / 10 ** e.decimals : 1 }

	function progress_for(v) {
		return clamp(lerp(v, e.from, e.to, 0, 1), 0, 1)
	}

	e.set_progress_for = function(K, p, ev) {

		let v = lerp(p, 0, 1, e.from, e.to)

		if (e.decimals != null)
			v = floor(v / multiple() + .5) * multiple()

		if (K == '1')
			v = e.value2 != null ? min(v, e.value2) : null
		else if (K == '2')
			v = e.value1 != null ? max(v, e.value1) : null

		e.set_prop('input_value'+K, clamp(v, cmin(), cmax()), ev)
	}

	e.get_progress_for = function(K) {
		return progress_for(e['value'+K])
	}

	for (let thumb of e.thumbs) {
		let K = thumb.K
		e.prop('progress'+K, {private: true, store: false})
		e['get_progress'+K] = function() { e.get_progress_for(K) }
		e['set_progress'+K] = function(p, ev) { e.set_progress_for(K, p, ev) }
	}

	// view

	e.user_set_progress_for = function(K, p, ev) {
		e.set_progress_for(K, p, ev)
	}

	e.display_value_for = function(v) {
		return (v != null && e.decimals != null) ? v.dec(e.decimals) : v
	}

	function update_thumb(thumb, p) {
		thumb.x1 = (p * 100)+'%'
		update_tooltip(thumb, true)
	}

	function update_fill(fill, p1, p2) {
		fill.x1 = (p1 * 100)+'%'
		fill.x2 = ((1-p2) * 100)+'%'
	}

	function update_tooltip(thumb, update_text) {
		let show = thumb.matches(':is(:hover,:focus-visible)')
			&& !thumb.getAnimations().length
		if (!show && !thumb.tooltip) return
		if (!thumb.tooltip) {
			thumb.tooltip = tooltip({align: 'center'})
			thumb.add(thumb.tooltip)
			update_text = true
		}
		if (update_text) {
			thumb.tooltip.kind = e.invalid ? 'error' : null
			let tfr = thumb.validator && thumb.validator.first_failed_result
			let efr = e.validator && e.validator.first_failed_result
			let a = [e.display_value_for(e['value'+thumb.K])]
			if (tfr && tfr.error) a.push(tfr.error)
			if (efr && efr.error) a.push(efr.error)
			thumb.tooltip.text = a.join_nodes(tag('br'))
		}
		thumb.tooltip.update({show: show})
	}

	e.on_update(function() {

		let p1, p2

		p1 = progress_for(e.from)
		p2 = progress_for(e.to)
		update_fill(e.bg_fill, p1, p2)

		p1 = progress_for(cmin())
		p2 = progress_for(cmax())
		update_fill(e.valid_fill, p1, p2)

		p1 = progress_for(range ? e.value1 : cmin())
		p2 = progress_for(range ? e.value2 : e.value)
		update_fill(e.value_fill, min(p1, p2), max(p1, p2))

		for (let thumb of e.thumbs) {
			let p = e.get_progress_for(thumb.K)
			update_thumb(thumb, p)
		}

		if (!e.marks.len)
			e.position()

	})

	let w
	e.on_measure(function() {
		w = e.rect().w
	})

	function add_mark(v) {
		let l = div({class: 'slider-mark-label', style: 'max-width:'+e.mark_w+'px'})
		let m = div({class: 'slider-mark'}, l)
		e.marks.add(m)
		m.x = lerp(v, e.from, e.to, 0, w)
		l.set(e.display_value_for(v))
	}
	function update_marks() {
		e.marks.clear()
		if (!e.marked)
			return

		let max_n = floor(w / e.mark_w)
		let [step, min, max] = compute_step_and_range(
			max_n, e.from, e.to, e.scale_base, e.scales, e.decimals)

		add_mark(e.from)
		for (let v = min; v <= max; v += step)
			add_mark(v)
		add_mark(e.to)
	}

	e.on_position(function() {
		update_marks()
	})

	// controller

	e.class('animate')

	for (let thumb of e.thumbs) {

		function update_tt() { update_tooltip(thumb) }
		thumb.on('hover', update_tt)
		thumb.on('focus', update_tt)
		thumb.on('blur' , update_tt)
		thumb.on('transitionstart', update_tt)
		thumb.on('transitionend'  , update_tt)

		thumb.on('pointerdown', function(ev, mx0) {

			let r = e.rect()
			let tr = thumb.rect()
			let dx = mx0 - (tr.x + tr.w / 2)
			function pointermove(ev, mx) {
				e.user_set_progress_for(thumb.K, (mx - dx - r.x) / r.w, ev)
				return false
			}
			pointermove(ev, mx0)
			function pointerup(ev) {
				e.class('animate')
			}
			e.class('animate', e.decimals != null
				&& lerp(e.from + multiple(), e.from, e.to, 0, r.w) >= 20)

			// NOTE: not returning false here because it screws :focus-visible.
			this.capture_pointer(ev, pointermove, pointerup)
		})

		thumb.on('keydown', function(key, shift, ctrl, alt, ev) {
			if (alt)
				return
			let d
			switch (key) {
				case 'ArrowLeft'  : d =  -.1; break
				case 'ArrowRight' : d =   .1; break
				case 'ArrowUp'    : d =  -.1; break
				case 'ArrowDown'  : d =   .1; break
				case 'PageUp'     : d =  -.5; break
				case 'PageDown'   : d =   .5; break
				case 'Home'       : d = -1/0; break
				case 'End'        : d =  1/0; break
			}
			if (d) {
				let p = e.get_progress_for(this.K) + d * (shift ? .1 : 1)
				e.user_set_progress_for(this.K, p, ev)
				return false
			}
		})

	}

	if (!range)
		e.on('pointerdown', function(ev, mx) {
			for (let thumb of e.thumbs)
				if (thumb.contains(ev.target))
					return
			let r = e.bg_fill.rect()
			let p = (mx - r.x) / r.w
			e.user_set_progress_for('', p, ev)
		})

	e.on('resize', function() {
		e.position()
	})

}

G.slider = component('slider', 'Input', slider_widget)

G.range_slider = component('range-slider', 'Input', function(e) {
	return slider_widget(e, true)
})

/* .inputbox class -----------------------------------------------------------

Applies to <input>, <button>, <select-button> and <dropdown> so that they
dovetail perfectly in an inline context (they valign and have the same border,
height, font, line height, margin and padding).

NOTE: `--p-y-input-adjust` is set to 1px for certain fonts at certain sizes.
NOTE: `--lh-input` is 1.25 because <input> can't set it lower.

NOTE: Do not try to baseline-align elements that have borders or background,
they will never align perfectly if you have text in multiple fonts inside
(which you do when you use icon fonts). Even when `line-height` is exactly
the same everywhere the elements will still misalign at certain zoom levels.
That's why we use `t-m` instead of `t-bl` on all bordered widgets.

*/

css(':root', '', `
	--p-x-input: var(--space-1);
	--p-y-input: var(--space-1);
	--p-y-input-adjust: 0px;
	--p-y-input-offset: 0px;
`)

css_util('.lh-input', '', `
	--lh: var(--lh-input);
	line-height: calc(var(--fs) * var(--lh)); /* in pixels so it's the same on icon fonts */
`)

css_util('.p-t-input', '', ` padding-top    : calc((var(--p-y-input) + var(--p-y-input-adjust) + var(--p-y-input-offset))); `)
css_util('.p-b-input', '', ` padding-bottom : calc((var(--p-y-input) - var(--p-y-input-adjust) + var(--p-y-input-offset))); `)
css_util('.p-y-input', 'p-t-input p-b-input')

css_util('.p-l-input', '', ` padding-left   : var(--p-x-input); `)
css_util('.p-r-input', '', ` padding-right  : var(--p-x-input); `)
css_util('.p-x-input', 'p-l-input p-r-input')

css_util('.p-input', 'p-x-input p-y-input')

css_util('.gap-x-input', '', ` column-gap: var(--p-x-input); `)
css_util('.gap-y-input', '', ` row-gap   : var(--p-y-input); `)

css_util('.gap-input', 'gap-x-input gap-y-input')

css('.inputbox', 'm-y-05 b p-input t-m h-m gap-x-input lh-input')

css_state('.inputbox[invalid]', '', `
	border-color: var(bg-invalid);
`)

css_util('.xsmall' , '', `--p-y-input-adjust: var(--p-y-input-adjust-xsmall , 0px);`)
css_util('.small'  , '', `--p-y-input-adjust: var(--p-y-input-adjust-small  , 0px);`)
css_util('.smaller', '', `--p-y-input-adjust: var(--p-y-input-adjust-smaller, 0px);`)
css_util('.normal' , '', `--p-y-input-adjust: var(--p-y-input-adjust-normal , 0px);`)
css_util('.large'  , '', `--p-y-input-adjust: var(--p-y-input-adjust-large  , 0px);`)
css_util('.xlarge' , '', `--p-y-input-adjust: var(--p-y-input-adjust-xlarge , 0px);`)

css_util('.xsmall' , '', `--p-y-input: var(--space-025);`)
css_util('.small'  , '', `--p-y-input: var(--space-025);`)
css_util('.smaller', '', `--p-y-input: var(--space-05 );`)

css_util('.large'  , '', `--p-x-input: var(--space-2);`)
css_util('.xlarge' , '', `--p-x-input: var(--space-2);`)

/* <input-group> -------------------------------------------------------------

Stacks elements horizontally and styles them to create a composed input box.
<input-group> doesn't itself have the .inputbox class but instead styles itself
and its children so that the end result looks and behaves like an input box.
This allows different backgrounds in the child elements and also making
seprators out of their left/right borders.

An <input-group> can contain multiple <input> elements.

*/

css('.input-group', 'shrinks t-m m-y-05 lh-input h-s')

// `position: static` fixes the bug (in both Chrome & FF) where the outline
// is obscured by the children if 1) they have a background and 2) they create
// a stacking context.
css_role('.input-group > *', 'm0 no-z', `position: static;`)

// things that <input-group> doesn't insist upon its children having.
css('.input-group > *', 'b-t b-b bg-input')
css('.input-group > *:first-child', 'b-l')
css('.input-group > *:last-child' , 'b-r')

// nested input-groups should not have borders.
css('.input-group', 'b0')

css_state('.input-group[invalid] > *', 'bg-error')

G.input_group = component('input-group', function(e) {
	e.class('input-group b-collapse-h ro-collapse-h')
	e.make_disablable()
	e.init_child_components()
	e.inputs = e.$('input')
	e.make_focusable(...e.inputs)
	e.make_focus_ring(...e.inputs)
})

/* <labelbox> ----------------------------------------------------------------

Stack elements vertically inside an .inputbox, also stripping them of margin,
border and padding, making them float beside each other. Putting an <input-group>
inside a <labelbox> also strips the elements inside the <input-group>. So a
<labelbox> can be used for two things: 1) putting a <label> above an <input>,
and 2) putting stripped elements inside an <input-group>, even when you don't
want a label.

*/

css('.labelbox', 'S v p-input gap-input')

css_role('.labelbox > *, labelbox > .input-group > *', 'b0 m0 p0')
css_role('.labelbox > .input-group', 'gap-input')

// no-bg prevents outline clipping, also bg doesn't make sense since labelbox has padding.
css_role('.labelbox *', 'no-bg')

// overlaid labels: old is new again...
// TOOD: finish this: `rel` obscures the focus outline of the parent!
css_role('.labelbox[overlaid]', 'rel ro-var', `
	--p-y-input-adjust: .1em;
`)
// TODO: finish this: `abs` ::before cannot be painted before text content!
css_role('.labelbox[overlaid] > .label-widget::before', 'overlay m-l bg-input', `
	top: -1px;
	left: -.25em;
	content: '';
	height: 1px;
`)
css_role('.labelbox[overlaid] > .label-widget', 'abs p-x smaller bold lh0', `
	left: 0;
	top: 0;
`)

G.labelbox = component('labelbox', function(e) {
	e.class('labelbox')
	e.init_child_components()
})

/* <input> -------------------------------------------------------------------

--

*/

css('.w-input', '', `width: var(--w-input);`)

css('.input', 'S bg-input w-input shrinks', `
	font-family   : inherit;
	font-size     : inherit;
	border-radius : 0;
`)

G.input = component('input', 'Input', function(e) {

	e.class('input inputbox')
	e.make_disablable()
	e.make_focusable()

	e.on('label_click', function() {
		e.focus()
	})

})

/* <textarea> ----------------------------------------------------------------

--

*/

css('.textarea', 'S h m0 b p bg-input', `
	resize: none;
	overflow-y: overlay; /* Chrome only */
	overflow-x: overlay; /* Chrome only */
`)

G.textarea = component('textarea', 'Input', function(e) {

	e.class('textarea')
	e.make_disablable()
	e.make_focusable()

})

/* <button> ------------------------------------------------------------------

props:
	primary danger bare   style flags
	icon                  css classes for the icon
	text
	href                  link for googlebot to follow
	confirm               message
	action                function
	action_name           name of global function to call on click
state:
	selected
methods:
	draw_attention()      animate
stubs:
	format_text(s)
styling:
	.button [primary] [danger] [bare] :hover :active
events:
	^click()
globals:
	ID_action()           global function called on click
inner html:
	-> text

*/

css_util('.p-x-button', '', `
	padding-left  : var(--p-x-button, var(--space-2));
	padding-right : var(--p-x-button, var(--space-2));
`)

css('.button', 'h-c h-m p-x-button semibold nowrap noselect ro-var', `
	background  : var(--bg-button);
	color       : var(--fg-button);
	box-shadow  : var(--shadow-button);
	font-family : inherit;
	font-size   : var(--fs);
`)

css_util('.large ', '', `--p-x-button: var(--space-4); `)
css_util('.xlarge', '', `--p-x-button: var(--space-4); `)

css('.button.text-empty > .button-text', 'hidden')

css('.button-icon', 'w1 h-c')

css_state('.button:hover', '', `
	background: var(--bg-button-hover);
`)
css_state('.button:active', '', `
	background: var(--bg-button-active);
	box-shadow: var(--shadow-button-active);
`)

css('.button[primary]', 'b-invisible', `
	background : var(--bg-button-primary);
	color      : var(--fg-button-primary);
`)
css_state('.button[primary]:hover', '', `
	background : var(--bg-button-primary-hover);
`)
css_state('.button[primary]:active', '', `
	background : var(--bg-button-primary-active);
`)

css('.button[danger]', '', `
	background : var(--bg-button-danger);
	color      : var(--fg-button-danger);
`)
css_state('.button[danger]:hover', '', `
	background : var(--bg-button-danger-hover);
`)
css_state('.button[danger]:active', '', `
	background : var(--bg-button-danger-active);
`)

css      ('.button[bare][primary]', 'b-invisible ro0 no-bg no-shadow link')
css_state('.button[bare][primary]:hover' , 'no-bg link-hover')
css_state('.button[bare][primary]:active', 'no-bg link-active')

css      ('.button[bare]', 'b-invisible ro0 no-bg no-shadow fg')
css_state('.button[bare]:hover' , 'no-bg fg-hover')
css_state('.button[bare]:active', 'no-bg fg-active')

css_state('.button[selected]', '', `
	box-shadow: var(--shadow-pressed);
`)

// attention animation

css(`
@keyframes button-attention {
	from {
		transform: scale(1.2);
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
}
`)

G.button = component('button', 'Input', function(e) {

	let html_text = [...e.nodes]
	e.clear()

	e.class('button inputbox')
	e.make_disablable()
	e.make_focusable()

	e.icon_box = span({class: 'button-icon'})
	e.text_box = span({class: 'button-text'})
	e.icon_box.hidden = true
	e.add(e.icon_box, e.text_box)

	e.prop('href')
	e.set_href = function(s) {
		if (s) {
			if (!e.link) { // make a link for google bot to follow.
				e.link = tag('a')
				let s = e.format_text(e.text)
				e.link.set(TC(s))
				e.link.title = e.title
				e.add(tag('noscript', 0, e.link))
			}
			e.link.href = s
		} else if (e.link) {
			e.link.href = null
		}
	}

	e.format_text = return_arg // stub

	e.set_text = function(s) {
		s = e.format_text(s)
		e.text_box.set(s, 'pre-line')
		e.class('text-empty', !s || isarray(s) && !s.length)
		if (e.link)
			e.link.set(TC(s))
	}
	e.prop('text', {type: 'nodes', default: '', slot: 'lang'})

	e.set_icon = function(v) {
		if (isstr(v)) {
			if (v.starts('mi mi-')) {
				e.icon_box.attr('class', 'button-icon mi')
				e.icon_box.set(v.replace('mi mi-', ''))
			} else {
				e.icon_box.attr('class', 'button-icon '+v)
				e.icon_box.clear()
			}
		} else {
			e.icon_box.set(v)
		}
		e.icon_box.hidden = !v
	}
	e.prop('icon', {type: 'icon'})
	e.prop('load_spin', {attr: true})

	e.prop('primary'    , {type: 'bool', attr: true})
	e.prop('bare'       , {type: 'bool', attr: true})
	e.prop('danger'     , {type: 'bool', attr: true})
	e.prop('confirm')
	e.prop('action_name', {attr: 'action'})

	function activate() {
		if (e.effectively_hidden || e.effectively_disabled)
			return false
		if (e.confirm)
			if (!confirm(e.confirm))
				return false
		if (e.href) {
			exec(e.href)
			return true
		}
		// action can be set directly and/or can be a global with a matching name.
		if (e.action)
			if (e.action() == false)
				return false
		let action_name = e.action_name || (e.id && e.id+'_action')
		let action = window[action_name]
		if (action)
			if (action.call(e) == false)
				return false
		return true
	}

	e.on('click', function() {
		if (!activate())
			return false
	})

	// ajax notifications -----------------------------------------------------

	e.on('load', function(ev, ...args) {
		e.disable('loading', ev != 'done')
		let s = e.load_spin
		if (s) {
			s = repl(s, '', true) // html attr
			s = repl(s, true, 'fa-spin')
			s = repl(s, 'reverse', 'fa-spin fa-spin-reverse')
			e.icon_box.class(s, ev == 'start')
		}
	})

	e.load = function(url, success, fail, opt) {
		return get(url, success, fail, assign({notify: e}, opt))
	}

	e.post = function(url, upload, success, fail, opt) {
		return post(url, upload, success, fail, assign({notify: e}, opt))
	}

	// "drawing attention" animation ------------------------------------------

	e.draw_attention = function() {
		if (e.disabled)
			return
		e.style.animation = 'none'
		raf(function() { e.style.animation = 'button-attention .5s' })
	}

	return {text: html_text}

})

/* <select-button> && <vselect-button> ---------------------------------------

inherits:
	input_widget
state attrs:
	selected_index
state props:
	selected_index

*/

// NOTE: we use 'skip' on the root element and create an <input-group> inside
// so that we can add popups to the widget without messing up the CSS.
css('.select-button', 'skip')
css('.select-button-box', 'rel ro-var h-s gap-x-0 bg0 shadow-button', `
	padding: var(--p-select-button, 3px);
	--p-y-input-offset: calc(1px - var(--p-select-button, 3px));
`)

css_util('.smaller', '', ` --p-select-button: 2px; `)
css_util('.xsmall' , '', ` --p-select-button: 1px; `)
css_util('.small'  , '', ` --p-select-button: 1px; `)

css('.select-button-box > :not(.select-button-plate)',
	'S h-m h-c p-y-input p-x-button gap-x nowrap-dots noselect dim z1', `
	flex-basis: fit-content;
`)
css('.select-button-box > :not(.select-button-plate):not(.selected):hover', 'fg')
css('.select-button-box > :not(.select-button-plate).selected', '', `
	color: var(--fg-select-button-plate);
`)

css('.select-button-plate', 'abs ease shadow-button', `
	transition-property: left, width;
	border-radius: calc(var(--border-radius, var(--space-075)) * 0.7);
	background: var(--bg-select-button-plate);
`)

// not sure about this one...
css_state('.select-button-box:focus-visible', 'no-outline')
css_state('.select-button-box:focus-visible .select-button-plate', 'outline-focus')

css_state('.select-button-plate:hover', '', `
	background: var(--bg-select-button-plate-hover);
`)

css(':root', '', `
	--bg-select-button-plate: var(--bg-button-primary);
	--fg-select-button-plate: var(--fg-button-primary);
`)

css('.select-button[secondary]', '', `
	--bg-select-button-plate: var(--bg-unfocused-selected);
	--fg-select-button-plate: var(--fg-unfocused-selected);
`)

G.select_button = component('select-button', function(e) {

	let html_items = e.make_items_prop()

	e.class('select-button inputbox')
	e.make_disablable()

	e.inputbox = div({class: 'select-button-box inputbox'})
	e.add(e.inputbox)

	e.make_focusable(e.inputbox)

	e.make_input_widget({
		errors_tooltip_target: e.inputbox,
	})

	e.plate = div({class: 'select-button-plate'})

	// model

	e.prop('selected_index', {type: 'number', updates: 'selected_index'})

	e.item_value = function(ce) { // stub to pluck value from items
		return strict_or(ce.value, ce.attr('value'))
	}

	function clamp_item_index(i) {
		return i != null && e.len > 1 && e.inputbox.at[clamp(i, 0, e.len-3)] || null
	}

	// validation

	e.value_known = function(v) {
		for (let item of e.items)
			if (v === e.item_value(item))
				return true
	}

	e.do_after('set_items', function(items) {
		e.validate()
	})

	// view

	e.on_update(function(opt) {
		if (opt.items) {
			e.inputbox.clear()
			e.inputbox.set([...e.items, e.plate])
			opt.value = true
		}
		if (opt.value) {
			for (let b of e.inputbox.at) {
				if (b != e.plate && e.item_value(b) === e.value) {
					e.selected_item = b
					break
				}
			}
		} else if (opt.selected_index) {
			let i = e.selected_index
			e.selected_item = clamp_item_index(i)
		}
		for (let b of e.inputbox.at)
			b.class('selected', false)
		if (e.selected_item)
			e.selected_item.class('selected', true)
	})

	let sbor
	e.on_measure(function() {
		sbor = e.selected_item && e.selected_item.orect()
	})

	e.on_position(function() {
		if (!e.selected_item) {
			e.plate.hide()
			return
		}
		e.plate.x = sbor.x
		e.plate.y = sbor.y
		e.plate.w = sbor.w
		e.plate.h = sbor.h
		e.plate.show()
	})

	// controller

	e.on_validate(function(ev) {
		e.update({value: true})
	})

	function select_item(b, ev) {
		let v = b ? e.item_value(b) : null
		if (v != null)
			e.set_prop('input_value', v, ev)
		else
			e.selected_index = b.index
	}

	e.inputbox.on('click', function(ev) {
		let b = ev.target
		while (b && b.parent != e.inputbox) b = b.parent
		if (!b || b.parent != e.inputbox || b == e.plate) return
		select_item(b, ev)
	})

	e.inputbox.on('keydown', function(key, shift, ctrl, alt, ev) {
		if (alt || shift || ctrl)
			return
		if (key == 'ArrowRight' || key == 'ArrowLeft' || key == 'ArrowUp' || key == 'ArrowDown') {
			let fw = key == 'ArrowRight' || key == 'ArrowDown'
			let b = e.selected_item
			b = fw ? b && b.next || e.last.prev : b && b.prev || e.first
			select_item(b, ev)
			return false
		}
	})

	e.on('resize', function() {
		e.position()
	})

	return {items: html_items}
})

G.vselect_button = component('vselect-button', function(e) {

	e.class('vselect-button ro-collapse-v b-collapse-v')
	return select_button.construct(e)

})

/* <num-input> ---------------------------------------------------------------

inherits:
	input_widget
model options:
	min
	max
	decimals
view options:
	buttons
update options:
	value
	select_all

*/

// NOTE: we use 'skip' on the root element and create an <input-group> inside
// so that we can add popups to the widget without messing up the CSS.
css('.num-input', 'skip')
css('.num-input-group', 'w-input bg-input')

css('.num-input-input', 'S shrinks t-r')

css('.num-input-button' , 'm0 p-y-0 p-x-075 h-m bg-input no-shadow')
css_state('.num-input .num-input-button:hover' , 'bg-input-hover')
css_state('.num-input .num-input-button:active', 'bg-input-active')

// up-down arrow buttons
css('.num-input-updown-box', 'h', `padding: 1px;`)
css('.num-input[buttons=up-down] .num-input-input', 'p-r-05')
css('.num-input-updown', 'v-s')
css('.num-input-button-updown' , 'S')
css('.num-input-button-down' , 'b-t')
css('.num-input-arrow', '', `
	--num-input-arrow-size: .3em;
	border: var(--num-input-arrow-size) solid transparent; /* border-based triangle shape */
`)
css('.num-input-arrow-up'  , '', `border-bottom-color : var(--fg); margin-top   : calc(0px - var(--num-input-arrow-size));`)
css('.num-input-arrow-down', '', `border-top-color    : var(--fg); margin-bottom: calc(0px - var(--num-input-arrow-size));`)
css(':is(.xsmall, .small) .num-input-button-down' , 'b-t-0')

// plus-minus buttons
css('.num-input-button-plusminus', 'ro0 m0 p0', `width: 2.25em;`)
css('.num-input[buttons=plus-minus] .num-input-input', 't-c b-l-0 b-r-0')

// alternative diamond-style for up & down buttons
if (1) {
	css('.num-input[buttons=up-down] .num-input-input', 'b-r-0')
	css('.num-input-arrow', '', `transform: scaleY(1.5);`)
	css('.num-input-button-down' , 'b-t-0')
	css('.num-input-button-up'   , 'h-b', `padding-bottom: .25em;`)
	css('.num-input-button-down' , 'h-t', `padding-top   : .25em;`)
}

// enable for less clutter
if (0) {
	css('.num-input-input', 'p-r-0')
	css('.num-input              .num-input-updown' , 'invisible')
	css('.num-input:focus-within .num-input-updown' , 'visible')
}

G.num_input = component('num-input', 'Input', function(e) {

	e.clear()
	e.class('num-input')
	e.input_group = div({class: 'num-input-group input-group b-collapse-h ro-collapse-h'})
	e.add(e.input_group)

	e.is_number = true
	e.make_input_widget({
		value_type: 'number',
		errors_tooltip_target: e.input_group,
	})

	e.prop('decimals'   , {type: 'number', default: 0})
	e.prop('buttons'    , {type: 'enum', enum_values: 'none up-down plus-minus',
		default: 'none', attr: true})

	e.input = tag('input', {class: 'num-input-input'})
	e.make_focusable(e.input)
	e.input_group.make_focus_ring(e.input)

	function update_buttons() {
		for (let b of e.$('button'))
			b.disable('readonly', e.readonly)
	}

	e.set_buttons = function(v) {
		if (v == 'up-down') {
			e.up_button = button({
				classes: 'num-input-button num-input-button-updown num-input-button-up',
				bare: true,
				focusable: false,
				type: 'button',
			}, div({class: 'num-input-arrow num-input-arrow-up'}))
			e.down_button = button({
				classes: 'num-input-button num-input-button-updown num-input-button-down',
				bare: true,
				focusable: false,
				type: 'button',
			}, div({class: 'num-input-arrow num-input-arrow-down'}))
			e.updown_box = div({class: 'num-input-updown-box'},
				div({class: 'num-input-updown'}, e.up_button, e.down_button))
			e.input_group.set([e.input, e.updown_box])
		} else if (v == 'plus-minus') {
			e.up_button   = button({
				classes: 'num-input-button num-input-button-plusminus num-input-button-plus',
				focusable: false,
				type: 'button',
				icon: svg_plus_sign(),
			})
			e.down_button = button({
				classes: 'num-input-button num-input-button-plusminus num-input-button-minus',
				focusable: false,
				type: 'button',
				icon: svg_minus_sign(),
			})
			e.input_group.set([e.down_button, e.input, e.up_button])
		}
		if (e.up_button) {
			e.up_button  .on('pointerdown',   up_button_pointerdown)
			e.down_button.on('pointerdown', down_button_pointerdown)
		}
		update_buttons()
	}

	e.to_num = num

	e.to_text = function(v) {
		if (v == null) return null
		return e.decimals != null ? v.dec(e.decimals) : v+''
	}
	e.to_form = e.to_text
	let to_input = e.to_text

	e.set_readonly = function(v) {
		v = !!v
		e.class('readonly', v)
		e.input.bool_attr('readonly', v)
		update_buttons()
	}

	e.set_decimals = function() {
		e.update({value: true})
	}

	e.on_init(function() {
		e.set_buttons(e.buttons)
	})

	e.on_update(function(opt) {
		if (opt.value)
			e.input.value = e.value != null ? to_input(e.value)
				: isnum(e.input_value) ? to_input(e.input_value) : e.input_value
		if (opt.select_all)
			e.input.select_range(0, -1)
	})

	e.increment_value = function(increment, ctrl, ev) {
		let v = e.value
		if (v == null) v = increment > 0 ? e.min : e.max
		if (v == null) return
		let m = e.decimals ? 1 / 10 ** e.decimals : 1
		v += m * increment * (ctrl ? 10 : 1)
		v = snap(v, m)
		if (e.try_validate(v))
			e.set_prop('input_value', v, ev)
		e.update({select_all: true})
	}

	// controller

	e.on_validate(function(ev) {
		if (!(ev && ev.target == e.input))
			e.update({value: true})
	})

	e.input.on('input', function(ev) {
		if (repl(repl(this.value, '-'), '.') == null)
			return // just started typing, don't buzz.
		e.set_prop('input_value', this.value, ev)
	})

	e.input.on('wheel', function(ev, dy) {
		e.increment_value(round(-dy / 120))
		return false
	})

	e.on('keydown', function(key, shift, ctrl, alt, ev) {
		if (alt)
			return
		if (key == 'ArrowDown' || key == 'ArrowUp') {
			e.increment_value(key == 'ArrowDown' ? 1 : -1, shift || ctrl, ev)
			return false
		}
	})

	function button_pointerdown(ev, increment) {
		let ctrl = ev.shift || ev.ctrl
		let increment_timer = timer(function() {
			e.increment_value(increment, ctrl, ev)
			increment_timer(.1)
		})
		e.increment_value(increment, ctrl, ev)
		increment_timer(.5)
		return this.capture_pointer(ev, null, function() {
			increment_timer()
		})
	}

	function up_button_pointerdown(ev) {
		return button_pointerdown.call(this, ev, 1)
	}

	function down_button_pointerdown(ev) {
		return button_pointerdown.call(this, ev, -1)
	}

})

/* <pass-input> --------------------------------------------------------------

inherits:
	input_widget
config:
	minlen
	conditions
update options:
	select_all

*/

// NOTE: we use 'skip' on the root element and create an <input-group> inside
// so that we can add popups to the widget without messing up the CSS.
css('.pass-input', 'skip')
css('.pass-input-group', 'w-input bg-input')
css('.pass-input-input', 'S shrinks p-r-0')
css('.pass-input-button', 'h-m h-c b p0 label', `width: 2.75em;`)
css_state('.pass-input-button', 'bg-input')
css_state('.pass-input[invalid] .pass-input-button', 'bg-error')
css_generic_state('.pass-input-button[disabled]', 'op1 no-filter dim')

G.pass_input = component('pass-input', 'Input', function(e) {

	e.clear()
	e.class('pass-input')
	e.input_group = div({class: 'input-group b-collapse-h ro-collapse-h'})
	e.add(e.input_group)

	e.make_input_widget({
		errors_tooltip_target: e.input_group,
	})

	e.prop('minlen', {type: 'number'})
	e.prop('conditions', {type: 'words', convert: words,
		default: 'lower upper digit symbol'})

	e.input = input({classes: 'pass-input-input', type: 'password'})
	e.eye_button = button({
		type: 'button',
		classes: 'pass-input-button',
		icon: 'far fa-eye',
		bare: true,
		focusable: false,
		title: S('view_password', 'View password'),
	})
	e.input_group.add(e.input, e.eye_button)

	e.prop('placeholder', {store: false})
	e.get_placeholder = () => e.input.placeholder
	e.set_placeholder = function(s) { e.input.placeholder = s }

	e.make_focusable(e.input)
	e.make_focus_ring(e.input)

	e.on_update(function(opt) {
		if (opt.select_all)
			e.input.select_range(0, -1)
	})

	// controller

	e.do_after('set_input_value', function(v, v0, ev) {
		if (!(ev && ev.target == e.input))
			e.input.value = v
		e.eye_button.disable('empty', !v)
	})

	e.input.on('input', function(ev) {
		e.set_prop('input_value', this.value, ev)
	})

	e.eye_button.on('pointerdown', function(ev) {
		e.input.type = null
		let i = e.input.selectionStart
		let j = e.input.selectionEnd
		return this.capture_pointer(ev, null, function() {
			e.input.type = 'password'
			e.input.setSelectionRange(i, j)
			return false
		})
	})

})

/* <tags-box> ----------------------------------------------------------------

state:
	tags: 'tag1 ...' || ['tag1', ...]

*/

css('.tags-box', 'm-y p-y-05 h-m flex-wrap gap-y', `
	--tag-hue: 154;
`)

css('.tags-tag', 'm-x-05 p-y-025 p-x-input gap-x ro-var-075 h-m noselect', `
	background  : hsl(var(--tag-hue), 32%, 28%);
	color       : hsl(var(--tag-hue), 87%, 61%);
`)
css_role(':is(.xsmall, .small, .smaller).tags-box, :is(.xsmall, .small, .smaller) :is(.tags-box, .tags-tag)', 'p-y-0')
css_role_state('.tags-tag:focus-visible', '', `
	background  : hsl(var(--tag-hue), 32%, 38%);
`)

css('.tags-x', 'round fg h-m h-c small bold', `
	width : 1.1em;
	height: 1.1em;
	color : hsl(var(--tag-hue), 63%, 43%);
`)
css_state('.tags-x:hover', '', `
	color : hsl(var(--tag-hue), 63%, 53%);
`)
css_state('.tags-x:active', '', `
	color : hsl(var(--tag-hue), 63%, 63%);
`)

G.tags_box = component('tags-box', function(e) {

	e.class('tags-box')
	e.make_disablable()

	// model

	function convert_tags(tags) {
		return words(tags).remove_duplicates()
	}

	e.prop('tags', {type: 'array', element_type: 'string', convert: convert_tags})

	e.remove_tag = function(tag) {
		let t1 = e.tags.slice()
		let i = t1.remove_value(tag)
		e.tags = t1
		return i
	}

	// view

	e.clear()

	e.make_tag = function(tag) {
		let x = svg_circle_x({class: 'tags-x'})
		let t = div({class: 'tags-tag'}, tag, x)
		t.make_focusable()
		t.on('keydown', tag_keydown)
		x.on('pointerdown', return_false) // prevent bubbling
		x.on('click', tag_x_click)
		return t
	}

	e.set_tags = function(tags) {
		e.clear()
		for (let tag of tags)
			e.add(e.make_tag(tag))
	}

	e.tag_box = function(tag) {
		let i = e.tags.indexOf(tag)
		return i != -1 ? e.at[i] : null
	}

	e.focus_tag = function(tag) {
		let t = e.tag_box(tag)
		if (t) t.focus()
	}

	// controller

	function tag_x_click() {
		e.remove_tag(this.parent.textContent)
	}

	function tag_keydown(key) {
		if (key == 'Delete') {
			let i = e.remove_tag(this.textContent)
			let next_tag = e.at[i] || e.last
			if (next_tag) {
				next_tag.focus()
				return false
			}
		}
		if (key == 'ArrowLeft' || key == 'ArrowRight') {
			let is_next = key == 'ArrowRight'
			let next_tag = is_next ? this.next : this.prev
			if (next_tag) {
				next_tag.focus()
				return false
			}
		}
	}

})

/* <tags-input> --------------------------------------------------------------

config:
	nowrap
state:
	tags: 'tag1 ...' || ['tag1', ...]

*/

css('.tags-input', 'shrinks')
css('.tags-input-inpu', 'S')
css('.tags-scrollbox', 'shrinks h-m b-r-0 clip')
css('.tags-input .tags-box', 'rel shrinks m0')
css('.tags-input .tags-input-input', 'p-x-input b-l-0', `min-width: 5em;`)
css('.tags-box-nowrap', 'flex-nowrap')

G.tags_input = component('tags-input', function(e) {

	e.clear()

	e.class('tags-input input-group')
	e.make_disablable()

	e.prop('name')
	e.prop('form', {type: 'id', store: false})
	e.set_name = function(s) { e.input.name = s }
	e.get_form = function() { return e.input.form }
	e.set_form = function(s) { e.value_input.form = s }

	e.tags_box = tags_box()
	e.tag_input = tag('input', {class: 'tags-input-input', placeholder: 'Tag'})
	e.input = tag('input', {type: 'hidden', hidden: ''})
	e.add(div({class: 'tags-scrollbox'}, e.tags_box), e.tag_input, e.input)
	e.make_focusable(e.tag_input)
	e.make_focus_ring(e.tag_input)

	e.prop('tags', {store: false})
	e.get_tags = () => e.tags_box.tags
	e.set_tags = function(v) {
		e.tags_box.tags = v
		e.input.value = json(e.tags_box.tags)
	}

	e.prop('nowrap', {type: 'bool'})
	e.set_nowrap = (v) => e.tags_box.class('tags-box-nowrap', !!v)

	e.tag_input.on('keydown', function(key) {
		if (key == 'Backspace') {
			let s = this.value
			if (s) {
				let s1 = this.selectionStart
				let s2 = this.selectionEnd
				if (s1 != s2) return
				if (s1 != 0) return
			}
			e.tags = e.tags.slice(0, -1)
			return false
		}
		if (key == 'Enter') {
			let s = this.value
			if (!s) return
			let t1 = e.tags.slice()
			t1.remove_value(s)
			t1.push(s)
			e.tags = t1
			this.value = ''
			e.tags_box.focus_tag(s) // scroll tag into view
			e.tag_input.focus()
			return false
		}
	})

	e.tags_box.on('hover', function(ev, on) {
		this.class('grab', on && !ev.target.closest('.tags-x') && this.sw > this.cw)
	})

	e.tags_box.on('pointerdown', function(ev, mx0) {
		mx0 -= this.x || 0
		let w = this.sw - this.cw
		if (w == 0) {
			this.x = null
			return
		}
		return this.capture_pointer(ev, function(ev, mx) {
			this.x = clamp(mx - mx0, -w, 0)
			this.class('grabbing')
		}, function() {
			this.class('grabbing', false)
		})

	})

})

/* <dropdown> ----------------------------------------------------------------

config props:
	align: left | right
	list:
html attrs:
	align: left | right
inner html:
	<list>
state in props:
	search
	value
state out props:
	isopen
methods:
	lookup(value) -> i
	set_open(on, [focus])
	open([focus])  close([focus])  toggle([focus])
update opts:
	value

*/

// NOTE: we use 'skip' on the root element and create an <inputbox> inside
// so that we can add popups to the widget without messing up the CSS.
css('.dropdown', 'skip')
css('.dropdown-inputbox', 'gap-x arrow h-sb bg-input w-input')
css('.dropdown-value', 'S')
css('.dropdown.empty .dropdown-value::before', 'zwsp') // .empty condition because we use gap-x.
css('.dropdown-chevron', 'smaller ease')
css('.dropdown.open .dropdown-chevron::before', 'icon-chevron-up ease')
css('.dropdown:not(.open) .dropdown-chevron::before', 'icon-chevron-down ease')
css('.dropdown-xbutton', 'm0 p0 label smaller')
css('.dropdown-xbutton::before', 'fa fa-times lh1')

css('.dropdown-picker', 'b v-s p-y-input bg-input z3 arrow', `
	margin-top: -2px; /* merge dropdown and picker outlines */
	resize: both;
	height: 12em; /* TODO: what we want is max-height but then resizer doesn't work! */
`)
css('.dropdown-picker > *', 'p-input')
css('.dropdown[align=right] .dropdown-xbutton', '', `order: 2;`)
css('.dropdown[align=right] .dropdown-value'  , '', `order: 3;`)

css('.dropdown-search', 'fg-search bg-search')

// TODO: fix this on Firefox but note that :focus-within is buggy on FF,
// it gets stuck even when focus is on anoher widget, so it's not an easy fix.
css_state('.dropdown:has(:focus-visible) .dropdown-picker', 'outline-focus')

css_state('.dropdown[invalid] .dropdown-inputbox', 'bg-error')

G.dropdown = component('dropdown', 'Input', function(e) {

	e.class('dropdown')
	e.make_disablable()
	e.init_child_components()

	let html_list = e.$1('list')

	if (!html_list) { // static list
		html_list = div()
		for (let ce of [...e.at])
			html_list.add(ce)
		e.clear()
	}

	e.inputbox = div({class: 'inputbox dropdown-inputbox'})
	e.add(e.inputbox)

	e.make_focusable(e.inputbox)

	e.make_input_widget({
		errors_tooltip_target: e.inputbox,
	})

	// model: value lookup

	function item_value(item_e) {
		if (item_e.data != null) { // dynamic list with a data model
			return item_e.data.value
		} else { // static list, value kept in a prop or attr.
			return strict_or(item_e.value, item_e.attr('value'))
		}
	}

	let lookup = map() // {value->list_index}
	function list_items_changed() {
		lookup.clear()
		let list = this
		for (let i = 0, n = list.list_len; i < n; i++) {
			let value = item_value(list.at[i])
			if (value !== undefined)
				lookup.set(value, i)
		}
		e.validate()
	}

	e.lookup = function(value) {
		return lookup.get(value)
	}

	// validation

	e.value_known = e.lookup

	// model/view: list prop: set it up as picker.

	function bind_list(list, on) {
		if (!list) return
		list.on('input', list_input, on)
		list.on('items_changed', list_items_changed, on)
		list.on('search', list_search, on)
		list.on('pointerdown', list_pointerdown, on)
		list.on('click', list_click, on)
		if (on) {
			list.make_list_items_focusable({multiselect: false})
			list.make_list_items_searchable()
			list_items_changed.call(list)
			let item_i = e.lookup(e.value)
			list.focus_item(item_i ?? false)
			list.class('dropdown-picker scroll-thin')
			list.popup(e.inputbox, 'bottom', 'start')
			list.hide()
			e.add(list)
		} else {
			list.remove()
		}
		e.update({value: true})
	}

	e.set_list = function(list1, list0) {
		if (!e.initialized) return
		bind_list(list0, false)
		bind_list(list1, true)
	}

	e.on_init(function() {
		bind_list(e.list, true)
	})

	e.prop('list', {type: 'list'})

	// view -------------------------------------------------------------------

	e.value_box = div({class: 'dropdown-value'})
	e.chevron   = div({class: 'dropdown-chevron'})
	e.xbutton   = button({bare: true, focusable: false, classes: 'dropdown-xbutton'})
	e.inputbox.add(e.value_box, e.xbutton, e.chevron)

	e.prop('align', {type: 'enum', enum_values: 'left right', defualt: 'left', attr: true})

	e.set_required = function() {
		e.update({value: true})
	}

	e.on_update(function(opt) {
		if (opt.value) {
			let i = e.lookup(e.value)
			if (i != null) {
				let item_e = e.list.at[i].clone()
				item_e.id = null // id would be duplicated.
				item_e.selected = null
				e.list.update_item_state(item_e)
				e.value_box.set(item_e)
			} else {
				e.value_box.clear()
			}
			e.class('empty', i == null)
			e.xbutton.show(e.value != null && !e.required)
		}
	})

	let w
	e.on_measure(function() {
		w = e.inputbox.rect().w
	})
	e.on_position(function() {
		if (!e.list) return
		e.list.min_w = w
	})

	// open state -------------------------------------------------------------

	e.property('isopen',
		function() {
			return e.hasclass('open')
		},
		function(open) {
			e.set_open(open, true)
		}
	)

	e.set_open = function(open, focus) {
		if (e.isopen != open) {
			let w = e.rect().w
			e.class('open', open)
			if (open) {
				e.list.update({show: true})
				e.list.focus_item(true, 0, {
					make_visible: true,
					must_not_move: true,
				})
			} else {
				e.list.hide()
				e.list.search('')
			}
		}
		if (focus)
			e.focus()
	}

	e.open   = function(focus) { e.set_open(true, focus) }
	e.close  = function(focus) { e.set_open(false, focus) }
	e.toggle = function(focus) { e.set_open(!e.isopen, focus) }

	// controller -------------------------------------------------------------

	e.inputbox.on('pointerdown', function(ev) {
		e.toggle()
	})

	e.inputbox.on('blur', function(ev) {
		e.close()
	})

	e.on_validate(function(ev) {
		if (e.list && e.list.ispopup && !(ev && ev.target == e.list)) {
			e.list.focus_item(e.lookup(e.value) ?? false, 0, {
				must_not_move: true,
				event: ev,
			})
		}
		e.update({value: true})
	})

	function list_input(ev) {
		let v = this.focused_item ? item_value(this.focused_item) : null
		e.set_prop('input_value', v, ev)
	}

	function list_search() {
		if (this.search_string)
			e.open()
		e.update({value: true})
	}

	function list_pointerdown(ev) {
		if (ev.target == this)
			return // let resizer work
		// prevent ^blur event in inputbox that would close the dropdown.
		ev.preventDefault()
	}

	function list_click(ev) {
		if (ev.target == this)
			return // let resizer work
		e.close()
	}

	e.inputbox.on('keydown', function(key, shift, ctrl, alt, ev) {
		let free_key = !(alt || shift || ctrl)
		if (
			(free_key && key == ' ' && !e.list.search_string)
			|| (alt && (key == 'ArrowDown' || key == 'ArrowUp'))
			|| (free_key && key == 'Enter')
		) {
			e.toggle(true)
			return false
		}
		if (key == 'Escape') {
			e.close()
			return false
		}
		if (key == 'Delete') {
			e.set_prop('input_value', null, ev)
			return false
		}

		if (ev.target.closest_child(e) == e.list) // event bubbled back from the picker.
			return

		// forward all other keyboard events to the picker like it was focused.
		return ev.forward(e.list)
	})

	e.inputbox.on('wheel', function(ev, dy) {
		if (ev.target.closest_child(e) != e.list) // event wasn't bubbled from the picker.
			if (e.list)
				e.list.focus_item(true, round(-dy / 120))
	})

	e.xbutton.on('pointerdown', function(ev) {
		e.set_prop('input_value', null, ev)
		return false
	})

	return {list: html_list}

})

/* <autocomplete> ------------------------------------------------------------

in props:

update opt:
	input

*/

css('.autocomplete', 'b v-s p-input bg-input z3', `
	resize: both;
`)

G.autocomplete = component('autocomplete', 'Input', function(e) {

	e.class('autocomplete')
	e.make_disablable()
	e.init_child_components()

	let html_list = e.$1('list')

	if (!html_list) { // static list
		html_list = div()
		for (let ce of [...e.at])
			html_list.add(ce)
		html_list.make_list_items_focusable()
		e.clear()
	}

	function bind_list(list, on) {
		if (!list) return
		if (on) {
			list.make_list_items_focusable({multiselect: false})
			list_items_changed.call(list)
			list.class('dropdown-picker')
			list.popup(null, 'bottom', 'start')
			list.hide()
			list.on('search', function() {
				e.open()
			})
			e.add(list)
		} else {
			list.remove()
		}
		e.update({value: true})
	}

	e.set_list = function(list1, list0) {
		bind_list(list0, false)
		bind_list(list1, true)
	}

	e.prop('list', {private: true})

	function item_value(item_e, k) {
		if (item_e.data != null) { // dynamic list with a data model
			return item_e.data[k]
		} else { // static list, value kept in a prop or attr.
			return strict_or(item_e[k], item_e.attr(k))
		}
	}

	function input_input(ev) {
		e.update({input: this.value, show: !!this.value})
	}

	e.on_update(function(opt) {
		if (opt.input) {
			let list = this
			for (let i = 0, n = list.list_len; i < n; i++) {
				let item_e = list.at[i]
				let text = item_value(item_e, 'text')
				let matches = text != null && text.starts(prefix)
				// if (matches)

				item_e.show(matches)
			}
		}
	})

	e.bind_input = function(input, on) {
		if (warn_if(input.tag != 'input', 'autocomplete: not an input tag: {0}', e.input_id))
			return
		input.on('input', input_input, on)
		e.popup_target = on ? input : null
		e.show(!!input.value)
	}

	e.prop('input_id', {type: 'id', attr: 'for', on_bind: e.bind_input})

	e.popup(null, 'bottom', 'start')
	e.hide()

	return {list: html_list}

})

/* <calendar> ----------------------------------------------------------------

state props:
	mode           'day|range|ranges'
	value          day mode    : string date or timestamp
	value1 value2  range mode  : start & end dates or timestamps
	ranges         ranges mode : 'd1..d2 ...' or [[d1,d2],...]

range state:
	readonly             range is read-only
	disabled             range is disabled
	focusable: false     range is non-focusable
	color                range background color
	z-index              range z-index

TODO:
	* disabled range coloring
	* anchor_direction missing (shift+arrows, dragging)

*/

css(':root', '', `
	--min-w-calendar: 16em; /* more than 16em is too wide as a picker */
	--min-h-calendar: 20em;
	--fs-calendar-months   : 1.25;
	--fs-calendar-weekdays : 0.75;
	--fs-calendar-month    : 0.65;
	--p-y-calendar-days-em: .4;
	--fg-calendar-month: red;
`)

css('.calendar', 'v-s', `
	min-width : var(--min-w-calendar);
	min-height: var(--min-h-calendar);
`)

css('.calendar-canvas-ct', 'S rel')
css('.calendar-canvas', 'abs')

function calendar_widget(e, mode) {

	let html_value
	if (mode == 'ranges') {
		html_value = []
		for (let range of e.$('range')) {
			let r = convert_range(range.textContent)
			if (r.length == 2) {
				r.color       = range.attr('color')
				r.focusable   = range.bool_attr('focusable')
				r.readonly    = range.bool_attr('readonly')
				r.disalbed    = range.bool_attr('disabled')
				r.z_index     = range.bool_attr('z-index')
				html_value.push(r)
			}
		}
	}
	e.clear()

	e.class('calendar focusable-items')
	e.make_disablable()
	e.make_focusable()

	// model & state ----------------------------------------------------------

	function convert_date(s) {
		return day(parse_date(s, 'SQL'))
	}
	function convert_range(s) {
		return assign((isstr(s) ? s.split(/\.\./) : s).map(convert_date), isstr(s) ? null : s)
	}
	function convert_ranges(s) {
		return words(s).map(convert_range)
	}

	let ranges = [] // ranges in initial order.
	let focus_ranges = [] // same but in paint order.
	let draw_ranges  = [] // same but in paint order with focused range on top.
	let focused_range = null

	if (mode == 'day' || mode == 'range') { // single static range, always focused.
		focused_range = []
		ranges.push(focused_range)
		focus_ranges[0] = focused_range
		draw_ranges [0] = focused_range
	}
	if (mode == 'day') {
		e.prop('value', {store: false, type: 'time', convert: convert_date})
		e.get_value = () => ranges[0][0]
		e.set_value = function(d) {
			ranges[0][0] = day(d)
			ranges[0][1] = day(d)
		}
	} else if (mode == 'range') {
		e.prop('value1', {store: false, type: 'time', convert: convert_date})
		e.prop('value2', {store: false, type: 'time', convert: convert_date})
		e.get_value1 = () => ranges[0][0]
		e.get_value2 = () => ranges[0][1]
		e.set_value1 = function(d) {
			ranges[0][0] = day(d)
		}
		e.set_value2 = function(d) {
			ranges[0][1] = day(d)
		}
	} else if (mode == 'ranges') {
		e.prop('value', {store: false, type: 'array', element_type: 'date_range',
				convert: convert_ranges})
		e.get_value = () => ranges
		e.set_value = function(ranges1) {
			ranges = ranges1
			if (!ranges.includes(focused_range))
				focused_range = null
			sort_ranges()
		}
	} else {
		assert(false)
	}

	// sometimes we mutate ranges so we have to announce value prop changes manually.
	function ranges_changed() {
		let ranges0 = ranges // TODO: save ranges before modifying so we get correct old value?
		if (mode == 'day') {
			announce_prop_changed(e, 'value', ranges[0][0], ranges0[0][0])
		} else if (mode == 'range') {
			announce_prop_changed(e, 'value1', ranges[0][0], ranges0[0][0])
			announce_prop_changed(e, 'value2', ranges[0][1], ranges0[0][1])
		} else if (mode == 'ranges') {
			announce_prop_changed(e, 'value', ranges, ranges0)
		}
		e.fire('input', {target: e})
	}

	function sort_ranges() {
		if (mode == 'ranges') {
			focus_ranges.set(ranges)
			focus_ranges.sort(function(r1, r2) {
				if ((r1.z_index || 0) < (r2.z_index || 0)) return -1
				if (r1[0] < r2[0]) return -1
				if (r1[0] > r2[0]) return  1
				if (r1[1] > r2[1]) return -1
				if (r1[1] < r2[1]) return  1
				return 0
			})
			draw_ranges.set(ranges)
			if (focused_range && focused_range != draw_ranges.last) {
				draw_ranges.remove_value(focused_range)
				draw_ranges.push(focused_range)
			}
		}
		e.update()
	}

	e.focus_range = function(range, scroll_duration, scroll_center) {
		assert(!range || ranges.includes(range))
		if (range && !e.can_focus_range(range))
			return false
		if (mode == 'ranges') {
			focused_range = range
			sort_ranges()
		}
		if (range && scroll_duration !== false)
			e.scroll_to_view_range(range[0], range[1], scroll_duration, scroll_center)
		return true
	}

	e.focus_next_range = function(backwards) {
		if (!focus_ranges.length)
			return false
		let step = backwards ? -1 : 1
		let max_i = focus_ranges.length - 1
		let i = focused_range ? focus_ranges.indexOf(focused_range) + step : backwards ? max_i : 0
		while (backwards ? i >= 0 : i <= max_i) {
			let r = focus_ranges[i]
			if (e.focus_range(r))
				return true
			i += step
		}
		return false
	}

	e.property('focused_range', () => focused_range)

	e.can_focus_range = function(range) { // stub
		if (range.disabled) return false
		if (range.focusable != null) return range.focusable
		return !range.readonly
	}

	e.can_change_range = function(range) { // stub
		return !e.readonly && !range.disabled
	}

	e.can_remove_range = function(range) { // stub
		return e.can_change_range(range)
	}

	e.can_add_range = function(d1, d2) { // stub
		return true
	}

	e.create_range = function(d1, d2) { // stub
		return [d1, d2]
	}

	// view -------------------------------------------------------------------

	let ct = resizeable_canvas_container()
	e.add(ct)

	// view config, computed styles and measurements

	let view_x, view_y, view_w, view_h
	let cell_w, cell_h, cell_py
	let font_weekdays, font_weekdays_ascent
	let font_days, font_days_ascent
	let font_months, font_months_ascent, font_months_h
	let font_month
	let fg, fg_label, bg_alt, bg_smoke, fg_month, border_light
	let fg_focused_selected, fg_unfocused_selected
	let bg_focused_selected, bg_unfocused_selected
	let outline_focus

	// deferred scroll state
	let sy_week1, sy_week2, sy_center
	let sy_weeks = 0
	let sy_pages = 0
	let sy_duration = '_none'
	let sy_dt

	e.on_update(function(opt) {
		ct.update()
		if (opt.focus)
			e.focus()
	})

	ct.on_measure(function() {

		let dpr = devicePixelRatio
		let cr = ct.rect()
		let css = e.css()

		font_weekdays = num(css.fontSize) * dpr * num(css.prop('--fs-calendar-weekdays')) + 'px ' + css.fontFamily
		font_days     = num(css.fontSize) * dpr + 'px ' + css.fontFamily
		font_months   = num(css.fontSize) * dpr * num(css.prop('--fs-calendar-months')) + 'px ' + css.fontFamily
		font_month    = num(css.fontSize) * dpr * num(css.prop('--fs-calendar-month')) + 'px ' + css.fontFamily

		let cx = ct.context
		let m
		cx.font = font_weekdays
		m = cx.measureText('My')
		font_weekdays_ascent = m.actualBoundingBoxAscent / dpr

		cx.font = font_days
		m = cx.measureText('My')
		font_days_ascent = m.actualBoundingBoxAscent / dpr

		cx.font = font_months
		m = cx.measureText('My')
		font_months_ascent = m.actualBoundingBoxAscent / dpr
		font_months_h = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / dpr

		let em   = num(css.fontSize)
		let cell_lh = num(css.lineHeight)
		cell_py  = num(css.prop('--p-y-calendar-days-em')) * em
		cell_w   = snap(cell_lh + 2 * cell_py, 2)
		cell_h   = snap(cell_lh + 2 * cell_py, 2)
		fg       = css.prop('--fg')
		fg_label = css.prop('--fg-label')
		bg_alt   = css.prop('--bg-alt')
		bg_smoke = css.prop('--bg-smoke')
		fg_month = css.prop('--fg-calendar-month')
		border_light = css.prop('--border-light')
		fg_focused_selected   = css.prop('--fg-focused-selected')
		bg_focused_selected   = css.prop('--bg-focused-selected')
		fg_unfocused_selected = css.prop('--fg-unfocused-selected')
		bg_unfocused_selected = css.prop('--bg-unfocused-selected')
		outline_focus         = css.prop('--outline-focus')

		view_x = cr.x
		view_y = cr.y
		view_w = cr.w
		view_h = cr.h - cell_h

		// apply scrolling that was deferred to measuring.
		sy_dt = null
		if (sy_duration != '_none') {

			if (sy_week1 != null) {
				if (start_week == null)
					start_week = week(time())
				let y1 = (days(sy_week1 - start_week) / 7) * cell_h
				let y2 = (days(sy_week2 - start_week) / 7) * cell_h
				sy_final = scroll_to_view_dim(y1, y2 - y1 + cell_h, view_h, sy_now, sy_center ? 'center' : null)
			} else {
				sy_final += sy_weeks * cell_h + sy_pages * view_h
			}

			if (sy_duration == 'inertial') // drag'n'drop-triggered
				sy_dt = clamp(abs(sy_final - sy_now) * .002, .1, .6)
			else // keyboard triggered
				sy_dt = clamp(sy_duration ?? 1/0, 0, .4)

			if (sy_dt == 0)
				sy_now = sy_final
			if (sy_now == sy_final)
				sy_dt = 0

			sy_week1 = null
			sy_week2 = null
			sy_center = null
			sy_weeks = 0
			sy_pages = 0
			sy_duration = '_none'
		}
	})

	ct.on_position(function() {
		if (sy_dt != null) {
			scroll_transition.restart(sy_dt, sy_now, sy_final)
			sy_dt = null
		}
	})

	// scroll state

	let start_week
	let sy_now   = 0 // in pixels, while animating.
	let sy_final = 0 // in pixels, final.
	let drag_scroll

	let scroll_transition = transition(function(sy) {
		sy_now = sy
		ct.redraw_now() // we're already in an animation frame.
	})

	e.scroll_to = function(sy, duration) {
		sy_final = sy
		sy_duration = duration
		e.update()
	}

	e.scroll_by = function(dy, duration) {
		e.scroll_to(sy_final + dy, duration)
	}

	e.scroll_by_weeks = function(dy_weeks, duration) {
		sy_weeks += dy_weeks
		sy_duration = duration
		e.update()
	}

	e.scroll_by_pages = function(dy_pages, duration) {
		sy_pages += dy_pages
		sy_duration = duration
		e.update()
	}

	e.scroll_to_view_range = function(d1, d2, duration, center) {
		if (d1 == null && d2 == null) {
			let now = time()
			d1 = now
			d2 = now
		} else if (d1 == null) {
			d1 = d2
		} else if (d2 == null) {
			d2 = d1
		}
		sy_week1 = week(d1)
		sy_week2 = week(d2)
		sy_duration = duration
		sy_center = center
		e.update()
	}

	e.scroll_to_view_all_ranges = function(duration, center) {
		let d1, d2
		for (let r of ranges) {
			if (r[0] != null) d1 = min(d1 ??  1/0, r[0])
			if (r[1] != null) d2 = max(d2 ?? -1/0, r[1])
		}
		e.scroll_to_view_range(d1, d2, duration, center)
	}

	e.scroll_to_view_value = function(scroll_align, scroll_smooth) {
		e.scroll_to_view_all_ranges(scroll_smooth ? 1/0 : 0, scroll_align == 'center')
	}

	function update_scroll() {
		e.scroll_to_view_all_ranges(0, true)
	}

	e.on_bind(function(on) {
		listen('layout_changed', update_scroll, on)
		if (on)
			update_scroll()
	})

	// hit state & drag state

	let hit_mx, hit_my
	let hit_day
	let hit_range
	let hit_range_end
	let drag_range
	let drag_range_end
	let down
	let invalid

	// drawing & hit testing

	function hit_test_rect(mx, my, x1, y1, x2, y2) {
		return (
			mx >= x1 && mx <= x2 &&
			my >= y1 && my <= y2
		)
	}
	function hit_test_circle(mx, my, cx, cy, r) {
		return hit_test_rect(mx, my, cx - r, cy - r, cx + r, cy + r)
	}

	// drawing translation state. not using transforms because we want pixel snapping.
	// note that mouse coords are already in user space (so scaled) not in pixel space.
	let x0, y0, dpr
	function move(x, y) {
		x0 += x
		y0 += y
	}
	// user-space to pixel-space i.e. translated and pixel-snapped coords and dimensions.
	function rx(x) { return round((x0 + x) * dpr) }
	function ry(y) { return round((y0 + y) * dpr) }
	function rw(w) { return round(w * dpr) }
	function rh(h) { return round(h * dpr) }

	let gh = [obj(), obj()] // see below...

	ct.on_redraw(function(cx, _, __, pass) {

		x0 = 0
		y0 = 0
		dpr = devicePixelRatio

		if (start_week == null)
			start_week = week(time())

		cx.resetTransform() // we do our own hi-dpi scaling.

		// break down scroll offset into start week and relative scroll offset.
		let sy_weeks_f = sy_now / cell_h
		let sy_weeks = trunc(sy_weeks_f)
		let sy = (sy_weeks_f - sy_weeks) * cell_h
		let week0 = week(start_week, -sy_weeks)

		// update hit state.
		let mx = hit_mx - view_x
		let my = hit_my - view_y

		// center the view horizontally on the container
		move((view_w - cell_w * 7) / 2, 0)

		cx.textAlign = 'center'

		// draw week day names header
		cx.font = font_weekdays
		for (let weekday = 0; weekday < 7; weekday++) {
			let s = weekday_name(day(week0, weekday), 'short', lang()).slice(0, 1).upper()
			let x = weekday * cell_w
			cx.fillStyle = fg_label
			cx.fillText(s, rx(x + cell_w / 2), ry(cell_h / 2 + font_weekdays_ascent / 2))
		}
		cx.beginPath()

		let y = ry(cell_h * 1.0) - .5
		cx.moveTo(0, y)
		cx.lineTo(rx(view_w), y)
		cx.strokeStyle = border_light
		cx.stroke()

		// go under the header
		move(0, cell_h)

		let hit_days = !!drag_range || (mx-x0 >= 0 && my-y0 >= 0 && mx-x0 <= cell_w * 7)

		cx.beginPath()
		cx.rect(rx(-10000), ry(0), rw(20000), rh(20000))
		cx.clip()

		// go at scroll position.
		move(0, sy)

		let visible_weeks = floor(view_h / cell_h) + 2

		// draw & hit-test calendar
		hit_day = null
		hit_range = null
		hit_range_end = null

		let now = time()
		let today = day(now)

		// align UTC-today to local-today.
		let today_local = day(now, 0, true)
		if (month_day_of(today_local, true) != month_day_of(today))
			today = day(today, today_local < today ? -1 : 1)

		// draw month alt. background
		let d_days = -7
		for (let week_i = -1; week_i <= visible_weeks; week_i++) {
			for (let weekday = 0; weekday < 7; weekday++) {
				let d = day(week0, d_days)

				let x = weekday * cell_w
				let y = week_i * cell_h

				let _x0 = x0
				let _y0 = y0
				move(x, y)

				let alt_month = month_of(d) % 2 == 0
				if (alt_month) {
					cx.fillStyle = bg_alt
					cx.fillRect(rx(0), ry(0), rw(cell_w), rh(cell_h))
				}

				x0 = _x0
				y0 = _y0
				d_days++
			}
		}

		cx.strokeStyle = outline_focus
		cx.lineWidth = rh(2)

		let focused = e.focused
		let focus_visible = mode == 'day' ? e.focus_visible : focused

		let gh_set = false
		d_days = -7
		for (let week_i = -1; week_i <= visible_weeks; week_i++) {
			for (let weekday = 0; weekday < 7; weekday++) {
				let d = day(week0, d_days)
				let m = month(d)
				let n = floor(1 + days(d - m))

				let x = weekday * cell_w
				let y = week_i * cell_h

				let _x0 = x0
				let _y0 = y0
				move(x, y)

				// hit-test calendar day cell
				let cell_hit_x = drag_range && weekday == 0 ? -1/0 : 0
				let cell_hit_w = drag_range && weekday == 6 ?  1/0 : cell_w
				if (drag_range) {
					let offset = cell_w / 2 * (drag_range_end ? 1 : -1)
					cell_hit_x += offset
					cell_hit_w += offset
				}
				if (hit_day == null)
					if (hit_days)
						if (hit_test_rect(mx-x0, my-y0, cell_hit_x, 0, cell_hit_w, cell_h))
							hit_day = d

				// draw & hit-test ranges
				let in_range
				let p = 3 // padding so that stacked ranges don't touch
				let w = cell_w / 2 // width of half a cell, as we draw in halves.
				let h = cell_h - 2 * p
				for (let range of draw_ranges) {
					let r0 = range[0] ?? range[1] ??  1/0
					let r1 = range[1] ?? range[0] ?? -1/0
					if (d >= r0 && d <= r1) { // filter fast since it's O(n^2)
						in_range = true
						let range_focused = focused && range == focused_range
						let range_focus_visible = focus_visible && range_focused

						cx.fillStyle = range_focused ? bg_focused_selected
							: (range.color ?? bg_unfocused_selected)

						// hit-test range
						if (mode != 'day' && !hit_range && hit_test_rect(mx-x0, my-y0, 0, 0, cell_w, cell_h))
							hit_range = range

						// draw the day box in halves, each half being either
						// a range-end grabbing handle or a continuous fill.
						for (let ri = 0; ri <= 1; ri++) {
							let rd  = range[ri] // actual, can be null
							let vrd = rd ?? range[1-ri] ?? (2*ri-1) * 1/0 // virtual

							let _x0 = x0
							let _y0 = y0
							move(ri * w, p)

							let cy = ry(h / 2)
							let cr = rh(h / 2)

							if (d == vrd) { // this half is a range end

								if(rd != null) {
									cx.beginPath()
									if (!ri) // left side
										cx.arc(rx(w), cy, cr, PI / 2, 3 * PI / 2)
									else // right side
										cx.arc(rx(0), cy, cr, -PI / 2, PI / 2)
									cx.fill()
									if (range_focus_visible)
										cx.stroke()
								}

								// draw & hit-test range-end grab handle
								if (range_focused && mode != 'day') {

									let gcx = ri ? w-p : p
									let gcy = h / 2

									// hit-test range-end grab handle
									if (mode != 'day' && hit_range_end == null) {
										if (hit_test_circle(mx-x0, my-y0, gcx, gcy, w / 3)) {
											hit_range = range
											hit_range_end = ri
										}
									}

									// draw range-end grab handle, but not now, later.
									let on_range_end =
										(!down && hit_range == range && hit_range_end == ri)
										|| (drag_range == range && drag_range_end == ri)

									let r = w / (on_range_end ? 2.5 : 3)
									gh_set = true
									gh[ri].cx = rx(gcx)
									gh[ri].cy = ry(gcy)
									gh[ri].r  = r
								}

							} else { // this half is a continuous fill

								cx.fillRect(rx(0), cy-cr, rw(w + 1), cr * 2)

								if (range_focus_visible) {
									cx.beginPath()
									cx.moveTo(rx(0), cy-cr)
									cx.lineTo(rx(w), cy-cr)
									cx.moveTo(rx(0), cy+cr)
									cx.lineTo(rx(w), cy+cr)
									cx.stroke()
								}

							}

							x0 = _x0
							y0 = _y0
						}
					}
				}

				// draw calendar day cell
				cx.font = font_days
				cx.fillStyle = in_range ? (e.focused ? fg_focused_selected : fg_unfocused_selected) : fg
				cx.fillText(n, rx(cell_w / 2), ry(cell_h / 2 + font_days_ascent / 2))

				// draw month name of day-1 cell and of today
				if (n == 1 || d == today) {
					cx.font = font_month
					cx.fillStyle = fg_month
					let s = d == today ? S('today', 'Today').upper() : month_name(m, 'short').upper()
					cx.fillText(s,
						rx(cell_w / 2),
						ry(cell_h / 2 - font_days_ascent / 2 - 2)
					)
				}

				x0 = _x0
				y0 = _y0
				d_days++
			}

		}

		// draw range-end grab handles on top of cells because they're in-between cells.
		if (gh_set) {
			cx.fillStyle = cx.strokeStyle
			for (let ri = 0; ri <= 1; ri++) {
				let g = gh[ri]
				cx.beginPath()
				cx.arc(g.cx, g.cy, g.r, 0, 2 * PI)
				cx.fill()
			}
		}

		if (update_drag_range_end()) {
			assert(pass != 'update_range_end') // blow up fuse
			ct.redraw_again('update_range_end')
		}

		ct.style.cursor = (down ? drag_range_end : hit_range_end) != null ? 'ew-resize'
			: mode == 'range' && drag_scroll ? 'grabbing' : null

		// draw month name overlays while drag-scrolling
		if (drag_scroll) {
			move(cell_w * 7 / 2, 0) // move space to center
			let d_days = -(7 * 6)
			let m0
			for (let week_i = -(1 + 6); week_i <= visible_weeks + 6; week_i++) {
				let d = day(week0, d_days)
				let m = month(d)
				if (m != m0) {

					let week1 = week(month(d)) // first day of first week of the month of d
					let week2 = week(day(month(d, 1), -1)) // first day of last week of the month of d
					let y  = (days(week1 - week0) / 7) * cell_h
					let y2 = (days(week2 - week0) / 7) * cell_h
					let h = y2 - y + cell_h

					let year_s  = year_of(d) + ''
					let month_s = month_name(d, 'long')

					cx.font = font_months

					let px = 20
					let py = 10
					let m1 = cx.measureText(year_s)
					let m2 = cx.measureText(month_s)
					let text_w = max(m1.width, m2.width)
					let text_h = font_months_h * 2 + py

					cx.beginPath()
					cx.rect(
						rx(-text_w / 2 - px),
						ry(y + h / 2 - text_h / 2 - py),
						rw(text_w + 2 * px),
						rh(text_h + 2 * py),
					)
					cx.fillStyle = bg_smoke
					cx.fill()

					cx.fillStyle = fg
					cx.fillText(year_s,
						rx(0),
						ry(y + (h + font_months_ascent - font_months_h - py) / 2)
					)
					cx.fillText(month_s,
						rx(0),
						ry(y + (h + font_months_ascent + font_months_h + py) / 2)
					)

				}
				m0 = m
				d_days += 7
			}
		}

		invalid = false

	})

	// controller -------------------------------------------------------------

	e.on('blur' , function() {
		e.focus_range(null)
		e.update()
	})

	let pointerdown_ts

	let inh_focus = e.focus
	e.focus = function() {
		pointerdown_ts = clock() * 1000 // simulate click (i.e. no scroll)
		inh_focus.call(this)
	}

	e.on('focus', function(ev) {
		if (ev.timeStamp - pointerdown_ts < 100) // clicked
			return
		e.focus_range(focus_ranges.at(shift_pressed ? -1 : 0))
		e.update()
	})

	ct.on('wheel', function(ev, dy, is_trackpad) {
		e.scroll_by(dy, is_trackpad ? 0 : null)
	})

	ct.on('pointermove', function(ev, mx, my) {
		if (down)
			return
		hit_mx = mx
		hit_my = my
		invalid = true
		e.update()
	})

	let anchor_day

	function update_drag_range_end() {
		if (drag_range_end == null)
			return
		if (hit_day == null)
			return
		let r = drag_range
		let d0_0 = r[0]
		let d1_0 = r[1]
		r[drag_range_end] = hit_day
		if ((r[0] ?? -1/0) > (r[1] ?? 1/0)) // adjust a negative range.
			r[drag_range_end] = r[1-drag_range_end]
		let d0 = r[0]
		let d1 = r[1]
		if (d0 == d0_0 && d1 == d1_0)
			return
		ranges_changed()
		return true
	}

	ct.on('pointerdown', function(ev, down_mx, down_my) {

		pointerdown_ts = ev.timeStamp
		scroll_transition.stop()

		// this shouldn't normally happen, but just in case it does,
		// we need to update the hit state to reflect current mouse position.
		if (invalid || hit_mx != down_mx || hit_my != down_my) {
			hit_mx = down_mx
			hit_my = down_my
			invalid = true
			ct.redraw_now()
		}
		assert(!invalid)

		down = true
		let t0 = ev.timeStamp
		let sy0 = sy_now

		let had_focus = e.has_focus

		if (hit_range_end != null && e.can_change_range(hit_range)) {
			drag_range     = hit_range
			drag_range_end = hit_range_end
			e.update()
		}

		function captured_move(ev, mx, my) {

			if (drag_range) {
				hit_mx = mx
				hit_my = my
				e.update()
				return
			}

			let dy = my - down_my
			if (!drag_scroll)
				if (abs(dy) < 7) // prevent accidental dragging
					return

			drag_scroll = true
			e.scroll_to(sy0 + dy, 0)
		}

		function captured_up(ev, mx, my) {
			let was_drag_range = !!drag_range

			down = false
			drag_range = null
			drag_range_end = null

			if (drag_scroll) {
				drag_scroll = false
				let t1 = ev.timeStamp
				let dt = (t1 - t0)
				let dy = my - down_my
				let velocity = dy / dt
				e.scroll_by(velocity ** 3, 'inertial')
				return false
			}

			if (mode == 'day' && hit_day != null) {
				e.value = hit_day
				e.fire('input', {target: e})
				return false
			}

			if (mode == 'ranges' && !was_drag_range) {
				e.focus_range(hit_range)
				return false
			}

			if (mode == 'range' && !was_drag_range && hit_day != null) {
				if (ev.shift || ev.ctrl) {
					if (anchor_day == null)
						anchor_day = min(e.value1, e.value2)
					let d1 = anchor_day
					let d2 = hit_day
					if (d1 > d2) {
						let t = d1
						d1 = d2
						d2 = t
					}
					e.value1 = d1
					e.value2 = d2
					e.fire('input', {target: e})
				} else if (had_focus) {
					anchor_day = hit_day
					e.value1 = hit_day
					e.value2 = hit_day
					e.fire('input', {target: e})
				}
				return false
			}
		}

		this.capture_pointer(ev, captured_move, captured_up)
	})

	ct.on('dblclick', function(ev) {
		if (mode == 'ranges' && hit_day && e.can_add_range(hit_day, hit_day)) {
			ranges.push(e.create_range(hit_day, hit_day))
			ranges_changed()
			e.focus_range(ranges.last)
			return false
		}
	})

	e.on('keydown', function(key, shift, ctrl, alt) {

		if (alt)
			return

		if (down)
			return

		if (mode == 'ranges' && key == 'Delete') {
			if (focused_range) {
				if (!e.can_remove_range(focused_range))
					return
				ranges.remove_value(focused_range)
				focused_range = null
				ranges_changed()
				sort_ranges()
				return false
			}
		}

		if (ctrl && (key == 'ArrowUp' || key == 'ArrowDown')) {
			e.scroll_by_pages((key == 'ArrowUp' ? 1 : -1) * 0.5)
			return false
		}

		if (key == 'PageUp' || key == 'PageDown') {
			e.scroll_by_pages((key == 'PageUp' ? 1 : -1))
			return false
		}

		if (!ctrl && focused_range && (
				key == 'ArrowDown' || key == 'ArrowUp' ||
				key == 'ArrowLeft' || key == 'ArrowRight'
			) && e.can_change_range(focused_range)
		) {
			let r = focused_range
			let ddays = (key == 'ArrowUp' || key == 'ArrowDown' ? 7 : 1)
				* ((key == 'ArrowDown' || key == 'ArrowRight') ? 1 : -1)

			if (mode == 'day') {
				e.user_set(day(e.value, ddays))
				e.scroll_to_view_range(e.value, e.value, 0)
			} else {
				let d = day(r[1], ddays)
				if (!shift) {
					r[0] = d
					r[1] = d
				} else {
					d = max(d, r[0])
					r[1] = d
				}
				ranges_changed()
				sort_ranges()
				e.scroll_to_view_range(d, d, 0)
			}
			return false
		}

		if (key == 'Tab') {
			if (e.focus_next_range(shift))
				return false // prevent tabbing out on internal focusing
			e.focus_range(null)
		}

	})

	return {value: html_value}

}

G.calendar = component('calendar', 'Input', function(e) {
	return calendar_widget(e, 'day')
})

G.range_calendar = component('range-calendar', 'Input', function(e) {
	e.class('range-calendar')
	return calendar_widget(e, 'range')
})

G.ranges_calendar = component('ranges-calendar', 'Input', function(e) {
	return calendar_widget(e, 'ranges')
})

/* <time-picker> -------------------------------------------------------------

state props:
	value            timestamp from 1/1/1970 or 'HH:mm:ss.ms'
html attrs:
	value            'HH:mm:ss.ms'
	with-seconds     show seconds list
config props:
	with_seconds     true: show seconds list

*/

css(':root', '', `
	--h-time-picker: 12em;
`)
css('.time-picker', 'h-c', `
	height: var(--h-time-picker);
`)
css('.time-picker-list-box', 'v')
css('.time-picker-list-header', 'label h-c h-m b-b vscroll', `
	font-size: calc(0.75 * var(--fs));
	min-height: calc(var(--fs) * var(--lh) + 2 * var(--fs) * var(--p-y-calendar-days-em) - 1px);
`)
css('.time-picker-item:first-child', '', `margin-top   : calc(var(--h-time-picker) * .5);`)
css('.time-picker-item:last-child' , '', `margin-bottom: calc(var(--h-time-picker) * .5);`)
css('.time-picker-item', 't-r p-x-4 p-y-025 noselect')
css_state('.time-picker-item.selected', 'bold')
css_state('.time-picker-list:focus-visible .time-picker-item.focused', 'outline-focus')

G.time_picker = component('time-picker', 'Input', function(e) {

	e.class('time-picker')
	e.clear()

	let lists = []
	let add_time_list = function(n, s) {
		let li = list({
			classes: 'time-picker-list focusable-items scroll-thin',
			items: range(0, n, 1, i => ({value: i, name: i.base(10, 2)})),
			item_template: '<div class="item time-picker-item" searchable>{{{name}}}</div>',
		})
		li.make_focusable()
		li.make_list_items_focusable({multiselect: false})
		e.add(div({class: 'time-picker-list-box'},
			div({class: 'time-picker-list-header scroll-thin'}, s), li))
		lists.push(li)
		return li
	}
	e.hours_list   = add_time_list(24, 'HH')
	e.minutes_list = add_time_list(60, 'mm')
	e.seconds_list = add_time_list(60, 'ss')

	e.make_disablable()

	e.prop('with_seconds'  , {type: 'bool', default: false})
	e.prop('with_fractions', {type: 'bool', default: false})

	e.seconds_list.parent.hide()

	e.set_with_seconds = function(v) {
		e.seconds_list.parent.show(!!v)
	}

	e.scroll_to_view_value = function(scroll_align, scroll_smooth) {
		let opt = {
			scroll_to_focused_item: true,
			scroll_align: scroll_align,
			scroll_smooth: scroll_smooth,
		}
		for (let li of lists)
			li.update(opt)
	}

	function list_input_value(list, ev) {
		if (!list.focused_item)
			return
		list.update({
			scroll_to_focused_item: true,
			scroll_align: 'center',
			scroll_smooth: !(ev && ev instanceof KeyboardEvent),
		})
		return list.focused_item.data.value
	}

	e.hours_list.on('input', function(ev) {
		let v = list_input_value(this, ev)
		if (v == null) return
		e.set_prop('value', set_hours(e.value, v), ev)
	})

	e.minutes_list.on('input', function(ev) {
		let v = list_input_value(this, ev)
		if (v == null) return
		e.set_prop('value', set_minutes(e.value, v), ev)
	})

	e.seconds_list.on('input', function(ev) {
		let v = list_input_value(this, ev)
		if (v == null) return
		e.set_prop('value', set_seconds(e.value, v), ev)
	})

	e.prop('value', {type: 'timeofday',
		convert: s => parse_timeofday(s, false, true, true),
	})

	e.set_value = function(v, v0, ev) {
		if (ev && e.contains(ev.target)) { // from input
			this.fire('input', ev)
			return
		}
		let opt = assign_opt({
			target: ev && ev.target,
			scroll_to_focused_item: true,
			scroll_align: 'center',
		}, ev)
		e.  hours_list.focus_item(v != null ? floor(v / 3600 % 24) : false, null, opt)
		e.minutes_list.focus_item(v != null ? floor(v / 60 % 60)   : false, null, opt)
		e.seconds_list.focus_item(v != null ? floor(v % 60)        : false, null, opt)
	}

	e.on_update(function(opt) {
		if (opt.focus)
			e.focus_first()
	})

	e.on('keydown', function(key, shift, ctrl, alt) {
		let free_key = !(alt || ctrl || shift)
		if (free_key && (key == 'ArrowLeft' || key == 'ArrowRight')) {
			for (i = 0, n = e.with_seconds ? 3 : 2; i < n; i++) {
				if (lists[i].has_focus) {
					let next_li = lists[i + (key == 'ArrowLeft' ? -1 : 1)]
					if (next_li) {
						next_li.focus()
						return false
					}
				}
			}
		}
	})

})

/* <datetime-picker> ---------------------------------------------------------

state props:
	value          timestamp or date+time string
html attrs:
	value:         date+time string
	with-seconds:  show seconds list
config props:
	with_seconds:  true: show seconds list

*/

css(':root', '', `
	--h-datetime-picker: 16em;
`)
css('.datetime-picker', 'h shrinks', `
	--h-time-picker  : var(--h-datetime-picker);
	--min-h-calendar : var(--h-datetime-picker);
`)

G.datetime_picker = component('datetime-picker', 'Input', function(e) {

	e.class('datetime-picker')
	e.clear()

	e.calendar = calendar()
	e.time_picker = time_picker()
	e.add(e.calendar, e.time_picker)

	e.make_disablable()

	e.forward_prop('with_seconds'  , e.time_picker)
	e.forward_prop('with_fractions', e.time_picker)

	function convert_value(s) {
		return parse_date(s, 'SQL', true, true, true, true)
	}
	e.prop('value', {type: 'time', convert: convert_value})

	e.set_value = function(v, v0, ev) {
		e.calendar   .set_prop('value', v, ev)
		e.time_picker.set_prop('value', v, ev)
	}

	e.calendar.on('input', function(ev) {
		e.set_prop('value', this.value + e.time_picker.value, ev)
		e.fire('input', ev)
	})

	e.time_picker.on('input', function(ev) {
		e.set_prop('value', e.calendar.value + this.value, ev)
		e.fire('input', ev)
	})

	e.scroll_to_view_value = function(scroll_align, scroll_smooth) {
		e.calendar.scroll_to_view_all_ranges(scroll_smooth ? 1/0 : 0, scroll_align == 'center')
		e.time_picker.scroll_to_view_value(scroll_align, scroll_smooth)
	}

	e.on_update(function(opt) {
		if (opt.focus)
			e.focus_first()
	})

})

/* <date-input>, <time-input>, <datetime-input> & <date-range-input> ---------

This is 4 widgets crammed into one, that's why this code is full of ifs.
The range widget is the most different with its 2-level validation. Still,
there's enough common functionality in all variants that it makes more sense
to have one constructor instead of four. It's also simpler than extracting
the common bits into a mixin (less wiring, less naming, less code-chasing).

config:
	as_text                format form data as SQL text instead of timestamp
date-input, time-input, datetime-input state:
	value input_value
date-range-input state:
	value1 value2 input_value1 input_value2

*/

function svg_calendar_clock(attrs) {
	return svg(assign_opt({
		fill: 'currentColor',
		viewBox: '-60 -20 616 592',
		preserveAspectRatio: 'xMidYMid meet',
	}, attrs),
		svg_tag('path', {d: 'M 400.59 224 C 320.99 224 256.59 288.4 256.59 368 C 256.59 447.6 320.97 512 400.59 512 C 480.21 512 544.59 447.6 544.59 368 C 544.59 288.4 480.19 224 400.59 224 Z M 448.59 384 L 394.34 384 C 388.99 384 384.59 379.6 384.59 374.3 L 384.59 304 C 384.59 295.2 391.79 288 400.59 288 C 409.39 288 416.59 295.2 416.59 304 L 416.59 352 L 448.59 352 C 457.428 352 464.59 359.164 464.59 368 C 464.59 376.836 457.39 384 448.59 384 Z M 245.19 437.171 L 64 437.171 C 55.178 437.171 48 429.995 48 421.171 L 48 192 L 416.59 192 L 416.59 128 C 416.59 92.65 387.94 64 352.59 64 L 312.59 64 L 312.59 24 C 312.59 10.75 301.84 0 289.49 0 C 277.14 0 264.59 10.75 264.59 24 L 264.59 64 L 152 64 L 152 24 C 152 10.75 141.3 0 128 0 C 114.7 0 104 10.75 104 24 L 104 64 L 64 64 C 28.65 64 0 92.65 0 128 L 0 421.171 C 0 456.521 28.65 485.171 64 485.171 L 283.738 485.171 C 265.338 472.271 257.49 455.971 245.19 437.171 Z'})
	)
}

// NOTE: we use 'skip' on the root element and create an <input-group> inside
// so that we can add popups to the widget without messing up the CSS.
css('.date-input', 'skip', `
	--min-w-date-input: var(--min-w-calendar);
`)
css('.date-input-group', 'w-input bg-input')
css('.date-input-input', 'S shrinks t-c p-r-0')
css('.date-input-input-value2', 'p-l-0')
css('.date-input-picker-button', 'b p-x-input')
css('.date-range-input-separator', 'p-x h-m')
css('.time-only-input', '', `
	--min-w-calendar: 0px; /* has natural min-w; calendar's can be too wide */
`)
css('.date-input-picker', 'bg-input z3')
css('.date-input-picker-box', 'b v')
css('.date-only-input .calendar', 'S b bg-input clip', `resize: vertical;`) // NOTE: resize needs clip!
css('.date-range-input .date-input-picker-box', 'clip', `resize: vertical;`) // NOTE: resize needs clip!
css('.date-range-input .calendar', 'S')
css('.date-input-close-button', 'allcaps')

function date_input_widget(e, has_date, has_time, range) {

	e.clear()

	e.class('date-input')
	if (!range) {
		e.class('date-only-input', !has_time)
		e.class('time-only-input', !has_date)
		e.class('datetime-input', has_date && has_time)
	}
	e.make_disablable()

	e.input_group = div({class: 'date-input-group input-group b-collapse-h ro-collapse-h'})
	e.add(e.input_group)

	let to_text, to_form

	if (range) {
		assert(!has_time, 'NYI')
		e.is_range = true
		e.picker = range_calendar()
		e.calendar = e.picker
	} else {
		if (has_date) {
			if (has_time) {
				e.picker = datetime_picker()
				e.calendar = e.picker.calendar
				to_text = t => t.date()
				to_form = t => e.as_text ? t.date('SQL') : t
			} else {
				e.picker = calendar()
				e.calendar = e.picker
				to_text = t => t.date(null, true, e.with_seconds, e.with_fractions)
				to_form = t => e.as_text
					? t.date('SQL', true, e.with_seconds, e.with_fractions)
					: t
				e.with_time = true
			}
			e.is_time = true
		} else {
			e.picker = time_picker()
			e.is_timeofday = true
			to_text = t => t.timeofday(e.with_seconds, e.with_fractions)
			to_form = t => e.as_text
				? t.timeofday(e.with_seconds, e.with_fractions)
				: t
		}
		e.to_text = to_text
		e.to_form = to_form
	}

	if (range || e.picker != e.calendar) {
		e.close_button = button({
			type: 'button',
			classes: 'date-input-close-button',
			focusable: false,
			bare: true,
		}, S('close', 'Close'))
		e.close_button.action = function() {
			e.close(false)
		}
		e.picker_box = div({class: 'date-input-picker-box'}, e.picker, e.close_button)
	} else {
		e.picker_box = e.picker
	}
	e.picker_box.class('date-input-picker not-within')

	let w
	e.on_measure(function() {
		w = e.input_group.rect().w
	})
	e.on_position(function() {
		e.picker_box.min_w = `calc(max(var(--min-w-date-input), ${w}px))`
	})

	if (has_time) {
		e.forward_prop('with_seconds'  , e.picker)
		e.forward_prop('with_fractions', e.picker)
	}

	let to_input, from_input
	if (has_date) {
		to_input = t => t.date(null, has_time, e.with_seconds, e.with_fractions)
		from_input = s => parse_date(s, null, false, has_time, e.with_seconds, e.with_fractions)
	} else {
		to_input = t => t.timeofday(e.with_seconds, e.with_fractions)
		from_input = s => parse_timeofday(s, false, e.with_seconds, e.with_fractions)
	}

	e.inputs = []
	e.input_widgets = []

	if (!range)
		e.make_input_widget({
			value_type: has_date ? 'time' : 'timeofday',
			errors_tooltip_target: e.input_group,
		})

	for (let K of range ? ['1', '2'] : ['']) {

		let input = tag('input', {
			class: 'date-input-input date-input-input-value'+K,
			placeholder: date_placeholder_text(),
		})

		let input_widget

		if (range) {

			// NOTE: only making these "input widgets" for validation purposes,
			// no need to add them to the DOM. They have to be elements though.
			input_widget = div()
			input_widget.K = K
			e.input_widgets.push(input_widget)

			input_widget.is_time = true
			input_widget.to_text = to_text
			input_widget.to_form = to_form

			input_widget.make_input_widget({
				value_type: 'time',
				errors_tooltip_target: false,
			})

		} else {

			input_widget = e

		}

		input_widget.on_validate(function(ev) {

			if (!(ev && ev.target == e.picker)) {
				e.picker.set_prop('value'+K, e['value'+K], ev)
			}

			if (!(ev && ev.target == input && ev instanceof InputEvent)) {
				let v = e['value'+K]
				let iv = e['input_value'+K]
				input.value = v != null ? to_input(v) : isnum(iv) ? to_input(iv) : iv
			}

		})

		input.on('input', function(ev) {
			let v = from_input(input.value)
			e.set_prop('input_value'+K, v ?? input.value, ev)
		})

		input.on('wheel', function(ev, dy, is_trackpad) {
			let v = e['value'+K]
			if (v == null)
				return
			let d = day(v, round(-dy / 120))
			if (range)
				if (K == '1' && d > e.value2)
					d = e.value2
				else if (K == '2' && d < e.value1)
					d = e.value1
			e.set_prop('input_value'+K, d, {target: e})
		})

		function digit_groups() {
			let gs = []
			let index = 0
			input.value.replace(/(\s\-)?\d+/g,
				(s, _, i) => gs.push({i: i, j: i + s.len, index: index++}))
			return gs
		}

		function current_digit_group() {
			let i = input.selectionStart
			let j = input.selectionEnd
			for (let g of digit_groups())
				if (g.i <= i && g.j >= j)
					return g
		}

		function focus_next_digit_group(shift) {
			let i = input.selectionStart
			let j = input.selectionEnd
			if (i == 0 && j == input.value.len) {
				i = shift ? input.value.len : 0
				j = i
			}
			let gs = digit_groups()
			if (!shift) { // select next number
				for (let g of gs)
					if (g.i >= j) {
						input.setSelectionRange(g.i, g.j)
						return true
					}
			} else {
				for (let g of gs.reverse())
					if (g.j <= i) {
						input.setSelectionRange(g.i, g.j)
						return true
					}
			}
		}

		input.on('keydown', function(key, shift, ctrl, alt, ev) {

			if (alt)
				return

			// tabbing between digit groups
			if (key == 'Tab')
				if (focus_next_digit_group(shift))
					return false

			// inc/dec current digit group with arrow keys
			if (key == 'ArrowUp' || key == 'ArrowDown') {
				let g = current_digit_group()
				if (g) {
					let s = input.value
					let n = s.slice(g.i, g.j).num() + (key == 'ArrowUp' ? -1 : 1)
					let ns = ' '+n
					// ^^ the space is prepended in case n is negative, to diff.
					// from `-` used as date separator!
					let s1 = s.slice(0, g.i) + ns + s.slice(g.j)
					let t = from_input(s1)
					if (t != null) {
						if (e.try_validate(t)) {
							e.set_prop('input_value'+K, t, ev)
							g = digit_groups()[g.index] // re-locate digit group
							if (g)
								input.setSelectionRange(g.i, g.j)
						}
					}
					return false
				}
			}

		})

		// NOTE: using ^focusin because ^focus resets the selection on Firefox!
		input.on('focusin', function() {
			let i = input.selectionStart
			let j = input.selectionEnd
			if (i == 0 && j > 0 && j == input.value.len) // all text is selected
				focus_next_digit_group(shift_pressed)
		})

		e['input'+K] = input
		e.inputs.push(input)
		e.input_group.add(input)

		e.prop('placeholder'+K, {store: false})
		e['get_placeholder'+K] = () => input.placeholder
		e['set_placeholder'+K] = function(s) { input.placeholder = s }

	}

	if (range) {

		e.make_range_input_widget({
			value_input_widgets: e.input_widgets,
			errors_tooltip_target: e.input_group,
		})

	}

	e.picker.on('input', function(ev) {
		if (range) {
			e.set_prop('input_value1', this.value1, ev)
			e.set_prop('input_value2', this.value2, ev)
		} else {
			e.set_prop('input_value', this.value, ev)
		}
	})

	e.make_focusable(...e.inputs)
	e.input_group.make_focus_ring(...e.inputs)

	e.picker_button = button({
		type: 'button',
		classes: 'date-input-picker-button',
		bare: true,
		focusable: false,
		icon:
			has_date && has_time && svg_calendar_clock()
			|| !has_time && 'far fa-calendar'
			|| !has_date && 'far fa-clock',
	})

	if (range)
		e.input_group.add(
			e.input1,
			div({class: 'date-range-input-separator'}, '-'),
			e.input2,
			e.picker_button)
	else
		e.input_group.add(e.input, e.picker_button)

	// controller -------------------------------------------------------------

	e.property('isopen',
		function() {
			return e.hasclass('open')
		},
		function(open) {
			e.set_open(open, true)
		}
	)
	e.set_open = function(open, focus) {
		e.class('open', open)
		if (open) {
			e.picker_box.popup(e.input_group, 'bottom', 'start')
			e.picker_box.popup_oy = -1 // make top border overlap with editbox
			e.add(e.picker_box)
			e.picker_box.update({show: true})
			e.picker.scroll_to_view_value('center', false)
			e.picker.update({focus: true})
		} else {
			e.picker_box.hide()
			if (focus !== false)
				e.focus_first()
		}
	}

	e.open   = function(focus) { e.set_open(true, focus) }
	e.close  = function(focus) { e.set_open(false, focus) }
	e.toggle = function(focus) { e.set_open(!e.isopen, focus) }

	e.picker_box.on('focusout', function(ev) {
		if (ev.relatedTarget && e.picker_box.contains(ev.relatedTarget))
			return
		e.close(false)
	})

	e.picker_button.on('pointerdown', function(ev) {
		e.toggle()
		return false
	})

	if (!e.close_button && e.calendar) // auto-close on pick with delay
		e.calendar.on('input', function() {
			// delay it so the user can glance the choice.
			runafter(.1, function() {
				e.close()
			})
		})

	e.picker_box.on('keydown', function(key, shift, ctrl, alt) {
		let free_key = !(alt || shift || ctrl)
		if (free_key && key == 'Escape') {
			e.close()
			return false
		}
	})

	e.on('keydown', function(key, shift, ctrl, alt) {
		let free_key = !(alt || shift || ctrl)
		if (
			(alt && (key == 'ArrowDown' || key == 'ArrowUp'))
			|| (free_key && key == 'Enter')
		) {
			e.toggle()
			return false
		}
	})

}

G.date_input = component('date-input', 'Input', function(e) {
	return date_input_widget(e, true)
})

G.time_input = component('time-input', 'Input', function(e) {
	return date_input_widget(e, false, true)
})

G.datetime_input = component('datetime-input', 'Input', function(e) {
	return date_input_widget(e, true, true)
})

G.date_range_input = component('date-range-input', 'Input', function(e) {
	return date_input_widget(e, true, false, true)
})

/* <richtext> ----------------------------------------------------------------

in props:
	content
inner html:
	-> content

*/

css('.richtext', 'scroll-auto')

css('.richtext:not(.richedit)', 'm0 block')
css('.richtext:not(.richedit) > .focus-box', 'b0')

css('.richtext-content', 'vscroll-auto no-outline p')

G.richtext = component('richtext', function(e) {

	e.class('richtext')
	e.make_disablable()

	let html_content = [...e.nodes]
	e.clear()

	e.content_box = div({class: 'richtext-content'})
	e.add(e.content_box)

	// content property

	e.set_content = function(s) {
		e.content_box.set(s)
		e.fire('content_changed')
	}
	function serialize_content(s) {
		return e.content_box.html
	}
	e.prop('content', {type: 'nodes', slot: 'lang', serialize: serialize_content})

	return {content: html_content}

})

/* <richtext> editing mixin --------------------------------------------------



*/

{

css('.richtext-actionbar', 'abs h bg1')

css('.richtext-button', 'm0 b ro0 bg1 h-c h-m arrow', `
	height: 2em;
	width: 2em;
`)

// TODO: why does fontawsome take priority over css styles?
css_role('.richtext-button', 'h')

let exec = (command, value = null) => document.execCommand(command, false, value)
let cstate = (command) => document.queryCommandState(command)

let actions = {
	bold: {
		//icon: '<b>B</b>',
		icon_class: 'fa fa-bold',
		result: () => exec('bold'),
		state: () => cstate('bold'),
		title: 'Bold (Ctrl+B)',
	},
	italic: {
		//icon: '<i>I</i>',
		icon_class: 'fa fa-italic',
		result: () => exec('italic'),
		state: () => cstate('italic'),
		title: 'Italic (Ctrl+I)',
	},
	underline: {
		//icon: '<u>U</u>',
		icon_class: 'fa fa-underline',
		result: () => exec('underline'),
		state: () => cstate('underline'),
		title: 'Underline (Ctrl+U)',
	},
	code: {
		//icon: '&lt/&gt',
		icon_class: 'fa fa-code',
		result: () => exec('formatBlock', '<pre>'),
		title: 'Code',
	},
	heading1: {
		icon: '<b>H<sub>1</sub></b>',
		result: () => exec('formatBlock', '<h1>'),
		title: 'Heading 1',
	},
	heading2: {
		icon: '<b>H<sub>2</sub></b>',
		result: () => exec('formatBlock', '<h2>'),
		title: 'Heading 2',
	},
	line: {
		icon: '&#8213',
		result: () => exec('insertHorizontalRule'),
		title: 'Horizontal Line',
	},
	link: {
		//icon: '&#128279',
		icon_class: 'fa fa-link',
		result: function() {
			let url = window.prompt('Enter the link URL')
			if (url) exec('createLink', url)
		},
		title: 'Link',
	},
	olist: {
		//icon: '&#35',
		icon_class: 'fa fa-list-ol',
		result: () => exec('insertOrderedList'),
		title: 'Ordered List',
	},
	ulist: {
		//icon: '&#8226',
		icon_class: 'fa fa-list-ul',
		result: () => exec('insertUnorderedList'),
		title: 'Unordered List',
	},
	paragraph: {
		//icon: '&#182',
		icon_class: 'fa fa-paragraph',
		result: () => exec('formatBlock', '<p>'),
		title: 'Paragraph',
	},
	quote: {
		//icon: '&#8220 &#8221',
		icon_class: 'fa fa-quote-left',
		result: () => exec('formatBlock', '<blockquote>'),
		title: 'Quote',
	},
	strikethrough: {
		//icon: '<strike>S</strike>',
		icon_class: 'fa fa-strikethrough',
		result: () => exec('strikeThrough'),
		state: () => cstate('strikeThrough'),
		title: 'Strike-through',
	},
}

function richtext_widget_editing(e) {

	let button_pressed
	function press_button() { button_pressed = true }

	e.actionbar = div({class: 'richtext-actionbar'})
	if (!e.focus_box)
		e.actionbar.popup(e, 'top', 'left')
	for (let k in actions) {
		let action = actions[k]
		// Guess what: this must be a <button>, if it's a <div>, clicking on it
		// makes you lose the selection on the contenteditable!!! WTF?
		let button = tag('button', {class: 'richtext-button b-collapse-h', title: action.title})
		button.attr('tabindex', '-1')
		button.html = action.icon || ''
		button.classes = action.icon_class
		button.on('pointerdown', press_button)
		let update_button
		if (action.state) {
			update_button = function() {
				button.class('selected', action.state())
			}
			e.content_box.on('keyup', update_button)
			e.content_box.on('pointerup', update_button)
		}
		button.on('click', function() {
			button_pressed = false
			if (action.result()) {
				e.content_box.focus()
			}
			if (update_button)
				update_button()
			return false
		})
		e.actionbar.add(button)
	}

	e.actionbar.class('richtext-actionbar-embedded', !!e.focus_box)
	if (e.focus_box) // is richedit
		e.focus_box.insert(0, e.actionbar)
	else
		e.add(e.actionbar)

	e.content_box.on('input', function(ev) {
		let e1 = ev.target.first
		if (e1 && e1.nodeType == 3)
			exec('formatBlock', '<p>')
		else if (e.content_box.html == '<br>')
			e.content_box.clear()
		e.fire('content_changed')
	})

	e.content_box.on('keydown', function(key, shift, ctrl, alt, ev) {
		if (key === 'Enter')
			if (document.queryCommandValue('formatBlock') == 'blockquote')
				runafter(0, function() { exec('formatBlock', '<p>') })
			else if (document.queryCommandValue('formatBlock') == 'pre')
				runafter(0, function() { exec('formatBlock', '<br>') })
		ev.stopPropagation()
	})

	e.content_box.on('keypress', function(key, shift, ctr, alt, ev) {
		ev.stopPropagation()
	})

	e.actionbar.on('pointerdown', function(ev) {
		ev.stopPropagation() // prevent exit editing.
	})

	e.set_editing = function(v) {
		e.content_box.contentEditable = v
		e.actionbar.hidden = !v
	}
	e.prop('editing', {private: true})

}

}

/* html-input ----------------------------------------------------------------

*/

css('.html-input', 'v', `
	min-height: 6em;
`)

css('.richtext-actionbar-embedded', 'rel bg1 b-b', `
	margin-top  : -1px;
	margin-left : -1px;
`)

css('.richtext-actionbar-embedded > button', 'b-b-0')

/* scroll instead of growing to overflow the css grid */
css('.html-input > .focus-box', 'S scroll-auto v')
css('.html-input > .focus-box > .richtext-content', 'S')

G.html_input = component('html-input', 'Input', function(e) {

	let html_val = [...e.nodes]
	e.clear()

	e.make_disablable()

	e.content_box = div({class: 'richtext-content'})
	e.focus_box = div({class: 'focus-box'}, e.content_box)
	e.add(e.focus_box)

	richtext_widget_editing(e)

	e.do_update_val = function(v, ev) {
		if (ev && ev.input == e)
			return
		e.content_box.set(v)
	}

	e.on('content_changed', function() {
		let v = e.content_box.html
		e.set_val(v ? v : null, {input: e})
	})

	e.on_bind(function(on) {
		if (on)
			e.editing = true
	})

	return html_val.length ? {val: html_val} : null

})

}()) // module function
