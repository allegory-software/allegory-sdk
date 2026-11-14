// run: node tests/roof_skeleton_shuffle_probe_test.js
// runs roof_skeleton() on random column shapes with the live pieces in random
// order before each event search, and compares the roof heights with the
// unshuffled run: events at the same height must give one roof whatever
// order the code finds them in (investigation).
// env SDK=dir loads dir/www/roof_skeleton.js instead (a changed copy),
// N=shapes (default 1000), SHUFFLES=runs per shape (default 5).
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
// shuffle hook added after the dead pieces are removed.
let src = fs.readFileSync(path.join(process.env.SDK || sdk, 'www',
	'roof_skeleton.js'), 'utf8')
let hook_line = '\t\tpieces = live_pieces\n'
if (!src.includes(hook_line))
	throw new Error('hook line not found')
src = src.replace(hook_line, hook_line
	+ '\t\tif (G.shuffle_pieces) G.shuffle_pieces(pieces)\n')
vm.runInContext(src, ctx, {filename: 'roof_skeleton.js'})

let rad = Math.PI / 180

// 32-bit integer LCG: exact in doubles.
let seed = 1
function random() {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
	return seed / 4294967296
}
function random_int(a, b) { return a + Math.floor(random() * (b - a + 1)) }

let shuffle_seed = 1
function shuffle_random() {
	shuffle_seed = (Math.imul(shuffle_seed, 1664525) + 1013904223) >>> 0
	return shuffle_seed / 4294967296
}
function shuffle(a) {
	for (let i = a.length - 1; i > 0; i--) {
		let j = Math.floor(shuffle_random() * (i + 1))
		let v = a[i]
		a[i] = a[j]
		a[j] = v
	}
}

// same as roof_skeleton_test.js.
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
	return ring.map(([x, y]) => [y, x]).reverse()
}
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

// roof heights on a sample grid; null where no face covers the point.
function roof_zs(faces, ring) {
	let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
	for (let [x, y] of ring) {
		x1 = Math.min(x1, x); y1 = Math.min(y1, y)
		x2 = Math.max(x2, x); y2 = Math.max(y2, y)
	}
	let zs = []
	let n = 40
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			let x = x1 + (x2 - x1) * (i + 0.3719) / n
			let y = y1 + (y2 - y1) * (j + 0.6131) / n
			if (!hit_rings([ring], x, y))
				continue
			let z = null
			for (let face of faces)
				if (hit_rings(face.rings, x, y)) {
					let [a, b, c] = face.plane
					z = a * x + b * y + c
				}
			zs.push([x, y, z])
		}
	}
	return zs
}

let N = +(process.env.N || 1000)
let SHUFFLES = +(process.env.SHUFFLES || 5)
let pitch_choices = [30, 45, 60, 90, Math.atan(0.5) / rad]
let fails = 0
let crashes = 0 // unshuffled runs that failed an assert
for (let i = 0; i < N; i++) {
	let wall_ring = random_columns_ring()
	if (i & 1)
		wall_ring = swap_xy(wall_ring)
	let pitches = wall_ring.map(() => pitch_choices[random_int(0, 4)])
	if (!pitches.some(p => p != 90))
		pitches[0] = 45
	for (let d of [0, .2]) {
		let n = wall_ring.length
		let ds = []
		let eave_zs = []
		for (let k = 0; k < n; k++) {
			let pitch = pitches[k]
			let is_moving = pitch != 90
				|| is_convex(wall_ring, k) && is_convex(wall_ring, (k + 1) % n)
			ds.push(is_moving ? d : 0)
			eave_zs.push(pitch == 90 ? 0 : -d * Math.tan(pitch * rad))
		}
		let ring = offset_ring(wall_ring, ds)
		ctx.shuffle_pieces = null
		let zs0
		try {
			zs0 = roof_zs(ctx.roof_skeleton([ring], pitches, eave_zs), ring)
		} catch (e) {
			crashes++
			console.log('CRASH', i, 'overhang', d, JSON.stringify(wall_ring),
				JSON.stringify(pitches), e.message)
			continue
		}
		ctx.shuffle_pieces = shuffle
		for (let s = 0; s < SHUFFLES; s++) {
			let err
			let zs1
			try {
				zs1 = roof_zs(ctx.roof_skeleton([ring], pitches, eave_zs), ring)
			} catch (e) {
				err = e.message
			}
			if (!err)
				for (let k = 0; k < zs0.length; k++) {
					let z0 = zs0[k][2]
					let z1 = zs1[k][2]
					if (z0 == null ? z1 != null
							: z1 == null || Math.abs(z0 - z1) > 1e-6) {
						err = 'z ' + z1 + ' != ' + z0 + ' at ' + zs0[k][0]
							+ ',' + zs0[k][1]
						break
					}
				}
			if (err) {
				fails++
				console.log('FAIL', i, 'overhang', d, JSON.stringify(wall_ring),
					JSON.stringify(pitches), err)
				break
			}
		}
	}
}
console.log(N + ' shapes, ' + fails + ' order-dependent runs, '
	+ crashes + ' crashes')
