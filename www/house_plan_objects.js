/*

	House plan object types: windows, doors, furniture, stairs and tags.
	Written by Cosmin Apreutesei. Public Domain.

	house_object_types -> {type -> object_type}

	object: {type:, x:, y:, rot:, w:, ...fields, seg:, on_floor:}
		x, y: in plan units (whole mm): the min corner of the object's plan
		     box; for an opening, its min end along its wall, on the wall's
		     center line; for a countertop, its first leg's start; for a tag,
		     its point.
		rot: degrees, in [0, 360): a multiple of 90, or 45 more than that for
		     a chair in a corner.
		seg: the floor's wall seg the object is on, or null. not saved.
		side_x, side_y: furniture only: the room side that place put the
		     object against across x (a vertical side) and across y (a
		     horizontal side), or null: [dir, c, m1, m2] where dir is the
		     direction to the wall (0 north, 1 east, 2 south, 3 west), c the
		     side's coordinate across it and m1, m2 its ends along it, in the
		     order that the room's free space is on the left. not saved.
		snap_side: furniture's primary snapped side, or null. not saved.
		on_floor: the object is in the floor's list, not the ground's: it is
		          in a wall or inside a room, or a tag on what it tags.
		          set by place, not saved.

	object_type:
		w                    default width
		fields               {name -> default} saved fields besides
		                     type, x, y, rot, w
		in_wall              optional: the object cuts a hole of its plan box
		                     in its wall, from sill to head above the
		                     floor's slab.
		sill, head           with in_wall: the hole's heights.
		opens_room           optional: a tag that opens the room it is in.
		marks_terrace        optional: a tag that makes the floor below's
		                     uncovered area that it is on a terrace.
		connects_below       optional: show and edit the object in the plan
		                     below its owning floor, too.
		snap_faces           optional: [i, ...] the sides of a furniture
		                     piece that can rest against a wall: 0 top,
		                     1 right, 2 bottom, 3 left. no snap_faces: the
		                     piece never snaps.
		sketch(object)       optional: the SVG path string of the object's
		                     outline in mm around its origin.
		place(plan, object, snap_d, snap_margin = 0)
		                     put the object where it is, which the plan sets
		                     with seg = null before the call, or on a wall of
		                     the plan within snap_d of its origin: sets x,
		                     y, rot, seg and on_floor.
		                     Furniture switches walls when the translation
		                     improves by more than snap_margin (plan units).
		box(plan, object, out) -> out
		                     fill out with the object's plan rect
		                     [x1, y1, x2, y2].
		origin(plan, object, out) -> out
		                     optional: fill out [x, y] with the plan point of
		                     the object's local origin, around which its
		                     sketch, sizes and model are drawn and which a
		                     move puts at the pointer. default: the box's
		                     center.
		sizes                optional: {w:, l:} the sizes the object can be
		                     resized to along its width axis (w) and its
		                     length axis (l): [size, ...] or
		                     {min:, max:, step:} (max is optional). the
		                     length resizes by dragging its bottom end, the
		                     end at +y in its sketch. its top end stays.
		limit_size(plan, object, side, axis) -> size
		                     optional: the largest the object can be along
		                     axis 'w' or 'l' when its end opposite to `side`
		                     (1 or -1 along the axis) stays in place.
		snap_l(plan, object, l, snap_d) -> l
		                     optional: snap a resized length.
		hit_resize(sg, plan, object, hs) -> boolean
		                     optional, with start_resize: hit a resize
		                     handle, writing hs.object_side and
		                     hs.object_axis ('w' or 'l'). hit_resize_rect
		                     hits the ends of the axes in sizes.
		start_resize(plan, object, side, axis) -> {resize(dx, dy, snap_d)}
		                     resize from the press displacement.
		                     start_resize_rect resizes the local box along
		                     sizes, limit_size and snap_l. the plan owns
		                     stop, cancel and list membership and places
		                     the object again after each resize.
		draw_resize(cx, plan, object, side)
		                     optional: stroke the hovered resize segment.
		draw_sizes(cx, sg, plan, object, draw_length)
		                     optional: draw the dimensions of the axes that
		                     the object can be resized on, with the editor's
		                     draw_length(cx, sg, x1, y1, x2, y2), which
		                     puts the dimension on the left of the line.
		draw_wall_dims(cx, sg, plan, object, draw_length)
		                     optional: draw the distances from the object
		                     to the ends of the wall or room side that it
		                     rests against.
		hit(sg, plan, object) -> true|'move'|false
		                     the pointer is over the object: true for all
		                     purposes, 'move' for moving it only, as over
		                     the area that a door sweeps.
		draw(cx, plan, object)
		                     draw local geometry with the current stroke
		                     style and line width. optional for mask-only types.
		draw_space           'screen' for upright pixel-sized drawings;
		                     otherwise use rotated, scaled plan units.
		draw_mask(cx, plan, object, bounds, sg)
		                     optional: draw the wall cut in plan pixels before
		                     the local sketch. bounds: the object's plan box.
		update(plan, object)
		                     optional: handle the object's own input
		                     while the object is hovered.
		create_model(editor, plan, object) -> component
		                     optional: construct a model3 component around
		                     the object's origin at its floor's slab top,
		                     y up, plan y along model z. the model editor
		                     places and rotates the component.

	plan: a floor of house_plan().
	sg: the floor editor's view: x(x), y(y), d(d) plan to screen.

	get_object_box(plan, object, out) -> out
		the type's box.
	get_object_origin(plan, object, out) -> out
		the type's origin, or the box's center.

*/

(function () {
"use strict"
const G = window

const {abs, min, max, clamp, floor, ceil, round, sign, rad, PI} = glue

const {mat3, v2} = Math3D

// object coordinates --------------------------------------------------------

let object_matrix = mat3()
let object_point = v2()
let object_point1 = v2()
let local_box = [0, 0, 0, 0]

// reuse the rotation matrix, keeping quarter turns exact at wall faces.
function object_rotation(rot) {
	let m = object_matrix.reset().rotate(-rot * rad)
	if (rot % 90 == 0) {
		m[0] = round(m[0]); m[1] = round(m[1])
		m[3] = round(m[3]); m[4] = round(m[4])
	}
	return m
}

// convert local displacements to plan axes without adding the anchor.
function object_vector_to_plan(object, x, y, out) {
	return object_point.set(x, y).transform(object_rotation(object.rot), out)
}

// convert plan displacements to local axes for resizing.
function plan_vector_to_object(object, x, y, out) {
	return object_point.set(x, y).transform(object_rotation(-object.rot), out)
}

// the object's plan rect [x1, y1, x2, y2].
function get_object_box(plan, object, out) {
	return house_object_types[object.type].box(plan, object, out)
}

// the rect of an object of width w and length l with its min corner at
// (x, y): a quarter turn swaps w and l; a chair turned by 45 degrees keeps
// its unturned rect.
function rect_box(object, w, l, out) {
	let is_turned = object.rot % 180 >= 90
	out[0] = object.x
	out[1] = object.y
	out[2] = object.x + (is_turned ? l : w)
	out[3] = object.y + (is_turned ? w : l)
	return out
}

let origin_box = [0, 0, 0, 0] // [x1, y1, x2, y2] of the object for its origin

// the plan point of the object's local origin: its type's origin, else the
// center of its box.
function get_object_origin(plan, object, out) {
	let origin = house_object_types[object.type].origin
	if (origin)
		return origin(plan, object, out)
	let [x1, y1, x2, y2] = get_object_box(plan, object, origin_box)
	return out.set((x1 + x2) / 2, (y1 + y2) / 2)
}

let origin_point = v2() // the object's origin in object_to_plan, plan_to_object

// convert sketch points to plan coordinates for bounds and dimensions.
function object_to_plan(plan, object, x, y, out) {
	let [ox, oy] = get_object_origin(plan, object, origin_point)
	let m = object_rotation(object.rot).translate(ox, oy)
	return object_point.set(x, y).transform(m, out)
}

// convert plan points to local coordinates for sketch hit testing.
function plan_to_object(plan, object, x, y, out) {
	let [ox, oy] = get_object_origin(plan, object, origin_point)
	return plan_vector_to_object(object, x - ox, y - oy, out)
}

// the plan rect of local bounds [x1, y1, x2, y2] turned by rot around the
// plan point (x, y).
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

let box = [0, 0, 0, 0] // [x1, y1, x2, y2] of the object hit or drawn

// the pointer is over the object's plan box.
function hit_box(sg, plan, object) {
	get_object_box(plan, object, box)
	return ui.hit_bbox(sg.x(box[0]), sg.y(box[1]),
		sg.x(box[2]), sg.y(box[3]))
}

// draw a local dimension with the editor's callback in plan coordinates.
function draw_object_length(cx, sg, plan, object, x1, y1, x2, y2,
	draw_length
) {
	object_to_plan(plan, object, x1, y1, object_point1)
	let px1 = object_point1[0], py1 = object_point1[1]
	object_to_plan(plan, object, x2, y2, object_point1)
	draw_length(cx, sg, px1, py1, object_point1[0], object_point1[1])
}

// rectangle resizing -------------------------------------------------------

// the size nearest to `size` in `sizes`, a list or a range from a type's
// sizes, that is at most max_size, or null if none is.
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

// resize along the plan box and keep the opposite end in place: the object's
// x or y is its min side along the axis, which moves when the dragged end is
// at the min side.
function start_resize_rect(plan, object, side, axis = 'w') {
	let object_type = house_object_types[object.type]
	let is_l = axis == 'l'
	// the plan direction of the dragged end.
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
		let size = snap_object_size(sizes, size0 + dx * ux + dy * uy, max_size)
		if (size == null)
			return
		if (snap)
			size = snap(plan, object, size, snap_d)
		object[axis] = size
		object.x = x0 + min(ux, 0) * (size - size0)
		object.y = y0 + min(uy, 0) * (size - size0)
	}}
}

// hit an end of the object's width axis or the bottom end of its length axis,
// from a little inside it to a little outside it, within the object's depth.
function hit_resize_rect(sg, plan, object, hs) {
	let object_type = house_object_types[object.type]
	let [bx1, by1, bx2, by2] = get_object_box(plan, object, box)
	let is_turned = object.rot % 180 >= 90
	let hw = (is_turned ? by2 - by1 : bx2 - bx1) / 2 // half width
	let hl = (is_turned ? bx2 - bx1 : by2 - by1) / 2 // half length
	let x1 = -hw, y1 = -hl, x2 = hw, y2 = hl
	plan_vector_to_object(object, hs.mouse_x - (bx1 + bx2) / 2,
		hs.mouse_y - (by1 + by2) / 2, object_point1)
	let x = object_point1[0], y = object_point1[1]
	let inside = sg.plan_d(6), outside = sg.plan_d(8)
	let side = 0, axis = 'w'
	if (object_type.sizes.w && y >= y1 && y <= y2) {
		let d = min(inside, (x2 - x1) / 4)
		if (x >= x2 - d && x <= x2 + outside)
			side = 1
		else if (x >= x1 - outside && x <= x1 + d)
			side = -1
	}
	if (!side && object_type.sizes.l && x >= x1 && x <= x2) {
		let d = min(inside, (y2 - y1) / 4)
		if (y >= y2 - d && y <= y2 + outside) {
			side = 1
			axis = 'l'
		}
	}
	if (!side)
		return false
	hs.object_side = side
	hs.object_axis = axis
	return true
}

// openings ------------------------------------------------------------------

// the opening runs along y.
function opening_is_v(object) {
	return object.rot % 180 == 90
}

// the order of the objects on one seg, along it: they share the across
// coordinate.
function compare_seg_objects(object1, object2) {
	return object1.x - object2.x || object1.y - object2.y
}

// the min end along `seg` nearest to m where the opening fits between the
// seg's ends and the other openings on the seg, or undefined if it fits
// nowhere.
function fit_opening(plan, seg, object, m) {
	let seg_objects = []
	for (let object1 of plan.objects)
		if (object1 != object && object1.seg == seg)
			seg_objects.push(object1)
	seg_objects.sort(compare_seg_objects)
	let is_v = seg.is_v
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
	return fit_m
}

// the opening's middle on its wall's center line, the origin of its sketch.
function opening_origin(plan, object, out) {
	let is_v = opening_is_v(object)
	return out.set(object.x + (is_v ? 0 : object.w / 2),
		object.y + (is_v ? object.w / 2 : 0))
}

// on the nearest wall seg within snap_d where the opening fits, else where it
// is. a wall of the other direction turns the opening.
function place_opening(plan, object, snap_d) {
	let [x, y] = opening_origin(plan, object, object_point1)
	let seg1, m1
	let min_d = snap_d
	for (let seg of plan.segs) {
		let is_v = seg.is_v
		let across = is_v ? x : y
		let along = is_v ? y : x
		let d = Math.hypot(across - seg.axis,
			max(seg.m1 - along, 0, along - seg.m2))
		if (d > min_d)
			continue
		let m = fit_opening(plan, seg, object, round(along - object.w / 2))
		if (m == null)
			continue
		min_d = d
		seg1 = seg
		m1 = m
	}
	object.on_floor = seg1 != null
	if (seg1) {
		object.seg = seg1
		if (opening_is_v(object) != seg1.is_v) // keep the facing.
			object.rot = seg1.is_v ? 90 : 0
		object.x = seg1.is_v ? seg1.axis : m1
		object.y = seg1.is_v ? m1 : seg1.axis
	}
}

// the widest the opening can be when its end opposite to `side` (1 or -1
// along its width axis) stays in place: the end on `side` stops at the next
// opening or the wall's end. Infinity when not on a wall.
function limit_opening_w(plan, object, side) {
	let seg = object.seg
	if (!seg)
		return Infinity
	let is_v = seg.is_v
	object_vector_to_plan(object, side, 0, object_point1)
	let dir = is_v ? object_point1[1] : object_point1[0] // along the seg.
	let m = is_v ? object.y : object.x
	let end_m = dir > 0 ? m : m + object.w // fixed end.
	let limit_m = dir > 0 ? seg.wall_m2 : seg.wall_m1
	for (let object1 of plan.objects) {
		if (object1 == object || object1.seg != seg)
			continue
		let m1 = is_v ? object1.y : object1.x
		let edge_m = dir > 0 ? m1 : m1 + object1.w // the edge facing the object.
		if (dir * (edge_m - end_m) >= 0 && dir * (edge_m - limit_m) < 0)
			limit_m = edge_m
	}
	return dir * (limit_m - end_m)
}

// the plan box of an opening: its width along its wall, the wall's thickness
// across. not on a wall: an exterior wall's thickness around its center line.
function opening_box(plan, object, out) {
	let is_v = opening_is_v(object)
	let a = is_v ? object.x : object.y
	let m = is_v ? object.y : object.x
	let a1, a2
	if (object.seg) {
		a1 = object.seg.wall_a1
		a2 = object.seg.wall_a2
	} else {
		a1 = a - plan.house.ext_wall_thickness / 2
		a2 = a + plan.house.ext_wall_thickness / 2
	}
	out[0] = is_v ? a1 : m
	out[1] = is_v ? m : a1
	out[2] = is_v ? a2 : m + object.w
	out[3] = is_v ? m + object.w : a2
	return out
}

// the pointer is over the square that the door's leaf sweeps.
function is_over_door_swing(sg, plan, object) {
	get_object_box(plan, object, box)
	let x = (box[0] + box[2]) / 2, y = (box[1] + box[3]) / 2
	let w = object.w
	object_vector_to_plan(object, -w / 2, 0, object_point1)
	let x1 = x + object_point1[0], y1 = y + object_point1[1]
	object_vector_to_plan(object, w / 2, -w, object_point1)
	let x2 = x + object_point1[0], y2 = y + object_point1[1]
	return ui.hit_bbox(sg.x(min(x1, x2)), sg.y(min(y1, y2)),
		sg.x(max(x1, x2)), sg.y(max(y1, y2)))
}

// the door's box, or only for moving it: the square that its leaf sweeps.
function hit_door(sg, plan, object) {
	if (hit_box(sg, plan, object))
		return true
	if (is_over_door_swing(sg, plan, object))
		return 'move'
	return false
}

// the opening's width, on the top face of its wall box or on the right face
// when it runs along y: draw_length puts the dimension outside the face.
function draw_opening_size(cx, sg, plan, object, draw_length) {
	get_object_box(plan, object, box)
	if (opening_is_v(object))
		draw_length(cx, sg, box[2], box[1], box[2], box[3])
	else
		draw_length(cx, sg, box[0], box[1], box[2], box[1])
}

// the distances from the opening to the ends of its wall, on the face of
// draw_opening_size.
function draw_opening_wall_dims(cx, sg, plan, object, draw_length) {
	let seg = object.seg
	if (!seg)
		return
	get_object_box(plan, object, box)
	if (seg.is_v) {
		draw_length(cx, sg, box[2], seg.wall_m1, box[2], box[1])
		draw_length(cx, sg, box[2], box[3], box[2], seg.wall_m2)
	} else {
		draw_length(cx, sg, seg.wall_m1, box[1], box[0], box[1])
		draw_length(cx, sg, box[2], box[1], seg.wall_m2, box[1])
	}
}

// furniture -----------------------------------------------------------------

function furniture_box(plan, object, out) {
	return rect_box(object, object.w, object.l, out)
}

// where it is, or against the room side near it that its type allows: the
// object turns around its center so that the first of its snap_faces faces a
// side that it is within snap_d of, unless one of them already does. it stays
// turned when it leaves the side. on the floor when the rect is inside a room.
function place_furniture(plan, object, snap_d, snap_margin = 0) {
	let faces = house_object_types[object.type].snap_faces
	let side0 = object.snap_side
	object.snap_side = null
	object.side_x = null
	object.side_y = null
	if (faces) {
		let [x1, y1, x2, y2] = get_object_box(plan, object, box)
		let cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
		let found = plan.find_room_side(cx, cy, object.w, object.l,
			object.rot, faces, snap_d, snap_margin, side0)
		if (found) {
			object.rot = found.rot
			let [bx1, by1, bx2, by2] = get_object_box(plan, object, box)
			let w = bx2 - bx1, h = by2 - by1
			object.x = round(cx - w / 2)
			object.y = round(cy - h / 2)
			let side = found.side
			object.snap_side = side

			// the side it rests on, then the nearest side across it.
			rest_on_side(plan, object, side, w, h)
			let is_x = side[0] % 2 == 1
			side = plan.find_wall_side(object.x + w / 2, object.y + h / 2,
				w / 2, h / 2, snap_d, !is_x, is_x)
			if (side)
				rest_on_side(plan, object, side, w, h)
		}
	}
	let [x1, y1, x2, y2] = get_object_box(plan, object, box)
	object.on_floor = plan.is_rect_in_rooms((x1 + x2) / 2, (y1 + y2) / 2,
		(x2 - x1) / 2, (y2 - y1) / 2)
}

// against the room side, the object's side_x or side_y: w, h: its plan size.
function rest_on_side(plan, object, side, w, h) {
	if (side[0] % 2) {
		object.side_x = side
		object.x = plan.wall_side_min(side, w, h)
	} else {
		object.side_y = side
		object.y = plan.wall_side_min(side, w, h)
	}
}

// place_furniture, then in a corner of a room: turned by 45 degrees with its
// back to the corner. Only the sketch turns; the measured box stays square.
function place_chair(plan, object, snap_d, snap_margin = 0) {
	place_furniture(plan, object, snap_d, snap_margin)
	let {side_x, side_y} = object
	if (!(side_x && side_y))
		return
	let [dir_x, wall_x, y1, y2] = side_x
	let [dir_y, wall_y, x1, x2] = side_y
	// both sides end at the corner point (side_x[1], side_y[1]).
	if (
		!(y1 == wall_y || y2 == wall_y) ||
		!(x1 == wall_x || x2 == wall_x)
	)
		return
	object.rot = dir_x * 90 + (dir_x == dir_y + 1 ? -45 : 45)
}

// the widest or longest the furniture piece can be when its end opposite to
// `side` (1 or -1 along `axis`) stays in place: its end on `side` stops at the
// nearest room side that the piece overlaps. Infinity when not in a room.
function limit_furniture_size(plan, object, side, axis) {
	if (!object.on_floor)
		return Infinity
	let is_l = axis == 'l'
	let is_x = (object.rot % 180 == 0) != is_l // the axis runs along x.
	object_vector_to_plan(object, is_l ? 0 : side, is_l ? side : 0,
		object_point1)
	let dir = is_x ? object_point1[0] : object_point1[1]
	let [x1, y1, x2, y2] = get_object_box(plan, object, box)
	let end = dir > 0 ? (is_x ? x1 : y1) : (is_x ? x2 : y2) // fixed end.
	return plan.limit_room_rect((x1 + x2) / 2, (y1 + y2) / 2,
		(x2 - x1) / 2, (y2 - y1) / 2, is_x, dir, end)
}

// the Path2D of the object's sketch, in mm around its center: cached on the
// object until its width or depth changes.
function get_sketch_path(object) {
	let s = object.sketch
	if (s && s.w == object.w && s.l == object.l)
		return s.path
	object.sketch = {
		w: object.w,
		l: object.l,
		path: new Path2D(house_object_types[object.type].sketch(object)),
	}
	return object.sketch.path
}

function draw_furniture(cx, plan, object) {
	draw_object_path(cx, get_sketch_path(object))
}

// a chair turned by 45 degrees: its sketch moves out of the corner by a
// quarter of its box along both plan axes; its box stays.
function draw_chair(cx, plan, object) {
	if (object.rot % 90) {
		object_vector_to_plan(object, 0, 1, object_point1)
		plan_vector_to_object(object, sign(object_point1[0]) * object.w / 4,
			sign(object_point1[1]) * object.l / 4, object_point1)
		cx.translate(object_point1[0], object_point1[1])
	}
	draw_furniture(cx, plan, object)
}

function draw_object_path(cx, path) {
	cx.fillStyle = ui.color_css('bg')
	cx.fill(path)
	cx.stroke(path)
}

// the width on the bottom edge and the length on the right edge of the
// piece, the edges of its sketch: draw_length puts each outside its edge.
function draw_furniture_sizes(cx, sg, plan, object, draw_length) {
	let hw = object.w / 2, hl = object.l / 2
	draw_object_length(cx, sg, plan, object, hw, hl, -hw, hl, draw_length)
	draw_object_length(cx, sg, plan, object, hw, -hl, hw, hl, draw_length)
}

// the distances from an object that spans lo to hi along a room side to the
// side's ends, drawn on the side: its free space is on the left of the walking
// direction, where draw_length puts the dimension.
function draw_side_dims(cx, sg, side, is_v, lo, hi, draw_length) {
	let c = side[1]
	let m1 = side[2]
	let m2 = side[3]
	let a1 = m2 > m1 ? lo : hi // the object's end met first from m1.
	let a2 = m2 > m1 ? hi : lo
	if (is_v) {
		draw_length(cx, sg, c, m1, c, a1)
		draw_length(cx, sg, c, a2, c, m2)
	} else {
		draw_length(cx, sg, m1, c, a1, c)
		draw_length(cx, sg, a2, c, m2, c)
	}
}

// the distances from the piece's box to the ends of the room sides that it
// rests against.
function draw_furniture_wall_dims(cx, sg, plan, object, draw_length) {
	get_object_box(plan, object, box)
	if (object.side_x)
		draw_side_dims(cx, sg, object.side_x, true, box[1], box[3],
			draw_length)
	if (object.side_y)
		draw_side_dims(cx, sg, object.side_y, false, box[0], box[2],
			draw_length)
}

// the head is at the top: the mattress, the pillows, the fold of the cover.
function sketch_bed(object) {
	let {w, l} = object
	let x = w / 2
	let y = l / 2
	let s = `M${-x} ${-y}h${w}v${l}h${-w}z`
	let pillow_n = w < 1200 ? 1 : 2
	for (let i = 0; i < pillow_n; i++) {
		let px = pillow_n == 1 ? 0 : i ? w / 4 : -w / 4
		s += `M${px - 250} ${-y + 100}h500v350h-500z`
	}
	return s + `M${-x} ${-y + l * .4}h${w}`
}

// the path of a polygon of [x, y] points with each corner rounded over r mm.
function round_polygon(points, r) {
	let s = ''
	for (let i = 0, n = points.length; i < n; i++) {
		let [x, y] = points[i]
		let [x0, y0] = points[(i+n-1) % n]
		let [x1, y1] = points[(i+1) % n]
		let d0 = Math.hypot(x0 - x, y0 - y)
		let d1 = Math.hypot(x1 - x, y1 - y)
		s += `${i ? 'L' : 'M'}${x + (x0 - x) * r / d0} ${y + (y0 - y) * r / d0}`
			+ `Q${x} ${y} ${x + (x1 - x) * r / d1} ${y + (y1 - y) * r / d1}`
	}
	return s + 'z'
}

// the back is at the top, narrower than the front.
function sketch_chair(object) {
	let {w, l} = object
	let x = w / 2
	let y = l / 2
	let back_x = x * .75
	return round_polygon([[-back_x, -y], [back_x, -y], [x, y], [-x, y]], 60)
		+ `M${-back_x * .8} ${-y + 90}h${back_x * 1.6}`
}

// the tank is at the top.
function sketch_wc(object) {
	let {w, l} = object
	let x = w / 2
	let y = l / 2
	let bowl_x = w * .45
	let bowl_y = l * .35
	return `M${-x} ${-y}h${w}v${l * .3}h${-w}z `
		+ `M${-bowl_x} ${-y + l * .3}V${y - bowl_y}`
		+ `a${bowl_x} ${bowl_y} 0 0 0 ${2 * bowl_x} 0V${-y + l * .3}z`
}

// countertop ----------------------------------------------------------------

const LEG_DIR = 0, LEG_LENGTH = 1, LEG_DEPTH = 2, LEG_SIZE = 3
const LEG_DX = [1, 0, -1, 0], LEG_DY = [0, 1, 0, -1]
const LEG_END = 0, LEG_LEFT = 1, LEG_RIGHT = 2
const LEG_DEPTH_LEFT = 3, LEG_DEPTH_RIGHT = 4
const LEG_HANDLES = 5

// the legs' rects and outline: cached on the object until its legs change.
function countertop_shape(object) {
	let legs = object.legs
	let shape = object.countertop
	if (shape) {
		let is_same = shape.rects.length * LEG_SIZE == legs.length
		for (let i = 0; is_same && i < shape.rects.length; i++) {
			let rect = shape.rects[i]
			let j = i * LEG_SIZE
			is_same = rect.dir == legs[j + LEG_DIR]
				&& rect.length == legs[j + LEG_LENGTH]
				&& rect.depth == legs[j + LEG_DEPTH]
		}
		if (is_same)
			return shape
	}
	let rects = [], paths = []
	let x = 0, y = 0
	for (let i = 0; i < legs.length; i += LEG_SIZE) {
		let dir = legs[i + LEG_DIR]
		let length = legs[i + LEG_LENGTH]
		let depth = legs[i + LEG_DEPTH]
		let ux = LEG_DX[dir], uy = LEG_DY[dir]
		if (i) {
			let dir0 = legs[i - LEG_SIZE + LEG_DIR]
			let depth0 = legs[i - LEG_SIZE + LEG_DEPTH]
			x -= LEG_DX[dir0] * depth / 2 + ux * depth0 / 2
			y -= LEG_DY[dir0] * depth / 2 + uy * depth0 / 2
		}
		let ex = x + ux * length, ey = y + uy * length
		let hx = abs(uy) * depth / 2, hy = abs(ux) * depth / 2
		let x1 = min(x, ex) - hx, y1 = min(y, ey) - hy
		let x2 = max(x, ex) + hx, y2 = max(y, ey) + hy
		rects.push({x, y, ex, ey, x1, y1, x2, y2, dir, length, depth})
		paths.push([
			{x: x1 * 2, y: y1 * 2}, {x: x2 * 2, y: y1 * 2},
			{x: x2 * 2, y: y2 * 2}, {x: x1 * 2, y: y2 * 2},
		])
		x = ex
		y = ey
	}
	paths = clipper2.union(paths, [], clipper2.FillRule.NonZero)
	shape = {rects: rects, paths: paths, path: null}
	object.countertop = shape
	return shape
}

function countertop_rect(object, rect, out) {
	local_box[0] = rect.x1; local_box[1] = rect.y1
	local_box[2] = rect.x2; local_box[3] = rect.y2
	return rotated_box(object.x, object.y, local_box, object.rot, out)
}

// bound all legs around the first leg's start, (x, y).
function countertop_box(plan, object, out) {
	let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
	for (let rect of countertop_shape(object).rects) {
		x1 = min(x1, rect.x1); y1 = min(y1, rect.y1)
		x2 = max(x2, rect.x2); y2 = max(y2, rect.y2)
	}
	local_box[0] = x1; local_box[1] = y1; local_box[2] = x2; local_box[3] = y2
	return rotated_box(object.x, object.y, local_box, object.rot, out)
}

// the first leg's start.
function countertop_origin(plan, object, out) {
	return out.set(object.x, object.y)
}

let countertop_side = [] // [dir, c, m1, m2]

function place_countertop(plan, object, snap_d) {
	let x = object.x, y = object.y
	object.side_x = null
	object.side_y = null
	let rects = countertop_shape(object).rects
	for (let axis = 0; axis < 2; axis++) {
		let min_gap = Infinity, side1
		for (let rect of rects) {
			countertop_rect(object, rect, box)
			let cx = (box[0] + box[2]) / 2
			let cy = (box[1] + box[3]) / 2
			let hx = (box[2] - box[0]) / 2
			let hy = (box[3] - box[1]) / 2
			let side = plan.find_wall_side(cx, cy, hx, hy, snap_d,
				axis == 0, axis == 1, countertop_side)
			if (!side)
				continue
			let shift = plan.wall_side_min(side, 2 * hx, 2 * hy)
				- (axis ? box[1] : box[0])
			if (abs(shift) < min_gap) {
				min_gap = abs(shift)
				side1 = side.slice()
				if (axis) y = object.y + shift
				else x = object.x + shift
			}
		}
		if (axis) {
			object.y = y
			object.side_y = side1 ?? null
		} else {
			object.x = x
			object.side_x = side1 ?? null
		}
	}
	object.on_floor = true
	for (let rect of rects) {
		countertop_rect(object, rect, box)
		if (!plan.is_rect_in_rooms((box[0] + box[2]) / 2,
			(box[1] + box[3]) / 2, (box[2] - box[0]) / 2,
			(box[3] - box[1]) / 2)) {
			object.on_floor = false
			break
		}
	}
}

function hit_countertop(sg, plan, object) {
	for (let rect of countertop_shape(object).rects) {
		countertop_rect(object, rect, box)
		if (ui.hit_bbox(sg.x(box[0]), sg.y(box[1]),
			sg.x(box[2]), sg.y(box[3])))
			return true
	}
	return false
}

function hit_countertop_resize(sg, plan, object, hs) {
	plan_to_object(plan, object, hs.mouse_x, hs.mouse_y, object_point1)
	let x = object_point1[0], y = object_point1[1]
	let inside = sg.plan_d(6), outside = sg.plan_d(8)
	let rects = countertop_shape(object).rects
	for (let i = rects.length - 1; i >= 0; i--) {
		let rect = rects[i]
		let ux = LEG_DX[rect.dir], uy = LEG_DY[rect.dir]
		let along = (x - rect.x) * ux + (y - rect.y) * uy
		let across = -(x - rect.x) * uy + (y - rect.y) * ux
		let half = rect.depth / 2
		let at_start = i == 0 && along < rect.length / 2
		let at_end = i == rects.length - 1 && !at_start
		let side, dir = rect.dir
		if (abs(across) <= half
			&& (at_start && along >= -outside && along <= inside
				|| at_end && along >= rect.length - inside
					&& along <= rect.length + outside)) {
			side = LEG_END
		} else if (along >= 0 && along <= rect.length
			&& abs(across) >= half - min(inside, rect.depth / 4)
			&& abs(across) <= half + outside) {
			let is_left = across < 0
			let is_free = at_start && along <= 600
				|| at_end && rect.length - along <= 600
			side = is_free ? (is_left ? LEG_LEFT : LEG_RIGHT)
				: (is_left ? LEG_DEPTH_LEFT : LEG_DEPTH_RIGHT)
			dir = (dir + 1) % 4
		} else {
			continue
		}
		let edge_along = side == LEG_END
			? (at_start ? 0 : rect.length) : along
		let edge_across = side == LEG_END ? across
			: (across < 0 ? -half : half)
		let nx = side == LEG_END ? ux * (at_start ? -1 : 1)
			: -uy * (across < 0 ? -1 : 1)
		let ny = side == LEG_END ? uy * (at_start ? -1 : 1)
			: ux * (across < 0 ? -1 : 1)
		let px = rect.x + ux * edge_along - uy * edge_across
		let py = rect.y + uy * edge_along + ux * edge_across
		let is_covered = false
		for (let rect1 of rects) {
			if (rect1 == rect)
				continue
			if (px >= rect1.x1 && px <= rect1.x2
				&& py >= rect1.y1 && py <= rect1.y2
				&& !(px == rect1.x1 && nx <= 0)
				&& !(px == rect1.x2 && nx >= 0)
				&& !(py == rect1.y1 && ny <= 0)
				&& !(py == rect1.y2 && ny >= 0)) {
				is_covered = true
				break
			}
		}
		if (is_covered)
			continue
		// Negative handles address the free start; positive ones the end.
		let handle = i * LEG_HANDLES + side + 1
		hs.object_side = at_start && side <= LEG_RIGHT ? -handle : handle
		hs.object_axis = dir % 2 ? 'l' : 'w'
		return true
	}
	return false
}

function snap_countertop_length(plan, object, snap_d) {
	let rects = countertop_shape(object).rects
	let rect = rects[rects.length - 1]
	let dir = (rect.dir + object.rot / 90) % 4
	let is_x = dir % 2 == 0
	let sign = LEG_DX[dir] || LEG_DY[dir]
	object_to_plan(plan, object, rect.ex, rect.ey, object_point1)
	let x = object_point1[0], y = object_point1[1]
	let hx = is_x ? 0 : rect.depth / 2
	let hy = is_x ? rect.depth / 2 : 0
	let min_length = rects.length > 1 ? rects[rects.length - 2].depth : 1
	let shift = plan.snap_room_edge(x, y, hx, hy, is_x, sign,
		rect.length, min_length, snap_d)
	object.legs[object.legs.length - LEG_SIZE + LEG_LENGTH] += shift
	if (rects.length > 1 && rect.length + shift <= min_length)
		object.legs.length -= LEG_SIZE
}

function start_resize_countertop(plan, object, handle) {
	let legs0 = object.legs
	let legs = legs0.slice()
	let x0 = object.x, y0 = object.y
	let code = abs(handle) - 1
	let i = floor(code / LEG_HANDLES) * LEG_SIZE
	let side = code % LEG_HANDLES
	if (handle < 0) {
		let rects = countertop_shape(object).rects
		let end = rects[rects.length - 1]
		object_to_plan(plan, object, end.ex, end.ey, object_point1)
		x0 = object_point1[0]
		y0 = object_point1[1]
		legs = []
		for (let j = legs0.length - LEG_SIZE; j >= 0; j -= LEG_SIZE)
			legs.push((legs0[j + LEG_DIR] + 2) % 4,
				legs0[j + LEG_LENGTH], legs0[j + LEG_DEPTH])
		i = legs.length - LEG_SIZE
		if (side == LEG_LEFT) side = LEG_RIGHT
		else if (side == LEG_RIGHT) side = LEG_LEFT
	}
	let dir = legs[i + LEG_DIR]
	let ax = LEG_DX[dir], ay = LEG_DY[dir]
	return {resize: function(dx, dy, snap_d = 0) {
		plan_vector_to_object(object, dx, dy, object_point1)
		let x = object_point1[0], y = object_point1[1]
		let along = x * ax + y * ay
		let across = -x * ay + y * ax
		let legs1 = object.legs
		legs1.length = legs.length
		for (let j = 0; j < legs.length; j++)
			legs1[j] = legs[j]
		if (side == LEG_END) {
			let length = round(legs[i + LEG_LENGTH] + along)
			let min_length = i ? legs[i - LEG_SIZE + LEG_DEPTH] : 1
			if (i && length <= min_length)
				legs1.length -= LEG_SIZE
			else
				legs1[i + LEG_LENGTH] = max(min_length, length)
		} else if (side == LEG_LEFT || side == LEG_RIGHT) {
			let length = max(0, round(across * (side == LEG_LEFT ? -1 : 1)))
			if (length)
				legs1.push((dir + (side == LEG_LEFT ? 3 : 1)) % 4,
					legs[i + LEG_DEPTH] + length, 600)
		} else {
			let depth = legs[i + LEG_DEPTH]
			depth += across * (side == LEG_DEPTH_LEFT ? -1 : 1)
			depth = clamp(350 + round((depth - 350) / 50) * 50, 350, 1200)
			legs1[i + LEG_DEPTH] = depth
			let shift = (depth - legs[i + LEG_DEPTH]) / 2
			if (side == LEG_DEPTH_LEFT) shift = -shift
			// Keep the opposite side of the first leg in place.
			if (!i) {
				object_vector_to_plan(object, -ay * shift, ax * shift,
					object_point1)
				object.x = x0 + object_point1[0]
				object.y = y0 + object_point1[1]
			}
		}
		if (i || side <= LEG_RIGHT) {
			object.x = x0
			object.y = y0
		}
		let is_length = side == LEG_END && legs1.length == legs.length
			|| (side == LEG_LEFT || side == LEG_RIGHT)
				&& legs1.length > legs.length
		if (is_length && snap_d > 0)
			snap_countertop_length(plan, object, snap_d)
	}}
}

function draw_countertop(cx, plan, object) {
	let shape = countertop_shape(object)
	if (!shape.path) {
		let s = ''
		for (let path of shape.paths) {
			for (let i = 0; i < path.length; i++)
				s += (i ? 'L' : 'M') + path[i].x / 2 + ' ' + path[i].y / 2
			s += 'z'
		}
		shape.path = new Path2D(s)
	}
	draw_object_path(cx, shape.path)
}

function draw_countertop_sizes(cx, sg, plan, object, draw_length) {
	for (let rect of countertop_shape(object).rects) {
		draw_object_length(cx, sg, plan, object,
			rect.x2, rect.y1, rect.x1, rect.y1, draw_length)
		draw_object_length(cx, sg, plan, object,
			rect.x2, rect.y2, rect.x2, rect.y1, draw_length)
	}
}

function draw_countertop_resize(cx, plan, object, handle) {
	let code = abs(handle) - 1
	let i = floor(code / LEG_HANDLES), side = code % LEG_HANDLES
	let shape = countertop_shape(object)
	let rect = shape.rects[i]
	let ux = LEG_DX[rect.dir], uy = LEG_DY[rect.dir]
	let start_zone = i == 0 ? min(600, rect.length / 2) : 0
	let end_zone = i == shape.rects.length - 1
		? min(600, i == 0 ? rect.length / 2 : rect.length) : 0
	let a1, a2, b1, b2
	if (side == LEG_END) {
		a1 = a2 = handle < 0 ? 0 : rect.length
		b1 = -rect.depth / 2
		b2 = rect.depth / 2
	} else {
		b1 = b2 = (side == LEG_LEFT || side == LEG_DEPTH_LEFT ? -1 : 1)
			* rect.depth / 2
		if (side == LEG_LEFT || side == LEG_RIGHT) {
			a1 = handle < 0 ? 0 : rect.length - end_zone
			a2 = handle < 0 ? start_zone : rect.length
		} else {
			a1 = start_zone
			a2 = rect.length - end_zone
		}
	}
	let x1 = rect.x + ux * a1 - uy * b1
	let y1 = rect.y + uy * a1 + ux * b1
	let x2 = rect.x + ux * a2 - uy * b2
	let y2 = rect.y + uy * a2 + ux * b2
	let is_v = x1 == x2
	let c = is_v ? x1 : y1
	let lo = min(is_v ? y1 : x1, is_v ? y2 : x2)
	let hi = max(is_v ? y1 : x1, is_v ? y2 : x2)
	cx.beginPath()
	for (let path of shape.paths) {
		for (let j = 0; j < path.length; j++) {
			let p = path[j], q = path[(j + 1) % path.length]
			if (is_v ? p.x != c * 2 || q.x != c * 2
				: p.y != c * 2 || q.y != c * 2)
				continue
			let m1 = (is_v ? p.y : p.x) / 2
			let m2 = (is_v ? q.y : q.x) / 2
			let l = max(lo, min(m1, m2)), h = min(hi, max(m1, m2))
			if (l >= h)
				continue
			cx.moveTo(is_v ? c : l, is_v ? l : c)
			cx.lineTo(is_v ? c : h, is_v ? h : c)
		}
	}
	cx.stroke()
}

// stairs --------------------------------------------------------------------

// choose rounded risers and treads for the lower floor's actual height;
// cache the calculated dimensions for placement, drawing, and editing.
function stair_shape(plan, object) {
	let height = plan.house.floors[plan.i-1]?.h ?? plan.house.floor_h
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

// the middle of the top edge, the origin of the stair's sketch and model:
// local +y goes down the run.
function stair_origin(plan, object, out) {
	let [x1, y1, x2, y2] = stair_box(plan, object, origin_box)
	object_vector_to_plan(object, 0, -stair_shape(plan, object).l / 2, out)
	return out.set((x1 + x2) / 2 + out[0], (y1 + y2) / 2 + out[1])
}

// place a valid stair at a slab connection on its owning upper floor.
function place_stair(plan, object, snap_d) {
	let s = stair_shape(plan, object)
	object.on_floor = false
	if (!plan.i || !s.n || s.depth <= 0 || s.bottom_depth <= 0)
		return
	let [x, y] = stair_origin(plan, object, object_point1)
	let found = plan.find_slab_connection(x, y, object.w, s.l,
		object.rot, snap_d)
	if (found) {
		local_box[0] = -object.w / 2
		local_box[1] = 0
		local_box[2] = object.w / 2
		local_box[3] = s.l
		rotated_box(found.x, found.y, local_box, found.rot, box)
		object.x = box[0]
		object.y = box[1]
		object.rot = found.rot
		object.on_floor = true
	}
}

// query the floor for a bottom wall at the requested stair length.
function snap_stair_l(plan, object, l, snap_d) {
	let [x, y] = stair_origin(plan, object, object_point1)
	return plan.snap_wall_end(x, y, object.w, object.rot, l, snap_d)
}

// draw treads and an upward arrow to show the stair's direction.
function draw_stair(cx, plan, object) {
	let s = stair_shape(plan, object)
	cx.beginPath()
	cx.rect(-object.w / 2, 0, object.w, s.l)
	for (let i = 1; i < s.n - 1; i++) {
		let y = i * s.depth
		cx.moveTo(-object.w / 2, y)
		cx.lineTo(object.w / 2, y)
	}
	let arrow = min(object.w / 5, s.l / 5)
	cx.moveTo(0, s.l - arrow)
	cx.lineTo(0, arrow)
	cx.lineTo(-arrow / 2, arrow * 1.5)
	cx.moveTo(0, arrow)
	cx.lineTo(arrow / 2, arrow * 1.5)
	cx.stroke()
}

// draw width and length from the top-edge anchor using local dimensions.
function draw_stair_sizes(cx, sg, plan, object, draw_length) {
	let l = stair_shape(plan, object).l
	let hw = object.w / 2
	draw_object_length(cx, sg, plan, object, hw, l, -hw, l, draw_length)
	draw_object_length(cx, sg, plan, object, hw, 0, hw, l, draw_length)
}

// build a closed stepped mesh below the top landing, with outward faces.
function create_stair_model(editor, plan, object) {
	let s = stair_shape(plan, object)
	let c = editor.create_component({name: 'stair'})
	let hw = object.w / 2
	let profile = [[0, 0], [s.l, 0], [s.l, s.bottom_rise]]
	for (let i = s.n - 2; i >= 0; i--) {
		let z = i * s.depth
		let h = s.height - (i + 1) * s.rise
		profile.push([z, h])
		if (i)
			profile.push([z, h + s.rise])
	}
	let left = [], right = []
	for (let [z, h] of profile) {
		left.push(c.add_point_xyz(-hw, h - s.height, z))
		right.push(c.add_point_xyz(hw, h - s.height, z))
	}
	c.add_face(left)
	c.add_face(right.slice().reverse())
	for (let i = 0; i < profile.length; i++) {
		let j = (i + 1) % profile.length
		c.add_face([left[i], right[i], right[j], left[j]])
	}
	return c
}

// tags ----------------------------------------------------------------------

// on the floor when its point is inside a room.
function place_open_room(plan, object) {
	object.on_floor = !!plan.hit_cycle_edges(object.x, object.y)
}

// on the floor when its point is on the part of the floor below that the
// floor's outlines leave uncovered, where the floor below's roof shows.
function place_terrace(plan, object) {
	let plan0 = plan.house.floors[plan.i-1]
	let x = object.x, y = object.y
	object.on_floor = !!plan0 && plan0.is_rect_touching_house(x, y, x, y)
		&& !plan.is_rect_touching_house(x, y, x, y)
}

// a tag measures as its point.
function tag_box(plan, object, out) {
	return rect_box(object, 0, 0, out)
}

// the icon centered on the point, the text under it, upright on the screen.
let TAG_ICON_SIZE = 20 // px
let TAG_TEXT_FONT = 'bold 12px sans-serif'
let TAG_TEXT_Y = 18 // px, the text's middle under the point
let TAG_HIT_X = 28 // px, half the hit width
let TAG_HIT_Y1 = -12 // px, the hit box's top from the point
let TAG_HIT_Y2 = 26 // px, the hit box's bottom from the point

let tag_icon_fonts = new Map() // {font name -> css font}

// the pointer is over the tag's icon or text.
function hit_tag(sg, plan, object) {
	let dx = ui.mx - sg.x(object.x)
	let dy = ui.my - sg.y(object.y)
	object_point.set(dx, dy).transform(
		object_matrix.reset().rotate(-(sg.rotation ?? 0)), object_point1)
	let [tx, ty] = object_point1 // on the screen, from the point.
	return tx >= -TAG_HIT_X && tx < TAG_HIT_X
		&& ty >= TAG_HIT_Y1 && ty < TAG_HIT_Y2
}

// the icon and the text filled with the current stroke style.
function draw_tag(cx, icon_name, text) {
	let [font, glyph] = ui.get_icon(icon_name)
	let icon_font = tag_icon_fonts.get(font)
	if (!icon_font) {
		icon_font = TAG_ICON_SIZE + 'px ' + font
		tag_icon_fonts.set(font, icon_font)
	}
	cx.fillStyle = cx.strokeStyle
	cx.textAlign = 'center'
	cx.textBaseline = 'middle'
	cx.font = icon_font
	cx.fillText(glyph, 0, 0)
	cx.font = TAG_TEXT_FONT
	cx.fillText(text, 0, TAG_TEXT_Y)
}

// object types --------------------------------------------------------------

let house_object_types = {

	window: {
		w: 1200,
		sill: 900, // above the slab
		head: 2100,
		in_wall: true,
		sizes: {w: {min: 300, step: 1}},
		place: place_opening,
		limit_size: limit_opening_w,
		box: opening_box,
		origin: opening_origin,
		hit: hit_box,
		hit_resize: hit_resize_rect,
		start_resize: start_resize_rect,
		draw_sizes: draw_opening_size,
		draw_wall_dims: draw_opening_wall_dims,
		// a line along the middle of the box, 2 px thinner than the wall.
		draw_mask: function(cx, plan, object, [x1, y1, x2, y2], sg) {
			let scale = sg.d_exact(1)
			let is_v = opening_is_v(object)
			let [ox, oy] = opening_origin(plan, object, object_point1)
			let x = sg.x(ox), y = sg.y(oy)
			// fit the window cut without touching wall borders
			x1 = x + (x1 - ox) * scale + (is_v ? 0 : 1)
			y1 = y + (y1 - oy) * scale + (is_v ? 1 : 0)
			x2 = x + (x2 - ox) * scale - (is_v ? 0 : 1)
			y2 = y + (y2 - oy) * scale - (is_v ? 1 : 0)
			if (sg.scale > 0.02) {
				cx.beginPath()
				cx.rect(x1, y1, x2 - x1, y2 - y1)
				cx.fillStyle = ui.alpha_adjust(ui.color_obj('bg1'), .5)
				cx.fill()
				if (!object.seg) { // not encased: draw casing
					cx.stroke()
				} else { // encased: skip lateral casing, draw only wall edge faintly
					cx.beginPath()
					if (is_v) {
						cx.moveTo(x1, y1); cx.lineTo(x1, y2)
						cx.moveTo(x2, y1); cx.lineTo(x2, y2)
					} else {
						cx.moveTo(x1, y1); cx.lineTo(x2, y1)
						cx.moveTo(x1, y2); cx.lineTo(x2, y2)
					}
					let ss = cx.strokeStyle
					cx.strokeStyle = ui.theme().is_dark
						? ui.color_css('bg2')
						: ui.alpha_adjust(ui.color_obj('text'), .2)
					cx.stroke()
					cx.strokeStyle = ss
				}
			}

			cx.beginPath()
			if (is_v) {
				let x = (x1 + x2) / 2
				cx.moveTo(x, y1); cx.lineTo(x, y2)
			} else {
				let y = (y1 + y2) / 2
				cx.moveTo(x1, y); cx.lineTo(x2, y)
			}
			cx.stroke()
		},
	},

	door: {
		w: 900,
		sill: 0, // above the slab
		head: 2100,
		fields: {mirror: false}, // hinge on the right side
		in_wall: true,
		sizes: {w: {min: 600, max: 1100, step: 100}},
		place: place_opening,
		limit_size: limit_opening_w,
		box: opening_box,
		origin: opening_origin,
		hit: hit_door,
		hit_resize: hit_resize_rect,
		start_resize: start_resize_rect,
		draw_sizes: draw_opening_size,
		draw_wall_dims: draw_opening_wall_dims,
		// fill the wall cut before drawing the leaf in local coordinates.
		draw_mask: function(cx, plan, object, [x1, y1, x2, y2], sg) {
			// the hole's corners rounded like the wall paths.
			let sx1 = sg.x(x1), sy1 = sg.y(y1)
			let sx2 = sg.x(x2), sy2 = sg.y(y2)
			// walls stroked: the width of their strokes, else 0.
			let line_width = sg.scale > 0.04 ? sg.line_width : 0
			// fill clear of the wall strokes: a 1px stroke on a pixel edge
			// half-covers the pixels on both sides.
			let inset = ceil(line_width / 2)
			cx.beginPath()
			cx.rect(sx1 + inset, sy1 + inset,
				sx2 - sx1 - 2 * inset, sy2 - sy1 - 2 * inset)
			cx.fillStyle = ui.alpha_adjust(ui.color_obj('bg1'), .5)
			cx.fill()
			if (!object.seg)
				cx.stroke()
		},
		// the leaf, open at right angles, and its swing.
		draw: function(cx, plan, object) {
			let w = object.w, x = -w / 2
			cx.beginPath()
			cx.moveTo(x, 0)
			cx.lineTo(x, -w)
			cx.arc(x, 0, w, -PI / 2, 0)
			cx.stroke()
		},
		// space: the next of the four orientations: hinge on the other side,
		// then the swing on the other side of the wall.
		update: function(plan, object) {
			if (!ui.keydown(' '))
				return
			plan.update_object(object, function(door) {
				if (door.mirror) {
					door.mirror = false
					door.rot = (door.rot + 180) % 360
				} else {
					door.mirror = true
				}
			})
		},
	},

	bed: {
		w: 1400,
		fields: {l: 2000},
		sizes: {w: [900, 1400, 1600, 1800], l: [1900, 2000]},
		snap_faces: [0], // the head
		sketch: sketch_bed,
		place: place_furniture,
		limit_size: limit_furniture_size,
		box: furniture_box,
		hit: hit_box,
		hit_resize: hit_resize_rect,
		start_resize: start_resize_rect,
		draw_sizes: draw_furniture_sizes,
		draw_wall_dims: draw_furniture_wall_dims,
		draw: draw_furniture,
	},

	chair: {
		w: 450,
		fields: {l: 450},
		snap_faces: [0], // the back
		sketch: sketch_chair,
		place: place_chair,
		box: furniture_box,
		hit: hit_box,
		draw_wall_dims: draw_furniture_wall_dims,
		draw: draw_chair,
	},

	wc: {
		w: 400,
		fields: {l: 700},
		snap_faces: [0], // the tank
		sketch: sketch_wc,
		place: place_furniture,
		box: furniture_box,
		hit: hit_box,
		draw_wall_dims: draw_furniture_wall_dims,
		draw: draw_furniture,
	},

	countertop: {
		fields: {legs: [0, 1800, 600]}, // [dir, length, depth, ...], dir 0 east
		place: place_countertop,
		box: countertop_box,
		origin: countertop_origin,
		hit: hit_countertop,
		hit_resize: hit_countertop_resize,
		start_resize: start_resize_countertop,
		draw_resize: draw_countertop_resize,
		draw: draw_countertop,
		draw_sizes: draw_countertop_sizes,
	},

	open_room: {
		opens_room: true,
		place: place_open_room,
		box: tag_box,
		hit: hit_tag,
		draw_space: 'screen',
		draw: function(cx, plan, object) {
			draw_tag(cx, 'stairs', 'Open')
		},
	},

	terrace: {
		marks_terrace: true,
		place: place_terrace,
		box: tag_box,
		hit: hit_tag,
		draw_space: 'screen',
		draw: function(cx, plan, object) {
			draw_tag(cx, 'sun', 'Terrace')
		},
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
		hit: hit_box,
		hit_resize: hit_resize_rect,
		start_resize: start_resize_rect,
		draw: draw_stair,
		draw_sizes: draw_stair_sizes,
		create_model: create_stair_model,
	},

}

G.get_object_box = get_object_box
G.get_object_origin = get_object_origin
G.house_object_types = house_object_types

}()) // module scope.
