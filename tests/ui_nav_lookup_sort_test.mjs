import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const pending = new Map()
const requests = new Map()
const streams = new Set()
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
		} else if (req.url.startsWith('/rowset.events')) {
			res.writeHead(200, {'Content-Type': 'text/event-stream'})
			res.write('\n')
			streams.add(res)
			res.on('close', () => streams.delete(res))
		} else if (req.url.startsWith('/rowset.json/')) {
			const name = req.url.slice('/rowset.json/'.length)
			let body = ''
			for await (const chunk of req) body += chunk
			assert.equal(JSON.parse(body).exec, 'load')
			requests.set(name, (requests.get(name) || 0) + 1)
			res.setHeader('Content-Type', 'application/json')
			pending.set(name, res)
		} else {
			res.setHeader('Content-Type', 'application/javascript')
			res.end(await fs.readFile(new URL('../www'+req.url, import.meta.url)))
		}
	} catch (error) {
		res.writeHead(500).end(String(error))
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
		window.probe = {}
		probe.id_field = {name: 'id', type: 'number', not_null: true}
		probe.ids = nav => Array.from(
			nav.visible_ris.slice(0, nav.visible_n), ri => nav.cell_val(ri, 'id'))
		probe.make_nav = function(id, lookup, opt, rows) {
			const nav = ui.nav(id, opt)
			nav.load({
				fields: [probe.id_field,
					{name: 'fk', type: 'number', lookup_rowset_name: lookup}],
				pk: 'id', rows: rows || [[1, 1], [2, 2]],
			})
			return nav
		}
	})
	const local = await page.evaluate(() => {
		ui.rowsets.cached = {
			fields: [probe.id_field, {name: 'name', sort_collation: 'ai_ci'}],
			pk: 'id', rows: [[1, 'Zebra'], [2, 'apple'], [3, 'APPLE']],
		}
		const nav = probe.make_nav('cached', 'cached', {order_by: 'fk'},
			[[1, 1], [2, 2], [3, null], [4, 3]])
		const asc = probe.ids(nav)
		nav.set_order_by('fk:desc')
		const desc = probe.ids(nav)
		ui.rowsets.numbers = {
			fields: [probe.id_field, {name: 'name', type: 'number'}],
			pk: 'id', rows: [[1, 20], [2, 3]],
		}
		const numbers = probe.make_nav('numbers', 'numbers', {order_by: 'fk'})
		ui.rowsets.composite = {
			fields: [{name: 'a', type: 'number', not_null: true},
				{name: 'b', type: 'number', not_null: true}, {name: 'name'}],
			pk: 'a b', rows: [[1, 1, 'Zebra'], [1, 2, 'Apple']],
		}
		const composite = ui.nav('composite', {order_by: 'b'})
		composite.load({
			fields: [probe.id_field, {name: 'a', type: 'number'},
				{name: 'b', type: 'number', lookup_rowset_name: 'composite',
					lookup_cols: 'a b'}],
			pk: 'id', rows: [[1, 1, 1], [2, 1, 2]],
		})
		ui.rowsets.named = {
			fields: [probe.id_field, {name: 'name'}, {name: 'label'}],
			pk: 'id', rows: [[1, 'A', 'Z'], [2, 'Z', 'A']],
		}
		const named = ui.nav('named', {order_by: 'fk'})
		named.load({fields: [probe.id_field,
			{name: 'fk', type: 'number', lookup_rowset_name: 'named',
				display_col: 'label'}], pk: 'id', rows: [[1, 1], [2, 2]]})
		return {asc, desc, numbers: probe.ids(numbers),
			composite: probe.ids(composite), named: probe.ids(named),
			ready: nav.ready}
	})
	assert.deepEqual(local, {asc: [3, 2, 4, 1], desc: [1, 2, 4, 3],
		numbers: [2, 1], composite: [2, 1], named: [2, 1],
		ready: true})

	await page.evaluate(() => {
		probe.waiting_rs = {
			fields: [probe.id_field,
				{name: 'fk', type: 'number', lookup_rowset_name: 'slow'},
				{name: 'other', type: 'number', lookup_rowset_name: 'other'}],
			pk: 'id', rows: [[1, 1, 1], [2, 2, 1]],
		}
		probe.first = ui.nav('first', {rowset_name: 'detail', order_by: 'fk'})
		probe.second = ui.nav('second', {order_by: 'fk:desc'})
		probe.second.load(probe.waiting_rs)
		probe.freed = ui.nav('freed', {order_by: 'fk'})
		probe.freed.load(probe.waiting_rs)
		probe.freed.free()
		probe.texts = []
		const text = ui.text
		ui.text = function(id, value, ...args) {
			probe.texts.push(value)
			return text.call(this, id, value, ...args)
		}
		probe.build_n = 0
		ui.main = function() {
			probe.texts.length = 0
			ui.grid('grid', {nav: probe.first}, 1, 's', 's')
			probe.build_n++
		}
		ui.animate()
	})
	await page.waitForFunction(() => probe.build_n > 0)
	pending.get('detail').end(JSON.stringify(
		await page.evaluate(() => probe.waiting_rs)))
	await page.waitForFunction(() => probe.first.all_fields_map.fk)
	assert.deepEqual(await page.evaluate(() => ({
		ready: probe.first.ready,
		visible: probe.first.visible_n, second: probe.second.ready,
		loading: probe.texts.includes('loading...'),
		focusable: ui.focusables.includes('grid'),
	})), {ready: false, visible: 2, second: false,
		loading: true, focusable: false})
	assert.equal(requests.get('slow'), 1)
	pending.get('slow').end(JSON.stringify({
		fields: [{name: 'id', type: 'number', not_null: true}, {name: 'name'}],
		pk: 'id', rows: [[1, 'Zebra'], [2, 'Apple']],
	}))
	await page.waitForFunction(() => ui.shared_navs.slow.ready)
	assert.deepEqual(await page.evaluate(() => [probe.first.ready,
		probe.first.visible_n, probe.second.ready]), [false, 2, false])
	assert.equal(requests.get('other'), 1)
	pending.get('other').end(JSON.stringify({
		fields: [{name: 'id', type: 'number', not_null: true}, {name: 'name'}],
		pk: 'id', rows: [[1, 'Other']],
	}))
	await page.waitForFunction(() => {
		probe.second.check_dependencies()
		return probe.first.ready && probe.second.ready
			&& ui.focusables.includes('grid')
	})
	assert.deepEqual(await page.evaluate(() => ({
		first: probe.ids(probe.first), second: probe.ids(probe.second),
		freed: probe.freed.ready, loading: probe.texts.includes('loading...'),
	})), {first: [2, 1], second: [1, 2], freed: false, loading: false})
	assert.deepEqual(await page.evaluate(() => {
		probe.third = ui.nav('third', {order_by: 'fk'})
		probe.third.load(probe.waiting_rs)
		return [probe.third.ready, probe.ids(probe.third)]
	}), [true, [2, 1]])
	assert.equal(requests.get('slow'), 1)
	assert.equal(requests.get('other'), 1)

	assert.deepEqual(errors, [])
	console.log('Lookup sorting: types, collation, composite keys, shared loads, '
		+ 'direct readiness, loading grid, free and cache reuse passed.')
} finally {
	await browser.close()
	for (let res of streams)
		res.end()
	for (let res of pending.values())
		res.end()
	await new Promise(resolve => server.close(resolve))
}
