import {createServer} from 'node:http'
import {spawn} from 'node:child_process'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {extname, join, normalize} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const bench_dir = fileURLToPath(new URL('.', import.meta.url))
const project_dir = normalize(join(bench_dir, '..', '..', '..'))
const ui_js_path = join(project_dir, 'www/ui.js')

const browser_arg = process.argv[2] || 'both'
const sequence = process.argv[3]
	|| 'baseline,no_text_clip,baseline,truncate_clip,truncate_no_clip,baseline,max_width,baseline'
const repeats = +(process.argv[4] || 1)
const warmup_n = +(process.argv[5] || 20)
const sample_n = +(process.argv[6] || 80)
const col_n = +(process.argv[7] || 25)
const text_mode = process.argv[8] || 'long'
const scrolling = process.argv[9] == 'scroll'
const interleave = process.argv[10] == 'interleave'
const font_name = process.argv[11] || 'Arial'

const browsers = browser_arg == 'both' ? ['chrome', 'firefox'] : [browser_arg]
const result_waiters = new Map()

function content_type(path) {
	return {
		'.html': 'text/html; charset=utf-8',
		'.js': 'text/javascript; charset=utf-8',
		'.woff2': 'font/woff2',
		'.svg': 'image/svg+xml',
	}[extname(path)] || 'application/octet-stream'
}

function replace_once(source, search, replacement) {
	let i = source.indexOf(search)
	if (i == -1)
		throw new Error(`ui.js benchmark patch anchor not found: ${search}`)
	if (source.indexOf(search, i + search.length) != -1)
		throw new Error(`ui.js benchmark patch anchor is not unique: ${search}`)
	return source.slice(0, i) + replacement + source.slice(i + search.length)
}

async function instrumented_ui_js() {
	let source = await readFile(ui_js_path, 'utf8')
	const helper = String.raw`
// Benchmark-only text fitting. This source is generated in memory by
// js/tests/grid-bench/run_grid_text_bench.mjs; www/ui.js is never modified.
let bench_fit_text_cache = map()
let bench_ellipsis_widths = map()
let bench_atlas_entries = map()
let bench_atlas_pages = []
let bench_atlas_current_pages = obj()
let bench_word_runs_cache = map()
let bench_word_width_cache = map()
let bench_atlas_stats = G.BENCH_GRID_ATLAS_STATS = obj()
let bench_layout_phases = G.BENCH_GRID_LAYOUT_PHASES = obj()
let bench_layout_native_measure_n = 0
let bench_layout_native_measure_ms = 0
let bench_layout_depth = 0

const BENCH_ATLAS_SIZE = 2048

function bench_atlas_page(size) {
	let canvas = document.createElement('canvas')
	canvas.width = size
	canvas.height = size
	let page = {canvas: canvas, cx: canvas.getContext('2d'), size: size,
		x: 0, y: 0, row_h: 0}
	bench_atlas_pages.push(page)
	bench_atlas_current_pages[size] = page
	return page
}

function bench_atlas_entry(cx, s, w, asc, dsc, slot_w, source_offset) {
	let variant = G.BENCH_GRID_TEXT_VARIANT
	let key = variant+'\u0000'+cx.font+'\u0000'+cx.fillStyle+'\u0000'
		+(slot_w ?? '')+'\u0000'+(source_offset ?? '')+'\u0000'+s
	let entry = bench_atlas_entries.get(key)
	let stats = bench_atlas_stats[variant]
	if (!stats)
		stats = bench_atlas_stats[variant] = {draws: 0, misses: 0}
	stats.draws++
	if (entry)
		return entry
	stats.misses++

	let size = variant == 'atlas_small_crop'
			|| variant == 'atlas_words_small_crop'
			|| variant == 'atlas_slot_small_crop' ? 256 : BENCH_ATLAS_SIZE
	let ew = min(size, max(1, ceil(slot_w ?? w)))
	let eh = min(size, max(1, ceil(asc+dsc)))
	let page = bench_atlas_current_pages[size] || bench_atlas_page(size)
	if (page.x + ew > size) {
		page.x = 0
		page.y += page.row_h
		page.row_h = 0
	}
	if (page.y + eh > size)
		page = bench_atlas_page(size)

	entry = {page: page, x: page.x, y: page.y, w: ew, h: eh}
	page.cx.font = cx.font
	page.cx.fillStyle = cx.fillStyle
	page.cx.textAlign = 'left'
	page.cx.textBaseline = 'alphabetic'
	if (slot_w != null) {
		page.cx.save()
		page.cx.beginPath()
		page.cx.rect(entry.x, entry.y, entry.w, entry.h)
		page.cx.clip()
	}
	page.cx.fillText(s, entry.x - (source_offset ?? 0), entry.y + asc)
	if (slot_w != null)
		page.cx.restore()
	page.x += ew
	page.row_h = max(page.row_h, eh)
	bench_atlas_entries.set(key, entry)
	return entry
}

function bench_atlas_draw(cx, s, x, y, w, sx, sw, asc, dsc, crop) {
	let e = bench_atlas_entry(cx, s, w, asc, dsc)
	let dx1 = crop ? max(x, sx) : x
	let dx2 = crop ? min(x + e.w, sx + sw) : x + e.w
	let dw = dx2 - dx1
	if (dw <= 0)
		return
	let source_x = e.x + dx1 - x
	cx.drawImage(e.page.canvas, source_x, e.y, dw, e.h, dx1, y, dw, e.h)
}

function bench_atlas_draw_slot(cx, s, x, y, w, sx, sw, asc, dsc) {
	let dx1 = max(x, sx)
	let dx2 = min(x + w, sx + sw)
	let dw = dx2 - dx1
	if (dw <= 0)
		return
	let source_offset = dx1 - x
	let e = bench_atlas_entry(cx, s, w, asc, dsc, dw, source_offset)
	cx.drawImage(e.page.canvas, e.x, e.y, e.w, e.h, dx1, y, e.w, e.h)
}

function bench_atlas_draw_words(cx, s, x, y, sx, sw, asc, dsc) {
	let run_key = cx.font+'\u0000'+s
	let words = bench_word_runs_cache.get(run_key)
	if (!words) {
		words = s.match(/\S+\s*|\s+/g) || []
		bench_word_runs_cache.set(run_key, words)
	}
	let dx = x
	let right = sx + sw
	for (let word of words) {
		if (dx >= right)
			break
		let width_key = cx.font+'\u0000'+word
		let ww = bench_word_width_cache.get(width_key)
		if (ww == null) {
			ww = cx.measureText(word).width
			bench_word_width_cache.set(width_key, ww)
		}
		bench_atlas_draw(cx, word, dx, y, ww, sx, sw, asc, dsc, true)
		dx += ww
	}
}

function bench_ellipsis_width(cx) {
	let w = bench_ellipsis_widths.get(cx.font)
	if (w == null) {
		w = cx.measureText('\u2026').width
		bench_ellipsis_widths.set(cx.font, w)
	}
	return w
}
function bench_fit_text_binary(cx, s, sw) {
	// Keep variants independent so one truncation strategy cannot warm another's
	// cache during an interleaved comparison.
	let key = G.BENCH_GRID_TEXT_VARIANT+'\u0000'+cx.font+'\u0000'+sw+'\u0000'+s
	let fitted = bench_fit_text_cache.get(key)
	if (fitted != null)
		return fitted
	let ew = bench_ellipsis_width(cx)
	if (ew > sw)
		fitted = ''
	else {
		let lo = 0
		let hi = s.length
		while (lo < hi) {
			let mid = Math.ceil((lo + hi) / 2)
			if (cx.measureText(s.slice(0, mid)).width + ew <= sw)
				lo = mid
			else
				hi = mid - 1
		}
		fitted = s.slice(0, lo)+'\u2026'
	}
	bench_fit_text_cache.set(key, fitted)
	return fitted
}
function bench_fit_text_ratio(cx, s, sw, text_w) {
	let ew = bench_ellipsis_width(cx)
	let n = Math.max(0, Math.floor(s.length * Math.max(0, sw-ew) / text_w))
	return s.slice(0, n)+'\u2026'
}

`
	source = replace_once(source,
		'draw[CMD_TEXT] = function(a, i) {',
		helper+'draw[CMD_TEXT] = function(a, i) {')
	source = replace_once(source,
		'\tlet clip = w > sw',
		`\tlet clip = w > sw
\tlet bench_variant = G.BENCH_GRID_TEXT_VARIANT
\tif (clip && isstr(s)) {
\t\tif (bench_variant == 'truncate_clip' || bench_variant == 'truncate_no_clip')
\t\t\ts = bench_fit_text_binary(cx, s, sw)
\t\telse if (bench_variant == 'truncate_ratio_clip')
\t\t\ts = bench_fit_text_ratio(cx, s, sw, w)
\t\tif (bench_variant == 'no_text_clip'
\t\t\t\t|| bench_variant == 'truncate_no_clip'
\t\t\t\t|| bench_variant == 'max_width'
\t\t\t\t|| bench_variant == 'atlas_crop'
\t\t\t\t|| bench_variant == 'atlas_small_crop'
\t\t\t\t|| bench_variant == 'atlas_words_crop'
\t\t\t\t|| bench_variant == 'atlas_words_small_crop'
\t\t\t\t|| bench_variant == 'atlas_slot_crop'
\t\t\t\t|| bench_variant == 'atlas_slot_small_crop')
\t\t\tclip = false
\t}`)
	source = replace_once(source,
		'\t\tcx.fillText(s, x, y + asc)',
		`\t\tif (bench_variant == 'atlas_slot_crop'
				|| bench_variant == 'atlas_slot_small_crop')
			bench_atlas_draw_slot(cx, s, x, y, w, sx, sw, asc, dsc)
		else if (bench_variant == 'atlas_words_crop'
\t\t\t\t|| bench_variant == 'atlas_words_small_crop')
\t\t\tbench_atlas_draw_words(cx, s, x, y, sx, sw, asc, dsc)
\t\telse if (bench_variant == 'atlas_clip'
\t\t\t\t|| bench_variant == 'atlas_crop'
\t\t\t\t|| bench_variant == 'atlas_small_crop')
\t\t\tbench_atlas_draw(cx, s, x, y, w, sx, sw, asc, dsc,
\t\t\t\tbench_variant != 'atlas_clip')
\t\telse if (bench_variant == 'max_width' && w > sw)
\t\t\tcx.fillText(s, x, y + asc, sw)
\t\telse
\t\t\tcx.fillText(s, x, y + asc)`)
	source = replace_once(source,
		`function layout_rec(a, x, y, w, h) {
	reset_canvas()

	// x-axis
	measure_rec(a, 0)
	ct_stack_check()
	position_rec(a, 0, w)

	// y-axis
	measure_rec(a, 1)
	ct_stack_check()
	position_rec(a, 1, h)

	// reset scroll-to-view request if no scrollbox consumed it.
	scroll_to_view_i = null

	translate_rec(a, x, y)
}`,
		`function layout_rec(a, x, y, w, h) {
	let bench_t0 = clock_ms()
	let bench_root_layout = bench_layout_depth++ == 0
	if (bench_root_layout) {
		bench_layout_native_measure_n = 0
		bench_layout_native_measure_ms = 0
		bench_layout_phases.frame_make = 0
		bench_layout_phases.frame_layout = 0
	}
	reset_canvas()
	if (bench_root_layout)
		bench_layout_phases.reset = clock_ms() - bench_t0

	// x-axis
	bench_t0 = clock_ms()
	measure_rec(a, 0)
	ct_stack_check()
	if (bench_root_layout)
		bench_layout_phases.measure_x = clock_ms() - bench_t0
	bench_t0 = clock_ms()
	position_rec(a, 0, w)
	if (bench_root_layout)
		bench_layout_phases.position_x = clock_ms() - bench_t0

	// y-axis
	bench_t0 = clock_ms()
	measure_rec(a, 1)
	ct_stack_check()
	if (bench_root_layout)
		bench_layout_phases.measure_y = clock_ms() - bench_t0
	bench_t0 = clock_ms()
	position_rec(a, 1, h)
	if (bench_root_layout)
		bench_layout_phases.position_y = clock_ms() - bench_t0

	// reset scroll-to-view request if no scrollbox consumed it.
	scroll_to_view_i = null

	bench_t0 = clock_ms()
	translate_rec(a, x, y)
	if (bench_root_layout)
		bench_layout_phases.translate = clock_ms() - bench_t0
	bench_layout_depth--
}`)
	source = replace_once(source,
		'\t\tm = cx.measureText(s)',
		`\t\tlet bench_measure_t0 = clock_ms()
\t\tm = cx.measureText(s)
\t\tbench_layout_native_measure_n++
\t\tbench_layout_native_measure_ms += clock_ms() - bench_measure_t0`)
	source = replace_once(source,
		'\t\tregister_rec(a, 0)',
		`\t\tlet bench_register_t0 = clock_ms()
\t\tregister_rec(a, 0)
\t\tbench_layout_phases.register = clock_ms() - bench_register_t0
\t\tbench_layout_phases.native_measure_calls = bench_layout_native_measure_n
\t\tbench_layout_phases.native_measure_ms = bench_layout_native_measure_ms`)
	source = replace_once(source,
		'\t\t\ton_frame(a, i, x, y, w, h, cx, cy, cw, ch)',
		`\t\t\tlet bench_frame_make_t0 = clock_ms()
\t\t\ton_frame(a, i, x, y, w, h, cx, cy, cw, ch)
\t\t\tbench_layout_phases.frame_make += clock_ms() - bench_frame_make_t0`)
	source = replace_once(source,
		'\tlayout_rec(a1, x, y, w, h)',
		`\tlet bench_frame_layout_t0 = clock_ms()
\tlayout_rec(a1, x, y, w, h)
\tbench_layout_phases.frame_layout += clock_ms() - bench_frame_layout_t0`)
	return source
}

const bench_ui_js = await instrumented_ui_js()

const server = createServer(async (request, response) => {
	try {
		let url = new URL(request.url, 'http://127.0.0.1')
		if (process.env.BENCH_SERVER_LOG)
			process.stderr.write(`${request.method} ${url.pathname}\n`)
		if (url.pathname == '/bench-result' && request.method == 'POST') {
			let chunks = []
			for await (let chunk of request)
				chunks.push(chunk)
			let result_id = url.searchParams.get('result_id')
			let waiter = result_waiters.get(result_id)
			if (waiter)
				waiter.resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
			response.writeHead(204)
			response.end()
			return
		}
		if (url.pathname == '/bench-ui.js') {
			response.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'})
			response.end(bench_ui_js)
			return
		}
		let path = normalize(join(project_dir, decodeURIComponent(url.pathname)))
		if (!path.startsWith(project_dir)) {
			response.writeHead(403)
			response.end()
			return
		}
		let data = await readFile(path)
		response.writeHead(200, {'content-type': content_type(path)})
		response.end(data)
	} catch (error) {
		response.writeHead(error.code == 'ENOENT' ? 404 : 500)
		response.end(String(error))
	}
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
if (process.env.BENCH_SERVER_LOG)
	process.stderr.write(`benchmark server: http://127.0.0.1:${port}\n`)

function wait_for_result(result_id, timeout_ms = 180000) {
	let timeout_id
	let promise = new Promise((resolve, reject) => {
		timeout_id = setTimeout(() => {
			result_waiters.delete(result_id)
			reject(new Error(`timed out waiting for ${result_id}`))
		}, timeout_ms)
		result_waiters.set(result_id, {
			resolve(result) {
				clearTimeout(timeout_id)
				result_waiters.delete(result_id)
				resolve(result)
			},
		})
	})
	return promise
}

async function stop_process(child) {
	if (child.exitCode != null)
		return
	child.kill('SIGTERM')
	await Promise.race([
		new Promise(resolve => child.once('exit', resolve)),
		new Promise(resolve => setTimeout(resolve, 2000)),
	])
	if (child.exitCode == null)
		child.kill('SIGKILL')
}

async function run_browser(browser, repeat) {
	let result_id = `${browser}-${process.pid}-${repeat}`
	let profile = await mkdtemp(join(tmpdir(), `grid-text-${browser}-`))
	let url = new URL(
		`http://127.0.0.1:${port}/js/tests/grid-bench/grid_text.html`)
	url.searchParams.set('result_id', result_id)
	url.searchParams.set('sequence', sequence)
	url.searchParams.set('warmup', warmup_n)
	url.searchParams.set('samples', sample_n)
	url.searchParams.set('cols', col_n)
	url.searchParams.set('text', text_mode)
	url.searchParams.set('scroll', scrolling ? 1 : 0)
	url.searchParams.set('interleave', interleave ? 1 : 0)
	url.searchParams.set('font', font_name)
	if (process.env.BENCH_SERVER_LOG)
		url.searchParams.set('debug', 1)
	let command
	let args
	let env = process.env
	if (browser == 'chrome') {
		command = '/usr/bin/google-chrome'
		args = [
			'--headless=new', '--no-sandbox', `--user-data-dir=${profile}`,
			'--disable-background-networking', '--disable-component-update',
			'--disable-default-apps', '--disable-sync', '--metrics-recording-only',
			'--no-first-run', '--window-size=1366,825',
			'--force-device-scale-factor=1', url.href,
		]
	} else if (browser == 'firefox') {
		command = '/usr/bin/firefox'
		args = [
			'--headless', '--no-remote', '--new-instance', '--profile', profile,
			'--window-size=1920,1080', url.href,
		]
		env = {...process.env, MOZ_HEADLESS: '1'}
	} else {
		throw new Error(`unknown browser: ${browser}`)
	}
	let stderr = ''
	let child = spawn(command, args, {env, stdio: ['ignore', 'ignore', 'pipe']})
	child.stderr.on('data', data => {
		stderr += data
		if (process.env.BENCH_BROWSER_LOG)
			process.stderr.write(data)
	})
	try {
		let result = await Promise.race([
			wait_for_result(result_id),
			new Promise((_, reject) => child.once('exit', code =>
				reject(new Error(`${browser} exited ${code}: ${stderr}`)))),
		])
		let list = Array.isArray(result) ? result : [result]
		for (let item of list) {
			item.browser_name = browser
			item.repeat = repeat
			process.stdout.write(JSON.stringify(item)+'\n')
		}
		return list
	} catch (error) {
		throw new Error(`${error.message}${stderr ? `\n${stderr}` : ''}`)
	} finally {
		await stop_process(child)
		await rm(profile, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200,
		})
	}
}

try {
	for (let repeat = 1; repeat <= repeats; repeat++)
		for (let browser of browsers)
			await run_browser(browser, repeat)
} finally {
	await new Promise(resolve => server.close(resolve))
}
