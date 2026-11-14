
// TODO: draw() is not streamable. it reads state that is not on remote:
// - sg.x0, sg.y0 (transform, draw_grids): send in draw_state.
// - sg.show_grid, sg.show_dims: send in draw_state.
// - cycle c.edges, c.outer, c.islands, c.center(), c.edges.area(): props and
//   methods are lost in json. send plain geometry.
// - ui.captured(), ui.hovers() (hit_* values): send plain fields.
// - ui.set_cursor(): derive on the sharing machine.

(function () {
"use strict"
const G = window

const {
	ceil, round, snap, mod, abs, sign, min, clamp, PI, sin, cos, rad, atan2,
	array_set, memoize, format_kcount, point_around, distance,
	json_arg, try_json_arg, json, copy_to_clipboard, S,
} = glue

const {bbox2, line2} = Math3D

// view utils ----------------------------------------------------------------

let out = []

let floor_names = [
	'GROUND FLOOR',
	'1st FLOOR',
	'2nd FLOOR',
	'3rd FLOOR',
]

let format_length = d => format_kcount(d / 1e2, 2)+'m'
let format_area = a => format_kcount(abs(a) / 1e4, 2)+' m\u00b2'

function seg_center(seg) {
	return line2.at(.5, seg[0][0], seg[0][1], seg[1][0], seg[1][1], out)
}

// shared scale --------------------------------------------------------------

function scaler(name) {
	let s = {}
	s.show_grid = ui.saved_state.floor_editor?.show_grid
	s.show_dims = ui.saved_state.floor_editor?.show_dims
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
		return true
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

function draw_grids(cx, sg, w, h) {
	let x0 = sg.x0
	let y0 = sg.y0
	if (sg.rotation) {
		let xc = round(w / 2)
		let yc = round(h / 2)
		let c = cos(sg.rotation)
		let s = sin(sg.rotation)
		let dx = x0 - xc
		let dy = y0 - yc
		x0 = xc + dx * c - dy * s
		y0 = yc + dx * s + dy * c
	}
	// grid
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
	let m = ui.measure_text(s)
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
	let rotation = sg.rotation ?? 0
	let text_angle = mod(rotation - a + PI/2, PI) - PI/2
	cx.rotate(text_angle - rotation)
	let tx = round(-w / 2)
	let ty = round((m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2)
	cx.translate(tx, ty)
	cx.fillStyle = ui.color_css('text')
	cx.textAlign = 'left'
	cx.fillText(s, 0, 0)

	cx.restore()
}

function floor_editor_update(id, s) {
	s.interaction_value = undefined
	if (!s.house)
		return
	let plan = s.floor
	let readonly = s.readonly
	let draw_state = s.draw_state
	let floor0 = s.floor
	for (let floor of plan.house.floors)
		if (ui.clicked(id+'.floor'+floor.i))
			s.floor = floor
	let floors = s.house.floors
	if (ui.state_of(id+'.add_floor_button', 'state') == 'click') {
		s.floor = s.house.add_floor()
	} else if (floors.length > 1
		&& ui.state_of(id+'.remove_floor_button', 'state') == 'click'
	) {
		s.house.remove_top_floor()
	}

	let cs = ui.drag(id)
	let is_restored = false
	if (!readonly && !cs && ui.focus_inside(id)) {
		if (ui.keydown('ctrl shift z') || ui.keydown('ctrl y'))
			is_restored = plan.house.redo()
		else if (ui.keydown('ctrl z'))
			is_restored = plan.house.undo()
	}

	// copy and paste the whole house as json text.
	if (!cs && ui.focus_inside(id) && ui.keydown('ctrl c'))
		copy_to_clipboard(json(s.house.save_state()))
	if (!readonly && !cs && ui.focus_inside(id) && ui.keydown('paste')) {
		let state = try_json_arg(ui.clipboard_text)
		if (state?.floors?.length) {
			try {
				plan.house.load_state(state)
				is_restored = true
			} catch {
				// bad state: load_state restored the house, ignore the paste.
			}
		}
	}

	// removed the selected floor, or undid an added floor or redid a removed
	// one, or pasted or undid a paste: select the top floor.
	floors = s.house.floors // paste and its undo replace the array.
	if (!floors.includes(s.floor))
		s.floor = floors[floors.length-1]
	plan = s.floor
	if (plan != floor0) {
		draw_state.snap_lines.length = 0
		draw_state.measure_edges.length = 0
	}

	let sg = scale_group('editor')

	let hs = ui.hit(id)
	if (hs && ui.wheel_dy)
		sg.zoom(ui.wheel_dy / ui.em(7), hs.mx, hs.my)

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

		if (!readonly && !cs.cancel && !action && (abs(dx) >= 10 || abs(dy) >= 10)) { // dragged far enough to assume intent to drag.

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

		// a room point moves only past the drag threshold: a click toggles
		// its room instead.
		if (action == 'move_room_point') {
			if (cs.moved && !cs.cancel)
				cs.move_room_point ??= plan.start_move_room_point(cs.room_point)
			let move_room_point = cs.move_room_point
			if (move_room_point) {
				if (cs.cancel)
					move_room_point.cancel(draw_state)
				else
					move_room_point.move(dx, dy)
			}
		}

		if (action == 'pan' && !cs.cancel) {
			sg.x0 = sg.pan_x0 + dx * sg.scale
			sg.y0 = sg.pan_y0 + dy * sg.scale
			sg.panned = true
		}

		if (cs.drop && !cs.cancel) {
			if (action == 'move_seg') {
				cs.move_seg.stop(draw_state)
			} else if (action == 'resize_seg') {
				cs.resize_seg.stop(draw_state)
			} else if (action == 'move_room_point') {
				cs.move_room_point?.stop() // not moved: no edit started.
			}
		}

	}

	let is_deleting_seg = !readonly
		&& hs?.action == 'move_seg' && ui.dblclick
	if (is_deleting_seg) {
		plan.delete_seg(hs.seg)
	}

	// clicked inside a room without dragging: open or close the room.
	let is_toggling_room = !readonly && cs?.drop && !cs.cancel && !cs.moved
		&& (!cs.action || cs.action == 'move_room_point') && cs.cycle
	if (is_toggling_room)
		plan.toggle_room(cs.cycle, cs.room_x, cs.room_y)

	let is_removing_room_point = !readonly && !cs && hs?.room_point
		&& ui.focus_inside(id) && ui.keydown('delete')
	if (is_removing_room_point)
		plan.remove_room_point(hs.room_point)

	if (cs?.drop || cs?.cancel || is_deleting_seg || is_removing_room_point
		|| is_restored
	) {
		draw_state.snap_lines.length = 0
		draw_state.measure_edges.length = 0
		if (hs) {
			hs.seg = null
			hs.p = null
			hs.cycle = null
			hs.room_point = null
			hs.action = null
		}
		if (cs) {
			cs.seg = null
			cs.p = null
			cs.cycle = null
			cs.room_point = null
			cs.action = null
		}
	}

}

ui.floor_editor_update_value = function(id) {
	let s = ui.state_of(id)
	if (s?.house && !s.readonly) {
		ui.set_interaction_value(id, s, json(s.house.save_state()))
		s.value_edit_no = s.house.edit_no
	}
}

ui.floor_editor_is_value_changed = function(id) {
	let s = ui.state_of(id)
	return !!s?.house && s.house.edit_no != s.value_edit_no
}

let FLOOR_EDITOR_ID         = ui.BOX_ARGS+0
let FLOOR_EDITOR_PLAN       = ui.BOX_ARGS+1
let FLOOR_EDITOR_DRAW_STATE = ui.BOX_ARGS+2

ui.box_widget('floor_editor', {

	ID: FLOOR_EDITOR_ID,

	create: function(cmd, id, value, field, opt, readonly) {

		let s = ui.state(id, floor_editor_update)
		field ??= ui.input_field(id) ?? s.field
			?? ui.create_field({type: 'json'})
		let value0 = s.input_value
		let field0 = s.field
		value = ui.set_value(id, s, value, field)
		if (!s.draw_state || s.interaction_value === undefined
				&& (value !== value0 || field != field0)) {
			s.house = value != null && !s.validation.failed
				? house_plan(json_arg(value)) : null
			s.floor = s.house?.floors[0]
			s.value_edit_no = 0 // house.edit_no of the value loaded or published
			scale_group('editor').rotation = s.house?.rotation ?? 0
		}
		s.readonly = readonly ?? field.readonly
		if (!s.house) {
			ui.text('', value, 1, 's', 's', null, 'line')
			return ui.value(id)
		}

		ui.focus_group(false, 0, id)
		ui.focusable(id)

		s.draw_state ??= {
			snap_lines: [],
			measure_edges: [],
			above_floors: [],
			below_floors: [],
			below_cycles: [], // [edges, ...] of the floor below, except outlines
		}
		let draw_state = s.draw_state
		let plan = s.floor
		draw_state.readonly = s.readonly
		let sg = scale_group('editor')

		ui.stack()

			ui.cmd_box(cmd, 1, 's', 's', id, plan, draw_state)

			ui.m(ui.sp())
			ui.v(1, ui.sp())

				ui.h(0, ui.sp05(), 's', 't')

					ui.v(0, ui.sp05(), '[')
						let floors = plan.house.floors
						for (let i = floors.length-1; i >= 0; i--) {
							let floor = floors[i]
							ui.color('text', floor == plan ? 'active' : null)
							ui.bold()
							ui.text(id+'.floor'+floor.i, floor_names[floor.i]
								?? S(floor.i+'_floor', '{0}ᵗʰ FLOOR', floor.i))
						}
						if (!s.readonly) {
							ui.h(0, ui.sp05())
								ui.button(id+'.add_floor_button', 'building-plus', '',
									0, null, null, null, null,
									S('add_floor', 'Add floor'))
								ui.button(id+'.remove_floor_button', 'building-minus',
									'', 0, null, null, null, floors.length < 2,
									S('remove_top_floor', 'Remove top floor'))
							ui.end_h()
						}
					ui.end_v()

					ui.v(1, 0, 's', 't')
						if (!ui.window_focused() || !ui.focus_inside(id)) {
							ui.p(ui.sp05(), 0)
							ui.stack('', 0, 'c')
								ui.nobold()
								ui.xlarge()
								ui.color('text')
								ui.icon('', 'keyboard-off', 0, 'c', 'c')
							ui.end_stack()
						}
					ui.end_v()

					if (sg.zoomed && ui.button(id+'.zoom_button',
							sg.scale > 1 ? 'zoom-in' : 'zoom-out', '',
							0, 'c', 't', null, null,
							S('fit_to_view', 'Fit to view'))
					) {
						sg.reset_zoom()
					}

					if (ui.button(id+'.rotate_button', 'rotate-rectangle', '',
							0, 'c', 't', null, null,
							S('rotate_90_degrees', 'Rotate 90 degrees'))
					) {
						sg.rotate_requested = true
					}

					if (ui.button(id+'.grid_button', 'grid-4x4', '',
							0, 'c', 't', null, null,
							S('show_grid', 'Show grid'))
					) {
						sg.show_grid = !sg.show_grid
						ui.save_state('floor_editor', 'show_grid', sg.show_grid)
					}

					if (ui.button(id+'.dims_button', 'ruler-measure', '',
							0, 'c', 't', null, null,
							S('show_all_dimensions', 'Show all dimensions'))
					) {
						sg.show_dims = !sg.show_dims
						ui.save_state('floor_editor', 'show_dims', sg.show_dims)
					}

				ui.end_h()

				ui.v(1, ui.sp(), ']')

					ui.v(0, ui.sp(), 'c', 'c')
						ui.button(id+'.c1', 'pointer', '', 0)
						ui.button(id+'.c2', 'arrows-move', '', 0)
					ui.end_v()

				ui.end_v()

			ui.end_v()

		ui.end_stack()
		ui.end_focus_group()
		return ui.value(id)

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
		let is_fitted = sg.scale_to_fit(plan.house.bb, w, h)
		// first fit: lock the view, like a manual zoom.
		if (is_fitted && !sg.has_fitted) {
			sg.has_fitted = true
			sg.zoomed = true
		}
		if (sg.rotate_requested) {
			sg.rotate_requested = false
			let bb = plan.house.bb
			let xc = sg.x((bb[0] + bb[2]) / 2)
			let yc = sg.y((bb[1] + bb[3]) / 2)
			let vx = round(w / 2)
			let vy = round(h / 2)
			let dx = xc + sg.x0 - vx
			let dy = yc + sg.y0 - vy
			sg.x0 = vx + dy - xc
			sg.y0 = vy - dx - yc
			sg.rotation = ((sg.rotation ?? 0) + 90*rad) % (360*rad)
			if (!a[i+FLOOR_EDITOR_DRAW_STATE].readonly) {
				plan.house.rotation = sg.rotation
				plan.house.edit_no++
			}
		}
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
		draw_state.plan_snap_lines = plan.house.snap_lines
		draw_state.room_points = plan.room_points
		draw_state.room_point_by_cycle = plan.room_point_by_cycle

		draw_state.above_floors.length = 0
		draw_state.below_floors.length = 0
		for (let plan1 of plan.house.floors) {
			if (plan1 == plan)
				continue
			let t = {comps: plan1.comps, segs: plan1.segs}
			let a = plan1.i > plan.i ? draw_state.above_floors : draw_state.below_floors
			a.push(t)
		}

		// the cycles of the floor below for clipping the open rooms to the
		// slab: rooms, islands and island rooms, but not the root outlines.
		draw_state.below_cycles.length = 0
		let below_plan = plan.house.floors[plan.i-1]
		if (below_plan)
			for (let co of below_plan.comps)
				for (let c of co.cycles) {
					if (c.outer && !co.inside)
						continue
					draw_state.below_cycles.push(c.edges)
				}
	},

	draw: function(a, i) {

		let x00   = a[i+0]
		let y00   = a[i+1]
		let w     = a[i+2]
		let h     = a[i+3]
		let id    = a[i+FLOOR_EDITOR_ID]

		let draw_state = a[i+FLOOR_EDITOR_DRAW_STATE]

		let cs = ui.captured(id)
		let hs = cs ?? ui.hovers(id) // while dragging, the state at drag start.
		let hit_action  = hs?.action
		let hit_seg     = hs?.seg
		let hit_p       = hs?.p
		let hit_cycle   = hs?.cycle
		let hit_room_point = hs?.room_point
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

		// grid
		draw_grids(cx, sg, w, h)

		cx.textAlign = 'left'

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
				let room_point = draw_state.room_point_by_cycle.get(c)

				// open room: background only on the slab, outside the rooms below.
				let is_open = room_point?.is_open
				if (is_open) {
					cx.save()
					cx.beginPath()
					let [x1, y1, x2, y2] = c.edges.bbox()
					cx.rect(sg.x(x1), sg.y(y1),
						sg.x(x2) - sg.x(x1), sg.y(y2) - sg.y(y1))
					for (let edges of draw_state.below_cycles)
						draw_edges(cx, sg, edges)
					cx.clip('evenodd')
				}

				cx.beginPath()

				draw_edges(cx, sg, c.edges)

				// island outer cycles are clockwise so they draw as holes.
				for (let icomp of c.islands)
					draw_edges(cx, sg, icomp.outer_cycle.edges)

				if (room_point === null) // two or more room points.
					cx.fillStyle = ui.alpha_adjust(ui.color_obj('error'), .5)
				else
					cx.fillStyle = ui.alpha_adjust(ui.color_obj('bg1',
						hit_cycle == c ? 'hover' : null), .5)
				cx.fill()

				if (is_open)
					cx.restore()
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
					let area = c.edges.area()
					for (let icomp of c.islands)
						area -= icomp.outer_cycle.edges.area()
					let s = format_area(area)
					if (DEBUG_PLAN) s = co.id + '/' + c.id + ' ' + s
					cx.save()
					cx.translate(x, y)
					if (sg.rotation)
						cx.rotate(-sg.rotation)
					cx.textAlign = 'center'
					cx.fillText(s, 0, 5)
					cx.restore()
				}
			}

		// room points: filled if open.
		for (let room_point of draw_state.room_points) {
			let r = room_point == hit_room_point ? 8 : 6
			cx.beginPath()
			cx.arc(sg.x(room_point.x), sg.y(room_point.y), r, 0, 2*PI)
			if (room_point.is_open) {
				cx.fillStyle = ui.color_css('text')
				cx.fill()
			}
			cx.strokeStyle = ui.color_css('text')
			cx.lineWidth = 2
			cx.stroke()
			cx.lineWidth = 1
		}

		// edge measurements
		let me = draw_state.measure_edges
		if (me && !sg.show_dims) {
			for (let [ep1, ep2] of me) {
				let x1 = ep1[0]
				let y1 = ep1[1]
				let x2 = ep2[0]
				let y2 = ep2[1]
				;[x1, y1, x2, y2] = line2.offset(-10, x1, y1, x2, y2, [])
				draw_length(cx, sg, x1, y1, x2, y2)
			}
		}

		// show all dimensions: interior (room cycles) and exterior (outer cycles),
		// shown always while the mode is on, drags included.
		if (sg.show_dims) {
			for (let co of draw_state.comps) {
				for (let c of co.cycles) {
					if (!c.edges)
						continue
					for (let ei = 0, n = c.edges.length; ei < n; ei++) {
						let ep1 = c.edges[ei]
						let ep2 = c.edges[(ei + 1) % n]
						let [x1, y1, x2, y2] = line2.offset(-10,
							ep1[0], ep1[1], ep2[0], ep2[1])
						draw_length(cx, sg, x1, y1, x2, y2)
					}
				}
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
			else {
				let axes_swapped = round((sg.rotation ?? 0) / (90*rad)) % 2 != 0
				ui.set_cursor(seg.is_v != axes_swapped ? 'ew-resize' : 'ns-resize')
			}
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
			cx.textAlign = 'left'
			cx.fillText(seg.id, x, y)
		}

		// point numbers
		if (DEBUG_PLAN)
		for (let p of draw_state.ps) {
			let [x0, y0] = p
			let x = sg.x(x0) - 5
			let y = sg.y(y0) + 5
			cx.fillStyle = 'white'
			cx.textAlign = 'left'
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
					cx.textAlign = 'left'
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
		cycle, room_x, room_y      inside inner cycle
		room_point,
		action=move_room_point     hit room point
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

		if (draw_state.readonly)
			return true

		cx.save()
		cx.translate(x00, y00)
		sg.transform(cx, w, h)
		ui.update_mouse()

		let mx = sg.plan_x(ui.mx)
		let my = sg.plan_y(ui.my)

		let snap_margin = 15

		let hit_p, hit_seg, hit_action, hit_cycle, hit_room_point

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

		for (let room_point of draw_state.room_points) {
			let dx = ui.mx - sg.x(room_point.x)
			let dy = ui.my - sg.y(room_point.y)
			if (abs(dx) <= 8 && abs(dy) <= 8) {
				hit_room_point = room_point
				hs.room_point = room_point
				hs.action = 'move_room_point'
				break
			}
		}

		if (!hit_p && !hit_room_point)
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
		if (!hit_p && !hit_seg && !hit_room_point) {
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
			if (hit_cycle) {
				hs.cycle = hit_cycle
				hs.room_x = mx // unsnapped, for placing a room point.
				hs.room_y = my
			}
		}

		cx.restore()
		ui.update_mouse()

		return true

	},

})

}()) // module function
