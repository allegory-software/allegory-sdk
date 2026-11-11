// run: node tests/plane_graph_test.js
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
for (let name of ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js']) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}

const {plane_graph} = ctx

// overlapping, nested, touching and separate intervals ----------------------

function check_intervals(a, b, c, v, reverse) {
	let g = plane_graph()
	g.orthogonal = true
	let expected = new Set()
	for (let [m1, m2] of [a, b, c]) {
		for (let m = m1; m < m2; m++)
			expected.add(m)
		let p1 = g.add_point(v ? 0 : m1, v ? m1 : 0)
		let p2 = g.add_point(v ? 0 : m2, v ? m2 : 0)
		g.add_seg(reverse ? p2 : p1, reverse ? p1 : p2)
	}
	g.fix()
	let actual = new Set()
	for (let s of g.segs) {
		for (let m = s.m1; m < s.m2; m++) {
			assert(!actual.has(m), 'duplicate coverage')
			actual.add(m)
		}
	}
	assert.deepEqual(actual, expected, 'changed interval coverage')
	g.free()
}

let intervals = []
for (let a = 0; a < 5; a++)
	for (let b = a+1; b <= 5; b++)
		intervals.push([a, b])

let n_intervals = 0
for (let v = 0; v < 2; v++)
	for (let reverse = 0; reverse < 2; reverse++)
		for (let a of intervals)
			for (let b of intervals)
				for (let c of intervals) {
					try {
						check_intervals(a, b, c, v, reverse)
					} catch (e) {
						console.error('intervals:', a, b, c, 'vertical:', v,
							'reversed:', reverse)
						throw e
					}
					n_intervals++
				}

// cycle counts for every nonempty subset of a 3x3 point grid -----------------

let edges = []
for (let x = 0; x < 3; x++)
	for (let y = 0; y < 3; y++) {
		if (x < 2) edges.push([[x, y], [x+1, y]])
		if (y < 2) edges.push([[x, y], [x, y+1]])
	}

let n_grids = 0
for (let mask = 1; mask < 4096; mask++) {
	let g = plane_graph()
	g.orthogonal = true
	for (let i = 0; i < edges.length; i++)
		if (mask & (1 << i)) {
			let [a, b] = edges[i]
			g.add_seg(g.add_point(...a), g.add_point(...b))
		}
	g.fix()
	let n = 0
	for (let c of g.comps)
		n += c.cycles.length - 1
	assert.equal(n, g.segs.length - g.ps.length + g.comps.length,
		'wrong cycle count for grid mask ' + mask)
	g.free()
	n_grids++
}

// nearby endpoints in orthogonal graphs ------------------------------------

let endpoint_cases = [
	['parallel walls', [
		[[0, 0], [10, 0]],
		[[0, .000001], [10, .000001]],
	]],
	['collinear gap', [
		[[0, 0], [10, 0]],
		[[10.000001, 0], [20, 0]],
	]],
	['offset collinear ends', [
		[[0, 0], [10, 0]],
		[[10, .000001], [20, .000001]],
	]],
	['offset perpendicular ends', [
		[[0, 0], [10, 0]],
		[[10.000001, .000001], [10.000001, 10]],
	]],
]
let n_endpoints = 0
for (let [name, lines] of endpoint_cases)
	for (let v = 0; v < 2; v++)
		for (let reverse = 0; reverse < 2; reverse++) {
			let g = plane_graph()
			g.orthogonal = true
			let ps = []
			for (let line of lines) {
				let ends = []
				for (let [x, y] of line) {
					if (v) [x, y] = [y, x]
					let p = g.add_point(x, y)
					ps.push([p, x, y])
					ends.push(p)
				}
				g.add_seg(ends[reverse], ends[1-reverse])
			}
			g.fix()
			assert.equal(g.comps.length, 2, name)
			assert.equal(g.segs.length, 2, name)
			for (let [p, x, y] of ps) {
				assert(g.ps.includes(p), name)
				assert.equal(p[0], x, name)
				assert.equal(p[1], y, name)
			}
			g.free()
			n_endpoints++
		}

// short connections between nearby junctions -------------------------------

let junction_lines = [
	[[0, 0], [10, 0]],
	[[5, -1], [5, 1]],
	[[5.000001, -1], [5.000001, 1]],
]
let n_junctions = 0
for (let v = 0; v < 2; v++)
	for (let reverse = 0; reverse < 2; reverse++) {
		let g = plane_graph()
		g.orthogonal = true
		for (let line of junction_lines) {
			let ends = []
			for (let [x, y] of line) {
				if (v) [x, y] = [y, x]
				ends.push(g.add_point(x, y))
			}
			g.add_seg(ends[reverse], ends[1-reverse])
		}
		g.fix()
		assert.equal(g.comps.length, 1, 'nearby junctions disconnected')
		assert.equal(g.segs.length, 7)
		let short_seg
		for (let s of g.segs)
			if (s.is_v == !!v && s.axis == 0
				&& s.m1 == 5 && s.m2 == 5.000001)
				short_seg = s
		assert(short_seg, 'missing connection between nearby junctions')
		assert.equal(short_seg[0].segs.length, 4)
		assert.equal(short_seg[1].segs.length, 4)
		g.free()
		n_junctions++
	}

// zero-length segments in orthogonal graphs --------------------------------

let null_graph = plane_graph()
null_graph.orthogonal = true
null_graph.add_seg(null_graph.add_point(0, 0), null_graph.add_point(0, 0))
null_graph.fix()
assert.equal(null_graph.segs.length, 0)
assert.equal(null_graph.ps.length, 0)
null_graph.free()

// short segments in nonorthogonal graphs -----------------------------------

let short_graph = plane_graph()
short_graph.orthogonal = false
short_graph.add_seg(short_graph.add_point(0, 0),
	short_graph.add_point(.000001, 0))
short_graph.fix()
assert.equal(short_graph.segs.length, 0)
assert.equal(short_graph.ps.length, 0)
short_graph.free()

// tolerant endpoint merging in nonorthogonal graphs ------------------------

let tolerant_graph = plane_graph()
tolerant_graph.orthogonal = false
tolerant_graph.add_seg(tolerant_graph.add_point(0, 0),
	tolerant_graph.add_point(10, 0))
tolerant_graph.add_seg(tolerant_graph.add_point(10.000001, .000001),
	tolerant_graph.add_point(10.000001, 10))
tolerant_graph.fix()
assert.equal(tolerant_graph.comps.length, 1)
assert.equal(tolerant_graph.ps.length, 3)
tolerant_graph.free()

// segment loading ----------------------------------------------------------

let load_cases = [
	['triple with numeric ID', [[0, 0], [10, 0]],
		[27, 0, 1], [[0, 1, 27]]],
	['triple with zero ID and reversed endpoints', [[0, 0], [10, 0]],
		[0, 1, 0], [[1, 0, 0]]],
	['triple with named endpoints', [[0, 0, 'a'], [10, 0, 'b']],
		['wall', 'a', 'b'], [[0, 1, 'wall']]],
	['triple with inline endpoints', [],
		[12, [0, 0], [10, 0]], [[0, 1, 12]]],
	['numeric pairs', [[0, 0], [10, 0], [10, 10], [0, 10]],
		[null, 0, 1, null, 2, 3], [[0, 1], [2, 3]]],
	['named pairs', [[0, 0], [10, 0], [10, 10], [0, 10]],
		['wall1', 0, 1, 'wall2', 2, 3], [[0, 1, 'wall1'], [2, 3, 'wall2']]],
	['inline pairs', [],
		[null, [0, 0], [10, 0], null, [10, 10], [0, 10]], [[0, 1], [2, 3]]],
	['named inline pair', [],
		['wall', [0, 0], [10, 0]], [[0, 1, 'wall']]],
	['mixed explicit and generated IDs', [[0, 0], [10, 0], [10, 10], [0, 10]],
		[null, 0, 1, 0, 1, 2, 'last', 2, 3],
		[[0, 1], [1, 2, 0], [2, 3, 'last']]],
	['connect', [[0, 0, 'a'], [10, 0, 'b'], [10, 10, 'c']],
		['connect', 'a', 'b', 'c'], [[0, 1], [1, 2]]],
	['draw', [], ['draw', 0, 0, 10, 10], [[0, 1], [1, 2]]],
]
let n_loads = 0
for (let [name, points, run, expected] of load_cases) {
	let g = plane_graph()
	g.load(points, [run])
	assert.equal(g.segs.length, expected.length, name)
	for (let i = 0; i < expected.length; i++) {
		let [p1, p2, id] = expected[i]
		assert.equal(g.segs[i][0], g.ps[p1], name)
		assert.equal(g.segs[i][1], g.ps[p2], name)
		if (id != null)
			assert.equal(g.segs[i].id, id, name)
		else
			assert.equal(typeof g.segs[i].id, 'number', name)
	}
	g.free()
	n_loads++
}

let mixed_runs = [
	[0, 0, 1],
	['connect', 'b', 'c'],
	['wall', 2, 3],
	'connect d a',
]
let mixed_runs0 = JSON.stringify(mixed_runs)
let mixed_graph = plane_graph()
mixed_graph.load([[0, 0, 'a'], [10, 0, 'b'], [10, 10, 'c'], [0, 10, 'd']],
	mixed_runs)
assert.equal(mixed_graph.segs.length, 4)
assert.equal(mixed_graph.segs[0].id, 0)
assert.equal(mixed_graph.segs[2].id, 'wall')
assert.equal(JSON.stringify(mixed_runs), mixed_runs0)
for (let i = 0; i < 4; i++) {
	let p1 = mixed_graph.ps[i]
	let p2 = mixed_graph.ps[(i+1) % 4]
	assert.equal(mixed_graph.segs[i][0], p1)
	assert.equal(mixed_graph.segs[i][1], p2)
	assert.equal(p1.segs.length, 2)
	assert(p1.adj.includes(p2))
}
mixed_graph.free()
n_loads++

// graph copying ------------------------------------------------------------

let source_graph = plane_graph()
let source_a = source_graph.add_point(0, 0)
let source_b = source_graph.add_point(10, 0)
let source_c = source_graph.add_point(10, 10)
source_graph.add_seg(source_a, source_b)
source_graph.add_seg(source_b, source_c)

for (let method of ['add', 'set']) {
	let g = plane_graph()
	let p1 = g.add_point(-10, 0)
	let p2 = g.add_point(-10, 10)
	let seg = g.add_seg(p1, p2)
	assert.equal(g[method](source_graph), g)
	let offset = method == 'add' ? 2 : 0
	assert.equal(g.ps.length, offset + 3)
	assert.equal(g.segs.length, method == 'add' ? 3 : 2)
	if (method == 'add') {
		assert.equal(g.ps[0], p1)
		assert.equal(g.ps[1], p2)
		assert.equal(g.segs[0], seg)
	}
	for (let i = 0; i < source_graph.ps.length; i++) {
		let p = g.ps[offset+i]
		let source_p = source_graph.ps[i]
		assert.notEqual(p, source_p)
		assert.equal(p[0], source_p[0])
		assert.equal(p[1], source_p[1])
		assert.notEqual(p.id, source_p.id)
	}
	let seg_offset = method == 'add' ? 1 : 0
	for (let i = 0; i < source_graph.segs.length; i++) {
		let s = g.segs[seg_offset+i]
		assert.notEqual(s, source_graph.segs[i])
		assert.notEqual(s.id, source_graph.segs[i].id)
		assert.equal(s[0], g.ps[offset+i])
		assert.equal(s[1], g.ps[offset+i+1])
	}
	assert.equal(g.ps[offset+1].segs.length, 2)
	g.ps[offset+1][0] = 20
	assert.equal(source_b[0], 10)
	g.free()
	assert.equal(source_a.segs.length, 1)
	assert.equal(source_b.segs.length, 2)
	assert.equal(source_c.segs.length, 1)
	assert.equal(source_b.adj[0], source_a)
	assert.equal(source_b.adj[1], source_c)
}
source_graph.free()

// rebuilding without geometry cleanup -------------------------------------

let preview_graph = plane_graph()
preview_graph.orthogonal = true
let preview_a = preview_graph.add_point(0, 0)
let preview_b = preview_graph.add_point(100, 0)
let preview_c = preview_graph.add_point(50, 0)
let preview_d = preview_graph.add_point(150, 0)
let preview_s1 = preview_graph.add_seg(preview_a, preview_b)
let preview_s2 = preview_graph.add_seg(preview_c, preview_d)
assert.equal(preview_graph.rebuild(), preview_graph)
assert.equal(preview_graph.ps.length, 4)
assert.equal(preview_graph.segs.length, 2)
assert.equal(preview_graph.segs[0], preview_s1)
assert.equal(preview_graph.segs[1], preview_s2)
assert.equal(preview_s1[0], preview_a)
assert.equal(preview_s1[1], preview_b)
assert.equal(preview_s2[0], preview_c)
assert.equal(preview_s2[1], preview_d)
assert.equal(preview_b[0], 100)
assert.equal(preview_c[0], 50)
assert.equal(preview_graph.comps.length, 2)
assert.equal(preview_a.adj[0], preview_b)
assert.equal(preview_c.adj[0], preview_d)
for (let co of preview_graph.comps) {
	assert.equal(co.cycles.length, 1)
	assert.equal(co.outer_cycle.length, 2)
	assert(co.ps.includes(co.outer_cycle[0]))
	assert(co.ps.includes(co.outer_cycle[1]))
}
preview_graph.fix()
assert.equal(preview_graph.segs.length, 1)
assert.equal(preview_graph.segs[0].m1, 0)
assert.equal(preview_graph.segs[0].m2, 150)
preview_graph.free()

// component reuse ----------------------------------------------------------

let g = plane_graph()
g.add_seg(g.add_point(0, 0), g.add_point(10, 0))
g.fix()
let c = g.comps[0]
g.fix()
assert.equal(g.comps[0], c, 'component not reused')
g.free()

console.log(n_intervals + ' interval cases, ' + n_grids + ' grid cases, '
	+ n_endpoints + ' endpoint cases, ' + n_loads + ' loading cases, '
	+ n_junctions + ' junction cases, zero-length removal, short-segment removal, '
	+ 'tolerant merging, graph copying, graph rebuilding, component reuse: passed')
