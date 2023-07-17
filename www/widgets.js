/*

	Web Components in JavaScript.
	Written by Cosmin Apreutesei. Public Domain.

You must load first, in order:

	glue.js  dom.js  css.js

WIDGETS              PROPS

	<tooltip>         text  target  align  side  kind  icon_visible
	<toaster>         side  align  timeout  spacing
	<list>
	<checklist>
	<menu>
	<tabs>            tabs_side  auto_focus  selected_item_id
	<[v]split>        fixed_side  fixed_size  resizeable  min_size
	<action-band>
	<dlg>
	<toolbox>
	<slides>
	<md>
	<pagenav>
	<label>
	<info>
	<erors>
	<checkbox>
	<toggle>
	<radio>
	<slider>
	<range-slider>
	<input-group>
	<labelbox>
	<input>
	<textarea>
	<button>
	<[v]select-button>
	<textarea-input>
	<text-input>
	<pass-input>
	<num-input>
	<tags-box>
	<tags-input>
	<dropdown>
	<check-dropdown>
	<calendar>
	<range-calendar>
	<ranges-calendar>
	<date-input>
	<timeofday-input>
	<datetime-input>
	<date-range-input>
	<html-input>

FUNCTIONS

	notify(text, ['search info error'], [timeout])

*/

(function () {
"use strict"
let G = window
let e = Element.prototype

// container with `display: contents`. useful to group together
// an invisible widget like a nav with a visible one.
// Don't try to group together visible elements with this! CSS will see
// your <skip> tag in the middle, but the layout system won't!
css('skip', 'skip')

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
`)

css_state('.focusable-items:focus-within .item.focused', '', `
	background : var(--bg-focused);
`)

css_state('.focusable-items .item.focused.selected', '', `
	background : var(--bg-unfocused-selected);
`)

css_state('.focusable-items:focus-within .item.focused.selected', '', `
	background: var(--bg-focused-selected);
`)

css_state('.item.invalid', 'bg-error')

css_state('.focusable-items:focus-within .item.focused.invalid', '', `
	background : var(--bg-focused-error);
`)

css_state('.item.dragging.selected', 'on-dark', `
	background : var(--bg-selected);
`)
css_state('.item.dragging.focused.selected', '', `
	background: var(--bg-focused-selected);
`)

function forward_event(e) {
	return e.fire(this.type, this)
}

/* <tooltip> -----------------------------------------------------------------

in props:
	text
	icon_visible      false
	kind              default; default search info error warn cursor
	target -> popup_target
	align  -> popup_align
	side   -> popup_side

*/

// z: menu = 4, picker = 3, tooltip = 2, toolbox = 1
css('.tooltip', 'z2 h-l h-t noclip noselect on-theme', `
	max-width: 400px;  /* max. width of the message bubble before wrapping */
	--bg-tooltip: var(--bg1);
	--fg-tooltip-xbutton: var(--fg-dim);
	--border-tooltip-xbutton: var(--border-light);
`)

css('.tooltip-body', 'h-bl p-y tight ro', `
	background: var(--bg-tooltip);
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

css('.tooltip-tip', 'z1 hidden', `
	border: .5em solid transparent; /* border-based triangle shape */
	color: var(--bg-tooltip);
`)

css('.tooltip-icon', 't-t m-t-05 m-l-2', `
	font-size: 1em; /* TODO: why? */
	line-height: inherit !important; /* override fontawesome's !important */
`)

// side & align combinations.

css('.tooltip[side=left  ] > .tooltip-tip', 'block', ` border-left-color   : inherit; `)
css('.tooltip[side=right ] > .tooltip-tip', 'block', ` border-right-color  : inherit; `)
css('.tooltip[side=top   ] > .tooltip-tip', 'block', ` border-top-color    : inherit; `)
css('.tooltip[side=bottom] > .tooltip-tip', 'block', ` border-bottom-color : inherit; `)

// NOTE: tooltip must have the exact same total width and height for each
// side and align combinations because side and/or align attrs can change
// _after_ the popup was positioned when it's too late to re-measure it!
// This is why we put these paddings.
css('.tooltip:is([side=top],[side=bottom])', '', ` padding-left: .5em; padding-right : .5em; `)
css('.tooltip:is([side=left],[side=right])', '', ` padding-top : .5em; padding-bottom: .5em; `)
// ... but now the tooltip is misaligned, so we need to adjust its position.
css('.tooltip[align=start]:is([side=top],[side=bottom])', '', ` margin-left: -.5em; `)
css('.tooltip[align=end  ]:is([side=top],[side=bottom])', '', ` margin-left: .5em; `)
css('.tooltip[align=start]:is([side=left],[side=right])', '', ` margin-top: -.5em; `)
css('.tooltip[align=end  ]:is([side=left],[side=right])', '', ` margin-top: .5em; `)

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

css('.tooltip[kind=search]', 'on-light', `
	--bg-tooltip: var(--bg-search);
`)

css('.tooltip[kind=info]', 'on-dark', `
	--bg-tooltip: var(--bg-info);
	--fg-tooltip-xbutton    : var(--fg-dim-on-dark);
	--border-tooltip-xbutton: var(--border-light-on-dark);
`)

css('.tooltip[kind=error]', 'on-dark', `
	--bg-tooltip: var(--bg-error);
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
	e.make_popup()

	e.prop('text'        , {slot: 'lang'})
	e.prop('icon_visible', {type: 'bool', default: false})
	e.prop('kind'        , {type: 'enum',
			enum_values: 'default search info warn error cursor',
			default: 'default', to_attr: true})
	e.prop('timeout') // number | 'auto'
	e.prop('close_button', {type: 'bool', default: false})

	e.alias('target'      , 'popup_target')
	e.alias('target_rect' , 'popup_target_rect')
	e.alias('side'        , 'popup_side')
	e.alias('align'       , 'popup_align')

	e.on_init(function() {
		// SUBTLE: fixate side so that the tooltip has the exact same dimensions
		// when measured for the first time as when measured afterwards
		// after the side changes due to popup relayouting.
		e.attr('side', e.side)
	})

	e.on('popup_position', function(side, align) {
		// slide-in + fade-in with css.
		e.attr('side' , side)
		e.attr('align', align)
	})

	e.close = function(ev) {
		if (!e.fire('close', ev))
			return false
		e.animate(
			[{opacity: 0}],
			{duration: 100, easing: 'ease-out'}
		).onfinish = function() {
			e.fire('closed', ev)
			e.del()
		}
		return true
	}

	function close(ev) { e.close(ev) }

	let last_popup_time

	e.on_update(function(opt) {
		if (!e.content) {
			e.content = div({class: 'tooltip-content'})
			e.icon_box = div()
			e.body = div({class: 'tooltip-body'}, e.icon_box, e.content)
			e.tip = div({class: 'tooltip-tip'})
			e.add(e.body, e.tip)
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
			t = clamp(e.content.textContent.len / (tooltip.reading_speed / 60), 1, 10)
		else
			t = num(t)
		close_timer(t)
	}
	e.on_bind(function(on) {
		if (!on)
			close_timer()
	})

	// keyboard, mouse & focusing behavior ------------------------------------

	e.on('keydown', function(ev, key) {
		if (key == 'Escape') {
			e.close(ev)
			return false
		}
	})

	// clicking on tooltip's empty space focuses the first focusable element.
	function content_pointerdown(ev) {
		if (ev.target != this)
			return // clicked inside the tooltip.
		this.focus_first()
		return false
	}

	// autoclose --------------------------------------------------------------

	e.prop('autoclose', {type: 'bool', default: false})

	e.on_bind(function(on) {
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
		e.close(ev)
	}

	document.on('pointerdown', e, document_pointerdown)

	// clicking outside the tooltip closes the tooltip, even if the click did something.
	document.on('stopped_event', e, function(ev) {
		if (!ev.type.ends('pointerdown'))
			return
		document_pointerdown(ev)
	})

	// focusing an element outside the tooltip or its anchor closes the tooltip.
	document.on('focusin', e, function(ev) {
		document_pointerdown(ev)
	})

	// focusing out of the document (to the titlebar etc.) closes the tooltip.
	document.on('focusout', e, function(ev) {
		if (!e.autoclose)
			return
		if (ev.relatedTarget)
			return
		if (!e.autoclose)
			return
		if (e.contains(ev.target))
			return
		e.close(ev)
	})

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

*/

css('.toaster', 'skip') // don't mess up the layout

css('.toaster-message', 'op1', `left: 0;`)

G.toaster = component('toaster', function(e) {

	e.class('toaster')

	e.side = 'inner-top'
	e.align = 'center'
	e.timeout = 'auto'
	e.spacing = 6

	e.on_measure(function() {
		let y = e.spacing
		for (let t of e.at) {
			t._y = y
			y += t.rect().h + e.spacing
		}
	})

	e.on_position(function() {
		for (let t of e.at) {
			t.popup_y1 = t._y
			runafter(0, function() { t.update() })
		}
	})

	function tooltip_closed() {
		e.update()
	}

	e.post = function(text, kind, timeout) {
		let t = tooltip({
			target: e.parent,
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
		t.on('closed', tooltip_closed)
		e.add(t)
		e.update()
		return t
	}

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

			if (items.length > 1) {
				// note: this enlarge-on-cross-axis-only thing ony makes sense when
				// moving elements between lists with same horiz.
				if (horiz)
					items_r.w += ox
				else
					items_r.h += oy
			}

		}
		// move the items out of layout so they don't get clipped.
		for (let i = items.len-1; i >= 0; i--)
			root.add(items[i])
		e.fire('items_removed', items)
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
css_state('.list-drop-placeholder', 'abs b2 b-dashed', `
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
			placeholder.del()
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

	let r, lr, horiz

	e.on('allow_drag', function() {
		if (!e.list_can_move_elements)
			return false
		lr = e.at[e.list_len-1].rect()
	})

	e.listen('drag_started', function(payload, add_drop_area, source_elem) {
		if (source_elem != e)
			return
		add_drop_area(e, domrect(-1e5, -1e5, 2e5, 2e5))
		horiz = e.css('flexDirection') == 'row'
		r = e.rect()
	})

	e.on('dragging', function(ev, items, items_r) {
		for (let item of items) {
			if (horiz) {
				item.y = r.y
				item.x = clamp(item.x, r.x, lr.x)
			} else {
				item.x = r.x
				item.y = clamp(item.y, r.y, lr.y)
			}
		}
	})

}

/* focusable & selectable list elements --------------------------------------

config props:
	multiselect
	list_items_horizontal
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

	e.prop('focused_item_index', {type: 'number', slot: 'state'})

	e.set_focused_item_index = function(i, i0, ev) {
		e.announce('focused_item_changed', ev)
		if (ev && ev instanceof UIEvent)
			e.fireup('input', ev)
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
		i ??= inc * -1/0 // jshint ignore:line

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

	e.on('items_changed', function() {
		e.focused_item_index = null
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

	e.on('keydown', function(ev, key, shift, ctrl, alt) {

		if (alt)
			return

		let horiz = e.list_items_horizontal ??
			(e.css('display').includes('flex') && e.css('flexDirection') == 'row')

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
		if (!sel_items.len) return
		copied_elements.set(sel_items)
		for (let item of sel_items)
			item.del()
		e.fire('items_changed')
		return false
	})

	e.on('copy', function(ev) {
		if (ev.target != e) return
		let sel_items = e.selected_items
		if (!sel_items.len) return
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

css('.list-search', 'bg-search')

e.make_list_items_searchable = function() {

	let e = this
	e.make_list_items_searchable = noop

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
			if (e.can_focus_item)
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
			tape.push('show', item_e, show || !searchables.len)
		}

		if (searching && first_item_i == null && !(ev && ev.allow_zero_results))
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
				val_e.add(span({class: 'list-search'}, search))
				val_e.add(suffix)
				item_e.show()
			} else if (cmd == 'show') {
				let item_e = tape[i++]
				let show   = tape[i++]
				item_e.show(show)
			}
		}

		// step 3: focus first found item.
		if (e.focus_item) {
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
		} else {
			if (first_item_i != null)
				e.at[first_item_i].make_visible()
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

	e.on('keydown', function(ev, key, shift, ctrl, alt) {
		if (key == 'Backspace' && search_string) {
			e.search(search_string.slice(0, -1), ev)
			return false
		}
		if (key == 'Enter' && search_string) {
			e.search('')
			return false
		}
		if (!ctrl && !alt && (key.len == 1 || /[^a-zA-Z0-9]/.test(key))) {
			if (e.search((search_string || '') + key, ev))
				return false
		}
	})

}

/* <list-search-input> -------------------------------------------------------

props:
	for_id     for    list element to search into
	value             current search value

*/

e.list_search_input = component('list-search-input', 'Input', function(e) {

	e.class('list-search-input')
	e.clear()
	e.input = tag('input', {class: 'list-search-input-input'})
	e.add(e.input)

	e.prop('for', {slot: 'state'})
	e.prop('for_id', {type: 'id', attr: 'for', bind_id: 'for'})
	e.prop('value', {slot: 'state'})

	function update_target() {
		if (!e.for) return
		e.for.make_list_items_searchable()
		e.for.search(e.value, {allow_zero_results: true})
	}

	e.set_for = function(te1, te0) {
		if (te0)
			te0.search('')
		update_target()
	}

	e.set_value = function(v, v0, ev) {
		if (ev && ev.type == 'input')
			return
		e.input.value = v
		update_target()
	}

	e.on('input', function(ev) {
		e.set_prop('value', e.input.value, ev)
		update_target()
	})

})

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

NOTE: removes element margins (needed for drag & drop to work) !

*/

css('.list', 'v-t flex scroll-auto rel')

G.list = component('list', function(e) {

	e.class('list')
	e.make_disablable()

	let ht = e.$1(':scope>template, :scope>script[type="text/x-mustache"], :scope>xmp')
	e.prop_vals.item_template = ht && ht.html
	if (ht) ht.remove()

	let sc = e.$1(':scope>script')
	e.prop_vals.items = sc && sc.run(e) || try_json_arg(e.attr('items')) || undefined
	if (sc) sc.remove()

	if (!e.prop_vals.item_template && !e.prop_vals.items) { // static items
		e.init_child_components()
		e.prop_vals.items = [...e.at]
	}

	e.clear()

	// model

	e.prop('items', {type: 'array', default: empty_array})
	e.prop('item_template_name', {type: 'template_name', attr: 'item_template'})
	e.prop('item_template', {type: 'template'})

	// view

	e.property('item_template_string', function() {
		return template(e.item_template_name) || e.item_template
	})

	e.format_item = function(item, ts) {
		return unsafe_html(render_string(ts, item || empty_obj), false)
	}

	e.update_items = function() {
		let ts = e.item_template_string
		if (ts) { // to-render items
			e.clear()
			for (let item of e.items) {
				let item_e = e.format_item(item, ts)
				item_e.data = item
				item_e.focusable = isobject(item) ? item.focusable : true
				if (e.update_item_state)
					e.update_item_state(item_e)
				e.add(item_e)
			}
		} else { // static items
			for (let item_e of e.items) {
				if (e.update_item_state)
					e.update_item_state(item_e)
			}
			e.set(e.items)
		}
		e.fire('items_changed', {from_update: true})
	}

	e.set_items = function(v, v0, ev) {
		if (ev && ev.from_items_changed)
			return
		e.update_items()
	}

	e.set_item_template_name = e.update_items
	e.set_item_template = e.update_items

	e.on('items_changed', function(ev) {
		if (ev && ev.from_update)
			return
		let items = []
		for (let i = 0, n = e.list_len; i < n; i++) {
			let item_e = e.at[i]
			items.push(item_e.data)
		}
		e.set_prop('items', items, {from_items_changed: true})
	})

})

/* <checklist> ---------------------------------------------------------------

in item template:
	<checklist-checkbox>
events:
	^item_checked(item, checked, ev)

*/

css('checklist-checkbox', 'm-r')

component('checklist-checkbox', function(e) {
	e.clear()
	e.make_checkbox(false)
	e.class('checklist-checkbox')
	function check_click(ev) {
		let checked = !this.checked_state
		this.checked_state = checked
		this.list.fire('item_checked', this.item, checked, ev)
	}
	e.on('click', check_click)
})

css('.checklist-item', 'h-m')

// works with any element, doesn't have to be a <list>.
e.make_checklist = function() {

	let e = this
	e.class('checklist')

	e.item_checked_state = function(i) {
		let item = e.at[i].item
		return item.data ? item.data.checked : item.bool_attr('checked')
	}

	function update_items() {
		for (let i = 0, n = e.list_len; i < n; i++) {
			let item_ct = e.at[i]
			let item = item_ct.item
			if (!item) {
				item = item_ct
				// wrap item and add a checkbox
				let cb = tag('checklist-checkbox')
				item_ct = div({class: 'checklist-item'}, cb)
				e.replace(item, item_ct)
				item_ct.add(item)
				item_ct.item = item
				cb.item = item
				cb.list = e
				item.checkbox = cb
				cb.checked_state = e.item_checked_state(i)
			}
		}
	}

	e.on('items_changed', update_items)

	e.on('keydown', function(ev, key) {
		let item_ct = e.focused_item
		if ((key == ' ' || key == 'Enter') && item_ct) {
			item_ct.item.checkbox.click()
			return false
		}
	})

	update_items()
}

G.checklist = component('checklist', function(e) {
	e.construct('list')
	e.make_checklist()
})

/* <menu> --------------------------------------------------------------------

*/

// z4: menu = 4, picker = 3, tooltip = 2, toolbox = 1
// noclip: submenus are outside clipping area.
// fg: prevent inheritance by the .focused rule below.
css('.menu', 'm0 p0 b arial t-l abs z4 noclip bg1 on-theme no-bold shadow-menu noselect', `
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
	background : var(--bg2);
`)

css('.menu-check-div', 'p-x')

css('.menu-check-div::before', 'fa fa-check')

css('.menu-sub-div', 'p-x')
css('.menu-sub-div::before', 'fa fa-angle-right')

G.menu = component('menu', function(e) {

	e.make_disablable()
	e.make_focusable()
	e.class('menu')
	e.make_popup()

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
		let tr = tag('tr', {class: 'menu-tr'}, check_td, title_td, key_td, sub_td)
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
		table.class('submenu', is_submenu)
		table.attr('tabindex', 0)
		for (let i = 0; i < items.len; i++) {
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
		tr.submenu_table.del()
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
		if (on && e.select_first_item)
			select_next_item(e.table)
	})

	function document_pointerdown(ev) {
		if (e.contains(ev.target)) // clicked inside the menu.
			return
		e.close()
	}
	document.on('pointerdown'     , e, document_pointerdown)
	document.on('rightpointerdown', e, document_pointerdown)

	// clicking outside the menu closes the menu, even if the click did something.
	document.on('stopped_event', e, function(ev) {
		if (e.contains(ev.target)) // clicked inside the menu.
			return
		if (ev.type.ends('pointerdown'))
			e.close()
	})

	e.close = function(focus_target) {
		e.del()
		select_item(e.table, null)
		if (e.parent && focus_target)
			e.parent.focus()
	}

	// navigation

	function next_valid_item(menu, down, tr) {
		let i = menu.len
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

	function menu_keydown(ev, key) {
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

inner html:
	* -> items
content:
	items              [e1, ...]
state:
	selected_item_id
appearance:
	tabs_side          top bottom left right
behavior:
	auto_focus         true
dynamic tabs:
	can_rename_items   false
	can_add_items      false
	can_remove_items   false
	can_move_items     false

*/

css('.tabs', 'S shrinks v flex', `
	--w-tabs-header: 10em;
`)

css('tabs-header', 'h rel bg1')

css('tabs-box', 'S h rel shrinks')
css('.tabs:is([tabs_side=left],[tabs_side=right]) > tabs-header', 'clip-x-auto-y')

css('tabs-fixed-header', 'S h-m')

css('.tabs[tabs_side=left ]', 'h-l')
css('.tabs[tabs_side=right]', 'h-r')

css('.tabs[tabs_side=left ] > tabs-header', 'v', `width: var(--w-tabs-header);`)
css('.tabs[tabs_side=right] > tabs-header', 'v', `width: var(--w-tabs-header);`)
css('.tabs[tabs_side=left ] > tabs-header tabs-box', 'v')
css('.tabs[tabs_side=right] > tabs-header tabs-box', 'v')

css('.tabs[tabs_side=bottom] > tabs-header', 'order-1')
css('.tabs[tabs_side=right ] > tabs-header', 'order-1')

css('.tabs[tabs_side=top   ] > tabs-header', 'b-b')
css('.tabs[tabs_side=bottom] > tabs-header', 'b-t')
css('.tabs[tabs_side=left  ] > tabs-header', 'b-r')
css('.tabs[tabs_side=right ] > tabs-header', 'b-l')

css('tabs-content', 'S shrinks scroll-auto')

css('tabs-tab', 'rel label arrow h')
css('.tabs:is([tabs_side=top],[tabs_side=bottom]) > tabs-header tabs-tab', 'shrinks')
// css('.tabs:is([tabs_side=left],[tabs_side=right]) > tabs-header tabs-tab', 'clip-x')

css_state('tabs-tab.selected', 'on-theme text')

// reset focusable-items states.
css_state('tabs-tab', 'no-bg')
css_state('tabs-tab:is(:hover)', 'fg-hover')

css('tabs-title', 'noselect nowrap m-x-4', `
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
css_state('tabs-xbutton:hover', 'fg-hover')

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
css_role_state('tabs-box .list-drop-placeholder', 'b0')
css_state('tabs-tab.dragging::before', 'overlay z-1 click-through b0 bg1-active')

// tab renaming
css_state('tabs-tab.renaming', 'bg0', `min-width: 6em;`)
css_state('tabs-tab.renaming tabs-title', 'no-outline nowrap')
css_state('tabs-tab.renaming::before', 'overlay click-through', `
	border: 2px dashed var(--fg-link);
`)

G.tabs = component('tabs', 'Containers', function(e) {

	e.class('tabs')
	e.make_disablable()

	e.init_child_components()

	e.fixed_header = e.$1('tabs-fixed-header')
	if (e.fixed_header)
		e.fixed_header.del()

	e.make_items_prop()

	e.prop('tabs_side', {type: 'enum', enum_values: 'top bottom left right',
		default: 'top', to_attr: true})

	e.prop('auto_focus', {type: 'bool', default: true})

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
	e.header = tag('tabs-header', {class: 'scroll-thin'},
		e.tabs_box, e.selection_bar, e.fixed_header, e.add_button)
	e.content = tag('tabs-content', {class: 'frame'})
	e.add(e.header, e.content)
	e.add_button.on('click', add_button_click)

	e.make_focusable(e.tabs_box)

	function tabname(item) {
		return item.tabname || item.attr('tabname')
	}

	e.listen('tabname_changed', function(ce) {
		if (!ce._tab) return
		if (ce._tab.tabs != e) return
		update_tab_title(ce._tab) // TODO: defer this
	})

	function update_tab_title(tab) {
		let s = tabname(tab.item)
		tab.title_box.set(TC(s))
		tab.title_box.title = tab.title_box.textContent
	}

	let selected_tab, renaming_tab

	function update_selected_tab_state(selected) {
		let tab = selected_tab
		if (!tab) return
		tab.xbutton.hidden = !e.can_remove_items
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
					update_tab_title(tab)
					item._tab.x = null
					e.tabs_box.add(tab)
				} else {
					e.tabs_box.append(item._tab)
				}
			}
		}

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

	let tr, cr, c_css

	e.on_measure(function() {
		tr = e.tabs_box.rect()
		let tab_title = selected_tab && selected_tab.at[0]
		cr = tab_title.rect()
		c_css = tab_title.css()
	})

	e.on_position(function() {
		let b = e.selection_bar
		let mx1 = c_css ? num(c_css.marginLeft ) : 0
		let mx2 = c_css ? num(c_css.marginRight) : 0
		if (e.tabs_side == 'left' || e.tabs_side == 'right') {
			b.y1 = cr ? cr.y - tr.y : 0
			b.y2 = null
			b.h  = cr ? cr.h : 0
			b.w  = null
		}
		if (e.tabs_side == 'left') {
			b.x1 = 0
			b.x2 = null
		}
		if (e.tabs_side == 'right') {
			b.x1 = 0
			b.x2 = null
		}
		if (e.tabs_side == 'top' || e.tabs_side == 'bottom') {
			b.x1 = cr ? cr.x - tr.x - mx1 : 0
			b.x2 = null
			b.w  = cr ? cr.w + mx1 + mx2 : 0
			b.h  = null
		}
		if (e.tabs_side == 'top') {
			b.y1 = null
			b.y2 = 0
		}
		if (e.tabs_side == 'bottom') {
			b.y1 = 0
			b.y2 = null
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
		let s = item.slug || tabname(item) || ''
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
		renaming_tab.item.tabname = renaming_tab.title_box.innerText
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

	function tab_title_box_keydown(ev, key, shift, ctrl) {
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

	e.tabs_box.on('keydown', function(ev, key, shift, ctrl) {
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

	e.on('keydown', function(ev, key, shift, ctrl) {
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

})

/* <split> & <vsplit> --------------------------------------------------------

html elements:
	* -> item1, item2
content:
	item1 item2    : e
state:
	fixed_size     : 200
appearance:
	orientation    : horizontal vertical
behavior:
	fixed_side     : first second
	resizeable     : true
	min_size       : 0
html attrs:
	resizeable fixed_size

*/

css('.split', 'S shrinks')
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
	e.prop_vals.item1 = e.at[0]
	e.prop_vals.item2 = e.at[1]
	e.clear()

	e.pane1 = tag('split-pane', {class: 'frame'})
	e.pane2 = tag('split-pane', {class: 'frame'})
	e.sizer = tag('split-sizer')
	e.add(e.pane1, e.sizer, e.pane2)

	e.prop('item1', {type: 'node', parse: element})
	e.prop('item2', {type: 'node', parse: element})

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

	e.prop('orientation', {type: 'enum', enum_values: 'horizontal vertical', default: 'horizontal', to_attr: true})
	e.prop('fixed_side' , {type: 'enum', enum_values: 'first second', default: 'first', to_attr: true})
	e.prop('resizeable' , {type: 'bool', default: true, to_attr: true})
	e.prop('fixed_size' , {type: 'number', default: 200, slot: 'user'})
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

})

G.vsplit = component('vsplit', function(e) {
	e.class('vsplit')
	e.construct('split')
	e.prop_vals.orientation = 'vertical'
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

css('.dlg', 'rel v p-4 b0 ro bg on-theme', `
	margin: 20px;
	box-shadow: var(--shadow-modal);
`)
css_dark(' .dlg', 'bg1')

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
	-webkit-text-stroke: 1px var(--stroke-dialog-xbutton);
`)
css('.dlg-xbutton::before', 'fa fa-times')

css_state('.dlg-xbutton:hover', '', `
	background-color: var(--bg-button-hover);
`)

css_state('.dlg-xbutton:is(.active,:active)', '', `
	background-color: var(--bg-button-active);
`)

css('.dlg-content', 'S shrinks')

css('.dlg-footer', 'h-b')

G.dlg = component('dlg', function(e) {

	e.class('dlg')
	e.init_child_components()

	e.prop_vals.heading = e.$1('heading')
	e.prop_vals.header  = e.$1('header' )
	e.prop_vals.content = e.$1('content')
	e.prop_vals.footer  = e.$1('footer' )

	e.prop('heading'        , {}) // because title is taken
	e.prop('cancelable'     , {type: 'bool', to_attr: true, default: true})
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

		if (e.cancelable && !e.xbutton) {
			e.xbutton = div({class: 'dlg-xbutton'})
			e.xbutton.on('click', function() {
				e.cancel()
			})
			e.add(e.xbutton)
		}
		if (e.xbutton)
			e.xbutton.show(e.cancelable)

		e.add(e._header, e._content, e._footer, e.xbutton)

	})

	document.on('keydown', e, function(ev, key) {
		if (key == 'Escape') {
			if (e.cancelable && e.xbutton) {
				e.xbutton.class('active', true)
				return false
			} else {
				if (e.cancel())
					return false
			}
		}
	})

	document.on('keyup', e, function(ev, key) {
		if (key == 'Escape') {
			if (e.cancelable && e.xbutton && e.xbutton.hasclass('active')) {
				e.xbutton.class('active', false)
				if (e.cancel())
					return false
			}
		}
	})

	document.on('pointerdown', e, function(ev) {
		if (e.contains(ev.target)) // clicked inside the dialog
			return
		e.cancel()
		return false
	})

	e.on('keydown', function(ev, key) {
		if (key == 'Enter') {
			e.ok()
			return false
		}
	})

	e.close = function(ok) {
		e.modal(false)
		if (e.xbutton)
			e.xbutton.class('active', false)
		e.fire('close', ok != false)
	}

	e.cancel = function() {
		if (!e.cancelable) {
			e.animate([{transform: 'scale(1.05)'}], {duration: 100})
			for (let k in e.buttons) {
				let b = e.buttons[k]
				if (b.closes)
					b.draw_attention()
			}
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

})

/* <toolbox> -----------------------------------------------------------------

inner htnl:
	* -> content
content:
	content
	text                 title
state:
	px py pw ph          position and size
	pinned               true
html attrs:
	pinned

*/

// z1: menu = 4, picker = 3, tooltip = 2, toolbox = 1
css('.toolbox', 'z1 v scroll-auto b0 bg1 ro shadow-toolbox op02 ease ease-05s')

css_state('.toolbox[pinned], .toolbox:hover', 'op1 no-ease')

css('.toolbox-titlebar', 'h-m bold p-x-2 p-y-05 gap-2 noselect on-dark', `
	background : var(--bg-unfocused-selected);
	cursor: move;
`)

css_state('.toolbox:focus-within > .toolbox-titlebar', '', `
	background : var(--bg-focused-selected);
`)

css('.toolbox-title', 'S shrinks nowrap-dots click-through')

css('.toolbox-btn', 'arrow')
css('.toolbox-btn-pin', 'small rotate-45')
css('.toolbox-btn-pin::before', 'fa fa-thumbtack')
css('.toolbox-btn-close::before', 'fa fa-times')
css_state('.toolbox[pinned] > .toolbox-titlebar > .toolbox-btn-pin', 'label rotate-0')
css_state('.toolbox-btn:hover' , 'fg-hover')
css_state('.toolbox-btn:active', 'fg-active')

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

	e.prop_vals.content = [...e.nodes]
	e.clear()

	e.class('toolbox')

	e.props.popup_align = {default: 'top'}
	e.props.popup_side  = {default: 'inner-top'}
	e.make_popup()

	e.istoolbox = true
	e.class('pinned')

	e.pin_button     = div({class: 'toolbox-btn toolbox-btn-pin'})
	e.xbutton        = div({class: 'toolbox-btn toolbox-btn-close'})
	e.title_box      = div({class: 'toolbox-title'})
	e.titlebar       = div({class: 'toolbox-titlebar'}, e.title_box, e.pin_button, e.xbutton)
	e.content_box    = div({class: 'toolbox-content frame'})
	e.resize_overlay = div({class: 'toolbox-resize-overlay'})
	e.add(e.titlebar, e.content_box, e.resize_overlay)

	e.alias('target', 'popup_target')
	e.alias('align' , 'popup_align')
	e.alias('side'  , 'popup_side')

	e.prop('px'    , {type: 'number', slot: 'user', default: 0})
	e.prop('py'    , {type: 'number', slot: 'user', default: 0})
	e.prop('pw'    , {type: 'number', slot: 'user'})
	e.prop('ph'    , {type: 'number', slot: 'user'})
	e.prop('pinned', {type: 'bool'  , slot: 'user', default: true, to_attr: true})

	e.set_px = (x) => e.popup_ox = x
	e.set_py = (y) => e.popup_oy = y
	e.set_pw = (w) => e.w = w
	e.set_ph = (h) => e.h = h

	e.prop('content', {type: 'nodes'})

	e.prop('text', {slot: 'lang'})

	function move_to_top() {
		e.index = 1/0
	}

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

		move_to_top()
		unfocus()

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

		move_to_top()
		unfocus()

		let px0 = e.px
		let py0 = e.py

		return this.capture_pointer(ev, function(ev, mx, my, mx0, my0) {
			e.update({input: e})
			e.px = px0 + mx - mx0
			e.py = py0 + my - my0
		}, function(ev, mx, my) {
			down = false
			e.content_box.focus_first()
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

	// uncaptured bubbled-up pointerdown brings toolbox to top.
	e.on('pointerdown', function() {
		move_to_top()
		unfocus()
		e.content_box.focus_first()
		return false
	})

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
css('.slides > .skip > .', 'x1 y1')

css_state('.slide'        , 'invisible op0 click-through     ease-05s')
css_state('.slide-current', 'visible   op1 click-through-off ease-05s')

G.slides = component('slides', 'Containers', function(e) {

	e.class('slides')
	e.make_disablable()
	e.make_items_prop()

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

})


/* <md> markdown tag ---------------------------------------------------------

inner html:
	* -> html

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

css('.pagenav', 'h-bl h-sb flex')
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
	e.prop('bare'      , {type: 'bool', default: false, to_attr: true})

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
			e.fireup('page_changed', page)
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
css_state('.label-widget:is(:hover,.hover)', 'fg-hover')

G.label = component('label', 'Input', function(e) {

	e.class('label-widget')
	e.make_disablable()

	e.alias('for_id', 'htmlFor')
	e.props.for_id = {type: 'id', attr: 'for'}

	e.prop('target', {private: true, store: false})
	e.get_target = function() {
		if (e.for) return e.for
		if (e.for_id) return window[e.for_id]
		let g = e.closest('.input-group')
		return g && g.$1('.input')
	}

	e.on_bind(function(on) {
		let te = e.target
		if (!te) return
		if (on && te.label == null)
			te.label = e.textContent
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

css('.info', 'inline-block')
css('.info:not([collapsed])', 'smaller label h-bl gap-x')

// toggling visibility on hover requires click-through for stable hovering!
css('.info .tooltip', 'click-through')
css('.info .tooltip .tooltip-content', 't-l')

G.info = component('info', function(e) {

	e.class('info')
	e.make_disablable()

	e.prop_vals.text = [...e.nodes]

	e.prop('collapsed', {type: 'bool', default: true, to_attr: true})
	e.prop('text', {type: 'nodes', slot: 'lang'})

	e.set_collapsed = function(v) {
		if (v) {
			e.btn = e.btn || div({class: 'info-button'})
			if (!e.tooltip) {
				e.tooltip = tooltip({kind: 'info', align: 'center', target: e.btn})
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

	e.on_init(function() {
		e.set_collapsed(true)
	})

})

/* validators & validation rules ---------------------------------------------

We don't like abstractions around here but this one buys us many things:

  - validation rules are: reusable, composable, and easy to write logic for.
  - rules apply automatically, no need to specify which to apply where.
  - a validator can depend on, i.e. require that other rules pass first.
  - a validator can parse the input value so that subsequent rules operate
    on the parsed value, thus only having to parse the value once.
  - null values are filtered automatically.
  - result contains all the messages with `failed` and `checked` status on each.
  - it makes no garbage on re-validation so you can validate huge lists fast.
  - entire objects can be validated the same way simple values are, so it also
    works for validating ranges, db records, etc. as a unit.
  - it's not that much code for all of that.

input:
	parent_validator
output:
	rules
	triggered
	results
	value
	failed
	parse_failed
	first_failed_result
methods:
	prop_changed(prop) -> needs_revalidation?
	validate([ev]) -> valid?
	effectively_failed()

*/

let global_rules = obj()
G.validation_rules = global_rules

let global_rule_props = obj()

function fix_rule(rule) {
	rule.applies = rule.applies || return_true
	rule. props = wordset(rule. props)
	rule.vprops = wordset(rule.vprops)
	rule.requires = words(rule.requires) || empty_array
}

G.add_validation_rule = function(rule) {
	fix_rule(rule)
	global_rules[rule.name] = rule
	assign(global_rule_props, rule.props)
	announce('validation_rules_changed')
}

G.create_validator = function(e) {

	let rules_invalid = true
	let rules = []
	let own_rules = []
	let own_rule_props = obj()
	let rule_vprops = obj()
	let parse
	let results = []
	let checked = map()

	let validator = {
		results: results,
		rules: rules,
		triggered: false,
	}

	function add_rule(rule) {
		assert(checked.get(rule) !== false, 'validation rule require cycle: {0}', rule.name)
		if (checked.get(rule))
			return true
		if (!rule.applies(e))
			return
		checked.set(rule, false) // means checking...
		for (let req_rule_name of rule.requires) {
			if (!add_global_rule(req_rule_name)) {
				checked.set(rule, true)
				return true
			}
		}
		rules.push(rule)
		assign(rule_vprops, rule.vprops)
		checked.set(rule, true)
		if (!parse)
			parse = rule.parse
		return true
	}

	function add_global_rule(rule_name) {
		let rule = global_rules[rule_name]
		if (warn_if(!rule, 'unknown validation rule', rule_name))
			return
		return add_rule(rule)
	}

	validator.invalidate = function() {
		rules_invalid = true
	}

	validator.add_rule = function(rule) {
		fix_rule(rule)
		own_rules.push(rule)
		assign(own_rule_props, rule.props)
		rules_invalid = true
	}

	validator.prop_changed = function(prop) {
		if (!prop || global_rule_props[prop] || own_rule_props[prop]) {
			rules.clear()
			for (let k in rule_vprops)
				rule_vprops[k] = null
			checked.clear()
			rules_invalid = true
			return true
		}
		return rules_invalid || rule_vprops[prop] || !rules.len
	}

	function update_rules() {
		if (!rules_invalid)
			return
		for (let rule_name in global_rules)
			add_global_rule(rule_name)
		for (let rule of own_rules)
			add_rule(rule)
		rules_invalid = false
	}

	validator.parse = function(v) {
		update_rules()
		if (v == null) return null
		return parse ? parse(e, v) : v
	}

	validator.validate = function(v, announce_results) {
		announce_results = announce_results != false
		update_rules()
		let parse_failed
		for (let rule of rules) {
			if (parse_failed) {
				rule._failed = true
				continue // if parse failed, subsequent rules cannot run!
			}
			if (rule._failed)
				continue
			if (rule._checked)
				continue
			if (v == null && !rule.check_null)
				continue
			for (let req_rule_name of rule.requires) {
				if (global_rules[req_rule_name]._failed) {
					rule._failed = true
					continue
				}
			}
			let parse = rule.parse
			if (parse) {
				assert(parse_failed == null)
				v = parse(e, v)
				parse_failed = v === undefined
			}
			let failed = parse_failed || !rule.validate(e, v)
			rule._checked = true
			rule._failed = failed
		}
		results.len = rules.len
		this.failed = false
		this.first_failed_result = null
		for (let i = 0, n = rules.len; i < n; i++) {
			let rule = rules[i]
			let result = attr(results, i)
			result.checked = rule._checked || false
			result.failed  = rule._failed || false
			result.rule    = rule
			if (announce_results) {
				result.error     = rule.error(e, v)
				result.rule_text = rule.rule (e)
			}
			if (rule._failed && !this.failed) {
				this.failed = true
				this.first_failed_result = result
			}
			// clean up scratch pad.
			rule._checked = null
			rule._failed  = null
		}
		this.parse_failed = parse_failed
		this.value = repl(v, undefined, null)
		if (announce_results)
			e.announce('validate', this)
		this.triggered = true
		return !this.failed
	}

	property(validator, 'effectively_failed', function() {
		let e = this
		assert(e.triggered)
		if (e.failed)
			return true
		e = e.parent_validator
		if (!e)
			return false
		return e.effectively_failed
	})

	return validator
}

// NOTE: this must work with values that are unparsed and invalid!
function field_value(e, v) {
	if (e.draw) return e.draw(v) ?? '' // field renders itself
	if (v == null) return S('null', 'null')
	if (isstr(v)) return v // string or failed to parse, show as is.
	if (e.to_text) return e.to_text(v)
	return str(v)
}

add_validation_rule({
	name     : 'required',
	check_null: true,
	props    : 'not_null required',
	vprops   : 'input_value',
	applies  : (e) => e.not_null || e.required,
	validate : (e, v) => v != null || e.default != null,
	error    : (e, v) => S('validation_empty_error', '{0} is required', e.label),
	rule     : (e) => S('validation_empty_rule'    , '{0} cannot be empty', e.label),
})

// NOTE: empty string converts to `true` even when setting the value from JS!
// This is so that a html attr without value becomes `true`.
add_validation_rule({
	name     : 'bool',
	vprops   : 'input_value',
	applies  : (e) => e.is_bool,
	parse    : (e, v) => isbool(v) ? v : bool_attr(v),
	validate : (e, v) => isbool(v),
	error    : (e, v) => S('validation_bool_error',
		'{0} is not a boolean' , e.label),
	rule     : (e) => S('validation_bool_rule' ,
		'{0} must be a boolean', e.label),
})

add_validation_rule({
	name     : 'number',
	vprops   : 'input_value',
	applies  : (e) => e.is_number,
	parse    : (e, v) => isstr(v) ? num(v) : v,
	validate : (e, v) => isnum(v),
	error    : (e, v) => S('validation_num_error',
		'{0} is not a number' , e.label),
	rule     : (e) => S('validation_num_rule' ,
		'{0} must be a number', e.label),
})

function add_scalar_rules(type) {

	add_validation_rule({
		name     : 'min_'+type,
		requires : type,
		props    : 'min',
		vprops   : 'input_value',
		applies  : (e) => e.min != null,
		validate : (e, v) => v >= e.min,
		error    : (e, v) => S('validation_min_error',
			'{0} is smaller than {1}', e.label, field_value(e, e.min)),
		rule     : (e) => S('validation_min_rule',
			'{0} must be larger than or equal to {1}', e.label, field_value(e, e.min)),
	})

	add_validation_rule({
		name     : 'max_'+type,
		requires : type,
		props    : 'max',
		vprops   : 'input_value',
		applies  : (e) => e.max != null,
		validate : (e, v) => v <= e.max,
		error    : (e, v) => S('validation_max_error',
			'{0} is larger than {1}', e.label, field_value(e, e.max)),
		rule     : (e) => S('validation_max_rule',
			'{0} must be smaller than or equal to {1}', e.label, field_value(e, e.max)),
	})

}

add_scalar_rules('number')

add_validation_rule({
	name     : 'checked_value',
	props    : 'checked_value unchecked_value',
	vprops   : 'input_value',
	applies  : (e) => e.checked_value !== undefined || e.unchecked_value !== undefined,
	validate : (e, v) => v == e.checked_value || v == e.unchecked_value,
	error    : (e, v) => S('validation_checked_value_error',
		'{0} is not {1} or {2}' , e.label, e.checked_value, e.unchecked_value),
	rule     : (e) => S('validation_checked_value_rule' ,
		'{0} must be {1} or {2}', e.label, e.checked_value, e.unchecked_value),
})

add_validation_rule({
	name     : 'range_values_valid',
	vprops   : 'invalid1 invalid2',
	applies  : (e) => e.is_range,
	validate : (e, v) => !e.invalid1 && !e.invalid2,
	error    : (e, v) => S('validation_range_values_valid_error', 'Range values are invalid'),
	rule     : (e) => S('validation_range_values_valid_rule' , 'Range values must be valid'),
})

add_validation_rule({
	name     : 'positive_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range,
	validate : (e, v) => e.value1 == null || e.value2 == null || e.value1 <= e.value2,
	error    : (e, v) => S('validation_positive_range_error', 'Range is negative'),
	rule     : (e) => S('validation_positive_range_rule' , 'Range must be positive'),
})

add_validation_rule({
	name     : 'min_range',
	props    : 'min_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range && e.range_type == 'number' && e.min_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 >= e.min_range,
	error    : (e, v) => S('validation_min_range_error', 'Range is too small'),
	rule     : (e) => S('validation_min_range_rule' ,
		'Range must be larger than or equal to {0}', field_value(e, e.min_range)),
})

add_validation_rule({
	name     : 'max_range',
	props    : 'max_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range && e.range_type == 'number' && e.max_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 <= e.max_range,
	error    : (e, v) => S('validation_max_range_error', 'Range is too large'),
	rule     : (e) => S('validation_max_range_rule' ,
		'Range must be smaller than or equal to {0}', field_value(e, e.max_range)),
})

add_validation_rule({
	name     : 'min_len',
	props    : 'min_len',
	vprops   : 'input_value',
	applies  : (e) => e.min_len != null,
	validate : (e, v) => v.len >= e.min_len,
	error    : (e, v) => S('validation_min_len_error',
		'{0} too short', e.label),
	rule     : (e) => S('validation_min_len_rule' ,
		'{0} must be at least {1} characters', e.label, e.min_len),
})

add_validation_rule({
	name     : 'max_len',
	props    : 'max_len',
	vprops   : 'input_value',
	applies  : (e) => e.max_len != null,
	validate : (e, v) => v.len <= e.max_len,
	error    : (e, v) => S('validation_max_len_error',
		'{0} is too long', e.label),
	rule     : (e) => S('validation_min_len_rule' ,
		'{0} must be at most {1} characters', e.label, e.max_len),
})

add_validation_rule({
	name     : 'lower',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e) => e.conditions && e.conditions.includes('lower'),
	validate : (e, v) => /[a-z]/.test(v),
	error    : (e, v) => S('validation_lower_error',
		'{0} does not contain a lowercase letter', e.label),
	rule     : (e) => S('validation_lower_rule' ,
		'{0} must contain at least one lowercase letter', e.label),
})

add_validation_rule({
	name     : 'upper',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e) => e.conditions && e.conditions.includes('upper'),
	validate : (e, v) => /[A-Z]/.test(v),
	error    : (e, v) => S('validation_upper_error',
		'{0} does not contain a uppercase letter', e.label),
	rule     : (e) => S('validation_upper_rule' ,
		'{0} must contain at least one uppercase letter', e.label),
})

add_validation_rule({
	name     : 'digit',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e) => e.conditions && e.conditions.includes('digit'),
	validate : (e, v) => /[0-9]/.test(v),
	error    : (e, v) => S('validation_digit_error',
		'{0} does not contain a digit', e.label),
	rule     : (e) => S('validation_digit_rule' ,
		'{0} must contain at least one digit', e.label),
})

add_validation_rule({
	name     : 'symbol',
	props    : 'conditions',
	vprops   : 'input_value',
	applies  : (e) => e.conditions && e.conditions.includes('symbol'),
	validate : (e, v) => /[^A-Za-z0-9]/.test(v),
	error    : (e, v) => S('validation_symbol_error',
		'{0} does not contain a symbol', e.label),
	rule     : (e) => S('validation_symbol_rule' ,
		'{0} must contain at least one symbol', e.label),
})

let pass_score_errors = [
	S('password_score_error_0', 'extremely easy to guess'),
	S('password_score_error_1', 'very easy to guess'),
	S('password_score_error_2', 'easy to guess'),
	S('password_score_error_3', 'not hard enough to guess'),
]
let pass_score_rules = [
	S('password_score_rule_0', 'extremely easy to guess'),
	S('password_score_rule_1', 'very easy to guess'),
	S('password_score_rule_2', 'easy to guess'),
	S('password_score_rule_3', 'hard to guess'),
	S('password_score_rule_4', 'impossible to guess'),
]
add_validation_rule({
	name     : 'min_score',
	props    : 'conditions min_score',
	vprops   : 'input_value',
	applies  : (e) => e.min_score != null
		&& e.conditions && e.conditions.includes('min-score'),
	validate : (e, v) => (e.score ?? 0) >= e.min_score,
	error    : (e, v) => S('validation_min_score_error',
		'{0} is {1}', e.label,
			pass_score_errors[e.score] || S('password_score_unknwon', '... wait...')),
	rule     : (e) => S('validation_min_score_rule' ,
		'{0} must be {1}', e.label, pass_score_rules[e.min_score]),
})

add_validation_rule({
	name     : 'time',
	vprops   : 'input_value',
	applies  : (e) => e.is_time,
	parse    : (e, v) => parse_date(v, 'SQL', true, e.precision),
	validate : return_true,
	error    : (e, v) => S('validation_time_error', '{0}: invalid date', e.label),
	rule     : (e) => S('validation_time_rule', '{0} must be a valid date'),
})

add_scalar_rules('time')

add_validation_rule({
	name     : 'timeofday',
	vprops   : 'input_value',
	applies  : (e) => e.is_timeofday,
	parse    : (e, v) => parse_timeofday(v, true, e.precision),
	validate : return_true,
	error    : (e, v) => S('validation_timeofday_error',
		'{0}: invalid time of day', e.label),
	rule     : (e) => S('validation_timeofday_rule',
		'{0} must be a valid time of day'),
})

add_scalar_rules('timeofday')

add_validation_rule({
	name     : 'date_min_range',
	props    : 'date_min_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range && e.range_type == 'date' && e.min_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 >= e.min_range - 24 * 3600,
	error    : (e, v) => S('validation_date_min_range_error', 'Range is too small'),
	rule     : (e) => S('validation_date_min_range_rule' ,
		'Range must be larger than or equal to {0}', field_value(e, e.min_range)),
})

add_validation_rule({
	name     : 'date_max_range',
	props    : 'date_max_range',
	vprops   : 'value1 value2',
	applies  : (e) => e.is_range && e.range_type == 'date' && e.max_range != null,
	validate : (e, v) => e.value1 == null || e.value2 == null
		|| e.value2 - e.value1 <= e.max_range - 24 * 3600,
	error    : (e, v) => S('validation_date_max_range_error', 'Range is too large'),
	rule     : (e) => S('validation_date_max_range_rule' ,
		'Range must be smaller than or equal to {0}', field_value(e, e.max_range)),
})

add_validation_rule({
	name     : 'value_known',
	props    : 'known_values',
	vprops   : 'input_value',
	applies  : (e) => !e.is_values && e.known_values,
	validate : (e, v) => e.known_values.has(v),
	error    : (e, v) => S('validation_value_known_error',
		'{0}: unknown value {1}', e.label, field_value(e, v)),
	rule     : (e) => S('validation_value_known_rule',
		'{0} must be a known value', e.label),
})

add_validation_rule({
	name     : 'values',
	vprops   : 'input_value',
	applies  : (e) => e.is_values,
	parse    : (e, v) => {
		v = isstr(v) ? (v.trim().starts('[') ? try_json_arg(v) : v.words()) : v
		return v.sort().uniq_sorted()
	},
	validate : return_true,
	error    : (e, v) => S('validation_values_error',
		'{0}: invalid values list', e.label),
	rule     : (e) => S('validation_values_rule',
		'{0} must be a valid values list', e.label),
})

function invalid_values(e, v) {
	if (v == null)
		return 'null'
	let a = []
	for (let s of v)
		if (!e.known_values.has(s))
			a.push(s)
	return a.join(', ')
}
add_validation_rule({
	name     : 'values_known',
	props    : 'known_values',
	vprops   : 'input_value',
	requires : 'values',
	applies  : (e) => e.known_values,
	validate : (e, v) => {
		for (let s of v)
			if (!e.known_values.has(s))
				return false
		return true
	},
	error    : (e, v) => S('validation_values_known_error',
		'{0}: unknown values: {1}', e.label, invalid_values(e, v)),
	rule     : (e) => S('validation_values_known_rule',
		'{0} must contain only known values', e.label),
})

/* <errors> ------------------------------------------------------------------

attr:      prop:
	for        target_id     id of input that fires ^^validate()
	           target        input that fires ^^validate()
   show_all                 shwo all rules with pass/fail mark or just the first error

*/

css('.errors', 'v flex p label arrow')
css('.errors-line', 'h p-05 gap-x')
css('.errors-icon', 'w1 t-c')
css('.errors-message', '')
css('.errors-checked.errors-failed', 'fg-error bg-error')
css('.errors-not-checked', 'dim')
css('.errors-icon', 'fa')
css('.errors-failed .errors-icon::before', 'fa-times')
css('.errors-checked.errors-passed .errors-icon::before', 'fa-check')
css('.errors-single', 'h-m flex fg-error')
css('.errors-single::before', 'p-r-2 fa fa-triangle-exclamation')

G.errors = component('errors', 'Input', function(e) {

	e.class('errors')

	e.prop('validator', {private: true})
	e.prop('target'    , {slot: 'state'})
	e.prop('target_id' , {type: 'id', attr: 'for', bind_id: 'target'})
	e.prop('type', {type: 'enum', enum_values: 'rules'})

	e.on_update(function(opt) {
		if (!opt.validator)
			return
		if (!e.validator) {
			e.clear()
			return
		}
		if (e.type == 'rules') {
			e.clear()
			if (e.validator)
				for (let result of e.validator.results)
					e.add(div({class: catany(' ',
								'errors-line',
								(result.checked ? 'errors-checked' : 'errors-not-checked'),
								(result.failed ? 'errors-failed' : 'errors-passed')
							)},
							div({class: 'errors-icon'}),
							div({class: 'errors-message'}, result.rule_text)
						))
		} else {
			let res = e.validator.first_failed_result
			if (res)
				e.set(res.error)
			// don't clear the error, just hide it so that tooltip's dimensions
			// remain stable while it fades out.
			e.class('visible'  , !!res)
			e.class('invisible', !res)
			e.class('errors-single')
		}
	})

	function update_errors() {
		e.update({validator: true})
		// because the resize observer event on the errors popup comes in too slow.
		e.fireup('content_resize')
	}

	e.set_validator = update_errors

	e.set_target = function(te1, te0) {
		if (te0) te0.has_errors_widget = false
		if (te1) te1.has_errors_widget = !!e.target_id
		e.validator = te1 ? te1.validator : null
	}

	e.listen('validate', function(te, validator) {
		if (te != e.target) return
		update_errors()
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

css('.errors-tooltip', 'arrow')
css('.errors-tooltip .errors', 'bg-error')

e.make_validator = function(validate_on_init, errors_tooltip_target) {

	let e = this

	e.prop('invalid', {type: 'bool', default: false, to_attr: true, slot: 'state'})

	e.validator = create_validator(e)

	e.validate = function() {
		e.invalid = !e.validator.validate(e.input_value)
		e.update({validation: true})
	}
	e.on_validate = function(f) {
		e.do_after('validate', f)
	}

	e.try_validate = function(v) {
		let valid = e.validator.validate(v, false)
		e.validator.validate(e.input_value, false)
		return valid
	}

	e.on_prop_changed(function(k, v, v0, ev) {
		if (e.initialized == false)
			return
		if (e.validator.prop_changed(k))
			e.validate(ev)
	})

	e.listen('validation_rules_changed', function() {
		if (e.initialized == false)
			return
		e.validate()
	})

	if (validate_on_init != false)
		e.on_init(function() {
			e.validate()
		})

	let ett = errors_tooltip_target ?? e

	if (ett != false) {

		e.do_after('set_invalid', function(v) {
			ett.bool_attr('invalid', v || null)
		})

		e.on_update(function(opt) {

			let et = e.errors_tooltip

			let show_tooltip = (opt.errors_tooltip || opt.validation)
				&& e.invalid && !e.has_errors_widget
				&& (e.has_focus_visible || (e.hovered && !(et && et.hovered)))
				&& !e.getAnimations().length

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
				et.class('click-through', !e.has_focus_visible)
			}

		})

		function update_et() {
			e.update({errors_tooltip: true})
		}
		assert(ett.tag != 'svg') // hooking focusin on svg makes it focusable!
		ett.on('focusin' , update_et)
		ett.on('focusout', update_et)
		ett.on('hover'   , update_et)

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

	e.json = function() {
		let t = obj()
		for (let input of e.elements) {
			if (!input.widget)
				continue
			if (input.widget.validator.effectively_failed)
				continue
			input.widget.to_json(t)
		}
		return t
	}

	e.on('submit', function(ev) {
		for (let input of e.elements) {
			if (!input.widget)
				continue
			if (input.widget.validator.effectively_failed) {
				ev.preventDefault()
				break
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
	to_form()
	to_json(t)

*/

e.make_input_widget = function(opt) {

	opt = opt || empty_obj
	let e = this

	e.prop('name', {store: false})
	e.prop('form', {type: 'id', store: false})

	// initial value and also the value from user input, valid or not, typed or text.
	e.prop('input_value', {attr: 'value', slot: 'state', default: undefined})

	// typed, validated value, not user-changeable.
	e.prop('value', {slot: 'state'})

	e.prop('required', {type: 'bool', default: false, to_attr: true})
	e.prop('readonly', {type: 'bool', default: false, to_attr: true})

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

	// label used in validation errors.
	let label
	e.prop('label', {store: false})
	e.get_label = s => label || (e.name || S('value', 'Value')).display_name()
	e.set_label = function(s) { label = s }

	e.make_validator(false, opt.errors_tooltip_target)

	e.to_form = e.to_form || return_arg // stub

	e.to_json = e.to_json || function(t) { // stub
		if (e.parent_validator)
			if (e.parent_validator.failed)
				return
		if (e.name && !e.validator.failed)
			t[e.name] = e.value
	}

	e.update_value_input = function(ev) {
		let v = e.value
		if (e.parent_validator && e.parent_validator.failed)
			v = null
		e.value_input.value = (v != null ? e.to_form(v) : null) ?? ''
		e.value_input.disabled = v == null
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
	assert(e.input_widgets.len == 2)

	e.make_validator(true, opt.errors_tooltip_target)

	e.prop('form', {type: 'id', store: false})

	for (let ve of e.input_widgets) {

		let i = assert(ve.K)

		e.forward_prop('name'+i       , ve, 'name')
		e.forward_prop('required'+i   , ve, 'required')
		e.forward_prop('readonly'+i   , ve, 'readonly')
		e.forward_prop('input_value'+i, ve, 'input_value', 'value'+i)
		e.forward_prop('value'+i      , ve, 'value'      , null, 'bidi')
		e.forward_prop('invalid'+i    , ve, 'invalid'    , null, 'backward')

		e.do_after('set_form', function(s) {
			ve.form = s
		})

		ve.validator.parent_validator = e.validator

	}

	e.prop('range', {slot: 'state'})

	e.get_form = function() {
		return e.input_widgets[0].form
	}

	e.property('input_value', () => e)

}

/* <checkbox>, <toggle>, <radio> ---------------------------------------------

inherits:
	input_widget
css classes:
	.hover
config props:
	checked_value  unchecked_value
state attrs:
	checked
state props:
	checked <-> t|f
events:
	^input

*/

// checkbox, toggle, radio ---------------------------------------------------

// crbox is the fixed-size outer box of checkbox, toggle and radio.
css('.crbox', 'large t-m link h-c h-m round', `
	--w-crbox: 1em;
	min-width  : var(--w-crbox);
	min-height : var(--w-crbox);
	max-width  : var(--w-crbox);
	max-height : var(--w-crbox);
	--fg-check : var(--fg-link);
`)
css('.crbox.focusable', '', ` --w-crbox: 2em; `)

css_state('.crbox:focus-visible', '', ` --fg-check: white; `)

css_role_state('.crbox[invalid]', 'bg-error')

// making the inner markbox transparent instead of the crbox because we
// can't make the crbox transparent because that creates a stacking context
// and we can't attach popups to that. that's web dev for ya, like it?
css_state('.crbox[null] .markbox', 'op06')

css('.crbox-focus-circle', '', ` r: 10px; fill: none; `)
css_state('.crbox:focus-visible     .crbox-focus-circle', '', ` fill: var(--bg-focused-selected); `)
css_state('.crbox:is(:hover,.hover) .crbox-focus-circle', '', ` fill: var(--bg1); `)

function checked_state_prop(e) {
	e.property('checked_state', function() {
		if (this.bool_attr('null')) return null
		return this.bool_attr('checked') || false
	}, function(v) {
		this.bool_attr('checked', v || null)
		this.bool_attr('null', v == null || null)
	})
}

function checkbox_widget(e, markbox, input_type) {
	e.class('crbox focusable')
	markbox.class('markbox')
	e.add(markbox)
	e.make_disablable()
	e.make_input_widget()
	//e.is_bool = true
	e.input_value_default = () => e.unchecked_value
	e.make_focusable()
	e.property('label_element', function() {
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
		if (opt.value)
			e.checked_state = e.checked
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
	e.on('keydown', function(ev, key) {
		if (key == ' ' || key == 'Enter') {
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
		let label = e.label_element
		if (!label) return
		label.fire('target_hover', on)
	})

}

// checkbox ------------------------------------------------------------------

css('.check-line', '', `
	fill: none;
	stroke: var(--fg-check);
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-width: 1px;
`)
css('.check-frame', 'check-line', `
	rx    : 1px;
	ry    : 1px;
	x     : -4.6px;
	y 		: -4.6px;
	width :  9.2px;
	height:  9.2px;
`)
css('.check-mark', 'check-line ease', `
	transform: translate(-5px, -5px) scale(.5);
	stroke-width: 2px;
	stroke-dasharray : 20;
	stroke-dashoffset: 20;
	transition-property: transform, stroke-dashoffset;
`)

css_state('.checkbox[checked] .check-mark', 'ease', `
	stroke: var(--bg);
	stroke-dashoffset: 0;
	transition-property: transform, stroke-dashoffset;
`)

css_state('.checkbox:focus-visible', 'no-outline')

css_state('.checkbox:focus-visible .check-mark', 'ease', `
	stroke: var(--bg-focused-selected);
	transition-property: transform, stroke-dashoffset;
`)

css_state('.checkbox[checked] .check-frame', '', `
	fill: var(--fg-check);
`)

css_state('.checkbox[null] .check-frame', '', `
	stroke : var(--fg);
	fill   : var(--fg);
`)

e.make_checkbox = function(focusable) {
	let e = this
	e.make_checkbox = noop
	e.clear()
	e.class('crbox checkbox')
	e.class('focusable', !!focusable)
	e.markbox = svg({viewBox: focusable ? '-10 -10 20 20' : '-5 -5 10 10', class: 'markbox'})
	if (focusable)
		e.markbox.append(svg_tag('circle', {class: 'crbox-focus-circle'}))
	e.markbox.append(svg_tag('rect', {class: 'check-frame'}))
	e.markbox.append(svg_tag('polyline', {class: 'check-mark' , points: '4 11 8 15 16 6'}))
	e.add(e.markbox)
	checked_state_prop(e)
}

G.checkbox = component('checkbox', function(e) {
	e.make_checkbox(true)
	checkbox_widget(e, e.markbox)
})

/* toggle --------------------------------------------------------------------

inherits:
	checkbox_widget

*/

css('.toggle', 'm t-m p-05 round bg1 h-m ease ring rel', `
	min-width  : 2.4em;
	max-width  : 2.4em;
	min-height : 1.4em;
	max-height : 1.4em;
`)

/* TODO: pixel snapping makes this look wrong sometimes, redo it with svg. */
css('.toggle-thumb', 'round ring ease abs', `
	min-width  : 1em;
	min-height : 1em;
	left: .2em;
	background: white;
`)
css_state('.toggle[checked]', '', `
	background: var(--bg-button-primary);
`)
css_state('.toggle[checked] .toggle-thumb', 'ease', `
	transform: translateX(100%);
`)
css_state('.toggle-thumb:focus-visible', 'outline-focus')

G.toggle = component('toggle', function(e) {
	e.clear()
	e.class('toggle')
	e.markbox = div({class: 'toggle-thumb'})
	checkbox_widget(e, e.markbox)
	checked_state_prop(e)
	e.on('keydown', function(ev, key) {
		if (key == 'ArrowLeft' || key == 'ArrowRight') {
			e.user_set(key == 'ArrowRight', ev)
			return false
		}
	})
})

/* <radio> -------------------------------------------------------------------

inherits:
	checkbox_widget

*/

css('.radio-circle', '', `
	r: 5px;
	fill: none;
	stroke: var(--fg-check);
	stroke-width: 1px;
`)

css('.radio-thumb' , 'ease', ` r: 0; fill: var(--fg-check); `)

css_state('.radio[checked] .radio-thumb', 'ease', ` r: 2px; transition-property: r; `)

css_state('.radio:focus-visible', 'no-outline')

e.make_radio = function(focusable) {
	let e = this
	e.clear()
	e.class('crbox radio')
	e.markbox = svg({viewBox: focusable ? '-10 -10 20 20' : '-5 -5 10 10', class: 'markbox'})
	if (focusable)
		e.markbox.append(svg_tag('circle', {class: 'crbox-focus-circle'}))
	e.markbox.append(svg_tag('circle', {class: 'radio-circle'}))
	e.markbox.append(svg_tag('circle', {class: 'radio-thumb'}))
	e.add(e.markbox)
}

G.radio = component('radio', function(e) {

	e.make_radio(true)
	checkbox_widget(e, e.markbox, 'radio')
	checked_state_prop(e)

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
		ev = ev || {target: e}
		e.set_prop('checked', v, ev)
		e.fireup('input', ev)
	}

	e.next_radio = function(inc) {
		let res = e.group_elements()
		return res[mod(res.indexOf(e)+inc, res.len)]
	}

	e.on('keydown', function(ev, key) {
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

css('.slider', 'h t-m noclip rel p-y-2', `
	--slider-marked: 1;
	--slider-mark-w: 50px; /* pixels only! */
	min-width: 8em;
	margin-left   : calc((var(--slider-marked) * var(--slider-mark-w) / 2) + var(--space-2));
	margin-right  : calc((var(--slider-marked) * var(--slider-mark-w) / 2) + var(--space-2));
	margin-top    : calc(var(--space-1) + 1em);
	margin-bottom : calc(var(--space-1) + 1em + var(--slider-marked) * 1em);
	width: calc(var(--w-input) - margin-left - margin-right);
`)
css('.slider-fill', 'abs round', ` height: 3px; `)
css('.slider-bg-fill', 'bg1')
css('.slider-valid-fill', 'bg3')
css('.slider-value-fill', 'bg-link')

// wrapping the thumb circle because we can't attach a popup to a transparent
// object because it creates a stacking context.
css('.slider-thumb', 'abs h ease', `
	--w-slider-thumb: 1.2em;
	/* center vertically relative to the fill */
	margin-top : calc((0px - var(--w-slider-thumb)) / 2 + 1px);
	margin-left: calc((0px - var(--w-slider-thumb)) / 2);
	width  : var(--w-slider-thumb);
	height : var(--w-slider-thumb);
	transition-property: width, height, margin-top, margin-left;
`)
css('.slider-thumb-circle', 'S bg-link round', `
	box-shadow: var(--shadow-thumb);
`)
css_state('.slider-thumb-circle', '', `
	outline-offset: 3px;
`)

// toggling visibility on hover requires click-through for stable hovering!
css('.slider-tooltip', 'click-through m-l-0 ease', `
	/* TODO: no matter what, the popup just doesn't wanna keep up with its target	*/
	transition-duration: .02s;
`)

css('.slider-marks', 'abs click-through')
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

css_state('.slider-thumb[invalid] .slider-thumb-circle', 'bg-error')
css_state('.slider-thumb[null]    .slider-thumb-circle', 'op05')
css_state('.slider[invalid] .slider-value-fill', 'bg-error')
css_state('.slider[null]    .slider-value-fill', 'op05')

css_state('.slider.animate .slider-thumb       ', 'ease')
css_state('.slider.animate .slider-value-fill'  , 'ease')

css_state(`
	.slider:not(.range):hover .slider-thumb,
	.slider-thumb:hover
`, 'ease', `
	--w-slider-thumb: 1.4em;
	transition-property: width, height, margin-top, margin-left;
`)

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
	e.range_type = 'number'

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
		return e.decimals != null ? v.dec(e.decimals) : v
	}

	e.thumbs = []
	e.input_widgets = e.thumbs
	e.thumb_circles = []
	for (let K of range ? ['1', '2'] : ['']) {
		let circle = div({class: 'slider-thumb-circle'})
		let thumb = tag('slider-thumb', {class: 'slider-thumb'}, circle)
		e.thumbs.push(thumb)
		e.thumb_circles.push(circle)
		thumb.class('slider-thumb')
		thumb.K = K
		if (range) {
			thumb.is_number = true
			thumb.to_text = to_text
			thumb.to_form = to_text
			thumb.make_input_widget({
				errors_tooltip_target: false,
			})
			thumb.prop('min', {type: 'number'})
			thumb.prop('max', {type: 'number'})
			e.forward_prop('min', thumb, 'min')
			e.forward_prop('max', thumb, 'max')
		}
	}
	if (range) {
		e.make_range_input_widget({
			errors_tooltip_target: false,
		})
		e.to_text = to_text
		e.prop('min_range', {type: 'number', default: 0})
		e.prop('max_range', {type: 'number', default: 1/0})
	} else {
		e.is_number = true
		e.to_text = to_text
		e.to_form = to_text
		e.make_input_widget({
			errors_tooltip_target: false,
		})
		e.prop('min', {type: 'number'})
		e.prop('max', {type: 'number'})
	}

	e.add(e.bg_fill, e.valid_fill, e.value_fill, e.marks, ...e.thumbs)

	e.make_focusable(...e.thumb_circles)

	// model: progress (visual, not validated)

	function cmin() { return max(e.min ?? -1/0, e.from) }
	function cmax() { return min(e.max ??  1/0, e.to  ) }

	function multiple() { return e.decimals ? 1 / 10 ** e.decimals : 1 }

	function progress_for(v) {
		return clamp(lerp(v, e.from, e.to, 0, 1), 0, 1)
	}

	e.set_input_value_for = function(K, v, ev) {

		if (e.decimals != null)
			v = floor(v / multiple() + .5) * multiple()

		if (e.value1 != null && e.value2 != null) {
			if (K == '1') v = clamp(v, e.value2 - e.max_range, e.value2 - e.min_range)
			if (K == '2') v = clamp(v, e.value1 + e.min_range, e.value1 + e.max_range)
		}
		v = clamp(v, cmin(), cmax())

		e.set_prop('input_value'+K, v, ev)
	}

	e.set_progress_for = function(K, p, ev) {
		let v = lerp(p, 0, 1, e.from, e.to)
		e.set_input_value_for(K, v, ev)
	}

	e.get_progress_for = function(K) {
		let v = num(e['input_value'+K])
		if (v == null) {
			if (K == '1') v = cmin()
			if (K == '2') v = cmax()
			if (K == '' ) v = (cmax() + cmin()) / 2
		}
		return progress_for(v)
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
		e.fireup('input', ev)
	}

	function update_thumb(thumb, p) {
		thumb.bool_attr('invalid', (range ? thumb.invalid : e.invalid) || null)
		thumb.bool_attr('null', e['input_value'+thumb.K] == null || null)
		thumb.x1 = (p * 100)+'%'
		update_tooltip(thumb, true)
	}

	function update_fill(fill, p1, p2) {
		fill.x1 = (p1 * 100)+'%'
		fill.x2 = ((1-p2) * 100)+'%'
	}

	function update_tooltip(thumb, update_text) {
		let show = (thumb.hovered || thumb.at[0].focus_visible)
		if (!show && !thumb.tooltip)
			return
		if (!thumb.tooltip) {
			thumb.tooltip = tooltip({align: 'center', classes: 'slider-tooltip'})
			thumb.add(thumb.tooltip)
			update_text = true
		}
		if (update_text) {
			thumb.tooltip.kind = e.invalid ? 'error' : null
			let tfr = thumb.validator && thumb.validator.first_failed_result
			let efr = e.validator && e.validator.first_failed_result
			let v = e['input_value'+thumb.K]
			let a = [field_value(range ? thumb : e, v)]
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

		if (range) {
			p1 = e.get_progress_for('1')
			p2 = e.get_progress_for('2')
		} else {
			p1 = progress_for(cmin())
			p2 = e.get_progress_for('')
		}
		update_fill(e.value_fill, min(p1, p2), max(p1, p2))

		for (let thumb of e.thumbs) {
			let p = e.get_progress_for(thumb.K)
			update_thumb(thumb, p)
		}

		e.bool_attr('null', (range
			? e.input_value1 == null && e.input_value2 == null
			: e.input_value == null) || null)

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
		m.v = v
		l.set(to_text(v))
	}
	function position_marks() {
		for (let m of e.marks.at)
			m.x = lerp(m.v, e.from, e.to, 0, w)
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

		position_marks()
	}

	e.on_position(function() {
		if (!e.marks.len)
			update_marks()
		position_marks()
	})

	// controller

	e.class('animate')

	for (let thumb of e.thumbs) {

		function update_tt() { update_tooltip(thumb) }
		thumb.on('hover'   , update_tt)
		thumb.on('focusin' , update_tt)
		thumb.on('focusout', update_tt)
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

		thumb.on('keydown', function(ev, key, shift, ctrl, alt) {
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
			if (key == 'Delete') {
				e.set_prop('input_value'+this.K, null, ev)
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

css('.input-group', 'shrinks-h t-m m-y-05 lh-input h-s')

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
// TODO: finish this: `rel` obscures the focus outline of the parent!
css_role('.labelbox[overlaid]', 'rel ro-var', `
	--p-y-input-adjust: .1em;
`)
// TODO: finish this: `abs` ::before cannot be painted before text content!
css_role('.labelbox[overlaid] > .label-widget::before', 'overlay m-l bg-input', `
	top: -1px;
	left: -.25em;
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

css('.textarea', 'm-y-05 S shrinks p-input h flex b p bg-input w-input', `
	font: inherit;
	resize: none;
	overflow-y: overlay; /* Chrome only */
	overflow-x: overlay; /* Chrome only */
`)

G.textarea = component('textarea', 'Input', function(e) {

	e.class('textarea unframe')
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

css('.button', 'h-c h-m p-x-button semibold nowrap noselect no-shrink', `
	font-family : inherit;
	font-size   : var(--fs);
`)

css_util('.large ', '', `--p-x-button: var(--space-4); `)
css_util('.xlarge', '', `--p-x-button: var(--space-4); `)

css('.button.text-empty > .button-text', 'hidden')

css('.button-icon', 'w1 h-c')

css('.button:not([bare])', 'ro-var', `
	background: var(--bg-button);
	box-shadow: var(--shadow-button);
`)
css_state('.button:not([bare]):hover', '', `
	background: var(--bg-button-hover);
`)
css_state('.button:not([bare]):active', '', `
	background: var(--bg-button-active);
	box-shadow: var(--shadow-button-active);
`)

css('.button[primary]:not([bare])', 'b-invisible on-dark', `
	background: var(--bg-button-primary);
`)
css_state('.button[primary]:not([bare]):hover', '', `
	background: var(--bg-button-primary-hover);
`)
css_state('.button[primary]:not([bare]):active', '', `
	background: var(--bg-button-primary-active);
`)

css('.button[danger]:not([bare])', '', `
	background: var(--bg-button-danger);
`)
css_state('.button[danger]:not([bare]):hover', '', `
	background: var(--bg-button-danger-hover);
`)
css_state('.button[danger]:not([bare]):active', '', `
	background: var(--bg-button-danger-active);
`)

css('.button[bare]', 'no-bg b0 no-shadow')
css('.button[bare][primary]', 'link')
css_state('.button[bare]:hover' , 'fg-hover')
css_state('.button[bare]:active', 'fg-active')

css_state('.button[selected]:not([bare])', '', `
	box-shadow: var(--shadow-pressed);
`)

css('.input-group > .button[bare]', 'b')
css_state('.input-group[invalid] > .button[bare]', 'bg-error')

// attention animation

G.button = component('button', 'Input', function(e) {

	e.prop_vals.text = [...e.nodes]
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
		e.class('text-empty', !s || isarray(s) && !s.len)
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
	e.prop('load_spin', {to_attr: true})

	e.prop('primary'    , {type: 'bool', default: false, to_attr: true})
	e.prop('bare'       , {type: 'bool', default: false, to_attr: true})
	e.prop('danger'     , {type: 'bool', default: false, to_attr: true})
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
		e.animate([{
			'transform'      : 'scale(1.2)',
			'outline'        : '2px solid var(--fg)',
			'outline-offset' : '2px',
		}], {duration: 200})
	}

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
css('.select-button-box', 'rel ro-var h-s gap-x-0 bg-input shadow-button', `
	padding: var(--p-select-button, 3px);
	--p-y-input-offset: calc(1px - var(--p-select-button, 3px));
`)
css_state('.select-button[invalid] .select-button-box', 'bg-error')

css_util('.smaller', '', ` --p-select-button: 2px; `)
css_util('.xsmall' , '', ` --p-select-button: 1px; `)
css_util('.small'  , '', ` --p-select-button: 1px; `)

css('.select-button-box > :not(.select-button-plate)',
	'S h-m h-c p-y-input p-x-button gap-x nowrap-dots noselect dim z1', `
	flex-basis: fit-content;
`)
css('.select-button-box > :not(.select-button-plate):not(.selected):hover', 'fg-hover')
css('.select-button-box > :not(.select-button-plate).selected', 'on-dark')

css('.select-button-plate', 'abs ease shadow-button', `
	transition-property: left, width;
	border-radius: calc(var(--border-radius, var(--space-075)) * 0.7);
	background: var(--bg-button-primary);
`)

// not sure about this one...
css_state('.select-button-box:focus-visible', 'no-outline')
css_state('.select-button-box:focus-visible .select-button-plate', 'outline-focus')

G.select_button = component('select-button', function(e) {

	e.make_items_prop()

	e.class('select-button inputbox')

	e.inputbox = div({class: 'select-button-box inputbox'})
	e.add(e.inputbox)

	e.make_disablable(e.inputbox)
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

	e.prop('known_values', {slot: 'state'})

	e.do_after('set_items', function(items) {
		let kv = map()
		for (let item of items)
			kv.set(e.item_value(item), true)
		e.known_values = kv
	})

	// view

	e.on_update(function(opt) {
		if (opt.items) {
			e.inputbox.clear()
			e.inputbox.set([...e.items, e.plate])
			opt.value = true
		}
		if (opt.value) {
			e.selected_item = null
			if (e.value != null)
				for (let b of e.inputbox.at) {
					if (b != e.plate && e.item_value(b) === e.value) {
						e.selected_item = b
						break
					}
				}
		} else if (opt.selected_index) {
			let i = e.selected_index
			e.selected_item = i != null ? clamp_item_index(i) : null
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

	e.listen('layout_changed', function() {
		e.position()
	})

	// controller

	e.on_validate(function(ev) {
		e.update({value: true})
	})

	e.user_set = function(b, ev) {
		let v = b ? e.item_value(b) : null
		if (v != null) {
			e.set_prop('input_value', v, ev)
		} else {
			e.selected_index = b.index
		}
		e.fireup('input', ev)
	}

	e.inputbox.on('click', function(ev) {
		let b = ev.target
		while (b && b.parent != e.inputbox) b = b.parent
		if (!b || b.parent != e.inputbox || b == e.plate) return
		e.user_set(b, ev)
	})

	e.inputbox.on('keydown', function(ev, key, shift, ctrl, alt) {
		if (alt || shift || ctrl)
			return
		if (key == 'ArrowRight' || key == 'ArrowLeft' || key == 'ArrowUp' || key == 'ArrowDown') {
			let fw = key == 'ArrowRight' || key == 'ArrowDown'
			let b = e.selected_item
			let i = clamp((b ? b.index : 0) + (fw ? 1 : -1), 0, e.inputbox.len-2)
			e.user_set(e.inputbox.at[i], ev)
			return false
		}
	})

	e.on('resize', function() {
		e.position()
	})

})

G.vselect_button = component('vselect-button', function(e) {

	e.class('vselect-button ro-collapse-v b-collapse-v')
	return e.construct('select-button')

})

/* <textarea-input> ----------------------------------------------------------

This is a validated textarea. We wrap a <textarea> in an element because we
can't add elements to <textarea> directly and we need to add the errors popup.
We do the same with <text-input> and all other inputs below.

inherits:
	input_widget
config props:
	max_len
	placeholder
update options:
	select_all

*/

// NOTE: we use 'skip' on the root element so that it doesn't have a box
// that errors popup would get hover event over.
css('.textarea-input', 'skip')
css('.textarea-input-textarea', '')
css_state('.textarea-input[invalid] .textarea-input-textarea', 'bg-error')

G.textarea_input = component('textarea-input', 'Input', function(e) {

	e.clear()
	e.class('textarea-input')
	e.textarea = textarea({classes: 'textarea-input-textarea'})
	e.add(e.textarea)

	e.prop('max_len', {type: 'number'})

	e.forward_prop('placeholder', e.textarea)

	e.make_input_widget({
		errors_tooltip_target: e.textarea,
	})

	e.make_focusable(e.textarea)

	e.on_update(function(opt) {
		if (opt.select_all)
			e.input.select_range(0, -1)
	})

	// controller

	e.do_after('set_input_value', function(v, v0, ev) {
		if (!(ev && ev.target == e.textarea))
			e.textarea.value = v
	})

	e.textarea.on('input', function(ev) {
		e.set_prop('input_value', repl(this.value, '', null), ev)
	})

})

/* <text-input> --------------------------------------------------------------

inherits:
	input_widget
config props:
	max_len
	placeholder
update options:
	select_all

*/

// NOTE: we use 'skip' on the root element and create an <input-group> inside
// so that we can add popups to the widget without messing up the CSS.
css('.text-input', 'skip')
css('.text-input-group', 'w-input bg-input')
css('.text-input-group[invalid] .input::placeholder', 'bg-error op05')
css('.text-input-input', 'S shrinks')
css('.text-input[align=left ] .text-input-input', 't-l p-r-0')
css('.text-input[align=right] .text-input-input', 't-r p-l-0')

css('.text-input', 'skip')

css('.text-input-clear-button', 'small label m0')
css('.text-input[align=left]  .text-input-clear-button .button-icon', '', `margin-left: -1em;`)
css('.text-input[align=right] .text-input-clear-button .button-icon', '', `margin-right: -1em;`)
css_state('.text-input .text-input-clear-button .button-icon', 'op0')
css_state('.text-input:not(.empty):hover .text-input-clear-button .button-icon', 'op1')

G.text_input = component('text-input', 'Input', function(e) {

	e.clear()
	e.class('text-input')
	e.input_group = div({class: 'text-input-group input-group b-collapse-h ro-collapse-h'})
	e.add(e.input_group)

	e.prop('align', {type: 'enum', enum_values: 'left right', default: 'left', to_attr: true})
	e.prop('with_clear_button', {type: 'bool', default: false, to_attr: true})
	e.prop('max_len', {type: 'number'})

	function add_clear_button() {
		let b = e.clear_button
		if (!b) return
		e.input_group.insert(e.align == 'right' ? 0 : 1, b)
	}

	e.set_with_clear_button = function(v) {
		if (v && !e.clear_button) {
			e.clear_button = button({
				classes: 'text-input-clear-button',
				bare: true,
				focusable: false,
				icon: 'fa fa-times',
				action: function(ev) {
					e.input_value = null
					e.fireup('input', ev)
				},
			})
			add_clear_button()
		}
		if (e.clear_button)
			e.clear_button.show(v)
	}

	e.set_align = function(v) {
		add_clear_button()
	}

	e.make_input_widget({
		errors_tooltip_target: e.input_group,
	})

	e.input = input({classes: 'text-input-input'})
	e.input_group.add(e.input)

	e.forward_prop('placeholder', e.input)

	e.make_focusable(e.input)
	e.input_group.make_focus_ring(e.input)

	e.on_update(function(opt) {
		if (opt.select_all)
			e.input.select_range(0, -1)
	})

	// controller

	e.do_after('set_input_value', function(v, v0, ev) {
		if (!(ev && ev.target == e.input))
			e.input.value = v
		e.class('empty', v == null)
	})

	e.input.on('input', function(ev) {
		e.set_prop('input_value', repl(this.value, '', null), ev)
	})

})

/* <pass-input> --------------------------------------------------------------

inherits:
	input_widget
config props:
	conditions
	min_len
	min_score
	placeholder
update options:
	select_all

*/

// NOTE: we use 'skip' on the root element and create an <input-group> inside
// so that we can add popups to the widget without messing up the CSS.
css('.pass-input', 'skip')
css('.pass-input-group', 'w-input bg-input')
css('.pass-input-input', 'S shrinks p-r-0')

css('.pass-input-button', 'h-m h-c b p0 label', `width: 2.75em;`)
css_generic_state('.pass-input-button[disabled]', 'op1 no-filter dim')

let load_zxcvbn = memoize(function() {
	let script = tag('script')
	script.onload = function() {
		announce('validation_rules_changed', 'zxcvbn')
	}
	script.src = 'zxcvbn.js'
	root.add(script)
})

G.pass_input = component('pass-input', 'Input', function(e) {

	e.clear()
	e.class('pass-input')
	e.input_group = div({class: 'pass-input-group input-group b-collapse-h ro-collapse-h'})
	e.add(e.input_group)

	e.make_input_widget({
		errors_tooltip_target: e.input_group,
	})

	e.prop('min_len', {type: 'number', default: 6})
	e.prop('min_score', {type: 'number', default: 3}) // 0..4, 3+ is safe.
	e.prop('conditions', {type: 'array', element_type: 'string', parse: words,
		// NOTE: remove `min-score` if you don't want to load the gigantic library,
		// and replace with 'lower upper digit symbol', which is reasonable.
		default: 'min-score',
	})

	function update_score() {
		e.score = (G.zxcvbn && e.input_value != null) ?
			zxcvbn(e.input_value).score : null
		e.fire('score_changed')
	}

	let zxcvbn_loaded
	e.set_conditions = function(cond) {
		if (cond.includes('min-score') && !zxcvbn_loaded) {
			zxcvbn_loaded = true
			e.listen('validation_rules_changed', function(which) {
				if (which == 'zxcvbn') {
					update_score()
					e.validate()
				}
			})
			load_zxcvbn()
		}
	}
	e.on_init(function() {
		e.set_conditions(e.conditions)
	})

	e.input = input({classes: 'pass-input-input', type: 'password'})
	e.eye_button = button({
		type: 'button', // no submit
		classes: 'pass-input-button',
		icon: 'far fa-eye',
		bare: true,
		focusable: false,
		title: S('view_password', 'View password'),
	})
	e.input_group.add(e.input, e.eye_button)

	e.forward_prop('placeholder', e.input)

	e.make_focusable(e.input)
	e.input_group.make_focus_ring(e.input)

	e.on_update(function(opt) {
		if (opt.select_all)
			e.input.select_range(0, -1)
	})

	// controller

	e.do_after('set_input_value', function(v, v0, ev) {
		update_score()
		if (!(ev && ev.target == e.input))
			e.input.value = v
		e.eye_button.disable('empty', !v)
	})

	e.input.on('input', function(ev) {
		e.set_prop('input_value', repl(this.value, '', null), ev)
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

css('.pass-score', 'v w-input')
css('.pass-score-bar', 'm-y-05 ro', `
	height: 4px;
	background: var(--color);
`)
css('.pass-score[score="0"]', '', `--color: var(--bg-error);`)
css('.pass-score[score="1"]', '', `--color: var(--bg-error);`)
css('.pass-score[score="2"]', '', `--color: var(--bg-warn);`)
css('.pass-score[score="3"]', '', `--color: green;`)
css('.pass-score[score="4"]', '', `--color: green;`)
css('.pass-score-label', 'self-v-r smaller', `color: var(--color);`)
css('.pass-score-label::before', 'zwsp')

G.pass_score = component('pass-score', function(e) {

	e.class('pass-score')
	e.clear()
	e.bar   = div({class: 'pass-score-bar'})
	e.label = div({class: 'pass-score-label'})
	e.add(e.bar, e.label)

	e.prop('for', {slot: 'state'})
	e.prop('for_id', {type: 'id', attr: 'for', bind_id: 'for'})

	function update_score() {
		let score = e.for ? e.for.score : null
		e.attr('score', score)
		e.bar.w = score != null ? (((1 + score) / 5) * 100) + '%' : 0
		e.label.set(score != null ? pass_score_rules[score] : '')
	}
	e.set_for = function(te1, te0) {
		if (te0) te0.on('score_changed', update_score, false)
		if (te1) te1.on('score_changed', update_score, true)
		update_score()
	}


})

/* <num-input> ---------------------------------------------------------------

inherits:
	input_widget
model options:
	min
	max
	decimals
view options:
	buttons          none | plus-minus | up-down
	placeholder
update options:
	value
	select_all

*/

// NOTE: we use 'skip' on the root element and create an <input-group> inside
// so that we can add popups to the widget without messing up the CSS.
css('.num-input', 'skip')
css('.num-input-group', 'w-input bg-input')

css('.num-input-input', 'S shrinks t-r')

css('.num-input-button' , 'm0 p-y-0 p-x-075 h-m')

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
		errors_tooltip_target: e.input_group,
	})

	e.prop('min', {type: 'number'})
	e.prop('max', {type: 'number'})
	e.prop('decimals', {type: 'number', default: 0})

	e.input = tag('input', {class: 'num-input-input'})
	e.make_focusable(e.input)
	e.input_group.make_focus_ring(e.input)

	e.forward_prop('placeholder', e.input)

	e.prop('buttons', {type: 'enum', enum_values: 'none up-down plus-minus',
		default: 'none', to_attr: true})

	function update_buttons() {
		for (let b of e.$('button'))
			b.disable('readonly', e.readonly)
	}

	e.set_buttons = function(v) {
		if (v == 'up-down') {
			e.up_button = button({
				type: 'button', // no submit
				classes: 'num-input-button num-input-button-updown num-input-button-up',
				bare: true,
				focusable: false,
			}, div({class: 'num-input-arrow num-input-arrow-up'}))
			e.down_button = button({
				type: 'button', // no submit
				classes: 'num-input-button num-input-button-updown num-input-button-down',
				bare: true,
				focusable: false,
			}, div({class: 'num-input-arrow num-input-arrow-down'}))
			e.updown_box = div({class: 'num-input-updown-box'},
				div({class: 'num-input-updown'}, e.up_button, e.down_button))
			e.input_group.set([e.input, e.updown_box])
		} else if (v == 'plus-minus') {
			e.up_button   = button({
				type: 'button', // no submit
				classes: 'num-input-button num-input-button-plusminus num-input-button-plus',
				bare: true,
				focusable: false,
				icon: svg_plus_sign(),
			})
			e.down_button = button({
				type: 'button', // no submit
				classes: 'num-input-button num-input-button-plusminus num-input-button-minus',
				bare: true,
				focusable: false,
				icon: svg_minus_sign(),
			})
			e.input_group.set([e.down_button, e.input, e.up_button])
		} else {
			e.input_group.set(e.input)
		}
		if (e.up_button) {
			e.up_button  .on('pointerdown',   up_button_pointerdown)
			e.down_button.on('pointerdown', down_button_pointerdown)
		}
		update_buttons()
	}

	e.to_text = function(v) {
		return e.decimals != null ? v.dec(e.decimals) : v
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
		if (opt.value) {
			let v = e.value
			e.input.value = v != null ? to_input(v) : e.input_value
		}
		if (opt.select_all)
			e.input.select_range(0, -1)
	})

	e.increment_value = function(increment, ctrl, ev) {
		let v = e.validator.failed ? null : e.value
		if (v == null) {
			v = increment > 0 ? e.min ?? e.max : e.max ?? e.min
			increment = 0
		}
		if (v == null)
			return
		let m = e.decimals ? 1 / 10 ** e.decimals : 1
		v += m * increment * (ctrl ? 10 : 1)
		v = snap(v, m)
		if (!e.try_validate(v))
			return
		e.set_prop('input_value', v, ev)
		e.update({value: true, select_all: true})
		e.fireup('input', ev)
	}

	// controller

	e.on_validate(function(ev) {
		if (!(ev && ev.target == e.input))
			e.update({value: true})
	})

	e.input.on('input', function(ev) {
		if (repl(repl(this.value, '-'), '.') == null)
			return // just started typing, don't buzz.
		e.set_prop('input_value', repl(this.value, '', null), ev)
	})

	e.input.on('wheel', function(ev, dy) {
		e.increment_value(round(-dy / 120))
		return false
	})

	e.on('keydown', function(ev, key, shift, ctrl, alt) {
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

/* <tags-box> ----------------------------------------------------------------

state:
	tags: 'tag1 ...' || ['tag1', ...]

*/

css('.tags-box', 'm-y p-y-05 h-m flex-wrap gap-y', `
	--tag-hue: 154;
	--tag-lum: 1;
`)

css('.tags-tag', 'm-x-05 p-y-025 p-x-input gap-x ro-var-075 h-m noselect', `
	background  : hsl(var(--tag-hue), 32%, calc(28% * var(--tag-lum)));
	color       : hsl(var(--tag-hue), 87%, calc(61% * var(--tag-lum)));
`)
css_state('.tags-tag.invalid', '', `
	--tag-hue: 0;
	--tag-lum: 2;
`)
css_role(':is(.xsmall, .small, .smaller).tags-box, :is(.xsmall, .small, .smaller) :is(.tags-box, .tags-tag)', 'p-y-0')
css_role_state('.tags-tag:focus-visible', '', `
	background  : hsl(var(--tag-hue), 32%, calc(38% * var(--tag-lum)));
`)

css('.tags-x', 'round h-m h-c small bold', `
	width : 1.1em;
	height: 1.1em;
	--fg-h: var(--tag-hue);
	--fg-s: 63%;
	--fg-l: calc(var(--tag-lum-f, 43%) * var(--tag-lum));
`)
css_state('.tags-x:hover' , '', ` --tag-lum-f: 53%; `)
css_state('.tags-x:active', '', ` --tag-lum-f: 63%; `)

function parse_tags(tags) {
	tags = isstr(tags) ? (tags.trim().starts('[') ? try_json_arg(tags) : tags.words()) : tags
	if (isarray(tags))
		tags.sort().uniq_sorted()
	return tags
}

G.tags_box = component('tags-box', function(e) {

	e.class('tags-box')
	e.make_disablable()

	// model

	e.prop('tags', {type: 'array', element_type: 'string', parse: parse_tags})

	e.remove_tag = function(tag, ev) {
		let t1 = e.tags.slice()
		let i = t1.remove_value(tag)
		e.set_prop('tags', t1, ev)
		return i
	}

	// view

	e.clear()

	e.make_tag = function(s) {
		let [tag, tag_attrs] = s.split('###')
		let x = svg_circle_x({class: 'tags-x'})
		let t = div({class: 'tags-tag'}, tag, x)
		if (tag_attrs) // TODO: this is not used
			for (let attr of tag_attrs.split(','))
				t.bool_attr(attr.trim(), true)
		t.value = tag
		t.make_focusable()
		t.on('dblclick', tag_dblclick)
		t.on('keydown', tag_keydown)
		x.on('pointerdown', return_false) // prevent bubbling
		x.on('click', tag_x_click)
		return t
	}

	e.set_tags = function(tags) {
		e.clear()
		if (tags)
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

	function tag_dblclick(ev) {
		e.remove_tag(this.value, ev)
		e.fireup('input', ev)
	}

	function tag_x_click(ev) {
		e.remove_tag(this.parent.value, ev)
		e.fireup('input', ev)
	}

	function tag_keydown(ev, key) {
		if (key == 'Delete') {
			let i = e.remove_tag(this.value, ev)
			e.fireup('input', ev)
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
	format        array | words
	valid_tags    'tag1 ...'
state:
	tags: 'tag1 ...' || ['tag1', ...]

*/

// NOTE: we use 'skip' on the root element and create an <input-group> inside
// so that we can add popups to the widget without messing up the CSS.
css('.tags-input', 'skip')
css('.tags-input-group', 'shrinks-h')
css('.tags-input-input', 'S')
css('.tags-scrollbox', 'shrinks h-m b-r-0 clip')
css('.tags-input .tags-box', 'rel shrinks m0')
css('.tags-input .tags-input-input', 'p-x-input b-l-0', `min-width: 5em;`)
css('.tags-box-nowrap', 'flex-nowrap')

G.tags_input = component('tags-input', function(e) {

	e.clear()

	e.class('tags-input')
	e.input_group = div({class: 'tags-input-group input-group'})
	e.add(e.input_group)
	e.make_disablable(e.input_group)

	e.tags_box = tags_box()
	e.tag_input = tag('input', {class: 'tags-input-input', placeholder: 'Tag'})
	e.tags_scrollbox = div({class: 'tags-scrollbox'}, e.tags_box)
	e.input_group.add(e.tags_scrollbox, e.tag_input)
	e.make_focusable(e.tag_input)
	e.input_group.make_focus_ring(e.tag_input)

	e.prop('format', {type: 'enum', enum_values: 'array words', default: 'array'})

	e.to_text = tags => tags.join(', ')
	e.to_form = tags => e.format == 'words' ? tags.join(' ') : json(tags)

	e.is_values = true
	e.make_input_widget({
		errors_tooltip_target: e.input_group,
	})

	e.prop('valid_tags', {type: 'array', element_type: 'string', parse: parse_tags})

	e.prop('known_values', {slot: 'state'})
	e.set_valid_tags = function(tags) {
		let kv = map()
		for (let tag of tags)
			kv.set(tag, true)
		e.known_values = kv
	}

	e.prop('nowrap', {type: 'bool', default: false})
	e.set_nowrap = (v) => e.tags_box.class('tags-box-nowrap', !!v)

	e.user_set_tags = function(tags, ev) {
		e.tags_box.x = null
		e.set_prop('input_value', tags, ev)
		if (ev.type != 'input')
			e.fireup('input', ev)
	}

	e.tags_box.on('input', function(ev) {
		e.user_set_tags(this.tags, ev)
	})

	e.on_validate(function(ev) {
		e.tags_box.tags = e.input_value
		e.update({value: true})
	})

	e.on_update(function(opt) {
		if (opt.value)
			for (let tag_div of e.tags_box.at)
				tag_div.class('invalid', e.known_values && !e.known_values.has(tag_div.value))
	})

	e.tag_input.on('keydown', function(ev, key) {
		if (key == 'Backspace') {
			let s = this.value
			if (s) {
				let s1 = this.selectionStart
				let s2 = this.selectionEnd
				if (s1 != s2) return
				if (s1 != 0 ) return
			}
			e.user_set_tags(e.tags_box.tags.slice(0, -1), ev)
			return false
		}
		if (key == 'Enter') {
			let s = this.value
			if (!s)
				return false
			this.value = ''
			let t1 = e.tags_box.tags.slice()
			for (let tag of e.format == 'words' ? s.words() : [s]) {
				t1.push(tag)
				e.tags_box.focus_tag(tag) // scroll tag into view
			}
			t1.remove_duplicates()
			e.user_set_tags(t1, ev)
			e.tag_input.focus()
			return false
		}
	})

	e.tags_box.on('hover', function(ev, on) {
		this.class('grab', on && !ev.target.closest('.tags-x') && this.sw > this.cw)
	})

	// TODO: this inhibits tab dblclick event, find out why.
	e.tags_box.on('pointerdown', function(ev, mx0) {
		mx0 -= this.x || 0
		let w = this.sw - this.cw
		if (w == 0) {
			this.x = null
			return
		}
		this.capture_pointer(ev, function(ev, mx) {
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
	value_key: 'value'
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
	open  ([focus], [ev])
	close ([focus], [ev])
	toggle([focus], [ev])
update opts:
	value

*/

// NOTE: we use 'skip' on the root element and create an <inputbox> inside
// so that we can add popups to the widget without messing up the CSS.
css('.dropdown', 'skip')
css('.dropdown-inputbox', 'gap-x arrow h-sb bg-input w-input')
css('.dropdown-value', 'S shrinks h-m nowrap')
css('.dropdown-value:empty::before', 'zwsp', `content: 'Bananas';`)
css('.dropdown-value.null', 'label')
css('.dropdown-chevron', 'small ease')
css('.dropdown.open .dropdown-chevron::before', 'icon-chevron-up ease')
css_state('.dropdown.open :is(.dropdown-inputbox, .dropdown-picker)', 'shadow-picker')
css('.dropdown:not(.open) .dropdown-chevron::before', 'icon-chevron-down ease')
css('.dropdown-xbutton', 'm0 p0 label smaller lh1', `padding-top: 2px;`)
css('.dropdown-xbutton::before', 'fa fa-times')
css('.dropdown[align=right] .dropdown-xbutton', '', `order: 2;`)
css('.dropdown[align=right] .dropdown-value'  , 'h-r', `order: 3;`)

css('.dropdown-picker', 'scroll-auto b v p-y-input bg-input z3 arrow', `
	margin-top   : 2px;
	margin-bottom: 2px;
	resize: both;
	max-height: 16em;
`)
css('.dropdown-picker-box', 'gap-y')
css('.dropdown-picker-close-button', 'm0 allcaps no-shrink')
css('.dropdown-list', 'S')
css('.dropdown-list::-webkit-resizer', 'invisible')
css('.dropdown .dropdown-list > *', 'p-input')

// TODO: fix this on Firefox but note that :focus-within is buggy on FF,
// it gets stuck even when focus is on anoher widget, so it's not an easy fix.
css_state('.dropdown:has(:focus-visible) .dropdown-picker', 'outline-focus')

css_state('.dropdown[invalid] .dropdown-inputbox', 'bg-error')

css('.check-dropdown .dropdown-picker', 'p-x')
css('.check-dropdown .dropdown-value', 'gap-x')
css('.check-dropdown-item', 'shrinks clip nowrap')
css('.check-dropdown-item[invalid]', 'bg-error2')

css_state('.check-dropdown .checklist-item.focused', 'bg1 on-theme')

function dropdown_widget(e, is_checklist) {

	e.class('dropdown')
	e.init_child_components()

	e.prop_vals.list = is_checklist
		? e.$1('.checklist') || tag('checklist', 0, ...e.at)
		: e.$1('.list'     ) || tag('list'     , 0, ...e.at)

	e.inputbox = div({class: 'inputbox dropdown-inputbox'})
	e.add(e.inputbox)

	e.make_disablable(e.inputbox)
	e.make_focusable(e.inputbox)

	e.make_input_widget({
		errors_tooltip_target: e.inputbox,
	})

	e.to_text = str // stub
	e.to_form = v => e.format == 'words' ? v.join(' ') : json(v)

	// model: value lookup

	e.prop('value_key', {default: 'value'})

	e.item_value = function(item_e) {
		if (item_e.data != null) { // dynamic list with a data model
			return item_e.data[e.value_key]
		} else { // static list, value kept in a prop or attr.
			return strict_or(item_e[e.value_key], item_e.attr(e.value_key))
		}
	}

	e.prop('known_values', {slot: 'state'}) // {value->list_index}

	function list_items_changed(ev) {
		let kv = map()
		let list = this
		for (let i = 0, n = list.list_len; i < n; i++) {
			let item_e = list.at[i]
			item_e = is_checklist ? item_e.item : item_e
			let value = e.item_value(item_e)
			if (value !== undefined)
				kv.set(value, i)
		}
		e.known_values = kv
	}

	e.lookup = function(v) {
		return e.known_values.get(v)
	}

	// model/view: list prop: set it up as picker.

	function bind_list(list, on) {
		if (!list) return
		if (on) {
			if (is_checklist && !list.hasclass('checklist')) // plain list, make it a checklist.
				list.make_checklist()
			list.make_list_items_focusable({multiselect: false})
			list.make_list_items_searchable()
			list.class('dropdown-list scroll-thin')
			list_items_changed.call(list)
			if (is_checklist) {
				e.close_button = button({
					type: 'button', // no submit
					classes: 'dropdown-picker-close-button',
					text: S('close', 'Close'),
					bare: true,
					focusable: false,
				})
				e.picker = div({class: 'dropdown-picker-box dropdown-picker'}, list, e.close_button)
				e.picker.make_popup(e.inputbox, 'bottom', 'start')
				e.picker.hide()
				e.add(e.picker)
			} else {
				let item_i = e.lookup(e.value)
				list.focus_item(item_i ?? false)
				list.class('dropdown-picker')
				list.make_popup(e.inputbox, 'bottom', 'start')
				list.hide()
				e.picker = list
				e.add(list)
			}
		} else {
			list.del()
			e.known_values = null
		}
		list.on('input'        , list_input, on)
		list.on('items_changed', list_items_changed, on)
		list.on('search'       , list_search, on)
		list.on('pointerdown'  , list_pointerdown, on)
		list.on('click'        , list_click, on)
		list.on('item_checked' , list_item_checked, on)
		e.picker.on('attr_changed', picker_attr_changed, on)
		e.update({value: true})
		e.fire('bind_list', list, on)
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

	e.valuebox  = div({class: 'dropdown-value'})
	e.chevron   = div({class: 'dropdown-chevron'})
	e.xbutton   = button({
		type: 'button', // no submit
		classes: 'dropdown-xbutton',
		bare: true,
		focusable: false,
	})
	e.inputbox.add(e.valuebox, e.xbutton, e.chevron)

	e.prop('align', {type: 'enum', enum_values: 'left right', default: 'left', to_attr: true})
	e.prop('placeholder')

	e.render_item = function(i) {
		let item_e = e.list.at[i]
		item_e = is_checklist ? item_e.item : item_e
		item_e = item_e.clone()
		item_e.id = null // id would be duplicated.
		item_e.selected = null
		item_e.title = item_e.textContent
		e.list.update_item_state(item_e)
		if (is_checklist)
			item_e.class('check-dropdown-item')
		return item_e
	}

	// a checklist can have some invalid values but not all.
	function partially_valid_input_value(remove_invalid) {
		let v = e.input_value
		v = isstr(v)
			? (v.trim().starts('[') ? try_json_arg(v) : v.words())
			: isarray(v) ? v.slice() : v
		if (v) {
			v.sort().uniq_sorted()
			if (remove_invalid)
				for (let i = v.len; i >= 0; i--)
					if (!e.known_values.has(v[i]))
						v.remove(i)
		}
		return v
	}

	e.on_update(function(opt) {

		if (opt.value) {

			if (is_checklist) {

				for (let i = 0, n = list.list_len; i < n; i++) {
					let item_ct = list.at[i]
					item_ct.item.checkbox.checked_state = false
				}
				let items = []

				let v = partially_valid_input_value()
				if (v) {
					for (let s of v) {
						let i = e.lookup(s)
						if (i != null) {
							e.list.at[i].item.checkbox.checked_state = true
							let item_e = e.render_item(i)
							items.push(item_e)
						} else {
							items.push(div({class: 'check-dropdown-item', invalid: ''}, s))
						}
					}
				}
				e.valuebox.set(items)

			} else {

				let i = e.lookup(e.value)
				if (i != null) {
					let item_e = e.render_item(i)
					item_e.id = null // id would be duplicated.
					item_e.selected = null
					e.list.update_item_state(item_e)
					e.valuebox.set(item_e)
				} else {
					e.valuebox.set(e.value != null ? e.to_text(e.value) : e.placeholder)
				}

			}

			e.valuebox.class('null', e.value == null)
			e.xbutton.show(e.value != null && !e.required)
		}
	})

	let w
	e.on_measure(function() {
		w = e.inputbox.rect().w
	})
	e.on_position(function() {
		if (!e.picker)
			return
		e.picker.min_w = w
	})

	// hack to make resizer work...
	function picker_attr_changed(k, v) {
		if (k == 'style' && this.style.height)
			e.picker.style['max-height'] = 'none'
	}

	// open state -------------------------------------------------------------

	e.property('isopen',
		function() {
			return e.hasclass('open')
		},
		function(open) {
			e.set_open(open, true)
		}
	)

	e.set_open = function(open, focus, ev) {
		if (e.isopen != open) {
			let w = e.rect().w
			e.class('open', open)
			if (open) {
				e.picker.update({show: true})
				e.list.focus_item(true, 0, {
					make_visible: true,
					must_not_move: true,
					event: ev,
				})
			} else {
				e.picker.hide(true, ev)
				e.list.search('')
			}
		}
		if (focus)
			e.focus()
	}

	e.open   = function(focus, ev) { e.set_open(true     , focus, ev) }
	e.close  = function(focus, ev) { e.set_open(false    , focus, ev) }
	e.toggle = function(focus, ev) { e.set_open(!e.isopen, focus, ev) }

	// controller -------------------------------------------------------------

	e.user_set = function(v, ev) {
		e.set_prop('input_value', v, ev)
		e.fireup('input', ev)
	}

	e.inputbox.on('pointerdown', function(ev) {
		e.toggle(false, ev)
	})

	e.inputbox.on('blur', function(ev) {
		e.close(false, ev)
	})

	e.on_validate(function(ev) {
		if (!is_checklist) {
			if (e.list && e.list.ispopup && !(ev && ev.target == e.list)) {
				e.list.focus_item(e.lookup(e.value) ?? false, 0, {
					must_not_move: true,
					event: ev,
				})
			}
		}
		e.update({value: true})
	})

	function list_item_checked(item, checked, ev) {
		let v = partially_valid_input_value(true) || []
		let s = e.item_value(item)
		if (checked)
			v.push(s)
		else
			v.remove_value(s)
		if (!v.len) v = null
		e.set_prop('input_value', v, ev)
	}

	function list_input(ev) {
		if (!is_checklist) {
			let v = this.focused_item ? e.item_value(this.focused_item) : null
			e.set_prop('input_value', v, ev)
		}
	}

	function list_search() {
		if (this.search_string)
			e.open()
		if (!is_checklist)
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
		if (!is_checklist)
			e.close(false, ev)
	}

	e.inputbox.on('keydown', function(ev, key, shift, ctrl, alt) {
		let free_key = !(alt || shift || ctrl)
		if (
			(free_key && !is_checklist && key == ' ' && !e.list.search_string)
			|| (alt && (key == 'ArrowDown' || key == 'ArrowUp'))
			|| (free_key && key == 'Enter')
		) {
			e.toggle(true, ev)
			return false
		}
		if (key == 'Escape') {
			e.close(false, ev)
			return false
		}
		if (key == 'Delete') {
			e.user_set(null, ev)
			return false
		}

		if (key == 'Alt') // pressing Alt removes focus on Windows.
			ev.preventDefault()

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
		e.user_set(null, ev)
		return false
	})

}

G.dropdown = component('dropdown', 'Input', function(e) {
	return dropdown_widget(e)
})

G.check_dropdown = component('check-dropdown', 'Input', function(e) {

	e.class('check-dropdown')
	let props = dropdown_widget(e, true)

	e.prop('format', {type: 'enum', enum_values: 'array words', default: 'array'})

	e.is_values = true // enable values validators

	return props
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

BUGS:
	* update_drag_range_end() fires ^input inside update() which is forbidden
	because ^input calls update({validate: true}) which is ignored so the
	errors popup doesn't update itself while dragging on the calendar.

TODO:
	* disabled range coloring.

*/

css(':root', '', `
	--min-w-calendar: 15.5em; /* more than 16em is too wide as a picker */
	--min-h-calendar: 20em;
	--fs-calendar-months   : 1.25;
	--fs-calendar-weekdays : 0.75;
	--fs-calendar-month    : 0.65;
	--p-x-calendar-days-em: .5;
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

	if (mode == 'ranges') {
		e.prop_vals.value = []
		for (let range of e.$('range')) {
			let r = parse_range(range.textContent)
			if (r.len == 2) {
				r.color       = range.attr('color')
				r.focusable   = range.bool_attr('focusable')
				r.readonly    = range.bool_attr('readonly')
				r.disalbed    = range.bool_attr('disabled')
				r.z_index     = range.bool_attr('z-index')
				e.prop_vals.value.push(r)
			}
		}
	}
	e.clear()

	e.class('calendar focusable-items')
	e.make_disablable()
	e.make_focusable()

	// model & state ----------------------------------------------------------

	e.prop('min_range', {type: 'duration', parse: parse_duration, default: 24 * 3600})
	e.prop('max_range', {type: 'duration', parse: parse_duration, default: 1/0})

	function parse_value(s) {
		return day(parse_date(s, 'SQL'))
	}
	function parse_range(s) {
		return assign((isstr(s) ? s.split(/\.\./) : s).map(parse_value), isstr(s) ? null : s)
	}
	function parse_ranges(s) {
		return words(s).map(parse_range)
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
		e.prop('value', {store: false, type: 'time', parse: parse_value})
		e.get_value = () => ranges[0][0]
		e.set_value = function(d) {
			ranges[0][0] = day(d)
			ranges[0][1] = day(d)
		}
	} else if (mode == 'range') {
		e.prop('value1', {store: false, type: 'time', parse: parse_value})
		e.prop('value2', {store: false, type: 'time', parse: parse_value})
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
				parse: parse_ranges})
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
	function ranges_changed(ev) {
		let ranges0 = ranges // TODO: save ranges before modifying so we get correct old value?
		if (mode == 'day') {
			e.prop_changed('value', ranges[0][0], ranges0[0][0])
		} else if (mode == 'range') {
			e.prop_changed('value1', ranges[0][0], ranges0[0][0])
			e.prop_changed('value2', ranges[0][1], ranges0[0][1])
		} else if (mode == 'ranges') {
			e.prop_changed('value', ranges, ranges0)
		}
		if (ev)
			e.fireup('input', ev)
		else
			e.fireup('input')
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
		if (!focus_ranges.len)
			return false
		let step = backwards ? -1 : 1
		let max_i = focus_ranges.len - 1
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
	let cell_w, cell_h
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

	e.on_measure(function() {

		let dpr = devicePixelRatio
		let cr = ct.rect()
		let css = e.css()

		font_weekdays = num(css.fontSize) * dpr * num(css.prop('--fs-calendar-weekdays')) + 'px ' + css.fontFamily
		font_days     = num(css.fontSize) * dpr + 'px ' + css.fontFamily
		font_months   = num(css.fontSize) * dpr * num(css.prop('--fs-calendar-months')) + 'px ' + css.fontFamily
		font_month    = num(css.fontSize) * dpr * num(css.prop('--fs-calendar-month')) + 'px ' + css.fontFamily

		font_month = 'bold ' + font_month

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
		let cell_py = num(css.prop('--p-y-calendar-days-em')) * em
		let cell_px = num(css.prop('--p-x-calendar-days-em')) * em
		cell_py  = num(css.prop('--p-y-calendar-days-em')) * em
		cell_w   = snap(em + 2 * cell_px, 2)
		cell_h   = snap(cell_lh + 2 * cell_py, 2)
		fg       = css.prop('--fg')
		fg_label = css.prop('--fg-label')
		bg_alt   = css.prop('--bg-alt')
		bg_smoke = css.prop('--bg-smoke')
		fg_month = css.prop('--fg-calendar-month')
		border_light = css.prop('--border-light')
		fg_focused_selected   = css.prop('--fg')
		bg_focused_selected   = css.prop('--bg-focused-selected')
		fg_unfocused_selected = css.prop('--fg')
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

	e.on_position(function() {
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
		if (on)
			update_scroll()
	})

	e.listen('layout_changed', update_scroll)

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
		let focus_visible = e.focus_visible

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
							let cr = rh(h / 2 + 1)

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

		if (!pass)
			if (update_drag_range_end())
				ct.redraw_again('update_range_end')

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

		let range_end = down ? drag_range_end : hit_range_end
		ct.style.cursor = range_end ? 'ew-resize'
			: range_end == 0 ? 'move'
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

	let pointerdown_ts = 0

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
		let d0 = d0_0
		let d1 = d1_0
		if (drag_range_end) { // resize
			d1 = hit_day
		} else { // move
			d1 = hit_day + (d1 != null && d0 != null ? d1 - d0 : 0)
			d0 = hit_day
		}
		if (drag_range_end && d0 != null && d1 != null) {
			let min_range = e.min_range - 24 * 3600
			let max_range = e.max_range - 24 * 3600
			if (d1 - d0 < min_range) // constrain a range too small.
				d1 = d0 + min_range
			if (d1 - d0 > max_range) // constrain a range too large.
				d1 = d0 + max_range
		}
		if (d0 == d0_0 && d1 == d1_0)
			return
		r[0] = d0
		r[1] = d1
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
			drag_range = hit_range
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
				ev.picked = true
				e.fireup('input', ev)
				return false
			}

			if (mode == 'ranges' && !was_drag_range) {
				e.focus_range(hit_range)
				return false
			}

			if (mode == 'range' && !was_drag_range && hit_day != null) {
				let min_range = e.min_range - 24 * 3600
				let max_range = e.max_range - 24 * 3600
				if (ev.shift || ev.ctrl) {
					if (anchor_day == null)
						anchor_day = min(e.value1, e.value2)
					let d0 = min(anchor_day, hit_day)
					let d1 = max(anchor_day, hit_day)
					let days = clamp(d1 - d0, min_range, max_range)
					e.value1 = d0
					e.value2 = d0 + days
					e.fireup('input', ev)
				} else if (had_focus) {
					anchor_day = hit_day
					let v1 = e.value1
					let v2 = e.value2
					let days = clamp(v2 != null && v1 != null ? v2 - v1 : 0, min_range, max_range)
					e.value1 = hit_day
					e.value2 = hit_day + days
					e.fireup('input', ev)
				}
				return false
			}
		}

		this.capture_pointer(ev, captured_move, captured_up)
	})

	ct.on('dblclick', function(ev) {
		if (mode == 'ranges' && hit_day && e.can_add_range(hit_day, hit_day)) {
			ranges.push(e.create_range(hit_day, hit_day))
			ranges_changed(ev)
			e.focus_range(ranges.last)
			return false
		}
	})

	e.on('keydown', function(ev, key, shift, ctrl, alt) {

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
				ranges_changed(ev)
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
				e.value = day(e.value ?? time(), ddays)
				e.fireup('input', ev)
				e.scroll_to_view_range(e.value, e.value, 0)
			} else {
				let min_range = e.min_range - 24 * 3600
				let max_range = e.max_range - 24 * 3600
				let d0 = r[0]
				let d1 = r[1]
				let days = d1 - d0
				if (!shift) { // move
					d0 = day(d0, ddays)
					d1 = d0 + days
				} else { // resize
					d1 = day(d1, ddays)
				}
				days = clamp(d1 - d0, min_range, max_range)
				r[0] = d0
				r[1] = d0 + days
				ranges_changed(ev)
				sort_ranges()
				e.scroll_to_view_range(r[0], r[1], 0)
			}
			return false
		}

		if (key == 'Tab') {
			if (e.focus_next_range(shift))
				return false // prevent tabbing out on internal focusing
			e.focus_range(null)
		}

	})

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
html attrs/props:
	value            'HH:mm:ss.ms'
	precision        's': show seconds list

*/

css(':root', '', `
	--h-time-picker: 12em;
`)
css('.time-picker', 'h-c', `
	height: var(--h-time-picker);
`)
css('.time-picker-list-box', 'v')
css('.time-picker-list-header', 'label h-c h-m b-b clip-x-scroll-y', `
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

	e.prop('precision', {type: 'enum', enum_values: 'm s ms', default: 'm'})
	e.property('has_seconds', () => e.precision == 's')

	e.seconds_list.parent.hide()

	e.set_precision = function(p) {
		e.seconds_list.parent.show(e.has_seconds)
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
		parse: s => parse_timeofday(s, false),
	})

	e.set_value = function(v, v0, ev) {
		if (ev && e.contains(ev.target)) // from input
			return
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

	e.on('keydown', function(ev, key, shift, ctrl, alt) {
		let free_key = !(alt || ctrl || shift)
		if (free_key && (key == 'ArrowLeft' || key == 'ArrowRight')) {
			for (let i = 0, n = e.has_seconds ? 3 : 2; i < n; i++) {
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
config attrs/props:
	precision:     's': show seconds list

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

	e.forward_prop('precision', e.time_picker)

	function parse_value(s) {
		return parse_date(s, 'SQL')
	}
	e.prop('value', {type: 'time', parse: parse_value})

	e.set_value = function(v, v0, ev) {
		e.calendar   .set_prop('value', v, ev)
		e.time_picker.set_prop('value', v, ev)
	}

	e.calendar.on('input', function(ev) {
		e.set_prop('value', this.value + e.time_picker.value, ev)
	})

	e.time_picker.on('input', function(ev) {
		e.set_prop('value', (e.calendar.value ?? time()) + this.value, ev)
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

/* <date-input>, <timeofday-input>, <datetime-input> & <date-range-input> ----

This is 4 widgets crammed into one, that's why this code is full of ifs.
The range widget is the most different with its 2-level validation. Still,
there's enough common functionality in all variants that it makes more sense
to have one constructor instead of four. It's also simpler than extracting
the common bits into a mixin (less wiring, less naming, less code-chasing).

config:
	format=sql               format form data as SQL text instead of timestamp
date-input, timeofday-input, datetime-input state:
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
css('.date-input-picker', 'b v', `
	margin-top   : 2px;
	margin-bottom: 2px;
`)
css('.date-only-input .calendar', 'S b bg-input clip', `resize: vertical;`) // NOTE: resize needs clip!
css('.date-range-input .date-input-picker-box', 'clip', `resize: vertical;`) // NOTE: resize needs clip!
css('.date-range-input .calendar', 'S')
css('.date-input-close-button', 'allcaps')
css('.date-input.open :is(.date-input-group, .date-input-picker)', 'shadow-picker')

// NOTE: trying to be compliant with mySQL DATETIME range.
// NOTE: you only get 6-digit of fractional precision for years >= 1900
// when making computations with timestamps, so we're not really fully
// mySQL compliant.
let min_date = parse_date('1000-01-01 00:00:00', 'SQL')
let max_date = parse_date('9999-12-31 23:59:59', 'SQL')

function date_input_widget(e, has_date, has_time, range) {

	let type = has_date ? 'time' : 'timeofday'

	e.clear()

	e.class('date-input')
	if (!range) {
		e.class('date-only-input', !has_time)
		e.class('time-only-input', !has_date)
		e.class('datetime-input', has_date && has_time)
	}

	e.input_group = div({class: 'date-input-group input-group b-collapse-h ro-collapse-h'})
	e.add(e.input_group)

	e.make_disablable(e.input_group)

	e.prop('format', {type: 'enum', enum_values: 'sql time', default: 'time', parse: lower})

	let to_text, to_form
	if (has_date) {
		to_text = t => t.date(null, e.precision)
		to_form = t => e.format == 'sql' ? t.date('SQL', e.precision) : t
	} else {
		to_text = t => t.timeofday(e.precision)
		to_form = t => e.format == 'sql' ? t.timeofday(e.precision) : t
	}

	if (range) {
		assert(has_date && !has_time, 'NYI')
		e.is_range = true
		e.range_type = 'date'
		e.picker = range_calendar()
		e.calendar = e.picker
	} else {
		if (has_date) {
			if (has_time) {
				e.picker = datetime_picker()
				e.calendar = e.picker.calendar
			} else {
				e.picker = calendar()
				e.calendar = e.picker
			}
			e.is_time = true
		} else {
			e.picker = time_picker()
			e.is_timeofday = true
		}
		e.to_text = to_text
		e.to_form = to_form
	}

	function to_json(t) {
		if (this.name && !this.validator.failed)
			t[this.name] = this.to_form(this.value)
	}

	if (range || e.picker != e.calendar) {
		e.close_button = button({
			type: 'button', // no submit
			classes: 'date-input-close-button',
			focusable: false,
			bare: true,
		}, S('close', 'Close'))
		e.close_button.action = function(ev) {
			e.close(false, ev)
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

	if (has_time)
		e.forward_prop('precision', e.picker)
	else
		e.precision = 'd'

	let to_input, from_input, from_html
	if (has_date) {
		to_input = t => t.date(null, e.precision)
		from_input = s => parse_date(s, null, false, e.precision)
		from_html = s => parse_date(s, 'SQL', true, has_time ? null : 'd')
	} else {
		to_input = t => t.timeofday(e.precision)
		from_input = s => parse_timeofday(s, false, e.precision)
		from_html = s => parse_timeofday(s, true)
	}

	e.inputs = []
	e.input_widgets = []

	if (!range) {
		e.make_input_widget({
			errors_tooltip_target: e.input_group,
		})
		e.to_json = to_json
		e.prop('min', {type: type, parse: from_html, default: has_date ? min_date : null})
		e.prop('max', {type: type, parse: from_html, default: has_date ? max_date : null})
	}

	for (let K of range ? ['1', '2'] : ['']) {

		let input = tag('input', {
			class: 'date-input-input date-input-input-value'+K,
			placeholder: date_placeholder_text(),
		})

		let input_widget

		if (range) {

			// NOTE: only making these "input widgets" for validation purposes.
			input_widget = div()
			input_widget.K = K
			e.input_widgets.push(input_widget)

			input_widget.is_scalar = true
			input_widget.is_time = true
			input_widget.to_text = to_text
			input_widget.to_form = to_form
			input_widget.to_json = to_json

			input_widget.make_input_widget({
				errors_tooltip_target: false,
			})

			input_widget.prop('min', {type: type, parse: from_html, default: has_date ? min_date : null})
			input_widget.prop('max', {type: type, parse: from_html, default: has_date ? max_date : null})

			e.forward_prop('min', input_widget, 'min')
			e.forward_prop('max', input_widget, 'max')

			input_widget.hide()
			e.add(input_widget)

		} else {

			input_widget = e

		}

		input_widget.on_validate(function(ev) {

			let v = this.value

			if (!(ev && ev.target == e.picker)) {
				e.picker.set_prop('value'+K, v, ev)
			}

			if (!(ev && ev.target == input && ev.type == 'input')) {
				input.value = v != null ? to_input(v) : this.input_value
			}

		})

		input.on('input', function(ev) {
			let iv = repl(input.value, '', null)
			let v = from_input(iv)
			e.set_prop('input_value'+K, v ?? iv, ev)
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
			e.set_prop('input_value'+K, d, ev || {target: e})
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

		input.on('keydown', function(ev, key, shift, ctrl, alt) {

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
						e.set_prop('input_value'+K, t, ev)
						g = digit_groups()[g.index] // re-locate digit group
						if (g)
							input.setSelectionRange(g.i, g.j)
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

		e.forward_prop('placeholder'+K, input, 'placeholder')

	}

	if (range) {

		e.make_range_input_widget({
			errors_tooltip_target: e.input_group,
		})

		e.forward_prop('min_range', e.calendar)
		e.forward_prop('max_range', e.calendar)

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
		type: 'button', // no submit
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
	e.set_open = function(open, focus, ev) {
		e.class('open', open)
		if (open) {
			e.picker_box.make_popup(e.input_group, 'bottom', 'start')
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

	e.open   = function(focus, ev) { e.set_open(true     , focus, ev) }
	e.close  = function(focus, ev) { e.set_open(false    , focus, ev) }
	e.toggle = function(focus, ev) { e.set_open(!e.isopen, focus, ev) }

	e.picker_box.on('focusout', function(ev) {
		if (ev.relatedTarget && e.picker_box.contains(ev.relatedTarget))
			return
		e.close(false, ev)
	})

	e.picker_button.on('pointerdown', function(ev) {
		e.toggle(false, ev)
		return false
	})

	if (!e.close_button && e.calendar) // auto-close on pick with delay
		e.calendar.on('input', function(ev) {
			if (!ev.picked)
				return
			// delay it so the user can glance the choice.
			runafter(.1, function() {
				e.close(false, ev)
			})
		})

	e.picker_box.on('keydown', function(ev, key, shift, ctrl, alt) {
		let free_key = !(alt || shift || ctrl)
		if (free_key && key == 'Escape') {
			e.close(true, ev)
			return false
		}
	})

	e.on('keydown', function(ev, key, shift, ctrl, alt) {
		let free_key = !(alt || shift || ctrl)
		if (
			(alt && (key == 'ArrowDown' || key == 'ArrowUp'))
			|| (free_key && key == 'Enter')
		) {
			e.toggle(true, ev)
			return false
		}
	})

}

G.date_input = component('date-input', 'Input', function(e) {
	return date_input_widget(e, true)
})

G.timeofday_input = component('timeofday-input', 'Input', function(e) {
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

css('.richtext-content', 'clip-x-auto-y no-outline p')

G.richtext = component('richtext', function(e) {

	e.class('richtext')
	e.make_disablable()

	e.prop_vals.content = [...e.nodes]
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
		e.actionbar.make_popup(e, 'top', 'left')
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

	e.content_box.on('keydown', function(ev, key) {
		if (key === 'Enter')
			if (document.queryCommandValue('formatBlock') == 'blockquote')
				runafter(0, function() { exec('formatBlock', '<p>') })
			else if (document.queryCommandValue('formatBlock') == 'pre')
				runafter(0, function() { exec('formatBlock', '<br>') })
		ev.stopPropagation()
	})

	e.content_box.on('keypress', function(ev) {
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

	e.prop_vals.val = e.nodes.len ? [...e.nodes] : null
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

})

}()) // module function
