

		for (let ri = ri1; ri < ri2; ri++) {
			let row = rows[ri]
			if (row.errors && row.errors.failed) {
				let ry = ri * e.cell_h
				draw_row_invalid_border(row, ri, rx, ry, rw, rh, draw_stage)
			}
		}

		if (draw_cell_w != null) {
			let [x, y, w, h] = cell_rect(hit_ri, hit_fi, draw_stage)
			x = draw_cell_x
			w = draw_cell_w
			draw_hover_outline(x, y, w, h)
		}




		if (!editing) {

			cx.save()

			// clip
			cx.beginPath()
			cx.translate(px, py)
			let cw = w - px - px
			let ch = h - py - py
			cx.cw = cw
			cx.ch = ch
			cx.rect(0, 0, cw, ch)
			cx.clip()

			let y = round(ch / 2)

			// tree node sign
			if (collapsed != null) {
				cx.fillStyle = selected ? fg : e.bg_focused_selected
				cx.font = cx.icon_font
				let x = indent_x - e.font_size - 4
				cx.textBaseline = 'middle'
				cx.fillText(collapsed ? '\uf0fe' : '\uf146', x, y)
			}

			// text
			cx.translate(indent_x, 0)
			cx.fg_text = fg
			cx.quicksearch_len = cell_focused && e.quicksearch_text.length || 0
			e.draw_val(row, field, input_val, cx)

			cx.restore()
		}

		cx.restore()

		if (ri != null && focused)
			update_editor(
				 horiz ? null : xy,
				!horiz ? null : xy, hit_indent)
	}


	cells_w = bx + col_x

	// prevent cells_w shrinking while col resizing to prevent scroll_x changes.
	if (col_resizing && !e.auto_expand)
		cells_w = max(cells_w, last_cells_w)

	vrn = floor(cells_view_h / cell_h) + 2 // 2 is right, think it!

	function measure_cell_width(row, field) {
		cx.measure = true
		e.draw_cell(row, field, cx)
		cx.measure = false
		return cx.measured_width
	}

	function draw_cell_border(cx, w, h, bx, by, color_x, color_y, draw_stage) {
		let bw = w - .5
		let bh = h - .5
		let zz = -.5
		if (by && color_y != null) { // horizontals
			cx.beginPath()
			cx.lineWidth = by
			cx.strokeStyle = color_y

			// top line
			if (!horiz && draw_stage == 'moving_cols') {
				cx.moveTo(zz, zz)
				cx.lineTo(bw, zz)
			}
			// bottom line
			cx.moveTo(zz, bh)
			cx.lineTo(bw, bh)

			cx.stroke()
		}
		if (bx && color_x != null) { // verticals
			cx.beginPath()
			cx.lineWidth = bx
			cx.strokeStyle = color_x

			// left line
			if (horiz && draw_stage == 'moving_cols') {
				cx.moveTo(zz, zz)
				cx.lineTo(zz, bh)
			}
			// right line
			cx.moveTo(bw, zz)
			cx.lineTo(bw, bh)

			cx.stroke()
		}
	}


	function draw_hover_outline(x, y, w, h) {

		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width
		let bw = w - .5
		let bh = h - .5

		cx.save()
		cx.translate(x, y)

		cx.lineWidth = bx || by

		// add a background to override the borders.
		cx.strokeStyle = e.bg
		cx.setLineDash(empty_array)
		cx.beginPath()
		cx.rect(-.5, -.5, bw + .5, bh + .5)
		cx.stroke()

		// draw the actual hover outline.
		cx.strokeStyle = e.fg
		cx.setLineDash([1, 3])
		cx.beginPath()
		cx.rect(-.5, -.5, bw + .5, bh + .5)
		cx.stroke()

		cx.restore()
	}



// grid view -----------------------------------------------------------------

function grid_view(nav) {

	let e = {}

	let horiz = true
	e.horiz = true

	e.rowset = nav.rowset
	e.fields = nav.fields
	e.rows = nav.rows

	e.cell_border_v_width = 0
	e.cell_border_h_width = 1
	e.line_height = 22

	e.padding_x = round(ui.spx_input() * ui.get_font_size())
	e.padding_y = round(ui.spy_input() * ui.get_font_size())

	e.cell_h   = e.cell_h   ?? round(e.line_height + 2 * e.padding_y + e.cell_border_h_width)
	e.header_h = e.header_h ?? round(e.line_height + 2 * e.padding_y + e.cell_border_h_width)

	e.header_w = 120 // vert-grid only
	e.cell_w = 120 // vert-grid only
	e.auto_cols_w = false // horiz-grid only
	e.auto_expand = false

	// keyboard behavior
	e.auto_jump_cells = true    // jump to next/prev cell on caret limits with Ctrl.
	e.tab_navigation = false    // disabled as it prevents jumping out of the grid.
	e.advance_on_enter = 'next_row' // false|'next_row'|'next_cell'
	e.exit_edit_on_escape = true
	e.exit_edit_on_enter = true
	e.quick_edit = false // quick edit (vs. quick-search) when pressing a key

	// mouse behavior
	e.can_reorder_fields            = true
	e.enter_edit_on_click           = false
	e.enter_edit_on_click_focused   = false
	e.enter_edit_on_dblclick        = true
	e.focus_cell_on_click_header    = false
	e.can_change_parent             = true

	// context menu features
	e.enable_context_menu           = true
	e.can_change_header_visibility  = true
	e.can_change_filters_visibility = true
	e.can_change_fields_visibility  = true

	// view-size-derived state ------------------------------------------------

	let cells_w, cells_h // cell grid dimensions.
	let grid_w, grid_h // grid dimensions.
	let cells_view_w, cells_view_h // cell viewport dimensions inside scrollbars.
	let cells_view_overflow_x, cells_view_overflow_y // cells viewport overflow setting.
	let header_x, header_y
	let header_w, header_h, filters_h // header viewport dimensions.
	let hcell_h // header cell height.
	let vrn // how many rows are fully or partially in the viewport.
	let page_row_count // how many rows in a page for pgup/pgdown navigation.

	let min_cols_w

	e.measure_header = function(axis) {
		if (horiz) {
			if (!axis) {

				let col_resizing = hit_state == 'col_resizing'

				min_cols_w = 0

				if (e.auto_expand)
					for (let field of e.fields)
						min_cols_w += col_resizing ? field._w : min(max(field.w, field.min_w), field.max_w)

				let bx = e.cell_border_v_width
				let min_cells_w = bx + min_cols_w

				// prevent cells_w shrinking while col resizing to prevent scroll_x changes.
				if (col_resizing && !e.auto_expand)
					min_cells_w = max(min_cells_w, cells_w)

				cells_w = min_cells_w

				return min_cells_w

			} else {

				header_h = 36

				return header_h

			}
		} else {

		}
		return 0
	}

	e.measure_cells = function(axis) {
		if (horiz) {
			if (!axis) {
				return cells_w // computed in measure_header()
			} else {
				let by = e.cell_border_h_width
				cells_h = by + e.cell_h * e.rows.length
				return cells_h
			}
		} else {

		}
		return 0
	}

	e.position_header = function(axis, sx, sw) {
		if (!axis) {
			header_x = sx
			header_w = sw
		} else {
			header_y = sx
			header_h = sw
		}
	}

	e.position_cells = function(axis, sx, sw) {

		if (horiz) {
			if (!axis) {

				let total_free_w = 0
				let cw = min_cols_w
				if (auto_cols_w) {
					cw = cells_view_w - bx
					total_free_w = max(0, cw - min_cols_w)
				}

				let col_x = 0
				for (let field of e.fields) {

					let min_col_w = col_resizing ? field._w : max(field.min_w, field.w)
					let max_col_w = col_resizing ? field._w : field.max_w
					let free_w = total_free_w * (min_col_w / min_cols_w)
					let col_w = min(floor(min_col_w + free_w), max_col_w)
					if (field == e.fields.at(-1)) {
						let remaining_w = cw - col_x
						if (total_free_w > 0)
							// set width exactly to prevent showing the horizontal scrollbar.
							col_w = remaining_w
						else
							// stretch last col to include leftovers from rounding.
							col_w = max(col_w, remaining_w)
					}

					field._y = 0
					field._x = col_x
					field._w = col_w

					col_x += col_w
				}

				cells_w = bx + col_x

				// prevent cells_w shrinking while col resizing to prevent scroll_x changes.
				if (col_resizing && !e.auto_expand)
					cells_w = max(cells_w, last_cells_w)

				page_row_count = floor(cells_view_h / e.cell_h)
				vrn = floor(cells_view_h / e.cell_h) + 2 // 2 is right, think it!

			} else {

			}
		}
	}

	e.scroll_cells = function(sx, sy) {
		scroll_x = sx
		scroll_y = sy
	}

	e.measure_sizes = function(cw, ch) {
		filters_h = 0
		if (e.auto_expand) {
			grid_w = 0
			grid_h = 0
			scroll_x = 0
			scroll_y = 0
		} else {
			grid_w = cw
			grid_h = ch
			scroll_x = e.cells_view.scrollLeft
			scroll_y = e.cells_view.scrollTop
		}
	}

	e.update_sizes = function() {

		if (hit_state == 'col_moving')
			return

		let col_resizing = hit_state == 'col_resizing'
		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width

		let auto_cols_w =
			horiz
			&& !e.auto_expand
			&& e.auto_cols_w
			&& (!e.rowset || e.rowset.auto_cols_w != false)
			&& !col_resizing

		cells_view_overflow_x = e.auto_expand ? 'hidden' : 'auto'
		cells_view_overflow_y = e.auto_expand ? 'hidden' : (auto_cols_w ? 'scroll' : 'auto')

		if (horiz) {

			let last_cells_w = cells_w

			hcell_h  = e.header_h
			header_h = e.header_h

			let min_cols_w = 0
			for (let field of e.fields)
				min_cols_w += col_resizing ? field._w : min(max(field.w, field.min_w), field.max_w)

			cells_h = by + e.cell_h * e.rows.length

			let min_cells_w = bx + min_cols_w

			// prevent cells_w shrinking while col resizing to prevent scroll_x changes.
			if (col_resizing && !e.auto_expand)
				min_cells_w = max(min_cells_w, last_cells_w)

			if (e.auto_expand) {
				cells_view_w = min_cells_w
				cells_view_h = cells_h
			} else {
				cells_view_w = grid_w // before vscrollbar.
				cells_view_h = grid_h - header_h - filters_h // before hscrollbar.
			}

			header_w = cells_view_w // before vscrollbar

			let total_free_w = 0
			let cw = min_cols_w
			if (auto_cols_w) {
				cw = cells_view_w - bx
				total_free_w = max(0, cw - min_cols_w)
			}

			let col_x = 0
			for (let field of e.fields) {

				let min_col_w = col_resizing ? field._w : max(field.min_w, field.w)
				let max_col_w = col_resizing ? field._w : field.max_w
				let free_w = total_free_w * (min_col_w / min_cols_w)
				let col_w = min(floor(min_col_w + free_w), max_col_w)
				if (field == e.fields.at(-1)) {
					let remaining_w = cw - col_x
					if (total_free_w > 0)
						// set width exactly to prevent showing the horizontal scrollbar.
						col_w = remaining_w
					else
						// stretch last col to include leftovers from rounding.
						col_w = max(col_w, remaining_w)
				}

				field._y = 0
				field._x = col_x
				field._w = col_w

				col_x += col_w
			}

			cells_w = bx + col_x

			// prevent cells_w shrinking while col resizing to prevent scroll_x changes.
			if (col_resizing && !e.auto_expand)
				cells_w = max(cells_w, last_cells_w)

			page_row_count = floor(cells_view_h / e.cell_h)
			vrn = floor(cells_view_h / e.cell_h) + 2 // 2 is right, think it!

		} else {

			hcell_h  = e.cell_h
			header_w = min(e.header_w, grid_w - 20)
			header_w = max(header_w, 20)

			for (let fi = 0; fi < e.fields.length; fi++) {
				let field = e.fields[fi]
				let [x, y, w] = cell_rel_rect(fi)
				field._x = x
				field._y = y
				field._w = w
			}

			cells_w = bx + e.cell_w * e.rows.length
			cells_h = by + e.cell_h * e.fields.length

			if (e.auto_expand) {
				cells_view_w = cells_w
				cells_view_h = cells_h
 			} else {
				cells_view_w = grid_w - header_w // before vscrollbar.
				cells_view_h = grid_h // before hscrollbar.
			}

			header_h = min(e.cell_h * e.fields.length, cells_view_h) // before hscrollbar.

			;[cells_view_w, cells_view_h] =
				scrollbox_client_dimensions(
					cells_w,
					cells_h,
					cells_view_w,
					cells_view_h,
					cells_view_overflow_x,
					cells_view_overflow_y
				)

			page_row_count = floor(cells_view_w / e.cell_w)
			vrn = floor(cells_view_w / e.cell_w) + 2 // 2 is right, think it!

		}

		vrn = min(vrn, e.rows.length)

		e.update_scroll(scroll_x, scroll_y)
	}

	// view-scroll-derived state ----------------------------------------------

	let scroll_x, scroll_y // current scroll offsets.
	let vri1, vri2 // visible row range.

	// NOTE: keep this raf-friendly, i.e. don't measure the DOM in here!
	e.update_scroll = function(sx, sy) {
		sx =  horiz ? sx : clamp(sx, 0, max(0, cells_w - cells_view_w))
		sy = !horiz ? sy : clamp(sy, 0, max(0, cells_h - cells_view_h))
		if (horiz) {
			vri1 = floor(sy / e.cell_h)
		} else {
			vri1 = floor(sx / e.cell_w)
		}
		vri2 = vri1 + vrn
		vri1 = max(0, min(vri1, e.rows.length - 1))
		vri2 = max(0, min(vri2, e.rows.length))
		scroll_x = sx
		scroll_y = sy

		// hack because we don't get pointermove events on scroll when
		// the mouse doesn't move but the div beneath the mouse pointer does.
		if (hit_state == 'cell') {
			hit_state = null
			ht_cell(null, hit_mx, hit_my)
		}
	}

	// mouse-derived state ----------------------------------------------------

	let hit_state // this affects both rendering and behavior in many ways.
	let hit_mx, hit_my // last mouse coords, needed on scroll event.
	let hit_target // last mouse target, needed on click events.
	let hit_dx, hit_dy // mouse coords relative to the dragged object.
	let hit_ri, hit_fi, hit_indent // the hit cell and whether the cell indent was hit.
	let row_move_state // additional state when row moving

	let row_rect
	{
	let r = [0, 0, 0, 0] // x, y, w, h
	row_rect = function(ri, draw_stage) {
		let s = row_move_state
		if (horiz) {
			r[0] = 0
			if (s) {
				if (draw_stage == 'moving_rows') {
					r[1] = s.x + ri * e.cell_h
				} else {
					r[1] = s.xs[ri]
				}
			} else {
				r[1] = ri * e.cell_h
			}
			r[2] = cells_w
			r[3] = e.cell_h
		} else {
			r[1] = 0
			if (s) {
				if (draw_stage == 'moving_rows') {
					r[0] = s.x + ri * e.cell_w
				} else {
					r[0] = s.xs[ri]
				}
			} else {
				r[0] = ri * e.cell_w
			}
			r[2] = e.cell_w
			r[3] = cells_h
		}
		return r
	}
	}

	let cell_rel_rect
	{
	let r = [0, 0, 0, 0]  // x, y, w, h
	cell_rel_rect = function(fi) {
		let s = row_move_state
		if (horiz) {
			r[0] = e.fields[fi]._x
			r[1] = 0
			r[2] = e.fields[fi]._w
			r[3] = e.cell_h
		} else {
			r[0] = 0
			r[1] = hit_state == 'col_moving' ? e.fields[fi]._x : fi * e.cell_h
			r[2] = e.cell_w
			r[3] = e.cell_h
		}
		return r
	}
	}

	function cell_rect(ri, fi, draw_stage) {
		let [rx, ry] = row_rect(ri, draw_stage)
		let r = cell_rel_rect(fi)
		r[0] += rx
		r[1] += ry
		return r
	}

	function hcell_rect(fi) {
		let r = cell_rel_rect(fi)
		if (!horiz)
			r[2] = header_w
		r[3] = hcell_h
		return r
	}

	function cells_rect(ri1, fi1, ri2, fi2, draw_stage) {
		let [x1, y1, w1, h1] = cell_rect(ri1, fi1, draw_stage)
		let [x2, y2, w2, h2] = cell_rect(ri2, fi2, draw_stage)
		let x = min(x1, x2)
		let y = min(y1, y2)
		let w = max(x1, x2) - x
		let h = max(y1, y2) - y
		return [x, y, w, h]
	}

	function field_has_indent(field) {
		return horiz && field == e.tree_field
	}

	function row_indent(row) {
		return row.parent_rows ? row.parent_rows.length : 0
	}

	e.scroll_to_cell = function(ri, fi) {
		if (ri == null)
			return
		let [x, y, w, h] = cell_rect(ri, fi || 0)
		e.cells_view.scroll_to_view_rect(null, null, x, y, w, h)
	}

	function row_visible_rect(row) { // relative to cells
		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width
		let ri = e.row_index(row)
		let [x, y, w, h] = row_rect(ri)
		return clip_rect(x+bx, y+by, w, h, scroll_x, scroll_y, cells_view_w, cells_view_h)
	}

	function cell_visible_rect(row, field) { // relative to cells
		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width
		let ri = e.row_index(row)
		let fi = e.field_index(field)
		let [x, y, w, h] = cell_rect(ri, fi)
		return clip_rect(x+bx, y+by, w, h, scroll_x, scroll_y, cells_view_w, cells_view_h)
	}

	// rendering --------------------------------------------------------------

	function update_cx(cx) {
		cx.font_size   = e.font_size
		cx.line_height = e.line_height
		cx.text_font   = e.text_font
		cx.icon_font   = e.icon_font
		cx.bg_search   = e.bg_search
		cx.fg_search   = e.fg_search
		cx.fg_dim      = e.fg_dim
	}

	function draw_cell_border(cx, w, h, bx, by, color_x, color_y, draw_stage) {
		let bw = w - .5
		let bh = h - .5
		let zz = -.5
		if (by && color_y != null) { // horizontals
			cx.beginPath()
			cx.lineWidth = by
			cx.strokeStyle = color_y

			// top line
			if (!horiz && draw_stage == 'moving_cols') {
				cx.moveTo(zz, zz)
				cx.lineTo(bw, zz)
			}
			// bottom line
			cx.moveTo(zz, bh)
			cx.lineTo(bw, bh)

			cx.stroke()
		}
		if (bx && color_x != null) { // verticals
			cx.beginPath()
			cx.lineWidth = bx
			cx.strokeStyle = color_x

			// left line
			if (horiz && draw_stage == 'moving_cols') {
				cx.moveTo(zz, zz)
				cx.lineTo(zz, bh)
			}
			// right line
			cx.moveTo(bw, zz)
			cx.lineTo(bw, bh)

			cx.stroke()
		}
	}

	function draw_hcell_at(field, fi, x0, y0, w, h, draw_stage) {

		// static geometry
		let px = e.padding_x
		let py = e.padding_y
		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width

		cx.save()

		cx.translate(x0, y0)

		// border
		draw_cell_border(cx, w, h, bx, by,
			e.hcell_border_v_color,
			e.hcell_border_h_color,
			draw_stage)

		// background
		let bg = draw_stage == 'moving_cols' ? e.bg_moving : e.bg_header
		if (bg) {
			cx.beginPath()
			cx.fillStyle = bg
			cx.rect(0, 0, w-bx, h-by)
			cx.fill()
		}

		// order sign
		let dir = field.sort_dir
		if (dir != null) {
			let pri  = field.sort_priority
			let asc  = horiz ? 'up'   : 'left'
			let desc = horiz ? 'down' : 'right'
			let right = horiz && field.align == 'right'
			let icon_char = fontawesome_char('fa-angle'+(pri?'-double':'')+'-'+(dir== 'asc'?asc:desc))
			cx.font = e.header_icon_font
			let x = right ? 2*px : w - 2*px
			let y = round(h / 2)
			let iw = e.font_size * 1.5
			cx.textAlign = right ? 'left' : 'right'
			cx.textBaseline = 'middle'
			cx.fillStyle = e.fg_header
			cx.fillText(icon_char, x, y)
			w -= iw
			if (right)
				cx.translate(iw, 0)
		}

		// clip
		cx.beginPath()
		cx.translate(px, py)
		let cw = w - 2*px
		let ch = h - 2*py
		cx.rect(0, 0, cw, ch)
		cx.clip()

		// text
		let x = 0
		let y = round(ch / 2)
		if (horiz)
			if (field.align == 'right')
				x = cw
			else if (field.align == 'center')
				x = cw / 2

		cx.font = e.header_text_font
		cx.textAlign = horiz ? field.align : 'left'
		cx.textBaseline = 'middle'
		cx.fillStyle = e.fg_header
		cx.fillText(field.label, x, y)

		cx.restore()

	}

	function draw_hcells_range(fi1, fi2, draw_stage) {
		cx.save()
		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width
		cx.translate(header_x, header_y)
		cx.translate(horiz ? -scroll_x + bx : 0, horiz ? 0 : -scroll_y + by)
		let skip_moving_col = hit_state == 'col_moving' && draw_stage == 'non_moving_cols'
		for (let fi = fi1; fi < fi2; fi++) {
			if (skip_moving_col && hit_fi == fi)
				continue
			let field = e.fields[fi]
			let [x, y, w, h] = hcell_rect(fi)
			draw_hcell_at(field, fi, x, y, w, h, draw_stage)
		}
		cx.restore()
	}

	function indent_offset(indent) {
		return floor(e.font_size * 1.5 + (e.font_size * 1.2) * indent)
	}

	function measure_cell_width(row, field) {
		cx.measure = true
		e.draw_cell(row, field, cx)
		cx.measure = false
		return cx.measured_width
	}

	let draw_cell_x
	let draw_cell_w
	function draw_cell_at(row, ri, fi, x, y, w, h, draw_stage) {

		let field = e.fields[fi]
		let input_val = e.cell_input_val(row, field)

		// static geometry
		let bx  = e.cell_border_v_width
		let by  = e.cell_border_h_width
		let px = e.padding_x + bx
		let py = e.padding_y + by

		// state
		let grid_focused = e.focused
		let row_focused = e.focused_row == row
		let cell_focused = row_focused && (!e.can_focus_cells || field == e.focused_field)
		let disabled = e.is_cell_disabled(row, field)
		let is_new = row.is_new
		let cell_invalid = e.cell_has_errors(row, field)
		let modified = e.cell_modified(row, field)
		let is_null = input_val == null
		let is_empty = input_val === ''
		let sel_fields = e.selected_rows.get(row)
		let selected = (isobject(sel_fields) ? sel_fields.has(field) : sel_fields) || false
		let editing = !!e.editor && cell_focused
		let hovering = hit_state == 'cell' && hit_ri == ri && hit_fi == fi
		let full_width = !draw_stage && ((row_focused && field == e.focused_field) || hovering)

		// geometry
		if (full_width) {
			let w1 = max(w, measure_cell_width(row, field) + 2*px)
			if (field.align == 'right')
				x -= (w1 - w)
			else if (field.align == 'center')
				x -= round((w1 - w) / 2)
			w = w1
		}

		let indent_x = 0
		let collapsed
		if (field_has_indent(field)) {
			indent_x = indent_offset(row_indent(row))
			let has_children = row.child_rows.length > 0
			if (has_children)
				collapsed = !!row.collapsed
			let s = row_move_state
			if (s) {
				// show minus sign on adopting parent.
				if (row == s.hit_parent_row && collapsed == null)
					collapsed = false

				// shift indent on moving rows so it gets under the adopting parent.
				if (draw_stage == 'moving_rows')
					indent_x += s.hit_indent_x - s.indent_x
			}
		}

		// background & text color
		// drawing a background is slow, so we avoid it when we can.
		let bg = (draw_stage == 'moving_cols' || draw_stage == 'moving_rows')
			&& e.bg_moving

		let fg = e.fg

		if (editing)
			bg = grid_focused ? e.row_bg_focused : e.row_bg_unfocused
		else if (cell_invalid)
			if (grid_focused && cell_focused) {
				bg = e.bg_focused_invalid
				fg = e.fg_error
			} else {
				bg = e.bg_error
				fg = e.fg_error
			}
		else if (cell_focused)
			if (selected)
				if (grid_focused) {
					bg = e.bg_focused_selected
					fg = e.fg_selected
				} else {
					bg = e.bg_unfocused_selected
					fg = e.fg_unfocused_selected
				}
			else if (grid_focused)
				bg = e.bg_focused
			else
				bg = e.bg_unselected
		else if (selected) {
			if (grid_focused)
				bg = e.bg_selected
			else
				bg = e.bg_unfocused
			fg = e.fg_selected
		} else if (is_new)
			if (modified)
				bg = e.bg_new_modified
			else
				bg = e.bg_new
		else if (modified)
			bg = e.bg_modified
		else if (row_focused)
			if (grid_focused)
				bg = e.row_bg_focused
			else
				bg = e.row_bg_unfocused

		if (!bg)
			if ((ri & 1) == 0)
				bg = e.bg_alt
			else if (full_width)
				bg = e.bg

		if (is_null || is_empty || disabled)
			fg = e.fg_dim

		// drawing

		cx.save()
		cx.translate(x, y)

		// background
		if (bg) {
			cx.beginPath()
			cx.fillStyle = bg
			cx.rect(0, 0, w, h)
			cx.fill()
		}

		// border
		draw_cell_border(cx, w, h, bx, by,
			e.cell_border_v_color,
			e.cell_border_h_color,
			draw_stage)

		if (!editing) {

			cx.save()

			// clip
			cx.beginPath()
			cx.translate(px, py)
			let cw = w - px - px
			let ch = h - py - py
			cx.cw = cw
			cx.ch = ch
			cx.rect(0, 0, cw, ch)
			cx.clip()

			let y = round(ch / 2)

			// tree node sign
			if (collapsed != null) {
				cx.fillStyle = selected ? fg : e.bg_focused_selected
				cx.font = cx.icon_font
				let x = indent_x - e.font_size - 4
				cx.textBaseline = 'middle'
				cx.fillText(collapsed ? '\uf0fe' : '\uf146', x, y)
			}

			// text
			cx.translate(indent_x, 0)
			cx.fg_text = fg
			cx.quicksearch_len = cell_focused && e.quicksearch_text.length || 0
			e.draw_val(row, field, input_val, cx)

			cx.restore()
		}

		cx.restore()

		// TODO:
		//if (ri != null && focused)
		//	update_editor(
		//		 horiz ? null : xy,
		//		!horiz ? null : xy, hit_indent)

		draw_cell_x = x
		draw_cell_w = w
	}

	function draw_hover_outline(x, y, w, h) {

		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width
		let bw = w - .5
		let bh = h - .5

		cx.save()
		cx.translate(x, y)

		cx.lineWidth = bx || by

		// add a background to override the borders.
		cx.strokeStyle = e.bg
		cx.setLineDash(empty_array)
		cx.beginPath()
		cx.rect(-.5, -.5, bw + .5, bh + .5)
		cx.stroke()

		// draw the actual hover outline.
		cx.strokeStyle = e.fg
		cx.setLineDash([1, 3])
		cx.beginPath()
		cx.rect(-.5, -.5, bw + .5, bh + .5)
		cx.stroke()

		cx.restore()
	}

	function draw_row_strike_line(row, ri,x, y, w, h, draw_stage) {
		cx.save()
		cx.strokeStyle = e.fg
		cx.beginPath()
		if (horiz) {
			cx.translate(x, y + h / 2 + .5)
			cx.moveTo(0, 0)
			cx.lineTo(w, 0)
			cx.stroke()
		} else {
			cx.translate(x + w / 2, y + .5)
			cx.moveTo(0, 0)
			cx.lineTo(0, h)
			cx.stroke()
		}
		cx.restore()
	}

	function draw_row_invalid_border(row, ri,x, y, w, h, draw_stage) {
		cx.lineWidth = 1
		cx.strokeStyle = e.bg_error
		cx.beginPath()
		cx.rect(x - .5, y -.5, w - horiz, h - (1 - horiz))
		cx.stroke()
	}

	function draw_cell(ri, fi, draw_stage) {
		let [x, y, w, h] = cell_rect(ri, fi, draw_stage)
		let row = e.rows[ri]
		draw_cell_at(row, ri, fi, x, y, w, h, draw_stage)
	}

	function draw_cells_range(rows, ri1, ri2, fi1, fi2, draw_stage) {
		cx.save()
		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width
		cx.translate(-scroll_x + bx, -scroll_y + by)

		let hit_cell, foc_cell, foc_ri, foc_fi
		if (!draw_stage) {

			foc_ri = e.focused_row_index
			foc_fi = e.focused_field_index

			hit_cell = hit_state == 'cell'
				&& hit_ri >= ri1 && hit_ri <= ri2
				&& hit_fi >= fi1 && hit_fi <= fi2

			foc_cell = foc_ri != null && foc_fi != null

			// when foc_cell and hit_cell are the same, don't draw them twice.
			if (foc_cell && hit_cell && hit_ri == foc_ri && hit_fi == foc_fi)
				foc_cell = null

		}
		let skip_moving_col = hit_state == 'col_moving' && draw_stage == 'non_moving_cols'

		for (let ri = ri1; ri < ri2; ri++) {

			let row = rows[ri]
			let [rx, ry, rw, rh] = row_rect(ri, draw_stage)

			let foc_cell_now = foc_cell && foc_ri == ri
			let hit_cell_now = hit_cell && hit_ri == ri

			for (let fi = fi1; fi < fi2; fi++) {
				if (skip_moving_col && hit_fi == fi)
					continue
				if (hit_cell_now && hit_fi == fi)
					continue
				if (foc_cell_now && foc_fi == fi)
					continue

				let [x, y, w, h] = cell_rel_rect(fi)
				draw_cell_at(row, ri, fi, rx + x, ry + y, w, h, draw_stage)
			}

			if (row.removed)
				draw_row_strike_line(row, ri, rx, ry, rw, rh, draw_stage)
		}

		if (foc_cell && foc_ri >= ri1 && foc_ri <= ri2 && foc_fi >= fi1 && foc_fi <= fi2)
			draw_cell(foc_ri, foc_fi, draw_stage)

		// hit_cell can overlap foc_cell, so we draw it after it.
		draw_cell_x = null
		draw_cell_w = null
		if (hit_cell && hit_ri >= ri1 && hit_ri <= ri2 && hit_fi >= fi1 && hit_fi <= fi2)
			draw_cell(hit_ri, hit_fi, draw_stage)

		for (let ri = ri1; ri < ri2; ri++) {
			let row = rows[ri]
			if (row.errors && row.errors.failed) {
				let [rx, ry, rw, rh] = row_rect(ri, draw_stage)
				draw_row_invalid_border(row, ri, rx, ry, rw, rh, draw_stage)
			}
		}

		if (draw_cell_w != null) {
			let [x, y, w, h] = cell_rect(hit_ri, hit_fi, draw_stage)
			x = draw_cell_x
			w = draw_cell_w
			draw_hover_outline(x, y, w, h)
		}

		cx.restore()
	}

	e.draw_header = function() {

		/*
		e.cells.w = max(1, cells_w) // need at least 1px to show scrollbar.
		e.cells.h = max(1, cells_h) // need at least 1px to show scrollbar.

		e.cells_view.w = e.auto_expand ? cells_view_w : null
		e.cells_view.h = e.auto_expand ? cells_view_h : null

		e.cells_view.style['overflow-x'] = cells_view_overflow_x
		e.cells_view.style['overflow-y'] = cells_view_overflow_y

		e.cells_canvas.x = scroll_x
		e.cells_canvas.y = scroll_y

		e.header.show(e.header_visible)

		e.header.w = horiz ? null : header_w
		e.header.h = header_h + filters_h

		e.filters_bar.x = -scroll_x
		e.filters_bar.y = header_h
		e.filters_bar.h = filters_h

		e.cells_canvas .resize(cells_view_w, cells_view_h, 200, 200)
		e.header_canvas.resize(header_w, header_h, 200, horiz ? 1 : 200)
		*/

		if (hit_state == 'row_moving') { // draw fixed rows first and moving rows above them.
			draw_hcells_range(0, e.fields.length)
		} else if (hit_state == 'col_moving') { // draw fixed cols first and moving cols above them.
			draw_hcells_range(0     , e.fields.length, 'non_moving_cols')
			draw_hcells_range(hit_fi, hit_fi + 1     , 'moving_cols')
		} else {
			draw_hcells_range(0, e.fields.length)
		}

	}

	e.draw_cells = function() {

		for (let field of e.fields)
			if (field.filter_input)
				field.filter_input.position()

		if (hit_state == 'row_moving') { // draw fixed rows first and moving rows above them.
			let s = row_move_state
			draw_cells_range(e.rows, s.vri1,      s.vri2     , 0, e.fields.length, 'non_moving_rows')
			draw_cells_range(s.rows, s.move_vri1, s.move_vri2, 0, e.fields.length, 'moving_rows')
		} else if (hit_state == 'col_moving') { // draw fixed cols first and moving cols above them.
			draw_cells_range (e.rows, vri1, vri2, 0     , e.fields.length, 'non_moving_cols')
			draw_cells_range (e.rows, vri1, vri2, hit_fi, hit_fi + 1     , 'moving_cols')
		} else {
			draw_cells_range(e.rows, vri1, vri2, 0, e.fields.length)
		}

	}

	return e
}

// header --------------------------------------------------------------------

let header = {}

header.create = function(cmd, view) {
	return ui.cmd(cmd, view)
}

header.measure = function(a, i, axis) {
	let view = a[i]
	let min_w = view.measure_header(axis)
	add_ct_min_wh(a, axis, min_w, 0)
}

header.position = function(a, i, axis, sx, sw) {
	let view = a[i]
	view.position_header(axis, sx, sw)
}

header.draw = function(a, i) {
	let view = a[i]
	view.draw_header()
}

ui.widget('grid_header', header)


