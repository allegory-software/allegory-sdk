// run: node tests/roof_cross_closure_probe_test.js
// investigation: roofs of two floors that cross. drags every line between
// two roof faces of a few houses to points on a grid around the grab (as
// tests/roof_line_drag_crash_probe_test.js) and builds the house model.
// checks that the faces are closed within TOL grid units (default 25: where
// two roofs cross, clipper drops the step faces along the crease; their
// height grows with the slope: 21 units at 88.7 deg). env SDK=dir loads
// dir/www/prism_union.js instead (a changed copy). env STEP=d (default 100).
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const sdk = path.resolve(__dirname, '..')
const ctx = {
	console: {...console, log() {}, group() {}, groupCollapsed() {},
		groupEnd() {}},
	setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask,
	ui: {keypressed: k => false},
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
for (let name of ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js',
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js', 'house_plan.js']) {
	let dir = name == 'prism_union.js' && process.env.SDK || sdk
	let file = path.join(dir, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
const S = ctx.prism_union.grid_scale
let log = console.log.bind(console)


// length of the face edges that no edge of another face covers in the
// opposite direction, within tolerance d (plan units).
function uncovered_length(faces, d) {
	let segs = [] // [x1, y1, z1, x2, y2, z2, ...]
	for (let face of faces) {
		for (let ring of face.rings) {
			for (let i = 0; i < ring.length; i++) {
				let p = ring[i]
				let q = ring[(i+1) % ring.length]
				segs.push(p[0], p[1], p[2], q[0], q[1], q[2])
			}
		}
	}
	let total = 0
	let ivs = []
	for (let i = 0; i < segs.length; i += 6) {
		let x1 = segs[i+0], y1 = segs[i+1], z1 = segs[i+2]
		let dx = segs[i+3] - x1, dy = segs[i+4] - y1, dz = segs[i+5] - z1
		let len = Math.hypot(dx, dy, dz)
		if (!len)
			continue
		let ux = dx / len, uy = dy / len, uz = dz / len
		// distance from the point of the edge at t to the segment j.
		function seg_dist(t, j) {
			let px = x1 + t * ux, py = y1 + t * uy, pz = z1 + t * uz
			let ax = segs[j+0], ay = segs[j+1], az = segs[j+2]
			let bx = segs[j+3] - ax, by = segs[j+4] - ay, bz = segs[j+5] - az
			let s = ((px - ax) * bx + (py - ay) * by + (pz - az) * bz)
				/ (bx * bx + by * by + bz * bz)
			s = Math.max(0, Math.min(1, s))
			return Math.hypot(px - ax - s * bx, py - ay - s * by, pz - az - s * bz)
		}
		ivs.length = 0
		for (let j = 0; j < segs.length; j += 6) {
			if (j == i)
				continue
			// segment j runs the other way: its end, then its start.
			let t1 = (segs[j+3] - x1) * ux + (segs[j+4] - y1) * uy
				+ (segs[j+5] - z1) * uz
			let t2 = (segs[j+0] - x1) * ux + (segs[j+1] - y1) * uy
				+ (segs[j+2] - z1) * uz
			t1 = Math.max(t1, 0)
			t2 = Math.min(t2, len)
			if (t2 <= t1)
				continue
			// the distance is convex along the edge: keep the part within d
			// from an end within d.
			let is_near1 = seg_dist(t1, j) <= d
			let is_near2 = seg_dist(t2, j) <= d
			if (!is_near1 && !is_near2)
				continue
			if (is_near1 != is_near2) {
				let ta = t1
				let tb = t2
				for (let k = 0; k < 50; k++) {
					let tm = (ta + tb) / 2
					if ((seg_dist(tm, j) <= d) == is_near1)
						ta = tm
					else
						tb = tm
				}
				if (is_near1)
					t2 = ta
				else
					t1 = tb
			}
			ivs.push([t1, t2])
		}
		// gaps within d are rounding at edge ends, not cracks.
		ivs.sort((a, b) => a[0] - b[0])
		let t = 0
		for (let [t1, t2] of ivs) {
			if (t1 >= len)
				break
			if (t1 - t > d)
				total += t1 - t
			t = Math.max(t, t2)
			if (t >= len)
				break
		}
		if (len - t > d)
			total += len - t
	}
	return total
}


let rect = (x, y, w, h) => ['draw', x, y, w, 0, 0, h, -w, 0, 0, -h]
let L = ['draw', 0, 0, 800, 0, 0, 300, -400, 0, 0, 400, -400, 0, 0, -700]
let shapes = {
	two: [[rect(0, 0, 800, 600)], [rect(0, 0, 400, 600)]],
	twoL: [[L], [rect(0, 0, 400, 300)]],
}
let step = Number(process.env.STEP ?? 100)
let tol = (process.env.TOL ?? 25) / S + 1e-9
let counts = {built: 0, open: 0, failed: 0}
for (let name in shapes) {
	let house = ctx.house_plan({floors: shapes[name].map(lines => ({lines}))})
	let top = house.floors[house.floors.length-1]
	for (let f of house.floors) {
		let lines = []
		let faces = f.make_roof_faces(f.make_areas(), [], lines)
		let pairs = new Map()
		for (let line of lines) {
			let key = faces.indexOf(line.face1)+' '+faces.indexOf(line.face2)
			if (!pairs.has(key))
				pairs.set(key, line)
		}
		for (let [key, line] of pairs) {
			for (let fr of [.3, .7]) {
				let x0 = line.p[0] + fr * (line.q[0] - line.p[0])
				let y0 = line.p[1] + fr * (line.q[1] - line.p[1])
				let [a, b, c] = line.face1.plane
				let z = a * x0 + b * y0 + c
				if (!f.can_move_line(line.face1, line.face2, z))
					continue
				for (let dy = -300; dy <= 300; dy += step) {
					for (let dx = -300; dx <= 300; dx += step) {
						let m = f.start_move_line(line.face1, line.face2, z)
						if (!m.move(x0 + dx, y0 + dy)) {
							m.cancel()
							continue
						}
						let house_faces
						try {
							house_faces = house.make_faces(top, false)
						} catch (err) {
							counts.failed++
							log('FAIL', name, f.i, key, fr, dx, dy, err.message)
						}
						if (house_faces) {
							counts.built++
							let d = uncovered_length(house_faces, tol)
							if (d > 1e-6) {
								counts.open++
								log('OPEN', name, f.i, key, fr, dx, dy, d)
							}
						}
						m.cancel()
					}
				}
			}
		}
	}
}
log(JSON.stringify(counts))
