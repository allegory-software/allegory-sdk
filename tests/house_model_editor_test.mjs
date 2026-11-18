// run: node tests/house_model_editor_test.mjs
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const www = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
	'..', 'www')
const test_plans = (await fs.readFile(path.join(www, 'ui-demo.html'), 'utf8'))
	.match(/<script id=house_test_plans>[\s\S]*?<\/script>/)[0]
const page_html = `<!DOCTYPE html>
<html>
<head>
<link rel="icon" href="data:,">
<script src=glue.js global></script>
<script src=earcut.js></script>
<script src=3d.js></script>
<script src=suncalc.js></script>
<script src=gl.js></script>
<script src=gl_renderer.js></script>
<script src=plane_graph.js></script>
<script src=roof_skeleton.js></script>
<script src=clipper2.js></script>
<script src=prism_union.js></script>
<script src=house_plan_objects.js></script>
<script src=house_plan.js></script>
<script src=model3.js></script>
<script src=ui.js></script>
<script src=ui_field.js></script>
<script src=model3_editor.js></script>
<script src=house_model_editor.js></script>
<script src=views_pm.js></script>
<script>
let plans = { // the first two of hd's test plans.
	simple: {
		version: 1,
		floor_h: 2500,
		floors: [{
			points: [[2000, 0, 'cl'], [2000, 4000, 'cr']],
			lines: [
				['draw', 'tl', 0, 0, 'tr', 6000, 'br', 4000, 'bl', -6000, 'tl',
					-4000],
				['connect', 'cl', 'cr'],
			],
		}],
	},
	gable1: {
		version: 1,
		floor_h: 2500,
		floors: [{
			points: [[2000, 0, 'cl'], [2000, 4000, 'cr']],
			lines: [
				['draw', 'tl', 0, 0, 'tr', 6000, 'br', 4000, 'bl', -6000, 'tl',
					-4000],
				['connect', 'cl', 'cr'],
			],
			roof: {
				pitch: 45,
				edge_points: [
					{x:    0, y: 2000, pitch: 90},
					{x: 6000, y: 2000, pitch: 90},
				],
			},
		}],
	},
}
window.houses = {simple: house_plan(plans.simple), gable1: house_plan(plans.gable1)}
window.house_name = 'simple'
ui.main = function() {
	ui.min_wh(400, 300)
	if (window.show_model !== false) {
		let house = window.houses[window.house_name]
		ui.house_model_editor(window.model_id ?? 'h', house,
			window.with_floor ? house.floors[0] : null)
	}
}
</script>
<body></body>
</html>`

const server = http.createServer(async function(req, res) {
	let url = req.url.split('?')[0]
	if (url == '/') {
		res.setHeader('content-type', 'text/html')
		return res.end(page_html)
	}
	if (url == '/cui_app') { // script order and globals of lua/cui_app.lua.
		res.setHeader('content-type', 'text/html')
		return res.end(`<!DOCTYPE html>
<html>
<head>
<link rel="icon" href="data:,">
<script src=glue.js global></script>
<script src=ui.js global></script>
<script src=ui_field.js></script>
<script src=earcut.js></script>
<script src=3d.js></script>
<script src=suncalc.js></script>
<script src=gl.js></script>
<script src=gl_renderer.js></script>
<script src=model3.js></script>
<script src=plane_graph.js></script>
<script src=roof_skeleton.js></script>
<script src=clipper2.js></script>
<script src=prism_union.js></script>
<script src=house_plan_objects.js></script>
<script src=house_plan.js></script>
${test_plans}
<script src=model3_editor.js></script>
<script src=house_model_editor.js></script>
<script>
let house
ui.main = function() {
	house ??= house_plan(house_test_plans.gable1)
	ui.house_model_editor('h', house)
}
</script>
<body></body>
</html>`)
	}
	let file = path.join(www, decodeURIComponent(url))
	if (!file.startsWith(www + path.sep)) {
		res.statusCode = 404
		return res.end()
	}
	try {
		let buf = await fs.readFile(file)
		res.setHeader('content-type',
			url.endsWith('.js') ? 'text/javascript' : '')
		res.end(buf)
	} catch {
		res.statusCode = 404
		res.end()
	}
})
await new Promise(r => server.listen(0, '127.0.0.1', r))

const browser = await chromium.launch({channel: 'chrome', headless: true,
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
const pg = await browser.newPage({deviceScaleFactor: 1,
	viewport: {width: 800, height: 600}})
let errors = [] // [message, ...]
pg.on('pageerror', e => errors.push(e.stack ?? e.message))
pg.on('console', function(m) {
	if (m.type() == 'error' && !/favicon/.test(m.location().url))
		errors.push(m.text())
})
await pg.goto(`http://127.0.0.1:${server.address().port}/`)
await pg.waitForTimeout(800)

let n_checks = 0
function check(name, ok, detail) {
	n_checks++
	if (!ok) {
		console.log('FAIL', name, detail ?? '')
		process.exitCode = 1
	}
}

check('no page errors', errors.length == 0, errors.join('\n'))

function read_editor() {
	return pg.evaluate(function() {
		let e = ui._state_map.get('h')?.e
		return e && {
			is_simple: e.house == window.houses.simple,
			is_gable1: e.house == window.houses.gable1,
			children: e.root.comp.children.length,
			comps: e.root.comp.children.map(c => c.comp.name),
		}
	})
}

let r1 = await read_editor()
check('editor built for the first house', r1?.is_simple, JSON.stringify(r1))
check('a floor component was added', r1?.children >= 1, JSON.stringify(r1))

// the scene reached the UI canvas.
let painted = await pg.evaluate(function() {
	let s = ui._state_map.get('h')
	let c = document.querySelector('.ui-canvas')
	let img = c.getContext('2d').getImageData(s.x, s.y, 400, 300).data
	let n = 0
	for (let i = 3; i < img.length; i += 4)
		if (img[i] > 0)
			n++
	return n
})
check('house pixels blitted into the UI canvas', painted > 0, painted)

// another house gets a new editor.
await pg.evaluate(function() {
	window.house_name = 'gable1'
	ui.animate()
})
await pg.waitForTimeout(500)
let r2 = await read_editor()
check('a new editor for the second house', r2?.is_gable1, JSON.stringify(r2))
check('the roof and the walls were added',
	r2?.comps.includes('walls') && r2?.comps.includes('roof'),
	JSON.stringify([r1, r2]))

check('no page errors after the switch', errors.length == 0,
	errors.join('\n'))

// camera and cut preference survive widget recreation, per id.
await pg.evaluate(() => {
	window.model_saves = 0
	let save_state = ui.save_state
	ui.save_state = function(id, k, ...args) {
		if (id == 'h')
			window.model_saves++
		return save_state(id, k, ...args)
	}
	let e = ui._state_map.get('h').e
	e.set_camera_pos(Math3D.v3(1000, 7000, 12000))
	e.set_camera_dir(Math3D.v3(-2, 3, 4))
	e.set_camera_up(Math3D.v3(0, 1, 0))
	window.with_floor = true
	ui.animate()
})
await pg.waitForTimeout(200)
check('idle camera updates do not save', await pg.evaluate(() =>
	window.model_saves == 0))
await pg.mouse.move(400, 300)
await pg.mouse.wheel(0, -10)
await pg.waitForTimeout(200)
check('wheel saves the camera', await pg.evaluate(() =>
	window.model_saves > 0))
await pg.evaluate(() => { window.model_saves = 0 })
await pg.mouse.down()
await pg.mouse.move(420, 310, {steps: 4})
await pg.waitForTimeout(100)
check('orbit movement does not save', await pg.evaluate(() =>
	window.model_saves == 0))
await pg.keyboard.down('Shift')
await pg.keyboard.up('Shift')
await pg.waitForTimeout(100)
check('modifier release during a drag does not save', await pg.evaluate(() =>
	window.model_saves == 0))
await pg.mouse.up()
await pg.waitForTimeout(100)
check('orbit release saves once', await pg.evaluate(() =>
	window.model_saves == 3))
await pg.evaluate(() => { window.model_saves = 0 })
await pg.keyboard.down('Shift')
await pg.mouse.down()
await pg.mouse.move(440, 320, {steps: 4})
await pg.waitForTimeout(100)
check('pan movement does not save', await pg.evaluate(() =>
	window.model_saves == 0))
await pg.mouse.up()
await pg.keyboard.up('Shift')
await pg.waitForTimeout(100)
check('pan release saves once, including modifier release',
	await pg.evaluate(() => window.model_saves == 3))
await pg.evaluate(() => { window.model_saves = 0 })
await pg.keyboard.down('ArrowRight')
await pg.keyboard.down('ArrowRight')
await pg.waitForTimeout(100)
check('key repeats do not save', await pg.evaluate(() =>
	window.model_saves == 0))
await pg.keyboard.up('ArrowRight')
await pg.waitForTimeout(100)
check('key release saves once', await pg.evaluate(() =>
	window.model_saves == 3))
await pg.keyboard.down('Shift')
await pg.keyboard.up('Shift')
await pg.waitForTimeout(100)
check('unrelated key release does not save a clean camera',
	await pg.evaluate(() => window.model_saves == 3))
let camera = await pg.evaluate(() => ui.saved_state.h)
check('saved camera matches the live camera', await pg.evaluate(() => {
	let e = ui._state_map.get('h').e
	return ['camera_pos', 'camera_dir', 'camera_up'].every(k =>
		JSON.stringify(e[k]) == JSON.stringify(ui.saved_state.h[k]))
}))
let pt = await pg.evaluate(() => {
	ui._point_at('h.cut_button')
	return [ui.local_pointer.mx, ui.local_pointer.my]
})
await pg.mouse.click(...pt)
await pg.waitForTimeout(200)
check('cut preference saved', await pg.evaluate(() =>
	ui.saved_state.h.is_cut === false))
await pg.evaluate(() => { window.show_model = false; ui.animate() })
await pg.waitForTimeout(100)
await pg.evaluate(() => { window.show_model = true; ui.animate() })
await pg.waitForTimeout(200)
let restored = await pg.evaluate(() => {
	let e = ui._state_map.get('h').e
	return {pos: [...e.camera_pos], dir: [...e.camera_dir],
		up: [...e.camera_up], cut: e.cut_floor}
})
check('camera and cut preference restored', restored.cut == null
	&& JSON.stringify(restored.pos) == JSON.stringify(camera.camera_pos)
	&& JSON.stringify(restored.dir) == JSON.stringify(camera.camera_dir)
	&& JSON.stringify(restored.up) == JSON.stringify(camera.camera_up),
	JSON.stringify(restored))
await pg.evaluate(() => { window.model_id = 'h2'; ui.animate() })
await pg.waitForTimeout(200)
check('another id has its own camera and cut preference',
	await pg.evaluate(() => {
		let e = ui._state_map.get('h2').e
		return e.camera_pos[0] == -3000 && e.cut_floor != null
	}))

// the model view uses the selected plan key under one parent id.
await pg.evaluate(() => {
	let nav = {focused_ri: 0, all_fields_map: {plan: {fi: 0}},
		cell_input_val: () => window.house_name}
	ui.master_id = () => 'test_master'
	ui.mark_follows_source = () => {}
	ui.has_master_toggle = () => false
	ui.in_dock_tab = () => false
	window.house_name = 'simple'
	ui.main = function() {
		let master = ui.state('test_master')
		master.nav = nav
		master.input_id = 'test_plan.'+window.house_name
		let input = ui.state(master.input_id)
		input.house = window.houses[window.house_name]
		input.floor = input.house.floors[0]
		ui.unit_model_editor('unit_model')
	}
	ui.animate()
})
await pg.waitForTimeout(200)
check('model child id includes the selected plan', await pg.evaluate(() =>
	ui._state_map.has('unit_model.editor.simple')))
await pg.mouse.move(400, 300)
await pg.mouse.wheel(0, -20)
await pg.waitForTimeout(100)
let camera_a = await pg.evaluate(() =>
	ui.saved_state['unit_model.editor.simple'])
pt = await pg.evaluate(() => {
	ui._point_at('unit_model.editor.simple.cut_button')
	return [ui.local_pointer.mx, ui.local_pointer.my]
})
await pg.mouse.click(...pt)
await pg.waitForTimeout(100)
await pg.evaluate(() => { window.house_name = 'gable1'; ui.animate() })
await pg.waitForTimeout(200)
check('another plan starts with its own camera and cut setting',
	await pg.evaluate(() => {
		let e = ui._state_map.get('unit_model.editor.gable1')?.e
		return e?.camera_pos[0] == -3000 && e.cut_floor != null
	}))
await pg.mouse.move(400, 300)
await pg.mouse.wheel(0, 20)
await pg.waitForTimeout(100)
await pg.evaluate(() => { window.house_name = 'simple'; ui.animate() })
await pg.waitForTimeout(200)
check('returning to a plan restores its camera and cut setting',
	await pg.evaluate(camera => {
		let e = ui._state_map.get('unit_model.editor.simple')?.e
		return e?.cut_floor == null
			&& JSON.stringify(e.camera_pos) == JSON.stringify(camera.camera_pos)
			&& JSON.stringify(e.camera_dir) == JSON.stringify(camera.camera_dir)
			&& JSON.stringify(e.camera_up) == JSON.stringify(camera.camera_up)
	}, camera_a))
check('no page errors after switching plans', errors.length == 0,
	errors.join('\n'))

// stair groups use the upper-floor slab as their local origin.
await pg.evaluate(() => {
	let rect = ['draw', 0, 0, 8000, 8000, -8000, -8000]
	window.stair_house = house_plan({version: 1, floor_h: 2800, floors: [
		{lines: [rect]},
		{lines: [rect, ['connect', [2000, 0], [2000, 8000]]], objects: [
			{type: 'stair', x: 2040, y: 4000, rot: 270},
			{type: 'open_room', x: 4000, y: 4000, rot: 0},
		]},
	]})
	ui.main = function() {
		ui.house_model_editor('stair_model', window.stair_house,
			window.stair_cut ? window.stair_house.floors[0] : null)
	}
	ui.animate()
	return new Promise(resolve => { ui.frame_changed = resolve })
})
check('a stair is a separate placed group with its own faces',
	await pg.evaluate(() => {
		let e = ui._state_map.get('stair_model')?.e
		let node = e?.root.comp.children.find(c => c.comp.name == 'stair')
		if (!node || node.comp.faces.length != 34)
			return false
		let p = Math3D.v3(0, 0, 0).transform(node)
		if (p[0] != 2040 || p[1] != 3000 || p[2] != 4000)
			return false
		p.set(0, -2800, 4200).transform(node)
		return Math.abs(p[0] - 6240) < 1e-8 && p[1] == 200
			&& Math.abs(p[2] - 4000) < 1e-8
	}))
await pg.evaluate(() => {
	window.stair_cut = true
	ui.animate()
	return new Promise(resolve => { ui.frame_changed = resolve })
})
check('cutting below the stair owner omits its group',
	await pg.evaluate(() => {
		let e = ui._state_map.get('stair_model')?.e
		return !e.root.comp.children.some(c => c.comp.name == 'stair')
	}))
check('no page errors after creating the stair group', errors.length == 0,
	errors.join('\n'))

// the pages that host the demos load without errors and build the widget.
let base_url = `http://127.0.0.1:${server.address().port}`
for (let url of ['/cui_app', '/ui-demo.html?demo=house_model_editor']) {
	let pg1 = await browser.newPage({deviceScaleFactor: 1,
		viewport: {width: 800, height: 600}})
	let errors1 = [] // [message, ...]
	pg1.on('pageerror', e => errors1.push(e.stack ?? e.message))
	pg1.on('console', function(m) {
		if (m.type() == 'error' && !/favicon/.test(m.location().url))
			errors1.push(m.text())
	})
	await pg1.goto(base_url + url)
	await pg1.waitForTimeout(800)
	check(url+': no page errors', errors1.length == 0, errors1.join('\n'))
	check(url+': editor has the roof and the walls', await pg1.evaluate(
		function() {
			for (let [id, s] of ui._state_map)
				if (s.e?.house)
					return s.e.root.comp.children.length > 1
			return false
		}))
	await pg1.close()
}

await browser.close()
server.close()
console.log(n_checks + ' checks' + (process.exitCode ? ', FAILED' : ' ok'))
