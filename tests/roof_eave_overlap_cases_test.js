// run: node tests/roof_eave_overlap_cases_test.js
// investigation: the roof bodies that make_faces() adds where the overhang
// strips of two perpendicular sloped sides with different eave heights
// overlap, on the cases tests/roof_steps_probe_test.js doesn't cover:
//  - short: a short lower side next to the inside corner, with a hip at its
//    other end that can reach into the overlap.
//  - slot: a slot narrower than the overhang, with arms of different
//    lengths: the strip of one arm's slot side crosses the strip of the
//    other arm's end.
// per case: the overlaps (computed here like make_faces() does), whether
// they lie outside the walls, whether the top over them is the higher of the
// skeleton's top and the lower side's plane, and the house JSON to load.
// env JSON=1 prints the JSON.
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
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
let log = console.log.bind(console)
let f = v => Math.round(v * 10) / 10
let scale = ctx.prism_union.grid_scale

// an axis-aligned polygon as a 'draw' line: start point, then a
// horizontal and a vertical move per side, 0 = none.
function draw(points) {
	let line = ['draw', points[0][0], points[0][1]]
	for (let i = 1; i <= points.length; i++) {
		let p = points[i-1], q = points[i % points.length]
		line.push(q[0] - p[0], q[1] - p[1])
	}
	return line
}

function in_poly(ring, x, y) {
	let inside = false
	for (let i = 0, j = ring.length-1; i < ring.length; j = i++) {
		let [xi, yi] = ring[i], [xj, yj] = ring[j]
		if ((yi > y) != (yj > y)
			&& x < (xj - xi) * (y - yi) / (yj - yi) + xi)
			inside = !inside
	}
	return inside
}
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
function in_face(face, x, y) {
	let inside = false
	for (let ring of face.rings)
		if (in_poly(ring, x, y))
			inside = !inside
	return inside
}
function union_top(union_faces, x, y) {
	let z = null
	for (let face of union_faces) {
		if (face.tag != 'roof')
			continue
		let [nx, ny, nz] = face_normal(face)
		if (nz <= 1e-9 * Math.hypot(nx, ny, nz) || !in_face(face, x, y))
			continue
		let p = face.rings[0][0]
		let fz = p[2] - (nx * (x - p[0]) + ny * (y - p[1])) / nz
		if (z == null || fz > z)
			z = fz
	}
	return z
}
let plane_z = ([a, b, c], x, y) => a * x + b * y + c

// the overlaps, as make_faces() finds them: [{x1, y1, x2, y2, plane}, ...]
function overlaps(faces, sides) {
	let side_planes = new Map()
	for (let face of faces)
		for (let side of face.sides)
			side_planes.set(side, face.plane)
	let rs = []
	for (let i = 0; i < sides.length; i++) {
		for (let j = i+1; j < sides.length; j++) {
			let s1 = sides[i], s2 = sides[j]
			if (s1.pitch == 90 || s2.pitch == 90 || !s1.nx == !s2.nx
				|| s1.eave_z == s2.eave_z)
				continue
			let x1 = -1/0, y1 = -1/0, x2 = 1/0, y2 = 1/0
			for (let s of [s1, s2]) {
				let c1 = Math.min(s.wall_c, s.c), c2 = Math.max(s.wall_c, s.c)
				x1 = Math.max(x1, s.nx ? c1 : s.m1)
				x2 = Math.min(x2, s.nx ? c2 : s.m2)
				y1 = Math.max(y1, s.nx ? s.m1 : c1)
				y2 = Math.min(y2, s.nx ? s.m2 : c2)
			}
			if (x2 <= x1 || y2 <= y1)
				continue
			let low = s1.eave_z < s2.eave_z ? s1 : s2
			rs.push({x1: x1 / scale, y1: y1 / scale, x2: x2 / scale,
				y2: y2 / scale, plane: side_planes.get(low), low: low, sides: [s1, s2]})
		}
	}
	return rs
}

// edge points: [x, y, pitch, eave_h] near a wall's middle. quiet: no log.
// returns {third, bad}: the most samples of an overlap on a third face; the
// samples with the top off.
// the case data is in cm; the plan is in mm.
function run_case(name, points_cm, roof_cm, edge_points_cm, quiet) {
	let log1 = quiet ? () => {} : log
	let result = {third: 0, bad: 0}
	let points = points_cm.map(([x, y]) => [x * 10, y * 10])
	let roof = {...roof_cm, eave_h: roof_cm.eave_h * 10}
	let h = ctx.house_plan({version: 1, floors: [{lines: [draw(points)]}]})
	let floor = h.floors[0]
	floor.roof = Object.assign(floor.roof, roof)
	floor.roof.edge_points = edge_points_cm.map(([x, y, pitch, eave_h]) =>
		({x: x * 10, y: y * 10, pitch, eave_h: eave_h * 10}))
	let areas = floor.make_areas().filter(a => a.kind == 'roof')
	let sides = []
	let faces = floor.make_roof_faces(areas, sides)
	let union_faces
	try {
		union_faces = h.make_faces(floor, false)
	} catch (e) {
		log(name, 'FAIL', e.message)
		return {third: 0, bad: 1/0}
	}
	let rs = overlaps(faces, sides)
	log1(name, 'overlaps', rs.length)
	for (let r of rs) {
		let n_in_walls = 0, n_bad = 0, n = 0, max_dz = 0
		let n_third = 0 // samples on a skeleton face of neither side
		for (let i = 1; i < 20; i++)
			for (let j = 1; j < 20; j++) {
				let x = r.x1 + (r.x2 - r.x1) * i / 20
				let y = r.y1 + (r.y2 - r.y1) * j / 20
				n++
				if (in_poly(points, x, y))
					n_in_walls++
				if (!r.plane)
					continue
				let skel = -1/0
				for (let face of faces)
					if (in_face(face, x, y)) {
						skel = Math.max(skel, plane_z(face.plane, x, y))
						if (!face.sides.includes(r.sides[0])
							&& !face.sides.includes(r.sides[1]))
							n_third++
					}
				let want = Math.max(skel, plane_z(r.plane, x, y))
				let z = union_top(union_faces, x, y)
				let dz = z == null ? 1/0 : Math.abs(z - want)
				max_dz = Math.max(max_dz, dz)
				if (dz > 5)
					n_bad++
			}
		log1('  x', f(r.x1), f(r.x2), 'y', f(r.y1), f(r.y2),
			'lower side n', r.low.nx, r.low.ny, 'eave_z', f(r.low.eave_z),
			r.plane ? '' : 'NO FACE',
			'samples', n, 'third face', n_third, 'in walls', n_in_walls,
			'top off', n_bad, 'max dz', f(max_dz))
		result.third = Math.max(result.third, n_third)
		result.bad += n_bad
	}
	if (quiet)
		return result
	// the JSON loads back into the same model.
	let json = JSON.stringify(h.save_state())
	let h2 = ctx.house_plan({version: 1})
	h2.load_state(JSON.parse(json))
	let n2 = h2.make_faces(h2.floors[0], false).length
	log('  faces', union_faces.length, 'after load', n2)
	if (process.env.JSON)
		log(json)
	return result
}

// short lower side: T, main body 0..1000 x 0..600, wing out to y -300 at
// x short..short+400. front sides pitch 40 with a low eave, wing sides
// pitch 50 with a high eave, ends hipped. wing_eave_h -120: a 100 deep wing
// overhang, deeper than the short side: the wing's strip covers the short
// side's strip, so the short side gets no face.
function short_case(short, wing_eave_h, end_pitch, end_eave_h, quiet) {
	let x1 = short, x2 = short + 400
	return run_case('short '+short+' wing eave_h '+wing_eave_h
		+' end '+end_pitch+' '+end_eave_h, [[0, 0], [x1, 0],
		[x1, -300], [x2, -300], [x2, 0], [1000, 0], [1000, 600], [0, 600]],
		{pitch: 45, eave_h: -30},
		[[short / 2, 0, 40, -150], [700, 0, 40, -150],
		 [x1, -150, 50, wing_eave_h], [x2, -150, 50, wing_eave_h],
		 [0, 300, end_pitch, end_eave_h]], quiet)
}
for (let [short, wing_eave_h] of [[100, -30], [40, -30], [40, -120]])
	short_case(short, wing_eave_h, 45, -30)

// a hip in the overlap: the left end's hip leans toward the wing when the
// end side is shallower than the front side. search for the house with the
// most overlap samples on the left end's face.
let best
for (let short of [60, 100, 150, 200])
for (let wing_eave_h of [-60, -120])
for (let end_pitch of [15, 20, 30, 40])
for (let end_eave_h of [-30, -60, -150]) {
	let r = short_case(short, wing_eave_h, end_pitch, end_eave_h, true)
	if (r.bad)
		log('TOP OFF', short, wing_eave_h, end_pitch, end_eave_h, r.bad)
	if (!best || r.third > best.third)
		best = {third: r.third, args: [short, wing_eave_h, end_pitch, end_eave_h]}
}
log('hip search: best', best.third, 'samples on a third face')
if (best.third)
	short_case(...best.args)

// slot: U open to -y, left arm x 0..300 to y -500, right arm x 400..1000 to
// y -300, slot 100 wide. overhangs 138 (pitch 30, eave_h -80) cross the
// slot; the right arm's end has a lower eave.
run_case('slot', [[0, 0], [0, -500], [300, -500], [300, 0], [400, 0],
	[400, -300], [1000, -300], [1000, 600], [0, 600]],
	{pitch: 30, eave_h: -80},
	[[700, -300, 30, -150]])
