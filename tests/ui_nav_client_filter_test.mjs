import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const requests = []
const notifications = new Set()
let rows = [
	[1, 1, 10, 'one'],
	[2, 1, 20, 'two'],
	[3, 2, 10, 'three'],
]
const rowset = {
	fields: [
		{name: 'id', type: 'number', not_null: true},
		{name: 'parent_a', type: 'number'},
		{name: 'parent_b', type: 'number'},
		{name: 'text'},
	],
	pk: 'id',
	params: {
		parent: {
			for_cols: 'parent_a parent_b', lookup_cols: 'a b',
			lookup_rowset_name: 'master', client_filter: true,
		},
		scope: {},
	},
}
const server = http.createServer(async (req, res) => {
	try {
		if (req.url == '/probe.html') {
			res.setHeader('Content-Type', 'text/html')
			res.end('<!doctype html><script src="glue.js" global></script>'
				+ '<script src="ui.js"></script>'
				+ '<script src="ui_field.js"></script>'
				+ '<script src="ui_nav.js"></script>'
				+ '<script>ui.main = function() {}</script>')
		} else if (req.url == '/favicon.ico') {
			res.writeHead(204).end()
		} else if (req.url.startsWith('/rowset.events')) {
			res.writeHead(200, {'Content-Type': 'text/event-stream'})
			res.write('\n')
			notifications.add(res)
			res.on('close', () => notifications.delete(res))
		} else if (req.url == '/rowset.json/detail') {
			let body = ''
			for await (const chunk of req) body += chunk
			const post = JSON.parse(body)
			requests.push(post)
			res.setHeader('Content-Type', 'application/json')
			if (post.exec == 'load') {
				res.end(JSON.stringify({...rowset,
					rows: post.params.scope?.[0] == 'x' ? rows : [],
				}))
			} else if (post.exec == 'save') {
				const saved_rows = post.changes.rows.map(change => {
					const vals = change.values
					const id = vals['id:old'] ?? vals.id
					const i = rows.findIndex(row => row[0] == id)
					if (change.type == 'remove') {
						rows.splice(i, 1)
						return {type: change.type, remove: true}
					}
					const row = i < 0 ? new Array(4).fill(null) : rows[i]
					for (const [fi, field] of rowset.fields.entries())
						if (vals[field.name] !== undefined)
							row[fi] = vals[field.name]
					if (i < 0) rows.push(row)
					return {type: change.type, values: row}
				})
				res.end(JSON.stringify({rows: saved_rows}))
			} else {
				res.writeHead(400).end()
			}
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
		window.probe = {scope: 'x'}
		ui.rowsets.master = {
			fields: [
				{name: 'a', type: 'number', not_null: true},
				{name: 'b', type: 'number', not_null: true},
			],
			pk: 'a b', rows: [[1, 10], [1, 20], [2, 10]],
		}
		probe.ids = function() {
			let nav = probe.detail
			return Array.from(nav.visible_ris.slice(0, nav.visible_n),
				ri => nav.cell_val(ri, 'id'))
		}
		ui.main = function() {
			ui.state('scope').input_value = probe.scope
			if (!probe.master) {
				probe.master = ui.nav('master', {
					rowset_name: 'master', cell_select_mode: false,
				})
				probe.master.focus_cell(0)
			}
			ui.state('master').nav = probe.master
			probe.detail ??= ui.nav('detail', {
				rowset_name: 'detail', param_bindings: {scope: 'scope'},
			})
			ui.state('detail').nav = probe.detail
			probe.detail.reload_if_params_changed()
		}
		ui.animate()
	})
	await page.waitForFunction(() => probe.detail?.ready
		&& JSON.stringify(probe.ids()) == '[1]')
	assert.equal(requests.length, 1)
	assert.deepEqual(requests[0].params, {scope: ['x']})
	const change = async (fn, ids) => {
		await page.evaluate(fn)
		await page.waitForFunction(expected =>
			JSON.stringify(probe.ids()) == JSON.stringify(expected), ids)
	}
	await change(() => {
		probe.master.focus_cell(1)
		ui.animate()
	}, [2])
	await change(() => {
		probe.master.focus_cell(2, null, 'invert')
		ui.animate()
	}, [2, 3])
	await change(() => {
		probe.master.focus_cell(null)
		ui.animate()
	}, [])
	assert.equal(requests.length, 1)
	await change(() => {
		probe.master.focus_cell(0)
		ui.animate()
	}, [1])
	await change(() => {
		const nav = probe.detail
		probe.edited_ri = nav.lookup('id', [1])
		nav.set_cell_val(probe.edited_ri, nav.all_fields_map.text.fi, 'edited')
		probe.master.focus_cell(1)
		ui.animate()
	}, [1, 2])
	await page.evaluate(() => {
		probe.detail.save()
		ui.animate()
	})
	await page.waitForFunction(() => probe.detail.modified_n == 0)
	assert.deepEqual(await page.evaluate(() => probe.ids()), [1, 2])
	assert.equal(requests.at(-1).exec, 'save')
	assert.deepEqual(requests.at(-1).params, {scope: ['x']})
	assert.equal(rows[0][3], 'edited')
	await change(() => {
		probe.master.focus_cell(2)
		ui.animate()
	}, [3])
	await change(() => {
		probe.master.focus_cell(1)
		ui.animate()
	}, [2])
	await change(() => {
		probe.detail.merge_rows({rows: [[3, 1, 20, 'moved']]})
		ui.animate()
	}, [2, 3])
	await change(() => {
		probe.detail.merge_rows({removed_pks: [[3]]})
		ui.animate()
	}, [2])
	await page.evaluate(() => {
		probe.scope = 'y'
		ui.animate()
	})
	await page.waitForFunction(() => probe.detail.row_n == 0)
	assert.equal(requests.at(-1).exec, 'load')
	assert.deepEqual(requests.at(-1).params, {scope: ['y']})
	await change(() => {
		probe.scope = 'x'
		ui.animate()
	}, [2])
	assert.deepEqual(await page.evaluate(() => {
		const nav = probe.detail
		const ris = nav.insert_rows([[4]])
		return [nav.cell_input_val(ris[0], nav.all_fields_map.parent_a.fi),
			nav.cell_input_val(ris[0], nav.all_fields_map.parent_b.fi)]
	}), [1, 20])
	await page.evaluate(() => probe.detail.revert_changes())
	rows.push([5, 1, 20, 'notified'])
	for (const res of notifications) res.write('data: detail external\n\n')
	await page.waitForFunction(() => probe.detail.lookup('id', [5]) != null)
	assert.deepEqual(requests.at(-1).params, {scope: ['x']})
	await page.evaluate(rs => {
		rs.params.parent.lookup_rowset_name = 'absent'
		probe.detail.reload_rowset(rs)
		ui.animate()
	}, {...rowset, rows})
	await page.waitForFunction(() => probe.ids().length == 4)
	await page.evaluate(rs => {
		probe.detail.reload_rowset(rs)
		ui.animate()
	}, {...rowset, rows})
	await page.waitForFunction(() => JSON.stringify(probe.ids()) == '[2,5]')
	rows = rows.filter(row => row[0] != 1)
	await page.evaluate(() => {
		probe.detail.set_cell_val(probe.detail.lookup('id', [1]),
			probe.detail.all_fields_map.text.fi, 'pending')
		probe.detail.reload()
	})
	await page.waitForFunction(() => probe.detail.lookup('id', [1]) == null)
	assert.deepEqual(await page.evaluate(() => {
		const nav = ui.nav('invalid')
		const fields = [{name: 'id', type: 'number', not_null: true}]
		nav.load({fields, pk: 'id', rows: [[1]]})
		const fields0 = nav.all_fields
		nav.load({fields, pk: 'id', rows: [], params: {
			p: {client_filter: true},
		}})
		const rejected_plain = nav.all_fields == fields0
		nav.partial_load = true
		nav.load({fields, pk: 'id', rows: [], params: {
			p: {client_filter: true, for_cols: 'id'},
		}})
		return {rejected_plain, rejected_partial: nav.all_fields == fields0}
	}), {rejected_plain: true, rejected_partial: true})
	assert.deepEqual(errors, [])
	console.log('Client col params: composite masters, multiple and empty '
		+ 'selections, mixed server params, saving, merges and validation passed.')
} finally {
	await browser.close()
	await new Promise(resolve => server.close(resolve))
}
