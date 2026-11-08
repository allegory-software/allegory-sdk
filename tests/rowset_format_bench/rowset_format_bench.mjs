import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {gunzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dir = await fs.mkdtemp(os.tmpdir()+'/rowset-format-bench-')
const median = a => [...a].sort((a, b) => a - b)[a.length >> 1]
let browser
const server = http.createServer(async (req, res) => {
	try {
		if (req.url == '/probe.html') {
			res.setHeader('Content-Type', 'text/html')
			res.end('<!doctype html><script src="glue.js" global></script>'
				+ '<script src="ui.js"></script>'
				+ '<script src="ui_field.js"></script>'
				+ '<script src="ui_nav.js"></script>'
				+ '<script>ui.main = function() {}</script>')
		} else {
			res.setHeader('Content-Type', 'application/javascript')
			res.end(await fs.readFile(root+'www'+req.url))
		}
	} catch {
		res.writeHead(404).end()
	}
})
try {
	const lua = spawnSync(root+'bin/luajit', ['-joff', '-lscite',
		root+'tests/rowset_format_bench.lua', dir,
		process.argv.includes('--batch') ? 'batch_json' : ''],
		{cwd: root, encoding: 'utf8'})
	process.stderr.write(lua.stderr)
	assert.equal(lua.status, 0, lua.stdout)
	const cases = JSON.parse(await fs.readFile(dir+'/server.json', 'utf8'))
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
	browser = await chromium.launch({channel: 'chrome', headless: true})
	console.log('Chromium '+browser.version())
	for (const c of cases) {
		const page = await browser.newPage()
		const errors = []
		page.on('pageerror', e => errors.push(e.message))
		await page.goto(`http://127.0.0.1:${server.address().port}/probe.html`)
		await page.waitForFunction(() => ui._frame_drawn)
		const texts = {}
		const formats = Object.keys(c.samples)
		const samples = {}
		const gzip_sizes = {}
		for (const format of formats) {
			texts[format] = await fs.readFile(
				dir+'/'+c.name+'_'+format+'.json', 'utf8')
			const compressed = await fs.readFile(
				dir+'/'+c.name+'_'+format+'.json.gz')
			assert.equal(gunzipSync(compressed).toString(), texts[format])
			gzip_sizes[format] = compressed.length
			samples[format] = []
		}
		const rows = JSON.parse(texts.rows)
		const cols = JSON.parse(texts.col_vals)
		if (texts.batch_rows) {
			assert.deepEqual(JSON.parse(texts.batch_rows), rows)
			assert.deepEqual(JSON.parse(texts.batch_col_vals), cols)
		}
		assert.deepEqual(rows.fields, cols.fields)
		for (let ri = 0; ri < c.n; ri++) {
			for (let fi = 0; fi < rows.fields.length; fi++)
				assert.deepEqual(rows.rows[ri][fi], cols.col_vals[fi][ri])
		}
		for (let iteration = 0; iteration < 11; iteration++) {
			for (let i = 0; i < formats.length; i++) {
				const format = formats[(i + iteration) % formats.length]
				const sample = await page.evaluate(({text, id, n}) =>
					new Promise((resolve, reject) => {
						ui.main = function() {
							try {
								const nav = ui.nav(id)
								const t0 = performance.now()
								const rs = JSON.parse(text)
								const t1 = performance.now()
								nav.load(rs)
								const t2 = performance.now()
								if (nav.row_n != n || nav.visible_n != n)
									throw Error('incorrect nav row count')
								for (let fi = 0; fi < rs.fields.length; fi++) {
									const vals = rs.col_vals?.[fi]
									for (let ri of [0, n >> 1, n - 1]) {
										const v = vals ? vals[ri] : rs.rows[ri][fi]
										if (nav.cell_input_val(ri, fi) !== v)
											throw Error('incorrect nav value')
									}
								}
								resolve({parse_ms: t1 - t0, nav_ms: t2 - t1,
									client_ms: t2 - t0})
							} catch (error) {
								reject(error)
							}
							ui.main = function() {}
						}
						ui.animate()
					}), {text: texts[format],
						id: 'bench_'+iteration+'_'+format, n: c.n})
				if (iteration >= 2) samples[format].push(sample)
			}
		}
		assert.deepEqual(errors, [])
		for (const format of formats) {
			const r = {name: c.name, format,
				bytes: Buffer.byteLength(texts[format]),
				gzip_level: 1, gzip_bytes: gzip_sizes[format]}
			for (const key of ['load_ms', 'encode_ms', 'gzip_ms'])
				r[key] = median(c.samples[format].map(s => s[key]))
			for (const key of ['parse_ms', 'nav_ms', 'client_ms'])
				r[key] = median(samples[format].map(s => s[key]))
			const stages = ['load_ms', 'encode_ms', 'gzip_ms',
				'parse_ms', 'nav_ms']
			r.total_ms = 0
			for (const key of stages) r.total_ms += r[key]
			r.percentages = {}
			for (const key of stages)
				r.percentages[key] = r[key] / r.total_ms * 100
			r.gzip_reduction_pct = (1 - r.gzip_bytes / r.bytes) * 100
			console.log(JSON.stringify(r))
		}
		await page.close()
	}
} finally {
	if (browser) await browser.close()
	if (server.listening)
		await new Promise(resolve => server.close(resolve))
	await fs.rm(dir, {recursive: true, force: true})
}
