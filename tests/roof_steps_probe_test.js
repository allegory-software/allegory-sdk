// run: node tests/roof_steps_probe_test.js
// investigation: vertical steps in the roof of a cross gable house whose
// front eaves are lower than the eaves of the wing (Cosmin's example,
// 2026-11-16). prints the top floor's roof faces and every face edge that no
// other face edge covers in the opposite direction: an open edge inside the
// perimeter is a vertical step that nothing closes.
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
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js',
	'house_plan_objects.js', 'house_plan.js']) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
let log = console.log.bind(console)

let state = {"rotation":3.141592653589793,"floor_h":250,"int_wall_thickness":8,"ext_wall_thickness":18,"slab_thickness":20,"roof_thickness":20,"floors":[{"points":[[-416.0176424948118,-171.50713550928134,43],[-416.0176424948118,436.94934777756964,44],[-3.2163457479116246,-337.12382595942535,52],[-3.2163457479116246,-171.50713550928134,51],[408.94776436220377,-337.12382595942535,55],[408.94776436220377,-171.50713550928134,57],[782.3224849430737,-171.50713550928134,48],[782.3224849430737,436.94934777756964,46]],"lines":[[31,2,4,27,0,3,33,5,6,26,1,7,25,0,1,29,3,2,32,4,5,28,6,7]],"room_points":[],"area_points":[],"roof":{"pitch":55,"overhang":60,"eave_h":-22,"max_overhang":150,"edge_points":[{"x":-430.018,"y":47.09633688620541,"pitch":90},{"x":796.322,"y":154.37132646033942,"pitch":90},{"x":518.4256835781912,"y":-267.797,"pitch":null}]}},{"points":[[-416.0176424948118,-171.50713550928134,69],[-416.0176424948118,436.94934777756964,67],[-3.2163457479116246,-337.12382595942535,52],[-3.2163457479116246,-171.50713550928134,44],[408.94776436220377,-337.12382595942535,55],[408.94776436220377,-171.50713550928134,61],[782.3224849430737,-171.50713550928134,62],[782.3224849430737,436.94934777756964,65]],"lines":[[31,2,4,39,0,3,34,5,6,37,7,1,38,1,0,25,2,3,28,4,5,36,6,7]],"room_points":[],"area_points":[],"roof":{"pitch":50,"overhang":60,"eave_h":-54.31917033397033,"max_overhang":150,"edge_points":[{"x":193.6182738655099,"y":-388.154,"pitch":90},{"x":-430.018,"y":47.09633688620541,"pitch":90},{"x":796.322,"y":154.37132646033942,"pitch":90},{"x":38.329,"y":-94.19267377240992,"pitch":40,"eave_h":-182.3191703339703},{"x":377.688,"y":-163.329,"pitch":40,"eave_h":-182.3191703339703},{"x":-17.216,"y":-268.3155,"pitch":null},{"x":422.948,"y":-268.3155,"pitch":null}]}}]}

let h = ctx.house_plan({})
h.load_state(state)
let floor = h.floors[h.floors.length-1]
let areas = floor.make_areas().filter(a => a.kind == 'roof')
let sides = []
let faces = floor.make_roof_faces(areas, sides)
let f = v => Math.round(v * 10) / 10
log('wall top', floor.z + floor.h)
for (let s of sides)
	log('eave side', 'n', s.nx, s.ny, 'wall_c', f(s.wall_c), 'm', f(s.m1), f(s.m2),
		'pitch', s.pitch, 'eave_z', f(s.eave_z), 'd', s.d)
for (let i = 0; i < faces.length; i++) {
	let face = faces[i]
	log('face', i, 'plane', face.plane.map(f).join(' '))
	for (let ring of face.rings)
		log('  ', ring.map(p => p.map(f).join(',')).join('  '))
}

// open edges: no edge of another face runs over the same plan segment in
// the opposite direction at the same heights.
let segs = [] // [{face_i, p, q}, ...]
for (let i = 0; i < faces.length; i++)
	for (let ring of faces[i].rings)
		for (let j = 0; j < ring.length; j++)
			segs.push({face_i: i, p: ring[j], q: ring[(j+1) % ring.length]})
let D = 0.5
function on_seg(a, p, q) { // plan point a on segment p-q: its height there
	let dx = q[0] - p[0], dy = q[1] - p[1]
	let l2 = dx * dx + dy * dy
	let t = ((a[0] - p[0]) * dx + (a[1] - p[1]) * dy) / l2
	if (t < -1e-6 || t > 1 + 1e-6)
		return null
	let x = p[0] + t * dx, y = p[1] + t * dy
	if (Math.hypot(a[0] - x, a[1] - y) > D)
		return null
	return p[2] + t * (q[2] - p[2])
}
for (let s of segs) {
	let m = [(s.p[0] + s.q[0]) / 2, (s.p[1] + s.q[1]) / 2,
		(s.p[2] + s.q[2]) / 2]
	let found = null
	for (let s2 of segs) {
		if (s2 == s || s2.face_i == s.face_i)
			continue
		let z = on_seg(m, s2.q, s2.p)
		if (z == null)
			continue
		found = {face_i: s2.face_i, dz: z - m[2]}
		if (Math.abs(found.dz) < D)
			break
	}
	if (found && Math.abs(found.dz) < D)
		continue
	log(found ? 'STEP' : 'open', 'face', s.face_i,
		s.p.map(f).join(','), '->', s.q.map(f).join(','),
		found ? 'next to face '+found.face_i+' dz '+f(found.dz) : '')
}

// make_faces(): where the overhang strips of the main front eave (lower) and
// a side of the wing overlap, the main roof runs under the wing's eave up to
// the wing's wall. check: the top over the overlap is the higher of the
// skeleton's top and the main front plane, and the main roof is there under
// the wing's eave.
const assert = require('node:assert/strict')

// face normal (Newell) of a union face.
function face_normal(face) {
	let nx = 0, ny = 0, nz = 0
	for (let ring of face.rings)
		for (let i = 0; i < ring.length; i++) {
			let p = ring[i], q = ring[(i+1) % ring.length]
			nx += (p[1] - q[1]) * (p[2] + q[2])
			ny += (p[2] - q[2]) * (p[0] + q[0])
			nz += (p[0] - q[0]) * (p[1] + q[1])
		}
	return [nx / 2, ny / 2, nz / 2]
}
function in_face(face, x, y) { // even-odd over all rings
	let inside = false
	for (let ring of face.rings)
		for (let i = 0, j = ring.length-1; i < ring.length; j = i++) {
			let [xi, yi] = ring[i], [xj, yj] = ring[j]
			if ((yi > y) != (yj > y)
				&& x < (xj - xi) * (y - yi) / (yj - yi) + xi)
				inside = !inside
		}
	return inside
}
// z of the up (dir 1) or down (dir -1) roof faces of the union over (x, y).
function roof_zs(union_faces, x, y, dir) {
	let zs = []
	for (let face of union_faces) {
		if (face.tag != 'roof')
			continue
		let [nx, ny, nz] = face_normal(face)
		if (nz * dir <= 1e-9 * Math.hypot(nx, ny, nz) || !in_face(face, x, y))
			continue
		let p = face.rings[0][0]
		zs.push(p[2] - (nx * (x - p[0]) + ny * (y - p[1])) / nz)
	}
	return zs.sort((a, b) => b - a)
}
let plane_z = ([a, b, c], x, y) => a * x + b * y + c

let union_faces = h.make_faces(floor, false)
let front = faces[1] // main front: pitch 40, eave 374.1
let skeleton_top = (x, y) => {
	let z = -1/0
	for (let face of faces)
		if (in_face(face, x, y))
			z = Math.max(z, plane_z(face.plane, x, y))
	return z
}
let n_samples = 0
for (let [x1, x2] of [[-62.3, -17], [423, 468.3]]) {
	let y1 = -336, y2 = -186
	// inside the overlap, off its edges: the top.
	for (let i = 1; i < 20; i++)
		for (let j = 1; j < 20; j++) {
			let x = x1 + (x2 - x1) * i / 20
			let y = y1 + (y2 - y1) * j / 20
			let want = Math.max(skeleton_top(x, y), plane_z(front.plane, x, y))
			let z = roof_zs(union_faces, x, y, 1)[0]
			assert(Math.abs(z - want) < 0.5, 'top at '+x+','+y+': '+z+' '+want)
			n_samples++
		}
	// under the wing's eave: the wing's roof, then the main roof below it.
	let x = (x1 + x2) / 2
	let y = -306
	let up = roof_zs(union_faces, x, y, 1)
	let down = roof_zs(union_faces, x, y, -1)
	log('at', f(x), y, 'up', up.map(f).join(' '), 'down', down.map(f).join(' '))
	assert.equal(up.length, 2)
	assert(Math.abs(up[1] - plane_z(front.plane, x, y)) < 0.5)
}
log('ok', n_samples, 'samples')

// sweep: eave heights and pitches of the main front and the wing sides,
// either one lower. make_faces() must not assert.
let n_built = 0
let n_failed = 0
let roof0 = JSON.parse(JSON.stringify(floor.roof))
for (let front_pitch of [20, 40, 60])
for (let front_eave_h of [-10, -60, -182])
for (let wing_pitch of [25, 50])
for (let wing_eave_h of [-5, -54, -120]) {
	floor.roof = JSON.parse(JSON.stringify(roof0))
	for (let p of floor.roof.edge_points) {
		if (p.pitch == 40) {
			p.pitch = front_pitch
			p.eave_h = front_eave_h
		} else if (p.pitch === null) {
			p.pitch = wing_pitch
			p.eave_h = wing_eave_h
		}
	}
	try {
		h.make_faces(floor, false)
		n_built++
	} catch (e) {
		n_failed++
		log('FAIL', front_pitch, front_eave_h, wing_pitch, wing_eave_h, e.message)
	}
}
floor.roof = roof0
log('sweep', n_built, 'built', n_failed, 'failed')
assert.equal(n_failed, 0)
