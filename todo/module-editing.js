

// ---------------------------------------------------------------------------
// rowsets nav
// ---------------------------------------------------------------------------

//rowsets_nav = bare_nav({rowset_name: 'rowsets'})
//rowsets_nav.reload()

// ---------------------------------------------------------------------------
// rowset types
// ---------------------------------------------------------------------------

field_types.rowset = obj()

field_types.rowset.editor = function(...options) {
	function more() {
		let d = sql_rowset_editor_dialog()
		d.modal()
	}
	return list_dropdown(assign_opt({
		nolabel: true,
		rowset_name: 'rowsets',
		val_col: 'name',
		display_col: 'name',
		mode: 'fixed',
		more_action: more,
	}, ...options))
}

// col

field_types.col = obj()

/*
field_types.col.editor = function(...options) {
	let rs = rowset({
		fields: [{name: 'name'}],
	})
	let e = list_dropdown(assign_opt({
		nolabel: true,
		lookup_rowset: rs,
		mode: 'fixed',
	}, ...options))
	let rs_field = e.nav.rowset.field(this.rowset_col)
	let rs_name = e.nav.rowset.value(e.nav.focused_row, rs_field)
	let rs = rs_name && global_rowset(rs_name)
	if (rs) {
		rs.once('reset', function() {
			let rows = rs.fields.map(field => [field.name])
			e.lookup_rowset.reset({
				rows: rows,
			})
		})
		rs.load_fields()
	}
	return e
}
*/


// ---------------------------------------------------------------------------
// state toaster
// ---------------------------------------------------------------------------

window.on('load', function() {
	xmodule_state_toaster = toaster({
		timeout: null,
	})
	document.body.add(xmodule_state_toaster)
})

// ---------------------------------------------------------------------------
// prop layers inspector
// ---------------------------------------------------------------------------

prop_layers_inspector = component('prop-layers-inspector', function(e) {

	e.classes = 'inspector'

	grid.construct(e)
	e.cell_h = 22
	e.stay_in_edit_mode = false

	e.can_select_widget = false

	let barrier
	function reset() {
		if (barrier)
			return
		let rows = []
		for (let ms in xmodule.active_layers) {
			let layer_obj = xmodule.active_layers[ms]
			let layer = layer_obj ? layer_obj.name : null
			let [_, module, slot] = ms.match(/([^\:]+)\:(.*)/)
			let slot_obj = xmodule.slots[slot]
			let row = [true, true, true, slot_obj && slot_obj.color || '#fff', module, slot, layer]
			rows.push(row)
		}
		function format_module(module) {
			let m = xmodule.modules[module]
			return m && m.icon ? div({class: 'fa fa-'+m.icon, title: module}) : module
		}
		function format_slot(slot) {
			let s = xmodule.slots[slot]
			return s && s.icon ? div({class: 'fa fa-'+s.icon, title: slot}) : slot
		}
		function format_selected(_, row) {
			let act = e.cell_val(row, e.all_fields_map.active)
			if (!act) return ''
			let sel_module = e.cell_val(row, e.all_fields_map.module) == xmodule.selected_module
			let sel_slot   = e.cell_val(row, e.all_fields_map.slot)   == xmodule.selected_slot
			return div({class: 'fa fa-chevron'+(sel_module && sel_slot ? '-circle' : '')+'-right'})
		}
		function render_eye_icon() {
			return div({class: 'fa fa-eye'})
		}
		e.rowset = {
			fields: [
				{name: 'active'  , type: 'bool', visible: false},
				{name: 'selected', min_w: 24, max_w: 24, type: 'bool', format: format_selected},
				{name: 'visible' , min_w: 24, max_w: 24, type: 'bool', true_text: render_eye_icon},
				{name: 'color'   , min_w: 24, max_w: 24, type: 'color'},
				{name: 'module'  , min_w: 24, max_w: 24, format: format_module, align: 'center'},
				{name: 'slot'    , min_w: 24, max_w: 24, format: format_slot  , align: 'center'},
				{name: 'layer'   , },
			],
			rows: rows,
		}
		e.reset()
	}

	let can_change_val = e.can_change_val
	e.can_change_val = function(row, field) {
		return can_change_val(row, field)
			// TODO: restrict hiding `base` slots?
			//&& (!row || !field || e.cell_val(row, e.all_fields_map.slot) != 'base'
			//		|| field.name == 'selected' || field.name == 'active')
	}

	e.on_bind(function(on) {
		document.on('prop_layer_slots_changed', reset, on)
		reset()
	})

	function set_layer(row, active) {
		let module   = e.cell_val(row, e.all_fields_map.module)
		let slot     = e.cell_val(row, e.all_fields_map.slot)
		let layer    = e.cell_val(row, e.all_fields_map.layer)
		let internal = e.cell_val(row, e.all_fields_map.internal)
		let layer_obj = xmodule.layers[layer]
		xmodule.set_layer(module, slot, active && internal ? null : layer)
	}

	function set_selected_module_slot(sel_module, sel_slot) {
		if (barrier)
			return
		barrier = true

		xmodule.selected_module = sel_module
		xmodule.selected_slot   = sel_slot

		let active = true
		for (let row of e.rows) {
			set_layer(row, active)
			let module   = e.cell_val(row, e.all_fields_map.module)
			let slot     = e.cell_val(row, e.all_fields_map.slot)
			let selected = e.cell_val(row, e.all_fields_map.selected)
			e.reset_cell_val(row, e.all_fields_map.active   , active)
			e.reset_cell_val(row, e.all_fields_map.selected , selected)
			if (module == sel_module && slot == sel_slot)
				active = false
		}
		e.update({vals: true})

		if (e.state_tooltip)
			e.state_tooltip.close()

		if (sel_module && sel_slot) {
			let layer_obj = xmodule.get_active_layer(sel_module, sel_slot)
			let s = sel_module+':'+sel_slot+': '+(layer_obj ? layer_obj.name : 'none')

			e.state_tooltip = xmodule_state_toaster.post(s, 'error')
			e.state_tooltip.close_button = true
			e.state_tooltip.on('closed', function() {
				e.state_tooltip = null
				if (barrier) return
				set_selected_module_slot(null, null)
			})
		}

		barrier = false
	}

	e.on('cell_val_changed_for_selected', function(row, field, val) {
		let sel_module = e.cell_val(row, e.all_fields_map.module)
		let sel_slot   = e.cell_val(row, e.all_fields_map.slot)
		set_selected_module_slot(sel_module, sel_slot)
	})

	e.on('cell_val_changed_for_visible', function(row, field, val) {
		if (barrier)
			return
		barrier = true
		let active = e.cell_val(row, e.all_fields_map.active)
		set_layer(row, active)
		barrier = false
	})

	e.on('cell_val_changed_for_color', function(row, field, val) {
		let slot = e.cell_val(row, e.all_fields_map.slot)
		xmodule.slots[slot].color = val
		document.fire('selected_widgets_changed')
	})

	e.reset_to_default = function() {
		for (let row of e.rows)
			e.reset_cell_val(row, !e.all_fields_map.internal, true)
		if (e.state_tooltip)
			e.state_tooltip.close()
	}

})

// ---------------------------------------------------------------------------
// nav editor for prop inspector
// ---------------------------------------------------------------------------

function widget_select_editor(widgets_id_map, filter, ...options) {
	let dd = list_dropdown({
		rowset: {
			fields: [{name: 'id'}],
		},
		nolabel: true,
		val_col: 'id',
		display_col: 'id',
		mode: 'fixed',
	}, ...options)
	function reset_nav() {
		let rows = []
		for (let id in widgets_id_map)
			for (let te of widgets_id_map[id])
				if (te.can_select_widget && filter(te))
					rows.push([id])
		dd.picker.rowset.rows = rows
		dd.picker.reset()
	}
	dd.on_bind(function(on) {
		document.on('widget_tree_changed', reset_nav, on)
	})
	reset_nav()
	return dd
}

field_types.nav = obj()
field_types.nav.editor = function(...args) {
	return xmodule.nav_editor(...args)
}

// ---------------------------------------------------------------------------
// property inspector
// ---------------------------------------------------------------------------

prop_inspector = component('prop-inspector', function(e) {

	e.class('inspector')

	grid.construct(e)
	e.cell_h = 22

	e.can_add_rows = false
	e.can_remove_rows = false
	e.action_band_visible = 'no'

	e.can_select_widget = false

	e.vertical = true

	e.exit_edit_on_lost_focus = false
	e.can_sort_rows = false
	e.enable_context_menu = false
	e.focus_cell_on_click_header = true

	// prevent getting out of edit mode.
	e.auto_edit_first_cell = true
	e.enter_edit_on_click = true
	e.exit_edit_on_escape = false
	e.exit_edit_on_enter = false
	e.stay_in_edit_mode = true

	e.empty_text = 'No widgets selected or focused'

	e.on_bind(function(on) {
		document.on('selected_widgets_changed', selected_widgets_changed, on)
		listen('prop_changed', prop_changed, on)
		document.on('focusin', focus_changed, on)
		if (on)
			reset()
	})

	e.on('cell_val_changed', function(row, field, val, ev) {
		if (!ev)
			return // from reset()
		for (let te of widgets)
			te.set_prop(field.name, val)
	})

	function selected_widgets_changed() {
		reset()
	}

	let barrier
	function focus_changed() {
		if (barrier) return
		if (selected_widgets.size)
			return
		let fe = focused_focusable()
		if (!fe || !fe.can_select_widget)
			return
		barrier = true
		reset()
		barrier = false
	}

	function prop_changed(te, k, v) {
		if (!widgets.has(te))
			return
		let field = e.all_fields_map[k]
		if (!field)
			return
		if (e.editor && e.focused_field == field)
			return
		e.focus_cell(0, e.field_index(field), 0, 0, {
			// NOTE: override these options because if we're in updating mode,
			// editor_state = 'toggle' from the last time would be applied,
			// which would result in an infinte loop.
			enter_edit: true,
			editor_state: 'select_all',
		})
		e.reset_val(e.focused_row, field, v)
	}

	/*
	e.on('exit_edit', function(ri, fi) {
		let field = e.fields[fi]
		e.reset_cell_val(e.rows[ri], field, e.widget[field.name])
	})
	*/

	let widgets, prop_colors

	function reset() {

		widgets = selected_widgets
		if (!selected_widgets.size && focused_focusable() && !up_widget_which(focused_focusable(), e => !e.can_select_widget))
			widgets = new Set([focused_focusable()])

		let i = 0
		for (let te of widgets) // for debugging...
			window['$'+i++] = te

		let rs = obj()
		rs.fields = []
		let row = []
		rs.rows = []

		let prop_counts = obj()
		let defs = obj()
		let pv0 = obj()
		let pv1 = obj()
		prop_colors = obj()

		for (let te of widgets)
			for (let prop in te.get_props()) {
				let pa = te.get_prop_attrs(prop)
				if (!pa.private && (widgets.size == 1 || !pa.unique)) {
					prop_counts[prop] = (prop_counts[prop] || 0) + 1
					defs[prop] = pa
					let v1 = te.serialize_prop(prop, te.get_prop(prop))
					let v0 = te.serialize_prop(prop, defs[prop].default)
					pv0[prop] = prop in pv0 && pv0[prop] !== v0 ? undefined : v0
					pv1[prop] = prop in pv1 && pv1[prop] !== v1 ? undefined : v1
					let [module, slot, layer] = xmodule.prop_module_slot_layer(te, prop)
					let sl = xmodule.slots[slot]
					prop_colors[prop] = sl && sl.color || '#f0f'
				}
			}

		for (let prop in prop_counts)
			if (prop_counts[prop] == widgets.size) {
				rs.fields.push(assign_opt(obj(), defs[prop], {convert: null}))
				row.push(repl(pv0[prop], undefined, null))
			}

		if (row.length)
			rs.rows.push(row)

		e.rowset = rs
		e.reset()

		if (e.all_rows.length) {
			let row = e.all_rows[0]
			for (let field of e.all_fields)
				e.set_cell_val(row, field, pv1[field.name])
		}

		e.title_text = ([...widgets].map(e => e.tag + (e.id ? ' ' + e.id : ''))).join(' ')

		e.fire('prop_inspector_changed')
	}

	// TODO: this is not in grid anymore...
	let inh_do_update_cell_val = e.do_update_cell_val
	e.do_update_cell_val = function(cell, row, field, input_val) {
		inh_do_update_cell_val(cell, row, field, input_val)
		let color = prop_colors[field.name]
		let hcell = e.header.at[field.index]
		hcell.style['border-right'] = '4px solid'+color
	}

	// prevent unselecting all widgets by default on document.pointerdown.
	e.on('pointerdown', function(ev) {
		ev.stopPropagation()
	})

})

// ---------------------------------------------------------------------------
// widget tree
// ---------------------------------------------------------------------------

widget_tree = component('widget-tree', function(e) {

	e.class('widget-tree inspector')

	grid.construct(e)
	e.cell_h = 22

	function widget_tree_rows() {
		let rows = []
		function add_widget(e, pe) {
			if (!e) return
			rows.push([e, pe, e.tag, e.id])
			if (e.child_widgets)
				for (let ce of e.child_widgets())
					add_widget(ce, e)
		}
		add_widget(xmodule.root_widget)
		return rows
	}

	let type_icons = {
		grid: 'table',
		split: 'columns',
		tabs: 'sitemap',
	}
	function type_icon(type) {
		let icon = type_icons[type]
		return icon ? div({class: 'fa fa-'+icon}) : type
	}

	let rs = {
		fields: [
			{name: 'widget'       , visible: false},
			{name: 'parent_widget', visible: false},
			{name: 'type' , w: 30, format: type_icon},
			{name: 'id'   , },
		],
		rows: widget_tree_rows(),
		pk: 'widget',
		parent_col: 'parent_widget',
	}

	e.rowset = rs
	e.cols = 'type id'
	e.tree_col = 'id'

	e.can_select_widget = false
	e.header_visible = false
	e.can_focus_cells = false
	e.can_change_rows = false
	e.auto_focus_first_cell = false
	e.can_select_non_siblings = false

	function get_widget() {
		return e.focused_row && e.focused_row[0]
	}
	function set_widget(widget) {
		let row = e.lookup(0, [widget])[0]
		let ri = e.row_index(row)
		e.focus_cell(ri, 0)
	}
	e.property('widget', get_widget, set_widget)

	let barrier

	e.on('selected_rows_changed', function() {
		if (barrier) return
		barrier = true
		let to_unselect = new Set(selected_widgets)
		for (let [row] of e.selected_rows) {
			let ce = row[0]
			ce.set_widget_selected(true, false, false)
			to_unselect.delete(ce)
		}
		for (let ce of to_unselect)
			ce.set_widget_selected(false, false, false)
		document.fire('selected_widgets_changed')
		barrier = false
	})

	function select_widgets(widgets) {
		let rows = new Map()
		for (let ce of widgets) {
			let row = e.lookup(0, [ce])[0]
			rows.set(row, true)
		}
		let focused_focusable = [...widgets].pop()
		let row = e.lookup(0, [focused_focusable])[0]
		let ri = e.row_index(row)
		e.focus_cell(ri, null, 0, 0, {
			selected_rows: rows,
			must_not_move_row: true,
			unfocus_if_not_found: true,
			dont_select_widgets: true,
		})
	}

	function selected_widgets_changed() {
		if (barrier) return
		barrier = true
		select_widgets(selected_widgets)
		barrier = false
	}

	let freeing

	function widget_tree_changed() {
		if (freeing)
			return
		rs.rows = widget_tree_rows()
		e.reset()
	}

	e.free_row = function(row) {
		freeing = true
		let ce = e.cell_val(row, 'widget')
		if (ce == xmodule.root_widget) {
			xmodule.set_root_widget(null)
			freeing = false
			widget_tree_changed()
			freeing = true
		} else {

		}
		freeing = false
	}

	/* TODO: not sure what to do here...
	function focus_changed() {
		if (selected_widgets.size)
			return
		let fe = focused_focusable()
		if (!fe || !fe.can_select_widget)
			return
		//select_widgets(new Set([fe]))
	}
	*/

	e.on_bind(function(on) {
		document.on('widget_tree_changed', widget_tree_changed, on)
		document.on('selected_widgets_changed', selected_widgets_changed, on)
		//document.on('focusin', focus_changed, on)
	})

})

// ---------------------------------------------------------------------------
// sql rowset editor
// ---------------------------------------------------------------------------

sql_rowset_editor = component('sql-rowset-editor', function(e) {
	e.class('sql-rowset-editor')
})

// ---------------------------------------------------------------------------
// sql schema editor
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// globals list
// ---------------------------------------------------------------------------

function globals_list() {

}

// ---------------------------------------------------------------------------
// toolboxes
// ---------------------------------------------------------------------------

css(`
	.dev-toolbox > .toolbox-titlebar,
	.dev-toolbox .widget
`, 'arial', `
	font-family: arial, sans-serif;
	font-size: 12px;
`)

css('.inspector .fa-eye, .inspector .fa-chevron, .inspector .fa-chevron-right', '', `
	font-size: 80%;
`)

css('prop-layers-inspector > .grid-header', '', `
	min-height: calc(2em + 1px);
`)

let dev_toolbox_props = {
	text: {slot: 'none'},
}

function prop_layers_toolbox(tb_opt, insp_opt) {
	let pg = prop_layers_inspector(assign_opt({
			id: 'dev_prop_layers_inspector',
		}, insp_opt))
	let tb = toolbox(assign_opt({
			id: 'dev_prop_layers_toolbox',
			classes: 'dev-toolbox',
			text: 'property layers',
			props: dev_toolbox_props,
			content: pg,
			can_select_widget: false,
		}, tb_opt))
	tb.inspector = pg
	return tb
}

function props_toolbox(tb_opt, insp_opt) {
	let pg = prop_inspector(assign_opt({
			id: 'dev_prop_inspector',
		}, insp_opt))
	let tb = toolbox(assign_opt({
			id: 'dev_props_toolbox',
			classes: 'dev-toolbox',
			text: 'properties',
			props: dev_toolbox_props,
			content: pg,
			can_select_widget: false,
		}, tb_opt))
	tb.inspector = pg
	pg.on('prop_inspector_changed', function() {
		tb.text = pg.title_text + ' properties'
	})
	return tb
}

function widget_tree_toolbox(tb_opt, wt_opt) {
	let wt = widget_tree(assign_opt({
			id: 'dev_widget_tree',
		}, wt_opt))
	let tb = toolbox(assign_opt({
			id: 'dev_widget_tree_toolbox',
			classes: 'dev-toolbox',
			text: 'widget tree',
			props: dev_toolbox_props,
			content: wt,
			can_select_widget: false,
		}, tb_opt))
	tb.tree = wt
	return tb
}

prop_layers_tb = null
props_tb = null
tree_tb = null

function show_toolboxes(on) {

	if (on == 'toggle')
		on = !prop_layers_tb

	if (on !== false) {
		prop_layers_tb = prop_layers_toolbox({
			popup_y: 2, w: 262, h: 225,
		})
		prop_layers_tb.show()

		props_tb = props_toolbox({
			popup_y: 230, w: 262, h: 397,
		}, {header_w: 80})
		props_tb.show()

		tree_tb = widget_tree_toolbox({
			popup_y: 630, w: 262, h: 311,
		})
		tree_tb.show()
	} else {

		prop_layers_tb.inspector.reset_to_default()

		prop_layers_tb.remove()
		props_tb.remove()
		tree_tb.remove()

		prop_layers_tb = null
		props_tb = null
		tree_tb = null
	}
}

// ---------------------------------------------------------------------------
// dialogs
// ---------------------------------------------------------------------------

function sql_rowset_editor_dialog() {
	let ed = sql_rowset_editor()
	let d = dialog({
		text: 'SQL Rowset Editor',
		content: ed,
	})
	d.editor = ed
	return d
}

// ---------------------------------------------------------------------------
// global key bindings
// ---------------------------------------------------------------------------

document.on('keydown', function(key, shift, ctrl) {
	if (key == 's' && ctrl) {
		xmodule.save()
		return false
	}
})

document.on('keydown', function(key) {
	if (key == 'F9')
		show_toolboxes('toggle')
})

function init_xmodule() {

	// id-based dynamic prop binding -----------------------------------------

	xm.nav_editor = function(...options) {
		return widget_select_editor(xm.instances, e => e.isnav, ...options)
	}

}
