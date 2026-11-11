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
let load_error, save_error, save_field_error
const server = http.createServer(async (req, res) => {
	try {
		if (req.url == '/') {
			res.setHeader('Content-Type', 'text/html')
			res.end('<!doctype html>' + ['glue.js', 'ui.js', 'ui_icon_defs.js',
				'ui_field.js', 'ui_nav.js', 'ui_code_edit.js', 'lezer.js',
				'app_os.js'].map(name =>
				`<script src="${name}" `
				+ `${name == 'glue.js' ? 'global' : ''}></script>`
				).join('') + '<script>ui.main = function() {}</script>')
		} else if (req.url == '/rowset.events') {
			res.writeHead(200, {'Content-Type': 'text/event-stream'})
			res.write(': ready\n\n')
		} else if (req.url == '/rowset.json/rowsets') {
			res.setHeader('Content-Type', 'application/json')
			res.end(JSON.stringify({rows: []}))
		} else if (req.url == '/rowset.json/os_explorer_file') {
			let body = ''
			for await (const chunk of req) body += chunk
			const request = JSON.parse(body)
			let result
			if (request.exec == 'save') {
				saves.push(request)
				result = {fields, rows: request.changes.rows.map(row => {
					if (save_error)
						return {type: 'update', error: save_error}
					if (save_field_error)
						return {type: 'update',
							field_errors: {contents: save_field_error}}
					const path = row.values['path:old']
					contents.set(path, row.values.contents)
					return {type: 'update', values: [path, row.values.contents]}
				})}
			} else {
				loads.push(request)
				if (load_error) {
					res.writeHead(500, {'Content-Type': 'text/plain'})
					res.end(load_error)
					return
				}
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
	async function frame() {
		const n = await page.evaluate(() => {
			const n = ui._build_no()
			ui.animate()
			return n
		})
		await page.waitForFunction(n => ui._build_no() > n, n)
		assert.deepEqual(errors, [])
	}
	async function key(key) {
		const parts = key.split('+')
		for (const part of parts) {
			await page.keyboard.down(part)
			await frame()
		}
		for (const part of parts.reverse()) {
			await page.keyboard.up(part)
			await frame()
		}
	}
	async function click(id) {
		const point = await page.evaluate(id => {
			ui._point_at(id)
			return {x: ui.local_pointer.mx, y: ui.local_pointer.my}
		}, id)
		await page.mouse.move(point.x, point.y)
		await page.mouse.down()
		await frame()
		await page.mouse.up()
		await frame()
	}
	await page.goto(`http://127.0.0.1:${server.address().port}/`)
	await page.waitForFunction(() => ui._frame_drawn)
	const demo = await fs.readFile(
		new URL('../demo/www/demo.js', import.meta.url), 'utf8')
	const tab_code = demo.slice(demo.indexOf('function app_dock_empty_tab('),
		demo.indexOf('function app_dock_tab_strip('))
	await page.evaluate(tab_code => {
		const build_tab = new Function('ui', 'v', 'end_v', 'sp2', 'button',
			'menu_button', 'set_dock_tab', tab_code + '\nreturn app_dock_tab')(ui,
			ui.v, ui.end_v, ui.sp2, ui.button, ui.menu_button, ui.set_dock_tab)
		ui.main = function() {
			ui.dock('app_dock', {tabs: [{id: 'probe'}]}, build_tab)
		}
		ui.animate()
	}, tab_code)
	await page.waitForFunction(() => ui._state_map.has(
		'app_dock.tab.probe.file_editor_button'))
	const chooser = await page.evaluate(() => {
		ui._point_at('app_dock.tab.probe.file_editor_button')
		return {x: ui.local_pointer.mx, y: ui.local_pointer.my}
	})
	await page.mouse.move(chooser.x, chooser.y)
	await page.mouse.down()
	await frame()
	await page.mouse.up()
	await page.waitForFunction(() => ui._state_map.get(
		'app_dock.tab.probe.file_editor')?.nav.ready)
	assert.equal(await page.evaluate(() =>
		ui._state_map.get('app_dock.tab.probe.file_editor').nav.focused_ri), null)
	assert.equal(await page.evaluate(() =>
		ui._state_map.get('app_dock.tab.probe.file_editor').nav.row_n), 0)
	assert.equal(await page.evaluate(() =>
		[...ui._state_map].some(([id, s]) => s.view
			&& id.startsWith('app_dock.tab.probe.file_editor.editor.'))), false)
	assert.deepEqual(errors, [])
	await page.evaluate(() => {
		window.shown_errors = new Set()
		const text = ui.text
		ui.text = function(...args) {
			const value = args[1]
			if (value != null && (value == window.file_nav?.load_error
				|| value == 'Test row error' || value == 'Test field error'))
				window.shown_errors.add(value)
			return text(...args)
		}
		ui.rowsets.os_explorer_files = {
			fields: [{name: 'path', not_null: true, readonly: true}],
			pk: 'path', rows: [['/first.txt'], ['/second.txt']],
			can_add_rows: false, can_remove_rows: false, can_change_rows: false,
		}
		window.build_file = function(tab) {
			window.file_tab = tab
			window.file_was_in_dock = ui.in_dock_tab()
			ui.file_editor(window.file_id ?? 'file', window.file_opt)
		}
		ui.main = function() {
			window.early_value = ui.value(window.file_input_id)
			let s = ui.state('files')
			s.nav ??= ui.nav('files', {rowset_name: 'os_explorer_files'})
			if (window.want_second) {
				window.want_second = false
				s.nav.focus_cell(1, 0)
			}
			if (window.file_in_dock)
				ui.dock('file_dock', {tabs: [{id: 'file'}]}, window.build_file)
			else
				window.build_file()
			let file_id = window.file_id ?? 'file'
			let nav = ui.state_of(file_id, 'nav')
			window.file_nav = nav
			window.file_input_id = file_id+'.editor.'
				+ nav.focused_row_cell_val('path')
		}
		ui.animate()
	})
	await page.waitForFunction(() =>
		ui._state_map.get(window.file_input_id)?.input_value == 'hello\n')
	assert(loads.some(req => req.params.path?.[0] == paths[0]))
	assert(await page.evaluate(() => ui._state_map.has('file.master.path')))
	await page.evaluate(() => ui.focus(window.file_input_id))
	await frame()
	await key('x')
	assert.equal(await page.evaluate(() =>
		ui._state_map.get(window.file_input_id).input_value), 'hello\n')
	assert.equal(await page.evaluate(() => window.early_value), 'hello\n')
	assert.equal(await page.evaluate(() =>
		ui._state_map.get('file').nav.modified_n), 0)
	await key('Control+s')
	await page.waitForFunction(() =>
		ui._state_map.get('file')?.nav.modified_n == 0)
	assert.equal(saves.length, 1)
	assert.equal(saves[0].changes.rows[0].values['path:old'], paths[0])
	assert.equal(contents.get(paths[0]), 'xhello\n')
	assert.equal(await page.evaluate(() => window.early_value), 'xhello\n')
	await page.evaluate(() => { window.want_second = true })
	await page.evaluate(() => ui.animate())
	await page.waitForFunction(() =>
		ui._state_map.get(window.file_input_id)?.input_value == 'second\n')
	assert(loads.some(req => req.params.path?.[0] == paths[1]))
	assert.equal(await page.evaluate(() => ui.focused_id),
		'file.editor.'+paths[1])
	assert.equal(await page.evaluate(() =>
		ui._state_map.has('file.editor./first.txt')), false)
	await key('Control+h')
	await page.evaluate(() => ui._redraw())
	await page.waitForFunction(() =>
		[...document.querySelectorAll('input')].some(input =>
			input._ui_id == window.file_input_id+'.find_input'))
	await page.evaluate(() =>
		[...document.querySelectorAll('input')].find(input =>
		input._ui_id == window.file_input_id+'.find_input').focus())
	for (const char of 'second') await key(char)
	await page.evaluate(() =>
		[...document.querySelectorAll('input')].find(input =>
		input._ui_id == window.file_input_id+'.replace_input').focus())
	for (const char of 'third') await key(char)
	const replace = await page.evaluate(() => {
		ui._point_at(window.file_input_id+'.replace_all')
		return {x: ui.local_pointer.mx, y: ui.local_pointer.my}
	})
	await page.mouse.move(replace.x, replace.y)
	await page.mouse.down()
	await frame()
	await page.mouse.up()
	await frame()
	assert.equal(await page.evaluate(() =>
		ui._state_map.get(window.file_input_id).input_value), 'second\n')
	await page.evaluate(() =>
		[...document.querySelectorAll('input')].find(input =>
		input._ui_id == window.file_input_id+'.find_input').focus())
	await key('Control+s')
	await page.waitForFunction(() =>
		ui._state_map.get('file')?.nav.modified_n == 0)
	assert.equal(contents.get(paths[1]), 'third\n')
	await page.evaluate(() => ui.focus(window.file_input_id))
	await frame()
	await key('Control+a')
	await key('Backspace')
	assert.equal(await page.evaluate(() =>
		ui._state_map.get(window.file_input_id).input_value), 'third\n')
	await key('Control+s')
	await page.waitForFunction(() =>
		ui._state_map.get('file')?.nav.modified_n == 0)
	assert.equal(contents.get(paths[1]), null)

	// master selection and readonly options.
	await click('file.master.path')
	await page.waitForFunction(() => window.file_nav.focused_ri == null)
	assert.equal(await page.evaluate(() =>
		ui.saved_state['file.masters'].path), null)
	await click('file.master.path')
	await page.waitForFunction(() => window.file_nav.focused_ri != null)
	const save_n = saves.length
	await page.evaluate(() => {
		window.file_opt = {readonly: true}
		ui.focus(window.file_input_id)
		ui.animate()
	})
	await page.waitForFunction(() =>
		ui._state_map.get(window.file_input_id)?.readonly)
	await key('x')
	await key('Control+s')
	assert.equal(saves.length, save_n)
	await page.evaluate(() => {
		window.file_opt = {readonly: false}
		ui.animate()
	})
	await page.waitForFunction(() =>
		ui._state_map.get(window.file_input_id)?.readonly === false)
	await key('Control+s')
	assert.equal(saves.length, save_n)

	// row and field save errors preserve pending edits for retry.
	save_error = 'Test row error'
	await key('x')
	await key('Control+s')
	await page.waitForFunction(() => window.file_nav.row_errors[
		window.file_nav.focused_ri]?.[0]?.error == 'Test row error'
		&& window.shown_errors.has('Test row error'))
	assert.equal(contents.get(paths[1]), null)
	save_error = null
	await key('Control+s')
	await page.waitForFunction(() => window.file_nav.modified_n == 0)
	assert.equal(contents.get(paths[1]), 'x')
	save_field_error = 'Test field error'
	await key('y')
	await key('Control+s')
	await page.waitForFunction(() => {
		let nav = window.file_nav
		return nav.cell_errors[nav.all_fields_map.contents.fi]?.[
			nav.focused_ri]?.[0]?.error == 'Test field error'
			&& window.shown_errors.has('Test field error')
	})
	assert.equal(contents.get(paths[1]), 'x')
	save_field_error = null
	await key('Control+s')
	await page.waitForFunction(() => window.file_nav.modified_n == 0)
	assert.equal(contents.get(paths[1]), 'xy')

	// explicit binding and client validation.
	await page.evaluate(() => {
		ui._state_map.get('files').nav.focus_cell(0, 0)
		window.file_id = 'file_validated'
		window.file_opt = {param_bindings: {path: 'files'},
			field_attrs: {contents: {maxlen: 7}}}
		ui.animate()
	})
	await page.waitForFunction(() => window.file_nav.ready
		&& window.file_nav.id == 'file_validated'
		&& window.file_nav.focused_ri != null)
	assert.equal(await page.evaluate(() => window.file_nav.param_sources.path),
		'files')
	assert.equal(await page.evaluate(() =>
		ui._state_map.has('file_validated.master.path')), false)
	await page.evaluate(() => ui.focus(window.file_input_id))
	await frame()
	const validated_save_n = saves.length
	await key('z')
	await key('Control+s')
	await page.waitForFunction(() => {
		let nav = window.file_nav
		return nav.cell_has_errors(nav.focused_ri,
			nav.all_fields_map.contents.fi)
	})
	assert.equal(saves.length, validated_save_n)
	assert.equal(contents.get(paths[0]), 'xhello\n')
	await key('Backspace')
	await key('Control+s')
	await page.waitForFunction(() => window.file_nav.modified_n == 0)
	assert.equal(saves.length, validated_save_n)

	// load errors and a master toggle in the dock tab strip.
	load_error = 'Test load error'
	await page.evaluate(() => window.file_nav.reload())
	await page.waitForFunction(() => window.file_nav.load_error
		&& window.shown_errors.has(window.file_nav.load_error))
	load_error = null
	await page.evaluate(() => window.file_nav.reload())
	await page.waitForFunction(() => !window.file_nav.load_error
		&& !window.file_nav.has_pending_request())
	await page.evaluate(() => {
		window.file_id = 'file_docked'
		window.file_opt = undefined
		window.file_in_dock = true
		ui.animate()
	})
	await page.waitForFunction(() => window.file_was_in_dock
		&& ui._state_map.has('file_docked.master.path')
		&& window.file_nav.ready && window.file_nav.focused_ri != null)
	assert.equal(await page.evaluate(() => window.file_tab.title), paths[0])
	assert.equal(await page.evaluate(() =>
		ui._state_map.get('file_docked').input_opt.lang), 'txt')

	await page.evaluate(() => {
		window.caller_value = 'abc'
		window.probe_field = ui.create_field({maxlen: 3})
		ui.main = function() {
			ui.code_edit_update_value('input_probe')
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
	await frame()
	await key('x')
	await page.waitForFunction(() =>
		ui._state_map.get('input_probe')?.validation.failed)
	assert.equal(await page.evaluate(() => window.input_result), undefined)
	assert.equal(await page.evaluate(() => window.early_value), undefined)
	assert.equal(await page.evaluate(() => window.caller_value), 'xabc')
	await key('Backspace')
	await page.waitForFunction(() => window.input_result == 'abc')
	assert.equal(await page.evaluate(() => window.early_value), 'abc')
	await page.evaluate(() => {
		window.probe_field = ui.create_field({readonly: true})
		ui.animate()
	})
	await page.waitForFunction(() =>
		ui._state_map.get('input_probe')?.field.readonly)
	await key('x')
	assert.equal(await page.evaluate(() => window.caller_value), 'abc')
	assert.deepEqual(errors, [])
	console.log('file editor: binding, Ctrl+S, switching, find/replace,'
		+ ' masters, readonly, validation, errors, dock strip, input contract')
} finally {
	await browser?.close()
	server.closeAllConnections()
	server.close()
}
