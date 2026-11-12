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

}())
