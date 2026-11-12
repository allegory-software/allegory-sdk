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
	const page = await browser.newPage({viewport: {width: 800, height: 600}})
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	await page.goto(`http://127.0.0.1:${server.address().port}/probe.html`)
	await page.waitForFunction(() => ui._frame_drawn)
	await page.evaluate(() => {
		window.probe = {build_n: 0, clips: 0, saves: 0, restores: 0,
			clip_rects: []}
		const cx = ui.cx
		const rect = cx.rect
		cx.rect = function(x, y, w, h) {
			probe.rect = [x, y, w, h]
			return rect.call(this, x, y, w, h)
		}
		for (let name of ['clip', 'save', 'restore']) {
			const original = cx[name]
			cx[name] = function(...args) {
				probe[name == 'clip' ? 'clips' : name+'s']++
				if (name == 'clip')
					probe.clip_rects.push(probe.rect)
				return original.apply(this, args)
			}
		}
		window.input_field = ui.create_field({name: 'text', type: 'text'})
		ui.main = function() {
			probe.build_n++
			ui.measure_viewport('screen.viewport')
			ui.m(40, 30, 0, 0)
			ui.min_wh(100, 60)
			ui.stack('clip', 0, 'l', 't', false, true, true)
				ui.measure('clip.box')
				ui.measure_viewport('clip.viewport')
				ui.min_wh(300, 150)
				ui.stack('child', 0, 'l', 't')
					ui.bg('bg1')
					ui.m(60, 20, 0, 0)
					ui.min_wh(80, 60)
					ui.stack('nested', 0, 'l', 't', false, true, true)
						ui.measure_viewport('nested.viewport')
						ui.min_wh(200, 30)
						ui.text('input', 'overflow', 0, 'l', 't',
							null, null, input_field)
					ui.end_stack()
					ui.measure_viewport('after_nested.viewport')
				ui.end_stack()
			ui.end_stack()
			ui.measure_viewport('after_clip.viewport')
			ui.m(400, 30, 0, 0)
			ui.min_wh(100, 60)
			ui.stack('unclipped', 0, 'l', 't', false, true)
				ui.min_wh(200, 100)
				ui.stack('unclipped.child', 0, 'l', 't')
					ui.bg('bg1')
				ui.end_stack()
			ui.end_stack()
			ui.min_wh(100, 60)
			ui.stack('hidden', 0, 'l', 't', true, true, true)
				ui.text('', 'hidden')
			ui.end_stack()
			probe.child_hit = !!ui.hovers('child')
			probe.unclipped_hit = !!ui.hovers('unclipped.child')
		}
		ui.focus('input')
		ui.animate()
	})
	await page.waitForFunction(() => ui.state_of('input.viewport'))
	const rects = await page.evaluate(() => {
		let out = {}
		for (let id of ['screen.viewport', 'clip.box', 'clip.viewport',
			'nested.viewport', 'after_nested.viewport', 'after_clip.viewport',
			'input.viewport']) {
			let s = ui.state_of(id)
			out[id] = [s.x, s.y, s.w, s.h]
		}
		return out
	})
	assert.deepEqual(rects['clip.box'], [40, 30, 100, 60])
	assert.deepEqual(rects['clip.viewport'], [40, 30, 100, 60])
	assert.deepEqual(rects['nested.viewport'], [100, 50, 40, 40])
	assert.deepEqual(rects['input.viewport'], [100, 50, 40, 40])
	assert.deepEqual(rects['after_nested.viewport'], rects['clip.viewport'])
	assert.deepEqual(rects['after_clip.viewport'], rects['screen.viewport'])
	const input = await page.locator('input').evaluate(el => ({
		clip: el.style.clipPath, w: el.style.width,
	}))
	assert.equal(input.w, '80px')
	assert.match(input.clip, /40px/)
	async function move(x, y) {
		const n = await page.evaluate(() => probe.build_n)
		await page.mouse.move(x, y)
		await page.waitForFunction(n => probe.build_n > n, n)
	}
	await move(50, 40)
	assert.equal(await page.evaluate(() => probe.child_hit), true)
	await move(200, 40)
	assert.equal(await page.evaluate(() => probe.child_hit), false)
	await move(550, 40)
	assert.equal(await page.evaluate(() => probe.unclipped_hit), true)
	const drawing = await page.evaluate(() => probe)
	assert.ok(drawing.clip_rects.some(rect =>
		JSON.stringify(rect) == JSON.stringify([40, 30, 100, 60])))
	assert.ok(drawing.clip_rects.some(rect =>
		JSON.stringify(rect) == JSON.stringify([100, 50, 80, 60])))
	assert.equal(drawing.saves, drawing.restores)
	console.log('ok fixed stack bounds, nested viewports, DOM clipping, hits'
		+ ' and balanced canvas clipping')

	await page.evaluate(() => {
		window.nav = ui.nav('model')
		window.rowset = {fields: [
			{name: 'id', type: 'number', label: 'Identifier '.repeat(20)},
			{name: 'text', type: 'text', icon: 'file',
				label: 'Long header '.repeat(20)},
		], pk: 'id', rows: [[1, 'one']]}
		nav.load(rowset)
		nav.set_order_by('text')
		window.vertical_nav = ui.nav('vertical.model')
		vertical_nav.vertical_layout = true
		vertical_nav.load(rowset)
		vertical_nav.set_order_by('text')
		const stack = ui.stack
		ui.stack = function(id, fr, align, valign, hidden, fixed, clip) {
			const i = stack(id, fr, align, valign, hidden, fixed, clip)
			if (probe.grid && fixed && clip)
				ui.measure('header.'+probe.header_n++)
			return i
		}
		probe.grid = true
		probe.vertical = false
		ui.main = function() {
			probe.header_n = 0
			ui.begin_toolboxes('probe.tools')
			ui.grid(probe.vertical ? 'vertical' : 'horizontal',
				{nav: probe.vertical ? vertical_nav : nav})
			ui.end_toolboxes()
			probe.build_n++
		}
		ui.focus(null)
		ui.animate()
	})
	async function header_rects() {
		await page.waitForFunction(() => probe.header_n == 2)
		return page.evaluate(() => {
			let out = []
			for (let i = 0; i < probe.header_n; i++) {
				let s = ui.state_of('header.'+i)
				out.push([s.x, s.y, s.w, s.h])
			}
			return out
		})
	}
	let headers = await header_rects()
	const widths = await page.evaluate(() =>
		nav.visible_fields.map(field => field._w))
	assert.deepEqual(headers.map(rect => rect[2]), widths)
	assert.equal(headers[0][0] + headers[0][2], headers[1][0])
	const n = await page.evaluate(() => probe.build_n)
	await page.evaluate(() => { probe.vertical = true; ui.animate() })
	await page.waitForFunction(n => probe.build_n > n, n)
	headers = await header_rects()
	assert.equal(headers[0][2], headers[1][2])
	assert.equal(headers[0][1] + headers[0][3], headers[1][1])
	console.log('ok overflowing headers keep column bounds in both layouts')
	assert.deepEqual(errors, [])
} finally {
	await browser.close()
	server.closeAllConnections()
	await new Promise(resolve => server.close(resolve))
}
