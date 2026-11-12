/*

	3D and 2D math lib.
	Written by Cosmin Apreutesei. Public Domain.

	Code adapted from three.js and glMatrix, MIT License.

LOADING

	<script src=3d.js [global]>

		the global flag dumps the `Math3D` namespace into `window`.
		requires glue.js loaded with the global flag, and earcut.js for
		poly triangulation.

API

	bbox2([x1, y1, x2, y2]) -> bbox2
		add(x, y | p | bbox2 | [p1,...]) -> bbox2
		add_point(x, y) -> bbox2
		add_bbox2(x1, y1, x2, y2) -> bbox2
		add_points([p1,...]) -> bbox2
		reset() -> bbox2
		rotate(a) -> bbox2
		inside_bbox2(x1, y1, x2, y2) -> t|f
		hit(x, y) contains_point(p)

	v2 [x, y]
		.x .y
		* add sub mul div near
		set(x,y|v2|v3|v4) assign to sets clone equals near from[_v2|_v3|_v4]_array to[_v2]_array
		len[2] set_len normalize
		add adds sub subs negate mul muls div divs min max dot
		distance[2]
		transform(mat3|plane) rotate
		origin zero

	v3 [x, y, z]
		.x .y .z
		* add sub mul div cross zero one
		set(x,y,z|v2,z|v3|v4|mat4|0xRRGGBB) assign to sets clone equals near
		from[_v3|_v4]_array to[_v3]_array from_rgb from_rgba from_hsl
		len[2] set_len normalize
		add adds sub subs negate mul muls div divs min max dot cross
		angle_to distance[2]
		transform(mat3|mat4|quat|plane) rotate project ortho_normal
		origin zero one up right x|y|z_axis black white inf minus_inf

	v4 [x, y, z, w]
		.x .y .z .w
		* add sub mul div
		set(x,y,z,w|v2,z,w|v3,w|v4|0xRRGGBBAA) assign to sets clone equals
		from[_v4]_array to[_v4]_array from_rgb from_rgba from_hsl
		len[2] set_len normalize
		add adds sub subs negate mul muls div divs min max dot
		transform(mat4)
		origin one black white

	mat3, mat3f32 [e11, e21, e31, e12, e22, e32, e13, e23, e33]
		.e11 .e21 .e31 .e12 .e22 .e32 .e13 .e23 .e33
		* mul identity
		set(mat3|mat4) assign to reset clone equals from[_mat3]_array to[_mat3]_array
		transpose det invert
		mul premul muls scale rotate translate

	mat4, mat4f32 [e11, e21, e31, e41, e12, e22, e32, e42, e13, e23, e33, e43, e14, e24, e34, e44]
		.e11 .e21 .e31 .e41 .e12 .e22 .e32 .e42 .e13 .e23 .e33 .e43 .e14 .e24 .e34 .e44
		* mul identity
		set(mat3|mat4|quat) assign to reset clone equals from[_mat4]_array to[_mat4]_array
		transpose det invert normal
		mul premul muls scale set_position translate rotate
		frustum perspective ortho look_at compose rotation

	quat[3] [x, y, z, w]
		.x .y .z .w
		* mul
		set assign to reset clone equals from[_quat]_array to[_quat]_array
		set_from_axis_angle set_from_rotation_matrix set_from_unit_vectors
		len[2] normalize rotate_towards conjugate invert
		angle_to dot mul premul slerp
		transform(x, y, z, [out]) transform33(v3, [out])

	plane[3] {constant:, normal:}
		set assign to clone equals s
		set_from_normal_and_coplanar_point set_from_coplanar_points set_from_poly3
		normalize negate
		distance_to_point project_point
		intersect_line intersects_line clip_line intersect_plane
		origin translate transform(mat4) invalidate
		xyz_quat xy_quat xyz_xy_transformer
		transform_xy_xyz transform23 transform_xyz_xy transform32

	triangle2 [a, b, c]
		* hit
		set assign to clone equals from[_triangle2]_array to[_triangle2]_array
		area midpoint hit contains_point

	triangle3 [a, b, c]
		* normal barycoord contains_point uv is_front_facing
		set assign to clone equals from[_triangle3]_array to[_triangle3]_array
		area midpoint normal plane barycoord uv contains_point is_front_facing

	poly[2] [pi1, ..., hole1_pi1, hole1_pi2, ..., points: [p1,...], holes: [hole1_pi1, hole2_pi1, ...]]
		set assign to clone s
		% point_count get_point get_normal
		point_count_without_holes hole_count hole_i1 hole_i2
		is_convex is_convex_quad is_cw triangle_count triangles triangle2
		center bbox area invalidate
		hit contains_point offset
		uv_at
		set_plane plane xyz_quat xy_quat xy xyz get_point3 triangle3

	poly3
		get_point get_point3 plane center compute_smooth_normals

	line2 [p0, p1]
		* at project_point_t project_point intersect_line intersects_line
		offset x_intercept
		set(line | p1,p2) assign to clone equals near to|from[_line2]_array
		delta distance2 distance at reverse len set_len s
		project_point_t project_point intersect_line intersects_line
		offset split_by_poly
		transform(mat3|plane)

	line3 [p0, p1]
		set(line | p1,p2) assign to clone equals to|from[_line3]_array
		delta distance2 distance at reverse len set_len s
		project_point_t project_point intersect_line intersect_plane intersects_plane
		transform(mat3|mat4|quat|plane)

	box[3] [min_p, max_p]
		.min .max
		* points line_pis each_line triangle_pis_front triangle_pis_back
		set assign to clone equals reset add
		to_array to[_box3]_array from_array from[_box3]_array
		is_empty center delta contains_point contains_box intersects_box
		transform translate

	camera[3]
		view_size pos dir up fov near far set to clone
		perspective ortho(left, right, bottom, top, near, far) dolly orbit pan
		update proj view inv_view inv_proj view_proj
		world_to_view view_to_clip world_to_clip clip_to_screen world_to_screen
		screen_to_clip clip_to_view view_to_world screen_to_view clip_to_world
		screen_to_world
		raycast screen_distance[2]

*/

(function() {
"use strict"
const G = window

const {
	isarray, isstr, isnum,
	round, abs, sign, min, max, clamp, sqrt, PI, inf, sin, cos, tan, rad,
	acos, atan2,
	assert, callable_constructor, inherit_properties,
	array_set, remove_values, assign, f32arr, u8arr, distance,
} = glue

let NEAR = 1e-5 // distance epsilon (tolerance)
let FAR  = 1e5  // skybox distance from center

function near(a, b) { return abs(a - b) < NEAR }

let near_angle = near

// global for returning multiple values from functions. you must unpack
// the return value of such functions before calling other functions.
let out = []

function rotate_point(px, py, cx, cy, angle) {
	let s = sin(angle)
	let c = cos(angle)
	let x = px - cx
	let y = py - cy
	out.length = 2
	out[0] = cx + (x * c - y * s)
	out[1] = cy + (x * s + y * c)
	return out
}

// v2 ------------------------------------------------------------------------

let v2_class = class v extends Array {

	is_v2 = true

	get x() { return this[0] }; set x(v) { this[0] = v }
	get y() { return this[1] }; set y(v) { this[1] = v }

	constructor(x, y) {
		super(x ?? 0, y ?? 0)
	}

	set(x, y) {
		if (x.is_v2 || x.is_v3 || x.is_v4) {
			let v = x
			x = v[0]
			y = v[1]
		}
		this[0] = x
		this[1] = y
		return this
	}

	assign(v) {
		assert(v.is_v2)
		return assign(this, v)
	}

	to(v) {
		return v.set(this)
	}

	sets(s) {
		this[0] = s
		this[1] = s
		return this
	}

	clone() {
		return v2(this[0], this[1])
	}

	equals(v) {
		return (
			v[0] === this[0] &&
			v[1] === this[1]
		)
	}

	near(v) {
		return (
			near(v[0], this[0]) &&
			near(v[1], this[1])
		)
	}

	from_array(a, i) {
		this[0] = a[i  ]
		this[1] = a[i+1]
		return this
	}

	to_array(a, i) {
		a[i  ] = this[0]
		a[i+1] = this[1]
		return a
	}

	from_v2_array(a, i) { return this.from_array(a, 2 * i) }
	from_v3_array(a, i) { return this.from_array(a, 3 * i) }
	from_v4_array(a, i) { return this.from_array(a, 4 * i) }

	to_v2_array(a, i) { return this.to_array(a, 2 * i) }

	s() {
		return [
			this[0],
			this[1],
		]
	}

	len2() {
		return (
			this[0] ** 2 +
			this[1] ** 2
		)
	}

	len() {
		return sqrt(this.len2())
	}

	normalize() {
		return this.divs(this.len() || 1)
	}

	set_len(v) {
		return this.normalize().muls(v)
	}

	add(v, s) {
		s = s ?? 1
		this[0] += v[0] * s
		this[1] += v[1] * s
		return this
	}

	adds(s) {
		this[0] += s
		this[1] += s
		return this
	}

	sub(v) {
		this[0] -= v[0]
		this[1] -= v[1]
		return this
	}

	subs(s) {
		this[0] -= s
		this[1] -= s
		return this
	}

	negate() {
		this[0] = -this[0]
		this[1] = -this[1]
		return this
	}

	mul(v) {
		this[0] *= v[0]
		this[1] *= v[1]
		return this
	}

	muls(s) {
		this[0] *= s
		this[1] *= s
		return this
	}

	div(v) {
		this[0] /= v[0]
		this[1] /= v[1]
		return this
	}

	divs(s) {
		return this.muls(1 / s)
	}

	min(v) {
		this[0] = min(this[0], v[0])
		this[1] = min(this[1], v[1])
		return this
	}

	max(v) {
		this[0] = max(this[0], v[0])
		this[1] = max(this[1], v[1])
		return this
	}

	dot(v) {
		return (
			this[0] * v[0] +
			this[1] * v[1]
		)
	}

	distance2(v) {
		let dx = this[0] - v[0]
		let dy = this[1] - v[1]
		return (
			dx ** 2 +
			dy ** 2
		)
	}

	distance(v) {
		return sqrt(this.distance2(v))
	}

	transform(arg, out) {

		out ??= this

		if (arg.is_plane)
			return arg.transform23(this, out)

		let x = this[0]
		let y = this[1]

		if (arg.is_mat3) {

			let m = arg
			out[0] = m[0] * x + m[3] * y + m[6]
			out[1] = m[1] * x + m[4] * y + m[7]

		} else
			assert(false)

		return out
	}

	rotate(axis, angle) {
		let cx = axis[0]
		let cy = axis[1]
		let c = cos(angle)
		let s = sin(angle)
		let x = this[0] - cx
		let y = this[1] - cy
		this[0] = x * c - y * s + cx
		this[1] = x * s + y * c + cy
		return this
	}

}

let v2 = function v2(x, y) { return new v2_class(x, y) }
v2.class = v2_class

v2.add = function v2add(a, b, s, out) {
	s = s ?? 1
	out[0] = a[0] + b[0] * s
	out[1] = a[1] + b[1] * s
	return out
}

v2.sub = function v2sub(a, b, out) {
	out[0] = a[0] - b[0]
	out[1] = a[1] - b[1]
	return out
}

v2.mul = function v2mul(a, b, out) {
	out[0] = a[0] * b[0]
	out[1] = a[1] * b[1]
	return out
}

v2.div = function v2div(a, b, out) {
	out[0] = a[0] / b[0]
	out[1] = a[1] / b[1]
	return out
}

v2.near = function v2near(p1, p2) {
	return (
		near(p1[0], p2[0]) &&
		near(p1[1], p2[1])
	)
}

v2.origin = v2()
v2.zero = v2.origin

// temporaries for line2 and poly methods.
let _v2_0 = v2()
let _v2_1 = v2()

// v3 ------------------------------------------------------------------------

// hsl is in (0..360, 0..1, 0..1); rgb is (0..1, 0..1, 0..1)
function h2rgb(m1, m2, h) {
	if (h < 0) h = h + 1
	if (h > 1) h = h - 1
	if (h * 6 < 1)
		return m1 + (m2 - m1) * h * 6
	else if (h * 2 < 1)
		return m2
	else if (h * 3 < 2)
		return m1 + (m2 - m1) * (2 / 3 - h) * 6
	else
		return m1
}

function set_hsl(self, h, s, L) {
	h = h / 360
	let m2 = L <= .5 ? L * (s + 1) : L + s - L * s
	let m1 = L * 2 - m2
	self[0] = h2rgb(m1, m2, h+1/3)
	self[1] = h2rgb(m1, m2, h)
	self[2] = h2rgb(m1, m2, h-1/3)
}

let v3_class = class v extends Array {

	is_v3 = true

	get x() { return this[0] }; set x(v) { this[0] = v }
	get y() { return this[1] }; set y(v) { this[1] = v }
	get z() { return this[2] }; set z(v) { this[2] = v }

	constructor(x, y, z) {
		super(x ?? 0, y ?? 0, z ?? 0)
	}

	set(x, y, z) {
		if (x.is_v3 || x.is_v4) {
			let v = x
			x = v[0]
			y = v[1]
			z = v[2]
		} else if (x.is_v2) { // (v2, z)
			let v = x
			z = y ?? 0
			x = v[0]
			y = v[1]
		} else if (x.is_mat4) {
			let m = x
			x = m[12]
			y = m[13]
			z = m[14]
		} else if (y == null) {
			return this.from_rgb(x)
		}
		this[0] = x
		this[1] = y
		this[2] = z
		return this
	}

	assign(v) {
		assert(v.is_v3)
		return assign(this, v)
	}

	to(v) {
		return v.set(this)
	}

	sets(s) {
		this[0] = s
		this[1] = s
		this[2] = s
		return this
	}

	clone() {
		return v3(this[0], this[1], this[2])
	}

	equals(v) {
		return (
			v[0] === this[0] &&
			v[1] === this[1] &&
			v[2] === this[2]
		)
	}

	near(v) {
		return (
			near(v[0], this[0]) &&
			near(v[1], this[1]) &&
			near(v[2], this[2])
		)
	}

	from_array(a, i) {
		this[0] = a[i  ]
		this[1] = a[i+1]
		this[2] = a[i+2]
		return this
	}

	to_array(a, i) {
		a[i  ] = this[0]
		a[i+1] = this[1]
		a[i+2] = this[2]
		return a
	}

	from_v3_array(a, i) { return this.from_array(a, 3 * i) }
	from_v4_array(a, i) { return this.from_array(a, 4 * i) }

	to_v3_array(a, i) { return this.to_array(a, 3 * i) }

	s() {
		return [
			this[0],
			this[1],
			this[2],
		]
	}

	from_rgb(s) {
		if (isstr(s))
			s = parseInt(s.replace(/[^0-9a-fA-F]/g, ''), 16)
		this[0] = (s >> 16 & 0xff) / 255
		this[1] = (s >>  8 & 0xff) / 255
		this[2] = (s       & 0xff) / 255
		return this
	}

	from_rgba(s) {
		if (isstr(s))
			s = parseInt(s.replace(/[^0-9a-fA-F]/g, ''), 16)
		this[0] = (s >> 24 & 0xff) / 255
		this[1] = (s >> 16 & 0xff) / 255
		this[2] = (s >>  8 & 0xff) / 255
		return this
	}

	from_hsl(h, s, L) {
		set_hsl(this, h, s, L)
		return this
	}

	len2() {
		return (
			this[0] ** 2 +
			this[1] ** 2 +
			this[2] ** 2
		)
	}

	len() {
		return sqrt(this.len2())
	}

	normalize() {
		return this.divs(this.len() || 1)
	}

	set_len(v) {
		return this.normalize().muls(v)
	}

	add(v, s) {
		s = s ?? 1
		this[0] += v[0] * s
		this[1] += v[1] * s
		this[2] += v[2] * s
		return this
	}

	adds(s) {
		this[0] += s
		this[1] += s
		this[2] += s
		return this
	}

	sub(v) {
		this[0] -= v[0]
		this[1] -= v[1]
		this[2] -= v[2]
		return this
	}

	subs(s) {
		this[0] -= s
		this[1] -= s
		this[2] -= s
		return this
	}

	negate() {
		this[0] = -this[0]
		this[1] = -this[1]
		this[2] = -this[2]
		return this
	}

	mul(v) {
		this[0] *= v[0]
		this[1] *= v[1]
		this[2] *= v[2]
		return this
	}

	muls(s) {
		this[0] *= s
		this[1] *= s
		this[2] *= s
		return this
	}

	div(v) {
		this[0] /= v[0]
		this[1] /= v[1]
		this[2] /= v[2]
		return this
	}

	divs(s) {
		return this.muls(1 / s)
	}

	min(v) {
		this[0] = min(this[0], v[0])
		this[1] = min(this[1], v[1])
		this[2] = min(this[2], v[2])
		return this
	}

	max(v) {
		this[0] = max(this[0], v[0])
		this[1] = max(this[1], v[1])
		this[2] = max(this[2], v[2])
		return this
	}

	dot(v) {
		return (
			this[0] * v[0] +
			this[1] * v[1] +
			this[2] * v[2]
		)
	}

	cross(b) {
		return v3.cross(this, b, this)
	}

	angle_to(v) {
		let den = sqrt(this.len2() * v.len2())
		if (den == 0) return PI / 2
		let theta = this.dot(v) / den // clamp, to handle numerical problems
		return acos(clamp(theta, -1, 1))
	}

	distance2(v) {
		let dx = this[0] - v[0]
		let dy = this[1] - v[1]
		let dz = this[2] - v[2]
		return (
			dx ** 2 +
			dy ** 2 +
			dz ** 2
		)
	}

	distance(v) {
		return sqrt(this.distance2(v))
	}

	transform(arg, out) {

		out ??= this

		if (arg.is_plane)
			return arg.transform32(this, out)
		else if (arg.is_quat)
			return arg.transform33(this, out)

		let x = this[0]
		let y = this[1]
		let z = this[2]

		if (arg.is_mat3) {

			let m = arg
			out[0] = m[0] * x + m[3] * y + m[6] * z
			out[1] = m[1] * x + m[4] * y + m[7] * z
			out[2] = m[2] * x + m[5] * y + m[8] * z

		} else if (arg.is_mat4) {

			let m = arg
			let w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15])
			out[0] = (m[0] * x + m[4] * y + m[ 8] * z + m[12]) * w
			out[1] = (m[1] * x + m[5] * y + m[ 9] * z + m[13]) * w
			out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * w

		} else
			assert(false)

		return out
	}

	rotate(axis, angle) {
		return this.transform(_q0.set_from_axis_angle(axis, angle))
	}

	project(plane, out) {
		return plane.project_point(this, out)
	}

	ortho_normal(out) { // see Householder reflectors
		let [x, y, z] = this
		let l = sqrt(x * x + y * y + z * z)
		let s = x < 0 ? -1 : 1 // sign(x) is 0 at x == 0 and divides by zero.
		let xt = x + s
		let dot = -y / (s * xt)
		out[0] = dot * xt
		out[1] = 1 + dot * y
		out[2] = dot * z
		return out
	}

	/*
	// another way to compute this for mere mortals (but slower).
	function ortho_normal(p) {
		let [x, y, z] = p
		let m = max(abs(x), abs(y), abs(z)) // dominant axis
		if (m == abs(z))
			return v3(1, 1, -(x + y) / z).normalize()
		else if (m == abs(y))
			return v3(1, -(x + z) / y, 1).normalize()
		else
			return v3(-(y + z) / x, 1, 1).normalize()
	}
	*/

}

let v3 = function v3(x, y, z) { return new v3_class(x, y, z) }
v3.class = v3_class

v3.cross = function(a, b, out) {
	let ax = a[0]
	let ay = a[1]
	let az = a[2]
	let bx = b[0]
	let by = b[1]
	let bz = b[2]
	out[0] = ay * bz - az * by
	out[1] = az * bx - ax * bz
	out[2] = ax * by - ay * bx
	return out
}

v3.add = function v3add(a, b, s, out) {
	s = s ?? 1
	out[0] = a[0] + b[0] * s
	out[1] = a[1] + b[1] * s
	out[2] = a[2] + b[2] * s
	return out
}

v3.sub = function v3sub(a, b, out) {
	out[0] = a[0] - b[0]
	out[1] = a[1] - b[1]
	out[2] = a[2] - b[2]
	return out
}

v3.mul = function v3mul(a, b, out) {
	out[0] = a[0] * b[0]
	out[1] = a[1] * b[1]
	out[2] = a[2] * b[2]
	return out
}

v3.div = function v3div(a, b, out) {
	out[0] = a[0] / b[0]
	out[1] = a[1] / b[1]
	out[2] = a[2] / b[2]
	return out
}

v3.origin  = v3()
v3.zero   = v3.origin
v3.one    = v3(1, 1, 1)
v3.up     = v3(0, 1, 0)
v3.right  = v3(1, 0, 0)
v3.x_axis = v3.right
v3.y_axis = v3.up
v3.z_axis = v3(0, 0, 1)
v3.black  = v3.zero
v3.white  = v3.one

// temporaries for plane, triangle3 and line3 methods.
let _v0 = v3()
let _v1 = v3()
let _v2 = v3()
let _v3 = v3()
let _v4 = v3()

// v4 ------------------------------------------------------------------------

let v4_class = class v extends Array {

	is_v4 = true

	get x() { return this[0] }; set x(v) { this[0] = v }
	get y() { return this[1] }; set y(v) { this[1] = v }
	get z() { return this[2] }; set z(v) { this[2] = v }
	get w() { return this[3] }; set w(v) { this[3] = v }

	constructor(x, y, z, w) {
		super(x ?? 0, y ?? 0, z ?? 0, w ?? 1)
	}

	set(x, y, z, w) {
		if (x.is_v4) {
			let v = x
			x = v[0]
			y = v[1]
			z = v[2]
			w = v[3]
		} else if (x.is_v3) {
			let v = x
			w = y ?? 1
			x = v[0]
			y = v[1]
			z = v[2]
		} else if (x.is_v2) {
			let v = x
			w = z ?? 1
			z = y ?? 0
			x = v[0]
			y = v[1]
		} else if (y == null) {
			return this.from_rgba(x)
		}
		this[0] = x
		this[1] = y
		this[2] = z
		this[3] = w
		return this
	}

	assign(v) {
		assert(v.is_v4)
		return assign(this, v)
	}

	to(v) {
		return v.set(this)
	}

	sets(s) {
		this[0] = s
		this[1] = s
		this[2] = s
		this[3] = s
		return this
	}

	clone() {
		return v4().set(this)
	}

	equals(v) {
		return (
			v[0] === this[0] &&
			v[1] === this[1] &&
			v[2] === this[2] &&
			v[3] === this[3]
		)
	}

	from_array(a, i) {
		this[0] = a[i  ]
		this[1] = a[i+1]
		this[2] = a[i+2]
		this[3] = a[i+3]
		return this
	}

	to_array(a, i) {
		a[i  ] = this[0]
		a[i+1] = this[1]
		a[i+2] = this[2]
		a[i+3] = this[3]
		return a
	}

	from_v4_array(a, i) { return this.from_array(a, 4 * i) }

	to_v4_array(a, i) { return this.to_array(a, 4 * i) }

	len2() {
		return (
			this[0] ** 2 +
			this[1] ** 2 +
			this[2] ** 2 +
			this[3] ** 2
		)
	}

	from_rgb(s) {
		this[0] = ((s >> 16) & 0xff) / 255
		this[1] = ((s >>  8) & 0xff) / 255
		this[2] = ( s        & 0xff) / 255
		return this
	}

	from_rgba(s) {
		this[0] = ((s >> 24) & 0xff) / 255
		this[1] = ((s >> 16) & 0xff) / 255
		this[2] = ((s >>  8) & 0xff) / 255
		this[3] = ( s        & 0xff) / 255
		return this
	}

	from_hsl(h, s, L, a) {
		set_hsl(this, h, s, L)
		this[3] = a ?? 1
		return this
	}

	len() {
		return sqrt(this.len2())
	}

	normalize() {
		return this.divs(this.len() || 1)
	}

	set_len(v) {
		return this.normalize().muls(v)
	}

	add(v, s) {
		s = s ?? 1
		this[0] += v[0] * s
		this[1] += v[1] * s
		this[2] += v[2] * s
		this[3] += v[3] * s
		return this
	}

	adds(s) {
		this[0] += s
		this[1] += s
		this[2] += s
		this[3] += s
		return this
	}

	sub(v) {
		this[0] -= v[0]
		this[1] -= v[1]
		this[2] -= v[2]
		this[3] -= v[3]
		return this
	}

	subs(s) {
		this[0] -= s
		this[1] -= s
		this[2] -= s
		this[3] -= s
		return this
	}

	mul(v) {
		this[0] *= v[0]
		this[1] *= v[1]
		this[2] *= v[2]
		this[3] *= v[3]
		return this
	}

	muls(s) {
		this[0] *= s
		this[1] *= s
		this[2] *= s
		this[3] *= s
		return this
	}

	div(v) {
		this[0] /= v[0]
		this[1] /= v[1]
		this[2] /= v[2]
		this[3] /= v[3]
		return this
	}

	divs(s) {
		return this.muls(1 / s)
	}

	min(v) {
		this[0] = min(this[0], v[0])
		this[1] = min(this[1], v[1])
		this[2] = min(this[2], v[2])
		this[3] = min(this[3], v[3])
		return this
	}

	max(v) {
		this[0] = max(this[0], v[0])
		this[1] = max(this[1], v[1])
		this[2] = max(this[2], v[2])
		this[3] = max(this[3], v[3])
		return this
	}

	negate() {
		this[0] = -this[0]
		this[1] = -this[1]
		this[2] = -this[2]
		this[3] = -this[3]
		return this
	}

	dot(v) {
		return (
			this[0] * v[0] +
			this[1] * v[1] +
			this[2] * v[2] +
			this[3] * v[3]
		)
	}

	transform(arg, out) {
		out ??= this
		if (arg.is_mat4) {
			let x = this[0]
			let y = this[1]
			let z = this[2]
			let w = this[3]
			let m = arg
			out[0] = m[0] * x + m[4] * y + m[ 8] * z + m[12] * w
			out[1] = m[1] * x + m[5] * y + m[ 9] * z + m[13] * w
			out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w
			out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w
		} else
			assert(false)
		return out
	}

}

let v4 = function v4(x, y, z, w) { return new v4_class(x, y, z, w) }
v4.class = v4_class

v4.add = function v4add(a, v, s, out) {
	s = s ?? 1
	out[0] = a[0] + v[0] * s
	out[1] = a[1] + v[1] * s
	out[2] = a[2] + v[2] * s
	out[3] = a[3] + v[3] * s
	return out
}

v4.sub = function v4sub(a, v, out) {
	out[0] = a[0] - v[0]
	out[1] = a[1] - v[1]
	out[2] = a[2] - v[2]
	out[3] = a[3] - v[3]
	return out
}

v4.mul = function v4mul(a, v, out) {
	out[0] = a[0] * v[0]
	out[1] = a[1] * v[1]
	out[2] = a[2] * v[2]
	out[3] = a[3] * v[3]
	return out
}

v4.div = function v4div(a, v, out) {
	out[0] = a[0] / v[0]
	out[1] = a[1] / v[1]
	out[2] = a[2] / v[2]
	out[3] = a[3] / v[3]
	return out
}

v4.origin = v4()
v4.one = v4(1, 1, 1)
v4.black = v4()
v4.white = v4.one

// mat3 ----------------------------------------------------------------------

let mat3_type = function(super_class, super_args) {

	let mat3_class = class m extends super_class {

		is_mat3 = true

		get e11() { return this[0] }; set e11(v) { this[0] = v }
		get e21() { return this[1] }; set e21(v) { this[1] = v }
		get e31() { return this[2] }; set e31(v) { this[2] = v }
		get e12() { return this[3] }; set e12(v) { this[3] = v }
		get e22() { return this[4] }; set e22(v) { this[4] = v }
		get e32() { return this[5] }; set e32(v) { this[5] = v }
		get e13() { return this[6] }; set e13(v) { this[6] = v }
		get e23() { return this[7] }; set e23(v) { this[7] = v }
		get e33() { return this[8] }; set e33(v) { this[8] = v }

		constructor() {
			super(...super_args)
		}

		set(n11, n12, n13, n21, n22, n23, n31, n32, n33) {
			let a = this
			if (n11.is_mat3)
				return this.from_array(n11, 0)
			if (n11.is_mat4) {
				let a = n11
				return this.set(
					a[0], a[4], a[ 8],
					a[1], a[5], a[ 9],
					a[2], a[6], a[10])
			} else {
				a[0] = n11
				a[1] = n21
				a[2] = n31
				a[3] = n12
				a[4] = n22
				a[5] = n32
				a[6] = n13
				a[7] = n23
				a[8] = n33
			}
			return this
		}

		assign(m) {
			assert(m.is_mat3)
			return assign(this, m)
		}

		to(v) {
			return v.set(this)
		}

		reset() {
			return this.set(
				1, 0, 0,
				0, 1, 0,
				0, 0, 1)
		}

		clone() {
			return mat3().set(this)
		}

		equals(m) {
			for (let i = 0; i < 9; i++)
				if (this[i] !== m[i])
					return false
			return true
		}

		from_array(a, ai) {
			for (let i = 0; i < 9; i++)
				this[i] = a[ai + i]
			return this
		}

		to_array(a, ai) {
			for (let i = 0; i < 9; i++)
				a[ai + i] = this[i]
			return a
		}

		from_mat3_array(a, i) { return this.from_array(a, 9 * i) }

		to_mat3_array(a, i) { return this.to_array(a, 9 * i) }

		transpose() {
			let tmp
			let m = this
			tmp = m[1]; m[1] = m[3]; m[3] = tmp
			tmp = m[2]; m[2] = m[6]; m[6] = tmp
			tmp = m[5]; m[5] = m[7]; m[7] = tmp
			return this
		}

		det() {
			let a = this[0]
			let b = this[1]
			let c = this[2]
			let d = this[3]
			let e = this[4]
			let f = this[5]
			let g = this[6]
			let h = this[7]
			let i = this[8]
			return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g
		}

		invert() {
			let n11 = this[0]
			let n21 = this[1]
			let n31 = this[2]
			let n12 = this[3]
			let n22 = this[4]
			let n32 = this[5]
			let n13 = this[6]
			let n23 = this[7]
			let n33 = this[8]
			let t11 = n33 * n22 - n32 * n23
			let t12 = n32 * n13 - n33 * n12
			let t13 = n23 * n12 - n22 * n13
			let det = n11 * t11 + n21 * t12 + n31 * t13
			if (det === 0)
				return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0)
			let detInv = 1 / det
			this[0] = t11 * detInv
			this[1] = (n31 * n23 - n33 * n21) * detInv
			this[2] = (n32 * n21 - n31 * n22) * detInv
			this[3] = t12 * detInv
			this[4] = (n33 * n11 - n31 * n13) * detInv
			this[5] = (n31 * n12 - n32 * n11) * detInv
			this[6] = t13 * detInv
			this[7] = (n21 * n13 - n23 * n11) * detInv
			this[8] = (n22 * n11 - n21 * n12) * detInv
			return this
		}

		mul(m) {
			return mat3.mul(this, m, this)
		}

		premul(m) {
			return mat3.mul(m, this, this)
		}

		muls(s) {
			this[0] *= s
			this[3] *= s
			this[6] *= s
			this[1] *= s
			this[4] *= s
			this[7] *= s
			this[2] *= s
			this[5] *= s
			this[8] *= s
			return this
		}

		scale(x, y) {
			if (isarray(x)) {
				let v = x
				x = v[0]
				y = v[1]
			} else {
				y = y ?? x
			}
			this[0] *= x
			this[3] *= x
			this[6] *= x
			this[1] *= y
			this[4] *= y
			this[7] *= y
			return this
		}

		rotate(angle) {
			let c = cos(angle)
			let s = sin(angle)
			let a11 = this[0]
			let a12 = this[3]
			let a13 = this[6]
			let a21 = this[1]
			let a22 = this[4]
			let a23 = this[7]
			this[0] =  c * a11 + s * a21
			this[3] =  c * a12 + s * a22
			this[6] =  c * a13 + s * a23
			this[1] = -s * a11 + c * a21
			this[4] = -s * a12 + c * a22
			this[7] = -s * a13 + c * a23
			return this
		}

		translate(x, y) {
			if (isarray(x)) {
				let v = x
				x = v[0]
				y = v[1]
			}
			this[0] += x * this[2]
			this[3] += x * this[5]
			this[6] += x * this[8]
			this[1] += y * this[2]
			this[4] += y * this[5]
			this[7] += y * this[8]
			return this
		}

	}

	let mat3 = function() { return new mat3_class() }
	mat3.class = mat3_class

	mat3.mul = function mat3mul(a, b, out) {

		let a11 = a[0]
		let a21 = a[1]
		let a31 = a[2]
		let a12 = a[3]
		let a22 = a[4]
		let a32 = a[5]
		let a13 = a[6]
		let a23 = a[7]
		let a33 = a[8]

		let b11 = b[0]
		let b21 = b[1]
		let b31 = b[2]
		let b12 = b[3]
		let b22 = b[4]
		let b32 = b[5]
		let b13 = b[6]
		let b23 = b[7]
		let b33 = b[8]

		out[0] = a11 * b11 + a12 * b21 + a13 * b31
		out[3] = a11 * b12 + a12 * b22 + a13 * b32
		out[6] = a11 * b13 + a12 * b23 + a13 * b33
		out[1] = a21 * b11 + a22 * b21 + a23 * b31
		out[4] = a21 * b12 + a22 * b22 + a23 * b32
		out[7] = a21 * b13 + a22 * b23 + a23 * b33
		out[2] = a31 * b11 + a32 * b21 + a33 * b31
		out[5] = a31 * b12 + a32 * b22 + a33 * b32
		out[8] = a31 * b13 + a32 * b23 + a33 * b33

		return out
	}

	return mat3

}

let mat3_ident = [1, 0, 0, 0, 1, 0, 0, 0, 1]
let mat3    = mat3_type(Array, mat3_ident)
let mat3f32 = mat3_type(f32arr, [mat3_ident])

mat3.identity = mat3()
mat3f32.identity = mat3f32()

// mat4 ----------------------------------------------------------------------

let mat4_type = function(super_class, super_args) {

	let mat4_class = class m extends super_class {

		is_mat4 = true

		get e11() { return this[ 0] }; set e11(v) { this[ 0] = v }
		get e21() { return this[ 1] }; set e21(v) { this[ 1] = v }
		get e31() { return this[ 2] }; set e31(v) { this[ 2] = v }
		get e41() { return this[ 3] }; set e41(v) { this[ 3] = v }
		get e12() { return this[ 4] }; set e12(v) { this[ 4] = v }
		get e22() { return this[ 5] }; set e22(v) { this[ 5] = v }
		get e32() { return this[ 6] }; set e32(v) { this[ 6] = v }
		get e42() { return this[ 7] }; set e42(v) { this[ 7] = v }
		get e13() { return this[ 8] }; set e13(v) { this[ 8] = v }
		get e23() { return this[ 9] }; set e23(v) { this[ 9] = v }
		get e33() { return this[10] }; set e33(v) { this[10] = v }
		get e43() { return this[11] }; set e43(v) { this[11] = v }
		get e14() { return this[12] }; set e14(v) { this[12] = v }
		get e24() { return this[13] }; set e24(v) { this[13] = v }
		get e34() { return this[14] }; set e34(v) { this[14] = v }
		get e44() { return this[15] }; set e44(v) { this[15] = v }

		constructor() {
			super(...super_args)
		}

		set(
			n11, n12, n13, n14,
			n21, n22, n23, n24,
			n31, n32, n33, n34,
			n41, n42, n43, n44
		) {
			if (n11.is_mat4)
				return this.from_array(n11, 0)
			if (n11.is_mat3) {
				let m = n11
				return this.set(
					m[0], m[3], m[6], 0,
					m[1], m[4], m[7], 0,
					m[2], m[5], m[8], 0,
					0   , 0   , 0   , 1)
			} else if (n11.is_quat) {
				return this.compose(v3.zero, n11, v3.one)
			} else {
				this[ 0] = n11
				this[ 1] = n21
				this[ 2] = n31
				this[ 3] = n41
				this[ 4] = n12
				this[ 5] = n22
				this[ 6] = n32
				this[ 7] = n42
				this[ 8] = n13
				this[ 9] = n23
				this[10] = n33
				this[11] = n43
				this[12] = n14
				this[13] = n24
				this[14] = n34
				this[15] = n44
			}
			return this
		}

		assign(m) {
			assert(m.is_mat4)
			return assign(this, m)
		}

		to(v) {
			return v.set(this)
		}

		reset() {
			return this.set(
				1, 0, 0, 0,
				0, 1, 0, 0,
				0, 0, 1, 0,
				0, 0, 0, 1)
		}

		clone() {
			return mat4().set(this)
		}

		equals(m) {
			for (let i = 0; i < 16; i++)
				if (this[i] !== m[i])
					return false
			return true
		}

		from_array(a, ai) {
			for (let i = 0; i < 16; i++)
				this[i] = a[ai + i]
			return this
		}

		to_array(a, ai) {
			for (let i = 0; i < 16; i++)
				a[ai + i] = this[i]
			return a
		}

		from_mat4_array(a, i) { return this.from_array(a, 16 * i) }

		to_mat4_array(a, i) { return this.to_array(a, 16 * i) }

		transpose() {
			let t
			let m = this
			t = m[ 1]; m[ 1] = m[ 4]; m[ 4] = t
			t = m[ 2]; m[ 2] = m[ 8]; m[ 8] = t
			t = m[ 6]; m[ 6] = m[ 9]; m[ 9] = t
			t = m[ 3]; m[ 3] = m[12]; m[12] = t
			t = m[ 7]; m[ 7] = m[13]; m[13] = t
			t = m[11]; m[11] = m[14]; m[14] = t
			return this
		}

		// http://www.euclideanspace.com/maths/algebra/matrix/functions/inverse/fourD/index.htm
		det() {
			let n11 = this[ 0]
			let n21 = this[ 1]
			let n31 = this[ 2]
			let n41 = this[ 3]
			let n12 = this[ 4]
			let n22 = this[ 5]
			let n32 = this[ 6]
			let n42 = this[ 7]
			let n13 = this[ 8]
			let n23 = this[ 9]
			let n33 = this[10]
			let n43 = this[11]
			let n14 = this[12]
			let n24 = this[13]
			let n34 = this[14]
			let n44 = this[15]
			return (
				  n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34)
				+ n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31)
				+ n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31)
				+ n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
			)
		}

		invert() {
			let a00 = this[ 0]
			let a01 = this[ 1]
			let a02 = this[ 2]
			let a03 = this[ 3]
			let a10 = this[ 4]
			let a11 = this[ 5]
			let a12 = this[ 6]
			let a13 = this[ 7]
			let a20 = this[ 8]
			let a21 = this[ 9]
			let a22 = this[10]
			let a23 = this[11]
			let a30 = this[12]
			let a31 = this[13]
			let a32 = this[14]
			let a33 = this[15]
			let b00 = a00 * a11 - a01 * a10
			let b01 = a00 * a12 - a02 * a10
			let b02 = a00 * a13 - a03 * a10
			let b03 = a01 * a12 - a02 * a11
			let b04 = a01 * a13 - a03 * a11
			let b05 = a02 * a13 - a03 * a12
			let b06 = a20 * a31 - a21 * a30
			let b07 = a20 * a32 - a22 * a30
			let b08 = a20 * a33 - a23 * a30
			let b09 = a21 * a32 - a22 * a31
			let b10 = a21 * a33 - a23 * a31
			let b11 = a22 * a33 - a23 * a32
			let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
			if (!det)
				return
			det = 1.0 / det
			this[ 0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
			this[ 1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
			this[ 2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
			this[ 3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
			this[ 4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
			this[ 5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
			this[ 6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
			this[ 7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
			this[ 8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
			this[ 9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
			this[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
			this[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
			this[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
			this[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
			this[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
			this[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
			return this
		}

		normal(out) {
			return out.set(this).invert().transpose()
		}

		mul(m) {
			return mat4.mul(this, m, this)
		}

		premul(m) {
			return mat4.mul(m, this, this)
		}

		muls(s) {
			this[ 0] *= s
			this[ 1] *= s
			this[ 2] *= s
			this[ 3] *= s
			this[ 4] *= s
			this[ 5] *= s
			this[ 6] *= s
			this[ 7] *= s
			this[ 8] *= s
			this[ 9] *= s
			this[10] *= s
			this[11] *= s
			this[12] *= s
			this[13] *= s
			this[14] *= s
			this[15] *= s
			return this
		}

		scale(x, y, z) {
			if (x.is_v3 || x.is_v4) {
				let v = x
				x = v[0]
				y = v[1]
				z = v[2]
			} else {
				y = y ?? x
				z = z ?? x
			}
			this[ 0] *= x
			this[ 4] *= y
			this[ 8] *= z
			this[ 1] *= x
			this[ 5] *= y
			this[ 9] *= z
			this[ 2] *= x
			this[ 6] *= y
			this[10] *= z
			this[ 3] *= x
			this[ 7] *= y
			this[11] *= z
			return this
		}

		set_position(x, y, z) {
			if (x.is_v3 || x.is_v4) {
				let v = x
				x = v[0]
				y = v[1]
				z = v[2]
			} else if (x.is_mat4) {
				let m = x
				x = m[12]
				y = m[13]
				z = m[14]
			}
			this[12] = x
			this[13] = y
			this[14] = z
			return this
		}

		translate(x, y, z) {
			if (x.is_v3 || x.is_v4) {
				let v = x
				x = v[0]
				y = v[1]
				z = v[2]
			}
			let m = this
			m[12] = m[0] * x + m[4] * y + m[ 8] * z + m[12]
			m[13] = m[1] * x + m[5] * y + m[ 9] * z + m[13]
			m[14] = m[2] * x + m[6] * y + m[10] * z + m[14]
			m[15] = m[3] * x + m[7] * y + m[11] * z + m[15]
			return this
		}

		rotate(axis, angle) {
			let x = axis[0]
			let y = axis[1]
			let z = axis[2]
			let len = Math.hypot(x, y, z)
			assert(len >= NEAR)
			len = 1 / len
			x *= len
			y *= len
			z *= len
			let s = sin(angle)
			let c = cos(angle)
			let t = 1 - c
			let a00 = this[ 0]
			let a01 = this[ 1]
			let a02 = this[ 2]
			let a03 = this[ 3]
			let a10 = this[ 4]
			let a11 = this[ 5]
			let a12 = this[ 6]
			let a13 = this[ 7]
			let a20 = this[ 8]
			let a21 = this[ 9]
			let a22 = this[10]
			let a23 = this[11]
			// construct the elements of the rotation matrix.
			let b00 = x * x * t + c
			let b01 = y * x * t + z * s
			let b02 = z * x * t - y * s
			let b10 = x * y * t - z * s
			let b11 = y * y * t + c
			let b12 = z * y * t + x * s
			let b20 = x * z * t + y * s
			let b21 = y * z * t - x * s
			let b22 = z * z * t + c
			// perform rotation-specific matrix multiplication.
			this[ 0] = a00 * b00 + a10 * b01 + a20 * b02
			this[ 1] = a01 * b00 + a11 * b01 + a21 * b02
			this[ 2] = a02 * b00 + a12 * b01 + a22 * b02
			this[ 3] = a03 * b00 + a13 * b01 + a23 * b02
			this[ 4] = a00 * b10 + a10 * b11 + a20 * b12
			this[ 5] = a01 * b10 + a11 * b11 + a21 * b12
			this[ 6] = a02 * b10 + a12 * b11 + a22 * b12
			this[ 7] = a03 * b10 + a13 * b11 + a23 * b12
			this[ 8] = a00 * b20 + a10 * b21 + a20 * b22
			this[ 9] = a01 * b20 + a11 * b21 + a21 * b22
			this[10] = a02 * b20 + a12 * b21 + a22 * b22
			this[11] = a03 * b20 + a13 * b21 + a23 * b22
			return this
		}

		frustum(left, right, bottom, top, near, far) {
			let rl = 1 / (right - left)
			let tb = 1 / (top - bottom)
			let nf = 1 / (near - far)
			this[ 0] = near * 2 * rl
			this[ 1] = 0
			this[ 2] = 0
			this[ 3] = 0
			this[ 4] = 0
			this[ 5] = near * 2 * tb
			this[ 6] = 0
			this[ 7] = 0
			this[ 8] = (right + left) * rl
			this[ 9] = (top + bottom) * tb
			this[10] = (far + near) * nf
			this[11] = -1
			this[12] = 0
			this[13] = 0
			this[14] = far * near * 2 * nf
			this[15] = 0
			return this
		}

		perspective(fovy, aspect, near, far) {
			let f = 1 / tan(fovy / 2)
			this[ 0] = f / aspect
			this[ 1] = 0
			this[ 2] = 0
			this[ 3] = 0
			this[ 4] = 0
			this[ 5] = f
			this[ 6] = 0
			this[ 7] = 0
			this[ 8] = 0
			this[ 9] = 0
			this[11] = -1
			this[12] = 0
			this[13] = 0
			this[15] = 0
			if (far != null && far != 1/0) {
				let nf = 1 / (near - far)
				this[10] = (far + near) * nf
				this[14] = 2 * far * near * nf
			} else {
				this[10] = -1
				this[14] = -2 * near
			}
			return this
		}

		ortho(left, right, bottom, top, near, far) {
			let w = 1.0 / (right - left)
			let h = 1.0 / (top - bottom)
			let p = 1.0 / (far - near)
			let x = (right + left) * w
			let y = (top + bottom) * h
			let z = (far + near) * p
			this[ 0] = 2 * w
			this[ 4] = 0
			this[ 8] = 0
			this[12] = -x
			this[ 1] = 0
			this[ 5] = 2 * h
			this[ 9] = 0
			this[13] = -y
			this[ 2] = 0
			this[ 6] = 0
			this[10] = -2 * p
			this[14] = -z
			this[ 3] = 0
			this[ 7] = 0
			this[11] = 0
			this[15] = 1
			return this
		}

		// NOTE: dir is the opposite of the direction vector pointing towards the target!
		look_at(dir, up) {
			let z = _v0.set(dir).normalize()
			let x = _v1.set(up).cross(z)
			if (!x.len2()) { // up and z are parallel, diverge them a little.
				if (abs(up.z) == 1)
					z.x += 0.0001
				else
					z.z += 0.0001
				z.normalize()
				x.set(up).cross(z)
			}
			x.normalize()
			let y = _v2.set(z).cross(x)
			this[ 0] = x[0]
			this[ 4] = y[0]
			this[ 8] = z[0]
			this[ 1] = x[1]
			this[ 5] = y[1]
			this[ 9] = z[1]
			this[ 2] = x[2]
			this[ 6] = y[2]
			this[10] = z[2]
			return this
		}

		compose(pos, quat, scale) {
			let x = quat[0]
			let y = quat[1]
			let z = quat[2]
			let w = quat[3]
			let x2 = x + x
			let y2 = y + y
			let z2 = z + z
			let xx = x * x2
			let xy = x * y2
			let xz = x * z2
			let yy = y * y2
			let yz = y * z2
 			let zz = z * z2
			let wx = w * x2
			let wy = w * y2
			let wz = w * z2
			let sx = scale[0]
			let sy = scale[1]
			let sz = scale[2]
			this[ 0] = (1 - (yy + zz)) * sx
			this[ 1] = (xy + wz) * sx
			this[ 2] = (xz - wy) * sx
			this[ 3] = 0
			this[ 4] = (xy - wz) * sy
			this[ 5] = (1 - (xx + zz)) * sy
			this[ 6] = (yz + wx) * sy
			this[ 7] = 0
			this[ 8] = (xz + wy) * sz
			this[ 9] = (yz - wx) * sz
			this[10] = (1 - (xx + yy)) * sz
			this[11] = 0
			this[12] = pos[0]
			this[13] = pos[1]
			this[14] = pos[2]
			this[15] = 1
			return this
		}

		// http://www.gamedev.net/reference/articles/article1199.asp
		rotation(axis, angle) {
			let c = cos(angle)
			let s = sin(angle)
			let t = 1 - c
			let x = axis[0]
			let y = axis[1]
			let z = axis[2]
			let tx = t * x
			let ty = t * y
			this.set(
				tx * x + c    , tx * y - s * z, tx * z + s * y, 0,
				tx * y + s * z, ty * y + c    , ty * z - s * x, 0,
				tx * z - s * y, ty * z + s * x, t * z * z + c , 0,
				0             ,              0,              0, 1)
			return this
		}

	}

	let mat4 = function(elements) { return new mat4_class(elements) }
	mat4.class = mat4_class

	mat4.mul = function mat4mul(a, b, out) {

		let a11 = a[ 0]
		let a21 = a[ 1]
		let a31 = a[ 2]
		let a41 = a[ 3]
		let a12 = a[ 4]
		let a22 = a[ 5]
		let a32 = a[ 6]
		let a42 = a[ 7]
		let a13 = a[ 8]
		let a23 = a[ 9]
		let a33 = a[10]
		let a43 = a[11]
		let a14 = a[12]
		let a24 = a[13]
		let a34 = a[14]
		let a44 = a[15]

		let b11 = b[ 0]
		let b21 = b[ 1]
		let b31 = b[ 2]
		let b41 = b[ 3]
		let b12 = b[ 4]
		let b22 = b[ 5]
		let b32 = b[ 6]
		let b42 = b[ 7]
		let b13 = b[ 8]
		let b23 = b[ 9]
		let b33 = b[10]
		let b43 = b[11]
		let b14 = b[12]
		let b24 = b[13]
		let b34 = b[14]
		let b44 = b[15]

		out[ 0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41
		out[ 4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42
		out[ 8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43
		out[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44
		out[ 1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41
		out[ 5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42
		out[ 9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43
		out[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44
		out[ 2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41
		out[ 6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42
		out[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43
		out[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44
		out[ 3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41
		out[ 7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42
		out[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43
		out[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44

		return out
	}

	return mat4

}

let mat4_ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
let mat4    = mat4_type(Array, mat4_ident)
let mat4f32 = mat4_type(f32arr, [mat4_ident])

mat4.identity = mat4()
mat4f32.identity = mat4f32()

// quaternion ----------------------------------------------------------------

let quat_class = class q extends Array {

	is_quat = true

	get x() { return this[0] }; set x(v) { this[0] = v }
	get y() { return this[1] }; set y(v) { this[1] = v }
	get z() { return this[2] }; set z(v) { this[2] = v }
	get w() { return this[3] }; set w(v) { this[3] = v }

	constructor(x, y, z, w) {
		super(x ?? 0, y ?? 0, z ?? 0, w ?? 1)
	}

	set(x, y, z, w) {
		if (x.is_quat) {
			let v = x
			x = v[0]
			y = v[1]
			z = v[2]
			w = v[3]
		}
		this[0] = x
		this[1] = y
		this[2] = z
		this[3] = w ?? 1
		return this
	}

	assign(v) {
		assert(v.is_quat)
		return assign(this, v)
	}

	to(v) {
		return v.set(this)
	}

	reset() {
		return this.set(0, 0, 0, 1)
	}

	clone() {
		return quat().set(this)
	}

	equals(q) {
		return (
			q[0] === this[0] &&
			q[1] === this[1] &&
			q[2] === this[2] &&
			q[3] === this[3]
		)
	}

	from_array(a, i) {
		this[0] = a[i  ]
		this[1] = a[i+1]
		this[2] = a[i+2]
		this[3] = a[i+3]
		return this
	}

	to_array(a, i) {
		a[i  ] = this[0]
		a[i+1] = this[1]
		a[i+2] = this[2]
		a[i+3] = this[3]
		return a
	}

	from_quat_array(a, i) { return this.from_array(a, 4 * i) }

	to_quat_array(a, i) { return this.to_array(a, 4 * i) }

	// http://www.euclideanspace.com/maths/geometry/rotations/conversions/angleToQuaternion/index.htm
	// assumes axis is normalized
	set_from_axis_angle(axis, angle) {
		let s = sin(angle / 2)
		this[0] = axis[0] * s
		this[1] = axis[1] * s
		this[2] = axis[2] * s
		this[3] = cos(angle / 2)
		return this
	}

	// http://www.euclideanspace.com/maths/geometry/rotations/conversions/matrixToQuaternion/index.htm
	// assumes the upper 3x3 of m is a pure rotation matrix (i.e, unscaled)
	set_from_rotation_matrix(m) {
		let m11 = m[ 0]
		let m21 = m[ 1]
		let m31 = m[ 2]
		let m12 = m[ 4]
		let m22 = m[ 5]
		let m32 = m[ 6]
		let m13 = m[ 8]
		let m23 = m[ 9]
		let m33 = m[10]
		let trace = m11 + m22 + m33
		if (trace > 0) {
			let s = 0.5 / sqrt(trace + 1.0)
			this[3] = 0.25 / s
			this[0] = (m32 - m23) * s
			this[1] = (m13 - m31) * s
			this[2] = (m21 - m12) * s
		} else if (m11 > m22 && m11 > m33) {
			let s = 2.0 * sqrt(1.0 + m11 - m22 - m33)
			this[3] = (m32 - m23) / s
			this[0] = 0.25 * s
			this[1] = (m12 + m21) / s
			this[2] = (m13 + m31) / s
		} else if (m22 > m33) {
			let s = 2.0 * sqrt(1.0 + m22 - m11 - m33)
			this[3] = (m13 - m31) / s
			this[0] = (m12 + m21) / s
			this[1] = 0.25 * s
			this[2] = (m23 + m32) / s
		} else {
			let s = 2.0 * sqrt(1.0 + m33 - m11 - m22)
			this[3] = (m21 - m12) / s
			this[0] = (m13 + m31) / s
			this[1] = (m23 + m32) / s
			this[2] = 0.25 * s
		}
		return this
	}

	// assumes direction vectors are normalized.
	set_from_unit_vectors(from, to) {
		let [x, y, z] = from
		let r = from.dot(to) + 1 // 1 because from.lenth() * to.length() == 1
		if (r < NEAR) {
			r = 0
			if (abs(x) > abs(z)) {
				this[0] = -y
				this[1] =  x
				this[2] =  0
			} else {
				this[0] =  0
				this[1] = -z
				this[2] =  y
			}
		} else {
			v3.cross(from, to, this)
		}
		this[3] = r
		return this.normalize()
	}

	rotate_towards(q, step) {
		let angle = this.angle_to(q)
		if (angle === 0) return this
		let t = min(1, step / angle)
		this.slerp(q, t)
		return this
	}

	conjugate() {
		this[0] *= -1
		this[1] *= -1
		this[2] *= -1
		return this
	}

	// assumed to have unit length!
	invert() {
		return this.conjugate()
	}

	len2() {
		return (
			this[0] ** 2 +
			this[1] ** 2 +
			this[2] ** 2 +
			this[3] ** 2
		)
	}

	len() {
		return sqrt(this.len2())
	}

	normalize() {
		let l = this.len()
		if (l === 0) {
			this.reset()
		} else {
			l = 1 / l
			this[0] *= l
			this[1] *= l
			this[2] *= l
			this[3] *= l
		}
		return this
	}

	angle_to(q) {
		return 2 * acos(abs(clamp(this.dot(q), -1, 1)))
	}

	dot(v) {
		return this[0] * v[0] + this[1] * v[1] + this[2] * v[2] + this[3] * v[3]
	}

	mul(q, p) {
		return quat.mul(this, q, this)
	}

	premul(q) {
		return quat.mul(q, this, this)
	}

	// http://www.euclideanspace.com/maths/algebra/realNormedAlgebra/quaternions/slerp/
	slerp(qb, t) {
		if (t === 0) return this
		if (t === 1) return this.set(qb)
		let x = this[0]
		let y = this[1]
		let z = this[2]
		let w = this[3]

		let cos_half_angle = w * qb.w + x * qb.x + y * qb.y + z * qb.z

		if (cos_half_angle < 0) {
			this.w = -qb.w
			this.x = -qb.x
			this.y = -qb.y
			this.z = -qb.z
			cos_half_angle = -cos_half_angle
		} else {
			this.set(qb)
		}

		if (cos_half_angle >= 1.0) {
			this.w = w
			this.x = x
			this.y = y
			this.z = z
			return this
		}

		let sqr_sin_half_angle = 1.0 - cos_half_angle * cos_half_angle

		if (sqr_sin_half_angle <= NEAR) {
			let s = 1 - t
			this.w = s * w + t * this.w
			this.x = s * x + t * this.x
			this.y = s * y + t * this.y
			this.z = s * z + t * this.z
			this.normalize()
			return this
		}

		let sin_half_angle = sqrt(sqr_sin_half_angle)
		let half_angle = atan2(sin_half_angle, cos_half_angle)
		let r1 = sin((1 - t) * half_angle) / sin_half_angle
		let r2 = sin(t * half_angle) / sin_half_angle
		this.w = w * r1 + this.w * r2
		this.x = x * r1 + this.x * r2
		this.y = y * r1 + this.y * r2
		this.z = z * r1 + this.z * r2

		return this
	}


	transform(x, y, z, o) { // quat * v3 -> v3

		o ??= out
		let [qx, qy, qz, qw] = this

		let ix =  qw * x + qy * z - qz * y
		let iy =  qw * y + qz * x - qx * z
		let iz =  qw * z + qx * y - qy * x
		let iw = -qx * x - qy * y - qz * z // result * inverse quat

		o[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy
		o[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz
		o[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx

		return o
	}

	transform33(p, out) {
		return this.transform(p[0], p[1], p[2], out)
	}

}

let quat = function(x, y, z, w) { return new quat_class(x, y, z, w) }
quat.class = quat_class
let quat3 = quat

// from http://www.euclideanspace.com/maths/algebra/realNormedAlgebra/quaternions/code/index.htm
quat.mul = function quatmul(a, b, out) {
	let [ax, ay, az, aw] = a
	let [bx, by, bz, bw] = b
	out[0] = ax * bw + aw * bx + ay * bz - az * by
	out[1] = ay * bw + aw * by + az * bx - ax * bz
	out[2] = az * bw + aw * bz + ax * by - ay * bx
	out[3] = aw * bw - ax * bx - ay * by - az * bz
	return out
}

let _q0 = quat() // for v3

// plane ---------------------------------------------------------------------

let _m3_1 = mat3()

let plane_class = class plane {

	is_plane = true

	constructor(normal, constant) {
		this.normal = normal ?? v3.up.clone()
		this.constant = constant ?? 0
	}

	set(normal, constant) {
		if (normal.is_plane) {
			let pl = normal
			this.normal.set(pl.normal)
			this.constant = pl.constant
		} else {
			this.normal.set(normal)
			this.constant = constant
		}
		this.invalidate()
		return this
	}

	assign(v) {
		assert(v.is_plane)
		let normal = this.normal
		assign(this, v)
		this.normal = normal.assign(v.normal)
		this.invalidate()
		return this
	}

	to(v) {
		return v.set(this)
	}

	clone() {
		return new plane(this.normal.clone(), this.constant)
	}

	equals(v) {
		return v.normal.equals(this.normal) && v.constant === this.constant
	}

	s() { return [this.constant, ...this.normal.s()] }

	set_from_normal_and_coplanar_point(normal, v) {
		this.normal.set(normal)
		this.constant = -v.dot(this.normal)
		this.invalidate()
		return this
	}

	set_from_coplanar_points(a, b, c) {
		let normal = _v1.set(c).sub(b).cross(_v2.set(a).sub(b)).normalize()
		this.set_from_normal_and_coplanar_point(normal, a)
		this.invalidate()
		return this
	}

	// Newell's method.
	set_from_poly3(poly) {
		let n = poly.point_count()
		assert(n >= 3)
		let pn = _v1.set(0, 0, 0)
		let p1 = poly.get_point3(n-1, _v2)
		for (let i = 0; i < n; i++) {
			let p2 = poly.get_point3(i, _v3)
			pn[0] += (p1[1] - p2[1]) * (p1[2] + p2[2])
			pn[1] += (p1[2] - p2[2]) * (p1[0] + p2[0])
			pn[2] += (p1[0] - p2[0]) * (p1[1] + p2[1])
			p1.set(p2)
		}
		pn.normalize()
		return this.set_from_normal_and_coplanar_point(pn, p1)
	}

	normalize() {
		// Note: will lead to a divide by zero if the plane is invalid.
		let inv_len = 1.0 / this.normal.len()
		this.normal.muls(inv_len)
		this.constant *= inv_len
		this.invalidate()
		return this
	}

	negate() {
		this.constant *= -1
		this.normal.negate()
		this.invalidate()
		return this
	}

	distance_to_point(p) {
		return this.normal.dot(p) + this.constant
	}

	project_point(p, out) {
		assert(p != out)
		return out.set(this.normal).muls(-this.distance_to_point(p)).add(p)
	}

	intersect_line(line, out, mode) {
		let dir = line.delta(_v1)
		let denom = this.normal.dot(dir)
		if (abs(denom) < NEAR)
			return // line is on the plane
		let t = -(line[0].dot(this.normal) + this.constant) / denom
		let p = out.set(dir).muls(t).add(line[0])
		if (mode == 'strict' && (t < 0 || t > 1))
			return // intersection point is outside of the line segment.
		p.t = t
		return p
	}

	intersects_line(line) {
		let d1 = this.distance_to_point(line[0])
		let d2 = this.distance_to_point(line[1])
		return (
			(d2 < -NEAR && d1 > NEAR && 'through-front') ||
			(d1 < -NEAR && d2 > NEAR && 'through-back') ||
			(d1 >= -NEAR && d2 >= -NEAR && 'in-front') || 'behind'
		)
	}

	// shorten line to only the part that's in front of the plane.
	clip_line(line) {
		let hit = this.intersects_line(line)
		line.clip = hit
		if (hit == 'in-front')
			return line
		if (hit == 'behind')
			return
		let int_p = this.intersect_line(line, _v4, 'strict')
		if (!int_p) // line is on the plane or not intersecting the plane.
			return line
		if (hit == 'through-front')
			line[1].set(int_p)
		else
			line[0].set(int_p)
		return line
	}

	// intersect two planes resulting in a direction vector.
	intersect_plane(other, dir) {
		dir.set(this.normal).cross(other.normal)
		if (abs(dir.distance(v3.zero)) <= NEAR) // planes are parallel
			return
		return dir
	}

	// project the plane's normal at origin onto the plane.
	origin(out) {
		return out.set(this.normal).muls(-this.constant)
	}

	translate(offset) {
		this.constant -= offset.dot(this.normal)
		this.invalidate()
		return this
	}

	transform(m) {
		let nm = m.normal(_m3_1)
		let ref_p = this.origin(_v0).transform(m)
		let normal = this.normal.transform(nm).normalize()
		this.constant = -ref_p.dot(normal)
		this.invalidate()
		return this
	}

	// TODO: implement the inverse of this (2D->3D) and use it instead of quaternions.
	xyz_xy_transformer() {
		let trans = this._xyz_xy_trans
		if (!trans) {
			let o = this.origin(v3())
			let n = this.normal
			let p = n.ortho_normal(v3())
			let q = n.clone().cross(p).normalize()
			assert(near(p.dot(q), 0))
			assert(near(p.dot(n), 0))
			assert(near(q.dot(n), 0))
			// let s = n.dot(d)
			let out = [0, 0]
			trans = function(x, y, z) {
				x -= o[0]
				y -= o[1]
				z -= o[2]
				out[0] = p[0] * x + p[1] * y + p[2] * z
				out[1] = q[0] * x + q[1] * y + q[2] * z
				return out
			}
			this._xyz_xy_trans = trans
		}
		return trans
	}

	/*
	use for testing the above....
	let pl; {
		pl = plane()
		pl.set_from_coplanar_points(v3(1, 0, 0), v3(2, 1, 0), v3(2, 1, 1))
		let r1 = v3(2, 1, 1)
		let r2 = v3(1, 0, 0)
		let d3 = r1.distance(r2)
		let p1 = v2(...pl.xyz_xy_transformer()(...r1))
		let p2 = v2(...pl.xyz_xy_transformer()(...r2))
		let d2 = p1.distance(p2)
		pr(abs(d3 - d2))
		pr(p1)
		pr(p2)
		// v2.zero.distance(v2(x, y)), v3.zero.distance(r))
	}
	*/

	// xyz_quat puts 2D points on the plane.
	xyz_quat() {
		let q = this._xyz_quat
		if (!this._xyz_quat_valid) {
			if (!q) {
				q = quat()
				this._xyz_quat = q
			}
			q.set_from_unit_vectors(v3.z_axis, this.normal)
			this._xyz_quat_valid = true
		}
		return q
	}

	// xy_quat projects 3D points on the xy plane.
	xy_quat() {
		let q = this._xy_quat
		if (!this._xy_quat_valid) {
			if (!q) {
				q = quat()
				this._xy_quat = q
			}
			q.set_from_unit_vectors(this.normal, v3.z_axis)
			this._xy_quat_valid = true
		}
		return q
	}

	transform_xyz_xy(x, y, z, out) {
		let r = this.xy_quat().transform(x, y, z)
		if (out) {
			out[0] = r[0]
			out[1] = r[1]
			return out
		}
		return r
	}

	transform_xy_xyz(x, y, out) {
		this.c ??= this.xy_quat().transform(...this.origin(v3()))[2]
		return this.xyz_quat().transform(x, y, this.c, out)
	}

	transform32(p, out) {
		let r = this.transform_xyz_xy(p[0], p[1], p[2])
		out[0] = r[0]
		out[1] = r[1]
		return out
	}

	transform23(p, out) {
		return this.transform_xy_xyz(p[0], p[1], out)
	}

	invalidate() {
		this._xy_quat_valid = false
		this._xyz_quat_valid = false
		this._xyz_xy_trans = null
		this.c = null
	}

}

let plane = function(normal, constant) { return new plane_class(normal, constant) }
plane.class = plane_class
let plane3 = plane // so you can do `let plane = plane3()`.

// triangle2 -----------------------------------------------------------------

let triangle2_class = class tri2 extends Array {

	is_triangle2 = true

	constructor(a, b, c) {
		super(a ?? v2(), b ?? v2(), c ?? v2())
	}

	set(a, b, c) {
		if (a.is_triangle2) {
			let t = a
			this[0].set(t[0])
			this[1].set(t[1])
			this[2].set(t[2])
		} else {
			this[0].set(a)
			this[1].set(b)
			this[2].set(c)
		}
		return this
	}

	assign(v) {
		assert(v.is_triangle2)
		let p0 = this[0]
		let p1 = this[1]
		let p2 = this[2]
		assign(this, v)
		this[0] = p0.assign(v[0])
		this[1] = p1.assign(v[1])
		this[2] = p2.assign(v[2])
		return this
	}

	to(v) {
		return v.set(this)
	}

	clone() {
		return new triangle2().set(this)
	}

	equals(t) {
		return (
			t[0].equals(this[0]) &&
			t[1].equals(this[1]) &&
			t[2].equals(this[2])
		)
	}

	from_array(a, i) {
		this[0][0] = a[i+0]
		this[0][1] = a[i+1]
		this[1][0] = a[i+2]
		this[1][1] = a[i+3]
		this[2][0] = a[i+4]
		this[2][1] = a[i+5]
		return this
	}

	to_array(a, i) {
		a[i+0] = this[0][0]
		a[i+1] = this[0][1]
		a[i+2] = this[1][0]
		a[i+3] = this[1][1]
		a[i+4] = this[2][0]
		a[i+5] = this[2][1]
		return a
	}

	from_triangle2_array(a, i) { return this.from_array(a, 6 * i) }

	to_triangle2_array(a, i) { return this.to_array(a, 6 * i) }

	area() {
		let [x1, y1] = this[0]
		let [x2, y2] = this[1]
		let [x3, y3] = this[2]
		return .5 * abs(x1*y2 - x2*y1 + x2*y3 - x3*y2 + x3*y1 - x1*y3)
	}

	midpoint(out) {
		let [x1, y1] = this[0]
		let [x2, y2] = this[1]
		let [x3, y3] = this[2]
		out[0] = (x1 + x2 + x3) * (1/3)
		out[1] = (y1 + y2 + y3) * (1/3)
		return out
	}

	hit(x, y) {
		return triangle2.hit(x, y, this[0], this[1], this[2])
	}

	contains_point(p) {
		return triangle2.hit(p[0], p[1], this[0], this[1], this[2])
	}

}

let triangle2 = function(a, b, c) { return new triangle2_class(a, b, c) }
triangle2.class = triangle2_class

triangle2.hit = function triangle2_hit(x, y, p1, p2, p3) {
	let [x1, y1] = p1
	let [x2, y2] = p2
	let [x3, y3] = p3
	let denom = ((y2 - y3)*(x1 - x3) + (x3 - x2)*(y1 - y3))
	let a = ((y2 - y3)*(x - x3) + (x3 - x2)*(y - y3)) / denom
	let b = ((y3 - y1)*(x - x3) + (x1 - x3)*(y - y3)) / denom
	let c = 1 - a - b
	return 0 <= a && a <= 1 && 0 <= b && b <= 1 && 0 <= c && c <= 1
}

// triangle3 -----------------------------------------------------------------

let triangle3_class = class tri3 extends Array {

	is_triangle3 = true

	constructor(a, b, c) {
		super(a ?? v3(), b ?? v3(), c ?? v3())
	}

	set(a, b, c) {
		if (a.is_triangle3) {
			let t = a
			this[0].set(t[0])
			this[1].set(t[1])
			this[2].set(t[2])
		} else {
			this[0].set(a)
			this[1].set(b)
			this[2].set(c)
		}
		return this
	}

	assign(v) {
		assert(v.is_triangle3)
		let p0 = this[0]
		let p1 = this[1]
		let p2 = this[2]
		assign(this, v)
		this[0] = p0.assign(v[0])
		this[1] = p1.assign(v[1])
		this[2] = p2.assign(v[2])
		return this
	}

	to(v) {
		return v.set(this)
	}

	clone() {
		return new triangle3().set(this)
	}

	equals(t) {
		return (
			t[0].equals(this[0]) &&
			t[1].equals(this[1]) &&
			t[2].equals(this[2])
		)
	}

	from_array(a, i) {
		this[0][0] = a[i+0]
		this[0][1] = a[i+1]
		this[0][2] = a[i+2]
		this[1][0] = a[i+3]
		this[1][1] = a[i+4]
		this[1][2] = a[i+5]
		this[2][0] = a[i+6]
		this[2][1] = a[i+7]
		this[2][2] = a[i+8]
		return this
	}

	to_array(a, i) {
		a[i+0] = this[0][0]
		a[i+1] = this[0][1]
		a[i+2] = this[0][2]
		a[i+3] = this[1][0]
		a[i+4] = this[1][1]
		a[i+5] = this[1][2]
		a[i+6] = this[2][0]
		a[i+7] = this[2][1]
		a[i+8] = this[2][2]
		return a
	}

	from_triangle3_array(a, i) { return this.from_array(a, 9 * i) }

	to_triangle3_array(a, i) { return this.to_array(a, 9 * i) }

	area() {
		_v0.set(this[2]).sub(this[1])
		_v1.set(this[0]).sub(this[1])
		return _v0.cross(_v1).len() * 0.5
	}

	midpoint(out) {
		return out.set(this[0]).add(this[1]).add(this[2]).muls(1 / 3)
	}

	normal(out) {
		return triangle3.normal(this[0], this[1], this[2], out)
	}

	plane(out) {
		return out.set_from_coplanar_points(this[0], this[1], this[2])
	}

	barycoord(p, out) {
		return triangle3.barycoord(p, this[0], this[1], this[2], out)
	}

	uv(p, uv1, uv2, uv3, out) {
		return triangle3.uv(p, this[0], this[1], this[2], uv1, uv2, uv3, out)
	}

	contains_point(p) {
		return triangle3.contains_point(p, this[0], this[1], this[2])
	}

	is_front_facing(direction) {
		return triangle3.is_front_facing(this[0], this[1], this[2], direction)
	}

}

let triangle3 = function(a, b, c) { return new triangle3_class(a, b, c) }
triangle3.class = triangle3_class

triangle3.normal = function tri3normal(a, b, c, out) {
	out.set(c).sub(b)
	_v0.set(a).sub(b)
	out.cross(_v0)
	let out_len2 = out.len2()
	if (out_len2 > 0)
		return out.muls(1 / sqrt(out_len2))
	return out.set(0, 0, 0)
}

// static/instance method to calculate barycentric coordinates
// http://www.blackpawn.com/texts/pointinpoly/default.html
triangle3.barycoord = function triangle3_barycoord(p, a, b, c, out) {
	_v0.set(c).sub(a)
	_v1.set(b).sub(a)
	_v2.set(p).sub(a)
	let dot00 = _v0.dot(_v0)
	let dot01 = _v0.dot(_v1)
	let dot02 = _v0.dot(_v2)
	let dot11 = _v1.dot(_v1)
	let dot12 = _v1.dot(_v2)
	let denom = dot00 * dot11 - dot01 * dot01
	if (denom == 0)
		return
	let inv_denom = 1 / denom
	let u = (dot11 * dot02 - dot01 * dot12) * inv_denom
	let v = (dot00 * dot12 - dot01 * dot02) * inv_denom // barycentric coordinates must always sum to 1
	return out.set(1 - u - v, v, u)
}

triangle3.contains_point = function triangle3_contains_point(p, a, b, c) {
	let bc = this.barycoord(p, a, b, c, _v3)
	if (!bc) // degenerate triangle.
		return false
	let x = bc[0]
	let y = bc[1]
	return x >= 0 && y >= 0 && x + y <= 1
}

triangle3.uv = function triangle3_uv(p, p1, p2, p3, uv1, uv2, uv3, out) {
	let bc = this.barycoord(p, p1, p2, p3, _v3)
	out.set(0, 0)
	out.add(uv1, bc[0])
	out.add(uv2, bc[1])
	out.add(uv3, bc[2])
	return out
}

triangle3.is_front_facing = function triangle3_is_front_facing(a, b, c, direction) {
	let p = _v0.set(c).sub(b)
	let q = _v1.set(a).sub(b) // strictly front facing
	return p.cross(q).dot(direction) < 0
}

// polygon offseting algorithm -----------------------------------------------

// TODO: remove this
function set_seg_offset(p1, p2, d) {
	for (let seg of p1.segs) {
		if (seg[0] == p2) { // (p2,p1) right side offset
			seg[-2] = d
			return
		} else if (seg[1] == p2) { // (p1,p2) right side offset
			seg[-1] = d
			return
		}
	}
	// TODO: see why this breaks
	///assert(false, '#'+p1.segs.length)
}

// TODO: implement fast path for axis-aligned segments.
function offset_corner(p0, p1, p2, d) {
	set_seg_offset(p0, p1, d)
	set_seg_offset(p1, p2, d)
	p0.max_offset = max(p0.max_offset, abs(d))
	p1.max_offset = max(p1.max_offset, abs(d))
	p2.max_offset = max(p2.max_offset, abs(d))
	let [x1, y1, x2, y2] = line2.offset( d, p0[0], p0[1], p1[0], p1[1])
	let [x3, y3, x4, y4] = line2.offset(-d, p2[0], p2[1], p1[0], p1[1])
	let [t1, t2] = line2.intersect_line(x1, y1, x2, y2, x3, y3, x4, y4)
	if (abs(t1) == inf) { // 0-degree corner: make a line cap of 2 points, 1*d thick
		let dx = x2 == x4 ? d * sign(x1 - x2) : 0
		let dy = y2 == y4 ? d * sign(y1 - y2) : 0
		out[0] = x2 + dx
		out[1] = y2 + dy
		out[2] = x4 + dx
		out[3] = y4 + dy
	} else if (t1 != t1) { // 180-degree corner: use the offset point on the first line
		out[0] = x2
		out[1] = y2
		out[2] = null
		out[3] = null
	} else { // bent corner
		out[2] = null
		out[3] = null
		if (x1 == x2 && y3 == y4 || y1 == y2 && x3 == x4) { // axis-aligned and _|_ to each other
			let t1s = -sign(t1-1) // branchless version of t1 < 1 ? 1 : -1
			out[0] = x2 + d * sign(x2 - x1) * t1s
			out[1] = y2 + d * sign(y2 - y1) * t1s
		} else {
			line2.at(t1, x1, y1, x2, y2, out)
		}
	}
	return out
}

// TODO: use custom create_point()
// TODO: use get_point() and point_count()
function poly_offset(ps, d, ops) {

	ops.length = 0

	if (!ps.length)
		return ops

	// remove null segments as we can't offset those (they don't have a normal).
	let ps1 = ps; ps = []
	let n = ps1.length
	let p0 = ps1[n-1]
	for (let i = 0; i < n; i++) {
		let p1 = ps1[i]
		if (!v2.near(p0, p1))
			ps.push(p1)
		p0 = p1
	}

	if (!ps.length)
		ps.push(ps1[0])
	n = ps.length
	if (n == 1) { // single null seg: make a square
		let ci = 0
		for (let op of [[-d, -d], [d, -d], [d, d], [-d, d]]) {
			op[0] += ps[0][0]
			op[1] += ps[0][1]
			op.p = ps[0]
			op.d = d
			op.ci = ci++
			ops.push(op)
		}
	} else {
		let ci = 0
		let p0 = ps[n-2]
		let p1 = ps[n-1]
		for (let i = 0; i < n; i++) {
			let p2 = ps[i]
			let [x1, y1, x2, y2] = offset_corner(p0, p1, p2, d)
			let [x0, y0] = p1
			let op1 = [x1, y1]
			op1.p = p1
			op1.d = d
			op1.ci = ci++
			ops.push(op1)
			if (x2 != null) {
				let op2 = [x2, y2]
				op2.p = p1
				op2.d = d
				op2.ci = ci++
				ops.push(op2)
			}
			p0 = p1
			p1 = p2
		}
	}
	return ops
}

// poly2 ---------------------------------------------------------------------

// closed polygon used for representing the base cycles of a planar graph.
// it must not be self-intersecting but it can have duplicate points i.e. coincident lines.
// it can have holes in the `holes` property.
// it works on 2D points but you can use `set_plane()` to set a plane
// and then access points in 3D with `get_point3()`.
// after changing the points you must call invalidate(). changing the plane
// doesn't require calling invalidate().

function zcross2(x0, y0, x1, y1, x2, y2) {
	let dx1 = x1 - x0
	let dy1 = y1 - y0
	let dx2 = x2 - x1
	let dy2 = y2 - y1
	return dx1 * dy2 - dy1 * dx2
}

let tri_out = []

let poly2_class = class poly2 extends Array {

	is_poly = true
	is_poly2 = true

	assign(v) {
		assert(v.is_poly2)
		let points = this.points
		assign(this, v)
		if (points) {
			if (v.points)
				assign(points, v.points)
			this.points = points
		}
		return this
	}

	set(v) {
		array_set(this, v)
		if (this.points && v.points)
			array_set(this.points, v.points)
		return this
	}

	to(v) {
		return v.set(this)
	}

	clone() {
		return new this.constructor().set(this)
	}

	point_count() { // stub: replace based on how the points are stored.
		return this.length
	}

	get_point(i, out) { // stub: replace based on how the points are stored.
		return out.from_v2_array(this.points, this[i])
	}

	point_count_without_holes() {
		return this.holes?.length ? this.holes[0] : this.point_count()
	}

	hole_count() { return this.holes?.length ?? 0 }
	hole_i1(i) { return this.holes[i] }
	hole_i2(i) { return this.holes[i+1] ?? this.length }

	s() {
		let a = []
		for (let i = 0, n = this.point_count(); i < n; i++) {
			let [x, y] = this.get_point(i, _v2_0)
			if (i) a.push(',')
			a.push(x, y)
		}
		return a
	}

	center() {
		let out = this._center
		if (!out) {
			out = v2()
			this._center = out
		}
		if (!this._center_valid) {
			let twicearea = 0
			let x = 0
			let y = 0
			let n = this.length
			if (n >= 3) {
				let [x0, y0] = this.get_point(n-2, _v2_0)
				let [x1, y1] = this.get_point(n-1, _v2_0)
				for (let i = 0; i < n; i++) {
					let [x2, y2] = this.get_point(i, _v2_0)

					let f = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
					twicearea += f
					x += (x1 + x2 - 2 * x0) * f
					y += (y1 + y2 - 2 * y0) * f

					x1 = x2
					y1 = y2
				}
				let f = twicearea * 3
				out[0] = x / f + x0
				out[1] = y / f + y0
			} else if (n == 2) {
				let [x0, y0] = this.get_point(0, _v2_0)
				let [x1, y1] = this.get_point(1, _v2_0)
				line2.at(.5, x0, y0, x1, y1, out)
			} else if (n == 1) {
				this.get_point(0, out)
			}
			this._center_valid = true
		}
		return out
	}

	area() {
		if (this._area == null) {
			let s = 0
			let n = this.length
			if (n >= 3) {
				let [x1, y1] = this.get_point(n-1, _v2_0)
				for (let i = 0; i < n; i++) {
					let [x2, y2] = this.get_point(i, _v2_0)

					s += (x1 * y2 * .5) - (x2 * y1 * .5)

					x1 = x2
					y1 = y2
				}
			}
			this._area = s
		}
		return this._area
	}

	bbox() {
		let bb = this._bbox
		if (!bb) {
			bb = bbox2()
			this._bbox = bb
		}
		if (!this._bbox_valid) {
			bb.reset()
			for (let p of this)
				bb.add_point(p[0], p[1])
			this._bbox_valid = true
		}
		return bb
	}

	hit(x, y) {
		let n = this.point_count()
		if (n < 3)
			return false
		let inside = false
		let [x1, y1] = this.get_point(n-1, _v2_0)
		for (let i = 0; i < n; i++) {
			let [x2, y2] = this.get_point(i, _v2_0)

			let intersect = ((y1 > y) != (y2 > y)) && (x < (x2 - x1) * (y - y1) / (y2 - y1) + x1)
			if (intersect)
				inside = !inside

			x1 = x2
			y1 = y2
		}
		return inside
	}

	contains_point(p) {
		return this.hit(p[0], p[1])
	}

	offset(d, out) {
		return poly_offset(this, d, out ?? poly2())
	}

	is_convex() {
		let n = this.point_count()
		if (n < 4)
			return true
		let sp = 0
		let sn = 0
		let [x0, y0] = this.get_point(n-2, _v2_0)
		let [x1, y1] = this.get_point(n-1, _v2_0)
		for (let i = 0; i < n; i++) {
			let [x2, y2] = this.get_point(i, _v2_0)

			let zcross = zcross2(x0, y0, x1, y1, x2, y2)
			sp += zcross >= 0 // using >= to include filaments
			sn += zcross <= 0 // using <= to include filaments

			x0 = x1
			y0 = y1
			x1 = x2
			y1 = y2
		}
		return sp == n || sn == n
	}

	is_convex_quad() {
		let [x0, y0] = this.get_point(0, _v2_0)
		let [x1, y1] = this.get_point(1, _v2_0)
		let [x2, y2] = this.get_point(2, _v2_0)
		let [x3, y3] = this.get_point(3, _v2_0)
		let s1 = sign(zcross2(x0, y0, x1, y1, x2, y2))
		let s2 = sign(zcross2(x1, y1, x2, y2, x3, y3))
		let s3 = sign(zcross2(x2, y2, x3, y3, x0, y0))
		let s4 = sign(zcross2(x3, y3, x0, y0, x1, y1))
		return abs(s1 + s2 + s3 + s4) == 4
	}

	triangle_count() {
		return this.point_count() - 2 + 2 * this.hole_count()
	}

	triangles() {
		let a = this._triangles
		if (!this._triangles_valid) {
			if (!a) {
				a = []
				this._triangles = a
			}
			let n = this.point_count()
			if (n == 3) { // triangle: nothing to do, push points directly.
				if (a.length != 3)
					a.length = 3
				a[0] = 0
				a[1] = 1
				a[2] = 2
			} else if (n == 4 && this.is_convex_quad()) { // convex quad: most common case.
				if (a.length != 6)
					a.length = 6
				// triangle 1
				a[0] = 2
				a[1] = 3
				a[2] = 0
				// triangle 2
				a[3] = 0
				a[4] = 1
				a[5] = 2
			} else {
				a.length = 0
				tri_out.length = n * 2
				for (let i = 0; i < n; i++) {
					let [x, y] = this.get_point(i, _v2_0)
					tri_out[2*i+0] = x
					tri_out[2*i+1] = y
				}
				earcut(tri_out, this.holes, 2, a)
				tri_out.length = 0
			}
			this._triangles_valid = true
		}
		return a
	}

	triangle2(ti, out) {
		assert(out.is_triangle2)
		let teis = this.triangles()
		this.get_point(teis[3*ti+0], out[0])
		this.get_point(teis[3*ti+1], out[1])
		this.get_point(teis[3*ti+2], out[2])
		return out
	}

	// (tex_uv) are 1 / (texture's (u, v) in world space).
	uv_at(i, uvm, tex_uv, out) {
		let p0 = this.get_point(0, _v2_0)
		let pi = this.get_point(i, _v2_1)
		pi.sub(p0).mul(tex_uv)
		if (uvm)
			pi.transform(uvm)
		out[0] = pi[0]
		out[1] = pi[1]
		return out
	}

	// with a plane, a poly2 can be used in 3D.

	set_plane(plane) { this._plane = plane }
	plane() { return this._plane }

	xyz_quat() { return this.plane().xyz_quat() }
	xy_quat() { return this.plane().xy_quat() }

	xy(p, out) {
		return this.plane().transform_xyz_xy(p[0], p[1], p[2], out ?? _v2_0)
	}

	xyz(p, out) {
		return this.plane().transform_xy_xyz(p[0], p[1], out ?? _v0)
	}

	get_point3(i, out) {
		let p = this.get_point(i, _v2_0)
		return this.plane().transform_xy_xyz(p[0], p[1], out)
	}

	triangle3(ti, out) {
		assert(out.is_triangle3)
		let teis = this.triangles()
		this.get_point3(teis[3*ti+0], out[0])
		this.get_point3(teis[3*ti+1], out[1])
		this.get_point3(teis[3*ti+2], out[2])
		return out
	}

	get_normal(i, out) { // stub: replace based on how normals are stored.
		return out.set(this.plane().normal)
	}

	/*
	clipper() {
		let cpr = this._clipper
		if (!this._clipper_valid) {
			if (!cpr) {
				cpr = new ClipperLib.Clipper()
				this._clipper = cpr
			}

			let p = []
			cpr._path = p
			for (let i = 0, n = this.point_count(); i < n; i++) {
				let [x, y] = this.get_point(i, _v2_0)
				p.push({X: x, Y: y})
			}

			this._clipper_valid = true
		}
		return cpr
	}
	*/
	/*
		function intersect
			cpr.AddPaths(subj_paths, ClipperLib.PolyType.ptSubject, true)  // true means closed path
			cpr.AddPaths(clip_paths, ClipperLib.PolyType.ptClip, true)

			let sol_paths = new ClipperLib.Paths()
			let ok = cpr.Execute(ClipperLib.ClipType.ctUnion, sol_paths,
				ClipperLib.PolyFillType.pftNonZero,
				ClipperLib.PolyFillType.pftNonZero
			)
	*/

	invalidate() {
		//this._clipper_valid = false
		this._triangles_valid = false
		this._area = null
		this._center_valid = false
		this._bbox_valid = false
		return this
	}

	is_cw() {
		let n = this.point_count_without_holes()
		if (n < 3)
			return
		let [x1, y1] = this.get_point(n-1, _v2_0)
		let s = 0
		for (let i = 0; i < n; i++) {
			let [x2, y2] = this.get_point(i, _v2_0)
			s += (x2-x1) * (y2+y1)
			x1 = x2
			y1 = y2
		}
		return s < 0
	}

}

function poly2(...args) { return new poly2_class(...args) }
poly2.class = poly2_class

let poly = poly2

// poly3 ---------------------------------------------------------------------

// a poly3 stores points in 3D. its plane can't be manually set but it's
// deduced from the points. points in 2D are calculated on access.

let poly2_invalidate = assert(poly2.class.prototype.invalidate)

let poly3_class = class poly3 extends poly2_class {

	is_poly2 = false
	is_poly3 = true

	get_point(i, out) {
		return this.plane().transform32(this.get_point3(i, _v0), out)
	}

	get_point3(i, out) { // stub: replace based on how the points are stored.
		return out.from_v3_array(this.points, this[i])
	}

	set_plane() { assert(false) }

	plane() {
		let p = this._plane
		if (!this._plane_valid) {
			if (!p) {
				p = plane()
				this._plane = p
			}
			p.set_from_poly3(this)
			this._plane_valid = true
		}
		return p
	}

	// TODO: move to poly2 and use accessors
	// from https://www.iquilezles.org/www/articles/normals/normals.htm
	compute_smooth_normals(normals, normalize) {

		let p1 = _v1
		let p2 = _v2
		let p3 = _v3

		let teis = this.triangles()
		let points = this.points
		for (let i = 0, n = teis.length; i < n; i += 3) {

			let p1i = this[teis[i+0]]
			let p2i = this[teis[i+1]]
			let p3i = this[teis[i+2]]

			p3.from_array(points, 3*p3i)
			p1.from_array(points, 3*p1i).sub(p3)
			p2.from_array(points, 3*p2i).sub(p3)

			let p = p1.cross(p2)

			normals[3*p1i+0] += p[0]
			normals[3*p1i+1] += p[1]
			normals[3*p1i+2] += p[2]

			normals[3*p2i+0] += p[0]
			normals[3*p2i+1] += p[1]
			normals[3*p2i+2] += p[2]

			normals[3*p3i+0] += p[0]
			normals[3*p3i+1] += p[1]
			normals[3*p3i+2] += p[2]
		}

		if (normalize)
			for (let i = 0, n = normals.length; i < n; i += 3) {
				p1.from_array(normals, i)
				p1.normalize()
				p1.to_array(normals, i)
			}

		return normals
	}

	center(out) {
		for (let i = 0, n = this.point_count(); i < n; i++)
			out.add(this.get_point(i, _v0))
		let len = this.length
		out.x /= len
		out.y /= len
		out.z /= len
		return out
	}

	invalidate() {
		this._plane_valid = false
		poly2_invalidate.call(this)
		return this
	}

}
inherit_properties(poly3_class)
let poly3 = callable_constructor(poly3_class)

// line2 ---------------------------------------------------------------------

let line2_class = class l extends Array {

	is_line2 = true

	constructor(p0, p1) {
		super(p0 ?? v2(), p1 ?? v2())
	}

	set(p0, p1) {
		if (p0.is_line2 || p0.is_line3) {
			let line = p0
			p0 = line[0]
			p1 = line[1]
		}
		this[0].set(p0)
		this[1].set(p1)
		return this
	}

	assign(v) {
		let p0 = this[0]
		let p1 = this[1]
		assign(this, v)
		this[0] = p0.assign(v[0])
		this[1] = p1.assign(v[1])
		return this
	}

	to(v) {
		return v.set(this)
	}

	clone() {
		return new line2().set(this[0], this[1])
	}

	equals(line) {
		return (
			line[0].equals(this[0]) &&
			line[1].equals(this[1])
		)
	}

	near(line) {
		return (
			line[0].near(this[0]) &&
			line[1].near(this[1])
		)
	}

	delta(out) {
		return v2.sub(this[1], this[0], out)
	}

	distance2() {
		return this[0].distance2(this[1])
	}

	distance() {
		return this[0].distance(this[1])
	}

	at(t, out) {
		let [x1, y1] = this[0]
		let [x2, y2] = this[1]
		return line2.at(t, x1, y1, x2, y2, out)
	}

	reverse() {
		let p0 = this[0]
		this[0] = this[1]
		this[1] = p0
		return this
	}

	len() {
		return this.delta(_v2_0).len()
	}

	set_len(len) {
		this[1].set(this.delta(_v2_0).set_len(len).add(this[0]))
		return this
	}

	to_array(a, i) {
		this[0].to_array(a, i)
		this[1].to_array(a, i+2)
		return a
	}

	to_line2_array(a, i) {
		this[0].to_v2_array(a, 2 * i)
		this[1].to_v2_array(a, 2 * i + 1)
		return a
	}

	from_array(a, i) {
		this[0].from_array(a, i)
		this[1].from_array(a, i+2)
		return this
	}

	from_line2_array(a, i) {
		this[0].from_v2_array(a, 2 * i)
		this[1].from_v2_array(a, 2 * i + 1)
		return this
	}

	s() {
		return [...this[0].s(), '-', ...this[1].s()]
	}

	project_point_t(C, clamp_to_line) {
		let [A, B] = this
		return line2.project_point_t(C[0], C[1], A[0], A[1], B[0], B[1], clamp_to_line)
	}

	project_point(p, clamp_to_line, out) {
		let [A, B] = this
		let [Dx, Dy] = line2.project_point(p[0], p[1], A[0], A[1], B[0], B[1], clamp_to_line)
		out[0] = Dx
		out[1] = Dy
		return out
	}

	transform(m, out) {
		out ??= this
		this[0].transform(m, out[0])
		this[1].transform(m, out[1])
		return out
	}

	intersect_line(other) {
		let [p1, p2] = this
		let [p3, p4] = other
		let [x1, y1] = p1
		let [x2, y2] = p2
		let [x3, y3] = p3
		let [x4, y4] = p4
		return line2.intersect_line(x1, y1, x2, y2, x3, y3, x4, y4)
	}

	intersects_line(other) {
		return line2.intersects_line(this, other)
	}

	offset(d, out) {
		let [p1, p2] = this
		let [x1, y1] = p1
		let [x2, y2] = p2
		let [x3, y3, x4, y4] = line2.offset(d, x1, y1, x2, y2)
		out[0][0] = x3
		out[0][1] = y3
		out[1][0] = x4
		out[1][1] = y4
		return out
	}

	// intersect the line with a polygon and return a flattened array of segments
	// of form [s1_t1, s1_t2, ...] where the values are time values on the line.
	// use line.at() to get the actual points. if `only` is given, only the
	// segments which are found to be inside or outside the polygon are returned.
	split_by_poly(poly, only, out) {
		let [x3, y3] = this[0]
		let [x4, y4] = this[1]

		out.push(0)

		let n = poly.point_count()
		let [x1, y1] = poly.get_point(n-1, _v2_0)
		for (let i = 0; i < n; i++) {
			let [x2, y2] = poly.get_point(i, _v2_0)

			let [t1, t2] = line2.intersect_line(x3, y3, x4, y4, x1, y1, x2, y2)

			// pr(i, x3, y3, '-', x4, y4, 'X', x1, y1, '-', x2, y2, t1, t2)

			if (t1 != t1) { // coincidental, see if they touch
				let t1_1 = line2.project_point_t(x1, y1, x3, y3, x4, y4)
				let t1_2 = line2.project_point_t(x2, y2, x3, y3, x4, y4)
				let p1_outside = t1_1 < 0 || t1_1 > 1
				let p2_outside = t1_2 < 0 || t1_2 > 1
				if (p1_outside && p2_outside) {
					// coincidental but don't touch: ignore
				} else {
					// coincidental: TODO
				}
			} else {

				if (t2 > 0 && t2 < 1) { // cutting
					if (t1 > 0 && t1 < 1) { // cutting
						out.push(t1)
						out.push(t1)
					}
				}

			}

			x1 = x2
			y1 = y2
		}

		out.push(1)

		out.sort((a, b) => a - b)

		if (only) {
			let mid_t = (out[1] + out[0]) / 2
			let [xm, ym] = line2.at(mid_t, x3, y3, x4, y4, _v2_0)
			// pr(mid_t, xm, ym, x3, y3, x4, y4)
			let starts_inside = poly.hit(xm, ym)
			// pr(...poly.s(), clone(out), mid_t, '', x3, y3, x4, y4, '', xm, ym, starts_inside)
			let keep_inside = only == 'inside'
			let remove_bit = (starts_inside == keep_inside) << 1
			remove_values(out, (v, i) => (i & 2) == remove_bit)
			out.starts_inside = starts_inside
		}

		return out
	}

}

let line2 = function(p1, p2) { return new line2_class(p1, p2) }
line2.class = line2_class

// evaluate a line at time t using linear interpolation.
// the time between 0..1 covers the segment interval.
line2.at = function line2_at(t, x1, y1, x2, y2, out) {
	out[0] = x1 + t * (x2 - x1)
	out[1] = y1 + t * (y2 - y1)
	return out
}

// A---D--------B
//     |
//     C
line2.project_point_t = function line2_project_point_t(Cx, Cy, Ax, Ay, Bx, By, clamp_to_line) {
	// AB = B - A
	// AC = C - A
	// AD_t = (AB . AC) / (AB . AB)
	let ABx = Bx - Ax
	let ABy = By - Ay
	let ACx = Cx - Ax
	let ACy = Cy - Ay
	let t = (ABx * ACx + ABy * ACy) / (ABx * ABx + ABy * ABy)
	if (clamp_to_line)
		t = clamp(t, 0, 1)
	return t
}

line2.project_point = function line2_project_point(Cx, Cy, Ax, Ay, Bx, By, clamp_to_line) {
	// AD = AB * AD_t
	// D = A + AD
	let t = line2.project_point_t(Cx, Cy, Ax, Ay, Bx, By, clamp_to_line)
	let ABx = Bx - Ax
	let ABy = By - Ay
	let Dx = Ax + ABx * t
	let Dy = Ay + ABy * t
	out.length = 2
	out[0] = Dx
	out[1] = Dy
	return out
}

// intersect line segment (x1, y1, x2, y2) with line segment (x3, y3, x4, y4).
// returns the times on the first line and second line where the intersection occurs.
// if the intersection occurs outside the segments themselves, then t is
// outside the 0..1 range. if the lines are parallel then t is +/-inf.
// if they are coincidental, t is NaN.
line2.intersect_line = function line2_intersect_line(x1, y1, x2, y2, x3, y3, x4, y4) {
	let d = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1)
	out.length = 2
	out[0] = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / d
	out[1] = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / d
	return out
}

line2.intersects_line = function line2_intersects_line(l1, l2) {
	let [x1, y1] = l1[0]
	let [x2, y2] = l1[1]
	let [x3, y3] = l2[0]
	let [x4, y4] = l2[1]
	let [t1, t2] = line2.intersect_line(x1, y1, x2, y2, x3, y3, x4, y4)
	return t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1
}

// parallel line segment at a distance on the right side of a segment.
// use a negative distance for the left side, or reflect the returned points
// against their respective initial points.
line2.offset = function line2_offset(d, x1, y1, x2, y2) {
	// normal vector of the same length as original segment.
	let dx = -(y2-y1)
	let dy =   x2-x1
	if (dx == 0 && dy != 0) {
		dy = d * sign(dy)
	} else if (dy == 0 && dx != 0) {
		dx = d * sign(dx)
	} else {
		let k = d / distance(x1, y1, x2, y2) // normal vector scale factor
		dx *= k
		dy *= k
	}
	// normal vector scaled and translated to (x1,y1) and (x2,y2)
	out.length = 4
	out[0] = x1 + dx
	out[1] = y1 + dy
	out[2] = x2 + dx
	out[3] = y2 + dy
	return out
}

line2.x_intercept = function(x1, y1, x2, y2) {
	return (x1 - (x2 - x1) * y1) / (y2 - y1)
}

// line3 ---------------------------------------------------------------------

let line3_class = class l extends Array {

	is_line3 = true

	constructor(p0, p1) {
		super(p0 ?? v3(), p1 ?? v3())
	}

	set(p0, p1) {
		if (p0.is_line3) {
			let line = p0
			p0 = line[0]
			p1 = line[1]
		}
		this[0].set(p0)
		this[1].set(p1)
		return this
	}

	assign(v) {
		let p0 = this[0]
		let p1 = this[1]
		assign(this, v)
		this[0] = p0.assign(v[0])
		this[1] = p1.assign(v[1])
		return this
	}

	to(v) {
		return v.set(this)
	}

	clone() {
		return new line3().set(this[0], this[1])
	}

	equals(line) {
		return (
			line[0].equals(this[0]) &&
			line[1].equals(this[1])
		)
	}

	delta(out) {
		return v3.sub(this[1], this[0], out)
	}

	distance2() {
		return this[0].distance2(this[1])
	}

	distance() {
		return this[0].distance(this[1])
	}

	at(t, out) {
		return this.delta(out).muls(t).add(this[0])
	}

	reverse() {
		let p0 = this[0]
		this[0] = this[1]
		this[1] = p0
		return this
	}

	len() {
		return this.delta(_v0).len()
	}

	set_len(len) {
		this[1].set(this.delta(_v0).set_len(len).add(this[0]))
		return this
	}

	to_array(a, i) {
		this[0].to_array(a, i)
		this[1].to_array(a, i+3)
		return a
	}

	to_line3_array(a, i) {
		this[0].to_v3_array(a, 2 * i)
		this[1].to_v3_array(a, 2 * i + 1)
		return a
	}

	from_array(a, i) {
		this[0].from_array(a, i)
		this[1].from_array(a, i+3)
		return this
	}

	from_line3_array(a, i) {
		this[0].from_v3_array(a, 2 * i)
		this[1].from_v3_array(a, 2 * i + 1)
		return this
	}

	s() {
		return [...this[0].s(), '-', ...this[1].s()]
	}

	project_point_t(p, clamp_to_line) {
		let p0 = v3.sub(p, this[0], _v0)
		let p1 = v3.sub(this[1], this[0], _v1)
		let t = p1.dot(p0) / p1.dot(p1)
		if (clamp_to_line)
			t = clamp(t, 0, 1)
		return t
	}

	project_point(p, clamp_to_line, out) {
		out.t = this.project_point_t(p, clamp_to_line)
		return this.delta(out).muls(out.t).add(this[0])
	}

	transform(m, out) {
		out ??= this
		this[0].transform(m, out[0])
		this[1].transform(m, out[1])
		return out
	}

	// returns the smallest line that connects two (coplanar or skewed) lines.
	// returns null for parallel lines.
	intersect_line(lq, out, mode) {
		let lp = this
		let rp = out[0]
		let rq = out[1]
		let p = lp[0]
		let q = lq[0]
		let mp = lp.delta(_v0)
		let mq = lq.delta(_v1)
		let qp = _v2.set(p).sub(q)

		let qp_mp = qp.dot(mp)
		let qp_mq = qp.dot(mq)
		let mp_mp = mp.dot(mp)
		let mq_mq = mq.dot(mq)
		let mp_mq = mp.dot(mq)

		let detp = qp_mp * mq_mq - qp_mq * mp_mq
		let detq = qp_mp * mp_mq - qp_mq * mp_mp
		let detm = mp_mq * mp_mq - mq_mq * mp_mp

		if (detm == 0) // lines are parallel
			return

		rp.set(p).add(mp.muls(detp / detm))
		rq.set(q).add(mq.muls(detq / detm))

		if (mode == 't' || mode == 'clamp') {
			let p1 = _v0.set(lp[1]).sub(lp[0])
			let p2 = _v1.set(rp).sub(lp[0])
			let tp = p2.len() / p1.len() * (p1.dot(p2) > 0 ? 1 : -1)
			p1.set(lq[1]).sub(lq[0])
			p2.set(rq).sub(lq[0])
			let tq = p2.len() / p1.len() * (p1.dot(p2) > 0 ? 1 : -1)
			rp.t = tp
			rq.t = tq
			if (mode == 'clamp') {
				if (tp < 0)
					rp.set(lp[0])
				else if (tp > 1)
					rp.set(lp[1])
				if (tq < 0)
					rq.set(lq[0])
				else if (tq > 1)
					rq.set(lq[1])
			}
		}

		return out
	}

	intersect_plane(plane, out, mode) {
		return plane.intersect_line(this, out, mode)
	}

	intersects_plane(plane) {
		return plane.intersects_line(this)
	}

}

let line3 = function(p1, p2) { return new line3_class(p1, p2) }

// bbox2 ---------------------------------------------------------------------

let bbox2_class = class bb2 extends Array {

	is_bbox2 = true

	constructor(x1, y1, x2, y2) {
		super(
			x1 ?? inf,
			y1 ?? inf,
			x2 ?? -inf,
			y2 ?? -inf
		)
	}

	reset() {
		this[0] =  inf
		this[1] =  inf
		this[2] = -inf
		this[3] = -inf
		return this
	}

	add_bbox2(x1, y1, x2, y2) {
		this[0] = min(this[0], x1, x2)
		this[1] = min(this[1], y1, y2)
		this[2] = max(this[2], x1, x2)
		this[3] = max(this[3], y1, y2)
		return this
	}

	add_point(x, y) {
		this[0] = min(this[0], x)
		this[1] = min(this[1], y)
		this[2] = max(this[2], x)
		this[3] = max(this[3], y)
		return this
	}

	add_points(ps) {
		for (let [x, y] of ps)
			this.add_point(x, y)
		return this
	}

	add(x, y) {
		if (isnum(x))
			return this.add_point(x, y)
		else if (x.is_v2 || x.is_v3 || x.is_v4)
			return this.add_point(x[0], x[1])
		else if (x.is_bbox2)
			return this.add_bbox2(x[0], x[1], x[2], x[3])
		else if (isarray(x))
			return this.add_points(x)
		else
			assert(false)
	}

	rotate(a) {
		if (!a)
			return this
		let [x1, y1, x2, y2] = this
		let cx = (x2 + x1) / 2
		let cy = (y2 + y1) / 2
		let [p1x, p1y] = rotate_point(x1, y1, cx, cy, a)
		let [p2x, p2y] = rotate_point(x1, y2, cx, cy, a)
		let [p3x, p3y] = rotate_point(x2, y1, cx, cy, a)
		let [p4x, p4y] = rotate_point(x2, y2, cx, cy, a)
		this.reset()
		this.add_point(p1x, p1y)
		this.add_point(p2x, p2y)
		this.add_point(p3x, p3y)
		this.add_point(p4x, p4y)
		return this
	}

	inside_bbox2(px1, py1, px2, py2) {
		let [cx1, cy1, cx2, cy2] = this
		return cx1 >= px1 && cx2 <= px2 && cy1 >= py1 && cy2 <= py2
	}

	hit(x, y) {
		let [x1, y1, x2, y2] = this
		return x >= x1 && x <= x2 && y >= y1 && y <= y2
	}

	contains_point(p) {
		return this.hit(p[0], p[1])
	}

}

function bbox2(x1, y1, x2, y2) { return new bbox2_class(x1, y1, x2, y2) }

// box3 ----------------------------------------------------------------------

v3.inf = v3(inf, inf, inf)
v3.minus_inf = v3(-inf, -inf, -inf)

let box3_class = class bb3 extends Array {

	is_box3 = true

	get min() { return this[0] }; set min(v) { this[0] = v }
	get max() { return this[1] }; set max(v) { this[1] = v }

	constructor(min, max) {
		super(
			min ?? v3.inf.clone(),
			max ?? v3.minus_inf.clone()
		)
	}

	set(min, max) {
		if (min.is_box3) {
			let b = min
			min = b[0]
			max = b[1]
		}
		this[0].set(min)
		this[1].set(max)
		return this
	}

	assign(v) {
		let min = this[0]
		let max = this[1]
		assign(this, v)
		this[0] = min.assign(v[0])
		this[1] = max.assign(v[1])
		return this
	}

	to(v) {
		return v.set(this)
	}

	clone() {
		return new box3().set(this)
	}

	equals(b) {
		return (
			this[0].equals(b[0]) &&
			this[1].equals(b[1])
		)
	}

	reset() {
		this[0].set(v3.inf)
		this[1].set(v3.minus_inf)
		return this
	}

	to_array(a, i) {
		this[0].to_array(a, i)
		this[1].to_array(a, i+3)
		return a
	}

	to_box3_array(a, i) {
		this[0].to_v3_array(a, 2 * i)
		this[1].to_v3_array(a, 2 * i + 1)
		return a
	}

	from_array(a, i) {
		this[0].from_array(a, i)
		this[1].from_array(a, i+3)
		return this
	}

	from_box3_array(a, i) {
		this[0].from_v3_array(a, 2 * i)
		this[1].from_v3_array(a, 2 * i + 1)
		return this
	}


	is_empty() {
		return (
			this[1][0] < this[0][0] ||
			this[1][1] < this[0][1] ||
			this[1][2] < this[0][2]
		)
	}

	add(v) {
		if (v.is_v3) {
			this[0].min(v)
			this[1].max(v)
		} else if (v.is_line3 || v.is_box3) {
			this[0].min(v[0]).min(v[1])
			this[1].max(v[0]).max(v[1])
		} else if (v.is_poly3) {
			for (let i = 0, n = v.point_count(); i < n; i++) {
				let p = v.get_point3(i, _v0)
				this[0].min(p)
				this[1].max(p)
			}
		} else {
			assert(false)
		}
		return this
	}

	center(out) {
		return out.set(this[0]).add(this[1]).muls(.5)
	}

	delta(out) {
		return v3.sub(this[1], this[0], out)
	}

	contains_point(p) {
		return !(
			p[0] < this[0][0] || p[0] > this[1][0] ||
			p[1] < this[0][1] || p[1] > this[1][1] ||
			p[2] < this[0][2] || p[2] > this[1][2]
		)
	}

	contains_box(b) {
		return (
			this[0][0] <= b[0][0] && b[1][0] <= this[1][0] &&
			this[0][1] <= b[0][1] && b[1][1] <= this[1][1] &&
			this[0][2] <= b[0][2] && b[1][2] <= this[1][2]
		)
	}

	intersects_box(b) {
		// using 6 splitting planes to rule out intersections.
		return !(
			b[1][0] < this[0][0] || b[0][0] > this[1][0] ||
			b[1][1] < this[0][1] || b[0][1] > this[1][1] ||
			b[1][2] < this[0][2] || b[0][2] > this[1][2]
		)
	}

	transform(m) {
		if (this.is_empty())
			return this
		let v0 = this[0].to(_v0)
		let v1 = this[1].to(_v1)
		this.reset()
		this.add(_v2.set(v0[0], v0[1], v0[2]).transform(m))
		this.add(_v2.set(v0[0], v0[1], v1[2]).transform(m))
		this.add(_v2.set(v0[0], v1[1], v0[2]).transform(m))
		this.add(_v2.set(v0[0], v1[1], v1[2]).transform(m))
		this.add(_v2.set(v1[0], v0[1], v0[2]).transform(m))
		this.add(_v2.set(v1[0], v0[1], v1[2]).transform(m))
		this.add(_v2.set(v1[0], v1[1], v0[2]).transform(m))
		this.add(_v2.set(v1[0], v1[1], v1[2]).transform(m))
		return this
	}

	translate(v) {
		this[0].add(v)
		this[1].add(v)
		return this
	}

}

let box3 = function(x1, y1, x2, y2) { return new box3_class(x1, y1, x2, y2) }
let box = box3

// templates for parametric modeling -----------------------------------------

box3.points = new f32arr([
	-.5,  -.5,  -.5,
	 .5,  -.5,  -.5,
	 .5,   .5,  -.5,
	-.5,   .5,  -.5,
	-.5,  -.5,   .5,
	 .5,  -.5,   .5,
	 .5,   .5,   .5,
	-.5,   .5,   .5,
])

box3.line_pis = new u8arr([
	0, 1,  1, 2,  2, 3,  3, 0,
	4, 5,  5, 6,  6, 7,  7, 4,
	0, 4,  1, 5,  2, 6,  3, 7,
])

{
let _l0 = line3()
box3.each_line = function(f) {
	for (let i = 0, n = box3.line_pis.length; i < n; i += 2) {
		_l0[0][0] = box3.points[3*box3.line_pis[i+0]+0]
		_l0[0][1] = box3.points[3*box3.line_pis[i+0]+1]
		_l0[0][2] = box3.points[3*box3.line_pis[i+0]+2]
		_l0[1][0] = box3.points[3*box3.line_pis[i+1]+0]
		_l0[1][1] = box3.points[3*box3.line_pis[i+1]+1]
		_l0[1][2] = box3.points[3*box3.line_pis[i+1]+2]
		f(_l0)
	}
}}

box3.triangle_pis_front = new u8arr([
	3, 2, 1,  1, 0, 3,
	6, 7, 4,  4, 5, 6,
	2, 3, 7,  7, 6, 2,
	1, 5, 4,  4, 0, 1,
	7, 3, 0,  0, 4, 7,
	2, 6, 5,  5, 1, 2,
])

box3.triangle_pis_back = new u8arr(box3.triangle_pis_front)
for (let i = 0, a = box3.triangle_pis_back, n = a.length; i < n; i += 3) {
	let t = a[i]
	a[i] = a[i+1]
	a[i+1] = t
}

box3.triangle_pis_front.max_index = 7
box3.triangle_pis_back .max_index = 7

// camera --------------------------------------------------------------------

let camera; {
let _v4_0 = v4()
camera = function(e) {
	e = e ?? {}

	e.pos  = e.pos ?? v3(-500, 1000, 1000) // v3(-1, 5, 10)
	e.dir  = e.dir ?? v3(-.5, .5, .5) // v3(-.5, .5, 1)
	e.up   = e.up  ?? v3(0, 1, 0)

	e.fov  = e.fov  ?? 60
	e.near = e.near ?? 0.01

	e.proj = mat4()
	e.view = mat4()
	e.inv_proj = mat4()
	e.inv_view = mat4()
	e.view_proj = mat4()

	e.view_size = e.view_size ?? v2()

	e.set = function(c) {
		e.pos.set(c.pos)
		e.dir.set(c.dir)
		e.up.set(c.up)
		e.fov = c.fov
		e.near = c.near
		e.far = c.far
		e.proj.set(c.proj)
		e.view.set(c.view)
		e.inv_proj.set(c.inv_proj)
		e.inv_view.set(c.inv_view)
		e.view_proj.set(c.view_proj)
		return e
	}

	e.to = function(v) {
		return v.set(this)
	}

	e.clone = function() {
		return camera().set(e)
	}

	e.perspective = function() {
		let aspect = e.view_size[0] / e.view_size[1]
		e.proj.perspective(rad * e.fov, aspect, e.near, e.far)
		return this
	}

	e.ortho = function(left, right, bottom, top, near, far) {
		e.proj.ortho(left, right, bottom, top, near, far)
		return this
	}

	e.dolly = function(target, t) {
		let d = e.pos.clone().sub(target)
		let len = d.len() * t
		if (abs(len) < NEAR) {
			e.pos.set(target)
		} else {
			if (len < 0)
				d.set_len(-len).negate()
			else
				d.set_len(len)
			e.pos.set(target).add(d)
		}
		return this
	}

	e.orbit = function(target, ax, ay, az) {
		let vdir = _v0.set(e.world_to_view(e.pos.clone().add(e.dir), _v4_0))
		vdir.rotate(v3.x_axis, -ax)
		vdir.rotate(v3.y_axis, -ay)
		vdir.rotate(v3.z_axis, -az)
		let dir = e.view_to_world(vdir, _v2).sub(e.pos)
		e.dir.set(dir)
		let vtarget = e.world_to_view(target, _v4_0)
		let vpos = _v3.set(vtarget).negate()
		vpos.rotate(v3.x_axis, -ax)
		vpos.rotate(v3.y_axis, -ay)
		vpos.rotate(v3.z_axis, -az)
		vpos.add(vtarget)
		let pos = e.view_to_world(vpos, _v4)
		e.pos.set(pos)
		return this
	}

	e.pan = function(target, x0, y0, x1, y1) {
		let q = e.screen_to_view(x0, y0, 1, v4())
		let t = e.screen_to_view(x1, y1, 1, v4()).sub(q)
		let p = e.world_to_view(target, v4())
		let s = t.muls(p.len() / q.len()).negate().transform(e.inv_view)
		e.pos.add(s)
		return this
	}

	e.update = function() {
		e.inv_proj.set(e.proj).invert()
		e.inv_view.reset().translate(e.pos).look_at(e.dir, e.up)
		e.view.set(e.inv_view).invert()
		mat4.mul(e.proj, e.view, e.view_proj)
		return this
	}

	// space conversions from https://antongerdelan.net/opengl/raycasting.html

	e.world_to_view = function(p, out) {
		assert(out.is_v4)
		return out.set(p).transform(e.view)
	}

	e.view_to_clip = function(p, out) {
		assert(out.is_v4)
		return out.set(p).transform(e.proj)
	}

	e.world_to_clip = function(p, out) {
		assert(out.is_v4)
		return out.set(p).transform(e.view_proj)
	}

	e.clip_to_screen = function(p, out) {
		assert(out.is_v2 || out.is_v3)
		let w = p[3]
		out[0] = round(( (p[0] / w) + 1) * e.view_size[0] / 2)
		out[1] = round((-(p[1] / w) + 1) * e.view_size[1] / 2)
		if (out.is_v3)
			out[2] = 0
		return out
	}

	e.world_to_screen = function(p, out) {
		let cp = e.world_to_clip(p, _v4_0)
		return e.clip_to_screen(cp, out)
	}

	// (0..w, 0..h, z) -> (-1..1, -1..1, z)
	e.screen_to_clip = function(x, y, z, out) {
		let w = e.view_size[0]
		let h = e.view_size[1]
		assert(out.is_v4)
		out[0] = (2 * x) / w - 1
		out[1] = 1 - (2 * y) / h
		out[2] = z ?? 1
		out[3] = 1
		return out
	}

	// (-1..1, -1..1, 1..-1, 1) -> frustum space (z in 0..100, for a 0.01..inf frustrum)
	e.clip_to_view = function(p, out) {
		assert(out.is_v4)
		return out.set(p).transform(e.inv_proj)
	}

	e.view_to_world = function(p, out) {
		assert(out.is_v3)
		return out.set(_v4_0.set(p).transform(e.inv_view))
	}

	// z_clip is 1..-1 (near..far planes)
	e.screen_to_view = function(x, y, z_clip, out) {
		assert(out.is_v4)
		return e.screen_to_clip(x, y, z_clip ?? 1, out).transform(e.inv_proj)
	}

	e.clip_to_world = function(p, out) {
		assert(out.is_v3)
		return out.set(e.clip_to_view(p, _v4_0).transform(e.inv_view))
	}

	// the point on the near plane that is under (mx, my).
	e.screen_to_world = function(mx, my, out) {
		assert(out.is_v3)
		let p = e.screen_to_clip(mx, my, -1, _v4_0)
			.transform(e.inv_proj).transform(e.inv_view)
		return out.set(p).divs(p[3])
	}

	// return a line of unit length from camera position pointing towards (mx, my).
	// the line can be directly intersected with a plane, and its delta() is
	// the ray's direction vector.
	e.raycast = function(mx, my, out) {
		let ray = e.screen_to_world(mx, my, _v0).sub(e.pos).normalize()
		assert(out.is_line3)
		out[0].set(e.pos)
		out[1].set(e.pos).add(ray)
		return out
	}

	{
	let _v2_0 = v2()
	let _v2_1 = v2()
	e.screen_distance2 = function(p1, p2) {
		let p = e.world_to_screen(p1, _v2_0)
		let q = e.world_to_screen(p2, _v2_1)
		return p.distance2(q)
	}}

	e.screen_distance = function(p1, p2) {
		return sqrt(e.screen_distance2(p1, p2))
	}

	return e
}}

let camera3 = camera // so you can do `let camera = camera3()`.

// publishing ----------------------------------------------------------------

let Math3D = {
	NEAR, FAR, near, near_angle,
	v2, v3, v4,
	mat3, mat3f32,
	mat4, mat4f32,
	quat, quat3,
	plane, plane3,
	triangle2, triangle3,
	poly, poly2, poly3,
	line2, line3,
	bbox2, box, box3,
	camera, camera3,
}
G.Math3D = Math3D

let script_attr = k => document.currentScript.hasAttribute(k)
if (script_attr('global') || script_attr('3d-global')) {
	for (let k in Math3D) {
		assert(!(k in G), k, ' global already exists')
		G[k] = Math3D[k]
	}
}

}()) // module scope.
