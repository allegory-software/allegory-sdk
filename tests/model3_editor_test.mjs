// run: node tests/model3_editor_test.mjs
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'

const www = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
	'..', 'www')
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
<script src=model3.js></script>
<script src=ui.js></script>
<script src=model3_editor.js></script>
<script>
const {v3} = Math3D
ui.main = function() {
	ui.v()
		ui.h(0)
			ui.text('', 'toolbar', 0)
		ui.end_h()
		ui.min_wh(400, 300)
		ui.model3_editor('m', {}, function(e) {
			window.test_editor = e
			let c = e.root.comp
			c.draw_polyline([v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)],
				true)
			e.update_all()
		})
	ui.end_v()
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
<script src=earcut.js></script>
<script src=3d.js></script>
<script src=suncalc.js></script>
<script src=gl.js></script>
<script src=gl_renderer.js></script>
<script src=model3.js></script>
<script src=model3_editor.js></script>
<script>
ui.main = function() {
	ui.model3_editor('m', {}, ui.model3_editor_test_objects)
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

// the widget exists, was laid out and registered its position.
let rect = await pg.evaluate(function() {
	let s = ui._state_map.get('m')
	return s && {x: s.x, y: s.y, has_e: !!s.e}
})
check('state exists', rect && rect.has_e, JSON.stringify(rect))
check('register stored x,y', rect && rect.x != null && rect.y != null,
	JSON.stringify(rect))

check('init ran', await pg.evaluate(() => !!window.test_editor))

// the scene reached the UI canvas: the widget box has non-transparent
// pixels, and the area outside it (the toolbar row) has none of the scene.
let painted = await pg.evaluate(function(r) {
	let c = document.querySelector('.ui-canvas')
	let img = c.getContext('2d').getImageData(r.x, r.y, 400, 300).data
	let n = 0
	for (let i = 3; i < img.length; i += 4)
		if (img[i] > 0)
			n++
	return n
}, rect)
check('scene pixels blitted into the UI canvas', painted > 0, painted)

// orbit with the mouse: the camera position must change.
function read_camera() {
	return pg.evaluate(() => Array.from(window.test_editor.camera_pos))
}
let cam0 = await read_camera()
await pg.mouse.move(rect.x + 100, rect.y + 100)
await pg.mouse.down()
await pg.mouse.move(rect.x + 160, rect.y + 130, {steps: 5})
await pg.mouse.up()
await pg.waitForTimeout(200)
let cam1 = await read_camera()
check('orbit moved the camera',
	JSON.stringify(cam0) != JSON.stringify(cam1),
	JSON.stringify([cam0, cam1]))

// wheel over the widget: dolly changes the camera.
await pg.mouse.move(rect.x + 200, rect.y + 150)
await pg.mouse.wheel(0, -100)
await pg.waitForTimeout(200)
let cam2 = await read_camera()
check('wheel moved the camera',
	JSON.stringify(cam1) != JSON.stringify(cam2),
	JSON.stringify([cam1, cam2]))

// the click focused the widget, so keys reach it: 'l' picks the line tool.
await pg.keyboard.press('l')
await pg.waitForTimeout(200)
check('key l selects the line tool',
	await pg.evaluate(() => window.test_editor.tool) == 'line')

// pointer move with the line tool must not loop frames: after the move, the
// build number stops growing.
await pg.mouse.move(rect.x + 210, rect.y + 160)
await pg.waitForTimeout(300)
let build_no0 = await pg.evaluate(() => ui._build_no())
await pg.waitForTimeout(300)
let build_no1 = await pg.evaluate(() => ui._build_no())
check('frames stop after a pointer move', build_no0 == build_no1,
	build_no0 + ' ' + build_no1)

// push/pull: 'p' picks the tool, dragging a square face lifts it off
// z = 0 and Ctrl+Z puts it back. keys go in separate frames.
await pg.keyboard.press('p')
await pg.waitForTimeout(100)
check('key p selects the pull tool',
	await pg.evaluate(() => window.test_editor.tool) == 'pull')
let face_p = await pg.evaluate(function() {
	let e = window.test_editor
	let c = e.root.comp
	window.test_square = c.add_face([
		c.add_point_xyz(.5, .5, 0),
		c.add_point_xyz(1.5, .5, 0),
		c.add_point_xyz(1.5, 1.5, 0),
		c.add_point_xyz(.5, 1.5, 0),
	])
	e.update_all()
	ui.animate()
	let p = e.world_to_screen(Math3D.v3(1, 1, 0), Math3D.v2())
	return [p[0], p[1]]
})
await pg.waitForTimeout(100)
function read_square() {
	return pg.evaluate(function() {
		let c = window.test_editor.root.comp
		let faces = c.faces.filter(f => f.length)
		let zs = []
		for (let pi of window.test_square)
			zs.push(c.get_point(pi, Math3D.v3())[2])
		return {n_faces: faces.length, zs: zs}
	})
}
let sq0 = await read_square()
await pg.mouse.move(rect.x + face_p[0], rect.y + face_p[1])
await pg.waitForTimeout(100)
await pg.mouse.down()
await pg.mouse.move(rect.x + face_p[0], rect.y + face_p[1] - 120, {steps: 8})
await pg.mouse.up()
await pg.waitForTimeout(200)
let sq1 = await read_square()
check('pull lifted the square into a box',
	sq1.n_faces == sq0.n_faces + 5 && sq1.zs.length && sq1.zs.every(z => z != 0),
	JSON.stringify([sq0, sq1]))
await pg.keyboard.down('Control')
await pg.waitForTimeout(50)
await pg.keyboard.press('z')
await pg.waitForTimeout(50)
await pg.keyboard.up('Control')
await pg.waitForTimeout(200)
let sq2 = await read_square()
check('Ctrl+Z undid the pull', JSON.stringify(sq0) == JSON.stringify(sq2),
	JSON.stringify([sq0, sq2]))

async function press_ctrl(key) {
	await pg.keyboard.down('Control')
	await pg.waitForTimeout(50)
	await pg.keyboard.press(key)
	await pg.waitForTimeout(50)
	await pg.keyboard.up('Control')
	await pg.waitForTimeout(200)
}

await press_ctrl('y')
let sq3 = await read_square()
check('Ctrl+Y redid the pull', JSON.stringify(sq1) == JSON.stringify(sq3),
	JSON.stringify([sq1, sq3]))

// a click starts a pull, Escape cancels it, and Ctrl+Y has nothing to redo:
// the redo stack is empty here.
let top_p = await pg.evaluate(function(z) {
	let p = window.test_editor.world_to_screen(Math3D.v3(1, 1, z), Math3D.v2())
	return [p[0], p[1]]
}, sq1.zs[0])
await pg.mouse.move(rect.x + top_p[0], rect.y + top_p[1])
await pg.waitForTimeout(100)
await pg.mouse.down()
await pg.mouse.up()
await pg.waitForTimeout(100)
await pg.mouse.move(rect.x + top_p[0], rect.y + top_p[1] - 40, {steps: 4})
await pg.waitForTimeout(100)
let sq7 = await read_square()
check('a click started a pull', JSON.stringify(sq1) != JSON.stringify(sq7),
	JSON.stringify([sq1, sq7]))
await pg.keyboard.press('Escape')
await pg.waitForTimeout(100)
let sq8 = await read_square()
check('Escape cancelled the pull', JSON.stringify(sq1) == JSON.stringify(sq8),
	JSON.stringify([sq1, sq8]))
await press_ctrl('y')
let sq9 = await read_square()
check('Ctrl+Y after a cancelled pull redid nothing',
	JSON.stringify(sq1) == JSON.stringify(sq9), JSON.stringify([sq1, sq9]))

// a pull after a cancelled pull starts: the freed side faces are skipped.
await pg.mouse.move(rect.x + top_p[0], rect.y + top_p[1])
await pg.waitForTimeout(100)
await pg.mouse.down()
await pg.mouse.move(rect.x + top_p[0], rect.y + top_p[1] - 60, {steps: 6})
await pg.waitForTimeout(100)
let sq10 = await read_square()
check('a pull after a cancelled pull started',
	JSON.stringify(sq1) != JSON.stringify(sq10), JSON.stringify([sq1, sq10]))

// switching tools during the pull drag cancels the pull and ends the drag:
// moving and releasing the mouse change nothing.
await pg.keyboard.press('l')
await pg.waitForTimeout(100)
await pg.mouse.move(rect.x + top_p[0], rect.y + top_p[1] - 30, {steps: 3})
await pg.waitForTimeout(100)
await pg.mouse.up()
await pg.waitForTimeout(100)
let sq11 = await read_square()
let tool11 = await pg.evaluate(() => window.test_editor.tool)
check('a tool switch cancelled the pull drag',
	tool11 == 'line' && JSON.stringify(sq1) == JSON.stringify(sq11),
	JSON.stringify([tool11, sq1, sq11]))

// a line drawn after a pull is its own undo step: Ctrl+Z removes the line
// and leaves the pulled box.
function read_line_count() {
	return pg.evaluate(function() {
		let c = window.test_editor.root.comp
		let n = 0
		c.each_line(() => n++)
		return n
	})
}
// draw a line from (x1, y1, 0) to (x2, y2, 0) with the line tool.
async function draw_line(x1, y1, x2, y2) {
	let line_ps = await pg.evaluate(function([x1, y1, x2, y2]) {
		let e = window.test_editor
		let p1 = e.world_to_screen(Math3D.v3(x1, y1, 0), Math3D.v2())
		let p2 = e.world_to_screen(Math3D.v3(x2, y2, 0), Math3D.v2())
		return [p1[0], p1[1], p2[0], p2[1]]
	}, [x1, y1, x2, y2])
	await pg.keyboard.press('l')
	await pg.waitForTimeout(100)
	for (let i = 0; i < 4; i += 2) {
		await pg.mouse.move(rect.x + line_ps[i], rect.y + line_ps[i+1],
			{steps: 4})
		await pg.waitForTimeout(100)
		await pg.mouse.down()
		await pg.mouse.up()
		await pg.waitForTimeout(100)
	}
	await pg.keyboard.press('Escape')
	await pg.waitForTimeout(100)
}
let n_lines0 = await read_line_count()
await draw_line(3, 3, 4, 3)
let n_lines1 = await read_line_count()
check('line tool drew a line', n_lines1 == n_lines0 + 1,
	n_lines0 + ' ' + n_lines1)
await press_ctrl('z')
let n_lines2 = await read_line_count()
let sq4 = await read_square()
check('Ctrl+Z after the line undid only the line',
	n_lines2 == n_lines0 && JSON.stringify(sq1) == JSON.stringify(sq4),
	JSON.stringify([n_lines0, n_lines2, sq1, sq4]))

// a new line after the undo clears the redo stack: Ctrl+Y redoes nothing.
await draw_line(3, 4, 4, 4)
let n_lines3 = await read_line_count()
let n_errors0 = errors.length
await press_ctrl('y')
let n_lines4 = await read_line_count()
check('Ctrl+Y after a new line redid nothing',
	n_lines3 == n_lines0 + 1 && n_lines4 == n_lines3
		&& errors.length == n_errors0,
	JSON.stringify([n_lines0, n_lines3, n_lines4, errors.slice(n_errors0)]))

// Delete removes the selected face, Ctrl+Z brings it back.
await pg.evaluate(function() {
	let c = window.test_editor.root.comp
	c.select_all(false)
	c.select_face(window.test_square, 'add')
})
await pg.keyboard.press('Delete')
await pg.waitForTimeout(200)
let sq5 = await pg.evaluate(function() {
	let c = window.test_editor.root.comp
	return {
		n_faces: c.faces.filter(f => f.length).length,
		square_len: window.test_square.length,
	}
})
check('Delete removed the selected face',
	sq5.square_len == 0 && sq5.n_faces == sq1.n_faces - 1,
	JSON.stringify([sq1, sq5]))
await press_ctrl('z')
let sq6 = await read_square()
check('Ctrl+Z undid the delete', JSON.stringify(sq1) == JSON.stringify(sq6),
	JSON.stringify([sq1, sq6]))

// Delete with nothing selected changes nothing: Ctrl+Z skips its empty group
// and undoes the second line.
await pg.evaluate(() => window.test_editor.root.comp.select_all(false))
await pg.keyboard.press('Delete')
await pg.waitForTimeout(100)
await press_ctrl('z')
let n_lines5 = await read_line_count()
check('Ctrl+Z skipped the empty group', n_lines5 == n_lines0,
	n_lines0 + ' ' + n_lines5)

check('no page errors after input', errors.length == 0, errors.join('\n'))

// the pages that host the demos load without errors and build the widget.
let base_url = `http://127.0.0.1:${server.address().port}`
for (let url of ['/cui_app', '/ui-demo.html?demo=model3_editor']) {
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
	check(url+': widget built', await pg1.evaluate(function() {
		for (let [id, s] of ui._state_map)
			if (s.e?.update && id.startsWith('m'))
				return true
		return false
	}))
	await pg1.close()
}

await browser.close()
server.close()
console.log(n_checks + ' checks' + (process.exitCode ? ', FAILED' : ' ok'))
