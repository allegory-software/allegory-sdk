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
				+ '<script src="ui_call.js"></script>'
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
	const page = await browser.newPage({viewport: {width: 1000, height: 800}})
	const errors = []
	page.on('pageerror', error => errors.push(error.message))
	await page.goto(`http://127.0.0.1:${server.address().port}/probe.html`)
	await page.waitForFunction(() => ui._frame_drawn)
	await page.evaluate(() => {
		window.probe = {mode: 'direct', value: 'First', items: ['First', 'Second']}
		const stack0 = ui.stack
		ui.stack = function(id, ...args) {
			let i = stack0(id, ...args)
			if (id) ui.measure(id+'.box')
			return i
		}
		const popup0 = ui.popup
		ui.popup = function(id, ...args) {
			let i = popup0(id, ...args)
			if (id) ui.measure(id+'.box')
			return i
		}
		function contents() {
			ui.v(0, ui.sp())
				probe.value = ui.list_dropdown('choice', probe.items, probe.value,
					null, 0)
				if (ui.popup_button('nested', 'settings', 'Nested', 'r', '[')) {
					ui.button('nested_content', '', 'Content')
					ui.end_popup_button('nested')
				}
			ui.end_v()
		}
		ui.main = function() {
			ui.m(80)
			ui.v(0, ui.sp(), 'l', 't')
				if (ui.popup_button('settings', 'settings', 'Settings', 'b', '[')) {
					if (probe.mode == 'frame') {
						ui.min_wh(300, 150)
						ui.sb('frame_scroll', 0, 'hide', 'hide')
							ui.frame(() => null, contents)
						ui.end_sb()
					} else if (probe.mode == 'rec_box') {
						let rec_i = ui.create_rec_box()
						ui.open_rec_box(rec_i)
							contents()
						ui.close_rec_box()
						ui.rec_box(rec_i, 0, 'l', 't')
					} else {
						contents()
					}
					ui.end_popup_button('settings')
				}
			ui.end_v()
			ui.m(700, 600, 0, 0)
			ui.stack('outside', 0)
				ui.input('outside.input', 'Outside', null, 0)
			ui.end_stack()
			if (ui.click) {
				probe.hit = ui.hit_match('')
				probe.outside = ui.clicked_outside('settings.popup')
				probe.hover = !!ui.hovers('settings.popup')
			}
		}
		ui.animate()
	})
	async function click(id) {
		const box = await page.evaluate(id => {
			let s = ui._state_map.get(id+'.box')
			return s && {x: s.x, y: s.y, w: s.w, h: s.h}
		}, id)
		assert.ok(box && box.w > 0 && box.h > 0, 'missing box: '+id)
		await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2)
		await page.waitForTimeout(40)
		await page.mouse.down()
		await page.waitForTimeout(40)
		await page.mouse.up()
		await page.waitForTimeout(60)
	}
	async function open(id, expected) {
		assert.equal(await page.evaluate(id => !!ui._state_map.get(id)?.open, id),
			expected, id+' open '+JSON.stringify(await page.evaluate(() => probe)))
	}
	async function key(name) {
		await page.keyboard.down(name)
		await page.waitForTimeout(40)
		await page.keyboard.up(name)
		await page.waitForTimeout(60)
	}
	for (const mode of ['direct', 'frame', 'rec_box']) {
		await page.evaluate(mode => { probe.mode = mode; ui.animate() }, mode)
		await page.waitForTimeout(60)
		await click('settings.button')
		await open('settings', true)
		await click('choice')
		await open('choice', true)
		await open('settings', true)
		await click('choice.picker.1')
		await open('settings', true)
		assert.equal(await page.evaluate(() => probe.value), 'Second')
		assert.equal(await page.evaluate(() => probe.outside), false)
		assert.equal(await page.evaluate(() => probe.hover), false)
		await click('nested.button')
		await open('nested', true)
		await click('nested.cancel')
		await open('nested', false)
		await open('settings', true)
		assert.equal(await page.evaluate(() => ui.focused_id), 'nested.button')
		await click('outside')
		await open('settings', false)
		assert.equal(await page.evaluate(() => ui.focused_id), 'outside.input')
		await click('settings.button')
		await click('settings.cancel')
		await open('settings', false)
		assert.equal(await page.evaluate(() => ui.focused_id), 'settings.button')
		await key('Enter')
		await open('settings', true)
		assert.equal(await page.evaluate(() => ui.focus_inside('settings.picker')),
			true, await page.evaluate(() => ui.focused_id))
		await key('Escape')
		await open('settings', false)
		assert.equal(await page.evaluate(() => ui.focused_id), 'settings.button')
		await click('settings.button')
		await click('settings.button')
		await open('settings', false)
		await page.evaluate(() => { probe.value = 'First'; ui.animate() })
		console.log('Popup button: '+mode+' passed')
	}
	await page.evaluate(() => {
		ui.main = function() {
			ui.m(80)
			let open = ui.dropdown('outer', null, null, 0, 'l', 't')
				ui.text('', 'Outer dropdown', 0)
			ui.dropdown_picker('outer', 'b', '[')
				if (open) {
					if (ui.popup_button('inner', 'settings', 'Inner', 'r', '[')) {
						ui.button('inner_content', '', 'Content')
						ui.end_popup_button('inner')
					}
				}
			ui.end_dropdown('outer')
			ui.m(700, 600, 0, 0)
			ui.stack('outside', 0)
				ui.input('outside.input', 'Outside', null, 0)
			ui.end_stack()
		}
		ui.animate()
	})
	await page.waitForTimeout(60)
	await click('outer')
	await click('inner.button')
	await open('outer', true)
	await open('inner', true)
	await click('inner.cancel')
	await open('outer', true)
	await open('inner', false)
	await click('outside')
	await open('outer', false)
	console.log('Dropdown: clicks in nested popup passed')
	await page.evaluate(() => {
		const call = {
			state: 'joined', peers: [], devices: [], want_force_sfu: false,
			microphone: {is_enabled: false, device_id: null, track: null,
				want_echo_cancellation: true, want_noise_suppression: true},
			camera: {is_enabled: false, device_id: null, track: null,
				want_background_blur: false},
			speaker: {device_id: null},
			microphone_level() { return null },
			leave() {},
			set_force_sfu(value) { call.want_force_sfu = value },
		}
		window.create_call = () => call
		ui.main = function() {
			ui.call('call', {call_id: '1', invite_token: 'test', name: 'Test'})
		}
		ui.animate()
	})
	await page.waitForTimeout(60)
	await click('call.settings.button')
	await open('call.settings', true)
	await click('call.microphone.device')
	await open('call.microphone.device', true)
	await click('call.microphone.device.picker.0')
	await open('call.settings', true)
	await click('call.camera.device')
	await open('call.camera.device', true)
	await click('call.camera.device.picker.0')
	await open('call.settings', true)
	await click('call.settings.cancel')
	await open('call.settings', false)
	console.log('Call settings: microphone and camera dropdowns passed')
	await page.evaluate(() => {
		probe.pressed_a = 0
		probe.pressed_b = 0
		ui.main = function() {
			if (ui.button('press.a', '', 'A')) probe.pressed_a++
			if (ui.button('press.b', '', 'B')) probe.pressed_b++
		}
		ui.animate()
	})
	await page.waitForTimeout(60)
	for (const name of ['Enter', ' ']) {
		await page.evaluate(() => { ui.focus('press.a'); ui.animate() })
		await page.waitForTimeout(60)
		await page.keyboard.down(name)
		await page.waitForTimeout(40)
		await page.evaluate(() => { ui.focus('press.b'); ui.animate() })
		await page.waitForTimeout(60)
		await page.keyboard.up(name)
		await page.waitForTimeout(60)
		assert.deepEqual(await page.evaluate(() =>
			[probe.pressed_a, probe.pressed_b]), [0, 0])
	}
	await key('Enter')
	assert.deepEqual(await page.evaluate(() =>
		[probe.pressed_a, probe.pressed_b]), [0, 1])
	await key(' ')
	assert.deepEqual(await page.evaluate(() =>
		[probe.pressed_a, probe.pressed_b]), [0, 2])
	console.log('Buttons: a key release activates only its own press, once')
	assert.deepEqual(errors, [])
} finally {
	await browser.close()
	await new Promise(resolve => server.close(resolve))
}
