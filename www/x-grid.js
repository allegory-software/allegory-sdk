/*

	Model-driven tree-grid widget.
	Written by Cosmin Apreutesei. Public Domain.

WIDGETS

	grid
	grid_dropdown
	row_form

*/

/* ---------------------------------------------------------------------------
// grid widget
// ---------------------------------------------------------------------------
uses:
	...
implements:
	nav widget protocol.
--------------------------------------------------------------------------- */

component('x-grid', 'Input', function(e) {

	val_widget(e, true)
	nav_widget(e)
	editable_widget(e)
	focusable_widget(e)
	e.class('x-focusable-items')
	stylable_widget(e)

	function theme_changed() {

		let css = e.css()

		// css geometry
		e.text_font_family = css['font-family']
		e.icon_font_family = 'fontawesome'
		e.font_size   = num(css['font-size'])
		e.line_height = num(css.prop('--x-grid-cell-line-height'))
		e.padding_x   = num(css.prop('--x-padding-x-input'))
		e.padding_y1  = num(css.prop('--x-padding-y-input-top'))
		e.padding_y2  = num(css.prop('--x-padding-y-input-bottom'))
		e.cell_h      = num(css.prop('--x-grid-cell-h'))

		// css colors
		e.border_width               = num(css.prop('--x-border-width-item'))
		e.border_color               = css.prop('--x-faint')
		e.bg                         = css.prop('--x-bg')
		e.fg                         = css.prop('--x-fg')
		e.fg_disabled                = css.prop('--x-fg-disabled')
		e.fg_search                  = css.prop('--x-fg-search')
		e.bg_search                  = css.prop('--x-bg-search')
		e.bg_error                   = css.prop('--x-bg-error')
		e.bg_unfocused               = css.prop('--x-bg-unfocused')
		e.bg_focused                 = css.prop('--x-bg-focused')
		e.bg_unfocused_selected      = css.prop('--x-bg-unfocused-selected')
		e.fg_unfocused_selected      = css.prop('--x-fg-unfocused-selected')
		e.bg_focused_selected        = css.prop('--x-bg-focused-selected')
		e.bg_focused_invalid         = css.prop('--x-bg-focused-invalid')
		e.bg_unselected              = css.prop('--x-bg-unselected')
		e.bg_selected                = css.prop('--x-bg-selected')
		e.fg_selected                = css.prop('--x-fg-selected')
		e.row_bg_focused             = css.prop('--x-bg-row-focused')
		e.bg_new                     = css.prop('--x-bg-new')
		e.bg_modified                = css.prop('--x-bg-modified')
		e.bg_new_modified            = css.prop('--x-bg-new-modified')
		e.bg_moving                  = css.prop('--x-bg-moving')

		e.auto_w = false
		e.auto_h = false
		e.header_w = 120            // vertical grid
		e.cell_w = 120              // vertical grid
		e.text_font = e.font_size + 'px ' + e.text_font_family
		e.icon_font = e.font_size + 'px ' + e.icon_font_family
		e.cell_h = e.cell_h || round(e.font_size * 2)
		e.baseline = e.line_height - e.padding_y1

		e.update({sizes: true})
	}

	e.prop('auto_cols_w', {store: 'var', type: 'bool', default: false}) // horizontal grid

	e.set_auto_cols_w = function() {
		e.update({sizes: true})
	}

	// keyboard behavior
	e.auto_jump_cells = true    // jump to next/prev cell on caret limits with Ctrl.
	e.tab_navigation = false    // disabled as it prevents jumping out of the grid.
	e.advance_on_enter = 'next_row' // false|'next_row'|'next_cell'
	e.prop('exit_edit_on_escape'           , {store: 'var', type: 'bool', default: true})
	e.prop('exit_edit_on_enter'            , {store: 'var', type: 'bool', default: true})
	e.quick_edit = false        // quick edit (vs. quick-search) when pressing a key

	// mouse behavior
	e.prop('can_reorder_fields'            , {store: 'var', type: 'bool', default: true})
	e.prop('enter_edit_on_click'           , {store: 'var', type: 'bool', default: false})
	e.prop('enter_edit_on_click_focused'   , {store: 'var', type: 'bool', default: false})
	e.prop('enter_edit_on_dblclick'        , {store: 'var', type: 'bool', default: true})
	e.prop('focus_cell_on_click_header'    , {store: 'var', type: 'bool', default: false})
	e.prop('can_change_parent'             , {store: 'var', type: 'bool', default: true})

	// context menu features
	e.prop('enable_context_menu'           , {store: 'var', type: 'bool', default: true})
	e.prop('can_change_header_visibility'  , {store: 'var', type: 'bool', default: true})
	e.prop('can_change_filters_visibility' , {store: 'var', type: 'bool', default: true})
	e.prop('can_change_fields_visibility'  , {store: 'var', type: 'bool', default: true})

	var horiz = true
	e.get_vertical = function() { return !horiz }
	e.set_vertical = function(v) {
		horiz = !v
		e.class('x-hgrid',  horiz)
		e.class('x-vgrid', !horiz)
		e.update({fields: true, rows: true, sizes: true})
	}
	e.prop('vertical', {type: 'bool', attr: true})

	e.header       = div({class: 'x-grid-header'})
	e.cells        = tag('canvas', {class : 'x-grid-cells-canvas', width: 0, height: 0})
	e.cells_ct     = div({class: 'x-grid-cells-ct'}, e.cells)
	e.cells_view   = div({class: 'x-grid-cells-view'}, e.cells_ct)
	e.progress_bar = div({class: 'x-grid-progress-bar'})
	e.add(e.header, e.progress_bar, e.cells_view)

	var cx = e.cells.getContext('2d')

	e.on('bind', function(on) {
		document.on('layout_changed', layout_changed, on)
		document.on('theme_changed', theme_changed, on)
		theme_changed()
	})

	// cell widths ------------------------------------------------------------

	var cells_w // sum-width of all val cells (so excluding header)

	function set_header_cell_xw(cell, field, x, w) {
		cell.x  = x
		cell.min_w = w
		cell.w = w
	}

	function update_cell_widths_horiz(col_resizing) {

		let cols_w = 0
		for (let field of e.fields)
			cols_w += field.w

		let total_free_w = 0
		let cw = cols_w
		if (e.auto_cols_w && (!e.rowset || e.rowset.auto_cols_w != false) && !col_resizing) {
			cw = e.cells_view.clientWidth
			total_free_w = max(0, cw - cols_w)
		}

		let col_x = 0
		for (let fi = 0; fi < e.fields.length; fi++) {
			let field = e.fields[fi]
			let hcell = e.header.at[fi]

			let min_col_w = col_resizing ? field._w : field.w
			let max_col_w = col_resizing ? field._w : field.max_w
			let free_w = total_free_w * (min_col_w / cols_w)
			let col_w = min(floor(min_col_w + free_w), max_col_w)
			if (fi == e.fields.length - 1) {
				let remaining_w = cw - col_x
				if (total_free_w > 0)
					// set width exactly to prevent showing the horizontal scrollbar.
					col_w = remaining_w
				else
					// stretch last col to include leftovers from rounding.
					col_w = max(col_w, remaining_w)
			}

			field._x = col_x
			field._w = col_w

			if (hcell.filter_dropdown)
				hcell.filter_dropdown.w = hcell.clientWidth

			col_x += col_w
		}

		let header_w = e.fields.length ? col_x : cw
		e.header.w   = header_w
		e.cells_ct.w = header_w
		cells_w      = header_w

		for (let fi = 0; fi < e.fields.length; fi++) {
			let field = e.fields[fi]
			each_header_cell_of_col(fi, set_header_cell_xw, field, field._x, field._w)
		}
	}

	function update_cell_widths_vert() {
		for (let fi = 0; fi < e.fields.length; fi++) {
			let hcell = e.header.at[fi]
			let [x, y, w, h] = cell_rect(0, fi)
			set_header_cell_xw(hcell, e.fields[fi], x, w)
		}
	}

	// view-size-derived state ------------------------------------------------

	var cells_h // sum-height of all val cells (so excluding header).
	var header_h // header height.
	var cells_view_w, cells_view_h // viewport dimensions.
	var page_row_count // how many rows in a page for pgup/pgdown navigation.
	var vrn // how many rows are fully or partially in the viewport.

	function update_sizes() {

		if (horiz) {

			// these must be reset when changing from !horiz to horiz.
			e.header.w = null
			e.header.h = null
			if (e.cells)
				e.cells.x = null
			e.cells_view.w = null
			cells_view_w = e.cells_view.cw

			cells_h = e.cell_h * e.rows.length

			let client_h = e.clientHeight
			let border_h = e.offsetHeight - client_h
			header_h = e.header.offsetHeight

			if (e.auto_w) {

				let cols_w = 0
				for (let field of e.fields)
					cols_w += field.w

				let client_w = e.cells_view.clientWidth
				let border_w = e.offsetWidth - e.clientWidth
				let vscrollbar_w = e.cells_view.offsetWidth - client_w
				e.w = cols_w + border_w + vscrollbar_w
			}

			if (e.auto_h)
				e.h = cells_h + header_h + border_h

			cells_view_h = floor(e.cells_view.rect().h)
			e.cells_ct.h = max(1, cells_h) // need at least 1px to show scrollbar.
			vrn = ceil(cells_view_h / e.cell_h)
			page_row_count = floor(cells_view_h / e.cell_h)

			/*
			// TODO: finish this!
			e.cells_view.style.overflowX =
				e.cells_view.scrollWidth > e.cells_view.clientWidth + 100
					? 'scroll' : 'hidden'
			*/

		} else {

			e.header.w = e.header_w
			e.header.max_h = e.cell_h * e.fields.length

			cells_w = e.cell_w * e.rows.length
			cells_h = e.cell_h * e.fields.length

			let border_w = e.offsetWidth - e.clientWidth

			if (e.auto_w)
				e.w = cells_w + e.header_w + border_w

			let client_w = e.cw
			border_w = e.offsetWidth - client_w
			let header_w = e.header.offsetWidth

			let client_h = e.cells_view.ch
			if (e.auto_h) {
				let border_h = e.offsetHeight - e.ch
				let hscrollbar_h = e.cells_view.offsetHeight - client_h
				e.h = cells_h + border_h + hscrollbar_h
			}

			cells_view_w = client_w - header_w
			cells_view_h = min(client_h, cells_h)
			e.cells_ct.w = cells_w
			e.cells_ct.h = cells_h
			e.cells_view.w = cells_view_w
			vrn = ceil(cells_view_w / e.cell_w)

			for (let fi = 0; fi < e.fields.length; fi++) {
				let hcell = e.header.at[fi]
				hcell.y = cell_y(0, fi)
			}

		}

		vrn = min(vrn, e.rows.length)
	}

	// view-scroll-derived state ----------------------------------------------

	var vri1, vri2 // range of rows in the viewport.
	var scroll_x, scroll_y // current scroll offsets.

	function update_scroll() {
		let sy = e.cells_view.scrollTop
		let sx = e.cells_view.scrollLeft
		sx =  horiz ? sx : clamp(sx, 0, max(0, cells_w - cells_view_w))
		sy = !horiz ? sy : clamp(sy, 0, max(0, cells_h - cells_view_h))
		if (horiz) {
			e.header.x = -sx
			e.cells.y = sy
			vri1 = floor(sy / e.cell_h)
			e.cells.x = sx
		} else {
			e.header.y = -sy
			e.cells.x = sx
			vri1 = floor(sx / e.cell_w)
		}
		vri2 = vri1 + vrn

		if (scroll_x == sx && scroll_y == sy)
			return

		// hack because we don't get pointermove events on scroll when
		// the mouse doesn't move but the div beneath the mouse pointer does.
		if (hit_mx && hit_state == 'cell')
			if (ht_cell(hit_mx, hit_my))
				ht_cell_update()

		scroll_x = sx
		scroll_y = sy
		return true
	}

	// ------------------------------------------------------------------------

	var hit_state
	var hit_mx, hit_my
	var hit_x
	var hit_ri, hit_fi
	var hit_dx
	var hit_indent
	var row_move_state
	var col_move_fi

	{
	let r = [0, 0, 0, 0] // x, y, w, h
	function row_rect(ri, draw_state) {
		let s = row_move_state
		if (horiz) {
			r[0] = 0
			if (s) {
				if (draw_state == 'moving_rows') {
					r[1] = s.x + ri * e.cell_h - s.vri1x
				} else {
					r[1] = s.xs[ri] - s.vri1x
				}
			} else {
				r[1] = ri * e.cell_h
			}
			r[2] = cells_w
			r[3] = e.cell_h
		} else {
			r[1] = 0
			if (s) {
				if (draw_state == 'moving_row') {
					r[0] = s.x + ri * e.cell_w - s.vri1x
				} else {
					r[0] = s.xs[ri] - s.vri1x
				}
			} else {
				r[0] = ri * e.cell_w
			}
			r[2] = cell_w
			r[3] = cells_h
		}
		return r
	}
	}

	{
	let r = [0, 0, 0, 0]  // x, y, w, h
	function cell_rel_rect(fi, draw_state) {
		let s = row_move_state
		if (horiz) {
			r[0] = e.fields[fi]._x
			r[1] = 0
			r[2] = e.fields[fi]._w
			r[3] = e.cell_h
		} else {
			r[0] = 0
			r[1] = draw_state == 'moving_cols' ? e.fields[fi]._x : fi * e.cell_h
			r[2] = e.cell_w
			r[3] = e.cell_h
		}
		return r
	}
	}

	function cell_rect(ri, fi, draw_state) {
		let [rx, ry] = row_rect(ri, draw_state)
		let r = cell_rel_rect(fi, draw_state)
		r[0] += rx
		r[1] += ry
		return r
	}

	function cell_x(ri, fi, draw_state) { return cell_rect(ri, fi, draw_state)[0] }
	function cell_y(ri, fi, draw_state) { return cell_rect(ri, fi, draw_state)[1] }
	function cell_w(ri, fi, draw_state) { return cell_rect(ri, fi, draw_state)[2] }
	function cell_h(ri, fi, draw_state) { return cell_rect(ri, fi, draw_state)[3] }

	function field_has_indent(field) {
		return horiz && field == e.tree_field
	}

	function row_indent(row) {
		return row.parent_rows ? row.parent_rows.length : 0
	}

	function update_header_w(w) { // vgrid
		e.header_w = max(0, w)
		e.update({sizes: true})
	}

	e.scroll_to_cell = function(ri, fi) {
		if (ri == null)
			return
		let [x, y, w, h] = cell_rect(ri, fi || 0)
		e.cells_view.scroll_to_view_rect(null, null, x, y, w, h)
	}

	function row_visible_rect(row) { // relative to cells_ct
		let ri = e.row_index(row)
		let r = domrect(...row_rect(ri))
		let c = e.cells_ct.rect()
		let v = e.cells_view.rect()
		v.x -= c.x
		v.y -= c.y
		return r.clip(v)
	}

	function each_header_cell_of_col(fi, f, ...args) {
		f(e.header.at[fi], ...args)
	}

	// responding to layout changes -------------------------------------------

	{
		let w0, h0
		function layout_changed() {
			let r = e.rect()
			let w1 = r.w
			let h1 = r.h
			if (w1 == 0 && h1 == 0)
				return // hidden
			if (h1 !== h0 || w1 !== w0)
				e.update({sizes: true})
			w0 = w1
			h0 = h1
		}

		// detect w/h changes from resizing made with css 'resize: both'.
		e.on('resize', layout_changed)
	}

	// rendering --------------------------------------------------------------

	function create_fields() {
		e.header.clear()
		for (let fi = 0; fi < e.fields.length; fi++) {
			let field = e.fields[fi]
			let sort_icon     = span({class: 'fa x-grid-sort-icon'})
			let sort_icon_pri = span({class: 'x-grid-header-sort-icon-pri'})
			let title_div = tag('td', {class: 'x-grid-header-title-td'})
			title_div.set(field.text)
			title_div.title = field.hint || title_div.textContent
			let sort_icon_div = tag('td', {class: 'x-grid-header-sort-icon-td'}, sort_icon, sort_icon_pri)
			let e1 = title_div
			let e2 = sort_icon_div
			if (horiz && field.align == 'right')
				[e1, e2] = [e2, e1]
			e1.attr('align', 'left')
			e2.attr('align', 'right')
			let title_table = tag('table', {class: 'x-grid-header-cell-table'}, tag('tr', 0, e1, e2))
			let hcell = div({class: 'x-grid-header-cell'}, title_table)
			hcell.fi = fi
			hcell.title_div = title_div
			hcell.sort_icon = sort_icon
			hcell.sort_icon_pri = sort_icon_pri
			e.header.add(hcell)
			create_filter(field, hcell)
		}
	}

	function create_filter(field, hcell) {
		if (!(horiz && e.filters_visible && field.filter_by))
			return
		let rs = e.filter_rowset(field)
		let dd = grid_dropdown({
			lookup_rowset : e.rowset,
			lookup_cols   : 1,
			classes       : 'x-grid-filter-dropdown',
			mode          : 'fixed',
			grid: {
				cell_h: 22,
				classes: 'x-grid-filter-dropdown-grid',
			},
		})

		let f0 = rs.all_fields[0]
		let f1 = rs.all_fields[1]

		dd.display_val = function() {
			if (!rs.filtered_count)
				return () => div({class: 'x-item disabled'}, S('all', 'all'))
			else
				return () => span({}, div({class: 'x-grid-filter fa fa-filter'}), rs.filtered_count+'')
		}

		dd.on('opened', function() {
			rs.load()
		})

		dd.picker.pick_val = function() {
			let checked = !rs.val(this.focused_row, f0)
			rs.set_val(this.focused_row, f0, checked)
			rs.filtered_count = (rs.filtered_count || 0) + (checked ? -1 : 1)
			dd.do_update_val()
		}

		dd.picker.on('keydown', function(key) {
			if (key == ' ')
				this.pick_val()
		})

		hcell.filter_dropdown = dd
		hcell.add(dd)
	}

	function update_sort_icons() {
		let asc  = horiz ? 'up' : 'left'
		let desc = horiz ? 'down' : 'right'
		for (let fi = 0; fi < e.fields.length; fi++) {
			let field = e.fields[fi]
			let hcell = e.header.at[fi]
			let dir = field.sort_dir
			let pri = field.sort_priority
			hcell.sort_icon.class('fa-angle-'+asc        , false)
			hcell.sort_icon.class('fa-angle-double-'+asc , false)
			hcell.sort_icon.class('fa-angle-'+desc       , false)
			hcell.sort_icon.class('fa-angle-double-'+desc, false)
			hcell.sort_icon.class('fa-angle'+(pri?'-double':'')+'-'+asc , dir == 'asc')
			hcell.sort_icon.class('fa-angle'+(pri?'-double':'')+'-'+desc, dir == 'desc')
			hcell.sort_icon.parent.class('sorted', dir)
			hcell.sort_icon_pri.set(pri > 1 ? pri : '')
		}
	}

	function update_cells_canvas() {
		let w = cells_view_w
		let h = cells_view_h
		let p = 200 // size multiple for lowering the number of incremental resizes.
		w = ceil(w / p) * p
		h = ceil(h / p) * p
		if (e.cells.width  != w) e.cells.width  = w
		if (e.cells.height != h) e.cells.height = h
		e.empty_rt.hidden = e.rows.length > 0
	}

	function indent_offset(indent) {
		return floor(e.font_size * 1.5 + (e.font_size * 1.2) * indent)
	}

	function measure_cell_width(row, field) {
		cx.measure = true
		let val = e.cell_input_val(row, field)
		e.draw_cell_val(row, field, val, cx)
		cx.measure = false
		return cx.measured_width
	}

	function draw_cell_at(row, ri, fi, x, y, w, h, draw_state) {

		let field = e.fields[fi]
		let input_val = e.cell_input_val(row, field)

		// static geometry
		let px  = e.padding_x  + e.border_width
		let py1 = e.padding_y1 + e.border_width
		let py2 = e.padding_y2

		// state
		let grid_focused = e.focused
		let row_focused = e.focused_row == row
		let cell_focused = row_focused && (!e.can_focus_cells || field == e.focused_field)
		let disabled = e.is_cell_disabled(row, field)
		let is_new = row.is_new
		let cell_errors = e.cell_errors(row, field)
		let cell_invalid = !!(cell_errors && !cell_errors.passed)
		let modified = e.cell_modified(row, field)
		let is_null = input_val == null
		let is_empty = input_val === ''
		let sel_fields = e.selected_rows.get(row)
		let selected = (isobject(sel_fields) ? sel_fields.has(field) : sel_fields) || false
		let editing = !!e.editor && cell_focused
		let hovering = hit_ri == ri && hit_fi == fi
		let full_width = cell_focused || hovering

		if (full_width) {
			if (!draw_state)
				return
			w = max(w, measure_cell_width(row, field) + 2*px)
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
				if (draw_state == 'moving_rows')
					indent_x += s.hit_indent_x - s.indent_x
			}
		}

		cx.save()
		cx.translate(x, y)

		// border
		let bw = w - .5
		let bh = h - .5
		cx.lineWidth = e.border_width
		cx.strokeStyle = e.border_color
		cx.beginPath()
		cx.moveTo(bw,  0)
		cx.lineTo(bw, bh)
		cx.lineTo( 0, bh)
		cx.stroke()

		// background & text color
		// drawing a background is slow, so we avoid it when we can.
		let bg = (draw_state == 'col_moving' || draw_state == 'row_moving')
			&& e.bg_moving

		let fg = e.fg

		if (editing)
			bg = e.row_bg_focused
		else if (cell_focused)
			if (cell_invalid)
				bg = e.bg_focused_invalid
			else if (selected)
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
		else if (cell_invalid)
			bg = e.bg_error
		else if (selected) {
			if (grid_focused)
				bg = e.bg_selected
			else
				bg = e.bg_unfocused
			fg = e.fg_selected
		} else if (row_focused)
			bg = e.row_bg_focused
		else if (is_new)
			if (modified)
				bg = e.bg_new_modified
			else
				bg = e.bg_new
		else if (modified)
			bg = e.bg_modified

		if (full_width && !bg)
			bg = e.bg

		if (is_null || is_empty || disabled)
			fg = e.fg_disabled

		if (bg) {
			cx.beginPath()
			cx.fillStyle = bg
			cx.rect(0, 0, w, h)
			cx.fill()
		}

		if (!editing) {

			cx.save()

			// clip
			cx.beginPath()
			cx.translate(px, py1)
			let cw = w - px  - px
			let ch = h - py1 - py2
			cx.cw = cw
			cx.ch = ch
			cx.rect(0, 0, cw, ch)
			cx.clip()

			// tree node sign
			if (collapsed != null) {
				cx.fillStyle = selected ? fg : e.bg_focused_selected
				cx.font = cx.icon_font
				let x = indent_x - e.font_size - 4
				cx.fillText(collapsed ? '\uf0fe' : '\uf146', x, cx.baseline)
			}

			// text
			cx.translate(indent_x, 0)
			cx.fg_text = fg
			cx.quicksearch_len = cell_focused && e.quicksearch_text.length || 0
			e.draw_cell_val(row, field, input_val, cx)

			cx.restore()
		}

		// hover outline
		if (hovering) {
			cx.beginPath()
			let b = e.border_width
			cx.rect(-b + .5, -b + .5, bw + b + .5, bh + b + .5)
			cx.lineWidth = b
			cx.strokeStyle = e.fg
			cx.setLineDash([1, 3])
			cx.stroke()
		}

		cx.restore()

		// TODO:
		// let s = invalid && errors
		//  		.filter(e => !e.passed)
		//  		.map(e => isnode(e.message) ? e.message.textContent : e.message)
		//  		.join('\n')
		// cell.attr('title', s)
		//

		// TODO:
		//if (ri != null && focused)
		//	update_editor(
		//		 horiz ? null : xy,
		//		!horiz ? null : xy, hit_indent)


	}

	function draw_row_strike_line(row, ri,x, y, w, h, draw_state) {
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

	function draw_row_invalid_border(row, ri,x, y, w, h, draw_state) {
		cx.strokeStyle = e.bg_error
		cx.beginPath()
		cx.rect(x + .5, y + .5, w - 1, h)
		cx.stroke()
	}

	function draw_cell(ri, fi, draw_state) {
		let [x, y, w, h] = cell_rect(ri, fi, draw_state)
		let row = e.rows[ri]
		draw_cell_at(row, ri, fi, x, y, w, h, draw_state)
	}

	function update_cells_range(rows, ri1, ri2, fi1, fi2, draw_state) {
		cx.save()
		cx.translate(-scroll_x, -scroll_y)
		let foc_ri = e.focused_row_index
		let foc_fi = e.focused_field_index
		for (let ri = ri1; ri < ri2; ri++) {

			let row = rows[ri]
			let [rx, ry, rw, rh] = row_rect(ri, draw_state)

			for (let fi = fi1; fi < fi2; fi++) {
				if (draw_state == 'moving_cols' || fi != col_move_fi) {
					let [x, y, w, h] = cell_rel_rect(fi, draw_state)
					draw_cell_at(row, ri, fi, rx + x, ry + y, w, h, draw_state)
				}
			}

			if (foc_ri == ri && foc_fi != null)
				draw_cell(foc_ri, foc_fi, 'hit')

			if (hit_ri == ri && hit_fi != null && !(hit_ri == foc_ri && hit_fi == foc_fi))
				draw_cell(hit_ri, hit_fi, 'hit')

			if (row.removed)
				draw_row_strike_line(row, ri, rx, ry, rw, rh, draw_state)
		}
		for (let ri = ri1; ri < ri2; ri++) {
			let row = rows[ri]
			let invalid = row.errors && !row.errors.passed
			if (invalid) {
				let [rx, ry, rw, rh] = row_rect(ri, draw_state)
				draw_row_invalid_border(row, ri, rx, ry, rw, rh, draw_state)
			}
		}
		cx.restore()
	}

	function update_cells() {
		cx.clearRect(0, 0, e.cells.width, e.cells.height)
		cx.text_font = e.text_font
		cx.icon_font = e.icon_font
		cx.baseline = e.baseline
		cx.bg_search = e.bg_search
		cx.fg_search = e.fg_search
		if (hit_state == 'row_moving') {
			let s = row_move_state
			update_cells_range(e.rows, s.vri1,      s.vri2     , 0, e.fields.length)
			update_cells_range(s.rows, s.move_vri1, s.move_vri2, 0, e.fields.length, 'moving_rows')
		} else if (hit_state == 'col_moving') {
			update_cells_range(e.rows, vri1, vri2, 0, e.fields.length)
			update_cells_range(e.rows, vri1, vri2, col_move_fi, col_move_fi + 1, 'moving_cols')
		} else {
			update_cells_range(e.rows, vri1, vri2, 0, e.fields.length)
		}
	}
	var update_cells_async = raf_wrap(update_cells)

	e.header.on('wheel', function(ev) {
		if (horiz)
			return
		e.cells_view.scrollBy(0, ev.deltaY)
	})

	function cells_view_scroll() {
		// TODO: use e.begin_update() / e.update() instead of update_cells()
		if (update_scroll())
			update_cells()
		update_row_error_tooltip_position()
	}

	e.cells_view.on('scroll', cells_view_scroll)

	// row error tooltip ------------------------------------------------------

	let error_tooltip_row
	e.do_error_tooltip_check = function() {
		if (!error_tooltip_row) return false
		if (e.editor && e.editor.do_error_tooltip_check()) return false
		if (e.hasfocus) return true
		return false
	}

	function update_row_error_tooltip_position() {
		if (!e.error_tooltip) return
		if (!error_tooltip_row) return
		let r = row_visible_rect(error_tooltip_row)
		e.error_tooltip.begin_update()
		e.error_tooltip.target_rect = r
		e.error_tooltip.side = horiz ? 'top' : 'right'
		e.error_tooltip.end_update()
	}

	function update_row_error_tooltip(row) {
		return;
		if (!e.error_tooltip) {
			if (!row)
				return
			e.error_tooltip = tooltip({kind: 'error',
				target: e.cells_ct,
				check: e.do_error_tooltip_check})
		}
		let row_errors = row && e.row_errors(row)
		error_tooltip_row = row_errors && row_errors.length > 0 ? row : null
		e.error_tooltip.begin_update()
		if (error_tooltip_row) {
			e.error_tooltip.text = row_errors.ul({class: 'x-error-list'}, true)
			update_row_error_tooltip_position()
		} else {
			e.error_tooltip.update()
		}
		e.error_tooltip.end_update()
	}

	e.do_focus_row = function(row) {
		update_row_error_tooltip(row)
	}

	// resize guides ----------------------------------------------------------

	let resize_guides

	function update_resize_guides() {
		if (!resize_guides)
			return
		for (let fi = 0; fi < e.fields.length; fi++) {
			let field = e.fields[fi]
			let guide = resize_guides.at[fi]
			let hcell = e.header.at[fi]
			guide.x = field.align == 'right'
				? field._x + field._w - field.w
				: field._x + field.w
			guide.h = header_h + cells_view_h
		}
	}

	function create_resize_guides() {
		if (!horiz)
			return
		if (!e.auto_cols_w)
			return
		resize_guides = div({class: 'x-grid-resize-guides'})
		for (let fi = 0; fi < e.fields.length; fi++)
			resize_guides.add(div({class: 'x-grid-resize-guide'}))
		e.add(resize_guides)
		update_resize_guides()
	}

	function remove_resize_guides() {
		if (!resize_guides)
			return
		resize_guides.remove()
		resize_guides = null
	}

	// header_visible & filters_visible live properties -----------------------

	let header_visible = true
	e.property('header_visible',
		function() {
			return header_visible
		},
		function(v) {
			v = !!v
			header_visible = v
			e.header.hidden = !v
			e.update({sizes: true})
		}
	)

	let filters_visible = false
	e.property('filters_visible',
		function() {
			return filters_visible
		},
		function(v) {
			filters_visible = !!v
			e.header.class('with-filters', filters_visible)
			e.update({sizes: true})
		}
	)

	// inline editing ---------------------------------------------------------

	// when: input created, column width or height changed.
	function update_editor(ex, ey, indent) {
		if (!e.editor) return
		let ri = e.focused_row_index
		let fi = e.focused_field_index
		let field = e.fields[fi]
		let row = e.rows[ri]
		let hcell = e.header.at[fi]
		let iw = field_has_indent(field)
			? indent_offset(or(indent, row_indent(row))) : 0

		let [x, y, w, h] = cell_rect(ri, fi)
		w -= iw
		x = or(ex, x + iw)
		y = or(ey, y)

		if (field.align == 'right') {
			e.editor.x1 = null
			e.editor.x2 = cells_w - (x + w)
		} else {
			e.editor.x1 = x
			e.editor.x2 = null
		}

		// set min outer width to col width.
		// width is set in css to 'min-content' to shrink to min inner width.
		e.editor.min_w = w
		e.editor.y = y
		e.editor.h = h

		// set min inner width to cell's unclipped text width.
		if (e.editor.set_text_min_w) {
			cx.measure = true
			let val = e.cell_input_val(row, field)
			e.draw_cell_val(row, field, val, cx)
			cx.measure = false
			e.editor.set_text_min_w(max(20, cx.measured_width))
		}
	}

	let create_editor = e.create_editor
	e.create_editor = function(field, opt) {
		let editor = create_editor.call(e, field, opt)
		if (editor && opt && opt.embedded) {
			editor.class('grid-editor')
			e.cells_ct.add(editor)
		}
		return editor
	}

	e.do_update_cell_editing = function(ri, fi, editing) {
		if (editing)
			update_editor()
		e.focusable = !editing
	}

	e.do_cell_click = function(ri, fi) {
		let cell = e.cells.nodes[cell_index(ri, fi)]
		if (!cell)
			return

		let row = e.rows[ri]
		let field = e.fields[fi]

		// TODO: make clickability a feature of field type.

		if (field.type == 'button') {
			cell.at[0].activate()
			return true
		}

		 if (field.type == 'bool') {
			let val = e.cell_input_val(row, field)
			e.set_cell_val(row, field, !val, {input: e})
			return true
		}
	}

	// responding to rowset changes -------------------------------------------

	let inh_do_update = e.do_update
	e.do_update = function(opt) {

		if (opt.reload) {
			e.reload()
			opt.fields = true
		}

		if (opt.fields)
			create_fields()
		if (opt.fields || opt.sort_order)
			update_sort_icons()
		let opt_rows = opt.rows || opt.fields
		let opt_sizes = opt_rows || opt.sizes
		if (opt_sizes) {
			update_sizes()
			update_cells_canvas()
		}
		let opt_cells = opt_sizes || opt_rows || opt.vals || opt.state || opt.col_resizing
		if (opt_sizes) {
			if (update_scroll())
				opt_cells = true
			if (horiz)
				update_cell_widths_horiz(opt.col_resizing)
			else
				update_cell_widths_vert()
			update_editor()
			update_resize_guides()
		}
		if (opt_cells)
			update_cells_async()
		if (opt_sizes || opt.sort_order)
			update_row_error_tooltip_position()
		if (opt.val)
			inh_do_update()
		if (opt.enter_edit)
			e.enter_edit(...opt.enter_edit)
		if (opt_rows || opt.vals || opt.state || opt.changes)
			e.update_action_band()
		if (opt.scroll_to_focused_cell)
				e.scroll_to_focused_cell()

	}

	e.do_update_load_progress = function(p) {
		let dt = clock() - e.load_request_start_clock
		e.progress_bar.w = (dt > 1 ? lerp(p, 0, 1, 20, 100) : 0) + '%'
	}

	// picker protocol --------------------------------------------------------

	e.pick_val = function() {
		e.fire('val_picked', {input: e})
	}

	e.init_as_picker = function() {
		e.xoff()
		e.can_add_rows = false
		e.can_remove_rows = false
		e.can_change_rows = false
		e.can_focus_cells = false
		e.auto_focus_first_cell = false
		e.enable_context_menu = false
		e.auto_w = true
		e.auto_h = true
		e.xon()
	}

	// vgrid header resizing --------------------------------------------------

	function ht_header_resize(mx, my) {
		if (horiz) return
		let r = e.header.rect()
		let x = mx - r.x2
		if (!(x >= -5 && x <= 5)) return
		hit_x = r.x + x
		return true
	}

	function mm_header_resize(mx, my) {
		update_header_w(mx - hit_x)
	}

	// col resizing -----------------------------------------------------------

	function ht_col_resize_horiz(mx, my) {
		for (let fi = 0; fi < e.fields.length; fi++) {
			let field = e.fields[fi]
			let x = mx - (field._x + field._w)
			if (x >= -5 && x <= 5) {
				hit_fi = fi
				hit_x = x
				return true
			}
		}
	}

	function ht_col_resize_vert(mx, my, max_h) {
		if (my >= max_h)
			return
		if (mx > e.cell_w + 5)
			return // only allow dragging the first row otherwise it's confusing.
		let x = ((mx + 5) % e.cell_w) - 5
		if (!(x >= -5 && x <= 5))
			return
		hit_ri = floor((mx - 6) / e.cell_w)
		hit_dx = e.cell_w * hit_ri - scroll_x
		let r = e.cells_view.rect()
		hit_mx = r.x + hit_dx + x
		return true
	}

	function ht_col_resize(mx, my) {
		if (horiz) {
			let hr = e.header.rect()
			if (!hr.contains(mx, my))
				return
		}
		cr = e.cells_ct.rect()
		mx -= cr.x
		my -= cr.y
		if (horiz)
			return ht_col_resize_horiz(mx, my)
		else
			return ht_col_resize_vert(mx, my, cr.h)
	}

	let mm_col_resize, mu_col_resize

	function md_col_resize(mx, my) {

		if (horiz) {

			mm_col_resize = function(mx, my) {
				let r = e.cells_ct.rect()
				let w = mx - r.x - e.fields[hit_fi]._x - hit_x
				let field = e.fields[hit_fi]
				field.w = clamp(w, field.min_w, field.max_w)
				field._w = field.w
				e.update({sizes: true, col_resizing: true})
			}

		} else {

			mm_col_resize = function(mx, my) {
				e.cell_w = max(20, mx - hit_mx)
				let sx = hit_ri * e.cell_w - hit_dx
				e.cells_view.scrollLeft = sx
				e.update({sizes: true, col_resizing: true})
			}

		}

		e.class('col-resize', true)

		mu_col_resize = function() {
			let field = e.fields[hit_fi]
			mm_col_resize = null
			mu_col_resize = null
			e.class('col-resizing', false)
			remove_resize_guides()
			e.set_prop(`col.${field.name}.w`, field.w)
		}

	}

	// cell clicking ----------------------------------------------------------

	function ht_cell_horiz(mx, my) {
		hit_ri = floor(my / e.cell_h)
		if (!(hit_ri >= 0 && hit_ri <= e.rows.length - 1))
			return
		let row = e.rows[hit_ri]
		for (let fi = 0; fi < e.fields.length; fi++) {
			let field = e.fields[fi]
			let x = mx - field._x
			if (x >= 0 && x <= field._w) {
				hit_fi = fi
				hit_x = x
				hit_indent = false
				if (field_has_indent(field)) {
					let has_children = row.child_rows.length > 0
					if (has_children) {
						let indent_x = indent_offset(row_indent(row))
						hit_indent = hit_x <= indent_x
					}
				}
				return true
			}
		}
	}

	function ht_cell_vert(mx, my) {
		hit_ri = floor(mx / e.cell_w)
		if (!(hit_ri >= 0 && hit_ri <= e.rows.length - 1))
			return
		hit_fi = floor(my / e.cell_h)
		if (!(hit_fi >= 0 && hit_fi <= e.fields.length - 1))
			return
		return true
	}

	function ht_cell(mx, my, ev) {
		if (ev)
			if (!ev.target.closest('.x-grid-cells-canvas'))
				return
		hit_mx = mx
		hit_my = my
		cr = e.cells_ct.rect()
		mx -= cr.x
		my -= cr.y
		if (horiz)
			return ht_cell_horiz(mx, my)
		else
			return ht_cell_vert(mx, my)
	}

	function md_row_drag(ev, mx, my, shift, ctrl) {

		if (!e.hasfocus)
			e.focus()

		let row = e.rows[hit_ri]
		let field = e.fields[hit_fi]

		if (hit_indent)
			e.toggle_collapsed(row, shift)

		let already_on_it =
			hit_ri == e.focused_row_index &&
			hit_fi == e.focused_field_index

		let click =
			!e.enter_edit_on_click
			&& !e.stay_in_edit_mode
			&& !e.editor
			&& e.cell_clickable(row, field)

		return e.focus_cell(hit_ri, hit_fi, 0, 0, {
			must_not_move_col: true,
			must_not_move_row: true,
			enter_edit: !hit_indent
				&& !ctrl && !shift
				&& ((e.enter_edit_on_click || click)
					|| (e.enter_edit_on_click_focused && already_on_it)),
			focus_editor: true,
			focus_non_editable_if_not_found: true,
			editor_state: click ? 'click' : 'select_all',
			expand_selection: shift,
			invert_selection: ctrl,
			input: e,
		})
	}

	// row moving -------------------------------------------------------------

	function ht_row_move(mx, my) {
		if (!e.can_actually_move_rows()) return
		if (e.focused_row_index != hit_ri) return
		if ( horiz && abs(hit_my - my) < 8) return
		if (!horiz && abs(hit_mx - mx) < 8) return
		if (!horiz && e.parent_field) return
		if (e.editor) return
		return true
	}

	let mm_row_move, mu_row_move, update_cells_moving

	function md_row_move(mx, my) {

		// initial state

		let cells_ct_r = e.cells_ct.rect()

		let focused_ri  = e.focused_row_index
		let selected_ri = or(e.selected_row_index, focused_ri)
		let [cx, cy, cw, ch] = cell_rect(min(focused_ri, selected_ri), hit_fi)
		let hit_cell_mx = hit_mx - cells_ct_r.x - cx
		let hit_cell_my = hit_my - cells_ct_r.y - cy

		let s = e.start_move_selected_rows({input: e})
		row_move_state = s
		if (!s)
			return

		let ri1       = s.ri1
		let ri2       = s.ri2
		let move_ri1  = s.move_ri1
		let move_ri2  = s.move_ri2
		let move_n    = s.move_n

		let w = horiz ? e.cell_h : e.cell_w

		// move state

		let hit_x
		let hit_over_ri = move_ri1
		let hit_parent_row = s.parent_row

		let xof       = (ri => ri * w)
		let final_xof = (ri => xof(ri) + (ri < hit_over_ri ? 0 : move_n) * w)

		function advance_row(before_ri) {
			if (!e.parent_field)
				return 1
			if (e.can_change_parent)
				return 1
			if (before_ri < 0) // TODO: why?
				return 1
			if (before_ri == ri2 - 1) // TODO: why?
				return 1
			let hit_row = s.rows[0]
			let over_row = e.rows[before_ri+1]
			if ((over_row && over_row.parent_row) == hit_row.parent_row)
				return 1
			return 1 + e.expanded_child_row_count(before_ri)
		}

		s.indent_x = indent_offset(row_indent(e.rows[move_ri1]))

		function update_hit_parent_row(hit_p) {
			hit_parent_row = e.rows[hit_over_ri] ? e.rows[hit_over_ri].parent_row : null
			if (horiz && e.tree_field && e.can_change_parent) {
				let row1 = e.rows[hit_over_ri-1]
				let row2 = e.rows[hit_over_ri]
				let i1 = row1 ? row_indent(row1) : 0
				let i2 = row2 ? row_indent(row2) : 0
				// if the row can be a child of the row above,
				// the indent right limit is increased one unit.
				let ii1 = i1 + (row1 && !row1.collapsed && e.row_can_have_children(row1) ? 1 : 0)
				let hit_indent = min(floor(lerp(hit_p, 0, 1, ii1 + 1, i2)), ii1)
				let parent_i = i1 - hit_indent
				hit_parent_row = parent_i >= 0 ? row1 && row1.parent_rows[parent_i] : row1
				s.hit_indent_x = indent_offset(hit_indent)
				s.hit_parent_row = hit_parent_row
			}
		}

		{
			let xs = [] // {ci -> x}
			let is = [] // {ci -> ri}

			{
				let x = xof(ri1)
				let ci = 0
				for (let ri = ri1, n; ri < ri2; ri += n) {
					n = advance_row(ri)
					let wn = w * n
					xs[ci] = x + wn / 2
					is[ci] = ri
					ci++
					x += wn
				}
			}

			function hit_test() {
				let ci = xs.binsearch(hit_x)
				let last_hit_over_ri = hit_over_ri
				hit_over_ri = or(is[ci], ri2)
				let x1 = or(xs[ci  ], xof(ri2))
				let x0 = or(xs[ci-1], xof(ri1))
				let hit_p = lerp(hit_x, x0, x1, 0, 1)
				update_hit_parent_row(hit_p)
				return hit_over_ri != last_hit_over_ri
			}

		}

		// animations

		{
			let xs = []; xs.length = e.rows.length // current position
			let zs = []; zs.length = e.rows.length // initial (zero) position
			let ts = []; ts.length = e.rows.length // animation start clock

			for (let ri = 0; ri < xs.length; ri++) {
				zs[ri] = xof(ri + (ri < move_ri1 ? 0 : move_n))
				xs[ri] = zs[ri]
			}

			let ari1 =  1/0
			let ari2 = -1/0

			function move() {
				let last_hit_over_ri = hit_over_ri
				if (hit_test()) {

					// find the range of elements that must make way for the
					// moving elements to be inserted at hit_over_ri.
					let mri1 = min(hit_over_ri, last_hit_over_ri)
					let mri2 = max(hit_over_ri, last_hit_over_ri)

					// extend the animation range with the newfound range.
					ari1 = min(ari1, mri1)
					ari2 = max(ari2, mri2)

					// reset animations for the newfound elements.
					let t = clock()
					for (let ri = ari1; ri < ari2; ri++) {
						zs[ri] = xs[ri]
						ts[ri] = t
					}

				}
			}

			function animate() {

				// update animations and compute the still-active animation range.
				let t = clock()
				let td = .1
				let aari1, aari2
				for (let ri = ari1; ri < ari2; ri++) {
					let t0 = ts[ri]
					let t1 = t0 + td
					let x0 = zs[ri]
					let x1 = final_xof(ri)
					let finished = t - t0 >= td
					if (finished) {
						xs[ri] = x1
					} else {
						let v = lerp(t, t0, t1, 0, 1)
						let ev = 1 - (1 - v)**3
						xs[ri] = lerp(ev, 0, 1, x0, x1)

						aari1 = or(aari1, ri)
						aari2 = ri + 1
					}
				}

				// shrink the animation range to the active range.
				ari1 = max(ari1, or(aari1, ari1))
				ari2 = min(ari2, or(aari2, ari1))

				let vri1x = xof(vri1)

				let view_x = horiz ? scroll_y : scroll_x
				let view_w = horiz ? cells_view_h : cells_view_w

				// update state for the visible range of non-moving elements.
				{
				let vri1 = xs.binsearch(view_x, '<=') - 1
				let vri2 = xs.binsearch(view_x + view_w)
				vri1 = clamp(vri1, 0, e.rows.length-1)
				s.vri1 = vri1
				s.vri2 = vri2
				s.vri1x = vri1x
				s.xs = xs
				}

				// update state for the visible range of moving elements.
				let state_x0 = s.x
				{
				let dx1 = max(0, view_x - hit_x)
				let di1 = floor(dx1 / w)
				let move_vri1x = hit_x + dx1
				let move_vri1 = move_ri1 + di1
				let move_vrn = min(vrn, move_ri2 - move_vri1)
				let move_vri2 = move_ri1 + move_vrn
				s.move_vri1 = move_vri1 - move_ri1
				s.move_vri2 = move_vri2 - move_ri1
				s.vri1x = vri1x
				s.x = move_vri1x
				s.w = w
				}

				return ari2 > ari1 || state_x0 !== s.x
			}

		}

		// mouse, scroll and animation controller

		let af
		update_cells_moving = function() {
			if (animate()) {
				// TODO: use e.begin_update() / e.update() instead of update_cells()
				update_cells()
				af = raf(update_cells_moving)
			} else {
				af = null
			}
		}

		{
			let mx0, my0
			function update_hit_x(mx, my) {
				mx = or(mx, mx0)
				my = or(my, my0)
				mx0 = mx
				my0 = my
				hit_x = horiz
					? my - cells_ct_r.y - hit_cell_my
					: mx - cells_ct_r.x - hit_cell_mx
				hit_x = clamp(hit_x, xof(ri1), xof(ri2))
			}
		}

		function scroll_to_moving_cell() {
			update_hit_x()
			let [cx, cy, cw, ch] = cell_rel_rect(hit_fi)
			let x =  horiz ? (hit_fi != null ? cx : 0) : hit_x
			let y = !horiz ? (hit_fi != null ? cy : 0) : hit_x
			let w = hit_fi != null ? cw : 0
			let h = ch
			e.cells_view.scroll_to_view_rect(null, null, x, y, w, h)
		}

		mm_row_move = function(mx, my) {
			let hit_x0 = hit_x
			update_hit_x(mx, my)
			if (hit_x0 == hit_x)
				return
			move()
			if (af == null)
				af = raf(update_cells_moving)
			scroll_to_moving_cell()
		}

		mu_row_move = function() {
			if (af != null)
				cancel_raf(af)
			clearInterval(scroll_timer)

			mm_row_move = null
			mu_row_move = null
			update_cells_moving = null
			hit_state = null

			e.class('row-moving', false)
			if (e.editor)
				e.editor.class('row-moving', false)

			s.finish(hit_over_ri, hit_parent_row)
			row_move_state = null
		}

		// post-init

		e.class('row-moving')
		if (e.editor)
			e.editor.class('row-moving')

		update_cells_canvas()

		let scroll_timer = runevery(.1, mm_row_move)

		return true
	}

	// column moving ----------------------------------------------------------

	live_move_mixin(e)

	e.movable_element_size = function(fi) {
		return horiz ? cell_w(0, fi) : e.cell_h
	}

	function set_cell_of_col_x(cell, field, x, w) { set_header_cell_xw(cell, field, x, w) }
	function set_cell_of_col_y(cell, field, y) { cell.y = y }
	e.set_movable_element_pos = function(fi, x) {
		e.fields[fi]._x = x
		each_header_cell_of_col(fi, horiz ? set_cell_of_col_x : set_cell_of_col_y, e.fields[fi], x, cell_w(0, fi))
		if (e.focused_field_index == fi)
			update_editor(
				 horiz ? x : null,
				!horiz ? x : null)
	}

	function ht_col(mx, my, ev) {
		let hcell = ev.target.closest('.x-grid-header-cell')
		if (!hcell) return
		hit_fi = hcell.index
		hit_mx = mx
		hit_my = my
		return true
	}

	function ht_col_move(mx, my) {
		if ( horiz && abs(hit_mx - mx) < 8) return
		if (!horiz && abs(hit_my - my) < 8) return
		let r = e.header.rect()
		hit_mx -= r.x
		hit_my -= r.y
		hit_mx -= e.fields[hit_fi]._x
		hit_my -= num(e.header.at[hit_fi].style.top)
		e.class('col-moving')
		each_header_cell_of_col(hit_fi, cell => cell.class('col-moving'))
		if (e.editor && e.focused_field_index == hit_fi)
			e.editor.class('col-moving')
		e.move_element_start(hit_fi, 1, 0, e.fields.length)
		return true
	}

	function mm_col_move(mx, my) {
		let r = e.header.rect()
		mx -= r.x
		my -= r.y
		let x = horiz
			? mx - hit_mx
			: my - hit_my
		e.move_element_update(x)
		e.update({vals: true})
		e.cells_view.scroll_to_view_rect(null, null, horiz ? mx : 0, horiz ? 0 : my, 0, 0)
	}

	function mu_col_move() {
		col_move_fi = null
		let over_fi = e.move_element_stop() // sets x of moved element.
		e.class('col-moving', false)
		each_header_cell_of_col(hit_fi, cell => cell.class('col-moving', false))
		if (e.editor)
			e.editor.class('col-moving', false)
		e.move_field(hit_fi, over_fi)
	}

	// empty placeholder text -------------------------------------------------

	e.empty_rt = richtext({
		classes: 'x-grid-empty-rt',
		align_x: 'center',
		align_y: 'center',
	})
	e.empty_rt.hidden = true
	e.cells_view.add(e.empty_rt)

	let barrier
	e.set_empty_text = function(s) {
		if (barrier) return
		e.empty_rt.content = s
	}

	e.on('bind', function(on) {
		document.on('prop_changed', function(te, k, v) {
			if (te == e.empty_rt && k == 'content') {
				barrier = true
				e.empty_text = v
				barrier = false
			}
		})
	})

	e.prop('empty_text', {store: 'var', slot: 'lang'})

	// widget editing protocol ------------------------------------------------

	let editing_field, editing_sql

	e.hit_test_widget_editing = function(ev, mx, my) {
		if (!hit_state)
			pointermove(ev, mx, my)
		return hit_state == 'col' || hit_state == 'cell' || !hit_state
	}

	e.set_widget_editing = function(on) {
		if (editing_field)
			set_editing_field(on)
		else if (editing_sql)
			set_editing_sql(on)
	}

	e.on('pointerdown', function(ev, mx, my) {
		if (!e.widget_editing)
			return
		if (!hit_state)
			pointermove(ev, mx, my)

		if (!(hit_state == 'col' || hit_state == 'cell' || !hit_state) || !ev.ctrlKey) {
			unselect_all_widgets()
			return false
		}

		// editable_widget mixin's `pointerdown` handler must have ran before
		// this handler and must have called unselect_all_widgets().
		assert(!editing_field)
		assert(!editing_sql)

		if (hit_state == 'col') {

			editing_field = e.fields[hit_fi]
			if (editing_field) {
				set_editing_field(true)
				// for convenience: select-all text if clicking near it but not on it.
				let hcell = e.header.at[editing_field.index]
				let title_div = hcell.title_div
				if (ev.target != title_div && hcell.contains(ev.target)) {
					title_div.focus()
					title_div.select_all()
					return false
				}
			}

		} else {

			editing_sql = true
			set_editing_sql(true)

		}

		// don't prevent default to let the caret land under the mouse.
		ev.stopPropagation()
	})

	function prevent_bubbling(ev) {
		ev.stopPropagation()
	}

	function exit_widget_editing() {
		e.widget_editing = false
	}

	function editing_field_keydown(key, shift, ctrl, alt, ev) {
		if (key == 'Enter') {
			if (ctrl) {
				let hcell = e.header.at[editing_field.index]
				let title_div = hcell.title_div
				title_div.insert_at_caret('<br>')
			} else {
				e.widget_editing = false
			}
			return false
		}
	}

	function set_editing_field(on) {
		let hcell = e.header.at[editing_field.index]
		let title_div = hcell.title_div
		hcell.class('editing', on)
		title_div.contenteditable = on
		title_div.on('blur'        , exit_widget_editing, on)
		title_div.on('raw:pointerdown' , prevent_bubbling, on)
		title_div.on('raw:pointerup'   , prevent_bubbling, on)
		title_div.on('raw:click'       , prevent_bubbling, on)
		title_div.on('raw:contextmenu' , prevent_bubbling, on)
		title_div.on('keydown'         , editing_field_keydown, on)
		if (!on) {
			let s = title_div.textContent
			e.set_prop(`col.${editing_field.name}.text`, s)
			editing_field = null
			if (window.xmodule)
				xmodule.save()
		}
	}

	let sql_editor, sql_editor_ct

	function set_editing_sql(on) {
		e.cells_view.class('editing', on)
		if (on) {
			sql_editor_ct = div({class: 'x-grid-sql-editor'})
			sql_editor = ace.edit(sql_editor_ct, {
				mode: 'ace/mode/mysql',
				highlightActiveLine: false,
				printMargin: false,
				displayIndentGuides: false,
				tabSize: 3,
				enableBasicAutocompletion: true,
			})
			sql_editor_ct.on('blur'            , exit_widget_editing, on)
			sql_editor_ct.on('raw:pointerdown' , prevent_bubbling, on)
			sql_editor_ct.on('raw:pointerup'   , prevent_bubbling, on)
			sql_editor_ct.on('raw:click'       , prevent_bubbling, on)
			sql_editor_ct.on('raw:contextmenu' , prevent_bubbling, on)
			sql_editor.getSession().setValue(e.sql_select || '')
			e.cells_view.add(sql_editor_ct)
		} else {
			e.sql_select = repl(sql_editor.getSession().getValue(), '', undefined)
			sql_editor.destroy()
			sql_editor = null
			sql_editor_ct.remove()
			sql_editor_ct = null
			editing_sql = null
		}
	}

	// mouse bindings ---------------------------------------------------------

	function ht_cell_update() {
		hit_state = 'cell'
		let row = e.rows[hit_ri]
		e.update({state: true})
		update_row_error_tooltip(row)
	}

	function pointermove(ev, mx, my) {
		if (hit_state == 'header_resizing') {
			mm_header_resize(mx, my)
		} else if (hit_state == 'col_resizing') {
			mm_col_resize(mx, my)
		} else if (hit_state == 'col_dragging') {
			if (e.can_reorder_fields && ht_col_move(mx, my)) {
				hit_state = 'col_moving'
				col_move_fi = hit_fi
				mm_col_move(mx, my)
			}
		} else if (hit_state == 'col_moving') {
			mm_col_move(mx, my)
		} else if (hit_state == 'row_dragging') {
			if (ht_row_move(mx, my)) {
				if (md_row_move(mx, my)) {
					hit_state = 'row_moving'
					mm_row_move(mx, my)
				}
			}
		} else if (hit_state == 'row_moving') {
			mm_row_move(mx, my)
		} else {
			hit_state = null
			e.class('col-resize', false)
			if (e.widget_editing) {
				if (ht_col(mx, my, ev)) {
					hit_state = 'col'
				}
			} else if (ht_header_resize(mx, my)) {
				hit_state = 'header_resize'
				e.class('col-resize', true)
			} else if (ht_col_resize(mx, my)) {
				hit_state = 'col_resize'
				md_col_resize(mx, my)
			} else if (ht_col(mx, my, ev)) {
				hit_state = 'col'
			} else if (ht_cell(mx, my, ev)) {
				ht_cell_update()
			} else {
				update_row_error_tooltip(null)
			}
			if (hit_state)
				return false
		}
	}

	function pointerdown(ev, mx, my) {

		if (e.widget_editing)
			return

		if (!hit_state)
			pointermove(ev, mx, my)

		e.focus()

		if (!hit_state) {
			if (ev.target == e.cells_view) // clicked on empty space.
				e.exit_edit()
			return
		}

		if (hit_state == 'header_resize') {
			hit_state = 'header_resizing'
			e.class('col-resizing')
		} else if (hit_state == 'col_resize') {
			hit_state = 'col_resizing'
			e.class('col-resizing')
			create_resize_guides()
		} else if (hit_state == 'col') {
			hit_state = 'col_dragging'
		} else if (hit_state == 'cell') {
			hit_state = 'row_dragging'
			if (!md_row_drag(ev, mx, my, ev.shiftKey, ev.ctrlKey))
				return false
		} else
			assert(false)

		return this.capture_pointer(ev, pointermove, pointerup)
	}

	function rightpointerdown(ev, mx, my) {

		if (e.widget_editing)
			return
		if (!hit_state)
			pointermove(ev, mx, my)
		if (!hit_state)
			return

		e.focus()

		if (hit_state == 'cell')
			e.focus_cell(hit_ri, hit_fi, 0, 0, {
				must_not_move_row: true,
				expand_selection: ev.shiftKey,
				invert_selection: ev.ctrlKey,
				input: e,
			})

		return false
	}

	function pointerup(ev) {
		if (e.widget_editing)
			return
		if (!hit_state)
			return
		if (hit_state == 'header_resizing') {
			e.class('col-resizing', false)
			e.update({sizes: true})
		} else if (hit_state == 'col_resizing') {
			mu_col_resize()
		} else if (hit_state == 'col_dragging') {
			if (e.can_sort_rows)
				e.set_order_by_dir(e.fields[hit_fi], 'toggle', ev.shiftKey)
			else if (e.focus_cell_on_click_header)
				e.focus_cell(true, hit_fi)
		} else if (hit_state == 'col_moving') {
			mu_col_move()
		} else if (hit_state == 'row_moving') {
			mu_row_move()
		} else if (hit_state == 'row_dragging') {
			e.pick_val()
		}
		hit_state = null
		return false
	}

	e.on('pointermove'     , pointermove)
	e.on('pointerdown'     , pointerdown)
	e.on('pointerup'       , pointerup)
	e.on('pointerleave'    , pointerup)
	e.on('rightpointerdown', rightpointerdown)

	e.on('contextmenu', function(ev) {
		context_menu_popup(hit_fi, ev.clientX, ev.clientY)
		return false
	})

	e.on('click', function(ev) {
		if (!(hit_ri != null && hit_fi != null)) return
		e.fire('cell_click', hit_ri, hit_fi, ev)
	})

	e.on('dblclick', function(ev) {
		if (hit_indent)
			return
		let field = e.fields[hit_fi]
		if (field.cell_dblclick) {
			let row = e.rows[hit_ri]
			// TODO
			if (field.cell_dblclick.call(e, cell_val_node(hit_cell), row, field) == false)
				return
		}
		if (!e.fire('cell_dblclick', hit_ri, hit_fi, ev))
			return
		if (e.enter_edit_on_dblclick)
			e.enter_edit('select_all')
	})

	function update_state() { e.update({state: true}) }
	e.on('blur' , update_state)
	e.on('focus', update_state)

	// keyboard bindings ------------------------------------------------------

	e.on('keydown', function(key, shift, ctrl) {

		if (e.widget_editing)
			return

		let left_arrow  =  horiz ? 'ArrowLeft'  : 'ArrowUp'
		let right_arrow =  horiz ? 'ArrowRight' : 'ArrowDown'
		let up_arrow    = !horiz ? 'ArrowLeft'  : 'ArrowUp'
		let down_arrow  = !horiz ? 'ArrowRight' : 'ArrowDown'

		// same-row field navigation.
		if (key == left_arrow || key == right_arrow) {

			let cols = key == left_arrow ? -1 : 1

			let move = !e.editor
				|| (e.auto_jump_cells && !shift && (!horiz || ctrl)
					&& (!horiz
						|| !e.editor.editor_state
						|| ctrl
							&& (e.editor.editor_state(cols < 0 ? 'left' : 'right')
							|| e.editor.editor_state('all_selected'))
						))

			if (move)
				if (e.focus_next_cell(cols, {
					editor_state: horiz
						? (((e.editor && e.editor.editor_state) ? e.editor.editor_state('all_selected') : ctrl)
							? 'select_all'
							: cols > 0 ? 'left' : 'right')
						: 'select_all',
					expand_selection: shift,
					input: e,
				}))
					return false

		}

		// Tab/Shift+Tab cell navigation.
		if (key == 'Tab' && e.tab_navigation) {

			let cols = shift ? -1 : 1

			if (e.focus_next_cell(cols, {
				auto_advance_row: true,
				editor_state: cols > 0 ? 'left' : 'right',
				input: e,
			}))
				return false

		}

		// insert with the arrow down key on the last focusable row.
		if (key == down_arrow && !shift) {
			if (!e.save_on_add_row) { // not really compatible behavior...
				if (e.is_last_row_focused() && e.can_actually_add_rows()) {
					if (e.insert_rows(1, {
						input: e,
						focus_it: true,
					})) {
						return false
					}
				}
			}
		}

		// remove last row with the arrow up key if not edited.
		if (key == up_arrow) {
			if (e.is_last_row_focused() && e.focused_row) {
				let row = e.focused_row
				if (row.is_new && !e.row_is_user_modified(row)) {
					let editing = !!e.editor
					if (e.remove_row(row, {input: e, refocus: true})) {
						if (editing)
							e.enter_edit('select_all')
						return false
					}
				}
			}
		}

		// row navigation.
		let rows
		switch (key) {
			case up_arrow    : rows = -1; break
			case down_arrow  : rows =  1; break
			case 'PageUp'    : rows = -(ctrl ? 1/0 : page_row_count); break
			case 'PageDown'  : rows =  (ctrl ? 1/0 : page_row_count); break
			case 'Home'      : rows = -1/0; break
			case 'End'       : rows =  1/0; break
		}
		if (rows) {

			let move = !e.editor
				|| (e.auto_jump_cells && !shift
					&& (horiz
						|| !e.editor.editor_state
						|| (ctrl
							&& (e.editor.editor_state(rows < 0 ? 'left' : 'right')
							|| e.editor.editor_state('all_selected')))
						))

			if (move)
				if (e.focus_cell(true, true, rows, 0, {
					editor_state: e.editor && e.editor.editor_state
						&& (horiz ? e.editor.editor_state() : 'select_all'),
					expand_selection: shift,
					input: e,
				}))
					return false

		}

		// F2: enter edit mode
		if (!e.editor && key == 'F2') {
			e.enter_edit('select_all')
			return false
		}

		// Enter: toggle edit mode, and navigate on exit
		if (key == 'Enter') {
			if (e.quicksearch_text) {
				e.quicksearch(e.quicksearch_text, e.focused_row, shift ? -1 : 1)
				return false
			} else if (e.hasclass('picker')) {
				e.pick_val()
				return false
			} else if (!e.editor) {
				e.enter_edit('click')
				return false
			} else {
				if (e.advance_on_enter == 'next_row')
					e.focus_cell(true, true, 1, 0, {
						input: e,
						enter_edit: e.stay_in_edit_mode,
						editor_state: 'select_all',
						must_move: true,
					})
				else if (e.advance_on_enter == 'next_cell')
					e.focus_next_cell(shift ? -1 : 1, {
						input: e,
						enter_edit: e.stay_in_edit_mode,
						editor_state: 'select_all',
						must_move: true,
					})
				else if (e.exit_edit_on_enter)
					e.exit_edit()
				return false
			}
		}

		// Esc: exit edit mode.
		if (key == 'Escape') {
			if (e.quicksearch_text) {
				e.quicksearch('')
				return false
			}
			if (e.editor) {
				if (e.exit_edit_on_escape) {
					e.exit_edit()
					e.focus()
					return false
				}
			} else if (e.focused_row && e.focused_field) {
				let row = e.focused_row
				if (row.is_new && !e.row_is_user_modified(row, true))
					e.remove_row(row, {input: e, refocus: true})
				else
					e.revert_cell(row, e.focused_field)
				return false
			}
		}

		// insert key: insert row
		if (key == 'Insert') {
			let insert_arg = 1 // add one row

			if (ctrl && e.focused_row) { // add a row filled with focused row's values
				let row = e.serialize_row_vals(e.focused_row)
				e.pk_fields.map((f) => delete row[f.name])
				insert_arg = [row]
			}

			if (e.insert_rows(insert_arg, {
				input: e,
				at_focused_row: true,
				focus_it: true,
			})) {
				return false
			}
		}

		if (key == 'Delete') {

			if (e.editor && e.editor.input_val == null)
				e.exit_edit({cancel: true})

			// delete: toggle-delete selected rows
			if (!ctrl && !e.editor && e.remove_selected_rows({
						input: e, refocus: true, toggle: true, confirm: true
					}))
				return false

			// ctrl_delete: set selected cells to null.
			if (ctrl) {
				if (e.can_change_val(row, field))
					e.set_null_selected_cells({input: e})
				return false
			}

		}

		if (!e.editor && key == ' ' && !e.quicksearch_text) {
			if (e.focused_row && (!e.can_focus_cells || e.focused_field == e.tree_field))
				e.toggle_collapsed(e.focused_row, shift)
			else if (e.focused_row && e.focused_field && e.cell_clickable(e.focused_row, e.focused_field))
				e.enter_edit('click')
			return false
		}

		if (!e.editor && ctrl && key == 'a') {
			e.select_all_cells()
			return false
		}

		if (!e.editor && key == 'Backspace') {
			if (e.quicksearch_text)
				e.quicksearch(e.quicksearch_text.slice(0, -1), e.focused_row)
			return false
		}

		if (ctrl && key == 's') {
			e.save()
			return false
		}

		if (ctrl && !e.editor)
			if (key == 'c') {
				let row = e.focused_row
				let fld = e.focused_field
				if (row && fld)
					copy_to_clipboard(e.cell_text_val(row, fld))
				return false
			} else if (key == 'x') {

				return false
			} else if (key == 'v') {

				return false
			}

	})

	// printable characters: enter quick edit mode.
	e.on('keypress', function(c) {

		if (e.widget_editing)
			return

		if (e.quick_edit) {
			if (!e.editor && e.focused_row && e.focused_field) {
				e.enter_edit('select_all')
				let v = e.focused_field.from_text(c)
				e.set_cell_val(e.focused_row, e.focused_field, v)
				return false
			}
		} else if (!e.editor) {
			e.quicksearch(e.quicksearch_text + c, e.focused_row)
			return false
		}
	})

	// column context menu ----------------------------------------------------

	function context_menu_popup(fi, mx, my) {

		if (!e.enable_context_menu)
			return

		if (e.disabled)
			return

		if (e.context_menu) {
			e.context_menu.close()
			e.context_menu = null
		}

		let items = []

		items.push({
			text: e.changed_rows ?
				S('discard_changes_and_reload', 'Discard changes and reload') : S('reload', 'Reload'),
			disabled: e.changed_rows || !e.rowset_url,
			icon: 'fa fa-sync',
			action: function() {
				e.reload()
			},
		})

		items.push({
			text: S('save', 'Save'),
			icon: 'fa fa-save',
			disabled: !e.changed_rows,
			action: function() {
				e.exit_edit()
				e.save({notify_errors: true})
			},
		})

		items.push({
			text: S('revert_changes', 'Revert changes'),
			icon: 'fa fa-undo',
			disabled: !e.changed_rows,
			action: function() {
				e.revert()
			},
			separator: true,
		})

		items.push({
			text: S('download_as_xlsx_file', 'Download as Excel file'),
			icon: 'fa-solid fa-file-excel',
			action: function() {
				e.download_xlsx()
			},
			separator: true,
		})

		items.push({
			text: S('remove_selected_rows', 'Remove selected rows'),
			icon: 'fa fa-trash',
			disabled: !(e.selected_rows.size && e.can_remove_row()),
			action: function() {
				e.remove_selected_rows({input: e, refocus: true, confirm: true})
			},
		})

		items.push({
			text: S('set_null_selected_cells', 'Set selected cells to null'),
			icon: 'fa fa-eraser',
			disabled: !(e.selected_rows.size && e.can_change_val()),
			action: function() {
				e.set_null_selected_cells()
			},
			separator: true,
		})

		if (horiz && e.can_change_filters_visibility)
			items.push({
				text: S('show_filters', 'Show filters'),
				checked: e.filters_visible,
				action: function(item) {
					e.filters_visible = item.checked
				},
			})

		items.push({
			text: S('vertical_grid', 'Show as vertical grid'),
			checked: e.vertical,
			action: function(item) {
				e.vertical = item.checked
			},
		})

		items.push({
			text: S('auto_stretch_columns', 'Auto-stretch columns'),
			checked: e.auto_cols_w,
			action: function(item) {
				e.auto_cols_w = item.checked
			},
		})


		if (e.can_change_header_visibility)
			items.push({
				text: S('show_header', 'Show header'),
				checked: e.header_visible,
				action: function(item) {
					e.header_visible = item.checked
				},
			})

		if (e.can_change_fields_visibility) {

			if (fi != null) {
				function hide_field(item) {
					e.show_field(item.field, false)
				}
				let field = e.fields[fi]
				let hide_text = span({}, S('hide_field', 'Hide field'), ' "', field.text, '"')
				items.push({
					field: field,
					text: hide_text,
					action: hide_field,
				})
			}

			let field_items = []
			function show_field(item) {
				e.show_field(item.field, item.checked, fi)
				return false
			}
			for (let field of e.all_fields) {
				if (!field.internal)
					field_items.push({
						field: field,
						text: field.text,
						action: show_field,
						checked: e.field_index(field) != null,
					})
			}

			items.push({
				text: S('show_fields', 'Show fields'),
				items: field_items,
				disabled: !field_items.length,
			})

		}

		if (e.parent_field) {

			items.last.separator = true

			items.push({
				text: S('expand_all', 'Expand all'),
				disabled: !(horiz && e.tree_field),
				action: function() { e.set_collapsed(null, false, true) },
			})
			items.push({
				text: S('collapse_all', 'Collapse all'),
				disabled: !(horiz && e.tree_field),
				action: function() { e.set_collapsed(null, true, true) },
			})
		}

		e.fire('init_context_menu_items', items)

		e.context_menu = menu({
			items: items,
			id: e.id ? e.id + '.context_menu' : null,
			grid: e,
		})
		let r = e.rect()
		let px = mx - r.x
		let py = my - r.y
		e.context_menu.popup(e, 'inner-top', null, null, null, null, null, px, py)
	}

})

// ---------------------------------------------------------------------------
// grid dropdown
// ---------------------------------------------------------------------------

component('x-grid-dropdown', function(e) {

	nav_dropdown_widget(e)

	e.create_picker = function(opt) {
		return component.create(assign_opt(opt, {
			type: 'grid',
			id: e.id && e.id + '.dropdown',
			val_col: e.val_col,
			display_col: e.display_col,
			rowset: e.rowset,
			rowset_name: e.rowset_name,
		}, e.grid))
	}

})

// ---------------------------------------------------------------------------
// row form
// ---------------------------------------------------------------------------

component('x-row-form', function(e) {

	grid.props.vertical = {default: true}

	grid.construct(e, false)

	function bind_nav(nav, on) {
		if (!e.bound)
			return
		if (!nav)
			return
		nav.on('reset'                          , reset, on)
		nav.on('focused_row_changed'            , row_changed, on)
		nav.on('display_vals_changed'           , display_vals_changed, on)
		nav.on('focused_row_cell_state_changed' , focused_row_cell_state_changed, on)
		nav.on('col_attr_changed'               , col_attr_changed, on)
	}

	e.on('bind', function(on) {
		bind_nav(e.nav, on)
		document.on('layout_changed', redraw, on)
	})

	e.set_nav = function(nav1, nav0) {
		assert(nav1 != e)
		bind_nav(nav0, false)
		bind_nav(nav1, true)
		reset()
	}

	e.prop('nav', {store: 'var', private: true})
	e.prop('nav_id' , {store: 'var', bind_id: 'nav', type: 'nav'})

	function reset() {
		e.rowset.fields = e.nav.all_fields
		e.rowset.rows = [e.nav.focused_row]
		e.reset()
		e.row = e.all_rows[0]
	}

	function row_changed(nav_row) {
		e.all_rows = [nav_row]
		e.row = e.all_rows[0]
		//for (let i = 0; i < e.all_fields.length; i++)

	}

	function display_vals_changed() {
		e.update({vals: true})
	}

	function focused_row_cell_state_changed(row, nav_field, changes) {
		if (e.updating)
			return
		let field = e.all_fields[nav_field.val_index]
		if (changes.val)
			e.reset_cell_val(row, field, changes.val[0])
		else if (changes.input_val)
			e.set_cell_val(row, field, changes.input_val[0])
	}

	function col_attr_changed(col, attr, val) {
		if (attr == 'text')
			e.set_prop('col.'+col+'.'+attr, val)
	}

	e.on('cell_state_changed', function(row, field, changes) {
		if (changes.input_val) {
			let nav_row = e.nav.all_rows[e.row_index(row)]
			let nav_field = e.nav.all_fields[e.field_index(field)]
			e.nav.set_cell_val(nav_row, nav_field, changes.input_val[0])
		}
	})


})


// ---------------------------------------------------------------------------
// grid profile
// ---------------------------------------------------------------------------

component('x-grid-profile', function(e) {

	tabs_item_widget(e)

})
