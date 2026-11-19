// run: node tests/house_plan_faces_probe_test.js plan1.json ...
// makes the faces of each floor of each plan file and reports bad rings
// and faces that earcut cannot triangulate.
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
let files = ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js',
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js',
	'house_plan.js']
for (let name of files) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}

// project a face's rings to 2D by dropping its normal's dominant axis.
function flat_rings(rings) {
	let nx = 0, ny = 0, nz = 0
	let r = rings[0]
	for (let i = 0; i < r.length; i++) {
		let [x1, y1, z1] = r[i]
		let [x2, y2, z2] = r[(i+1) % r.length]
		nx += (y1 - y2) * (z1 + z2)
		ny += (z1 - z2) * (x1 + x2)
		nz += (x1 - x2) * (y1 + y2)
	}
	let ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz)
	let drop = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2
	let data = []
	let holes = []
	for (let ring of rings) {
		if (data.length)
			holes.push(data.length / 2)
		for (let p of ring) {
			let q = p.filter((_, k) => k != drop)
			data.push(q[0], q[1])
		}
	}
	return [data, holes]
}

function check_faces(label, faces) {
	for (let fi = 0; fi < faces.length; fi++) {
		let face = faces[fi]
		let problems = []
		for (let ri = 0; ri < face.rings.length; ri++) {
			let ring = face.rings[ri]
			if (ring.length < 3)
				problems.push('ring '+ri+' has '+ring.length+' points')
			for (let p of ring)
				for (let v of p)
					if (!isFinite(v)) {
						problems.push('ring '+ri+' has non-finite '+p)
						break
					}
		}
		let [data, holes] = flat_rings(face.rings)
		try {
			ctx.earcut(data, holes, 2, [])
		} catch (e) {
			problems.push('earcut: '+e.message)
		}
		if (problems.length)
			console.error(label, 'face', fi, face.tag,
				JSON.stringify(face.rings), problems)
	}
}

for (let file of process.argv.slice(2)) {
	let house = ctx.house_plan(JSON.parse(fs.readFileSync(file, 'utf8')))
	let floors = house.floors
	for (let floor of floors) {
		check_faces(file+' cut '+floor.i, house.make_faces(floor, true))
	}
	check_faces(file+' all', house.make_faces(floors[floors.length-1], false))
}
