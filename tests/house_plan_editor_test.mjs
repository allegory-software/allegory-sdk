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

async function history_key(key, shift = false) {
	await pg.keyboard.down('Control')
	if (shift) await pg.keyboard.down('Shift')
	await pg.waitForTimeout(50)
	await pg.keyboard.down(key)
	await pg.waitForTimeout(50)
	await pg.keyboard.up(key)
	if (shift) await pg.keyboard.up('Shift')
	await pg.keyboard.up('Control')
	await pg.waitForTimeout(100)
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

// a new wall follows the pointer from its initial position.
await pg.reload()
await pg.waitForTimeout(300)
view = await read_view()
sx = view.x0 + Math.round(400 * view.scale)
sy = view.y0 + Math.round(200 * view.scale)
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(100)
await pg.mouse.down()
await pg.waitForTimeout(100)
await pg.mouse.move(sx + 40, sy)
await pg.waitForTimeout(100)
let resize = await pg.evaluate(function() {
	let cs = ui.captured('fe')
	let seg = cs.resize_seg?.seg
	return seg && {length: seg.m2 - seg.m1, dx: cs.dx}
})
check('new wall follows the pointer without an initial jump',
	resize && Math.abs(resize.length - resize.dx / view.scale) < 1e-6,
	JSON.stringify(resize))
await pg.mouse.up()
await pg.waitForTimeout(100)

// collapse the new wall, then extend it again during the same drag.
view = await read_view()
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(100)
await pg.mouse.down()
await pg.waitForTimeout(100)
await pg.mouse.move(sx + 40, sy)
await pg.waitForTimeout(100)
let collapsed = await pg.evaluate(function() {
	let ds = ui._state_map.get('fe').draw_state
	let seg = ui.captured('fe').resize_seg?.seg
	return {scale: ds.scale, length: seg && seg.m2 - seg.m1}
})
check('collapsed wall keeps a finite positive view scale',
	collapsed.length == 0 && Number.isFinite(collapsed.scale)
		&& collapsed.scale > 0,
	JSON.stringify(collapsed))
await pg.mouse.move(sx + 60, sy)
await pg.waitForTimeout(100)
let extended = await pg.evaluate(function() {
	let seg = ui.captured('fe').resize_seg?.seg
	return seg && seg.m2 - seg.m1
})
check('collapsed wall can be extended again',
	Math.abs(extended - 20 / view.scale) < 1e-6, extended)
await pg.mouse.up()
await pg.waitForTimeout(100)

// double-click deletion runs after the pointer has been released.
await pg.reload()
await pg.waitForTimeout(300)
view = await read_view()
sx = view.x0 + Math.round(200 * view.scale)
sy = view.y0 + Math.round(200 * view.scale)
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(100)
await pg.mouse.dblclick(sx, sy, {delay: 80})
await pg.waitForTimeout(200)
let deleted = await pg.evaluate(function() {
	let floor = house.floors[0]
	let has_divider = false
	for (let seg of floor.segs)
		if (seg.is_v && seg.axis == 200)
			has_divider = true
	return {has_divider, segs: floor.segs.length,
		cycles: floor.comps[0].cycles.length}
})
check('double-click deletes the wall and joins the rooms',
	!deleted.has_divider && deleted.segs == 4 && deleted.cycles == 2,
	JSON.stringify(deleted))
await history_key('z')
check('keyboard undo restores the deleted wall', await pg.evaluate(() =>
	house.floors[0].segs.length == 7
		&& house.floors[0].comps[0].cycles.length == 3))
await history_key('y')
check('keyboard redo deletes the wall again', await pg.evaluate(() =>
	house.floors[0].segs.length == 4
		&& house.floors[0].comps[0].cycles.length == 2))
check('no page errors after resizing and deletion', errors.length == 0,
	errors.join('\n'))

// merging the divider into either outside wall.
for (let target_x of [0, 600]) {
	await pg.reload()
	await pg.waitForTimeout(300)
	view = await read_view()
	sx = view.x0 + Math.round(200 * view.scale)
	sy = view.y0 + Math.round(200 * view.scale)
	await pg.mouse.move(sx, sy)
	await pg.waitForTimeout(100)
	await pg.mouse.down()
	await pg.waitForTimeout(100)
	await pg.mouse.move(view.x0 + Math.round(target_x * view.scale), sy,
		{steps: 10})
	await pg.waitForTimeout(100)
	let n_errors = errors.length
	await pg.mouse.up()
	await pg.waitForTimeout(200)
	let merged = await pg.evaluate(function() {
		let floor = house.floors[0]
		return {segs: floor.segs.length, cycles: floor.comps[0].cycles.length,
			drawn: ui._frame_drawn, captured: ui.captured_id}
	})
	check('merging at x=' + target_x + ' joins the rooms',
		merged.segs == 4 && merged.cycles == 2, JSON.stringify(merged))
	check('merging at x=' + target_x + ' draws without stale references',
		errors.length == n_errors && merged.drawn && merged.captured == null,
		errors.slice(n_errors).join('\n'))
}

// keyboard history and cancellation.
await pg.reload()
await pg.waitForTimeout(200)
segs0 = await read_segs()
view = await read_view()
sx = view.x0 + Math.round(200 * view.scale)
sy = view.y0 + Math.round(200 * view.scale)
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(50)
await pg.mouse.down()
await pg.waitForTimeout(50)
await pg.mouse.move(sx + 100, sy)
await pg.waitForTimeout(100)
await pg.mouse.up()
await pg.waitForTimeout(100)
segs1 = await read_segs()
check('wall click focuses the floor',
	await pg.evaluate(() => ui.focused_id == 'fe'))
await history_key('z')
check('Ctrl+Z undoes the complete wall drag', await read_segs() == segs0)
await history_key('z', true)
check('Ctrl+Shift+Z redoes the wall drag', await read_segs() == segs1)
await pg.evaluate(function() {
	ui.focus('fe.grid_button')
	ui.animate()
})
await pg.waitForTimeout(100)
await history_key('z')
check('history shortcuts work from the floor toolbar',
	await read_segs() == segs0)
await history_key('y')
check('Ctrl+Y redoes the wall drag', await read_segs() == segs1)
await pg.evaluate(function() {
	ui.focus(null)
	ui.animate()
})
await pg.waitForTimeout(100)
await history_key('z')
check('history shortcuts require floor focus', await read_segs() == segs1)

for (let action of ['move', 'create']) {
	await pg.reload()
	await pg.waitForTimeout(200)
	segs0 = await read_segs()
	view = await read_view()
	sx = view.x0 + Math.round(400 * view.scale)
	sy = view.y0 + Math.round((action == 'move' ? 0 : 200) * view.scale)
	await pg.mouse.move(sx, sy)
	await pg.waitForTimeout(50)
	await pg.mouse.down()
	await pg.waitForTimeout(50)
	await pg.mouse.move(sx + (action == 'create' ? 40 : 0),
		sy + (action == 'move' ? 80 : 0))
	await pg.waitForTimeout(100)
	await pg.keyboard.down('Escape')
	await pg.waitForTimeout(100)
	await pg.keyboard.up('Escape')
	await pg.waitForTimeout(50)
	check('Escape restores the wall ' + action, await read_segs() == segs0)
	check('Escape finalizes capture and topology for ' + action,
		await pg.evaluate(function() {
			let f = house.floors[0]
			return ui.captured_id == null && f.comps[0].ps.length == f.ps.length
				&& f.comps[0].segs.length == f.segs.length
		}))
	await pg.mouse.up()
	await pg.waitForTimeout(50)
	await history_key('z')
	check('cancelled ' + action + ' adds no undo step',
		await read_segs() == segs0)
}
check('no page errors after history and cancellation',
	errors.length == 0, errors.join('\n'))

// empty-floor drawing and view state.
await pg.reload()
await pg.waitForTimeout(200)
await pg.evaluate(function() {
	window.house = house_plan({floors: [{lines: []}]})
	ui.animate()
})
await pg.waitForTimeout(100)
view = await read_view()
check('empty floor has a centered view at scale 1',
	view.scale == 1 && view.x0 == 400 && view.y0 == 300,
	JSON.stringify(view))
await pg.mouse.move(400, 300)
await pg.waitForTimeout(50)
await pg.mouse.down()
await pg.waitForTimeout(50)
await pg.mouse.move(440, 300)
await pg.waitForTimeout(100)
await pg.mouse.up()
await pg.waitForTimeout(100)
check('a wall can be drawn on an empty floor', await pg.evaluate(function() {
	let f = house.floors[0]
	return f.segs.length == 1 && f.segs[0].m2 > f.segs[0].m1
}))
await pg.keyboard.down('Shift')
await pg.mouse.move(400, 300)
await pg.waitForTimeout(50)
await pg.mouse.down()
await pg.waitForTimeout(50)
await pg.mouse.move(440, 320)
await pg.mouse.up()
await pg.keyboard.up('Shift')
await pg.waitForTimeout(100)
view = await read_view()
await pg.evaluate(function() {
	window.house = house_plan({floors: [{lines: []}]})
	ui.animate()
})
await pg.waitForTimeout(100)
view1 = await read_view()
check('empty floor preserves panning',
	view1.x0 == view.x0 && view1.y0 == view.y0, JSON.stringify(view1))
await pg.mouse.move(400, 300)
await pg.waitForTimeout(50)
await pg.mouse.wheel(0, -100)
await pg.waitForTimeout(100)
view = await read_view()
await pg.evaluate(function() {
	window.house = house_plan({floors: [{lines: []}]})
	ui.animate()
})
await pg.waitForTimeout(100)
view1 = await read_view()
check('empty floor preserves zoom', view1.scale == view.scale
	&& view1.x0 == view.x0 && view1.y0 == view.y0, JSON.stringify(view1))

// rotated wall movement, panning and zooming.
for (let turns of [1, 2, 3]) {
	await pg.reload()
	await pg.waitForTimeout(200)
	await pg.evaluate(function() {
		ui.focus('fe.rotate_button')
		ui.animate()
	})
	await pg.waitForTimeout(50)
	for (let i = 0; i < turns; i++) {
		await pg.keyboard.down('Enter')
		await pg.waitForTimeout(50)
		await pg.keyboard.up('Enter')
		await pg.waitForTimeout(50)
	}
	view = await read_view()
	let angle = turns * Math.PI / 2
	let c = Math.cos(angle), s = Math.sin(angle)
	let px = view.x0 - 400
	let py = view.y0 + Math.round(200 * view.scale) - 300
	sx = 400 + px * c - py * s
	sy = 300 + px * s + py * c
	await pg.mouse.move(sx, sy)
	await pg.waitForTimeout(50)
	await pg.mouse.down()
	await pg.waitForTimeout(50)
	await pg.mouse.move(sx + 40 * c, sy + 40 * s)
	await pg.waitForTimeout(100)
	let moved_axis = await pg.evaluate(() => ui.captured('fe')?.seg?.axis)
	check('wall follows the pointer at rotation ' + turns * 90,
		Math.abs(moved_axis - 40 / view.scale) < 1e-6, moved_axis)
	await pg.mouse.up()
	await pg.waitForTimeout(100)
}
view = await read_view()
await pg.keyboard.down('Shift')
await pg.mouse.move(400, 300)
await pg.waitForTimeout(50)
await pg.mouse.down()
await pg.waitForTimeout(50)
await pg.mouse.move(440, 320)
await pg.mouse.up()
await pg.keyboard.up('Shift')
await pg.waitForTimeout(100)
view1 = await read_view()
check('rotated panning follows screen pixels',
	view1.x0 - view.x0 == 40 && view1.y0 - view.y0 == 20,
	JSON.stringify([view, view1]))
view = view1
let angle = 3 * Math.PI / 2
let c = Math.cos(angle), s = Math.sin(angle)
let ux = 400 + 100 * c + 50 * s
let uy = 300 - 100 * s + 50 * c
let plan_x = (ux - view.x0) / view.scale
let plan_y = (uy - view.y0) / view.scale
await pg.mouse.move(500, 350)
await pg.waitForTimeout(50)
await pg.mouse.wheel(0, -100)
await pg.waitForTimeout(100)
view1 = await read_view()
let px = view1.x0 + Math.round(plan_x * view1.scale) - 400
let py = view1.y0 + Math.round(plan_y * view1.scale) - 300
let zoom_x = 400 + px * c - py * s
let zoom_y = 300 + px * s + py * c
check('rotated zoom keeps the point under the pointer',
	Math.abs(zoom_x - 500) <= 1 && Math.abs(zoom_y - 350) <= 1,
	JSON.stringify([zoom_x, zoom_y]))
check('no page errors after empty-floor and rotated editing',
	errors.length == 0, errors.join('\n'))

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
