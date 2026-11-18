// run: node tests/house_model_plans_probe_test.mjs plan1.json ...
// loads each plan file in the house model editor and reports page errors.
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const www = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
	'..', 'www')

// script order and globals of lua/cui_app.lua.
function model_page(plan_json, cut_i) {
	return `<!DOCTYPE html>
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
<script src=model3_editor.js></script>
<script src=house_model_editor.js></script>
<script>
let house
ui.main = function() {
	house ??= house_plan(${plan_json})
	ui.house_model_editor('h', house, house.floors[${cut_i}])
}
</script>
<body></body>
</html>`
}

let plan_files = process.argv.slice(2)
const server = http.createServer(async function(req, res) {
	let url = req.url.split('?')[0]
	let m = url.match(/^\/plan(\d+)_(\d+|null)$/)
	if (m) {
		let plan_json = await fs.readFile(plan_files[m[1]], 'utf8')
		res.setHeader('content-type', 'text/html')
		return res.end(model_page(plan_json, m[2]))
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

let base_url = `http://127.0.0.1:${server.address().port}`
for (let i = 0; i < plan_files.length; i++) {
let n_floors = JSON.parse(await fs.readFile(plan_files[i], 'utf8')).floors.length
for (let cut_i = -1; cut_i < n_floors; cut_i++) {
	let pg = await browser.newPage({deviceScaleFactor: 1,
		viewport: {width: 800, height: 600}})
	let errors = [] // [message, ...]
	pg.on('pageerror', e => errors.push(e.stack ?? e.message))
	pg.on('console', function(m) {
		if (m.type() == 'error' && !/favicon/.test(m.location().url))
			errors.push(m.text())
	})
	await pg.goto(base_url + '/plan' + i + '_' + (cut_i < 0 ? 'null' : cut_i))
	await pg.waitForTimeout(1500)
	console.log(plan_files[i], cut_i, errors.length ? 'ERRORS' : 'ok')
	for (let e of errors)
		console.log(e.slice(0, 800))
	await pg.close()
}
}

await browser.close()
server.close()
