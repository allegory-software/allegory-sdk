
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
	ceil, round, snap, mod, abs, sign, min, max, clamp, PI, sin, cos, rad,
	atan2, hypot,
	array_set, empty_array, format_kcount, point_around, distance,
	json_arg, try_json_arg, json, copy_to_clipboard, S,
} = glue

const {bbox2, line2} = Math3D

// view utils ----------------------------------------------------------------

let out = []

let floor_names = [
	'GROUND FLOOR',
	'1\u02e2\u1d57 FLOOR',
	'2\u207f\u1d48 FLOOR',
	'3\u02b3\u1d48 FLOOR',
]

// plan units are mm.
let format_length = d => format_kcount(d / 1e3, 2)+'m'
let format_area = a => format_kcount(abs(a) / 1e6, 2)+' m\u00b2'

function seg_center(seg) {
	return line2.at(.5, seg[0][0], seg[0][1], seg[1][0], seg[1][1], out)
}

// floor view ----------------------------------------------------------------

function draw_grid(cx, sg, x0, y0, w, h, step, alpha) {
	if (!sg.show_grid)
		return
	if (sg.d(step) < 7)
		return
	cx.strokeStyle = ui.hsl_adjust(ui.color_obj('bg2'), 1, 1, 1, alpha)
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
	let step = 1000
	while (sg.d(step / 10) < 7)
		step *= 10
	draw_grid(cx, sg, x0, y0, w, h, step / 10, .2)
	draw_grid(cx, sg, x0, y0, w, h, step /  2, .3)
	draw_grid(cx, sg, x0, y0, w, h, step     ,  1)
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
	if (sg.scale <= 0.02) { // to small to even show edges
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
		return
	}

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
		if (sg.scale > 0.04) {
			cx.fillStyle = DEBUG_PLAN ? '#333' : cx.wall_pattern
			cx.fill('nonzero')
			cx.lineWidth = DEBUG_PLAN ? 2 : sg.line_width
			cx.strokeStyle = 'black' //ui.color_css('text')
			cx.lineJoin = 'round'
			cx.stroke()
			cx.lineJoin = 'miter'
			cx.lineWidth = 1
		} else { // too small to stroke
			cx.fillStyle = ui.color_css('text')
			cx.fill()
		}
	}
}

// find the farthest edge point from `c.edges[i0]` going in `dir` direction
// in the array, which has the same spatial direction `v` with the previous
// point.
function last_perp_edge_point(c, i, n, dir, v) {
	let ep0 = c.edges[mod(i, n)]
	while (1) {
		let ep1 = c.edges[mod(i, n)]
		let ep2 = c.edges[mod(i+dir, n)]
		if (ep2.p == ep0.p) // end-cap, don't measure
			return
		if ((ep1[0] == ep2[0]) != v) // changed direction, return last edge point
			return ep1
		i += dir
	}
}

// s: the label, default: the length.
function draw_length(cx, sg, x1, y1, x2, y2, s) {

	let d = distance(x1, y1, x2, y2)
	if (sg.d(d) < 20)
		return

	;[x1, y1, x2, y2] = line2.offset(-100, x1, y1, x2, y2)

	s ??= format_length(d)

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

// the text s centered on the plan point (x, y), upright in a rotated view.
function draw_text(cx, sg, x, y, s) {
	cx.save()
	cx.translate(sg.x(x), sg.y(y))
	if (sg.rotation)
		cx.rotate(-sg.rotation)
	cx.textAlign = 'center'
	cx.fillStyle = ui.color_css('text')
	cx.fillText(s, 0, 5)
	cx.restore()
}

// a height relative to the wall top, signed.
function format_height(h) {
	return 'h ' + (h < 0 ? '-' : '') + format_length(abs(h))
}

// the overhang width, the length and, on a sloped side, the eave height
// over the wall top of an eave side from make_roof_faces().
function draw_eave_dims(cx, sg, side, wall_z) {
	let scale = prism_union.grid_scale
	let {nx, ny} = side
	let c      = side.c      / scale
	let wall_c = side.wall_c / scale
	let e1     = side.e1     / scale
	let e2     = side.e2     / scale
	// draw_length() puts the dimension line on the right of its direction:
	// outward.
	let b1 = nx == 1 || ny == -1 ? e1 : e2
	let b2 = e1 + e2 - b1
	let b = e1 + (e2 - e1) / 4 // along the side: the width's position
	if (nx) {
		draw_length(cx, sg, c, b1, c, b2)
		draw_length(cx, sg, wall_c, b, c, b)
	} else {
		draw_length(cx, sg, b1, c, b2, c)
		draw_length(cx, sg, b, wall_c, b, c)
	}
	if (side.pitch == 90)
		return
	// outside the length's dimension line.
	let a = c + (nx + ny) * sg.plan_d(30)
	let m = (e1 + e2) / 2
	draw_text(cx, sg, nx ? a : m, nx ? m : a,
		format_height(side.eave_z - wall_z))
}

// a line between two roof faces: a ridge (level): its length, and its
// height over the wall top on the other side; a hip or valley: its length
// along the slope.
function draw_roof_line_dims(cx, sg, line, wall_z) {
	let [x1, y1, z1] = line.p
	let [x2, y2, z2] = line.q
	let d = distance(x1, y1, x2, y2)
	if (abs(z2 - z1) > 1e-5) {
		draw_length(cx, sg, x1, y1, x2, y2, format_length(hypot(d, z2 - z1)))
		return
	}
	draw_length(cx, sg, x1, y1, x2, y2)
	if (sg.d(d) < 20)
		return
	let [x3, y3, x4, y4] = line2.offset(sg.plan_d(14), x1, y1, x2, y2)
	draw_text(cx, sg, (x3 + x4) / 2, (y3 + y4) / 2, format_height(z1 - wall_z))
}

// roof labels --------------------------------------------------------------

// the plan point of the pitch label of a roof face: across from the middle
// of its longest eave side, half the face's depth inward.
function roof_label_point(face) {
	let scale = prism_union.grid_scale
	let side
	for (let side1 of face.sides)
		if (!side || side1.e2 - side1.e1 > side.e2 - side.e1)
			side = side1
	let {nx, ny} = side
	let c = side.c / scale
	let depth = 0 // inward from the eave line
	for (let ring of face.rings)
		for (let p of ring)
			depth = max(depth, (c - (nx ? p[0] : p[1])) * (nx + ny))
	let a = c - (nx + ny) * depth / 2 // across the side
	let b = (side.e1 + side.e2) / 2 / scale // along the side
	return nx ? [a, b] : [b, a]
}

function format_pitch(pitch) {
	return round(pitch * 10) / 10 + '\u00b0'
}

// roof hit testing ---------------------------------------------------------

// the eave side of the edited roof at the plan point (mx, my): on its eave
// line, 8 pixels around.
function hit_roof_side(hs, draw_state, sg, mx, my) {
	let scale = prism_union.grid_scale
	let x = mx * scale
	let y = my * scale
	let m = sg.plan_d(8) * scale
	for (let side of draw_state.roof_sides) {
		let {nx, c, e1, e2} = side
		let a = nx ? x : y // across the side
		let b = nx ? y : x // along the side
		if (b < e1 || b > e2)
			continue
		if (abs(a - c) > m)
			continue
		hs.roof_side = side
		hs.roof_x = mx // unsnapped, for placing an edge point.
		hs.roof_y = my
		hs.action = 'move_eave'
		return true
	}
	return false
}

// the line between two faces of the edited roof at the plan point (mx, my),
// 8 pixels around: the nearest shared segment.
function hit_roof_line(hs, draw_state, sg, mx, my) {
	let min_d = sg.plan_d(8)
	let found_line, found_x, found_y
	for (let line of draw_state.roof_lines) {
		let {p, q} = line
		let [px, py] = p
		let dx = q[0] - px
		let dy = q[1] - py
		let t = clamp(((mx - px) * dx + (my - py) * dy)
			/ (dx * dx + dy * dy), 0, 1)
		let x = px + t * dx // the point of p-q nearest to (mx, my)
		let y = py + t * dy
		let d = distance(mx, my, x, y)
		if (d >= min_d)
			continue
		min_d = d
		found_line = line
		found_x = x
		found_y = y
	}
	if (!found_line)
		return false
	let {face1, face2} = found_line
	let [a, b, c] = face1.plane
	hs.roof_faces = [face1, face2]
	hs.roof_x = found_x // grabbed point, on the line.
	hs.roof_y = found_y
	hs.roof_z = a * found_x + b * found_y + c
	hs.action = 'move_faces'
	return true
}

// the point where three or more faces of the edited roof meet (a ridge end,
// a peak) at the plan point (mx, my), 8 pixels around: the nearest end of a
// shared segment.
function hit_roof_point(hs, draw_state, sg, mx, my) {
	let min_d = sg.plan_d(8)
	let found_p
	for (let line of draw_state.roof_lines)
		for (let i = 0; i < 2; i++) {
			let p = i ? line.q : line.p
			let d = distance(mx, my, p[0], p[1])
			if (d >= min_d)
				continue
			min_d = d
			found_p = p
		}
	if (!found_p)
		return false
	let [x, y, z] = found_p
	let faces = [] // faces of the segments that end at found_p
	for (let line of draw_state.roof_lines) {
		let {p, q, face1, face2} = line
		let is_end = distance(x, y, p[0], p[1]) < 1e-2
			|| distance(x, y, q[0], q[1]) < 1e-2
		if (!is_end)
			continue
		if (!faces.includes(face1)) faces.push(face1)
		if (!faces.includes(face2)) faces.push(face2)
	}
	if (faces.length < 3)
		return false
	hs.roof_faces = faces
	hs.roof_x = x // grabbed point.
	hs.roof_y = y
	hs.roof_z = z
	hs.action = 'move_faces'
	return true
}

// the pitch label of a face of the edited roof at the screen point
// (ui.mx, ui.my).
function hit_roof_label(hs, draw_state, sg) {
	let axes_swapped = round((sg.rotation ?? 0) / (90*rad)) % 2 != 0
	let w = axes_swapped ? 10 : 20 // half sizes of the label's box
	let h = axes_swapped ? 20 : 10
	for (let face of draw_state.roof_faces) {
		let [x, y] = roof_label_point(face)
		x = sg.x(x)
		y = sg.y(y)
		if (!ui.hit_bbox(x - w, y - h, x + w, y + h))
			continue
		hs.roof_face = face
		hs.action = 'move_pitch'
		return true
	}
	return false
}

// objects -------------------------------------------------------------------

// the topmost of `objects` at the screen point (ui.mx, ui.my).
function hit_object_in(objects, plan, hs, sg) {
	for (let i = objects.length-1; i >= 0; i--) {
		let object = objects[i]
		if (!house_object_types[object.type].hit(sg, plan, object))
			continue
		hs.object = object
		hs.object_x = object.x // where the drag starts from
		hs.object_y = object.y
		hs.action = 'move_object'
		return true
	}
	return false
}

// the hovered object in the link color, objects on the ground in the readonly
// text color.
function draw_objects(cx, sg, plan, objects, hit_object, is_ground) {
	cx.lineWidth = 2
	for (let object of objects) {
		cx.strokeStyle = object == hit_object ? ui.color_css('link')
			: ui.color_css('text', is_ground ? 'readonly' : null)
		house_object_types[object.type].draw(cx, sg, plan, object)
	}
	cx.lineWidth = 1
}

// the face of this frame's roof in the plane of the side from an earlier
// frame's roof: the same side has the same wall line and extent.
function find_roof_face(faces, side0) {
	let {nx, ny, wall_c, m1, m2} = side0
	for (let face of faces)
		for (let side of face.sides)
			if (side.nx == nx && side.ny == ny && side.wall_c == wall_c
				&& side.m1 == m1 && side.m2 == m2
			)
				return face
}

// settings ------------------------------------------------------------------

function setting_field(min, max) {
	return ui.create_field({type: 'number', min: min, max: max, decimals: 1})
}

// the house settings that the editor changes. their sliders are in cm.
let settings = [
	{name: 'int_wall_thickness', field: setting_field(2, 50),
		label: () => S('int_wall_thickness', 'Interior wall thickness (cm)')},
	{name: 'ext_wall_thickness', field: setting_field(2, 80),
		label: () => S('ext_wall_thickness', 'Exterior wall thickness (cm)')},
	{name: 'slab_thickness', field: setting_field(5, 100),
		label: () => S('slab_thickness', 'Slab thickness (cm)')},
	{name: 'roof_thickness', field: setting_field(5, 100),
		label: () => S('roof_thickness', 'Roof thickness (cm)')},
	{name: 'floor_h', field: setting_field(150, 600),
		label: () => S('floor_height', 'Floor height (cm)')},
]

// floor editor updates ------------------------------------------------------

function select_floor(id, s, floor, is_roof_level) {
	s.floor = floor
	s.is_roof_level = is_roof_level
	ui.save_state(id, 'floor', floor.i)
	ui.save_state(id, 'is_roof_level', is_roof_level)
}

function floor_editor_update(id, s) {
	s.interaction_value = undefined
	if (!s.house)
		return
	let plan = s.floor
	let readonly = s.readonly
	let draw_state = s.draw_state
	let floor0 = s.floor
	let is_roof_level0 = s.is_roof_level
	let edit_no0 = s.house.edit_no
	let floors = s.house.floors
	for (let floor of floors)
		if (ui.clicked(id+'.floor'+floor.i))
			select_floor(id, s, floor, false)
	if (ui.clicked(id+'.roof'))
		select_floor(id, s, floors[floors.length-1], true)
	if (ui.state_of(id+'.add_floor_button', 'state') == 'click') {
		select_floor(id, s, s.house.add_floor(), false)
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

	// copy and paste the whole house as json text, or the hovered object. a
	// pasted object goes where it would go if dropped at the pointer.
	if (!cs && ui.focus_inside(id) && ui.keydown('ctrl c')) {
		let object = ui.hit(id)?.object
		copy_to_clipboard(json(object ? s.house.save_object(object)
			: s.house.save_state()))
	}
	if (!readonly && !cs && ui.focus_inside(id) && ui.keydown('paste')) {
		let state = try_json_arg(ui.clipboard_text)
		let hs0 = ui.hit(id)
		if (state?.floors?.length) {
			try {
				plan.house.load_state(state)
				is_restored = true
			} catch {
				// bad state: load_state restored the house, ignore the paste.
			}
		} else if (hs0 && state) {
			try {
				plan.add_object(state, hs0.mouse_x, hs0.mouse_y, 200)
			} catch {
				// not an object: add_object added nothing, ignore the paste.
			}
		}
	}

	// removed the selected floor, or undid an added floor or redid a removed
	// one, or pasted or undid a paste: select the top floor.
	floors = s.house.floors // paste and its undo replace the array.
	if (!floors.includes(s.floor) || is_restored && s.is_roof_level)
		select_floor(id, s, floors[floors.length-1], s.is_roof_level)
	// the roof level: the top floor's roof.
	if (s.is_roof_level)
		s.floor = floors[floors.length-1]
	plan = s.floor
	if (plan != floor0) {
		draw_state.snap_lines.length = 0
	}

	let sg = s

	let is_rotated = ui.state_of(id+'.rotate_button', 'state') == 'click'
	if (is_rotated) {
		let bb = s.house.bb
		let is_empty = bb[0] > bb[2]
		sg.rotate_90(is_empty ? sg.cx : (bb[0] + bb[2]) / 2,
			is_empty ? sg.cy : (bb[1] + bb[3]) / 2)
		save_floor_view(id, s)
	}
	if (ui.state_of(id+'.zoom_button', 'state') == 'click')
		sg.reset_zoom()

	// the settings: one house edit per run of frames with user input.
	let edited_name, edited_value // the setting the user is changing, in cm
	for (let setting of settings) {
		let value = ui.interaction_value(id+'.setting.'+setting.name)
		if (value != null) { // a cleared input has no value to set.
			edited_name = setting.name
			edited_value = value
		}
	}
	if (s.setting_edit && s.setting_name != edited_name) {
		s.setting_edit.stop()
		s.setting_edit = null
	}
	if (edited_name) {
		s.setting_name = edited_name
		s.setting_edit ??= s.house.start_edit_setting(edited_name)
		s.setting_edit.move(edited_value * 10)
	}

	let hs = ui.hit(id)
	if (hs && ui.wheel_dy) {
		sg.zoom_at(ui.wheel_dy / ui.em(7), hs.mx, hs.my)
		save_floor_view(id, s)
	}

	if (cs) {

		let dx = sg.plan_d(cs.dx)
		let dy = sg.plan_d(cs.dy)
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
				cs.edit = plan.start_move_seg(seg)
			} else if (action == 'pan') {
				sg.pan_cx0 = sg.cx
				sg.pan_cy0 = sg.cy
			}
		}

		let action = cs.action

		if (cs.cancel) {
			cs.edit?.cancel()
		} else {
			let nosnap = ui.keypressed('ctrl')
			// past the drag threshold, or with ctrl at the first movement: a
			// press without movement starts no edit, so a double-click can.
			let is_moved = cs.moved || nosnap && !!(cs.dx || cs.dy)
			let is_resize_drag = abs(dx) >= 100 || abs(dy) >= 100

			if (!readonly && !s.is_roof_level && !action && is_resize_drag) { // dragged far enough to assume intent to drag.

				// establish direction of drag on x and y axis.
				let sdx = abs(dx) > 1.5 * abs(dy) ? sign(dx) : 0 // straight enough
				let sdy = abs(dy) > 1.5 * abs(dx) ? sign(dy) : 0 // straight enough
				if (sdx || sdy) {
					action = 'resize_seg'
					cs.action = action
					let p   = cs.p
					let mx0 = cs.x
					let my0 = cs.y
					cs.edit = plan.start_resize_seg(p, mx0, my0, dx, dy, sdx, sdy)
				}

			}

			if (action == 'move_seg')
				cs.edit.move(dx, dy, nosnap ? 20 : 200)

			if (action == 'resize_seg')
				[cs.x, cs.y] = cs.edit.resize(dx, dy, nosnap ? 20 : 300)

			if (action == 'move_seg' || action == 'resize_seg') {
				let {snap_a, snap_v} = cs.edit
				if (snap_a !== undefined) {
					draw_state.snap_lines.length = 0
					if (snap_a != null)
						draw_state.snap_lines.push(snap_a, snap_v)
				}
			}

			// a room point moves only past the drag threshold or with ctrl: a
			// click toggles its room instead.
			if (action == 'move_room_point') {
				if (is_moved)
					cs.edit ??= plan.start_move_room_point(cs.room_point)
				cs.edit?.move(dx, dy)
			}

			// an object moves only past the drag threshold or with ctrl.
			if (action == 'move_object') {
				if (is_moved)
					cs.edit ??= plan.start_move_object(cs.object)
				cs.edit?.move(cs.object_x + dx, cs.object_y + dy,
					nosnap ? 20 : 200)
			}

			// an eave moves only past the drag threshold or with ctrl: a click
			// toggles its gable instead. shift: all eaves of its kind.
			if (action == 'move_eave') {
				let roof_floor = draw_state.roof_floor
				if (is_moved && !cs.edit) {
					// the across positions of the eave corners, where hips and
					// valleys meet eave lines, to line the eave up with: the
					// lines of the parallel eave sides and the ends of the
					// others.
					let snap_cs = [] // [c, ...] in plan units
					let scale = prism_union.grid_scale
					for (let side of draw_state.roof_sides)
						if (!side.nx == !cs.roof_side.nx)
							snap_cs.push(side.c / scale)
						else
							snap_cs.push(side.e1 / scale, side.e2 / scale)
					cs.edit = roof_floor.start_move_eave(cs.roof_side,
						cs.roof_x, cs.roof_y, snap_cs)
				}
				if (cs.edit)
					cs.can_move_eave = cs.edit.move(dx, dy,
						!ui.keypressed('shift'), nosnap ? 0 : 200)
			}

			// the line or point where roof faces meet follows the pointer at
			// the grabbed height, past the drag threshold or with ctrl.
			if (action == 'move_faces') {
				let roof_floor = draw_state.roof_floor
				if (is_moved)
					cs.edit ??= roof_floor.start_move_faces(
						cs.roof_faces, cs.roof_z)
				if (cs.edit)
					cs.can_move_faces = cs.edit.move(
						cs.roof_x + dx, cs.roof_y + dy)
			}

			// a pitch label moves at the first movement: up is steeper, 4
			// pixels per degree, in whole degrees (ctrl: tenths). shift: all
			// sloped faces.
			if (action == 'move_pitch') {
				let d_pitch = snap(-cs.dy / 4, nosnap ? .1 : 1)
				if (cs.dx || cs.dy)
					cs.edit ??= draw_state.roof_floor.start_move_pitch(
						cs.roof_face)
				if (cs.edit)
					cs.can_move_pitch = cs.edit.move(d_pitch,
						!ui.keypressed('shift'))
			}

			if (action == 'pan')
				sg.pan_to(sg.pan_cx0 - dx, sg.pan_cy0 - dy)

			if (cs.drop)
				cs.edit?.stop()
		}

	}

	if (cs?.drop || cs?.cancel)
		save_floor_view(id, s)

	let is_deleting_seg = !readonly
		&& hs?.action == 'move_seg' && ui.dblclick
	if (is_deleting_seg) {
		plan.delete_seg(hs.seg)
	}

	// double-clicked an eave side: remove its edge point.
	let is_resetting_eave = !readonly
		&& hs?.action == 'move_eave' && ui.dblclick && hs.roof_side.edge_point
	if (is_resetting_eave)
		draw_state.roof_floor.remove_edge_point(hs.roof_side.edge_point)

	// double-clicked a line or point where roof faces meet: the faces back
	// to the roof's pitch.
	let is_resetting_faces = !readonly
		&& hs?.action == 'move_faces' && ui.dblclick
	if (is_resetting_faces)
		draw_state.roof_floor.reset_faces(hs.roof_faces)

	// double-clicked a pitch label: the face back to the roof's pitch.
	let is_resetting_pitch = !readonly
		&& hs?.action == 'move_pitch' && ui.dblclick
	if (is_resetting_pitch)
		draw_state.roof_floor.reset_faces([hs.roof_face])

	// clicked inside a room without dragging: open or close the room. ctrl:
	// a move, not a click.
	let is_toggling_room = !readonly && cs?.drop && !cs.cancel && !cs.moved
		&& !cs.edit && !ui.keypressed('ctrl') && (!cs.action || cs.action == 'move_room_point') && cs.cycle
	if (is_toggling_room)
		plan.toggle_room(cs.cycle, cs.room_x, cs.room_y)

	// clicked an eave side without dragging: switch it between gable and
	// the roof's pitch. ctrl: a move, not a click.
	let is_toggling_gable = !readonly && cs?.drop && !cs.cancel && !cs.moved
		&& !cs.edit && !ui.keypressed('ctrl') && cs.action == 'move_eave'
	if (is_toggling_gable)
		draw_state.roof_floor.toggle_gable(cs.roof_side, cs.roof_x, cs.roof_y)

	let is_removing_object = !readonly && !cs && hs?.object
		&& ui.focus_inside(id) && ui.keydown('delete')
	if (is_removing_object)
		plan.remove_object(hs.object)

	// keys on the hovered wall or object: a/s/d/w and the arrow keys move it
	// 1 cm on the screen, an object's type uses its own keys.
	let is_keyed = !readonly && !cs && ui.focused_id == id
		&& (hs?.object || hs?.action == 'move_seg')
	if (is_keyed) {
		let kx = 0
		let ky = 0
		if (!ui.keypressed('ctrl') && !ui.keypressed('alt')) {
			if (ui.keydown('a') || ui.keydown('arrowleft')) kx--
			if (ui.keydown('d') || ui.keydown('arrowright')) kx++
			if (ui.keydown('w') || ui.keydown('arrowup')) ky--
			if (ui.keydown('s') || ui.keydown('arrowdown')) ky++
		}
		if (kx || ky) {
			let r = sg.rotation ?? 0
			let dx = round(kx * cos(r) + ky * sin(r)) * 10
			let dy = round(-kx * sin(r) + ky * cos(r)) * 10
			if (hs.object) {
				let edit = plan.start_move_object(hs.object)
				edit.move(hs.object.x + dx, hs.object.y + dy, 20)
				edit.stop()
			} else {
				let edit = plan.start_move_seg(hs.seg)
				edit.move(dx, dy, 0)
				edit.stop()
			}
		}
		let update = hs.object && house_object_types[hs.object.type].update
		if (update)
			update(plan, hs.object)
	}

	let is_removing_room_point = !readonly && !cs && hs?.room_point
		&& ui.focus_inside(id) && ui.keydown('delete')
	if (is_removing_room_point)
		plan.remove_room_point(hs.room_point)

	if (cs?.drop || cs?.cancel || is_deleting_seg || is_removing_room_point
		|| is_resetting_eave || is_resetting_faces || is_resetting_pitch
		|| is_restored
	) {
		draw_state.snap_lines.length = 0
	}

	// the hit phase ran before this update: changed house or view: hit
	// again in a second pass of this frame.
	let is_changed = s.house.edit_no != edit_no0 || cs?.drop || cs?.cancel
		|| plan != floor0 || s.is_roof_level != is_roof_level0
		|| hs && ui.wheel_dy || is_rotated
	if (is_changed)
		ui.rebuild('floor_editor_changed')

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

// floor editor widget -------------------------------------------------------

const saved_view_fields = ['rotation', 'scale', 'cx', 'cy']

function save_floor_view(id, s) {
	if (!s.view_dirty)
		return
	for (let k of saved_view_fields)
		ui.save_state(id, k, s[k])
	s.view_dirty = false
}

let FLOOR_EDITOR_ID         = ui.BOX_ARGS+0
let FLOOR_EDITOR_PLAN       = ui.BOX_ARGS+1
let FLOOR_EDITOR_DRAW_STATE = ui.BOX_ARGS+2
let FLOOR_EDITOR_VIEW       = ui.BOX_ARGS+3

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
			let ss = ui.saved_state[id]
			s.is_roof_level = ss?.is_roof_level ?? false
			let floors = s.house?.floors
			s.floor = floors?.[s.is_roof_level ? floors.length-1
				: min(ss?.floor ?? 0, floors.length-1)]
			s.value_edit_no = 0 // house.edit_no of the value loaded or published
			s.setting_edit = null // the edit of the replaced house
		}
		if (!s.d) {
			s.show_grid = ui.saved_state.floor_editor?.show_grid
			s.show_dims = ui.saved_state.floor_editor?.show_dims
			let ss = ui.saved_state[id]
			s.rotation = ss?.rotation ?? 0
			s.scale = ss?.scale
			s.cx = ss?.cx // plan point at the center of the viewport
			s.cy = ss?.cy
			s.zoomed = s.scale != null // fixed view or fit to the plan
			s.view_dirty = false
			let line_width = 2 // thickness of wall line stroke in pixels at 1:1 scale
			s.d = d => round(d * s.scale * devicePixelRatio)
			s.x = x => round(x * s.scale * devicePixelRatio)
			s.y = y => round(y * s.scale * devicePixelRatio)
			s.plan_x = x => x / (s.scale * devicePixelRatio)
			s.plan_y = y => y / (s.scale * devicePixelRatio)
			s.plan_d = d => d / (s.scale * devicePixelRatio)
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
				s.scale = sc
				// snap line width to an even number for sharpness
				s.line_width = snap(line_width * sc * devicePixelRatio, 2)
			}
			let bb = bbox2()
			// set the scale and the origin (x0, y0, in pixels from widget's origin)
			// of a viewport of w x h pixels: fitted to the plan bounding box bb1, or
			// from the saved view. returns true if fitted to a non-empty plan.
			s.layout = function(bb1, w, h) {
				let is_fitted = !s.zoomed && bb1[0] <= bb1[2]
				if (is_fitted) {
					s.view_dirty = true
					let margin = ceil(ui.em(2) + line_width)
					array_set(bb, bb1)
					bb.rotate(s.rotation)
					let [x1, y1, x2, y2] = bb
					s.scale = min(
						(w - 2 * margin) / (x2 - x1),
						(h - 2 * margin) / (y2 - y1)
					) / devicePixelRatio
					s.cx = (bb1[0] + bb1[2]) / 2
					s.cy = (bb1[1] + bb1[3]) / 2
				} else if (!s.zoomed) { // empty plan.
					s.scale = .1
					s.cx = 0
					s.cy = 0
				}
				set_scale(s.scale)
				s.x0 = round(w / 2) - s.x(s.cx)
				s.y0 = round(h / 2) - s.y(s.cy)
				return is_fitted
			}
			// zoom around the point (mx, my) in pixels from the center of the
			// viewport, along the plan's axes.
			s.zoom_at = function(d, mx, my) {
				if (!d) return
				let plan_x = s.cx + s.plan_x(mx)
				let plan_y = s.cy + s.plan_y(my)
				let scale1 = clamp(s.scale * 1.2 ** -d, 0.01, 1)
				s.cx = plan_x - mx / (scale1 * devicePixelRatio)
				s.cy = plan_y - my / (scale1 * devicePixelRatio)
				set_scale(scale1)
				s.zoomed = true
				s.view_dirty = true
			}
			s.pan_to = function(cx, cy) {
				s.cx = cx
				s.cy = cy
				s.zoomed = true
				s.view_dirty = true
			}
			// rotate the view by 90 degrees around the plan point (bx, by): it stays
			// where it is on screen.
			s.rotate_90 = function(bx, by) {
				let dx = bx - s.cx
				let dy = by - s.cy
				s.cx = bx - dy
				s.cy = by + dx
				s.rotation = (s.rotation + 90*rad) % (360*rad)
				s.view_dirty = true
			}
			s.reset_zoom = function() {
				s.zoomed = false
			}
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
			above_floors: [],
			below_floors: [],
			below_cycles: [], // [edges, ...] of the floor below, except outlines
			roof_faces: [], // roof_floor's make_roof_faces()
			roof_sides: [], // roof_floor's eave sides from make_roof_faces()
			roof_lines: [], // [{p, q, face1, face2}, ...] shared roof segments
		}
		let draw_state = s.draw_state
		let plan = s.floor
		draw_state.readonly = s.readonly
		draw_state.is_roof_level = s.is_roof_level
		// the floor whose roof is edited: the floor below; the roof level:
		// the top floor.
		draw_state.roof_floor = s.is_roof_level
			? plan : plan.house.floors[plan.i-1]
		let sg = s

		ui.stack()

			ui.cmd_box(cmd, 1, 's', 's', id, plan, draw_state, sg)

			ui.m(ui.sp())
			ui.v(1, ui.sp())

				ui.h(0, ui.sp05(), 's', 't')

					ui.v(0, ui.sp05(), '[')
						let floors = plan.house.floors
						ui.color('text', s.is_roof_level ? 'active' : null)
						ui.bold()
						ui.text(id+'.roof', S('roof', 'ROOF'))
						for (let i = floors.length-1; i >= 0; i--) {
							let floor = floors[i]
							ui.color('text', floor == plan && !s.is_roof_level
								? 'active' : null)
							ui.bold()
							ui.text(id+'.floor'+floor.i, floor_names[floor.i]
								?? S(floor.i+'_floor', '{0}\u1d57\u02b0 FLOOR', floor.i))
						}
						if (!s.readonly) {
							ui.mt(ui.em(1))
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

					if (sg.zoomed)
						ui.button(id+'.zoom_button',
							sg.scale > .1 ? 'zoom-in' : 'zoom-out', '',
							0, 'c', 't', null, null,
							S('fit_to_view', 'Fit to view'))

					ui.button(id+'.rotate_button', 'rotate-rectangle', '',
						0, 'c', 't', null, null,
						S('rotate_90_degrees', 'Rotate 90 degrees'))

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

					if (ui.popup_button(id+'.settings', 'settings', null,
						'c', 't', 'b', ']')
					) {
						ui.min_w(ui.em(24))
						ui.v_aligned(0, ui.sp(), 's', 't')
							for (let setting of settings) {
								let setting_id = id+'.setting.'+setting.name
								ui.h(0, ui.sp1(), 's', 'c')
									ui.label(setting_id, setting.label(), 0)
									ui.num_slider(setting_id,
										plan.house[setting.name] / 10, setting.field,
										1, null, null, s.readonly)
								ui.end_h()
							}
						ui.end_v_aligned()
						ui.end_popup_button(id+'.settings')
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
		if (!axis)
			return
		let sg = a[i+FLOOR_EDITOR_VIEW]
		let w  = a[i+2]
		let h  = a[i+3]
		let plan = a[i+FLOOR_EDITOR_PLAN]
		let is_fitted = sg.layout(plan.house.bb, w, h)
		// lock the fitted view, like a manual zoom.
		if (is_fitted) {
			sg.zoomed = true
			save_floor_view(a[i+FLOOR_EDITOR_ID], sg)
		}
	},

	translate: function(a, i, dx, dy) {
		ui.box_translate(a, i, dx, dy)
		let x00 = a[i+0]
		let y00 = a[i+1]
		let plan = a[i+FLOOR_EDITOR_PLAN]
		let draw_state = a[i+FLOOR_EDITOR_DRAW_STATE]

		let sg = a[i+FLOOR_EDITOR_VIEW]

		draw_state.x0 = sg.x0
		draw_state.y0 = sg.y0
		draw_state.scale = sg.scale
		draw_state.rotation = sg.rotation

		// pick what parts of the plan to send over the network for drawing
		// and in which format. note that the plan has arrays with props but
		// the props will not be sent over because of how json works.
		// the roof level: the top floor's walls are drawn like a floor below
		// and not edited.
		let is_roof_level = draw_state.is_roof_level
		draw_state.comps = is_roof_level ? empty_array : plan.comps
		draw_state.segs = is_roof_level ? empty_array : plan.segs // TODO: remove this from draw stream
		draw_state.ps = is_roof_level ? empty_array : plan.ps // TODO: remove this from draw stream
		draw_state.plan_snap_lines = plan.house.snap_lines
		draw_state.room_points = is_roof_level ? empty_array : plan.room_points
		draw_state.room_point_by_cycle = plan.room_point_by_cycle
		draw_state.objects = is_roof_level ? empty_array : plan.objects
		draw_state.ground_objects = is_roof_level ? empty_array
			: plan.house.ground_objects

		// the roof of roof_floor: its faces and its eave sides.
		let roof_floor = draw_state.roof_floor
		let roof_geometry_no = plan.house.roof_geometry_no
		if (draw_state.roof_floor0 != roof_floor
			|| draw_state.roof_geometry_no != roof_geometry_no
		) {
			draw_state.roof_sides.length = 0
			draw_state.roof_lines.length = 0
			draw_state.roof_faces = []
			if (roof_floor) {
				let roof_areas = []
				for (let area of roof_floor.make_areas())
					if (area.kind == 'roof')
						roof_areas.push(area)
				if (roof_areas.length)
					draw_state.roof_faces = roof_floor.make_roof_faces(roof_areas,
						draw_state.roof_sides, draw_state.roof_lines)
			}
			draw_state.roof_floor0 = roof_floor
			draw_state.roof_geometry_no = roof_geometry_no
		}

		draw_state.above_floors.length = 0
		draw_state.below_floors.length = 0
		for (let plan1 of plan.house.floors) {
			if (plan1 == plan && !is_roof_level)
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
		let plan  = a[i+FLOOR_EDITOR_PLAN]

		let draw_state = a[i+FLOOR_EDITOR_DRAW_STATE]

		let cs = ui.captured(id)
		let hs = cs ?? ui.hovers(id) // while dragging, the state at drag start.
		let hit_action  = hs?.action
		let hit_seg     = hs?.seg
		let hit_p       = hs?.p
		let hit_cycle   = hs?.cycle
		let hit_room_point = hs?.room_point
		let hit_object = hs?.object
		let hit_roof_side = hs?.roof_side
		let hit_roof_faces = hs?.roof_faces
		let hit_roof_face  = hs?.roof_face
		let hit_x      = hs?.x
		let hit_y       = hs?.y
		let drag_action = cs?.action
		let drag_seg    = cs?.seg

		let sg = a[i+FLOOR_EDITOR_VIEW]

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
		let mm = 1000
		let d = sg.d(mm)
		while (d > w - 2*m) {
			mm /= 5
			d = sg.d(mm)
		}
		cx.beginPath()
		let t = 4
		let x = w - d - m - t
		let y = h - m - t
		cx.rect(x, y, d, t)
		cx.fillStyle = ui.color_css('label')
		cx.fill()
		let s = format_length(mm)
		let tw = ui.measure_text(s).width
		cx.fillText(s, x + d - tw, y - 2)
		}

		// help
		{
		let m = ui.em()
		cx.fillStyle = ui.color_css('label')
		// the keys that apply to what is under the pointer.
		let s = hit_roof_side ? 'CTRL=No Snap  SHIFT=All Eaves'
			: hit_roof_face ? 'CTRL=Fine  SHIFT=All Faces'
			: hit_object ? 'CTRL=No Snap  DEL=Remove  CTRL+C=Copy'
			: 'CTRL=No Snap  SHIFT=Pan'
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

		// roof of roof_floor: the outlines of its faces. hovered or dragged
		// eave side: its eave line.
		cx.strokeStyle = ui.color_css('label')
		for (let face of draw_state.roof_faces) {
			cx.beginPath()
			for (let ring of face.rings)
				draw_edges(cx, sg, ring)
			cx.stroke()
		}
		// hovered or dragged: hit_roof_side is from an earlier frame's roof
		// (hovered: the hit phase; dragged: the drag start); the same side of
		// this frame's roof has the eave line.
		let roof_side = hit_roof_side
		if (roof_side) {
			let {nx, ny, wall_c, m1, m2} = roof_side
			roof_side = null
			for (let side of draw_state.roof_sides)
				if (side.nx == nx && side.ny == ny && side.wall_c == wall_c
					&& side.m1 == m1 && side.m2 == m2
				) {
					roof_side = side
					break
				}
		}
		// the eave sides that move with it: only it; dragged with shift: all
		// of its kind (sloped or gable).
		let is_one = !(drag_action == 'move_eave' && ui.keypressed('shift'))
		let moved_sides = [] // [side, ...] of this frame's roof
		if (roof_side)
			for (let side of draw_state.roof_sides)
				if (is_one ? side == roof_side
					: (side.pitch == 90) == (roof_side.pitch == 90))
					moved_sides.push(side)
		if (moved_sides.length) {
			let scale = prism_union.grid_scale
			cx.beginPath()
			for (let side of moved_sides) {
				let c  = side.c  / scale
				let e1 = side.e1 / scale
				let e2 = side.e2 / scale
				if (side.nx) {
					cx.moveTo(sg.x(c), sg.y(e1))
					cx.lineTo(sg.x(c), sg.y(e2))
				} else {
					cx.moveTo(sg.x(e1), sg.y(c))
					cx.lineTo(sg.x(e2), sg.y(c))
				}
			}
			cx.strokeStyle = ui.color_css('link')
			cx.lineWidth = 3
			cx.stroke()
			cx.lineWidth = 1
		}
		// hovered or dragged line or point where faces meet: the shared
		// segments between any two of the faces. hit_roof_faces are from an
		// earlier frame's roof (hovered: the hit phase; dragged: the drag
		// start); the faces of this frame's roof in the same planes have the
		// segments.
		let hit_lines = [] // [line, ...] of this frame's roof
		if (hit_roof_faces) {
			let roof_faces = [] // [face, ...] of this frame's roof
			for (let face of hit_roof_faces)
				roof_faces.push(
					find_roof_face(draw_state.roof_faces, face.sides[0]))
			cx.beginPath()
			for (let line of draw_state.roof_lines) {
				let {p, q, face1, face2} = line
				let is_shared = roof_faces.includes(face1)
					&& roof_faces.includes(face2)
				if (!is_shared)
					continue
				hit_lines.push(line)
				cx.moveTo(sg.x(p[0]), sg.y(p[1]))
				cx.lineTo(sg.x(q[0]), sg.y(q[1]))
			}
			cx.strokeStyle = ui.color_css('link')
			cx.lineWidth = 3
			cx.stroke()
			cx.lineWidth = 1
		}

		// roof measurements: of the dragged eave sides and lines; all of
		// them while all dimensions are shown.
		let roof_floor = draw_state.roof_floor
		if (roof_floor) {
			let wall_z = roof_floor.z + roof_floor.h
			let sides = sg.show_dims ? draw_state.roof_sides
				: drag_action == 'move_eave' ? moved_sides : empty_array
			for (let side of sides)
				draw_eave_dims(cx, sg, side, wall_z)
			let lines = sg.show_dims ? draw_state.roof_lines
				: drag_action == 'move_faces' ? hit_lines : empty_array
			for (let line of lines)
				draw_roof_line_dims(cx, sg, line, wall_z)
		}

		// pitch labels of the roof's faces. hit_roof_face is from an earlier
		// frame's roof, like the line's faces above. highlighted: the hit
		// face's label; dragged with shift: the labels of all sloped faces.
		let label_face = hit_roof_face
			&& find_roof_face(draw_state.roof_faces, hit_roof_face.sides[0])
		let is_all_faces = drag_action == 'move_pitch'
			&& ui.keypressed('shift')
		for (let face of draw_state.roof_faces) {
			let is_lit = face == label_face
				|| is_all_faces && face.sides[0].pitch != 90
			let [x, y] = roof_label_point(face)
			cx.save()
			cx.translate(sg.x(x), sg.y(y))
			if (sg.rotation)
				cx.rotate(-sg.rotation)
			cx.textAlign = 'center'
			cx.fillStyle = ui.color_css(is_lit ? 'link' : 'label')
			cx.fillText(format_pitch(face.sides[0].pitch), 0, 5)
			cx.restore()
		}

		// cycles area
		if (sg.scale > 0.04)
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
						area += icomp.outer_cycle.edges.area()
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

		// objects: the ground's under the floor's.
		draw_objects(cx, sg, plan, draw_state.ground_objects, hit_object, true)
		draw_objects(cx, sg, plan, draw_state.objects, hit_object, false)

		// find all affected _|_ edges so we can show their lengths as we move
		// the seg
		if (drag_action == 'move_seg' && !sg.show_dims) {
			let sp1 = drag_seg[0]
			let sp2 = drag_seg[1]
			let v = drag_seg.is_v
			for (let co of draw_state.comps) {
				for (let c of co.cycles) {
					for (let i = 0, n = c.edges.length; i <= n; i++) {
						let ep1 = c.edges[(i+0) % n]
						let ep2 = c.edges[(i+1) % n]
						if (!(ep1.p == sp1 && ep2.p == sp2
							|| ep1.p == sp2 && ep2.p == sp1)) // not seg's edge
							continue
						let ep0 = last_perp_edge_point(c, i+0, n, -1, !v)
						let ep3 = last_perp_edge_point(c, i+1, n,  1, !v)
						if (!(ep0 || ep3))
							continue
						if (ep0)
							draw_length(cx, sg, ep0[0], ep0[1], ep1[0], ep1[1])
						if (ep3)
							draw_length(cx, sg, ep2[0], ep2[1], ep3[0], ep3[1])
					}
				}
			}
		}

		// drawing a wall: its length on each side.
		if (drag_action == 'resize_seg' && !sg.show_dims) {
			let sp1 = cs.edit.seg[0]
			let sp2 = cs.edit.seg[1]
			for (let co of draw_state.comps) {
				for (let c of co.cycles) {
					if (!c.edges)
						continue
					for (let i = 0, n = c.edges.length; i < n; i++) {
						let ep1 = c.edges[i]
						let ep2 = c.edges[(i+1) % n]
						if (ep1.p == sp1 && ep2.p == sp2
							|| ep1.p == sp2 && ep2.p == sp1)
							draw_length(cx, sg, ep1[0], ep1[1], ep2[0], ep2[1])
					}
				}
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
						draw_length(cx, sg, ep1[0], ep1[1], ep2[0], ep2[1])
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

		// cursor
		let seg = drag_action == 'move_seg' && drag_seg || (hit_action == 'move_seg' && hit_seg)
		let axes_swapped = round((sg.rotation ?? 0) / (90*rad)) % 2 != 0
		if (seg) {
			if (seg[0].segs.length == 1 && seg[1].segs.length == 1)
				ui.set_cursor('move')
			else {
				ui.set_cursor(seg.is_v != axes_swapped ? 'ew-resize' : 'ns-resize')
			}
		} else if (hit_roof_side) {
			// no shift on an eave side with 2+ edge points: no own overhang.
			// pressed without a move started: a click that cannot toggle the
			// gable.
			let is_blocked = cs?.can_move_eave === false || cs && !cs.edit
				&& !draw_state.roof_floor.can_toggle_gable(hit_roof_side)
			ui.set_cursor(is_blocked ? 'not-allowed'
				: !!hit_roof_side.nx != axes_swapped ? 'ew-resize' : 'ns-resize')
		} else if (hit_roof_face) {
			// no shift on a face with a side with 2+ edge points: no own
			// pitch.
			ui.set_cursor(cs?.can_move_pitch === false ? 'not-allowed'
				: 'ns-resize')
		} else if (hit_roof_faces) {
			// grabbed at or below the wall top, a side with 2+ edge points,
			// or moved onto or past all faces' wall lines: blocked.
			let is_blocked = cs?.edit ? cs.can_move_faces === false
				: !draw_state.roof_floor.can_move_faces(
					hit_roof_faces, hs.roof_z)
			ui.set_cursor(is_blocked ? 'not-allowed' : 'move')
		} else if (hit_object) {
			ui.set_cursor(cs ? 'grabbing' : 'grab')
		} else if (hit_p)
			ui.set_cursor('copy')
		else if (drag_action == 'pan')
			ui.set_cursor('grabbing')
		else if (hs) {
			if (hit_action == 'pan')
				ui.set_cursor('grab')
			else if (draw_state.is_roof_level) // no walls to draw.
				ui.set_cursor(cs?.moved ? 'not-allowed' : 'default')
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
		object, object_x, object_y,
		action=move_object         hit object
		mouse_x, mouse_y           the pointer, in plan units
		roof_side, roof_x, roof_y,
		action=move_eave           hit eave side
		roof_faces,
		roof_x, roof_y, roof_z,
		action=move_faces          hit line or point where roof faces meet
		roof_face, action=move_pitch  hit pitch label of a roof face
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

		let sg = a[i+FLOOR_EDITOR_VIEW]

		let cx = ui.cx

		let pan    = ui.keypressed('shift')
		let nosnap = ui.keypressed('ctrl')
		let snap_d = nosnap ? 20 : 200
		let snap_lines = draw_state.plan_snap_lines

		// pointer position from the viewport center, along the plan's axes,
		// for zooming.
		hs.mx = ui.mx - x00 - w / 2
		hs.my = ui.my - y00 - h / 2
		if (sg.rotation) {
			let c = cos(sg.rotation)
			let s = sin(sg.rotation)
			let dx = hs.mx
			let dy = hs.my
			hs.mx = dx * c + dy * s
			hs.my = -dx * s + dy * c
		}

		if (draw_state.readonly) {
			if (pan)
				hs.action = 'pan'
			return true
		}

		cx.save()
		cx.translate(x00, y00)
		sg.transform(cx, w, h)
		ui.update_mouse()

		let mx = sg.plan_x(ui.mx)
		let my = sg.plan_y(ui.my)
		hs.mouse_x = mx // for placing a pasted object.
		hs.mouse_y = my

		if (pan) {
			hs.action = 'pan'
			cx.restore()
			ui.update_mouse()
			return true
		}

		// an object is on top of everything else.
		if (hit_object_in(draw_state.objects, plan, hs, sg)
			|| hit_object_in(draw_state.ground_objects, plan, hs, sg)
		) {
			cx.restore()
			ui.update_mouse()
			return true
		}

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
					sx1 = sg.x(seg.wall_a1) - m
					sx2 = sg.x(seg.wall_a2) + m
					sy1 = sg.y(seg.y1)
					sy2 = sg.y(seg.y2)
				} else if (y1 == y2) {
					sy1 = sg.y(seg.wall_a1) - m
					sy2 = sg.y(seg.wall_a2) + m
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
					let sx = !v ? snap_lines[0].snap(mx, snap_d) ?? mx : null
					let sy = v  ? snap_lines[1].snap(my, snap_d) ?? my : null
					hs.x = sx ?? x1
					hs.y = sy ?? y1
					if (sx != null) sl.push(sx, 1)
					if (sy != null) sl.push(sy, 0)
					break
				}

			}

		// hit pitch label, else eave side, else point where three or more roof
		// faces meet, else line between two roof faces
		let hit_roof = !hit_p && !hit_seg && !hit_room_point
			&& (hit_roof_label(hs, draw_state, sg)
				|| hit_roof_side(hs, draw_state, sg, mx, my)
				|| hit_roof_point(hs, draw_state, sg, mx, my)
				|| hit_roof_line(hs, draw_state, sg, mx, my))

		// the roof level has no walls to draw or rooms to open.
		let is_roof_level = draw_state.is_roof_level

		// hit snapping point
		if (!hit_p && !hit_seg && !hit_room_point && !hit_roof && !is_roof_level) {
			let sx = snap_lines[0].snap(mx, snap_d)
			let sy = snap_lines[1].snap(my, snap_d)
			hs.x = sx ?? mx
			hs.y = sy ?? my
			if (sx != null) sl.push(sx, 1)
			if (sy != null) sl.push(sy, 0)
		}

		// hit inner cycle
		if (!hit_p && !hit_seg && !hit_roof && !is_roof_level) {
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
