
/* widget_with_widget_items --------------------------------------------------

implements:
  e.child_widgets()
  e.replace_child_widget()
  e.remove_child_widget()

*/

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


/* widget editing & selecting --------------------------------------------- */

css_role('.widget-editing', '', `
	outline: 2px dotted red;
	outline-offset: -2px;
`)

css_role('[contenteditable]', 'no-outline')

css_role('.widget-selected', 'click-through')

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
selected_widgets = set()

function unselect_all_widgets() {
	if (editing_widget)
		editing_widget.widget_editing = false
	for (let e of selected_widgets)
		e.widget_selected = false
}

function copy_selected_widgets() {
	copied_widgets = set(selected_widgets)
}

function cut_selected_widgets() {
	copy_selected_widgets()
	for (let e of selected_widgets)
		e.remove_widget()
}

function paste_copied_widgets() {
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

document.on('keydown', function(key, shift, ctrl, alt, ev) {
	if (key == 'Escape')
		unselect_all_widgets()
	else if (ctrl && key == 'c')
		if (selected_widgets.size)
			copy_selected_widgets()
		else
			ev.target.fireup('copy', ev)
	else if (ctrl && key == 'x')
		if (selected_widgets.size)
			cut_selected_widgets()
		else
			ev.target.fireup('cut', ev)
	else if (ctrl && key == 'v') {
		if (copied_widgets.size)
			paste_copied_widgets()
		if (copied_widgets.size)
			ev.target.fireup('paste', ev)
	} else if (ctrl && key == 'z')
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
		if (e.initialized && which(e))
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



/* <widget-placeholder> ------------------------------------------------------

calls:
	e.replace_child_widget()

*/

widget_placeholder = component('widget-placeholder', function(e) {

	e.class('widget-placeholder')

	selectable_widget(e)

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


// tabs ----------------------------------------------------------------------

	e.create_item = function() {
		return widget_placeholder({title: 'New', module: e.module})
	}

	e.remove_item = function(item) {
  		e.remove_child_widget(item)
	}

	on_update(function(opt) {

		if (opt.enter_editing) {
			e.widget_editing = true
			return
		}

	}

	e.set_widget_editing = function(v) {
		if (!v)
			update_title()
	}


	in on_update:

		title_box.on('blur'  , title_blur)

	function title_blur() {
		e.widget_editing = false
	}



// button --------------------------------------------------------------------

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


// richtext -------------------------------------------------------------------

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

	e.content_box.on('pointerdown', function(ev) {
		if (e.widget_editing)
			if (!ev.ctrl)
				ev.stopPropagation() // prevent exit editing.
	})

	e.content_box.on('blur', function() {
		if (!button_pressed)
			e.widget_editing = false
	})


// split ---------------------------------------------------------------------

	e.widget_placeholder = () => widget_placeholder({module: e.module})

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

