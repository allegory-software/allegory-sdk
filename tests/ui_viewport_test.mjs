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
		window.probe = {scroll_x: 0, scroll_y: 0, prior_w: null}
		ui.main = function() {
			probe.prior_w = ui.state_of('outer.viewport', 'w')
			ui.measure_viewport('screen.viewport')
			ui.m(40, 30, 0, 0)
			ui.min_wh(200, 150)
			ui.sb('outer', 0, 'auto', 'auto', 'l', 't',
				probe.scroll_x, probe.scroll_y)
				ui.measure('outer.box')
				ui.measure_viewport('outer.viewport')
				ui.min_wh(600, 500)
				ui.stack('', 0, 'l', 't')
					ui.m(150, 100, 0, 0)
					ui.min_wh(100, 100)
					ui.sb('inner', 0, 'auto', 'auto', 'l', 't', 10, 20)
						ui.measure('inner.box')
						ui.measure_viewport('inner.viewport')
						ui.min_wh(300, 300)
						ui.stack('', 0, 'l', 't')
							ui.measure_viewport('inner.content.viewport')
						ui.end_stack()
					ui.end_sb()
					ui.measure_viewport('after_inner.viewport')
					ui.min_wh(160, 120)
					ui.popup('popup', 'open', 'screen', 'it', '[', '',
						0, 320, 220)
						ui.measure('popup.box')
						ui.measure_viewport('popup.viewport')
						ui.min_wh(70, 60)
						ui.sb('popup.sb', 0, 'auto', 'auto', 'l', 't')
							ui.measure('popup.sb.box')
							ui.measure_viewport('popup.sb.viewport')
							ui.min_wh(140, 120)
							ui.stack('', 0, 'l', 't')
							ui.end_stack()
						ui.end_sb()
					ui.end_popup()
					ui.measure_viewport('after_popup.viewport')
					ui.start_recording()
						ui.stack('', 0, 'l', 't')
							ui.measure_viewport('recorded.viewport')
						ui.end_stack()
					let recording = ui.end_recording()
					ui.play_recording(recording)
					let rec_i = ui.create_rec_box() // recording index
					ui.open_rec_box(rec_i)
						ui.stack('', 0, 'l', 't')
							ui.measure_viewport('rec_box.viewport')
						ui.end_stack()
					ui.close_rec_box()
					ui.rec_box(rec_i, 0, 'l', 't')
				ui.end_stack()
			ui.end_sb()
			ui.measure_viewport('after_outer.viewport')
			ui.m(320, 30, 0, 0)
			ui.min_wh(180, 120)
			ui.sb('frame.sb', 0, 'auto', 'auto', 'l', 't')
				ui.measure('frame.sb.box')
				ui.frame(() => 400, function() {
					ui.measure_viewport('frame.viewport')
					ui.measure('frame.box')
				}, 0, 'l', 't')
			ui.end_sb()
			ui.measure_viewport('after_frame.viewport')
			ui.m(900, 700, 0, 0)
			ui.min_wh(100, 100)
			ui.sb('offscreen.sb', 0, 'auto', 'auto', 'l', 't')
				ui.measure_viewport('offscreen.viewport')
			ui.end_sb()
		}
		ui.animate()
	})
	await page.waitForTimeout(150)
	async function read() {
		return page.evaluate(() => {
			let rects = {} // measurement ID -> rectangle
			for (let [id, s] of ui._state_map)
				if (id.endsWith('.viewport') || id.endsWith('.box'))
					rects[id] = [s.x, s.y, s.w, s.h]
			return {rects, prior_w: probe.prior_w}
		})
	}
	let result = await read()
	const screen = [0, 0, 800, 600]
	const outer = [40, 30, 200, 150]
	const inner = [190, 130, 50, 50]
	for (let id of ['screen', 'after_outer', 'after_frame', 'popup'])
		assert.deepEqual(result.rects[id+'.viewport'], screen, id)
	for (let id of [
		'outer', 'after_inner', 'after_popup', 'recorded', 'rec_box',
	])
		assert.deepEqual(result.rects[id+'.viewport'], outer, id)
	assert.deepEqual(result.rects['outer.box'], outer)
	assert.deepEqual(result.rects['inner.box'], [190, 130, 100, 100])
	assert.deepEqual(result.rects['inner.viewport'], inner)
	assert.deepEqual(result.rects['inner.content.viewport'], inner)
	assert.deepEqual(result.rects['popup.sb.viewport'],
		result.rects['popup.sb.box'])
	assert.deepEqual(result.rects['frame.viewport'], [320, 30, 180, 120])
	assert.deepEqual(result.rects['offscreen.viewport'].slice(2), [0, 0])
	await page.evaluate(() => {
		probe.scroll_x = 60
		probe.scroll_y = 40
		ui.animate()
	})
	await page.waitForTimeout(100)
	result = await read()
	assert.equal(result.prior_w, 200)
	assert.deepEqual(result.rects['outer.viewport'], outer)
	assert.deepEqual(result.rects['inner.viewport'], [130, 90, 100, 90])
	assert.deepEqual(result.rects['popup.viewport'], screen)
	await page.setViewportSize({width: 640, height: 480})
	await page.waitForTimeout(150)
	result = await read()
	assert.deepEqual(result.rects['screen.viewport'], [0, 0, 640, 480])
	assert.deepEqual(result.rects['popup.viewport'], [0, 0, 640, 480])
	assert.deepEqual(result.rects['outer.viewport'], outer)
	assert.deepEqual(errors, [])
	console.log('Viewport browser probes passed.')
} finally {
	await browser.close()
	await new Promise(resolve => server.close(resolve))
}
