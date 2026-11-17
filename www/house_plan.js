(function () {
"use strict"
const G = window

const {
	round, mod, abs, sign, min, max, clamp, sqrt, tan, atan, sin, cos, rad,
	assert, log, push_log, pop_log, push_log_if,
	insert, remove_value, uniq_sorted, map, assign, clock, json,
	profile_time, empty_array,
} = glue

const {bbox2, poly2} = Math3D

G.DEBUG_PLAN = 0
G.DEBUG_PLAN_LOAD = 1

// house model ---------------------------------------------------------------

// everything is in mm!
let defaults = {
	floor_h: 2500,
	int_wall_thickness: 80,
	ext_wall_thickness: 180,
	slab_thickness: 200,
	roof_thickness: 200, // at right angles to the roof
	half_wall_h: 1000, // of the half-walls around terraces, above the slab
}

// the state version: states without a version are in cm.
const STATE_VERSION = 1

function cm_to_mm(x) {
	return x == null ? x : x * 10
}

// the state of an older house, in cm, as a state in mm.
function scale_cm_state(t) {
	let t1 = {...t, version: STATE_VERSION}
	delete t1.precision
	delete t1.rotation
	for (let k in defaults)
		if (t[k] != null)
			t1[k] = cm_to_mm(t[k])
	if (!t.floors)
		return t1
	t1.floors = []
	for (let floor of t.floors) {
		let floor1 = {...floor, h: cm_to_mm(floor.h)}
		if (floor.points) {
			floor1.points = []
			for (let [x, y, id] of floor.points)
				floor1.points.push([cm_to_mm(x), cm_to_mm(y), id])
		}
		if (floor.roof) {
			let roof = floor.roof
			floor1.roof = {...roof, overhang: cm_to_mm(roof.overhang),
				eave_h: cm_to_mm(roof.eave_h),
				max_overhang: cm_to_mm(roof.max_overhang)}
			if (roof.edge_points) {
				floor1.roof.edge_points = []
				for (let edge_point of roof.edge_points)
					floor1.roof.edge_points.push({...edge_point,
						x: cm_to_mm(edge_point.x), y: cm_to_mm(edge_point.y),
						overhang: cm_to_mm(edge_point.overhang),
						eave_h: cm_to_mm(edge_point.eave_h)})
			}
		}
		t1.floors.push(floor1)
	}
	return t1
}

function poly_get_point(i, out) {
	out[0] = this[i][0]
	out[1] = this[i][1]
	return out
}

function house_plan(t) {

	let t0 = profile_time()

	let house = {}
	let edit0
	let edit0_ground_objects // house.ground_objects at the start of the edit
	let edit0_floor1_objects // the floor above's objects at the start, if any
	house.edit_no = 0 // increments on each committed edit, undo and redo
	house.roof_geometry_no = 0 // includes changes during drag previews

	function snap_length(x) {
		return x == null ? x : round(x)
	}

	function copy_roof(roof) {
		roof ??= {pitch: 20}
		let edge_points = []
		for (let edge_point of roof.edge_points ?? [])
			edge_points.push({x: snap_length(edge_point.x),
				y: snap_length(edge_point.y), pitch: edge_point.pitch,
				overhang: snap_length(edge_point.overhang),
				eave_h: snap_length(edge_point.eave_h)})
		return {pitch: roof.pitch, overhang: snap_length(roof.overhang ?? 600),
			eave_h: snap_length(roof.eave_h ?? -220),
			max_overhang: snap_length(roof.max_overhang ?? 1500),
			edge_points: edge_points}
	}

	function copy_objects(objects) {
		let a = []
		for (let object of objects) {
			let object_type = assert(house_object_types[object.type],
				'unknown object type: ', object.type)
			let object1 = {
				type: object.type,
				x: snap_length(object.x),
				y: snap_length(object.y),
				rot: object.rot,
				w: snap_length(object.w ?? object_type.w),
			}
			for (let name in object_type.fields)
				object1[name] = object[name] ?? object_type.fields[name]
			a.push(object1)
		}
		return a
	}

	// the size nearest to `size` in `sizes`, a type's w_list or l_list or its
	// w_range, that is at most max_size, or null if none is.
	function snap_object_size(sizes, size, max_size) {
		if (Array.isArray(sizes)) {
			let size1 = null
			for (let size2 of sizes)
				if (size2 <= max_size
					&& (size1 == null || abs(size2 - size) < abs(size1 - size))
				)
					size1 = size2
			return size1
		}
		let range = sizes
		size = clamp(size, range.min, range.max ?? Infinity)
		let size1 = range.min
			+ round((size - range.min) / range.step) * range.step
		if (size1 > max_size)
			size1 = range.min
				+ Math.floor((max_size - range.min) / range.step) * range.step
		return size1 < range.min ? null : size1
	}

	// add one object to the ground for each type that has none there. each
	// goes in its type's place in a row, in the top third of the initial view
	// of an empty plan. copy_objects adds the type's width and fields.
	function replenish_ground_objects() {
		let ground_types = new Set()
		for (let object of house.ground_objects)
			ground_types.add(object.type)
		let x = -750
		for (let type in house_object_types) {
			if (!ground_types.has(type))
				house.ground_objects.push(copy_objects(
					[{type: type, x: x, y: -2000, rot: 0}])[0])
			x += 1500
		}
	}

	// the saved state of an object, for copying it.
	house.save_object = function(object) {
		return copy_objects([object])[0]
	}

	house.save_state = function() {
		let floors = []
		for (let floor of house.floors) {
			let state = floor.save_state()
			state.h = floor.fixed_h
			floors.push(state)
		}
		return {
			version: STATE_VERSION,
			floor_h: house.floor_h,
			int_wall_thickness: house.int_wall_thickness,
			ext_wall_thickness: house.ext_wall_thickness,
			slab_thickness: house.slab_thickness,
			roof_thickness: house.roof_thickness,
			half_wall_h: house.half_wall_h,
			ground_objects: copy_objects(house.ground_objects),
			floors: floors,
		}
	}

	function begin_edit(floor) {
		assert(!edit0)
		edit0 = floor.save_state()
		edit0_ground_objects = copy_objects(house.ground_objects)
		let floor1 = house.floors[floor.i+1]
		edit0_floor1_objects = floor1 && copy_objects(floor1.objects)
	}

	// the floor above's objects depend on this floor (terraces): placed
	// again, and part of the edit.
	function commit_edit(floor) {
		assert(edit0)
		let floor1 = house.floors[floor.i+1]
		floor1?.fix_objects()
		if (json(floor.save_state()) != json(edit0)
			|| json(copy_objects(house.ground_objects))
				!= json(edit0_ground_objects)
			|| floor1 && json(copy_objects(floor1.objects))
				!= json(edit0_floor1_objects)
		) {
			undo_stack.push({
				op: 'edit',
				floor: floor,
				state: edit0,
				ground_objects: edit0_ground_objects,
				floor1_objects: edit0_floor1_objects,
			})
			redo_stack.length = 0
			house.edit_no++
			house.roof_geometry_no++ // terrace tags moved: other roof areas.
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
		// {pitch:, overhang:, eave_h:, max_overhang:,
		// edge_points: [{x:, y:, pitch:, overhang:, eave_h:}, ...]}
		// overhang: of gables. eave_h: eave height of sloped sides above the
		// wall top (<= 0). max_overhang: of sloped sides: past it, the eave is
		// higher. edge point pitch, overhang, eave_h: null = the roof's.
		floor.roof = copy_roof(t.roof)
		floor.i = floor_i
		floor.id = 'floor'+floor_i
		floor.h = snap_length(t.h ?? house.floor_h)
		floor.fixed_h = snap_length(t.h)
		floor.bb = bbox2()
		floor.open_rooms = new Set() // {cycle} rooms with an open_room tag
		// [{type:, x:, y:, rot:, w:, seg:}, ...] objects on this floor's walls
		floor.objects = copy_objects(t.objects ?? [])
		let wall_geometry

		floor.room_rings = [] // [edges, ...] room faces: free space on the left

		floor._after_fix = function() {
			create_edges()
			fix_snap_lines()
			fix_objects()
		}

		// the segs changed: place each object again where it is, in order, so
		// it fits around the ones placed before it. no wall: to the ground.
		function fix_objects() {
			let objects = floor.objects
			for (let object of objects)
				object.seg = null
			let i = 0
			while (i < objects.length) {
				let object = objects[i]
				house_object_types[object.type].place(floor, object,
					object.x, object.y, 0)
				if (object.on_floor) {
					i++
				} else {
					objects.splice(i, 1)
					house.ground_objects.push(object)
				}
			}
		}
		floor.fix_objects = fix_objects

		// the faces of the walls along cycle c, offset by d: on each seg, the
		// across coordinate of the face on the side that c walks: seg.wall_a1
		// (the lower one) or seg.wall_a2; on each point, the largest offset
		// around it.
		function set_cycle_offsets(c, d) {
			let n = c.length
			for (let i = 0; i < n; i++) {
				let p0 = c[i]
				let p1 = c[(i+1) % n]
				p0.max_offset = max(p0.max_offset, abs(d))
				for (let seg of p0.segs) {
					if (seg[0] != p1 && seg[1] != p1)
						continue
					// walking up or right: the lower face.
					let is_a1 = seg.is_v ? p1[1] < p0[1] : p1[0] > p0[0]
					if (is_a1)
						seg.wall_a1 = seg.axis + d
					else
						seg.wall_a2 = seg.axis - d
					break
				}
			}
		}

		function create_edges() {

			wall_geometry = null

			for (let p of floor.ps)
				p.max_offset = 0
			floor.room_rings.length = 0

			let t_int = house.int_wall_thickness
			let t_ext = house.ext_wall_thickness
			let o_int = t_int / 2
			let o_ext = t_ext - o_int

			for (let comp of floor.comps) {
				for (let c of comp.cycles) {
					c.invalidate()
					let edges = poly2()
					edges.get_point = poly_get_point
					let d = c.outer ? (c.comp.inside ? -o_int : -o_ext) : -o_int
					c.edges = c.offset(d, edges)
					set_cycle_offsets(c, d)

					// the faces of an inner cycle or of an island face a room.
					if (!c.outer || c.comp.inside)
						floor.room_rings.push(c.edges)
				}
			}

			// on each seg, the along coordinates seg.wall_m1 < seg.wall_m2 of
			// the wall that no perpendicular wall at its ends covers.
			for (let seg of floor.segs) {
				let is_v = seg.is_v
				seg.wall_m1 = seg.m1
				seg.wall_m2 = seg.m2
				for (let seg1 of seg[seg.i1].segs)
					if (seg1.is_v != is_v)
						seg.wall_m1 = max(seg.wall_m1, seg1.wall_a2)
				for (let seg1 of seg[seg.i2].segs)
					if (seg1.is_v != is_v)
						seg.wall_m2 = min(seg.wall_m2, seg1.wall_a1)
			}

			// compute the level plan bbox now that we have outer skins.
			floor.bb.reset()
			for (let co of floor.comps)
				floor.bb.add_bbox2(...co.outer_cycle.edges.bbox())

			// recompute house plan bbox.
			house.bb = house_bb()

			fix_open_rooms()
			house.roof_geometry_no++

		}

		floor.make_wall_geometry = function() {
			if (!wall_geometry) {
				let t0 = profile_time()
				let {intersect, difference, FillRule} = clipper2
				let EO = FillRule.EvenOdd
				let uncut_wall_paths = add_skin_paths(floor, [])
				let cut_wall_paths = uncut_wall_paths
				let hole_groups = make_hole_groups(floor)
				let hole_paths = []
				for (let group of hole_groups) {
					for (let path of group.paths)
						hole_paths.push(path)
					group.paths = intersect(cut_wall_paths, group.paths, EO)
				}
				if (hole_groups.length)
					cut_wall_paths = difference(cut_wall_paths, hole_paths, EO)
				wall_geometry = {
					cut_wall_paths: cut_wall_paths,
					uncut_wall_paths: uncut_wall_paths,
					hole_groups: hole_groups,
				}
				profile_time('wall.openings', t0)
			}
			return wall_geometry
		}

		// rooms ---------------------------------------------------------------

		// a room is open if it holds an open-room tag.
		function fix_open_rooms() {
			floor.open_rooms.clear()
			for (let object of floor.objects) {
				if (!house_object_types[object.type].opens_room)
					continue
				let c = floor.hit_cycle_edges(object.x, object.y)
				if (!c) // in a wall body or outside: no room.
					continue
				floor.open_rooms.add(c)
			}
		}

		// roof areas ----------------------------------------------------------

		// the parts of the floor's outlines that the floor above leaves
		// uncovered, one per connected part: [{paths, kind}, ...]. paths: on
		// prism_union()'s grid, the outline first, then its holes. kind:
		// 'terrace' if a terrace tag of the floor above is inside the area,
		// else 'roof'.
		floor.make_areas = function() {
			let t0 = profile_time()
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
				let is_terrace = false
				for (let object of floor1?.objects ?? empty_array) {
					if (!house_object_types[object.type].marks_terrace)
						continue
					let p = {
						x: round(object.x * scale),
						y: round(object.y * scale),
					}
					if (pointInPolygon(p, group[0]) != IsInside)
						continue
					let in_hole = false
					for (let i = 1; i < group.length; i++)
						if (pointInPolygon(p, group[i]) != IsOutside)
							in_hole = true
					if (in_hole)
						continue
					is_terrace = true
				}
				areas.push({
					paths: group,
					kind: is_terrace ? 'terrace' : 'roof',
				})
			}
			profile_time('roof.areas', t0)
			return areas
		}

		// the half-walls that stand on the floor above around the floor's
		// terraces: the floor's exterior walls inside terrace_areas (areas from
		// make_areas() of kind 'terrace'), as grid paths.
		floor.make_half_wall_paths = function(terrace_areas) {
			let {intersect, FillRule} = clipper2
			let EO = FillRule.EvenOdd
			let o_int = house.int_wall_thickness / 2
			let wall_paths = [] // each outline's outer face and inner face
			for (let comp of floor) { // root comps: islands are inside them.
				let c = comp.outer_cycle
				let inner_edges = poly2()
				inner_edges.get_point = poly_get_point
				add_ring_path(wall_paths, c.edges)
				add_ring_path(wall_paths, c.offset(o_int, inner_edges))
			}
			let terrace_paths = []
			for (let area of terrace_areas)
				for (let path of area.paths)
					terrace_paths.push(path)
			return intersect(wall_paths, terrace_paths, EO)
		}

		// roof faces ----------------------------------------------------------

		// the faces of the roof over the floor's roof areas, as returned by
		// roof_skeleton(). roof_areas: areas from make_areas(). an area's
		// side next to the outside of the floor's outlines is an eave side;
		// its other sides run along the walls of the floor above: vertical,
		// they don't move. the roof's edges are the sides of its perimeter:
		// the eave sides moved outward by their overhang. an edge point sets
		// the pitch, overhang and eave height of the nearest eave side. two or
		// more points on one side: the roof's, like room points. the faces are
		// the roof's top. each sloped side's plane passes through the floor's
		// top on the outer skin, so its overhang is the eave height over the
		// slope, up to max_overhang; past it, the eave is higher.
		// eave_sides: optional array that receives the eave sides:
		// [{nx, ny, c, wall_c, m1, m2, e1, e2, d, pitch, eave_z, is_eave,
		// edge_point, is_only_slope}, ...] on the grid, see `sides`;
		// edge_point: none, or null if 2+; is_only_slope: the only sloped eave
		// side of its area.
		// each face also gets `sides`: the eave sides in its plane.
		// shared_edges: optional array, as in roof_skeleton().
		floor.make_roof_faces = function(roof_areas, eave_sides, shared_edges) {
			let t0 = profile_time()
			let roof = floor.roof
			let wall_z = floor.z + floor.h
			let scale = prism_union.grid_scale
			let {pointInPolygon, PointInPolygonResult} = clipper2

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

			let sides = [] // [{nx, ny, c, wall_c, m1, m2, e1, e2, d, pitch,
				// is_eave, edge_point}, ...] n: outward normal, c: moved line,
				// wall_c: wall line, m1..m2: extent, e1..e2: extent of the moved
				// line, d: move.
			let sides_by_path = [] // [[side, ...], ...] per area path
			for (let area of roof_areas)
				for (let path of area.paths) {
					let ring_sides = []
					for (let i = 0, n = path.length; i < n; i++) {
						let p = path[i]
						let q = path[(i+1) % n]
						let is_v = p.x == q.x
						let side = {
							nx: sign(q.y - p.y),
							ny: -sign(q.x - p.x),
							wall_c: is_v ? p.x : p.y,
							m1: is_v ? min(p.y, q.y) : min(p.x, q.x),
							m2: is_v ? max(p.y, q.y) : max(p.x, q.x),
							is_eave: is_eave_side(p, q),
							edge_point: undefined,
						}
						ring_sides.push(side)
						sides.push(side)
					}
					sides_by_path.push(ring_sides)
				}

			for (let edge_point of roof.edge_points) {
				let x = edge_point.x * scale
				let y = edge_point.y * scale
				let min_d = 1/0
				let found_side
				for (let side of sides) {
					if (!side.is_eave)
						continue
					let dx = side.nx ? abs(side.wall_c - x)
						: max(side.m1 - x, 0, x - side.m2)
					let dy = side.nx ? max(side.m1 - y, 0, y - side.m2)
						: abs(side.wall_c - y)
					let d = dx * dx + dy * dy
					if (d >= min_d)
						continue
					min_d = d
					found_side = side
				}
				if (found_side)
					found_side.edge_point = found_side.edge_point !== undefined
						? null : edge_point
			}

			// the perimeter, on prism_union()'s grid: the outlines, a strip
			// `overhang` deep outside each side that moves, and a square at
			// each outside corner between two sides that move. a sloped side
			// moves. a gable side moves only with outside corners at both
			// ends: at an inside corner, its line bounds the faces inside the
			// house. outlines closer than twice the overhang merge.
			let paths = []
			// the corner at path[i] of a ccw path is an outside corner.
			function is_convex(path, i) {
				let n = path.length
				let p0 = path[(i+n-1) % n]
				let p1 = path[i]
				let p2 = path[(i+1) % n]
				return (p1.x - p0.x) * (p2.y - p1.y)
					- (p1.y - p0.y) * (p2.x - p1.x) > 0
			}
			let path_i = 0
			for (let area of roof_areas) {
				let only_sloped_side
				for (let path of area.paths) {
					paths.push(path)
					let n = path.length
					let ring_sides = sides_by_path[path_i++]
					for (let i = 0; i < n; i++) {
						let side = ring_sides[i]
						let {nx, ny, wall_c, is_eave, edge_point} = side
						let pitch = is_eave ? edge_point?.pitch ?? roof.pitch : 90
						let is_moving = is_eave && (pitch != 90
							|| is_convex(path, i) && is_convex(path, (i+1) % n))
						let d
						let eave_z
						if (pitch == 90) {
							let overhang = edge_point?.overhang ?? roof.overhang
							d = is_moving ? round(overhang * scale) : 0
							eave_z = wall_z
						} else {
							// level eaves: the overhang follows the pitch.
							let slope = tan(pitch * rad)
							let eave_h = edge_point?.eave_h ?? roof.eave_h
							let overhang = -eave_h / slope // pitch 0: inf.
							if (overhang < roof.max_overhang) {
								d = round(overhang * scale)
								eave_z = wall_z + eave_h
							} else {
								d = round(roof.max_overhang * scale)
								eave_z = wall_z - roof.max_overhang * slope
							}
						}
						side.c = wall_c + (nx + ny) * d
						side.d = d
						side.pitch = pitch
						side.eave_z = eave_z
						if (is_eave)
							eave_sides?.push(side)
						if (is_eave && pitch != 90)
							only_sloped_side = only_sloped_side === undefined
								? side : null
					}
					// the ends of each side's moved line: where its neighbor's
					// moved line crosses it; a collinear neighbor: the side's
					// corner.
					for (let i = 0; i < n; i++) {
						let side = ring_sides[i]
						let side0 = ring_sides[(i+n-1) % n]
						let side1 = ring_sides[(i+1) % n]
						let is_v = !!side.nx
						let p = path[i]
						let q = path[(i+1) % n]
						let e0 = !!side0.nx != is_v ? side0.c : is_v ? p.y : p.x
						let e1 = !!side1.nx != is_v ? side1.c : is_v ? q.y : q.x
						side.e1 = min(e0, e1)
						side.e2 = max(e0, e1)
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
				}
				if (only_sloped_side)
					only_sloped_side.is_only_slope = true
			}
			let {Clipper64, PolyTree64, ClipType, FillRule} = clipper2
			let clipper = new Clipper64()
			clipper.addSubject(paths) // keeps the points where strips end.
			let tree = new PolyTree64()
			clipper.execute(ClipType.Union, FillRule.NonZero, tree)

			// the area side that a perimeter side came from: on its moved line,
			// facing the same way, nearest along the line. none: a vertical
			// side, like the end of a strip on the perimeter or a side along
			// the floor above's wall.
			let vertical_side = {pitch: 90, d: 0}
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
				return found_side ?? vertical_side
			}

			let faces = []
			for (let group of add_path_groups(tree, [])) {
				let group_rings = []
				let pitches = []
				let eave_zs = []
				let edge_sides = [] // [side, ...] per edge, like pitches
				for (let path of group) {
					let ring = []
					for (let i = 0, n = path.length; i < n; i++) {
						let p = path[i]
						let side = find_side(p, path[(i+1) % n])
						let {pitch, eave_z} = side
						ring.push([p.x / scale, p.y / scale])
						pitches.push(pitch)
						eave_zs.push(pitch == 90 ? wall_z : eave_z)
						edge_sides.push(side)
					}
					group_rings.push(ring)
				}
				let roof_faces = roof_skeleton(group_rings, pitches, eave_zs,
					shared_edges)
				for (let face of roof_faces) {
					face.sides = [] // [side, ...] eave sides in the face's plane
					for (let edge_i of face.edge_is)
						if (!face.sides.includes(edge_sides[edge_i]))
							face.sides.push(edge_sides[edge_i])
					faces.push(face)
				}
			}
			profile_time('roof.faces', t0)
			return faces
		}

		// roof editing --------------------------------------------------------

		// the point on the wall line of an eave side from make_roof_faces()
		// across from the plan point (x, y): an edge point there maps back to
		// that side.
		function wall_point(side, x, y) {
			let c = side.wall_c / prism_union.grid_scale
			return {x: snap_length(side.nx ? c : x),
				y: snap_length(side.nx ? y : c)}
		}

		// two or more points on the eave side, or the area's only sloped
		// side: no toggle, so the area keeps a roof.
		floor.can_toggle_gable = function(side) {
			return side.edge_point !== null && !side.is_only_slope
		}

		// no edge point on the eave side: add a gable point across from
		// (x, y). one point: switch it between gable and the roof's pitch.
		floor.toggle_gable = function(side, x, y) {
			if (!floor.can_toggle_gable(side))
				return
			let edge_point = side.edge_point
			begin_edit(floor)
			if (edge_point) {
				edge_point.pitch = edge_point.pitch == 90 ? null : 90
			} else {
				edge_point = wall_point(side, x, y)
				edge_point.pitch = 90
				floor.roof.edge_points.push(edge_point)
			}
			house.roof_geometry_no++
			commit_edit(floor)
		}

		floor.remove_edge_point = function(edge_point) {
			begin_edit(floor)
			remove_value(floor.roof.edge_points, edge_point)
			house.roof_geometry_no++
			commit_edit(floor)
		}

		// the line or point where the faces from make_roof_faces() meet:
		// clear the own pitch of each of their sides, so the faces take the
		// roof's pitch. a side with two or more edge points has the roof's.
		floor.reset_faces = function(faces) {
			begin_edit(floor)
			for (let face of faces)
				for (let side of face.sides)
					if (side.edge_point)
						side.edge_point.pitch = null
			house.roof_geometry_no++
			commit_edit(floor)
		}

		// move the eave side outward or inward. a gable: all gables by the
		// same distance (the roof's overhang and every edge point's own). a
		// sloped side: all eave heights by the same height (the roof's and
		// every edge point's own), the side's change. with is_one, only the
		// side's own, in its edge point (added across from (x, y) if none).
		// is_one can change from one move to the next. a sloped side's
		// overhang stays within 0..max_overhang and no eave rises above the
		// wall top. a move with is_one on a side with two or more points (no
		// own values) leaves the start values and returns false. with is_one,
		// within snap_d the eave line snaps to a position in snap_cs ([c, ...]
		// across the side, in plan units) and to the roof's value, which
		// removes the side's own.
		floor.start_move_eave = function(side, x, y, snap_cs) {
			begin_edit(floor)
			let roof0 = edit0.roof
			let scale = prism_union.grid_scale
			let edge_point_i = floor.roof.edge_points.indexOf(side.edge_point)
			let s = {}
			s.move = function(dx, dy, is_one, snap_d) {
				// each move starts from the roof as it was at the start.
				let roof = copy_roof(roof0)
				floor.roof = roof
				house.roof_geometry_no++
				if (is_one && side.edge_point === null)
					return false
				let dd = dx * side.nx + dy * side.ny

				let is_roof_value = false
				if (is_one && snap_d) {
					let slope = tan(side.pitch * rad)
					let d0 = side.pitch != 90 ? side.d / scale // start overhang
						: side.edge_point?.overhang ?? roof.overhang
					let wall_c = side.wall_c / scale
					let min_d = snap_d
					let snapped_dd = dd
					for (let c of snap_cs) {
						let d1 = (c - wall_c) * (side.nx + side.ny) // on c
						if (abs(d1 - d0) < 1e-2) // the side's own line
							continue
						let snap_dd = abs(d1 - (d0 + dd))
						if (snap_dd >= min_d)
							continue
						min_d = snap_dd
						snapped_dd = d1 - d0
					}
					let roof_d = side.pitch != 90
						? min(-roof.eave_h / slope, roof.max_overhang)
						: roof.overhang
					if (abs(roof_d - (d0 + dd)) <= min_d) {
						snapped_dd = roof_d - d0
						is_roof_value = true
					}
					dd = snapped_dd
				}

				if (side.pitch != 90) {
					let slope = tan(side.pitch * rad)
					let d = clamp(side.d / scale + dd, 0,
						roof.max_overhang) // new overhang
					let eave_h = snap_length(-d * slope)
					if (is_one) {
						let edge_point = roof.edge_points[edge_point_i]
						if (is_roof_value) {
							if (edge_point)
								edge_point.eave_h = null
							return true
						}
						if (!edge_point) {
							edge_point = wall_point(side, x, y)
							roof.edge_points.push(edge_point)
						}
						edge_point.eave_h = eave_h
						return true
					}
					let dz = eave_h - (side.edge_point?.eave_h ?? roof.eave_h)
					// the highest eave stops at the wall top.
					let max_eave_h = roof.eave_h
					for (let edge_point of roof.edge_points)
						if (edge_point.eave_h != null)
							max_eave_h = max(max_eave_h, edge_point.eave_h)
					dz = min(dz, -max_eave_h)
					roof.eave_h = snap_length(roof.eave_h + dz)
					for (let edge_point of roof.edge_points)
						if (edge_point.eave_h != null)
							edge_point.eave_h = snap_length(edge_point.eave_h + dz)
					return true
				}

				if (is_one) {
					let edge_point = roof.edge_points[edge_point_i]
					if (is_roof_value) {
						if (edge_point)
							edge_point.overhang = null
						return true
					}
					if (!edge_point) {
						edge_point = wall_point(side, x, y)
						roof.edge_points.push(edge_point)
					}
					edge_point.overhang =
						snap_length(max(0,
							(edge_point.overhang ?? roof.overhang) + dd))
				} else {
					roof.overhang = snap_length(max(0, roof.overhang + dd))
					for (let edge_point of roof.edge_points)
						if (edge_point.overhang != null)
							edge_point.overhang =
							snap_length(max(0, edge_point.overhang + dd))
				}
				return true
			}
			s.stop = function() {
				commit_edit(floor)
			}
			s.cancel = cancel_edit
			return s
		}

		// the line or point where the faces from make_roof_faces() meet,
		// grabbed at height z, can move: a point at or below the wall top
		// cannot move inward; a side with two or more edge points has no
		// own pitch.
		floor.can_move_faces = function(faces, z) {
			if (z <= floor.z + floor.h)
				return false
			for (let face of faces)
				for (let side of face.sides)
					if (side.edge_point === null)
						return false
			return true
		}

		// move the line or point where the faces meet, grabbed at height z:
		// each face's plane passes through (x, y) at z, by the pitch in the
		// edge point of each of its sides (added on the wall line if none).
		// (x, y) on or past a face's wall line: its sides go vertical. all
		// faces: move() leaves the start values and returns false.
		floor.start_move_faces = function(faces, z) {
			if (!floor.can_move_faces(faces, z))
				return
			begin_edit(floor)
			let roof0 = edit0.roof
			let wall_z = floor.z + floor.h
			let scale = prism_union.grid_scale
			let edge_point_is = [] // [edge_point_i|-1, ...] per side, in roof0
			for (let face of faces)
				for (let side of face.sides)
					edge_point_is.push(
						floor.roof.edge_points.indexOf(side.edge_point))
			let s = {}
			s.move = function(x, y) {
				// each move starts from the roof as it was at the start.
				let roof = copy_roof(roof0)
				floor.roof = roof
				house.roof_geometry_no++
				let pitches = [] // [pitch, ...] per face
				let is_vertical = true // all faces
				for (let face of faces) {
					let {nx, ny, wall_c} = face.sides[0]
					let a = nx ? x : y // across the side
					let d = (wall_c / scale - a) * (nx + ny) // inward
					pitches.push(d > 0 ? atan((z - wall_z) / d) / rad : 90)
					if (d > 0)
						is_vertical = false
				}
				if (is_vertical)
					return false
				let i = 0
				for (let face_i = 0; face_i < faces.length; face_i++) {
					for (let side of faces[face_i].sides) {
						let edge_point = roof.edge_points[edge_point_is[i++]]
						if (!edge_point) {
							let m = (side.m1 + side.m2) / 2 / scale
							edge_point = wall_point(side, m, m)
							roof.edge_points.push(edge_point)
						}
						edge_point.pitch = pitches[face_i]
					}
				}
				return true
			}
			s.stop = function() {
				commit_edit(floor)
			}
			s.cancel = cancel_edit
			return s
		}

		// change the pitch of the face from make_roof_faces() by d_pitch
		// degrees: the roof's pitch and every edge point's own sloped pitch
		// by the same amount, within 1..89. with is_one, only the face's: the
		// pitch in the edge point of each of its sides (added at the side's
		// middle if none). is_one can change from one move to the next. a
		// move with is_one on a face with a side with two or more edge points
		// (no own pitch) leaves the start values and returns false.
		floor.start_move_pitch = function(face) {
			begin_edit(floor)
			let roof0 = edit0.roof
			let scale = prism_union.grid_scale
			let pitch0 = face.sides[0].pitch
			let edge_point_is = [] // [edge_point_i|-1, ...] per side, in roof0
			for (let side of face.sides)
				edge_point_is.push(
					floor.roof.edge_points.indexOf(side.edge_point))
			let s = {}
			s.move = function(d_pitch, is_one) {
				// each move starts from the roof as it was at the start.
				let roof = copy_roof(roof0)
				floor.roof = roof
				house.roof_geometry_no++

				if (is_one) {
					for (let side of face.sides)
						if (side.edge_point === null)
							return false
					let pitch = clamp(pitch0 + d_pitch, 1, 89)
					for (let i = 0; i < face.sides.length; i++) {
						let side = face.sides[i]
						let edge_point = roof.edge_points[edge_point_is[i]]
						if (!edge_point) {
							let m = (side.m1 + side.m2) / 2 / scale
							edge_point = wall_point(side, m, m)
							roof.edge_points.push(edge_point)
						}
						edge_point.pitch = pitch
					}
					return true
				}

				// the shallowest and the steepest sloped pitch stop at 1 and 89.
				let min_pitch = roof.pitch != 90 ? roof.pitch : 1/0
				let max_pitch = roof.pitch != 90 ? roof.pitch : -1/0
				for (let edge_point of roof.edge_points) {
					let pitch = edge_point.pitch
					if (pitch == null || pitch == 90)
						continue
					min_pitch = min(min_pitch, pitch)
					max_pitch = max(max_pitch, pitch)
				}
				d_pitch = clamp(d_pitch, 1 - min_pitch, 89 - max_pitch)
				if (roof.pitch != 90)
					roof.pitch += d_pitch
				for (let edge_point of roof.edge_points)
					if (edge_point.pitch != null && edge_point.pitch != 90)
						edge_point.pitch += d_pitch
				return true
			}
			s.stop = function() {
				commit_edit(floor)
			}
			s.cancel = cancel_edit
			return s
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
			return {
				h: floor.fixed_h,
				points: points,
				lines: [lines],
				objects: copy_objects(floor.objects),
				roof: copy_roof(floor.roof),
			}
		}

		function snap_points() {
			for (let p of floor.ps) {
				p[0] = snap_length(p[0])
				p[1] = snap_length(p[1])
			}
		}

		floor.load_state = function(state) {
			floor.fixed_h = state.h
			floor.h = state.h ?? house.floor_h
			fix_floor_heights()
			floor.load(state.points, state.lines)
			snap_points()
			floor.objects = copy_objects(state.objects)
			floor.roof = copy_roof(state.roof)
			floor.fix()
		}

		// heights -------------------------------------------------------------

		floor.roof_height = function() {
			let areas = []
			for (let area of floor.make_areas())
				if (area.kind == 'roof')
					areas.push(area)
			let wall_z = floor.z + floor.h
			let z = wall_z
			if (areas.length)
				for (let face of floor.make_roof_faces(areas)) {
					let [a, b, c] = face.plane
					for (let ring of face.rings)
						for (let [x, y] of ring)
							z = max(z, a*x + b*y + c)
				}
			return z - wall_z
		}

		floor.start_move_height = function(is_roof) {
			let h0 = is_roof ? floor.roof_height() : floor.h
			if (is_roof && !h0)
				return
			begin_edit(floor)
			let s = {}
			if (is_roof) {
				let roof0 = edit0.roof
				let min_scale = 0
				let max_scale = 1/0
				function pitch_limits(pitch) {
					if (pitch == null || pitch == 90)
						return
					let slope = tan(pitch * rad)
					min_scale = max(min_scale, tan(rad) / slope)
					max_scale = min(max_scale, tan(89*rad) / slope)
				}
				pitch_limits(roof0.pitch)
				for (let p of roof0.edge_points)
					pitch_limits(p.pitch)
				let scale0 = 1
				s.move = function(dh) {
					let scale = clamp((h0 + snap_length(dh)) / h0,
						min_scale, max_scale)
					if (scale == scale0)
						return false
					scale0 = scale
					let roof = floor.roof
					function scale_pitch(pitch) {
						return pitch == null || pitch == 90 || scale == 1
							? pitch : atan(tan(pitch * rad) * scale) / rad
					}
					roof.pitch = scale_pitch(roof0.pitch)
					for (let i = 0; i < roof.edge_points.length; i++) {
						let p0 = roof0.edge_points[i]
						roof.edge_points[i].pitch = scale_pitch(p0.pitch)
					}
					house.roof_geometry_no++
					return true
				}
			} else {
				s.move = function(dh) {
					let h = max(house.slab_thickness + 1, snap_length(h0 + dh))
					if (floor.h == h)
						return false
					floor.fixed_h = h == h0 ? edit0.h : h
					floor.h = h
					fix_floor_heights()
					return true
				}
			}
			s.stop = function() { commit_edit(floor) }
			s.cancel = cancel_edit
			return s
		}

		// edit history --------------------------------------------------------

		function cancel_edit() {
			assert(edit0)
			let state = edit0
			let ground_objects = edit0_ground_objects
			edit0 = null
			floor.load_state(state)
			house.ground_objects = ground_objects
		}

		// objects -------------------------------------------------------------

		// let the object's type place it at (x, y) or on a wall near it, then
		// put it in its list: on the floor: the floor's, else the ground's.
		function move_object(object, x, y, snap_d) {
			if (house_object_types[object.type].in_wall)
				wall_geometry = null
			let objects0 = object.on_floor ? floor.objects : house.ground_objects
			house_object_types[object.type].place(floor, object,
				snap_length(x), snap_length(y), snap_d)
			let objects = object.on_floor ? floor.objects : house.ground_objects
			if (objects != objects0) {
				remove_value(objects0, object)
				objects.push(object)
			}
			if (house_object_types[object.type].opens_room)
				fix_open_rooms()
		}

		// the closed rect x1, y1, x2, y2 shares a point with the area that one
		// of the floor's outlines encloses, walls included.
		floor.is_rect_touching_house = function(x1, y1, x2, y2) {
			for (let comp of floor.comps) {
				if (comp.inside)
					continue
				let ring = comp.outer_cycle.edges
				let is_odd = false
				for (let i = 0, n = ring.length; i < n; i++) {
					let p1 = ring[i]
					let p2 = ring[(i+1) % n]
					let is_v = p1[0] == p2[0]
					let c = is_v ? p1[0] : p1[1]
					let m_lo = min(is_v ? p1[1] : p1[0], is_v ? p2[1] : p2[0])
					let m_hi = max(is_v ? p1[1] : p1[0], is_v ? p2[1] : p2[0])
					if (c >= (is_v ? x1 : y1) && c <= (is_v ? x2 : y2)
						&& m_lo <= (is_v ? y2 : x2) && m_hi >= (is_v ? y1 : x1)
					)
						return true
					// no side touches the rect: its corner is in or out.
					if (is_v && c > x1 && m_lo <= y1 && y1 < m_hi)
						is_odd = !is_odd
				}
				if (is_odd)
					return true
			}
			return false
		}

		// start moving an object, which is on this floor or on the ground.
		// s.move(x, y, snap_d) places it at (x, y) or on a wall within snap_d.
		// s.stop() commits the move as one edit.
		floor.start_move_object = function(object) {
			begin_edit(floor)
			let s = {}
			s.move = function(x, y, snap_d) {
				move_object(object, x, y, snap_d)
			}
			s.stop = function() {
				commit_edit(floor)
			}
			s.cancel = cancel_edit
			return s
		}

		// start resizing an object, which is on this floor or on the ground,
		// along its width (axis 'w', with a w_list or w_range) by dragging its
		// end on `side` (1 or -1 along the axis), or along its length (axis
		// 'l', with an l_list) by dragging its bottom end (side 1), while the
		// other end stays in place.
		// s.resize(dx, dy) moves the dragged end by the pointer's displacement
		// (dx, dy) since the press, as far as the type's limit_w or limit_l
		// allows and to the nearest size the type allows. s.stop() commits the
		// resize as one edit.
		floor.start_resize_object = function(object, side, axis = 'w') {
			begin_edit(floor)
			let object_type = house_object_types[object.type]
			let is_l = axis == 'l'
			let sizes = is_l ? object_type.l_list
				: object_type.w_list ?? object_type.w_range
			let limit = is_l ? object_type.limit_l : object_type.limit_w
			let x0 = object.x
			let y0 = object.y
			let size0 = object[axis]
			let max_size = limit ? limit(floor, object, side) : Infinity
			let s = {}
			s.resize = function(dx, dy) {
				let r = object.rot * rad
				let ax = is_l ? -sin(r) : cos(r) // the axis in the plan.
				let ay = is_l ? cos(r) : sin(r)
				let u = dx * ax + dy * ay
				let size = snap_object_size(sizes, size0 + side * u, max_size)
				if (size == null)
					return
				let shift = side * (size - size0) / 2
				object[axis] = size
				object.x = snap_length(x0 + shift * ax)
				object.y = snap_length(y0 + shift * ay)
				if (object_type.in_wall)
					wall_geometry = null
			}
			s.stop = function() {
				commit_edit(floor)
			}
			s.cancel = cancel_edit
			return s
		}

		// remove an object, which is on this floor or on the ground.
		floor.remove_object = function(object) {
			begin_edit(floor)
			let objects = object.on_floor ? floor.objects : house.ground_objects
			remove_value(objects, object)
			if (house_object_types[object.type].in_wall)
				wall_geometry = null
			if (house_object_types[object.type].opens_room)
				fix_open_rooms()
			commit_edit(floor)
		}

		// change an object with fn(object), which is on this floor or on the
		// ground: one undoable edit, if fn changed anything.
		floor.update_object = function(object, fn) {
			begin_edit(floor)
			fn(object)
			if (house_object_types[object.type].in_wall)
				wall_geometry = null
			commit_edit(floor)
		}

		// add an object from a save_object() state, placed at (x, y) or on a
		// wall within snap_d as by a move: one undoable edit. a state of an
		// unknown type throws.
		floor.add_object = function(state, x, y, snap_d) {
			let object = copy_objects([state])[0]
			begin_edit(floor)
			house.ground_objects.push(object)
			move_object(object, x, y, snap_d)
			commit_edit(floor)
		}

		// segment deletion ----------------------------------------------------

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
		function snap_seg(a, min_a, max_a, snap_lines, s, snap_d) {
			a = clamp(a, min_a, max_a)
			let sa = snap_lines.snap(a, snap_d)
			s.snap_a = sa ?? null
			return snap_length(sa ?? a)
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

		function start_move_seg(seg) {

			push_log('START MOVE SEG:', seg.id)

			begin_edit(floor)
			detach_colinear_segs(seg)

			pop_log()

			let move_freely = seg[0].segs.length == 1 && seg[1].segs.length == 1
			let seg0 = seg.clone()
			let min_a = seg_move_bump_limit(seg, -1)
			let max_a = seg_move_bump_limit(seg,  1)
			let snap_lines = snap_lines_for(seg.is_v, move_freely && seg)
			let v = seg0.is_v
			let m_snap_lines = move_freely && snap_lines_for(!seg.is_v, seg)

			// the objects on the seg move with it.
			let riders = [] // [{object:, x:, y:}, ...] x, y: at the start
			for (let object of floor.objects)
				if (object.seg == seg)
					riders.push({object: object, x: object.x, y: object.y})

			let s = {
				snap_a: undefined, // coordinate|null: unsnapped|undefined: free
				snap_v: snap_lines.v,
			}

			s.move = function(dx, dy, snap_d = 200) {

				let dm = v ? dy : dx
				let da = v ? dx : dy

				if (move_freely) {

					let a = seg0.axis + da
					let sa = snap_lines.snap(a, snap_d) ?? a
					a = sa

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
					p1[0] = snap_length(v ? a : m1s ?? m1)
					p2[0] = snap_length(v ? a : m2s ?? m2)
					p1[1] = snap_length(!v ? a : m1s ?? m1)
					p2[1] = snap_length(!v ? a : m2s ?? m2)
					create_edges()

				} else { // move on cross axis

					let a = seg0.axis + (v ? dx : dy)
					let sa = snap_seg(a, min_a, max_a, snap_lines,
						s, snap_d)
					a = sa ?? a
					seg.axis = a
					create_edges()

				}

				let seg_dx = seg[0][0] - seg0[0][0]
				let seg_dy = seg[0][1] - seg0[0][1]
				for (let rider of riders) {
					rider.object.x = rider.x + seg_dx
					rider.object.y = rider.y + seg_dy
				}

			}

			s.stop = function(remove_seg) {
				push_log('STOP MOVE SEG:', seg.id)
				if (remove_seg)
					floor.rem_seg(seg)
				floor.fix()
				commit_edit(floor)
				pop_log()
			}
			s.cancel = cancel_edit

			return s
		}
		floor.start_move_seg = start_move_seg

		function start_resize_seg(p, mx0, my0, dx, dy, sdx, sdy) {

			// based on direction of drag, either detach a seg or add a seg, and start resizing it.
			push_log('START RESIZE SEG')

			begin_edit(floor)
			mx0 = snap_length(mx0)
			my0 = snap_length(my0)
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
				let x2 = snap_length(x1 + dx * abs(sdx))
				let y2 = snap_length(y1 + dy * abs(sdy))
				let p1 = p ?? floor.add_point(x1, y1)
				let p2 = floor.add_point(x2, y2)
				seg = floor.add_seg(p1, p2)
				p = p2
			}

			log('resizing seg:', seg.id)

			floor.rebuild()
			create_edges()

			pop_log()

			let min_a = seg_resize_bump_limit(seg, p0, -1)
			let max_a = seg_resize_bump_limit(seg, p0,  1)
			let snap_lines = snap_lines_for(!seg.is_v, seg)
			// the seg's other end: a zero-length seg gets removed by fix().
			let other_p = seg[1 - seg.pi(p)]
			snap_lines.push(other_p[snap_lines.v ? 0 : 1])

			let s = {
				seg: seg,
				snap_a: undefined, // coordinate|null: unsnapped
				snap_v: snap_lines.v,
			}

			s.resize = function(dx, dy, snap_d = 300) {
				let x1 = snap_length(p0[0] + dx * abs(sdx))
				let y1 = snap_length(p0[1] + dy * abs(sdy))

				let a = sdx ? x1 : y1
				let sa = snap_seg(a, min_a, max_a, snap_lines, s, snap_d)
				if (sa != null)
					a = sa
				if (sdx)
					x1 = a
				else
					y1 = a
				p[0] = x1
				p[1] = y1
				create_edges()
				return p
			}

			s.stop = function() {
				push_log('STOP RESIZE SEG:', seg.id)
				floor.fix()
				commit_edit(floor)
				pop_log()
			}
			s.cancel = cancel_edit

			return s
		}
		floor.start_resize_seg = start_resize_seg

		// init ----------------------------------------------------------------

		push_log('LOADING LEVEL', floor.i)
		floor.load(t.points, t.lines)
		snap_points()
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
		for (let c of floor.open_rooms) {
			add_ring_path(paths, c.edges)
			for (let comp of c.islands)
				add_ring_path(paths, comp.outer_cycle.edges)
		}
		return paths
	}

	// the holes that the floor's objects cut in its walls, grouped by
	// height: [{sill, head, paths}, ...] with the grid paths of the holes.
	function make_hole_groups(floor) {
		let groups = map() // {'sill head' -> group}
		for (let object of floor.objects) {
			let object_type = house_object_types[object.type]
			if (!object_type.in_wall)
				continue
			let hole = object_type.hole(floor, object)
			let key = hole.sill + ' ' + hole.head
			let group = groups.get(key)
			if (!group) {
				group = {sill: hole.sill, head: hole.head, paths: []}
				groups.set(key, group)
			}
			let [x1, y1, x2, y2] = hole.rect
			add_ring_path(group.paths,
				[[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
		}
		return Array.from(groups.values())
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
		let t0 = profile_time()
		let prisms = []
		let slab_t = house.slab_thickness
		let floors = house.floors
		let floor_n = top_floor.i + 1
		let {intersect, difference, FillRule} = clipper2
		let EO = FillRule.EvenOdd

		// add the floor's wall prisms up to top_z, inside or outside its
		// roof_paths: the cut walls and the walls above and below the holes.
		function add_wall_prisms(floor, geometry, roof_paths, top_z,
			under_roof
		) {
			let {cut_wall_paths, hole_groups} = geometry
			let clip = under_roof ? intersect : difference
			if (roof_paths.length)
				cut_wall_paths = clip(cut_wall_paths, roof_paths, EO)
			let bottom_z = floor.z + slab_t
			if (hole_groups.length) {
				for (let {sill, head, paths: hole_paths} of hole_groups) {
					let wall_paths = roof_paths.length
						? clip(hole_paths, roof_paths, EO) : hole_paths
					if (!wall_paths.length)
						continue
					if (sill > 0)
						prisms.push({
							paths: wall_paths,
							bottom: [0, 0, bottom_z],
							top: [0, 0, min(bottom_z + sill, top_z)],
							tag: 'walls',
						})
					if (bottom_z + head < top_z)
						prisms.push({
							paths: wall_paths,
							bottom: [0, 0, bottom_z + head],
							top: [0, 0, top_z],
							tag: 'walls',
						})
				}
			}
			prisms.push({
				paths: cut_wall_paths,
				bottom: [0, 0, bottom_z],
				top: [0, 0, top_z],
				tag: 'walls',
			})
		}

		// areas: the roof areas of each floor; the terraces of top_floor.
		let roof_paths_by_floor = [] // [[path, ...], ...] grid paths
		let roof_faces_by_floor = [] // [faces, ...]
		let eave_sides_by_floor = [] // [[side, ...], ...] from make_roof_faces()
		let terrace_paths = [] // grid paths of top_floor's terraces
		for (let floor_i = 0; floor_i < floor_n; floor_i++) {
			let floor = floors[floor_i]
			let roof_areas = []
			let roof_paths = []
			let terrace_areas = [] // below top_floor: for the half-walls
			if (!(floor == top_floor && no_roof)) {
				for (let area of floor.make_areas()) {
					if (area.kind == 'roof') {
						roof_areas.push(area)
						for (let path of area.paths)
							roof_paths.push(path)
					} else if (floor == top_floor) {
						for (let path of area.paths)
							terrace_paths.push(path)
					} else {
						terrace_areas.push(area)
					}
				}
			}
			// half-walls around the terraces: on the slab of the floor above.
			if (terrace_areas.length) {
				let z = floors[floor_i+1].z + slab_t
				prisms.push({
					paths: floor.make_half_wall_paths(terrace_areas),
					bottom: [0, 0, z],
					top: [0, 0, z + house.half_wall_h],
					tag: 'walls',
				})
			}
			roof_paths_by_floor.push(roof_paths)
			let eave_sides = []
			eave_sides_by_floor.push(eave_sides)
			roof_faces_by_floor.push(roof_areas.length
				? floor.make_roof_faces(roof_areas, eave_sides) : [])
		}

		// walls: from the top of the floor's slab to the top of the floor.
		// under the floor's roofs: up to their highest point, so the roof
		// bodies cut them to the roof underside.
		for (let floor_i = 0; floor_i < floor_n; floor_i++) {
			let floor = floors[floor_i]
			let geometry = floor.make_wall_geometry()
			let roof_paths = roof_paths_by_floor[floor_i]
			let top_z = floor.z + floor.h
			if (roof_paths.length) {
				let roof_z = -1/0
				for (let face of roof_faces_by_floor[floor_i]) {
					let [a, b, c] = face.plane
					for (let ring of face.rings)
						for (let [x, y] of ring)
							roof_z = max(roof_z, a * x + b * y + c)
				}
				add_wall_prisms(floor, geometry, roof_paths, roof_z, true)
				add_wall_prisms(floor, geometry, roof_paths, top_z, false)
			} else {
				add_wall_prisms(floor, geometry, roof_paths, top_z)
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

		// overhang strips of two perpendicular sloped sides with different
		// eave heights overlap: a body with the lower side's plane over the
		// overlap, under the higher eave up to the wall. prism_union() keeps
		// the higher top.
		for (let floor_i = 0; floor_i < floor_n; floor_i++) {
			let sides = eave_sides_by_floor[floor_i]
			let side_planes = map() // {side -> plane} of the side's face
			for (let face of roof_faces_by_floor[floor_i])
				for (let side of face.sides)
					side_planes.set(side, face.plane)
			for (let i = 0; i < sides.length; i++) {
				for (let j = i+1; j < sides.length; j++) {
					let side1 = sides[i]
					let side2 = sides[j]
					if (side1.pitch == 90 || side2.pitch == 90
						|| !side1.nx == !side2.nx || side1.eave_z == side2.eave_z)
						continue
					// strips on the grid: across from wall_c to c, along m1..m2.
					let x1 = -1/0, y1 = -1/0, x2 = 1/0, y2 = 1/0
					for (let side of [side1, side2]) {
						let c1 = min(side.wall_c, side.c)
						let c2 = max(side.wall_c, side.c)
						x1 = max(x1, side.nx ? c1 : side.m1)
						x2 = min(x2, side.nx ? c2 : side.m2)
						y1 = max(y1, side.nx ? side.m1 : c1)
						y2 = min(y2, side.nx ? side.m2 : c2)
					}
					if (x2 <= x1 || y2 <= y1)
						continue
					let plane = side_planes.get(
						side1.eave_z < side2.eave_z ? side1 : side2)
					if (!plane) // lower side has no face: no roof to continue.
						continue
					let [a, b, c] = plane
					prisms.push({
						paths: [[{x: x1, y: y1}, {x: x2, y: y1},
							{x: x2, y: y2}, {x: x1, y: y2}]],
						bottom: [a, b, c - roof_t * sqrt(1 + a * a + b * b)],
						top: plane,
						tag: 'roof',
						is_cutter: true,
					})
				}
			}
		}

		profile_time('prism.build', t0)
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
		house.roof_geometry_no++
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

	// settings ---------------------------------------------------------------

	// set the house setting `name` (a key of defaults) and rebuild what it
	// changes: the floors' heights and wall edges.
	function apply_setting(name, value) {
		house[name] = value
		for (let floor of house.floors)
			floor.h = floor.fixed_h ?? house.floor_h
		fix_floor_heights()
		for (let floor of house.floors)
			floor.fix()
	}

	// start changing the setting `name`: s.move(value) sets it, s.stop()
	// commits the changes as one edit.
	house.start_edit_setting = function(name) {
		assert(!edit0)
		let value0 = house[name]
		let s = {}
		s.move = function(value) {
			value = snap_length(value)
			if (house[name] != value)
				apply_setting(name, value)
		}
		s.stop = function() {
			if (house[name] == value0)
				return
			undo_stack.push({op: 'setting', name: name, value: value0})
			redo_stack.length = 0
			house.edit_no++
		}
		return s
	}

	// init -------------------------------------------------------------------

	function init(t) {

		if (t.version == null)
			t = scale_cm_state(t)
		assign(house, defaults, t)
		house.floor_h = snap_length(house.floor_h)
		house.int_wall_thickness = snap_length(house.int_wall_thickness)
		house.ext_wall_thickness = snap_length(house.ext_wall_thickness)
		house.slab_thickness = snap_length(house.slab_thickness)
		house.roof_thickness = snap_length(house.roof_thickness)
		house.half_wall_h = snap_length(house.half_wall_h)

		let t0 = clock()
		push_log_if(DEBUG_PLAN_LOAD, 'LOADING PLAN')

		house.ground_objects = copy_objects(t.ground_objects ?? [])
			// objects on no floor, seen on all
		replenish_ground_objects()
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
		let state = {
			floors: house.floors,
			ground_objects: house.ground_objects,
		}
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
			let floor1 = house.floors[floor.i+1]
			let state = floor.save_state()
			let ground_objects = copy_objects(house.ground_objects)
			let floor1_objects = floor1 && copy_objects(floor1.objects)
			floor.load_state(entry.state)
			house.ground_objects = copy_objects(entry.ground_objects)
			if (floor1) {
				floor1.objects = copy_objects(entry.floor1_objects)
				floor1.fix_objects()
			}
			return {
				op: 'edit',
				floor: floor,
				state: state,
				ground_objects: ground_objects,
				floor1_objects: floor1_objects,
			}
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
		} else if (op == 'setting') {
			let value = house[entry.name]
			apply_setting(entry.name, entry.value)
			return {op: 'setting', name: entry.name, value: value}
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

	profile_time('plan.load', t0)
	return house
}

G.house_plan = house_plan

}()) // module scope.
