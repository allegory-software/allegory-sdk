// run: node tests/roof_skeleton_order_probe_test.js [RING PITCHES [EDGE_I...]]
// RING and PITCHES are JSON; faces of EDGE_I are printed (default 6 14).
// env SDK=dir loads dir/www/roof_skeleton.js instead (a changed copy).
// prints the events of roof_skeleton() for a plan where three events happen
// at the same height, with and without overhang: the result depends on the
// order in which the code takes them (investigation).
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const sdk = path.resolve(__dirname, '..')
const ctx = {console, setTimeout, clearTimeout, TextEncoder, TextDecoder,
	URL, URLSearchParams, performance, Intl, atob, btoa, queueMicrotask}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(path.join(sdk, 'www', 'glue.js'), 'utf8'),
	ctx, {filename: 'glue.js'})
// event log hook added before the event dispatch.
let src = fs.readFileSync(path.join(process.env.SDK || sdk, 'www',
	'roof_skeleton.js'), 'utf8')
let dispatch = '\t\tt = max(t, ev_t)\n'
// changed copy with collapses found apart from the other events.
let dispatch1 = '\t\tt = max(t, t1)\n'
if (src.includes(dispatch))
	src = src.replace(dispatch, dispatch
		+ '\t\tG.log_event(ev_is_start ? "start" : ev_c ? "collide" : "collapse",'
		+ ' ev_t, ev_a, ev_c)\n')
else if (src.includes(dispatch1))
	src = src.replace(dispatch1, dispatch1
		+ '\t\tif (is_collapse) G.log_event("collapse", cl_t, cl_e)\n'
		+ '\t\telse G.log_event(ev_is_start ? "start" : "collide",'
		+ ' ev_t, ev_a, ev_c)\n')
else
	throw new Error('dispatch line not found')
// env SHUFFLE=seed: live pieces in random order before each event search.
let hook_line = '\t\tpieces = live_pieces\n'
src = src.replace(hook_line, hook_line
	+ '\t\tif (G.shuffle_pieces) G.shuffle_pieces(pieces)\n')
let shuffle_seed = +(process.env.SHUFFLE || 0)
if (shuffle_seed)
	ctx.shuffle_pieces = function(a) {
		for (let i = a.length - 1; i > 0; i--) {
			shuffle_seed = (Math.imul(shuffle_seed, 1664525) + 1013904223) >>> 0
			let j = Math.floor(shuffle_seed / 4294967296 * (i + 1))
			let v = a[i]
			a[i] = a[j]
			a[j] = v
		}
	}
vm.runInContext(src, ctx, {filename: 'roof_skeleton.js'})

let rad = Math.PI / 180
let events
ctx.log_event = function(type, t, a, c) {
	let s = type + ' t=' + t.toFixed(15) + ' a=' + a.plane.edge_is.join(',')
	if (c)
		s += ' c=' + c.plane.edge_is.join(',')
	events.push(s)
}

let face_edge_is = [6, 14]
let wall_ring = [[8,0],[8,5],[4,5],[4,8],[7,8],[7,13],[9,13],[9,18],[10,18],
	[10,23],[6,23],[6,21],[3,21],[3,18],[5,18],[5,13],[0,13],[0,8],[2,8],[2,5],
	[0,5],[0,0]]
let sh = Math.atan(.5) / rad
let pitches = [45,30,sh,60,90,sh,sh,90,45,45,90,45,sh,60,sh,60,sh,45,60,30,
	45,30]
if (process.argv[2]) {
	wall_ring = JSON.parse(process.argv[2])
	pitches = JSON.parse(process.argv[3])
	face_edge_is = process.argv.slice(4).map(Number)
}

// same as roof_skeleton_test.js.
function is_convex(ring, i) {
	let n = ring.length
	let [x0, y0] = ring[(i + n - 1) % n]
	let [x1, y1] = ring[i]
	let [x2, y2] = ring[(i + 1) % n]
	return (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1) > 0
}
function offset_ring(ring, ds) {
	let ring1 = []
	for (let i = 0, n = ring.length; i < n; i++) {
		let [x0, y0] = ring[(i + n - 1) % n]
		let [x1, y1] = ring[i]
		let [x2, y2] = ring[(i + 1) % n]
		let d0 = ds[(i + n - 1) % n]
		let d1 = ds[i]
		let nx = d0 * Math.sign(y1 - y0) + d1 * Math.sign(y2 - y1)
		let ny = -d0 * Math.sign(x1 - x0) - d1 * Math.sign(x2 - x1)
		ring1.push([x1 + nx, y1 + ny])
	}
	return ring1
}

function run(d) {
	let n = wall_ring.length
	let ds = []
	let eave_zs = []
	for (let i = 0; i < n; i++) {
		let pitch = pitches[i]
		let is_moving = pitch != 90
			|| is_convex(wall_ring, i) && is_convex(wall_ring, (i + 1) % n)
		ds.push(is_moving ? d : 0)
		eave_zs.push(pitch == 90 ? 0 : -d * Math.tan(pitch * rad))
	}
	events = []
	let faces = []
	try {
		faces = ctx.roof_skeleton([offset_ring(wall_ring, ds)], pitches,
			eave_zs)
	} catch (e) {
		events.push('ERROR ' + e.message)
	}
	console.log('overhang ' + d + ': time 0 at z ' + Math.min(...eave_zs
		.filter((z, i) => pitches[i] != 90)))
	for (let s of events)
		console.log('  ' + s)
	for (let face of faces)
		if (face.edge_is.some(ei => face_edge_is.includes(ei)))
			console.log('  face ' + face.edge_is.join(',') + ' '
				+ JSON.stringify(face.rings[0].map(([x, y, z]) =>
					[+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)])))
}
run(0)
run(.2)
