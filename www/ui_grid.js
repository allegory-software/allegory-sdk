/*

	UI editable virtual tree grid.
	Written by Cosmin Apreutesei. Public Domain.

*/

(function () {
"use strict"
const _G = window
const ui = _G.ui

const {
	pr,
	round, min, max, floor, ceil, abs, clamp,
	array_move, assign, copy_to_clipboard, empty_array,
	noop,
	S,
} = glue

const {
	cx,
} = ui

ui.GRID_FAST_PATH = true

ui.capture_keydown('f1') // browser: help -> grid: key help

/* icon aliases --------------------------------------------------------------

The grid names its icons; the codepoints live here so that loading a
different icon font only means redefining these.

*/

ui.icon_def('node_collapsed', 'tabler', '\ueb2a')
ui.icon_def('node_expanded' , 'tabler', '\ueb29')
ui.icon_def('sort_asc'      , 'tabler', '\ueb26')
ui.icon_def('sort_desc'     , 'tabler', '\ueb27')
ui.icon_def('sort_none'     , 'tabler', '\ueb5a')
ui.icon_def('arrow_up'      , 'tabler', '\uea25')
ui.icon_def('arrow_down'    , 'tabler', '\uea16')

// draw all the visible cells of one field in a single command.
// each cell gets (bg, bg_state, fg, text).
ui.widget('fast_field', {
	create: function(cmd, x0, y0, w, cell_h, cell_dx, cell_dy,
		pad, align, baseline, n
	) {
		let i = ui.cmd_begin(cmd)
		ui.cmd_add_arg(x0)
		ui.cmd_add_arg(y0)
		ui.cmd_add_arg(w)
		ui.cmd_add_arg(cell_h)
		ui.cmd_add_arg(cell_dx)
		ui.cmd_add_arg(cell_dy)
		ui.cmd_add_arg(pad)
		ui.cmd_add_arg(align)
		ui.cmd_add_arg(baseline)
		ui.cmd_add_arg(n)
		return i
	},
	translate: function(a, i, dx, dy) {
		a[i+0] += dx
		a[i+1] += dy
	},
	draw: function(a, i) {
		let x0       = a[i+0]
		let y0       = a[i+1]
		let w        = a[i+2]
		let cell_h   = a[i+3]
		let cell_dx  = a[i+4]
		let cell_dy  = a[i+5]
		let pad      = a[i+6]
		let align    = a[i+7]
		let baseline = a[i+8]
		let n        = a[i+9]

		// backgrounds and borders, which span the whole cell and so
		// have to be drawn before the text clip narrows it to the padding.
		let k = i + 10
		for (let ri = 0; ri < n; ri++) {
			let bg   = a[k+0]
			let bgs  = a[k+1]
			k += 4
			let x = x0 + ri * cell_dx
			let y = y0 + ri * cell_dy
			let fg_theme
			if (bg) {
				let c = ui.color_obj(bg, bgs)
				let dark = c[5] ?? c[3] < .5
				fg_theme = dark ? 'dark' : 'light'
				cx.fillStyle = c[0]
				cx.fillRect(x, y, w, cell_h)
			}
			cx.strokeStyle = ui.color_css('light', null, fg_theme)
			cx.beginPath()
			cx.moveTo(x, y + cell_h - .5)
			cx.lineTo(x + w, y + cell_h - .5)
			cx.stroke()
		}

		// text, cut at the padded box like ui.text() cuts it in a slow cell.
		let has_one_clip = cell_dx == 0
		if (has_one_clip) {
			cx.save()
			cx.beginPath()
			cx.rect(x0 + pad, y0, w - 2 * pad, n * cell_h)
			cx.clip()
		}

		cx.textAlign = align
		let anchor_dx =
			align == 'right' ? w - pad :
			align == 'center' ? w / 2 :
			pad
		k = i + 10
		for (let ri = 0; ri < n; ri++) {
			let bg   = a[k+0]
			let bgs  = a[k+1]
			let fg   = a[k+2]
			let text = a[k+3]
			k += 4
			if (text) {
				let x = x0 + ri * cell_dx
				let y = y0 + ri * cell_dy
				let fg_theme
				if (bg) {
					let c = ui.color_obj(bg, bgs)
					fg_theme = (c[5] ?? c[3] < .5) ? 'dark' : 'light'
				}
				cx.fillStyle = ui.color_css(fg, null, fg_theme)
				if (has_one_clip) {
					cx.fillText(text, x + anchor_dx, y + baseline)
				} else {
					cx.save()
					cx.beginPath()
					cx.rect(x + pad, y, w - 2 * pad, cell_h)
					cx.clip()
					cx.fillText(text, x + anchor_dx, y + baseline)
					cx.restore()
				}
			}
		}
		if (has_one_clip)
			cx.restore()
	},
})

function make_help_lines(horiz) {
	return [
		'Move',
		'',
		'\u2190\u2191\u2192\u2193: Move between cells',
		'PgUp/PgDn: Jump page',
		'Home/End: Jump to beginning / end',
		'',
		'Select',
		'',
		'Shift+\u2190\u2191\u2192\u2193: Select range',
		'Shift+Click: Select range',
		'Ctrl+Click: Select / unselect cell',
		'Ctrl+A: Select all cells',
		'',
		'Edit',
		'',
		'Enter: Enter / exit cell edit mode',
		'F2: Enter / exit vertical edit mode',
		'Ctrl+Enter: Enter / exit quick-edit mode',
		horiz
			? 'Ctrl+\u2190\u2192: Move & quick-edit cells'
			: 'Ctrl+\u2191\u2193: Move & quick-edit cells',
		'Esc: Cancel the edit',
		'Ctrl+Delete: Empty the cells',
		horiz
			? 'Space: Toggle checkbox / expand tree node'
			: 'Space: Toggle checkbox',
		'',
		'Add & Remove Rows',
		'',
		'Insert: Insert row',
		horiz
			? '\u2193 on last row: Add row'
			: '\u2192 on last row: Add row',
		'Ctrl+Insert: Insert a copy of the focused row',
		'Delete: Delete the selected rows',
		'',
		'Copy & Paste',
		'',
		'Ctrl+C: Copy the cell',
		'Ctrl+S: Save',
		'',
		'Quick Search',
		'',
		horiz
			? 'Just type: Search in column'
			: 'Just type: Search in row',
	]
}
let horiz_help_lines    = make_help_lines(true)
let vertical_help_lines = make_help_lines(false)

let number_filter_help_lines = [
	'Number & Date Filter',
	'',
	'n: Equal to n (a number or a date)',
	'a..b: From a to b',
	'>n >=n <n <=n: Compare with n',
	'!filter: Negate the filter',
	'Invalid filter: Shows no rows',
]

let text_filter_help_lines = [
	'Text Filter',
	'',
	'text: Contains text',
	'^text: Starts with text',
	'text$: Ends with text',
	'=text: Equal to text',
	'=: Empty',
	'~text: Contains text, with ^ and $ taken literally',
	'!filter: Negate the filter',
	'Letter case: Ignored',
]

function build_help(id, target_i, help_lines) {
	ui.m(ui.sp2())
	ui.p(ui.sp4())
	ui.popup(id+'.help', 'overlay', target_i, 'b', '[',
		'change_side constrain')
		ui.bb_tooltip('bg2', null, 'light', null, ui.sp05())
		ui.v_aligned(0)
			for (let line of help_lines) {
				let ci = line.indexOf(':')
				let t = ci == -1 ? line : null
				let key = !t ? line.slice(0, ci).trim() : ''
				let desc = !t ? line.slice(ci+2).trim() : ''
				if (t) {
						ui.bold()
						ui.color('text')
						ui.font_size(1.25)
						ui.text('', t, 0, 'l', 'c')
				} else {
					ui.pv(ui.sp025())
					ui.h(0, ui.sp4())
						ui.bold()
						ui.color('text', 'active')
						ui.text('', key, 0, 'l', 'c')
						ui.nobold()
						ui.color('text')
						ui.text('', desc, 0, 'l', 'c')
					ui.end_h()
				}
			}
		ui.end_v_aligned()
	ui.end_popup()
}

function init(id, e) {

	e.cell_border_v_width = 0
	e.cell_border_h_width = 1

	e.auto_expand       ??= false  // expand cells instead of scrollboxing them
	e.vertical_layout   ??= false
	e.header_align      ??= 'l'
	e.group_bar_visible ??= 'auto' // auto | always | no
	e.filter_bar_visible ??= false

	e.row_w    = ui.saved_state[id]?.row_w    ?? 12
	e.header_w = ui.saved_state[id]?.header_w ?? 10

	let horiz = !e.vertical_layout

	// context-sensitive thus set on each frame
	let sp
	let sp2
	let font_size
	let line_height
	let cells_w
	let cells_h
	let cell_h
	let row_w // vertical layout
	let header_w // vertical layout
	let header_h
	let gcol_w
	let gcol_h
	let gcol_gap
	// cells-view-height-sensitive thus set on frame callback
	let page_row_count = 1

	// mouse state
	let ps
	let gcol_mover
	let hit_zone // sort_icon, col_divider, header_divider, row_divider,
	             // col, gcol, cell
	let drag_op  // col_move, col_group, row_move
	let hit_vri // index in visible_ris
	let hit_vfi // index in visible_fields
	let hit_gcol // group-bar column name
	let hit_indent
	let row_move_state

	let help_open
	let filter_help_field
	let clicked_indent

	function reset_mouse_state() {
		hit_zone = null
		hit_vri = null
		hit_vfi = null
		hit_gcol = null
		hit_indent = null
		ps = null
		drag_op = null
		gcol_mover = null
		row_move_state = null
	}

	// keyboard state
	let focused, shift, ctrl
	let keydown = key => focused && ui.keydown(key)

	// The grid owns the editor widget; the nav decides which cell to edit.
	let edit_ri = null // edited row, or null when no editor is built
	let edit_field = null // edited field
	let editor_id = null // id of the editor widget
	let want_dropdown_open = false // open the editor's dropdown when built

	// Where to scroll in build().
	let scroll_to_vri = e.focused_vri()
	let scroll_to_vfi = e.focused_vfi()

	function focused_field() {
		return e.focused_fi != null ? e.all_fields[e.focused_fi] : null
	}

	function quicksearch_fi() {
		return e.focused_fi
			?? (e.quicksearch_col != null
				? e.all_fields_map[e.quicksearch_col] : e.display_field)?.fi
			?? null
	}

	function edit_selection() {
		let field = focused_field()
		return field.has_editor
			? field.editor_selection(editor_id, e.field_align(field))
			: [e.edit_sel_i, e.edit_sel_len]
	}

	function caret_at_edge(d) {
		let field = focused_field()
		return field.editor_caret_at_edge(editor_id, d, e.field_align(field))
	}

	// focus ------------------------------------------------------------------

	e.scroll_to_cell = function(vri, vfi) {
		scroll_to_vri = vri
		scroll_to_vfi = vfi
	}

	// rows -------------------------------------------------------------------

	function toggle_collapsed(ri, recursive) {
		e.set_collapsed(ri, !e.is_collapsed(ri), recursive)
	}

	function selected_ris() {
		let ris = []
		e.each_selected_row(ri => ris.push(ri))
		return ris
	}

	// editing ----------------------------------------------------------------

	function is_editor_focused() {
		return editor_id != null
			&& (ui.focused(editor_id) || ui.focus_inside(editor_id))
	}

	// Return true if we built an editor for the cell being edited.
	function is_edit_built() {
		return edit_ri != null && e.editing
			&& e.focused_ri == edit_ri && focused_field() == edit_field
	}

	// Close the previous editor when the nav ends an edit or starts editing
	// another cell. Focus the new editor only if the grid or the previous
	// editor had focus.
	function sync_editor() {
		let ri = e.editing ? e.focused_ri : null
		let field = e.editing ? focused_field() : null
		if (ri == edit_ri && field == edit_field)
			return
		let had_focus = is_editor_focused()
		if (edit_field?.has_editor)
			edit_field.close_dropdown?.(editor_id)
		edit_ri = ri
		edit_field = field
		editor_id = field
			? (field.lookup_rowset_name || field.type) + '.editor' : null
		want_dropdown_open = !!field?.has_editor && e.edit_open_popup
		if (field?.has_editor && (focused || had_focus)) {
			// Request focus now; we build the editor's input later in this pass.
			field.focus_editor(editor_id, e.edit_sel_i, e.edit_sel_len)
		} else if (had_focus) {
			// Return focus to the grid only if the old editor still had it.
			ui.focus(id)
		}
	}

	// cross: move along the other axis than the advance_on_enter axis.
	function advance_edit(cross, d) {
		let by_row = (e.advance_on_enter == 'next_row') != cross
		let opt = {input: e, sel_i: 0, sel_len: 1/0,
			must_move: true, enter_edit: true, advance_on_exit: true,
			open_popup: true}
		if (by_row)
			return e.move_focus(true, true, d, 0, opt)
		else
			return e.focus_next_cell(d, opt)
	}

	// an edit that enter started is only exited by it; one started by F2 or
	// by a click moves on. exit first: nowhere to move to still ends it.
	function end_edit_like_enter(cross, d) {
		if (!e.advance_on_exit || e.exit_edit_on_enter) {
			e.exit_edit()
		} else if (e.advance_on_enter) {
			if (!advance_edit(cross, d))
				e.exit_edit()
		}
	}

	function field_has_indent(field) {
		return field == e.tree_field
	}

	function sort_icon_w(field) {
		return field.sortable ? 2 * sp2 : 0
	}

	function col_min_w(field) {
		return max(field.min_w * font_size, sort_icon_w(field))
	}

	function clamp_vertical_w(w) {
		return clamp(w, 2 * font_size, 50 * font_size)
	}

	function filter_box_id(field) {
		return id+'.filter.'+field.name
	}

	function build_filter_cell(field) {
		if (horiz) {
			ui.m(field._x, 0, 0, 0)
			ui.min_w(field._w)
		} else {
			ui.m(0, field._y, 0, 0)
			ui.min_wh(header_w, cell_h)
		}
		let cell_i = ui.stack('', 0, 'l', 't')
			if (field == filter_help_field)
				build_help(id+'.filter', cell_i,
					field.filter_field.is_number_filter
						? number_filter_help_lines : text_filter_help_lines)
			ui.box_args(1, 's', 's')
			ui.field_input(filter_box_id(field), field.filter,
				{field: field.filter_field, w: 0})
		ui.end_stack()
	}

	function indent_offset(indent) {
		return floor(font_size * 1.5 + (font_size * 1.2) * indent)
	}

	let CS = {}
	function cell_state(ri, field, vri, build_stage) {
		let fi = field.fi
		let input_val = e.cell_input_val(ri, fi)

		let grid_focused = focused
		let row_focused = e.focused_ri == ri
		let field_focused = e.focused_fi == fi
		let cell_focused = row_focused
			&& (!e.cell_select_mode || field_focused)
		let disabled = !e.can_focus_cell(ri, fi)
		let is_new = e.is_new(ri)
		let cell_invalid = e.cell_has_errors(ri, fi)
		let modified = e.is_cell_modified(ri, fi)
		let is_null = input_val == null
		let is_empty = input_val === ''
		let selected = e.is_cell_selected(ri, fi)
		let editing = edit_ri == ri && edit_field == field

		let bg, bgs

		if (build_stage == 'col_move' || build_stage == 'row_move')
			bg = 'bg2'
		else if (build_stage == 'col_group')
			bg = 'bg0'
		if (editing) {
			bg = 'input'
			bgs = 'focused'
		} else if (cell_invalid) {
			bg = 'item'
			bgs = grid_focused && cell_focused ? 'item-error item-focused' : 'item-error'
		} else if (cell_focused) {
			bg = 'item'
			if (selected)
				bgs = grid_focused
					? 'item-focused item-selected focused'
					: 'item-focused item-selected'
			else
				bgs = grid_focused
					? 'item-focused focused'
					: 'item-selected'
		} else if (selected) {
			bg = 'item'
			bgs = grid_focused ? 'item-selected focused' : 'item-selected'
		} else if (is_new) {
			bg = 'item'
			bgs = modified ? 'new modified' : 'new'
		} else if (modified) {
			bg = 'item'
			bgs = 'modified'
		} else if (row_focused) {
			bg = 'row'
			bgs = grid_focused ? 'item-focused focused' : 'item-focused'
		}
		if (!bg) {
			if (e.is_group_row(ri))
				bg = null
			else if ((vri & 1) == 0)
				bg = 'alt'
			else
				bg = 'bg'
		}

		let fg
		if (build_stage == 'col_group')
			fg = 'faint'
		else if (is_null || is_empty || disabled)
			fg = 'label'
		else
			fg = 'text'

		CS.input_val = input_val
		CS.bg = bg
		CS.bgs = bgs
		CS.fg = fg
		CS.editing = editing
		CS.is_null = is_null
		CS.is_empty = is_empty
		CS.row_focused = row_focused
		CS.field_focused = field_focused
		CS.cell_focused = cell_focused
		return CS
	}

	// field.build() options, rewritten for each cell.
	let build_opt = {fg: null, align: null, full_width: false, readonly: false}

	function build_cell_at(a, ri, field, vri, vfi, x, y, w, h, build_stage) {

		let cs = cell_state(ri, field, vri, build_stage)
		let input_val = cs.input_val
		let bg = cs.bg, bgs = cs.bgs, fg = cs.fg, editing = cs.editing
		let row_focused = cs.row_focused
		let field_focused = cs.field_focused

		let hovering = hit_zone == 'cell' && hit_vri == vri && hit_vfi == vfi
		let align = e.field_align(field)
		let full_width = !build_stage
			&& ((row_focused && field_focused) || hovering)
			&& (align == 'left' || !field_has_indent(field))

		let indent_x = 0
		let collapsed
		let has_children
		if (field_has_indent(field)) {
			indent_x = indent_offset(e.depth[ri])
			has_children = e.has_children(ri)
			if (has_children)
				collapsed = e.is_collapsed(ri)
			let s = row_move_state
			if (s) {
				// show minus sign on adopting parent.
				if (ri == s.hit_parent_ri && collapsed == null)
					collapsed = false

				// shift indent on moving rows so it gets under the adopting parent.
				if (build_stage == 'row_move')
					indent_x += s.hit_indent_x - s.indent_x
			}
		}

		// frame building
		let sp2 = ui.sp2()
		let pad_l = sp2 + indent_x
		let pad_r = sp2
		let cell_x = x
		let cell_w = w
		// because ui.text doesn't support overflow direction (ui.text overflows
		// always to the right), we need to expand the overflown cell and shift
		// it left for right and center align.
		if (full_width && field.builds_text) {
			let s = e.cell_text(ri, field.fi)
			if (s) {
				cell_w = max(w, ceil(ui.measure_text(cx, s).width) + pad_l + pad_r)
				let overflow = cell_w - w
				cell_x = x - (
					align == 'center' ? round(overflow / 2) :
					align == 'right' ? overflow : 0)
			}
		}

		// render help
		ui.m(cell_x, y, 0, 0)
		ui.min_wh(cell_w, h)
		let cell_i = ui.stack('', 0, 'l', 't')
			ui.bb(bg, bgs,
				build_stage == 'col_move' ? (horiz ? 'lrb' : 'tb') : 'b', 'light')
			if (help_open && !build_stage && row_focused && field_focused)
				build_help(id, cell_i,
					horiz ? horiz_help_lines : vertical_help_lines)

			if (has_children) {
				ui.p(indent_x - sp2, 0, sp2, 0)
				ui.color(fg)
				ui.icon('', collapsed ? 'node_collapsed' : 'node_expanded')
			}
			// a popup editor covers the cell instead of replacing it, and
			// the popup can be moved off the cell to fit on screen.
			if (!editing || build_stage || field.edits_in_popup || !field.has_editor) {
				ui.p(pad_l, 0, pad_r, 0)
				if (row_focused && e.quicksearch_text
					&& field.fi == quicksearch_fi())
					ui.mark_text(0, e.quicksearch_text.length)
				build_opt.fg = fg
				build_opt.align = align
				build_opt.full_width = full_width
				build_opt.readonly = !e.can_change_val(ri, field.fi)
				if (field.is_group_field && e.is_group_row(ri)) {
					build_opt.readonly = true
					build_opt.full_width = true
					ui.h(0, 0, align, 's')
						let has_key = false
						for (let group_col of e.group_cols) {
							if (group_col.group_level != e.depth[ri])
								continue
							if (has_key) {
								ui.color(fg)
								ui.text('', ' / ', 0, 'l', 'c')
							}
							let field = group_col.field
							let v = e.cell_input_val(ri, field.fi)
							e.build_val(ri, field, v, build_opt)
							has_key = true
						}
					ui.end_h()
				} else {
					e.build_val(ri, field, input_val, build_opt)
				}
				ui.p(0) // build_val() builds nothing for a value with no text!
			}
			if (editing && !build_stage && field.has_editor) {
				ui.focus_group(true, null, editor_id)
				field.build_editor(editor_id, input_val, pad_l, pad_r, h, align)
				want_dropdown_open = false
				ui.end_focus_group()
			}
			ui.p(0)
		ui.end_stack()

	}

	let cell_rect
	{
	let r = [0, 0, 0, 0]
	cell_rect = function(vri, vfi) {
		let field = e.visible_fields[vfi]
		let x, y, w
		if (horiz) {
			x = field._x
			y = vri * cell_h
			w = field._w
		} else {
			x = vri * row_w
			y = field._y
			w = row_w
		}
		r[0] = x
		r[1] = y
		r[2] = w
		r[3] = cell_h
		return r
	}
	}

	function build_cell(a, vri, vfi, build_stage) {
		let [x, y, w, h] = cell_rect(vri, vfi)
		let ri    = e.visible_ris[vri]
		let field = e.visible_fields[vfi]
		build_cell_at(a, ri, field, vri, vfi, x, y, w, h, build_stage)
	}

	function build_cells_range(a, x0, y0, ris, vri1, vri2, vfi1, vfi2,
		build_stage
	) {

		let hit_cell, foc_cell, foc_vri, foc_vfi

		if (!build_stage) {

			foc_vri = e.focused_vri()
			foc_vfi = e.focused_vfi()

			hit_cell = hit_zone == 'cell'
				&& hit_vri >= vri1 && hit_vri <= vri2
				&& hit_vfi >= vfi1 && hit_vfi <= vfi2

			foc_cell = foc_vri != null && foc_vfi != null

			// when foc_cell and hit_cell are the same, don't build them twice.
			if (foc_cell && hit_cell && hit_vri == foc_vri && hit_vfi == foc_vfi)
				foc_cell = null

			// field index for highlighting the quicksearch text, or null
			let qs_fi = e.quicksearch_text ? quicksearch_fi() : null

			for (let vfi = vfi1; vfi < vfi2; vfi++) {
				let field = e.visible_fields[vfi]
				if (field._fast_build == null)
					field._fast_build = field.build == ui.all_field_types.build
						&& !field.lookup_nav && !field.null_lookup_col
				field._fast_now = ui.GRID_FAST_PATH
					&& field._fast_build
					&& !field_has_indent(field)
					&& vfi != hit_vfi
					&& vfi != foc_vfi
					&& field.fi != qs_fi
			}
		}

		let skip_moving_col = drag_op == 'col_move' && build_stage == 'col'

		for (let vri = vri1; vri < vri2; vri++) {

			let ri = ris[vri]

			let rx, ry, rw, rh
			if (horiz) {
				rx = x0
				ry = vri * cell_h
				rw = cells_w
				rh = cell_h
			} else {
				rx = vri * row_w
				ry = y0
				rw = row_w
				rh = cells_h
			}

			let row_is_foc = foc_cell && foc_vri == vri
			let row_is_hit = hit_cell && hit_vri == vri

			for (let vfi = vfi1; vfi < vfi2; vfi++) {
				if (skip_moving_col && hit_vfi == vfi)
					continue
				if (row_is_hit && hit_vfi == vfi)
					continue
				if (row_is_foc && foc_vfi == vfi)
					continue

				let field = e.visible_fields[vfi]

				if (!build_stage && field._fast_now)
					continue

				let x = horiz ? field._x : rx
				let y = horiz ? ry : field._y
				let w = horiz ? field._w : rw
				let h = cell_h

				build_cell_at(a, ri, field, vri, vfi, x, y, w, h, build_stage)
			}

			if (e.is_removed(ri)) {
				// TODO: build_row_strike_line(ri, vri, rx, ry, rw, rh, build_stage)
			}

		}

		if (!build_stage) {
			let sp2 = ui.sp2()
			let m = ui.measure_text(cx, 'M')
			let text_h = ceil(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)
			let baseline = max(0, round((cell_h - text_h) / 2)) + round(m.fontBoundingBoxAscent)
			for (let vfi = vfi1; vfi < vfi2; vfi++) {
				let field = e.visible_fields[vfi]
				if (!field._fast_now)
					continue
				let align = field.align || 'left'
				let cmd_i = horiz
					? ui.fast_field(field._x, vri1 * cell_h, field._w, cell_h,
						0, cell_h, sp2, align, baseline, vri2 - vri1)
					: ui.fast_field(vri1 * row_w, field._y, row_w, cell_h,
						row_w, 0, sp2, align, baseline, vri2 - vri1)
				for (let vri = vri1; vri < vri2; vri++) {
					let ri = ris[vri]
					let cs = cell_state(ri, field, vri, build_stage)
					let fg = cs.fg
					let text
					if (cs.is_null) {
						text = field.null_text ?? ''
					} else if (cs.is_empty) {
						text = field.empty_text ?? ''
					} else {
						text = field.to_text(cs.input_val)
					}
					ui.cmd_add_arg(cs.bg)
					ui.cmd_add_arg(cs.bgs)
					ui.cmd_add_arg(fg)
					ui.cmd_add_arg(text)
				}
				ui.cmd_end(cmd_i)
			}
		}

		if (foc_cell
			&& foc_vri >= vri1 && foc_vri < vri2
			&& foc_vfi >= vfi1 && foc_vfi <= vfi2
		) {
			build_cell(a, foc_vri, foc_vfi, build_stage)
		}

		// hit_cell can overlap foc_cell, so we build it after it.
		if (hit_cell
			&& hit_vri >= vri1 && hit_vri < vri2
			&& hit_vfi >= vfi1 && hit_vfi <= vfi2
		) {
			build_cell(a, hit_vri, hit_vfi, build_stage)
		}

	}

	function on_cellview_frame(a, _i, x, y, w, h, vx, vy, vw, vh) {

		let sx = vx - x
		let sy = vy - y

		// find the visible row range

		let rn // number of rows fully or partially in the viewport.
		let vri1, vri2 // visible row range.
		if (horiz) {
			page_row_count = floor(vh / cell_h)
			vri1 = floor(sy / cell_h)
		} else {
			page_row_count = floor(vw / row_w)
			vri1 = floor(sx / row_w)
		}
		rn = page_row_count + 2 // 2 is right, think it!
		vri2 = vri1 + rn
		vri1 = max(0, min(vri1, e.visible_n - 1))
		vri2 = max(0, min(vri2, e.visible_n))

		// find the visible field range

		let vfi1, vfi2 // visible field range.
		if (horiz) {
			for (let field of e.visible_fields) {
				let fx = field._x + x
				let fw = field._w
				if (vfi1 == null && fx + fw >= vx)
					vfi1 = field.vfi
				if (vfi2 == null && fx > vx + vw)
					vfi2 = field.vfi
			}
		} else {
			for (let field of e.visible_fields) {
				let fy = field._y + y
				if (vfi1 == null && fy + cell_h >= vy)
					vfi1 = field.vfi
				if (vfi2 == null && fy > vy + vh)
					vfi2 = field.vfi
			}
		}
		vfi2 = vfi2 ?? e.visible_fields.length

		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width

		// build cells

		ui.stack(id+'.cells')
		ui.measure(id+'.cells')

		x = bx + sx
		y = by + sy

		if (drag_op == 'row_move') {
			// build fixed rows first and moving rows above them.
			let s = row_move_state
			build_cells_range(a, x, y, e.visible_ris, s.vri1, s.vri2, vfi1, vfi2, 'row')
			// TODO: build_cells_range(s.rows, s.move_vri1, s.move_vri2, vfi1, vfi2, 'row_move')
		} else if (drag_op == 'col_move' || drag_op == 'col_group') {
			// build fixed cols first and moving cols above them.
			build_cells_range(a, x, y, e.visible_ris, vri1, vri2, vfi1, vfi2, 'col')
			build_cells_range(a, x, y, e.visible_ris, vri1, vri2,	hit_vfi, hit_vfi + 1, drag_op)
		} else {
			build_cells_range(a, x, y, e.visible_ris, vri1, vri2, vfi1, vfi2)
		}

		ui.end_stack()

	}

	// render grid ------------------------------------------------------------

	function group_bar_h() {
		let sp2 = ui.sp2()
		let levels = e.group_cols.at(-1)?.group_level ?? 0
		return 2 * sp2 + gcol_h + levels * sp2 + 2
	}

	e.update = function() {

		let s = ui.state(id)
		s.picked = false
		s.input_value = undefined
		let has_input = false

		if (cell_h == null)
			return

		if (is_edit_built()) {
			let value = ui.input_value(editor_id)
			if (value !== undefined)
				e.set_cell_val(edit_ri, edit_field.fi, value, {input: e})
		}

		let filter_focused_field = null
		if (e.filter_bar_visible)
			for (let field of e.visible_fields) {
				let filter_text = ui.input_value(filter_box_id(field))
				if (filter_text !== undefined)
					e.set_col_filter(field.fi, filter_text)
				if (ui.focused(filter_box_id(field)))
					filter_focused_field = field
			}
		if (filter_focused_field != filter_help_field || ui.click)
			filter_help_field = null
		if (filter_focused_field && ui.keydown('f1')) {
			filter_help_field = filter_help_field ? null : filter_focused_field
			ui.capture_keys()
		} else if (filter_help_field && ui.keydown('escape')) {
			filter_help_field = null
			ui.capture_keys()
		}

		if (e.editing
				&& !ui.focused(id)
				&& !ui.focused(editor_id)
				&& !ui.focus_inside(id+'.cells')
			)
			e.exit_edit()

		// set keyboard state

		// editing moves the focus to the editor, but these keys are the grid's.
		focused = ui.focused(id) || ui.focused(editor_id)
		shift = ui.keypressed('shift')
		ctrl  = ui.keypressed('ctrl')

		// check mouse state ---------------------------------------------------

		reset_mouse_state()

		if (ui.click)
			help_open = false

		// hover or click on sort icons from colum header
		for (let field of e.visible_fields) {
			let icon_id = id+'.sort_icon.'+field.name
			ps = ui.drag_or_hit(icon_id)
			if (ps) {
				hit_zone = 'sort_icon'
				hit_vfi = field.vfi
				ui.set_cursor('pointer')
				if (ps.drag)
					e.set_order_by_dir(field, 'toggle', shift, {input: e})
				break
			}
		}

		// hover or drag on on column header
		if (!hit_zone) {
			ps = ui.drag_or_hit(id+'.header')
			if (ps && (ps.drag || !ps.dragging)) {
				if (horiz) {
					let x0 = ui.state(id+'.header').x
					for (let field of e.visible_fields) {
						let x = field._x + x0
						let w = field._w
						if (ui.mx >= x + w - 5 && ui.mx <= x + w + 5) {
							hit_zone = 'col_divider'
							hit_vfi = field.vfi
							break
						} else if (ui.mx >= x && ui.mx <= x + w) {
							hit_zone = 'col'
							hit_vfi = field.vfi
							if (ps.drag)
								ps.grab_dx = ui.mx - x0 - field._x
							break
						}
					}
				} else {
					let s = ui.state(id+'.header')
					let x0 = s.x
					let y0 = s.y
					if (ui.mx >= x0 + header_w - 5) {
						hit_zone = 'header_divider'
					} else {
						for (let field of e.visible_fields) {
							let y = field._y + y0
							if (ui.my >= y && ui.my <= y + cell_h) {
								hit_zone = 'col'
								hit_vfi = field.vfi
								if (ps.drag)
									ps.grab_dy = ui.my - y0 - field._y
								break
							}
						}
					}
				}
				ps.zone = hit_zone
				ps.field_index = hit_vfi
			} else if (ps?.dragging) {
				hit_zone = ps.zone
				hit_vfi   = ps.field_index
				drag_op  = ps.op
			}
		}

		// column drag horizontally (vertically in vertical layout)
		// => start column move
		if (hit_zone == 'col' && !drag_op && ps.dragging && !ps.drop
			&& abs(horiz ? ps.dx : ps.dy) > 10
			&& e.visible_fields[hit_vfi].movable
		) {

			let mover = ui.live_move_mixin()

			mover.movable_element_size = function(vfi) {
				return horiz ? e.visible_fields[vfi]._w : cell_h
			}

			mover.set_movable_element_pos = function(vfi, pos, moving) {
				if (horiz)
					e.visible_fields[vfi]._x = pos
				else
					e.visible_fields[vfi]._y = pos
			}

			mover.move_element_start(hit_vfi, 1,
				e.visible_fields[0].is_group_field ? 1 : 0,
				e.visible_fields.length)

			drag_op = 'col_move'
			ps.op = drag_op
			ps.mover = mover
		}

		// column move
		if (drag_op == 'col_move') {

			let mover = ps.mover

			if (horiz) {
				let x0 = ui.state(id+'.header').x
				let mx = ui.mx - x0 - ps.grab_dx
				mover.move_element_update(mx)
			} else {
				let y0 = ui.state(id+'.header').y
				let my = ui.my - y0 - ps.grab_dy
				mover.move_element_update(my)
			}
			e.scroll_to_cell(hit_vri ?? 0, hit_vfi)

			if (ps.drop) {
				// sets x (y in vertical layout) of moved element.
				let over_fi = mover.move_element_stop()
				e.move_field(e.visible_fields[hit_vfi], e.visible_fields[over_fi],
					{input: e})

				// reset drag state but preserve hover state
				drag_op = null
			}

		}

		// drag column vertically towards group-bar => column move to group
		let col_group_start
		if (horiz && hit_zone == 'col' && !drag_op && ps.dragging && !ps.drop
			&& (ui.hovers(id+'.group_bar') || -ps.dy > 10)
			&& e.visible_fields[hit_vfi].groupable
		) {
			col_group_start = true
			drag_op = 'col_group'
			ps.op = drag_op
		}

		// hover or drag group-bar column
		if (!hit_zone) {
			for (let gcol of e.group_cols) {
				let col = gcol.field.name
				// hit sort icon
				let icon_id = id+'.sort_icon.'+col
				ps = ui.drag_or_hit(icon_id)
				if (ps) {
					hit_zone = 'sort_icon'
					hit_gcol = col
					ui.set_cursor('pointer')
					if (ps.drag)
						e.set_order_by_dir(gcol.field, 'toggle', shift, {input: e})
					break
				}
				// hit group column
				let col_id = id+'.gcol.'+col
				ui.state(col_id)
				ps = ui.drag_or_hit(col_id)
				if (ps) {
					hit_zone = 'gcol'
					hit_gcol = col
					break
				}
			}
		}

		if (drag_op == 'col_group')
			hit_gcol = e.visible_fields[hit_vfi].name

		// move group-bar column OR drag header column over the group-bar
		if (hit_zone == 'gcol' || drag_op == 'col_group') {

			let gcol_move_start = hit_zone == 'gcol' && ps.drag
			let start = gcol_move_start || col_group_start
			let mover

			if (start) {

				gcol_mover = ui.live_move_mixin()
				mover = gcol_mover
				ps.mover = gcol_mover

				mover.gcols = e.group_cols.slice()

				if (gcol_move_start) {

					mover.col_def = mover.gcols.find(gcol => gcol.field.name == hit_gcol)

					let x = mover.col_def.group_i * (gcol_w + 1)
					let y = mover.col_def.group_level * sp2
					mover.x0 = x
					mover.y0 = y

				} else if (col_group_start) {

					let field = e.all_fields_map[hit_gcol]
					let last_gcol = e.group_cols.at(-1)
					mover.col_def = {
						field: field,
						col_expr: hit_gcol,
						group_level: last_gcol ? last_gcol.group_level + 1 : 0,
						group_i: mover.gcols.length,
					}
					mover.gcols.push(mover.col_def)

					let hs = ui.state(id+'.header')
					let hx = hs.x
					let hy = hs.y
					let group_bar_was_visible = !(e.group_bar_visible == 'auto' && !e.group_cols.length)
					mover.x0 = field._x - sp2
					mover.y0 = group_bar_was_visible ? group_bar_h() : 0

				}

				mover.xs = [] // col_index -> col_x
				mover.is = [] // col_index -> col_visual_index
				mover.movable_element_size = function() {
					return gcol_w + gcol_gap
				}
				mover.set_movable_element_pos = function(i, x, moving, vi) {
					this.xs[i] = x
					if (vi != null)
						this.is[i] = vi
				}
				mover.move_element_start(mover.col_def.group_i, 1, 0,
					mover.gcols.length)

				// compute the allowed level ranges that the dragged column is
				// allowed to move vertically in each horizontal position that
				// it finds itself in (since it can move in both directions).
				// these ranges remain fixed while the col is moving.
				mover.levels = []
				mover.min_levels = []
				mover.max_levels = []
				let last_level = 0
				let i = 0
				for (let gcol of mover.gcols) {
					let level = gcol.group_level
					mover.levels    [i] = level
					mover.min_levels[i] = level
					mover.max_levels[i] = level
					if (level != last_level) {
						mover.min_levels[i]--
						if (i > 0)
							mover.max_levels[i-1]++
					} else if (i > 0 && i == mover.gcols.length-1) {
						mover.max_levels[i]++
					}
					last_level = level
					i++
				}

			} else {
				gcol_mover = ps.mover
				mover = gcol_mover
			}

			if (ps.dragging) {

				// drag column over the group-by header or over the grid's column header.
				mover.move_element_update(mover.x0 + ps.dx)
				let vi = mover.is[mover.col_def.group_i]
				let level = mover.levels[vi]
				let min_level = mover.min_levels[vi]
				let max_level = mover.max_levels[vi]
				let mx = mover.x0 + ps.dx
				let my = mover.y0 + ps.dy
				level = clamp(round(my / sp2), min_level, max_level)
				let min_y = min_level * sp2 - ui.sp4()
				let max_y = max_level * sp2 + ui.sp4()
				let min_x = (-0.5) * (gcol_w + gcol_gap)
				let max_x = 1/0
				mover.drop_level = null
				mover.drop_pos = null
				if (
					my >= min_y && my <= max_y &&
					mx >= min_x && mx <= max_x &&
					ui.hovers(id+'.group_bar')
				) { // move
					mover.drop_level = level
				} else {
					mover.move_element_update(null)
					if (drag_op != 'col_group') { // put back in grid
						mover.move_element_update(null)
						if (ui.hovers(id+'.header')) {
							let hx = ui.state(id+'.header').x
							for (let field of e.visible_fields) {
								let x = field._x + hx
								let w = field._w
								let d = w / 2
								let is_last = field.vfi == e.visible_fields.length-1
								if (ui.mx >= x && ui.mx <= x + d && !field.is_group_field) {
									mover.drop_pos = field.vfi
									break
								} else if (ui.mx >= x + w - d && (is_last || ui.mx <= x + w)) {
									mover.drop_pos = field.vfi+1
									break
								}
							}
						}
					}
				}

				if (ps.drop) {

					if (mover.drop_level != null) { // move it between other group columns

						// create a temp array with the dragged column moved to its new position.
						let over_i = mover.move_element_stop()
						let a = []
						for (let gcol of mover.gcols) {
							let vi = mover.is[gcol.group_i]
							let level = gcol == mover.col_def ? mover.drop_level : mover.levels[vi]
							a.push({col_expr: gcol.col_expr, group_level: level})
						}
						array_move(a, mover.col_def.group_i, 1, over_i, true)
						e.set_group_cols(a, {input: e})

					} else if (mover.drop_pos != null) { // put it back in grid

						e.ungroup_col(mover.col_def.field,
							e.visible_fields[mover.drop_pos], {input: e})

					}

					// reset drag state but preserve hover state
					gcol_mover = null
					drag_op = null

				}

			}

		}

		if (drag_op == 'col_group')
			ui.set_cursor('grabbing')
		else if (drag_op == 'col_move')
			ui.set_cursor('grabbing')

		// check hover/drag on cell view

		if (!hit_zone) {
			ps = ui.drag_or_hit(id+'.cells')
			if (ps && (ps.drag || !ps.dragging)) {
				let s = ui.state(id+'.cells')
				let x0 = s.x
				let y0 = s.y
				let divider_zone = null
				if (!horiz) {
					let header_x2 = ui.state(id+'.header').x + header_w
					if (ui.mx <= header_x2 + 5)
						divider_zone = 'header_divider'
					else if (abs(ui.mx - (x0 + row_w)) <= 5)
						divider_zone = 'row_divider'
				}
				ps.zone = divider_zone
				hit_zone = divider_zone
				let ri
				if (!hit_zone) {
					hit_vri = horiz
						? floor((ui.my - y0) / cell_h)
						: floor((ui.mx - x0) / row_w)
					if (hit_vri < e.visible_n)
						ri = e.visible_ris[hit_vri]
				}
				if (ri != null) {
					for (let vfi = 0; vfi < e.visible_fields.length; vfi++) {
						let [x1, y1, w, h] = cell_rect(hit_vri, vfi)
						let hit_dx = ui.mx - x1 - x0
						let hit_dy = ui.my - y1 - y0
						let is_hit = horiz
							? hit_dx >= 0 && hit_dx <= w
							: hit_dy >= 0 && hit_dy <= h
						if (is_hit) {
							let field = e.visible_fields[vfi]
							hit_zone = 'cell'
							hit_vfi = vfi
							hit_indent = false
							if (field_has_indent(field)) {
								if (e.has_children(ri)) {
									let indent_x = indent_offset(e.depth[ri])
									hit_indent = hit_dx <= indent_x
								}
							}
							break
						}
					}
				}
			} else if (ps?.dragging && ps.zone) {
				hit_zone = ps.zone
			}
		}

		// column resize
		if (hit_zone == 'col_divider') {
			let field = e.visible_fields[hit_vfi]
			if (ps.drag)
				ps.w0 = field.w * font_size
			if (ps.dragging)
				field.w = clamp(ps.w0 + ps.dx,
					col_min_w(field), field.max_w * font_size) / font_size
			if (ps.drop)
				e.save_col_w(field)
			ui.set_cursor('col-resize')
		} else if (hit_zone == 'header_divider') {
			if (ps.drag)
				ps.w0 = e.header_w * font_size
			if (ps.dragging)
				e.header_w = clamp_vertical_w(ps.w0 + ps.dx) / font_size
			if (ps.drop)
				ui.save_state(id, 'header_w', e.header_w)
			ui.set_cursor('col-resize')
		} else if (hit_zone == 'row_divider') {
			if (ps.drag)
				ps.w0 = e.row_w * font_size
			if (ps.dragging)
				e.row_w = clamp_vertical_w(ps.w0 + ps.dx) / font_size
			if (ps.drop)
				ui.save_state(id, 'row_w', e.row_w)
			ui.set_cursor('col-resize')
		}

		if (hit_zone == 'cell' && ps.drag) {

			let ri = e.visible_ris[hit_vri]
			let field = e.visible_fields[hit_vfi]

			clicked_indent = hit_indent
			if (hit_indent)
				toggle_collapsed(ri, shift)

			let already_on_it =
				ri == e.focused_ri &&
				field.fi == e.focused_fi

			// a clickable cell acts on the click instead of opening an editor.
			let click = !hit_indent && !ctrl && !shift
				&& !(e.editing && field.has_editor && already_on_it)
				&& e.cell_clickable(ri, field.fi)

			if (!already_on_it)
				e.exit_edit()

			if (e.move_focus(ri, field.fi, 0, 0, {
				must_not_move_col: true,
				must_not_move_row: true,
				enter_edit: !hit_indent
					&& !ctrl && !shift && !click
					&& (e.enter_edit_on_click
						|| (e.enter_edit_on_click_focused && already_on_it)),
				focus_non_editable_if_not_found: true,
				sel_i: 0, sel_len: 1/0,
				select: shift ? 'expand' : ctrl ? 'invert' : null,
				input: e,
			})) {
				has_input = true
				if (e.is_picker && !hit_indent)
					s.picked = true
				if (click)
					e.do_cell_click(ri, field.fi, {input: e})
				// TODO:
				//drag_op = 'row_move'
			}

		}

		// On double click, start editing or open the current editor's dropdown.
		if (ui.dblclicked(id+'.cells') && hit_zone == 'cell'
			&& !clicked_indent && focused_field()?.has_editor)
			if (is_edit_built())
				edit_field.open_dropdown?.(editor_id)
			else
				e.enter_edit()

		// process keyboard input ----------------------------------------------

		if (ui.key_events.length)
			if ((function() {

		let left_arrow  =  horiz ? 'arrowleft'  : 'arrowup'
		let right_arrow =  horiz ? 'arrowright' : 'arrowdown'
		let up_arrow    = !horiz ? 'arrowleft'  : 'arrowup'
		let down_arrow  = !horiz ? 'arrowright' : 'arrowdown'

		let ri = e.focused_ri
		let field = focused_field()
		let clickable_cell = ri != null && field
			&& e.cell_clickable(ri, field.fi)
		let has_editor = is_edit_built() && edit_field.has_editor

		if (keydown('f1'))
			return false

		// same-row field navigation.
		if (keydown(left_arrow) || keydown(right_arrow)) {

			let cols = keydown(left_arrow) ? -1 : 1

			let move = !has_editor
				|| (e.auto_jump_cells && !shift && (!horiz || ctrl)
					&& (!horiz || ctrl && caret_at_edge(cols)))

			let all
			if (!horiz) {
				all = true
			} else if (is_edit_built()) {
				all = edit_selection()[1] == 1/0
			} else {
				all = ctrl
			}

			if (move) {
				has_input = true
				if (e.focus_next_cell(cols, {
					sel_i: all ? 0 : cols > 0 ? 0 : -1,
					sel_len: all ? 1/0 : 0,
					select: shift ? 'expand' : null,
					enter_edit: ctrl,
					input: e,
				}))
					return false
			}

		}

		let rows
		if      (keydown(up_arrow  )) rows = -1
		else if (keydown(down_arrow)) rows =  1
		else if (keydown('pageup'  )) rows = -(ctrl ? 1/0 : page_row_count)
		else if (keydown('pagedown')) rows =  (ctrl ? 1/0 : page_row_count)
		else if (keydown('home'    )) rows = -1/0
		else if (keydown('end'     )) rows =  1/0
		let move_rows = rows && (!has_editor
			|| (e.auto_jump_cells && !shift
				&& (horiz || ctrl && caret_at_edge(rows))))

		// insert with the arrow down key on the last focusable row.
		if (move_rows && keydown(down_arrow) && !shift) {
			if (e.is_last_row_focused()
				&& e.insert_rows([null], null, {input: e, focus_it: true}).length)
				return false
		}

		// remove last row with the arrow up key if not edited.
		if (move_rows && keydown(up_arrow)) {
			if (e.is_last_row_focused() && ri != null) {
				if (e.is_new(ri) && !e.is_row_edited(ri)) {
					let editing = e.editing
					e.remove_rows([ri], 'delete', {input: e, refocus: true})
					if (e.focused_ri != ri) {
						if (editing)
							e.enter_edit()
						return false
					}
				}
			}
		}

		// row navigation.
		if (move_rows) {

			let [sel_i, sel_len] = is_edit_built() && horiz
				? edit_selection() : [0, 1/0]

			has_input = true
			if (e.move_focus(true, true, rows, 0, {
				sel_i: sel_i,
				sel_len: sel_len,
				select: shift ? 'expand' : null,
				input: e,
			}))
				return false

		}

		// F2: enter edit mode, or toggle the dropdown of the edit in progress
		if (keydown('f2')) {
			if (is_edit_built())
				edit_field.toggle_dropdown?.(editor_id)
			else
				e.enter_edit({advance_on_exit: true})
			return false
		}

		// Enter: toggle edit mode, and navigate on exit
		if (keydown('enter')) {
			if (e.quicksearch_text) {
				has_input = true
				e.quicksearch(e.quicksearch_text, quicksearch_fi(),
					shift ? -1 : 1)
				return false
			} else if (e.is_picker) {
				has_input = true
				s.picked = true
				return false
			} else if (!e.editing) {
				e.enter_edit({open_popup: !ctrl})
				return false
			} else {
				end_edit_like_enter(ctrl, shift ? -1 : 1)
				return false
			}
		}

		// Esc: exit edit mode.
		if (keydown('escape')) {
			if (e.quicksearch_text) {
				e.quicksearch('')
				return false
			}
			if (e.editing) {
				if (e.exit_edit_on_escape) {
					e.exit_edit({input: e, cancel: true})
					return false
				}
			} else if (e.undelete_selected_rows({input: e})) {
				return false
			} else if (!e.is_picker && ri != null && field) {
				if (e.is_new(ri) && !e.is_row_edited(ri, true))
					e.remove_rows([ri], 'delete', {input: e, refocus: true})
				else
					e.revert_cell(ri, field.fi)
				return false
			}
		}

		// insert key: insert row
		if (keydown('insert')) {
			let vals = null // add an empty row

			if (ctrl && ri != null) { // copy the row without its primary key
				let vals = []
				for (let fi = 0; fi < e.all_fields.length; fi++)
					vals[fi] = e.cell_input_val(ri, fi)
				for (let pk_field of e.pk_fields)
					vals[pk_field.fi] = undefined
			}

			if (e.insert_rows([vals], ri, {input: e, focus_it: true}).length)
				return false
		}

		if (keydown('delete')) {

			if (e.is_picker) {
				s.input_value = null
				return false
			}

			// delete on an already-empty cell leaves edit mode. the key is
			// spent on that, so it must not go on to delete rows as well.
			if (e.editing && e.cell_input_val(ri, field.fi) == null) {
				e.exit_edit({cancel: true})
				return false
			}

			// delete: delete selected rows, asking first unless the selection
			// is a single new row.
			let ris = !ctrl && !e.editing ? selected_ris() : empty_array
			if (ris.length) {
				if (!(e.can_remove_rows && e.rowset_can_remove_rows))
					return false
				let n = ris.length
				let is_one_new_row = n == 1 && e.is_new(ris[0])
				if (is_one_new_row || confirm(S('delete_records_confirmation',
						'Are you sure you want to delete {0:record:records}?', n))) {
					e.remove_rows(ris, 'delete', {input: e, refocus: true})
					return false
				}
			}

			// ctrl_delete: set selected cells to null.
			if (ctrl) {
				e.set_null_selected_cells({input: e})
				return false
			}

		}

		if (!has_editor && keydown(' ') && !e.quicksearch_text) {
			if (ri != null && (!e.cell_select_mode || field == e.tree_field))
				toggle_collapsed(ri, shift)
			else if (clickable_cell)
				e.do_cell_click(ri, field.fi, {input: e})
			return false
		}

		if (!e.editing && ctrl && keydown('a')) {
			e.select_all_cells()
			return false
		}

		if (!e.editing && keydown('backspace')) {
			if (e.quicksearch_text) {
				has_input = true
				e.quicksearch(e.quicksearch_text.slice(0, -1), quicksearch_fi())
			}
			return false
		}

		if (ctrl && keydown('s')) {
			e.save()
			return false
		}

		if (ctrl && !e.editing) {
			if (keydown('c')) {
				if (ri != null && field)
					copy_to_clipboard(e.cell_text(ri, field.fi))
				return false
			} else if (keydown('x')) {

				return false
			} else if (keydown('v')) {

				return false
			}
		}

		// printable chars search. while editing they belong to the editor.
		let typed = focused && !e.editing && ui.key_chars()
		if (typed) {
			has_input = true
			let qs_fi = quicksearch_fi()
			if (qs_fi != null)
				e.quicksearch(e.quicksearch_text + typed, qs_fi)
			return false
		}

		})() === false) { // if (ui.key_events.length) ...
			help_open = keydown('f1') && !help_open
			ui.capture_keys()
		}

		if (e.is_picker && has_input)
			s.input_value = e.focused_ri

		if (!ui.window_focused() || ui.window_focusing)
			e.exit_edit()

		// if editing with an editor:
		// - write editor's value to the cell.
		// - exit edit when the editor's dropdown is closed, reverting unless
		// value picked.
		// - on advance_on_exit + advance_on_enter + pick, move to next cell.
		// the grid builds the editor later in this frame, so until then the
		// editor's state is that of the cell that the edit came from: the
		// grid must not read the editor on the frame that it moves the edit
		// to another cell.
		if (is_edit_built() && edit_field.has_editor) {
			let ri = edit_ri
			let field = edit_field
			let has_picked_val
			if (field.editor_value) {
				let v0 = e.cell_input_val(ri, field.fi)
				let v1 = field.editor_value(editor_id, v0)
				if (v1 !== v0) {
					e.set_cell_val(ri, field.fi, v1, {input: e})
					has_picked_val = true
				}
			}
			let closed = field.dropdown_closed?.(editor_id)
				&& (field.edits_in_popup || has_picked_val)
			if (closed) {
				let picked = field.dropdown_picked(editor_id)
				let advance = picked
					&& e.advance_on_exit && e.advance_on_enter
				e.exit_edit({input: e, cancel: !picked})
				if (advance)
					advance_edit(false, 1)
			}
		}

		sync_editor()

	}

	e.build = function(id, opt, fr, align, valign) {

		e.set_param_vals(opt.param_vals)

		let value
		if (e.is_picker) {
			value = ui.set_value(id, ui.state(id), opt.value) // ri or null
			if (value != e.focused_ri)
				e.focus_cell(value, e.last_focused_fi)
		}

		// Check again because app code may start or end an edit after update().
		sync_editor()

		// set layout vars

		sp  = ui.sp1()
		sp2 = ui.sp2()
		font_size = ui.em(1)
		line_height = font_size * 1
		cell_h = round(line_height + 2 * sp + e.cell_border_h_width)
		row_w    = clamp_vertical_w(e.row_w    * font_size) + 2 * sp2
		header_w = clamp_vertical_w(e.header_w * font_size) + 2 * sp2
		header_h = cell_h
		gcol_w = ui.em(6) // group-bar column width
		gcol_h = round(line_height + sp)
		gcol_gap = 1

		ui.focusable(id)

		// layout fields and compute cell grid size

		cells_w = 0
		cells_h = 0
		if (horiz) {
			for (let field of e.visible_fields) {
				let w = clamp(field.w * font_size,
					col_min_w(field), field.max_w * font_size)
				let cw = w + 2 * sp2
				if (drag_op != 'col_move')
					field._x = cells_w
				field._w = cw
				cells_w += cw
			}
			cells_h = e.visible_n * cell_h
		} else {
			for (let field of e.visible_fields) {
				if (drag_op != 'col_move')
					field._y = cells_h
				cells_h += cell_h
			}
			cells_w = e.visible_n * row_w
		}

		if (e.focus_changed) {
			e.scroll_to_cell(e.focused_vri(), e.focused_vfi())
			ui.rebuild('focused_cell_changed')
			e.focus_changed = false
		}
		if (scroll_to_vri != null) {
			let vri = scroll_to_vri
			let vfi = scroll_to_vfi ?? 0
			if (vri < e.visible_n && e.visible_fields[vfi]) {
				let [x, y, w, h] = cell_rect(vri, vfi)
				ui.scroll_to_view_rect(id+'.cells_scrollbox', x, y, w, h)
			}
			scroll_to_vri = null
			scroll_to_vfi = null
		}

		// build ---------------------------------------------------------------

		ui.stack(id, fr, align, valign)
		ui.hv(horiz ? 'v' : 'h', 1, 0, 's', 's')

			// group-by bar

			if (horiz && (
				e.group_bar_visible == 'always'
				|| e.group_bar_visible == 'auto' && e.group_cols.length
				|| drag_op == 'col_group'
			)) {

				ui.min_h(group_bar_h())
				let group_bar_i = ui.sb(id+'.group_bar', 0, 'hide', 'hide', 's', 't')
					ui.bb('bg2', null, 'b', 'light')

					let mover = gcol_mover

					for (let gcol of mover?.gcols ?? e.group_cols) {

						let col = gcol.field.name
						let x = gcol.group_i * (gcol_w + 1)
						let y = gcol.group_level * sp2
						let w = gcol_w
						let h = gcol_h

						if (mover) {
							let vi = mover.is[gcol.group_i]
							let level = col == hit_gcol ? mover.drop_level : mover.levels[vi]
							x = mover.xs[gcol.group_i]
							y = level * sp2
							if (col == hit_gcol) {
								if (mover.drop_level == null) {
									// dragging outside the columns area
									x = mover.x0 + ps.dx
									y = mover.y0 + ps.dy
								} else {
									let place_x = vi * (w + 1)
									ui.m(sp2 + place_x - 1, sp2 + y - 1, 0, 0)
									ui.min_wh(w + 2, h + 2)
									ui.stack('', 0, 'l', 't')
										ui.border(1, 'marker', null, 0, 'dashes')
									ui.end_stack()
									x = mover.x0 + ps.dx
									y = mover.y0 + ps.dy
								}
							}
						}

						if (mover && col == hit_gcol) {
							ui.popup(id+'.moving_gcol_popup', 'drag', group_bar_i, 'il', '[')
							ui.nohit()
						}

						let col_id = id+'.gcol.'+col
						let field = gcol.field
						ui.m(sp2 + x, sp2 + y, 0, 0)
						ui.min_wh(w, h)
						ui.stack(col_id, 1, 'l', 't')
							let bgs = hit_gcol == col && (
								!ps.dragging || ps.drop ? 'hover'
									: hit_zone != 'sort_icon' ? 'active' : 'hover'
								) || null
							ui.bb('bg1', bgs, 1, 'intense')
							ui.p(sp2, ui.sp075())
							ui.h(1, sp)

								ui.text('', field.label, 1, 'l', 'c', 0)

								// sort icon
								let icon_id = id+'.sort_icon.'+col
								if (field.sortable) {
									let dir = field.sort_i == null ? null
										: field.sort_desc ? 'desc' : 'asc'
									ui.color(dir ? 'label' : 'faint',
										(hit_zone == 'sort_icon' && hit_gcol == col) ? 'hover' : null)
									let pri = field.sort_i
									ui.icon(icon_id,
										dir == 'asc' && (pri ? 'sort_asc'  : 'sort_asc' ) ||
										dir          && (pri ? 'sort_desc' : 'sort_desc') ||
										'sort_none'
									, 0)
								}
							ui.end_h()
						ui.end_stack()

						if (mover && col == hit_gcol)
							ui.end_popup()

					}

				ui.end_sb()

			}

			// column header

			function build_header_cell(field, noclip) {
				let w, h
				if (horiz) {
					ui.m(field._x, 0, 0, 0)
					w = field._w
					h = header_h
				} else {
					ui.m(0, field._y, 0, 0)
					w = header_w
					h = cell_h
				}
				ui.p(sp2, 0)
				ui.min_wh(w - 2 * sp2, h)
				ui.h(0, sp, 'l', 't')

					let col_move  = drag_op == 'col_move'  && hit_vfi == field.vfi
					let col_group = drag_op == 'col_group' && hit_gcol == field.name

					ui.bb(
						col_move ? 'bg2' : col_group ? 'bg0' : 'bg1', null,
						col_move ? (horiz ? 'blr' : 'tbr') : 'br', 'intense')

					let max_min_w = noclip ? null
						: max(0, w - 2 * sp2 - sort_icon_w(field))
					let dir = field.sort_i == null ? null
						: field.sort_desc ? 'desc' : 'asc'
					let pri = field.sort_i
					let align, is_right_aligned
					if (horiz) {
						align = e.field_align(field)
						is_right_aligned = align == 'right'
					} else {
						align = e.header_align
						is_right_aligned = align == 'r'
					}

					if (!is_right_aligned) {
						ui.color(col_group ? 'faint' : null)
						ui.text('', field.label, 1, align, 'c', max_min_w)
					}

					let icon_id = id+'.sort_icon.'+field.name

					if (field.sortable) {
						if (e.visible_n > 1 || dir) {
							ui.color(dir && !col_group ? 'label' : 'faint',
								!col_group && hit_zone == 'sort_icon'
									&& hit_vfi == field.vfi ? 'hover' : null)
							ui.icon(icon_id,
								dir == 'asc' && (pri ? 'sort_asc'  : 'sort_asc' ) ||
								dir          && (pri ? 'sort_desc' : 'sort_desc') ||
								'sort_none'
							, 0)
						} else {
							ui.min_w(ui.em(1))
							ui.box()
						}
					}

					if (is_right_aligned) {
						ui.color(col_group ? 'faint' : null)
						ui.text('', field.label, 1, align, 'c', max_min_w)
					}

				ui.end_h()
			}

			let header_overflow = e.auto_expand ? 'contain' : 'hide'
			if (horiz)
				ui.scrollbox(id+'.header', 0,
					header_overflow, 'contain',
					null, null, null, null, id+'.cells_scrollbox')
			else
				ui.scrollbox(id+'.header', 0,
					'contain', header_overflow,
					null, null, null, null, null, id+'.cells_scrollbox')

				ui.stack(id+'.header')
				ui.measure(id+'.header')

					let col_move = drag_op == 'col_move'

					ui.bb('bg1', null, horiz ? 'b' : 'r', 'intense')
					for (let field of e.visible_fields) {
						if (col_move && hit_vfi === field.vfi)
							continue
						build_header_cell(field)
					}
					if (col_move) {
						let field = e.visible_fields[hit_vfi]
						build_header_cell(field)
					}

					// group column drop arrows

					if (gcol_mover?.drop_pos != null) {
						let x = e.visible_fields[gcol_mover.drop_pos]?._x ?? cells_w
						ui.ml(x)
						ui.min_h(header_h)
						ui.stack('', 0, 'l', 't')
							ui.popup('', 'overlay', null, 't', 'c')
								ui.color('marker')
								ui.icon('', 'arrow_down')
							ui.end_popup()
							ui.popup('', 'overlay', null, 'b', 'c')
								ui.color('marker')
								ui.icon('', 'arrow_up')
							ui.end_popup()
						ui.end_stack()
					}

				ui.end_stack()

			ui.end_scrollbox()

			// filter bar

			if (e.filter_bar_visible) {
				if (horiz)
					ui.scrollbox(id+'.filter_bar', 0,
						header_overflow, 'contain',
						null, null, null, null, id+'.cells_scrollbox')
				else
					ui.scrollbox(id+'.filter_bar', 0,
						'contain', header_overflow,
						null, null, null, null, null, id+'.cells_scrollbox')

					ui.stack('')
						ui.bb('bg1', null, horiz ? 'b' : 'r', 'intense')
						for (let field of e.visible_fields)
							build_filter_cell(field)
					ui.end_stack()

				ui.end_scrollbox()
			}

			// so that focus_inside() answers for a picker's own widgets.
			ui.focus_group(null, null, id+'.cells')

			// cells frame

			let overflow = e.auto_expand ? 'contain' : 'auto'
			let resizer_id = id+'.resizer'
			ui.stack('', 1, 's', 's')
				ui.sb_max_wh(
					ui.state_of(resizer_id, 'w') ?? opt.max_w,
					ui.state_of(resizer_id, 'h') ?? opt.max_h)
				ui.scrollbox(id+'.cells_scrollbox', 1, overflow, overflow,
					's', 's')
					ui.min_wh(cells_w, cells_h)
					ui.frame(noop, on_cellview_frame, 0, 'l', 't')
				ui.end_scrollbox()
				if (opt.resizable)
					ui.resizer(resizer_id, null, opt.max_w, opt.max_h)
			ui.end_stack()

			ui.end_focus_group()

		ui.end_hv()
		ui.end_stack()

		return value

	}

}

function create_grid(id, opt) {
	let nav = opt.nav
	if (!nav) {
		nav = ui.nav(id, opt)
		ui.on_free(id, nav.free)
	}
	init(id, nav)
	return nav
}
ui.grid = ui.stateful_widget(create_grid)

}()) // module function
