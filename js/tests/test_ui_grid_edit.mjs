// Drives the grid demo in www/ui-demo.html in headless Chrome and reads grid
// and editor state to check cell editing. Run: node js/tests/test_ui_grid_edit.mjs

import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import {spawn} from 'child_process'
import path from 'path'
import {fileURLToPath} from 'url'

const www = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'www')
const port = Number(process.env.PORT ?? 8393)

let failed = 0
function check(what, got, want) {
	let ok = JSON.stringify(got) === JSON.stringify(want)
	if (!ok)
		failed++
	console.log((ok ? 'ok   ' : 'FAIL ') + what
		+ (ok ? '' : ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)))
}

const srv = spawn('python3',
	['-m', 'http.server', String(port), '-d', www, '-b', '127.0.0.1'],
	{stdio: 'ignore'})
await new Promise(r => setTimeout(r, 800))

const browser = await chromium.launch({channel: 'chrome', headless: true})
try {
	const pg = await browser.newPage()
	await pg.addInitScript(() => localStorage.clear())
	const errors = []
	pg.on('pageerror', e => errors.push(e.message))
	pg.on('console', m => {
		if (m.type() == 'error' && !m.text().startsWith('Failed to load resource'))
			errors.push(m.text())
	})

	async function frame() {
		await pg.evaluate(() => ui.animate())
		await pg.waitForTimeout(80)
	}

	await pg.goto(`http://127.0.0.1:${port}/ui-demo.html`, {waitUntil: 'load'})
	await pg.waitForTimeout(500)
	await frame()
	await frame()
	check('1. startup has no errors', errors, [])

	// the grid's nav and the controls of its editable visible fields.
	let info = await pg.evaluate(() => {
		let e = ui._state_map.get('grid_config_grid')?.nav
		window.probe_nav = e
		return e && e.visible_fields.map(f => f.control)
	})
	console.log('     visible field controls:', JSON.stringify(info))

	// edit the first cell built with each control.
	let seen = new Set()
	for (let vfi = 0; vfi < (info?.length ?? 0); vfi++) {
		let control = info[vfi]
		if (seen.has(control))
			continue
		seen.add(control)
		errors.length = 0
		let r = await pg.evaluate(vfi => {
			let e = probe_nav
			let fi = e.visible_fields[vfi].fi
			ui.focus('grid_config_grid')
			e.focus_cell(0, fi, 0, 0, {input: e})
			return e.enter_edit()
		}, vfi)
		await frame()
		await frame()
		let st = await pg.evaluate(() => ({
			editing: probe_nav.editing,
			focused_id: ui.focused_id,
		}))
		check(`2. ${control}: entering edit has no errors`, errors, [])
		console.log(`     ${control}: entered=${r}`, JSON.stringify(st))
		await pg.evaluate(() => { probe_nav.exit_edit(); ui.animate() })
		await frame()
	}

	// type into a text cell that the user can change and commit with Enter.
	let text_vfi = await pg.evaluate(() => {
		let e = probe_nav
		return e.visible_fields.findIndex(f =>
			f.control == 'input' && e.can_change_val(0, f.fi))
	})
	if (text_vfi >= 0) {
		errors.length = 0
		await pg.evaluate(vfi => {
			let e = probe_nav
			ui.focus('grid_config_grid')
			e.focus_cell(0, e.visible_fields[vfi].fi, 0, 0, {input: e})
			e.enter_edit()
		}, text_vfi)
		await frame()
		await frame()
		await pg.keyboard.type('xyz')
		await frame()
		await pg.keyboard.press('Enter')
		await frame()
		await frame()
		let st = await pg.evaluate(vfi => {
			let e = probe_nav
			return {
				editing: e.editing,
				val: e.cell_input_val(0, e.visible_fields[vfi].fi),
			}
		}, text_vfi)
		check('3. typing in a text cell has no errors', errors, [])
		check('3. Enter ends the edit', st.editing, false)
		check('3. the cell holds the typed text', st.val, 'xyz')
	}

} finally {
	await browser.close()
	srv.kill()
}
process.exit(failed ? 1 : 0)
