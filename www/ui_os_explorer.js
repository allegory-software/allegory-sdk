(function() {
"use strict"

const ui = window.ui

ui.color_def('light', 'file-dir'     , 'normal',  44, 0.80, 0.36)
ui.color_def('dark' , 'file-dir'     , 'normal',  44, 0.85, 0.68)
ui.color_def('light', 'file-file'    , 'normal',   0, 0.00, 0.35)
ui.color_def('dark' , 'file-file'    , 'normal',   0, 0.00, 0.80)
ui.color_def('light', 'file-symlink' , 'normal', 190, 0.85, 0.30)
ui.color_def('dark' , 'file-symlink' , 'normal', 190, 0.65, 0.70)
ui.color_def('light', 'file-socket'  , 'normal', 275, 0.60, 0.40)
ui.color_def('dark' , 'file-socket'  , 'normal', 275, 0.70, 0.75)
ui.color_def('light', 'file-pipe'    , 'normal', 145, 0.65, 0.28)
ui.color_def('dark' , 'file-pipe'    , 'normal', 145, 0.55, 0.65)
ui.color_def('light', 'file-blockdev', 'normal',  25, 0.85, 0.36)
ui.color_def('dark' , 'file-blockdev', 'normal',  25, 0.85, 0.68)
ui.color_def('light', 'file-chardev' , 'normal', 340, 0.65, 0.42)
ui.color_def('dark' , 'file-chardev' , 'normal', 340, 0.75, 0.74)
ui.color_def('light', 'file-unknown' , 'normal',   0, 0.00, 0.48)
ui.color_def('dark' , 'file-unknown' , 'normal',   0, 0.00, 0.60)

const file_type_icons = { // {filesystem type -> icon name}
	file     : 'file-filled',
	symlink  : 'file-symlink',
	socket   : 'plug',
	pipe     : 'pipeline',
	blockdev : 'device-floppy-filled',
	chardev  : 'keyboard-filled',
}

ui.field_types.os_file_name = {
	w: 8,
	text_color: "'file-' + (row.type || 'unknown')",
	build: function(v, opt, nav, ri) {
		let s = this.to_text(v)
		if (!opt)
			return s
		let type = nav.cell_input_val(ri, nav.all_fields_map.type.fi)
		let icon = type == 'dir'
			? (nav.is_collapsed(ri) ? 'folder-filled' : 'folder-open-filled')
			: file_type_icons[type] ?? 'file-unknown-filled'
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
	ui.set_current_tab_title('Process tree')
}

ui.folder_tree = function(id, folder) {
	ui.grid(id+'.grid', {
		rowset_name: 'os_explorer_files',
		param_bar_vals: folder != null ? {folder: folder} : null,
		partial_load: true,
		field_attrs: {
			name: {type: 'os_file_name'},
			type: {text_color: "'file-' + (value || 'unknown')"},
		},
	})
	let nav = ui.state_of(id+'.grid', 'nav')
	let title = nav.param_vals('folder')?.[0]
	if (title != null)
		ui.set_current_tab_title(title)
}

ui.open_ports = function(id) {
	ui.grid(id+'.grid', open_ports_opt)
	ui.set_current_tab_title('Open ports')
}

// file contents editor

function file_editor_update(id, s) {
	let nav = s.nav
	let ri = nav.focused_ri
	if (ri == null)
		return
	let field = nav.all_fields_map.contents
	let save = ui.focus_inside(id) && ui.keydown('ctrl s')
	if (save)
		ui.code_edit_update_value(id+'.editor')
	let value = ui.interaction_value(id+'.editor')
	if (value !== undefined)
		nav.set_cell_val(ri, field.fi, value, {input: nav})
	if (save)
		nav.save()
}

ui.file_editor = function(id) {
	let s = ui.state(id, file_editor_update)
	if (!s.nav) {
		s.nav = ui.nav(id, {rowset_name: 'os_explorer_file'})
		ui.on_free(id, s.nav.free)
	}
	let nav = s.nav
	nav.reload_if_params_changed()
	let title = nav.param_vals('path')?.[0]
	if (title != null)
		ui.set_current_tab_title(title)
	let ri = nav.focused_ri
	if (ri == null)
		return
	let field = nav.all_fields_map.contents
	let path = nav.cell_input_val(ri, nav.all_fields_map.path.fi)
	let lang = path.match(/\.([^./]+)$/)?.[1].toLowerCase()
	ui.focus_group(false, null, id)
		ui.code_edit(id+'.editor', nav.cell_input_val(ri, field.fi), field,
			{lang: lang})
	ui.end_focus_group()
}

}())
