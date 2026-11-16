// run: node tests/house_height_controls_test.mjs
import assert from 'node:assert/strict'
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const www = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
	'..', 'www')
const scripts = ['glue.js', 'earcut.js', '3d.js', 'suncalc.js', 'gl.js',
	'gl_renderer.js', 'model3.js', 'plane_graph.js', 'roof_skeleton.js',
	'clipper2.js', 'prism_union.js', 'house_plan.js', 'ui.js',
	'ui_icon_defs.js', 'ui_field.js', 'model3_editor.js',
	'house_model_editor.js']
const html = `<!DOCTYPE html><link rel=icon href=data:,>
${scripts.map(s => `<script src=${s}${s == 'glue.js' ? ' global' : ''}>
</script>`).join('\n')}
<script>
window.house = house_plan({version: 1, floors: [
	{lines: [['connect', [0, 0], [6000, 0], [6000, 4000], [0, 4000], [0, 0]]]},
	{lines: [['connect', [0, 0], [6000, 0], [6000, 4000], [0, 4000], [0, 0]]]},
]})
window.show_editor = true
window.cut = false
window.readonly = false
ui.main = function() {
	if (show_editor)
		ui.house_model_editor('model', house, cut ? house.floors[0] : null,
			null, null, null, readonly)
}
</script><body></body>`

const server = http.createServer(async function(req, res) {
	if (req.url == '/') {
		res.setHeader('content-type', 'text/html')
		return res.end(html)
	}
	let file = path.join(www, decodeURIComponent(req.url.split('?')[0]))
	if (!file.startsWith(www + path.sep)) {
		res.statusCode = 404
		return res.end()
	}
	try {
		let buf = await fs.readFile(file)
		res.setHeader('content-type', file.endsWith('.js')
			? 'text/javascript' : '')
		res.end(buf)
	} catch {
		res.statusCode = 404
		res.end()
	}
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
let browser
try {
	browser = await chromium.launch({channel: 'chrome', headless: true,
		args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
	const page = await browser.newPage({viewport: {width: 1200, height: 900}})
	async function frame() {
		await page.evaluate(() => new Promise(resolve => {
			ui.frame_changed = resolve
			ui.animate()
		}))
	}
	let errors = []
	page.on('pageerror', e => errors.push(e.stack ?? e.message))
	page.on('console', m => {
		if (m.type() == 'error') errors.push(m.text())
	})
	await page.goto(`http://127.0.0.1:${server.address().port}/`)
	await page.waitForTimeout(500)
	assert.deepEqual(errors, [])
	await page.evaluate(function() {
		let e = ui._state_map.get('model').e
		e.set_camera_pos(Math3D.v3(-10000, 9000, 16000))
		e.set_camera_dir(Math3D.v3(-1300, 600, 1400))
	})
	await frame()
	assert(await page.evaluate(function() {
		let e = ui._state_map.get('model').e
		let {v3, line3} = Math3D
		let behind = v3().set(e.camera_pos).add(e.camera_dir)
		let axis = line3()
		axis[0].set(e.camera_pos).sub(e.camera_dir)
		axis[1].set(e.camera_pos).sub(v3().set(e.camera_dir).muls(2))
		return !e.world_to_screen(behind, v3())
			&& !e.screen_to_axis(600, 450, axis, v3())
	}))

	async function state() {
		return page.evaluate(() => ({
			heights: house.floors.map(f => f.h),
			levels: house.floors.map(f => f.z),
			roof: house.floors[1].roof_height(),
			edit_no: house.edit_no,
			saved: JSON.stringify(house.save_state()),
		}))
	}
	async function control(i, dz = 0) {
		return page.evaluate(function({i, dz}) {
			let s = ui._state_map.get('model')
			let f = house.floors[Math.max(0, i-1)]
			let z = i == 3 ? house.h + house.floors[1].roof_height()
				: f.z + f.h
			let p = s.e.world_to_screen(Math3D.v3(house.bb[0]-1000,
				z + dz, house.bb[3]+1000), Math3D.v3())
			return {x: p[0] + s.x, y: p[1] + s.y}
		}, {i, dz})
	}
	async function drag(i, dz) {
		let p0 = await control(i)
		let p1 = await control(i, dz)
		await page.mouse.move(p0.x, p0.y)
		await frame()
		assert.equal(await page.evaluate(() => !!ui.hovers('model.heights')),
			true, JSON.stringify({p0, p1, errors}))
		await page.mouse.down()
		await frame()
		await page.mouse.move(p1.x, p1.y, {steps: 4})
		await frame()
	}

	const before = await state()
	await drag(1, 600)
	let preview = await state()
	assert(Math.abs(preview.heights[0] - 3100) <= 30,
		JSON.stringify({preview, errors}))
	assert.equal(preview.heights[1], 2500)
	assert.equal(preview.levels[1], preview.heights[0])
	await page.evaluate(() => {
		window.root_at_rest = ui._state_map.get('model').e.root.comp
	})
	await frame()
	assert(await page.evaluate(() =>
		root_at_rest == ui._state_map.get('model').e.root.comp))
	await page.mouse.up()
	await frame()
	const moved = await state()
	assert.equal(moved.edit_no, 1)
	await page.keyboard.press('Control+z')
	await frame()
	assert.equal((await state()).saved, before.saved)
	await page.keyboard.press('Control+Shift+z')
	await frame()
	assert.equal((await state()).saved, moved.saved)

	await drag(3, 400)
	assert(Math.abs((await state()).roof - moved.roof - 400) <= 30)
	await page.keyboard.press('Escape')
	await page.mouse.up()
	await frame()
	assert.equal((await state()).saved, moved.saved)
	await drag(3, 400)
	await page.mouse.up()
	await frame()
	assert.equal((await state()).edit_no, 4)
	await page.keyboard.press('Control+z')
	await frame()
	assert.equal((await state()).saved, moved.saved)

	// Orbiting changes the projection; the controls must still receive input.
	let projected0 = await control(2)
	await page.mouse.move(1000, 700)
	await frame()
	await page.mouse.down()
	await frame()
	await page.mouse.move(1100, 740)
	await frame()
	await page.mouse.up()
	await frame()
	assert.notDeepEqual(await control(2), projected0)
	await drag(2, 400)
	await page.mouse.up()
	await frame()
	assert(Math.abs((await state()).heights[1] - 2900) <= 30)
	await page.mouse.click(1000, 700)
	await frame()
	await page.keyboard.press('Control+z')
	await frame()
	assert.equal((await state()).heights[1], 2500)

	// A cut view exposes only its visible floor boundaries.
	await page.evaluate(() => { cut = true; ui.animate() })
	await frame()
	let hidden = await control(2)
	await page.mouse.move(hidden.x, hidden.y)
	await frame()
	assert.equal(await page.evaluate(() => !!ui.hovers('model.heights')), false)
	await drag(1, 600)
	await page.mouse.up()
	await frame()
	assert(Math.abs((await state()).heights[0] - moved.heights[0] - 600) <= 30,
		JSON.stringify({state: await state(), moved, errors}))
	await page.evaluate(() => { cut = false; ui.animate() })
	await frame()

	// Changing permission cancels the preview before rebuilding the model.
	const before_readonly = await state()
	await drag(1, 600)
	assert.notEqual((await state()).saved, before_readonly.saved)
	await page.evaluate(() => { readonly = true; ui.animate() })
	await frame()
	await page.mouse.up()
	await frame()
	assert.equal((await state()).saved, before_readonly.saved)
	assert(await page.evaluate(function() {
		let e = ui._state_map.get('model').e
		let top = house.h + house.floors[1].roof_height()
		return Math.abs(e.root.comp.bbox().max[1] - top) < .01
	}))
	await page.evaluate(() => { ui.focus('model'); ui.animate() })
	await frame()
	await page.keyboard.press('Control+z')
	await frame()
	assert.equal((await state()).saved, before_readonly.saved)
	await page.keyboard.press('Control+Shift+z')
	await frame()
	assert.equal((await state()).saved, before_readonly.saved)

	let readonly_point = await control(1)
	await page.mouse.move(readonly_point.x, readonly_point.y)
	await frame()
	assert.equal(await page.evaluate(() => !!ui.hovers('model.heights')), false)
	let readonly_projection = await control(2)
	await page.mouse.down()
	await frame()
	await page.mouse.move(readonly_point.x + 80, readonly_point.y + 30)
	await frame()
	await page.mouse.up()
	await frame()
	assert.equal((await state()).saved, before_readonly.saved)
	assert.notDeepEqual(await control(2), readonly_projection)
	await page.evaluate(() => { readonly = false; ui.animate() })
	await frame()

	const before_free = await state()
	await drag(1, 500)
	await page.evaluate(() => { show_editor = false; ui.animate() })
	await frame()
	await page.mouse.up()
	assert.equal((await state()).saved, before_free.saved)
	await page.evaluate(() => { house.undo() })
	assert.deepEqual(errors, [])
	console.log('house height controls: drag, cancel, undo, orbit, cut,',
		'readonly and free passed')
} finally {
	await browser?.close()
	await new Promise(r => server.close(r))
}
