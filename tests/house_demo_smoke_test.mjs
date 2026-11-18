// run: node tests/house_demo_smoke_test.mjs
// the pages that host the house demos load without errors and build their
// widgets.
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const www = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
	'..', 'www')
const test_plans = (await fs.readFile(path.join(www, 'ui-demo.html'), 'utf8'))
	.match(/<script id=house_test_plans>[\s\S]*?<\/script>/)[0]

// script order and globals of lua/cui_app.lua.
const pages = {
	'/cui_app_floor': `<!DOCTYPE html>
<html>
<head>
<link rel="icon" href="data:,">
<script src=glue.js global></script>
<script src=ui.js global></script>
<script src=ui_icon_defs.js></script>
<script src=ui_field.js></script>
<script src=earcut.js></script>
<script src=3d.js></script>
<script src=plane_graph.js></script>
<script src=roof_skeleton.js></script>
<script src=clipper2.js></script>
<script src=prism_union.js></script>
<script src=house_plan_objects.js></script>
<script src=house_plan.js></script>
${test_plans}
<script src=house_plan_editor.js></script>
<script>
let plan_json = json(house_test_plans.gable1)
ui.main = function() {
	h(1, sp2())
		for (let i = 0; i < house_test_plans.gable1.floors.length; i++)
			ui.floor_editor('fe'+i, plan_json)
	end_h()
}
</script>
<body></body>
</html>`,
	'/cui_app_model': `<!DOCTYPE html>
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
</html>`,
}

const server = http.createServer(async function(req, res) {
	let url = req.url.split('?')[0]
	if (pages[url]) {
		res.setHeader('content-type', 'text/html')
		return res.end(pages[url])
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

let n_checks = 0
function check(name, ok, detail) {
	n_checks++
	if (!ok) {
		console.log('FAIL', name, detail ?? '')
		process.exitCode = 1
	}
}

function is_floor_editor_built() {
	for (let [id, s] of ui._state_map)
		if (s.draw_state?.scale > 0)
			return true
	return false
}

function is_model_editor_built() {
	for (let [id, s] of ui._state_map)
		if (s.e?.house)
			return s.e.root.comp.children.length > 1
	return false
}

let base_url = `http://127.0.0.1:${server.address().port}`
for (let [url, is_built] of [
	['/cui_app_floor', is_floor_editor_built],
	['/ui-demo.html?demo=floor_editor', is_floor_editor_built],
	['/cui_app_model', is_model_editor_built],
	['/ui-demo.html?demo=house_model_editor', is_model_editor_built],
]) {
	let pg = await browser.newPage({deviceScaleFactor: 1,
		viewport: {width: 800, height: 600}})
	let errors = [] // [message, ...]
	pg.on('pageerror', e => errors.push(e.stack ?? e.message))
	pg.on('console', function(m) {
		if (m.type() == 'error' && !/favicon/.test(m.location().url))
			errors.push(m.text())
	})
	await pg.goto(base_url + url)
	await pg.waitForTimeout(800)
	check(url+': no page errors', errors.length == 0, errors.join('\n'))
	check(url+': editor built', await pg.evaluate(is_built))
	await pg.close()
}

await browser.close()
server.close()
console.log(n_checks + ' checks' + (process.exitCode ? ', FAILED' : ' ok'))
