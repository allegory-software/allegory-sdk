// run: node tests/house_plan_editor_test.mjs
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
<script src=plane_graph.js></script>
<script src=roof_skeleton.js></script>
<script src=clipper2.js></script>
<script src=prism_union.js></script>
<script src=house_plan.js></script>
${test_plans}
<script src=ui.js></script>
<script src=ui_icon_defs.js></script>
<script src=ui_field.js></script>
<script src=house_plan_editor.js></script>
<script>
window.plan_json = json(house_test_plans.simple)
ui.main = function() {
	if (window.publish_plan) {
		ui.floor_editor_update_value('fe')
		window.publish_plan = false
	}
	window.plan_json = ui.floor_editor('fe', window.plan_json,
		null, null, window.editor_readonly)
	window.input_value = ui.value('fe')
	window.raw_input_value = ui.input_value('fe')
	window.house = ui.state_of('fe', 'house')
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
<script src=ui_field.js></script>
<script src=earcut.js></script>
<script src=3d.js></script>
<script src=plane_graph.js></script>
<script src=roof_skeleton.js></script>
<script src=clipper2.js></script>
<script src=prism_union.js></script>
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
let input_json = await pg.evaluate(function() {
	let save_state = house.save_state
	window.snapshot_n = 0
	house.save_state = function() {
		window.snapshot_n++
		return save_state()
	}
	return window.input_value
})
let segs0 = await read_segs()
await pg.mouse.down()
await pg.mouse.move(sx + 100, sy, {steps: 10}) // past the 20-unit snap.
await pg.mouse.up()
await pg.waitForTimeout(300)
let segs1 = await read_segs()
check('dragging a wall moves it', segs0 != segs1, segs0 + ' ' + segs1)
check('editing keeps JSON serialization deferred', await pg.evaluate(value =>
	window.input_value == value && window.snapshot_n == 0, input_json))
await pg.evaluate(function() {
	window.house0 = house
	window.publish_plan = true
	ui.animate()
})
await pg.waitForTimeout(100)
check('publishing builds JSON once and preserves the live house',
	await pg.evaluate(value => window.input_value != value
		&& window.snapshot_n == 1 && house == window.house0, input_json))

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
	let seg = cs.edit?.seg
	return seg && {length: seg.m2 - seg.m1, dx: cs.dx}
})
// lengths snap to the house's precision: 1 cm.
check('new wall follows the pointer without an initial jump',
	resize && resize.length == Math.round(resize.dx / view.scale),
	JSON.stringify(resize))
await pg.evaluate(function() {
	let rebuild = ui.rebuild
	ui.rebuild = function(label) {
		if (label == 'floor_editor_changed') {
			let ds = ui._state_map.get('fe').draw_state
			window.release_guides = ds.snap_lines.length
			ui.rebuild = rebuild
		}
		return rebuild(label)
	}
})
await pg.mouse.up()
await pg.waitForTimeout(100)
check('wall release clears drawing guides', await pg.evaluate(function() {
	return window.release_guides == 0
}))

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
	let seg = ui.captured('fe').edit?.seg
	return {scale: ds.scale, length: seg && seg.m2 - seg.m1}
})
check('collapsed wall keeps a finite positive view scale',
	collapsed.length == 0 && Number.isFinite(collapsed.scale)
		&& collapsed.scale > 0,
	JSON.stringify(collapsed))
await pg.mouse.move(sx + 60, sy)
await pg.waitForTimeout(100)
let extended = await pg.evaluate(function() {
	let seg = ui.captured('fe').edit?.seg
	return seg && seg.m2 - seg.m1
})
check('collapsed wall can be extended again',
	extended == Math.round(20 / view.scale), extended)
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
			let ds = ui.state_of('fe', 'draw_state')
			return ui.captured_id == null && f.comps[0].ps.length == f.ps.length
				&& f.comps[0].segs.length == f.segs.length
				&& !ds.snap_lines.length
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
async function reset_empty_floor() {
	await pg.evaluate(function() {
		window.publish_plan = true
		ui.animate()
	})
	await pg.waitForTimeout(100)
	await pg.evaluate(function() {
		window.plan_json = json({floors: [{lines: []}]})
		ui.animate()
	})
	await pg.waitForTimeout(100)
}

await pg.reload()
await pg.waitForTimeout(200)
view1 = await read_view()
await reset_empty_floor()
view = await read_view()
check('loading an empty floor keeps the view', view.scale == view1.scale
	&& view.x0 == view1.x0 && view.y0 == view1.y0, JSON.stringify(view))
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
await reset_empty_floor()
view1 = await read_view()
check('empty floor preserves panning',
	view1.x0 == view.x0 && view1.y0 == view.y0, JSON.stringify(view1))
await pg.mouse.move(400, 300)
await pg.waitForTimeout(50)
await pg.mouse.wheel(0, -100)
await pg.waitForTimeout(100)
view = await read_view()
await reset_empty_floor()
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
	// the connecting wall at x=200: the wall at x=0 leaves the view at
	// 90 and 270 degrees.
	let angle = turns * Math.PI / 2
	let c = Math.cos(angle), s = Math.sin(angle)
	let px = view.x0 + Math.round(200 * view.scale) - 400
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
		moved_axis == 200 + Math.round(40 / view.scale), moved_axis)
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
let pan_dx = view1.x0 - view.x0
let pan_dy = view1.y0 - view.y0
let pan_angle = 3 * Math.PI / 2
let pan_x = pan_dx * Math.cos(pan_angle) - pan_dy * Math.sin(pan_angle)
let pan_y = pan_dx * Math.sin(pan_angle) + pan_dy * Math.cos(pan_angle)
check('rotated panning follows screen pixels',
	Math.abs(pan_x - 40) < 1e-6 && Math.abs(pan_y - 20) < 1e-6,
	JSON.stringify([pan_x, pan_y]))
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

// input values and readonly publication.
await pg.evaluate(function() {
	window.plan_json = null
	ui.animate()
})
await pg.waitForTimeout(100)
check('the input accepts null', await pg.evaluate(() =>
	window.input_value === null && house == null))
await pg.evaluate(function() {
	window.plan_json = '{'
	ui.animate()
})
await pg.waitForTimeout(100)
check('the input preserves invalid JSON', await pg.evaluate(() =>
	window.input_value === undefined && window.raw_input_value == '{'
		&& house == null))
await pg.evaluate(function() {
	window.plan_json = json(house_test_plans.simple)
	window.editor_readonly = true
	ui.animate()
})
await pg.waitForTimeout(100)
let readonly_json = await pg.evaluate(() => window.input_value)
await pg.evaluate(function() {
	window.publish_plan = true
	ui.animate()
})
await pg.waitForTimeout(100)
check('readonly input does not publish edits', await pg.evaluate(value =>
	window.input_value == value, readonly_json))

// room and roof edit completion, cancellation and clicks.
for (let action of ['room_point', 'eave', 'line', 'blocked_line']) {
	for (let finish of ['drop', 'cancel', 'click', 'cancel_click']) {
		await pg.reload()
		await pg.waitForTimeout(200)
		let roof_click = await pg.evaluate(async function(blocked) {
			let point
			let fill_text = ui.cx.fillText
			ui.cx.fillText = function(text, x, y, ...args) {
				if (text == 'ROOF') {
					let p = this.getTransform().transformPoint({x: x+3, y: y-3})
					point = {x: p.x, y: p.y}
				}
				return fill_text.call(this, text, x, y, ...args)
			}
			try {
				window.plan_json = json({floors: [{
					lines: [['draw', 0, 0, 600, 400, -600, -400]],
					room_points: [{x: 100, y: 200, is_open: true}],
					roof: {pitch: 20, overhang: 20,
						eave_h: -20 * Math.tan(20 * Math.PI / 180),
						edge_points: blocked ? [
						{x: 100, y: -14, pitch: 20},
						{x: 500, y: -14, pitch: 20},
					] : []},
				}]})
				ui.animate()
				await new Promise(resolve => requestAnimationFrame(() =>
					requestAnimationFrame(resolve)))
				return point
			} finally {
				ui.cx.fillText = fill_text
			}
		}, action == 'blocked_line')
		if (action != 'room_point') {
			await pg.mouse.click(roof_click.x, roof_click.y)
			await pg.waitForTimeout(100)
		}
		view = await read_view()
		sx = view.x0 + Math.round((action == 'room_point' ? 100
			: action == 'eave' ? 634 : 300) * view.scale)
		sy = view.y0 + Math.round(200 * view.scale)
		let before = await pg.evaluate(() => JSON.stringify(house.save_state()))
		await pg.mouse.move(sx, sy)
		await pg.waitForTimeout(50)
		await pg.mouse.down()
		await pg.waitForTimeout(50)
		let expected_action = action == 'line' || action == 'blocked_line'
			? 'move_faces' : 'move_' + action
		check(action+' '+finish+': capture starts without a model edit',
			await pg.evaluate(action => {
				let cs = ui.captured('fe')
				return cs?.action == action && !cs.edit && house.edit_no == 0
			}, expected_action))
		let moved = finish == 'drop' || finish == 'cancel'
		if (moved) {
			await pg.mouse.move(sx + (action == 'room_point' ? 40
				: action == 'eave' ? 40 : 0),
				sy + (action == 'eave' || action == 'room_point' ? 0 : 40))
			await pg.waitForTimeout(100)
			check(action+' '+finish+': model edit starts only when allowed',
				await pg.evaluate(blocked =>
					!!ui.captured('fe')?.edit == !blocked && house.edit_no == 0,
				action == 'blocked_line'))
		}
		if (finish == 'cancel' || finish == 'cancel_click') {
			await pg.keyboard.down('Escape')
			await pg.waitForTimeout(100)
			await pg.keyboard.up('Escape')
		}
		await pg.mouse.up()
		await pg.waitForTimeout(100)
		check(action+' '+finish+': capture and drawing guides are cleared',
			await pg.evaluate(function() {
				let ds = ui.state_of('fe', 'draw_state')
				return ui.captured_id == null && !ds.snap_lines.length
			}))
		let commits = finish == 'drop' && action != 'blocked_line'
			|| finish == 'click' && (action == 'room_point' || action == 'eave')
		check(action+' '+finish+': history matches the completed action',
			await pg.evaluate(({before, commits}) => {
				if (!commits)
					return JSON.stringify(house.save_state()) == before
						&& house.edit_no == 0 && !house.undo()
				return JSON.stringify(house.save_state()) != before
					&& house.edit_no == 1 && house.undo()
					&& JSON.stringify(house.save_state()) == before && !house.undo()
			}, {before, commits}))
	}
}
check('no page errors after room and roof edits',
	errors.length == 0, errors.join('\n'))

// the screen points of the texts drawn in one frame: [{text, x, y}, ...].
function read_texts() {
	return pg.evaluate(async function() {
		let texts = []
		let fill_text = ui.cx.fillText
		ui.cx.fillText = function(text, x, y, ...args) {
			let p = this.getTransform().transformPoint({x: x, y: y})
			texts.push({text: text, x: p.x, y: p.y})
			return fill_text.call(this, text, x, y, ...args)
		}
		try {
			ui.animate()
			await new Promise(resolve => requestAnimationFrame(() =>
				requestAnimationFrame(resolve)))
			return texts
		} finally {
			ui.cx.fillText = fill_text
		}
	})
}

// a 600 x 400 house with a hip roof of 20 degrees and an overhang of 20,
// shown at the roof level.
async function load_roof_plan(edge_points) {
	await pg.reload()
	await pg.waitForTimeout(200)
	await pg.evaluate(function(edge_points) {
		window.plan_json = json({floors: [{
			lines: [['draw', 0, 0, 600, 400, -600, -400]],
			roof: {pitch: 20, overhang: 20,
				eave_h: -20 * Math.tan(20 * Math.PI / 180),
				edge_points: edge_points},
		}]})
	}, edge_points)
	for (let t of await read_texts())
		if (t.text == 'ROOF')
			await pg.mouse.click(t.x + 3, t.y - 3)
	await pg.waitForTimeout(100)
}

// shift over an eave pans; a double-click on a dragged ridge resets it.
await load_roof_plan([])
view = await read_view()
sx = view.x0 + Math.round(634 * view.scale) // east eave
sy = view.y0 + Math.round(200 * view.scale)
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(50)
check('eave hit without shift', (await hit_state())?.action == 'move_eave')
await pg.keyboard.down('Shift')
await pg.mouse.move(sx + 1, sy)
await pg.waitForTimeout(50)
check('shift over an eave hits only pan', await pg.evaluate(function() {
	let hs = ui.hovers('fe')
	return hs?.action == 'pan' && !hs.roof_side
}))
await pg.keyboard.up('Shift')
sx = view.x0 + Math.round(300 * view.scale) // ridge
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(50)
check('ridge is hit', await pg.evaluate(function() {
	let hs = ui.hovers('fe')
	return hs?.action == 'move_faces' && hs.roof_faces.length == 2
}), JSON.stringify(await hit_state()))
await pg.mouse.down()
await pg.waitForTimeout(50)
await pg.mouse.move(sx, sy + 40, {steps: 4})
await pg.waitForTimeout(50)
await pg.mouse.up()
await pg.waitForTimeout(100)
check('ridge drag sets own pitches', await pg.evaluate(function() {
	let eps = house.floors[0].roof.edge_points
	return house.edit_no == 1 && eps.length == 2
		&& eps[0].pitch != eps[1].pitch
}))
await pg.mouse.move(sx + 20, sy + 40)
await pg.waitForTimeout(50)
await pg.mouse.move(sx, sy + 40)
await pg.waitForTimeout(100)
check('dragged ridge is hit', (await hit_state())?.action == 'move_faces')
await pg.mouse.dblclick(sx, sy + 40, {delay: 80})
await pg.waitForTimeout(100)
check('double-click resets the ridge', await pg.evaluate(function() {
	let eps = house.floors[0].roof.edge_points
	if (house.edit_no != 2 || eps.length != 2)
		return false
	for (let ep of eps)
		if (ep.pitch != null)
			return false
	// ridge at y = 200; hips at 45 degrees.
	let ds = ui.state_of('fe', 'draw_state')
	let has_ridge = false
	for (let {p, q} of ds.roof_lines) {
		let dx = Math.abs(q[0] - p[0])
		let dy = Math.abs(q[1] - p[1])
		if (dy < 1e-6)
			has_ridge = Math.abs(p[1] - 200) < 1e-6
		else if (Math.abs(dx - dy) > 1e-6)
			return false
	}
	return has_ridge
}))

// ctrl: an eave moves below the drag threshold; a click does not toggle.
sx = view.x0 + Math.round(634 * view.scale) // east eave
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(50)
await pg.keyboard.down('Control')
await pg.waitForTimeout(50)
await pg.mouse.down()
await pg.waitForTimeout(50)
check('ctrl+press on an eave starts no edit before a movement',
	await pg.evaluate(() =>
		ui.captured('fe')?.action == 'move_eave' && !ui.captured('fe').edit))
await pg.mouse.up()
await pg.waitForTimeout(100)
check('ctrl+click on an eave does not toggle its gable',
	await pg.evaluate(() => house.edit_no == 2))
await pg.mouse.down()
await pg.waitForTimeout(50)
await pg.mouse.move(sx + 4, sy, {steps: 2})
await pg.waitForTimeout(50)
check('ctrl+press on an eave starts its move at the first movement',
	await pg.evaluate(() => !!ui.captured('fe')?.edit))
await pg.mouse.up()
await pg.keyboard.up('Control')
await pg.waitForTimeout(100)
check('ctrl+drag below the threshold moves only the eave',
	await pg.evaluate(function() {
		let roof = house.floors[0].roof
		let eave_h = Math.round(-20 * Math.tan(20 * Math.PI / 180)) // 1 cm
		return house.edit_no == 3 && roof.eave_h == eave_h
			&& roof.edge_points.some(p => p.x == 614 && p.eave_h < eave_h)
	}), await pg.evaluate(() =>
		json({edit_no: house.edit_no, roof: house.floors[0].roof})))

// pitch labels: one per face; a drag changes the face's pitch, shift all
// pitches, within 1..89; without shift, two edge points block the drag.
async function read_labels() {
	let labels = []
	for (let t of await read_texts())
		if (t.text.endsWith('\u00b0'))
			labels.push(t)
	return labels
}
// the label nearest to the north eave.
function north_label(labels) {
	let found
	for (let t of labels)
		if (!found || t.y < found.y)
			found = t
	return found
}
async function drag_label(label, dy, shift) {
	await pg.mouse.move(label.x, label.y - 5)
	await pg.waitForTimeout(50)
	await pg.mouse.down()
	await pg.waitForTimeout(50)
	if (shift) // shift before the press pans.
		await pg.keyboard.down('Shift')
	await pg.waitForTimeout(50)
	await pg.mouse.move(label.x, label.y - 5 + dy, {steps: 4})
	await pg.waitForTimeout(50)
	let can_move = await pg.evaluate(() => ui.captured('fe')?.can_move_pitch)
	await pg.mouse.up()
	await pg.waitForTimeout(50)
	if (shift)
		await pg.keyboard.up('Shift')
	await pg.waitForTimeout(100)
	return can_move
}
function read_roof() {
	return pg.evaluate(() => house.floors[0].roof)
}

await load_roof_plan([])
let labels = await read_labels()
check('one pitch label per face', labels.length == 4
	&& labels.every(t => t.text == '20\u00b0'), JSON.stringify(labels))
await drag_label(north_label(labels), -20, true)
let roof = await read_roof()
check('shift+label drag changes the roof pitch',
	roof.pitch == 25 && !roof.edge_points.length, JSON.stringify(roof))
labels = await read_labels()
await drag_label(north_label(labels), 20)
roof = await read_roof()
check('label drag changes only the face',
	roof.pitch == 25 && roof.edge_points.length == 1
		&& roof.edge_points[0].pitch == 20, JSON.stringify(roof))
labels = await read_labels()
check('labels show the new pitches',
	labels.filter(t => t.text == '25\u00b0').length == 3
		&& north_label(labels).text == '20\u00b0', JSON.stringify(labels))
await drag_label(north_label(labels), -400, true)
roof = await read_roof()
check('shift+label drag keeps the steepest pitch at 89',
	roof.pitch == 89 && roof.edge_points[0].pitch == 84
		&& await pg.evaluate(() => house.edit_no == 3), JSON.stringify(roof))

await load_roof_plan([
	{x: 100, y: -14, pitch: 30},
	{x: 500, y: -14, pitch: 30},
])
labels = await read_labels()
let can_move = await drag_label(north_label(labels), -20)
check('label drag on a side with two edge points does nothing',
	can_move === false && await pg.evaluate(() => house.edit_no == 0))

// the east ridge end (400, 200), where the north, south and east faces
// meet: a drag along the ridge outward makes only the east face steeper.
await load_roof_plan([])
view = await read_view()
sx = view.x0 + Math.round(400 * view.scale)
sy = view.y0 + Math.round(200 * view.scale)
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(100)
check('ridge end is hit with its three faces', await pg.evaluate(function() {
	let hs = ui.hovers('fe')
	return hs?.action == 'move_faces' && hs.roof_faces.length == 3
}))
await pg.mouse.down()
await pg.waitForTimeout(50)
await pg.mouse.move(sx + 40, sy, {steps: 4})
await pg.waitForTimeout(50)
await pg.mouse.up()
await pg.waitForTimeout(100)
roof = await read_roof()
// eave_h snapped to 1 cm: the overhang (19.23) is off the grid, so the side
// faces' planes meet the wall top on the wall line only within the grid
// rounding of their eave lines: their pitch is off by ~3e-5 deg.
check('ridge end drag along the ridge changes only the end face',
	roof.edge_points.length == 3 && roof.edge_points.every(ep =>
		ep.x == 614 ? ep.pitch > 21 : Math.abs(ep.pitch - 20) < 1e-3),
	JSON.stringify(roof))

// double-click on a pitch label: the face back to the roof's pitch.
await load_roof_plan([{x: 300, y: -14, pitch: 30}])
labels = await read_labels()
check('the north face has its own pitch',
	north_label(labels).text == '30°', JSON.stringify(labels))
let label = north_label(labels)
await pg.mouse.move(label.x, label.y - 5)
await pg.waitForTimeout(50)
await pg.mouse.dblclick(label.x, label.y - 5, {delay: 80})
await pg.waitForTimeout(100)
check('double-click on a pitch label resets the face', await pg.evaluate(() =>
	house.floors[0].roof.edge_points[0].pitch == null && house.edit_no == 1))

// ctrl+double-click on an eave with an edge point: no move, the point is
// removed.
await load_roof_plan([{x: 300, y: 414, eave_h: -10}])
view = await read_view()
let south_c = await pg.evaluate(function() { // the south eave line
	let ds = ui.state_of('fe', 'draw_state')
	for (let side of ds.roof_sides)
		if (side.ny == 1)
			return side.c / prism_union.grid_scale
})
sx = view.x0 + Math.round(300 * view.scale)
sy = view.y0 + Math.round(south_c * view.scale)
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(50)
await pg.keyboard.down('Control')
await pg.waitForTimeout(50)
await pg.mouse.dblclick(sx, sy, {delay: 80})
await pg.waitForTimeout(100)
await pg.keyboard.up('Control')
await pg.waitForTimeout(50)
check('ctrl+double-click on an eave removes its edge point',
	await pg.evaluate(() =>
		house.floors[0].roof.edge_points.length == 0 && house.edit_no == 1),
	await pg.evaluate(() => house.edit_no + ' '
		+ JSON.stringify(house.floors[0].roof)) + ' ' + south_c
		+ errors.join('\n'))

// measurements: while dragging an eave, of the moved eaves; in the
// dimensions mode, of all eaves and lines.
await load_roof_plan([])
view = await read_view()
sx = view.x0 + Math.round(634 * view.scale) // east eave
sy = view.y0 + Math.round(200 * view.scale)
await pg.mouse.move(sx, sy)
await pg.waitForTimeout(50)
let texts0 = await read_texts()
await pg.mouse.down()
await pg.waitForTimeout(50)
await pg.keyboard.down('Shift')
await pg.mouse.move(sx + 30, sy, {steps: 4})
await pg.waitForTimeout(50)
let texts1 = await read_texts()
await pg.mouse.up()
await pg.keyboard.up('Shift')
await pg.waitForTimeout(100)
let heights = t => t.filter(t => t.text.startsWith('h ')).length
check('no eave heights shown while hovering', heights(texts0) == 0,
	JSON.stringify(texts0.map(t => t.text)))
check('shift+eave drag shows the heights of all sloped eaves',
	heights(texts1) == 4, JSON.stringify(texts1.map(t => t.text)))
check('no page errors after pan and line reset',
	errors.length == 0, errors.join('\n'))

// stepped roof: projected edges at different heights are not shared.
await pg.evaluate(function() {
	house.load_state({floors: [{
		lines: [['draw', 0, 0, 500, 100, 500, 900, -1000, -1000]],
		roof: {pitch: 90, overhang: 0, edge_points: [
			{x: 250, y: -14, pitch: Math.atan(.5) * 180 / Math.PI},
			{x: 750, y: 86, pitch: 45},
		]},
	}]})
	ui.animate()
})
await pg.waitForTimeout(100)
view = await read_view()
await pg.mouse.move(view.x0 + Math.round(514 * view.scale),
	view.y0 + Math.round(136 * view.scale))
await pg.waitForTimeout(50)
check('different roof heights produce no draggable shared line',
	await pg.evaluate(() => ui.hovers('fe')?.action != 'move_faces'))
check('roof shared endpoints reuse face points', await pg.evaluate(function() {
	let ds = ui.state_of('fe', 'draw_state')
	let points = new Set()
	for (let face of ds.roof_faces)
		for (let ring of face.rings)
			for (let p of ring)
				points.add(p)
	return ds.roof_lines.length == 1 && points.has(ds.roof_lines[0].p)
		&& points.has(ds.roof_lines[0].q)
}))
await pg.mouse.move(view.x0 + Math.round(600 * view.scale),
	view.y0 + Math.round(186 * view.scale))
await pg.waitForTimeout(50)
check('the actual join between roof faces remains draggable',
	await pg.evaluate(function() {
		let hs = ui.hovers('fe')
		if (hs?.action != 'move_faces')
			return false
		for (let face of hs.roof_faces) {
			let [a, b, c] = face.plane
			if (Math.abs(a * hs.roof_x + b * hs.roof_y + c - hs.roof_z) > 1e-6)
				return false
		}
		return true
	}))

// room area labels exclude islands and include each island's own room.
await pg.reload()
await pg.waitForTimeout(200)
let area_labels = await pg.evaluate(async function() {
	let labels = []
	let fill_text = ui.cx.fillText
	ui.cx.fillText = function(text, ...args) {
		labels.push(text)
		return fill_text.call(this, text, ...args)
	}
	try {
		window.plan_json = json({floors: [{lines: [
			['draw', 0, 0, 600, 400, -600, -400],
			['draw', 200, 100, 100, 100, -100, -100],
		]}]})
		ui.animate()
		await new Promise(resolve => requestAnimationFrame(() =>
			requestAnimationFrame(resolve)))
		return labels
	} finally {
		ui.cx.fillText = fill_text
	}
})
check('room area label excludes the island',
	area_labels.includes('22.04 m\u00b2'), JSON.stringify(area_labels))
check('island room area label shows its interior',
	area_labels.includes('0.85 m\u00b2'), JSON.stringify(area_labels))

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
