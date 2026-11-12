(function() {
"use strict"

const ui = window.ui

const unit_plan_editor_def = {
	rowset_name: 'plan_data',
	key_col: 'plan',
	value_col: 'data',
	master_rowset_name: 'plans',
	label: 'Plan',
	empty_text: 'Select a plan',
	build: function(input_id, value, field, readonly) {
		ui.floor_editor(input_id, value, field, null, readonly)
	},
	update_value: ui.floor_editor_update_value,
	is_value_changed: ui.floor_editor_is_value_changed,
}

ui.unit_plan_editor = function(id, opt) {
	ui.nav_editor(id, opt, unit_plan_editor_def)
}

ui.unit_model_editor = function(id) {
	let rowset_name = unit_plan_editor_def.rowset_name
	let master_id = ui.master_id(id, 'plan', rowset_name)
	if (master_id)
		ui.mark_follows_source(master_id)
	let has_master_toggle = ui.has_master_toggle(rowset_name)
	let in_dock = ui.in_dock_tab()
	if (in_dock && has_master_toggle) {
		ui.open_tab_strip()
		ui.master_toggle(id, 'plan', rowset_name, true, 'Plan')
		ui.close_tab_strip()
	}
	ui.v(1, ui.sp())
		if (!in_dock && has_master_toggle) {
			ui.h(0, ui.sp())
				ui.master_toggle(id, 'plan', rowset_name, true, 'Plan')
			ui.end_h()
		}
		let master = ui.state_of(master_id)
		let house = master?.nav.focused_ri != null
			? ui.state_of(master.input_id, 'house') : null
		if (house)
			ui.house_model_editor(id+'.editor', house)
		else
			ui.text('', unit_plan_editor_def.empty_text, 1, 'c', 'c')
	ui.end_v()
}

}())
