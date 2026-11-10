(function () {
"use strict"
const G = window

const {bbox2, poly2} = Math3D

let out = []

G.DEBUG_PLAN = 0
G.DEBUG_PLAN_LOAD = 1

// face plan model utils -----------------------------------------------------

// NOTE: face is 0,1,2,3 going clockwise from the bottom-side face.
let face_is_v = i => i & 1                   // 0,1,2,3 ->  0,1,0,1
let face_sign = i => (i & 2) - 1             // 0,1,2,3 -> -1,-1,1,1
let face_axis_sign = i => ((i + 3) & 2) - 1  // 0,1,2,3 -> 1,-1,-1,1

// house model ---------------------------------------------------------------

let defaults = {
	floor_h: 250,
	int_wall_thickness: 8,
	ext_wall_thickness: 18,
}

function poly_get_point(i, out) {
	out[0] = this[i][0]
	out[1] = this[i][1]
	return out
}

function house_plan(t) {

	let house = {}

	function house_bb() {
		let bb = bbox2()
		for (let floor of house.floors)
			if (floor.bb[0] <= floor.bb[2])
				bb.add_bbox2(...floor.bb)
		return bb
	}

	function create_floor(t, floor_i) {

		let floor = plane_graph()

		floor.orthogonal = true

		floor.house = house
		floor.roofs = t.roofs
		floor.i = floor_i
		floor.id = 'floor'+floor_i
		floor.h ??= house.floor_h
		floor.fixed_h = t.h
		floor.bb = bbox2()

		floor.snap_lines = []

		floor._after_fix = function() {
			create_edges()
			fix_roofs()
			floor.snap_lines[0] = snap_lines_for(1)
			floor.snap_lines[1] = snap_lines_for(0)
			for (let face of house.faces)
				face.fix()
		}

		function fix_areas_for(comp) {
			for (let c of comp.cycles) {
				if (c.outer)
					continue
				let a0 = c.edges.area()
				for (let icomp of c.islands) {
					fix_areas_for(icomp)
					c.edges._area -= icomp.outer_cycle.edges.area()
				}
				let a1 = c.edges.area()
				if (0 && a1 != a0)
					log('cycle', c.id, 'area fixed:', a1, '+', a0-a1, '=', a0)
			}
		}

		function create_edges() {

			for (let p of floor.ps)
				p.max_offset = 0

			let t_int = house.int_wall_thickness
			let t_ext = house.ext_wall_thickness
			let o_int = t_int / 2
			let o_ext = t_ext - o_int

			for (let comp of floor.comps) {
				for (let c of comp.cycles) {
					let edges = poly2()
					edges.get_point = poly_get_point
					c.edges = c.offset(c.outer ? (c.comp.inside ? -o_int : -o_ext) : -o_int, edges)
				}
			}

			for (let c of floor)
				fix_areas_for(c)

			// compute the level plan bbox now that we have outer skins.
			floor.bb.reset()
			for (let co of floor.comps)
				floor.bb.add_bbox2(...co.outer_cycle.edges.bbox())

			// recompute house plan bbox.
			if (house.bb) // not in init
				house.bb = house_bb()

		}

		// roofs ---------------------------------------------------------------

		function roof_ridge_is_v(roof) { return roof.axis == 'v' }

		function gable_roof_ridge_axis(roof) {
			let M1 = roof_ridge_is_v(roof) ? 0 : 1
			let m1 = roof.bb[M1]
			let m2 = roof.bb[M1+2]
			return (m1 + m2) / 2
		}

		function gable_roof_height_at(m, roof) {
			let a = roof.pitch * rad
			let M1 = roof_ridge_is_v(roof) ? 0 : 1
			let m1 = roof.bb[M1]
			let m2 = roof.bb[M1+2]
			let mc = (m2 + m1) / 2
			return round(tan(a) * ((m2 - mc) - abs(m - mc)))
		}

		function gable_roof_height_at_point(px, py, roof) {
			let m = roof_ridge_is_v(roof) ? px : py
			return gable_roof_height_at(m, roof)
		}

		function roof_section() {

		}

		function init_roofs() {
			if (!floor.roofs)
				return
			push_log('init roofs')

			for (let roof of floor.roofs) {
				roof.box = bbox2(...roof.box)
				fix_roof(roof)
			}

			pop_log()
		}

		function fix_roof(roof) {
			//
		}

		function fix_roofs() {
			if (!floor.roofs)
				return
			for (let roof of floor.roofs)
				fix_roof(roof)
		}

		// model state ---------------------------------------------------------

		floor.save_state = function() {
			let points = []
			let lines = []
			let point_indices = map()
			for (let p of floor.ps) {
				point_indices.set(p, points.length)
				points.push([p[0], p[1], p.id])
			}
			for (let seg of floor.segs)
				lines.push(seg.id, point_indices.get(seg[0]),
					point_indices.get(seg[1]))
			return {points: points, lines: [lines]}
		}

		function same_state(state) {
			let lines = state.lines[0]
			if (floor.ps.length != state.points.length
				|| floor.segs.length * 3 != lines.length)
				return false
			for (let i = 0; i < floor.ps.length; i++) {
				let p = floor.ps[i]
				let p0 = state.points[i]
				if (p[0] != p0[0] || p[1] != p0[1] || p.id != p0[2])
					return false
			}
			for (let i = 0; i < floor.segs.length; i++) {
				let seg = floor.segs[i]
				let j = i * 3
				if (seg.id != lines[j]
					|| seg[0] != floor.ps[lines[j+1]]
					|| seg[1] != floor.ps[lines[j+2]])
					return false
			}
			return true
		}

		floor.load_state = function(state) {
			floor.load(state.points, state.lines)
			floor.fix()
		}

		// edit history --------------------------------------------------------

		let undo_stack = []
		let redo_stack = []
		let edit0

		function begin_edit() {
			assert(!edit0)
			edit0 = floor.save_state()
		}

		function commit_edit() {
			assert(edit0)
			if (!same_state(edit0)) {
				undo_stack.push(edit0)
				redo_stack.length = 0
			}
			edit0 = null
		}

		function cancel_edit(draw_state) {
			assert(edit0)
			let state = edit0
			edit0 = null
			floor.load_state(state)
			draw_state.snap_lines.length = 0
			draw_state.measure_edges.length = 0
		}

		floor.undo = function() {
			assert(!edit0)
			if (!undo_stack.length)
				return false
			redo_stack.push(floor.save_state())
			floor.load_state(undo_stack.pop())
			return true
		}

		floor.redo = function() {
			assert(!edit0)
			if (!redo_stack.length)
				return false
			undo_stack.push(floor.save_state())
			floor.load_state(redo_stack.pop())
			return true
		}

		floor.delete_seg = function(seg) {
			begin_edit()
			floor.rem_seg(seg)
			floor.fix()
			commit_edit()
		}

		// plan view UI ops ----------------------------------------------------

		// Find and fix the the cycles that contain the sequence (p0,p1,p2) or (p2,p1,p0).
		// If (p0,p1,p2) is found then the cycle is to the left of the sequence if it's an inner cycle.
		// If (p2,p1,p0) is found then the cycle is to the right of the sequence if it's an inner cycle.
		// It's the opposite if it's an outer cycle.
		// The same cycle will contain the sequence twice (once as is once in reverse)
		// if the sequence is (part of) a filament.
		// NOTE: replacing a point in the cycle (instead of always adding one) makes the cycle
		// technically invalid (as it's skipping a point) but we do it to keep the offset edge
		// stable at that corner while dragging the segment.
		function fix_cycle(c, i, fw, action, new_p, p0, p1, p2) {
			if (action == 'replace') {
				log('cycle point replaced:', c.id, '/', i, ':', c[i].id, '->', new_p.id)
				c[i] = new_p
			} else if (action == 'insert') {
				i = fw ? i : i+1 // insert point in the cycle array
				log('cycle point inserted:', c.id, '/', i, '(before ', c[i] ? c[i].id : 'end','):', new_p.id)
				insert(c, i, new_p)
			}
		}
		function fix_cycles_containing(p0, p1, p2, action, new_p) {
			push_log('fix all cycles containing (', p0.id, p1.id, p2.id, ':', action, 'with', new_p.id)
			for (let comp of floor.comps)
				for (let c of comp.cycles) {
					let i0 = 0
					while (1) {
						let i = c.indexOf(p1, i0)
						if (i == -1)
							break
						let fp0 = c[mod(i-1, c.length)]
						let fp2 = c[mod(i+1, c.length)]
						if (fp0 == p0 && fp2 == p2) fix_cycle(c, i, 1, action, new_p, p0, p1, p2)
						if (fp0 == p2 && fp2 == p0) fix_cycle(c, i, 0, action, new_p, p2, p1, p0)
						i0 = i+1
					}
				}
			pop_log()
		}

		// colinear segs directly end-to-end tied to the segment we want to move
		// must be separated by addidng a _|_ seg in between so they're not dragged along.
		// NOTE: do not deduplicate points after this!
		function detach_seg_at(seg, i, p00) {
			push_log('detach seg:', seg.id)
			let p  = seg[i]
			let p0 = seg[1-i]
			let new_p = floor.add_point(p[0], p[1])

			// each side of (p0,p) needs a different kind of fixing depending on
			// whether there's a _|_ seg at the separation point on that side or not.
			if (p.adj.length > 2) {
				for (let cw = 0; cw <= 1; cw++) {
					let p1 = floor.next_adj(p0, p, cw, 1)
					fix_cycles_containing(p0, p, p1 ?? p00, p1 ? 'replace' : 'insert', new_p)
				}
			} else { // no _|_ segs on the sides.
				fix_cycles_containing(p0, p, p00, 'insert', new_p)
			}

			floor.set_seg_point(seg, i, new_p, 1)
			let new_seg = floor.add_seg(p, new_p)
			pop_log()
		}
		function points_equal(p1, p2) { return p1[0] == p2[0] && p1[1] == p2[1] }
		function opposite_seg(seg, i) {
			let v = seg.is_v
			let p = seg[i]
			for (let seg1 of p.segs) { // each segment connected to that end-point
				if (seg1 == seg) // itself
					continue
				if (seg1.is_v != v) // not colinear
					continue
				if (points_equal(seg1[0], seg1[1])) // just added
					continue
				return seg1
			}
		}
		function detach_opposite_seg(seg, i) {
			let seg1 = opposite_seg(seg, i)
			if (!seg1) return
			let p = seg[i]
			if (seg1[0] == p) detach_seg_at(seg1, 0, seg[1-i])
			else
			if (seg1[1] == p) detach_seg_at(seg1, 1, seg[1-i])
		}
		function detach_colinear_segs(seg) {
			detach_opposite_seg(seg, 0)
			detach_opposite_seg(seg, 1)
		}

		function segs_overlap(am1, am2, bm1, bm2) { // check if two segments overlap
			return !(am2 <= bm1 || bm2 <= am1)
		}

		function snap_lines_for(v, exclude_seg) {
			let mi = v ? 0 : 1
			let ms = []
			for (let floor of house.floors) {
				for (let p of floor.ps) {
					if (exclude_seg && (exclude_seg[0] == p || exclude_seg[1] == p))
						continue
					let m = p[mi]
					ms.push(m)
				}
			}
			ms.sort()
			uniq_sorted(ms)

			ms.snap = function(m, snap_d) {
				let min_d = 1/0
				let min_m
				for (let m1 of ms) {
					let d = abs(m - m1)
					if (d <= snap_d && d < min_d) {
						min_d = d
						min_m = m1
					}
				}
				return min_m // ?? snap(m, 10)
			}

			ms.v = v

			return ms
		}

		function snap_x(x, nosnap) {
			let snap_d = nosnap ? 2 : 20
			return floor.snap_lines[0].snap(x, snap_d)
		}
		function snap_y(y, nosnap) {
			let snap_d = nosnap ? 2 : 20
			return floor.snap_lines[1].snap(y, snap_d)
		}
		floor.snap_x = snap_x
		floor.snap_y = snap_y

		function seg_move_bump_limit(seg, sign) {
			let v = seg.is_v
			let a = seg.axis
			let min_a1 = sign * 1/0
			let s_m1 = seg.m1
			let s_m2 = seg.m2
			for (let seg1 of floor.segs) {
				let s1_m1 = seg1.m1
				let s1_m2 = seg1.m2
				let a1 = seg1.axis
				if (seg1.is_v != v) {
					let closest_m = sign < 0 ? max(s1_m1, s1_m2) : min(s1_m1, s1_m2)
					s1_m1 = a1
					s1_m2 = a1
					a1 = closest_m
				}
				if (sign * a1 > sign * a && sign * a1 < sign * min_a1) {
					if (segs_overlap(s_m1, s_m2, s1_m1, s1_m2)) {
						min_a1 = a1
					}
				}
			}
			return min_a1
		}
		function seg_move_ranges(seg) {
			let min_a = seg_move_bump_limit(seg, -1)
			let max_a = seg_move_bump_limit(seg,  1)
			let ranges = [
				[min_a, max_a],
			]
			return ranges
		}
		function seg_resize_bump_limit(seg, p, sign) {
			let v = seg.is_v
			let a = p[v ? 1 : 0]
			let m = p[v ? 0 : 1]
			let min_a1 = sign * 1/0
			for (let seg1 of floor.segs) {
				if (seg1.is_v != v) {
					let a1 = seg1.axis
					if (sign * a1 > sign * a && sign * a1 < sign * min_a1) {
						let m1 = seg1.m1
						let m2 = seg1.m2
						if (m >= m1 && m <= m2)
							min_a1 = a1
					}
				}
			}
			return min_a1
		}
		function seg_resize_ranges(seg, p) {
			let min_a = seg_resize_bump_limit(seg, p, -1)
			let max_a = seg_resize_bump_limit(seg, p,  1)
			let ranges = [
				[min_a, max_a],
			]
			return ranges
		}
		function closest_range(a, ranges) {
			let min_range
			let min_d = 1/0
			for (let range of ranges) {
				let [a1, a2] = range
				if (a >= a1 && a <= a2) { // in range
					min_range = range
					break
				}
				let d = max(0, min(abs(a1 - a), abs(a2 - a))) // distance to range's closest end-point
				if (d < min_d) {
					min_range = range
					min_d = d
				}
			}
			return min_range
		}
		function snap_seg(a, ranges, snap_lines, draw_state, snap_d) {
			let snap_range = closest_range(a, ranges)
			let [min_a, max_a] = snap_range
			a = clamp(a, min_a, max_a)
			let sa = snap_lines.snap(a, ui.keypressed('ctrl') ? 2 : snap_d)
			draw_state.snap_lines.length = 0
			if (sa != null)
				draw_state.snap_lines.push(sa, snap_lines.v)
			return sa ?? a
		}

		// find the seg in the left, right, top, bottom side around p.
		function seg_around_point(p, sdx, sdy) {
			let p0 = [p[0] + sdx, p[1] + sdy]
			let p1 = floor.next_adj(p0, p, 1, 0)
			// find the seg of (p, p1)
			for (let seg of p.segs)
				if (seg[0] == p && seg[1] == p1 || seg[1] == p && seg[0] == p1)
					return seg
		}

		function start_move_seg(seg, draw_state) {

			push_log('START MOVE SEG:', seg.id)

			begin_edit()
			detach_colinear_segs(seg)

			pop_log()

			let move_freely = seg[0].segs.length == 1 && seg[1].segs.length == 1
			let seg0 = seg.clone()
			let ranges = seg_move_ranges(seg)
			let snap_lines = snap_lines_for(seg.is_v, move_freely && seg)
			let v = seg0.is_v
			let m_snap_lines = move_freely && snap_lines_for(!seg.is_v, seg)

			// find all affected _|_ edges so we can show their lengths as we move the seg
			function update_measure_edges() {
				let perp_edges = []
				// find the farthest edge point from `c.edges[i0]` going in `dir` direction
				// in the array, which has the same spatial direction `v` with the previous point.
				function last_perp_edge_point(c, i, n, dir, v) {
					let ep0 = c.edges[mod(i, n)]
					while (1) {
						let ep1 = c.edges[mod(i, n)]
						let ep2 = c.edges[mod(i+dir, n)]
						if (ep2.p == ep0.p) // end-cap, don't measure
							return
						if ((ep1[0] == ep2[0]) != v) // changed direction, return last edge point
							return ep1
						i += dir
					}
				}
				let sp1 = seg[0]
				let sp2 = seg[1]
				let v = seg.is_v
				for (let co of floor.comps) {
					for (let c of co.cycles) {
						for (let i = 0, n = c.edges.length; i <= n; i++) {
							let ep1 = c.edges[(i+0) % n]
							let ep2 = c.edges[(i+1) % n]
							if (!(ep1.p == sp1 && ep2.p == sp2 || ep1.p == sp2 && ep2.p == sp1)) // not seg's edge
								continue
							let ep0 = last_perp_edge_point(c, i+0, n, -1, !v)
							let ep3 = last_perp_edge_point(c, i+1, n,  1, !v)
							if (!(ep0 || ep3))
								continue
							if (0) {
								// remove measurement of parallel wall of the same length
								let A = v ? 0 : 1 // index of cross axis of perp segs
								let dupe = ep0 && ep3 && ep0.p[A] == ep3.p[A]
								if (dupe)
									ep3 = null
							}
							if (ep0) perp_edges.push([ep0, ep1])
							if (ep3) perp_edges.push([ep2, ep3])
						}
					}
				}
				draw_state.measure_edges = perp_edges
			}

			update_measure_edges()

			let s = {}

			s.move = function(dx, dy, draw_state) {

				let dm = v ? dy : dx
				let da = v ? dx : dy

				if (move_freely) {

					let snap_d = ui.keypressed('ctrl') ? 2 : 20
					let a = seg0.axis + da
					let sa = snap_lines.snap(a, snap_d) ?? a
					a = sa ?? a

					// snap both end-points on main-axis.
					let m1 = seg0.m1 + dm
					let m2 = seg0.m2 + dm
					let m1s = m_snap_lines.snap(m1, snap_d)
					let m2s = m_snap_lines.snap(m2, snap_d)
					if (m1s != null && m2s != null) // both ends snapped
						if (abs(m1s - m1) <= abs(m2s - m2)) // pick the one closer to snap line
							m2s = null
						else
							m1s = null
					if (m1s != null)
						m2s = m1s + (seg0.m2 - seg0.m1)
					else if (m2s != null)
						m1s = m2s - (seg0.m2 - seg0.m1)

					seg[0][0] =  v ? a : m1s ?? m1
					seg[1][0] =  v ? a : m2s ?? m2
					seg[0][1] = !v ? a : m1s ?? m1
					seg[1][1] = !v ? a : m2s ?? m2
					create_edges()

				} else { // move on cross axis

					let a = seg0.axis + (v ? dx : dy)
					let sa = snap_seg(a, ranges, snap_lines, draw_state, 20)
					a = sa ?? a
					seg.axis = a
					create_edges()
					update_measure_edges()

				}

			}

			s.stop = function(draw_state, remove_seg) {
				push_log('STOP MOVE SEG:', seg.id)
				if (remove_seg)
					floor.rem_seg(seg)
				floor.fix()
				commit_edit()
				pop_log()
				draw_state.snap_lines.length = 0
				draw_state.measure_edges.length = 0
			}
			s.cancel = cancel_edit

			return s
		}
		floor.start_move_seg = start_move_seg

		function start_resize_seg(p, mx0, my0, dx, dy, sdx, sdy, draw_state) {

			// based on direction of drag, either detach a seg or add a seg, and start resizing it.
			push_log('START RESIZE SEG')

			begin_edit()
			let p0 = p ? [...p] : [mx0, my0]
			let seg
			if (p) {
				// find seg in the drag direction around p.
				if (p.segs.length == 1 && p.segs[0].is_v == !!sdy) {
					// p is a free end-point and we're dragging along its main axis: resize it.
					seg = p.segs[0]
				} else {
					// find the seg around p in the direction of drag: that's the segment we want to detach and resize.
					seg = seg_around_point(p, sdx, sdy)
					if (seg) {
						// detach seg at branch point p so we can then resize it by its free end-point.
						let x = p[0] + dx * abs(sdx)
						let y = p[1] + dy * abs(sdy)
						let new_p = floor.add_point(x, y)
						floor.set_seg_point(seg, seg.pi(p), new_p)
						p = new_p
					}
				}
			}

			if (!seg) { // create new seg, anchored to "hovered point" or to "mouse pos when clicked"
				let x1, y1
				if (p) {
					[x1, y1] = p
				} else {
					x1 = mx0
					y1 = my0
				}
				let x2 = x1 + dx * abs(sdx)
				let y2 = y1 + dy * abs(sdy)
				let p1 = floor.add_point(x1, y1)
				let p2 = floor.add_point(x2, y2)
				seg = floor.add_seg(p1, p2)
				p = p2
			}

			log('resizing seg:', seg.id)

			floor.fix()

			pop_log()

			let ranges = seg_resize_ranges(seg, p)
			let snap_lines = snap_lines_for(!seg.is_v, seg)

			let s = {seg: seg}

			s.resize = function(dx, dy, draw_state, hs) {
				let x1 = p0[0] + dx * abs(sdx)
				let y1 = p0[1] + dy * abs(sdy)

				let a = sdx ? x1 : y1
				let sa = snap_seg(a, ranges, snap_lines, draw_state, 30)
				if (sa != null)
					a = sa
				if (sdx)
					x1 = a
				else
					y1 = a
				p[0] = x1
				p[1] = y1
				hs.x = x1
				hs.y = y1
				create_edges()
			}

			s.stop = function(draw_state) {
				push_log('STOP RESIZE SEG:', seg.id)
				floor.fix()
				commit_edit()
				pop_log()
				draw_state.snap_lines.length = 0
				draw_state.measure_edges.length = 0
			}
			s.cancel = cancel_edit

			return s
		}
		floor.start_resize_seg = start_resize_seg

		// init ----------------------------------------------------------------

		push_log('LOADING LEVEL', floor.i)
		floor.load(t.points, t.lines)
		init_roofs()
		pop_log()

		return floor
	}

	// face -------------------------------------------------------------------

	// returns x1, y1, x2, y2, min_depth, max_depth
	function face_bb(vert) {
		let [x1, y1, x2, y2] = house.bb
		let h = house.h
		if (vert)
			return [y1, 0, y2, h, x1, x2]
		else
			return [x1, 0, x2, h, y1, y2]
	}

	function p_x(p) { return p[0] }
	function p_y(p) { return p[1] }

	function create_face(face_i) {

		let fv = face_is_v(face_i)
		let fs = face_sign(face_i)
		let fas = face_axis_sign(face_i)

		let bb = bbox2()

		let ep_m    = fv ? p_y : p_x
		let ep_axis = fv ? p_x : p_y

		function ep_h(ep) {
			return ep.p.h ?? 0
		}

		function edge_sign(ep1, ep2) {
			return ep_m(ep1) < ep_m(ep2) ? 1 : -1
		}

		let walls = [] // exterior wall horizontal measurements
		let planes = []

		let face = {house: house, i: face_i, bb: bb, planes: planes}

		function create_face_planes() {

			return // TODO

			face.bb = face_bb(fv) // TODO: reuse bb

			walls.length = 0
			planes.length = 0

			// find outer edges that are projecting in the face's direction.
			for (let floor of house.floors) {
				for (let comp of floor.comps) {
					if (comp.inside)
						continue
					let eps = comp.outer_cycle.edges
					for (let i = 0, n = eps.length; i < n; i++) {
						let ep1 = eps[(i+0) % n]
						let ep2 = eps[(i+1) % n]
						if ((ep1[0] == ep2[0]) != fv) // _|_ edge: invisible
							continue
						if (edge_sign(ep1, ep2) != fs) // back-face edge: obscured: cull it
							continue
						let last_wall = walls[walls.length-1]
						let last_ep2 = last_wall && last_wall[1]
						if (last_ep2 == ep1) // in-wall point: skip (i.e. merge segs)
							last_wall[1] = ep2
						else
							walls.push([ep1, ep2, floor, comp])
					}
					// merge first and last segs if necessary.
					let first_wall = walls[0]
					let last_wall  = walls[walls.length-1]
					if (last_wall[1] == first_wall[0]) {
						first_wall[0] = last_wall[0]
						walls.pop()
					}
				}
			}

			// pr(face, walls.map(w => w[2].i+':'+w[0].p.i+'-'+w[1].p.id).join(' '))

			// sort walls by depth.
			walls.sort(function(w1, w2) {
				// 1st level grouping: by depth (asc order).
				let y1 = ep_axis(w1[0])
				let y2 = ep_axis(w2[0])
				let dy = fas * (y1 - y2)
				if (dy) return dy
				// 2nd level grouping: by floor (desc order).
				let l1 = w1[2].i
				let l2 = w2[2].i
				return l2 - l1
			})

			let eq_depth = (w1, w2) => ep_axis(w1[0]) == ep_axis(w2[0])
			let eq_floor = (w1, w2) => w1[2] == w2[2]

			// create face polygons by merging the faces that are on the same vertical plane.
			for (let [j1, j2] of group_sorted(walls, eq_depth)) {

				// 1st level grouping: j1,j2 is all walls of a single depth plane.
				push_log('FACE PLANE', 'face=', face_i, 'plane=', planes.length, 'depth=', ep_axis(walls[j1][0]), 'i=', j1, '..', j2)

				let plan = plane_graph()
				plan.depth = ep_axis(walls[j1][0])

				function add_seg(x1, y1, x2, y2, ep1, ep2, ...log_args) {
					push_log(...log_args, ':', x1, y1, '-', x2, y2)
					let p1 = plan.add_point(x1, y1)
					let p2 = plan.add_point(x2, y2)
					// set back refs to origin eps for quick updating
					p1.ep1 = ep1
					p2.ep2 = ep2
					plan.add_seg(p1, p2)
					pop_log()
				}

				let last_i1, last_i2, last_floor_i
				for (let [i1, i2] of group_sorted(walls, eq_floor, j1, j2)) {

					// 2nd level grouping: i1,i2 is all walls of a single floor of this depth plane.

					let floor = walls[i1][2]
					let h = floor.h
					let y = floor.y
					let y1 = y
					let y2 = y + h

					for (let i = i1; i < i2; i++) {

						// make vertical segments (these are just constructed, no merging).
						let [ep1, ep2] = walls[i]
						let x1 = ep_m(ep1)
						let x2 = ep_m(ep2)
						let y11 = y1 - ep_h(ep1)
						let y12 = y1 - ep_h(ep2)
						// pr(face_i, floor.i, x1, x2, ep_h(ep1), ep_h(ep2))
						add_seg(x1, y11, x1, y2, ep1, ep2, 'vertical of floor', floor.i)
						add_seg(x2, y12, x2, y2, ep1, ep2, 'vertical of floor', floor.i)

						// for top and bottom floors whichever they are in this particular
						// depth plane (might not be all floors), make top and bottom segments.
						if (last_floor_i != floor.i+1) // top line
							add_seg(x1, y11, x2, y12, ep1, ep2, 'top of floor', floor.i)
						if (i2 == j2 || last_floor_i != null && last_floor_i != floor.i+1) // bottom line
							add_seg(x1, y2, x2, y2, ep1, ep2, 'bottom of floor', floor.i)
					}

					// merge segments between this floor and the last floor.
					// adding all end-points from the segments of both floors
					// and sorting them gives us exactly the segments we want,
					// no analyzing intersections necessary.
					if (last_floor_i == floor.i+1) {

						let a = []

						for (let i = i1; i < i2; i++)
							a.push(walls[i][0], walls[i][1])
						for (let i = last_i1; i < last_i2; i++)
							a.push(walls[i][0], walls[i][1])

						a.sort((ep1, ep2) => ep_m(ep1) - ep_m(ep2))

						for (let i = 0, n = a.length; i < n; i += 2) {
							let ep1 = a[i]
							let ep2 = a[i+1]
							let x1 = ep_m(ep1)
							let x2 = ep_m(ep2)
							if (x1 != x2)
								add_seg(x1, y1, x2, y1, ep1, ep2, 'between floors', last_floor_i, 'and', floor.i)
						}

					}

					last_i1 = i1
					last_i2 = i2
					last_floor_i = floor.i
				}

				plan.fix()
				planes.push(plan)

				pop_log()

			}

		}

		function wall_face_rect(plan, lv, wr, i, scale) {
			let h = pix(lv.h, scale)
			let v  = wall_vert(wr, i)
			let p1 = wall_p1(wr, i+0, true, null, scale)
			let p2 = wall_p1(wr, i+1, true, null, scale)
			let X = v ? 1 : 0
			let Y = v ? 0 : 1
			let x1 = p1[X]
			let x2 = p2[X]
			let x = min(x1, x2)
			let w = max(x1, x2) - x
			let y = 0
			return [x, y, w, h, p1[Y]] // (x, y, w, h, z)
		}

		face.fix = create_face_planes

		return face
	}

	house.free = function() {
		// TODO
	}

	// init -------------------------------------------------------------------

	function init() {

		assign(house, defaults, t)

		let t0 = clock()
		push_log_if(DEBUG_PLAN_LOAD, 'LOADING PLAN')

		house.floors = []
		house.faces = []

		for (let n = t.floors?.length ?? 0, i = n-1; i >= 0; i--) {
			let floor = create_floor(t.floors[i], i)
			house.floors[i] = floor
		}

		for (let floor of house.floors)
			floor.fix()

		let y = 0
		for (let n = house.floors.length, i = n-1; i >= 0; i--) {
			let floor = house.floors[i]
			floor.y = y
			y += floor.h
		}
		house.h = y

		for (let i = 0; i <= 3; i++)
			house.faces.push(create_face(i))

		house.bb = house_bb()

		for (let face of house.faces)
			face.fix()

		let dt = round((clock() - t0) * 1000)
		log('TIME', ('*').repeat(dt), dt, 'ms')

		pop_log()
	}
	init()

	return house

}

G.house_plan = house_plan

}()) // module scope.
