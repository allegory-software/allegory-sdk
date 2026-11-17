// run: node tests/roof_line_drag_crash_probe_test.js
// investigation: drags every line between two roof faces, and every point
// where three or more faces meet, of a few houses
// (lean-to against an upper floor, L-shapes) to points on a grid around the
// grab and builds the house model. prints each drag where make_faces()
// fails, with the error and the pitches of the roof's edge points.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const sdk = path.resolve(__dirname, '..')
const ctx = {console: {...console, log() {}, group() {}, groupCollapsed() {}, groupEnd() {}},
	setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, URLSearchParams, performance, Intl,
	atob, btoa, queueMicrotask, ui: {keypressed: k => false}}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
for (let name of ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js', 'roof_skeleton.js',
	'clipper2.js', 'prism_union.js', 'house_plan_objects.js',
	'house_plan.js']) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
let log = console.log.bind(console)
let rect = (x, y, w, h) => ['draw', x, y, w, 0, 0, h, -w, 0, 0, -h]
let L = ['draw', 0, 0, 8000, 0, 0, 3000, -4000, 0, 0, 4000, -4000, 0, 0, -7000]
let shapes = {
	rect: [[rect(0, 0, 6000, 4000)]],
	L: [[L]],
	two: [[rect(0, 0, 8000, 6000)], [rect(0, 0, 4000, 6000)]],
	twoL: [[L], [rect(0, 0, 4000, 3000)]],
}
let errs = {}
let n_moves = 0
for (let name in shapes) {
	let house = ctx.house_plan({version: 1,
		floors: shapes[name].map(lines => ({lines}))})
	let top = house.floors[house.floors.length-1]
	for (let f of house.floors) {
		let wall_z = f.z + f.h
		let lines = []
		let faces = f.make_roof_faces(f.make_areas(), [], lines)
		// distinct face pairs
		let pairs = new Map()
		for (let l of lines) {
			let k = faces.indexOf(l.face1) + ' ' + faces.indexOf(l.face2)
			if (!pairs.has(k)) pairs.set(k, l)
		}
		// grabs: two points on each line, and each point where three or more
		// faces meet (ridge ends, peaks), as the editor hits them.
		let grabs = [] // [{k, faces, x0, y0, z}, ...]
		for (let [k, l] of pairs) {
			for (let fr of [.3, .7]) {
				let x0 = l.p[0] + fr * (l.q[0] - l.p[0])
				let y0 = l.p[1] + fr * (l.q[1] - l.p[1])
				let [a, b, c] = l.face1.plane
				grabs.push({k: k + ' ' + fr, faces: [l.face1, l.face2],
					x0, y0, z: a * x0 + b * y0 + c})
			}
		}
		let near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3
		for (let l0 of lines)
			for (let p of [l0.p, l0.q]) {
				let ps = []
				for (let l of lines)
					if (near(p, l.p) || near(p, l.q))
						for (let face of [l.face1, l.face2])
							if (!ps.includes(face)) ps.push(face)
				let k = 'point ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)
				if (ps.length >= 3 && !grabs.some(g => g.k == k))
					grabs.push({k, faces: ps, x0: p[0], y0: p[1], z: p[2]})
			}
		for (let {k, faces, x0, y0, z} of grabs) {
			if (!f.can_move_faces(faces, z)) continue
			for (let dy = -3000; dy <= 3000; dy += 3000)
				for (let dx = -3000; dx <= 3000; dx += 3000) {
					let m = f.start_move_faces(faces, z)
					n_moves++
					if (!m.move(x0 + dx, y0 + dy)) { m.cancel(); continue }
					let pitches = f.roof.edge_points.map(p => +p.pitch.toFixed(2))
					try {
						let sides = [], ls = []
						f.make_roof_faces(f.make_areas(), sides, ls)
						house.make_faces(top, false)
					} catch (err) {
						let key = err.message
						errs[key] ??= []
						errs[key].push([name, f.i, k, dx, dy, pitches])
					}
					m.cancel()
				}
		}
	}
}
log('moves', n_moves)
for (let k in errs) { let es = errs[k].slice().sort((a, b) => Math.max(...a[5].filter(p => p != 90)) - Math.max(...b[5].filter(p => p != 90))); for (let e of es.slice(0, 8)) log(JSON.stringify(e)) }
