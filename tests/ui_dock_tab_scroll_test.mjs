import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const server = http.createServer(async (req, res) => {
	if (req.url == '/') {
		res.setHeader('Content-Type', 'text/html')
		res.end('<!doctype html>' + ['glue.js', 'ui.js', 'ui_icon_defs.js']
			.map(name => `<script src="${name}" `
			+ `${name == 'glue.js' ? 'global' : ''}></script>`).join('')
			+ '<script>ui.main = function() {}</script>')
	} else {
		try {
			res.setHeader('Content-Type', 'application/javascript')
			res.end(await fs.readFile(
				new URL('../www' + req.url, import.meta.url)))
		} catch (err) {
			res.writeHead(404).end()
		}
	}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
	browser = await chromium.launch({channel: 'chrome', headless: true})
	const page = await browser.newPage()
	const errors = []
	page.on('pageerror', err => errors.push(err.message))
	async function frame() {
		const n = await page.evaluate(() => {
			const n = ui._build_no()
			ui.animate()
			return n
		})
		await page.waitForFunction(n => ui._build_no() > n, n)
		assert.deepEqual(errors, [])
	}
	await page.goto(`http://127.0.0.1:${server.address().port}/`)
	await page.waitForFunction(() => ui._frame_drawn)
	await page.evaluate(() => {
		const tabs = []
		for (let i = 0; i < 30; i++)
			tabs.push({id: 't'+i, title: 'Tab number '+i})
		ui.main = function() {
			ui.dock('d', {tabs: tabs}, function() {})
		}
	})
	await frame()
	await frame()
	const first = await page.evaluate(() => ui.state_of([...ui._state_map.keys()].find(k => /^d\.tablist\d+$/.test(k)), 'scroll_x'))
	console.log('initial scroll', first)
	await page.evaluate(() => ui.focus('d.tabbox.t29'))
	await frame()
	await frame()
	const strip = await page.evaluate(() => ({
		sx: ui.state_of([...ui._state_map.keys()].find(k => /^d\.tablist\d+$/.test(k)), 'scroll_x'),
		box: ui.state_of('d.tabbox.t29', 'x'),
		sw: ui.state_of('d.tablist1.strip', 'w'),
	}))
	console.log(strip)
	assert(strip.sx > 0, 'strip did not scroll')

	// key focus: focus the first tab, then Tab to the next ones.
	const scroll_x = () => page.evaluate(() => ui.state_of(
		[...ui._state_map.keys()].find(k => /^d\.tablist\d+$/.test(k)),
		'scroll_x'))
	await page.evaluate(() => ui.focus('d.tabbox.t0'))
	await frame()
	await frame()
	console.log('after focus t0', await scroll_x())
	for (let i = 0; i < 25; i++) {
		await page.keyboard.press('Tab')
		await frame()
	}
	console.log('after 25 tabs', await scroll_x(),
		await page.evaluate(() => ui.focused_id))

	// click on a partly hidden tab.
	const info = await page.evaluate(() => {
		const sb = [...ui._state_map.keys()].find(k => /^d\.tablist\d+$/.test(k))
		const st = ui.state_of(sb)
		const strip = ui.state_of(sb + '.strip')
		const out = {sx: st.scroll_x, strip: [strip.x, strip.w]}
		for (let i = 0; i < 30; i++) {
			const b = ui._state_map.get('d.tabbox.t' + i)
			if (b && b.x < strip.x + strip.w && b.x + b.w > strip.x + strip.w) {
				out.partial = i
				out.box = [b.x, b.w]
				ui._point_at('d.tabbox.t' + i)
				out.pt = [ui.local_pointer.mx, ui.local_pointer.my]
			}
		}
		return out
	})
	console.log(info)
	await page.mouse.move(info.box[0] + 10, info.pt[1])
	await page.mouse.down()
	await frame()
	await page.mouse.up()
	await frame()
	await frame()
	console.log("after click", await scroll_x(), await page.evaluate(() => ui.focused_id))
} finally {
	await browser?.close()
	server.close()
}
