import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const fields = [
	{name: 'path', not_null: true, readonly: true},
	{name: 'contents', maxlen: 16 * 1024 ** 2},
]
const paths = ['/first.txt', '/second.txt']
const contents = new Map([[paths[0], 'hello\n'], [paths[1], 'second\n']])
const loads = [], saves = []
const server = http.createServer(async (req, res) => {
	try {
		if (req.url == '/') {
			res.setHeader('Content-Type', 'text/html')
			res.end('<!doctype html>' + ['glue.js', 'ui.js', 'ui_icon_defs.js',
				'ui_field.js', 'ui_nav.js', 'ui_code_edit.js', 'lezer.js',
				'ui_os_explorer.js'].map(name =>
				`<script src="${name}" `
				+ `${name == 'glue.js' ? 'global' : ''}></script>`
				).join('') + '<script>ui.main = function() {}</script>')
		} else if (req.url == '/rowset.events') {
			res.writeHead(200, {'Content-Type': 'text/event-stream'})
			res.write(': ready\n\n')
		} else if (req.url == '/rowset.json/os_explorer_file') {
			let body = ''
			for await (const chunk of req) body += chunk
			const request = JSON.parse(body)
			let result
			if (request.exec == 'save') {
				saves.push(request)
				result = {fields, rows: request.changes.rows.map(row => {
					const path = row.values['path:old']
					contents.set(path, row.values.contents)
					return {type: 'update', values: [path, row.values.contents]}
				})}
			} else {
				loads.push(request)
				const path = request.params.path?.[0]
				result = {fields, pk: 'path',
					params: {path: {for_cols: 'path', accept_many: false,
						lookup_rowset_name: 'os_explorer_files',
						lookup_cols: 'path'}},
					can_add_rows: false, can_remove_rows: false,
					can_change_rows: true, can_move_rows: false,
					rows: contents.has(path) ? [[path, contents.get(path)]] : []}
			}
			res.setHeader('Content-Type', 'application/json')
			res.end(JSON.stringify(result))
		} else {
			res.setHeader('Content-Type', 'application/javascript')
			const file = new URL('../www' + req.url, import.meta.url)
			res.end(await fs.readFile(file))
		}
	} catch (err) {
		res.writeHead(500).end(String(err))
	}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
	browser = await chromium.launch({channel: 'chrome', headless: true})
	const page = await browser.newPage()
	const errors = []
	page.on('pageerror', err => errors.push(err.message))
	await page.goto(`http://127.0.0.1:${server.address().port}/`)
	await page.waitForFunction(() => ui._frame_drawn)
	const demo = await fs.readFile(
		new URL('../demo/www/demo.js', import.meta.url), 'utf8')
	const tab_code = demo.slice(demo.indexOf('function app_dock_empty_tab('),
		demo.indexOf('function app_dock_tab_strip('))
	await page.evaluate(tab_code => {
		window.probe_tab = {id: 'probe'}
		const build_tab = new Function('ui', 'v', 'end_v', 'sp2', 'button',
			'set_dock_tab', tab_code + '\nreturn app_dock_tab')(ui,
			ui.v, ui.end_v, ui.sp2, ui.button, function(id, tab_id, tab) {
				window.probe_tab = {id: tab_id, ...tab}
			})
		ui.main = function() { build_tab(window.probe_tab) }
		ui.animate()
	}, tab_code)
	await page.waitForFunction(() => ui._state_map.has(
		'app_dock.tab.probe.file_editor_button'))
	const chooser = await page.evaluate(() => {
		ui._point_at('app_dock.tab.probe.file_editor_button')
		return {x: ui.local_pointer.mx, y: ui.local_pointer.my}
	})
	await page.mouse.click(chooser.x, chooser.y)
	await page.waitForFunction(() => ui._state_map.get(
		'app_dock.tab.probe.file_editor')?.nav.ready)
	assert.equal(await page.evaluate(() =>
		ui._state_map.get('app_dock.tab.probe.file_editor').nav.focused_ri), null)
	assert.equal(await page.evaluate(() =>
		ui._state_map.get('app_dock.tab.probe.file_editor').nav.row_n), 0)
	assert.equal(await page.evaluate(() =>
		ui._state_map.has('app_dock.tab.probe.file_editor.editor')), false)
	assert.deepEqual(errors, [])
	await page.evaluate(() => {
		ui.rowsets.os_explorer_files = {
			fields: [{name: 'path', not_null: true, readonly: true}],
			pk: 'path', rows: [['/first.txt'], ['/second.txt']],
			can_add_rows: false, can_remove_rows: false, can_change_rows: false,
		}
		ui.main = function() {
			window.early_value = ui.value('file.editor')
			let s = ui.state('files')
			s.nav ??= ui.nav('files', {rowset_name: 'os_explorer_files'})
			if (window.want_second) {
				window.want_second = false
				s.nav.focus_cell(1, 0)
			}
			ui.file_editor('file')
		}
		ui.animate()
	})
	await page.waitForFunction(() =>
		ui._state_map.get('file.editor')?.input_value == 'hello\n')
	assert(loads.some(req => req.params.path?.[0] == paths[0]))
	await page.evaluate(() => ui.focus('file.editor'))
	await page.keyboard.press('x')
	await page.waitForFunction(() =>
		ui._state_map.get('file.editor')?.input_value == 'xhello\n')
	assert.equal(await page.evaluate(() => window.early_value), 'xhello\n')
	await page.keyboard.press('Control+s')
	await page.waitForFunction(() =>
		ui._state_map.get('file')?.nav.modified_n == 0)
	assert.equal(saves.length, 1)
	assert.equal(saves[0].changes.rows[0].values['path:old'], paths[0])
	assert.equal(contents.get(paths[0]), 'xhello\n')
	await page.evaluate(() => { window.want_second = true })
	await page.evaluate(() => ui.animate())
	await page.waitForFunction(() =>
		ui._state_map.get('file.editor')?.input_value == 'second\n')
	assert(loads.some(req => req.params.path?.[0] == paths[1]))
	await page.keyboard.press('Control+h')
	await page.evaluate(() => ui._redraw())
	await page.waitForFunction(() =>
		[...document.querySelectorAll('input')].some(input =>
			input._ui_id == 'file.editor.find_input'))
	await page.evaluate(() =>
		[...document.querySelectorAll('input')].find(input =>
		input._ui_id == 'file.editor.find_input').focus())
	await page.keyboard.type('second')
	await page.evaluate(() =>
		[...document.querySelectorAll('input')].find(input =>
		input._ui_id == 'file.editor.replace_input').focus())
	await page.keyboard.type('third')
	const replace = await page.evaluate(() => {
		ui._point_at('file.editor.replace_all')
		return {x: ui.local_pointer.mx, y: ui.local_pointer.my}
	})
	await page.mouse.click(replace.x, replace.y)
	await page.waitForFunction(() =>
		ui._state_map.get('file.editor')?.input_value == 'third\n')
	await page.evaluate(() =>
		[...document.querySelectorAll('input')].find(input =>
		input._ui_id == 'file.editor.find_input').focus())
	await page.keyboard.press('Control+s')
	await page.waitForFunction(() =>
		ui._state_map.get('file')?.nav.modified_n == 0)
	assert.equal(contents.get(paths[1]), 'third\n')
	await page.evaluate(() => ui.focus('file.editor'))
	await page.keyboard.press('Control+a')
	await page.keyboard.press('Backspace')
	await page.waitForFunction(() =>
		ui._state_map.get('file.editor')?.input_value === null)
	await page.keyboard.press('Control+s')
	await page.waitForFunction(() =>
		ui._state_map.get('file')?.nav.modified_n == 0)
	assert.equal(contents.get(paths[1]), null)
	await page.evaluate(() => {
		window.caller_value = 'abc'
		window.probe_field = ui.create_field({maxlen: 3})
		ui.main = function() {
			window.early_value = ui.value('input_probe')
			window.input_result = ui.code_edit('input_probe',
				window.caller_value, window.probe_field)
			if (ui.interaction_value('input_probe') !== undefined)
				window.caller_value = ui.input_value('input_probe')
		}
		ui.animate()
	})
	await page.waitForFunction(() =>
		ui._state_map.get('input_probe')?.input_value == 'abc')
	await page.evaluate(() => ui.focus('input_probe'))
	await page.keyboard.press('x')
	await page.waitForFunction(() =>
		ui._state_map.get('input_probe')?.validation.failed)
	assert.equal(await page.evaluate(() => window.input_result), undefined)
	assert.equal(await page.evaluate(() => window.early_value), undefined)
	assert.equal(await page.evaluate(() => window.caller_value), 'xabc')
	await page.keyboard.press('Backspace')
	await page.waitForFunction(() => window.input_result == 'abc')
	assert.equal(await page.evaluate(() => window.early_value), 'abc')
	await page.evaluate(() => {
		window.probe_field = ui.create_field({readonly: true})
		ui.animate()
	})
	await page.waitForFunction(() =>
		ui._state_map.get('input_probe')?.field.readonly)
	await page.keyboard.press('x')
	assert.equal(await page.evaluate(() => window.caller_value), 'abc')
	assert.deepEqual(errors, [])
	console.log('file editor: binding, Ctrl+S, switching, find/replace,'
		+ ' input contract')
} finally {
	await browser?.close()
	server.closeAllConnections()
	server.close()
}
