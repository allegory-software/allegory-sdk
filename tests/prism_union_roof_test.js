// run: node tests/prism_union_roof_test.js
// env: SWEEP=n (n random pitch sets per plan), BENCH=1, VERBOSE=1.
// roof bodies as prisms in prism_union(), over the walls and slabs of the
// house: one prism per roof face, 20 cm thick. hip and valley lines are
// diagonal, so the union has to round their crossings with wall edges the
// same way on both sides. checks that the union is a closed solid of the
// right volume, with no side faces along diagonals.
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
let files = ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js',
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js', 'house_plan.js']
for (let name of files) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
vm.runInContext(fs.readFileSync(path.join(sdk, 'www/ui-demo.html'), 'utf8')
	.match(/<script id=house_test_plans>([\s\S]*?)<\/script>/)[1], ctx)

const {prism_union, clipper2} = ctx
const S = prism_union.grid_scale
const EO = clipper2.FillRule.EvenOdd

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

// plan area of grid paths filled even-odd, in plan units.
function paths_area(paths) {
	let a = 0
	for (let path of clipper2.union(paths, [], EO))
		a += clipper2.area(path)
	return a / (S * S)
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

// the house's walls and slabs, as make_faces() builds them (no open rooms),
// plus one roof body prism per roof face: vertical thickness roof_t over the
// face, which meets the wall tops only on the eave lines, so nothing cuts.
function house_prisms(h, roof_t) {
	let prisms = []
	let slab_t = h.slab_thickness
	let floors = h.floors
	let volume = 0
	for (let floor of floors) {
		let paths = skin_paths(floor)
		prisms.push({paths, bottom: [0, 0, floor.z + slab_t],
			top: [0, 0, floor.z + floor.h]})
		volume += paths_area(paths) * (floor.h - slab_t)
	}
	for (let i = 0; i < floors.length; i++) {
		let floor0 = floors[i-1]
		let floor1 = floors[i]
		let paths = [
			...(floor0 ? outline_paths(floor0) : []),
			...outline_paths(floor1),
		]
		paths = clipper2.union(paths, [], clipper2.FillRule.NonZero)
		let z = floor1.z
		prisms.push({paths, bottom: [0, 0, z], top: [0, 0, z + slab_t]})
		volume += paths_area(paths) * slab_t
	}
	let top_floor = floors[floors.length-1]
	for (let face of top_floor.make_roof_faces()) {
		let ring = face.rings[0]
		let [a, b, c] = face.plane
		let paths = [ring_path(ring)]
		prisms.push({paths, bottom: [a, b, c], top: [a, b, c + roof_t]})
		volume += paths_area(paths) * roof_t
	}
	return {prisms, volume}
}

// what's wrong with the union of the prisms. tiny faces are the steps where
// two roof planes meet on a rounded line: part of the rounded solid.
function union_report(prisms, volume) {
	let t0 = performance.now()
	let faces = prism_union(prisms)
	let ms = performance.now() - t0
	let sx = 0
	let sy = 0
	let sz = 0
	let v = 0
	let diagonal_side_n = 0
	let tiny_n = 0
	for (let face of faces) {
		let [ax, ay, az] = face_area_vector(face)
		let [x, y, z] = face.rings[0][0]
		sx += ax
		sy += ay
		sz += az
		v += (ax * x + ay * y + az * z) / 3
		let len = Math.hypot(ax, ay, az)
		if (len < 1) {
			tiny_n++
			continue
		}
		let is_side = Math.abs(az) < 1e-9 * len
		let is_axis = Math.abs(ax) < 1e-9 * len || Math.abs(ay) < 1e-9 * len
		if (is_side && !is_axis) {
			diagonal_side_n++
			if (process.env.VERBOSE)
				console.log('  diagonal side face', len.toFixed(4),
					JSON.stringify(face.rings))
		}
	}
	return {
		face_n: faces.length,
		open: Math.hypot(sx, sy, sz),
		volume_error: Math.abs(v - volume) / volume,
		diagonal_side_n,
		tiny_n,
		ms: Math.round(ms),
	}
}

function check_solid(r) {
	assert(r.open < 1e-3, 'not closed: '+r.open)
	assert(r.volume_error < 1e-9, 'volume error: '+r.volume_error)
	assert.equal(r.diagonal_side_n, 0)
}

function set_roof(h, pitch, edge_points) {
	h.floors[h.floors.length-1].roof = {pitch, overhang: 60,
		edge_points: edge_points ?? []}
}

function house_report(h) {
	let {prisms, volume} = house_prisms(h, 20)
	let r = union_report(prisms, volume)
	if (process.env.VERBOSE)
		console.log(JSON.stringify(r))
	return r
}

// plans ---------------------------------------------------------------------

// gable1 with its floor floor_i drawn from `lines`.
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
	['draw','a',0,0, 'b',600, 'c',200, 'd',-300, 'e',200, 'f',-300, 'a',-400],
	['connect','p1','p2'],
]
const L_points = [[150, 0, 'p1'], [150, 400, 'p2']]

// a cols x rows grid of 300 x 300 rooms.
function grid_lines(cols, rows) {
	let w = cols * 300
	let h = rows * 300
	let lines = [['draw', 0, 0, w, h, -w, -h]]
	for (let i = 1; i < cols; i++)
		lines.push(['draw', i * 300, 0, 0, h])
	for (let j = 1; j < rows; j++)
		lines.push(['draw', 0, j * 300, w])
	return lines
}

function grid_house(cols, rows, floor_n) {
	let floors = []
	for (let i = 0; i < floor_n; i++)
		floors.push({lines: grid_lines(cols, rows)})
	return ctx.house_plan({floors})
}

// checks --------------------------------------------------------------------

check('hip 45 over gable1', () => {
	let h = ctx.house_plan(ctx.house_test_plans.gable1)
	set_roof(h, 45)
	check_solid(house_report(h))
})

check('hip 30 short / 45 long: a snapped point on a wall edge is kept', () => {
	let h = ctx.house_plan(ctx.house_test_plans.gable1)
	set_roof(h, 45, [{x: 0, y: 200, pitch: 30}, {x: 600, y: 200, pitch: 30}])
	check_solid(house_report(h))
})

check('L roof 37 / 52: planes of the two sides cross along a hip', () => {
	let h = house_with_top(L_lines, L_points)
	set_roof(h, 37, [{x: 450, y: 200, pitch: 52}, {x: 0, y: 200, pitch: 52}])
	check_solid(house_report(h))
})

check('walls below cross the hips away from grid points', () => {
	let h = house_with_floor(1, L_lines, L_points)
	set_roof(h, 37, [{x: 0, y: 200, pitch: 52}, {x: 600, y: 200, pitch: 52}])
	check_solid(house_report(h))
})

check('hip roof over a 6x4 grid of rooms', () => {
	let h = grid_house(6, 4, 3)
	set_roof(h, 37, [{x: 0, y: 600, pitch: 52}])
	check_solid(house_report(h))
})

check('random pitches', () => {
	let seed = 1
	function random() {
		seed = (seed * 16807) % 2147483647
		return seed / 2147483647
	}
	let n = +(process.env.SWEEP ?? 10)
	let tiny_n = 0
	for (let k = 0; k < n; k++) {
		let pitch = () => Math.round(20 + random() * 45)
		let edge_points = [
			{x: 0, y: 100, pitch: pitch()}, {x: 600, y: 100, pitch: pitch()},
			{x: 100, y: 0, pitch: pitch()}, {x: 100, y: 400, pitch: pitch()},
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

console.log(checks+' checks')

// bench ---------------------------------------------------------------------

if (process.env.BENCH) {
	for (let [cols, rows, floor_n] of [[3, 2, 2], [6, 4, 3], [10, 6, 3]]) {
		let h = grid_house(cols, rows, floor_n)
		set_roof(h, 37, [{x: 0, y: rows * 150, pitch: 52}])
		let {prisms, volume} = house_prisms(h, 20)
		let n = 5
		let t0 = performance.now()
		for (let i = 0; i < n; i++)
			prism_union(prisms)
		let ms = (performance.now() - t0) / n
		console.log(cols+'x'+rows+'x'+floor_n, ms.toFixed(1), 'ms per union')
	}
}
