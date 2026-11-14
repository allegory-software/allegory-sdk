(function () {
"use strict"
const G = window

const {
	round, mod, abs, min, max, clamp, tan, rad,
	assert, log, push_log, pop_log, push_log_if,
	insert, remove_value, uniq_sorted, map, assign, clock, json,
} = glue

const {bbox2, poly2} = Math3D

G.DEBUG_PLAN = 0
G.DEBUG_PLAN_LOAD = 1

// house model ---------------------------------------------------------------

let defaults = {
	rotation: 0,
	floor_h: 250,
	int_wall_thickness: 8,
	ext_wall_thickness: 18,
	slab_thickness: 20,
}

function poly_get_point(i, out) {
	out[0] = this[i][0]
	out[1] = this[i][1]
	return out
}

function house_plan(t) {

	let house = {}
	let edit0
	house.edit_no = 0 // increments on each committed edit, undo and redo

	function copy_roofs(roofs) {
		if (!roofs) return
		let a = []
		for (let roof of roofs)
			a.push({type: roof.type, pitch: roof.pitch, eaves: roof.eaves,
				axis: roof.axis, h: roof.h, box: bbox2(...roof.box)})
		return a
	}

	function copy_room_points(room_points) {
		let a = []
		for (let room_point of room_points)
			a.push({x: room_point.x, y: room_point.y,
				is_open: room_point.is_open})
		return a
	}

	house.save_state = function() {
		let floors = []
		for (let floor of house.floors) {
			let state = floor.save_state()
			state.h = floor.fixed_h
			state.roofs = copy_roofs(floor.roofs)
			floors.push(state)
		}
		return {rotation: house.rotation, floor_h: house.floor_h,
			int_wall_thickness: house.int_wall_thickness,
			ext_wall_thickness: house.ext_wall_thickness,
			slab_thickness: house.slab_thickness, floors: floors}
	}

	function begin_edit(floor) {
		assert(!edit0)
		edit0 = floor.save_state()
	}

	function commit_edit(floor) {
		assert(edit0)
		if (json(floor.save_state()) != json(edit0)) {
			undo_stack.push({op: 'edit', floor: floor, state: edit0})
			redo_stack.length = 0
			house.edit_no++
		}
		edit0 = null
	}

	function house_bb() {
		let bb = bbox2()
		for (let floor of house.floors)
			if (floor.bb[0] <= floor.bb[2])
				bb.add_bbox2(...floor.bb)
		return bb
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
		ms.sort((m1, m2) => m1 - m2)
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

	house.snap_lines = [] // [x lines, y lines] of all the floors

	function fix_snap_lines() {
		house.snap_lines[0] = snap_lines_for(1)
		house.snap_lines[1] = snap_lines_for(0)
	}

	function create_floor(t, floor_i) {

		let floor = plane_graph()

		floor.orthogonal = true

		floor.house = house
		floor.roofs = copy_roofs(t.roofs)
		floor.i = floor_i
		floor.id = 'floor'+floor_i
		floor.h = t.h ?? house.floor_h
		floor.fixed_h = t.h
		floor.bb = bbox2()
		// [{x:, y:, is_open:}, ...]
		floor.room_points = copy_room_points(t.room_points ?? [])
		floor.room_point_by_cycle = map() // {cycle -> room_point|null if 2+}

		floor._after_fix = function() {
			create_edges()
			fix_open_rooms()
			fix_roofs()
			fix_snap_lines()
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

			// compute the level plan bbox now that we have outer skins.
			floor.bb.reset()
			for (let co of floor.comps)
				floor.bb.add_bbox2(...co.outer_cycle.edges.bbox())

			// recompute house plan bbox.
			house.bb = house_bb()

		}

		// rooms ---------------------------------------------------------------

		// a room is open if it holds exactly one room point and that point
		// is open. two points in one room: closed.
		function fix_open_rooms() {
			let room_point_by_cycle = floor.room_point_by_cycle
			room_point_by_cycle.clear()
			for (let room_point of floor.room_points) {
				let c = floor.hit_cycle_edges(room_point.x, room_point.y)
				if (!c) // in a wall body or outside: no room.
					continue
				room_point_by_cycle.set(c,
					room_point_by_cycle.has(c) ? null : room_point)
			}
		}

		// no point in room c: add an open one at (x, y). one point: flip it.
		// two or more points: nothing.
		floor.toggle_room = function(c, x, y) {
			let room_point = floor.room_point_by_cycle.get(c)
			if (room_point === null)
				return
			begin_edit(floor)
			if (room_point)
				room_point.is_open = !room_point.is_open
			else
				floor.room_points.push({x: x, y: y, is_open: true})
			floor.fix()
			commit_edit(floor)
		}

		floor.start_move_room_point = function(room_point) {
			begin_edit(floor)
			let x0 = room_point.x
			let y0 = room_point.y
			let s = {}
			s.move = function(dx, dy) {
				room_point.x = x0 + dx
				room_point.y = y0 + dy
			}
			s.stop = function() {
				floor.fix()
				commit_edit(floor)
			}
			s.cancel = cancel_edit
			return s
		}

		floor.remove_room_point = function(room_point) {
			begin_edit(floor)
			remove_value(floor.room_points, room_point)
			floor.fix()
			commit_edit(floor)
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
			return {points: points, lines: [lines],
				room_points: copy_room_points(floor.room_points)}
		}

		floor.load_state = function(state) {
			floor.load(state.points, state.lines)
			floor.room_points = copy_room_points(state.room_points)
			floor.fix()
		}

		// edit history --------------------------------------------------------

		function cancel_edit(draw_state) {
			assert(edit0)
			let state = edit0
			edit0 = null
			floor.load_state(state)
			draw_state.snap_lines.length = 0
			draw_state.measure_edges.length = 0
		}

		floor.delete_seg = function(seg) {
			begin_edit(floor)
			floor.rem_seg(seg)
			floor.fix()
			commit_edit(floor)
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

		function snap_x(x, nosnap) {
			let snap_d = nosnap ? 2 : 20
			return house.snap_lines[0].snap(x, snap_d)
		}
		function snap_y(y, nosnap) {
			let snap_d = nosnap ? 2 : 20
			return house.snap_lines[1].snap(y, snap_d)
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

			begin_edit(floor)
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

					let p1 = seg[seg0.i1]
					let p2 = seg[seg0.i2]
					p1[0] =  v ? a : m1s ?? m1
					p2[0] =  v ? a : m2s ?? m2
					p1[1] = !v ? a : m1s ?? m1
					p2[1] = !v ? a : m2s ?? m2
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
				commit_edit(floor)
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

			begin_edit(floor)
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
						let x = p[0]
						let y = p[1]
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

			floor.rebuild()
			create_edges()

			pop_log()

			let ranges = seg_resize_ranges(seg, p0)
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
				commit_edit(floor)
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

	// walls ------------------------------------------------------------------

	// The code builds the walls of the whole house as polygons, one per flat
	// connected surface. Each polygon lies on a vertical plane at plan
	// x = axis (is_v) or plan y = axis, and its outside is toward the sign of
	// `normal` on that axis. Points are in plane coords (m, z): m is the plan
	// coord along the plane (y if is_v, else x), z is the height from ground.
	//
	// For every skin edge of every floor, the code adds a rectangle from the
	// top of the floor's slab to the top of the floor. For every outer edge
	// of every slab, it adds a rectangle as tall as the slab is thick. All
	// rectangles are ccw in (m, z), and rectangles on the same plane only
	// touch, never overlap. Where two rectangles touch, their edges are on
	// the shared part in opposite directions. So the code sums the directions
	// of all edges on each line and keeps only the parts where the sum is not
	// zero: those parts are the outlines of the merged polygons.

	// planes ------------------------------------------------------------------

	// find or create the plane of the skins at `axis` with outside `normal`.
	function wall_plane(planes, is_v, axis, normal) {
		let key = (is_v ? 'v' : 'h') + (normal > 0 ? '+' : '-') + axis
		let plane = planes.get(key)
		if (!plane) {
			plane = {
				is_v: is_v,
				axis: axis,
				normal: normal,
				hlines: map(), // {z -> [m1, m2, dir, ...]}
				vlines: map(), // {m -> [z1, z2, dir, ...]}
			}
			planes.set(key, plane)
		}
		return plane
	}

	// add a directed edge from m1 to m2 (dir = 1) or back (dir = -1) to the
	// horizontal or vertical line at `line_at`.
	function add_line_edge(lines, line_at, m1, m2, dir) {
		let a = lines.get(line_at)
		if (!a) {
			a = []
			lines.set(line_at, a)
		}
		a.push(m1, m2, dir)
	}

	// add the ccw rectangle from (m1, z1) to (m2, z2), with m1 < m2, z1 < z2.
	function add_rect(plane, m1, z1, m2, z2) {
		// ccw in (m, z): bottom goes +m, right goes +z, top goes -m, left -z.
		add_line_edge(plane.hlines, z1, m1, m2,  1)
		add_line_edge(plane.vlines, m2, z1, z2,  1)
		add_line_edge(plane.hlines, z2, m1, m2, -1)
		add_line_edge(plane.vlines, m1, z1, z2, -1)
	}

	// add the rectangle of skin edge (p1, p2) between heights z1 and z2.
	// the wall body is on the same side of every skin cycle, so the outside
	// of an edge (p1, p2) taken in cycle order is toward (dy, -dx).
	function add_skin_rect(planes, p1, p2, z1, z2) {
		let [x1, y1] = p1
		let [x2, y2] = p2
		let is_v = x1 == x2
		let axis = is_v ? x1 : y1
		let normal = is_v ? (y2 > y1 ? 1 : -1) : (x2 > x1 ? -1 : 1)
		let pm1 = is_v ? y1 : x1
		let pm2 = is_v ? y2 : x2
		let m1 = min(pm1, pm2)
		let m2 = max(pm1, pm2)
		let plane = wall_plane(planes, is_v, axis, normal)
		add_rect(plane, m1, z1, m2, z2)
	}

	// cancelling shared edges -------------------------------------------------

	// sum the edge directions along one line and add each maximal run of
	// non-zero sum to `runs` as m1, m2, dir. a zero sum means a shared part.
	function sum_line_runs(a, runs) {
		let events = [] // [[m, dir_change], ...]
		for (let i = 0; i < a.length; i += 3) {
			let m1  = a[i+0]
			let m2  = a[i+1]
			let dir = a[i+2]
			events.push([m1, dir], [m2, -dir])
		}
		events.sort((e1, e2) => e1[0] - e2[0])
		let sum = 0
		let run_m1, run_dir
		let i = 0
		let n = events.length
		while (i < n) {
			// apply all the events at m, then look at the sum right after m.
			let m = events[i][0]
			while (i < n) {
				let [event_m, dir_change] = events[i]
				if (event_m != m)
					break
				sum += dir_change
				i++
			}
			if (run_m1 != null && sum != run_dir) { // sum changed: end the run.
				runs.push(run_m1, m, run_dir)
				run_m1 = null
			}
			if (run_m1 == null && sum != 0) { // start a run.
				run_m1 = m
				run_dir = sum
			}
		}
	}

	// make the directed edges [m1, z1, m2, z2] left after cancelling.
	function plane_edges(plane) {
		let edges = []
		let runs = []
		for (let [z, a] of plane.hlines) {
			runs.length = 0
			sum_line_runs(a, runs)
			for (let i = 0; i < runs.length; i += 3) {
				let m1  = runs[i+0]
				let m2  = runs[i+1]
				let dir = runs[i+2]
				if (dir > 0)
					edges.push([m1, z, m2, z])
				else
					edges.push([m2, z, m1, z])
			}
		}
		for (let [m, a] of plane.vlines) {
			runs.length = 0
			sum_line_runs(a, runs)
			for (let i = 0; i < runs.length; i += 3) {
				let z1  = runs[i+0]
				let z2  = runs[i+1]
				let dir = runs[i+2]
				if (dir > 0)
					edges.push([m, z1, m, z2])
				else
					edges.push([m, z2, m, z1])
			}
		}
		return edges
	}

	// tracing loops -----------------------------------------------------------

	// find the edge that continues edge `e` at its end point. where two
	// polygons touch at a corner, that point has two outgoing edges. the
	// filled side of every edge is on its left, so the code takes the
	// leftmost turn to keep each polygon's outline a separate loop.
	function next_edge(edges_by_start, e) {
		let [m1, z1, m2, z2] = e
		let dm = m2 - m1
		let dz = z2 - z1
		let next_e, next_turn
		for (let e1 of edges_by_start.get(m2+' '+z2)) {
			let [e1_m1, e1_z1, e1_m2, e1_z2] = e1
			let cross = dm * (e1_z2 - e1_z1) - dz * (e1_m2 - e1_m1)
			let turn = cross > 0 ? 1 : cross < 0 ? -1 : 0 // left, right, straight
			if (next_e && turn <= next_turn)
				continue
			next_e = e1
			next_turn = turn
		}
		return next_e
	}

	// walk the edges into closed loops.
	function trace_loops(edges) {
		let edges_by_start = map() // {'m z' -> [edge, ...]}
		for (let e of edges) {
			let [m1, z1] = e
			let key = m1+' '+z1
			let a = edges_by_start.get(key)
			if (!a) {
				a = []
				edges_by_start.set(key, a)
			}
			a.push(e)
		}
		let loops = []
		for (let e0 of edges) {
			if (e0.is_traced)
				continue
			let loop = poly2()
			loop.get_point = poly_get_point
			let e = e0
			do {
				e.is_traced = true
				loop.push([e[0], e[1]])
				e = next_edge(edges_by_start, e)
			} while (e != e0)
			loops.push(loop)
		}
		return loops
	}

	// polygons ----------------------------------------------------------------

	// make the polygons of one plane. ccw loops are outlines, cw loops are
	// holes. the code adds each hole to the smallest outline that contains
	// it, storing hole points after outline points, like model3 faces.
	function add_plane_polys(plane, polys) {
		let outlines = []
		let holes = []
		for (let loop of trace_loops(plane_edges(plane))) {
			if (loop.area() > 0)
				outlines.push(loop)
			else
				holes.push(loop)
		}

		let outline_holes = [] // [[hole, ...], ...] per outline
		for (let i = 0; i < outlines.length; i++)
			outline_holes.push([])
		for (let hole of holes) {
			// test the middle of the hole's first edge.
			let [m1, z1] = hole[0]
			let [m2, z2] = hole[1]
			let m = (m1 + m2) / 2
			let z = (z1 + z2) / 2
			let min_i
			for (let i = 0; i < outlines.length; i++) {
				let outline = outlines[i]
				if (!outline.hit(m, z))
					continue
				if (min_i != null && outline.area() >= outlines[min_i].area())
					continue
				min_i = i
			}
			outline_holes[min_i].push(hole)
		}

		for (let i = 0; i < outlines.length; i++) {
			let poly = outlines[i]
			poly.holes = []
			for (let hole of outline_holes[i]) {
				poly.holes.push(poly.length)
				for (let p of hole)
					poly.push(p)
			}
			poly.invalidate()
			polys.push(poly)
		}
	}

	// horizontal faces --------------------------------------------------------

	// The code builds the horizontal faces of the whole house as polygons in
	// plan coords (x, y) at height z, facing up (normal = 1) or down
	// (normal = -1). At every height where a slab or a wall starts or ends,
	// the code adds an up face where there is solid just below and air just
	// above, and a down face where it is the other way round. The solid
	// regions below and above overlap only partly and slabs have holes, so
	// summing their edges would mix up faces and holes. Instead the code cuts
	// the plan into cells at the x and y of every skin corner involved, tests
	// the center of each cell, adds the cells that need a face as rectangles,
	// and merges them like the wall rectangles. Where a slab cell borders a
	// cell with no slab, the code adds a side rectangle of the slab to the
	// wall planes.

	function hit_outline(floor, x, y) {
		for (let comp of floor) // root comps: islands are inside them.
			if (comp.outer_cycle.edges.hit(x, y))
				return true
		return false
	}

	// add the faces at the bottom (z) and at the top of the slab between
	// floor0 below and floor1 above to `polys`, and the slab's sides to
	// `planes`. under the slab: the wall bodies of floor0. over the slab: the
	// wall bodies of floor1. no_slab: no slab between them, so the faces at
	// z are the caps of floor0's walls.
	function add_slab_faces(planes, polys, z, floor0, floor1, no_slab) {
		let xs = []
		let ys = []
		for (let floor of [floor0, floor1]) {
			if (!floor)
				continue
			for (let comp of floor.comps)
				for (let c of comp.cycles)
					for (let ep of c.edges) {
						xs.push(ep[0])
						ys.push(ep[1])
					}
		}
		xs.sort((x1, x2) => x1 - x2)
		ys.sort((y1, y2) => y1 - y2)
		uniq_sorted(xs)
		uniq_sorted(ys)

		let nx = xs.length-1
		let ny = ys.length-1
		let slab_cells = [] // [in_slab, ...] at i*ny+j
		let bottom_up   = {hlines: map(), vlines: map()}
		let bottom_down = {hlines: map(), vlines: map()}
		let top_up      = {hlines: map(), vlines: map()}
		let top_down    = {hlines: map(), vlines: map()}
		for (let i = 0; i < nx; i++) {
			let x1 = xs[i]
			let x2 = xs[i+1]
			let x = (x1 + x2) / 2
			for (let j = 0; j < ny; j++) {
				let y1 = ys[j]
				let y2 = ys[j+1]
				let y = (y1 + y2) / 2

				// rooms are inside the outlines: look for them only there.
				let in_outline0 = !!floor0 && hit_outline(floor0, x, y)
				let in_outline1 = !!floor1 && hit_outline(floor1, x, y)
				let room0 = in_outline0 && floor0.hit_cycle_edges(x, y)
				let room1 = in_outline1 && floor1.hit_cycle_edges(x, y)
				let in_walls0 = in_outline0 && !room0
				let in_walls1 = in_outline1 && !room1
				// the slab is under both floors, except under the open rooms
				// of floor1 over the rooms of floor0. the islands of an open
				// room are not in the room.
				let is_open1 = room1
					&& floor1.room_point_by_cycle.get(room1)?.is_open
				let in_slab = !no_slab && (in_outline0 || in_outline1)
					&& !(is_open1 && room0)
				slab_cells[i*ny+j] = in_slab

				if (in_walls0 != in_slab)
					add_rect(in_walls0 ? bottom_up : bottom_down, x1, y1, x2, y2)
				if (in_slab != in_walls1)
					add_rect(in_slab ? top_up : top_down, x1, y1, x2, y2)
			}
		}

		// slab sides: on the cell sides between slab and no slab, facing
		// away from the slab.
		let slab_t = house.slab_thickness
		let z2 = z + slab_t
		for (let i = 0; i < nx; i++) {
			let x1 = xs[i]
			let x2 = xs[i+1]
			for (let j = 0; j < ny; j++) {
				if (!slab_cells[i*ny+j])
					continue
				let y1 = ys[j]
				let y2 = ys[j+1]
				let is_slab_left  = i > 0    && slab_cells[(i-1)*ny+j]
				let is_slab_right = i < nx-1 && slab_cells[(i+1)*ny+j]
				let is_slab_below = j > 0    && slab_cells[i*ny+j-1]
				let is_slab_above = j < ny-1 && slab_cells[i*ny+j+1]
				if (!is_slab_left)
					add_rect(wall_plane(planes, true , x1, -1), y1, z, y2, z2)
				if (!is_slab_right)
					add_rect(wall_plane(planes, true , x2,  1), y1, z, y2, z2)
				if (!is_slab_below)
					add_rect(wall_plane(planes, false, y1, -1), x1, z, x2, z2)
				if (!is_slab_above)
					add_rect(wall_plane(planes, false, y2,  1), x1, z, x2, z2)
			}
		}

		for (let [plane, plane_z, normal] of [
			[bottom_up  , z         ,  1],
			[bottom_down, z         , -1],
			[top_up     , z + slab_t,  1],
			[top_down   , z + slab_t, -1],
		]) {
			let i0 = polys.length
			add_plane_polys(plane, polys)
			for (let i = i0; i < polys.length; i++) {
				polys[i].z = plane_z
				polys[i].normal = normal
			}
		}
	}

	// building ----------------------------------------------------------------

	// make the wall polys and the horizontal polys of floors 0..top_floor.
	// no_top_slab: no slab on top of top_floor, cap its walls instead.
	house.make_polys = function(top_floor, no_top_slab) {
		let planes = map() // {key -> plane}
		let horizontal_polys = []
		let slab_t = house.slab_thickness
		let floors = house.floors
		let floor_n = top_floor.i + 1

		// floor skins: from the top of the floor's slab to the top of the floor.
		for (let floor_i = 0; floor_i < floor_n; floor_i++) {
			let floor = floors[floor_i]
			let z1 = floor.z + slab_t
			let z2 = floor.z + floor.h
			for (let comp of floor.comps) {
				for (let c of comp.cycles) {
					let eps = c.edges
					for (let i = 0, n = eps.length; i < n; i++)
						add_skin_rect(planes, eps[i], eps[(i+1) % n], z1, z2)
				}
			}
		}

		// slabs: slab i is at the bottom of floor i, and one more slab is on
		// top of top_floor, unless no_top_slab.
		for (let i = 0; i <= floor_n; i++) {
			let floor0 = floors[i-1]
			let floor1 = i < floor_n ? floors[i] : null
			let z = floor1 ? floor1.z : floor0.z + floor0.h
			let no_slab = i == floor_n && no_top_slab
			add_slab_faces(planes, horizontal_polys, z, floor0, floor1, no_slab)
		}

		// merge the rectangles of each plane into polygons.
		let wall_polys = []
		for (let plane of planes.values()) {
			let i0 = wall_polys.length
			add_plane_polys(plane, wall_polys)
			for (let i = i0; i < wall_polys.length; i++) {
				let poly = wall_polys[i]
				poly.is_v   = plane.is_v
				poly.axis   = plane.axis
				poly.normal = plane.normal
			}
		}

		return [wall_polys, horizontal_polys]
	}

	house.free = function() {
		// TODO
	}

	// adding and removing floors ----------------------------------------------

	function fix_floor_heights() {
		let z = 0
		for (let floor of house.floors) {
			floor.z = z // height of the floor's bottom from the ground
			z += floor.h
		}
		house.h = z
	}

	// add a copy of the top floor's walls and height on top of it.
	house.add_floor = function() {
		assert(!edit0)
		let floors = house.floors
		let top_floor = floors[floors.length-1]
		let state = top_floor.save_state()
		state.h = top_floor.fixed_h
		let floor = create_floor(state, floors.length)
		floors.push(floor)
		fix_floor_heights()
		floor.fix()
		undo_stack.push({op: 'add_floor', floor: floor})
		redo_stack.length = 0
		house.edit_no++
		return floor
	}

	// remove the top floor. the undo entry keeps the floor so that undo can
	// put it back, and the older entries that load into it stay valid.
	house.remove_top_floor = function() {
		assert(!edit0)
		assert(house.floors.length > 1)
		let floor = pop_floor()
		undo_stack.push({op: 'remove_floor', floor: floor})
		redo_stack.length = 0
		house.edit_no++
	}

	// put a fixed floor back on top: its own state is unchanged.
	function push_floor(floor) {
		house.floors.push(floor)
		fix_floor_heights()
		house.bb = house_bb()
		fix_snap_lines()
	}

	function pop_floor() {
		let floor = house.floors.pop()
		fix_floor_heights()
		house.bb = house_bb()
		fix_snap_lines()
		return floor
	}

	// init -------------------------------------------------------------------

	function init() {

		assign(house, defaults, t)

		let t0 = clock()
		push_log_if(DEBUG_PLAN_LOAD, 'LOADING PLAN')

		house.floors = []

		for (let n = t.floors?.length ?? 0, i = n-1; i >= 0; i--) {
			let floor = create_floor(t.floors[i], i)
			house.floors[i] = floor
		}

		fix_floor_heights()

		for (let floor of house.floors)
			floor.fix()

		house.bb = house_bb()

		let dt = round((clock() - t0) * 1000)
		log('TIME', ('*').repeat(dt), dt, 'ms')

		pop_log()
	}
	init()

	// history ---------------------------------------------------------------

	let undo_stack = []
	let redo_stack = []

	// apply the opposite of an entry and return the entry that reverts that,
	// for the other stack: undo and redo are the same operation.
	function revert_entry(entry) {
		let {op, floor} = entry
		if (op == 'edit') {
			let state = floor.save_state()
			floor.load_state(entry.state)
			return {op: 'edit', floor: floor, state: state}
		} else if (op == 'add_floor') {
			pop_floor()
			return {op: 'remove_floor', floor: floor}
		} else if (op == 'remove_floor') {
			push_floor(floor)
			return {op: 'add_floor', floor: floor}
		}
	}

	house.undo = function() {
		assert(!edit0)
		if (!undo_stack.length)
			return false
		redo_stack.push(revert_entry(undo_stack.pop()))
		house.edit_no++
		return true
	}

	house.redo = function() {
		assert(!edit0)
		if (!redo_stack.length)
			return false
		undo_stack.push(revert_entry(redo_stack.pop()))
		house.edit_no++
		return true
	}

	return house
}

G.house_plan = house_plan

}()) // module scope.
