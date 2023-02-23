/*

	Model-driven single-value and single-row input widgets.
	Written by Cosmin Apreutesei. Public Domain.

WIDGETS

	btn
	checkbox
	toggle
	radiogroup
	textedit
	lineedit
	passedit
	numedit
	spinedit
	tagsedit
	placeedit
	googlemaps
	slideedit
	calendar
	dateedit
	timepicker
	timeofdayedit
	richedit
	lookup-dropdown
	image
	sqledit
	mu
	switcher
	lbl
	inp
	frm

*/

css('.error-list', '', `
	margin: 0;
	padding-inline-start: 1em;
	text-align: start;
`)

// ---------------------------------------------------------------------------
// widget with a nav prop
// ---------------------------------------------------------------------------

/*
function nav_link_widget(e) {

	function bind_ext_nav(on) {
		let nav = e._nav
		let col = e._col
		nav.on('focused_row_changed', update, on)
		nav.on('focused_row_cell_state_changed_for_'+col, cell_state_changed, on)
		nav.on('display_vals_changed_for_'+col, update, on)
		nav.on('reset', reset, on)
		nav.on('col_label_changed_for_'+col, update, on)
		nav.on('col_info_changed_for_'+col, update, on)
	}

	function bind_global_nav(on) {
		// e.debug('BGN', e.col)
		let nav = e._nav
		let col = e._col
		nav.on('focused_row_cell_state_changed_for_'+col, cell_state_changed, on)
		nav.on('display_vals_changed_for_'+col, update, on)
	}

	function bind_ext_field(on) {
		if (on) {
			e._field = e._nav && e._nav.optfld(e.col) || null
			if (!e._field)
				return
			e._col = e._field.name
			e.fire('bind_field', true)
		} else {
			e._field = null
			e._col = null
			e.fire('bind_field', false)
		}
	}

	function bind_nav(on) {
		if (on) {
			if (!e._nav) {
				let nav = e.nav || e._nav_id_nav || null
				if (e.col != null) { // nav-bound
					if (nav) {
						e._nav = nav
						e._col = e.col
						bind_ext_nav(true)
						bind_ext_field(true)
					}
				} else { // standalone
					e.bind_int_nav(true)
				}
			}
		} else {
			if (e._nav) {
				if (e._nav != global_val_nav()) { // nav-bound
					e.bind_ext_nav(false)
					e.bind_ext_field(false)
					e._nav = null
					e._col = null
				} else { // standalone
					e.bind_int_nav(false)
				}
			}
		}
	}

	e.on_bind(bind_nav)

	function nav_changed() {
		if (!e.bound)
			return
		bind_nav(false)
		bind_nav(true)
	}

	e.set_col = nav_changed
	e.prop('col', {type: 'col', col_nav: () => e._nav})

	e.set_nav = nav_changed
	e.prop('nav', {private: true})

	e.set__nav_id_nav = nav_changed
	e.prop('_nav_id_nav', {private: true})
	e.prop('nav_id', {bind_id: '_nav_id_nav', type: 'nav', attr: 'nav'})

})
*/

/* ---------------------------------------------------------------------------
// row widget mixin
// ---------------------------------------------------------------------------
publishes:
	e.nav
	e.nav_id
	e.row
implements:
	e.do_update()
calls:
	e.do_update_row([row])
--------------------------------------------------------------------------- */

function row_widget(e, enabled_without_nav) {

	selectable_widget(e)
	contained_widget(e)

	e.isinput = true // auto-focused when tabs items are changed.

	e.do_update = function() {
		let row = e.row
		e.xoff()
		e.readonly = e._nav && !e._nav.can_change_val(row)
		e.xon()
		e.disable('readonly', e.readonly && !e.enabled_on_readonly)
		e.disable('no_row', !(enabled_without_nav || e.row))
		e.do_update_row(row)
	}

	function row_changed() {
		e.update()
	}

	function bind_ext_nav(on) {
		let nav = e._nav
		nav.on('focused_row_changed', row_changed, on)
		nav.on('focused_row_state_changed', row_changed, on)
		nav.on('focused_row_cell_state_changed', row_changed, on)
		nav.on('display_vals_changed', row_changed, on)
		nav.on('reset', row_changed, on)
		nav.on('col_label_changed', row_changed, on)
		nav.on('col_info_changed', row_changed, on)
		e.fire('bind_nav', on)
	}

	function bind_nav(on) {
		if (!on && e._nav) {
			bind_ext_nav(false)
			e._nav = null
		} else if (on && !e._nav) {
			e._nav = e.nav || e._nav_id_nav || null
			if (e._nav)
				bind_ext_nav(true)
		}
	}

	e.on_bind(bind_nav)

	function nav_changed() {
		if (!e.bound)
			return
		bind_nav(false)
		bind_nav(true)
	}

	e.set_nav = nav_changed
	e.prop('nav', {private: true})

	e.set__nav_id_nav = nav_changed
	e.prop('_nav_id_nav', {private: true})
	e.prop('nav_id', {bind_id: '_nav_id_nav', type: 'nav', attr: 'nav'})

	e.property('row', () => e._nav && e._nav.focused_row)

	e.val = function(col) {
		return e._nav && e._nav.cell_val(e.row, col)
	}

}

/* ---------------------------------------------------------------------------
// val widget mixin
// ---------------------------------------------------------------------------
publishes:
	e.nav
	e.nav_id
	e.col
	e.field
	e.row
	e.val
	e.input_val
	e.error
	e.modified
	e.set_val(v, ev)
	e.reset_val(v, ev)
	e.display_val_for(v)
implements:
	e.do_update([opt])
uses:
	e.field              instance field attrs
	e.field_attrs        class field attrs
calls:
	e.do_update_val(val, ev)
	e.do_update_errors(errors, ev)
	e.do_error_tooltip_check()
	e.to_val(v) -> v
	e.from_val(v) -> v
--------------------------------------------------------------------------- */

function val_widget(e, enabled_without_nav, show_error_tooltip) {

	selectable_widget(e)
	contained_widget(e)

	e.isinput = true // auto-focused when tabs items are changed.

	let field_tag = e.$1(':scope>field')
	if (field_tag) {
		e.html_field_attrs = parse_field_tag(field_tag)
		field_tag.remove()
	}

	// nav dynamic binding ----------------------------------------------------

	e.can_actually_change_val = function() {
		if (e.row)
			return e._nav.can_change_val(e.row, e._field)
		else if (!e._nav)
			return enabled_without_nav
		else if (!e._nav.all_rows.length)
			return e._nav.can_actually_add_rows()
		else
			return false
	}

	function bind_ext_field(on) {
		if (on) {
			e._field = e._nav && e._nav.optfld(e.col) || null
			if (!e._field)
				return
			e._col = e._field.name
			e.fire('bind_field', true)
		} else {
			e._field = null
			e._col = null
			e.fire('bind_field', false)
		}
	}

	function update() {
		e.update()
	}

	function reset() {
		bind_ext_field(true)
		e.update()
	}

	function cell_state_changed(row, field, changes, ev) {
		e.update({changes: changes, ev: ev})
		e.fire('state_changed', changes, ev)
	}

	function bind_ext_nav(on) {
		let nav = e._nav
		let col = e._col
		nav.on('focused_row_changed', update, on)
		nav.on('focused_row_cell_state_changed_for_'+col, cell_state_changed, on)
		nav.on('display_vals_changed_for_'+col, update, on)
		nav.on('reset', reset, on)
		nav.on('col_label_changed_for_'+col, update, on)
		nav.on('col_info_changed_for_'+col, update, on)
	}

	function bind_global_nav(on) {
		// e.debug('BGN', e.col)
		let nav = e._nav
		let col = e._col
		nav.on('focused_row_cell_state_changed_for_'+col, cell_state_changed, on)
		nav.on('display_vals_changed_for_'+col, update, on)
	}

	function bind_nav(on) {
		if (on) {
			if (!e._nav) {
				let nav = e.nav || e._nav_id_nav || null
				if (e.col != null) { // nav-bound
					if (nav) {
						e._nav = nav
						e._col = e.col
						bind_ext_nav(true)
						bind_ext_field(true)
					}
				} else { // standalone
					let field_opt = assign_opt({owner: e},
						e.field_attrs, e.html_field_attrs, e.field)
					e._nav = global_val_nav()
					e._field = e._nav.add_field(field_opt)
					e._col = e._field.name
					bind_global_nav(true)
					if (initial_val !== undefined) {
						if (initial_val == e.attr('val')) {
							// initial_val comes in as text: convert it.
							initial_val = e._field.from_text(initial_val)
						}
						e._nav.reset_cell_val(e._nav.all_rows[0], e._field, initial_val)
					}
				}
			}
		} else {
			if (e._nav) {
				if (e._nav != global_val_nav()) { // nav-bound
					bind_ext_nav(false)
					bind_ext_field(false)
				} else { // standalone
					bind_global_nav(false)
					e._nav.remove_field(e._field)
				}
				e._nav = null
				e._field = null
				e._col = null
			}
		}
	}

	e.on_bind(bind_nav)

	function nav_changed() {
		if (!e.bound)
			return
		bind_nav(false)
		bind_nav(true)
	}

	e.set_col = nav_changed
	e.prop('col', {type: 'col', col_nav: () => e._nav})

	e.set_nav = nav_changed
	e.prop('nav', {private: true})

	e.set__nav_id_nav = nav_changed
	e.prop('_nav_id_nav', {private: true})
	e.prop('nav_id', {bind_id: '_nav_id_nav', type: 'nav', attr: 'nav'})

	// field options for standalone mode (own field in global nav).
	e.set_field = nav_changed
	e.prop('field', {private: true})

	// TODO: this behaves differently with regards to overriding a validator
	// when a field is already bound vs when it's not!
	e.add_validator = function(name, t) {
		if (e._field)
			e._field.validators.push(t)
		else
			attr(e, 'field_attrs')['validator_'+name] = t
	}

	// model ------------------------------------------------------------------

	e.to_val   = function(v) { return v; }
	e.from_val = function(v) { return v; }

	e.property('row', () => e._nav && e._nav.focused_row)

	function get_val() {
		let row = e.row
		return row && e._field ? e.from_val(e._nav.cell_val(row, e._field)) : null
	}
	function get_input_val() {
		let row = e.row
		return row && e._field ? e.from_val(e._nav.cell_input_val(row, e._field)) : null
	}

	e.reset_val = function(v, ev) {
		v = e.to_val(v)
		if (v === undefined)
			v = null
		if (e.row && e._field)
			e._nav.reset_cell_val(e.row, e._field, v, ev)
	}

	let initial_val
	e.set_val = function(v, ev) {
		v = e.to_val(v)
		if (v === undefined)
			v = null
		let was_set
		if (e._field) {
			if (!e.row)
				if (e._nav && !e._nav.all_rows.length)
					if (e._nav.can_actually_change_val())
						e._nav.insert_rows(1, {focus_it: true})
			if (e.row) {
				e._nav.set_cell_val(e.row, e._field, v, ev)
				was_set = true
			}
		}
		if (!was_set)
			initial_val = v
	}
	e.property('val', get_val, e.set_val)
	e.property('input_val', get_input_val)

	e.property('errors',
		function() {
			let row = e.row
			return row && e._field ? e._nav.cell_errors(row, e._field) : undefined
		},
		function(errors) {
			if (e.row && e._field) {
				e._nav.begin_set_state(e.row)
				e._nav.set_cell_state(e.col, 'errors', errors)
				e._nav.end_set_state()
			}
		},
	)

	e.property('modified', function() {
		let row = e.row
		return row && e._field ? e._nav.cell_modified(row, e._field) : false
	})

	// view -------------------------------------------------------------------

	e.placeholder_display_val = function() {
		return div({class: 'input-placeholder'})
	}

	e.display_val_for = function(v) {
		if (!e.row || !e._field)
			return e.placeholder_display_val()
		return e._nav.cell_display_val_for(e.row, e._field, v)
	}

	e.prop('readonly', {type: 'bool', attr: true, default: false})

	e.do_update_val = noop

	e.on_update(function(opt) {
		let row = e.row
		let field = e._field
		if (opt.changes) {
			let val_changes = opt.changes.val || opt.changes.input_val
			if (val_changes) {
				let val = val_changes[0]
				e.do_update_val(val, opt.ev)
				e.class('modified', e._nav.cell_modified(row, field))
				e.fire('input_val_changed', val, opt.ev)
			}
			if (opt.changes.errors) {
				e.invalid = e._nav.cell_has_errors(row, field)
				e.class('invalid', e.invalid)
				e.do_update_errors(opt.changes.errors[0], opt.ev)
			}
		} else {
			let readonly = !e.can_actually_change_val()
			e.xoff()
			e.readonly = readonly
			e.xon()
			e.disable('readonly', readonly && !e.enabled_on_readonly)
			e.disable('no_row', !(enabled_without_nav || e.row))

			e.do_update_val(e.input_val)
			e.class('modified', e._nav && row && field && e._nav.cell_modified(row, field))
			e.invalid = e._nav && row && field && e._nav.cell_has_errors(row, field)
			e.class('invalid', e.invalid)
			e.do_update_errors(e.errors)
		}
	})

	e.do_update_errors = function(errors) {
		if (show_error_tooltip === false)
			return
		if (!e.error_tooltip)
			if (!e.invalid)
				return // don't create it until needed.
		function update() {
			let show =
				e.invalid && !e.hasclass('picker')
				&& (e.hasfocus || e.hovered)
			e.error_tooltip.update({show: show})
		}
		if (!e.error_tooltip) {
			e.error_tooltip = tooltip({kind: 'error', classes: 'error-tooltip'})
			e.add(e.error_tooltip)
			e.on('focusin'      , update)
			e.on('focusout'     , update)
			e.on('pointerenter' , update)
			e.on('pointerleave' , update)
		}
		if (e.invalid) {
			e.error_tooltip.text = errors
				.filter(err => !err.passed)
				.map(err => err.message)
				.ul({class: 'error-list'}, true)
		}
		update()
	}

}

// ---------------------------------------------------------------------------
// button
// ---------------------------------------------------------------------------

css('.btn', 'v')
css('p .btn', 'm-05')

css('.btn-focus-box', 'h-c h-bl b ro-075 bold noselect p-x-4 p-y', `
	background : var(--bg-button);
	color      : var(--fg-button);
	box-shadow : var(--shadow-button);
`)

css('.btn-focus-box.text-empty', 'p-x-2 h-c h-m')
css('.btn-focus-box:not(.text-empty) .btn-icon', 'm-r')
css('.btn-icon', 'w1 h-c')

css_state('.btn:not([disabled]):not(.widget-editing):not(.widget-selected) .btn-focus-box:hover', '', `
	background-color: var(--bg-button-hover);
`)
css_state('.btn .btn-focus-box.active', '', `
	background: var(--bg-button-active);
	box-shadow: var(--shadow-button-active);
`)

css('.btn[primary] .btn-focus-box', 'b-invisible', `
	background : var(--bg-button-primary);
	color      : var(--fg-button-primary);
`)
css_state('.btn[primary]:not([disabled]):not(.widget-editing):not(.widget-selected) .btn-focus-box:hover', '', `
	background : var(--bg-button-primary-hover);
`)
css_state('.btn[primary] .btn-focus-box.active', '', `
	background : var(--bg-button-primary-active);
`)

css('.btn[danger] .btn-focus-box', '', `
	background : var(--bg-button-danger);
	color      : var(--fg-button-danger);
`)
css_state('.btn[danger]:not([disabled]):not(.widget-editing):not(.widget-selected) .btn-focus-box:hover', '', `
	background : var(--bg-button-danger-hover);
`)
css_state('.btn[danger] .btn-focus-box.active', '', `
	background : var(--bg-button-danger-active);
`)

// bare buttons (no borders)

css_state('.btn[bare] .btn-focus-box', 'b-invisible ro0 no-bg no-shadow link')

css_state('.btn[bare]:not([disabled]):not(.widget-editing):not(.widget-selected) .btn-focus-box:hover', '', `
	color: var(--fg-link-hover);
`)

css_state('.btn[bare] .btn-focus-box.active', '', `
	color: var(--fg-link-active);
`)

// attention animation

css(`
@keyframes x-attention {
	from {
		transform: scale(1.2);
		outline: 2px solid var(--fg);
		outline-offset: 2px;
	}
}
`)

widget('btn', 'Input', function(e) {

	row_widget(e, true)
	editable_widget(e)

	let html_text = unsafe_html(e.html)
	e.clear()

	e.icon_box = span({class: 'btn-icon'})
	e.text_box = span({class: 'btn-text'})
	e.focus_box = div({class: 'btn-focus-box'}, e.icon_box, e.text_box)
	e.icon_box.hidden = true
	e.add(e.focus_box)

	e.make_focusable(e.focus_box)

	e.prop('href', {store:'var', attr: true})
	e.set_href = function(s) {
		if (s) {
			if (!e.link) { // make a link for google bot to follow.
				let noscript = tag('noscript')
				e.add(noscript)
				e.link = tag('a')
				e.link.set(TC(e.text))
				e.link.title = e.title
				noscript.set(e.link)
			}
			e.link.href = s
		} else if (e.link) {
			e.link.href = null
		}
	}

	e.format_text = function(s) {
		let row = e.row
		if (!row) return s
		return render_string(s, e._nav.serialize_row_vals(row))
	}

	function update_text() {
		let s = e.format_text(e.text)
		e.text_box.set(s, 'pre-line')
		e.focus_box.class('text-empty', !s)
		if (e.link)
			e.link.set(TC(s))
	}

	e.set_text = function(s) {
		update_text()
	}

	e.prop('text', {type: 'html', default: '', slot: 'lang'})

	e.set_icon = function(v) {
		if (isstr(v))
			e.icon_box.attr('class', 'btn-icon '+v)
		else
			e.icon_box.set(v)
		e.icon_box.hidden = !v
	}
	e.prop('icon', {type: 'icon'})
	e.prop('load_spin', {attr: true})

	e.prop('primary', {type: 'bool', attr: true})
	e.prop('bare'   , {type: 'bool', attr: true})
	e.prop('danger' , {type: 'bool', attr: true})
	e.prop('confirm', {attr: true})
	e.prop('action_name', {attr: 'action'})

	e.activate = function() {
		if (e.effectively_hidden || e.effectively_disabled)
			return
		if (e.confirm)
			if (!confirm(e.confirm))
				return
		if (e.href) {
			exec(e.href)
			return
		}
		// action can be set directly and/or can be a global with a matching name.
		if (e.action)
			e.action()
		let action_name = e.action_name || (e.id && e.id+'_action')
		let action = window[action_name]
		if (action)
			action.call(e)
		e.fire('activate')
	}

	function set_active(on, cancel) {
		if (!on && cancel == null)
			cancel = !e.hasclass('active')
		e.class('active', on)
		e.focus_box.class('active', on)
		e.fire('active', on)
		if (!on && !cancel)
			e.activate()
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
			return
		}
		if (e.hasclass('active') && key == 'Escape') {
			set_active(false, true)
			return false
		}
		if (key == ' ' || key == 'Enter') {
			set_active(true)
			return false
		}
	})

	e.on('keyup', function keyup(key) {
		if (e.hasclass('active')) {
			// ^^ always match keyups with keydowns otherwise we might catch
			// a keyup from someone else's keydown, eg. a dropdown menu item
			// could've been selected by pressing Enter which closed the menu
			// and focused this button back and that Enter's keyup got here.
			if (key == ' ' || key == 'Enter') {
				set_active(false)
			}
			return false
		}
	})

	e.focus_box.on('pointerdown', function(ev) {
		if (e.widget_editing)
			return
		e.focus()
		set_active(true)
		return this.capture_pointer(ev, null, function() {
			set_active(false)
		})
	})

	// widget editing ---------------------------------------------------------

	e.set_widget_editing = function(v) {
		e.text_box.contenteditable = v
		if (!v)
			e.text = e.text_box.innerText
	}

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
		raf(function() { e.style.animation = 'x-attention .5s' })
	}

	// row changing -----------------------------------------------------------

	e.do_update_row = function(row) {
		update_text()
	}

	return {text: or(html_text)}

})

/* ---------------------------------------------------------------------------
// input-box widget mixin
// ---------------------------------------------------------------------------
features:
	- layout with focus-box and info-box underneath.
	- optional (animated) inner label.
	- optional info button tied to the focus-box vs info-box underneath.
publishes:
	e.label
	e.nolabel
	e.align
	e.mode
	e.info
	e.infomode
uses:
	e.label_box
calls:
	add_info_button()
	add_info_box()
	create_label_placeholder()
--------------------------------------------------------------------------- */

css('.input-widget', 'v')
css_state('.input-widget[readonly]', '', 'opacity: .8;')

css('.input-widget:not(.with-label) .input-label', 'hidden')

css('.focus-box', 'S', `
	position: relative; /* for abs. pos. animated labels */
	border-width: 1px;
	border-style: dotted;
	border-color: transparent; /* only editboxes set this */
	border-radius: var(--border-radius-input);
	outline-offset: -2px;
`)

css(':is(.theme-dark, .theme-light .theme-inverted) .focus-box', 'b-invisible', `
	background-color: #060606;
`)

css('.input-widget.with-label .focus-box', '', `
	min-height: var(--min-height-input);
	--padding-y-button: 0; /* inline buttons should not affect box height */
`)

/* input info button */

css('.input-info-button', '', `
	align-self: stretch; /* stretch vertically */
	margin: 0;
	/* make it seem integrated into the parent */
	border-right-color  : rgb(0,0,0,0);
	border-top-color    : rgb(0,0,0,0);
	border-bottom-color : rgb(0,0,0,0);

	/* icon style */
	align-items: flex-end;
	color: var(--bg-info);
`)

css('.input-info-button .btn-icon', '', `
	font-size: 110%;
	opacity: .9;
`)

/* input info under text */

css('.input-info', 'p-x-input m-y label arrow')

css('.input-info info', 'skip', `
	font-size: 100%;
`)

css_state('.focus-box :focus', '', `outline: none;`)

css_state('.focus-box:has(:focus-visible)', 'b-invisible outline-focus')

css_state('.input-widget:focus-within .input-info', 'op1')

css_state('.x-container > .input-widget .focus-box', 'b0')

css_state('.input-widget:not(:focus-within) .error-tooltip', 'click-through')

function input_widget(e) {

	e.init_child_components()

	let html_info = e.$1(':scope>info') || undefined
	if (html_info)
		html_info.remove()

	let html_label = e.nodes.trim()
	e.clear()

	e.class('input-widget')

	e.prop('label'   , {slot: 'lang'})
	e.prop('nolabel' , {type: 'bool', attr: true})
	e.prop('align'   , {type: 'enum', enum_values: 'left right', default: 'left', attr: true})
	e.prop('mode'    , {type: 'enum', enum_values: 'default inline', default: 'default', attr: true})
	e.prop('info'    , {slot: 'lang'})
	e.prop('infomode', {slot: 'lang', type: 'enum', enum_values: 'under button hidden', attr: true, default: 'under'})

	e.add_info_button = e.add // stub

	e.add_info_box = function(info_box) { // stub
		e.insert(1/0, div({class: 'linear-form-filler'}), info_box)
	}

	e.debug_anon_name = function() {
		return catany('', e.tag, catall(':' + e.col))
	}

	e.do_after('do_update_errors', function() {
		if (e.error_tooltip)
			e.error_tooltip.popup_align = e.align == 'right' ? 'end' : 'start'
	})

	function update_info() {
		let info = e.info || (e._field && e._field.info)

		if (info && e.infomode == 'button' && !e.info_button) {
			e.info_button = button({
				classes: 'input-info-button',
				icon: 'fa fa-info-circle',
				text: '',
				focusable: false,
			})
			e.info_tooltip = tooltip({
				kind: 'info',
				side: 'bottom',
				align: 'end',
			})
			e.info_tooltip.on('click', function() {
				this.close()
			})
			e.info_button.action = function() {
				if (e.info_tooltip.target) {
					e.info_tooltip.target = null
				} else {
					e.info_tooltip.target = e.info_button
				}
			}
			e.add_info_button(e.info_button)
		}
		if (e.info_button) {
			e.info_tooltip.text = info
			e.info_button.hidden = !(e.infomode == 'button' && !!info)
		}

		if (info && e.infomode == 'under' && !e.info_box) {
			e.info_box = div({class: 'input-info'})
			e.add_info_box(e.info_box)
		}
		if (e.info_box) {
			e.info_box.set(T(info, 'pre-line'))
			e.info_box.hide(!(e.infomode == 'under' && !!info))
		}

	}

	e.create_label_placeholder = function() {
		return div({class: 'input-placeholder'})
	}

	e.get__label = function() {
		return e.label || e.attr('label') || (e._field && e._field.label) || null
	}
	e.prop('_label', {store: false, private: true})

	e.set_label = function() {
		e.fire('label_changed')
	}

	e.on_update(function() {
		let s = !e.nolabel && e._label || null
		if (s != null && e._field && e._field.not_null && e.label_show_star != false)
			s = s + ' *'
		e.class('with-label', !!s)
		e.label_box.set(!e.nolabel ? s || e.create_label_placeholder() : null)
		update_info()
	})

	e.on('keydown', function(key, shift, ctrl) {

		if (key == 'F1') {
			if (e.info_button)
				e.info_button.activate()
			return false
		}

		if (ctrl && key == 's') {
			if (e._nav)
				e._nav.save()
			return false
		}

	})

	e.on('pointerdown', function(ev) {
		let fe = e.focusables()[0]
		if (fe && ev.target != fe) {
			fe.focus()
			// preventDefault() is to avoid focusing back the target.
			// at the same time we don't want to prevent other 'pointerdown'
			// handlers so we're not just returning false.
			ev.preventDefault()
		}
	})

	return {label: html_label, info: html_info}
}

// checkbox & radio-item -----------------------------------------------------

css('.markbox', 'w1', `
	width: auto; /* shrink-wrap */
`)

css('.markbox .focus-box', 'h-m clip p-x-input p-y-input arrow')

css('.markbox.with-label .focus-box', '', `
	line-height: initial;
`)

css('.markbox.with-label .markbox-label', 'nowrap', `
	display: block;
`)

css('.markbox.no-field .markbox-label', 'S')

css('.markbox-icon', 'link', `
	justify-self: center;
`)

css('.markbox[align=right] .focus-box    ', '', ` justify-content: end; `)
css('.markbox[align=right] .markbox-icon ', 'order-2')
css('.markbox[align=right] .markbox-label', 't-r')

css('.markbox[align=left ] .markbox-label', 'p-l')
css('.markbox[align=right] .markbox-label', 'p-r')

css('.markbox .input-info-button', 'p-r-0', `
	margin-left: auto;
`)

css_state('.markbox:focus-within.invalid .focus-box', '', `
	border-color: var(--fg-error);
`)

css_state('.markbox.invalid :is(.markbox-label, .markbox-icon)', 'fg-error')

css_state('.linear-form .markbox-label:focus-visible', 'outline-focus')

css_role('.markbox.grid-editor .focus-box', 'h-c h-m')

// ---------------------------------------------------------------------------
// checkbox
// ---------------------------------------------------------------------------

css_role('.linear-form :is(.checkbox, .checkbox-focus-box, .markbox-baseline-box)', 'skip')

css('.checkbox[button_style=checkbox] > .focus-box > .markbox-baseline-box > .checkbox-icon', 'large')
css('.checkbox[button_style=checkbox] > .focus-box > .markbox-baseline-box > .checkbox-icon::before', 'far fa-square')
css_state('.checkbox[button_style=checkbox] > .focus-box > .markbox-baseline-box > .checkbox-icon.checked::before', 'fa fa-check-square')

css('.markbox-baseline-box', 'h-bl')

widget('checkbox', 'Input', function(e) {

	editable_widget(e)
	val_widget(e)
	let cons_opt = input_widget(e)

	e.class('markbox')

	e.checked_val = true
	e.unchecked_val = false

	e.label_show_star = false
	e.icon_box = span({class: 'markbox-icon checkbox-icon'})
	e.label_box = span({class: 'input-label markbox-label checkbox-label'})
	e.baseline_box = span({class: 'markbox-baseline-box'}, e.icon_box, e.label_box)
	e.focus_box = div({class: 'focus-box checkbox-focus-box'}, e.baseline_box)
	e.add(e.focus_box)

	e.make_focusable(e.label_box)

	e.add_info_button = function(btn) {
		btn.attr('bare', true)
		e.add(btn)
	}

	e.set_button_style = function(v) {
		if (v == 'toggle') {
			e.icon_box.set(tag('toggle'))
			e.icon_box.user_set_checked = function(v) {
				e.set_checked(v, {input: e})
			}
		} else {
			e.icon_box.clear()
		}
	}

	e.prop('button_style', {type: 'enum', enum_values: 'checkbox toggle',
		default: 'checkbox', attr: true})

	e.set_button_style(e.button_style)

	// model

	e.get_checked = function() {
		return e.input_val === e.checked_val
	}
	e.set_checked = function(v, ev) {
		e.set_val(v ? e.checked_val : e.unchecked_val, ev)
	}
	e.prop('checked', {store: false, private: true})

	// view

	e.do_update_val = function(v) {
		let c = e.checked
		e.class('checked', c)
		if (e.button_style == 'toggle')
			e.icon_box.at[0].checked = c
		else
			e.icon_box.class('checked', c)
		e.class('no-field', !e._field)
	}

	// controller

	e.toggle = function(ev) {
		e.set_checked(!e.checked, ev)
	}

	e.on('pointerdown', function(ev) {
		if (e.widget_editing)
			return
		ev.preventDefault() // prevent accidental selection by double-clicking.
	})

	function click(ev) {
		if (e.widget_editing)
			return
		e.focus()
		e.toggle({input: e})
		return false
	}

	e.icon_box .on('click', click)
	e.label_box.on('click', click)

	e.on('keydown', function(key, shift, ctrl) {
		if (e.widget_editing) {
			if (key == 'Enter') {
				if (ctrl)
					e.label_box.insert_at_caret('<br>')
				else
					e.widget_editing = false
				return false
			}
			return
		}
		if (key == 'Enter' || key == ' ') {
			e.toggle({input: e})
			return false
		}
		if (key == 'Delete' && e.input_val != null) {
			e.set_val(null, {input: e})
			return false
		}
	})

	// widget editing ---------------------------------------------------------

	e.set_widget_editing = function(on) {
		e.label_box.contenteditable = on
		if (!on) {
			e.label = e.label_box.innerText
			if (window.xmodule)
				xmodule.save()
		}
	}

	e.on('pointerdown', function(ev) {
		if (e.widget_editing && ev.target != e.label_box)
			return this.capture_pointer(ev, null, function() {
				e.label_box.focus()
				e.label_box.select_all()
			})
	})

	function prevent_bubbling(ev) {
		if (e.widget_editing && !ev.ctrlKey)
			ev.stopPropagation()
	}
	e.label_box.on('pointerdown', prevent_bubbling)
	e.label_box.on('click', prevent_bubbling)

	e.label_box.on('blur', function() {
		e.widget_editing = false
	})

	return cons_opt

})

widget('toggleedit', 'Input', function(e) {
	attr(e.props, 'button_style').default = 'toggle'
	attr(e.props, 'align'       ).default = 'right'
	return checkbox.construct(e)
})

// ---------------------------------------------------------------------------
// radiogroup
// ---------------------------------------------------------------------------

css('.radiogroup', 'v')
css('.radio-items', 'rel v')

css('.radio-item', 'h-bl p-x-input p-y-input', `
	width: auto; /* shrink-wrap sizing */
	min-width: 1em;
`)

css('.radio-label', 'noselect')

css('.radiogroup[align=right] .radio-item   ', 'h-r')
css('.radiogroup[align=right] .markbox-icon ', 'order-2')
css('.radiogroup[align=left ] .markbox-label', 'p-l')
css('.radiogroup[align=right] .markbox-label', 'p-r')

css_state('.radio-item.invalid :is(.radio-label, .radio-icon)', 'fg-error')

css_state('.radio-label:focus', 'no-outline')

css_state('.radiogroup:not([disabled]):not([readonly]) :is(.radio-label, .radio-icon):hover', '', `
	filter: contrast(60%);
`)

css_state('.radio-item:has(:focus-visible)', 'outline-focus')

css_role('.linear-form :is(.radiogroup, .radio-items, .radio-item)', 'skip')

widget('radiogroup', 'Input', function(e) {

	e.init_child_components()

	let html_info = e.$1(':scope>info')
	if (html_info)
		html_info.remove()

	editable_widget(e)
	val_widget(e)
	let html_items = widget_items_widget(e)

	e.prop('info', {slot: 'lang'})

	e.items_box = div({class: 'radio-items'})
	e.add(e.items_box)

	// do_update_val() must be called after the items are added!
	e.do_before('do_update', function(opt) {

		let items = opt.items
		if (isarray(items))
			items = set(items)
		if (items) {

			for (let item of e.items_box.at)
				if (!items.has(item)) {
					item._radio_item.remove()
					item._radio_item = null
				}

			e.items_box.innerHTML = null
			for (let item of items) {
				if (!item._radio_item) {
					let ri = div({class: 'radio-item'})
					ri.icon_box = span({class: 'markbox-icon radio-icon far fa-circle'})
					ri.label_box = item
					ri.label_box.make_focusable()
					ri.label_box.class('input-label markbox-label radio-label')
					item._radio_item = ri
					ri.attr('align', e.align)
					ri.item = item
					ri.add(ri.icon_box, ri.label_box)
					function pointerdown() {
						select_radio_item(ri)
						return false
					}
					ri.icon_box .on('pointerdown', pointerdown)
					ri.label_box.on('pointerdown', pointerdown)
					ri.on('keydown', radio_item_keydown)
					e.items_box.add(ri)
				} else {
					e.items_box.append(item._radio_item)
				}
			}
		}

		let info = e._field && e._field.info || e.info
		if (info && !e.info_box) {
			e.info_box = div({class: 'input-info'})
			e.add(div({class: 'linear-form-filler'}), e.info_box)
		}

		if (e.info_box) {
			e.info_box.set(info)
			e.info_box.hide(!info)
		}

	})

	e.set_align = function(align) {
		for (let ri of e.items_box.children)
			ri.attr('align', align)
	}
	e.prop('align', {type: 'enum', enum_values: 'left right', default: 'left', attr: true})

	e.do_after('do_update_errors', function() {
		if (e.error_tooltip)
			e.error_tooltip.popup_align = e.align == 'right' ? 'end' : 'start'
	})

	let sel_ri // selected radio item

	function item_val(item) {
		return e._field.from_text(item.attr('val') || '')
	}

	function find_item(val) {
		if (!e._field)
			return
		for (let item of e.items) {
			if (item_val(item) === val)
				return item
		}
	}

	e.do_update_val = function(val) {
		if (sel_ri) {
			sel_ri.class('selected', false)
			sel_ri.at[0].class('fa-dot-circle', false)
			sel_ri.at[0].class('fa-circle', true)
			sel_ri.class('invalid', false)
		}
		let item = find_item(val)
		if (item) {
			sel_ri = item._radio_item
			sel_ri.class('selected', true)
			sel_ri.at[0].class('fa-dot-circle', true)
			sel_ri.at[0].class('fa-circle', false)
			sel_ri.class('invalid', e.invalid)
		}
	}

	e.do_after('do_update_errors', function() {
		if (sel_ri)
			sel_ri.class('invalid', e.invalid)
	})

	function select_radio_item(radio_item, focus) {
		e.set_val(item_val(radio_item.item), {input: e})
		if (focus != false) {
			radio_item.label_box.focus()
		}
	}

	function radio_item_keydown(key) {
		if (key == ' ' || key == 'Enter') {
			select_radio_item(this)
			return false
		}
		if (key == 'ArrowUp' || key == 'ArrowDown') {
			let ri = e.focused_element
			ri = ri && e.items_box.contains(ri) && ri.parent
			let next_ri = ri
				&& (key == 'ArrowUp'
					? (ri.prev || e.items_box.last)
					: (ri.next || e.items_box.first))
			if (next_ri)
				select_radio_item(next_ri)
			return false
		}
	}

	e.on('bind_field', function(on) {
		if (on && !e.items.length)
			if (e._field.type == 'enum' && e._field.enum_values) {
				let texts = e._field.enum_texts
				let info = e._field.enum_info
				let items = []
				for (let v of words(e._field.enum_values))
					items.push(div({val: v}, T(texts[v] || v, 'pre-line')))
				e._items = items
				// e.update({new_items: e._items})
			}
	})

	// e.prop('_items', {convert: diff_items, serialize: e.serialize_items, default: []})
	// e.set_items = function(items) {
	// 	e._items = items
	// }

	return {items: html_items, info: html_info}
})

// ---------------------------------------------------------------------------
// editbox/dropdown
// ---------------------------------------------------------------------------

css('.editbox', '', `
	width: auto; /* shrink-wrap sizing */
	min-width: 1em;
`)

// h-bl: the only way to get variable-width inputs that are baseline-aligned.
css('.editbox .focus-box', 'h-bl p-y-input clip b', `
	padding-left    : calc(var(--padding-x-input) + 1);
	padding-right   : calc(var(--padding-x-input) - 1);
	background      : var(--bg-input);
`)

css('.editbox.with-label .focus-box', 'p-y-input', `
	line-height: initial;  /* prevent inheriting it */
`)

css('.input-placeholder', 'bg-smoke', `
	width: 100%;
`)

css('.input-placeholder::before', 'zwsp')

css('.editbox-input', 'm0 b0 p0 no-bg t-l', ` /* for editbox's input-box and value-box */
	font-size: inherit;
	font-family: inherit;
	width: 100%;             /* stretch horizontally */
	min-width: 0;            /* Firefox fix */
	color: inherit;
`)

css('.editbox[align=right] .editbox-input', 't-r')

css('.editbox[mono] .editbox-input', 'mono')

// editbox with animated inner label/placeholder -----------------------------

css('.editbox.with-label[mode=inline] .focus-box', 'ro0')

css('.editbox-label', 'abs t-t op1 label nowrap arrow', `
	align-self: flex-start;
	top: 0; /* fixate to top so we only have to set the top padding */
	font-size: var(--font-size-input-label-empty);
	padding-top: var(--padding-y1-input-il-label-empty);
	animation: editbox-label-unfocused .1s;
`)

css('.editbox[mode=inline] .focus-box', 'b0 ro0 b-b b-fg b-dashed')

css('.editbox[mode=inline] .editbox-input', '', `
	padding-bottom: .1em;
`)

// NOTE: remove the `disabled-` prefix to get animated inner labels
css(`
@keyframes disabled-editbox-label-unfocused {
	from {
		opacity: .5;
		padding-top: calc(var(--padding-y1-input-il-label-empty) * .7);
	}
}

@keyframes disabled-editbox-label-focused {
	from {
		opacity: .5;
		padding-top: calc(var(--padding-y1-input-il-label) * 2);
	}
}
`)

// editbox copy-to-clipboard button ------------------------------------------

css('.editbox-copy-to-clipboard-button', 'm0 b-l ro0', `
	margin-right: calc(0px - var(--padding-x-input));
`)

css('.editbox-copy-to-clipboard-button img', '', `
	filter: contrast(.8);
`)

css_state('.editbox.modified .focus-box', '', `
	background-color: var(--bg-modified);
`)

css_state('.editbox.invalid .focus-box', 'bg-error')

css_state('.editbox.invalid .editbox-label', 'fg-error')

css_state('.editbox[mode=inline]:focus-within .focus-box', 'no-shadow')

css_state('.editbox[mode=inline].with-label:focus-within .editbox-input', '', `
	padding-bottom: .1em;
`)

css_state('.editbox[mode=inline].with-label:not(.empty) .editbox-input', '', `
	padding-bottom: .1em;
`)

css_state('.editbox.with-label:is(:focus-within, .open, :not(.empty)) .editbox-label', 'noselect label', `
	padding-top : var(--padding-y1-input-il-label);
	animation: editbox-label-focused .1s;
`)

css_state('.editbox[mode=inline].with-label:is(:focus-within, :not(.empty)) .editbox-label', 'bold dim')

css_role('.linear-form > .editbox', 'skip')

// dropdown ------------------------------------------------------------------

/* NOTE: .dropdown is applied along with .editbox ! */

// default mode: shrink-wrap, no-wrap
css('.xdropdown', 'nowrap', `
	width: auto;
	min-width: 1em;
`)

css('.dropdown .focus-box', '', `
	line-height: initial; /* prevent y-stretching to surrounding text's line height */
`)

css('.editbox-value', 'S p-r-05 h-m nowrap', `
	width: auto;
`)

css_state('.editbox-value:empty::before', 'zwsp')
css_state('.editbox-value.null', 'dim')

css('.dropdown-button', 'p-l', `
	border-left-style: inherit;
	border-left-color: inherit;
	border-left-width: 1px;
`)

css('.dropdown-more-button', 'p-x-input h-m small', `
	margin-left: calc(0px - var(--padding-x-input));
	align-self: stretch;
`)

css('.dropdown[align=right] .editbox-value', 'order-2 p-l-05', `
	padding-right: var(--padding-x-input);
`)

// inline mode: variable-width, no-wrap with no min-width.
css('.dropdown[mode=inline] .focus-box', 'h-bl', `
	min-width: 1em; /* reset from inp's min-width */
`)

/* wrap mode: fixed-width, auto-wrap */
css('.dropdown[mode=wrap]', '', `
	width: 0; /* shrink-wrap; add min-width to make it look good */
`)
css('.dropdown[mode=wrap] .editbox-value', '', `
	white-space: normal;
`)

/* fixed mode: fixed-width, no-wrap, hide-overflow */
css('.dropdown[mode=fixed]', '', `
	width: 0; /* shrink-wrap; add min-width to make it look good */
`)

// z3: menu = 4, picker = 3, tooltip = 2, toolbox = 1
css('.widget.picker', 'z3 bg1', `
	border-color: var(--border-focused);
	box-shadow  : var(--shadow-popup-picker);
`)

// look focused even though it's the picker that's focused.
css_state('.dropdown.open .focus-box', '', `
	border-color: var(--border-focused);
`)

/* if you want that hipster animation, here it is...
css_state('.dropdown-button.down', '', `
	transition: transform .2s ease;
`)

css_state('.dropdown-button.up', '', `
	transition: transform .2s ease;
	transform: rotate(180deg);
`)
*/

css_state('.dropdown-more-button.active', 'dim')

css_state('.dropdown[mode=inline]:is(:focus-within, .open) .focus-box', 'no-shadow')

function editbox_widget(e, opt) {

	let has_input  = or(opt && opt.input , true)
	let has_picker = or(opt && opt.picker, false)

	val_widget(e)
	let cons_opt = input_widget(e)
	stylable_widget(e)

	e.props.mode.enum_values = 'default inline wrap fixed'

	e.class('editbox')
	e.class('dropdown', has_picker)

	if (has_input) {
		e.input = tag(opt && opt.input_tag || 'input', {
			autocomplete: 'off',
			class: 'editbox-input',
		})
		e.input_box = e.input
	} else {
		e.val_box = e.val_box || div({class: 'editbox-input editbox-value'})
		e.input_box = e.val_box
	}

	e.make_focusable(e.input)

	e.label_box = div({class: 'input-label editbox-label'})
	e.focus_box = div({class: 'focus-box'}, e.input_box, e.label_box)
	e.add(div({class: 'linear-form-filler'}), e.focus_box)

	e.from_text = function(s) {
		return e._field.from_text(s)
	}

	e.to_text = function(v) {
		if (!e._field)
			return ''
		if (v == null)
			return ''
		return e._field.to_text(v)
	}

	e.do_update_val = function(v, ev) {
		if (e.input) {
			if (ev && ev.input == e && ev.typing)
				return
			let s = e.to_text(v)
			let maxlen = e._field && e._field.maxlen
			e.input.value = s.slice(0, maxlen)
		} else {
			let s = e.display_val_for(v)
			e.val_box.set(s)
		}
		e.class('empty', v == '')
		e.input_box.class('empty', v == '')
		e.label_box.class('empty', v == '')
	}

	if (e.input) {

		e.enabled_on_readonly = true
		e.set_readonly = function(v) {
			e.input.bool_attr('readonly', v || null)
		}

		e.input.on('input', function() {
			let v = e.input.value
			e.set_val(e.from_text(v), {input: e, typing: true})
		})

		e.on('bind_field', function(on) {
			e.input.attr('maxlength', on ? e._field.maxlen : null)
			bind_spicker(on)
		})

		e.on('keydown', function(key, shift, ctrl) {
			if (key == 'Escape' && !e.hasclass('grid-editor'))
				if (e._field && e.row)
					if (e._nav.revert_cell(e.row, e._field, {input: e}))
						return false
		})

	}

	// suggestion picker ------------------------------------------------------

	e.prop('spicker_w', {type: 'number', text: 'Suggestion Picker Width'})

	e.create_spicker = noop // stub

	function bind_spicker(on) {
		assert(!(on && !e.bound))
		if (on) {
			e.spicker = e.create_spicker({
				id: e.id ? e.id + '.spicker' : null,
				dropdown: e,
				nav: e._nav,
				col: e._col,
				can_select_widget: false,
				focusable: false,
			})
			if (!e.spicker)
				return
			e.spicker.popup()
			e.spicker.popup_side = 'bottom'
			e.spicker.popup_align = e.align == 'right' ? 'end' : 'start'
			e.spicker.hide()
			e.spicker.class('picker', true)
			e.spicker.on('val_picked', spicker_val_picked)
			e.focus_box.add(e.spicker)
		} else if (e.spicker) {
			e.spicker.remove()
			e.spicker = null
		}
		document.on('pointerdown'     , document_pointerdown, on)
		document.on('rightpointerdown', document_pointerdown, on)
		document.on('stopped_event'   , document_stopped_event, on)
		e.input.on('keydown', keydown_for_spicker, on)
	}

	e.set_spicker_isopen = function(open) {
		if (e.spicker_isopen == open)
			return
		if (!e.spicker)
			return
		e.class('open spicker_open', open)
		if (open) {
			e.spicker.min_w = e.rect().w
			if (e.spicker_w)
				e.spicker.auto_w = false
			e.spicker.w = e.spicker_w
		}
		e.spicker_cancel_val = open ? e.input_val : null
		e.spicker.show(open)
		e.spicker.popup.update()
	}

	e.open_spicker   = function() { e.set_spicker_isopen(true) }
	e.close_spicker  = function() { e.set_spicker_isopen(false) }
	e.cancel_spicker = function(ev) {
		if (e.spicker_isopen)
			e.set_val(e.spicker_cancel_val, ev)
		e.close_spicker()
	}

	e.property('spicker_isopen', () => e.hasclass('spicker_open'), e.set_spicker_isopen)

	function spicker_val_picked(ev) {
		if (ev && ev.input == e.spicker)
			e.close_spicker()
	}

	function keydown_for_spicker(key) {
		if ((key == 'ArrowDown' || key == 'ArrowUp') && e.isopen) {
			e.spicker.pick_near_val(key == 'ArrowDown' ? 1 : -1, {input: e})
			return false
		}
		if (key == 'Enter') {
			e.close_spicker()
			// don't return false so that grid can exit edit mode.
		}
		if (key == 'Escape') {
			e.close_spicker()
			// don't return false so that grid can exit edit mode.
		}
	}

	// clicking outside the picker closes the picker.
	function document_pointerdown(ev) {
		// TODO: this is brittle because ev.target could be replaced on click
		// so by the time we get here ev.target has no parent!
		if (e.contains(ev.target)) // clicked inside the editbox.
			return
		if (e.spicker.contains(ev.target)) // clicked inside the picker.
			return
		e.close_spicker()
	}

	// clicking outside the picker closes the picker, even if the click did something.
	function document_stopped_event(ev) {
		if (ev.type.ends('pointerdown'))
			document_pointerdown(ev)
	}

	// copy-to-clipboard button -----------------------------------------------

	function update_copy_button() {
		if (!e.bound)
			return
		if (e.copy && !e.copy_button) {
			e.copy_button = button({
				classes: 'editbox-copy-to-clipboard-button',
				icon: 'far fa-clipboard',
				text: '',
				bare: true,
				focusable: false,
				title: S('copy_to_clipboard', 'Copy to clipboard'),
				action: function() {
					copy_to_clipboard(e.to_text(e.input_val), function() {
						notify(S('copied_to_clipboard',
							'{0} copied to clipboard', e._field.label), 'info')
					})
				},
			})
			e.focus_box.add(e.copy_button)
		} else if (!e.copy && e.copy_button) {
			e.copy_button.remove()
			e.copy_button = null
		}
	}

	e.on_bind(function(on) {
		if (on)
			update_copy_button()
	})

	e.prop('copy', {type: 'bool', attr: true})

	e.set_copy = update_copy_button

	// more button ------------------------------------------------------------

	e.set_more_action = function(action) {
		if (!e.more_button && action) {
			e.more_button = div({class: 'editbox-more-button dropdown-more-button fa fa-ellipsis-h'})
			e.add(e.more_button)
			e.more_button.on('pointerdown', function(ev) {
				return this.capture_pointer(ev, null, function() {
					e.more_action()
					return false
				})
			})
		} else if (e.more_button && !action) {
			e.more_button.remove()
			e.more_button = null
		}
	}
	e.prop('more_action', {private: true})

	// grid editor protocol ---------------------------------------------------

	if (e.input) {

		e.input.on('blur', function() {
			e.close_spicker()
			e.fire('lost_focus')
		})

		let editor_state

		function update_editor_state(moved_forward, i0, i1) {
			i0 = or(i0, e.input.selectionStart)
			i1 = or(i1, e.input.selectionEnd)
			let anchor_left =
				e.input.selectionDirection != 'none'
					? e.input.selectionDirection == 'forward'
					: (moved_forward || e.align == 'left')
			let imax = e.input.value.length
			let leftmost  = i0 == 0
			let rightmost = (i1 == imax || i1 == -1)
			if (anchor_left) {
				if (rightmost) {
					if (i0 == i1)
						i0 = -1
					i1 = -1
				}
			} else {
				i0 = i0 - imax - 1
				i1 = i1 - imax - 1
				if (leftmost) {
					if (i0 == 1)
						i1 = 0
					i0 = 0
				}
			}
			editor_state = [i0, i1]
		}

		e.input.on('keydown', function(key, shift, ctrl) {
			// NOTE: we capture Ctrl+A on keydown because the user might
			// depress Ctrl first and when we get the 'a' Ctrl is not pressed.
			if (key == 'a' && ctrl)
				update_editor_state(null, 0, -1)
		})

		e.input.on('keyup', function(key, shift, ctrl) {
			if (key == 'ArrowLeft' || key == 'ArrowRight')
				update_editor_state(key == 'ArrowRight')
		})

		e.editor_state = function(s) {
			if (s) {
				let i0 = e.input.selectionStart
				let i1 = e.input.selectionEnd
				let imax = e.input.value.length
				let leftmost  = i0 == 0
				let rightmost = i1 == imax
				if (s == 'left')
					return i0 == i1 && leftmost && 'left'
				else if (s == 'right')
					return i0 == i1 && rightmost && 'right'
				else if (s == 'all_selected')
					return leftmost && rightmost
			} else {
				if (!editor_state)
					update_editor_state()
				return editor_state
			}
		}

		e.enter_editor = function(s) {
			if (!s)
				return
			if (s == 'select_all')
				s = [0, -1]
			else if (s == 'left')
				s = [0, 0]
			else if (s == 'right')
				s = [-1, -1]
			editor_state = s
			let [i0, i1] = s
			let imax = e.input.value.length
			if (i0 < 0) i0 = imax + i0 + 1
			if (i1 < 0) i1 = imax + i1 + 1
			e.input.select_range(i0, i1)
		}

		e.set_text_min_w = function(w) {
			let ps = words(e.focus_box.css('padding'))
			let px1 = or(num(ps[1]), 0)
			let px2 = or(num(ps[3]), px1)
			e.focus_box.min_w = w + px1 + px2
		}

	}

	// dropdown ---------------------------------------------------------------

	if (has_picker) {

		e.prop('picker_w', {type: 'number', text: 'Picker Width'})

		e.do_after('init', function() {
			if (e.create_dropdown_button) {
				e.dropdown_button = e.create_dropdown_button()
			} else {
				e.dropdown_button = span({class: 'dropdown-button fa fa-caret-down'})
				e.dropdown_button.set_open = function(open) {
					this.switch_class('fa-caret-down', 'fa-caret-up', open)
				}
			}
			e.focus_box.insert(e.align == 'right' ? 0 : null, e.dropdown_button)
		})

		e.set_align = function(align) {
			if (!e.dropdown_button)
				return
			if (align == 'right' == e.dropdown_button.index == 0)
				e.dropdown_button.index = align == 'right' ? 0 : null
		}

		let inh_set_nav = e.set_nav
		e.set_nav = function(v, v0) {
			inh_set_nav(v, v0)
			if (e.picker)
				e.picker.nav = v
		}

		let inh_set_col = e.set_col
		e.set_col = function(v, v0) {
			inh_set_col(v, v0)
			if (e.picker)
				e.picker.col = v
		}

		function bind_picker(on) {
			if (!e.create_picker)
				return
			assert(!(on && !e.bound))
			if (on) {
				assert(!e.picker)
				e.picker = e.create_picker({
					id: e.id ? e.id + '.picker' : null,
					dropdown: e,
					nav: e._nav,
					col: e._col,
					can_select_widget: false,
				})
				e.picker.popup()
				let dr
				e.picker.on_measure(function() {
					dr = this.parent.rect()
				})
				e.picker.on_position(function() {
					this.min_w = dr.w
				})
				e.picker.popup_side = 'bottom'
				e.picker.popup_align = e.align == 'right' ? 'end' : 'start'
				e.picker.hide()
				e.picker.class('picker', true)
				e.picker.on('val_picked', picker_val_picked)
				e.picker.on('keydown'   , picker_keydown)
				e.focus_box.add(e.picker)
			} else if (e.picker) {
				e.picker.remove()
				e.picker = null
			}
			document.on('pointerdown'     , document_pointerdown, on)
			document.on('rightpointerdown', document_pointerdown, on)
			document.on('stopped_event'   , document_stopped_event, on)
		}

		e.on('bind_field', function(on) {
			if (!on)
				e.close()
			bind_picker(on)
		})

		// val updating

		let do_error_tooltip_check = e.do_error_tooltip_check
		e.do_error_tooltip_check = function() {
			return do_error_tooltip_check() || (e.invalid && e.isopen)
		}

		// opening & closing the picker

		e.set_open = function(open, focus) {
			if (e.isopen != open) {
				e.class('open', open)
				e.dropdown_button.switch_class('down', 'up', open)
				if (e.dropdown_button.set_open)
					e.dropdown_button.set_open(open)
				if (open) {
					e.cancel_val = e.input_val
					if (e.picker_w)
						e.picker.auto_w = false
					e.picker.w = e.picker_w
					e.picker.update({show: true})
					e.fire('opened')
					e.picker.fire('dropdown_opened')
					e.picker.update({show: true})
				} else {
					e.cancel_val = null
					e.fire('closed')
					if (e.picker) {
						e.picker.fire('dropdown_closed')
						e.picker.hide()
						e.picker.update()
					}
					if (!focus)
						e.fire('lost_focus') // grid editor protocol
				}
			}
			if (focus) {
				e.focus()
				if (e.input)
					e.input.select_range(0, -1)
			}
		}

		function picker_val_picked(ev) {
			e.close(!(ev && ev.input == e))
			e.fire('val_picked', ev)
		}

		// focusing

		let inh_focus = e.focus
		let focusing_picker
		e.focus = function() {
			if (e.isopen) {
				focusing_picker = true // focusout barrier.
				e.picker.focus()
				focusing_picker = false
			} else
				inh_focus.call(this)
		}

		// clicking outside the picker closes the picker.
		function document_pointerdown(ev) {
			// TODO: this is brittle because ev.target could be replaced on click
			// so by the time we get here ev.target has no parent!
			if (e.contains(ev.target)) // clicked inside the dropdown.
				return
			if (e.picker.contains(ev.target)) // clicked inside the picker.
				return
			e.close()
		}

		// clicking outside the picker closes the picker, even if the click did something.
		function document_stopped_event(ev) {
			if (ev.type.ends('pointerdown'))
				document_pointerdown(ev)
		}

		e.on('focusout', function(ev) {
			// prevent dropdown's focusout from bubbling to the parent when opening the picker.
			if (focusing_picker)
				return false
			e.fire('lost_focus') // grid editor protocol
		})

		// scrolling through values with the wheel with the picker closed.

		e.on('wheel', function(ev, dy) {
			e.picker.pick_near_val(dy, {input: e})
			return false
		})

		// cancelling on hitting Escape.

		function picker_keydown(key) {
			if (key == 'Escape') {
				e.cancel()
			}
		}

		if (!has_input) {

			// use the entire surface of the dropdown for toggling.
			e.on('pointerdown', function() {
				e.toggle(true)
				return false
			})

			e.on('keypress', function(c) {
				if (e.picker.quicksearch) {
					e.picker.quicksearch(c)
					return false
				}
			})

			e.on('keydown', function(key) {

				if (key == 'ArrowDown' || key == 'ArrowUp') {
					if (!e.hasclass('grid-editor')) {
						e.set_open(true, false, true)
						e.picker.pick_near_val(key == 'ArrowDown' ? 1 : -1, {input: e})
						return false
					}
				}

				if (key == 'Delete' && e.input_val != null) {
					e.set_val(null, {input: e})
					return false
				}

			})

		} else {

			// use the entire surface of the dropdown to close the popup.
			e.on('pointerdown', function(ev) {
				// clos dropdown but prevent selecting the text if clicked on it.
				let on_input = ev.target == e.input
				e.close(!on_input)
			})

		}

		// keyboard & mouse binding

		e.on('keydown', function(key) {
			if (key == 'Enter' || (!has_input && key == ' ')) {
				e.toggle(true)
				return false
			}
		})

	} else {

		e.set_open = noop

	}

	e.property('isopen',
		function() {
			return e.hasclass('open')
		},
		function(open) {
			e.set_open(open, true)
		}
	)

	e.open   = function(focus) { e.set_open(true, focus) }
	e.close  = function(focus) { e.set_open(false, focus) }
	e.toggle = function(focus) { e.set_open(!e.isopen, focus) }
	e.cancel = function() {
		if (e.isopen)
			e.set_val(e.cancel_val, {input: this})
		e.close(true)
	}

	return cons_opt
}

// ---------------------------------------------------------------------------
// textedit
// ---------------------------------------------------------------------------

widget('textedit', 'Input', function(e) {
	return editbox_widget(e)
})

// ---------------------------------------------------------------------------
// lineedit
// ---------------------------------------------------------------------------

css('.lineedit', 'S')

css('.lineedit .focus-box', 'S p-r-0')

css('textarea.editbox-input', '', `
	resize: none;
	padding-right: var(--padding-x-input);
	overflow-y: overlay; /* Chrome only */
	overflow-x: overlay; /* Chrome only */
	cursor: auto;
`)

css('.lineedit .editbox-input', '', `
	align-self: stretch;
`)

css('.lineedit[nowrap]', 'pre', `
	white-space: pre;
	overflow-wrap: normal; /* already default! */
`)

widget('lineedit', 'Input', function(e) {
	let cons_opt = editbox_widget(e, {input_tag: 'textarea'})
	e.do_after('init', function() {
		e.input.rows = e.rows
		e.input.cols = e.cols
	})
	return cons_opt
})

// ---------------------------------------------------------------------------
// passedit
// ---------------------------------------------------------------------------

css('.btn.passedit-eye-icon .btn-focus-box', 'p-r-0')

css('.passedit-eye-icon .btn-icon', 'w1')

widget('passedit', 'Input', function(e) {

	let cons_opt = editbox_widget(e)
	e.input.attr('type', 'password')

	e.on_bind(function(on) {
		if (on && !e.view_password_button) {
			e.view_password_button = button({
				classes: 'passedit-eye-icon',
				icon: 'far fa-eye-slash',
				text: '',
				bare: true,
				focusable: false,
				title: S('view_password', 'View password'),
			})
			e.focus_box.add(e.view_password_button)
			e.view_password_button.on('active', function(on) {
				let s1 = e.input.selectionStart
				let s2 = e.input.selectionEnd
				e.input.attr('type', on ? null : 'password')
				this.icon = 'far fa-eye' + (on ? '' : '-slash')
				if (!on) {
					runafter(0, function() {
						e.input.selectionStart = s1
						e.input.selectionEnd   = s2
					})
				}
			})
		}
	})

	return cons_opt
})

// ---------------------------------------------------------------------------
// numedit
// ---------------------------------------------------------------------------

widget('numedit', 'Input', function(e) {

	e.props.align = {default: 'right'}
	e.field_attrs = {type: 'number'}

	let cons_opt = editbox_widget(e)

	e.on_update(function(opt) {
		if (opt.select_all)
			e.input.select_range(0, -1)
	})

	e.increment_val = function(increment) {
		let v = e.input_val + increment
		let m = or(1 / 10 ** (e._field.decimals || 0), 1)
		let r = v % m
		e.set_val(v - r, {input: e})
		e.update({select_all: true})
	}

	e.input.on('wheel', function(ev, dy) {
		e.increment_val(dy)
		return false
	})

	return cons_opt
})

// ---------------------------------------------------------------------------
// spinedit
// ---------------------------------------------------------------------------

css('.spinedit-btn', 'hidden p-x-input')

css('.spinedit-btn.left ', 'show b-r')
css('.spinedit-btn.right', 'show b-l')

css(`
	.spinedit-btn.fa-plus,
	.spinedit-btn.fa-minus
`, 'small', `
	align-self: center;
`)
css('.spinedit-btn.fa-minus.leftmost', '', `padding-left  : calc(1.428 * var(--padding-x-input)); `)
css('.spinedit-btn.fa-plus.rightmost', '', `padding-right : calc(1.428 * var(--padding-x-input)); `)

css('.spinedit-btn.fa-caret-left ', '', ` padding-right : calc(.5 * var(--padding-x-input)); `)
css('.spinedit-btn.fa-caret-right', '', ` padding-left  : calc(.5 * var(--padding-x-input)); `)

// inner label adjustments

css_state('.spinedit:is([button_placement=left], [button_placement=each-side]) .editbox-label.empty', '', `
	padding-left: 2em;
`)

css_state('.spinedit[button_style=left-right]:is([button_placement=left], [button_placement=each-side]) .editbox-label.empty', '', `
	padding-left: 1.5em;
`)

css(`
	.spinedit.with-label .spinedit-btn.fa-plus,
	.spinedit.with-label .spinedit-btn.fa-minus
`, '', `
	align-self: baseline;
`)

widget('spinedit', 'Input', function(e) {

	let cons_opt = numedit.construct(e)

	e.prop('button_style'    , {type: 'enum', enum_values: 'plus-minus up-down left-right', default: 'plus-minus', attr: true})
	e.prop('button_placement', {type: 'enum', enum_values: 'each-side left right', default: 'each-side', attr: true})

	e.up   = div({class: 'spinedit-btn fa'})
	e.down = div({class: 'spinedit-btn fa'})

	e.on_update(function(opt) {

		let bs = e.button_style
		let bp = e.button_placement

		bp = bp || (bs == 'up-down' && 'left' || 'each-side')

		e.up  .remove()
		e.down.remove()

		e.up  .class('fa-plus'       , bs == 'plus-minus')
		e.down.class('fa-minus'      , bs == 'plus-minus')
		e.up  .class('fa-caret-up'   , bs == 'up-down')
		e.down.class('fa-caret-down' , bs == 'up-down')
		e.up  .class('fa-caret-right', bs == 'left-right')
		e.down.class('fa-caret-left' , bs == 'left-right')

		e.up  .class('left right leftmost rightmost', false)
		e.down.class('left right leftmost rightmost', false)

		if (bp == 'each-side') {
			e.focus_box.insert(0, e.down)
			e.focus_box.add(e.up)
			e.down.class('left  leftmost')
			e.up  .class('right rightmost')
		} else if (bp == 'right') {
			e.focus_box.add(e.down, e.up)
			e.down.class('right')
			e.up  .class('right rightmost')
		} else if (bp == 'left') {
			e.focus_box.insert(0, e.down, e.up)
			e.down.class('left leftmost')
			e.up  .class('left')
		}

	})

	let multiple = () => or(1 / 10 ** (e._field.decimals || 0), 1)

	// increment buttons click

	let increment
	function increment_val_again() {
		// if (!e.matches(':active'))
		// 	return // prevent infinite loop if mouse capture fails.
		let v = e.input_val + increment
		let r = v % multiple()
		e.set_val(v - r, {input: e})
		e.update({select_all: true})
		increment_timer(.1)
	}
	let increment_timer = timer(increment_val_again)
	function add_events(button, sign) {
		button.on('pointerdown', function(ev) {
			e.input.focus()
			increment = multiple() * sign
			increment_val_again()
			increment_timer(.5)
			return this.capture_pointer(ev, null, function() {
				increment_timer()
				return false
			})
		})
	}
	add_events(e.up  , 1)
	add_events(e.down, -1)

	e.on('keydown', function(key) {
		if (key == 'ArrowDown' || key == 'ArrowUp') {
			if (!e.hasclass('grid-editor')) {
				let inc = (key == 'ArrowDown' ? 1 : -1) * multiple()
				e.increment_val(inc)
				return false
			}
		}
	})

	return cons_opt
})

// ---------------------------------------------------------------------------
// tagsedit
// ---------------------------------------------------------------------------

css('.tagsedit', '', `
	width: auto;
	min-width: 1em;
`)

css('.tagsedit-tags-box', 'h-bl flex-wrap clip p-x')

css('.tagsedit-input', '', `
	min-width: 0;
	width: 3em;
	padding: 2px 0; /* reset */
	height: auto; /* reset */
	flex: 1 1 auto;
	line-height: 1;
`)

css('.tagsedit-button-expand', 'p-r')

css('.tagsedit-bubble', 'click-through-off')

css('.tagsedit-tag', 'b ro-05 bg1 p-x-05 clip', `
	display: inline;
	padding-top    : 3px;
	padding-bottom : 2px;
	margin: 1px .1em;
	line-height: 1;
`)

css('.tagsedit-tag-xbutton', 'dim', `
	padding-left : .4em;
	padding-right: .2em;
	font-size: 70%;
	align-self: center;
`)

// fixed height mode

css('.tagsedit.with-label[mode=fixed]', '', `
	min-height: var(--min-height-input);
`)

css('.tagsedit[mode=fixed] .tagsedit-tags-box', 'flex-nowrap')

css(`
	.tagsedit[mode=fixed] .tagsedit-tag,
	.tagsedit-bubble .tagsedit-tag
`, 'flex-nowrap nowrap')

css_state('.tagsedit.invalid .tagsedit-tag', '', `
	background-color: var(--bg-focused-error);
`)

css_state('.tagsedit.invalid .tagsedit-tag-xbutton', 'dim-on-dark')

css_state('.tagsedit:not([disabled]) .tagsedit-tag:hover', 'bg2')

css_state('.tagsedit:not([disabled]) .tagsedit-tag:hover .tagsedit-tag-xbutton', '', `
	color: inherit;
`)

css_state('.tagsedit:not([disabled]).invalid .tagsedit-tag:hover .tagsedit-tag-xbutton', 'fg-error')

widget('tagsedit', 'Input', function(e) {

	e.class('editbox')

	e.field_attrs = {type: 'tags'}

	val_widget(e)
	let cons_opt = input_widget(e)

	let S_expand = S('expand', 'expand') + ' (Enter)'
	let S_condense = S('condense', 'condense') + ' (Enter)'

	e.input = tag('input', {class: 'editbox-input tagsedit-input'})
	e.label_box = div({class: 'editbox-label tagsedit-label'})
	e.expand_button = div({class: 'tagsedit-button-expand fa fa-caret-down',
		title: S_expand,
	})
	e.tags_box = div({class: 'tagsedit-tags-box'})
	e.focus_box = div({class: 'focus-box'}, e.input, e.label_box, e.tags_box, e.expand_button)
	e.add(e.focus_box)

	function input_val_slice() {
		let v = e.input_val
		v = isstr(v) ? v.words() : v
		return v == null ? [] : v.slice()
	}

	function set_val(v, ev) {
		v = v.remove_duplicates()
		v = e._field.tags_format == 'words' ? v.join(' ') : v
		v = v.length ? v : null
		e.set_val(v, ev)
	}

	function update_tags() {

		let v = input_val_slice()
		let empty = !v.length

		if (empty && e.expanded) {
			e.expanded = false
			return
		}

		e.tags_box.clear()
		if (v) {
			for (let tag of v) {
				let s = T(tag).textContent
				let xb = div({
					class: 'tagsedit-tag-xbutton fa fa-times',
					title: S('remove', 'remove {0}', s),
				})
				let tag_e = div({
					class: 'tagsedit-tag',
					title: S('edit', 'edit {0}', s),
				}, tag, xb)
				xb.on('pointerdown', tag_xbutton_pointerdown)
				tag_e.on('pointerdown', tag_pointerdown)
				e.tags_box.add(tag_e)
			}
		}

		if (e.expanded) {
			e.bubble.text = null
			e.bubble.text = e.tags_box
		} else {
			e.focus_box.insert(2, e.tags_box)
		}

		e.class('empty', empty)
	}

	e.do_update_val = function(v, ev) {
		let by_user = ev && ev.input == e
		update_tags()
		if (empty && by_user)
			e.input.focus()
		else
			e.input.value = null

		e.input.attr('maxlength', e._field ? e._field.maxlen : null)
	}

	// expanded bubble.

	e.set_expanded = function(expanded) {
		if (!input_val_slice().length)
			expanded = false
		e.class('expanded', expanded)
		e.expand_button.switch_class('fa-caret-down', 'fa-caret-up', expanded)
		if (expanded && !e.bubble) {
			e.bubble = tooltip({classes: 'tagsedit-bubble', side: 'top', align: 'left'})
			e.add(e.bubble)
		}
		update_tags()
		if (e.bubble)
			e.bubble.hidden = !expanded
		e.expand_button.title = expanded ? S_condense : S_expand
	}
	e.prop('expanded', {private: true})

	e.expand_button.on('pointerdown', function(ev) {
		e.expanded = !e.expanded
	})

	// controller

	function tag_pointerdown() {
		let v = input_val_slice()
		let tag = v.remove(this.index)
		set_val(v, {input: e})
		e.input.value = tag
		e.focus()
		e.input.select()
		return false
	}

	function tag_xbutton_pointerdown() {
		let v = input_val_slice()
		v.remove(this.parent.index)
		set_val(v, {input: e})
		return false
	}

	e.make_focusable(e.input)

	e.input.on('blur', function() {
		e.expanded = false
	})

	e.on('pointerdown', function(ev) {
		if (ev.target == e.input)
			return
		e.focus()
		return false
	})

	e.input.on('keydown', function(key, shift, ctrl) {
		if (key == 'Enter') {
			let s = e.input.value
			if (s) {
				s = s.trim()
				if (s) {
					let v = input_val_slice()
					v.push(s)
					set_val(v, {input: e})
				}
				e.input.value = null
			} else {
				e.expanded = !e.expanded
			}
			return false
		}
		if (key == 'Backspace' && !e.input.value) {
			set_val(input_val_slice().slice(0, -1), {input: e})
			return false
		}
	})

	// grid editor protocol

	e.input.on('blur', function() {
		e.fire('lost_focus')
	})

	e.set_text_min_w = function(w) {
		// TODO:
	}

	return cons_opt
})

// ---------------------------------------------------------------------------
// google maps APIs wrappers
// ---------------------------------------------------------------------------

{
	let api_key
	let autocomplete_service
	let session_token, token_expire_time
	let token_duration = 2 * 60  // google says it's "a few minutes"...

	function google_maps_iframe(place_id) {
		let iframe_src = place_id => place_id
			? ('https://www.google.com/maps/embed/v1/place?key='+api_key+'&q=place_id:'+place_id) : ''
		let iframe = tag('iframe', {
			frameborder: 0,
			scrolling: 'no',
			src: iframe_src(place_id),
			allowfullscreen: '',
		})
		iframe.goto_place = function(place_id) {
			iframe.src = iframe_src(place_id)
		}
		return iframe
	}

	/* TODO: finish this...
	function google_maps_wrap_map(e) {
		let map = new google.maps.Map(e, {
			center: { lat: -34.397, lng: 150.644 },
			zoom: 8,
		})

		map.goto_place = function(place_id) {
			if (!place.geometry) {
				return;
			}
			if (place.geometry.viewport) {
				map.fitBounds(place.geometry.viewport);
			} else {
				map.setCenter(place.geometry.location);
				map.setZoom(17)
			}
			// Set the position of the marker using the place ID and location.
			marker.setPlace({
			placeId: place.place_id,
			location: place.geometry.location,
			});
			marker.setVisible(true);
			infowindowContent.children.namedItem("place-name").textContent = place.name;
			infowindowContent.children.namedItem("place-id").textContent =
			place.place_id;
			infowindowContent.children.namedItem("place-address").textContent =
			place.formatted_address;
			infowindow.open(map, marker);

		}
	}
	*/

	function suggest_address(s, callback) {

		if (!autocomplete_service)
			return

		function get_places(places, status) {
			let pss = google.maps.places.PlacesServiceStatus
			if (status == pss.ZERO_RESULTS)
				notify(S('google_maps_address_not_found', 'Address not found on Google Maps'), 'search')
			if (status != pss.OK && status != pss.ZERO_RESULTS)
				notify(S('google_maps_error', 'Google Maps error: {0}', status))
			callback(places)
		}

		let now = time()
		if (!session_token || token_expire_time < now) {
			session_token = new google.maps.places.AutocompleteSessionToken()
			token_expire_time = now + token_duration
		}

		autocomplete_service.getPlacePredictions({input: s, sessionToken: session_token}, get_places)
	}

	function _google_places_api_loaded() {
		autocomplete_service = new google.maps.places.AutocompleteService()
		document.fire('google_places_api_loaded')
	}

	init_google_places_api = function(_api_key) {
		api_key = _api_key
		document.head.add(tag('script', {
			defer: '',
			src: 'https://maps.googleapis.com/maps/api/js?key='+api_key+'&libraries=places&callback=_google_places_api_loaded'
		}))
		init_google_places_api = noop // call-once
	}

}

// ---------------------------------------------------------------------------
// placeedit widget with autocomplete via google places api
// ---------------------------------------------------------------------------

css('.placepin', 'm-r')

css_state('.placepin.disabled', 'arrow', `
	opacity: .3;
`)

widget('placeedit', 'Input', function(e) {

	e.field_attrs = {type: 'place'}

	let cons_opt = editbox_widget(e)

	e.pin_ct = span()
	e.focus_box.insert(0, e.pin_ct)

	e.create_picker = function(opt) {

		let lb = listbox(assign_opt({
			val_col: 0,
			display_col: 0,
			format_item: format_item,
		}, opt))

		return lb
	}

	function format_item(addr) {
		return addr.description
	}

	function suggested_addresses_changed(places) {
		places = places || []
		e.picker.items = places.map(function(p) {
			return {
				description: p.description,
				place_id: p.place_id,
				types: p.types,
			}
		})
		e.isopen = !!places.length
	}

	e.property('place_id', function() {
		return isobject(e.val) && e.val.place_id || null
	})

	e.from_text = function(s) { return s ? s : null }
	e.to_text = function(v) { return (isobject(v) ? v.description : v) || '' }

	e.do_after('do_update_val', function(v, ev) {
		let pin = e._field && e._field.format_pin(v)
		e.pin_ct.set(pin)
		if (e.val && !e.place_id)
			pin.title = S('find_place', 'Find this place on Google Maps')
		if (ev && ev.input == e && ev.typing) {
			if (v)
				suggest_address(v, suggested_addresses_changed)
			else
				suggested_addresses_changed()
		}
	})

	e.pin_ct.on('pointerdown', function() {
		if (e.val && !e.place_id) {
			suggest_address(e.val, suggested_addresses_changed)
			return false
		}
	})

	return cons_opt
})

// ---------------------------------------------------------------------------
// google maps widget
// ---------------------------------------------------------------------------

css('.googlemaps', 'h-c h-m dim bg1', `

	/* layout self */
	min-height: calc(var(--min-height-input) * 2 + var(--space-s));

	/* layout map icon */
	display: flex !important; /* override fontawesome !important */
`)

css('.googlemaps::before', '', `
	font-size: 2em !important; /* override fontawesome !important */
`)

css('.googlemaps-iframe', 'abs shrinks', `
	width: 100%;
	height: 100%;
`)

widget('googlemaps', 'Input', function(e) {

	e.field_attrs = {type: 'place'}

	val_widget(e)

	e.classes = 'fa fa-map-marked-alt'

	e.map = google_maps_iframe()
	e.map.class('googlemaps-iframe')
	e.add(e.map)

	e.override('do_update_val', function(inherited, v, ev) {
		inherited.call(this, v, ev)
		let place_id = isobject(v) && v.place_id || null
		e.map.goto_place(place_id)
		e.map.class('empty', !place_id)
	})

})

// ---------------------------------------------------------------------------
// slideedit
// ---------------------------------------------------------------------------

// reset editbox
css('.slideedit .focus-box', 'b-invisible no-bg')

css('.editbox.slideedit .focus-box', 'b-invisible no-bg')

css('.slideedit-box', 'S t-m noclip rel', `
	margin: .75em;
	min-width: 8em;
	height: 4px;
`)

css('.slideedit-fill', 'abs round', `
	height: 100%;
`)

css('.slideedit-range-fill', 'bg1', `
	height: 3px;
`)

css('.slideedit-thumb', 'abs round', `
	/* center vertically relative to the fill */
	position: absolute;
	margin-top : calc(-.6em + 2px);
	margin-left: calc(-.6em);
	width: 1.2em;
	height: 1.2em;
	box-shadow: var(--shadow-slideedit-thumb);
`)

css('.slideedit-value-fill, .slideedit-thumb', 'bg-link')

css_state('.editbox.slideedit.modified > .focus-box', 'no-bg')

css_state('.slideedit-input-thumb:focus-visible', 'no-shadow', `
	outline: 6px solid var(--outline-markbox-focused);
`)

css_state('.slideedit-focus-box:focus-within', 'no-outline')

css_state('.slideedit-value-thumb.different', 'dim')

css_state('.slideedit-focus-box:focus-within .slideedit-value-fill', '', `
	background-color: var(--bg-focused-selected);
`)

css_state('.slideedit-focus-box:focus-within .slideedit-thumb', '', `
	background-color: var(--bg-focused-selected);
`)

css_state('.slideedit.invalid .slideedit-input-thumb', '', `
	border-color: var(--bg-error);
	background: var(--bg-error);
`)

css_state('.slideedit.animated .slideedit-thumb     ', '', `transition: left  .1s;`)
css_state('.slideedit.animated .slideedit-value-fill', '', `transition: width .1s;`)

widget('slideedit', 'Input', function(e) {

	e.field_attrs = {type: 'number', decimals: 1}

	val_widget(e)
	let cons_opt = input_widget(e)
	e.class('editbox')

	e.prop('from', {type: 'number', default: 0})
	e.prop('to'  , {type: 'number', default: 1})

	e.label_box   = div({class: 'editbox-label'})
	e.val_fill    = div({class: 'slideedit-fill slideedit-value-fill'})
	e.range_fill  = div({class: 'slideedit-fill slideedit-range-fill'})
	e.input_thumb = div({class: 'slideedit-thumb slideedit-input-thumb'})
	e.val_thumb   = div({class: 'slideedit-thumb slideedit-value-thumb'})
	e.slideedit_box  = div({class: 'slideedit-box'},
			e.range_fill, e.val_fill, e.val_thumb, e.input_thumb)
	e.focus_box   = div({class: 'focus-box'}, e.label_box, e.slideedit_box)
	e.add(div({class: 'linear-form-filler'}), e.focus_box)

	e.make_focusable(e.input_thumb)

	// model

	e.on_update(function() {
		e.class('animated', false) // TODO: decide when to animate!
	})

	function progress_for(v) {
		return clamp(lerp(v, e.from, e.to, 0, 1), 0, 1)
	}

	function cmin() { return max(or(e._field && e._field.min, -1/0), e.from) }
	function cmax() { return min(or(e._field && e._field.max,  1/0), e.to  ) }

	let multiple = () => or(1 / 10 ** e._field.decimals, 1)

	e.set_progress = function(p, ev) {
		let v = lerp(p, 0, 1, e.from, e.to)
		if (e._field.decimals != null)
			v = floor(v / multiple() + .5) * multiple()
		e.set_val(clamp(v, cmin(), cmax()), ev)
	}

	e.property('progress',
		function() {
			return progress_for(e.input_val)
		},
		e.set_progress,
	)

	// view

	function update_thumb(thumb, p, show) {
		thumb.hide(show == false)
		thumb.style.left = (p * 100)+'%'
	}

	function update_fill(fill, p1, p2) {
		fill.style.left  = (p1 * 100)+'%'
		fill.style.width = ((p2 - p1) * 100)+'%'
	}

	e.do_update_val = function(v) {
		let input_p = progress_for(v)
		let val_p = progress_for(e.input_val)
		let diff = input_p != val_p
		update_thumb(e.val_thumb, val_p, diff)
		update_thumb(e.input_thumb, input_p)
		e.val_thumb  .class('different', diff)
		e.input_thumb.class('different', diff)
		let p1 = progress_for(cmin())
		let p2 = progress_for(cmax())
		update_fill(e.val_fill, max(p1, 0), min(p2, val_p))
		update_fill(e.range_fill, p1, p2)
		if (e.tooltip)
			e.tooltip.text = e.display_val_for(v)
	}

	e.do_after('do_update_errors', function() {
		if (!e.error_tooltip) return
		e.error_tooltip.target = e.input_thumb
		e.error_tooltip.align = 'center'
	})

	// controller

	e.slideedit_box.on('pointerdown', function(ev, mx) {
		e.focus()
		let r = this.rect()
		if (!e.tooltip) {
			e.tooltip = tooltip()
			e.input_thumb.add(e.tooltip)
		} else
			e.input_thumb.add(e.tooltip)
		e.tooltip.text = e.display_val_for(e.input_val)
		function pointermove(ev, mx) {
			e.set_progress((mx - r.x) / r.w, {input: e})
		}
		pointermove(ev, mx)
		return this.capture_pointer(ev, pointermove, function() {
			e.tooltip.remove()
		})
	})

	e.on('keydown', function(key, shift) {
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
			e.set_progress(e.progress + d * (shift ? .1 : 1), {input: e})
			return false
		}
	})

	return cons_opt

})

// ---------------------------------------------------------------------------
// calendar widget
// ---------------------------------------------------------------------------

css('.calendar', 'h noselect p-4')

css('.calendar-header, .calendar-timeview', 'h-m', `
	align-self: start;
	min-height: 3.5em;
`)

css('.calendar-header', '', `
	justify-content: space-between;
`)

css('.calendar-timebox', 'm-l p-l b b-dotted')

css('.calendar-weekview', '', `
	width: 100%;
	border-spacing: 0;
`)

css('.calendar-weekday', 'dim', `
	font-weight: normal;
`)

css([
	'.calendar-day',
	'.calendar-weekday',
], 'small t-c p')

css('.calendar-day', 'arrow')

css('.calendar-sel-day-box', 'h w4')

css('.calendar-sel-day', '', `
	font-size: 250%;
`)

css('.calendar-sel-day-suffix', 'S p-t-05', `
	font-size: 150%;
	padding-left: .1em;
	align-self: flex-start;
`)

css([
	'.calendar-sel-month',
	'.calendar-sel-year',
], 'b0')

css('.calendar-sel-year', 'm-l', `
	width: 8em;
`)

css('.calendar-sel-year .editbox-input', '', `
	max-width: 2.5em;
`)

css('.calendar-sel-month-picker', 'bg2')

css('.calendar-month-box', 'h')

css('.calendar-month-num', 't-r', `
	min-width: 1.25em;
	margin-right: .75em;
`)

css('.calendar-sel-year .focus-box', '', `
	justify-content: space-between;
`)

css('.calendar-month-name', '', `
	min-width: 2.5em;
`)

css_state('.calendar-sel-day:empty::before', 'zwsp')
css_state('.calendar-sel-day-suffix:empty::before', 'zwsp')
css_state('.calendar-day:empty::before', 'zwsp')

css('.calendar-sel-hms', '', `
	min-width: 0;
	width: 2.5em;
`)

css_state('.calendar-day:not(.current-month)'        , 'dim')
css_state('.calendar-day.today'                      , '', ` outline: 1px dashed var(--bg-today); `)
css_state('.calendar .calendar-day.today:hover'    , '', ` background-color: var(--bg-today); `)
css_state('.calendar.invalid .calendar-day.focused', '', ` background-color: var(--bg-error); `)

css_state('.calendar-month-box:not(.focused) .calendar-month-num', 'dim')

// calendar as picker --------------------------------------------------------

css_role('.calendar.picker', '', `
	padding: 1.5em;
	min-width: auto !important; /* because it is set in code by the dropdown */
`)

css_role('.calendar.picker .calendar-sel-day', 'xlarge')

css_role('.calendar.picker .calendar-sel-day-suffix', 'p-t-0')

css_role('.calendar.picker .calendar-day', 'p-y-05')

widget('xcalendar', 'Input', function(e) {

	val_widget(e)
	e.make_focusable()

	function format_month(v) {
		return div({class: 'calendar-month-box'},
			span({class: 'calendar-month-num'}, v),
			span({class: 'calendar-month-name'}, month_name(time(0, v), 'short', lang()))
		)
	}

	e.sel_day = div({class: 'calendar-sel-day'})
	e.sel_day_suffix = div({class: 'calendar-sel-day-suffix'})

	e.sel_month = list_dropdown({
		classes: 'calendar-sel-month',
		picker_classes: 'calendar-sel-month-picker',
		items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
		field: {
			format: format_month,
			not_null: true,
		},
		val_col: 0,
		item_field: {
			format: format_month,
		},
	})

	e.sel_year = spinedit({
		classes: 'calendar-sel-year',
		field: {
			// MySQL range for DATETIME
			min: 1000,
			max: 9999,
			not_null: true,
		},
		button_style: 'left-right',
	})

	e.sel_hour = spinedit({
		classes: 'calendar-sel-hms',
		field: {
			min: 0,
			max: 24,
			not_null: true,
		},
		button_style: 'up-down',
		button_placement: 'none',
	})

	e.sel_minute = spinedit({
		classes: 'calendar-sel-hms',
		field: {
			min: 0,
			max: 60,
			not_null: true,
		},
		button_style: 'up-down',
		button_placement: 'none',
	})

	e.sel_second = spinedit({
		classes: 'calendar-sel-hms',
		field: {
			min: 0,
			max: 60,
			not_null: true,
		},
		button_style: 'up-down',
		button_placement: 'none',
	})

	e.header = div({class: 'calendar-header'},
		div({class: 'calendar-sel-day-box'}, e.sel_day, e.sel_day_suffix), e.sel_month, e.sel_year)

	e.weekview = tag('table', {class: 'calendar-weekview focusable-items',
		tabindex: 0})

	e.timeview = tag('div', {class: 'calendar-timeview'},
		e.sel_hour, ':', e.sel_minute, span(0, ':'), e.sel_second)

	e.datebox = div({class: 'calendar-datebox'}, e.header, e.weekview)
	e.timebox = div({class: 'calendar-timebox'}, e.timeview)

	e.add(e.datebox, e.timebox)

	e.on('bind_field', function(on) {
		if (on) {
			e.timebox.hidden = !(e._field.has_time || false)
			for (let ce of [e.timebox.last.prev, e.timebox.last])
				ce.hidden = !(e._field.has_seconds || false)
		}
	})

	e.on('focus', function() {
		e.weekview.focus()
	})

	function as_ts(v) {
		return e._field && e._field.to_time ? e._field.to_time(v) : v
	}

	function daytime(t) {
		return t != null ? t - day(t) : null
	}

	function as_dt(t) {
		return e._field.from_time ? e._field.from_time(t) : t
	}

	function update_sel_day(t) {
		if (t != null) {
			let n = floor(1 + days(t - month(t)))
			e.sel_day.set(n)
			let day_suffixes = ['', 'st', 'nd', 'rd']
			e.sel_day_suffix.set(lang() == 'en' ?
				(n < 11 || n > 13) && day_suffixes[n % 10] || 'th' : '')
		} else {
			e.sel_day.html = ''
			e.sel_day_suffix.html = ''
		}
		e.sel_day.bool_attr('disabled', t == null || null)
	}

	let start_week

	let glue_week = window.week
	function week(t, offset) {
		return glue_week(t, offset, country())
	}

	function focused_month(t) {
		return month(week(t, 2))
	}

	function update_weekview(new_start_week, sel_t) {

		let weeks = 6
		let sel_d = day(sel_t)
		let sel_m = month(sel_d)
		let cur_m = focused_month(new_start_week)

		update_sel_day(sel_d)

		if (start_week == new_start_week) {
			for (let td of e.weekview.$('td'))
				td.class('focused selected', false)
			for (let td of e.weekview.$('td'))
				if (td.day == sel_d)
					td.class('focused selected', true)
			return
		}

		start_week = new_start_week
		e.weekview.clear()
		let d = start_week
		let cur_d = day(time())
		for (let week = 0; week <= weeks; week++) {
			let tr = tag('tr')
			for (let weekday = 0; weekday < 7; weekday++) {
				if (!week) {
					let th = tag('th', {class: 'calendar-weekday'},
						d != null ? weekday_name(day(d, weekday), 'short', lang())[0] : '?')
					tr.add(th)
				} else {
					let s, n
					if (d != null) {
						let m = month(d)
						s = d == cur_d ? ' today' : ''
						s = s + (m == cur_m ? ' current-month' : '')
						s = s + (d == sel_d ? ' focused selected' : '')
						n = floor(1 + days(d - m))
					} else {
						s = ''
						n = '??'
					}
					let td = tag('td', {class: 'calendar-day item'+s}, n)
					td.day = d
					tr.add(td)
					d = day(d, 1)
				}
			}
			e.weekview.add(tr)
		}

	}

	function update_ym(t) {
		e.sel_month.reset_val(month_of(t))
		e.sel_year .reset_val( year_of(t))
	}

	function update_hms(t) {
		e.sel_hour.val = hours_of(t)
		e.sel_minute.val = minutes_of(t)
		e.sel_second.val = seconds_of(t)
	}

	function update_view(t) {
		let ct = or(t, time()) // calendar view time
		update_weekview(week(month(ct)), t)
		update_ym(ct)
		update_hms(t)
	}

	e.do_update_val = function(v, ev) {
		assert(e.bound)
		if (ev && ev.input == e)
			return
		let t = as_ts(v) // selected time
		update_view(t)
	}

	// controller

	function set_ts(t, update_view_too, val_picked) {
		e.set_val(as_dt(t), {input: e, val_picked: val_picked})
		if (update_view_too)
			update_view(t)
	}

	e.weekview.on('pointerdown', function(ev) {
		let d = ev.target.day
		if (d == null)
			return
		e.sel_month.close()
		e.focus()
		update_weekview(start_week, d)
		update_ym(d)
		return this.capture_pointer(ev, null, function() {
			set_ts(d + daytime(as_ts(e.input_val)), null, true)
			e.fire('val_picked') // picker protocol
			return false
		})
	})

	e.sel_month.on('input_val_changed', function(v, ev) {
		if (!(ev && ev.input))
			return
		let t = as_ts(e.input_val)
		let ct
		if (t != null) {
			t = set_month(t, v)
			ct = week(month(t))
			set_ts(t)
		} else {
			let y = e.sel_year.input_val
			let m = v
			ct = y != null && m != null ? week(time(y, m)) : null
		}
		update_weekview(ct, t)
	})

	e.sel_year.on('input_val_changed', function(v, ev) {
		if (!(ev && ev.input))
			return
		let t = as_ts(e.input_val)
		if (t != null) {
			t = set_year(t, v)
			ct = week(month(t))
			set_ts(t)
		} else {
			let y = v
			let m = e.sel_month.input_val
			ct = y != null && m != null ? week(time(y, m)) : null
		}
		update_weekview(ct, t)
	})

	e.sel_hour.on('input_val_changed', function(v, ev) {
		if (!(ev && ev.input))
			return
		let t = as_ts(e.input_val)
		if (t != null) {
			t = set_hours(t, v)
			set_ts(t)
		}
	})

	e.sel_minute.on('input_val_changed', function(v, ev) {
		if (!(ev && ev.input))
			return
		let t = as_ts(e.input_val)
		if (t != null) {
			t = set_minutes(t, v)
			set_ts(t)
		}
	})

	e.sel_second.on('input_val_changed', function(v, ev) {
		if (!(ev && ev.input))
			return
		let t = as_ts(e.input_val)
		if (t != null) {
			t = set_seconds(t, v)
			set_ts(t)
		}
	})

	e.weekview.on('wheel', function(ev, dy) {
		let t = as_ts(e.input_val)
		let ct = or(week(start_week, dy), week(month(or(t, time()))))
		update_weekview(ct, t)
		update_ym(focused_month(ct))
		return false
	})

	e.weekview.on('keydown', function(key, shift) {
		let d, m
		switch (key) {
			case 'ArrowLeft'  : d = -1; break
			case 'ArrowRight' : d =  1; break
			case 'ArrowUp'    : d = -7; break
			case 'ArrowDown'  : d =  7; break
			case 'PageUp'     : m = -1; break
			case 'PageDown'   : m =  1; break
		}
		let t = as_ts(e.input_val)
		if (d) {
			let dt = daytime(t) || 0
			set_ts(or(day(t, d), day(time())) + dt, true)
			return false
		}
		if (m) {
			let dt = t != null ? t - month(t) : 0
			set_ts(or(month(t, m), month(time())) + dt, true)
			return false
		}
		if (key == 'Home') {
			let dt = daytime(t) || 0
			set_ts((shift ? year(or(t, time())) : month(or(t, time()))) + dt, true)
			return false
		}
		if (key == 'End') {
			let dt = daytime(t) || 0
			set_ts((day(shift ? year(or(t, time()), 1) : month(or(t, time()), 1), -1)) + dt, true)
			return false
		}
		if (key == 'Enter') {
			e.fire('val_picked', {input: e}) // picker protocol
			return false
		}
	})

	function pick_on_enter(key) {
		if (key == 'Enter') {
			e.fire('val_picked', {input: e}) // picker protocol
			return false
		}
	}
	e.weekview  .on('keydown', pick_on_enter)
	e.sel_month .on('keydown', pick_on_enter)
	e.sel_year  .on('keydown', pick_on_enter)
	e.sel_hour  .on('keydown', pick_on_enter)
	e.sel_minute.on('keydown', pick_on_enter)
	e.sel_second.on('keydown', pick_on_enter)


	e.pick_near_val = function(delta, ev) {
		let dt = daytime(as_ts(e.input_val)) || 0
		set_ts(day(or(as_ts(e.input_val), time()), delta) + dt)
		e.fire('val_picked', ev)
	}

	e.on('dropdown_opened', function() {
		update_view(as_ts(e.input_val))
	})

})

// ---------------------------------------------------------------------------
// date edit
// ---------------------------------------------------------------------------

css('.dateedit-calendar-button', '', `
	margin-left: calc(0px - var(--padding-x-input));
`)

widget('dateedit', 'Input', function(e) {

	editbox_widget(e, {picker: true})

	e.create_picker = calendar

	e.calendar_button = button({
		classes: 'dateedit-calendar-button',
		icon: 'far fa-calendar-alt',
		text: '',
		bare: true,
		focusable: false,
		title: S('button_pick_from_calendar', 'Pick from calendar'),
	})

	e.calendar_button.on('click', function() {
		e.toggle(true)
	})

	e.calendar_button.set_open = noop

	e.create_dropdown_button = function() {
		return e.calendar_button
	}

})

// ---------------------------------------------------------------------------
// time picker
// ---------------------------------------------------------------------------

css('.timepicker', 'grid-h', `
	grid-template-columns: 1fr 1fr;
`)

css('.timepicker:not([has_seconds]) .timepicker-sel-s', 'hidden')
css('.timepicker:not([has_seconds]) .timepicker-heading-s', 'hidden')

css('.timepicker[has_seconds]', '', `
	grid-template-columns: 1fr 1fr 1fr;
`)

css('.timepicker .btn', 'small')

css('.timepicker-button-cancel', 'm m-r-05')
css('.timepicker-button-set'   , 'm m-l-05')

css('.timepicker-sel', 'scroll b-t b-b b-dotted')

css('.timepicker-sel::-webkit-scrollbar', '', `
	width : 12px;
`)

css('.timepicker-heading', 'p small dim')

css('.timepicker-heading-m', 'b-l b-dotted')
css('.timepicker-heading-s', 'b-l b-dotted')
css('.timepicker-sel-m    ', 'b-l b-dotted')
css('.timepicker-sel-s    ', 'b-l b-dotted')

widget('timepicker', 'Input', function(e) {

	val_widget(e)
	e.make_focusable()

	let hh = t => t && t.slice(0, 2)
	let mm = t => t && t.slice(3, 5)
	let ss = t => t && t.slice(6, 8)

	e.cancel_button = button({
		classes: 'timepicker-button-cancel',
		cancel: true,
		text: S('cancel', 'Cancel'),
		action: function() {
			e.dropdown.cancel()
		},
	})

	e.set_button = button({
		text: S('set', 'Set'),
		classes: 'timepicker-button-set',
		primary: true,
		action: function() {
			e.fire('val_picked') // picker protocol
		},
	})

	e.on('bind_field', function(on) {
		if (!on) return

		e.clear()

		function gen_sel(classes, max, step) {
			let a = []
			for (let i = 0; i < max; i += step)
				a.push(i.base(10, 2))
			return listbox({
				classes: 'timepicker-sel ' + classes,
				items: a,
				max_h: 200,
				val_col: 0,
			})
		}

		e.sel_h = gen_sel('timepicker-sel-h', 24, or(e._field.hour_step  , 1))
		e.sel_m = gen_sel('timepicker-sel-m', 60, or(e._field.minute_step, 1))
		e.sel_s = gen_sel('timepicker-sel-s', 60, or(e._field.second_step, 1))

		let hh = div({class: 'timepicker-heading timepicker-heading-h'}, S('hour'  , 'Hour'))
		let hm = div({class: 'timepicker-heading timepicker-heading-m'}, S('minute', 'Minute'))
		let hs = div({class: 'timepicker-heading timepicker-heading-s'}, S('second', 'Second'))

		e.bool_attr('has_seconds', e._field.has_seconds || null)

		function set_val(_, ev) {
			if (!(ev && ev.input))
				return // called by update_view()
			let h = e.sel_h.input_val || '00'
			let m = e.sel_m.input_val || '00'
			let s = e.sel_s.input_val || '00'
			let t = h != null && m != null && s != null ? h + ':' + m + ':' + s : null
			e.set_val(t, {input: e})
		}
		e.sel_h.on('input_val_changed', set_val)
		e.sel_m.on('input_val_changed', set_val)
		e.sel_s.on('input_val_changed', set_val)

		e.add(
			hh, hm, hs,
			e.sel_h, e.sel_m, e.sel_s,
			e.cancel_button, e.set_button
		)
	})

	function update_view(t) {
		e.sel_h.reset_val(hh(t))
		e.sel_m.reset_val(mm(t))
		e.sel_s.reset_val(ss(t))
		e.sel_h.scroll_to_focused_cell(true)
		e.sel_m.scroll_to_focused_cell(true)
		e.sel_s.scroll_to_focused_cell(true)
	}

	e.do_update_val = function(v, ev) {
		assert(e.bound)
		if (ev && ev.input == e)
			return // called by set_val()
		update_view(v)
	}

	e.on('dropdown_opened', function() {
		update_view(e.input_val)
		runafter(0, () => e.sel_h.focus())
	})

})

// ---------------------------------------------------------------------------
// time-of-day edit
// ---------------------------------------------------------------------------

css('.timeofdayedit .editbox-input', 't-c')

css('.timeofdayedit .timeofdayedit-timepicker-button', '', `
	margin-left: -2em;
`)

widget('timeofdayedit', 'Input', function(e) {

	editbox_widget(e, {picker: true})

	e.create_picker = timepicker

	e.timepicker_button = button({
		classes: 'timeofdayedit-timepicker-button',
		icon: 'fa fa-clock',
		text: '',
		bare: true,
		focusable: false,
		title: S('button_pick_from_time_picker', 'Pick from time picker'),
	})

	e.timepicker_button.on('click', function() {
		e.toggle(true)
	})

	e.timepicker_button.set_open = noop

	e.create_dropdown_button = function() {
		return e.timepicker_button
	}

})

// ---------------------------------------------------------------------------
// richedit
// ---------------------------------------------------------------------------

css('.richedit', 'v', `
	min-height: 6em;
`)

css('.richtext-actionbar-embedded', 'rel bg1 b-b', `
	margin-top  : -1px;
	margin-left : -1px;
`)

css('.richtext-actionbar-embedded > button', 'b-b-0')

/* scroll instead of growing to overflow the css grid */
css('.richedit > .focus-box', 'S scroll-auto v')
css('.richedit > .focus-box > .richtext-content', 'S')

widget('richedit', 'Input', function(e) {

	let html_val = [...e.nodes]
	e.clear()

	val_widget(e)
	editable_widget(e)

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

// ---------------------------------------------------------------------------
// lookup dropdown (for fields with `lookup_nav_id` or `lookup_rowset*`)
// ---------------------------------------------------------------------------

widget('lookup-dropdown', function(e) {

	editbox_widget(e, {input: false, picker: true})

	e.create_picker = function(opt) {

		let ln_id = e._field.lookup_nav_id
		if (ln_id) {
			opt.id = ln_id
		} else {
			opt.tag = 'listbox'
			opt.rowset      = e._field.lookup_rowset
			opt.rowset_name = e._field.lookup_rowset_name
			opt.rowset_url  = e._field.lookup_rowset_url
		}
		opt.val_col     = e._field.lookup_cols
		opt.display_col = e._field.display_col
		opt.theme       = e.theme

		let picker = element(opt)
		picker.id = null // not saving prop vals into the original.
		return picker
	}

	e.on('opened', function() {
		if (!e.picker) return
		e.picker.scroll_to_focused_cell()
	})

	// standalone lookup.

	e.prop('lookup_rowset_name', {attr: 'rowset', type: 'rowset'})
	e.prop('lookup_cols'       , {attr: true})
	e.prop('display_col'       , {attr: true})

	function update_field() {

		e._field = e.lookup_rowset_name && {
			lookup_rowset_name : e.lookup_rowset_name,
			lookup_cols        : e.lookup_cols,
			display_col        : e.display_col,
		}

		if (e.picker) {
			e.picker.rowset_name = e._field.lookup_rowset_name
			e.picker.val_col     = e._field.lookup_cols
			e.picker.display_col = e.display_col
		}
	}

	e.set_lookup_rowset_name = update_field
	e.set_lookup_cols = update_field
	e.set_display_col = update_field

})

// ---------------------------------------------------------------------------
// image
// ---------------------------------------------------------------------------

css('.image', 'bg h-c h-m', `
	/* layout self */
	min-height: calc(var(--min-height-input) * 2 + var(--space-05));
	/* styling */
	border-radius: var(--border-radius-input);
	/* layout missing icon */
	display: flex !important; /* override fontawesome !important */
	color: #888;
`)

css('.image::before', '', `
	font-size: 2em !important; /* override fontawesome !important */
`)

css('.image.empty', 'bg1', `
	color: var(--bg-smoke); /* overlay icons */
`)

css('.image-img', 'abs shrinks', `
	width: 100%;
	height: 100%;
	object-fit: contain;
`)

css('.image-overlay', 'overlay z2', `
	display: grid;
	justify-items: end;
	align-items: end;
	opacity: .6;
`)

css('.image-btn', 'round t-c arrow', `
	margin: .5em .15em;
	margin-top: 0;
	font-size: 200%;
	color: black;
	background-color: white;
	width  : 1.5em;
	height : 1.5em;
	padding-top: .2em;
	box-shadow: 0px 0px 3px black;
	opacity: .7;
`)

css('.image-download-button', 'm-r')

css('.image-overlay > *', 'invisible')

css_state('.image-img:not(.loaded)', 'op0', `
	transition: opacity .2s;
`)

css_state('.image-img.loaded', 'op1', `
	transition: opacity .1s;
`)

css_state('.image-overlay:hover > *', 'visible')
css_state('.image-overlay:hover::before', 'invisible')
css_state('.image-btn[disabled]', 'op04')
css_state('.image-btn:not([disabled]):hover', 'op09')
css_state('.image-btn:not([disabled]):active', 'op1')

widget('image', 'Input', function(e) {

	e.title = ''
	e.class('empty fa fa-camera')

	row_widget(e)

	// believe it or not, `src=''` is the only way to remove the border.
	e.img1 = tag('img', {class: 'image-img', src: ''})
	e.img2 = tag('img', {class: 'image-img', src: ''})
	e.next_img = tag('img', {class: 'image-img', src: ''})
	e.prev_img = tag('img', {class: 'image-img', src: ''})

	e.overlay = div({class: 'image-overlay'})

	e.upload_btn   = div({class: 'image-btn image-upload-button fa fa-cloud-upload-alt', title: S('upload_image', 'Upload image')})
	e.download_btn = div({class: 'image-btn image-download-button fa fa-file-download', title: S('download_image', 'Download image')})
	e.buttons = span(0, e.upload_btn, e.download_btn)
	e.file_input = tag('input', {type: 'file', style: 'display: none'})
	e.overlay.add(e.buttons, e.file_input)

	e.add(e.img1, e.img2, e.overlay)

	function img_load(ev) {
		e.class('empty fa fa-camera', false)
		e.overlay.class('transparent', true)
		e.download_btn.bool_attr('disabled', null)
		e.title = S('image', 'Image')
		let img1 = e.img1
		let img2 = e.img2
		img1.style['z-index'] = 1
		img2.style['z-index'] = 0
		img1.class('loaded', true)
		img2.class('loaded', false)
		e.img1 = img2
		e.img2 = img1
		e.img1.hidden = false
		e.img2.hidden = false
	}
	e.img1.on('load', img_load)
	e.img2.on('load', img_load)

	function img_error(ev) {
		e.img1.hidden = true
		e.img2.hidden = true
		e.class('empty fa fa-camera', true)
		e.overlay.class('transparent', false)
		e.download_btn.bool_attr('disabled', true)
		e.title = S('no_image', 'No image')
	}
	e.img1.on('error', img_error)
	e.img2.on('error', img_error)

	e.format_url = function(vals, purpose) {
		return (purpose == 'upload' && e.upload_url_format || e.url_format || '').subst(vals)
	}

	function format_url(purpose) {
		let vals = e.row && e._nav.serialize_row_vals(e.row)
		return vals && e.format_url(vals, purpose)
	}

	e.do_update_row = function() {
		e.bool_attr('disabled', e.disabled || null)
		e.img1.attr('src', format_url() || '')
		e.img1.class('loaded', false)
		e.upload_btn.hidden = e.disabled || !e.allow_upload
		e.download_btn.hidden = e.disabled || !e.allow_download
	}

	e.prop('url_format'        , {attr: true})
	e.prop('upload_url_format' , {attr: true})
	e.prop('allow_upload'      , {type: 'bool', default: true, attr: true})
	e.prop('allow_download'    , {type: 'bool', default: true, attr: true})

	// upload/download error notifications

	e.notify = function(type, message, ...args) {
		notify(message, type)
		e.fire('notify', type, message, ...args)
	}

	// upload

	let upload_req
	e.upload = function(file) {
		if (upload_req)
			upload_req.abort()
		let reader = new FileReader()
		reader.onload = function(ev) {
			let file_contents = ev.target.result
			upload_req = ajax({
				url: format_url('upload'),
				upload: file_contents,
				headers: {
					'content-type': file.type,
					'content-disposition': 'attachment; filename="' + file.name + '"',
				},
				success: function() {
					e.update()
				},
				fail: function(type, status, message, body) {
					let err = this.error_message(type, status, message, body)
					if (err)
						e.notify('error', err, body)
				},
				done: function() {
					upload_req = null
				},
				upload_progress: function(p) {
					// TODO:
				},
			})
		}
		reader.readAsArrayBuffer(file)
	}

	e.overlay.on('dragenter', return_false)
	e.overlay.on('dragover', return_false)

	e.overlay.on('drop', function(ev) {
		if (!e.allow_upload)
			return false
		let files = ev.dataTransfer && ev.dataTransfer.files
		if (files && files.length)
			e.upload(files[0])
		return false
	})

	e.upload_btn.on('click', function() {
		e.file_input.click()
	})

	e.file_input.on('change', function() {
		if (this.files && this.files.length) {
			e.upload(this.files[0])
			// reset value or we won't get another change event for the same file.
			this.value = ''
		}
	})

	// download

	e.download_btn.on('click', function() {
		let href = format_url()
		let name = url_parse(href).segments.last
		let link = tag('a', {href: href, download: name, style: 'display: none'})
		e.add(link)
		link.click()
		link.remove()
	})

})

// ---------------------------------------------------------------------------
// mustache row
// ---------------------------------------------------------------------------

widget('mu-row', 'Input', function(e) {

	e.template_string = e.at[0] && e.at[0].tag == 'script'
		? e.at[0].html // text template as text inside <script> tag
		: e.html // text template as dom tree, convert it back to html

	e.clear()

	row_widget(e)

	e.do_update_row = function(row) {
		let vals = row && e._nav.serialize_row_vals(row)
		e.render(vals)
	}

})

// ---------------------------------------------------------------------------
// sql editor
// ---------------------------------------------------------------------------

widget('sqledit', 'Input', function(e) {

	val_widget(e)

	e.do_update_val = function(v, ev) {
		e.editor.getSession().setValue(v || '')
	}

	e.do_update_errors = function(errors, ev) {
		// TODO
	}

	e.on_bind(function(on) {
		if (on) {
			e.editor = ace.edit(e, {
					mode: 'ace/mode/mysql',
					highlightActiveLine: false,
					printMargin: false,
					displayIndentGuides: false,
					tabSize: 3,
					enableBasicAutocompletion: true,
				})
			//sql_editor_ct.on('blur'            , exit_widget_editing, on)
			//sql_editor_ct.on('raw:pointerdown' , prevent_bubbling, on)
			//sql_editor_ct.on('raw:pointerup'   , prevent_bubbling, on)
			//sql_editor_ct.on('raw:click'       , prevent_bubbling, on)
			//sql_editor_ct.on('raw:contextmenu' , prevent_bubbling, on)
			e.do_update_val(e.val)
			//sql_editor.getSession().getValue()
		} else {
			e.editor.destroy()
			e.editor = null
		}
	})

})

// ---------------------------------------------------------------------------
// mustache widget mixin
// ---------------------------------------------------------------------------

widget('mu', function(e) {

	e.template_string = e.at[0] && e.at[0].tag == 'script'
		? e.at[0].html // text template as text inside <script> tag
		: e.html // text template as dom tree, convert it back to html

	e.clear()

	e.on_bind(function(on) {
		if (on)
			e.reload()
	})

	// loading ----------------------------------------------------------------

	let load_req

	function load_done(how, ...args) {

		if (how == 'success')
			e.render(args[0], this)

		if (how == 'done')
			load_req = null

		let ev = 'load_'+how
		e.fire(ev, ...args)
		if (e[ev])
			e[ev](...args)

	}

	let last_data_url, placeholder_set

	e.reload = function(req) {

		let data_url = req && req.url || e.computed_data_url()
		if (data_url == last_data_url)
			return
		last_data_url = data_url

		if (load_req)
			load_req.abort()

		if (!data_url) {
			e.clear()
			placeholder_set =  false
			return
		}

		load_req = ajax(assign({
			dont_send: true,
			done: load_done,
			url: data_url,
		}, req))

		load_req.send()

		return load_req
	}

	// nav & params binding ---------------------------------------------------

	e.computed_data_url = function() {
		if (e._nav && e._nav.focused_row && e.data_url)
			return e.data_url.subst(e._nav.serialize_row_vals(e._nav.focused_row))
		else
			return e.data_url
	}

	e.do_update = function() {
		e.reload()
	}

	e.on_bind(function(on) {
		bind_nav(e.param_nav, e.data_url, on)
		if (on && !placeholder_set) {
			e.render({loading: true})
			placeholder_set = true
		}
	})

	function update() {
		e.update()
	}
	function bind_nav(nav, url, on, reload) {
		if (on && !e.bound)
			return
		if (nav) {
			nav.on('focused_row_changed'     , update, on)
			nav.on('focused_row_val_changed' , update, on)
			nav.on('cell_state_changed'      , update, on)
			nav.on('reset'                   , update, on)
		}
		if (reload !== false)
			e.update()
	}

	e.set_param_nav = function(nav1, nav0) {
		bind_nav(nav0, e.data_url, false, false)
		bind_nav(nav1, e.data_url, true)
	}
	e.prop('param_nav', {private: true})
	e.prop('param_nav_id', {bind_id: 'param_nav', type: 'nav',
			text: 'Param Nav', attr: 'param_nav'})

	e.set_data_url = function(url1, url0) {
		bind_nav(e.param_nav, url0, false, false)
		bind_nav(e.param_nav, url1, true)
	}
	e.prop('data_url', {attr: true})

})

// ---------------------------------------------------------------------------
// widget switcher
// ---------------------------------------------------------------------------

css('.switcher', 'skip')

widget('switcher', 'Containers', function(e) {

	row_widget(e)
	let html_items = widget_items_widget(e)

	e.prop('item_id_format', {attr: true, default: ''})

	e.format_item_id = function(vals) {
		return catany('_', e.module, e.item_id_format.subst(vals))
	}

	e.match_item = function(item, vals) { // stub
		// special case: listbox with html elements with "action" attr
		// and the switcher's items also have the "action" attr, so match those.
		if (item.hasattr('action') && vals.f0 && iselem(vals.f0) && vals.f0.hasattr('action'))
			return item.attr('action') == vals.f0.attr('action')
		return item.id == e.format_item_id(vals)
	}

	e.find_item = function(vals) {
		for (let item of e.items)
			if (e.match_item(item, vals))
				return item
	}

	e.item_create_options = noop // stub

	e.create_item = function(vals) {
		let id = e.format_item_id(vals)
		let item = id ? element(assign_opt({id: id}, e.item_create_options(vals))) : null
	}

	e.do_update_row = function(row) {
		let vals = row && e._nav.serialize_row_vals(row)
		let item = vals && (e.find_item(vals) || e.create_item(vals))
		e.set(item)
	}

	return {items: html_items}

})

// ---------------------------------------------------------------------------
// lbl
// ---------------------------------------------------------------------------

css('.lbl', '', `
	margin-left : var(--padding-x-input);
	margin-right: var(--padding-x-input);
	color: var(--fg-label);
`)

widget('lbl', function(e) {

	editable_widget(e)
	val_widget(e, false, false)

	e.create_label_placeholder = function() {
		return div({class: 'input-placeholder'})
	}

	e.do_update = function() {
		let s = (e._field && e._field.label) || null
		if (s != null && e._field && e._field.not_null && e.label_show_star != false)
			s = s + ' *'
		e.set(s || e.create_label_placeholder())
		e.set(s)
	}

})

// ---------------------------------------------------------------------------
// inp
// ---------------------------------------------------------------------------

css('.inp', 'v')

css('.inp:not(:empty)', 'm0 b0 ro0')

widget('inp', 'Input', function(e) {

	val_widget(e, true, false)

	e.prop('widget_type', {type: 'enum', enum_values: []})

	e.create_editor = function(field, opt) {
		return e._nav.create_editor(field, opt)
	}

	e.enabled_on_readonly = true

	function bind_field(on) {
		if (on) {
			let opt = {
				can_select_widget: false,
				embedded: false,
			}
			each_widget_prop(function(k, v) { opt[k] = v })
			e.widget = e.create_editor(e._field, opt)
			e.set(e.widget)
		} else {
			if (e.widget) {
				e.widget.remove()
				e.widget = null
			}
		}
	}

	e.on('bind_field', bind_field)

	e.set_widget_type = function(v) {
		if (!e.initialized)
			return
		if (!e._field)
			return
		if (widget_type(v) == widget_type(e.widget_type))
			return
		bind_field(false)
		bind_field(true)
	}

	// proxy out ".PROP" to "e.widget.PROP"

	function each_widget_prop(f) {
		for (let k in e) {
			if (k.starts('.')) {
				let v = e.get_prop(k)
				k = k.replace(/^\./, '')
				if (v === '')
					v = true
				f(k, v)
			}
		}
	}

	e.set_prop = function(k, v) {
		let v0 = e[k]
		e[k] = v
		if (v !== v0 && e.widget && k.starts('.')) {
			k = k.replace(/^\./, '')
			e.widget[k] = v
			window.fire('prop_changed', e, k, v, v0, null)
		}
	}

	e.override('init', function(inherited) {
		inherited.call(this)
		e.set_widget_type(e.widget_type)
	})

})

// ---------------------------------------------------------------------------
// form
// ---------------------------------------------------------------------------

// scroll: enables scrolling within children (it's like Harry Potter in here).
css('.frm', 'v-l scroll', `

	grid-gap: var(--border-width-item); /* works on both flex and grid */
	/*
	TODO: we'd like to use background as gap color (interstitial border).
	background-color: var(--border-light);
	*/
`)

css('.frm[grid]', 'grid-h', `
	grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
	align-items: start;
`)

css('.frm :is(h1, h2, h3)', '', `
	font-weight: normal;
	margin-top: 1em;
	margin-bottom: .2em;
`)

css('.frm.compact', 'small', `
	grid-gap: 0;
`)

css('.frm.compact > :is(h1, h2, h3)', 'hidden')

css(`
	.frm.compact > .widget:not(.inp),
	.frm.compact > .inp > .widget
`, 'm0 ro0', `
	border-top-color  : rgb(0,0,0,0);
	border-left-color : rgb(0,0,0,0);
	border-right-color: rgb(0,0,0,0);
`)

css('.frm[grid][baseline]', '', `align-items: baseline;`)

// A linear form puts its children on a 2-column grid. The children are
// responsible for changing their layouting with `display: contents`
// until exactly two in-layout elements remain: an icon and a content.

css('.linear-form', 'grid-h', `
	grid-template-columns: 2em 1fr;
	align-items: first baseline;
	grid-gap: .25em 0;
`)

// hide filler or it screws baseline align of inputs with surrounding text.
css('.linear-form-filler', 'hidden')
css('.linear-form .linear-form-filler', 'show')

widget('frm', 'Containers', function(e) {

	selectable_widget(e)
	editable_widget(e)
	contained_widget(e)

	e.init_child_components()

	let names // {name->true}
	function area_name(item) {
		let s = item.style['grid-area'] || item.attr('area')
		if (s)
			return s
		// make-up a name based on col names.
		s = item.col || item.attr('col')
		if (item.tag == 'lbl')
			s = s + '_label'
		if (!s)
			s = item.id
		if (!s)
			return ''
		let i = 1
		while (names[s]) {
			s = s.replace(/\d+$/, '') + i
			i++
			pr(s)
		}
		names[s] = true
		return s
	}

	e.do_update = function(opt) {
		if (opt.nav) {
			names = obj()
			for (let ce of e.$('.inp-widget, .inp, .lbl, .chart')) {
				if (ce.closest('frm') == e) {
					ce.nav = e._nav
					ce.style['grid-area'] = area_name(ce)
				}
			}
		}
	}

	e.on('resize', function(r) {
		if (!e.bound)
			return
		let n = clamp(floor(r.w / 150), 1, 12)
		for (let i = 1; i <= 12; i++)
			e.class('maxcols'+i, i <= n)
		e.class('compact', r.w < 200)
	})

	function bind_nav(on) {
		if (!on && e._nav) {
			e._nav = null
			e.update({nav: true})
		} else if (on && !e._nav) {
			e._nav = e.nav || e._nav_id_nav || null
			e.update({nav: true})
		}
	}

	e.on_bind(bind_nav)

	function nav_changed() {
		if (!e.bound)
			return
		bind_nav(false)
		bind_nav(true)
	}

	e.set_nav = nav_changed
	e.prop('nav', {private: true})

	e.set__nav_id_nav = nav_changed
	e.prop('_nav_id_nav', {private: true})
	e.prop('nav_id', {bind_id: '_nav_id_nav', type: 'nav', attr: 'nav'})

	// clicking on blank areas of the form focuses the last focused input element.
	let last_focused_input
	e.on('focusin', function() {
		last_focused_input = e.focused_element
	})
	e.on('pointerdown', function(ev) {
		if (ev.target != e)
			return
		if (!e.hasfocus)
			if (last_focused_input)
				last_focused_input.focus()
			else
				e.focus_first()
	})

})
