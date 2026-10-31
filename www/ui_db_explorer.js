(function() {
"use strict"

const ui = window.ui

let layout = { // initial dock layout
	split: 'h', size: .25, unit: 'fr',
	side1: {tabs: [{id: 'tables', label: 'Tables'}]},
	side2: {tabs: [
		{id: 'rows', label: 'Content'},
		{id: 'fields', label: 'Fields'},
		{id: 'indexes', label: 'Indexes'},
	]},
}

const tables_opt = { // table grid options
	rowset_name: 'db_explorer_tables',
	cell_select_mode: true,
	filter_bar_visible: true,
}

// the rows of the table focused in the table grid tables_id: a table_NAME
// grid for a base table, a db_explorer_raw grid for an index table or a
// table without a schema, and nothing without a focused table.
function build_table_rows(id, tables_id) {
	let tables_nav = ui.state_of(tables_id, 'nav')
	let table_name = tables_nav?.focused_row_cell_val('name')
	if (table_name == null)
		return
	if (tables_nav.focused_row_cell_val('raw')) {
		ui.grid(id+'.raw_rows', {
			rowset_name: 'db_explorer_rows_raw',
			param_bindings: {[tables_id]: 'table'},
		})
	} else {
		ui.grid(id+'.'+table_name+'.rows', {
			rowset_name: 'db_explorer_rows_'+table_name,
		})
	}
}

ui.db_tables = function(id) {
	ui.grid(id+'.grid', tables_opt)
}

ui.db_rows = function(id) {
	let toggle_id = id+'.master.table'
	let rowset_name = tables_opt.rowset_name
	let picked_id = ui.interaction_value(toggle_id) // nav id
	if (picked_id !== undefined)
		ui.set_master_id(id, 'table', picked_id)
	let master_id = ui.master_id(id, 'table', rowset_name)
	let has_master_toggle = ui.has_master_toggle(rowset_name)
	if (ui.in_dock_tab() && has_master_toggle) {
		ui.open_tab_strip()
		ui.pr(ui.sp())
		ui.h(0, ui.sp(), 'r', 'c')
			ui.master_toggle(toggle_id, rowset_name, master_id, 'Table')
		ui.end_h()
		ui.close_tab_strip()
	}
	ui.v()
		if (!ui.in_dock_tab() && has_master_toggle) {
			ui.h(0, ui.sp(), 'l', 'c')
				ui.master_toggle(toggle_id, rowset_name, master_id, 'Table')
			ui.end_h()
		}
		build_table_rows(id, master_id)
	ui.end_v()
}

ui.db_explorer = function(id) {
	ui.dock(id+'.dock', layout, function(tab) {
		if (tab.id == 'tables') {
			ui.grid(id+'.tables', tables_opt)
		} else if (tab.id == 'rows') {
			build_table_rows(id, id+'.tables')
		} else {
			ui.grid(id+'.'+tab.id, {
				rowset_name: 'db_explorer_'+tab.id,
				param_bindings: {[id+'.tables']: 'table'},
				can_move_rows: false,
			})
		}
	}, {can_add_remove_tabs: false})
}

}())
