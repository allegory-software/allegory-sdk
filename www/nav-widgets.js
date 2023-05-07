/* ---------------------------------------------------------------------------

	Nav-driven widgets.
	Written by Cosmin Apreutesei. Public Domain.

You must load first:

	nav.js

WIDGETS

	<list          nav=      >
	<dropdown>     <list nav=>
	<label         nav= col= >
	<dropdown      nav= col= >

*/

(function () {
"use strict"
let G = window

component.extend('list', 'before', make_nav_data_widget_extend_before)

component.extend('list', function(e) {

	e.make_nav_data_widget()

	let nav
	e.on('bind_nav', function(nav1, on) {
		nav = on ? nav1 : null
		set_items()
	})

	function set_items() {
		e.items = nav && nav.ready && nav.serialize_all_row_vals() || []
	}

	e.listen('col_vals_changed', function(nav1) {
		if (nav1 != nav) return
		e.update_items()
	})

	e.listen('reset', function(nav1) {
		if (nav1 != nav) return
		set_items()
	})

	e.listen('col_attr_changed', function(nav1, field, k, v) {
		if (nav1 != nav) return
		set_items()
	})

})

component.extend('label', function(e) {

	e.make_nav_col_widget()

	let field

	function update_label() {
		e.set(field && field.label || null)
	}

	e.on('bind_field', function(field1, on) {
		field = on ? field1 : null
		update_label()
	})

	e.override('get_target', function(inherited) {
		let target = inherited.call(this)
		if (!target && field)
			target = e.announce('label_find_target', field)
		return target
	})

	e.listen('field_changed', function(te, changed_field, k, v) {
		if (te != (field && field.nav)) return
		if (changed_field != field) return
		if (k != 'label') return
		update_label()
	})

})

function input_widget(e, field_props, range) {

	e.make_nav_input_widget(field_props, range)

	e.on('input', function(ev) {
		e.set_cell_val(e.input_value, ev)
	})

}

component.extend('checkbox', function(e) {
	input_widget(e, 'checked_value unchecked_value')
})

component.extend('toggle', function(e) {
	input_widget(e, 'checked_value unchecked_value')
})

component.extend('radio', function(e) {
	input_widget(e, '')
	e.override('get_input_val_for', function(inherited, field) {
		let v = inherited(field)
		if (v == null)
			return null
		if (v != e.checked_value)
			v = e.unchecked_value
		return v
	})
})

component.extend('select-button', function(e) {
	input_widget(e, 'label')
	e.on('bind_field', function(field, on) {
		if (on) {
			let items = []
			for (let v of field.known_values)
				items.push(div({value: v}, v))
			e.items = items
		} else {
			e.items = null
		}
	})
})

component.extend('text-input', function(e) {
	input_widget(e, 'label placeholder max_len')
})

component.extend('textarea-input', function(e) {
	input_widget(e, 'label placeholder max_len')
})

component.extend('pass-input', function(e) {
	input_widget(e, 'label placeholder min_len conditions')
})

component.extend('num-input', function(e) {
	input_widget(e, 'label placeholder min max decimals buttons')
})

component.extend('slider', function(e) {
	input_widget(e, 'label min max from to decimals marked')
})

component.extend('tags-input', function(e) {
	input_widget(e, 'label valid_tags nowrap format')
})

component.extend('date-input', function(e) {
	input_widget(e, 'label placeholder min max format')
})

component.extend('timeofday-input', function(e) {
	input_widget(e, 'label placeholder min max format')
})

component.extend('datetime-input', function(e) {
	input_widget(e, 'label placeholder min max format')
})

component.extend('range-slider', function(e) {

	e.make_nav_input_widget('min max', true, 'label from to decimals')

	e.on('input', function(ev) {
		e.set_cell_val1(e.input_value1, ev)
		e.set_cell_val2(e.input_value2, ev)
	})

})

component.extend('date-range-input', function(e) {

	e.make_nav_input_widget('min max', true, 'label')

	e.on('input', function(ev) {
		e.set_cell_val1(e.input_value1, ev)
		e.set_cell_val2(e.input_value2, ev)
	})

})

component.extend('dropdown', function(e) {

	input_widget(e)

	e.on('bind_field', function(field, on) {
		field = on ? field : null
		e.list.clear()
		let lookup_field = field && field.lookup_fields && field.lookup_fields[0]
		if (lookup_field) {
			for (let row of lookup_field.nav.all_rows) {
				let item_e = div()
				lookup_field.nav.draw_cell(row, field.display_field, item_e)
				item_e.value = lookup_field.nav.cell_val(row, lookup_field)
				e.list.add(item_e)
			}
			e.list.fire('items_changed')
		}
	})

})

/* <col-input>, <col-range-input> --------------------------------------------

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

type mapping:
	text         text-input, tags-input, textarea-input
	bool         checkbox, toggle, 2 radios
	count        num-input, slider
	number       num-input, slider
	percent      num-input, slider
	date         date-input, datetime-input
	time         date-input, datetime-input
	timeofday    timeofday-input
	email        text-input with email validation
	phone        text-input with phone validation
	url          text-input with url validation
	password     pass-input
	enum         dropdown, select-button, radios
	tags         tags-input, check-dropdown
todo:
	image        image-input
	duration     duration-input
	private_key  textarea-input
	public_key   textarea-input
	place        place-input
	filesize     slider + num-input + G/M/K/B switch
todo / lookup:
	lookup       dropdown / grid / list
todo / range:
	date         date-range-input
	time         date-range-input, datetime-range-input
	num          range-slider
meh:
	col          col-dropdown
	color        color-dropdown
	icon         icon-dropdown

*/

function col_input(e, is_range) {

	e.make_nav_input_widget()

	e.bind_field = function(on) {

	}

	// nav dynamic binding ----------------------------------------------------

	function cell_state_changed(row, field, changes, ev) {
		e.update({changes: changes, ev: ev})
		e.announce('input_state_changed', changes, ev)
	}

	e.prop('col', {type: 'col', col_nav: () => e._nav})
	e.set_col = nav_changed

	e.prop('nav', {private: true})
	e.prop('nav_id', {type: 'nav', attr: 'nav', bind_id: '_nav_id_nav'})
	e.set_nav = nav_changed

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
				&& (e.has_focus || e.hovered)
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

G.col_input = component('col-input', 'Input', function(e) {
	return col_input(e)
})

G.col_range_input = component('col-range-input', 'Input', function(e) {
	return col_input(e, true)
})

}()) // module function
