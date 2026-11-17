// run: node tests/prism_union_cut_test.js
// env: SWEEP=n (n random pitch sets per plan), BENCH=1, VERBOSE=1,
// TOL=n (grid units).
// roof bodies that cut the walls and slabs under them, with tagged prisms,
// as make_faces() builds them: one body per roof face, the face is the top,
// thickness t at right angles to it, no top slab. checks that the union is
// a closed solid whose volume matches the exact volume of the cut prisms.
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
	ui: {keypressed: k => false},
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
let files = ['www/glue.js', 'www/earcut.js', 'www/3d.js', 'www/plane_graph.js',
	'www/roof_skeleton.js', 'www/clipper2.js', 'www/prism_union.js',
	'www/house_plan_objects.js', 'www/house_plan.js']
for (let name of files) {
	// env SDK=dir loads dir/www/roof_skeleton.js instead (a changed copy).
	let file = path.join(name == 'www/roof_skeleton.js' && process.env.SDK
		|| sdk, name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
vm.runInContext(fs.readFileSync(path.join(sdk, 'www/ui-demo.html'), 'utf8')
	.match(/<script id=house_test_plans>([\s\S]*?)<\/script>/)[1], ctx)

const {prism_union, clipper2} = ctx
const S = prism_union.grid_scale

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

// geometry helpers ----------------------------------------------------------

function ring_path(ring) {
	let path = []
	for (let [x, y] of ring)
		path.push({x: Math.round(x * S), y: Math.round(y * S)})
	return path
}

function outline_paths(floor) {
	let paths = []
	for (let comp of floor)
		paths.push(ring_path(comp.outer_cycle.edges))
	return paths
}

function skin_paths(floor) {
	let paths = []
	for (let comp of floor.comps)
		for (let c of comp.cycles)
			paths.push(ring_path(c.edges))
	return paths
}

function face_area_vector(face) {
	let ax = 0
	let ay = 0
	let az = 0
	for (let ring of face.rings) {
		for (let i = 0; i < ring.length; i++) {
			let [x1, y1, z1] = ring[i]
			let [x2, y2, z2] = ring[(i+1) % ring.length]
			ax += y1 * z2 - z1 * y2
			ay += z1 * x2 - x1 * z2
			az += x1 * y2 - y1 * x2
		}
	}
	return [ax / 2, ay / 2, az / 2]
}

// the house's prisms, as make_faces() builds them (no open rooms): walls,
// slabs at the bottom of each floor, and one roof body per roof face on the
// top floor.
function house_prisms(h, roof_t) {
	let prisms = []
	let slab_t = h.slab_thickness
	let floors = h.floors
	let top_floor = floors[floors.length-1]
	let roof_areas = top_floor.make_areas()
	let roof_paths = []
	for (let area of roof_areas)
		roof_paths.push(...area.paths)
	let roof_faces = top_floor.make_roof_faces(roof_areas)
	// the top floor's walls under the roof go up to the roof's highest point.
	let roof_z = -1/0
	for (let face of roof_faces) {
		let [a, b, c] = face.plane
		for (let ring of face.rings)
			for (let [x, y] of ring)
				roof_z = Math.max(roof_z, a * x + b * y + c)
	}
	for (let floor of floors) {
		let bottom = [0, 0, floor.z + slab_t]
		let top = [0, 0, floor.z + floor.h]
		if (floor == top_floor) {
			let paths = skin_paths(floor)
			prisms.push({paths: clipper2.intersect(paths, roof_paths, EO),
				tag: 'walls', bottom, top: [0, 0, roof_z]})
			prisms.push({paths: clipper2.difference(paths, roof_paths, EO),
				tag: 'walls', bottom, top})
		} else {
			prisms.push({paths: skin_paths(floor), tag: 'walls', bottom, top})
		}
	}
	for (let i = 0; i < floors.length; i++) {
		let floor0 = floors[i-1]
		let floor1 = floors[i]
		let paths = [
			...(floor0 ? outline_paths(floor0) : []),
			...outline_paths(floor1),
		]
		paths = clipper2.union(paths, [], clipper2.FillRule.NonZero)
		prisms.push({paths, tag: 'walls',
			bottom: [0, 0, floor1.z], top: [0, 0, floor1.z + slab_t]})
	}
	for (let face of roof_faces) {
		let [a, b, c] = face.plane
		let paths = []
		for (let ring of face.rings)
			paths.push(ring_path(ring))
		let dz = roof_t * Math.sqrt(1 + a * a + b * b)
		prisms.push({paths, tag: 'roof', is_cutter: true,
			bottom: [a, b, c - dz], top: [a, b, c]})
	}
	return prisms
}

// reference volume ----------------------------------------------------------

const EO = clipper2.FillRule.EvenOdd
const NZ = clipper2.FillRule.NonZero

// integral of the plane's z over grid paths filled even-odd.
function plane_integral(paths, plane) {
	let [a, b, c] = plane
	let v = 0
	for (let path of clipper2.union(paths, [], EO)) {
		let area = 0
		let mx = 0
		let my = 0
		for (let i = 0, n = path.length; i < n; i++) {
			let p = path[i]
			let q = path[(i+1) % n]
			let x1 = p.x / S
			let y1 = p.y / S
			let x2 = q.x / S
			let y2 = q.y / S
			let cross = x1 * y2 - x2 * y1
			area += cross / 2
			mx += (x1 + x2) * cross / 6
			my += (y1 + y2) * cross / 6
		}
		v += a * mx + b * my + c * area
	}
	return v
}

// grid paths of the bbox of `paths` where the plane difference
// [a, b, c] (plan units) is negative.
function negative_paths(paths, [a, b, c]) {
	let x1 = 1/0, y1 = 1/0, x2 = -1/0, y2 = -1/0
	for (let path of paths) {
		for (let p of path) {
			x1 = Math.min(x1, p.x - 10)
			y1 = Math.min(y1, p.y - 10)
			x2 = Math.max(x2, p.x + 10)
			y2 = Math.max(y2, p.y + 10)
		}
	}
	let corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
	let path = []
	let f = (x, y) => a * x + b * y + c * S
	for (let i = 0; i < 4; i++) {
		let [px, py] = corners[i]
		let [qx, qy] = corners[(i+1) % 4]
		let fp = f(px, py)
		let fq = f(qx, qy)
		if (fp < 0)
			path.push({x: px, y: py})
		if ((fp < 0) != (fq < 0)) {
			let t = fp / (fp - fq)
			path.push({x: Math.round(px + t * (qx - px)),
				y: Math.round(py + t * (qy - py))})
		}
	}
	return path.length >= 3 ? [path] : []
}

function plane_minus(p1, p2) {
	return [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]]
}

// exact volume of the cut prisms, independent of prism_union(): the roof
// bodies, plus every other prism cut by each roof body over it. prisms of
// the same kind must not overlap (true for walls, slabs and roof faces).
function reference_volume(prisms) {
	let cutters = []
	let others = []
	for (let prism of prisms)
		(prism.is_cutter ? cutters : others).push(prism)
	let v = 0
	let cutter_paths = []
	for (let cutter of cutters) {
		v += plane_integral(cutter.paths, cutter.top)
			- plane_integral(cutter.paths, cutter.bottom)
		cutter_paths.push(...cutter.paths)
	}
	let roof_paths = clipper2.union(cutter_paths, [], NZ)
	for (let prism of others) {
		let outside = clipper2.difference(prism.paths, roof_paths, EO)
		v += plane_integral(outside, prism.top)
			- plane_integral(outside, prism.bottom)
		for (let cutter of cutters) {
			let piece = clipper2.intersect(prism.paths, cutter.paths, EO)
			if (!piece.length)
				continue
			let below_top = negative_paths(piece,
				plane_minus(cutter.bottom, prism.top))
			let below_bottom = negative_paths(piece,
				plane_minus(cutter.bottom, prism.bottom))
			let full = clipper2.difference(piece, below_top, EO)
			let cut = clipper2.difference(
				clipper2.intersect(piece, below_top, EO), below_bottom, EO)
			v += plane_integral(full, prism.top)
				- plane_integral(full, prism.bottom)
			v += plane_integral(cut, cutter.bottom)
				- plane_integral(cut, prism.bottom)
		}
	}
	return v
}

// what's wrong with the union of the prisms ------------------------------

function union_report(prisms) {
	let t0 = performance.now()
	let faces = prism_union(prisms)
	let ms = performance.now() - t0
	let r = union_report_of_faces(faces)
	r.ms = Math.round(ms)
	return r
}

function union_report_of_faces(faces) {
	let sx = 0
	let sy = 0
	let sz = 0
	let v = 0
	let tiny_n = 0
	let plan_area = 0 // of the faces on planes, top and bottom
	let face_n_by_tag = {}
	for (let face of faces) {
		let [ax, ay, az] = face_area_vector(face)
		let [x, y, z] = face.rings[0][0]
		sx += ax
		sy += ay
		sz += az
		v += (ax * x + ay * y + az * z) / 3
		plan_area += Math.abs(az)
		face_n_by_tag[face.tag] = (face_n_by_tag[face.tag] ?? 0) + 1
		if (Math.hypot(ax, ay, az) < 1)
			tiny_n++
	}
	return {faces, face_n: faces.length, face_n_by_tag, tiny_n,
		open: Math.hypot(sx, sy, sz), volume: v, plan_area}
}

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

function house_report(h) {
	let prisms = house_prisms(h, 200)
	let r = union_report(prisms)
	let v = reference_volume(prisms)
	// the union rounds z and the cut lines to the grid: up to half a grid
	// unit over the faces on planes.
	r.volume_error = Math.abs(r.volume - v) / (r.plan_area * .5 / S)
	// make_faces() builds the same prisms, with the parts of the lower floors
	// that stick out as terraces: house_prisms() has the top floor's roof
	// only, and reference_volume() takes cutters that don't overlap.
	let top_floor = h.floors[h.floors.length-1]
	for (let floor of h.floors) {
		if (floor == top_floor)
			continue
		let make_areas = floor.make_areas
		floor.make_areas = function() {
			let areas = make_areas()
			for (let area of areas)
				area.kind = 'terrace'
			return areas
		}
	}
	let r1 = union_report_of_faces(h.make_faces(top_floor, false))
	r.make_faces_error = Math.abs(r1.volume - r.volume) / r.volume
	// where the code splits a side face where two bounds cross, it rounds the
	// split point's z: the point is off the edges of the faces next to it by
	// up to half a grid unit. clipper drops triangles less than 2 units tall
	// and slivers thinner than a grid unit.
	r.uncovered = uncovered_length(r.faces, (process.env.TOL ?? 2) / S + 1e-9)
	if (process.env.VERBOSE) {
		let {faces, ...r1} = r
		console.log(JSON.stringify(r1))
	}
	return r
}

function check_solid(r) {
	assert(r.uncovered < 1e-6, 'not closed: '+r.uncovered+' uncovered')
	assert(r.volume_error < 1, 'volume error: '+r.volume_error)
	assert(r.make_faces_error < 1e-9, 'make_faces: '+r.make_faces_error)
}

function set_roof(h, pitch, edge_points) {
	h.floors[h.floors.length-1].roof = {pitch, overhang: 600, eave_h: -220,
		max_overhang: 1500, edge_points: edge_points ?? []}
}

// plans ---------------------------------------------------------------------

function house_with_floor(floor_i, lines, points) {
	let t = JSON.parse(JSON.stringify(ctx.house_test_plans.gable1))
	t.floors[floor_i] = {points: points ?? [], lines: lines}
	return ctx.house_plan(t)
}
function house_with_top(lines, points) {
	let floor_n = ctx.house_test_plans.gable1.floors.length
	return house_with_floor(floor_n-1, lines, points)
}

const L_lines = [
	['draw','a',0,0, 'b',6000, 'c',2000, 'd',-3000, 'e',2000, 'f',-3000,
		'a',-4000],
	['connect','p1','p2'],
]
const L_points = [[1500, 0, 'p1'], [1500, 4000, 'p2']]

function grid_lines(cols, rows) {
	let w = cols * 3000
	let h = rows * 3000
	let lines = [['draw', 0, 0, w, h, -w, -h]]
	for (let i = 1; i < cols; i++)
		lines.push(['draw', i * 3000, 0, 0, h])
	for (let j = 1; j < rows; j++)
		lines.push(['draw', 0, j * 3000, w])
	return lines
}

function grid_house(cols, rows, floor_n) {
	let floors = []
	for (let i = 0; i < floor_n; i++)
		floors.push({lines: grid_lines(cols, rows)})
	return ctx.house_plan({version: 1, floors})
}

// checks --------------------------------------------------------------------

check('gable1 as in the demo: gable 45', () => {
	let h = ctx.house_plan(ctx.house_test_plans.gable1)
	let r = house_report(h)
	check_solid(r)
	assert(r.face_n_by_tag.roof > 0)
})

check('hip 45 over gable1', () => {
	let h = ctx.house_plan(ctx.house_test_plans.gable1)
	set_roof(h, 45)
	check_solid(house_report(h))
})

check('hip 30 short / 45 long', () => {
	let h = ctx.house_plan(ctx.house_test_plans.gable1)
	set_roof(h, 45, [{x: 0, y: 2000, pitch: 30}, {x: 6000, y: 2000, pitch: 30}])
	check_solid(house_report(h))
})

check('L roof 37 / 52', () => {
	let h = house_with_top(L_lines, L_points)
	set_roof(h, 37, [{x: 4500, y: 2000, pitch: 52}, {x: 0, y: 2000, pitch: 52}])
	check_solid(house_report(h))
})

check('steep 75: the underside cuts below the wall tops', () => {
	let h = ctx.house_plan(ctx.house_test_plans.gable1)
	set_roof(h, 75)
	check_solid(house_report(h))
})

// a slot cut into the house, its sides gables, its end sloped: the
// overhang moves the gables into the slot, and with them the sides of the
// slot end's face inside the house. PRINT=1 prints the house state to paste
// into the house plan editor.
check('gables along a slot', () => {
	let h = ctx.house_plan({version: 1, floors: [{lines: [
		['draw', 0, 0, 4000, 3000, 1500, -3000, 4000, 7000, -9500, -7000],
	]}]})
	set_roof(h, 45, [{x: 4000, y: 1500, pitch: 90},
		{x: 5500, y: 1500, pitch: 90}])
	check_solid(house_report(h))
	if (process.env.PRINT)
		console.log(JSON.stringify(h.save_state()))
})

// a gable set back 2000 from the front eave next to it: the front eave
// reaches the gable's line at 2000 above the wall top and continues over the
// gable's run. PRINT=1 prints the house state to paste into the house plan
// editor.
check('sloped eave lines up with a gable', () => {
	let h = ctx.house_plan({version: 1, floors: [{lines: [
		['draw', 0, 0, 5000, 2000, 5000, 6000, -10000, -8000],
	]}]})
	set_roof(h, 45, [{x: 7500, y: 2000, pitch: 90}])
	check_solid(house_report(h))
	if (process.env.PRINT)
		console.log(JSON.stringify(h.save_state()))
})

check('hip roof over a 6x4 grid of rooms', () => {
	let h = grid_house(6, 4, 3)
	set_roof(h, 37, [{x: 0, y: 6000, pitch: 52}])
	check_solid(house_report(h))
})

check('random pitches', () => {
	let seed = 1
	function random() {
		seed = (seed * 16807) % 2147483647
		return seed / 2147483647
	}
	let n = +(process.env.SWEEP ?? 5)
	let tiny_n = 0
	for (let k = 0; k < n; k++) {
		let pitch = () => Math.round(20 + random() * 55)
		let edge_points = [
			{x: 0, y: 1000, pitch: pitch()}, {x: 6000, y: 1000, pitch: pitch()},
			{x: 1000, y: 0, pitch: pitch()}, {x: 1000, y: 4000, pitch: pitch()},
		]
		for (let make_house of [
			() => ctx.house_plan(ctx.house_test_plans.gable1),
			() => house_with_top(L_lines, L_points),
			() => house_with_floor(1, L_lines, L_points),
		]) {
			let h = make_house()
			set_roof(h, pitch(), edge_points)
			let r = house_report(h)
			check_solid(r)
			tiny_n += r.tiny_n
		}
	}
	if (process.env.SWEEP)
		console.log('sweep', n * 3, 'houses,', tiny_n, 'tiny faces')
})

// roofs on the parts of lower floors that stick out: make_faces() is
// closed. no reference volume: the upper roof's overhang is over the lower
// roof, and reference_volume() takes cutters that don't overlap.
check('roofs on lower floors', () => {
	let rect = (x, y, w, h) => ['draw', x, y, w, h, -w, -h]
	for (let floors of [
		// lean-to against the upper wall.
		[{lines: [rect(0, 0, 6000, 4000)]}, {lines: [rect(0, 0, 3000, 4000)]}],
		// lean-to as a terrace.
		[{lines: [rect(0, 0, 6000, 4000)],
			area_points: [{x: 4500, y: 2000, kind: 'terrace'}]},
			{lines: [rect(0, 0, 3000, 4000)]}],
		// an eave side runs on into the upper floor's wall.
		[{lines: [rect(0, 0, 6000, 4000)]},
			{lines: [rect(3000, 2000, 3000, 4000)]}],
		// upper floor inside: a roof all around it.
		[{lines: [rect(0, 0, 9000, 7000)]},
			{lines: [rect(3000, 2000, 3000, 3000)]}],
		// a wide second building: its hip roof is the floor's highest point,
		// so the lean-to's walls rise above the upper roof's overhang, and
		// both roofs cut them: the lower one wins.
		[{lines: [rect(0, 0, 6000, 4000), rect(9000, 0, 12000, 12000)]},
			{lines: [rect(0, 0, 3000, 4000)]}],
		// a gap between two upper parts, covered by the floor above.
		[{lines: [rect(0, 0, 6000, 4000)]},
			{lines: [rect(0, 0, 2000, 4000), rect(4000, 0, 2000, 4000)]},
			{lines: [rect(0, 0, 6000, 4000)]}],
	]) {
		let h = ctx.house_plan({version: 1, floors})
		let faces = h.make_faces(h.floors[h.floors.length-1], false)
		let r = union_report_of_faces(faces)
		assert(r.face_n_by_tag.roof > 0)
		let uncovered = uncovered_length(r.faces, (process.env.TOL ?? 2) / S
			+ 1e-9)
		assert(uncovered < 1e-6, 'not closed: '+uncovered+' uncovered')
	}
})

console.log(checks+' checks')

// bench ---------------------------------------------------------------------

if (process.env.BENCH) {
	for (let [cols, rows, floor_n] of [[3, 2, 2], [6, 4, 3], [10, 6, 3]]) {
		let h = grid_house(cols, rows, floor_n)
		set_roof(h, 37, [{x: 0, y: rows * 1500, pitch: 52}])
		let prisms = house_prisms(h, 200)
		let n = 5
		let t0 = performance.now()
		for (let i = 0; i < n; i++)
			prism_union(prisms)
		let ms = (performance.now() - t0) / n
		console.log(cols+'x'+rows+'x'+floor_n, ms.toFixed(1), 'ms per union')
	}
}
