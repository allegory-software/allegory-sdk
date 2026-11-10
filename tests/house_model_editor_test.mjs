// run: node tests/house_model_editor_test.mjs
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
<script src=suncalc.js></script>
<script src=gl.js></script>
<script src=gl-renderer.js></script>
<script src=plane-graph.js></script>
<script src=house-plan.js></script>
<script src=model3.js></script>
<script src=ui.js></script>
<script src=model3-editor.js></script>
<script src=house-model-editor.js></script>
<script>
let plans = { // the first two of hd's test plans.
	simple: {
		floor_h: 250,
		floors: [{
			points: [[200, 0, 'cl'], [200, 400, 'cr']],
			lines: [
				['draw', 'tl', 0, 0, 'tr', 600, 'br', 400, 'bl', -600, 'tl', -400],
				['connect', 'cl', 'cr'],
			],
		}],
	},
	gable1: {
		floor_h: 250,
		floors: [{
			points: [[200, 0, 'cl'], [200, 400, 'cr']],
			lines: [
				['draw', 'tl', 0, 0, 'tr', 600, 'br', 400, 'bl', -600, 'tl', -400],
				['connect', 'cl', 'cr'],
			],
			roofs: [
				{type: 'gable', pitch: 45, eaves: 50, axis: 'h', h: 300,
					box: [-50, -50, 650, 450]},
			],
		}],
	},
}
window.houses = {simple: house_plan(plans.simple), gable1: house_plan(plans.gable1)}
window.house_name = 'simple'
ui.main = function() {
	ui.min_wh(400, 300)
	ui.house_model_editor('h', window.houses[window.house_name])
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
<script src=plane-graph.js></script>
<script src=house-plan.js></script>
<script src=house-test-plans.js></script>
<script src=model3-editor.js></script>
<script src=house-model-editor.js></script>
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
	r2?.children > (r1?.children ?? 0), JSON.stringify([r1, r2]))

check('no page errors after the switch', errors.length == 0,
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
