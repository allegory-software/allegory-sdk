// run: node tests/3d_test.js [path/to/3d.js]
const fs = require('fs')
const vm = require('vm')
const path = require('path')

const sdk = path.resolve(__dirname, '..')
const files = [
	path.join(sdk, 'www/glue.js'),
	path.join(sdk, 'www/earcut.js'),
	process.argv[2] ?? path.join(sdk, 'www/3d.js'),
]

const ctx = {
	console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask,
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
for (let f of files)
	vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, {filename: f})

const {
	v2, v3, v4, mat3, mat4, quat, plane, triangle2, triangle3, poly2, poly3,
	line2, line3, bbox2, box3, camera, PI,
} = ctx

let n_fail = 0
let n_pass = 0
function check(name, f) {
	let r
	try {
		r = f()
	} catch (e) {
		r = 'threw: ' + e.message
	}
	if (r === true) {
		n_pass++
	} else {
		n_fail++
		console.log('FAIL', name, r === false ? '' : r)
	}
}

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const veq = (a, b, eps) => {
	a = Array.from(a); b = Array.from(b)
	return a.length == b.length && a.every((x, i) => close(x, b[i], eps))
}
const rot_z = a => quat().set_from_axis_angle(v3(0, 0, 1), a)

// v2 ------------------------------------------------------------------------

check('v2.transform(mat3, out) writes out, keeps this', () => {
	let m = mat3(); m[6] = 5
	let p = v2(1, 2), out = v2()
	p.transform(m, out)
	return veq(out, [6, 2]) && veq(p, [1, 2])
})

check('v2.add static agrees with instance add', () =>
	veq(v2.add(v2(1, 1), v2(2, 2), 2, v2()), v2(1, 1).add(v2(2, 2), 2)))

// v3 ------------------------------------------------------------------------

check('v3.set(mat4) takes position', () =>
	veq(v3().set(mat4().set_position(1, 2, 3)), [1, 2, 3]))

check('v3.transform(mat4, out) writes out, keeps this', () => {
	let m = mat4().set_position(1, 2, 3)
	let p = v3(1, 1, 1), out = v3()
	p.transform(m, out)
	return veq(out, [2, 3, 4]) && veq(p, [1, 1, 1])
})

for (let u of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [-1, 0, 0],
		[0, -1, 0], [.6, .8, 0], [0, .6, .8], [.577350269, .577350269, .577350269]])
	check('v3.ortho_normal ' + u, () => {
		let p = v3(...u), o = p.ortho_normal(v3())
		return close(o.len(), 1) && close(o.dot(p), 0) || 'got ' + Array.from(o)
	})

check('v3.rotate x->y around z', () =>
	veq(v3(1, 0, 0).rotate(v3(0, 0, 1), PI / 2), [0, 1, 0]))

check('v3.from_rgb string', () => veq(v3().from_rgb('#ff8000'), [1, 128 / 255, 0]))

// v4 ------------------------------------------------------------------------

check('v4.set(v2, z, w)', () => veq(v4().set(v2(1, 2), 3, 4), [1, 2, 3, 4]))

check('v4.transform(mat4, out) writes out', () => {
	let m = mat4().set_position(1, 2, 3)
	let p = v4(1, 1, 1, 1), out = v4()
	p.transform(m, out)
	return veq(out, [2, 3, 4, 1]) && veq(p, [1, 1, 1, 1])
})

// mat3 / mat4 ---------------------------------------------------------------

check('mat4.set(mat3) embeds', () => {
	let m3 = mat3(); m3[0] = 2; m3[4] = 3; m3[8] = 4
	return veq(mat4().set(m3), [2,0,0,0, 0,3,0,0, 0,0,4,0, 0,0,0,1])
})

check('mat4.set_position(mat4)', () =>
	veq(mat4().set_position(mat4().set_position(1, 2, 3)).slice(12, 15), [1, 2, 3]))

check('mat4.invert * self = identity', () => {
	let m = mat4().rotate(v3(1, 2, 3), .7).translate(1, 2, 3).scale(2, 3, 4)
	let i = m.clone().invert()
	return veq(mat4.mul(m, i, mat4()), mat4.identity, 1e-9)
})

check('mat4.rotate z 90 maps x to y', () =>
	veq(v3(1, 0, 0).transform(mat4().rotate(v3(0, 0, 1), PI / 2)), [0, 1, 0]))

check('mat4.perspective near -> z -1', () => {
	let m = mat4().perspective(1, 1, 1, 100)
	return close(v3(0, 0, -1).transform(m)[2], -1)
})

check('mat4.perspective infinite far', () => {
	let m = mat4().perspective(1, 1, 1)
	return close(v3(0, 0, -1).transform(m)[2], -1)
})

check('mat4.compose', () => {
	let m = mat4().compose(v3(1, 2, 3), rot_z(PI / 2), v3(2, 2, 2))
	return veq(v3(1, 0, 0).transform(m), [1, 4, 3])
})

check('mat4.normal(mat3)', () => {
	let m = mat4().scale(2, 1, 1)
	let n = m.normal(mat3())
	return veq(n, [.5,0,0, 0,1,0, 0,0,1])
})

// quat ----------------------------------------------------------------------

for (let [name, axis, a] of [
		['x90', [1,0,0], PI/2], ['y90', [0,1,0], PI/2], ['z90', [0,0,1], PI/2],
		['x180', [1,0,0], PI], ['y180', [0,1,0], PI], ['z180', [0,0,1], PI],
		['z30', [0,0,1], PI/6], ['d120', [.577350269,.577350269,.577350269], 2*PI/3],
		['x-90', [1,0,0], -PI/2], ['y-90', [0,1,0], -PI/2], ['z-90', [0,0,1], -PI/2]])
	check('quat.set_from_rotation_matrix ' + name, () => {
		let m = mat4().rotation(v3(...axis), a)
		let q = quat().set_from_rotation_matrix(m)
		let p = v3(.3, -.5, .8)
		return veq(p.clone().transform(q), p.clone().transform(m), 1e-5)
			|| 'q=' + Array.from(q)
	})

for (let [from, to] of [
		[[0,0,1], [1,0,0]], [[0,0,1], [0,0,-1]], [[1,0,0], [-1,0,0]],
		[[0,1,0], [0,0,1]], [[.6,.8,0], [0,.8,.6]], [[1,0,0], [1,0,0]]])
	check('quat.set_from_unit_vectors ' + from + ' -> ' + to, () => {
		let q = quat().set_from_unit_vectors(v3(...from), v3(...to))
		return veq(v3(...from).transform(q), to, 1e-5) || 'q=' + Array.from(q)
	})

check('quat.slerp halfway', () => {
	let q = quat().slerp(rot_z(PI / 2), .5)
	return veq(q, rot_z(PI / 4), 1e-6)
})

check('quat.slerp shortest path (negated target)', () => {
	let t = rot_z(PI / 2).muls?.(1) ?? rot_z(PI / 2)
	t = quat(-t[0], -t[1], -t[2], -t[3])
	let q = quat().slerp(t, .5)
	return veq(v3(1, 0, 0).transform(q), [Math.SQRT1_2, Math.SQRT1_2, 0], 1e-6)
})

check('quat.rotate_towards', () => {
	let q = quat().rotate_towards(rot_z(PI / 2), PI / 4)
	return veq(v3(1, 0, 0).transform(q), [Math.SQRT1_2, Math.SQRT1_2, 0], 1e-6)
})

// plane ---------------------------------------------------------------------

check('plane.clone does not share normal', () => {
	let p = plane(v3(0, 0, 1), 5), c = p.clone()
	c.normal.set(1, 0, 0)
	return p.normal[2] == 1
})

check('plane.assign returns this', () => {
	let p = plane(), q = plane(v3(1, 0, 0), 3)
	return p.assign(q) === p
})

check('plane.transform(translation)', () => {
	let p = plane(v3(0, 0, 1), 0)
	p.transform(mat4().set_position(0, 0, 5))
	return close(p.constant, -5) && veq(p.normal, [0, 0, 1])
})

check('plane.intersect_line', () => {
	let p = plane(v3(0, 0, 1), 0)
	let r = p.intersect_line(line3(v3(0, 0, -1), v3(0, 0, 1)), v3())
	return r && veq(r, [0, 0, 0]) && close(r.t, .5)
})

check('plane.intersect_plane', () => {
	let d = plane(v3(0, 0, 1), 0).intersect_plane(plane(v3(1, 0, 0), 0), v3())
	return d && veq(d, [0, 1, 0]) || 'got ' + d
})

check('plane xy <-> xyz round trip on a tilted plane', () => {
	let n = v3(1, 1, 1).normalize()
	let pl = plane().set_from_normal_and_coplanar_point(n, v3(1, 2, 3))
	let p = v3(1, 2, 3).add(v3(1, -1, 0))
	let q = pl.transform_xyz_xy(p[0], p[1], p[2], v2())
	let r = pl.transform_xy_xyz(q[0], q[1], v3())
	return veq(r, p, 1e-5) || 'got ' + Array.from(r)
})

check('plane xy->xyz not stale after the plane changes', () => {
	let pl = plane().set_from_normal_and_coplanar_point(v3(0, 0, 1), v3(0, 0, 5))
	pl.transform_xy_xyz(1, 2, v3())
	pl.set_from_normal_and_coplanar_point(v3(0, 0, 1), v3(0, 0, 7))
	let r = pl.transform_xy_xyz(1, 2, v3())
	return veq(r, [1, 2, 7], 1e-5) || 'got ' + Array.from(r)
})

check('plane.set_from_coplanar_points normal', () => {
	let pl = plane().set_from_coplanar_points(v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0))
	return veq(pl.normal, [0, 0, 1])
})

// triangles -----------------------------------------------------------------

check('triangle2.to_array is contiguous', () => {
	let t = triangle2(v2(1, 2), v2(3, 4), v2(5, 6))
	return veq(t.to_array([], 0), [1, 2, 3, 4, 5, 6])
})

check('triangle2 from_array/to_array round trip', () => {
	let t = triangle2().from_array([1, 2, 3, 4, 5, 6], 0)
	let a = []; t.to_array(a, 0)
	return veq(a, [1, 2, 3, 4, 5, 6])
})

check('triangle3.contains_point', () => {
	let t = triangle3(v3(0, 0, 0), v3(4, 0, 0), v3(0, 4, 0))
	return t.contains_point(v3(1, 1, 0)) && !t.contains_point(v3(5, 5, 0))
})

check('triangle3.contains_point degenerate is false', () => {
	let t = triangle3(v3(0, 0, 0), v3(1, 0, 0), v3(2, 0, 0))
	return t.contains_point(v3(1, 1, 0)) === false
})

check('triangle2.hit', () => {
	let t = triangle2(v2(0, 0), v2(4, 0), v2(0, 4))
	return t.hit(1, 1) && !t.hit(5, 5)
})

// poly2 ---------------------------------------------------------------------

function square2() {
	let p = poly2(0, 1, 2, 3)
	p.points = [0, 0, 4, 0, 4, 4, 0, 4]
	return p
}

// a cycle as plane_graph builds it: the elements are the points themselves.
function cycle2() {
	let p = poly2()
	p.push([0, 0], [4, 0], [4, 4], [0, 4])
	p.get_point = function(i, out) {
		out[0] = this[i][0]
		out[1] = this[i][1]
		return out
	}
	return p
}

check('poly2.bbox of a cycle', () => veq(cycle2().bbox(), [0, 0, 4, 4]))

for (let n of [1, 2, 3])
	for (let d of [-2, 2])
		check('poly2.offset collapsed cycle n=' + n + ', d=' + d, () => {
			let p = poly2()
			for (let i = 0; i < n; i++)
				p.push([10, 20])
			let edges = p.offset(d, poly2())
			return p.length == n && edges.length == 4
				&& edges[0].p == p[0] && veq(edges.bbox(), [8, 18, 12, 22])
		})
check('poly2.offset empty cycle stays empty', () =>
	poly2().offset(2, poly2()).length == 0)

check('poly2.hit', () => square2().hit(1, 1) && !square2().hit(5, 1))
check('poly2.contains_point', () => square2().contains_point(v2(1, 1)))
check('poly2.area', () => close(Math.abs(square2().area()), 16))
check('poly2.center', () => veq(square2().center(), [2, 2]))
check('poly2.triangles of a convex quad', () => square2().triangles().length == 6)

// total area of the triangles of a poly2 whose points are a flat [x, y, ...].
function triangles_area(p) {
	let t = p.triangles(), area = 0
	for (let i = 0; i < t.length; i += 3) {
		let [a, b, c] = [t[i], t[i+1], t[i+2]].map(k => [p.points[2*k], p.points[2*k+1]])
		area += Math.abs((b[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(b[1]-a[1])) / 2
	}
	return area
}

check('poly2.triangles of a concave L (earcut)', () => {
	let p = poly2(0, 1, 2, 3, 4, 5)
	p.points = [0,0, 4,0, 4,2, 2,2, 2,4, 0,4]
	return p.triangles().length == 12 && close(triangles_area(p), 12)
})

check('poly2.triangles of a square with a hole (earcut)', () => {
	let p = poly2(0, 1, 2, 3, 4, 5, 6, 7)
	p.points = [0,0, 4,0, 4,4, 0,4,  1,1, 1,3, 3,3, 3,1]
	p.holes = [4]
	return close(triangles_area(p), 12) && p.triangle_count() == p.triangles().length / 3
})
check('poly2.triangle_count is a triangle count', () =>
	square2().triangle_count() == 2 || 'got ' + square2().triangle_count())
check('poly2.clone', () => {
	let c = square2().clone()
	return c && c.length == 4 || 'got ' + c
})
check('poly2.is_cw sees every edge', () => {
	// last edge (3 -> 0) carries all of the sign on this skinny polygon.
	let p = poly2(0, 1, 2, 3)
	p.points = new Float32Array([0, 0, 10, 0, 10, 1, 0, 100])
	let q = poly2(0, 1, 2, 3)
	q.points = new Float32Array([0, 0, 0, 100, 10, 1, 10, 0])
	return p.is_cw() != q.is_cw()
})
check('poly2.get_point3 with plane', () => {
	let p = square2(); p.set_plane(plane(v3(0, 0, 1), 0))
	return veq(p.get_point3(1, v3()), [4, 0, 0])
})
check('poly2.xy / xyz', () => {
	let p = square2(); p.set_plane(plane(v3(0, 0, 1), 0))
	return veq(p.xy(v3(1, 2, 0), v2()), [1, 2]) && veq(p.xyz(v2(1, 2), v3()), [1, 2, 0])
})
check('poly2.triangle_count counts triangles', () => square2().triangle_count() == 2)
check('poly2.set / assign return this', () => {
	let a = square2(), b = square2()
	return a.set(b) === a && a.assign(b) === a
})

// poly3 ---------------------------------------------------------------------

function square3() {
	let p = poly3(0, 1, 2, 3)
	p.points = new Float32Array([0,0,0, 4,0,0, 4,4,0, 0,4,0])
	return p
}
check('poly3.get_point returns 2D', () => {
	let r = square3().get_point(1, v2())
	return r && close(Math.hypot(r[0], r[1]), 4) || 'got ' + r
})
check('poly3.center is 3D center', () => veq(square3().center(v3()), [2, 2, 0]))
check('poly3.compute_smooth_normals', () => {
	let n = new Float32Array(12)
	square3().compute_smooth_normals(n, true)
	return n[2] != 0 && close(Math.abs(n[2]), 1) || 'got ' + Array.from(n)
})
check('poly3.triangles', () => square3().triangles().length == 6)

// line2 / line3 -------------------------------------------------------------

for (let n of [100, 200, 400, 500, 600])
	for (let d of [-14, 14])
		for (let v of [false, true])
			for (let dir of [-1, 1])
				check('line2.offset exact axis ' + [n, d, v, dir], () => {
					let x2 = v ? 0 : dir * n
					let y2 = v ? dir * n : 0
					let r = line2.offset(d, 0, 0, x2, y2)
					let dx = v ? -dir * d : 0
					let dy = v ? 0 : dir * d
					return r[0] == dx && r[1] == dy
						&& r[2] == x2 + dx && r[3] == y2 + dy
				})
check('line2.offset angled segment', () =>
	veq(line2.offset(5, 0, 0, 3, 4), [-4, 3, -1, 7]))
check('line2.offset angled segment with negative distance', () =>
	veq(line2.offset(-5, 0, 0, 3, 4), [4, -3, 7, 1]))

check('line2.distance', () => close(line2(v2(0, 0), v2(3, 4)).distance(), 5))
check('line3.distance', () => close(line3(v3(0, 0, 0), v3(3, 4, 0)).distance(), 5))
check('line2.project_point', () => {
	let r = line2(v2(0, 0), v2(10, 0)).project_point(v2(4, 3), false, v2())
	return veq(r, [4, 0])
})
check('line2.intersects_line', () =>
	line2(v2(0, 0), v2(10, 10)).intersects_line(line2(v2(0, 10), v2(10, 0))) === true)
check('line2.transform(mat3, out)', () => {
	let m = mat3(); m[6] = 5
	let l = line2(v2(0, 0), v2(1, 1)), o = line2()
	l.transform(m, o)
	return veq(o[0], [5, 0]) && veq(l[0], [0, 0])
})
check('line2.to_line2_array packs 4 floats per line', () => {
	let a = []
	line2(v2(1, 2), v2(3, 4)).to_line2_array(a, 0)
	line2(v2(5, 6), v2(7, 8)).to_line2_array(a, 1)
	return veq(a, [1,2,3,4,5,6,7,8])
})
check('line3.to_line3_array packs 6 floats per line', () => {
	let a = []
	line3(v3(1,2,3), v3(4,5,6)).to_line3_array(a, 0)
	line3(v3(7,8,9), v3(10,11,12)).to_line3_array(a, 1)
	return veq(a, [1,2,3,4,5,6,7,8,9,10,11,12])
})
check('line2.split_by_poly sorts numerically', () => {
	let p = poly2(0, 1, 2, 3)
	p.points = new Float32Array([0, 0, 4, 0, 4, 4, 0, 4])
	let out = line2(v2(-1, 2), v2(9999999, 2)).split_by_poly(p, null, [])
	return out.every((t, i) => i == 0 || out[i - 1] <= t) || 'got ' + out
})
check('line3.transform(mat4, out)', () => {
	let m = mat4().set_position(1, 2, 3)
	let l = line3(v3(0, 0, 0), v3(1, 1, 1)), o = line3()
	l.transform(m, o)
	return veq(o[0], [1, 2, 3]) && veq(l[0], [0, 0, 0])
})
check('line3.intersect_line skew lines', () => {
	let out = line3()
	let r = line3(v3(-1, 0, 0), v3(1, 0, 0)).intersect_line(line3(v3(0, -1, 1), v3(0, 1, 1)), out)
	return r && veq(r[0], [0, 0, 0]) && veq(r[1], [0, 0, 1])
})
check('line2/line3 from_*_array round trip', () => {
	let a = [1,2,3,4,5,6,7,8]
	let l = line2().from_line2_array(a, 1)
	let b = [1,2,3,4,5,6,7,8,9,10,11,12]
	let m = line3().from_line3_array(b, 1)
	return veq(l[0], [5, 6]) && veq(l[1], [7, 8]) &&
		veq(m[0], [7, 8, 9]) && veq(m[1], [10, 11, 12])
})

// bbox2 / box3 --------------------------------------------------------------

check('bbox2.add(x, y)', () => veq(bbox2().add(1, 2), [1, 2, 1, 2]))
check('bbox2.add(v2)', () => veq(bbox2().add(v2(1, 2)), [1, 2, 1, 2]))
check('bbox2.add(bbox2)', () => veq(bbox2().add(bbox2(0, 0, 3, 3)), [0, 0, 3, 3]))
check('bbox2.add([points])', () => veq(bbox2().add([[1, 2], [3, 4]]), [1, 2, 3, 4]))
check('bbox2.hit / contains_point', () => bbox2(0, 0, 3, 3).contains_point(v2(1, 1)))
check('bbox2.rotate(0) returns this', () => { let b = bbox2(0, 0, 3, 3); return b.rotate(0) === b })
check('bbox2.rotate(90)', () => veq(bbox2(0, 0, 4, 2).rotate(PI / 2), [1, -1, 3, 3]))

check('box3.center', () => {
	let b = box3(v3(0, 0, 0), v3(2, 4, 6))
	return veq(b.center(v3()), [1, 2, 3])
})
check('box3.is_empty is a prototype method', () => !box3().hasOwnProperty('is_empty'))
check('box3.add(line3)', () => {
	let b = box3().add(line3(v3(1, 2, 3), v3(-1, 5, 0)))
	return veq(b[0], [-1, 2, 0]) && veq(b[1], [1, 5, 3])
})
check('box3.add(poly3)', () => {
	let b = box3().add(square3())
	return veq(b[0], [0, 0, 0]) && veq(b[1], [4, 4, 0])
})
check('box3.transform(translation)', () => {
	let b = box3(v3(0, 0, 0), v3(1, 1, 1)).transform(mat4().set_position(1, 0, 0))
	return veq(b[0], [1, 0, 0]) && veq(b[1], [2, 1, 1])
})
check('box3.to_box3_array packs 6 floats per box', () => {
	let a = []
	box3(v3(1,2,3), v3(4,5,6)).to_box3_array(a, 0)
	box3(v3(7,8,9), v3(10,11,12)).to_box3_array(a, 1)
	return veq(a, [1,2,3,4,5,6,7,8,9,10,11,12])
})
check('box3.from_box3_array round trip', () => {
	let b = box3().from_box3_array([1,2,3,4,5,6,7,8,9,10,11,12], 1)
	return veq(b[0], [7, 8, 9]) && veq(b[1], [10, 11, 12])
})
check('triangle assign returns this', () => {
	let t2 = triangle2(), t3 = triangle3()
	return t2.assign(triangle2()) === t2 && t3.assign(triangle3()) === t3
})

// camera --------------------------------------------------------------------

function cam() {
	let c = camera({pos: v3(0, 0, 10), dir: v3(0, 0, 1), up: v3(0, 1, 0)})
	c.view_size.set(800, 600)
	c.perspective().update()
	return c
}
check('camera: look straight ahead maps target to screen center', () => {
	let c = cam()
	return veq(c.world_to_screen(v3(0, 0, 0), v2()), [400, 300])
})
check('camera: raycast through center points along -dir', () => {
	let c = cam()
	let l = c.raycast(400, 300, line3())
	return veq(l.delta(v3()), [0, 0, -1], 1e-4) || 'got ' + Array.from(l.delta(v3()))
})
for (let far of [undefined, 1000])
	check('camera: off-center raycast, far=' + far, () => {
		let c = camera({pos: v3(3, 4, 10), dir: v3(0, 0, 1), up: v3(0, 1, 0), far})
		c.view_size.set(800, 600)
		c.perspective().update()
		let t = Math.tan(PI / 6)
		let d = c.raycast(0, 300, line3()).delta(v3())
		let want = v3(-t * 800 / 600, 0, -1).normalize()
		return veq(d, want, 1e-4) || 'got ' + Array.from(d)
	})
check('camera: world_to_screen of a left-edge point', () => {
	let c = camera({pos: v3(3, 4, 10), dir: v3(0, 0, 1), up: v3(0, 1, 0)})
	c.view_size.set(800, 600)
	c.perspective().update()
	let t = Math.tan(PI / 6)
	return veq(c.world_to_screen(v3(3 - t * 800 / 600 * 10, 4, 0), v2()), [0, 300], 1e-6)
})
check('camera.screen_distance', () => {
	let c = cam()
	return close(c.screen_distance(v3(0, 0, 0), v3(0, 0, 0)), 0)
})
check('camera.orbit by 0 keeps pos and dir', () => {
	let c = cam(), p = c.pos.clone(), d = c.dir.clone()
	c.orbit(v3(0, 0, 0), 0, 0, 0).update()
	return veq(c.pos, p, 1e-4) && veq(c.dir, d, 1e-4)
})
check('camera.orbit keeps distance to target', () => {
	let c = cam()
	c.orbit(v3(0, 0, 0), 0, .5, 0).update()
	return close(c.pos.len(), 10, 1e-3) || 'dist ' + c.pos.len()
})
check('camera.ortho uses its arguments', () => {
	let c = cam(); c.ortho(-20, 20, -10, 10, -100, 100)
	return close(v3(10, 5, 0).transform(c.proj)[0], .5) &&
		close(v3(10, 5, 0).transform(c.proj)[1], .5)
})
check('camera.clone', () => {
	let c = cam(), d = c.clone()
	return veq(d.pos, c.pos) && veq(d.proj, c.proj)
})

console.log(`${n_pass} passed, ${n_fail} failed`)
process.exit(n_fail ? 1 : 0)
