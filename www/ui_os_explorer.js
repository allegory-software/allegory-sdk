(function() {
"use strict"

const ui = window.ui

// FEATURES
// * File names with folder and file icons.

// file name field

ui.field_types.os_file_name = {
	w: 8,
	text_color: "row.type == 'dir' ? 'marker' : 'text'",
	build: function(v, opt, nav, ri) {
		let s = this.to_text(v)
		if (!opt)
			return s
		let type = nav.cell_input_val(ri, nav.all_fields_map.type.fi)
		let icon = type == 'dir'
			? (nav.is_collapsed(ri) ? 'folder-filled' : 'folder-open-filled')
			: 'file-filled'
		ui.h(0, ui.sp05())
			ui.color(opt.fg)
			ui.icon('', icon, 0, 'c', 'c')
			this.build_text(s, opt)
		ui.end_h()
	},
}

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
		param_bar_vals: folder != null ? {folder: folder} : null,
		partial_load: true,
		field_attrs: {
			name: {type: 'os_file_name'},
			type: {text_color: "value == 'dir' ? 'marker' : 'text'"},
		},
	})
}

ui.open_ports = function(id) {
	ui.grid(id+'.grid', open_ports_opt)
}

}())
