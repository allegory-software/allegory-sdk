import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import http from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const root = new URL('../', import.meta.url)
const wire = execFileSync(fileURLToPath(new URL('bin/luajit', root)), [
	'-joff', '-lscite', '-e', String.raw`
require'rowset'
local req = {tcp = {onclose = function() end}, onfinish = function() end}
function http_request() return req end
function setheader() end
function setconnectionclose() end
function setcompress() end
function headers() return '41' end
function db() return {} end
function changed_rowsets_since(_, txn_id)
	assert(txn_id == 41)
	return {a = true, b = true}, 42
end
function currentthread() return {} end
function suspend() return 'closed' end
function out_buffering() return false end
function out(s) io.write(s) end
function out_flush() end
action['rowset.events']()
`,
], {cwd: root, encoding: 'utf8'})

assert.equal((wire.match(/id: /g) || []).length, 1)
assert.equal((wire.match(/\n\n/g) || []).length, 1)
assert(wire.startsWith('id: 42\n'))
assert(wire.includes('data: a\n') && wire.includes('data: b\n'))

const first_data = wire.indexOf('data:')
const cuts = {
	before_data: first_data,
	after_first_data: wire.indexOf('\n', first_data) + 1,
	after_last_data: wire.length - 1,
	complete: wire.length,
}
const reconnects = {}
const streams = new Set()
const requests = []
let changed = false
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
		} else if (req.url == '/rowset.events') {
			res.writeHead(200, {'Content-Type': 'text/event-stream'})
			res.write('\n')
			streams.add(res)
			res.on('close', () => streams.delete(res))
		} else if (req.url.startsWith('/cut/')) {
			const mode = req.url.slice('/cut/'.length)
			const id = req.headers['last-event-id']
			const ids = reconnects[mode] ??= []
			ids.push(id ?? null)
			res.writeHead(200, {'Content-Type': 'text/event-stream'})
			if (ids.length == 1) {
				res.write('retry: 10\nid: 41\ndata: seed\n\n')
				res.end(wire.slice(0, cuts[mode]))
			} else {
				res.write('\n')
				if (+id < 42)
					res.write(wire)
			}
		} else if (req.url.startsWith('/rowset.json/')) {
			const name = req.url.slice('/rowset.json/'.length)
			let body = ''
			for await (const chunk of req) body += chunk
			const post = JSON.parse(body)
			requests.push([name, post.exec])
			const rows = [[1, name + (changed ? '_new' : '_old')]]
			res.setHeader('Content-Type', 'application/json')
			if (post.exec == 'load') {
				res.end(JSON.stringify({
					fields: [{name: 'id', type: 'number', not_null: true},
						{name: 'text', type: 'text'}],
					pk: 'id', rows: rows, txn_id: 41, can_load_changed_rows: true,
				}))
			} else {
				assert.equal(post.exec, 'load_changed_rows')
				assert.equal(post.since_txn_id, 41)
				res.end(JSON.stringify({rows: rows, txn_id: 42,
					can_load_changed_rows: true}))
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
		window.navs = ['a', 'b'].map(name => ui.nav(name, {rowset_name: name}))
	})
	await page.waitForFunction(() => {
		for (const nav of navs) nav.check_dependencies()
		return navs.every(nav => nav.ready)
	})
	assert.equal(streams.size, 1)
	changed = true
	for (const stream of streams) stream.write(wire)
	await page.waitForFunction(() => navs.every(nav =>
		nav.cell_val(0, 'text') == nav.rowset_name+'_new'
		&& !nav.has_pending_request()))
	const fetches = requests.filter(req => req[1] == 'load_changed_rows')
	assert.deepEqual(fetches.sort(),
		[['a', 'load_changed_rows'], ['b', 'load_changed_rows']])
	console.log('ok one Lua event notifies both navs once')

	await page.evaluate(modes => {
		window.received = {}
		for (const mode of modes) {
			received[mode] = []
			new EventSource('/cut/'+mode).onmessage = ev => {
				received[mode].push([ev.data, ev.lastEventId])
			}
		}
	}, Object.keys(cuts))
	await page.waitForFunction(() => Object.values(received).every(events =>
		events.some(ev => ev[1] == '42')))
	const deadline = Date.now() + 5000
	while (!Object.keys(cuts).every(mode => reconnects[mode]?.length >= 2)) {
		assert(Date.now() < deadline, 'timed out waiting for reconnect')
		await new Promise(resolve => setTimeout(resolve, 10))
	}
	const received = await page.evaluate(() => window.received)
	for (const mode of Object.keys(cuts)) {
		assert.equal(reconnects[mode][1], mode == 'complete' ? '42' : '41')
		assert.equal(received[mode].length, 2)
		assert.deepEqual(received[mode][1][0].split('\n').sort(), ['a', 'b'])
	}
	console.log('ok interrupted events retain the previous replay cursor')
	console.log('ok complete events advance the replay cursor once')
	assert.deepEqual(errors, [])
} finally {
	await browser.close()
	server.closeAllConnections()
	server.close()
}
