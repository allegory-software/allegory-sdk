/*

	House plan object types: windows and doors.
	Written by Cosmin Apreutesei. Public Domain.

	house_object_types -> {type -> object_type}

	object: {type:, x:, y:, rot:, w:, ...fields, seg:}
		x, y: the object's center in plan units (mm).
		rot: degrees, a multiple of 90.
		seg: the floor's wall seg the object is on, or null. not saved.

	object_type:
		w                    default width
		fields               {name -> default} saved fields besides
		                     type, x, y, rot, w
		place(plan, object, x, y, snap_d)
		                     put the object at (x, y), or on a wall of
		                     the plan within snap_d of it: sets x, y, rot
		                     and seg (null when not on a wall).
		hole(plan, object) -> {rect: [x1, y1, x2, y2], sill:, head:}
		                     the cut in the object's wall: sill and head
		                     are heights above the floor's slab.
		hit(view, plan, object) -> t|f
		                     the pointer is over the object.
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

const {abs, max, clamp, floor, ceil, rad, PI} = glue

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
	let lo = seg.m1
	for (let i = 0; i <= others.length; i++) {
		let other = others[i]
		let hi = seg.m2
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

// fill and stroke the opening's box, which it leaves in `box`.
function draw_opening_box(cx, view, plan, object) {
	opening_box(plan, object, box)
	let sx1 = view.x(box[0])
	let sy1 = view.y(box[1])
	let sx2 = view.x(box[2])
	let sy2 = view.y(box[3])
	cx.beginPath()
	cx.rect(sx1, sy1, sx2 - sx1, sy2 - sy1)
	cx.fillStyle = ui.color_css('bg')
	cx.fill()
	cx.stroke()
}

// object types --------------------------------------------------------------

let house_object_types = {

	window: {
		w: 1200,
		sill: 900, // above the slab
		head: 2100,
		place: place_opening,
		hole: make_opening_hole,
		hit: hit_opening,
		// a line along the middle of the box.
		draw: function(cx, view, plan, object) {
			draw_opening_box(cx, view, plan, object)
			let x = (view.x(box[0]) + view.x(box[2])) / 2
			let y = (view.y(box[1]) + view.y(box[3])) / 2
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
		place: place_opening,
		hole: make_opening_hole,
		hit: hit_opening,
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

}

G.house_object_types = house_object_types

}()) // module scope.
