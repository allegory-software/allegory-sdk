(function () {
"use strict"
const G = window

const {
	round, mod, abs, sign, min, max, clamp, sqrt, tan, rad,
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
	roof_thickness: 20, // at right angles to the roof
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

	function copy_roof(roof) {
		if (!roof)
			return {pitch: 20, overhang: 60, edge_points: []}
		let edge_points = []
		for (let edge_point of roof.edge_points ?? [])
			edge_points.push({x: edge_point.x, y: edge_point.y,
				pitch: edge_point.pitch})
		return {pitch: roof.pitch, overhang: roof.overhang ?? 60,
			edge_points: edge_points}
	}

	function copy_room_points(room_points) {
		let a = []
		for (let room_point of room_points)
			a.push({x: room_point.x, y: room_point.y,
				is_open: room_point.is_open})
		return a
	}

	function copy_area_points(area_points) {
		let a = []
		for (let area_point of area_points)
			a.push({x: area_point.x, y: area_point.y, kind: area_point.kind})
		return a
	}

	house.save_state = function() {
		let floors = []
		for (let floor of house.floors) {
			let state = floor.save_state()
			state.h = floor.fixed_h
			floors.push(state)
		}
		return {rotation: house.rotation, floor_h: house.floor_h,
			int_wall_thickness: house.int_wall_thickness,
			ext_wall_thickness: house.ext_wall_thickness,
			slab_thickness: house.slab_thickness,
			roof_thickness: house.roof_thickness, floors: floors}
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
		// {pitch:, overhang:, edge_points: [{x:, y:, pitch:}, ...]}
		floor.roof = copy_roof(t.roof)
		floor.i = floor_i
		floor.id = 'floor'+floor_i
		floor.h = t.h ?? house.floor_h
		floor.fixed_h = t.h
		floor.bb = bbox2()
		// [{x:, y:, is_open:}, ...]
		floor.room_points = copy_room_points(t.room_points ?? [])
		floor.room_point_by_cycle = map() // {cycle -> room_point|null if 2+}
		// [{x:, y:, kind: 'roof'|'terrace'}, ...]
		floor.area_points = copy_area_points(t.area_points ?? [])

		floor._after_fix = function() {
			create_edges()
			fix_open_rooms()
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

		// the parts of the floor's outlines that the floor above leaves
		// uncovered, one per connected part: [{paths, kind}, ...]. paths: on
		// prism_union()'s grid, the outline first, then its holes. kind: the
		// kind of the one area point inside the area, else 'roof'.
		floor.make_areas = function() {
			let {Clipper64, PolyTree64, ClipType, FillRule, pointInPolygon,
				PointInPolygonResult} = clipper2
			let scale = prism_union.grid_scale
			let floor1 = house.floors[floor.i+1]

			// one ring per outline: the outer skin's corners, without the
			// collinear points of the walls joining it.
			let rings = []
			for (let comp of floor) { // root comps: islands are inside them.
				let eps = comp.outer_cycle.edges
				let ring = []
				for (let i = 0, n = eps.length; i < n; i++) {
					let [x0, y0] = eps[(i+n-1) % n]
					let [x1, y1] = eps[i]
					let [x2, y2] = eps[(i+1) % n]
					if (x0 == x1 && x1 == x2 || y0 == y1 && y1 == y2)
						continue
					ring.push([x1, y1])
				}
				rings.push(ring)
			}

			let paths = []
			for (let ring of rings)
				add_ring_path(paths, ring)
			let clipper = new Clipper64()
			// keeps the corner where an area's side passes from an outline
			// to a wall of the floor above.
			clipper.addSubject(paths)
			if (floor1)
				clipper.addClip(add_outline_paths(floor1, []))
			let tree = new PolyTree64()
			clipper.execute(ClipType.Difference, FillRule.NonZero, tree)

			let areas = []
			let {IsInside, IsOutside} = PointInPolygonResult
			for (let group of add_path_groups(tree, [])) {
				let area_point_n = 0
				let found_area_point
				for (let area_point of floor.area_points) {
					let p = {
						x: round(area_point.x * scale),
						y: round(area_point.y * scale),
					}
					if (pointInPolygon(p, group[0]) != IsInside)
						continue
					let in_hole = false
					for (let i = 1; i < group.length; i++)
						if (pointInPolygon(p, group[i]) != IsOutside)
							in_hole = true
					if (in_hole)
						continue
					area_point_n++
					found_area_point = area_point
				}
				areas.push({
					paths: group,
					kind: area_point_n == 1 ? found_area_point.kind : 'roof',
				})
			}
			return areas
		}

		// the faces of the roof over the floor's roof areas, as returned by
		// roof_skeleton(). roof_areas: areas from make_areas(). an area's
		// side next to the outside of the floor's outlines is an eave side;
		// its other sides run along the walls of the floor above: vertical,
		// they don't move. the roof's edges are the sides of its perimeter:
		// the eave sides moved outward by the overhang. an edge point sets
		// the pitch of the nearest eave side. two or more points on one side:
		// the roof's pitch, like room points. the faces are the roof's top.
		// each sloped side's plane passes through the floor's top on the
		// outer skin, so its eave is lower by the overhang times the slope.
		floor.make_roof_faces = function(roof_areas) {
			let roof = floor.roof
			let wall_z = floor.z + floor.h
			let scale = prism_union.grid_scale
			let floor1 = house.floors[floor.i+1]
			let {pointInPolygon, PointInPolygonResult} = clipper2

			let area_paths = [] // ccw outlines and cw holes of all the areas
			for (let area of roof_areas)
				for (let path of area.paths)
					area_paths.push(path)

			// the side p-q of an area path has the outside of the floor's
			// outlines next to its middle.
			let outline_paths = add_outline_paths(floor, [])
			function is_eave_side(p, q) {
				let x = round((p.x + q.x) / 2) + sign(q.y - p.y)
				let y = round((p.y + q.y) / 2) - sign(q.x - p.x)
				for (let path of outline_paths)
					if (pointInPolygon({x: x, y: y}, path)
						!= PointInPolygonResult.IsOutside)
						return false
				return true
			}

			let edge_point_by_side = map() // {'path_i i' -> edge_point|null if 2+}
			for (let edge_point of roof.edge_points) {
				let x = edge_point.x * scale
				let y = edge_point.y * scale
				let min_d = 1/0
				let min_key
				for (let path_i = 0; path_i < area_paths.length; path_i++) {
					let path = area_paths[path_i]
					for (let i = 0, n = path.length; i < n; i++) {
						let p = path[i]
						let q = path[(i+1) % n]
						if (!is_eave_side(p, q))
							continue
						let dx = max(min(p.x, q.x) - x, 0, x - max(p.x, q.x))
						let dy = max(min(p.y, q.y) - y, 0, y - max(p.y, q.y))
						let d = dx * dx + dy * dy
						if (d >= min_d)
							continue
						min_d = d
						min_key = path_i+' '+i
					}
				}
				edge_point_by_side.set(min_key,
					edge_point_by_side.has(min_key) ? null : edge_point)
			}

			// the perimeter, on prism_union()'s grid: the outlines, a strip
			// `overhang` deep outside each side that moves, and a square at
			// each outside corner between two sides that move. a sloped side
			// moves. a gable side moves only with outside corners at both
			// ends: at an inside corner, its line bounds the faces inside the
			// house. outlines closer than twice the overhang merge.
			let paths = []
			let sides = [] // [{nx, ny, c, m1, m2, d, pitch}, ...]
				// n: outward normal, c: moved line, m1..m2: extent, d: move.
			// the corner at path[i] of a ccw path is an outside corner.
			function is_convex(path, i) {
				let n = path.length
				let p0 = path[(i+n-1) % n]
				let p1 = path[i]
				let p2 = path[(i+1) % n]
				return (p1.x - p0.x) * (p2.y - p1.y)
					- (p1.y - p0.y) * (p2.x - p1.x) > 0
			}
			for (let path_i = 0; path_i < area_paths.length; path_i++) {
				let path = area_paths[path_i]
				paths.push(path)
				let n = path.length
				let ring_sides = []
				for (let i = 0; i < n; i++) {
					let p = path[i]
					let q = path[(i+1) % n]
					let is_eave = is_eave_side(p, q)
					let pitch = is_eave
						? edge_point_by_side.get(path_i+' '+i)?.pitch ?? roof.pitch
						: 90
					let is_moving = is_eave && (pitch != 90
						|| is_convex(path, i) && is_convex(path, (i+1) % n))
					let d = is_moving ? round(roof.overhang * scale) : 0
					let nx = sign(q.y - p.y)
					let ny = -sign(q.x - p.x)
					let is_v = p.x == q.x
					ring_sides.push({
						nx: nx,
						ny: ny,
						c: is_v ? p.x + nx * d : p.y + ny * d,
						m1: is_v ? min(p.y, q.y) : min(p.x, q.x),
						m2: is_v ? max(p.y, q.y) : max(p.x, q.x),
						d: d,
						pitch: pitch,
					})
				}
				for (let i = 0; i < n; i++) {
					let p = path[i]
					let q = path[(i+1) % n]
					let {nx, ny, d} = ring_sides[i]
					if (d) // ccw strip.
						paths.push([p, {x: p.x + nx * d, y: p.y + ny * d},
							{x: q.x + nx * d, y: q.y + ny * d}, q])
					let side0 = ring_sides[(i+n-1) % n]
					if (d && side0.d && is_convex(path, i)) { // ccw square.
						let dx0 = side0.nx * side0.d
						let dy0 = side0.ny * side0.d
						paths.push([p, {x: p.x + dx0, y: p.y + dy0},
							{x: p.x + dx0 + nx * d, y: p.y + dy0 + ny * d},
							{x: p.x + nx * d, y: p.y + ny * d}])
					}
				}
				for (let side of ring_sides)
					sides.push(side)
			}
			// the sides of the floor above, facing into it: where a strip ends
			// at its wall, the perimeter side there is on its outline.
			if (floor1) {
				for (let path of add_outline_paths(floor1, [])) {
					for (let i = 0, n = path.length; i < n; i++) {
						let p = path[i]
						let q = path[(i+1) % n]
						let is_v = p.x == q.x
						sides.push({
							nx: -sign(q.y - p.y),
							ny: sign(q.x - p.x),
							c: is_v ? p.x : p.y,
							m1: is_v ? min(p.y, q.y) : min(p.x, q.x),
							m2: is_v ? max(p.y, q.y) : max(p.x, q.x),
							d: 0,
							pitch: 90,
						})
					}
				}
			}
			let {Clipper64, PolyTree64, ClipType, FillRule} = clipper2
			let clipper = new Clipper64()
			clipper.addSubject(paths) // keeps the points where strips end.
			let tree = new PolyTree64()
			clipper.execute(ClipType.Union, FillRule.NonZero, tree)

			// the area side or the side of the floor above that a perimeter
			// side came from: on its moved line, facing the same way, nearest
			// along the line.
			function find_side(a, b) {
				let is_v = a.x == b.x
				let nx = sign(b.y - a.y)
				let ny = -sign(b.x - a.x)
				let c = is_v ? a.x : a.y
				let m = is_v ? (a.y + b.y) / 2 : (a.x + b.x) / 2
				let min_d = 1/0
				let found_side
				for (let side of sides) {
					if (side.nx != nx || side.ny != ny || side.c != c)
						continue
					let d = max(side.m1 - m, 0, m - side.m2)
					if (d >= min_d)
						continue
					min_d = d
					found_side = side
				}
				return assert(found_side)
			}

			let faces = []
			for (let group of add_path_groups(tree, [])) {
				let group_rings = []
				let pitches = []
				let eave_zs = []
				for (let path of group) {
					let ring = []
					for (let i = 0, n = path.length; i < n; i++) {
						let p = path[i]
						let {pitch, d} = find_side(p, path[(i+1) % n])
						ring.push([p.x / scale, p.y / scale])
						pitches.push(pitch)
						eave_zs.push(pitch == 90 ? wall_z
							: wall_z - d / scale * tan(pitch * rad))
					}
					group_rings.push(ring)
				}
				for (let face of roof_skeleton(group_rings, pitches, eave_zs))
					faces.push(face)
			}
			return faces
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
				room_points: copy_room_points(floor.room_points),
				area_points: copy_area_points(floor.area_points),
				roof: copy_roof(floor.roof)}
		}

		floor.load_state = function(state) {
			floor.load(state.points, state.lines)
			floor.room_points = copy_room_points(state.room_points)
			floor.area_points = copy_area_points(state.area_points)
			floor.roof = copy_roof(state.roof)
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
		pop_log()

		return floor
	}

	// walls and slabs --------------------------------------------------------

	// The code builds the walls and slabs of the house as prisms and fuses
	// them into faces with prism_union(). A floor's walls stand on its slab;
	// their plan region is the even-odd fill of all the floor's skins: the
	// outlines minus the rooms plus the islands minus their rooms. Slab i is
	// at the bottom of floor i, under the outlines of floors i-1 and i,
	// except under the open rooms of floor i over the rooms of floor i-1
	// and under the roofs of floor i-1. The islands of an open room are not
	// in the room. Each floor has a roof over the parts of its outlines that
	// the floor above leaves uncovered, except over terraces. The roof bodies
	// cut the walls and slabs under them. A floor's walls under its roof
	// rise to the roof underside. The top floor's terraces get a slab on top.

	// add a plan ring of [x, y] points to clipper paths on prism_union()'s
	// grid.
	function add_ring_path(paths, ring) {
		let scale = prism_union.grid_scale
		let path = []
		for (let [x, y] of ring)
			path.push({x: round(x * scale), y: round(y * scale)})
		paths.push(path)
		return paths
	}

	// add the polygons of a clipper PolyTree64 to `groups` as
	// [outline, hole, ...], islands as groups of their own.
	function add_path_groups(node, groups) {
		for (let i = 0; i < node.count; i++) {
			let outline = node.child(i)
			let group = [outline.polygon]
			for (let j = 0; j < outline.count; j++) {
				let hole = outline.child(j)
				group.push(hole.polygon)
				add_path_groups(hole, groups) // islands
			}
			groups.push(group)
		}
		return groups
	}

	function add_outline_paths(floor, paths) {
		for (let comp of floor) // root comps: islands are inside them.
			add_ring_path(paths, comp.outer_cycle.edges)
		return paths
	}

	function add_skin_paths(floor, paths) {
		for (let comp of floor.comps)
			for (let c of comp.cycles)
				add_ring_path(paths, c.edges)
		return paths
	}

	function add_open_room_paths(floor, paths) {
		for (let [c, room_point] of floor.room_point_by_cycle) {
			if (!room_point?.is_open)
				continue
			add_ring_path(paths, c.edges)
			for (let comp of c.islands)
				add_ring_path(paths, comp.outer_cycle.edges)
		}
		return paths
	}

	// grid paths of the slab between floor0 below, which can be null, and
	// floor1 above. roof_paths0: the grid paths of floor0's roof areas.
	function slab_paths(floor0, floor1, roof_paths0) {
		let {union, intersect, difference, FillRule} = clipper2
		let EO = FillRule.EvenOdd
		let paths
		if (!floor0) {
			paths = add_outline_paths(floor1, [])
		} else {
			let outline0 = add_outline_paths(floor0, [])
			let outline1 = add_outline_paths(floor1, [])
			let rooms0 = difference(outline0, add_skin_paths(floor0, []), EO)
			let open_rooms = intersect(add_open_room_paths(floor1, []), rooms0,
				EO)
			paths = difference(union(outline0, outline1, EO),
				[...open_rooms, ...roof_paths0], EO)
		}
		return paths
	}

	// make the faces of the walls, slabs and roofs of floors 0..top_floor,
	// tagged 'walls' (walls and slabs) and 'roof'.
	// no_roof: leave out top_floor's roofs and terraces.
	house.make_faces = function(top_floor, no_roof) {
		let prisms = []
		let slab_t = house.slab_thickness
		let floors = house.floors
		let floor_n = top_floor.i + 1
		let {intersect, difference, FillRule} = clipper2
		let EO = FillRule.EvenOdd

		// areas: the roof areas of each floor; the terraces of top_floor.
		let roof_paths_by_floor = [] // [[path, ...], ...] grid paths
		let roof_faces_by_floor = [] // [faces, ...]
		let terrace_paths = [] // grid paths of top_floor's terraces
		for (let floor_i = 0; floor_i < floor_n; floor_i++) {
			let floor = floors[floor_i]
			let roof_areas = []
			let roof_paths = []
			if (!(floor == top_floor && no_roof)) {
				for (let area of floor.make_areas()) {
					if (area.kind == 'roof') {
						roof_areas.push(area)
						for (let path of area.paths)
							roof_paths.push(path)
					} else if (floor == top_floor) {
						for (let path of area.paths)
							terrace_paths.push(path)
					}
				}
			}
			roof_paths_by_floor.push(roof_paths)
			roof_faces_by_floor.push(roof_areas.length
				? floor.make_roof_faces(roof_areas) : [])
		}

		// walls: from the top of the floor's slab to the top of the floor.
		// under the floor's roofs: up to their highest point, so the roof
		// bodies cut them to the roof underside.
		for (let floor_i = 0; floor_i < floor_n; floor_i++) {
			let floor = floors[floor_i]
			let skin_paths = add_skin_paths(floor, [])
			let roof_paths = roof_paths_by_floor[floor_i]
			let bottom = [0, 0, floor.z + slab_t]
			let top = [0, 0, floor.z + floor.h]
			if (roof_paths.length) {
				let roof_z = -1/0
				for (let face of roof_faces_by_floor[floor_i]) {
					let [a, b, c] = face.plane
					for (let ring of face.rings)
						for (let [x, y] of ring)
							roof_z = max(roof_z, a * x + b * y + c)
				}
				prisms.push({
					paths: intersect(skin_paths, roof_paths, EO),
					bottom: bottom,
					top: [0, 0, roof_z],
					tag: 'walls',
				})
				prisms.push({
					paths: difference(skin_paths, roof_paths, EO),
					bottom: bottom,
					top: top,
					tag: 'walls',
				})
			} else {
				prisms.push({
					paths: skin_paths,
					bottom: bottom,
					top: top,
					tag: 'walls',
				})
			}
		}

		// slabs: slab i is at the bottom of floor i.
		for (let i = 0; i < floor_n; i++) {
			let floor = floors[i]
			prisms.push({
				paths: slab_paths(floors[i-1], floor, roof_paths_by_floor[i-1]),
				bottom: [0, 0, floor.z],
				top: [0, 0, floor.z + slab_t],
				tag: 'walls',
			})
		}

		// terraces of top_floor: a slab on top of it.
		if (terrace_paths.length) {
			let z = top_floor.z + top_floor.h
			prisms.push({
				paths: terrace_paths,
				bottom: [0, 0, z],
				top: [0, 0, z + slab_t],
				tag: 'walls',
			})
		}

		// roofs: one body per roof face, with the face on top, roof_thickness
		// thick at right angles to it. the roof cuts the walls and slabs under
		// it. where faces of different pitches meet, the underside has a step.
		let roof_t = house.roof_thickness
		for (let roof_faces of roof_faces_by_floor) {
			for (let face of roof_faces) {
				let [a, b, c] = face.plane
				let paths = []
				for (let ring of face.rings)
					add_ring_path(paths, ring)
				prisms.push({
					paths: paths,
					bottom: [a, b, c - roof_t * sqrt(1 + a * a + b * b)],
					top: face.plane,
					tag: 'roof',
					is_cutter: true,
				})
			}
		}

		return prism_union(prisms)
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

	function init(t) {

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
	init(t)

	// history ---------------------------------------------------------------

	let undo_stack = []
	let redo_stack = []

	// the live settings and floors of the house, for the load undo entry.
	// the entry keeps the floor objects so that older entries stay valid.
	function take_state() {
		let state = {floors: house.floors}
		for (let k in defaults)
			state[k] = house[k]
		return state
	}

	function put_state(state) {
		assign(house, state)
		fix_floor_heights()
		house.bb = house_bb()
		fix_snap_lines()
	}

	// replace the settings and floors with a save_state() result, as one edit.
	// on a bad state: restore the old state, rethrow.
	house.load_state = function(state) {
		assert(!edit0)
		let state0 = take_state()
		try {
			init(state)
		} catch (e) {
			put_state(state0)
			throw e
		}
		undo_stack.push({op: 'load', state: state0})
		redo_stack.length = 0
		house.edit_no++
	}

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
		} else if (op == 'load') {
			let state = take_state()
			put_state(entry.state)
			return {op: 'load', state: state}
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
