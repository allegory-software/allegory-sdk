import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const server = http.createServer(async (req, res) => {
	try {
		if (req.url == '/probe.html') {
			res.setHeader('Content-Type', 'text/html')
			const scripts = ['glue.js', 'ui.js', 'ui_icon_defs.js',
				'ui_field.js', 'ui_nav.js', 'ui_grid.js']
			res.end('<!doctype html>' + scripts.map(name =>
				`<script src="/${name}" `
				+ `${name == 'glue.js' ? 'global' : ''}></script>`
			).join('') + '<script>ui.main = function() {}</script>')
		} else if (req.url == '/favicon.ico') {
			res.writeHead(204).end()
		} else {
			res.setHeader('Content-Type', 'application/javascript')
			res.end(await fs.readFile(new URL('../www'+req.url, import.meta.url)))
		}
	} catch (error) {
		res.writeHead(404).end(String(error))
	}
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({channel: 'chrome', headless: true})
try {
	const page = await browser.newPage()
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	await page.goto(`http://127.0.0.1:${server.address().port}/probe.html`)
	await page.waitForFunction(() => ui._frame_drawn)
	await page.evaluate(() => {
		window.build_n = 0
		window.saves = 0
		window.reloads = 0
		window.nav = ui.nav('model')
		nav.load({
			fields: [{name: 'id', type: 'number', not_null: true},
				{name: 'text', type: 'text'}],
			pk: 'id', rows: [[1, 'one'], [2, 'two']],
		})
		nav.focus_cell(0, 1)
		nav.save = () => saves++
		nav.reload = () => reloads++
		const frame0 = ui.frame
		ui.frame = function(measure, build, ...args) {
			return frame0(measure, function(a, i, x, y, w, h, ...rest) {
				if (build.name == 'on_cellview_frame')
					window.cells_rect = [x, y, w, h]
				return build(a, i, x, y, w, h, ...rest)
			}, ...args)
		}
		ui.main = function() {
			ui.begin_toolboxes('probe.tools')
			ui.grid('grid', {nav: nav})
			ui.end_toolboxes()
			build_n++
		}
		ui.animate()
	})
	await page.waitForFunction(() => build_n > 0 && window.cells_rect)

	async function step(fn) {
		const n = await page.evaluate(() => build_n)
		await fn()
		await page.waitForFunction(n => build_n > n, n)
	}

	async function key(k, modifier) {
		if (modifier)
			await step(() => page.keyboard.down(modifier))
		await step(() => page.keyboard.down(k))
		await step(() => page.keyboard.up(k))
		if (modifier)
			await step(() => page.keyboard.up(modifier))
	}

	await page.locator('canvas').focus()
	await step(() => page.evaluate(() => { ui.focus('grid'); ui.animate() }))
	await key('s', 'Control')
	assert.equal(await page.evaluate(() => saves), 1)
	console.log('ok an unblocked grid responds to Ctrl+S')

	await key('F2')
	await page.waitForFunction(() => nav.editing
		&& document.activeElement?._ui_id)
	await step(() => page.evaluate(() => {
		const input = document.activeElement
		input.value = 'pending typing'
		input.dispatchEvent(new Event('input', {bubbles: true}))
		nav.needs_reload = true
		ui.animate()
	}))
	await page.waitForFunction(() => !nav.editing
		&& !document.querySelector('input.ui-input,textarea.ui-input'))
	assert.equal(await page.evaluate(() => nav.cell_input_val(0, 1)),
		'pending typing')
	console.log('ok blocking keeps pending cell typing and closes the editor')

	const before = await page.evaluate(() => [nav.row_n, nav.focused_ri, saves])
	await page.locator('canvas').focus()
	await step(() => page.evaluate(() => { ui.focus('grid'); ui.animate() }))
	await key('s', 'Control')
	await key('Insert')
	await key('ArrowDown')
	await key('F2')
	assert.deepEqual(await page.evaluate(() =>
		[nav.row_n, nav.focused_ri, saves]), before)
	assert.equal(await page.evaluate(() => nav.editing), false)
	console.log('ok blocking stops save, insert, row navigation and editing')

	await step(() => page.evaluate(() => {
		nav.needs_reload = false
		ui.animate()
	}))
	await key('F2', 'Shift')
	await page.waitForFunction(() => !!ui.state_of('grid.row_form'))
	await step(() => page.evaluate(() => {
		nav.load_error = 'fetch failed'
		ui.animate()
	}))
	await page.waitForFunction(() => !ui.state_of('grid.row_form'))
	console.log('ok a load error closes the row form')

	await page.locator('canvas').focus()
	await step(() => page.evaluate(() => {
		nav.load_error = null
		ui.focus('grid')
		ui.animate()
	}))
	const rect = await page.evaluate(() =>
		cells_rect.map(v => v / devicePixelRatio))
	await page.mouse.move(rect[0] + 40, rect[1] + 10)
	await step(() => page.mouse.down({button: 'right'}))
	await step(() => page.mouse.up({button: 'right'}))
	await page.waitForFunction(() => ui.state_of('grid.menu', 'open'))
	await step(() => page.evaluate(() => {
		nav.needs_reload = true
		ui.animate()
	}))
	assert.equal(await page.evaluate(() => ui.state_of('grid.menu', 'open')),
		false)
	console.log('ok blocking closes the context menu')

	await page.mouse.move(rect[0] + 40, rect[1] + 10)
	await step(() => page.mouse.down())
	await step(() => page.mouse.up())
	assert.equal(await page.evaluate(() => reloads), 1)
	console.log('ok the smoke screen still reloads on click')
	assert.deepEqual(errors, [])
} finally {
	await browser.close()
	server.closeAllConnections()
	server.close()
}
