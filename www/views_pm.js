(function() {
"use strict"

const ui = window.ui

const plan_editor_def = {
	rowset_name: 'plan_data',
	key_col: 'plan',
	value_col: 'data',
	master_rowset_name: 'plans',
	label: 'Plan',
	empty_text: 'Select a plan',
	build: function(input_id, value, field, readonly) {
		ui.floor_editor(input_id, value, field, null, readonly)
	},
}

ui.plan_editor = function(id, opt) {
	ui.nav_editor(id, opt, plan_editor_def)
}

ui.plan_model_editor = function(id) {
	let rowset_name = plan_editor_def.rowset_name
	let master_id = ui.master_id(id, 'plan', rowset_name)
	if (master_id)
		ui.mark_follows_source(master_id)
	let has_master_toggle = ui.has_master_toggle(rowset_name)
	let in_dock = ui.in_dock_tab()
	if (in_dock && has_master_toggle) {
		ui.begin_master_toggle_bar(true)
			ui.master_toggle(id, 'plan', rowset_name, true, 'Plan')
		ui.end_master_toggle_bar(true)
	}
	ui.v(1, ui.sp())
		if (!in_dock && has_master_toggle) {
			ui.begin_master_toggle_bar(false)
				ui.master_toggle(id, 'plan', rowset_name, true, 'Plan')
			ui.end_master_toggle_bar(false)
		}
		let master = ui.state_of(master_id)
		let house = master?.nav.focused_ri != null
			? ui.state_of(master.input_id, 'house') : null
		if (house) {
			let nav = master.nav
			let plan = nav.cell_input_val(nav.focused_ri, nav.all_fields_map.plan.fi)
			ui.house_model_editor(id+'.editor.'+plan, house,
				ui.state_of(master.input_id, 'floor'), null, null, null,
				ui.state_of(master.input_id, 'readonly'))
		} else
			ui.text('', plan_editor_def.empty_text, 1, 'c', 'c')
	ui.end_v()
}

ui.views.plan_editor = {
	label: 'Plan editor', icon: 'layout-board', category: 'Editors',
	build: function(id) { ui.plan_editor(id+'.widget') },
}

ui.views.plan_model_editor = {
	label: 'Plan model editor', icon: 'building-cottage', category: 'Editors',
	build: function(id) { ui.plan_model_editor(id+'.widget') },
}

// 3D model editor -----------------------------------------------------------

const model_editor_opt = {readonly: false} // read during the call

const model_editor_def = {
	rowset_name: 'model_data',
	key_col: 'model',
	value_col: 'data',
	master_rowset_name: 'models',
	label: 'Model',
	empty_text: 'Select a model',
	build: function(input_id, value, field, readonly) {
		model_editor_opt.readonly = readonly
		ui.model3_editor(input_id, value, field, model_editor_opt)
	},
	update_value: ui.model3_editor_update_value,
	is_value_changed: ui.model3_editor_is_value_changed,
	revert_value: ui.model3_editor_revert_value,
}

ui.views.model3_editor = {
	label: '3D Model Editor', icon: 'cube', category: 'Editors',
	build: function(id) {
		ui.nav_editor(id+'.widget', null, model_editor_def)
	},
}

}())
