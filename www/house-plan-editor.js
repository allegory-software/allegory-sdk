(function () {
"use strict"
const G = window

const {bbox2, line2} = Math3D

// view utils ----------------------------------------------------------------

let out = []

let floor_names = [
	'GROUND FLOOR',
	'1ˢᵗ FLOOR',
	'2ⁿᵈ FLOOR',
	'3ʳᵈ FLOOR',
]

let format_length = d => format_kcount(d / 1e2, 2)+'m'
let format_area = a => format_kcount(abs(a) / 1e4, 2)+' m\u00b2'

function seg_center(seg) {
	return line2.at(.5, seg[0][0], seg[0][1], seg[1][0], seg[1][1], out)
}

// shared scale --------------------------------------------------------------

function scaler(name) {
	let s = {}
	let line_width = 2 // thickness of wall line stroke in pixels at 1:1 scale
	let scale, margin
	s.d = d => round(d * scale)
	s.x = x => round(x * scale)
	s.y = y => round(y * scale)
	s.plan_x = x => x / scale
	s.plan_y = y => y / scale
	s.plan_d = d => d / scale
	s.transform = function(cx, w, h) {
		if (s.rotation) {
			let xc = round(w / 2)
			let yc = round(h / 2)
			cx.translate(xc, yc)
			cx.rotate(s.rotation)
			cx.translate(-xc, -yc)
		}
		cx.translate(s.x0, s.y0)
	}
	function set_scale(sc) {
		scale = sc
		s.scale = sc
		// snap line width to an even number for sharpness
		s.line_width = snap(line_width * sc, 2)
	}
	let bb = bbox2()
	s.scale_to_fit = function(bb1, w, h) {
		if (s.zoomed) return
		if (bb1[0] > bb1[2]) {
			set_scale(1)
			if (!s.panned) {
				s.x0 = round(w / 2)
				s.y0 = round(h / 2)
			}
			return
		}
		let margin = ceil(ui.em(2) + line_width)
		w -= 2 * margin
		h -= 2 * margin
		array_set(bb, bb1)
		bb.rotate(s.rotation)
		let [x1, y1, x2, y2] = bb
		let bw = x2 - x1
		let bh = y2 - y1
		set_scale(min(
			scale,
			w / bw,
			h / bh
		))
		if (!s.panned) {
			// in pixels from widget's origin
			s.x0 = -s.x(x1) + margin + round((w - s.d(x2 - x1)) / 2)
			s.y0 = -s.y(y1) + margin + round((h - s.d(y2 - y1)) / 2)
		}
	}
	s.set_scale = function(sc) {
		if (s.zoomed) return
		set_scale(sc)
	}
	s.zoom = function(d, xc, yc) { // zoom around (xc,yc) pixels from widget's origin
		if (!d) return

		let plan_xt = s.plan_x(-s.x0 + xc)
		let plan_yt = s.plan_y(-s.y0 + yc)

		set_scale(clamp(scale * 1.2 ** -d, 0.1, 10))

		let xt = s.x(plan_xt)
		let yt = s.y(plan_yt)

		s.x0 = -(xt - xc)
		s.y0 = -(yt - yc)

		s.zoomed = true
	}
	s.reset_zoom = function() {
		s.zoomed = false
		s.panned = false
	}
	return s
}

let scale_group = memoize(scaler)

// floor view ----------------------------------------------------------------

function draw_grid(cx, sg, x0, y0, w, h, step, dark_color, light_color) {
	if (!sg.show_grid)
		return
	if (sg.d(step) < 7)
		return
	let color = ui.theme().is_dark ? dark_color : light_color
	cx.strokeStyle = color
	for (let i = mod(sg.plan_x(x0), step), n = sg.plan_d(w); i < n; i += step) {
		cx.beginPath()
		cx.moveTo(sg.x(i), 0)
		cx.lineTo(sg.y(i), h-1)
		cx.stroke()
	}
	for (let i = mod(sg.plan_y(y0), step), n = sg.plan_d(h); i < n; i += step) {
		cx.beginPath()
		cx.moveTo(0, sg.x(i))
		cx.lineTo(w-1, sg.y(i))
		cx.stroke()
	}
	return true
}

function draw_grids(cx, sg, x0, y0, w, h) {
	// fixed grid
	cx.save()
	cx.translate(.5, .5)
	// TODO: make this dynamic; show at most 3-levels based on zoom level
	// with dynamic lightness based on level.
	if (0) {
	for (let i = 0; i < 3; i++) {
		let step = (i == 0 ? 1 : i == 1 ? 5 : 10)
		let L = ui.theme().is_dark ? 1 : 0
		draw_grid(cx, sg, x0, y0, w, h,  10, hsl(0, 0, L))
	}
	}
	let g1 =
	draw_grid(cx, sg, x0, y0, w, h,  10, '#222'   , '#eee')
	draw_grid(cx, sg, x0, y0, w, h,  50, g1 ? '#2a2a2a' : '#222', '#ddd')
	draw_grid(cx, sg, x0, y0, w, h, 100, '#333'   , '#ccc')
	cx.restore()
}

function draw_edges(cx, sg, eps) {
	for (let ep of eps) {
		let x = sg.x(ep[0])
		let y = sg.y(ep[1])
		if (ep == eps[0])
			cx.moveTo(x, y)
		else
			cx.lineTo(x, y)
	}
	cx.closePath()
}

function draw_walls(cx, sg, comps, segs) {
	for (let comp of comps) {

		cx.beginPath()

		for (let c of comp.cycles) {
			if (!c.edges)
				continue
			draw_edges(cx, sg, c.edges)
		}

		if (!cx.wall_pattern) {
			let w = 100
			let c = new OffscreenCanvas(w, w)
			let x = c.getContext('2d')
			let g = x.createLinearGradient(0, 0, w, 2*w)
			for (let i = 0, n = 2*w; i <= n; i += 4) {
				g.addColorStop(clamp((i - 1) / n, 0, 1), 'white')
				g.addColorStop(clamp((i + 0) / n, 0, 1), 'gray')
				g.addColorStop(clamp((i + 1) / n, 0, 1), 'white')
			}
			x.rect(0, 0, w, w)
			x.fillStyle = g
			x.fill()
			cx.wall_pattern = cx.createPattern(c, 'repeat')
		}
		if (sg.scale > 0.4) {
			cx.fillStyle = DEBUG_PLAN ? '#333' : cx.wall_pattern
			cx.fill('nonzero')
			cx.lineWidth = DEBUG_PLAN ? 2 : sg.line_width
			cx.strokeStyle = 'black' //ui.color_css('text')
			cx.lineJoin = 'round'
			cx.stroke()
			cx.lineJoin = 'miter'
			cx.lineWidth = 1
		} else if (sg.scale > 0.2) { // too small to stroke
			cx.fillStyle = ui.color_css('text')
			cx.fill()
		} else { // to small to even show edges
			for (let seg of segs) {
				let x1 = sg.x(seg[0][0]) + .5
				let y1 = sg.y(seg[0][1]) + .5
				let x2 = sg.x(seg[1][0]) + .5
				let y2 = sg.y(seg[1][1]) + .5
				cx.beginPath()
				cx.moveTo(x1, y1)
				cx.lineTo(x2, y2)
				cx.strokeStyle = ui.color_css('text')
				cx.stroke()
			}
		}
	}
}

function draw_length(cx, sg, x1, y1, x2, y2) {

	let d = distance(x1, y1, x2, y2)
	if (sg.d(d) < 20)
		return

	let s = format_length(d)

	x1 = sg.x(x1)
	y1 = sg.y(y1)
	x2 = sg.x(x2)
	y2 = sg.y(y2)

	if (x1 > x2) {
		let x3 = x1
		let y3 = y1
		x1 = x2
		y1 = y2
		x2 = x3
		y2 = y3
	}
	let a = -atan2(y2 - y1, x2 - x1)

	cx.save()

	cx.font = 'bold 14px sans-serif'
	let m = ui.measure_text('0.00m')
	let w = m.width

	let t1 = clamp((sg.d(d) - (w + 10)) / 2 / sg.d(d), 0, 1)
	let t2 = clamp((sg.d(d) + (w + 10)) / 2 / sg.d(d), 0, 1)

	if (!(t1 > 0 && t2 < 1)) {
		s = '...'
		w = 10
	}

	cx.translate(.5, .5)

	cx.beginPath()

	// left arrow
	let [x1a1, y1a1] = point_around(x1, y1, 8, a + 45*rad)
	let [x1a2, y1a2] = point_around(x1, y1, 8, a - 45*rad)
	let [x1e, y1e] = line2.at(t1, x1, y1, x2, y2, out)

	cx.moveTo(x1  , y1)
	cx.lineTo(x1a1, y1a1)
	cx.moveTo(x1  , y1)
	cx.lineTo(x1a2, y1a2)
	cx.moveTo(x1  , y1)
	cx.lineTo(x1e , y1e)

	// right arrow
	let [x2a1, y2a1] = point_around(x2, y2, 8, a + (90+45)*rad)
	let [x2a2, y2a2] = point_around(x2, y2, 8, a - (90+45)*rad)
	let [x2e, y2e] = line2.at(t2, x1, y1, x2, y2, out)
	cx.moveTo(x2  , y2)
	cx.lineTo(x2a1, y2a1)
	cx.moveTo(x2  , y2)
	cx.lineTo(x2a2, y2a2)
	cx.moveTo(x2  , y2)
	cx.lineTo(x2e , y2e)

	cx.strokeStyle = ui.color_css('text')
	cx.stroke()

	let [xc, yc] = line2.at(.5, x1, y1, x2, y2, out)
	cx.translate(xc, yc)
	cx.rotate(a)
	let tx = round(-w / 2)
	let ty = round((m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2)
	cx.translate(tx, ty)
	cx.fillStyle = ui.color_css('text')
	cx.fillText(s, 0, 0)

	cx.restore()
}

let FLOOR_EDITOR_ID         = ui.BOX_ARGS+0
let FLOOR_EDITOR_PLAN       = ui.BOX_ARGS+1
let FLOOR_EDITOR_DRAW_STATE = ui.BOX_ARGS+2

ui.box_widget('floor_editor', {

	ID: FLOOR_EDITOR_ID,

	create: function(cmd, id, plan, fr, align, valign) {

		ui.focus_group(false, 0, id)
		ui.focusable(id)

		let s = ui.state(id)
		s.draw_state ??= {snap_lines: [], measure_edges: [], above_floors: [], below_floors: []} // plan drawing data
		let draw_state = s.draw_state

		let sg = scale_group('editor')

		let hs = ui.hit(id)
		if (hs && ui.wheel_dy)
			sg.zoom(ui.wheel_dy / ui.em(7), hs.mx, hs.my)

		let cs = ui.drag(id)
		let is_restored = false
		if (!cs && ui.focus_inside(id)) {
			if (ui.keydown('ctrl shift z') || ui.keydown('ctrl y'))
				is_restored = plan.redo()
			else if (ui.keydown('ctrl z'))
				is_restored = plan.undo()
		}

		if (cs) {

			let dx = cs.dx / sg.scale
			let dy = cs.dy / sg.scale
			if (sg.rotation) {
				let c = cos(sg.rotation)
				let s = sin(sg.rotation)
				let dx0 = dx
				dx = dx0 * c + dy * s
				dy = -dx0 * s + dy * c
			}

			if (cs.drag) {

				let action = cs.action
				let seg    = cs.seg

				if (action == 'move_seg') { // move seg
					cs.move_seg = plan.start_move_seg(seg, draw_state)
				} else if (action == 'pan') {
					sg.pan_x0 = sg.x0
					sg.pan_y0 = sg.y0
				}
			}

			let action = cs.action

			if (!cs.cancel && !action && (abs(dx) >= 10 || abs(dy) >= 10)) { // dragged far enough to assume intent to drag.

				// establish direction of drag on x and y axis.
				let sdx = abs(dx) > 1.5 * abs(dy) ? sign(dx) : 0 // straight enough
				let sdy = abs(dy) > 1.5 * abs(dx) ? sign(dy) : 0 // straight enough
				if (sdx || sdy) {
					action = 'resize_seg'
					cs.action = action
					let p   = cs.p
					let mx0 = cs.x
					let my0 = cs.y
					cs.resize_seg = plan.start_resize_seg(p, mx0, my0, dx, dy, sdx, sdy, draw_state)
				}

			}

			if (action == 'move_seg') {
				if (cs.cancel)
					cs.move_seg.cancel(draw_state)
				else
					cs.move_seg.move(dx, dy, draw_state)
			}

			if (action == 'resize_seg') {
				if (cs.cancel)
					cs.resize_seg.cancel(draw_state)
				else
					cs.resize_seg.resize(dx, dy, draw_state, cs)
			}

			if (action == 'pan' && !cs.cancel) {
				sg.x0 = sg.pan_x0 + cs.dx
				sg.y0 = sg.pan_y0 + cs.dy
				sg.panned = true
			}

			if (cs.drop && !cs.cancel) {
				if (action == 'move_seg') {
					cs.move_seg.stop(draw_state)
				} else if (action == 'resize_seg') {
					cs.resize_seg.stop(draw_state)
				}
			}

		}

		let is_deleting_seg = hs?.action == 'move_seg' && ui.dblclick
		if (is_deleting_seg) {
			plan.delete_seg(hs.seg)
		}

		if (cs?.drop || cs?.cancel || is_deleting_seg || is_restored) {
			draw_state.snap_lines.length = 0
			draw_state.measure_edges.length = 0
			if (hs) {
				hs.seg = null
				hs.p = null
				hs.cycle = null
				hs.action = null
			}
			if (cs) {
				cs.seg = null
				cs.p = null
				cs.cycle = null
				cs.action = null
			}
		}

		ui.stack()

			ui.cmd_box(cmd, fr, align, valign, id, plan, draw_state)

			ui.m(ui.sp())
			ui.v(1, ui.sp())

				ui.h(0, ui.sp05(), 's', 't')

					ui.bold()
					ui.text('', floor_names[plan.i] ?? S(plan.i+'_floor', '{0}ᵗʰ FLOOR', plan.i))

					if (!ui.window_focused()) {
						ui.p(ui.sp05(), 0)
						ui.stack('', 0, '[')
							ui.nobold()
							ui.xlarge()
							ui.color('text')
							ui.icon('', 'keyboard-off', 0, 'c', 'c')
						ui.end_stack()
					}

					ui.v(1); ui.end()

					if (sg.zoomed) {
						if (ui.button(id+'.zoom_button', sg.scale > 1 ? 'zoom-in' : 'zoom-out', '', 0, ']')) {
							sg.reset_zoom()
							ui.animate()
						}
					}

					if (ui.button(id+'.rotate_button', 'rotate-clockwise', '', 0)) {
						sg.rotation = ((sg.rotation ?? 0) + 90*rad) % (360*rad)
						ui.animate()
					}

					if (ui.button(id+'.grid_button', 'grid-dots', '', 0)) {
						sg.show_grid = !sg.show_grid
						ui.animate()
					}

				ui.end_h()

				ui.v(0, ui.sp(), ']')

					ui.button(id+'.c1', 'pointer', '', 0)
					ui.button(id+'.c2', 'arrows-move', '', 0)

				ui.end_v()

			ui.end_v()

		ui.end_stack()
		ui.end_focus_group()

	},

	position: function(a, i, axis, sx, sw)	{
		ui.box_position(a, i, axis, sx, sw)
		let sg = scale_group('editor')
		if (!axis) {
			sg.set_scale(1/0)
			return
		}
		let w  = a[i+2]
		let h  = a[i+3]
		let plan = a[i+FLOOR_EDITOR_PLAN]
		sg.scale_to_fit(plan.house.bb, w, h)
	},

	translate: function(a, i, dx, dy) {
		ui.box_translate(a, i, dx, dy)
		let x00 = a[i+0]
		let y00 = a[i+1]
		let plan = a[i+FLOOR_EDITOR_PLAN]
		let draw_state = a[i+FLOOR_EDITOR_DRAW_STATE]

		let sg = scale_group('editor')

		draw_state.x0 = sg.x0
		draw_state.y0 = sg.y0
		draw_state.scale = sg.scale
		draw_state.rotation = sg.rotation

		// pick what parts of the plan to send over the network for drawing
		// and in which format. note that the plan has arrays with props but
		// the props will not be sent over because of how json works.
		draw_state.comps = plan.comps
		draw_state.segs = plan.segs // TODO: remove this from draw stream
		draw_state.ps = plan.ps // TODO: remove this from draw stream
		draw_state.plan_snap_lines = plan.snap_lines

		draw_state.above_floors.length = 0
		draw_state.below_floors.length = 0
		for (let plan1 of plan.house.floors) {
			if (plan1 == plan)
				continue
			let t = {comps: plan1.comps, segs: plan1.segs}
			let a = plan1.i > plan.i ? draw_state.above_floors : draw_state.below_floors
			a.push(t)
		}
	},

	draw: function(a, i) {

		let x00   = a[i+0]
		let y00   = a[i+1]
		let w     = a[i+2]
		let h     = a[i+3]
		let id    = a[i+FLOOR_EDITOR_ID]

		let draw_state = a[i+FLOOR_EDITOR_DRAW_STATE]
		let x0 = draw_state.x0
		let y0 = draw_state.y0

		let cs = ui.captured(id)
		let hs = cs ?? ui.hovers(id) // while dragging, the state at drag start.
		let hit_action  = hs?.action
		let hit_seg     = hs?.seg
		let hit_p       = hs?.p
		let hit_cycle   = hs?.cycle
		let hit_x       = hs?.x
		let hit_y       = hs?.y
		let drag_action = cs?.action
		let drag_seg    = cs?.seg

		let sg = scale_group('editor')
		sg.set_scale(draw_state.scale)
		sg.rotation = draw_state.rotation

		let cx = ui.cx
		cx.save()

		cx.beginPath()
		cx.rect(x00, y00, w, h)
		cx.clip()

		cx.translate(x00, y00)
		cx.font = 'bold 14px sans-serif'

		// fixed grid
		draw_grids(cx, sg, x0, y0, w, h)

		// legend
		{
		let m = ui.em()
		let cm = 100
		let d = sg.d(cm)
		while (d > w - 2*m) {
			cm /= 5
			d = sg.d(cm)
		}
		cx.beginPath()
		let t = 4
		let x = w - d - m - t
		let y = h - m - t
		cx.rect(x, y, d, t)
		cx.fillStyle = ui.color_css('label')
		cx.fill()
		let s = format_length(cm)
		let tw = ui.measure_text(s).width
		cx.fillText(s, x + d - tw, y - 2)
		}

		// help
		{
		let m = ui.em()
		cx.fillStyle = ui.color_css('label')
		let s = 'CTRL=No Snap  SHIFT=Pan'
		cx.fillText(s, m, h - m)
		}

		sg.transform(cx, w, h)

		// below floors
		cx.globalAlpha = .1
		for (let plan1 of draw_state.below_floors)
			draw_walls(cx, sg, plan1.comps, plan1.segs)
		cx.globalAlpha = 1

		// snap lines
		cx.setLineDash([5, 8])
		cx.strokeStyle = ui.theme().is_dark ? '#555' : '#999'
		for (let i = 0, sl = draw_state.snap_lines, n = sl.length; i < n; i += 2) {
			let sa   = sl[i]
			let is_v = sl[i+1]
			let x1, y1, x2, y2
			if (is_v) {
				x1 = sg.x(sa)
				x2 = sg.x(sa)
				y1 = -draw_state.y0
				y2 = -draw_state.y0 + h
			} else {
				y1 = sg.y(sa)
				y2 = sg.y(sa)
				x1 = -draw_state.x0
				x2 = -draw_state.x0 + w
			}
			cx.beginPath()
			cx.moveTo(x1+.5, y1+.5)
			cx.lineTo(x2+.5, y2+.5)
			cx.stroke()
		}
		cx.setLineDash([])

		// room backgrounds
		for (let co of draw_state.comps) {
			for (let c of co.cycles) {
				if (c.outer)
					continue
				if (!c.edges)
					continue

				cx.beginPath()

				draw_edges(cx, sg, c.edges)

				// island outer cycles are clockwise so they draw as holes.
				for (let icomp of c.islands)
					draw_edges(cx, sg, icomp.outer_cycle.edges)

				cx.fillStyle = ui.alpha_adjust(ui.color_obj('bg1', hit_cycle == c ? 'hover' : null), .5)
				cx.fill()
			}
		}

		// walls of this floor
		draw_walls(cx, sg, draw_state.comps, draw_state.segs)

		// walls of above floor
		cx.globalAlpha = .1
		for (let plan1 of draw_state.above_floors)
			draw_walls(cx, sg, plan1.comps, plan1.segs)
		cx.globalAlpha = 1

		// cycles area
		if (sg.scale > 0.4)
			for (let co of draw_state.comps) {
				for (let c of co.cycles) {
					if (c.outer)
						continue
					let [x, y] = c.center()
					x = sg.x(x)
					y = sg.y(y)
					cx.fillStyle = ui.color_css('label')
					let s = format_area(c.edges.area())
					if (DEBUG_PLAN) s = co.id + '/' + c.id + ' ' + s
					cx.fillText(s, x, y+5)
				}
			}

		// edge measurements
		let me = draw_state.measure_edges
		if (me) {
			for (let [ep1, ep2] of me) {
				let x1 = ep1[0]
				let y1 = ep1[1]
				let x2 = ep2[0]
				let y2 = ep2[1]
				;[x1, y1, x2, y2] = line2.offset(-10, x1, y1, x2, y2, [])
				draw_length(cx, sg, x1, y1, x2, y2)
			}
		}

		// hit point
		if (hit_x != null && hit_y != null) {
			let x = sg.x(hit_x)
			let y = sg.y(hit_y)
			cx.beginPath()
			cx.arc(x, y, 3, 0, 2*PI)
			cx.strokeStyle = 'black'
			cx.lineWidth = 3
			cx.stroke()
			cx.lineWidth = 1
			cx.fillStyle = 'white'
			cx.fill()
		}

		// orthogonal measurements
		if (0)
		for (let i = 0; i < 2; i++) {
			for (let m of draw_state.plan_snap_lines[i]) {
				let x = sg.x(i == 0 ? m : -50)
				let y = sg.y(i == 1 ? m : -20)
				cx.save()
				cx.translate(x, y)
				//if (i == 0)
					cx.rotate(-PI/4)
				cx.fillStyle = 'white' //ui.color_css('label')
				cx.strokeStyle = 'black'
				cx.shadowBlur = 4
				cx.shadowColor = 'black'
				let s = format_length(m)
				cx.fillText(s, 0, 0)
				cx.restore()
			}
		}

		// cursor
		let seg = drag_action == 'move_seg' && drag_seg || (hit_action == 'move_seg' && hit_seg)
		if (seg) {
			if (seg[0].segs.length == 1 && seg[1].segs.length == 1)
				ui.set_cursor('move')
			else
				ui.set_cursor(seg.is_v ? 'ew-resize' : 'ns-resize')
		} else if (hit_p)
			ui.set_cursor('copy')
		else if (drag_action == 'pan')
			ui.set_cursor('grabbing')
		else if (hs) {
			if (hit_action == 'pan')
				ui.set_cursor('grab')
			else
				ui.set_cursor('copy')
		}

		// DEBUG ---------------------------------------------------------------

		// segment lines and segment numbers
		if (DEBUG_PLAN)
		for (let seg of draw_state.segs) {
			let p1 = seg[0]
			let p2 = seg[1]
			cx.beginPath()
			let x1 = sg.x(p1[0])
			let y1 = sg.y(p1[1])
			let x2 = sg.x(p2[0])
			let y2 = sg.y(p2[1])
			cx.moveTo(x1, y1)
			cx.lineTo(x2, y2)
			cx.strokeStyle = hit_seg == seg ? 'white' : '#666'
			cx.stroke()

			let [x0, y0] = seg_center(seg)
			let x = sg.x(x0) - 5
			let y = sg.y(y0) + 5
			cx.fillStyle = '#f66'
			cx.fillText(seg.id, x, y)
		}

		// point numbers
		if (DEBUG_PLAN)
		for (let p of draw_state.ps) {
			let [x0, y0] = p
			let x = sg.x(x0) - 5
			let y = sg.y(y0) + 5
			cx.fillStyle = 'white'
			cx.fillText(p.id, x, y)
		}

		// edge point numbers
		if (0 && DEBUG_PLAN)
		for (let c of draw_state.comps) {
			let co = c // no var shadowing because langauge designers are dumb
			for (let c of co.cycles) {
				for (let ep of c.edges) {
					let x = sg.x(ep[0]) - 5
					let y = sg.y(ep[1]) + 15
					cx.fillStyle = '#0f0'
					cx.fillText(c.i+'/'+ep.ci, x, y)
				}
			}
		}

		cx.restore()
	},

	/*	sets in hovers(id):
		action=pan                 shift pressed, pan, don't hit anything
		p                          hit joint
		seg, action=move_seg       hit segment
		seg, x or y                hit around segment along its length
		x and/or y                 hit vert and/or horiz snap line
		cycle                      inside inner cycle
	*/
	hit: function(a, i) {

		let x00 = a[i+0]
		let y00 = a[i+1]
		let w   = a[i+2]
		let h   = a[i+3]
		let id  = a[i+FLOOR_EDITOR_ID]
		let plan = a[i+FLOOR_EDITOR_PLAN]
		let draw_state = a[i+FLOOR_EDITOR_DRAW_STATE]

		if (ui.captured_id != null && !ui.clickup)
			return

		if (!ui.hit_box(a, i))
			return

		let hs = ui.set_hit(id)

		let sl = draw_state.snap_lines
		sl.length = 0

		let sg = scale_group('editor')

		let cx = ui.cx

		let pan    = ui.keypressed('shift')
		let nosnap = ui.keypressed('ctrl')

		hs.mx = ui.mx - x00 // pointer position before view rotation, for zooming.
		hs.my = ui.my - y00
		if (sg.rotation) {
			let c = cos(sg.rotation)
			let s = sin(sg.rotation)
			let dx = hs.mx - w / 2
			let dy = hs.my - h / 2
			hs.mx = w / 2 + dx * c + dy * s
			hs.my = h / 2 - dx * s + dy * c
		}

		if (pan) {
			hs.action = 'pan'
			return true
		}

		cx.save()
		cx.translate(x00, y00)
		sg.transform(cx, w, h)
		ui.update_mouse()

		let mx = sg.plan_x(ui.mx)
		let my = sg.plan_y(ui.my)

		let snap_margin = 15

		let hit_p, hit_seg, hit_action, hit_cycle

		for (let p of draw_state.ps) {
			let dx = ui.mx - sg.x(p[0])
			let dy = ui.my - sg.y(p[1])
			let snap_d = nosnap ? 2 : sg.d(p.max_offset) + sg.line_width + snap_margin
			if (abs(dx) <= snap_d && abs(dy) <= snap_d) {
				hit_p = p
				hs.p = p // point to start new seg from
				hs.x = p[0]
				hs.y = p[1]
				sl.push(p[0], 1, p[1], 0)
				break
			}
		}

		if (!hit_p)
			for (let seg of draw_state.segs) {

				let x1 = seg[0][0]
				let y1 = seg[0][1]
				let x2 = seg[1][0]
				let y2 = seg[1][1]
				let v = seg.is_v

				let sx1, sy1, sx2, sy2 // screen hit box

				// test over the seg's area between its offset edges.
				let m = sg.line_width
				if (v) {
					let x = x1
					sx1 = sg.x(x + seg[y1 < y2 ? -2 : -1]) - m
					sx2 = sg.x(x - seg[y1 < y2 ? -1 : -2]) + m
					sy1 = sg.y(seg.y1)
					sy2 = sg.y(seg.y2)
				} else if (y1 == y2) {
					let y = y1
					sy1 = sg.y(y + seg[x1 > x2 ? -2 : -1]) - m
					sy2 = sg.y(y - seg[x1 > x2 ? -1 : -2]) + m
					sx1 = sg.x(seg.x1)
					sx2 = sg.x(seg.x2)
				} else {
					continue
				}
				if (ui.hit_bbox(sx1, sy1, sx2, sy2)) {
					hit_seg = seg
					hit_action = 'move_seg'
					hs.seg = seg
					hs.action = hit_action
					break
				}

				// try a wider area and compute the point of the mouse projected on the seg.
				if (v) {
					sx1 -= snap_margin
					sx2 += snap_margin
				} else {
					sy1 -= snap_margin
					sy2 += snap_margin
				}
				if (ui.hit_bbox(sx1, sy1, sx2, sy2)) {
					hit_seg = seg
					hs.seg = seg
					let sx = !v ? plan.snap_x(mx, nosnap) ?? mx : null
					let sy = v  ? plan.snap_y(my, nosnap) ?? my : null
					hs.x = sx ?? x1
					hs.y = sy ?? y1
					if (sx != null) sl.push(sx, 1)
					if (sy != null) sl.push(sy, 0)
					break
				}

			}

		// hit snapping point
		if (!hit_p && !hit_seg) {
			let sx = plan.snap_x(mx, nosnap)
			let sy = plan.snap_y(my, nosnap)
			hs.x = sx ?? mx
			hs.y = sy ?? my
			if (sx != null) sl.push(sx, 1)
			if (sy != null) sl.push(sy, 0)
		}

		// hit inner cycle
		if (!hit_p && !hit_seg) {
			hit_cycle = plan.hit_cycle_edges(mx, my)
			if (hit_cycle)
				hs.cycle = hit_cycle
		}

		cx.restore()
		ui.update_mouse()

		return true

	},

})

}()) // module function
