/*

	Math for undirected planar graphs.
	Written by Cosmin Apreutesei. Public Domain.

	plane_graph() -> pg

		orthogonal <- t|f

		ps -> [p1, ...]                   points
		segs -> [[s1p1, s1p2], ...]       segments
		comps -> [comp1,...]              all graph components in no order
		[comp1,...]                       root graph components i.e. root islands

		comp: {}
			.ps -> [p1, ...]
			.segs -> [seg1, ...]
			.cycles -> [cycle1, ...]
			.outer_cycle -> cycle
			.islands -> [comp1, ...]

		cycle: poly2[p1, ...]
			.islands -> [comp1, ...]
			.outer -> t|f
			.comp -> comp

		free()

		clear()

		add_point(x, y, [id])
		rem_point(p)
		rem_points(cond, [msg])

		add_seg(p1, p2, [id])
		rem_seg(seg)
		rem_segs(cond, [msg])
		set_seg_point(seg, i, p) -> old_p

		add(pg)
		set(pg)

		load([json_point1,...], [json_seg_run1,...])

			json_point formats:

				[x,y[,id]]
				{x:, y:, id: id}

			json_seg_run formats:

				['draw', [id, ]x0, y0, [id, ]d-to-right, [id, ]d-to-down, [id, ]d-to-right, ...]
				['connect', p1, p2, ...]
				[seg_id, p1, p2, ...] // use null for an automatic ID

		rebuild()
		fix()

		hit_cycle(x, y, cycle) -> t|f
		hit_cycles(x, y) -> cycle|null

		next_adj(p0, p, clockwise, [max_angle]) -> p1

*/

(function() {
"use strict"
const G = window

const {
	inf,
	mod,
	abs, min, max,
	isarray, isobj, isnum, isstr,
	assert, check,
	log, push_log, pop_log, gen_id,
	remove_value, replace_value, remove_values,
	words, map, set, set_toarray,
	freelist,
} = glue

const {
	v2,
	line2,
	poly,
	bbox2,
	near_angle,
} = Math3D

const v2_near = v2.near

// plane graph segment class -------------------------------------------------

let seg2_class = class s extends Array {

	is_seg2 = true

	constructor(...args) {
		super(...args)
		this.set(...args)
	}

	set(a1, a2) {
		if (a1) {
			if (a1.is_seg2) {
				this[0] = a1[0]
				this[1] = a1[1]
			} else {
				assert(isarray(a1))
				assert(isarray(a2))
				this[0] = a1
				this[1] = a2
			}
		} else {
			this[0] = null
			this[1] = null
		}
	}

	clone() {
		return new seg2_class([...this[0]], [...this[1]])
	}

	get x1() { return min(this[0][0], this[1][0]) }
	get y1() { return min(this[0][1], this[1][1]) }
	get x2() { return max(this[0][0], this[1][0]) }
	get y2() { return max(this[0][1], this[1][1]) }

	set x1(x) { let x1i = this[0][0] < this[1][0] ? 0 : 1; this[x1i][0] = x }
	set y1(y) { let y1i = this[0][1] < this[1][1] ? 0 : 1; this[y1i][1] = y }
	set x2(x) { let x2i = this[0][0] < this[1][0] ? 1 : 0; this[x2i][0] = x }
	set y2(y) { let y2i = this[0][1] < this[1][1] ? 1 : 0; this[y2i][1] = y }

	pi(p) {
		assert(this[0] == p || this[1] == p)
		return this[0] == p ? 0 : 1
	}

	// orthogonal segs

	get is_v() { return this[0][0] == this[1][0] }
	get m1  () { return this.is_v ? this.y1 : this.x1 }
	get m2  () { return this.is_v ? this.y2 : this.x2 }
	get axis() { return this.is_v ? this.x1 : this.y1 }
	set m1  (m) { if (this.is_v) this.y1 = m; else this.x1 = m }
	set m2  (m) { if (this.is_v) this.y2 = m; else this.x2 = m }
	set axis(a) {
		if (this.is_v) {
			this[0][0] = a
			this[1][0] = a
		} else {
			this[0][1] = a
			this[1][1] = a
		}
	}

	get i1() { let mi = this.is_v ? 1 : 0; return this[0][mi] < this[1][mi] ? 0 : 1 }
	get i2() { let mi = this.is_v ? 1 : 0; return this[0][mi] < this[1][mi] ? 1 : 0 }

	get p1() { return this[this.i1] }
	get p2() { return this[this.i2] }

}

function seg2(...args) { return new seg2_class(...args) }
seg2.class = seg2_class

// cycle base extaction algorihm ---------------------------------------------
//
// - input: single component of a simple undirected plane graph. no zero-length
// segments, overlapping or intersecting segments allowed. all points and segments
// must be connected.
// - points can be end-points (#adj=1), joints (#adj=2) or branch points (#adj > 2).
// - output: all minimal base cycles (i.e. cycle base) with filaments included.
//
// Paper : https://www.geometrictools.com/Documentation/MinimalCycleBasis.pdf
// Code  : https://github.com/vbichkovsky/min-cycles/blob/master/src/cycles.js
//

function rem_edge(p1, p2, ps) {
	remove_value(p1.adj, p2)
	remove_value(p2.adj, p1)
	if (p1.adj.length == 0) remove_value(ps, p1)
	if (p2.adj.length == 0) remove_value(ps, p2)
}

function rem_filament(p, ps) {
	while (p && p.adj.length < 2) {
		remove_value(ps, p)
		let pa = p.adj[0]
		if (pa)
			rem_edge(p, pa, ps)
		p = pa
	}
}

function left_bottom_point(ps) {
	return ps.reduce((p0, p1) => {
		let x1 = p1[0]
		let x0 = p0[0]
		if (x1 < x0) return p1
		if (x0 < x1) return p0
		let y1 = p1[1]
		let y0 = p0[1]
		if (y1 > y0) return p1
		return p0
	})
}

// return a number from the range [0..4) which is monotonically increasing
// with the clockwise angle that the input vector makes against the x axis.
// Useful when the actual angle is not needed eg. when comparing angles
// or for finding the quadrant of an angle.
// NOTE: One branch miss (20cy) + one division (4cy) is still faster than atan2 (100cy).
// Then again, one cache miss is 100cy so this does not have a big impact.
function pseudo_angle(dx, dy) {
	let p = dx / (abs(dx) + abs(dy))  // -1..0 (x <= 0) or 0..1 (x >= 0)
	return dy < 0 ? 3 + p : 1 - p     //  2..4 (y <= 0) or 0..2 (y >= 0)
}

// return the angle sweep from angle a1 to a2 in cw (+) or ccw (-) dir.
function angle_sweep(a1, a2, clockwise, circle_sweep) {
	circle_sweep ??= 4
	let d = a2 - a1
	if (d < 0 && clockwise)
		d += circle_sweep
	else if (d > 0 && !clockwise)
		d -= circle_sweep
	return d
}

function points_colinear(p0, p1, p2) {
	return near_angle(
		pseudo_angle(p1[0] - p0[0], p1[1] - p0[1]),
		pseudo_angle(p2[0] - p1[0], p2[1] - p1[1])
	)
}

// return p1 from p.adj where the angle at p on (p0,p,p1) is smallest in cw or ccw direction.
function next_adj(p0, p, clockwise, max_a) {
	max_a ??= inf
	if (p.adj.length == 1 && max_a >= 2) // end-point, go back (or forward if first)
		return p.adj[0]
	let x0 = p0 ? p0[0] - p[0] : 0
	let y0 = p0 ? p0[1] - p[1] : 1
	let a0 = pseudo_angle(x0, y0)
	let min_a = inf // min angle
	let min_p // point with min angle to (p0,p)
	for (let p1 of p.adj) {
		if (p1 == p0)
			continue
		let x1 = p1[0] - p[0]
		let y1 = p1[1] - p[1]
		let a1 = pseudo_angle(x1, y1)
		let a = abs(angle_sweep(a1, a0, clockwise))
		if (a < min_a && a <= max_a) {
			min_a = a
			min_p = p1
		}
	}
	return min_p
}

function poly_get_point(i, out) {
	out[0] = this[i][0]
	out[1] = this[i][1]
	return out
}

let cycle_freelist = freelist(() => poly())

function closed_walk(first, outer_cycle) {
	let walk = cycle_freelist.alloc()
	walk.get_point = poly_get_point
	let curr = first
	let prev
	do {
		walk.push(curr)
		let next = next_adj(prev, curr, !prev || outer_cycle)
		prev = curr
		curr = next
		if (curr == first) {
			if (outer_cycle) {
				// when tracing the outer cycle is not enough to stop when the
				// starting point is encountered since multiple outer cycles can
				// meet at the starting point (connected with filaments or not).
				let next = next_adj(prev, curr, true)
				if (next == walk[1])
					break
			} else {
				break // filament check done later on inner cycles
			}
		}
	} while (1)
	return walk
}

function extract_inner_cycles_for(comp, pg) {
	push_log('extracting inner cycles for comp', comp.id)
	let ps = [...comp.ps]
	while (ps.length > 0) {
		let p = left_bottom_point(ps)
		let c = closed_walk(p)
		let add = c[1] != c[c.length-1] // not started with a filament
		if (add) {
			c.comp = comp
			comp.cycles.push(c)
			pg._init_cycle(c)
		}
		// the first edge is always safe to remove because starting from the leftmost
		// point means that there cannot be a cycle to the right of that first edge
		// so that edge is part of at most one cycle: our cycle.
		rem_edge(c[0], c[1], ps)
		// the removed edge's end-points are now possibly end-points of filaments
		// that we must remove too.
		rem_filament(c[0], ps)
		rem_filament(c[1], ps)
		if (!add)
			pg._free_cycle(c)
	}
	pop_log()
}

function extract_outer_cycle_for(comp) {
	push_log('extracting outer cycle for comp', comp.id)
	let p = left_bottom_point(comp.ps)
	let c = closed_walk(p, true)
	c.reverse() // outer cycle must go clockwise
	c.outer = true
	c.comp = comp
	comp.cycles.push(c)
	comp.outer_cycle = c
	pop_log()
	return c
}

// plane graph class ---------------------------------------------------------

let point_freelist = freelist(function() {
	let p = [0, 0]
	p.segs = []
	p.adj = []
	return p
})

let seg_freelist = freelist(function() {
	let seg = seg2(null, null)
	return seg
})

let comp_freelist = freelist(function() {
	let comp = {}
	comp.ps = []
	comp.cycles = []
	comp.segs = []
	comp.islands = []
	return comp
})

let pg_freelist = freelist(function() {
	return new plane_graph_class()
})

let next_id = 1

let plane_graph_class = class plane_graph extends Array {

	is_plane_graph = true

	constructor() {
		super()
		this.ps = []
		this.segs = []
		this.comps = []
		this.id = gen_id('PG')
	}

	add(pg, opt) {
		assert(pg.is_plane_graph)
		let point_copies = map()
		for (let p of pg.ps)
			point_copies.set(p, this.add_point(p[0], p[1]))
		for (let seg of pg.segs)
			this.add_seg(point_copies.get(seg[0]), point_copies.get(seg[1]))
		return this
	}

	set(pg) {
		this.clear()
		return this.add(pg)
	}

	to(i, out) { return out.set(this.ps[i]) }
	at(i) { return this.ps[i] }

	next_adj(p0, p, clockwise, max_a) {
		return next_adj(p0, p, clockwise, max_a)
	}

	// model editing -------------------------------------------------------

	add_point(x, y, id) {
		let p = point_freelist.alloc()
		p[0] = x
		p[1] = y
		p.id = id ?? gen_id('p')
		if (this.ps_ids)
			this.ps_ids.set(p.id, p)
		this.ps.push(p)
		log('+point:', p.id, ':', x, y)
		return p
	}

	_free_point(p) {
		if (this.ps_ids)
			this.ps_ids.delete(p.id)
		p.adj.length = 0
		p.segs.length = 0
		point_freelist.free(p)
	}

	rem_point(p) { // NOTE: O(n)
		remove_value(this.ps, p)
		if (this.ps_ids?.size)
			this.ps_ids.delete(p.id)
		this._free_point(p)
	}

	rem_points(cond, msg) {
		let a = log && []
		let self = this
		remove_values(this.ps, function(p) {
			if (!cond(p))
				return
			if (a) a.push(p.id)
			self._free_point(p)
			return true
		})
		if (a?.length)
			log(msg ?? 'points', 'removed:', ...a)
	}

	add_seg(p1, p2, id) {
		let seg = seg_freelist.alloc()
		seg[0] = p1
		seg[1] = p2
		seg.id = id ?? gen_id('s')
		this.segs.push(seg)
		seg[0].segs.push(seg)
		seg[1].segs.push(seg)
		seg[0].adj.push(seg[1])
		seg[1].adj.push(seg[0])
		log('+seg:', seg.id, ':', seg[0].id, seg[1].id)
		return seg
	}

	_free_seg(seg) {
		remove_value(seg[0].segs, seg)
		remove_value(seg[1].segs, seg)
		remove_value(seg[0].adj, seg[1])
		remove_value(seg[1].adj, seg[0])
		seg[0] = null
		seg[1] = null
		seg.id = null
		seg.removed = null
		seg_freelist.free(seg)
		log('-seg:', seg.id)
	}

	rem_seg(seg) { // NOTE: O(n)
		remove_value(this.segs, seg)
		this._free_seg(seg)
	}

	rem_segs(cond, msg) {
		let a = log && []
		let self = this
		remove_values(this.segs, function(seg) {
			if (!cond(seg)) return
			if (a) a.push(seg.id)
			self._free_seg(seg)
			return true
		})
		if (a?.length)
			log(msg ?? 'segs', 'removed:', ...a)
	}

	set_seg_point(seg, i, p) {
		let old_p = seg[i]
		let other_p = seg[1-i]
		remove_value(old_p.segs, seg)
		p.segs.push(seg)
		replace_value(other_p.adj, old_p, p)
		remove_value(old_p.adj, other_p)
		p.adj.push(other_p)
		seg[i] = p
		log('~seg:', seg.id, '/', i, ':', old_p.id, '->', p.id)
		return old_p
	}

	clear() {
		if (this.ps_ids)
			this.ps_ids.clear()
		for (let p of this.ps)
			this._free_point(p)
		for (let seg of this.segs)
			this._free_seg(seg)
		this.ps.length = 0
		this.segs.length = 0
		this._free_comps()
		this.length = 0
	}

	free() {
		this.clear()
		pg_freelist.free(this)
	}

	// model loading ----------------------------------------------------------

	_add_json_point(p) { // [x,y[,id]] | {x:, y:, i: id}
		if (isarray(p))
			return this.add_point(p[0], p[1], p[2])
		else if (isobj(p))
			return this.add_point(p.x, p.y, p.id)
		else
			check(false, 'invalid point', p)
	}

	_point_ref(p) { // idx | id | json_point
		if (isnum(p))
			return check(this.ps[p], 'invalid point index', p)
		else if (isstr(p))
			return check(this.ps_ids.get(p), 'invalid point id', p, '('+typeof p+')')
		else
			return this._add_json_point(p)
	}

	add_segs(a) {
		if (isstr(a))
			a = words(a)
		if (a[0] == 'draw') { // ['draw', [id, ]x0, y0, [id, ]d-to-right, [id, ]d-to-down, [id, ]d-to-right, ...]
			let x0, p0, id
			let i = 0
			let n = a.length
			let sx = 1 // horizontal first
			let sy = 0
			while (i < a.length) {
				let m = a[i]
				if (isstr(m))
					id = m
				else if (x0 == null) {
					x0 = m
				} else if (p0 == null) {
					p0 = this.add_point(x0, m, id)
					id = null
				} else {
					if (m) { // 0 means skip so we can change direction back
						let x = p0[0] + m * sx
						let y = p0[1] + m * sy
						let p = this.add_point(x, y, id)
						id = null
						this.add_seg(p0, p)
						p0 = p
					}
					sx = 1-sx
					sy = 1-sy
				}
				i++
			}
		} else if (a[0] == 'connect') { // ['connect', p1, p2, ...]
			let p0 = this._point_ref(a[1])
			for (let i = 2, n = a.length; i < n; i++) {
				let p1 = this._point_ref(a[i])
				if (p0 && p1)
					this.add_seg(p0, p1)
				p0 = p1
			}
		} else { // [seg_id, p1, p2, ...]
			for (let i = 0, n = a.length; i < n; i += 3) {
				let id = a[i]
				let p1 = this._point_ref(a[i+1])
				let p2 = this._point_ref(a[i+2])
				this.add_seg(p1, p2, id)
			}
		}
	}

	load(points, segs) {

		this.clear()

		if (!this.ps_ids)
			this.ps_ids = map()

		if (points)
			for (let p of points)
				this._add_json_point(p)

		if (segs)
			for (let a of segs)
				this.add_segs(a)

		return this
	}

	// model fixing --------------------------------------------------------

	_rebuild_adj_refs() {
		for (let p of this.ps)
			p.adj.length = 0
		for (let p of this.ps)
			for (let seg of p.segs)
				p.adj.push(seg[1-seg.pi(p)])
	}

	_remove_isolated_points() {
		this.rem_points(p => p.adj.length == 0, 'isolated points')
	}

	_remove_null_segs() {
		this.rem_segs(seg => this.orthogonal
			? seg[0][0] == seg[1][0] && seg[0][1] == seg[1][1]
			: v2_near(seg[0], seg[1]), 'null segs')
	}

	_remove_angled_segs() {
		if (!this.orthogonal)
			return
		this.rem_segs(seg => seg[0][0] != seg[1][0] && seg[0][1] != seg[1][1], 'angled segs')
	}

	// NOTE: assumes segs are sorted, null segs removed, points deduplicated.
	_merge_colinear_segs() {
		for (let p of this.ps) {
			if (p.adj.length == 2) {
				let p0 = p.adj[0]
				let p2 = p.adj[1]
				if (points_colinear(p0, p, p2)) {

					let s1 = p.segs[0]
					let s2 = p.segs[1]
					let s1_pi = s1.pi(p)
					let s2_p2 = s2[1-s2.pi(p)]
					push_log('merging segs:', s1.id, '+', s2.id, '=>', s1.id)
					this.set_seg_point(s1, s1_pi, s2_p2)
					this.rem_seg(s2)

					pop_log()
				}
			}
		}
	}

	// shortens seg at m with new point and adds new seg without detaching the original seg's end-points.
	// TODO: generalize to angled segs.
	split_seg_at(seg, m) {
		push_log('-/-seg:', seg.id, '@', m)
		let m1 = seg.m1
		let m2 = seg.m2
		let x = seg.is_v ? seg.x1 : m
		let y = seg.is_v ? m : seg.y1
		let new_p = this.add_point(x, y)
		let old_p = this.set_seg_point(seg, seg.i2, new_p)
		let new_seg = this.add_seg(new_p, old_p)
		pop_log()
	}

	// TODO: generalize to angled segs.
	_split_intersecting_segs_on(v) {
		if (!this.orthogonal)
			return
		push_log('split all intersecting segs')
		for (let seg1 of this.segs) {
			if (seg1.is_v == v) {
				for (let seg2 of this.segs) {
					if (seg2.is_v != v) {
						let m1  = seg1.m1
						let m2  = seg1.m2
						let bm1 = seg2.m1
						let bm2 = seg2.m2
						let a   = seg1.axis
						let ba  = seg2.axis
						if (bm1 <= a && bm2 >= a && ba > m1 && ba < m2) {
							// splitting adds a seg at the end of segs array which will
							// be also tested in the outer loop and possibly split further.
							// the shortened seg is potentially split multiple times
							// in this inner loop.
							this.split_seg_at(seg1, ba)
						}
					}
				}
			}
		}
		pop_log()
	}
	_split_intersecting_segs() {
		this._split_intersecting_segs_on(0)
		this._split_intersecting_segs_on(1)
	}

	// NOTE: leaves isolated points behind.
	_points_cmp(p1, p2) {
		let dx = p1[0] - p2[0]; if (dx) return dx
		let dy = p1[1] - p2[1]; if (dy) return dy
		return p1.id - p2.id
	}
	_deduplicate_points() {
		push_log('deduplicate all points')
		this.ps.sort(this._points_cmp)
		let p0
		for (let i = 0; i < this.ps.length; i++) {
			let p = this.ps[i]
			if (p0 && (this.orthogonal
				? p[0] == p0[0] && p[1] == p0[1]
				: v2_near(p, p0))) {
				for (let j = 0; j < p.segs.length; j++) { // each connected seg
					let seg = p.segs[j]
					for (let i = 0; i < 2; i++) // each seg end
						if (seg[i] == p) {
							this.set_seg_point(seg, i, p0)
							j-- // because seg was just removed from p.segs
						}
				}
				continue
			}
			p0 = p
		}
		pop_log()
	}

	// TODO: generalize to angled segs.
	// NOTE: requires no intersecting segments.
	_break_overlapping_segs() {
		if (!this.orthogonal)
			return
		push_log('breaking overlapping colinear segs')
		this.segs.sort(function(s1, s2) {


			// level 1 grouping by direction
			let v1 = s1.is_v
			let v2 = s2.is_v
			let dv = v1 - v2
			if (dv) return dv
			// level 2 grouping by axis
			let m1 = s1.axis
			let m2 = s2.axis
			let dm = m1 - m2
			if (dm) return dm
			let i = v1 ? 1 : 0
			let c1 = min(s1[0][i], s1[1][i])
			let c2 = min(s2[0][i], s2[1][i])
			return c1 - c2


			// TODO:

			// level 1 grouping by angle
			let [p1, p2] = s1
			let [x1, y1] = p1
			let [x2, y2] = p2
			let [p3, p4] = s2
			let [x3, y3] = p3
			let [x4, y4] = p4
			let a1 = pseudo_angle(x2 - x1, y2 - y1)
			let a2 = pseudo_angle(x4 - x3, y4 - y3)
			let da = a1 - a2
			if (da) return da
			// level 2 grouping by x-intercept (same angle and x-intercept means colinear)
			let xi1 = line2.x_intercept(x1, y1, x2, y2)
			let xi2 = line2.x_intercept(x3, y3, x4, y4)
			let dxi = xi1 - xi2
			if (dxi) return dxi
			// level 3 grouping by starting point because most segments are
			// non-overlapping and we want to skip those quickly.
			let dx = x1 - x2; if (dx) return dx
			let dy = y1 - y2; return dy
		})
		let i0, v0, m0
		for (let i = 0, n = this.segs.length; i <= n; i++) {
			let seg = this.segs[i]
			let v = seg ? seg.is_v : null
			let m = seg ? seg.axis : null
			if (v0 == null) {
				i0 = i
				v0 = v
				m0 = m
			} else if (v != v0 || m != m0) {
				if (i >= i0 + 2) { // there's at least 2 segments on this axis
					let seg0 = this.segs[i0]
					for (let j = i0+1; j < i; j++) {
						let seg1 = this.segs[j]
						let m1_1 = seg1.m1
						let m2_0 = seg0.m2
						if (m1_1 < m2_0) {
							// seg points that are overlapping segs have no _|_ joints
							// or they wouldn't be overlapping the seg, so it's safe
							// to remove the overlapping seg as long as we elongate
							// the overlapped seg.
							log('segs overlap:', seg0.id, seg1.id, ':', m1_1, '<=', m2_0,
								'; seg removed:', seg1.id, '; seg', seg0.id, '.m2 set to:', seg1.m2)
							seg1.removed = true
							seg0.m2 = max(seg1.m2, seg0.m2)
						} else {
							seg0 = seg1
						}
					}
				}
				i0 = i
				v0 = v
				m0 = m
			}
		}
		this.rem_segs(seg => seg.removed)
		pop_log()
	}

	// finding graph components --------------------------------------------

	_add_comp() {
		let comp = comp_freelist.alloc()
		comp.id = gen_id('co')
		this.comps.push(comp)
		return comp
	}

	_free_comp(comp) {
		comp.id = null
		comp.inside = null
		comp.parent = null
		comp.ps.length = 0
		for (let cycle of comp.cycles)
			this._free_cycle(cycle)
		comp.cycles.length = 0
		comp.outer_cycle = null
		comp.segs.length = 0
		comp.islands.length = 0
		comp_freelist.free(comp)
	}

	_free_comps() {
		for (let comp of this.comps)
			this._free_comp(comp)
		this.comps.length = 0
	}

	// NOTE: needs adj refs
	_find_comps() {

		push_log('finding graph components')

		this._free_comps()

		for (let p of this.ps)
			p.visited = false

		function dfs(p, ps, segs) {
			p.visited = true
			ps.push(p)
			for (let seg of p.segs)
				segs.add(seg)
			for (p of p.adj)
				if (!p.visited)
					dfs(p, ps, segs)
		}

		for (let p of this.ps) {
			if (!p.visited) {
				let comp = this._add_comp()
				let segs = set()
				dfs(p, comp.ps, segs)
				comp.segs = set_toarray(segs)
				log('+comp:', comp.id, ':', comp.id, ...comp.ps.map(p=>p.id))
			}
		}

		pop_log()
	}

	// finding which components are inside islands ----------------------------

	_is_comp_inside_poly(c, poly) { // comp inside poly check
		if (!c.bb.inside_bbox2(...poly.bbox()))
			return false
		return poly.hit(c.ps[0][0], c.ps[0][1])
	}

	_is_comp_inside_comp(c, p) { // comp inside comp check
		return this._is_comp_inside_poly(c, p.outer_cycle)
	}

	_is_comp_inside_cycle(co, cy) { // comp inside cycle check
		return this._is_comp_inside_poly(co, cy, cy.bbox())
	}

	// NOTE: O(n^2)
	_is_comp_directly_inside_comp(c, p) { // comp directly inside comp check
		if (!this._is_comp_inside_comp(c, p))
			return false
		for (let q of this.comps)
			if (q != c && q != p && q.inside
				&& this._is_comp_inside_comp(c, q)
				&& this._is_comp_inside_comp(q, p)
			)
				return false
		return true
	}

	_find_inside_comps() {

		push_log('finding islands')

		// point-based bbox: enough for computing inside flag.
		for (let c of this.comps) {
			c.inside = false
			c.parent = null
			c.islands.length = 0
			c.bb = bbox2()
			for (let cy of c.cycles)
				c.bb.add_bbox2(...cy.bbox())
		}

		// set inside flag with O(n^2) in order to lower the n for the O(n^4) loop below.
		this.length = 0
		for (let c of this.comps) {
			for (let p of this.comps) {
				if (p != c && this._is_comp_inside_comp(c, p)) {
					c.inside = true
					break
				}
			}
			if (!c.inside)
				this.push(c)
		}

		// NOTE: O(n^4) but only checks islands which should be rare.
		for (let c of this.comps) {
			if (!c.inside)
				continue
			for (let p of this.comps) {
				if (p != c && this._is_comp_directly_inside_comp(c, p)) {
					c.parent = p
					p.islands.push(c)
				}
			}
		}

		// assign islands to inner cycles.
		for (let comp of this.comps) {
			for (let cycle of comp.cycles) {
				if (cycle.outer)
					continue
				cycle.islands.length = 0
				for (let icomp of comp.islands) {
					if (this._is_comp_inside_cycle(icomp, cycle)) {
						cycle.islands.push(icomp)
						log('comp', icomp.id, 'is inside comp', comp.id, 'cycle', cycle.id)
					}
				}
			}
		}

		pop_log()

	}

	// finding the cycle base -------------------------------------------------

	_init_cycle(c) {
		c.id = gen_id('cy')
		c.area_pos = [...c.center()]
		c.islands = []
		log('+cycle', this.id, '/', c.comp.id, '/', c.id,
			c.is_cw() ? 'cw' : 'ccw',
			c.outer ? 'outer' : '',
			c.inside ? 'inside' : '',
			':', ...c.map(p=>p.id))
	}

	_free_cycle(c) {
		c.id = null
		c.length = 0
		c.comp = null
		if (c.islands)
			c.islands.length = 0
		c.outer = null
		c.invalidate()
		cycle_freelist.free(c)
	}

	_extract_cycles() {

		for (let c of this.comps)
			c.cycles.length = 0

		// NOTE: it's part of the API that the outer cycle is first cycle!
		for (let c of this.comps) {
			let cy = extract_outer_cycle_for(c)
			this._init_cycle(cy)
		}
		this._rebuild_adj_refs()

		for (let c of this.comps)
			extract_inner_cycles_for(c, this)
		this._rebuild_adj_refs()

	}

	// hit testing ------------------------------------------------------------

	hit_cycle_edges_of_cycle(x, y, cy) {
		if (cy.outer)
			return
		if (!cy.edges.bbox().hit(x, y))
			return
		for (let comp of cy.islands) {
			let cy = this.hit_cycle_edges_of_island(x, y, comp)
			if (cy)
				return cy
			if (comp.outer_cycle.edges.hit(x, y)) // in the island's wall body.
				return
		}
		if (!cy.edges.hit(x, y))
			return
		return cy
	}

	hit_cycle_edges_of_island(x, y, comp) {
		for (let cy of comp.cycles) {
			let hit_cy = this.hit_cycle_edges_of_cycle(x, y, cy)
			if (hit_cy)
				return hit_cy
		}
	}

	hit_cycle_edges(x, y) {
		for (let comp of this) {
			let cy = this.hit_cycle_edges_of_island(x, y, comp)
			if (cy)
				return cy
		}
	}

	// plan loading & validation -------------------------------------------

	_after_fix() {} // stub

	rebuild() {
		this._find_comps()
		this._extract_cycles()
		this._find_inside_comps()
		return this
	}

	fix() {
		push_log('fixing plane_graph', this.id)
		this._split_intersecting_segs()
		this._break_overlapping_segs()
		this._remove_null_segs()
		this._deduplicate_points()
		this._rebuild_adj_refs()
		this._merge_colinear_segs()
		this._remove_isolated_points()
		this.rebuild()
		this._after_fix()
		pop_log()
		return this
	}

	// debugging --------------------------------------------------------------

	ps_s() {
		let a = []
		for (let p of this.ps) {
			let [x, y] = p
			if (a.length) a.push(',')
			a.push(p.id, ':', x, y)
		}
		return a
	}

	segs_s() {
		let a = []
		for (let seg of this.segs) {
			let [p1, p2] = seg
			let [x1, y1] = p1
			let [x2, y2] = p2
			if (a.length) a.push(',')
			a.push(seg.id, ':', x1, y1, '-', x2, y2)
		}
		return a
	}

}

G.plane_graph = function() {
	return pg_freelist.alloc()
}
G.plane_graph.class = plane_graph_class

G.seg2 = seg2

}()) // module scope.
