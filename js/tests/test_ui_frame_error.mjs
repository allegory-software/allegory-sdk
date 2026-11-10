// run: node js/tests/test_ui_frame_error.mjs
// A frame that throws while build stacks are open must not break the next one.
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'http'
import fs from 'fs'
import path from 'path'
import assert from 'assert/strict'

let root = path.join(import.meta.dirname, '..', '..')
let types = { // {ext -> mime type}
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
}
let srv = http.createServer(function(req, res) {
	let file = path.join(root, decodeURIComponent(req.url.split('?')[0]))
	fs.readFile(file, function(err, buf) {
		if (err) { res.writeHead(404); res.end(); return }
		res.writeHead(200, {'content-type': types[path.extname(file)] ?? ''})
		res.end(buf)
	})
}).listen(0, '127.0.0.1')
await new Promise(resolve => srv.on('listening', resolve))
let port = srv.address().port

let browser = await chromium.launch({channel: 'chrome'})
let pg = await browser.newPage({deviceScaleFactor: 1})
let console_errors = [] // [text, ...]
let page_errors = [] // [message, ...]
pg.on('pageerror', e => page_errors.push(e.stack ?? e.message))
pg.on('console', function(m) {
	if (m.type() == 'error' && !/favicon\.ico/.test(m.location().url))
		console_errors.push(m.text())
})

await pg.goto(`http://127.0.0.1:${port}/www/ui-demo.html?demo=button`)
await pg.waitForTimeout(500)
assert.deepEqual(page_errors, [])
assert.deepEqual(console_errors, [])

// frame 1 throws with two state scopes open, a container and a split open.
await pg.evaluate(function() {
	window.main0 = ui.main
	ui.main = function() {
		ui.begin_state_scope('frame_error_outer')
		ui.begin_state_scope('frame_error_inner')
		ui.v()
		throw new Error('frame_error_test')
	}
	ui.animate()
})
await pg.waitForTimeout(300)
assert.equal(console_errors.length, 1)
assert.match(console_errors[0], /frame_error_test/)

// frame 2 opens the outer scope again, which used to create a parent cycle.
await pg.evaluate(function() {
	ui.main = function() {
		ui.begin_state_scope('frame_error_outer')
		ui.begin_state_scope('frame_error_inner')
		ui.state('frame_error_widget')
		ui.end_state_scope()
		ui.end_state_scope()
		window.frame_error_hidden = ui.is_state_hidden('frame_error_widget')
	}
	window.build_no0 = ui._build_no()
	ui.animate()
})
await pg.waitForTimeout(300)
let result = await pg.evaluate(() => ({
	built: ui._build_no() > window.build_no0,
	hidden: window.frame_error_hidden,
}))
assert.equal(result.built, true)
assert.equal(result.hidden, false)
assert.equal(console_errors.length, 1, console_errors.join('\n'))
assert.deepEqual(page_errors, [])

// the demo itself builds again.
await pg.evaluate(function() {
	ui.main = window.main0
	ui.animate()
})
await pg.waitForTimeout(300)
assert.equal(console_errors.length, 1)
assert.deepEqual(page_errors, [])

await browser.close()
srv.close()
console.log('ok')
