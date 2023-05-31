/*

	Chart widgets.
	Written by Cosmin Apreutesei. Public Domain.

You must load first:

	nav.js

WIDGETS

	<chart>

SHAPES

	stack
	pie
	line line_dots area area_dots
	column
	bar

*/

(function () {
"use strict"
let G = window


css('.chart', 'S shrinks p clip v')

css('.chart-header', '', `
	padding-left: 40px;
`)

css('.chart-split', 'S h')

css('.chart-view', 'S rel h')

css('.chart-legend', 'g-h arrow gap-y-05 gap-x', `
	grid-template-columns: 1em 1fr;
	align-content: end;
	margin-left: 2em;
`)

css('.chart-legend-bullet', 'round', `
	width : .8em;
	height: .8em;
`)

css('.chart-legend-percent', 'bold self-h-r')

css('.chart-canvas', 'abs', `
	top: 0;
	left: 0;
`)

css('.chart-tooltip', 'click-through')

css('.chart-tooltip > .tooltip-body', 'tight')

css('.chart-tooltip-label', 'g-h gap-x-2', `
	grid-template-columns: repeat(2, auto);
	justify-items: start;
`)

css('.chart-stack', 'S v')
css('.chart-stack-slice-ct', 'rel h')

css('.chart-stack-slice', 'm-r', `
	width: 50px;
`)

css('.chart[shape=pie] .chart-split', 'h-c')

css('.chart[shape=pie] .chart-view', '', `
	max-width : 15em;
	min-height: 15em;
`)

css('.chart[shape=pie] .chart-legend', '', `
	grid-template-columns: 1em 5fr 1fr;
	align-content: center;
`)

css('.chart[shape=lines] .chart-view', '', `
	min-height: 10em;
`)

css('.chart[shape=lines] .chart-legend', 'm-l-2 m-b-4')

css('.chart-pie', 'abs')

css('.chart-pie-selected', 'abs round')

css('.chart-pie-percents', 'abs click-through', `
	top: 0;
	left: 0;
`)

css('.chart-pie-label', 'abs on-dark')

G.chart = component('chart', 'Input', function(e) {

	e.class('chart unframe')
	e.make_disablable()

	// data binding -----------------------------------------------------------

	make_nav_data_widget_extend_before(e)
	e.make_nav_data_widget()

	let nav
	e.on('bind_nav', function(nav1, on) {
		nav = on ? nav1 : null
		update_model()
	})

	function nav_changed(nav1) {
		if (nav1 != nav) return
		update_model()
	}

	e.listen('reset'                , nav_changed)
	e.listen('rows_changed'         , nav_changed)
	e.listen('cell_state_changed'   , nav_changed)
	e.listen('col_vals_changed'     , nav_changed)
	e.listen('col_attr_changed'     , nav_changed)

	function update_view() {
		e.update()
	}

	e.listen('layout_changed', update_view)
	e.on('resize', update_view)

	// config -----------------------------------------------------------------

	e.prop('split_cols' , {type: 'col'})
	e.prop('group_cols' , {type: 'col'})
	e.prop('sum_cols'   , {type: 'col'})
	e.prop('min_sum'    , {type: 'number'})
	e.prop('max_sum'    , {type: 'number'})
	e.prop('sum_step'   , {type: 'number'})
	e.prop('min_val'    , {type: 'number'})
	e.prop('max_val'    , {type: 'number'})
	e.prop('other_threshold', {type: 'number', default: .05, decimals: null})
	e.prop('other_text' , {default: 'Other', slot: 'lang'})
	e.prop('shape', {
		type: 'enum',
		enum_values: ['pie', 'stack', 'line', 'line_dots', 'area', 'area_dots',
			'column', 'bar', 'stackbar', 'bubble', 'scatter'],
		default: 'pie',
	})
	e.prop('nolegend', {type: 'bool', default: false})
	e.prop('text', {slot: 'lang'})

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
					if (step_multiple == null || floor(step1 / step_multiple) == step1 / step_multiple) {
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

		if (!nav) return
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
			let fld = nav.optfld(col)
			if (fld) // it's enough for one sum_col to be valid.
				sum_defs.push({field: fld, tied: tied, tied_back: tied_back, agg: agg})
			tied_back = fld ? tied : false
		}
		if (!sum_defs.length)
			return

		group_cols = words(e.group_cols).map(s => s.match(/^[^/]+/)[0])
		if (!group_cols.length)
			return

		if (!nav.rows.length)
			return true

		// group rows and compute the sums on each group.
		// all_split_groups : [split_group1, ...]   split groups (cgs) => superimposed graphs.
		// split_group      : [row_group1, ...]     row groups (xgs) => one graph of sum points.
		// row_group        : [row1, ...]           each row group => one sum point.
		all_split_groups = []
		for (let sum_def of sum_defs) {

			let split_groups = nav.row_groups({
				col_groups : catany('>', e.split_cols, e.group_cols),
				rows       : nav.rows,
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

		e.g = all_split_groups // for inspecting the model

		return true
	}

	function update_model() {
		reset_model()
		if (!try_update_model())
			reset_model()
		e.update({model: true})
	}

	// compute label for a sum point.
	function sum_label(cls, label, sum) {
		let sum_fld = sum_defs[0].field
		let a = []
		if (label)
			a.push(label)
		a.push(nav.draw_val(null, sum_fld, sum))
		return a.join_nodes(tag('br'), cls && div({class: cls}))
	}

	function val_text(val) {
		let val_fld = nav.fld(group_cols[0]) // TODO: only works for single-col groups!
		return nav.draw_val(null, val_fld, val)
	}

	function pie_slices() {

		if (!all_split_groups)
			return

		let groups = all_split_groups[0]

		let slices = []
		slices.total = 0
		for (let group of groups) {
			let slice = {}
			let sum = group.sum
			slice.sum = sum
			slice.label = group.label
			slices.push(slice)
			slices.total += sum
			slices.key_cols = group.key_cols
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
			other_slice.label = e.other_text
			big_slices.push(other_slice)
		}

		for (let slice of big_slices)
			slice.percent = (slice.size * 100).dec(0) + '%'

		big_slices.key_cols_label = nav.fldlabels(slices.key_cols).join_nodes(' / ')
		big_slices.sum_field = groups.sum_def.field

		return big_slices
	}

	// view -------------------------------------------------------------------

	e.header = div({class: 'chart-header'})
	e.view   = div({class: 'chart-view'})
	e.legend = div({class: 'chart-legend'})
	e.add(e.header, div({class: 'chart-split'}, e.view, e.legend))

	e.set_nolegend = function(v) {
		e.legend.hide(v)
	}

	// shape dispatcher

	let renderer = obj() // {shape->cons()}
	let do_update
	let do_measure
	let do_position
	let pointermove = noop

	let shape
	e.on_update(function(opt) {
		e.header.set(e.text)
		if (shape != e.shape) {
			if (tt) {
				tt.del()
				tt = null
			}
			pointermove = noop
			shape = e.shape
			let init_renderer = renderer[shape]
			if (init_renderer)
				init_renderer()
		}
		if (do_update)
			do_update(opt)
	})

	let view_w, view_h, view_css, font

	e.on_measure(function() {
		let r = e.view.rect()
		view_w = floor(r.w)
		view_h = floor(r.h)
		view_css = e.view.css()
		font = view_css['font-size'] + ' ' + view_css.font
		if (do_measure)
			do_measure()
	})

	e.on_position(function() {
		if (do_position)
			do_position()
	})

	e.on('pointermove' , function(...args) { pointermove(...args) })
	e.on('pointerleave', function(...args) { pointermove(...args) })

	// common functionality

	function split_color(i, n, alpha) {
		return hsl_to_rgb(((i / n) * 360 - 120) % 360, .8, .6, alpha)
	}

	let legend_hit_slice

	function update_legend_slices(slices) {
		let i = 0
		e.legend.clear()
		if (e.nolegend)
			return
		for (let slice of slices) {
			let color = split_color(i, slices.length)
			let bullet = div({
					class: 'chart-legend-bullet',
					style: 'background-color: '+color,
				})
			let label   = div({class: 'chart-legend-label'}, slice.label)
			let percent = div({class: 'chart-legend-percent'}, slice.percent)
			e.legend.add(bullet, label, percent)
			label.on('pointerenter', function() {
				legend_hit_slice = slice
				e.update()
			})
			label.on('pointerleave', function() {
				legend_hit_slice = null
				e.update()
			})
			i++
		}
	}

	let legend_hit_cg

	function update_legend_split_groups() {
		let cgi = 0
		e.legend.clear()
		if (e.nolegend)
			return
		let groups = all_split_groups
		for (let cg of groups) {
			let color = split_color(cgi, groups.length)
			let bullet = div({
					class: 'chart-legend-bullet',
					style: 'background-color: '+color,
				})
			let label = div({class: 'chart-legend-label'}, TC(cg.label))
			e.legend.add(bullet, label)
			label.on('pointerenter', function() {
				legend_hit_cg = cg
				e.update()
			})
			label.on('pointerleave', function() {
				legend_hit_cg = null
				e.update()
			})
			cgi++
		}
	}

	renderer.stack = function() {

		let slices = pie_slices()
		if (!slices)
			return

		let stack = div({class: 'chart-stack'})
		e.view.add(stack)

		do_update = function(opt) {
			if (opt.model) {
				stack.clear()
				e.legend.clear()
				if (!all_split_groups)
					return
				let i = 0
				for (let slice of slices) {
					let cdiv = div({class: 'chart-stack-slice'})
					let sdiv = div({class: 'chart-stack-slice-ct'}, cdiv,
						slice.label, unsafe_html('&nbsp;-&nbsp;'), slice.percent)
					sdiv.style.flex = slice.size
					cdiv.style['background-color'] = split_color(i, slices.length)
					stack.add(sdiv)
					i++
				}
			}
		}

	}

	let tt

	renderer.pie = function() {

		let slices = pie_slices()
		if (!slices)
			return

		let pie = svg({class: 'chart-pie', viewBox: '-1.1 -1.1 2.2 2.2'})
		let percent_divs = div({class: 'chart-pie-percents'})
		e.attr('shape', 'pie')
		e.view.add(pie, percent_divs)

		let hit_slice

		pie.on('pointermove', function(ev, mx, my) {
			let path = ev.target
			hit_slice = path.slice
			e.update({tooltip: true})
		})

		pie.on('pointerleave', function(ev, mx, my) {
			hit_slice = null
			e.update({tooltip: true})
		})

		do_update = function(opt) {
			if (opt.model) {

				// create pie.
				let angle = 0
				let i = 0
				pie.clear()
				for (let slice of slices) {
					let arclen = slice.size * 360
					let color = split_color(i, slices.length)

					let slice_path = pie.path({
						d: 'M 0 0 '
							+ svg_arc_path(0, 0, 1, angle + arclen - 90, angle - 90, 'L')
							+ ' Z',
						fill: color,
						stroke: 'white',
						['stroke-width']: 1,
						['vector-effect']: 'non-scaling-stroke',
					})
					slice_path.slice = slice

					let selection_path = pie.path({
						d: svg_arc_path(0, 0, 1.05, angle + arclen - 90, angle - 90, 'M'),
						fill: 'none',
						stroke: split_color(i, slices.length, .6),
						['stroke-width']: .08,
					})
					slice.selection_path = selection_path

					// compute the percent div's unscaled position inside the pie.
					let center_angle = angle + arclen / 2
					;[slice.percent_div_x, slice.percent_div_y] =
						point_around(0, 0, .65, center_angle - 90)

					;[slice.center_x, slice.center_y] =
						point_around(0, 0, .5, center_angle - 90)

					angle += arclen
					i++
				}

				// create percent divs.
				percent_divs.clear()
				for (let slice of slices) {
					if (slice.size > 0.05) {
						slice.percent_div = div({class: 'chart-pie-label'}, slice.percent)
						percent_divs.add(slice.percent_div)
					}
				}

				update_legend_slices(slices)
			}

			if (opt.tooltip) {
				if (hit_slice) {
					if (!tt) {
						tt = tooltip({
							target  : pie,
							align   : 'center',
							side    : 'inner-center',
							kind    : 'info',
							classes : 'chart-tooltip',
						})
						e.view.add(tt)
						tt.key_cols_div = div()
						tt.sum_cols_div = div()
						tt.key_div = div({style: 'justify-self: end'})
						tt.sum_div = div({style: 'justify-self: end'})
						tt.text = div({class: 'chart-tooltip-label'},
							tt.key_cols_div, tt.key_div,
							tt.sum_cols_div, tt.sum_div
						)
					}

					let s = nav.draw_val(null, slices.sum_field, hit_slice.sum)

					tt.key_cols_div.set(slices.key_cols_label)
					tt.sum_cols_div.set(slices.sum_field.label)
					tt.key_div.set(TC(hit_slice.label))
					tt.sum_div.set([s, ' (', tag('b', 0, hit_slice.percent), ')'])

					tt.update({show: true})
				} else if (tt) {
					tt.update({show: false})
				}
			}

		}

		do_measure = function() {
			// measure percent divs
			for (let slice of slices) {
				if (slice.percent_div) {
					slice.percent_div_w = slice.percent_div.cw
					slice.percent_div_h = slice.percent_div.ch
				}
			}
		}

		do_position = function() {

			let r = min(view_w, view_h) / 2
			let x = view_w / 2 - r
			let y = view_h / 2 - r

			// size and position the pie
			pie.w = r * 2
			pie.h = r * 2
			pie.style.left = px(x)
			pie.style.top  = px(y)

			// position percent divs
			let i = 0
			for (let slice of slices) {
				if (slice.percent_div) {
					slice.percent_div.x = x + r + slice.percent_div_x * r - slice.percent_div_w / 2
					slice.percent_div.y = y + r + slice.percent_div_y * r - slice.percent_div_h / 2
				}
				slice.selection_path.style.display = 'none'
				i++
			}

			if (hit_slice || legend_hit_slice) {
				let sel_path = (hit_slice || legend_hit_slice).selection_path
				sel_path.style.display = 'block'
			}

			if (hit_slice) {
				tt.popup_ox = hit_slice.center_x * r
				tt.popup_oy = hit_slice.center_y * r
			}

		}
	}

	function renderer_line_or_columns(columns, rotate, dots, area) {

		let ct = resizeable_canvas_container()
		let cx = ct.context

		e.view.set(ct)

		e.attr('shape', 'lines')

		let line_h; {
			let m = cx.measureText('M')
			line_h = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) * 1.5
		}

		// paddings to make room for axis markers.
		let px1 = 40
		let px2 = 10
		let py1 = round(rotate ? line_h + 5 : 10)
		let py2 = line_h * 1.5

		let bar_rect
		let hit_mx, hit_my
		let hit_cg, hit_xg
		let hit_x, hit_y, hit_h

		function hit_test_columns(mx, my) {
			let cgi = 0
			for (let cg of all_split_groups) {
				for (let xg of cg) {
					if (xg.visible) {
						let [x, y, w, h] = bar_rect(cgi, xg)
						if (mx >= x && mx <= x + w) {
							hit_cg = cg
							hit_xg = xg
							hit_x = x + w / 2
							hit_y = y
							hit_h = h
							legend_hit_cg = null
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
							hit_h = 0
							legend_hit_cg = null
						}
					}
				}
			}
			return !!hit_cg
		}

		pointermove = function(ev, mx, my) {
			if (!all_split_groups)
				return
			let r = ct.rect()
			mx -= r.x + px1
			my -= r.y + py1
			if (rotate)
				[mx, my] = [my, mx]
			hit_mx = mx
			hit_my = my
			hit_x = null
			hit_y = null
			hit_cg = null
			hit_xg = null
			let hit = columns ? hit_test_columns(mx, my) : hit_test_dots(mx, my)
			if (hit) {

				if (!tt) {
					tt = tooltip({
						align   : 'center',
						kind    : 'info',
						classes : 'chart-tooltip',
					})
					e.view.add(tt)
					tt.spl_cols_div = div()
					tt.key_cols_div = div()
					tt.sum_cols_div = div()
					tt.spl_div = div({style: 'justify-self: end'})
					tt.key_div = div({style: 'justify-self: end'})
					tt.sum_div = div({style: 'justify-self: end'})
					tt.text = div({class: 'chart-tooltip-label'},
						tt.spl_cols_div, tt.spl_div,
						tt.key_cols_div, tt.key_div,
						tt.sum_cols_div, tt.sum_div
					)
				}
				tt.side = rotate ? 'right' : 'top'

				let spl_flds = nav.flds(hit_cg.key_cols)
				let key_flds = nav.flds(hit_xg.key_cols)
				let spl_cols = spl_flds.map(f => f.label).join_nodes(' / ')
				let key_cols = key_flds.map(f => f.label).join_nodes(' / ')

				let sum_fld  = hit_cg.sum_def.field
				let s = nav.draw_val(null, sum_fld, hit_xg.sum)

				tt.spl_cols_div.set(spl_cols)
				tt.key_cols_div.set(key_cols)
				tt.spl_div.set(hit_cg.label)
				tt.key_div.set(TC(hit_xg.label))
				tt.sum_cols_div.set(sum_fld.label)
				tt.sum_div.set(s)

				let p1x = hit_x
				let p1y = hit_y
				let p2x = hit_x
				let p2y = hit_y + hit_h
				let p3x = hit_x
				let p3y = hit_y
				let p4x = hit_x
				let p4y = hit_y + hit_h
				let x1 = min(p1x, p2x, p3x, p4x)
				let y1 = min(p1y, p2y, p3y, p4y)
				let x2 = max(p1x, p2x, p3x, p4x)
				let y2 = max(p1y, p2y, p3y, p4y)
				if (rotate) {
					;[x1, y1] = [y1, x1]
					;[x2, y2] = [y2, x2]
					;[x2, x1] = [x1, x2]
					x1 = view_w - x1 - px1 - px2
					x2 = view_w - x2 - px1 - px2
				}
				tt.popup_x1 = x1 + px1
				tt.popup_y1 = y1 + py1
				tt.popup_x2 = x2 + px1
				tt.popup_y2 = y2 + py1
				tt.update({show: true})
			} else if (tt) {
				tt.update({show: false})
			}
			e.update()
		}

		do_update = function(opt) {
			if (opt.model)
				update_legend_split_groups()
			ct.update()
		}
		do_measure = null
		do_position = null

		let xgs = map()
		ct.on_redraw(function(cx, view_w, view_h) {

			cx.font = font

			let discrete = columns || e.min_val == null || e.max_val == null

			let w = view_w - (px1 + px2)
			let h = view_h - (py1 + py2)

			cx.translate(px1, py1)

			if (rotate) {
				cx.translate(w, 0)
				cx.rotate(rad * 90)
				;[w, h] = [h, w]
			}

			// compute vertical (sum) and horizontal (val) ranges.
			// also create a map of descrete x-values for drawing as x-axis labels.
			xgs.clear() // {x_key -> xg}
			let min_val  = 0
			let max_val  = 1
			let val_step
			let min_sum  = 0
			let max_sum  = 1
			let sum_step = e.sum_step || 1
			if (all_split_groups) {
				min_val =  1/0
				max_val = -1/0
				min_sum =  1/0
				max_sum = -1/0
				let user_min_val = e.min_val ?? -1/0
				let user_max_val = e.max_val ??  1/0
				for (let cg of all_split_groups) {
					for (let xg of cg) {
						let sum = xg.sum
						let key_flds = nav.flds(xg.key_cols)
						let val = xg.key_vals[0]
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
			min_val = e.min_val ?? min_val
			max_val = e.max_val ?? max_val
			min_sum = e.min_sum ?? min_sum
			max_sum = e.max_sum ?? max_sum

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
					compute_step_and_range(target_n, min_sum, max_sum,
						fld.scale_base, fld.scales, fld.decimals)
			}

			let min_elem_w = 60

			// compute min, max and step of x-axis markers so that 1) the step is
			// on a module and the spacing between markers is the closest to an ideal.
			if (!discrete) {
				let max_n = max(1, floor(w / min_elem_w)) // max number of elements
				;[val_step, min_val, max_val] = compute_step_and_range(max_n, min_val, max_val)
			}

			// compute polygon's points.
			if (all_split_groups)
				for (let cg of all_split_groups) {
					let xgi = 0
					let y0 = h - py2
					for (let xg of cg) {
						let key_flds = nav.flds(xg.key_cols)
						let val = xg.key_vals[0]
						xg.x = round(lerp(val, min_val, max_val, 0, w))
						xg.y = round(lerp(xg.sum, min_sum, max_sum, h - py2, 0))
						if (xg.y != xg.y) // NaN (x/0 from lerp)
							xg.y = xg.sum
						xgi++
					}
				}

			// draw x-axis labels & reference lines.

			let ref_line_color = view_css.prop('--border-light')
			let label_color    = view_css.prop('--fg-label')
			cx.fillStyle   = label_color
			cx.strokeStyle = ref_line_color

			function draw_xaxis_label(xg_x, text, is_first, is_last) {
				let m = cx.measureText(text)
				cx.save()
				if (rotate) {
					let text_h = m.actualBoundingBoxAscent - m.actualBoundingBoxDescent
					let x = round(xg_x + text_h / 2)
					let y = h + m.width
					cx.translate(x, y)
					cx.rotate(rad * -90)
				} else {
					let x = is_first ? xg_x : is_last ? xg_x - m.width : xg_x - m.width / 2
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

			if (discrete) {
				let i = 0
				let n = xgs.size
				let xg0
				for (let xg of xgs.values()) {
					if (xg.visible && (!xg0 || (xg.x - xg0.x) >= min_elem_w)) {
						// TODO: draw the element as a html overlay
						let text = isnode(xg.label) ? xg.label.textContent : xg.label
						draw_xaxis_label(xg.x, text, i == 0, i == n-1)
						xg0 = xg
					}
					i++
				}
			} else {
				for (let val = min_val; val <= max_val; val += val_step) {
					let text = val_text(val)
					let x = round(lerp(val, min_val, max_val, 0, w))
					draw_xaxis_label(x, text, val == min_val, !(val + val_step <= max_val))
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

			let cn = all_split_groups.length
			let bar_w = round(w / (xgs.size - 1) / cn / 3)
			let half_w = round((bar_w * cn + 2 * (cn - 1)) / 2)
			bar_rect = function(cgi, xg) {
				return [
					xg.x + cgi * (bar_w + 2) - half_w,
					xg.y,
					bar_w,
					h - py2 - xg.y
				]
			}

			// draw the chart lines or columns.

			if (all_split_groups) {

				if (hit_mx < 0 || hit_mx > w)
					hit_mx = null

				cx.rect(0, 0, w, h)

				let cgi = 0
				for (let cg of all_split_groups) {

					let color = split_color(cgi, all_split_groups.length)

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

						cx.lineWidth = cg == legend_hit_cg ? 2 : 1

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
							cx.fillStyle = split_color(cgi, all_split_groups.length,
								legend_hit_cg == cg ? .7 : .5)
							cx.fill()
						}

						cx.strokeStyle = color
						cx.stroke()

						cx.fillStyle = cx.strokeStyle
						let xg_x0 = 0
						let xg_y0 = 0
						for (let xg of cg) {

							// draw a dot on each line cusp.
							if (dots) {
								cx.beginPath()
								cx.arc(xg.x, xg.y, 3, 0, 2*PI)
								cx.fill()
							}

							// draw a dot where intersecting the extrapolator line.
							if (hit_mx != null && !hit_cg) {
								if (hit_mx >= xg_x0 && hit_mx <= xg.x) {
									cx.fillStyle = cx.strokeStyle
									cx.beginPath()
									let y = lerp(hit_mx, xg_x0, xg.x, xg_y0, xg.y)
									cx.arc(hit_mx, y, 3, 0, 2*PI)
									cx.fill()
								}
								xg_x0 = xg.x
								xg_y0 = xg.y
							}

						}

					}

					cgi++
				}

				if (hit_cg) {
					// draw the hit line.
					cx.beginPath()
					cx.moveTo(hit_x + .5, .5)
					cx.lineTo(hit_x + .5, h - py2)
					cx.strokeStyle = label_color
					cx.setLineDash([3, 2])
					cx.stroke()
					cx.setLineDash(empty_array)
				} else if (hit_mx != null) {
					// draw the extrapolator line.
					cx.beginPath()
					cx.moveTo(hit_mx + .5, .5)
					cx.lineTo(hit_mx + .5, h - py2)
					cx.strokeStyle = label_color
					cx.setLineDash([3, 2])
					cx.stroke()
					cx.setLineDash(empty_array)
				}

			}

		})

	}

	renderer.lines      = () => renderer_line_or_columns()
	renderer.lines_dots = () => renderer_line_or_columns(false, false, true)
	renderer.areas      = () => renderer_line_or_columns(false, false, false, true)
	renderer.areas_dots = () => renderer_line_or_columns(false, false, true , true)
	renderer.columns    = () => renderer_line_or_columns(true)
	renderer.bars       = () => renderer_line_or_columns(true , true)

})


}()) // module function
