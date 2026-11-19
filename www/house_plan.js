(function () {
"use strict"
const G = window

const {
	round, mod, abs, sign, min, max, clamp, floor, ceil, sqrt, tan, atan,
	sin, cos, rad,
	assert, log, push_log, pop_log, push_log_if,
	insert, remove_value, uniq_sorted, map, assign, clock, json,
	profile_time, empty_array, array_set,
} = glue

const {bbox2, poly2, v2, mat3} = Math3D

G.DEBUG_PLAN = 0
G.DEBUG_PLAN_LOAD = 1

// room sides ---------------------------------------------------------------

// describe a room edge as a directed wall side for rectangle queries.
function read_wall_side(p1, p2, out) {
	let is_v = p1[0] == p2[0]
	let m1 = is_v ? p1[1] : p1[0]
	let m2 = is_v ? p2[1] : p2[0]
	out[0] = is_v ? (m2 > m1 ? 3 : 1) : (m2 > m1 ? 2 : 0)
	out[1] = is_v ? p1[0] : p1[1]
	out[2] = m1
	out[3] = m2
	return out
}

// test overlap along a wall side when finding snaps and resize limits.
function wall_side_overlaps(side, x, y, hx, hy) {
	let is_v = side[0] % 2 == 1
	let along = is_v ? y : x
	let h_along = is_v ? hy : hx
	return along + h_along > min(side[2], side[3])
		&& along - h_along < max(side[2], side[3])
}

// the min coordinate across side of a rect of size (w, h) resting against it
// on the room's side.
function wall_side_min(side, w, h) {
	let [dir, c] = side
	let size = dir % 2 ? w : h
	return dir == 1 || dir == 2 ? c - size : c
}

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

const STATE_VERSION = 1

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
			for (let name in object_type.fields) {
				let value = object[name] ?? object_type.fields[name]
				object1[name] = Array.isArray(value) ? value.slice() : value
			}
			a.push(object1)
		}
		return a
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
		let state = {version: STATE_VERSION}
		for (let k in defaults)
			state[k] = house[k]
		state.ground_objects = copy_objects(house.ground_objects)
		state.floors = floors
		return state
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
		floor.fix_objects(true)
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
			return min_m
		}

		ms.v = v

		return ms
	}

	house.snap_lines = [] // [x lines, y lines] of all the floors

	function fix_snap_lines() {
		let t0 = profile_time()
		house.snap_lines[0] = snap_lines_for(1)
		house.snap_lines[1] = snap_lines_for(0)
		profile_time('plan.snap_lines', t0)
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
		/* objects on this floor: [object, ...]. object fields:
			type: the name of an object type in house.object_types.
			x, y: the object's position in whole millimetres. For furniture,
			     stairs and countertops, this is the corner of the plan bounding
			     box with the smallest x and y. For an opening, this is the end
			     with the smaller coordinate along the wall, on its centre
			     line. For a tag, this is the tag's point.
			rot: rotation in degrees, from 0 up to but not including 360.
			     Use multiples of 90, or an additional 45 for a corner chair.
			w: width in millimetres, for types that have a width.
			seg: the wall segment containing the opening, or null. Not saved.
			side_x: the vertical room side that the object snapped to, or null.
			side_y: the horizontal room side that the object snapped to, or
			     null. The placement functions set these fields. Neither is
			     saved. A room side is [dir, c, m1, m2]:
			       dir: direction towards the wall: 0 north, 1 east, 2 south,
			            3 west.
			       c: the wall face's x coordinate for a vertical side, or its
			          y coordinate for a horizontal side.
			       m1, m2: the endpoints' y coordinates for a vertical side, or
			               their x coordinates for a horizontal side. From m1
			               towards m2, the room interior is on the left.
			snap_side: the first room side that the furniture snapped to,
			     before snapping to a perpendicular side. Null if absent.
			     Not saved.
			on_floor: true if the object belongs to floor.objects; false if it
			     belongs to house.ground_objects. The type's place() function
			     checks whether the object fits on the floor. Not saved.
		*/
		floor.objects = copy_objects(t.objects ?? [])
		let wall_geometry
		let roof_geometry // floor.make_roof_geometry()'s result
		let roof_geometry_no // house.roof_geometry_no of roof_geometry

		floor.room_sides = [] // [[dir, c, m1, m2], ...] free space on the left

		floor._after_fix = function() {
			create_edges()
			fix_snap_lines()
			fix_objects()
		}

		// place the objects again in order, or only those connecting below.
		// move invalid objects to the ground.
		function fix_objects(connects_below_only = false) {
			let t0 = profile_time()
			let objects = floor.objects
			for (let object of objects)
				if (!connects_below_only
					|| house_object_types[object.type].connects_below)
					object.seg = null
			let i = 0
			while (i < objects.length) {
				let object = objects[i]
				let object_type = house_object_types[object.type]
				if (connects_below_only && !object_type.connects_below) {
					i++
					continue
				}
				object_type.place(floor, object, 0)
				if (object.on_floor) {
					i++
				} else {
					objects.splice(i, 1)
					house.ground_objects.push(object)
					if (object_type.marks_terrace) // the floor below's terraces.
						house.roof_geometry_no++
				}
			}
			profile_time('plan.objects', t0)
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

			let t0 = profile_time()
			wall_geometry = null

			for (let p of floor.ps)
				p.max_offset = 0
			let room_sides = floor.room_sides
			let side_n = 0

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
					if (!c.outer || c.comp.inside) {
						let ring = c.edges
						for (let i = 0, n = ring.length; i < n; i++)
							read_wall_side(ring[i], ring[(i+1) % n],
								room_sides[side_n++] ??= [])
					}
				}
			}
			room_sides.length = side_n

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
			profile_time('plan.offsets', t0)

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
			let t0 = profile_time()
			floor.open_rooms.clear()
			for (let object of floor.objects) {
				if (!house_object_types[object.type].opens_room)
					continue
				let c = floor.hit_cycle_edges(object.x, object.y)
				if (!c) // in a wall body or outside: no room.
					continue
				floor.open_rooms.add(c)
			}
			profile_time('plan.rooms', t0)
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

		// the roof over the floor's roof areas and the half-walls around its
		// terraces, made again when house.roof_geometry_no changes:
		// {roof_paths, terrace_paths, roof_faces, eave_sides, shared_edges,
		// half_wall_paths}. roof_paths, terrace_paths: the grid paths of the
		// roof areas and of the terrace areas. eave_sides, shared_edges: as
		// in make_roof_faces().
		floor.make_roof_geometry = function() {
			if (roof_geometry_no == house.roof_geometry_no)
				return roof_geometry

			// split the areas into roof areas and terrace areas.
			let roof_areas = []
			let terrace_areas = []
			let roof_paths = []
			let terrace_paths = []
			for (let area of floor.make_areas()) {
				if (area.kind == 'roof') {
					roof_areas.push(area)
					for (let path of area.paths)
						roof_paths.push(path)
				} else {
					terrace_areas.push(area)
					for (let path of area.paths)
						terrace_paths.push(path)
				}
			}

			// the roof over the roof areas and the half-walls around the
			// terraces.
			let eave_sides = []
			let shared_edges = []
			roof_geometry = {
				roof_paths: roof_paths,
				terrace_paths: terrace_paths,
				roof_faces: roof_areas.length
					? floor.make_roof_faces(roof_areas, eave_sides, shared_edges)
					: [],
				eave_sides: eave_sides,
				shared_edges: shared_edges,
				half_wall_paths: terrace_areas.length
					? floor.make_half_wall_paths(terrace_areas) : [],
			}
			roof_geometry_no = house.roof_geometry_no
			return roof_geometry
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

		// replace the roof with a copy of roof0, for each move of a drag to
		// start from the roof as it was at the start.
		function reset_roof(roof0) {
			floor.roof = copy_roof(roof0)
			house.roof_geometry_no++
			return floor.roof
		}

		// the edge point at index i of the roof's edge points, else a new one
		// on the eave side's wall line across from (x, y).
		function get_edge_point(roof, i, side, x, y) {
			let edge_point = roof.edge_points[i]
			if (!edge_point) {
				edge_point = wall_point(side, x, y)
				roof.edge_points.push(edge_point)
			}
			return edge_point
		}

		// set the roof's value k and every edge point's own value k to fn(it).
		function shift_roof_values(roof, k, fn) {
			roof[k] = fn(roof[k])
			for (let edge_point of roof.edge_points)
				if (edge_point[k] != null)
					edge_point[k] = fn(edge_point[k])
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
			let s = start_edit()
			let roof0 = edit0.roof
			let scale = prism_union.grid_scale
			let edge_point_i = floor.roof.edge_points.indexOf(side.edge_point)
			s.move = function(dx, dy, is_one, snap_d) {
				let roof = reset_roof(roof0)
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

				let k, value // the side's own value with is_one
				if (side.pitch != 90) {
					let slope = tan(side.pitch * rad)
					let d = clamp(side.d / scale + dd, 0,
						roof.max_overhang) // new overhang
					let eave_h = snap_length(-d * slope)
					if (!is_one) {
						let dz = eave_h - (side.edge_point?.eave_h ?? roof.eave_h)
						// the highest eave stops at the wall top.
						let max_eave_h = roof.eave_h
						for (let edge_point of roof.edge_points)
							if (edge_point.eave_h != null)
								max_eave_h = max(max_eave_h, edge_point.eave_h)
						dz = min(dz, -max_eave_h)
						shift_roof_values(roof, 'eave_h',
							eave_h => snap_length(eave_h + dz))
						return true
					}
					k = 'eave_h'
					value = eave_h
				} else {
					if (!is_one) {
						shift_roof_values(roof, 'overhang',
							overhang => snap_length(max(0, overhang + dd)))
						return true
					}
					let edge_point = roof.edge_points[edge_point_i]
					k = 'overhang'
					value = snap_length(max(0,
						(edge_point?.overhang ?? roof.overhang) + dd))
				}

				if (is_roof_value) {
					let edge_point = roof.edge_points[edge_point_i]
					if (edge_point)
						edge_point[k] = null
					return true
				}
				get_edge_point(roof, edge_point_i, side, x, y)[k] = value
				return true
			}
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
			let s = start_edit()
			let roof0 = edit0.roof
			let wall_z = floor.z + floor.h
			let scale = prism_union.grid_scale
			let edge_point_is = [] // [edge_point_i|-1, ...] per side, in roof0
			for (let face of faces)
				for (let side of face.sides)
					edge_point_is.push(
						floor.roof.edge_points.indexOf(side.edge_point))
			s.move = function(x, y) {
				let roof = reset_roof(roof0)
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
						let m = (side.m1 + side.m2) / 2 / scale
						get_edge_point(roof, edge_point_is[i++], side, m, m)
							.pitch = pitches[face_i]
					}
				}
				return true
			}
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
			let s = start_edit()
			let roof0 = edit0.roof
			let scale = prism_union.grid_scale
			let pitch0 = face.sides[0].pitch
			let edge_point_is = [] // [edge_point_i|-1, ...] per side, in roof0
			for (let side of face.sides)
				edge_point_is.push(
					floor.roof.edge_points.indexOf(side.edge_point))
			s.move = function(d_pitch, is_one) {
				let roof = reset_roof(roof0)

				if (is_one) {
					for (let side of face.sides)
						if (side.edge_point === null)
							return false
					let pitch = clamp(pitch0 + d_pitch, 1, 89)
					for (let i = 0; i < face.sides.length; i++) {
						let side = face.sides[i]
						let m = (side.m1 + side.m2) / 2 / scale
						get_edge_point(roof, edge_point_is[i], side, m, m)
							.pitch = pitch
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
				shift_roof_values(roof, 'pitch',
					pitch => pitch == 90 ? pitch : pitch + d_pitch)
				return true
			}
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
			let wall_z = floor.z + floor.h
			let z = max_face_z(floor.make_roof_geometry().roof_faces, wall_z)
			return z - wall_z
		}

		floor.start_move_height = function(is_roof) {
			let h0 = is_roof ? floor.roof_height() : floor.h
			if (is_roof && !h0)
				return
			let s = start_edit()
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

		// the object changed: its wall's holes, the open rooms and the
		// terraces of the floor below.
		function fix_walls_and_rooms(object) {
			let object_type = house_object_types[object.type]
			if (object_type.in_wall)
				wall_geometry = null
			if (object_type.opens_room)
				fix_open_rooms()
			if (object_type.marks_terrace)
				house.roof_geometry_no++
		}

		let object_origin = v2() // [x, y] of the moved object's origin

		// place the object with its origin near the pointer at (x, y).
		function move_object(object, x, y, snap_d, snap_margin) {
			let [ox, oy] = get_object_origin(floor, object, object_origin)
			object.x = snap_length(object.x + x - ox)
			object.y = snap_length(object.y + y - oy)
			place_object(object, snap_d, snap_margin)
		}

		// let the object's type place it where it is or on a wall near it, then
		// put it in its list: on the floor: the floor's, else the ground's.
		function place_object(object, snap_d, snap_margin) {
			let objects0 = object.on_floor ? floor.objects : house.ground_objects
			object.seg = null
			house_object_types[object.type].place(floor, object,
				snap_d, snap_margin)
			let objects = object.on_floor ? floor.objects : house.ground_objects
			if (objects != objects0) {
				remove_value(objects0, object)
				objects.push(object)
			}
			fix_walls_and_rooms(object)
		}

		// begin an edit of the floor: s.stop() commits it, s.cancel() reverts
		// it.
		function start_edit() {
			begin_edit(floor)
			return {stop: stop_edit, cancel: cancel_edit}
		}

		function stop_edit() {
			commit_edit(floor)
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
		// s.move(x, y, snap_d, snap_margin = 0) places its origin near (x, y).
		// s.stop() commits the move as one edit.
		floor.start_move_object = function(object) {
			let s = start_edit()
			s.move = function(x, y, snap_d, snap_margin = 0) {
				move_object(object, x, y, snap_d, snap_margin)
			}
			return s
		}

		// start resizing an object, which is on this floor or on the ground,
		// along its width (axis 'w') by dragging its end on `side` (1 or -1
		// along the axis), or along its length (axis 'l') by dragging its
		// bottom end (side 1), while the other end stays in place.
		// s.resize(dx, dy) moves the dragged end by the pointer's displacement
		// (dx, dy) since the press, as far as the type's limit_size allows and
		// to the nearest size in the type's sizes. s.stop() commits the
		// resize as one edit.
		floor.start_resize_object = function(object, side, axis = 'w') {
			begin_edit(floor)
			let s = house_object_types[object.type]
				.start_resize(floor, object, side, axis)
			let resize = s.resize
			s.resize = function(dx, dy, snap_d, nosnap) {
				resize(dx, dy, snap_d, nosnap)
				place_object(object, 0)
			}
			s.stop = stop_edit
			s.cancel = cancel_edit
			return s
		}

		// remove an object, which is on this floor or on the ground.
		floor.remove_object = function(object) {
			begin_edit(floor)
			let objects = object.on_floor ? floor.objects : house.ground_objects
			remove_value(objects, object)
			fix_walls_and_rooms(object)
			commit_edit(floor)
		}

		// change an object with fn(object), which is on this floor or on the
		// ground: one undoable edit, if fn changed anything.
		floor.update_object = function(object, fn) {
			begin_edit(floor)
			fn(object)
			fix_walls_and_rooms(object)
			commit_edit(floor)
		}

		// add an object from a save_object() state, its origin at (x, y) or on a
		// wall within snap_d as by a move: one undoable edit. a state of an
		// unknown type throws.
		floor.add_object = function(state, x, y, snap_d) {
			let object = copy_objects([state])[0]
			// the state's position: none or elsewhere; the move goes from here.
			object.x = x
			object.y = y
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
		function fix_cycle(c, i, fw, action, new_p) {
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
						if (fp0 == p0 && fp2 == p2) fix_cycle(c, i, 1, action, new_p)
						if (fp0 == p2 && fp2 == p0) fix_cycle(c, i, 0, action, new_p)
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
			floor.add_seg(p, new_p)
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
					a = snap_lines.snap(a, snap_d) ?? a

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
					seg.axis = snap_seg(a, min_a, max_a, snap_lines, s, snap_d)
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
				let [x1, y1] = p0
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
				a = snap_seg(a, min_a, max_a, snap_lines, s, snap_d)
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

	// the highest point of roof faces from make_roof_faces(), at least z.
function max_face_z(faces, z) {
	for (let face of faces) {
		let [a, b, c] = face.plane
		for (let ring of face.rings)
			for (let [x, y] of ring)
				z = max(z, a*x + b*y + c)
	}
	return z
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

	// intersect upper open rooms with lower rooms to locate slab openings.
	function make_opening_paths(floor0, floor1, outline0) {
		let {intersect, difference, FillRule} = clipper2
		let EO = FillRule.EvenOdd
		outline0 ??= add_outline_paths(floor0, [])
		let rooms0 = difference(outline0, add_skin_paths(floor0, []), EO)
		return intersect(add_open_room_paths(floor1, []), rooms0, EO)
	}

	// the holes that the floor's objects cut in its walls, grouped by
	// height: [{sill, head, paths}, ...] with the grid paths of the holes.
	function make_hole_groups(floor) {
		let groups = map() // {'sill head' -> group}
		let box = [0, 0, 0, 0] // [x1, y1, x2, y2] of the hole
		for (let object of floor.objects) {
			let {in_wall, sill, head} = house_object_types[object.type]
			if (!in_wall)
				continue
			let key = sill + ' ' + head
			let group = groups.get(key)
			if (!group) {
				group = {sill: sill, head: head, paths: []}
				groups.set(key, group)
			}
			let [x1, y1, x2, y2] = get_object_box(floor, object, box)
			add_ring_path(group.paths,
				[[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
		}
		return Array.from(groups.values())
	}

	// test full rectangle coverage on the slab grid, including any holes.
	function is_rect_in_paths(paths, x1, y1, x2, y2) {
		let scale = prism_union.grid_scale
		let rect = [[
			{x: round(x1 * scale), y: round(y1 * scale)},
			{x: round(x2 * scale), y: round(y1 * scale)},
			{x: round(x2 * scale), y: round(y2 * scale)},
			{x: round(x1 * scale), y: round(y2 * scale)},
		]]
		return !clipper2.difference(rect, paths, clipper2.FillRule.EvenOdd).length
	}

	let slab_crossings = []

	// test slab coverage along the whole edge on the requested side;
	// include boundary crossings from that side without a sampling strip.
	function is_slab_side_covered(paths, is_v, c, m1, m2, dir) {
		let scale = prism_union.grid_scale
		c = round(c * scale)
		m1 = round(m1 * scale)
		m2 = round(m2 * scale)
		let crossings = slab_crossings
		crossings.length = 0
		for (let path of paths) {
			for (let i = 0; i < path.length; i++) {
				let p = path[i], q = path[(i + 1) % path.length]
				let a1 = is_v ? p.x : p.y
				let a2 = is_v ? q.x : q.y
				let lo = min(a1, a2), hi = max(a1, a2)
				let is_crossing = dir > 0 ? lo <= c && c < hi
					: lo < c && c <= hi
				if (is_crossing)
					crossings.push(is_v ? p.y : p.x)
			}
		}
		crossings.sort((a, b) => a - b)
		let end = m1
		for (let i = 0; i < crossings.length; i += 2) {
			let lo = crossings[i], hi = crossings[i + 1]
			if (hi <= end)
				continue
			if (lo > end)
				return false
			end = hi
			if (end >= m2)
				return true
		}
		return false
	}

	// grid paths of the slab between floor0 below, which can be null, and
	// floor1 above. roof_paths0: the grid paths of floor0's roof areas.
	function slab_paths(floor0, floor1, roof_paths0, open_rooms) {
		let {union, difference, FillRule} = clipper2
		let EO = FillRule.EvenOdd
		let paths
		if (!floor0) {
			paths = add_outline_paths(floor1, [])
		} else {
			let outline0 = add_outline_paths(floor0, [])
			let outline1 = add_outline_paths(floor1, [])
			open_rooms ??= make_opening_paths(floor0, floor1, outline0)
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
		let roof_t = house.roof_thickness
		let floors = house.floors
		let floor_n = top_floor.i + 1
		let {intersect, difference, FillRule} = clipper2
		let EO = FillRule.EvenOdd

		// add a level prism of grid paths from z1 to z2.
		function add_level_prism(paths, z1, z2) {
			prisms.push({
				paths: paths,
				bottom: [0, 0, z1],
				top: [0, 0, z2],
				tag: 'walls',
			})
		}

		// add a roof body of grid paths with the plane on top, roof_thickness
		// thick at right angles to it.
		function add_roof_prism(paths, plane) {
			let [a, b, c] = plane
			prisms.push({
				paths: paths,
				bottom: [a, b, c - roof_t * sqrt(1 + a * a + b * b)],
				top: plane,
				tag: 'roof',
				is_cutter: true,
			})
		}

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
						add_level_prism(wall_paths, bottom_z,
							min(bottom_z + sill, top_z))
					if (bottom_z + head < top_z)
						add_level_prism(wall_paths, bottom_z + head, top_z)
				}
			}
			add_level_prism(cut_wall_paths, bottom_z, top_z)
		}

		// areas: the roof areas of each floor; the terraces of top_floor.
		let roof_paths_by_floor = [] // [[path, ...], ...] grid paths
		let roof_faces_by_floor = [] // [faces, ...]
		let eave_sides_by_floor = [] // [[side, ...], ...] from make_roof_faces()
		let terrace_paths = empty_array // grid paths of top_floor's terraces
		for (let floor_i = 0; floor_i < floor_n; floor_i++) {
			let floor = floors[floor_i]

			// top_floor without its roofs: no roof areas and no terraces.
			if (floor == top_floor && no_roof) {
				roof_paths_by_floor.push(empty_array)
				eave_sides_by_floor.push(empty_array)
				roof_faces_by_floor.push(empty_array)
				continue
			}

			let roof_geometry = floor.make_roof_geometry()

			// terraces of top_floor: for the slab on top of it. terraces of
			// the other floors: half-walls around them on the slab above.
			if (floor == top_floor) {
				terrace_paths = roof_geometry.terrace_paths
			} else if (roof_geometry.half_wall_paths.length) {
				let z = floors[floor_i+1].z + slab_t
				add_level_prism(roof_geometry.half_wall_paths,
					z, z + house.half_wall_h)
			}

			roof_paths_by_floor.push(roof_geometry.roof_paths)
			eave_sides_by_floor.push(roof_geometry.eave_sides)
			roof_faces_by_floor.push(roof_geometry.roof_faces)
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
				let roof_z = max_face_z(roof_faces_by_floor[floor_i], -1/0)
				add_wall_prisms(floor, geometry, roof_paths, roof_z, true)
				add_wall_prisms(floor, geometry, roof_paths, top_z, false)
			} else {
				add_wall_prisms(floor, geometry, roof_paths, top_z)
			}
		}

		// slabs: slab i is at the bottom of floor i.
		for (let i = 0; i < floor_n; i++) {
			let floor = floors[i]
			add_level_prism(
				slab_paths(floors[i-1], floor, roof_paths_by_floor[i-1]),
				floor.z, floor.z + slab_t)
		}

		// terraces of top_floor: a slab on top of it.
		if (terrace_paths.length) {
			let z = top_floor.z + top_floor.h
			add_level_prism(terrace_paths, z, z + slab_t)
		}

		// roofs: one body per roof face, with the face on top, roof_thickness
		// thick at right angles to it. the roof cuts the walls and slabs under
		// it. where faces of different pitches meet, the underside has a step.
		for (let roof_faces of roof_faces_by_floor) {
			for (let face of roof_faces) {
				let paths = []
				for (let ring of face.rings)
					add_ring_path(paths, ring)
				add_roof_prism(paths, face.plane)
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
					add_roof_prism([[{x: x1, y: y1}, {x: x2, y: y1},
						{x: x2, y: y2}, {x: x1, y: y2}]], plane)
				}
			}
		}

		profile_time('prism.build', t0)
		return prism_union(prisms)
	}

	// geometry queries -------------------------------------------------------

	// the room side nearest to the rect of half sizes (hx, hy) around (x, y),
	// among the vertical sides (want_v) or the horizontal sides (want_h) that
	// the rect overlaps along: [dir, c, m1, m2] if it is within snap_d.
	// reuse out when supplied; otherwise allocate only for a found side.
	// a room's free space is on the left of the walking direction of its
	// sides, so the wall is on the right.
	function find_wall_side(floor, x, y, hx, hy, snap_d,
		want_v, want_h, out) {
		let min_gap = Infinity
		let found_side
		for (let side of floor.room_sides) {
			let is_v = side[0] % 2 == 1
			if (is_v ? !want_v : !want_h)
				continue
			if (!wall_side_overlaps(side, x, y, hx, hy))
				continue
			let gap = abs(wall_side_min(side, 2 * hx, 2 * hy)
				- (is_v ? x - hx : y - hy))
			if (gap <= snap_d && gap < min_gap) {
				min_gap = gap
				found_side = array_set(found_side ?? out ?? [], side)
			}
		}
		return found_side
	}

	// the rect of half sizes (hx, hy) around (x, y) is inside the plan's
	// rooms, touching their sides: no side crosses it and its center is
	// inside an odd number of room rings.
	function is_rect_in_rooms(floor, x, y, hx, hy) {
		let is_odd = false
		for (let side of floor.room_sides) {
			let [dir, c, m1, m2] = side
			let is_v = dir % 2 == 1
			let m_lo = min(m1, m2)
			let m_hi = max(m1, m2)
			let across = is_v ? x : y
			let h_across = is_v ? hx : hy
			if (c > across - h_across && c < across + h_across
				&& wall_side_overlaps(side, x, y, hx, hy)
			)
				return false
			if (is_v && c > x && m_lo <= y && y < m_hi)
				is_odd = !is_odd
		}
		return is_odd
	}

	// object coordinates -----------------------------------------------------

	let object_matrix = mat3()
	let object_point = v2()
	let object_point1 = v2()
	let local_box = [0, 0, 0, 0]

	// reuse one rotation matrix. Round quarter turns to keep wall alignment
	// exact.
	function object_rotation(rot) {
		let m = object_matrix.reset().rotate(-rot * rad)
		if (rot % 90 == 0) {
			m[0] = round(m[0]); m[1] = round(m[1])
			m[3] = round(m[3]); m[4] = round(m[4])
		}
		return m
	}

	// convert a displacement from object coordinates to plan coordinates.
	function object_vector_to_plan(object, x, y, out) {
		return object_point.set(x, y).transform(object_rotation(object.rot), out)
	}

	// convert a displacement from plan coordinates to object coordinates.
	function plan_vector_to_object(object, x, y, out) {
		return object_point.set(x, y).transform(object_rotation(-object.rot),
			out)
	}

	// return the object's plan bounding box [x1, y1, x2, y2].
	function get_object_box(plan, object, out) {
		return house_object_types[object.type].box(plan, object, out)
	}

	// calculate the plan bounding box from object.x, object.y, w and l.
	// Swap width and length for quarter turns. For diagonal chairs, use the
	// same box as before the additional 45-degree turn.
	function rect_box(object, w, l, out) {
		let is_turned = object.rot % 180 >= 90
		out[0] = object.x
		out[1] = object.y
		out[2] = object.x + (is_turned ? l : w)
		out[3] = object.y + (is_turned ? w : l)
		return out
	}

	let origin_box = [0, 0, 0, 0] // temporary box for the origin

	// return the type's local origin in plan coordinates, or the box centre.
	function get_object_origin(plan, object, out) {
		let origin = house_object_types[object.type].origin
		if (origin)
			return origin(plan, object, out)
		let [x1, y1, x2, y2] = get_object_box(plan, object, origin_box)
		return out.set((x1 + x2) / 2, (y1 + y2) / 2)
	}

	let origin_point = v2() // temporary origin for coordinate conversions

	// convert a point from object coordinates to plan coordinates.
	function object_to_plan(plan, object, x, y, out) {
		let [ox, oy] = get_object_origin(plan, object, origin_point)
		let m = object_rotation(object.rot).translate(ox, oy)
		return object_point.set(x, y).transform(m, out)
	}

	// convert a point from plan coordinates to object coordinates.
	function plan_to_object(plan, object, x, y, out) {
		let [ox, oy] = get_object_origin(plan, object, origin_point)
		return plan_vector_to_object(object, x - ox, y - oy, out)
	}

	// calculate a plan bounding box after rotating local bounds by rot degrees
	// and translating their origin to plan coordinates (x, y).
	function rotated_box(x, y, bounds, rot, out) {
		let m = object_rotation(rot).translate(x, y)
		let [x1, y1, x2, y2] = bounds
		let hx = (x2 - x1) / 2
		let hy = (y2 - y1) / 2
		object_point.set((x1 + x2) / 2, (y1 + y2) / 2).transform(m)
		let wx = abs(m[0]) * hx + abs(m[3]) * hy
		let wy = abs(m[1]) * hx + abs(m[4]) * hy
		out[0] = object_point[0] - wx
		out[1] = object_point[1] - wy
		out[2] = object_point[0] + wx
		out[3] = object_point[1] + wy
		return out
	}

	let box = [0, 0, 0, 0] // temporary bounding box for placing and resizing

	// rectangle resizing -----------------------------------------------------

	// return the allowed size nearest to size without exceeding max_size.
	// Accept a list or range of sizes. Return null if no allowed size fits.
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

	// resize the rectangular object while keeping the opposite end fixed.
	// When dragging the end with the smaller plan coordinate, update x or y too.
	function start_resize_rect(plan, object, side, axis = 'w') {
		let object_type = house_object_types[object.type]
		let is_l = axis == 'l'
		// convert the direction of the dragged end to plan coordinates.
		object_vector_to_plan(object, is_l ? 0 : side, is_l ? side : 0,
			object_point1)
		let ux = object_point1[0], uy = object_point1[1]
		let [x1, y1, x2, y2] = get_object_box(plan, object, box)
		let size0 = ux ? x2 - x1 : y2 - y1
		let x0 = object.x, y0 = object.y
		let sizes = object_type.sizes[axis]
		let limit = object_type.limit_size
		let max_size = limit ? limit(plan, object, side, axis) : Infinity
		let snap = is_l ? object_type.snap_l : null
		return {resize: function(dx, dy, snap_d = 0) {
			let size = snap_object_size(sizes, size0 + dx * ux + dy * uy,
				max_size)
			if (size == null)
				return
			if (snap)
				size = snap(plan, object, size, snap_d)
			object[axis] = size
			object.x = x0 + min(ux, 0) * (size - size0)
			object.y = y0 + min(uy, 0) * (size - size0)
		}}
	}

	// openings ---------------------------------------------------------------

	// test whether the opening runs along the plan y axis.
	function opening_is_v(object) {
		return object.rot % 180 == 90
	}

	// compare positions of openings on the same wall segment. Their x
	// coordinates match on a vertical wall; their y coordinates match
	// otherwise.
	function compare_seg_objects(object1, object2) {
		return object1.x - object2.x || object1.y - object2.y
	}

	// return the opening's midpoint on the wall centre line as its local
	// origin.
	function opening_origin(plan, object, out) {
		let is_v = opening_is_v(object)
		return out.set(object.x + (is_v ? 0 : object.w / 2),
			object.y + (is_v ? object.w / 2 : 0))
	}

	// snap the opening to the nearest wall segment within snap_d that has
	// space. Rotate it if the wall runs along the other axis. Otherwise leave
	// it in place.
	function place_opening(plan, object, snap_d) {

		// the nearest wall segment with space for the opening, within snap_d.
		let [x, y] = opening_origin(plan, object, object_point1)
		let seg1, m1
		let min_d = snap_d
		for (let seg of plan.segs) {

			// seg farther than the nearest one found: skip it.
			let is_v = seg.is_v
			let across = is_v ? x : y
			let along = is_v ? y : x
			let d = Math.hypot(across - seg.axis,
				max(seg.m1 - along, 0, along - seg.m2))
			if (d > min_d)
				continue

			// the other openings on seg, in order along it.
			let seg_objects = []
			for (let object1 of plan.objects)
				if (object1 != object && object1.seg == seg)
					seg_objects.push(object1)
			seg_objects.sort(compare_seg_objects)

			// the starting coordinate nearest to m where this opening fits on
			// seg, clear of the other openings: none if there is no space.
			let m = round(along - object.w / 2)
			let fit_m
			let lo = seg.wall_m1
			for (let i = 0; i <= seg_objects.length; i++) {
				let object1 = seg_objects[i]
				let hi = seg.wall_m2
				if (object1)
					hi = is_v ? object1.y : object1.x
				let m2 = hi - object.w
				if (lo <= m2) {
					let m_gap = clamp(m, lo, m2)
					if (fit_m == null || abs(m_gap - m) < abs(fit_m - m))
						fit_m = m_gap
				}
				if (object1)
					lo = (is_v ? object1.y : object1.x) + object1.w
			}
			if (fit_m == null)
				continue

			// the nearest segment with space so far.
			min_d = d
			seg1 = seg
			m1 = fit_m
		}

		// on a wall: on the floor, along the wall, at the found coordinate.
		object.on_floor = seg1 != null
		if (seg1) {
			object.seg = seg1
			if (opening_is_v(object) != seg1.is_v) // keep facing on the same axis.
				object.rot = seg1.is_v ? 90 : 0
			object.x = seg1.is_v ? seg1.axis : m1
			object.y = seg1.is_v ? m1 : seg1.axis
		}
	}

	// return the maximum width while keeping the opposite end fixed.
	// Stop at the next opening or wall endpoint in the resize direction.
	// Return Infinity if the opening is not on a wall.
	function limit_opening_w(plan, object, side) {
		let seg = object.seg
		if (!seg)
			return Infinity
		let is_v = seg.is_v
		object_vector_to_plan(object, side, 0, object_point1)
		let dir = is_v ? object_point1[1] : object_point1[0] // wall direction
		let m = is_v ? object.y : object.x
		let end_m = dir > 0 ? m : m + object.w // fixed endpoint
		let limit_m = dir > 0 ? seg.wall_m2 : seg.wall_m1
		for (let object1 of plan.objects) {
			if (object1 == object || object1.seg != seg)
				continue
			let m1 = is_v ? object1.y : object1.x
			let edge_m = dir > 0 ? m1 : m1 + object1.w // other opening endpoint
			if (dir * (edge_m - end_m) >= 0 && dir * (edge_m - limit_m) < 0)
				limit_m = edge_m
		}
		return dir * (limit_m - end_m)
	}

	// calculate the opening's plan bounding box using its width and wall
	// thickness. For an opening off the wall, use the exterior wall thickness.
	function opening_box(plan, object, out) {
		let is_v = opening_is_v(object)
		let a = is_v ? object.x : object.y
		let m = is_v ? object.y : object.x
		let a1, a2
		if (object.seg) {
			a1 = object.seg.wall_a1
			a2 = object.seg.wall_a2
		} else {
			a1 = a - house.ext_wall_thickness / 2
			a2 = a + house.ext_wall_thickness / 2
		}
		out[0] = is_v ? a1 : m
		out[1] = is_v ? m : a1
		out[2] = is_v ? a2 : m + object.w
		out[3] = is_v ? m + object.w : a2
		return out
	}

	// furniture --------------------------------------------------------------

	function furniture_box(plan, object, out) {
		return rect_box(object, object.w, object.l, out)
	}

	// snap allowed furniture faces to room walls within snap_d. Rotate around
	// the centre if needed, and keep that rotation after leaving the wall.
	// Set on_floor according to whether the whole box fits inside the rooms.
	function place_furniture(plan, object, snap_d, snap_margin = 0) {

		// forget the previous snaps.
		let faces = house_object_types[object.type].snap_faces
		let side0 = object.snap_side
		object.snap_side = null
		object.side_x = null
		object.side_y = null

		if (faces) {

			// find a room side and rotation for the allowed faces around the
			// box centre; prefer the previous side within the switching margin.
			let [x1, y1, x2, y2] = get_object_box(plan, object, box)
			let cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
			let min_gap = Infinity
			let found_side, found_rot
			let found_old = false
			for (let side of plan.room_sides) {
				let [dir, c, m1, m2] = side
				let is_v = dir % 2 == 1
				let face = (dir - object.rot / 90 + 4) % 4
				let rot = faces.includes(face) ? object.rot
					: (dir - faces[0] + 4) % 4 * 90
				let is_turned = rot % 180 == 90
				let hx = (is_turned ? object.l : object.w) / 2
				let hy = (is_turned ? object.w : object.l) / 2
				if (!wall_side_overlaps(side, cx, cy, hx, hy))
					continue
				let gap = abs(wall_side_min(side, 2 * hx, 2 * hy)
					- (is_v ? cx - hx : cy - hy))
				if (gap > snap_d)
					continue
				let is_old = side0 && side0[0] == dir && side0[1] == c
					&& side0[2] == m1 && side0[3] == m2
				if (is_old)
					gap -= snap_margin
				let is_old_tie = gap == min_gap && is_old && !found_old
				if (gap < min_gap || is_old_tie) {
					min_gap = gap
					found_side = array_set(found_side ?? [], side)
					found_rot = rot
					found_old = is_old
				}
			}

			if (found_side) {

				// turn the box around its centre.
				object.rot = found_rot
				let [bx1, by1, bx2, by2] = get_object_box(plan, object, box)
				let w = bx2 - bx1, h = by2 - by1
				object.x = round(cx - w / 2)
				object.y = round(cy - h / 2)
				object.snap_side = found_side

				// snap to the chosen wall, then to the nearest perpendicular wall.
				rest_on_side(plan, object, found_side, w, h)
				let is_x = found_side[0] % 2 == 1
				let side = find_wall_side(plan, object.x + w / 2,
					object.y + h / 2, w / 2, h / 2, snap_d, !is_x, is_x)
				if (side)
					rest_on_side(plan, object, side, w, h)
			}
		}

		// on the floor: the whole box is inside the rooms.
		let [x1, y1, x2, y2] = get_object_box(plan, object, box)
		object.on_floor = is_rect_in_rooms(plan, (x1 + x2) / 2, (y1 + y2) / 2,
			(x2 - x1) / 2, (y2 - y1) / 2)
	}

	// move the object against the room side and record it in side_x or
	// side_y. w and h are the object's width and height along the plan axes.
	function rest_on_side(plan, object, side, w, h) {
		if (side[0] % 2) {
			object.side_x = side
			object.x = wall_side_min(side, w, h)
		} else {
			object.side_y = side
			object.y = wall_side_min(side, w, h)
		}
	}

	// call place_furniture(), then turn the chair diagonally if it is in a
	// corner. Point its back towards the corner. Keep its plan box square.
	function place_chair(plan, object, snap_d, snap_margin = 0) {
		place_furniture(plan, object, snap_d, snap_margin)
		let {side_x, side_y} = object
		if (!(side_x && side_y))
			return
		let [dir_x, wall_x, y1, y2] = side_x
		let [dir_y, wall_y, x1, x2] = side_y
		// check that both wall faces end at their shared corner.
		if (
			!(y1 == wall_y || y2 == wall_y) ||
			!(x1 == wall_x || x2 == wall_x)
		)
			return
		object.rot = dir_x * 90 + (dir_x == dir_y + 1 ? -45 : 45)
	}

	// return the maximum width or length while keeping the opposite end fixed.
	// Stop at the nearest room wall in the resize direction.
	// Return Infinity if the furniture is not on the floor.
	function limit_furniture_size(plan, object, side, axis) {
		if (!object.on_floor)
			return Infinity

		// the resize direction along the plan axes and the fixed end.
		let is_l = axis == 'l'
		let is_x = (object.rot % 180 == 0) != is_l // resize along plan x
		object_vector_to_plan(object, is_l ? 0 : side, is_l ? side : 0,
			object_point1)
		let dir = is_x ? object_point1[0] : object_point1[1]
		let [x1, y1, x2, y2] = get_object_box(plan, object, box)
		let end = dir > 0 ? (is_x ? x1 : y1) : (is_x ? x2 : y2) // fixed endpoint

		// the nearest room side across the resize axis, beyond the fixed end.
		let x = (x1 + x2) / 2, y = (y1 + y2) / 2
		let hx = (x2 - x1) / 2, hy = (y2 - y1) / 2
		let limit_c = dir * Infinity
		for (let room_side of plan.room_sides) {
			if ((room_side[0] % 2 == 1) != is_x)
				continue
			if (!wall_side_overlaps(room_side, x, y, hx, hy))
				continue
			let c = room_side[1]
			if (dir * (c - end) > 0 && dir * (c - limit_c) < 0)
				limit_c = c
		}
		return dir * (limit_c - end)
	}

	// countertop -------------------------------------------------------------

	// contour contains clockwise local coordinates [x, y, ...]. The two free
	// ends start at coordinate offsets 0 and contour.length / 2.
	function countertop_bounds(object, out) {
		let a = object.contour
		let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
		for (let i = 0; i < a.length; i += 2) {
			x1 = min(x1, a[i]); y1 = min(y1, a[i+1])
			x2 = max(x2, a[i]); y2 = max(y2, a[i+1])
		}
		local_box[0] = x1; local_box[1] = y1
		local_box[2] = x2; local_box[3] = y2
		return rotated_box(0, 0, local_box, object.rot, out)
	}

	function countertop_box(plan, object, out) {
		countertop_bounds(object, out)
		out[2] = object.x + out[2] - out[0]
		out[3] = object.y + out[3] - out[1]
		out[0] = object.x; out[1] = object.y
		return out
	}

	function countertop_origin(plan, object, out) {
		countertop_bounds(object, box)
		return out.set(object.x - box[0], object.y - box[1])
	}

	function place_countertop(plan, object, snap_d) {
		let a = object.contour, n = a.length
		let points = [], ys = [], xs = []
		let [ox, oy] = countertop_origin(plan, object, object_point1)
		for (let i = 0; i < n; i += 2) {
			object_vector_to_plan(object, a[i], a[i+1], object_point1)
			points.push(ox + object_point1[0], oy + object_point1[1])
			ys.push(oy + object_point1[1])
		}
		object.side_x = null; object.side_y = null
		for (let axis = 0; axis < 2; axis++) {
			let shift = 0, gap = snap_d, found
			for (let i = 0; i < n; i += 2) {
				let j = (i+2) % n
				let x = (points[i] + points[j]) / 2
				let y = (points[i+1] + points[j+1]) / 2
				let hx = abs(points[i] - points[j]) / 2
				let hy = abs(points[i+1] - points[j+1]) / 2
				if (axis ? hy != 0 : hx != 0)
					continue
				let side = find_wall_side(plan, x, y, hx, hy, gap,
					!axis, !!axis)
				if (side) {
					shift = side[1] - (axis ? y : x)
					gap = abs(shift)
					found = side
				}
			}
			if (axis) { object.y += shift; object.side_y = found ?? null }
			else { object.x += shift; object.side_x = found ?? null }
			for (let i = axis; i < n; i += 2)
				points[i] += shift
			if (axis)
				for (let i = 0; i < ys.length; i++) ys[i] += shift
		}
		ys.sort((a, b) => a - b)
		object.on_floor = true
		for (let k = 1; k < ys.length; k++) {
			let y1 = ys[k-1], y2 = ys[k], y = (y1 + y2) / 2
			if (y1 == y2)
				continue
			xs.length = 0
			for (let i = 0; i < n; i += 2) {
				let j = (i+2) % n
				if ((points[i+1] > y) != (points[j+1] > y))
					xs.push(points[i])
			}
			xs.sort((a, b) => a - b)
			for (let i = 0; i < xs.length; i += 2) {
				if (xs[i] == xs[i+1])
					continue
				if (!is_rect_in_rooms(plan, (xs[i] + xs[i+1]) / 2, y,
					(xs[i+1] - xs[i]) / 2, (y2 - y1) / 2)) {
					object.on_floor = false
					return
				}
			}
		}
	}

	let countertop_edge = [0, 0, 0, 0]

	// encode a handle as edge_index * 3 + zone + 1.
	// zone is 0 for the middle, 1 for the start and 2 for the end of the edge.
	function get_countertop_edge(object, handle, out) {
		let a = object.contour, n = a.length / 2
		let i = floor((handle-1) / 3), zone = (handle-1) % 3
		let p = i*2, q = (p+2) % a.length
		let ux = sign(a[q] - a[p]), uy = sign(a[q+1] - a[p+1])
		let length = abs(a[q] - a[p]) + abs(a[q+1] - a[p+1])
		let start = i == 1 || i == n/2+1
		let end = i == n-1 || i == n/2-1
		let prev = (p+a.length-2) % a.length, next = (q+2) % a.length
		let w1 = start ? abs(a[p]-a[prev]) + abs(a[p+1]-a[prev+1]) : 0
		let w2 = end ? abs(a[q]-a[next]) + abs(a[q+1]-a[next+1]) : 0
		w1 = min(w1, end ? floor(length/2) : length)
		w2 = min(w2, start ? floor(length/2) : length)
		let lo = zone == 1 ? 0 : zone == 2 ? length-w2 : w1
		let hi = zone == 1 ? w1 : zone == 2 ? length : length-w2
		out[0] = a[p] + ux*lo; out[1] = a[p+1] + uy*lo
		out[2] = a[p] + ux*hi; out[3] = a[p+1] + uy*hi
		return hi > lo
	}

	const countertop_depth_range = {min: 400, max: 1200, step: 50}

	function start_resize_countertop(plan, object, handle) {

		// the contour at the press, the dragged edge i..j, its handle segment
		// and its outward normal.
		let a = object.contour.slice(), n = a.length
		let i = floor((handle-1) / 3)*2, j = (i+2) % n
		let zone = (handle-1) % 3
		let nx = sign(a[j+1]-a[i+1]), ny = -sign(a[j]-a[i])
		get_countertop_edge(object, handle, countertop_edge)
		let [x1, y1, x2, y2] = countertop_edge
		let [ox, oy] = countertop_origin(plan, object, object_point1)

		// how far the edge can move before it passes its neighbours' ends,
		// and the countertop's depth across it.
		let prev = (i+n-2) % n, next = (j+2) % n
		let l1 = (a[i]-a[prev])*nx + (a[i+1]-a[prev+1])*ny
		let l2 = (a[j]-a[next])*nx + (a[j+1]-a[next+1])*ny
		let min_d = max(l1 >= 0 ? -l1 : -Infinity,
			l2 >= 0 ? -l2 : -Infinity)
		let max_d = min(l1 < 0 ? -l1 : Infinity, l2 < 0 ? -l2 : Infinity)
		let is_depth = !zone && i != 0 && i != n/2
		let opposite = (n-i) % n
		let depth = (a[i]-a[opposite])*nx + (a[i+1]-a[opposite+1])*ny
		let s = {contour0: a}
		s.resize = function(dx, dy, snap_d = 0, nosnap = false) {

			// the pointer's displacement across the edge.
			plan_vector_to_object(object, dx, dy, object_point1)
			let d = round(object_point1[0]*nx + object_point1[1]*ny)

			// snap the moved edge to the nearest room side across it.
			if (snap_d > 0 && !(is_depth && !nosnap)) {
				object_vector_to_plan(object, nx, ny, object_point1)
				let ux = object_point1[0], uy = object_point1[1]
				object_vector_to_plan(object, (x1+x2)/2, (y1+y2)/2,
					object_point1)
				let hx = abs(x2-x1)/2, hy = abs(y2-y1)/2
				if (object.rot % 180) { let h = hx; hx = hy; hy = h }
				let x = ox+object_point1[0]+ux*d
				let y = oy+object_point1[1]+uy*d
				let is_x = !!ux
				let across = is_x ? x : y
				let min_gap = snap_d, shift = 0
				for (let side of plan.room_sides) {
					if ((side[0] % 2 == 1) != is_x)
						continue
					if (!wall_side_overlaps(side, x, y, hx, hy))
						continue
					let gap = side[1] - across
					if (abs(gap) <= min_gap) {
						min_gap = abs(gap)
						shift = (ux || uy) * gap
					}
				}
				d += shift
			}

			// clamp the edge between its neighbours; snap the depth.
			if (!zone) {
				d = clamp(d, min_d, max_d)
				if (is_depth && !nosnap) {
					let size = snap_object_size(countertop_depth_range, depth+d,
						depth+max_d)
					if (size == null || size-depth < min_d)
						return
					d = size-depth
				}
			}

			// rebuild the contour from the one at the press. corner zone
			// moved out: add a leg. middle of an edge: move the edge. free
			// end moved past a neighbour's end: remove that leg.
			let b = object.contour
			b.length = n
			for (let k = 0; k < n; k++) b[k] = a[k]
			if (zone && d > 0) {
				if (zone == 1)
					b.splice(i, 2, x1+nx*d, y1+ny*d, x2+nx*d, y2+ny*d,
						x2, y2)
				else
					b.splice(j, 2, x1, y1, x1+nx*d, y1+ny*d,
						x2+nx*d, y2+ny*d)
				if (zone == 1 ? i == 2 : j == 0)
					b.push(...b.splice(0, 2))
			} else if (!zone) {
				b[i] += nx*d; b[i+1] += ny*d
				b[j] += nx*d; b[j+1] += ny*d
				if (n > 8 && (i == 0 || i == n/2)) {
					if (l1 > 0 && d <= -l1) {
						b[j] = a[j]-nx*l1; b[j+1] = a[j+1]-ny*l1
						if (i == 0) { b.splice(n-2, 2); b.splice(0, 2) }
						else b.splice(prev, 4)
					} else if (l2 > 0 && d <= -l2) {
						b[i] = a[i]-nx*l2; b[i+1] = a[i+1]-ny*l2
						b.splice(j, 4)
						if (i == 0) b.unshift(...b.splice(b.length-2, 2))
					}
				}
			}

			// keep the origin in place: move the box corner with the contour.
			countertop_bounds(object, box)
			object.x = ox + box[0]; object.y = oy + box[1]
		}
		return s
	}

	// stairs -----------------------------------------------------------------

	// calculate step heights and depths for the distance between floors.
	// Cache the results for placement, drawing and editing.
	function stair_shape(plan, object) {
		let height = house.floors[plan.i-1]?.h ?? house.floor_h
		let s = object.stair ??= {}
		if (s.height == height && s.riser_height == object.riser_height
			&& s.tread_depth == object.tread_depth && s.fixed_l == object.l)
			return s
		s.height = height
		s.riser_height = object.riser_height
		s.tread_depth = object.tread_depth
		s.fixed_l = object.l
		s.n = 0
		let min_difference = Infinity, min_distance = Infinity
		let n = max(2, ceil(height / 190))
		let max_n = floor(height / 150)
		for (; n <= max_n; n++) {
			let rise = round(height / n / 5) * 5
			let bottom_rise = height - (n - 1) * rise
			if (rise < 150 || rise > 190 || bottom_rise < 150
				|| bottom_rise > 190)
				continue
			let difference = abs(bottom_rise - rise)
			let distance = abs(rise - object.riser_height)
			if (difference > min_difference
				|| difference == min_difference && distance >= min_distance)
				continue
			min_difference = difference
			min_distance = distance
			s.n = n
			s.rise = rise
			s.bottom_rise = bottom_rise
		}
		let tread_n = max(1, s.n - 1)
		s.depth = round((object.l == null ? object.tread_depth
			: object.l / tread_n) / 5) * 5
		s.l = object.l ?? tread_n * s.depth
		s.bottom_depth = s.l - (tread_n - 1) * s.depth
		return s
	}

	function stair_box(plan, object, out) {
		return rect_box(object, object.w, stair_shape(plan, object).l, out)
	}

	// use the midpoint of the top edge as the origin for the stair sketch and
	// model. Local +y points down the stairs.
	function stair_origin(plan, object, out) {
		let [x1, y1, x2, y2] = stair_box(plan, object, origin_box)
		object_vector_to_plan(object, 0, -stair_shape(plan, object).l / 2, out)
		return out.set((x1 + x2) / 2 + out[0], (y1 + y2) / 2 + out[1])
	}

	// place the stairs at a valid slab opening on their owning upper floor.
	function place_stair(plan, object, snap_d) {
		let s = stair_shape(plan, object)
		object.on_floor = false
		if (!plan.i || !s.n || s.depth <= 0 || s.bottom_depth <= 0)
			return

		// the openings in the slab under the floor, and the slab.
		let floor0 = house.floors[plan.i-1]
		let openings = make_opening_paths(floor0, plan)
		if (!openings.length)
			return
		let roof_paths0 = floor0.make_roof_geometry().roof_paths
		let slab = slab_paths(floor0, plan, roof_paths0, openings)

		// find a wall connection with room for the stairs in the opening and
		// slab across the whole landing edge beyond the wall.
		let [x, y] = stair_origin(plan, object, object_point1)
		let w = object.w, l = s.l
		let min_gap = Infinity, found_x, found_y, found_rot
		for (let seg of plan.segs) {
			let is_v = seg.is_v
			let along = is_v ? y : x
			let m1 = along - w / 2, m2 = along + w / 2
			if (m1 < seg.wall_m1 || m2 > seg.wall_m2)
				continue
			for (let side = 0; side < 2; side++) {
				let c = side ? seg.wall_a2 : seg.wall_a1
				let rot = is_v ? (side ? 270 : 90) : (side ? 0 : 180)
				if (!snap_d && rot != object.rot)
					continue
				let gap = abs(c - (is_v ? x : y))
				if (gap > snap_d)
					continue
				if (gap >= min_gap)
					continue
				let end = c + (side ? l : -l)
				let lo = min(c, end), hi = max(c, end)
				if (!is_rect_in_paths(openings,
					is_v ? lo : m1, is_v ? m1 : lo,
					is_v ? hi : m2, is_v ? m2 : hi))
					continue
				let beyond = side ? seg.wall_a1 : seg.wall_a2
				if (!is_slab_side_covered(slab, is_v, beyond, m1, m2,
					side ? -1 : 1))
					continue
				min_gap = gap
				found_x = is_v ? c : x
				found_y = is_v ? y : c
				found_rot = rot
			}
		}
		if (found_rot == null)
			return

		// put the top edge's midpoint at the found point.
		local_box[0] = -w / 2
		local_box[1] = 0
		local_box[2] = w / 2
		local_box[3] = l
		rotated_box(found_x, found_y, local_box, found_rot, box)
		object.x = box[0]
		object.y = box[1]
		object.rot = found_rot
		object.on_floor = true
	}

	// snap the bottom of the stairs to a wall face that spans the stairs'
	// width, near the requested length.
	function snap_stair_l(plan, object, l, snap_d) {
		let [x, y] = stair_origin(plan, object, object_point1)
		let w = object.w
		let r = object.rot * rad
		let ux = round(cos(r)), uy = round(sin(r))
		let length1 = l
		let min_gap = snap_d
		for (let seg of plan.segs) {
			if (seg.is_v != !!uy)
				continue
			let along = seg.is_v ? y : x
			if (along - w / 2 < seg.wall_m1
				|| along + w / 2 > seg.wall_m2)
				continue
			let c = seg.is_v ? x : y
			let sign = seg.is_v ? -uy : ux
			for (let face of [seg.wall_a1, seg.wall_a2]) {
				let length = (face - c) * sign
				let gap = abs(length - l)
				if (length > 0 && gap <= min_gap) {
					min_gap = gap
					length1 = length
				}
			}
		}
		return length1
	}

	// tags -------------------------------------------------------------------

	// assign the tag to this floor if its point is inside a room.
	function place_open_room(plan, object) {
		object.on_floor = !!plan.hit_cycle_edges(object.x, object.y)
	}

	// assign the terrace tag to this floor if its point is over the floor
	// below and outside this floor's outline.
	function place_terrace(plan, object) {
		let plan0 = house.floors[plan.i-1]
		let x = object.x, y = object.y
		object.on_floor = !!plan0 && plan0.is_rect_touching_house(x, y, x, y)
			&& !plan.is_rect_touching_house(x, y, x, y)
	}

	// use a zero-size bounding box at the tag point.
	function tag_box(plan, object, out) {
		return rect_box(object, 0, 0, out)
	}

	// object types -----------------------------------------------------------

	let house_object_types = {

		window: {
			w: 1200,
			sill: 900, // height above the top of the slab, in mm
			head: 2100,
			in_wall: true,
			sizes: {w: {min: 300, step: 1}},
			place: place_opening,
			limit_size: limit_opening_w,
			box: opening_box,
			origin: opening_origin,
			start_resize: start_resize_rect,
		},

		door: {
			w: 900,
			sill: 0, // height above the top of the slab, in mm
			head: 2100,
			fields: {mirror: false}, // false: use the unmirrored door sketch
			in_wall: true,
			sizes: {w: {min: 600, max: 1100, step: 100}},
			place: place_opening,
			limit_size: limit_opening_w,
			box: opening_box,
			origin: opening_origin,
			start_resize: start_resize_rect,
		},

		bed: {
			w: 1400,
			fields: {l: 2000},
			sizes: {w: [900, 1400, 1600, 1800], l: [1900, 2000]},
			snap_faces: [0], // snap the head of the bed to walls
			place: place_furniture,
			limit_size: limit_furniture_size,
			box: furniture_box,
			start_resize: start_resize_rect,
		},

		chair: {
			w: 450,
			fields: {l: 450},
			snap_faces: [0], // snap the back of the chair to walls
			place: place_chair,
			box: furniture_box,
		},

		wc: {
			w: 400,
			fields: {l: 700},
			snap_faces: [0], // snap the toilet tank to walls
			place: place_furniture,
			box: furniture_box,
		},

		countertop: {
			fields: {contour: [0, 600, 0, 0, 1800, 0, 1800, 600]},
			place: place_countertop,
			box: countertop_box,
			origin: countertop_origin,
			start_resize: start_resize_countertop,
		},

		open_room: {
			opens_room: true,
			place: place_open_room,
			box: tag_box,
		},

		terrace: {
			marks_terrace: true,
			place: place_terrace,
			box: tag_box,
		},

		stair: {
			w: 900,
			fields: {riser_height: 175, tread_depth: 280, l: null},
			connects_below: true,
			sizes: {w: {min: 1, step: 1}, l: {min: 1, step: 1}},
			snap_l: snap_stair_l,
			place: place_stair,
			box: stair_box,
			origin: stair_origin,
			start_resize: start_resize_rect,
		},

	}

	house.object_types = house_object_types
	house.get_object_box = get_object_box
	house.get_object_origin = get_object_origin
	house.object_to_plan = object_to_plan
	house.plan_to_object = plan_to_object
	house.object_vector_to_plan = object_vector_to_plan
	house.plan_vector_to_object = plan_vector_to_object
	house.opening_is_v = opening_is_v
	house.opening_origin = opening_origin
	house.countertop_origin = countertop_origin
	house.get_countertop_edge = get_countertop_edge
	house.stair_shape = stair_shape

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

		assign(house, defaults, t)
		for (let k in defaults)
			house[k] = snap_length(house[k])

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
