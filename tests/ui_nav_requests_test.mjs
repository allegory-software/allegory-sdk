import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const requests = []
const streams = new Set()
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
		} else if (req.url.startsWith('/rowset.json/')) {
			let body = ''
			for await (const chunk of req) body += chunk
			requests.push({
				name: req.url.slice('/rowset.json/'.length),
				post: JSON.parse(body), res: res, taken: false,
			})
		} else {
			res.setHeader('Content-Type', 'application/javascript')
			res.end(await fs.readFile(new URL('../www'+req.url, import.meta.url)))
		}
	} catch (error) {
		res.writeHead(500).end(String(error))
	}
})

function rowset(text = 'one', auto_increment = false) {
	return {
		fields: [
			{name: 'id', type: 'number', not_null: true,
				auto_increment: auto_increment},
			{name: 'text', type: 'text'},
		],
		pk: 'id', rows: [[1, text]], txn_id: 41,
		can_load_changed_rows: true,
	}
}

function reply(req, data, status = 200) {
	req.res.writeHead(status, {'Content-Type': 'application/json'})
	req.res.end(JSON.stringify(data))
}

async function wait_for(fn) {
	const deadline = Date.now() + 5000
	while (!fn()) {
		assert(Date.now() < deadline, 'timed out waiting for a request')
		await new Promise(resolve => setTimeout(resolve, 10))
	}
}

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({channel: 'chrome', headless: true})
try {
	const page = await browser.newPage()
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	await page.addInitScript(() => {
		const send0 = XMLHttpRequest.prototype.send
		window.finished_n = 0
		XMLHttpRequest.prototype.send = function(...args) {
			this.addEventListener('loadend', () => finished_n++)
			return send0.apply(this, args)
		}
		const EventSource0 = EventSource
		window.notifications_n = 0
		window.EventSource = class extends EventSource0 {
			constructor(url) {
				super(url)
				this.addEventListener('message', () => notifications_n++)
			}
		}
	})
	await page.goto(`http://127.0.0.1:${server.address().port}/probe.html`)
	await page.waitForFunction(() => ui._frame_drawn)
	let name
	let nav_n = 0

	async function next_request(exec) {
		let req
		await wait_for(() => {
			req = requests.find(req => req.name == name && !req.taken)
			return req
		})
		req.taken = true
		assert.equal(req.post.exec, exec)
		return req
	}

	function request_ops() {
		return requests.filter(req => req.name == name)
			.map(req => req.post.exec)
	}

	async function open_nav(auto_increment = false) {
		name = 'requests_'+(++nav_n)
		await page.evaluate(name => {
			window.nav = ui.nav(name, {rowset_name: name})
		}, name)
		reply(await next_request('load'), rowset('one', auto_increment))
		await page.waitForFunction(() => {
			nav.check_dependencies()
			return nav.ready && !nav.has_pending_request()
		})
		await wait_for(() => streams.size > 0)
	}

	async function notify() {
		const n = await page.evaluate(() => notifications_n)
		for (const stream of streams)
			stream.write('id: 42\ndata: '+name+'\n\n')
		await page.waitForFunction(n => notifications_n > n, n)
	}

	async function idle() {
		await page.waitForFunction(() => !nav.has_pending_request())
	}

	async function edit() {
		await page.evaluate(() => nav.set_cell_val(0, 1, 'edited'))
	}

	async function start_request(exec) {
		if (exec == 'load_changed_rows') {
			await notify()
		} else {
			await page.evaluate(exec => {
				if (exec == 'load') {
					nav.reload()
				} else {
					if (exec == 'reserve_ids')
						nav.insert_rows([[null, 'new']])
					else
						nav.set_cell_val(0, 1, 'edited')
					nav.save()
				}
			}, exec)
		}
		return next_request(exec)
	}

	name = 'requests_'+(++nav_n)
	await page.evaluate(name => {
		window.nav = ui.nav(name, {rowset_name: name})
	}, name)
	const initial_load = await next_request('load')
	await wait_for(() => streams.size > 0)
	await notify()
	reply(initial_load, rowset())
	reply(await next_request('load_changed_rows'), {txn_id: 42,
		rows: [[1, 'changed after load snapshot']],
		can_load_changed_rows: true})
	await idle()
	assert.equal(await page.evaluate(() => nav.cell_val(0, 'text')),
		'changed after load snapshot')
	await page.evaluate(() => nav.free())
	console.log('ok a notification during the first load still fetches changes')

	await open_nav()
	const load0 = await start_request('load')
	await notify()
	await page.evaluate(() => nav.reload())
	const load1 = await next_request('load')
	await wait_for(() => load0.res.destroyed)
	assert.deepEqual(await page.evaluate(() => {
		const ds = nav.get_debug_state()
		return [ds.is_loading, ds.is_loading_changes, nav.load_error]
	}), [true, false, null])
	reply(load1, rowset())
	reply(await next_request('load_changed_rows'), {txn_id: 42,
		can_load_changed_rows: true})
	await idle()
	assert.deepEqual(request_ops(), ['load', 'load', 'load',
		'load_changed_rows'])
	await page.evaluate(() => nav.free())
	console.log('ok replacement load preserves a queued fetch without overlap')

	await open_nav()
	await edit()
	const fetch0 = await start_request('load_changed_rows')
	assert(await page.evaluate(() => nav.has_pending_request()))
	await page.evaluate(() => nav.reload())
	await notify()
	await page.evaluate(() => nav.save())
	reply(fetch0, {txn_id: 42, can_load_changed_rows: true})
	reply(await next_request('load'), rowset())
	reply(await next_request('load_changed_rows'), {txn_id: 43,
		can_load_changed_rows: true})
	const save0 = await next_request('save')
	assert.equal(save0.post.changes.rows[0].values.text, 'edited')
	reply(save0, {rows: [{values: [1, 'edited']}]})
	await idle()
	assert.equal(await page.evaluate(() => nav.modified_n), 0)
	assert.deepEqual(request_ops(), ['load', 'load_changed_rows', 'load',
		'load_changed_rows', 'save'])
	await page.evaluate(() => nav.free())
	console.log('ok queued reload, fetch and save retain their priority')

	for (const exec of ['load', 'load_changed_rows']) {
		await open_nav()
		await edit()
		const req = await start_request(exec)
		await page.evaluate(() => nav.save())
		reply(req, {error: 'read failed'}, 503)
		await idle()
		assert.equal(await page.evaluate(() => nav.load_error), 'read failed')
		assert.deepEqual(request_ops(), ['load', exec])
		await page.evaluate(() => nav.save())
		reply(await next_request('save'), {rows: [{values: [1, 'edited']}]})
		await idle()
		await page.evaluate(() => nav.free())
	}
	console.log('ok failed reads discard the queued save; a later save works')

	for (const exec of ['load', 'load_changed_rows', 'save', 'reserve_ids']) {
		await open_nav(exec == 'reserve_ids')
		const req = await start_request(exec)
		await page.evaluate(exec => {
			if (exec != 'load')
				nav.reload()
			nav.save()
		}, exec)
		await notify()
		await page.evaluate(rs => nav.load(rs), rowset('replacement'))
		await wait_for(() => req.res.destroyed)
		assert.deepEqual(await page.evaluate(() => [nav.has_pending_request(),
			nav.cell_val(0, 'text'), nav.modified_n, nav.load_error]),
			[false, 'replacement', 0, null])
		await notify()
		reply(await next_request('load_changed_rows'), {txn_id: 42,
			can_load_changed_rows: true})
		await idle()
		assert.deepEqual(request_ops(), ['load', exec, 'load_changed_rows'])
		await page.evaluate(() => nav.free())
	}
	console.log('ok rowset replacement cancels every request kind and intent')

	for (const exec of ['load', 'load_changed_rows', 'save', 'reserve_ids']) {
		await open_nav(exec == 'reserve_ids')
		const req = await start_request(exec)
		await page.evaluate(() => nav.save())
		await notify()
		await page.evaluate(() => nav.free())
		assert.equal(await page.evaluate(() => nav.has_pending_request()), false)
		if (exec == 'load' || exec == 'load_changed_rows') {
			await wait_for(() => req.res.destroyed)
		} else {
			assert.equal(req.res.destroyed, false)
			const n = await page.evaluate(() => finished_n)
			reply(req, exec == 'save' ? {rows: [{values: [1, 'edited']}]} :
				{ids: [2]})
			await page.waitForFunction(n => finished_n > n, n)
		}
		assert.deepEqual(request_ops(), ['load', exec])
	}
	console.log('ok free aborts reads and ignores writes without queued work')

	await open_nav(true)
	const reserve = await start_request('reserve_ids')
	assert(await page.evaluate(() => nav.get_debug_state().is_saving))
	await notify()
	reply(reserve, {ids: [2]})
	reply(await next_request('load_changed_rows'), {txn_id: 42,
		can_load_changed_rows: true})
	const reserved_save = await next_request('save')
	assert.equal(reserved_save.post.changes.rows[0].values.id, 2)
	reply(reserved_save, {rows: [{values: [2, 'new']}]})
	await idle()
	assert.equal(await page.evaluate(() => nav.modified_n), 0)
	await page.evaluate(() => nav.free())
	console.log('ok ID reservation continues through a queued fetch to the save')

	await open_nav()
	const failed_save = await start_request('save')
	reply(failed_save, {error: 'save failed'}, 503)
	await idle()
	await page.evaluate(() => nav.save())
	reply(await next_request('load_changed_rows'), {reload: true,
		txn_id: 42, can_load_changed_rows: true})
	reply(await next_request('load'), rowset())
	reply(await next_request('save'), {rows: [{values: [1, 'edited']}]})
	await idle()
	assert.equal(await page.evaluate(() => nav.modified_n), 0)
	assert.deepEqual(request_ops(), ['load', 'save', 'load_changed_rows',
		'load', 'save'])
	await page.evaluate(() => nav.free())
	console.log('ok failed-save reconciliation queues one fallback reload')

	for (const committed of [false, true]) {
		for (const op of ['remove', 'revert_row', 'revert_changes']) {
			await open_nav()
			await page.evaluate(() => {
				window.new_ri = nav.insert_rows([[2, 'new']])[0]
				nav.save()
			})
			reply(await next_request('save'), {error: 'save failed'}, 503)
			await idle()
			await page.evaluate(op => {
				if (op == 'remove')
					nav.remove_rows([new_ri])
				else if (op == 'revert_row')
					nav.revert_row(new_ri)
				else
					nav.revert_changes()
			}, op)
			assert.deepEqual(await page.evaluate(() => [nav.row_n,
				nav.is_new(new_ri), nav.is_removed(new_ri)]), [2, true, true])
			await page.evaluate(() => nav.save())
			reply(await next_request('load_changed_rows'), {txn_id: 42,
				rows: committed ? [[2, 'new']] : [],
				can_load_changed_rows: true})
			if (committed) {
				const req = await next_request('save')
				assert.equal(req.post.changes.rows[0].type, 'remove')
				assert.equal(req.post.changes.rows[0].values['id:old'], 2)
				reply(req, {rows: [{remove: true}]})
			}
			await idle()
			assert.deepEqual(await page.evaluate(() => [nav.row_n,
				nav.modified_n, nav.lookup('id', [2])]), [1, 0, null])
			await page.evaluate(() => nav.free())
		}
	}
	console.log('ok deletion and reverts settle both failed-insert outcomes')
	assert.deepEqual(errors, [])
} finally {
	await browser.close()
	server.closeAllConnections()
	server.close()
}
