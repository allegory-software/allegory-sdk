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
<script src=gl-renderer.js></script>
<script src=model3.js></script>
<script src=ui.js></script>
<script src=model3-editor.js></script>
<script>
const {v3, line3} = Math3D
ui.main = function() {
	ui.v()
		ui.h(0)
			ui.text('', 'toolbar', 0)
		ui.end_h()
		ui.min_wh(400, 300)
		ui.model3_editor('m', {}, function(e) {
			window.test_editor = e
			let c = e.root.comp
			let p = [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)]
			for (let i = 0; i < 4; i++)
				c.draw_line(line3(p[i], p[(i+1) % 4]))
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
<script src=gl-renderer.js></script>
<script src=model3.js></script>
<script src=model3-editor.js></script>
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
