// run: node tests/roof_skeleton_bench.js
// times roof_skeleton() on random column shapes of 2..6 and of 30..40
// columns, with random pitches.
// env SDK=dir times dir/www/roof_skeleton.js instead (a changed copy).
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
let file = path.join(process.env.SDK || sdk, 'www', 'roof_skeleton.js')
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})

let seed = 1
function random() {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
	return seed / 4294967296
}
function random_int(a, b) { return a + Math.floor(random() * (b - a + 1)) }

// same as roof_skeleton_test.js, with the column count range as arguments.
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
function random_columns_ring(k1, k2) {
	let k = random_int(k1, k2)
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

let pitch_choices = [30, 45, 60, Math.atan(0.5) * 180 / Math.PI]
function bench(name, n, k1, k2) {
	let shapes = []
	let edge_n = 0
	for (let i = 0; i < n; i++) {
		let ring = random_columns_ring(k1, k2)
		let pitches = ring.map(() => pitch_choices[random_int(0, 3)])
		shapes.push([ring, pitches, ring.map(() => 0)])
		edge_n += ring.length
	}
	let fails = 0
	let t0 = performance.now()
	for (let [ring, pitches, eave_zs] of shapes)
		try {
			ctx.roof_skeleton([ring], pitches, eave_zs)
		} catch (e) {
			fails++
		}
	let ms = performance.now() - t0
	console.log(name + ': ' + n + ' shapes, ' + (edge_n / n).toFixed(0)
		+ ' edges avg, ' + (ms / n).toFixed(3) + ' ms per shape'
		+ (fails ? ', ' + fails + ' failed' : ''))
}
bench('2..6 columns', 2000, 2, 6)
bench('30..40 columns', 50, 30, 40)
