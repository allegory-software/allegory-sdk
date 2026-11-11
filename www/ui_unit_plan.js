(function() {
"use strict"

const ui = window.ui

function unit_plan_editor_update(id, s) {
	let nav = s.nav
	let ri = nav.focused_ri
	if (ri == null)
		return
	let plan = nav.cell_input_val(ri, nav.all_fields_map.plan.fi)
	let input_id = id+'.floor.'+plan
	let save = nav.ready && !s.readonly
		&& ui.focus_inside(id) && ui.keydown('ctrl s')
	if (save)
		ui.floor_editor_update_value(input_id)
	let value = ui.interaction_value(input_id)
	if (value !== undefined)
		nav.set_cell_val(ri, nav.all_fields_map.data.fi, value, {input: nav})
	if (save)
		nav.save()
}

ui.unit_plan_editor = function(id, opt) {
	let s = ui.state(id, unit_plan_editor_update)
	if (!s.nav) {
		s.nav = ui.nav(id, {rowset_name: 'plan_data', ...opt})
		ui.on_free(id, s.nav.free)
	}
	let readonly = opt?.readonly
	s.readonly = readonly
	let nav = s.nav
	nav.can_change_rows = !readonly && (opt?.can_change_rows ?? true)
	nav.check_dependencies()
	let ri = nav.focused_ri
	let plan = ri != null ? nav.cell_input_val(ri,
		nav.all_fields_map.plan.fi) : null

	let has_master_toggle = ui.has_master_toggles(nav)
	let in_dock = ui.in_dock_tab()
	if (in_dock && has_master_toggle) {
		ui.open_tab_strip()
		ui.master_toggle(id, 'plan', 'plans', true, 'Plan')
		ui.close_tab_strip()
	}

	let floor_id = id+'.floor.'+plan

	ui.focus_group(false, null, id)
	ui.v(1, ui.sp())
		if (!in_dock && has_master_toggle) {
			ui.h(0, ui.sp())
				ui.master_toggle(id, 'plan', 'plans', true, 'Plan')
			ui.end_h()
		}
		if (nav.load_error)
			ui.text('', nav.load_error, 0)
		let row_error = ri != null && nav.row_errors[ri]?.[0]?.error
		if (row_error)
			ui.text('', row_error, 0)
		if (ri != null) {
			let field = nav.all_fields_map.data
			ui.floor_editor(floor_id, nav.cell_input_val(ri, field.fi), field,
				null, !nav.can_change_val(ri, field.fi))
		} else {
			ui.text('', 'Select a plan', 1, 'c', 'c')
		}
	ui.end_v()
	ui.end_focus_group()
}

}())
