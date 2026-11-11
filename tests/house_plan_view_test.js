// run: node tests/house_plan_view_test.js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const sdk = path.resolve(__dirname, '..')
const BOX_ARGS = 8
let widget, hover, capture, cursor, rotate_click
let state = {}
let record = [0, 0, 800, 600]
let matrix = [1, 0, 0, 1, 0, 0]
let stack = [], texts = [], strokes = [], points = []

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
	clicked: () => false,
	hit: () => hover,
	drag: () => capture,
	captured: () => capture,
	hovers: () => hover,
	focus_inside: () => false,
	window_focused: () => true,
	keypressed: () => false,
	set_cursor(s) { cursor = s },
	button(id) {
		if (id == 'fe.rotate_button' && rotate_click) {
			rotate_click = false
			return true
		}
		return false
	},
	cmd_box(cmd, fr, align, valign, id, plan, ds) {
		record[BOX_ARGS] = id
		record[BOX_ARGS+1] = plan
		record[BOX_ARGS+2] = ds
	},
	em: (n = 1) => 16*n,
	sp: () => 0,
	sp05: () => 0,
	theme: () => ({is_dark: false}),
	color_css: () => '#000',
	color_obj: () => '#000',
	alpha_adjust: c => c,
	measure_text: () => ({width: 40, fontBoundingBoxAscent: 10,
		fontBoundingBoxDescent: 2}),
}
for (let name of ['animate', 'box_position', 'box_translate', 'focus_group',
	'focusable', 'end_focus_group', 'stack', 'end_stack', 'm', 'v', 'h',
	'end', 'end_v', 'end_h', 'bold', 'text', 'color'])
	ui[name] = () => {}

const ctx = {
	console: {...console, log() {}, group() {}, groupCollapsed() {},
		groupEnd() {}},
	setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask, ui,
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
for (let name of ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js',
	'house_plan.js', 'house_plan_editor.js']) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
vm.runInContext(fs.readFileSync(path.join(sdk, 'www/ui-demo.html'), 'utf8')
	.match(/<script id=house_test_plans>([\s\S]*?)<\/script>/)[1], ctx)

let plan_json = ctx.json(ctx.house_test_plans.simple)
let field = {readonly: false}
let plan
let measure_edges = []
function frame(rotate = false) {
	rotate_click = rotate
	widget.create(null, 'fe', plan_json, field)
	plan = state.house.floors[0]
	state.draw_state.measure_edges = measure_edges
	widget.position(record, 0, 0)
	widget.position(record, 0, 1)
	widget.translate(record, 0, 0, 0)
	matrix = [1, 0, 0, 1, 0, 0]
	texts.length = 0
	strokes.length = 0
	widget.draw(record, 0)
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
	let ds = state.draw_state
	let angle = ds.rotation ?? 0
	let c = Math.cos(angle), s = Math.sin(angle)
	let cx = Math.round(record[2] / 2), cy = Math.round(record[3] / 2)
	x = Math.round(x * ds.scale) + ds.x0 - cx
	y = Math.round(y * ds.scale) + ds.y0 - cy
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
let rooms = []
for (let co of plan.comps)
	for (let c of co.cycles)
		if (!c.outer)
			rooms.push(c)

for (let turns of [0, 1, 2, 3]) {
	if (turns)
		frame(true)
	for (let v of [false, true]) {
		for (let reverse of [false, true]) {
			let name = 'drawing at ' + turns*90 + ' degrees, vertical=' + v
				+ ', reversed=' + reverse
			check(name, () => {
				hover = {action: 'move_seg', seg: plan.segs.find(s => s.is_v == v)}
				let a = [0, 0]
				let b = v ? [0, 200] : [200, 0]
				measure_edges = [[reverse ? b : a, reverse ? a : b]]
				frame()
				close(state.draw_state.rotation ?? 0, turns * Math.PI / 2)
				let screen_v = v != (turns % 2 != 0)
				assert.equal(cursor, screen_v ? 'ew-resize' : 'ns-resize')
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
				equal_axes(label.axes, screen_v ? [0, -1, 1, 0] : [1, 0, 0, 1])
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
			})
		}
	}
}

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

console.log(n_checks + ' house plan view checks passed')
