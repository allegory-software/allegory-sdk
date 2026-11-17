/*

	House plan object types: windows, doors and some furniture.
	Written by Cosmin Apreutesei. Public Domain.

	house_object_types -> {type -> object_type}

	object: {type:, x:, y:, rot:, w:, ...fields, seg:, on_floor:}
		x, y: the object's center in plan units (mm).
		rot: degrees, in [0, 360): a multiple of 90, or 45 more than that for
		     a chair in a corner.
		seg: the floor's wall seg the object is on, or null. not saved.
		side_x, side_y: furniture only: the room side that place put the
		     object against across x (a vertical side) and across y (a
		     horizontal side), or null: [dir, c, m1, m2] where dir is the
		     direction to the wall (0 north, 1 east, 2 south, 3 west), c the
		     side's coordinate across it and m1, m2 its ends along it, in the
		     order that the room's free space is on the left. not saved.
		on_floor: the object is in the floor's list, not the ground's: it is
		          in a wall or inside a room. set by place, not saved.

	object_type:
		w                    default width
		fields               {name -> default} saved fields besides
		                     type, x, y, rot, w
		in_wall              optional: the object cuts a hole in its wall.
		snap_faces           optional: [i, ...] the sides of a furniture
		                     piece that can rest against a wall: 0 top,
		                     1 right, 2 bottom, 3 left. no snap_faces: the
		                     piece never snaps.
		sketch(object)       optional: the SVG path string of the object's
		                     outline in mm around its center.
		place(plan, object, x, y, snap_d)
		                     put the object at (x, y), or on a wall of
		                     the plan within snap_d of it: sets x, y, rot,
		                     seg (null when not on a wall) and on_floor.
		hole(plan, object) -> {rect: [x1, y1, x2, y2], sill:, head:}
		                     the cut in the object's wall: sill and head
		                     are heights above the floor's slab.
		w_list, w_range      optional: the widths the object can be resized
		                     to along its width axis: [w, ...] or
		                     {min:, max:, step:} (max is optional).
		limit_w(plan, object, side) -> w
		                     optional: the widest the object can be when
		                     its end opposite to `side` (1 or -1 along its
		                     width axis) stays in place.
		l_list               optional: [l, ...] the lengths the object can
		                     be resized to by dragging its bottom end, the
		                     end at +y in its sketch. its top end stays.
		limit_l(plan, object) -> l
		                     optional: the longest the object can be.
		draw_sizes(cx, view, plan, object, draw_length)
		                     optional: draw the dimensions of the axes that
		                     the object can be resized on, with the editor's
		                     draw_length(cx, view, x1, y1, x2, y2), which
		                     puts the dimension on the left of the line.
		draw_wall_dims(cx, view, plan, object, draw_length)
		                     optional: draw the distances from the object
		                     to the ends of the wall or room side that it
		                     rests against.
		box(plan, object, out) -> out
		                     fill out with the object's plan rect
		                     [x1, y1, x2, y2].
		hit(view, plan, object) -> true|'move'|false
		                     the pointer is over the object: true for all
		                     purposes, 'move' for moving it only, as over
		                     the area that a door sweeps.
		draw(cx, view, plan, object)
		                     draw the object, stroked with the current
		                     stroke style and line width.
		update(plan, object)
		                     optional: handle the object's own input
		                     while the object is hovered.

	plan: a floor of house_plan().
	view: the floor editor's view: x(x), y(y), d(d) plan to screen.

*/

(function () {
"use strict"
const G = window

const {abs, min, max, clamp, floor, ceil, round, sin, cos, rad, PI} = glue

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

// the center position along `seg` nearest to m where the opening fits
// between the seg's ends and the other openings on the seg, or undefined if
// it fits nowhere.
function fit_opening(plan, seg, object, m) {
	let others = []
	for (let object1 of plan.objects)
		if (object1 != object && object1.seg == seg)
			others.push(object1)
	others.sort(compare_seg_objects)
	let is_v = seg.is_v
	let fit_m
	let lo = seg.wall_m1
	for (let i = 0; i <= others.length; i++) {
		let other = others[i]
		let hi = seg.wall_m2
		if (other)
			hi = (is_v ? other.y : other.x) - other.w / 2
		let m1 = ceil(lo + object.w / 2)
		let m2 = floor(hi - object.w / 2)
		if (m1 <= m2) {
			let m_gap = clamp(m, m1, m2)
			if (fit_m == null || abs(m_gap - m) < abs(fit_m - m))
				fit_m = m_gap
		}
		if (other)
			lo = (is_v ? other.y : other.x) + other.w / 2
	}
	return fit_m
}

// on the nearest wall seg within snap_d where the opening fits, else at
// (x, y). a wall of the other direction turns the opening.
function place_opening(plan, object, x, y, snap_d) {
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
		let m = fit_opening(plan, seg, object, along)
		if (m == null)
			continue
		min_d = d
		seg1 = seg
		m1 = m
	}
	object.seg = seg1 ?? null
	object.on_floor = seg1 != null
	if (seg1) {
		if (opening_is_v(object) != seg1.is_v) // keep the facing.
			object.rot = seg1.is_v ? 90 : 0
		object.x = seg1.is_v ? seg1.axis : m1
		object.y = seg1.is_v ? m1 : seg1.axis
	} else {
		object.x = x
		object.y = y
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
	let r = object.rot * rad
	let dir = side * round(is_v ? sin(r) : cos(r)) // along the seg.
	let end_m = (is_v ? object.y : object.x) - dir * object.w / 2 // fixed end.
	let limit_m = dir > 0 ? seg.wall_m2 : seg.wall_m1
	for (let object1 of plan.objects) {
		if (object1 == object || object1.seg != seg)
			continue
		let m = is_v ? object1.y : object1.x
		let edge_m = m - dir * object1.w / 2 // the edge facing the object.
		if (dir * (edge_m - end_m) >= 0 && dir * (edge_m - limit_m) < 0)
			limit_m = edge_m
	}
	return dir * (limit_m - end_m)
}

// the plan box [x1, y1, x2, y2] of an opening, in `out`: its width along its
// wall, the wall's thickness across. not on a wall: an exterior wall's
// thickness.
function opening_box(plan, object, out) {
	let is_v = opening_is_v(object)
	let a1, a2
	if (object.seg) {
		a1 = object.seg.wall_a1
		a2 = object.seg.wall_a2
	} else {
		let a = is_v ? object.x : object.y
		let d = plan.house.ext_wall_thickness / 2
		a1 = a - d
		a2 = a + d
	}
	let m = is_v ? object.y : object.x
	let m1 = m - object.w / 2
	let m2 = m + object.w / 2
	out[0] = is_v ? a1 : m1
	out[1] = is_v ? m1 : a1
	out[2] = is_v ? a2 : m2
	out[3] = is_v ? m2 : a2
	return out
}

let box = [0, 0, 0, 0] // [x1, y1, x2, y2] of the opening hit or drawn

function make_opening_hole(plan, object) {
	let type = house_object_types[object.type]
	return {
		rect: opening_box(plan, object, []),
		sill: type.sill,
		head: type.head,
	}
}

function hit_opening(view, plan, object) {
	opening_box(plan, object, box)
	return ui.hit_bbox(view.x(box[0]), view.y(box[1]),
		view.x(box[2]), view.y(box[3]))
}

// the pointer is over the square that the door's leaf sweeps.
function is_over_door_swing(view, plan, object) {
	opening_box(plan, object, box)
	let r = object.rot * rad
	let x = (box[0] + box[2]) / 2
	let y = (box[1] + box[3]) / 2
	let w = object.w
	let x1 = x - w / 2 * cos(r)
	let y1 = y - w / 2 * sin(r)
	let x2 = x + w / 2 * cos(r) + w * sin(r)
	let y2 = y + w / 2 * sin(r) - w * cos(r)
	return ui.hit_bbox(view.x(min(x1, x2)), view.y(min(y1, y2)),
		view.x(max(x1, x2)), view.y(max(y1, y2)))
}

// the door's box, or only for moving it: the square that its leaf sweeps.
function hit_door(view, plan, object) {
	if (hit_opening(view, plan, object))
		return true
	if (is_over_door_swing(view, plan, object))
		return 'move'
	return false
}

// fill the box on the ground and stroke it, leaving it in `box`.
// draw it `inset` pixels thinner on each side across the wall.
function draw_opening_box(cx, view, plan, object, inset = 0, no_fg) {
	opening_box(plan, object, box)
	let is_v = opening_is_v(object)
	let sx1 = view.x(box[0]) + (is_v ? inset : 0)
	let sy1 = view.y(box[1]) + (is_v ? 0 : inset)
	let sx2 = view.x(box[2]) - (is_v ? inset : 0)
	let sy2 = view.y(box[3]) - (is_v ? 0 : inset)
	cx.beginPath()
	cx.rect(sx1, sy1, sx2 - sx1, sy2 - sy1)
	if (!object.seg) {
		cx.fillStyle = ui.color_css('bg')
		cx.fill()
	}
	if (!no_fg)
		cx.stroke()
}

// the opening's width, on the top face of its wall box or on the right face
// when it runs along y: draw_length puts the dimension outside the face.
function draw_opening_size(cx, view, plan, object, draw_length) {
	opening_box(plan, object, box)
	if (opening_is_v(object))
		draw_length(cx, view, box[2], box[1], box[2], box[3])
	else
		draw_length(cx, view, box[0], box[1], box[2], box[1])
}

// the distances from the opening to the ends of its wall, on the face of
// draw_opening_size.
function draw_opening_wall_dims(cx, view, plan, object, draw_length) {
	let seg = object.seg
	if (!seg)
		return
	opening_box(plan, object, box)
	if (seg.is_v) {
		draw_length(cx, view, box[2], seg.wall_m1, box[2], box[1])
		draw_length(cx, view, box[2], box[3], box[2], seg.wall_m2)
	} else {
		draw_length(cx, view, seg.wall_m1, box[1], box[0], box[1])
		draw_length(cx, view, box[2], box[1], seg.wall_m2, box[1])
	}
}

// furniture -----------------------------------------------------------------

// half the object's extent in the plan along x (want_x) or y: its width and
// depth swap when it is turned by a quarter.
// a piece turned by 45 degrees: the half extent of its bounding box.
function furniture_half(object, want_x) {
	if (object.rot % 90) {
		let r = object.rot * rad
		return (object.w * abs(want_x ? cos(r) : sin(r))
			+ object.l * abs(want_x ? sin(r) : cos(r))) / 2
	}
	let is_turned = object.rot % 180 == 90
	return (is_turned == want_x ? object.l : object.w) / 2
}

let wall_side = {
	gap: 0, // from the rect's face to the side: negative when the rect is in it
	dir: 0, // direction to the wall: 0 north, 1 east, 2 south, 3 west
	c: 0, // across coordinate of the side
	m1: 0, // the side's ends along it, in the walking direction
	m2: 0,
}

// the found `wall_side` as [dir, c, m1, m2].
function get_wall_side() {
	return [wall_side.dir, wall_side.c, wall_side.m1, wall_side.m2]
}

// the room side nearest to the rect of half sizes (hx, hy) around (x, y),
// among the vertical sides (want_v) or the horizontal sides (want_h) that
// the rect overlaps along: left in `wall_side`. true if it is within snap_d.
// a room's free space is on the left of the walking direction of its sides,
// so the wall is on the right.
function find_wall_side(plan, x, y, hx, hy, snap_d, want_v, want_h) {
	wall_side.gap = Infinity
	for (let ring of plan.room_rings) {
		for (let i = 0, n = ring.length; i < n; i++) {
			let p1 = ring[i]
			let p2 = ring[(i+1) % n]
			let is_v = p1[0] == p2[0]
			if (is_v ? !want_v : !want_h)
				continue
			let m1 = is_v ? p1[1] : p1[0]
			let m2 = is_v ? p2[1] : p2[0]
			let along = is_v ? y : x
			let h_along = is_v ? hy : hx
			if (along + h_along <= min(m1, m2)
				|| along - h_along >= max(m1, m2)
			)
				continue
			let dir = is_v ? (m2 > m1 ? 3 : 1) : (m2 > m1 ? 2 : 0)
			let c = is_v ? p1[0] : p1[1]
			let across = is_v ? x : y
			let h_across = is_v ? hx : hy
			let gap = dir == 1 || dir == 2
				? c - (across + h_across) : (across - h_across) - c
			if (abs(gap) < abs(wall_side.gap)) {
				wall_side.gap = gap
				wall_side.dir = dir
				wall_side.c = c
				wall_side.m1 = m1
				wall_side.m2 = m2
			}
		}
	}
	return abs(wall_side.gap) <= snap_d
}

// the center coordinate across `wall_side` of a rect of half sizes (hx, hy)
// resting against it, in whole mm on the room's side.
function wall_side_center(hx, hy) {
	let dir = wall_side.dir
	let h = dir % 2 ? hx : hy
	return dir == 1 || dir == 2 ? floor(wall_side.c - h)
		: ceil(wall_side.c + h)
}

// the rect of half sizes (hx, hy) around (x, y) is inside the plan's rooms,
// touching their sides: no side crosses it and its center is inside an odd
// number of room rings.
function is_rect_in_rooms(plan, x, y, hx, hy) {
	let is_odd = false
	for (let ring of plan.room_rings) {
		for (let i = 0, n = ring.length; i < n; i++) {
			let p1 = ring[i]
			let p2 = ring[(i+1) % n]
			let is_v = p1[0] == p2[0]
			let m1 = is_v ? p1[1] : p1[0]
			let m2 = is_v ? p2[1] : p2[0]
			let m_lo = min(m1, m2)
			let m_hi = max(m1, m2)
			let c = is_v ? p1[0] : p1[1]
			let across = is_v ? x : y
			let h_across = is_v ? hx : hy
			let along = is_v ? y : x
			let h_along = is_v ? hy : hx
			if (c > across - h_across && c < across + h_across
				&& m_lo < along + h_along && m_hi > along - h_along
			)
				return false
			if (is_v && c > x && m_lo <= y && y < m_hi)
				is_odd = !is_odd
		}
	}
	return is_odd
}

// at (x, y), or against the room side near it that its type allows: the
// object turns so that the first of its snap_faces faces a side that it is
// within snap_d of, unless one of them already does. it stays turned when it
// leaves the side. on the floor when the rect is inside a room.
function place_furniture(plan, object, x, y, snap_d) {
	let faces = house_object_types[object.type].snap_faces
	object.side_x = null
	object.side_y = null
	if (faces) {
		let hx = furniture_half(object, true)
		let hy = furniture_half(object, false)
		if (find_wall_side(plan, x, y, hx, hy, snap_d, true, true)) {
			let face = (wall_side.dir - object.rot / 90 + 4) % 4 // facing it.
			if (!faces.includes(face)) {
				object.rot = (wall_side.dir - faces[0] + 4) % 4 * 90
				hx = furniture_half(object, true)
				hy = furniture_half(object, false)
			}

			// the side it rests on, then the nearest side across it.
			let is_x = wall_side.dir % 2 == 1
			if (is_x) {
				object.side_x = get_wall_side()
				x = wall_side_center(hx, hy)
			} else {
				object.side_y = get_wall_side()
				y = wall_side_center(hx, hy)
			}
			if (find_wall_side(plan, x, y, hx, hy, snap_d, !is_x, is_x)) {
				if (is_x) {
					object.side_y = get_wall_side()
					y = wall_side_center(hx, hy)
				} else {
					object.side_x = get_wall_side()
					x = wall_side_center(hx, hy)
				}
			}
		}
	}
	put_furniture(plan, object, x, y)
}

// at (x, y), on the floor when its rect is inside a room.
function put_furniture(plan, object, x, y) {
	object.x = x
	object.y = y
	object.seg = null
	object.on_floor = is_rect_in_rooms(plan, x, y,
		furniture_half(object, true), furniture_half(object, false))
}

// place_furniture, then in a corner of a room: turned by 45 degrees with its
// back to the corner and the back corners of its rect on both walls.
function place_chair(plan, object, x, y, snap_d) {
	place_furniture(plan, object, x, y, snap_d)
	let {side_x, side_y} = object
	if (!(side_x && side_y))
		return
	let [dir_x, wall_x, y1, y2] = side_x
	let [dir_y, wall_y, x1, x2] = side_y
	// both sides end at the corner point (side_x[1], side_y[1]).
	if (!(y1 == wall_y || y2 == wall_y)
		|| !(x1 == wall_x || x2 == wall_x)
	)
		return
	let is_east = dir_x == 1
	let is_south = dir_y == 2
	object.rot = is_south ? (is_east ? 135 : 225) : (is_east ? 45 : 315)
	let hx = furniture_half(object, true)
	let hy = furniture_half(object, false)
	put_furniture(plan, object,
		is_east ? floor(wall_x - hx) : ceil(wall_x + hx),
		is_south ? floor(wall_y - hy) : ceil(wall_y + hy))
}

// the widest the furniture piece can be when its end opposite to `side` (1 or
// -1 along its width axis) stays in place: its end on `side` stops at the
// nearest room side that its depth overlaps. Infinity when not in a room.
function limit_furniture_w(plan, object, side) {
	let is_x = object.rot % 180 == 0 // the width runs along x.
	let r = object.rot * rad
	let dir = side * round(is_x ? cos(r) : sin(r))
	return limit_furniture_size(plan, object, is_x, dir, object.w)
}

// the longest the furniture piece can be when its top end stays in place: its
// bottom end stops at the nearest room side. Infinity when not in a room.
function limit_furniture_l(plan, object) {
	let is_x = object.rot % 180 == 90 // the length runs along x.
	let r = object.rot * rad
	let dir = round(is_x ? -sin(r) : cos(r))
	return limit_furniture_size(plan, object, is_x, dir, object.l)
}

// the widest or longest (`size` now) the furniture piece can be along x
// (is_x) or y when its end opposite to `dir` (1 or -1) stays in place.
function limit_furniture_size(plan, object, is_x, dir, size) {
	if (!object.on_floor)
		return Infinity
	let end = (is_x ? object.x : object.y) - dir * size / 2 // fixed end.
	let along = is_x ? object.y : object.x
	let h_along = furniture_half(object, !is_x)
	let limit_c = dir * Infinity
	for (let ring of plan.room_rings) {
		for (let i = 0, n = ring.length; i < n; i++) {
			let p1 = ring[i]
			let p2 = ring[(i+1) % n]
			if ((p1[0] == p2[0]) != is_x) // only the sides across the width.
				continue
			let m1 = is_x ? p1[1] : p1[0]
			let m2 = is_x ? p2[1] : p2[0]
			if (along + h_along <= min(m1, m2) || along - h_along >= max(m1, m2))
				continue
			let c = is_x ? p1[0] : p1[1]
			if (dir * (c - end) >= 0 && dir * (c - limit_c) < 0)
				limit_c = c
		}
	}
	return dir * (limit_c - end)
}

// the plan box [x1, y1, x2, y2] of a furniture piece, in `out`.
function furniture_box(plan, object, out) {
	let hx = furniture_half(object, true)
	let hy = furniture_half(object, false)
	out[0] = object.x - hx
	out[1] = object.y - hy
	out[2] = object.x + hx
	out[3] = object.y + hy
	return out
}

function hit_furniture(view, plan, object) {
	let hx = furniture_half(object, true)
	let hy = furniture_half(object, false)
	return ui.hit_bbox(view.x(object.x - hx), view.y(object.y - hy),
		view.x(object.x + hx), view.y(object.y + hy))
}

let sketch_paths = new Map() // {type -> {w -> {l -> Path2D}}}

// the Path2D of the object's sketch, in mm around its center: made once for
// each type, width and depth.
function get_sketch_path(object) {
	let paths_by_w = sketch_paths.get(object.type)
	if (!paths_by_w) {
		paths_by_w = new Map()
		sketch_paths.set(object.type, paths_by_w)
	}
	let paths_by_l = paths_by_w.get(object.w)
	if (!paths_by_l) {
		paths_by_l = new Map()
		paths_by_w.set(object.w, paths_by_l)
	}
	let path = paths_by_l.get(object.l)
	if (!path) {
		path = new Path2D(house_object_types[object.type].sketch(object))
		paths_by_l.set(object.l, path)
	}
	return path
}

function draw_furniture(cx, view, plan, object) {
	let path = get_sketch_path(object)
	let scale = view.d_exact(1)
	cx.save()
	cx.translate(view.x(object.x), view.y(object.y))
	cx.rotate(object.rot * rad)
	cx.scale(scale, scale)
	cx.lineWidth /= scale
	cx.fillStyle = ui.color_css('bg')
	cx.fill(path)
	cx.stroke(path)
	cx.restore()
}

// the width on the bottom edge and the length on the right edge of the
// piece, the edges of its sketch: draw_length puts each outside its edge.
function draw_furniture_sizes(cx, view, plan, object, draw_length) {
	let r = object.rot * rad
	let ux = round(cos(r)) // the sketch's x axis in the plan.
	let uy = round(sin(r))
	let hw = object.w / 2
	let hl = object.l / 2
	let x1 = object.x + ux * hw - uy * hl // bottom right corner.
	let y1 = object.y + uy * hw + ux * hl
	let x2 = object.x - ux * hw - uy * hl // bottom left corner.
	let y2 = object.y - uy * hw + ux * hl
	let x3 = object.x + ux * hw + uy * hl // top right corner.
	let y3 = object.y + uy * hw - ux * hl
	draw_length(cx, view, x1, y1, x2, y2)
	draw_length(cx, view, x3, y3, x1, y1)
}

// the distances from an object that spans lo to hi along a room side to the
// side's ends, drawn on the side: its free space is on the left of the walking
// direction, where draw_length puts the dimension.
function draw_side_dims(cx, view, side, is_v, lo, hi, draw_length) {
	let c = side[1]
	let m1 = side[2]
	let m2 = side[3]
	let a1 = m2 > m1 ? lo : hi // the object's end met first from m1.
	let a2 = m2 > m1 ? hi : lo
	if (is_v) {
		draw_length(cx, view, c, m1, c, a1)
		draw_length(cx, view, c, a2, c, m2)
	} else {
		draw_length(cx, view, m1, c, a1, c)
		draw_length(cx, view, a2, c, m2, c)
	}
}

// the distances from the piece's box to the ends of the room sides that it
// rests against.
function draw_furniture_wall_dims(cx, view, plan, object, draw_length) {
	furniture_box(plan, object, box)
	if (object.side_x)
		draw_side_dims(cx, view, object.side_x, true, box[1], box[3],
			draw_length)
	if (object.side_y)
		draw_side_dims(cx, view, object.side_y, false, box[0], box[2],
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

// object types --------------------------------------------------------------

let house_object_types = {

	window: {
		w: 1200,
		sill: 900, // above the slab
		head: 2100,
		in_wall: true,
		w_range: {min: 300, step: 1},
		place: place_opening,
		limit_w: limit_opening_w,
		hole: make_opening_hole,
		box: opening_box,
		hit: hit_opening,
		draw_sizes: draw_opening_size,
		draw_wall_dims: draw_opening_wall_dims,
		// a line along the middle of the box, 2 px thinner than the wall.
		draw: function(cx, view, plan, object) {
			opening_box(plan, object, box)

			let sx1 = view.x(box[0])
			let sy1 = view.y(box[1])
			let sx2 = view.x(box[2])
			let sy2 = view.y(box[3])

			if (!object.seg) {
				cx.beginPath()
				cx.rect(sx1 - 1, sy1 - 1, sx2 - sx1 + 2, sy2 - sy1 + 2)
				cx.fillStyle = ui.color_css('bg')
				cx.fill()
			}

			let x = (sx1 + sx2) / 2
			let y = (sy1 + sy2) / 2
			let w = view.d(object.w)
			cx.save()
			cx.translate(x, y)
			cx.rotate(object.rot * rad)

			cx.beginPath()
			cx.moveTo(-w / 2, 0)
			cx.lineTo(w / 2, 0)
			cx.restore()
			cx.stroke()
		},
	},

	door: {
		w: 900,
		sill: 0, // above the slab
		head: 2100,
		fields: {mirror: false}, // hinge on the right side
		in_wall: true,
		w_range: {min: 600, max: 1100, step: 100},
		place: place_opening,
		limit_w: limit_opening_w,
		hole: make_opening_hole,
		box: opening_box,
		hit: hit_door,
		draw_sizes: draw_opening_size,
		draw_wall_dims: draw_opening_wall_dims,
		// the leaf, open at right angles, and its swing.
		draw: function(cx, view, plan, object) {
			draw_opening_box(cx, view, plan, object)
			let x = (view.x(box[0]) + view.x(box[2])) / 2
			let y = (view.y(box[1]) + view.y(box[3])) / 2
			let w = view.d(object.w)
			cx.save()
			cx.translate(x, y)
			cx.rotate(object.rot * rad)
			cx.beginPath()
			if (object.mirror) {
				cx.moveTo(w / 2, 0)
				cx.lineTo(w / 2, -w)
				cx.arc(w / 2, 0, w, -PI / 2, -PI, true)
			} else {
				cx.moveTo(-w / 2, 0)
				cx.lineTo(-w / 2, -w)
				cx.arc(-w / 2, 0, w, -PI / 2, 0)
			}
			cx.restore()
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
		w_list: [900, 1400, 1600, 1800],
		l_list: [1900, 2000],
		snap_faces: [0], // the head
		sketch: sketch_bed,
		place: place_furniture,
		limit_w: limit_furniture_w,
		limit_l: limit_furniture_l,
		box: furniture_box,
		hit: hit_furniture,
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
		hit: hit_furniture,
		draw_wall_dims: draw_furniture_wall_dims,
		draw: draw_furniture,
	},

	wc: {
		w: 400,
		fields: {l: 700},
		snap_faces: [0], // the tank
		sketch: sketch_wc,
		place: place_furniture,
		box: furniture_box,
		hit: hit_furniture,
		draw_wall_dims: draw_furniture_wall_dims,
		draw: draw_furniture,
	},

}

G.house_object_types = house_object_types

}()) // module scope.
