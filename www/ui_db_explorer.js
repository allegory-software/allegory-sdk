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
	build_table_rows(id, ui.bind_master(id, 'table', 'db_explorer_tables'))
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
