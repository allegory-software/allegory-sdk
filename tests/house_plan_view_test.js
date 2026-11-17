// run: node tests/house_plan_view_test.js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const sdk = path.resolve(__dirname, '..')
const BOX_ARGS = 8
let widget, hover, capture, cursor, rotate_click, dims_click
let want_rebuild, clicked_id
let save_n = 0
let state = {}
let record = [0, 0, 800, 600]
let matrix = [1, 0, 0, 1, 0, 0]
let stack = [], texts = [], strokes = [], points = [], dimensions = []

function transform_point(x, y) {
	return [matrix[0]*x + matrix[2]*y + matrix[4],
		matrix[1]*x + matrix[3]*y + matrix[5]]
}

let cx = {wall_pattern: true}
for (let name of ['rect', 'clip', 'closePath', 'fill', 'setLineDash', 'arc'])
	cx[name] = () => {}
cx.save = () => stack.push([...matrix])
cx.restore = () => { matrix = stack.pop() }
cx.translate = function(x, y) {
	matrix[4] += matrix[0]*x + matrix[2]*y
	matrix[5] += matrix[1]*x + matrix[3]*y
}
cx.rotate = function(angle) {
	let [a, b, c, d] = matrix
	let cs = Math.cos(angle), sn = Math.sin(angle)
	matrix[0] = a*cs + c*sn
	matrix[1] = b*cs + d*sn
	matrix[2] = -a*sn + c*cs
	matrix[3] = -b*sn + d*cs
}
cx.beginPath = () => { points = [] }
cx.moveTo = cx.lineTo = (x, y) => points.push(transform_point(x, y))
cx.stroke = () => strokes.push(points.slice())
cx.fillText = function(text, x, y) {
	texts.push({text, point: transform_point(x, y), axes: matrix.slice(0, 4)})
}

let ui = {
	BOX_ARGS, cx,
	saved_state: {},
	box_widget(name, def) { widget = def },
	state(id, update) {
		if (state.draw_state && update) update(id, state)
		return state
	},
	set_value(id, s, value, field) {
		s.input_value = value
		s.field = field
		s.validation = {failed: false}
		return value
	},
	value: () => state.input_value,
	clicked: id => id == clicked_id,
	hit: () => hover,
	drag: () => capture,
	captured: () => capture,
	hovers: () => hover,
	rebuild() { want_rebuild = true },
	focus_inside: () => false,
	window_focused: () => true,
	keypressed: () => false,
	set_cursor(s) { cursor = s },
	create_field: () => ({}),
	save_state(id, k, v) {
		save_n++
		if (v === undefined)
			delete ui.saved_state[id]?.[k]
		else
			(ui.saved_state[id] ??= {})[k] = v
	},
	state_of(id, key) {
		if (id == 'fe.rotate_button' && key == 'state' && rotate_click) {
			rotate_click = false
			return 'click'
		}
	},
	button(id) {
		if (id == 'fe.dims_button' && dims_click) {
			dims_click = false
			return true
		}
		return false
	},
	cmd_box(cmd, fr, align, valign, id, plan, ds, sg) {
		record[BOX_ARGS] = id
		record[BOX_ARGS+1] = plan
		record[BOX_ARGS+2] = ds
		record[BOX_ARGS+3] = sg
	},
	em: (n = 1) => 16*n,
	sp: () => 0,
	sp05: () => 0,
	theme: () => ({is_dark: false}),
	color_css: () => '#000',
	color_obj: () => '#000',
	alpha_adjust: c => c,
	hsl_adjust: c => c,
	hsl: () => '#000',
	measure_text: () => ({width: 40, fontBoundingBoxAscent: 10,
		fontBoundingBoxDescent: 2}),
}
for (let name of ['animate', 'box_position', 'box_translate', 'focus_group',
	'focusable', 'end_focus_group', 'stack', 'end_stack', 'm', 'mt', 'v', 'h',
	'end', 'end_v', 'end_h', 'bold', 'text', 'color', 'p', 'nobold',
	'xlarge', 'icon', 'popup_button', 'interaction_value'])
	ui[name] = () => {}

const ctx = {
	console: {...console, log() {}, group() {}, groupCollapsed() {},
		groupEnd() {}},
	setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask, ui,
	devicePixelRatio: 1,
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
for (let name of ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js',
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js',
	'house_plan_objects.js', 'house_plan.js', 'house_plan_editor.js']) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
vm.runInContext(fs.readFileSync(path.join(sdk, 'www/ui-demo.html'), 'utf8')
	.match(/<script id=house_test_plans>([\s\S]*?)<\/script>/)[1], ctx)

let offset = ctx.Math3D.line2.offset
function record_offset(d, x1, y1, x2, y2) {
	assert.equal(d, -100)
	assert(x1 != x2 || y1 != y2)
	dimensions.push([x1, y1, x2, y2])
	return offset(d, x1, y1, x2, y2)
}

let plan_json = ctx.json(ctx.house_test_plans.simple)
let field = {readonly: false}
let plan
function frame(rotate = false) {
	rotate_click = rotate
	do {
		want_rebuild = false
		widget.create(null, 'fe', plan_json, field)
		plan = state.house.floors[0]
		widget.position(record, 0, 0)
		widget.position(record, 0, 1)
		widget.translate(record, 0, 0, 0)
		if (want_rebuild) {
			if (capture?.drop || capture?.cancel)
				capture = null
			if (capture)
				capture.drag = false
			hover = null
		}
		clicked_id = null
	} while (want_rebuild)
	matrix = [1, 0, 0, 1, 0, 0]
	texts.length = 0
	strokes.length = 0
	dimensions.length = 0
	ctx.Math3D.line2.offset = record_offset
	widget.draw(record, 0)
	ctx.Math3D.line2.offset = offset
	for (let stroke of strokes)
		for (let [x, y] of stroke)
			assert(Number.isFinite(x) && Number.isFinite(y))
	assert.equal(stack.length, 0)
	assert.equal(rotate_click, false)
}

function close(a, b) {
	assert(Math.abs(a - b) < 1e-7, a + ' != ' + b)
}
function equal_axes(actual, expected) {
	for (let i = 0; i < 4; i++)
		close(actual[i], expected[i])
}
function screen_point(x, y) {
	let sg = state
	let angle = sg.rotation ?? 0
	let c = Math.cos(angle), s = Math.sin(angle)
	let cx = Math.round(record[2] / 2), cy = Math.round(record[3] / 2)
	x = Math.round(x * sg.scale) + sg.x0 - cx
	y = Math.round(y * sg.scale) + sg.y0 - cy
	return [cx + x*c - y*s, cy + x*s + y*c]
}

let n_checks = 0
function check(name, f) {
	try {
		f()
		n_checks++
	} catch (e) {
		console.error(name)
		throw e
	}
}

// labels, arrows, and resize cursors ---------------------------------------

frame()

for (let turns of [0, 1, 2, 3]) {
	if (turns)
		frame(true)
	for (let v of [false, true]) {
		for (let reverse of [false, true]) {
			let name = 'drawing at ' + turns*90 + ' degrees, vertical=' + v
				+ ', reversed=' + reverse
			check(name, () => {
				let seg = plan.segs.find(s => s.is_v == v
					&& (s[0][v ? 1 : 0] > s[1][v ? 1 : 0]) == reverse)
				assert(seg)
				capture = {action: 'move_seg', seg, drag: true, dx: 0, dy: 0}
				frame()
				close(state.rotation, turns * Math.PI / 2)
				let screen_v = v != (turns % 2 != 0)
				assert.equal(cursor, screen_v ? 'ew-resize' : 'ns-resize')
				let rooms = []
				for (let co of plan.comps)
					for (let c of co.cycles)
						if (!c.outer)
							rooms.push(c)
				let areas = texts.filter(t => t.text.includes('\u00b2'))
				assert.equal(areas.length, rooms.length)
				for (let i = 0; i < areas.length; i++) {
					equal_axes(areas[i].axes, [1, 0, 0, 1])
					let [x, y] = rooms[i].center()
					let [sx, sy] = screen_point(x, y)
					close(areas[i].point[0], sx)
					close(areas[i].point[1], sy + 5)
				}
				let label = texts[texts.length-1]
				assert(label.text.endsWith('m'))
				equal_axes(label.axes, screen_v ? [1, 0, 0, 1] : [0, -1, 1, 0])
				let arrows = strokes[strokes.length-1]
				assert.equal(arrows.length, 12)
				let dx = arrows[6][0] - arrows[0][0]
				let dy = arrows[6][1] - arrows[0][1]
				for (let i of [1, 3])
					assert((arrows[i][0] - arrows[0][0])*dx
						+ (arrows[i][1] - arrows[0][1])*dy > 0)
				for (let i of [7, 9])
					assert((arrows[6][0] - arrows[i][0])*dx
						+ (arrows[6][1] - arrows[i][1])*dy > 0)
				capture.cancel = true
				capture.drag = false
				frame()
				capture = null
			})
		}
	}
}

// measurements after moving an exterior wall -------------------------------

for (let [y, dy, expected] of [
	[0, -1000, [[-140, -140, 2260, -140], [2260, -1140, 6140, -1140],
		[5960, -960, 2440, -960], [2440, 40, 2040, 40]]],
	[0, 1000, [[-140, -140, 2540, -140], [2540, 860, 6140, 860],
		[1960, 960, 2360, 960], [2360, 40, 40, 40]]],
	[4000, -1000, [[6140, 3140, 2540, 3140], [2540, 4140, -140, 4140],
		[40, 3960, 2360, 3960], [2360, 3040, 1960, 3040]]],
	[4000, 1000, [[6140, 5140, 2260, 5140], [2260, 4140, -140, 4140],
		[2040, 3960, 2440, 3960], [2440, 4960, 5960, 4960],
		[2040, 3960, 2440, 3960], [2440, 4960, 5960, 4960]]],
]) {
	check('exterior wall measurements y=' + y + ', dy=' + dy, () => {
		let sg = state
		let seg = plan.segs.find(s => !s.is_v && s.axis == y && s.m1 == 2000)
		let edit = plan.start_move_seg(seg)
		edit.move(0, dy)
		edit.stop()
		let connector = plan.segs.find(s => s.is_v && s.axis == 2000
			&& s.m1 == Math.min(y, y+dy) && s.m2 == Math.max(y, y+dy))
		assert(connector)
		capture = {action: 'move_seg', seg: connector, drag: true, dx: 0, dy: 0}
		frame()
		capture.drag = false
		let angle = sg.rotation
		capture.dx = 400 * sg.scale * Math.cos(angle)
		capture.dy = 400 * sg.scale * Math.sin(angle)
		frame()
		assert.deepEqual(dimensions, expected)
		assert(strokes.filter(s => s.length == 12).length >= expected.length)
		capture.cancel = true
		frame()
		capture = null
		assert(state.house.undo())
		frame()
		assert.equal(dimensions.length, 0)
	})
}

check('all dimensions replace drag measurements', () => {
	dims_click = true
	frame()
	assert.equal(dimensions.length, 14)
	let seg = plan.segs.find(s => s.is_v && s.axis == 2000)
	capture = {action: 'move_seg', seg, drag: true, dx: 0, dy: 0}
	frame()
	assert.equal(dimensions.length, 14)
	capture.drag = false
	let sg = state
	let angle = sg.rotation
	capture.dx = 400 * sg.scale * Math.cos(angle)
	capture.dy = 400 * sg.scale * Math.sin(angle)
	frame()
	assert.equal(dimensions.length, 14)
	capture.cancel = true
	frame()
	capture = null
	dims_click = true
	frame()
	assert.equal(dimensions.length, 0)
})

// panning at different scales ---------------------------------------------

hover = null
for (let [w, h] of [[400, 300], [800, 600], [1600, 1200]]) {
	record[2] = w
	record[3] = h
	frame(true)
	for (let turns of [0, 1, 2, 3]) {
		if (turns)
			frame(true)
		check('panning at ' + turns*90 + ' degrees in ' + w + 'x' + h, () => {
			capture = {action: 'pan', drag: true, dx: 0, dy: 0}
			frame()
			let before = strokes[0][0]
			capture.drag = false
			capture.dx = 40
			capture.dy = 20
			frame()
			let after = strokes[0][0]
			close(after[0] - before[0], 40)
			close(after[1] - before[1], 20)
			capture = null
		})
	}
}

// rotation after panning --------------------------------------------------

for (let [w, h] of [[800, 600], [801, 601]]) {
	record[2] = w
	record[3] = h
	frame()
	capture = {action: 'pan', drag: true, dx: 0, dy: 0}
	frame()
	capture.drag = false
	capture.dx = 73
	capture.dy = -41
	frame()
	capture = null
	let bb = plan.house.bb
	let x = (bb[0] + bb[2]) / 2
	let y = (bb[1] + bb[3]) / 2
	let before = screen_point(x, y)
	let scale = state.scale
	for (let turns = 1; turns <= 4; turns++) {
		check('rotation center after panning in ' + w + 'x' + h
				+ ', turn ' + turns, () => {
			frame(true)
			let after = screen_point(x, y)
			// the view center is a plan point: its pixel position is rounded.
			assert(Math.abs(after[0] - before[0]) <= 1, after[0] + ' != ' + before[0])
			assert(Math.abs(after[1] - before[1]) <= 1, after[1] + ' != ' + before[1])
			close(state.scale, scale)
		})
	}
}

// drawing a wall -----------------------------------------------------------

check('drawing a wall shows its length on both sides', () => {
	record[2] = 800
	record[3] = 600
	frame()
	let edit = plan.start_resize_seg(null, 4000, 1000, 800, 0, 1, 0)
	edit.resize(1500, 0)
	let {scale, rotation} = state
	capture = {action: 'resize_seg', edit, drag: false,
		dx: 1500 * scale * Math.cos(rotation),
		dy: 1500 * scale * Math.sin(rotation)}
	frame()
	assert.equal(dimensions.length, 2)
	for (let [x1, y1, x2, y2] of dimensions)
		assert(Math.hypot(x2 - x1, y2 - y1) >= 1500)
	capture.cancel = true
	frame()
	capture = null
	assert.equal(dimensions.length, 0)
})

// view in the saved state --------------------------------------------------

check('the view keeps its center and logical scale when the viewport resizes',
	() => {
	record[2] = 800
	record[3] = 600
	frame()
	let sg = state
	assert.equal(sg.zoomed, true)
	let {scale, cx, cy} = sg
	record[2] = 1600
	record[3] = 1200
	frame()
	close(sg.scale, scale)
	close(sg.cx, cx)
	close(sg.cy, cy)
	// the plan point at the center of the viewport.
	assert(Math.abs((800 - sg.x0) / sg.scale - cx) <= 1 / sg.scale)
	assert(Math.abs((600 - sg.y0) / sg.scale - cy) <= 1 / sg.scale)
})

check('rotation, pan and zoom are saved by the editor id and restored', () => {
	record[2] = 800
	record[3] = 600
	frame()
	capture = {action: 'pan', drag: true, dx: 0, dy: 0}
	frame()
	capture.drag = false
	capture.dx = 30
	capture.dy = 20
	frame()
	capture.drop = true
	frame()
	capture = null
	frame(true)
	let {rotation, scale, cx, cy} = state
	assert.deepEqual(ui.saved_state.fe,
		{rotation, scale, cx, cy})
	assert.equal(rotation % (Math.PI / 2), 0)
	state = {}
	frame()
	close(state.rotation, rotation)
	close(state.scale, scale)
	close(state.cx, cx)
	close(state.cy, cy)
	assert.equal(state.zoomed, true)
	// fit once, then keep the fitted scale.
	state.reset_zoom()
	frame()
	assert.equal(ui.saved_state.fe.scale, state.scale)
	assert.equal(ui.saved_state.fe.rotation, rotation)
})

check('pixel density changes preserve logical scale and center', () => {
	let {scale, cx, cy} = state
	let d = state.d(1000)
	ctx.devicePixelRatio = 2
	frame()
	close(state.scale, scale)
	close(state.cx, cx)
	close(state.cy, cy)
	assert(Math.abs(state.d(1000) - 2*d) <= 1)
	state = {}
	frame()
	close(state.scale, scale)
	ctx.devicePixelRatio = 1
	frame()
})

check('idle layouts and pan movements do not save; release saves once', () => {
	let n = save_n
	frame()
	frame()
	assert.equal(save_n, n)
	ctx.devicePixelRatio = 2
	let {cx, cy, scale} = state
	capture = {action: 'pan', drag: true, dx: 0, dy: 0}
	frame()
	capture.drag = false
	capture.dx = 40
	capture.dy = 20
	frame()
	assert.equal(save_n, n)
	let angle = state.rotation
	let dx = 40 / (scale * 2), dy = 20 / (scale * 2)
	close(state.cx, cx - dx*Math.cos(angle) - dy*Math.sin(angle))
	close(state.cy, cy + dx*Math.sin(angle) - dy*Math.cos(angle))
	capture.drop = true
	frame()
	assert.equal(save_n, n + 4)
	close(ui.saved_state.fe.cx, state.cx)
	close(ui.saved_state.fe.cy, state.cy)
	capture = null
	ctx.devicePixelRatio = 1
	frame()
	assert.equal(save_n, n + 4)
})

check('wheel and rotation clicks save without saving on later layouts', () => {
	let n = save_n
	hover = {mx: 0, my: 0}
	ui.wheel_dy = -16
	frame()
	ui.wheel_dy = 0
	hover = null
	assert.equal(save_n, n + 4)
	frame()
	assert.equal(save_n, n + 4)
	frame(true)
	assert.equal(save_n, n + 8)
	frame()
	assert.equal(save_n, n + 8)
})

check('floor and roof selection survive editor recreation', () => {
	let t = ctx.house_test_plans.simple
	plan_json = ctx.json({...t, floors: [t.floors[0], t.floors[0]]})
	frame()
	let n = save_n
	clicked_id = 'fe.floor1'
	frame()
	assert.equal(save_n, n + 2)
	assert.equal(ui.saved_state.fe.floor, 1)
	state = {}
	frame()
	assert.equal(state.floor.i, 1)
	n = save_n
	clicked_id = 'fe.roof'
	frame()
	assert.equal(save_n, n + 2)
	state = {}
	frame()
	assert.equal(state.is_roof_level, true)
	assert.equal(state.floor.i, 1)
	n = save_n
	frame()
	assert.equal(save_n, n)
})

// roof geometry reuse ------------------------------------------------------

function roof_rings() {
	let rings = []
	for (let face of state.draw_state.roof_faces)
		rings.push(face.rings)
	return JSON.stringify(rings)
}

check('roof hover, pan, zoom and rotation reuse geometry', () => {
	plan_json = ctx.json({
		version: 1,
		floors: [{
			lines: [['connect', [0, 0], [6000, 0], [6000, 4000],
				[0, 4000], [0, 0]]],
			roof: {pitch: 30},
		}],
	})
	ui.saved_state.fe = {floor: 0, is_roof_level: true}
	state = {}
	frame()
	let faces = state.draw_state.roof_faces
	assert(faces.length > 0)
	let make_areas = plan.make_areas
	let make_roof_faces = plan.make_roof_faces
	let area_n = 0
	let roof_n = 0
	plan.make_areas = function(...args) {
		area_n++
		return make_areas(...args)
	}
	plan.make_roof_faces = function(...args) {
		roof_n++
		return make_roof_faces(...args)
	}
	for (let i = 0; i < 20; i++) {
		hover = {mx: i, my: i}
		frame()
	}
	hover = null
	state.pan_to(state.cx + 100, state.cy + 100)
	frame()
	state.zoom_at(1, 0, 0)
	frame()
	frame(true)
	assert.equal(area_n, 0)
	assert.equal(roof_n, 0)
	assert.equal(state.draw_state.roof_faces, faces)
	plan.make_areas = make_areas
	plan.make_roof_faces = make_roof_faces
})

check('roof height preview, cancel, undo and redo refresh geometry', () => {
	let h = state.house
	let rings0 = roof_rings()
	let edit_no = h.edit_no
	let move = plan.start_move_height(true)
	assert(move.move(500))
	assert.equal(h.edit_no, edit_no)
	frame()
	assert.notEqual(roof_rings(), rings0)
	move.cancel()
	frame()
	assert.equal(roof_rings(), rings0)
	move = plan.start_move_height(true)
	move.move(500)
	move.stop()
	frame()
	let rings1 = roof_rings()
	assert.notEqual(rings1, rings0)
	assert(h.undo())
	frame()
	assert.equal(roof_rings(), rings0)
	assert(h.redo())
	frame()
	assert.equal(roof_rings(), rings1)
})

check('wall and floor-height previews refresh roof geometry', () => {
	let rings = roof_rings()
	let seg = plan.segs.find(seg => !seg.is_v && seg.axis == 0)
	let move = plan.start_move_seg(seg)
	move.move(0, 200, 0)
	frame()
	assert.notEqual(roof_rings(), rings)
	move.cancel()
	frame()
	assert.equal(roof_rings(), rings)
	move = plan.start_move_height()
	move.move(500)
	frame()
	assert.notEqual(roof_rings(), rings)
	move.cancel()
	frame()
	assert.equal(roof_rings(), rings)
})

check('roof selection and an upper wall preview refresh the lower roof', () => {
	state.house.add_floor()
	frame()
	assert(state.draw_state.roof_faces.length > 0)
	clicked_id = 'fe.floor1'
	frame()
	assert.equal(state.draw_state.roof_floor, plan)
	assert.equal(state.draw_state.roof_faces.length, 0)
	let upper = state.house.floors[1]
	let seg = upper.segs.find(seg => seg.is_v && seg.axis == 6000)
	let move = upper.start_move_seg(seg)
	move.move(-500, 0, 0)
	frame()
	assert(state.draw_state.roof_faces.length > 0)
	move.cancel()
	frame()
	assert.equal(state.draw_state.roof_faces.length, 0)
	clicked_id = 'fe.roof'
	frame()
	assert(state.draw_state.roof_faces.length > 0)
	clicked_id = 'fe.floor0'
	frame()
	assert.equal(state.draw_state.roof_faces.length, 0)
	assert.equal(state.draw_state.roof_sides.length, 0)
	assert.equal(state.draw_state.roof_lines.length, 0)
})

check('roof edits and resets refresh the drawing geometry', () => {
	clicked_id = 'fe.roof'
	frame()
	let floor = state.floor
	let rings = roof_rings()
	let side = state.draw_state.roof_sides.find(side => side.is_eave)
	let scale = ctx.prism_union.grid_scale
	let m = (side.m1 + side.m2) / 2 / scale
	let x = side.nx ? side.wall_c / scale : m
	let y = side.nx ? m : side.wall_c / scale
	floor.toggle_gable(side, x, y)
	frame()
	assert.notEqual(roof_rings(), rings)
	floor.remove_edge_point(floor.roof.edge_points[0])
	frame()
	assert.equal(roof_rings(), rings)
	let move = floor.start_move_eave(side, x, y, [])
	move.move(side.nx * 100, side.ny * 100, false, 0)
	frame()
	assert.notEqual(roof_rings(), rings)
	move.cancel()
	frame()
	assert.equal(roof_rings(), rings)
	let face = state.draw_state.roof_faces[0]
	move = floor.start_move_pitch(face)
	move.move(5, true)
	move.stop()
	frame()
	assert.notEqual(roof_rings(), rings)
	floor.reset_faces(state.draw_state.roof_faces)
	frame()
	assert.equal(roof_rings(), rings)
	face = state.draw_state.roof_faces[0]
	x = 0
	y = 0
	let ring = face.rings[0]
	for (let p of ring) {
		x += p[0] / ring.length
		y += p[1] / ring.length
	}
	let [a, b, c] = face.plane
	move = floor.start_move_faces([face], a*x + b*y + c)
	assert(move)
	assert(move.move(x + 100, y + 100))
	frame()
	assert.notEqual(roof_rings(), rings)
	move.cancel()
	frame()
	assert.equal(roof_rings(), rings)
})

console.log(n_checks + ' house plan view checks passed')
