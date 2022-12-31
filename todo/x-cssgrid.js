
// ---------------------------------------------------------------------------
// cssgrid widget
// ---------------------------------------------------------------------------

component('x-cssgrid', 'Containers', function(e) {

	serializable_widget(e)
	selectable_widget(e)
	editable_widget(e)
	contained_widget(e)
	widget_items_widget(e)

	// generate a 3-letter value for `grid-area` based on item's `col` attr or `id`.
	let names = {}
	function area_name(item) {
		let s = item.col || item.attr('col') || item.id
		if (!s) return
		s = s.slice(0, 3)
		if (names[s]) {
			let x = num(names[s][2]) || 1
			do { s = s.slice(0, 2) + (x + 1) } while (names[s])
		}
		names[s] = true
		return s
	}

	// widget-items widget protocol.
	e.do_init_items = function() {
		for (let item of e.items) {
			if (!item.style['grid-area'])
				item.style['grid-area'] = area_name(item)
			e.add(item)
		}
	}

	// get/set gaps -----------------------------------------------------------

	e.prop('gap_x', {style: 'column-gap', type: 'number', style_format: v => v+'px'})
	e.prop('gap_y', {style: 'row-gap'   , type: 'number', style_format: v => v+'px'})

	// get/set template sizes -------------------------------------------------

	function type(axis) { return axis == 'x' ? 'column' : 'row' }

	function get_sizes_for(axis) {
		return e.style[`grid-template-${type(axis)}s`]
	}
	function set_sizes_for(axis, s) {
		e.style[`grid-template-${type(axis)}s`] = s
	}
	e.get_sizes_x = function() { return get_sizes_for('x') }
	e.get_sizes_y = function() { return get_sizes_for('y') }
	e.set_sizes_x = function(s) { set_sizes_for('x', s) }
	e.set_sizes_y = function(s) { set_sizes_for('y', s) }
	e.prop('sizes_x', {store: false})
	e.prop('sizes_y', {store: false})

	// editable widget protocol.
	e.set_widget_editing = function(v, ...args) {
		if (!v) return
		cssgrid_widget_editing(e)
		e.set_widget_editing(true, ...args)
	}

	e.items = [...e.at]

})

// ---------------------------------------------------------------------------
// cssgrid widget editing mixin
// ---------------------------------------------------------------------------

function cssgrid_widget_editing(e) {

	e.set_widget_editing = function(v) {
		if (v)
			enter_editing()
		else
			exit_editing()
	}

	function set_item_span(e, axis, i1, i2) {
		if (i1 !== false)
			e['pos_'+axis] = i1+1
		if (i2 !== false)
			e['span_'+axis] = i2 - (i1 !== false ? i1 : e['pos_'+axis]-1)
	}

	function type(axis) { return axis == 'x' ? 'column' : 'row' }

	function track_sizes(axis) {
		return e.css(`grid-template-${type(axis)}s`).split(' ').map(num)
	}

	e.each_cssgrid_line = function(axis, f) {
		let ts = track_sizes(axis)
		let gap = e['gap_'+axis]
		let x1, x2
		let x = 0
		for (let i = 0; i < ts.length; i++) {
			f(i, x)
			x += ts[i] + (i < ts.length-1 ? gap : 0)
		}
		f(ts.length, x)
	}

	// track bounds -----------------------------------------------------------

	function track_bounds_for(axis, i1, i2) {
		let x1, x2
		e.each_cssgrid_line(axis, function(i, x) {
			if (i == i1)
				x1 = x
			if (i == i2)
				x2 = x
		})
		return [x1, x2]
	}

	e.cssgrid_track_bounds = function(i1, j1, i2, j2) {
		let [x1, x2] = track_bounds_for('x', i1, i2)
		let [y1, y2] = track_bounds_for('y', j1, j2)
		return [x1, y1, x2, y2]
	}

	// get/set template sizes from/to array

	function get_sizes(axis) {
		return e['sizes_'+axis].words()
	}

	function set_sizes(axis, ts, prevent_recreate_guides) {
		e.prevent_recreate_guides = prevent_recreate_guides
		e['sizes_'+axis] = ts.join(' ')
		e.prevent_recreate_guides = false
	}

	function set_size(axis, i, sz) {
		let ts = get_sizes(axis)
		ts[i] = sz
		set_sizes(axis, ts)
	}

	// can't have implicit grid lines because spans with -1 can't reach them.
	function make_implicit_lines_explicit_for(axis) {
		let ts = get_sizes(axis)
		let n = track_sizes(axis).length
		for (let i = 0; i < n; i++)
			ts[i] = or(repl(ts[i], '', null), 'auto')
		set_sizes(axis, ts)
	}

	//

	function update_guides_for(axis) {
		if (!e.prevent_recreate_guides) {
			remove_guides_for(axis)
			create_guides_for(axis)
		}
		update_sizes_for(axis)
	}

	function update_guides() {
		update_guides_for('x')
		update_guides_for('y')
	}

	function bind(on) {
		document.on('prop_changed', prop_changed, on)
	}

	function enter_editing() {
		make_implicit_lines_explicit_for('x')
		make_implicit_lines_explicit_for('y')
		create_guides_for('x')
		create_guides_for('y')
		update_sizes()
		bind(true)
	}

	function exit_editing() {
		bind(false)
		e.add_button.hidden = true
		remove_guides_for('x')
		remove_guides_for('y')
	}

	function prop_changed(te, k) {
		if (te.parent == e) {
			if (k == 'pos_x' || k == 'span_x')
				update_guides_for('x')
			else if (k == 'pos_y' || k == 'span_y')
				update_guides_for('y')
		} else if (te == e) {
			if (k == 'sizes_x')
				update_sizes_for('x')
			else if (k == 'sizes_y')
				update_sizes_for('y')
		}
	}

	// add/remove grid lines --------------------------------------------------

	function remove_line(axis, i) {
		let ts = get_sizes(axis)
		ts.remove(i)
		set_sizes(axis, ts)
		for (let item of e.items) {
			let i1 = item['pos_'+axis]-1
			let i2 = item['pos_'+axis]-1 + e['span_'+axis]
			set_item_span(item, axis,
				i1 >= i && max(0, i1-1),
				i2 >  i && i2-1)
		}
	}

	function insert_line(axis, i) {
		let ts = get_sizes(axis)
		ts.insert(i, '20px')
		set_sizes(axis, ts)
		for (let item of e.items) {
			let i1 = item['pos_'+axis]-1
			let i2 = item['pos_'+axis]-1 + e['span_'+axis]
			set_item_span(item, axis,
				i1 >= i && i1+1,
				i2 >  i && i2+1)
		}
	}

	// visuals ////////////////////////////////////////////////////////////////

	// grid line guides -------------------------------------------------------

	function update_sizes_for(axis) {
		let n = track_sizes(axis).length
		let ts = get_sizes(axis)
		for (let i = 0; i < n; i++) {
			let guide = e.guides[axis][i]
			let s = or(ts[i], 'auto')
			guide.label.set(s.ends('px') ? num(s) : s)
		}
	}

	function update_sizes() {
		update_sizes_for('x')
		update_sizes_for('y')
	}

	e.guides = {x: [], y: []}

	function other_axis(axis) { return axis == 'x' ? 'y' : 'x' }

	function create_guides_for(axis) {
		let n = track_sizes(axis).length
		for (let i = 0; i < n; i++) {
			let tip = div({class: 'x-arrow x-cssgrid-tip', axis: axis, side: axis == 'x' ? 'top' : 'left'})
			let label = div({class: 'x-cssgrid-label', axis: axis})
			let guide = div({class: 'x-cssgrid-guide', axis: axis}, tip, label)
			tip.axis = axis
			tip.i = i
			label.axis = axis
			label.i = i
			tip.on('pointerdown', tip_pointerdown)
			tip.on('dblclick'   , tip_dblclick)
			label.on('pointerdown', label_pointerdown)
			guide.tip = tip
			guide.label = label
			guide.style[`grid-${type(axis)}-start`] = i+2
			guide.style[`grid-${type(other_axis(axis))}-start`] =  1
			e.guides[axis][i] = guide
			e.add(guide)
		}
	}

	function remove_guides_for(axis) {
		let guides = e.guides[axis]
		if (guides)
			for (let guide of guides)
				guide.remove()
		e.guides[axis] = []
	}

	// controller /////////////////////////////////////////////////////////////

	// drag-move guide tips => change grid template sizes ---------------------

	function tip_pointerdown(ev, mx, my) {
		if (ev.ctrlKey) {
			remove_line(this.axis, this.i+1)
			return false
		}

		let s0 = track_sizes(this.axis)[this.i]
		let drag_mx =
			(this.axis == 'x' ? mx : my) -
			e.rect()[this.axis]

		// transform auto size to pixels to be able to move the line.
		let tz = get_sizes(this.axis)
		let z0 = tz[this.i]
		if (z0 == 'auto') {
			z0 = s0
			z0 = z0.dec() + 'px'
			tz[this.i] = z0
			set_sizes(this.axis, tz, true)
		}
		z0 = num(z0)

		return this.capture_pointer(ev, function(ev, mx, my) {
			let dx = (this.axis == 'x' ? mx : my) - drag_mx - e.rect()[this.axis]
			let tz = get_sizes(this.axis)
			let z = tz[this.i]
			if (z.ends('px')) {
				z = s0 + dx
				if (!ev.shiftKey)
					z = round(z / 10) * 10
				z = z.dec() + 'px'
			} else if (z.ends('%')) {
				z = num(z)
				let dz = lerp(dx, 0, s0, 0, z0)
				z = z0 + dz
				if (!ev.shiftKey) {
					let z1 = round(z / 5) * 5
					let z2 = round(z / (100 / 3)) * (100 / 3)
					z = abs(z1 - z) < abs(z2 - z) ? z1 : z2
				}
				z = z.dec(1) + '%'
			} else if (z.ends('fr')) {
				// TODO:
			}
			tz[this.i] = z
			set_sizes(this.axis, tz, true)
		})

	}

	function tip_dblclick() {
		insert_line(this.axis, this.i+1)
		return false
	}

	function label_pointerdown() {
		let z = get_sizes(this.axis)[this.i]
		if (z == 'auto') {
			z = track_sizes(this.axis)[this.i]
			z = z.dec() + 'px'
		} else if (z.ends('px')) {
			let px = track_sizes(this.axis)[this.i]
			z = lerp(px, 0, e.clientWidth, 0, 100)
			z = z.dec(1) + '%'
		} else if (z.ends('fr')) {
			z = 'auto'
		} else if (z.ends('%')) {
			z = 'auto'
		}
		set_size(this.axis, this.i, z)
		return false
	}

	// show add button when hovering empty grid cells -------------------------

	e.add_button = button({classes: 'x-cssgrid-add-button', text: 'add...'})
	e.add_button.can_select_widget = false
	e.add_button.hidden = true
	e.add(e.add_button)
	e.add_button.on('click', function() {
		let item = widget_placeholder({module: e.module})
		item.pos_x = this.pos_x
		item.pos_y = this.pos_y
		e.items.push(item)
		e.add(item)
		document.fire('widget_tree_changed')
	})

	function is_cell_empty(i, j) {
		for (let item of e.items)
			if (
				item.pos_x <= i && item.pos_x + item.span_x > i &&
				item.pos_y <= j && item.pos_y + item.span_y > j
			) return false
		return true
	}

	e.on('pointermove', function(ev, mx, my) {
		if (ev.buttons)
			return
		if (!e.widget_editing)
			return

		let r = e.rect()
		my -= r.y
		mx -= r.x
		let pos_x, pos_y, x1, y1, x2, y2
		e.each_cssgrid_line('x', function(i, x) {
			if (mx > x) {
				pos_x = i + 1
				x1 = x
			} else if (x2 == null)
				x2 = x
		})
		e.each_cssgrid_line('y', function(j, y) {
			if (my > y) {
				pos_y = j + 1
				y1 = y
			} else if (y2 == null)
				y2 = y
		})

		e.add_button.pos_x = pos_x
		e.add_button.pos_y = pos_y

		e.add_button.show(is_cell_empty(pos_x, pos_y))

	})

	// xmodule interface ------------------------------------------------------

	e.accepts_form_widgets = true

	e.replace_widget = function(old_widget, new_widget) {
		let i = e.items.indexOf(old_widget)
		e.items[i] = new_widget
		old_widget.parent.replace(old_widget, new_widget)
		document.fire('widget_tree_changed')
	}

	// you won't believe this shit, but page-up/down from inner contenteditables
	// bubble up on overflow:hidden containers scroll them.
	e.on('keydown', function(key) {
		if (key == 'PageUp' || key == 'PageDown')
			return false
	})

}


// ---------------------------------------------------------------------------
// cssgrid item widget mixin
// ---------------------------------------------------------------------------

function cssgrid_item_widget(e) {

	e.prop('pos_x'  , {style: 'grid-column-start' , type: 'number'})
	e.prop('pos_y'  , {style: 'grid-row-start'    , type: 'number'})
	e.prop('span_x' , {style: 'grid-column-end'   , type: 'number', style_format: v => 'span '+v, style_parse: v => num((v || 'span 1').replace('span ', '')) })
	e.prop('span_y' , {style: 'grid-row-end'      , type: 'number', style_format: v => 'span '+v, style_parse: v => num((v || 'span 1').replace('span ', '')) })
	e.prop('align_x', {style: 'justify-self'      , type: 'enum', enum_values: 'start end center stretch'})
	e.prop('align_y', {style: 'align-self'        , type: 'enum', enum_values: 'start end center stretch'})

	let do_select_widget = e.do_select_widget
	let do_unselect_widget = e.do_unselect_widget

	e.do_select_widget = function(focus) {
		do_select_widget(focus)
		let p = e.parent_widget
		if (p && p.iswidget && p.type == 'cssgrid') {
			cssgrid_item_widget_editing(e)
			e.cssgrid_item_do_select_widget()
		}
	}

	e.do_unselect_widget = function(focus_prev) {
		let p = e.parent_widget
		if (p && p.iswidget && p.type == 'cssgrid')
			e.cssgrid_item_do_unselect_widget()
		do_unselect_widget(focus_prev)
	}

}


// ---------------------------------------------------------------------------
// editable widget protocol for cssgrid item
// ---------------------------------------------------------------------------

function cssgrid_item_widget_editing(e) {

	function track_bounds() {
		let i = e.pos_x-1
		let j = e.pos_y-1
		return e.parent_widget.cssgrid_track_bounds(i, j, i + e.span_x, j + e.span_y)
	}

	function set_span(axis, i1, i2) {
		if (i1 !== false)
			e['pos_'+axis] = i1+1
		if (i2 !== false)
			e['span_'+axis] = i2 - (i1 !== false ? i1 : e['pos_'+axis]-1)
	}

	function toggle_stretch_for(horiz) {
		let attr = horiz ? 'align_x' : 'align_y'
		let align = e[attr]
		if (align == 'stretch')
			align = e['_'+attr] || 'center'
		else {
			e['_'+attr] = align
			align = 'stretch'
		}
		e[horiz ? 'w' : 'h'] = align == 'stretch' ? 'auto' : null
		e[attr] = align
		return align
	}
	function toggle_stretch(horiz, vert) {
		if (horiz && vert) {
			let stretch_x = e.align_x == 'stretch'
			let stretch_y = e.align_y == 'stretch'
			if (stretch_x != stretch_y) {
				toggle_stretch(!stretch_x, !stretch_y)
			} else {
				toggle_stretch(true, false)
				toggle_stretch(false, true)
			}
		} else if (horiz)
			toggle_stretch_for(true)
		else if (vert)
			toggle_stretch_for(false)
	}

	e.cssgrid_item_do_select_widget = function() {

		let p = e.parent_widget
		if (!(p && p.iswidget && p.type == 'cssgrid'))
			return

		p.widget_editing = true

		e.widget_selected_overlay.on('focus', function() {
			p.widget_editing = true
		})

		let span_outline = div({class: 'x-cssgrid-span'},
			div({class: 'x-cssgrid-span-handle', side: 'top'}),
			div({class: 'x-cssgrid-span-handle', side: 'left'}),
			div({class: 'x-cssgrid-span-handle', side: 'right'}),
			div({class: 'x-cssgrid-span-handle', side: 'bottom'}),
		)
		span_outline.on('pointerdown', so_pointerdown)
		p.add(span_outline)

		function update_so() {
			for (let s of ['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end'])
				span_outline.style[s] = e.style[s]
		}
		update_so()

		function prop_changed(te, k) {
			if (te == e)
				if (k == 'pos_x' || k == 'span_x' || k == 'pos_y' || k == 'span_y')
					update_so()
		}

		e.on_bind(function(on) {
			document.on('prop_changed', prop_changed, on)
		})

		// drag-resize item's span outline => change item's grid area ----------

		let drag_mx, drag_my, side

		function resize_span(mx, my) {
			let horiz = side == 'left' || side == 'right'
			let axis = horiz ? 'x' : 'y'
			let second = side == 'right' || side == 'bottom'
			mx = horiz ? mx - drag_mx : my - drag_my
			let i1 = e['pos_'+axis]-1
			let i2 = e['pos_'+axis]-1 + e['span_'+axis]
			let dx = 1/0
			let closest_i
			e.parent_widget.each_cssgrid_line(axis, function(i, x) {
				if (second ? i > i1 : i < i2) {
					if (abs(x - mx) < dx) {
						dx = abs(x - mx)
						closest_i = i
					}
				}
			})
			set_span(axis,
				!second ? closest_i : i1,
				 second ? closest_i : i2
			)
		}

		function so_pointerdown(ev, mx, my) {
			let handle = ev.target.closest('.x-cssgrid-span-handle')
			if (!handle) return
			side = handle.attr('side')

			let [bx1, by1, bx2, by2] = track_bounds()
			let second = side == 'right' || side == 'bottom'
			drag_mx = mx - (second ? bx2 : bx1)
			drag_my = my - (second ? by2 : by1)
			resize_span(mx, my)

			return this.capture_pointer(ev, so_pointermove)
		}

		function so_pointermove(ev, mx, my) {
			resize_span(mx, my)
		}

		function overlay_keydown(key, shift, ctrl) {
			if (key == 'Enter') { // toggle stretch
				toggle_stretch(!shift, !ctrl)
				return false
			}
			if (key == 'ArrowLeft' || key == 'ArrowRight' || key == 'ArrowUp' || key == 'ArrowDown') {
				let horiz = key == 'ArrowLeft' || key == 'ArrowRight'
				let fw = key == 'ArrowRight' || key == 'ArrowDown'
				if (ctrl) { // change alignment
					let attr = horiz ? 'align_x' : 'align_y'
					let align = e[attr]
					if (align == 'stretch')
						align = toggle_stretch(horiz, !horiz)
					let align_indices = {start: 0, center: 1, end: 2}
					let align_map = keys(align_indices)
					align = align_map[align_indices[align] + (fw ? 1 : -1)]
					e[attr] = align
				} else { // resize span or move to diff. span
					let axis = horiz ? 'x' : 'y'
					if (shift) { // resize span
						let i1 = e['pos_'+axis]-1
						let i2 = e['pos_'+axis]-1 + e['span_'+axis]
						let i = max(i1+1, i2 + (fw ? 1 : -1))
						set_span(axis, false, i)
					} else {
						let i = max(0, e['pos_'+axis]-1 + (fw ? 1 : -1))
						set_span(axis, i, i+1)
					}
				}
				return false
			}

		}
		e.widget_selected_overlay.on('keydown', overlay_keydown)

		e.cssgrid_item_do_unselect_widget = function() {
			e.off('prop_changed', prop_changed)
			e.widget_selected_overlay.off('keydown', overlay_keydown)
			span_outline.remove()
			e.cssgrid_item_do_unselect_widget = noop

			// exit parent editing if this was the last item to be selected.
			let p = e.parent_widget
			if (p && p.widget_editing) {
				let only_item = true
				for (let e1 of selected_widgets)
					if (e1 != e && e1.parent_widget == p) {
						only_item = false
						break
					}
				if (only_item)
					p.widget_editing = false
			}

		}

	}

}

