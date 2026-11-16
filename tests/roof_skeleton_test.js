// run: node tests/roof_skeleton_test.js
// env SDK=dir loads dir/www/roof_skeleton.js instead (a changed copy).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const sdk = path.resolve(__dirname, '..')
const ctx = {
	console: {...console, log() {}, group() {}, groupCollapsed() {},
		groupEnd() {}},
	setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask,
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
for (let name of ['glue.js', 'roof_skeleton.js']) {
	let file = path.join(name == 'roof_skeleton.js' && process.env.SDK || sdk,
		'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
const roof_skeleton = ctx.roof_skeleton

let checks = 0
function check(name, f) {
	try {
		f()
		checks++
	} catch (e) {
		console.error('FAIL', name)
		throw e
	}
}

const NEAR = 1e-6
const rad = Math.PI / 180

// geometry helpers ----------------------------------------------------------

function ring_area(ring) {
	let a = 0
	for (let i = 0; i < ring.length; i++) {
		let [x1, y1] = ring[i]
		let [x2, y2] = ring[(i + 1) % ring.length]
		a += x1 * y2 - x2 * y1
	}
	return a / 2
}

function hit_rings(rings, x, y) {
	let inside = false
	for (let ring of rings) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			let [xi, yi] = ring[i]
			let [xj, yj] = ring[j]
			if ((yi > y) != (yj > y)
					&& x < (xj - xi) * (y - yi) / (yj - yi) + xi)
				inside = !inside
		}
	}
	return inside
}

function input_edges(rings) {
	let edges = []
	for (let ring of rings)
		for (let i = 0; i < ring.length; i++)
			edges.push([ring[i], ring[(i + 1) % ring.length]])
	return edges
}

function check_shared_edges(faces, shared_edges) {
	let points = new Set()
	for (let face of faces)
		for (let ring of face.rings)
			for (let point of ring)
				points.add(point)
	for (let {p, q, face1, face2} of shared_edges) {
		assert(points.has(p) && points.has(q), 'endpoints reuse face points')
		assert(faces.includes(face1) && faces.includes(face2))
		assert.notEqual(face1, face2)
		assert(Math.hypot(q[0] - p[0], q[1] - p[1]) > 0)
		for (let face of [face1, face2]) {
			let [a, b, c] = face.plane
			assert(abs_near(p[2], a * p[0] + b * p[1] + c))
			assert(abs_near(q[2], a * q[0] + b * q[1] + c))
			let on_boundary = false
			for (let ring of face.rings) {
				for (let i = 0, n = ring.length; i < n; i++) {
					let u = ring[i], v = ring[(i+1) % n]
					let dx = v[0] - u[0], dy = v[1] - u[1]
					let len = Math.hypot(dx, dy)
					if (!len)
						continue
					let cross_p = (p[0] - u[0]) * dy - (p[1] - u[1]) * dx
					let cross_q = (q[0] - u[0]) * dy - (q[1] - u[1]) * dx
					if (Math.abs(cross_p) > NEAR * len)
						continue
					if (Math.abs(cross_q) > NEAR * len)
						continue
					let tp = ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / len**2
					let tq = ((q[0] - u[0]) * dx + (q[1] - u[1]) * dy) / len**2
					if (Math.min(tp, tq) >= -NEAR && Math.max(tp, tq) <= 1+NEAR)
						on_boundary = true
				}
			}
			assert(on_boundary, 'shared segment is on both face boundaries')
		}
	}
}

// height of the plane of input edge `edge` at (x, y).
function plane_z(edge, pitch, eave_z, x, y) {
	let [[x1, y1], [x2, y2]] = edge
	let d = x1 == x2
		? (x - x1) * (y2 > y1 ? -1 : 1)
		: (y - y1) * (x2 > x1 ? 1 : -1)
	return eave_z + d * Math.tan(pitch * rad)
}

// height of the roof at (x, y). with is_covered false, points without
// a face are allowed and return null.
function roof_z(rings, pitches, eave_z, faces, x, y, is_covered) {
	let edges = input_edges(rings)
	let found
	for (let face of faces) {
		if (!hit_rings(face.rings, x, y))
			continue
		assert.equal(found, undefined, 'point '+x+','+y+' in two faces')
		found = face
	}
	if (!found && !is_covered)
		return null
	assert.ok(found, 'point '+x+','+y+' in no face')
	let ei = found.edge_is[0]
	return plane_z(edges[ei], pitches[ei], eave_z, x, y)
}

// chessboard distance from (x, y) to the polygon boundary.
function chessboard_dist(rings, x, y) {
	let d = Infinity
	for (let [[x1, y1], [x2, y2]] of input_edges(rings)) {
		let dx = Math.max(Math.min(x1, x2) - x, 0, x - Math.max(x1, x2))
		let dy = Math.max(Math.min(y1, y2) - y, 0, y - Math.max(y1, y2))
		d = Math.min(d, Math.max(dx, dy))
	}
	return d
}

// checks every face against the input: face points lie on their plane,
// and every sample point inside the footprint lies in exactly one face.
// regions closed in by vertical edges get no face: with is_covered false,
// sample points may lie in no face and face areas may add up to less than
// the footprint area. returns sample points + heights.
function check_roof(rings, pitches, eave_z, is_covered = true) {
	let shared_edges = []
	let faces = roof_skeleton(rings, pitches,
		Array(pitches.length).fill(eave_z), shared_edges)
	check_shared_edges(faces, shared_edges)
	let edges = input_edges(rings)

	for (let face of faces)
		for (let ring of face.rings)
			for (let [x, y, z] of ring)
				for (let ei of face.edge_is)
					assert.ok(abs_near(z, plane_z(edges[ei], pitches[ei], eave_z,
						x, y)), 'face point '+x+','+y+','+z+' off its plane')

	let area = 0
	for (let ring of rings)
		area += ring_area(ring)
	let faces_area = 0
	for (let face of faces)
		for (let ring of face.rings)
			faces_area += ring_area(ring)
	assert.ok(is_covered ? abs_near(area, faces_area)
		: faces_area <= area + 1e-6,
		'faces area '+faces_area+' != footprint area '+area)

	let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
	for (let [x, y] of rings[0]) {
		x1 = Math.min(x1, x); y1 = Math.min(y1, y)
		x2 = Math.max(x2, x); y2 = Math.max(y2, y)
	}
	let samples = []
	let n = 40
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			let x = x1 + (x2 - x1) * (i + 0.371) / n
			let y = y1 + (y2 - y1) * (j + 0.613) / n
			if (!hit_rings(rings, x, y))
				continue
			let z = roof_z(rings, pitches, eave_z, faces, x, y, is_covered)
			samples.push([x, y, z])
		}
	}
	return {faces, samples}
}

function abs_near(a, b) {
	return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a))
}

function max_z(faces) {
	let z = -Infinity
	for (let face of faces)
		for (let ring of face.rings)
			for (let p of ring)
				z = Math.max(z, p[2])
	return z
}

function face_area(faces, ei) {
	let a = 0
	for (let face of faces)
		if (face.edge_is.includes(ei))
			for (let ring of face.rings)
				a += ring_area(ring)
	return a
}

// equal pitch 45: the roof height is the chessboard distance to the boundary.
function check_chessboard(rings) {
	let pitches = input_edges(rings).map(() => 45)
	let {samples} = check_roof(rings, pitches, 0)
	for (let [x, y, z] of samples)
		assert.ok(abs_near(z, chessboard_dist(rings, x, y)),
			'z '+z+' != chessboard '+chessboard_dist(rings, x, y)
			+' at '+x+','+y)
}

function rect(x1, y1, x2, y2) {
	return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
}

function reversed(ring) { return ring.slice().reverse() }

// simple shapes -------------------------------------------------------------

check('hip rectangle', () => {
	let rings = [rect(0, 0, 10, 4)]
	let {faces} = check_roof(rings, [45, 45, 45, 45], 100)
	assert.equal(faces.length, 4)
	assert.ok(abs_near(max_z(faces), 102))
	assert.ok(abs_near(face_area(faces, 0), 16))
	assert.ok(abs_near(face_area(faces, 1), 4))
})

check('hip square', () => {
	let rings = [rect(0, 0, 6, 6)]
	let {faces} = check_roof(rings, [45, 45, 45, 45], 0)
	assert.equal(faces.length, 4)
	assert.ok(abs_near(max_z(faces), 3))
})

check('shared edges leave faces unchanged and append to the output', () => {
	let rings = [rect(0, 0, 10, 4)]
	let pitches = [45, 45, 45, 45]
	let zs = [100, 100, 100, 100]
	let sentinel = {}
	let edges = [sentinel]
	let faces = roof_skeleton(rings, pitches, zs, edges)
	assert.deepEqual(faces, roof_skeleton(rings, pitches, zs))
	assert.equal(edges[0], sentinel)
	assert.equal(edges.length, 6) // four hips and one ridge.
	check_shared_edges(faces, edges.slice(1))
})

check('collinear eaves in one plane create no extra shared edges', () => {
	let rings = [[[0, 0], [5, 0], [10, 0], [10, 4], [0, 4]]]
	let edges = []
	let faces = roof_skeleton(rings, [45, 45, 45, 45, 45],
		[0, 0, 0, 0, 0], edges)
	assert.equal(faces.length, 4)
	assert.equal(edges.length, 5)
	check_shared_edges(faces, edges)
})

check('gable rectangle', () => {
	let rings = [rect(0, 0, 10, 4)]
	let {faces} = check_roof(rings, [45, 90, 45, 90], 0)
	assert.equal(faces.length, 2)
	assert.ok(abs_near(max_z(faces), 2))
	assert.ok(abs_near(face_area(faces, 0), 20))
})

check('shed rectangle', () => {
	let rings = [rect(0, 0, 10, 4)]
	let {faces} = check_roof(rings, [45, 90, 90, 90], 0)
	assert.equal(faces.length, 1)
	assert.ok(abs_near(max_z(faces), 4))
})

check('all vertical: no faces', () => {
	let faces = roof_skeleton([rect(0, 0, 10, 4)], [90, 90, 90, 90],
		[0, 0, 0, 0])
	assert.equal(faces.length, 0)
})

check('off-center ridge', () => {
	// bottom tan 1, top tan 3: ridge at y = 3, height 3.
	let top = Math.atan(3) / rad
	let rings = [rect(0, 0, 10, 4)]
	let {faces} = check_roof(rings, [45, 90, top, 90], 0)
	assert.ok(abs_near(max_z(faces), 3))
	assert.ok(abs_near(face_area(faces, 0), 30))
	assert.ok(abs_near(face_area(faces, 2), 10))
})

check('L hip', () => {
	check_chessboard([[[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]]])
})

check('T hip', () => {
	check_chessboard([[[0, 0], [12, 0], [12, 4], [8, 4], [8, 10], [4, 10],
		[4, 4], [0, 4]]])
})

check('U hip', () => {
	check_chessboard([[[0, 0], [12, 0], [12, 10], [8, 10], [8, 4], [4, 4],
		[4, 10], [0, 10]]])
})

check('ring hip', () => {
	check_chessboard([rect(0, 0, 20, 20), reversed(rect(6, 6, 14, 14))])
})

check('ring hip, off-center hole', () => {
	check_chessboard([rect(0, 0, 20, 14), reversed(rect(3, 5, 9, 11))])
})

check('two holes', () => {
	check_chessboard([rect(0, 0, 30, 12), reversed(rect(4, 4, 8, 8)),
		reversed(rect(14, 3, 24, 9))])
})

check('L gable', () => {
	// wings 4 wide, gable ends at the two wing tips.
	let rings = [[[0, 0], [12, 0], [12, 4], [4, 4], [4, 12], [0, 12]]]
	let {faces} = check_roof(rings, [45, 90, 45, 45, 90, 45], 0)
	assert.ok(abs_near(max_z(faces), 2))
})

check('L gable, wings of different width', () => {
	// ridges at different heights: wide wing 2.5, narrow wing 1.5.
	let rings = [[[0, 0], [12, 0], [12, 5], [3, 5], [3, 12], [0, 12]]]
	let {faces, samples} = check_roof(rings, [45, 90, 45, 45, 90, 45], 0)
	assert.ok(abs_near(max_z(faces), 2.5))
})

check('collinear input edges, same pitch: one face', () => {
	let rings = [[[0, 0], [5, 0], [10, 0], [10, 4], [0, 4]]]
	let {faces} = check_roof(rings, [45, 45, 45, 45, 45], 0)
	assert.equal(faces.length, 4)
	assert.deepEqual([...faces[0].edge_is], [0, 1])
	assert.ok(abs_near(face_area(faces, 0), 16))
})

check('collinear input edges, different pitch: steeper gets no face', () => {
	let shallow = Math.atan(0.5) / rad
	let rings = [[[0, 0], [5, 0], [10, 0], [10, 4], [0, 4]]]
	let {faces} = check_roof(rings, [shallow, 45, 90, 90, 90], 0)
	assert.equal(faces.length, 1)
	assert.deepEqual([...faces[0].edge_is], [0])
})

check('step, tie rule: the faster edge continues', () => {
	// a: y=0, x 0..5, tan .5 (speed 2); c: y=1, x 5..10, tan 1 (speed 1).
	// a reaches c's line at t=1, y=2, then covers the whole width.
	let shallow = Math.atan(0.5) / rad
	let rings = [[[0, 0], [5, 0], [5, 1], [10, 1], [10, 10], [0, 10]]]
	let {faces} = check_roof(rings, [shallow, 90, 45, 90, 90, 90], 0)
	assert.ok(abs_near(face_area(faces, 2), 5))
	assert.ok(abs_near(face_area(faces, 0), 90))
	assert.ok(abs_near(max_z(faces), 5))
	let shared_edges = []
	roof_skeleton(rings, [shallow, 90, 45, 90, 90, 90],
		[0, 0, 0, 0, 0, 0], shared_edges)
	assert.equal(shared_edges.length, 1)
	let {p, q} = shared_edges[0]
	assert(abs_near(p[1], 2) && abs_near(q[1], 2))
	assert(abs_near(p[2], 1) && abs_near(q[2], 1))
	assert(abs_near(Math.min(p[0], q[0]), 5))
	assert(abs_near(Math.max(p[0], q[0]), 10))
})

// eaves at different heights ------------------------------------------------

// the corner at ring[i] of a ccw ring is an outside corner.
function is_convex(ring, i) {
	let n = ring.length
	let [x0, y0] = ring[(i + n - 1) % n]
	let [x1, y1] = ring[i]
	let [x2, y2] = ring[(i + 1) % n]
	return (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1) > 0
}

// ring moved outward edge for edge, edge i by ds[i]: every corner moves
// along both edges' outward normals. the ring is ccw (area > 0).
function offset_ring(ring, ds) {
	let ring1 = []
	for (let i = 0, n = ring.length; i < n; i++) {
		let [x0, y0] = ring[(i + n - 1) % n]
		let [x1, y1] = ring[i]
		let [x2, y2] = ring[(i + 1) % n]
		let d0 = ds[(i + n - 1) % n]
		let d1 = ds[i]
		// outward normal of a ccw edge (dx, dy): (dy, -dx).
		let nx = d0 * Math.sign(y1 - y0) + d1 * Math.sign(y2 - y1)
		let ny = -d0 * Math.sign(x1 - x0) - d1 * Math.sign(x2 - x1)
		ring1.push([x1 + nx, y1 + ny])
	}
	return ring1
}

// wall_ring moved outward by d as in house_plan's make_roof_faces(): sloped
// edges move, vertical edges move only with outside corners at both ends.
// each sloped edge's eave is lowered by d*tan(pitch), so its plane passes
// through z = 0 at the wall line: inside the wall ring, the roof must be the
// wall ring's roof. a moving gable can change the order of the events inside
// the wall ring, and with it the roof there: random shapes keep the gables
// on the wall line (gables_move false).
function check_overhang(wall_ring, pitches, d, is_covered = true,
	gables_move = true
) {
	let n = wall_ring.length
	let ds = []
	let eave_zs = []
	for (let i = 0; i < n; i++) {
		let pitch = pitches[i]
		let is_moving = pitch != 90 || gables_move
			&& is_convex(wall_ring, i) && is_convex(wall_ring, (i + 1) % n)
		ds.push(is_moving ? d : 0)
		eave_zs.push(pitch == 90 ? 0 : -d * Math.tan(pitch * rad))
	}
	let ring = offset_ring(wall_ring, ds)
	let shared_edges = []
	let faces = roof_skeleton([ring], pitches, eave_zs, shared_edges)
	check_shared_edges(faces, shared_edges)
	let wall_edges = input_edges([wall_ring])

	for (let face of faces)
		for (let face_ring of face.rings)
			for (let [x, y, z] of face_ring)
				for (let ei of face.edge_is)
					assert.ok(abs_near(z, plane_z(wall_edges[ei], pitches[ei], 0,
						x, y)), 'face point '+x+','+y+','+z+' off its plane')

	let faces_area = 0
	for (let face of faces)
		for (let face_ring of face.rings)
			faces_area += ring_area(face_ring)
	assert.ok(is_covered ? abs_near(faces_area, ring_area(ring))
		: faces_area <= ring_area(ring) + 1e-6,
		'faces area '+faces_area+' != footprint area '+ring_area(ring))

	// roof_z() finds each point's face, then its plane from the wall edge.
	let {samples} = check_roof([wall_ring], pitches, 0, is_covered)
	for (let [x, y, z] of samples) {
		let z1 = roof_z([wall_ring], pitches, 0, faces, x, y, is_covered)
		assert.ok(z == null ? z1 == null : z1 != null && abs_near(z, z1),
			'z '+z1+' != '+z+' at '+x+','+y)
	}
	return faces
}

check('overhang: hip rectangle, 45 long sides, 30 short sides', () => {
	check_overhang(rect(0, 0, 10, 4), [45, 30, 45, 30], 1)
})

check('overhang: L with a gable end and mixed pitches', () => {
	let wall_ring = [[0, 0], [6, 0], [6, 4], [3, 4], [3, 7], [0, 7]]
	check_overhang(wall_ring, [90, 45, 30, 45, 45, 45], .5)
})

check('overhang: a gable at an inside corner stays on the wall line', () => {
	// a slot 1 wide, 3 deep, gables on its sides, its end sloped.
	let wall_ring = [[0, 0], [4, 0], [4, 3], [5, 3], [5, 0], [9, 0], [9, 7],
		[0, 7]]
	check_overhang(wall_ring, [45, 90, 45, 90, 45, 45, 45, 45], .3)
})

// random shapes -------------------------------------------------------------

// 32-bit integer LCG: exact in doubles.
let seed = 1
function random() {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
	return seed / 4294967296
}
function random_int(a, b) { return a + Math.floor(random() * (b - a + 1)) }

// remove repeated points and the middle points of straight runs.
function clean_ring(ps) {
	let a = []
	for (let p of ps)
		if (!a.length || a[a.length-1][0] != p[0] || a[a.length-1][1] != p[1])
			a.push(p)
	if (a[0][0] == a[a.length-1][0] && a[0][1] == a[a.length-1][1])
		a.pop()
	let changed = true
	while (changed) {
		changed = false
		for (let i = 0; i < a.length; i++) {
			let p0 = a[(i + a.length - 1) % a.length]
			let p1 = a[i]
			let p2 = a[(i + 1) % a.length]
			if ((p0[0] == p1[0] && p1[0] == p2[0])
					|| (p0[1] == p1[1] && p1[1] == p2[1])) {
				a.splice(i, 1)
				changed = true
				break
			}
		}
	}
	return a
}

// columns with random bottoms and tops, each overlapping the next.
function random_columns_ring() {
	let k = random_int(2, 6)
	let xs = [0]
	let bs = []
	let ts = []
	for (let i = 0; i < k; i++) {
		xs.push(xs[i] + random_int(1, 5))
		let b, t
		do {
			b = random_int(0, 6)
			t = b + random_int(1, 8)
		} while (i > 0 && (Math.max(b, bs[i-1]) >= Math.min(t, ts[i-1])))
		bs.push(b)
		ts.push(t)
	}
	let ps = []
	for (let i = 0; i < k; i++) {
		ps.push([xs[i], bs[i]])
		ps.push([xs[i+1], bs[i]])
	}
	for (let i = k - 1; i >= 0; i--) {
		ps.push([xs[i+1], ts[i]])
		ps.push([xs[i], ts[i]])
	}
	return clean_ring(ps)
}

function swap_xy(ring) {
	return reversed(ring.map(([x, y]) => [y, x]))
}

check('random column shapes, equal pitch vs chessboard distance', () => {
	for (let i = 0; i < 300; i++) {
		let ring = random_columns_ring()
		if (i & 1)
			ring = swap_xy(ring)
		try {
			check_chessboard([ring])
		} catch (e) {
			console.error('ring', JSON.stringify(ring))
			throw e
		}
	}
})

check('random column shapes, random sloped pitches', () => {
	let pitch_choices = [30, 45, 60, Math.atan(0.5) / rad]
	for (let i = 0; i < 300; i++) {
		let ring = random_columns_ring()
		if (i & 1)
			ring = swap_xy(ring)
		let pitches = ring.map(() => pitch_choices[random_int(0, 3)])
		try {
			check_roof([ring], pitches, 0)
		} catch (e) {
			console.error('ring', JSON.stringify(ring),
				'pitches', JSON.stringify(pitches))
			throw e
		}
	}
})

check('random column shapes, random pitches with vertical edges', () => {
	let pitch_choices = [30, 45, 60, 90, Math.atan(0.5) / rad]
	for (let i = 0; i < 300; i++) {
		let ring = random_columns_ring()
		if (i & 1)
			ring = swap_xy(ring)
		let pitches = ring.map(() => pitch_choices[random_int(0, 4)])
		if (!pitches.some(p => p != 90))
			pitches[0] = 45
		try {
			check_roof([ring], pitches, 0, false)
		} catch (e) {
			console.error('ring', JSON.stringify(ring),
				'pitches', JSON.stringify(pitches))
			throw e
		}
	}
})

check('random column shapes, overhang with random pitches', () => {
	let pitch_choices = [30, 45, 60, 90, Math.atan(0.5) / rad]
	for (let i = 0; i < 1000; i++) {
		let wall_ring = random_columns_ring()
		if (i & 1)
			wall_ring = swap_xy(wall_ring)
		let pitches = wall_ring.map(() => pitch_choices[random_int(0, 4)])
		if (!pitches.some(p => p != 90))
			pitches[0] = 45
		try {
			check_overhang(wall_ring, pitches, .2, false, false)
		} catch (e) {
			console.error('ring', JSON.stringify(wall_ring),
				'pitches', JSON.stringify(pitches))
			throw e
		}
	}
})

check('random holes, equal pitch vs chessboard distance', () => {
	for (let i = 0; i < 200; i++) {
		let w = random_int(8, 20)
		let h = random_int(8, 20)
		let x1 = random_int(1, w - 3)
		let y1 = random_int(1, h - 3)
		let x2 = random_int(x1 + 1, w - 1)
		let y2 = random_int(y1 + 1, h - 1)
		let rings = [rect(0, 0, w, h), reversed(rect(x1, y1, x2, y2))]
		try {
			check_chessboard(rings)
		} catch (e) {
			console.error('rings', JSON.stringify(rings))
			throw e
		}
	}
})

check('random column shapes, no holes: no face has a hole', () => {
	// the house model editor adds every face ring as an outline.
	let pitch_choices = [30, 45, 60, 90, Math.atan(0.5) / rad]
	for (let i = 0; i < 1000; i++) {
		let ring = random_columns_ring()
		if (i & 1)
			ring = swap_xy(ring)
		let pitches = ring.map(() => pitch_choices[random_int(0, 4)])
		if (!pitches.some(p => p != 90))
			pitches[0] = 45
		let eave_zs = Array(pitches.length).fill(0)
		let shared_edges = []
		let faces = roof_skeleton([ring], pitches, eave_zs, shared_edges)
		check_shared_edges(faces, shared_edges)
		for (let face of faces)
			for (let face_ring of face.rings)
				if (ring_area(face_ring) <= 0) {
					console.error('ring', JSON.stringify(ring),
						'pitches', JSON.stringify(pitches))
					assert.fail('face ring with area <= 0')
				}
	}
})

console.log(checks + ' checks passed')
