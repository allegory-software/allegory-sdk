import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const www = path.resolve(here, '../../www')
let plan_file = path.join(here, 'test-plan.json')
let runs = 20, warmup = 3
let has_plan = false
for (let i = 2; i < process.argv.length; i++) {
	let arg = process.argv[i]
	if (arg == '--runs' || arg == '--warmup') {
		let n = Number(process.argv[++i])
		if (!Number.isInteger(n) || n < (arg == '--runs' ? 1 : 0))
			throw Error(`Invalid ${arg}`)
		if (arg == '--runs')
			runs = n
		else
			warmup = n
	} else if (arg == '--help') {
		console.log('node tests/house_plan_bench/bench.mjs [plan.json]'
			+ ' [--runs 20] [--warmup 3]')
		process.exit(0)
	} else if (arg.startsWith('--') || has_plan) {
		throw Error(`Unexpected argument: ${arg}`)
	} else {
		plan_file = path.resolve(arg)
		has_plan = true
	}
}
const plan_text = await fs.readFile(plan_file, 'utf8')
const plan = JSON.parse(plan_text)
if (!plan.floors?.length)
	throw Error('Expected a house plan JSON object with at least one floor')

const server = http.createServer(async function(req, res) {
	try {
		let url = new URL(req.url, 'http://localhost').pathname
		let file
		if (url == '/')
			file = path.join(here, 'bench.html')
		else if (url == '/bench.js')
			file = path.join(here, 'bench.js')
		else if (url.startsWith('/www/')) {
			file = path.resolve(www, '.' + decodeURIComponent(url.slice(4)))
			if (!file.startsWith(www + path.sep))
				throw Error('Invalid path')
		} else {
			throw Error('Unknown path')
		}
		let data = await fs.readFile(file)
		res.setHeader('Content-Type', file.endsWith('.js')
			? 'text/javascript' : 'text/html')
		res.end(data)
	} catch {
		res.statusCode = 404
		res.end()
	}
})

const stages = [
	['total.wall', 'Wall time (includes frame scheduling and GPU wait)'],
	['frame_time', 'Frame CPU (inclusive)'],
	['frame_hit_time', '  Hit testing'],
	['frame_make_time', '  Build widgets (includes plan/model work)'],
	['frame_layout_time', '  Layout and preparation'],
	['frame_draw_time', '  Draw widgets (includes 2D/3D draw)'],
	['plan.parse', 'Parse input JSON (outside frame)'],
	['plan.load', 'Plan loading (graph, offsets, objects)'],
	['graph.fix', 'Graph fix (inclusive, all calls)'],
	['graph.cleanup', '  Split, deduplicate and merge walls'],
	['graph.components', '  Find connected components'],
	['graph.cycles', '  Extract cycles and initial area positions'],
	['graph.nesting', '  Find component nesting and islands'],
	['plan.offsets', 'Wall offsets and bounds'],
	['plan.rooms', 'Classify open-room tags'],
	['plan.snap_lines', 'Rebuild house snap lines'],
	['plan.objects', 'Place floor objects'],
	['wall.openings', 'Wall outlines and opening cuts'],
	['roof.areas', 'Roof areas'],
	['roof.faces', 'Roof faces'],
	['prism.build', 'Prism construction (includes roofs/openings)'],
	['prism.union', 'Prism union (inclusive)'],
	['prism.cuts', '  Cut and split regions'],
	['prism.snap', '  Snap paths'],
	['prism.cells', '  Overlay cells'],
	['prism.surfaces', '  Top/bottom surfaces'],
	['prism.sides', '  Side surfaces'],
	['prism.merge', '  Merge and lift faces'],
	['model.create', 'Model components, points, faces'],
	['model.update', 'Model update (includes buffer uploads)'],
	['webgl.upload', 'WebGL buffer calls (nested CPU time)'],
	['plan.draw', '2D drawing'],
	['model.draw', '3D render and canvas blit'],
	['gpu.wait', 'GPU completion wait after frame'],
]

const wall_stages = [
	['wall.drag', 'Current wall-drag step'],
	['drag.plan.offsets', '  Wall offsets and bounds'],
	['drag.plan.rooms', '  Classify open-room tags'],
	['wall.refresh', 'Additional full floor fix (inclusive)'],
	['refresh.graph.cleanup', '  Split, deduplicate and merge walls'],
	['refresh.graph.components', '  Find connected components'],
	['refresh.graph.cycles', '  Extract cycles and initial area positions'],
	['refresh.graph.nesting', '  Find component nesting and islands'],
	['refresh.plan.offsets', '  Wall offsets and bounds (second pass)'],
	['refresh.plan.rooms', '  Classify open-room tags'],
	['refresh.plan.snap_lines', '  Rebuild house snap lines'],
	['refresh.plan.objects', '  Place floor objects'],
	['wall.room_areas', 'Room centers and areas, all floors'],
	['wall.roof_areas', 'Roof/terrace areas, all floors'],
	['wall.total', 'Total drag + full fix + room and roof areas'],
]

function percentile(values, p) {
	values.sort((a, b) => a - b)
	return values[Math.ceil(values.length * p) - 1]
}

function report_times(name, samples, rows) {
	console.log(`\n${name} (${samples.length} samples; milliseconds)`)
	console.log('Stage'.padEnd(55) + 'Median'.padStart(10)
		+ 'p95'.padStart(10) + 'Max'.padStart(10)
		+ 'Calls/median'.padStart(14))
	for (let [key, label] of rows) {
		let values = [], calls = []
		for (let sample of samples) {
			values.push(sample.times[key] ?? 0)
			calls.push(sample.calls[key] ?? 0)
		}
		let median = percentile(values, .5)
		let p95 = percentile(values, .95)
		let max = values[values.length - 1]
		console.log(label.padEnd(55) + median.toFixed(3).padStart(10)
			+ p95.toFixed(3).padStart(10) + max.toFixed(3).padStart(10)
			+ String(percentile(calls, .5)).padStart(14))
	}
}

function report(name, samples) {
	report_times(name, samples, stages)
	for (let key of ['uploaded_bytes', 'allocated_bytes']) {
		let values = []
		for (let sample of samples)
			values.push(sample[key])
		console.log(`${key}: median ${percentile(values, .5)}`)
	}
	let calls = []
	for (let sample of samples)
		calls.push(sample.calls['webgl.upload'] ?? 0)
	console.log(`buffer calls: median ${percentile(calls, .5)}`)
}

let browser
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
	browser = await chromium.launch({
		channel: 'chrome', headless: true, args: ['--enable-gpu'],
	})
	const page = await browser.newPage({viewport: {width: 1600, height: 900}})
	page.setDefaultTimeout(120000)
	let errors = []
	let reject_error
	function on_error(message) {
		errors.push(message)
		if (reject_error)
			reject_error(Error(message))
	}
	page.on('pageerror', e => on_error(e.stack ?? e.message))
	page.on('console', message => {
		if (message.type() == 'error')
			on_error(message.text())
	})
	async function evaluate(fn, arg) {
		if (errors.length)
			throw Error(errors.join('\n'))
		let timeout
		let failure = new Promise((resolve, reject) => {
			reject_error = reject
			timeout = setTimeout(() => reject(Error('Frame timed out')),
				120000)
		})
		try {
			return await Promise.race([page.evaluate(fn, arg), failure])
		} finally {
			reject_error = null
			clearTimeout(timeout)
		}
	}
	await page.goto(`http://127.0.0.1:${server.address().port}/`)
	await page.waitForFunction(() => !!window.house_plan_bench)
	await evaluate(text => house_plan_bench.load(text), plan_text)
	const run = reload => evaluate(reload =>
		house_plan_bench.run(reload), reload)
	console.log(`Plan: ${plan_file}`)
	console.log(`Chrome: ${browser.version()}`)
	let first_load_sample = await run(true)
	let info = await evaluate(() => house_plan_bench.info())
	console.log(JSON.stringify(info, null, 2))
	report('First load (includes editor/context setup)', [first_load_sample])
	for (let i = 0; i < warmup; i++)
		await run(true)
	let load_samples = [], redraw_samples = []
	for (let i = 0; i < runs; i++) {
		load_samples.push(await run(true))
		redraw_samples.push(await run(false))
	}
	if (errors.length)
		throw Error(errors.join('\n'))
	for (let sample of [first_load_sample, ...load_samples, ...redraw_samples])
		if (!sample.calls.frame_time)
			throw Error('Frame CPU timing was not recorded')
	for (let sample of [first_load_sample, ...load_samples])
		if (!sample.calls['plan.load'] || !sample.calls['prism.union']
			|| !sample.calls['model.create'])
			throw Error('A full reload did not rebuild the plan and model')
	for (let sample of redraw_samples)
		if (sample.calls['plan.load'] || sample.calls['wall.openings']
			|| sample.calls['prism.union'] || sample.calls['model.create'])
			throw Error('An unchanged frame rebuilt geometry')
	report(`Full reload, existing editors; ${warmup} warmup loads`, load_samples)
	report('Unchanged frame', redraw_samples)
	for (let i = 0; i < warmup; i++)
		await evaluate(() => house_plan_bench.run_wall())
	let wall_samples = []
	for (let i = 0; i < runs; i++)
		wall_samples.push(await evaluate(() => house_plan_bench.run_wall()))
	for (let sample of wall_samples) {
		if (sample.calls['drag.plan.offsets'] != 1
			|| sample.calls['drag.graph.cycles']
			|| sample.calls['refresh.graph.fix'] != 1
			|| sample.calls['refresh.graph.cleanup'] != 1
			|| sample.calls['refresh.graph.components'] != 1
			|| sample.calls['refresh.graph.cycles'] != 1
			|| sample.calls['refresh.graph.nesting'] != 1
			|| sample.calls['refresh.plan.offsets'] != 1
			|| sample.calls['areas.roof.areas'] != info.floors)
			throw Error('Wall-update stages were not recorded as expected')
		if (!Number.isFinite(sample.room_area_sum))
			throw Error('Room-area calculation returned a nonfinite total')
	}
	let wall = wall_samples[0]
	console.log('\nWall-update input and graph counts:')
	console.log(JSON.stringify({wall: wall.wall, before: wall.before,
		after_drag: wall.after_drag, after_refresh: wall.after_refresh,
		room_count: wall.room_count, area_count: wall.area_count}, null, 2))
	report_times('Wall update, model CPU only; fresh model per sample',
		wall_samples, wall_stages)
	console.log('Setup and drag start excluded; no editor frame or GPU work.')
	console.log('Full fix is additional work after the current drag step;')
	console.log('the combined total includes wall offsets twice.')
	console.log('Wall-path clipping, roof faces and 3D rebuilding excluded.')
	console.log('\nTimings are inclusive; do not add nested rows.')
	console.log('GPU wait covers all pending frame work, not uploads alone.')
} finally {
	if (browser)
		await browser.close()
	await new Promise(resolve => server.close(resolve))
}
