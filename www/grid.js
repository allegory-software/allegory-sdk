/*

	Model-driven tree-grid widget.
	Written by Cosmin Apreutesei. Public Domain.

WIDGETS

	grid
	grid_dropdown
	row-frm

*/

(function () {
"use strict"
let G = window

/* ---------------------------------------------------------------------------
// grid widget
// ---------------------------------------------------------------------------
uses:
	...
implements:
	nav widget protocol.
--------------------------------------------------------------------------- */

// NOTE: Firefox won't set a line height lower than the font allows on <input>!
css(':root', '', `
	--grid-cell-h           : '';
	--grid-header-h         : '';
	--bg-grid-moving        : var(--bg-smoke);
`)

css_light('', '', `
	--bg-grid-editor        : var(--bg1);
`)

css_dark('', '', `
	--bg-grid-editor        : #495560;
`)

css('.grid', 'S v clip arrow lh-input')

css_state('.grid:focus', 'no-outline')

css('.vgrid', 'h')
css('.vgrid > .grid-header', 'b-r b-b-0')
css('.vgrid .grid-action-band', 'v')
css('.vgrid .grid-cells-view', 'S', 'width: 0;') // CSS people are hopeless

// grid header

// rel makes header cols movable for scrolling horizontally
css('.grid-header', 'rel b b0')

css('.grid:not(.vgrid) > .grid-header', 'b-b')

css('.grid-header-canvas', 'abs')

/* grid cells: grid > view > ct > (cells, editor) > cell */

css('.grid-cells-view', 'S shrinks rel g-h scroll-auto')

// avoid col resizing based on row count
css('.grid[auto_cols_w] > .grid-cells-view', 'vscroll')

// grid grows to fit contents, so no need for scrollbars
css('.grid[auto_h] > .grid-cells-view', 'clip-y')

// clip: hide surplus bottom rows
// rel: activates `overflow: hidden` on abs. pos. child.
css('.grid-cells', 'rel clip', `
	grid-row-start: 1;
	grid-column-start: 1;
`)

css('.grid-cells-canvas', 'abs') // keep at y=0 while scrolling

// grid editing

css('.grid-error', 'abs')

// load/save progress bar

css('.grid-progress-bar', 'abs click-through', `
	top: -2px;
	width: 0%;
	height: 2px;
`)

css_state('.grid.loading > .grid-progress-bar', '', 'background-color: green;')

// grid action band

css('.grid-action-band', 'b-t bg')
css('.grid-action-band-reload-button', 'small label')
css('.grid-action-band-reload-button > .btn-icon', 'p-t-05')
css('.grid-action-band-info', 'h-m m-l small label pre')

// grid col moving

css_state('.grid.col-move'  , 'grab')
css_state('.grid.col-moving', 'grabbing')

// grid col resizing

// NOTE: `col-resize` cursor is almost invisible on a light background on Windows.
css_state('.grid:is(.col-resize, .header-resize)', '', 'cursor: ew-resize;')

css_state('.grid-resize-guides', 'abs', 'top: 0;')

// grid editor role

css_role('.grid-editor', 'abs', `
	width: min-content;
`)

css_role('.grid-editor > .focus-box', 'b0 ro0', `
	/* add border width, since we removed the border */
	padding-top: calc(var(--p-y-input) + 1px);
	background-color: var(--bg-grid-editor);
`)

css_role('.grid-editor > .focus-box > .editbox-input', '', `
	line-height: var(--grid-cell-line-height);
`)

css_role(`
	.grid-editor > .focus-box,
	.grid-editor.open:not(.widget-selected) > .focus-box),
	.grid-editor:focus-within:not(.widget-selected) > .focus-box
`, 'no-outline', `
	box-shadow: inset 2px 2px 6px -2px rgba(0,0,0,0.75);
`)

/* grid as picker */

css_role('.grid.picker', '', `
	min-height: 40px;
	max-height: 300px;
	max-width: 800px;
	resize: both;
`)

/* show vert-scrollbars always when grid is a picker */
css_role('.grid.picker > .grid-cells-view', 'vscroll')

/* TODO: grid filter dropdowns

.grid-filter-dropdown {
	font-size: 85%;
	bottom: 0;
	left: 0;

	position: absolute;
	min-width: 0;
	border: 0;
	margin: 0;
	border-radius: 0;

	color: #36f;
`)

.dropdown.grid-filter-dropdown.open {
	box-shadow: none;
`)

.grid-filter-dropdown-grid {
	font-size: 90%;
`)

*/

/* grid widget editing */

/* many edit modes, each marked in its own ways */
css_role('.grid.widget-editing', 'no-outline')

css_role('.grid-cells-view.editing > .grid-cells', 'hidden')

G.grid = component('grid', 'Input', function(e) {

	e.class('grid')
	// val_widget(e, true)
	nav_widget(e)
	e.make_focusable()
	e.ctrl_key_taken = true

	function theme_changed() {

		let css = e.css()

		// css geometry
		e.text_font_family = css['font-family']
		e.icon_font_family = 'fontawesome'
		e.font_size   = num(css['font-size'])
		e.line_height = round(num(css['line-height']))
		e.padding_x = round(num(css.prop('--p-x-input')) * e.font_size)
		e.padding_y = round(num(css.prop('--p-y-input')) * e.font_size)
		e.cell_h    = num(css.prop('--grid-cell-h'))
		e.header_h  = num(css.prop('--grid-header-h'))

		// css colors
		e.cell_border_v_width    = 1
		e.cell_border_h_width    = 1
		e.hcell_border_v_color   = css.prop('--border-dark')
		e.hcell_border_h_color   = css.prop('--border-light')
		e.cell_border_v_color    = null // css.prop('--border-light')
		e.cell_border_h_color    = css.prop('--border-light')
		e.bg                     = css.prop('--bg')
		e.bg_alt                 = css.prop('--bg-alt')
		e.fg                     = css.prop('--fg')
		e.fg_header              = css.prop('--fg-label')
		e.bg_header              = e.bg
		e.fg_dim                 = css.prop('--fg-dim')
		e.fg_search              = css.prop('--fg-search')
		e.bg_search              = css.prop('--bg-search')
		e.bg_error               = css.prop('--bg-error')
		e.bg_unfocused           = css.prop('--bg-unfocused')
		e.bg_focused             = css.prop('--bg-focused')
		e.bg_unfocused_selected  = css.prop('--bg-unfocused-selected')
		e.fg_unfocused_selected  = css.prop('--fg-unfocused-selected')
		e.bg_focused_selected    = css.prop('--bg-focused-selected')
		e.bg_focused_invalid     = css.prop('--bg-focused-invalid')
		e.bg_unselected          = css.prop('--bg-unselected')
		e.bg_selected            = css.prop('--bg-selected')
		e.fg_selected            = css.prop('--fg-selected')
		e.row_bg_focused         = css.prop('--bg-row-focused')
		e.bg_new                 = css.prop('--bg-new')
		e.bg_modified            = css.prop('--bg-modified')
		e.bg_new_modified        = css.prop('--bg-new-modified')
		e.bg_moving              = css.prop('--bg-grid-moving')

		e.text_font = e.font_size + 'px ' + e.text_font_family
		e.icon_font = e.font_size + 'px ' + e.icon_font_family
		e.header_icon_font = (e.font_size * 0.875) + 'px ' + e.icon_font_family
		e.header_text_font = (e.font_size * 0.875) + 'px ' + e.text_font_family
		e.cell_h   = or(e.cell_h  , round(e.line_height + 2 * e.padding_y + e.cell_border_h_width))
		e.header_h = or(e.header_h, round(e.line_height + 2 * e.padding_y + e.cell_border_h_width))

		update_cx(cx)
		update_cx(hcx)

		update_sizes()
	}

	e.prop('header_w', {type: 'number', default: 120, attr: true}) // vert-grid only
	e.prop('cell_w', {type: 'number', default: 120, attr: true, slot: 'user'}) // vert-grid only
	e.prop('auto_cols_w', {type: 'bool', default: false, attr: true}) // horiz-grid only
	e.prop('auto_expand', {type: 'bool', default: false, attr: true})

	e.set_header_w = function() {
		update_sizes()
	}

	e.set_cell_w = function(v) {
		update_sizes()
	}

	e.set_auto_cols_w = function() {
		update_sizes()
	}

	e.set_auto_expand = function() {
		update_sizes()
	}

	// keyboard behavior
	e.auto_jump_cells = true    // jump to next/prev cell on caret limits with Ctrl.
	e.tab_navigation = false    // disabled as it prevents jumping out of the grid.
	e.advance_on_enter = 'next_row' // false|'next_row'|'next_cell'
	e.prop('exit_edit_on_escape'           , {type: 'bool', default: true})
	e.prop('exit_edit_on_enter'            , {type: 'bool', default: true})
	e.quick_edit = false        // quick edit (vs. quick-search) when pressing a key

	// mouse behavior
	e.prop('can_reorder_fields'            , {type: 'bool', default: true})
	e.prop('enter_edit_on_click'           , {type: 'bool', default: false})
	e.prop('enter_edit_on_click_focused'   , {type: 'bool', default: false})
	e.prop('enter_edit_on_dblclick'        , {type: 'bool', default: true})
	e.prop('focus_cell_on_click_header'    , {type: 'bool', default: false})
	e.prop('can_change_parent'             , {type: 'bool', default: true})

	// context menu features
	e.prop('enable_context_menu'           , {type: 'bool', default: true})
	e.prop('can_change_header_visibility'  , {type: 'bool', default: true})
	e.prop('can_change_filters_visibility' , {type: 'bool', default: true})
	e.prop('can_change_fields_visibility'  , {type: 'bool', default: true})

	let horiz = true
	e.set_vertical = function(v) {
		horiz = !v
		e.class('hgrid',  horiz)
		e.class('vgrid', !horiz)
		e.must_be_flat = !horiz
		theme_changed()
	}
	e.prop('vertical', {type: 'bool', attr: true, slot: 'user', default: false})

	e.header_canvas = tag('canvas', {class : 'grid-header-canvas', width: 0, height: 0})
	e.header        = div({class: 'grid-header'}, e.header_canvas)
	e.cells_canvas  = tag('canvas', {class : 'grid-cells-canvas', width: 0, height: 0})
	e.cells         = div({class: 'grid-cells'}, e.cells_canvas)
	e.cells_view    = div({class: 'grid-cells-view'}, e.cells)
	e.progress_bar  = div({class: 'grid-progress-bar'})
	e.add(e.header, e.progress_bar, e.cells_view)

	let cx  = e.cells_canvas.getContext('2d')
	let hcx = e.header_canvas.getContext('2d')

	e.listen('layout_changed', layout_changed)

	e.on_bind(function(on) {
		if (on)
			theme_changed()
	})

	// view-size-derived state ------------------------------------------------

	let cells_w, cells_h // cell grid dimensions.
	let grid_w, grid_h // grid dimensions.
	let cells_view_w, cells_view_h // cell viewport dimensions inside scrollbars.
	let cells_view_overflow_x, cells_view_overflow_y // cells viewport overflow setting.
	let header_w, header_h // header viewport dimensions.
	let hcell_h // header cell height.
	let vrn // how many rows are fully or partially in the viewport.
	let page_row_count // how many rows in a page for pgup/pgdown navigation.

	// NOTE: keep this raf-friendly, i.e. don't measure the DOM in here!
	function update_internal_sizes() {

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
				cells_view_h = grid_h - header_h // before hscrollbar.
			}

			header_w = cells_view_w // before vscrollbar

			;[cells_view_w, cells_view_h] =
				scrollbox_client_dimensions(
					min_cells_w,
					cells_h,
					cells_view_w,
					cells_view_h,
					cells_view_overflow_x,
					cells_view_overflow_y
				)

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
				if (field == e.fields.last) {
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

		update_scroll(scroll_x, scroll_y)
	}

	function update_sizes() {
		if (!e.bound) {
			grid_w = null
			grid_h = null
			scroll_x = null
			scroll_y = null
		} else {
			if (e.auto_expand) {
				grid_w = 0
				grid_h = 0
				scroll_x = 0
				scroll_y = 0
			} else {
				grid_w = e.cw
				grid_h = e.ch
				scroll_x = e.cells_view.scrollLeft
				scroll_y = e.cells_view.scrollTop
			}
			e.update({fields: true})
		}
	}

	// view-scroll-derived state ----------------------------------------------

	let scroll_x, scroll_y // current scroll offsets.
	let vri1, vri2 // visible row range.

	// NOTE: keep this raf-friendly, i.e. don't measure the DOM in here!
	function update_scroll(sx, sy) {
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
		return clip_rect(x+bx, y+by, scroll_x, scroll_y, cells_view_w, cells_view_h)
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

	function create_filter(field) {
		if (!(horiz && e.filters_visible && field.filter_by))
			return
		let rs = e.filter_rowset(field)
		let dd = grid_dropdown({
			lookup_rowset : e.rowset,
			lookup_cols   : 1,
			classes       : 'grid-filter-dropdown',
			mode          : 'fixed',
			grid: {
				cell_h: 22,
				classes: 'grid-filter-dropdown-grid',
			},
		})

		let f0 = rs.all_fields[0]
		let f1 = rs.all_fields[1]

		dd.display_val = function() {
			if (!rs.filtered_count)
				return () => div({class: 'item disabled'}, S('all', 'all'))
			else
				return () => span({}, div({class: 'grid-filter fa fa-filter'}), rs.filtered_count+'')
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

		field.filter_dropdown = dd
		e.add(dd)
	}

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

		let cx = hcx

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
		hcx.save()
		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width
		hcx.translate(horiz ? -scroll_x + bx : 0, horiz ? 0 : -scroll_y + by)
		let skip_moving_col = hit_state == 'col_moving' && draw_stage == 'non_moving_cols'
		for (let fi = fi1; fi < fi2; fi++) {
			if (skip_moving_col && hit_fi == fi)
				continue
			let field = e.fields[fi]
			let [x, y, w, h] = hcell_rect(fi)
			draw_hcell_at(field, fi, x, y, w, h, draw_stage)
		}
		hcx.restore()
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
		let cell_errors = e.cell_errors(row, field)
		let cell_invalid = !!(cell_errors && !cell_errors.passed)
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
		} else if (is_new)
			if (modified)
				bg = e.bg_new_modified
			else
				bg = e.bg_new
		else if (modified)
			bg = e.bg_modified
		else if (row_focused)
			bg = e.row_bg_focused

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
		cx.lineWidth = bx || by
		cx.strokeStyle = e.cell_border_color
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
			e.draw_cell_val(row, field, input_val, cx)

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
		cx.strokeStyle = e.bg_error
		cx.beginPath()
		cx.rect(x + .5, y + .5, w - 1, h)
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
			let invalid = row.errors && !row.errors.passed
			if (invalid) {
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

	// NOTE: keep this raf-friendly, i.e. don't measure the DOM in here!
	function update_view() {

		// dom changes

		e.cells.w = max(1, cells_w) // need at least 1px to show scrollbar.
		e.cells.h = max(1, cells_h) // need at least 1px to show scrollbar.

		e.cells_view.w = e.auto_expand ? cells_view_w : null
		e.cells_view.h = e.auto_expand ? cells_view_h : null

		e.cells_view.style['overflow-x'] = cells_view_overflow_x
		e.cells_view.style['overflow-y'] = cells_view_overflow_y

		e.cells_canvas.x = scroll_x
		e.cells_canvas.y = scroll_y

		e.header.w = horiz ? null : header_w
		e.header.h = header_h

		e.cells_canvas .resize(cells_view_w, cells_view_h, 200, 200)
		e.header_canvas.resize(header_w, header_h, 200, horiz ? 1 : 200)

		for (let field of e.fields)
			if (field.filter_dropdown)
				field.filter_dropdown.w = field._w

		// canvas drawing

		e.ctx = cx

		// WTF is going on with Safari??
		if (Safari) {
			let ch = e.cells_canvas.height
			e.cells_canvas.height = 0
			e.cells_canvas.height = ch
			let hh = e.header_canvas.height
			e.header_canvas.height = 0
			e.header_canvas.height = hh
		}

		cx .resetTransform()
		hcx.resetTransform()

		cx .clear()
		hcx.clear()

		cx .scale(devicePixelRatio, devicePixelRatio)
		hcx.scale(devicePixelRatio, devicePixelRatio)


		if (hit_state == 'row_moving') { // draw fixed rows first and moving rows above them.
			let s = row_move_state
			draw_cells_range(e.rows, s.vri1,      s.vri2     , 0, e.fields.length, 'non_moving_rows')
			draw_cells_range(s.rows, s.move_vri1, s.move_vri2, 0, e.fields.length, 'moving_rows')
			draw_hcells_range(0, e.fields.length)
			return
		}

		if (hit_state == 'col_moving') { // draw fixed cols first and moving cols above them.
			draw_cells_range (e.rows, vri1, vri2, 0     , e.fields.length, 'non_moving_cols')
			draw_cells_range (e.rows, vri1, vri2, hit_fi, hit_fi + 1     , 'moving_cols')
			draw_hcells_range(0     , e.fields.length, 'non_moving_cols')
			draw_hcells_range(hit_fi, hit_fi + 1     , 'moving_cols')
			return
		}

		draw_cells_range(e.rows, vri1, vri2, 0, e.fields.length)
		draw_hcells_range(0, e.fields.length)
	}

	e.header.on('wheel', function(ev) {
		if (horiz)
			return
		// TODO: this is not smooth scrolling!
		e.cells_view.scrollBy(0, ev.deltaY)
	}, true, {passive: true})

	function cells_view_scroll() {
		if (hit_state == 'row_moving')
			return // because it interferes with the animation.
		scroll_x = e.cells_view.scrollLeft
		scroll_y = e.cells_view.scrollTop
		e.update({rows: true})
	}

	e.cells_view.on('scroll', cells_view_scroll)

	// error tooltip ----------------------------------------------------------

	let update_error_tooltip
	let update_error_tooltip_position
	{
		let row, field

		e.do_error_tooltip_check = function() {
			if (!row) return false
			if (e.editor && e.editor.do_error_tooltip_check()) return false
			if (e.has_focus) return true
			return false
		}

		update_error_tooltip_position = function() {
			if (!e.error_tooltip) return
			if (!row) return
			let r = field
				? domrect(...cell_visible_rect(row, field))
				: domrect(...row_visible_rect(row))
			e.error_tooltip.target_rect = r
			e.error_tooltip.side = horiz ? 'top' : 'right'
		}

		update_error_tooltip = function() {
			row = null
			field = null
			if (hit_state == 'cell') {
				row = e.rows[hit_ri]
				field = e.fields[hit_fi]
			} else if (!hit_state) {
				row = e.focused_row
				field = e.focused_field
			}
			if (!e.error_tooltip) {
				if (!row)
					return
				e.error_tooltip = tooltip({
					kind: 'error',
					target: e.cells,
					check: e.do_error_tooltip_check,
					style: 'pointer-events: none',
				})
			}
			let errors
			if (row && field) {
				errors = e.cell_errors(row, field)
				if (!(errors && errors.passed == false)) {
					errors = null
					field = null
				}
			}
			if (!errors && row) {
				errors = e.row_errors(row)
				if (!(errors && errors.passed == false)) {
					errors = null
					row = null
					field = null
				}
			}
			if (errors) {
				e.error_tooltip.text = errors
					.filter(e => !e.passed)
					.map(e => e.message)
					.ul({class: 'error-list'}, true)
				update_error_tooltip_position()
			} else {
				e.error_tooltip.update()
			}
		}

		e.do_focus_cell = function(row, field) {
			update_error_tooltip()
		}

	}

	// header_visible & filters_visible live properties -----------------------

	e.prop('header_visible', {type: 'bool', default: true, attr: true, slot: 'user'})

	e.set_header_visible = function(v) {
		v = !!v
		e.header.hidden = !v
		update_sizes()
	}

	e.prop('filters_visible', {type: 'bool', default: false, attr: true})

	e.set_filters_visible = function(v) {
		e.header.class('with-filters', filters_visible)
		update_sizes()
	}

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
		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width

		let [x, y, w, h] = cell_rect(ri, fi)
		w -= iw
		x = or(ex, x + iw)
		y = or(ey, y)

		if (field.align == 'right') {
			e.editor.x1 = null
			e.editor.x2 = cells_w - (x + w) + bx
		} else {
			e.editor.x1 = x + bx
			e.editor.x2 = null
		}

		// set min outer width to col width.
		// width is set in css to 'min-content' to shrink to min inner width.
		e.editor.min_w = w
		e.editor.y = y + by
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
			e.cells.add(editor)
		}
		return editor
	}

	e.do_update_cell_editing = function(ri, fi, editing) {
		if (editing)
			update_editor()
		e.focusable = !editing
	}

	e.do_cell_click = function(ri, fi) {
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

	// responding to layout changes -------------------------------------------

	let w0, h0
	function layout_changed(what) {
		if (what) {
			theme_changed()
			return
		}
		let r = e.rect()
		let w1 = r.w
		let h1 = r.h
		if (w1 == 0 && h1 == 0)
			return // hidden
		if (h1 !== h0 || w1 !== w0)
			update_sizes()
		w0 = w1
		h0 = h1
	}
	e.on('resize', layout_changed)

	// responding to rowset changes -------------------------------------------

	e.on_update(function(opt) {
		if (opt.fields || opt.rows) {
			update_internal_sizes()
			update_error_tooltip_position()
		}
		if (opt.errors)
			update_error_tooltip()
		update_view()
		e.empty_rt.hidden = e.rows.length > 0
		if (opt.enter_edit)
			e.enter_edit(...opt.enter_edit)
		if (opt.state)
			e.update_action_band()
		if (opt.scroll_to_focused_cell)
			e.scroll_to_focused_cell()
	})

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

	let hit_x

	function ht_header_resize(ev, mx, my) {
		if (!hit_state && !horiz) {
			let r = e.header.rect()
			let x = mx - r.x2
			if (x >= -5 && x <= 5) {
				hit_x = r.x + x
				hit_state = 'header_resize'
			}
		}
		e.class('header-resize', hit_state == 'header_resize')
	}

	function mm_header_resize(ev, mx, my) {
		e.header_w = mx - hit_x
	}

	function mu_header_resize(ev, mx, my) {
		e.class('header-resizing', false)
		update_sizes()
		hit_state = null
		e.xsave()
		return false
	}

	function md_header_resize(ev, mx, my) {
		hit_state = 'header_resizing'
		e.class('header-resizing')
		return e.capture_pointer(ev, mm_header_resize, mu_header_resize)
	}

	// col resizing -----------------------------------------------------------

	let cells_point
	{
	let p = [0, 0]
	cells_point = function(mx, my) {
		let r = e.cells.rect()
		let bx = e.cell_border_v_width
		let by = e.cell_border_h_width
		mx -= r.x + bx
		my -= r.y + by
		p[0] = mx
		p[1] = my
		return p
	}
	}

	function ht_col_resize_test(mx, my) {
		if (horiz) {
			if (hit_target != e.header_canvas)
				return
			;[mx, my] = cells_point(mx, my)
			for (let fi = 0; fi < e.fields.length; fi++) {
				let [x, y, w, h] = hcell_rect(fi)
				hit_dx = mx - (x + w)
				if (hit_dx >= -5 && hit_dx <= 5) {
					hit_fi = fi
					return true
				}
			}
		} else {
			;[mx, my] = cells_point(mx, my)
			if (mx > e.cell_w + 5)
				return // only allow dragging the first row otherwise it's confusing.
			let x = ((mx + 5) % e.cell_w) - 5
			if (!(x >= -5 && x <= 5))
				return
			hit_ri = floor((mx - 6) / e.cell_w)
			let vr = e.cells_view.rect()
			hit_dx = vr.x + e.cell_w * hit_ri - scroll_x + x
			return true
		}
	}
	function ht_col_resize(ev, mx, my) {
		if (!hit_state)
			if (ht_col_resize_test(mx, my))
				hit_state = 'col_resize'
		e.class('col-resize', hit_state == 'col_resize')
	}

	function md_col_resize(ev, mx, my) {

		hit_state = 'col_resizing'
		e.class('col-resizing')

		let mm_col_resize

		if (horiz) {

			mm_col_resize = function(ev, mx, my) {
				;[mx, my] = cells_point(mx, my)
				let w = mx - e.fields[hit_fi]._x - hit_dx
				let field = e.fields[hit_fi]
				field.w = clamp(w, field.min_w, field.max_w)
				field._w = field.w
				update_sizes()
			}

		} else {

			mm_col_resize = function(ev, mx, my) {
				e.cell_w = max(20, mx - hit_dx)
			}

		}

		function mu_col_resize(ev, mx, my) {
			hit_state = null
			let field = e.fields[hit_fi]
			e.class('col-resizing', false)
			if (horiz)
				e.set_prop(`col.${field.name}.w`, field.w)
			e.xsave()
			update_sizes()
			return false
		}

		return e.capture_pointer(ev, mm_col_resize, mu_col_resize)
	}

	// cell clicking ----------------------------------------------------------

	function ht_row_test(mx, my) {
		hit_ri = horiz
			? floor(my / e.cell_h)
			: floor(mx / e.cell_w)
		return hit_ri >= 0 && hit_ri <= e.rows.length - 1
	}

	function ht_cell_test(mx, my) {
		if (hit_target != e.cells_canvas)
			return
		;[mx, my] = cells_point(mx, my)
		if (!ht_row_test(mx, my))
			return
		let row = e.rows[hit_ri]
		for (let fi = 0; fi < e.fields.length; fi++) {
			let [x, y, w, h] = cell_rect(hit_ri, fi)
			hit_dx = mx - x
			hit_dy = my - y
			if ((horiz && hit_dx >= 0 && hit_dx <= w) ||
				(!horiz && hit_dy >= 0 && hit_dy <= h)
			) {
				let field = e.fields[fi]
				hit_fi = fi
				hit_indent = false
				if (row && field_has_indent(field)) {
					let has_children = row.child_rows.length > 0
					if (has_children) {
						let indent_x = indent_offset(row_indent(row))
						hit_indent = hit_dx <= indent_x
					}
				}
				return true
			}
		}
	}
	function ht_cell(ev, mx, my) {
		if (!hit_state)
			if (ht_cell_test(mx, my)) {
				hit_state = 'cell'
				if (ev) {
					e.update()
					update_error_tooltip()
				}
			}
		if (!hit_state)
			update_error_tooltip()
	}

	function ht_col_test(mx, my) {
		if (hit_target != e.header_canvas)
			return
		;[mx, my] = cells_point(mx, my)
		mx =  horiz ? mx : 0
		my = !horiz ? my : 0
		for (let fi = 0; fi < e.fields.length; fi++) {
			let [x, y, w, h] = hcell_rect(fi)
			hit_dx = mx - x
			hit_dy = my - y
			if ((horiz && hit_dx >= 0 && hit_dx <= w) ||
				(!horiz && hit_dy >= 0 && hit_dy <= h)) {
				hit_fi = fi
				return true
			}
		}
	}
	function ht_col(ev, mx, my) {
		if (!hit_state)
			if (ht_col_test(mx, my))
				hit_state = 'col'
		e.class('col-move', hit_state == 'col')
		e.header.title = hit_state == 'col' && e.fields[hit_fi].info || ''
	}

	function mm_row_drag(ev, mx, my) {
		if (hit_state == 'row_moving')
			return mm_row_move(ev, mx, my)
		if (ht_row_move(ev, mx, my))
			if (md_row_move(ev, mx, my))
				mm_row_move(ev, mx, my)
	}

	function mu_row_drag(ev, mx, my) {
		if (hit_state == 'row_moving')
			return mu_row_move(ev, mx, my)
		e.pick_val()
		hit_state = null
		return false
	}

	function md_row_drag(ev, mx, my, shift, ctrl) {

		if (!e.has_focus)
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

		if (e.focus_cell(hit_ri, hit_fi, 0, 0, {
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
		})) {
			hit_state = 'row_dragging'
			return e.capture_pointer(ev, mm_row_drag, mu_row_drag)
		} else {
			return false
		}
	}

	// column moving ----------------------------------------------------------

	let col_mover = live_move_mixin()

	col_mover.movable_element_size = function(fi) {
		let [x, y, w, h] = cell_rect(0, fi)
		return horiz ? w : h
	}

	col_mover.set_movable_element_pos = function(fi, x) {
		e.fields[fi]._x = x
		if (e.focused_field_index == fi)
			update_editor(
				 horiz ? x : null,
				!horiz ? x : null)
	}

	function mm_col_drag(ev, mx, my) {
		if (hit_state == 'col_dragging')
			if (e.can_reorder_fields)
				ht_col_move(ev, mx, my)
		if (hit_state == 'col_moving')
			mm_col_move(ev, mx, my)
	}

	function mu_col_drag(ev, mx, my) {
		if (hit_state == 'col_moving')
			return mu_col_move(ev, mx, my)
		if (e.can_sort_rows) {
			e.set_order_by_dir(e.fields[hit_fi], 'toggle', ev.shiftKey)
			e.xsave()
		} else if (e.focus_cell_on_click_header)
			e.focus_cell(true, hit_fi)
		hit_state = null
		return false
	}

	function md_col_drag(ev, mx, my) {
		hit_state = 'col_dragging'
		return e.capture_pointer(ev, mm_col_drag, mu_col_drag)
	}

	function ht_col_move(ev, mx, my) {
		if ( horiz && abs(hit_mx - mx) < 8) return
		if (!horiz && abs(hit_my - my) < 8) return
		e.class('col-moving')
		if (e.editor && e.focused_field_index == hit_fi)
			e.editor.class('col-moving')
		col_mover.move_element_start(hit_fi, 1, 0, e.fields.length)
		hit_state = 'col_moving'
		return true
	}

	function mm_col_move(ev, mx, my) {
		;[mx, my] = cells_point(mx, my)
		mx -= hit_dx
		my -= hit_dy
		col_mover.move_element_update(horiz ? mx : my)
		update_sizes()
		e.scroll_to_cell(hit_ri, hit_fi)
	}

	function mu_col_move(ev, mx, my) {
		let over_fi = col_mover.move_element_stop() // sets x of moved element.
		e.class('col-moving', false)
		if (e.editor)
			e.editor.class('col-moving', false)
		e.move_field(hit_fi, over_fi)
		hit_state = null
		e.xsave()
	}

	// row moving -------------------------------------------------------------

	function ht_row_move(ev, mx, my) {
		if (e.focused_row_index != hit_ri) return
		if ( horiz && abs(hit_my - my) < 8) return
		if (!horiz && abs(hit_mx - mx) < 8) return
		if (!e.can_actually_move_rows()) return
		if (e.editor) return
		return true
	}

	let mm_row_move, mu_row_move

	function md_row_move(mx, my) {

		// initial state

		let s = e.start_move_selected_rows({input: e})
		if (!s)
			return

		let [cx1, cy1, cw1, ch1] = cell_rect(s.move_ri1, hit_fi)
		let [cx2, cy2, cw2, ch2] = cell_rect(s.move_ri2, hit_fi)
		let [hit_cell_mx, hit_cell_my] = cells_point(hit_mx, hit_my)
		hit_cell_mx -= cx1
		hit_cell_my -= cy1

		let ri1       = s.ri1
		let ri2       = s.ri2
		let move_ri1  = s.move_ri1
		let move_ri2  = s.move_ri2
		let move_n    = s.move_n
		let move_w    =  horiz ? cw1 : cx2 - cx1
		let move_h    = !horiz ? ch1 : cy2 - cy1

		let w = horiz ? e.cell_h : e.cell_w

		// move state

		let hit_x
		let hit_over_ri = move_ri1
		let hit_parent_row = s.parent_row

		let xof       = (ri => ri * w)
		let final_xof = (ri => xof(ri) + (ri < hit_over_ri ? 0 : move_n) * w)

		function advance_row(before_ri) {
			if (!e.is_tree)
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

		s.indent_x = indent_offset(row_indent(s.rows[0]))

		function update_hit_parent_row(hit_p) {
			let hit_indent = 0
			if (e.is_tree) {
				if (e.can_change_parent) {
					let row1 = e.rows[hit_over_ri-1]
					let row2 = e.rows[hit_over_ri]
					let i1 = row1 ? row_indent(row1) : 0
					let i2 = row2 ? row_indent(row2) : 0
					// if the row can be a child of the row above,
					// the indent right limit is increased one unit.
					let ii1 = i1 + (row1 && !row1.collapsed && e.row_can_have_children(row1) ? 1 : 0)
					hit_indent = min(floor(lerp(hit_p, 0, 1, ii1 + 1, i2)), ii1)
					let parent_i = i1 - hit_indent
					hit_parent_row = parent_i >= 0 ? row1 && row1.parent_rows[parent_i] : row1
				} else {
					hit_indent = row_indent(s.parent_row) + 1
					hit_parent_row = s.parent_row
				}
			}
			s.hit_indent_x = indent_offset(hit_indent)
			s.hit_parent_row = hit_parent_row
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

				let view_x = horiz ? scroll_y : scroll_x
				let view_w = horiz ? cells_view_h : cells_view_w

				// update state for the visible range of non-moving elements.
				{
				let vri1 = xs.binsearch(view_x, '<=') - 1
				let vri2 = xs.binsearch(view_x + view_w)
				vri1 = clamp(vri1, 0, e.rows.length-1)
				s.vri1 = vri1
				s.vri2 = vri2
				s.xs = xs
				}

				// update state for the visible range of moving elements.
				let state_x0 = s.x
				{
				let dx1 = max(0, view_x - hit_x)
				let di1 = floor(dx1 / w)
				let move_vri1 = move_ri1 + di1
				let move_vrn = min(vrn, move_ri2 - move_vri1)
				let move_vri2 = move_ri1 + move_vrn
				s.move_vri1 = move_vri1 - move_ri1
				s.move_vri2 = move_vri2 - move_ri1
				s.x = hit_x
				}

				return ari2 > ari1 || state_x0 !== s.x
			}

		}

		// mouse, scroll and animation controller

		let af
		function update_cells_moving() {
			if (animate()) {

				let [x, y, w, h] = cells_rect(s.move_vri1, hit_fi, s.move_vri2, hit_fi+1, 'moving_rows')
				if ((horiz && h * .8 > cells_view_h) ||
					(!horiz && w * .8 > cells_view_w)
				) {
					// moving cells don't fit the view: scroll to view the hit row only.
					;[x, y, w, h] = cells_rect(hit_ri, hit_fi, hit_ri+1, hit_fi+1)
				}
				let [sx, sy] = e.cells_view.scroll_to_view_rect(scroll_x, scroll_y, x, y, w, h)
				update_scroll(sx, sy)
				update_view()

				af = raf(update_cells_moving)
			} else {
				af = null
			}
		}

		{
		let mx0, my0
		mm_row_move = function(ev, mx, my) {
			mx = or(mx, mx0)
			my = or(my, my0)
			mx0 = mx
			my0 = my
			let r = e.cells_view.rect()
			mx -= r.x - scroll_x
			my -= r.y - scroll_y
			hit_x = horiz
				? my - hit_cell_my
				: mx - hit_cell_mx
			hit_x = clamp(hit_x, xof(ri1), xof(ri2))
			move()
			if (af == null)
				af = raf(update_cells_moving)
		}
		}

		mu_row_move = function() {
			if (af != null)
				cancel_raf(af)
			clearInterval(scroll_timer)

			mm_row_move = null
			mu_row_move = null

			e.class('row-moving', false)
			if (e.editor)
				e.editor.class('row-moving', false)

			hit_state = null
			row_move_state = null

			s.finish(hit_over_ri, hit_parent_row)

			return false
		}

		// post-init

		e.class('row-moving')
		if (e.editor)
			e.editor.class('row-moving')

		let scroll_timer = runevery(.1, function() { mm_row_move() } )

		hit_state = 'row_moving'
		row_move_state = s

		return true
	}

	// empty placeholder text -------------------------------------------------

	let barrier
	e.set_empty_text = function(s) {
		if (barrier) return
		e.empty_rt.content = s
	}

	e.on_bind(function(on) {
		if (on && !e.empty_rt) {
			e.empty_rt = richtext({
				classes: 'grid-empty-rt',
				align_x: 'center',
				align_y: 'center',
			})
			e.empty_rt.hidden = true
			e.cells_view.add(e.empty_rt)
		}
	})

	e.prop('empty_text', {slot: 'lang'})

	e.listen('prop_changed', function(te, k, v) {
		if (te == e.empty_rt && k == 'content') {
			barrier = true
			e.empty_text = v
			barrier = false
		}
	})

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

		if (!(hit_state == 'col' || hit_state == 'cell') || !hit_state || !ev.ctrlKey) {
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
			e.set_prop(`col.${editing_field.name}.label`, s)
			editing_field = null
			if (window.xmodule)
				xmodule.save()
		}
	}

	let sql_editor, sql_editor_ct

	function set_editing_sql(on) {
		e.cells_view.class('editing', on)
		if (on) {
			sql_editor_ct = div({class: 'grid-sql-editor'})
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

	function pointermove(ev, mx, my, fix_hit_target) {

		// NOTE: if pointer was captured on pointerdown, ev.target on click event
		// is set to e, not the real target, so we set and use hit_target instead!
		hit_target = fix_hit_target ? document.elementFromPoint(mx, my) : ev.target
		hit_state = null
		hit_mx = mx
		hit_my = my

		if (e.widget_editing) {
			ht_col(ev, mx, my)
			return
		}
		ht_header_resize(ev, mx, my)
		ht_col_resize(ev, mx, my)
		ht_col(ev, mx, my)
		ht_cell(ev, mx, my)
		if (hit_state)
			return false
	}

	e.on('pointermove', function(ev, mx, my) {
		if (!e.pointer_captured)
			return pointermove(ev, mx, my)
	})

	e.on('pointerdown', function(ev, mx, my) {
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
		if (hit_state == 'header_resize')
			return md_header_resize(ev, mx, my)
		if (hit_state == 'col_resize')
			return md_col_resize(ev, mx, my)
		if (hit_state == 'col')
			return md_col_drag(ev, mx, my)
		if (hit_state == 'cell')
			return md_row_drag(ev, mx, my, ev.shiftKey, ev.ctrlKey)
		assert(false)
	})

	e.on('rightpointerdown', function(ev, mx, my) {

		if (e.widget_editing)
			return
		if (!hit_state)
			if (!pointermove(ev, mx, my))
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
	})

	e.cells_canvas.on('pointerleave', function(ev) {
		if (hit_state != 'cell')
			return
		hit_state = null
		e.update()
	})

	e.on('contextmenu', function(ev) {
		let fi = (hit_state == 'cell' || hit_state == 'col') ? hit_fi : null
		context_menu_popup(fi, ev.clientX, ev.clientY)
		return false
	})

	e.on('click', function(ev, mx, my) {
		pointermove(ev, mx, my, true)
		if (hit_state != 'cell')
			return
		if (e.fire('cell_click', hit_ri, hit_fi, ev) == false)
			return false
	})

	e.on('dblclick', function(ev, mx, my) {
		pointermove(ev, mx, my, true)
		if (hit_state != 'cell')
			return
		if (hit_indent)
			return
		let field = e.fields[hit_fi]
		if (field.cell_dblclick) {
			let row = e.rows[hit_ri]
			if (field.cell_dblclick.call(e, cell_val_node(hit_cell), row, field) == false)
				return false
		}
		if (e.fire('cell_dblclick', hit_ri, hit_fi, ev) == false)
			return false
		if (e.enter_edit_on_dblclick)
			e.enter_edit('select_all')
	})

	function update_state() { e.update() }
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
				if (row.is_new && !e.is_row_user_modified(row)) {
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
				if (row.is_new && !e.is_row_user_modified(row, true))
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
					e.xsave()
				},
			})

		items.push({
			text: S('always_show_save_bar', 'Show action band at all times'),
			checked: e.action_band_visible == 'always',
			action: function(item) {
				e.action_band_visible = item.checked ? 'always' : 'auto'
				e.xsave()
			},
		})

		items.push({
			text: S('show_as_vertical_grid', 'Show as vertical grid'),
			checked: e.vertical,
			action: function(item) {
				e.vertical = item.checked
				e.xsave()
			},
		})

		items.push({
			text: S('show_as_flat_grid', 'Show as flat grid'),
			checked: e.flat,
			enabled: e.can_be_tree,
			action: function(item) {
				e.flat = item.checked
				e.xsave()
			},
		})

		items.push({
			text: S('auto_stretch_columns', 'Auto-stretch columns'),
			checked: e.auto_cols_w,
			action: function(item) {
				e.auto_cols_w = item.checked
				e.xsave()
			},
		})

		if (e.can_change_header_visibility)
			items.push({
				text: S('show_header', 'Show header'),
				checked: e.header_visible,
				action: function(item) {
					e.header_visible = item.checked
					e.xsave()
				},
			})

		if (e.can_change_fields_visibility) {

			if (fi != null) {
				function hide_field(item) {
					e.show_field(item.field, false)
					e.xsave()
				}
				let field = e.fields[fi]
				let hide_text = span({}, S('hide_field', 'Hide field'), ' "', field.label, '"')
				items.push({
					field: field,
					text: hide_text,
					action: hide_field,
				})
			}

			let field_items = []
			function show_field(item) {
				e.show_field(item.field, item.checked, fi)
				e.xsave()
				return false
			}
			for (let field of e.all_fields) {
				if (!field.internal)
					field_items.push({
						field: field,
						text: field.label,
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

		if (e.is_tree) {

			items.last.separator = true

			items.push({
				text: S('expand_all', 'Expand all'),
				disabled: !e.is_tree,
				action: function() { e.set_collapsed(null, false, true) },
			})
			items.push({
				text: S('collapse_all', 'Collapse all'),
				disabled: !e.is_tree,
				action: function() { e.set_collapsed(null, true, true) },
			})
		}

		e.fire('init_context_menu_items', items)

		e.context_menu = menu({
			items: items,
			id: e.id ? e.id + '.context_menu' : null,
			grid: e,
			popup_side: 'inner-top',
			popup_align: 'left',
			popup_target: document.body,
			popup_ox: mx,
			popup_oy: my,
		})
		e.add(e.context_menu)

	}

})

// ---------------------------------------------------------------------------
// grid dropdown
// ---------------------------------------------------------------------------

G.grid_dropdown = component('grid-dropdown', function(e) {

	e.class('grid-dropdown')
	nav_dropdown_widget(e)

	e.create_picker = function(opt) {
		return element(assign_opt(opt, {
			tag: 'grid',
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

G.row_form = component('row-frm', function(e) {

	e.class('row-form')
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

	e.on_bind(function(on) {
		bind_nav(e._nav, on)
	})

	e.set_nav = function(nav1, nav0) {
		assert(nav1 != e)
		bind_nav(nav0, false)
		bind_nav(nav1, true)
		reset()
	}

	e.prop('nav'    , {private: true})
	e.prop('nav_id' , {bind_id: 'nav', type: 'nav', attr: 'nav'})

	function reset() {
		e.rowset.fields = e._nav.all_fields_map
		e.rowset.rows = [e._nav.focused_row]
		e.reset()
		e.row = e.all_rows[0]
	}

	function row_changed(nav_row) {
		e.all_rows = [nav_row]
		e.row = e.all_rows[0]
		//for (let i = 0; i < e.all_fields.length; i++)

	}

	function display_vals_changed() {
		e.update()
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
			let nav_row = e._nav.all_rows[e.row_index(row)]
			let nav_field = e._nav.all_fields[e.field_index(field)]
			e._nav.set_cell_val(nav_row, nav_field, changes.input_val[0])
		}
	})

})

// ---------------------------------------------------------------------------
// grid profile
// ---------------------------------------------------------------------------

G.grid_profile = component('grid-profile', function(e) {

	tabs_item_widget(e)

})

}()) // module function
