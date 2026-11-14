// run: node tests/prism_union_test.js
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
for (let name of ['glue.js', 'clipper2.js', 'prism_union.js']) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
const prism_union = ctx.prism_union

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

// geometry helpers ----------------------------------------------------------

// a rectangle in plan coords, as a path on the grid.
function rect_path(x1, y1, x2, y2) {
	let s = prism_union.grid_scale
	x1 *= s
	y1 *= s
	x2 *= s
	y2 *= s
	return [{x: x1, y: y1}, {x: x2, y: y1}, {x: x2, y: y2}, {x: x1, y: y2}]
}

function box(x1, y1, x2, y2, z1, z2) {
	return {
		paths: [rect_path(x1, y1, x2, y2)],
		bottom: [0, 0, z1],
		top: [0, 0, z2],
	}
}

// area vector of a face: its normal times its area. holes are cw seen from
// outside, so they subtract.
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

// a closed surface: the area vectors sum to zero. its volume, from the
// divergence theorem, is positive when the faces are ccw seen from outside.
function check_solid(faces, volume) {
	let sx = 0
	let sy = 0
	let sz = 0
	let v = 0
	for (let face of faces) {
		let [ax, ay, az] = face_area_vector(face)
		let [x, y, z] = face.rings[0][0]
		sx += ax
		sy += ay
		sz += az
		v += (ax * x + ay * y + az * z) / 3
	}
	assert(Math.abs(sx) < NEAR && Math.abs(sy) < NEAR && Math.abs(sz) < NEAR,
		'not closed: '+[sx, sy, sz])
	assert(Math.abs(v - volume) < NEAR, 'volume '+v+' != '+volume)
}

// faces whose normal is (nx, ny, nz).
function faces_facing(faces, nx, ny, nz) {
	let a = []
	for (let face of faces) {
		let [ax, ay, az] = face_area_vector(face)
		let len = Math.hypot(ax, ay, az)
		if (Math.abs(ax / len - nx) < NEAR && Math.abs(ay / len - ny) < NEAR
				&& Math.abs(az / len - nz) < NEAR)
			a.push(face)
	}
	return a
}

function ring_point_count(face) {
	let a = []
	for (let ring of face.rings)
		a.push(ring.length)
	return a
}

// checks --------------------------------------------------------------------

check('one box: six rectangles', () => {
	let faces = prism_union([box(0, 0, 10, 20, 0, 30)])
	assert.equal(faces.length, 6)
	for (let face of faces)
		assert.deepEqual(ring_point_count(face), [4])
	check_solid(faces, 10 * 20 * 30)
})

check('input rings are filled even-odd, in any direction', () => {
	let prism = box(0, 0, 10, 20, 0, 30)
	prism.paths[0].reverse()
	let faces = prism_union([prism])
	assert.equal(faces.length, 6)
	check_solid(faces, 10 * 20 * 30)
})

check('boxes side by side: one face per side', () => {
	let faces = prism_union([
		box( 0, 0, 10, 10, 0, 10),
		box(10, 0, 20, 10, 0, 10),
	])
	assert.equal(faces.length, 6)
	for (let face of faces)
		assert.deepEqual(ring_point_count(face), [4])
	check_solid(faces, 2000)
})

check('stacked boxes: no faces where they touch', () => {
	let faces = prism_union([
		box(0, 0, 10, 10,  0, 10),
		box(0, 0, 10, 10, 10, 20),
	])
	assert.equal(faces.length, 6)
	let [top, ...rest] = faces_facing(faces, 0, 0, 1)
	assert.equal(rest.length, 0)
	assert.equal(top.rings[0][0][2], 20)
	check_solid(faces, 2000)
})

check('overlapping boxes: one solid', () => {
	let faces = prism_union([
		box(0, 0, 10, 10, 0, 10),
		box(5, 0, 15, 10, 5, 15),
	])
	check_solid(faces, 1000 + 1000 - 5 * 10 * 5)
	let [front, ...rest] = faces_facing(faces, 0, -1, 0)
	assert.equal(rest.length, 0)
	assert.equal(front.rings[0].length, 8)
})

check('L shape: one top face with six corners', () => {
	let faces = prism_union([
		box(0,  0, 20, 10, 0, 10),
		box(0, 10, 10, 20, 0, 10),
	])
	assert.equal(faces.length, 8)
	let [top] = faces_facing(faces, 0, 0, 1)
	assert.deepEqual(ring_point_count(top), [6])
	check_solid(faces, 3000)
})

check('box with a hole: faces inside the hole face inward', () => {
	let prism = box(0, 0, 30, 30, 0, 10)
	prism.paths.push(rect_path(10, 10, 20, 20))
	let faces = prism_union([prism])
	assert.equal(faces.length, 10)
	let [top] = faces_facing(faces, 0, 0, 1)
	assert.deepEqual(ring_point_count(top), [4, 4])
	// the hole's side at x = 10 faces -x, into the hole.
	let sides = faces_facing(faces, -1, 0, 0)
	assert.equal(sides.length, 2)
	check_solid(faces, (900 - 100) * 10)
})

check('a gap between boxes makes a hole in the side face', () => {
	let faces = prism_union([
		box( 0, 0, 30, 10,  0, 10),
		box( 0, 0, 10, 10, 10, 20),
		box(20, 0, 30, 10, 10, 20),
		box( 0, 0, 30, 10, 20, 30),
	])
	let [front, ...rest] = faces_facing(faces, 0, -1, 0)
	assert.equal(rest.length, 0)
	assert.deepEqual(ring_point_count(front), [4, 4])
	let gap_floors = faces_facing(faces, 0, 0, 1)
	assert.equal(gap_floors.length, 2) // the gap's floor and the top.
	check_solid(faces, 30 * 10 * 30 - 10 * 10 * 10)
})

check('sloped top: trapezoid sides, one sloped face', () => {
	let prism = box(0, 0, 10, 10, 0, 0)
	prism.top = [0.5, 0, 10] // z = 10 at x = 0, 15 at x = 10.
	let faces = prism_union([prism])
	assert.equal(faces.length, 6)
	let up = faces.filter(face => face_area_vector(face)[2] > NEAR)
	assert.equal(up.length, 1)
	let zs = [...up[0].rings[0]].map(([x, y, z]) => z).sort((z1, z2) => z1 - z2)
	assert.deepEqual(zs, [10, 10, 15, 15])
	check_solid(faces, 10 * 10 * 12.5)
})

check('sloped box beside a flat box: the side faces merge', () => {
	let sloped = box(0, 0, 10, 10, 0, 0)
	sloped.top = [0.5, 0, 10]
	let faces = prism_union([sloped, box(10, 0, 20, 10, 0, 10)])
	let [front, ...rest] = faces_facing(faces, 0, -1, 0)
	assert.equal(rest.length, 0)
	assert.deepEqual(ring_point_count(front), [6])
	// the sloped box's side above the flat box.
	let [step] = faces_facing(faces, 1, 0, 0)
		.filter(face => face.rings[0][0][0] == 10)
	let zs = [...step.rings[0]].map(([x, y, z]) => z).sort((z1, z2) => z1 - z2)
	assert.deepEqual(zs, [10, 10, 15, 15])
	check_solid(faces, 1250 + 1000)
})

check('planes crossing in a cell: assert', () => {
	let sloped = box(0, 0, 10, 10, 0, 0)
	sloped.top = [0.5, 0, 10]
	assert.throws(() => prism_union([sloped, box(0, 0, 10, 10, 12, 20)]))
})

check('no prisms: no faces', () => {
	assert.equal(prism_union([]).length, 0)
})

console.log(checks + ' prism_union checks passed')
