import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const server = http.createServer(async (req, res) => {
	try {
		if (req.url == '/probe.html') {
			res.setHeader('Content-Type', 'text/html')
			res.end('<!doctype html><script src="glue.js"></script>'
				+ '<script src="ui.js"></script>'
				+ '<script src="ui_icon_defs.js"></script>'
				+ '<script src="ui_field.js"></script>'
				+ '<script>ui.main = function() {}</script>')
		} else {
			res.setHeader('Content-Type', 'application/javascript')
			res.end(await fs.readFile(new URL('../www'+req.url, import.meta.url)))
		}
	} catch {
		res.writeHead(404).end()
	}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({channel: 'chrome', headless: true})
try {
	const page = await browser.newPage({viewport: {width: 800, height: 600}})
	const errors = [] // browser error messages
	page.on('pageerror', error => errors.push(error.message))
	await page.goto(`http://127.0.0.1:${server.address().port}/probe.html`)
	await page.waitForFunction(() => ui._frame_drawn)
	await page.evaluate(() => {
		window.probe = {n: 40, gap: 0, row_h: null,
			readonly: false, is_multi: false, focus: true, value: 'Row 0'}
		const stack0 = ui.stack
		ui.stack = function(id, ...args) {
			let i = stack0(id, ...args) // command index
			if (id?.startsWith('list.') || id?.startsWith('menu.item.'))
				ui.measure(id+'.probe_box')
			return i
		}
		const popup0 = ui.popup
		ui.popup = function(id, ...args) {
			let i = popup0(id, ...args) // command index
			if (id?.startsWith('menu.popup.'))
				ui.measure(id+'.probe_box')
			return i
		}
		probe.items = Array.from({length: 40}, (_, i) => 'Row '+i)
		probe.multi_field = ui.create_field({type: 'enum_list',
			enum_values: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']})
		probe.build_list = function() {
			ui.min_wh(200, 150)
			ui.sb('list.sb', 0,
				probe.is_horizontal ? 'auto' : 'contain', 'auto', 'l', 't')
				let list = probe.is_horizontal ? ui.hlist : ui.list
				probe.value = list('list', probe.items.slice(0, probe.n),
					probe.value, probe.is_multi ? probe.multi_field : null,
					0, 's', 't', probe.readonly,
					{item_gap: probe.gap, item_h: probe.row_h})
			ui.end_sb()
			if (probe.focus) {
				probe.focus = false
				ui.focus('list')
			}
		}
		ui.main = probe.build_list
		ui.animate()
	})
	await page.waitForTimeout(100)
	async function frame() {
		await page.evaluate(() => ui.animate())
		await page.waitForTimeout(50)
	}
	async function key(key) {
		await page.keyboard.down(key)
		await page.waitForTimeout(50)
		await page.keyboard.up(key)
		await page.waitForTimeout(50)
	}
	async function read_list() {
		return page.evaluate(() => {
			let s = ui._state_map.get('list')
			let row0 = ui._state_map.get('list.0.probe_box')
			let row1 = ui._state_map.get('list.1.probe_box')
			return {value: s.input_value, focused: s.focused_item,
				viewport_h: ui._state_map.get('list.viewport')?.h,
				stride: row1 && row1.y - row0.y,
				scroll_y: ui._state_map.get('list.sb').scroll_y}
		})
	}
	let result = await read_list()
	let page_rows = Math.floor(result.viewport_h / result.stride)
	await key('End')
	assert.equal((await read_list()).value, 'Row 39')
	assert.ok((await read_list()).scroll_y > 0)
	await key('Home')
	assert.equal((await read_list()).value, 'Row 0')
	assert.equal((await read_list()).scroll_y, 0)
	await key('PageDown')
	assert.equal((await read_list()).value, 'Row '+page_rows)
	await frame()
	assert.equal((await read_list()).value, 'Row '+page_rows)
	await key('PageUp')
	assert.equal((await read_list()).value, 'Row 0')
	await page.evaluate(() => { probe.value = 'Row 39'; ui.animate() })
	await page.waitForTimeout(50)
	await key('PageDown')
	assert.equal((await read_list()).value, 'Row 39')
	await page.evaluate(() => {
		probe.value = 'Row 0'; probe.gap = 50; probe.row_h = 40; ui.animate()
	})
	await page.waitForTimeout(50)
	result = await read_list()
	page_rows = Math.max(1, Math.floor(result.viewport_h / result.stride))
	await key('PageDown')
	assert.equal((await read_list()).value, 'Row '+page_rows)
	await key('PageDown')
	assert.equal((await read_list()).value, 'Row '+(2 * page_rows))
	assert.ok((await read_list()).scroll_y > 0)
	await page.evaluate(() => { probe.readonly = true; ui.animate() })
	await page.waitForTimeout(50)
	result = await read_list()
	await key('PageDown')
	assert.equal((await read_list()).value, result.value)
	await key('Home')
	await key('End')
	assert.equal((await read_list()).value, result.value)
	await page.evaluate(() => {
		probe.readonly = false; probe.gap = 0; probe.row_h = null
		probe.n = 0; probe.value = null; ui.animate()
	})
	await page.waitForTimeout(50)
	await key('PageDown')
	assert.equal((await read_list()).value, null)
	await key('Home')
	await key('End')
	assert.equal((await read_list()).value, null)
	await page.evaluate(() => { probe.n = 40; ui.animate() })
	await page.waitForTimeout(50)
	await key('End')
	assert.equal((await read_list()).value, 'Row 39')
	await key('Home')
	assert.equal((await read_list()).value, 'Row 0')
	await page.evaluate(() => {
		probe.is_horizontal = true; probe.value = null; ui.animate()
	})
	await page.waitForTimeout(50)
	await key('Home')
	assert.equal((await read_list()).value, 'Row 0')
	await key('End')
	assert.equal((await read_list()).value, 'Row 39')
	await page.evaluate(() => {
		probe.is_horizontal = false
		probe.is_multi = true; probe.items = probe.multi_field.enum_items()
		probe.n = 10; probe.value = 0; ui.animate()
	})
	await page.waitForTimeout(50)
	result = await read_list()
	page_rows = Math.floor(result.viewport_h / result.stride)
	await key('PageDown')
	result = await read_list()
	assert.equal(result.value, 0)
	assert.equal(result.focused, 1 << page_rows)
	await key(' ')
	assert.equal((await read_list()).value, 1 << page_rows)
	await key('End')
	result = await read_list()
	assert.equal(result.value, 1 << page_rows)
	assert.equal(result.focused, 1 << 9)
	await key('Home')
	result = await read_list()
	assert.equal(result.value, 1 << page_rows)
	assert.equal(result.focused, 1)
	console.log('List navigation: Home/End, paging, scroll reveal, readonly, '
		+ 'empty list, horizontal list, and multi-select passed.')
	await page.mouse.move(790, 590)
	await page.evaluate(() => {
		probe.want_open = true
		probe.menu_items = [
			{id: 'first', label: 'First'},
			{id: 'sub', label: 'Submenu', items: [
				{id: 'child', label: 'Child'},
			]},
			null,
			{id: 'disabled', label: 'Disabled', disabled: true},
			{id: 'last', label: 'Last'},
		]
		ui.main = function() {
			ui.m(20, 20, 0, 0)
			ui.min_wh(150, 20)
			ui.stack('', 0, 'l', 't')
				probe.picked = ui.menu('menu', probe.menu_items,
					probe.want_open, 'b', '[')
				probe.want_open = false
			ui.end_stack()
		}
		ui.animate()
	})
	await page.waitForTimeout(100)
	const menu_highlight = () => page.evaluate(
		() => ui._state_map.get('menu').hl_is)
	await key('ArrowDown')
	assert.deepEqual(await menu_highlight(), [0])
	await frame()
	assert.deepEqual(await menu_highlight(), [0])
	await key('ArrowDown')
	await key('ArrowRight')
	assert.deepEqual(await menu_highlight(), [1, 0])
	await frame()
	assert.deepEqual(await menu_highlight(), [1, 0])
	await key('Enter')
	assert.equal(await page.evaluate(
		() => ui._state_map.get('menu').open), false)
	await page.evaluate(() => { probe.want_open = true; ui.animate() })
	await page.waitForTimeout(100)
	async function hover_item(id) {
		const point = await page.evaluate(id => {
			let s = ui._state_map.get('menu.item.'+id+'.probe_box')
			return {x: s.x + s.w / 2, y: s.y + s.h / 2}
		}, id)
		await page.mouse.move(point.x, point.y)
		await page.waitForTimeout(100)
	}
	await hover_item('sub')
	assert.deepEqual(await menu_highlight(), [1, null])
	await hover_item('child')
	assert.deepEqual(await menu_highlight(), [1, 0])
	assert.equal(await page.evaluate(() => !!ui.hovers('menu.popup.0')), true)
	await page.mouse.move(790, 590)
	await page.waitForTimeout(100)
	assert.deepEqual(await menu_highlight(), [])
	await key('ArrowDown')
	await frame()
	assert.deepEqual(await menu_highlight(), [0])
	await key('ArrowDown')
	await key('ArrowDown')
	assert.deepEqual(await menu_highlight(), [4])
	assert.deepEqual(errors, [])
	console.log('Menu: keyboard persistence, nested navigation, pick, submenu '
		+ 'hover propagation, pointer departure, and disabled-item skip passed.')
} finally {
	await browser.close()
	await new Promise(resolve => server.close(resolve))
}
