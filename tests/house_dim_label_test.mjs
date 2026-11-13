// run: node tests/house_dim_label_test.mjs
// measures where dimension labels are drawn in the floor editor demo: how far
// each label's text center is from the center of its dimension line, along
// and across the line, in screen pixels.
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const types = {'.js': 'application/javascript', '.html': 'text/html',
	'.css': 'text/css', '.woff2': 'font/woff2'}
const server = http.createServer(async (req, res) => {
	try {
		let url = new URL(req.url, 'http://x').pathname
		let file = path.join(root, url)
		res.setHeader('Content-Type', types[path.extname(file)] ?? 'text/plain')
		res.end(await fs.readFile(file))
	} catch (err) {
		res.writeHead(404).end()
	}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

function record_labels() {
	window.__labels = []
	let proto = CanvasRenderingContext2D.prototype
	let cur = [] // [[x, y, transform], ...]: moveTo points of the current path
	let last_stroke = null // screen points of the last stroked path
	let move_to = proto.moveTo
	proto.moveTo = function(x, y) {
		cur.push([x, y, this.getTransform()])
		return move_to.call(this, x, y)
	}
	let begin_path = proto.beginPath
	proto.beginPath = function() { cur = []; return begin_path.call(this) }
	let stroke = proto.stroke
	proto.stroke = function() {
		last_stroke = cur.map(([x, y, m]) => {
			let p = m.transformPoint({x, y})
			return [p.x, p.y]
		})
		return stroke.call(this)
	}
	let fill_text = proto.fillText
	proto.fillText = function(s, x, y) {
		if (/^\d[\d.,k]*m$/.test(s) && last_stroke && last_stroke.length == 6) {
			let w = this.measureText(s).width
			let p = this.getTransform().transformPoint({x: x + w / 2, y})
			window.__labels.push({
				s, align: this.textAlign, center: [p.x, p.y],
				line: [last_stroke[0], last_stroke[3]], // line start, line end
			})
		}
		return fill_text.call(this, s, x, y)
	}
}

let browser
let failed = false
try {
	browser = await chromium.launch({channel: 'chrome', headless: true})
	for (let [dsf, rotations] of [[1, 0], [1.5, 0], [1, 1], [1, 2]]) {
		const page = await browser.newPage({
			viewport: {width: 1200, height: 800}, deviceScaleFactor: dsf})
		const errors = []
		page.on('pageerror', err => errors.push(err.message))
		await page.addInitScript(record_labels)
		await page.goto(`http://127.0.0.1:${server.address().port}`
			+ '/www/ui-demo.html?demo=floor_editor')
		await page.waitForFunction(() => ui._frame_drawn)
		const frame = async () => {
			const n = await page.evaluate(() => {
				const n = ui._build_no()
				ui.animate()
				return n
			})
			await page.waitForFunction(n => ui._build_no() > n, n)
		}
		const click = async id => {
			const pt = await page.evaluate(id => {
				ui._point_at(id)
				return [ui.local_pointer.mx / devicePixelRatio,
					ui.local_pointer.my / devicePixelRatio]
			}, id)
			await page.mouse.click(pt[0], pt[1])
			await frame()
			await frame()
		}
		await frame()
		await frame()
		await click('floor_editor_demo.dims_button')
		for (let i = 0; i < rotations; i++)
			await click('floor_editor_demo.rotate_button')
		await page.evaluate(() => { window.__labels.length = 0 })
		await frame()
		const labels = await page.evaluate(() => window.__labels)
		let max_along = 0
		let max_perp = 0
		for (let l of labels) {
			let [a, b] = l.line
			let dx = b[0] - a[0]
			let dy = b[1] - a[1]
			let len = Math.hypot(dx, dy)
			let cx = l.center[0] - (a[0] + b[0]) / 2
			let cy = l.center[1] - (a[1] + b[1]) / 2
			max_along = Math.max(max_along, Math.abs((cx*dx + cy*dy) / len))
			// the label anchor is its baseline, so the text center is 5px
			// from it across the line: only the deviation from 5 matters.
			let perp = Math.abs((-cx*dy + cy*dx) / len)
			max_perp = Math.max(max_perp, Math.abs(perp - 5))
		}
		if (dsf == 1 && !rotations) {
			// line2.offset(-10) puts a dimension line inside a room cycle and
			// outside an outer cycle: the same sign serves both.
			const sides = await page.evaluate(() => {
				let plan = ui._state_map.get('floor_editor_demo').floor
				let inside = (pts, x, y) => {
					let r = false
					for (let i = 0, j = pts.length-1; i < pts.length; j = i++) {
						let [xi, yi] = pts[i]
						let [xj, yj] = pts[j]
						if ((yi > y) != (yj > y)
								&& x < (xj-xi)*(y-yi)/(yj-yi) + xi)
							r = !r
					}
					return r
				}
				let res = [] // [{outer, n, inside_n}, ...]
				for (let co of plan.comps)
					for (let c of co.cycles) {
						let pts = [...c.edges].map(ep => [ep[0], ep[1]])
						let n = pts.length
						let inside_n = 0 // edges whose offset line is inside
						for (let i = 0; i < n; i++) {
							let [x1, y1] = pts[i]
							let [x2, y2] = pts[(i+1) % n]
							let [a, b, c2, e] = Math3D.line2.offset(
								-10, x1, y1, x2, y2)
							if (inside(pts, (a + c2) / 2, (b + e) / 2))
								inside_n++
						}
						res.push({outer: !!c.outer, n, inside_n})
					}
				return res
			})
			for (let c of sides)
				if (c.inside_n != (c.outer ? 0 : c.n)) {
					console.log('offset(-10) side is wrong for', c)
					failed = true
				}
		}
		console.log('dpr', dsf, 'rotations', rotations, labels.length,
			'labels, max offset along the line', max_along.toFixed(2),
			'across', max_perp.toFixed(2), 'errors', errors)
		if (!labels.length || max_along > 1)
			failed = true
		await page.close()
	}
} finally {
	await browser?.close()
	server.close()
}
if (failed)
	process.exit(1)
