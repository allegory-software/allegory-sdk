/*

	widgets: Web Components in JavaScript.
	Written by Cosmin Apreutesei. Public Domain.

You must load first, in order:

	glue.js
	dom.js
	css.js

WIDGETS

	tooltip
	toaster
	list
	menu
	tabs
	split vsplit
	action-band
	dlg
	toolbox
	slides
	md
	pagenav
	richtext
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
	tags-box tags
	autocomplete
	TODO: dropdown
	widget-placeholder

FUNCTIONS

	notify(text, ['search'|'info'|'error'], [timeout])

WRITING CSS RULES

	CSS REUSE

		Use var() for anything that is used in two places and is not a coincidence.
		Use utils classes over specific styles when you can.

	CSS STATES

		State classes are set only on the outermost element of a widget except
		`:focus-visible` which is set only to the innermost element (which has tabindex).
		Use `.outer.state .inner` to style `.inner` on `.state`.
		Use `.outer .inner:has(:focus-visible)` to style `.outer` on `:focus-visible`.

	CSS DESCENDANT COMBINATOR

		For container widgets like tabs and split you have to use the ">" combinator
		instead of " " at least until you reach a header or something, otherwise
		you will accidentally select child widgets of the same type as the container.

*/

css(':root', '', `

	--border-radius-input : 0;
	--width-input                 : 12em;

`)

css_light('', '', `

	--border-focused                : #99d; /* dropdown open */
	--outline-markbox-focused       : #88888866;

	--shadow-popup-picker           :  0px  5px 10px  1px #00000044; /* large fuzzy shadow */

	--bg-moving       : #eeeeeeaa;
	--bg-tooltip      : #ffffcc; /* bg for cursor-kind tooltips */
	--bg-today        : #f33;
	--fg-today        : white;
	--fg-clickable    : #207fdf; /* markbox icon, slider */

	--bg-toolbox-titlebar         : var(--bg1);
	--bg-toolbox-titlebar-focused : #00003333;

	--stroke-dialog-xbutton       : #00000066;

	--selected-widget-outline-color         : #666;
	--selected-widget-outline-color-focused : blue;

`)

css_dark('', '', `

	--border-focused                :  #66a;
	--outline-markbox-focused       :  #88888866;

	--bg-moving            : #141a24aa;
	--fg-clickable         : #75b7fa;

	--bg-toolbox-titlebar         : #303030;
	--bg-toolbox-titlebar-focused : #636363;

	--stroke-dialog-xbutton       : #000000cc;

	--selected-widget-outline-color         : #aaa;
	--selected-widget-outline-color-focused : var(--fg-clickable);

`)

css('.widget', 'rel h')

css('.x-container', 'grid-h shrinks clip') /* grid because grid-in-flex is buggy */

// container with `display: contents`. useful to group together
// an invisible widget like a nav with a visible one.
// Don't try to group together visible elements with this! CSS will see
// your <x-ct> tag in the middle, but the layout system won't!
css('.x-ct', 'skip')

/* .focusable-items ----------------------------------------------------------

	these are widgets containing multiple focusable and selectable items,
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

css_state('.focusable-items:focus', 'no-outline')

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

function widget(tag, category, init) {
	if (!isstr(category)) { // shift arg
		init = category
		category = null
	}
	let init0 = init
	init = function(e) {
		e.class(tag)
		return init0(e)
	}
	function comp_init(e) {
		e.iswidget = true // to diff from normal html elements.
		e.class('widget')
		e.make_disablable()
		return init(e)
	}
	let create = component(tag, category, comp_init)
	create.construct = init
	let name = tag.replaceAll('-', '_')
	window[name] = create
	return create
}

/* widget editing & selecting --------------------------------------------- */

css_role('.widget.widget-editing', '', `
	outline: 2px dotted red;
	outline-offset: -2px;
`)

css_role('.widget [contenteditable]', 'no-outline')

css_role('.widget.widget-selected', 'click-through')

css_role('.widget-selected-overlay', 'overlay click-through-off', `
	display: block;
	background-color: var(--bg-smoke);
	outline: 2px dotted var(--selected-widget-outline-color);
	outline-offset: -2px;
	z-index: 10; /* arbitrary */
`)

css_role_state('.widget-selected-overlay:focus', '', `
	outline-color: var(--selected-widget-outline-color-focused);
`)

css('.widget-placeholder', 'grid-h', `
	justify-content: safe center;
	align-content: center;
	outline: 1px dashed var(--fg-dim);
	outline-offset: -1px;
`)

css('.widget-placeholder-button', 'ro0 small', `
	margin: 1px;
	padding: .1em;
	min-width: 2em;
`)

/* ---------------------------------------------------------------------------
// undo stack, selected widgets, editing widget and clipboard.
// ---------------------------------------------------------------------------
publishes:
	undo_stack, redo_stack
	editing_widget
	selected_widgets
	copied_widgets
	unselect_all_widgets()
	copy_selected_widgets()
	cut_selected_widgets()
	paste_copied_widgets()
	undo()
	redo()
	push_undo(f)
behavior:
	uncaptured clicks and escape unselect all widgets.
	ctrl+x/+c/+v/(+shift)+z/+y do the usual thing with selected widgets.
--------------------------------------------------------------------------- */

undo_stack = []
redo_stack = []

function push_undo(f) {
	undo_stack.push(f)
}

function undo() {
	let f = undo_stack.pop()
	if (!f)
		return
	redo_stack.push(f)
	f()
}

function redo() {
	;[undo_stack, redo_stack] = [redo_stack, undo_stack]
	undo()
	;[undo_stack, redo_stack] = [redo_stack, undo_stack]
}

editing_widget = null
selected_widgets = new Set()

function unselect_all_widgets() {
	if (editing_widget)
		editing_widget.widget_editing = false
	for (let e of selected_widgets)
		e.widget_selected = false
}

copied_widgets = new Set()

function copy_selected_widgets() {
	copied_widgets = new Set(selected_widgets)
}

function cut_selected_widgets() {
	copy_selected_widgets()
	for (let e of selected_widgets)
		e.remove_widget()
}

function paste_copied_widgets() {
	if (!copied_widgets.size)
		return
	if (editing_widget) {
		editing_widget.add_widgets(copied_widgets)
		copied_widgets.clear()
	} else {
		for (let e of selected_widgets) {
			let ce = copied_widgets.values().next().value
			if (!ce)
				break
			let pe = e.parent_widget
			if (pe)
				pe.replace_child_widget(e, ce)
			copied_widgets.delete(ce)
		}
	}
}

document.on('keydown', function(key, shift, ctrl) {
	if (key == 'Escape')
		unselect_all_widgets()
	else if (ctrl && key == 'c')
		copy_selected_widgets()
	else if (ctrl && key == 'x')
		cut_selected_widgets()
	else if (ctrl && key == 'v')
		paste_copied_widgets()
	else if (ctrl && key == 'z')
		if (shift)
			redo()
		else
			undo()
	else if (ctrl && key == 'y')
		redo()
})

document.on('pointerdown', function() {
	unselect_all_widgets()
})

/* selectable widget mixin ---------------------------------------------------

uses:
	e.can_select_widget
publishes:
	e.parent_widget
	e.selectable_parent_widget
	e.widget_selected
	e.set_widget_selected()
	e.remove_widget()
calls:
	e.do_select_widget()
	e.do_unselect_widget()
calls from the first parent which has e.child_widgets:
	p.can_select_widget
	p.remove_child_widget()
behavior:
	enters widget editing mode and/or selects widget with ctrl(+shift)+click.

*/

function parent_widget_which(e, which) {
	assert(e != window)
	e = e.parent
	while (e) {
		if (e.iswidget && which(e))
			return e
		e = e.parent
	}
}

function up_widget_which(e, which) {
	return which(e) ? e : parent_widget_which(e, which)
}

function selectable_widget(e) {

	e.property('parent_widget', function() {
		return parent_widget_which(this, p => p.child_widgets)
	})

	e.property('selectable_parent_widget', function() {
		return parent_widget_which(e, p => p.child_widgets && p.can_select_widget)
	})

	e.can_select_widget = true

	e.set_widget_selected = function(select, focus, fire_changed_event) {
		select = select !== false
		if (e.widget_selected == select)
			return
		if (select) {
			selected_widgets.add(e)
			e.do_select_widget(focus)
		} else {
			selected_widgets.delete(e)
			e.do_unselect_widget(focus)
		}
		e.class('widget-selected', select)
		if (fire_changed_event !== false)
			document.fire('selected_widgets_changed')
	}

	e.property('widget_selected',
		() => selected_widgets.has(e),
		function(v, ...args) { e.set_widget_selected(v, ...args) })

	e.do_select_widget = function(focus) {

		// make widget unfocusable: the overlay will be focusable instead.
		e.focusable = false

		let overlay = div({class: 'widget-selected-overlay', tabindex: 0})
		e.widget_selected_overlay = overlay
		e.add(overlay)

		overlay.on('keydown', function(key) {
			if (key == 'Delete') {
				e.remove_widget()
				return false
			}
		})

		overlay.on('pointerdown', function(ev) {
			if (ev.ctrlKey && ev.shiftKey) {
				if (!overlay.focused)
					overlay.focus()
				if (selected_widgets.size == 1) {
					unselect_all_widgets()
					let p = e.selectable_parent_widget
					if (p)
						p.widget_selected = true
				} else
					e.widget_selected = !e.widget_selected
				return false
			} else
				unselect_all_widgets()
		})

		if (focus !== false)
			overlay.focus()
	}

	e.do_unselect_widget = function(focus_prev) {

		e.focusable = true

		e.widget_selected_overlay.remove()
		e.widget_selected_overlay = null

		if (focus_prev !== false && selected_widgets.size)
			[...selected_widgets].last.widget_selected_overlay.focus()
	}

	e.remove_widget = function() {
		let p = e.parent_widget
		if (!p) return
		e.widget_selected = false
		p.remove_child_widget(e)
	}

	e.hit_test_widget_editing = return_true

	e.on('pointerdown', function(ev, mx, my) {

		if (!e.can_select_widget)
			return

		if (e.widget_selected)
			return false // prevent dropdown from opening.

		if (!ev.ctrlKey)
			return

		if (e.ctrl_key_taken)
			return

		if (ev.shiftKey) {

			// prevent accidentally clicking on the parent of any of the selected widgets.
			for (let e1 of selected_widgets) {
				let p = e1.selectable_parent_widget
				while (p) {
					if (p == e)
						return false
					p = p.selectable_parent_widget
				}
			}

			e.widget_editing = false
			e.widget_selected = true

		} else {

			unselect_all_widgets()

			if (e.can_edit_widget && !selected_widgets.size)
				if (e.hit_test_widget_editing(ev, mx, my)) {
					e.widget_editing = true
					// don't prevent default to let the caret land under the mouse.
					ev.stopPropagation()
					return
				}

		}

		return false

	})

	e.on_bind(function(on) {
		if (!on)
			e.widget_selected = false
	})

}

/* editable widget mixin -----------------------------------------------------

uses:
	e.can_edit_widget
publishes:
	e.widget_editing
calls:
	e.set_widget_editing()

*/

function editable_widget(e) {

	e.can_edit_widget = true
	e.set_widget_editing = noop

	e.property('widget_editing',
		() => editing_widget == e,
		function(v) {
			v = !!v
			if (e.widget_editing == v)
				return
			e.class('widget-editing', v)
			if (v) {
				assert(editing_widget != e)
				if (editing_widget)
					editing_widget.widget_editing = false
				assert(editing_widget == null)
				e.focusable = false
				editing_widget = e
			} else {
				e.focusable = true
				editing_widget = null
			}
			getSelection().removeAllRanges()
			e.set_widget_editing(v)
		})

	e.on_bind(function(on) {
		if (!on)
			e.widget_editing = false
	})

}

function contained_widget(e) {
	//
}

/* stylable widget -----------------------------------------------------------

publishes:
	e.css_classes

*/

function stylable_widget(e) {

	e.set_css_classes = function(c1, c0) {
		if (c0)
			e.class(c0, false)
		if (c1)
			e.class(c1, true)
	}
	e.prop('css_classes', {})

	e.prop('theme', {attr: true})
}

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
css('.tooltip', 'z2 h-l h-t noclip noselect op0 click-through ease-out ease-fw ease-02s', `
	transition-property: opacity, transform;
	max-width: 400px;  /* max. width of the message bubble before wrapping */
`)

css('.tooltip-body', 'h-bl p-y tight ro bg1', `
	box-shadow: var(--shadow-tooltip);
`)

// visibility animation

css('.tooltip.visible', 'op1 click-through-off')

// TODO: these don't work, figure out why!
css('.tooltip.visible[side=left  ]', '', ` animation-name: tooltip-left;   `)
css('.tooltip.visible[side=right ]', '', ` animation-name: tooltip-right;  `)
css('.tooltip.visible[side=top   ]', '', ` animation-name: tooltip-top;    `)
css('.tooltip.visible[side=bottom]', '', ` animation-name: tooltip-bottom; `)

css(`
@keyframes tooltip-left   { from { opacity: 0; transform: translate(-1em, 0);  } }
@keyframes tooltip-right  { from { opacity: 0; transform: translate( 1em, 0);  } }
@keyframes tooltip-top    { from { opacity: 0; transform: translate(0, -.5em); } }
@keyframes tooltip-bottom { from { opacity: 0; transform: translate(0,  .5em); } }
`)

css('.tooltip-content', 'p-x-2', `
	display: inline-block; /* shrink-wrap and also word-wrap when reaching container width */
`)

css('.tooltip-xbutton', 't-t small dim p-y-05 p-x-2 b0 b-l', `
	align-self: stretch;
	pointer-events: all;
`)

css_state('.tooltip-xbutton:not([disabled]):not(.active):hover', '', `
	color: inherit;
`)

css('.tooltip-tip', 'z1', `
	display: block;
	border: .5em solid transparent; /* border-based triangle shape */
	color: var(--bg1);
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

css('.tooltip[kind=search] > .tooltip-body', '', ` background-color: var(--bg-search); color: #000; `)
css('.tooltip[kind=search] > .tooltip-tip ', '', ` color: var(--bg-search); `)

css('.tooltip[kind=info  ] > .tooltip-body', '', ` background-color: var(--bg-info); color: var(--fg-info); `)
css('.tooltip[kind=info  ] > .tooltip-tip ', '', ` color: var(--bg-info); `)
css('.tooltip[kind=info  ] > .tooltip-body > .tooltip-xbutton', '', `color: var(--fg-dim-on-dark); border-color: var(--border-light-on-dark); `)

css('.tooltip[kind=error ] > .tooltip-body', '', ` background-color: var(--bg-error); color: var(--fg-error); `)
css('.tooltip[kind=error ] > .tooltip-tip ', '', ` color: var(--bg-error); `)
css('.tooltip[kind=error ] > .tooltip-body > .tooltip-xbutton', '', ` color: var(--fg-dim-on-dark); border-color: var(--border-light-on-dark); `)

css('.tooltip[kind=warn  ] > .tooltip-body', '', ` background-color: var(--bg-warn); color: var(--fg-warn); `)
css('.tooltip[kind=warn  ] > .tooltip-tip ', '', ` color: var(--bg-warn); `)
css('.tooltip[kind=warn  ] > .tooltip-body > .tooltip-xbutton', '', ` color: var(--fg-dim-on-dark); border-color: var(--border-light-on-dark); `)

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

widget('tooltip', function(e) {

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
		e.class('visible', !e.hidden)
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
		let first_focusable = this.focusables()[0]
		if (!first_focusable)
			return
		first_focusable.focus()

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

widget('toaster', function(e) {

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
function notify(...args) {
	if (!notify_toaster) {
		notify_toaster = toaster()
		document.body.add(notify_toaster)
	}
	let tt = notify_toaster.post(...args)
	console.log('NOTIFY', iselem(args[0]) ? args[0].textContent : args[0])
	return tt
}
ajax.notify_error  = (err) => notify(err, 'error')
ajax.notify_notify = (msg, kind) => notify(msg, kind || 'info')

/* <list> --------------------------------------------------------------------

inner html:
	<template>          inline template
	<script>            inline script to compute and return the items array
html attrs:
	item_template       template name for formatting an item
config props:
	item_template       template text for formatting an item
	item_template_name  template name for formatting an item
data props:
	items               array of items

NOTE: does not support element margins!

*/

let e = Element.prototype

e.make_list = function() {

	let e = this

	// drag & drop elements: acting as a drag source --------------------------

	function save_item(item_e) {
		item_e._x0 = item_e.style.left
		item_e._y0 = item_e.style.top
		item_e._w0 = item_e.style.width
		item_e._h0 = item_e.style.height
	}

	function restore_item(item_e) {
		item_e.class('list-item-dragging', false)
		item_e.x = item_e._x0
		item_e.y = item_e._y0
		item_e.w = item_e._w0
		item_e.h = item_e._h0
	}

	let item_e, item_i

	e.on('start_drag', function(ev, start, mx, my, down_ev, mx0, my0) {

		if ((my - my0)**2 + (mx - mx0)**2 < 5**2)
			return

		item_e = down_ev.target.closest_child(e)
		if (!item_e) return

		// DOM measuring
		item_i = item_e.index
		let item_r = item_e.rect()
		let css = item_e.css()
		save_item(item_e)

		e.class('list-items-moving')
		item_e.class('list-item-dragging')

		// fixate size so we can move it out of layout.
		item_e.w = item_r.w
		item_e.h = item_r.h

		root.add(item_e) // ...so it doesn't get clipped.

		start(item_e, item_r)

		force_cursor('grabbing')
	})

	e.on('dragging', function(ev, item_e, item_r) {
		item_e.x = item_r.x
		item_e.y = item_r.y
	})

	e.on('stop_drag', function(ev, dest_elem, item_e) {
		force_cursor(false)
		e.class('list-items-moving', false)
		restore_item(item_e)
		if (!dest_elem)
			e.insert(item_i, item_e)
	})

	// drag & drop elements: acting as a drop destination ---------------------

	let gap_y, placeholder_w
	let ys // y's of host elements in offset space.
	let mys // mid-points in host elements in viewport space.
	let placeholder
	let hit_i, hit_y

	function hit_test(elem_y) {
		let n = e.len - (placeholder ? 1 : 0)
		for (let i = 0; i < n; i++) {
			if (elem_y < mys[i]) {
				hit_i = i
				hit_y = ys[i]
				return
			}
		}
		hit_i = n
	}

	e.listen('drag_started', function(drop_item_e, add_drop_area, source_e) {

		if (e != source_e)
			e.class('list-items-moving')

		// measure elements for hit-testing.
		let e_css = e.css()
		gap_y = num(e_css.rowGap) || 0
		placeholder_w = e.cw - (num(e_css.paddingLeft) || 0) - (num(e_css.paddingRight) || 0)
		ys = []
		mys = []
		let item_e, item_r
		for (item_e of e.at) {
			item_r = item_e.rect()
			ys.push(item_e.oy)
			mys.push(item_e.oy + item_e.oh / 2)
		}
		if (item_e)
			ys.push(item_e.oy + item_e.oh + gap_y)
		else
			ys.push(0)

		add_drop_area(e, e.rect())
	})

	e.listen('drag_stopped', function(item_e, source_e) {

		if (e != source_e)
			e.class('list-items-moving', false)

		for (let ce of e.at)
			ce.y = null

		ys = null
		mys = null

		if (placeholder) {
			placeholder.remove()
			placeholder = null
		}

	})

	e.on('dropping', function(ev, accepted, item_e, item_r) {
		if (accepted) {
			hit_test(item_r.y - e.rect().y - e.cy + e.sy)
		}
		if (accepted) {
			if (!placeholder) {
				placeholder = div({class: 'list-drop-placeholder'})
				e.add(placeholder)
			}
			placeholder.y = ys[hit_i]
			placeholder.min_w = placeholder_w
			placeholder.min_h = item_r.h
			placeholder.show()
			placeholder.make_visible()
		} else if (placeholder) {
			placeholder.hide()
		}
		let n = e.len - (placeholder ? 1 : 0)
		for (let i = 0; i < n; i++) {
			let item_e = e.at[i]
			item_e.y = accepted ? (i < hit_i ? 0 : gap_y + item_r.h) : 0
		}
	})

	e.on('drop', function(ev, item_e, source_e) {
		e.insert(hit_i, item_e)
	})

}

css('.list', 'v-t scroll-auto rel')

css_state('.list-items-moving > *', 'rel ease z2')
css_state('.list-item-dragging', 'abs m0 z3')
css_state('.list-drop-placeholder', 'abs b2 b-dashed no-ease z1', ` border-color: green; `)

// NOTE: margins on list elements are not supported because of drag & drop!
// Use padding and gap on the list instead, that works.
css_role('.list > *', 'm0')

widget('list', function(e) {

	e.init_child_components()

	let t = e.$1(':scope>template')
	let html_template = t && t.html

	let s = e.$1(':scope>script')
	let html_items = s && s.run(e)

	e.clear()

	e.prop('item_template_name', {type: 'template_name', attr: 'item_template'})
	e.prop('item_template'     , {type: 'template'})
	e.prop('items'             , {type: 'array'})

	e.on_update(function(opt) {
		let ts = template(e.item_template_name) || e.item_template
		if (!ts) return
		e.clear()
		for (let item of e.items) {
			let ce = unsafe_html(render_string(ts, item))
			e.add(ce)
		}
	})

	e.make_list()

	return {item_template: html_template, items: html_items}

})

/* <menu> --------------------------------------------------------------------



*/

// z4: menu = 4, picker = 3, tooltip = 2, toolbox = 1
// noclip: submenus are outside clipping area
// fg: prevent inheritance by the .focused rule below.
css('.menu', 'm0 p0 b arial smaller abs z4 noclip bg1 shadow-menu noselect', `
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

css_state('.menu-tr.focused > :not(.menu-table)', '', `
	background : var(--bg-unfocused-selected);
	color      : var(--fg-unfocused-selected);
`)

css_state('.menu:focus-within .menu-tr.focused > :not(.menu-table)', '', `
	background : var(--bg-focused-selected);
`)

css('.menu-check-div', 'p-x')
css('.menu-check-div::before', 'icon-check') // fa fa-check

css('.menu-sub-div', 'p-x')
css('.menu-sub-div::before', 'icon-chevron-right') // fa fa-angle-right

widget('menu', function(e) {

	e.make_focusable()
	e.class('focusable-items')
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
		table.classes = 'widget menu'+(is_submenu ? ' menu-submenu' : '')
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

/* "widget containing a list of items that are widgets" mixin ----------------

publishes:
  e.items
implements:
  e.child_widgets()
  e.replace_child_widget()
  e.remove_child_widget()
calls:
  e.update({new_items:, removed_items:, items:})

*/

widget_items_widget = function(e) {

	function same_set(s1, s2) {
		if (s1.size != s2.size)
			return false
		let it1 = s1.values()
		let it2 = s2.values()
		for(let i = 0, n = s1.size; i < n; i++) {
			let v1 = it1.next().value
			let v2 = it2.next().value
			if (v1 != v2)
				return false
		}
		return true
	}

	function diff_items(t, cur_items) {

		t = isstr(t) ? t.words() : t

		if (isarray(t))
			t = set(t)

		if (same_set(t, cur_items))
			return cur_items

		// diff between t and cur_items keyed on item's object identity or its id.

		// map current items by identity and by id.
		let cur_set = set()
		let cur_by_id = map()
		for (let item of cur_items) {
			cur_set.add(item)
			if (item.id)
				cur_by_id.set(item.id, item)
		}

		// create new items or reuse-by-id.
		let items = set()
		for (let v of t) {
			// v is either an item from cur_items or the prop_vals of a new item.
			let cur_item = cur_set.has(v) ? v : cur_by_id.get(v.id)
			let item = cur_item || element(v)
			items.add(item)
		}

		e.update({items: items})

		return items
	}

	e.serialize_items = function(items) {
		let t = []
		for (let item of items)
			t.push(item.serialize())
		return t
	}

	e.prop('items', {type: 'nodes', serialize: e.serialize_items, convert: diff_items, default: empty_set})

	// parent-of selectable widget protocol.
	e.child_widgets = function() {
		return e.items.slice()
	}

	// parent-of selectable widget protocol.
	e.replace_child_widget = function(old_item, new_item) {
		let i = e.items.indexOf(old_item)
		let items = e.items.copy()
		items[i] = new_item
		e.items = items
	}

	// parent-of selectable widget protocol.
	e.remove_child_widget = function(item) {
		let items = e.items.copy()
		items.remove_value(item)
		e.items = items
	}

	if (e.len) {
		e.init_child_components()
		let html_items = [...e.children]
		e.clear()
		return html_items
	}

}

/* <tabs> --------------------------------------------------------------------


*/

css('.tabs', 'S v shrinks')

css('tabs-header', 'h rel bg1')

css('tabs-box', 'S h rel')

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

css('tabs-content', 'scroll-auto', `
	min-height: 0;  /* don't let the content make the tabs itself overflow */
	flex: 1 0 0;    /* stretch to fill container but not more */
`)

css('tabs-tab', 'rel label arrow h', `
	line-height: 1.25;
`)

css('tabs-title', 'noselect nowrap', `
	padding: .5em .8em .3em .8em;
	max-width: 10em;
`)

css('tabs-add-button', 'p-y-05 p-x-2 h-m')
css('tabs-add-button::before', 'small fa fa-plus')

css('tabs-xbutton', 'abs dim arrow small', `
	top: 2px;
	right: 2px;
`)
css('tabs-xbutton::before', 'fa fa-times')

// z2: selection-bar = 2, moving-tab = 1
css('tabs-selection-bar', 'abs bg-link z2', `
	width: 2px;
	height: 2px;
`)

css_state('tabs-xbutton:hover', '', `
	color: inherit;
`)

css_state('.tabs:not(.moving) > tabs-header tabs-selection-bar', '', `
	transition: width .15s, height .15s, left .15s, top .15s;
`)

// z1: selection-bar = 2, moving-tab = 1
css_state('tabs-tab.moving', 'z1', `
	opacity: .7;
`)

css_state('.tabs.moving > tabs-header tabs-tab:not(.moving)', '', `
	transition: left .1s, top .1s;
`)

css_state('tabs-tab.selected', '', `
	color: inherit;
`)

css_state('tabs-tab:focus', 'no-outline')

css_state('tabs-tab:is(:hover, :focus)', 'bg1')

widget('tabs', 'Containers', function(e) {

	selectable_widget(e)
	editable_widget(e)
	contained_widget(e)

	let html_items = widget_items_widget(e)

	e.fixed_header = html_items.find(e => e.tag == 'tabs-fixed-header')
	if (e.fixed_header)
		html_items.remove_value(e.fixed_header)

	e.prop('tabs_side', {type: 'enum',
			enum_values: 'top bottom left right', default: 'top', attr: true})

	// TODO:
	e.prop('can_rename_items', {type: 'bool', default: false})
	e.prop('can_add_items'   , {type: 'bool', default: false})
	e.prop('can_remove_items', {type: 'bool', default: false})
	e.prop('can_move_items'  , {type: 'bool', default: true})

	e.prop('auto_focus_first_item', {type: 'bool', default: true})

	e.prop('header_width', {type: 'number'})

	e.prop('tabs', {})

	e.set_tabs = function(item_ids) {
		//
		for (let item_id of words(item_ids)) {

		}
	}

	// view -------------------------------------------------------------------

	function item_label_changed() {
		e.update({title_of: this})
	}

	function update_tab_title(tab) {
		let label = item_label(tab.item)
		tab.title_box.set(TC(label))
		tab.title_box.title = tab.title_box.textContent
	}

	function update_tab_state(tab, select) {
		tab.xbutton.hidden = !(select && (e.can_remove_items || e.widget_editing))
		tab.title_box.contenteditable = select && (e.widget_editing || e.renaming)
	}

	let selected_tab = null

	e.on_update(function(opt) {

		if (!e.selection_bar) {
			e.selection_bar = tag('tabs-selection-bar')
			e.add_button = tag('tabs-add-button', {tabindex: 0})
			e.tabs_box = tag('tabs-box')
			e.header = tag('tabs-header', 0,
				e.tabs_box, e.selection_bar, e.fixed_header, e.add_button)
			e.content = tag('tabs-content', {class: 'x-container'})
			e.add(e.header, e.content)
			e.add_button.on('click', add_button_click)
		}

		let items = opt.items
		if (isarray(items))
			items = set(items)
		if (items) {
			for (let tab of e.tabs_box.at) {
				let item = tab._item
				if (item && !items.has(item)) {
					item.remove()
					item.on('label_changed', item_label_changed, false)
					item._tab = null
					item._tabs = null
				}
			}
			e.tabs_box.innerHTML = null // reappend items without rebinding them.
			for (let item of items) {
				if (item._tabs != e) {
					let xbutton = tag('tabs-xbutton')
					xbutton.hidden = true
					let title_box = tag('tabs-title')
					let tab = tag('tabs-tab', 0, title_box, xbutton)
					tab.title_box = title_box
					tab.xbutton = xbutton
					tab.on('pointerdown' , tab_pointerdown)
					tab.on('dblclick'    , tab_dblclick)
					tab.on('keydown'     , tab_keydown)
					title_box.on('input' , update_title)
					title_box.on('blur'  , title_blur)
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

		if (opt.title_of)
			update_tab_title(opt.title_of._tab)

		let tab = selected_item && selected_item._tab

		if (selected_tab != tab) {

			if (selected_tab) {
				selected_tab.class('selected', false)
				e.content.clear()
				update_tab_state(selected_tab, false)
			}
			selected_tab = tab
			if (tab) {
				tab.class('selected', true)
				e.content.set(tab.item)
			}
		}

		if (opt.enter_editing) {
			e.widget_editing = true
			return
		}

		if (tab && !e.widget_editing)
			if (opt.focus_tab)
				tab.focus()
			else if (opt.focus_tab_content != false && e.auto_focus_first_item)
				tab.item.focus_first()

		if (tab)
			update_tab_state(tab, true)

		e.add_button.hidden = !(e.can_add_items || e.widget_editing)

	})

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

	// controller -------------------------------------------------------------

	e.on('resize', function() {
		e.position()
	})

	var selected_item = null

	function select_tab(tab, opt) {
		selected_item = tab ? tab.item : null
		e.update(opt)
	}

	e.set_items = function() {
		let i = find_item_index(e.selected_item_id)
		if (i == null)
			selected_item = url_path_item()
		if (!selected_item)
			selected_item = e.items[i || 0]
	}

	// selected_item_id persistent property -----------------------------------

	function item_label(item) {
		return item._label || item.attr('label')
	}

	function format_item(item) {
		return item_label(item) || item.id
	}

	function find_item_index(id) {
		if (!id)
			return
		let i = 0
		for (let item of e.items) {
			if (item.id == id) return i
			i++
		}
	}

	function format_id(id) {
		let i = find_item_index(id)
		let item = i != null ? e.items[i] : null
		return item && item_label(item) || id
	}

	function item_select_editor(...opt) {

		let rows = []
		for (let item of e.items)
			if (item.id)
				rows.push([item.id, item])

		return list_dropdown({
			rowset: {
				fields: [{name: 'id'}, {name: 'item', format: format_item}],
				rows: rows,
			},
			nolabel: true,
			val_col: 'id',
			display_col: 'item',
			mode: 'fixed',
		}, ...opt)

	}

	e.prop('selected_item_id', {text: 'Selected Item',
		editor: item_select_editor, format: format_id})

	// url --------------------------------------------------------------------

	function url_path_level() {
		let parent = e.parent
		let i = 0
		while (parent && parent.iswidget) {
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

	// drag-move tabs ---------------------------------------------------------

	live_move_mixin(e)

	e.set_movable_element_pos = function(i, x) {
		let tab = e.items[i]._tab
		tab.x = x - tab._offset_x
	}

	e.movable_element_size = function(i) {
		return e.items[i]._tab.rect().w
	}

	let dragging, drag_mx

	function tab_pointerdown(ev, mx, my) {
		if (this.title_box.contenteditable && !ev.ctrlKey) {
			ev.stopPropagation()
			return
		}
		select_tab(this)
		if (ev.ctrlKey)
			return // bubble-up to enter editing mode.
		this.focus()
		return this.capture_pointer(ev, tab_pointermove, tab_pointerup)
	}

	function tab_pointermove(ev, mx, my, down_mx, down_my) {
		if (!dragging) {
			dragging = e.can_move_items && (abs(down_mx - mx) > 4 || abs(down_my - my) > 4)
			if (dragging) {
				for (let item of e.items)
					item._tab._offset_x = item._tab.ox
				e.move_element_start(this.index, 1, 0, e.items.length)
				drag_mx = down_mx - this.ox
				e.class('moving', true)
				this.class('moving', true)
				e.position()
			}
		} else {
			e.move_element_update(mx - drag_mx)
			e.position()
		}
	}

	function tab_pointerup() {
		if (dragging) {

			let over_i = e.move_element_stop()
			let insert_i = over_i - (over_i > this.index ? 1 : 0)
			let items = [...e.items]
			let rem_item = items.remove(this.index)
			items.insert(insert_i, rem_item)
			e.items = items

			e.class('moving', false)
			this.class('moving', false)

			for (let item of e.items)
				item._tab.x = null

			dragging = false
		}
		select_tab(this)
	}

	// key bindings -----------------------------------------------------------

	function set_renaming(renaming) {
		e.renaming = !!renaming
		selected_tab.title_box.contenteditable = e.renaming
	}

	function tab_keydown(key, shift, ctrl) {
		if (key == 'F2' && e.can_rename_items) {
			set_renaming(!e.renaming)
			return false
		}
		if (e.widget_editing || e.renaming) {
			if (key == 'Enter') {
				if (ctrl)
					this.title_box.insert_at_caret('<br>')
				else
					e.widget_editing = false
				return false
			}
		}
		if (e.renaming) {
			if (key == 'Enter' || key == 'Escape') {
				set_renaming(false)
				return false
			}
		}
		if (!e.widget_editing && !e.renaming) {
			if (key == ' ' || key == 'Enter') {
				select_tab(this)
				return false
			}
			if (key == 'ArrowRight' || key == 'ArrowLeft') {
				let i = (selected_tab ? selected_tab.index : -1) + (key == 'ArrowRight' ? 1 : -1)
				let tab = e.tabs_box.at[clamp(i, 0, e.len-1)]
				select_tab(tab, {focus_tab: true})
				return false
			}
		}
	}

	e.set_widget_editing = function(v) {
		if (!v)
			update_title()
	}

	function add_button_click() {
		if (selected_tab == this)
			return
		e.items = [...e.items, widget_placeholder({title: 'New', module: e.module})]
		return false
	}

	function tab_dblclick() {
		if (e.renaming || !e.can_rename_items)
			return
		set_renaming(true)
		this.focus()
		return false
	}

	function update_title() {
		if (selected_tab)
			selected_tab.item.label = selected_tab.title_box.innerText
		e.update()
	}

	function title_blur() {
		e.widget_editing = false
	}

	function xbutton_pointerdown() {
		select_tab(null)
		e.remove_child_widget(this.parent.item)
		return false
	}

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

widget('split', 'Containers', function(e) {

	selectable_widget(e)
	contained_widget(e)

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

	e.on_update(function() {

		e.xoff()
		if (!e.item1) e.item1 = widget_placeholder({module: e.module})
		if (!e.item2) e.item2 = widget_placeholder({module: e.module})
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

		document.fire('layout_changed')
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

	// parent-of selectable widget protocol.
	e.child_widgets = function() {
		return [e.item1, e.item2]
	}

	// parent-of selectable widget protocol.
	e.remove_child_widget = function(item) {
		e.replace_child_widget(item, widget_placeholder({module: e.module}))
	}

	// widget placeholder protocol.
	e.replace_child_widget = function(old_item, new_item) {
		let ITEM = e.item1 == old_item && 'item1' || e.item2 == old_item && 'item2' || null
		e[ITEM] = new_item
		e.update()
	}

	return {
		item1: html_item1,
		item2: html_item2,
	}

})

widget('vsplit', function(e) {
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
css('.action-band .btn-text', 'nowrap')

// hide cancel button icon unless space is tight when text is hidden
css('.action-band:not(.tight) .dlg-button-cancel .btn-icon', 'hidden')

css('.action-band-center', 'S h-c gap-x')

widget('action-band', 'Input', function(e) {

	e.layout = 'ok:ok cancel:cancel'

	e.on_init(function() {
		let ct = e
		for (let s of e.layout.words()) {
			if (s == '<') {
				ct = div({class: 'action-band-center'})
				e.add(ct)
				continue
			} else if (s == '>') {
				align = 'right'
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
				b = btn(b)
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

css('.dlg', 'v p-4 fg b0 ro bg1', `
	margin: 20px;
	box-shadow: var(--shadow-modal);
`)

css('.dlg-header' , 'm-b-2')
css('.dlg-footer' , 'm-t-2')
css('.dlg-content', 'm-y-2')

css('.dlg-heading', 'dim xlarge bold')

css('.dlg-xbutton', 'abs b b-t-0 h-c h-m', `
	right: 8px;
	top: 0px;
	border-bottom-right-radius: var(--border-radius-button);
	border-bottom-left-radius : var(--border-radius-button);
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

widget('dlg', function(e) {

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
		for (let btn of e.$('btn[primary]')) {
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

css('.toolbox-content', 'h shrinks scroll-auto grid-h')

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

widget('toolbox', function(e) {

	let html_content = [...e.nodes]
	e.clear()

	e.make_focusable()

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
		document.fire('layout_changed', e)
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

css('.slides', 'grid-h')
css('.slide', 'x1 y1')
css('.slides > .x-ct > .', 'x1 y1')

css_state('.slide'        , 'invisible op0 click-through     ease-05s')
css_state('.slide-current', 'visible   op1 click-through-off ease-05s')

widget('slides', 'Containers', function(e) {

	selectable_widget(e)
	contained_widget(e)
	let html_items = widget_items_widget(e)

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
		let i1 = clamp_item(or(e0 && e0.index, -1) + 1, rollover)
		e.current_slide = e.at[i1]
	}

	e.prev_slide = function(rollover) {
		let e0 = e.current_slide
		let i1 = clamp_item(or(e0 && e0.index, -1) - 1, rollover)
		e.current_slide = e.at[i1]
	}

	// view

	let current_slide
	e.on_update(function(opt) {

		let items = opt.items
		if (items) {
			for (let item of e.at) {
				if (item && !items.has(item)) {
					item.remove()
					item.class('slide', false)
					item.class('slide-current', false)
					item._slides = null
				}
			}
			e.innerHTML = null // reappend items without rebinding them.
			for (let item of items) {
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

css('.pagenav', 'h-bl')
css('.pagenav-button', '')
css('.pagenav-current', '')
css('.pagenav-dots', '')

widget('pagenav', function(e) {

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
		b.title = or(title, or(text, S('page', 'Page {0}', page)))
		b.href = href !== false ? e.page_url(page) : null
		b.set(or(text, page))
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
		let n = e.page_count
		let p = e.cur_page
		let dotted
		for (let i = 1; i <= n; i++) {
			if (i == 1 || i == n || (i >= p-1 && i <= p+1)) {
				e.add(e.page_button(i))
				dotted = false
			} else if (!dotted) {
				e.add(div({class: 'pagenav-dots'}, unsafe_html('&mldr;')))
				dotted = true
			}
		}
		e.add(e.nav_button(1))
	})

})


/* <richtext> ----------------------------------------------------------------

in props:
	content
inner html:
	-> content

*/

css('.richtext', 'scroll-auto')

css('.richtext:not(.richedit)', 'm0', 'display: block;')
css('.richtext:not(.richedit) > .focus-box', 'b0')

css('.richtext-content', 'vscroll-auto no-outline', `
	padding: 10px;
`)

css('.richtext-actionbar', 'abs h bg1')

css('.richtext-button', 'm0 b bg1 h-c h-m', `
	height: 2em;
	width: 2em;
`)

css('.richtext-button:not(:first-child)', 'b-l-0')

css_state('.richtext-button:hover', '', `
	background-color: var(--bg-button-hover);
`)

css_state('.richtext-button:active', '', `
	background-color: var(--fg-dim);
`)

css_state('.richtext-button.selected', '', `
	box-shadow: var(--shadow-pressed);
	background-color: var(--fg-dim);
	color: white;
`)

widget('richtext', function(e) {

	let html_content = [...e.nodes]
	e.clear()

	selectable_widget(e)
	contained_widget(e)
	editable_widget(e)

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

	// widget editing ---------------------------------------------------------

	e.set_widget_editing = function(v) {
		if (!v) return
		richtext_widget_editing(e)
		e.set_widget_editing = function(v) {
			e.editing = v
			if (!v) {
				e.content = [...e.content_box.nodes]
				e.xsave()
			}
		}
		e.editing = true
	}

	return {content: html_content}

})

/* <richtext> editing mixin --------------------------------------------------



*/

{

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
		let button = tag('button', {class: 'richtext-button', title: action.title})
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

	e.content_box.on('pointerdown', function(ev) {
		if (!e.widget_editing)
			return
		if (!ev.ctrlKey)
			ev.stopPropagation() // prevent exit editing.
	})

	e.actionbar.on('pointerdown', function(ev) {
		ev.stopPropagation() // prevent exit editing.
	})

	e.set_editing = function(v) {
		e.content_box.contentEditable = v
		e.actionbar.hidden = !v
	}
	e.prop('editing', {private: true})

	e.content_box.on('blur', function() {
		if (!button_pressed)
			e.widget_editing = false
	})

}

}

/* <label> -------------------------------------------------------------------

props:
	for_id
attrs:
	for
fires:
	^for.label_hover(on)
	^for.label_pointer{down|up}(ev)
	^for.label_click(ev)

*/

// using `label-widget` because `label` is a utility class...
css('.label-widget', 'label noselect')
css_state('.label-widget:is(:hover,.hover)', 'label-hover')

widget('label', function(e) {
	e.class('label-widget')
	e.class('label', false)
	e.prop('for_id', {type: 'id', attr: 'for'})
	e.on('pointerenter', function() {
		let te = window[e.for_id]
		if (!te) return
		te.fire('label_hover', true)
	})
	e.on('pointerleave', function() {
		let te = window[e.for_id]
		if (!te) return
		te.fire('label_hover', false)
	})
	e.on('target_hover', function(on) {
		e.class('hover', on)
	})
	e.on('pointerdown', function(ev) {
		let te = window[e.for_id]
		if (!te) return
		te.fire('label_pointerdown', ev)
	})
	e.on('pointerup', function(ev) {
		let te = window[e.for_id]
		if (!te) return
		te.fire('label_pointerup', ev)
	})
	e.on('click', function(ev) {
		let te = window[e.for_id]
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
css('.info .tooltip.visible', 'click-through')

widget('info', function(e) {
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
		collapsed : or(e.collapsed, true),
	}
})

/* <check>, <toggle>, <radio> buttons ----------------------------------------

classes:
	.hover
attrs:
	name value checked
state:
	checked <-> t|f
methods:
	e.user_toggle()
	e.user_set_checked(checked)

*/

// check, toggle, radio ------------------------------------------------------

css('.checkbox', 'large t-m link h-c h-m round', `
	min-width  : 2em;
	min-height : 2em;
	max-width  : 2em;
	max-height : 2em;
	--fg-check: var(--fg-link);
`)

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
	e.input = tag('input', {hidden: '', type: input_type || 'checkbox'})
	e.add(e.input)
	e.make_focusable()
	e.prop('checked', {type: 'bool', attr: true})
	e.prop('name')
	e.prop('value')
	e.property('label', function() {
		if (!e.bound) return
		if (!e.id) return
		return $1('label[for='+e.id+']')
	})
	e.set_checked = function(v) {
		e.input.checked = v
	}
	e.user_set_checked = function(v) { // stub
		e.checked = v
	}
	e.user_toggle = function() {
		e.user_set_checked(!e.checked)
	}
	e.on('keydown', function(key) {
		if (key == ' ') // same as for <button>
			e.user_toggle()
	})
	e.on('click', function() {
		e.user_toggle()
	})
	e.on('label_hover', function(on) {
		e.class('hover', on)
	})
	e.on('label_click', function() {
		e.user_toggle()
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

widget('check', function(e) {
	check_widget(e)
	e.add(svg({viewBox: '-10 -10 20 20'},
		svg_tag('circle'  , {class: 'checkbox-focus-circle'}),
		svg_tag('rect'    , {class: 'check-frame'}),
		svg_tag('polyline', {class: 'check-mark', points: '4 11 8 15 16 6'}),
	))
})

// toggle --------------------------------------------------------------------

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

widget('toggle', function(e) {
	check_widget(e)
	e.thumb = div({class: 'toggle-thumb'})
	e.set(e.thumb)
})

/* <radio> -------------------------------------------------------------------

additional attrs:
	group
additional props:
	group

*/

css('.radio', 'checkbox')

css('.radio-circle', 'check-line', ` r: .5; `)
css('.radio-thumb' , 'ease'      , ` r:  0; fill: var(--fg-check); `)

css_state('.radio[checked] .radio-thumb', 'ease', ` r: .2px; transition-property: r; `)

css_state('.radio:focus-visible', 'no-outline')

widget('radio', function(e) {

	check_widget(e, 'radio')

	e.prop('group', {attr: true})

	e.add(svg({viewBox: '-1 -1 2 2'},
		svg_tag('circle', {class: 'checkbox-focus-circle'}),
		svg_tag('circle', {class: 'radio-circle'}),
		svg_tag('circle', {class: 'radio-thumb'}),
	))

	e.set_value = function(v) {
		e.input.value = v
	}

	e.user_set_checked = function(v) {
		if (!v)
			return
		let others
		if (e.group) {
			let form = e.closest('.form') || document.body
			others = form.$('.radio[group='+e.group+']')
		} else {
			let form = e.closest('.form') || e.closest('.radio-group')
			others = form && form.$('.radio') || empty_array
		}
		for (let re of others)
			if (re != e)
				re.checked = false
		e.checked = true
	}

})

// <radio-group> & .radio-group ----------------------------------------------

css('radio-group', 'skip')

widget('radio-group', 'Input', function(e) {

	e.init_child_components()

	e.property('value', function() {
		for (let r of e.each('.radio'))
			if (r.checked)
				return r.value
	})

})

/* <slider> & <range-slider> -------------------------------------------------

config:
	from to
	min max
	decimals
state:
	val | min_val max_val
	progress | min_progress max_progress
methods:

*/

// reset editbox
css('.slider', 'S t-m noclip rel', `
	--slider-marked: 1;
	--slider-mark-w: 40px; /* pixels only! */
	min-width: 8em;
	margin-left   : calc((var(--slider-marked) * var(--slider-mark-w) / 2) + var(--space-1));
	margin-right  : calc((var(--slider-marked) * var(--slider-mark-w) / 2) + var(--space-1));
	margin-top    : calc(var(--space-1) + 1em);
	margin-bottom : calc(var(--space-1) + 1em + var(--slider-marked) * 1em);
`)
css('.slider-fill', 'abs round', ` height: 3px; `)
css('.slider-bg-fill'   , 'bg1')
css('.slider-valid-fill', 'bg3')
css('.slider-val-fill'  , 'bg-link')
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
css('.slider-thumb .tooltip.visible', 'click-through')

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

css_state('.slider.modified', 'no-bg')

css_state('.slider-thumb:focus-visible', 'no-shadow', `
	outline: 6px solid var(--outline-markbox-focused);
`)
css_state('.slider:focus-within', 'no-outline')
css_state('.slider:focus-within .slider-val-fill', '', `
	background-color: var(--bg-focused-selected);
`)
css_state('.slider:focus-within .slider-thumb', '', `
	background-color: var(--bg-focused-selected);
`)

// css_state('.slider.invalid .slider-thumb', '', `
// 	border-color: var(--bg-error);
// 	background: var(--bg-error);
// `)

css_state('.slider.animate .slider-thumb     ', 'ease')
css_state('.slider.animate .slider-val-fill'  , 'ease')

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

	e.class('slider')

	e.prop('from'       , {type: 'number', default: 0})
	e.prop('to'         , {type: 'number', default: 1})

	e.prop('min'        , {type: 'number'})
	e.prop('max'        , {type: 'number'})
	e.prop('decimals'   , {type: 'number', default: 2})

	e.prop('marked'     , {type: 'bool'  , default: true})

	if (range) {
		e.prop('min_val' , {type: 'number'})
		e.prop('max_val' , {type: 'number'})
	} else {
		e.prop('val'     , {type: 'number'})
	}

	e.mark_w = e.css().prop('--slider-mark-w').num()

	e.set_marked = function(v) {
		e.style.prop('--slider-marked', v ? 1 : 0)
	}

	e.bg_fill    = div({class: 'slider-fill slider-bg-fill'})
	e.valid_fill = div({class: 'slider-fill slider-valid-fill'})
	e.val_fill   = div({class: 'slider-fill slider-val-fill'})

	e.marks = div({class: 'slider-marks'})

	if (range) {
		e.min_val_thumb = div({class: 'slider-thumb'})
		e.max_val_thumb = div({class: 'slider-thumb'})
		e.min_val_thumb.val_prop = 'min_val'
		e.max_val_thumb.val_prop = 'max_val'
		e.thumbs    = [e.min_val_thumb, e.max_val_thumb]
	} else {
		e.val_thumb = div({class: 'slider-thumb'})
		e.val_thumb.val_prop = 'val'
		e.thumbs    = [e.val_thumb]
	}

	e.add(e.bg_fill, e.valid_fill, e.val_fill, e.marks,
		e.min_val_thumb, e.max_val_thumb, e.val_thumb)

	for (let thumb of e.thumbs)
		thumb.make_focusable()

	// model

	function cmin() { return max(or(e.min, -1/0), e.from) }
	function cmax() { return min(or(e.max,  1/0), e.to  ) }

	function multiple() { return or(1 / 10 ** e.decimals, 1) }

	function progress_for(v) {
		return clamp(lerp(v, e.from, e.to, 0, 1), 0, 1)
	}

	function val_prop(val_i) {
		return e.thumbs[val_i || 0].val_prop
	}

	e.set_progress = function(p, val_prop) {

		let v = lerp(p, 0, 1, e.from, e.to)

		if (e.decimals != null)
			v = floor(v / multiple() + .5) * multiple()

		if (range)
			if (val_prop == 'min_val')
				v = min(v, e.max_val)
			else
				v = max(v, e.min_val)

		e[val_prop] = clamp(v, cmin(), cmax())

		e.update()
	}

	e.get_progress = function(val_prop) {
		return progress_for(e[val_prop])
	}

	if (!range) {
		e.prop('progress', {private: true, store: false})
	} else {
		for (let thumb of e.thumbs) {
			let vk = thumb.val_prop
			let k = vk.replace('_val', '')
			e.prop(k+'_progress', {private: true, store: false})
			e['get_'+k] = function( ) { e.get_progress(vk) }
			e['set_'+k] = function(p) { e.set_progress(p, vk) }
		}
	}

	// view

	e.tooltip_target = e.val_thumb || e
	e.tooltip_align = 'center'

	e.user_set_progress = function(p, val_prop) {
		e.set_progress(p, val_prop)
	}

	e.display_val_for = function(v) {
		return (v && e.decimals != null) ? v.dec(e.decimals) : v
	}

	function update_thumb(thumb, p) {
		thumb.style.left = (p * 100)+'%'
		if (thumb.tooltip) {
			thumb.tooltip.text = e.display_val_for(e[thumb.val_prop])
			thumb.tooltip.position()
		}
	}

	function update_fill(fill, p1, p2) {
		fill.style.left  = (p1 * 100)+'%'
		fill.style.width = ((p2 - p1) * 100)+'%'
	}

	e.on_update(function() {

		let p1, p2

		p1 = progress_for(e.from)
		p2 = progress_for(e.to)
		update_fill(e.bg_fill, p1, p2)

		p1 = progress_for(cmin())
		p2 = progress_for(cmax())
		update_fill(e.valid_fill, p1, p2)

		p1 = progress_for(range ? e.min_val : cmin())
		p2 = progress_for(range ? e.max_val : e.val)
		update_fill(e.val_fill, p1, p2)

		for (let thumb of e.thumbs) {
			let p = e.get_progress(thumb.val_prop)
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
		l.set(e.display_val_for(v))
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

		thumb.on('hover', function(ev, on) {
			if (!thumb.tooltip) {
				thumb.tooltip = tooltip({align: 'center'})
				thumb.add(thumb.tooltip)
			}
			thumb.tooltip.show(on)
			e.update()
		})

		thumb.on('pointerdown', function(ev, mx0) {
			thumb.focus()
			let r = e.rect()
			let tr = thumb.rect()
			let dx = mx0 - (tr.x + tr.w / 2)
			function pointermove(ev, mx) {
				e.user_set_progress((mx - dx - r.x) / r.w, thumb.val_prop)
			}
			pointermove(ev, mx0)
			function pointerup(ev) {
				e.class('animate')
			}
			e.class('animate', e.decimals != null
				&& lerp(e.from + multiple(), e.from, e.to, 0, r.w) >= 20)
			return this.capture_pointer(ev, pointermove, pointerup)
		})

		thumb.on('keydown', function(key, shift) {
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
				let p = e.get_progress(this.val_prop) + d * (shift ? .1 : 1)
				e.user_set_progress(p, this.val_prop)
				return false
			}
		})

	}

	e.on('resize', function() {
		e.position()
	})

}

widget('slider'      , 'Input', slider_widget)
widget('range-slider', 'Input', function(e) {
	slider_widget(e, true)
})

/* .inputbox class -----------------------------------------------------------

Applies to <input> and <button> so that they dovetail perfectly in an inline
context (they valign and have the same border, height, margin and padding).

NOTE: `--p-y-input-adjust` is set to 1px for certain fonts at certain sizes.
NOTE: `--lh-input` is 1.25 because <input> can't set it lower.

NOTE: Do not try to baseline-align elements that have borders or background,
they will never align perfectly if you have text in multiple fonts inside
(which you do when you use icon fonts). Even when `line-height` is exactly
the same everywhere the elements will still misalign at certain zoom levels.
That's why we use `t-m` instead of `t-bl` on all bordered widgets.

*/

css_util('.lh-input', '', `
	--lh: var(--lh-input);
	line-height: calc(var(--fs) * var(--lh)); /* in pixels so it's the same on icon fonts */
`)

css_util('.p-t-input', '', ` padding-top    : calc((var(--p-y-input, var(--space-1)) + var(--p-y-input-adjust, 0px) + var(--p-y-input-offset, 0px))); `)
css_util('.p-b-input', '', ` padding-bottom : calc((var(--p-y-input, var(--space-1)) - var(--p-y-input-adjust, 0px) + var(--p-y-input-offset, 0px))); `)
css_util('.p-y-input', 'p-t-input p-b-input')

css_util('.p-l-input', '', ` padding-left   : var(--p-x-input, var(--space-1)); `)
css_util('.p-r-input', '', ` padding-right  : var(--p-x-input, var(--space-1)); `)
css_util('.p-x-input', 'p-l-input p-r-input')

css_util('.gap-x-input', '', ` column-gap: var(--p-x-input, var(--space-1)); `)
css_util('.gap-y-input', '', ` row-gap   : var(--p-y-input, var(--space-1)); `)

css('.inputbox', 'm-y-05 b p-x-input p-y-input t-m h-m gap-x-input lh-input')

css_util('.xsmall' , '', `--p-y-input-adjust: var(--p-y-input-adjust-xsmall );`)
css_util('.small'  , '', `--p-y-input-adjust: var(--p-y-input-adjust-small  );`)
css_util('.smaller', '', `--p-y-input-adjust: var(--p-y-input-adjust-smaller);`)
css_util('.normal' , '', `--p-y-input-adjust: var(--p-y-input-adjust-normal );`)
css_util('.large'  , '', `--p-y-input-adjust: var(--p-y-input-adjust-large  );`)
css_util('.xlarge' , '', `--p-y-input-adjust: var(--p-y-input-adjust-xlarge );`)

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

*/

css('.input-group', 'shrinks t-m m-y-05 lh-input h-s')

// `position: static` fixes the bug (in both Chrome & FF) where the outline
// is obscured by the children if 1) they have a background and 2) they create
// a stacking context.
css_role('.input-group > *', 'm0 b no-z', `position: static;`)

// things that <input-group> doesn't insist upon its children having.
css('.input-group > *', 'bg-input')

widget('input-group', function(e) {

	e.class('b-collapse-h ro-group-h')
	e.init_child_components()
	e.input = $1('input')
	e.make_focusable(e.input)

})

/* <labelbox> ----------------------------------------------------------------

Stack elements vertically inside an .inputbox, also stripping them of margin,
border and padding, making them float beside each other. Putting an <input-group>
inside a <labelbox> also strips the elements inside the <input-group>. So a
<labelbox> can be used for two things: 1) putting a <label> above an <input>,
and 2) putting stripped elements inside an <input-group>, even when you don't
want a label.

*/

css('.labelbox', 'S v p-x-input p-y-input gap-x-input gap-y-input')

css_role('.labelbox > *, labelbox > .input-group > *', 'b0 m0 p0')
css_role('.labelbox > .input-group', 'gap-x-input gap-y-input')

// no-bg prevents outline clipping, also bg doesn't make sense since labelbox has padding.
css_role('.labelbox *', 'no-bg')

widget('labelbox', function(e) {
	e.init_child_components()
})

/* <input> -------------------------------------------------------------------

--

*/

css('.input', 'S bg-input', `
	font-family   : inherit;
	font-size     : inherit;
	border-radius : 0;
`)

widget('input', 'Input', function(e) {

	e.make_focusable()
	e.class('inputbox')

})

/* <textarea> ----------------------------------------------------------------

--

*/

css('.textarea', 'S h m0 b p bg-input', `
	resize: none;
	overflow-y: overlay; /* Chrome only */
	overflow-x: overlay; /* Chrome only */
`)

widget('textarea', 'Input', function(e) {

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

css_state('.button:not([disabled]):not(.widget-editing):not(.widget-selected):hover', '', `
	background: var(--bg-button-hover);
`)
css_state('.button:not([disabled]):not(.widget-editing):not(.widget-selected):active', '', `
	background: var(--bg-button-active);
	box-shadow: var(--shadow-button-active);
`)

css('.button[primary]', 'b-invisible', `
	background : var(--bg-button-primary);
	color      : var(--fg-button-primary);
`)
css_state('.button[primary]:not([disabled]):not(.widget-editing):not(.widget-selected):hover', '', `
	background : var(--bg-button-primary-hover);
`)
css_state('.button[primary]:not([disabled]):not(.widget-editing):not(.widget-selected):active', '', `
	background : var(--bg-button-primary-active);
`)

css('.button[danger]', '', `
	background : var(--bg-button-danger);
	color      : var(--fg-button-danger);
`)
css_state('.button[danger]:not([disabled]):not(.widget-editing):not(.widget-selected):hover', '', `
	background : var(--bg-button-danger-hover);
`)
css_state('.button[danger]:not([disabled]):not(.widget-editing):not(.widget-selected):active', '', `
	background : var(--bg-button-danger-active);
`)

css('.button[bare]', 'b-invisible ro0 no-bg no-shadow link')

css_state('.button[bare]:not([disabled]):not(.widget-editing):not(.widget-selected):hover', 'no-bg', `
	color: var(--fg-link-hover);
`)

css_state('.button[bare]:active', 'no-bg', `
	color: var(--fg-link-active);
`)

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

widget('button', 'Input', function(e) {

	editable_widget(e)
	e.class('inputbox')

	let html_text = [...e.nodes]
	e.clear()

	e.icon_box = span({class: 'button-icon'})
	e.text_box = span({class: 'button-text'})
	e.icon_box.hidden = true
	e.add(e.icon_box, e.text_box)

	e.make_focusable()

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

	e.format_text = function(s) { // stub
		return s
	}

	function update_text() {
		let s = e.format_text(e.text)
		e.text_box.set(s, 'pre-line')
		e.class('text-empty', !s || isarray(s) && !s.length)
		if (e.link)
			e.link.set(TC(s))
	}

	e.set_text = function(s) {
		update_text()
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

	e.prop('primary', {type: 'bool', attr: true})
	e.prop('bare'   , {type: 'bool', attr: true})
	e.prop('danger' , {type: 'bool', attr: true})
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

	// widget editing ---------------------------------------------------------

	e.set_widget_editing = function(v) {
		e.text_box.contenteditable = v
		if (!v)
			e.text = e.text_box.innerText
	}

	e.on('keydown', function keydown(key, shift, ctrl) {
		if (e.widget_editing) {
			if (key == 'Enter') {
				if (ctrl) {
					e.text_box.insert_at_caret('<br>')
					return
				} else {
					e.widget_editing = false
					return false
				}
			}
		}
	})

	e.on('pointerdown', function(ev) {
		if (e.widget_editing && ev.target != e.text_box) {
			e.text_box.focus()
			e.text_box.select_all()
			return this.capture_pointer(ev)
		}
	})

	function prevent_bubbling(ev) {
		if (e.widget_editing)
			ev.stopPropagation()
	}
	e.text_box.on('pointerdown', prevent_bubbling)
	e.text_box.on('click', prevent_bubbling)

	e.text_box.on('blur', function() {
		e.widget_editing = false
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

state:
	selected_val
	selected_index

*/

css('.select-button', 'rel ro-var h-s gap-x-0 bg0 shadow-button', `
	padding: var(--p-select-button, 3px);
	--p-y-input-offset: calc(1px - var(--p-select-button, 3px));
`)

css_util('.smaller', '', ` --p-select-button: 2px; `)
css_util('.xsmall' , '', ` --p-select-button: 1px; `)
css_util('.small'  , '', ` --p-select-button: 1px; `)

css('.select-button > :not(.select-button-plate)', 'S h-m t-c p-y-input p-x-button gap-x nowrap-dots noselect dim z1', `
	flex-basis: fit-content;
`)
css('.select-button > :not(.select-button-plate):not(.selected):hover', 'fg')
css('.select-button > :not(.select-button-plate).selected', '', `
	color: var(--fg-select-button-plate);
`)

css('.select-button-plate', 'abs ease shadow-button', `
	transition-property: left, width;
	border-radius: calc(var(--border-radius, var(--space-075)) * 0.7);
	background: var(--bg-select-button-plate);
`)

css_state('.select-button-plate:hover', '', `
	background: var(--bg-select-button-plate-hover);
`)

css_light('', '', `
	--bg-select-button-plate: var(--bg-button-primary);
	--fg-select-button-plate: var(--fg-button-primary);
`)

css_dark('', '', `
	--bg-select-button-plate: var(--bg2);
	--fg-select-button-plate: var(--fg-white);
`)

widget('select-button', function(e) {

	e.class('inputbox')
	e.init_child_components()
	e.plate = div({class: 'select-button-plate'})
	e.add(e.plate)

	e.make_focusable(e.plate)

	// model

	e.prop('selected_index', {type: 'number'})

	e.property('selected_val', function() {
		return e.selected_button ? e.selected_button.val : null
	})

	e.set_selected_index = function(i) {
		let b = i != null && e.len > 1 && e.at[clamp(i, 0, e.len-2)] || null
		e.selected_button = b
		e.update()
	}

	// view

	let sbor
	let mx = 0
	let my = 0

	e.on_measure(function() {
		sbor = e.selected_button && e.selected_button.orect()
	})

	e.on_update(function() {
		for (let b of e.at)
			b.class('selected', false)
		if (e.selected_button)
			e.selected_button.class('selected', true)
	})

	e.on_position(function() {
		if (!e.selected_button) {
			e.plate.hide()
			return
		}
		e.plate.x = sbor.x + mx
		e.plate.y = sbor.y + my
		e.plate.w = sbor.w - 2*mx
		e.plate.h = sbor.h - 2*my
		e.plate.show()
	})

	// controller

	e.on('click', function(ev) {
		let b = ev.target
		while (b && b.parent != e) b = b.parent
		if (!b || b.parent != e || b == e.plate) return
		e.selected_index = b.index
		e.focus()
	})

	e.on('keydown', function(key) {
		let n = (key == 'ArrowRight' ? 1 : key == 'ArrowLeft' ? -1 : 0)
		if (!n) return
		e.selected_index = (e.selected_button ? e.selected_button.index : 0) + n
	})

	e.on('resize', function() {
		e.position()
	})

	return {selected_index: 0}
})

widget('vselect-button', function(e) {

	e.class('ro-group-v b-collapse-v')
	e.init_child_components()

})

/* <tags-box> ----------------------------------------------------------------

state:
	tags: 'tag1 ...' || ['tag1', ...]

*/

css('.tags-box', 'm-y p-y-05 h-m flex-wrap gap', `
	--tag-hue: 154;
`)

css('.tags-tag', 'p-y-025 p-x-input gap-x ro-var-075 h-m noselect', `
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

widget('tags-box', function(e) {

	// model

	e.prop('tags', {type: 'set', element_type: 'string', convert: convert_tags })

	function convert_tags(tags) {
		return words(tags).remove_duplicates()
	}

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
		t.on('pointerdown', tag_pointerdown)
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

	function tag_pointerdown() {
		this.focus()
	}

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

/* <tags> --------------------------------------------------------------------

config:
	nowrap
state:
	tags: 'tag1 ...' || ['tag1', ...]

*/

css('.tags', 'shrinks')
css('.tags-input', 'S b0')
css_role('.tags-scrollbox', 'shrinks h-m b-r-0 p-x clip')
css_role('.tags .tags-box'  , 'shrinks m0')
css_role('.tags .tags-input', 'b-l-0', `min-width: 5em;`)
css('.tags-box-nowrap', 'flex-nowrap')

widget('tags', function(e) {

	e.class('input-group')

	e.tags_box = tags_box()
	e.input = tag('input', {class: 'tags-input', placeholder: 'Tag'})
	e.add(div({class: 'tags-scrollbox'}, e.tags_box), e.input)
	e.make_focusable(e.input)

	e.prop('tags', {store: false})
	e.get_tags = () => e.tags_box.tags
	e.set_tags = (v) => e.tags_box.tags = v

	e.prop('nowrap', {type: 'bool'})
	e.set_nowrap = (v) => e.tags_box.class('tags-box-nowrap', !!v)

	e.input.on('keydown', function(key) {
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
			e.input.focus()
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

/* <autocomplete> ------------------------------------------------------------

in props:

update opt:
	input

*/

css('.autocomplete', 'b p-x-input p-y-input bg-input')

widget('autocomplete', 'Input', function(e) {

	function input_input(ev) {
		e.update({input: this.value, show: !!this.value})
	}

	e.bind_input = function(te, on) {
		if (warn_if(te.tag != 'input', 'autocomplete: not an input tag: {0}', e.input_id))
			return
		te.on('input', input_input, on)
		e.popup_target = on ? te : null
		e.show(!!te.value)
	}

	e.prop('input_id', {type: 'id', attr: 'for', on_bind: e.bind_input})

	e.popup(null, 'bottom', 'left')
	e.hide()

})

/* <dropdown> ----------------------------------------------------------------


*/

widget('dropdown', 'Input', function(e) {

	e.class('inputbox')

	e.value_box = div({class: 'dropdown-value'})
	e.chevron = div({class: 'dropdown-chevron'})
	e.add(e.value_box, e.chevron)

})

/* <widget-placeholder> ------------------------------------------------------

calls:
	e.replace_child_widget()

*/

widget('widget-placeholder', function(e) {

	selectable_widget(e)
	contained_widget(e)

	function replace_widget(item) {
		let pe = e.parent_widget
		let te = element({
			tag: item.tag,
			id: '<new>', // pseudo-id to be replaced with an auto-generated id.
			module: pe && pe.module || e.module,
		})
		if (pe) {
			pe.replace_child_widget(e, te)
		} else {
			xmodule.set_root_widget(te)
		}
		te.focus()
	}

	let cmenu

	function create_context_menu() {
		let items = []
		for (let cat in component.categories) {
			let comp_items = []
			let cat_item = {text: cat, items: comp_items}
			items.push(cat_item)
			for (let create of component.categories[cat])
				comp_items.push({
					text: create.type.display_name(),
					create: create,
					action: replace_widget,
				})
		}
		if (cmenu)
			cmenu.close()
		cmenu = menu({
			items: items,
		})
	}

	e.on_bind(function(on) {
		if (on)
			create_context_menu()
	})

	e.on('contextmenu', function(ev, mx, my) {
		cmenu.popup(e, 'inner-top', null, null, null, null, null, ev.clientX, ev.clientY)
		return false
	})

})