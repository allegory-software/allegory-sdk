// run: node tests/roof_line_drag_probe_test.js
// investigation: drags the north-east hip of a 600 x 400 hip roof (outer
// skin x -14..614, y -14..414, pitch 20) to every pointer position on a
// grid and prints a map of what the roof becomes:
//   o  the two faces share a line through the pointer
//   s  both faces exist, but their shared line misses the pointer
//   n  no shared line: the faces are not neighbors anymore
//   g  a face is gone (vertical or covered by other faces)
//   x  blocked: move() returned false
//   *  the grabbed point
// env Z=dz grabs the hip dz above the wall top (default 50); env STEP=d sets
// the grid step (default 25); env SIDES=n,e picks the two faces (n, e, s, w).
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

function rect_lines(x, y, w, h) {
	return ['draw', x, y, w, 0, 0, h, -w, 0, 0, -h]
}

function roof(f) {
	let sides = []
	let faces = f.make_roof_faces(f.make_areas(), sides)
	let by_dir = {faces: faces}
	for (let side of sides)
		by_dir[side.nx < 0 ? 'w' : side.nx > 0 ? 'e' : side.ny < 0 ? 'n' : 's']
			= side
	return by_dir
}

function face_of(by_dir, dir) {
	return by_dir.faces.find(face => face.sides.includes(by_dir[dir]))
}

// same test as the editor's has_roof_face_edge().
function has_edge(face, p, q, x, y) {
	let [px, py] = p
	let [qx, qy] = q
	for (let ring of face.rings) {
		for (let i = 0, n = ring.length; i < n; i++) {
			let [x1, y1] = ring[i]
			let [x2, y2] = ring[(i+1) % n]
			let dx = x2 - x1
			let dy = y2 - y1
			let near = 1e-5 * Math.hypot(dx, dy)
			if (Math.abs((px - x1) * dy - (py - y1) * dx) > near)
				continue
			if (Math.abs((qx - x1) * dy - (qy - y1) * dx) > near)
				continue
			let t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
			if (t < 0 || t > 1)
				continue
			return true
		}
	}
	return false
}

// the edges of face1 that face2 also has.
function shared_edges(face1, face2) {
	let edges = []
	for (let ring of face1.rings)
		for (let i = 0, n = ring.length; i < n; i++) {
			let p = ring[i]
			let q = ring[(i+1) % n]
			if (has_edge(face2, p, q, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2))
				edges.push([p, q])
		}
	return edges
}

function on_edges(edges, x, y) {
	for (let [p, q] of edges) {
		let dx = q[0] - p[0]
		let dy = q[1] - p[1]
		let len = Math.hypot(dx, dy)
		let t = ((x - p[0]) * dx + (y - p[1]) * dy) / (len * len)
		let d = Math.abs((x - p[0]) * dy - (y - p[1]) * dx) / len
		if (t >= -1e-6 && t <= 1 + 1e-6 && d < 1e-3)
			return true
	}
	return false
}

let dz = Number(process.env.Z ?? 500)
let step = Number(process.env.STEP ?? 250)
let [dir1, dir2] = (process.env.SIDES ?? 'n,e').split(',')
let f = ctx.house_plan({version: 1,
	floors: [{lines: [rect_lines(0, 0, 6000, 4000)]}]})
	.floors[0]
let wall_z = f.z + f.h
let z = wall_z + dz
let by_dir0 = roof(f)
let face1 = face_of(by_dir0, dir1)
let face2 = face_of(by_dir0, dir2)
// the grabbed point: on the shared line at height z.
let grab_x, grab_y
for (let [p, q] of shared_edges(face1, face2)) {
	let [x1, y1, z1] = p
	let [x2, y2, z2] = q
	if ((z - z1) * (z - z2) > 0)
		continue
	let t = (z - z1) / (z2 - z1)
	grab_x = x1 + t * (x2 - x1)
	grab_y = y1 + t * (y2 - y1)
}
console.log('grab', grab_x?.toFixed(1), grab_y?.toFixed(1), 'z +' + dz)
let counts = {}
for (let y = -500; y <= 4500; y += step) {
	let row = ''
	for (let x = -500; x <= 6500; x += step) {
		if (grab_x != null && Math.abs(x - grab_x) < step / 2
			&& Math.abs(y - grab_y) < step / 2
		) {
			row += '*'
			continue
		}
		let m = f.start_move_faces([face1, face2], z)
		let ch
		if (!m.move(x, y)) {
			ch = 'x'
		} else {
			let by_dir = roof(f)
			let f1 = face_of(by_dir, dir1)
			let f2 = face_of(by_dir, dir2)
			if (!f1 || !f2) {
				ch = 'g'
			} else {
				let edges = shared_edges(f1, f2)
				ch = !edges.length ? 'n' : on_edges(edges, x, y) ? 'o' : 's'
			}
		}
		m.cancel()
		counts[ch] = (counts[ch] ?? 0) + 1
		row += ch
	}
	console.log(row)
}
console.log(JSON.stringify(counts))
