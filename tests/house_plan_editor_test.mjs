// run: node tests/house_plan_editor_test.mjs
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const www = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
	'..', 'www')
const page_html = `<!DOCTYPE html>
<html>
<head>
<link rel="icon" href="data:,">
<script src=glue.js global></script>
<script src=earcut.js></script>
<script src=3d.js></script>
<script src=plane-graph.js></script>
<script src=house-plan.js></script>
<script src=house-test-plans.js></script>
<script src=ui.js></script>
<script src=ui_icon_defs.js></script>
<script src=house-plan-editor.js></script>
<script>
window.house = house_plan(house_test_plans.simple)
ui.main = function() {
	ui.floor_editor('fe', window.house.floors[0])
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
<script src=ui_icon_defs.js></script>
<script src=earcut.js></script>
<script src=3d.js></script>
<script src=plane-graph.js></script>
<script src=house-plan.js></script>
<script src=house-test-plans.js></script>
<script src=house-plan-editor.js></script>
<script>
let house
ui.main = function() {
	house ??= house_plan(house_test_plans.gable1)
	h(1, sp2())
		for (let floor of house.floors)
			ui.floor_editor('fe'+floor.i, floor)
	end_h()
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

const browser = await chromium.launch({channel: 'chrome', headless: true})
const pg = await browser.newPage({deviceScaleFactor: 1,
	viewport: {width: 800, height: 600}})
let errors = [] // [message, ...]
pg.on('pageerror', e => errors.push(e.stack ?? e.message))
pg.on('console', function(m) {
	if (m.type() == 'error' && !/favicon/.test(m.location().url))
		errors.push(m.text())
})
await pg.goto(`http://127.0.0.1:${server.address().port}/`)
await pg.waitForTimeout(500)

let n_checks = 0
function check(name, ok, detail) {
	n_checks++
	if (!ok) {
		console.log('FAIL', name, detail ?? '')
		process.exitCode = 1
	}
}

check('no page errors', errors.length == 0, errors.join('\n'))

// the draw state has the placement of the plan in the box.
function read_view() {
	return pg.evaluate(function() {
		let ds = ui._state_map.get('fe').draw_state
		return {x0: ds.x0, y0: ds.y0, scale: ds.scale}
	})
}
function read_segs() {
	return pg.evaluate(() => JSON.stringify(
		window.house.floors[0].segs.map(s => [s[0][0], s[0][1], s[1][0], s[1][1]])))
}
function hit_state() {
	return pg.evaluate(function() {
		let h = ui.hovers('fe') // hit state of the pointer
		return h && {action: h.action, has_seg: !!h.seg, x: h.x, y: h.y}
	})
}

let view = await read_view()
check('plan placed', view.scale > 0 && view.x0 != null, JSON.stringify(view))

// the connecting wall is at x=200 on the plan.
let sx = Math.round(view.x0 + Math.round(200 * view.scale))
let sy = Math.round(view.y0 + Math.round(200 * view.scale))
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(200)
let hs = await hit_state()
check('hovering a wall hits it', hs?.action == 'move_seg' && hs.has_seg,
	JSON.stringify(hs))

// dragging the wall moves it.
let segs0 = await read_segs()
await pg.mouse.down()
await pg.mouse.move(sx + 100, sy, {steps: 10}) // past the 20-unit snap.
await pg.mouse.up()
await pg.waitForTimeout(300)
let segs1 = await read_segs()
check('dragging a wall moves it', segs0 != segs1, segs0 + ' ' + segs1)

// the wheel zooms.
view = await read_view()
await pg.mouse.move(400, 300)
await pg.waitForTimeout(100)
await pg.mouse.wheel(0, -100)
await pg.waitForTimeout(300)
let view1 = await read_view()
check('the wheel zooms in', view1.scale > view.scale,
	JSON.stringify([view, view1]))

// shift+drag pans.
await pg.keyboard.down('Shift')
await pg.mouse.move(300, 300)
await pg.waitForTimeout(100)
await pg.mouse.down()
await pg.mouse.move(340, 320, {steps: 4})
await pg.mouse.up()
await pg.keyboard.up('Shift')
await pg.waitForTimeout(300)
let view2 = await read_view()
check('shift+drag pans', view2.x0 != view1.x0 || view2.y0 != view1.y0,
	JSON.stringify([view1, view2]))

check('no page errors after input', errors.length == 0, errors.join('\n'))

// the pages that host the demos load without errors and build the widget.
let base_url = `http://127.0.0.1:${server.address().port}`
for (let url of ['/cui_app', '/ui-demo.html?demo=floor_editor']) {
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
	check(url+': floor editor built', await pg1.evaluate(function() {
		for (let [id, s] of ui._state_map)
			if (s.draw_state?.scale > 0)
				return true
		return false
	}))
	await pg1.close()
}

await browser.close()
server.close()
console.log(n_checks + ' checks' + (process.exitCode ? ', FAILED' : ' ok'))
