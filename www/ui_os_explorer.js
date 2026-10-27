(function() {
"use strict"

const ui = window.ui

const process_tree_opt = { // process grid options
	rowset_name: 'os_explorer_processes',
}

const open_ports_opt = { // socket grid options
	rowset_name: 'os_explorer_ports',
}

ui.process_tree = function(id) {
	ui.grid(id+'.grid', process_tree_opt)
}

ui.folder_tree = function(id, folder) {
	ui.grid(id+'.grid', {
		rowset_name: 'os_explorer_files',
		param_vals: [{folder: folder}],
		partial_load: true,
	})
}

ui.open_ports = function(id) {
	ui.grid(id+'.grid', open_ports_opt)
}

}())
