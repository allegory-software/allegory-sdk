/*

	Chart widget.
	Written by Cosmin Apreutesei. Public Domain.

*/

component('x-chart', 'Input', function(e) {

	contained_widget(e)
	serializable_widget(e)
	selectable_widget(e)

	// config -----------------------------------------------------------------

	e.prop('split_cols' , {type: 'col', col_nav: () => e.nav, attr: true})
	e.prop('group_cols' , {type: 'col', col_nav: () => e.nav, attr: true})
	e.prop('sum_cols'   , {type: 'col', col_nav: () => e.nav, attr: true})
	e.prop('min_sum'    , {type: 'number', attr: true})
	e.prop('max_sum'    , {type: 'number', attr: true})
	e.prop('sum_step'   , {type: 'number', attr: true})
	e.prop('min_val'    , {type: 'number', attr: true})
	e.prop('max_val'    , {type: 'number', attr: true})
	e.prop('other_threshold', {type: 'number', default: .05, decimals: null, attr: true})
	e.prop('other_text', {default: 'Other', attr: true})
	e.prop('shape', {
		type: 'enum',
		enum_values: ['pie', 'stack', 'line', 'line_dots', 'area', 'area_dots',
			'column', 'bar', 'stackbar', 'bubble', 'scatter'],
		default: 'pie', attr: true,
	})

	e.set_split_cols      = update_model
	e.set_group_cols      = update_model
	e.set_sum_cols        = update_model
	e.set_min_val         = update_model
	e.set_max_val         = update_model
	e.set_min_sum         = update_model
	e.set_max_sum         = update_model
	e.set_other_threshold = update_model
	e.set_other_text      = update_model

	// model ------------------------------------------------------------------

	function compute_step_and_range(wanted_n, min_sum, max_sum, scale_base, scales, decimals) {
		scale_base = scale_base || 10
		scales = scales || [1, 2, 2.5, 5]
		let d = max_sum - min_sum
		let min_scale_exp = floor((d ? logbase(d, scale_base) : 0) - 2)
		let max_scale_exp = floor((d ? logbase(d, scale_base) : 0) + 2)
		let n0, step
		let step_multiple = decimals != null ? 10**(-decimals) : null
		for (let scale_exp = min_scale_exp; scale_exp <= max_scale_exp; scale_exp++) {
			for (let scale of scales) {
				let step1 = scale_base ** scale_exp * scale
				let n = d / step1
				if (n0 == null || abs(n - wanted_n) < n0) {
					if (step_multiple == null || floor(step1 / step_multiple) == step1) {
						n0 = n
						step = step1
					}
				}
			}
		}
		min_sum = floor (min_sum / step) * step
		max_sum = ceil  (max_sum / step) * step
		return [step, min_sum, max_sum]
	}

	function compute_sums(sum_def, row_group) {
		let agg = sum_def.agg
		let fi = sum_def.field.val_index
		let n
		let i = 0
		if (agg == 'sum' || agg == 'avg') {
			n = 0
			for (let row of row_group)
				if (row[fi] != null) {
					n += row[fi]
					i++
				}
			if (i && agg == 'avg')
				n /= i
		} else if (agg == 'min') {
			n = 1/0
			for (let row of row_group)
				if (row[fi] != null) {
					n = min(n, row[fi])
					i++
				}
		} else if (agg == 'max') {
			n = -1/0
			for (let row of row_group)
				if (row[fi] != null) {
					n = max(n, row[fi])
					i++
				}
		}
		if (i)
			row_group.sum = n
	}

	let sum_defs, group_cols, all_split_groups

	function reset_model() {
		sum_defs = null
		group_cols = null
		all_split_groups = null
	}

	function try_update_model() {

		if (!e.nav) return
		if (e.sum_cols == null) return
		if (e.group_cols == null) return

		// parse `sum_cols`: `COL1[/AVG|MIN|MAX|SUM][..COL2]`.
		// the `..` operator ties two line graphs together into a closed shape.
		sum_defs = []
		let tied_back = false
		for (let col of e.sum_cols.replaceAll('..', '.. ').words()) {
			let tied = col.includes('..')
			col = col.replace('..', '')
			let agg = 'avg'; col.replace(/\/[^\/]+$/, k => { agg = k; return '' })
			let fld = e.nav.optfld(col)
			if (fld) // it's enough for one sum_col to be valid.
				sum_defs.push({field: fld, tied: tied, tied_back: tied_back, agg: agg})
			tied_back = fld ? tied : false
		}
		if (!sum_defs.length)
			return

		// parse `group_cols`: `COL[/OFFSET][/UNIT][/FREQ]`.
		group_cols = []
		let range_defs = obj()
		for (let col of e.group_cols.trim().split(/\s+/)) {
			let freq, offset, unit
			col = col.replace(/\/[^\/]+$/, k => { freq   = k.substring(1).num(); return '' })
			col = col.replace(/\/[^\/]+$/, k => { unit   = k.substring(1); return '' })
			col = col.replace(/\/[^\/]+$/, k => { offset = k.substring(1).num(); return '' })
			let fld = e.nav.optfld(col)
			if (!fld)
				return
			group_cols.push(col)
			if (freq != null || offset != null || unit != null) {
				range_defs[col] = {
					freq   : freq,
					offset : offset,
					unit   : unit,
				}
			}
		}
		if (!group_cols.length)
			return

		if (!e.nav.rows.length)
			return true

		// group rows and compute the sums on each group.
		// all_split_groups : [split_group1, ...]   split groups (cgs) => superimposed graphs.
		// split_group      : [row_group1, ...]     row groups (xgs) => one graph of sum points.
		// row_group        : [row1, ...]           each row group => one sum point.
		all_split_groups = []
		for (let sum_def of sum_defs) {

			let split_groups = e.nav.row_groups({
				col_groups : catany('>', e.split_cols, group_cols.join(' ')),
				range_defs : range_defs,
				rows       : e.nav.rows,
			})

			if (!e.split_cols)
				split_groups = [split_groups]

			for (let split_group of split_groups) {

				for (let row_group of split_group)
					compute_sums(sum_def, row_group)

				split_group.tied_back = sum_def.tied_back
				split_group.tied = sum_def.tied

				split_group.sum_def = sum_def
			}

			all_split_groups.extend(split_groups)
		}

		return true
	}

	function update_model() {
		reset_model()
		if (!try_update_model())
			reset_model()
		e.update()
	}

	// compute label for a sum point.
	function sum_label(cls, text, sum) {
		let sum_fld = sum_defs[0].field
		let a = []
		if (text)
			a.push(text)
		a.push(e.nav.cell_display_val_for(null, sum_fld, sum))
		return a.join_nodes(tag('br'), cls && div({class: cls}))
	}

	function val_text(val) {
		let val_fld = e.nav.fld(group_cols[0]) // TODO: only works for single-col groups!
		let s = e.nav.cell_display_val_for(null, val_fld, val)
		return isnode(s) ? s.textContent : s
	}

	function pie_slices() {

		if (!all_split_groups)
			return

		let groups = all_split_groups[0] // TODO: draw multiple pies for each split group

		let slices = []
		slices.total = 0
		for (let group of groups) {
			let slice = {}
			let sum = group.sum
			slice.sum = sum
			slice.label = sum_label('x-chart-label', group.text, sum)
			slices.push(slice)
			slices.total += sum
		}

		// sum small slices into a single "other" slice.
		let big_slices = []
		let other_slice
		for (let slice of slices) {
			slice.size = slice.sum / slices.total
			if (slice.size < e.other_threshold) {
				other_slice = other_slice || {sum: 0}
				other_slice.sum += slice.sum
			} else
				big_slices.push(slice)
		}
		if (other_slice) {
			other_slice.size = other_slice.sum / slices.total
			other_slice.label = sum_label('x-chart-label', e.other_text, other_slice.sum)
			big_slices.push(other_slice)
		}
		return big_slices
	}

	// view -------------------------------------------------------------------

	e.prop('text', {attr: true, slot: 'lang'})

	e.header = div({class: 'x-chart-header'})
	e.view   = div({class: 'x-chart-view'})
	e.add(e.header, e.view)

	let renderer = {} // {shape->cons(...)->update()}
	let tt
	let pointermove = noop

	let view_w, view_h, view_css

	e.on_measure(function() {
		let r = e.view.rect()
		view_w = floor(r.w)
		view_h = floor(r.h)
		view_css = e.view.css()
	})

	function slice_color(i, n) {
		return hsl_to_rgb(((i / n) * 360 - 120) % 180, .8, .7)
	}

	renderer.stack = function() {

		let slices = pie_slices()
		if (!slices)
			return

		let stack = div({class: 'x-chart-stack'})
		let labels = div({style: 'position: absolute;'})
		e.add(stack, labels)

		return function() {
			let i = 0
			for (let slice of slices) {
				let cdiv = div({class: 'x-chart-stack-slice'})
				let sdiv = div({class: 'x-chart-stack-slice-ct'}, cdiv, slice.label)
				sdiv.style.flex = slice.size
				cdiv.style['background-color'] = slice_color(i, slices.length)
				stack.add(sdiv)
				i++
			}
		}
	}

	renderer.pie = function() {

		let slices = pie_slices()
		if (!slices)
			return

		let pie = div({class: 'x-chart-pie'})
		let labels = div({style: 'position: absolute;'})
		e.add(pie, labels)

		return function() {

			let w = e.clientWidth
			let h = e.clientHeight
			let pw = (w / h < 1 ? w : h) * .5

			pie.w = pw
			pie.h = pw
			pie.x = (w - pw) / 2
			pie.y = (h - pw) / 2

			let s = []
			let angle = 0
			let i = 0
			for (let slice of slices) {
				let arclen = slice.size * 360

				// generate a gradient step for this slice.
				let color = slice_color(i, slices.length)
				s.push(color + ' ' + angle.dec()+'deg '+(angle + arclen).dec()+'deg')

				// add the label and position it around the pie.
				labels.add(slice.label)
				let pad = 5
				let center_angle = angle + arclen / 2
				let [x, y] = point_around(w / 2, h / 2, pw / 2, center_angle - 90)
				slice.label.x = x + pad
				slice.label.y = y + pad
				let left = center_angle > 180
				let top  = center_angle < 90 || center_angle > 3 * 90
				if (left)
					slice.label.x = x - slice.label.clientWidth - pad
				if (top)
					slice.label.y = y - slice.label.clientHeight - pad

				angle += arclen
				i++
			}

			pie.style['background-image'] = 'conic-gradient(' + s.join(',') + ')'
		}
	}

	function line_color(i, n, alpha) {
		return hsl_to_rgb(((i / n) * 180 - 210) % 360, .8, .6, alpha)
	}

	function renderer_line_or_columns(columns, rotate, dots, area) {

		let canvas = tag('canvas', {
			class : 'x-chart-canvas',
			width : view_w,
			height: view_h,
		})
		e.view.set(canvas)
		let cx = canvas.getContext('2d')

		cx.font = view_css['font-size'] + ' ' + view_css.font

		let line_h; {
			let m = cx.measureText('M')
			line_h = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) * 1.5
		}

		// paddings to make room for axis markers.
		let px1 = 40
		let px2 = 10
		let py1 = round(rotate ? line_h + 5 : 10)
		let py2 = line_h * 1.5

		let hit_cg, hit_xg
		let hit_x, hit_y, hit_w, hit_h

		function hit_test_columns(mx, my) {
			let cgi = 0
			for (let cg of all_split_groups) {
				for (let xg of cg) {
					if (xg.visible) {
						let [x, y, w, h] = bar_rect(cgi, xg)
						if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
							hit_cg = cg
							hit_xg = xg
							hit_x = x
							hit_y = y
							hit_w = w
							hit_h = h
							return true
						}
					}
				}
				cgi++
			}
		}

		function hit_test_dots(mx, my) {
			let max_d2 = 16**2
			let min_d2 = 1/0
			for (let cg of all_split_groups) {
				for (let xg of cg) {
					if (xg.visible) {
						let dx = abs(mx - xg.x)
						let dy = abs(my - xg.y)
						let d2 = dx**2 + (all_split_groups.length > 1 ? dy**2 : 0)
						if (d2 <= min(min_d2, max_d2)) {
							min_d2 = d2
							hit_cg = cg
							hit_xg = xg
							hit_x = hit_xg.x
							hit_y = hit_xg.y
							hit_w = 0
							hit_h = 0
						}
					}
				}
			}
			return !!hit_cg
		}

		pointermove = function(ev, mx, my) {
			if (!all_split_groups)
				return
			let r = canvas.rect()
			mx -= r.x
			my -= r.y
			let cxm = cx.getTransform().translate(px1, py1)
			let mp = new DOMPoint(mx, my).matrixTransform(cxm.invertSelf())
			mx = mp.x
			my = mp.y
			hit_cg = null
			hit_xg = null
			let hit = columns ? hit_test_columns(mx, my) : hit_test_dots(mx, my)
			if (hit) {
				let er = e.rect()
				tt = tt || tooltip({
					target: e,
					align   : 'center',
					kind    : 'info',
					classes : 'x-chart-tooltip',
					check   : function() { return this.hit }
				})
				tt.side = rotate ? 'right' : 'top'

				let sum_fld = hit_cg.sum_def.field
				let s = e.nav.cell_display_val_for(null, sum_fld, hit_xg.sum)
				let key_flds = e.nav.flds(hit_xg.key_cols)
				let key_flds_align = key_flds.length > 1 ? 'start' : key_flds[0].align
				tt.text = div({class: 'x-chart-tooltip-label'},
					div(0, hit_xg.key_cols),
					div({style: 'justify-self: '+key_flds_align}, TC(hit_xg.text)),
					div(0, sum_fld.text),
					div({style: 'justify-self: '+sum_fld.align}, s)
				)

				let tm = cx.getTransform()
					.translate(px1, py1)
					.translate(r.x - er.x, r.y - er.y)
				let p1 = new DOMPoint(hit_x        , hit_y        ).matrixTransform(tm)
				let p2 = new DOMPoint(hit_x + hit_w, hit_y + hit_h).matrixTransform(tm)
				let p3 = new DOMPoint(hit_x + hit_w, hit_y        ).matrixTransform(tm)
				let p4 = new DOMPoint(hit_x        , hit_y + hit_h).matrixTransform(tm)
				let x1 = min(p1.x, p2.x, p3.x, p4.x)
				let y1 = min(p1.y, p2.y, p3.y, p4.y)
				let x2 = max(p1.x, p2.x, p3.x, p4.x)
				let y2 = max(p1.y, p2.y, p3.y, p4.y)
				tt.px = x1
				tt.py = y1
				tt.pw = x2 - x1
				tt.ph = y2 - y1
				tt.hit = true
			} else if (tt) {
				tt.hit = false
				tt.update()
			}
			e.update()
		}

		return function() {

			let w = view_w
			let h = view_h

			canvas.resize(w, h, 100, 100)
			cx.clear()
			cx.save()

			// compute vertical (sum) and horizontal (val) ranges.
			// also compute a map of
			let xgs = map() // {x_key -> xg}
			let min_val  = 0
			let max_val  = 1
			let min_sum  = 0
			let max_sum  = 1
			let sum_step = 1
			if (all_split_groups) {
				min_val =  1/0
				max_val = -1/0
				min_sum =  1/0
				max_sum = -1/0
				let user_min_val = or(e.min_val, -1/0)
				let user_max_val = or(e.max_val,  1/0)
				for (let cg of all_split_groups) {
					for (let xg of cg) {
						let sum = xg.sum
						let val = xg.key_vals[0] // TODO: only works for numbers!
						min_sum = min(min_sum, sum)
						max_sum = max(max_sum, sum)
						min_val = min(min_val, val)
						max_val = max(max_val, val)
						xg.visible = val >= user_min_val && val <= user_max_val
						xgs.set(val, xg)
					}
				}
			}

			// clip/stretch ranges to given fixed values.
			min_val  = or(e.min_val, min_val)
			max_val  = or(e.max_val, max_val)
			min_sum  = or(e.min_sum, min_sum)
			max_sum  = or(e.max_sum, max_sum)

			if (columns && all_split_groups) {
				let val_unit = (max_val - min_val) / xgs.size
				min_val -= val_unit / 2
				max_val += val_unit / 2
			}

			// compute min, max and step of y-axis markers so that 1) the step is
			// on a module and the spacing between lines is the closest to an ideal.
			if (sum_defs) {
				let y_spacing = rotate ? 80 : 40 // wanted space between y-axis markers
				let target_n = round(h / y_spacing) // wanted number of y-axis markers
				let fld = sum_defs[0].field
				;[sum_step, min_sum, max_sum] =
					compute_step_and_range(target_n, min_sum, max_sum, fld.scale_base, fld.scales, fld.decimals)
			}

			// compute min, max and step of x-axis markers so that 1) the step is
			// on a module and the spacing between markers is the closest to an ideal.
			let val_step; {
				let min_w = 20    // min element width
				let max_n = max(1, floor(w / min_w)) // max number of elements
				;[val_step, min_val, max_val] = compute_step_and_range(max_n, min_val, max_val)
			}

			w -= px1 + px2
			h -= py1 + py2
			cx.translate(px1, py1)

			if (rotate) {
				cx.translate(w, 0)
				cx.rotate(rad * 90)
				;[w, h] = [h, w]
			}

			// compute polygon's points.
			if (all_split_groups)
				for (let cg of all_split_groups) {
					let xgi = 0
					for (let xg of cg) {
						let val = xg.key_vals[0]
						xg.x = round(lerp(val, min_val, max_val, 0, w))
						xg.y = round(lerp(xg.sum, min_sum, max_sum, h - py2, 0))
						if (xg.y != xg.y)
							xg.y = xg.sum
						xgi++
					}
				}

			// draw x-axis labels & reference lines.

			let ref_line_color = view_css.prop('--x-border-light')
			let label_color    = view_css.prop('--x-fg-label')
			cx.fillStyle   = label_color
			cx.strokeStyle = ref_line_color

			function draw_xaxis_label(xg_x, text) {
				let m = cx.measureText(text)
				cx.save()
				if (rotate) {
					let text_h = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent
					let x = round(xg_x + text_h / 2)
					let y = h + m.width
					cx.translate(x, y)
					cx.rotate(rad * -90)
				} else {
					let x = xg_x - m.width / 2
					let y = round(h)
					cx.translate(x, y)
				}
				cx.fillText(text, 0, 0)
				cx.restore()
				// draw x-axis center line marker.
				cx.beginPath()
				cx.moveTo(xg_x + .5, h - py2 + 0.5)
				cx.lineTo(xg_x + .5, h - py2 + 4.5)
				cx.stroke()
			}

			// draw x-axis labels.

			let discrete = e.min_val == null || e.max_val == null
			if (discrete) {
				let i = 0
				for (let xg of xgs.values()) {
					if (i % val_step == 0 && xg.visible) {
						// TODO: draw the element as a html overlay
						let text = isnode(xg.text) ? xg.text.textContent : xg.text
						draw_xaxis_label(xg.x, text)
					}
					i++
				}
			} if (group_cols) {
				for (let val = min_val; val <= max_val; val += val_step) {
					let text = val_text(val)
					let x = round(lerp(val, min_val, max_val, 0, w))
					draw_xaxis_label(x, text)
				}
			}

			// draw y-axis labels & reference lines.

			if (sum_defs)
				for (let sum = min_sum; sum <= max_sum; sum += sum_step) {
					// draw y-axis label.
					let y = round(lerp(sum, min_sum, max_sum, h - py2, 0))
					let s = sum_label(null, null, sum)
					s = isnode(s) ? s.textContent : s
					let m = cx.measureText(s)
					let text_h = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent
					cx.save()
					if (rotate) {
						let px = -5
						let py = round(y + m.width / 2)
						cx.translate(px, py)
						cx.rotate(rad * -90)
					} else {
						let px = -m.width - 10
						let py = round(y + text_h / 2)
						cx.translate(px, py)
					}
					cx.fillText(s, 0, 0)
					cx.restore()
					// draw y-axis strike-through line marker.
					cx.strokeStyle = ref_line_color
					cx.beginPath()
					cx.moveTo(0 + .5, y - .5)
					cx.lineTo(w + .5, y - .5)
					cx.stroke()
				}

			// draw the axis.
			cx.strokeStyle = ref_line_color
			cx.beginPath()
			// y-axis
			cx.moveTo(.5, round(lerp(min_sum, min_sum, max_sum, h - py2, 0)) + .5)
			cx.lineTo(.5, round(lerp(max_sum, min_sum, max_sum, h - py2, 0)) + .5)
			// x-axis
			cx.moveTo(round(lerp(min_val, min_val, max_val, 0, w)) + .5, round(h - py2) - .5)
			cx.lineTo(round(lerp(max_val, min_val, max_val, 0, w)) + .5, round(h - py2) - .5)
			cx.stroke()

			if (columns) {

				let cn = all_split_groups.length
				let bar_w = round(w / (xgs.size - 1) / cn / 3)
				let half_w = round((bar_w * cn + 2 * (cn - 1)) / 2)

				function bar_rect(cgi, xg) {
					let x = xg.x
					let y = xg.y
					return [
						x + cgi * (bar_w + 2) - half_w,
						y,
						bar_w,
						h - py2 - y
					]
				}
			}

			// draw the chart lines or columns.

			if (all_split_groups) {

				cx.rect(0, 0, w, h)
				cx.clip()

				let cgi = 0
				for (let cg of all_split_groups) {

					let color = line_color(cgi, all_split_groups.length)

					if (columns) {

						cx.fillStyle = color
						for (let xg of cg) {
							let [x, y, w, h] = bar_rect(cgi, xg)
							cx.beginPath()
							cx.rect(x, y, w, h)
							cx.fill()
						}

					} else {

						// draw the line.

						if (!cg.tied_back)
							cx.beginPath()

						let x0, x
						for (let xg of (cg.tied_back ? cg.reverse() : cg)) {
							x = xg.x
							if (x0 == null && !cg.tied_back) {
								x0 = x
								cx.moveTo(x + .5, xg.y + .5)
							} else {
								cx.lineTo(x + .5, xg.y + .5)
							}
						}

						if (area && !cg.tied && !cg.tied_back) {
							cx.lineTo(x  + .5, h - py2 + .5)
							cx.lineTo(x0 + .5, h - py2 + .5)
							cx.closePath()
						}

						if (area && !cg.tied) {
							cx.fillStyle = line_color(cgi, all_split_groups.length, .5)
							cx.fill()
						}

						cx.strokeStyle = color
						cx.stroke()

						// draw a dot on each line cusp.
						if (dots) {
							cx.fillStyle = cx.strokeStyle
							for (let xg of cg) {
								cx.beginPath()
								cx.arc(xg.x, xg.y, 3, 0, 2*PI)
								cx.fill()
							}
						}

					}

					cgi++
				}

				// draw the hit line.

				if (hit_cg) {
					cx.beginPath()
					cx.moveTo(hit_x + .5, .5)
					cx.lineTo(hit_x + .5, h - py2 + 4.5)
					cx.strokeStyle = label_color
					cx.setLineDash([3, 2])
					cx.stroke()
					cx.setLineDash(empty_array)
				}

			}

			cx.restore()

		}

	}

	renderer.line      = () => renderer_line_or_columns()
	renderer.line_dots = () => renderer_line_or_columns(false, false, true)
	renderer.area      = () => renderer_line_or_columns(false, false, false, true)
	renderer.area_dots = () => renderer_line_or_columns(false, false, true, true)
	renderer.column    = () => renderer_line_or_columns(true)
	renderer.bar       = () => renderer_line_or_columns(true, true)

	e.on_update(function() {
		e.header.set(e.text)
	})

	let shape, render
	e.on_position(function() {
		if (shape != e.shape) {
			render = null
			pointermove = noop
			shape = e.shape
		}
		if (!render)
			render = renderer[e.shape]()
		render()
	})

	e.on('pointermove' , function(...args) { pointermove(...args) })
	e.on('pointerleave', function(...args) { pointermove(...args) })

	// data binding -----------------------------------------------------------

	function bind_nav(nav, on) {
		if (!e.bound)
			return
		if (!nav)
			return
		nav.on('reset'               , update_model, on)
		nav.on('rows_changed'        , update_model, on)
		nav.on('cell_state_changed'  , update_model, on)
		nav.on('display_vals_changed', update_model, on)
		if (on)
			update_model()
	}

	function update_view() {
		e.update()
	}

	e.on('bind', function(on) {
		bind_nav(e.nav, on)
		document.on('layout_changed', update_view, on)
		if (!on && tt) {
			tt.close()
			tt = null
		}
	})

	e.on('resize', update_view)

	e.set_nav = function(nav1, nav0) {
		assert(!nav1 || nav1.isnav)
		bind_nav(nav0, false)
		bind_nav(nav1, true)
	}

	e.prop('nav', {private: true})
	e.prop('nav_id', {bind_id: 'nav', type: 'nav'})

})

