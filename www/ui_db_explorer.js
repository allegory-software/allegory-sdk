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

ui.db_explorer = function(id) {
	ui.dock(id+'.dock', layout, function(tab) {
		if (tab.id == 'tables') {
			ui.grid(id+'.tables', {
				rowset_name: 'db_explorer_tables',
				can_add_rows: false,
				can_remove_rows: false,
				can_change_rows: false,
				can_move_rows: false,
				cell_select_mode: true,
				filter_bar_visible: true,
			})
		} else {
			let tables_nav = ui.state_of(id+'.tables', 'nav')
			let table_name = tables_nav?.focused_row_cell_val('name')
			ui.grid(id+'.'+(tab.id == 'rows' ? table_name+'.' : '')+tab.id, {
				rowset_name: 'db_explorer_'+tab.id,
				param_bindings: {[id+'.tables']: 'table'},
				can_move_rows: false,
			})
		}
	}, {can_add_remove_tabs: false})
}

}())
