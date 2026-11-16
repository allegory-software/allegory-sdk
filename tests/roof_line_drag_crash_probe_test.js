// run: node tests/roof_line_drag_crash_probe_test.js
// investigation: drags every line between two roof faces of a few houses
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
	'clipper2.js', 'prism_union.js', 'house_plan.js']) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
let log = console.log.bind(console)
let rect = (x, y, w, h) => ['draw', x, y, w, 0, 0, h, -w, 0, 0, -h]
let L = ['draw', 0, 0, 800, 0, 0, 300, -400, 0, 0, 400, -400, 0, 0, -700]
let shapes = {
	rect: [[rect(0, 0, 600, 400)]],
	L: [[L]],
	two: [[rect(0, 0, 800, 600)], [rect(0, 0, 400, 600)]],
	twoL: [[L], [rect(0, 0, 400, 300)]],
}
let errs = {}
let n_moves = 0
for (let name in shapes) {
	let house = ctx.house_plan({floors: shapes[name].map(lines => ({lines}))})
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
		for (let [k, l] of pairs) {
			for (let fr of [.3, .7]) {
				let x0 = l.p[0] + fr * (l.q[0] - l.p[0])
				let y0 = l.p[1] + fr * (l.q[1] - l.p[1])
				let [a, b, c] = l.face1.plane
				let z = a * x0 + b * y0 + c
				if (!f.can_move_line(l.face1, l.face2, z)) continue
				for (let dy = -300; dy <= 300; dy += 50)
					for (let dx = -300; dx <= 300; dx += 50) {
						let m = f.start_move_line(l.face1, l.face2, z)
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
							errs[key].push([name, f.i, k, fr, dx, dy, pitches])
						}
						m.cancel()
					}
			}
		}
	}
}
log('moves', n_moves)
for (let k in errs) { let es = errs[k].slice().sort((a, b) => Math.max(...a[6].filter(p => p != 90)) - Math.max(...b[6].filter(p => p != 90))); for (let e of es.slice(0, 8)) log(JSON.stringify(e)) }
