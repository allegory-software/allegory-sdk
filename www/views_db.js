(function() {
"use strict"

const ui = window.ui

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
			param_bindings: {table: tables_id},
		})
	} else {
		ui.grid(id+'.'+table_name+'.rows', {
			rowset_name: 'db_explorer_rows_'+table_name,
		})
	}
}

ui.db_tables = function(id) {
	ui.grid(id+'.grid', tables_opt)
	ui.set_current_tab_title('Tables')
}

ui.db_rows = function(id) {
	let rowset_name = tables_opt.rowset_name
	let master_id = ui.master_id(id, 'table', rowset_name)
	if (master_id)
		ui.mark_follows_source(master_id)
	let has_master_toggle = ui.has_master_toggle(rowset_name)
	if (ui.in_dock_tab() && has_master_toggle) {
		ui.open_tab_strip()
		ui.pr(ui.sp())
		ui.h(0, ui.sp(), 'r', 'c')
			ui.master_toggle(id, 'table', rowset_name, true, 'Table')
		ui.end_h()
		ui.close_tab_strip()
	}
	ui.v()
		if (!ui.in_dock_tab() && has_master_toggle) {
			ui.h(0, ui.sp(), 'l', 'c')
				ui.master_toggle(id, 'table', rowset_name, true, 'Table')
			ui.end_h()
		}
		build_table_rows(id, master_id)
	ui.end_v()
}

ui.db_fields = function(id) {
	ui.set_current_tab_title('Fields')
	ui.grid(id+'.grid', {
		rowset_name: 'db_explorer_fields',
		can_move_rows: false,
	})
}

ui.db_indexes = function(id) {
	ui.set_current_tab_title('Indexes')
	ui.grid(id+'.grid', {
		rowset_name: 'db_explorer_indexes',
		can_move_rows: false,
	})
}

ui.views.db_tables = {
	label: 'Tables', icon: 'list-details', category: 'Database',
	build: ui.db_tables,
}

ui.views.db_rows = {
	label: 'Rows', icon: 'table-row', category: 'Database',
	build: ui.db_rows,
}

ui.views.db_fields = {
	label: 'Fields', icon: 'table-column', category: 'Database',
	build: ui.db_fields,
}

ui.views.db_indexes = {
	label: 'Indexes', icon: 'list-search', category: 'Database',
	build: ui.db_indexes,
}

}())
